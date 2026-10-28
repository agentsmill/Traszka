import { describe, expect, it, vi } from 'vitest';
import { formatRecoveryCode } from '@/game/playerKey';
import { API_ERRORS } from './errors';
import { KNOWN_GAME_VERSIONS, KNOWN_GENERATOR_VERSIONS, RATE_LIMITS, SAVE_MAX_BYTES } from './config';
import {
  clientAddress, handleLeaderboard, handlePlayer, handleRuns, handleSaveDownload, handleSaveUpload, type ServerDeps,
} from './http';
import { MemoryRedis } from './memoryRedis';
import type { RunRecord } from './runs';
import { replayNotAvailable, type VerifyResult } from './verify';
import { weekOf } from './week';

const NOW = Date.UTC(2026, 9, 28, 12);
const KEY_A = 'K7QX9MBD2HFAP3WN8RTE';
const KEY_B = 'M2N3P4Q5R6S7T8V9W0XY';
const ORIGIN = 'https://traszka.test';

function setup(verdict: VerifyResult | ((run: RunRecord) => VerifyResult) = { ok: true, score: 25_000 }) {
  const clock = { now: NOW };
  const redis = new MemoryRedis(() => clock.now);
  const verifyRun = vi.fn((run: RunRecord) => (typeof verdict === 'function' ? verdict(run) : verdict));
  const deps: ServerDeps = { redis, readRedis: redis, verifyRun, now: () => clock.now };
  return { clock, redis, deps, verifyRun };
}

const run = (seed = 'pierogi-731'): RunRecord => ({
  seed, gameVersion: KNOWN_GAME_VERSIONS[0]!, generatorVersion: KNOWN_GENERATOR_VERSIONS[0]!, mode: 'ranked',
  log: [{ minute: 400, seq: 0, cmd: { type: 'tapTill' } }],
});
const post = (path: string, body: unknown, headers: Record<string, string> = {}): Request => new Request(`${ORIGIN}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const get = (path: string): Request => new Request(`${ORIGIN}${path}`);
const submit = (deps: ServerDeps, key: string, nick: string, seed?: string, headers?: Record<string, string>) =>
  handleRuns(post('/api/runs', { key: formatRecoveryCode(key), nick, run: run(seed) }, headers), deps);
const body = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;

describe('POST /api/runs: zgłoszenie biegu', () => {
  it('przyjęty bieg: wynik policzony przez sędziego (serwer), nick zarezerwowany, miejsca w rankingach', async () => {
    const { deps, verifyRun } = setup();
    const res = await submit(deps, KEY_A, ' Mateusz ');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await body(res)).toEqual({ ok: true, nick: 'Mateusz', score: 25_000, best: 25_000, improved: true, ranks: { global: 1, seed: 1, week: null } });
    expect(verifyRun).toHaveBeenCalledWith(run());
  });

  it('ten sam nick z innym kluczem: 409 „Ten nick jest zajęty”, a sędzia nawet nie odtwarza biegu', async () => {
    const { deps, verifyRun } = setup();
    await submit(deps, KEY_A, 'Mateusz');
    verifyRun.mockClear();
    const res = await submit(deps, KEY_B, 'MATEUSZ');
    expect(res.status).toBe(409);
    expect(await body(res)).toEqual({ ok: false, error: 'nick-taken', message: 'Ten nick jest zajęty' });
    expect(verifyRun).not.toHaveBeenCalled();
    expect((await submit(deps, KEY_A, 'mateusz')).status).toBe(200);
  });

  it('do czasu scalenia odtwarzania (domyślny sędzia): 503 z komunikatem, a w bazie nie ma ani nicka, ani wyniku', async () => {
    const { deps, redis } = setup();
    const res = await submit({ ...deps, verifyRun: replayNotAvailable }, KEY_A, 'Mateusz');
    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({ ok: false, error: 'replay-unavailable', message: API_ERRORS['replay-unavailable'].message });
    expect(redis.keys().filter((k) => !k.startsWith('tr:rl:') && !k.startsWith('tr:salt:'))).toEqual([]);
  });

  it('odrzucenia sędziego: niepełny sezon 422, nieudane odtworzenie 422', async () => {
    expect((await submit(setup({ ok: false, reason: 'season-incomplete' }).deps, KEY_A, 'Ala')).status).toBe(422);
    const failed = await submit(setup({ ok: false, reason: 'replay-failed' }).deps, KEY_A, 'Ala');
    expect(failed.status).toBe(422);
    expect((await body(failed)).error).toBe('replay-failed');
  });

  it('seed tygodnia trafia też do rankingu tygodnia; seed z zakazanym słowem do globalnego bez seeda', async () => {
    const week = weekOf(NOW);
    const { deps } = setup((r) => ({ ok: true, score: r.seed === week.seed ? 30_000 : 20_000 }));
    expect((await body(await submit(deps, KEY_A, 'Ala', week.seed))).ranks).toEqual({ global: 1, seed: 1, week: 1 });
    expect((await body(await submit(deps, KEY_B, 'Ola', 'kurwa-mać'))).ranks).toEqual({ global: 2, seed: null, week: null });
    const rows = (await body(await handleLeaderboard(get('/api/leaderboard'), deps))).rows as { nick: string; seed: unknown }[];
    expect(rows.map((r) => [r.nick, r.seed])).toEqual([['Ala', week.seed], ['Ola', null]]);
  });

  it('złe zgłoszenia: 400 z kodem i komunikatem (zły nick dostaje komunikat z reguł nicka), 413 za duże, 405 nie POST', async () => {
    const { deps } = setup();
    const cases: [Request, number, string][] = [
      [post('/api/runs', 'to nie JSON'), 400, 'bad-request'],
      [post('/api/runs', { key: KEY_A, nick: 'Centrala', run: run() }), 400, 'bad-nick'],
      [post('/api/runs', { key: 'zły', nick: 'Ala', run: run() }), 400, 'bad-key'],
      [post('/api/runs', { key: KEY_A, nick: 'Ala', run: { ...run(), gameVersion: '0.0.1-stara' } }), 409, 'old-version'],
      [post('/api/runs', `{"x":"${'a'.repeat(4_000_000)}"}`), 413, 'too-large'],
      [get('/api/runs'), 405, 'method'],
    ];
    for (const [req, status, error] of cases) {
      const res = await handleRuns(req, deps);
      expect(res.status, error).toBe(status);
      expect((await body(res)).error, error).toBe(error);
    }
    const reserved = await handleRuns(post('/api/runs', { key: KEY_A, nick: 'Centrala', run: run() }), deps);
    expect((await body(reserved)).message).toBe('Ta nazwa jest zarezerwowana');
  });

  it('limit zgłoszeń na klucz: 429 z nagłówkiem Retry-After', async () => {
    const { deps } = setup();
    for (let i = 0; i < RATE_LIMITS.runs.perKey; i++) {
      expect((await submit(deps, KEY_A, 'Ala', undefined, { 'x-real-ip': `10.0.0.${i}` })).status).toBe(200);
    }
    const res = await submit(deps, KEY_A, 'Ala', undefined, { 'x-real-ip': '10.0.0.99' });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('GET /api/leaderboard', () => {
  it('ranking globalny z seedem tygodnia w odpowiedzi i krótką pamięcią podręczną Vercela', async () => {
    const { deps, clock } = setup();
    await submit(deps, KEY_A, 'Ala');
    const res = await handleLeaderboard(get('/api/leaderboard?board=global&limit=5'), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('s-maxage=');
    const week = weekOf(clock.now);
    expect(await body(res)).toEqual({
      ok: true, board: 'global', week: { id: week.id, seed: week.seed, endsAt: week.endsAt },
      rows: [{ rank: 1, nick: 'Ala', score: 25_000, seed: 'pierogi-731', at: NOW }],
    });
  });

  it('ranking seeda (seed w parametrze) i tygodnia; zły ranking albo seed: 400', async () => {
    const { deps } = setup();
    const week = weekOf(NOW);
    await submit(deps, KEY_A, 'Ala', week.seed);
    await submit(deps, KEY_B, 'Ola', 'bigos-111');
    const seedRes = await body(await handleLeaderboard(get('/api/leaderboard?board=seed&seed=bigos-111'), deps));
    expect(seedRes).toMatchObject({ board: 'seed', seed: 'bigos-111', rows: [{ rank: 1, nick: 'Ola', score: 25_000 }] });
    const weekRes = await body(await handleLeaderboard(get('/api/leaderboard?board=week'), deps));
    expect(weekRes).toMatchObject({ board: 'week', seed: week.seed, rows: [{ rank: 1, nick: 'Ala', score: 25_000 }] });
    expect((await handleLeaderboard(get('/api/leaderboard?board=miasto'), deps)).status).toBe(400);
    expect((await handleLeaderboard(get('/api/leaderboard?board=seed'), deps)).status).toBe(400);
    expect((await handleLeaderboard(get(`/api/leaderboard?board=seed&seed=${encodeURIComponent('a‮b')}`), deps)).status).toBe(400);
    expect((await handleLeaderboard(post('/api/leaderboard', {}), deps)).status).toBe(405);
  });

  it('limit wierszy przycięty do 1…100, a śmieci w parametrze to domyślne 20', async () => {
    const { deps } = setup();
    for (const q of ['limit=0', 'limit=1000', 'limit=abc', 'limit=-5']) {
      expect((await handleLeaderboard(get(`/api/leaderboard?${q}`), deps)).status, q).toBe(200);
    }
  });
});

describe('POST /api/player: moje nicki i miejsca (po wpisaniu kodu, przed sezonem)', () => {
  it('nicki tego klucza, status wpisanego nicka i miejsca, gdy nick jest mój', async () => {
    const { deps } = setup();
    await submit(deps, KEY_A, 'Mateusz', 'bigos-111');
    const mine = await body(await handlePlayer(post('/api/player', { key: KEY_A, nick: 'mateusz', seed: 'bigos-111' }), deps));
    expect(mine).toEqual({
      ok: true, nicks: ['Mateusz'], nick: { nick: 'mateusz', status: 'mine' },
      ranks: { global: { rank: 1, score: 25_000 }, seed: { rank: 1, score: 25_000 }, week: null },
    });
    const other = await body(await handlePlayer(post('/api/player', { key: KEY_B, nick: 'Mateusz' }), deps));
    expect(other).toEqual({ ok: true, nicks: [], nick: { nick: 'Mateusz', status: 'taken', message: 'Ten nick jest zajęty' } });
    expect(await body(await handlePlayer(post('/api/player', { key: KEY_B, nick: 'Kasia' }), deps)))
      .toEqual({ ok: true, nicks: [], nick: { nick: 'Kasia', status: 'free' } });
    expect(await body(await handlePlayer(post('/api/player', { key: KEY_B }), deps))).toEqual({ ok: true, nicks: [] });
  });

  it('zły i zakazany nick: status z komunikatem; zły klucz: 400', async () => {
    const { deps } = setup();
    expect((await body(await handlePlayer(post('/api/player', { key: KEY_A, nick: 'Admin' }), deps))).nick)
      .toEqual({ nick: 'Admin', status: 'invalid', message: 'Ta nazwa jest zarezerwowana' });
    expect((await body(await handlePlayer(post('/api/player', { key: KEY_A, nick: 'Kurwiszon' }), deps))).nick)
      .toEqual({ nick: 'Kurwiszon', status: 'banned', message: API_ERRORS['banned-nick'].message });
    expect((await handlePlayer(post('/api/player', { key: 'abc' }), deps)).status).toBe(400);
    expect((await handlePlayer(post('/api/player', { nick: 'Ala' }), deps)).status).toBe(400);
  });
});

describe('POST /api/save/upload i /api/save/download: zapis kodem odzyskiwania', () => {
  it('wysłany zapis wraca na drugim urządzeniu z tym samym kodem; inny kod nie ma zapisu (404)', async () => {
    const { deps } = setup();
    const save = JSON.stringify({ schema: 2, seed: 'pierogi-731' });
    const up = await handleSaveUpload(post('/api/save/upload', { key: KEY_A, save }), deps);
    expect(up.status).toBe(200);
    expect(await body(up)).toEqual({ ok: true, bytes: save.length, savedAt: NOW });
    const down = await handleSaveDownload(post('/api/save/download', { key: formatRecoveryCode(KEY_A).toLowerCase() }), deps);
    expect(await body(down)).toEqual({ ok: true, save, savedAt: NOW });
    const none = await handleSaveDownload(post('/api/save/download', { key: KEY_B }), deps);
    expect(none.status).toBe(404);
    expect((await body(none)).error).toBe('no-save');
  });

  it('za duży zapis 413, nie-JSON 400, zły klucz 400', async () => {
    const { deps } = setup();
    const big = JSON.stringify({ x: 'a'.repeat(SAVE_MAX_BYTES) });
    expect((await handleSaveUpload(post('/api/save/upload', { key: KEY_A, save: big }), deps)).status).toBe(413);
    expect((await handleSaveUpload(post('/api/save/upload', { key: KEY_A, save: 'zapis' }), deps)).status).toBe(400);
    expect((await handleSaveUpload(post('/api/save/upload', { key: 'abc', save: '{}' }), deps)).status).toBe(400);
  });
});

describe('adres klienta', () => {
  it('x-real-ip, potem pierwszy z x-vercel-forwarded-for i x-forwarded-for; bez nagłówków „nieznany”', () => {
    const req = (h: Record<string, string>) => new Request(ORIGIN, { headers: h });
    expect(clientAddress(req({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('1.1.1.1');
    expect(clientAddress(req({ 'x-vercel-forwarded-for': '3.3.3.3, 4.4.4.4' }))).toBe('3.3.3.3');
    expect(clientAddress(req({ 'x-forwarded-for': ' 5.5.5.5 , 6.6.6.6' }))).toBe('5.5.5.5');
    expect(clientAddress(req({}))).toBe('nieznany');
  });
});
