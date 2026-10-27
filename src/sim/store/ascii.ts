import { isWalkable } from './validate';
import type { CellType, FixtureKind, StoreLayout } from './types';

const CELL_CHAR: Record<Exclude<CellType, 'fixture'>, string> = {
  outside: ',',
  wall: '#',
  window: 'W',
  entrance: 'D',
  floor: '.',
  backroom: 'b',
};

const FIXTURE_CHAR: Record<FixtureKind, string> = {
  gondola: 'G',
  wallShelf: 'S',
  fridge: 'F',
  checkout: 'C',
  tobaccoShelf: 'T',
  hotFood: 'H',
  coffee: 'K',
  selfCheckoutSlot: 'X',
  equipmentSlot: 'E',
  backroomDoor: 'B',
};

/**
 * Rysunek układu do snapshotów i debugowania, wiersze od y=0 (ulica) w dół, rozdzielone '\n'.
 * Legenda: ',' chodnik, '#' ściana, 'W' witryna, 'D' wejście, '.' podłoga, 'b' zaplecze, 'q' kolejka,
 * meble: G gondola, S wallShelf, F fridge, C checkout, T tobaccoShelf, H hotFood, K coffee,
 * X selfCheckoutSlot, E equipmentSlot, B backroomDoor. '?' to kratka 'fixture' bez mebla (błąd danych).
 */
export function layoutToAscii(layout: StoreLayout): string {
  const { width, depth } = layout;
  const chars = layout.cells.map((t) => (t === 'fixture' ? '?' : CELL_CHAR[t]));

  // 'q' tylko na kratkach chodliwych, żeby nie zasłaniać mebli ani ścian.
  for (const c of layout.checkoutQueue) {
    if (isWalkable(layout, c.x, c.y)) chars[c.y * width + c.x] = 'q';
  }
  for (const f of layout.fixtures) {
    for (let dy = 0; dy < f.d; dy++) {
      for (let dx = 0; dx < f.w; dx++) {
        const x = f.x + dx;
        const y = f.y + dy;
        if (x >= 0 && y >= 0 && x < width && y < depth) chars[y * width + x] = FIXTURE_CHAR[f.kind];
      }
    }
  }

  const rows: string[] = [];
  for (let y = 0; y < depth; y++) rows.push(chars.slice(y * width, (y + 1) * width).join(''));
  return rows.join('\n');
}
