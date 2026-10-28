import { describe, expect, it } from 'vitest';
import { STAFF_TASKS, STAFF_VIEW_MAX, type StaffDuty } from '@/render/staff/types';
import { CATS, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO, STAFF_MAX, type Cat } from '@/sim/economy/catalog';
import { createEconomy, type EconomyState, type Pallet } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { palletRefsOf, staffFromEconomy } from './staffAdapter';

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

/**
 * Sklep w środku dnia z jasnym punktem wyjścia: pełne półki, pusty magazyn, brak palet. Test ustawia tylko to,
 * czego dotyczy, więc nie zależy od tego, co `createEconomy` wstawia na start.
 */
function calm(staff: number, lastCashiers: number): EconomyState {
  const s = createEconomy(SEED, info);
  s.minute = 12 * 60;
  s.staff = staff;
  s.lastCashiers = lastCashiers;
  s.shelf = Object.fromEntries(CATS.map((c) => [c, info.shelfCap[c]])) as Record<Cat, number>;
  s.backroom = perCat(0);
  s.pallets = [];
  return s;
}

/** Zadania w kolejności id (`staffFromEconomy` zwraca osoby od id 0). */
const tasks = (s: EconomyState): StaffDuty[] => staffFromEconomy(s, info).map((a) => a.task);
const count = (list: StaffDuty[], task: StaffDuty): number => list.filter((t) => t === task).length;

/** Pierwsza kategoria, która ma pojemność półki (żeby test nie zakładał, że każda ją ma). */
const cat: Cat = CATS.find((c) => info.shelfCap[c] > 0) as Cat;

describe('typy wspólne warstwy ludzi', () => {
  it('STAFF_VIEW_MAX to STAFF_MAX, a zadań do obsługi w widoku jest cztery', () => {
    expect(STAFF_VIEW_MAX).toBe(STAFF_MAX);
    expect(STAFF_TASKS).toEqual(['kasa', 'rozladunek', 'wykladanie', 'sprzatanie']);
  });
});

describe('staffFromEconomy: godziny pracy', () => {
  it('poza godzinami otwarcia lista jest pusta, także w kolejnych dniach', () => {
    for (const day of [0, 1, 7]) {
      for (const mod of [0, OPEN_FROM - 1, OPEN_TO, MINUTES_PER_DAY - 1]) {
        const s = calm(4, 2);
        s.minute = day * MINUTES_PER_DAY + mod;
        expect(staffFromEconomy(s, info)).toEqual([]);
      }
    }
  });

  it('od otwarcia do ostatniej minuty przed zamknięciem personel jest na zmianie', () => {
    for (const mod of [OPEN_FROM, 12 * 60, OPEN_TO - 1]) {
      const s = calm(3, 1);
      s.minute = 2 * MINUTES_PER_DAY + mod;
      expect(staffFromEconomy(s, info)).toHaveLength(3);
    }
  });

  it('remont nie wyprowadza ludzi ze sklepu: w godzinach otwarcia pracują, choć nikt nie stoi na kasie', () => {
    const s = calm(3, 0);
    s.remontUntil = s.minute + 600;
    expect(tasks(s)).not.toContain('kasa');
    expect(staffFromEconomy(s, info)).toHaveLength(3);
  });
});

describe('staffFromEconomy: liczba osób i identyfikatory', () => {
  it('staff od 1 do STAFF_MAX daje id 0…n−1', () => {
    for (let n = 1; n <= STAFF_MAX; n++) {
      const s = calm(n, 1);
      expect(staffFromEconomy(s, info).map((a) => a.id)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it('nie zwraca więcej osób niż STAFF_MAX, a ułamek zatrudnienia obcina w dół', () => {
    expect(staffFromEconomy(calm(STAFF_MAX + 5, 1), info)).toHaveLength(STAFF_MAX);
    expect(staffFromEconomy(calm(1000, 1), info)).toHaveLength(STAFF_MAX);
    expect(staffFromEconomy(calm(2.9, 1), info)).toHaveLength(2);
  });

  it('zero albo ujemne zatrudnienie to pusta lista', () => {
    expect(staffFromEconomy(calm(0, 0), info)).toEqual([]);
    expect(staffFromEconomy(calm(-3, 0), info)).toEqual([]);
  });
});

describe('staffFromEconomy: kasa', () => {
  it('lastCashiers wyznacza liczbę kasjerów i zawsze są to najmniejsze id', () => {
    for (let cashiers = 0; cashiers <= 5; cashiers++) {
      const list = tasks(calm(5, cashiers));
      expect(count(list, 'kasa')).toBe(cashiers);
      expect(list.slice(0, cashiers).every((t) => t === 'kasa')).toBe(true);
      expect(list.slice(cashiers).every((t) => t !== 'kasa')).toBe(true);
    }
  });

  it('kasjerów nie ma więcej niż osób na zmianie, a ujemna liczba to zero', () => {
    expect(tasks(calm(3, 7))).toEqual(['kasa', 'kasa', 'kasa']);
    expect(count(tasks(calm(3, -2)), 'kasa')).toBe(0);
  });

  it('remont (lastCashiers = 0): wszyscy to pracownicy przy towarze', () => {
    const s = calm(4, 0);
    s.backroom[cat] = 10;
    s.shelf[cat] = 0;
    expect(tasks(s)).toEqual(['wykladanie', 'wykladanie', 'wykladanie', 'wykladanie']);
  });
});

describe('staffFromEconomy: pracownicy przy towarze', () => {
  it('pilne wykładanie (półka poniżej połowy, towar na zapleczu) bierze pierwszego pracownika', () => {
    const s = calm(3, 1);
    s.shelf[cat] = info.shelfCap[cat] * 0.4;
    s.backroom[cat] = 5;
    s.pallets = [pallet(1, 20)];
    // kasa, potem pilne wykładanie, a dopiero potem rozładunek jedynej palety
    expect(tasks(s)).toEqual(['kasa', 'wykladanie', 'rozladunek']);
  });

  it('bez pilnej potrzeby pierwszy pracownik rozładowuje paletę', () => {
    const s = calm(3, 1);
    s.pallets = [pallet(1, 20)];
    expect(tasks(s)[1]).toBe('rozladunek');
  });

  it('półka dokładnie w połowie nie jest jeszcze pilna', () => {
    const s = calm(2, 1);
    s.shelf[cat] = info.shelfCap[cat] * 0.5;
    s.backroom[cat] = 5;
    s.pallets = [pallet(1, 20)];
    expect(tasks(s)).toEqual(['kasa', 'rozladunek']);
  });

  it('pusta półka bez towaru na zapleczu nie jest pilna: nie ma z czego wykładać', () => {
    const s = calm(2, 1);
    s.shelf[cat] = 0;
    s.backroom[cat] = 0;
    expect(tasks(s)).toEqual(['kasa', 'wolny']);
  });

  it('kategoria bez miejsca na półce nie liczy się do pilnych (dzielenie przez zero)', () => {
    const s = calm(2, 1);
    const noCap = { ...info, shelfCap: { ...info.shelfCap, [cat]: 0 } };
    s.shelf = Object.fromEntries(CATS.map((c) => [c, noCap.shelfCap[c]])) as Record<Cat, number>;
    s.backroom[cat] = 10;
    expect(staffFromEconomy(s, noCap).map((a) => a.task)).toEqual(['kasa', 'wolny']);
  });

  it('palety: rozładunek dostaje tylu ludzi, ile palet z towarem, reszta jest wolna', () => {
    const s = calm(8, 1);
    s.pallets = [pallet(1, 20), pallet(2, 30, 'sidewalk', 1), pallet(3, 10, 'floor', 0)];
    const list = tasks(s);
    expect(count(list, 'rozladunek')).toBe(3);
    expect(list).toEqual(['kasa', 'rozladunek', 'rozladunek', 'rozladunek', 'wolny', 'wolny', 'wolny', 'wolny']);
  });

  it('palet jest więcej niż ludzi: wszyscy pracownicy rozładowują', () => {
    const s = calm(3, 1);
    s.pallets = [pallet(1, 20), pallet(2, 30, 'sidewalk', 1), pallet(3, 10, 'floor', 0), pallet(4, 5, 'floor', 1)];
    expect(tasks(s)).toEqual(['kasa', 'rozladunek', 'rozladunek']);
  });

  it('pusta paleta (total = 0) nie zajmuje nikogo', () => {
    const s = calm(4, 1);
    s.pallets = [pallet(1, 0), pallet(2, 15, 'sidewalk', 1), pallet(3, 0, 'floor', 0)];
    expect(tasks(s)).toEqual(['kasa', 'rozladunek', 'wolny', 'wolny']);
  });

  it('po rozładunku reszta dokłada towar do pełna, jeśli jest co i na co', () => {
    const s = calm(4, 1);
    s.pallets = [pallet(1, 20)];
    s.shelf[cat] = info.shelfCap[cat] * 0.8;   // niepilne, ale nie pełne
    s.backroom[cat] = 7;
    expect(tasks(s)).toEqual(['kasa', 'rozladunek', 'wykladanie', 'wykladanie']);
  });

  it('pusty magazyn i pełne półki: pracownicy są wolni', () => {
    expect(tasks(calm(4, 1))).toEqual(['kasa', 'wolny', 'wolny', 'wolny']);
  });

  it('pełne półki mimo towaru na zapleczu: nie ma gdzie dokładać, więc wolny', () => {
    const s = calm(3, 1);
    s.backroom[cat] = 50;
    expect(tasks(s)).toEqual(['kasa', 'wolny', 'wolny']);
  });

  it('adapter nigdy nie zwraca sprzątania (śmieci i czystość dopiero w etapie 2C2)', () => {
    const s = calm(STAFF_MAX, 2);
    s.pallets = [pallet(1, 20)];
    s.backroom[cat] = 10;
    s.shelf[cat] = 0;
    expect(tasks(s)).not.toContain('sprzatanie');
  });
});

describe('staffFromEconomy: tylko odczyt', () => {
  it('nie zmienia stanu ekonomii ani informacji o sklepie', () => {
    const s = calm(6, 2);
    s.pallets = [pallet(1, 20), pallet(2, 0, 'floor', 0)];
    s.shelf[cat] = 1;
    s.backroom[cat] = 9;
    const before = clone(s);
    const infoBefore = clone(info);
    staffFromEconomy(s, info);
    palletRefsOf(s, info);
    expect(s).toEqual(before);
    expect(info).toEqual(infoBefore);
  });

  it('zwraca świeże obiekty: zmiana wyniku nie dotyka stanu', () => {
    const s = calm(3, 1);
    const list = staffFromEconomy(s, info);
    list[0].task = 'wolny';
    list.length = 0;
    expect(staffFromEconomy(s, info)).toHaveLength(3);
    expect(tasks(s)[0]).toBe('kasa');
  });
});

describe('palletRefsOf', () => {
  it('pomija palety z total = 0 i zachowuje kolejność s.pallets', () => {
    const s = calm(2, 1);
    s.pallets = [pallet(1, 20, 'sidewalk', 0, 400), pallet(2, 0, 'sidewalk', 1), pallet(3, 12, 'floor', 0, 410), pallet(4, 0, 'floor', 0)];
    const refs = palletRefsOf(s, info);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.since)).toEqual([400, 410]);
    expect(refs.map((r) => r.loc)).toEqual(['sidewalk', 'floor']);
  });

  it('miejsce to kopia wpisu z info.spots, a nie ten sam obiekt', () => {
    const s = calm(2, 1);
    s.pallets = [pallet(1, 20, 'sidewalk', 0, 400)];
    const [ref] = palletRefsOf(s, info);
    expect(ref.spot).toEqual(info.spots.sidewalk[0]);
    expect(ref.spot).not.toBe(info.spots.sidewalk[0]);
    const x = info.spots.sidewalk[0].x;
    ref.spot.x += 100;
    expect(info.spots.sidewalk[0].x).toBe(x);
  });

  it('paleta bez znanego miejsca (indeks poza info.spots) jest pomijana', () => {
    const s = calm(2, 1);
    s.pallets = [pallet(1, 20, 'sidewalk', 999), pallet(2, 20, 'sidewalk', -1), pallet(3, 20, 'sidewalk', 0)];
    const refs = palletRefsOf(s, info);
    expect(refs).toHaveLength(1);
    expect(refs[0].spot).toEqual(info.spots.sidewalk[0]);
  });

  it('bez palet daje pustą listę, a świeża gra ma palety pod drzwiami', () => {
    expect(palletRefsOf(calm(2, 1), info)).toEqual([]);
    const fresh = createEconomy(SEED, info);
    const refs = palletRefsOf(fresh, info);
    expect(refs).toHaveLength(fresh.pallets.filter((p) => p.total > 0).length);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(info.spots[r.loc]).toContainEqual(r.spot);
  });
});
