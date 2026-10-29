import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeBuildLog, BUNDLE_IN_FUNC, checkOutput, cleanEnv, cli, cliEnv, copyFiles, DEFAULT_CLI_VERSION, FUNCTIONS, isCopied, isTransientFailure,
  listRepoFiles, newPlayerKey, parseArgs, VERCEL_ARGS,
} from '../scripts/check-vercel-build.mjs';
import { parseRecoveryCode } from '@/game/playerKey';
import { RANKED_SEASON_END_MINUTE, seasonScore } from '@/sim/ranked';
import { replayRun } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';

/**
 * Skrypt `scripts/check-vercel-build.mjs` to ręczne sprawdzenie `vercel build` (potrzebuje sieci do npm i trwa pół minuty), więc
 * `npm test` nie puszcza całości. Tu są jego części, które da się sprawdzić bez sieci: argumenty, co trafia do kopii, środowisko
 * dla CLI Vercela (izolowany HOME, bez sekretów), ocena logu i wyjścia `.vercel/output` (z mutacjami: każdy warunek ma przypadek,
 * w którym skrypt ma zgłosić porażkę) i proces roboczy liczący wynik wprost z `src/sim`.
 */
const ROOT = resolve(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'check-vercel-build.mjs');

let dir: string;
let n = 0;
const fresh = (): string => { const d = join(dir, `t${n++}`); mkdirSync(d, { recursive: true }); return d; };
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'traszka-checkvb-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const put = (root: string, rel: string, text: string | Buffer = 'x'): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const failing = (checks: { id: string; ok: boolean }[]): string[] => checks.filter((c) => !c.ok).map((c) => c.id);

describe('argumenty', () => {
  it('bez argumentów: wersja CLI z domyślnej, katalog tymczasowy do usunięcia', () => {
    expect(parseArgs([])).toEqual({ cliVersion: DEFAULT_CLI_VERSION, keep: false, help: false });
  });

  it('--keep zostawia katalog, --cli-version przyjmuje wersję w obu zapisach (też „latest”), --help prosi o opis', () => {
    expect(parseArgs(['--keep']).keep).toBe(true);
    expect(parseArgs(['--cli-version', '66.0.1']).cliVersion).toBe('66.0.1');
    expect(parseArgs(['--cli-version=latest']).cliVersion).toBe('latest');
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('brak wersji po --cli-version, wersja z obcymi znakami i nieznany argument to błąd (wersja trafia do polecenia npm)', () => {
    for (const argv of [['--cli-version'], ['--cli-version', ''], ['--cli-version', '1.0.0;rm -rf /'], ['--cli-version=../x'], ['--cli-version', '--keep'], ['--deploy'], ['build']]) {
      expect(parseArgs(argv).error, argv.join(' ')).toEqual(expect.any(String));
    }
  });

  it('cli: zły argument to kod 2 z opisem użycia, --help to kod 0 (nic nie jest budowane)', async () => {
    const lines: string[] = [];
    expect(await cli(['--zly'], (l) => lines.push(l))).toBe(2);
    expect(lines.join('\n')).toContain('Użycie: node scripts/check-vercel-build.mjs');
    lines.length = 0;
    expect(await cli(['--help'], (l) => lines.push(l))).toBe(0);
    expect(lines.join('\n')).toContain('--keep');
  });
});

describe('kopia repozytorium', () => {
  it('pomija zależności, historię, katalogi narzędzi, wyjście budowania, łącze z projektem Vercela i wygenerowany bundle sędziego', () => {
    for (const rel of [
      'node_modules/vite/index.js', 'scripts/node_modules/x.js', '.git/HEAD', '.claude/worktrees/a/package.json', '.claude/launch.json',
      '.superpowers/sdd/plan.md', 'dist/index.html', '.vercel/project.json', '.vercel/output/config.json', 'src/server/judgeBundle.js',
    ]) {
      expect(isCopied(rel), rel).toBe(false);
    }
  });

  it('bierze kod, konfigurację, testy, skrypty i zasoby (nazwy podobne do wykluczonych nie są wykluczane)', () => {
    for (const rel of [
      'api/runs.ts', 'src/server/judge.ts', 'src/server/judgeBundle.d.ts', 'package.json', 'package-lock.json', 'vercel.json', 'tsconfig.json',
      'scripts/build-judge.mjs', 'tests/judgeBundle.test.ts', 'public/assets/x.glb', 'src/distance.ts', 'src/distribution/a.ts', 'docs/dist-notes.md',
      '.gitignore', '.github/workflows/ci.yml',
    ]) {
      expect(isCopied(rel), rel).toBe(true);
    }
  });

  it('listRepoFiles: pliki śledzone i nowe nieignorowane są, ignorowane, wygenerowane i usunięte z dysku nie; copyFiles zachowuje układ i treść', () => {
    const repo = fresh();
    const git = (...args: string[]): void => { expect(spawnSync('git', args, { cwd: repo }).status, args.join(' ')).toBe(0); };
    git('init', '-q');
    const ignore = 'ignorowany.txt\nsrc/server/judgeBundle.js\n';
    put(repo, '.gitignore', ignore);
    put(repo, 'sledzony.ts', 'a');
    put(repo, 'api/runs.ts', 'b');
    put(repo, 'usuniety.ts', 'c');
    git('add', '.gitignore', 'sledzony.ts', 'api/runs.ts', 'usuniety.ts');
    rmSync(join(repo, 'usuniety.ts'));
    put(repo, 'nowy/plik.ts', 'd');
    put(repo, 'ignorowany.txt', 'e');
    put(repo, 'src/server/judgeBundle.js', 'f');
    put(repo, 'node_modules/p/index.js', 'g');
    const files = listRepoFiles(repo);
    expect(files).toEqual(['.gitignore', 'api/runs.ts', 'nowy/plik.ts', 'sledzony.ts']);
    const dest = fresh();
    expect(copyFiles(repo, dest, files)).toBe(ignore.length + 3);   // .gitignore i trzy pliki po jednym bajcie
    expect(readFileSync(join(dest, 'nowy/plik.ts'), 'utf8')).toBe('d');
    expect(existsSync(join(dest, 'usuniety.ts'))).toBe(false);
    expect(existsSync(join(dest, 'src/server/judgeBundle.js'))).toBe(false);
  });
});

describe('środowisko procesów potomnych', () => {
  const real = {
    PATH: '/usr/bin', HOME: '/Users/ktos', LANG: 'pl_PL.UTF-8', TMPDIR: '/tmp/x', HTTPS_PROXY: 'http://proxy:3128',
    VERCEL_TOKEN: 'vercel-tajny', VERCEL_ORG_ID: 'team_prawdziwy', KV_REST_API_URL: 'https://prawdziwa-baza', KV_REST_API_TOKEN: 'baza-tajny',
    RANKING_ENABLED: '1', RANKING_SALT: 'sol-tajna', NPM_TOKEN: 'npm-tajny', GITHUB_TOKEN: 'gh-tajny', AWS_SECRET_ACCESS_KEY: 'aws-tajny',
  };

  it('cleanEnv przepuszcza tylko dozwolone zmienne (ścieżka, język, proxy), a tokeny, VERCEL_*, KV_* i RANKING_* odcina', () => {
    const env = cleanEnv(real, { HOME: '/izolowany' });
    expect(env).toEqual({ PATH: '/usr/bin', LANG: 'pl_PL.UTF-8', TMPDIR: '/tmp/x', HTTPS_PROXY: 'http://proxy:3128', HOME: '/izolowany' });
  });

  it('CLI Vercela dostaje izolowany HOME i XDG w nim, brak telemetrii i aktualizacji, i żadnego sekretu z otoczenia', () => {
    const home = '/tmp/izolowany-home';
    const env = cliEnv(real, home);
    expect(env.HOME).toBe(home);
    for (const dir of [env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME]) expect(dir?.startsWith(`${home}/`), String(dir)).toBe(true);
    expect(env).toMatchObject({ VERCEL_TELEMETRY_DISABLED: '1', NO_UPDATE_NOTIFIER: '1', CI: '1' });
    expect(JSON.stringify(env)).not.toMatch(/tajny|prawdziwa|prawdziwy|ktos|team_/);
    expect(Object.keys(env).filter((k) => /TOKEN|SALT|^KV_|^RANKING_|SECRET/.test(k))).toEqual([]);
  });

  it('jedynym poleceniem CLI jest „build”, a kod skryptu nie ma ani --yes, ani deploy, link, pull, login, env, dev, --prod', () => {
    expect([...VERCEL_ARGS]).toEqual(['build']);
    const code = readFileSync(SCRIPT, 'utf8').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
    for (const forbidden of ['--yes', '-y', '--prod', 'deploy', 'link', 'pull', 'login', 'env', 'dev', 'logout', '--token']) {
      expect(code.includes(`'${forbidden}'`) || code.includes(`"${forbidden}"`), forbidden).toBe(false);
    }
  });
});

describe('ocena logu vercel build', () => {
  // Skrót prawdziwego logu `vercel build` 65.7.0 (kolory ANSI wycięte w teście niżej): każda linia istotna dla wniosków.
  const GOOD = [
    'Vercel CLI 65.7.0',
    'WARNING! Build not running on Vercel. System environment variables will not be available.',
    'Installing dependencies...',
    'Running "npm run build"',
    '> traszka-tycoon@0.0.0 build',
    '> npm run build:judge && tsc --noEmit && vite build',
    'Bundle sędziego: /tmp/x/repo/src/server/judgeBundle.js (103.0 KB)',
    'vite v8.3.5 building client environment for production...',
    '✓ built in 503ms',
    'Using TypeScript 7.0.2 (local user-provided)',
    'Using the TypeScript 7.0.2 compiler executable for transpilation.',
    'Using TypeScript 7.0.2 (local user-provided)',
    'Using the TypeScript 7.0.2 compiler executable for transpilation.',
    'Build Completed in .vercel/output [5s]',
  ];
  const analyze = (lines: string[]) => analyzeBuildLog(lines.join('\n'));

  it('dobry log: build uruchomił npm run build, build:judge poszedł pierwszy, build zakończony; fakty: wersje i liczba skompilowanych funkcji', () => {
    const { checks, facts } = analyze(GOOD);
    expect(failing(checks)).toEqual([]);
    expect(facts).toEqual({ functionsCompiled: 2, typescript: '7.0.2', cliVersion: '65.7.0' });
  });

  it('kolory ANSI w logu (Vite) nie przeszkadzają', () => {
    const colored = GOOD.map((l) => (l.startsWith('vite v') ? `\u{1B}[36m${l.replace('building', '\u{1B}[32mbuilding')}\u{1B}[39m` : l));
    expect(failing(analyze(colored).checks)).toEqual([]);
  });

  it('bez „Running "npm run build"” (np. nadpisana komenda budowania) to porażka kroku npm-run-build', () => {
    expect(failing(analyze(GOOD.filter((l) => !l.startsWith('Running "npm run build"'))).checks)).toEqual(['npm-run-build']);
  });

  it('bez linii bundla sędziego (build:judge nie poszedł) to porażka kroku judge-first', () => {
    expect(failing(analyze(GOOD.filter((l) => !l.startsWith('Bundle sędziego'))).checks)).toEqual(['judge-first']);
  });

  it('bundle zbudowany po kompilacji funkcji albo po Vite to porażka kroku judge-first', () => {
    const judge = GOOD.find((l) => l.startsWith('Bundle sędziego'))!;
    const rest = GOOD.filter((l) => l !== judge);
    const afterVite = [...rest.slice(0, rest.indexOf('✓ built in 503ms') + 1), judge, ...rest.slice(rest.indexOf('✓ built in 503ms') + 1)];
    expect(failing(analyze(afterVite).checks)).toEqual(['judge-first']);
    expect(failing(analyze([...rest.slice(0, -1), judge, rest.at(-1)!]).checks)).toEqual(['judge-first']);
  });

  it('bez „Build Completed” to porażka kroku build-completed', () => {
    expect(failing(analyze(GOOD.slice(0, -1)).checks)).toEqual(['build-completed']);
  });
});

describe('chwilowe błędy sieci w vercel build', () => {
  it('„Request failed” bez reszty logu (CLI nie pobrało builderów) i błędy połączenia to chwilowa awaria, którą skrypt ponawia', () => {
    for (const log of [
      'Vercel CLI 65.7.0\nWARNING! Build not running on Vercel.\nError: [BUILD_FAILED] Request failed\n',
      'Error: getaddrinfo ENOTFOUND registry.npmjs.org', 'Error: connect ETIMEDOUT 104.16.0.1:443', 'TypeError: fetch failed', 'read ECONNRESET',
    ]) {
      expect(isTransientFailure(log), log).toBe(true);
    }
  });

  it('prawdziwe błędy budowania (typy, brak pliku, kod npm) nie są ponawiane, żeby nie ukrywać porażek', () => {
    for (const log of [
      'Running "npm run build"\nsrc/server/runs.ts(3,1): error TS2307: Cannot find module\nError: Command "npm run build" exited with 2',
      'Error: No existing credentials found. Please run `vercel login`.', 'Error: [BUILD_FAILED] Build failed',
    ]) {
      expect(isTransientFailure(log), log).toBe(false);
    }
  });
});

describe('ocena wyjścia .vercel/output', () => {
  const BUNDLE = Buffer.alloc(20_000, 'a');

  /** Prawidłowe wyjście: pięć funkcji z konfiguracją i plikiem wejściowym, bundle w runs.func taki jak w kopii, index.html gry. */
  function validOutput(): { output: string; copy: string } {
    const root = fresh();
    const output = join(root, 'output');
    const copy = join(root, 'repo');
    for (const f of FUNCTIONS) {
      put(output, `functions/${f.dir}/.vc-config.json`, JSON.stringify({ handler: f.file, runtime: 'nodejs24.x', launcherType: 'Nodejs' }));
      put(output, `functions/${f.dir}/${f.file}`, 'export const POST = () => {};');
    }
    put(output, `functions/${FUNCTIONS[0]!.dir}/${BUNDLE_IN_FUNC}`, BUNDLE);
    put(output, 'static/index.html', '<!doctype html>');
    put(copy, BUNDLE_IN_FUNC, BUNDLE);
    return { output, copy };
  }

  it('prawidłowe wyjście przechodzi, a fakty niosą rozmiary, handler i runtime', () => {
    const { output, copy } = validOutput();
    const { checks, facts } = checkOutput(output, copy);
    expect(failing(checks)).toEqual([]);
    expect(facts.bundleBytes).toBe(20_000);
    expect(facts.functions['/api/runs']).toMatchObject({ handler: 'api/runs.js', runtime: 'nodejs24.x', launcher: 'Nodejs' });
    expect(facts.functions['/api/runs']!.bytes).toBeGreaterThan(20_000);
  });

  it('brak bundla sędziego w runs.func (pominięty build:judge) to porażka kroku bundle-in-func z nazwą pliku', () => {
    const { output, copy } = validOutput();
    rmSync(join(output, 'functions', FUNCTIONS[0]!.dir, BUNDLE_IN_FUNC));
    const { checks } = checkOutput(output, copy);
    expect(failing(checks)).toEqual(['bundle-in-func']);
    expect(checks.find((c) => c.id === 'bundle-in-func')!.detail).toContain(BUNDLE_IN_FUNC);
  });

  it('bundle w funkcji inny niż zbudowany w kopii albo za mały (np. pusty plik) to porażka kroku bundle-in-func', () => {
    const other = validOutput();
    writeFileSync(join(other.output, 'functions', FUNCTIONS[0]!.dir, BUNDLE_IN_FUNC), Buffer.alloc(20_000, 'b'));
    expect(failing(checkOutput(other.output, other.copy).checks)).toEqual(['bundle-in-func']);
    const tiny = validOutput();
    writeFileSync(join(tiny.output, 'functions', FUNCTIONS[0]!.dir, BUNDLE_IN_FUNC), 'x');
    writeFileSync(join(tiny.copy, BUNDLE_IN_FUNC), 'x');
    expect(failing(checkOutput(tiny.output, tiny.copy).checks)).toEqual(['bundle-in-func']);
  });

  it('build:judge, który nie zostawił pliku w kopii, to porażka kroku bundle-in-func (nie ma z czym porównać)', () => {
    const { output, copy } = validOutput();
    rmSync(join(copy, BUNDLE_IN_FUNC));
    expect(failing(checkOutput(output, copy).checks)).toEqual(['bundle-in-func']);
  });

  it('brakująca funkcja, brak pliku wejściowego albo konfiguracja nie-JSON to porażka kroku functions', () => {
    const noDir = validOutput();
    rmSync(join(noDir.output, 'functions', 'api/player.func'), { recursive: true });
    const noFile = validOutput();
    rmSync(join(noFile.output, 'functions', 'api/leaderboard.func/api/leaderboard.js'));
    const notJson = validOutput();
    writeFileSync(join(notJson.output, 'functions', 'api/save/upload.func/.vc-config.json'), '{');
    for (const { output, copy } of [noDir, noFile, notJson]) expect(failing(checkOutput(output, copy).checks)).toEqual(['functions']);
  });

  it('brak static/index.html (build gry nie powstał) to porażka kroku static-index', () => {
    const { output, copy } = validOutput();
    rmSync(join(output, 'static'), { recursive: true });
    expect(failing(checkOutput(output, copy).checks)).toEqual(['static-index']);
  });
});

describe('dane próby', () => {
  it('klucz gracza ma format kodu odzyskiwania i jest rozpoznawany przez grę; kolejne są różne', () => {
    const key = newPlayerKey();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
    expect(parseRecoveryCode(key)).toBe(key.replaceAll('-', ''));
    expect(newPlayerKey()).not.toBe(key);
  });

  it('losowość pochodzi z podanego źródła (bajt → znak z dolnych 5 bitów)', () => {
    expect(newPlayerKey((count) => new Uint8Array(count))).toBe('0000-0000-0000-0000-0000');
    expect(newPlayerKey((count) => new Uint8Array(count).fill(31))).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  });
});

describe('proces roboczy prepare (na repozytorium zamiast kopii)', () => {
  it('liczy wynik biernego biegu wprost z src/sim (Vite) i zamienia atrapę Upstash w zwykły plik JS', async () => {
    const work = fresh();
    const input = join(work, 'prepare.json');
    writeFileSync(input, JSON.stringify({ copy: ROOT, tmp: work }));
    const res = spawnSync(process.execPath, [SCRIPT, '--worker', 'prepare', input], { cwd: work, encoding: 'utf8' });
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    const out = JSON.parse(readFileSync(`${input}.out`, 'utf8')) as {
      direct: { simVersion: number; generatorVersion: number; endMinute: number; score: number };
      atrapaFile: string;
    };
    const expected = seasonScore(replayRun({ seed: 'kiełbasa-42', gameVersion: 'x', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log: [] }, RANKED_SEASON_END_MINUTE));
    expect(out.direct).toMatchObject({ simVersion: SIM_VERSION, generatorVersion: GENERATOR_VERSION, endMinute: RANKED_SEASON_END_MINUTE, score: expected });
    const atrapa = await import(/* @vite-ignore */ pathToFileURL(out.atrapaFile).href) as Record<string, unknown>;
    expect(Object.keys(atrapa).sort()).toEqual(['MemoryRedis', 'fakeUpstash']);
    expect(readFileSync(out.atrapaFile, 'utf8')).not.toMatch(/^\s*import\b/m);
  }, 60_000);

  it('wejście, którego nie da się wykonać (zła ścieżka kopii), kończy się błędem zapisanym obok wejścia, a nie zawieszeniem', () => {
    const work = fresh();
    const input = join(work, 'prepare.json');
    writeFileSync(input, JSON.stringify({ copy: join(work, 'nie-ma-takiej-kopii'), tmp: work }));
    const res = spawnSync(process.execPath, [SCRIPT, '--worker', 'prepare', input], { cwd: work, encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect((JSON.parse(readFileSync(`${input}.out`, 'utf8')) as { error: string }).error).toEqual(expect.any(String));
  });
});
