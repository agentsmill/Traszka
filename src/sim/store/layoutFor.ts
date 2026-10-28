import { REMONTS } from '@/sim/economy/upgrades';
import { subSeed } from '@/sim/rng';
import { generateStore } from './generateStore';
import type { StoreLayout } from './types';

/**
 * Układ sklepu po `level` remontach: ten sam rodzaj lokalu, większe wymiary i więcej slotów sprzętu. Generator dostaje
 * osobny podseed na każdy poziom; gdyby nie znalazł układu, próbuje kolejnych, a na końcu z mniejszym przyrostem.
 * Mieszka w symulacji (a nie w `game/session`), bo serwer odtwarza przebieg z (seed, dziennik poleceń) i musi dostać
 * ten sam układ po remoncie co przeglądarka.
 */
export function layoutFor(seed: string, level: number): StoreLayout {
  const base = generateStore(seed);
  const r = REMONTS[Math.min(level, REMONTS.length) - 1];
  if (!r) return base;
  for (const scale of [1, 0.75, 0.5]) {
    const lot = {
      ...base.lot,
      interiorWidth: base.lot.interiorWidth + Math.round(r.grow[0] * scale),
      salesDepth: base.lot.salesDepth + Math.round(r.grow[1] * scale),
      backroomDepth: base.lot.backroomDepth + Math.round(r.grow[2] * scale),
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return generateStore(subSeed(seed, `remont:${r.level}:${attempt}`), lot, { equipmentSlots: r.slots });
      } catch {
        // kolejna próba
      }
    }
  }
  return base;
}
