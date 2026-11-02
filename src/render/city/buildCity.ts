import {
  Box3, BufferGeometry, Color, DynamicDrawUsage, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3,
  type BufferAttribute, type Material, type Object3D, type Raycaster,
} from 'three';
import { BLOCK_M } from '@/sim/city/districts';
import { SLOT_M, STREET_HALF_M } from '@/sim/city/generateCity';
import { CITY_SIZE, type CityLot, type CityState, type DistrictId, type LotState, type StreetSegment } from '@/sim/city/types';
import type { LotKind } from '@/sim/store/types';
import { ISO_PITCH_DEG } from '@/render/cameraRig';
import type { TimeOfDay } from '@/render/lighting';
import { createFacadeAtlas, type AtlasCellName } from '@/render/street/facadeAtlas';
import { PALETTE } from '@/render/style';
import { buildChunkGeometries, planCityBuildings, setFront, type ShopFront } from './cityBuildings';
import { CITY_M, CITY_UNIT_M, cityToWorld, unit } from './cityCoords';

export { CITY_UNIT_M, cityToWorld };

/**
 * Scena miasta (spec §9.1, §19): makieta 3D i dwie warstwy danych („Ruch”, „Dzielnice”) na jednej geometrii. Bez cieni, aut i drzew
 * (te dokłada Zadanie 12); cała scena to 2 siatki ziemi (tło kwartałów, ulice) i do 9 siatek z budynkami (chunk 2 × 2 kwartały), czyli
 * kilkanaście wywołań rysowania zamiast budżetu 60.
 *
 * Dwie szczegółowości (`CityDetail`), w każdej chwili jedna geometria:
 * - `prosty` (4a.1): niskie, wybielone bryły postawione na slocie każdego lokalu, tylko warstwy. Kolory (ruch, dzielnice, stan lokalu)
 *   siedzą w kolorach wierzchołków, więc warstwy i stany zmieniają tylko bufor koloru, nigdy geometrię ani materiał.
 * - `pelny` (4a.2): bryły makiety z `cityBuildings.ts` (fasady z atlasu elewacji ulicy). Tryb zmienia materiał, bufor koloru i `scale.y`
 *   chunków, a geometrii nie rusza: makieta ma `MeshStandardMaterial` z atlasem (jak budynki ulicy) i barwy budynków, warstwy ten sam
 *   materiał bez świateł co `prosty`, biel z barwą stanu lokalu i budynki spłaszczone do `FLAT_SCALE`. Witryna parteru każdego lokalu
 *   pokazuje jego stan (kartka „DO WYNAJĘCIA”, kartka „po Traszce”, barwa sklepu, tynk budowy; `setFront`).
 *
 * Warstwy mają materiał bez świateł (`MeshBasicMaterial`, cieniowanie ścian wypieczone w kolorach): gra przełącza słońce i niebo wg
 * godziny (noc 20:00–6:00), a mapa danych ma wyglądać tak samo o każdej porze, żeby żółć i czerwień ruchu nie ciemniały ani nie
 * niebieściały. Makieta jest oświetlona jak ulica przed sklepem i nocą zapala okna (`setTimeOfDay`).
 *
 * Układ: jednostka sceny to `CITY_UNIT_M` metrów miasta, środek miasta leży w (0, 0), x miasta to x sceny, a y miasta to z sceny (jak
 * `cellToWorld` w sklepie, `cityCoords.ts`). Korzeń stoi w początku układu i się nie przesuwa: `pickLot` liczy w tych samych
 * współrzędnych co promień. Pinezki to elementy HTML (`cityPins.ts`), ich kotwice daje `pinAnchors`. Scena nie importuje firmy:
 * stany lokali dostaje gotowe.
 */

export type CityLayer = 'makieta' | 'ruch' | 'dzielnice';
/** `prosty`: bryły z 4a.1 (tylko warstwy); `pelny`: bryły makiety z Zadania 10 (makieta i spłaszczone warstwy). */
export type CityDetail = 'prosty' | 'pelny';
/** Spłaszczenie budynków `pelny` w warstwach (`scale.y` chunków): wieża 49 m ma wtedy ok. 0,4 jednostki, mniej niż najwyższe bryły 4a.1 (0,58). */
export const FLAT_SCALE = 0.25;

/** Granice miasta na scenie razem z ulicami brzegowymi; kamera ogranicza do nich przesuwanie. */
export const CITY_BOUNDS: Readonly<{ minX: number; minZ: number; maxX: number; maxZ: number }> = (() => {
  const half = (CITY_M / 2 + STREET_HALF_M) / CITY_UNIT_M;
  return { minX: -half, minZ: -half, maxX: half, maxZ: half };
})();

/** Zapas na pinezki i etykiety nad dachami oraz na brzegi ekranu: miasto zajmuje najwyżej tyle ekranu, ile podaje `cityFitViewSize`, podzielone przez ten zapas. */
const FIT_MARGIN = 1.1;
/** Najwyższy budynek warstw w jednostkach sceny (`HEIGHT` biurowców +15%); kadr warstw liczy się z tej wysokości (`CityView.fitHeight`). */
const FIT_ROOF = 0.6;

/**
 * Wysokość widoku kamery (`CameraRig.viewSize`, jednostki sceny), przy której całe miasto mieści się w prostokącie `visW` × `visH` px
 * okna o wysokości `canvasH` px, gdy kamera celuje w środek miasta i środek miasta stoi w środku tego prostokąta (przy każdym obrocie
 * o 90°; rzut izometryczny widzi kwadrat jako romb o przekątnej `bok · √2`). Poziomy ekran mieści się w `VIEW_SIZE_MAX`, telefon w pionie
 * potrzebuje ok. dwa razy więcej, dlatego ekran Miasta podnosi limit zoomu (`CameraRig.setViewMax`). `roof`: najwyższy punkt sceny
 * (`CityView.fitHeight`); domyślnie kadr warstw z 4a.1, makieta z wieżami potrzebuje więcej.
 */
export function cityFitViewSize(visW: number, visH: number, canvasH: number, roof: number = FIT_ROOF): number {
  const side = CITY_BOUNDS.maxX - CITY_BOUNDS.minX;
  const pitch = (ISO_PITCH_DEG * Math.PI) / 180;
  const spanW = side * Math.SQRT2;
  const spanH = side * Math.SQRT2 * Math.sin(pitch) + 2 * roof * Math.cos(pitch);
  return canvasH * Math.max(spanW / Math.max(1, visW), spanH / Math.max(1, visH)) * FIT_MARGIN;
}

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
/** Ziemia makiety: park zielony, wnętrza kwartałów jasny bruk (podwórka, place), ulice asfalt, jak ulica przed sklepem. */
const PARK_MAKIETA = PALETTE.street.grass[0]!;
const BLOCK_MAKIETA = PALETTE.street.sidewalk[2]!;
const STREET_MAKIETA = PALETTE.street.asphalt[0]!;
/** Świecenie okien makiety nocą: te same barwa i siła co budynki ulicy (`WINDOW_GLOW` w `street/buildings.ts`). */
const WINDOW_GLOW = { color: '#ffd28a', night: 1.1 } as const;
/** Kolory skali ruchu w warstwie „Ruch” (legenda ekranu Miasta rysuje z nich pasek). */
export const TRAFFIC_QUIET = PALETTE.productCategory.przekaski[0]!;   // żółty
export const TRAFFIC_BUSY = PALETTE.productCategory.napoje[0]!;       // czerwony
/** Średnia doba natężenia (0–255), od której odcinek jest cały czerwony. Skala stała jak w traffic.ts: najruchliwszy odcinek ma 70–100. */
const TRAFFIC_FULL = 100;
/**
 * Cieniowanie budynku wypieczone w kolorach (materiał jest bez świateł): dach i dwie pary ścian. W rzucie izometrycznym widać
 * zawsze po jednej ścianie ±z i ±x, więc przy każdym obrocie kamery dwie różnią się jasnością. Dach ma 0,88 bieli, żeby luminancja
 * zostawała poniżej progu bloomu (0,9 w post.ts) także przy ekspozycji nocy, a jasne sklepy nie zaczęły świecić.
 */
const SHADE = { roof: 0.88, wallZ: 0.88 * 0.88, wallX: 0.88 * 0.76 } as const;

/** Barwa sieci konkurencji: Szop 24h pomarańczowy, Kawka Express fioletowa (jak pinezki). */
const rivalColor = (brand: CityLot['brand']): string => (brand === 'kawka' ? PALETTE.clothes[6]! : PALETTE.brand.orange);

/** Barwa budynku lokalu wg stanu (mieszana z bielą budynku): kolory pinezek, żeby mapa czytała się też bez nich. */
function lotTint(state: LotState, brand: CityLot['brand']): { color: string; amount: number } | null {
  switch (state) {
    case 'twoj': return { color: PALETTE.brand.green, amount: 0.6 };
    case 'konkurencja': return { color: rivalColor(brand), amount: 0.55 };
    case 'wolny': return { color: PALETTE.productCategory.przekaski[0]!, amount: 0.4 };
    case 'budowa': return { color: PALETTE.brand.orange, amount: 0.35 };
    case 'po-traszce': return { color: PALETTE.floor[3]!, amount: 0.5 };
    case 'obok': return { color: PALETTE.brand.green, amount: 0.2 };
    case 'zajety': return null;
  }
}

/**
 * Witryna parteru lokalu w makiecie wg stanu: komórka atlasu i barwa (null: komórka bez barwy). Wolny lokal i lokal obok mają tę samą
 * kartkę co na ulicy (§7.2), lokal po Traszce kartkę z dopiskiem, budowa zabity tynkiem pomarańczowy front.
 */
function frontLook(state: LotState, brand: CityLot['brand']): { cell: AtlasCellName; tint: string | null } {
  switch (state) {
    case 'wolny':
    case 'obok': return { cell: 'witrynaWynajem', tint: null };
    case 'po-traszce': return { cell: 'witrynaPoTraszce', tint: null };
    case 'twoj': return { cell: 'witryna', tint: PALETTE.brand.green };
    case 'konkurencja': return { cell: 'witryna', tint: rivalColor(brand) };
    case 'budowa': return { cell: 'tynk', tint: PALETTE.brand.orange };
    case 'zajety': return { cell: 'witryna', tint: null };
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
/**
 * Kotwica pinezki leży tyle nad najwyższym punktem budynku lokalu przy bieżącej skali (`pelny`: z nadbudówką, z prawdziwych
 * wierzchołków, więc w makiecie pinezka stoi nad wieżą, a w warstwach nad spłaszczonym dachem).
 */
const ANCHOR_LIFT = 0.04;

const CHUNK_BLOCKS = 2;
const CHUNKS_PER_SIDE = Math.ceil(CITY_SIZE / CHUNK_BLOCKS);
const VERTS_PER_BOX = 20;   // dach i cztery ściany, bez spodu

export interface CityView {
  root: Group;
  /** Szczegółowość geometrii: stała przez całe życie widoku (inna to nowy widok). */
  readonly detail: CityDetail;
  /** Czy ten widok umie tryb: `prosty` nie umie makiety (scena buduje wtedy `pelny`). */
  supports(layer: CityLayer): boolean;
  /**
   * „Makieta”: bryły makiety w barwach budynków, ziemia jak ulica (tylko `pelny`); „Ruch”: ulice w kolorze natężenia, tło kwartałów
   * neutralne; „Dzielnice”: tło w kolorze dzielnicy, ulice jasne. Warstwy na `pelny` spłaszczają budynki do `FLAT_SCALE`. `prosty`
   * poproszony o makietę rysuje „Ruch” (wołający sprawdza `supports`).
   */
  setLayer(layer: CityLayer): void;
  /**
   * Stany lokali w grze: barwią budynki w warstwach, ustawiają witryny makiety i wyznaczają, które lokale mają kotwicę pinezki
   * (wszystkie poza zwykłym `zajety`). Brak wpisu to stan z generatora.
   */
  setLots(states: Record<number, LotState>): void;
  /** Punkty nad dachami lokali z pinezką, we współrzędnych sceny, przy bieżącym trybie (spłaszczenie). */
  pinAnchors(): { lotId: number; world: Vector3 }[];
  /** Lokal pod promieniem (najbliższy trafiony, bryły w bieżącej skali) albo null. */
  pickLot(ray: Raycaster): number | null;
  /**
   * Najwyższy punkt sceny w bieżącym trybie (jednostki sceny), nie mniej niż kadr warstw z 4a.1: wysokość dla `cityFitViewSize`.
   * Makieta liczy go z prawdziwych brył (wieże biurowców, wieża dworca), warstwy zostają przy kadrze z 4a.1.
   */
  fitHeight(): number;
  /** Pora dnia: nocą okna makiety świecą jak na ulicy; warstwy i `prosty` wyglądają tak samo o każdej porze. */
  setTimeOfDay(tod: TimeOfDay): void;
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

/** Bryła lokalu do kotwic, wyboru i barwienia: obrys i wysokość bez skali siatki. */
interface LotBox {
  lot: CityLot;
  /** Obrys bryły (y od 0 do najwyższego wierzchołka budynku), bez `scale.y` siatki. */
  box: Box3;
  /** Środek dachu na wysokości `box.max.y`. */
  top: Vector3;
  /** Siatka chunku z budynkiem. */
  mesh: Mesh;
  /** Ciąg wierzchołków budynku w geometrii chunku (`prosty`: 20, dach i ściany). */
  first: number;
  count: number;
  /** Biel budynku z odrobiną zmienności. */
  base: Color;
}

/** Bufory kolorów jednego chunku `pelny`: makieta (barwy budynków, witryny wg stanu) i warstwy (biel z barwą stanu, cieniowanie). */
interface ChunkColors {
  mesh: Mesh;
  makieta: Float32Array;
  flat: Float32Array;
  /** Cieniowanie warstw wypieczone na wierzchołek (`SHADE` wg normalnej). */
  shade: Float32Array;
  fronts: { front: ShopFront; lot: CityLot }[];
  lots: LotBox[];
}

/** `SHADE` dla każdego wierzchołka wg normalnej: dach (i połacie), ściany ±z, ściany ±x. */
function bakedShade(g: BufferGeometry): Float32Array {
  const nor = g.getAttribute('normal');
  const out = new Float32Array(nor.count);
  for (let i = 0; i < nor.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const nz = Math.abs(nor.getZ(i));
    out[i] = nor.getY(i) > 0.5 ? SHADE.roof : nz >= nx ? SHADE.wallZ : SHADE.wallX;
  }
  return out;
}

/** Wierzchołki `[first, first + count)` w buforze warstw: kolor `c` razy wypieczone cieniowanie. */
function paintRange(out: Float32Array, shade: Float32Array, first: number, count: number, c: Color): void {
  for (let i = first; i < first + count; i++) {
    out[i * 3] = c.r * shade[i]!;
    out[i * 3 + 1] = c.g * shade[i]!;
    out[i * 3 + 2] = c.b * shade[i]!;
  }
}

/** Obrys wierzchołków `[first, first + count)` (y od 0). */
function rangeBox(g: BufferGeometry, first: number, count: number): Box3 {
  const pos = g.getAttribute('position');
  const box = new Box3();
  const v = new Vector3();
  for (let i = first; i < first + count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i));
  box.min.y = 0;
  return box;
}

/** Biel budynku lokalu (0,95–1,0 bieli wg numeru), wspólna dla obu szczegółowości. */
const baseWhite = (lot: CityLot): Color => new Color(BUILDING_WHITE).multiplyScalar(0.95 + 0.05 * unit(lot.id + 7919));
/** Biel budynku z barwą stanu lokalu. */
function tinted(rec: LotBox, state: LotState): Color {
  const tint = lotTint(state, rec.lot.brand);
  return tint ? rec.base.clone().lerp(new Color(tint.color), tint.amount) : rec.base;
}

export function buildCity(city: CityState, states: Record<number, LotState>, opts: { detail?: CityDetail } = {}): CityView {
  const detail: CityDetail = opts.detail ?? 'prosty';
  const full = detail === 'pelny';
  const root = new Group();
  root.name = 'city';
  const surface = new MeshBasicMaterial({ name: 'city:warstwy', vertexColors: true });   // bez świateł: dane na mapie wyglądają tak samo o każdej porze doby
  const atlas = full ? createFacadeAtlas() : null;
  // makieta: jak budynki ulicy (atlas koloru i emissive okien); tekstury atlasu są wspólne (cache), więc ich nie zwalniamy
  const lit = atlas
    ? new MeshStandardMaterial({
      name: 'city:makieta', map: atlas.map, vertexColors: true, roughness: 0.85, metalness: 0,
      emissiveMap: atlas.emissive, emissive: new Color(WINDOW_GLOW.color), emissiveIntensity: 0,
    })
    : null;
  const geometries: BufferGeometry[] = [];
  const meshes: Mesh[] = [];
  const add = (name: string, g: BufferGeometry): Mesh => {
    geometries.push(g);
    const mesh = new Mesh(g, surface);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    root.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  /** UV ziemi makiety: punkt w środku komórki `tynk` (bez faktury, jak bryły bez faktury w `cityBuildings.ts`). */
  const flatUv = (g: BufferGeometry): void => {
    if (!atlas) return;
    const [u0, v0, u1, v1] = atlas.cell('tynk');
    const n = g.getAttribute('position').count;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uv[i * 2] = (u0 + u1) / 2; uv[i * 2 + 1] = (v0 + v1) / 2; }
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
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
  const blockGeometry = blocks.geometry();
  flatUv(blockGeometry);
  const blockMesh = add('blocks', blockGeometry);
  const blockColors: Record<CityLayer, Float32Array> = {
    makieta: colorsOf((i) => new Color(city.blocks[i] === 'park' ? PARK_MAKIETA : BLOCK_MAKIETA), city.blocks.length),
    ruch: colorsOf((i) => new Color(city.blocks[i] === 'park' ? PARK_RUCH : BLOCK_NEUTRAL), city.blocks.length),
    dzielnice: colorsOf((i) => new Color(DISTRICT_COLOR[city.blocks[i]!]), city.blocks.length),
  };

  // ulice: jeden czworokąt na odcinek, w kolejności `city.streets` (cztery wierzchołki na odcinek)
  const streets = new Mesher();
  for (const s of city.streets) {
    const [x0, y0, x1, y1] = streetRect(s);
    flat(streets, x0, y0, x1, y1, new Color());
  }
  const streetGeometry = streets.geometry();
  flatUv(streetGeometry);
  const streetMesh = add('streets', streetGeometry);
  const streetColors: Record<CityLayer, Float32Array> = {
    makieta: colorsOf(() => new Color(STREET_MAKIETA), city.streets.length),
    ruch: colorsOf((i) => trafficColor(city.streets[i]!.hourly), city.streets.length),
    dzielnice: colorsOf(() => new Color(STREET_NEUTRAL), city.streets.length),
  };

  // budynki: sklejone w jedną geometrię na chunk 2 × 2 kwartały
  const boxes: LotBox[] = [];
  const chunkMeshes: Mesh[] = [];
  const chunkColors: ChunkColors[] = [];
  /** Najwyższy wierzchołek wszystkich brył (bez skali): kadr makiety. */
  let sceneTop = 0;
  if (atlas) {
    // `pelny`: bryły makiety; kolory makiety to kolory z budowy, kolory warstw liczą się z normalnych i stanów lokali
    const white = new Color(BUILDING_WHITE);
    for (const c of buildChunkGeometries(city, planCityBuildings(city), atlas)) {
      const g = c.geometry;
      const mesh = add(`chunk:${c.chunk}`, g);
      chunkMeshes.push(mesh);
      sceneTop = Math.max(sceneTop, g.boundingBox!.max.y);
      const n = g.getAttribute('position').count;
      const shade = bakedShade(g);
      const colors: ChunkColors = {
        mesh, shade, makieta: (g.getAttribute('color').array as Float32Array).slice(), flat: new Float32Array(n * 3),
        fronts: c.fronts.map((front) => ({ front, lot: city.lots[front.lotId]! })), lots: [],
      };
      if (c.station) paintRange(colors.flat, shade, c.station.first, c.station.count, white);
      for (const b of c.boxes) {
        const lot = city.lots[b.lotId]!;
        const box = rangeBox(g, b.first, b.count);
        const rec: LotBox = {
          lot, box, top: new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2),
          mesh, first: b.first, count: b.count, base: baseWhite(lot),
        };
        boxes.push(rec);
        colors.lots.push(rec);
      }
      chunkColors.push(colors);
    }
  } else {
    // `prosty`: bryła na slocie każdego lokalu
    const meshers = new Map<number, Mesher>();
    const pending: (Omit<LotBox, 'mesh'> & { chunk: number })[] = [];
    for (const lot of city.lots) {
      const chunk = Math.floor(lot.by / CHUNK_BLOCKS) * CHUNKS_PER_SIDE + Math.floor(lot.bx / CHUNK_BLOCKS);
      let mesher = meshers.get(chunk);
      if (!mesher) { mesher = new Mesher(); meshers.set(chunk, mesher); }
      const fp = FOOTPRINT_M[lot.spec.kind];
      const north = lot.y - lot.by * BLOCK_M < BLOCK_M / 2;   // pierzeja północna: budynek rośnie na południe od ulicy
      const a = cityToWorld(lot.x - fp.w / 2, north ? lot.y : lot.y - fp.d);
      const b = cityToWorld(lot.x + fp.w / 2, north ? lot.y + fp.d : lot.y);
      const h = HEIGHT[lot.district] * (0.85 + 0.3 * unit(lot.id));
      const base = baseWhite(lot);
      const first = mesher.vertices;
      mesher.box(a.x, b.x, a.z, b.z, h, shadesOf(base));
      pending.push({
        lot, box: new Box3(new Vector3(a.x, 0, a.z), new Vector3(b.x, h, b.z)), top: new Vector3((a.x + b.x) / 2, h, (a.z + b.z) / 2),
        chunk, first, count: VERTS_PER_BOX, base,
      });
    }
    const byChunk = new Map<number, Mesh>();
    for (const [chunk, mesher] of [...meshers].sort((p, q) => p[0] - q[0])) {
      const mesh = add(`chunk:${chunk}`, mesher.geometry());
      byChunk.set(chunk, mesh);
      chunkMeshes.push(mesh);
    }
    for (const { chunk, ...rec } of pending) boxes.push({ ...rec, mesh: byChunk.get(chunk)! });
  }

  // --- stan ---------------------------------------------------------------------------------------------------------

  let current: Record<number, LotState> = states;
  let layer: CityLayer = 'ruch';
  let disposed = false;
  const stateOf = (l: CityLot): LotState => current[l.id] ?? l.state;
  /** `scale.y` chunków w bieżącym trybie: warstwy `pelny` są spłaszczone. */
  const scaleY = (): number => (full && layer !== 'makieta' ? FLAT_SCALE : 1);

  /** `prosty`: dach i ściany bryły lokalu w kolorach stanu (kolejność ścian jak w `Mesher.box`). */
  const paintSimple = (rec: LotBox): void => {
    const shades = shadesOf(tinted(rec, stateOf(rec.lot)));
    const attr = rec.mesh.geometry.getAttribute('color');
    for (let v = 0; v < VERTS_PER_BOX; v++) {
      const c = v < 4 ? shades.roof : v < 12 ? shades.wallZ : shades.wallX;
      attr.setXYZ(rec.first + v, c.r, c.g, c.b);
    }
  };
  /**
   * `pelny`: witryny makiety wg stanu (`setFront` pisze w bieżący bufor geometrii, więc na chwilę wkładamy tam bufor makiety), budynki
   * warstw w bieli z barwą stanu, a do geometrii wraca bufor bieżącego trybu. Pozycje i normalne zostają.
   */
  const paintFull = (ch: ChunkColors): void => {
    const g = ch.mesh.geometry;
    const attr = g.getAttribute('color') as BufferAttribute;
    const live = attr.array as Float32Array;
    live.set(ch.makieta);
    for (const { front, lot } of ch.fronts) {
      const look = frontLook(stateOf(lot), lot.brand);
      setFront(g, front, look.cell, new Color(look.tint ?? '#ffffff'));
    }
    ch.makieta.set(live);
    for (const rec of ch.lots) paintRange(ch.flat, ch.shade, rec.first, rec.count, tinted(rec, stateOf(rec.lot)));
    live.set(layer === 'makieta' ? ch.makieta : ch.flat);
    attr.needsUpdate = true;
  };
  const paintAll = (): void => {
    if (full) {
      for (const ch of chunkColors) paintFull(ch);
      return;
    }
    for (const rec of boxes) paintSimple(rec);
    for (const m of chunkMeshes) m.geometry.getAttribute('color').needsUpdate = true;
  };
  const paintGround = (): void => {
    blockMesh.geometry.getAttribute('color').array.set(blockColors[layer]);
    blockMesh.geometry.getAttribute('color').needsUpdate = true;
    streetMesh.geometry.getAttribute('color').array.set(streetColors[layer]);
    streetMesh.geometry.getAttribute('color').needsUpdate = true;
  };
  /** Materiał, bufory kolorów budynków i spłaszczenie wg trybu (`pelny`); geometria zostaje ta sama. */
  const applyMode = (): void => {
    if (!full) return;
    const material = layer === 'makieta' && lit ? lit : surface;
    for (const m of meshes) m.material = material;
    for (const m of chunkMeshes) m.scale.y = scaleY();
    for (const ch of chunkColors) {
      const attr = ch.mesh.geometry.getAttribute('color');
      attr.array.set(layer === 'makieta' ? ch.makieta : ch.flat);
      attr.needsUpdate = true;
    }
  };
  paintGround();
  paintAll();
  applyMode();

  return {
    root,
    detail,
    supports: (l) => full || l !== 'makieta',
    setLayer(next) {
      layer = full || next !== 'makieta' ? next : 'ruch';
      paintGround();
      applyMode();
    },
    setLots(next) {
      current = next;
      paintAll();
    },
    pinAnchors() {
      const s = scaleY();
      return boxes
        .filter((r) => stateOf(r.lot) !== 'zajety')
        .map((r) => ({ lotId: r.lot.id, world: new Vector3(r.top.x, r.top.y * s + ANCHOR_LIFT, r.top.z) }));
    },
    pickLot(ray) {
      const s = scaleY();
      const box = new Box3();
      const hit = new Vector3();
      let best: number | null = null;
      let bestAt = Infinity;
      for (const r of boxes) {
        box.copy(r.box);
        box.max.y = r.box.max.y * s;
        if (!ray.ray.intersectBox(box, hit)) continue;
        const d = hit.distanceTo(ray.ray.origin);
        if (d < ray.near || d > ray.far || d >= bestAt) continue;
        best = r.lot.id;
        bestAt = d;
      }
      return best;
    },
    fitHeight: () => Math.max(FIT_ROOF, sceneTop * scaleY()),
    setTimeOfDay(tod) {
      if (lit) lit.emissiveIntensity = tod === 'night' ? WINDOW_GLOW.night : 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const g of geometries) g.dispose();
      surface.dispose();
      lit?.dispose();
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
