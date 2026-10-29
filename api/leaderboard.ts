import { route } from '../src/server/env.js';
import { handleLeaderboard } from '../src/server/http.js';

/** GET /api/leaderboard?board=global|seed|week&seed=…&limit=… — ranking (publiczny, krótko w pamięci podręcznej). */
export const GET = route(handleLeaderboard);
