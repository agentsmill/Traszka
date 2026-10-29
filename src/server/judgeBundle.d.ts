// Typy bundla sędziego (src/server/judgeBundle.js, generowany przez `npm run build:judge` ze scripts/judge-entry.ts, nie w repozytorium).
// Pisane ręcznie, żeby `tsc` i edytor działały bez zbudowanego pliku. Zgodność z wejściem bundla sprawdza tests/judgeBundle.test.ts.
import type { EconomyState } from '../sim/economy/economy.js';
import type { RunRecord } from '../sim/run.js';

/** Wersja wyniku symulacji (src/sim/simVersion.ts); sędzia przyjmuje bieg tylko z taką samą. */
export declare const SIM_VERSION: number;
/** Wersja generatora sklepów (src/sim/store/generateStore.ts). */
export declare const GENERATOR_VERSION: number;
/** Pierwsza minuta po sezonie rankingowym (src/sim/ranked.ts): do niej odtwarza się bieg. */
export declare const RANKED_SEASON_END_MINUTE: number;
/** Wynik sezonu ze stanu (src/sim/ranked.ts). */
export declare function seasonScore(state: Pick<EconomyState, 'history'>): number;
/** Odtworzenie biegu do minuty `untilMinute` (src/sim/run.ts). */
export declare function replayRun(run: RunRecord, untilMinute: number): EconomyState;
