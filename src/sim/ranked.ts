import { MINUTES_PER_DAY, OPEN_TO } from './economy/catalog';
import type { EconomyState } from './economy/economy';

/**
 * Tryb rankingowy (spec §14.7): świeży sklep z seeda i sezon trzech miesięcy gry, wrzesień–listopad. Wynik to suma zysków
 * trzech raportów miesięcznych. Serwer odtwarza bieg (`replayRun`) do `RANKED_SEASON_END_MINUTE` i liczy wynik sam, tą funkcją.
 * Bieg, który kończy się grą (`gameOver`: granica debetu albo wypowiedzenie umowy) przed ostatnim raportem miesięcznym, do rankingu
 * nie wchodzi (`seasonBankrupt`; sędzia odrzuca go jako `season-bankrupt`, `src/server/verify.ts`). Bieg, który ma wszystkie trzy raporty,
 * liczy się także wtedy, gdy dopiero zamknięcie 30 listopada wpędziło go w debet: ta strata jest już w listopadowym raporcie, więc w wyniku.
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

/**
 * Wynik sezonu: suma zysków trzech pierwszych raportów z `history`, zaokrąglona do pełnych złotych (wynik trafia do rankingu
 * jako liczba całkowita). Raporty po sezonie nic nie zmieniają. Funkcja liczy tylko zamknięte raporty i nie wie o bankructwie:
 * bieg zakończony grą przed ostatnim raportem (`seasonBankrupt`) nie jest liczony wcale (sędzia odrzuca go jako `season-bankrupt`,
 * zanim zawoła tę funkcję), więc w rankingu trafia tu bieg, który ma wszystkie trzy raporty.
 */
export function seasonScore(state: Pick<EconomyState, 'history'>): number {
  const sum = state.history.slice(0, RANKED_SEASON_MONTHS).reduce((acc, h) => acc + h.profit, 0);
  return Math.round(sum) + 0;   // + 0 zamienia -0 na 0
}

/**
 * Czy bieg odtworzony do końca sezonu jest bankrutem, który nie wchodzi do rankingu: gra się skończyła (`gameOver`), zanim powstał ostatni,
 * trzeci raport miesięczny. Furtka, którą to zamyka: gracz, któremu idzie źle, schodzi celowo pod granicę debetu w środku sezonu i zamraża
 * wynik z wcześniejszych miesięcy. Kryterium to liczba raportów, nie minuta, więc nie zależy od tego, czy koniec gry zapisuje się w tej samej
 * minucie przed raportem, czy po nim: bieg z trzema raportami dotrwał do końca i ma wpis w rankingu, także gdy listopadowy debet skończył grę.
 * Jedna reguła dla sędziego (eksport bundla) i dla gry (lokalne zamknięcie biegu).
 */
export function seasonBankrupt(state: Pick<EconomyState, 'gameOver' | 'history'>): boolean {
  return state.gameOver && state.history.length < RANKED_SEASON_MONTHS;
}
