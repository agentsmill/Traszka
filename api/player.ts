import { route } from '../src/server/env.js';
import { handlePlayer } from '../src/server/http.js';

/** POST /api/player { key, nick?, seed? } — nicki tego klucza, status nicka i moje miejsca. */
export const POST = route(handlePlayer);
