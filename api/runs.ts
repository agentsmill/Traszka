import { route } from '../src/server/env.js';
import { handleRuns } from '../src/server/http.js';
import { makeBundleVerifier } from '../src/server/judge.js';

/**
 * POST /api/runs { key, nick, run } — zgłoszenie biegu rankingowego; wynik liczy serwer (sędzia z src/server/judge.ts).
 *
 * Sędzia odtwarza bieg bundlem symulacji (src/server/judgeBundle.js, generowany przez `npm run build:judge`, nie w repozytorium).
 * Bundle ładuje się leniwie i NIE statycznym importem: brak pliku (pominięty krok budowania) dałby wtedy błąd przy ładowaniu całej
 * funkcji i nawet `ranking-off` zamieniłby się w błąd platformy. Tak brak bundla to 503 `replay-unavailable` i wpis w logu, a ranking
 * wyłączony nigdy go nie dotyka. Literał w `import()` musi stać tu, w pliku funkcji, bo po nim ślad plików Vercela dołącza bundle.
 */
export const POST = route(handleRuns, { verifyRun: makeBundleVerifier(() => import('../src/server/judgeBundle.js')) });
