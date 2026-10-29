import { describe, expect, it } from 'vitest';
import { cashierSpot } from '@/game/cashier';
import { staffStripCells } from '@/sim/crowd/crowd';
import type { Cell } from '@/sim/grid';
import { findPath } from '@/sim/nav/astar';
import { generateStore } from '@/sim/store/generateStore';
import type { Fixture, StoreLayout } from '@/sim/store/types';
import { accessCells, isWalkable } from '@/sim/store/validate';
import { buildStaffNav, staffWalkable } from './staffNav';

// Siedem układów: dwa bloki, dwie kamienice (jedna narożna) i trzy pawilony (lustrzane z kasą po prawej też).
const SEEDS = ['alfa', 'kamienica-3', 'beta-12', 'seed-2', 'seed-0', 'seed-5', 'seed-6'];
const layouts = SEEDS.map((seed) => ({ seed, layout: generateStore(seed) }));

const allCells = (layout: StoreLayout): Cell[] => {
  const out: Cell[] = [];
  for (let y = 0; y < layout.depth; y++) for (let x = 0; x < layout.width; x++) out.push({ x, y });
  return out;
};
const typeAt = (layout: StoreLayout, c: Cell): string => layout.cells[c.y * layout.width + c.x]!;
const fixtureCells = (f: Fixture): Cell[] => {
  const out: Cell[] = [];
  for (let dy = 0; dy < f.d; dy++) for (let dx = 0; dx < f.w; dx++) out.push({ x: f.x + dx, y: f.y + dy });
  return out;
};
const BROWSE: Fixture['kind'][] = ['gondola', 'wallShelf', 'fridge'];

describe('układy użyte w testach', () => {
  it('obejmują blok, kamienicę i pawilon', () => {
    expect(new Set(layouts.map((l) => l.layout.lot.kind))).toEqual(new Set(['blok', 'kamienica', 'pawilon']));
  });
});

describe('staffWalkable', () => {
  it.each(layouts)('$seed: zaplecze i kratki drzwi na zaplecze są chodliwe', ({ layout }) => {
    const backroom = allCells(layout).filter((c) => typeAt(layout, c) === 'backroom');
    expect(backroom.length).toBeGreaterThan(0);
    for (const c of backroom) expect(staffWalkable(layout, c.x, c.y)).toBe(true);

    const doors = layout.fixtures.filter((f) => f.kind === 'backroomDoor');
    expect(doors).toHaveLength(1);
    const doorCells = fixtureCells(doors[0]!);
    expect(doorCells.length).toBeGreaterThanOrEqual(2);
    for (const c of doorCells) {
      expect(typeAt(layout, c)).toBe('fixture');            // klienci przez nie nie przejdą...
      expect(isWalkable(layout, c.x, c.y)).toBe(false);
      expect(staffWalkable(layout, c.x, c.y)).toBe(true);   // ...personel tak
    }
  });

  it.each(layouts)('$seed: wiersz 0 chodnika, ściany, witryny i meble nie są chodliwe', ({ layout }) => {
    for (let x = 0; x < layout.width; x++) {
      expect(typeAt(layout, { x, y: 0 })).toBe('outside');   // to kratki chodnika, a mimo to nikt tam nie wchodzi
      expect(staffWalkable(layout, x, 0)).toBe(false);
    }
    const doorKeys = new Set(
      layout.fixtures.filter((f) => f.kind === 'backroomDoor').flatMap(fixtureCells).map((c) => `${c.x},${c.y}`),
    );
    for (const c of allCells(layout)) {
      const t = typeAt(layout, c);
      if (t === 'wall' || t === 'window') expect(staffWalkable(layout, c.x, c.y)).toBe(false);
      if (t === 'fixture' && !doorKeys.has(`${c.x},${c.y}`)) expect(staffWalkable(layout, c.x, c.y)).toBe(false);
    }
  });

  it.each(layouts)('$seed: chodnik od wiersza 1, wejście, podłoga sali i pas personelu są chodliwe', ({ layout }) => {
    for (let y = 1; y < 4; y++) for (let x = 0; x < layout.width; x++) expect(staffWalkable(layout, x, y)).toBe(true);
    for (const e of layout.entrance) expect(staffWalkable(layout, e.x, e.y)).toBe(true);
    for (const c of allCells(layout)) {
      if (typeAt(layout, c) === 'floor') expect(staffWalkable(layout, c.x, c.y)).toBe(true);
    }
    const strip = staffStripCells(layout);
    expect(strip.length).toBeGreaterThan(0);
    for (const c of strip) expect(staffWalkable(layout, c.x, c.y)).toBe(true);   // klientom ten pas zamyka crowd, personelowi nie
  });

  it('poza siatką nic nie jest chodliwe', () => {
    const layout = generateStore('alfa');
    for (const [x, y] of [[-1, 1], [1, -1], [layout.width, 1], [1, layout.depth], [-5, -5], [1000, 1000]] as const) {
      expect(staffWalkable(layout, x, y)).toBe(false);
    }
  });
});

describe('buildStaffNav', () => {
  it.each(layouts)('$seed: wymiary siatki, ściany i brak palet', ({ layout }) => {
    const nav = buildStaffNav(layout, []);
    expect(nav.width).toBe(layout.width);
    expect(nav.depth).toBe(layout.depth);
    for (const c of allCells(layout)) expect(nav.blocked(c.x, c.y)).toBe(!staffWalkable(layout, c.x, c.y));
  });

  it('kratki palet są zablokowane, ich sąsiedzi nie', () => {
    const layout = generateStore('alfa');
    const pallet: Cell[] = [{ x: 3, y: 15 }, { x: 4, y: 15 }, { x: 3, y: 16 }, { x: 4, y: 16 }];   // wolna podłoga sali
    const nav = buildStaffNav(layout, pallet);
    for (const c of pallet) expect(nav.blocked(c.x, c.y)).toBe(true);
    for (const c of [{ x: 2, y: 15 }, { x: 5, y: 16 }, { x: 3, y: 14 }, { x: 4, y: 17 }]) expect(nav.blocked(c.x, c.y)).toBe(false);
  });

  it('kratki poza siatką są zablokowane, a przeszkody spoza siatki nie psują budowy', () => {
    const layout = generateStore('alfa');
    const nav = buildStaffNav(layout, [{ x: -3, y: 2 }, { x: 999, y: 2 }, { x: 2, y: 999 }]);
    for (const [x, y] of [[-1, 5], [5, -1], [layout.width, 5], [5, layout.depth], [-1, -1]] as const) expect(nav.blocked(x, y)).toBe(true);
    expect(nav.blocked(1, 1)).toBe(false);
  });

  it('nie zachowuje listy przeszkód i jej nie zmienia', () => {
    const layout = generateStore('alfa');
    const obstacles: Cell[] = [{ x: 3, y: 15 }];
    const nav = buildStaffNav(layout, obstacles);
    expect(obstacles).toEqual([{ x: 3, y: 15 }]);
    obstacles.push({ x: 6, y: 16 });
    obstacles[0]!.x = 4;
    expect(nav.blocked(3, 15)).toBe(true);    // siatka policzona w chwili budowy
    expect(nav.blocked(6, 16)).toBe(false);
    expect(nav.blocked(4, 15)).toBe(false);
  });

  it('`blocked` działa też oderwane od obiektu (jak w findPath)', () => {
    const layout = generateStore('alfa');
    const { blocked, width, depth } = buildStaffNav(layout, []);
    const path = findPath(width, depth, blocked, layout.spawnPoints[0]!, { x: 8, y: 8 });
    expect(path).not.toBeNull();
  });

  describe.each(layouts)('$seed: z chodnika da się dojść do', ({ layout }) => {
    const nav = buildStaffNav(layout, []);
    const from = layout.spawnPoints[0]!;
    const reach = (to: Cell): boolean => findPath(nav.width, nav.depth, nav.blocked, from, to) !== null;

    it('kratki kasjera i całego pasa personelu', () => {
      const spot = cashierSpot(layout);
      expect(spot).not.toBeNull();
      expect(reach(spot!.cell)).toBe(true);
      for (const c of staffStripCells(layout)) expect(reach(c)).toBe(true);
    });

    it('każdej kratki zaplecza i kratek drzwi na zaplecze', () => {
      const backroom = allCells(layout).filter((c) => typeAt(layout, c) === 'backroom');
      for (const c of backroom) expect(reach(c)).toBe(true);
      const door = layout.fixtures.find((f) => f.kind === 'backroomDoor')!;
      for (const c of fixtureCells(door)) expect(reach(c)).toBe(true);
    });

    it('kratki dostępu każdego mebla do wykładania', () => {
      const shelves = layout.fixtures.filter((f) => BROWSE.includes(f.kind));
      expect(shelves.length).toBeGreaterThan(0);
      for (const f of shelves) expect(accessCells(layout, f).some(reach)).toBe(true);
    });
  });

  it('paleta, która zamyka przejście, odcina zaplecze (przeszkody naprawdę blokują ruch)', () => {
    const layout = generateStore('alfa');
    const door = layout.fixtures.find((f) => f.kind === 'backroomDoor')!;
    const shut = [{ x: door.x, y: door.y }, { x: door.x + 1, y: door.y }];
    const nav = buildStaffNav(layout, shut);
    const behind = { x: door.x, y: door.y + 2 };
    expect(findPath(nav.width, nav.depth, nav.blocked, layout.spawnPoints[0]!, behind)).toBeNull();
  });
});
