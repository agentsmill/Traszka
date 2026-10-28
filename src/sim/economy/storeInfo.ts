import { staffStripCells } from '@/sim/crowd/crowd';
import type { Cell } from '@/sim/grid';
import { FRONT_WALL_Y, type Fixture, type LotKind, type StoreLayout } from '@/sim/store/types';
import { accessCells, isWalkable } from '@/sim/store/validate';
import { CAPACITY, CATS, CAT_INFO, type Cat } from './catalog';

/** Miejsce na paletę: kwadrat 2×2 kratki, `x`/`y` to jego lewy-przedni róg. */
export interface PalletSpot { x: number; y: number }
export type PalletLoc = 'sidewalk' | 'backroom' | 'floor';

export interface SlotInfo {
  id: string;
  /** 1 dla slotu kasy samoobsługowej (2×1), 2 dla slotu sprzętu (2×2). */
  capacity: 1 | 2;
  fixture: Fixture;
}

/** Wszystko, co ekonomia musi wiedzieć o układzie sklepu. Liczone raz na układ (po remoncie od nowa). */
export interface StoreInfo {
  lotKind: LotKind;
  shelfCap: Record<Cat, number>;
  shelfCapTotal: number;
  backroomCap: number;
  slots: SlotInfo[];
  spots: Record<PalletLoc, PalletSpot[]>;
  /** Powierzchnia sali w kratkach (do mediów i do skali ruchu). */
  salesCells: number;
}

const FLOOR_SPOTS_MAX = 3;
const BACKROOM_SPOTS_MAX = 8;

const squareCells = (s: PalletSpot): Cell[] => [
  { x: s.x, y: s.y }, { x: s.x + 1, y: s.y }, { x: s.x, y: s.y + 1 }, { x: s.x + 1, y: s.y + 1 },
];

export function spotCells(s: PalletSpot): Cell[] {
  return squareCells(s);
}

export function computeStoreInfo(layout: StoreLayout): StoreInfo {
  const cellsOf = (kind: Fixture['kind']): number =>
    layout.fixtures.filter((f) => f.kind === kind).reduce((n, f) => n + f.w * f.d, 0);
  const fridge = cellsOf('fridge') * CAPACITY.fridge;
  const dry = cellsOf('gondola') * CAPACITY.gondola + cellsOf('wallShelf') * CAPACITY.wallShelf;
  const shelfCap = {} as Record<Cat, number>;
  for (const c of CATS) shelfCap[c] = Math.round(fridge * CAT_INFO[c].fridge + dry * CAT_INFO[c].dry);
  const backroomCells = layout.cells.filter((t) => t === 'backroom').length;

  const slots: SlotInfo[] = layout.fixtures
    .filter((f) => f.kind === 'selfCheckoutSlot' || f.kind === 'equipmentSlot')
    .map((f) => ({ id: f.id, capacity: f.kind === 'equipmentSlot' ? 2 : 1, fixture: f }));

  return {
    lotKind: layout.lot.kind,
    shelfCap,
    shelfCapTotal: CATS.reduce((n, c) => n + shelfCap[c], 0),
    backroomCap: backroomCells * CAPACITY.backroom,
    slots,
    spots: { sidewalk: sidewalkSpots(layout), backroom: backroomSpots(layout), floor: floorSpots(layout) },
    salesCells: layout.cells.filter((t) => t === 'floor' || t === 'fixture').length,
  };
}

/** Chodnik: kwadraty 2×2 w strefie palet (wiersze 1–2, bez pasa przed wejściem). */
function sidewalkSpots(layout: StoreLayout): PalletSpot[] {
  const zone = new Set(layout.palletZoneOutside.map((c) => c.x + c.y * 4096));
  const out: PalletSpot[] = [];
  for (let x = 1; x < layout.width - 2; x++) {
    const s = { x, y: 1 };
    if (squareCells(s).every((c) => zone.has(c.x + c.y * 4096))) { out.push(s); x++; }
  }
  return out;
}

/** Zaplecze: kwadraty 2×2 od najdalszego rogu, z wolnym przejściem pod drzwiami. */
function backroomSpots(layout: StoreLayout): PalletSpot[] {
  const door = layout.fixtures.find((f) => f.kind === 'backroomDoor');
  const free = (c: Cell): boolean => layout.cells[c.y * layout.width + c.x] === 'backroom'
    && !(door && c.x >= door.x - 1 && c.x <= door.x + door.w && c.y <= layout.midWallY + 2);
  const taken = new Set<number>();
  const out: PalletSpot[] = [];
  const doorX = door ? door.x + 1 : 0;
  const candidates: PalletSpot[] = [];
  for (let y = layout.depth - 3; y > layout.midWallY; y--) {
    for (let x = 1; x < layout.width - 2; x++) candidates.push({ x, y });
  }
  // najpierw dalej od drzwi (tam, gdzie paleta nikomu nie przeszkadza)
  candidates.sort((a, b) => Math.abs(b.x - doorX) - Math.abs(a.x - doorX) || b.y - a.y);
  for (const s of candidates) {
    const cells = squareCells(s);
    if (!cells.every((c) => free(c) && !taken.has(c.x + c.y * 4096))) continue;
    for (const c of cells) taken.add(c.x + c.y * 4096);
    out.push(s);
    if (out.length >= BACKROOM_SPOTS_MAX) break;
  }
  return out;
}

/**
 * Sala: do 3 kwadratów 2×2 na wolnej podłodze. Paleta w sali to przeszkoda, ale nie może odciąć klientom kasy,
 * kolejki, slotów ani żadnego mebla: każdy kandydat jest sprawdzany przeszukaniem z wejścia razem z poprzednimi.
 */
function floorSpots(layout: StoreLayout): PalletSpot[] {
  const { width, depth } = layout;
  const key = (c: Cell): number => c.y * width + c.x;
  const reserved = new Set<number>();
  for (const c of layout.checkoutQueue) reserved.add(key(c));
  for (const c of staffStripCells(layout)) reserved.add(key(c));
  for (const f of layout.fixtures) {
    if (f.kind === 'gondola' || f.kind === 'wallShelf' || f.kind === 'fridge') continue;
    for (const c of accessCells(layout, f)) reserved.add(key(c));
  }
  const walk = (c: Cell, blocked: Set<number>): boolean => isWalkable(layout, c.x, c.y) && c.y > 0 && !blocked.has(key(c));

  const targets: Cell[][] = [
    ...layout.fixtures.filter((f) => f.kind !== 'backroomDoor').map((f) => accessCells(layout, f).filter((c) => isWalkable(layout, c.x, c.y))),
    ...layout.checkoutQueue.map((c) => [c]),
  ].filter((t) => t.length > 0);

  const reachableAll = (blocked: Set<number>): boolean => {
    const start = layout.spawnPoints[0]!;
    const seen = new Set<number>([key(start)]);
    const stack = [start];
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      for (const n of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
        if (!walk(n, blocked) || seen.has(key(n))) continue;
        seen.add(key(n));
        stack.push(n);
      }
    }
    return targets.every((t) => t.some((c) => seen.has(key(c)))) && layout.spawnPoints.every((p) => seen.has(key(p)));
  };

  const candidates: PalletSpot[] = [];
  for (let y = FRONT_WALL_Y + 3; y < layout.midWallY - 1; y++) {
    for (let x = 1; x < width - 2; x++) {
      const s = { x, y };
      if (squareCells(s).every((c) => layout.cells[key(c)] === 'floor' && !reserved.has(key(c)))) candidates.push(s);
    }
  }
  // najpierw bliżej środka sali: tam paleta najbardziej rzuca się w oczy (i przeszkadza), ale nie stoi przy wejściu
  const cx = width / 2;
  const cy = (FRONT_WALL_Y + layout.midWallY) / 2;
  candidates.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));

  const blocked = new Set<number>();
  const out: PalletSpot[] = [];
  for (const s of candidates) {
    const cells = squareCells(s);
    if (cells.some((c) => blocked.has(key(c)))) continue;
    // odstęp od innych palet, żeby dwie nie zlały się w jedną ścianę
    if (out.some((o) => Math.abs(o.x - s.x) < 4 && Math.abs(o.y - s.y) < 4)) continue;
    const next = new Set(blocked);
    for (const c of cells) next.add(key(c));
    if (!reachableAll(next)) continue;
    for (const c of cells) blocked.add(key(c));
    out.push(s);
    if (out.length >= FLOOR_SPOTS_MAX) break;
  }
  return out;
}

/** Czy kratka leży w obrysie miejsca na paletę. */
export function spotContains(s: PalletSpot, c: Cell): boolean {
  return c.x >= s.x && c.x <= s.x + 1 && c.y >= s.y && c.y <= s.y + 1;
}
