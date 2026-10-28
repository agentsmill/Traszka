import { route } from '../src/server/env.js';
import { handleRuns } from '../src/server/http.js';

/** POST /api/runs { key, nick, run } — zgłoszenie biegu rankingowego; wynik liczy serwer (sędzia z src/server/verify.ts). */
export const POST = route(handleRuns);
