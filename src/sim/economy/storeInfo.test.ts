import { describe, expect, it } from 'vitest';
import { layoutFor } from '@/game/session';
import { staffStripCells } from '@/sim/crowd/crowd';
import type { Cell } from '@/sim/grid';
import { FRONT_WALL_Y, type StoreLayout } from '@/sim/store/types';
import { accessCells, isWalkable } from '@/sim/store/validate';
import { FINE_PALLET_POW } from './exactMath';
import { computeStoreInfo, type PalletSpot } from './storeInfo';

/** Ile seedów sprawdza test (`SPOT_SEEDS=5000` przy jednorazowym, dłuższym przebiegu). */
const SEEDS = Number(process.env.SPOT_SEEDS ?? 1000);

const squareCells = (s: PalletSpot): Cell[] => [
  { x: s.x, y: s.y }, { x: s.x + 1, y: s.y }, { x: s.x, y: s.y + 1 }, { x: s.x + 1, y: s.y + 1 },
];

/**
 * Dokładna kopia `floorSpots` sprzed zmiany komparatora, z `Math.hypot` (w testach wolno). To wzorzec kolejności:
 * nowa wersja ma dawać te same miejsca w tej samej kolejności, poza dokładnymi remisami odległości.
 */
function legacyFloorSpots(layout: StoreLayout): PalletSpot[] {
  const FLOOR_SPOTS_MAX = 3;
  const { width } = layout;
  const key = (c: Cell): number => c.y * width + c.x;
  const reserved = new Set<number>();
  for (const c of layout.checkoutQueue) reserved.add(key(c));
  for (const c of staffStripCells(layout)) reserved.add(key(c));
  for (const f of layout.fixtures) {
    if (f.kind === 'gondola' || f.kind === 'wallShelf' || f.kind === 'fridge') continue;
    for (const c of accessCells(layout, f)) reserved.add(key(c));
  }
  const walk = (c: Cell, blocked: Set<number>): boolean => isWalkable(layout, c.x, c.y) && c.y > 0 && !blocked.has(key(c));

  const targets: Cell[][] = [
    ...layout.fixtures.filter((f) => f.kind !== 'backroomDoor').map((f) => accessCells(layout, f).filter((c) => isWalkable(layout, c.x, c.y))),
    ...layout.checkoutQueue.map((c) => [c]),
  ].filter((t) => t.length > 0);

  const reachableAll = (blocked: Set<number>): boolean => {
    const start = layout.spawnPoints[0]!;
    const seen = new Set<number>([key(start)]);
    const stack = [start];
    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      for (const n of [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }]) {
        if (!walk(n, blocked) || seen.has(key(n))) continue;
        seen.add(key(n));
        stack.push(n);
      }
    }
    return targets.every((t) => t.some((c) => seen.has(key(c)))) && layout.spawnPoints.every((p) => seen.has(key(p)));
  };

  const candidates: PalletSpot[] = [];
  for (let y = FRONT_WALL_Y + 3; y < layout.midWallY - 1; y++) {
    for (let x = 1; x < width - 2; x++) {
      const s = { x, y };
      if (squareCells(s).every((c) => layout.cells[key(c)] === 'floor' && !reserved.has(key(c)))) candidates.push(s);
    }
  }
  const cx = width / 2;
  const cy = (FRONT_WALL_Y + layout.midWallY) / 2;
  candidates.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));

  const blocked = new Set<number>();
  const out: PalletSpot[] = [];
  for (const s of candidates) {
    const cells = squareCells(s);
    if (cells.some((c) => blocked.has(key(c)))) continue;
    if (out.some((o) => Math.abs(o.x - s.x) < 4 && Math.abs(o.y - s.y) < 4)) continue;
    const next = new Set(blocked);
    for (const c of cells) next.add(key(c));
    if (!reachableAll(next)) continue;
    for (const c of cells) blocked.add(key(c));
    out.push(s);
    if (out.length >= FLOOR_SPOTS_MAX) break;
  }
  return out;
}

/** Kwadrat odległości od środka sali w podwojonych współrzędnych (całkowity i dokładny, tak jak w `floorSpots`). */
function centreDist2(layout: StoreLayout, s: PalletSpot): number {
  const dx = 2 * s.x - layout.width;
  const dy = 2 * s.y - (FRONT_WALL_Y + layout.midWallY);
  return dx * dx + dy * dy;
}

const sameSpot = (a: PalletSpot | undefined, b: PalletSpot | undefined): boolean => a?.x === b?.x && a?.y === b?.y;

describe('miejsca na palety w sali', () => {
  /**
   * Kolejność ma być jak przy `Math.hypot` z jednym wyjątkiem: dokładne remisy odległości. Specyfikacja nie gwarantuje
   * poprawnego zaokrąglenia `Math.hypot`, więc dwie kratki o matematycznie równej odległości dostawały od niego różne
   * wartości (różnica w ostatnim bicie) i o ich kolejności decydował szum zaokrąglenia, zależny od silnika. Teraz
   * remis rozstrzyga kolejność skanowania. Dlatego test wymaga równości z wzorcem albo, w pierwszym miejscu różnicy,
   * dwóch miejsc o tym samym całkowitym kwadracie odległości; każda inna rozbieżność to błąd.
   * Listy układów, które się różnią, celowo nie przypinamy: zależy ona od tego, jak dany silnik zaokrągla `Math.hypot`
   * (lokalnie Node 25, w CI Node 24), czyli od dokładnie tej cechy, której kod ma już nie używać. Kierunek rozstrzygania
   * remisów przypina następny test, na literałach niezależnych od silnika.
   */
  it('kolejność miejsc w sali jak przy Math.hypot, różnice tylko przy dokładnych remisach: 1000 seedów × 4 poziomy remontu', () => {
    for (let i = 0; i < SEEDS; i++) {
      const seed = `spot-${i}`;
      for (let level = 0; level <= 3; level++) {
        const layout = layoutFor(seed, level);
        const actual = computeStoreInfo(layout).spots.floor;
        const legacy = legacyFloorSpots(layout);
        let at = -1;
        for (let k = 0; k < Math.max(actual.length, legacy.length) && at < 0; k++) if (!sameSpot(actual[k], legacy[k])) at = k;
        if (at < 0) continue;
        const mine = actual[at];
        const old = legacy[at];
        const where = `seed ${seed}, poziom ${level}, pierwsza różnica na miejscu ${at}`;
        expect(mine, where).toBeDefined();
        expect(old, where).toBeDefined();
        expect(centreDist2(layout, mine!), `${where}: to nie jest dokładny remis odległości`).toBe(centreDist2(layout, old!));
      }
    }
  }, 120_000);

  it('dokładny remis odległości rozstrzyga kolejność skanowania, tak samo w każdym silniku', () => {
    // w obu układach (5,11) i (13,15) leżą dokładnie tak samo daleko od środka (kwadrat 85 w podwojonych współrzędnych);
    // (5,11) jest wcześniej w skanowaniu (wiersz 11 przed 15), więc wchodzi przed (13,15), któremu `Math.hypot` bywał przychylny
    for (const seed of ['spot-252', 'spot-676']) {
      expect(computeStoreInfo(layoutFor(seed, 1)).spots.floor, seed).toEqual([{ x: 9, y: 11 }, { x: 9, y: 15 }, { x: 5, y: 11 }]);
    }
  });
});

describe('miejsca na palety na chodniku', () => {
  /**
   * `checkFine` czyta `n ** 1.4` z tablicy `FINE_PALLET_POW` (n = 0..40), a palet na chodniku nie ma więcej niż miejsc (`deliver`
   * kładzie je tylko na wolnych). Najszerszy lokal (40 kratek, remont 3) ma 17 miejsc; w próbce 250 seedów × 4 poziomy remontu
   * trafia się już szerokość 40, a liczba miejsc rośnie z szerokością, więc to jest największa możliwa.
   */
  it('największa liczba miejsc na chodniku mieści się w tablicy mandatu', () => {
    let most = 0;
    for (let i = 0; i < Math.min(SEEDS, 250); i++) {
      for (let level = 0; level <= 3; level++) {
        most = Math.max(most, computeStoreInfo(layoutFor(`spot-${i}`, level)).spots.sidewalk.length);
      }
    }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThan(FINE_PALLET_POW.length);
  }, 60_000);
});
