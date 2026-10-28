/**
 * Wersja zbudowanej gry: `<wersja z package.json>+<12 znaków commita>`, wstawiana przez `vite.config.ts` w czasie budowania
 * (w Vitest to `'test'`). Trafia do koperty zapisu i do `RunRecord` (L7): serwer trzyma pakiet odtwarzania na sezon pod
 * tą wersją i tylko nim sprawdza przebieg. Funkcje serwerowe działają bez Vite, więc dostają `'dev'`.
 */
export const GAME_VERSION: string = typeof __GAME_VERSION__ === 'string' ? __GAME_VERSION__ : 'dev';
