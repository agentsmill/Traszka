import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeStoreInfo, spotCells } from '@/sim/economy/storeInfo';
import { manhattan, type Cell } from '@/sim/grid';
import { findPath } from '@/sim/nav/astar';
import { generateStore } from '@/sim/store/generateStore';
import type { StoreLayout } from '@/sim/store/types';
import { LEAVE_RUSH, StaffCrew, doorstepPoint, staffSpeedFactor, type CrewInput, type CrewMember } from './crew';
import { buildStaffNav, type StaffNav } from './staffNav';
import { pickStaffSpots } from './targets';
import { QUARTER_MIN, TASK_DWELL_S } from './taskHold';
import { EDWARD_ID, ROBOT_VIEW_MAX, STAFF_VIEW_MAX, isRobotId, type PalletRef, type StaffAssignment, type StaffDuty, type StaffSpot } from './types';
import { STAFF_WALK_SPEED, StaffWalker } from './walker';

// Szpiedzy: ile razy załoga liczy miejsca, buduje siatkę, wyznacza cele i każe przeplanować drogi (te same dane, ten sam wynik).
vi.mock('./targets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./targets')>();
  return { ...actual, pickStaffSpots: vi.fn(actual.pickStaffSpots) };
});
vi.mock('./staffNav', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./staffNav')>();
  return { ...actual, buildStaffNav: vi.fn(actual.buildStaffNav) };
});
const pickSpy = vi.mocked(pickStaffSpots);
const navSpy = vi.mocked(buildStaffNav);
const setGoalSpy = vi.spyOn(StaffWalker.prototype, 'setGoal');
const repathSpy = vi.spyOn(StaffWalker.prototype, 'repath');
beforeEach(() => {   // klamry: zwrócona funkcja byłaby uznana za sprzątanie
  pickSpy.mockClear();
  navSpy.mockClear();
  setGoalSpy.mockClear();
  repathSpy.mockClear();
});

// Dwa bloki, dwie kamienice i pawilon z wejściem bliżej lewego chodnika (alfa, beta-12, kamienica-3), a seed-6 (pawilon) i
// seed-11 (kamienica narożna) mają wejście bliżej prawego punktu pojawiania się, więc wejście z chodnika zna obie strony.
const SEEDS = ['alfa', 'beta-12', 'kamienica-3', 'seed-6', 'seed-11'];
/** Krok czasu widoku: potęga dwójki, więc sumy kroków (np. 20 s = 320 kroków) są dokładne. */
const DT = 1 / 16;
/** Odległość (kratki), poniżej której dwie osoby uważamy za nakładające się. */
const OVERLAP = 0.3;
const MINUTE = 8 * 60;
const DUTIES: StaffDuty[] = ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny'];
const MIX: StaffDuty[] = ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny', 'kasa', 'wykladanie', 'rozladunek'];

interface Scene { seed: string; layout: StoreLayout; pallets: PalletRef[]; street: Cell; exit: Cell }

function scene(seed: string): Scene {
  const layout = generateStore(seed);
  const { spots } = computeStoreInfo(layout);
  expect(spots.backroom.length).toBeGreaterThanOrEqual(1);
  expect(spots.floor.length).toBeGreaterThanOrEqual(1);
  expect(spots.sidewalk.length).toBeGreaterThanOrEqual(2);
  const pallets: PalletRef[] = [
    { loc: 'backroom', spot: spots.backroom[0]!, since: 400 },
    { loc: 'floor', spot: spots.floor[0]!, since: 300 },
    { loc: 'sidewalk', spot: spots.sidewalk[1]!, since: 200 },
  ];
  // Punkt pojawiania się najbliżej wejścia (manhattan; przy remisie pierwszy).
  const door = layout.entrance[0]!;
  const street = layout.spawnPoints.reduce((best, p) => (manhattan(p, door) < manhattan(best, door) ? p : best));
  return { seed, layout, pallets, street, exit: doorstepPoint(layout, street) };
}
const SCENES = SEEDS.map(scene);

const people = (n: number): StaffAssignment[] => MIX.slice(0, n).map((task, id) => ({ id, task }));
const assign = (...pairs: [number, StaffDuty][]): StaffAssignment[] => pairs.map(([id, task]) => ({ id, task }));
const input = (who: readonly StaffAssignment[], pallets: readonly PalletRef[] = [], minute = MINUTE): CrewInput => ({ people: who, minute, pallets });

const centre = (c: Cell): { x: number; y: number } => ({ x: c.x + 0.5, y: c.y + 0.5 });
const pos = (m: CrewMember): { x: number; y: number } => ({ x: m.walker.x, y: m.walker.y });
const cellOf = (m: CrewMember): Cell => ({ x: Math.floor(m.walker.x), y: Math.floor(m.walker.y) });
const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;
const idsOf = (crew: StaffCrew): number[] => crew.members.map((m) => m.id);
const member = (crew: StaffCrew, id: number): CrewMember => {
  const found = crew.members.find((m) => m.id === id);
  if (!found) throw new Error(`brak osoby ${id} w załodze`);
  return found;
};
const cashiers = (crew: StaffCrew): number[] => crew.members.filter((m) => m.isCashier).map((m) => m.id);
const snapshot = (crew: StaffCrew): unknown[] =>
  crew.members.map((m) => [m.id, m.task, m.leaving, m.isCashier, m.walker.x, m.walker.y, m.walker.heading, m.walker.moving, m.walker.goal]);

const navFor = (layout: StoreLayout, pallets: readonly PalletRef[]): StaffNav => buildStaffNav(layout, pallets.flatMap((p) => spotCells(p.spot)));
/** Miejsca, jakie wyznacza targets dla tej ekipy od zera (bez `previous`): wzorzec dla pierwszego sync. */
const expectedSpots = (s: Scene, who: readonly StaffAssignment[]): Map<number, StaffSpot> =>
  pickStaffSpots(s.layout, navFor(s.layout, s.pallets), s.pallets, who);

/** Kroki `DT`, aż `done()` albo upłynie `limitS` s (czasu widoku). `each` woła się po każdym kroku. Zwraca czas, który minął. */
function until(crew: StaffCrew, done: () => boolean, limitS = 120, each?: () => void): number {
  let t = 0;
  while (!done() && t < limitS) {
    crew.step(DT);
    t += DT;
    each?.();
  }
  return t;
}
const advance = (crew: StaffCrew, seconds: number): void => { until(crew, () => false, seconds); };

/**
 * Jak w grze: dwa kroki `DT`, potem `sync` z tą samą listą (co 2 kroki = 0,125 s, czyli ok. 100 ms), aż `done()` albo upłynie
 * `seconds` s czasu widoku. `each` woła się po każdym kroku i po każdym `sync`. Zwraca czas, który minął.
 */
function play(
  crew: StaffCrew,
  seconds: number,
  who: readonly StaffAssignment[],
  pallets: readonly PalletRef[],
  minute: number,
  each?: () => void,
  done?: () => boolean,
): number {
  let t = 0;
  while (t < seconds && !done?.()) {
    crew.step(DT);
    each?.();
    crew.step(DT);
    each?.();
    crew.sync(input(who, pallets, minute));
    each?.();
    t += 2 * DT;
  }
  return t;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

describe('układy użyte w testach', () => {
  it('obejmują blok, kamienicę i pawilon oraz wejście bliższe lewemu i prawemu punktowi pojawiania się', () => {
    expect(new Set(SCENES.map((s) => s.layout.lot.kind))).toEqual(new Set(['blok', 'kamienica', 'pawilon']));
    const sides = new Set(SCENES.map((s) => (sameCell(s.street, s.layout.spawnPoints[0]!) ? 'lewy' : 'prawy')));
    expect(sides).toEqual(new Set(['lewy', 'prawy']));
  });
});

describe('StaffCrew: pierwszy sync', () => {
  describe.each(SCENES)('$seed', (s) => {
    it.each([1, 3, STAFF_VIEW_MAX])('%i osób od razu stoi na swoich miejscach, bez marszu', (n) => {
      const crew = new StaffCrew(s.layout);
      expect(crew.members).toEqual([]);
      const who = people(n);
      crew.sync(input(who, s.pallets));
      const expected = expectedSpots(s, who);
      expect(idsOf(crew)).toEqual(who.map((p) => p.id));
      for (const m of crew.members) {
        const spot = expected.get(m.id)!;
        expect(m.task).toBe(who[m.id]!.task);
        expect(m.leaving).toBe(false);
        expect(pos(m)).toEqual(centre(spot.cell));
        expect(m.walker.heading).toBe(spot.heading);
        expect(m.walker.goal).toEqual(spot.cell);
        expect(m.walker.atGoal).toBe(true);
        expect(m.walker.moving).toBe(false);
      }
      const before = snapshot(crew);
      crew.step(1);
      expect(snapshot(crew)).toEqual(before);   // stoją w miejscu
    });
  });

  it('pusty pierwszy sync też jest „pierwszy”: kto przyjdzie potem, wchodzi z chodnika', () => {
    const { layout, pallets, street } = SCENES[0]!;
    const crew = new StaffCrew(layout);
    crew.sync(input([], pallets));
    expect(crew.members).toEqual([]);
    crew.sync(input(people(2), pallets));
    expect(pos(member(crew, 0))).toEqual(centre(street));       // pierwszy przybysz stoi na punkcie chodnika, drugi obok niego
    expect(pos(member(crew, 1))).not.toEqual(centre(street));
    for (const m of crew.members) expect(m.walker.atGoal).toBe(false);
  });

  it('wyjątek w liczeniu miejsc nie sprawia, że kolejny sync z tą samą listą pomija liczenie', () => {
    const { layout, pallets } = SCENES[0]!;
    const crew = new StaffCrew(layout);
    pickSpy.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => crew.sync(input(people(2), pallets))).toThrow('boom');
    expect(crew.members).toEqual([]);
    crew.sync(input(people(2), pallets));
    expect(idsOf(crew)).toEqual([0, 1]);
    expect(crew.members.every((m) => m.walker.atGoal)).toBe(true);
  });

  it('zegar widoku startuje od zera i liczy tylko kroki', () => {
    const crew = new StaffCrew(SCENES[0]!.layout);
    expect(crew.clock).toBe(0);
    crew.sync(input(people(2)));
    expect(crew.clock).toBe(0);
    crew.step(0.25);
    crew.step(0.5);
    expect(crew.clock).toBe(0.75);
  });
});

describe('StaffCrew: wejście z sync', () => {
  const { layout, pallets } = SCENES[0]!;

  it('powyżej STAFF_VIEW_MAX nadmiar jest ignorowany: zostają osoby o najmniejszych id, w rosnącej kolejności', () => {
    const crew = new StaffCrew(layout);
    const ids = [11, 4, 9, 0, 7, 2, 10, 5, 3, 8, 1, 6];
    crew.sync(input(ids.map((id) => ({ id, task: MIX[id % MIX.length]! })), pallets));
    expect(idsOf(crew)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(crew.members).toHaveLength(STAFF_VIEW_MAX);
  });

  it('duplikaty nie zajmują miejsca w limicie, a przy powtórzonym id wygrywa pierwsza pozycja', () => {
    const crew = new StaffCrew(layout);
    const dupes = assign([0, 'kasa'], [0, 'wolny'], [0, 'sprzatanie'], [1, 'wykladanie'], [2, 'wolny'], [3, 'kasa'], [4, 'wolny'], [5, 'wolny'],
      [6, 'wolny'], [7, 'wolny']);
    crew.sync(input(dupes, pallets));
    expect(idsOf(crew)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(member(crew, 0).task).toBe('kasa');
  });

  it('id ujemne, ułamkowe, NaN i nieskończone są ignorowane', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([-1, 'kasa'], [1.5, 'kasa'], [Number.NaN, 'kasa'], [Infinity, 'kasa'], [-Infinity, 'kasa'], [3, 'wykladanie'], [0, 'kasa']), pallets));
    expect(idsOf(crew)).toEqual([0, 3]);
  });

  it('kolejność wejścia nie ma znaczenia: ta sama ekipa w innej kolejności daje to samo', () => {
    const a = new StaffCrew(layout);
    const b = new StaffCrew(layout);
    const who = people(6);
    a.sync(input(who, pallets));
    b.sync(input([...who].reverse(), pallets));
    expect(snapshot(b)).toEqual(snapshot(a));
  });

  it('NaN w minucie nie psuje załogi: ludzie stoją na miejscach z zadaniami od ekonomii', () => {
    const crew = new StaffCrew(layout);
    const who = people(4);
    crew.sync({ people: who, minute: Number.NaN, pallets });
    expect(crew.members.map((m) => m.task)).toEqual(who.map((p) => p.task));
    expect(crew.members.every((m) => m.walker.atGoal)).toBe(true);
    crew.sync(input(who, pallets));
    expect(crew.members.map((m) => m.task)).toEqual(who.map((p) => p.task));
  });

  it('ta sama lista i obiekty członków między wywołaniami, gdy nic się nie zmienia', () => {
    const crew = new StaffCrew(layout);
    const who = people(4);
    crew.sync(input(who, pallets));
    const list = crew.members;
    const objects = [...list];
    crew.step(DT);
    crew.sync(input(who, pallets, MINUTE + 1));
    crew.step(DT);
    expect(crew.members).toBe(list);
    expect(crew.members.every((m, i) => m === objects[i])).toBe(true);
  });

  it('po zatrudnieniu id mniejszego niż reszta lista nadal rośnie po id, a dotychczasowe obiekty zostają', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([3, 'kasa'], [5, 'wykladanie']), pallets));
    const [three, five] = crew.members;
    crew.sync(input(assign([5, 'wykladanie'], [1, 'sprzatanie'], [3, 'kasa'], [4, 'wolny']), pallets));
    expect(idsOf(crew)).toEqual([1, 3, 4, 5]);
    expect(member(crew, 3)).toBe(three);
    expect(member(crew, 5)).toBe(five);
  });
});

describe('StaffCrew: zatrudnienie i zwolnienie', () => {
  describe.each(SCENES)('$seed', (s) => {
    const { layout, pallets, street, exit } = s;
    const base = assign([0, 'kasa'], [1, 'sprzatanie']);
    const hired = assign([0, 'kasa'], [1, 'sprzatanie'], [2, 'wykladanie']);

    it('zatrudniony w trakcie zmiany wchodzi z chodnika przez drzwi i dochodzi na swoje miejsce', () => {
      const crew = new StaffCrew(layout);
      crew.sync(input(base, pallets));
      const resting = crew.members.map(pos);
      crew.sync(input(hired, pallets));

      const spot = expectedSpots(s, hired).get(2)!;
      const hire = member(crew, 2);
      expect(pos(hire)).toEqual(centre(street));
      const door = layout.entrance[0]!;
      expect(hire.walker.heading).toBeCloseTo(Math.atan2(door.y - street.y, door.x - street.x), 9);   // na chodniku twarzą do wejścia
      expect(hire.walker.goal).toEqual(spot.cell);
      expect(hire.walker.atGoal).toBe(false);
      expect(hire.leaving).toBe(false);
      expect(hire.task).toBe('wykladanie');
      expect(crew.members.slice(0, 2).map(pos)).toEqual(resting);   // dotychczasowi stoją tam, gdzie stali

      const visited: Cell[] = [];
      const elapsed = until(crew, () => hire.walker.atGoal, 120, () => visited.push(cellOf(hire)));
      expect(visited.some((c) => layout.entrance.some((e) => sameCell(e, c)))).toBe(true);
      expect(pos(hire)).toEqual(centre(spot.cell));
      expect(hire.walker.heading).toBe(spot.heading);
      const route = findPath(layout.width, layout.depth, navFor(layout, pallets).blocked, street, spot.cell)!;
      expect(route.length).toBeGreaterThan(8);
      expect(Math.abs(elapsed - (route.length - 1) / (STAFF_WALK_SPEED * staffSpeedFactor(2)))).toBeLessThanOrEqual(2 * DT);
      expect(crew.members.slice(0, 2).map(pos)).toEqual(resting);
    });

    it('zwolniona osoba wychodzi na chodnik, znika po dojściu, a reszta zostaje na miejscach', () => {
      const crew = new StaffCrew(layout);
      crew.sync(input(hired, pallets));
      const resting = [pos(member(crew, 0)), pos(member(crew, 2))];
      const leaver = member(crew, 1);

      crew.sync(input(assign([0, 'kasa'], [2, 'wykladanie']), pallets));
      expect(leaver.leaving).toBe(true);
      expect(leaver.walker.goal).toEqual(exit);
      expect(crew.members).toContain(leaver);          // jeszcze w sklepie
      expect(idsOf(crew)).toEqual([0, 1, 2]);
      expect(member(crew, 0).leaving || member(crew, 2).leaving).toBe(false);

      const elapsed = until(crew, () => !crew.members.includes(leaver), 20);
      expect(elapsed).toBeGreaterThan(0.5);
      expect(elapsed).toBeLessThan(20);
      expect(idsOf(crew)).toEqual([0, 2]);
      expect(leaver.walker.atGoal).toBe(true);         // zniknął, bo doszedł
      expect(pos(leaver)).toEqual(centre(exit));
      expect([pos(member(crew, 0)), pos(member(crew, 2))]).toEqual(resting);
    });
  });

  it.each(SCENES)('$seed: wychodzący, który doszedł za próg, stoi tam jeszcze jeden krok i znika w następnym (widok widzi go na wyjściu)', ({ layout, pallets, exit }) => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([0, 'kasa'], [1, 'sprzatanie']), pallets));
    const leaver = member(crew, 1);
    crew.sync(input(assign([0, 'kasa']), pallets));
    until(crew, () => leaver.walker.atGoal, 40);
    expect(leaver.walker.atGoal).toBe(true);
    expect(pos(leaver)).toEqual(centre(exit));
    expect(crew.members).toContain(leaver);           // doszedł w ostatnim kroku, ale jeszcze nie zniknął
    crew.step(DT);
    expect(crew.members).not.toContain(leaver);
    expect(idsOf(crew)).toEqual([0]);
  });

  it('wychodzący, który nie może dojść na chodnik (wejście zastawione), znika po 20 s czasu widoku od początku wychodzenia', () => {
    const { layout } = SCENES[0]!;
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([0, 'kasa'])));
    advance(crew, 5);
    expect(crew.clock).toBe(5);
    // Paleta 2×2 na obu kratkach wejścia zamyka salę od chodnika; zwolnienie w tym samym sync.
    const sealed: PalletRef[] = [{ loc: 'floor', spot: { x: layout.entrance[0]!.x, y: layout.entrance[0]!.y }, since: 0 }];
    crew.sync(input([], sealed));
    const stuck = member(crew, 0);
    expect(stuck.leaving).toBe(true);
    const start = pos(stuck);

    // Ekonomia woła `sync` co ~100 ms także wtedy, gdy ktoś wychodzi (tu co 2 kroki = 0,125 s), a każde takie wywołanie widzi
    // go nadal poza listą. Limit liczy się od pierwszego wyjścia, więc kolejne `sync` nie mogą go odnawiać.
    for (let i = 1; i <= 19.75 / DT; i++) {
      crew.step(DT);
      if (i % 2 === 0) crew.sync(input([], sealed));
    }
    expect(crew.clock).toBe(24.75);
    expect(crew.members).toContain(stuck);
    expect(stuck.leaving).toBe(true);
    expect(stuck.walker.atGoal).toBe(false);
    expect(pos(stuck)).toEqual(start);                // zablokowany: stoi
    crew.sync(input([], sealed));
    crew.step(0.25);
    expect(crew.clock).toBe(25);                      // dokładnie 20 s po rozpoczęciu wychodzenia, nie później
    expect(crew.members).toEqual([]);
  });

  it('osoba, która zniknęła na chodniku, po powrocie id pojawia się od nowa z chodnika: to nowy obiekt, nie ciało kasjera', () => {
    const { layout, pallets, street } = SCENES[1]!;
    const crew = new StaffCrew(layout);
    const both = assign([0, 'kasa'], [1, 'sprzatanie']);
    crew.sync(input(both, pallets));
    const first = member(crew, 1);

    crew.sync(input(assign([0, 'kasa']), pallets));
    expect(first.leaving).toBe(true);
    until(crew, () => !crew.members.includes(first), 20);   // doszła na chodnik i zniknęła: zawrócić już nie ma kogo
    expect(idsOf(crew)).toEqual([0]);

    crew.sync(input(both, pallets));                  // ta sama lista: id 1 jest znów „nowe”
    const again = member(crew, 1);
    expect(again).not.toBe(first);
    expect(again.leaving).toBe(false);
    expect(again.isCashier).toBe(false);
    expect(pos(again)).toEqual(centre(street));
    until(crew, () => again.walker.atGoal);
    expect(again.walker.atGoal).toBe(true);
    expect(member(crew, 0).isCashier).toBe(true);
  });

  it('zwolniony, który stoi jeszcze na chodniku (dopiero co przyszedł), wychodzi tylko za próg i znika po drodze krótszej niż do miejsca pracy', () => {
    const { layout, pallets, street, exit } = SCENES[2]!;
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([0, 'kasa']), pallets));
    crew.sync(input(assign([0, 'kasa'], [1, 'wolny']), pallets));
    const fresh = member(crew, 1);
    expect(pos(fresh)).toEqual(centre(street));
    crew.sync(input(assign([0, 'kasa']), pallets));
    expect(fresh.walker.goal).toEqual(exit);
    const elapsed = until(crew, () => idsOf(crew).length === 1, 20);
    expect(idsOf(crew)).toEqual([0]);
    expect(elapsed).toBeLessThan(5);
  });
});

describe('StaffCrew: zawracanie wychodzących', () => {
  // Wychodzenie nie jest lepkie: gdy id osoby, która już idzie do wyjścia, wraca do listy ekonomii, osoba zawraca (ten sam obiekt,
  // to samo ciało) i dostaje miejsce jak każdy zostający. „Nowy” jest tylko ten, kogo w sklepie w ogóle nie ma.
  const team = assign([0, 'kasa'], [1, 'sprzatanie'], [2, 'wykladanie']);
  const rest = assign([2, 'wykladanie']);

  describe.each(SCENES)('$seed', (sc) => {
    const { layout, pallets, street, exit } = sc;
    /** Ekipa po zwolnieniu 0 i 1 (kasjer i sprzątająca) i pół sekundy marszu do wyjścia. */
    const halfwayOut = (): { crew: StaffCrew; cashier: CrewMember; cleaner: CrewMember } => {
      const crew = new StaffCrew(layout);
      crew.sync(input(team, pallets));
      const cashier = member(crew, 0);
      const cleaner = member(crew, 1);
      crew.sync(input(rest, pallets));
      expect(cashier.leaving && cleaner.leaving).toBe(true);
      play(crew, 0.5, rest, pallets, MINUTE);
      expect(crew.members).toContain(cashier);
      expect(crew.members).toContain(cleaner);
      return { crew, cashier, cleaner };
    };

    it('zwolniony i od razu zatrudniony ponownie (to samo id) zawraca: ten sam obiekt, to samo ciało, nie znika i nie przeskakuje', () => {
      const { crew, cashier, cleaner } = halfwayOut();
      const where = [pos(cashier), pos(cleaner)];
      crew.sync(input(team, pallets));

      expect(crew.members.map((m) => m.id)).toEqual([0, 1, 2]);
      expect(member(crew, 0)).toBe(cashier);
      expect(member(crew, 1)).toBe(cleaner);
      expect(cashier.leaving || cleaner.leaving).toBe(false);
      expect(cashier.isCashier).toBe(true);
      expect(cleaner.isCashier).toBe(false);
      expect(cashiers(crew)).toEqual([0]);
      expect([pos(cashier), pos(cleaner)]).toEqual(where);   // zawraca stamtąd, gdzie była: bez teleportu na chodnik
      expect(cashier.task).toBe('kasa');
      expect(cleaner.task).toBe('sprzatanie');

      play(crew, 60, team, pallets, MINUTE, () => {
        expect(crew.members).toContain(cashier);
        expect(crew.members).toContain(cleaner);
        expect(cashiers(crew)).toEqual([0]);
      }, () => crew.members.every((m) => m.walker.atGoal));
      expect(crew.members.every((m) => m.walker.atGoal && !m.leaving)).toBe(true);
      expect(idsOf(crew)).toEqual([0, 1, 2]);
      expect(member(crew, 0)).toBe(cashier);
      expect(member(crew, 1)).toBe(cleaner);
    });

    it('zawrócony dostaje zwykłe liczenie celów: jego cel to nowe miejsce z targets (nie ulica) i tam staje', () => {
      const { crew, cashier, cleaner } = halfwayOut();
      expect(cleaner.walker.goal).toEqual(exit);         // dotąd szła do wyjścia
      pickSpy.mockClear();
      crew.sync(input(team, pallets));

      expect(pickSpy).toHaveBeenCalledTimes(1);
      const spots = pickSpy.mock.results[0]!.value as Map<number, StaffSpot>;
      expect(pickSpy.mock.calls[0]![3].map((a) => a.id)).toEqual([0, 1, 2]);   // zawrócony liczy się jak zostający
      for (const m of [cashier, cleaner]) {
        const spot = spots.get(m.id)!;
        expect(m.walker.goal).toEqual(spot.cell);
        expect(m.walker.goal).not.toEqual(exit);
      }
      play(crew, 60, team, pallets, MINUTE, undefined, () => crew.members.every((m) => m.walker.atGoal));
      for (const m of [cashier, cleaner]) {
        const spot = spots.get(m.id)!;
        expect(m.walker.atGoal).toBe(true);
        expect(pos(m)).toEqual(centre(spot.cell));
        expect(m.walker.heading).toBe(spot.heading);
      }
    });
  });

  it('zawrócony kasjer nie oddaje ciała przybyszowi o mniejszym id z tego samego sync', () => {
    const { layout, pallets } = SCENES[0]!;
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([3, 'kasa'], [5, 'wolny']), pallets));
    const cashier = member(crew, 3);
    crew.sync(input(assign([5, 'wolny']), pallets));     // 3 wychodzi jako kasjer
    play(crew, 0.5, assign([5, 'wolny']), pallets, MINUTE);
    expect(cashier.leaving && cashier.isCashier).toBe(true);

    crew.sync(input(assign([1, 'kasa'], [3, 'kasa'], [5, 'wolny']), pallets));   // 3 wraca, 1 przychodzi
    expect(member(crew, 3)).toBe(cashier);
    expect(cashier.leaving).toBe(false);
    expect(cashiers(crew)).toEqual([3]);
    expect(member(crew, 1).isCashier).toBe(false);
    expect(crew.members.length).toBeLessThanOrEqual(STAFF_VIEW_MAX);
  });

  it('wyjątek w liczeniu miejsc przy wychodzeniu nie sprawia, że zawrócony zostaje z celem na ulicę', () => {
    const { layout, pallets, exit } = SCENES[0]!;
    const crew = new StaffCrew(layout);
    crew.sync(input(team, pallets));
    const cleaner = member(crew, 1);
    pickSpy.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => crew.sync(input(assign([0, 'kasa'], [2, 'wykladanie']), pallets))).toThrow('boom');
    expect(cleaner.leaving).toBe(true);                  // wychodzenie ruszyło przed wyjątkiem
    expect(cleaner.walker.goal).toEqual(exit);

    crew.sync(input(team, pallets));                     // lista jak przed zwolnieniem, więc podpis liczenia się nie zmienił
    expect(cleaner.leaving).toBe(false);
    expect(cleaner.walker.goal).not.toEqual(exit);       // mimo to dostał miejsce
    expect(cleaner.walker.goal).toEqual((pickSpy.mock.results[pickSpy.mock.results.length - 1]!.value as Map<number, StaffSpot>).get(1)!.cell);
  });

  it('zawrócony nie podlega staremu limitowi 20 s: po ponownym wyjściu limit liczy się od nowa', () => {
    const { layout } = SCENES[0]!;
    const crew = new StaffCrew(layout);
    const one = assign([0, 'kasa']);
    crew.sync(input(one));
    advance(crew, 5);
    // Paleta 2×2 na obu kratkach wejścia zamyka salę od chodnika: kto wychodzi, stoi w miejscu.
    const sealed: PalletRef[] = [{ loc: 'floor', spot: { x: layout.entrance[0]!.x, y: layout.entrance[0]!.y }, since: 0 }];
    crew.sync(input([], sealed));
    const stuck = member(crew, 0);
    expect(stuck.leaving).toBe(true);                    // pierwsze wyjście: czas 5

    play(crew, 10, [], sealed, MINUTE);                  // do czasu 15
    expect(crew.members).toContain(stuck);
    crew.sync(input(one, sealed));
    expect(stuck.leaving).toBe(false);
    expect(member(crew, 0)).toBe(stuck);
    play(crew, 12, one, sealed, MINUTE);                 // do czasu 27, czyli po 20 s od pierwszego wyjścia
    expect(crew.members).toContain(stuck);               // zawróconego dawny limit nie dotyczy

    crew.sync(input([], sealed));                        // drugie wyjście: czas 27
    expect(stuck.leaving).toBe(true);
    play(crew, 19, [], sealed, MINUTE);
    expect(crew.members).toContain(stuck);               // 19 s po drugim wyjściu: jeszcze jest
    play(crew, 2, [], sealed, MINUTE);
    expect(crew.members).not.toContain(stuck);           // 21 s po drugim wyjściu: zniknął (limit liczony od nowa)
  });
});

describe('StaffCrew: wymiana osób w jednym sync', () => {
  const { layout, pallets, street, exit } = SCENES[0]!;

  it('zwolnienie i zatrudnienie z identycznym ciągiem zadań w jednym sync: stary wychodzi, nowy wchodzi z chodnika', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([0, 'kasa'], [1, 'wykladanie'], [2, 'sprzatanie']), pallets));
    const old = member(crew, 1);
    const restingZero = pos(member(crew, 0));
    // Ciąg zadań (kasa, wykładanie, sprzątanie) jest ten sam, zmienia się tylko id środkowej osoby (1 → 3).
    crew.sync(input(assign([0, 'kasa'], [3, 'wykladanie'], [2, 'sprzatanie']), pallets));
    expect(idsOf(crew)).toEqual([0, 1, 2, 3]);
    expect(old.leaving).toBe(true);
    expect(old.walker.goal).toEqual(exit);
    const fresh = member(crew, 3);
    expect(fresh.leaving).toBe(false);
    expect(fresh.task).toBe('wykladanie');
    expect(pos(fresh)).toEqual(centre(street));
    expect(fresh.walker.atGoal).toBe(false);
    expect(pos(member(crew, 0))).toEqual(restingZero);
    until(crew, () => fresh.walker.atGoal && !crew.members.includes(old), 60);
    expect(idsOf(crew)).toEqual([0, 2, 3]);
    expect(fresh.walker.atGoal).toBe(true);
  });
});

describe('StaffCrew: kilku przybyłych w jednym sync', () => {
  // Kto przychodzi w jednym `sync` (zatrudnienie kilku osób naraz, masowe przyjście o 6:00), nie może wejść do sklepu jako jedna
  // nakładająca się postać: k-ty przybysz startuje k kratek od punktu na chodniku w stronę wejścia, a każdy ma własne tempo.
  const LANE_SEEDS = ['alfa', 'seed-2', 'seed-6', 'seed-16', 'seed-29'];   // po ≥ 7 kratek chodnika od punktu do kolumny wejścia
  const LANE_SCENES = LANE_SEEDS.map(scene);

  /** Wzorzec: kratki wiersza chodnika od punktu pojawiania się do kolumny wejścia włącznie. */
  const laneOf = (sc: Scene): Cell[] => {
    const door = sc.layout.entrance[0]!;
    const dir = Math.sign(door.x - sc.street.x);
    return Array.from({ length: Math.abs(door.x - sc.street.x) + 1 }, (_, i) => ({ x: sc.street.x + dir * i, y: sc.street.y }));
  };
  const hire = (sc: Scene, ids: readonly number[], pallets: readonly PalletRef[] = []): StaffCrew => {
    const crew = new StaffCrew(sc.layout);
    crew.sync(input(people(1), pallets));              // pierwszy sync: id 0 od razu na miejscu, reszta wchodzi później
    crew.sync(input([...people(1), ...ids.map((id): StaffAssignment => ({ id, task: MIX[id % MIX.length]! }))], pallets));
    return crew;
  };
  const gap = (a: CrewMember, b: CrewMember): number => Math.hypot(a.walker.x - b.walker.x, a.walker.y - b.walker.y);
  /** Pary osób, które jeszcze idą (nie stoją na celu), z ich odległością. */
  const walkingPairs = (crew: StaffCrew): [string, number][] => {
    const walking = crew.members.filter((m) => !m.walker.atGoal);
    const out: [string, number][] = [];
    for (let i = 0; i < walking.length; i++) for (let j = i + 1; j < walking.length; j++) out.push([`${walking[i]!.id}-${walking[j]!.id}`, gap(walking[i]!, walking[j]!)]);
    return out;
  };

  describe.each(LANE_SCENES)('$seed', (sc) => {
    it('siedmiu przybyłych w jednym sync startuje z siedmiu różnych kratek chodnika, k-ty k kratek od punktu w stronę wejścia', () => {
      const lane = laneOf(sc);
      expect(lane).toHaveLength(7);
      const ids = [1, 2, 3, 4, 5, 6, 7];
      const crew = hire(sc, ids);
      const starts = ids.map((id) => pos(member(crew, id)));
      expect(new Set(starts.map((p) => `${p.x},${p.y}`)).size).toBe(7);
      ids.forEach((id, k) => {
        expect(pos(member(crew, id))).toEqual(centre(lane[k]!));
        const door = sc.layout.entrance[0]!;
        expect(member(crew, id).walker.heading).toBeCloseTo(Math.atan2(door.y - lane[k]!.y, door.x - lane[k]!.x), 9);
        expect(member(crew, id).walker.atGoal).toBe(false);
      });
      expect(pos(member(crew, 0))).not.toEqual(centre(lane[0]!));   // dotychczasowy nie jest przybyszem
    });

    it('osiem osób zatrudnionych naraz nie idzie jako jedna nakładająca się postać: po rozciągnięciu grupy nikt nie jest bliżej niż 0,3 kratki', () => {
      // Dojście z jednej kratki w tym samym tempie dawało przez cały marsz (8 s i dłużej) zerową odległość między wszystkimi.
      // Teraz szybsi doganiają wolniejszych z przodu i krótko się z nimi mijają (u najgorszych układów do ~2 s), ale od 4,5 s
      // marszu do dojścia ostatniego najmniejsza odległość to ≥ 0,40 kratki (zmierzone na 10 układach).
      const crew = new StaffCrew(sc.layout);
      crew.sync(input([]));
      crew.sync(input(people(8)));
      expect(crew.members).toHaveLength(8);
      const runs = new Map<string, number>();
      let longestOverlap = 0;
      let minLate = Infinity;
      let walkingLate = 0;
      for (let i = 0; i <= 20 / DT; i++) {
        const pairs = walkingPairs(crew);
        const near = new Set(pairs.filter(([, d]) => d < OVERLAP).map(([k]) => k));
        for (const k of [...runs.keys()]) if (!near.has(k)) runs.delete(k);
        for (const k of near) {
          runs.set(k, (runs.get(k) ?? 0) + DT);
          longestOverlap = Math.max(longestOverlap, runs.get(k)!);
        }
        if (i * DT >= 4.5) {
          for (const [, d] of pairs) minLate = Math.min(minLate, d);
          if (i * DT === 4.5) walkingLate = pairs.length;
        }
        crew.step(DT);
      }
      expect(walkingLate).toBeGreaterThanOrEqual(10);        // po 4,5 s nadal idzie co najmniej 5 osób, więc sprawdzenie nie jest puste
      expect(minLate).toBeGreaterThanOrEqual(OVERLAP);
      expect(longestOverlap).toBeLessThan(2.5);               // wcześniej: cały marsz
    });

    it('pierwszy sync jest bez zmian: wszyscy od razu na swoich miejscach, nikt nie stoi na chodniku', () => {
      const crew = new StaffCrew(sc.layout);
      const who = people(7);
      crew.sync(input(who));
      const expected = pickStaffSpots(sc.layout, navFor(sc.layout, []), [], who);
      for (const m of crew.members) {
        expect(pos(m)).toEqual(centre(expected.get(m.id)!.cell));
        expect(m.walker.atGoal).toBe(true);
      }
    });
  });

  it('gdy chodnik jest krótszy niż liczba przybyłych, kolejni dzielą ostatnią kratkę i nigdy nie startują dalej niż kolumna wejścia', () => {
    const sc = SCENES[1]!;                               // beta-12: sześć kratek od punktu do kolumny wejścia
    const lane = laneOf(sc);
    expect(lane).toHaveLength(6);
    const crew = new StaffCrew(sc.layout);
    crew.sync(input([]));
    crew.sync(input(people(8)));
    for (let k = 0; k < 8; k++) expect(pos(member(crew, k))).toEqual(centre(lane[Math.min(k, lane.length - 1)]!));
  });

  it('kratki zastawione paletą są pomijane: nikt nie pojawia się w palecie, a przybyli nadal startują w rosnącej odległości od punktu', () => {
    const sc = SCENES[0]!;                               // alfa: paleta (3,1) zajmuje kratki x = 3-4 wiersza chodnika
    const blockedCells = new Set(sc.pallets.flatMap((p) => spotCells(p.spot)).map((c) => `${c.x},${c.y}`));
    expect(blockedCells.has('3,1') && blockedCells.has('4,1')).toBe(true);
    const ids = [1, 2, 3, 4, 5, 6, 7];
    const crew = hire(sc, ids, sc.pallets);
    const starts = ids.map((id) => cellOf(member(crew, id)));
    for (const c of starts) expect(blockedCells.has(`${c.x},${c.y}`)).toBe(false);
    expect(starts.map((c) => c.x)).toEqual([0, 1, 2, 5, 6, 6, 6]);   // wolne kratki wiersza 1 w stronę wejścia (6,4), potem ostatnia
    expect(new Set(starts.map((c) => c.y))).toEqual(new Set([sc.street.y]));
  });

  it('tempo marszu zależy od id: mnożnik jest stały dla id, mieści się w 0,92-1,08, a pięć kolejnych id ma pięć różnych temp', () => {
    for (let id = 0; id < 300; id++) {
      const f = staffSpeedFactor(id);
      expect(f).toBeGreaterThanOrEqual(0.92 - 1e-12);
      expect(f).toBeLessThanOrEqual(1.08 + 1e-12);
      expect(staffSpeedFactor(id)).toBe(f);
    }
    for (let id = 0; id < 20; id++) {
      const five = [0, 1, 2, 3, 4].map((i) => staffSpeedFactor(id + i).toFixed(6));
      expect(new Set(five).size).toBe(5);
    }
    expect(staffSpeedFactor(0)).toBeCloseTo(0.92, 12);
    expect(staffSpeedFactor(1)).toBeCloseTo(1, 12);
    expect(staffSpeedFactor(2)).toBeCloseTo(1.08, 12);
  });

  it('każdy idzie swoim tempem: przesunięcie w pierwszym kroku to STAFF_WALK_SPEED × mnożnik jego id', () => {
    const sc = LANE_SCENES[0]!;
    const ids = [1, 2, 3, 4, 5];
    const crew = hire(sc, ids);
    const before = new Map(ids.map((id) => [id, pos(member(crew, id))]));
    crew.step(0.25);
    for (const id of ids) {
      const m = member(crew, id);
      const from = before.get(id)!;
      expect(Math.hypot(m.walker.x - from.x, m.walker.y - from.y)).toBeCloseTo(STAFF_WALK_SPEED * staffSpeedFactor(id) * 0.25, 9);
    }
    expect(new Set(ids.map((id) => staffSpeedFactor(id).toFixed(6))).size).toBe(5);
  });

  it('wychodzący idą do jednego punktu tuż za progiem, niezależnie od tego, gdzie startowali', () => {
    const sc = LANE_SCENES[0]!;
    const crew = new StaffCrew(sc.layout);
    crew.sync(input(people(4)));
    crew.sync(input([]));
    for (const m of crew.members) expect(m.walker.goal).toEqual(sc.exit);
  });
});

describe('StaffCrew: kasjer', () => {
  const { layout, pallets } = SCENES[0]!;

  it('pierwszy sync: ciało kasjera dostaje osoba o najmniejszym id, niezależnie od zadania i kolejności', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([5, 'kasa'], [2, 'wolny'], [7, 'wykladanie']), pallets));
    expect(cashiers(crew)).toEqual([2]);
    const solo = new StaffCrew(layout);
    solo.sync(input(assign([4, 'sprzatanie']), pallets));
    expect(cashiers(solo)).toEqual([4]);
  });

  it('trzyma się mimo zmian zadań i nowych osób o mniejszym id', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([2, 'kasa'], [5, 'wykladanie']), pallets, 0));
    const cashier = member(crew, 2);
    crew.sync(input(assign([0, 'kasa'], [2, 'kasa'], [5, 'wykladanie']), pallets, 1));   // nowa osoba z mniejszym id
    expect(cashiers(crew)).toEqual([2]);
    expect(member(crew, 0).isCashier).toBe(false);

    // Kasjer przechodzi na inne zadanie na granicy kwadransa; ciało kasjera zostaje u niego.
    for (let m = 2; m < QUARTER_MIN; m++) crew.sync(input(assign([0, 'kasa'], [2, 'sprzatanie'], [5, 'wykladanie']), pallets, m));
    advance(crew, TASK_DWELL_S + 1);
    crew.sync(input(assign([0, 'kasa'], [2, 'sprzatanie'], [5, 'wykladanie']), pallets, QUARTER_MIN));
    expect(member(crew, 2)).toBe(cashier);
    expect(cashier.task).toBe('sprzatanie');
    expect(cashiers(crew)).toEqual([2]);
  });

  it('po zniknięciu kasjera nikt go nie przejmuje, aż pojawi się ktoś nowy (wtedy najmniejsze id z tego sync)', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([2, 'kasa'], [5, 'wykladanie'], [7, 'wolny']), pallets));
    crew.sync(input(assign([5, 'wykladanie'], [7, 'wolny']), pallets));
    expect(cashiers(crew)).toEqual([2]);              // wychodzi jako kasjer
    until(crew, () => !idsOf(crew).includes(2), 20);
    expect(idsOf(crew)).toEqual([5, 7]);
    expect(cashiers(crew)).toEqual([]);
    crew.sync(input(assign([5, 'wykladanie'], [7, 'wolny']), pallets));
    expect(cashiers(crew)).toEqual([]);               // nikt nowy: nikt nie przejmuje
    crew.sync(input(assign([9, 'kasa'], [5, 'wykladanie'], [7, 'wolny'], [8, 'wolny']), pallets));
    expect(cashiers(crew)).toEqual([8]);              // 8 < 9, choć 5 i 7 są w sklepie dłużej
  });

  it('nowa osoba obejmuje ciało kasjera po wychodzącym kasjerze, który znika od razu (ciało ma najwyżej jedna osoba)', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([2, 'kasa'], [5, 'wykladanie']), pallets));
    const old = member(crew, 2);
    crew.sync(input(assign([5, 'wykladanie'], [9, 'kasa']), pallets));   // 2 wychodzi, 9 wchodzi w tym samym sync
    expect(crew.members).not.toContain(old);
    expect(old.walker.atGoal).toBe(false);                               // zniknął w drodze, nie dlatego, że doszedł
    expect(idsOf(crew)).toEqual([5, 9]);
    expect(cashiers(crew)).toEqual([9]);
    expect(member(crew, 9).leaving).toBe(false);
  });

  it('zwolniony kasjer, po którego ciało nikt nie przychodzi, wychodzi z nim do końca, także przy ciągłym sync', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([0, 'kasa'], [1, 'wykladanie'], [2, 'sprzatanie']), pallets));
    const fired = member(crew, 0);
    const rest = assign([1, 'wykladanie'], [2, 'sprzatanie']);
    crew.sync(input(rest, pallets));
    expect(fired.leaving).toBe(true);
    let t = 0;
    while (crew.members.includes(fired) && t < 40) {
      expect(fired.isCashier).toBe(true);
      expect(cashiers(crew)).toEqual([0]);
      crew.step(DT);
      crew.step(DT);
      crew.sync(input(rest, pallets));
      t += 2 * DT;
    }
    expect(crew.members).not.toContain(fired);
    expect(fired.walker.atGoal).toBe(true);                              // zniknął, bo doszedł na chodnik
    expect(cashiers(crew)).toEqual([]);
  });

  it('zatrudniony w ciągu dnia o mniejszym id nie odbiera ciała kasjerowi, który zostaje', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([3, 'kasa'], [5, 'wolny']), pallets));
    const cashier = member(crew, 3);
    advance(crew, 3);
    crew.sync(input(assign([1, 'kasa'], [3, 'kasa'], [5, 'wolny']), pallets));   // 1 < 3, ale 3 nie wychodzi
    expect(member(crew, 3)).toBe(cashier);
    expect(cashiers(crew)).toEqual([3]);
    expect(member(crew, 1).isCashier).toBe(false);
    advance(crew, 3);
    crew.sync(input(assign([0, 'sprzatanie'], [1, 'kasa'], [3, 'kasa'], [5, 'wolny']), pallets));
    expect(cashiers(crew)).toEqual([3]);
  });

  describe.each(SCENES)('krótka przerwa (np. karta „zamknij na godzinę”): wczorajsza ekipa jeszcze wychodzi, gdy lista wraca: $seed', (sc) => {
    // Rano wczorajsza ekipa (z kasjerem) jeszcze wychodzi. Kasjerem jest najmniejsze id, tu z zadaniem „wolny” na zapleczu, więc
    // idzie do wyjścia najdłużej (9-12 s), a inni z poprzedniego dnia zdążają wyjść wcześniej. Id wracają na listę, więc kto
    // jeszcze idzie, zawraca (kasjer razem z ciałem), a kto już zniknął, wchodzi z chodnika jak nowy i ciała nie przejmuje.
    const tasks: StaffDuty[] = ['wolny', 'rozladunek', 'kasa', 'sprzatanie', 'wykladanie'];
    const day = tasks.map((task, id) => ({ id, task }));
    const dayIds = day.map((p) => p.id);
    const close = 22 * 60;
    const morning = 30 * 60;                           // następny dzień, 6:00

    /** Sklep po zamknięciu: wczorajsza ekipa dostała pustą listę i wychodzi. */
    const closed = (): { crew: StaffCrew; old: CrewMember; check: () => void } => {
      const crew = new StaffCrew(sc.layout);
      crew.sync(input(day, sc.pallets));
      const old = member(crew, 0);
      expect(old.isCashier).toBe(true);
      crew.sync(input([], sc.pallets, close));
      const check = (): void => {
        expect(crew.members.length).toBeLessThanOrEqual(STAFF_VIEW_MAX);
        expect(cashiers(crew).length).toBeLessThanOrEqual(1);
      };
      return { crew, old, check };
    };
    const standing = (crew: StaffCrew): boolean =>
      crew.members.length === day.length && crew.members.every((m) => !m.leaving && m.walker.atGoal);

    it('powrót listy po ~1,5 s: wraca ta sama lista, a kasjer (id 0) zawraca razem z resztą idących: ten sam obiekt, to samo ciało, nikt nie znika w pół drogi', () => {
      const { crew, old, check } = closed();
      play(crew, 1.5, [], sc.pallets, close, check);     // krótka przerwa: wychodzący z zaplecza jeszcze nie zdążyli
      expect(crew.members).toContain(old);               // z zaplecza nie zdążył wyjść
      expect(old.leaving && old.isCashier).toBe(true);
      const walking = [...crew.members];                 // ci jeszcze idą do wyjścia
      const entering = dayIds.filter((id) => !walking.some((m) => m.id === id));

      crew.sync(input(day, sc.pallets, morning));
      check();
      expect(member(crew, 0)).toBe(old);
      expect(cashiers(crew)).toEqual([0]);
      expect(old.isCashier).toBe(true);
      for (const m of walking) {
        expect(member(crew, m.id)).toBe(m);
        expect(m.leaving).toBe(false);
        expect(m.walker.goal).not.toEqual(sc.street);    // idzie na swoje miejsce, nie na ulicę
      }
      for (const id of entering) {
        expect(walking.some((m) => m.id === id)).toBe(false);
        expect(member(crew, id).isCashier).toBe(false);  // przybysz nie przejmuje ciała po zawróconym kasjerze
      }

      play(crew, 120, day, sc.pallets, morning, () => {
        check();
        for (const m of walking) expect(crew.members).toContain(m);   // nikt z zawróconych nie znika (pop)
      }, () => standing(crew));
      expect(standing(crew)).toBe(true);
      expect(idsOf(crew)).toEqual(dayIds);
      for (const m of walking) expect(member(crew, m.id)).toBe(m);
      expect(cashiers(crew)).toEqual([0]);
      expect(member(crew, 0)).toBe(old);
    });

    it('część ekipy zdążyła zniknąć na chodniku, część jeszcze idzie: idący zawracają (kasjer z ciałem), a „nowi” to tylko ci, których już nie ma', () => {
      const { crew, old, check } = closed();
      play(crew, 30, [], sc.pallets, close, check, () => crew.members.length < day.length);   // aż ktoś zniknie na chodniku
      expect(crew.members.length).toBeLessThan(day.length);
      expect(crew.members).toContain(old);               // a kasjer (najdłuższa droga) jeszcze idzie
      expect(old.leaving && old.isCashier).toBe(true);
      const walking = [...crew.members];
      const gone = dayIds.filter((id) => !walking.some((m) => m.id === id));
      expect(gone.length).toBeGreaterThan(0);

      crew.sync(input(day, sc.pallets, morning));
      check();
      expect(idsOf(crew)).toEqual(dayIds);
      expect(member(crew, 0)).toBe(old);
      expect(cashiers(crew)).toEqual([0]);
      for (const m of walking) {
        expect(member(crew, m.id)).toBe(m);
        expect(m.leaving).toBe(false);
      }
      for (const id of gone) {
        const fresh = member(crew, id);
        expect(walking).not.toContain(fresh);
        expect(fresh.leaving).toBe(false);
        expect(fresh.isCashier).toBe(false);
        expect(fresh.walker.atGoal).toBe(false);         // wchodzi z chodnika
      }

      play(crew, 120, day, sc.pallets, morning, () => {
        check();
        for (const m of walking) expect(crew.members).toContain(m);
      }, () => standing(crew));
      expect(standing(crew)).toBe(true);
      expect(cashiers(crew)).toEqual([0]);
      expect(member(crew, 0)).toBe(old);
    });
  });

  it('po nocy (lista pusta, ludzie wychodzą, potem znów pełna) kasjerem zostaje najmniejsze id nowego sync', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(people(5), pallets));
    expect(cashiers(crew)).toEqual([0]);
    crew.sync(input([], pallets, 22 * 60));
    expect(crew.members.every((m) => m.leaving)).toBe(true);
    expect(cashiers(crew)).toEqual([0]);              // 0 nadal wychodzi jako kasjer
    const elapsed = until(crew, () => crew.members.length === 0, 40);
    expect(elapsed).toBeLessThan(20);
    expect(cashiers(crew)).toEqual([]);

    crew.sync(input(assign([6, 'kasa'], [3, 'wykladanie'], [4, 'wolny']), pallets, 24 * 60 + 6 * 60));
    expect(idsOf(crew)).toEqual([3, 4, 6]);
    expect(cashiers(crew)).toEqual([3]);
    for (const m of crew.members) expect(m.walker.atGoal).toBe(false);   // przyszli z chodnika
  });
});

describe('StaffCrew: twardy limit ciał na ekranie', () => {
  // Jedna postać to jeden SkinnedMesh, więc `members` (razem z wychodzącymi) nigdy nie przekracza STAFF_VIEW_MAX. Gdy przy
  // komplecie przychodzi ktoś nowy, od razu znika wychodzący od najdawniej (remis: o wyższym id).
  const { layout, pallets, street, exit } = SCENES[0]!;
  const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  /** Osoby o podanych id; zadanie wynika z id, więc ta sama osoba ma zawsze to samo zadanie. */
  const team = (ids: readonly number[]): StaffAssignment[] => ids.map((id) => ({ id, task: MIX[id % MIX.length]! }));
  const crewOf = (ids: readonly number[]): StaffCrew => {
    const crew = new StaffCrew(layout);
    crew.sync(input(team(ids), pallets));
    return crew;
  };

  it.each(SCENES.slice(0, 3))('$seed: przy dużej rotacji id po każdym wywołaniu jest najwyżej STAFF_VIEW_MAX ciał, a limit naprawdę bywa osiągany', (sc) => {
    let state = 20_261_028 + sc.seed.length;
    const rnd = (): number => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
    const { spots } = computeStoreInfo(sc.layout);
    const pool: PalletRef[] = [
      ...spots.sidewalk.slice(0, 3).map((spot): PalletRef => ({ loc: 'sidewalk', spot, since: 1 })),
      ...spots.floor.slice(0, 2).map((spot): PalletRef => ({ loc: 'floor', spot, since: 2 })),
      ...spots.backroom.slice(0, 2).map((spot): PalletRef => ({ loc: 'backroom', spot, since: 3 })),
    ];
    const crew = new StaffCrew(sc.layout);
    const firstSeenLeaving = new Map<CrewMember, number>();
    let minute = 0;
    let full = 0;
    let bumped = 0;
    const afterCall = (before: readonly CrewMember[]): void => {
      expect(crew.members.length).toBeLessThanOrEqual(STAFF_VIEW_MAX);
      const ids = idsOf(crew);
      expect([...new Set(ids)].sort((a, b) => a - b)).toEqual(ids);               // rosnąco i bez powtórzeń
      expect(cashiers(crew).length).toBeLessThanOrEqual(1);
      for (const m of crew.members) {
        expect(Number.isFinite(m.walker.x) && Number.isFinite(m.walker.y)).toBe(true);
        if (m.leaving && !firstSeenLeaving.has(m)) firstSeenLeaving.set(m, crew.clock);
      }
      if (crew.members.length === STAFF_VIEW_MAX) full++;
      // Wypchnięty przez limit: zniknął jako wychodzący, choć nie doszedł na chodnik i nie minęło 20 s jego wychodzenia.
      for (const m of before) {
        if (crew.members.includes(m) || !m.leaving || m.walker.atGoal) continue;
        if (crew.clock - (firstSeenLeaving.get(m) ?? crew.clock) < 20) bumped++;
      }
    };
    for (let i = 0; i < 2500; i++) {
      const before = [...crew.members];
      if (rnd() < 0.25) {
        const n = 4 + Math.floor(rnd() * 8);
        const ids = new Set<number>();
        while (ids.size < n) ids.add(Math.floor(rnd() * 14));
        const who = [...ids].map((id): StaffAssignment => ({ id, task: rnd() < 0.3 ? DUTIES[Math.floor(rnd() * DUTIES.length)]! : MIX[id % MIX.length]! }));
        minute += Math.floor(rnd() * 4);
        crew.sync(input(who, pool.filter(() => rnd() < 0.4), minute));
        afterCall(before);
      }
      crew.step(rnd() < 0.05 ? 0 : DT * (1 + Math.floor(rnd() * 3)));
      afterCall(before);
    }
    expect(full).toBeGreaterThan(100);       // limit był osiągany wiele razy
    expect(bumped).toBeGreaterThan(5);       // i wiele razy trzeba było zrobić miejsce
  });

  it.each([
    ['wejście z dziewięcioma osobami (nadmiar ucięty)', range(0, 8)],
    ['wejście z ośmioma osobami (najwyższego już nie ma)', range(0, 7)],
  ])('%s: nowa osoba o najniższym id wypiera tę o najwyższym; ta wychodzi i znika od razu', (_name, ids) => {
    const crew = crewOf(range(1, 8));
    const bumped = member(crew, 8);
    const resting = range(1, 7).map((id) => pos(member(crew, id)));
    crew.sync(input(team(ids), pallets));
    expect(bumped.leaving).toBe(true);
    expect(crew.members).not.toContain(bumped);
    expect(idsOf(crew)).toEqual(range(0, 7));
    expect(crew.members).toHaveLength(STAFF_VIEW_MAX);
    expect(crew.members.some((m) => m.leaving)).toBe(false);
    expect(pos(member(crew, 0))).toEqual(centre(street));
    expect(member(crew, 0).walker.atGoal).toBe(false);
    expect(range(1, 7).map((id) => pos(member(crew, id)))).toEqual(resting);
    // Wypchnięty nie wraca, choć kolejne sync nadal go widzą poza listą.
    crew.sync(input(team(ids), pallets));
    crew.step(DT);
    expect(idsOf(crew)).toEqual(range(0, 7));
  });

  it('wymiana całej ekipy przy komplecie: wszyscy starzy znikają od razu, wszyscy nowi wchodzą z chodnika', () => {
    const crew = crewOf(range(8, 15));
    const olds = [...crew.members];
    crew.sync(input(team(range(0, 7)), pallets));
    expect(idsOf(crew)).toEqual(range(0, 7));
    expect(olds.every((m) => m.leaving && !crew.members.includes(m))).toBe(true);
    expect(pos(member(crew, 0))).toEqual(centre(street));
    for (const m of crew.members) expect(m.walker.atGoal).toBe(false);   // wszyscy nowi dopiero wchodzą z chodnika
    expect(cashiers(crew)).toEqual([0]);              // stary kasjer (8) oddał ciało najmniejszemu id spośród nowych
  });

  it('wymiana całej ekipy poniżej kompletu: stary kasjer znika od razu, pozostali starzy wychodzą, nowy kasjer to najmniejsze nowe id', () => {
    const crew = crewOf([5, 6, 7]);
    const [oldCashier, ...oldOthers] = crew.members;
    expect(oldCashier!.isCashier).toBe(true);
    crew.sync(input(team([0, 1, 2]), pallets));
    expect(idsOf(crew)).toEqual([0, 1, 2, 6, 7]);
    expect(crew.members).not.toContain(oldCashier);
    expect(oldOthers.every((m) => m.leaving && crew.members.includes(m))).toBe(true);
    expect(cashiers(crew)).toEqual([0]);
    expect(member(crew, 0).leaving).toBe(false);
  });

  it('wychodzący, którego miejsce nie jest potrzebne, idzie dalej do wyjścia; usuwany jest ten, który wychodzi najdawniej', () => {
    const crew = crewOf(range(0, 4));
    crew.sync(input(team([0, 1, 2, 4]), pallets));    // id 3 zaczyna wychodzić w czasie 0
    advance(crew, 0.25);
    crew.sync(input(team([0, 1, 2]), pallets));       // id 4 zaczyna wychodzić w czasie 0,25
    const early = member(crew, 3);
    const late = member(crew, 4);
    crew.sync(input(team([0, 1, 2, 5, 6, 7]), pallets));
    expect(idsOf(crew)).toEqual(range(0, 7));         // osiem ciał: limit, ale nikogo nie trzeba usuwać
    expect(early.leaving && late.leaving).toBe(true);

    crew.sync(input(team([0, 1, 2, 5, 6, 7, 8]), pallets));   // dziewiąte ciało: odchodzi to, które wychodzi najdawniej (id 3)
    expect(idsOf(crew)).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);
    expect(crew.members).not.toContain(early);
    expect(early.walker.atGoal).toBe(false);          // zniknął w drodze, nie dlatego, że doszedł
    expect(crew.members).toContain(late);
    expect(late.leaving).toBe(true);

    const before = pos(late);
    crew.step(0.25);
    expect(pos(late)).not.toEqual(before);            // reszta wychodzących idzie dalej
    until(crew, () => !crew.members.includes(late), 20);
    expect(late.walker.atGoal).toBe(true);
    expect(pos(late)).toEqual(centre(exit));
    expect(idsOf(crew)).toEqual([0, 1, 2, 5, 6, 7, 8]);
  });

  it('przy remisie czasu rozpoczęcia wychodzenia znika wychodzący o wyższym id', () => {
    const crew = crewOf(range(0, 4));
    crew.sync(input(team([0, 1, 2]), pallets));       // 3 i 4 zaczynają wychodzić w tym samym sync
    const three = member(crew, 3);
    const four = member(crew, 4);
    crew.sync(input(team([0, 1, 2, 5, 6, 7]), pallets));
    crew.sync(input(team([0, 1, 2, 5, 6, 7, 8]), pallets));
    expect(idsOf(crew)).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
    expect(crew.members).toContain(three);
    expect(crew.members).not.toContain(four);
  });

  it('przy komplecie przybysz obejmuje ciało po wychodzącym kasjerze, a kolejny nie odbiera go temu, kto zostaje', () => {
    const crew = crewOf(range(0, 7));
    expect(cashiers(crew)).toEqual([0]);
    crew.sync(input(team(range(1, 7)), pallets));     // 0 wychodzi jako kasjer
    expect(cashiers(crew)).toEqual([0]);
    crew.sync(input(team(range(1, 8)), pallets));     // 8 przychodzi, obejmuje ciało; 0 znika od razu, więc limit zostaje zachowany
    expect(idsOf(crew)).toEqual(range(1, 8));
    expect(cashiers(crew)).toEqual([8]);
    crew.sync(input(team(range(2, 9)), pallets));     // 1 wychodzi, 9 przychodzi (znów komplet); 8 zostaje kasjerem
    expect(idsOf(crew)).toEqual(range(2, 9));
    expect(cashiers(crew)).toEqual([8]);
  });
});

describe('StaffCrew: histereza zadań i cele', () => {
  const s = SCENES[0]!;
  const { layout, pallets } = s;

  it('zmiana zadania przez ekonomię co minutę nie rusza celów przed granicą kwadransa, a na granicy rusza tylko zmienionego', () => {
    const crew = new StaffCrew(layout);
    // Osoba 1 zaczyna jako druga kasjerka. Ekonomia przełącza ją co minutę między wykładaniem i kasą, a w ostatniej minucie
    // okna (15) znów wybiera wykładanie: 8 minut wykładania kontra 7 kasy.
    const crewAt = (one: StaffDuty): StaffAssignment[] => assign([0, 'kasa'], [1, one], [2, 'sprzatanie'], [3, 'wolny']);
    crew.sync(input(crewAt('kasa'), pallets, 0));
    const goals = crew.members.map((m) => m.walker.goal);
    expect(pickSpy).toHaveBeenCalledTimes(1);
    const setGoalCalls = setGoalSpy.mock.calls.length;

    for (let m = 1; m < QUARTER_MIN; m++) {
      crew.step(0.5);
      crew.sync(input(crewAt(m % 2 === 1 ? 'wykladanie' : 'kasa'), pallets, m));
      expect(crew.members.map((x) => x.task)).toEqual(['kasa', 'kasa', 'sprzatanie', 'wolny']);
      expect(crew.members.map((x) => x.walker.goal)).toEqual(goals);
    }
    expect(crew.clock).toBeGreaterThanOrEqual(TASK_DWELL_S);
    expect(pickSpy).toHaveBeenCalledTimes(1);          // żadnego nowego liczenia miejsc
    expect(setGoalSpy).toHaveBeenCalledTimes(setGoalCalls);

    crew.sync(input(crewAt('wykladanie'), pallets, QUARTER_MIN));
    expect(crew.members.map((x) => x.task)).toEqual(['kasa', 'wykladanie', 'sprzatanie', 'wolny']);
    expect(pickSpy).toHaveBeenCalledTimes(2);
    const after = crew.members.map((x) => x.walker.goal);
    expect(after[1]).not.toEqual(goals[1]);            // zmieniony idzie gdzie indziej
    expect([after[0], after[2], after[3]]).toEqual([goals[0], goals[2], goals[3]]);   // reszta zostaje
    expect(crew.members[1]!.walker.atGoal).toBe(false);
  });

  it('pierwsze zadanie nowej osoby (np. samo „wolny” w pierwszej minucie po otwarciu) poprawia się na pierwszej granicy kwadransa, choć od wejścia minęło mniej niż TASK_DWELL_S', () => {
    const crew = new StaffCrew(layout);
    const wanted = assign([0, 'kasa'], [1, 'wykladanie'], [2, 'sprzatanie']);
    crew.sync(input(assign([0, 'wolny'], [1, 'wolny'], [2, 'wolny']), pallets, 0));   // ekonomia na starcie nikomu niczego nie daje
    expect(crew.members.map((m) => m.task)).toEqual(['wolny', 'wolny', 'wolny']);
    const idle = crew.members.map((m) => m.walker.goal);
    for (let m = 1; m < QUARTER_MIN; m++) {
      crew.step(0.0625);
      crew.sync(input(wanted, pallets, m));
      expect(crew.members.map((x) => x.task)).toEqual(['wolny', 'wolny', 'wolny']);   // granica kwadransa nadal jest wymagana
    }
    expect(pickSpy).toHaveBeenCalledTimes(1);

    crew.sync(input(wanted, pallets, QUARTER_MIN));
    expect(crew.clock).toBeLessThan(TASK_DWELL_S);
    expect(crew.members.map((m) => m.task)).toEqual(['kasa', 'wykladanie', 'sprzatanie']);
    expect(pickSpy).toHaveBeenCalledTimes(2);
    expect(crew.members.map((m) => m.walker.goal)).not.toEqual(idle);   // ekipa idzie do nowych miejsc

    // Kolejna zmiana podlega zwykłemu postojowi od tej zmiany.
    const later = assign([0, 'wykladanie'], [1, 'wykladanie'], [2, 'sprzatanie']);
    for (let m = QUARTER_MIN + 1; m <= 2 * QUARTER_MIN; m++) {
      crew.step(0.0625);
      crew.sync(input(later, pallets, m));
    }
    expect(crew.members.map((m) => m.task)).toEqual(['kasa', 'wykladanie', 'sprzatanie']);   // kilka dziesiątych sekundy po zmianie: za wcześnie
  });

  it('wartość `previous` dostają ci, których zadanie trzymane się nie zmieniło od ostatniego liczenia', () => {
    const crew = new StaffCrew(layout);
    const crewAt = (one: StaffDuty): StaffAssignment[] => assign([0, 'kasa'], [1, one], [2, 'sprzatanie'], [3, 'wolny']);
    crew.sync(input(crewAt('wykladanie'), pallets, 0));
    expect([...(pickSpy.mock.calls[0]![4] ?? new Map<number, StaffSpot>()).keys()]).toEqual([]);   // pierwsze liczenie: nikt jeszcze nigdzie nie stał
    const first = pickSpy.mock.results[0]!.value as Map<number, StaffSpot>;

    advance(crew, TASK_DWELL_S + 1);
    for (let m = 1; m <= QUARTER_MIN; m++) crew.sync(input(crewAt('sprzatanie'), pallets, m));   // 1 zmienia zadanie na granicy
    expect(member(crew, 1).task).toBe('sprzatanie');
    expect(pickSpy).toHaveBeenCalledTimes(2);
    const previous = pickSpy.mock.calls[1]![4] as Map<number, StaffSpot>;
    expect([...previous.keys()].sort()).toEqual([0, 2, 3]);                        // bez osoby 1, której zadanie się zmieniło
    for (const id of [0, 2, 3]) expect(previous.get(id)).toEqual(first.get(id));   // poprzednie miejsca, nie wymyślone
  });

  it('nowa osoba o mniejszym id nie przegania innych: wykładający i sprzątający zostają na swoich miejscach', () => {
    const crew = new StaffCrew(layout);
    const before = assign([3, 'wykladanie'], [4, 'wykladanie'], [5, 'sprzatanie'], [6, 'wolny']);
    crew.sync(input(before, pallets));
    const goals = crew.members.map((m) => m.walker.goal);
    // Bez `previous` wykładanie liczy się po numerze wśród wykładających, więc dołożenie id 1 przesunęłoby obu.
    const shifted = pickStaffSpots(layout, navFor(layout, pallets), pallets, assign([1, 'wykladanie'], ...before.map((p): [number, StaffDuty] => [p.id, p.task])));
    expect(shifted.get(3)!.cell).not.toEqual(goals[0]);
    pickSpy.mockClear();

    crew.sync(input([...assign([1, 'wykladanie']), ...before], pallets));
    expect(idsOf(crew)).toEqual([1, 3, 4, 5, 6]);
    expect(crew.members.slice(1).map((m) => m.walker.goal)).toEqual(goals);
    for (const m of crew.members.slice(1)) {
      expect(m.walker.atGoal).toBe(true);
      expect(m.walker.moving).toBe(false);
    }
    expect(member(crew, 1).walker.atGoal).toBe(false);   // a nowa idzie do swojego
  });
});

describe('StaffCrew: palety', () => {
  const s = SCENES[0]!;
  const { layout, pallets } = s;
  const crewWith = (n: number): StaffCrew => {
    const crew = new StaffCrew(layout);
    crew.sync(input(people(n), pallets));
    pickSpy.mockClear();
    navSpy.mockClear();
    setGoalSpy.mockClear();
    repathSpy.mockClear();
    return crew;
  };

  it('zmiana samego `since` nie przebudowuje siatki, nie liczy miejsc od nowa i nie każe przeplanować dróg', () => {
    const crew = crewWith(5);
    const before = snapshot(crew);
    crew.sync(input(people(5), pallets.map((p) => ({ ...p, since: p.since + 100 }))));
    expect(navSpy).not.toHaveBeenCalled();
    expect(pickSpy).not.toHaveBeenCalled();
    expect(repathSpy).not.toHaveBeenCalled();
    expect(snapshot(crew)).toEqual(before);
  });

  it('ta sama paleta na innej lokacji (te same kratki) liczy miejsca od nowa, ale siatki nie rusza', () => {
    const crew = crewWith(5);
    crew.sync(input(people(5), pallets.map((p) => ({ ...p, loc: p.loc === 'floor' ? 'backroom' : 'floor' }))));
    expect(pickSpy).toHaveBeenCalledTimes(1);
    expect(navSpy).not.toHaveBeenCalled();
    expect(repathSpy).not.toHaveBeenCalled();
  });

  it('kolejność palet w wejściu nie zmienia zbioru kratek, więc siatka zostaje', () => {
    const crew = crewWith(3);
    crew.sync(input(people(3), [...pallets].reverse()));
    expect(navSpy).not.toHaveBeenCalled();
    expect(repathSpy).not.toHaveBeenCalled();
  });

  it('zmiana zbioru kratek palet przebudowuje siatkę, każe przeplanować drogi wszystkim (także wychodzącym) i liczy miejsca', () => {
    const crew = crewWith(5);
    crew.sync(input(assign(...people(5).slice(0, 4).map((p): [number, StaffDuty] => [p.id, p.task])), pallets));   // 4 zostaje, id 4 wychodzi
    expect(member(crew, 4).leaving).toBe(true);
    pickSpy.mockClear();
    navSpy.mockClear();
    repathSpy.mockClear();
    const extra: PalletRef = { loc: 'sidewalk', spot: computeStoreInfo(layout).spots.sidewalk[3]!, since: 999 };
    crew.sync(input(people(4), [...pallets, extra]));
    expect(navSpy).toHaveBeenCalledTimes(1);
    const keys = (cells: readonly Cell[]): string[] => cells.map((c) => `${c.x},${c.y}`).sort();
    expect(keys(navSpy.mock.calls[0]![1])).toEqual(keys([...pallets, extra].flatMap((p) => spotCells(p.spot))));   // kratki wszystkich palet
    expect(repathSpy).toHaveBeenCalledTimes(crew.members.length);
    expect(crew.members).toHaveLength(5);
    expect(pickSpy).toHaveBeenCalledTimes(1);
    expect(pickSpy.mock.calls[0]![2]).toEqual([...pallets, extra]);
  });

  it.each(SCENES)('$seed: opróżnienie jednej palety nie rusza rozładowującego, który stał przy drugiej, a brak palet zostawia obu na miejscach', (sc) => {
    const [floor, sidewalk] = [sc.pallets[1]!, sc.pallets[2]!];   // rozładunek obsługuje chodnik, potem salę
    const who = assign([0, 'rozladunek'], [1, 'rozladunek']);
    const crew = new StaffCrew(sc.layout);
    crew.sync(input(who, [sidewalk, floor]));
    const [first, second] = [member(crew, 0), member(crew, 1)];
    const goals = [first.walker.goal, second.walker.goal];
    expect(goals[0]).not.toEqual(goals[1]);

    crew.sync(input(who, [floor]));                      // paleta na chodniku opróżniona
    expect(second.walker.goal).toEqual(goals[1]);        // ten przy palecie na sali nie rusza
    expect(second.walker.atGoal).toBe(true);
    expect(first.walker.goal).not.toEqual(goals[0]);     // ten przy opróżnionej idzie do pozostałej
    expect(first.walker.goal).not.toEqual(second.walker.goal);
    const moved = first.walker.goal;

    crew.sync(input(who, []));                           // nie ma już żadnej palety
    expect(second.walker.goal).toEqual(goals[1]);
    expect(first.walker.goal).toEqual(moved);            // zostają, zamiast iść w róg chodnika
    expect(sc.layout.palletZoneOutside.some((c) => sameCell(c, first.walker.goal!) || sameCell(c, second.walker.goal!))).toBe(false);
  });

  it.each(SCENES)('$seed: paleta, która pojawia się na drodze idącego, zmusza go do obejścia i nie przeszkadza dojść na miejsce', (sc) => {
    const crew = new StaffCrew(sc.layout);
    const base = assign([0, 'kasa']);
    const hired = assign([0, 'kasa'], [1, 'wykladanie']);
    crew.sync(input(base));
    crew.sync(input(hired));
    const hire = member(crew, 1);
    const goal = hire.walker.goal!;
    const open = navFor(sc.layout, []);
    const route = findPath(open.width, open.depth, open.blocked, sc.street, goal)!;
    advance(crew, 1);                                  // ~2,6 kratki marszu: paleta ma być dalej na trasie
    const pallet: PalletRef = { loc: 'sidewalk', spot: { x: route[6]!.x, y: route[6]!.y }, since: 0 };
    const blocked = new Set(spotCells(pallet.spot).map((c) => `${c.x},${c.y}`));
    expect(route.some((c) => blocked.has(`${c.x},${c.y}`))).toBe(true);   // paleta naprawdę leży na trasie
    expect(blocked.has(`${cellOf(hire).x},${cellOf(hire).y}`)).toBe(false);
    expect(blocked.has(`${goal.x},${goal.y}`)).toBe(false);

    crew.sync(input(hired, [pallet]));
    expect(hire.walker.goal).toEqual(goal);
    const visited: Cell[] = [];
    until(crew, () => hire.walker.atGoal, 120, () => visited.push(cellOf(hire)));
    expect(hire.walker.atGoal).toBe(true);
    expect(pos(hire)).toEqual(centre(goal));
    expect(visited.length).toBeGreaterThan(10);
    expect(visited.some((c) => blocked.has(`${c.x},${c.y}`))).toBe(false);
  });
});

describe('StaffCrew: wejście tylko do odczytu', () => {
  const s = SCENES[1]!;

  it('układ, ludzie i palety zamrożone głęboko: konstruktor, sync (zatrudnienie, zwolnienie, nowa paleta) i step nie rzucają, nic się nie zmienia', () => {
    const layout = deepFreeze(structuredClone(s.layout));
    const pallets = deepFreeze(structuredClone(s.pallets));
    const extra = deepFreeze(structuredClone<PalletRef[]>([...s.pallets, { loc: 'sidewalk', spot: computeStoreInfo(s.layout).spots.sidewalk[3]!, since: 7 }]));
    const crewA = deepFreeze(people(5));
    const crewB = deepFreeze(people(7));
    const crewC = deepFreeze(people(2));
    const before = JSON.stringify({ layout, pallets, extra, crewA, crewB, crewC });

    const crew = new StaffCrew(layout);
    crew.sync(input(crewA, pallets));
    advance(crew, 2);
    crew.sync(input(crewB, extra, MINUTE + 1));
    advance(crew, 3);
    crew.sync(input(crewC, extra, MINUTE + 2));
    expect(() => until(crew, () => crew.members.length === 2, 60)).not.toThrow();
    expect(idsOf(crew)).toEqual([0, 1]);
    expect(JSON.stringify({ layout, pallets, extra, crewA, crewB, crewC })).toBe(before);
  });

  it('załoga nie trzyma wejścia po referencji: zmiany tablic i obiektów po sync jej nie ruszają', () => {
    const layout = structuredClone(s.layout);
    const control = new StaffCrew(structuredClone(s.layout));
    const crew = new StaffCrew(layout);
    // Układ zepsuty po konstrukcji: gdyby załoga trzymała go po referencji, nie miałaby ani wejścia, ani mebli.
    layout.cells.fill('wall');
    layout.entrance.length = 0;
    layout.fixtures.length = 0;
    layout.spawnPoints.length = 0;
    layout.checkoutQueue.length = 0;
    layout.palletZoneOutside.length = 0;

    const who = people(5);
    const pallets = structuredClone(s.pallets);
    control.sync(input(structuredClone(who), structuredClone(pallets)));
    crew.sync(input(who, pallets));
    const goals = snapshot(crew);
    expect(goals).toEqual(snapshot(control));
    who[0]!.task = 'wolny';
    who.length = 0;
    pallets[0]!.spot.x = 0;
    pallets.length = 0;
    advance(crew, 3);
    advance(control, 3);
    expect(snapshot(crew)).toEqual(snapshot(control));
    expect(crew.members).toHaveLength(5);
  });
});

describe('StaffCrew: układ bez wejścia albo punktów pojawiania się', () => {
  // Brak części układu nie może wywrócić klatki: ludzie wchodzą tam, gdzie się da (punkt pojawiania się, a bez niego samo wejście
  // albo róg siatki), a zatrudnienie, zwolnienie i marsz działają jak zwykle.
  const base = SCENES[0]!;
  const variants: [string, (l: StoreLayout) => void, (l: StoreLayout) => Cell][] = [
    ['bez punktów pojawiania się', (l) => { l.spawnPoints.length = 0; }, (l) => l.entrance[0]!],
    ['bez wejścia', (l) => { l.entrance.length = 0; }, (l) => l.spawnPoints[0]!],
    ['bez jednego i drugiego', (l) => { l.spawnPoints.length = 0; l.entrance.length = 0; }, () => ({ x: 0, y: 0 })],
  ];
  it.each(variants)('%s: pierwszy sync, zatrudnienie, zwolnienie i marsz nie rzucają', (_name, damage, expectedStreet) => {
    const layout = structuredClone(base.layout);
    damage(layout);
    const crew = new StaffCrew(layout);
    expect(() => {
      crew.sync(input(people(3)));
      crew.sync(input(people(4)));
      const hire = member(crew, 3);
      expect(pos(hire)).toEqual(centre(expectedStreet(base.layout)));
      advance(crew, 5);
      crew.sync(input(people(2)));
      until(crew, () => crew.members.length === 2, 40);
    }).not.toThrow();
    expect(idsOf(crew)).toEqual([0, 1]);
  });
});

describe('StaffCrew: czas', () => {
  const { layout, pallets } = SCENES[0]!;

  it('dt niebędące skończoną liczbą dodatnią jest ignorowane (zegar i marsz stoją), kolejne poprawne dt działa', () => {
    const crew = new StaffCrew(layout);
    crew.sync(input(assign([0, 'kasa']), pallets));
    crew.sync(input(assign([0, 'kasa'], [1, 'wykladanie']), pallets));
    crew.step(0.5);
    const clock = crew.clock;
    const before = snapshot(crew);
    for (const dt of [Number.NaN, -1, -Infinity, Infinity, 0]) {
      crew.step(dt);
      expect(crew.clock).toBe(clock);
      expect(snapshot(crew)).toEqual(before);
    }
    crew.step(0.25);
    expect(crew.clock).toBe(clock + 0.25);
    expect(snapshot(crew)).not.toEqual(before);
    expect(Number.isFinite(member(crew, 1).walker.x)).toBe(true);
  });

  it('wynik nie zależy od losowości: dwa takie same przebiegi dają ten sam zapis', () => {
    const run = (): string => {
      const crew = new StaffCrew(layout);
      const trace: unknown[] = [];
      crew.sync(input(people(5), pallets));
      for (let i = 0; i < 300; i++) {
        if (i === 20) crew.sync(input(people(7), pallets, MINUTE + 1));
        if (i === 80) crew.sync(input(people(3), [...pallets, { loc: 'sidewalk', spot: computeStoreInfo(layout).spots.sidewalk[3]!, since: 5 }], MINUTE + 2));
        crew.step(DT);
        trace.push(snapshot(crew));
      }
      return JSON.stringify(trace);
    };
    expect(run()).toBe(run());
  });
});

describe('StaffCrew: zamknięcie sklepu', () => {
  // Noc w grze to ok. 5 s czasu widoku (420 minut przy 84 minutach na sekundę), niezależnie od prędkości gry: przy ×8 klatka
  // niesie 8 razy więcej czasu widoku, a noc trwa tyle samo. Załoga ma w tym czasie wyjść ze sklepu (z zaplecza także).
  const NIGHT_S = 5;

  /** Ekipa po pierwszym `sync` stoi na miejscach (zaplecze, sala, kasa), potem ekonomia podaje pustą zmianę. */
  function closeShop(sc: Scene, tasks: StaffDuty[]): StaffCrew {
    const crew = new StaffCrew(sc.layout);
    crew.sync(input(tasks.map((task, id) => ({ id, task })), sc.pallets));
    advance(crew, 1);
    crew.sync(input([], sc.pallets, MINUTE + 15 * 60));
    return crew;
  }

  it.each(SCENES.map((sc) => [sc.seed, sc] as const))('%s: z zaplecza i z sali wszyscy znikają w czasie nocy, przy ×1 i przy ×8', (_seed, sc) => {
    for (const speed of [1, 8]) {
      const crew = closeShop(sc, ['wolny', 'wolny', 'wolny', 'wolny', 'wolny', 'wykladanie', 'kasa', 'rozladunek']);
      expect(crew.members.every((m) => m.leaving)).toBe(true);
      const from = crew.clock;
      // jak w grze: klatki po 1/60 s rzeczywistych × prędkość, a `sync` z pustą zmianą co ~100 ms
      while (crew.members.length > 0 && crew.clock - from < 2 * NIGHT_S) {
        crew.step(speed / 60);
        if (Math.round((crew.clock - from) * 60 / speed) % 6 === 0) crew.sync(input([], sc.pallets, MINUTE + 15 * 60));
      }
      expect(crew.members, `${sc.seed} ×${speed}`).toEqual([]);
      expect(crew.clock - from, `${sc.seed} ×${speed}`).toBeLessThanOrEqual(NIGHT_S);
    }
  });

  it('wychodzący idzie LEAVE_RUSH razy szybciej: droga do wyjścia trwa tyle, ile długość trasy / (tempo × LEAVE_RUSH)', () => {
    const sc = SCENES[0]!;
    const crew = closeShop(sc, ['wolny']);
    const m = member(crew, 0);
    const route = findPath(sc.layout.width, sc.layout.depth, navFor(sc.layout, sc.pallets).blocked, cellOf(m), sc.exit)!;
    const expected = (route.length - 1) / (STAFF_WALK_SPEED * staffSpeedFactor(0) * LEAVE_RUSH);
    const elapsed = until(crew, () => m.walker.atGoal, 30);
    expect(elapsed).toBeGreaterThan(expected - 2 * DT);
    expect(elapsed).toBeLessThan(expected + 4 * DT);
  });
});

describe('StaffCrew: roboty (eDward) w załodze', () => {
  const sc = SCENES[0]!;
  const withEdward = (humans: readonly StaffAssignment[], task: StaffDuty = 'wolny'): StaffAssignment[] => [...humans, { id: EDWARD_ID, task }];

  it('numery robotów są spoza zakresu ludzi, a robot ma własny limit', () => {
    expect(isRobotId(EDWARD_ID)).toBe(true);
    expect(isRobotId(STAFF_VIEW_MAX - 1)).toBe(false);
    expect(EDWARD_ID).toBeGreaterThan(STAFF_VIEW_MAX);
    expect(ROBOT_VIEW_MAX).toBeGreaterThanOrEqual(1);
  });

  it('eDward obok kompletu ludzi nie zabiera miejsca nikomu: wszyscy ludzie i on', () => {
    const crew = new StaffCrew(sc.layout);
    crew.sync(input(withEdward(people(STAFF_VIEW_MAX)), sc.pallets));
    expect(crew.members).toHaveLength(STAFF_VIEW_MAX + 1);
    expect(idsOf(crew)).toEqual([...Array.from({ length: STAFF_VIEW_MAX }, (_, i) => i), EDWARD_ID]);
  });

  it('nadmiar robotów jest ucięty do limitu, a ludzi nie dotyka', () => {
    const crew = new StaffCrew(sc.layout);
    crew.sync(input([...people(3), { id: EDWARD_ID, task: 'wolny' }, { id: EDWARD_ID + 1, task: 'wolny' }, { id: EDWARD_ID + 2, task: 'wolny' }], sc.pallets));
    expect(crew.members.filter((m) => isRobotId(m.id))).toHaveLength(ROBOT_VIEW_MAX);
    expect(crew.members.filter((m) => !isRobotId(m.id))).toHaveLength(3);
  });

  it('robot nigdy nie bierze ciała kasjera, nawet gdy jest jedynym przybyszem (noc, wczytanie zapisu)', () => {
    const crew = new StaffCrew(sc.layout);
    crew.sync(input(withEdward([]), sc.pallets));
    expect(crew.members.map((m) => [m.id, m.isCashier])).toEqual([[EDWARD_ID, false]]);
    // człowiek, który przychodzi później, dostaje ciało kasjera
    crew.sync(input(withEdward(assign([0, 'kasa'])), sc.pallets));
    expect(member(crew, 0).isCashier).toBe(true);
    expect(member(crew, EDWARD_ID).isCashier).toBe(false);
  });

  it('człowiek i robot przychodzący razem: ciało kasjera ma człowiek (najmniejsze id)', () => {
    const crew = new StaffCrew(sc.layout);
    crew.sync(input(withEdward(people(2)), sc.pallets));
    expect(crew.members.filter((m) => m.isCashier).map((m) => m.id)).toEqual([0]);
  });

  it('eDward zostaje, gdy ludzie kończą zmianę, i wychodzi dopiero wtedy, gdy znika z listy', () => {
    const crew = new StaffCrew(sc.layout);
    crew.sync(input(withEdward(people(3)), sc.pallets));
    crew.sync(input(withEdward([]), sc.pallets, MINUTE + 15 * 60));
    expect(member(crew, EDWARD_ID).leaving).toBe(false);
    for (const id of [0, 1, 2]) expect(member(crew, id).leaving).toBe(true);
    crew.sync(input([], sc.pallets, MINUTE + 15 * 60 + 15));
    expect(member(crew, EDWARD_ID).leaving).toBe(true);
  });

  it('bez eDwarda wynik jest taki sam jak dawniej (robot niczego nie zmienia ludziom)', () => {
    const a = new StaffCrew(sc.layout);
    const b = new StaffCrew(sc.layout);
    a.sync(input(people(5), sc.pallets));
    b.sync(input(withEdward(people(5)), sc.pallets));
    for (let i = 0; i < 40; i++) { a.step(DT); b.step(DT); }
    for (let id = 0; id < 5; id++) expect(pos(member(b, id))).toEqual(pos(member(a, id)));
  });

  describe('przeszkody (maszyny na zapleczu)', () => {
    const blocked: Cell[] = [{ x: 3, y: sc.layout.depth - 2 }, { x: 4, y: sc.layout.depth - 2 }];

    it('buduje siatkę z przeszkodami i planuje drogi od nowa tylko przy zmianie ich zbioru', () => {
      const crew = new StaffCrew(sc.layout);
      crew.sync({ ...input(people(2), sc.pallets), obstacles: blocked });
      const builds = navSpy.mock.calls.length;
      const lastBlocked = navSpy.mock.calls[builds - 1]![1] as readonly Cell[];
      for (const c of blocked) expect(lastBlocked.some((b) => b.x === c.x && b.y === c.y)).toBe(true);
      crew.sync({ ...input(people(2), sc.pallets), obstacles: blocked });
      expect(navSpy.mock.calls.length).toBe(builds);
      crew.sync({ ...input(people(2), sc.pallets), obstacles: [] });
      expect(navSpy.mock.calls.length).toBe(builds + 1);
    });

    it('nikt nie dostaje miejsca na kratce przeszkody', () => {
      const crew = new StaffCrew(sc.layout);
      const wolni = Array.from({ length: STAFF_VIEW_MAX }, (_, id): StaffAssignment => ({ id, task: 'wolny' }));
      crew.sync({ ...input(wolni, sc.pallets), obstacles: blocked });
      for (const m of crew.members) {
        const cell = cellOf(m);
        expect(blocked.some((b) => b.x === cell.x && b.y === cell.y), `osoba ${m.id} na ${cell.x},${cell.y}`).toBe(false);
      }
    });
  });
});
