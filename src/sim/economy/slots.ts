import type { Cell } from '@/sim/grid';
import type { Fixture, StoreLayout } from '@/sim/store/types';
import { accessCells } from '@/sim/store/validate';
import type { SlotInfo } from './storeInfo';
import { EQUIPMENT_BY_ID, type EquipmentId } from './upgrades';

/**
 * Część slotu zajęta przez jeden sprzęt: obrys (podzbiór slotu z tym samym frontem) i kratka dostępu przed nim.
 * Slot 2×2 dzieli się wzdłuż frontu na dwie połówki 1×2 (dwie kompaktowe kasy obok siebie); sprzęt rozmiaru 2 bierze cały.
 */
export interface SlotUnit { equipment: EquipmentId | null; fixture: Fixture; access: Cell | null }

function halves(f: Fixture): Fixture[] {
  const alongX = f.facing === 'N' || f.facing === 'S';
  return [0, 1].map((i) => alongX
    ? { ...f, id: `${f.id}:${i}`, x: f.x + i, w: 1 }
    : { ...f, id: `${f.id}:${i}`, y: f.y + i, d: 1 });
}

/** Rozkład slotu na sprzęt w kolejności zakupu; wolne połówki mają `equipment: null`. */
export function slotUnits(layout: StoreLayout, slot: SlotInfo, equipment: readonly EquipmentId[]): SlotUnit[] {
  const f = slot.fixture;
  const access = (x: Fixture): Cell | null => {
    const cells = accessCells(layout, x);
    return cells[cells.length - 1] ?? null;
  };
  if (slot.capacity === 1) return [{ equipment: equipment[0] ?? null, fixture: f, access: access(f) }];
  const big = equipment.find((id) => EQUIPMENT_BY_ID[id].size === 2);
  if (big) return [{ equipment: big, fixture: f, access: access(f) }];
  return halves(f).map((h, i) => ({ equipment: equipment[i] ?? null, fixture: h, access: access(h) }));
}
