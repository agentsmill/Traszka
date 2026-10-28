/** Formatowanie liczb w interfejsie gry (polski zapis: spacja tysięcy, przecinek). */

export const zl = (n: number): string => `${Math.round(n).toLocaleString('pl-PL')} zł`;

export const zl2 = (n: number): string =>
  `${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

export const signedZl = (n: number): string => `${n >= 0 ? '+' : '−'}${zl(Math.abs(n))}`;

export const int = (n: number): string => Math.round(n).toLocaleString('pl-PL');

export const pct = (x: number): string => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;

/** „1 h 20 min”, „35 min” */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

/** Odmiana: 1 osoba, 2 osoby, 5 osób. */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n === 1) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}
