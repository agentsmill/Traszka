import { route } from '../../src/server/env.js';
import { handleSaveDownload } from '../../src/server/http.js';

/** POST /api/save/download { key } — „Pobierz zapis” na drugim urządzeniu. */
export const POST = route(handleSaveDownload);
