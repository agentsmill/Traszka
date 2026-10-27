import type { Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import { PALETTE } from '@/render/style';
import {
  BRAND, CATEGORY_LABEL, FIX, box, fixtureFrame, glassMat, glow, gloss, matte, painted, pickCategories, plateSign,
  type Category, type ShelfSlotLocal,
} from '../parts';

export const FRIDGE_FIRST_TOP = 0.24;
export const FRIDGE_STEP = 0.38;
export const FRIDGE_LEVELS = 4;

/**
 * Lodówka z szklanymi drzwiami, 2,0 m: cokół z kratką, rama `fixture.fridgeFrame`, drzwi (rama + szyba + uchwyt),
 * świecące listwy LED w środku, 4 metalowe półki i zielona nadstawka z tabliczką. Tył przy ścianie, front +z.
 * Kolor LED: brand.cream, emissive 2,2 (docs/style-guide.md §4).
 */
export function buildFridge(f: Fixture, seed = ''): Object3D {
  const { root, inner, length, depth, toRoot, rotY } = fixtureFrame(f);
  const [category] = pickCategories(seed, f.id, ['napoje', 'nabial'], 1) as [Category];

  const W = length - 0.02;               // 1 cm luzu z każdej strony: sąsiednie lodówki tworzą ścianę ze szwem
  const back = -depth / 2;
  const frontZ = back + depth - 0.16;    // płaszczyzna drzwi (zostaje ~16 cm podestu przed lodówką)
  const bodyDepth = frontZ + 0.04 - back;
  const frame = painted(PALETTE.fixture.fridgeFrame);
  const BODY_BOTTOM = 0.12;
  const BODY_TOP = 1.8;
  const cz = back + bodyDepth / 2;

  box(inner, [W - 0.06, 0.12, bodyDepth - 0.06], [0, 0, cz], frame, { name: 'plinth' });
  box(inner, [W * 0.6, 0.05, 0.012], [0, 0.035, cz + (bodyDepth - 0.06) / 2 + 0.004], painted(FIX.metal), { name: 'grille' });
  for (const s of [-1, 1]) box(inner, [0.06, BODY_TOP - BODY_BOTTOM, bodyDepth], [s * (W / 2 - 0.03), BODY_BOTTOM, cz], frame, { name: 'side' });
  // plecy: kremowe od środka, z zewnątrz w kolorze ramy z kratką skraplacza i tabliczką marki (w przekroju ściana za
  // lodówką znika, więc tył widać z sali; zadanie 16, decyzja R22)
  box(inner, [W - 0.1, BODY_TOP - BODY_BOTTOM, 0.03], [0, BODY_BOTTOM, back + 0.027], matte(PALETTE.wall[0]), { name: 'inner back' });
  box(inner, [W - 0.06, BODY_TOP - BODY_BOTTOM + 0.1, 0.012], [0, 0.02, back + 0.006], frame, { name: 'outer back', seg: 1, radius: 0.004 });
  for (let k = 0; k < 4; k++) {
    box(inner, [W * 0.7, 0.025, 0.008], [0, BODY_TOP - 0.34 + k * 0.07, back - 0.002], painted(FIX.metal), { name: 'condenser grille', seg: 1, radius: 0.003 });
  }
  plateSign(inner, 'TRASZKA', [Math.min(0.56, W - 0.2), Math.min(0.56, W - 0.2) / 4], [0, 0.9, back - 0.001], -1);

  // rama otworu drzwi: dwa słupki, górna i dolna poprzeczka
  const openW = W - 0.12;                // między słupkami (po 6 cm z każdej strony)
  for (const s of [-1, 1]) box(inner, [0.06, BODY_TOP - BODY_BOTTOM, 0.06], [s * (W / 2 - 0.03), BODY_BOTTOM, frontZ + 0.01], frame, { name: 'stile' });
  box(inner, [W, 0.07, 0.06], [0, BODY_BOTTOM, frontZ + 0.01], frame, { name: 'sill' });
  box(inner, [W, 0.07, 0.06], [0, BODY_TOP - 0.07, frontZ + 0.01], frame, { name: 'head' });

  // drzwi: rama z cienkich listew, szyba i pionowy uchwyt przy środku
  const doors = Math.max(1, Math.round(length / 0.5));
  const doorW = openW / doors;
  const doorH = BODY_TOP - BODY_BOTTOM - 0.14;
  for (let i = 0; i < doors; i++) {
    const cx = -openW / 2 + doorW * (i + 0.5);
    const z = frontZ + 0.035;
    for (const s of [-1, 1]) box(inner, [0.03, doorH, 0.04], [cx + s * (doorW / 2 - 0.015), BODY_BOTTOM + 0.07, z], frame, { name: 'door frame' });
    for (const y of [BODY_BOTTOM + 0.07, BODY_TOP - 0.07 - 0.03]) box(inner, [doorW - 0.06, 0.03, 0.04], [cx, y, z], frame, { name: 'door frame' });
    box(inner, [doorW - 0.06, doorH - 0.06, 0.012], [cx, BODY_BOTTOM + 0.1, z], glassMat(), { name: 'door glass' });
    // uchwyt przy krawędzi sąsiada (parzyste drzwi: prawa krawędź, nieparzyste: lewa)
    const side = i % 2 === 0 ? 1 : -1;
    box(inner, [0.025, 0.55, 0.03], [cx + side * (doorW / 2 - 0.045), 0.7, z + 0.04], painted(FIX.metal), { name: 'handle' });
  }

  // półki z siatki (metal) i świecące listwy LED po bokach drzwi oraz pod nadstawką
  const shelfDepth = bodyDepth - 0.14;
  const shelfZ = back + 0.03 + shelfDepth / 2;
  for (let k = 0; k < FRIDGE_LEVELS; k++) {
    box(inner, [openW - 0.02, 0.04, shelfDepth], [0, FRIDGE_FIRST_TOP - 0.04 + k * FRIDGE_STEP, shelfZ], painted(FIX.metal), { name: 'shelf' });
  }
  const led = glow(BRAND.cream, 2.2);
  for (const s of [-1, 1]) box(inner, [0.02, BODY_TOP - BODY_BOTTOM - 0.2, 0.015], [s * (openW / 2 - 0.02), BODY_BOTTOM + 0.1, frontZ - 0.02], led, { name: 'led', cast: false });
  box(inner, [openW - 0.1, 0.02, 0.02], [0, BODY_TOP - 0.11, frontZ - 0.03], led, { name: 'led', cast: false });

  // nadstawka (1,8–2,0 m): zielona belka, pomarańczowa listwa i tabliczka z kategorią
  box(inner, [W, 0.2, bodyDepth], [0, BODY_TOP, cz], matte(BRAND.green), { name: 'header' });
  box(inner, [W + 0.01, 0.02, bodyDepth + 0.01], [0, BODY_TOP - 0.01, cz], gloss(BRAND.orange), { name: 'trim' });
  const plateW = Math.min(W - 0.2, 0.72);
  plateSign(inner, CATEGORY_LABEL[category], [plateW, plateW / 4], [0, BODY_TOP + 0.1, back + bodyDepth + 0.001], 1);

  const slot: ShelfSlotLocal = {
    position: toRoot([0, FRIDGE_FIRST_TOP, shelfZ]),
    width: openW - 0.04,
    depth: shelfDepth,
    levels: FRIDGE_LEVELS,
    levelStep: FRIDGE_STEP,
    rotationY: rotY,
    category,
  };
  root.userData.shelfSlots = [slot];
  return root;
}
