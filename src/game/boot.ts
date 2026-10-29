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

/**
 * Otwiera pierwszy sklep przy wejściu na stronę: bieg rankingowy, gdy `shouldResumeRanked` i wznowienie się udało, w przeciwnym razie
 * zwykły sklep z tą samą prośbą (`GameShell.open`). Nigdy oba: po udanym wznowieniu świat nie jest budowany drugi raz. Zwraca, czy
 * jakiś sklep stanął. `seedInUrl`: adres ma niepusty `?seed=` (puste `?seed=` to brak seeda, jak w `entrySeed`).
 */
export function openAtBoot(
  shell: Pick<GameShell, 'open' | 'resumeRanked'>, request: OpenAtStart, seedInUrl: boolean, mode: 'casual' | 'ranked' = getPlayMode(),
): boolean {
  if (shouldResumeRanked(mode, seedInUrl, request) && shell.resumeRanked()) return true;
  return shell.open(request);
}
