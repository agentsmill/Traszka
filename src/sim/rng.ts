export interface Rng {
  next(): number;                                  // [0, 1)
  int(min: number, maxExclusive: number): number;  // Math.floor(next() * (max - min)) + min
  range(min: number, max: number): number;         // float [min, max)
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;                      // next() < p
  shuffle<T>(items: readonly T[]): T[];            // nowa tablica, Fisher–Yates
}

// Algorytmy według bryc/code PRNGs.md. Arytmetyka 32-bitowa: Math.imul, | 0, >>> 0.

// xmur3: hasz stringa; zwracana funkcja daje kolejne 32-bitowe wartości.
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// sfc32: generator 32-bitowy; zwraca float [0, 1).
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = ((a + b) | 0) + d | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

const DISCARD = 15;

export function hashString(s: string): number {
  return xmur3(s)();
}

export function createRng(seed: string): Rng {
  const seedHash = xmur3(seed);
  const next = sfc32(seedHash(), seedHash(), seedHash(), seedHash());
  for (let i = 0; i < DISCARD; i++) next();

  const int = (min: number, maxExclusive: number): number =>
    Math.floor(next() * (maxExclusive - min)) + min;

  return {
    next,
    int,
    range: (min, max) => next() * (max - min) + min,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new RangeError('pick: pusta tablica');
      return items[int(0, items.length)];
    },
    chance: (p) => next() < p,
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

export function subSeed(seed: string, label: string): string {
  return `${seed}:${label}`;
}
