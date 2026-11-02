import { describe, expect, it, vi } from 'vitest';
import { formatRecoveryCode } from '@/game/playerKey';
import { SIM_VERSION } from '@/sim/simVersion';
import { handleFameList, handleFameSubmit, type ServerDeps } from './http';
import { FAME_CASH, FAME_DAILY_BUDGET, FAME_DAY, FAME_LIST_MAX, FAME_SIM, RATE_LIMITS, RUN_MAX_SEED_CHARS, SMALL_BODY_BYTES } from './config';
import { route } from './env';
import { API_ERRORS } from './errors';
import { parseFameEntry, parseFameSubmission, readFame, recordFame, type FameEntry } from './fame';
import { KEYS, ownerOf } from './keys';
import { MemoryRedis } from './memoryRedis';
import { claimNick } from './nicks';
import { RedisError, asScored, run } from './redis';
import { replayNotAvailable } from './verify';

const NOW = Date.UTC(2026, 10, 3, 12);
const KEY_A = formatRecoveryCode('K7QX9MBD2HFAP3WN8RTE');
const KEY_B = formatRecoveryCode('M2N3P4Q5R6S7T8V9W0XY');
const KEY_C = formatRecoveryCode('A1B2C3D4E5F6G7H8J9KM');
const ORIGIN = 'https://traszka.test';
const SEED = 'szarlotka-380';

function setup() {
  const clock = { now: NOW };
  const redis = new MemoryRedis(() => clock.now);
  const deps: ServerDeps = { redis, readRedis: redis, verifyRun: replayNotAvailable, now: () => clock.now };
  return { clock, redis, deps };
}

const entryBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  key: KEY_A, nick: 'Mateusz', seed: SEED, day: 412, cash: 1_034_500.5, simVersion: SIM_VERSION, ...over,
});
const post = (body: unknown, headers: Record<string, string> = {}): Request => new Request(`${ORIGIN}/api/fame/submit`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.7', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const submit = (deps: ServerDeps, over: Record<string, unknown> = {}, headers?: Record<string, string>): Promise<Response> =>
  handleFameSubmit(post(entryBody(over), headers), deps);
const list = (deps: ServerDeps, query = ''): Promise<Response> => handleFameList(new Request(`${ORIGIN}/api/fame/list${query}`), deps);
const body = async (res: Response): Promise<Record<string, unknown>> => (await res.json()) as Record<string, unknown>;
/** Klucze bazy bez liczników limitu i soli. */
const dataKeys = (redis: MemoryRedis): string[] => redis.keys().filter((k) => !k.startsWith('tr:rl:') && !k.startsWith('tr:salt:'));

describe('POST /api/fame/submit: wpis do Galerii sław', () => {
  it('pierwszy wpis: 200 { first: true, place: 1, entry: { nick, at = chwila serwera } }, a ZSCORE listy to ta sama chwila', async () => {
    const { deps, redis } = setup();
    const res = await submit(deps, { nick: ' Mateusz ' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await body(res)).toEqual({ ok: true, first: true, place: 1, entry: { nick: 'Mateusz', at: NOW } });
    expect(await run(redis, ['ZSCORE', KEYS.fameList, 'mateusz'])).toBe(String(NOW));
    const stored = parseFameEntry((await run(redis, ['GET', KEYS.fameEntry('mateusz')])) as string);
    expect(stored).toEqual({ nick: 'Mateusz', seed: SEED, day: 412, cash: 1_034_500.5, simVersion: SIM_VERSION, at: NOW } satisfies FameEntry);
  });

  it('czas to chwila serwera: pola `at` z ciała zgłoszenia serwer nie czyta', async () => {
    const { deps } = setup();
    const res = await submit(deps, { at: 1, savedAt: 2 });
    expect(await body(res)).toEqual({ ok: true, first: true, place: 1, entry: { nick: 'Mateusz', at: NOW } });
  });

  it('drugi wpis tego nicka (inny klucz, inna kwota, później): first false, entry.at to pierwszy at, a wpis i lista bez zmian', async () => {
    const { deps, redis, clock } = setup();
    await submit(deps);
    const before = await redis.exec([['GET', KEYS.fameEntry('mateusz')], ['ZRANGE', KEYS.fameList, 0, -1, 'WITHSCORES']]);
    clock.now = NOW + 3_600_000;
    const res = await submit(deps, { key: KEY_B, nick: 'MATEUSZ', cash: 5_000_000, day: 700, seed: 'inny-1', simVersion: SIM_VERSION + 1 });
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: true, first: false, place: 1, entry: { nick: 'Mateusz', at: NOW } });
    expect(await redis.exec([['GET', KEYS.fameEntry('mateusz')], ['ZRANGE', KEYS.fameList, 0, -1, 'WITHSCORES']])).toEqual(before);
    expect(await run(redis, ['ZCARD', KEYS.fameList])).toBe(1);
  });

  it('powtórzenie tego samego wpisu przez ten sam klucz też jest bezpieczne (ponowienie po zerwanym połączeniu)', async () => {
    const { deps, clock } = setup();
    await submit(deps);
    clock.now += 5_000;
    expect(await body(await submit(deps))).toEqual({ ok: true, first: false, place: 1, entry: { nick: 'Mateusz', at: NOW } });
  });

  it('place: pierwszy nick 1, drugi 2, powtórka pierwszego nicka (inny klucz) znów 1 z first false, a powtórka drugiego 2; poza setką numer rośnie dalej', async () => {
    const { deps, redis, clock } = setup();
    const place = async (over: Record<string, unknown>): Promise<unknown> => {
      const res = await submit(deps, over);
      expect(res.status).toBe(200);
      const data = await body(res);
      return [data.first, data.place, (data.entry as { at: number }).at];
    };
    expect(await place({ nick: 'Pierwszy' })).toEqual([true, 1, NOW]);
    clock.now = NOW + 10_000;
    expect(await place({ nick: 'Drugi' })).toEqual([true, 2, NOW + 10_000]);
    clock.now = NOW + 20_000;
    expect(await place({ nick: 'PIERWSZY', key: KEY_B })).toEqual([false, 1, NOW]);   // miejsce istniejącego wpisu, nie nowe
    expect(await place({ nick: 'Drugi' })).toEqual([false, 2, NOW + 10_000]);
    expect(await run(redis, ['ZCARD', KEYS.fameList])).toBe(2);
    // sto kolejnych wpisów wprost w bazie: nowy nick jest 103., choć lista pokazuje tylko pierwsze sto
    await redis.exec(Array.from({ length: 100 }, (_, i) => ['ZADD', KEYS.fameList, NOW + 30_000 + i, `wstawiony${i}`]));
    clock.now = NOW + 40_000;
    expect(await place({ nick: 'Spozniony', key: KEY_C })).toEqual([true, 103, NOW + 40_000]);
    expect((await body(await list(deps))).rows).toHaveLength(100);
  });

  it('wpis zapisany bez wpisu na liście (zerwane zgłoszenie): kolejne zgłoszenie naprawia listę chwilą PIERWSZEGO wpisu', async () => {
    const { deps, redis, clock } = setup();
    const e: FameEntry = { nick: 'Mateusz', seed: SEED, day: 412, cash: 1_100_000, simVersion: SIM_VERSION, at: NOW - 86_400_000 };
    await run(redis, ['SET', KEYS.fameEntry('mateusz'), JSON.stringify(e)]);
    expect(await run(redis, ['ZCARD', KEYS.fameList])).toBe(0);
    clock.now = NOW;
    expect(await body(await submit(deps, { cash: 9_999_999 }))).toEqual({ ok: true, first: false, place: 1, entry: { nick: 'Mateusz', at: NOW - 86_400_000 } });
    expect(await run(redis, ['ZSCORE', KEYS.fameList, 'mateusz'])).toBe(String(NOW - 86_400_000));
    expect(parseFameEntry((await run(redis, ['GET', KEYS.fameEntry('mateusz')])) as string)).toEqual(e);
  });

  it('wiarygodność: day 89, 36 501, 1.5; cash 999 999, NaN, 1e13; simVersion 6, 7.5; seed "" i 49 znaków → 422 fame-invalid, w bazie tylko liczniki', async () => {
    const { deps, redis } = setup();
    const bad: Record<string, unknown>[] = [
      { day: 89 }, { day: 36_501 }, { day: 1.5 }, { day: '412' }, { day: null }, { day: -100 },
      { cash: 999_999 }, { cash: Number.NaN }, { cash: 1e13 }, { cash: '1000000' }, { cash: null }, { cash: -1_000_000 },
      { simVersion: 6 }, { simVersion: 7.5 }, { simVersion: 1000 }, { simVersion: '7' },
      { seed: '' }, { seed: 'a'.repeat(RUN_MAX_SEED_CHARS + 1) }, { seed: ' szarlotka-380' }, { seed: 'ab\u{200b}cd' }, { seed: 380 }, { seed: null },
    ];
    for (const over of bad) {
      const res = await submit(deps, over);
      expect(res.status, JSON.stringify(over)).toBe(422);
      expect(await body(res), JSON.stringify(over)).toEqual({ ok: false, error: 'fame-invalid', message: 'Centrala nie wierzy w ten milion. Wpis nie przeszedł kontroli.' });
    }
    for (const missing of ['seed', 'day', 'cash', 'simVersion']) {
      const { [missing]: _gone, ...rest } = entryBody();
      const res = await handleFameSubmit(post(rest), deps);
      expect(res.status, missing).toBe(422);
      expect((await body(res)).error, missing).toBe('fame-invalid');
    }
    expect(API_ERRORS['fame-invalid'].status).toBe(422);
    expect(dataKeys(redis)).toEqual([]);   // ani wpisu, ani listy, ani budżetu
  });

  it('wiarygodność: granice przedziałów włącznie przechodzą (day 90 i 36 500, cash 1e6 i 1e12, simVersion 7 i 999, seed 48 znaków)', async () => {
    const { deps } = setup();
    expect(FAME_DAY).toEqual([90, 36_500]);
    expect(FAME_CASH).toEqual([1_000_000, 1e12]);
    expect(FAME_SIM).toEqual([7, 999]);
    const edges: Record<string, unknown>[] = [
      { nick: 'Brzeg1', day: FAME_DAY[0] }, { nick: 'Brzeg2', day: FAME_DAY[1] },
      { nick: 'Brzeg3', cash: FAME_CASH[0] }, { nick: 'Brzeg4', cash: FAME_CASH[1] },
      { nick: 'Brzeg5', simVersion: FAME_SIM[0] }, { nick: 'Brzeg6', simVersion: FAME_SIM[1] },
      { nick: 'Brzeg7', seed: 'a'.repeat(RUN_MAX_SEED_CHARS) }, { nick: 'Brzeg8', seed: '🥐'.repeat(RUN_MAX_SEED_CHARS) },
    ];
    for (const [i, over] of edges.entries()) {
      const res = await submit(deps, { key: formatRecoveryCode(`K7QX9MBD2HFAP3WN${1000 + i}`), ...over }, { 'x-real-ip': `198.51.100.${i}` });
      expect(res.status, JSON.stringify(over)).toBe(200);
    }
    expect(await run(deps.redis, ['ZCARD', KEYS.fameList])).toBe(edges.length);
  });

  it('parseFameSubmission: wartości, których JSON nie przenosi (NaN, Infinity, -0), też są fame-invalid; obce pola odpadają; zły klucz i nick mają własne kody', () => {
    const ok = parseFameSubmission(entryBody({ nick: ' Mateusz ', obce: 'x' }));
    expect(ok).toEqual({
      ok: true, value: { key: 'K7QX9MBD2HFAP3WN8RTE', nick: 'Mateusz', nickKey: 'mateusz', seed: SEED, day: 412, cash: 1_034_500.5, simVersion: SIM_VERSION },
    });
    for (const over of [{ cash: Number.NaN }, { cash: Infinity }, { day: Number.NaN }, { day: Infinity }, { simVersion: Number.NaN }, { day: -0 }]) {
      expect(parseFameSubmission(entryBody(over)), JSON.stringify(over)).toEqual({ ok: false, error: 'fame-invalid' });
    }
    expect(parseFameSubmission(entryBody({ key: 'ZLY-KLUCZ' }))).toEqual({ ok: false, error: 'bad-key' });
    expect(parseFameSubmission(entryBody({ nick: 'a'.repeat(21) }))).toMatchObject({ error: 'bad-nick' });
    expect(parseFameSubmission(entryBody({ nick: 5 }))).toEqual({ ok: false, error: 'bad-request' });
    expect(parseFameSubmission(null)).toEqual({ ok: false, error: 'bad-request' });
    expect(parseFameSubmission([])).toEqual({ ok: false, error: 'bad-request' });
    const { key: _key, ...noKey } = entryBody();
    expect(parseFameSubmission(noKey)).toEqual({ ok: false, error: 'bad-request' });
  });

  it('kształt i rozmiar ciała: zły JSON i puste ciało to 400, za duże ciało 413, zła metoda 405 z Allow; nic nie trafia do bazy', async () => {
    const { deps, redis } = setup();
    expect((await handleFameSubmit(post('{nie json'), deps)).status).toBe(400);
    expect((await handleFameSubmit(post('[]'), deps)).status).toBe(400);
    expect((await handleFameSubmit(new Request(`${ORIGIN}/api/fame/submit`, { method: 'POST', headers: { 'x-real-ip': '203.0.113.7' } }), deps)).status).toBe(400);
    const big = await handleFameSubmit(post(entryBody({ seed: 'a'.repeat(SMALL_BODY_BYTES) })), deps);
    expect(big.status).toBe(413);
    expect((await body(big)).error).toBe('too-large');
    expect((await body(await submit(deps, { key: 'ZLY-KLUCZ' }))).error).toBe('bad-key');
    expect((await body(await submit(deps, { nick: 'Centrala' }))).error).toBe('bad-nick');
    const get = await handleFameSubmit(new Request(`${ORIGIN}/api/fame/submit`), deps);
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect(dataKeys(redis)).toEqual([]);
  });

  it('nick zarezerwowany przez innego właściciela: 409 nick-taken; własny i wolny przechodzą; wolny NIE jest rezerwowany', async () => {
    const { deps, redis } = setup();
    await claimNick(redis, 'Zajety', 'zajety', await ownerOf('K7QX9MBD2HFAP3WN8RTE'), NOW);
    await claimNick(redis, 'Wlasny', 'wlasny', await ownerOf('M2N3P4Q5R6S7T8V9W0XY'), NOW);
    const taken = await submit(deps, { key: KEY_B, nick: 'ZAJETY' });
    expect(taken.status).toBe(409);
    expect(await body(taken)).toEqual({ ok: false, error: 'nick-taken', message: 'Ten nick jest zajęty' });
    expect(await run(redis, ['EXISTS', KEYS.fameEntry('zajety')])).toBe(0);
    expect(await run(redis, ['ZCARD', KEYS.fameList])).toBe(0);
    expect(await run(redis, ['EXISTS', KEYS.budget('fame', '2026-11-03')])).toBe(0);   // odrzucone zgłoszenie nie zużywa budżetu
    expect((await submit(deps, { key: KEY_B, nick: 'Wlasny' })).status).toBe(200);
    expect((await submit(deps, { key: KEY_B, nick: 'Wolny' })).status).toBe(200);
    expect(await run(redis, ['EXISTS', KEYS.nick('wolny')])).toBe(0);
    expect(redis.keys().filter((k) => k.startsWith('tr:nick:'))).toEqual(['tr:nick:wlasny', 'tr:nick:zajety']);   // tylko dwie rezerwacje z claimNick
    expect(await run(redis, ['SMEMBERS', KEYS.ownerNicks(await ownerOf('M2N3P4Q5R6S7T8V9W0XY'))])).toEqual(['wlasny']);
    expect(await run(redis, ['ZCARD', KEYS.fameList])).toBe(2);
  });

  it('wygasła rezerwacja cudzego nicka nie blokuje wpisu', async () => {
    const { deps, redis, clock } = setup();
    await claimNick(redis, 'Dawny', 'dawny', await ownerOf('K7QX9MBD2HFAP3WN8RTE'), NOW);
    clock.now = NOW + 366 * 86_400_000;
    expect((await submit(deps, { key: KEY_B, nick: 'Dawny' })).status).toBe(200);
  });

  it('limit: szósty POST tego klucza w godzinie to 429 rate-limited z retry-after do końca okna, a wpisy z limitu nie powstają', async () => {
    const { deps, redis, clock } = setup();
    expect(RATE_LIMITS.fame).toEqual({ window: 3_600, perKey: 5, perAddress: 20 });
    for (let i = 0; i < 5; i++) expect((await submit(deps, { nick: `Gracz${i}` })).status).toBe(200);
    clock.now = NOW + 600_000;   // 12:10, okno godzinne kończy się o 13:00
    const sixth = await submit(deps, { nick: 'Gracz5' });
    expect(sixth.status).toBe(429);
    expect(await body(sixth)).toEqual({ ok: false, error: 'rate-limited', message: API_ERRORS['rate-limited'].message });
    expect(sixth.headers.get('retry-after')).toBe('3000');
    expect(await run(redis, ['EXISTS', KEYS.fameEntry('gracz5')])).toBe(0);
    expect((await submit(deps, { key: KEY_B, nick: 'Gracz6' }, { 'x-real-ip': '203.0.113.8' })).status).toBe(200);   // inny klucz i adres
    clock.now = NOW + 3_600_000;
    expect((await submit(deps, { nick: 'Gracz5' })).status).toBe(200);   // nowe okno
  });

  it('limit na adres: 21. POST z jednego adresu w godzinie to 429, choć każdy ma inny klucz', async () => {
    const { deps } = setup();
    const keys = Array.from({ length: 21 }, (_, i) => formatRecoveryCode(`K7QX9MBD2HFAP3WN${String(1000 + i)}`));
    for (let i = 0; i < 20; i++) expect((await submit(deps, { key: keys[i], nick: `Adres${i}` })).status, String(i)).toBe(200);
    const last = await submit(deps, { key: keys[20], nick: 'Adres20' });
    expect(last.status).toBe(429);
    expect((await body(last)).error).toBe('rate-limited');
  });

  it('zepsute zgłoszenie nie zużywa limitu (kształt i wiarygodność sprawdzane przed licznikiem, jak w POST /api/runs)', async () => {
    const { deps } = setup();
    for (let i = 0; i < 8; i++) expect((await submit(deps, { day: 10 })).status).toBe(422);
    for (let i = 0; i < 5; i++) expect((await submit(deps, { nick: `Dobry${i}` })).status).toBe(200);
    expect((await submit(deps, { nick: 'Dobry5' })).status).toBe(429);
  });

  it('budżet dobowy: 300. wpis w dobie przechodzi, 301. to 429 fame-budget z retry-after do północy UTC; bez wpisu i bez zużycia limitu klucza', async () => {
    const { deps, redis, clock } = setup();
    const budgetKey = KEYS.budget('fame', '2026-11-03');
    await run(redis, ['SET', budgetKey, String(FAME_DAILY_BUDGET - 2)]);
    expect((await submit(deps, { nick: 'Przedostatni' })).status).toBe(200);   // 299.
    expect((await submit(deps, { nick: 'Ostatni' })).status).toBe(200);        // 300.
    const over = await submit(deps, { nick: 'Za' + 'Duzo' });
    expect(over.status).toBe(429);
    expect(await body(over)).toEqual({ ok: false, error: 'fame-budget', message: 'Galeria sław jest na dziś pełna. Wpisz się jutro.' });
    expect(Number(over.headers.get('retry-after'))).toBe(12 * 3_600);
    expect(API_ERRORS['fame-budget'].status).toBe(429);
    expect(await run(redis, ['EXISTS', KEYS.fameEntry('zaduzo')])).toBe(0);
    expect(await run(redis, ['ZCARD', KEYS.fameList])).toBe(2);
    // inny klucz i adres też dostaje odmowę: budżet jest wspólny
    expect((await submit(deps, { key: KEY_B, nick: 'Inny' }, { 'x-real-ip': '198.51.100.9' })).status).toBe(429);
    // następnej doby budżet liczy się od nowa (nazwa klucza ma dzień)
    clock.now = Date.UTC(2026, 10, 4, 0, 0, 1);
    expect((await submit(deps, { key: KEY_C, nick: 'Jutro' })).status).toBe(200);
    expect(await run(redis, ['GET', KEYS.budget('fame', '2026-11-04')])).toBe('1');
  });

  it('klucze galerii mają przedrostek tr:fame:, nie zawierają SIM_VERSION ani sezonu, a wpisy nie mają czasu życia', async () => {
    const { deps, redis } = setup();
    expect(KEYS.fameList).toBe('tr:fame:list');
    expect(KEYS.fameEntry('mateusz')).toBe('tr:fame:e:mateusz');
    await submit(deps);
    await submit(deps, { key: KEY_B, nick: 'Mateusz', simVersion: SIM_VERSION + 1 });   // inna wersja symulacji w ciele: ten sam klucz
    const fame = dataKeys(redis).filter((k) => k.startsWith('tr:fame:'));
    expect(fame).toEqual(['tr:fame:e:mateusz', 'tr:fame:list']);
    expect(fame.some((k) => /\d|lb|week|seed/.test(k))).toBe(false);
    // poza Galerią tylko budżet dobowy: żadnych kluczy rankingu (tr:lb:, tr:entry:, tr:nick:) ani rezerwacji nicka
    expect(dataKeys(redis).filter((k) => !k.startsWith('tr:fame:'))).toEqual(['tr:budget:fame:2026-11-03']);
    expect(await redis.exec([['PTTL', KEYS.fameList], ['PTTL', KEYS.fameEntry('mateusz')]])).toEqual([-1, -1]);
  });
});

describe('GET /api/fame/list: lista Galerii', () => {
  it('trzy wpisy w kolejności at rosnąco, place 1..3, bez seed i cash w wierszu; cache publiczny jak ranking', async () => {
    const { deps, clock } = setup();
    clock.now = NOW + 20_000;
    await submit(deps, { key: KEY_A, nick: 'Druga', cash: 2_222_222 });
    clock.now = NOW;
    await submit(deps, { key: KEY_B, nick: 'Pierwsza', cash: 1_111_111 });
    clock.now = NOW + 90_000;
    await submit(deps, { key: KEY_C, nick: 'Trzecia', cash: 3_333_333 });
    const res = await list(deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=30, stale-while-revalidate=30');
    const data = await body(res);
    expect(data).toEqual({
      ok: true, total: 3,
      rows: [{ place: 1, nick: 'Pierwsza', at: NOW }, { place: 2, nick: 'Druga', at: NOW + 20_000 }, { place: 3, nick: 'Trzecia', at: NOW + 90_000 }],
    });
    expect(JSON.stringify(data)).not.toMatch(/seed|cash|szarlotka|day|simVersion|key/);
  });

  it('pusta Galeria: total 0 i brak wierszy', async () => {
    expect(await body(await list(setup().deps))).toEqual({ ok: true, total: 0, rows: [] });
  });

  it('inny parametr zapytania (także limit, board, pusty klucz) to 400 bez zapytania do bazy; sam znak zapytania przechodzi', async () => {
    const { deps, redis } = setup();
    // `?&`, `?&&`… nie mają nazw parametrów, ale to inne adresy w pamięci podręcznej Vercela, więc też są odrzucane
    for (const query of ['?limit=10', '?board=global', '?a=1&b=2', '?=', '?seed=x', '?&', '?&&', '?&&&']) {
      const res = await list(deps, query);
      expect(res.status, query).toBe(400);
      expect((await body(res)).error, query).toBe('bad-request');
      expect(res.headers.get('cache-control'), query).toBe('no-store');
    }
    expect(redis.calls).toBe(0);
    expect((await list(deps, '?')).status).toBe(200);
  });

  it('zła metoda: 405 z Allow: GET', async () => {
    const res = await handleFameList(new Request(`${ORIGIN}/api/fame/list`, { method: 'POST', body: '{}' }), setup().deps);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });

  it('lista ma najwyżej 100 wierszy (najwcześniejsze), a total liczy wszystkie wpisy; czyta bazą do odczytu', async () => {
    const { deps, redis } = setup();
    expect(FAME_LIST_MAX).toBe(100);
    const commands = Array.from({ length: 130 }, (_, i) => ['ZADD', KEYS.fameList, NOW + (129 - i) * 1000, `n${String(i).padStart(3, '0')}`]);
    await redis.exec(commands);   // wstawione od końca: lista ma i tak iść po at
    await redis.exec(Array.from({ length: 130 }, (_, i) => ['SET', KEYS.fameEntry(`n${String(i).padStart(3, '0')}`), JSON.stringify({
      nick: `Nick${i}`, seed: SEED, day: 100, cash: 1_000_000, simVersion: SIM_VERSION, at: NOW + (129 - i) * 1000,
    })]));
    const reader = new MemoryRedis(() => NOW);
    const data = await body(await list({ ...deps, readRedis: redis }));
    expect(data.total).toBe(130);
    const rows = data.rows as { place: number; nick: string; at: number }[];
    expect(rows).toHaveLength(100);
    expect(rows[0]).toEqual({ place: 1, nick: 'Nick129', at: NOW });
    expect(rows[99]).toEqual({ place: 100, nick: 'Nick30', at: NOW + 99_000 });
    expect(rows.every((r, i) => r.place === i + 1 && (i === 0 || r.at >= rows[i - 1]!.at))).toBe(true);
    // inna baza do odczytu: lista bierze dane stamtąd, a nie z bazy zapisu
    expect(await body(await list({ ...deps, readRedis: reader }))).toEqual({ ok: true, total: 0, rows: [] });
  });
});

describe('readFame i recordFame', () => {
  const entry = (at: number, nick = 'Mateusz'): FameEntry => ({ nick, seed: SEED, day: 200, cash: 1_000_000, simVersion: SIM_VERSION, at });

  it('wpis bez danych (nie powinien się zdarzyć) pokazuje klucz nicka, a wpis z uszkodzonym JSON-em też', async () => {
    const redis = new MemoryRedis(() => NOW);
    await redis.exec([['ZADD', KEYS.fameList, 10, 'bez-wpisu'], ['ZADD', KEYS.fameList, 20, 'zepsuty'], ['ZADD', KEYS.fameList, 30, 'dobry'],
      ['SET', KEYS.fameEntry('zepsuty'), '{nie json'], ['SET', KEYS.fameEntry('dobry'), JSON.stringify(entry(30, 'Dobry'))]]);
    expect(await readFame(redis)).toEqual({
      total: 3, rows: [{ place: 1, nick: 'bez-wpisu', at: 10 }, { place: 2, nick: 'zepsuty', at: 20 }, { place: 3, nick: 'Dobry', at: 30 }],
    });
  });

  it('remis chwil: kolejność po kluczu nicka, miejsca kolejne (bez remisów)', async () => {
    const redis = new MemoryRedis(() => NOW);
    await redis.exec([['ZADD', KEYS.fameList, 5, 'b'], ['ZADD', KEYS.fameList, 5, 'a'], ['ZADD', KEYS.fameList, 5, 'c']]);
    expect((await readFame(redis)).rows.map((r) => [r.place, r.nick])).toEqual([[1, 'a'], [2, 'b'], [3, 'c']]);
  });

  it('recordFame: pierwszy zapis dwoma zapytaniami, a wpis, który już jest, zostaje bez zmian', async () => {
    const redis = new MemoryRedis(() => NOW);
    expect(await recordFame(redis, 'mateusz', entry(NOW))).toEqual({ first: true, entry: entry(NOW), place: 1 });
    expect(redis.calls).toBe(2);
    const later = { ...entry(NOW + 1), cash: 7_000_000, seed: 'inny-2' };
    expect(await recordFame(redis, 'mateusz', later)).toEqual({ first: false, entry: entry(NOW), place: 1 });
    expect(asScored(await run(redis, ['ZRANGE', KEYS.fameList, 0, -1, 'WITHSCORES']))).toEqual([{ member: 'mateusz', score: NOW }]);
  });

  it('recordFame: uszkodzony wpis w bazie to błąd bazy (500), a nie nadpisanie; wpis, który zniknął między poleceniami, dostaje drugą próbę', async () => {
    const redis = new MemoryRedis(() => NOW);
    await run(redis, ['SET', KEYS.fameEntry('mateusz'), '{nie json']);
    await expect(recordFame(redis, 'mateusz', entry(NOW))).rejects.toBeInstanceOf(RedisError);
    expect(await run(redis, ['GET', KEYS.fameEntry('mateusz')])).toBe('{nie json');
    expect(await run(redis, ['ZCARD', KEYS.fameList])).toBe(0);

    // SET NX „przegrywa”, ale GET w tym samym zapytaniu nie widzi już wpisu (ktoś go usunął): druga próba zapisuje
    const flaky = new MemoryRedis(() => NOW);
    let first = true;
    const exec = flaky.exec.bind(flaky);
    vi.spyOn(flaky, 'exec').mockImplementation(async (commands) => {
      if (first) {
        first = false;
        return [null, null];
      }
      return exec(commands);
    });
    expect(await recordFame(flaky, 'mateusz', entry(NOW))).toEqual({ first: true, entry: entry(NOW), place: 1 });
    expect(await run(flaky, ['ZSCORE', KEYS.fameList, 'mateusz'])).toBe(String(NOW));
  });

  it('parseFameEntry: tylko pełny wpis z liczbami skończonymi', () => {
    const e = entry(NOW);
    expect(parseFameEntry(JSON.stringify(e))).toEqual(e);
    expect(parseFameEntry(null)).toBeNull();
    expect(parseFameEntry('[]')).toBeNull();
    expect(parseFameEntry(JSON.stringify({ ...e, at: 'teraz' }))).toBeNull();
    expect(parseFameEntry(JSON.stringify({ ...e, cash: null }))).toBeNull();
    expect(parseFameEntry(JSON.stringify({ ...e, nick: 5 }))).toBeNull();
    expect(parseFameEntry(JSON.stringify({ nick: 'x' }))).toBeNull();
  });
});

describe('wyłącznik rankingu obejmuje Galerię (route)', () => {
  const env = { KV_REST_API_URL: 'https://atrapa.upstash.test', KV_REST_API_TOKEN: 'atrapa-token-zapisu' };

  it('route bez RANKING_ENABLED: 503 ranking-off dla obu ścieżek; z RANKING_ENABLED, a bez bazy: 503 not-configured; ani jednego fetch', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('nie powinno być', { status: 500 }));
    const calls = (e: Record<string, string | undefined>) => [
      route(handleFameList, { env: () => e, fetch: fetchSpy })(new Request(`${ORIGIN}/api/fame/list`)),
      route(handleFameSubmit, { env: () => e, fetch: fetchSpy })(post(entryBody())),
    ];
    for (const res of await Promise.all(calls({}))) {
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await body(res)).error).toBe('ranking-off');
    }
    for (const res of await Promise.all(calls(env))) expect((await body(res)).error).toBe('ranking-off');
    for (const res of await Promise.all(calls({ RANKING_ENABLED: '1' }))) {
      expect(res.status).toBe(503);
      expect(await body(res)).toEqual({ ok: false, error: 'not-configured', message: API_ERRORS['not-configured'].message });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
