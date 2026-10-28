import { isRec, num, whole, type Rec } from '@/sim/guards';
import { HOT } from '../catalog';
import { rand01 } from '../rand';
import { CH } from './channels';
import { roundNice, weekdayOf } from './time';

/**
 * KPI tygodnia (spec §7.5): Zlecenia Centrali z wersji grywalnej w nowej roli. Jeden cel na tydzień, do niedzieli
 * (np. „150 kaw do niedzieli”). Trafiony daje zaufanie i premię, nietrafiony odbiera zaufanie. Postęp liczy się jak
 * w zleceniach: z różnicy liczników od początku tygodnia.
 */

export type KpiKind = 'kawy' | 'klienci' | 'kolejka' | 'czystosc' | 'bezMandatu';
export const KPI_KINDS: readonly KpiKind[] = ['kawy', 'klienci', 'kolejka', 'czystosc', 'bezMandatu'];

/** Cele „co najmniej” rosną do celu; cele „najwyżej” to limit, którego nie wolno przekroczyć. */
const AT_MOST: ReadonlySet<KpiKind> = new Set<KpiKind>(['kolejka', 'bezMandatu']);

/** Liczniki narastające od początku gry (integracja bierze je z `EconomyState.total` i `HallState`). */
export interface KpiMetrics {
  customers: number;
  hotSold: number;
  lost: number;
  fines: number;
  cleanSum: number;
  cleanMinutes: number;
}

export interface KpiState {
  /** Numer tygodnia (do losowania rodzaju). */
  seq: number;
  kind: KpiKind;
  target: number;
  start: KpiMetrics;
  fromDay: number;
  /** Ostatni dzień tygodnia (niedziela): o zamknięciu dnia liczy się wynik. */
  toDay: number;
  month: { hit: number; miss: number };
}

export interface KpiScale { dailyCustomers: number; dailyMargin: number }

export const KPI = {
  trustHit: 3,
  trustMiss: -2,
  /** Premia za trafiony KPI jako część typowej marży dnia. */
  bonusShare: 0.3,
  /** Cele: zapas ponad typowy tydzień i limity. */
  hotStretch: 1.1,
  customersStretch: 1.08,
  lostShare: 0.02,
  cleanTarget: 75,
} as const;

/** Najbliższa niedziela od dnia `day` (gdy `day` to niedziela, następna: tydzień ma co najmniej dwa dni). */
export function weekEnd(day: number): number {
  const w = weekdayOf(day);
  return day + (w === 0 ? 7 : 7 - w);
}

function pickKind(seedHash: number, seq: number, previous: KpiKind | null): KpiKind {
  const pool = KPI_KINDS.filter((k) => k !== previous);
  return pool[Math.floor(rand01(seedHash, seq, CH.kpiKind) * pool.length)];
}

function targetFor(kind: KpiKind, days: number, scale: KpiScale): number {
  const customers = Math.max(1, scale.dailyCustomers) * days;
  switch (kind) {
    case 'kawy': return Math.max(10, roundNice(KPI.hotStretch * HOT.chance * customers));
    case 'klienci': return Math.max(10, roundNice(KPI.customersStretch * customers));
    case 'kolejka': return Math.max(5, roundNice(KPI.lostShare * customers));
    case 'czystosc': return KPI.cleanTarget;
    case 'bezMandatu': return 0;
  }
}

/** Nowy tydzień od dnia `day`. */
export function newKpiWeek(seedHash: number, seq: number, day: number, now: KpiMetrics, scale: KpiScale, previous: KpiKind | null = null,
  month: KpiState['month'] = { hit: 0, miss: 0 }): KpiState {
  const kind = pickKind(seedHash, seq, previous);
  const toDay = weekEnd(day);
  return { seq, kind, target: targetFor(kind, toDay - day + 1, scale), start: { ...now }, fromDay: day, toDay, month };
}

/** Wartość mierzona od początku tygodnia. */
export function kpiValue(k: KpiState, now: KpiMetrics): number {
  switch (k.kind) {
    case 'kawy': return now.hotSold - k.start.hotSold;
    case 'klienci': return now.customers - k.start.customers;
    case 'kolejka': return now.lost - k.start.lost;
    case 'bezMandatu': return now.fines - k.start.fines;
    case 'czystosc': {
      const minutes = now.cleanMinutes - k.start.cleanMinutes;
      return minutes > 0 ? (now.cleanSum - k.start.cleanSum) / minutes : 100;
    }
  }
}

export const kpiHit = (k: KpiState, now: KpiMetrics): boolean =>
  (AT_MOST.has(k.kind) ? kpiValue(k, now) <= k.target + 1e-9 : kpiValue(k, now) >= k.target - 1e-9);

/** Postęp 0–1: przy celach „co najmniej” to droga do celu, przy limitach to, ile limitu jeszcze zostało. */
export function kpiProgress(k: KpiState, now: KpiMetrics): number {
  const v = kpiValue(k, now);
  if (k.kind === 'bezMandatu') return v > 0 ? 0 : 1;
  if (AT_MOST.has(k.kind)) return Math.max(0, Math.min(1, 1 - v / Math.max(1, k.target)));
  return Math.max(0, Math.min(1, v / Math.max(1e-9, k.target)));
}

export interface KpiWeekResult { kind: KpiKind; target: number; value: number; hit: boolean; trust: number; bonus: number }

/**
 * Zamknięcie tygodnia (niedziela, zamknięcie dnia): wynik, zmiana zaufania i premia do zaksięgowania przez wywołującego,
 * a stan przechodzi na nowy tydzień od `nextDay`.
 */
export function closeKpiWeek(k: KpiState, now: KpiMetrics, seedHash: number, nextDay: number, scale: KpiScale): KpiWeekResult {
  const value = kpiValue(k, now);
  const hit = kpiHit(k, now);
  const result: KpiWeekResult = {
    kind: k.kind, target: k.target, value, hit,
    trust: hit ? KPI.trustHit : KPI.trustMiss,
    bonus: hit ? roundNice(KPI.bonusShare * Math.max(0, scale.dailyMargin)) : 0,
  };
  const month = { hit: k.month.hit + (hit ? 1 : 0), miss: k.month.miss + (hit ? 0 : 1) };
  Object.assign(k, newKpiWeek(seedHash, k.seq + 1, nextDay, now, scale, k.kind, month));
  return result;
}

export function closeKpiMonth(k: KpiState): KpiState['month'] {
  const out = k.month;
  k.month = { hit: 0, miss: 0 };
  return out;
}

/** Tytuł celu dla interfejsu; `fmt` formatuje liczby (interfejs podaje polskie formatowanie). */
export function kpiTitle(kind: KpiKind, target: number, fmt: (n: number) => string = (n) => String(Math.round(n))): string {
  switch (kind) {
    case 'kawy': return `Sprzedaj ${fmt(target)} kaw i hot-dogów do niedzieli`;
    case 'klienci': return `Obsłuż ${fmt(target)} klientów do niedzieli`;
    case 'kolejka': return `Do niedzieli najwyżej ${fmt(target)} klientów odstraszonych kolejką`;
    case 'czystosc': return `Średnia czystość sali co najmniej ${fmt(target)}% do niedzieli`;
    case 'bezMandatu': return 'Tydzień bez mandatu: palety nie nocują na chodniku';
  }
}

export const KPI_FLAVOR: Record<KpiKind, string> = {
  kawy: 'Centrala: „Kawa to nowa ropa. Hot-dog to nowa kawa”.',
  klienci: 'Centrala liczy klientów. Klienci liczą na resztę.',
  kolejka: 'Klient, który odszedł od kolejki, nie wraca. Chyba że do Szopa 24h.',
  czystosc: 'Audytor przychodzi w białych rękawiczkach. Dosłownie.',
  bezMandatu: 'Straż Miejska ma swoje KPI. Nie bądź ich KPI.',
};

const metrics = (v: unknown, fallback: KpiMetrics): KpiMetrics => {
  const r: Rec = isRec(v) ? v : {};
  return {
    customers: num(r.customers, fallback.customers, 0, 1e60),
    hotSold: num(r.hotSold, fallback.hotSold, 0, 1e60),
    lost: num(r.lost, fallback.lost, 0, 1e60),
    fines: num(r.fines, fallback.fines, 0, 1e12),
    cleanSum: num(r.cleanSum, fallback.cleanSum, 0, 1e15),
    cleanMinutes: num(r.cleanMinutes, fallback.cleanMinutes, 0, 1e13),
  };
};

/**
 * Wczytanie z zapisu; uszkodzony KPI zaczyna tydzień od nowa (`fresh`, liczony z bieżących liczników od dnia
 * `fresh.fromDay`, czyli dnia wczytania). Tydzień, który już minął albo dopiero się zacznie, też: inaczej niedziela
 * zamknięcia nigdy by nie nadeszła.
 */
export function sanitizeKpi(raw: unknown, fresh: KpiState): KpiState {
  if (!isRec(raw) || !KPI_KINDS.includes(raw.kind as KpiKind)) return fresh;
  const fromDay = whole(raw.fromDay, fresh.fromDay, 0, 1e7);
  const toDay = whole(raw.toDay, weekEnd(fromDay), fromDay, fromDay + 7);
  if (fromDay > fresh.fromDay || toDay < fresh.fromDay) return fresh;
  const m: Rec = isRec(raw.month) ? raw.month : {};
  return {
    seq: whole(raw.seq, fresh.seq, 0, 1_073_741_824),
    kind: raw.kind as KpiKind,
    target: num(raw.target, fresh.target, 0, 1e12),
    start: metrics(raw.start, fresh.start),
    fromDay,
    toDay,
    month: { hit: whole(m.hit, 0, 0, 10), miss: whole(m.miss, 0, 0, 10) },
  };
}
