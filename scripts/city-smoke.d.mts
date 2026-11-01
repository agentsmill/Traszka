// Typy scripts/city-smoke.mjs dla testów (tsc nie obejmuje scripts/, a import .mjs bez deklaracji kończy się błędem noImplicitAny).
export interface Viewport { name: string; size: { width: number; height: number }; mobile: boolean }
export interface StepDef { id: number | string; name: string; sizes: readonly string[] }
export interface ContextOptions {
  locale: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}
export interface TutorialMemory { v: 1; tour: 'skipped'; seen: string[]; tips: boolean }
export interface StepResult { ok: boolean; failed: string[]; notes: string[]; na: boolean; seconds?: number }
export interface SummaryRow { size: string; step: number | string; name: string; status: 'ok' | 'FAIL' | 'n/d'; detail: string }
export interface Summary { rows: SummaryRow[]; ok: boolean }
export interface SmokeArgs { only: string | null; help: boolean }
export type RequestVerdict = 'allow' | 'api' | 'external';
export interface PlaywrightLike { chromium: unknown }
export type MakeRequire = (from: string) => (id: string) => unknown;

export const DEFAULT_PLAYWRIGHT_ROOT: string;
export const LAUNCH_ARGS: readonly string[];
export const VIEWPORTS: readonly Viewport[];
export const FIXTURES: { readonly stary: string; readonly przedStatusem: string };
export const STEPS: readonly StepDef[];
export const TIPS_STEP: StepDef;
export const PHONE_WIDTH: number;

export function tutorialMemory(tips: boolean): TutorialMemory;
export function contextOptions(vp: Viewport): ContextOptions;
export function metaFor(now: number): Record<string, unknown>;
export function storageEntries(input: { seed: string; saveText: string; tips: boolean; now: number }): Record<string, string>;
export function fixtureSave(file: string, dir?: string): { text: string; seed: string };
export function loadPlaywright(root?: string, makeRequire?: MakeRequire): PlaywrightLike;
export function chromiumCandidates(home?: string, list?: (dir: string) => string[]): string[];
export function chromiumExecutable(env?: Record<string, string | undefined>, exists?: (path: string) => boolean, candidates?: string[]): string | undefined;
export function requestVerdict(href: string, port: number | string): RequestVerdict;
export function parsePerf(rows: readonly (readonly [string, string])[]): { fps: number; ms: number; calls: number; tris: number };
export function median(xs: readonly number[]): number;
export function stepResult(patch?: Partial<StepResult>): StepResult;
export function summarize(results: Record<string, Record<string, StepResult>>, steps?: readonly StepDef[]): Summary;
export function parseArgs(argv: readonly string[]): SmokeArgs;
