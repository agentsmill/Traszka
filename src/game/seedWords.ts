/** 50 słów do czytelnych seedów („pierogi-731”): same małe litery ASCII, żeby adres nie wymagał kodowania. */
export const SEED_WORDS: readonly string[] = [
  'pierogi', 'bigos', 'zurek', 'kielbasa', 'oscypek', 'paczek', 'drozdzowka', 'faworki', 'sernik', 'makowiec',
  'babka', 'placek', 'kotlet', 'schabowy', 'kopytka', 'kluski', 'gulasz', 'flaki', 'barszcz', 'rosol',
  'ogorek', 'kapusta', 'ziemniak', 'buraczek', 'rzodkiewka', 'jablko', 'sliwka', 'malina', 'truskawka', 'borowka',
  'wisnia', 'gruszka', 'chleb', 'bulka', 'precel', 'obwarzanek', 'zapiekanka', 'kajzerka', 'powidla', 'miodownik',
  'szarlotka', 'krowka', 'kefir', 'maslanka', 'twarog', 'smietana', 'grzaniec', 'kompot', 'herbata', 'kawa',
];

/** Liczba całkowita 0…2³²−1 z `crypto` (nieprzewidywalna przy każdym wejściu na stronę). */
export const randomUint32 = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!;

/**
 * Losowy, czytelny seed: słowo z listy i liczba 100–999. Losowość z `crypto.getRandomValues` (nie Math.random:
 * seed ma być nieprzewidywalny przy każdym wejściu na stronę, a wszystko po nim jest deterministyczne).
 * `random32` (zwraca liczbę całkowitą 0…2³²−1) do podmiany w testach.
 */
export function randomSeed(random32: () => number = randomUint32): string {
  return `${SEED_WORDS[random32() % SEED_WORDS.length]}-${100 + (random32() % 900)}`;
}
