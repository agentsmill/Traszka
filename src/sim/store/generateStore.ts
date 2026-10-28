import type { Cell } from '@/sim/grid';
import { createRng, subSeed, type Rng } from '@/sim/rng';
import { palletZone, spawnPoints, storeDimensions, typeCells } from './assemble';
import { pickLot } from './lots';
import {
  FRONT_WALL_Y,
  type Facing,
  type Fixture,
  type FixtureKind,
  type LotSpec,
  type StoreLayout,
} from './types';
import { validateLayout } from './validate';

/** Numer wersji algorytmu. Zmiana wyglądu sklepu dla tego samego seeda wymaga jego podbicia. */
export const GENERATOR_VERSION = 1;

const MAX_ATTEMPTS = 10;

// Siatka (spec §5.2). Wszystko budujemy w układzie „kasa przy zachodniej ścianie”, a na końcu
// z szansą 1/2 odbijamy w poziomie, więc wschodnia strona jest tylko lustrem zachodniej.
const SALES_TOP = FRONT_WALL_Y + 1;                // pierwszy wiersz sali
const CHECKOUT_LAST_ROW = FRONT_WALL_Y + 6;        // kasa kończy się najdalej tutaj (próg z validate.ts)
const CHECKOUT_MAX_ENTRANCE_DIST = 8;              // manhattan kasa → wejście (próg z validate.ts)
const AISLE = 3;                                   // docelowa szerokość alejki
const AISLE_MIN = 2;
const GONDOLA_THICKNESS = 2;
const GONDOLA_MIN_LENGTH = 3;
const GONDOLA_MAX_LENGTH = 8;
const FRIDGE_FRONT_AISLE = 3;                      // wolne wiersze między gondolami a lodówkami
const QUEUE_MAX = 6;
const STAFF_GAP_2_CHANCE = 0.25;                   // pas personelu za kasą: zwykle 1 kratka, czasem 2 (tylko w szerszych lokalach)
const STAFF_GAP_2_MIN_WIDTH = 14;

interface Rect { x: number; y: number; w: number; d: number }

class PlacementError extends Error {}

const MIRRORED: Record<Facing, Facing> = { N: 'N', S: 'S', E: 'W', W: 'E' };

function cellsOf(r: Rect): Cell[] {
  const out: Cell[] = [];
  for (let dy = 0; dy < r.d; dy++) for (let dx = 0; dx < r.w; dx++) out.push({ x: r.x + dx, y: r.y + dy });
  return out;
}

/** Kratki tuż przed frontem mebla (po stronie `facing`). */
function frontCells(r: Rect, facing: Facing): Cell[] {
  switch (facing) {
    case 'N': return cellsOf({ x: r.x, y: r.y - 1, w: r.w, d: 1 });
    case 'S': return cellsOf({ x: r.x, y: r.y + r.d, w: r.w, d: 1 });
    case 'W': return cellsOf({ x: r.x - 1, y: r.y, w: 1, d: r.d });
    case 'E': return cellsOf({ x: r.x + r.w, y: r.y, w: 1, d: r.d });
  }
}

/** Pasy alejki (AISLE_MIN kratek) wzdłuż obu dłuższych boków gondoli. */
function aisleStrips(r: Rect): Cell[] {
  return r.w >= r.d
    ? [...cellsOf({ x: r.x, y: r.y - AISLE_MIN, w: r.w, d: AISLE_MIN }), ...cellsOf({ x: r.x, y: r.y + r.d, w: r.w, d: AISLE_MIN })]
    : [...cellsOf({ x: r.x - AISLE_MIN, y: r.y, w: AISLE_MIN, d: r.d }), ...cellsOf({ x: r.x + r.w, y: r.y, w: AISLE_MIN, d: r.d })];
}

const sequence = (from: number, count: number): number[] => Array.from({ length: count }, (_, i) => from + i);

/**
 * Sala sprzedaży w trakcie budowy: które kratki zajmują meble i które mają zostać wolne
 * (fronty mebli, alejki, kolejka). Mebel wolno postawić tylko na kratkach wolnych od jednego i drugiego,
 * a jego front musi być podłogą, więc późniejsze meble nie zastawią wcześniejszych.
 */
class Floor {
  readonly fixtures: Fixture[] = [];
  readonly width: number;
  readonly midWallY: number;
  private readonly solid: boolean[];
  private readonly clear: boolean[];
  private readonly counts: Partial<Record<FixtureKind, number>> = {};
  private readonly fronts: Cell[][] = [];     // fronty dotąd postawionych mebli
  private entrance: Cell | null = null;       // kratka sali tuż pod wejściem, skąd sprawdzamy dojście

  constructor(width: number, midWallY: number) {
    this.width = width;
    this.midWallY = midWallY;
    this.solid = new Array<boolean>(width * midWallY).fill(false);
    this.clear = new Array<boolean>(width * midWallY).fill(false);
  }

  private index(c: Cell): number { return c.y * this.width + c.x; }
  private isSales(c: Cell): boolean { return c.x >= 1 && c.x <= this.width - 2 && c.y >= SALES_TOP && c.y < this.midWallY; }
  private isFloor(c: Cell): boolean { return this.isSales(c) && !this.solid[this.index(c)]; }
  private isOpen(c: Cell): boolean { return this.isFloor(c) && !this.clear[this.index(c)]; }
  private nextId(kind: FixtureKind): string {
    const n = (this.counts[kind] ?? 0) + 1;
    this.counts[kind] = n;
    return `${kind}-${n}`;
  }

  setEntrance(c: Cell): void { this.entrance = c; }

  /** Oznacza kratki jako wolną podłogę; rzuca, gdy któraś jest ścianą albo meblem. */
  keepClear(cells: Cell[]): void {
    if (!cells.every((c) => this.isFloor(c))) throw new PlacementError('keepClear: kratka zajęta');
    for (const c of cells) this.clear[this.index(c)] = true;
  }

  /** Czy z wejścia da się dojść do frontu każdego mebla (także nowego), gdy zajmiemy dodatkowo `extra`? */
  private frontsReachable(extra: Cell[], newFront: Cell[]): boolean {
    if (!this.entrance) return true;
    const blocked = new Set(extra.map((c) => this.index(c)));
    const seen = new Set<number>([this.index(this.entrance)]);
    const stack: Cell[] = [this.entrance];
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      for (const n of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
        if (!this.isFloor(n) || blocked.has(this.index(n)) || seen.has(this.index(n))) continue;
        seen.add(this.index(n));
        stack.push(n);
      }
    }
    return [...this.fronts, newFront].every((front) => front.some((c) => seen.has(this.index(c))));
  }

  tryAdd(kind: FixtureKind, r: Rect, facing: Facing): Fixture | null {
    const front = frontCells(r, facing);
    if (!cellsOf(r).every((c) => this.isOpen(c)) || !front.every((c) => this.isFloor(c))) return null;
    if (!this.frontsReachable(cellsOf(r), front)) return null;
    for (const c of cellsOf(r)) this.solid[this.index(c)] = true;
    for (const c of front) this.clear[this.index(c)] = true;
    this.fronts.push(front);
    const fixture: Fixture = { id: this.nextId(kind), kind, ...r, facing };
    this.fixtures.push(fixture);
    return fixture;
  }

  add(kind: FixtureKind, r: Rect, facing: Facing): Fixture {
    const fixture = this.tryAdd(kind, r, facing);
    if (!fixture) throw new PlacementError(`${kind} nie mieści się w ${r.x},${r.y}`);
    return fixture;
  }

  /** Gondola wymaga wolnych pasów alejki po obu dłuższych bokach. */
  addGondola(r: Rect, facing: Facing): void {
    const strips = aisleStrips(r);
    if (!strips.every((c) => this.isFloor(c))) throw new PlacementError(`gondola ${r.x},${r.y}: brak alejki`);
    this.add('gondola', r, facing);
    this.keepClear(strips);
  }

  /** Drzwi na zaplecze leżą w ścianie środkowej; przed nimi (od strony sali) musi być wolno. */
  addBackroomDoor(x: number): void {
    this.keepClear(cellsOf({ x, y: this.midWallY - 1, w: 2, d: 1 }));
    this.fixtures.push({ id: this.nextId('backroomDoor'), kind: 'backroomDoor', x, y: this.midWallY, w: 2, d: 1, facing: 'N' });
  }
}

// --- Blok kasowy: kasa, hot-dogi i kawa w jednej linii przy bocznej ścianie -------------------------

type BlockKind = 'checkout' | 'hotFood' | 'coffee';
interface BlockItem { kind: BlockKind; y: number; d: number }
interface Block { x: number; items: BlockItem[] }

const BLOCK_ORDERS: readonly (readonly BlockKind[])[] = [
  ['coffee', 'checkout', 'hotFood'],
  ['hotFood', 'checkout', 'coffee'],
  ['checkout', 'hotFood', 'coffee'],
  ['checkout', 'coffee', 'hotFood'],
];
const HOT_ZONE_DEPTH = { hotFood: 2, coffee: 1 } as const;

function planBlock(rng: Rng, x: number): Block {
  const items: BlockItem[] = [];
  let y = SALES_TOP + 1;
  for (const kind of rng.pick(BLOCK_ORDERS)) {
    const d = kind === 'checkout' ? Math.min(rng.int(3, 5), CHECKOUT_LAST_ROW - y + 1) : HOT_ZONE_DEPTH[kind];
    items.push({ kind, y, d });
    y += d;
  }
  return { x, items };
}

const blockItem = (block: Block, kind: BlockKind): BlockItem => block.items.find((i) => i.kind === kind)!;
const blockTop = (block: Block): number => block.items[0]!.y;
const blockBottom = (block: Block): number => block.items[block.items.length - 1]!.y + block.items[block.items.length - 1]!.d - 1;

// --- Kroki budowy ---------------------------------------------------------------------------------

/** Opcje generatora (remont): bez nich wynik dla seeda jest taki sam jak zawsze. */
export interface GenerateOptions {
  /** Ile slotów sprzętu 2×2 postawić (zamiast losowych 1–3). Generator stawia tyle, ile się zmieści. */
  equipmentSlots?: number;
}

interface Build {
  rng: Rng;
  opts: GenerateOptions;
  lot: LotSpec;
  floor: Floor;
  block: Block;
  mirror: boolean;
  entranceX: number;      // lewa z dwóch kratek wejścia
  doorX: number;          // lewa z dwóch kratek drzwi na zaplecze
  queueStart: Cell;
  queue: Cell[];
}

function newBuild(lot: LotSpec, rng: Rng, opts: GenerateOptions): Build {
  const gap = rng.chance(STAFF_GAP_2_CHANCE) && lot.interiorWidth >= STAFF_GAP_2_MIN_WIDTH ? 2 : 1;
  const { width, midWallY } = storeDimensions(lot);
  return {
    rng,
    opts,
    lot,
    floor: new Floor(width, midWallY),
    block: planBlock(rng, 2 + gap),           // x=1 regał, potem pas personelu, potem kasa
    mirror: rng.chance(0.5),
    entranceX: 0,
    doorX: 0,
    queueStart: { x: 0, y: 0 },
    queue: [],
  };
}

/** Krok 1. Wejście (w lokalu narożnym przy rogu z drugą witryną, inaczej bliżej boku z kasą), drzwi na zaplecze, korytarz od wejścia. */
function buildShell(b: Build): void {
  const { floor, rng, block, lot } = b;
  const checkout = blockItem(block, 'checkout');
  const nearestSide = Math.floor((floor.width - 1) / 2);   // wejście bliżej boku z kasą niż przeciwległego
  const reach = block.x + CHECKOUT_MAX_ENTRANCE_DIST - (checkout.y - FRONT_WALL_Y);
  const min = block.x + 1;
  const max = Math.min(reach, nearestSide, lot.corner ? min + 1 : Infinity);
  if (max < min) throw new PlacementError('wejście: brak miejsca');
  b.entranceX = rng.int(min, max + 1);

  // wiersz 5 od pasa personelu do wejścia oraz kratki tuż pod wejściem zostają wolne
  floor.keepClear(cellsOf({ x: 2, y: SALES_TOP, w: b.entranceX + 1, d: 1 }));
  floor.keepClear(cellsOf({ x: b.entranceX, y: SALES_TOP + 1, w: 2, d: 1 }));
  floor.setEntrance({ x: b.entranceX, y: SALES_TOP });

  b.doorX = rng.int(2, 5);
  floor.addBackroomDoor(b.doorX);
}

/** Krok 2. Kasa frontem do wnętrza, za nią regał z papierosami przy ścianie, między nimi pas personelu. */
function placeCheckout(b: Build): void {
  const { floor, rng, block } = b;
  const checkout = blockItem(block, 'checkout');
  floor.add('checkout', { x: block.x, y: checkout.y, w: 1, d: checkout.d }, 'E');

  const top = blockTop(block);
  const bottom = Math.min(blockBottom(block) + rng.int(0, 3), floor.midWallY - 4);
  floor.add('tobaccoShelf', { x: 1, y: top, w: 1, d: bottom - top + 1 }, 'E');
  floor.keepClear(cellsOf({ x: 2, y: top, w: block.x - 2, d: bottom - top + 1 }));

  // kolejka biegnie w dół sali wzdłuż frontu kasy; rezerwujemy jej największą możliwą długość
  b.queueStart = { x: block.x + 1, y: checkout.y + Math.floor(checkout.d / 2) };
  floor.keepClear(sequence(0, QUEUE_MAX).map((i) => ({ x: b.queueStart.x, y: b.queueStart.y + i })));
}

/** Krok 3. Hot-dogi i kawa w tej samej linii co kasa. */
function placeHotZone(b: Build): void {
  for (const kind of ['hotFood', 'coffee'] as const) {
    const item = blockItem(b.block, kind);
    b.floor.add(kind, { x: b.block.x, y: item.y, w: 1, d: item.d }, 'E');
  }
}

/** Krok 4. Moduły lodówek 2×2 wzdłuż ściany środkowej, od rogu po przeciwnej stronie niż kasa, z pominięciem drzwi. */
function placeFridges(b: Build): void {
  const { floor, rng, block } = b;
  const last = floor.width - 2;
  const first = Math.max(block.x + 2, b.doorX + 3);
  const capacity = Math.floor((last - first + 1) / 2);
  const count = rng.int(Math.ceil(capacity * 0.6), capacity + 1);
  for (let i = 0; i < count; i++) {
    floor.add('fridge', { x: last - 1 - 2 * i, y: floor.midWallY - 2, w: 2, d: 2 }, 'N');
  }
}

/** Początki pasm gondoli (grubość 2) w przedziale [from, to]: alejki 3 kratki, a gdy brak miejsca na dwa pasma, 2. */
function packBands(rng: Rng, from: number, to: number): number[] {
  const span = to - from + 1;
  const bands = (aisle: number): number => Math.max(0, Math.floor((span + aisle) / (GONDOLA_THICKNESS + aisle)));
  const aisle = bands(AISLE) >= 2 || bands(AISLE_MIN) <= bands(AISLE) ? AISLE : AISLE_MIN;
  const n = bands(aisle);
  if (n === 0) return [];
  const slack = span - (n * GONDOLA_THICKNESS + (n - 1) * aisle);
  const first = from + rng.int(0, slack + 1);
  return sequence(0, n).map((k) => first + k * (GONDOLA_THICKNESS + aisle));
}

/** Odcinki gondoli wzdłuż pasma: równe części przedziału [from, to], rozdzielone poprzecznymi przejściami po 2–3 kratki. */
function packSegments(rng: Rng, from: number, to: number): { start: number; length: number }[] {
  const maxLength = rng.int(GONDOLA_MIN_LENGTH + 2, GONDOLA_MAX_LENGTH + 1);
  const crossAisle = rng.int(2, 4);
  const start = from + rng.int(0, Math.min(2, Math.max(0, to - from + 1 - GONDOLA_MIN_LENGTH)) + 1);
  const span = to - start + 1;
  for (let n = Math.max(1, Math.ceil((span + crossAisle) / (maxLength + crossAisle))); n >= 1; n--) {
    const room = span - (n - 1) * crossAisle;
    const base = Math.floor(room / n);
    if (base < GONDOLA_MIN_LENGTH) continue;
    const out: { start: number; length: number }[] = [];
    let pos = start;
    for (let i = 0; i < n; i++) {
      const length = base + (i < room - base * n ? 1 : 0);
      out.push({ start: pos, length });
      pos += length + crossAisle;
    }
    return out;
  }
  return [];
}

/** Krok 5. Gondole w równoległych rzędach, pionowych albo poziomych (losowane z seeda). */
function placeGondolas(b: Build): void {
  const { floor, rng, block } = b;
  const horizontal = rng.chance(0.5);
  // od kolejki dzielą je 2 kratki alejki, od wschodniej ściany też; od frontu 2 wiersze (poziome 3, by nie sięgać slotu przy wejściu)
  const xs: [number, number] = [block.x + 4, floor.width - 5];
  const ys: [number, number] = [SALES_TOP + (horizontal ? 3 : 2), floor.midWallY - 2 - FRIDGE_FRONT_AISLE - 1];
  const [bandRange, runRange] = horizontal ? [ys, xs] : [xs, ys];

  let placed = 0;
  for (const band of packBands(rng, ...bandRange)) {
    for (const seg of packSegments(rng, ...runRange)) {
      const rect: Rect = horizontal
        ? { x: seg.start, y: band, w: seg.length, d: GONDOLA_THICKNESS }
        : { x: band, y: seg.start, w: GONDOLA_THICKNESS, d: seg.length };
      floor.addGondola(rect, rng.pick(horizontal ? (['N', 'S'] as const) : (['W', 'E'] as const)));
      placed++;
    }
  }
  if (placed === 0) throw new PlacementError('brak miejsca na gondole');
}

/** Krok 6. Jeden lub dwa regały ścienne przy drugiej ścianie bocznej (pierwszy obowiązkowy). */
function placeWallShelves(b: Build): void {
  const { floor, rng } = b;
  const wanted = rng.int(1, 3);
  for (let i = 0; i < wanted; i++) {
    const length = rng.int(4, 9);
    let placed = false;
    for (const y of rng.shuffle(sequence(SALES_TOP, floor.midWallY - length - SALES_TOP + 1))) {
      if (floor.tryAdd('wallShelf', { x: floor.width - 2, y, w: 1, d: length }, 'W')) { placed = true; break; }
    }
    if (!placed && i === 0) throw new PlacementError('brak miejsca na regał ścienny');
  }
}

/** Krok 7. Slot kasy samoobsługowej przy wejściu, po stronie dalszej od kasy. */
function placeSelfCheckout(b: Build): void {
  if (b.lot.interiorWidth < 16) return;
  b.floor.add('selfCheckoutSlot', { x: b.entranceX + 3, y: SALES_TOP, w: 2, d: 1 }, 'S');
}

/** Krok 8. 1–3 sloty sprzętu 2×2 w losowych wolnych miejscach przy ścianach (z wolnym frontem, dostępnym z wejścia). */
function placeEquipment(b: Build): void {
  const { floor, rng } = b;
  const wanted = b.opts.equipmentSlots ?? rng.int(1, 4);
  const spots: Cell[] = [];
  for (let y = SALES_TOP; y <= floor.midWallY - 2; y++) {
    for (let x = 1; x <= floor.width - 3; x++) {
      if (x === 1 || x === floor.width - 3 || y === SALES_TOP || y === floor.midWallY - 2) spots.push({ x, y });
    }
  }

  let placed = 0;
  for (const spot of rng.shuffle(spots)) {
    if (placed === wanted) break;
    for (const facing of rng.shuffle<Facing>(['N', 'E', 'S', 'W'])) {
      if (floor.tryAdd('equipmentSlot', { ...spot, w: 2, d: 2 }, facing)) { placed++; break; }
    }
  }
  if (placed === 0) throw new PlacementError('brak miejsca na sprzęt');
}

/** Krok 9. Kolejka 4–6 kratek, od kasy w dół sali. */
function buildQueue(b: Build): void {
  const length = b.rng.int(4, QUEUE_MAX + 1);
  b.queue = sequence(0, length).map((i) => ({ x: b.queueStart.x, y: b.queueStart.y + i }));
}

/** Składa ostateczny układ: odbija go (jeśli wylosowano), a siatkę, strefę palet (krok 10) i punkty pojawiania się daje assemble.ts. */
function assemble(seed: string, lot: LotSpec, b: Build): StoreLayout {
  const { width, depth, midWallY } = storeDimensions(lot);
  const flip = (x: number, w = 1): number => (b.mirror ? width - x - w : x);

  const fixtures = b.floor.fixtures.map((f): Fixture =>
    b.mirror ? { ...f, x: flip(f.x, f.w), facing: MIRRORED[f.facing] } : f);
  const entrance = [b.entranceX, b.entranceX + 1].map((x) => ({ x: flip(x), y: FRONT_WALL_Y })).sort((p, q) => p.x - q.x);

  return {
    generatorVersion: GENERATOR_VERSION,
    seed,
    lot,
    width,
    depth,
    midWallY,
    cells: typeCells(lot, entrance, fixtures),
    fixtures,
    entrance,
    checkoutQueue: b.queue.map((c) => ({ x: flip(c.x), y: c.y })),
    palletZoneOutside: palletZone(width, entrance),
    spawnPoints: spawnPoints(width),
  };
}

function buildAttempt(seed: string, lot: LotSpec, rng: Rng, opts: GenerateOptions): StoreLayout | null {
  const b = newBuild(lot, rng, opts);
  try {
    buildShell(b);
    placeCheckout(b);
    placeHotZone(b);
    placeFridges(b);
    placeGondolas(b);
    placeWallShelves(b);
    placeSelfCheckout(b);
    placeEquipment(b);
    buildQueue(b);
  } catch (e) {
    if (e instanceof PlacementError) return null;
    throw e;
  }
  return assemble(seed, lot, b);
}

/**
 * Deterministyczny sklep z seeda. Bez `lot` wybiera lokal przez pickLot(seed); `opts` zmienia liczbę slotów (remont). Do 10 prób z subSeed(seed, `store:try:${n}`);
 * po 10 nieudanych rzuca Error('generateStore: brak poprawnego układu').
 */
export function generateStore(seed: string, lot: LotSpec = pickLot(seed), opts: GenerateOptions = {}): StoreLayout {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const layout = buildAttempt(seed, lot, createRng(subSeed(seed, `store:try:${attempt}`)), opts);
    if (layout && validateLayout(layout).ok) return layout;
  }
  throw new Error('generateStore: brak poprawnego układu');
}
