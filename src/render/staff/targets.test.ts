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
import { STAFF_VIEW_MAX, type PalletRef, type StaffAssignment, type StaffDuty, type StaffSpot } from './types';

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
