import { awaitingDecision, tillTapBlock, type EconomyState } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import { tapCost, type TapKind } from '@/sim/economy/tycoon/fatigue';
import { speed } from '../state';

export const NO_ENERGY_TITLE = 'Ręce odmawiają, odpocznij do jutra';

/**
 * Powód, dla którego stuknięcie danego rodzaju jest teraz zablokowane (jako `title` przycisku), albo undefined, gdy wolno:
 * ręce nie mają sił na jego koszt, gra stoi (pauza) albo czeka karta decyzji. Brak sił zasłania resztę, bo to on trwa do jutra.
 * Blokady są też w symulacji (odmowa bez zużycia sił), tu tylko oszczędzają graczowi bezskuteczne stuknięcia. Wspólne dla
 * przycisków klikera (`overlays.tsx`) i przycisku „Rozładuj” przy palecie (`panels.tsx`); osobny plik, bo oba pliki importują
 * się nawzajem.
 */
export function tapBlock(s: EconomyState, kind: TapKind): string | undefined {
  if (s.tycoon.fatigue.energy < tapCost(kind)) return NO_ENERGY_TITLE;
  if (speed.value === 0) return 'Gra wstrzymana: wznów czas';
  if (awaitingDecision(s)) return 'Najpierw odpowiedz na kartę decyzji';
  return undefined;
}

/**
 * Powód, dla którego stuknięcie w kasę jest teraz nieaktywne (albo undefined): najpierw blokady wspólne (`tapBlock`), potem te z
 * symulacji (`tillTapBlock`: sklep zamknięty, nikt nie czeka, kasjer nadąża z kolejką).
 */
export function tillReason(s: EconomyState, info: StoreInfo): string | undefined {
  return tapBlock(s, 'kasa') ?? tillTapBlock(s, info) ?? undefined;
}
