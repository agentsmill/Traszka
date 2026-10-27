import { CELL_SIZE_M } from '@/sim/grid';
import type { StoreLayout } from '@/sim/store/types';

/**
 * Środek kratki (x, y) siatki sklepu we współrzędnych świata, w metrach. Środek sklepu leży w (0, 0).
 * +x siatki to +x świata, +y siatki to +z świata, więc wiersz 0 (ulica) leży po stronie ujemnego z.
 */
export function cellToWorld(layout: Pick<StoreLayout, 'width' | 'depth'>, x: number, y: number): { x: number; z: number } {
  return {
    x: (x + 0.5 - layout.width / 2) * CELL_SIZE_M,
    z: (y + 0.5 - layout.depth / 2) * CELL_SIZE_M,
  };
}
