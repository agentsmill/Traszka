/** Formatowanie liczb w interfejsie gry (polski zapis: spacja tysięcy, przecinek). */

export const zl = (n: number): string => `${Math.round(n).toLocaleString('pl-PL')} zł`;

export const zl2 = (n: number): string =>
  `${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

export const signedZl = (n: number): string => `${n >= 0 ? '+' : '−'}${zl(Math.abs(n))}`;

/** Stan pieniędzy (gotówka, saldo): ujemny z „−” (U+2212), dodatni bez „+”. `zl` dałoby tu łącznik, a `signedZl` plus. */
export const money = (n: number): string => (Math.round(n) < 0 ? `−${zl(-n)}` : zl(Math.abs(n)));

/** Kwota odejmowana na wyciągu: „−1 200 zł”; zero zostaje „0 zł” (bez „−0”). */
export const minusZl = (n: number): string => (Math.round(n) > 0 ? `−${zl(n)}` : zl(0));

/** Udział jako procent z co najwyżej jednym miejscem po przecinku: 0,012 daje „1,2%”, 0,04 daje „4%”. */
export const percentOf = (share: number): string => `${(Math.round(share * 1000) / 10).toLocaleString('pl-PL')}%`;

export const int = (n: number): string => Math.round(n).toLocaleString('pl-PL');

/** Osoby albo osobominuty z jednym miejscem po przecinku, bez zbędnego „,0”: „1”, „0,4”, „1,7”. */
export const people = (n: number): string => (Math.round(n * 10) / 10).toLocaleString('pl-PL');

/** Zmiana punktów (zaufanie) ze znakiem: „+3”, „−2,5”. Jedno miejsce po przecinku, tylko gdy liczba nie jest całkowita; zero bez znaku. */
export function signedPts(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '0';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}`;
}

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
