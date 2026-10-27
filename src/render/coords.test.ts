import { describe, expect, it } from 'vitest';
import { CELL_SIZE_M } from '@/sim/grid';
import { cellToWorld } from './coords';

const layout = { width: 18, depth: 28 };

describe('cellToWorld', () => {
  it('środkowa kratka sklepu 18×28 leży blisko (0, 0), w obrębie pół kratki', () => {
    const p = cellToWorld(layout, 9, 14);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(CELL_SIZE_M / 2);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(CELL_SIZE_M / 2);
  });

  it('środek sklepu wypada dokładnie w (0, 0): kratki symetryczne względem środka się znoszą', () => {
    const a = cellToWorld(layout, 8, 13);
    const b = cellToWorld(layout, 9, 14);
    expect((a.x + b.x) / 2).toBeCloseTo(0, 9);
    expect((a.z + b.z) / 2).toBeCloseTo(0, 9);
  });

  it('sąsiednie kratki są oddalone o CELL_SIZE_M, a +x siatki to +x świata, +y siatki to +z świata', () => {
    const c = cellToWorld(layout, 5, 7);
    const right = cellToWorld(layout, 6, 7);
    const down = cellToWorld(layout, 5, 8);
    expect(right.x - c.x).toBeCloseTo(CELL_SIZE_M, 9);
    expect(right.z - c.z).toBeCloseTo(0, 9);
    expect(down.z - c.z).toBeCloseTo(CELL_SIZE_M, 9);
    expect(down.x - c.x).toBeCloseTo(0, 9);
  });

  it('ulica (wiersz 0) leży po ujemnej stronie z, tył sklepu po dodatniej', () => {
    expect(cellToWorld(layout, 9, 0).z).toBeLessThan(0);
    expect(cellToWorld(layout, 9, 27).z).toBeGreaterThan(0);
  });
});
