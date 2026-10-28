import { isRec, num } from '@/sim/guards';

/**
 * WUT, czyli Wskaźnik Ubytków Towarowych (spec §7.1a): przeterminowany towar, kradzieże i pomyłki w złotówkach.
 * Część ubytków jest „wliczona”: do progu (udział obrotu miesiąca) płaci Centrala, nadwyżkę franczyzobiorca. Karty decyzji
 * dopisują do WUT (kanapki do kosza, towar-widmo), a programy refundacyjne Centrali odpisują.
 */

export type WutReason = 'termin' | 'kradziez' | 'pomylki' | 'karty';
export const WUT_REASONS: readonly WutReason[] = ['termin', 'kradziez', 'pomylki', 'karty'];
export const WUT_LABEL: Record<WutReason, string> = {
  termin: 'Przeterminowane',
  kradziez: 'Kradzieże i „zapomniane” skany',
  pomylki: 'Pomyłki i stłuczki',
  karty: 'Decyzje dnia',
};

export const WUT = {
  /** Próg: ubytki do 1,2% obrotu miesiąca pokrywa Centrala. */
  threshold: 0.012,
  /** Naturalne ubytki jako udział obrotu (razem 0,9%): zostaje ok. 0,3% obrotu luzu na decyzje. */
  baseline: { termin: 0.004, kradziez: 0.003, pomylki: 0.002 } as Record<Exclude<WutReason, 'karty'>, number>,
} as const;

export interface WutState {
  /** Ubytki w tym miesiącu wg przyczyny (zł). */
  month: Record<WutReason, number>;
}

const zero = (): Record<WutReason, number> => ({ termin: 0, kradziez: 0, pomylki: 0, karty: 0 });

export function createWut(): WutState {
  return { month: zero() };
}

/**
 * Dopisuje ubytek. Ujemna kwota to odpis z programu refundacyjnego: schodzi najpierw z podanej przyczyny, potem
 * z pozostałych (odpis dotyczy całego WUT), żadna przyczyna nie spada poniżej zera.
 */
export function addWut(w: WutState, reason: WutReason, zl: number): void {
  if (!Number.isFinite(zl)) return;
  if (zl >= 0) {
    w.month[reason] += zl;
    return;
  }
  let left = -zl;
  for (const r of [reason, ...WUT_REASONS.filter((x) => x !== reason)]) {
    const cut = Math.min(left, w.month[r]);
    w.month[r] -= cut;
    left -= cut;
  }
}

/** Naturalne ubytki od obrotu tej minuty (`revenue` w zł). */
export function wutFromSales(w: WutState, revenue: number): void {
  if (!(revenue > 0)) return;
  for (const r of ['termin', 'kradziez', 'pomylki'] as const) w.month[r] += revenue * WUT.baseline[r];
}

export const wutTotal = (w: WutState): number => WUT_REASONS.reduce((n, r) => n + w.month[r], 0);

/** Ile zapłaci franczyzobiorca przy obrocie miesiąca `revenue`. */
export const wutCharge = (w: WutState, revenue: number): number => Math.max(0, wutTotal(w) - WUT.threshold * Math.max(0, revenue));

const BASELINE_SHARE = WUT.baseline.termin + WUT.baseline.kradziez + WUT.baseline.pomylki;

/**
 * Luz pod progiem do końca miesiąca: próg przy przewidywanym obrocie całego miesiąca minus ubytki dotąd i naturalne
 * ubytki, które jeszcze przyjdą z obrotu do końca miesiąca. Ujemny luz to dopłata, która już się szykuje. Bot
 * i interfejs patrzą na to przy kartach („kanapki do kosza teraz nic nie kosztują, pod koniec miesiąca już tak”).
 */
export function wutSlack(w: WutState, revenueSoFar: number, projectedRevenue: number): number {
  const projected = Math.max(0, projectedRevenue, revenueSoFar);
  return WUT.threshold * projected - wutTotal(w) - BASELINE_SHARE * (projected - Math.max(0, revenueSoFar));
}

export interface WutMonth { total: number; charge: number; byReason: Record<WutReason, number> }

export function closeWutMonth(w: WutState, revenue: number): WutMonth {
  const out = { total: wutTotal(w), charge: wutCharge(w, revenue), byReason: { ...w.month } };
  w.month = zero();
  return out;
}

export function sanitizeWut(raw: unknown): WutState {
  const m = isRec(raw) && isRec(raw.month) ? raw.month : {};
  const month = zero();
  for (const r of WUT_REASONS) month[r] = num(m[r], 0, 0, 1e60);
  return { month };
}
