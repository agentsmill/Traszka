import { route } from '../../src/server/env.js';
import { handleSaveUpload } from '../../src/server/http.js';

/** POST /api/save/upload { key, save, expected?, force? } — „Wyślij zapis”: jedna kopia na klucz, do 64 KB; nowsza kopia na serwerze to 409 save-conflict. */
export const POST = route(handleSaveUpload);
