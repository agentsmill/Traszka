/**
 * Matematyka ekonomii bez funkcji, których wynik zależy od silnika JS. ECMAScript nie wymaga poprawnego zaokrąglenia od
 * `**` z wykładnikiem ułamkowym ani od `Math.log10`, więc V8, JavaScriptCore i SpiderMonkey mogą się różnić ostatnim bitem.
 * Serwer odtwarzający bieg z seeda i dziennika poleceń musi dostać te same liczby co przeglądarka, więc tu liczymy tylko
 * tym, co jest dokładne w każdym silniku: mnożeniem double (IEEE 754), arytmetyką BigInt i literałami.
 * Testy (`exactMath.test.ts`) dowodzą, że wartości są te same, co z dawnych wzorów w V8.
 */

/** `base` do całkowitej potęgi `n` ≥ 0 pętlą mnożeń, zamiast `base ** n`, którego `Math.pow` bywa różny między silnikami. */
export function powInt(base: number, n: number): number {
  let r = 1;
  for (let i = 0; i < n; i++) r *= base;
  return r;
}

/**
 * `n ** 1.4` dla n = 0..40 (mandat rośnie z liczbą palet na chodniku), zapisane jako literały: to wartości z V8, a najkrótszy
 * zapis dziesiętny odtwarza tę samą liczbę w każdym silniku. Wykładnik 1,4 nie jest dokładnie 7/5 w double, stąd np.
 * `32 ** 1.4` to 127,99999999999996, a nie 128; zachowujemy te liczby, żeby wartości w grze się nie zmieniły.
 */
export const FINE_PALLET_POW: readonly number[] = [
  0, 1, 2.6390158215457884, 4.655536721746079,
  6.964404506368992, 9.518269693579391, 12.286035066475314, 15.245344971379456,
  18.379173679952558, 21.674022167526225, 25.118864315095795, 28.7044849880676,
  32.423040924494714, 36.26775666655811, 40.23270658439391, 44.31265408594165,
  48.50293012833273, 52.799339527161436, 57.19808741663585, 61.69572063157768,
  66.28908034679972, 70.97526334994397, 75.75159003283396, 80.61557767989763,
  85.56491798236814, 90.59745795971192, 95.71118365501958, 100.90420610885687,
  106.17474921982495, 111.52113917914444, 116.94179522748564, 122.43522152965917,
  127.99999999999996, 133.63478394075776, 139.33829237934694, 145.10930500924405,
  150.94665765466107, 156.84923819163083, 162.81598286840241, 168.84587297651242,
  174.93793183092444,
];

/**
 * Największa potęga dziesięciu ≤ `n` (dla n ≥ 1), zamiast `10 ** Math.floor(Math.log10(n))`. Potęgi 10 do 1e22 są dokładne
 * w double, więc do tej granicy wynik jest ten sam co z `**` i `Math.log10`; wyżej mnożenie dalej jest deterministyczne,
 * tylko już nie musi się zgadzać z `**`. Granica 1e300 chroni przed pętlą bez końca dla `Infinity`.
 */
export function pow10Floor(n: number): number {
  let p = 1;
  while (p < 1e300 && p * 10 <= n) p *= 10;
  return p;
}

/** `b` do całkowitej potęgi `n` ≥ 0 w BigInt (operator `**` jest zakazany w `src/sim` także dla BigInt). */
function bigPow(b: bigint, n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= b;
  return r;
}

/**
 * `Math.round(120 * level ** 1.55)` liczone dokładnie. Wykładnik 1,55 to 31/20, więc szukamy całkowitego r najbliższego
 * 120 · L^(31/20), czyli r^20 ≈ 120^20 · L^31 = N. Najpierw największe r z r^20 ≤ N (wyszukiwanie binarne), potem
 * zaokrąglenie w górę, gdy r + ½ też mieści się pod N: (2r + 1)^20 ≤ N · 2^20. Dokładny wynik zgadza się z V8 na poziomach
 * 1..10 000 (test); wykładnik 1,55 jako double nie jest równy 31/20, ale różnica (4·10^-17 względnie) nie dochodzi do półki
 * zaokrąglenia na żadnym z nich.
 */
function xpExact(level: number): number {
  const n = bigPow(120n, 20) * bigPow(BigInt(level), 31);
  // r < 2^ceil(bitów(N) / 20), bo N < 2^bity
  let lo = 0n;
  let hi = 1n << BigInt(Math.ceil(n.toString(2).length / 20));
  while (hi - lo > 1n) {
    const mid = (lo + hi) >> 1n;
    if (bigPow(mid, 20) <= n) lo = mid; else hi = mid;
  }
  return Number(bigPow(2n * lo + 1n, 20) <= n * bigPow(2n, 20) ? lo + 1n : lo);
}

/** Pamięć podręczna: `processLevels` pyta o XP do następnego poziomu co minutę, a interfejs przy każdym odświeżeniu. */
const XP_CACHE = new Map<number, number>();

/** XP do następnego poziomu: `Math.round(120 * level ** 1.55)` dla całkowitego `level` ≥ 0, w liczbach dokładnych. */
export function xpCurve(level: number): number {
  if (!Number.isSafeInteger(level) || level < 0) throw new RangeError(`xpCurve: poziom musi być liczbą całkowitą ≥ 0, jest ${level}`);
  let xp = XP_CACHE.get(level);
  if (xp === undefined) {
    xp = xpExact(level);
    XP_CACHE.set(level, xp);
  }
  return xp;
}
