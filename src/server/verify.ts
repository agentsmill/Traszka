import type { SubmittedRun } from './runs.js';

/**
 * Sędzia biegu: serwer zapisuje tylko wynik, który sam policzył (spec §14.7). `verifyRun` jest wstrzykiwany do API, więc testy
 * używają atrapy, a prawdziwy sędzia (`judge.ts`: bundle z `replayRun`, `seasonScore` i `SIM_VERSION` z aktualnej symulacji) wpina
 * się w `api/runs.ts` bez zmian w reszcie serwera. Odtwarzanie i wynik składa tu `makeReplayVerifier`; `judge.ts` dokłada ładowanie
 * bundla i porównanie wersji symulacji.
 *
 * `replayNotAvailable` zostaje jako domyślny sędzia `route` (`env.ts`) dla wszystkich, którzy nie wstrzyknęli własnego: każdy bieg
 * dostaje „odtwarzanie jeszcze niedostępne”, a ranking nic nie zapisuje.
 *
 * Powody odmowy (`http.ts` oddaje je graczowi pod tym samym kodem, `errors.ts`):
 * - `old-version`: bieg rozegrany w innej wersji symulacji niż ta, którą ma sędzia (`run.simVersion !== SIM_VERSION` z bundla sędziego),
 *   więc odtworzenie mogłoby dać inny stan niż w grze. To sędzia porównuje wersje, bo tylko on zna `SIM_VERSION` (parser go nie ma);
 * - `replay-failed`: odtwarzanie rzuciło albo wynik nie jest liczbą;
 * - `replay-unavailable`: sędziego nie ma (bundle niezbudowany albo zepsuty).
 */
export type VerifyFailure = 'replay-unavailable' | 'replay-failed' | 'old-version';
export type VerifyResult = { ok: true; score: number } | { ok: false; reason: VerifyFailure };
export type VerifyRun = (run: SubmittedRun) => VerifyResult | Promise<VerifyResult>;

/** Domyślny sędzia, gdy nie podano innego: żaden bieg nie jest odtwarzany (`api/runs.ts` podaje sędziego z bundla, `judge.ts`). */
export const replayNotAvailable: VerifyRun = () => ({ ok: false, reason: 'replay-unavailable' });

/** Tekst do logu: jedna linia i najwyżej 200 znaków (treść błędu bywa złożona z tekstu zgłoszonego biegu). */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Nazwa i treść błędu do logu Vercela, każda w jednej linii i krótko; wyrzucony nie-błąd dostaje ogólną nazwę. Wspólne dla sędziego i jego bundla (`judge.ts`). */
export function describeError(err: unknown): [name: string, message: string] {
  const [name, message] = err instanceof Error ? [err.name, err.message] : ['nieznany błąd', ''];
  return [oneLine(name), oneLine(message)];
}

/** Co sędzia musi wiedzieć o symulacji: odtworzenie biegu (pasuje do niego `replayRun` z gry, który bierze `RunRecord`), koniec sezonu i wynik. */
export interface SeasonJudge<S> {
  replay: (run: SubmittedRun, untilMinute: number) => S;
  endMinute: number;
  score: (state: S) => number;
}

/**
 * Sędzia z odtwarzaniem: bieg odtworzony do końca sezonu; wyjątek przy odtwarzaniu (nieznane polecenie, zepsuty dziennik) albo
 * wynik, który nie jest liczbą, to `replay-failed`. Wyjątek idzie też do logu (`[ranking] replay`, nazwa i treść błędu), żeby
 * błąd sędziego przy uczciwym biegu nie znikał bez śladu. Bieg zakończony wypowiedzeniem umowy przed końcem listopada liczy się
 * z raportami, które zdążyły powstać (decyzja właściciela gry, 2026-10-28). Wersji symulacji ta funkcja nie porównuje: `old-version`
 * zwraca sędzia z bundla (ma `SIM_VERSION`) przed odtwarzaniem.
 */
export function makeReplayVerifier<S>(judge: SeasonJudge<S>): VerifyRun {
  return (run) => {
    let state: S;
    try {
      state = judge.replay(run, judge.endMinute);
    } catch (err) {
      // Ślad w logu Vercela, żeby uczciwy bieg z błędem sędziego (różnica silników, błąd w applyCommand) nie znikał bez wieści.
      // Tylko nazwa i treść błędu, w jednej linii i krótko: bez klucza gracza i bez dziennika poleceń.
      console.error('[ranking] replay', ...describeError(err));
      return { ok: false, reason: 'replay-failed' };
    }
    const score = judge.score(state);
    return Number.isFinite(score) ? { ok: true, score } : { ok: false, reason: 'replay-failed' };
  };
}
