import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh } from 'three';
import { cellToWorld } from '@/render/coords';
import { CATS } from '@/sim/economy/catalog';
import type { Pallet } from '@/sim/economy/economy';
import { computeStoreInfo, palletPlace, type PalletLoc } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { createPalletsView } from './palletsView';

const SEED = 'alfa';
const layout = generateStore(SEED);
const info = computeStoreInfo(layout);
const AISLE = info.spots.aisle.length;

function pallet(id: number, loc: PalletLoc, spot: number, fill = 1): Pallet {
  const items = Object.fromEntries(CATS.map((c) => [c, 0])) as Pallet['items'];
  items.napoje = 100 * fill;
  return { id, loc, spot, items, total: 100 * fill, initial: 100, since: 0 };
}

/** Widok z jedną synchronizacją; zwraca też instancje (podstawy, kartony) i pierścień zaznaczenia. */
function viewOf(pallets: Pallet[], selected: number | null = null) {
  const view = createPalletsView(layout, info);
  view.sync(pallets, selected);
  const [bases, layers, ring] = view.root.children as [InstancedMesh, InstancedMesh, Mesh];
  return { view, bases, layers, ring };
}

describe('widok palet: miejsca i piętra stosu', () => {
  it('układ ma przejścia, w których mieszczą się palety (inaczej testy niżej nic by nie mówiły)', () => {
    expect(AISLE).toBeGreaterThanOrEqual(3);
  });

  it('zwykła paleta stoi na środku swojego kwadratu, na podłodze', () => {
    const { view } = viewOf([pallet(1, 'floor', 0)]);
    const spot = palletPlace(info, 'floor', 0)!.spot;
    const a = cellToWorld(layout, spot.x, spot.y);
    const b = cellToWorld(layout, spot.x + 1, spot.y + 1);
    const at = view.worldPosition(1)!;
    expect(at.x).toBeCloseTo((a.x + b.x) / 2);
    expect(at.z).toBeCloseTo((a.z + b.z) / 2);
    expect(at.y).toBe(0);
    view.dispose();
  });

  it('paleta w przejściu stoi na kwadracie z `info.spots.aisle`, a numer ponad liczbę kwadratów to piętro wyżej na tym samym', () => {
    const { view } = viewOf([pallet(1, 'aisle', 1), pallet(2, 'aisle', 1 + AISLE), pallet(3, 'aisle', 1 + 2 * AISLE), pallet(4, 'aisle', 2)]);
    const [ground, first, second, other] = [1, 2, 3, 4].map((id) => view.worldPosition(id)!);
    expect(ground.y).toBe(0);
    expect(first.x).toBeCloseTo(ground.x);
    expect(first.z).toBeCloseTo(ground.z);
    expect(second.x).toBeCloseTo(ground.x);
    expect(second.z).toBeCloseTo(ground.z);
    expect(first.y).toBeGreaterThan(1);                              // pełna paleta to ponad metr
    expect(second.y).toBeCloseTo(2 * first.y);                       // piętra są jednakowe
    expect(other.y).toBe(0);
    const expected = (loc: PalletLoc, spot: number): { x: number; z: number } => {
      const sq = palletPlace(info, loc, spot)!.spot;
      const a = cellToWorld(layout, sq.x, sq.y);
      const b = cellToWorld(layout, sq.x + 1, sq.y + 1);
      return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    };
    expect(ground.x).toBeCloseTo(expected('aisle', 1).x);
    expect(ground.z).toBeCloseTo(expected('aisle', 1).z);
    expect(other.x).toBeCloseTo(expected('aisle', 2).x);   // sąsiedni kwadrat to inne miejsce
    expect(other.z).toBeCloseTo(expected('aisle', 2).z);
    expect(Math.hypot(other.x - ground.x, other.z - ground.z)).toBeGreaterThan(0.1);
    view.dispose();
  });

  it('paleta niżej, rozładowana albo zmniejszona, nie zostawia dziury pod paletą piętro wyżej', () => {
    const full = viewOf([pallet(1, 'aisle', 0), pallet(2, 'aisle', AISLE)]);
    const fullTop = full.view.worldPosition(2)!.y;
    full.view.dispose();

    const half = viewOf([pallet(1, 'aisle', 0, 0.5), pallet(2, 'aisle', AISLE)]);
    expect(half.view.worldPosition(2)!.y).toBeGreaterThan(0);
    expect(half.view.worldPosition(2)!.y).toBeLessThan(fullTop);     // niższy stos pod spodem: wyższa paleta siada na nim
    half.view.dispose();

    const gone = viewOf([pallet(2, 'aisle', AISLE)]);
    expect(gone.view.worldPosition(2)!.y).toBe(0);                   // paleta z dołu rozładowana: ta z góry stoi na podłodze
    gone.view.dispose();
  });

  it('kartony leżą na podstawie palety, także na piętrze, a pierścień zaznaczenia obejmuje tę paletę', () => {
    const { view, layers, ring } = viewOf([pallet(1, 'aisle', 0), pallet(2, 'aisle', AISLE)], 2);
    const top = view.worldPosition(2)!;
    expect(ring.visible).toBe(true);
    expect(ring.position.y).toBeCloseTo(top.y + 0.02);
    expect(ring.position.x).toBeCloseTo(top.x);
    // wysokość (y) każdej instancji kartonów: macierz 4×4 ma ją na pozycji 13
    const ys = Array.from({ length: layers.count }, (_, i) => layers.getMatrixAt(i, new Matrix4()).elements[13]!);
    expect(ys).toHaveLength(6);   // dwie pełne palety po trzy warstwy
    expect(Math.min(...ys.slice(0, 3))).toBeGreaterThan(0);
    expect(Math.min(...ys.slice(3))).toBeGreaterThan(top.y);   // kartony wyższej palety zaczynają się nad jej podstawą
    expect(Math.min(...ys.slice(3))).toBeGreaterThan(Math.max(...ys.slice(0, 3)));   // i nad kartonami palety pod spodem
    view.dispose();
  });

  it('mieści 256 palet naraz i pozwala je wskazać promieniem (instancja → id)', () => {
    const many = Array.from({ length: 300 }, (_, i) => pallet(i + 1, 'aisle', i));
    const { view, bases, layers } = viewOf(many);
    expect(bases.count).toBe(256);
    expect(layers.count).toBe(256 * 3);
    expect(view.palletAt(bases, 0)).toBe(1);
    expect(view.palletAt(bases, 255)).toBe(256);
    expect(view.palletAt(layers, 0)).toBe(1);
    expect(view.palletAt(layers, 3)).toBe(2);
    expect(view.worldPosition(257)).toBeNull();
    view.dispose();
  });

  it('paleta bez miejsca w układzie (numer poza listą zwykłej lokalizacji) nie jest rysowana', () => {
    const { view, bases } = viewOf([pallet(1, 'floor', 9_999), pallet(2, 'backroom', 0)]);
    expect(view.worldPosition(1)).toBeNull();
    expect(view.worldPosition(2)).not.toBeNull();
    expect(bases.count).toBe(1);
    view.dispose();
  });
});
