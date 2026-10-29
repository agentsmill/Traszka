import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildJudge } from '../scripts/build-judge.mjs';
import {
  cli, checkTarget, DATABASE_WARNING, newIdentity, parseArgs, PROTECTED_HOSTS, readGeneratorVersion, readSimVersion, runSmoke, SMOKE_LOG, STEPS, type RandomBytes,
} from '../scripts/ranking-smoke.mjs';
import { CROCKFORD, parseRecoveryCode } from '@/game/playerKey';
import { normalizeNick } from '@/game/nick';
import { RANKED_SEASON_END_MINUTE, seasonScore } from '@/sim/ranked';
import { replayRun } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { RATE_LIMITS } from '../src/server/config';
import { fakeUpstash, type FakeUpstash } from '../src/server/fakeUpstash';
import { route } from '../src/server/env';
import {
  handleLeaderboard, handlePlayer, handleRuns, handleSaveDownload, handleSaveUpload, type Handler,
} from '../src/server/http';
import { makeBundleVerifier } from '../src/server/judge';
import { MemoryRedis } from '../src/server/memoryRedis';
import { isShowableSeed } from '../src/server/runs';
import type { VerifyRun } from '../src/server/verify';

/**
 * Skrypt próby na prawdziwej bazie (scripts/ranking-smoke.mjs) uruchomiony tak, jak uruchomi go koordynator, tylko że adresem jest
 * lokalny serwer `node:http` na losowym porcie (127.0.0.1), który owija prawdziwe handlery rankingu (`handleRuns` i spółka z
 * src/server/http.ts) w `route(...)` z atrapą Upstash nad `MemoryRedis` i sędzią z prawdziwego bundla symulacji (zbudowanego do
 * katalogu tymczasowego, tak jak w tests/judgeBundle.test.ts). Nic nie wychodzi poza 127.0.0.1, a zmienne środowiskowe procesu
 * zostają nietknięte (`route` dostaje własne `env`).
 */
vi.setConfig({ testTimeout: 60_000 });   // sędzia odtwarza trzy miesiące gry w każdym biegu, a pliki testów idą równolegle

const ROOT = resolve(__dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'ranking-smoke.mjs');
const UPSTASH_URL = 'https://atrapa.upstash.test';
const TOKEN = 'atrapa-token-zapisu';

type Json = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
interface Sent { method: string; path: string; body: Json | undefined }
/**
 * Podmiana odpowiedzi serwera (kłamiący serwer): `nth` to numer żądania do tej ścieżki. `undefined` zostawia odpowiedź bez zmian,
 * `Response` zastępuje ją w całości (status, nagłówki, treść), a cokolwiek innego to nowe ciało JSON (status i nagłówki zostają).
 */
type Tamper = (path: string, body: Json, nth: number, request: Sent) => unknown;
interface TestServer {
  url: string;
  sent: Sent[];
  redis: MemoryRedis;
  upstash: FakeUpstash;
}

let dir: string;
let verifier: VerifyRun;
const open: Server[] = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'traszka-smoke-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
  const { file } = await buildJudge({ outDir: join(dir, 'out') });
  verifier = makeBundleVerifier(() => import(/* @vite-ignore */ pathToFileURL(file).href));
}, 60_000);
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise<void>((done) => { s.closeAllConnections(); s.close(() => done()); })));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const safeJson = (text: string): Json | undefined => {
  try { return JSON.parse(text) as Json; } catch { return undefined; }
};

async function listen(server: Server): Promise<string> {
  open.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Serwer rankingu na prawdziwych handlerach. `tamper` zmienia odpowiedzi, `redis` podmienia bazę (np. zepsutą). */
async function startServer(opts: { redis?: MemoryRedis; tamper?: Tamper } = {}): Promise<TestServer> {
  const redis = opts.redis ?? new MemoryRedis();
  const upstash = fakeUpstash(redis, UPSTASH_URL, { rw: TOKEN });
  const env = (): Record<string, string> => ({ RANKING_ENABLED: '1', KV_REST_API_URL: UPSTASH_URL, KV_REST_API_TOKEN: TOKEN });
  const wire = (handler: Handler, verifyRun?: VerifyRun): ((request: Request) => Promise<Response>) => route(handler, { env, fetch: upstash.fetch, verifyRun });
  const routes: Record<string, (request: Request) => Promise<Response>> = {
    'GET /api/leaderboard': wire(handleLeaderboard),
    'POST /api/runs': wire(handleRuns, verifier),
    'POST /api/player': wire(handlePlayer),
    'POST /api/save/upload': wire(handleSaveUpload),
    'POST /api/save/download': wire(handleSaveDownload),
  };
  const sent: Sent[] = [];
  const counts = new Map<string, number>();
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = req.method ?? 'GET';
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const text = Buffer.concat(chunks).toString('utf8');
      const entry: Sent = { method, path: url.pathname + url.search, body: text === '' ? undefined : safeJson(text) };
      sent.push(entry);
      const handler = routes[`${method} ${url.pathname}`];
      if (handler === undefined) { res.writeHead(404, { 'content-type': 'text/plain' }).end('nie ma'); return; }
      const request = new Request(`http://127.0.0.1${req.url}`, {
        method, headers: { 'content-type': 'application/json', 'x-real-ip': '127.0.0.1' }, body: method === 'GET' ? undefined : text,
      });
      const response = await handler(request);
      let body = await response.text();
      const count = (counts.get(`${method} ${url.pathname}`) ?? 0) + 1;
      counts.set(`${method} ${url.pathname}`, count);
      const replaced = opts.tamper?.(url.pathname + url.search, JSON.parse(body) as Json, count, entry);
      if (replaced instanceof Response) {
        res.writeHead(replaced.status, Object.fromEntries(replaced.headers)).end(await replaced.text());
        return;
      }
      if (replaced !== undefined) body = JSON.stringify(replaced);
      res.writeHead(response.status, Object.fromEntries(response.headers)).end(body);
    })().catch((err: unknown) => { res.writeHead(500).end(String(err)); });
  });
  return { url: await listen(server), sent, redis, upstash };
}

/** Serwer, który na każde żądanie odpowiada tym, co poda `reply` (do odpowiedzi śmieciowych i przekierowań). */
async function startReplyServer(reply: (request: { method: string; url: URL }) => Response): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    req.resume();
    void (async () => {
      const r = reply({ method: req.method ?? 'GET', url: new URL(req.url ?? '/', 'http://127.0.0.1') });
      res.writeHead(r.status, Object.fromEntries(r.headers)).end(await r.text());
    })();
  });
  return { url: await listen(server), hits: () => hits };
}

/** `fetch` dla testów: nic poza 127.0.0.1 nie przejdzie (regresja w odmowie nie może sięgnąć do sieci). */
const localFetch: typeof fetch = (input, init) => {
  const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
  if (host !== '127.0.0.1') throw new Error(`test dotknął sieci: ${host}`);
  return fetch(input, init);
};
const noNetwork = (): ReturnType<typeof vi.fn<typeof fetch>> => vi.fn<typeof fetch>(async () => { throw new Error('test: nic nie miało zostać wysłane'); });

/** Deterministyczna „losowość”: ten sam numer daje te same bajty (LCG), a kolejne wywołania w jednym strumieniu się różnią. */
function stream(n: number): RandomBytes {
  let c = Math.imul(n, 2654435761) >>> 0;
  return (len) => Uint8Array.from({ length: len }, () => { c = (Math.imul(c, 1103515245) + 12345) >>> 0; return (c >>> 16) & 255; });
}

const collect = (): { lines: string[]; log: (line: string) => void } => {
  const lines: string[] = [];
  return { lines, log: (line) => { lines.push(line); } };
};

/** Klucz gracza, który skrypt wysłał do serwera (pierwsze ciało z polem `key`). */
const keyOf = (server: TestServer): string => {
  const found = server.sent.find((s) => typeof s.body?.key === 'string');
  if (found?.body === undefined) throw new Error('serwer nie dostał żadnego klucza');
  return found.body.key as string;
};
const runBodies = (server: TestServer): Json[] => server.sent.filter((s) => s.path === '/api/runs').map((s) => s.body as Json);

/**
 * Żadnego fragmentu klucza dłuższego niż 7 znaków, więc najwyżej ostatnie 4 znaki. Łączniki nie ukrywają fragmentu: klucz
 * rozcięty w środku („XXXX-XXXX-XX”) liczy się po wycięciu łączników z wyjścia, tak jak jego zwarta postać.
 */
function expectNoKey(text: string, key: string): void {
  const compact = key.replaceAll('-', '');
  const bare = text.replaceAll('-', '');
  expect(text).not.toContain(key);
  for (let i = 0; i + 8 <= compact.length; i++) expect(bare).not.toContain(compact.slice(i, i + 8));
}

interface Cli { code: number | null; stdout: string; stderr: string }
/** Skrypt jako polecenie (osobny proces, asynchronicznie, bo lokalny serwer żyje w tym procesie). `preload` podmienia `fetch` na rzucający. */
function runCli(args: string[], opts: { blockNetwork?: boolean } = {}): Promise<Cli> {
  return new Promise((done, fail) => {
    const preload = join(dir, 'bez-sieci.mjs');
    if (opts.blockNetwork) writeFileSync(preload, "globalThis.fetch = async () => { throw new Error('test: sieć zablokowana'); };\n");
    const child = spawn(process.execPath, [...(opts.blockNetwork ? ['--import', pathToFileURL(preload).href] : []), SCRIPT, ...args], { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', fail);
    child.on('close', (code) => { done({ code, stdout, stderr }); });
  });
}

/** Wynik symulacji dla (seed, dziennik): ten sam kod co w bundlu sędziego, więc tak samo policzy go serwer. */
const scoreOf = (seed: string, log: readonly unknown[]): number =>
  seasonScore(replayRun({ seed, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, mode: 'ranked', log } as never, RANKED_SEASON_END_MINUTE));

/** Trzy domeny produkcyjne projektu na Vercelu (nazwa projektu, domena zespołu, domena gałęzi głównej). */
const PRODUCTION_DOMAINS = [
  'traszka.vercel.app',
  'traszka-mateuszs-projects-73382f2a.vercel.app',
  'traszka-git-main-mateuszs-projects-73382f2a.vercel.app',
] as const;

describe('odmowa dla produkcji (trzy domeny projektu i subdomeny traszka.vercel.app)', () => {
  // wszystkie trzy domeny w tych samych odmianach zapisu: schemat, wielkie litery, kropka na końcu, port, użytkownik, ścieżka
  const VARIANTS = PRODUCTION_DOMAINS.flatMap((d) => [
    `https://${d}`, `http://${d}/`, `https://${d.toUpperCase()}`, `https://${d}.`, `https://${d}:8443/x?y=1`, `https://uzytkownik:haslo@${d}`, `https://${d}/api/leaderboard`,
    `https://podglad.${d}`,   // ta sama reguła dla wszystkich trzech: dokładna nazwa albo jej subdomena
  ]);
  const PRODUCTION = [
    ...VARIANTS,
    'https://traszka.vercel.app', 'https://traszka.vercel.app/', 'http://traszka.vercel.app', 'https://TRASZKA.VERCEL.APP', 'https://Traszka.Vercel.App/api/leaderboard',
    'https://traszka.vercel.app.', 'https://traszka.vercel.app..', 'https://traszka.vercel.app\u{3002}',
    'https://traszka.vercel.app:443', 'https://traszka.vercel.app:8443/x?y=1',
    'https://uzytkownik@traszka.vercel.app', 'https://uzytkownik:haslo@traszka.vercel.app', 'https://przyklad.test@traszka.vercel.app', 'https://traszka.vercel.app\\@przyklad.test',
    'https://traszka%2Evercel.app', 'https://\u{ff54}raszka.vercel.app',
    'https://podglad.traszka.vercel.app', 'https://a.b.traszka.vercel.app.', 'https://PODGLAD.traszka.vercel.app:8443',
  ];

  it.each([...new Set(PRODUCTION)])('%s: odmowa, także z --write, i żadne żądanie nie wychodzi', async (baseUrl) => {
    for (const write of [true, false]) {
      const spy = noNetwork();
      const out = collect();
      const result = await runSmoke({ baseUrl, write, fetch: spy, log: out.log });
      expect(result).toMatchObject({ ok: false, refused: true, steps: [] });
      expect(result.error).toMatch(/Odmowa/);
      expect(PRODUCTION_DOMAINS.some((d) => result.error!.includes(d)), result.error).toBe(true);   // komunikat wskazuje chronioną domenę
      expect(result.error).not.toContain('haslo');   // adres może nieść hasło: komunikat go nie powtarza
      expect(spy).not.toHaveBeenCalled();
      expect(out.lines).toEqual([]);
    }
  });

  it.each([
    'https://nie-traszka.vercel.app', 'https://xtraszka.vercel.app', 'https://traszka-git-ranking-agentsmill.vercel.app', 'https://traszka.vercel.app.przyklad.test',
    'https://vercel.app', 'https://traszka.vercel.com', 'http://127.0.0.1:3000', 'http://localhost:3000', 'https://podglad-rankingu.vercel.app',
    'https://traszka-inna.vercel.app',                                                   // tylko podobna nazwa
    'https://traszka-mateuszs-projects-73382f2b.vercel.app',                              // domena zespołu z jedną różnicą w znaku
    'https://traszka-git-main-mateuszs-projects-73382f2a.vercel.com',                     // inna końcówka
    'https://traszka-git-main-mateuszs-projects-73382f2a.vercel.app.przyklad.test',       // produkcja tylko jako początek obcej domeny
    'https://traszka-git-claude-ranking-mateuszs-projects-73382f2a.vercel.app',           // wdrożenie podglądu gałęzi: po nazwie nie do odróżnienia, więc przechodzi (ostrzega plan)
  ])('%s: to nie produkcja, więc plan się wypisuje (bez --write nic nie jest wysyłane)', async (baseUrl) => {
    const spy = noNetwork();
    const result = await runSmoke({ baseUrl, write: false, fetch: spy, log: () => undefined });
    expect(result).toMatchObject({ ok: true, dryRun: true, steps: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['traszka.vercel.app', 'localhost:3000', 'ftp://127.0.0.1', 'nie adres', ''])('%j: to nie adres http(s), więc odmowa (zła składnia nie jest furtką)', async (baseUrl) => {
    const spy = noNetwork();
    const result = await runSmoke({ baseUrl, write: true, fetch: spy, log: () => undefined });
    expect(result).toMatchObject({ ok: false, refused: true, steps: [] });
    expect(spy).not.toHaveBeenCalled();
    expect(checkTarget(baseUrl).ok).toBe(false);
  });

  it('jako polecenie: kod 2, komunikat na stderr, nic na stdout, a sieć zablokowana nie jest nawet próbowana', async () => {
    const res = await runCli(['https://traszka.vercel.app', '--write'], { blockNetwork: true });
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Odmowa/);
    expect(res.stdout).toBe('');
    const sub = await runCli(['https://podglad.traszka.vercel.app/', '--write'], { blockNetwork: true });
    expect(sub.code).toBe(2);
    expect(sub.stderr).toMatch(/Odmowa/);
  });
});

describe('wiersz poleceń', () => {
  it('parseArgs: adres, --write i --sim-version (także w postaci --sim-version=n)', () => {
    expect(parseArgs(['http://127.0.0.1:3000'])).toEqual({ baseUrl: 'http://127.0.0.1:3000', write: false, simVersion: undefined, help: false });
    expect(parseArgs(['--write', 'http://127.0.0.1:3000', '--sim-version', '7'])).toMatchObject({ write: true, simVersion: 7 });
    expect(parseArgs(['http://127.0.0.1:3000', '--sim-version=0'])).toMatchObject({ simVersion: 0 });
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it.each([
    [[], 'brak adresu'],
    [['http://127.0.0.1:3000', 'drugi'], 'dwa adresy'],
    [['http://127.0.0.1:3000', '--zapisz'], 'nieznana flaga'],
    [['http://127.0.0.1:3000', '--sim-version'], 'brak liczby po --sim-version'],
    [['http://127.0.0.1:3000', '--sim-version', 'abc'], 'wersja nie jest liczbą'],
    [['http://127.0.0.1:3000', '--sim-version', '-1'], 'ujemna wersja'],
    [['http://127.0.0.1:3000', '--sim-version', '1.5'], 'wersja ułamkowa'],
  ] as [string[], string][])('parseArgs(%j) odrzuca: %s', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });

  it('jako polecenie: błędne argumenty to kod 2 z użyciem na stderr, --help to kod 0', async () => {
    const bad = await runCli([], { blockNetwork: true });
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/Użycie/);
    const flag = await runCli(['http://127.0.0.1:1', '--sim-version', 'x'], { blockNetwork: true });
    expect(flag.code).toBe(2);
    const help = await runCli(['--help'], { blockNetwork: true });
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/--write/);
  });

  it('cli(): kod wyjścia 0 dla planu i 2 dla odmowy (z wstrzykniętymi wyjściami, bez procesu)', async () => {
    const out = collect();
    const err = collect();
    const io = { out: out.log, err: err.log };
    const spy = noNetwork();
    vi.stubGlobal('fetch', spy);   // cli() bierze globalny fetch: regresja w odmowie nie może sięgnąć do produkcji
    try {
      expect(await cli(['http://127.0.0.1:3000'], io)).toBe(0);
      expect(out.lines.join('\n')).toMatch(/Bez --write/);
      expect(await cli(['https://traszka.vercel.app', '--write'], io)).toBe(2);
      expect(err.lines.join('\n')).toMatch(/Odmowa/);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('bez --write skrypt tylko opisuje plan', () => {
  it('serwer nie dostaje ani jednego żądania, a plan wymienia kroki i mówi, że nic nie poszło', async () => {
    const server = await startServer();
    const out = collect();
    const result = await runSmoke({ baseUrl: server.url, write: false, fetch: localFetch, log: out.log });
    expect(result).toEqual({ ok: true, dryRun: true, steps: [] });
    expect(server.sent).toEqual([]);
    expect(server.redis.calls).toBe(0);
    const text = out.lines.join('\n');
    expect(text).toMatch(/Bez --write/);
    expect(text).toMatch(/--write/);
    for (const step of STEPS) expect(text).toContain(step.name);
  });

  it('plan ostrzega, że skrypt zapisuje w bazie za adresem, a wdrożenie podglądu może wskazywać na produkcyjną bazę', async () => {
    const out = collect();
    await runSmoke({ baseUrl: 'http://127.0.0.1:3000', write: false, fetch: noNetwork(), log: out.log });
    expect(out.lines.join('\n')).toContain(DATABASE_WARNING);
    expect(out.lines.filter((l) => l.includes('baza TESTOWA'))).toHaveLength(1);   // jedna wyraźna linia
    expect(DATABASE_WARNING).toMatch(/rezerwacja nicka, wynik w rankingu, zapis gry/);
    expect(DATABASE_WARNING).toMatch(/baza TESTOWA/);
    expect(DATABASE_WARNING).toMatch(/`KV_\*` z ustawień Vercela/);
    expect(DATABASE_WARNING).toMatch(/produkcyjną bazę/);
  });

  it('ostrzeżenie jest też na początku właściwego przebiegu (przed pierwszym żądaniem), a jako polecenie bez --write na stdout', async () => {
    const server = await startServer();
    const out = collect();
    await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: out.log, simVersion: SIM_VERSION + 1 });
    expect(out.lines.slice(0, 3).join('\n')).toContain(DATABASE_WARNING);
    const res = await runCli([server.url]);
    expect(res.stdout).toContain(DATABASE_WARNING);
  });

  it('plan podaje liczbę zgłoszeń biegu policzoną z kroków (tyle, ile serwer naprawdę dostaje) i nie wpisuje limitu na stałe', async () => {
    const server = await startServer();
    const plan = collect();
    await runSmoke({ baseUrl: server.url, write: false, fetch: localFetch, log: plan.log });
    expect(await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined })).toMatchObject({ ok: true });
    const sent = runBodies(server).length;
    const text = plan.lines.join('\n');
    expect(text).toContain(`Zgłoszeń biegu jest ${sent},`);
    expect(text).toContain('RATE_LIMITS.runs');
    expect(text).not.toMatch(/obecnie\s+\d/);   // liczby limitu nie ma w tekście, więc nie rozjedzie się z konfiguracją
    // jeden przebieg nie może sam wyczerpać limitu klucza ani adresu (inaczej próba kończyłaby się 429 sama od siebie)
    expect(sent).toBeLessThanOrEqual(RATE_LIMITS.runs.perKey);
    expect(sent).toBeLessThanOrEqual(RATE_LIMITS.runs.perAddress);
  }, 60_000);

  it('jako polecenie bez --write: kod 0, plan na stdout, serwer bez żądań', async () => {
    const server = await startServer();
    const res = await runCli([server.url]);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/Bez --write/);
    expect(res.stdout).not.toMatch(/\bPASS\b|\bFAIL\b/);
    expect(server.sent).toEqual([]);
  });
});

describe('pełny przebieg na lokalnym serwerze ze sędzią z bundla', () => {
  it('wszystkie kroki PASS, a baza dostaje polecenia, których nie pokrywały testy na atrapie', async () => {
    const server = await startServer();
    const out = collect();
    const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: out.log });
    expect(result.steps.filter((s) => !s.ok)).toEqual([]);
    expect(result).toMatchObject({ ok: true });
    expect(result.steps.map((s) => s.id)).toEqual(STEPS.map((s) => s.id));
    expect(out.lines.filter((l) => /^\s*PASS\b/.test(l))).toHaveLength(STEPS.length);
    expect(out.lines.some((l) => /\bFAIL\b/.test(l))).toBe(false);

    const used = new Set(server.upstash.log.flatMap((l) => l.commands));
    for (const command of ['GET', 'SET', 'INCR', 'EXPIRE', 'PEXPIRE', 'ZADD', 'ZSCORE', 'ZCOUNT', 'ZREVRANGE', 'ZREMRANGEBYRANK', 'MGET', 'SMEMBERS', 'SADD']) {
      expect([command, used.has(command)]).toEqual([command, true]);
    }
    const keys = server.redis.keys();
    expect(keys.filter((k) => k.startsWith('tr:nick:smoke'))).toHaveLength(1);
    expect(keys.filter((k) => k.startsWith('tr:lb:week:'))).toHaveLength(1);
    expect(keys.filter((k) => k.startsWith('tr:lb:seed:'))).toHaveLength(2);   // seed próby i seed tygodnia
    expect(keys.filter((k) => k.startsWith('tr:save:'))).toHaveLength(1);
    expect(keys).toContain('tr:lb:global');
  }, 60_000);

  it('wysyła simVersion z src/sim/simVersion.ts i bieg w kształcie, jakiego wymaga serwer', async () => {
    const server = await startServer();
    const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
    expect(result.ok).toBe(true);
    const runs = runBodies(server);
    expect(runs).toHaveLength(5);   // A, B, ponowny gorszy, cudzy nick, seed tygodnia
    for (const r of runs) {
      expect(r.run).toMatchObject({ simVersion: SIM_VERSION, generatorVersion: GENERATOR_VERSION, mode: 'ranked' });
      expect(r.run.gameVersion.length).toBeLessThanOrEqual(100);
    }
    expect(readSimVersion()).toBe(SIM_VERSION);
    expect(readGeneratorVersion()).toBe(GENERATOR_VERSION);
  }, 60_000);

  it('jako polecenie: kod 0, PASS na każdy krok, a pełnego klucza gracza nie ma w żadnym wyjściu', async () => {
    const server = await startServer();
    const res = await runCli([server.url, '--write']);
    expect(res.stderr).toBe('');
    expect(res.code).toBe(0);
    expect(res.stdout.match(/^\s*PASS\b/gm)).toHaveLength(STEPS.length);
    expect(res.stdout).not.toMatch(/\bFAIL\b/);
    const key = keyOf(server);
    expectNoKey(res.stdout + res.stderr, key);
    expect(res.stdout).toContain(key.slice(-4));   // koordynator może go rozpoznać po ostatnich 4 znakach
  }, 60_000);

  it('klucz gracza: ani w planie, ani w przebiegu, ani w komunikacie błędu, który serwer odsyła z kluczem w środku', async () => {
    const server = await startServer({
      // serwer, który wkleja do komunikatu błędu całe ciało żądania (czyli klucz): skrypt ma go zamaskować także w FAIL
      tamper: (path, _body, nth, request) => (path === '/api/player' && nth === 1
        ? { ok: false, error: 'bad-request', message: JSON.stringify(request.body) } : undefined),
    });
    const out = collect();
    const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: out.log });
    expect(result).toMatchObject({ ok: false });
    expect(result.steps.at(-1)).toMatchObject({ id: 'gracz-nowy', ok: false });
    const key = keyOf(server);
    const everything = [...out.lines, result.steps.map((s) => s.error ?? '').join('\n')].join('\n');
    expect(everything).toMatch(/\bFAIL\b/);
    expect(everything).toContain('bad-request');   // komunikat serwera dociera do człowieka, tylko bez klucza
    expectNoKey(everything, key);
  });

  it('ponowne uruchomienie daje inne dane: nick, seed i klucz losowane za każdym razem', async () => {
    const server = await startServer();
    const identities: { key: string; nick: string; seed: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const before = server.sent.length;
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
      expect(result.ok).toBe(true);
      const first = server.sent.slice(before).find((s) => s.path === '/api/runs')!.body as Json;
      identities.push({ key: first.key as string, nick: first.nick as string, seed: first.run.seed as string });
    }
    expect(identities[0]!.key).not.toBe(identities[1]!.key);
    expect(identities[0]!.nick).not.toBe(identities[1]!.nick);
    expect(identities[0]!.seed).not.toBe(identities[1]!.seed);
    for (const id of identities) expect(id.seed).toMatch(/^smoke-[0-9a-f]{8}$/);
  }, 60_000);

  it('losowość pochodzi tylko z podanego źródła: ten sam strumień daje te same dane, inny inne', () => {
    expect(newIdentity(stream(1))).toEqual(newIdentity(stream(1)));
    expect(newIdentity(stream(1))).not.toEqual(newIdentity(stream(2)));
    const a = newIdentity(stream(3));
    expect(a.key).not.toBe(a.otherKey);
  });

  it.each([true, false])('gorszy wynik nie psuje najlepszego, także gdy bieg B jest lepszy od A: %s', async (better) => {
    let n = 1;
    for (; n < 400; n++) {
      const id = newIdentity(stream(n));
      if ((scoreOf(id.seed, SMOKE_LOG) > scoreOf(id.seed, [])) === better) break;
    }
    const server = await startServer();
    const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined, random: stream(n) });
    expect(result.steps.filter((s) => !s.ok)).toEqual([]);
    const [a, b, worse] = runBodies(server);
    expect(a!.run.log).toEqual([]);
    expect(b!.run.log).toEqual(SMOKE_LOG);
    expect(worse!.run.log).toEqual(better ? [] : SMOKE_LOG);   // ponawia ten bieg, który wypadł gorzej
  }, 60_000);
});

describe('identyfikatory próby', () => {
  it('klucz ma format kodu odzyskiwania i przechodzi parseRecoveryCode; alfabet jak w src/game/playerKey.ts', () => {
    const id = newIdentity();
    for (const key of [id.key, id.otherKey]) {
      expect(key).toMatch(/^([0-9A-Z]{4}-){4}[0-9A-Z]{4}$/);
      expect(parseRecoveryCode(key)).toBe(key.replaceAll('-', ''));
    }
    expect(id.key).not.toBe(id.otherKey);
    // wszystkie 32 znaki alfabetu, po kolei: bajty 0–19 i 12–31 (z każdego bajtu liczy się dolne 5 bitów)
    const alphabet = (offset: number): string => newIdentity((n) => Uint8Array.from({ length: n }, (_, i) => offset + (i % 20))).key.replaceAll('-', '');
    expect(alphabet(0)).toBe(CROCKFORD.slice(0, 20));
    expect(alphabet(12)).toBe(CROCKFORD.slice(12, 32));
  });

  it('nick to Smoke i cyfry (poprawny według reguł gry), a seed przejdzie sprawdzenie serwera', () => {
    for (let i = 0; i < 20; i++) {
      const id = newIdentity();
      expect(id.nick).toMatch(/^Smoke\d{6}$/);
      expect(normalizeNick(id.nick)).toEqual({ nick: id.nick });
      expect(id.seed).toMatch(/^smoke-[0-9a-f]{8}$/);
      expect(isShowableSeed(id.seed)).toBe(true);
    }
  });

  it('readSimVersion czyta liczbę z pliku tekstem, a brak eksportu to błąd', () => {
    const ok = join(dir, 'simVersion-7.ts');
    writeFileSync(ok, '// SIM_VERSION w komentarzu = 1\nexport const SIM_VERSION = 7;\n');
    expect(readSimVersion(ok)).toBe(7);
    const missing = join(dir, 'simVersion-brak.ts');
    writeFileSync(missing, 'export const INNA = 7;\n');
    expect(() => readSimVersion(missing)).toThrow(/SIM_VERSION/);
  });
});

describe('wersje symulacji i generatora', () => {
  it('skrypt czyta je z plików src/sim obok siebie, a nie ma ich wpisanych na stałe', async () => {
    // kopia skryptu w katalogu z własnym src/sim/simVersion.ts (inna wersja niż w repozytorium): serwer musi zobaczyć tę, a nie wersję stąd
    const fake = SIM_VERSION + 6;
    const copy = join(dir, 'kopia');
    mkdirSync(join(copy, 'scripts'), { recursive: true });
    mkdirSync(join(copy, 'src', 'sim', 'store'), { recursive: true });
    copyFileSync(SCRIPT, join(copy, 'scripts', 'ranking-smoke.mjs'));
    writeFileSync(join(copy, 'src', 'sim', 'simVersion.ts'), `// komentarz o SIM_VERSION = 1\nexport const SIM_VERSION = ${fake};\n`);
    writeFileSync(join(copy, 'src', 'sim', 'store', 'generateStore.ts'), `export const GENERATOR_VERSION: number = ${GENERATOR_VERSION};\n`);
    const server = await startServer();
    const res = await new Promise<Cli>((done, fail) => {
      const child = spawn(process.execPath, [join(copy, 'scripts', 'ranking-smoke.mjs'), server.url, '--write'], { cwd: copy });
      let stdout = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
      child.on('error', fail);
      child.on('close', (code) => { done({ code, stdout, stderr: '' }); });
    });
    expect(res.stdout).toContain(`symulacja v${fake}, generator v1`);
    expect(res.code).toBe(1);   // sędzia z tego repozytorium zna swoją wersję, więc odrzuca obcą
    expect(runBodies(server)[0]!.run).toMatchObject({ simVersion: fake, generatorVersion: 1 });
  });
});

describe('zła wersja symulacji (--sim-version)', () => {
  it('niezgodna simVersion kończy się porażką na kroku biegu (409 old-version), a do rankingu nic nie trafia', async () => {
    const server = await startServer();
    const out = collect();
    const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: out.log, simVersion: SIM_VERSION + 1 });
    expect(result.ok).toBe(false);
    const last = result.steps.at(-1)!;
    expect(last).toMatchObject({ id: 'bieg-a', ok: false });
    expect(last.error).toMatch(/409/);
    expect(last.error).toMatch(/old-version/);
    expect(result.steps.slice(0, -1).every((s) => s.ok)).toBe(true);
    expect(out.lines.join('\n')).toMatch(/FAIL/);
    expect(server.redis.keys().filter((k) => k.startsWith('tr:nick:') || k.startsWith('tr:lb:') || k.startsWith('tr:entry:'))).toEqual([]);
  });

  it('jako polecenie: --sim-version zmienia wysyłaną wersję i daje kod 1 z FAIL', async () => {
    const server = await startServer();
    const res = await runCli([server.url, '--write', '--sim-version', String(SIM_VERSION + 1)]);
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/FAIL/);
    expect(res.stdout).toMatch(/old-version/);
    expect(runBodies(server)[0]!.run.simVersion).toBe(SIM_VERSION + 1);
  });
});

describe('uszkodzone albo kłamiące odpowiedzi serwera dają FAIL', () => {
  const GARBAGE: [string, () => Response][] = [
    ['tekst zamiast JSON', () => new Response('to nie jest JSON', { status: 200 })],
    ['strona błędu HTML', () => new Response('<html><body>502</body></html>', { status: 502, headers: { 'content-type': 'text/html' } })],
    ['JSON bez pól', () => Response.json({ ok: true })],
    ['tablica zamiast obiektu', () => Response.json([])],
    ['ok:false z kodem serwera', () => Response.json({ ok: false, error: 'server', message: 'Coś poszło nie tak' }, { status: 500 })],
    ['status 200, ale ok:false', () => Response.json({ ok: false, error: 'server', message: 'Coś poszło nie tak' })],
    ['ranking w złym kształcie', () => Response.json({ ok: true, board: 'seed', rows: 'brak', week: {} })],
    ['wiersze bez wyników', () => Response.json({ ok: true, board: 'seed', rows: [{ rank: 1 }], week: { id: '2026-W44', seed: 'x-100', endsAt: 1 } })],
    ['odpowiedź bez ciała', () => new Response(null, { status: 204 })],
  ];

  it.each(GARBAGE)('%s: FAIL na pierwszym kroku i koniec (bez dalszych żądań)', async (_name, reply) => {
    const fetchSpy = vi.fn<typeof fetch>(async () => reply());
    const out = collect();
    const result = await runSmoke({ baseUrl: 'http://127.0.0.1:9', write: true, fetch: fetchSpy, log: out.log });
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ id: STEPS[0]!.id, ok: false });
    expect(result.steps[0]!.error).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out.lines.some((l) => /\bFAIL\b/.test(l))).toBe(true);
  });

  it('401 ze strony ochrony wdrożenia podglądu: FAIL z podpowiedzią o Deployment Protection', async () => {
    const result = await runSmoke({
      baseUrl: 'http://127.0.0.1:9', write: true, log: () => undefined,
      fetch: async () => new Response('<html>Authentication Required</html>', { status: 401, headers: { 'content-type': 'text/html' } }),
    });
    expect(result.ok).toBe(false);
    expect(result.steps[0]!.error).toMatch(/status 401/);
    expect(result.steps[0]!.error).toMatch(/Deployment Protection/);
  });

  it('brak połączenia (fetch rzuca) to FAIL, a nie wyjątek', async () => {
    const result = await runSmoke({
      baseUrl: 'http://127.0.0.1:9', write: true, log: () => undefined,
      fetch: async () => { throw new TypeError('fetch failed'); },
    });
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.error).toMatch(/fetch failed/);
  });

  describe('przyczyna błędu połączenia w komunikacie', () => {
    const failing = (cause: unknown): typeof fetch => async () => { throw new TypeError('fetch failed', { cause }); };
    const errorOf = async (fetchFn: typeof fetch): Promise<string> => {
      const result = await runSmoke({ baseUrl: 'http://127.0.0.1:9', write: true, log: () => undefined, fetch: fetchFn });
      expect(result.ok).toBe(false);
      return result.steps[0]!.error!;
    };

    it('przyczyna z komunikatem: pokazana w nawiasie', async () => {
      expect(await errorOf(failing(new Error('connect ECONNREFUSED 127.0.0.1:9')))).toMatch(/TypeError: fetch failed \(connect ECONNREFUSED 127\.0\.0\.1:9\)/);
    });

    it('AggregateError z pustym komunikatem (kilka adresów, np. localhost na ::1 i 127.0.0.1): komunikat pierwszego z błędów składowych, a nie puste „()”', async () => {
      const aggregate = Object.assign(new AggregateError([new Error('connect ECONNREFUSED ::1:9'), new Error('connect ECONNREFUSED 127.0.0.1:9')], ''), { code: 'ECONNREFUSED' });
      const error = await errorOf(failing(aggregate));
      expect(error).toMatch(/fetch failed \(connect ECONNREFUSED ::1:9\)/);
      expect(error).not.toContain('()');
    });

    it('AggregateError bez błędów składowych, za to z kodem: kod', async () => {
      const error = await errorOf(failing(Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' })));
      expect(error).toMatch(/fetch failed \(ECONNREFUSED\)/);
      expect(error).not.toContain('()');
    });

    it('przyczyna bez komunikatu, kodu i błędów składowych: bez pustych nawiasów', async () => {
      const error = await errorOf(failing(new Error('')));
      expect(error).toMatch(/TypeError: fetch failed$/);
      expect(error).not.toContain('()');
    });

    it('naprawdę zamknięty port na localhost (dwa adresy, więc AggregateError): w komunikacie ECONNREFUSED, a nie puste „()”', async () => {
      const closed = await startReplyServer(() => new Response('x'));
      const port = new URL(closed.url).port;
      await Promise.all(open.splice(0).map((srv) => new Promise<void>((done) => { srv.closeAllConnections(); srv.close(() => done()); })));
      const result = await runSmoke({ baseUrl: `http://localhost:${port}`, write: true, log: () => undefined });
      expect(result.ok).toBe(false);
      expect(result.steps[0]!.error).toMatch(/ECONNREFUSED/);
      expect(result.steps[0]!.error).not.toContain('()');
    });
  });

  it('przekierowanie: komunikat podpowiada o http zamiast https i o ochronie wdrożenia (Deployment Protection)', async () => {
    const redirecting = await startReplyServer(() => new Response(null, { status: 308, headers: { location: 'https://przyklad.test/api/leaderboard' } }));
    const result = await runSmoke({ baseUrl: redirecting.url, write: true, fetch: localFetch, log: () => undefined });
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    const error = result.steps[0]!.error!;
    expect(error).toMatch(/brak odpowiedzi/);
    expect(error).toMatch(/przekierowani/);
    expect(error).toMatch(/http:\/\/.*https:\/\//);
    expect(error).toMatch(/Deployment Protection/);
    expect(redirecting.hits()).toBe(1);
  });

  it('inny błąd połączenia nie dostaje podpowiedzi o przekierowaniu', async () => {
    const result = await runSmoke({
      baseUrl: 'http://127.0.0.1:9', write: true, log: () => undefined,
      fetch: async () => { throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:9') }); },
    });
    expect(result.steps[0]!.error).not.toMatch(/przekierowani|Deployment Protection/);
  });

  describe('429: limit zgłoszeń', () => {
    const limited = (retryAfter?: string): Response => new Response(
      JSON.stringify({ ok: false, error: 'rate-limited', message: 'Za dużo prób, spróbuj później.' }),
      { status: 429, headers: { 'content-type': 'application/json', ...(retryAfter === undefined ? {} : { 'retry-after': retryAfter }) } },
    );

    it('bieg zgłoszony ponad limit: osobny komunikat „limit zgłoszeń (godzinne okno), poczekaj N s” z Retry-After', async () => {
      const server = await startServer({ tamper: (path, _body, nth) => (path === '/api/runs' && nth === 1 ? limited('1234') : undefined) });
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
      expect(result.ok).toBe(false);
      expect(result.steps.at(-1)).toMatchObject({ id: 'bieg-a', ok: false });
      expect(result.steps.at(-1)!.error).toMatch(/status 429, limit zgłoszeń \(godzinne okno\), poczekaj 1234 s/);
      expect(result.steps.at(-1)!.error).toContain('rate-limited');   // dalej widać też kod i komunikat serwera
    });

    it('/api/player ma krótsze okno niż biegi i zapisy, więc komunikat nie mówi o godzinie', async () => {
      const server = await startServer({ tamper: (path, _body, nth) => (path === '/api/player' && nth === 1 ? limited('321') : undefined) });
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
      expect(result.steps.at(-1)).toMatchObject({ id: 'gracz-nowy', ok: false });
      expect(result.steps.at(-1)!.error).toMatch(/limit zgłoszeń \(krótkie okno\), poczekaj 321 s/);
      expect(result.steps.at(-1)!.error).not.toContain('godzinne');
    });

    it('bez nagłówka Retry-After (albo z nieliczbowym): komunikat mówi o jego braku, a nie o „NaN s”', async () => {
      for (const header of [undefined, 'jutro']) {
        const server = await startServer({ tamper: (path, _body, nth) => (path === '/api/runs' && nth === 1 ? limited(header) : undefined) });
        const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
        const error = result.steps.at(-1)!.error!;
        expect(error, String(header)).toMatch(/limit zgłoszeń \(godzinne okno\), brak poprawnego nagłówka Retry-After/);
        expect(error).not.toMatch(/NaN|undefined/);
      }
    });

    it('inne statusy nie dostają komunikatu o limicie', async () => {
      const server = await startServer({ tamper: (path, _body, nth) => (path === '/api/runs' && nth === 1 ? new Response(JSON.stringify({ ok: false, error: 'server', message: 'x' }), { status: 500, headers: { 'content-type': 'application/json' } }) : undefined) });
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
      expect(result.steps.at(-1)!.error).not.toMatch(/limit zgłoszeń/);
    });
  });

  describe('odczyt rankingu po zapisie: kolejny limit tylko przy odpowiedzi z pamięci podręcznej Vercela', () => {
    /** Przedpisana, nieaktualna odpowiedź rankingu globalnego z ustawionym nagłówkiem pamięci podręcznej (bez mojego wiersza). */
    const staleGlobal = (cache: string | undefined): Tamper => (path, body) => (path.endsWith('board=global&limit=100')
      ? new Response(JSON.stringify({ ...body, rows: [] }), { headers: { 'content-type': 'application/json', ...(cache === undefined ? {} : { 'x-vercel-cache': cache }) } })
      : undefined);
    const globalLimits = (server: TestServer): string[] => server.sent
      .filter((s) => s.path.startsWith('/api/leaderboard?board=global&'))
      .map((s) => /limit=(\d+)/.exec(s.path)![1]!);

    it.each(['HIT', 'STALE', 'hit'])('x-vercel-cache: %s bez mojego wiersza: skrypt prosi o następny limit (100, potem 50) i krok przechodzi', async (cache) => {
      const server = await startServer({ tamper: staleGlobal(cache) });
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
      expect(result.steps.filter((s) => !s.ok)).toEqual([]);
      expect(result.ok).toBe(true);
      expect(globalLimits(server)).toEqual(['10', '100', '50']);   // odczyt przed zapisem (10), nieaktualna z pamięci podręcznej (100), aktualna (50)
    });

    it.each([undefined, 'MISS', 'BYPASS', 'PRERENDER'])('x-vercel-cache: %s (odpowiedź prosto od funkcji) bez mojego wiersza: bez ponawiania, krok kończy się porażką', async (cache) => {
      const server = await startServer({ tamper: staleGlobal(cache) });
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
      expect(result.ok).toBe(false);
      expect(result.steps.at(-1)).toMatchObject({ id: 'global-po-biegach', ok: false });
      expect(result.steps.at(-1)!.error).toMatch(/nie ma wiersza/);
      expect(globalLimits(server)).toEqual(['10', '100']);   // żadnego ponowienia
    });

    it('odpowiedź z pamięci podręcznej, która ma mój wiersz, nie jest ponawiana', async () => {
      const server = await startServer({
        tamper: (path, body) => (path.endsWith('board=global&limit=100')
          ? new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'x-vercel-cache': 'HIT' } }) : undefined),
      });
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
      expect(result.ok).toBe(true);
      expect(globalLimits(server)).toEqual(['10', '100']);
    });
  });

  describe('klucz gracza w komunikatach o błędach serwera: maskowanie przed obcięciem tekstu', () => {
    const KEY_AT_CUT = (key: string): string => `${'x'.repeat(180)}${key}`;

    it('odpowiedź 200 z ok:false, której komunikat ma 180 znaków i dopiero potem klucz z żądania: w wyjściu ani fragmentu klucza dłuższego niż 7 znaków', async () => {
      const server = await startServer({
        tamper: (path, _body, nth, request) => (path === '/api/player' && nth === 1
          ? { ok: false, error: 'server', message: KEY_AT_CUT(request.body!.key as string) } : undefined),
      });
      const out = collect();
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: out.log });
      expect(result.steps.at(-1)).toMatchObject({ id: 'gracz-nowy', ok: false });
      const key = keyOf(server);
      const everything = [...out.lines, ...result.steps.map((s) => s.error ?? '')].join('\n');
      expect(everything).toContain('x'.repeat(100));   // komunikat serwera dociera do człowieka
      expectNoKey(everything, key);
      expect(everything).toContain(key.slice(-4));      // zamiast klucza zostają ostatnie 4 znaki
    });

    it.each([150, 170, 180, 190, 199])('klucz zaczyna się po %i znakach komunikatu: żaden fragment nie przechodzi, niezależnie od miejsca obcięcia', async (before) => {
      const server = await startServer({
        tamper: (path, _body, nth, request) => (path === '/api/player' && nth === 1
          ? { ok: false, error: 'server', message: `${'x'.repeat(before)}${request.body!.key as string}` } : undefined),
      });
      const out = collect();
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: out.log });
      expect(result.ok).toBe(false);
      expectNoKey([...out.lines, ...result.steps.map((s) => s.error ?? '')].join('\n'), keyOf(server));
    });

    it('odpowiedź, która nie jest JSON-em (strona błędu z kluczem po 100 znakach): fragment klucza nie zostaje w skróconym początku treści', async () => {
      const server = await startServer({
        tamper: (path, _body, nth, request) => (path === '/api/player' && nth === 1
          ? new Response(`<html>${'x'.repeat(100)}${request.body!.key as string}</html>`, { status: 502, headers: { 'content-type': 'text/html' } }) : undefined),
      });
      const out = collect();
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: out.log });
      expect(result.steps.at(-1)).toMatchObject({ id: 'gracz-nowy', ok: false });
      expect(result.steps.at(-1)!.error).toMatch(/status 502/);
      expectNoKey([...out.lines, ...result.steps.map((s) => s.error ?? '')].join('\n'), keyOf(server));
    });

    it('klucz w dowolnym miejscu komunikatu, także na granicy ostatecznego skrócenia linii: żaden fragment nie przechodzi (przesuwamy klucz co 2 znaki od 100 do 700)', async () => {
      let before = 0;
      let key = '';
      const server = await startServer({
        tamper: (path, _body, _nth, request) => {
          if (path !== '/api/player' || request.body?.nick !== undefined) return undefined;   // tylko pierwsze pytanie o nicki, bez nicka
          key = request.body!.key as string;
          return { ok: false, error: 'server', message: `${'x'.repeat(before)}${key}` };
        },
      });
      let cut = 0;
      for (before = 100; before <= 700; before += 2) {
        const out = collect();
        const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: out.log });
        expect(result.steps.at(-1), `przesunięcie ${before}`).toMatchObject({ id: 'gracz-nowy', ok: false });
        const everything = [...out.lines, ...result.steps.map((s) => s.error ?? '')].join('\n');
        expectNoKey(everything, key);
        if (everything.includes('…')) cut++;
      }
      expect(cut).toBeGreaterThan(100);   // test nie jest pusty: w większości przesunięć wyjście było skracane
    }, 60_000);

    it('komunikat jest nadal skracany: bardzo długa treść błędu nie zalewa wyjścia', async () => {
      const server = await startServer({
        tamper: (path, _body, nth) => (path === '/api/player' && nth === 1 ? { ok: false, error: 'server', message: 'y'.repeat(50_000) } : undefined),
      });
      const out = collect();
      const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: out.log });
      expect(result.steps.at(-1)!.error!.length).toBeLessThan(1_000);
      expect(Math.max(...out.lines.map((l) => l.length))).toBeLessThan(1_000);
    });
  });

  it('przekierowanie żądania z kluczem to porażka, a klucz nie jedzie pod inny adres', async () => {
    const elsewhere = await startReplyServer(() => Response.json({ ok: true, nicks: [] }));
    const redirecting = await startReplyServer(({ method, url }) => {
      if (method !== 'GET') return new Response(null, { status: 307, headers: { location: `${elsewhere.url}/api/player` } });
      const board = url.searchParams.get('board');
      const week = { id: '2026-W44', seed: 'pierogi-731', endsAt: 1_900_000_000_000 };
      return Response.json({ ok: true, board, ...(board === 'seed' ? { seed: url.searchParams.get('seed') } : board === 'week' ? { seed: week.seed } : {}), week, rows: [] });
    });
    const result = await runSmoke({ baseUrl: redirecting.url, write: true, fetch: localFetch, log: () => undefined });
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ id: 'gracz-nowy', ok: false });
    expect(result.steps.at(-1)!.error).toMatch(/brak odpowiedzi/);
    expect(elsewhere.hits()).toBe(0);
  });

  it('jako polecenie wobec serwera ze śmieciami: kod 1 i FAIL', async () => {
    const garbage = await startReplyServer(() => new Response('śmieci', { status: 200 }));
    const res = await runCli([garbage.url, '--write']);
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/FAIL/);
    expect(garbage.hits()).toBe(1);
  });

  // Serwer odpowiada 200 i poprawnym kształtem, ale jedna wartość kłamie: samo sprawdzenie kodu 200 tego nie wyłapie.
  const LIES: [string, Tamper, string][] = [
    ['bieg A: zła pozycja w rankingu seeda', (path, body, nth) => (path === '/api/runs' && nth === 1 ? { ...body, ranks: { ...body.ranks, seed: 2 } } : undefined), 'bieg-a'],
    ['bieg A: najlepszy wynik inny niż wynik biegu', (path, body, nth) => (path === '/api/runs' && nth === 1 ? { ...body, best: body.score + 1 } : undefined), 'bieg-a'],
    ['ranking seeda: wynik o 1 za wysoki', (path, body) => (path.includes('board=seed') && body.rows.length > 0
      ? { ...body, rows: body.rows.map((r: Json) => ({ ...r, score: r.score + 1 })) } : undefined), 'seed-po-biegu-a'],
    ['bieg B: improved odwrócone', (path, body, nth) => (path === '/api/runs' && nth === 2 ? { ...body, improved: !body.improved } : undefined), 'bieg-b'],
    ['ponowny gorszy bieg obniża najlepszy', (path, body, nth) => (path === '/api/runs' && nth === 3 ? { ...body, best: body.best - 1 } : undefined), 'bieg-gorszy'],
    ['cudzy klucz widzi nick jako wolny', (path, body, nth) => (path === '/api/player' && nth === 3 ? { ...body, nick: { ...body.nick, status: 'free' } } : undefined), 'nick-cudzy-gracz'],
    ['moje nicki: pusta lista', (path, body, nth) => (path === '/api/player' && nth === 4 ? { ...body, nicks: [] } : undefined), 'gracz-moj'],
    ['ranking globalny: zły seed najlepszego biegu', (path, body) => (path.includes('board=global') && !path.endsWith('limit=10')
      ? { ...body, rows: body.rows.map((r: Json) => ({ ...r, seed: 'inny-seed' })) } : undefined), 'global-po-biegach'],
    ['ranking tygodnia: wynik innego biegu', (path, body) => (path.includes('board=week') && !path.endsWith('limit=10')
      ? { ...body, rows: body.rows.map((r: Json) => ({ ...r, score: r.score + 5 })) } : undefined), 'tydzien-po-biegu'],
    ['wysłanie zapisu: zła liczba bajtów', (path, body) => (path === '/api/save/upload' ? { ...body, bytes: body.bytes + 1 } : undefined), 'zapis-wyslij'],
    ['pobranie zapisu: inna treść niż wysłana', (path, body, nth) => (path === '/api/save/download' && nth === 1 ? { ...body, save: `${body.save} ` } : undefined), 'zapis-pobierz'],
    ['pobranie zapisu: inna chwila zapisu', (path, body, nth) => (path === '/api/save/download' && nth === 1 ? { ...body, savedAt: body.savedAt + 1 } : undefined), 'zapis-pobierz'],
    ['cudzy klucz dostaje zapis', (path, _body, nth) => (path === '/api/save/download' && nth === 2 ? { ok: true, save: '{}', savedAt: 1 } : undefined), 'zapis-cudzy'],
  ];

  it.each(LIES)('%s: FAIL na właściwym kroku', async (_name, tamper, stepId) => {
    const server = await startServer({ tamper });
    const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ id: stepId, ok: false });
    expect(result.steps.slice(0, -1).every((s) => s.ok)).toBe(true);
  }, 60_000);

  it('baza bez GT w ZADD (nowy wynik nadpisuje najlepszy): porażka na kroku z gorszym biegiem', async () => {
    class OverwritingRedis extends MemoryRedis {
      override async exec(commands: Parameters<MemoryRedis['exec']>[0]): ReturnType<MemoryRedis['exec']> {
        return super.exec(commands.map((c) => (String(c[0]).toUpperCase() === 'ZADD' ? c.filter((arg) => arg !== 'GT') as unknown as typeof c : c)));
      }
    }
    const server = await startServer({ redis: new OverwritingRedis() });
    const result = await runSmoke({ baseUrl: server.url, write: true, fetch: localFetch, log: () => undefined });
    expect(result.ok).toBe(false);
    expect(['bieg-b', 'bieg-gorszy']).toContain(result.steps.at(-1)!.id);
  }, 60_000);
});

describe('skrypt jest bezpieczny z założenia (czytany jako tekst)', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('importuje tylko wbudowane moduły Node', () => {
    const specifiers = [...code.matchAll(/^\s*import\b[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.every((s) => s!.startsWith('node:'))).toBe(true);
    expect(code).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it('niczego nie zapisuje na dysku i nie czyta zmiennych środowiskowych (żadnych sekretów w skrypcie)', () => {
    expect(code).not.toMatch(/writeFile|appendFile|createWriteStream|mkdir|rename|unlink|rmSync|copyFile|truncate/);
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/Math\.random/);   // losowość tylko z crypto
  });

  it('ostrzeżenie o bazie testowej jest też w nagłówku skryptu (komentarz przed pierwszym importem)', () => {
    const header = source.slice(0, source.indexOf('\nimport '));
    expect(header).toMatch(/baza TESTOWA/);
    expect(header).toMatch(/`KV_\*`/);
  });
});

describe('lista chronionych hostów (PROTECTED_HOSTS)', () => {
  it('to dokładnie trzy domeny produkcyjne projektu, jako gołe nazwy hostów (małe litery, bez schematu, portu i kropki), bo dopasowanie jest po nazwie', () => {
    expect([...PROTECTED_HOSTS].sort()).toEqual([...PRODUCTION_DOMAINS].sort());
    for (const host of PROTECTED_HOSTS) expect(host).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/);
  });

  it.each(PRODUCTION_DOMAINS)('%s: odmowa podaje tę domenę, a nazwa z jedną literą więcej przechodzi', (domain) => {
    const refused = checkTarget(`https://${domain}`);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain(domain);
    expect(checkTarget(`https://x${domain}`).ok).toBe(true);
    expect(checkTarget(`https://${domain.replace('.vercel.app', '-inna.vercel.app')}`).ok).toBe(true);
  });
});
