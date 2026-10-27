import { IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { PALETTE } from '@/render/style';
import type { Rng } from '@/sim/rng';
import type { GeomBuilder } from './buildings';

/**
 * Podwórko za wierszem kamienic i bloków (zadanie 16): betonowa ścieżka wzdłuż tyłów, trawniki, trzepak, wiata
 * śmietnikowa z koszami do segregacji, piaskownica, drzewa, podjazd i rząd blaszanych garaży. Dzięki niemu kadr za
 * sklepem wygląda jak polskie osiedle, a nie jak pusty plac.
 *
 * Wszystko trafia do jednej siatki z kolorami wierzchołków (`GeomBuilder` podłoża ulicy), więc podwórko nie dokłada
 * draw calli. Kolory tylko z PALETTE.
 *
 * Zasłanianie: kamera izometryczna patrzy w dół pod kątem, przy którym promień od punktu podłogi do kamery wznosi się
 * o tyle metrów, ile przebiega wzdłuż osi z. Przy kamerze od strony podwórka (yaw 1 i 2) rzecz o wysokości h, stojąca
 * d metrów za tylną ścianą, nie zasłania wnętrza sklepu, jeśli h ≤ d. Każdy element ma odległość dobraną do wysokości.
 */

/** Głębokość podwórka (m) liczona od tylnej ściany wiersza budynków. */
export const COURT_DEPTH = 17;
const GROUND_Y = -0.16;
const PATH_W = 1.4;
const LAWN_Y = 0.05;
const DRIVE_Z = 8.4;          // początek podjazdu przed garażami (od tylnej ściany)
const GARAGE_Z = 11;          // front garaży; ich wysokość 2,3 m ≪ 11 m
const GARAGE = { w: 3, d: 5.4, h: 2.3 } as const;

const { street, fixture, brand, productCategory: cat } = PALETTE;
const TRUNK = cat.pieczywo[3]!;
const CROWNS = [brand.green, cat.napoje[3]!, cat.przekaski[3]!] as const;
const GARAGE_COLORS = [fixture.metal, street.curb[1]!, street.kamienicaPlaster[1]!, street.kamienicaPlaster[3]!, cat.nabial[2]!] as const;
/** Kosze do segregacji: żółty (metale i plastik), niebieski (papier), zielony (szkło), brązowy (bio). */
const BINS = [cat.przekaski[0]!, cat.napoje[1]!, brand.green, cat.pieczywo[3]!] as const;

export interface CourtArea {
  /** Zakres x podwórka (m). */
  x0: number; x1: number;
  /** Tylna ściana wiersza budynków (z, m); podwórko leży za nią, do `z + COURT_DEPTH`. */
  z: number;
  /** Zakres x, którego trzeba unikać (przecznica z chodnikami przy lokalu narożnym). */
  avoid: [number, number] | null;
}

const ico = new IcosahedronGeometry(1, 1);
const m4 = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const sc = new Vector3();

function blob(b: GeomBuilder, x: number, y: number, z: number, r: number, squash: number, color: string, yaw = 0): void {
  q.setFromAxisAngle(v.set(0, 1, 0), yaw);
  m4.compose(v.set(x, y, z), q, sc.set(r, r * squash, r));
  b.mesh(ico, m4, color);
}

/**
 * Drzewo (podwórko i ulica): pień i korona z czterech kanciasto-okrągłych brył (jak meble: miękko, ale z fasetą),
 * wysokość `h` od podłoża do czubka korony. Zastępuje modele Kenneya, które obok krępych mebli wyglądały płasko.
 */
export function buildTree(b: GeomBuilder, x: number, z: number, h: number, rng: Rng): void {
  const trunkH = h * 0.42;
  b.rbox([x - 0.13, 0, z - 0.13], [x + 0.13, trunkH + 0.4, z + 0.13], TRUNK, 0.05, 1);
  const crown = rng.pick(CROWNS);
  const r = h * 0.27;
  blob(b, x, trunkH + r * 0.9, z, r, 0.85, crown, rng.range(0, 6));
  blob(b, x - r * 0.55, trunkH + r * 0.55, z + r * 0.2, r * 0.72, 0.85, rng.pick(CROWNS), rng.range(0, 6));
  blob(b, x + r * 0.5, trunkH + r * 0.7, z - r * 0.15, r * 0.7, 0.85, crown, rng.range(0, 6));
  blob(b, x + r * 0.05, trunkH + r * 1.55, z + r * 0.05, r * 0.6, 0.85, rng.pick(CROWNS), rng.range(0, 6));
}

/** Trzepak: dwa słupki i dwie poprzeczki, malowane na ciemną zieleń. Iconic. */
function carpetBeater(b: GeomBuilder, x: number, z: number): void {
  const c = fixture.fridgeFrame;
  for (const dx of [-1.1, 1.1]) b.rbox([x + dx - 0.045, 0, z - 0.045], [x + dx + 0.045, 1.55, z + 0.045], c, 0.02, 1);
  b.rbox([x - 1.2, 1.46, z - 0.035], [x + 1.2, 1.53, z + 0.035], c, 0.02, 1);
  b.rbox([x - 1.1, 1.0, z - 0.03], [x + 1.1, 1.06, z + 0.03], c, 0.02, 1);
}

/** Wiata śmietnikowa: betonowe ścianki, drewniany daszek, cztery kosze do segregacji. Front (otwarty) to −z. */
function binShelter(b: GeomBuilder, x: number, z: number): void {
  const w = 3.2, d = 1.3, h = 1.75;
  const wall = street.curb[0]!;
  b.rbox([x - w / 2, 0, z + d - 0.14], [x + w / 2, h, z + d], wall, 0.04, 1);
  for (const sx of [-1, 1]) b.rbox([x + sx * w / 2 - 0.07, 0, z], [x + sx * w / 2 + 0.07, h, z + d], wall, 0.04, 1);
  b.rbox([x - w / 2 - 0.15, h, z - 0.15], [x + w / 2 + 0.15, h + 0.1, z + d + 0.1], fixture.wood, 0.03, 1);
  BINS.forEach((color, i) => {
    const bx = x - w / 2 + 0.45 + i * 0.76;
    b.rbox([bx - 0.3, 0, z + 0.2], [bx + 0.3, 1.0, z + 0.95], color, 0.05, 1);
    b.rbox([bx - 0.32, 1.0, z + 0.18], [bx + 0.32, 1.07, z + 0.97], color, 0.03, 1);
  });
}

/** Piaskownica: drewniana rama i piasek z kopczykiem. */
function sandbox(b: GeomBuilder, x: number, z: number): void {
  const s = 1.1;
  const wood = fixture.wood;
  b.rbox([x - s, 0, z - s], [x + s, 0.25, z - s + 0.12], wood, 0.03, 1);
  b.rbox([x - s, 0, z + s - 0.12], [x + s, 0.25, z + s], wood, 0.03, 1);
  b.rbox([x - s, 0, z - s + 0.12], [x - s + 0.12, 0.25, z + s - 0.12], wood, 0.03, 1);
  b.rbox([x + s - 0.12, 0, z - s + 0.12], [x + s, 0.25, z + s - 0.12], wood, 0.03, 1);
  b.rbox([x - s + 0.12, 0, z - s + 0.12], [x + s - 0.12, 0.17, z + s - 0.12], cat.pieczywo[2]!, 0.02, 1);
  blob(b, x + 0.3, 0.17, z - 0.2, 0.32, 0.4, cat.pieczywo[2]!);
  b.rbox([x - 0.5, 0.17, z + 0.3], [x - 0.3, 0.32, z + 0.5], brand.orange, 0.04, 1);   // wiaderko
}

/** Ławka podwórkowa (deska na dwóch betonowych nogach). */
function courtBench(b: GeomBuilder, x: number, z: number): void {
  for (const dx of [-0.6, 0.6]) b.rbox([x + dx - 0.08, 0, z - 0.2], [x + dx + 0.08, 0.4, z + 0.2], street.curb[0]!, 0.03, 1);
  b.rbox([x - 0.85, 0.4, z - 0.22], [x + 0.85, 0.47, z + 0.22], fixture.wood, 0.03, 1);
}

/** Blaszak: bryła, przetłoczenia na drzwiach i daszek z okapem. Front (drzwi) to −z. */
function garage(b: GeomBuilder, x: number, z: number, color: string): void {
  const { w, d, h } = GARAGE;
  b.rbox([x - w / 2 + 0.04, 0, z], [x + w / 2 - 0.04, h, z + d], color, 0.06, 1);
  b.rbox([x - w / 2 - 0.02, h, z - 0.15], [x + w / 2 + 0.02, h + 0.1, z + d + 0.05], street.asphalt[1]!, 0.03, 1);
  b.rbox([x - 1.2, 0.05, z - 0.03], [x + 1.2, 2.05, z + 0.02], street.curb[1]!, 0.02, 1);
  for (let i = 0; i < 7; i++) {
    const rx = x - 1.05 + i * 0.35;
    b.rbox([rx - 0.03, 0.12, z - 0.05], [rx + 0.03, 1.98, z], color, 0.01, 1);
  }
  b.rbox([x - 0.05, 0.95, z - 0.08], [x + 0.05, 1.05, z - 0.02], fixture.metal, 0.01, 1);
}

function inAvoid(a: CourtArea, x0: number, x1: number): boolean {
  return a.avoid !== null && x1 > a.avoid[0] && x0 < a.avoid[1];
}

/** Odcinki [x0, x1] zakresu podwórka bez przecznicy. */
function spans(a: CourtArea): [number, number][] {
  if (!a.avoid) return [[a.x0, a.x1]];
  return [[a.x0, a.avoid[0]], [a.avoid[1], a.x1]].filter(([p, r]) => r - p > 0.5) as [number, number][];
}

export function buildCourtyard(b: GeomBuilder, a: CourtArea, rng: Rng): void {
  const z0 = a.z;
  const zEnd = z0 + COURT_DEPTH;
  for (const [x0, x1] of spans(a)) {
    // ścieżka wzdłuż tyłów budynków, trawnik z obrzeżem, podjazd przed garażami
    b.rbox([x0, GROUND_Y, z0], [x1, 0, z0 + PATH_W], street.sidewalk[1]!, 0.03, 1);
    b.rbox([x0, GROUND_Y, z0 + PATH_W], [x1, LAWN_Y - 0.02, z0 + DRIVE_Z], street.curb[1]!, 0.04, 1);
    b.rbox([x0 + 0.1, GROUND_Y, z0 + PATH_W + 0.1], [x1 - 0.1, LAWN_Y, z0 + DRIVE_Z - 0.1], street.grass[0]!, 0.04, 1);
    b.rbox([x0, GROUND_Y, z0 + DRIVE_Z], [x1, -0.02, zEnd], street.asphalt[1]!, 0.03, 1);
    // ciemniejsze i wydeptane łaty na trawniku
    for (let i = 0; i < Math.round((x1 - x0) / 6); i++) {
      const px = rng.range(x0 + 1, Math.max(x0 + 1.1, x1 - 3));
      const pz = rng.range(z0 + PATH_W + 0.5, z0 + DRIVE_Z - 2.5);
      b.rbox([px, LAWN_Y - 0.01, pz], [px + rng.range(1.2, 2.6), LAWN_Y + 0.004, pz + rng.range(0.8, 1.8)], rng.pick([street.grass[1]!, street.grass[2]!]), 0.2, 1);
    }
  }

  // garaże: rząd w głębi podwórka, po obu stronach środka (pomijając przecznicę)
  const count = Math.max(2, Math.min(9, Math.floor((a.x1 - a.x0 - 4) / GARAGE.w)));
  const startX = -((count - 1) * GARAGE.w) / 2;
  for (let i = 0; i < count; i++) {
    const gx = startX + i * GARAGE.w;
    if (gx - GARAGE.w / 2 < a.x0 || gx + GARAGE.w / 2 > a.x1 || inAvoid(a, gx - GARAGE.w / 2 - 0.5, gx + GARAGE.w / 2 + 0.5)) continue;
    garage(b, gx, z0 + GARAGE_Z, rng.pick(GARAGE_COLORS));
  }

  // rzeczy na trawniku, każda w swojej odległości od tylnej ściany (h ≤ d, patrz opis modułu)
  const taken: [number, number][] = [];
  const free = (w: number): number | null => {
    for (let t = 0; t < 40; t++) {
      const x = rng.range(a.x0 + w, a.x1 - w);
      if (!inAvoid(a, x - w, x + w) && !taken.some(([p, r]) => x + w > p && x - w < r)) { taken.push([x - w, x + w]); return x; }
    }
    return null;
  };
  const beaterX = free(1.4);
  if (beaterX !== null) carpetBeater(b, beaterX, z0 + 3.2);
  const shelterX = free(1.9);
  if (shelterX !== null) binShelter(b, shelterX, z0 + 3.0);
  const sandX = free(1.3);
  if (sandX !== null) sandbox(b, sandX, z0 + 5.4);
  const benchX = free(1.0);
  if (benchX !== null) courtBench(b, benchX, z0 + 2.2);
  // drzewa przy krawędzi podjazdu: korona ≤ 5,4 m, pień ≥ 6,8 m od ściany
  const trees = rng.int(3, 6);
  const treeSpots: number[] = [];
  for (let t = 0; t < 60 && treeSpots.length < trees; t++) {
    const x = rng.range(a.x0 + 1.5, a.x1 - 1.5);
    if (inAvoid(a, x - 1.6, x + 1.6) || treeSpots.some((p) => Math.abs(p - x) < 3.2)) continue;
    treeSpots.push(x);
    buildTree(b, x, z0 + rng.range(6.8, 7.4), rng.range(4.4, 5.4), rng);
  }
}
