import { createEconomy, emptyCounters, fillQuests, relayout, type EconomyState } from '@/sim/economy/economy';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { REMONTS } from '@/sim/economy/upgrades';
import type { EconClock } from '@/sim/economy/clock';
import { subSeed } from '@/sim/rng';
import { generateStore } from '@/sim/store/generateStore';
import type { StoreLayout } from '@/sim/store/types';

/** Rozgrywka jednego sklepu: stan ekonomii i układ, w którym się toczy (po remoncie układ się zmienia). */
export interface GameSession {
  seed: string;
  econ: EconomyState;
  layout: StoreLayout;
  info: StoreInfo;
  clock: EconClock;
  /** Poziom remontu, dla którego policzono `layout`. */
  layoutLevel: number;
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

const SAVE_PREFIX = 'traszka:save:';
const LAST_KEY = 'traszka:last';

/** Zapis w przeglądarce (localStorage). Błędy (tryb prywatny, brak miejsca) są ciche: gra działa dalej bez zapisu. */
export function saveSession(s: GameSession): void {
  try {
    localStorage.setItem(SAVE_PREFIX + s.seed, JSON.stringify(s.econ));
    localStorage.setItem(LAST_KEY, s.seed);
  } catch {
    // bez zapisu
  }
}

export function loadSaved(seed: string): EconomyState | null {
  try {
    const raw = localStorage.getItem(SAVE_PREFIX + seed);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<EconomyState>;
    if (data.version !== 1 || data.seed !== seed) return null;
    return data as EconomyState;
  } catch {
    return null;
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
 * Nowa gra albo wczytana z zapisu (`fresh` pomija zapis). Brakujące pola starszego zapisu uzupełnia stan domyślny.
 * `partner` to premia z sieci sklepów (meta.ts): aktualna przy każdym wczytaniu.
 */
export function createSession(seed: string, fresh = false, partner?: EconomyState['partner']): GameSession {
  const saved = fresh ? null : loadSaved(seed);
  const level = saved?.remontLevel ?? 0;
  const layout = layoutFor(seed, level);
  const info = computeStoreInfo(layout);
  const defaults = createEconomy(seed, info, partner);
  const econ: EconomyState = saved
    ? { ...defaults, ...saved, today: { ...emptyCounters(), ...saved.today }, month: { ...emptyCounters(), ...saved.month }, total: { ...emptyCounters(), ...saved.total } }
    : defaults;
  if (partner) econ.partner = { ...partner };
  if (econ.quests.length === 0) fillQuests(econ, info);
  return { seed, econ, layout, info, clock: { acc: 0 }, layoutLevel: level };
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
