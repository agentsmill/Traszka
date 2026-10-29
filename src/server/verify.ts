// Tylko typ z gry: znika przy kompilacji (patrz `runs.ts` i `runtimeImports.test.ts`).
import type { RunRecord } from '../sim/run.js';

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
 * - `season-bankrupt`: bieg odtworzony do końca sezonu ma koniec gry (granica debetu albo wypowiedzenie umowy), więc do rankingu
 *   nie wchodzi, choćby miał raporty z wcześniejszych miesięcy (decyzja właściciela i koordynatora, 2026-10-29: inaczej gracz,
 *   któremu idzie źle, mógłby celowo zbankrutować i zamrozić wynik);
 * - `replay-unavailable`: sędziego nie ma (bundle niezbudowany albo zepsuty).
 */
export type VerifyFailure = 'replay-unavailable' | 'replay-failed' | 'old-version' | 'season-bankrupt';
export type VerifyResult = { ok: true; score: number } | { ok: false; reason: VerifyFailure };
export type VerifyRun = (run: RunRecord) => VerifyResult | Promise<VerifyResult>;

/** Domyślny sędzia, gdy nie podano innego: żaden bieg nie jest odtwarzany (`api/runs.ts` podaje sędziego z bundla, `judge.ts`). */
export const replayNotAvailable: VerifyRun = () => ({ ok: false, reason: 'replay-unavailable' });

/** Tekst do logu: jedna linia i najwyżej 200 znaków (treść błędu bywa złożona z tekstu zgłoszonego biegu). */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Nazwa i treść błędu do logu Vercela, każda w jednej linii i krótko; wyrzucony nie-błąd dostaje ogólną nazwę. Wspólne dla sędziego i jego bundla (`judge.ts`). */
export function describeError(err: unknown): [name: string, message: string] {
  const [name, message] = err instanceof Error ? [err.name, err.message] : ['nieznany błąd', ''];
  return [oneLine(name), oneLine(message)];
}

/**
 * Co sędzia musi wiedzieć o symulacji: odtworzenie biegu (pasuje do niego `replayRun` z gry, który bierze `RunRecord`), koniec sezonu,
 * wynik i, opcjonalnie, czy stan po odtworzeniu to bankructwo (`bankrupt`: koniec gry przed końcem sezonu). Bez `bankrupt` żaden
 * bieg nie jest uznany za bankruta.
 */
export interface SeasonJudge<S> {
  replay: (run: RunRecord, untilMinute: number) => S;
  endMinute: number;
  score: (state: S) => number;
  bankrupt?: (state: S) => boolean;
}

/**
 * Sędzia z odtwarzaniem: bieg odtworzony do końca sezonu; wyjątek przy odtwarzaniu (nieznane polecenie, zepsuty dziennik) albo
 * wynik, który nie jest liczbą, to `replay-failed`. Wyjątek idzie też do logu (`[ranking] replay`, nazwa i treść błędu), żeby
 * błąd sędziego przy uczciwym biegu nie znikał bez śladu. Bieg, który po odtworzeniu jest bankrutem (`judge.bankrupt`, czyli
 * koniec gry przed końcem listopada), dostaje `season-bankrupt` i wyniku nie ma: do rankingu wchodzą tylko biegi, które
 * przeżyły sezon (decyzja właściciela i koordynatora, 2026-10-29; zastąpiła liczenie z raportów, które zdążyły powstać).
 * Wersji symulacji ta funkcja nie porównuje: `old-version` zwraca sędzia z bundla (ma `SIM_VERSION`) przed odtwarzaniem.
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
    if (judge.bankrupt?.(state)) return { ok: false, reason: 'season-bankrupt' };
    const score = judge.score(state);
    return Number.isFinite(score) ? { ok: true, score } : { ok: false, reason: 'replay-failed' };
  };
}
