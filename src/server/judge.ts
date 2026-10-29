import { SEASON_END_MINUTE } from './config.js';
// Tylko typ: znika przy kompilacji. Sam bundle (src/server/judgeBundle.js, generowany przez `npm run build:judge`) ładuje `api/runs.ts`
// przez `import()` z literałem, żeby ślad plików Vercela go znalazł, a brak pliku nie przewrócił całej funkcji.
import type * as JudgeBundleModule from './judgeBundle.js';
import { describeError, makeReplayVerifier, type VerifyRun } from './verify.js';

/** Eksporty bundla sędziego (typy z ręcznie pisanego `judgeBundle.d.ts`, który odpowiada `scripts/judge-entry.ts`). */
type JudgeBundle = typeof JudgeBundleModule;

const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

/**
 * Czy `mod` jest bundlem sędziego: pięć eksportów z `judge-entry.ts` we właściwych typach, a koniec sezonu to liczba całkowita
 * dodatnia nie większa niż sezon znany serwerowi (`SEASON_END_MINUTE`, przypięty testem do `RANKED_SEASON_END_MINUTE` z gry).
 * Czas odtwarzania rośnie z końcem sezonu, więc to jedyna granica, której nie pilnuje parser. Zwraca bundle albo opis problemu.
 */
function checkBundle(mod: unknown): { bundle: JudgeBundle } | { problem: string } {
  if (typeof mod !== 'object' || mod === null) return { problem: 'bundle nie jest modułem' };
  const m = mod as Record<string, unknown>;
  if (!isCount(m.SIM_VERSION)) return { problem: 'eksport SIM_VERSION nie jest liczbą całkowitą nieujemną' };
  if (!Number.isInteger(m.GENERATOR_VERSION)) return { problem: 'eksport GENERATOR_VERSION nie jest liczbą całkowitą' };
  const end = m.RANKED_SEASON_END_MINUTE;
  if (!Number.isInteger(end) || (end as number) < 1 || (end as number) > SEASON_END_MINUTE) {
    return { problem: `eksport RANKED_SEASON_END_MINUTE poza zakresem 1…${SEASON_END_MINUTE}` };
  }
  if (typeof m.seasonScore !== 'function') return { problem: 'eksport seasonScore nie jest funkcją' };
  if (typeof m.replayRun !== 'function') return { problem: 'eksport replayRun nie jest funkcją' };
  return { bundle: m as unknown as JudgeBundle };
}

/**
 * Sędzia z bundla symulacji (spec §14.7): `src/sim` ma importy z aliasem `@/` i bez rozszerzeń, więc funkcja Vercela nie załaduje go
 * wprost. Krok budowania (`scripts/build-judge.mjs`) pakuje potrzebne eksporty do jednego pliku ESM, a ten sędzia go używa.
 *
 * Bundle ładuje się leniwie, dopiero przy pierwszym biegu (`load` to np. `() => import('../src/server/judgeBundle.js')`), więc
 * ranking wyłączony (`RANKING_ENABLED`) nigdy go nie dotyka. Udane ładowanie jest zapamiętane na życie instancji. Nieudane nie:
 * brak pliku (pominięty krok budowania), zły kształt albo błąd w trakcie ładowania to `replay-unavailable` i wpis w logu
 * (`[ranking] sędzia`, nazwa i treść błędu, w jednej linii), a następny bieg próbuje jeszcze raz. Równoległe biegi z zimnym
 * startem dzielą jedną próbę. Wyjątek nie wychodzi na zewnątrz.
 *
 * Bieg z inną `simVersion` niż `SIM_VERSION` bundla to `old-version`, bez odtwarzania. Reszta (odtworzenie do końca sezonu,
 * wynik, `replay-failed`, `season-bankrupt` dla stanu z `gameOver`) to `makeReplayVerifier` z `verify.ts`; wyjątek z `replayRun`
 * loguje on, więc tu nie ma drugiego try/catch.
 */
export function makeBundleVerifier(load: () => Promise<unknown>): VerifyRun {
  let loaded: JudgeBundle | undefined;
  let loading: Promise<JudgeBundle | undefined> | undefined;

  async function attempt(): Promise<JudgeBundle | undefined> {
    try {
      const checked = checkBundle(await load());
      if ('problem' in checked) {
        console.error('[ranking] sędzia', 'zły bundle', checked.problem);
        return undefined;
      }
      loaded = checked.bundle;
      return loaded;
    } catch (err) {
      console.error('[ranking] sędzia', ...describeError(err));
      return undefined;
    }
  }

  /** Bundle z pamięci albo z jednej wspólnej próby ładowania (po niej `loading` jest czyszczone, więc porażka nie zostaje na stałe). */
  const bundle = (): Promise<JudgeBundle | undefined> | JudgeBundle => {
    if (loaded !== undefined) return loaded;
    loading ??= attempt().finally(() => { loading = undefined; });
    return loading;
  };

  return async (run) => {
    const judge = await bundle();
    if (judge === undefined) return { ok: false, reason: 'replay-unavailable' };
    if (run.simVersion !== judge.SIM_VERSION) return { ok: false, reason: 'old-version' };
    return makeReplayVerifier({
      replay: judge.replayRun,
      endMinute: judge.RANKED_SEASON_END_MINUTE,
      score: judge.seasonScore,
      bankrupt: (state) => state.gameOver === true,   // koniec gry przed końcem sezonu (debet albo wypowiedzenie umowy): `season-bankrupt`
    })(run);
  };
}
