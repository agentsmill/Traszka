import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { COMMAND_TYPES, type Command } from '@/sim/economy/commands';
import { awaitingDecision, type EconEvent, type EconomyState } from '@/sim/economy/economy';
import { BOT_VALUATION } from '@/sim/economy/tycoon/bots';
import { bestAnswer, visibleCards } from '@/sim/economy/tycoon/cards';
import { RANKED_SEASON_END_MINUTE, RANKED_SEASON_MONTHS, seasonBankrupt, seasonScore } from '@/sim/ranked';
import { replayRun, type LogEntry, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { dispatchCommand, type CommandEffects } from '@/game/actions';
import { advanceSession } from '@/game/frame';
import { MemoryStorage } from '@/game/memoryStorage';
import {
  RANKED_KEYS, createRankedSession, finishRun, loadFinished, loadRanked, pendingFinished, saveFinished, saveRanked, seasonOver, type FinishedRun,
} from '@/game/rankedRun';
import type { GameSession } from '@/game/session';
import { RUN_MAX_BODY_BYTES } from '../src/server/config';
import { parseSubmission } from '../src/server/runs';
import { makeReplayVerifier } from '../src/server/verify';

/**
 * Cały sezon rankingowy przez prawdziwą warstwę gry i prawdziwego sędziego. Bieg jest zagrany jak w przeglądarce: `createRankedSession`,
 * polecenia przez `dispatchCommand`, czas przez `advanceSession` w klatkach po 1/60 s przy ×8, trzy przeładowania strony (`saveRanked`,
 * potem `loadRanked`, a stara sesja przepada), koniec przez `finishRun` i szufladę niewysłanego biegu. Potem jest wysłany tak, jak wysyła
 * go klient (JSON w ciele `POST /api/runs`), sprawdzony przez `parseSubmission` i przeliczony przez `makeReplayVerifier` z tym samym
 * `replayRun` i `seasonScore`, które ma bundle sędziego. Wynik, który zobaczył gracz, ma być dokładnie tym, co policzy sędzia.
 * Wcześniejsze testy pilnują kawałków tej drogi (`rankedRun.test.ts`, `tests/simGolden.test.ts`, `verify.test.ts`, `tests/judgeBundle.test.ts`);
 * tu niczego się nie podstawia, więc jeśli gra i sędzia kiedykolwiek się rozjadą (dziennik traci polecenie, zapis gubi pole, parser je przycina,
 * wynik żywej gry różni się od odtworzenia), ten test to zobaczy.
 *
 * Nic tu nie czyta zegara ani `Math.random`: skrypt gracza wynika ze stałych poniżej, o odpowiedziach na karty decyduje sama karta (`bestAnswer`), a `Date`
 * jest przypięta do `NOW` (kod gry wpisuje chwilę zapisu do `traszka:ranked`). Jeśli po zmianie ekonomii skrypt doprowadzi sklep do bankructwa
 * (test zgłosi minutę), popraw terminy zakupów w `PLAN` albo regułę odpowiedzi w `chooseAnswer`: ranking nie przyjmuje biegu, który kończy się
 * grą przed końcem sezonu (sędzia odrzuca go jako `season-bankrupt`, jak `bankrupt` w `makeBundleVerifier`), więc skrypt ma doprowadzić
 * sklep do końca sezonu z `gameOver` równym false. Wzorzec terminów i odpowiedzi: `PLAN` i `CARD_ANSWERS` z `tests/simGolden.test.ts`.
 */

const SEED = 'kiełbasa-42';
const END = RANKED_SEASON_END_MINUTE;
/** Stała chwila „teraz” (ms od epoki) dla `finishRun` i `Date`; nic w teście nie pyta zegara. */
const NOW = 1_793_000_000_000;
/** Klucz gracza (kod odzyskiwania w postaci z grupami) i nick, jak w `POST /api/runs`. */
const KEY = 'K7QX-9MBD-2HFA-P3WN-8RTE';
const NICK = 'Mateusz';
/** Klatka jak przy 60 fps i prędkość ×8: ok. 0,8 minuty gry na klatkę w godzinach otwarcia, więc sezon to ok. 140 tys. klatek. */
const FRAME_DT = 1 / 60;
const SPEED = 8;
/** Dni biegu: 0…90, od 1 września do 30 listopada; sezon kończy się o 23:01 dnia 90. */
const DAYS = 91;
/** Bezpiecznik pętli klatek: sezon ma ok. 140 tys. klatek, a gdyby gra stanęła (karta bez odpowiedzi), test ma zgłosić błąd, nie wisieć. */
const MAX_FRAMES = 400_000;
/** Czas na zagranie i sprawdzenie całego sezonu (kilka pełnych odtworzeń): przy obciążonej maszynie (cały zestaw równolegle) dłuższy niż domyślne 5 s. */
const TIMEOUT = 120_000;

/** Efekty poleceń bez skutków: ten test sprawdza dziennik i stan, nie dźwięk ani scenę (tak samo robi `rankedRun.test.ts`). */
const NO_EFFECTS: CommandEffects = {
  play: () => {}, buzz: () => {}, toast: () => {}, confetti: () => {}, handleEvents: () => {}, persist: () => {}, clearSelection: () => {},
  rebuildScene: () => {}, notice: () => {}, refresh: () => {},
};

/** Minuta gry: dzień od startu (dzień 0 = 1 września), godzina i minuta. */
const at = (day: number, hour: number, minute = 0): number => day * MINUTES_PER_DAY + hour * 60 + minute;

// --- Skrypt gracza ----------------------------------------------------------------------------------------------------

/** Krok skryptu: polecenie wydane w pierwszej klatce, w której `econ.minute` dosięga `minute` (polecenie może zależeć od stanu sesji). */
interface Step { minute: number; make: (s: GameSession) => Command }

/**
 * Wydatki i decyzje gracza w wybranych dniach (dzień, godzina, minuta, polecenie): ten sam rytm co `PLAN` z `tests/simGolden.test.ts`,
 * dobrany do ekonomii z C2 tak, żeby bieg przetrwał sezon (opłata franczyzowa po raporcie miesięcznym zjada gotówkę, więc droższe zakupy
 * idą we wrześniu i w listopadzie, a w październiku tylko kilka). Są tu wszystkie typy poleceń poza stuknięciami i kartami, które dochodzą
 * niżej. Remont 1 ma dwie próby (zapas na zmiany cen): rush bez trwającego remontu jest odrzucany i ląduje w dzienniku jak każde
 * odrzucone polecenie.
 */
const PLAN: readonly (readonly [day: number, hour: number, minute: number, cmd: Command])[] = [
  [0, 6, 0, { type: 'setOrder', auto: false, manual: 6 }],
  [0, 6, 0, { type: 'movePallet', palletId: 1, loc: 'backroom' }],
  [0, 6, 1, { type: 'returnPallet', palletId: 2 }],
  [0, 6, 2, { type: 'setStaffProfile', profile: 'dostawa' }],
  [1, 9, 0, { type: 'claimMilestone', id: 'pallet1' }],
  [1, 12, 0, { type: 'buyUpgrade', id: 'szkolenie' }],
  [2, 13, 0, { type: 'claimMilestone', id: 'upgrade1' }],
  [2, 12, 0, { type: 'buyUpgrade', id: 'ulotki' }],
  [3, 7, 0, { type: 'setOrder', auto: true }],
  [4, 12, 0, { type: 'buyEquipment', id: 'sco' }],
  [5, 12, 0, { type: 'buyUpgrade', id: 'wozek' }],
  [6, 12, 0, { type: 'campaign' }],
  [6, 12, 30, { type: 'setStaffProfile', profile: 'porzadek' }],
  [7, 12, 0, { type: 'buyUpgrade', id: 'regaly' }],
  [9, 12, 0, { type: 'buyEquipment', id: 'bankomat' }],
  [10, 12, 0, { type: 'buyUpgrade', id: 'kawa' }],
  [11, 12, 0, { type: 'setOrder', auto: false, manual: 40 }],   // ponad granicę: stan przytnie do 30
  [12, 7, 0, { type: 'setOrder', auto: true, manual: 5.5 }],   // ułamek: stan zaokrągli
  [14, 12, 0, { type: 'buyEquipment', id: 'piec', slotId: 'equipmentSlot-2' }],
  [16, 12, 0, { type: 'buyUpgrade', id: 'ulotki' }],
  [18, 12, 0, { type: 'buyUpgrade', id: 'szkolenie' }],
  // październik: kilka droższych zakupów i zmiany w załodze
  [40, 12, 0, { type: 'buyUpgrade', id: 'traszkapka' }],
  [41, 12, 0, { type: 'buyUpgrade', id: 'asystent' }],
  [45, 12, 0, { type: 'buyUpgrade', id: 'klima' }],
  [46, 12, 0, { type: 'hire' }],
  [48, 12, 0, { type: 'pinStaff', task: 'kasa', count: 1 }],
  [50, 12, 0, { type: 'fire' }],
  [50, 12, 5, { type: 'setStaffProfile', profile: 'kolejka' }],
  // listopad: kampania, remont 1 (dwie próby) i zakupy po remoncie
  [78, 12, 0, { type: 'campaign' }],
  [84, 7, 0, { type: 'startRemont' }],
  [84, 7, 5, { type: 'rushRemont' }],
  [86, 12, 0, { type: 'campaign' }],
  [87, 12, 0, { type: 'hire' }],
];

/**
 * Cały skrypt: `PLAN` i stuknięcia każdego dnia. Rano po dostawie seria stuknięć w paletę w kolejnych minutach (rusza combo), w pierwszych
 * dziesięciu dniach co drugie z nich celuje w konkretną paletę ze stanu, w porannym szczycie seria stuknięć w kasę, a reszta rozrzucona
 * po godzinach otwarcia. Posortowany stabilnie po minucie, żeby remisy zostały w kolejności dopisania.
 */
function buildScript(): Step[] {
  const steps: Step[] = [];
  const fixed = (minute: number, cmd: Command): void => { steps.push({ minute, make: () => ({ ...cmd }) }); };
  for (const [day, hour, minute, cmd] of PLAN) fixed(at(day, hour, minute), cmd);
  for (let day = 0; day < DAYS; day++) {
    for (let k = 0; k < 8; k++) {
      const targeted = day < 10 && k % 2 === 0;
      steps.push({
        minute: at(day, 7, 2 + k),
        make: (s) => (targeted && s.econ.pallets[0] ? { type: 'tapPallet', palletId: s.econ.pallets[0].id } : { type: 'tapPallet' }),
      });
    }
    for (let k = 0; k < 5; k++) fixed(at(day, 7, 20 + 37 * k), { type: 'tapPallet' });
    for (let k = 0; k < 6; k++) fixed(at(day, 8, 5 + k), { type: 'tapTill' });
    for (let k = 0; k < 6; k++) fixed(at(day, 11 + 2 * k, 15), { type: 'tapTill' });
  }
  return steps.filter((st) => st.minute < END).sort((a, b) => a.minute - b.minute);
}

/**
 * Odpowiedź gracza na kartę, która trzyma grę: najlepsza według wyceny bota `decydent` (`bestAnswer` z `BOT_VALUATION`), jak w
 * `PLAN` z `tests/simGolden.test.ts`. Część kart ma najlepszą odpowiedź równą zaznaczonej z góry (wtedy gracz zatwierdza domyślną), reszta
 * dostaje inną. Z samymi odpowiedziami domyślnymi bieg nie stać na remont przed końcem sezonu bez zejścia poniżej granicy debetu
 * (kończy grę, a ranking takiego biegu nie przyjmuje). Decyduje sama karta, nie stan ani losowość.
 */
const chooseAnswer = (card: Parameters<typeof bestAnswer>[0]): number => bestAnswer(card, BOT_VALUATION);

/**
 * Przeładowania strony: dzień 10 i dzień 45 (jak w zadaniu) oraz dzień 86, już po remoncie (w zapisie jest inny układ sklepu). Drugie
 * czeka na kartę, która trzyma grę, i przeładowuje stronę przed odpowiedzią: gracze odświeżają stronę właśnie wtedy, gdy gra stoi
 * na decyzji, a odtworzenie dziennika ma wtedy stanąć w tym samym miejscu co żywa gra (nie wolno mu odpowiedzieć za gracza).
 */
const RELOADS: readonly { minute: number; onCard: boolean }[] = [
  { minute: at(10, 15), onCard: false },
  { minute: at(45, 15), onCard: true },
  { minute: at(86, 15), onCard: false },
];

// --- Zagranie sezonu ----------------------------------------------------------------------------------------------------

/** Co jedno przeładowanie zostawia do sprawdzenia: wczytana sesja, odtworzenie zapisanego dziennika do jej minuty oraz numery `seq` i długości dziennika przed i po. */
interface Reload {
  minute: number;
  onCard: boolean;
  /** Czy po wczytaniu gra stoi na karcie (i ile kart czeka na odpowiedź). */
  waiting: boolean;
  pendingCards: number;
  seqBefore: number;
  seqAfter: number;
  logLengthBefore: number;
  logLengthAfter: number;
  /** Co leżało w `localStorage` pod `traszka:ranked`, z którego wczytano sesję. */
  storedSeq: number;
  storedLogLength: number;
  loaded: EconomyState;
  replayed: EconomyState;
  remontLevel: number;
  sameSession: boolean;
  sameLog: boolean;
  fromSave: boolean;
}

interface Season {
  session: GameSession;
  reloads: Reload[];
  /** Czy polecenie o danym `seq` zostało przyjęte przez stan (odrzucone też trafiają do dziennika). */
  accepted: Map<number, boolean>;
  /** Karty, na które gracz odpowiedział: numer karty, wybrana i zaznaczona z góry odpowiedź oraz numer wpisu dziennika z odpowiedzią. */
  cards: { seq: number; id: string; answer: number; defaultAnswer: number; logSeq: number }[];
  frames: number;
}

function playSeason(storage: MemoryStorage): Season {
  const script = buildScript();
  const events: EconEvent[] = [];
  const accepted = new Map<number, boolean>();
  const cards: Season['cards'] = [];
  const reloads: Reload[] = [];
  let session = createRankedSession(SEED);
  let next = 0;
  let frames = 0;

  /** Polecenie przez prawdziwy `dispatchCommand`. Każde polecenie skryptu ma trafić do dziennika; zapamiętuje, czy stan je przyjął. */
  const dispatch = (cmd: Command): LogEntry => {
    const { log } = session.run!.record;
    const before = log.length;
    const ok = dispatchCommand(session, cmd, NO_EFFECTS).ok;
    if (log.length !== before + 1) throw new Error(`Polecenie ${JSON.stringify(cmd)} w minucie ${session.econ.minute} nie trafiło do dziennika.`);
    const entry = log[before]!;
    accepted.set(entry.seq, ok);
    return entry;
  };

  /** Przeładowanie strony, jeśli czas na nie przyszedł i `onCard` zgadza się z tym, czy gra stoi teraz na karcie. */
  const reloadIfDue = (waitingNow: boolean): void => {
    const plan = RELOADS[reloads.length];
    if (!plan || plan.onCard !== waitingNow || session.econ.minute < plan.minute) return;
    const before = session;
    expect(saveRanked(before), 'saveRanked').toBe(true);
    const stored = JSON.parse(storage.getItem(RANKED_KEYS.active)!) as { run: { log: unknown[]; seq: number } };
    const loaded = loadRanked();
    if (loaded.status !== 'ok') throw new Error(`loadRanked po zapisie w minucie ${before.econ.minute}: ${loaded.status}`);
    session = loaded.session;   // stara sesja przepada: dalej gra tylko wczytana
    reloads.push({
      minute: session.econ.minute,
      onCard: plan.onCard,
      waiting: awaitingDecision(session.econ),
      pendingCards: visibleCards(session.econ.tycoon.cards, session.econ.minute).length,
      seqBefore: before.run!.seq,
      seqAfter: session.run!.seq,
      logLengthBefore: before.run!.record.log.length,
      logLengthAfter: session.run!.record.log.length,
      storedSeq: stored.run.seq,
      storedLogLength: stored.run.log.length,
      loaded: structuredClone(session.econ),
      replayed: replayRun(session.run!.record, session.econ.minute),
      remontLevel: session.econ.remontLevel,
      sameSession: session === before,
      sameLog: session.run!.record.log === before.run!.record.log,
      fromSave: session.fromSave,
    });
  };

  while (session.econ.minute < END) {
    if (session.econ.gameOver) throw new Error(`Bankructwo w minucie ${session.econ.minute} (dzień ${Math.floor(session.econ.minute / MINUTES_PER_DAY)}): popraw skrypt.`);
    if (++frames > MAX_FRAMES) throw new Error(`Sezon się nie kończy: minuta ${session.econ.minute} po ${frames} klatkach.`);

    reloadIfDue(awaitingDecision(session.econ));

    // karta, która trzyma grę, dostaje odpowiedź przed jakimkolwiek innym poleceniem tej minuty (stuknięcia czekają na kartę)
    while (awaitingDecision(session.econ)) {
      const card = visibleCards(session.econ.tycoon.cards, session.econ.minute)[0]!;
      const answer = chooseAnswer(card);
      const entry = dispatch({ type: 'answerCard', seq: card.seq, answer });
      if (!accepted.get(entry.seq)) throw new Error(`Karta ${card.seq} („${card.id}”) odrzuciła odpowiedź ${answer}.`);
      cards.push({ seq: card.seq, id: card.id, answer, defaultAnswer: card.defaultAnswer, logSeq: entry.seq });
    }

    while (next < script.length && script[next]!.minute <= session.econ.minute) dispatch(script[next++]!.make(session));

    reloadIfDue(false);

    events.length = 0;
    advanceSession(session, FRAME_DT, SPEED, false, events);
  }
  return { session, reloads, accepted, cards, frames };
}

// --- Test -------------------------------------------------------------------------------------------------------------------

describe('cały sezon rankingowy z gry przechodzi sędziego z tym samym wynikiem', () => {
  let season: Season;
  let finished: FinishedRun;
  /** Stan z odtworzenia całego dziennika do końca sezonu, policzony raz (tak jak zrobi to sędzia). */
  let replayedEnd: EconomyState;

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    season = playSeason(storage);
    const run = finishRun(season.session, NOW);
    if (run === null) throw new Error('finishRun zwrócił null: sesja rankingowa straciła dziennik.');
    finished = run;
    replayedEnd = replayRun(finished.record, END);
  }, TIMEOUT);
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('skrypt zagrał cały sezon bez bankructwa i skończył dokładnie na końcu sezonu', () => {
    const { econ } = season.session;
    expect(econ.gameOver).toBe(false);
    expect(econ.minute).toBe(END);
    expect(seasonOver(econ)).toBe(true);
    expect(econ.history, 'raporty miesięczne sezonu').toHaveLength(RANKED_SEASON_MONTHS);
    expect(season.session.mode).toBe('ranked');
  });

  it('dziennik jest prawdziwy: wszystkie typy poleceń, przyjęte zakupy, karty z odpowiedzią domyślną i niedomyślną', () => {
    const { log } = season.session.run!.record;
    const used = new Set(log.map((e) => e.cmd.type));
    expect(COMMAND_TYPES.filter((t) => !used.has(t)), 'typy poleceń, których brakuje w dzienniku').toEqual([]);
    const acceptedTypes = new Set(log.filter((e) => season.accepted.get(e.seq)).map((e) => e.cmd.type));
    for (const type of ['setOrder', 'movePallet', 'buyUpgrade', 'buyEquipment', 'hire', 'setStaffProfile', 'pinStaff', 'startRemont', 'tapPallet', 'tapTill', 'answerCard'] as const) {
      expect(acceptedTypes.has(type), `żadne polecenie ${type} nie zostało przyjęte`).toBe(true);
    }
    expect(season.session.econ.remontLevel, 'remont 1 przyjęty').toBeGreaterThan(0);
    expect(season.cards.some((c) => c.answer !== c.defaultAnswer), 'odpowiedź inna niż zaznaczona z góry').toBe(true);
    expect(season.cards.some((c) => c.answer === c.defaultAnswer), 'odpowiedź zaznaczona z góry').toBe(true);
    expect(season.cards.length, 'karty w sezonie').toBeGreaterThan(30);
    // każda odpowiedź na kartę jest przyjęta i stoi w dzienniku pod numerem, pod którym ją wydano
    for (const c of season.cards) {
      expect(log.find((e) => e.seq === c.logSeq)?.cmd).toEqual({ type: 'answerCard', seq: c.seq, answer: c.answer });
      expect(season.accepted.get(c.logSeq), `karta ${c.seq}`).toBe(true);
    }
    expect(season.session.econ.total.taps, 'stuknięcia').toBeGreaterThan(0);
    expect(season.session.econ.total.purchases, 'zakupy').toBeGreaterThan(0);
  });

  it('po każdym przeładowaniu strony (dzień 10, 45 na karcie i 86 po remoncie) żywy stan równa się odtworzeniu zapisanego dziennika', () => {
    expect(season.reloads).toHaveLength(RELOADS.length);
    for (const [i, r] of season.reloads.entries()) {
      const label = `przeładowanie ${i + 1} w minucie ${r.minute}`;
      expect(r.minute, label).toBeGreaterThanOrEqual(RELOADS[i]!.minute);
      expect(r.sameSession, `${label}: nowa sesja, nie ta sama`).toBe(false);
      expect(r.sameLog, `${label}: dziennik z zapisu, nie ta sama tablica`).toBe(false);
      expect(r.fromSave, label).toBe(true);
      expect(r.logLengthAfter, `${label}: dziennik z zapisu ma tyle wpisów co przed zapisem`).toBe(r.storedLogLength);
      expect(r.replayed, `${label}: stan wczytanej sesji różni się od odtworzenia zapisanego dziennika`).toEqual(r.loaded);
    }
    expect(season.reloads[0]!.remontLevel, 'pierwsze przeładowanie jest przed remontem').toBe(0);
    expect(season.reloads[1]!.waiting, 'drugie przeładowanie: gra stoi na karcie').toBe(true);
    expect(season.reloads[1]!.pendingCards, 'drugie przeładowanie: karta czeka na odpowiedź').toBeGreaterThan(0);
    expect(season.reloads[2]!.remontLevel, 'trzecie przeładowanie jest po remoncie').toBeGreaterThan(0);
    expect(season.reloads[2]!.waiting).toBe(false);
  });

  it('numer wpisu dziennika (run.seq) po przeładowaniu idzie dalej bez dziury i bez powtórki', () => {
    for (const [i, r] of season.reloads.entries()) {
      const label = `przeładowanie ${i + 1}`;
      expect(r.storedSeq, `${label}: zapis niesie seq sprzed przeładowania`).toBe(r.seqBefore);
      expect(r.seqAfter, label).toBe(r.seqBefore);
      expect(r.logLengthAfter, label).toBe(r.logLengthBefore);
      expect(r.seqAfter, `${label}: seq to liczba wpisów`).toBe(r.logLengthAfter);
    }
    const { log } = season.session.run!.record;
    expect(log.map((e) => e.seq), 'seq całego dziennika to 0, 1, 2, …').toEqual(log.map((_, i) => i));
    expect(season.session.run!.seq).toBe(log.length);
    // minuty nie maleją, także na szwach przeładowań
    expect(log.every((e, i) => i === 0 || e.minute >= log[i - 1]!.minute)).toBe(true);
  });

  it('koniec sezonu: wynik z gry to wynik z odtworzenia, liczba całkowita, a rekord ma wersje i tryb rankingowy', () => {
    expect(finished.score).toBe(seasonScore(season.session.econ));
    expect(finished.score).toBe(seasonScore(replayedEnd));
    expect(replayedEnd, 'żywy stan końca sezonu równa się odtworzeniu całego dziennika').toEqual(season.session.econ);
    expect(replayedEnd.gameOver, 'odtworzony bieg przeżył sezon: inaczej sędzia odrzuciłby go jako season-bankrupt').toBe(false);
    expect(replayedEnd.minute).toBe(END);
    expect(Number.isFinite(finished.score)).toBe(true);
    expect(Number.isInteger(finished.score)).toBe(true);
    expect(finished).toMatchObject({ v: 1, seed: SEED, finishedAt: NOW });
    expect(finished.record).toMatchObject({ seed: SEED, mode: 'ranked', simVersion: SIM_VERSION, generatorVersion: GENERATOR_VERSION });
    expect(finished.record.log.length, 'ten sam dziennik co w sesji').toBe(season.session.run!.record.log.length);
    expect(finished.record.log.every((e) => e.minute < END), 'wszystkie polecenia sprzed końca sezonu').toBe(true);
  });

  it('serwer przyjmuje bieg z szuflady: ciało mieści się w limicie, parser oddaje ten sam bieg, a sędzia daje dokładnie wynik z gry', async () => {
    // klient wysyła to, co leży w szufladzie niewysłanego biegu (`pendingFinished`), a nie obiekt prosto z `finishRun`
    expect(saveFinished(finished), 'saveFinished').toBe(true);
    const drawer = pendingFinished();
    expect(drawer, 'szuflada oddaje ten sam bieg').toEqual(finished);
    expect(loadFinished()).toEqual(finished);

    const wire = JSON.stringify({ key: KEY, nick: NICK, run: drawer!.record });
    expect(Buffer.byteLength(wire), 'rozmiar ciała POST /api/runs').toBeLessThan(RUN_MAX_BODY_BYTES);

    const parsed = parseSubmission(JSON.parse(wire));
    if (!parsed.ok) throw new Error(`parseSubmission odrzucił bieg z gry: ${JSON.stringify(parsed)}`);
    expect(parsed.value.nick).toBe(NICK);
    expect(parsed.value.run, 'bieg po drodze przez szufladę, JSON i parser').toEqual(finished.record);
    expect(parsed.value.run.log).toHaveLength(finished.record.log.length);

    // sędzia tak jak w `makeBundleVerifier`: z regułą bankructwa (bieg z gameOver przed ostatnim raportem nie wchodzi do rankingu)
    const verify = makeReplayVerifier({ replay: replayRun, endMinute: END, score: seasonScore, bankrupt: seasonBankrupt });
    expect(await verify(parsed.value.run)).toEqual({ ok: true, score: finished.score });
    expect(replayRun(parsed.value.run, END).gameOver).toBe(false);
  }, TIMEOUT);

  it('kontrola negatywna: bez ostatniego przyjętego zakupu albo niedomyślnej odpowiedzi na kartę odtworzenie wychodzi inne', () => {
    const nonDefault = new Set(season.cards.filter((c) => c.answer !== c.defaultAnswer).map((c) => c.logSeq));
    const matters = (e: LogEntry): boolean =>
      season.accepted.get(e.seq) === true && (e.cmd.type === 'buyUpgrade' || e.cmd.type === 'buyEquipment' || nonDefault.has(e.seq));
    const dropped = [...finished.record.log].reverse().find(matters);
    expect(dropped, 'w dzienniku jest przyjęty zakup albo niedomyślna odpowiedź').toBeDefined();

    const without: RunRecord = { ...finished.record, log: finished.record.log.filter((e) => e !== dropped) };
    expect(without.log).toHaveLength(finished.record.log.length - 1);
    const state = replayRun(without, END);
    const sameScore = seasonScore(state) === finished.score;
    const sameState = JSON.stringify(state) === JSON.stringify(replayedEnd);
    expect(sameScore && sameState, `usunięty wpis ${JSON.stringify(dropped)} nie zmienił ani wyniku, ani stanu: porównanie wyniku byłoby puste`).toBe(false);
  }, TIMEOUT);
});
