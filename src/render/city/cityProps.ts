import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DynamicDrawUsage, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh,
  Matrix4, MeshStandardMaterial, Quaternion, Vector3,
  type Material, type Object3D,
} from 'three';
import { BLOCK_M } from '@/sim/city/districts';
import { STREET_HALF_M } from '@/sim/city/generateCity';
import { streetIntensity } from '@/sim/city/traffic';
import { CITY_SIZE, type CityState, type StreetSegment } from '@/sim/city/types';
import { PALETTE } from '@/render/style';
import type { CityLayer } from './buildCity';
import type { BuildingPlan } from './cityBuildings';
import { CITY_M, CITY_UNIT_M, cityToWorld, hash01, streetRect } from './cityCoords';

/**
 * Rekwizyty makiety (spec §7.1, §19): drzewa i auta, każde jedną `InstancedMesh` (jedno wywołanie rysowania na cały rodzaj), widoczne tylko
 * w makiecie. Nic nie jest losowane: położenie, wielkość i barwa drzew oraz fazy i barwy aut biorą się ze skrótu (`hash01`), więc ten sam
 * seed daje to samo co do bitu.
 *
 * - Drzewa (`TREES_MAX`): pień i korona (dwie bryły) w jednej geometrii z kolorami wierzchołków. Stoją na siatce co ok. 12 m w kwartałach
 *   parku i co ok. 20 m na podwórkach (wnętrza kwartałów poza obrysami budynków z `planCityBuildings`), w jednym kroku zawsze z
 *   zapasem na koronę od ulic i ścian. Gdy kandydatów jest więcej niż limit, park zostaje w całości, a podwórka są przerzedzane
 *   deterministycznym rankingiem skrótu.
 * - Auta (`CARS_MAX`): nadwozie z kabiną i kołami w jednej geometrii, barwa instancji z `PALETTE.clothes`. Jadą prawym pasem prostokąta
 *   ulicy (`streetRect`) z prędkością ok. `CAR_SPEED_MPS`, każdy w swojej stronie, i zawijają się na końcu odcinka. Ile ich jest na
 *   odcinku, wynika z natężenia `streetIntensity` w godzinie gry (dzień roboczy albo weekend): stała skala miasta (najruchliwsza godzina
 *   całego tygodnia to dokładnie `CARS_MAX`), więc noc jest pusta, a szczyt pełen. Położenie auta to czysta funkcja czasu obiegu
 *   (odcinek, numer auta, strona, czas), bez stanu: auta jednego pasa mają fazy po złotym podziale i trzymają odstęp, a zmiana godziny
 *   tylko dodaje albo zdejmuje auta z końca listy odcinka.
 */

export const TREES_MAX = 400;
export const CARS_MAX = 80;

// --- Drzewa (metry) -------------------------------------------------------------------------------------------

/** Odstęp drzew w parku i na podwórkach (m), zapas od brzegu kwartału (ulicy) i od ścian budynków (korona ma do ok. 2,5 m promienia). */
const PARK_PITCH_M = 12;
const YARD_PITCH_M = 20;
const EDGE_M = 3;
const WALL_M = 3;
/** Rozrzut położenia wokół węzła siatki (m, w każdej osi); siatka jest o tyle cofnięta od brzegu, więc drzewo nie wyjdzie poza zapas. */
const PARK_JITTER_M = 1.5;
const YARD_JITTER_M = 3;
/** Skala drzewa (wzrost) od najmniejszego do największego. */
const TREE_SCALE_MIN = 0.8;
export const TREE_SCALE_MAX = 1.4;
const TREE = {
  trunk: { r0: 0.35, r1: 0.25, h: 2.4 },
  crowns: [{ r: 2.4, y: 3.9, shade: 0.78 }, { r: 1.7, y: 5.6, shade: 1 }],
} as const;

// --- Auta (metry) ---------------------------------------------------------------------------------------------

/** Prędkość aut (m/s), wymiary (m) i odsunięcie środka pasa od osi ulicy (m): pół ulicy to `STREET_HALF_M`, a pas ma jej połowę. */
export const CAR_SPEED_MPS = 8;
export const CAR_LENGTH_M = 4.2;
export const CAR_WIDTH_M = 1.8;
export const LANE_OFFSET_M = STREET_HALF_M / 2;
/** Najwięcej aut na odcinku (po tyle samo w obie strony: po złotym podziale trzymają odstęp). */
const CARS_PER_SEGMENT_MAX = 6;
const PHI = 0.6180339887498949;
const CAR = {
  body: { l: CAR_LENGTH_M, h: 0.75, w: CAR_WIDTH_M, y: 0.3 },
  cabin: { l: 2.1, h: 0.62, w: 1.62, y: 1.05, x: -0.25 },
  wheel: { d: 0.7, w: 0.3, x: 1.35 },
} as const;

export interface CityProps {
  /** Grupa z siatkami `trees` i (przy `cars`) `cars`. */
  root: Group;
  /**
   * Krok aut o `dtSec` sekund w godzinie gry `hour` (liczba, część ułamkowa jest ignorowana) w dniu roboczym albo weekend. Poza makietą
   * i bez aut nic nie robi.
   */
  tick(dtSec: number, hour: number, weekend: boolean): void;
  /** Tryb mapy: drzewa i auta widać tylko w „Makiecie”. */
  setLayer(layer: CityLayer): void;
  /** Drzewa rzucają cień (tylko w makiecie); auta nigdy. */
  setShadows(on: boolean): void;
  /** Widoczne drzewa i auta (0 poza makietą). */
  stats(): { trees: number; cars: number };
  dispose(): void;
}

/** Obiekt, który renderer może narysować (siatka, linia, punkty, sprite). */
type Drawable = Object3D & {
  material?: Material | Material[]; geometry?: BufferGeometry;
  isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean;
};

/** Wywołania rysowania jednego obiektu (bez dzieci): siatka, linia, punkty, sprite to jedno, siatka z tablicą materiałów jedno na widoczną grupę. */
export function drawsOf(o: Object3D): number {
  const d = o as Drawable;
  if (!(d.isMesh || d.isLine || d.isPoints || d.isSprite)) return 0;
  const material = d.material;
  if (Array.isArray(material)) return (d.geometry?.groups ?? []).filter((g) => material[g.materialIndex ?? 0]?.visible).length;
  return material?.visible !== false ? 1 : 0;
}

/**
 * Ile siatek rzuca cień w przebiegu cienia (jedno wywołanie rysowania na siatkę i grupę materiału, jak `drawsOf`): widoczne siatki z
 * `castShadow`; ukryta gałąź to zero. Budżet widoku miasta: wywołania rysowania + rzucające cień poniżej 150 w makiecie.
 */
export function countShadowCasters(root: Object3D): number {
  if (!root.visible) return 0;
  let n = root.castShadow ? drawsOf(root) : 0;
  for (const child of root.children) n += countShadowCasters(child);
  return n;
}

// --- Geometria -------------------------------------------------------------------------------------------------

/** Skleja bryły w jedną geometrię bez indeksu: pozycje, normalne i kolor wierzchołków (barwa bryły), w jednostkach sceny. */
function mergeColored(parts: readonly { geometry: BufferGeometry; color: Color }[]): BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const color: number[] = [];
  for (const part of parts) {
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      position.push(p.getX(i) / CITY_UNIT_M, p.getY(i) / CITY_UNIT_M, p.getZ(i) / CITY_UNIT_M);
      normal.push(n.getX(i), n.getY(i), n.getZ(i));
      color.push(part.color.r, part.color.g, part.color.b);
    }
    if (g !== part.geometry) g.dispose();
    part.geometry.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(position, 3));
  out.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  out.setAttribute('color', new Float32BufferAttribute(color, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Prostopadłościan o środku `(x, y, z)` (metry). */
function box(l: number, h: number, w: number, x: number, y: number, z: number): BufferGeometry {
  return new BoxGeometry(l, h, w).translate(x, y, z);
}

/** Drzewo: pień (brąz) i dwie ściętej korony (zieleń z palety trawników: dolna ciemniejsza, górna jaśniejsza). */
function treeGeometry(): BufferGeometry {
  const bark = new Color(PALETTE.clothes[9]!);
  const leaf = new Color(PALETTE.street.grass[2]!);
  const parts: { geometry: BufferGeometry; color: Color }[] = [
    { geometry: new CylinderGeometry(TREE.trunk.r1, TREE.trunk.r0, TREE.trunk.h, 5).translate(0, TREE.trunk.h / 2, 0), color: bark },
  ];
  for (const c of TREE.crowns) parts.push({ geometry: new IcosahedronGeometry(c.r, 0).translate(0, c.y, 0), color: leaf.clone().multiplyScalar(c.shade) });
  return mergeColored(parts);
}

/** Auto: nadwozie w bieli (barwa przychodzi z instancji), kabina i koła ciemne; dłuższy bok wzdłuż osi x. */
function carGeometry(): BufferGeometry {
  const white = new Color('#ffffff');
  const glass = new Color(PALETTE.fixture.fridgeFrame);
  const tyre = new Color(PALETTE.wall[4]!);
  const { body, cabin, wheel } = CAR;
  const parts: { geometry: BufferGeometry; color: Color }[] = [
    { geometry: box(body.l, body.h, body.w, 0, body.y + body.h / 2, 0), color: white },
    { geometry: box(cabin.l, cabin.h, cabin.w, cabin.x, cabin.y + cabin.h / 2, 0), color: glass },
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push({ geometry: box(wheel.d, wheel.d, wheel.w, sx * wheel.x, wheel.d / 2, sz * (body.w / 2 - wheel.w / 2 + 0.02)), color: tyre });
  }
  return mergeColored(parts);
}

// --- Drzewa: rozmieszczenie ------------------------------------------------------------------------------------

interface Planted { x: number; y: number; scale: number; yaw: number; tint: number }
interface Rect { x0: number; x1: number; y0: number; y1: number }

/** Obrys planu budynku w metrach miasta (plan jest w jednostkach sceny). */
const planRect = (p: BuildingPlan): Rect => ({
  x0: p.x0 * CITY_UNIT_M + CITY_M / 2, x1: p.x1 * CITY_UNIT_M + CITY_M / 2, y0: p.z0 * CITY_UNIT_M + CITY_M / 2, y1: p.z1 * CITY_UNIT_M + CITY_M / 2,
});

/** Siatka `n × n` wewnątrz `[lo, hi]` (węzły co `(hi − lo) / (n − 1)`), `n` tak, żeby odstęp był najbliższy `pitchM`. */
function gridAxis(lo: number, hi: number, pitchM: number): number[] {
  const n = Math.max(2, Math.round((hi - lo) / pitchM) + 1);
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

/**
 * Miejsca drzew (metry miasta, kolejność: kwartał po kwartale, wierszami): park co `PARK_PITCH_M`, podwórka co `YARD_PITCH_M` z
 * zapasem `WALL_M` od obrysów. Najwyżej `TREES_MAX`: park w całości, podwórka od najniższego rankingu skrótu.
 */
function plantTrees(city: CityState, plans: readonly BuildingPlan[]): Planted[] {
  const walls = plans.map(planRect);
  const parks: (Planted & { rank: number; order: number })[] = [];
  const yards: (Planted & { rank: number; order: number })[] = [];
  let order = 0;
  city.blocks.forEach((district, block) => {
    const park = district === 'park';
    const jitter = park ? PARK_JITTER_M : YARD_JITTER_M;
    const bx = block % CITY_SIZE;
    const by = Math.floor(block / CITY_SIZE);
    const inner = EDGE_M + jitter;
    const xs = gridAxis(bx * BLOCK_M + STREET_HALF_M + inner, (bx + 1) * BLOCK_M - STREET_HALF_M - inner, park ? PARK_PITCH_M : YARD_PITCH_M);
    const ys = gridAxis(by * BLOCK_M + STREET_HALF_M + inner, (by + 1) * BLOCK_M - STREET_HALF_M - inner, park ? PARK_PITCH_M : YARD_PITCH_M);
    ys.forEach((gy, j) => xs.forEach((gx, i) => {
      const x = gx + jitter * (2 * hash01(block, i, j, 1) - 1);
      const y = gy + jitter * (2 * hash01(block, i, j, 2) - 1);
      order++;
      if (walls.some((r) => x > r.x0 - WALL_M && x < r.x1 + WALL_M && y > r.y0 - WALL_M && y < r.y1 + WALL_M)) return;
      const tree = {
        x, y, order, rank: hash01(block, i, j, 3),
        scale: TREE_SCALE_MIN + (TREE_SCALE_MAX - TREE_SCALE_MIN) * hash01(block, i, j, 4),
        yaw: Math.PI * 2 * hash01(block, i, j, 5),
        tint: 0.82 + 0.18 * hash01(block, i, j, 6),
      };
      (park ? parks : yards).push(tree);
    }));
  });
  const byRank = (a: { rank: number }, b: { rank: number }): number => a.rank - b.rank;
  const keptParks = parks.length > TREES_MAX ? [...parks].sort(byRank).slice(0, TREES_MAX) : parks;
  const keptYards = [...yards].sort(byRank).slice(0, TREES_MAX - keptParks.length);
  return [...keptParks, ...keptYards].sort((a, b) => a.order - b.order);
}

// --- Auta: odcinki i liczność -----------------------------------------------------------------------------------

/** Odcinek ulicy w metrach miasta: prostokąt, oś jazdy i środek jezdni. */
interface Lane {
  segment: StreetSegment;
  horizontal: boolean;
  /** Obwód obiegu (m): długość prostokąta bez długości auta (auto zawija się na końcu odcinka, cały w prostokącie). */
  loop: number;
  /** Współrzędna wzdłuż ulicy, od której liczy się obieg (środek auta tuż przy początku prostokąta), i oś jezdni w drugiej współrzędnej. */
  start: number;
  axis: number;
  /** Faza początkowa obiegu z numeru odcinka. */
  phase: number;
  /** Rozrzut zaokrąglenia liczby aut na odcinku: ten sam odcinek zaokrągla tak samo w każdej godzinie. */
  dither: number;
}

function lanesOf(city: CityState): Lane[] {
  return city.streets.map((segment) => {
    const [x0, y0, x1, y1] = streetRect(segment);
    const horizontal = segment.ay === segment.by;
    return {
      segment, horizontal,
      loop: (horizontal ? x1 - x0 : y1 - y0) - CAR_LENGTH_M,
      start: (horizontal ? x0 : y0) + CAR_LENGTH_M / 2,
      axis: horizontal ? (y0 + y1) / 2 : (x0 + x1) / 2,
      phase: hash01(segment.id, 11),
      dither: hash01(segment.id, 17),
    };
  });
}

/** Suma natężeń odcinków w godzinie `hour` (0–23) w dniu roboczym albo weekend. */
const totalIntensity = (city: CityState, hour: number, weekend: boolean): number =>
  city.streets.reduce((n, s) => n + streetIntensity(city.sources, s, hour, weekend), 0);

/**
 * Ile aut na odcinku w godzinie `hour`: natężenie razy `perIntensity` (skala miasta: najruchliwsza godzina tygodnia to `CARS_MAX`), zaokrąglone
 * z rozrzutem odcinka (średnio bez błędu), najwyżej `CARS_PER_SEGMENT_MAX`; razem najwyżej `CARS_MAX` (nadwyżkę zdejmuje z najbardziej
 * obłożonych odcinków).
 */
function carCounts(city: CityState, lanes: readonly Lane[], perIntensity: number, hour: number, weekend: boolean): number[] {
  const counts = lanes.map((lane) => Math.min(CARS_PER_SEGMENT_MAX, Math.floor(streetIntensity(city.sources, lane.segment, hour, weekend) * perIntensity + lane.dither)));
  let total = counts.reduce((a, b) => a + b, 0);
  while (total > CARS_MAX) {
    let at = 0;
    counts.forEach((n, i) => { if (n >= counts[at]!) at = i; });
    counts[at]!--;
    total--;
  }
  return counts;
}

const frac = (x: number): number => x - Math.floor(x);

export function buildCityProps(city: CityState, plans: readonly BuildingPlan[], opts: { cars: boolean; shadows?: boolean }): CityProps {
  const root = new Group();
  root.name = 'city:props';
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const meshes: InstancedMesh[] = [];
  const add = (name: string, geometry: BufferGeometry, material: MeshStandardMaterial, capacity: number): InstancedMesh => {
    geometries.push(geometry);
    materials.push(material);
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;   // całe miasto jest w kadrze, a auta wychodzą poza obrys startowy
    root.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const up = new Vector3(0, 1, 0);
  const color = new Color();

  // drzewa: stałe, liczone raz
  const planted = plantTrees(city, plans);
  const trees = planted.length > 0
    ? add('trees', treeGeometry(), new MeshStandardMaterial({ name: 'city:trees', vertexColors: true, roughness: 0.9, metalness: 0 }), planted.length)
    : null;
  if (trees) {
    planted.forEach((t, i) => {
      const w = cityToWorld(t.x, t.y);
      m.compose(p.set(w.x, 0, w.z), q.setFromAxisAngle(up, t.yaw), s.setScalar(t.scale));
      trees.setMatrixAt(i, m);
      trees.setColorAt(i, color.setScalar(t.tint));
    });
    trees.instanceMatrix.needsUpdate = true;
    trees.instanceColor!.needsUpdate = true;
  }

  // auta: pula `CARS_MAX` instancji, liczność i barwy z godziny, położenie z czasu
  const lanes = opts.cars ? lanesOf(city) : [];
  let perIntensity = 0;
  if (opts.cars) {
    let peak = 0;
    for (const weekend of [false, true]) for (let h = 0; h < 24; h++) peak = Math.max(peak, totalIntensity(city, h, weekend));
    perIntensity = peak > 0 ? CARS_MAX / peak : 0;
  }
  const cars = opts.cars
    ? add('cars', carGeometry(), new MeshStandardMaterial({ name: 'city:auta', vertexColors: true, roughness: 0.55, metalness: 0.1 }), CARS_MAX)
    : null;
  cars?.instanceMatrix.setUsage(DynamicDrawUsage);
  cars?.setColorAt(0, color.set('#ffffff'));   // bufor barw od razu: shader nie kompiluje się drugi raz, gdy pierwsze auto pojawi się dopiero o świcie
  if (cars) cars.count = 0;
  /** Auta pokazane teraz: odcinek i numer na odcinku (numer określa stronę i fazę). */
  let slots: { lane: Lane; k: number }[] = [];
  let slotKey = -1;
  let clock = 0;   // czas obiegu (s): suma `dtSec` z makiety

  let layer: CityLayer = 'makieta';   // sama makieta pokazuje rekwizyty; widok miasta ustawia tryb zaraz po budowie
  let shadows = opts.shadows === true;
  let disposed = false;
  const applyVisibility = (): void => {
    const mockup = layer === 'makieta';
    if (trees) {
      trees.visible = mockup;
      trees.castShadow = mockup && shadows;
    }
    if (cars) cars.visible = mockup;
    root.visible = mockup;
  };
  applyVisibility();

  /** Liczność i barwy aut dla godziny (`key`): wołane tylko przy zmianie godziny albo dnia. */
  const refill = (hour: number, weekend: boolean): void => {
    if (!cars) return;
    const counts = carCounts(city, lanes, perIntensity, hour, weekend);
    slots = [];
    lanes.forEach((lane, i) => { for (let k = 0; k < counts[i]!; k++) slots.push({ lane, k }); });
    slots.forEach(({ lane, k }, i) => {
      const pick = Math.floor(hash01(lane.segment.id, k, 5) * PALETTE.clothes.length) % PALETTE.clothes.length;
      cars.setColorAt(i, color.set(PALETTE.clothes[pick]!));
    });
    cars.count = slots.length;
    if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
  };

  /** Położenie aut w czasie `clock`: obieg po prawym pasie, każda strona w swoją stronę. */
  const place = (): void => {
    if (!cars) return;
    slots.forEach(({ lane, k }, i) => {
      const dir = k % 2 === 0 ? 1 : -1;
      const u = frac(lane.phase + k * PHI + (dir * CAR_SPEED_MPS * clock) / lane.loop);
      const along = lane.start + lane.loop * u;
      // prawy pas: jadąc na wschód prawa ręka to południe (y większe), na południe zachód (x mniejsze)
      let x: number;
      let y: number;
      let yaw: number;
      if (lane.horizontal) {
        x = along;
        y = lane.axis + dir * LANE_OFFSET_M;
        yaw = dir > 0 ? 0 : Math.PI;
      } else {
        x = lane.axis - dir * LANE_OFFSET_M;
        y = along;
        yaw = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      }
      const w = cityToWorld(x, y);
      m.compose(p.set(w.x, 0, w.z), q.setFromAxisAngle(up, yaw), s.set(1, 1, 1));
      cars.setMatrixAt(i, m);
    });
    cars.instanceMatrix.needsUpdate = true;
  };

  return {
    root,
    tick(dtSec, hour, weekend) {
      if (!cars || layer !== 'makieta' || disposed) return;
      const h = ((Math.floor(hour) % 24) + 24) % 24;
      const key = (weekend ? 24 : 0) + h;
      const changed = key !== slotKey;
      if (changed) { slotKey = key; refill(h, weekend); }
      if (!changed && !(dtSec > 0)) return;   // pauza: auta stoją tam, gdzie stały
      clock += Math.max(0, dtSec);
      place();
    },
    setLayer(next) {
      layer = next;
      applyVisibility();
    },
    setShadows(on) {
      shadows = on;
      applyVisibility();
    },
    stats() {
      const mockup = layer === 'makieta';
      return { trees: mockup && trees ? trees.count : 0, cars: mockup && cars ? cars.count : 0 };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
      for (const mesh of meshes) mesh.dispose();
    },
  };
}
