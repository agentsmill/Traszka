import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as leaderboard } from '../../api/leaderboard';
import { POST as player } from '../../api/player';
import { POST as runs } from '../../api/runs';
import { POST as download } from '../../api/save/download';
import { POST as upload } from '../../api/save/upload';
import { KNOWN_GAME_VERSIONS, KNOWN_GENERATOR_VERSIONS } from './config';
import { route } from './env';
import { fakeUpstash, type FakeUpstash } from './fakeUpstash';
import { handleRuns } from './http';
import { MemoryRedis } from './memoryRedis';

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
beforeEach(() => {
  redis = new MemoryRedis();
  upstash = fakeUpstash(redis, URL_, { rw: RW, ro: RO });
  vi.stubEnv('KV_REST_API_URL', URL_);
  vi.stubEnv('KV_REST_API_TOKEN', RW);
  vi.stubEnv('KV_REST_API_READ_ONLY_TOKEN', RO);
  vi.stubGlobal('fetch', upstash.fetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const post = (path: string, body: unknown): Request => new Request(`${ORIGIN}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7' }, body: JSON.stringify(body),
});
const run = { seed: 'pierogi-731', gameVersion: KNOWN_GAME_VERSIONS[0], generatorVersion: KNOWN_GENERATOR_VERSIONS[0], mode: 'ranked', log: [] };

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

  it('zapis: wyślij i pobierz tym samym kodem', async () => {
    const save = JSON.stringify({ schema: 2, seed: 'pierogi-731' });
    expect((await upload(post('/api/save/upload', { key: KEY, save }))).status).toBe(200);
    expect(await (await download(post('/api/save/download', { key: KEY.toLowerCase() }))).json()).toMatchObject({ ok: true, save });
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
