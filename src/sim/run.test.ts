import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createSession } from '@/game/session';
import { isOpenAt, minuteOfDay } from '@/sim/economy/calendar';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { applyCommand, COMMAND_TYPES, type Command } from '@/sim/economy/commands';
import { awaitingDecision, isClosedForRemont, nextRemont, stepMinute, type EconEvent, type EconomyState } from '@/sim/economy/economy';
import { rand01 } from '@/sim/economy/rand';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { STAFF_PROFILES, STAFF_TASKS } from '@/sim/economy/tycoon/staff';
import { EQUIPMENT, UPGRADES } from '@/sim/economy/upgrades';
import { hashString } from '@/sim/rng';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { freshRun, isLogEntry, isRunRecord, replayRun, type LogEntry, type RunRecord } from './run';

// --- Żywa gra: to, co przyszłe actions.ts robi z poleceniami gracza ----------------------------------------------

/** Minuta gry, w której wydawane są polecenia bota (stan stoi, `stepMinute` jeszcze nie ruszył). */
interface Play {
  state: EconomyState;
  /** k-te losowanie bota w tej minucie, z [0, 1). Z hasza `seed:bot`, więc bieg zależy tylko od seeda. */
  roll(k: number): number;
  /** Wpis do dziennika (minuta, kolejne `seq`), `applyCommand` i podmiana `info` po remoncie, jak w żywej grze. */
  issue(cmd: unknown): void;
}
type Policy = (play: Play) => void;

interface Live {
  state: EconomyState;
  record: RunRecord;
  /** JSON stanu w zadanych minutach: po poleceniach tej minuty, przed `stepMinute`. */
  snapshots: Map<number, string>;
  /** JSON stanu w zadanych minutach, zanim polityka wydała pierwsze polecenie (np. przed odpowiedzią na kartę, która właśnie się pokazała). */
  before: Map<number, string>;
}

/** Polecenia zepsute na kilka sposobów; gra je odrzuca, a dziennik je pamięta (klient mógł je wysłać). */
const BROKEN: unknown[] = [
  { type: 'buyUpgrade', id: 'nope' },
  { type: 'buyEquipment', id: 'toString' },
  { type: 'setOrder', auto: 'yes' },
  { type: 'setOrder', auto: true, manual: NaN },
  { type: 'movePallet', palletId: 1, loc: 'roof' },
  { type: 'setStaffProfile', profile: '__proto__' },
  { type: 'pinStaff', task: 'kasa', count: 1.5 },
  { type: 'answerCard', seq: 1.5, answer: 0 },
  { type: 'answerCard', seq: 999_999, answer: 0 },
  { type: 'nuke' },
];

const UPGRADE_IDS = UPGRADES.map((u) => u.id);
const EQUIPMENT_IDS = EQUIPMENT.map((e) => e.id);

/** Gracz-bot: odpowiada na karty, stuka, kupuje, zatrudnia, robi remonty i co jakiś czas wysyła śmieci. Każda decyzja z `roll`. */
const bot: Policy = ({ state: s, roll, issue }) => {
  // gra stoi na karcie, dopóki gracz nie odpowie (pętla klatek nie wykona minuty): bot odpowiada na każdą widoczną, losowo,
  // a co trzecią razą zatwierdza odpowiedź zaznaczoną z góry
  for (const [i, card] of visibleCards(s.tycoon.cards, s.minute).entries()) {
    const answer = roll(24 + 2 * i) < 0.35 ? card.defaultAnswer : Math.floor(roll(25 + 2 * i) * card.answers.length);
    issue({ type: 'answerCard', seq: card.seq, answer });
  }
  if (isOpenAt(minuteOfDay(s.minute))) {
    const r = roll(0);
    if (s.queue >= 1 && r < 0.45) issue({ type: 'tapTill' });
    else if (s.pallets.length > 0 && r < 0.8) {
      const p = s.pallets[Math.floor(roll(1) * s.pallets.length)]!;
      issue(roll(2) < 0.5 ? { type: 'tapPallet', palletId: p.id } : { type: 'tapPallet' });
    }
    if (s.pallets.length > 0 && roll(3) < 0.15) issue({ type: 'tapPallet' });   // drugie stuknięcie w tej samej minucie
  }
  // gdy poziom pozwala na kolejny remont, bot odkłada na niego (zleceń Centrali, które sypały gotówką, już nie ma)
  const upcoming = nextRemont(s);
  const saving = upcoming !== null && s.level >= upcoming.minLevel;
  if (s.minute % 60 === 0 && roll(5) < 0.6 && !saving) {
    if (roll(6) < 0.7) issue({ type: 'buyUpgrade', id: UPGRADE_IDS[Math.floor(roll(7) * UPGRADE_IDS.length)] });
    else issue({ type: 'buyEquipment', id: EQUIPMENT_IDS[Math.floor(roll(7) * EQUIPMENT_IDS.length)] });
  }
  if (s.queue > 6 && s.staff < 4) issue({ type: 'hire' });   // bez limitu pensje zjadają całą gotówkę i do remontu nie dochodzi
  const next = nextRemont(s);
  if (next && s.level >= next.minLevel && s.cash >= next.cost) issue({ type: 'startRemont' });
  if (isClosedForRemont(s) && roll(8) < 0.002) issue({ type: 'rushRemont' });
  if (roll(9) < 0.0005) issue({ type: 'campaign' });
  const onSidewalk = s.pallets.find((p) => p.loc === 'sidewalk');
  if (onSidewalk && roll(10) < 0.3) issue({ type: 'movePallet', palletId: onSidewalk.id, loc: 'backroom' });
  if (s.pallets.length > 0 && roll(11) < 0.0003) issue({ type: 'returnPallet', palletId: s.pallets[Math.floor(roll(12) * s.pallets.length)]!.id });   // od SIM 5 zawsze odmowa
  for (const id of s.milestonesReady) if (roll(40) < 0.05) issue({ type: 'claimMilestone', id });
  if (roll(41) < 0.0005) issue({ type: 'claimMilestone', id: 'edward' });   // zwykle niespełniony: odmowa też trafia do dziennika
  if (roll(13) < 0.001) issue({ type: 'setOrder', auto: roll(14) < 0.8, manual: Math.floor(roll(15) * 10) });
  if (roll(16) < 0.001) issue({ type: 'setStaffProfile', profile: STAFF_PROFILES[Math.floor(roll(17) * STAFF_PROFILES.length)] });
  // przypięcie: 0 zdejmuje przydział, a więcej niż ludzi na zmianie gra odrzuca (dziennik pamięta i to)
  if (roll(21) < 0.001) issue({ type: 'pinStaff', task: STAFF_TASKS[Math.floor(roll(22) * STAFF_TASKS.length)], count: Math.floor(roll(23) * 4) });
  if (s.staff > 3 && roll(18) < 0.0005) issue({ type: 'fire' });
  if (roll(19) < 1 / 500) issue(BROKEN[Math.floor(roll(20) * BROKEN.length)]);
};

/** Bez stuknięć i sprzedaży: co godzinę zatrudnia (do limitu), a pensje robią resztę. Kończy się bankructwem. */
const hireEveryHour: Policy = ({ state: s, issue }) => {
  if (s.minute % 60 === 0) issue({ type: 'hire' });
};

/**
 * „Żywa gra”: `freshRun`, w każdej minucie polecenia polityki, potem `stepMinute`. To samo robi przyszłe `actions.ts`:
 * wpis do dziennika z bieżącą minutą i kolejnym `seq`, `applyCommand`, podmiana `info` przy `layoutChanged`.
 * Zapamiętuje JSON stanu w `snapshotAt` oraz w minucie remontu i tuż po niej (tam odtworzenie liczy już na nowym układzie).
 */
function playLive(seed: string, days: number, opts: { policy?: Policy; snapshotAt?: readonly number[] } = {}): Live {
  const { state, info: start } = freshRun(seed);
  let info: StoreInfo = start;
  const policy = opts.policy ?? bot;
  const botHash = hashString(`${seed}:bot`);
  const log: LogEntry[] = [];
  let seq = 0;
  const snapAt = new Set(opts.snapshotAt);
  const snapshots = new Map<number, string>();
  const before = new Map<number, string>();
  const events: EconEvent[] = [];
  const play: Play = {
    state,
    roll: (k) => rand01(botHash, state.minute, k),
    issue: (cmd) => {
      log.push({ minute: state.minute, seq: seq++, cmd: cmd as Command });
      const out = applyCommand(state, info, cmd as Command);
      if (out.layoutChanged) {
        info = out.info!;
        snapAt.add(state.minute).add(state.minute + 1);
      }
    },
  };
  const end = state.minute + days * MINUTES_PER_DAY;
  while (state.minute < end && !state.gameOver) {
    if (snapAt.has(state.minute)) before.set(state.minute, JSON.stringify(state));
    policy(play);
    // pętla klatek nie wykona minuty, póki karta czeka: polityka, która nie odpowiedziała, zatwierdza odpowiedzi zaznaczone z góry
    if (awaitingDecision(state)) {
      for (const card of visibleCards(state.tycoon.cards, state.minute)) play.issue({ type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
    }
    expect(awaitingDecision(state), 'minuta z kartą na biurku').toBe(false);
    if (snapAt.has(state.minute)) snapshots.set(state.minute, JSON.stringify(state));
    events.length = 0;
    stepMinute(state, info, events);
  }
  return { state, record: { seed, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log }, snapshots, before };
}

// --- Pomocniki testów --------------------------------------------------------------------------------------------

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Bajt w bajt (z kolejnością kluczy); przy różnicy najpierw pokazuje strukturalny diff, bo dwa długie teksty nic nie mówią. */
function expectSameJson(actual: unknown, expected: unknown, label = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) expect(JSON.parse(a), label).toEqual(JSON.parse(e));
  expect(a, label).toBe(e);
}

function allFinite(x: unknown): boolean {
  if (typeof x === 'number') return Number.isFinite(x);
  if (typeof x !== 'object' || x === null) return true;
  return Object.values(x).every(allFinite);
}

const recordOf = (seed: string, log: unknown[]): RunRecord =>
  ({ seed, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log: log as LogEntry[] });

const SEEDS = Array.from({ length: 12 }, (_, i) => `traszka-${i + 1}`);
const START = OPEN_FROM;
/** Wiele dób gry na seedach: ok. 4 s na wolnym rdzeniu, a przy obciążonej maszynie (cały zestaw równolegle) dłużej niż domyślne 5 s. */
const TIMEOUT = 60_000;

describe('strażniki kształtu biegu (dla serwera rankingu przed replayRun)', () => {
  const cmd = { type: 'tapTill' };

  it('isLogEntry: obiekt ze skończonymi minute i seq, a cmd może być czymkolwiek (odrzuca go dopiero applyCommand)', () => {
    const good: unknown[] = [
      { minute: START, seq: 0, cmd }, { minute: -5, seq: 1.5, cmd }, { minute: 1e9, seq: -3, cmd }, { minute: 0, seq: 0 },
      { minute: START, seq: 1, cmd: 'nuke' }, { minute: START, seq: 1, cmd: null }, { minute: START, seq: 2, cmd, dodatkowe: true },
    ];
    for (const e of good) expect(isLogEntry(e), inspect(e)).toBe(true);
    const bad: unknown[] = [
      null, undefined, 7, 'tapTill', true, [], [1, 2], {}, { cmd }, { minute: NaN, seq: 1, cmd }, { minute: START, seq: NaN, cmd },
      { minute: Infinity, seq: 1, cmd }, { minute: START, seq: -Infinity, cmd }, { minute: '400', seq: 1, cmd }, { minute: START, seq: '1', cmd },
      { minute: START, seq: null, cmd }, { minute: null, seq: 1, cmd }, { minute: START, cmd }, { seq: 1, cmd }, { minute: [400], seq: 1, cmd },
    ];
    for (const e of bad) expect(isLogEntry(e), inspect(e)).toBe(false);
  });

  it('isRunRecord: seed i gameVersion napisy, generatorVersion i simVersion liczby całkowite, mode casual albo ranked, log tablica', () => {
    const ok = recordOf(SEEDS[0]!, [{ minute: START, seq: 0, cmd }]);
    expect(isRunRecord(ok)).toBe(true);
    expect(isRunRecord({ ...ok, mode: 'casual' })).toBe(true);
    expect(isRunRecord({ ...ok, log: [] })).toBe(true);
    expect(isRunRecord({ ...ok, seed: '' })).toBe(true);   // długość i treść seeda ustawia wołający
    expect(isRunRecord(clone(ok))).toBe(true);   // tak wygląda bieg po przejściu przez JSON
    expect(isRunRecord({ ...ok, dodatkowe: 1 })).toBe(true);
    for (const simVersion of [0, 1, SIM_VERSION, 7, 999_999]) expect(isRunRecord({ ...ok, simVersion }), String(simVersion)).toBe(true);   // którą wersję przyjmie, rozstrzyga sędzia
    const bad: [string, unknown][] = [
      ['null', null], ['undefined', undefined], ['liczba', 7], ['napis', 'bieg'], ['tablica', []], ['pusty obiekt', {}],
      ['seed liczbą', { ...ok, seed: 5 }], ['seed null', { ...ok, seed: null }], ['seed obiektem', { ...ok, seed: {} }], ['bez seeda', { ...ok, seed: undefined }],
      ['gameVersion liczbą', { ...ok, gameVersion: 1 }], ['bez gameVersion', { ...ok, gameVersion: undefined }],
      ['generatorVersion ułamkiem', { ...ok, generatorVersion: 1.5 }], ['generatorVersion napisem', { ...ok, generatorVersion: String(GENERATOR_VERSION) }],
      ['generatorVersion NaN', { ...ok, generatorVersion: NaN }], ['generatorVersion Infinity', { ...ok, generatorVersion: Infinity }],
      ['generatorVersion null', { ...ok, generatorVersion: null }],
      ['bez simVersion', { ...ok, simVersion: undefined }], ['simVersion ułamkiem', { ...ok, simVersion: 1.5 }], ['simVersion napisem', { ...ok, simVersion: String(SIM_VERSION) }],
      ['simVersion NaN', { ...ok, simVersion: NaN }], ['simVersion Infinity', { ...ok, simVersion: Infinity }], ['simVersion null', { ...ok, simVersion: null }],
      ['mode spoza listy', { ...ok, mode: 'practice' }], ['bez mode', { ...ok, mode: undefined }], ['mode wielką literą', { ...ok, mode: 'Ranked' }],
      ['log obiektem z length', { ...ok, log: { length: 5 } }], ['log null', { ...ok, log: null }], ['log napisem', { ...ok, log: 'abc' }], ['bez loga', { ...ok, log: undefined }],
    ];
    for (const [label, x] of bad) expect(isRunRecord(x), label).toBe(false);
  });

  it('bieg o poprawnym kształcie da się odtworzyć', () => {
    const run = recordOf(SEEDS[0]!, [{ minute: START, seq: 0, cmd }]);
    expect(isRunRecord(run)).toBe(true);
    expect(replayRun(run, START + 10).minute).toBe(START + 10);
  });
});

describe('odtwarzanie biegu', () => {
  it('odtworzenie z (seed, dziennik) daje bajt w bajt ten sam stan: 12 seedów × 90 dni', () => {
    const seen = new Set<string>();
    const remonts: number[] = [];
    for (const seed of SEEDS) {
      const live = playLive(seed, 90);
      const replayed = replayRun(clone(live.record), live.state.minute);
      expectSameJson(replayed, live.state, seed);
      for (const e of live.record.log) seen.add((e.cmd as { type: string } | null)?.type ?? 'null');
      remonts.push(live.state.remontLevel);
    }
    // dowód ma dotyczyć całej gry, nie samych stuknięć: remonty (nowy układ w trakcie), wszystkie typy poleceń i śmieci
    // (drugiego remontu bot losowych decyzji nie dociąga w 90 dni, odkąd opłata franczyzowa jest po balansie z 29.10.2026: dość jest pierwszego)
    expect(remonts.filter((n) => n >= 1).length).toBeGreaterThanOrEqual(3);
    expect(COMMAND_TYPES.filter((t) => !seen.has(t))).toEqual([]);
    expect(seen.has('nuke')).toBe(true);
  }, TIMEOUT);

  it('odtworzenie do minuty pośredniej = stan żywej gry w tej minucie', () => {
    // południe dni 10, 30 i 60: pełna godzina, więc bot często kupuje właśnie w tej minucie (polecenia minuty M wchodzą przed stopem w M)
    const at = [10, 30, 60].map((d) => d * MINUTES_PER_DAY + 12 * 60);
    let checked = 0;
    let withCommands = 0;
    for (const seed of SEEDS.slice(0, 3)) {
      const live = playLive(seed, 90, { snapshotAt: [START, ...at] });
      const record = clone(live.record);   // cały dziennik, także wpisy po sprawdzanej minucie: replayRun ma je pominąć
      expect([...live.snapshots.keys()].length).toBeGreaterThanOrEqual(at.length + 1);
      for (const [minute, json] of live.snapshots) {
        expectSameJson(replayRun(record, minute), JSON.parse(json), `${seed} @${minute}`);
        checked++;
        if (record.log.some((e) => e.minute === minute)) withCommands++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(12);
    expect(withCommands).toBeGreaterThanOrEqual(3);
  }, TIMEOUT);

  it('dziennik bez odpowiedzi na kartę odtwarza się do końca: karty dostają odpowiedź zaznaczoną z góry', () => {
    const seed = SEEDS[2]!;
    const until = START + 3 * MINUTES_PER_DAY;
    // żywa gra: stuknięcia w minutach, w których nic nie czeka; karta w minucie showAt dostaje odpowiedź domyślną POZA dziennikiem
    const { state, info } = freshRun(seed);
    const log: LogEntry[] = [];
    const events: EconEvent[] = [];
    let seq = 0;
    let defaults = 0;
    while (state.minute < until && !state.gameOver) {
      if (awaitingDecision(state)) {
        for (const c of visibleCards(state.tycoon.cards, state.minute)) {
          applyCommand(state, info, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
          defaults++;
        }
      } else if (isOpenAt(minuteOfDay(state.minute)) && state.minute % 3 === 0) {
        const cmd: Command = state.minute % 2 === 0 ? { type: 'tapTill' } : { type: 'tapPallet' };
        log.push({ minute: state.minute, seq: seq++, cmd });
        applyCommand(state, info, cmd);
      }
      events.length = 0;
      stepMinute(state, info, events);
    }
    expect(state.minute).toBe(until);
    expect(defaults).toBeGreaterThanOrEqual(1);                    // pierwszy dzień gry zawsze ma kartę (potem ok. pół na dobę)
    expect(log.length).toBeGreaterThan(100);
    expect(log.some((e) => e.cmd.type === 'answerCard')).toBe(false);

    const replayed = replayRun(recordOf(seed, clone(log)), until);   // nie zawisło i doszło do końca
    expect(replayed.minute).toBe(until);
    expectSameJson(replayed, state);
    expect(replayed.tycoon.cards.month.answered).toBe(defaults);
    expect(replayed.tycoon.cards.month.defaults).toBe(defaults);   // każda odpowiedź to zaznaczona z góry
  });

  it('odtworzenie do minuty karty to stan przed odpowiedzią', () => {
    const seed = SEEDS[1]!;
    const first = Math.min(...freshRun(seed).state.tycoon.cards.pending.map((c) => c.showAt));
    const live = playLive(seed, 2, { snapshotAt: [first] });
    const before = live.before.get(first)!;
    const after = live.snapshots.get(first)!;
    expect(before).toBeDefined();
    expect(after).not.toBe(before);   // w tej minucie bot odpowiedział na kartę

    // dziennik bez wpisów od minuty karty: odtworzenie staje przed odpowiedzią, karta jeszcze czeka
    const earlier = live.record.log.filter((e) => e.minute < first);
    const atCard = replayRun(recordOf(seed, clone(earlier)), first);
    expectSameJson(atCard, JSON.parse(before));
    expect(awaitingDecision(atCard)).toBe(true);
    // krok dalej odpowiedź zaznaczona z góry rozstrzyga kartę, a bieg rusza
    const next = replayRun(recordOf(seed, clone(earlier)), first + 1);
    expect(next.minute).toBe(first + 1);
    expect(next.tycoon.cards.log.some((e) => e.day === 0)).toBe(true);
    // pełny dziennik: wpisy tej minuty (odpowiedź gracza) wchodzą przed zatrzymaniem, jak przy każdym poleceniu
    expectSameJson(replayRun(clone(live.record), first), JSON.parse(after));
  });

  it('stan nie zależy od toLocaleString ani Intl', () => {
    const seed = SEEDS[3]!;
    const normal = playLive(seed, 35);   // ponad miesiąc: raport miesięczny też przechodzi przez formatowanie liczb
    const toLocaleString = Number.prototype.toLocaleString;
    const { NumberFormat, DateTimeFormat } = Intl;
    let live!: Live;
    let replayed!: EconomyState;
    let calls = 0;
    try {
      Number.prototype.toLocaleString = () => { calls++; return 'X'; };
      Intl.NumberFormat = (() => { throw new Error('Intl.NumberFormat w symulacji'); }) as unknown as typeof Intl.NumberFormat;
      Intl.DateTimeFormat = (() => { throw new Error('Intl.DateTimeFormat w symulacji'); }) as unknown as typeof Intl.DateTimeFormat;
      live = playLive(seed, 35);
      replayed = replayRun(clone(live.record), live.state.minute);
    } finally {
      Number.prototype.toLocaleString = toLocaleString;
      Intl.NumberFormat = NumberFormat;
      Intl.DateTimeFormat = DateTimeFormat;
    }
    expect(calls).toBeGreaterThan(100);   // podmiana działa: teksty zdarzeń i wyników poleceń przechodzą przez toLocaleString
    expect(normal.record.log.length).toBeGreaterThan(500);
    expectSameJson(live.state, normal.state);
    expectSameJson(live.record, normal.record);
    expectSameJson(replayed, normal.state);
  });

  it('zepsuty dziennik nie rzuca i nie psuje stanu', () => {
    const seed = SEEDS[4]!;
    const live = playLive(seed, 8);
    const until = live.state.minute;
    const legit = live.record.log;

    // wpisy, które replayRun ma zignorować: polecenia zepsute (nieznany typ, id spoza katalogów, NaN, tekst zamiast liczby, nie-obiekt)
    // przy poprawnej minucie i numerze
    const hostile: unknown[] = [
      { type: 'nuke' }, { type: 'buyUpgrade', id: 'toString' }, { type: 'buyUpgrade', id: '__proto__' }, { type: 'buyEquipment', id: 'x' },
      { type: 'movePallet', palletId: 1, loc: 'roof' }, { type: 'setStaffProfile', profile: 'all' }, { type: 'pinStaff', task: 'kawa', count: 1 },
      { type: 'pinStaff', task: 'kasa', count: NaN }, { type: 'pinStaff', task: 'kasa', count: -1 }, { type: 'setPriority', priority: 'palety' },
      { type: 'setOrder', auto: 'yes' },
      { type: 'setOrder', auto: true, manual: NaN }, { type: 'setOrder', auto: true, manual: Infinity }, { type: 'claimQuest', questId: 1 },   // zlecenia zniknęły: stary klient jeszcze je wyśle
      { type: 'tapPallet', palletId: 1.5 }, { type: 'returnPallet', palletId: NaN }, { type: 'constructor' }, null, 'tapTill', [], 7, undefined,
    ].map((cmd, i) => ({ minute: START + 50 + i * 311, seq: 1_000_000 + i, cmd }));
    // wpisy bez minuty albo numeru, jakich nie da się uporządkować: pomijane w całości
    const cmd = { type: 'setStaffProfile', profile: 'porzadek' };
    const malformed: unknown[] = [
      null, 7, 'tapTill', [], {}, { cmd }, { minute: START + 10, seq: 1 }, { minute: NaN, seq: 1, cmd }, { minute: Infinity, seq: 1, cmd },
      { minute: -Infinity, seq: 1, cmd }, { minute: '400', seq: 1, cmd }, { minute: START + 10, seq: NaN, cmd }, { minute: START + 10, seq: '1', cmd },
      { minute: START + 10, seq: undefined, cmd },
    ];
    // po końcu: gdyby zadziałały, stan by się zmienił (profil pracy z 'kolejka' na 'porzadek', a dostawy poszłyby inaczej)
    const late = [until + 1, until + 5, until + MINUTES_PER_DAY, 1e9, Number.MAX_VALUE].map((minute, i) => ({ minute, seq: 2_000_000 + i, cmd }));
    // te działają: sprzed startu (lądują na starcie, w kolejności seq) i ze zdublowanym numerem (kolejność wpisów rozstrzyga remis)
    const early = [{ minute: -10, seq: 5, cmd: { type: 'setOrder', auto: false, manual: 9 } }, { minute: -1e9, seq: 0, cmd: { type: 'hire' } }];
    const dupes = legit.slice(100, 140).map((e) => ({ ...e, cmd: { type: 'setStaffProfile', profile: 'dostawa' } }));

    const inert = new Set<unknown>([...hostile, ...malformed, ...late]);
    const all = [...legit, ...dupes, ...early, ...hostile, ...malformed, ...late];
    const messy = all
      .map((entry, i) => ({ entry, key: rand01(hashString('shuffle'), i, 0) }))
      .sort((a, b) => a.key - b.key)
      .map(({ entry }) => entry);
    const before = JSON.stringify(messy);

    let state!: EconomyState;
    expect(() => { state = replayRun(recordOf(seed, messy), until); }).not.toThrow();
    expect(state.minute).toBe(until);
    expect(allFinite(state)).toBe(true);
    expect(JSON.stringify(messy)).toBe(before);   // dziennik klienta zostaje nietknięty (sortowanie na kopii)

    // posortowany po (minute, seq) i, przy remisie, według kolejności w dzienniku; zepsute na końcu, bo nie mają miejsca w porządku.
    // Wyrocznia jest własna, a nie `isLogEntry` z run.ts: inaczej test sprawdzałby kod jego własnym kodem (zgodność pilnuje następna linia).
    const isOrderable = (e: unknown): e is LogEntry =>
      typeof e === 'object' && e !== null && Number.isFinite((e as LogEntry).minute) && Number.isFinite((e as LogEntry).seq);
    for (const e of messy) expect(isLogEntry(e)).toBe(isOrderable(e));
    const orderable = messy.map((entry, i) => ({ entry, i })).filter(({ entry }) => isOrderable(entry));
    const sorted = [
      ...orderable.sort((a, b) => (a.entry as LogEntry).minute - (b.entry as LogEntry).minute || (a.entry as LogEntry).seq - (b.entry as LogEntry).seq || a.i - b.i)
        .map(({ entry }) => entry),
      ...messy.filter((e) => !isOrderable(e)),
    ];
    expectSameJson(replayRun(recordOf(seed, sorted), until), state, 'posortowany');
    // śmieci i wpisy po końcu są bez znaczenia: ten sam stan bez nich
    expectSameJson(replayRun(recordOf(seed, messy.filter((e) => !inert.has(e))), until), state, 'bez śmieci');
    // a wpisy sprzed startu i zdublowane naprawdę coś robią (inaczej test niczego by nie dowodził)
    expect(JSON.stringify(replayRun(live.record, until))).not.toBe(JSON.stringify(state));
  });

  it('wpis sprzed startu trafia na start, wpis po untilMinute jest pomijany', () => {
    const seed = SEEDS[5]!;
    const cmd: Command = { type: 'setOrder', auto: false, manual: 7 };
    const until = START + 3 * MINUTES_PER_DAY;
    const run = (minute: number | null): EconomyState => replayRun(recordOf(seed, minute === null ? [] : [{ minute, seq: 0, cmd }]), until);
    const atStart = run(START);
    expect(atStart.order).toEqual({ auto: false, manual: 7 });
    expectSameJson(run(-5), atStart);
    expectSameJson(run(START - 1e6), atStart);
    // wpis w minucie, na której stoimy, wchodzi przed zatrzymaniem; wpis o minutę dalej już nie
    expect(run(until).order).toEqual({ auto: false, manual: 7 });
    expectSameJson(run(until + 1), run(null));
    expect(run(until + 1).order.auto).toBe(true);
    // bez poleceń i bez kroków: stan startowy
    expectSameJson(replayRun(recordOf(seed, []), START), freshRun(seed).state);
  });

  it('untilMinute, które nie jest liczbą skończoną, jest odrzucane zamiast zawisnąć', () => {
    const record = recordOf(SEEDS[0]!, []);
    for (const until of [NaN, Infinity, -Infinity]) expect(() => replayRun(record, until)).toThrow(RangeError);
  });

  it('bankructwo w środku biegu: odtworzenie się kończy, polecenia po końcu nie zmieniają stanu', () => {
    const limit = START + 400 * MINUTES_PER_DAY;
    // 'kiełbasa-42' kończy po ok. 90 dniach, 'traszka-1' po ok. 120, 'traszka-3' po ok. 150: różne miesiące i różne raporty
    for (const seed of ['kiełbasa-42', 'traszka-1', 'traszka-3']) {
      const live = playLive(seed, 400, { policy: hireEveryHour });
      const end = live.state.minute;
      expect(live.state.gameOver, seed).toBe(true);
      expect(end, seed).toBeLessThan(limit - 100 * MINUTES_PER_DAY);

      const record = clone(live.record);
      const replayed = replayRun(record, limit);
      expectSameJson(replayed, live.state, seed);
      expect(replayed.minute).toBe(end);   // stoi na minucie końca, nie dojechało do untilMinute

      // gra skończona: żadne polecenie nie przechodzi, także to z minuty końca i z kolejnych dni
      const seq = record.log.length;
      const tail: LogEntry[] = [end, end + 1, end + 60, end + 10 * MINUTES_PER_DAY].flatMap((minute, i) => [
        { minute, seq: seq + 2 * i, cmd: { type: 'setStaffProfile', profile: 'dostawa' } },
        { minute, seq: seq + 2 * i + 1, cmd: { type: 'setOrder', auto: false, manual: 30 } },
      ] as LogEntry[]);
      const longer = { ...record, log: [...record.log, ...tail] };
      expectSameJson(replayRun(longer, limit), live.state, `${seed} + polecenia po końcu`);
      expectSameJson(replayRun(longer, end + 5), live.state, `${seed}, untilMinute tuż po końcu`);
      expectSameJson(replayRun(longer, end), live.state, `${seed}, untilMinute w minucie końca`);
    }
  }, TIMEOUT);

  it('inna wersja generatora: odtworzenie odmawia', () => {
    const record = recordOf(SEEDS[0]!, []);
    expect(() => replayRun(record, START + 10)).not.toThrow();
    expect(() => replayRun({ ...record, generatorVersion: GENERATOR_VERSION + 1 }, START + 10)).toThrow(/generator/);
    expect(() => replayRun({ ...record, generatorVersion: GENERATOR_VERSION - 1 }, START + 10)).toThrow(Error);
  });

  it('gameVersion, simVersion i mode są tylko przenoszone (wersję symulacji porównuje sędzia na serwerze, nie replayRun)', () => {
    const live = playLive(SEEDS[1]!, 5);
    const base = replayRun(clone(live.record), live.state.minute);
    expectSameJson(replayRun({ ...clone(live.record), gameVersion: 'inna', mode: 'casual' }, live.state.minute), base);
    for (const simVersion of [0, SIM_VERSION - 1, SIM_VERSION + 1]) {
      expectSameJson(replayRun({ ...clone(live.record), simVersion }, live.state.minute), base, String(simVersion));
    }
  });

  it('freshRun to ten sam stan co createSession dla nowej gry bez premii', () => {
    for (const seed of ['kiełbasa-42', 'traszka-1', ...SEEDS.slice(0, 3)]) {
      const run = freshRun(seed);
      const session = createSession(seed, true);
      expectSameJson(run.state, session.econ, seed);
      expectSameJson(run.layout, session.layout, seed);
      expectSameJson(run.info, session.info, seed);
      expect(run.state.minute).toBe(START);
    }
  });
});
