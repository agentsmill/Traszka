import type { Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import {
  BRAND, CATEGORY_LABEL, FIX, box, fixtureFrame, matte, painted, pickCategories, plateSign, priceRail,
  type Category, type ShelfSlotLocal,
} from '../parts';

/** Poziomy półek gondoli: wierzch najniższej półki i odstęp. Z nich liczy się też `shelfSlots` dla towaru. */
export const GONDOLA_FIRST_TOP = 0.15;
export const GONDOLA_STEP = 0.33;
export const GONDOLA_LEVELS = 4;

/**
 * Gondola dwustronna: cokół (cofnięty o 3 cm), korpus (plecy, boczne ścianki, słupki, 4 półki z listwą cenową
 * po każdej stronie) i nadstawka z tabliczką kategorii. Całość ≤ 1,6 m. Kolory: korpus `fixture.shelf`,
 * cokół i nadstawka `brand.green`, listwy `brand.orange`, cenówki `brand.cream`.
 */
export function buildGondola(f: Fixture, seed = ''): Object3D {
  const { root, inner, length: L, depth: D, toRoot, rotY } = fixtureFrame(f);
  const [catA, catB] = pickCategories(seed, f.id, ['przekaski', 'slodycze', 'chemia', 'napoje', 'pieczywo'], 2) as [Category, Category];

  const body = matte(FIX.shelf);
  const green = matte(BRAND.green);
  const BODY_BOTTOM = 0.11;
  const SPINE_TOP = 1.34;
  const half = D / 2;

  box(inner, [L - 0.06, 0.11, D - 0.06], [0, 0, 0], green, { name: 'plinth' });
  box(inner, [L - 0.08, SPINE_TOP - BODY_BOTTOM, 0.05], [0, BODY_BOTTOM, 0], body, { name: 'back' });
  for (const s of [-1, 1]) box(inner, [0.045, SPINE_TOP - BODY_BOTTOM, D - 0.04], [s * (L / 2 - 0.0225), BODY_BOTTOM, 0], body, { name: 'end' });

  // słupki co ~1 m, stojące na osi gondoli (wystają zza półek)
  const posts = Math.max(2, Math.round(L / 1.0) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -(L / 2 - 0.1) + (i * (L - 0.2)) / (posts - 1);
    box(inner, [0.07, SPINE_TOP - BODY_BOTTOM, 0.12], [x, BODY_BOTTOM, 0], painted(FIX.metal), { name: 'post' });
  }

  // półki i listwy cenowe po obu stronach
  const shelfLen = L - 0.1;
  for (const s of [-1, 1] as const) {
    for (let k = 0; k < GONDOLA_LEVELS; k++) {
      const top = GONDOLA_FIRST_TOP + k * GONDOLA_STEP;
      box(inner, [shelfLen, 0.04, half - 0.06], [0, top - 0.04, s * (0.03 + (half - 0.06) / 2)], body, { name: 'shelf' });
      priceRail(inner, shelfLen, 0, top - 0.04, s * half, s);
    }
  }

  // nadstawka: zielona belka z pomarańczową listwą u dołu i kremową tabliczką kategorii z obu stron
  box(inner, [L, 0.22, 0.16], [0, SPINE_TOP + 0.02, 0], green, { name: 'header' });
  box(inner, [L + 0.01, 0.02, 0.17], [0, SPINE_TOP, 0], matte(BRAND.orange), { name: 'trim' });
  const plateW = Math.min(L - 0.3, 0.64);
  plateSign(inner, CATEGORY_LABEL[catA], [plateW, plateW / 4], [0, SPINE_TOP + 0.13, 0.0815], 1);
  plateSign(inner, CATEGORY_LABEL[catB], [plateW, plateW / 4], [0, SPINE_TOP + 0.13, -0.0815], -1);

  const slots: ShelfSlotLocal[] = ([[catA, 1], [catB, -1]] as const).map(([category, s]) => ({
    position: toRoot([0, GONDOLA_FIRST_TOP, s * (0.03 + (half - 0.06) / 2)]),
    width: shelfLen,
    depth: half - 0.06,
    levels: GONDOLA_LEVELS,
    levelStep: GONDOLA_STEP,
    rotationY: rotY + (s === 1 ? 0 : Math.PI),
    category,
  }));
  root.userData.shelfSlots = slots;
  return root;
}
