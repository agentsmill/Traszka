import { createEconomy, fillQuests, relayout, type EconomyState } from '@/sim/economy/economy';
import { sanitizeEconomy } from '@/sim/economy/sanitize';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { REMONTS } from '@/sim/economy/upgrades';
import type { EconClock } from '@/sim/economy/clock';
import { isRec, whole } from '@/sim/guards';
import { subSeed } from '@/sim/rng';
import { GENERATOR_VERSION, generateStore } from '@/sim/store/generateStore';
import { sanitizeLayout } from '@/sim/store/sanitize';
import type { StoreLayout } from '@/sim/store/types';
import { version as GAME_VERSION } from '../../package.json';

/** Rozgrywka jednego sklepu: stan ekonomii i układ, w którym się toczy (po remoncie układ się zmienia). */
export interface GameSession {
  seed: string;
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
}

/**
 * Układ sklepu po `level` remontach: ten sam rodzaj lokalu, większe wymiary i więcej slotów sprzętu. Generator dostaje
 * osobny podseed na każdy poziom; gdyby nie znalazł układu, próbuje kolejnych, a na końcu z mniejszym przyrostem.
 */
export function layoutFor(seed: string, level: number): StoreLayout {
  const base = generateStore(seed);
  const r = REMONTS[Math.min(level, REMONTS.length) - 1];
  if (!r) return base;
  for (const scale of [1, 0.75, 0.5]) {
    const lot = {
      ...base.lot,
      interiorWidth: base.lot.interiorWidth + Math.round(r.grow[0] * scale),
      salesDepth: base.lot.salesDepth + Math.round(r.grow[1] * scale),
      backroomDepth: base.lot.backroomDepth + Math.round(r.grow[2] * scale),
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return generateStore(subSeed(seed, `remont:${r.level}:${attempt}`), lot, { equipmentSlots: r.slots });
      } catch {
        // kolejna próba
      }
    }
  }
  return base;
}

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

/** Zapis w przeglądarce (localStorage). Błędy (tryb prywatny, brak miejsca) są ciche: gra działa dalej bez zapisu. */
export function saveSession(s: GameSession): void {
  if (s.retired || s.ephemeral) return;
  const envelope: SaveEnvelope = {
    schema: SAVE_SCHEMA, gameVersion: GAME_VERSION, generatorVersion: GENERATOR_VERSION, seed: s.seed, layout: s.layout, econ: s.econ,
  };
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

/** Kasuje zapis sklepu sesji („zacznij od nowa”, zamknięcie w sieci). Sklep tymczasowy nie ma własnego zapisu, więc cudzego nie rusza. */
export function discardSave(s: GameSession): void {
  if (!s.ephemeral) deleteSave(s.seed);
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

/** Odkłada obecny zapis sklepu do kopii (np. gdy po wczytaniu nie dało się zbudować świata). Zwraca, czy kopia powstała. */
export function quarantineSave(seed: string): boolean {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + seed);
    return raw === null ? false : moveToBroken(seed, raw);
  } catch {
    return false;
  }
}

type ReadResult =
  | { status: 'none' }
  | { status: 'ok'; session: GameSession; migrated: boolean }
  | { status: 'broken'; backedUp: boolean }
  | { status: 'newer' };

/** Zapis z nowszej wersji gry: schemat wyższy niż ten, który umiemy czytać. Nie wiemy, co w nim jest, więc go nie ruszamy. */
const isNewerSchema = (data: unknown): boolean => isRec(data) && typeof data.schema === 'number' && data.schema > SAVE_SCHEMA;

/** Czyta zapis sklepu. Uszkodzonego nie naprawia na siłę: ląduje w kopii, a wołający zaczyna nową grę. */
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
    const opened = openSave(data, seed, partner);
    if (opened) return { status: 'ok', ...opened };
  } catch (error) {
    console.error(`Zapis sklepu „${seed}” nie dał się wczytać.`, error);
  }
  return { status: 'broken', backedUp: moveToBroken(seed, raw) };
}

/**
 * Sesja z zapisu w schemacie 2 albo 1, albo null, gdy zapisu nie da się użyć. Zapisany układ zostaje; schemat 1 i uszkodzony
 * układ dostają układ z seeda i poziomu remontu, dokładnie jak przed kopertą (`migrated`: warto zapisać od nowa).
 */
function openSave(data: unknown, seed: string, partner?: EconomyState['partner']): { session: GameSession; migrated: boolean } | null {
  if (!isRec(data)) return null;
  let storedEcon: unknown;
  let storedLayout: unknown = null;
  if (data.schema === SAVE_SCHEMA) {
    if (data.seed !== seed) return null;
    storedEcon = data.econ;
    storedLayout = data.layout;
  } else if (data.schema === undefined && data.version === 1) {
    storedEcon = data;
  } else {
    return null;
  }
  if (!isRec(storedEcon)) return null;

  let layout = sanitizeLayout(storedLayout);
  const migrated = layout === null;
  layout ??= layoutFor(seed, whole(storedEcon.remontLevel, 0, 0, REMONTS.length));
  const info = computeStoreInfo(layout);
  const econ = sanitizeEconomy(storedEcon, createEconomy(seed, info, partner));
  if (!econ) return null;
  if (partner) econ.partner = { ...partner };
  fillQuests(econ, info);
  return {
    session: {
      seed, econ, layout, info, clock: { acc: 0 }, layoutLevel: econ.remontLevel, fromSave: true, loadNotice: null, retired: false,
      ephemeral: false,
    },
    migrated,
  };
}

/**
 * Nowa gra albo wczytana z zapisu (`fresh` pomija zapis). Nie rzuca z powodu zapisu: uszkodzony trafia do kopii, a sesja
 * jest nowa z `loadNotice` dla gracza; zapis z nowszej wersji gry zostaje na miejscu, a gracz dostaje sklep tymczasowy
 * (`ephemeral`). `partner` to premia z sieci sklepów (meta.ts): aktualna przy każdym wczytaniu. `options.ephemeral` zaczyna
 * świeżą grę jako tymczasową („zacznij od nowa” w sklepie tymczasowym), bez zaglądania do zapisu.
 */
export function createSession(seed: string, fresh = false, partner?: EconomyState['partner'], options: { ephemeral?: boolean } = {}): GameSession {
  let loadNotice: string | null = null;
  let ephemeral = options.ephemeral === true;
  if (!fresh && !ephemeral) {
    const read = readSave(seed, partner);
    if (read.status === 'ok') {
      if (read.migrated) saveSession(read.session);
      return read.session;
    }
    if (read.status === 'broken') loadNotice = read.backedUp ? BROKEN_SAVE_NOTICE : BROKEN_SAVE_NOTICE_NO_COPY;
    if (read.status === 'newer') {
      loadNotice = NEWER_SAVE_NOTICE;
      ephemeral = true;
    }
  }
  const layout = layoutFor(seed, 0);
  const info = computeStoreInfo(layout);
  const econ = createEconomy(seed, info, partner);
  return { seed, econ, layout, info, clock: { acc: 0 }, layoutLevel: 0, fromSave: false, loadNotice, retired: false, ephemeral };
}

/** Po remoncie: nowy układ i przeniesienie palet oraz sprzętu. Zwraca true, gdy układ się zmienił. */
export function syncLayout(s: GameSession): boolean {
  if (s.econ.remontLevel === s.layoutLevel) return false;
  s.layout = layoutFor(s.seed, s.econ.remontLevel);
  s.info = computeStoreInfo(s.layout);
  s.layoutLevel = s.econ.remontLevel;
  relayout(s.econ, s.info);
  return true;
}
