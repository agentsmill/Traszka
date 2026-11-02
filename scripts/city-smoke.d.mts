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
export interface SmokeArgs { only: string | null; help: boolean; stage: '4b' | null }
/** Pomiar szerokości strony: `scroll` dokumentu i widoczne okna, arkusze, karty (ramka, `scrollWidth`, `clientWidth`). */
export interface WidthBox { name: string; left: number; right: number; scroll: number; client: number; culprits?: string[] }
export interface WidthMeasure { scroll: number; boxes?: readonly WidthBox[] }
export type RequestVerdict = 'allow' | 'api' | 'external';
export interface PlaywrightLike { chromium: unknown }
export type MakeRequire = (from: string) => (id: string) => unknown;

export const DEFAULT_PLAYWRIGHT_ROOT: string;
export const LAUNCH_ARGS: readonly string[];
export const VIEWPORTS: readonly Viewport[];
export const FIXTURES: { readonly stary: string; readonly przedStatusem: string; readonly poTraszce: string; readonly dwaSklepy: string };
export const STEPS: readonly StepDef[];
export const TIPS_STEP: StepDef;
export const STEPS_4B: readonly StepDef[];
export const DESKTOP_4B: { width: number; height: number };
export const RESEARCH_DOSTAWY_COST: number;
export const WALLET_4B_RENT: number;
export const WALLET_4B_MILLION: number;
export const FAME_TITLE: string;
export const FAME_CLOSED: string;
export const PHONE_WIDTH: number;
export const USAGE: string;

export function tutorialMemory(tips: boolean): TutorialMemory;
export function contextOptions(vp: Viewport): ContextOptions;
export function metaFor(now: number): Record<string, unknown>;
export function storageEntries(input: { seed: string; saveText: string; tips: boolean; now: number }): Record<string, string>;
export function fixtureSave(file: string, dir?: string): { text: string; seed: string };
export function loadPlaywright(root?: string, makeRequire?: MakeRequire): PlaywrightLike;
export function chromiumCandidates(home?: string, list?: (dir: string) => string[]): string[];
export function chromiumExecutable(env?: Record<string, string | undefined>, exists?: (path: string) => boolean, candidates?: string[]): string | undefined;
export function requestVerdict(href: string, port: number | string): RequestVerdict;
export function isApiUrl(href: string, port: number | string): boolean;
export function parsePerf(rows: readonly (readonly [string, string])[]): { fps: number; ms: number; calls: number; tris: number };
export function median(xs: readonly number[]): number;
export function stepResult(patch?: Partial<StepResult>): StepResult;
export function summarize(results: Record<string, Record<string, StepResult>>, steps?: readonly StepDef[]): Summary;
export function parseArgs(argv: readonly string[]): SmokeArgs;
export function previewReady(log: string, port: number | string): boolean;
export function widthProblems(m: WidthMeasure, limit?: number): string[];

// Plan 4a.2 (Zadanie 9): stałe i pomocniki kroków 2 (dopisek) i 9–12.
/** Zamknięty sklep z koperty zapisu: to, co zostaje w lokalu „po Traszce”. */
export interface ClosedFitting { id: number; lotId: number; remontLevel: number; equipment: string[]; upgrades: number }
export interface PinBox { l: number; t: number; r: number; b: number }
/** Pinezka z pomiaru strony: rodzaj z klasy `tt-cpin-<rodzaj>`, `z`-index, ramka (null, gdy ukryta), napis z ramką i `display`, pinezki zasłonięte w punkcie ich środka. */
export interface PinMeasure {
  lot: number; kind: string; z: number; box: PinBox | null;
  label: { text: string; box: PinBox | null; display: string } | null; covers: number[];
}
export interface PinReport { problems: string[]; overlaps: { lot: number; with: number; kind: string; area: number }[] }
export interface WidthEntry { label: string; scroll: number; boxes: number; problems: string[]; ok: boolean }
export const RELET_SHARE: number;
export const RELET_BUILD_DAYS: number;
export const HOUR_BARS: number;
export const BACKGROUND_TRUST_WARN_BELOW: number;
export const RELET_TRUST: number;
export const LIMIT_TEXT: string;
export const RELET_TITLE: string;
export const OPEN_MINUTE: number;
export const RELET_CAPTION: string;
export const NEW_SCREENS: readonly { name: string; min: number }[];
export function reletPrice(pkg: number): number;
export function daysText(n: number): string;
export function digitsOf(text: string): number;
export function closedFittings(saveText: string): ClosedFitting[];
export function reletBlockText(fit: Pick<ClosedFitting, 'remontLevel' | 'equipment' | 'upgrades'>): string;
export function parseInstallmentButton(text: string): { monthly: number; months: number } | null;
export function trustRowValues(rows: readonly string[], word?: string): number[];
export function overlapArea(a: PinBox, b: PinBox): number;
export function pinProblems(m: { width: number; pins: readonly PinMeasure[] }, narrow?: number): PinReport;
export function newScreenProblems(widths: readonly WidthEntry[], prefix?: string): string[];

// Plan 4b (Zadanie 10): koperty zapisów do kroków 4b.
export function withRemont(saveText: string, patch: { storeId: number; remontLevel: number; level: number }): string;
export function deckIds(source: string): string[];
export function withOnlyCardTomorrow(saveText: string, opts: { storeId: number; cardId: string; ids: readonly string[] }): string;
