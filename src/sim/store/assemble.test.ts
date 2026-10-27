import { describe, it, expect } from 'vitest';
import { palletZone, spawnPoints, storeDimensions } from './assemble';
import { layoutFromParts, validParts } from './testLayouts';
import { FRONT_WALL_Y, type CellType, type StoreLayout } from './types';
import { validateLayout } from './validate';

describe('storeDimensions', () => {
  it('liczy wymiary siatki z lokalu', () => {
    const { lot } = validParts();   // 14 × 9 + zaplecze 3
    expect(storeDimensions(lot)).toEqual({ width: 16, depth: 19, midWallY: 14 });
  });
});

/** Lokal z hand-built układu testowego, z wejściem w x..x+1 i flagą corner. */
const corner = (entranceX: number): StoreLayout => {
  const p = validParts();
  p.lot.corner = true;
  p.entrance = [{ x: entranceX, y: FRONT_WALL_Y }, { x: entranceX + 1, y: FRONT_WALL_Y }];
  return layoutFromParts(p);
};
const side = (x: number, l: StoreLayout): CellType[] => Array.from({ length: l.depth }, (_, y) => l.cells[y * l.width + x]!);

describe('typeCells: lokal narożny', () => {
  it('witryna w bocznej ścianie bliższej wejścia (zachodniej)', () => {
    const l = corner(6);   // 6 kratek od lewej ściany, 8 od prawej
    expect(side(0, l).slice(FRONT_WALL_Y + 1, l.midWallY).every((t) => t === 'window')).toBe(true);
    expect(side(0, l).filter((_, y) => y < FRONT_WALL_Y + 1 || y >= l.midWallY).filter((t) => t === 'window')).toEqual([]);
    expect(side(l.width - 1, l).filter((_, y) => y >= FRONT_WALL_Y).every((t) => t === 'wall')).toBe(true);
  });

  it('witryna po wschodniej stronie, gdy wejście jest bliżej niej', () => {
    const l = corner(8);   // 8 kratek od lewej ściany, 6 od prawej
    expect(side(l.width - 1, l).slice(FRONT_WALL_Y + 1, l.midWallY).every((t) => t === 'window')).toBe(true);
    expect(side(0, l).filter((_, y) => y >= FRONT_WALL_Y).every((t) => t === 'wall')).toBe(true);
  });

  it('układ z boczną witryną nadal przechodzi walidację', () => {
    expect(validateLayout(corner(6))).toEqual({ ok: true, errors: [] });
  });

  it('lokal bez narożnika ma obie boczne ściany bez witryn', () => {
    const l = layoutFromParts(validParts());
    expect(side(0, l).filter((_, y) => y >= FRONT_WALL_Y).every((t) => t === 'wall')).toBe(true);
    expect(side(l.width - 1, l).filter((_, y) => y >= FRONT_WALL_Y).every((t) => t === 'wall')).toBe(true);
  });
});

describe('palletZone i spawnPoints', () => {
  it('strefa palet: wiersze 1–2 bez pasa przed wejściem (x ±1)', () => {
    const zone = palletZone(16, [{ x: 6, y: FRONT_WALL_Y }, { x: 7, y: FRONT_WALL_Y }]);
    expect(zone.every((c) => (c.y === 1 || c.y === 2) && c.x >= 1 && c.x <= 14)).toBe(true);
    expect(zone.some((c) => c.x >= 5 && c.x <= 8)).toBe(false);
    expect(zone).toHaveLength(2 * (14 - 4));
  });

  it('punkty pojawiania się: oba rogi chodnika', () => {
    expect(spawnPoints(16)).toEqual([{ x: 0, y: 1 }, { x: 15, y: 1 }]);
  });
});
