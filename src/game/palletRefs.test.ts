import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CATS, OPEN_FROM, type Cat } from '@/sim/economy/catalog';
import { createEconomy, type EconomyState, type Pallet } from '@/sim/economy/economy';
import { computeStoreInfo, spotCells } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { MARKER_LIFT, crowdObstaclesOf, palletMarkersOf, palletRefsOf } from './palletRefs';

const SEED = 'ludzie-na-ekranie';
const info = computeStoreInfo(generateStore(SEED));

const perCat = (v: number): Record<Cat, number> => Object.fromEntries(CATS.map((c) => [c, v])) as Record<Cat, number>;
const clone = <T>(v: T): T => structuredClone(v);

/** Paleta z towarem w jednej kategorii (`total` sztuk) albo pusta (`total = 0`), w podanym miejscu. */
function pallet(id: number, total: number, loc: Pallet['loc'] = 'sidewalk', spot = 0, since = OPEN_FROM): Pallet {
  const items = perCat(0);
  items.napoje = total;
  return { id, loc, spot, items, total, initial: Math.max(total, 1), since };
}

/** Sklep w środku dnia bez palet. */
function calm(staff: number): EconomyState {
  const s = createEconomy(SEED, info);
  s.minute = 12 * 60;
  s.staff = staff;
  s.pallets = [];
  return s;
}

describe('palletRefsOf', () => {
  it('pomija palety z total = 0 i zachowuje kolejność s.pallets', () => {
    const s = calm(2);
    s.pallets = [pallet(1, 20, 'sidewalk', 0, 400), pallet(2, 0, 'sidewalk', 1), pallet(3, 12, 'floor', 0, 410), pallet(4, 0, 'floor', 0)];
    const refs = palletRefsOf(s, info);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.since)).toEqual([400, 410]);
    expect(refs.map((r) => r.loc)).toEqual(['sidewalk', 'floor']);
  });

  it('miejsce to kopia wpisu z info.spots, a nie ten sam obiekt', () => {
    const s = calm(2);
    s.pallets = [pallet(1, 20, 'sidewalk', 0, 400)];
    const [ref] = palletRefsOf(s, info);
    expect(ref.spot).toEqual(info.spots.sidewalk[0]);
    expect(ref.spot).not.toBe(info.spots.sidewalk[0]);
    const x = info.spots.sidewalk[0].x;
    ref.spot.x += 100;
    expect(info.spots.sidewalk[0].x).toBe(x);
  });

  it('paleta bez znanego miejsca (indeks poza info.spots) jest pomijana', () => {
    const s = calm(2);
    s.pallets = [pallet(1, 20, 'sidewalk', 999), pallet(2, 20, 'sidewalk', -1), pallet(3, 20, 'sidewalk', 0)];
    const refs = palletRefsOf(s, info);
    expect(refs).toHaveLength(1);
    expect(refs[0].spot).toEqual(info.spots.sidewalk[0]);
  });

  it('paleta w przejściu: kwadrat z info.spots.aisle, także dla pięter stosu (numer ponad liczbę kwadratów)', () => {
    const n = info.spots.aisle.length;
    expect(n).toBeGreaterThanOrEqual(3);
    const s = calm(2);
    s.pallets = [pallet(1, 20, 'aisle', 2, 400), pallet(2, 20, 'aisle', 2 + n, 410), pallet(3, 20, 'aisle', 2 + 5 * n, 420), pallet(4, 20, 'aisle', -1)];
    const refs = palletRefsOf(s, info);
    expect(refs.map((r) => r.loc)).toEqual(['aisle', 'aisle', 'aisle']);
    for (const r of refs) expect(r.spot).toEqual(info.spots.aisle[2]);   // trzy piętra jednego kwadratu; ujemny numer odpada
    expect(refs.map((r) => r.since)).toEqual([400, 410, 420]);
    expect(refs[0]!.spot).not.toBe(info.spots.aisle[2]);   // kopia
  });

  it('bez palet daje pustą listę, a świeża gra ma palety pod drzwiami', () => {
    expect(palletRefsOf(calm(2), info)).toEqual([]);
    const fresh = createEconomy(SEED, info);
    const refs = palletRefsOf(fresh, info);
    expect(refs).toHaveLength(fresh.pallets.filter((p) => p.total > 0).length);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(info.spots[r.loc]).toContainEqual(r.spot);
  });

  it('tylko odczyt: nie zmienia stanu ekonomii ani informacji o sklepie', () => {
    const s = calm(6);
    s.pallets = [pallet(1, 20), pallet(2, 0, 'floor', 0)];
    const before = clone(s);
    const infoBefore = clone(info);
    palletRefsOf(s, info);
    expect(s).toEqual(before);
    expect(info).toEqual(infoBefore);
  });
});

describe('crowdObstaclesOf', () => {
  const keys = (cells: { x: number; y: number }[]): string[] => cells.map((c) => `${c.x},${c.y}`).sort();

  it('chodnik, sala i przejścia zagradzają tłumowi drogę, zaplecze nie', () => {
    const s = calm(2);
    s.pallets = [pallet(1, 20, 'sidewalk', 0), pallet(2, 20, 'floor', 0), pallet(3, 20, 'aisle', 0), pallet(4, 20, 'backroom', 0)];
    const expected = [info.spots.sidewalk[0]!, info.spots.floor[0]!, info.spots.aisle[0]!].flatMap((spot) => spotCells(spot));
    expect(keys(crowdObstaclesOf(s, info))).toEqual(keys(expected));
  });

  it('piętra stosu w przejściach liczą się raz, a palety bez miejsca w układzie odpadają', () => {
    const n = info.spots.aisle.length;
    const s = calm(2);
    s.pallets = [pallet(1, 20, 'aisle', 1), pallet(2, 20, 'aisle', 1 + n), pallet(3, 20, 'aisle', 1 + 2 * n), pallet(4, 20, 'floor', 9_999)];
    const cells = crowdObstaclesOf(s, info);
    expect(cells).toHaveLength(4);   // jeden kwadrat 2×2
    expect(keys(cells)).toEqual(keys(spotCells(info.spots.aisle[1]!)));
  });

  it('tylko odczyt', () => {
    const s = calm(2);
    s.pallets = [pallet(1, 20, 'aisle', 0)];
    const before = clone(s);
    crowdObstaclesOf(s, info);
    expect(s).toEqual(before);
  });
});

describe('palletMarkersOf', () => {
  /** Środek podstawy palety w świecie: pozycja według numeru miejsca (x), a piętro stosu według `level` (y). */
  const positions = (levels: Record<number, { x: number; z: number; y: number }>) => (id: number): Vector3 | null => {
    const at = levels[id];
    return at ? new Vector3(at.x, at.y, at.z) : null;
  };
  const stub = positions({
    1: { x: 1, y: 0, z: 1 }, 2: { x: 5, y: 0, z: 5 }, 3: { x: 9, y: 0, z: 9 }, 4: { x: 9, y: 1.22, z: 9 }, 5: { x: 9, y: 2.44, z: 9 }, 6: { x: 12, y: 0, z: 12 },
  });
  const OLD = 100;   // paleta stoi pod sklepem od 2 godzin, gra jest minutę później niż jej `since`

  it('złota paleta dostaje ✨, pod sklepem od godziny ⚠️ (risk), a świeża pod sklepem nic', () => {
    const s = calm(2);
    s.minute = 1000;
    s.pallets = [{ ...pallet(1, 20, 'sidewalk', 0, s.minute - OLD), golden: true }, pallet(2, 20, 'sidewalk', 1, s.minute - OLD), pallet(6, 20, 'sidewalk', 2, s.minute - 10)];
    const marks = palletMarkersOf(s, info, stub);
    expect(marks.map((m) => [m.key, m.text, m.kind])).toEqual([['g1', '✨', 'golden'], ['r2', '⚠️', 'risk']]);
    expect(marks[0]!.world.y).toBeCloseTo(MARKER_LIFT);
  });

  it('palety w przejściach dostają ⚠️ kind clutter, także świeże i niezależnie od czasu stania', () => {
    const s = calm(2);
    s.minute = 1000;
    s.pallets = [pallet(1, 20, 'aisle', 0, s.minute), pallet(2, 20, 'aisle', 1, s.minute - OLD)];
    const marks = palletMarkersOf(s, info, stub);
    expect(marks).toHaveLength(2);
    expect(marks.every((m) => m.text === '⚠️' && m.kind === 'clutter')).toBe(true);
    expect(new Set(marks.map((m) => m.key)).size).toBe(2);
    expect(marks.map((m) => m.world.x).sort()).toEqual([1, 5]);
    expect(marks.every((m) => m.world.y === MARKER_LIFT)).toBe(true);
  });

  it('stos w przejściu ma jeden znacznik, nad najwyższą paletą, a klucz zależy od kwadratu, nie od palety', () => {
    const n = info.spots.aisle.length;
    const s = calm(2);
    s.pallets = [pallet(3, 20, 'aisle', 3), pallet(4, 20, 'aisle', 3 + n), pallet(5, 20, 'aisle', 3 + 2 * n)];
    const [mark] = palletMarkersOf(s, info, stub);
    expect(palletMarkersOf(s, info, stub)).toHaveLength(1);
    expect(mark!.world.y).toBeCloseTo(2.44 + MARKER_LIFT);
    expect(mark!.kind).toBe('clutter');
    s.pallets = [pallet(3, 20, 'aisle', 3), pallet(4, 20, 'aisle', 3 + n)];   // wyższa paleta rozładowana: znacznik schodzi, klucz ten sam
    const [lower] = palletMarkersOf(s, info, stub);
    expect(lower!.key).toBe(mark!.key);
    expect(lower!.world.y).toBeCloseTo(1.22 + MARKER_LIFT);
  });

  it('złota paleta w przejściu ma ✨ jak każda złota i nie dubluje się znacznikiem zagracenia; paleta bez widoku jest pomijana', () => {
    const s = calm(2);
    s.pallets = [{ ...pallet(1, 20, 'aisle', 0), golden: true }, pallet(99, 20, 'aisle', 1)];
    const marks = palletMarkersOf(s, info, stub);
    expect(marks.map((m) => [m.key, m.kind])).toEqual([['g1', 'golden']]);
  });

  it('znaczniki nie ruszają stanu ani zwróconych pozycji z widoku (to kopie)', () => {
    const s = calm(2);
    s.pallets = [pallet(1, 20, 'aisle', 0)];
    const before = clone(s);
    palletMarkersOf(s, info, stub);
    expect(s).toEqual(before);
    expect(stub(1)!.y).toBe(0);
  });
});
