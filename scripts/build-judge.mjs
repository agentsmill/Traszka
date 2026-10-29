// Buduje bundle sędziego rankingu: `scripts/judge-entry.ts` (symulacja z src/sim) w jeden samodzielny plik ESM,
// który ładuje funkcja Vercela (`api/runs.ts` → `src/server/judge.ts`). Uruchamiany przez `npm run build:judge`
// (część `npm run build`, przed `tsc` i `vite build`) albo z kodu: testy budują do katalogu tymczasowego.
//
// Dlaczego bundler: `src/sim` używa aliasu `@/` i importów bez rozszerzeń, czego funkcja Vercela nie rozwiąże (build przechodzi,
// a funkcja pada przy pierwszym wywołaniu). Zamiast przerabiać symulację, skrypt skleja ją w jeden plik z aktualnych źródeł,
// więc sędzia zawsze liczy tym samym kodem co gra. Używa tylko publicznego API Vite (`build`), bez konfiguracji gry.
//
// Użycie: node scripts/build-judge.mjs [--out <plik>]   (domyślnie src/server/judgeBundle.js)
import { mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ENTRY = join(ROOT, 'scripts', 'judge-entry.ts');
const DEFAULT_OUT_DIR = join(ROOT, 'src', 'server');
const DEFAULT_OUT_FILE = 'judgeBundle.js';

/**
 * Pakuje sędziego w jeden plik `outDir/outFile`. Zwraca ścieżkę i rozmiar; rzuca, gdy budowanie się nie uda.
 * Katalog wyjściowy NIE jest czyszczony (`emptyOutDir: false`): domyślnie to `src/server` ze źródłami serwera.
 */
export async function buildJudge({ outDir = DEFAULT_OUT_DIR, outFile = DEFAULT_OUT_FILE, entry = DEFAULT_ENTRY } = {}) {
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });   // błąd (np. ścieżka pod zwykłym plikiem) ma wyjść tu, a nie jako cichy brak pliku
  await build({
    root: ROOT,
    configFile: false,            // bez vite.config.ts gry: ma `define`, `base` i ustawienia serwera deweloperskiego, które sędziego nie dotyczą
    envDir: false,                // bez plików .env (sędzia ich nie czyta)
    logLevel: 'warn',
    publicDir: false,
    resolve: { alias: { '@': join(ROOT, 'src') } },
    ssr: { noExternal: true },    // wszystko w jednym pliku; wbudowane moduły Node (node:*) Vite i tak zostawia na zewnątrz
    build: {
      ssr: resolve(entry),        // tryb SSR: wyjście dla Node, bez HTML i bez CSS
      outDir: dir,
      emptyOutDir: false,
      copyPublicDir: false,
      target: 'node20',
      minify: false,              // czytelny plik w śladzie błędów i w razie zgłoszenia sporu o wynik
      sourcemap: false,
      reportCompressedSize: false,
      rolldownOptions: {
        output: { format: 'es', entryFileNames: outFile, codeSplitting: false },   // jeden plik, bez dynamicznych podziałów
      },
    },
  });
  const file = join(dir, outFile);
  return { file, bytes: statSync(file).size };
}

/** `--out <plik>` z wiersza poleceń → katalog i nazwa; bez niego domyślne miejsce. */
function parseArgs(argv) {
  const at = argv.indexOf('--out');
  if (at === -1) return {};
  const out = argv[at + 1];
  if (!out) throw new Error('Po --out brakuje ścieżki pliku.');
  return { outDir: dirname(resolve(out)), outFile: basename(out) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { file, bytes } = await buildJudge(parseArgs(process.argv.slice(2)));
    console.log(`Bundle sędziego: ${file} (${(bytes / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error('Budowanie bundla sędziego nie powiodło się:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
