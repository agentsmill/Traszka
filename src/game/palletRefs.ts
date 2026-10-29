import type { PalletRef } from '@/render/staff/types';
import type { EconomyState } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';

/** Palety z niezerowym towarem, z miejscami z `info.spots` (palety bez znanego miejsca pomijamy). Tylko odczyt. */
export function palletRefsOf(s: EconomyState, info: StoreInfo): PalletRef[] {
  const out: PalletRef[] = [];
  for (const p of s.pallets) {
    if (p.total <= 0) continue;
    const spot = info.spots[p.loc][p.spot];
    // kopia, żeby widok nie miał w ręku obiektu, który należy do informacji o sklepie
    if (spot) out.push({ loc: p.loc, spot: { ...spot }, since: p.since });
  }
  return out;
}
