import { isRec } from '../sim/guards.js';
import { UPSTASH_TIMEOUT_MS } from './config.js';
import { RedisError, type RedisCommand, type RedisExec } from './redis.js';

/**
 * Klient Upstash Redis przez REST, na samym `fetch` (bez nowej zależności). Wszystkie polecenia jednego `exec` idą jednym
 * zapytaniem na `/pipeline` (Upstash wykonuje je po kolei, bez transakcji), a odpowiedź to lista `{ result }` albo `{ error }`.
 * Adres i token przychodzą z `env.ts` (zmienne środowiskowe Vercela); żaden komunikat błędu ich nie zawiera. Na odpowiedź bazy
 * czeka najwyżej 5 s (`AbortSignal.timeout`, razem z odczytem treści): zawieszona baza to `RedisError`, a nie funkcja wisząca do
 * limitu platformy.
 */
export interface UpstashOptions {
  url: string;
  token: string;
  /** Do podmiany w testach (testy nigdy nie łączą się z siecią). */
  fetch?: typeof fetch;
  /** Limit czasu jednego zapytania w ms (domyślnie `UPSTASH_TIMEOUT_MS`, czyli 5 s); do skrócenia w testach. */
  timeoutMs?: number;
}

const TIMED_OUT = 'Upstash: przekroczono czas oczekiwania';

export function createUpstash(opts: UpstashOptions): RedisExec {
  const endpoint = `${opts.url.replace(/\/+$/, '')}/pipeline`;
  const fetchFn = opts.fetch ?? fetch;
  return {
    async exec(commands) {
      if (commands.length === 0) return [];
      const signal = AbortSignal.timeout(opts.timeoutMs ?? UPSTASH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetchFn(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(commands.map((c: RedisCommand) => c.map(String))),
          signal,
        });
      } catch (err) {
        throw new RedisError(err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? TIMED_OUT : 'Upstash: brak połączenia');
      }
      if (!res.ok) throw new RedisError(`Upstash: HTTP ${res.status}`);
      const data: unknown = await res.json().catch(() => null);
      if (data === null && signal.aborted) throw new RedisError(TIMED_OUT);
      if (!Array.isArray(data) || data.length !== commands.length) throw new RedisError('Upstash: nieoczekiwana odpowiedź');
      return data.map((r: unknown) => {
        if (!isRec(r)) throw new RedisError('Upstash: nieoczekiwana odpowiedź');
        if ('error' in r) throw new RedisError(`Upstash: ${String(r.error).slice(0, 200)}`);
        return r.result ?? null;
      });
    },
  };
}
