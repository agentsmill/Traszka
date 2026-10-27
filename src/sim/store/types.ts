import type { Cell } from '@/sim/grid';

export type LotKind = 'blok' | 'kamienica' | 'pawilon';
export interface LotSpec { kind: LotKind; interiorWidth: number; salesDepth: number; backroomDepth: number; corner: boolean }

/** Kierunek frontu mebla (strona klienta): N = −y (do ulicy), S = +y (w głąb), W = −x, E = +x. */
export type Facing = 'N' | 'E' | 'S' | 'W';

export type FixtureKind = 'gondola' | 'wallShelf' | 'fridge' | 'checkout' | 'tobaccoShelf' | 'hotFood' | 'coffee'
  | 'selfCheckoutSlot' | 'equipmentSlot' | 'backroomDoor';

/** Prostokąt kratek [x, x + w) × [y, y + d). */
export interface Fixture { id: string; kind: FixtureKind; x: number; y: number; w: number; d: number; facing: Facing }

export type CellType = 'outside' | 'wall' | 'window' | 'entrance' | 'floor' | 'backroom' | 'fixture';

export const SIDEWALK_ROWS = 4;      // wiersze 0..3 to chodnik
export const FRONT_WALL_Y = 4;       // ściana frontowa z witryną i wejściem

/**
 * Siatka sklepu. y = 0 to brzeg od strony ulicy. Wiersze 0..3 chodnik, wiersz 4 ściana frontowa,
 * 5..midWallY−1 sala sprzedaży, midWallY ściana z drzwiami na zaplecze, potem zaplecze,
 * ostatni wiersz to ściana tylna. Kolumny 0 i width−1 są ścianami bocznymi (od wiersza 4 w dół).
 * Kratki zajęte przez meble mają w `cells` typ 'fixture'.
 */
export interface StoreLayout {
  generatorVersion: number; seed: string; lot: LotSpec;
  width: number;                     // interiorWidth + 2
  depth: number;                     // 4 + 1 + salesDepth + 1 + backroomDepth + 1
  midWallY: number;                  // 5 + salesDepth (ściana między salą a zapleczem)
  cells: CellType[];                 // cells[y * width + x]
  fixtures: Fixture[];
  entrance: Cell[];                  // 2 kratki w FRONT_WALL_Y
  checkoutQueue: Cell[];             // kolejka, [0] = miejsce przy kasie
  palletZoneOutside: Cell[];         // chodnik, gdzie kierowca zostawia palety
  spawnPoints: Cell[];               // (0,1) i (width-1,1)
}
