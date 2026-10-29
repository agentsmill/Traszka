// Typy scripts/judge-worst-case.mjs dla testów (tsc nie obejmuje scripts/).
export interface WorstCaseRun {
  seed: string;
  gameVersion: string;
  generatorVersion: number;
  simVersion: number;
  mode: 'ranked';
  log: { minute: number; seq: number; cmd: Record<string, unknown> & { type: string } }[];
}
export const SEED: string;
export const LOG_ENTRIES: number;
export const BODY_LIMIT_BYTES: number;
export const BUDGET_MS: number;
export const COMMANDS: Record<string, (i: number) => Record<string, unknown> & { type: string }>;
/** Scenariusze najgorszego przypadku (po jednym, bo każdy dziennik to 100 000 obiektów). */
export function worstCaseRuns(opts: { generatorVersion: number; simVersion: number; endMinute: number }): Generator<{ name: string; run: WorstCaseRun }>;
