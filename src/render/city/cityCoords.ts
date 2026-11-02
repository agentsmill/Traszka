import { Vector3 } from 'three';
import { BLOCK_M } from '@/sim/city/districts';
import { STREET_HALF_M } from '@/sim/city/generateCity';
import { CITY_SIZE, type StreetSegment } from '@/sim/city/types';

/**
 * Układ sceny miasta wspólny dla widoku (`buildCity.ts`), brył makiety (`cityBuildings.ts`) i rekwizytów (`cityProps.ts`): jednostka
 * sceny, przeliczenie metrów miasta na scenę, prostokąt ulicy i skróty numerów, z których render bierze warianty zamiast losowania.
 * Osobny moduł, żeby `buildCity.ts` mógł importować `cityBuildings.ts` i `cityProps.ts` bez cyklu importów.
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

/** Skrót kilku liczb całkowitych do [0, 1): warianty brył, drzew i aut (render nie losuje; ten sam seed daje to samo co do bitu). */
export function hash01(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Prostokąt ulicy `[x0, y0, x1, y1]` w metrach miasta. Odcinki poziome biegną przez całe skrzyżowania (na brzegu miasta o pół ulicy dalej),
 * pionowe kończą się przy skrzyżowaniach, więc prostokąty niczego nie pokrywają dwa razy (bez migotania) i nie zostawiają dziur.
 * Z tego rysuje się ulice (`buildCity.ts`) i po tym jeżdżą auta (`cityProps.ts`).
 */
export function streetRect(s: StreetSegment): [number, number, number, number] {
  if (s.ay === s.by) return [s.ax === 0 ? -STREET_HALF_M : s.ax, s.ay - STREET_HALF_M, s.bx === CITY_M ? CITY_M + STREET_HALF_M : s.bx, s.ay + STREET_HALF_M];
  return [s.ax - STREET_HALF_M, s.ay + STREET_HALF_M, s.ax + STREET_HALF_M, s.by - STREET_HALF_M];
}
