/**
 * Wejście bundla sędziego (`npm run build:judge` → `src/server/judgeBundle.js`): dokładnie to, czego serwer rankingu potrzebuje
 * z symulacji, i nic więcej. `src/sim` ma importy z aliasem `@/` i bez rozszerzeń, więc funkcja Vercela nie załaduje go wprost;
 * bundler (Vite, `scripts/build-judge.mjs`) skleja te eksporty razem z całą symulacją w jeden samodzielny plik ESM.
 *
 * Typy eksportów opisuje ręcznie pisany `src/server/judgeBundle.d.ts` (`tsc` nie obejmuje `scripts/`, więc ten plik sprawdza
 * `tests/judgeBundle.test.ts`, importując go). Zmiana listy poniżej wymaga zmiany tamtego pliku; test porównuje oba.
 */
export { SIM_VERSION } from '@/sim/simVersion';
export { GENERATOR_VERSION } from '@/sim/store/generateStore';
export { RANKED_SEASON_END_MINUTE, seasonScore } from '@/sim/ranked';
export { replayRun } from '@/sim/run';
