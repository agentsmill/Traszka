import { describe, expect, it } from 'vitest';
import { BOARD_LIMITS } from '@/server/config';
import { handleLeaderboard, type ServerDeps } from '@/server/http';
import { MemoryRedis } from '@/server/memoryRedis';
import { replayNotAvailable } from '@/server/verify';
import { NETWORK_ERROR, UNAVAILABLE_ERROR, createRankingClient } from './client';

/** Atrapa fetch: zapisuje zapytania, oddaje przygotowaną odpowiedź. */
function fake(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond(String(input), init ?? {});
  }) as typeof fetch;
  return { fetchFn, calls };
}

const WEEK = { id: '2026-W44', seed: 'babka-834', endsAt: 1 };
const KEY = 'K7QX9MBD2HFAP3WN8RTE';

describe('klient API rankingu w grze', () => {
  it('ranking: GET z parametrami w adresie (seed zakodowany), odpowiedź serwera bez zmian', async () => {
    const body = { ok: true, board: 'seed', seed: 'żurek 🥣', week: WEEK, rows: [] };
    const { fetchFn, calls } = fake(() => Response.json(body));
    const client = createRankingClient(fetchFn, '/api');
    expect(await client.board('seed', 'żurek 🥣', 50)).toEqual(body);
    expect(calls[0]!.url).toBe(`/api/leaderboard?board=seed&limit=50&seed=${encodeURIComponent('żurek 🥣')}`);
    expect(calls[0]!.init.method ?? 'GET').toBe('GET');
    await client.board('global');
    expect(calls[1]!.url).toBe('/api/leaderboard?board=global&limit=20');
  });

  it('zapytania klienta przechodzą przez prawdziwą obsługę rankingu na serwerze: nazwy parametrów i limity się zgadzają', async () => {
    const redis = new MemoryRedis();
    const deps: ServerDeps = { redis, readRedis: redis, verifyRun: replayNotAvailable, now: () => Date.UTC(2026, 9, 28, 12) };
    const toServer = (async (input: RequestInfo | URL, init?: RequestInit) =>
      handleLeaderboard(new Request(`https://traszka.test${String(input)}`, init), deps)) as typeof fetch;
    const client = createRankingClient(toServer);
    expect(await client.board('global')).toMatchObject({ ok: true, board: 'global', rows: [] });
    expect(await client.board('week')).toMatchObject({ ok: true, board: 'week', rows: [] });
    for (const seed of ['pierogi-731', 'żurek 🥣', 'seed·2']) {
      expect(await client.board('seed', seed), seed).toMatchObject({ ok: true, board: 'seed', seed, rows: [] });
    }
    for (const limit of BOARD_LIMITS) expect(await client.board('global', undefined, limit), String(limit)).toMatchObject({ ok: true });
    expect(await client.board('global', undefined, 7)).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('klucz gracza jedzie w ciele POST, nigdy w adresie', async () => {
    const { fetchFn, calls } = fake(() => Response.json({ ok: true, nicks: [] }));
    const client = createRankingClient(fetchFn);
    await client.player(KEY, 'Mateusz', 'pierogi-731');
    await client.uploadSave(KEY, '{"a":1}');
    await client.downloadSave(KEY);
    expect(calls.map((c) => [c.url, c.init.method])).toEqual([
      ['/api/player', 'POST'], ['/api/save/upload', 'POST'], ['/api/save/download', 'POST'],
    ]);
    for (const c of calls) expect(c.url).not.toContain(KEY);
    expect(calls.map((c) => JSON.parse(String(c.init.body)))).toEqual([
      { key: KEY, nick: 'Mateusz', seed: 'pierogi-731' }, { key: KEY, save: '{"a":1}' }, { key: KEY },
    ]);
  });

  it('błąd z serwera (JSON z kodem i komunikatem) wraca do interfejsu tak, jak przyszedł', async () => {
    const err = { ok: false, error: 'nick-taken', message: 'Ten nick jest zajęty' };
    const { fetchFn } = fake(() => Response.json(err, { status: 409 }));
    expect(await createRankingClient(fetchFn).player(KEY, 'Ala')).toEqual(err);
  });

  it('brak sieci: komunikat o połączeniu; odpowiedź, która nie jest JSON-em API (np. strona 404): ranking niedostępny', async () => {
    const offline = fake(() => { throw new TypeError('Failed to fetch'); });
    expect(await createRankingClient(offline.fetchFn).board('global')).toEqual({ ok: false, error: 'network', message: NETWORK_ERROR });
    for (const res of [new Response('<html>404</html>', { status: 404 }), Response.json({ cos: 1 }), Response.json([1])]) {
      const { fetchFn } = fake(() => res);
      expect(await createRankingClient(fetchFn).board('global')).toEqual({ ok: false, error: 'unavailable', message: UNAVAILABLE_ERROR });
    }
  });
});
