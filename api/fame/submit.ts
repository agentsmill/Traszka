import { route } from '../../src/server/env.js';
import { handleFameSubmit } from '../../src/server/http.js';

/** POST /api/fame/submit { key, nick, seed, day, cash, simVersion } — wpis do Galerii sław (pierwszy milion w zwykłej grze); serwer niczego nie odtwarza. */
export const POST = route(handleFameSubmit);
