import type { Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import { PALETTE } from '@/render/style';
import { BRAND, FIX, SCREEN_COLOR, box, cyl, fixtureFrame, glow, gloss, matte, painted, plateSign } from '../parts';

/**
 * Kasa samoobsługowa (gotowy mebel, który zastąpi slot po zakupie): ciężka stopa, słupek, pochylony ekran
 * (emissive #8fd3ff 1,2), skaner ze świecącym okienkiem, półka na zakupy i zielona nadstawka „SAMOOBSŁUGA”.
 * Front (+z) to strona klienta.
 */
export function buildSelfCheckout(f: Fixture): Object3D {
  const { root, inner, length: L, depth: D } = fixtureFrame(f);
  const frame = painted(PALETTE.fixture.fridgeFrame);
  const metal = painted(FIX.metal);
  const px = L / 2 - 0.2;       // słupek w prawej części, po lewej półka na zakupy

  box(inner, [0.34, 0.06, D - 0.08], [px, 0, 0], frame, { name: 'base' });
  box(inner, [0.14, 0.9, 0.14], [px, 0.06, -0.04], frame, { name: 'pillar' });
  // pochylony ekran dotykowy
  box(inner, [0.34, 0.26, 0.04], [px, 0.98, -0.02], frame, { name: 'screen bezel', rot: [-0.35, 0, 0] });
  box(inner, [0.3, 0.22, 0.01], [px, 1.0, 0.0], glow(SCREEN_COLOR, 1.2), { name: 'screen', rot: [-0.35, 0, 0], cast: false });
  // skaner w blacie pod ekranem
  box(inner, [0.22, 0.05, 0.2], [px, 0.86, 0.08], metal, { name: 'scanner' });
  box(inner, [0.12, 0.008, 0.1], [px, 0.91, 0.08], glow(BRAND.orange, 1.5), { name: 'scanner window', cast: false });
  // półka na zakupy z barierką
  box(inner, [0.5, 0.04, D - 0.06], [-L / 2 + 0.3, 0.72, 0], matte(FIX.shelf), { name: 'bagging shelf' });
  for (const sx of [-1, 1]) cyl(inner, 0.012, 0.72, [-L / 2 + 0.3 + sx * 0.22, 0.36, -D / 2 + 0.06], metal, { name: 'shelf leg' });
  box(inner, [0.5, 0.05, 0.02], [-L / 2 + 0.3, 0.76, -D / 2 + 0.04], gloss(BRAND.orange), { name: 'shelf rail' });
  // nadstawka z nazwą (2 cm luzu do krawędzi obrysu z każdej strony)
  const hx = px - 0.04;
  box(inner, [0.44, 0.14, 0.05], [hx, 1.2, -0.04], matte(BRAND.green), { name: 'header' });
  plateSign(inner, 'SAMOOBSŁUGA', [0.4, 0.1], [hx, 1.27, -0.04 + 0.0255], 1);
  return root;
}
