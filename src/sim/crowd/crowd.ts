import { cellKey, type Cell } from '@/sim/grid';
import { findPath } from '@/sim/nav/astar';
import { createRng, subSeed, type Rng } from '@/sim/rng';
import { FRONT_WALL_Y, type Facing, type Fixture, type FixtureKind, type StoreLayout } from '@/sim/store/types';
import { accessCells, isWalkable } from '@/sim/store/validate';

// Tłum demonstracyjny: klienci wchodzą z chodnika, oglądają meble, stoją w kolejce do kasy, płacą i wychodzą.
// Czysta symulacja bez renderowania. Etap 2 rozbuduje ją do prawdziwej symulacji klientów.
//
// Stan każdego agenta (`Agent.state`), w kolejności życia:
//   entering  od punktu spawnu po chodniku i przez wejście, aż do pierwszej kratki sali
//   browsing  marsz do mebla i 2–5 s przy nim, 1–3 razy (więcej, gdy kolejka jest pełna)
//   toQueue   marsz na koniec kolejki
//   queueing  stoi na swojej kratce kolejki i przesuwa się, gdy przed nim zwolni się miejsce
//   paying    stoi na checkoutQueue[0], 3–6 s
//   leaving   marsz do drugiego punktu spawnu
//   gone      dotarł; zostaje w `agents` do następnego `stepCrowd`, żeby renderer zdążył go zobaczyć
//
// Ruch to interpolacja liniowa między środkami kratek ścieżki A*. Kratki są rezerwowane: agent wchodzi
// do następnej kratki tylko wtedy, gdy jest wolna, i trzyma ją (razem z poprzednią) aż do połowy drogi.
// Po 2 s czekania szuka obejścia z zajętymi kratkami jako przeszkodami, po 5 s przechodzi „na ducha”
// (`ghost`), żeby nie zakleszczyć tłumu; duch nie ma wyłączności na kratkę i odzyskuje ją, gdy się zwolni.

export const SIM_STEP = 1 / 30;     // s
export const MAX_DT = 0.25;         // s; większe dt jest przycinane

export type AgentState = 'entering' | 'browsing' | 'toQueue' | 'queueing' | 'paying' | 'leaving' | 'gone';

export interface Agent {
  id: number;
  x: number; y: number;             // pozycja w kratkach (float, środek kratki = całkowita + 0.5)
  heading: number;                  // radiany, 0 = +x
  state: AgentState;
  moving: boolean;                  // do wyboru animacji walk/idle
  /** Przechodzi „na ducha” przez zajętą kratkę (wyjście z zakleszczenia): kolizje go nie dotyczą. */
  ghost: boolean;
  appearanceSeed: string;           // subSeed(seed, `agent:${id}`)
  speed: number;                    // kratki/s, 2.2–3.0
}

export interface CrowdOptions { targetCount: number; spawnPerMinute: number }

export interface Crowd {
  seed: string;
  time: number;                     // s; suma przyciętych dt
  agents: Agent[];
  /** Stan wewnętrzny symulacji; nie dotykać spoza tego pliku. */
  internal: CrowdInternals;
}

// --- Parametry zachowania ----------------------------------------------------------------------------

const SPEED_MIN = 2.2;
const SPEED_MAX = 3.0;
const VISITS_MIN = 1;
const VISITS_MAX = 3;
const BROWSE_TIME_MIN = 2;          // s przy meblu
const BROWSE_TIME_MAX = 5;
const PAY_TIME_MIN = 3;             // s przy kasie
const PAY_TIME_MAX = 6;
const REPLAN_AFTER = 2;             // s czekania na kratkę, po których szukamy obejścia (i co tyle sekund ponownie)
const GHOST_AFTER = 5;              // s czekania, po których agent przechodzi na ducha
const RELEASE_AT = 0.6;             // po tylu krawędzi agent zwalnia kratkę, z której wyszedł (> 0.5, więc floor(x) jest już w nowej)
const STEP_EPSILON = 1e-9;
const MAX_WALK_ITERATIONS = 8;      // bezpiecznik pętli ruchu w jednym kroku
const STAFF_LANE_MAX = 2;           // pas personelu ma 1–2 kratki (walidator układu)

const BROWSABLE_KINDS: readonly FixtureKind[] = ['gondola', 'wallShelf', 'fridge'];
const STAFF_BLOCK_KINDS: readonly FixtureKind[] = ['checkout', 'hotFood', 'coffee'];

const FACING_VECTOR: Record<Facing, Cell> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };

/** Kierunek patrzenia klienta stojącego przed meblem o danym froncie (w stronę mebla). */
const lookHeading = (facing: Facing): number => Math.atan2(-FACING_VECTOR[facing].y, -FACING_VECTOR[facing].x);

// --- Stan wewnętrzny ---------------------------------------------------------------------------------

type Goal = 'fixture' | 'queue' | 'slot' | 'exit';

/** Mebel do oglądania wraz z kratkami, na których wolno przy nim stanąć. */
interface Spot { fixture: Fixture; cells: Cell[]; look: number }

interface Nav {
  layout: StoreLayout;
  width: number;
  height: number;
  blocked: Uint8Array;              // 1 = klient tu nie wchodzi (niechodliwe albo pas personelu)
  queueIndex: Int16Array;           // indeks kratki w checkoutQueue albo −1
  spots: Spot[];
  tillLook: number;                 // kierunek patrzenia przy kasie
}

/** Wszystko, co agent wie o sobie poza polami `Agent` widocznymi dla renderera. */
interface Brain {
  rng: Rng;
  exitIndex: number;                // punkt spawnu, którym wyjdzie
  cell: Cell;                       // ostatnia osiągnięta kratka
  next: Cell | null;                // kratka, do której idzie (zarezerwowana)
  progress: number;                 // 0..1 na krawędzi cell → next
  path: Cell[];                     // ścieżka A* ze startem na [0]
  pathPos: number;                  // indeks następnej kratki do wejścia
  goal: Goal | null;
  goalCell: Cell | null;
  slot: number;                     // cel w kolejce, gdy goal === 'queue'
  spot: Spot | null;                // mebel, przy którym stoi albo do którego idzie
  visitsLeft: number;
  timer: number;                    // s do końca oglądania albo płacenia
  payTime: number;
  wait: number;                     // s czekania na zajętą kratkę
  replans: number;                  // ile razy w tym czekaniu szukano obejścia
}

interface CrowdInternals {
  seed: string;
  opts: CrowdOptions;
  nav: Nav;
  occ: Int32Array;                  // kratka → id agenta, który ją trzyma, albo −1
  queue: number[];                  // id stojących w kolejce, [0] płaci albo zaraz zapłaci
  brains: Map<number, Brain>;
  agents: Agent[];                  // ta sama tablica co Crowd.agents
  rng: Rng;                         // strumień `crowd`: wybór punktu spawnu
  nextId: number;
  spawnCredit: number;              // 1 = czas na kolejnego klienta
  pending: number;                  // s dt jeszcze nie zużyte na kroki
}

// --- Siatka nawigacyjna ------------------------------------------------------------------------------

/**
 * Kratki pasa personelu: podłoga przed frontem regału z papierosami, do kasy, hot-dogów albo kawy
 * za nim (1–2 kratki). Klienci tam nie wchodzą.
 */
export function staffStripCells(layout: StoreLayout): Cell[] {
  const kindAt = new Map<number, FixtureKind>();
  for (const f of layout.fixtures) {
    for (let dy = 0; dy < f.d; dy++) {
      for (let dx = 0; dx < f.w; dx++) kindAt.set(cellKey({ x: f.x + dx, y: f.y + dy }), f.kind);
    }
  }

  const strip: Cell[] = [];
  for (const shelf of layout.fixtures) {
    if (shelf.kind !== 'tobaccoShelf') continue;
    const v = FACING_VECTOR[shelf.facing];
    for (const front of accessCells(layout, shelf)) {
      const lane: Cell[] = [];
      let c = front;
      for (let step = 0; step <= STAFF_LANE_MAX; step++) {
        const kind = kindAt.get(cellKey(c));
        if (kind !== undefined) {
          if (STAFF_BLOCK_KINDS.includes(kind)) strip.push(...lane);   // pas zamknięty od drugiej strony: to zaplecze kasy
          break;
        }
        if (!isWalkable(layout, c.x, c.y)) break;
        lane.push(c);
        c = { x: c.x + v.x, y: c.y + v.y };
      }
    }
  }
  return strip;
}

function buildNav(layout: StoreLayout): Nav {
  const { width, depth: height } = layout;
  const at = (c: Cell): number => c.y * width + c.x;

  const blocked = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) blocked[y * width + x] = isWalkable(layout, x, y) ? 0 : 1;
  }
  for (const c of staffStripCells(layout)) blocked[at(c)] = 1;
  // wiersz 0 chodnika to pas mebli ulicznych (ławka, kosz, latarnie, drzewa z buildStreet): klienci tam nie wchodzą
  for (let x = 0; x < width; x++) blocked[x] = 1;

  const queueIndex = new Int16Array(width * height).fill(-1);
  layout.checkoutQueue.forEach((c, i) => { queueIndex[at(c)] = i; });

  // Kratki osiągalne z chodnika i wejścia (zbiór, więc kolejność przeszukiwania nie ma znaczenia).
  const reachable = new Uint8Array(width * height);
  const stack: number[] = [];
  for (const c of [...layout.spawnPoints, ...layout.entrance]) {
    if (blocked[at(c)] === 0 && reachable[at(c)] === 0) { reachable[at(c)] = 1; stack.push(at(c)); }
  }
  while (stack.length > 0) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (blocked[n] === 1 || reachable[n] === 1) continue;
      reachable[n] = 1;
      stack.push(n);
    }
  }

  const spots: Spot[] = [];
  for (const fixture of layout.fixtures) {
    if (!BROWSABLE_KINDS.includes(fixture.kind)) continue;
    const cells = accessCells(layout, fixture).filter((c) => reachable[at(c)] === 1 && queueIndex[at(c)] === -1);
    if (cells.length > 0) spots.push({ fixture, cells, look: lookHeading(fixture.facing) });
  }

  const till = layout.fixtures.find((f) => f.kind === 'checkout');
  return { layout, width, height, blocked, queueIndex, spots, tillLook: till ? lookHeading(till.facing) : 0 };
}

// --- Tworzenie i krok --------------------------------------------------------------------------------

/** Pusty tłum dla układu `layout`. Strumienie losowości: `crowd` (punkt spawnu), `agent:<id>:plan` (zachowanie agenta). */
export function createCrowd(layout: StoreLayout, seed: string, opts: CrowdOptions): Crowd {
  const nav = buildNav(layout);
  const agents: Agent[] = [];
  const internal: CrowdInternals = {
    seed,
    opts: { ...opts },
    nav,
    occ: new Int32Array(nav.width * nav.height).fill(-1),
    queue: [],
    brains: new Map(),
    agents,
    rng: createRng(subSeed(seed, 'crowd')),
    nextId: 1,
    spawnCredit: opts.spawnPerMinute > 0 ? 1 : 0,   // pierwszy klient od razu
    pending: 0,
  };
  return { seed, time: 0, agents, internal };
}

/** Przycina dt do MAX_DT i wykonuje kroki SIM_STEP. Usuwa agentów 'gone'. */
export function stepCrowd(crowd: Crowd, layout: StoreLayout, dt: number): void {
  const s = crowd.internal;
  if (s.nav.layout !== layout) {
    const nav = buildNav(layout);
    if (nav.width * nav.height !== s.occ.length) throw new Error('stepCrowd: układ o innych wymiarach niż w createCrowd');
    s.nav = nav;
  }
  removeGone(s);

  const clamped = dt > 0 ? Math.min(dt, MAX_DT) : 0;
  crowd.time += clamped;
  s.pending += clamped;
  while (s.pending >= SIM_STEP - STEP_EPSILON) {
    s.pending -= SIM_STEP;
    simStep(s);
  }
  if (s.pending < 0) s.pending = 0;
}

function simStep(s: CrowdInternals): void {
  for (let i = 0; i < s.agents.length; i++) stepAgent(s, s.agents[i]!);
  spawnStep(s);
}

/** Agentów 'gone' z poprzedniego wywołania zdejmujemy dopiero teraz: do tej pory trzymali kratkę i byli widoczni. */
function removeGone(s: CrowdInternals): void {
  let kept = 0;
  for (const a of s.agents) {
    if (a.state === 'gone') {
      const b = s.brains.get(a.id)!;
      releaseCell(s, a, b.cell);
      s.brains.delete(a.id);
    } else {
      s.agents[kept++] = a;
    }
  }
  s.agents.length = kept;
}

// --- Spawn -------------------------------------------------------------------------------------------

function spawnStep(s: CrowdInternals): void {
  const { spawnPerMinute, targetCount } = s.opts;
  if (spawnPerMinute <= 0) return;
  s.spawnCredit = Math.min(s.spawnCredit + (SIM_STEP * spawnPerMinute) / 60, 1);
  if (s.spawnCredit < 1) return;

  let live = 0;
  for (const a of s.agents) if (a.state !== 'gone') live++;
  if (live >= targetCount) return;

  const points = s.nav.layout.spawnPoints;
  const first = s.rng.int(0, points.length);
  for (let k = 0; k < points.length; k++) {
    const index = (first + k) % points.length;
    if (s.occ[cellAt(s, points[index]!)] !== -1) continue;
    spawnAgent(s, index);
    s.spawnCredit -= 1;
    return;
  }
}

function spawnAgent(s: CrowdInternals, spawnIndex: number): void {
  const points = s.nav.layout.spawnPoints;
  const cell = points[spawnIndex]!;
  const id = s.nextId++;
  const rng = createRng(subSeed(s.seed, `agent:${id}:plan`));

  const agent: Agent = {
    id,
    x: cell.x + 0.5,
    y: cell.y + 0.5,
    heading: 0,
    state: 'entering',
    moving: false,
    ghost: false,
    appearanceSeed: subSeed(s.seed, `agent:${id}`),
    speed: rng.range(SPEED_MIN, SPEED_MAX),
  };
  const brain: Brain = {
    rng,
    exitIndex: (spawnIndex + 1) % points.length,
    cell,
    next: null,
    progress: 0,
    path: [],
    pathPos: 0,
    goal: null,
    goalCell: null,
    slot: 0,
    spot: null,
    visitsLeft: Math.min(rng.int(VISITS_MIN, VISITS_MAX + 1), s.nav.spots.length),
    timer: 0,
    payTime: rng.range(PAY_TIME_MIN, PAY_TIME_MAX),
    wait: 0,
    replans: 0,
  };

  s.occ[cellAt(s, cell)] = id;
  s.brains.set(id, brain);
  s.agents.push(agent);
  chooseNextGoal(s, agent, brain);
  const first = brain.path[1];
  if (first) agent.heading = Math.atan2(first.y - cell.y, first.x - cell.x);
}

// --- Krok agenta -------------------------------------------------------------------------------------

function stepAgent(s: CrowdInternals, a: Agent): void {
  a.moving = false;
  if (a.state === 'gone') return;
  const b = s.brains.get(a.id)!;
  if (a.ghost && b.next === null) reclaimCell(s, a, b);

  switch (a.state) {
    case 'paying':
      b.timer -= SIM_STEP;
      if (b.timer <= 0) finishPaying(s, a, b);
      break;
    case 'queueing':
      stepQueueing(s, a, b);
      break;
    case 'browsing':
      if (b.timer > 0) {
        b.timer -= SIM_STEP;
        if (b.timer <= 0) { b.timer = 0; chooseNextGoal(s, a, b); }
      } else {
        walk(s, a, b);
      }
      break;
    default:
      walk(s, a, b);
  }
  syncPosition(a, b);
}

function syncPosition(a: Agent, b: Brain): void {
  a.x = b.cell.x + 0.5;
  a.y = b.cell.y + 0.5;
  if (b.next !== null) {
    a.x += (b.next.x - b.cell.x) * b.progress;
    a.y += (b.next.y - b.cell.y) * b.progress;
  }
}

/** Duch stojący w miejscu odzyskuje wyłączność na kratkę, gdy ta się zwolni. */
function reclaimCell(s: CrowdInternals, a: Agent, b: Brain): void {
  const i = cellAt(s, b.cell);
  if (s.occ[i] === -1) s.occ[i] = a.id;
  if (s.occ[i] === a.id) a.ghost = false;
}

// --- Ruch po ścieżce ---------------------------------------------------------------------------------

function walk(s: CrowdInternals, a: Agent, b: Brain): void {
  let budget = a.speed * SIM_STEP;
  let moved = false;
  for (let iteration = 0; iteration < MAX_WALK_ITERATIONS; iteration++) {
    if (b.next === null) {
      const target = b.path[b.pathPos];
      if (target === undefined) {
        if (reachGoal(s, a, b)) break;
        continue;
      }
      if (!startMove(s, a, b, target)) break;
    }

    const remaining = 1 - b.progress;
    if (budget < remaining) {
      b.progress += budget;
      if (b.progress >= RELEASE_AT) releaseCell(s, a, b.cell);
      moved = true;
      break;
    }
    budget -= remaining;
    moved = true;
    completeMove(s, a, b);
    if (cellReached(s, a, b)) break;
  }
  a.moving = moved;
}

/** Rezerwuje kratkę `target` i zaczyna do niej iść. Zajęta: czeka, po 2 s szuka obejścia, po 5 s idzie na ducha. */
function startMove(s: CrowdInternals, a: Agent, b: Brain, target: Cell): boolean {
  const i = cellAt(s, target);
  const holder = s.occ[i]!;
  if (holder === -1 || holder === a.id) {
    s.occ[i] = a.id;
  } else {
    b.wait += SIM_STEP;
    if (b.wait < GHOST_AFTER) {
      if (a.state === 'toQueue' && b.slot !== tailSlot(s)) routeToQueueTail(s, a, b);
      else if (b.wait >= REPLAN_AFTER * (b.replans + 1)) replanAround(s, a, b);
      return false;
    }
    a.ghost = true;
  }
  b.next = target;
  b.progress = 0;
  b.wait = 0;
  b.replans = 0;
  a.heading = Math.atan2(target.y - b.cell.y, target.x - b.cell.x);
  return true;
}

function completeMove(s: CrowdInternals, a: Agent, b: Brain): void {
  releaseCell(s, a, b.cell);
  b.cell = b.next!;
  b.next = null;
  b.progress = 0;
  b.pathPos++;

  const i = cellAt(s, b.cell);
  if (s.occ[i] === -1) s.occ[i] = a.id;   // duch zajmuje kratkę, jeśli akurat jest wolna
  a.ghost = s.occ[i] !== a.id;
}

/** Zdarzenia na środku kratki. Zwraca true, gdy agent ma na ten krok skończyć ruch. */
function cellReached(s: CrowdInternals, a: Agent, b: Brain): boolean {
  if (a.state === 'entering' && b.cell.y > FRONT_WALL_Y) {
    a.state = b.goal === 'queue' ? 'toQueue' : 'browsing';
    return true;
  }
  // koniec kolejki mógł się przesunąć, odkąd agent ruszył
  if (a.state === 'toQueue' && b.goal === 'queue' && b.slot !== tailSlot(s)) routeToQueueTail(s, a, b);
  return false;
}

/** Agent stoi na końcu ścieżki. Zwraca true, gdy ma na ten krok skończyć ruch. */
function reachGoal(s: CrowdInternals, a: Agent, b: Brain): boolean {
  switch (b.goal) {
    case 'fixture':
      b.timer = b.rng.range(BROWSE_TIME_MIN, BROWSE_TIME_MAX);
      if (b.spot) a.heading = b.spot.look;
      return true;
    case 'queue': {
      const line = s.nav.layout.checkoutQueue;
      const slot = tailSlot(s);
      if (sameCell(b.cell, line[slot]!) && s.queue.length < line.length) {
        s.queue.push(a.id);
        a.state = 'queueing';
        return true;
      }
      return !routeToQueueTail(s, a, b);   // ktoś zajął ostatnie miejsce: idziemy za nim
    }
    case 'exit':
      a.state = 'gone';
      return true;
    default:
      return true;
  }
}

// --- Wybór celu i planowanie trasy -------------------------------------------------------------------

/** Po wejściu i po każdym obejrzanym meblu: kolejny mebel albo koniec kolejki. */
function chooseNextGoal(s: CrowdInternals, a: Agent, b: Brain): void {
  const wantsMore = b.visitsLeft > 0 || !queueHasRoom(s);   // pełna kolejka: rozglądamy się dalej
  if (wantsMore && s.nav.spots.length > 0) {
    const { spot, cell } = pickDestination(s, b);
    if (routeTo(s, a, b, cell, 'fixture')) {
      b.spot = spot;
      b.visitsLeft = Math.max(0, b.visitsLeft - 1);
      setWalkingState(a, 'browsing');
      return;
    }
  }
  if (routeToQueueTail(s, a, b)) setWalkingState(a, 'toQueue');
}

/** 'entering' przechodzi w następny stan dopiero za progiem sklepu (cellReached). */
function setWalkingState(a: Agent, state: AgentState): void {
  if (a.state !== 'entering') a.state = state;
}

function queueHasRoom(s: CrowdInternals): boolean {
  let inLine = 0;
  for (const a of s.agents) if (a.state === 'toQueue' || a.state === 'queueing' || a.state === 'paying') inLine++;
  return inLine < s.nav.layout.checkoutQueue.length;
}

/** Czy kratka jest wolna i nikt inny nie idzie tu oglądać mebla. */
function isFreeToBrowse(s: CrowdInternals, self: Brain, c: Cell): boolean {
  if (s.occ[cellAt(s, c)] !== -1) return false;
  for (const other of s.brains.values()) {
    if (other !== self && other.goal === 'fixture' && other.goalCell !== null && sameCell(other.goalCell, c)) return false;
  }
  return true;
}

/** Losowy mebel (inny niż ostatni) i wolna kratka przy nim; gdy wszystko zajęte, dowolna kratka i czekanie. */
function pickDestination(s: CrowdInternals, b: Brain): { spot: Spot; cell: Cell } {
  const others = s.nav.spots.filter((spot) => spot !== b.spot);
  const candidates = b.rng.shuffle(others.length > 0 ? others : s.nav.spots);
  for (const spot of candidates) {
    const free = spot.cells.filter((c) => isFreeToBrowse(s, b, c));
    if (free.length > 0) return { spot, cell: b.rng.pick(free) };
  }
  const spot = candidates[0]!;
  return { spot, cell: b.rng.pick(spot.cells) };
}

/** Pierwsza wolna kratka kolejki (agenci w kolejce zajmują kolejne od kasy). */
function tailSlot(s: CrowdInternals): number {
  return Math.min(s.queue.length, s.nav.layout.checkoutQueue.length - 1);
}

function routeToQueueTail(s: CrowdInternals, a: Agent, b: Brain): boolean {
  const slot = tailSlot(s);
  if (!routeTo(s, a, b, s.nav.layout.checkoutQueue[slot]!, 'queue')) return false;
  b.slot = slot;
  return true;
}

function routeTo(s: CrowdInternals, a: Agent, b: Brain, goalCell: Cell, goal: Goal): boolean {
  const path = findRoute(s, a, b.cell, goalCell, false);
  if (path === null) return false;
  setRoute(b, path, goal, goalCell);
  return true;
}

function setRoute(b: Brain, path: Cell[], goal: Goal, goalCell: Cell): void {
  b.path = path;
  b.pathPos = 1;                    // [0] to kratka, na której agent już stoi
  b.goal = goal;
  b.goalCell = goalCell;
  b.wait = 0;
  b.replans = 0;
}

/**
 * A* po kratkach chodliwych. Stojących w kolejce omijamy (kolejka to ściana ludzi), a cel jest zawsze dozwolony.
 * Z `avoidAgents` zajęte kratki są dodatkowo przeszkodami (obejście); bez niego, gdy brak drogi z kolejką
 * jako przeszkodą, szukamy jeszcze raz bez niej.
 */
function findRoute(s: CrowdInternals, a: Agent, from: Cell, goal: Cell, avoidAgents: boolean): Cell[] | null {
  const { width, height, blocked, queueIndex } = s.nav;
  const { occ } = s;
  const goalIndex = goal.y * width + goal.x;
  const standing = s.queue.length;

  const path = findPath(width, height, (x, y) => {
    const i = y * width + x;
    if (blocked[i] === 1) return true;
    if (i === goalIndex) return false;
    const q = queueIndex[i]!;
    if (q >= 0 && q < standing) return true;
    const holder = occ[i]!;
    if (holder === -1 || holder === a.id) return false;
    return avoidAgents || s.brains.get(holder)?.next === null;   // stojących omijamy zawsze, idących tylko przy obejściu
  }, from, goal);
  if (path !== null || avoidAgents) return path;
  return findPath(width, height, (x, y) => blocked[y * width + x] === 1, from, goal);
}

/** Obejście zajętych kratek; dla zajętego mebla dodatkowo inna wolna kratka dostępu. */
function replanAround(s: CrowdInternals, a: Agent, b: Brain): void {
  b.replans++;
  let goal = b.goalCell!;
  if (b.goal === 'fixture' && b.spot !== null && s.occ[cellAt(s, goal)] !== -1) {
    const free = b.spot.cells.filter((c) => s.occ[cellAt(s, c)] === -1);
    if (free.length > 0) goal = b.rng.pick(free);
  }
  const path = findRoute(s, a, b.cell, goal, true);
  if (path !== null) {
    b.path = path;
    b.pathPos = 1;
    b.goalCell = goal;
  }
}

// --- Kolejka -----------------------------------------------------------------------------------------

/** Agent w kolejce: idzie na kratkę odpowiadającą jego miejscu, a gdy jest pierwszy i stoi przy kasie, płaci. */
function stepQueueing(s: CrowdInternals, a: Agent, b: Brain): void {
  const line = s.nav.layout.checkoutQueue;
  const place = s.queue.indexOf(a.id);
  const slot = line[place]!;

  if (b.next !== null || !sameCell(b.cell, slot)) {
    const planned = b.goal === 'slot' && b.goalCell !== null && sameCell(b.goalCell, slot) && b.pathPos < b.path.length;
    if (b.next === null && !planned && !routeToSlot(s, a, b, slot)) return;
    walk(s, a, b);
    return;
  }

  if (place === 0) {
    a.state = 'paying';
    b.timer = b.payTime;
    a.heading = s.nav.tillLook;
  } else {
    const ahead = line[place - 1]!;
    a.heading = Math.atan2(ahead.y - slot.y, ahead.x - slot.x);
  }
}

function routeToSlot(s: CrowdInternals, a: Agent, b: Brain, slot: Cell): boolean {
  const adjacent = Math.abs(b.cell.x - slot.x) + Math.abs(b.cell.y - slot.y) === 1;
  const path = adjacent ? [b.cell, slot] : findRoute(s, a, b.cell, slot, false);
  if (path === null) return false;
  setRoute(b, path, 'slot', slot);
  return true;
}

/** Koniec płacenia: trasa do drugiego punktu spawnu (planowana, póki kolejka jeszcze stoi), zejście z kolejki. */
function finishPaying(s: CrowdInternals, a: Agent, b: Brain): void {
  const exit = s.nav.layout.spawnPoints[b.exitIndex]!;
  const routed = routeTo(s, a, b, exit, 'exit');
  const place = s.queue.indexOf(a.id);
  if (place >= 0) s.queue.splice(place, 1);
  a.state = routed ? 'leaving' : 'gone';
}

// --- Pomocnicze --------------------------------------------------------------------------------------

function cellAt(s: CrowdInternals, c: Cell): number {
  return c.y * s.nav.width + c.x;
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Zwalnia kratkę tylko wtedy, gdy trzyma ją ten agent. */
function releaseCell(s: CrowdInternals, a: Agent, c: Cell): void {
  const i = cellAt(s, c);
  if (s.occ[i] === a.id) s.occ[i] = -1;
}
