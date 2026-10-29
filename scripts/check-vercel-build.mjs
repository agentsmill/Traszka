// Sprawdzenie `vercel build` i zbudowanych funkcji rankingu, bez konta Vercela i bez wdrożenia. Uruchamiane RĘCZNIE (potrzebuje sieci
// do rejestru npm), np. po scaleniu zmian, które ruszają `api/`, `src/server/`, `src/sim/` albo budowanie:
//
//   node scripts/check-vercel-build.mjs [--cli-version <wersja>] [--keep]
//
// Po co: funkcje Vercela (`api/*.ts`) kompiluje się osobno, plik po pliku, do ESM, bez sprawdzania typów. Import bez `.js` albo
// z aliasem `@/` przechodzi `vercel build`, a funkcja pada dopiero przy pierwszym wywołaniu. Sędzia rankingu to bundle symulacji
// (`npm run build:judge`), który ma powstać PRZED kompilacją funkcji i trafić do `runs.func`. Testy jednostkowe tego nie widzą,
// więc ten skrypt robi to, co platforma: buduje i wywołuje zbudowane funkcje.
//
// Co robi (wszystko w katalogu tymczasowym, który na końcu usuwa; `--keep` go zostawia do oględzin):
//   1. Kopiuje bieżący stan repozytorium (pliki śledzone i nowe nieignorowane, bez `node_modules`, `.git`, `.claude`, `.superpowers`,
//      `dist`, `.vercel` i bez wygenerowanego `src/server/judgeBundle.js`), więc build musi bundle sam wyprodukować; `npm ci` w kopii.
//   2. Instaluje CLI Vercela do osobnego katalogu (`npm install --ignore-scripts`, domyślnie wersja z `DEFAULT_CLI_VERSION`).
//   3. Wpisuje do kopii UDAWANY `.vercel/project.json` (fałszywe orgId/projectId; ustawienia projektu: framework vite, Node 24.x,
//      bez nadpisanych komend) i uruchamia `vercel build`. Sprawdza w logu: poszło `npm run build`, `build:judge` przed kompilacją
//      funkcji, build zakończony; w wyjściu `.vercel/output`: pięć funkcji, a w `runs.func` bundle sędziego bajt w bajt taki, jaki
//      zbudował `build:judge`.
//   4. Wywołuje zbudowane funkcje zwykłym Node (osobny proces, wejścia z `.vercel/output`), tak jak robi to runtime Vercela: serwer
//      HTTP na 127.0.0.1 z adapterem `@edge-runtime/node-utils` z CLI (ten sam, którego używa `@vercel/node`), a gdy go zabraknie,
//      bezpośrednie `POST(Request)`. Baza to atrapa Upstash nad `MemoryRedis` (`src/server/fakeUpstash.ts`, zbudowana do zwykłego
//      JS); `fetch` poza atrapę jest blokowany i liczony. Scenariusze: ranking wyłączony (503 `ranking-off`, zero zapytań),
//      prawdziwy bieg bierny na 3 miesiące z `RANKING_SALT` i bez niej (200, wynik równy `seasonScore(replayRun(...))` policzonemu
//      osobno prosto z `src/sim`), bieg z inną `simVersion` (409 `old-version`), za krótka `RANKING_SALT` (503 `not-configured`),
//      po jednym wywołaniu pozostałych czterech funkcji, brak bundla w funkcji (503 `replay-unavailable`, funkcja się ładuje).
//      Mierzy czas odtwarzania (zimny start i ciepłe wywołania) oraz rozmiary funkcji.
//
// Kod wyjścia: 0 = wszystko przeszło; 1 = któryś warunek nie zachodzi (lista PASS/FAIL na końcu); 2 = zły argument.
//
// Zasady bezpieczeństwa (obowiązkowe):
//  - jedyne polecenie CLI Vercela to `vercel build` (stała `VERCEL_ARGS`, pilnuje jej test). Skrypt nigdy nie woła `deploy`, `link`,
//    `pull`, `login`, `env`, `dev` ani `--prod` i nie podaje `--yes` (które pozwala CLI ściągać ustawienia projektu). Gdyby CLI
//    zażądało logowania albo połączenia z kontem, build kończy się błędem (stdin zamknięty), a skrypt pokazuje koniec logu;
//  - CLI dostaje izolowany `HOME` (pusty katalog w katalogu tymczasowym), więc nie widzi ani nie zapisuje prawdziwego logowania, oraz
//    czyste środowisko (lista dozwolonych zmiennych w `cleanEnv`: bez `VERCEL_*`, `KV_*`, `RANKING_*`, tokenów), telemetria wyłączona;
//    po buildzie skrypt sprawdza, że w izolowanym HOME nie powstał `auth.json`. Zakres usunięcia: tylko katalog tymczasowy;
//  - funkcje dostają wyłącznie wymyślone wartości (adres `https://atrapa.upstash.test`, tokeny `atrapa-*`, losowy `RANKING_SALT`,
//    losowe klucze graczy); żadne zapytanie nie wychodzi z procesu poza atrapę (do sieci idzie tylko npm przy instalacji);
//  - repozytorium i ustawienia Vercela (także Upstash) zostają nietknięte: skrypt tylko czyta pliki repozytorium (`git ls-files`).
//
// Czysty ESM, tylko wbudowane moduły Node: kod gry (TypeScript z aliasem `@/`) skrypt ładuje przez Vite z KOPII (`ssrLoadModule` do
// policzenia wyniku wprost z `src/sim`, `build` do zamiany atrapy Upstash w zwykły JS), a zbudowane funkcje przez zwykły `import()`.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync,
  realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SELF), '..');

/** Wersja CLI Vercela, na której skrypt był sprawdzony (`--cli-version latest` bierze najnowszą). */
export const DEFAULT_CLI_VERSION = '65.7.0';
/** Jedyne polecenie CLI, jakie skrypt wykonuje. */
export const VERCEL_ARGS = Object.freeze(['build']);
/** Ustawienia udawanego projektu: tak, jak skonfigurowany jest prawdziwy (framework Vite, Node 24.x, komendy z `package.json`). */
export const FAKE_PROJECT = Object.freeze({
  orgId: 'team_atrapaatrapaatrapa0000',
  projectId: 'prj_atrapaatrapaatrapaatrapaatr',
  projectName: 'atrapa',
  settings: {
    framework: 'vite', nodeVersion: '24.x', buildCommand: null, devCommand: null, installCommand: null, outputDirectory: null, rootDirectory: null,
  },
});
/** Pięć funkcji rankingu: ścieżka w API, katalog `.func` w `.vercel/output/functions` i eksportowana metoda. */
export const FUNCTIONS = Object.freeze([
  { path: '/api/runs', dir: 'api/runs.func', file: 'api/runs.js', method: 'POST' },
  { path: '/api/leaderboard', dir: 'api/leaderboard.func', file: 'api/leaderboard.js', method: 'GET' },
  { path: '/api/player', dir: 'api/player.func', file: 'api/player.js', method: 'POST' },
  { path: '/api/save/upload', dir: 'api/save/upload.func', file: 'api/save/upload.js', method: 'POST' },
  { path: '/api/save/download', dir: 'api/save/download.func', file: 'api/save/download.js', method: 'POST' },
]);
/** Bundle sędziego w funkcji `runs` i skąd `build:judge` go bierze w kopii. */
export const BUNDLE_IN_FUNC = 'src/server/judgeBundle.js';
/** Granica czasu odtwarzania trzech miesięcy w zbudowanej funkcji (ms): zwykle poniżej sekundy, więc więcej to prawdziwa regresja. */
export const REPLAY_BUDGET_MS = 8_000;

const ATRAPA_URL = 'https://atrapa.upstash.test';
const TOKEN_RW = 'atrapa-token-zapisu';
const TOKEN_RO = 'atrapa-token-odczytu';
const SEED = 'kiełbasa-42';
const NICK = 'Probnik';
const GAME_VERSION = 'check-vercel-build';
const SAVE_TEXT = JSON.stringify({
  format: 'traszka-przeniesienie', version: 1, seed: SEED, meta: { version: 1, partnerPoints: 0 }, save: { schema: 2, probe: GAME_VERSION },
});
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const WORKERS = ['prepare', 'invoke'];

// ——— argumenty ———

/** Argumenty wiersza poleceń → `{ cliVersion, keep, help, worker?, error? }`. `--worker <nazwa> <plik>` jest wewnętrzne (proces roboczy). */
export function parseArgs(argv) {
  const out = { cliVersion: DEFAULT_CLI_VERSION, keep: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keep') out.keep = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--cli-version' || arg.startsWith('--cli-version=')) {
      const value = arg === '--cli-version' ? argv[++i] : arg.slice('--cli-version='.length);
      if (value === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
        return { ...out, error: 'Po --cli-version brakuje wersji CLI (np. 65.7.0 albo latest).' };
      }
      out.cliVersion = value;
    } else if (arg === '--worker') {
      const name = argv[++i];
      const input = argv[++i];
      if (!WORKERS.includes(name) || !input) return { ...out, error: 'Zły proces roboczy (wewnętrzna opcja --worker).' };
      out.worker = { name, input };
    } else {
      return { ...out, error: `Nieznany argument: ${String(arg).slice(0, 40)}` };
    }
  }
  return out;
}

const USAGE = `Użycie: node scripts/check-vercel-build.mjs [--cli-version <wersja>] [--keep]
  --cli-version <v>  wersja CLI Vercela do zainstalowania w katalogu tymczasowym (domyślnie ${DEFAULT_CLI_VERSION}; może być „latest”)
  --keep             zostaw katalog tymczasowy do oględzin (domyślnie jest usuwany)
Opis, zasady bezpieczeństwa i lista sprawdzeń są w nagłówku pliku.`;

// ——— kopia repozytorium ———

/** Czego kopia nie dostaje: zależności, historia, katalogi narzędzi, wyjście budowania, łącze z projektem Vercela. */
const EXCLUDED = /(?:^|\/)(?:node_modules|\.git|\.claude|\.superpowers|dist|\.vercel)(?:\/|$)/;
/** Plik wygenerowany przez `npm run build:judge`: kopia go nie ma, więc build musi go zrobić sam (jak na Vercelu z czystego klonu). */
const GENERATED = new Set(['src/server/judgeBundle.js']);
/** Czy plik repozytorium (ścieżka względna z ukośnikami) trafia do kopii. */
export const isCopied = (rel) => !EXCLUDED.test(rel) && !GENERATED.has(rel);

/** Pliki bieżącego stanu repozytorium: śledzone i nowe nieignorowane, które istnieją na dysku (śledzony, ale usunięty plik odpada). */
export function listRepoFiles(root) {
  const res = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ls-files nie powiodło się (kod ${res.status}): ${String(res.stderr).trim().slice(0, 200)}`);
  const files = new Set(res.stdout.toString('utf8').split('\0').filter(Boolean));
  return [...files].filter(isCopied).filter((rel) => {
    try {
      return lstatSync(join(root, rel)).isFile() || lstatSync(join(root, rel)).isSymbolicLink();
    } catch {
      return false;
    }
  }).sort();
}

/** Kopiuje pliki `rel` z `root` do `dest` (zwykłe pliki i dowiązania; zachowuje układ katalogów). Zwraca liczbę bajtów zwykłych plików. */
export function copyFiles(root, dest, files) {
  let bytes = 0;
  for (const rel of files) {
    const from = join(root, rel);
    const to = join(dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    const st = lstatSync(from);
    if (st.isSymbolicLink()) {
      symlinkSync(readlinkSync(from), to);
    } else {
      copyFileSync(from, to);
      bytes += st.size;
    }
  }
  return bytes;
}

// ——— środowisko procesów potomnych ———

/** Zmienne, które procesy potomne dostają z otoczenia (reszta, w tym tokeny i `VERCEL_*`, `KV_*`, `RANKING_*`, jest odcinana). */
const ENV_ALLOWED = new Set([
  'PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'TZ', 'USER', 'LOGNAME', 'SHELL',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'npm_config_registry', 'npm_config_cafile',
]);

/** Czyste środowisko dla procesu potomnego: tylko dozwolone zmienne z `base`, potem `extra`. */
export function cleanEnv(base, extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(base)) if (ENV_ALLOWED.has(name) && value !== undefined) env[name] = value;
  return { ...env, ...extra };
}

/** Środowisko CLI Vercela: izolowany HOME i XDG (bez prawdziwego logowania), telemetria i sprawdzanie aktualizacji wyłączone, stdin zamknięty. */
export function cliEnv(base, home) {
  return cleanEnv(base, {
    HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'), XDG_CACHE_HOME: join(home, '.cache'),
    CI: '1', NO_COLOR: '1', VERCEL_TELEMETRY_DISABLED: '1', NO_UPDATE_NOTIFIER: '1', npm_config_update_notifier: 'false',
  });
}

/** Uruchamia polecenie z wyjściem do pliku (stdin zamknięty); zwraca `{ status, signal, timedOut }`. */
function runLogged(command, args, { cwd, env, logFile, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const fd = openSync(logFile, 'a');
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', fd, fd] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      closeSync(fd);
      resolvePromise({ status: null, signal: null, timedOut, error: err.message });
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      closeSync(fd);
      resolvePromise({ status, signal, timedOut });
    });
  });
}

const tail = (text, lines = 40) => text.split('\n').slice(-lines).join('\n');
const readLog = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const stripAnsi = (text) => text.replace(/\u{1B}\[[0-9;]*[A-Za-z]/gu, '');
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

// ——— log `vercel build` i wyjście `.vercel/output` ———

/** Jedno sprawdzenie: identyfikator, nazwa, wynik i szczegół do pokazania. */
const verdict = (id, name, ok, detail = '') => ({ id, name, ok: Boolean(ok), detail });

/**
 * Log `vercel build` → sprawdzenia i fakty. Warunki: build uruchomił `npm run build` (komenda projektu bez nadpisania), krok
 * `build:judge` (linia „Bundle sędziego”) poszedł przed budowaniem gry (Vite) i przed kompilacją funkcji (linie „Using … TypeScript”),
 * a build się zakończył. Kolejność kompilacji funkcji potwierdza też obecność bundla w `runs.func` (`checkOutput`).
 */
export function analyzeBuildLog(rawLog) {
  const log = stripAnsi(rawLog);
  const at = (re) => { const m = re.exec(log); return m ? m.index : -1; };
  const npmBuild = at(/Running "npm run build"/);
  const judge = at(/Bundle sędziego: /);
  const vite = at(/\bvite v\d/);
  const compile = at(/Using (?:the )?TypeScript/);
  const done = at(/Build Completed in \.vercel\/output/);
  const compiled = (log.match(/Using the TypeScript [\d.]+ compiler executable for transpilation/g) ?? []).length;
  const ts = /Using TypeScript ([\d.]+)/.exec(log)?.[1];
  const checks = [
    verdict('npm-run-build', 'vercel build uruchomił „npm run build” (komenda budowania z package.json, bez nadpisania)', npmBuild >= 0,
      npmBuild >= 0 ? 'w logu: Running "npm run build"' : 'w logu nie ma linii Running "npm run build"'),
    verdict('judge-first', 'build:judge poszedł przed budowaniem gry (Vite) i przed kompilacją funkcji',
      judge >= 0 && (vite < 0 || judge < vite) && (compile < 0 || judge < compile),
      judge < 0 ? 'w logu nie ma linii „Bundle sędziego: …”' : `linia „Bundle sędziego” w ${judge < compile || compile < 0 ? 'poprawnym' : 'złym'} miejscu logu`),
    verdict('build-completed', 'vercel build zakończył się komunikatem „Build Completed in .vercel/output”', done >= 0,
      done >= 0 ? 'jest' : 'brak w logu'),
  ];
  return { checks, facts: { functionsCompiled: compiled, typescript: ts, cliVersion: /^Vercel CLI (\S+)/m.exec(log)?.[1] } };
}

/**
 * Czy nieudany `vercel build` wygląda na chwilowy błąd sieci (CLI pobiera swoje buildery z rejestru npm i przy gorszej chwili kończy
 * się samym „Request failed”). Taki build skrypt ponawia jeden raz; każdy inny błąd (kod, typy, brak pliku) jest prawdziwy.
 */
export function isTransientFailure(rawLog) {
  return /Request failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up/i.test(stripAnsi(rawLog));
}

/** Suma rozmiarów plików w katalogu (rekurencyjnie, dowiązania jako ich rozmiar). */
export function dirSize(dir) {
  let sum = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    sum += entry.isDirectory() ? dirSize(p) : lstatSync(p).size;
  }
  return sum;
}

/**
 * Wyjście `.vercel/output` kopii → sprawdzenia i fakty: pięć funkcji z `.vc-config.json` i plikiem wejściowym, statyczny
 * `index.html` gry i, w `runs.func`, bundle sędziego bajt w bajt taki, jaki zbudował `build:judge` w kopii.
 */
export function checkOutput(outputDir, copyDir) {
  const checks = [];
  const facts = { functions: {} };
  const missing = [];
  for (const f of FUNCTIONS) {
    const dir = join(outputDir, 'functions', f.dir);
    const configFile = join(dir, '.vc-config.json');
    if (!existsSync(configFile)) { missing.push(`${f.dir}/.vc-config.json`); continue; }
    let config = {};
    try {
      config = JSON.parse(readFileSync(configFile, 'utf8'));
    } catch {
      missing.push(`${f.dir}/.vc-config.json (nie jest JSON)`);
      continue;
    }
    if (typeof config.handler !== 'string' || !existsSync(join(dir, config.handler))) missing.push(`${f.dir}: brak pliku wejściowego ${String(config.handler)}`);
    facts.functions[f.path] = { bytes: dirSize(dir), handler: config.handler, runtime: config.runtime, launcher: config.launcherType };
  }
  checks.push(verdict('functions', 'pięć funkcji w .vercel/output/functions (api/runs, leaderboard, player, save/upload, save/download)', missing.length === 0,
    missing.length === 0 ? FUNCTIONS.map((f) => `${f.path} ${kb(facts.functions[f.path].bytes)}`).join(', ') : `brakuje: ${missing.join('; ')}`));

  const bundleFile = join(outputDir, 'functions', FUNCTIONS[0].dir, BUNDLE_IN_FUNC);
  const built = join(copyDir, BUNDLE_IN_FUNC);
  let problem = '';
  if (!existsSync(bundleFile)) problem = `brak ${BUNDLE_IN_FUNC} w ${FUNCTIONS[0].dir}`;
  else if (!existsSync(built)) problem = `build:judge nie zostawił ${BUNDLE_IN_FUNC} w kopii`;
  else if (statSync(bundleFile).size < 10_000) problem = `bundle w funkcji ma tylko ${statSync(bundleFile).size} B`;
  else if (Buffer.compare(readFileSync(bundleFile), readFileSync(built)) !== 0) problem = 'bundle w funkcji różni się od zbudowanego przez build:judge';
  if (problem === '') facts.bundleBytes = statSync(bundleFile).size;
  checks.push(verdict('bundle-in-func', 'runs.func zawiera bundle sędziego (src/server/judgeBundle.js), taki jak zbudował build:judge', problem === '',
    problem === '' ? `${kb(facts.bundleBytes)}, bajt w bajt z kopią` : problem));

  checks.push(verdict('static-index', 'build gry wyprodukował static/index.html', existsSync(join(outputDir, 'static', 'index.html')),
    existsSync(join(outputDir, 'static', 'index.html')) ? 'jest' : 'brak .vercel/output/static/index.html'));
  return { checks, facts };
}

// ——— identyfikatory i dane próby ———

/** Klucz gracza w formacie kodu odzyskiwania (pięć grup po cztery znaki Crockforda), nowy przy każdym wywołaniu. */
export function newPlayerKey(random = (n) => randomBytes(n)) {
  const chars = Array.from(random(20), (b) => CROCKFORD[b & 31]).join('');
  return chars.match(/.{4}/g).join('-');
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (n) => Math.round(n);

// ——— proces roboczy „prepare”: wersje i wynik wprost z src/sim, atrapa Upstash jako zwykły JS ———

/** Wejście ESM Vite z kopii (pole `exports["."]` jej package.json). */
function viteEntry(copy) {
  const pkg = JSON.parse(readFileSync(join(copy, 'node_modules', 'vite', 'package.json'), 'utf8'));
  const exp = pkg.exports?.['.'];
  const rel = typeof exp === 'string' ? exp : exp?.import?.default ?? exp?.import ?? exp?.default;
  if (typeof rel !== 'string') throw new Error('Nie znaleziono wejścia ESM Vite w kopii.');
  return pathToFileURL(join(copy, 'node_modules', 'vite', rel)).href;
}

async function prepareWorker({ copy, tmp }) {
  const { createServer: createViteServer } = await import(viteEntry(copy));
  const server = await createViteServer({
    root: copy, configFile: false, envDir: false, logLevel: 'error', appType: 'custom', clearScreen: false, cacheDir: join(tmp, 'vite-cache'),
    resolve: { alias: { '@': join(copy, 'src') } },
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  let direct;
  try {
    const sim = await server.ssrLoadModule('/src/sim/simVersion.ts');
    const store = await server.ssrLoadModule('/src/sim/store/generateStore.ts');
    const ranked = await server.ssrLoadModule('/src/sim/ranked.ts');
    const run = await server.ssrLoadModule('/src/sim/run.ts');
    const record = { seed: SEED, gameVersion: GAME_VERSION, generatorVersion: store.GENERATOR_VERSION, simVersion: sim.SIM_VERSION, mode: 'ranked', log: [] };
    const t0 = performance.now();
    const score = ranked.seasonScore(run.replayRun(record, ranked.RANKED_SEASON_END_MINUTE));
    direct = {
      simVersion: sim.SIM_VERSION, generatorVersion: store.GENERATOR_VERSION, endMinute: ranked.RANKED_SEASON_END_MINUTE, score,
      replayMs: round(performance.now() - t0),
    };
  } finally {
    await server.close();
  }
  // Atrapa Upstash: pliki TypeScript z kopii (`src/server/memoryRedis.ts`, `fakeUpstash.ts`) zamienione tym samym narzędziem co sędzia
  // (`buildJudge` z kopii) w jeden zwykły plik ESM, który proces „invoke” ładuje bez Vite.
  const entry = join(tmp, 'atrapa-entry.ts');
  writeFileSync(entry, [
    `export { MemoryRedis } from ${JSON.stringify(join(copy, 'src', 'server', 'memoryRedis.ts'))};`,
    `export { fakeUpstash } from ${JSON.stringify(join(copy, 'src', 'server', 'fakeUpstash.ts'))};`,
    '',
  ].join('\n'));
  const { buildJudge } = await import(pathToFileURL(join(copy, 'scripts', 'build-judge.mjs')).href);
  const atrapa = await buildJudge({ entry, outDir: join(tmp, 'atrapa'), outFile: 'atrapa.mjs' });
  return { direct, atrapaFile: atrapa.file };
}

// ——— proces roboczy „invoke”: zbudowane funkcje wywołane tak, jak wywoła je Vercel ———

const TRACKED_ENV = ['RANKING_ENABLED', 'RANKING_SALT', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'KV_REST_API_READ_ONLY_TOKEN'];

async function invokeWorker({ outputDir, atrapaFile, cliDir, simVersion, generatorVersion, expectedScore }) {
  for (const name of Object.keys(process.env)) if (/^(?:KV_|RANKING_|UPSTASH_|VERCEL|NOW_)/.test(name)) delete process.env[name];
  const setEnv = (env) => {
    for (const name of TRACKED_ENV) delete process.env[name];
    Object.assign(process.env, env);
  };
  const checks = [];
  const check = (id, name, ok, detail = '') => checks.push(verdict(id, name, ok, detail));
  const logged = [];
  for (const level of ['error', 'warn', 'log', 'info']) console[level] = (...args) => { logged.push(args.map(String).join(' ')); };

  const { MemoryRedis, fakeUpstash } = await import(pathToFileURL(atrapaFile).href);
  const redis = new MemoryRedis();
  const up = fakeUpstash(redis, ATRAPA_URL, { rw: TOKEN_RW, ro: TOKEN_RO });
  const realFetch = globalThis.fetch;
  const blocked = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(`${ATRAPA_URL}/`)) {
      blocked.push(new URL(url).origin);
      throw new TypeError('zablokowane: żądanie poza atrapę Upstash');
    }
    return up.fetch(input, init);
  };

  // Wejścia funkcji z .vercel/output (zwykły import ESM, bez Vite i bez aliasów).
  const loadErrors = [];
  const mods = new Map();
  const t0 = performance.now();
  for (const f of FUNCTIONS) {
    try {
      const mod = await import(pathToFileURL(join(outputDir, 'functions', f.dir, f.file)).href);
      if (typeof mod[f.method] !== 'function') loadErrors.push(`${f.path}: brak eksportu ${f.method}`);
      mods.set(f.path, mod);
    } catch (err) {
      loadErrors.push(`${f.path}: ${err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 160) : 'nieznany błąd'}`);
    }
  }
  const loadMs = round(performance.now() - t0);
  check('load', 'pięć funkcji ładuje się zwykłym import() i eksportuje oczekiwaną metodę (importy względne z .js)', loadErrors.length === 0,
    loadErrors.length === 0 ? `${loadMs} ms razem` : loadErrors.join('; '));
  if (loadErrors.length > 0) return { checks, timings: {}, transport: 'brak' };

  // Transport: serwer HTTP + adapter Web→Node z CLI (jak w runtime Vercela) albo bezpośrednie wywołanie.
  let lastHandlerMs = 0;
  let port = 0;
  let server = null;
  let transport = 'bezpośrednie wywołanie metody (Request → Response)';
  try {
    const { buildToNodeHandler } = createRequire(join(cliDir, 'package.json'))('@edge-runtime/node-utils');
    const toNode = buildToNodeHandler({
      Headers, ReadableStream, Uint8Array,
      Request: class extends Request {
        constructor(input, init) { super(input, init === undefined || typeof init === 'object' ? { duplex: 'half', ...init } : init); }
      },
      FetchEvent: class { constructor() { this.waitUntil = () => undefined; } },
    }, { defaultOrigin: 'https://vercel.com' });
    const handlers = new Map();
    for (const f of FUNCTIONS) {
      const timed = async (request) => {
        const t = performance.now();
        try { return await mods.get(f.path)[f.method](request); } finally { lastHandlerMs = performance.now() - t; }
      };
      handlers.set(f.path, { method: f.method, handler: toNode(timed) });
    }
    server = createServer((req, res) => {
      const found = handlers.get(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      if (!found || req.method !== found.method) { res.statusCode = found ? 405 : 404; res.end(); return; }
      found.handler(req, res);
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    port = server.address().port;
    transport = 'serwer HTTP na 127.0.0.1 + adapter @edge-runtime/node-utils z CLI';
  } catch {
    server = null;
  }

  const texts = [];
  async function call(path, { body, ip, query = '' }) {
    const verb = FUNCTIONS.find((x) => x.path === path).method;
    const headers = { 'x-real-ip': ip };
    const init = { method: verb, headers };
    if (body !== undefined) { init.body = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const t = performance.now();
    let status;
    let text;
    if (server) {
      const res = await realFetch(`http://127.0.0.1:${port}${path}${query}`, init);
      status = res.status;
      text = await res.text();
    } else {
      const res = await mods.get(path)[verb](new Request(`https://przyklad.test${path}${query}`, init));
      status = res.status;
      text = await res.text();
      lastHandlerMs = performance.now() - t;
    }
    const ms = performance.now() - t;
    texts.push(text);
    let json = null;
    try { json = JSON.parse(text); } catch { /* odpowiedź niebędąca JSON-em zostaje jako tekst */ }
    return { status, json, text, ms, handlerMs: lastHandlerMs };
  }

  const ip = (n) => `203.0.113.${n}`;
  const run = (over = {}) => ({ seed: SEED, gameVersion: GAME_VERSION, generatorVersion, simVersion, mode: 'ranked', log: [], ...over });
  const submit = (key, nick, over) => ({ key, nick, run: run(over) });
  const dbCalls = () => up.log.length;
  const keys = { a: newPlayerKey(), b: newPlayerKey(), c: newPlayerKey(), d: newPlayerKey() };
  const salt = randomBytes(16).toString('hex');
  const live = { RANKING_ENABLED: '1', KV_REST_API_URL: ATRAPA_URL, KV_REST_API_TOKEN: TOKEN_RW, KV_REST_API_READ_ONLY_TOKEN: TOKEN_RO };
  const timings = { loadMs };

  // 1. Ranking wyłączony: wszystkie pięć funkcji odpowiada 503 `ranking-off`, nie dotykając bazy (zmienne Upstash ustawione).
  setEnv({ KV_REST_API_URL: ATRAPA_URL, KV_REST_API_TOKEN: TOKEN_RW, KV_REST_API_READ_ONLY_TOKEN: TOKEN_RO });
  const before = dbCalls();
  const off = [
    await call('/api/runs', { body: submit(keys.a, NICK), ip: ip(1) }),
    await call('/api/leaderboard', { query: '?board=global', ip: ip(1) }),
    await call('/api/player', { body: { key: keys.a }, ip: ip(1) }),
    await call('/api/save/upload', { body: { key: keys.a, save: SAVE_TEXT }, ip: ip(1) }),
    await call('/api/save/download', { body: { key: keys.a }, ip: ip(1) }),
  ];
  const offBad = off.filter((r) => r.status !== 503 || r.json?.error !== 'ranking-off');
  check('off', 'bez RANKING_ENABLED wszystkie pięć funkcji odpowiada 503 ranking-off i nie robi żadnego zapytania do bazy',
    offBad.length === 0 && dbCalls() === before && redis.calls === 0,
    offBad.length === 0 ? `5 × 503 ranking-off, zapytań do bazy: ${dbCalls() - before}` : `odpowiedzi: ${off.map((r) => `${r.status}/${r.json?.error}`).join(', ')}`);

  // 2. Prawdziwy bieg bierny na 3 miesiące, z RANKING_SALT: zimny start (pierwsze wywołanie) i ciepłe.
  setEnv({ ...live, RANKING_SALT: salt });
  const callsBefore = dbCalls();
  const cold = await call('/api/runs', { body: submit(keys.a, NICK), ip: ip(2) });
  const callsSalt = dbCalls() - callsBefore;
  check('run-salt', 'bieg bierny 3 miesięcy z RANKING_SALT: 200, wynik równy seasonScore(replayRun(...)) liczonemu prosto z src/sim',
    cold.status === 200 && cold.json?.ok === true && cold.json?.score === expectedScore && cold.json?.nick === NICK,
    `${cold.status}, wynik funkcji ${cold.json?.score}, wynik z src/sim ${expectedScore}; zapytań do bazy: ${callsSalt}`);
  const warm = [];
  for (let i = 0; i < 3; i++) warm.push(await call('/api/runs', { body: submit(keys.a, NICK), ip: ip(2) }));
  check('run-warm', 'ten sam bieg jeszcze trzy razy (ciepła instancja): 200 i ten sam wynik, bez poprawy rekordu',
    warm.every((r) => r.status === 200 && r.json?.score === expectedScore && r.json?.improved === false),
    warm.map((r) => `${r.status}/${r.json?.score}/${r.json?.improved}`).join(', '));
  Object.assign(timings, {
    coldHandlerMs: round(cold.handlerMs), coldRoundTripMs: round(cold.ms),
    warmHandlerMs: warm.map((r) => round(r.handlerMs)), warmMedianMs: round(median(warm.map((r) => r.handlerMs))),
  });
  check('replay-time', `czas odtwarzania w funkcji mieści się w ${REPLAY_BUDGET_MS} ms (zimny start i ciepłe wywołania)`,
    cold.handlerMs < REPLAY_BUDGET_MS && warm.every((r) => r.handlerMs < REPLAY_BUDGET_MS),
    `zimny ${timings.coldHandlerMs} ms (z HTTP ${timings.coldRoundTripMs} ms), ciepłe ${timings.warmHandlerMs.join(', ')} ms`);

  // 3. Inna wersja symulacji: 409 old-version, a nick i wynik nie trafiają do bazy.
  const old = await call('/api/runs', { body: submit(keys.b, 'Probnik2', { simVersion: simVersion + 1 }), ip: ip(3) });
  const free = await call('/api/player', { body: { key: keys.b, nick: 'Probnik2' }, ip: ip(3) });
  check('old-version', 'ten sam bieg z simVersion o 1 większym: 409 old-version, a nick zostaje wolny',
    old.status === 409 && old.json?.error === 'old-version' && free.json?.nick?.status === 'free',
    `${old.status} ${old.json?.error}; status nicka po odmowie: ${free.json?.nick?.status}`);

  // 4. Pozostałe funkcje po jednym razie, na danych z kroku 2.
  const readsBefore = up.log.length;
  const board = await call('/api/leaderboard', { query: '?board=global', ip: ip(4) });
  const row = board.json?.rows?.find((r) => r.nick === NICK);
  const readTokens = up.log.slice(readsBefore).map((e) => e.token);
  check('leaderboard', 'GET /api/leaderboard: 200, wiersz z nickiem i wynikiem biegu, czytany tokenem tylko do odczytu',
    board.status === 200 && row?.score === expectedScore && !board.json.rows.some((r) => r.nick === 'Probnik2') && readTokens.length > 0 && readTokens.every((t) => t === 'ro'),
    `${board.status}, wiersze: ${board.json?.rows?.length}, wynik w wierszu ${row?.score}, tokeny: ${[...new Set(readTokens)].join(',')}`);
  const player = await call('/api/player', { body: { key: keys.a, nick: NICK }, ip: ip(4) });
  check('player', 'POST /api/player: 200, nick jest mój i ma miejsce w rankingu globalnym',
    player.status === 200 && player.json?.nick?.status === 'mine' && player.json?.ranks?.global !== null && player.json?.ranks?.global !== undefined,
    `${player.status}, status nicka ${player.json?.nick?.status}, miejsca ${JSON.stringify(player.json?.ranks)}`);
  const up1 = await call('/api/save/upload', { body: { key: keys.a, save: SAVE_TEXT }, ip: ip(4) });
  const down = await call('/api/save/download', { body: { key: keys.a }, ip: ip(4) });
  check('save', 'POST /api/save/upload i /api/save/download: 200 i zapis wraca bajt w bajt',
    up1.status === 200 && down.status === 200 && down.json?.save === SAVE_TEXT, `upload ${up1.status}, download ${down.status}, zgodny: ${down.json?.save === SAVE_TEXT}`);

  // 5. Bez RANKING_SALT: sól okna leży w bazie (więcej zapytań), wynik ten sam.
  setEnv(live);
  const noSaltBefore = dbCalls();
  const noSalt = await call('/api/runs', { body: submit(keys.c, 'Probnik3'), ip: ip(5) });
  const callsNoSalt = dbCalls() - noSaltBefore;
  check('run-no-salt', 'bieg bez RANKING_SALT: 200 i ten sam wynik, ale z większą liczbą zapytań (limit czyta sól okna z bazy; z sekretem nie)',
    noSalt.status === 200 && noSalt.json?.score === expectedScore && callsNoSalt > callsSalt,
    `${noSalt.status}, wynik ${noSalt.json?.score}; zapytań do bazy: ${callsNoSalt} (z RANKING_SALT: ${callsSalt})`);

  // 6. Za krótka RANKING_SALT: 503 not-configured bez zapytań do bazy; granica to 16 znaków.
  const shortCases = [['za-krotka', 'krótsza'], ['', 'pusta'], ['a'.repeat(15), '15 znaków']];
  const shortBad = [];
  for (const [value, label] of shortCases) {
    setEnv({ ...live, RANKING_SALT: value });
    const mark = dbCalls();
    const r1 = await call('/api/runs', { body: submit(keys.d, 'Probnik4'), ip: ip(6) });
    const r2 = await call('/api/leaderboard', { query: '?board=global', ip: ip(6) });
    if (![r1, r2].every((r) => r.status === 503 && r.json?.error === 'not-configured') || dbCalls() !== mark) shortBad.push(`${label}: ${r1.status}/${r1.json?.error}, ${r2.status}/${r2.json?.error}`);
  }
  setEnv({ ...live, RANKING_SALT: 'a'.repeat(16) });
  const edge = await call('/api/leaderboard', { query: '?board=global', ip: ip(6) });
  check('salt-short', 'RANKING_SALT krótsza niż 16 znaków (też pusta): 503 not-configured bez zapytań do bazy; dokładnie 16 znaków działa',
    shortBad.length === 0 && edge.status === 200, shortBad.length === 0 ? `krótka, pusta i 15 znaków: 503 not-configured; 16 znaków: ${edge.status}` : shortBad.join('; '));

  // 7. Brak bundla w funkcji (pominięty krok budowania): funkcja się ładuje, ranking wyłączony działa, bieg to 503 replay-unavailable.
  const brokenDir = join(dirname(outputDir), 'runs-bez-bundla.func');
  cpSync(join(outputDir, 'functions', FUNCTIONS[0].dir), brokenDir, { recursive: true });
  rmSync(join(brokenDir, BUNDLE_IN_FUNC), { force: true });
  let broken;
  let brokenOff = null;
  let brokenRun = null;
  try {
    broken = await import(pathToFileURL(join(brokenDir, FUNCTIONS[0].file)).href);
    const wrap = (body, ipAddress) => broken.POST(new Request(`https://przyklad.test${FUNCTIONS[0].path}`, {
      method: 'POST', headers: { 'x-real-ip': ipAddress, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    setEnv({ KV_REST_API_URL: ATRAPA_URL, KV_REST_API_TOKEN: TOKEN_RW });
    brokenOff = await wrap(submit(newPlayerKey(), NICK), ip(7));
    setEnv({ ...live, RANKING_SALT: salt });
    const mark = logged.length;
    brokenRun = await wrap(submit(newPlayerKey(), 'Probnik5'), ip(7));
    brokenRun = { status: brokenRun.status, json: await brokenRun.json().catch(() => null), logs: logged.slice(mark) };
    brokenOff = { status: brokenOff.status, json: await brokenOff.json().catch(() => null) };
  } catch (err) {
    brokenRun = { status: 0, json: null, logs: [err instanceof Error ? `${err.name}: ${err.message}` : 'błąd'] };
  }
  check('bundle-missing', 'funkcja bez bundla: ładuje się, ranking-off działa, bieg to 503 replay-unavailable z wpisem w logu',
    brokenOff?.status === 503 && brokenOff.json?.error === 'ranking-off' && brokenRun.status === 503 && brokenRun.json?.error === 'replay-unavailable'
      && brokenRun.logs.some((l) => l.includes('[ranking] sędzia')),
    `ranking-off: ${brokenOff?.status}; bieg: ${brokenRun.status} ${brokenRun.json?.error}; log: ${brokenRun.logs[0]?.slice(0, 80) ?? 'brak'}`);

  // 8. Szczelność: nic poza atrapę, żadnych sekretów w odpowiedziach ani logach.
  const secrets = [ATRAPA_URL, new URL(ATRAPA_URL).host, TOKEN_RW, TOKEN_RO, salt, ...Object.values(keys), ...Object.values(keys).map((k) => k.replaceAll('-', ''))];
  const leaks = secrets.filter((s) => texts.some((t) => t.includes(s)) || logged.some((l) => l.includes(s)));
  check('sealed', 'żadne zapytanie nie wyszło poza atrapę Upstash, a odpowiedzi i logi funkcji nie zawierają adresu, tokenów, soli ani kluczy graczy',
    blocked.length === 0 && leaks.length === 0, `zapytań do atrapy: ${up.log.length}, zablokowanych: ${blocked.length}, wycieków: ${leaks.length}, linii logu funkcji: ${logged.length}`);

  if (server) await new Promise((done) => server.close(done));
  return { checks, timings, transport };
}

const WORKER_FUNCTIONS = { prepare: prepareWorker, invoke: invokeWorker };

/** Proces roboczy: czyta wejście JSON z pliku, zapisuje wynik (albo błąd) do `<plik>.out` i kończy. */
async function workerMain({ name, input }) {
  const out = `${input}.out`;
  try {
    const result = await WORKER_FUNCTIONS[name](JSON.parse(readFileSync(input, 'utf8')));
    writeFileSync(out, JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    writeFileSync(out, JSON.stringify({ error: err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err) }));
    process.exit(1);
  }
}

// ——— przebieg główny ———

/** Całość: kopia → npm ci → CLI → vercel build → kontrola logu i wyjścia → wywołania funkcji. Zwraca kod wyjścia (0 albo 1). */
export async function runCheck({ cliVersion = DEFAULT_CLI_VERSION, keep = false, root = ROOT, say = console.log } = {}) {
  const results = [];
  const record = (list) => {
    for (const c of list) {
      results.push(c);
      say(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `\n          ${c.detail}` : ''}`);
    }
  };
  const tmp = mkdtempSync(join(tmpdir(), 'traszka-vercel-build-'));
  const copy = join(tmp, 'repo');
  const cliDir = join(tmp, 'cli');
  const home = join(tmp, 'home');
  const logs = join(tmp, 'logs');
  for (const dir of [copy, cliDir, home, logs]) mkdirSync(dir, { recursive: true });
  const facts = { node: process.version, platform: `${process.platform}-${process.arch}` };
  say(`Katalog tymczasowy: ${tmp}${keep ? ' (zostanie, --keep)' : ' (zostanie usunięty)'}`);
  const stop = (name, detail) => { record([verdict(name.id, name.title, false, detail)]); };
  const onSignal = () => { if (!keep) rmSync(tmp, { recursive: true, force: true }); process.exit(130); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    // 1. Kopia repozytorium.
    say('\n[1/6] Kopia repozytorium (bieżący stan, bez node_modules, .git, .claude, .superpowers, dist, .vercel i bez judgeBundle.js)');
    const files = listRepoFiles(root);
    const bytes = copyFiles(root, copy, files);
    record([verdict('copy', 'kopia repozytorium w katalogu tymczasowym', files.length > 0 && existsSync(join(copy, 'package.json')) && !existsSync(join(copy, BUNDLE_IN_FUNC)),
      `${files.length} plików, ${(bytes / 1048576).toFixed(1)} MB`)]);

    // 2. npm ci w kopii.
    say('\n[2/6] npm ci w kopii');
    const npmEnv = cleanEnv(process.env, { HOME: process.env.HOME ?? home, NO_COLOR: '1', npm_config_update_notifier: 'false' });
    const ci = await runLogged('npm', ['ci', '--no-audit', '--no-fund'], { cwd: copy, env: npmEnv, logFile: join(logs, 'npm-ci.log'), timeoutMs: 600_000 });
    record([verdict('npm-ci', 'npm ci w kopii', ci.status === 0, ci.status === 0 ? 'zależności zainstalowane' : `kod ${ci.status}${ci.timedOut ? ' (przekroczono czas)' : ''}\n${tail(readLog(join(logs, 'npm-ci.log')), 15)}`)]);
    if (ci.status !== 0) return finish();

    // 3. CLI Vercela do osobnego katalogu.
    say(`\n[3/6] CLI Vercela (${cliVersion}) w osobnym katalogu`);
    writeFileSync(join(cliDir, 'package.json'), '{"name":"vercel-cli-tmp","private":true}\n');
    const inst = await runLogged('npm', ['install', '--prefix', cliDir, `vercel@${cliVersion}`, '--no-audit', '--no-fund', '--ignore-scripts'],
      { cwd: cliDir, env: npmEnv, logFile: join(logs, 'cli-install.log'), timeoutMs: 600_000 });
    const vercelBin = join(cliDir, 'node_modules', '.bin', 'vercel');
    record([verdict('cli-install', `instalacja CLI Vercela ${cliVersion} (npm install --ignore-scripts)`, inst.status === 0 && existsSync(vercelBin),
      inst.status === 0 ? 'zainstalowane w katalogu tymczasowym' : `kod ${inst.status}\n${tail(readLog(join(logs, 'cli-install.log')), 15)}`)]);
    if (inst.status !== 0 || !existsSync(vercelBin)) return finish();

    // 4. vercel build z udawanym projektem.
    say('\n[4/6] vercel build (udawany .vercel/project.json, izolowany HOME, bez konta i bez wdrożenia)');
    mkdirSync(join(copy, '.vercel'), { recursive: true });
    writeFileSync(join(copy, '.vercel', 'project.json'), `${JSON.stringify(FAKE_PROJECT, null, 2)}\n`);
    let build;
    let text;
    let attempt = 0;
    for (;;) {
      attempt++;
      const buildLog = join(logs, attempt === 1 ? 'vercel-build.log' : `vercel-build-${attempt}.log`);
      build = await runLogged(vercelBin, [...VERCEL_ARGS], { cwd: copy, env: cliEnv(process.env, home), logFile: buildLog, timeoutMs: 600_000 });
      text = readLog(buildLog);
      if (build.status === 0 || attempt >= 2 || !isTransientFailure(text)) break;
      say('  Chwilowy błąd sieci w vercel build (Request failed i podobne); ponawiam jeden raz.');
      rmSync(join(copy, '.vercel', 'output'), { recursive: true, force: true });
    }
    record([verdict('vercel-build', 'vercel build kończy się kodem 0', build.status === 0,
      build.status === 0 ? `kod 0${attempt > 1 ? ' (za drugą próbą: pierwsza padła na błędzie sieci)' : ''}`
        : `kod ${build.status}${build.timedOut ? ' (przekroczono czas)' : ''}${build.error ? `, ${build.error}` : ''}${attempt > 1 ? ' (po ponowieniu)' : ''}\n${tail(stripAnsi(text), 25)}`)]);
    if (build.status !== 0) return finish();
    const analysis = analyzeBuildLog(text);
    Object.assign(facts, analysis.facts);
    record(analysis.checks);
    const authFiles = findFiles(home, 'auth.json');
    record([verdict('no-login', 'CLI nie zapisało danych logowania (brak auth.json w izolowanym HOME) i nie prosiło o logowanie',
      authFiles.length === 0 && !/vercel login|log in to vercel|Please log in/i.test(text), authFiles.length === 0 ? 'brak auth.json' : `znaleziono: ${authFiles.join(', ')}`)]);
    const outputDir = join(copy, '.vercel', 'output');
    const output = checkOutput(outputDir, copy);
    Object.assign(facts, { output: output.facts });
    record(output.checks);
    if (output.checks.some((c) => !c.ok && c.id !== 'static-index')) return finish();

    // 5. Wersje, wynik wprost z src/sim, atrapa Upstash.
    say('\n[5/6] Wynik wprost z src/sim (Vite z kopii) i atrapa Upstash jako zwykły JS');
    const prep = await runWorker('prepare', { copy, tmp }, tmp, logs);
    if (prep.error) {
      record([verdict('prepare', 'przygotowanie: wersje i wynik z src/sim, atrapa Upstash', false, prep.error.slice(0, 600))]);
      return finish();
    }
    record([verdict('prepare', 'przygotowanie: wersje i wynik z src/sim, atrapa Upstash', Number.isInteger(prep.direct.score),
      `SIM_VERSION ${prep.direct.simVersion}, GENERATOR_VERSION ${prep.direct.generatorVersion}, koniec sezonu ${prep.direct.endMinute}, wynik biegu biernego (${SEED}) ${prep.direct.score}, odtworzenie wprost ${prep.direct.replayMs} ms`)]);

    // 6. Zbudowane funkcje.
    say('\n[6/6] Zbudowane funkcje wywołane zwykłym Node, z atrapą Upstash');
    const inv = await runWorker('invoke', {
      outputDir, atrapaFile: prep.atrapaFile, cliDir, simVersion: prep.direct.simVersion, generatorVersion: prep.direct.generatorVersion, expectedScore: prep.direct.score,
    }, tmp, logs);
    if (inv.error) {
      record([verdict('invoke', 'wywołanie zbudowanych funkcji', false, inv.error.slice(0, 800))]);
      return finish();
    }
    say(`  transport: ${inv.transport}`);
    record(inv.checks);
    Object.assign(facts, { timings: inv.timings, directScore: prep.direct.score });
  } catch (err) {
    stop({ id: 'unexpected', title: 'nieoczekiwany błąd skryptu' }, err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 400) : String(err));
  }
  return finish();

  function finish() {
    const failed = results.filter((c) => !c.ok);
    say('\n——— Podsumowanie ———');
    say(`Node ${facts.node} (${facts.platform}), Vercel CLI ${facts.cliVersion ?? cliVersion}${facts.typescript ? `, TypeScript ${facts.typescript}` : ''}`);
    if (facts.functionsCompiled !== undefined) say(`Funkcji skompilowanych w buildzie (linie „Using … TypeScript”): ${facts.functionsCompiled}`);
    for (const f of FUNCTIONS) {
      const info = facts.output?.functions?.[f.path];
      if (info) say(`  ${f.path}: ${kb(info.bytes)}, handler ${info.handler}, runtime ${info.runtime}, launcher ${info.launcher}`);
    }
    if (facts.output?.bundleBytes) say(`  bundle sędziego w runs.func: ${kb(facts.output.bundleBytes)}`);
    if (facts.timings?.coldHandlerMs !== undefined) {
      const t = facts.timings;
      say(`Czas odtworzenia 3 miesięcy w funkcji: zimny start ${t.coldHandlerMs} ms (z HTTP ${t.coldRoundTripMs} ms), ciepłe ${t.warmHandlerMs.join(', ')} ms (mediana ${t.warmMedianMs} ms); import 5 funkcji ${t.loadMs} ms`);
    }
    if (!process.version.startsWith('v24.')) say(`Uwaga: lokalny Node to ${process.version}, a projekt na Vercelu działa na Node 24.x (runtime funkcji nodejs24.x); build i wywołania szły na lokalnym.`);
    say(failed.length === 0 ? `\nWYNIK: PASS (${results.length} sprawdzeń)` : `\nWYNIK: FAIL (${failed.length} z ${results.length}): ${failed.map((c) => c.id).join(', ')}`);
    if (keep) say(`Katalog tymczasowy zostaje: ${tmp}`);
    else rmSync(tmp, { recursive: true, force: true });
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    return failed.length === 0 && results.length > 0 ? 0 : 1;
  }
}

/** Pliki o danej nazwie w drzewie katalogów (do sprawdzenia, że CLI nie zapisało logowania). */
function findFiles(dir, name) {
  const found = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === name) found.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return found;
}

/** Uruchamia ten sam plik jako proces roboczy (katalog roboczy poza kopią) i zwraca jego wynik albo `{ error }`. */
async function runWorker(name, input, tmp, logs) {
  const file = join(tmp, `worker-${name}.json`);
  writeFileSync(file, JSON.stringify(input));
  const logFile = join(logs, `worker-${name}.log`);
  const res = await runLogged(process.execPath, [SELF, '--worker', name, file], {
    cwd: tmp, env: cleanEnv(process.env, { HOME: join(tmp, 'home'), NODE_ENV: 'production' }), logFile, timeoutMs: 300_000,
  });
  const out = `${file}.out`;
  if (!existsSync(out)) return { error: `proces roboczy „${name}” nie zostawił wyniku (kod ${res.status}${res.timedOut ? ', przekroczono czas' : ''})\n${tail(readLog(logFile), 15)}` };
  const result = JSON.parse(readFileSync(out, 'utf8'));
  return result;
}

/** Punkt wejścia: argumenty → kod wyjścia. */
export async function cli(argv, say = console.log) {
  const args = parseArgs(argv);
  if (args.error) { say(`${args.error}\n${USAGE}`); return 2; }
  if (args.help) { say(USAGE); return 0; }
  if (args.worker) return workerMain(args.worker);
  return runCheck({ cliVersion: args.cliVersion, keep: args.keep, say });
}

// realpath po obu stronach: wywołanie przez dowiązanie symboliczne nie może po cichu pominąć sprawdzania (kod wyjścia 0 bez niczego)
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(SELF)) {
  process.exitCode = await cli(process.argv.slice(2));
}
