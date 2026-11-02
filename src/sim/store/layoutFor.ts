import { REMONTS } from '@/sim/economy/upgrades';
import { subSeed } from '@/sim/rng';
import { generateStore } from './generateStore';
import type { LotSpec, StoreLayout } from './types';

const slotCount = (l: StoreLayout): number => l.fixtures.filter((f) => f.kind === 'equipmentSlot').length;

/**
 * Układ sklepu po `level` remontach: ten sam rodzaj lokalu, większe wymiary i więcej slotów sprzętu. Generator dostaje
 * osobny podseed na każdy poziom; gdyby nie znalazł układu, próbuje kolejnych, a na końcu z mniejszym przyrostem.
 * Mieszka w symulacji (a nie w `game/session`), bo serwer odtwarza przebieg z (seed, dziennik poleceń) i musi dostać
 * ten sam układ po remoncie co przeglądarka. Sklep z lokalu miasta podaje jego `lot`: to on jest bazą układu (bez niego
 * lokal losuje się z seeda sklepu).
 *
 * Poziomy 1–3 przy porażce generatora wracają do układu poziomu 0 (tak było od zawsze, więc GENERATOR_VERSION zostaje). Od poziomu 4
 * sklep po remoncie nigdy się nie zmniejsza: układ musi być co najmniej tak szeroki, głęboki i mieć tyle slotów, co układ poziomu
 * niższego (generator stawia tyle slotów, ile się zmieści, więc większy lokal bywa uboższy), a gdy żadna próba tego nie spełni,
 * wraca układ poziomu niższego.
 */
export function layoutFor(seed: string, level: number, lot?: LotSpec): StoreLayout {
  const base = lot ? generateStore(seed, lot) : generateStore(seed);
  const r = REMONTS[Math.min(level, REMONTS.length) - 1];
  if (!r) return base;
  const lower = r.level >= 4 ? layoutFor(seed, r.level - 1, lot) : null;
  for (const scale of [1, 0.75, 0.5]) {
    const grown = {
      ...base.lot,
      interiorWidth: base.lot.interiorWidth + Math.round(r.grow[0] * scale),
      salesDepth: base.lot.salesDepth + Math.round(r.grow[1] * scale),
      backroomDepth: base.lot.backroomDepth + Math.round(r.grow[2] * scale),
    };
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const layout = generateStore(subSeed(seed, `remont:${r.level}:${attempt}`), grown, { equipmentSlots: r.slots });
        if (!lower || (layout.width >= lower.width && layout.depth >= lower.depth && slotCount(layout) >= slotCount(lower))) return layout;
      } catch {
        // kolejna próba
      }
    }
  }
  return lower ?? base;
}
