import type { GameShell, OpenAtStart } from './actions';
import { getPlayMode } from './rankedRun';

/**
 * Rozruch: wznowić bieg rankingowy czy otworzyć zwykły sklep? Decyzja jest tutaj, a nie w main.ts, żeby miała testy bez przeglądarki.
 */

/**
 * Czy rozruch ma próbować wznowić bieg rankingowy: zapamiętany tryb to `ranked`, a gracz nie poprosił o nic innego. Adres z `?seed=`
 * (link do konkretnego sklepu), `?new=1` (nowa gra zamiast zapisu) i sklep wybrany na ekranie startowym otwierają zwykły sklep; bieg
 * czeka wtedy nietknięty w zapisie, a zwykłe wejście na stronę wznowi go dalej. Czy zapis nadaje się do wznowienia, rozstrzyga dopiero
 * `GameShell.resumeRanked` (brak biegu, uszkodzony zapis albo zapis z innej wersji gry to false i zwykły sklep).
 */
export function shouldResumeRanked(mode: 'casual' | 'ranked', seedInUrl: boolean, request: Pick<OpenAtStart, 'fresh' | 'choice'>): boolean {
  return mode === 'ranked' && !seedInUrl && !request.fresh && request.choice === null;
}

/** Dodatki rozruchu dla „Start rankingowy” wybranego na ekranie startowym przy wejściu na stronę. */
export interface RankedBoot {
  /** „Porzuć i zacznij” z pytania na ekranie startowym: nowy bieg zastępuje niewysłany bieg i aktywny zapis (`startRanked` z `replace`). */
  replace?: boolean;
  /** Bieg rankingowy z ekranu startowego stanął (main.ts otwiera wtedy „Jak grać”, jak `GameShell.open` przy zwykłym pierwszym wejściu). */
  onStarted?: () => void;
}

/**
 * Otwiera pierwszy sklep przy wejściu na stronę: bieg rankingowy wybrany na ekranie startowym (`choice.ranked`) rusza od razu, bez
 * zwykłego sklepu pod spodem (jedna budowa świata); gdy nie ruszył (pytanie o porzucenie biegu, które wyszło dopiero teraz, świat,
 * który się nie zbudował), strona nie zostaje pusta: otwiera się zwykły sklep z tego samego wyboru. Poza tym bieg rankingowy wznawia
 * się, gdy `shouldResumeRanked`, a w przeciwnym razie otwiera się zwykły sklep z tą samą prośbą (`GameShell.open`). Nigdy dwa światy
 * naraz. Zwraca, czy jakiś sklep stanął. `seedInUrl`: adres ma niepusty `?seed=` (puste `?seed=` to brak seeda, jak w `entrySeed`).
 */
export function openAtBoot(
  shell: Pick<GameShell, 'open' | 'resumeRanked' | 'startRanked'>, request: OpenAtStart, seedInUrl: boolean, mode: 'casual' | 'ranked' = getPlayMode(),
  ranked: RankedBoot = {},
): boolean {
  if (request.choice?.ranked) {
    if (shell.startRanked(request.choice.seed, { replace: ranked.replace === true })) {
      ranked.onStarted?.();
      return true;
    }
    return shell.open(request);
  }
  if (shouldResumeRanked(mode, seedInUrl, request) && shell.resumeRanked()) return true;
  return shell.open(request);
}
