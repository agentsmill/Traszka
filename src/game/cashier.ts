import type { OutfitFile } from '@/render/characters/modularPack';
import type { Agent } from '@/sim/crowd/crowd';
import type { Cell } from '@/sim/grid';
import type { Rng } from '@/sim/rng';
import { accessCells } from '@/sim/store/validate';
import type { Facing, StoreLayout } from '@/sim/store/types';

/**
 * Kasjer gracza: wygląd, miejsce za ladą i reakcje na klientów przy kasie. Czysta logika bez three (widok: render/cashierView.ts);
 * z modułów renderu bierze tylko typ `OutfitFile`.
 */

/** Wygląd kasjera: strój (zwykły albo specjalny) i seed, z którego pochodzi reszta (skóra, włosy, wzrost, tusza). */
export interface CashierLook { outfit: OutfitFile; appearanceSeed: string }

/**
 * Stroje zwykłe (`ASSETS.characters.modular`; nosą je też klienci) i specjalne (`ASSETS.characters.special`; tylko kasjer gracza).
 * Listy trzymają się razem z `ASSETS` i `OUTFIT_PAINT` testem (cashier.test.ts), więc nowy strój bez wpisu tutaj go nie przejdzie.
 */
export const REGULAR_OUTFITS: readonly OutfitFile[] = [
  'men-casual-hoodie', 'men-casual-2', 'men-suit', 'men-worker', 'men-farmer', 'men-beach', 'men-punk',
  'women-casual', 'women-suit', 'women-formal', 'women-worker', 'women-punk',
];
export const SPECIAL_OUTFITS: readonly OutfitFile[] = [
  'special-men-spacesuit', 'special-men-king', 'special-men-swat', 'special-men-adventurer',
  'special-women-scifi', 'special-women-adventurer', 'special-women-witch', 'special-women-medieval', 'special-women-soldier',
];

export const isSpecialOutfit = (outfit: OutfitFile): boolean => SPECIAL_OUTFITS.includes(outfit);

/** Szansa, że losowanie trafi w strój specjalny (okazja, nie reguła). */
export const SPECIAL_LOOK_CHANCE = 0.2;
/** Najdłuższy zapisany seed wyglądu: dłuższy znaczy uszkodzony zapis, nie wygląd. */
export const APPEARANCE_SEED_MAX = 64;

/** Wygląd kasjera na start, gdy gracz jeszcze żadnego nie wybrał (i gdy zapisany jest uszkodzony). Strój zwykły. */
export const DEFAULT_CASHIER_LOOK: CashierLook = Object.freeze({ outfit: 'men-casual-2', appearanceSeed: 'kasjer-traszki' });

/**
 * Losowy wygląd. Ok. co piąte losowanie (`SPECIAL_LOOK_CHANCE`) trafia w strój specjalny, o ile `includeSpecial`; bez niego
 * wypadają tylko stroje zwykłe. Rzut na strój specjalny zużywa losowość także wtedy, więc ten sam `rng` daje ten sam seed wyglądu
 * bez względu na przełącznik.
 */
export function randomCashierLook(rng: Rng, includeSpecial = true): CashierLook {
  const lucky = rng.chance(SPECIAL_LOOK_CHANCE);
  const outfit = rng.pick(includeSpecial && lucky ? SPECIAL_OUTFITS : REGULAR_OUTFITS);
  return { outfit, appearanceSeed: `kasjer-${rng.int(0, 2 ** 31).toString(36)}` };
}

/** Czy `x` jest poprawnym wyglądem (np. wczytanym z zapisu): znany strój i niepusty seed o rozsądnej długości. */
export function isCashierLook(x: unknown): x is CashierLook {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const { outfit, appearanceSeed } = x as Record<string, unknown>;
  return typeof outfit === 'string'
    && (REGULAR_OUTFITS.includes(outfit as OutfitFile) || SPECIAL_OUTFITS.includes(outfit as OutfitFile))
    && typeof appearanceSeed === 'string' && appearanceSeed.length >= 1 && appearanceSeed.length <= APPEARANCE_SEED_MAX;
}

// --- Miejsce ---------------------------------------------------------------------------------------------------------

const OPPOSITE: Record<Facing, Facing> = { N: 'S', E: 'W', S: 'N', W: 'E' };
/** Kierunek (rad, 0 = +x siatki, jak `Agent.heading`), w którym patrzy front mebla o danym `facing`. */
const FACING_HEADING: Record<Facing, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

export interface CashierSpot {
  cell: Cell;
  /** Kierunek patrzenia (rad, 0 = +x siatki): w stronę kasy i klienta przy niej. */
  heading: number;
}

/**
 * Gdzie stoi kasjer: na kratce pasa personelu tuż za kasą (po stronie przeciwnej do jej frontu), w tym samym wierszu (kolumnie
 * dla frontu N/S) co miejsce klienta przy kasie, `checkoutQueue[0]`, i patrzy w stronę klienta. Pas personelu jest zamknięty
 * dla klientów (`staffStripCells` w sim/crowd), więc nikt tam nie wejdzie. `null`, gdy nie ma kasy, kolejki albo wolnej podłogi za kasą.
 */
export function cashierSpot(layout: StoreLayout): CashierSpot | null {
  const till = layout.fixtures.find((f) => f.kind === 'checkout');
  const head = layout.checkoutQueue[0];
  if (!till || !head) return null;
  const across = till.facing === 'N' || till.facing === 'S';
  const cell = accessCells(layout, { ...till, facing: OPPOSITE[till.facing] }).find((c) => (across ? c.x === head.x : c.y === head.y));
  if (!cell || layout.cells[cell.y * layout.width + cell.x] !== 'floor') return null;
  return { cell, heading: FACING_HEADING[till.facing] };
}

// --- Klient przy kasie -------------------------------------------------------------------------------------------------

export interface CashierCues {
  /** Klient płacący przy kasie (stoi na `checkoutQueue[0]`) albo null. */
  serving: Agent | null;
  /** Sprzedaż w tej klatce: klient, który płacił w poprzedniej, już nie płaci (wychodzi albo zniknął). */
  sale: boolean;
  /** Id obsługiwanego klienta do podania w następnym wywołaniu jako `prevPayingId`. */
  payingId: number | null;
}

/**
 * Co kasjer ma zrobić w tej klatce. Obsługiwany klient to agent w stanie 'paying', który stoi na `checkoutQueue[0]` (płacący przy
 * kasie samoobsługowej też ma stan 'paying', ale stoi gdzie indziej i nie jest obsługiwany przez kasjera). Sprzedaż to klient
 * obsługiwany w poprzedniej klatce (`prevPayingId`), który teraz nie płaci już przy kasie: jest 'leaving' albo 'gone' albo znikł z
 * listy. Wołający trzyma `payingId` między klatkami i zeruje go, gdy zmienia się świat (id agentów zaczynają się wtedy od nowa).
 */
export function cashierCues(prevPayingId: number | null, agents: readonly Agent[], layout: Pick<StoreLayout, 'checkoutQueue'>): CashierCues {
  const till = layout.checkoutQueue[0];
  const serving = till
    ? agents.find((a) => a.state === 'paying' && Math.floor(a.x) === till.x && Math.floor(a.y) === till.y) ?? null
    : null;
  const payingId = serving ? serving.id : null;
  return { serving, sale: prevPayingId !== null && prevPayingId !== payingId, payingId };
}
