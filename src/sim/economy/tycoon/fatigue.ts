import { isRec, num, whole } from '@/sim/guards';
import { TAP_ITEMS } from '../catalog';
import { clamp } from './time';

/**
 * Zmęczenie franczyzobiorcy (spec §7.5). Stukanie to „ręce franczyzobiorcy”: każde stuknięcie zużywa dzienną pulę sił,
 * a przy pustej puli ręce odmawiają. Noc odnawia pulę tylko częściowo, więc po ciężkim dniu zostaje zmęczenie, które
 * obniża wydajność ręcznych akcji następnego dnia. Combo zostaje jako odczucie: mnoży stuknięcie i jego koszt po równo,
 * więc nie wyciska z puli więcej.
 *
 * Niedziela nie ma osobnych zasad (decyzja użytkownika z 28.10.2026, zamiast „placówki pocztowej” ze specu §7.5): sklep
 * działa jak co dzień, tylko przychodzi więcej ludzi (`sunday.ts`), więc siły schodzą szybciej same z siebie, bo jest
 * w co stukać.
 */

export type TapKind = 'kasa' | 'paleta';

export const FATIGUE = {
  /** Dzienna pula sił. */
  pool: 100,
  /** Koszt jednego stuknięcia: dźwiganie kartonów męczy bardziej niż kasowanie. */
  tapCost: { kasa: 2, paleta: 2.5 } as Record<TapKind, number>,
  /** Ile sił wraca przez noc (najwyżej do pełnej puli). */
  nightRecovery: 70,
  /** Wydajność ręcznych akcji = 1 − carryPenalty × (zmęczenie przeniesione / pula), nie mniej niż minEfficiency. */
  carryPenalty: 0.6,
  minEfficiency: 0.5,
  /** Combo z interfejsu: najwyżej tyle stuknięć naraz. */
  maxCombo: 5,
} as const;

export interface FatigueState {
  energy: number;
  /** Zmęczenie przeniesione z ostatniej nocy: ile brakowało do pełnej puli po regeneracji. */
  carried: number;
  /** Dziś: zużyte siły, stuknięcia (licząc combo) i odmowy rąk. */
  spentToday: number;
  tapsToday: number;
  refusedToday: number;
  /** Miesiąc: dni, w których pula się wyczerpała, i odmowy (do raportu). */
  exhaustedDays: number;
  refusedMonth: number;
}

export function createFatigue(): FatigueState {
  return { energy: FATIGUE.pool, carried: 0, spentToday: 0, tapsToday: 0, refusedToday: 0, exhaustedDays: 0, refusedMonth: 0 };
}

/** Wydajność ręcznych akcji dziś (zmęczenie z wczoraj). */
export const fatigueEfficiency = (f: FatigueState): number =>
  Math.max(FATIGUE.minEfficiency, 1 - FATIGUE.carryPenalty * f.carried / FATIGUE.pool);

export const tapCost = (kind: TapKind): number => FATIGUE.tapCost[kind];

export interface TapResult {
  ok: boolean;
  /** Ile stuknięć z combo przeszło (pula mogła przyciąć combo). */
  taps: number;
  /** Moc: przeszłe stuknięcia × wydajność. Kasa: tylu klientów obsłużyć; paleta: tyle razy TAP_ITEMS sztuk. */
  power: number;
  /** Zużyte siły. */
  cost: number;
  text?: string;
}

/**
 * Stuknięcie z combo `combo` (1–5, liczy je interfejs). Koszt rośnie z combo tak samo jak efekt, a gdy sił nie starcza
 * na całe combo, przechodzi tyle stuknięć, na ile starcza. Zero stuknięć to odmowa rąk.
 */
export function tap(f: FatigueState, kind: TapKind, combo: number): TapResult {
  // polecenie bez combo (albo z bzdurą) to jedno stuknięcie, jak `combo = 1` w economy.ts
  const want = clamp(Number.isFinite(combo) ? Math.floor(combo) : 1, 1, FATIGUE.maxCombo);
  const unit = tapCost(kind);
  const taps = Math.min(want, Math.floor((f.energy + 1e-9) / unit));
  if (taps < 1) {
    f.refusedToday++;
    f.refusedMonth++;
    return { ok: false, taps: 0, power: 0, cost: 0, text: 'Ręce odmawiają. Franczyzobiorca też człowiek, nawet jeśli Centrala ma inne zdanie.' };
  }
  const cost = taps * unit;
  f.energy = Math.max(0, f.energy - cost);
  f.spentToday += cost;
  f.tapsToday += taps;
  return { ok: true, taps, power: taps * fatigueEfficiency(f), cost };
}

/** Sztuki z palety za stuknięcie o mocy `power` (wózek z ulepszeń mnoży je osobno, jak w `economy.ts`). */
export const tapItems = (power: number): number => power * TAP_ITEMS;

/** Siły z karty decyzji („stanę za niego sam”): ujemne zużywają, nie schodzą poniżej zera. Zwraca faktyczną zmianę. */
export function spendEnergy(f: FatigueState, delta: number): number {
  const before = f.energy;
  f.energy = clamp(f.energy + delta, 0, FATIGUE.pool);
  if (delta < 0) f.spentToday += before - f.energy;
  return f.energy - before;
}

/**
 * Noc: pula wraca częściowo, a to, czego zabrakło do pełnej, przechodzi na jutro jako zmęczenie. Dzień z pustą pulą
 * (albo z odmową rąk) liczy się do raportu. Zwraca przeniesione zmęczenie.
 */
export function fatigueNight(f: FatigueState): number {
  if (f.energy < 1 || f.refusedToday > 0) f.exhaustedDays++;
  f.energy = Math.min(FATIGUE.pool, f.energy + FATIGUE.nightRecovery);
  f.carried = FATIGUE.pool - f.energy;
  f.spentToday = 0;
  f.tapsToday = 0;
  f.refusedToday = 0;
  return f.carried;
}

export function closeFatigueMonth(f: FatigueState): { exhaustedDays: number; refused: number } {
  const out = { exhaustedDays: f.exhaustedDays, refused: f.refusedMonth };
  f.exhaustedDays = 0;
  f.refusedMonth = 0;
  return out;
}

/**
 * Sufit stukania: ile mocy da się wycisnąć w jeden dzień, zaczynając od `energy` sił z wydajnością wynikającą z `carried`.
 * Do sprawdzeń balansu (stukanie ma dokładać najwyżej 15–20% wyniku).
 */
export function dailyTapCeiling(kind: TapKind, energy: number = FATIGUE.pool, carried = 0): number {
  const taps = Math.floor((energy + 1e-9) / tapCost(kind));
  return taps * Math.max(FATIGUE.minEfficiency, 1 - FATIGUE.carryPenalty * carried / FATIGUE.pool);
}

export function sanitizeFatigue(raw: unknown): FatigueState {
  const d = createFatigue();
  if (!isRec(raw)) return d;
  return {
    energy: num(raw.energy, d.energy, 0, FATIGUE.pool),
    carried: num(raw.carried, 0, 0, FATIGUE.pool),
    spentToday: num(raw.spentToday, 0, 0, 1e6),
    tapsToday: whole(raw.tapsToday, 0, 0, 1e9),
    refusedToday: whole(raw.refusedToday, 0, 0, 1e9),
    exhaustedDays: whole(raw.exhaustedDays, 0, 0, 1e6),
    refusedMonth: whole(raw.refusedMonth, 0, 0, 1e9),
  };
}
