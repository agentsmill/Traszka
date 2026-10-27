import type { Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import { PALETTE } from '@/render/style';
import { BRAND, FIX, SCREEN_COLOR, box, cyl, fixtureFrame, glow, gloss, matte, painted, plateSign, woodMat } from '../parts';

/**
 * Stanowisko kawowe: zielona szafka z blatem, ekspres (korpus, pojemnik na ziarna, dwie dysze, świecący wyświetlacz),
 * tacka ociekowa z kratką, kubek pod dyszą, stos kubków i tabliczka z ceną. Front (+z) to strona klienta.
 */
export function buildCoffee(f: Fixture): Object3D {
  const { root, inner, length: L, depth: D } = fixtureFrame(f);
  const frame = painted(PALETTE.fixture.fridgeFrame);
  const metal = painted(FIX.metal);
  const TOP = 0.89;

  box(inner, [L - 0.06, 0.1, D - 0.06], [0, 0, 0], frame, { name: 'plinth' });
  box(inner, [L - 0.08, 0.72, D - 0.06], [0, 0.1, 0], matte(BRAND.green), { name: 'body' });
  box(inner, [L, 0.07, D], [0, 0.82, 0], woodMat(FIX.wood), { name: 'counterTop', seg: 3, radius: 0.032 });
  plateSign(inner, 'Kawa 3 zł\nKubek 4 zł', [0.34, 0.085], [0, 0.45, (D - 0.06) / 2 + 0.001], 1);

  // ekspres: korpus przy tylnej krawędzi, przód z dyszami i wyświetlaczem
  const mz = -0.06;
  box(inner, [0.3, 0.46, 0.26], [-0.02, TOP, mz], frame, { name: 'machine' });
  box(inner, [0.3, 0.05, 0.27], [-0.02, TOP + 0.46, mz], metal, { name: 'machine top' });
  cyl(inner, 0.085, 0.14, [-0.02, TOP + 0.58, mz], gloss(PALETTE.productCategory.slodycze[3]), { name: 'bean hopper', rTop: 0.1 });
  box(inner, [0.2, 0.06, 0.01], [-0.02, TOP + 0.3, mz + 0.131], glow(SCREEN_COLOR, 1.2), { name: 'display', cast: false });
  for (const sx of [-0.07, 0.03]) cyl(inner, 0.01, 0.06, [sx - 0.0, TOP + 0.2, mz + 0.14], metal, { name: 'spout' });
  for (let i = 0; i < 3; i++) box(inner, [0.025, 0.025, 0.012], [-0.1 + i * 0.05, TOP + 0.38, mz + 0.131], matte(BRAND.orange), { name: 'button' });

  // tacka ociekowa z kratką i kubek pod dyszą
  box(inner, [0.28, 0.025, 0.12], [-0.02, TOP, mz + 0.19], metal, { name: 'drip tray' });
  box(inner, [0.25, 0.008, 0.09], [-0.02, TOP + 0.025, mz + 0.19], frame, { name: 'drip grate' });
  const cup = matte(BRAND.cream);
  cyl(inner, 0.024, 0.08, [-0.07, TOP + 0.033 + 0.04, mz + 0.19], cup, { name: 'cup', rTop: 0.032 });
  // stos kubków obok ekspresu
  for (let i = 0; i < 3; i++) cyl(inner, 0.027, 0.07, [0.17, TOP + 0.035 + i * 0.02, mz + 0.05], i === 2 ? matte(BRAND.orange) : cup, { name: 'cup stack', rTop: 0.036 });
  return root;
}
