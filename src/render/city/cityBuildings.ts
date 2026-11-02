import { Box3, DynamicDrawUsage, Vector3, type BufferAttribute, type BufferGeometry, type Color } from 'three';
import { BLOCK_M } from '@/sim/city/districts';
import { SLOT_M, STREET_HALF_M } from '@/sim/city/generateCity';
import { CITY_SIZE, type CityLot, type CityState, type StoreDistrict } from '@/sim/city/types';
import { CELL_SIZE_M } from '@/sim/grid';
import { GeomBuilder, type V3 } from '@/render/street/buildings';
import { createFacadeAtlas, type AtlasCellName, type FacadeAtlas } from '@/render/street/facadeAtlas';
import { PALETTE } from '@/render/style';
import { CITY_UNIT_M, cityToWorld, hash01, unit } from './cityCoords';

/**
 * Bryły makiety miasta (spec §7.1, §19 „4a.2”): proceduralne budynki w stylu ulicy przed sklepem, z fasadami z atlasu elewacji
 * (`street/facadeAtlas.ts`) i kolorami wierzchołków z PALETTE, sklejone w jedną geometrię na chunk 2 × 2 kwartały, jak bryły warstw
 * w 4a.1. Moduł tylko liczy plany i geometrie; siatki, materiały, tryby i witryny według stanu lokalu składa scena (`buildCity.ts`).
 *
 * - Plan (`planCityBuildings`) to obrys, kondygnacje i barwy: jeden budynek na lokal, stojący w slocie lokalu (odcinek pierzei
 *   `SLOT_M` od ulicy do połowy kwartału), plus hala dworca we wnętrzu kwartału punktu ruchu „dworzec”. Wnętrza kwartałów poza
 *   obrysami zostają wolne na podwórka (drzewa).
 * - Fasady: od frontu i od tyłu jeden czworokąt na przęsło i kondygnację z komórką `okno` albo `oknoGasne` (część świeci nocą,
 *   jak `LIT_SHARE` ulicy), boki to jeden czworokąt `tynk` albo `szewPlyty`, dach to jeden czworokąt. Parter od ulicy ma jedną
 *   adresowalną witrynę lokalu (`ShopFront`: kilka czworokątów `witryna` w jednym ciągu wierzchołków), którą `setFront` przemalowuje
 *   bez dotykania pozycji.
 * - Kolor czworokąta okna to barwa budynku: kremowa rama komórki przyjmuje ją jak tynk, a szyba ciemnieje, więc z daleka budynek ma
 *   swój pastel z siatką okien, a z bliska widać okna. Komórki z własnym kolorem (witryna, brama) dostają biel.
 *
 * Determinizm: nic nie jest losowane. Warianty (kondygnacje, obrys, barwy, które okno świeci, garaże) biorą się ze skrótu numeru
 * lokalu (`unit(id)` z `cityCoords.ts`, wspólny z widokiem warstw), więc ten sam seed daje tę samą geometrię co do bitu.
 *
 * Jednostki: obrysy i wysokości planu są w jednostkach sceny (`CITY_UNIT_M` metrów, środek miasta w (0, 0), x miasta to x sceny,
 * y miasta to z sceny, jak `cityToWorld`); stałe wyglądu niżej są w metrach.
 */

export type BuildingStyle = 'blok' | 'kamienica' | 'pawilon' | 'biurowiec' | 'dworzec';
type LotStyle = Exclude<BuildingStyle, 'dworzec'>;

export interface BuildingPlan {
  /** null: budynek dworca (bez lokalu). */
  lotId: number | null;
  style: BuildingStyle;
  /** Obrys w jednostkach sceny. */
  x0: number; x1: number; z0: number; z1: number;
  /** Kondygnacje z parterem. */
  floors: number;
  /** Wysokość dachu w jednostkach sceny (`floors` × wysokość kondygnacji stylu); wieża dworca i nadbudówki na dachu sięgają wyżej. */
  height: number;
  /** Barwy budynku z PALETTE: główna (ściany, okna) i dodatkowa (boki bloku i pawilonu, gzymsy, nadbudówki). */
  main: string;
  accent: string;
  /** Strona frontu: ulica, przy której stoi lokal (pierzeja północna kwartału ma front na północ, czyli ku −z). */
  front: 'n' | 's';
}

/** Witryna parteru lokalu od ulicy: wierzchołki `[first, first + count)` w geometrii chunku, czworokąty po 6 wierzchołków. */
export interface ShopFront { lotId: number; first: number; count: number }

export interface ChunkGeometry {
  /** Numer chunku: `⌊by / 2⌋ · 3 + ⌊bx / 2⌋`, jak w 4a.1. */
  chunk: number;
  geometry: BufferGeometry;
  fronts: ShopFront[];
  /**
   * Bryła każdego lokalu chunku: obrys do `pickLot`, środek dachu pod kotwicę pinezki i ciąg wierzchołków budynku
   * (`[first, first + count)`, razem z witryną), żeby warstwy mogły barwić budynek według stanu lokalu. To jedyne źródło obrysów
   * lokali: `box` i `top` liczą się z prawdziwych wierzchołków (od y = 0 do najwyższego punktu, razem z nadbudówką na dachu), nie z
   * wysokości planu, więc kotwica stoi nad wieżą, a wybór lokalu trafia w całą bryłę.
   */
  boxes: { lotId: number; box: Box3; top: Vector3; first: number; count: number }[];
  /** Ciąg wierzchołków dworca (budynek bez lokalu), tylko w chunku, w którym stoi. Budynki lokali i dworzec pokrywają cały chunk. */
  station?: { first: number; count: number };
}

/** Budżet trójkątów całej makiety (bryły wszystkich chunków). */
export const MOCKUP_TRIS_MAX = 250_000;

// --- Wygląd (metry) -------------------------------------------------------------------------------------------

const LOT_STYLE: Readonly<Record<StoreDistrict, LotStyle>> = { osiedle: 'blok', srodmiescie: 'kamienica', dworzec: 'pawilon', biurowce: 'biurowiec' };

/** Wysokość kondygnacji (m). Dworzec: hala 12 m to trzy „kondygnacje” fasady po 4 m. */
const FLOOR_M: Readonly<Record<BuildingStyle, number>> = { blok: 2.8, kamienica: 3.3, pawilon: 3.5, biurowiec: 3.5, dworzec: 4 };
/** Kondygnacje (włącznie) wg stylu. */
const FLOORS: Readonly<Record<LotStyle, readonly [number, number]>> = { blok: [4, 11], kamienica: [4, 5], pawilon: [1, 1], biurowiec: [6, 14] };
/** Szerokość przęsła fasady (m): jedno okno na przęsło i kondygnację. */
const BAY_M: Readonly<Record<BuildingStyle, number>> = { blok: 3, kamienica: 2.4, pawilon: 3.2, biurowiec: 2.6, dworzec: 4 };
/** Przęsło witryny lokalu (m); witryna ma szerokość sklepu (`interiorWidth` + dwie ściany). */
const SHOP_BAY_M = 3;
/** Kawałek parteru obok witryny węższy niż tyle (m) dołącza do witryny, żeby nie było przęseł-szczelin. */
const MIN_FILL_M = 1.2;
/** Front budynku stoi tyle (m) za krawędzią ulicy. */
const FRONT_GAP_M = 1;
/** Gzyms kamienicy: pas pod sufitem każdej kondygnacji frontu (m). */
const GZYMS_M = 0.35;
/** Część okien, która nocą świeci (komórka `okno` zamiast `oknoGasne`), jak `LIT_SHARE` w `street/buildings.ts`. */
const LIT_SHARE = 0.4;

/** Obrys lokalu (m): szerokość i głębokość (widełki). Slot ma `SLOT_M` = 25 m, więc między sąsiadami zostaje 1–10 m przerwy. */
const FOOTPRINT: Readonly<Record<LotStyle, { width: readonly [number, number]; depth: readonly [number, number] }>> = {
  blok: { width: [23, 23], depth: [12, 14] },
  kamienica: { width: [24, 24], depth: [14, 17] },   // prawie ciągła pierzeja
  biurowiec: { width: [22, 22], depth: [16, 20] },
  pawilon: { width: [15, 21], depth: [10, 14] },
};

/** Garaże: lokal pawilonu z `unit(id)` < tyle to rząd blaszaków (co trzeci), z bramami w kolorach `GARAGE_DOORS`. */
const GARAGE_SHARE = 0.3;
const GARAGE_BAYS = 7;
const GARAGE_BAY_M = 3;
const GARAGE_DEPTH_M = 6;
const GARAGE_DOOR_M = 2.5;
/** Witryna lokalu w rzędzie garaży: przerobione dwa boksy. */
const GARAGE_SHOP_BAYS = 2;

/** Nadbudówki na dachu (m): klatka schodowa bloku i maszynownia biurowca, przy końcu dachu (środek zostaje pod pinezkę). */
const ROOFTOP: Readonly<Partial<Record<LotStyle, { w: number; d: number; h: number }>>> = {
  blok: { w: 3.6, d: 3, h: 2.4 },
  biurowiec: { w: 6, d: 5, h: 2.2 },
};

/** Dworzec (m): obrys hali z wieżą, odstępy od lokali i ulic, wieża zegarowa, dach dwuspadowy. */
const STATION = {
  w: 66, d: 26, margin: 4, inset: 0.5, ridge: 4,
  tower: 8, towerH: 26, spire: 5,
  clock: 3.4, clockY: 21, clockOff: 0.15, handOff: 0.3, handW: 0.22, hourLen: 1, minuteLen: 1.45,
  /** Wejścia (brama) w środku parteru frontu hali. */
  gates: 3,
} as const;
/** Zegar dworca stoi na 10:10 (kąty wskazówek od godziny 12 w prawo, w stopniach). */
const CLOCK_DEG = { hour: (10 + 10 / 60) * 30, minute: 10 * 6 } as const;

// --- Barwy (tylko PALETTE) -------------------------------------------------------------------------------------

const ST = PALETTE.street;
/** Baza kolorów wierzchołków dla komórek z własnym kolorem (witryna, brama), jak w `street/buildings.ts`. */
const WHITE = '#ffffff';
const CREAM = ST.kamienicaPlaster[2]!;
/** Pokłady dachów po kolei: papa, jasna papa, żwir (przewodnik stylu: dachy w rzędzie nie są jednolicie ciemne). */
const ROOFS = [ST.asphalt[1]!, ST.curb[1]!, ST.sidewalk[3]!] as const;
const OFFICE = [ST.blokPastel[4]!, ST.blokPastel[3]!, ST.kamienicaPlaster[2]!, ST.curb[0]!, ST.kamienicaPlaster[3]!] as const;
const PAVILION = [ST.kamienicaPlaster[0]!, ST.kamienicaPlaster[2]!, ST.kamienicaPlaster[3]!, ST.blokPastel[0]!, ST.blokPastel[4]!, ST.curb[0]!] as const;
const GARAGE_WALL = ST.curb[1]!;
/** Bramy garaży malowane każda inaczej, jak w każdym rzędzie blaszaków. */
const GARAGE_DOORS = [PALETTE.clothes[4]!, PALETTE.clothes[3]!, PALETTE.clothes[9]!, PALETTE.clothes[8]!, PALETTE.clothes[0]!, PALETTE.fixture.wood, PALETTE.clothes[11]!] as const;
const STATION_COLORS = { main: ST.kamienicaPlaster[1]!, accent: CREAM, roof: ST.kamienicaPlaster[5]!, spire: ST.kamienicaPlaster[3]!, hands: PALETTE.wall[4]! } as const;

// --- Skróty (render nie losuje; `hash01` i `unit` w cityCoords.ts) -------------------------------------------------------

const pickOf = <T>(pool: readonly T[], r: number): T => pool[Math.min(pool.length - 1, Math.floor(r * pool.length))]!;
/** Dwa różne wpisy puli. */
function twoOf<T>(pool: readonly T[], r1: number, r2: number): [T, T] {
  const i = Math.min(pool.length - 1, Math.floor(r1 * pool.length));
  const j = (i + 1 + Math.floor(r2 * (pool.length - 1))) % pool.length;
  return [pool[i]!, pool[j]!];
}
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const between = ([lo, hi]: readonly [number, number], r: number): number => lo + (hi - lo) * r;

// --- Plany -----------------------------------------------------------------------------------------------------

/** Styl budynku lokalu z dzielnicy (§7.1): Osiedle blok, Śródmieście kamienica, Dworzec pawilon, Biurowce biurowiec. */
export function buildingStyle(lot: CityLot): BuildingStyle {
  return LOT_STYLE[lot.district];
}

const lotStyle = (lot: CityLot): LotStyle => LOT_STYLE[lot.district];
const isGarage = (lot: CityLot): boolean => lotStyle(lot) === 'pawilon' && unit(lot.id) < GARAGE_SHARE;
/** Pierzeja północna kwartału: lokal stoi przy ulicy y = by · BLOCK_M, a budynek rośnie na południe. */
const isNorth = (lot: Pick<CityLot, 'by' | 'y'>): boolean => lot.y - lot.by * BLOCK_M < BLOCK_M / 2;

/** Prostokąt w metrach miasta. */
interface RectM { x0: number; x1: number; z0: number; z1: number }

/** Slot lokalu: jego odcinek pierzei (`SLOT_M`, wejście `lot.x` jak w generatorze) od krawędzi ulicy do połowy głębokości kwartału. */
function lotSlot(lot: CityLot): RectM {
  const x0 = lot.x - Math.floor(SLOT_M / 2);
  const mid = lot.by * BLOCK_M + BLOCK_M / 2;
  return isNorth(lot)
    ? { x0, x1: x0 + SLOT_M, z0: lot.by * BLOCK_M + STREET_HALF_M, z1: mid }
    : { x0, x1: x0 + SLOT_M, z0: mid, z1: (lot.by + 1) * BLOCK_M - STREET_HALF_M };
}

/** Obrys budynku lokalu w metrach: na środku slotu, front `FRONT_GAP_M` za krawędzią ulicy. */
function lotFootprint(lot: CityLot): RectM {
  const style = lotStyle(lot);
  const slot = lotSlot(lot);
  let w: number;
  let d: number;
  if (isGarage(lot)) {
    w = GARAGE_BAYS * GARAGE_BAY_M;
    d = GARAGE_DEPTH_M;
  } else {
    w = between(FOOTPRINT[style].width, hash01(lot.id, 3));
    d = between(FOOTPRINT[style].depth, hash01(lot.id, 4));
  }
  const cx = (slot.x0 + slot.x1) / 2;
  const z0 = isNorth(lot) ? slot.z0 + FRONT_GAP_M : slot.z1 - FRONT_GAP_M - d;
  return { x0: cx - w / 2, x1: cx + w / 2, z0, z1: z0 + d };
}

function lotColors(lot: CityLot): [string, string] {
  const r1 = hash01(lot.id, 1);
  const r2 = hash01(lot.id, 2);
  if (isGarage(lot)) return [GARAGE_WALL, pickOf(GARAGE_DOORS, r1)];
  switch (lotStyle(lot)) {
    case 'blok': return twoOf(ST.blokPastel, r1, r2);
    case 'kamienica': {
      const main = pickOf(ST.kamienicaPlaster, r1);
      return [main, main === CREAM ? ST.kamienicaPlaster[0]! : CREAM];
    }
    case 'biurowiec': return [pickOf(OFFICE, r1), ST.curb[1]!];
    case 'pawilon': return [pickOf(PAVILION, r1), pickOf(ST.blokPastel, r2)];
  }
}

/** Prostokąt w metrach jako obrys planu w jednostkach sceny. */
function toScene(r: RectM): Pick<BuildingPlan, 'x0' | 'x1' | 'z0' | 'z1'> {
  const a = cityToWorld(r.x0, r.z0);
  const b = cityToWorld(r.x1, r.z1);
  return { x0: a.x, x1: b.x, z0: a.z, z1: b.z };
}
/** Obrys planu (jednostki sceny) w metrach miasta. */
function toMetres(p: Pick<BuildingPlan, 'x0' | 'x1' | 'z0' | 'z1'>): RectM {
  const half = (CITY_SIZE * BLOCK_M) / 2;
  return { x0: p.x0 * CITY_UNIT_M + half, x1: p.x1 * CITY_UNIT_M + half, z0: p.z0 * CITY_UNIT_M + half, z1: p.z1 * CITY_UNIT_M + half };
}

function planLot(lot: CityLot): BuildingPlan {
  const style = lotStyle(lot);
  const [lo, hi] = FLOORS[style];
  const floors = lo + Math.floor(unit(lot.id) * (hi - lo + 1));
  const [main, accent] = lotColors(lot);
  return {
    lotId: lot.id, style, ...toScene(lotFootprint(lot)), floors, height: (floors * FLOOR_M[style]) / CITY_UNIT_M,
    main, accent, front: isNorth(lot) ? 'n' : 's',
  };
}

/**
 * Hala dworca we wnętrzu kwartału punktu ruchu „dworzec”: między tyłami pawilonów obu pierzei (z odstępem `STATION.margin`), wzdłuż
 * kwartału, jak najbliżej punktu ruchu. Pierzeje stoją tylko przy ulicach poziomych, więc końce hali patrzą na ulice poprzeczne.
 * null, gdy miasto nie ma dworca albo wnętrze kwartału jest za ciasne.
 */
function planStation(city: CityState, lots: readonly BuildingPlan[]): BuildingPlan | null {
  const src = city.sources.find((s) => s.kind === 'dworzec');
  if (!src) return null;
  const bx = clamp(Math.floor(src.x / BLOCK_M), 0, CITY_SIZE - 1);
  const by = clamp(Math.floor(src.y / BLOCK_M), 0, CITY_SIZE - 1);
  const m = STATION.margin;
  const ix0 = bx * BLOCK_M + STREET_HALF_M + m;
  const ix1 = (bx + 1) * BLOCK_M - STREET_HALF_M - m;
  let iz0 = by * BLOCK_M + STREET_HALF_M + m;
  let iz1 = (by + 1) * BLOCK_M - STREET_HALF_M - m;
  for (const p of lots) {
    const lot = city.lots[p.lotId!]!;
    if (lot.bx !== bx || lot.by !== by) continue;
    const r = toMetres(p);
    if (isNorth(lot)) iz0 = Math.max(iz0, r.z1 + m);
    else iz1 = Math.min(iz1, r.z0 - m);
  }
  const w = Math.min(STATION.w, ix1 - ix0);
  const d = Math.min(STATION.d, iz1 - iz0);
  if (w < STATION.tower * 3 || d < STATION.tower * 2) return null;
  const cx = clamp(src.x, ix0 + w / 2, ix1 - w / 2);
  const cz = clamp(src.y, iz0 + d / 2, iz1 - d / 2);
  const floors = 3;
  return {
    lotId: null, style: 'dworzec', ...toScene({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 }),
    floors, height: (floors * FLOOR_M.dworzec) / CITY_UNIT_M, main: STATION_COLORS.main, accent: STATION_COLORS.accent,
    // front ku szerszemu pasowi wnętrza kwartału (plac przed dworcem)
    front: cz < by * BLOCK_M + BLOCK_M / 2 ? 's' : 'n',
  };
}

/** Plany brył makiety: jeden budynek na lokal (w kolejności `city.lots`) i na końcu dworzec w kwartale punktu ruchu „dworzec”. */
export function planCityBuildings(city: CityState): BuildingPlan[] {
  const lots = city.lots.map(planLot);
  const station = planStation(city, lots);
  return station ? [...lots, station] : lots;
}

// --- Geometria -------------------------------------------------------------------------------------------------

type UV = [number, number, number, number];

/** Ściana widziana z zewnątrz (jednostki sceny): `s` od lewej do prawej patrząc na ścianę, `off` od muru na zewnątrz. */
interface Face { ox: number; oz: number; rx: number; rz: number; nx: number; nz: number; len: number }
type Side = 'n' | 's' | 'w' | 'e';

function facesOf(x0: number, x1: number, z0: number, z1: number): Record<Side, Face> {
  return {
    n: { ox: x1, oz: z0, rx: -1, rz: 0, nx: 0, nz: -1, len: x1 - x0 },
    s: { ox: x0, oz: z1, rx: 1, rz: 0, nx: 0, nz: 1, len: x1 - x0 },
    w: { ox: x0, oz: z0, rx: 0, rz: 1, nx: -1, nz: 0, len: z1 - z0 },
    e: { ox: x1, oz: z1, rx: 0, rz: -1, nx: 1, nz: 0, len: z1 - z0 },
  };
}
const at = (f: Face, s: number, y: number, off = 0): V3 => [f.ox + f.rx * s + f.nx * off, y, f.oz + f.rz * s + f.nz * off];

interface Ctx {
  b: GeomBuilder;
  cell(name: AtlasCellName): UV;
  /** UV brył bez faktury: punkt w środku komórki `tynk`, jak w `street/buildings.ts`. */
  flat: UV;
  /** Metry na jednostkę sceny. */
  u: number;
}

const vertexCount = (b: GeomBuilder): number => b.triangles * 3;
/** Liczba przęseł na ścianie o długości `lengthM` metrów. */
const bayCount = (lengthM: number, bayM: number): number => Math.max(1, Math.round(lengthM / bayM));

/** Czworokąt na ścianie: `s0..s1` wzdłuż, `y0..y1` w pionie (jednostki sceny). */
function faceQuad(c: Ctx, f: Face, s0: number, s1: number, y0: number, y1: number, uv: UV, color: string, off = 0): void {
  c.b.quad(at(f, s0, y0, off), at(f, s1, y0, off), at(f, s1, y1, off), at(f, s0, y1, off), uv, color);
}
/** Trójkąt od dolnej krawędzi ściany na wysokości `y` do `apex` (szczyt, połać ostrosłupa); czworokąt z dwoma rogami w `apex`. */
function faceTri(c: Ctx, f: Face, y: number, apex: V3, uv: UV, color: string): void {
  c.b.quad(at(f, 0, y), at(f, f.len, y), apex, apex, uv, color);
}
/** Płaski dach (normalna w górę). */
function roofQuad(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, color: string): void {
  c.b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], c.flat, color);
}
/** Prostopadłościan bez spodu o płaskim kolorze (nadbudówka na dachu). */
function solid(c: Ctx, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color: string): void {
  for (const f of Object.values(facesOf(x0, x1, z0, z1))) faceQuad(c, f, 0, f.len, y0, y1, c.flat, color);
  roofQuad(c, x0, x1, z0, z1, y1, color);
}

/** Okno przęsła: `okno` (świeci nocą) albo `oknoGasne`, ze skrótu (budynek, ściana, kondygnacja, przęsło). */
const windowCell = (key: number, face: number, floor: number, bay: number): AtlasCellName => (hash01(key, face, floor, bay) < LIT_SHARE ? 'okno' : 'oknoGasne');

const FACE_FRONT = 0;
const FACE_BACK = 1;

/**
 * Siatka okien na ścianie: kondygnacje `from..to-1`, po czworokącie na przęsło; front kamienicy ma pod sufitem każdej kondygnacji
 * pas gzymsu (komórka `gzyms` w barwie dodatkowej), więc najwyższy pas jest gzymsem koronującym.
 */
function windowGrid(c: Ctx, p: BuildingPlan, f: Face, key: number, face: number, from: number, to: number): void {
  const fh = FLOOR_M[p.style] / c.u;
  const gz = p.style === 'kamienica' && face === FACE_FRONT ? GZYMS_M / c.u : 0;
  const n = bayCount(f.len * c.u, BAY_M[p.style]);
  const bw = f.len / n;
  for (let k = from; k < to; k++) {
    const y0 = k * fh;
    const y1 = y0 + fh;
    for (let i = 0; i < n; i++) {
      faceQuad(c, f, i * bw, (i + 1) * bw, y0, y1 - gz, c.cell(windowCell(key, face, k, i)), p.main);
      if (gz > 0) faceQuad(c, f, i * bw, (i + 1) * bw, y1 - gz, y1, c.cell('gzyms'), p.accent);
    }
  }
}

/**
 * Parter frontu lokalu: witryna sklepu (szerokość sklepu, na wprost wejścia `lot.x`) i po bokach przęsła wg stylu: okna (blok,
 * kamienica, biurowiec; kamienica ma przy jednym końcu bramę na podwórko), witryny sąsiednich lokali (pawilon) albo bramy garaży.
 * Zwraca witrynę lokalu.
 */
function groundFront(c: Ctx, p: BuildingPlan, lot: CityLot, f: Face): ShopFront {
  const u = c.u;
  const fh = FLOOR_M[p.style] / u;
  const garage = isGarage(lot);
  const lengthM = f.len * u;
  const r = toMetres(p);
  const entranceM = p.front === 'n' ? r.x1 - lot.x : lot.x - r.x0;   // `s` wejścia wzdłuż frontu (front 'n' biegnie od x1 ku x0)

  // zakres witryny wzdłuż frontu (m)
  let a: number;
  let e: number;
  if (garage) {
    const k = clamp(Math.round(entranceM / GARAGE_BAY_M - GARAGE_SHOP_BAYS / 2), 0, GARAGE_BAYS - GARAGE_SHOP_BAYS);
    a = k * GARAGE_BAY_M;
    e = a + GARAGE_SHOP_BAYS * GARAGE_BAY_M;
  } else {
    const shopM = Math.min(lengthM, (lot.spec.interiorWidth + 2) * CELL_SIZE_M);
    a = clamp(entranceM - shopM / 2, 0, lengthM - shopM);
    e = a + shopM;
    if (a < MIN_FILL_M) a = 0;
    if (lengthM - e < MIN_FILL_M) e = lengthM;
  }

  const top = garage ? GARAGE_DOOR_M / u : p.style === 'kamienica' ? fh - GZYMS_M / u : fh;
  const gateLeft = hash01(lot.id, 7) < 0.5;
  /** Przęsła między `s0M` a `s1M` metrów (`part`: 1 lewa, 2 prawa strona witryny); `gate`: przęsło przy końcu budynku to brama. */
  const filler = (s0M: number, s1M: number, part: number, gate: boolean, atStart: boolean): void => {
    if (s1M - s0M <= 1e-6) return;
    const n = bayCount(s1M - s0M, garage ? GARAGE_BAY_M : BAY_M[p.style]);
    const bw = (s1M - s0M) / n / u;
    const s0 = s0M / u;
    for (let i = 0; i < n; i++) {
      const q0 = s0 + i * bw;
      const q1 = q0 + bw;
      if (garage) faceQuad(c, f, q0, q1, 0, top, c.cell('szewPlyty'), pickOf(GARAGE_DOORS, hash01(lot.id, part, i)));
      else if (p.style === 'pawilon') faceQuad(c, f, q0, q1, 0, top, c.cell('witryna'), WHITE);
      else if (gate && i === (atStart ? 0 : n - 1)) faceQuad(c, f, q0, q1, 0, top, c.cell('brama'), WHITE);
      else faceQuad(c, f, q0, q1, 0, top, c.cell(windowCell(lot.id, FACE_FRONT, 0, part * 100 + i)), p.main);
    }
  };
  const kamienica = p.style === 'kamienica';
  const hasLeft = a > 1e-6;
  const hasRight = lengthM - e > 1e-6;
  const gateAtLeft = kamienica && hasLeft && (gateLeft || !hasRight);
  const gateAtRight = kamienica && hasRight && !gateAtLeft;
  filler(0, a, 1, gateAtLeft, true);

  const first = vertexCount(c.b);
  const shops = garage ? GARAGE_SHOP_BAYS : bayCount(e - a, SHOP_BAY_M);
  const sw = (e - a) / shops / u;
  for (let i = 0; i < shops; i++) faceQuad(c, f, a / u + i * sw, a / u + (i + 1) * sw, 0, top, c.cell('witryna'), WHITE);
  const front: ShopFront = { lotId: lot.id, first, count: vertexCount(c.b) - first };

  filler(e, lengthM, 2, gateAtRight, false);

  if (garage) faceQuad(c, f, 0, f.len, top, fh, c.cell('tynk'), p.main);   // pas nad bramami aż do dachu
  else if (kamienica) {
    // gzyms nad parterem w rytmie przęseł pięter
    const n = bayCount(lengthM, BAY_M.kamienica);
    for (let i = 0; i < n; i++) faceQuad(c, f, (i * f.len) / n, ((i + 1) * f.len) / n, top, fh, c.cell('gzyms'), p.accent);
  }
  return front;
}

/** Budynek lokalu: dach, boki, tył, piętra frontu, parter z witryną i nadbudówka. Zwraca witrynę i ciąg wierzchołków budynku. */
function emitLot(c: Ctx, p: BuildingPlan, lot: CityLot): { front: ShopFront; first: number; count: number } {
  const first = vertexCount(c.b);
  const { x0, x1, z0, z1, height: H } = p;
  const style = lotStyle(lot);
  const garage = isGarage(lot);
  const faces = facesOf(x0, x1, z0, z1);
  const front = faces[p.front];
  const back = faces[p.front === 'n' ? 's' : 'n'];

  roofQuad(c, x0, x1, z0, z1, H, ROOFS[lot.id % ROOFS.length]!);
  // boki: jeden czworokąt; blok ma szczyty z płyt w drugiej barwie, pawilon kolorowe ściany szczytowe
  const sideCell: AtlasCellName = style === 'blok' ? 'szewPlyty' : 'tynk';
  const sideColor = (style === 'blok' || style === 'pawilon') && !garage ? p.accent : p.main;
  for (const f of [faces.w, faces.e]) faceQuad(c, f, 0, f.len, 0, H, c.cell(sideCell), sideColor);
  // tył: okna na każdej kondygnacji; rząd garaży ma z tyłu ślepą ścianę
  if (garage) faceQuad(c, back, 0, back.len, 0, H, c.cell('tynk'), p.main);
  else windowGrid(c, p, back, lot.id, FACE_BACK, 0, p.floors);
  // front: piętra, potem parter z witryną
  windowGrid(c, p, front, lot.id, FACE_FRONT, 1, p.floors);
  const shop = groundFront(c, p, lot, front);
  // nadbudówka przy końcu dachu (blok przy x0, biurowiec przy x1), w głębi obrysu
  const top = ROOFTOP[style];
  if (top && !garage) {
    const w = top.w / c.u;
    const d = top.d / c.u;
    const inset = (x1 - x0) * 0.12;
    const bx0 = style === 'blok' ? x0 + inset : x1 - inset - w;
    const zc = (z0 + z1) / 2;
    solid(c, bx0, bx0 + w, zc - d / 2, zc + d / 2, H, H + top.h / c.u, p.accent);
  }
  return { front: shop, first, count: vertexCount(c.b) - first };
}

/**
 * Dworzec: hala z dachem dwuspadowym (bramy wejść w środku parteru frontu, okna na reszcie fasady) i wieża zegarowa przy końcu
 * bliższym ulicy poprzecznej, licem we froncie hali, z tarczą na każdej ścianie i ostrosłupowym hełmem.
 */
function emitStation(c: Ctx, p: BuildingPlan): void {
  const u = c.u;
  const inset = STATION.inset / u;
  const tw = STATION.tower / u;
  const H = p.height;
  const r = toMetres(p);
  const bx = clamp(Math.floor((r.x0 + r.x1) / 2 / BLOCK_M), 0, CITY_SIZE - 1);
  const towerAtMin = (r.x0 + r.x1) / 2 < bx * BLOCK_M + BLOCK_M / 2;
  const hx0 = p.x0 + inset + (towerAtMin ? tw : 0);
  const hx1 = p.x1 - inset - (towerAtMin ? 0 : tw);
  const hz0 = p.z0 + inset;
  const hz1 = p.z1 - inset;
  const key = -1;

  // hala
  const hall = facesOf(hx0, hx1, hz0, hz1);
  const front = hall[p.front];
  const back = hall[p.front === 'n' ? 's' : 'n'];
  windowGrid(c, p, back, key, FACE_BACK, 0, p.floors);
  windowGrid(c, p, front, key, FACE_FRONT, 1, p.floors);
  const n = bayCount(front.len * u, BAY_M.dworzec);
  const bw = front.len / n;
  const gate0 = Math.floor((n - STATION.gates) / 2);
  const fh = FLOOR_M.dworzec / u;
  for (let i = 0; i < n; i++) {
    const gate = i >= gate0 && i < gate0 + STATION.gates;
    faceQuad(c, front, i * bw, (i + 1) * bw, 0, fh, c.cell(gate ? 'brama' : windowCell(key, FACE_FRONT, 0, i)), gate ? WHITE : p.main);
  }
  const ridgeY = H + STATION.ridge / u;
  const zc = (hz0 + hz1) / 2;
  for (const side of ['w', 'e'] as const) {
    const f = hall[side];
    faceQuad(c, f, 0, f.len, 0, H, c.cell('tynk'), p.main);
    faceTri(c, f, H, [f.ox, ridgeY, zc], c.cell('tynk'), p.main);
  }
  // połacie: północna i południowa, kalenica wzdłuż x
  c.b.quad([hx1, H, hz0], [hx0, H, hz0], [hx0, ridgeY, zc], [hx1, ridgeY, zc], c.flat, STATION_COLORS.roof);
  c.b.quad([hx0, H, hz1], [hx1, H, hz1], [hx1, ridgeY, zc], [hx0, ridgeY, zc], c.flat, STATION_COLORS.roof);

  // wieża: przy końcu hali, licem we froncie
  const tx0 = towerAtMin ? hx0 - tw : hx1;
  const tz0 = p.front === 'n' ? hz0 : hz1 - tw;
  const th = STATION.towerH / u;
  const tower = facesOf(tx0, tx0 + tw, tz0, tz0 + tw);
  const clockY = STATION.clockY / u;
  const half = STATION.clock / 2 / u;
  for (const f of Object.values(tower)) {
    faceQuad(c, f, 0, f.len, 0, th, c.cell('tynk'), p.main);
    const sc = f.len / 2;
    faceQuad(c, f, sc - half, sc + half, clockY - half, clockY + half, c.flat, p.accent, STATION.clockOff / u);
    for (const [deg, len] of [[CLOCK_DEG.hour, STATION.hourLen], [CLOCK_DEG.minute, STATION.minuteLen]] as const) {
      // wskazówka: pasek od środka tarczy w kierunku `deg` (od 12 w prawo), w płaszczyźnie ściany (s w prawo, y w górę)
      const t = (deg * Math.PI) / 180;
      const dir: [number, number] = [Math.sin(t) * (len / u), Math.cos(t) * (len / u)];
      const perp: [number, number] = [Math.cos(t) * (STATION.handW / 2 / u), -Math.sin(t) * (STATION.handW / 2 / u)];
      const off = STATION.handOff / u;
      const pt = (s: number, y: number): V3 => at(f, s, y, off);
      c.b.quad(
        pt(sc - perp[0], clockY - perp[1]), pt(sc + perp[0], clockY + perp[1]),
        pt(sc + perp[0] + dir[0], clockY + perp[1] + dir[1]), pt(sc - perp[0] + dir[0], clockY - perp[1] + dir[1]),
        c.flat, STATION_COLORS.hands,
      );
    }
  }
  const apex: V3 = [tx0 + tw / 2, th + STATION.spire / u, tz0 + tw / 2];
  for (const f of Object.values(tower)) faceTri(c, f, th, apex, c.flat, STATION_COLORS.spire);
}

const CHUNK_BLOCKS = 2;
const CHUNKS_PER_SIDE = Math.ceil(CITY_SIZE / CHUNK_BLOCKS);

/** Chunk 2 × 2 kwartały, w którym leży środek obrysu. */
function chunkOf(p: BuildingPlan): number {
  const r = toMetres(p);
  const bx = clamp(Math.floor((r.x0 + r.x1) / 2 / BLOCK_M), 0, CITY_SIZE - 1);
  const by = clamp(Math.floor((r.z0 + r.z1) / 2 / BLOCK_M), 0, CITY_SIZE - 1);
  return Math.floor(by / CHUNK_BLOCKS) * CHUNKS_PER_SIDE + Math.floor(bx / CHUNK_BLOCKS);
}

/** Obrys wierzchołków `[first, first + count)` geometrii, od y = 0 (budynek stoi na ziemi) do najwyższego wierzchołka. */
function vertexBox(g: BufferGeometry, first: number, count: number): Box3 {
  const pos = g.getAttribute('position');
  const box = new Box3();
  const v = new Vector3();
  for (let i = first; i < first + count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i));
  box.min.y = 0;
  return box;
}

/** Atlas, z którego zbudowano geometrię chunku: `setFront` bierze z niego komórki. */
const atlasOf = new WeakMap<BufferGeometry, Pick<FacadeAtlas, 'cell'>>();
let fallbackAtlas: Pick<FacadeAtlas, 'cell'> | null = null;

/**
 * Geometrie chunków (rosnąco po numerze, tylko chunki z budynkami): pozycja, normalna, UV atlasu i kolor wierzchołków, bez indeksu
 * (6 wierzchołków na czworokąt, jak `GeomBuilder`). UV i kolor są dynamiczne (`setFront`). Budynki leżą w kolejności planów.
 */
export function buildChunkGeometries(city: CityState, plans: readonly BuildingPlan[], atlas: Pick<FacadeAtlas, 'cell'>): ChunkGeometry[] {
  const cells = new Map<AtlasCellName, UV>();
  const cell = (name: AtlasCellName): UV => {
    let uv = cells.get(name);
    if (!uv) { uv = atlas.cell(name); cells.set(name, uv); }
    return uv;
  };
  const tynk = cell('tynk');
  const flat: [number, number] = [(tynk[0] + tynk[2]) / 2, (tynk[1] + tynk[3]) / 2];
  const byChunk = new Map<number, BuildingPlan[]>();
  for (const p of plans) {
    const k = chunkOf(p);
    const list = byChunk.get(k);
    if (list) list.push(p); else byChunk.set(k, [p]);
  }

  const out: ChunkGeometry[] = [];
  for (const chunk of [...byChunk.keys()].sort((a, b) => a - b)) {
    const c: Ctx = { b: new GeomBuilder(flat), cell, flat: [flat[0], flat[1], flat[0], flat[1]], u: CITY_UNIT_M };
    const fronts: ShopFront[] = [];
    const lots: { lotId: number; first: number; count: number }[] = [];
    let station: ChunkGeometry['station'];
    for (const p of byChunk.get(chunk)!) {
      if (p.lotId === null) {
        const first = vertexCount(c.b);
        emitStation(c, p);
        station = { first, count: vertexCount(c.b) - first };
        continue;
      }
      const lot = city.lots[p.lotId];
      if (!lot || lot.id !== p.lotId) throw new RangeError(`buildChunkGeometries: brak lokalu ${p.lotId}`);
      const built = emitLot(c, p, lot);
      fronts.push(built.front);
      lots.push({ lotId: lot.id, first: built.first, count: built.count });
    }
    const geometry = c.b.toGeometry();
    const boxes: ChunkGeometry['boxes'] = lots.map((l) => {
      const box = vertexBox(geometry, l.first, l.count);
      return { ...l, box, top: new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2) };
    });
    (geometry.getAttribute('uv') as BufferAttribute).setUsage(DynamicDrawUsage);
    (geometry.getAttribute('color') as BufferAttribute).setUsage(DynamicDrawUsage);
    geometry.computeBoundingBox();
    atlasOf.set(geometry, atlas);
    out.push(station ? { chunk, geometry, fronts, boxes, station } : { chunk, geometry, fronts, boxes });
  }
  return out;
}

/**
 * Przemalowuje witrynę lokalu: każdy jej czworokąt dostaje całą komórkę `cell` atlasu (UV w kolejności `GeomBuilder.quad`), a każdy
 * wierzchołek kolor `tint` (biel: komórka bez barwy). Zmienia tylko `uv` i `color` w `[first, first + count)`; pozycje zostają.
 * Komórki bierze z atlasu, z którego zbudowano geometrię (`buildChunkGeometries`), a dla obcej geometrii z `createFacadeAtlas()`.
 */
export function setFront(g: BufferGeometry, front: ShopFront, cell: AtlasCellName, tint: Color): void {
  const uv = g.getAttribute('uv') as BufferAttribute;
  const color = g.getAttribute('color') as BufferAttribute;
  const end = front.first + front.count;
  if (front.first < 0 || front.count % 6 !== 0 || end > uv.count) throw new RangeError(`setFront: zły zakres witryny ${front.first}+${front.count}`);
  const atlas = atlasOf.get(g) ?? (fallbackAtlas ??= createFacadeAtlas());
  const [u0, v0, u1, v1] = atlas.cell(cell);
  for (let q = front.first; q < end; q += 6) {
    uv.setXY(q, u0, v0);
    uv.setXY(q + 1, u1, v0);
    uv.setXY(q + 2, u1, v1);
    uv.setXY(q + 3, u0, v0);
    uv.setXY(q + 4, u1, v1);
    uv.setXY(q + 5, u0, v1);
  }
  for (let i = front.first; i < end; i++) color.setXYZ(i, tint.r, tint.g, tint.b);
  uv.needsUpdate = true;
  color.needsUpdate = true;
}
