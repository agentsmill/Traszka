import type { Object3D } from 'three';
import type { Fixture, FixtureKind } from '@/sim/store/types';
import { buildBackroomDoor } from './backroomDoor';
import { buildCheckout } from './checkout';
import { buildCoffee } from './coffee';
import { buildFridge } from './fridge';
import { buildGondola } from './gondola';
import { buildHotFood } from './hotFood';
import { buildSlotMarker } from './slotMarker';
import { buildTobaccoShelf } from './tobaccoShelf';
import { buildWallShelf } from './wallShelf';

export { buildSelfCheckout } from './selfCheckout';

/**
 * Buduje mebel w układzie: origin w lewym-przednim rogu footprintu (min x, min z), osie +x/+z, y w górę od podłogi.
 * Zwrócony obiekt nazywa się `f.id`. Opcjonalny `seed` (seed sklepu) steruje wyborem kategorii na nadstawkach;
 * bez niego wynik jest deterministyczny z samego `f.id`. `userData.shelfSlots` (jeśli są) opisują półki dla towaru.
 */
export type FixtureBuilder = (f: Fixture, seed?: string) => Object3D;

/**
 * Sloty (`selfCheckoutSlot`, `equipmentSlot`) to znaczniki wolnego miejsca. Gotową kasę samoobsługową daje
 * `buildSelfCheckout` (zastąpi slot po zakupie, etap 2).
 */
export const FIXTURE_BUILDERS: Record<FixtureKind, FixtureBuilder> = {
  gondola: buildGondola,
  wallShelf: buildWallShelf,
  fridge: buildFridge,
  checkout: buildCheckout,
  tobaccoShelf: buildTobaccoShelf,
  hotFood: buildHotFood,
  coffee: buildCoffee,
  selfCheckoutSlot: buildSlotMarker,
  equipmentSlot: buildSlotMarker,
  backroomDoor: buildBackroomDoor,
};
