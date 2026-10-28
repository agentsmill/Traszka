import { isRec, num } from '@/sim/guards';
import { clamp } from './time';

/**
 * Zaufanie Centrali (spec §7.5, §6.4, §7.3): miernik 0–100 widoczny od pierwszego dnia. Rośnie z KPI tygodnia, audytów,
 * odpowiedzi na okólniki i dobrego wyniku miesiąca; spada z mandatów, odesłanych palet, nietrafionych KPI i straty.
 * Od niego zależy przydział produktów wiralowych, premia od obrotu i to, jak często Centrala przysyła audyt.
 * Zaufanie spadające do zera to wypowiedzenie umowy (spec §10).
 */

export type TrustReason = 'kpi' | 'karty' | 'okolnik' | 'audyt' | 'mandaty' | 'palety' | 'wynik' | 'inne';
export const TRUST_REASONS: readonly TrustReason[] = ['kpi', 'karty', 'okolnik', 'audyt', 'mandaty', 'palety', 'wynik', 'inne'];
export const TRUST_REASON_LABEL: Record<TrustReason, string> = {
  kpi: 'KPI tygodnia',
  karty: 'Decyzje dnia',
  okolnik: 'Okólniki Centrali',
  audyt: 'Audyty i tajemniczy klient',
  mandaty: 'Mandaty',
  palety: 'Odesłane palety',
  wynik: 'Wynik miesiąca',
  inne: 'Inne',
};

/** Zmiany zaufania ze zdarzeń gry (te same, które dziś liczy economy.ts, plus nowe z kart, KPI i audytu). */
export const TRUST = {
  start: 60,
  fine: -1,
  returnedPallet: -4,
  driverReturned: -3,
  kpiHit: 3,
  kpiMiss: -2,
  auditPass: 4,
  auditFail: -6,
  monthProfit: 5,
  monthLoss: -8,
} as const;

export interface TrustState {
  value: number;
  /** Wartość na początku miesiąca i zmiany w miesiącu wg przyczyny (do raportu: „zmiana zaufania i dlaczego”). */
  monthStart: number;
  month: Partial<Record<TrustReason, number>>;
}

/** Nowy miernik. `value` przychodzi czasem ze starego zapisu (`EconomyState.trust`), więc też jest sprawdzane. */
export function createTrust(value: unknown = TRUST.start): TrustState {
  const v = num(value, TRUST.start, 0, 100);
  return { value: v, monthStart: v, month: {} };
}

/**
 * Miękkie granice: powyżej `softHigh` zyski liczą się w połowie (ulubieńcem Centrali zostaje się powoli), poniżej
 * `softLow` straty też w połowie (do zera, czyli wypowiedzenia, schodzi się długo, a nie w jeden zły tydzień).
 */
export const TRUST_SOFT = { softHigh: 75, softLow: 30, factor: 0.5 } as const;

/** Zmiana zaufania z przyczyną. Zwraca zmianę po miękkich granicach i przycięciu do 0–100 (tyle trafia do raportu). */
export function addTrust(t: TrustState, reason: TrustReason, delta: number): number {
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const before = t.value;
  const soft = (delta > 0 && before >= TRUST_SOFT.softHigh) || (delta < 0 && before <= TRUST_SOFT.softLow);
  t.value = clamp(t.value + (soft ? delta * TRUST_SOFT.factor : delta), 0, 100);
  const applied = t.value - before;
  if (applied !== 0) t.month[reason] = (t.month[reason] ?? 0) + applied;
  return applied;
}

export interface TrustTier { id: 'wylot' | 'cenzura' | 'obserwacja' | 'porzadek' | 'partner' | 'ulubieniec'; label: string; flavor: string }

const TIERS: { from: number; tier: TrustTier }[] = [
  { from: 90, tier: { id: 'ulubieniec', label: 'Ulubieniec Centrali', flavor: 'Twoje zdjęcie wisi w gazetce. Strona 14, ale jednak.' } },
  { from: 75, tier: { id: 'partner', label: 'Zaufany partner', flavor: 'Lody wiralowe przyjeżdżają do Ciebie przed sąsiednią Traszką.' } },
  { from: 60, tier: { id: 'porzadek', label: 'W porządku', flavor: 'W tabelce Centrali świecisz na zielono. Bladozielono.' } },
  { from: 40, tier: { id: 'obserwacja', label: 'Pod obserwacją', flavor: 'Centrala zna Cię z nazwiska. Niestety.' } },
  { from: 20, tier: { id: 'cenzura', label: 'Na cenzurowanym', flavor: 'Każdy Twój mail trafia do działu „wyjaśnień”.' } },
  { from: 0, tier: { id: 'wylot', label: 'Na wylocie', flavor: 'Centrala pyta, kto ma drugi komplet kluczy do sklepu.' } },
];

export function trustTier(value: number): TrustTier {
  return (TIERS.find((x) => value >= x.from) ?? TIERS[TIERS.length - 1]).tier;
}

/** Udział zamówionego produktu wiralowego, który Centrala przydzieli: nic poniżej 20, całość od 90. */
export const viralShare = (value: number): number => clamp((value - 20) / 70, 0, 1);

/** Premia Centrali od obrotu miesiąca (jak w economy.ts od 70, wyżej trochę więcej). */
export const turnoverBonusShare = (value: number): number => (value >= 85 ? 0.015 : value >= 70 ? 0.01 : 0);

/** Mnożnik szansy na zapowiedź audytu: przy niskim zaufaniu Centrala przyjeżdża częściej (do ×3 przy zerze). */
export const auditWeight = (value: number): number => 1 + Math.max(0, 60 - value) / 30;

/** Zaufanie na zerze: Centrala wypowiada umowę. */
export const trustTerminates = (value: number): boolean => value <= 0;

export interface TrustMonth {
  start: number;
  end: number;
  delta: number;
  /** Zmiany wg przyczyny, od największej co do wartości. */
  reasons: [TrustReason, number][];
}

/** Koniec miesiąca: podsumowanie do raportu, nowy miesiąc od obecnej wartości. */
export function closeTrustMonth(t: TrustState): TrustMonth {
  const reasons = TRUST_REASONS.filter((r) => (t.month[r] ?? 0) !== 0).map((r): [TrustReason, number] => [r, t.month[r]!])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const out = { start: t.monthStart, end: t.value, delta: t.value - t.monthStart, reasons };
  t.monthStart = t.value;
  t.month = {};
  return out;
}

/**
 * Wczytanie z zapisu. `legacy` to dzisiejsze `EconomyState.trust` (liczba): zapis sprzed tycoona dostaje zaufanie z niego.
 */
export function sanitizeTrust(raw: unknown, legacy?: number): TrustState {
  const fallback = createTrust(num(legacy, TRUST.start, 0, 100));
  if (!isRec(raw)) return fallback;
  const value = num(raw.value, fallback.value, 0, 100);
  const m = isRec(raw.month) ? raw.month : {};
  const month: TrustState['month'] = {};
  // kolejność kluczy z zapisu (kolejność zdarzeń w miesiącu): zapis ma wracać bajt w bajt
  for (const r of Object.keys(m)) if (TRUST_REASONS.includes(r as TrustReason)) month[r as TrustReason] = num(m[r], 0, -100, 100);
  return { value, monthStart: num(raw.monthStart, value, 0, 100), month };
}
