import type { Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import {
  BRAND, CATEGORY_LABEL, FIX, box, fixtureFrame, matte, painted, pickCategories, plateSign, priceRail,
  type Category, type ShelfSlotLocal,
} from '../parts';

export const WALL_SHELF_FIRST_TOP = 0.15;
export const WALL_SHELF_STEP = 0.32;
export const WALL_SHELF_LEVELS = 5;

/**
 * Regał ścienny jednostronny, 2,0 m: tył przy ścianie, cokół, plecy, boczne ścianki, słupki, 5 półek z listwą
 * cenową i zielona nadstawka z tabliczką kategorii. Front (+z kanoniczne) to strona klienta.
 */
export function buildWallShelf(f: Fixture, seed = ''): Object3D {
  const { root, inner, length: L, depth: D, toRoot, rotY } = fixtureFrame(f);
  const [category] = pickCategories(seed, f.id, ['pieczywo', 'alkohol', 'chemia', 'przekaski', 'slodycze'], 1) as [Category];

  const body = matte(FIX.shelf);
  const green = matte(BRAND.green);
  const back = -D / 2;
  const BODY_BOTTOM = 0.11;
  const BODY_TOP = 1.74;

  box(inner, [L - 0.06, 0.11, D - 0.03], [0, 0, back + (D - 0.03) / 2], green, { name: 'plinth' });
  box(inner, [L - 0.08, BODY_TOP - BODY_BOTTOM, 0.028], [0, BODY_BOTTOM, back + 0.026], body, { name: 'back' });
  // tył (widoczny z drugiej strony ściany w przekroju): pomarańczowy pas i tabliczka marki
  box(inner, [L - 0.12, 0.05, 0.012], [0, 0.9, back + 0.006], matte(BRAND.orange), { name: 'back stripe', seg: 1, radius: 0.008 });
  plateSign(inner, 'TRASZKA', [Math.min(0.6, L - 0.3), Math.min(0.6, L - 0.3) / 4], [0, 1.2, back - 0.001], -1);
  for (const s of [-1, 1]) box(inner, [0.045, BODY_TOP - BODY_BOTTOM, D - 0.02], [s * (L / 2 - 0.0225), BODY_BOTTOM, back + (D - 0.02) / 2], body, { name: 'end' });

  const posts = Math.max(2, Math.round(L / 1.0) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -(L / 2 - 0.1) + (i * (L - 0.2)) / (posts - 1);
    box(inner, [0.07, BODY_TOP - BODY_BOTTOM, 0.07], [x, BODY_BOTTOM, back + 0.075], painted(FIX.metal), { name: 'post' });
  }

  const shelfDepth = D - 0.07;
  const shelfCenterZ = back + 0.04 + shelfDepth / 2;
  const front = back + 0.04 + shelfDepth + 0.03;      // przednia płaszczyzna listwy cenowej
  for (let k = 0; k < WALL_SHELF_LEVELS; k++) {
    const top = WALL_SHELF_FIRST_TOP + k * WALL_SHELF_STEP;
    box(inner, [L - 0.1, 0.04, shelfDepth], [0, top - 0.04, shelfCenterZ], body, { name: 'shelf' });
    priceRail(inner, L - 0.1, 0, top - 0.04, front, 1);
  }

  // nadstawka (1,74–2,0 m) z pomarańczową listwą u dołu i tabliczką kategorii
  box(inner, [L, 0.26, D - 0.02], [0, BODY_TOP, back + (D - 0.02) / 2], green, { name: 'header' });
  box(inner, [L + 0.01, 0.02, D - 0.01], [0, BODY_TOP - 0.02, back + (D - 0.01) / 2], matte(BRAND.orange), { name: 'trim' });
  const plateW = Math.min(L - 0.3, 0.8);
  plateSign(inner, CATEGORY_LABEL[category], [plateW, plateW / 4], [0, BODY_TOP + 0.13, back + D - 0.02 + 0.001], 1);

  const slot: ShelfSlotLocal = {
    position: toRoot([0, WALL_SHELF_FIRST_TOP, shelfCenterZ]),
    width: L - 0.1,
    depth: shelfDepth,
    levels: WALL_SHELF_LEVELS,
    levelStep: WALL_SHELF_STEP,
    rotationY: rotY,
    category,
  };
  root.userData.shelfSlots = [slot];
  return root;
}
