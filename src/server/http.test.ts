import { describe, expect, it, vi } from 'vitest';
import { CROCKFORD, formatRecoveryCode } from '@/game/playerKey';
import type { RunRecord } from '@/sim/run';
import { API_ERRORS } from './errors';
import {
  BOARD_LIMIT_DEFAULT, BOARD_LIMIT_MAX, BOARD_LIMITS, KNOWN_GENERATOR_VERSIONS, RATE_LIMITS, RUN_MAX_BODY_BYTES,
  SAVE_BODY_BYTES, SAVE_BUNDLE_FORMAT, SAVE_DAILY_BUDGET, SAVE_MAX_BYTES, SMALL_BODY_BYTES, type RateAction,
} from './config';
import {
  clientAddress, handleLeaderboard, handlePlayer, handleRuns, handleSaveDownload, handleSaveUpload, type ServerDeps,
} from './http';
import { KEYS, ownerOf } from './keys';
import { MemoryRedis } from './memoryRedis';
import { createRateGate } from './rateLimit';
import { run as runCommand } from './redis';
import { testBundle } from './testBundle';
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
  seed, gameVersion: '0.0.0+abc123def456', generatorVersion: KNOWN_GENERATOR_VERSIONS[0]!, simVersion: 1, mode: 'ranked',
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

  it('nieudane odtworzenie: 422 i nic w rankingu', async () => {
    const failed = await submit(setup({ ok: false, reason: 'replay-failed' }).deps, KEY_A, 'Ala');
    expect(failed.status).toBe(422);
    expect((await body(failed)).error).toBe('replay-failed');
  });

  it('sędzia odrzuca bieg z innej wersji symulacji (old-version): 409 z prośbą o odświeżenie strony, a w bazie nie ma ani nicka, ani wyniku', async () => {
    const { deps, redis, verifyRun } = setup({ ok: false, reason: 'old-version' });
    const res = await submit(deps, KEY_A, 'Mateusz');
    expect(res.status).toBe(409);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const answer = await body(res);
    expect(answer).toEqual({ ok: false, error: 'old-version', message: API_ERRORS['old-version'].message });
    expect(answer.message).toContain('Odśwież stronę');
    expect(verifyRun).toHaveBeenCalledTimes(1);
    expect(verifyRun).toHaveBeenCalledWith(run());
    // ani rezerwacji nicka, ani wpisu w żadnym rankingu (zostają tylko liczniki limitu zgłoszeń)
    expect(redis.keys().filter((k) => !k.startsWith('tr:rl:') && !k.startsWith('tr:salt:'))).toEqual([]);
    expect(await body(await handlePlayer(post('/api/player', { key: KEY_B, nick: 'Mateusz' }), deps))).toEqual({ ok: true, nicks: [], nick: { nick: 'Mateusz', status: 'free' } });
    expect((await body(await handleLeaderboard(get('/api/leaderboard'), deps))).rows).toEqual([]);
  });

  it('bieg zakończony bankructwem (season-bankrupt): 422 z komunikatem, a w bazie nie ma ani nicka, ani wyniku', async () => {
    const { deps, redis } = setup({ ok: false, reason: 'season-bankrupt' });
    const res = await submit(deps, KEY_A, 'Mateusz');
    expect(res.status).toBe(422);
    expect(await body(res)).toEqual({ ok: false, error: 'season-bankrupt', message: 'Sezon zakończony bankructwem nie trafia do rankingu.' });
    expect(redis.keys().filter((k) => !k.startsWith('tr:rl:') && !k.startsWith('tr:salt:'))).toEqual([]);
    expect(await body(await handlePlayer(post('/api/player', { key: KEY_B, nick: 'Mateusz' }), deps))).toEqual({ ok: true, nicks: [], nick: { nick: 'Mateusz', status: 'free' } });
    expect((await body(await handleLeaderboard(get('/api/leaderboard'), deps))).rows).toEqual([]);
  });

  it('każda odmowa sędziego ma swój kod i status: old-version 409, replay-failed 422, season-bankrupt 422, replay-unavailable 503', async () => {
    const reasons = { 'old-version': 409, 'replay-failed': 422, 'season-bankrupt': 422, 'replay-unavailable': 503 } as const;
    for (const [reason, status] of Object.entries(reasons) as [keyof typeof reasons, number][]) {
      const res = await submit(setup({ ok: false, reason }).deps, KEY_A, 'Ala');
      expect([reason, res.status]).toEqual([reason, status]);
      expect((await body(res)).error).toBe(reason);
    }
  });

  it('bieg bez simVersion (z gry sprzed tej reguły) to 409 old-version już w parserze: sędzia nie jest wołany, w bazie nic nie przybywa', async () => {
    const { deps, redis, verifyRun } = setup();
    const { simVersion: _brak, ...stary } = run();
    const res = await handleRuns(post('/api/runs', { key: KEY_A, nick: 'Ala', run: stary }), deps);
    expect(res.status).toBe(409);
    expect(await body(res)).toEqual({ ok: false, error: 'old-version', message: API_ERRORS['old-version'].message });
    expect(verifyRun).not.toHaveBeenCalled();
    expect(redis.keys()).toEqual([]);
  });

  it('wersja gry w biegu (z commitem, „test”, dowolny napis do 100 znaków) nie rozstrzyga o przyjęciu: bieg trafia do sędziego', async () => {
    const { deps, verifyRun } = setup();
    for (const [i, gameVersion] of ['0.0.0+abc123def456', 'test', '0.0.1-stara'].entries()) {
      const res = await handleRuns(post('/api/runs', { key: KEY_A, nick: `Gracz${i}`.slice(0, 20), run: { ...run(), gameVersion } }, { 'x-real-ip': `10.0.0.${i}` }), deps);
      expect(res.status, gameVersion).toBe(200);
    }
    expect(verifyRun.mock.calls.map(([r]) => r.gameVersion)).toEqual(['0.0.0+abc123def456', 'test', '0.0.1-stara']);
  });

  it('seed tygodnia trafia też do rankingu tygodnia; wulgarny seed i nick przechodzą jak każde inne (filtra słów nie ma)', async () => {
    const week = weekOf(NOW);
    const { deps } = setup((r) => ({ ok: true, score: r.seed === week.seed ? 30_000 : 20_000 }));
    expect((await body(await submit(deps, KEY_A, 'Ala', week.seed))).ranks).toEqual({ global: 1, seed: 1, week: 1 });
    expect((await body(await submit(deps, KEY_B, 'Kurwiszon', 'kurwa-mać'))).ranks).toEqual({ global: 2, seed: 1, week: null });
    const rows = (await body(await handleLeaderboard(get('/api/leaderboard'), deps))).rows as { nick: string; seed: unknown }[];
    expect(rows.map((r) => [r.nick, r.seed])).toEqual([['Ala', week.seed], ['Kurwiszon', 'kurwa-mać']]);
    const seedRows = (await body(await handleLeaderboard(get(`/api/leaderboard?board=seed&seed=${encodeURIComponent('kurwa-mać')}`), deps))).rows;
    expect(seedRows).toEqual([{ rank: 1, nick: 'Kurwiszon', score: 20_000 }]);
  });

  it('do rankingu tygodnia wpada tylko seed tygodnia i jego sąsiednie lokale seed·1…5; inny sufiks po „·” liczy się tylko jako zwykły seed', async () => {
    const week = weekOf(NOW);
    const { deps } = setup();
    expect((await body(await submit(deps, KEY_A, 'Ala', `${week.seed}·3`))).ranks).toEqual({ global: 1, seed: 1, week: 1 });
    for (const [i, suffix] of ['·abc', '·6', '·10', '·', '·0'].entries()) {
      const res = await body(await submit(deps, `B${i}`.padEnd(20, '7'), `Gracz${i}`, `${week.seed}${suffix}`, { 'x-real-ip': `10.0.0.${i}` }));
      expect(res.ranks, suffix).toEqual({ global: 1, seed: 1, week: null });
    }
    const weekRows = (await body(await handleLeaderboard(get('/api/leaderboard?board=week'), deps))).rows as { nick: string }[];
    expect(weekRows.map((r) => r.nick)).toEqual(['Ala']);
  });

  it('złe zgłoszenia: 400 z kodem i komunikatem (zły nick dostaje komunikat z reguł nicka), 413 za duże, 405 nie POST', async () => {
    const { deps } = setup();
    const cases: [Request, number, string][] = [
      [post('/api/runs', 'to nie JSON'), 400, 'bad-request'],
      [post('/api/runs', { key: KEY_A, nick: 'Centrala', run: run() }), 400, 'bad-nick'],
      [post('/api/runs', { key: 'zły', nick: 'Ala', run: run() }), 400, 'bad-key'],
      [post('/api/runs', { key: KEY_A, nick: 'Ala', run: { ...run(), simVersion: undefined } }), 409, 'old-version'],
      [post('/api/runs', { key: KEY_A, nick: 'Ala', run: { ...run(), generatorVersion: 99 } }), 409, 'old-version'],
      [post('/api/runs', { key: KEY_A, nick: 'Ala', run: { ...run(), simVersion: '1' } }), 400, 'bad-request'],
      [post('/api/runs', { key: KEY_A, nick: 'Ala', run: { ...run(), simVersion: -1 } }), 400, 'bad-request'],
      [post('/api/runs', { key: KEY_A, nick: 'Ala', run: { ...run(), gameVersion: 'x'.repeat(101) } }), 400, 'bad-request'],
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
    const res = await handleLeaderboard(get('/api/leaderboard?board=global&limit=10'), deps);
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

  it('limit to dokładnie 10, 20, 50 albo 100 wierszy; bez limitu domyślne 20', async () => {
    const { deps } = setup();
    const key = (i: number): string => `A${String(i).padStart(2, '0')}`.padEnd(20, '7');
    for (let i = 0; i < 25; i++) await submit(deps, key(i), `Gracz${i}`, undefined, { 'x-real-ip': `10.0.0.${i}` });
    const rows = async (query: string): Promise<number> => ((await body(await handleLeaderboard(get(`/api/leaderboard${query}`), deps))).rows as unknown[]).length;
    expect(BOARD_LIMITS).toEqual([10, 20, 50, 100]);
    expect(BOARD_LIMIT_DEFAULT).toBe(20);
    expect(BOARD_LIMIT_MAX).toBe(100);
    expect(await rows('')).toBe(20);
    expect(await rows('?limit=10')).toBe(10);
    expect(await rows('?board=global&limit=20')).toBe(20);
    expect(await rows('?limit=50')).toBe(25);
    expect(await rows('?limit=100')).toBe(25);
  });

  it('inny limit niż 10, 20, 50, 100 to 400 bad-request, bez zapytania do bazy i bez pamięci podręcznej (mało kluczy w cache Vercela)', async () => {
    const { deps, redis } = setup();
    const odd = ['0', '1', '5', '15', '101', '1000', 'abc', '-5', '', '010', '1e1', '10.0', '+10', '%2010', '10%20', '０１０', '١٠', 'NaN', 'Infinity'];
    for (const value of odd) {
      const res = await handleLeaderboard(get(`/api/leaderboard?board=global&limit=${value}`), deps);
      expect(res.status, `limit=${value}`).toBe(400);
      expect((await body(res)).error, `limit=${value}`).toBe('bad-request');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(redis.calls).toBe(0);
  });

  it('nieznany albo powtórzony parametr to 400 bad-request, a seed tylko przy rankingu seeda (inaczej to klucz cache z niczego)', async () => {
    const { deps, redis } = setup();
    const bad = [
      '?x=1', '?board=global&x=1', '?board=week&x=1', '?board=seed&seed=bigos-111&x=1', '?board=global&x=', '?board=global&x', '?X=1', '?Board=global',
      '?board=global&seed=bigos-111', '?board=week&seed=bigos-111', '?seed=bigos-111',
      '?board=global&board=week', '?board=global&limit=10&limit=10', '?board=global&limit=10&limit=20', '?board=seed&seed=a&seed=b',
      '?board=global&limit=10&fbclid=abc', '?%62oard=global&x=1', '?board=global&&x=1',
    ];
    for (const q of bad) {
      const res = await handleLeaderboard(get(`/api/leaderboard${q}`), deps);
      expect(res.status, q).toBe(400);
      expect((await body(res)).error, q).toBe('bad-request');
    }
    expect(redis.calls).toBe(0);
  });

  it('znane parametry w dowolnej kolejności przechodzą; pusty znak zapytania i nazwa kodowana procentowo też', async () => {
    const { deps } = setup();
    for (const q of [
      '', '?', '?board=global', '?limit=50&board=week', '?board=week&limit=10', '?limit=100&seed=bigos-111&board=seed', '?board=seed&seed=bigos-111&limit=50',
      '?%62oard=global', '?board=global&',
    ]) {
      expect((await handleLeaderboard(get(`/api/leaderboard${q}`), deps)).status, q).toBe(200);
    }
  });

  it('nieznany ranking to 400 bad-board także dla nazw z prototypu obiektu (bez wyjątku i bez bazy)', async () => {
    const { deps, redis } = setup();
    for (const board of ['miasto', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'GLOBAL']) {
      const res = await handleLeaderboard(get(`/api/leaderboard?board=${board}`), deps);
      expect(res.status, board).toBe(400);
      expect((await body(res)).error, board).toBe('bad-board');
    }
    expect(redis.calls).toBe(0);
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

  it('kod odzyskiwania wklejony z niewidocznymi znakami (U+200B, U+200E, U+00AD) to ten sam gracz', async () => {
    const { deps } = setup();
    await submit(deps, KEY_A, 'Mateusz');
    const pasted = `\u200b${formatRecoveryCode(KEY_A).slice(0, 9)}\u200e${formatRecoveryCode(KEY_A).slice(9)}\u00ad`;
    expect(await body(await handlePlayer(post('/api/player', { key: pasted }), deps))).toEqual({ ok: true, nicks: ['Mateusz'] });
    const save = testBundle();
    expect((await handleSaveUpload(post('/api/save/upload', { key: pasted, save }), deps)).status).toBe(200);
    expect(await body(await handleSaveDownload(post('/api/save/download', { key: KEY_A }), deps))).toEqual({ ok: true, save, savedAt: NOW });
  });

  it('nick spoza reguł gry: status invalid z komunikatem (wulgarny, ale poprawny nick jest wolny); zły klucz: 400', async () => {
    const { deps } = setup();
    expect((await body(await handlePlayer(post('/api/player', { key: KEY_A, nick: 'Admin' }), deps))).nick)
      .toEqual({ nick: 'Admin', status: 'invalid', message: 'Ta nazwa jest zarezerwowana' });
    expect((await body(await handlePlayer(post('/api/player', { key: KEY_A, nick: 'Kurwiszon' }), deps))).nick)
      .toEqual({ nick: 'Kurwiszon', status: 'free' });
    expect((await handlePlayer(post('/api/player', { key: 'abc' }), deps)).status).toBe(400);
    expect((await handlePlayer(post('/api/player', { nick: 'Ala' }), deps)).status).toBe(400);
  });
});

describe('POST /api/save/upload i /api/save/download: zapis kodem odzyskiwania', () => {
  const save = testBundle();
  const upload = (deps: ServerDeps, key: string, text: unknown = save, headers?: Record<string, string>, extra: Record<string, unknown> = {}) =>
    handleSaveUpload(post('/api/save/upload', { key, save: text, ...extra }, headers), deps);
  /** Wysłanie `force: true`: powtórzone dla tego samego klucza nie kończy się konfliktem (kopia już leży), więc liczy się jak każde wysłanie. */
  const forced = (deps: ServerDeps, key: string, text: unknown = save, headers?: Record<string, string>) => upload(deps, key, text, headers, { force: true });

  it('wysłany zapis wraca na drugim urządzeniu z tym samym kodem; inny kod nie ma zapisu (404)', async () => {
    const { deps } = setup();
    const up = await upload(deps, KEY_A);
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
    expect((await upload(deps, KEY_A, testBundle({ bytes: SAVE_MAX_BYTES + 1 }))).status).toBe(413);
    expect((await upload(deps, KEY_A, testBundle({ bytes: SAVE_MAX_BYTES }))).status).toBe(200);
    expect((await upload(deps, KEY_A, 'zapis')).status).toBe(400);
    expect((await upload(deps, 'abc', '{}')).status).toBe(400);
  });

  it('przyjmuje tylko paczkę z gry: inny kształt to 400 bad-save, bez zapisu w bazie i bez zużycia budżetu', async () => {
    const { deps, redis } = setup();
    const fake = (over: object) => JSON.stringify({ ...(JSON.parse(save) as object), ...over });
    for (const text of [
      JSON.stringify({ schema: 2, seed: 'pierogi-731' }), '[]', fake({ format: 'inny' }), fake({ version: 2 }), fake({ meta: 'x' }), fake({ save: [] }),
      fake({ seed: '' }),
    ]) {
      const res = await upload(deps, KEY_A, text);
      expect(res.status, text.slice(0, 60)).toBe(400);
      expect((await body(res)).error).toBe('bad-save');
    }
    expect((await upload(deps, KEY_A, { format: SAVE_BUNDLE_FORMAT })).status).toBe(400);   // obiekt zamiast tekstu
    expect(redis.keys()).toEqual([]);
  });

  it('zapis z kluczem gracza w środku odpada (serwer nie przechowuje kluczy, nawet przez nieuwagę klienta)', async () => {
    const { deps, redis } = setup();
    for (const key of [KEY_A, formatRecoveryCode(KEY_A), formatRecoveryCode(KEY_A).toLowerCase()]) {
      const text = JSON.stringify({ ...(JSON.parse(save) as object), meta: { player: { nick: 'Ala', key } } });
      const res = await upload(deps, KEY_A, text);
      expect(res.status, key).toBe(400);
      expect((await body(res)).error).toBe('bad-save');
    }
    expect(redis.keys().filter((k) => k.startsWith('tr:save:'))).toEqual([]);
  });

  it('globalny budżet dzienny: ostatnie wysłanie przechodzi, następne to 429 save-budget z Retry-After do północy UTC, dla każdego klucza i adresu', async () => {
    const { deps, redis } = setup();
    const budgetKey = KEYS.budget('save', '2026-10-28');
    await runCommand(redis, ['SET', budgetKey, String(SAVE_DAILY_BUDGET - 1)]);
    expect((await forced(deps, KEY_A, save, { 'x-real-ip': '203.0.113.1' })).status).toBe(200);
    for (const [key, ip] of [[KEY_B, '198.51.100.9'], [KEY_A, '203.0.113.1'], [KEY_B, '192.0.2.77']] as const) {
      const res = await forced(deps, key, save, { 'x-real-ip': ip });
      expect(res.status, `${key} ${ip}`).toBe(429);
      expect(res.headers.get('retry-after')).toBe(String(12 * 3600));   // NOW to 12:00 UTC
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await body(res)).toEqual({ ok: false, error: 'save-budget', message: API_ERRORS['save-budget'].message });
    }
    // do bazy trafił tylko zapis, który się zmieścił w budżecie; pobieranie nie zależy od budżetu wysyłania
    expect(redis.keys().filter((k) => k.startsWith('tr:save:'))).toEqual([KEYS.save(await ownerOf(KEY_A))]);
    expect((await handleSaveDownload(post('/api/save/download', { key: KEY_A }), deps)).status).toBe(200);
  });

  it('budżet liczy tylko wysłania, które doszły do zapisu, a od północy UTC zaczyna się od zera', async () => {
    const { deps, redis, clock } = setup();
    const budgetKey = KEYS.budget('save', '2026-10-28');
    await upload(deps, KEY_A, 'to nie paczka');                                  // zły kształt: bez licznika
    for (let i = 0; i < RATE_LIMITS.saveUp.perKey; i++) await forced(deps, KEY_B, save, { 'x-real-ip': `10.0.0.${i}` });
    expect((await upload(deps, KEY_B, save, { 'x-real-ip': '10.0.1.1' })).status).toBe(429);   // limit na klucz: też bez licznika
    expect(await runCommand(redis, ['GET', budgetKey])).toBe(String(RATE_LIMITS.saveUp.perKey));
    await runCommand(redis, ['SET', budgetKey, String(SAVE_DAILY_BUDGET)]);
    expect((await upload(deps, KEY_A, save, { 'x-real-ip': '10.1.0.1' })).status).toBe(429);
    clock.now = Date.UTC(2026, 9, 29, 0, 0, 5);
    expect((await upload(deps, KEY_A, save, { 'x-real-ip': '10.1.0.1' })).status).toBe(200);
    expect(await runCommand(redis, ['GET', KEYS.budget('save', '2026-10-29')])).toBe('1');
  });
});

/**
 * Wysłanie zapisu pyta o nowszą kopię (przegląd, „Drobne 6”): urządzenie podaje w `expected` chwilę kopii, którą ostatnio wysłało
 * albo pobrało (brak i `null`: jeszcze żadnej nie widziało). Gdy na serwerze leży kopia o innej chwili, wysłanie bez `force: true`
 * kończy się 409 `save-conflict`, bez zapisu i bez zużycia budżetu dziennego.
 */
describe('POST /api/save/upload z expected i force: nowsza kopia na serwerze (save-conflict)', () => {
  const KEY_C = 'P3WN8RTEK7QX9MBD2HFA';
  const KEY_D = 'H2F3A4B5C6D7E8G9J0KM';
  const first = testBundle();
  const second = testBundle({ seed: 'bigos-111' });
  const third = testBundle({ seed: 'golabki-222' });
  const send = (deps: ServerDeps, key: string, extra: Record<string, unknown> = {}, text: unknown = first, headers?: Record<string, string>) =>
    handleSaveUpload(post('/api/save/upload', { key, save: text, ...extra }, headers), deps);
  const stored = async (deps: ServerDeps, key: string) => body(await handleSaveDownload(post('/api/save/download', { key }), deps));
  const conflict = (savedAt: number) => ({ ok: false, error: 'save-conflict', message: API_ERRORS['save-conflict'].message, savedAt });

  it('komunikat i status błędu: 409 „Na serwerze leży nowsza kopia zapisu, której to urządzenie jeszcze nie widziało.”', () => {
    expect(API_ERRORS['save-conflict']).toEqual({
      status: 409, message: 'Na serwerze leży nowsza kopia zapisu, której to urządzenie jeszcze nie widziało.',
    });
  });

  it('gdy na serwerze nie ma kopii, wysłanie przechodzi: bez expected, z expected: null i z liczbą (kopia zdążyła wygasnąć)', async () => {
    const { deps } = setup();
    expect(await body(await send(deps, KEY_A))).toEqual({ ok: true, bytes: first.length, savedAt: NOW });
    expect((await send(deps, KEY_B, { expected: null })).status).toBe(200);
    expect((await send(deps, KEY_C, { expected: NOW - 5000 })).status).toBe(200);
    expect((await send(deps, KEY_D, { expected: 0 })).status).toBe(200);
  });

  it('kolejne wysłanie z expected równym savedAt z poprzedniej odpowiedzi przechodzi i podmienia kopię, i tak dalej', async () => {
    const { deps, clock } = setup();
    const up1 = await body(await send(deps, KEY_A, {}, first));
    expect(up1.savedAt).toBe(NOW);
    clock.now += 1000;
    const up2 = await send(deps, KEY_A, { expected: up1.savedAt }, second);
    expect(up2.status).toBe(200);
    expect(await body(up2)).toEqual({ ok: true, bytes: second.length, savedAt: NOW + 1000 });
    expect(await stored(deps, KEY_A)).toEqual({ ok: true, save: second, savedAt: NOW + 1000 });
    clock.now += 1000;
    expect((await send(deps, KEY_A, { expected: NOW + 1000 }, third)).status).toBe(200);
    expect(await stored(deps, KEY_A)).toEqual({ ok: true, save: third, savedAt: NOW + 2000 });
  });

  it('kopia na serwerze, a urządzenie podaje expected: null albo nic: 409 z savedAt kopii, kopia bez zmian (download oddaje starą)', async () => {
    const { deps, clock } = setup();
    await send(deps, KEY_A, {}, first);
    clock.now += 1000;
    for (const extra of [{ expected: null }, {}, { expected: undefined }, { force: false }, { expected: null, force: false }]) {
      const res = await send(deps, KEY_A, extra, second);
      expect(res.status, JSON.stringify(extra)).toBe(409);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await body(res)).toEqual(conflict(NOW));
    }
    expect(await stored(deps, KEY_A)).toEqual({ ok: true, save: first, savedAt: NOW });
  });

  it('drugie urządzenie wysłało w międzyczasie: pierwsze, ze starym expected, dostaje 409 z nowszą chwilą, a kopia drugiego leży nietknięta', async () => {
    const { deps, clock } = setup();
    const t0 = (await body(await send(deps, KEY_A, {}, first))).savedAt as number;   // urządzenie 1 wysyła i zapamiętuje t0
    clock.now += 60_000;
    const t1 = (await body(await send(deps, KEY_A, { expected: t0 }, second))).savedAt as number;   // urządzenie 2 pobrało t0 i wysyła
    clock.now += 60_000;
    const res = await send(deps, KEY_A, { expected: t0 }, third);   // urządzenie 1 nie wie o t1
    expect(res.status).toBe(409);
    expect(await body(res)).toEqual(conflict(t1));
    expect(t1).toBe(t0 + 60_000);
    expect(await stored(deps, KEY_A)).toEqual({ ok: true, save: second, savedAt: t1 });
    // expected z przyszłości też nie jest chwilą kopii z serwera
    expect((await send(deps, KEY_A, { expected: t1 + 1 }, third)).status).toBe(409);
  });

  it('force: true wysyła mimo konfliktu i podmienia kopię (z expected: null, ze starym expected i bez expected)', async () => {
    const { deps, clock } = setup();
    await send(deps, KEY_A, {}, first);
    for (const [i, extra] of [{ expected: null }, { expected: NOW - 1 }, {}].entries()) {
      clock.now += 1000;
      const text = [second, third, first][i]!;
      const res = await send(deps, KEY_A, { ...extra, force: true }, text);
      expect(res.status, JSON.stringify(extra)).toBe(200);
      expect(await body(res)).toEqual({ ok: true, bytes: text.length, savedAt: clock.now });
      expect(await stored(deps, KEY_A)).toEqual({ ok: true, save: text, savedAt: clock.now });
    }
  });

  it('konflikt nie zużywa budżetu dziennego, nie zapisuje niczego i nie odnawia czasu życia kopii; zapis i force zużywają po jednym', async () => {
    const { deps, redis, clock } = setup();
    const budgetKey = KEYS.budget('save', '2026-10-28');
    const saveKey = KEYS.save(await ownerOf(KEY_A));
    await send(deps, KEY_A, {}, first);
    expect(await runCommand(redis, ['GET', budgetKey])).toBe('1');
    clock.now += 86_400_000 / 2 - 3_600_000;   // jeszcze ten sam dzień UTC (23:00)
    const ttl = Number(await runCommand(redis, ['PTTL', saveKey]));
    for (let i = 0; i < 5; i++) {
      expect((await send(deps, KEY_A, { expected: null }, second, { 'x-real-ip': `198.51.100.${i}` })).status).toBe(409);
    }
    expect(await runCommand(redis, ['GET', budgetKey])).toBe('1');
    expect(Number(await runCommand(redis, ['PTTL', saveKey]))).toBe(ttl);
    expect(redis.keys().filter((k) => k.startsWith('tr:save:'))).toEqual([saveKey]);
    expect(await runCommand(redis, ['GET', saveKey])).toBe(`${NOW}\n${first}`);
    expect((await send(deps, KEY_A, { expected: NOW }, second)).status).toBe(200);
    expect((await send(deps, KEY_A, { expected: null, force: true }, third)).status).toBe(200);
    expect(await runCommand(redis, ['GET', budgetKey])).toBe('3');
  });

  it('kolejność kontroli: kształt zapisu i limit na klucz wygrywają z konfliktem, a konflikt z budżetem dziennym', async () => {
    const { deps, redis } = setup();
    await send(deps, KEY_A, {}, first);
    // zły kształt (także zapis z kluczem w środku) to 400 bad-save, nie 409
    expect((await body(await send(deps, KEY_A, { expected: null }, '[]'))).error).toBe('bad-save');
    const withKey = JSON.stringify({ ...(JSON.parse(first) as object), meta: { player: { key: KEY_A } } });
    expect((await body(await send(deps, KEY_A, { expected: null }, withKey))).error).toBe('bad-save');
    // budżet wyczerpany: konflikt nadal jest 409 (jeszcze przed budżetem), a wysyłanie zgodne z kopią albo z force to 429
    await runCommand(redis, ['SET', KEYS.budget('save', '2026-10-28'), String(SAVE_DAILY_BUDGET)]);
    const stale = await send(deps, KEY_A, { expected: null }, second);
    expect([stale.status, (await body(stale)).error]).toEqual([409, 'save-conflict']);
    expect((await send(deps, KEY_A, { expected: NOW }, second)).status).toBe(429);
    expect((await send(deps, KEY_A, { expected: null, force: true }, second)).status).toBe(429);
    expect(await stored(deps, KEY_A)).toEqual({ ok: true, save: first, savedAt: NOW });
  });

  it('limit na klucz liczy też żądania zakończone konfliktem: po limicie 429 rate-limited zamiast 409', async () => {
    const { deps } = setup();
    const results: number[] = [];
    for (let i = 0; i < RATE_LIMITS.saveUp.perKey; i++) results.push((await send(deps, KEY_A, {}, first, { 'x-real-ip': `10.0.0.${i}` })).status);
    expect(results).toEqual([200, ...Array<number>(RATE_LIMITS.saveUp.perKey - 1).fill(409)]);
    const limited = await send(deps, KEY_A, {}, first, { 'x-real-ip': '10.0.1.1' });
    expect(limited.status).toBe(429);
    expect((await body(limited)).error).toBe('rate-limited');
  });

  it('expected musi być liczbą całkowitą nieujemną (bezpieczną) albo null, force wartością logiczną: inaczej 400 bad-request, bez sięgania do bazy', async () => {
    const { deps, redis } = setup();
    await send(deps, KEY_A, {}, first);
    const calls = redis.commands;
    const badExpected: unknown[] = ['x', '123', '', -1, -0.5, 1.5, 2 ** 53, true, false, [], [1], {}];
    for (const expected of badExpected) {
      const res = await send(deps, KEY_A, { expected });
      expect(res.status, JSON.stringify(expected)).toBe(400);
      expect(await body(res)).toEqual({ ok: false, error: 'bad-request', message: API_ERRORS['bad-request'].message });
    }
    for (const force of ['tak', 'true', 1, 0, null, [], [true], {}]) {
      const res = await send(deps, KEY_A, { expected: null, force });
      expect(res.status, JSON.stringify(force)).toBe(400);
      expect((await body(res)).error).toBe('bad-request');
    }
    expect(redis.commands).toBe(calls);
    // granice poprawnych wartości
    expect((await send(deps, KEY_B, { expected: 0, force: false })).status).toBe(200);
    expect((await send(deps, KEY_C, { expected: Number.MAX_SAFE_INTEGER, force: true })).status).toBe(200);
  });

  it('wpis z uszkodzonym początkiem nie blokuje wysyłania (nie ma czytelnej chwili kopii, więc nie ma z czym się kłócić)', async () => {
    const { deps, redis } = setup();
    await runCommand(redis, ['SET', KEYS.save(await ownerOf(KEY_A)), 'nie json']);
    expect((await send(deps, KEY_A, { expected: null }, second)).status).toBe(200);
    expect(await stored(deps, KEY_A)).toEqual({ ok: true, save: second, savedAt: NOW });
  });
});

/**
 * Limity na poziomie handlerów: każdy z czterech endpointów POST ma wołać limiter. Same testy `checkRate` w izolacji nie zauważą
 * usuniętego wywołania, a bez limitera najbardziej podatne są właśnie player i zapis (klucz kosztuje zero).
 */
describe('limit zgłoszeń na poziomie handlerów: 429 z Retry-After na klucz i na adres', () => {
  const keyN = (i: number): string => `${CROCKFORD[(i >> 5) & 31]}${CROCKFORD[i & 31]}`.padEnd(20, '7');
  const cases: { name: string; action: RateAction; call: (deps: ServerDeps, i: number, key: string, headers: Record<string, string>) => Promise<Response> }[] = [
    { name: 'POST /api/runs', action: 'runs', call: (deps, i, key, h) => handleRuns(post('/api/runs', { key, nick: `Gracz${i}`, run: run() }, h), deps) },
    { name: 'POST /api/player', action: 'player', call: (deps, _i, key, h) => handlePlayer(post('/api/player', { key }, h), deps) },
    { name: 'POST /api/save/upload', action: 'saveUp', call: (deps, _i, key, h) => handleSaveUpload(post('/api/save/upload', { key, save: testBundle() }, h), deps) },
    { name: 'POST /api/save/download', action: 'saveDown', call: (deps, _i, key, h) => handleSaveDownload(post('/api/save/download', { key }, h), deps) },
  ];
  const ipv4 = (i: number): string => `10.0.${i >> 8}.${i & 255}`;
  /** Ten sam prefiks /64, za każdym razem inna końcówka (tak rotuje klient, któremu dostawca dał cały prefiks). */
  const ipv6 = (i: number): string => `2001:db8:abcd:12:${i.toString(16)}:${i}::${i + 1}`;

  for (const c of cases) {
    const { perKey, perAddress, window } = RATE_LIMITS[c.action];

    it(`${c.name}: po ${perKey} żądaniach jednego klucza (z różnych adresów) następne to 429, a inny klucz przechodzi`, async () => {
      const { deps } = setup();
      for (let i = 0; i < perKey; i++) expect((await c.call(deps, i, KEY_A, { 'x-real-ip': ipv4(i) })).status, `żądanie ${i + 1}`).not.toBe(429);
      const denied = await c.call(deps, perKey, KEY_A, { 'x-real-ip': ipv4(perKey) });
      expect(denied.status).toBe(429);
      expect((await body(denied)).error).toBe('rate-limited');
      expect(denied.headers.get('cache-control')).toBe('no-store');
      const retry = Number(denied.headers.get('retry-after'));
      expect(retry).toBeGreaterThan(0);
      expect(retry).toBeLessThanOrEqual(window);
      expect((await c.call(deps, perKey + 1, KEY_B, { 'x-real-ip': ipv4(perKey + 1) })).status).not.toBe(429);
    });

    it(`${c.name}: po ${perAddress} żądaniach z jednego adresu (z różnymi kluczami) następne to 429, a inny adres przechodzi`, async () => {
      const { deps } = setup();
      for (let i = 0; i < perAddress; i++) expect((await c.call(deps, i, keyN(i), { 'x-real-ip': '203.0.113.7' })).status, `żądanie ${i + 1}`).not.toBe(429);
      const denied = await c.call(deps, perAddress, keyN(perAddress), { 'x-real-ip': '203.0.113.7' });
      expect(denied.status).toBe(429);
      expect((await body(denied)).error).toBe('rate-limited');
      expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await c.call(deps, perAddress + 1, keyN(perAddress + 1), { 'x-real-ip': '198.51.100.9' })).status).not.toBe(429);
    });

    it(`${c.name}: klient IPv6 zmieniający końcówkę adresu w swoim prefiksie /64 trafia na ten sam limit, a inny prefiks przechodzi`, async () => {
      const { deps } = setup();
      for (let i = 0; i < perAddress; i++) expect((await c.call(deps, i, keyN(i), { 'x-real-ip': ipv6(i) })).status, `żądanie ${i + 1}`).not.toBe(429);
      const denied = await c.call(deps, perAddress, keyN(perAddress), { 'x-real-ip': ipv6(perAddress + 100) });
      expect(denied.status).toBe(429);
      expect((await c.call(deps, perAddress + 1, keyN(perAddress + 1), { 'x-real-ip': '2001:db8:abcd:13::1' })).status).not.toBe(429);
    });
  }

  /**
   * Bramka w pamięci instancji (`deps.rateGate`): kto przekroczył limit w bazie, przy kolejnych żądaniach z tego adresu albo tego
   * klucza nie kosztuje już ani zapytania, ani polecenia, aż do końca okna. Bez bramki (reszta tego pliku) każde żądanie idzie do bazy.
   */
  for (const c of cases) {
    const { perKey, perAddress, window } = RATE_LIMITS[c.action];
    const gated = () => { const t = setup(); return { ...t, deps: { ...t.deps, rateGate: createRateGate() } as ServerDeps }; };

    it(`${c.name} z bramką: po odmowie bazy na adres 100 następnych żądań z tego adresu to 429 za 0 zapytań i 0 poleceń`, async () => {
      const { deps, redis } = gated();
      for (let i = 0; i < perAddress; i++) expect((await c.call(deps, i, keyN(i), { 'x-real-ip': '203.0.113.7' })).status, `żądanie ${i + 1}`).not.toBe(429);
      expect((await c.call(deps, perAddress, keyN(perAddress), { 'x-real-ip': '203.0.113.7' })).status).toBe(429);   // tę odrzuca baza
      const [calls, commands] = [redis.calls, redis.commands];
      for (let i = 0; i < 100; i++) {
        const denied = await c.call(deps, perAddress + 1 + i, keyN(perAddress + 1 + i), { 'x-real-ip': '203.0.113.7' });
        expect(denied.status).toBe(429);
        expect((await body(denied)).error).toBe('rate-limited');
        expect(denied.headers.get('cache-control')).toBe('no-store');
        expect(Number(denied.headers.get('retry-after'))).toBe(window - (NOW / 1000) % window);
      }
      expect([redis.calls - calls, redis.commands - commands]).toEqual([0, 0]);
      expect((await c.call(deps, 9999, keyN(9999), { 'x-real-ip': '198.51.100.9' })).status).not.toBe(429);   // inny adres przechodzi
    });

    it(`${c.name} z bramką: po odmowie bazy na klucz kolejne żądania tego klucza (z dowolnych adresów) kosztują 0, inny klucz przechodzi`, async () => {
      const { deps, redis } = gated();
      for (let i = 0; i < perKey; i++) expect((await c.call(deps, i, KEY_A, { 'x-real-ip': ipv4(i) })).status, `żądanie ${i + 1}`).not.toBe(429);
      expect((await c.call(deps, perKey, KEY_A, { 'x-real-ip': ipv4(perKey) })).status).toBe(429);
      const [calls, commands] = [redis.calls, redis.commands];
      for (let i = 0; i < 100; i++) expect((await c.call(deps, 500 + i, KEY_A, { 'x-real-ip': ipv4(500 + i) })).status).toBe(429);
      expect([redis.calls - calls, redis.commands - commands]).toEqual([0, 0]);
      expect((await c.call(deps, 9999, KEY_B, { 'x-real-ip': ipv4(9999) })).status).not.toBe(429);
    });

    it(`${c.name} z sekretem limitu (deps.rateSecret): bez soli okna w bazie, ten sam limit na klucz, 429 z Retry-After`, async () => {
      const { deps, redis } = setup();
      const withSecret: ServerDeps = { ...deps, rateSecret: 'sekret-limitu-0123456789abcdef', rateGate: createRateGate() };
      for (let i = 0; i < perKey; i++) expect((await c.call(withSecret, i, KEY_A, { 'x-real-ip': ipv4(i) })).status, `żądanie ${i + 1}`).not.toBe(429);
      expect(redis.keys().filter((k) => k.startsWith('tr:salt:'))).toEqual([]);
      const denied = await c.call(withSecret, perKey, KEY_A, { 'x-real-ip': ipv4(perKey) });
      expect(denied.status).toBe(429);
      expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await c.call(withSecret, perKey + 1, KEY_B, { 'x-real-ip': ipv4(perKey + 1) })).status).not.toBe(429);
    });

    it(`${c.name} z bramką: odmowa trwa do końca okna, a w następnym oknie żądanie znów przechodzi przez bazę`, async () => {
      const { deps, redis, clock } = gated();
      for (let i = 0; i <= perAddress; i++) await c.call(deps, i, keyN(i), { 'x-real-ip': '203.0.113.7' });
      const calls = redis.calls;
      clock.now += (window - (NOW / 1000) % window) * 1000 - 1;   // ostatnia milisekunda okna
      expect((await c.call(deps, 7000, keyN(7000), { 'x-real-ip': '203.0.113.7' })).status).toBe(429);
      expect(redis.calls).toBe(calls);
      clock.now += 1;
      expect((await c.call(deps, 7001, keyN(7001), { 'x-real-ip': '203.0.113.7' })).status).not.toBe(429);
      expect(redis.calls).toBeGreaterThan(calls);
    });
  }

  const endpoints: [string, typeof handleRuns, string, RateAction][] = [
    ['POST /api/runs', handleRuns, '/api/runs', 'runs'],
    ['POST /api/player', handlePlayer, '/api/player', 'player'],
    ['POST /api/save/upload', handleSaveUpload, '/api/save/upload', 'saveUp'],
    ['POST /api/save/download', handleSaveDownload, '/api/save/download', 'saveDown'],
  ];
  for (const [name, handler, path, action] of endpoints) {
    it(`${name}: adres, któremu bramka już odmawia, dostaje 429 przed odczytem ciała (nawet z żądaniem, które inaczej byłoby 400 albo 413), a inny adres jak dotąd`, async () => {
      const { deps, redis } = setup();
      const rateGate = createRateGate();
      await rateGate.record(action, { owner: null, address: '203.0.113.7' }, NOW, { address: RATE_LIMITS[action].perAddress, key: null });
      const gated = { ...deps, rateGate };
      const bad = post(path, 'to nie JSON', { 'x-real-ip': '203.0.113.7' });
      const huge = post(path, { key: KEY_A }, { 'x-real-ip': '203.0.113.7', 'content-length': '99999999' });
      for (const req of [bad, huge]) {
        const res = await handler(req, gated);
        expect(res.status).toBe(429);
        expect((await body(res)).error).toBe('rate-limited');
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(req.bodyUsed).toBe(false);
      }
      expect(redis.calls).toBe(0);
      expect((await handler(post(path, 'to nie JSON', { 'x-real-ip': '198.51.100.9' }), gated)).status).toBe(400);
      expect((await handler(post(path, { key: KEY_A }, { 'x-real-ip': '198.51.100.9', 'content-length': '99999999' }), gated)).status).toBe(413);
      expect((await handler(get(path), gated)).status).toBe(405);   // metoda jest sprawdzana przed bramką
    });
  }

  it('wczesna kontrola niczego nie liczy: żądania z poprawnym i niepoprawnym ciałem nie przybliżają adresu do odmowy', async () => {
    const { deps, redis } = setup();
    const rateGate = createRateGate();
    const gated = { ...deps, rateGate };
    for (let i = 0; i < 3 * RATE_LIMITS.player.perAddress; i++) await handlePlayer(post('/api/player', 'to nie JSON'), gated);
    expect(redis.calls).toBe(0);
    expect(rateGate.size).toBe(0);
    expect((await handlePlayer(post('/api/player', { key: KEY_A }), gated)).status).toBe(200);
  });

  it('odmowa limitu nie dotyka niczego poza licznikami: nick, wynik i zapis nie powstają', async () => {
    const { deps, redis } = setup();
    for (let i = 0; i < RATE_LIMITS.runs.perKey; i++) await submit(deps, KEY_A, `Gracz${i}`.slice(0, 20), undefined, { 'x-real-ip': ipv4(i) });
    const before = redis.keys().filter((k) => !k.startsWith('tr:rl:') && !k.startsWith('tr:salt:'));
    expect((await submit(deps, KEY_A, 'Inny', undefined, { 'x-real-ip': ipv4(99) })).status).toBe(429);
    expect(redis.keys().filter((k) => !k.startsWith('tr:rl:') && !k.startsWith('tr:salt:'))).toEqual(before);
  });
});

describe('wczesna odmowa po nagłówku Content-Length: 413 bez czytania ciała', () => {
  const cases: [string, typeof handleRuns, string, number, string][] = [
    ['POST /api/runs', handleRuns, '/api/runs', RUN_MAX_BODY_BYTES, 'too-large'],
    ['POST /api/player', handlePlayer, '/api/player', SMALL_BODY_BYTES, 'too-large'],
    ['POST /api/save/download', handleSaveDownload, '/api/save/download', SMALL_BODY_BYTES, 'too-large'],
    ['POST /api/save/upload', handleSaveUpload, '/api/save/upload', SAVE_BODY_BYTES, 'save-too-large'],
  ];

  for (const [name, handler, path, max, error] of cases) {
    it(`${name}: nagłówek większy niż ${max} B kończy się 413 ${error}, zanim ktokolwiek sięgnie po ciało albo do bazy`, async () => {
      const { deps, redis } = setup();
      const req = post(path, { key: KEY_A }, { 'content-length': String(max + 1) });
      const res = await handler(req, deps);
      expect(res.status).toBe(413);
      expect((await body(res)).error).toBe(error);
      expect(req.bodyUsed).toBe(false);
      expect(redis.calls).toBe(0);
    });

    it(`${name}: nagłówek równy ${max} B nie odrzuca wcześniej (ciało i tak sprawdza się po odczycie), a bez nagłówka za duże ciało to 413 po odczycie`, async () => {
      const { deps } = setup();
      const ok = post(path, { key: KEY_A }, { 'content-length': String(max) });
      expect((await handler(ok, deps)).status).not.toBe(413);
      expect(ok.bodyUsed).toBe(true);
      const big = post(path, `{"x":"${'a'.repeat(max)}"}`);
      expect(big.headers.get('content-length')).toBeNull();
      const res = await handler(big, deps);
      expect(res.status).toBe(413);
      expect((await body(res)).error).toBe(error);
    });
  }

  it('nagłówek, który nie jest liczbą, nie blokuje żądania (liczy się ciało)', async () => {
    const { deps } = setup();
    for (const value of ['abc', '', '-5', '12abc']) {
      const res = await handlePlayer(post('/api/player', { key: KEY_A }, { 'content-length': value }), deps);
      expect(res.status, value).toBe(200);
    }
  });
});

describe('ciało żądania czytane strumieniem z ucięciem', () => {
  const CHUNK = 1_000;
  const enc = new TextEncoder();
  const endpoints: [string, typeof handleRuns, string, number, string][] = [
    ['POST /api/runs', handleRuns, '/api/runs', RUN_MAX_BODY_BYTES, 'too-large'],
    ['POST /api/player', handlePlayer, '/api/player', SMALL_BODY_BYTES, 'too-large'],
    ['POST /api/save/download', handleSaveDownload, '/api/save/download', SMALL_BODY_BYTES, 'too-large'],
    ['POST /api/save/upload', handleSaveUpload, '/api/save/upload', SAVE_BODY_BYTES, 'save-too-large'],
  ];

  /** Ten sam kawałek `times` razy (bez składania całości w pamięci). */
  function* repeat(chunk: Uint8Array, times: number): Generator<Uint8Array> {
    for (let i = 0; i < times; i++) yield chunk;
  }
  const slices = (bytes: Uint8Array, size: number): Uint8Array[] => {
    const out: Uint8Array[] = [];
    for (let at = 0; at < bytes.length; at += size) out.push(bytes.slice(at, at + size));
    return out;
  };
  /** JSON `{ key, pad }` o długości dokładnie `bytes` bajtów UTF-8; dopełnia `fill`, a reszta (gdy znak ma kilka bajtów) to „a”. */
  function sized(bytes: number, fill = 'a'): Uint8Array {
    const extra = bytes - enc.encode(JSON.stringify({ key: KEY_A, pad: '' })).length;
    const width = enc.encode(fill).length;
    const out = enc.encode(JSON.stringify({ key: KEY_A, pad: fill.repeat(Math.floor(extra / width)) + 'a'.repeat(extra % width) }));
    expect(out.length).toBe(bytes);
    return out;
  }
  /**
   * Żądanie z ciałem jako strumień, bez nagłówka długości. Strumień oddaje kawałek dopiero na żądanie czytającego
   * (`highWaterMark: 0`), więc `seen.pulled` to dokładnie liczba pobranych kawałków, a `seen.cancelled` mówi, czy czytający
   * przerwał strumień (`cancel`). Iterator, który rzuci wyjątek, zrywa strumień w połowie.
   */
  function streamed(path: string, chunks: Iterable<Uint8Array>, headers: Record<string, string> = {}) {
    const source = chunks[Symbol.iterator]();
    const seen = { pulled: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = source.next();
        if (next.done) return controller.close();
        seen.pulled++;
        controller.enqueue(next.value);
      },
      cancel() { seen.cancelled = true; },
    }, { highWaterMark: 0 });
    const req = new Request(`${ORIGIN}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7', ...headers }, body: stream, duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    return { req, seen };
  }

  for (const [name, handler, path, max, error] of endpoints) {
    const chunksToLimit = Math.ceil(max / CHUNK);

    it(`${name}: strumień dłuższy niż ${max} B zostaje przerwany zaraz po przekroczeniu (najwyżej limit plus jeden kawałek), cancel wywołany, 413`, async () => {
      const { deps, redis } = setup();
      const { req, seen } = streamed(path, repeat(enc.encode('a'.repeat(CHUNK)), 3 * chunksToLimit));
      expect(req.headers.get('content-length')).toBeNull();
      const res = await handler(req, deps);
      expect(res.status).toBe(413);
      expect((await body(res)).error).toBe(error);
      expect(seen.cancelled).toBe(true);
      expect(seen.pulled).toBeLessThanOrEqual(chunksToLimit + 1);
      expect(redis.calls).toBe(0);
    });

    it(`${name}: kłamliwy Content-Length (mniejszy niż ciało) nie omija limitu, ciało jest liczone i przerwane tak samo`, async () => {
      const { deps } = setup();
      const { req, seen } = streamed(path, repeat(enc.encode('a'.repeat(CHUNK)), 3 * chunksToLimit), { 'content-length': '10' });
      const res = await handler(req, deps);
      expect(res.status).toBe(413);
      expect((await body(res)).error).toBe(error);
      expect(seen.cancelled).toBe(true);
      expect(seen.pulled).toBeLessThanOrEqual(chunksToLimit + 1);
    });

    it(`${name}: Content-Length większy niż ${max} B odrzuca od razu, bez pobrania choćby jednego kawałka`, async () => {
      const { deps, redis } = setup();
      const { req, seen } = streamed(path, repeat(enc.encode('a'.repeat(CHUNK)), 3), { 'content-length': String(max + 1) });
      const res = await handler(req, deps);
      expect(res.status).toBe(413);
      expect((await body(res)).error).toBe(error);
      expect(seen.pulled).toBe(0);
      expect(req.bodyUsed).toBe(false);
      expect(redis.calls).toBe(0);
    });

    it(`${name}: dokładnie ${max} B przechodzi, a ${max} B plus jeden bajt to 413 (ciało w kawałkach)`, async () => {
      const { deps } = setup();
      expect((await handler(streamed(path, slices(sized(max), CHUNK)).req, deps)).status).not.toBe(413);
      const res = await handler(streamed(path, slices(sized(max + 1), CHUNK)).req, deps);
      expect(res.status).toBe(413);
      expect((await body(res)).error).toBe(error);
    });

    it(`${name}: limit liczy bajty, nie znaki (dwubajtowe „ż” w ciele): ${max} B przechodzi, ${max} B plus jeden bajt to 413`, async () => {
      const { deps } = setup();
      expect((await handler(streamed(path, slices(sized(max, 'ż'), CHUNK)).req, deps)).status).not.toBe(413);
      const res = await handler(streamed(path, slices(sized(max + 1, 'ż'), CHUNK)).req, deps);
      expect(res.status).toBe(413);
      expect((await body(res)).error).toBe(error);
    });
  }

  it('ciało o dokładnie dozwolonej długości, podane jednym kawałkiem, jest przyjęte (200)', async () => {
    const { deps } = setup();
    const res = await handlePlayer(streamed('/api/player', [sized(SMALL_BODY_BYTES)]).req, deps);
    expect(res.status).toBe(200);
    expect((await body(res)).ok).toBe(true);
  });

  it('wielobajtowe znaki (2 i 4 bajty) przecięte granicą kawałków dekodują się poprawnie, nawet gdy kawałki mają po jednym bajcie', async () => {
    const { deps } = setup();
    const ok = await handlePlayer(streamed('/api/player', slices(enc.encode(JSON.stringify({ key: KEY_A, nick: 'Łódź żółć' })), 1)).req, deps);
    expect(ok.status).toBe(200);
    expect((await body(ok)).nick).toEqual({ nick: 'Łódź żółć', status: 'free' });
    const emoji = await handlePlayer(streamed('/api/player', slices(enc.encode(JSON.stringify({ key: KEY_A, nick: 'Ala\u{1F600}' })), 1)).req, deps);
    expect(emoji.status).toBe(200);
    expect((await body(emoji)).nick).toMatchObject({ nick: 'Ala\u{1F600}', status: 'invalid' });
  });

  it('niepoprawny UTF-8 nie rzuca wyjątku: bajty zamieniają się w \\u{FFFD}, a ciało jest oceniane dalej', async () => {
    const { deps } = setup();
    const bad = Uint8Array.from([...enc.encode('{"key":"'), 0xff, 0xc3, ...enc.encode('"}')]);
    const inString = await handlePlayer(streamed('/api/player', [bad]).req, deps);
    expect(inString.status).toBe(400);
    expect((await body(inString)).error).toBe('bad-key');
    const cutOff = await handlePlayer(streamed('/api/player', [Uint8Array.from([0x7b, 0xc3])]).req, deps);
    expect(cutOff.status).toBe(400);
    expect((await body(cutOff)).error).toBe('bad-request');
    // Niedokończony znak na samym końcu po poprawnym JSON to nadal śmieci w ciele (dekoder oddaje \u{FFFD}), a nie cicho pominięty bajt.
    const tail = await handlePlayer(streamed('/api/player', [Uint8Array.from([...enc.encode(JSON.stringify({ key: KEY_A })), 0xc3])]).req, deps);
    expect(tail.status).toBe(400);
    expect((await body(tail)).error).toBe('bad-request');
  });

  it('pusty strumień, puste ciało i brak ciała to 400 bad-request', async () => {
    const { deps } = setup();
    const requests = [
      streamed('/api/player', []).req,
      post('/api/player', ''),
      new Request(`${ORIGIN}/api/player`, { method: 'POST', headers: { 'x-real-ip': '203.0.113.7' } }),
    ];
    for (const req of requests) {
      const res = await handlePlayer(req, deps);
      expect(res.status).toBe(400);
      expect((await body(res)).error).toBe('bad-request');
    }
  });

  it('strumień zerwany w połowie to 400 bad-request, a nie wyjątek', async () => {
    const { deps } = setup();
    function* broken(): Generator<Uint8Array> {
      yield enc.encode('{"key":');
      throw new Error('połączenie zerwane');
    }
    const res = await handlePlayer(streamed('/api/player', broken()).req, deps);
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe('bad-request');
  });

  it('blokada czytnika jest zwolniona po każdym wyniku: przyjęciu, odrzuceniu za dużego ciała, złym JSON i zerwanym strumieniu', async () => {
    const { deps } = setup();
    function* broken(): Generator<Uint8Array> {
      yield enc.encode('{"key":');
      throw new Error('połączenie zerwane');
    }
    const cases: [string, Iterable<Uint8Array>][] = [
      ['przyjęte', slices(sized(100), 40)],
      ['za duże', repeat(enc.encode('a'.repeat(CHUNK)), 3 * Math.ceil(SMALL_BODY_BYTES / CHUNK))],
      ['zły JSON', [enc.encode('to nie JSON')]],
      ['zerwany strumień', broken()],
    ];
    for (const [label, chunks] of cases) {
      const { req } = streamed('/api/player', chunks);
      await handlePlayer(req, deps);
      expect(req.body?.locked, label).toBe(false);
    }
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
