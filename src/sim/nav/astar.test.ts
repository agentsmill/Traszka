import { describe, it, expect } from 'vitest';
import type { Cell } from '@/sim/grid';
import { manhattan } from '@/sim/grid';
import { findPath, type BlockedFn } from './astar';

/** '#' = zablokowane. Wiersz 0 na górze. */
function fromRows(rows: string[]): { width: number; height: number; blocked: BlockedFn } {
  return {
    width: rows[0]!.length,
    height: rows.length,
    blocked: (x, y) => rows[y]?.[x] === '#',
  };
}

function expectValidPath(path: Cell[], start: Cell, goal: Cell, blocked: BlockedFn): void {
  expect(path[0]).toEqual(start);
  expect(path[path.length - 1]).toEqual(goal);
  for (let i = 0; i < path.length; i++) {
    expect(blocked(path[i]!.x, path[i]!.y), `kratka ${i} zablokowana`).toBe(false);
    if (i > 0) expect(manhattan(path[i - 1]!, path[i]!), `krok ${i} nie jest sąsiedni`).toBe(1);
  }
}

describe('findPath', () => {
  it('prosta linia 5×1 daje 5 kratek ze startem i celem', () => {
    const path = findPath(5, 1, () => false, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }]);
  });

  it('obchodzi przeszkodę: ściana w x=2 od y=0 do y=3 → 13 kratek (12 ruchów)', () => {
    const { width, height, blocked } = fromRows([
      '..#..',
      '..#..',
      '..#..',
      '..#..',
      '.....',
    ]);
    const start = { x: 0, y: 0 };
    const goal = { x: 4, y: 0 };
    const path = findPath(width, height, blocked, start, goal);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(13);
    expectValidPath(path!, start, goal, blocked);
  });

  it('na pustej siatce długość = manhattan + 1 (tylko 4-sąsiedztwo)', () => {
    const start = { x: 0, y: 0 };
    const goal = { x: 5, y: 3 };
    const path = findPath(6, 4, () => false, start, goal);
    expect(path!.length).toBe(manhattan(start, goal) + 1);
    expectValidPath(path!, start, goal, () => false);
  });

  it('całkowicie zamknięty cel daje null', () => {
    const { width, height, blocked } = fromRows([
      '.....',
      '.....',
      '.....',
      '....#',
      '...#.',
    ]);
    // cel (4,4) jest wolny, ale oba jego sąsiedzi, (3,4) i (4,3), są zablokowani
    expect(blocked(4, 4)).toBe(false);
    expect(findPath(width, height, blocked, { x: 0, y: 0 }, { x: 4, y: 4 })).toBeNull();
  });

  it('pełna ściana dzieli siatkę → null', () => {
    const { width, height, blocked } = fromRows([
      '..#..',
      '..#..',
      '..#..',
      '..#..',
      '..#..',
    ]);
    expect(findPath(width, height, blocked, { x: 0, y: 0 }, { x: 4, y: 4 })).toBeNull();
  });

  it('zablokowany cel daje null', () => {
    const { width, height, blocked } = fromRows([
      '...',
      '.#.',
      '...',
    ]);
    expect(findPath(width, height, blocked, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it('start == cel daje [start]', () => {
    const start = { x: 2, y: 2 };
    expect(findPath(5, 5, () => false, start, { x: 2, y: 2 })).toEqual([start]);
  });

  it('start na zablokowanej kratce może ją opuścić', () => {
    const blocked: BlockedFn = (x, y) => x === 0 && y === 0;
    const path = findPath(3, 1, blocked, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  });

  it('start lub cel poza siatką → null', () => {
    expect(findPath(3, 3, () => false, { x: -1, y: 0 }, { x: 2, y: 2 })).toBeNull();
    expect(findPath(3, 3, () => false, { x: 0, y: 0 }, { x: 3, y: 0 })).toBeNull();
    expect(findPath(3, 3, () => false, { x: 0, y: 0 }, { x: 0, y: 3 })).toBeNull();
  });

  it('jest deterministyczny i nie modyfikuje wejścia', () => {
    const { width, height, blocked } = fromRows([
      '.....',
      '.###.',
      '.....',
      '.#.#.',
      '.....',
    ]);
    const start = { x: 0, y: 0 };
    const goal = { x: 4, y: 4 };
    const a = findPath(width, height, blocked, start, goal);
    const b = findPath(width, height, blocked, start, goal);
    expect(a).toEqual(b);
    expect(start).toEqual({ x: 0, y: 0 });
    expect(goal).toEqual({ x: 4, y: 4 });
    expectValidPath(a!, start, goal, blocked);
  });

  it('znajduje najkrótszą drogę w labiryncie z zakrętami', () => {
    const { width, height, blocked } = fromRows([
      '.#...',
      '.#.#.',
      '.#.#.',
      '.#.#.',
      '...#.',
    ]);
    const start = { x: 0, y: 0 };
    const goal = { x: 4, y: 0 };
    const path = findPath(width, height, blocked, start, goal);
    // w dół (0,0)→(0,4), w prawo →(2,4), w górę →(2,0), w prawo →(4,0) = 4 + 2 + 4 + 2 = 12 ruchów
    expect(path!.length).toBe(13);
    expectValidPath(path!, start, goal, blocked);
  });
});
