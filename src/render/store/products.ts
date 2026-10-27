import {
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Quaternion,
  Shape,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, subSeed, type Rng } from '@/sim/rng';
import { PALETTE } from '@/render/style';
import type { ShelfSlot, StoreView } from './buildStore';
import { gloss, matte, type Category } from './parts';

/**
 * Towar na półkach: sześć kształtów (pudełko, butelka, puszka, torebka, karton, słoik), każdy jako jeden `InstancedMesh`
 * z kolorem per instancja (`setColorAt` na białej bazie materiału). Na jedną półkę (`ShelfSlot`) idzie towar z jej
 * kategorii (RULING R24): seed miesza tylko kształty, odcień z `PALETTE.productCategory[kategoria]` i drobne przesunięcia.
 *
 * Geometrie są wspólne w całym procesie (jak w parts.ts): nie zmieniaj ich i nie zwalniaj. Bufory instancji zwalnia
 * `StoreView.dispose()` (przechodzi po `root` i woła `dispose()` na każdym `InstancedMesh`).
 */

type ShapeId = 'box' | 'bottle' | 'can' | 'bag' | 'carton' | 'jar';

interface ShapeSpec {
  id: ShapeId;
  /** Wymiary nominalne (m): szerokość wzdłuż półki, głębokość, wysokość. Początek bryły: środek podstawy. */
  w: number;
  d: number;
  h: number;
  geometry(): BufferGeometry;
  material(): Material;
}

// --- Geometrie ---------------------------------------------------------------------------------------

/** Faza drobiazgu < 5 cm w co najmniej jednym wymiarze: 1 segment (docs/style-guide.md §1), czyli 108 trójkątów na bryłę. */
function softBox(w: number, h: number, d: number, radius = 0.012): BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, 0.4 * Math.min(w, h, d)));
  g.translate(0, h / 2, 0);
  return g;
}

/** Bryła obrotowa z profilu [promień, wysokość] od dołu do góry. */
function lathe(profile: ReadonlyArray<readonly [number, number]>, segments = 8): BufferGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);
}

const nonIndexed = (g: BufferGeometry): BufferGeometry => (g.index ? g.toNonIndexed() : g);

/** Karton po mleku: korpus 7×7 cm i dach dwuspadowy z płetwą. */
function cartonGeometry(): BufferGeometry {
  const body = nonIndexed(softBox(0.07, 0.165, 0.07, 0.008));
  const roofShape = new Shape();
  roofShape.moveTo(-0.035, 0);
  roofShape.lineTo(0.035, 0);
  roofShape.lineTo(0.013, 0.04);
  roofShape.lineTo(-0.013, 0.04);
  roofShape.closePath();
  const roof = new ExtrudeGeometry(roofShape, { depth: 0.07, bevelEnabled: false });
  roof.translate(0, 0.165, -0.035);
  roof.rotateY(Math.PI / 2); // kalenica wzdłuż półki, spadki do klienta i do tyłu
  const merged = mergeGeometries([body, nonIndexed(roof)]);
  body.dispose();
  roof.dispose();
  return merged;
}

/** Torebka (chipsy, pieczywo): płaska poduszka z karbowanym zgrzewem u góry. */
function bagGeometry(): BufferGeometry {
  const g = lathe([[0, 0], [0.042, 0], [0.055, 0.014], [0.058, 0.07], [0.054, 0.13], [0.04, 0.152], [0.052, 0.158], [0.052, 0.17], [0, 0.17]]);
  g.scale(1, 1, 0.42);
  return g;
}

const SHAPES: Record<ShapeId, ShapeSpec> = {
  box: { id: 'box', w: 0.1, d: 0.055, h: 0.15, geometry: () => softBox(0.1, 0.15, 0.055), material: () => matte('#ffffff') },
  bottle: {
    id: 'bottle', w: 0.072, d: 0.072, h: 0.235, material: () => gloss('#ffffff'),
    geometry: () => lathe([[0, 0], [0.03, 0], [0.036, 0.008], [0.036, 0.13], [0.03, 0.17], [0.016, 0.19], [0.015, 0.212], [0.02, 0.216], [0.02, 0.235], [0, 0.235]]),
  },
  can: {
    id: 'can', w: 0.068, d: 0.068, h: 0.12, material: () => gloss('#ffffff'),
    geometry: () => lathe([[0, 0], [0.029, 0], [0.034, 0.006], [0.034, 0.108], [0.03, 0.114], [0.028, 0.12], [0, 0.12]]),
  },
  bag: { id: 'bag', w: 0.116, d: 0.05, h: 0.17, geometry: bagGeometry, material: () => gloss('#ffffff') },
  carton: { id: 'carton', w: 0.07, d: 0.07, h: 0.205, geometry: cartonGeometry, material: () => matte('#ffffff') },
  jar: {
    id: 'jar', w: 0.082, d: 0.082, h: 0.096, material: () => gloss('#ffffff'),
    geometry: () => lathe([[0, 0], [0.034, 0], [0.041, 0.008], [0.041, 0.064], [0.036, 0.07], [0.04, 0.073], [0.04, 0.092], [0.035, 0.096], [0, 0.096]]),
  },
};
const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];

const geometryCache = new Map<ShapeId, BufferGeometry>();
const geometryOf = (id: ShapeId): BufferGeometry => {
  let g = geometryCache.get(id);
  if (!g) { g = SHAPES[id].geometry(); g.computeBoundingBox(); geometryCache.set(id, g); }
  return g;
};

// --- Mieszanki kształtów --------------------------------------------------------------------------------

type Mix = ReadonlyArray<readonly [ShapeId, number]>;

/** Wagi kształtów per kategoria (gondole i regały ścienne). */
const MIX: Record<Category, Mix> = {
  napoje: [['bottle', 4], ['can', 4], ['carton', 1], ['box', 1]],
  nabial: [['carton', 4], ['jar', 3], ['bottle', 2], ['box', 1]],
  slodycze: [['box', 4], ['bag', 3], ['jar', 2], ['can', 1]],
  przekaski: [['bag', 5], ['box', 3], ['can', 2]],
  pieczywo: [['bag', 5], ['box', 3], ['jar', 1]],
  chemia: [['bottle', 4], ['box', 3], ['jar', 2], ['can', 2]],
  alkohol: [['bottle', 6], ['box', 2], ['can', 2]],
};
/** Lodówki: butelki i kartony (mleczne: głównie kartony). */
const FRIDGE_MIX: Mix = [['bottle', 5], ['carton', 3]];
const FRIDGE_MIX_DAIRY: Mix = [['carton', 5], ['bottle', 3]];

function pickWeighted(rng: Rng, mix: Mix): ShapeId {
  const total = mix.reduce((n, [, w]) => n + w, 0);
  let r = rng.next() * total;
  for (const [id, w] of mix) { r -= w; if (r < 0) return id; }
  return mix[mix.length - 1]![0];
}

// --- Układ na półce ---------------------------------------------------------------------------------------

/** Odstęp od tyłu półki: słupki gondoli i regału (do 11 cm od ściany tylnej) i nadstawka gondoli. */
const BACK_INSET = 0.07;
const FRONT_INSET = 0.015;
const SIDE_INSET = 0.012;
/** Zapas na grubość półki wyżej (4 cm) w górę od wierzchu półki niżej. */
const SHELF_ABOVE_M = 0.045;
const GAP = 0.006;
/** Najmniejszy możliwy rozstaw (m): węższa resztka półki zostaje pusta. */
const MIN_PITCH = 0.07;
/** Ile rzędów w głąb: najwyższy poziom widać z góry, więc wypełniamy go głębiej niż niższe. */
const ROWS_TOP = 2;
const ROWS_LOWER = 1;
/** Produkt to seria 2–5 sąsiednich „facingów” tego samego kształtu i koloru, jak na prawdziwej półce. */
const RUN = [2, 6] as const;

interface Product {
  shape: ShapeSpec;
  color: Color;
  /** Skale osi (x wzdłuż półki, y w górę, z w głąb). */
  sx: number;
  sy: number;
  sz: number;
}

interface Placement { matrix: Matrix4; color: Color }

type FixtureKindName = string;

function mixFor(kind: FixtureKindName | undefined, category: Category): Mix {
  if (kind === 'fridge') return category === 'nabial' ? FRIDGE_MIX_DAIRY : FRIDGE_MIX;
  return MIX[category];
}

/**
 * Wypełnia towarem wszystkie `view.shelfSlots` i zwraca grupę z `InstancedMesh` na kształt. Grupę dodaj do `view.root`
 * (wtedy `view.dispose()` zwolni bufory instancji). Losowość: `createRng(subSeed(seed, 'products'))`, więc ten sam seed
 * i ten sam sklep dają identyczny układ.
 */
export function fillShelves(view: StoreView, seed: string): Group {
  const rng = createRng(subSeed(seed, 'products'));

  const kinds = new Map<string, FixtureKindName>();
  view.root.traverse((o) => {
    const { fixtureId, kind } = o.userData as { fixtureId?: unknown; kind?: unknown };
    if (typeof fixtureId === 'string' && typeof kind === 'string') kinds.set(fixtureId, kind);
  });

  const placements = new Map<ShapeId, Placement[]>(SHAPE_IDS.map((id) => [id, []]));
  for (const slot of view.shelfSlots) {
    fillSlot(slot, mixFor(kinds.get(slot.fixtureId), slot.category), kinds.get(slot.fixtureId) === 'fridge', rng, placements);
  }

  const group = new Group();
  group.name = 'goods';
  for (const id of SHAPE_IDS) {
    const list = placements.get(id)!;
    if (list.length === 0) continue;
    const mesh = new InstancedMesh(geometryOf(id), SHAPES[id].material(), list.length);
    mesh.name = id;
    // draw calls: towar nie rzuca cienia (kilka kształtów więcej w przejściu cienia to kilka draw calls więcej), ale go odbiera
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    list.forEach((p, i) => { mesh.setMatrixAt(i, p.matrix); mesh.setColorAt(i, p.color); });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

const POS = new Vector3();
const QUAT = new Quaternion();
const SCALE = new Vector3();
const AXIS_Y = new Vector3(0, 1, 0);

function fillSlot(slot: ShelfSlot, mix: Mix, fridge: boolean, rng: Rng, out: Map<ShapeId, Placement[]>): void {
  const [px, py, pz] = slot.position;
  const cos = Math.cos(slot.rotationY);
  const sin = Math.sin(slot.rotationY);
  const palette = PALETTE.productCategory[slot.category];
  const maxHeight = slot.levelStep - SHELF_ABOVE_M;
  const half = slot.width / 2 - SIDE_INSET;
  const depthUsable = slot.depth - BACK_INSET - FRONT_INSET;
  const frontZ = slot.depth / 2 - FRONT_INSET;
  let lastColor = -1;

  for (let level = 0; level < slot.levels; level++) {
    const y = py + level * slot.levelStep;
    const maxRows = level === slot.levels - 1 ? ROWS_TOP : ROWS_LOWER;
    let cursor = -half;
    let misses = 0;

    while (cursor < half - MIN_PITCH && misses < 4) {
      // nowy produkt: kształt, kolor (inny niż poprzedni), skala
      const shape = SHAPES[pickWeighted(rng, mix)];
      let ci = rng.int(0, palette.length);
      if (ci === lastColor) ci = (ci + 1 + rng.int(0, palette.length - 1)) % palette.length;
      lastColor = ci;
      const base = new Color(palette[ci]!);
      const headroom = maxHeight / shape.h;
      const product: Product = {
        shape,
        color: base,
        sx: rng.range(0.94, 1.1),
        sy: Math.min(headroom, rng.range(0.85, 1.12) * (fridge ? 1.18 : 1)),
        sz: rng.range(0.94, 1.1),
      };
      const pitch = shape.w * product.sx + GAP;
      const depthPitch = shape.d * product.sz + GAP;
      const rows = Math.max(1, Math.min(maxRows, Math.floor(depthUsable / depthPitch)));
      const run = rng.int(RUN[0], RUN[1]);
      // nie mieści się w resztce półki: próbujemy mniejszy produkt, a po kilku porażkach kończymy poziom
      if (cursor + pitch > half) { misses++; continue; }

      for (let n = 0; n < run && cursor + pitch <= half; n++) {
        const lx = cursor + pitch / 2;
        cursor += pitch;
        for (let r = 0; r < rows; r++) {
          const lz = frontZ - shape.d * product.sz / 2 - r * depthPitch;
          const jx = lx + rng.range(-0.004, 0.004);
          const jz = lz + rng.range(-0.004, 0.004);
          const yaw = slot.rotationY + rng.range(-0.1, 0.1);
          POS.set(px + jx * cos + jz * sin, y, pz - jx * sin + jz * cos);
          QUAT.setFromAxisAngle(AXIS_Y, yaw);
          const sy = Math.min(headroom, product.sy * rng.range(0.97, 1.03));
          SCALE.set(product.sx * rng.range(0.98, 1.02), sy, product.sz * rng.range(0.98, 1.02));
          out.get(shape.id)!.push({
            matrix: new Matrix4().compose(POS, QUAT, SCALE),
            color: base.clone().multiplyScalar(rng.range(0.93, 1)),
          });
        }
      }
    }
  }
}
