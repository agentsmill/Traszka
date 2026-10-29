import { describe, expect, it } from 'vitest';
import { CATS, OPEN_FROM, type Cat } from '@/sim/economy/catalog';
import { createEconomy, type EconomyState, type Pallet } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { palletRefsOf } from './palletRefs';

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
