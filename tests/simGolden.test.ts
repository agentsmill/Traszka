import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { COMMAND_TYPES, isCommand, type Command } from '@/sim/economy/commands';
import type { EconomyState } from '@/sim/economy/economy';
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
  2: 'de237366de4f5c764dde1bdbdd3f7adcc7fb7b80ff80673a4f73785a24e8cdca',   // C2: karty, profile i przypięcia załogi, KPI zamiast zleceń, bez prezentu
  3: '1c05f23716a31cb5f11cbb41a82f5f0eeebaf4e88f1b2d46456b39b4ce5aa79b',   // Straż z upomnieniem, limit asystenta, stukanie w kasę tylko gdy pomaga
  4: '16a2834398928b489f50dc3b39de8cf18a49e3c700a0e4fbfc058b3f381a2239',   // więcej klientów i fale, 6 palet, limit debetu, nowy balans opłaty i premii
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
 * Wydatki i decyzje gracza w wybranych dniach (dzień, godzina, minuta, polecenie). Terminy dobrane do ekonomii tak, żeby każde
 * polecenie poza zapasowymi było przyjęte, a bieg przetrwał sezon: gotówka po raporcie miesięcznym spada o opłatę franczyzową
 * (2000 zł + udział w obrocie), a gotówka poniżej granicy debetu (`DEBT_LIMIT`, −10 tys. zł) kończy grę od razu, więc droższe zakupy
 * idą we wrześniu (małe) i w listopadzie, a w październiku tylko kilka. Po wrześniu bieg wchodzi w strefę ostrzeżenia o debecie
 * (odtworzenie przechodzi też przez to zdarzenie). Trzecia osoba przychodzi dopiero w październiku: od SIM_VERSION 4 sklep na
 * start ma ludzi akurat na swój ruch, więc etat od drugiego dnia zjadał gotówkę na opłatę. Remont 1 (25 tys. zł, poziom 8) ma dwie próby: dziś przyjmowana jest
 * pierwsza, a druga jest zapasem na zmiany cen (rush bez trwającego remontu jest odrzucany, nie błędem).
 * Palety startowe mają numery 1 i 2; sloty `equipmentSlot-1…3` (pojemność 2) są od układu 0, `equipmentSlot-4` od remontu 1.
 */
const PLAN: readonly (readonly [day: number, hour: number, minute: number, cmd: Command])[] = [
  // start: zamówienie ręczne, paleta na zaplecze, druga odesłana, profil załogi, pierwsze stuknięcie
  [0, 6, 0, { type: 'setOrder', auto: false, manual: 6 }],
  [0, 6, 0, { type: 'movePallet', palletId: 1, loc: 'backroom' }],
  [0, 6, 1, { type: 'returnPallet', palletId: 2 }],
  [0, 6, 2, { type: 'setStaffProfile', profile: 'dostawa' }],
  [0, 6, 3, { type: 'tapPallet', palletId: 1 }],
  // pierwsze inwestycje, jeszcze na układzie 0
  [1, 12, 0, { type: 'buyUpgrade', id: 'szkolenie' }],
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
  // październik: kilka droższych zakupów i zmiany w załodze (reszta wydatków zostaje na listopad, bo opłata franczyzowa zjada gotówkę po raporcie)
  [40, 12, 0, { type: 'buyUpgrade', id: 'traszkapka' }],
  [41, 12, 0, { type: 'buyUpgrade', id: 'asystent' }],
  [45, 12, 0, { type: 'buyUpgrade', id: 'klima' }],
  [46, 12, 0, { type: 'hire' }],
  [48, 12, 0, { type: 'pinStaff', task: 'kasa', count: 1 }],
  [50, 12, 0, { type: 'fire' }],
  [50, 12, 5, { type: 'setStaffProfile', profile: 'kolejka' }],
  // listopad: kampania, remont 1 (dwie próby: zapas na zmiany cen) i zakupy po remoncie
  [78, 12, 0, { type: 'campaign' }],
  [84, 7, 0, { type: 'startRemont' }],
  [84, 7, 5, { type: 'rushRemont' }],
  [86, 12, 0, { type: 'campaign' }],
  [87, 12, 0, { type: 'hire' }],
];

/**
 * Odpowiedzi na karty dnia i okólniki: numer karty, jej id, dzień, godzina i minuta, od której jest widoczna, oraz numer wybranej
 * odpowiedzi (każda inna niż domyślna, bo domyślną symulacja zatwierdza sama). Wybrane raz tak, jak gra bot `decydent`
 * (`bestAnswer` z `BOT_VALUATION`), i zapisane na stałe: bieg z samymi odpowiedziami domyślnymi nie stać na remont przed końcem
 * sezonu bez zejścia poniżej granicy debetu. Karty losuje symulacja z seeda i numeru dnia, więc numery są stałe dla tego seeda i tej
 * ekonomii; po zmianie ekonomii mogą wskazywać inne karty (wtedy test „odpowiedzi trafiają w zamierzone karty” się czerwieni i trzeba
 * odczytać nową listę z `state.tycoon.cards`). Dziennik nie zależy od stanu w trakcie testu.
 */
const CARD_ANSWERS: readonly (readonly [seq: number, id: string, day: number, hour: number, minute: number, answer: number])[] = [
  [1, 'cenowki', 0, 11, 0, 0],
  [2, 'chory', 1, 6, 0, 0],
  [3, 'okolnik-ankieta', 2, 8, 0, 1],
  [4, 'fefo', 3, 18, 0, 1],
  [6, 'promocja', 4, 7, 0, 0],
  [8, 'glitch', 5, 10, 0, 0],
  [7, 'fefo', 5, 18, 0, 1],
  [10, 'ekspres', 7, 7, 30, 1],
  [11, 'lodowka', 7, 14, 0, 1],
  [12, 'ulewa', 8, 9, 0, 1],
  [13, 'okolnik-premia', 9, 8, 0, 0],
  [15, 'okolnik-refundacja', 11, 8, 0, 0],
  [16, 'audyt', 12, 9, 0, 0],
  [17, 'promocja', 13, 7, 0, 0],
  [18, 'fefo', 13, 18, 0, 1],
  [20, 'ulewa', 14, 9, 0, 1],
  [19, 'glitch', 14, 10, 0, 0],
  [21, 'okolnik-usmiech', 15, 8, 0, 0],
  [22, 'mecz', 16, 12, 0, 0],
  [23, 'fefo', 17, 18, 0, 1],
  [26, 'chory', 19, 6, 0, 0],
  [25, 'wiralowy', 19, 10, 0, 0],
  [28, 'lodowka', 21, 14, 0, 1],
  [29, 'okolnik-premia', 22, 8, 0, 0],
  [30, 'cenowki', 23, 11, 0, 0],
  [31, 'okolnik-refundacja', 24, 8, 0, 0],
  [32, 'influencer', 25, 15, 0, 0],
  [33, 'okolnik-usmiech', 26, 8, 0, 0],
  [34, 'fefo', 27, 18, 0, 1],
  [35, 'glitch', 28, 10, 0, 0],
  [36, 'fefo', 29, 18, 0, 1],
  [37, 'okolnik-premia', 30, 8, 0, 0],
  [38, 'wiralowy', 31, 10, 0, 0],
  [39, 'okolnik-ankieta', 32, 8, 0, 1],
  [40, 'fefo', 32, 18, 0, 1],
  [41, 'chory', 34, 6, 0, 0],
  [42, 'promocja', 34, 7, 0, 0],
  [43, 'glitch', 35, 10, 0, 0],
  [44, 'okolnik-refundacja', 36, 8, 0, 0],
  [45, 'mecz', 37, 12, 0, 0],
  [47, 'sejf', 39, 21, 0, 0],
  [49, 'fefo', 41, 18, 0, 1],
  [50, 'okolnik-usmiech', 42, 8, 0, 0],
  [51, 'lodowka', 43, 14, 0, 1],
  [52, 'fefo', 43, 18, 0, 1],
  [53, 'chory', 44, 6, 0, 0],
  [54, 'wiralowy', 44, 10, 0, 0],
  [55, 'ekspres', 45, 7, 30, 1],
  [57, 'okolnik-premia', 46, 8, 0, 0],
  [58, 'cenowki', 47, 11, 0, 0],
  [59, 'memy', 48, 13, 0, 0],
  [60, 'fefo', 49, 18, 0, 1],
  [61, 'okolnik-ankieta', 50, 8, 0, 1],
  [63, 'promocja', 51, 7, 0, 0],
  [62, 'ulewa', 51, 9, 0, 1],
  [64, 'okolnik-refundacja', 52, 8, 0, 0],
  [66, 'chory', 53, 6, 0, 0],
  [65, 'fefo', 53, 18, 0, 1],
  [67, 'glitch', 54, 10, 0, 0],
  [68, 'audyt', 55, 9, 0, 0],
  [69, 'lodowka', 55, 14, 0, 1],
  [70, 'okolnik-usmiech', 56, 8, 0, 0],
  [71, 'promocja', 57, 7, 0, 0],
  [72, 'okolnik-premia', 58, 8, 0, 0],
  [73, 'influencer', 59, 15, 0, 0],
  [74, 'memy', 60, 13, 0, 0],
  [75, 'chory', 61, 6, 0, 0],
  [77, 'okolnik-refundacja', 64, 8, 0, 0],
  [79, 'widmo', 65, 7, 10, 0],
  [78, 'ekspres', 65, 7, 30, 1],
  [81, 'ulewa', 68, 9, 0, 1],
  [82, 'mecz', 69, 12, 0, 0],
  [83, 'okolnik-premia', 70, 8, 0, 0],
  [84, 'widmo', 71, 7, 10, 0],
  [85, 'okolnik-usmiech', 72, 8, 0, 0],
  [86, 'fefo', 72, 18, 0, 1],
  [87, 'audyt', 73, 9, 0, 0],
  [88, 'chory', 74, 6, 0, 0],
  [89, 'memy', 74, 13, 0, 0],
  [90, 'promocja', 75, 7, 0, 0],
  [91, 'fefo', 75, 18, 0, 1],
  [92, 'okolnik-refundacja', 76, 8, 0, 0],
  [94, 'okolnik-ankieta', 78, 8, 0, 1],
  [95, 'widmo', 79, 7, 10, 0],
  [96, 'mecz', 79, 12, 0, 0],
  [98, 'cenowki', 81, 11, 0, 0],
  [99, 'fefo', 81, 18, 0, 1],
  [100, 'promocja', 82, 7, 0, 0],
  [101, 'ekspres', 82, 7, 30, 1],
  [102, 'ulewa', 83, 9, 0, 1],
  [103, 'fefo', 83, 18, 0, 1],
  [104, 'okolnik-premia', 84, 8, 0, 0],
  [106, 'chory', 85, 6, 0, 0],
  [107, 'ulewa', 86, 9, 0, 1],
  [108, 'okolnik-usmiech', 87, 8, 0, 0],
  [109, 'influencer', 87, 15, 0, 0],
  [110, 'fefo', 90, 18, 0, 1],
];

/**
 * Dziennik biegu: `PLAN`, odpowiedzi na karty (`CARD_ANSWERS`) i rytm każdego dnia, czyli stuknięcia (rano po dostawie i w szczycie
 * seriami w kolejnych minutach, żeby ruszyło combo, reszta rozrzucona po godzinach otwarcia). Numery palet, o które nie ma jak
 * zapytać stan, zgaduje przybliżony wzór: chybione próby `applyCommand` odrzuca, a trafione zmieniają wynik.
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
  for (const [seq, , day, hour, minute, answer] of CARD_ANSWERS) add(at(day, hour, minute), { type: 'answerCard', seq, answer });
  for (let day = 0; day < DAYS; day++) {
    for (let k = 0; k < 8; k++) add(at(day, 7, 2 + k), { type: 'tapPallet' });   // seria po dostawie o 7:00
    for (let k = 0; k < 5; k++) add(between(at(day, 7, 10), at(day, 10)), { type: 'tapPallet' });
    if (day < 10) add(at(day, 7, 30), { type: 'tapPallet', palletId: Math.round(5.4 * day) - 2 + between(0, 5) });   // ok. 5,4 palety dziennie
    for (let k = 0; k < 6; k++) add(at(day, 8, 5 + k), { type: 'tapTill' });   // seria w porannym szczycie
    for (let k = 0; k < 10; k++) add(between(at(day, 6), at(day, 23)), { type: 'tapTill' });
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

/** Skrót SHA-256 z kanonicznego JSON-a stanów w punktach kontrolnych razem z wynikiem sezonu, jaki policzyłby z nich serwer. */
function digestOf(checkpoints: readonly number[], states: readonly EconomyState[]): string {
  const points = checkpoints.map((minute, i) => ({ minute, state: states[i]!, score: seasonScore(states[i]!) }));
  return createHash('sha256').update(canonical(points)).digest('hex');
}

/** Skrót stanów w punktach kontrolnych (każdy odtwarzany od zera). */
function digest(log: readonly LogEntry[], checkpoints: readonly number[] = CHECKPOINTS): string {
  return digestOf(checkpoints, checkpoints.map((minute) => replayRun(runOf(log), minute)));
}

/** Stany pełnego dziennika w punktach kontrolnych, odtwarzane raz (czysta funkcja stałych; testy tylko je czytają). */
let fullStates: EconomyState[] | undefined;
const checkpointStates = (): EconomyState[] => (fullStates ??= CHECKPOINTS.map((minute) => replayRun(runOf(LOG), minute)));
/** Skrót pełnego biegu w punktach kontrolnych, liczony raz. */
const goldenDigest = (): string => digestOf(CHECKPOINTS, checkpointStates());
/** Skrót samego końca sezonu pełnego dziennika (baza porównań w testach „bez tego polecenia”): ostatni punkt kontrolny, więc bez drugiego odtwarzania. */
const seasonDigest = (): string => digestOf([RANKED_SEASON_END_MINUTE], [checkpointStates()[CHECKPOINTS.length - 1]!]);

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
    CHECKPOINTS.forEach((minute, i) => {
      const s = checkpointStates()[i]!;
      expect(s.gameOver, `bankructwo przed minutą ${minute}`).toBe(false);
      expect(s.minute).toBe(minute);
    });
    const s = checkpointStates()[CHECKPOINTS.length - 1]!;
    expect(s.history, 'raporty miesięczne sezonu').toHaveLength(RANKED_SEASON_MONTHS);
    expect(Object.keys(s.upgrades).length, 'kupione ulepszenia').toBeGreaterThan(0);
    expect(s.equipment.length, 'kupiony sprzęt').toBeGreaterThan(0);
    expect(s.remontLevel, 'remonty').toBeGreaterThan(0);
    expect(s.total.taps, 'stuknięcia').toBeGreaterThan(0);
    expect(s.total.purchases, 'zakupy').toBeGreaterThan(0);
    expect(s.staff, 'zatrudnienie i zwolnienie zmieniły załogę').not.toBe(replayRun(runOf([]), RANKED_SEASON_END_MINUTE).staff);
  }, TIMEOUT);

  it('odpowiedzi na karty trafiają w zamierzone karty (w oknie ostatnich rozstrzygnięć każdego punktu kontrolnego)', () => {
    let checked = 0;
    CHECKPOINTS.forEach((minute, i) => {
      const logged = new Map(checkpointStates()[i]!.tycoon.cards.log.map((l) => [l.seq, l]));
      for (const [seq, id, day, hour, min, answer] of CARD_ANSWERS) {
        const entry = logged.get(seq);
        if (entry === undefined || at(day, hour, min) >= minute) continue;   // karta poza oknem pamięci stanu albo jeszcze nie odpowiedziana
        expect(entry, `karta ${seq}: oczekiwano „${id}” z odpowiedzią ${answer}; numery kart się przesunęły, odczytaj nową listę ze stanu`)
          .toMatchObject({ id, answer });
        checked++;
      }
    });
    expect(checked, 'żadna odpowiedź z dziennika nie została sprawdzona: okno pamięci kart nie sięga tak daleko').toBeGreaterThanOrEqual(CARD_ANSWERS.length / 2);
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
