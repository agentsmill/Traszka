import { Group, type Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import { material } from '@/render/style';
import { BRAND, M, box, glow } from '../parts';

/**
 * Znacznik wolnego miejsca (slot kasy samoobsługowej, slot sprzętu): półprzezroczysta pomarańczowa płyta na podłodze,
 * jasne narożniki i duża ikona „+” (emissive brand.cream). Płaski, więc czytelny z każdego z czterech obrotów kamery.
 * Nie jest scalany z resztą geometrii (`userData.separate`), bo później będzie klikalny.
 */
export function buildSlotMarker(f: Fixture): Object3D {
  const root = new Group();
  root.name = f.id;
  root.userData = { fixtureId: f.id, kind: f.kind, separate: true };
  const W = f.w * M;
  const D = f.d * M;
  const cx = W / 2;
  const cz = D / 2;

  box(root, [W - 0.06, 0.02, D - 0.06], [cx, 0, cz], material('plasticMatte', BRAND.orange, { opacity: 0.35 }), { name: 'slot plate' });

  // narożniki: dwa ramiona w każdym rogu
  const arm = Math.min(0.16, Math.min(W, D) * 0.35);
  const edge = material('plasticGloss', BRAND.orange);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = cx + sx * (W / 2 - 0.045);
      const z = cz + sz * (D / 2 - 0.045);
      box(root, [arm, 0.03, 0.03], [x - sx * (arm / 2 - 0.015), 0, z], edge, { name: 'slot corner', cast: false });
      box(root, [0.03, 0.03, arm], [x, 0, z - sz * (arm / 2 - 0.015)], edge, { name: 'slot corner', cast: false });
    }
  }

  // ikona „+” na środku
  const plus = Math.min(0.34, Math.min(W, D) * 0.6);
  const icon = glow(BRAND.cream, 1.0);
  box(root, [plus, 0.025, 0.08], [cx, 0.01, cz], icon, { name: 'slot plus', cast: false });
  box(root, [0.08, 0.025, plus], [cx, 0.01, cz], icon, { name: 'slot plus', cast: false });
  root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  return root;
}
