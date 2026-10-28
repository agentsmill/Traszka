import { isRec } from '../sim/guards.js';
import { RedisError, type RedisCommand, type RedisExec } from './redis.js';

/**
 * Klient Upstash Redis przez REST, na samym `fetch` (bez nowej zależności). Wszystkie polecenia jednego `exec` idą jednym
 * zapytaniem na `/pipeline` (Upstash wykonuje je po kolei, bez transakcji), a odpowiedź to lista `{ result }` albo `{ error }`.
 * Adres i token przychodzą z `env.ts` (zmienne środowiskowe Vercela); żaden komunikat błędu ich nie zawiera.
 */
export interface UpstashOptions {
  url: string;
  token: string;
  /** Do podmiany w testach (testy nigdy nie łączą się z siecią). */
  fetch?: typeof fetch;
}

export function createUpstash(opts: UpstashOptions): RedisExec {
  const endpoint = `${opts.url.replace(/\/+$/, '')}/pipeline`;
  const fetchFn = opts.fetch ?? fetch;
  return {
    async exec(commands) {
      if (commands.length === 0) return [];
      let res: Response;
      try {
        res = await fetchFn(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(commands.map((c: RedisCommand) => c.map(String))),
        });
      } catch {
        throw new RedisError('Upstash: brak połączenia');
      }
      if (!res.ok) throw new RedisError(`Upstash: HTTP ${res.status}`);
      const data: unknown = await res.json().catch(() => null);
      if (!Array.isArray(data) || data.length !== commands.length) throw new RedisError('Upstash: nieoczekiwana odpowiedź');
      return data.map((r: unknown) => {
        if (!isRec(r)) throw new RedisError('Upstash: nieoczekiwana odpowiedź');
        if ('error' in r) throw new RedisError(`Upstash: ${String(r.error).slice(0, 200)}`);
        return r.result ?? null;
      });
    },
  };
}
