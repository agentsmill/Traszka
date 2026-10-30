/*
 * Liczby w przetłumaczonych zdaniach. Symulacja formatuje liczby po polsku (`toLocaleString('pl-PL')`: spacja niełamliwa tysięcy,
 * przecinek dziesiętny), a angielskie zdanie ma je mieć po angielsku („12,345”, „1.5”). Znak (+, −, -) zostaje taki, jaki był.
 */

const EN = 'en-GB';

/** Liczba w zapisie angielskim, do dwóch miejsc po przecinku. */
export const enNum = (n: number, maxFraction = 2): string => n.toLocaleString(EN, { maximumFractionDigits: maxFraction });

/** Polski zapis liczby („12 345”, „−2,5”, „+1 234”) w angielskim; napis, który nie jest liczbą, zostaje bez zmian. */
export function plNum(s: string): string {
  const m = /^([+\-−]?)([\d\s  ]+(?:,\d+)?)$/.exec(s.trim());
  if (!m) return s;
  const value = Number(m[2]!.replace(/[\s  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(value)) return s;
  return m[1] + enNum(value);
}

/** Liczba z polskiego zapisu (do odmiany: „1 pallet”, „3 pallets”); NaN, gdy to nie liczba. */
export function plValue(s: string): number {
  const m = /^([+\-−]?)([\d\s  ]+(?:,\d+)?)$/.exec(s.trim());
  if (!m) return Number.NaN;
  const v = Number(m[2]!.replace(/[\s  ]/g, '').replace(',', '.'));
  return m[1] === '-' || m[1] === '−' ? -v : v;
}

/** Odmiana angielska: „1 pallet”, „2 pallets”, „0 pallets”. */
export const enPlural = (n: number, one: string, many: string): string => (Math.abs(n) === 1 ? one : many);
