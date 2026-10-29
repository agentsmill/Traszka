import type { RunRecord } from './runs.js';

/**
 * Sędzia biegu: serwer zapisuje tylko wynik, który sam policzył (spec §14.7). `verifyRun` jest wstrzykiwany do API, więc testy
 * używają atrapy, a prawdziwe odtwarzanie (`replayRun` ze strumienia A) podpina się bez zmian w reszcie serwera:
 *
 *   makeReplayVerifier({ replay: replayRun, endMinute: RANKED_SEASON_END_MINUTE, score: seasonScore })
 *
 * Do tego czasu działa `replayNotAvailable`: każdy bieg dostaje „odtwarzanie jeszcze niedostępne”, a ranking nic nie zapisuje.
 */
export type VerifyFailure = 'replay-unavailable' | 'replay-failed';
export type VerifyResult = { ok: true; score: number } | { ok: false; reason: VerifyFailure };
export type VerifyRun = (run: RunRecord) => VerifyResult | Promise<VerifyResult>;

/** Domyślny sędzia, zanim strumień A dostarczy `replayRun`. */
export const replayNotAvailable: VerifyRun = () => ({ ok: false, reason: 'replay-unavailable' });

/** Tekst do logu: jedna linia i najwyżej 200 znaków (treść błędu bywa złożona z tekstu zgłoszonego biegu). */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Co sędzia musi wiedzieć o symulacji: odtworzenie biegu, koniec sezonu i wynik. */
export interface SeasonJudge<S> {
  replay: (run: RunRecord, untilMinute: number) => S;
  endMinute: number;
  score: (state: S) => number;
}

/**
 * Sędzia z odtwarzaniem: bieg odtworzony do końca sezonu; wyjątek przy odtwarzaniu (nieznane polecenie, zepsuty dziennik) albo
 * wynik, który nie jest liczbą, to `replay-failed`. Wyjątek idzie też do logu (`[ranking] replay`, nazwa i treść błędu), żeby
 * błąd sędziego przy uczciwym biegu nie znikał bez śladu. Bieg zakończony wypowiedzeniem umowy przed końcem listopada liczy się
 * z raportami, które zdążyły powstać (decyzja właściciela gry, 2026-10-28).
 */
export function makeReplayVerifier<S>(judge: SeasonJudge<S>): VerifyRun {
  return (run) => {
    let state: S;
    try {
      state = judge.replay(run, judge.endMinute);
    } catch (err) {
      // Ślad w logu Vercela, żeby uczciwy bieg z błędem sędziego (różnica silników, błąd w applyCommand) nie znikał bez wieści.
      // Tylko nazwa i treść błędu, w jednej linii i krótko: bez klucza gracza i bez dziennika poleceń.
      const [name, message] = err instanceof Error ? [err.name, err.message] : ['nieznany błąd', ''];
      console.error('[ranking] replay', oneLine(name), oneLine(message));
      return { ok: false, reason: 'replay-failed' };
    }
    const score = judge.score(state);
    return Number.isFinite(score) ? { ok: true, score } : { ok: false, reason: 'replay-failed' };
  };
}
