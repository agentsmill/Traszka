import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { COMMAND_TYPES, isCommand, type Command } from '@/sim/economy/commands';
import { RANKED_SEASON_END_MINUTE, RANKED_SEASON_MONTHS, seasonScore } from '@/sim/ranked';
import { freshRun, replayRun, type LogEntry, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';

/**
 * „Złote odtworzenie”: stały bieg (seed + dziennik poleceń zbudowany w tym pliku) odtwarzany `replayRun` do kilku punktów
 * kontrolnych, a z kanonicznego JSON-a stanu w każdym z nich liczymy jeden skrót SHA-256. Serwer rankingu przyjmuje bieg, gdy jego
 * `simVersion` równa się `SIM_VERSION` (src/sim/simVersion.ts), więc ta sama wersja ma zawsze dawać ten sam wynik. Ktoś, kto zmieni
 * wynik symulacji (ekonomia, generator sklepu, polecenia, kolejność odtwarzania) i nie podbije wersji, zobaczy tu czerwony test
 * z nowym skrótem. Test nie czyta zegara ani `Math.random`, a bieg wynika wyłącznie z poniższych stałych.
 */

/**
 * Wersja symulacji → skrót odtworzenia stałego biegu (`digest`). Podbicie `SIM_VERSION` dopisuje tu nowy wpis; stare zostają
 * jako historia, bo pokazują, które wersje kiedykolwiek obowiązywały.
 */
const GOLDEN: Record<number, string> = {
  1: 'f782942df6a06a7b9cda5ef1c0e5678e9765faeccde5a6c16aa4efa8d9695d26',
};

const SEED = 'kiełbasa-42';
/** Dni biegu: 0…90, od 1 września do 30 listopada; sezon kończy się o 23:01 dnia 90. */
const DAYS = 91;
/** Czas oczekiwania na odtworzenie całego sezonu (kilka razy): przy obciążonej maszynie (cały zestaw równolegle) dłuższy niż domyślne 5 s. */
const TIMEOUT = 60_000;

/** Minuta gry: dzień od startu (dzień 0 = 1 września), godzina i minuta. */
const at = (day: number, hour: number, minute = 0): number => day * MINUTES_PER_DAY + hour * 60 + minute;

/** Punkty kontrolne (minuty gry): po tygodniu, po miesiącu, po dwóch miesiącach od startu i na końcu sezonu. Każdy odtwarzany od zera. */
const CHECKPOINTS: readonly number[] = [
  OPEN_FROM + 7 * MINUTES_PER_DAY,
  OPEN_FROM + 30 * MINUTES_PER_DAY,
  OPEN_FROM + 60 * MINUTES_PER_DAY,
  RANKED_SEASON_END_MINUTE,
];

// --- Dziennik poleceń ----------------------------------------------------------------------------------------------

/**
 * Stały generator (mulberry32) tylko do rozrzutu minut w dzienniku. Dziennik zależy od niego i od `PLAN`, nigdy od stanu
 * gry, więc zmiana ekonomii zmienia wynik odtworzenia, a nie dziennik.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wydatki i decyzje gracza w wybranych dniach (dzień, godzina, minuta, polecenie). Terminy dobrane do dzisiejszej ekonomii tak,
 * żeby każde polecenie poza zapasowymi było przyjęte: najpierw tanie ulepszenia i sprzęt, remont 1 (25 tys. zł, poziom 8), ulepszenia
 * po remoncie, remont 2 i 3 (80 i 200 tys. zł, poziomy 14 i 20). Każdy remont ma dwie próby: dziś przyjmowana jest pierwsza
 * (remonty 1 i 2) albo druga (remont 3), a odrzucona jest zapasem na zmiany ekonomii, nie błędem.
 * Palety startowe mają numery 1 i 2; sloty `equipmentSlot-1…3` (pojemność 2) są od układu 0, `equipmentSlot-4` od remontu 1.
 */
const PLAN: readonly (readonly [day: number, hour: number, minute: number, cmd: Command])[] = [
  // start: zamówienie ręczne, paleta na zaplecze, druga odesłana, priorytet kasy, pierwsza paczka od Centrali (okno od 14:00)
  [0, 6, 0, { type: 'setOrder', auto: false, manual: 6 }],
  [0, 6, 0, { type: 'movePallet', palletId: 1, loc: 'backroom' }],
  [0, 6, 1, { type: 'returnPallet', palletId: 2 }],
  [0, 6, 2, { type: 'setPriority', priority: 'klienci' }],
  [0, 6, 3, { type: 'tapPallet', palletId: 1 }],
  [0, 14, 10, { type: 'claimGift' }],
  // pierwsze inwestycje, jeszcze na układzie 0
  [1, 12, 0, { type: 'buyUpgrade', id: 'szkolenie' }],
  [2, 9, 0, { type: 'hire' }],
  [2, 12, 0, { type: 'buyUpgrade', id: 'ulotki' }],
  [3, 7, 0, { type: 'setOrder', auto: true }],
  [4, 12, 0, { type: 'buyEquipment', id: 'sco' }],
  [5, 12, 0, { type: 'buyUpgrade', id: 'wozek' }],
  [6, 12, 0, { type: 'campaign' }],
  [6, 12, 30, { type: 'setPriority', priority: 'palety' }],
  [7, 12, 0, { type: 'buyUpgrade', id: 'regaly' }],
  [9, 12, 0, { type: 'buyEquipment', id: 'bankomat' }],
  [10, 12, 0, { type: 'buyUpgrade', id: 'kawa' }],
  [11, 12, 0, { type: 'setOrder', auto: false, manual: 40 }],   // ponad granicę: stan przytnie do 30
  [12, 7, 0, { type: 'setOrder', auto: true, manual: 5.5 }],   // ułamek: stan zaokrągli
  [14, 12, 0, { type: 'buyEquipment', id: 'piec', slotId: 'equipmentSlot-2' }],
  [16, 12, 0, { type: 'buyUpgrade', id: 'ulotki' }],
  [18, 12, 0, { type: 'buyUpgrade', id: 'szkolenie' }],
  // remont 1 (po nim zmienia się układ, a odtwarzanie liczy dalej na nowym `info`)
  [26, 7, 0, { type: 'startRemont' }],
  [26, 7, 5, { type: 'rushRemont' }],
  [30, 7, 0, { type: 'startRemont' }],
  [30, 7, 5, { type: 'rushRemont' }],
  // ulepszenia i sprzęt po remoncie
  [34, 12, 0, { type: 'buyUpgrade', id: 'asystent' }],
  [35, 12, 0, { type: 'buyUpgrade', id: 'klima' }],
  [36, 12, 0, { type: 'buyUpgrade', id: 'scoSoft' }],
  [37, 12, 0, { type: 'buyUpgrade', id: 'kamery' }],
  [38, 12, 0, { type: 'buyUpgrade', id: 'drugaKasa' }],
  [40, 12, 0, { type: 'buyUpgrade', id: 'traszkapka' }],
  [42, 12, 0, { type: 'buyEquipment', id: 'paczkownik' }],
  [44, 12, 0, { type: 'buyUpgrade', id: 'nocne' }],
  [46, 12, 0, { type: 'hire' }],
  [48, 12, 0, { type: 'setPriority', priority: 'rowno' }],
  [50, 12, 0, { type: 'fire' }],
  [50, 12, 5, { type: 'setPriority', priority: 'klienci' }],
  [52, 12, 0, { type: 'buyUpgrade', id: 'rampa' }],
  [56, 12, 0, { type: 'buyUpgrade', id: 'tasmociag' }],
  // remonty 2 i 3
  [62, 7, 0, { type: 'startRemont' }],
  [62, 7, 5, { type: 'rushRemont' }],
  [66, 7, 0, { type: 'startRemont' }],
  [66, 7, 5, { type: 'rushRemont' }],
  [68, 12, 0, { type: 'buyUpgrade', id: 'wykladacz' }],
  [72, 12, 0, { type: 'buyUpgrade', id: 'dostawy2' }],
  [78, 12, 0, { type: 'campaign' }],
  [80, 12, 0, { type: 'buyEquipment', id: 'sco', slotId: 'equipmentSlot-4' }],
  [84, 7, 0, { type: 'startRemont' }],
  [84, 7, 5, { type: 'rushRemont' }],
  [86, 12, 0, { type: 'campaign' }],
  [87, 12, 0, { type: 'hire' }],
  [88, 7, 0, { type: 'startRemont' }],
  [88, 7, 5, { type: 'rushRemont' }],
];

/**
 * Dziennik biegu: `PLAN` plus rytm każdego dnia, czyli stuknięcia (rano po dostawie i w szczycie seriami w kolejnych minutach, żeby
 * ruszyło combo, reszta rozrzucona po godzinach otwarcia), próby odbioru zleceń i paczek od Centrali. Numery zleceń i palet, o
 * które nie ma jak zapytać stan, zgaduje przybliżony wzór: chybione próby `applyCommand` odrzuca, a trafione zmieniają wynik.
 * Wpisy dostają kolejne `seq` w kolejności minut, a tablica jest podana od końca, bo odtworzenie ma układać je po `(minute, seq)`,
 * a nie ufać kolejności w tablicy. Wszystko przed końcem sezonu (późniejsze serwer i tak odrzuca).
 */
function buildLog(): LogEntry[] {
  const rand = mulberry32(0x5eed1e);
  /** Minuta z przedziału [from, to). */
  const between = (from: number, to: number): number => from + Math.floor(rand() * (to - from));
  const planned: { minute: number; cmd: Command }[] = [];
  const add = (minute: number, cmd: Command): void => { planned.push({ minute, cmd }); };

  for (const [day, hour, minute, cmd] of PLAN) add(at(day, hour, minute), cmd);
  for (let day = 0; day < DAYS; day++) {
    for (let k = 0; k < 8; k++) add(at(day, 7, 2 + k), { type: 'tapPallet' });   // seria po dostawie o 7:00
    for (let k = 0; k < 5; k++) add(between(at(day, 7, 10), at(day, 10)), { type: 'tapPallet' });
    if (day < 10) add(at(day, 7, 30), { type: 'tapPallet', palletId: Math.round(5.4 * day) - 2 + between(0, 5) });   // ok. 5,4 palety dziennie
    for (let k = 0; k < 6; k++) add(at(day, 8, 5 + k), { type: 'tapTill' });   // seria w porannym szczycie
    for (let k = 0; k < 10; k++) add(between(at(day, 6), at(day, 23)), { type: 'tapTill' });
    if (day % 3 === 1) {
      const first = 1 + Math.floor(0.3 * day);   // zlecenia rodzą się wolniej niż mija czas: okno pięciu numerów wędruje za nimi
      for (let k = 0; k < 5; k++) add(at(day, 22, 30 + k), { type: 'claimQuest', questId: first + k });
    }
    for (const hour of [9, 15, 21]) add(at(day, hour), { type: 'claimGift' });   // okno paczki trwa 3 godziny
  }

  return planned
    .filter((p) => p.minute < RANKED_SEASON_END_MINUTE)
    .sort((a, b) => a.minute - b.minute)   // stabilne: remis minut zostaje w kolejności dodania
    .map((p, seq) => ({ minute: p.minute, seq, cmd: p.cmd }))
    .reverse();
}

const LOG: readonly LogEntry[] = buildLog();

// --- Skrót odtworzenia ----------------------------------------------------------------------------------------------

/**
 * Kanoniczny JSON: klucze obiektów posortowane (kod znaku, bez lokalizacji), `undefined` w obiekcie pominięty, `NaN` i
 * nieskończoności jako tekst (zwykły `JSON.stringify` zamieniłby je w `null`), liczby w najkrótszym zapisie, który się odczyta
 * bez straty. Rzuca na tym, co nie ma jednoznacznego zapisu (`Map`, `Set`, `Date`, funkcja…): stan ekonomii ma być zwykłym
 * JSON-em, a `Map` zapisana jako `{}` po cichu ukryłaby różnicę.
 */
function canonical(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`Stan ma obiekt, którego nie da się zapisać kanonicznie: ${Object.prototype.toString.call(value)}.`);
      }
      const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`Stan ma wartość, której nie da się zapisać kanonicznie: ${typeof value}.`);
  }
}

/** Bieg (seed + dziennik) w kształcie, jaki dostaje serwer. Dziennik kopiowany, żeby żaden test nie zależał od zmian w cudzej kopii. */
const runOf = (log: readonly LogEntry[]): RunRecord => ({ seed: SEED, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, mode: 'ranked', log: [...log] });

/**
 * Skrót SHA-256 z kanonicznego JSON-a stanów w punktach kontrolnych (każdy odtwarzany od zera) razem z wynikiem sezonu, jaki
 * policzyłby z nich serwer.
 */
function digest(log: readonly LogEntry[], checkpoints: readonly number[] = CHECKPOINTS): string {
  const points = checkpoints.map((minute) => {
    const state = replayRun(runOf(log), minute);
    return { minute, state, score: seasonScore(state) };
  });
  return createHash('sha256').update(canonical(points)).digest('hex');
}

/** Skrót pełnego biegu w punktach kontrolnych, liczony raz (czysta funkcja stałych, więc kolejność testów nie ma znaczenia). */
let fullDigest: string | undefined;
const goldenDigest = (): string => (fullDigest ??= digest(LOG));
/** Skrót samego końca sezonu pełnego dziennika (baza porównań w testach „bez tego polecenia”), też liczony raz. */
let endDigest: string | undefined;
const seasonDigest = (): string => (endDigest ??= digest(LOG, [RANKED_SEASON_END_MINUTE]));

// --- Testy ------------------------------------------------------------------------------------------------------------------------

describe('SIM_VERSION i tabela GOLDEN', () => {
  it('SIM_VERSION to dodatnia liczba całkowita', () => {
    expect(Number.isInteger(SIM_VERSION) && SIM_VERSION >= 1, `SIM_VERSION = ${SIM_VERSION}`).toBe(true);
  });

  it('dla SIM_VERSION jest wpis w GOLDEN', () => {
    expect(GOLDEN, `SIM_VERSION = ${SIM_VERSION} nie ma wpisu w GOLDEN: dopisz \`${SIM_VERSION}: '<skrót>'\`; skrót wypisuje test poniżej`)
      .toHaveProperty(String(SIM_VERSION));
  });

  it('GOLDEN nie ma wpisów dla wersji wyższych niż SIM_VERSION', () => {
    const ahead = Object.keys(GOLDEN).map(Number).filter((v) => v > SIM_VERSION);
    expect(ahead, 'wpis z przyszłej wersji: podbij SIM_VERSION w src/sim/simVersion.ts albo usuń wpis').toEqual([]);
  });

  it('każdy wpis GOLDEN to skrót SHA-256 zapisany szesnastkowo', () => {
    for (const [version, hash] of Object.entries(GOLDEN)) expect(hash, `wersja ${version}`).toMatch(/^[0-9a-f]{64}$/);
  });

  it('skrót odtworzenia stałego biegu równa się GOLDEN[SIM_VERSION]', () => {
    const actual = goldenDigest();
    const expected = GOLDEN[SIM_VERSION];
    // Po samym podbiciu SIM_VERSION (bez wpisu) wynik nie zmienił się od podbicia, więc podpowiedź mówi o brakującym wpisie dla tej wersji.
    const hint = expected === undefined
      ? `SIM_VERSION = ${SIM_VERSION} nie ma wpisu w GOLDEN. Dopisz \`${SIM_VERSION}: '${actual}'\`.`
      : `Wynik symulacji się zmienił. Jeśli to zamierzone, podbij SIM_VERSION w src/sim/simVersion.ts i dopisz \`${SIM_VERSION + 1}: '${actual}'\` do GOLDEN; jeśli nie, cofnij zmianę.`;
    expect(actual, hint).toBe(expected);
  }, TIMEOUT);
});

describe('dziennik stałego biegu naprawdę coś robi', () => {
  it('seed składa sklep, a wszystkie punkty kontrolne leżą w sezonie', () => {
    expect(() => freshRun(SEED)).not.toThrow();
    expect(CHECKPOINTS.every((m) => m > OPEN_FROM && m <= RANKED_SEASON_END_MINUTE)).toBe(true);
    expect(LOG.every((e) => e.minute < RANKED_SEASON_END_MINUTE)).toBe(true);
  });

  it('każdy wpis jest poprawnym poleceniem, a numery seq są różne', () => {
    expect(LOG.filter((e) => !isCommand(e.cmd))).toEqual([]);
    expect(new Set(LOG.map((e) => e.seq)).size).toBe(LOG.length);
  });

  it('dziennik używa każdego typu polecenia', () => {
    const used = new Set(LOG.map((e) => e.cmd.type));
    expect(
      COMMAND_TYPES.filter((t) => !used.has(t)),
      'Brakuje typu polecenia w dzienniku: dodaj go do PLAN w tym pliku i do COMMANDS w scripts/judge-worst-case.mjs (kopie planu są też w tests/judgeBundle.test.ts i scripts/ranking-smoke.mjs)',
    ).toEqual([]);
  });

  it('pusty dziennik daje inny skrót niż pełny', () => {
    expect(digest([])).not.toBe(goldenDigest());
  }, TIMEOUT);

  it('bieg dochodzi do końca sezonu, a w stanie końcowym widać skutki poleceń', () => {
    for (const minute of CHECKPOINTS) {
      const s = replayRun(runOf(LOG), minute);
      expect(s.gameOver, `bankructwo przed minutą ${minute}`).toBe(false);
      expect(s.minute).toBe(minute);
    }
    const s = replayRun(runOf(LOG), RANKED_SEASON_END_MINUTE);
    expect(s.history, 'raporty miesięczne sezonu').toHaveLength(RANKED_SEASON_MONTHS);
    expect(Object.keys(s.upgrades).length, 'kupione ulepszenia').toBeGreaterThan(0);
    expect(s.equipment.length, 'kupiony sprzęt').toBeGreaterThan(0);
    expect(s.remontLevel, 'remonty').toBeGreaterThan(0);
    expect(s.total.taps, 'stuknięcia').toBeGreaterThan(0);
    expect(s.total.purchases, 'zakupy').toBeGreaterThan(0);
    expect(s.staff, 'zatrudnienie i zwolnienie zmieniły załogę').not.toBe(replayRun(runOf([]), RANKED_SEASON_END_MINUTE).staff);
  }, TIMEOUT);

  it('kolejność wpisów w tablicy nie ma znaczenia, liczy się (minute, seq)', () => {
    const season = [RANKED_SEASON_END_MINUTE];
    expect(digest([...LOG].reverse(), season)).toBe(seasonDigest());
  }, TIMEOUT);

  // Bez któregoś typu wynik biegu musi być inny: polecenie jest w dzienniku, jest przyjmowane i wpływa na stan.
  it.each(COMMAND_TYPES)('%s: bez tego polecenia wynik biegu jest inny', (type) => {
    const season = [RANKED_SEASON_END_MINUTE];
    expect(
      digest(LOG.filter((e) => e.cmd.type !== type), season),
      `Polecenie ${type} nie zmienia wyniku biegu: ekonomia je odrzuca (zmieniły się ceny albo progi: popraw terminy w PLAN) albo nic nie robi`,
    ).not.toBe(seasonDigest());
  }, TIMEOUT);
});

describe('kanoniczny JSON skrótu', () => {
  it('nie zależy od kolejności wstawiania kluczy i zachowuje kolejność w tablicach', () => {
    const a = { b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } };
    const b = { a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 };
    expect(canonical(a)).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
    expect(canonical(a)).toBe(canonical(b));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });

  it('pomija undefined w obiekcie, a w tablicy zapisuje null', () => {
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
    expect(canonical([1, undefined])).toBe('[1,null]');
  });

  it('NaN, Infinity i -Infinity różnią się od siebie i od null', () => {
    const forms = [NaN, Infinity, -Infinity, null].map((x) => canonical({ x }));
    expect(new Set(forms).size).toBe(4);
  });

  it('rzuca na Map, Set, Date i funkcji, bo nie mają jednoznacznego zapisu', () => {
    for (const bad of [new Map([[1, 2]]), new Set([1]), new Date(0), () => 1, Symbol('x'), 1n]) {
      expect(() => canonical({ bad }), String(typeof bad)).toThrow(TypeError);
    }
  });
});
