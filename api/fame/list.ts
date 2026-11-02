import { route } from '../../src/server/env.js';
import { handleFameList } from '../../src/server/http.js';

/** GET /api/fame/list — Galeria sław: pierwsze 100 wpisów od najwcześniejszego (publiczne, krótko w pamięci podręcznej); bez parametrów. */
export const GET = route(handleFameList);
