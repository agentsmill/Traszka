import { describe, expect, it, vi } from 'vitest';

/*
 * Ścieżka porażki generatora w `layoutFor`: prawdziwy generator na lokalach z gry prawie nigdy nie rzuca (200 seedów × 5 lokali nie
 * trafiło ani razu), więc porażkę wymuszamy. Mock przepuszcza wywołania bez `equipmentSlots` (układ bazowy) i te poniżej progu, a
 * powyżej progu rzuca jak generator, który nie złożył układu.
 */
const failFrom = vi.hoisted(() => ({ slots: Infinity }));

vi.mock('./generateStore', async (importOriginal) => {
  const real = await importOriginal<typeof import('./generateStore')>();
  return {
    ...real,
    generateStore: (...args: Parameters<typeof real.generateStore>) => {
      const slots = args[2]?.equipmentSlots;
      if (slots !== undefined && slots >= failFrom.slots) throw new Error('generateStore: brak poprawnego układu (wymuszone)');
      return real.generateStore(...args);
    },
  };
});

const { layoutFor } = await import('./layoutFor');
const { REMONTS } = await import('@/sim/economy/upgrades');

const SEEDS = ['kiełbasa-42', 'traszka-1', 'pawilon-7', 'rynek-3', 'kamienica-3'];
const slotsOf = (l: { fixtures: { kind: string }[] }): number => l.fixtures.filter((f) => f.kind === 'equipmentSlot').length;

describe('layoutFor: generator nie składa układu', () => {
  it('poziom 4 bez układu wraca do poziomu 3, a poziom 5 do poziomu 4 (sklep po remoncie się nie zmniejsza)', () => {
    for (const seed of SEEDS) {
      failFrom.slots = Infinity;
      const l3 = layoutFor(seed, 3);
      const l4 = layoutFor(seed, 4);
      expect(l4.width, seed).toBeGreaterThan(l3.width);   // prawdziwy L4
      failFrom.slots = REMONTS[4]!.slots;   // L5 (9 slotów) nie składa się
      expect(layoutFor(seed, 5), seed).toEqual(l4);
      failFrom.slots = REMONTS[3]!.slots;   // L4 (8 slotów) i L5 nie składają się
      expect(layoutFor(seed, 4), seed).toEqual(l3);
      expect(layoutFor(seed, 5), seed).toEqual(l3);
      expect(slotsOf(layoutFor(seed, 5)), seed).toBeGreaterThanOrEqual(slotsOf(l3));
    }
    failFrom.slots = Infinity;
  });

  it('poziomy 1–3 bez układu wracają do poziomu 0, jak przed etapem 4b', () => {
    for (const seed of SEEDS) {
      failFrom.slots = 1;
      const base = layoutFor(seed, 0);
      for (const level of [1, 2, 3]) expect(layoutFor(seed, level), `${seed} @${level}`).toEqual(base);
    }
    failFrom.slots = Infinity;
  });
});
