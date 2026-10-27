import { createRng, subSeed } from '@/sim/rng';
import type { LotKind, LotSpec } from './types';

/** Zakresy wymiarów lokalu w kratkach (włącznie) i szansa na lokal narożny. */
export const LOT_RANGES: Record<LotKind, {
  interiorWidth: [number, number]; salesDepth: [number, number]; backroomDepth: [number, number]; cornerChance: number;
}> = {
  blok:      { interiorWidth: [16, 20], salesDepth: [12, 16], backroomDepth: [4, 6], cornerChance: 0 },
  kamienica: { interiorWidth: [12, 18], salesDepth: [12, 16], backroomDepth: [3, 4], cornerChance: 0.5 },
  pawilon:   { interiorWidth: [20, 26], salesDepth: [16, 20], backroomDepth: [6, 8], cornerChance: 0 },
};

export const LOT_WEIGHTS: Record<LotKind, number> = { blok: 0.45, kamienica: 0.35, pawilon: 0.2 };

const LOT_KINDS: readonly LotKind[] = ['blok', 'kamienica', 'pawilon'];

/** Losuje lokal z seeda (strumień `lot`): rodzaj wg LOT_WEIGHTS, potem wymiary z LOT_RANGES. */
export function pickLot(seed: string): LotSpec {
  const rng = createRng(subSeed(seed, 'lot'));

  const roll = rng.next() * LOT_KINDS.reduce((sum, k) => sum + LOT_WEIGHTS[k], 0);
  let acc = 0;
  let kind = LOT_KINDS[LOT_KINDS.length - 1]!;
  for (const k of LOT_KINDS) {
    acc += LOT_WEIGHTS[k];
    if (roll < acc) { kind = k; break; }
  }

  const r = LOT_RANGES[kind];
  const between = ([min, max]: [number, number]): number => rng.int(min, max + 1);
  return {
    kind,
    interiorWidth: between(r.interiorWidth),
    salesDepth: between(r.salesDepth),
    backroomDepth: between(r.backroomDepth),
    corner: rng.chance(r.cornerChance),
  };
}
