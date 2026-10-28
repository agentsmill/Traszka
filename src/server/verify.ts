import type { RunRecord } from './runs.js';

/**
 * Sędzia biegu: serwer zapisuje tylko wynik, który sam policzył (spec §14.7). `verifyRun` jest wstrzykiwany do API, więc testy
 * używają atrapy, a prawdziwe odtwarzanie (`replayRun` ze strumienia A) podpina się bez zmian w reszcie serwera:
 *
 *   makeReplayVerifier({ replay: replayRun, endMinute: RANKED_SEASON_END_MINUTE, complete: seasonComplete, score: seasonScore })
 *
 * Do tego czasu działa `replayNotAvailable`: każdy bieg dostaje „odtwarzanie jeszcze niedostępne”, a ranking nic nie zapisuje.
 */
export type VerifyFailure = 'replay-unavailable' | 'season-incomplete' | 'replay-failed';
export type VerifyResult = { ok: true; score: number } | { ok: false; reason: VerifyFailure };
export type VerifyRun = (run: RunRecord) => VerifyResult | Promise<VerifyResult>;

/** Domyślny sędzia, zanim strumień A dostarczy `replayRun`. */
export const replayNotAvailable: VerifyRun = () => ({ ok: false, reason: 'replay-unavailable' });

/** Co sędzia musi wiedzieć o symulacji: odtworzenie biegu, koniec sezonu, czy sezon jest pełny, i wynik. */
export interface SeasonJudge<S> {
  replay: (run: RunRecord, untilMinute: number) => S;
  endMinute: number;
  complete: (state: S) => boolean;
  score: (state: S) => number;
}

/**
 * Sędzia z odtwarzaniem: bieg odtworzony do końca sezonu; wyjątek przy odtwarzaniu (nieznane polecenie, zepsuty dziennik) albo
 * wynik, który nie jest liczbą, to `replay-failed`, a sezon bez wszystkich raportów (wypowiedzenie umowy przed końcem listopada)
 * to `season-incomplete`.
 */
export function makeReplayVerifier<S>(judge: SeasonJudge<S>): VerifyRun {
  return (run) => {
    let state: S;
    try {
      state = judge.replay(run, judge.endMinute);
    } catch {
      return { ok: false, reason: 'replay-failed' };
    }
    if (!judge.complete(state)) return { ok: false, reason: 'season-incomplete' };
    const score = judge.score(state);
    return Number.isFinite(score) ? { ok: true, score } : { ok: false, reason: 'replay-failed' };
  };
}
