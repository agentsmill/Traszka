import {
  Box3, BufferGeometry, Color, DynamicDrawUsage, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3,
  type Material, type Object3D, type Raycaster,
} from 'three';
import { BLOCK_M } from '@/sim/city/districts';
import { SLOT_M, STREET_HALF_M } from '@/sim/city/generateCity';
import { CITY_SIZE, type CityLot, type CityState, type DistrictId, type LotState, type StreetSegment } from '@/sim/city/types';
import type { LotKind } from '@/sim/store/types';
import { PALETTE } from '@/render/style';

/**
 * Widok warstw miasta (spec §9.1, §19): płaska, jasna mapa, na której widać ruch i dzielnice. Bez cieni, aut i drzew; cała scena to
 * 2 siatki (tło kwartałów, ulice) i do 9 siatek z budynkami (chunk 2 × 2 kwartały), czyli kilkanaście wywołań rysowania zamiast
 * budżetu 60. Budynki to niskie, wybielone bryły postawione na slocie każdego lokalu; kolory (ruch, dzielnice, stan lokalu) siedzą w
 * kolorach wierzchołków, więc warstwy i stany zmieniają tylko bufor koloru, nigdy geometrię ani materiał. Materiał jest bez świateł
 * (`MeshBasicMaterial`, cieniowanie ścian wypieczone w kolorach): gra przełącza słońce i niebo wg godziny (noc 20:00–6:00), a mapa
 * danych ma wyglądać tak samo o każdej porze, żeby żółć i czerwień ruchu nie ciemniały ani nie niebieściały.
 *
 * Układ: jednostka sceny to `CITY_UNIT_M` metrów miasta, środek miasta leży w (0, 0), x miasta to x sceny, a y miasta to z sceny (jak
 * `cellToWorld` w sklepie). Korzeń stoi w początku układu i się nie przesuwa: `pickLot` liczy w tych samych współrzędnych co promień.
 * Pinezki to elementy HTML (`cityPins.ts`), ich kotwice daje `pinAnchors`. Scena nie importuje firmy: stany lokali dostaje gotowe.
 */

export type CityLayer = 'ruch' | 'dzielnice';

/** Jednostka sceny w metrach miasta: całe miasto (660 m) ma 22 jednostki, więc mieści się w `VIEW_SIZE_MAX` kamery na ekranie poziomym. */
export const CITY_UNIT_M = 30;
const CITY_M = CITY_SIZE * BLOCK_M;

/** Punkt miasta (metry) we współrzędnych sceny (y = 0). */
export function cityToWorld(mx: number, my: number): Vector3 {
  return new Vector3((mx - CITY_M / 2) / CITY_UNIT_M, 0, (my - CITY_M / 2) / CITY_UNIT_M);
}

/** Granice miasta na scenie razem z ulicami brzegowymi; kamera ogranicza do nich przesuwanie. */
export const CITY_BOUNDS: Readonly<{ minX: number; minZ: number; maxX: number; maxZ: number }> = (() => {
  const half = (CITY_M / 2 + STREET_HALF_M) / CITY_UNIT_M;
  return { minX: -half, minZ: -half, maxX: half, maxZ: half };
})();

/** Tło kwartału w warstwie „Dzielnice”. Legenda ekranu Miasta bierze kolory stąd. */
export const DISTRICT_COLOR: Readonly<Record<DistrictId, string>> = {
  osiedle: PALETTE.street.blokPastel[1]!,       // łososiowy
  srodmiescie: PALETTE.street.blokPastel[0]!,   // żółty
  dworzec: PALETTE.street.blokPastel[4]!,       // błękitny
  biurowce: PALETTE.street.blokPastel[3]!,      // liliowy
  park: PALETTE.street.grass[0]!,
};

const BLOCK_NEUTRAL = PALETTE.wall[3]!;          // tło kwartałów w „Ruchu”: ciepła szarość, żeby ulice były kolorowe
const PARK_RUCH = PALETTE.street.grass[0]!;
const STREET_NEUTRAL = PALETTE.street.curb[0]!;  // ulice w „Dzielnicach”: jasne, bez koloru ruchu
const BUILDING_WHITE = PALETTE.wall[0]!;
const TRAFFIC_QUIET = PALETTE.productCategory.przekaski[0]!;   // żółty
const TRAFFIC_BUSY = PALETTE.productCategory.napoje[0]!;       // czerwony
/** Średnia doba natężenia (0–255), od której odcinek jest cały czerwony. Skala stała jak w traffic.ts: najruchliwszy odcinek ma 70–100. */
const TRAFFIC_FULL = 100;
/**
 * Cieniowanie budynku wypieczone w kolorach (materiał jest bez świateł): dach i dwie pary ścian. W rzucie izometrycznym widać
 * zawsze po jednej ścianie ±z i ±x, więc przy każdym obrocie kamery dwie różnią się jasnością. Dach ma 0,88 bieli, żeby luminancja
 * zostawała poniżej progu bloomu (0,9 w post.ts) także przy ekspozycji nocy, a jasne sklepy nie zaczęły świecić.
 */
const SHADE = { roof: 0.88, wallZ: 0.88 * 0.88, wallX: 0.88 * 0.76 } as const;

/** Barwa budynku lokalu wg stanu (mieszana z bielą budynku): kolory pinezek, żeby mapa czytała się też bez nich. */
function lotTint(state: LotState, brand: CityLot['brand']): { color: string; amount: number } | null {
  switch (state) {
    case 'twoj': return { color: PALETTE.brand.green, amount: 0.6 };
    case 'konkurencja': return { color: brand === 'kawka' ? PALETTE.clothes[6]! : PALETTE.brand.orange, amount: 0.55 };
    case 'wolny': return { color: PALETTE.productCategory.przekaski[0]!, amount: 0.4 };
    case 'budowa': return { color: PALETTE.brand.orange, amount: 0.35 };
    case 'po-traszce': return { color: PALETTE.floor[3]!, amount: 0.5 };
    case 'obok': return { color: PALETTE.brand.green, amount: 0.2 };
    case 'zajety': return null;
  }
}

/** Rzut budynku na lokal (m): szerokość w slocie, głębokość od pierzei w głąb kwartału. */
const FOOTPRINT_M: Record<LotKind, { w: number; d: number }> = {
  blok: { w: SLOT_M - 2, d: 30 },
  kamienica: { w: SLOT_M - 2, d: 26 },
  pawilon: { w: SLOT_M - 4, d: 16 },
};
/** Wysokość w jednostkach sceny wg dzielnicy (niskie, płaskie bryły); lokal dostaje ±15% wg numeru. */
const HEIGHT: Record<CityLot['district'], number> = { osiedle: 0.3, srodmiescie: 0.36, dworzec: 0.14, biurowce: 0.5 };
/** Kotwica pinezki leży tyle nad dachem. */
const ANCHOR_LIFT = 0.04;

const CHUNK_BLOCKS = 2;
const CHUNKS_PER_SIDE = Math.ceil(CITY_SIZE / CHUNK_BLOCKS);
const VERTS_PER_BOX = 20;   // dach i cztery ściany, bez spodu

/** Deterministyczna liczba z [0, 1) z numeru lokalu: wysokość i jasność budynku (render nie losuje). */
const unit = (id: number): number => (Math.imul(id + 1, 2654435761) >>> 0) / 4294967296;

export interface CityView {
  root: Group;
  /** „Ruch”: ulice w kolorze natężenia, tło kwartałów neutralne; „Dzielnice”: tło w kolorze dzielnicy, ulice jasne. */
  setLayer(layer: CityLayer): void;
  /** Stany lokali w grze: barwią budynki i wyznaczają, które lokale mają kotwicę pinezki (wszystkie poza zwykłym `zajety`). Brak wpisu to stan z generatora. */
  setLots(states: Record<number, LotState>): void;
  /** Punkty nad dachami lokali z pinezką, we współrzędnych sceny. */
  pinAnchors(): { lotId: number; world: Vector3 }[];
  /** Lokal pod promieniem (najbliższy trafiony) albo null. */
  pickLot(ray: Raycaster): number | null;
  dispose(): void;
}

/** Kolory dachu i dwóch par ścian jednej bryły. */
interface Shades { roof: Color; wallZ: Color; wallX: Color }

/** Dach i ściany bryły z koloru bazowego budynku. */
const shadesOf = (base: Color): Shades => ({
  roof: base.clone().multiplyScalar(SHADE.roof),
  wallZ: base.clone().multiplyScalar(SHADE.wallZ),
  wallX: base.clone().multiplyScalar(SHADE.wallX),
});

// --- Budowa siatek ------------------------------------------------------------------------------------------------

/** Rosnące bufory pozycji, normalnych, kolorów i indeksów jednej siatki. */
class Mesher {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];

  get vertices(): number { return this.positions.length / 3; }

  /** Czworokąt z czterech wierzchołków w kolejności przeciwnej do ruchu wskazówek patrząc z zewnątrz (zwrot `n`). */
  quad(p: readonly [number, number, number][], n: readonly [number, number, number], c: Color): void {
    const base = this.vertices;
    for (const [x, y, z] of p) {
      this.positions.push(x, y, z);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(c.r, c.g, c.b);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Prostopadłościan bez spodu: najpierw dach (cztery wierzchołki), potem ściany. */
  box(x0: number, x1: number, z0: number, z1: number, h: number, c: Shades): void {
    this.quad([[x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0]], [0, 1, 0], c.roof);
    this.quad([[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]], [0, 0, 1], c.wallZ);
    this.quad([[x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0]], [0, 0, -1], c.wallZ);
    this.quad([[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1]], [1, 0, 0], c.wallX);
    this.quad([[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]], [-1, 0, 0], c.wallX);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Płaski prostokąt na ziemi (metry miasta) w kolorze `c`. */
function flat(m: Mesher, x0: number, y0: number, x1: number, y1: number, c: Color): void {
  const a = cityToWorld(x0, y0);
  const b = cityToWorld(x1, y1);
  m.quad([[a.x, 0, a.z], [a.x, 0, b.z], [b.x, 0, b.z], [b.x, 0, a.z]], [0, 1, 0], c);
}

/**
 * Prostokąt ulicy w metrach miasta. Odcinki poziome biegną przez całe skrzyżowania (na brzegu miasta o pół ulicy dalej), pionowe kończą
 * się przy skrzyżowaniach, więc prostokąty niczego nie pokrywają dwa razy (bez migotania) i nie zostawiają dziur.
 */
function streetRect(s: StreetSegment): [number, number, number, number] {
  if (s.ay === s.by) return [s.ax === 0 ? -STREET_HALF_M : s.ax, s.ay - STREET_HALF_M, s.bx === CITY_M ? CITY_M + STREET_HALF_M : s.bx, s.ay + STREET_HALF_M];
  return [s.ax - STREET_HALF_M, s.ay + STREET_HALF_M, s.ax + STREET_HALF_M, s.by - STREET_HALF_M];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const meanOf = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Kolor odcinka wg średniej doby `hourly`: od żółtego (cicho) do czerwonego (tłoczno), stała skala `TRAFFIC_FULL`. */
function trafficColor(hourly: readonly number[]): Color {
  return new Color(TRAFFIC_QUIET).lerp(new Color(TRAFFIC_BUSY), clamp01(meanOf(hourly) / TRAFFIC_FULL));
}

interface LotBox {
  lot: CityLot;
  box: Box3;
  /** Środek dachu. */
  top: Vector3;
  chunk: number;
  /** Pierwszy wierzchołek bryły w siatce chunku. */
  first: number;
  /** Biel budynku z odrobiną zmienności. */
  base: Color;
}

export function buildCity(city: CityState, states: Record<number, LotState>): CityView {
  const root = new Group();
  root.name = 'city';
  const surface = new MeshBasicMaterial({ vertexColors: true });   // bez świateł: dane na mapie wyglądają tak samo o każdej porze doby
  const geometries: BufferGeometry[] = [];
  const add = (name: string, g: BufferGeometry): Mesh => {
    geometries.push(g);
    const mesh = new Mesh(g, surface);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    root.add(mesh);
    return mesh;
  };

  // tło kwartałów: jeden czworokąt na kwartał, między ulicami
  const colorsOf = (build: (i: number) => Color, count: number): Float32Array => {
    const out = new Float32Array(count * 12);
    for (let i = 0; i < count; i++) for (let k = 0; k < 4; k++) build(i).toArray(out, (i * 4 + k) * 3);
    return out;
  };
  const blocks = new Mesher();
  city.blocks.forEach((_, i) => {
    const bx = i % CITY_SIZE;
    const by = Math.floor(i / CITY_SIZE);
    flat(blocks, bx * BLOCK_M + STREET_HALF_M, by * BLOCK_M + STREET_HALF_M, (bx + 1) * BLOCK_M - STREET_HALF_M, (by + 1) * BLOCK_M - STREET_HALF_M, new Color());
  });
  const blockMesh = add('blocks', blocks.geometry());
  const blockColors: Record<CityLayer, Float32Array> = {
    ruch: colorsOf((i) => new Color(city.blocks[i] === 'park' ? PARK_RUCH : BLOCK_NEUTRAL), city.blocks.length),
    dzielnice: colorsOf((i) => new Color(DISTRICT_COLOR[city.blocks[i]!]), city.blocks.length),
  };

  // ulice: jeden czworokąt na odcinek, w kolejności `city.streets` (cztery wierzchołki na odcinek)
  const streets = new Mesher();
  for (const s of city.streets) {
    const [x0, y0, x1, y1] = streetRect(s);
    flat(streets, x0, y0, x1, y1, new Color());
  }
  const streetMesh = add('streets', streets.geometry());
  const streetColors: Record<CityLayer, Float32Array> = {
    ruch: colorsOf((i) => trafficColor(city.streets[i]!.hourly), city.streets.length),
    dzielnice: colorsOf(() => new Color(STREET_NEUTRAL), city.streets.length),
  };

  // budynki: bryła na slocie każdego lokalu, sklejone w jedną geometrię na chunk 2 × 2 kwartały
  const meshers = new Map<number, Mesher>();
  const boxes: LotBox[] = [];
  for (const lot of city.lots) {
    const chunk = Math.floor(lot.by / CHUNK_BLOCKS) * CHUNKS_PER_SIDE + Math.floor(lot.bx / CHUNK_BLOCKS);
    let mesher = meshers.get(chunk);
    if (!mesher) { mesher = new Mesher(); meshers.set(chunk, mesher); }
    const fp = FOOTPRINT_M[lot.spec.kind];
    const north = lot.y - lot.by * BLOCK_M < BLOCK_M / 2;   // pierzeja północna: budynek rośnie na południe od ulicy
    const a = cityToWorld(lot.x - fp.w / 2, north ? lot.y : lot.y - fp.d);
    const b = cityToWorld(lot.x + fp.w / 2, north ? lot.y + fp.d : lot.y);
    const h = HEIGHT[lot.district] * (0.85 + 0.3 * unit(lot.id));
    const base = new Color(BUILDING_WHITE).multiplyScalar(0.95 + 0.05 * unit(lot.id + 7919));
    const first = mesher.vertices;
    mesher.box(a.x, b.x, a.z, b.z, h, shadesOf(base));
    boxes.push({ lot, box: new Box3(new Vector3(a.x, 0, a.z), new Vector3(b.x, h, b.z)), top: new Vector3((a.x + b.x) / 2, h, (a.z + b.z) / 2), chunk, first, base });
  }
  const chunkMeshes = new Map<number, Mesh>();
  for (const [chunk, mesher] of [...meshers].sort((p, q) => p[0] - q[0])) chunkMeshes.set(chunk, add(`chunk:${chunk}`, mesher.geometry()));

  // --- stan ---------------------------------------------------------------------------------------------------------

  let current: Record<number, LotState> = states;
  let layer: CityLayer = 'ruch';
  let disposed = false;
  const stateOf = (l: CityLot): LotState => current[l.id] ?? l.state;

  const paintLot = (rec: LotBox): void => {
    const tint = lotTint(stateOf(rec.lot), rec.lot.brand);
    const shades = shadesOf(tint ? rec.base.clone().lerp(new Color(tint.color), tint.amount) : rec.base);
    const attr = chunkMeshes.get(rec.chunk)!.geometry.getAttribute('color');
    for (let v = 0; v < VERTS_PER_BOX; v++) {
      const c = v < 4 ? shades.roof : v < 12 ? shades.wallZ : shades.wallX;   // kolejność ścian jak w `Mesher.box`
      attr.setXYZ(rec.first + v, c.r, c.g, c.b);
    }
  };
  const paintAll = (): void => {
    for (const rec of boxes) paintLot(rec);
    for (const m of chunkMeshes.values()) m.geometry.getAttribute('color').needsUpdate = true;
  };
  const paintGround = (): void => {
    blockMesh.geometry.getAttribute('color').array.set(blockColors[layer]);
    blockMesh.geometry.getAttribute('color').needsUpdate = true;
    streetMesh.geometry.getAttribute('color').array.set(streetColors[layer]);
    streetMesh.geometry.getAttribute('color').needsUpdate = true;
  };
  paintGround();
  paintAll();

  return {
    root,
    setLayer(next) {
      layer = next;
      paintGround();
    },
    setLots(next) {
      current = next;
      paintAll();
    },
    pinAnchors() {
      return boxes
        .filter((r) => stateOf(r.lot) !== 'zajety')
        .map((r) => ({ lotId: r.lot.id, world: r.top.clone().setY(r.top.y + ANCHOR_LIFT) }));
    },
    pickLot(ray) {
      const hit = new Vector3();
      let best: number | null = null;
      let bestAt = Infinity;
      for (const r of boxes) {
        if (!ray.ray.intersectBox(r.box, hit)) continue;
        const d = hit.distanceTo(ray.ray.origin);
        if (d < ray.near || d > ray.far || d >= bestAt) continue;
        best = r.lot.id;
        bestAt = d;
      }
      return best;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const g of geometries) g.dispose();
      surface.dispose();
    },
  };
}

/** Obiekt sceny, który renderer może narysować (siatka, linia, punkty, sprite). */
type Drawable = Object3D & {
  material?: Material | Material[]; geometry?: BufferGeometry;
  isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean;
};

/**
 * Liczba wywołań rysowania, które renderer wykona dla `root`: widoczna siatka (linia, punkty, sprite) to jedno, siatka z tablicą
 * materiałów to jedno na grupę, ukryta gałąź to zero. Budżet widoku miasta to poniżej 60.
 */
export function countDrawCalls(root: Object3D): number {
  if (!root.visible) return 0;
  let n = 0;
  const o = root as Drawable;
  if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
    const material = o.material;
    if (Array.isArray(material)) n += (o.geometry?.groups ?? []).filter((g) => material[g.materialIndex ?? 0]?.visible).length;
    else if (material?.visible !== false) n += 1;
  }
  for (const child of root.children) n += countDrawCalls(child);
  return n;
}
