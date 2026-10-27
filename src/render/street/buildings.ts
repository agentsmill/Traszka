import { BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial } from 'three';
import { createRng, subSeed, type Rng } from '@/sim/rng';
import { FRONT_WALL_Y, type LotKind, type StoreLayout } from '@/sim/store/types';
import { CELL_SIZE_M } from '@/sim/grid';
import { PALETTE } from '@/render/style';
import { roundedBoxGeometry } from '@/render/store/parts';
import { WALL_H, WALL_T } from '@/render/store/shell';
import type { AtlasCellName, FacadeAtlas } from './facadeAtlas';

/**
 * Budynki ulicy: bryła nad sklepem zależna od `lot.kind` i sąsiedzi po bokach, jako zmergowana geometria z UV w atlasie
 * elewacji (facadeAtlas.ts). Cała zabudowa dzieli jeden materiał (mapa koloru + emissive okien), więc kosztuje 1 draw call
 * na budynek (w przekroju: jeden). Kolory budynków to wierzchołki z PALETTE.street (tynk i płyty mnożą się z kremową teksturą).
 *
 * Układ: wiersz budynków wzdłuż ulicy (ściana frontowa na linii frontu sklepu), sklep w parterze środkowego budynku.
 * Lokal narożny (`lot.corner`) ma po stronie drugiej witryny przecznicę zamiast sąsiada.
 */

export type V3 = [number, number, number];
type UV4 = [number, number, number, number];

const WHITE = '#ffffff'; // baza kolorów wierzchołków dla komórek z własnym kolorem (okna, loggie, witryny, brama)
const STREET = PALETTE.street;
const CREAM = STREET.kamienicaPlaster[2];
const STONE = STREET.curb[0];
/** Pokłady dachów: papa, jasna papa, żwir; budynki w wierszu dostają je po kolei, żeby dachy nie były jednolicie ciemne. */
const ROOFS = [STREET.asphalt[1], STREET.curb[1], STREET.sidewalk[3]] as const;

// --- Ściana (układ lokalny) --------------------------------------------------------------------------------

/** Ściana widziana z zewnątrz: `s` rośnie w prawo (patrząc na ścianę), `off` to odsunięcie od muru na zewnątrz. */
class Face {
  readonly rx: number;
  readonly rz: number;
  constructor(readonly ox: number, readonly oz: number, readonly nx: number, readonly nz: number, readonly length: number) {
    this.rx = nz;
    this.rz = -nx;
  }
  p(s: number, y: number, off: number): V3 {
    return [this.ox + this.rx * s + this.nx * off, y, this.oz + this.rz * s + this.nz * off];
  }
}

// --- Budowniczy siatki ---------------------------------------------------------------------------------

/** Zbiera czworokąty i bryły do jednej siatki: pozycja, normalna, UV (atlas) i kolor wierzchołków. */
export class GeomBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly tmp = new Color();

  /** `flat` to punkt w UV, którym malowane są bryły bez tekstury (środek komórki 'tynk'). */
  constructor(private readonly flat: [number, number]) {}

  get triangles(): number { return this.pos.length / 9; }

  private vertex(p: V3, n: V3, u: number, v: number, c: Color): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
  }

  /** Czworokąt a(lewy dół) → b(prawy dół) → c(prawy góra) → d(lewy góra), przeciwnie do ruchu wskazówek patrząc z przodu. */
  quad(a: V3, b: V3, c: V3, d: V3, uv: UV4, color: string): void {
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n) || 1;
    n[0] /= len; n[1] /= len; n[2] /= len;
    this.tmp.set(color);
    const [u0, v0, u1, v1] = uv;
    this.vertex(a, n, u0, v0, this.tmp); this.vertex(b, n, u1, v0, this.tmp); this.vertex(c, n, u1, v1, this.tmp);
    this.vertex(a, n, u0, v0, this.tmp); this.vertex(c, n, u1, v1, this.tmp); this.vertex(d, n, u0, v1, this.tmp);
  }

  private flatUv(): UV4 { return [this.flat[0], this.flat[1], this.flat[0], this.flat[1]]; }

  /** Prostopadłościan o płaskim kolorze (sześć ścian). */
  box(min: V3, max: V3, color: string): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const uv = this.flatUv();
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uv, color);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uv, color);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uv, color);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uv, color);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], uv, color);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], uv, color);
  }

  /** Zaokrąglona bryła o płaskim kolorze (fazowane krawędzie wg przewodnika stylu: duże bryły, większy promień). */
  rbox(min: V3, max: V3, color: string, radius = 0.1, segments = 2): void {
    const w = max[0] - min[0];
    const h = max[1] - min[1];
    const d = max[2] - min[2];
    const r = Math.min(radius, 0.45 * Math.min(w, h, d));
    const base = roundedBoxGeometry(w, h, d, segments, r);
    const g = base.index ? base.toNonIndexed() : base.clone();
    const p = g.attributes.position!;
    const n = g.attributes.normal!;
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;
    this.tmp.set(color);
    for (let i = 0; i < p.count; i++) {
      this.vertex([p.getX(i) + cx, p.getY(i) + cy, p.getZ(i) + cz], [n.getX(i), n.getY(i), n.getZ(i)], this.flat[0], this.flat[1], this.tmp);
    }
    g.dispose();
  }

  /** Czworokąt na ścianie: `s0..s1` wzdłuż ściany, `y0..y1` w pionie, `off` od muru na zewnątrz. */
  faceQuad(f: Face, s0: number, s1: number, y0: number, y1: number, off: number, uv: UV4, color: string): void {
    this.quad(f.p(s0, y0, off), f.p(s1, y0, off), f.p(s1, y1, off), f.p(s0, y1, off), uv, color);
  }

  /** Płaska bryła przy ścianie (parapet, nadproże) od `off0` do `off1` od muru. */
  faceBox(f: Face, s0: number, s1: number, y0: number, y1: number, off0: number, off1: number, color: string): void {
    const a = f.p(s0, y0, off0);
    const b = f.p(s1, y1, off1);
    this.box([Math.min(a[0], b[0]), y0, Math.min(a[2], b[2])], [Math.max(a[0], b[0]), y1, Math.max(a[2], b[2])], color);
  }

  /**
   * To samo z fazą (przewodnik §1: duże elementy mają fazowane krawędzie): gzymsy, płyty balkonów, daszki. Drobne parapety
   * zostają ostre (`faceBox`), bo faza na nich to setki trójkątów na budynek przy kilku pikselach na ekranie.
   */
  faceRBox(f: Face, s0: number, s1: number, y0: number, y1: number, off0: number, off1: number, color: string, radius = 0.03, segments = 1): void {
    const a = f.p(s0, y0, off0);
    const b = f.p(s1, y1, off1);
    this.rbox([Math.min(a[0], b[0]), y0, Math.min(a[2], b[2])], [Math.max(a[0], b[0]), y1, Math.max(a[2], b[2])], color, radius, segments);
  }

  /** Dowolna geometria (pozycja i normalne) po przekształceniu `matrix`, w jednym kolorze, z płaskim UV. */
  mesh(geometry: BufferGeometry, matrix: Matrix4, color: string): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    const p = g.attributes.position!;
    const n = g.attributes.normal!;
    this.tmp.set(color);
    for (let i = 0; i < p.count; i++) {
      this.vertex([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)], this.flat[0], this.flat[1], this.tmp);
    }
    g.dispose();
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// --- Bryły budynków ----------------------------------------------------------------------------------------

export interface VolumeSpec {
  style: LotKind;
  x0: number; x1: number; z0: number; z1: number;
  /** Liczba kondygnacji z parterem. */
  floors: number;
  groundH: number;
  /** Wysokość kondygnacji nad parterem. */
  floorH: number;
  main: string;
  accent: string;
  /** Parter to sklep (jego powłoka jest osobno): bryła zaczyna się nad nim. */
  overStore: boolean;
  /** Parter tej bryły to przejazd bramny kamienicy. */
  gate: boolean;
  /** Wysokość sąsiada przy ścianie x0 / x1 (ściana poniżej jest zasłonięta); 0 = ściana odsłonięta. */
  coverMin: number;
  coverMax: number;
  /**
   * Mural na ślepej ścianie szczytowej od strony sklepu (tylko sąsiedzi). W przekroju bryła nad sklepem znika, a dalszy
   * sąsiad zostaje w pełnej wysokości, więc ta ściana jest odsłonięta.
   */
  mural: 'mural' | 'muralSzop' | null;
}

const PARAPET_H = 0.5;
const ATTIC_H = 0.9;
const CUT_H = 0.5;
const SLAB_T = 0.3;
const MAX_FRONT_BAYS = 20;
/** Szyld sklepu (shell.ts) sięga dokładnie do WALL_H, więc elementy elewacji nad sklepem zaczynają się o 1 cm wyżej. */
const SIGN_CLEARANCE = 0.01;
/** Część okien (komórka 'okno' zamiast 'oknoGasne'), która nocą świeci. */
const LIT_SHARE = 0.4;

export const volumeHeight = (s: VolumeSpec): number => s.groundH + (s.floors - 1) * s.floorH;

interface Ctx { b: GeomBuilder; atlas: FacadeAtlas; rng: Rng; cell: (n: AtlasCellName) => UV4 }

function bayCount(length: number, target: number): number {
  return Math.min(MAX_FRONT_BAYS, Math.max(1, Math.round(length / target)));
}

/** Pas z teksturą (okno, loggia, panel): płaski kolorowy panel z oknem, parapetem i nadprożem. */
function windowBay(c: Ctx, s: VolumeSpec, f: Face, s0: number, s1: number, y0: number, y1: number, kind: 'okno' | 'loggia'): void {
  const bw = s1 - s0;
  const mid = (s0 + s1) / 2;
  const tall = s.style === 'kamienica';
  if (kind === 'loggia') {
    const w = bw * 0.9;
    c.b.faceRBox(f, mid - w / 2 - 0.04, mid + w / 2 + 0.04, y0 + SIGN_CLEARANCE, y0 + 0.15, 0.012, 0.42, s.accent, 0.04, 2);
    c.b.faceQuad(f, mid - w / 2, mid + w / 2, y0 + 0.15, y1 - 0.12, 0.03, c.cell('loggia'), WHITE);
    return;
  }
  const ww = bw * (tall ? 0.5 : 0.6);
  const wh = tall ? 1.85 : 1.3;
  const wy = y0 + (tall ? 0.8 : 0.9);
  const lit = c.rng.chance(LIT_SHARE);
  c.b.faceQuad(f, mid - ww / 2, mid + ww / 2, wy, wy + wh, 0.03, c.cell(lit ? 'okno' : 'oknoGasne'), WHITE);
  c.b.faceBox(f, mid - ww / 2 - 0.1, mid + ww / 2 + 0.1, wy - 0.08, wy, 0.012, 0.14, STONE);
  if (tall) c.b.faceBox(f, mid - ww / 2 - 0.1, mid + ww / 2 + 0.1, wy + wh, wy + wh + 0.14, 0.012, 0.1, STONE);
}

/** Kondygnacje powyżej parteru na jednej ścianie. `loggias`: pasy loggii na froncie bloku. */
function upperFloors(c: Ctx, s: VolumeSpec, f: Face, fromFloor: number, loggias: boolean): void {
  const n = bayCount(f.length, s.style === 'kamienica' ? 1.7 : 1.5);
  const bw = f.length / n;
  const panel = c.cell(s.style === 'blok' ? 'szewPlyty' : 'tynk');
  for (let k = fromFloor; k < s.floors; k++) {
    const y0 = s.groundH + (k - 1) * s.floorH;
    const y1 = y0 + s.floorH;
    for (let i = 0; i < n; i++) {
      const loggia = loggias && s.style === 'blok' && i % 3 === 1;
      c.b.faceQuad(f, i * bw, (i + 1) * bw, y0, y1, 0.012, panel, loggia ? s.accent : s.main);
      windowBay(c, s, f, i * bw, (i + 1) * bw, y0, y1, loggia ? 'loggia' : 'okno');
    }
    if (s.style === 'kamienica' && k >= 1) {
      // gzyms nad parterem i pod każdą kondygnacją
      c.b.faceRBox(f, 0, f.length, y0 + SIGN_CLEARANCE, y0 + 0.32, 0.012, 0.14, CREAM, 0.035);
      for (let i = 0; i < n; i++) c.b.faceQuad(f, i * bw, (i + 1) * bw, y0 + SIGN_CLEARANCE, y0 + 0.32, 0.1545, c.cell('gzyms'), WHITE);
    } else if (s.style === 'blok') {
      c.b.faceRBox(f, 0, f.length, y0 + SIGN_CLEARANCE, y0 + 0.16, 0.012, 0.1, STONE, 0.03);
    }
  }
}

/** Parter budynku obok sklepu: witryny z wejściem, brama (kamienica) albo gołe płyty na bokach i z tyłu. */
function groundFloor(c: Ctx, s: VolumeSpec, f: Face, front: boolean): void {
  const panel = c.cell(s.style === 'blok' ? 'szewPlyty' : 'tynk');
  const n = bayCount(f.length, s.gate ? f.length : 2.9);
  const bw = f.length / n;
  for (let i = 0; i < n; i++) {
    const s0 = i * bw;
    const s1 = s0 + bw;
    const mid = (s0 + s1) / 2;
    c.b.faceQuad(f, s0, s1, 0, s.groundH, 0.012, panel, s.main);
    if (!front) {
      if (c.rng.chance(0.5)) c.b.faceQuad(f, mid - 0.45, mid + 0.45, 1.0, 2.2, 0.03, c.cell('oknoGasne'), WHITE);
      continue;
    }
    if (s.gate) {
      c.b.faceQuad(f, mid - 1.2, mid + 1.2, 0, 3.0, 0.03, c.cell('brama'), WHITE);
      continue;
    }
    const entrance = i === Math.floor(n / 2) && n > 1 && s.style !== 'pawilon';
    if (entrance) c.b.faceQuad(f, mid - 0.8, mid + 0.8, 0, 2.5, 0.03, c.cell('brama'), WHITE);
    else c.b.faceQuad(f, s0 + 0.2, s1 - 0.2, 0.25, 2.95, 0.03, c.cell('witryna'), WHITE);
    c.b.faceBox(f, s0 + 0.05, s1 - 0.05, 0, 0.25, 0.012, 0.08, s.accent);
    if (!entrance && c.rng.chance(0.5)) c.b.faceRBox(f, s0 + 0.15, s1 - 0.15, 3.0, 3.18, 0.012, 0.85, s.accent, 0.05, 2);
  }
}

/** Pasma ścian jednej bryły: front (od ulicy), tył i boki, boki tylko tam, gdzie wystają ponad sąsiada. */
function facades(c: Ctx, s: VolumeSpec): void {
  const yStart = s.overStore ? s.groundH : 0;
  const H = volumeHeight(s);
  const sides: { f: Face; front: boolean; cover: number }[] = [
    { f: new Face(s.x1, s.z0, 0, -1, s.x1 - s.x0), front: true, cover: 0 },
    { f: new Face(s.x0, s.z1, 0, 1, s.x1 - s.x0), front: false, cover: 0 },
    { f: new Face(s.x0, s.z0, -1, 0, s.z1 - s.z0), front: false, cover: s.coverMin },
    { f: new Face(s.x1, s.z1, 1, 0, s.z1 - s.z0), front: false, cover: s.coverMax },
  ];
  for (const { f, front, cover } of sides) {
    if (cover >= H) {
      if (s.mural && cover > 0) mural(c, s.mural, f, H);
      continue;
    }
    if (!s.overStore) groundFloor(c, s, f, front);
    if (s.floors > 1) upperFloors(c, s, f, 1, front);
    if (s.style === 'kamienica' && front) {
      // lizeny w narożach i gzyms koronujący
      for (const [a, b] of [[0, 0.4], [f.length - 0.4, f.length]] as const) c.b.faceRBox(f, a, b, yStart + (s.overStore ? SIGN_CLEARANCE : 0), H, 0.012, 0.1, CREAM, 0.03);
      c.b.faceRBox(f, 0, f.length, H - 0.1, H + 0.3, 0.012, 0.32, CREAM, 0.06, 2);
      const n = bayCount(f.length, 1.7);
      for (let i = 0; i < n; i++) c.b.faceQuad(f, (i * f.length) / n, ((i + 1) * f.length) / n, H - 0.1, H + 0.3, 0.3345, c.cell('gzyms'), WHITE);
    }
  }
}

/** Najwyższy mural (m): przy domyślnym zoomie nad sklepem widać ~3,5 m ściany, a cały mural ma się zmieścić w kadrze. */
const MURAL_MAX_H = 3.3;
/** Proporcje komórek muralu w atlasie (szerokość / wysokość wnętrza komórki). */
const MURAL_ASPECT = { mural: 500 / 500, muralSzop: 500 / 436 } as const;

/**
 * Mural na ślepej ścianie szczytowej: największy prostokąt o proporcjach komórki, który mieści się nad parterem sklepu
 * (od WALL_H + 0,35 m do H − 0,6 m) z marginesem 0,5 m od naroży, oparty o dolną krawędź (tuż nad sklepem, więc mieści się
 * w kadrze domyślnego zoomu). Niski budynek muralu nie dostaje.
 */
function mural(c: Ctx, cell: 'mural' | 'muralSzop', f: Face, H: number): void {
  const y0 = WALL_H + 0.35;
  const y1 = H - 0.6;
  const maxW = f.length - 1;
  const maxH = y1 - y0;
  if (maxW < 2 || maxH < 2) return;
  const aspect = MURAL_ASPECT[cell];
  const w = Math.min(maxW, Math.min(maxH, MURAL_MAX_H) * aspect);
  const h = w / aspect;
  const mid = f.length / 2;
  c.b.faceQuad(f, mid - w / 2, mid + w / 2, y0, y0 + h, 0.02, c.cell(cell), WHITE);
}

/** Dach: pokład, attyka dookoła i kilka drobiazgów (klatka schodowa, wentylatory, kominy). */
function roof(c: Ctx, s: VolumeSpec, roofColor: string): void {
  const H = volumeHeight(s);
  const t = 0.28;
  const ph = s.floors === 1 ? ATTIC_H : PARAPET_H;
  const { x0, x1, z0, z1 } = s;
  // attyka: obwodowy pas o jednolitym kolorze, z listwą wieńczącą
  c.b.rbox([x0, H, z0], [x1, H + ph, z0 + t], s.main, 0.06, 2);
  c.b.rbox([x0, H, z1 - t], [x1, H + ph, z1], s.main, 0.06, 2);
  c.b.rbox([x0, H, z0 + t], [x0 + t, H + ph, z1 - t], s.main, 0.06, 2);
  c.b.rbox([x1 - t, H, z0 + t], [x1, H + ph, z1 - t], s.main, 0.06, 2);
  c.b.rbox([x0 - 0.04, H + ph - 0.07, z0 - 0.04], [x1 + 0.04, H + ph + 0.05, z0 + t + 0.04], STONE, 0.03, 2);
  c.b.rbox([x0 - 0.04, H + ph - 0.07, z1 - t - 0.04], [x1 + 0.04, H + ph + 0.05, z1 + 0.04], STONE, 0.03, 2);
  c.b.rbox([x0 - 0.04, H + ph - 0.07, z0 + t], [x0 + t + 0.04, H + ph + 0.05, z1 - t], STONE, 0.03, 2);
  c.b.rbox([x1 - t - 0.04, H + ph - 0.07, z0 + t], [x1 + 0.04, H + ph + 0.05, z1 - t], STONE, 0.03, 2);
  // pokład dachu; nad sklepem (parter pawilonu) to płyta stropu
  const deck = H + (s.overStore && s.floors === 1 ? SLAB_T : 0.02);
  c.b.rbox([x0 + t, H - 0.02, z0 + t], [x1 - t, deck, z1 - t], roofColor, 0.02, 1);
  // drobiazgi
  const items = s.style === 'blok' ? 3 : 2;
  for (let i = 0; i < items; i++) {
    const w = c.rng.range(0.9, 1.6);
    const d = c.rng.range(0.9, 1.6);
    const h = s.style === 'blok' && i === 0 ? 2.4 : c.rng.range(0.6, 1.2);
    const x = c.rng.range(x0 + t + 0.6, Math.max(x0 + t + 0.61, x1 - t - 0.6 - w));
    const z = c.rng.range(z0 + t + 0.6, Math.max(z0 + t + 0.61, z1 - t - 0.6 - d));
    c.b.rbox([x, deck, z], [x + w, deck + h, z + d], i === 0 ? s.main : STREET.curb[1], 0.06, 2);
  }
}

const CUT_WALL_T = 0.12;
const FLOOR_TILE_M = 2;

/**
 * Przekrój budynku sąsiada jak przekrój sklepu: niski mur po obrysie (0,5 m) z wierzchem w kolorze przekroju, podłoga
 * z desek (komórka 'podloga', kafle po 2 m, bo komórka atlasu się nie powtarza) i ściany działowe z przejściami
 * (front lokalu, zaplecze i klatka schodowa), żeby ścięty budynek czytał się jak wnętrze, a nie pusty plac.
 */
function cutVolume(c: Ctx, s: VolumeSpec): void {
  const b = c.b;
  const t = WALL_T;
  const { x0, x1, z0, z1 } = s;
  const cap = PALETTE.wall[4];
  const floorCell = c.cell('podloga');
  const fy = 0.02;
  for (let x = x0 + t; x < x1 - t - 1e-6; x += FLOOR_TILE_M) {
    const xe = Math.min(x + FLOOR_TILE_M, x1 - t);
    for (let z = z0 + t; z < z1 - t - 1e-6; z += FLOOR_TILE_M) {
      const ze = Math.min(z + FLOOR_TILE_M, z1 - t);
      const du = (floorCell[2] - floorCell[0]) * ((xe - x) / FLOOR_TILE_M);
      const dv = (floorCell[3] - floorCell[1]) * ((ze - z) / FLOOR_TILE_M);
      b.quad([x, fy, ze], [xe, fy, ze], [xe, fy, z], [x, fy, z], [floorCell[0], floorCell[1], floorCell[0] + du, floorCell[1] + dv], PALETTE.floor[1]);
    }
  }
  const wall = (lo: V3, hi: V3, th = CUT_H): void => {
    b.rbox(lo, [hi[0], th - 0.02, hi[2]], s.main, 0.03, 2);
    b.rbox([lo[0], th - 0.02, lo[2]], [hi[0], th, hi[2]], cap, 0.008, 1);
  };
  wall([x0, 0, z0], [x1, 0, z0 + t]);
  wall([x0, 0, z1 - t], [x1, 0, z1]);
  wall([x0, 0, z0 + t], [x0 + t, 0, z1 - t]);
  wall([x1 - t, 0, z0 + t], [x1, 0, z1 - t]);
  // działówki: poprzeczna w 45% głębokości z przejściem, podłużna do tyłu z drugim przejściem
  const w = x1 - x0;
  const zMid = z0 + 0.45 * (z1 - z0);
  const door = 1.0;
  const gap = x0 + 0.3 * w;
  const half = CUT_WALL_T / 2;
  wall([x0 + t, 0, zMid - half], [gap, 0, zMid + half]);
  wall([gap + door, 0, zMid - half], [x1 - t, 0, zMid + half]);
  const xMid = x0 + 0.6 * w;
  const zDoor = zMid + 0.5 * (z1 - zMid);
  wall([xMid - half, 0, zMid + half], [xMid + half, 0, zDoor - door / 2]);
  wall([xMid - half, 0, zDoor + door / 2], [xMid + half, 0, z1 - t]);
  // biegi schodów w tylnym pokoju (klatka schodowa): stopnie po 0,1 m
  const sx = Math.min(x1 - t - 0.2, xMid + 2.2);
  for (let k = 0; k < 4; k++) {
    b.rbox([sx - 1.0, 0, z1 - t - 1.2 + k * 0.28], [sx, 0.1 + k * 0.1, z1 - t - 1.2 + (k + 1) * 0.28], STREET.curb[k % 2], 0.01, 1);
  }
}

// --- Wiersz zabudowy ----------------------------------------------------------------------------------------

/** Zewnętrzny obrys powłoki sklepu (lico zewnętrzne ścian) oraz krawędź chodnika od strony jezdni (`zs`). */
export interface StoreOuter { x0: number; x1: number; z0: number; z1: number; zs: number }

export function storeOuter(layout: Pick<StoreLayout, 'width' | 'depth'>): StoreOuter {
  const w = layout.width * CELL_SIZE_M;
  const d = layout.depth * CELL_SIZE_M;
  return {
    x0: -w / 2 + CELL_SIZE_M - WALL_T,
    x1: w / 2 - CELL_SIZE_M + WALL_T,
    z0: -d / 2 + (FRONT_WALL_Y + 1) * CELL_SIZE_M - WALL_T,
    z1: d / 2 - CELL_SIZE_M + WALL_T,
    zs: -d / 2,
  };
}

/** Strona drugiej witryny w lokalu narożnym ('minX' = lewa, −x), inaczej null. Tam zamiast sąsiada jest przecznica. */
export function cornerSide(layout: StoreLayout): 'minX' | 'maxX' | null {
  if (!layout.lot.corner) return null;
  const row = (FRONT_WALL_Y + 1) * layout.width;
  if (layout.cells[row] === 'window') return 'minX';
  if (layout.cells[row + layout.width - 1] === 'window') return 'maxX';
  return null;
}

/** Przecznica przy lokalu narożnym: chodnik, jezdnia, chodnik (m). */
export const SIDE_STREET = { sidewalk: 1.8, road: 5, total: 8.6 } as const;

/** `own`: liczba kondygnacji budynku ze sklepem (blok 5, kamienica 3–4, pawilon 1); `neighbour`: sąsiadów. */
const STYLE_RANGES: Record<LotKind, {
  own: [number, number]; neighbour: [number, number]; floorH: number; groundH: number; width: [number, number];
}> = {
  blok: { own: [5, 5], neighbour: [4, 6], floorH: 2.9, groundH: WALL_H, width: [9, 13] },
  kamienica: { own: [3, 4], neighbour: [3, 5], floorH: 3.4, groundH: WALL_H, width: [7, 11] },
  pawilon: { own: [1, 1], neighbour: [1, 1], floorH: 0, groundH: 3.4, width: [7, 10] },
};
const GATE_W = 3.2;

function pickColors(style: LotKind, rng: Rng, taken: string[]): [string, string] {
  const pool = style === 'blok' ? STREET.blokPastel : STREET.kamienicaPlaster;
  const free = pool.filter((c) => !taken.includes(c));
  const main = rng.pick(free.length > 0 ? free : pool);
  if (style === 'blok') return [main, rng.pick(pool.filter((c) => c !== main))];
  return [main, main === CREAM ? STREET.kamienicaPlaster[0] : CREAM];
}

/**
 * Plan wiersza: bryła nad sklepem (i brama kamienicy), potem sąsiedzi po obu stronach. Pierwsza lista to to, co należy
 * do `building:<kind>`, druga to sąsiedzi (`neighbour:<i>`).
 */
export function planRow(layout: StoreLayout, seed: string): { own: VolumeSpec[]; neighbours: VolumeSpec[] } {
  const rng = createRng(subSeed(subSeed(seed, 'street'), 'budynki'));
  const o = storeOuter(layout);
  const kind = layout.lot.kind;
  const corner = cornerSide(layout);
  const taken: string[] = [];
  const mk = (style: LotKind, x0: number, x1: number, floors: number, extra: Partial<VolumeSpec> = {}): VolumeSpec => {
    const r = STYLE_RANGES[style];
    const colors = pickColors(style, rng, taken);
    taken.push(colors[0]);
    return {
      style, x0, x1, z0: o.z0, z1: o.z1, floors, groundH: r.groundH, floorH: r.floorH,
      main: colors[0], accent: colors[1], overStore: false, gate: false, coverMin: 0, coverMax: 0, mural: null, ...extra,
    };
  };
  const between = (range: [number, number]): number => rng.int(range[0], range[1] + 1);

  const store = mk(kind, o.x0, o.x1, between(STYLE_RANGES[kind].own), { overStore: true });
  const own: VolumeSpec[] = [store];
  let lo = o.x0;
  let hi = o.x1;
  if (kind === 'kamienica') {
    const gateSide = corner === 'minX' ? 'maxX' : corner === 'maxX' ? 'minX' : rng.chance(0.5) ? 'minX' : 'maxX';
    const gate = mk('kamienica', gateSide === 'minX' ? o.x0 - GATE_W : o.x1, gateSide === 'minX' ? o.x0 : o.x1 + GATE_W,
      store.floors, { gate: true, main: store.main, accent: store.accent });
    own.push(gate);
    if (gateSide === 'minX') lo = gate.x0; else hi = gate.x1;
  }

  const neighbours: VolumeSpec[] = [];
  for (const side of ['minX', 'maxX'] as const) {
    const gap = corner === side ? SIDE_STREET.total : 0;
    const style: LotKind = kind === 'pawilon' ? (rng.chance(0.6) ? 'pawilon' : 'blok') : kind;
    const r = STYLE_RANGES[style];
    const width = rng.range(r.width[0], r.width[1]);
    const floors = between(r.neighbour);
    neighbours.push(side === 'minX' ? mk(style, lo - gap - width, lo - gap, floors) : mk(style, hi + gap, hi + gap + width, floors));
  }

  // murale na ślepych ścianach od strony sklepu: reklama Centrali i konkurencji, kolejność z osobnego strumienia,
  // żeby nie przesuwać losowań kolorów i szerokości
  const murals = createRng(subSeed(subSeed(seed, 'street'), 'murale')).chance(0.5) ? (['mural', 'muralSzop'] as const) : (['muralSzop', 'mural'] as const);
  neighbours.forEach((n, i) => { n.mural = murals[i]!; });

  const all = [...own, ...neighbours];
  for (const a of all) {
    for (const b of all) {
      if (a === b) continue;
      if (Math.abs(b.x1 - a.x0) < 0.01) a.coverMin = volumeHeight(b);
      if (Math.abs(b.x0 - a.x1) < 0.01) a.coverMax = volumeHeight(b);
    }
  }
  return { own, neighbours };
}

/** Kamera o danym `yawIndex` (tabela w CameraRig) stoi po stronie −x dla 0 i 1, po stronie +x dla 2 i 3. */
export type YawIndex = 0 | 1 | 2 | 3;
const cameraSide = (yaw: YawIndex): 'minX' | 'maxX' => (yaw <= 1 ? 'minX' : 'maxX');

export interface Buildings {
  root: Group;
  /**
   * Przekrój: bryła nad sklepem znika, a sąsiad od strony kamery (dla `yawIndex`) spada do 0,5 m z przekrojem wnętrza.
   * Dalszy sąsiad zostaje w pełnej wysokości: nie zasłania sklepu (promienie do kamery biegną od niego), a kadr wygląda
   * jak miasto, nie jak plac. `false` pokazuje pełną zabudowę.
   */
  setCutaway(on: boolean, yawIndex?: YawIndex): void;
  /** Noc zapala emissive okien (część okien, wg atlasu). */
  setNight(on: boolean): void;
  dispose(): void;
}

const WINDOW_GLOW = { color: '#ffd28a', night: 1.1 } as const;

export function buildBuildings(layout: StoreLayout, seed: string, atlas: FacadeAtlas, plan = planRow(layout, seed)): Buildings {
  const rng = createRng(subSeed(subSeed(seed, 'street'), 'elewacje'));
  const tynk = atlas.cell('tynk');
  const flat: [number, number] = [(tynk[0] + tynk[2]) / 2, (tynk[1] + tynk[3]) / 2];
  const material = new MeshStandardMaterial({
    name: 'street:buildings', map: atlas.map, vertexColors: true, roughness: 0.85, metalness: 0,
    emissiveMap: atlas.emissive, emissive: new Color(WINDOW_GLOW.color), emissiveIntensity: 0,
  });
  const owned: BufferGeometry[] = [];
  const root = new Group();
  root.name = 'buildings';
  const toggles: { full: Mesh; cut: Mesh | null; side: 'own' | 'minX' | 'maxX' }[] = [];
  let roofIndex = 0;

  const make = (name: string, volumes: VolumeSpec[], cutVolumes: VolumeSpec[], side: 'own' | 'minX' | 'maxX'): void => {
    const c: Ctx = { b: new GeomBuilder(flat), atlas, rng, cell: (n) => atlas.cell(n) };
    for (const s of volumes) {
      const yStart = s.overStore ? s.groundH : 0;
      const H = volumeHeight(s);
      if (H > yStart + 0.01) c.b.rbox([s.x0, yStart, s.z0], [s.x1, H, s.z1], s.main, 0.12, 3);
      facades(c, s);
      roof(c, s, ROOFS[roofIndex++ % ROOFS.length]!);
    }
    const group = new Group();
    group.name = name;
    const full = new Mesh(c.b.toGeometry(), material);
    full.name = `${name}:full`;
    full.castShadow = full.receiveShadow = false;
    owned.push(full.geometry);
    group.add(full);
    let cut: Mesh | null = null;
    if (cutVolumes.length > 0) {
      const cc: Ctx = { b: new GeomBuilder(flat), atlas, rng, cell: (n) => atlas.cell(n) };
      for (const s of cutVolumes) cutVolume(cc, s);
      cut = new Mesh(cc.b.toGeometry(), material);
      cut.name = `${name}:cut`;
      cut.castShadow = cut.receiveShadow = false;
      cut.visible = false;
      owned.push(cut.geometry);
      group.add(cut);
    }
    toggles.push({ full, cut, side });
    root.add(group);
  };

  const o = storeOuter(layout);
  make(`building:${layout.lot.kind}`, plan.own, plan.own.filter((s) => !s.overStore), 'own');
  plan.neighbours.forEach((n, i) => make(`neighbour:${i}`, [n], [n], n.x1 <= o.x0 + 1e-6 ? 'minX' : 'maxX'));

  let disposed = false;
  return {
    root,
    setCutaway(on, yawIndex = 0) {
      const near = cameraSide(yawIndex);
      for (const t of toggles) {
        const cutHere = on && (t.side === 'own' || t.side === near);
        t.full.visible = !cutHere;
        if (t.cut) t.cut.visible = cutHere;
      }
    },
    setNight(on) { material.emissiveIntensity = on ? WINDOW_GLOW.night : 0; },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const g of owned) g.dispose();
      owned.length = 0;
      material.dispose();
    },
  };
}
