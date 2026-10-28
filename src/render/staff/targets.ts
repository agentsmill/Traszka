import { cashierSpot, type CashierSpot } from '@/game/cashier';
import { staffStripCells } from '@/sim/crowd/crowd';
import type { PalletLoc, PalletSpot } from '@/sim/economy/storeInfo';
import { cellKey, manhattan, type Cell } from '@/sim/grid';
import { createRng, subSeed } from '@/sim/rng';
import { FRONT_WALL_Y, type CellType, type Fixture, type FixtureKind, type StoreLayout } from '@/sim/store/types';
import { accessCells } from '@/sim/store/validate';
import type { StaffNav } from './staffNav';
import type { PalletRef, StaffAssignment, StaffDuty, StaffSpot } from './types';

// Gdzie ma stanąć każda osoba, żeby jej zadanie było widać. Czysta „scenografia”: ekonomia mówi, kto co robi, a tutaj tylko
// wybieramy kratkę i kierunek patrzenia. Zero losowości poza `createRng(subSeed(layout.seed, …))`, argumentów nie zmieniamy.
//
// Każde zadanie daje listę kratek w kolejności preferencji (plan). Osoby obsługujemy rosnąco po id i każda zajmuje pierwszą
// kratkę ze swojego planu, która jest osiągalna z chodnika i jeszcze wolna. Gdy plan się wyczerpie, osoba trafia na ogólną
// listę zapasową (sala od środka), a gdy i ona jest pusta, na wejście.

/** Kolejność rozładunku jak w `doWork` (economy.ts): najpierw chodnik (mandat), potem sala (korek), na końcu zaplecze. */
const PALLET_ORDER: Record<PalletLoc, number> = { sidewalk: 0, floor: 1, backroom: 2 };
/** Kierunki osi siatki (rad, 0 = +x), z których sprzątająca wybiera swój. */
const AXIS_HEADINGS: readonly number[] = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
/** Meble, do których personel wykłada towar. */
const STOCKED_KINDS: readonly FixtureKind[] = ['gondola', 'wallShelf', 'fridge'];
/** Najmniej kratek (manhattan) od kratek drzwi, w jakiej stoi ktoś bez zajęcia na zapleczu: drzwi mają zostać wolne. */
const IDLE_DOOR_DISTANCE = 2;

interface Point { x: number; y: number }

/** Co osoba ma spróbować zająć: kratki w kolejności preferencji (z kierunkiem patrzenia) i kierunek dla kratki zapasowej. */
interface Plan {
  spots: readonly StaffSpot[];
  /** Kierunek patrzenia dla kratki, której w `spots` nie ma (lista zapasowa, ostatnia deska ratunku). */
  face(cell: Cell): number;
  /** Kratki obok zajętej (także po skosie) pomijamy, o ile starcza innych: osoby bez zajęcia nie tłoczą się. */
  apart?: boolean;
}

/** Stan jednego wywołania: kto już gdzie stoi i co jest osiągalne. Żyje tylko w `pickStaffSpots`. */
interface Ctx {
  readonly layout: StoreLayout;
  readonly nav: StaffNav;
  /** 1 = kratka osiągalna ze `spawnPoints[0]` po siatce `nav`. */
  readonly reach: Uint8Array;
  /** Kratki zajęte przez osoby obsłużone wcześniej (`cellKey`). */
  readonly taken: Set<number>;
  /** Ogólna lista zapasowa: osiągalne kratki sali, najbliżej jej środka pierwsze. */
  readonly spare: readonly Cell[];
  readonly entrance: Point | null;
  readonly door: Fixture | undefined;
  /** Gdy nie ma już żadnej wolnej kratki: wejście (a w układzie bez wejścia punkt pojawiania się). */
  readonly lastResort: Cell;
}

const firstOf = <T>(list: readonly T[]): T | undefined => list[0];
const centreOfCell = (c: Cell): Point => ({ x: c.x + 0.5, y: c.y + 0.5 });
const centreOfRect = (r: { x: number; y: number; w: number; d: number }): Point => ({ x: r.x + r.w / 2, y: r.y + r.d / 2 });
const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;
const byRowThenColumn = (a: Cell, b: Cell): number => a.y - b.y || a.x - b.x;

/** Kierunek (rad, 0 = +x) ze środka kratki do punktu; bez punktu 0. */
function headingTo(from: Cell, to: Point | null): number {
  return to ? Math.atan2(to.y - (from.y + 0.5), to.x - (from.x + 0.5)) : 0;
}

/**
 * Porządek „najbliżej punktu”: rosnąco po odległości manhattan od środka kratki do punktu, remis: mniejsze `y`, potem mniejsze `x`.
 * Środki kratek i punkty (środki mebli, drzwi, sali) mają współrzędne będące wielokrotnościami 0,5, więc odległości są dokładne.
 */
function nearestFirst(cells: readonly Cell[], to: Point): Cell[] {
  return cells
    .map((c) => ({ c, d: Math.abs(c.x + 0.5 - to.x) + Math.abs(c.y + 0.5 - to.y) }))
    .sort((a, b) => a.d - b.d || byRowThenColumn(a.c, b.c))
    .map((e) => e.c);
}

function unique(cells: readonly Cell[]): Cell[] {
  const seen = new Set<number>();
  const out: Cell[] = [];
  for (const c of cells) {
    if (seen.has(cellKey(c))) continue;
    seen.add(cellKey(c));
    out.push(c);
  }
  return out;
}

// --- Osiągalność ----------------------------------------------------------------------------------------------------

/**
 * Kratki, do których da się dojść z `start` po siatce (przeszukiwanie wszerz). Start może stać na zablokowanej kratce
 * (jak w `findPath`: z niej wolno wyjść), ale sam nie liczy się wtedy jako miejsce do stania.
 */
function reachableFrom(nav: StaffNav, start: Cell): Uint8Array {
  const { width, depth } = nav;
  const seen = new Uint8Array(width * depth);
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= depth) return seen;
  const stack = [start.y * width + start.x];
  seen[stack[0]!] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= depth || seen[ny * width + nx] === 1 || nav.blocked(nx, ny)) continue;
      seen[ny * width + nx] = 1;
      stack.push(ny * width + nx);
    }
  }
  if (nav.blocked(start.x, start.y)) seen[start.y * width + start.x] = 0;
  return seen;
}

const inReach = (nav: StaffNav, reach: Uint8Array, c: Cell): boolean =>
  c.x >= 0 && c.y >= 0 && c.x < nav.width && c.y < nav.depth && reach[c.y * nav.width + c.x] === 1;

const isReachable = (ctx: Ctx, c: Cell): boolean => inReach(ctx.nav, ctx.reach, c);

const isFree = (ctx: Ctx, c: Cell): boolean => isReachable(ctx, c) && !ctx.taken.has(cellKey(c));

/** Czy któraś z ośmiu kratek wokół `c` jest zajęta. */
function touchesTaken(ctx: Ctx, c: Cell): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) if (ctx.taken.has(cellKey({ x: c.x + dx, y: c.y + dy }))) return true;
  }
  return false;
}

function makeCtx(layout: StoreLayout, nav: StaffNav): Ctx {
  const start = firstOf(layout.spawnPoints) ?? firstOf(layout.entrance);
  const reach = start ? reachableFrom(nav, start) : new Uint8Array(nav.width * nav.depth);
  const entrance = firstOf(layout.entrance);
  const hall = hallCells(layout).filter((c) => inReach(nav, reach, c));
  return {
    layout,
    nav,
    reach,
    taken: new Set<number>(),
    spare: nearestFirst(hall, { x: layout.width / 2, y: (FRONT_WALL_Y + 1 + layout.midWallY) / 2 }),
    entrance: entrance ? centreOfCell(entrance) : null,
    door: layout.fixtures.find((f) => f.kind === 'backroomDoor'),
    lastResort: entrance ?? firstOf(layout.spawnPoints) ?? { x: 0, y: 0 },
  };
}

/** Wszystkie kratki sali sprzedaży (wiersze od FRONT_WALL_Y + 1 do midWallY − 1), rosnąco po (y, x). */
function hallCells(layout: StoreLayout): Cell[] {
  const out: Cell[] = [];
  for (let y = FRONT_WALL_Y + 1; y < layout.midWallY; y++) {
    for (let x = 0; x < layout.width; x++) out.push({ x, y });
  }
  return out;
}

// --- Plany zadań ----------------------------------------------------------------------------------------------------

/** Kasa: pierwsza kasjerka na swoim miejscu, kolejne na pasie personelu najbliżej niej, twarzą do kasy. */
function cashierPlan(ctx: Ctx, cashier: CashierSpot | null, strip: readonly Cell[]): Plan {
  const till = ctx.layout.fixtures.find((f) => f.kind === 'checkout');
  const face = (c: Cell): number => headingTo(c, till ? centreOfRect(till) : ctx.entrance);
  if (cashier) {
    const cells = nearestFirst(unique([cashier.cell, ...strip]), centreOfCell(cashier.cell));
    return { spots: cells.map((cell) => ({ cell, heading: sameCell(cell, cashier.cell) ? cashier.heading : face(cell) })), face };
  }
  // Bez miejsca kasjera (brak kasy, kolejki albo podłogi za ladą): pas personelu od góry, a bez niego początek kolejki.
  const head = firstOf(ctx.layout.checkoutQueue);
  const lane = strip.length > 0 ? [...strip].sort(byRowThenColumn) : head ? [head] : [];
  return { spots: lane.map((cell) => ({ cell, heading: face(cell) })), face };
}

/** Palety w kolejności rozładunku jak w `doWork`: chodnik, sala, zaplecze; potem `since`; remis zostaje w kolejności `pallets`. */
function unloadOrder(pallets: readonly PalletRef[]): PalletRef[] {
  return pallets
    .map((p, index) => ({ p, index }))
    .sort((a, b) => PALLET_ORDER[a.p.loc] - PALLET_ORDER[b.p.loc] || a.p.since - b.p.since || a.index - b.index)
    .map((e) => e.p);
}

/** Osiem kratek po bokach kwadratu 2×2 palety (bez narożników). */
function sideCells(s: PalletSpot): Cell[] {
  return [
    { x: s.x - 1, y: s.y }, { x: s.x - 1, y: s.y + 1 }, { x: s.x + 2, y: s.y }, { x: s.x + 2, y: s.y + 1 },
    { x: s.x, y: s.y - 1 }, { x: s.x + 1, y: s.y - 1 }, { x: s.x, y: s.y + 2 }, { x: s.x + 1, y: s.y + 2 },
  ];
}

/** Rozładunek: osoba nr `k` obsługuje paletę `k % liczba palet`, od strony wejścia (zaplecze: od strony drzwi). */
function unloadPlan(ctx: Ctx, order: readonly PalletRef[], k: number): Plan {
  const faceEntrance = (c: Cell): number => headingTo(c, ctx.entrance);
  const pallet = order.length > 0 ? order[k % order.length]! : null;
  if (!pallet) {
    // Nie ma czego rozładowywać: pierwsza wolna kratka strefy palet na chodniku, twarzą do wejścia.
    return { spots: ctx.layout.palletZoneOutside.map((cell) => ({ cell, heading: faceEntrance(cell) })), face: faceEntrance };
  }
  const centre: Point = { x: pallet.spot.x + 1, y: pallet.spot.y + 1 };
  const face = (c: Cell): number => headingTo(c, centre);
  const from = pallet.loc === 'backroom' && ctx.door ? centreOfRect(ctx.door) : ctx.entrance;
  const sides = sideCells(pallet.spot);
  return { spots: (from ? nearestFirst(sides, from) : sides.sort(byRowThenColumn)).map((cell) => ({ cell, heading: face(cell) })), face };
}

/** Mebel do wykładania z kratkami dostępu, do których da się dojść. */
interface Stocked { centre: Point; access: Cell[] }

function stockedFixtures(ctx: Ctx): Stocked[] {
  const out: Stocked[] = [];
  for (const f of ctx.layout.fixtures) {
    if (!STOCKED_KINDS.includes(f.kind)) continue;
    const access = accessCells(ctx.layout, f).filter((c) => isReachable(ctx, c));
    if (access.length > 0) out.push({ centre: centreOfRect(f), access });
  }
  return out;
}

/**
 * Wykładanie: osoba nr `k` bierze mebel `k % liczba mebli` i staje na środkowej kratce jego dostępu; zajętą zastępuje następna
 * (po ostatniej wraca się na początek listy kratek mebla), a gdy mebel nie ma wolnej kratki, osoba idzie do następnego.
 */
function stockPlan(ctx: Ctx, stocked: readonly Stocked[], k: number): Plan {
  if (stocked.length === 0) return { spots: [], face: (c) => headingTo(c, ctx.entrance) };
  const spots: StaffSpot[] = [];
  for (let i = 0; i < stocked.length; i++) {
    const { centre, access } = stocked[(k + i) % stocked.length]!;
    const middle = Math.floor(access.length / 2);
    for (let j = 0; j < access.length; j++) {
      const cell = access[(middle + j) % access.length]!;
      spots.push({ cell, heading: headingTo(cell, centre) });
    }
  }
  const mine = stocked[k % stocked.length]!.centre;
  return { spots, face: (c) => headingTo(c, mine) };
}

/**
 * Sprzątanie: losowa wolna kratka sali (poza kolejką i pasem personelu), losowy kierunek osi. Losowanie z podseedu osoby,
 * więc ta sama osoba w tym samym układzie i przy tym samym zbiorze zajętych kratek wybiera zawsze to samo.
 */
function cleanPlan(ctx: Ctx, id: number, strip: readonly Cell[]): Plan {
  const skip = new Set([...ctx.layout.checkoutQueue, ...strip].map(cellKey));
  const candidates = hallCells(ctx.layout).filter((c) => isFree(ctx, c) && !skip.has(cellKey(c)));
  const rng = createRng(subSeed(ctx.layout.seed, `staff-clean:${id}`));
  const cell = candidates.length > 0 ? candidates[rng.int(0, candidates.length)]! : null;
  const heading = rng.pick(AXIS_HEADINGS);
  return { spots: cell ? [{ cell, heading }] : [], face: () => heading };
}

/** Bez zajęcia: zaplecze, od drzwi (ale nie przy samych drzwiach), twarzą do nich, z przerwą między osobami. */
function idlePlan(ctx: Ctx): Plan {
  const { layout, door } = ctx;
  const doorCells: Cell[] = [];
  if (door) {
    for (let dy = 0; dy < door.d; dy++) for (let dx = 0; dx < door.w; dx++) doorCells.push({ x: door.x + dx, y: door.y + dy });
  }
  const backroom = cellsOfType(layout, 'backroom')
    .filter((c) => isReachable(ctx, c) && doorCells.every((d) => manhattan(d, c) >= IDLE_DOOR_DISTANCE));
  const cells = door ? nearestFirst(backroom, centreOfRect(door)) : backroom;
  const face = (c: Cell): number => headingTo(c, door ? centreOfRect(door) : ctx.entrance);
  return { spots: cells.map((cell) => ({ cell, heading: face(cell) })), face, apart: true };
}

/** Kratki danego typu, rosnąco po (y, x). */
function cellsOfType(layout: StoreLayout, type: CellType): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < layout.depth; y++) {
    for (let x = 0; x < layout.width; x++) if (layout.cells[y * layout.width + x] === type) out.push({ x, y });
  }
  return out;
}

// --- Obsadzanie -----------------------------------------------------------------------------------------------------

function claim(ctx: Ctx, cell: Cell, heading: number): StaffSpot {
  ctx.taken.add(cellKey(cell));
  return { cell: { x: cell.x, y: cell.y }, heading };
}

/** Pierwsza wolna kratka planu; gdy plan się wyczerpał: lista zapasowa; gdy i ta: wejście (tam wolno stać razem). */
function place(ctx: Ctx, plan: Plan): StaffSpot {
  const free = (c: Cell): boolean => isFree(ctx, c);
  const apart = plan.apart ? plan.spots.find((s) => free(s.cell) && !touchesTaken(ctx, s.cell)) : undefined;
  const hit = apart ?? plan.spots.find((s) => free(s.cell));
  if (hit) return claim(ctx, hit.cell, hit.heading);
  const spare = ctx.spare.find(free);
  if (spare) return claim(ctx, spare, plan.face(spare));
  const { lastResort } = ctx;
  return { cell: { x: lastResort.x, y: lastResort.y }, heading: plan.face(lastResort) };
}

/**
 * Gdzie ma stanąć każda z osób, żeby jej zadanie było widać. `crew`: osoby z zadaniami (kolejność dowolna, funkcja sortuje po id).
 * Zwraca spot dla każdego id. Czysta funkcja: zero losowości poza `createRng(subSeed(layout.seed, …))`, bez mutowania argumentów.
 *
 * Kratki muszą być osiągalne ze `layout.spawnPoints[0]` po siatce `nav` (palety w `nav` są przeszkodami). Dwie osoby nie dostają
 * tej samej kratki, dopóki starcza innych; gdy kandydaci zadania się skończą, osoba staje na sali (od jej środka), a gdy sali
 * zabraknie, na wejściu. Funkcja nie rzuca, także dla układu bez kasy, zaplecza, mebli albo wejścia.
 */
export function pickStaffSpots(
  layout: StoreLayout,
  nav: StaffNav,
  pallets: readonly PalletRef[],
  crew: readonly StaffAssignment[],
): Map<number, StaffSpot> {
  const spots = new Map<number, StaffSpot>();
  if (crew.length === 0) return spots;

  const ctx = makeCtx(layout, nav);
  const people = [...crew].sort((a, b) => a.id - b.id);
  const strip = unique(staffStripCells(layout));
  const cashier = cashierSpot(layout);
  const order = unloadOrder(pallets);
  const stocked = stockedFixtures(ctx);

  // Miejsce kasjera należy do pierwszej osoby z kasą, więc rezerwujemy je z góry: inne zadania (rozładunek przy palecie tuż
  // obok pasa, lista zapasowa) nie mogą go zająć, choćby ich osoba miała niższe id.
  const firstCashier = people.find((p) => p.task === 'kasa');
  const holdsCashierSpot = firstCashier !== undefined && cashier !== null && isFree(ctx, cashier.cell);
  if (holdsCashierSpot) ctx.taken.add(cellKey(cashier.cell));

  const served: Record<StaffDuty, number> = { kasa: 0, rozladunek: 0, wykladanie: 0, sprzatanie: 0, wolny: 0 };
  for (const { id, task } of people) {
    const k = served[task]++;
    if (holdsCashierSpot && task === 'kasa' && k === 0) {
      spots.set(id, { cell: { x: cashier.cell.x, y: cashier.cell.y }, heading: cashier.heading });
      continue;
    }
    switch (task) {
      case 'kasa': spots.set(id, place(ctx, cashierPlan(ctx, cashier, strip))); break;
      case 'rozladunek': spots.set(id, place(ctx, unloadPlan(ctx, order, k))); break;
      case 'wykladanie': spots.set(id, place(ctx, stockPlan(ctx, stocked, k))); break;
      case 'sprzatanie': spots.set(id, place(ctx, cleanPlan(ctx, id, strip))); break;
      case 'wolny': spots.set(id, place(ctx, idlePlan(ctx))); break;
    }
  }
  return spots;
}
