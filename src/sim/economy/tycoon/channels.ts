/**
 * Kanały losowości modułów tycoona: trzeci argument `rand01(seedHash, zdarzenie, kanał)`. Zakres 100–199 jest
 * zarezerwowany dla tych modułów (ekonomia używa numerów poniżej 100), więc nowy kanał nie zmienia przebiegu starych
 * zapisów, a dwa moduły nie losują z tego samego strumienia.
 */
export const CH = {
  /** Ile kart decyzji przynosi dzień. */
  cardCount: 100,
  /** Które karty (zdarzenie = dzień × 16 + numer losowania). */
  cardPick: 101,
  /** Liczby na karcie (ile kanapek, jaki rabat). */
  cardParam: 102,
  /** Ryzyko w odpowiedzi („30% szans na mandat”); zdarzenie = numer karty. */
  cardRisk: 103,
  /** Odstęp do następnego okólnika Centrali (2–4 dni). */
  circularGap: 104,
  /** Który okólnik. */
  circularPick: 105,
  /** Pogoda dnia (zaczep dla przyszłego systemu pogody). */
  weather: 110,
  /** Rodzaj KPI tygodnia. */
  kpiKind: 120,
  /** Komentarz Centrali w raporcie miesięcznym. */
  comment: 130,
  /** Makieta sklepu do botów: przyjścia klientów i mandaty. */
  sandboxArrivals: 180,
  sandboxFine: 181,
} as const;

export const CHANNEL_RANGE: readonly [number, number] = [100, 199];
