import { route } from '../../src/server/env.js';
import { handleSaveUpload } from '../../src/server/http.js';

/** POST /api/save/upload { key, save } — „Wyślij zapis”: jedna kopia na klucz, do 64 KB. */
export const POST = route(handleSaveUpload);
