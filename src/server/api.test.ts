import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as leaderboard } from '../../api/leaderboard';
import { POST as player } from '../../api/player';
import { POST as runs } from '../../api/runs';
import { POST as download } from '../../api/save/download';
import { POST as upload } from '../../api/save/upload';
import { KNOWN_GENERATOR_VERSIONS } from './config';
import { depsFromEnv, route } from './env';
import { API_ERRORS } from './errors';
import { fakeUpstash, type FakeUpstash } from './fakeUpstash';
import { handleRuns } from './http';
import { MemoryRedis } from './memoryRedis';
import { testBundle } from './testBundle';

/**
 * Pliki z `api/` tak, jak uruchomi je Vercel: zmienne środowiskowe (atrapy), a `fetch` do Upstash podmieniony na atrapę nad
 * `MemoryRedis`. Żadne zapytanie nie wychodzi do sieci, a wartości zmiennych są wymyślone na potrzeby testu.
 */
const URL_ = 'https://atrapa.upstash.test';
const RW = 'atrapa-token-zapisu';
const RO = 'atrapa-token-odczytu';
const KEY = 'K7QX-9MBD-2HFA-P3WN-8RTE';
const ORIGIN = 'https://traszka.test';

let redis: MemoryRedis;
let upstash: FakeUpstash;
let fetchSpy: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  redis = new MemoryRedis();
  upstash = fakeUpstash(redis, URL_, { rw: RW, ro: RO });
  fetchSpy = vi.fn<typeof fetch>(upstash.fetch);
  vi.stubEnv('RANKING_ENABLED', '1');
  vi.stubEnv('KV_REST_API_URL', URL_);
  vi.stubEnv('KV_REST_API_TOKEN', RW);
  vi.stubEnv('KV_REST_API_READ_ONLY_TOKEN', RO);
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const post = (path: string, body: unknown): Request => new Request(`${ORIGIN}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7' }, body: JSON.stringify(body),
});
const run = { seed: 'pierogi-731', gameVersion: '0.0.0+abc123def456', generatorVersion: KNOWN_GENERATOR_VERSIONS[0], simVersion: 1, mode: 'ranked', log: [] };

describe('api/** na Vercelu (atrapa Upstash przez fetch)', () => {
  it('ranking czyta tylko tokenem do odczytu', async () => {
    const res = await leaderboard(new Request(`${ORIGIN}/api/leaderboard?board=global`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, board: 'global', rows: [] });
    expect(upstash.log.length).toBeGreaterThan(0);
    expect(upstash.log.every((l) => l.token === 'ro')).toBe(true);
  });

  it('bez tokenu do odczytu ranking czyta zwykłym tokenem', async () => {
    vi.stubEnv('KV_REST_API_READ_ONLY_TOKEN', '');
    expect((await leaderboard(new Request(`${ORIGIN}/api/leaderboard`))).status).toBe(200);
    expect(upstash.log.every((l) => l.token === 'rw')).toBe(true);
  });

  it('zgłoszenie biegu przed scaleniem odtwarzania: 503 „sędzia się szkoli”, w bazie tylko liczniki limitu', async () => {
    const res = await runs(post('/api/runs', { key: KEY, nick: 'Mateusz', run }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: 'replay-unavailable' });
    expect(redis.keys().every((k) => k.startsWith('tr:rl:') || k.startsWith('tr:salt:'))).toBe(true);
  });

  it('z podpiętym sędzią (jak po scaleniu A) bieg trafia do rankingu, który widać przez api/leaderboard', async () => {
    const withJudge = route(handleRuns, { verifyRun: () => ({ ok: true, score: 12_345 }) });
    const res = await withJudge(post('/api/runs', { key: KEY, nick: 'Mateusz', run }));
    expect(await res.json()).toMatchObject({ ok: true, score: 12_345, ranks: { global: 1 } });
    const board = await (await leaderboard(new Request(`${ORIGIN}/api/leaderboard`))).json() as { rows: unknown[] };
    expect(board.rows).toEqual([{ rank: 1, nick: 'Mateusz', score: 12_345, seed: 'pierogi-731', at: expect.any(Number) }]);
    const me = await (await player(post('/api/player', { key: KEY, nick: 'Mateusz' }))).json();
    expect(me).toMatchObject({ ok: true, nicks: ['Mateusz'], nick: { status: 'mine' }, ranks: { global: { rank: 1, score: 12_345 } } });
  });

  it('zapis: wyślij i pobierz tym samym kodem; w bazie tylko zapis i liczniki, a nie obca treść', async () => {
    const save = testBundle();
    expect((await upload(post('/api/save/upload', { key: KEY, save }))).status).toBe(200);
    expect(await (await download(post('/api/save/download', { key: KEY.toLowerCase() }))).json()).toMatchObject({ ok: true, save });
    expect(redis.keys().every((k) => /^tr:(save|rl|salt|budget):/.test(k))).toBe(true);
  });

  it('zapis, który nie jest paczką z gry, nie trafia do bazy', async () => {
    const res = await upload(post('/api/save/upload', { key: KEY, save: JSON.stringify({ schema: 2, seed: 'pierogi-731' }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: 'bad-save' });
    expect(upstash.log).toEqual([]);
  });

  it('bez zmiennych środowiskowych: 503 „ranking jeszcze nie działa”, bez sięgania do bazy', async () => {
    vi.stubEnv('KV_REST_API_URL', '');
    const res = await leaderboard(new Request(`${ORIGIN}/api/leaderboard`));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: 'not-configured' });
    expect(upstash.log).toEqual([]);
  });

  it('baza nie odpowiada: 500 z ogólnym komunikatem, a log nie zdradza adresu ani tokenu', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError(`fetch failed ${URL_} ${RW}`); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await leaderboard(new Request(`${ORIGIN}/api/leaderboard`));
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    const logged = JSON.stringify(errors.mock.calls);
    for (const secret of [URL_, RW, RO, 'upstash.test']) {
      expect(body).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    errors.mockRestore();
  });
});

describe('wyłącznik RANKING_ENABLED: bez niego żaden endpoint nie dotyka bazy', () => {
  const OFF_MESSAGE = 'Ranking Centrali jeszcze nie ruszył.';
  const save = testBundle();
  /** Każdy z pięciu endpointów z żądaniem, które po włączeniu rankingu poszłoby prosto do bazy (limit zgłoszeń to pierwsze polecenie). */
  const endpoints: [string, () => Promise<Response>][] = [
    ['GET /api/leaderboard', () => leaderboard(new Request(`${ORIGIN}/api/leaderboard?board=global`))],
    ['POST /api/player', () => player(post('/api/player', { key: KEY, nick: 'Mateusz' }))],
    ['POST /api/runs', () => runs(post('/api/runs', { key: KEY, nick: 'Mateusz', run }))],
    ['POST /api/save/download', () => download(post('/api/save/download', { key: KEY }))],
    ['POST /api/save/upload', () => upload(post('/api/save/upload', { key: KEY, save }))],
  ];

  it('z ustawionymi KV_*, a bez RANKING_ENABLED: 503 ranking-off, bez cache i ani jednego fetch, dla każdego z pięciu endpointów', async () => {
    vi.stubEnv('RANKING_ENABLED', undefined);
    expect(endpoints).toHaveLength(5);
    for (const [name, call] of endpoints) {
      const res = await call();
      expect(res.status, name).toBe(503);
      expect(res.headers.get('cache-control'), name).toBe('no-store');
      expect(await res.json(), name).toEqual({ ok: false, error: 'ranking-off', message: OFF_MESSAGE });
    }
    expect(API_ERRORS['ranking-off']).toEqual({ status: 503, message: OFF_MESSAGE });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(upstash.log).toEqual([]);
    expect(redis.keys()).toEqual([]);
  });

  it('włącza tylko dokładnie „1”: pusta wartość, 0, true, tak i spacje wokół jedynki zostawiają ranking wyłączony', async () => {
    for (const value of ['', '0', 'true', 'TRUE', 'yes', 'tak', ' 1', '1 ', '01', '11']) {
      vi.stubEnv('RANKING_ENABLED', value);
      const res = await leaderboard(new Request(`${ORIGIN}/api/leaderboard`));
      expect(res.status, JSON.stringify(value)).toBe(503);
      expect((await res.json() as { error: string }).error, JSON.stringify(value)).toBe('ranking-off');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('wyłączony ranking wygrywa z brakiem bazy: bez RANKING_ENABLED i bez KV_* to też ranking-off, a nie not-configured', async () => {
    vi.stubEnv('RANKING_ENABLED', undefined);
    vi.stubEnv('KV_REST_API_URL', undefined);
    vi.stubEnv('KV_REST_API_TOKEN', undefined);
    const res = await leaderboard(new Request(`${ORIGIN}/api/leaderboard`));
    expect((await res.json() as { error: string }).error).toBe('ranking-off');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('włączony (RANKING_ENABLED=1): dotychczasowe zachowanie, a przełącznik jest czytany przy każdym wywołaniu', async () => {
    vi.stubEnv('RANKING_ENABLED', undefined);
    expect((await leaderboard(new Request(`${ORIGIN}/api/leaderboard`))).status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.stubEnv('RANKING_ENABLED', '1');
    const res = await leaderboard(new Request(`${ORIGIN}/api/leaderboard`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, board: 'global', rows: [] });
    expect(fetchSpy).toHaveBeenCalled();
    expect((await download(post('/api/save/download', { key: KEY }))).status).toBe(404);
  });

  it('żaden plik w api/ (także dopisany później) nie obchodzi wyłącznika: każdy eksportowany handler odpowiada ranking-off', async () => {
    vi.stubEnv('RANKING_ENABLED', undefined);
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
    });
    const found = files(resolve(__dirname, '../../api'));
    expect(found.length).toBeGreaterThanOrEqual(endpoints.length);
    for (const file of found) {
      const mod = await import(/* @vite-ignore */ file) as Record<string, unknown>;
      const methods = Object.keys(mod).filter((k) => /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(k));
      expect(methods.length, `${file}: brak eksportowanego handlera`).toBeGreaterThan(0);
      for (const method of methods) {
        const hasBody = method !== 'GET' && method !== 'HEAD';
        const req = new Request(`${ORIGIN}/api/x`, hasBody
          ? { method, headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7' }, body: JSON.stringify({ key: KEY, nick: 'Mateusz', run, save }) }
          : { method });
        const res = await (mod[method] as (r: Request) => Promise<Response>)(req);
        expect(res.status, `${file} ${method}`).toBe(503);
        expect((await res.json() as { error: string }).error, `${file} ${method}`).toBe('ranking-off');
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('depsFromEnv bez RANKING_ENABLED nie buduje klienta bazy, choć zmienne Upstash są (druga warstwa obok route)', () => {
    const env = { KV_REST_API_URL: URL_, KV_REST_API_TOKEN: RW, KV_REST_API_READ_ONLY_TOKEN: RO };
    expect(depsFromEnv(env)).toBeNull();
    expect(depsFromEnv({ ...env, RANKING_ENABLED: '1' })).not.toBeNull();
  });
});
