import { Vector3 } from 'three';
import { BLOCK_M } from '@/sim/city/districts';
import { CITY_SIZE } from '@/sim/city/types';

/**
 * Układ sceny miasta wspólny dla widoku (`buildCity.ts`) i brył makiety (`cityBuildings.ts`): jednostka sceny, przeliczenie metrów
 * miasta na scenę i skrót numeru lokalu, z którego render bierze warianty zamiast losowania. Osobny moduł, żeby `buildCity.ts`
 * mógł importować `cityBuildings.ts` bez cyklu importów.
 */

/** Jednostka sceny w metrach miasta: całe miasto (660 m) ma 22 jednostki, więc mieści się w `VIEW_SIZE_MAX` kamery na ekranie poziomym. */
export const CITY_UNIT_M = 30;
/** Bok miasta w metrach (bez ulic brzegowych). */
export const CITY_M = CITY_SIZE * BLOCK_M;

/** Punkt miasta (metry) we współrzędnych sceny (y = 0): środek miasta w (0, 0), x miasta to x sceny, a y miasta to z sceny. */
export function cityToWorld(mx: number, my: number): Vector3 {
  return new Vector3((mx - CITY_M / 2) / CITY_UNIT_M, 0, (my - CITY_M / 2) / CITY_UNIT_M);
}

/** Deterministyczna liczba z [0, 1) z numeru lokalu: wysokość, jasność i warianty budynku (render nie losuje). */
export const unit = (id: number): number => (Math.imul(id + 1, 2654435761) >>> 0) / 4294967296;
