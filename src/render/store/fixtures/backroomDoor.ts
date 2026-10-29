import { Group, type Object3D } from 'three';
import type { Fixture } from '@/sim/store/types';
import { BRAND, FIX, M, box, cyl, painted, plateSign, woodMat, type Vec3 } from '../parts';
import { PALETTE } from '@/render/style';
import { buildStaffOnlySign } from '../props';

/** Grubość ścian wewnętrznych (musi się zgadzać z shell.ts). */
export const DOOR_WALL_T = 0.22;
/** Wysokość otworu drzwiowego na zaplecze. */
export const BACKROOM_DOOR_H = 2.1;
/** Grubość skrzydła i odsunięcie jego środka od lica sali (z). */
const LEAF_T = 0.045;
const LEAF_Z = 0.1;
/**
 * Skrzydło dla drzwi o szerokości `w` kratek (m, od lewego-przedniego rogu drzwi): zawias na wewnętrznym licu lewej ościeżnicy, w
 * tylnej (od zaplecza) płaszczyźnie skrzydła, więc skrzydło obraca się wokół krawędzi i otwiera na zaplecze, nie wchodząc w ościeżnicę.
 */
export const backroomLeaf = (w: number): { hingeX: number; hingeZ: number; length: number } =>
  ({ hingeX: 0.07, hingeZ: LEAF_Z + LEAF_T / 2, length: w * M - 0.14 });
/** Skrzydło drzwi z generatora (2 kratki szerokości). */
export const BACKROOM_LEAF = backroomLeaf(2);

/**
 * Drzwi na zaplecze w ścianie środkowej. Origin to lewy-przedni róg footprintu, czyli wewnętrzne lico ściany
 * od strony sali (z = 0); ściana ma grubość 0,22 m i biegnie w +z. Rama `brand.greenDark`, skrzydło drewniane
 * z blachą kopniakową, klamką i tabliczką nad drzwiami. Należą do ściany środkowej (znikają z nią w przekroju).
 * Skrzydło z okuciami i tabliczką to osobna grupa `userData.leaf` z początkiem w zawiasie (`backroomLeaf`): tu stoi zamknięte,
 * a buildStore.ts robi z niego kopię obracaną wokół zawiasu, gdy ktoś przechodzi (doorSwing.ts).
 */
export function buildBackroomDoor(f: Fixture): Object3D {
  const root = new Group();
  root.name = f.id;
  root.userData = { fixtureId: f.id, kind: f.kind };
  const W = f.w * M;
  const T = DOOR_WALL_T;
  const jamb = painted(BRAND.greenDark);
  const metal = painted(FIX.metal);

  for (const s of [0, 1]) box(root, [0.07, BACKROOM_DOOR_H, T - 0.02], [0.035 + s * (W - 0.07), 0, T / 2], jamb, { name: 'jamb' });
  box(root, [W, 0.07, T - 0.02], [W / 2, BACKROOM_DOOR_H - 0.07, T / 2], jamb, { name: 'head' });
  // skrzydło cofnięte w głąb ściany, na zawiasie; `at` przelicza punkty drzwi na układ zawiasu
  const hinge = backroomLeaf(f.w);
  const leaf = new Group();
  leaf.name = 'leaf';
  leaf.position.set(hinge.hingeX, 0, hinge.hingeZ);
  root.add(leaf);
  root.userData.leaf = leaf;
  const at = (x: number, y: number, z: number): Vec3 => [x - hinge.hingeX, y, z - hinge.hingeZ];
  box(leaf, [hinge.length, BACKROOM_DOOR_H - 0.09, LEAF_T], at(W / 2, 0, LEAF_Z), woodMat(FIX.wood), { name: 'leaf panel' });
  box(leaf, [hinge.length - 0.06, 0.28, 0.01], at(W / 2, 0.02, LEAF_Z - 0.0275), metal, { name: 'kick plate', rot: [0, Math.PI, 0] });
  // klamka po sali (−z) z rozetą
  cyl(leaf, 0.025, 0.012, at(W - 0.2, 1.0, LEAF_Z - 0.03), metal, { name: 'rose', rot: [Math.PI / 2, 0, 0] });
  box(leaf, [0.14, 0.022, 0.022], at(W - 0.2 - 0.05, 0.989, LEAF_Z - 0.055), metal, { name: 'handle' });
  // „Tylko dla personelu” na skrzydle, od strony sali (props.ts)
  buildStaffOnlySign(leaf, at(W / 2, 1.5, LEAF_Z - LEAF_T / 2 - 0.012));
  // tabliczka nad drzwiami (żart o premiach), zwrócona do sali (−z)
  box(root, [0.78, 0.2, 0.03], [W / 2, BACKROOM_DOOR_H + 0.03, -0.015], woodMat(PALETTE.fixture.wood), { name: 'sign board' });
  plateSign(root, 'ZAPLECZE\nPremii tu nie ma', [0.7, 0.175], [W / 2, BACKROOM_DOOR_H + 0.12, -0.031], -1);
  return root;
}
