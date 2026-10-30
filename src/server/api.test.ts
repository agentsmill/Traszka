import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RANKED_SEASON_END_MINUTE, RANKED_SEASON_MONTHS, seasonScore } from '@/sim/ranked';
import { replayRun, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { GET as leaderboard } from '../../api/leaderboard';
import { POST as player } from '../../api/player';
import { POST as runs } from '../../api/runs';
import { POST as download } from '../../api/save/download';
import { POST as upload } from '../../api/save/upload';
import { KNOWN_GENERATOR_VERSIONS, RATE_LIMITS } from './config';
import { depsFromEnv, route } from './env';
import { API_ERRORS } from './errors';
import { fakeUpstash, type FakeUpstash } from './fakeUpstash';
import { handlePlayer, handleRuns } from './http';
import { MemoryRedis } from './memoryRedis';
import { createRateGate } from './rateLimit';
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
/** Czy na dysku leży bundle sędziego (`npm run build:judge`): od tego zależy, który z dwóch testów `api/runs.ts` się wykonuje. */
const bundleOnDisk = existsSync(resolve(__dirname, 'judgeBundle.js'));
const run = { seed: 'pierogi-731', gameVersion: '0.0.0+abc123def456', generatorVersion: KNOWN_GENERATOR_VERSIONS[0], simVersion: 1, mode: 'ranked', log: [] };

describe('api/** na Vercelu (atrapa Upstash przez fetch)', () => {
  it('ranking czyta tylko tokenem do odczytu', async () => {
    const res = await leaderboard(new Request(`${ORIGIN}/api/leaderboard?board=global`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, board: 'global', rows: [] });
    expect(upstash.log.length).toBeGreaterThan(0);
    expect(upstash.log.every((l) => l.token === 'ro')).toBe(true);
  });

  it('atrapa: token tylko do odczytu odrzuca polecenia zapisu limitu (SET, INCR, PEXPIRE) jako NOPERM, a odczyt przepuszcza', async () => {
    const ask = async (token: string): Promise<{ result?: unknown; error?: string }[]> => {
      const res = await upstash.fetch(`${URL_}/pipeline`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify([['SET', 'k', '0'], ['INCR', 'k'], ['PEXPIRE', 'k', '1000'], ['GET', 'k']]),
      });
      return await res.json() as { result?: unknown; error?: string }[];
    };
    const readOnly = await ask(RO);
    expect(readOnly.slice(0, 3).every((r) => /^NOPERM/.test(r.error ?? ''))).toBe(true);
    expect(readOnly[3]).toEqual({ result: null });
    expect(redis.keys()).toEqual([]);
    expect(await ask(RW)).toEqual([{ result: 'OK' }, { result: 1 }, { result: 1 }, { result: '1' }]);
  });

  it('bez tokenu do odczytu ranking czyta zwykłym tokenem', async () => {
    vi.stubEnv('KV_REST_API_READ_ONLY_TOKEN', '');
    expect((await leaderboard(new Request(`${ORIGIN}/api/leaderboard`))).status).toBe(200);
    expect(upstash.log.every((l) => l.token === 'rw')).toBe(true);
  });

  // `api/runs.ts` ładuje bundle sędziego z `src/server/judgeBundle.js` (budowany przez `npm run build:judge`, w repozytorium go nie ma;
  // CI puszcza `npm test` przed buildem). Dwa testy poniżej są sobie przeciwne i dokładnie jeden z nich się wykonuje: bez bundla na dysku
  // sprawdzamy 503 „sędzia się szkoli”, z bundlem prawdziwą drogę przez `api/runs.ts`. Bundle na prawdziwym kodzie sprawdza też
  // tests/judgeBundle.test.ts (buduje własny), a wstrzyknięcie braku bundla do `route` src/server/judge.test.ts.
  it.skipIf(bundleOnDisk)(
    'bez zbudowanego bundla sędziego: 503 „sędzia się szkoli” i wpis w logu, a w bazie tylko liczniki limitu', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const res = await runs(post('/api/runs', { key: KEY, nick: 'Mateusz', run }));
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, error: 'replay-unavailable' });
      expect(redis.keys().every((k) => k.startsWith('tr:rl:') || k.startsWith('tr:salt:'))).toBe(true);
      expect(errors).toHaveBeenCalledTimes(1);
      expect(errors.mock.calls[0]![0]).toBe('[ranking] sędzia');
      errors.mockRestore();
    },
  );

  // Gdy test poniżej czerwieni się wynikiem innym niż policzony z src/sim albo 409 `old-version`, bundle na dysku jest nieświeży
  // (zbudowany ze starszego kodu symulacji): `npm run build:judge` (albo `npm run build`) go odświeża.
  it.runIf(bundleOnDisk)(
    'ze zbudowanym bundlem sędziego: poprawny bieg bierny przez api/runs.ts daje 200, a score to wynik policzony wprost z src/sim', async () => {
      const passive: RunRecord = { seed: run.seed, gameVersion: run.gameVersion, generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log: [] };
      const expected = seasonScore(replayRun(passive, RANKED_SEASON_END_MINUTE));
      expect(expected).not.toBe(0);   // wynik zerowy nie odróżniłby sędziego, który nic nie liczy
      // własny klucz i adres: bramka `api/runs.ts` jest wspólna dla testów tego pliku, a wyczerpany limit trwa do końca okna
      const own = new Request(`${ORIGIN}/api/runs`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.88' },
        body: JSON.stringify({ key: 'P3WN-8RTE-K7QX-9MBD-2HFA', nick: 'Mateusz', run: passive }),
      });
      const res = await runs(own);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, score: expected, best: expected, ranks: { global: 1, seed: 1 } });
      const board = await (await leaderboard(new Request(`${ORIGIN}/api/leaderboard?board=global`))).json() as { rows: { nick: string; score: number }[] };
      expect(board.rows.map((r) => [r.nick, r.score])).toEqual([['Mateusz', expected]]);
    }, 60_000,
  );

  // Reguła z 2026-10-29: bieg zakończony bankructwem przed końcem sezonu nie wchodzi do rankingu, choćby miał raporty. Prawdziwy bundle,
  // prawdziwa droga przez `api/runs.ts`; bez bundla na dysku ten przypadek pokrywa tests/judgeBundle.test.ts (buduje własny).
  it.runIf(bundleOnDisk)(
    'ze zbudowanym bundlem sędziego: bieg, który bankrutuje przed końcem sezonu, dostaje 422 season-bankrupt, a nick i ranking zostają puste', async () => {
      // osiem osób na zmianie i zamówienia ręczne na maksa od pierwszego dnia: gotówka schodzi poniżej granicy debetu (od SIM_VERSION 5
      // −100 tys. zł), zanim sklep zdąży zarobić
      const bankrupt: RunRecord = {
        seed: run.seed, gameVersion: run.gameVersion, generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked',
        log: [
          ...Array.from({ length: 6 }, (_, i) => ({ minute: 360, seq: i, cmd: { type: 'hire' } as const })),
          { minute: 360, seq: 6, cmd: { type: 'setOrder', auto: false, manual: 30 } },
        ],
      };
      const state = replayRun(bankrupt, RANKED_SEASON_END_MINUTE);
      expect(state.gameOver, 'dziennik naprawdę kończy grę').toBe(true);
      expect(state.minute).toBeLessThan(RANKED_SEASON_END_MINUTE);
      expect(state.history.length, 'koniec gry przed ostatnim raportem').toBeLessThan(RANKED_SEASON_MONTHS);

      const own = new Request(`${ORIGIN}/api/runs`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.77' },
        body: JSON.stringify({ key: 'M2N3-P4Q5-R6S7-T8V9-W0XY', nick: 'Bankrut', run: bankrupt }),
      });
      const res = await runs(own);
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ ok: false, error: 'season-bankrupt', message: 'Sezon zakończony bankructwem nie trafia do rankingu.' });
      // nic w bazie poza licznikami limitu: ani nick, ani wynik
      expect(redis.keys().every((k) => k.startsWith('tr:rl:') || k.startsWith('tr:salt:'))).toBe(true);
      const board = await (await leaderboard(new Request(`${ORIGIN}/api/leaderboard?board=global`))).json() as { rows: unknown[] };
      expect(board.rows).toEqual([]);
      const other = await (await player(post('/api/player', { key: KEY, nick: 'Bankrut' }))).json();
      expect(other).toMatchObject({ ok: true, nick: { nick: 'Bankrut', status: 'free' } });
    }, 60_000,
  );

  // Ta sama reguła od drugiej strony: gra, która kończy się dopiero przy zamknięciu 30 listopada, ma trzy raporty, więc wchodzi do rankingu,
  // a jej wynik zawiera listopadową stratę (debet z ostatniego zamknięcia jest już w raporcie).
  it.runIf(bundleOnDisk)(
    'ze zbudowanym bundlem sędziego: bieg z debetem dopiero przy zamknięciu listopada (trzy raporty) jest przyjęty, a wynik zawiera listopadową stratę', async () => {
      // od SIM_VERSION 5 (granica debetu −100 tys. zł) bierny sezon tego sklepu przeżywa: 30 palet dziennie od 25 października i osiem
      // osób od 26 października sprowadzają go poniżej granicy dopiero przy zamknięciu 30 listopada (ten sam bieg w src/sim/ranked.test.ts)
      const lateDebt: RunRecord = {
        seed: 'kiełbasa-42', gameVersion: run.gameVersion, generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked',
        log: [
          { minute: 55 * 1440 + 9 * 60, seq: 0, cmd: { type: 'setOrder', auto: false, manual: 30 } },
          ...Array.from({ length: 6 }, (_, i) => ({ minute: 56 * 1440 + 9 * 60 + i, seq: 1 + i, cmd: { type: 'hire' } as const })),
        ],
      };
      const state = replayRun(lateDebt, RANKED_SEASON_END_MINUTE);
      expect(state.gameOver, 'ostatnie zamknięcie kończy grę (jeśli ekonomia się zmieniła, dobierz inny sklep)').toBe(true);
      expect(state.history).toHaveLength(RANKED_SEASON_MONTHS);
      const expected = seasonScore(state);
      expect(expected).toBe(Math.round(state.history[0]!.profit + state.history[1]!.profit + state.history[2]!.profit));
      expect(state.history[2]!.profit, 'listopad kończy się stratą').toBeLessThan(0);
      expect(expected).toBeLessThan(Math.round(state.history[0]!.profit + state.history[1]!.profit));

      const own = new Request(`${ORIGIN}/api/runs`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.66' },
        body: JSON.stringify({ key: 'M3N4-P5Q6-R7S8-T9V0-W1XY', nick: 'Listopad', run: lateDebt }),
      });
      const res = await runs(own);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, score: expected, best: expected });
      const board = await (await leaderboard(new Request(`${ORIGIN}/api/leaderboard?board=global`))).json() as { rows: { nick: string; score: number }[] };
      expect(board.rows.map((r) => [r.nick, r.score])).toContainEqual(['Listopad', expected]);
    }, 60_000,
  );

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

  it('zapis pyta o nowszą kopię: 409 save-conflict z savedAt, bez zapisu i bez zużycia budżetu; zgodny expected i force przechodzą', async () => {
    // własny klucz i adres: bramka api/save/upload.ts jest wspólna dla testów tego pliku, a wyczerpany limit trwa do końca okna
    vi.stubEnv('RANKING_SALT', 'sekretny-ciag-0123456789');   // z sekretem limit to same INCR i PEXPIRE, więc w logu widać tylko to, co robi sam zapis
    const own = 'W0XY-M2N3-P4Q5-R6S7-T8V9';
    const send = (extra: Record<string, unknown>, save = testBundle()) => upload(new Request(`${ORIGIN}/api/save/upload`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.99' }, body: JSON.stringify({ key: own, save, ...extra }),
    }));
    const budget = async (): Promise<number> => {
      const values = await Promise.all(redis.keys().filter((k) => k.startsWith('tr:budget:save:')).map(async (k) => Number((await redis.exec([['GET', k]]))[0])));
      return values.reduce((a, b) => a + b, 0);
    };
    const first = await (await send({})).json() as { ok: boolean; savedAt: number };
    expect(first.ok).toBe(true);
    expect(await budget()).toBe(1);
    const asked = upstash.log.length;
    const stale = await send({ expected: null }, testBundle({ seed: 'bigos-111' }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ ok: false, error: 'save-conflict', message: API_ERRORS['save-conflict'].message, savedAt: first.savedAt });
    // konflikt: limit (INCR i PEXPIRE na adresie i kluczu), potem sam początek wpisu (GETRANGE, nie GET) tokenem zapisu; ani SET, ani licznik budżetu
    const during = upstash.log.slice(asked);
    expect(during.flatMap((l) => l.commands)).toEqual(['INCR', 'PEXPIRE', 'INCR', 'PEXPIRE', 'GETRANGE']);
    expect(during.every((l) => l.token === 'rw')).toBe(true);
    expect(await budget()).toBe(1);
    expect(await (await download(post('/api/save/download', { key: own }))).json()).toMatchObject({ ok: true, save: testBundle(), savedAt: first.savedAt });
    const forced = await send({ expected: null, force: true }, testBundle({ seed: 'bigos-111' }));
    expect(forced.status).toBe(200);
    const forcedAt = (await forced.json() as { savedAt: number }).savedAt;
    expect(await budget()).toBe(2);
    expect((await send({ expected: forcedAt }, testBundle({ seed: 'golabki-222' }))).status).toBe(200);
    expect(await budget()).toBe(3);
    expect((await send({ expected: 'x' })).status).toBe(400);
    expect(await budget()).toBe(3);
  });

  it('atrapa: token tylko do odczytu może wykonać GETRANGE (polecenie odczytu), choć sam handler zapisu używa tokenu zapisu', async () => {
    await redis.exec([['SET', 'k', '1700000000000\n{"a":1}']]);
    const ask = async (token: string): Promise<{ result?: unknown; error?: string }[]> => {
      const res = await upstash.fetch(`${URL_}/pipeline`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify([['GETRANGE', 'k', '0', '24'], ['GETRANGE', 'brak', '0', '24']]),
      });
      return await res.json() as { result?: unknown; error?: string }[];
    };
    expect(await ask(RO)).toEqual([{ result: '1700000000000\n{"a":1}' }, { result: '' }]);
    expect(await ask(RW)).toEqual([{ result: '1700000000000\n{"a":1}' }, { result: '' }]);
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

  it('baza nie oddaje soli okna limitu: 500 „server” i wpis w logu, a do liczników nie dochodzi (ani skrót z pustą solą, ani przepuszczenie)', async () => {
    const lost = vi.fn<typeof fetch>(async () => Response.json([{ result: null }, { result: null }]));
    vi.stubGlobal('fetch', lost);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await player(post('/api/player', { key: KEY, nick: 'Mateusz' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, error: 'server' });
    expect(lost).toHaveBeenCalledTimes(1);   // tylko zapytanie o sól
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]).toEqual(['[ranking]', 'RedisError: Limiter: baza nie oddała soli okna']);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('203.0.113.7');
    errors.mockRestore();
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

/**
 * Bramka limitu to pamięć instancji funkcji: `route(...)` tworzy ją raz (plik `api/*.ts` ładuje się raz na instancję), a nie przy
 * każdym żądaniu. Pliki `api/*.ts` w tym teście są ładowane raz na cały plik testowy, więc ich bramka jest wspólna dla testów,
 * a baza w każdym teście nowa: testy, które wyczerpują limit, używają własnego klucza i adresu, żeby nie psuć pozostałych.
 */
describe('bramka limitu w pamięci instancji: route tworzy ją raz na instancję', () => {
  const KEY2 = 'M2N3-P4Q5-R6S7-T8V9-W0XY';
  const playerReq = (ip: string, key = KEY2): Request => new Request(`${ORIGIN}/api/player`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ key }),
  });
  const envOf = () => ({ RANKING_ENABLED: '1', KV_REST_API_URL: URL_, KV_REST_API_TOKEN: RW });
  // Stała chwila, sekunda po początku okna (okna to wielokrotności 600 s od epoki): seria żądań nie może przeskoczyć granicy okna i przerwać odliczania.
  const T0 = Date.UTC(2026, 9, 29, 12, 0, 1);
  const KEY3 = 'W0XY-M2N3-P4Q5-R6S7-T8V9';
  const exhaust = async (handler: (r: Request) => Promise<Response>, key = KEY2): Promise<void> => {
    for (let i = 0; i < RATE_LIMITS.player.perKey; i++) expect((await handler(playerReq(`192.0.2.${i}`, key))).status, `żądanie ${i + 1}`).toBe(200);
    expect((await handler(playerReq('192.0.2.200', key))).status).toBe(429);   // tę odrzuca baza
  };

  it('po odmowie bazy kolejne żądania przez ten sam route (nowe adresy, ten sam klucz) nie wołają fetch: 429 z Retry-After', async () => {
    const handler = route(handlePlayer, { env: envOf, now: () => T0, fetch: fetchSpy });
    await exhaust(handler);
    const [sent, logged] = [fetchSpy.mock.calls.length, upstash.log.length];
    for (let i = 0; i < 100; i++) {
      const res = await handler(playerReq(`192.0.3.${i}`));
      expect(res.status).toBe(429);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    expect([fetchSpy.mock.calls.length, upstash.log.length]).toEqual([sent, logged]);
  });

  it('osobne wywołanie route to osobna pamięć (własna bramka), a bramka z RouteOptions może być wspólna', async () => {
    await exhaust(route(handlePlayer, { env: envOf, now: () => T0, fetch: fetchSpy, rateGate: createRateGate() }));
    const calls = () => fetchSpy.mock.calls.length;
    const before = calls();
    expect((await route(handlePlayer, { env: envOf, now: () => T0, fetch: fetchSpy })(playerReq('192.0.4.1'))).status).toBe(429);
    expect(calls() - before).toBe(2);   // nowa instancja pyta bazę (sól, liczniki) i dopiero tę odmowę zapamiętuje
    const shared = createRateGate();
    await exhaust(route(handlePlayer, { env: envOf, now: () => T0, fetch: fetchSpy, rateGate: shared }), KEY3);
    const other = route(handlePlayer, { env: envOf, now: () => T0, fetch: fetchSpy, rateGate: shared });
    const again = calls();
    expect((await other(playerReq('192.0.4.2', KEY3))).status).toBe(429);
    expect(calls()).toBe(again);
  });

  it('wyłączony ranking nie dotyka ani bazy, ani bramki', async () => {
    const gate = createRateGate();
    const handler = route(handlePlayer, { env: () => ({ KV_REST_API_URL: URL_, KV_REST_API_TOKEN: RW }), fetch: fetchSpy, rateGate: gate });
    expect((await handler(playerReq('192.0.5.1'))).status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(gate.size).toBe(0);
  });

  it('depsFromEnv bez bramki w opcjach jej nie dodaje (handlery wołane wprost zachowują się jak dotąd)', () => {
    expect(depsFromEnv({ ...envOf() })!.rateGate).toBeUndefined();
    const gate = createRateGate();
    expect(depsFromEnv({ ...envOf() }, { rateGate: gate })!.rateGate).toBe(gate);
  });
});

/**
 * `RANKING_SALT`: sekret limitu zgłoszeń. Ustawiony i co najmniej 16 znaków: skrót adresu z HMAC, jedno zapytanie do bazy zamiast
 * dwóch. Ustawiony, ale krótszy (także pusty): 503 `not-configured` (głośna pomyłka zamiast cichego użycia słabego sekretu).
 */
describe('RANKING_SALT: sekret limitu', () => {
  const SECRET = 'sekretny-ciag-0123456789';
  const save = testBundle();
  const endpoints: [string, () => Promise<Response>][] = [
    ['GET /api/leaderboard', () => leaderboard(new Request(`${ORIGIN}/api/leaderboard?board=global`))],
    ['POST /api/player', () => player(post('/api/player', { key: KEY, nick: 'Mateusz' }))],
    ['POST /api/runs', () => runs(post('/api/runs', { key: KEY, nick: 'Mateusz', run }))],
    ['POST /api/save/download', () => download(post('/api/save/download', { key: KEY }))],
    ['POST /api/save/upload', () => upload(post('/api/save/upload', { key: KEY, save }))],
  ];
  const allValues = async (): Promise<string> => {
    const values = await Promise.all(redis.keys().map(async (k) => String((await redis.exec([['GET', k]]).catch(() => [''])).at(0))));
    return [...redis.keys(), ...values].join('\n');
  };

  for (const short of ['x', 'a'.repeat(15), '', ' '.repeat(15), 'zażółć-gęślą-j']) {
    it(`za krótka wartość ${JSON.stringify(short)} (${short.length} znaków): 503 not-configured dla każdego endpointu, bez fetch, z wpisem w logu bez wartości`, async () => {
      vi.stubEnv('RANKING_SALT', short);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      for (const [name, call] of endpoints) {
        const res = await call();
        expect(res.status, name).toBe(503);
        expect(res.headers.get('cache-control'), name).toBe('no-store');
        expect(await res.json(), name).toEqual({ ok: false, error: 'not-configured', message: API_ERRORS['not-configured'].message });
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(redis.keys()).toEqual([]);
      expect(errors).toHaveBeenCalledTimes(endpoints.length);
      for (const call of errors.mock.calls) expect(call).toEqual(['[ranking] RANKING_SALT jest krótsza niż 16 znaków']);
      errors.mockRestore();
    });
  }

  it('wyłącznik wygrywa: bez RANKING_ENABLED krótki RANKING_SALT to nadal ranking-off, bez wpisu w logu i bez fetch', async () => {
    vi.stubEnv('RANKING_ENABLED', undefined);
    vi.stubEnv('RANKING_SALT', 'x');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const [name, call] of endpoints) expect((await (await call()).json() as { error: string }).error, name).toBe('ranking-off');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('dokładnie 16 znaków wystarcza; bez zmiennej (albo przy RANKING_SALT=undefined) limit działa jak dotąd, z solą w bazie', async () => {
    vi.stubEnv('RANKING_SALT', 'a'.repeat(16));
    expect((await download(post('/api/save/download', { key: KEY }))).status).toBe(404);   // przeszło przez limit do bazy
    vi.stubEnv('RANKING_SALT', undefined);
    expect((await download(post('/api/save/download', { key: KEY }))).status).toBe(404);
  });

  it('z sekretem limit idzie w jednym zapytaniu (INCR i PEXPIRE na liczniku adresu i klucza), bez soli okna w bazie', async () => {
    vi.stubEnv('RANKING_SALT', SECRET);
    expect((await download(post('/api/save/download', { key: KEY }))).status).toBe(404);
    expect(upstash.log[0]).toEqual({ token: 'rw', commands: ['INCR', 'PEXPIRE', 'INCR', 'PEXPIRE'] });
    expect(redis.keys().filter((k) => k.startsWith('tr:salt:'))).toEqual([]);
    expect(redis.keys().filter((k) => k.startsWith('tr:rl:'))).toHaveLength(2);
  });

  it('bez sekretu limit idzie w dwóch zapytaniach: sól okna (SET NX PX, GET), potem liczniki', async () => {
    vi.stubEnv('RANKING_SALT', undefined);
    expect((await download(post('/api/save/download', { key: KEY }))).status).toBe(404);
    expect(upstash.log.slice(0, 2)).toEqual([
      { token: 'rw', commands: ['SET', 'GET'] },
      { token: 'rw', commands: ['INCR', 'PEXPIRE', 'INCR', 'PEXPIRE'] },
    ]);
    expect(redis.keys().filter((k) => k.startsWith('tr:salt:'))).toHaveLength(1);
  });

  it('sekret nie trafia do odpowiedzi, logów ani bazy (klucze i wartości), także przy odmowie 429 i przy błędzie 500', async () => {
    vi.stubEnv('RANKING_SALT', SECRET);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bodies: string[] = [];
    // własny klucz i adres: bramka plików api/*.ts jest wspólna dla testów tego pliku, a wyczerpany limit trwa do końca okna
    const own = new Request(`${ORIGIN}/api/save/download`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.77' }, body: JSON.stringify({ key: 'T8V9-W0XY-M2N3-P4Q5-R6S7' }) });
    for (let i = 0; i < RATE_LIMITS.saveDown.perKey + 3; i++) {
      const res = await download(own.clone());
      bodies.push(JSON.stringify(await res.json()), JSON.stringify([...res.headers]));
    }
    expect(bodies.some((b) => b.includes('rate-limited'))).toBe(true);
    vi.stubGlobal('fetch', async () => { throw new TypeError(`fetch failed ${SECRET}`); });
    const failed = await leaderboard(new Request(`${ORIGIN}/api/leaderboard`));
    expect(failed.status).toBe(500);
    bodies.push(JSON.stringify(await failed.json()));
    for (const text of [...bodies, JSON.stringify(errors.mock.calls), await allValues()]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(SECRET.slice(0, 10));
    }
    errors.mockRestore();
  });

  it('depsFromEnv podaje sekret do limitu, a za krótki albo wyłączony ranking daje null', () => {
    const env = { RANKING_ENABLED: '1', KV_REST_API_URL: URL_, KV_REST_API_TOKEN: RW };
    expect(depsFromEnv(env)!.rateSecret).toBeUndefined();
    expect(depsFromEnv({ ...env, RANKING_SALT: SECRET })!.rateSecret).toBe(SECRET);
    expect(depsFromEnv({ ...env, RANKING_SALT: 'krotki' })).toBeNull();
    expect(depsFromEnv({ ...env, RANKING_SALT: '' })).toBeNull();
    expect(depsFromEnv({ ...env, RANKING_ENABLED: undefined, RANKING_SALT: SECRET })).toBeNull();
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
