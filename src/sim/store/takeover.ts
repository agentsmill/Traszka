import { createRng, subSeed } from '@/sim/rng';
import { FRONT_WALL_Y, type StoreLayout } from './types';

/**
 * Lokal obok i przejęcie lokalu (remont „dokupienie lokalu obok”): która strona sklepu rośnie i gdzie jest narożnik. Mieszka w
 * symulacji, bo miasto (`src/sim/city`) musi wiedzieć, który sąsiad w rzędzie jest „lokalem obok”, a scena ulicy (`planRow`
 * w `src/render/street/buildings.ts`) rysuje tę samą stronę: jedno źródło prawdy, bez importu z renderu.
 */

/** Strona drugiej witryny w lokalu narożnym ('minX' = lewa, −x), inaczej null. Tam zamiast sąsiada jest przecznica. */
export function cornerSide(layout: StoreLayout): 'minX' | 'maxX' | null {
  if (!layout.lot.corner) return null;
  const row = (FRONT_WALL_Y + 1) * layout.width;
  if (layout.cells[row] === 'window') return 'minX';
  if (layout.cells[row + layout.width - 1] === 'window') return 'maxX';
  return null;
}

/**
 * Strona, po której sklep zajmuje lokal sąsiada, albo null. Kamienica nienarożna: przeciwna do bramy. Kamienica narożna:
 * brak, bo po jednej stronie jest brama, a po drugiej przecznica. Blok i pawilon: zawsze `maxX`, czyli dalszy sąsiad przy
 * domyślnej kamerze (`yawIndex` 0): bliższego przekrój ścina do 0,5 m, więc jego kartki „DO WYNAJĘCIA” nie byłoby widać.
 *
 * `seed` to seed sklepu przekazany do `planRow`. Strona bramy kamienicy nienarożnej wychodzi z jego strumienia
 * `street`/`budynki` i jest trzecim losowaniem po dwóch poprzednich (`planRow` losuje najpierw kolor ściany bryły nad sklepem,
 * `rng.pick`, potem liczbę kondygnacji, `rng.int`: po jednym `next()`), więc ta funkcja zużywa te dwa losowania i dopiero
 * wtedy pyta o bramę (`chance(0.5)`: true = brama po `minX`). Zmiana kolejności losowań w `planRow` musi zmienić ją tutaj;
 * `przejecie.test.ts` porównuje obie na 200 seedach.
 */
export function takeoverSide(layout: StoreLayout, seed: string): 'minX' | 'maxX' | null {
  if (cornerSide(layout) !== null) return null;
  if (layout.lot.kind !== 'kamienica') return 'maxX';
  const rng = createRng(subSeed(subSeed(seed, 'street'), 'budynki'));
  rng.next();
  rng.next();
  return rng.chance(0.5) ? 'maxX' : 'minX';
}
