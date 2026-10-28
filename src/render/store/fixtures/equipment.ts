import type { Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import { PALETTE } from '@/render/style';
import { BRAND, FIX, SCREEN_COLOR, box, cyl, fixtureFrame, glow, gloss, matte, painted, plateSign, spread } from '../parts';

// Sprzęt kupowany do slotów (ekonomia gry, src/sim/economy/upgrades.ts). Wszystko jak reszta mebli: origin w lewym-przednim
// rogu obrysu, front (+z lokalnie) to strona klienta. Bez prawdziwych marek: „Paczkownik”, „Bankomat”, „Pizza z pieca”.

/**
 * Kompaktowa kasa samoobsługowa na pół slotu 2×2 (obrys 1 × 2 kratki, 0,5 m szerokości): słupek z ekranem i skanerem,
 * wąska półka na zakupy z tyłu i zielona nadstawka. Dwie takie stoją obok siebie w jednym slocie.
 */
export function buildSelfCheckoutSlim(f: Fixture): Object3D {
  const { root, inner, length: L, depth: D } = fixtureFrame(f);
  const frame = painted(PALETTE.fixture.fridgeFrame);
  const metal = painted(FIX.metal);
  const front = D / 2 - 0.22;

  box(inner, [L - 0.1, 0.06, D - 0.2], [0, 0, -0.02], frame, { name: 'base' });
  box(inner, [0.14, 0.88, 0.14], [0, 0.06, front - 0.08], frame, { name: 'pillar' });
  box(inner, [0.32, 0.25, 0.04], [0, 0.96, front - 0.04], frame, { name: 'screen bezel', rot: [-0.35, 0, 0] });
  box(inner, [0.28, 0.21, 0.01], [0, 0.98, front - 0.02], glow(SCREEN_COLOR, 1.2), { name: 'screen', rot: [-0.35, 0, 0], cast: false });
  box(inner, [0.3, 0.05, 0.22], [0, 0.84, front + 0.1], metal, { name: 'scanner' });
  box(inner, [0.14, 0.008, 0.1], [0, 0.89, front + 0.1], glow(BRAND.orange, 1.5), { name: 'scanner window', cast: false });
  // półka na zakupy za słupkiem
  box(inner, [L - 0.14, 0.04, 0.34], [0, 0.72, -D / 2 + 0.3], matte(FIX.shelf), { name: 'bagging shelf' });
  for (const sx of [-1, 1]) cyl(inner, 0.012, 0.72, [sx * (L / 2 - 0.1), 0.36, -D / 2 + 0.2], metal, { name: 'shelf leg' });
  box(inner, [L - 0.12, 0.13, 0.05], [0, 1.2, front - 0.12], matte(BRAND.green), { name: 'header' });
  plateSign(inner, 'SCO', [0.22, 0.09], [0, 1.26, front - 0.12 + 0.0255], 1);
  return root;
}

/** Bankomat: szara skrzynia z ekranem, klawiaturą i podświetlonym daszkiem. Pół slotu (obrys 1 × 2 albo 2 × 1). */
export function buildAtm(f: Fixture): Object3D {
  const { root, inner, length: L, depth: D } = fixtureFrame(f);
  const body = painted('#5d6b73');
  const w = Math.min(L - 0.1, 0.55);
  const d = Math.min(D - 0.1, 0.5);
  const z = D / 2 - d / 2 - 0.06;
  box(inner, [w, 1.45, d], [0, 0, z], body, { name: 'atm body' });
  box(inner, [w - 0.08, 0.05, 0.16], [0, 0.98, z + d / 2 + 0.04], painted(FIX.metal), { name: 'atm shelf' });
  box(inner, [w - 0.16, 0.22, 0.02], [0, 1.08, z + d / 2], glow(SCREEN_COLOR, 1.1), { name: 'atm screen', cast: false });
  box(inner, [0.16, 0.012, 0.1], [0, 1.03, z + d / 2 + 0.03], matte('#2b3236'), { name: 'atm keypad' });
  box(inner, [w + 0.04, 0.12, d + 0.04], [0, 1.45, z], gloss(BRAND.orange), { name: 'atm top' });
  plateSign(inner, 'BANKOMAT', [w - 0.06, 0.08], [0, 1.47, z + d / 2 + 0.021], 1);
  return root;
}

/** Paczkownik 24h: ściana skrytek (siatka drzwiczek) z ekranem pośrodku i zielonym daszkiem. Cały slot 2×2. */
export function buildParcelLocker(f: Fixture): Object3D {
  const { root, inner, length: L, depth: D } = fixtureFrame(f);
  const H = 1.8;
  const d = 0.55;
  const z = -D / 2 + d / 2 + 0.05;
  box(inner, [L - 0.08, H, d], [0, 0, z], matte(BRAND.cream), { name: 'locker body' });
  const cols = spread(4, (L - 0.2) / 2);
  const rows = [0.12, 0.5, 0.88, 1.26];
  const door = matte(BRAND.green);
  for (const x of cols) {
    for (const y of rows) {
      if (Math.abs(x) < 0.15 && y > 0.4 && y < 1.2) continue;   // miejsce na ekran
      box(inner, [(L - 0.2) / 4 - 0.03, 0.34, 0.02], [x, y, z + d / 2], door, { name: 'locker door', cast: false });
    }
  }
  box(inner, [0.2, 0.3, 0.02], [0, 0.72, z + d / 2 + 0.005], glow(SCREEN_COLOR, 1.1), { name: 'locker screen', cast: false });
  box(inner, [L, 0.14, d + 0.12], [0, H, z + 0.04], gloss(BRAND.orange), { name: 'locker roof' });
  plateSign(inner, 'PACZKOWNIK 24h', [L - 0.3, 0.1], [0, H + 0.02, z + d / 2 + 0.105], 1);
  return root;
}

/** Piec do pizzy: lada z drzwiczkami, dwukomorowy piec z żarzącym się okienkiem i tablica „PIZZA Z PIECA”. Slot 2×2. */
export function buildPizzaOven(f: Fixture): Object3D {
  const { root, inner, length: L, depth: D } = fixtureFrame(f);
  const steel = painted(FIX.metal);
  const z = -D / 2 + 0.38;
  box(inner, [L - 0.1, 0.85, 0.7], [0, 0, z], matte(BRAND.green), { name: 'oven counter' });
  box(inner, [L - 0.04, 0.05, 0.76], [0, 0.85, z], gloss(PALETTE.fixture.wood), { name: 'oven top' });
  for (const y of [0.9, 1.22]) {
    box(inner, [L - 0.3, 0.3, 0.6], [0, y, z], steel, { name: 'oven chamber' });
    box(inner, [L - 0.5, 0.12, 0.012], [0, y + 0.09, z + 0.3], glow(BRAND.orange, 1.6), { name: 'oven window', cast: false });
  }
  box(inner, [L - 0.3, 0.2, 0.04], [0, 1.65, z - 0.2], gloss(BRAND.orange), { name: 'oven sign' });
  plateSign(inner, 'PIZZA Z PIECA', [L - 0.4, 0.14], [0, 1.68, z - 0.2 + 0.021], 1);
  return root;
}
