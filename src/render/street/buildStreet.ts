import {
  AdditiveBlending, Box3, BufferGeometry, Color, Float32BufferAttribute, Group, Matrix3, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Vector3, type Material, type Object3D, type Texture,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ASSETS, loadGLB } from '@/render/assets';
import { cellToWorld } from '@/render/coords';
import { PALETTE, material } from '@/render/style';
import { BRAND, FIX, cachedTexture, canvasTexture, makeTextured } from '@/render/store/parts';
import { CURB_W_M } from '@/render/store/shell';
import {
  BOARD_LINES, buildBench, buildBin, buildNewsStand, buildPlanter, buildPylon, buildSandwichBoard, pylonTextures,
} from '@/render/store/props';
import { createRng, subSeed, type Rng } from '@/sim/rng';
import type { StoreLayout } from '@/sim/store/types';
import { buildBuildings, cornerSide, GeomBuilder, planRow, SIDE_STREET, storeOuter, type StoreOuter, type YawIndex } from './buildings';
import { COURT_DEPTH, buildCourtyard, buildTree } from './courtyard';
import { createFacadeAtlas } from './facadeAtlas';

/**
 * Ulica i otoczenie sklepu: chodnik z płyt (wiersze 0–3 siatki plus pas pod ścianą), krawężnik, jezdnia z pasami
 * i przejściem, budynki (buildings.ts) i rekwizyty (drzewa, latarnie, dostawczak z Kenney, ławka i kosz proceduralne).
 *
 * Układ: ulica leży po stronie −z (wiersz 0 siatki to krawędź chodnika od jezdni), chodnik jest na poziomie podłogi
 * sklepu (y = 0), jezdnia 14 cm niżej. Cała statyczna geometria jest zmergowana do kilku siatek (po jednej na materiał).
 */

export interface StreetView {
  root: Group;
  /**
   * Przekrój (widok wnętrza): bryła nad sklepem znika, sąsiad od strony kamery (`yawIndex`, tabela w CameraRig) spada
   * do 0,5 m, dalszy zostaje w pełnej wysokości. `false` pokazuje pełną zabudowę.
   */
  setBuildingCutaway(on: boolean, yawIndex?: YawIndex): void;
  /** Noc: świecą okna budynków i głowice latarni. */
  setTimeOfDay(t: 'day' | 'night'): void;
  dispose(): void;
}

// --- Wymiary ------------------------------------------------------------------------------------------------

const PLATE = 0.5;
const LIMIT = 48;            // zasięg ulicy w obie strony (m); widok ma ≤ 30 m wysokości, a pan sięga 4 m poza sklep
const CURB_SEG = 5;          // długość odcinka krawężnika (m)
const CURB_NEAR = 16;        // do tylu metrów od środka sklepu krawężnik ma fazę 2-segmentową, dalej 1-segmentową
const CURB_W = CURB_W_M;
const CURB_TOP = 0.02;
const ROAD_Y = -0.14;
const ROAD_W = 7;
const FAR_SIDEWALK_W = 3;
const GROUND_Y = -0.16;
const TREE_MARGIN = 5.5;     // drzewa nie zasłaniają sklepu w żadnym obrocie kamery (korona zasłania do ~5 m w głąb)

// --- Tekstury ----------------------------------------------------------------------------------------------

/** Płyta chodnikowa 50×50: kremowa baza (kolor daje wierzchołek), fuga po brzegach, fazowanie. */
function plateTexture(): Texture {
  return cachedTexture('street|plate', () => canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = PALETTE.street.sidewalk[3];
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = BRAND.cream;
    ctx.fillRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = BRAND.cream;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(5, 5, w - 10, 4);
    ctx.fillRect(5, 5, 4, h - 10);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = PALETTE.wall[4];
    ctx.fillRect(5, h - 9, w - 10, 4);
    ctx.fillRect(w - 9, 5, 4, h - 10);
    ctx.globalAlpha = 1;
  }));
}

/** Asfalt: kremowa baza z delikatnym ziarnem, powtarzana co 4 m. */
function asphaltTexture(): Texture {
  return cachedTexture('street|asphalt', () => canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = BRAND.cream;
    ctx.fillRect(0, 0, w, h);
    const rng = createRng(subSeed('street', 'asphalt'));
    for (let i = 0; i < 380; i++) {
      ctx.globalAlpha = 0.05 + rng.next() * 0.07;
      ctx.fillStyle = rng.chance(0.5) ? PALETTE.street.asphalt[3] : PALETTE.street.sidewalk[2];
      ctx.fillRect(rng.next() * w, rng.next() * h, 2 + rng.next() * 6, 2 + rng.next() * 6);
    }
    ctx.globalAlpha = 1;
  }, true));
}

// --- Geometria podłoża -----------------------------------------------------------------------------------

/** Pozioma płaszczyzna (normalna +y) jako czworokąt; UV w jednostkach powtórzeń tekstury. */
function slab(b: GeomBuilder, x0: number, x1: number, z0: number, z1: number, y: number, color: string, uv: [number, number, number, number]): void {
  b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], uv, color);
}

interface Ground {
  plates: GeomBuilder;
  road: GeomBuilder;
  flat: GeomBuilder;
}

/** Układanie płyt 0,5 × 0,5 m w prostokącie, w siatce kratek sklepu; kolor per płyta z listy PALETTE.street.sidewalk. */
function layPlates(g: Ground, rng: Rng, gridX: (i: number) => number, xa: number, xb: number, za: number, zb: number): void {
  const colors = PALETTE.street.sidewalk;
  const first = Math.floor((xa - gridX(0)) / PLATE + 1e-6);
  for (let x = gridX(first); x < xb - 1e-6; x += PLATE) {
    const x0 = Math.max(x, xa);
    const x1 = Math.min(x + PLATE, xb);
    for (let z = za; z < zb - 1e-6; z += PLATE) {
      const z1 = Math.min(z + PLATE, zb);
      g.plates.quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z], [x0, 0, z], [(x0 - x) / PLATE, 0, (x1 - x) / PLATE, (z1 - z) / PLATE], rng.pick(colors));
    }
  }
}

interface Layout {
  o: StoreOuter;
  corner: 'minX' | 'maxX' | null;
  /** Przecznica: [xa, xb] jezdni (tylko przy lokalu narożnym). */
  side: [number, number] | null;
  zr0: number;
  zr1: number;
  gridX: (i: number) => number;
}

function buildGround(g: Ground, lay: Layout, rng: Rng, crossing: number | null): void {
  const { o, side, zr0, zr1 } = lay;
  const zs = o.zs;
  const flat = g.flat;
  const asphalt = PALETTE.street.asphalt;
  // podłoże pod wszystkim
  slab(flat, -LIMIT * 1.6, LIMIT * 1.6, -LIMIT * 1.6, LIMIT * 1.6, GROUND_Y, PALETTE.street.sidewalk[3], [0, 0, 0, 0]);

  // chodniki: pas przed sklepem i sąsiadami (z przerwą na przecznicę), pas przy ścianie boku, chodnik po drugiej stronie jezdni
  const xs: [number, number][] = side
    ? [[-LIMIT, side[0] - CURB_W], [side[1] + CURB_W, LIMIT]]
    : [[-LIMIT, LIMIT]];
  for (const [xa, xb] of xs) layPlates(g, rng, lay.gridX, xa, xb, zs, o.z0);
  const farZ1 = zr1 - CURB_W;
  layPlates(g, rng, lay.gridX, -LIMIT, LIMIT, farZ1 - FAR_SIDEWALK_W, farZ1);
  if (side) {
    const back = o.z1 + COURT_DEPTH;   // chodniki przecznicy biegną wzdłuż podwórka (courtyard.ts)
    layPlates(g, rng, lay.gridX, side[0] - SIDE_STREET.sidewalk, side[0] - CURB_W, o.z0, back);
    layPlates(g, rng, lay.gridX, side[1] + CURB_W, side[1] + SIDE_STREET.sidewalk, o.z0, back);
  }

  // jezdnia (tekstura asfaltu powtarza się co 4 m) z łatami
  const road = (x0: number, x1: number, z0: number, z1: number): void => slab(g.road, x0, x1, z0, z1, ROAD_Y, asphalt[0], [x0 / 4, z0 / 4, x1 / 4, z1 / 4]);
  road(-LIMIT, LIMIT, zr1, zr0);
  if (side) road(side[0], side[1], zr0, LIMIT);
  for (let i = 0; i < 5; i++) {
    const x = rng.range(-30, 30);
    if (side && x > side[0] - 2 && x < side[1] + 2) continue;
    const w = rng.range(1, 2.2);
    const d = rng.range(0.6, 1.3);
    const z = rng.range(zr1 + 0.4, zr0 - 0.4 - d);
    slab(g.road, x, x + w, z, z + d, ROAD_Y + 0.002, asphalt[1], [x / 4, z / 4, (x + w) / 4, (z + d) / 4]);
  }

  // oznakowanie: oś jezdni (przerywana), przejście dla pieszych (pasy wzdłuż jezdni, kolejno w poprzek)
  const mark = (x0: number, x1: number, z0: number, z1: number): void => slab(g.road, x0, x1, z0, z1, ROAD_Y + 0.004, asphalt[2], [x0 / 4, z0 / 4, x1 / 4, z1 / 4]);
  const mid = (zr0 + zr1) / 2;
  for (let x = -LIMIT + 1; x < LIMIT - 2; x += 5) {
    const inSide = side !== null && x + 2 > side[0] && x < side[1];
    const inCross = crossing !== null && x + 2 > crossing - 2.4 && x < crossing + 2.4;
    if (!inSide && !inCross) mark(x, x + 2, mid - 0.06, mid + 0.06);
  }
  if (crossing !== null) for (let k = 0; k < ROAD_W - 0.5; k += 1) mark(crossing - 2, crossing + 2, zr0 - 0.45 - k - 0.5, zr0 - 0.45 - k);
  if (side) for (let z = zr0 + 2; z < LIMIT; z += 5) mark((side[0] + side[1]) / 2 - 0.06, (side[0] + side[1]) / 2 + 0.06, z, z + 2);

  // krawężniki: odcinki po 5 m, co jakiś starszy w drugim kolorze; fazowanie pełne tylko w pobliżu sklepu (trójkąty)
  const curb = (x0: number, x1: number, z0: number, z1: number): void =>
    flat.rbox([x0, ROAD_Y, z0], [x1, CURB_TOP, z1], PALETTE.street.curb[rng.chance(0.25) ? 1 : 0], 0.04, Math.abs((x0 + x1) / 2) <= CURB_NEAR ? 2 : 1);
  const stretches: [number, number][] = side ? [[-LIMIT, side[0]], [side[1], LIMIT]] : [[-LIMIT, LIMIT]];
  for (const [a, b] of stretches) {
    for (let x = a; x < b - 1e-6; x += CURB_SEG) curb(x, Math.min(x + CURB_SEG, b), zs - CURB_W, zs);
  }
  for (let x = -LIMIT; x < LIMIT; x += CURB_SEG) curb(x, x + CURB_SEG, zr1 - CURB_W, zr1);
  if (side) {
    const back = o.z1 + COURT_DEPTH;
    for (let z = zs - CURB_W; z < back; z += CURB_SEG) {
      const z1 = Math.min(z + CURB_SEG, back);
      curb(side[0] - CURB_W, side[0], z, z1);
      curb(side[1], side[1] + CURB_W, z, z1);
    }
  }
}

// --- Modele Kenney: przemalowanie na paletę ----------------------------------------------------------------

type PropKind = 'tree' | 'lamp' | 'van';

const LAMP_GLOW = '#ffb35c';
/** Neon pylonu (napis i logo `brand.cream`): nocą jak neon szyldu (przewodnik §4: 3), w dzień ledwie się żarzy. */
const PYLON_GLOW = { day: 0.35, night: 3 } as const;
const LAMP_HEAD_NIGHT = 3;
/** Głowica latarni: nocą emissive `#ffb35c` (docs/style-guide.md §4), w dzień kremowa obudowa. */
const lampHeadMaterial = (night: boolean): Material =>
  night ? material('emissive', LAMP_GLOW, { emissiveIntensity: LAMP_HEAD_NIGHT }) : material('plasticGloss', BRAND.cream);

/** Kolor części modelu po przemalowaniu (tylko PALETTE). Żarówka latarni jest osobna: ma materiał emissive. */
function partColor(key: string, leaves: string): string {
  const { productCategory: cat, street } = PALETTE;
  switch (key) {
    case 'trunk': return FIX.wood;
    case 'leaves': return leaves;
    case 'pole': return street.asphalt[0];
    case 'body': return BRAND.green;
    case 'cream': return BRAND.cream;
    case 'glass': return cat.nabial[2];
    case 'tyre': return street.asphalt[3];
    case 'rim': return FIX.metal;
    case 'under': return street.asphalt[0];
    case 'yellow': return cat.przekaski[0];
    case 'red': return cat.napoje[0];
    default: return FIX.metal;
  }
}

/** Część modelu wg koloru teksela z `colormap` Kenneya (gradienty palety) i nazwy siatki. */
function partOf(kind: PropKind, meshName: string, materialName: string, rgb: [number, number, number] | null, p: Vector3): string {
  if (kind === 'tree') return materialName === 'woodBark' ? 'trunk' : 'leaves';
  // głowica latarni: koniec wysięgnika (ostatnie 17 cm w kierunku −z na samej górze modelu 0,67 m)
  if (kind === 'lamp') return p.y > 0.6 && p.z < -0.04 ? 'bulb' : 'pole';
  if (!rgb) return 'body';
  const [r, g, b] = rgb;
  const lum = (r + g + b) / 765;
  if (meshName.startsWith('wheel')) return lum < 0.3 ? 'tyre' : 'rim';
  if (r > 0xc0 && g < 0x80) return 'red';
  if (r > 0xe0 && g > 0xb0 && b < 0x80) return 'yellow';
  if (g > r + 0x20 && g > b) return 'body';
  if (lum < 0.3) return 'tyre';
  if (b > r + 0x14 && lum > 0.85) return 'glass';
  if (lum > 0.75) return 'cream';
  return lum < 0.5 ? 'under' : 'rim';
}

/** Odczyt pikseli tekstury koloru modelu (tylko w przeglądarce; w Node zwraca null). */
function readPixels(texture: Texture | null): { data: Uint8ClampedArray; w: number; h: number } | null {
  const image = texture?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!image || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, w: canvas.width, h: canvas.height };
}

/**
 * Przemalowuje model Kenneya na paletę stylu i spłaszcza go do jednej siatki z kolorami wierzchołków (`material`), plus
 * osobnej siatki żarówki latarni (emissive). Drzewo, latarnia i dostawczak kosztują więc 1–2 draw calle zamiast
 * kilkunastu (dostawczak ma 6 siatek i 8 kolorów). Siatki są nowe (zwalnia je `owned`). Skaluje do `height`, stawia na podłożu.
 */
function restyleModel(
  kind: PropKind, source: Object3D, height: number, leaves: string, material: Material, owned: BufferGeometry[],
): { model: Group; lampHeads: Mesh[] } {
  source.updateMatrixWorld(true);
  interface Bucket { pos: number[]; nor: number[]; col: number[] }
  const buckets: Record<'main' | 'bulb', Bucket> = { main: { pos: [], nor: [], col: [] }, bulb: { pos: [], nor: [], col: [] } };
  const normalMatrix = new Matrix3();
  const v = new Vector3();
  const centroid = new Vector3();
  const c = new Color();
  source.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as MeshStandardMaterial;
    const pixels = readPixels(mat.map);
    const geo = mesh.geometry;
    const p = geo.attributes.position!;
    const n = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const order = geo.index ? Array.from(geo.index.array) : Array.from({ length: p.count }, (_, i) => i);
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    for (let t = 0; t < order.length; t += 3) {
      let rgb: [number, number, number] | null = null;
      if (pixels && uv) {
        const u = (uv.getX(order[t]!) + uv.getX(order[t + 1]!) + uv.getX(order[t + 2]!)) / 3;
        const w = (uv.getY(order[t]!) + uv.getY(order[t + 1]!) + uv.getY(order[t + 2]!)) / 3;
        const i = (Math.min(pixels.h - 1, Math.floor(w * pixels.h)) * pixels.w + Math.min(pixels.w - 1, Math.floor(u * pixels.w))) * 4;
        rgb = [pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!];
      }
      centroid.set(0, 0, 0);
      for (let j = 0; j < 3; j++) centroid.add(v.fromBufferAttribute(p, order[t + j]!).applyMatrix4(mesh.matrixWorld).multiplyScalar(1 / 3));
      const key = partOf(kind, mesh.name, mat.name, rgb, centroid);
      const bucket = key === 'bulb' ? buckets.bulb : buckets.main;
      c.set(partColor(key, leaves));
      for (let j = 0; j < 3; j++) {
        const i = order[t + j]!;
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        bucket.pos.push(v.x, v.y, v.z);
        if (n) v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize(); else v.set(0, 1, 0);
        bucket.nor.push(v.x, v.y, v.z);
        bucket.col.push(c.r, c.g, c.b);
      }
    }
  });

  const bounds = new Box3();
  const meshes: Mesh[] = [];
  const lampHeads: Mesh[] = [];
  for (const [name, bucket] of Object.entries(buckets) as ['main' | 'bulb', Bucket][]) {
    if (bucket.pos.length === 0) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(bucket.pos, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(bucket.nor, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(bucket.col, 3));
    geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!);
    owned.push(geometry);
    const mesh = new Mesh(geometry, name === 'bulb' ? lampHeadMaterial(false) : material);
    mesh.name = `${kind}:${name}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    meshes.push(mesh);
    if (name === 'bulb') lampHeads.push(mesh);
  }
  const model = new Group();
  const k = height / (bounds.max.y - bounds.min.y);
  model.scale.setScalar(k);
  model.position.y = -bounds.min.y * k;
  model.add(...meshes);
  return { model, lampHeads };
}

interface PropSpec {
  kind: PropKind;
  group: Group;
  url: string;
  /** Docelowa wysokość modelu (m). */
  height: number;
  /** Kolor korony (tylko drzewa); losowany z seeda przed wczytaniem, żeby nie zależał od kolejności wczytywania. */
  leaves: string;
}
const LEAVES = [BRAND.green, PALETTE.productCategory.napoje[3], PALETTE.productCategory.przekaski[3]];

// --- Rekwizyty proceduralne (props.ts) --------------------------------------------------------------

/**
 * Scala siatki grupy, żeby rekwizyt kosztował jak najmniej draw calli: części bez tekstury w jedną siatkę z kolorami
 * wierzchołków (kolor z materiału części, `material`), części z teksturą (napisy) w jedną siatkę na materiał. Źródłowe
 * geometrie są współdzielone (cache parts.ts) i zostają nietknięte; wynik trafia do `owned`.
 */
function bake(group: Group, material: Material, owned: BufferGeometry[]): void {
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const meshes: Mesh[] = [];
  group.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
  const plain: BufferGeometry[] = [];
  const textured = new Map<Material, BufferGeometry[]>();
  for (const mesh of meshes) {
    const mat = mesh.material as MeshStandardMaterial;
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld.clone().premultiply(inverse));
    if (mat.map) {
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      textured.set(mat, [...(textured.get(mat) ?? []), g]);
    } else {
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      const colors = new Float32Array(g.attributes.position!.count * 3);
      for (let i = 0; i < colors.length; i += 3) { colors[i] = mat.color.r; colors[i + 1] = mat.color.g; colors[i + 2] = mat.color.b; }
      g.setAttribute('color', new Float32BufferAttribute(colors, 3));
      plain.push(g);
    }
    mesh.removeFromParent();
  }
  const add = (parts: BufferGeometry[], mat: Material, name: string, cast: boolean): void => {
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!merged) return;
    owned.push(merged);
    const out = new Mesh(merged, mat);
    out.name = name;
    out.castShadow = cast;
    out.receiveShadow = true;
    group.add(out);
  };
  // puste podgrupy po zdjęciu siatek (np. nogi potykacza) nie są potrzebne; siatka z kolorami wierzchołków idzie pierwsza
  for (const g of group.children.slice()) if (!(g as Mesh).isMesh && g.children.length === 0) g.removeFromParent();
  if (plain.length) add(plain, material, `${group.name}:mesh`, true);
  for (const [mat, parts] of textured) add(parts, mat, `${group.name}:${mat.name}`, false);
}

// --- Rozmieszczenie rekwizytów z seeda ------------------------------------------------------------------

interface Placement { x: number; z: number; rotY: number }

/** Wolny odcinek jezdni lub chodnika: odrzuca punkt w pobliżu zajętych przedziałów x. */
const blocked = (x: number, zones: [number, number][], pad: number): boolean => zones.some(([a, b]) => x > a - pad && x < b + pad);

function placeProps(layout: StoreLayout, rng: Rng, lay: Layout, extent: [number, number], crossing: number | null): {
  lamps: Placement[]; trees: Placement[]; van: Placement; bench: Placement; bin: Placement;
  board: Placement | null; pylon: Placement | null; planter: Placement | null; newsstand: Placement | null;
} {
  const { o, side } = lay;
  const zs = o.zs;
  const zones: [number, number][] = [];
  if (side) zones.push([side[0] - SIDE_STREET.sidewalk, side[1] + SIDE_STREET.sidewalk]);
  if (crossing !== null) zones.push([crossing - 2, crossing + 2]);
  // krańce, od których odmierzamy odstępy: obrys sklepu z bramą, a po stronie przecznicy kraniec chodnika za nią
  const left = side && lay.corner === 'minX' ? side[0] - SIDE_STREET.sidewalk : extent[0];
  const right = side && lay.corner === 'maxX' ? side[1] + SIDE_STREET.sidewalk : extent[1];

  // latarnie przy krawężniku po obu stronach sklepu, nie na przejściu dla pieszych; wysięgnik skierowany na jezdnię (−z)
  const lamps: Placement[] = [];
  for (const dir of [-1, 1] as const) {
    let x = 0;
    for (let tries = 0; tries < 12; tries++) {
      x = dir < 0 ? left - rng.range(3.5, 5.5) : right + rng.range(3.5, 5.5);
      if (!blocked(x, zones, 0.8)) break;
    }
    lamps.push({ x, z: zs + 0.18, rotY: 0 });
  }

  const trees: Placement[] = [];
  const count = rng.int(2, 5);
  for (let tries = 0; trees.length < count && tries < 80; tries++) {
    const dir = rng.chance(0.5) ? -1 : 1;
    const x = dir < 0 ? left - TREE_MARGIN - rng.range(0, 12) : right + TREE_MARGIN + rng.range(0, 12);
    const rotY = rng.range(0, Math.PI * 2);
    if (blocked(x, zones, 1.2)) continue;
    if (trees.some((t) => Math.abs(t.x - x) < 4) || lamps.some((l) => Math.abs(l.x - x) < 2.5)) continue;
    trees.push({ x, z: zs + 0.62, rotY });
  }

  // dostawczak stoi przy krawężniku z dala od sklepu (wysoka bryła zasłoniłaby wejście w którymś z obrotów kamery)
  let van: Placement = { x: left - 8, z: lay.zr0 - 1.3, rotY: Math.PI / 2 };
  for (let tries = 0; tries < 40; tries++) {
    const dir = rng.chance(0.5) ? -1 : 1;
    const x = dir < 0 ? left - 3.5 - rng.range(0, 8) : right + 3.5 + rng.range(0, 8);
    // przód modelu to +z; ruch prawostronny: w pasie przy krawężniku (po stronie +z jezdni) jedzie się w stronę +x
    if (!blocked(x, zones, 2.6)) { van = { x, z: lay.zr0 - 1.3, rotY: Math.PI / 2 }; break; }
  }

  // ławka i kosz w wierszu 0 siatki (przy krawężniku), przed sklepem albo bramą, z dala od wejścia i od siebie.
  // Wiersz 0 jest zablokowany dla klientów w buildNav (src/sim/crowd/crowd.ts), więc nikt przez nie nie przechodzi.
  const entranceX = layout.entrance.reduce((sum, c) => sum + cellToWorld(layout, c.x, c.y).x, 0) / layout.entrance.length;
  const spot = (clearance: number, avoid: number | null, fallback: number): number => {
    for (let tries = 0; tries < 80; tries++) {
      const x = rng.range(extent[0] + 0.8, extent[1] - 0.8);
      if (Math.abs(x - entranceX) > clearance && (avoid === null || Math.abs(x - avoid) > 2.4)) return x;
    }
    return fallback;
  };
  const benchX = spot(2.2, null, entranceX - 3.2);
  const binX = spot(1.4, benchX, entranceX + 3.2);

  // potykacz przy wejściu, donica i stojak z gazetami: też w wierszu 0, z dala od siebie, od wejścia i od przecznicy
  const taken: [number, number][] = [[benchX - 0.9, benchX + 0.9], [binX - 0.3, binX + 0.3]];
  const fits = (x: number, half: number): boolean =>
    !blocked(x, zones, half + 0.3) && taken.every(([a, b]) => x + half + 0.35 < a || x - half - 0.35 > b);
  const claim = (x: number, half: number): Placement => {
    taken.push([x - half, x + half]);
    return { x, z: zs + 0.27, rotY: 0 };
  };
  const extra = (half: number, clearance: number, lo: number, hi: number): Placement | null => {
    for (let tries = 0; tries < 80; tries++) {
      const x = rng.range(lo + half, hi - half);
      if (Math.abs(x - entranceX) > clearance && fits(x, half)) return claim(x, half);
    }
    return null;
  };
  let board: Placement | null = null;
  const boardSide = rng.chance(0.5) ? 1 : -1;
  for (const dir of [boardSide, -boardSide]) {
    const x = entranceX + dir * rng.range(1.0, 1.5);
    if (fits(x, 0.32)) { board = claim(x, 0.32); break; }
  }
  // pylon z neonem marki po drugiej stronie wejścia (w przekroju to on niesie szyld i neon w kadrze)
  let pylon: Placement | null = null;
  for (const dir of [-boardSide, boardSide]) {
    const x = entranceX + dir * rng.range(1.9, 2.6);
    if (fits(x, 0.47)) { pylon = claim(x, 0.47); break; }
  }
  pylon ??= extra(0.47, 1.6, extent[0] - 1, extent[1] + 1);
  const planter = extra(0.5, 1.6, extent[0] - 2, extent[1] + 2);
  const newsstand = extra(0.4, 1.4, extent[0] - 2, extent[1] + 2);
  return {
    lamps, trees, van,
    bench: { x: benchX, z: zs + 0.27, rotY: 0 },
    bin: { x: binX, z: zs + 0.27, rotY: 0 },
    board, pylon, planter, newsstand,
  };
}

// --- Poświata latarni (noc) -------------------------------------------------------------------------------

/** Miękka plama światła: biała maska o spadku radialnym; kolor i siłę daje materiał. */
function poolTexture(): Texture {
  return cachedTexture('street|lampPool', () => canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }));
}

// --- Całość ------------------------------------------------------------------------------------------------

/**
 * Buduje ulicę wokół sklepu. Rekwizyty z modeli (drzewa, latarnie, dostawczak) to nazwane grupy `prop:<rodzaj>:<i>`
 * ustawione z seeda; model dochodzi, gdy `load` go zwróci. Gdy wczytanie się nie uda, grupa zostaje pusta,
 * a ulica loguje jedno ostrzeżenie. Losowość: wyłącznie `createRng(subSeed(seed, 'street'))` i jego strumienie pochodne.
 */
export async function buildStreet(layout: StoreLayout, seed: string, load: (url: string) => Promise<GLTF> = loadGLB): Promise<StreetView> {
  const street = subSeed(seed, 'street');
  const o = storeOuter(layout);
  const corner = cornerSide(layout);
  const plan = planRow(layout, seed);
  const ownMin = Math.min(...plan.own.map((v) => v.x0));
  const ownMax = Math.max(...plan.own.map((v) => v.x1));
  const zr0 = o.zs - CURB_W;
  let side: [number, number] | null = null;
  if (corner === 'minX') { const xb = o.x0 - SIDE_STREET.sidewalk; side = [xb - SIDE_STREET.road, xb]; }
  if (corner === 'maxX') { const xa = o.x1 + SIDE_STREET.sidewalk; side = [xa, xa + SIDE_STREET.road]; }
  const lay: Layout = { o, corner, side, zr0, zr1: zr0 - ROAD_W, gridX: (i) => (i - layout.width / 2) * PLATE };

  // przejście dla pieszych: po jednej ze stron sklepu, za sąsiednim budynkiem lub przecznicą
  const crossingRng = createRng(subSeed(street, 'zebra'));
  const crossing = crossingRng.chance(0.5)
    ? Math.min(ownMin, side ? side[0] - SIDE_STREET.sidewalk : ownMin) - crossingRng.range(3, 6)
    : Math.max(ownMax, side ? side[1] + SIDE_STREET.sidewalk : ownMax) + crossingRng.range(3, 6);

  const owned: BufferGeometry[] = [];
  const materials: Material[] = [];
  const root = new Group();
  root.name = 'street';

  // podłoże: chodnik z płyt, jezdnia, reszta (krawężniki, podłoże, donice drzew)
  const ground: Ground = { plates: new GeomBuilder([0.5, 0.5]), road: new GeomBuilder([0.5, 0.5]), flat: new GeomBuilder([0.5, 0.5]) };
  buildGround(ground, lay, createRng(subSeed(street, 'podłoże')), crossing);
  // podwórko za wierszem budynków (trawniki, trzepak, wiata śmietnikowa, drzewa, garaże), w siatce podłoża
  const rowMin = Math.min(...plan.own.map((v) => v.x0), ...plan.neighbours.map((v) => v.x0));
  const rowMax = Math.max(...plan.own.map((v) => v.x1), ...plan.neighbours.map((v) => v.x1));
  buildCourtyard(ground.flat, {
    x0: rowMin - 4, x1: rowMax + 4, z: o.z1,
    avoid: side ? [side[0] - SIDE_STREET.sidewalk, side[1] + SIDE_STREET.sidewalk] : null,
  }, createRng(subSeed(street, 'podwórko')));
  const props = placeProps(layout, createRng(subSeed(street, 'rekwizyty')), lay, [ownMin, ownMax], crossing);
  for (const t of props.trees) {
    ground.flat.rbox([t.x - 0.55, 0, t.z - 0.55], [t.x + 0.55, 0.08, t.z + 0.55], PALETTE.street.curb[1], 0.04, 2);
    ground.flat.rbox([t.x - 0.4, 0.07, t.z - 0.4], [t.x + 0.4, 0.1, t.z + 0.4], PALETTE.wall[4], 0.01, 1);
  }
  const surface = (name: string, builder: GeomBuilder, map: Texture | null, roughness: number, receive: boolean): Mesh => {
    const mat = new MeshStandardMaterial({ name: `street:${name}`, map, vertexColors: true, roughness, metalness: 0 });
    const geometry = builder.toGeometry();
    materials.push(mat);
    owned.push(geometry);
    const mesh = new Mesh(geometry, mat);
    mesh.name = `street:${name}`;
    mesh.receiveShadow = receive;
    return mesh;
  };
  const groundGroup = new Group();
  groundGroup.name = 'ground';
  groundGroup.add(
    surface('sidewalk', ground.plates, plateTexture(), 0.9, true),
    surface('road', ground.road, asphaltTexture(), 0.95, false),
    surface('curb', ground.flat, null, 0.85, true),
  );
  root.add(groundGroup);

  // poświata latarni: dwie dodatkowe plamy światła na chodniku i jezdni, widoczne tylko nocą
  const poolBuilder = new GeomBuilder([0.5, 0.5]);
  for (const l of props.lamps) poolBuilder.quad([l.x - 3.2, 0.03, l.z - 0.9 + 3.2], [l.x + 3.2, 0.03, l.z - 0.9 + 3.2], [l.x + 3.2, 0.03, l.z - 0.9 - 3.2], [l.x - 3.2, 0.03, l.z - 0.9 - 3.2], [0, 0, 1, 1], '#ffffff');
  const poolMaterial = new MeshBasicMaterial({
    name: 'street:lampPool', map: poolTexture(), color: new Color(LAMP_GLOW), transparent: true, opacity: 0.42, depthWrite: false, blending: AdditiveBlending,
  });
  materials.push(poolMaterial);
  const poolGeometry = poolBuilder.toGeometry();
  owned.push(poolGeometry);
  const pools = new Mesh(poolGeometry, poolMaterial);
  pools.name = 'lamp-pools';
  pools.userData.treatAsOpaque = true;   // plama światła leży na posadzce: AO pod nią ma zostać (patrz blobShadows.ts)
  pools.visible = false;
  root.add(pools);

  // budynki
  const buildings = buildBuildings(layout, seed, createFacadeAtlas(), plan);
  root.add(buildings.root);

  // rekwizyty: grupy z nazwą i pozycją z seeda, modele dochodzą po wczytaniu. Wszystkie dzielą jeden materiał z kolorami
  // wierzchołków z PALETTE (żarówki latarni mają własny, emissive)
  const propMaterial = new MeshStandardMaterial({ name: 'street:props', vertexColors: true, roughness: 0.6, metalness: 0.1 });
  materials.push(propMaterial);
  const specs: PropSpec[] = [];
  const treeRng = createRng(subSeed(street, 'drzewa'));
  const addProp = (kind: PropKind, i: number, p: Placement, url: string, height: number): void => {
    const group = new Group();
    group.name = `prop:${kind}:${i}`;
    group.position.set(p.x, 0, p.z);
    group.rotation.y = p.rotY;
    root.add(group);
    specs.push({ kind, group, url, height, leaves: treeRng.pick(LEAVES) });
  };
  props.lamps.forEach((p, i) => addProp('lamp', i, p, ASSETS.props.lamp, 4.5));
  // drzewa proceduralne (courtyard.ts), jak na podwórku: modele Kenneya obok krępych mebli wyglądały płasko (zadanie 16)
  props.trees.forEach((p, i) => {
    const group = new Group();
    group.name = `prop:tree:${i}`;
    group.position.set(p.x, 0, p.z);
    group.rotation.y = p.rotY;
    const builder = new GeomBuilder([0.5, 0.5]);
    buildTree(builder, 0, 0, treeRng.range(4.0, 5.4), treeRng);
    const geometry = builder.toGeometry();
    owned.push(geometry);
    const mesh = new Mesh(geometry, propMaterial);
    mesh.name = `prop:tree:${i}:mesh`;
    mesh.castShadow = mesh.receiveShadow = false;
    group.add(mesh);
    root.add(group);
  });
  addProp('van', 0, props.van, ASSETS.props.van, 2.2);

  // rekwizyty proceduralne w wierszu 0 (props.ts): ławka, kosz, potykacz z hasłem dnia, donica, stojak z gazetami
  const boardLines = BOARD_LINES[createRng(subSeed(street, 'potykacz')).int(0, BOARD_LINES.length)]!;
  const pylonTex = pylonTextures();
  const pylonFace = makeTextured('pylon', pylonTex.map, { roughness: 0.4, emissiveMap: pylonTex.glow, emissive: BRAND.cream, emissiveIntensity: PYLON_GLOW.day });
  materials.push(pylonFace);
  const procedural: [Group, Placement | null][] = [
    [buildBench(), props.bench], [buildBin(), props.bin], [buildSandwichBoard(boardLines), props.board],
    [buildPylon(pylonFace), props.pylon], [buildPlanter(), props.planter], [buildNewsStand(), props.newsstand],
  ];
  for (const [group, spot] of procedural) {
    if (!spot) continue;
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = spot.rotY;
    bake(group, propMaterial, owned);
    root.add(group);
  }

  const lampHeads: Mesh[] = [];
  let warned = false;
  await Promise.all(specs.map(async (spec) => {
    try {
      const gltf = await load(spec.url);
      const styled = restyleModel(spec.kind, gltf.scene.clone(true), spec.height, spec.leaves, propMaterial, owned);
      spec.group.add(styled.model);
      lampHeads.push(...styled.lampHeads);
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn(`Ulica: nie udało się wczytać modelu rekwizytu (${spec.url}); grupa ${spec.group.name} zostaje pusta.`, error);
      }
    }
  }));

  let disposed = false;
  return {
    root,
    setBuildingCutaway(on, yawIndex = 0) { buildings.setCutaway(on, yawIndex); },
    setTimeOfDay(t) {
      const night = t === 'night';
      buildings.setNight(night);
      pools.visible = night;
      for (const head of lampHeads) head.material = lampHeadMaterial(night);
      pylonFace.emissiveIntensity = night ? PYLON_GLOW.night : PYLON_GLOW.day;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      buildings.dispose();
      for (const g of owned) g.dispose();
      owned.length = 0;
      for (const m of materials) m.dispose();
    },
  };
}
