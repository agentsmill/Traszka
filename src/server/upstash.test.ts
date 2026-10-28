import { describe, expect, it, vi } from 'vitest';
import { UPSTASH_TIMEOUT_MS } from './config';
import { RedisError } from './redis';
import { createUpstash } from './upstash';

const URL_ = 'https://przyklad.upstash.test';
const TOKEN = 'token-testowy-nie-prawdziwy';

/** Atrapa fetch: zapamiętuje zapytania i oddaje przygotowaną odpowiedź (nic nie idzie do sieci). */
function fakeFetch(respond: (body: unknown) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond(JSON.parse(String(init?.body)) as unknown);
  };
  return { fetchFn: fetchFn as typeof fetch, calls };
}

describe('klient Upstash REST (fetch, bez zależności)', () => {
  it('wysyła polecenia jednym zapytaniem na /pipeline, z tokenem w nagłówku, a argumenty jako tekst', async () => {
    const { fetchFn, calls } = fakeFetch(() => Response.json([{ result: 'OK' }, { result: '42' }, { result: null }]));
    const redis = createUpstash({ url: URL_ + '/', token: TOKEN, fetch: fetchFn });
    expect(await redis.exec([['SET', 'k', 'v', 'EX', 60], ['ZSCORE', 'z', 'a'], ['GET', 'brak']])).toEqual(['OK', '42', null]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${URL_}/pipeline`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual([['SET', 'k', 'v', 'EX', '60'], ['ZSCORE', 'z', 'a'], ['GET', 'brak']]);
  });

  it('pusta lista poleceń nie idzie do sieci', async () => {
    const { fetchFn, calls } = fakeFetch(() => Response.json([]));
    expect(await createUpstash({ url: URL_, token: TOKEN, fetch: fetchFn }).exec([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('błąd jednego polecenia rzuca RedisError z treścią błędu bazy', async () => {
    const { fetchFn } = fakeFetch(() => Response.json([{ result: 'OK' }, { error: 'WRONGTYPE Operation against a key' }]));
    const redis = createUpstash({ url: URL_, token: TOKEN, fetch: fetchFn });
    await expect(redis.exec([['SET', 'a', '1'], ['ZADD', 'a', 1, 'x']])).rejects.toThrow(/WRONGTYPE/);
  });

  it('zły status HTTP, zły kształt odpowiedzi i błąd sieci: RedisError, a komunikat nie zdradza adresu ani tokenu', async () => {
    const cases: (typeof fetch)[] = [
      fakeFetch(() => new Response('Unauthorized', { status: 401 })).fetchFn,
      fakeFetch(() => Response.json({ result: 'OK' })).fetchFn,
      fakeFetch(() => Response.json([{ result: 'OK' }])).fetchFn,   // dwa polecenia, jedna odpowiedź
      fakeFetch(() => new Response('to nie JSON', { status: 200 })).fetchFn,
      (async () => { throw new TypeError(`fetch failed ${URL_} ${TOKEN}`); }) as typeof fetch,
    ];
    for (const fetchFn of cases) {
      const err = await createUpstash({ url: URL_, token: TOKEN, fetch: fetchFn }).exec([['GET', 'a'], ['GET', 'b']]).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RedisError);
      expect(String((err as Error).message)).not.toContain(TOKEN);
      expect(String((err as Error).message)).not.toContain('upstash.test');
    }
  });

  it('limit czasu: zapytanie dostaje sygnał z 5 s (AbortSignal.timeout), a konfiguracja mówi dokładnie 5000 ms', async () => {
    expect(UPSTASH_TIMEOUT_MS).toBe(5000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { fetchFn, calls } = fakeFetch(() => Response.json([{ result: 'OK' }]));
    await createUpstash({ url: URL_, token: TOKEN, fetch: fetchFn }).exec([['SET', 'a', '1']]);
    expect(timeout).toHaveBeenCalledWith(5000);
    const signal = calls[0]!.init.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal!.aborted).toBe(false);
    timeout.mockRestore();
  });

  it('zawieszona baza: po limicie czasu RedisError „przekroczono czas”, bez adresu i tokenu w komunikacie', async () => {
    const hang = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    })) as typeof fetch;
    const started = Date.now();
    const err = await createUpstash({ url: URL_, token: TOKEN, fetch: hang, timeoutMs: 30 }).exec([['GET', 'a']]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedisError);
    expect((err as Error).message).toBe('Upstash: przekroczono czas oczekiwania');
    expect(Date.now() - started).toBeLessThan(2000);
    expect((err as Error).message).not.toContain(TOKEN);
    expect((err as Error).message).not.toContain('upstash.test');
  });

  it('odpowiedź, której treść wisi po nagłówkach, też kończy się limitem czasu (sygnał obejmuje odczyt)', async () => {
    const stalledBody = ((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    }) as typeof fetch;
    const err = await createUpstash({ url: URL_, token: TOKEN, fetch: stalledBody, timeoutMs: 30 }).exec([['GET', 'a']]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedisError);
    expect((err as Error).message).toBe('Upstash: przekroczono czas oczekiwania');
  });

  it('szybka odpowiedź w limicie czasu przechodzi, a zwykły błąd sieci to nadal „brak połączenia”', async () => {
    const { fetchFn } = fakeFetch(() => Response.json([{ result: 'OK' }]));
    expect(await createUpstash({ url: URL_, token: TOKEN, fetch: fetchFn, timeoutMs: 1000 }).exec([['GET', 'a']])).toEqual(['OK']);
    const offline = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const err = await createUpstash({ url: URL_, token: TOKEN, fetch: offline, timeoutMs: 1000 }).exec([['GET', 'a']]).catch((e: unknown) => e);
    expect((err as Error).message).toBe('Upstash: brak połączenia');
  });
});
