// Typy scripts/ranking-smoke.mjs dla testów (tsc nie obejmuje scripts/, a import .mjs bez deklaracji kończy się błędem noImplicitAny).
export interface SmokeStep {
  id: string;
  name: string;
  ok: boolean;
  /** Powód porażki (tylko gdy `ok` jest false), bez klucza gracza. */
  error?: string;
}
export interface SmokeResult {
  /** Wszystkie kroki przeszły (albo to tylko plan bez `--write`). */
  ok: boolean;
  /** Wykonane kroki, do pierwszego błędu włącznie; pusto przy planie i przy odmowie. */
  steps: SmokeStep[];
  /** Bez `--write`: wypisano plan i nic nie wysłano. */
  dryRun?: boolean;
  /** Skrypt odmówił (zły adres albo produkcja) i nic nie wysłał. */
  refused?: boolean;
  /** Powód odmowy albo błędu przed pierwszym krokiem. */
  error?: string;
}
export type RandomBytes = (n: number) => Uint8Array;
export interface SmokeOptions {
  baseUrl: string;
  /** Bez tego tylko plan, nic nie jest wysyłane. */
  write?: boolean;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  /** Domyślnie `SIM_VERSION` z `src/sim/simVersion.ts`. */
  simVersion?: number;
  /** Domyślnie `GENERATOR_VERSION` z `src/sim/store/generateStore.ts`. */
  generatorVersion?: number;
  /** Losowość (domyślnie `crypto.randomBytes`); do podmiany w testach. */
  random?: RandomBytes;
}
export interface SmokeIdentity {
  /** Klucz gracza w postaci kodu odzyskiwania `XXXX-XXXX-XXXX-XXXX-XXXX`. */
  key: string;
  /** Drugi klucz: inny gracz, który próbuje zająć cudzy nick. */
  otherKey: string;
  nick: string;
  seed: string;
}
export interface SmokeLogEntry { minute: number; seq: number; cmd: { type: string } & Record<string, unknown> }
export interface SmokeTarget { ok: boolean; origin?: string; error?: string }
export interface SmokeArgs { baseUrl?: string; write: boolean; simVersion?: number; help: boolean }

/** Domeny produkcyjne projektu (gołe nazwy hostów): te i ich subdomeny są zablokowane bez względu na flagi. */
export const PROTECTED_HOSTS: readonly string[];
/** Ostrzeżenie o bazie za wskazanym adresem: w planie, na początku przebiegu i w nagłówku skryptu. */
export const DATABASE_WARNING: string;
export const SMOKE_LOG: readonly SmokeLogEntry[];
/** Kroki próby w kolejności wykonania (bez funkcji `run`); `runs` to liczba zgłoszeń biegu (`POST /api/runs`) w kroku, domyślnie 0. */
export const STEPS: readonly { id: string; name: string; runs?: number }[];
export function runSmoke(options: SmokeOptions): Promise<SmokeResult>;
export function checkTarget(baseUrl: string): SmokeTarget;
export function newIdentity(random?: RandomBytes): SmokeIdentity;
export function readSimVersion(file?: string): number;
export function readGeneratorVersion(file?: string): number;
export function parseArgs(argv: readonly string[]): SmokeArgs;
export function cli(argv: readonly string[], io?: { out: (line: string) => void; err: (line: string) => void }): Promise<number>;
