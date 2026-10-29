import { RATE_SECRET_MIN_CHARS } from './config.js';
import { apiError, type Handler, type ServerDeps } from './http.js';
import { createRateGate, type RateGate } from './rateLimit.js';
import { createUpstash } from './upstash.js';
import { replayNotAvailable, type VerifyRun } from './verify.js';

/**
 * Podpięcie obsługi żądań pod funkcję serwerową Vercela. Czyta zmienne środowiskowe (wartości nigdy nie trafiają do odpowiedzi ani
 * do logów): `RANKING_ENABLED`, trzy Upstash: `KV_REST_API_URL`, `KV_REST_API_TOKEN` i, dla odczytu rankingu,
 * `KV_REST_API_READ_ONLY_TOKEN`, oraz opcjonalny sekret limitu `RANKING_SALT`.
 *
 * Wyłącznik: dopóki `RANKING_ENABLED` nie jest dokładnie `1`, każdy endpoint odpowiada 503 `ranking-off` i nie robi nic więcej, więc
 * nie powstaje żadne zapytanie do bazy, choć zmienne Upstash mogą być ustawione (integracja Upstash wpisuje je do projektu Vercela
 * sama). Sprawdzenie jest pierwszą rzeczą w `route`, przed odczytem zmiennych bazy; wszystkie pliki w `api/` składają się przez `route`
 * (pilnuje tego `api.test.ts`). Bez adresu albo tokenu API (przy włączonym rankingu) odpowiada 503 „Ranking jeszcze nie działa”.
 * Wyjątek w obsłudze (np. baza nie odpowiada) to 500 z ogólnym komunikatem, a w logu Vercela tylko nazwa i treść błędu.
 *
 * `RANKING_SALT` (sekret, `openssl rand -hex 32`): gdy ustawiony, skrót adresu w limicie zgłoszeń to HMAC-SHA256 tego sekretu, więc
 * limit robi jedno zapytanie do bazy zamiast dwóch (bez odczytu soli okna); bez niego sól okna leży w bazie. Zmiana wartości zeruje
 * liczniki bieżących okien (skróty adresów się zmieniają), nic poza tym. Ustawiony, ale krótszy niż 16 znaków (także pusty), to
 * błąd konfiguracji: 503 `not-configured` i wpis w logu (bez wartości), a nie ciche użycie słabego sekretu. Sprawdzenie jest po
 * wyłączniku, więc przy wyłączonym rankingu krótki sekret niczego nie psuje.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const processEnv = (): EnvSource => (globalThis as { process?: { env?: EnvSource } }).process?.env ?? {};

export interface RouteOptions {
  /** Do podmiany w testach. */
  env?: () => EnvSource;
  fetch?: typeof fetch;
  now?: () => number;
  /** Sędzia biegu; domyślnie `replayNotAvailable` (żaden bieg nie jest przyjęty). `api/runs.ts` podaje sędziego z bundla symulacji (`judge.ts`). */
  verifyRun?: VerifyRun;
  /**
   * Bramka limitu w pamięci instancji. Domyślnie `route` tworzy własną, jedną na wywołanie `route(...)`, czyli na plik `api/*.ts`
   * i instancję funkcji (a nie na żądanie: jej pamięć ma przeżyć wiele żądań). Do podmiany w testach, np. wspólnej dla dwóch `route`.
   */
  rateGate?: RateGate;
}

/** Czy `RANKING_SALT` jest w porządku: nieustawiony albo co najmniej `RATE_SECRET_MIN_CHARS` znaków (krótszy, także pusty, to błąd). */
export const rateSecretValid = (env: EnvSource): boolean => env.RANKING_SALT === undefined || env.RANKING_SALT.length >= RATE_SECRET_MIN_CHARS;

/** Czy właściciel włączył ranking: tylko dokładnie `RANKING_ENABLED=1` (nie „true”, nie „ 1”, nie pusta wartość). */
export const rankingEnabled = (env: EnvSource): boolean => env.RANKING_ENABLED === '1';

/**
 * Zależności z env albo null: ranking wyłączony (`RANKING_ENABLED`), brak adresu albo tokenu bazy, albo za krótki `RANKING_SALT`.
 * Wyłącznik sprawdza także tu, żeby żaden przyszły kod nie zbudował klienta bazy obok `route`, gdy właściciel nie włączył rankingu.
 */
export function depsFromEnv(env: EnvSource, opts: RouteOptions = {}): ServerDeps | null {
  if (!rankingEnabled(env) || !rateSecretValid(env)) return null;
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
    rateGate: opts.rateGate,
    rateSecret: env.RANKING_SALT,
  };
}

/**
 * Funkcja dla Vercela (`export const GET = route(handleLeaderboard)`): zależności z env przy każdym wywołaniu, a bramka limitu
 * (pamięć instancji) jedna na całe życie tej funkcji.
 */
export function route(handler: Handler, opts: RouteOptions = {}): (request: Request) => Promise<Response> {
  const rateGate = opts.rateGate ?? createRateGate();   // raz na wywołanie `route`, nie na żądanie
  return async (request) => {
    const env = (opts.env ?? processEnv)();
    if (!rankingEnabled(env)) return apiError('ranking-off');
    if (!rateSecretValid(env)) {
      console.error(`[ranking] RANKING_SALT jest krótsza niż ${RATE_SECRET_MIN_CHARS} znaków`);   // bez wartości i bez jej długości
      return apiError('not-configured');
    }
    const deps = depsFromEnv(env, { ...opts, rateGate });
    if (deps === null) return apiError('not-configured');
    try {
      return await handler(request, deps);
    } catch (err) {
      console.error('[ranking]', err instanceof Error ? `${err.name}: ${err.message}` : 'nieznany błąd');
      return apiError('server');
    }
  };
}
