import { describe, it, expect } from 'vitest';
import { CELL_SIZE_M, cellKey, manhattan } from './grid';

describe('grid', () => {
  it('1 kratka = 0,5 m', () => {
    expect(CELL_SIZE_M).toBe(0.5);
  });
  it('manhattan jest symetryczny i liczy kroki po osiach', () => {
    expect(manhattan({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
    expect(manhattan({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(7);
    expect(manhattan({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
    expect(manhattan({ x: -1, y: 5 }, { x: 2, y: 1 })).toBe(7);
  });
  it('cellKey = x + y * 4096 i jest unikalny', () => {
    expect(cellKey({ x: 3, y: 2 })).toBe(3 + 2 * 4096);
    const keys = new Set<number>();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) keys.add(cellKey({ x, y }));
    expect(keys.size).toBe(1600);
  });
});
