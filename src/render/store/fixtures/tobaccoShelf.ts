import type { Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import { PALETTE } from '@/render/style';
import { BRAND, box, fixtureFrame, glow, gloss, matte, painted, plateSign } from '../parts';

/**
 * Szafka z papierosami przy ścianie (2,0 m): ciemny korpus `fixture.fridgeFrame`, dwa rzędy zamkniętych frontów
 * (rolety) z długimi pomarańczowymi uchwytami, podświetlenie (świecące listwy) i pomarańczowa nadstawka
 * z tabliczką „prosimy o dowód”. Front (+z) to strona klienta, tył przy ścianie.
 */
export function buildTobaccoShelf(f: Fixture): Object3D {
  const { root, inner, length: L, depth: D } = fixtureFrame(f);
  const frame = painted(PALETTE.fixture.fridgeFrame);
  const back = -D / 2;
  const front = back + D;
  const BODY_BOTTOM = 0.1;
  const BODY_TOP = 1.8;

  box(inner, [L - 0.06, BODY_BOTTOM, D - 0.03], [0, 0, back + (D - 0.03) / 2], matte(BRAND.greenDark), { name: 'plinth' });
  box(inner, [L, BODY_TOP - BODY_BOTTOM, D - 0.052], [0, BODY_BOTTOM, back + 0.012 + (D - 0.052) / 2], frame, { name: 'body' });

  // tył (widoczny z drugiej strony ściany w przekroju): płyciny, pomarańczowy pas i tabliczka marki
  const backModules = Math.max(1, Math.round(L / 0.9));
  const bw = (L - 0.1) / backModules;
  for (let i = 0; i < backModules; i++) {
    box(inner, [bw - 0.06, 1.4, 0.012], [-(L - 0.1) / 2 + bw * (i + 0.5), 0.25, back + 0.006], matte(BRAND.greenDark), { name: 'back panel' });
  }
  box(inner, [L - 0.12, 0.05, 0.012], [0, 1.0, back - 0.0], gloss(BRAND.orange), { name: 'back stripe', seg: 1, radius: 0.008 });
  plateSign(inner, 'TRASZKA', [0.6, 0.15], [0, 1.25, back - 0.001], -1);

  // dwa rzędy zamkniętych frontów: moduły ~55 cm, na froncie cienkie płyty w kolorze marki
  const modules = Math.max(2, Math.round(L / 0.55));
  const mw = (L - 0.12) / modules;
  const rows = [{ y: 0.18, h: 0.74 }, { y: 0.98, h: 0.74 }];
  for (const row of rows) {
    for (let i = 0; i < modules; i++) {
      box(inner, [mw - 0.03, row.h, 0.025], [-(L - 0.12) / 2 + mw * (i + 0.5), row.y, front - 0.0275], matte(BRAND.green), { name: 'front' });
    }
    box(inner, [L - 0.14, 0.03, 0.03], [0, row.y + row.h * 0.78, front - 0.012], gloss(BRAND.orange), { name: 'grip' });
  }

  // podświetlenie: świecące listwy nad każdym rzędem
  const led = glow(BRAND.cream, 2.2);
  box(inner, [L - 0.1, 0.025, 0.02], [0, 0.95, front - 0.03], led, { name: 'led', cast: false });
  box(inner, [L - 0.1, 0.025, 0.02], [0, 1.75, front - 0.03], led, { name: 'led', cast: false });

  // nadstawka z tabliczką
  box(inner, [L, 0.2, D - 0.02], [0, BODY_TOP, back + (D - 0.02) / 2], matte(BRAND.orange), { name: 'header' });
  const plateW = Math.min(L - 0.2, 1.0);
  plateSign(inner, 'PROSIMY O DOWÓD\nI CIERPLIWOŚĆ', [plateW, plateW / 4], [0, BODY_TOP + 0.1, back + D - 0.02 + 0.001], 1);
  return root;
}
