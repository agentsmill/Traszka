/**
 * Drobne strażniki typów do wczytywania danych spoza programu (zapis w przeglądarce, JSON). Zapis może być ucięty, ręcznie
 * zmieniony albo zepsuty przez dawny błąd (JSON zapisuje NaN jako null), więc nic z niego nie bierzemy na wiarę.
 */

export type Rec = Record<string, unknown>;

export const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Liczba skończona przycięta do [min, max]; wszystko inne (null, tekst, NaN, ∞) daje `fallback`. */
export const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  (isNum(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** To samo co `num`, ale zaokrąglone do liczby całkowitej (numery, indeksy, poziomy). */
export const whole = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  (isNum(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback);
