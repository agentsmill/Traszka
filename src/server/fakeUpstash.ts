import { isRec } from '../sim/guards.js';
import type { MemoryRedis } from './memoryRedis.js';
import { RedisError } from './redis.js';

/**
 * Tylko do testów: `fetch`, który udaje Upstash REST nad `MemoryRedis` (nic nie idzie do sieci). Sprawdza adres `/pipeline` i token
 * z nagłówka, a token tylko do odczytu odrzuca polecenia zapisu tak jak Upstash (NOPERM), więc testy widzą, którym tokenem co poszło.
 */
// Wszystko spoza tej listy to odczyt (GET, MGET, GETRANGE, ZSCORE, ZREVRANGE, …), który wykona także token tylko do odczytu.
const WRITES = new Set(['SET', 'DEL', 'INCR', 'EXPIRE', 'PEXPIRE', 'PEXPIREAT', 'ZADD', 'ZREM', 'ZREMRANGEBYRANK', 'SADD', 'SREM']);

export interface FakeUpstash {
  fetch: typeof fetch;
  /** Zapytania: token (rw/ro) i nazwy poleceń. */
  log: { token: 'rw' | 'ro'; commands: string[] }[];
}

export function fakeUpstash(redis: MemoryRedis, url: string, tokens: { rw: string; ro?: string }): FakeUpstash {
  const log: FakeUpstash['log'] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) !== `${url.replace(/\/+$/, '')}/pipeline` || init?.method !== 'POST') return new Response('Not Found', { status: 404 });
    const auth = new Headers(init.headers).get('authorization');
    const token = auth === `Bearer ${tokens.rw}` ? 'rw' : tokens.ro !== undefined && auth === `Bearer ${tokens.ro}` ? 'ro' : null;
    if (token === null) return new Response('Unauthorized', { status: 401 });
    const commands: unknown = JSON.parse(String(init.body));
    if (!Array.isArray(commands) || !commands.every((c) => Array.isArray(c) && c.every((a) => typeof a === 'string'))) {
      return new Response('Bad Request', { status: 400 });
    }
    log.push({ token, commands: (commands as string[][]).map((c) => c[0]!.toUpperCase()) });
    const results: unknown[] = [];
    for (const c of commands as string[][]) {
      if (token === 'ro' && WRITES.has(c[0]!.toUpperCase())) {
        results.push({ error: 'NOPERM this user has no permissions to run this command' });
        continue;
      }
      try {
        results.push({ result: (await redis.exec([c]))[0] });
      } catch (err) {
        results.push({ error: err instanceof RedisError ? err.message : 'ERR' });
      }
    }
    return Response.json(results.map((r) => (isRec(r) ? r : { result: r })));
  };
  return { fetch: fetchFn as typeof fetch, log };
}
