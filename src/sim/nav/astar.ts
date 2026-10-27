import { manhattan, type Cell } from '@/sim/grid';

export type BlockedFn = (x: number, y: number) => boolean;

interface HeapEntry { f: number; h: number; seq: number; idx: number }

// Kopiec binarny (min). Remisy rozstrzyga mniejsze h, potem kolejność wstawienia, więc wynik jest deterministyczny.
class MinHeap {
  private readonly items: HeapEntry[] = [];

  get size(): number { return this.items.length; }

  private static less(a: HeapEntry, b: HeapEntry): boolean {
    return a.f !== b.f ? a.f < b.f : a.h !== b.h ? a.h < b.h : a.seq < b.seq;
  }

  push(e: HeapEntry): void {
    const items = this.items;
    let i = items.length;
    items.push(e);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!MinHeap.less(e, items[parent]!)) break;
      items[i] = items[parent]!;
      i = parent;
    }
    items[i] = e;
  }

  pop(): HeapEntry {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    const n = items.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && MinHeap.less(items[child + 1]!, items[child]!)) child++;
        if (!MinHeap.less(items[child]!, last)) break;
        items[i] = items[child]!;
        i = child;
      }
      items[i] = last;
    }
    return top;
  }
}

// Kolejność sąsiadów jest stała (N, E, S, W), żeby remisy dawały zawsze tę samą ścieżkę.
const DX = [0, 1, 0, -1] as const;
const DY = [-1, 0, 1, 0] as const;

/**
 * A* po siatce width × height, 4-sąsiedztwo, koszt kroku 1, heurystyka manhattan.
 * Zwraca ścieżkę ze startem i celem albo null, gdy nie ma drogi.
 * `start == cel` daje `[start]`. Start poza siatką lub cel poza siatką albo zablokowany daje null;
 * sam start może stać na zablokowanej kratce (postać wolno z niej wyjść).
 */
export function findPath(width: number, height: number, blocked: BlockedFn, start: Cell, goal: Cell): Cell[] | null {
  const inBounds = (c: Cell): boolean => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height;
  if (!inBounds(start) || !inBounds(goal)) return null;
  if (start.x === goal.x && start.y === goal.y) return [{ x: start.x, y: start.y }];
  if (blocked(goal.x, goal.y)) return null;

  const size = width * height;
  const g = new Int32Array(size).fill(-1);       // najlepszy znany koszt dojścia, −1 = nieodwiedzona
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const open = new MinHeap();
  let seq = 0;

  const startIdx = start.y * width + start.x;
  const goalIdx = goal.y * width + goal.x;
  g[startIdx] = 0;
  const h0 = manhattan(start, goal);
  open.push({ f: h0, h: h0, seq: seq++, idx: startIdx });

  while (open.size > 0) {
    const { idx } = open.pop();
    if (closed[idx]) continue; // nieaktualny duplikat
    closed[idx] = 1;
    if (idx === goalIdx) return buildPath(parent, width, startIdx, goalIdx);

    const cx = idx % width;
    const cy = (idx - cx) / width;
    const gNext = g[idx]! + 1;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]!;
      const ny = cy + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (closed[nIdx] || blocked(nx, ny)) continue;
      const known = g[nIdx]!;
      if (known !== -1 && known <= gNext) continue;
      g[nIdx] = gNext;
      parent[nIdx] = idx;
      const h = Math.abs(nx - goal.x) + Math.abs(ny - goal.y);
      open.push({ f: gNext + h, h, seq: seq++, idx: nIdx });
    }
  }
  return null;
}

function buildPath(parent: Int32Array, width: number, startIdx: number, goalIdx: number): Cell[] {
  const path: Cell[] = [];
  for (let i = goalIdx; i !== -1; i = parent[i]!) {
    path.push({ x: i % width, y: Math.floor(i / width) });
    if (i === startIdx) break;
  }
  return path.reverse();
}
