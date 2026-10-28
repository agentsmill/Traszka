import { isRec } from '@/sim/guards';
import { createCards, sanitizeCards, type CardOutcome, type CardsState } from './cards';
import { createHall, sanitizeHall, type HallState, type Weather } from './cleanliness';
import { createFatigue, sanitizeFatigue, spendEnergy, type FatigueState } from './fatigue';
import { newKpiWeek, sanitizeKpi, type KpiMetrics, type KpiScale, type KpiState } from './kpi';
import { sanitizeReport, type TycoonMonthReport } from './report';
import { addChores, createStaffPool, sanitizeStaffPool, type StaffPoolState } from './staff';
import { addTrust, createTrust, sanitizeTrust, type TrustState } from './trust';
import { createWaste, sanitizeWaste, type WasteState } from './waste';
import { addWut, createWut, sanitizeWut, type WutState } from './wut';

/**
 * Wszystkie kawałki stanu tycoona w jednym obiekcie JSON: w części 2 to jedno pole `EconomyState.tycoon` (zob.
 * INTEGRATION.md). Każdy kawałek ma własne funkcje w swoim module; tu jest tylko tworzenie, wczytanie z zapisu
 * i zaksięgowanie skutków karty po stronie tycoona.
 */

export interface TycoonState {
  version: 1;
  staff: StaffPoolState;
  waste: WasteState;
  hall: HallState;
  fatigue: FatigueState;
  cards: CardsState;
  trust: TrustState;
  kpi: KpiState;
  wut: WutState;
  lastReport: TycoonMonthReport | null;
}

export interface TycoonInit {
  day: number;
  seedHash: number;
  /** Zaufanie startowe (w części 2: dzisiejsze `EconomyState.trust`). */
  trust?: number;
  weather?: Weather;
  /** Liczniki narastające sklepu (KPI liczy od nich postęp) i skala sklepu (cele i nagrody). */
  metrics: KpiMetrics;
  scale: KpiScale;
}

export function createTycoon(init: TycoonInit): TycoonState {
  return {
    version: 1,
    staff: createStaffPool(),
    waste: createWaste(),
    hall: createHall(init.weather),
    fatigue: createFatigue(),
    cards: createCards(init.day),
    trust: createTrust(init.trust),
    kpi: newKpiWeek(init.seedHash, 1, init.day, init.metrics, init.scale),
    wut: createWut(),
    lastReport: null,
  };
}

/**
 * Wczytanie z zapisu. Brak pola (zapis sprzed tycoona) daje świeży kawałek, a zaufanie bierze się wtedy z `init.trust`
 * (dzisiejsze `EconomyState.trust`). `staff` to liczba osób na zmianie (przydziały ręczne muszą się w niej mieścić).
 */
export function sanitizeTycoon(raw: unknown, init: TycoonInit & { staff: number }): TycoonState {
  const fresh = createTycoon(init);
  if (!isRec(raw) || raw.version !== 1) return fresh;
  return {
    version: 1,
    staff: sanitizeStaffPool(raw.staff, init.staff),
    waste: sanitizeWaste(raw.waste),
    hall: sanitizeHall(raw.hall),
    fatigue: sanitizeFatigue(raw.fatigue),
    cards: sanitizeCards(raw.cards, init.day),
    trust: sanitizeTrust(raw.trust, init.trust),
    kpi: sanitizeKpi(raw.kpi, fresh.kpi),
    wut: sanitizeWut(raw.wut),
    lastReport: raw.lastReport === null || raw.lastReport === undefined ? null : sanitizeReport(raw.lastReport),
  };
}

/** Skutki karty, które księguje ekonomia (gotówka w podziale na linie raportu, reputacja, Ogonki). */
export interface EconomySide {
  /** Inne przychody (+) i koszty (−). */
  other: number;
  /** Premia Centrali. */
  bonus: number;
  /** Mandat albo kara (ujemne). */
  fine: number;
  /** Opłata logistyczna (ujemne). */
  logistics: number;
  reputation: number;
  ogonki: number;
}

/**
 * Księgowanie karty po stronie tycoona: zaufanie (z przyczyną z karty), WUT, czas ludzi i siły. Zwraca to, co zostaje
 * dla ekonomii. Efekty na czas (`o.mods`) są już w `t.cards.active`.
 */
export function applyCardOutcome(t: TycoonState, o: CardOutcome): EconomySide {
  const d = o.delta;
  if (d.trust) addTrust(t.trust, o.trustReason, d.trust);
  if (d.wut) addWut(t.wut, 'karty', d.wut);
  if (d.staffMinutes && d.staffMinutes > 0) addChores(t.staff, d.staffMinutes);
  if (d.energy) spendEnergy(t.fatigue, d.energy);
  return {
    other: d.cash ?? 0, bonus: d.bonus ?? 0, fine: d.fine ?? 0, logistics: d.logistics ?? 0,
    reputation: d.reputation ?? 0, ogonki: d.ogonki ?? 0,
  };
}
