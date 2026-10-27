export interface Cell { x: number; y: number }

/** 1 kratka siatki = 0,5 m. */
export const CELL_SIZE_M = 0.5;

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Unikalny klucz kratki (siatki są węższe niż 4096). */
export function cellKey(c: Cell): number {
  return c.x + c.y * 4096;
}
