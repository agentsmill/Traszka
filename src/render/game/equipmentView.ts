import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type BufferGeometry, type Object3D } from 'three';
import { cellToWorld } from '@/render/coords';
import { M } from '@/render/store/parts';
import { buildSelfCheckout } from '@/render/store/fixtures';
import { buildAtm, buildParcelLocker, buildPizzaOven, buildSelfCheckoutSlim } from '@/render/store/fixtures/equipment';
import { buildSlotMarker } from '@/render/store/fixtures/slotMarker';
import { mergedGroup, type StoreView } from '@/render/store/buildStore';
import { slotUnits } from '@/sim/economy/slots';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import type { EquipmentId } from '@/sim/economy/upgrades';
import type { Fixture, StoreLayout } from '@/sim/store/types';

/** Kliknięcie w slot (znacznik albo stojący w nim sprzęt) otwiera kartę slotu. */
export const PICK_SLOT = 'slot';

function buildUnit(id: EquipmentId, f: Fixture): Object3D {
  const half = f.w * f.d === 2;
  switch (id) {
    case 'sco': return half && f.kind === 'equipmentSlot' ? buildSelfCheckoutSlim(f) : buildSelfCheckout(f);
    case 'bankomat': return buildAtm(f);
    case 'paczkownik': return buildParcelLocker(f);
    case 'piec': return buildPizzaOven(f);
  }
}

export interface EquipmentView {
  root: Group;
  /** Odbudowuje sprzęt w slotach, gdy zmieniła się zajętość (`key` to podpis zajętości). */
  sync(usage: Map<string, EquipmentId[]>): void;
  dispose(): void;
}

/**
 * Sprzęt w slotach. Znacznik slotu z buildStore chowa się, gdy w slocie coś stoi; wolna połówka slotu 2×2 dostaje
 * własny, mniejszy znacznik. Cały sprzęt jest scalony w jedną siatkę na materiał (kilkanaście kas samoobsługowych to
 * wciąż kilka wywołań rysowania), a stukanie łapią niewidoczne bryły nad slotami z `userData.pick = { kind: 'slot', slotId }`.
 */
export function createEquipmentView(layout: StoreLayout, info: StoreInfo, store: StoreView): EquipmentView {
  const root = new Group();
  root.name = 'equipment';
  let signature = '';
  let owned: BufferGeometry[] = [];
  const pickMaterial = new MeshBasicMaterial({ visible: false });
  const pickGeometries: BufferGeometry[] = [];

  const place = (obj: Object3D, f: Fixture): void => {
    const c = cellToWorld(layout, f.x, f.y);
    obj.position.set(c.x - M / 2, 0, c.z - M / 2);
  };

  // niewidoczne bryły do stukania: na każdy slot, stałe przez całe życie widoku
  const picks = new Group();
  picks.name = 'slot picks';
  for (const slot of info.slots) {
    const f = slot.fixture;
    const g = new BoxGeometry(f.w * M, 1.4, f.d * M);
    pickGeometries.push(g);
    const box = new Mesh(g, pickMaterial);
    const a = cellToWorld(layout, f.x, f.y);
    const b = cellToWorld(layout, f.x + f.w - 1, f.y + f.d - 1);
    box.position.set((a.x + b.x) / 2, 0.7, (a.z + b.z) / 2);
    box.userData = { pick: { kind: PICK_SLOT, slotId: slot.id } };
    picks.add(box);
  }
  const merged = new Group();
  merged.name = 'equipment merged';
  root.add(merged, picks);

  return {
    root,
    sync(usage) {
      const next = info.slots.map((x) => `${x.id}=${(usage.get(x.id) ?? []).join('+')}`).join('|');
      if (next === signature) return;
      signature = next;
      merged.clear();
      for (const g of owned) g.dispose();
      owned = [];
      const sources: Object3D[] = [];
      for (const slot of info.slots) {
        const items = usage.get(slot.id) ?? [];
        const marker = store.root.getObjectByName(slot.id);
        if (marker) marker.visible = items.length === 0;
        if (items.length === 0) continue;
        for (const unit of slotUnits(layout, slot, items)) {
          const obj = unit.equipment ? buildUnit(unit.equipment, unit.fixture) : buildSlotMarker(unit.fixture);
          place(obj, unit.fixture);
          sources.push(obj);
        }
      }
      if (sources.length > 0) merged.add(...mergedGroup('equipment', sources, owned).children);
    },
    dispose() {
      root.removeFromParent();
      for (const g of [...owned, ...pickGeometries]) g.dispose();
      pickMaterial.dispose();
    },
  };
}
