// Typy scripts/check-vercel-build.mjs dla testów (tsc nie obejmuje scripts/, a import .mjs bez deklaracji kończy się błędem noImplicitAny).
export interface Verdict {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
}
export interface CliArgs {
  cliVersion: string;
  keep: boolean;
  help: boolean;
  /** Wewnętrzna opcja: proces roboczy (`prepare` albo `invoke`) i plik z jego wejściem. */
  worker?: { name: string; input: string };
  /** Powód odrzucenia argumentów. */
  error?: string;
}
export interface FunctionSpec {
  path: string;
  dir: string;
  file: string;
  method: 'GET' | 'POST';
}
export interface OutputFacts {
  functions: Record<string, { bytes: number; handler?: string; runtime?: string; launcher?: string }>;
  bundleBytes?: number;
}

export const DEFAULT_CLI_VERSION: string;
export const VERCEL_ARGS: readonly string[];
export const FAKE_PROJECT: {
  readonly orgId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly settings: Readonly<Record<string, string | null>>;
};
export const FUNCTIONS: readonly FunctionSpec[];
export const BUNDLE_IN_FUNC: string;
export const REPLAY_BUDGET_MS: number;

export function parseArgs(argv: readonly string[]): CliArgs;
/** Czy plik repozytorium (ścieżka względna z ukośnikami) trafia do kopii. */
export function isCopied(rel: string): boolean;
export function listRepoFiles(root: string): string[];
export function copyFiles(root: string, dest: string, files: readonly string[]): number;
export function cleanEnv(base: Readonly<Record<string, string | undefined>>, extra?: Readonly<Record<string, string>>): Record<string, string>;
export function cliEnv(base: Readonly<Record<string, string | undefined>>, home: string): Record<string, string>;
export function analyzeBuildLog(log: string): {
  checks: Verdict[];
  facts: { functionsCompiled: number; typescript?: string; cliVersion?: string };
};
/** Czy nieudany `vercel build` wygląda na chwilowy błąd sieci (skrypt ponawia go jeden raz). */
export function isTransientFailure(log: string): boolean;
export function dirSize(dir: string): number;
export function checkOutput(outputDir: string, copyDir: string): { checks: Verdict[]; facts: OutputFacts };
export function newPlayerKey(random?: (n: number) => Uint8Array): string;
export function runCheck(options?: { cliVersion?: string; keep?: boolean; root?: string; say?: (line: string) => void }): Promise<number>;
export function cli(argv: readonly string[], say?: (line: string) => void): Promise<number>;
