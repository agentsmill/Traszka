import { createRng, subSeed, type Rng } from '@/sim/rng';
import { generateStore } from '@/sim/store/generateStore';
import { LOT_RANGES, pickLot } from '@/sim/store/lots';
import { takeoverSide } from '@/sim/store/takeover';
import type { LotSpec } from '@/sim/store/types';
import { BLOCK_M, DISTRICTS } from './districts';
import { CITY_HEADS, CITY_TAILS, STREET_NAMES } from './names';
import {
  CITY_GENERATOR_VERSION,
  CITY_SIZE,
  type CityLot,
  type CityState,
  type DistrictId,
  type RivalBrand,
  type StoreDistrict,
  type StreetSegment,
} from './types';

/*
 * Generator miasta (spec §7.1, §7.2): czysta funkcja seeda. Jeden strumień `createRng(subSeed(seed, 'city'))`, kolejność losowań:
 * nazwa miasta, nazwy ulic, podział na dzielnice, specyfikacje lokali, lokal startowy, wolne lokale, konkurencja. Punkty ruchu i
 * natężenie ulic (`sources`, `hourly`) mają dopisać swoje losowania na końcu strumienia, żeby lokale się nie przesuwały.
 *
 * Siatka: ulice biegną co `BLOCK_M` (linie x = i·BLOCK_M i y = j·BLOCK_M, i, j = 0…CITY_SIZE), kwartał (bx, by) leży między liniami
 * bx…bx+1 i by…by+1. Każdy kwartał z lokalami ma dwie pierzeje wzdłuż ulic poziomych: północną (front na północ, przy linii y = by·BLOCK_M)
 * i południową (front na południe, przy linii y = (by+1)·BLOCK_M), po `LOTS_PER_ROW` lokali co `SLOT_M` metrów. Rząd lokali to
 * (kwartał, pierzeja); ulica poprzeczna kończy rząd, więc lokal na końcu rzędu nie ma sąsiada po tej stronie.
 */

/** Pół szerokości ulicy (m): wejście lokalu leży tyle od osi ulicy, przy której stoi. */
export const STREET_HALF_M = 5;
/** Lokali w jednym rzędzie i odstęp ich wejść (m): 2 · STREET_HALF_M + LOTS_PER_ROW · SLOT_M = BLOCK_M. */
export const LOTS_PER_ROW = 4;
export const SLOT_M = 25;
const HOURS_PER_DAY = 24;

const STORE_DISTRICTS: readonly StoreDistrict[] = ['osiedle', 'srodmiescie', 'dworzec', 'biurowce'];
const MIN_DISTRICT_BLOCKS = 5;
const PARK_MAX_BLOCKS = 3;
const FREE_LOTS: readonly [number, number] = [5, 8];
const RIVAL_LOTS: readonly [number, number] = [3, 5];
/** Konkurencja nie stoi bliżej startu niż tyle kwartałów (w poziomie albo w pionie, liczy większa z odległości). */
const RIVAL_MIN_BLOCKS = 2;
/** Pakiet każdego lokalu poza narożną kamienicą sięga najwyżej tej części widełek dzielnicy; narożna kamienica ma całą górną granicę. */
const PACKAGE_SHARE = 0.9;
const PACKAGE_STEP = 100;

type Side = 'minX' | 'maxX';

const blockOf = (l: Pick<CityLot, 'bx' | 'by'>): number => l.by * CITY_SIZE + l.bx;

// --- Dzielnice -----------------------------------------------------------------------------------------------

/** Kwartały jeszcze bez dzielnicy, które sąsiadują bokiem z kwartałem tej dzielnicy. */
function frontier(blocks: readonly (DistrictId | null)[], district: DistrictId): number[] {
  const out: number[] = [];
  blocks.forEach((owner, i) => {
    if (owner !== null) return;
    const bx = i % CITY_SIZE;
    const by = Math.floor(i / CITY_SIZE);
    const near = [bx > 0 ? i - 1 : -1, bx < CITY_SIZE - 1 ? i + 1 : -1, by > 0 ? i - CITY_SIZE : -1, by < CITY_SIZE - 1 ? i + CITY_SIZE : -1];
    if (near.some((j) => j >= 0 && blocks[j] === district)) out.push(i);
  });
  return out;
}

/**
 * Jedna próba podziału: każda z czterech dzielnic startuje w innej ćwiartce miasta, park w dowolnym wolnym kwartale, potem w
 * kolejnych turach każdy obszar dobiera sobie losowy kwartał z brzegu (park najwyżej do `PARK_MAX_BLOCKS`). Obszar rośnie tylko
 * przez sąsiedztwo, więc jest spójny z konstrukcji. Zwraca null, gdy któryś kwartał został bez dzielnicy albo jakaś dzielnica jest za mała.
 */
function growDistricts(rng: Rng): DistrictId[] | null {
  const blocks: (DistrictId | null)[] = new Array<DistrictId | null>(CITY_SIZE * CITY_SIZE).fill(null);
  const half = CITY_SIZE / 2;
  rng.shuffle(STORE_DISTRICTS).forEach((district, quarter) => {
    const bx = (quarter % 2) * half + rng.int(0, half);
    const by = Math.floor(quarter / 2) * half + rng.int(0, half);
    blocks[by * CITY_SIZE + bx] = district;
  });
  blocks[rng.pick(blocks.map((b, i) => (b === null ? i : -1)).filter((i) => i >= 0))] = 'park';
  let parkLeft = rng.int(0, PARK_MAX_BLOCKS);   // dodatkowe kwartały parku: 0–2
  for (let grew = true; grew;) {
    grew = false;
    for (const district of rng.shuffle<DistrictId>([...STORE_DISTRICTS, 'park'])) {
      if (district === 'park' && parkLeft === 0) continue;
      const edge = frontier(blocks, district);
      if (edge.length === 0) continue;
      blocks[rng.pick(edge)] = district;
      if (district === 'park') parkLeft--;
      grew = true;
    }
  }
  if (blocks.includes(null)) return null;
  if (STORE_DISTRICTS.some((d) => blocks.filter((b) => b === d).length < MIN_DISTRICT_BLOCKS)) return null;
  return blocks as DistrictId[];
}

function layoutDistricts(rng: Rng): DistrictId[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const blocks = growDistricts(rng);
    if (blocks) return blocks;
  }
  throw new Error('generateCity: brak podziału na dzielnice');
}

// --- Ulice ---------------------------------------------------------------------------------------------------

/** Odcinki ulic: poziome linie y = j·BLOCK_M (nazwy 0…CITY_SIZE), potem pionowe x = i·BLOCK_M (nazwy CITY_SIZE+1…), każdy odcinek to jeden kwartał. */
function layoutStreets(names: readonly string[]): StreetSegment[] {
  const lines = CITY_SIZE + 1;
  const out: StreetSegment[] = [];
  const hourly = (): number[] => new Array<number>(HOURS_PER_DAY).fill(0);
  for (let j = 0; j < lines; j++) {
    for (let i = 0; i < CITY_SIZE; i++) out.push({ id: out.length, name: names[j]!, ax: i * BLOCK_M, ay: j * BLOCK_M, bx: (i + 1) * BLOCK_M, by: j * BLOCK_M, hourly: hourly() });
  }
  for (let i = 0; i < lines; i++) {
    for (let j = 0; j < CITY_SIZE; j++) out.push({ id: out.length, name: names[lines + i]!, ax: i * BLOCK_M, ay: j * BLOCK_M, bx: i * BLOCK_M, by: (j + 1) * BLOCK_M, hourly: hourly() });
  }
  return out;
}

// --- Lokale --------------------------------------------------------------------------------------------------

/** Cena pakietu otwarcia: rośnie z metrażem (`interiorWidth × salesDepth`) w widełkach dzielnicy, zaokrąglona do 100 zł; narożna kamienica ma górną granicę. */
function openingPackage(spec: LotSpec, district: StoreDistrict): number {
  const [lo, hi] = DISTRICTS[district].package;
  if (spec.kind === 'kamienica' && spec.corner) return hi;
  const r = LOT_RANGES[spec.kind];
  const min = r.interiorWidth[0] * r.salesDepth[0];
  const max = r.interiorWidth[1] * r.salesDepth[1];
  const share = (spec.interiorWidth * spec.salesDepth - min) / (max - min);
  return Math.round((lo + (hi - lo) * PACKAGE_SHARE * share) / PACKAGE_STEP) * PACKAGE_STEP;
}

const isNorthRow = (l: Pick<CityLot, 'by' | 'y'>): boolean => l.y - l.by * BLOCK_M < BLOCK_M / 2;

function neighbourIn(lots: readonly CityLot[], lot: CityLot, side: Side): CityLot | null {
  // maxX na pierzei północnej to wschód, na południowej zachód (patrz `lotNeighbour`)
  const east = isNorthRow(lot) === (side === 'maxX');
  const x = lot.x + (east ? SLOT_M : -SLOT_M);
  return lots.find((o) => o.bx === lot.bx && o.by === lot.by && o.y === lot.y && o.x === x) ?? null;
}

export function lotById(city: CityState, id: number): CityLot {
  const lot = city.lots[id];
  if (!lot || lot.id !== id) throw new RangeError(`lotById: brak lokalu ${id}`);
  return lot;
}

/**
 * Sąsiedni lokal w tym samym rzędzie (ta sama pierzeja tego samego kwartału) po stronie `side` osi X układu sklepu stojącego w
 * lokalu `lotId`, albo null na końcu rzędu (dalej jest ulica poprzeczna).
 *
 * Konwencja osi: układ sklepu ma +x po lewej ręce patrząc na front z ulicy (w scenie ulicy `Face` w `buildings.ts` liczy „w prawo”
 * ku −x), czyli `minX` to prawa ręka od ulicy, a `maxX` lewa. Na pierzei północnej (front na północ) patrzący od ulicy ma
 * wschód po lewej: `maxX` = wschód (+x miasta), `minX` = zachód. Na pierzei południowej (front na południe) odwrotnie:
 * `maxX` = zachód, `minX` = wschód. `takeoverSide` zwraca stronę w tym układzie, więc lokal obok sklepu to
 * `lotNeighbour(city, lotId, takeoverSide(layout, seed))`.
 */
export function lotNeighbour(city: CityState, lotId: number, side: Side): CityLot | null {
  return neighbourIn(city.lots, lotById(city, lotId), side);
}

// --- Miasto --------------------------------------------------------------------------------------------------

/** Czy sklep w tym lokalu da się zbudować (generator sklepu bywa bezradny wobec rzadkiej kombinacji wymiarów). */
function buildable(seed: string, lot: CityLot): boolean {
  try {
    generateStore(subSeed(seed, `store:${lot.id}`), lot.spec);
    return true;
  } catch {
    return false;
  }
}

export function generateCity(seed: string): CityState {
  const rng = createRng(subSeed(seed, 'city'));
  const name = rng.pick(CITY_HEADS) + rng.pick(CITY_TAILS);
  const streetNames = rng.shuffle(STREET_NAMES).slice(0, 2 * (CITY_SIZE + 1));
  const blocks = layoutDistricts(rng);

  // lokale: w każdym kwartale poza parkiem dwie pierzeje po LOTS_PER_ROW; id rosną po kolei w obrębie rzędu
  const lots: CityLot[] = [];
  for (let by = 0; by < CITY_SIZE; by++) {
    for (let bx = 0; bx < CITY_SIZE; bx++) {
      const district = blocks[by * CITY_SIZE + bx]!;
      if (district === 'park') continue;
      const def = DISTRICTS[district];
      const r = LOT_RANGES[def.lotKind];
      for (const row of ['N', 'S'] as const) {
        for (let k = 0; k < LOTS_PER_ROW; k++) {
          const atEnd = k === 0 || k === LOTS_PER_ROW - 1;
          const spec: LotSpec = {
            kind: def.lotKind,
            interiorWidth: rng.int(r.interiorWidth[0], r.interiorWidth[1] + 1),
            salesDepth: rng.int(r.salesDepth[0], r.salesDepth[1] + 1),
            backroomDepth: rng.int(r.backroomDepth[0], r.backroomDepth[1] + 1),
            corner: atEnd && r.cornerChance > 0 && rng.chance(r.cornerChance),   // narożnik tylko na końcu rzędu
          };
          const north = row === 'N';
          lots.push({
            id: lots.length, bx, by,
            x: bx * BLOCK_M + STREET_HALF_M + k * SLOT_M + Math.floor(SLOT_M / 2),
            y: north ? by * BLOCK_M + STREET_HALF_M : (by + 1) * BLOCK_M - STREET_HALF_M,
            street: streetNames[north ? by : by + 1]!,
            number: 2 * (bx * LOTS_PER_ROW + k) + (north ? 2 : 1),   // północna pierzeja leży po południowej stronie ulicy (parzyste), południowa po północnej (nieparzyste)
            spec, district, state: 'zajety', brand: null,
            package: openingPackage(spec, district),
            buildDays: rng.int(def.buildDays[0], def.buildDays[1] + 1),
          });
        }
      }
    }
  }
  const isRowEnd = (l: CityLot): boolean => neighbourIn(lots, l, 'minX') === null || neighbourIn(lots, l, 'maxX') === null;
  const near = (l: CityLot): CityLot[] => [neighbourIn(lots, l, 'minX'), neighbourIn(lots, l, 'maxX')].filter((n): n is CityLot => n !== null);

  // lokal startowy: na Osiedlu, ze specyfikacją sklepu z seeda; narożny stoi na końcu rzędu, zwykły w środku (ma sąsiadów z obu stron)
  const startSpec = pickLot(seed);
  const start = rng.pick(lots.filter((l) => l.district === 'osiedle' && isRowEnd(l) === startSpec.corner));
  start.spec = startSpec;
  start.package = openingPackage(startSpec, 'osiedle');
  start.state = 'twoj';
  const startNear = new Set<CityLot>([start, ...near(start)]);

  // wolne lokale: po jednym w Śródmieściu, na Dworcu i w Biurowcach, reszta dowolna; każdy w innym kwartale (stąd też nie sąsiadują
  // ze sobą w rzędzie), nie obok startu i tylko taki, z którego generator zbuduje sklep
  const freeBlocks = new Set<number>();
  const free: CityLot[] = [];
  const claimFree = (candidates: readonly CityLot[]): boolean => {
    for (const l of rng.shuffle(candidates)) {
      if (startNear.has(l) || freeBlocks.has(blockOf(l)) || !buildable(seed, l)) continue;
      l.state = 'wolny';
      freeBlocks.add(blockOf(l));
      free.push(l);
      return true;
    }
    return false;
  };
  const wanted = rng.int(FREE_LOTS[0], FREE_LOTS[1] + 1);
  for (const d of rng.shuffle<StoreDistrict>(['srodmiescie', 'dworzec', 'biurowce'])) claimFree(lots.filter((l) => l.district === d));
  while (free.length < wanted) if (!claimFree(lots)) break;

  // konkurencja: w dzielnicach o dużym ruchu, każda w innym kwartale, daleko od startu i nie w rzędzie obok wolnego ani startu
  const rivalPool = lots.filter((l) => l.state === 'zajety' && DISTRICTS[l.district].traffic > 1 && !startNear.has(l)
    && Math.max(Math.abs(l.bx - start.bx), Math.abs(l.by - start.by)) >= RIVAL_MIN_BLOCKS
    && near(l).every((n) => n.state !== 'wolny' && n.state !== 'twoj'));
  const rivalBlocks = new Set<number>();
  let brand: RivalBrand = rng.chance(0.5) ? 'szop' : 'kawka';
  const rivalCount = rng.int(RIVAL_LOTS[0], RIVAL_LOTS[1] + 1);
  for (const l of rng.shuffle(rivalPool)) {
    if (rivalBlocks.size === rivalCount) break;
    if (rivalBlocks.has(blockOf(l))) continue;
    l.state = 'konkurencja';
    l.brand = brand;
    brand = brand === 'szop' ? 'kawka' : 'szop';
    rivalBlocks.add(blockOf(l));
  }

  // lokal obok: sąsiad po stronie, w którą rośnie sklep startowy (remont „dokupienie lokalu obok”); przy narożniku go nie ma
  const side = takeoverSide(generateStore(seed), seed);
  const neighbour = side === null ? null : neighbourIn(lots, start, side);
  if (neighbour) neighbour.state = 'obok';

  return {
    version: CITY_GENERATOR_VERSION,
    name,
    blocks,
    streets: layoutStreets(streetNames),
    sources: [],
    lots,
    startLotId: start.id,
    neighbourLotId: neighbour?.id ?? null,
  };
}
