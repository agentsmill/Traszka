// Typy scripts/build-judge.mjs dla testów (tsc nie obejmuje scripts/, a import .mjs bez deklaracji kończy się błędem noImplicitAny).
export interface BuildJudgeOptions {
  /** Katalog wyjściowy; domyślnie `src/server`. Nie jest czyszczony: leżą w nim źródła serwera. */
  outDir?: string;
  /** Nazwa pliku w `outDir`; domyślnie `judgeBundle.js`. */
  outFile?: string;
  /** Wejście bundla (domyślnie `scripts/judge-entry.ts`); do testów budowania z błędem. */
  entry?: string;
}
export interface BuildJudgeResult {
  /** Bezwzględna ścieżka zbudowanego pliku. */
  file: string;
  bytes: number;
}
/** Pakuje sędziego (aktualną symulację) w jeden samodzielny plik ESM. Rzuca, gdy budowanie się nie uda. */
export function buildJudge(options?: BuildJudgeOptions): Promise<BuildJudgeResult>;
