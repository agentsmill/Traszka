import { describe, expect, it, vi } from 'vitest';
import { formatRecoveryCode } from '@/game/playerKey';
import { API_ERRORS } from './errors';
import {
  BOARD_LIMIT_DEFAULT, BOARD_LIMIT_MAX, BOARD_LIMITS, KNOWN_GAME_VERSIONS, KNOWN_GENERATOR_VERSIONS, RATE_LIMITS, SAVE_BUNDLE_FORMAT,
  SAVE_DAILY_BUDGET, SAVE_MAX_BYTES,
} from './config';
import {
  clientAddress, handleLeaderboard, handlePlayer, handleRuns, handleSaveDownload, handleSaveUpload, type ServerDeps,
} from './http';
import { KEYS, ownerOf } from './keys';
import { MemoryRedis } from './memoryRedis';
import { run as runCommand } from './redis';
import type { RunRecord } from './runs';
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

  it('nieudane odtworzenie: 422 i nic w rankingu', async () => {
    const failed = await submit(setup({ ok: false, reason: 'replay-failed' }).deps, KEY_A, 'Ala');
    expect(failed.status).toBe(422);
    expect((await body(failed)).error).toBe('replay-failed');
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
  const upload = (deps: ServerDeps, key: string, text: unknown = save, headers?: Record<string, string>) =>
    handleSaveUpload(post('/api/save/upload', { key, save: text }, headers), deps);

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
    expect((await upload(deps, KEY_A, save, { 'x-real-ip': '203.0.113.1' })).status).toBe(200);
    for (const [key, ip] of [[KEY_B, '198.51.100.9'], [KEY_A, '203.0.113.1'], [KEY_B, '192.0.2.77']] as const) {
      const res = await upload(deps, key, save, { 'x-real-ip': ip });
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
    for (let i = 0; i < RATE_LIMITS.saveUp.perKey; i++) await upload(deps, KEY_B, save, { 'x-real-ip': `10.0.0.${i}` });
    expect((await upload(deps, KEY_B, save, { 'x-real-ip': '10.0.1.1' })).status).toBe(429);   // limit na klucz: też bez licznika
    expect(await runCommand(redis, ['GET', budgetKey])).toBe(String(RATE_LIMITS.saveUp.perKey));
    await runCommand(redis, ['SET', budgetKey, String(SAVE_DAILY_BUDGET)]);
    expect((await upload(deps, KEY_A, save, { 'x-real-ip': '10.1.0.1' })).status).toBe(429);
    clock.now = Date.UTC(2026, 9, 29, 0, 0, 5);
    expect((await upload(deps, KEY_A, save, { 'x-real-ip': '10.1.0.1' })).status).toBe(200);
    expect(await runCommand(redis, ['GET', KEYS.budget('save', '2026-10-29')])).toBe('1');
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
