import type { Cell } from '@/sim/grid';
import { FRONT_WALL_Y, SIDEWALK_ROWS, type CellType, type Fixture, type LotSpec } from './types';

// Składanie siatki z gotowych elementów (wymiary, typy kratek, strefa palet, punkty pojawiania się).
// Używa tego generator oraz testLayouts.ts, więc testy walidatora budują siatki produkcyjnym kodem.

export interface StoreDimensions {
  width: number;       // interiorWidth + 2
  depth: number;       // 4 + 1 + salesDepth + 1 + backroomDepth + 1
  midWallY: number;    // 5 + salesDepth (ściana między salą a zapleczem)
}

export function storeDimensions(lot: LotSpec): StoreDimensions {
  return {
    width: lot.interiorWidth + 2,
    depth: SIDEWALK_ROWS + 1 + lot.salesDepth + 1 + lot.backroomDepth + 1,
    midWallY: FRONT_WALL_Y + 1 + lot.salesDepth,
  };
}

/** Kolumna ściany bocznej bliższej wejściu (remis → zachodnia, x = 0). */
function nearerSideColumn(width: number, entrance: Cell[]): number {
  const west = Math.min(...entrance.map((e) => e.x));
  const east = width - 1 - Math.max(...entrance.map((e) => e.x));
  return east < west ? width - 1 : 0;
}

/**
 * Typy kratek całej siatki: chodnik, ściana frontowa z witryną i wejściem, ściany boczne, ściana środkowa,
 * podłoga sali, zaplecze, ściana tylna, na końcu kratki mebli jako 'fixture'.
 * W lokalu narożnym (`lot.corner`) boczna ściana bliższa wejściu jest drugą witryną: w wierszach sali
 * sprzedaży (FRONT_WALL_Y + 1 .. midWallY − 1) ma typ 'window', a nie 'wall'.
 */
export function typeCells(lot: LotSpec, entrance: Cell[], fixtures: Fixture[]): CellType[] {
  const { width, depth, midWallY } = storeDimensions(lot);
  const cornerColumn = lot.corner ? nearerSideColumn(width, entrance) : -1;

  const cells: CellType[] = [];
  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) {
      let t: CellType;
      if (y < SIDEWALK_ROWS) t = 'outside';
      else if (y === FRONT_WALL_Y) t = x === 0 || x === width - 1 ? 'wall' : 'window';
      else if (x === cornerColumn && y < midWallY) t = 'window';
      else if (x === 0 || x === width - 1 || y === midWallY || y === depth - 1) t = 'wall';
      else t = y < midWallY ? 'floor' : 'backroom';
      cells.push(t);
    }
  }
  for (const e of entrance) cells[e.y * width + e.x] = 'entrance';
  for (const f of fixtures) {
    for (let dy = 0; dy < f.d; dy++) {
      for (let dx = 0; dx < f.w; dx++) cells[(f.y + dy) * width + f.x + dx] = 'fixture';
    }
  }
  return cells;
}

/** Strefa palet: chodnik w wierszach 1–2, bez pasa przed wejściem (x wejścia ±1). */
export function palletZone(width: number, entrance: Cell[]): Cell[] {
  const out: Cell[] = [];
  for (let y = 1; y <= 2; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (entrance.every((e) => Math.abs(x - e.x) > 1)) out.push({ x, y });
    }
  }
  return out;
}

export function spawnPoints(width: number): Cell[] {
  return [{ x: 0, y: 1 }, { x: width - 1, y: 1 }];
}
