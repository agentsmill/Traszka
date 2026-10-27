import { cellKey, manhattan, type Cell } from '@/sim/grid';
import { findPath } from '@/sim/nav/astar';
import { FRONT_WALL_Y, type Fixture, type FixtureKind, type StoreLayout } from './types';

export interface ValidationResult { ok: boolean; errors: string[] }

// Progi reguł układu (spec §5.2).
const CHECKOUT_MAX_ROWS = 6;            // kasa kończy się najdalej w wierszu FRONT_WALL_Y + 6
const CHECKOUT_MAX_ENTRANCE_DIST = 8;   // manhattan kasa → wejście
const HOT_MAX_DIST = 8;                 // manhattan hotFood / coffee → kasa
const STAFF_GAP_MIN = 1;                // wolne kratki między kasą a regałem z papierosami
const STAFF_GAP_MAX = 2;
const AISLE_MIN = 2;                    // szerokość alejki wzdłuż dłuższych boków gondoli

/** Kratki chodliwe dla klientów: chodnik, wejście i podłoga sali. Poza siatką → false. */
export function isWalkable(layout: StoreLayout, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.depth) return false;
  const t = layout.cells[y * layout.width + x];
  return t === 'outside' || t === 'entrance' || t === 'floor';
}

/**
 * Kratki tuż przed frontem mebla (po stronie `facing`), po jednej na kratkę frontu, rosnąco po x lub y.
 * To czysta geometria: kratki poza siatką są pomijane, ale chodliwość trzeba sprawdzić osobno (isWalkable).
 */
export function accessCells(layout: StoreLayout, f: Fixture): Cell[] {
  const out: Cell[] = [];
  switch (f.facing) {
    case 'N': for (let dx = 0; dx < f.w; dx++) out.push({ x: f.x + dx, y: f.y - 1 }); break;
    case 'S': for (let dx = 0; dx < f.w; dx++) out.push({ x: f.x + dx, y: f.y + f.d }); break;
    case 'W': for (let dy = 0; dy < f.d; dy++) out.push({ x: f.x - 1, y: f.y + dy }); break;
    case 'E': for (let dy = 0; dy < f.d; dy++) out.push({ x: f.x + f.w, y: f.y + dy }); break;
  }
  return out.filter((c) => c.x >= 0 && c.y >= 0 && c.x < layout.width && c.y < layout.depth);
}

interface Rect { x: number; y: number; w: number; d: number }

// Odstęp między przedziałami [aStart, aStart + aLen) i [bStart, bStart + bLen) w kratkach (0 = stykają się lub zachodzą).
function intervalGap(aStart: number, aLen: number, bStart: number, bLen: number): number {
  return Math.max(0, bStart - (aStart + aLen - 1), aStart - (bStart + bLen - 1));
}

/** Najmniejszy manhattan między kratkami dwóch prostokątów. */
function rectDistance(a: Rect, b: Rect): number {
  return intervalGap(a.x, a.w, b.x, b.w) + intervalGap(a.y, a.d, b.y, b.d);
}

function entranceRects(layout: StoreLayout): Rect[] {
  return layout.entrance.map((e) => ({ x: e.x, y: e.y, w: 1, d: 1 }));
}

function entranceIsValid(layout: StoreLayout): boolean {
  const { width, cells, entrance } = layout;
  const typed: Cell[] = [];
  cells.forEach((t, i) => { if (t === 'entrance') typed.push({ x: i % width, y: Math.floor(i / width) }); });
  if (typed.length !== 2 || entrance.length !== 2) return false;
  if (new Set(entrance.map(cellKey)).size !== 2) return false;
  return typed.every((c) => c.y === FRONT_WALL_Y)
    && entrance.every((e) => e.y === FRONT_WALL_Y && cells[e.y * width + e.x] === 'entrance');
}

function checkoutIsNearEntrance(layout: StoreLayout, checkout: Fixture): boolean {
  if (checkout.y + checkout.d - 1 > FRONT_WALL_Y + CHECKOUT_MAX_ROWS) return false;
  const entrances = entranceRects(layout);
  // bez wejścia nie ma czego mierzyć, a brak wejścia zgłasza entrance-not-front
  return entrances.length === 0 || entrances.some((e) => rectDistance(checkout, e) <= CHECKOUT_MAX_ENTRANCE_DIST);
}

// Regał stoi równolegle do kasy (front w tę samą stronę), po przeciwnej stronie niż jej front,
// naprzeciw niej, a między nimi zostaje STAFF_GAP_MIN..STAFF_GAP_MAX kratek wolnej podłogi dla personelu
// (pas sprawdzamy na odcinku, na którym kasa i regał leżą naprzeciw siebie).
function isBehindCheckout(layout: StoreLayout, checkout: Fixture, shelf: Fixture): boolean {
  if (shelf.facing !== checkout.facing) return false;

  // Pas między regałem a kasą, liczony wzdłuż osi frontu (włącznie); `across` to oś równoległa do frontu.
  let gapFrom: number;
  let gapTo: number;
  switch (checkout.facing) {
    case 'E': gapFrom = shelf.x + shelf.w; gapTo = checkout.x - 1; break;
    case 'W': gapFrom = checkout.x + checkout.w; gapTo = shelf.x - 1; break;
    case 'S': gapFrom = shelf.y + shelf.d; gapTo = checkout.y - 1; break;
    case 'N': gapFrom = checkout.y + checkout.d; gapTo = shelf.y - 1; break;
  }
  const gap = gapTo - gapFrom + 1;
  if (gap < STAFF_GAP_MIN || gap > STAFF_GAP_MAX) return false;

  const frontAlongX = checkout.facing === 'N' || checkout.facing === 'S';
  const acrossFrom = frontAlongX ? Math.max(checkout.x, shelf.x) : Math.max(checkout.y, shelf.y);
  const acrossTo = frontAlongX
    ? Math.min(checkout.x + checkout.w, shelf.x + shelf.w) - 1
    : Math.min(checkout.y + checkout.d, shelf.y + shelf.d) - 1;
  if (acrossFrom > acrossTo) return false;

  for (let a = gapFrom; a <= gapTo; a++) {
    for (let b = acrossFrom; b <= acrossTo; b++) {
      const c = frontAlongX ? { x: b, y: a } : { x: a, y: b };
      if (!isInGrid(layout, c) || layout.cells[c.y * layout.width + c.x] !== 'floor') return false;
    }
  }
  return true;
}

// Pas AISLE_MIN kratek wolnej podłogi wzdłuż każdego z dłuższych boków gondoli.
function aisleIsWide(layout: StoreLayout, g: Fixture): boolean {
  const sides: ('N' | 'S' | 'W' | 'E')[] = g.w > g.d ? ['N', 'S'] : g.d > g.w ? ['W', 'E'] : ['N', 'S', 'W', 'E'];
  for (const side of sides) {
    for (let step = 1; step <= AISLE_MIN; step++) {
      const cells: Cell[] = [];
      if (side === 'N' || side === 'S') {
        const y = side === 'N' ? g.y - step : g.y + g.d - 1 + step;
        for (let dx = 0; dx < g.w; dx++) cells.push({ x: g.x + dx, y });
      } else {
        const x = side === 'W' ? g.x - step : g.x + g.w - 1 + step;
        for (let dy = 0; dy < g.d; dy++) cells.push({ x, y: g.y + dy });
      }
      if (!cells.every((c) => isInGrid(layout, c) && layout.cells[c.y * layout.width + c.x] === 'floor')) return false;
    }
  }
  return true;
}

function isInGrid(layout: StoreLayout, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < layout.width && c.y < layout.depth;
}

// Meble leżą w całości na sali (drzwi na zaplecze także w ścianie środkowej i na zapleczu),
// w kratkach oznaczonych w `cells` jako 'fixture', i żadna kratka nie jest zajęta dwa razy.
function fixturesAreValid(layout: StoreLayout): boolean {
  const seen = new Set<number>();
  for (const f of layout.fixtures) {
    if (f.w < 1 || f.d < 1) return false;
    const yMax = f.kind === 'backroomDoor' ? layout.depth - 2 : layout.midWallY - 1;
    for (let dy = 0; dy < f.d; dy++) {
      for (let dx = 0; dx < f.w; dx++) {
        const x = f.x + dx;
        const y = f.y + dy;
        if (x < 1 || x > layout.width - 2 || y < FRONT_WALL_Y + 1 || y > yMax) return false;
        if (layout.cells[y * layout.width + x] !== 'fixture') return false;
        const key = cellKey({ x, y });
        if (seen.has(key)) return false;
        seen.add(key);
      }
    }
  }
  return true;
}

function queueIsValid(layout: StoreLayout, checkout: Fixture): boolean {
  const q = layout.checkoutQueue;
  if (q.length === 0) return false;
  if (new Set(q.map(cellKey)).size !== q.length) return false;
  if (!q.every((c) => isWalkable(layout, c.x, c.y))) return false;
  for (let i = 1; i < q.length; i++) {
    if (manhattan(q[i - 1]!, q[i]!) !== 1) return false;
  }
  return accessCells(layout, checkout).some((c) => c.x === q[0]!.x && c.y === q[0]!.y);
}

/**
 * Sprawdza reguły układu ze spec §5.2. `errors` to kody w kolejności reguł; kody z parametrem
 * (`aisle-narrow:<id>`, `unreachable:<id>`) mają po jednym wpisie na mebel.
 * Brak wymaganego mebla (kasa, regał z papierosami, hot-dogi, kawa) liczy się jako złamanie jego reguły.
 * Reguły względem kasy odnoszą się do pierwszej kasy w `fixtures`.
 */
export function validateLayout(layout: StoreLayout): ValidationResult {
  const errors: string[] = [];
  const byKind = (kind: FixtureKind): Fixture[] => layout.fixtures.filter((f) => f.kind === kind);
  const checkouts = byKind('checkout');
  const checkout = checkouts[0];

  if (!entranceIsValid(layout)) errors.push('entrance-not-front');

  if (checkouts.length === 0 || !checkouts.every((c) => checkoutIsNearEntrance(layout, c))) errors.push('checkout-far');

  // Reguły odnoszące się do kasy pomijamy, gdy jej brak (to już zgłasza checkout-far).
  if (checkout) {
    const tobacco = byKind('tobaccoShelf');
    if (tobacco.length === 0 || !tobacco.every((t) => isBehindCheckout(layout, checkout, t))) errors.push('tobacco-not-behind');

    const hotFood = byKind('hotFood');
    const coffee = byKind('coffee');
    if (hotFood.length === 0 || coffee.length === 0 || [...hotFood, ...coffee].some((h) => rectDistance(h, checkout) > HOT_MAX_DIST)) {
      errors.push('hot-far');
    }
  }

  if (byKind('fridge').some((f) => f.y + f.d !== layout.midWallY || f.facing !== 'N')) errors.push('fridge-not-back');

  for (const g of byKind('gondola')) {
    if (!aisleIsWide(layout, g)) errors.push(`aisle-narrow:${g.id}`);
  }

  if (!fixturesAreValid(layout)) errors.push('fixture-overlap');

  const start = layout.entrance.find((e) => isWalkable(layout, e.x, e.y));
  const blocked = (x: number, y: number): boolean => !isWalkable(layout, x, y);
  for (const f of layout.fixtures) {
    if (f.kind === 'backroomDoor') continue;
    const reachable = start !== undefined && accessCells(layout, f).some(
      (c) => isWalkable(layout, c.x, c.y) && findPath(layout.width, layout.depth, blocked, start, c) !== null,
    );
    if (!reachable) errors.push(`unreachable:${f.id}`);
  }

  if (!checkout || !queueIsValid(layout, checkout)) errors.push('queue-invalid');

  const doors = byKind('backroomDoor');
  if (doors.length !== 1 || doors[0]!.y !== layout.midWallY) errors.push('no-backroom-door');

  return { ok: errors.length === 0, errors };
}
