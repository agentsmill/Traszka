import { describe, expect, it } from 'vitest';
import { cashierSpot } from '@/game/cashier';
import { staffStripCells } from '@/sim/crowd/crowd';
import { computeStoreInfo, spotCells, type PalletSpot } from '@/sim/economy/storeInfo';
import { cellKey, manhattan, type Cell } from '@/sim/grid';
import { findPath } from '@/sim/nav/astar';
import { createRng, subSeed } from '@/sim/rng';
import { generateStore } from '@/sim/store/generateStore';
import { layoutFromParts, validParts, type LayoutParts } from '@/sim/store/testLayouts';
import { FRONT_WALL_Y, type Fixture, type StoreLayout } from '@/sim/store/types';
import { accessCells } from '@/sim/store/validate';
import { buildStaffNav, type StaffNav } from './staffNav';
import { pickStaffSpots } from './targets';
import { EDWARD_ID, STAFF_VIEW_MAX, type PalletRef, type StaffAssignment, type StaffDuty, type StaffSpot } from './types';
import { placeRobots } from '@/render/robots/robotPlacement';
import { layoutFor } from '@/sim/store/layoutFor';

// Siedem układów: dwa bloki, dwie kamienice (jedna narożna) i trzy pawilony (seed-6 ma kasę po prawej stronie).
const SEEDS = ['alfa', 'kamienica-3', 'beta-12', 'seed-2', 'seed-0', 'seed-5', 'seed-6'];
const BROWSE: Fixture['kind'][] = ['gondola', 'wallShelf', 'fridge'];
const DUTIES: StaffDuty[] = ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny'];

interface Setup { seed: string; layout: StoreLayout; pallets: PalletRef[]; nav: StaffNav }

/**
 * Układ z czterema paletami podanymi celowo w złej kolejności (zaplecze, sala, chodnik, chodnik) i z `since` malejącym wzdłuż
 * tablicy: dopiero sortowanie jak w `doWork` ustawia je jako chodnik (since 200), chodnik (300), sala, zaplecze.
 */
function setup(seed: string): Setup {
  const layout = generateStore(seed);
  const { spots } = computeStoreInfo(layout);
  expect(spots.backroom.length).toBeGreaterThanOrEqual(1);
  expect(spots.floor.length).toBeGreaterThanOrEqual(1);
  expect(spots.sidewalk.length).toBeGreaterThanOrEqual(3);
  const pallets: PalletRef[] = [
    { loc: 'backroom', spot: spots.backroom[0]!, since: 500 },
    { loc: 'floor', spot: spots.floor[0]!, since: 400 },
    { loc: 'sidewalk', spot: spots.sidewalk[2]!, since: 300 },
    { loc: 'sidewalk', spot: spots.sidewalk[1]!, since: 200 },
  ];
  return { seed, layout, pallets, nav: buildStaffNav(layout, pallets.flatMap((p) => spotCells(p.spot))) };
}
const SETUPS = SEEDS.map(setup);

/** Palety w kolejności, w jakiej obsłuży je rozładunek (chodnik, sala, zaplecze; potem `since`). */
const unloadOrder = (s: Setup): PalletRef[] => [s.pallets[3]!, s.pallets[2]!, s.pallets[1]!, s.pallets[0]!];

const crewOf = (tasks: readonly StaffDuty[]): StaffAssignment[] => tasks.map((task, id) => ({ id, task }));
const repeat = (task: StaffDuty, n: number): StaffDuty[] => Array.from({ length: n }, () => task);

const centreOfCell = (c: Cell): { x: number; y: number } => ({ x: c.x + 0.5, y: c.y + 0.5 });
const centreOfRect = (r: { x: number; y: number; w: number; d: number }): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.d / 2 });
const palletCentre = (p: PalletSpot): { x: number; y: number } => ({ x: p.x + 1, y: p.y + 1 });
const headingFrom = (c: Cell, to: { x: number; y: number }): number => Math.atan2(to.y - (c.y + 0.5), to.x - (c.x + 0.5));
const angleBetween = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};
/** Czy kratka leży po boku kwadratu 2×2 palety (8 kratek bez narożników). */
const besidePallet = (c: Cell, p: PalletSpot): boolean =>
  ((c.x === p.x || c.x === p.x + 1) && (c.y === p.y - 1 || c.y === p.y + 2))
  || ((c.y === p.y || c.y === p.y + 1) && (c.x === p.x - 1 || c.x === p.x + 2));
const sideCells = (p: PalletSpot): Cell[] => [
  { x: p.x - 1, y: p.y }, { x: p.x - 1, y: p.y + 1 }, { x: p.x + 2, y: p.y }, { x: p.x + 2, y: p.y + 1 },
  { x: p.x, y: p.y - 1 }, { x: p.x + 1, y: p.y - 1 }, { x: p.x, y: p.y + 2 }, { x: p.x + 1, y: p.y + 2 },
];
const stripOf = (layout: StoreLayout): Cell[] => {
  const seen = new Set<number>();
  return staffStripCells(layout).filter((c) => !seen.has(cellKey(c)) && seen.add(cellKey(c)));
};
const sameCell = (a: Cell, b: Cell): boolean => a.x === b.x && a.y === b.y;
/** Kolejność „najbliżej”: manhattan od środka podanego punktu, remis: mniejsze y, potem mniejsze x. */
const nearestFirst = (cells: Cell[], to: { x: number; y: number }): Cell[] => cells
  .map((c) => ({ c, d: Math.abs(c.x + 0.5 - to.x) + Math.abs(c.y + 0.5 - to.y) }))
  .sort((a, b) => a.d - b.d || a.c.y - b.c.y || a.c.x - b.c.x)
  .map((e) => e.c);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Wspólne gwarancje: spot dla każdego id, kratka w siatce i osiągalna z chodnika, kierunek skończony, kratki różne. */
function expectSane(layout: StoreLayout, nav: StaffNav, crew: readonly StaffAssignment[], spots: Map<number, StaffSpot>): void {
  expect(spots.size).toBe(crew.length);
  const seen = new Set<number>();
  for (const { id } of crew) {
    const spot = spots.get(id);
    expect(spot, `spot dla id ${id}`).toBeDefined();
    const { cell, heading } = spot!;
    expect(Number.isInteger(cell.x) && Number.isInteger(cell.y)).toBe(true);
    expect(Number.isFinite(heading)).toBe(true);
    expect(findPath(nav.width, nav.depth, nav.blocked, layout.spawnPoints[0]!, cell), `kratka ${cell.x},${cell.y} (id ${id}) osiągalna`).not.toBeNull();
    expect(seen.has(cellKey(cell)), `kratka ${cell.x},${cell.y} (id ${id}) zajęta drugi raz`).toBe(false);
    seen.add(cellKey(cell));
  }
}

describe('pickStaffSpots: każde zadanie i mieszanki na wielu układach', () => {
  it('układy obejmują blok, kamienicę i pawilon', () => {
    expect(new Set(SETUPS.map((s) => s.layout.lot.kind))).toEqual(new Set(['blok', 'kamienica', 'pawilon']));
  });

  describe.each(SETUPS)('$seed', (s) => {
    const { layout, nav, pallets } = s;

    it.each(DUTIES.flatMap((d) => [1, 3, STAFF_VIEW_MAX].map((n): [StaffDuty, number] => [d, n])))('%s × %i osób: spoty osiągalne i różne', (task, n) => {
      const crew = crewOf(repeat(task, n));
      expectSane(layout, nav, crew, pickStaffSpots(layout, nav, pallets, crew));
    });

    it.each([1, 3, STAFF_VIEW_MAX])('mieszanka %i osób: spoty osiągalne i różne', (n) => {
      const mix: StaffDuty[] = ['wolny', 'kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'kasa', 'rozladunek', 'wykladanie'];
      const crew = crewOf(mix.slice(0, n));
      expectSane(layout, nav, crew, pickStaffSpots(layout, nav, pallets, crew));
    });

    it('kasa: pierwsza osoba (najmniejsze id) stoi na kratce kasjera i patrzy jak kasjer, nawet gdy niżej są inne zadania', () => {
      const spot = cashierSpot(layout)!;
      const crew: StaffAssignment[] = [{ id: 6, task: 'kasa' }, { id: 1, task: 'rozladunek' }, { id: 4, task: 'kasa' }, { id: 0, task: 'wolny' }];
      const spots = pickStaffSpots(layout, nav, pallets, crew);
      expect(spots.get(4)).toEqual({ cell: spot.cell, heading: spot.heading });
      expect(spots.get(6)!.cell).not.toEqual(spot.cell);
    });

    it('kasa: kolejne osoby stoją na pasie personelu najbliżej kasjera i patrzą w stronę kasy', () => {
      const spot = cashierSpot(layout)!;
      const till = layout.fixtures.find((f) => f.kind === 'checkout')!;
      const lane = nearestFirst(stripOf(layout).filter((c) => !sameCell(c, spot.cell)), centreOfCell(spot.cell));
      expect(lane.length).toBeGreaterThanOrEqual(2);
      const crew = crewOf(repeat('kasa', 3));
      const spots = pickStaffSpots(layout, nav, pallets, crew);
      expect(spots.get(1)!.cell).toEqual(lane[0]);
      expect(spots.get(2)!.cell).toEqual(lane[1]);
      for (const id of [1, 2]) {
        const { cell, heading } = spots.get(id)!;
        expect(angleBetween(heading, headingFrom(cell, centreOfRect(till)))).toBeLessThan(1e-9);
      }
    });

    it('rozładunek: osoby obsługują palety w kolejności chodnik, sala, zaplecze; stoją obok kwadratu palety i patrzą na niego', () => {
      const order = unloadOrder(s);
      const crew = crewOf(repeat('rozladunek', STAFF_VIEW_MAX));
      const spots = pickStaffSpots(layout, nav, pallets, crew);
      for (const { id } of crew) {
        const pallet = order[id % order.length]!;
        const { cell, heading } = spots.get(id)!;
        expect(besidePallet(cell, pallet.spot), `id ${id} przy palecie ${pallet.loc}`).toBe(true);
        expect(angleBetween(heading, headingFrom(cell, palletCentre(pallet.spot)))).toBeLessThan(Math.PI / 2);
      }
    });

    it('rozładunek: pierwsza osoba stoi na kratce przy palecie najbliższej wejścia', () => {
      const first = unloadOrder(s)[0]!;   // paleta na chodniku
      const spots = pickStaffSpots(layout, nav, pallets, crewOf(['rozladunek']));
      const beside = nearestFirst(sideCells(first.spot).filter((c) => !nav.blocked(c.x, c.y)), centreOfCell(layout.entrance[0]!));
      expect(spots.get(0)!.cell).toEqual(beside[0]);
    });

    it('rozładunek bez palet: wolna kratka strefy palet na chodniku, twarzą do wejścia', () => {
      const bare = buildStaffNav(layout, []);
      const crew = crewOf(repeat('rozladunek', 3));
      const spots = pickStaffSpots(layout, bare, [], crew);
      expectSane(layout, bare, crew, spots);
      const zone = new Set(layout.palletZoneOutside.map(cellKey));
      for (const { id } of crew) {
        const { cell, heading } = spots.get(id)!;
        expect(zone.has(cellKey(cell))).toBe(true);
        expect(angleBetween(heading, headingFrom(cell, centreOfCell(layout.entrance[0]!)))).toBeLessThan(Math.PI / 2);
      }
    });

    it('wykładanie: stoją na kratkach dostępu kolejnych mebli (gondola, regał ścienny, lodówka) i patrzą na mebel', () => {
      const shelves = layout.fixtures.filter((f) => BROWSE.includes(f.kind) && accessCells(layout, f).some((c) => !nav.blocked(c.x, c.y)));
      expect(shelves.length).toBeGreaterThanOrEqual(3);
      const crew = crewOf(repeat('wykladanie', 3));
      const spots = pickStaffSpots(layout, nav, pallets, crew);
      for (const { id } of crew) {
        const f = shelves[id]!;
        const { cell, heading } = spots.get(id)!;
        const access = accessCells(layout, f).filter((c) => !nav.blocked(c.x, c.y));
        expect(cell, `id ${id} przy meblu ${f.id}`).toEqual(access[Math.floor(access.length / 2)]);
        expect(angleBetween(heading, headingFrom(cell, centreOfRect(f)))).toBeLessThan(Math.PI / 2);
      }
    });

    it('sprzątanie: osiągalna wolna kratka sali poza kolejką i pasem personelu, kierunek wzdłuż osi', () => {
      const queue = new Set(layout.checkoutQueue.map(cellKey));
      const strip = new Set(staffStripCells(layout).map(cellKey));
      const axes = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      const spots = pickStaffSpots(layout, nav, pallets, crewOf(repeat('sprzatanie', STAFF_VIEW_MAX)));
      for (const { cell, heading } of spots.values()) {
        expect(cell.y).toBeGreaterThanOrEqual(FRONT_WALL_Y + 1);
        expect(cell.y).toBeLessThan(layout.midWallY);
        expect(queue.has(cellKey(cell))).toBe(false);
        expect(strip.has(cellKey(cell))).toBe(false);
        expect(axes.some((a) => angleBetween(a, heading) < 1e-9)).toBe(true);
      }
    });

    it('wolny: na zapleczu, w odległości co najmniej 2 od drzwi, twarzą do drzwi, z odstępem między osobami', () => {
      const door = layout.fixtures.find((f) => f.kind === 'backroomDoor')!;
      const doorCells = [...Array(door.w * door.d).keys()].map((i) => ({ x: door.x + (i % door.w), y: door.y + Math.floor(i / door.w) }));
      const crew = crewOf(repeat('wolny', 4));
      const spots = pickStaffSpots(layout, nav, pallets, crew);
      for (const { cell, heading } of spots.values()) {
        expect(layout.cells[cell.y * layout.width + cell.x]).toBe('backroom');
        expect(Math.min(...doorCells.map((d) => manhattan(d, cell)))).toBeGreaterThanOrEqual(2);
        expect(angleBetween(heading, headingFrom(cell, centreOfRect(door)))).toBeLessThan(1e-9);
      }
      const cells = [...spots.values()].map((v) => v.cell);
      for (const a of cells) {
        for (const b of cells) if (a !== b) expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThanOrEqual(2);
      }
    });

    it('jest deterministyczna: dwa wywołania dają to samo, także przy zmienionej kolejności `crew`', () => {
      const crew = crewOf(['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny', 'kasa', 'rozladunek', 'sprzatanie']);
      const first = pickStaffSpots(layout, nav, pallets, crew);
      expect(pickStaffSpots(layout, nav, pallets, crew)).toEqual(first);
      expect(pickStaffSpots(layout, nav, pallets, [...crew].reverse())).toEqual(first);
    });

    it('nie mutuje argumentów: układ, siatka, palety i ekipa zamrożone głęboko nie powodują wyjątku', () => {
      const crew = crewOf(['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny', 'kasa']);
      const expected = pickStaffSpots(layout, nav, pallets, crew);
      const frozenLayout = deepFreeze(structuredClone(layout));
      const frozenPallets = deepFreeze(structuredClone(pallets));
      const frozenCrew = deepFreeze(structuredClone(crew));
      const frozenNav = deepFreeze(buildStaffNav(frozenLayout, frozenPallets.flatMap((p) => spotCells(p.spot))));
      expect(pickStaffSpots(frozenLayout, frozenNav, frozenPallets, frozenCrew)).toEqual(expected);
    });

    it('zwraca własne kratki: zmiana wyniku nie rusza układu', () => {
      const before = JSON.stringify(layout);
      const spots = pickStaffSpots(layout, nav, pallets, crewOf(['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny']));
      for (const spot of spots.values()) { spot.cell.x += 100; spot.cell.y += 100; }
      expect(JSON.stringify(layout)).toBe(before);
    });

    it('pusta ekipa daje pustą mapę', () => {
      expect(pickStaffSpots(layout, nav, pallets, []).size).toBe(0);
    });
  });
});

describe('pickStaffSpots: dokładne reguły na ręcznie złożonym układzie', () => {
  // Kamienica 16 × 19: kasjer na (2,8) patrzy na wschód, pas personelu to x=2, y=6..12, wejście (6,4),(7,4), drzwi (2,14),(3,14) w
  // ścianie, zaplecze x=1..14, y=15..17. Gondole (6,7) i (10,7), regał ścienny (14,7), cztery lodówki przy ścianie środkowej.
  const make = (edit?: (p: LayoutParts) => void): StoreLayout => {
    const parts = validParts();
    edit?.(parts);
    return layoutFromParts(parts);
  };
  const layout = make();
  const navOf = (l: StoreLayout, pallets: readonly PalletRef[] = []): StaffNav => buildStaffNav(l, pallets.flatMap((p) => spotCells(p.spot)));
  const pick = (l: StoreLayout, crew: readonly StaffAssignment[], pallets: readonly PalletRef[] = []): Map<number, StaffSpot> =>
    pickStaffSpots(l, navOf(l, pallets), pallets, crew);
  const cellsOf = (m: Map<number, StaffSpot>): Cell[] => [...m.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.cell);

  it('kasa: kolejne osoby zajmują pas od kasjera na zewnątrz, a przy remisie wyżej', () => {
    const spots = pick(layout, crewOf(repeat('kasa', 5)));
    expect(spots.get(0)).toEqual({ cell: { x: 2, y: 8 }, heading: 0 });
    // odległość 1: (2,7) przed (2,9); odległość 2: (2,6) przed (2,10)
    expect(cellsOf(spots)).toEqual([{ x: 2, y: 8 }, { x: 2, y: 7 }, { x: 2, y: 9 }, { x: 2, y: 6 }, { x: 2, y: 10 }]);
    // kasa (3,7)-(3,10) ma środek (3.5, 9): z (2,7) patrzy się w dół i w prawo
    expect(spots.get(1)!.heading).toBeCloseTo(Math.atan2(9 - 7.5, 3.5 - 2.5), 12);
  });

  it('kasa: gdy pas się skończy, kolejne osoby stoją na sali, a kasjer nadal ma swoje miejsce', () => {
    const spots = pick(layout, crewOf(repeat('kasa', STAFF_VIEW_MAX)));
    const strip = new Set(stripOf(layout).map(cellKey));
    expect([...spots.values()].filter((v) => strip.has(cellKey(v.cell)))).toHaveLength(7);
    expect(spots.get(0)!.cell).toEqual({ x: 2, y: 8 });
    expect(new Set(cellsOf(spots).map(cellKey)).size).toBe(STAFF_VIEW_MAX);
  });

  it('kasa: bez miejsca kasjera (brak kasy) osoby stoją na pasie personelu od góry', () => {
    const noTill = make((p) => { p.fixtures = p.fixtures.filter((f) => f.kind !== 'checkout'); });
    expect(cashierSpot(noTill)).toBeNull();
    const strip = stripOf(noTill);
    expect(strip.length).toBeGreaterThan(0);
    const spots = pick(noTill, crewOf(repeat('kasa', 2)));
    const sorted = [...strip].sort((a, b) => a.y - b.y || a.x - b.x);
    expect(cellsOf(spots)).toEqual(sorted.slice(0, 2));
  });

  it('kasa: bez kasy i bez pasa staje na początku kolejki, a gdy i jej brak, na sali', () => {
    const bare = make((p) => { p.fixtures = p.fixtures.filter((f) => f.kind === 'backroomDoor'); });
    const queueOnly = make((p) => { p.fixtures = p.fixtures.filter((f) => f.kind === 'backroomDoor'); p.checkoutQueue = []; });
    expect(stripOf(bare)).toHaveLength(0);
    expect(cellsOf(pick(bare, crewOf(['kasa'])))).toEqual([bare.checkoutQueue[0]]);
    const none = pick(queueOnly, crewOf(repeat('kasa', 2)));
    expect(none.size).toBe(2);
    for (const { cell } of none.values()) {
      expect(cell.y).toBeGreaterThan(FRONT_WALL_Y);
      expect(cell.y).toBeLessThan(queueOnly.midWallY);
    }
  });

  it('rozładunek: sidewalk, floor i backroom wybierają kratkę przy palecie najbliższą wejścia albo drzwi (remis: wyżej, potem bliżej lewej)', () => {
    const pallets: PalletRef[] = [
      { loc: 'backroom', spot: { x: 10, y: 16 }, since: 3 },
      { loc: 'floor', spot: { x: 8, y: 8 }, since: 2 },
      { loc: 'sidewalk', spot: { x: 9, y: 1 }, since: 1 },
    ];
    const spots = pick(layout, crewOf(repeat('rozladunek', 3)), pallets);
    // chodnik: (9,3) i (8,2) są od wejścia (6,4) w odległości 4; wiersz 0 jest zamknięty
    expect(spots.get(0)!.cell).toEqual({ x: 8, y: 2 });
    expect(spots.get(0)!.heading).toBeCloseTo(Math.atan2(2 - 2.5, 10 - 8.5), 12);
    // sala: gondole zamykają boki (x=7 i x=10), najbliżej wejścia jest (8,7)
    expect(spots.get(1)!.cell).toEqual({ x: 8, y: 7 });
    expect(spots.get(1)!.heading).toBeCloseTo(Math.atan2(9 - 7.5, 9 - 8.5), 12);
    // zaplecze: liczy się odległość od środka drzwi (3, 14.5): (10,15) i (9,16) są równo daleko, wygrywa wyższe
    expect(spots.get(2)!.cell).toEqual({ x: 10, y: 15 });
  });

  it('kasa: miejsce kasjera należy do pierwszej osoby z kasą, także gdy rozładunek o niższym id szukałby tej samej kratki', () => {
    // paleta na sali (x=1..2, y=9..10) przylega od północy do kratki kasjera (2,8), która jest też kratką najbliżej wejścia
    const open = make((p) => { p.fixtures = p.fixtures.filter((f) => f.kind !== 'tobaccoShelf'); });
    const pallets: PalletRef[] = [{ loc: 'floor', spot: { x: 1, y: 9 }, since: 1 }];
    const spots = pick(open, [{ id: 0, task: 'rozladunek' }, { id: 1, task: 'kasa' }], pallets);
    expect(spots.get(1)!.cell).toEqual({ x: 2, y: 8 });
    expect(spots.get(0)!.cell).not.toEqual({ x: 2, y: 8 });
    expect(besidePallet(spots.get(0)!.cell, pallets[0]!.spot)).toBe(true);
  });

  it('rozładunek: gdy osób jest więcej niż palet, paleta wraca (k % liczba palet), a osoby nie dzielą kratki', () => {
    const pallets: PalletRef[] = [{ loc: 'floor', spot: { x: 8, y: 8 }, since: 1 }, { loc: 'sidewalk', spot: { x: 9, y: 1 }, since: 1 }];
    const spots = pick(layout, crewOf(repeat('rozladunek', 4)), pallets);
    const [a, b, c, d] = cellsOf(spots) as [Cell, Cell, Cell, Cell];
    expect(besidePallet(a, pallets[1]!.spot)).toBe(true);    // 0: chodnik
    expect(besidePallet(b, pallets[0]!.spot)).toBe(true);    // 1: sala
    expect(besidePallet(c, pallets[1]!.spot)).toBe(true);    // 2: znów chodnik
    expect(besidePallet(d, pallets[0]!.spot)).toBe(true);    // 3: znów sala
    expect(new Set([a, b, c, d].map(cellKey)).size).toBe(4);
  });

  it('rozładunek: tyle osób przy jednej palecie, że kończą się kratki dookoła, resztę zbiera sala (nadal twarzą do palety)', () => {
    // paleta w rogu zaplecza (kwadrat x=13..14, y=16..17) ma po bokach cztery wolne kratki: (12,16), (12,17), (13,15), (14,15)
    const pallets: PalletRef[] = [{ loc: 'backroom', spot: { x: 13, y: 16 }, since: 1 }];
    const crew = crewOf(repeat('rozladunek', 8));
    const spots = pick(layout, crew, pallets);
    expect(spots.size).toBe(8);
    expect(new Set(cellsOf(spots).map(cellKey)).size).toBe(8);
    const beside = [...spots.values()].filter((v) => besidePallet(v.cell, pallets[0]!.spot));
    expect(beside).toHaveLength(4);
    for (const { cell, heading } of spots.values()) {
      expect(angleBetween(heading, headingFrom(cell, palletCentre(pallets[0]!.spot)))).toBeLessThan(1e-9);
    }
    // ci bez kratki przy palecie stoją na sali (ogólna lista zapasowa), zaczynając od środka sali (x=8, y=9,5): kratka (8,9)
    const rest = [...spots.values()].filter((v) => !besidePallet(v.cell, pallets[0]!.spot));
    for (const { cell } of rest) {
      expect(cell.y).toBeGreaterThan(FRONT_WALL_Y);
      expect(cell.y).toBeLessThan(layout.midWallY);
    }
    expect(rest[0]!.cell).toEqual({ x: 8, y: 9 });
  });

  it('wykładanie: k-ta osoba bierze k-ty mebel i jego środkową kratkę dostępu, kolejne na kolejną kratkę, a gdy mebel pełny, następny mebel', () => {
    const shelves = layout.fixtures.filter((f) => BROWSE.includes(f.kind));
    const mid = (f: Fixture): Cell => { const a = accessCells(layout, f); return a[Math.floor(a.length / 2)]!; };
    const spots = pick(layout, crewOf(repeat('wykladanie', shelves.length + 1)));
    for (let k = 0; k < shelves.length; k++) expect(spots.get(k)!.cell).toEqual(mid(shelves[k]!));
    // gondola-1 (6,7) 2×4 przodem na zachód: kratki dostępu (5,7)…(5,10), środek (5,9); po niej (5,10)
    expect(spots.get(0)!.cell).toEqual({ x: 5, y: 9 });
    expect(spots.get(shelves.length)!.cell).toEqual({ x: 5, y: 10 });
  });

  it('wykładanie: mebel z jedną kratką dostępu, zajętą, odsyła na następny mebel', () => {
    const tiny = make((p) => {
      p.fixtures = [
        ...p.fixtures.filter((f) => f.kind === 'backroomDoor' || f.kind === 'checkout' || f.kind === 'tobaccoShelf'),
        { id: 'gondola-t', kind: 'gondola', x: 8, y: 8, w: 1, d: 1, facing: 'W' },
        { id: 'wallShelf-t', kind: 'wallShelf', x: 14, y: 7, w: 1, d: 4, facing: 'W' },
      ];
    });
    const spots = pick(tiny, crewOf(repeat('wykladanie', 4)));
    // osoba 0: gondola, jedyna kratka (7,8); osoba 1: regał, środek (13,9); osoba 2: gondola jest pełna, więc regał, następna kratka (13,10)
    expect(cellsOf(spots).slice(0, 3)).toEqual([{ x: 7, y: 8 }, { x: 13, y: 9 }, { x: 13, y: 10 }]);
    expect(spots.get(0)!.heading).toBeCloseTo(0, 12);   // gondola leży na wschód od (7,8)
    expect(new Set(cellsOf(spots).map(cellKey)).size).toBe(4);
  });

  it('wykładanie: bez mebli do wykładania staje na sali', () => {
    const empty = make((p) => { p.fixtures = p.fixtures.filter((f) => f.kind === 'backroomDoor'); });
    const spots = pick(empty, crewOf(repeat('wykladanie', 3)));
    expect(spots.size).toBe(3);
    for (const { cell } of spots.values()) {
      expect(cell.y).toBeGreaterThan(FRONT_WALL_Y);
      expect(cell.y).toBeLessThan(empty.midWallY);
    }
  });

  it('sprzątanie: wybór z `staff-clean:<id>` po liście sali posortowanej po (y, x), kierunek wzdłuż osi', () => {
    const nav = navOf(layout);
    const queue = new Set(layout.checkoutQueue.map(cellKey));
    const strip = new Set(staffStripCells(layout).map(cellKey));
    const candidates: Cell[] = [];
    for (let y = FRONT_WALL_Y + 1; y < layout.midWallY; y++) {
      for (let x = 0; x < layout.width; x++) {
        const reachable = findPath(nav.width, nav.depth, nav.blocked, layout.spawnPoints[0]!, { x, y }) !== null;
        if (reachable && !queue.has(cellKey({ x, y })) && !strip.has(cellKey({ x, y }))) candidates.push({ x, y });
      }
    }
    const cell = candidates[createRng(subSeed(layout.seed, 'staff-clean:4')).int(0, candidates.length)]!;
    const spots = pick(layout, [{ id: 4, task: 'sprzatanie' }]);
    expect(spots.get(4)!.cell).toEqual(cell);
    expect([0, Math.PI / 2, Math.PI, -Math.PI / 2].some((a) => angleBetween(a, spots.get(4)!.heading) < 1e-9)).toBe(true);
  });

  it('wolny: najbliższe drzwi kratki zaplecza w odstępie 2, kolejne osoby z przerwą co najmniej jednej kratki', () => {
    const spots = pick(layout, crewOf(repeat('wolny', 3)));
    // kratki tuż za drzwiami (2,15), (3,15) odpadają (odległość 1); od środka drzwi (3, 14.5) równo daleko są (1,15), (4,15), (2,16), (3,16)
    expect(spots.get(0)!.cell).toEqual({ x: 1, y: 15 });
    expect(spots.get(1)!.cell).toEqual({ x: 4, y: 15 });
    expect(spots.get(0)!.heading).toBeCloseTo(Math.atan2(14.5 - 15.5, 3 - 1.5), 12);
    const [a, b, c] = cellsOf(spots) as [Cell, Cell, Cell];
    for (const [p, q] of [[a, b], [a, c], [b, c]] as const) expect(Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y))).toBeGreaterThanOrEqual(2);
  });

  it('wolny: gdy zaplecze jest za ciasne na przerwy, osoby i tak dostają różne kratki zaplecza', () => {
    // zaplecze to jeden wiersz (x=1..14): z przerwą mieści się najwyżej 7 osób, ósma staje obok kogoś, zamiast wyjść na salę
    const narrow = make((p) => { p.lot = { ...p.lot, backroomDepth: 1 }; });
    const spots = pick(narrow, crewOf(repeat('wolny', STAFF_VIEW_MAX)));
    expect(new Set(cellsOf(spots).map(cellKey)).size).toBe(STAFF_VIEW_MAX);
    for (const { cell } of spots.values()) expect(cell.y).toBe(narrow.midWallY + 1);
  });

  it('wolny: układ bez zaplecza odsyła na salę', () => {
    const noBackroom = make((p) => { p.lot = { ...p.lot, backroomDepth: 0 }; });
    expect(noBackroom.cells.includes('backroom')).toBe(false);
    const spots = pick(noBackroom, crewOf(repeat('wolny', 2)));
    expect(spots.size).toBe(2);
    for (const { cell } of spots.values()) {
      expect(cell.y).toBeGreaterThan(FRONT_WALL_Y);
      expect(cell.y).toBeLessThan(noBackroom.midWallY);
    }
  });

  it('wolny: zaplecze bez drzwi jest nieosiągalne, więc osoby stoją na sali', () => {
    const sealed = make((p) => { p.fixtures = p.fixtures.filter((f) => f.kind !== 'backroomDoor'); });
    const spots = pick(sealed, crewOf(repeat('wolny', 2)));
    for (const { cell } of spots.values()) expect(cell.y).toBeLessThan(sealed.midWallY);
  });

  it('układ bez żadnych mebli i kolejki: każde zadanie ma spot na osiągalnej kratce', () => {
    const bare = make((p) => { p.fixtures = []; p.checkoutQueue = []; });
    const nav = navOf(bare);
    const crew = crewOf(DUTIES);
    expectSane(bare, nav, crew, pickStaffSpots(bare, nav, [], crew));
  });

  it('nie rzuca, gdy nic nie jest osiągalne: wszyscy stają na wejściu', () => {
    const everything: Cell[] = [];
    for (let y = 0; y < layout.depth; y++) for (let x = 0; x < layout.width; x++) everything.push({ x, y });
    const closed = buildStaffNav(layout, everything);
    const crew = crewOf(DUTIES);
    const spots = pickStaffSpots(layout, closed, [], crew);
    expect(spots.size).toBe(crew.length);
    for (const { cell, heading } of spots.values()) {
      expect(cell).toEqual(layout.entrance[0]);
      expect(Number.isFinite(heading)).toBe(true);
    }
  });

  it('nie rzuca nawet bez wejścia i bez punktów pojawiania się', () => {
    const lost: StoreLayout = { ...layout, entrance: [], spawnPoints: [] };
    const spots = pickStaffSpots(lost, navOf(layout), [], crewOf(DUTIES));
    expect(spots.size).toBe(DUTIES.length);
  });
});

describe('pickStaffSpots: `previous` (stabilność miejsc po zmianie ekipy lub palet)', () => {
  // Ten sam ręcznie złożony układ co wyżej: kasjer (2,8), zaplecze x=1..14, y=15..17, drzwi (2,14),(3,14), środek sali (8,9).
  const layout = layoutFromParts(validParts());
  const open = buildStaffNav(layout, []);
  const call = (
    crew: readonly StaffAssignment[],
    previous?: ReadonlyMap<number, StaffSpot>,
    nav: StaffNav = open,
    pallets: readonly PalletRef[] = [],
  ): Map<number, StaffSpot> => pickStaffSpots(layout, nav, pallets, crew, previous);
  const person = (id: number, task: StaffDuty): StaffAssignment => ({ id, task });
  const STICKY: StaffDuty[] = ['wykladanie', 'sprzatanie', 'wolny'];

  it.each(STICKY)('%s: osoba zostaje na miejscu, gdy dochodzi ktoś o niższym id (bez `previous` by się przesunęła)', (task) => {
    const alone = call([person(5, task)]);
    const joined = [person(0, task), person(5, task)];
    expect(call(joined).get(5)).not.toEqual(alone.get(5));
    const withPrevious = call(joined, alone);
    expect(withPrevious.get(5)).toEqual(alone.get(5));
    expectSane(layout, open, joined, withPrevious);
  });

  it.each(STICKY)('%s: osoba zostaje na miejscu, gdy odchodzi ktoś o niższym id (bez `previous` by się przesunęła)', (task) => {
    const pair = call([person(0, task), person(5, task)]);
    expect(call([person(5, task)]).get(5)).not.toEqual(pair.get(5));
    expect(call([person(5, task)], pair).get(5)).toEqual(pair.get(5));
  });

  it('zachowane miejsce ma dokładnie tę kratkę i ten kierunek, które podał caller', () => {
    const wanted: StaffSpot = { cell: { x: 9, y: 16 }, heading: 1.234 };
    expect(call([person(2, 'wolny')], new Map([[2, wanted]])).get(2)).toEqual(wanted);
  });

  it.each(STICKY)('%s: miejsce, którego kratka została zablokowana, jest porzucane i wybierane od nowa, reszta zostaje', (task) => {
    const crew = [person(1, task), person(4, task), person(6, task)];
    const first = call(crew);
    const gone = first.get(4)!.cell;
    const blocked = buildStaffNav(layout, [gone]);   // np. paleta wylądowała dokładnie tu
    const again = call(crew, first, blocked);
    expectSane(layout, blocked, crew, again);
    expect(again.get(4)!.cell).not.toEqual(gone);
    expect(again.get(1)).toEqual(first.get(1));
    expect(again.get(6)).toEqual(first.get(6));
  });

  it.each<[string, StaffSpot]>([
    ['ściana', { cell: { x: 0, y: 6 }, heading: 0 }],
    ['wiersz 0 chodnika', { cell: { x: 3, y: 0 }, heading: 0 }],
    ['mebel (gondola)', { cell: { x: 6, y: 7 }, heading: 0 }],
    ['poza siatką', { cell: { x: -3, y: 2 }, heading: 0 }],
    ['daleko poza siatką', { cell: { x: 999, y: 999 }, heading: 0 }],
    ['ułamkowa kratka', { cell: { x: 2.5, y: 15 }, heading: 0 }],
    ['kierunek NaN', { cell: { x: 4, y: 16 }, heading: Number.NaN }],
    ['kierunek nieskończony', { cell: { x: 4, y: 16 }, heading: Number.POSITIVE_INFINITY }],
  ])('niepoprawne poprzednie miejsce (%s) jest pomijane', (_, bad) => {
    const crew = [person(2, 'wolny')];
    expect(call(crew, new Map([[2, bad]]))).toEqual(call(crew));
  });

  it('dwie osoby z tą samą kratką w `previous`: zostaje niższe id, druga dostaje inną', () => {
    const crew = [person(2, 'sprzatanie'), person(5, 'sprzatanie')];
    const previous = new Map<number, StaffSpot>([
      [5, { cell: { x: 8, y: 9 }, heading: 0 }],
      [2, { cell: { x: 8, y: 9 }, heading: Math.PI }],
    ]);
    const spots = call(crew, previous);
    expect(spots.get(2)).toEqual({ cell: { x: 8, y: 9 }, heading: Math.PI });
    expect(spots.get(5)!.cell).not.toEqual({ x: 8, y: 9 });
    expectSane(layout, open, crew, spots);
  });

  it('miejsce kasjera jest zarezerwowane przed zachowanymi miejscami, ale bez kasy nic go nie blokuje', () => {
    const cs = cashierSpot(layout)!;
    const previous = new Map<number, StaffSpot>([[1, { cell: cs.cell, heading: 0 }]]);
    const withCashier = call([person(0, 'kasa'), person(1, 'wolny')], previous);
    expect(withCashier.get(0)).toEqual({ cell: cs.cell, heading: cs.heading });
    expect(withCashier.get(1)).toEqual(call([person(0, 'kasa'), person(1, 'wolny')]).get(1));
    expect(call([person(1, 'wolny')], previous).get(1)).toEqual({ cell: cs.cell, heading: 0 });
  });

  it('kasa ignoruje `previous`, a rozładunek pomija miejsca spoza palet (i nie zajmują przez nie kratek innym)', () => {
    const pallets: PalletRef[] = [{ loc: 'floor', spot: { x: 8, y: 8 }, since: 1 }, { loc: 'sidewalk', spot: { x: 9, y: 1 }, since: 1 }];
    const nav = buildStaffNav(layout, pallets.flatMap((p) => spotCells(p.spot)));
    const crew = [person(0, 'kasa'), person(1, 'kasa'), person(2, 'rozladunek'), person(3, 'rozladunek'), person(4, 'wolny')];
    const base = call(crew, undefined, nav, pallets);
    const bogus = new Map<number, StaffSpot>([0, 1, 2, 3].map((id) => [id, { cell: { x: 5 + id, y: 12 }, heading: 0.5 }]));
    expect(call(crew, bogus, nav, pallets)).toEqual(base);
    // kratka z `previous` kasjera jest wolna: stała osoba może ją zachować
    const claimed = new Map<number, StaffSpot>([...bogus, [4, { cell: { x: 5, y: 12 }, heading: 0 }]]);
    expect(call(crew, claimed, nav, pallets).get(4)).toEqual({ cell: { x: 5, y: 12 }, heading: 0 });
  });

  it('wpisy `previous` osób spoza ekipy nic nie zmieniają', () => {
    const crew = [person(2, 'wolny'), person(3, 'sprzatanie')];
    const previous = new Map<number, StaffSpot>([[99, { cell: { x: 8, y: 9 }, heading: 0 }], [3, call(crew).get(3)!]]);
    expect(call(crew, previous)).toEqual(call(crew));
  });

  it('nie zmienia `previous` i zwraca własne kratki; wszystko zamrożone głęboko też działa', () => {
    const crew = [person(0, 'kasa'), person(1, 'sprzatanie'), person(2, 'wolny'), person(3, 'wykladanie')];
    const first = call(crew);
    const snapshot = JSON.stringify([...first.entries()]);
    const frozenPrevious = new Map([...first.entries()].map(([id, spot]) => [id, deepFreeze(structuredClone(spot))]));
    const again = call(crew, frozenPrevious);
    expect(again).toEqual(first);
    expect(frozenPrevious.size).toBe(first.size);
    for (const [id, spot] of again) expect(spot.cell).not.toBe(frozenPrevious.get(id)!.cell);
    for (const spot of again.values()) { spot.cell.x += 100; spot.heading += 1; }
    expect(JSON.stringify([...frozenPrevious.entries()])).toBe(snapshot);

    const frozenLayout = deepFreeze(structuredClone(layout));
    const frozenCrew = deepFreeze(structuredClone(crew));
    const frozenNav = deepFreeze(buildStaffNav(frozenLayout, []));
    expect(pickStaffSpots(frozenLayout, frozenNav, deepFreeze([] as PalletRef[]), frozenCrew, frozenPrevious)).toEqual(first);
  });

  it('zadanie spoza listy (uszkodzone dane) też dostaje miejsce: kolejne kratki sali od jej środka', () => {
    const crew = [person(0, 'kasa'), person(1, 'nieznane' as StaffDuty), person(2, 'nieznane' as StaffDuty)];
    const spots = call(crew);
    expectSane(layout, open, crew, spots);
    expect(spots.get(1)!.cell).toEqual({ x: 8, y: 9 });
    expect(spots.get(2)!.cell).toEqual({ x: 8, y: 8 });
    // `previous` takiej osoby jest pomijane jak dla kasy
    expect(call(crew, new Map([[1, { cell: { x: 5, y: 12 }, heading: 0 }]]))).toEqual(spots);
  });
});

describe('pickStaffSpots: `previous` dla rozładunku (stabilne miejsca przy paletach)', () => {
  // Ten sam ręcznie złożony układ: wejście (6,4),(7,4), strefa palet na chodniku, kasjer (2,8). Dwie palety: na chodniku
  // (x=9..10, y=1..2) i na sali (x=8..9, y=8..9); rozładunek obsługuje je w tej kolejności (chodnik, sala).
  const layout = layoutFromParts(validParts());
  const SIDE: PalletRef = { loc: 'sidewalk', spot: { x: 9, y: 1 }, since: 1 };
  const FLOOR: PalletRef = { loc: 'floor', spot: { x: 8, y: 8 }, since: 2 };
  const navOf = (pallets: readonly PalletRef[]): StaffNav => buildStaffNav(layout, pallets.flatMap((p) => spotCells(p.spot)));
  const call = (crew: readonly StaffAssignment[], pallets: readonly PalletRef[], previous?: ReadonlyMap<number, StaffSpot>): Map<number, StaffSpot> =>
    pickStaffSpots(layout, navOf(pallets), pallets, crew, previous);
  const unloaders = (...ids: number[]): StaffAssignment[] => ids.map((id) => ({ id, task: 'rozladunek' }));
  const zone = new Set(layout.palletZoneOutside.map(cellKey));

  it('bez `previous` pierwsza osoba stoi przy palecie na chodniku, druga przy palecie na sali, a ich kierunek to środek palety', () => {
    const spots = call(unloaders(0, 1), [SIDE, FLOOR]);
    expect(besidePallet(spots.get(0)!.cell, SIDE.spot)).toBe(true);
    expect(besidePallet(spots.get(1)!.cell, FLOOR.spot)).toBe(true);
    expect(spots.get(0)!.heading).toBeCloseTo(headingFrom(spots.get(0)!.cell, palletCentre(SIDE.spot)), 12);
    expect(spots.get(1)!.heading).toBeCloseTo(headingFrom(spots.get(1)!.cell, palletCentre(FLOOR.spot)), 12);
  });

  it('opróżnienie jednej z dwóch palet nie rusza rozładowującego, który stał przy drugiej; drugi dostaje nowe miejsce przy pozostałej', () => {
    const crew = unloaders(0, 1);
    const first = call(crew, [SIDE, FLOOR]);
    // Bez `previous` obaj zbiegają się przy jedynej palecie i ten, który tam stał, ustępuje pierwszej kratce niższemu id.
    expect(call(crew, [FLOOR]).get(1)).not.toEqual(first.get(1));
    const after = call(crew, [FLOOR], first);
    expect(after.get(1)).toEqual(first.get(1));
    expect(besidePallet(after.get(0)!.cell, FLOOR.spot)).toBe(true);
    expect(after.get(0)!.heading).toBeCloseTo(headingFrom(after.get(0)!.cell, palletCentre(FLOOR.spot)), 12);
    expect(after.get(0)!.cell).not.toEqual(first.get(0)!.cell);
    expectSane(layout, navOf([FLOOR]), crew, after);

    // i odwrotnie: znika paleta na sali, ten przy chodniku zostaje
    const rest = call(crew, [SIDE], first);
    expect(rest.get(0)).toEqual(first.get(0));
    expect(besidePallet(rest.get(1)!.cell, SIDE.spot)).toBe(true);
    expectSane(layout, navOf([SIDE]), crew, rest);
  });

  it('dołączenie osoby o niższym id nie przestawia dotychczasowych (bez `previous` by się przesunęli), tak samo odejście', () => {
    const pallets = [SIDE, FLOOR];
    const first = call(unloaders(3, 5), pallets);
    const joined = unloaders(1, 3, 5);
    const without = call(joined, pallets);
    expect(without.get(3)).not.toEqual(first.get(3));
    expect(without.get(5)).not.toEqual(first.get(5));
    const second = call(joined, pallets, first);
    expect(second.get(3)).toEqual(first.get(3));
    expect(second.get(5)).toEqual(first.get(5));
    expect(pallets.some((p) => besidePallet(second.get(1)!.cell, p.spot))).toBe(true);
    expectSane(layout, navOf(pallets), joined, second);

    const left = call(unloaders(5), pallets, second);
    expect(left.get(5)).toEqual(first.get(5));
    expect(call(unloaders(5), pallets).get(5)).not.toEqual(first.get(5));
  });

  it('zostaje też przy innej palecie z listy niż ta, którą dałaby kolejność (miejsce przy jakiejkolwiek istniejącej palecie jest dobre)', () => {
    const atFloor = call(unloaders(0, 1), [SIDE, FLOOR]).get(1)!;      // stała przy palecie na sali
    const alone = call(unloaders(0), [SIDE, FLOOR], new Map([[0, atFloor]]));
    expect(alone.get(0)).toEqual(atFloor);                              // sama dostałaby paletę na chodniku
    expect(call(unloaders(0), [SIDE, FLOOR]).get(0)).not.toEqual(atFloor);
  });

  it('kierunek zachowanego miejsca to środek palety z listy, przy której kratka leży (także gdy caller podał inny)', () => {
    const atFloor = call(unloaders(0, 1), [SIDE, FLOOR]).get(1)!;
    const stale = new Map<number, StaffSpot>([[0, { cell: atFloor.cell, heading: 3 }]]);
    const kept = call(unloaders(0), [SIDE, FLOOR], stale).get(0)!;
    expect(kept.cell).toEqual(atFloor.cell);
    expect(kept.heading).toBeCloseTo(headingFrom(atFloor.cell, palletCentre(FLOOR.spot)), 12);
  });

  it('przy kratce przylegającej do dwóch palet kierunek wskazuje wcześniejszą w kolejności rozładunku (remis odległości)', () => {
    // Kratka (12,10) leży po prawej stronie palety (10,10) i po lewej stronie palety (13,10): równo daleko od obu środków.
    const left: PalletRef = { loc: 'floor', spot: { x: 10, y: 10 }, since: 2 };
    const right: PalletRef = { loc: 'sidewalk', spot: { x: 13, y: 10 }, since: 3 };
    const cell = { x: 12, y: 10 };
    expect(besidePallet(cell, left.spot) && besidePallet(cell, right.spot)).toBe(true);
    const kept = call(unloaders(0), [left, right], new Map([[0, { cell, heading: 0 }]])).get(0)!;
    expect(kept.cell).toEqual(cell);
    expect(kept.heading).toBeCloseTo(headingFrom(cell, palletCentre(right.spot)), 12);   // chodnik przed salą
  });

  it('palety zniknęły wszystkie: osoby zostają na miejscach (kierunek bez zmian) zamiast iść w róg chodnika', () => {
    const crew = unloaders(0, 1, 2);
    const first = call(crew, [SIDE, FLOOR]);
    const bare = call(crew, [], first);
    expect(bare).toEqual(first);
    // bez `previous` te same osoby poszłyby do strefy palet na chodniku
    for (const spot of call(crew, []).values()) expect(zone.has(cellKey(spot.cell))).toBe(true);
    // nowa osoba w tym samym czasie dostaje strefę palet, a nie zajęte kratki
    const joined = call(unloaders(0, 1, 2, 3), [], first);
    for (const id of [0, 1, 2]) expect(joined.get(id)).toEqual(first.get(id));
    expect(zone.has(cellKey(joined.get(3)!.cell))).toBe(true);
    expectSane(layout, navOf([]), unloaders(0, 1, 2, 3), joined);
  });

  it('paleta, przy której stała osoba, zniknęła, a inna istnieje: osoba dostaje nowe miejsce przy istniejącej palecie, jak bez `previous`', () => {
    const crew = unloaders(0);
    const first = call(crew, [SIDE, FLOOR]);
    expect(besidePallet(first.get(0)!.cell, SIDE.spot)).toBe(true);
    const after = call(crew, [FLOOR], first);
    expect(besidePallet(after.get(0)!.cell, FLOOR.spot)).toBe(true);
    expect(besidePallet(after.get(0)!.cell, SIDE.spot)).toBe(false);
    expect(after).toEqual(call(crew, [FLOOR]));
    expect(after.get(0)).not.toEqual(first.get(0));
  });

  it('miejsce przy palecie, która przesunęła się o kilka kratek, nie jest zachowane (kratka nie przylega już do żadnej palety z listy)', () => {
    const moved: PalletRef = { loc: 'sidewalk', spot: { x: 13, y: 1 }, since: 1 };
    const first = call(unloaders(0), [SIDE]);
    const after = call(unloaders(0), [moved], first);
    expect(besidePallet(after.get(0)!.cell, moved.spot)).toBe(true);
    expect(after.get(0)).not.toEqual(first.get(0));
  });

  it('zachowane miejsce przegrywa z rezerwacją kasjera, z zablokowaną kratką i z osobą o niższym id, która ma tę samą kratkę', () => {
    const cs = cashierSpot(layout)!;
    const open: PalletRef = { loc: 'floor', spot: { x: 1, y: 9 }, since: 1 };   // przylega od północy do kratki kasjera
    expect(besidePallet(cs.cell, open.spot)).toBe(true);
    const reserved = call([{ id: 0, task: 'rozladunek' }, { id: 1, task: 'kasa' }], [open], new Map([[0, { cell: cs.cell, heading: 0 }]]));
    expect(reserved.get(1)!.cell).toEqual(cs.cell);
    expect(reserved.get(0)!.cell).not.toEqual(cs.cell);
    expect(besidePallet(reserved.get(0)!.cell, open.spot)).toBe(true);

    const first = call(unloaders(0), [SIDE]);
    const blocked = buildStaffNav(layout, [...spotCells(SIDE.spot), first.get(0)!.cell]);   // paleta wylądowała na jego kratce
    const after = pickStaffSpots(layout, blocked, [SIDE], unloaders(0), first);
    expect(after.get(0)!.cell).not.toEqual(first.get(0)!.cell);
    expect(besidePallet(after.get(0)!.cell, SIDE.spot)).toBe(true);

    const both = new Map<number, StaffSpot>([[4, { cell: first.get(0)!.cell, heading: 0 }], [2, { cell: first.get(0)!.cell, heading: 1 }]]);
    const twins = call(unloaders(2, 4), [SIDE], both);
    expect(twins.get(2)!.cell).toEqual(first.get(0)!.cell);
    expect(twins.get(4)!.cell).not.toEqual(first.get(0)!.cell);
    expectSane(layout, navOf([SIDE]), unloaders(2, 4), twins);
  });

  it('zachowane miejsca rozładunku i innych zadań są obsadzane razem przed resztą: nowe osoby o niższych id ich nie przestawiają', () => {
    const crew: StaffAssignment[] = [
      { id: 5, task: 'wolny' }, { id: 6, task: 'sprzatanie' }, { id: 7, task: 'wykladanie' }, { id: 3, task: 'rozladunek' }, { id: 4, task: 'rozladunek' },
    ];
    const first = call(crew, [SIDE, FLOOR]);
    const joined: StaffAssignment[] = [...crew, { id: 1, task: 'rozladunek' }, { id: 2, task: 'wolny' }, { id: 0, task: 'wykladanie' }];
    expect(call(joined, [SIDE, FLOOR]).get(3)).not.toEqual(first.get(3));   // bez `previous` nowy rozładowujący przestawia starych
    const second = call(joined, [SIDE, FLOOR], first);
    for (const { id } of crew) expect(second.get(id), `id ${id}`).toEqual(first.get(id));
    expectSane(layout, navOf([SIDE, FLOOR]), joined, second);
  });

  it('nie zmienia `previous`; wejścia zamrożone głęboko (z rozładunkiem i paletami) nie powodują wyjątku', () => {
    const crew: StaffAssignment[] = [{ id: 0, task: 'kasa' }, { id: 1, task: 'rozladunek' }, { id: 2, task: 'rozladunek' }, { id: 3, task: 'wolny' }];
    const first = call(crew, [SIDE, FLOOR]);
    const snapshot = JSON.stringify([...first.entries()]);
    const frozenPrevious = new Map([...first.entries()].map(([id, spot]) => [id, deepFreeze(structuredClone(spot))]));
    const again = call(crew, [SIDE, FLOOR], frozenPrevious);
    expect(again).toEqual(first);
    for (const [id, spot] of again) expect(spot.cell).not.toBe(frozenPrevious.get(id)!.cell);
    for (const spot of again.values()) { spot.cell.x += 100; spot.heading += 1; }
    expect(JSON.stringify([...frozenPrevious.entries()])).toBe(snapshot);

    const frozenLayout = deepFreeze(structuredClone(layout));
    const frozenPallets = deepFreeze(structuredClone([SIDE, FLOOR]));
    const frozenCrew = deepFreeze(structuredClone(crew));
    const frozenNav = deepFreeze(buildStaffNav(frozenLayout, frozenPallets.flatMap((p) => spotCells(p.spot))));
    expect(pickStaffSpots(frozenLayout, frozenNav, frozenPallets, frozenCrew, frozenPrevious)).toEqual(first);
    expect(pickStaffSpots(frozenLayout, buildStaffNav(frozenLayout, []), deepFreeze([] as PalletRef[]), frozenCrew, frozenPrevious).get(1)).toEqual(first.get(1));
  });

  it('niepoprawne poprzednie miejsce rozładowującego (ściana, poza siatką, ułamek, brak palet z kierunkiem NaN) jest pomijane', () => {
    const crew = unloaders(0);
    const base = call(crew, [SIDE, FLOOR]);
    for (const bad of [{ x: 0, y: 6 }, { x: -3, y: 2 }, { x: 999, y: 999 }, { x: 2.5, y: 15 }, { x: 6, y: 7 }]) {
      expect(call(crew, [SIDE, FLOOR], new Map([[0, { cell: bad, heading: 0 }]])), `(${bad.x},${bad.y})`).toEqual(base);
    }
    const bareBase = call(crew, []);
    expect(call(crew, [], new Map([[0, { cell: { x: 8, y: 12 }, heading: Number.NaN }]]))).toEqual(bareBase);
    expect(call(crew, [], new Map([[0, { cell: { x: 8, y: 12 }, heading: Number.POSITIVE_INFINITY }]]))).toEqual(bareBase);
    expect(call(crew, [], new Map([[0, { cell: { x: 6, y: 7 }, heading: 0 }]]))).toEqual(bareBase);   // mebel
  });
});

describe.each(SETUPS)('pickStaffSpots z `previous`: $seed', ({ layout, nav, pallets }) => {
  const A = crewOf(['wolny', 'kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'kasa', 'rozladunek', 'wykladanie']);
  // ekipa po zmianie: odchodzą id 3 (wykładanie) i 5 (kasa), dochodzą id 9 (sprzątanie) i 10 (wolny)
  const B: StaffAssignment[] = [...A.filter((p) => p.id !== 3 && p.id !== 5), { id: 9, task: 'sprzatanie' }, { id: 10, task: 'wolny' }];

  it('mieszana ekipa po zmianie składu: kratki osiągalne i różne, stałe zadania zostają na miejscach', () => {
    const first = pickStaffSpots(layout, nav, pallets, A);
    const second = pickStaffSpots(layout, nav, pallets, B, first);
    expectSane(layout, nav, B, second);
    for (const id of [0, 4, 7]) expect(second.get(id), `id ${id}`).toEqual(first.get(id));   // wolny, sprzątanie, wykładanie
    const third = pickStaffSpots(layout, nav, pallets, A, second);
    expectSane(layout, nav, A, third);
    for (const id of [0, 4, 7]) expect(third.get(id), `id ${id}`).toEqual(first.get(id));
  });

  it('bez `previous` wynik jest taki sam jak z pustym `previous`', () => {
    expect(pickStaffSpots(layout, nav, pallets, A, new Map())).toEqual(pickStaffSpots(layout, nav, pallets, A));
  });

  it('rozładunek: opróżniona paleta, dołączenie osoby o niższym id i zniknięcie wszystkich palet nie przestawiają tych, którzy mają gdzie stać', () => {
    const tasks: StaffDuty[] = ['rozladunek', 'wolny', 'rozladunek', 'wykladanie', 'kasa', 'rozladunek', 'sprzatanie', 'rozladunek'];
    const crew: StaffAssignment[] = tasks.map((task, i) => ({ id: i + 2, task }));
    const unloaders = crew.filter((p) => p.task === 'rozladunek').map((p) => p.id);
    const first = pickStaffSpots(layout, nav, pallets, crew);
    expectSane(layout, nav, crew, first);

    // 1. znika pierwsza w kolejności rozładunku paleta
    const fewer = pallets.filter((p) => p !== pallets[3]);
    const fewerNav = buildStaffNav(layout, fewer.flatMap((p) => spotCells(p.spot)));
    const second = pickStaffSpots(layout, fewerNav, fewer, crew, first);
    expectSane(layout, fewerNav, crew, second);
    for (const id of unloaders) {
      const before = first.get(id)!.cell;
      if (fewer.some((p) => besidePallet(before, p.spot))) expect(second.get(id)!.cell, `id ${id} został`).toEqual(before);
      else expect(fewer.some((p) => besidePallet(second.get(id)!.cell, p.spot)), `id ${id} dostał miejsce przy palecie`).toBe(true);
    }

    // 2. dochodzą osoby o niższych id
    const joined: StaffAssignment[] = [{ id: 0, task: 'rozladunek' }, { id: 1, task: 'wolny' }, ...crew];
    const third = pickStaffSpots(layout, fewerNav, fewer, joined, second);
    expectSane(layout, fewerNav, joined, third);
    for (const id of unloaders) expect(third.get(id), `id ${id}`).toEqual(second.get(id));

    // 3. znikają wszystkie palety
    const bare = buildStaffNav(layout, []);
    const fourth = pickStaffSpots(layout, bare, [], joined, third);
    expectSane(layout, bare, joined, fourth);
    for (const id of unloaders) expect(fourth.get(id), `id ${id}`).toEqual(third.get(id));
  });

  it('rozładunek: łańcuch wywołań z `previous` przy zmieniających się ekipach i paletach daje zawsze osiągalne, różne kratki i zostawia osoby przy istniejących paletach', () => {
    const { spots } = computeStoreInfo(layout);
    const pool: PalletRef[] = [
      ...spots.sidewalk.slice(0, 3).map((spot): PalletRef => ({ loc: 'sidewalk', spot, since: 1 })),
      ...spots.floor.slice(0, 2).map((spot): PalletRef => ({ loc: 'floor', spot, since: 2 })),
      ...spots.backroom.slice(0, 2).map((spot): PalletRef => ({ loc: 'backroom', spot, since: 3 })),
    ];
    const rng = createRng(subSeed(layout.seed, 'rozladunek-lancuch'));
    const cashier = cashierSpot(layout);
    let previous = new Map<number, StaffSpot>();
    let last = new Map<number, StaffAssignment>();
    let kept = 0;
    for (let step = 0; step < 60; step++) {
      const crew: StaffAssignment[] = [];
      for (let id = 0; id < 10; id++) if (rng.int(0, 10) < 7) crew.push({ id, task: rng.int(0, 10) < 6 ? 'rozladunek' : DUTIES[rng.int(0, DUTIES.length)]! });
      const list = pool.filter(() => rng.int(0, 10) < 6);
      const stepNav = buildStaffNav(layout, list.flatMap((p) => spotCells(p.spot)));
      // jak załoga: `previous` dostają tylko ci, których zadanie się nie zmieniło
      const carried = new Map([...previous].filter(([id]) => last.get(id)?.task === crew.find((p) => p.id === id)?.task));
      const before = Object.freeze(new Map(carried));
      const result = pickStaffSpots(layout, stepNav, list, crew, carried);
      expect([...carried]).toEqual([...before]);
      expectSane(layout, stepNav, crew, result);
      for (const { id, task } of crew) {
        const old = carried.get(id);
        if (task !== 'rozladunek' || !old || list.length === 0) continue;
        const reachable = findPath(stepNav.width, stepNav.depth, stepNav.blocked, layout.spawnPoints[0]!, old.cell) !== null;
        if (reachable && cashier && !sameCell(old.cell, cashier.cell) && list.some((p) => besidePallet(old.cell, p.spot))) {
          expect(result.get(id)!.cell, `krok ${step}, id ${id}`).toEqual(old.cell);
          kept++;
        }
      }
      previous = result;
      last = new Map(crew.map((p) => [p.id, p]));
    }
    expect(kept).toBeGreaterThan(20);   // zachowywanie naprawdę bywa ćwiczone
  });

  it('nowa paleta na kratce zachowanego miejsca wypycha stamtąd osobę, reszta zostaje', () => {
    const first = pickStaffSpots(layout, nav, pallets, A);
    const gone = first.get(4)!.cell;   // sprzątająca
    const moved = buildStaffNav(layout, [...pallets.flatMap((p) => spotCells(p.spot)), gone]);
    const second = pickStaffSpots(layout, moved, pallets, A, first);
    expectSane(layout, moved, A, second);
    expect(second.get(4)!.cell).not.toEqual(gone);
    for (const id of [0, 7]) expect(second.get(id), `id ${id}`).toEqual(first.get(id));
  });
});

describe('pickStaffSpots: palety w przejściach (loc „aisle”) są salą, rozładowywaną zaraz po chodniku', () => {
  describe.each(SEEDS)('%s', (seed) => {
    const layout = generateStore(seed);
    const { spots } = computeStoreInfo(layout);
    const navOf = (list: readonly PalletRef[]): StaffNav => buildStaffNav(layout, list.flatMap((p) => spotCells(p.spot)));

    it('paleta w przejściu idzie po chodniku (mandat), a przed salą, choć stoi krócej; rozładunek staje obok jej kwadratu i patrzy na niego', () => {
      expect(spots.aisle.length).toBeGreaterThanOrEqual(3);
      const aisle: PalletRef = { loc: 'aisle', spot: spots.aisle[0]!, since: 900 };
      const sidewalk: PalletRef = { loc: 'sidewalk', spot: spots.sidewalk[0]!, since: 950 };
      const floor: PalletRef = { loc: 'floor', spot: spots.floor[0]!, since: 100 };
      const list = [floor, aisle, sidewalk];
      const nav = navOf(list);
      const crew = crewOf(repeat('rozladunek', 3));
      const picked = pickStaffSpots(layout, nav, list, crew);
      expectSane(layout, nav, crew, picked);
      expect(besidePallet(picked.get(0)!.cell, sidewalk.spot)).toBe(true);
      expect(besidePallet(picked.get(1)!.cell, aisle.spot)).toBe(true);
      expect(besidePallet(picked.get(2)!.cell, floor.spot)).toBe(true);
      expect(angleBetween(picked.get(1)!.heading, headingFrom(picked.get(1)!.cell, palletCentre(aisle.spot)))).toBeLessThan(Math.PI / 2);
    });

    it('pełne przejścia z kilkoma piętrami stosu na kwadracie: każdy ma osiągalne, różne miejsce', () => {
      const stacked = spots.aisle.flatMap((spot, i): PalletRef[] => [0, 1, 2].map((level) => ({ loc: 'aisle', spot, since: 100 + level * 10 + i })));
      const nav = navOf(stacked);
      for (const n of [1, 3, STAFF_VIEW_MAX]) {
        const crew = crewOf(repeat('rozladunek', n));
        const picked = pickStaffSpots(layout, nav, stacked, crew);
        expectSane(layout, nav, crew, picked);
      }
      const mix = crewOf(['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny', 'rozladunek']);
      expectSane(layout, nav, mix, pickStaffSpots(layout, nav, stacked, mix));
    });
  });
});

describe('pickStaffSpots: eDward i maszyny z warsztatu przy nadmiarze palet w przejściach (SIM 5 razem z robotami)', () => {
  // eDward (numer EDWARD_ID) dostaje cel jak każda osoba załogi; maszyny stoją na zapleczu i są przeszkodami (`CrewInput.obstacles`).
  // Przejścia leżą w sali, więc z maszynami się nie zderzają, a stosy w przejściach to kilka palet na tym samym kwadracie.
  describe.each(['traszka-1', 'kopytka-541', 'seed-3', 'makieta'])('%s', (seed) => {
    it.each([2, 3])('remont %i: maszyny poza miejscami palet, eDward i załoga obok palet w przejściach, nikt nie stoi w przeszkodzie', (level) => {
      const layout = layoutFor(seed, level);
      const { spots } = computeStoreInfo(layout);
      const robots = placeRobots(layout, { spots });
      const machines = [...(robots.conveyor ?? []), ...(robots.press ?? [])];
      const palletCells = new Set(Object.values(spots).flat().flatMap(spotCells).map(cellKey));
      for (const c of machines) expect(palletCells.has(cellKey(c)), `maszyna na ${c.x},${c.y}`).toBe(false);

      // przejścia pełne, na pierwszym kwadracie stos z trzech palet, do tego chodnik i zaplecze
      const aisle: PalletRef[] = spots.aisle.flatMap((spot, i): PalletRef[] =>
        (i === 0 ? [0, 1, 2] : [0]).map((k) => ({ loc: 'aisle', spot, since: 200 + 10 * i + k })));
      const list: PalletRef[] = [
        { loc: 'sidewalk', spot: spots.sidewalk[0]!, since: 300 }, ...aisle, { loc: 'backroom', spot: spots.backroom[0]!, since: 100 },
      ];
      const nav = buildStaffNav(layout, [...list.flatMap((p) => spotCells(p.spot)), ...machines]);
      const crew: StaffAssignment[] = [
        { id: 0, task: 'kasa' }, { id: 1, task: 'rozladunek' }, { id: 2, task: 'rozladunek' }, { id: 3, task: 'wykladanie' },
        { id: 4, task: 'sprzatanie' }, { id: EDWARD_ID, task: 'rozladunek' },
      ];
      const picked = pickStaffSpots(layout, nav, list, crew);
      expectSane(layout, nav, crew, picked);
      const blocked = new Set([...palletCells].filter((k) => list.some((p) => spotCells(p.spot).some((c) => cellKey(c) === k))));
      for (const c of machines) blocked.add(cellKey(c));
      for (const [id, { cell }] of picked) expect(blocked.has(cellKey(cell)), `id ${id} stoi w przeszkodzie ${cell.x},${cell.y}`).toBe(false);
      // przy paletach: najpierw chodnik, potem przejścia (eDward ma najwyższy numer, więc idzie ostatni z rozładunku). Gęsto
      // zastawione przejścia potrafią nie mieć wolnego boku, do którego da się dojść: wtedy eDward stoi na kratce zapasowej (utyka)
      expect(besidePallet(picked.get(1)!.cell, spots.sidewalk[0]!)).toBe(true);
      const edward = picked.get(EDWARD_ID)!.cell;
      const others = new Set([...picked].filter(([id]) => id !== EDWARD_ID).map(([, s]) => cellKey(s.cell)));
      const spawn = layout.spawnPoints[0]!;
      const freeSide = list.filter((p) => p.loc !== 'backroom').some((p) => sideCells(p.spot).some((c) =>
        !others.has(cellKey(c)) && findPath(nav.width, nav.depth, nav.blocked, spawn, c) !== null));
      if (freeSide) expect(list.some((p) => p.loc !== 'backroom' && besidePallet(edward, p.spot)), `eDward obok palety: ${edward.x},${edward.y}`).toBe(true);
    });
  });
});
