import type { Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import { PALETTE } from '@/render/style';
import {
  BRAND, FIX, SCREEN_COLOR, box, cyl, fixtureFrame, glow, gloss, matte, painted, plateSign, woodMat,
} from '../parts';

export const COUNTER_HEIGHT = 0.95;

/**
 * Kasa: lada 0,95 m (korpus `fixture.counter`, cokół cofnięty o 3 cm, blat 7 cm z zaokrągleniem i nawisem 4 cm),
 * ekran kasjera na słupku, terminal płatniczy, koszyk ze zdrapkami i stojak z gumami przy klientach.
 * Front (+z) to strona klienta, kasjer stoi od strony −z.
 */
export function buildCheckout(f: Fixture): Object3D {
  const { root, inner, length: L, depth: D } = fixtureFrame(f);
  const frame = painted(PALETTE.fixture.fridgeFrame);
  const bodyD = D - 0.1;                  // korpus cofnięty o 5 cm z każdej strony: nawis blatu 5 cm
  const front = bodyD / 2;

  box(inner, [L - 0.14, 0.12, bodyD - 0.06], [0, 0, 0], frame, { name: 'plinth' });
  box(inner, [L - 0.08, 0.76, bodyD], [0, 0.12, 0], matte(FIX.counter), { name: 'body' });
  box(inner, [L, 0.07, D], [0, 0.88, 0], woodMat(FIX.wood), { name: 'counterTop', seg: 3, radius: 0.032 });

  // wsunięte płyciny na froncie i tabliczka z żartem
  const panels = Math.max(2, Math.floor(L / 0.62));
  const pw = (L - 0.2) / panels - 0.06;
  for (let i = 0; i < panels; i++) {
    box(inner, [pw, 0.46, 0.012], [-(L - 0.2) / 2 + ((i + 0.5) * (L - 0.2)) / panels, 0.2, front + 0.006], woodMat(FIX.wood), { name: 'panel' });
  }
  // szuflady od strony kasjera
  const drawers = Math.max(2, Math.floor(L / 0.7));
  const dw = (L - 0.2) / drawers - 0.06;
  for (let i = 0; i < drawers; i++) {
    const dx = -(L - 0.2) / 2 + ((i + 0.5) * (L - 0.2)) / drawers;
    box(inner, [dw, 0.2, 0.012], [dx, 0.52, -front - 0.006], woodMat(FIX.wood), { name: 'drawer' });
    box(inner, [dw * 0.5, 0.02, 0.02], [dx, 0.66, -front - 0.02], painted(FIX.metal), { name: 'drawer handle' });
    box(inner, [dw, 0.2, 0.012], [dx, 0.24, -front - 0.006], woodMat(FIX.wood), { name: 'drawer' });
  }
  plateSign(inner, 'Reklamówka 0,20 zł\nCentrala dziękuje', [0.5, 0.125], [L / 2 - 0.36, 0.8, front + 0.001], 1);

  // ekran kasjera: podstawa, słupek, ramka i świecący ekran zwrócony do kasjera (−z)
  const xs = -L / 2 + 0.4;
  box(inner, [0.15, 0.015, 0.12], [xs, COUNTER_HEIGHT, -0.08], frame, { name: 'screen base' });
  cyl(inner, 0.012, 0.15, [xs, COUNTER_HEIGHT + 0.09, -0.08], painted(FIX.metal), { name: 'screen stalk' });
  box(inner, [0.3, 0.2, 0.03], [xs, COUNTER_HEIGHT + 0.16, -0.08], frame, { name: 'screen bezel' });
  box(inner, [0.26, 0.16, 0.01], [xs, COUNTER_HEIGHT + 0.18, -0.1], glow(SCREEN_COLOR, 1.2), { name: 'screen', cast: false });

  // terminal płatniczy z klawiaturą, lekko pochylony do klienta
  const xt = xs + 0.34;
  box(inner, [0.1, 0.035, 0.17], [xt, COUNTER_HEIGHT, 0.1], frame, { name: 'terminal', rot: [-0.3, 0, 0] });
  box(inner, [0.075, 0.006, 0.045], [xt, COUNTER_HEIGHT + 0.03, 0.075], glow(SCREEN_COLOR, 1.2), { name: 'terminal screen', rot: [-0.3, 0, 0], cast: false });
  for (let i = 0; i < 3; i++) box(inner, [0.02, 0.008, 0.02], [xt - 0.028 + i * 0.028, COUNTER_HEIGHT + 0.034, 0.125], painted(FIX.metal), { name: 'key', rot: [-0.3, 0, 0] });

  // koszyk ze zdrapkami: druciany kosz z rozsypanymi kolorowymi kartami
  const xb = xt + 0.4;
  const basket = painted(FIX.metal);
  box(inner, [0.3, 0.012, 0.2], [xb, COUNTER_HEIGHT, 0.08], basket, { name: 'basket' });
  for (const s of [-1, 1]) {
    box(inner, [0.3, 0.1, 0.012], [xb, COUNTER_HEIGHT, 0.08 + s * 0.094], basket, { name: 'basket wall' });
    box(inner, [0.012, 0.1, 0.2], [xb + s * 0.144, COUNTER_HEIGHT, 0.08], basket, { name: 'basket wall' });
  }
  const cards = [BRAND.orange, BRAND.cream, BRAND.green, PALETTE.productCategory.slodycze[4], PALETTE.productCategory.slodycze[2], BRAND.orange];
  cards.forEach((c, i) => {
    box(inner, [0.07, 0.11, 0.004], [xb - 0.1 + i * 0.04, COUNTER_HEIGHT + 0.012, 0.08 + (i % 2 ? 0.02 : -0.02)], gloss(c), {
      name: 'scratch card', rot: [-0.15, 0, (i % 2 ? 1 : -1) * 0.18],
    });
  });

  // mały stojak z gumami do żucia przy krawędzi dla klientów
  const xr = L / 2 - 0.16;
  box(inner, [0.22, 0.02, 0.1], [xr, COUNTER_HEIGHT, 0.14], frame, { name: 'candy rack' });
  [PALETTE.productCategory.slodycze[1], PALETTE.productCategory.slodycze[2], PALETTE.productCategory.slodycze[5]].forEach((c, i) => {
    box(inner, [0.06, 0.09, 0.04], [xr - 0.075 + i * 0.075, COUNTER_HEIGHT + 0.02, 0.14], gloss(c), { name: 'candy' });
  });
  return root;
}
