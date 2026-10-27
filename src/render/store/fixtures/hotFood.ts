import type { Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import { PALETTE } from '@/render/style';
import { BRAND, FIX, box, cyl, fixtureFrame, glassMat, glow, gloss, matte, painted, plateSign, spread, woodMat } from '../parts';

export const HOT_FOOD_ROLLERS = 5;

/**
 * Hot-dogi „Traszdog”: zielona szafka z blatem, grill z 5 rolkami (grzałka: emissive brand.orange 1,5),
 * parówki w rowkach między rolkami, szklana obudowa (front, boki, góra) i podświetlana tabliczka z ceną.
 * Front (+z) to strona klienta, obsługa sięga od strony −z.
 */
export function buildHotFood(f: Fixture): Object3D {
  const { root, inner, length: L, depth: D } = fixtureFrame(f);
  const frame = painted(PALETTE.fixture.fridgeFrame);
  const metal = painted(FIX.metal);
  const TOP = 0.89;

  box(inner, [L - 0.06, 0.1, D - 0.06], [0, 0, 0], frame, { name: 'plinth' });
  box(inner, [L - 0.08, 0.72, D - 0.06], [0, 0.1, 0], matte(BRAND.green), { name: 'body' });
  box(inner, [L - 0.12, 0.05, 0.012], [0, 0.42, (D - 0.06) / 2 + 0.006], gloss(BRAND.orange), { name: 'stripe' });
  box(inner, [L, 0.07, D], [0, 0.82, 0], woodMat(FIX.wood), { name: 'counterTop', seg: 3, radius: 0.032 });

  // grill: taca, 5 rozgrzanych rolek i parówki leżące w rowkach
  box(inner, [L - 0.14, 0.04, D - 0.14], [0, TOP, 0], metal, { name: 'tray' });
  const rollerY = TOP + 0.04 + 0.024;
  const xs = spread(HOT_FOOD_ROLLERS, (L - 0.3) / 2);
  for (const x of xs) cyl(inner, 0.022, D - 0.2, [x, rollerY, 0], glow(BRAND.orange, 1.5), { name: 'roller', rot: [Math.PI / 2, 0, 0], cast: false });
  for (let i = 0; i < xs.length - 1; i++) {
    cyl(inner, 0.019, D - 0.24, [(xs[i]! + xs[i + 1]!) / 2, rollerY + 0.025, 0], matte(PALETTE.productCategory.przekaski[2]), { name: 'sausage', rot: [Math.PI / 2, 0, 0] });
  }

  // szklana obudowa: cztery słupki, front, dwa boki i góra (tył otwarty dla obsługi)
  const hx = L / 2 - 0.08;
  const hz = D / 2 - 0.07;
  const HOOD = 0.24;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(inner, [0.02, HOOD, 0.02], [sx * hx, TOP + 0.04, sz * hz], metal, { name: 'hood post' });
  box(inner, [hx * 2, HOOD - 0.02, 0.01], [0, TOP + 0.05, hz], glassMat(), { name: 'hood front' });
  for (const sx of [-1, 1]) box(inner, [0.01, HOOD - 0.02, hz * 2], [sx * hx, TOP + 0.05, 0], glassMat(), { name: 'hood side' });
  box(inner, [hx * 2, 0.01, hz * 2], [0, TOP + 0.04 + HOOD, 0], glassMat(), { name: 'hood top' });

  // tabliczka z ceną na dwóch słupkach przy tylnej krawędzi
  const signZ = -D / 2 + 0.05;
  for (const sx of [-1, 1]) box(inner, [0.02, 0.4, 0.02], [sx * (L / 2 - 0.1), TOP + 0.04, signZ], metal, { name: 'sign post' });
  box(inner, [L - 0.16, 0.17, 0.03], [0, TOP + 0.44, signZ], gloss(BRAND.orange), { name: 'sign' });
  plateSign(inner, 'TRASZDOG 4,99', [0.56, 0.14], [0, TOP + 0.525, signZ + 0.016], 1);
  return root;
}
