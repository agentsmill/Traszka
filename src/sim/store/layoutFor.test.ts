import { describe, expect, it } from 'vitest';
import { REMONTS } from '@/sim/economy/upgrades';
import { generateStore } from './generateStore';
import { layoutFor } from './layoutFor';

const SEEDS = ['kiełbasa-42', 'traszka-1', 'pawilon-7', 'rynek-3'];

describe('layoutFor', () => {
  it('poziom 0 to generateStore(seed)', () => {
    for (const seed of SEEDS) expect(layoutFor(seed, 0), seed).toEqual(generateStore(seed));
  });

  it('poziomy 1..3: większy lokal, ten sam rodzaj, sloty z REMONTS', () => {
    for (const seed of SEEDS) {
      const base = layoutFor(seed, 0);
      for (const r of REMONTS) {
        const l = layoutFor(seed, r.level);
        expect(l.width, `${seed} @${r.level}`).toBeGreaterThanOrEqual(base.width);
        expect(l.lot.kind, `${seed} @${r.level}`).toBe(base.lot.kind);
        expect(l.fixtures.filter((f) => f.kind === 'equipmentSlot').length, `${seed} @${r.level}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
