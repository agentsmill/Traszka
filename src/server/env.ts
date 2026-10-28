import { apiError, type Handler, type ServerDeps } from './http.js';
import { createUpstash } from './upstash.js';
import { replayNotAvailable, type VerifyRun } from './verify.js';

/**
 * Podpięcie obsługi żądań pod funkcję serwerową Vercela. Czyta cztery zmienne środowiskowe (wartości nigdy nie trafiają do
 * odpowiedzi ani do logów): `RANKING_ENABLED` oraz trzy Upstash: `KV_REST_API_URL`, `KV_REST_API_TOKEN` i, dla odczytu rankingu,
 * `KV_REST_API_READ_ONLY_TOKEN`.
 *
 * Wyłącznik: dopóki `RANKING_ENABLED` nie jest dokładnie `1`, każdy endpoint odpowiada 503 `ranking-off` i nie robi nic więcej, więc
 * nie powstaje żadne zapytanie do bazy, choć zmienne Upstash mogą być ustawione (integracja Upstash wpisuje je do projektu Vercela
 * sama). Sprawdzenie jest pierwszą rzeczą w `route`, przed odczytem zmiennych bazy; wszystkie pliki w `api/` składają się przez `route`
 * (pilnuje tego `api.test.ts`). Bez adresu albo tokenu API (przy włączonym rankingu) odpowiada 503 „Ranking jeszcze nie działa”.
 * Wyjątek w obsłudze (np. baza nie odpowiada) to 500 z ogólnym komunikatem, a w logu Vercela tylko nazwa i treść błędu.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const processEnv = (): EnvSource => (globalThis as { process?: { env?: EnvSource } }).process?.env ?? {};

export interface RouteOptions {
  /** Do podmiany w testach. */
  env?: () => EnvSource;
  fetch?: typeof fetch;
  now?: () => number;
  /** Sędzia biegu; domyślnie „odtwarzanie jeszcze niedostępne”, do czasu scalenia strumienia A. */
  verifyRun?: VerifyRun;
}

/** Czy właściciel włączył ranking: tylko dokładnie `RANKING_ENABLED=1` (nie „true”, nie „ 1”, nie pusta wartość). */
export const rankingEnabled = (env: EnvSource): boolean => env.RANKING_ENABLED === '1';

/**
 * Zależności z env albo null: ranking wyłączony (`RANKING_ENABLED`) lub brak adresu albo tokenu bazy. Wyłącznik sprawdza także tu,
 * żeby żaden przyszły kod nie zbudował klienta bazy obok `route`, gdy właściciel nie włączył rankingu.
 */
export function depsFromEnv(env: EnvSource, opts: RouteOptions = {}): ServerDeps | null {
  if (!rankingEnabled(env)) return null;
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const readToken = env.KV_REST_API_READ_ONLY_TOKEN;
  const redis = createUpstash({ url, token, fetch: opts.fetch });
  return {
    redis,
    readRedis: readToken ? createUpstash({ url, token: readToken, fetch: opts.fetch }) : redis,
    verifyRun: opts.verifyRun ?? replayNotAvailable,
    now: opts.now ?? Date.now,
  };
}

/** Funkcja dla Vercela (`export const GET = route(handleLeaderboard)`): zależności z env przy każdym wywołaniu. */
export function route(handler: Handler, opts: RouteOptions = {}): (request: Request) => Promise<Response> {
  return async (request) => {
    const env = (opts.env ?? processEnv)();
    if (!rankingEnabled(env)) return apiError('ranking-off');
    const deps = depsFromEnv(env, opts);
    if (deps === null) return apiError('not-configured');
    try {
      return await handler(request, deps);
    } catch (err) {
      console.error('[ranking]', err instanceof Error ? `${err.name}: ${err.message}` : 'nieznany błąd');
      return apiError('server');
    }
  };
}
