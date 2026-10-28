import { isNum, isRec, whole, type Rec } from '@/sim/guards';
import type { Cell } from '@/sim/grid';
import {
  type CellType, type Facing, type Fixture, type FixtureKind, type LotKind, type LotSpec, type StoreLayout,
} from './types';

// Zbiory typów zrobione jako `Record<Typ, true>`: dopisanie wartości do unii bez dopisania jej tutaj nie przejdzie tsc.
const CELL_TYPES: Record<CellType, true> = { outside: true, wall: true, window: true, entrance: true, floor: true, backroom: true, fixture: true };
const FIXTURE_KINDS: Record<FixtureKind, true> = {
  gondola: true, wallShelf: true, fridge: true, checkout: true, tobaccoShelf: true, hotFood: true, coffee: true,
  selfCheckoutSlot: true, equipmentSlot: true, backroomDoor: true,
};
const FACINGS: Record<Facing, true> = { N: true, E: true, S: true, W: true };
const LOT_KINDS: Record<LotKind, true> = { blok: true, kamienica: true, pawilon: true };

const isKey = <T extends string>(set: Record<T, true>, v: unknown): v is T => typeof v === 'string' && Object.hasOwn(set, v);

/** Najwięcej kratek w jednym wymiarze: z zapasem większe od największego remontowanego lokalu. */
const MAX_SIDE = 200;

/**
 * Sprawdza układ sklepu wczytany z zapisu (spec §14.1: zapis niesie wygenerowany świat). To kontrola kształtu, a nie
 * wymagań generatora (te mogą się zmieniać między wersjami, a zapis ma nie zależeć od generatora): typy, zakresy, długość
 * siatki, meble i kratki w granicach. Zwraca nowy obiekt albo `null`, gdy układu nie da się użyć.
 */
export function sanitizeLayout(raw: unknown): StoreLayout | null {
  if (!isRec(raw) || !isNum(raw.generatorVersion) || typeof raw.seed !== 'string') return null;
  const width = whole(raw.width, 0);
  const depth = whole(raw.depth, 0);
  if (width !== raw.width || depth !== raw.depth || width < 3 || depth < 3 || width > MAX_SIDE || depth > MAX_SIDE) return null;
  const midWallY = whole(raw.midWallY, -1);
  if (midWallY !== raw.midWallY || midWallY < 1 || midWallY >= depth) return null;

  const lot = lotSpec(raw.lot);
  if (!lot) return null;

  const cells = raw.cells;
  if (!Array.isArray(cells) || cells.length !== width * depth || !cells.every((c) => isKey(CELL_TYPES, c))) return null;

  const inside = (c: unknown): c is Cell => isRec(c) && c.x === whole(c.x, -1) && c.y === whole(c.y, -1)
    && (c.x as number) >= 0 && (c.x as number) < width && (c.y as number) >= 0 && (c.y as number) < depth;
  const cellList = (v: unknown, min: number): Cell[] | null =>
    (Array.isArray(v) && v.length >= min && v.every(inside) ? v.map((c: Cell) => ({ x: c.x, y: c.y })) : null);
  const entrance = cellList(raw.entrance, 1);
  const checkoutQueue = cellList(raw.checkoutQueue, 1);
  const palletZoneOutside = cellList(raw.palletZoneOutside, 0);
  const spawnPoints = cellList(raw.spawnPoints, 1);
  if (!entrance || !checkoutQueue || !palletZoneOutside || !spawnPoints) return null;

  if (!Array.isArray(raw.fixtures)) return null;
  const fixtures: Fixture[] = [];
  for (const f of raw.fixtures) {
    const fixture = fixtureOf(f, width, depth);
    if (!fixture) return null;
    fixtures.push(fixture);
  }

  return {
    generatorVersion: raw.generatorVersion, seed: raw.seed, lot, width, depth, midWallY,
    cells: cells.slice() as CellType[], fixtures, entrance, checkoutQueue, palletZoneOutside, spawnPoints,
  };
}

function lotSpec(v: unknown): LotSpec | null {
  if (!isRec(v) || !isKey(LOT_KINDS, v.kind) || typeof v.corner !== 'boolean') return null;
  const side = (n: unknown): n is number => n === whole(n, -1) && (n as number) >= 0 && (n as number) <= MAX_SIDE;
  if (!side(v.interiorWidth) || !side(v.salesDepth) || !side(v.backroomDepth)) return null;
  return { kind: v.kind, interiorWidth: v.interiorWidth, salesDepth: v.salesDepth, backroomDepth: v.backroomDepth, corner: v.corner };
}

function fixtureOf(v: unknown, width: number, depth: number): Fixture | null {
  if (!isRec(v) || typeof v.id !== 'string' || !isKey(FIXTURE_KINDS, v.kind) || !isKey(FACINGS, v.facing)) return null;
  const ints = intsOf(v, ['x', 'y', 'w', 'd']);
  if (!ints) return null;
  const { x, y, w, d } = ints;
  if (x < 0 || y < 0 || w < 1 || d < 1 || x + w > width || y + d > depth) return null;
  return { id: v.id, kind: v.kind, x, y, w, d, facing: v.facing };
}

function intsOf<K extends string>(v: Rec, keys: readonly K[]): Record<K, number> | null {
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const n = v[k];
    if (!isNum(n) || n !== Math.round(n)) return null;
    out[k] = n;
  }
  return out;
}
