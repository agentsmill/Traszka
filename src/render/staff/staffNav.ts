import type { Cell } from '@/sim/grid';
import type { StoreLayout } from '@/sim/store/types';
import { isWalkable } from '@/sim/store/validate';

// Siatka chodzenia personelu. Klienci chodzą po chodniku, wejściu i podłodze sali (`isWalkable`), a ich pas za kasą zamyka
// crowd. Personel ma te same drogi, ale pas za kasą jest dla niego otwarty (tam stoi kasjer), a do tego wchodzi na zaplecze
// przez drzwi: kratki drzwi mają w `cells` typ 'fixture' (jak każdy mebel), więc `isWalkable` ich nie widzi.

/** Siatka do `findPath`: `blocked(x, y)` mówi, czy kratki nie da się przejść (poza siatką: tak). */
export interface StaffNav { readonly width: number; readonly depth: number; blocked(x: number, y: number): boolean }

/**
 * Kratki, po których chodzi personel: jak klienci (chodnik od wiersza 1, wejście, podłoga sali) plus zaplecze i kratki drzwi na
 * zaplecze (fixture `backroomDoor`). Wiersz 0 chodnika to meble uliczne: tam nikt nie wchodzi. Pas personelu za kasą jest dla
 * personelu otwarty. Poza siatką → false.
 */
export function staffWalkable(layout: StoreLayout, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.depth) return false;
  if (y === 0) return false;
  if (isWalkable(layout, x, y)) return true;
  const t = layout.cells[y * layout.width + x];
  if (t === 'backroom') return true;
  // Tylko kratki typu 'fixture' mogą być drzwiami; reszta nie wymaga przeglądania listy mebli.
  return t === 'fixture' && layout.fixtures.some(
    (f) => f.kind === 'backroomDoor' && x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.d,
  );
}

/**
 * Siatka do `findPath`: blokuje to, co niechodliwe, i kratki `obstacles` (palety). Poza siatką → zablokowane.
 * Siatka jest policzona w chwili budowy i nie trzyma ani `layout`, ani `obstacles`, więc późniejsze zmiany tych argumentów jej
 * nie ruszają; po przesunięciu palet trzeba zbudować ją od nowa.
 */
export function buildStaffNav(layout: StoreLayout, obstacles: readonly Cell[]): StaffNav {
  const { width, depth } = layout;
  const blocked = new Uint8Array(width * depth);
  for (let y = 0; y < depth; y++) {
    for (let x = 0; x < width; x++) blocked[y * width + x] = staffWalkable(layout, x, y) ? 0 : 1;
  }
  for (const c of obstacles) {
    if (c.x >= 0 && c.y >= 0 && c.x < width && c.y < depth) blocked[c.y * width + c.x] = 1;
  }
  // `blocked` nie sięga po `this`: wolno je podać do `findPath` wprost, bez wiązania z obiektem.
  return {
    width,
    depth,
    blocked: (x, y) => x < 0 || y < 0 || x >= width || y >= depth || blocked[y * width + x] === 1,
  };
}
