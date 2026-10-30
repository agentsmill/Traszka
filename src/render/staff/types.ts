import { STAFF_MAX } from '@/sim/economy/catalog';
import type { StaffTask } from '@/sim/economy/tycoon/staff';
import type { PalletLoc, PalletSpot } from '@/sim/economy/storeInfo';
import type { Cell } from '@/sim/grid';

// Typy wspólne warstwy „ludzie na ekranie”: nawigacja, cele, chodzenie, ekipa i widok three.js rozmawiają ze sobą tylko
// przez te kształty. Z wartości są tu jedynie numery robotów i `STAFF_VIEW_MAX` (z `STAFF_MAX`), więc plik wchodzi do testów w node
// bez three.js.

/** Zadanie z puli ludzi (src/sim/economy/tycoon/staff.ts): jedno źródło prawdy, widok go tylko odgrywa. */
export type { StaffTask };
export type StaffDuty = StaffTask | 'wolny';
export interface StaffAssignment { id: number; task: StaffDuty }
/**
 * Numery osób od tego w górę to roboty, nie ludzie: ekonomia numeruje ludzi od 0 w górę do `STAFF_MAX`, więc roboty mają własny
 * zakres i nigdy nie zajmą miejsca człowieka. Robot jest w załodze osobą jak inne (chodzi tą samą siatką, ma zadanie, otwiera drzwi
 * na zaplecze), ale nie dostaje ciała kasjera ani postaci z fabryki.
 */
export const ROBOT_ID_BASE = 1000;
/** Humanoid eDward (ulepszenie `humanoid`): jedyny robot, który chodzi po sklepie. */
export const EDWARD_ID = ROBOT_ID_BASE;
export const isRobotId = (id: number): boolean => id >= ROBOT_ID_BASE;
/** Ile robotów chodzących po sklepie naraz (dziś tylko eDward); mają własny limit, więc nie odbierają miejsc ludziom. */
export const ROBOT_VIEW_MAX = 1;
/** Najwięcej ludzi w widoku naraz: tyle, ile personelu w ogóle się mieści (STAFF_MAX). */
export const STAFF_VIEW_MAX: number = STAFF_MAX;
/** Miejsce postaci na planszy: kratka i kierunek patrzenia (rad, 0 = +x siatki). */
export interface StaffSpot { cell: Cell; heading: number }
/** Paleta tak, jak widzi ją warstwa ludzi: gdzie stoi (kwadrat 2×2) i od kiedy. */
export interface PalletRef { loc: PalletLoc; spot: PalletSpot; since: number }
