import { MINUTES_PER_DAY, OPEN_TO } from './economy/catalog';
import type { EconomyState } from './economy/economy';

/**
 * Tryb rankingowy (spec §14.7): świeży sklep z seeda i sezon trzech miesięcy gry, wrzesień–listopad. Wynik to suma zysków
 * trzech raportów miesięcznych. Serwer odtwarza bieg (`replayRun`) do `RANKED_SEASON_END_MINUTE` i liczy wynik sam, tą funkcją.
 */

/** Ile raportów miesięcznych ma sezon. */
export const RANKED_SEASON_MONTHS = 3;

/** Ostatni dzień sezonu: 30 listopada, dzień 90 od 1 września (dzień 0). */
const LAST_DAY = 30 + 31 + 30 - 1;

/**
 * Pierwsza minuta po sezonie: minuta po zamknięciu 30 listopada (dzień i miesiąc zamykają się o 23:00, razem z raportem).
 * Odtworzenie do tej minuty ma trzy raporty, a polecenia z dziennika muszą mieć minutę mniejszą od niej.
 */
export const RANKED_SEASON_END_MINUTE = LAST_DAY * MINUTES_PER_DAY + OPEN_TO + 1;

/** Czy stan ma wszystkie raporty sezonu (bieg dograny do końca listopada). */
export const seasonComplete = (state: Pick<EconomyState, 'history'>): boolean => state.history.length >= RANKED_SEASON_MONTHS;

/**
 * Wynik sezonu: suma zysków trzech pierwszych raportów z `history`, zaokrąglona do pełnych złotych (wynik trafia do rankingu
 * jako liczba całkowita). Raporty po sezonie nic nie zmieniają; przy niepełnym sezonie suma tego, co jest (`seasonComplete` mówi,
 * czy to wynik do rankingu).
 */
export function seasonScore(state: Pick<EconomyState, 'history'>): number {
  const sum = state.history.slice(0, RANKED_SEASON_MONTHS).reduce((acc, h) => acc + h.profit, 0);
  return Math.round(sum) + 0;   // + 0 zamienia -0 na 0
}
