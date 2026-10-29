import { STAFF_MAX } from '@/sim/economy/catalog';
import type { PalletLoc, PalletSpot } from '@/sim/economy/storeInfo';
import type { Cell } from '@/sim/grid';

// Typy wspólne warstwy „ludzie na ekranie”: nawigacja, cele, chodzenie, ekipa i widok three.js rozmawiają ze sobą tylko
// przez te kształty. Z wartości jest tu jedynie `STAFF_MAX`, więc plik wchodzi do testów w node bez three.js.

/** Lustro kontraktu etapu 2C2 (`StaffTask` z src/sim/economy/tycoon/staff.ts). Po scaleniu C2 zamień na `import type` stamtąd. */
export type StaffTask = 'kasa' | 'rozladunek' | 'wykladanie' | 'sprzatanie';
export type StaffDuty = StaffTask | 'wolny';
export interface StaffAssignment { id: number; task: StaffDuty }
export const STAFF_TASKS: readonly StaffTask[] = ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie'];
/** Najwięcej osób w widoku naraz: tyle, ile personelu w ogóle się mieści (STAFF_MAX). */
export const STAFF_VIEW_MAX: number = STAFF_MAX;
/** Miejsce postaci na planszy: kratka i kierunek patrzenia (rad, 0 = +x siatki). */
export interface StaffSpot { cell: Cell; heading: number }
/** Paleta tak, jak widzi ją warstwa ludzi: gdzie stoi (kwadrat 2×2) i od kiedy. */
export interface PalletRef { loc: PalletLoc; spot: PalletSpot; since: number }
