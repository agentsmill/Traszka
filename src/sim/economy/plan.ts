import { isNum, isRec, whole } from '@/sim/guards';
import { GUARANTEE } from './catalog';
import { dateOfDay } from './calendar';
import { roundNice } from './tycoon/time';

/*
 * Miesięczny plan sprzedaży od Centrali: czyste funkcje i typy, bez stanu gry (liść: nie importuje `economy.ts`).
 * Plan rusza od czwartego miesiąca umowy. Baza dzienna to średnia z ostatnich trzech zamkniętych miesięcy, ale nie spada
 * szybciej niż o 5% miesięcznie (zapadka); cel to baza razy dni miesiąca razy wzrost, który rośnie z serią trafień.
 * Wpadki idą po drabinie: kara 10%, kara 20%, trzecia kończy umowę. Kwoty w stanie są w pełnych złotych.
 */

export const PLAN = {
  startMonths: GUARANTEE.months,   // plan od czwartego miesiąca umowy
  recentMonths: 3,
  baseFloor: 0.95,   // baza nie spada szybciej niż o 5% miesięcznie
  growthBase: 0.02, growthPerHit: 0.005, growthMax: 0.05,
  bonusShare: 0.01,   // premia za trafienie: 1% obrotu miesiąca
  trustHit: 2, trustMiss: -2,
  fineShare: [0, 0.10, 0.20, 0] as readonly number[],   // indeks = stopień po wpadce
  stageMax: 3,
  topUpFrom: 0.9, topUpCost: 0.83,
  noticeFrom: 0.9,
} as const;

export interface PlanState {
  /** Plan miesiąca w zł; 0 = miesiąc zapowiedzi, bez rozliczenia. */
  target: number;
  /** Baza dzienna obecnego planu (zł). */
  base: number;
  /** Dzienny obrót do planu z ostatnich ≤3 zamkniętych miesięcy, od najstarszego. */
  recent: number[];
  /** Trafienia z rzędu. */
  streak: number;
  /** Stopień drabiny wpadek, 0–3. */
  stage: number;
  /** Dni otwarte w bieżącym miesiącu. */
  openDays: number;
  /** Przełącznik „dobij z własnej kieszeni”. */
  topUp: boolean;
}

/** Wynik rozliczenia, trafia do raportu miesiąca. */
export interface PlanMonth {
  target: number; due: number; turnover: number; bought: number; cost: number; share: number;
  hit: boolean; bonus: number; fine: number; trust: number;
  stage: number; stageBefore: number; streak: number; nextTarget: number; nextBase: number; nextGrowth: number;
}

export type PlanVerdict = 'hit' | 'topup' | 'miss';
export interface PlanOutlook {
  target: number; due: number; done: number; share: number; forecastShare: number;
  verdict: PlanVerdict; fine: number; cost: number; stage: number; stageAfter: number; streak: number; topUp: boolean;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Dni miesiąca kalendarzowego, w którym leży `day`. */
export function monthLength(day: number): number {
  const { year, month } = dateOfDay(day);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return month === 1 && leap ? 29 : MONTH_DAYS[month];
}

export function planGrowth(streak: number): number {
  return Math.min(PLAN.growthMax, PLAN.growthBase + PLAN.growthPerHit * streak);
}

/** Średnia z `recent`, ale nie mniej niż `baseFloor` poprzedniej bazy; pusta `recent` zostawia `prevBase`. */
export function planBase(recent: readonly number[], prevBase: number): number {
  if (recent.length === 0) return Math.round(prevBase);
  const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
  return Math.round(Math.max(mean, PLAN.baseFloor * prevBase));
}

export function planTarget(base: number, days: number, streak: number): number {
  return roundNice(base * days * (1 + planGrowth(streak)));
}

/** Dzienny obrót z ostatnich ≤3 wpisów historii; miesiące liczone wstecz od miesiąca poprzedzającego ten z dniem `day`. */
export function dailyFromHistory(history: readonly { revenue: number }[], day: number): number[] {
  const from = Math.max(0, history.length - PLAN.recentMonths);
  const out: number[] = [];
  let lastDay = day - dateOfDay(day).date;   // ostatni dzień poprzedniego miesiąca
  for (let i = history.length - 1; i >= from; i--) {
    const len = monthLength(lastDay);
    out.unshift(Math.round(history[i].revenue / len));
    lastDay -= len;
  }
  return out;
}

/** Cel pierwszego planu, jeśli `createPlan` dałby dziś plan dodatni; inaczej `null`. */
export function firstPlanPreview(history: readonly { revenue: number }[], day: number): number | null {
  const t = createPlan(history, day).target;
  return t > 0 ? t : null;
}

export function createPlan(history: readonly { revenue: number }[], day: number): PlanState {
  const recent = dailyFromHistory(history, day);
  const base = planBase(recent, 0);
  const active = history.length === PLAN.startMonths && dateOfDay(day).date === 1;
  return {
    target: active ? planTarget(base, monthLength(day), 0) : 0,
    base, recent, streak: 0, stage: 0, openDays: 0, topUp: false,
  };
}

/** Plan należny za dni otwarte; pełny `target`, gdy sklep stał otwarty cały miesiąc. */
export function planDue(p: PlanState, monthDays: number): number {
  return p.openDays >= monthDays ? p.target : Math.round(p.target * p.openDays / monthDays);
}

/** Dobicie z własnej kieszeni: przełącznik, wykonanie w [topUpFrom, 1) i portfel nie spada poniżej progu ostrzeżenia. */
function canTopUp(topUp: boolean, share: number, cost: number, cash: number, debtWarn: number): boolean {
  return topUp && share >= PLAN.topUpFrom && share < 1 && cash - cost >= debtWarn;
}

const shareOf = (revenue: number, due: number): number => (due > 0 ? revenue / due : 1);
const topUpCostOf = (bought: number): number => Math.round(bought * PLAN.topUpCost);
const fineOf = (stageAfter: number, missing: number): number => Math.round(PLAN.fineShare[stageAfter] * missing);

/** Rozlicza miesiąc i zmienia `p`; `null` (z samym `openDays = 0`), gdy to miesiąc zapowiedzi albo sklep nie otwierał się ani dnia. */
export function settlePlan(p: PlanState, i: {
  revenue: number; monthDays: number; nextMonthDays: number; cash: number; debtWarn: number;
}): PlanMonth | null {
  if (p.target === 0 || p.openDays === 0) {
    p.openDays = 0;
    return null;
  }
  const settledTarget = p.target;
  const stageBefore = p.stage;
  const due = planDue(p, i.monthDays);
  const share = shareOf(i.revenue, due);
  const gap = Math.max(0, due - i.revenue);
  const topCost = topUpCostOf(gap);
  const toppedUp = canTopUp(p.topUp, share, topCost, i.cash, i.debtWarn);
  const hit = share >= 1 || toppedUp;
  const bought = toppedUp ? gap : 0;
  const cost = toppedUp ? topCost : 0;
  let bonus = 0;
  let fine = 0;
  let trust: number;
  if (hit) {
    p.streak += 1;
    p.stage = Math.max(0, p.stage - 1);
    bonus = toppedUp ? 0 : Math.round(PLAN.bonusShare * i.revenue);
    trust = PLAN.trustHit;
  } else {
    p.streak = 0;
    p.stage = Math.min(PLAN.stageMax, p.stage + 1);
    fine = fineOf(p.stage, gap);
    trust = PLAN.trustMiss;
  }
  p.recent.push(Math.round((i.revenue + bought) / p.openDays));
  if (p.recent.length > PLAN.recentMonths) p.recent.splice(0, p.recent.length - PLAN.recentMonths);
  p.base = planBase(p.recent, p.base);
  p.target = planTarget(p.base, i.nextMonthDays, p.streak);
  p.openDays = 0;
  return {
    // do raportu w pełnych złotych i z wykonaniem do 4 miejsc: o trafieniu, karze i koszcie zdecydowały liczby bez zaokrągleń
    target: settledTarget, due, turnover: Math.round(i.revenue), bought, cost, share: Math.round(share * 10_000) / 10_000, hit, bonus, fine, trust,
    stage: p.stage, stageBefore, streak: p.streak, nextTarget: p.target, nextBase: p.base, nextGrowth: planGrowth(p.streak),
  };
}

/** Koniec miesiąca zapowiedzi: plan z historii, która ma już zamykany miesiąc. `day` to ostatni dzień tego miesiąca. */
export function rollPlan(p: PlanState, history: readonly { revenue: number }[], day: number): void {
  p.recent = dailyFromHistory(history, day + 1);
  p.base = planBase(p.recent, 0);
  p.target = planTarget(p.base, monthLength(day + 1), 0);
  p.openDays = 0;
}

/** Prognoza rozliczenia z bieżącego wykonania i prognozy obrotu; `null` w miesiącu zapowiedzi. */
export function planOutlook(p: PlanState, i: {
  revenue: number; forecastRevenue: number; monthDays: number; openDaysAhead: number; cash: number; debtWarn: number;
}): PlanOutlook | null {
  if (p.target === 0) return null;
  const due = planDue({ ...p, openDays: p.openDays + i.openDaysAhead }, i.monthDays);
  const share = shareOf(i.revenue, due);
  const forecastShare = shareOf(i.forecastRevenue, due);
  const gap = Math.max(0, due - i.forecastRevenue);
  const topCost = topUpCostOf(gap);
  const toppedUp = canTopUp(p.topUp, forecastShare, topCost, i.cash, i.debtWarn);
  const verdict: PlanVerdict = forecastShare >= 1 ? 'hit' : toppedUp ? 'topup' : 'miss';
  const stageAfter = verdict === 'miss' ? Math.min(PLAN.stageMax, p.stage + 1) : Math.max(0, p.stage - 1);
  return {
    target: p.target, due, done: i.revenue, share, forecastShare, verdict,
    fine: verdict === 'miss' ? fineOf(stageAfter, gap) : 0,
    cost: verdict === 'topup' ? topCost : 0,
    stage: p.stage, stageAfter, streak: p.streak, topUp: p.topUp,
  };
}

export const planTerminates = (p: PlanState | undefined): boolean => p !== undefined && p.stage >= PLAN.stageMax;

/** Wczytanie z zapisu: nic na wiarę, liczby przycięte, kolejność kluczy jak w `PlanState`. */
export function sanitizePlan(raw: unknown): PlanState | undefined {
  if (!isRec(raw)) return undefined;
  const recent = Array.isArray(raw.recent)
    ? raw.recent.filter((v): v is number => isNum(v) && v >= 0).slice(-PLAN.recentMonths)
    : [];
  return {
    target: whole(raw.target, 0, 0),
    base: whole(raw.base, 0, 0),
    recent,
    streak: whole(raw.streak, 0, 0, 1000),
    stage: whole(raw.stage, 0, 0, PLAN.stageMax),
    openDays: whole(raw.openDays, 0, 0, 31),
    topUp: raw.topUp === true,
  };
}
