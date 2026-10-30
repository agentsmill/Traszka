import { CATS } from '@/sim/economy/catalog';
import { createEconomy, effects, relayout, type EconomyState } from '@/sim/economy/economy';
import { sanitizeEconomy } from '@/sim/economy/sanitize';
import { computeStoreInfo, palletPlace, type StoreInfo } from '@/sim/economy/storeInfo';
import { REMONTS } from '@/sim/economy/upgrades';
import type { EconClock } from '@/sim/economy/clock';
import { isRec, whole } from '@/sim/guards';
import type { RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { layoutFor } from '@/sim/store/layoutFor';
import { sanitizeLayout } from '@/sim/store/sanitize';
import type { StoreLayout } from '@/sim/store/types';
import { GAME_VERSION } from './version';

/**
 * Dziennik poleceń sesji: `RunRecord` z wpisami `{minute, seq, cmd}` i numer następnego wpisu. `replayRun(record, minute)`
 * odtwarza z niego stan gry, ale tylko dla sesji, która zaczęła od świeżego sklepu i której stan zmieniały wyłącznie
 * polecenia i upływ minut (patrz `GameSession.run`). Niezmiennik: sesja, która ma `run`, jest odtwarzalna, czyli
 * `replayRun(run.record, minuta)` daje jej stan co do bajtu. Dlatego gra z premią sieci sklepów (`partner`) dziennika nie ma:
 * odtwarzanie startuje przez `freshRun` bez partnera, a `RunRecord` nie niesie pola `partner`.
 */
export interface RunLog {
  record: RunRecord;
  seq: number;
}

/**
 * Ile wpisów dziennik trzyma najwyżej (ok. 1,8 MB pamięci: wpis `{minute, seq, cmd}` to ok. 90 bajtów). Dłuższa gra zwykła (`casual`)
 * traci dziennik (`run` = null): rósłby bez końca, a gracz nic z niego nie ma. O formie trwałego dziennika (co zostaje, jak kodowany)
 * zdecyduje B2; do tego czasu limit ma tylko chronić pamięć telefonu.
 */
export const RUN_LOG_MAX = 20_000;

/**
 * Rezerwa dziennika biegu rankingowego dla poleceń innych niż stuknięcia. `dispatchCommand` loguje także polecenia odrzucone (serwer
 * odtwarza je tak samo), więc zmęczenie ogranicza przyjęte stuknięcia, ale nie liczbę wpisów: gracz stukający bez sił mógłby zapełnić
 * dziennik do `RUN_LOG_MAX`, a wtedy bieg odmawiałby wszystkiego, także odpowiedzi na kartę, i sezon by stanął. Dlatego w biegu rankingowym
 * stuknięcia (`tapPallet`, `tapTill`) kończą się na `RANKED_TAP_LOG_MAX` wpisach, a zakupy, karty i reszta mają jeszcze `RANKED_LOG_RESERVE`.
 */
export const RANKED_LOG_RESERVE = 4_000;
export const RANKED_TAP_LOG_MAX = RUN_LOG_MAX - RANKED_LOG_RESERVE;

/** Rozgrywka jednego sklepu: stan ekonomii i układ, w którym się toczy (po remoncie układ się zmienia). */
export interface GameSession {
  seed: string;
  /**
   * Rodzaj rozgrywki: zwykła (`casual`, zapis pod `traszka:save:<seed>`) albo bieg rankingowy (`ranked`, jeden aktywny zapis pod
   * `traszka:ranked`, patrz `rankedRun.ts`). Sesja rankingowa ma dziennik poleceń (`run`), z którego serwer odtworzy bieg.
   */
  mode: 'casual' | 'ranked';
  econ: EconomyState;
  layout: StoreLayout;
  info: StoreInfo;
  clock: EconClock;
  /** Poziom remontu, dla którego policzono `layout`. */
  layoutLevel: number;
  /** Stan pochodzi z zapisu w przeglądarce (a nie z nowej gry). */
  fromSave: boolean;
  /** Komunikat dla gracza po otwarciu sklepu (np. uszkodzony zapis poszedł do kopii) albo null. */
  loadNotice: string | null;
  /** Sklep zamknięty w sieci: jego zapis skasowano i nic go już nie zapisze (patrz `retireSession`). */
  retired: boolean;
  /**
   * Sklep tymczasowy: nic go nie zapisze ani nie skasuje zapisu pod jego seedem. Taką sesją gra otwiera się wtedy, gdy zapis
   * pod tym seedem jest cudzy (z nowszej wersji gry) i nie wolno go ruszyć, a gracz i tak ma dostać działającą grę.
   */
  ephemeral: boolean;
  /**
   * Dziennik poleceń tej rozgrywki (zapisuje go `dispatchCommand`) albo null, gdy nie da się go prowadzić wiernie. Jeśli nie jest
   * null, `replayRun` odtwarza z niego stan sesji (patrz `RunLog`). Jest null, gdy: stan nie zaczął się od świeżego sklepu bez
   * premii sieci (sesja z zapisu, gra z niezerowym `partner`), został przestawiony `relayout` (`withLayoutFromSeed`), zmieniło go
   * coś spoza dziennika (nagroda powitalna, `skip`: `markOffLog`) albo dziennik przekroczył `RUN_LOG_MAX`.
   */
  run: RunLog | null;
}

/**
 * Czy premia sieci sklepów jest zerowa, tak jak w `freshRun`. Gospodarkę zmieniają `points` (mnożniki w `effects`) oraz
 * `networkIncome` (dochód dzienny w `closeDay`). `stores` niczego w symulacji nie liczy, ale leży w stanie
 * (`EconomyState.partner`), więc i ono musi być zerem, żeby odtworzony stan zgadzał się co do bajtu. Brak `partner` to zera.
 */
const noPartner = (partner?: EconomyState['partner']): boolean =>
  partner === undefined || (partner.points === 0 && partner.networkIncome === 0 && partner.stores === 0);

/**
 * Pusty dziennik nowej gry od świeżego sklepu z seeda, z wersjami gry, generatora i symulacji (`SIM_VERSION`), którymi go prowadzimy.
 * Domyślnie bieg zwykły (`casual`); tryb rankingowy (`ranked`) podaje ten, kto zaczyna bieg do rankingu. `simVersion` wpisuje tu
 * gra przy starcie biegu, a porównuje ją dopiero sędzia na serwerze (patrz `RunRecord`).
 */
export const newRunLog = (seed: string, mode: RunRecord['mode'] = 'casual'): RunLog => ({
  record: { seed, gameVersion: GAME_VERSION, generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode, log: [] },
  seq: 0,
});

// --- Zapis w przeglądarce ----------------------------------------------------------------------------------------

const SAVE_PREFIX = 'traszka:save:';
const LAST_KEY = 'traszka:last';
const BROKEN_SUFFIX = ':broken';

/**
 * Koperta zapisu (spec §14.1: seed + wersja gry + pełny stan, łącznie z wygenerowanym światem). Układ sklepu jest w
 * zapisie, więc zmiana generatora nie podmienia graczowi sklepu pod postępem; po remoncie nowy układ zastępuje stary.
 * Schemat 1 to sam `EconomyState` (bez koperty): wczytujemy go i przy pierwszym zapisie zamieniamy na schemat 2.
 */
export const SAVE_SCHEMA = 2;
export interface SaveEnvelope {
  schema: typeof SAVE_SCHEMA;
  gameVersion: string;
  generatorVersion: number;
  seed: string;
  layout: StoreLayout;
  econ: EconomyState;
}

export const BROKEN_SAVE_NOTICE = 'Zapis sklepu był uszkodzony — zaczynamy od nowa. Kopia została w przeglądarce.';
export const BROKEN_SAVE_NOTICE_NO_COPY = 'Zapis sklepu był uszkodzony — zaczynamy od nowa.';
export const NEWER_SAVE_NOTICE = 'Zapis pochodzi z nowszej wersji gry — odśwież stronę';
export const UNBUILDABLE_SAVE_NOTICE = 'Nie udało się zbudować Twojego sklepu — zapis jest bezpieczny, spróbuj odświeżyć stronę';

/** Koperta zapisu sesji: seed, wersje gry i generatora, układ i pełny stan. Tę samą kopertę ma zapis biegu rankingowego (`rankedRun.ts`). */
export const envelopeOf = (s: GameSession): SaveEnvelope => ({
  schema: SAVE_SCHEMA, gameVersion: GAME_VERSION, generatorVersion: GENERATOR_VERSION, seed: s.seed, layout: s.layout, econ: s.econ,
});

/**
 * Zapis w przeglądarce (localStorage). Błędy (tryb prywatny, brak miejsca) są ciche: gra działa dalej bez zapisu. Sesja rankingowa
 * (`mode: 'ranked'`) nie ma tu zapisu: jej bieg żyje pod własnym kluczem (`saveRanked` w `rankedRun.ts`), a zwykły sklep o tym samym
 * seedzie i `traszka:last` zostają, jak były.
 */
export function saveSession(s: GameSession): void {
  if (s.retired || s.ephemeral || s.mode === 'ranked') return;
  const envelope = envelopeOf(s);
  try {
    localStorage.setItem(SAVE_PREFIX + s.seed, JSON.stringify(envelope));
    localStorage.setItem(LAST_KEY, s.seed);
  } catch {
    // bez zapisu
  }
}

export function lastSavedSeed(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function deleteSave(seed: string): void {
  try {
    localStorage.removeItem(SAVE_PREFIX + seed);
  } catch {
    // nic
  }
}

/**
 * Zamknięcie sklepu w sieci (otwarcie kolejnej Traszki): zapis znika, a sesja nie zapisze się już nigdy, nawet jeśli ktoś
 * jeszcze zawoła `saveSession` (zmiana sklepu zapisuje „bieżący” sklep, zanim przełączy świat). `reviveSession` cofa to,
 * gdy nowy sklep się nie otworzył.
 */
export function retireSession(s: GameSession): void {
  s.retired = true;
  discardSave(s);
}

/**
 * Kasuje zapis sklepu sesji („zacznij od nowa”, zamknięcie w sieci). Sklep tymczasowy nie ma własnego zapisu, więc cudzego nie rusza;
 * sesja rankingowa też nie (jej bieg kasuje `discardRanked`), więc zwykły sklep o tym samym seedzie zostaje.
 */
export function discardSave(s: GameSession): void {
  if (!s.ephemeral && s.mode !== 'ranked') deleteSave(s.seed);
}

export function reviveSession(s: GameSession): void {
  s.retired = false;
  saveSession(s);
}

/** Przenosi zapis, którego nie da się użyć, do kopii `<klucz>:broken` i zwalnia jego miejsce. Zwraca, czy kopia powstała. */
function moveToBroken(seed: string, raw: string): boolean {
  let backedUp = false;
  try {
    localStorage.setItem(SAVE_PREFIX + seed + BROKEN_SUFFIX, raw);
    backedUp = true;
  } catch {
    // brak miejsca na kopię
  }
  deleteSave(seed);
  return backedUp;
}

/** Czy pod seedem leży jakikolwiek zapis (poprawny, z nowszej wersji, uszkodzony). Gdy sklepu nie da się otworzyć, mówi, czy jest co chronić. */
export function hasStoredSave(seed: string): boolean {
  try {
    return localStorage.getItem(SAVE_PREFIX + seed) !== null;
  } catch {
    return false;
  }
}

type ReadResult =
  | { status: 'none' }
  | { status: 'ok'; session: GameSession }
  | { status: 'broken'; backedUp: boolean }
  | { status: 'newer' }
  | { status: 'unbuildable' };

/** Zapis z nowszej wersji gry: schemat wyższy niż ten, który umiemy czytać. Nie wiemy, co w nim jest, więc go nie ruszamy. */
const isNewerSchema = (data: unknown): boolean => isRec(data) && typeof data.schema === 'number' && data.schema > SAVE_SCHEMA;

/**
 * Czyta zapis sklepu. Do kopii (`:broken`) idzie tylko to, co nie przeszło parsowania albo walidacji: takiego zapisu nie
 * naprawiamy na siłę, a wołający zaczyna nową grę. Zapis, który walidację przeszedł, a świat z niego się nie złożył
 * (generator, układ), jest dobry: zostaje na miejscu, a wołający dostaje `unbuildable`.
 */
function readSave(seed: string, partner?: EconomyState['partner']): ReadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVE_PREFIX + seed);
  } catch {
    return { status: 'none' };
  }
  if (raw === null) return { status: 'none' };
  try {
    const data = JSON.parse(raw) as unknown;
    if (isNewerSchema(data)) return { status: 'newer' };
    const opened = restoreSessionFrom(data, seed, partner);
    if (opened.ok) return { status: 'ok', session: opened.session };
    if (opened.reason === 'unbuildable') return { status: 'unbuildable' };
  } catch (error) {
    console.error(`Zapis sklepu „${seed}” nie dał się wczytać.`, error);
  }
  return { status: 'broken', backedUp: moveToBroken(seed, raw) };
}

export type Opened = { ok: true; session: GameSession } | { ok: false; reason: 'invalid' | 'unbuildable' };

/**
 * Czy stan ekonomii pasuje do układu: palety i sprzęt stoją w miejscach, które istnieją, a zapas mieści się na półkach i
 * zapleczu. Prawdziwy zapis zawsze pasuje do swojego układu; nie pasuje po ręcznej zmianie albo po przejściu na inny
 * układ (druga próba z seeda), i wtedy `relayout` ustawia wszystko od nowa.
 */
function fitsStore(econ: EconomyState, info: StoreInfo): boolean {
  const eps = 1e-6;
  return econ.pallets.every((p) => palletPlace(info, p.loc, p.spot) !== null)
    && econ.equipment.every((e) => e.slot === null || info.slots.some((slot) => slot.id === e.slot))
    && CATS.every((c) => econ.shelf[c] <= info.shelfCap[c] + eps)
    && CATS.reduce((n, c) => n + econ.backroom[c], 0) <= effects(econ, info).backroomCap + eps;
}

/**
 * Sesja z zapisu w schemacie 2 albo 1. Zapisany układ zostaje; schemat 1 i uszkodzony układ dostają układ z seeda i poziomu
 * remontu, dokładnie jak przed kopertą. Niczego nie zapisuje: nowy format (schemat 2, nowy układ) trafia do przeglądarki
 * dopiero przy pierwszym `saveSession` po zbudowaniu świata, więc zapis zostaje, jakim był, gdyby świat nie stanął.
 * Dwa rodzaje porażki:
 * - `invalid`: zapis nie przeszedł walidacji (zła koperta, cudzy seed, lista tam, gdzie ma być obiekt…);
 * - `unbuildable`: zapis jest poprawny, ale świata z niego nie dało się złożyć (generator, opis układu). Zapisany układ ma
 *   wtedy jedną dodatkową próbę z układem z seeda; gdy i ta zawiedzie, zapis nie jest winny i nikt go nie rusza.
 * Wyeksportowana dla biegu rankingowego (`rankedRun.ts`), który składa stan z własnego klucza zapisu: sesja wychodzi tu zawsze jako
 * zwykła (`mode: 'casual'`, `run: null`), a tryb i dziennik ustawia wołający.
 */
export function restoreSessionFrom(data: unknown, seed: string, partner?: EconomyState['partner']): Opened {
  const invalid: Opened = { ok: false, reason: 'invalid' };
  const unbuildable: Opened = { ok: false, reason: 'unbuildable' };
  if (!isRec(data)) return invalid;
  let storedEcon: unknown;
  let storedLayout: unknown = null;
  if (data.schema === SAVE_SCHEMA) {
    if (data.seed !== seed) return invalid;
    storedEcon = data.econ;
    storedLayout = data.layout;
  } else if (data.schema === undefined && data.version === 1) {
    storedEcon = data;
  } else {
    return invalid;
  }
  if (!isRec(storedEcon)) return invalid;

  const level = whole(storedEcon.remontLevel, 0, 0, REMONTS.length);
  const stored = sanitizeLayout(storedLayout);
  const parts = (known: StoreLayout | null): { layout: StoreLayout; info: StoreInfo; defaults: EconomyState } => {
    const layout = known ?? layoutFor(seed, level);
    const info = computeStoreInfo(layout);
    return { layout, info, defaults: createEconomy(seed, info, partner) };
  };
  let world: ReturnType<typeof parts>;
  try {
    world = parts(stored);
  } catch (error) {
    console.error(`Układ sklepu „${seed}” nie dał się zbudować.`, error);
    if (stored === null) return unbuildable;   // układ z seeda to już była druga próba
    try {
      world = parts(null);
    } catch (again) {
      console.error(`Układ sklepu „${seed}” z seeda też się nie zbudował.`, again);
      return unbuildable;
    }
  }

  const econ = sanitizeEconomy(storedEcon, world.defaults, world.info);
  if (!econ) return invalid;
  try {
    if (partner) econ.partner = { ...partner };
    if (!fitsStore(econ, world.info)) relayout(econ, world.info);
  } catch (error) {
    console.error(`Stan sklepu „${seed}” nie dał się dopasować do układu.`, error);
    return unbuildable;
  }
  return {
    ok: true,
    session: {
      seed, mode: 'casual', econ, layout: world.layout, info: world.info, clock: { acc: 0 }, layoutLevel: econ.remontLevel, fromSave: true,
      loadNotice: null, retired: false, ephemeral: false, run: null,   // stan z zapisu nie zaczyna się od świeżego sklepu
    },
  };
}

/**
 * Nowa gra albo wczytana z zapisu (`fresh` pomija zapis). Nie rzuca z powodu zapisu: uszkodzony trafia do kopii, a sesja jest
 * nowa z `loadNotice` dla gracza. Poprawny zapis, którego nie da się użyć (z nowszej wersji gry albo świat się z niego nie
 * składa), zostaje na miejscu, a gracz dostaje sklep tymczasowy (`ephemeral`). Rzuca tylko wtedy, gdy generator nie daje
 * sklepu dla seeda. `partner` to premia z sieci sklepów (meta.ts): aktualna przy każdym wczytaniu. `options.ephemeral` zaczyna
 * świeżą grę jako tymczasową („zacznij od nowa” w sklepie tymczasowym), bez zaglądania do zapisu. Nowa gra (także
 * tymczasowa) bez premii sieci (`partner` zerowy albo pominięty) dostaje pusty dziennik poleceń (`run`); sesja z zapisu i gra z
 * premią sieci go nie mają, bo `replayRun` ich nie odtworzy.
 */
export function createSession(seed: string, fresh = false, partner?: EconomyState['partner'], options: { ephemeral?: boolean } = {}): GameSession {
  let loadNotice: string | null = null;
  let ephemeral = options.ephemeral === true;
  if (!fresh && !ephemeral) {
    const read = readSave(seed, partner);
    if (read.status === 'ok') return read.session;
    if (read.status === 'broken') loadNotice = read.backedUp ? BROKEN_SAVE_NOTICE : BROKEN_SAVE_NOTICE_NO_COPY;
    if (read.status === 'newer') {
      loadNotice = NEWER_SAVE_NOTICE;
      ephemeral = true;
    }
    if (read.status === 'unbuildable') {
      loadNotice = UNBUILDABLE_SAVE_NOTICE;
      ephemeral = true;
    }
  }
  const layout = layoutFor(seed, 0);
  const info = computeStoreInfo(layout);
  const econ = createEconomy(seed, info, partner);
  return {
    seed, mode: 'casual', econ, layout, info, clock: { acc: 0 }, layoutLevel: 0, fromSave: false, loadNotice, retired: false, ephemeral,
    run: noPartner(partner) ? newRunLog(seed) : null,   // `replayRun` startuje bez premii sieci: z nią dziennik nie byłby odtwarzalny
  };
}

/**
 * Ta sama gra na układzie zrobionym od nowa z seeda i poziomu remontu. Druga próba, gdy zapisany układ nie dał się zbudować w
 * scenie: układ da się wyliczyć z seeda, a stan gry (pieniądze, zapasy, ulepszenia) zostaje. Co nie pasuje do nowego układu
 * (palety, sprzęt, zapasy), ustawia `relayout`, więc dziennik poleceń nie opisuje już tego stanu (`run` = null). Nie zmienia `s`; rzuca,
 * gdy generator nie da układu.
 */
export function withLayoutFromSeed(s: GameSession): GameSession {
  const layout = layoutFor(s.seed, s.econ.remontLevel);
  const info = computeStoreInfo(layout);
  const econ = structuredClone(s.econ);
  if (!fitsStore(econ, info)) relayout(econ, info);
  return { ...s, econ, layout, info, layoutLevel: econ.remontLevel, clock: { acc: 0 }, run: null };   // układ z seeda i ewentualny `relayout` są poza dziennikiem
}
