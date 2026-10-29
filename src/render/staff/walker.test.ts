import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cell } from '@/sim/grid';
import * as astar from '@/sim/nav/astar';
import { generateStore } from '@/sim/store/generateStore';
import type { StoreLayout } from '@/sim/store/types';
import { buildStaffNav, type StaffNav } from './staffNav';
import { NO_PATH_RETRY_S, STAFF_WALK_SPEED, StaffWalker } from './walker';

// `findPath` owijamy w szpiega, żeby policzyć, ile razy walker planował drogę (te same dane, ten sam wynik).
vi.mock('@/sim/nav/astar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/sim/nav/astar')>();
  return { ...actual, findPath: vi.fn(actual.findPath) };
});
const findPathSpy = vi.mocked(astar.findPath);
beforeEach(() => { findPathSpy.mockClear(); });   // klamry: zwrócona funkcja byłaby uznana za sprzątanie

// Blok, kamienica i pawilon-lub-blok z różnym wejściem; start na chodniku, cel na zapleczu (długa droga z zakrętami).
const SEEDS = ['alfa', 'beta-12', 'kamienica-3'];
const DT = 1 / 60;

interface Scene { seed: string; layout: StoreLayout; nav: StaffNav; start: Cell; goal: Cell; route: Cell[] }
const backroomCell = (layout: StoreLayout): Cell => {
  for (let y = 0; y < layout.depth; y++) {
    for (let x = 0; x < layout.width; x++) if (layout.cells[y * layout.width + x] === 'backroom') return { x, y };
  }
  throw new Error('brak zaplecza');
};
const scenes: Scene[] = SEEDS.map((seed) => {
  const layout = generateStore(seed);
  const nav = buildStaffNav(layout, []);
  const start = layout.spawnPoints[0]!;
  const goal = backroomCell(layout);
  const route = astar.findPath(nav.width, nav.depth, nav.blocked, start, goal);
  if (route === null) throw new Error(`brak drogi w układzie ${seed}`);
  return { seed, layout, nav, start, goal, route };
});

const centre = (c: Cell): { x: number; y: number } => ({ x: c.x + 0.5, y: c.y + 0.5 });
const cellOf = (w: StaffWalker): Cell => ({ x: Math.floor(w.x), y: Math.floor(w.y) });
const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;
/** Kroki `dt` aż do dojścia; zwraca czas marszu (s). Przerywa po `limit` sekundach. */
const walkToGoal = (w: StaffWalker, nav: StaffNav, dt = DT, limit = 120): number => {
  let t = 0;
  while (!w.atGoal && t < limit) { w.step(dt, nav); t += dt; }
  return t;
};
const snapshot = (w: StaffWalker) => ({ x: w.x, y: w.y, heading: w.heading, moving: w.moving, goal: w.goal });

describe('układy użyte w testach', () => {
  it('obejmują blok i kamienicę, a droga na zaplecze jest długa i ma zakręty', () => {
    expect(new Set(scenes.map((s) => s.layout.lot.kind))).toEqual(new Set(['blok', 'kamienica']));
    for (const s of scenes) {
      expect(s.route.length).toBeGreaterThan(20);
      const turns = s.route.slice(2).filter((c, i) => (c.x - s.route[i + 1]!.x) !== (s.route[i + 1]!.x - s.route[i]!.x)
        || (c.y - s.route[i + 1]!.y) !== (s.route[i + 1]!.y - s.route[i]!.y));
      expect(turns.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('StaffWalker: stan początkowy', () => {
  it('stoi na środku kratki startu, patrzy tam, gdzie kazano, i nie ma celu', () => {
    const w = new StaffWalker({ x: 3, y: 7 }, 1.5);
    expect(w.x).toBe(3.5);
    expect(w.y).toBe(7.5);
    expect(w.heading).toBe(1.5);
    expect(w.moving).toBe(false);
    expect(w.goal).toBeNull();
    expect(w.atGoal).toBe(false);
  });

  it('tempo marszu to STAFF_WALK_SPEED, chyba że podano inne; śmieciowe tempo wraca do domyślnego', () => {
    expect(STAFF_WALK_SPEED).toBe(2.6);
    const { nav, start, goal, route } = scenes[0]!;
    const time = (speed?: number): number => {
      const w = new StaffWalker(start, 0, speed);
      w.setGoal(goal, 0, nav);
      return walkToGoal(w, nav);
    };
    const base = (route.length - 1) / STAFF_WALK_SPEED;
    expect(time()).toBeCloseTo(base, 1);
    expect(time(5.2)).toBeCloseTo(base / 2, 1);
    expect(time(Number.NaN)).toBeCloseTo(base, 1);
    expect(time(-3)).toBeCloseTo(base, 1);
  });

  it('bez celu step nic nie robi', () => {
    const { nav, start } = scenes[0]!;
    const w = new StaffWalker(start, 0.3);
    const before = snapshot(w);
    w.step(5, nav);
    expect(snapshot(w)).toEqual(before);
    expect(findPathSpy).not.toHaveBeenCalled();
  });
});

describe('StaffWalker: marsz do celu', () => {
  it.each(scenes)('$seed: dochodzi do celu w czasie ≈ długość ścieżki / prędkość i staje na jego środku', ({ nav, start, goal, route }) => {
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 1.2345, nav);
    expect(w.goal).toEqual(goal);
    expect(w.atGoal).toBe(false);
    const elapsed = walkToGoal(w, nav);
    expect(Math.abs(elapsed - (route.length - 1) / STAFF_WALK_SPEED)).toBeLessThanOrEqual(DT + 1e-9);
    expect({ x: w.x, y: w.y }).toEqual(centre(goal));
    expect(w.heading).toBe(1.2345);
    expect(w.moving).toBe(false);
    expect(w.atGoal).toBe(true);
  });

  it.each(scenes)('$seed: w marszu heading zgadza się z kierunkiem odcinka, po dojściu to kierunek zadania', ({ nav, start, goal }) => {
    const w = new StaffWalker(start, 2.5);
    w.setGoal(goal, -0.7, nav);
    let straightSteps = 0;
    const headings = new Set<number>();
    while (!w.atGoal) {
      const px = w.x;
      const py = w.y;
      w.step(DT, nav);
      const dx = w.x - px;
      const dy = w.y - py;
      if (w.atGoal) break;
      expect(w.moving).toBe(true);
      // Krok, w którym postać skręciła na środku kratki, ma przesunięcie po skosie; reszta leży na osi odcinka.
      if (Math.min(Math.abs(dx), Math.abs(dy)) < 1e-9 && Math.hypot(dx, dy) > 0) {
        expect(w.heading).toBeCloseTo(Math.atan2(dy, dx), 9);
        headings.add(Math.round(w.heading * 1000));
        straightSteps++;
      }
    }
    expect(straightSteps).toBeGreaterThan(100);
    expect(headings.size).toBeGreaterThanOrEqual(2);  // droga ma zakręty, więc kierunek się zmieniał
    expect(w.heading).toBe(-0.7);
  });

  it('pierwszy krok od razu patrzy w stronę pierwszego odcinka', () => {
    const { nav, start, goal, route } = scenes[0]!;
    const w = new StaffWalker(start, 3);
    w.setGoal(goal, 0, nav);
    w.step(0.01, nav);
    const next = route[1]!;
    expect(w.heading).toBeCloseTo(Math.atan2(next.y - start.y, next.x - start.x), 9);
    expect(w.moving).toBe(true);
  });

  it('start równy celowi: stoi, patrzy zgodnie z zadaniem i nie planuje drugi raz', () => {
    const { nav, start } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(start, 2, nav);
    expect(w.atGoal).toBe(true);
    expect(w.heading).toBe(2);
    expect(w.moving).toBe(false);
    w.step(1, nav);
    expect(w.atGoal).toBe(true);
    expect(findPathSpy).toHaveBeenCalledTimes(1);
  });

  it('nowy cel w kratce, w której postać już stoi (poza środkiem): dochodzi do środka i patrzy zgodnie z zadaniem', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, nav);
    w.step(0.5, nav);                                   // (1,5; 1,8): w kratce (1,1), poza jej środkiem
    expect(cellOf(w)).toEqual({ x: 1, y: 1 });
    expect(w.y).not.toBe(1.5);
    w.setGoal({ x: 1, y: 1 }, 0.8, nav);
    expect(w.atGoal).toBe(false);
    w.step(5, nav);
    expect(w.atGoal).toBe(true);
    expect({ x: w.x, y: w.y }).toEqual({ x: 1.5, y: 1.5 });
    expect(w.heading).toBe(0.8);
    expect(findPathSpy).toHaveBeenCalledTimes(2);
  });

  it('postać na zablokowanej kratce może z niej wyjść (start nie musi być wolny)', () => {
    const { layout, start, goal } = scenes[0]!;
    const nav = buildStaffNav(layout, [start]);
    expect(nav.blocked(start.x, start.y)).toBe(true);
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, nav);
    walkToGoal(w, nav);
    expect(w.atGoal).toBe(true);
  });
});

describe('StaffWalker: ten sam cel', () => {
  it('ten sam cel (także co klatkę) nie planuje drogi od nowa', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, nav);
    expect(findPathSpy).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i++) {
      w.setGoal({ x: goal.x, y: goal.y }, 0, nav);   // nowy obiekt o tych samych współrzędnych
      w.step(DT, nav);
    }
    expect(findPathSpy).toHaveBeenCalledTimes(1);
    const before = { x: w.x, y: w.y };
    expect(before.x !== centre(start).x || before.y !== centre(start).y).toBe(true);   // idzie dalej
    w.setGoal({ x: goal.x + 1, y: goal.y }, 0, nav);                                    // inny cel: planuje
    expect(findPathSpy).toHaveBeenCalledTimes(2);
  });

  it('cel jest kopiowany: zmiana obiektu przekazanego do setGoal nie rusza celu walkera', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    const given = { x: goal.x, y: goal.y };
    w.setGoal(given, 0, nav);
    given.x += 5;
    given.y += 5;
    expect(w.goal).toEqual(goal);
    walkToGoal(w, nav);
    expect({ x: w.x, y: w.y }).toEqual(centre(goal));
  });

  it('ten sam cel ze zmienionym kierunkiem: w marszu zmienia dopiero kierunek po dojściu, na miejscu od razu', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0.5, nav);
    w.step(0.5, nav);
    const walking = w.heading;
    w.setGoal(goal, -2, nav);
    expect(w.heading).toBe(walking);                  // w marszu patrzy w stronę ruchu
    walkToGoal(w, nav);
    expect(w.heading).toBe(-2);                       // po dojściu: najnowszy kierunek
    w.setGoal(goal, 1, nav);
    expect(w.heading).toBe(1);                        // stoi na celu: obraca się od razu
    expect(w.atGoal).toBe(true);
    expect(findPathSpy).toHaveBeenCalledTimes(1);
  });

  it('nowy cel w trakcie marszu liczy drogę od miejsca postaci i zaczyna prosto, bez cofania na środek jej kratki', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, nav);
    w.step(0.5, nav);                                   // 1,3 kratki: za zakrętem, 0,3 kratki w dół od środka (1,1)
    const here = { x: w.x, y: w.y };
    expect(cellOf(w)).toEqual({ x: 1, y: 1 });
    const side = { x: 3, y: 1 };                        // w poprzek dotychczasowego marszu
    w.setGoal(side, 0, nav);
    expect({ x: w.x, y: w.y }).toEqual(here);           // bez skoku w pozycji
    expect(findPathSpy.mock.calls.at(-1)![3]).toEqual({ x: 1, y: 1 });
    const planned = findPathSpy.mock.results.at(-1)!.value as Cell[];
    expect(planned.slice(0, 2)).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    // Pierwszy odcinek prowadzi z miejsca postaci prosto do środka następnej kratki (po skosie względem osi siatki), a nie
    // najpierw z powrotem na środek kratki, w której stoi (zygzak).
    w.step(0.01, nav);
    expect(w.heading).toBeCloseTo(Math.atan2(1.5 - here.y, 2.5 - here.x), 9);
    walkToGoal(w, nav);
    expect(w.atGoal).toBe(true);
    expect({ x: w.x, y: w.y }).toEqual(centre(side));
  });
});

describe('StaffWalker: zmiany siatki', () => {
  it.each(scenes)('$seed: przeszkoda na następnej kratce ścieżki → obejście, a cel i tak osiągnięty', ({ layout, nav, start, goal, route }) => {
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, nav);
    w.step(0.5, nav);                                   // 1,3 kratki: między route[1] a route[2]
    expect(cellOf(w)).toEqual(route[1]);
    const blockedCell = route[2]!;
    const nav2 = buildStaffNav(layout, [blockedCell]);
    const visited: Cell[] = [];
    let t = 0;
    while (!w.atGoal && t < 120) {
      w.step(DT, nav2);
      t += DT;
      visited.push(cellOf(w));
    }
    expect(w.atGoal).toBe(true);
    expect(findPathSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(visited.some((c) => sameCell(c, blockedCell))).toBe(false);
    for (const c of visited) expect(nav2.blocked(c.x, c.y)).toBe(false);
  });

  it('przeszkoda dalej na ścieżce nie wymusza planowania, dopóki postać do niej nie dojdzie', () => {
    const { layout, nav, start, goal, route } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, nav);
    w.step(0.5, nav);
    const far = route[10]!;
    const nav2 = buildStaffNav(layout, [far]);
    for (let i = 0; i < 30; i++) w.step(DT, nav2);
    expect(findPathSpy).toHaveBeenCalledTimes(1);
    const visited: Cell[] = [];
    while (!w.atGoal) { w.step(DT, nav2); visited.push(cellOf(w)); }
    expect(findPathSpy.mock.calls.length).toBeGreaterThanOrEqual(2);   // przy dojściu do przeszkody planuje
    expect(visited.some((c) => sameCell(c, far))).toBe(false);
  });

  it('repath() wymusza planowanie od nowa przy następnym step, z siatką podaną w tym step', () => {
    const { layout, nav, start, goal, route } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, nav);
    w.step(0.5, nav);
    const far = route[10]!;
    const nav2 = buildStaffNav(layout, [far]);
    w.repath();
    expect(findPathSpy).toHaveBeenCalledTimes(1);       // samo repath() niczego nie liczy (nie ma siatki)
    w.step(DT, nav2);
    expect(findPathSpy).toHaveBeenCalledTimes(2);
    w.step(DT, nav2);
    expect(findPathSpy).toHaveBeenCalledTimes(2);       // flaga zużyta
    const visited: Cell[] = [];
    while (!w.atGoal) { w.step(DT, nav2); visited.push(cellOf(w)); }
    expect(visited.some((c) => sameCell(c, far))).toBe(false);
  });

  it('repath() bez celu nic nie psuje', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.repath();
    w.step(1, nav);
    expect(findPathSpy).not.toHaveBeenCalled();
    w.setGoal(goal, 0, nav);
    w.step(DT, nav);
    expect(findPathSpy).toHaveBeenCalledTimes(1);
  });

  it.each(scenes)('$seed: brak drogi → stoi i ponawia planowanie co 1 s; po zdjęciu przeszkody rusza', ({ layout, nav, start, goal }) => {
    const wall = buildStaffNav(layout, layout.entrance);   // wejście zablokowane: sala odcięta od chodnika
    const w = new StaffWalker(start, 0.4);
    w.setGoal(goal, 0, wall);
    expect(findPathSpy).toHaveBeenCalledTimes(1);
    expect(w.moving).toBe(false);
    expect(w.atGoal).toBe(false);
    const before = snapshot(w);
    for (let i = 0; i < 20; i++) w.step(0.25, wall);    // 5 s
    expect(snapshot(w)).toEqual(before);
    expect(findPathSpy).toHaveBeenCalledTimes(1 + Math.floor(5 / NO_PATH_RETRY_S));

    // Przeszkoda znika. Ostatnia próba była przed chwilą (po 20. kroku), więc najbliższa za 1 s: trzy kroki po 0,25 s stoi,
    // czwarty zaplanuje drogę, a marsz zacznie się w następnym.
    for (let i = 0; i < 3; i++) w.step(0.25, nav);
    expect(w.moving).toBe(false);
    expect({ x: w.x, y: w.y }).toEqual(centre(start));
    expect(findPathSpy).toHaveBeenCalledTimes(6);
    w.step(0.25, nav);
    expect(findPathSpy).toHaveBeenCalledTimes(7);
    expect(w.moving).toBe(true);
    expect({ x: w.x, y: w.y }).toEqual(centre(start));   // czas oczekiwania nie jest czasem marszu
    w.step(0.25, nav);
    expect(Math.hypot(w.x - centre(start).x, w.y - centre(start).y)).toBeCloseTo(0.25 * STAFF_WALK_SPEED, 9);
    walkToGoal(w, nav);
    expect(w.atGoal).toBe(true);
  });

  it('po terminie ponownego planowania na marsz zostaje tylko czas, który upłynął po terminie', () => {
    const { layout, nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, buildStaffNav(layout, layout.entrance));
    for (let i = 0; i < 3; i++) w.step(0.3, nav);       // 0,9 s: jeszcze czeka
    expect(w.moving).toBe(false);
    w.step(0.3, nav);                                   // termin minął o 0,2 s
    expect(w.moving).toBe(true);
    expect(Math.hypot(w.x - centre(start).x, w.y - centre(start).y)).toBeCloseTo(0.2 * STAFF_WALK_SPEED, 9);
  });

  it.each(scenes)('$seed: droga odcięta w trakcie marszu → staje (moving = false), a po odblokowaniu idzie dalej', ({ layout, nav, start, goal, route }) => {
    const wall = buildStaffNav(layout, layout.entrance);
    const door = route.findIndex((c) => layout.entrance.some((e) => sameCell(e, c)));
    expect(door).toBeGreaterThan(1);
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, nav);
    let guard = 0;
    while (!sameCell(cellOf(w), route[door - 1]!) && guard++ < 10_000) w.step(DT, nav);
    expect(w.moving).toBe(true);
    w.step(DT, wall);                                   // ścieżka prowadziła przez kratkę, która właśnie się zamknęła
    for (let i = 0; i < 3; i++) w.step(0.25, wall);
    expect(w.moving).toBe(false);
    const parked = { x: w.x, y: w.y };
    for (let i = 0; i < 12; i++) w.step(0.25, wall);
    expect({ x: w.x, y: w.y }).toEqual(parked);
    expect(w.moving).toBe(false);
    expect(sameCell(cellOf(w), route[door]!)).toBe(false);   // przez zamkniętą kratkę nie przeszła
    for (let i = 0; i < 4; i++) w.step(0.25, nav);
    walkToGoal(w, nav);
    expect(w.atGoal).toBe(true);
  });

  it('zablokowana kratka celu (np. paleta na miejscu): stoi, po zdjęciu palety dochodzi', () => {
    const { layout, nav, start, goal } = scenes[0]!;
    const withPallet = buildStaffNav(layout, [goal]);
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0.9, withPallet);
    for (let i = 0; i < 8; i++) w.step(0.25, withPallet);
    expect(w.moving).toBe(false);
    expect({ x: w.x, y: w.y }).toEqual(centre(start));
    for (let i = 0; i < 4; i++) w.step(0.25, nav);
    walkToGoal(w, nav);
    expect(w.atGoal).toBe(true);
    expect(w.heading).toBe(0.9);
  });

  it('cel poza siatką: stoi, nie dochodzi i nie rzuca', () => {
    const { nav, start } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal({ x: -3, y: 2 }, 0, nav);
    for (let i = 0; i < 20; i++) w.step(0.25, nav);
    expect(w.moving).toBe(false);
    expect(w.atGoal).toBe(false);
    expect({ x: w.x, y: w.y }).toEqual(centre(start));
  });

  it('zmiana celu w trakcie oczekiwania na drogę planuje od razu', () => {
    const { layout, nav, start, goal } = scenes[0]!;
    const wall = buildStaffNav(layout, layout.entrance);
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0, wall);
    expect(w.moving).toBe(false);
    w.setGoal({ x: 3, y: 2 }, 0, nav);                  // blisko, na chodniku
    expect(findPathSpy).toHaveBeenCalledTimes(2);
    walkToGoal(w, nav);
    expect(w.atGoal).toBe(true);
  });
});

describe('StaffWalker.teleport', () => {
  it('ustawia środek kratki, zeruje marsz, a cel zostaje i jest planowany od nowego miejsca', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0.6, nav);
    w.step(2, nav);
    const spot = scenes[0]!.layout.entrance[0]!;
    w.teleport(spot);
    expect({ x: w.x, y: w.y }).toEqual(centre(spot));
    expect(w.moving).toBe(false);
    expect(w.goal).toEqual(goal);
    expect(findPathSpy).toHaveBeenCalledTimes(1);
    w.step(DT, nav);                                    // wznawia marsz do tego samego celu, ale od `spot`
    expect(findPathSpy).toHaveBeenCalledTimes(2);
    expect(findPathSpy.mock.calls.at(-1)![3]).toEqual(spot);
    expect(w.moving).toBe(true);
    walkToGoal(w, nav);
    expect(w.atGoal).toBe(true);
    expect(w.heading).toBe(0.6);
  });

  it('teleport na kratkę celu: stoi tam od razu i patrzy zgodnie z zadaniem', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0.6, nav);
    w.step(1, nav);
    w.teleport(goal);
    expect(w.atGoal).toBe(true);
    expect(w.moving).toBe(false);
    expect(w.heading).toBe(0.6);
    w.step(1, nav);
    expect({ x: w.x, y: w.y }).toEqual(centre(goal));
    expect(findPathSpy).toHaveBeenCalledTimes(1);
  });

  it('teleport przed pierwszym celem, potem ten sam cel: pojawienie się od razu na miejscu', () => {
    const { nav, goal } = scenes[0]!;
    const w = new StaffWalker({ x: 1, y: 1 }, 0);
    w.teleport(goal);
    w.setGoal(goal, 2.2, nav);
    expect(w.atGoal).toBe(true);
    expect(w.heading).toBe(2.2);
    expect({ x: w.x, y: w.y }).toEqual(centre(goal));
  });

  it('kratka z NaN albo ułamkiem nie psuje pozycji', () => {
    const { start } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    const before = snapshot(w);
    w.teleport({ x: Number.NaN, y: 3 });
    w.teleport({ x: 2.5, y: 3 });
    expect(snapshot(w)).toEqual(before);
  });
});

describe('StaffWalker: czas', () => {
  it('wielkie dt kończy na celu i nie wychodzi poza ścieżkę', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0);
    w.setGoal(goal, 0.25, nav);
    w.step(1e9, nav);
    expect(w.atGoal).toBe(true);
    expect({ x: w.x, y: w.y }).toEqual(centre(goal));
    expect(w.heading).toBe(0.25);
    expect(findPathSpy).toHaveBeenCalledTimes(1);
  });

  it.each(scenes.flatMap((s) => [1.7, 5, 9.3].map((total) => ({ ...s, total }))))(
    '$seed: jedno dt = $total s daje to samo co wiele małych (kratki zużywane po odcinkach, bez ścinania zakrętów)',
    ({ nav, start, goal, total }) => {
      const big = new StaffWalker(start, 0);
      big.setGoal(goal, 0, nav);
      big.step(total, nav);
      const small = new StaffWalker(start, 0);
      small.setGoal(goal, 0, nav);
      const n = Math.round(total / DT);
      for (let i = 0; i < n; i++) small.step(total / n, nav);
      expect(big.x).toBeCloseTo(small.x, 6);
      expect(big.y).toBeCloseTo(small.y, 6);
      expect(big.heading).toBeCloseTo(small.heading, 6);
      expect(big.moving).toBe(small.moving);
      expect(big.moving).toBe(true);
    },
  );

  it('dt ≤ 0, NaN i Infinity nic nie robią, a kolejne poprawne dt działa normalnie', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0.1);
    w.setGoal(goal, 0, nav);
    w.step(0.4, nav);
    const before = snapshot(w);
    for (const dt of [0, -1, -Infinity, Number.NaN, Infinity]) {
      w.step(dt, nav);
      expect(snapshot(w)).toEqual(before);
    }
    expect(Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.heading)).toBe(true);
    w.step(0.1, nav);
    expect(Math.hypot(w.x - before.x, w.y - before.y)).toBeCloseTo(0.1 * STAFF_WALK_SPEED, 9);
  });

  it('śmieciowy cel albo kierunek jest ignorowany', () => {
    const { nav, start, goal } = scenes[0]!;
    const w = new StaffWalker(start, 0.5);
    w.setGoal({ x: Number.NaN, y: 2 }, 0, nav);
    w.setGoal({ x: 2.5, y: 2 }, 0, nav);
    expect(w.goal).toBeNull();
    expect(findPathSpy).not.toHaveBeenCalled();
    w.setGoal(goal, Number.NaN, nav);
    walkToGoal(w, nav);
    expect(Number.isFinite(w.heading)).toBe(true);
  });

  it('wynik nie zależy od losowości: dwa takie same marsze dają ten sam przebieg', () => {
    const { nav, start, goal } = scenes[1]!;
    const run = (): number[] => {
      const w = new StaffWalker(start, 0);
      w.setGoal(goal, 0, nav);
      const trace: number[] = [];
      for (let i = 0; i < 200; i++) { w.step(DT, nav); trace.push(w.x, w.y, w.heading); }
      return trace;
    };
    expect(run()).toEqual(run());
  });
});
