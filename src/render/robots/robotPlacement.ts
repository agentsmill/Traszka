import type { StoreInfo } from '@/sim/economy/storeInfo';
import { spotCells } from '@/sim/economy/storeInfo';
import { cellKey, type Cell } from '@/sim/grid';
import type { Fixture, StoreLayout } from '@/sim/store/types';

// Gdzie stoją maszyny z warsztatu. Czysta „scenografia” jak reszta widoku: symulacja nie zna rekwizytów, więc maszyny nie mogą
// stanąć tam, gdzie chodzą klienci (w sali nie ma niczego na podłodze) ani tam, gdzie kiedyś stanie paleta. Taśmociąg i prasa
// idą na zaplecze, które dla klientów jest zamknięte, a wykładacz wisi na szynie na wierzchu mebla, więc nie zajmuje kratek.

/** Najdłuższy taśmociąg (kratki, 0,5 m każda): trzeci poziom ulepszenia. */
export const CONVEYOR_MAX_CELLS = 5;
/** Prasa to dwie kratki obok siebie (1 × 0,5 m). */
export const PRESS_CELLS = 2;

export interface RobotPlacement {
  /** Kratki taśmociągu rosnąco po x (rząd przy tylnej ścianie zaplecza); najwyżej `CONVEYOR_MAX_CELLS`, `null` bez miejsca. */
  conveyor: Cell[] | null;
  /** Dwie kratki prasy do kartonów, rosnąco po x; `null` bez miejsca. */
  press: Cell[] | null;
  /** Mebel, na którego wierzchu jedzie ramię wykładacza (najdłuższa gondola, a bez niej regał ścienny); `null` bez mebli do wykładania. */
  restocker: Fixture | null;
}

/** Maksymalny wolny ciąg kratek w jednym rzędzie. */
interface Run { y: number; x0: number; len: number }

/**
 * Wolne ciągi kratek zaplecza: poza miejscami na palety (wszystkimi, także jeszcze nieużywanymi, żeby maszyna nie zajęła kratek,
 * na których kiedyś stanie paleta) i poza pierwszym rzędem za ścianą z drzwiami, którym chodzi się od drzwi wzdłuż zaplecza.
 */
function freeRuns(layout: StoreLayout, info: Pick<StoreInfo, 'spots'>): Run[] {
  const reserved = new Set(info.spots.backroom.flatMap(spotCells).map(cellKey));
  const runs: Run[] = [];
  for (let y = layout.midWallY + 2; y < layout.depth - 1; y++) {
    let start = -1;
    for (let x = 0; x <= layout.width; x++) {
      const free = x < layout.width && layout.cells[y * layout.width + x] === 'backroom' && !reserved.has(cellKey({ x, y }));
      if (free && start < 0) start = x;
      if (!free && start >= 0) {
        runs.push({ y, x0: start, len: x - start });
        start = -1;
      }
    }
  }
  return runs;
}

const cellsOf = (run: Run, from: number, n: number): Cell[] => Array.from({ length: n }, (_, i) => ({ x: run.x0 + from + i, y: run.y }));

/** Najdłuższy ciąg, a przy remisie ten przy tylnej ścianie (większe y), potem bardziej na lewo. */
const byLength = (a: Run, b: Run): number => b.len - a.len || b.y - a.y || a.x0 - b.x0;

/** Taśmociąg i prasa: patrz `RobotPlacement`. Kratki nie zależą od poziomów ulepszeń, więc zakup kolejnego niczego nie przesuwa. */
function placeMachines(layout: StoreLayout, info: Pick<StoreInfo, 'spots'>): Pick<RobotPlacement, 'conveyor' | 'press'> {
  const runs = freeRuns(layout, info).filter((r) => r.len >= 2).sort(byLength);
  const best = runs[0];
  if (!best) return { conveyor: null, press: null };

  // Dość miejsca na obie maszyny w jednym ciągu: pełny taśmociąg na początku, prasa na końcu (przy ścianie, z dala od drzwi).
  if (best.len >= CONVEYOR_MAX_CELLS + PRESS_CELLS) {
    return { conveyor: cellsOf(best, 0, CONVEYOR_MAX_CELLS), press: cellsOf(best, best.len - PRESS_CELLS, PRESS_CELLS) };
  }
  // Drugi ciąg gdzie indziej: taśmociąg w najdłuższym, prasa w kolejnym.
  const other = runs.find((r) => r !== best);
  if (other) return { conveyor: cellsOf(best, 0, Math.min(CONVEYOR_MAX_CELLS, best.len)), press: cellsOf(other, 0, PRESS_CELLS) };
  // Jedyny ciąg: prasa dostaje dwie kratki z końca, taśmociąg resztę (co najmniej dwie, jeśli się da).
  if (best.len >= PRESS_CELLS + 2) return { conveyor: cellsOf(best, 0, best.len - PRESS_CELLS), press: cellsOf(best, best.len - PRESS_CELLS, PRESS_CELLS) };
  return { conveyor: cellsOf(best, 0, best.len), press: null };
}

/** Długość mebla wzdłuż dłuższego boku (kratki), do wyboru mebla pod szynę. */
const longSide = (f: Fixture): number => Math.max(f.w, f.d);

/** Mebel pod szynę wykładacza: najdłuższa gondola, a bez niej najdłuższy regał ścienny; remis rozstrzyga kolejność w układzie. */
function pickRestocker(layout: StoreLayout): Fixture | null {
  for (const kind of ['gondola', 'wallShelf'] as const) {
    let best: Fixture | null = null;
    for (const f of layout.fixtures) if (f.kind === kind && (!best || longSide(f) > longSide(best))) best = f;
    if (best) return best;
  }
  return null;
}

/** Gdzie stoją taśmociąg, prasa i wykładacz w tym układzie. Nie zmienia argumentów. */
export function placeRobots(layout: StoreLayout, info: Pick<StoreInfo, 'spots'>): RobotPlacement {
  return { ...placeMachines(layout, info), restocker: pickRestocker(layout) };
}
