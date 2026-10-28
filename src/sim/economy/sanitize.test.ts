import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateStore } from '@/sim/store/generateStore';
import { CATS, MINUTES_PER_DAY } from './catalog';
import { buyEquipment, buyUpgrade, createEconomy, stepMinute, type EconEvent, type EconomyState } from './economy';
import { sanitizeEconomy } from './sanitize';
import { computeStoreInfo, type StoreInfo } from './storeInfo';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));
const defaults = (inf: StoreInfo = info, seed = SEED): EconomyState => createEconomy(seed, inf);

const play = (s: EconomyState, inf: StoreInfo, days: number): void => {
  const events: EconEvent[] = [];
  for (let i = 0; i < days * MINUTES_PER_DAY; i++) stepMinute(s, inf, events);
};
const json = (s: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(s)) as Record<string, unknown>;

/** Szuka w stanie liczb nieskończonych albo NaN (JSON zapisuje je jako null, więc w pamięci sprawdzamy od razu). */
function nonFinite(v: unknown, path = 'stan'): string[] {
  if (typeof v === 'number') return Number.isFinite(v) ? [] : [`${path} = ${v}`];
  if (Array.isArray(v)) return v.flatMap((x, i) => nonFinite(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => nonFinite(x, `${path}.${k}`));
  return [];
}

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../game/fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;

describe('sanitizeEconomy: poprawny stan przechodzi bez zmian', () => {
  it('nowa gra', () => {
    const s = defaults();
    expect(sanitizeEconomy(json(s), defaults())).toEqual(s);
  });

  it('gra po 30 dniach z zakupami, zleceniami i raportem miesięcznym', () => {
    const s = defaults();
    s.cash = 500_000;
    s.level = 12;
    for (const id of ['ulotki', 'szkolenie', 'wozek', 'regaly', 'tasmociag', 'wykladacz'] as const) buyUpgrade(s, id);
    buyEquipment(s, info, 'sco');
    buyEquipment(s, info, 'piec');
    play(s, info, 30);
    expect(s.lastReport).not.toBeNull();
    expect(sanitizeEconomy(json(s), defaults())).toEqual(s);
    // także co do bajta po zapisie w JSON (kolejność kluczy): na tym oprze się porównywanie i haszowanie stanów
    expect(JSON.stringify(sanitizeEconomy(json(s), defaults()))).toBe(JSON.stringify(s));
  });

  it('gra zaawansowana (humanoid, warsztat, sprzęt, sieć sklepów) przechodzi bez zmian co 10 dni przez 60 dni', () => {
    const s = createEconomy(SEED, info, { points: 6, networkIncome: 1200, stores: 2 });
    s.cash = 5_000_000;
    s.level = 30;
    s.remontLevel = 2;
    s.order = { auto: false, manual: 5 };
    Object.assign(s.upgrades, { ulotki: 5, szkolenie: 5, drugaKasa: 2, wozek: 3, regaly: 3, asystent: 2, nocne: 1, rampa: 1, dostawy2: 1, tasmociag: 3, wykladacz: 3, humanoid: 1 });
    for (const id of ['sco', 'sco', 'bankomat', 'piec', 'paczkownik'] as const) buyEquipment(s, info, id);
    for (let block = 0; block < 6; block++) {
      play(s, info, 10);
      expect(JSON.stringify(sanitizeEconomy(json(s), defaults()))).toBe(JSON.stringify(s));
    }
    expect(s.total.palletsUnloaded).toBeGreaterThan(50);
  });

  it('stan w trakcie remontu i stan po bankructwie też przechodzą bez zmian', () => {
    const closed = defaults();
    closed.remontLevel = 1;
    closed.remontUntil = closed.minute + 3 * MINUTES_PER_DAY;
    expect(sanitizeEconomy(json(closed), defaults())).toEqual(closed);
    const bankrupt = defaults();
    bankrupt.cash = -1e6;
    play(bankrupt, info, 30);
    expect(bankrupt.gameOver).toBe(true);
    expect(JSON.stringify(sanitizeEconomy(json(bankrupt), defaults()))).toBe(JSON.stringify(bankrupt));
  });

  it('prawdziwe zapisy v1 z produkcji (sprzed koperty v2): wszystkie pola zachowane, nowe uzupełnione', () => {
    for (const [file, seed] of [['save-v1-blok-dzien40.json', 'kiełbasa-42'], ['save-v1-remont1.json', 'traszka-1']] as const) {
      const raw = fixture(file);
      const inf = computeStoreInfo(generateStore(seed));
      const out = sanitizeEconomy(raw, defaults(inf, seed))!;
      expect(out).not.toBeNull();
      expect(out).toEqual({ ...raw, lastReport: null });
    }
  });

  it('nie gubi żadnego pola stanu: klucze wyniku to klucze createEconomy', () => {
    const out = sanitizeEconomy(json(defaults()), defaults())!;
    expect(Object.keys(out).sort()).toEqual(Object.keys(defaults()).sort());
  });
});

describe('sanitizeEconomy: napraw to, co da się naprawić', () => {
  const repaired = (patch: Record<string, unknown>): EconomyState => {
    const s = defaults();
    play(s, info, 2);
    const out = sanitizeEconomy({ ...json(s), ...patch }, defaults());
    expect(out).not.toBeNull();
    return out!;
  };

  /** Naprawiony stan musi dać się grać: trzy dni bez wyjątku i bez NaN. */
  const playable = (s: EconomyState): void => {
    expect(nonFinite(s)).toEqual([]);
    play(s, info, 3);
    expect(Number.isFinite(s.cash)).toBe(true);
    expect(Number.isFinite(s.reputation)).toBe(true);
    expect(nonFinite(s)).toEqual([]);
  };

  it('cash: "abc" i cash: null (NaN zapisane przez JSON jako null) wracają do wartości początkowej', () => {
    for (const bad of ['abc', null, '12', {}, [1]]) {
      const s = repaired({ cash: bad });
      expect(s.cash).toBe(defaults().cash);
      playable(s);
    }
  });

  it('reputacja, zaufanie, kolejka, pracownicy: zła wartość daje domyślną, a skrajna jest przycięta do zakresu', () => {
    const s = repaired({ reputation: null, trust: 'x', queue: -4, staff: 99, level: -3, remontLevel: 17 });
    expect(s.reputation).toBe(50);
    expect(s.trust).toBe(60);
    expect(s.queue).toBe(0);
    expect(s.staff).toBe(8);
    expect(s.level).toBe(1);
    expect(s.remontLevel).toBe(3);
    playable(s);
  });

  it('półka i zaplecze bez jednej kategorii: brakująca kategoria to 0 (wcześniej cała gotówka i reputacja stawały się NaN)', () => {
    const base = json(defaults());
    const shelf = { ...(base.shelf as Record<string, number>) };
    delete shelf.alkohol;
    const backroom = { ...(base.backroom as Record<string, number>) };
    delete backroom.napoje;
    const s = repaired({ shelf, backroom });
    expect(s.shelf.alkohol).toBe(0);
    expect(s.backroom.napoje).toBe(0);
    for (const c of CATS) { expect(Number.isFinite(s.shelf[c])).toBe(true); expect(Number.isFinite(s.backroom[c])).toBe(true); }
    playable(s);
  });

  it('półka z null (NaN) i ujemną ilością: liczby skończone, nieujemne', () => {
    const base = json(defaults());
    const s = repaired({ shelf: { ...(base.shelf as object), napoje: null, nabial: -5 } });
    expect(s.shelf.napoje).toBe(0);
    expect(s.shelf.nabial).toBe(0);
    playable(s);
  });

  it('licznik z null: to 0, a brakujący licznik (stary zapis) to zerowy', () => {
    const base = json(defaults());
    const s = repaired({ today: { ...(base.today as object), customers: null, margin: 'x' }, month: undefined });
    expect(s.today.customers).toBe(0);
    expect(s.today.margin).toBe(0);
    expect(s.month.customers).toBe(0);
    playable(s);
  });

  it('uszkodzone elementy list wypadają, reszta zostaje', () => {
    const s = defaults();
    const good = json(s.pallets[0]);
    const out = sanitizeEconomy({
      ...json(s),
      pallets: [null, 7, { ...good, items: null }, { ...good, loc: 'dach' }, { ...good, spot: 'x' }, good, { ...good }],
      deliveries: [{ at: null, count: 2 }, { at: 9000, count: 2 }, 'x'],
      equipment: [{ id: 'sco', slot: 'a' }, { id: 'czołg', slot: 'b' }, { id: 'piec', slot: 5 }, null],
      history: [{ label: 'wrzesień 2026', profit: null, revenue: 10 }, { profit: 1 }, 3],
      milestones: ['pallet1', 7, null, 'upgrade1'],
      quests: [null, { id: 1 }, ...json(s).quests as unknown[]],
    }, defaults())!;
    expect(out.pallets).toHaveLength(1);
    expect(out.pallets[0]!.id).toBe(s.pallets[0]!.id);
    expect(out.deliveries).toEqual([{ at: 9000, count: 2 }]);
    expect(out.equipment).toEqual([{ id: 'sco', slot: 'a' }, { id: 'piec', slot: null }]);
    expect(out.history).toEqual([{ label: 'wrzesień 2026', profit: 0, revenue: 10 }]);
    expect(out.milestones).toEqual(['pallet1', 'upgrade1']);
    expect(out.quests).toHaveLength(3);
  });

  it('ulepszenia: nieznane i zbyt wysokie poziomy są odrzucone albo przycięte', () => {
    const out = sanitizeEconomy({ ...json(defaults()), upgrades: { ulotki: 99, szkolenie: 'x', czołg: 3, wozek: 2.4, klima: -1 } }, defaults())!;
    expect(out.upgrades).toEqual({ ulotki: 5, wozek: 2 });
  });

  it('paleta: suma sztuk wynika z zawartości, a nowy numer palety nie koliduje z istniejącymi', () => {
    const s = defaults();
    const p = json(s.pallets[0]) as { id: number; total: number };
    const out = sanitizeEconomy({ ...json(s), nextPalletId: 1, pallets: [{ ...p, id: 40, total: null }] }, defaults())!;
    expect(out.pallets[0]!.total).toBeCloseTo(CATS.reduce((n, c) => n + out.pallets[0]!.items[c], 0), 9);
    expect(out.nextPalletId).toBe(41);
  });

  it('tryb gry po zepsuciu enuma wraca do domyślnego', () => {
    const out = sanitizeEconomy({ ...json(defaults()), priority: 'szalony', order: { auto: 'tak', manual: null } }, defaults())!;
    expect(out.priority).toBe('rowno');
    expect(out.order).toEqual({ auto: true, manual: 4 });
  });
});

describe('sanitizeEconomy: czego nie da się naprawić', () => {
  const broken = (patch: Record<string, unknown>): EconomyState | null => sanitizeEconomy({ ...json(defaults()), ...patch }, defaults());

  it('lista tam, gdzie ma być lista, i obiekt tam, gdzie ma być obiekt', () => {
    expect(broken({ pallets: null })).toBeNull();
    expect(broken({ pallets: {} })).toBeNull();
    expect(broken({ upgrades: null })).toBeNull();
    expect(broken({ upgrades: [] })).toBeNull();
    expect(broken({ equipment: 'sco' })).toBeNull();
    expect(broken({ quests: 3 })).toBeNull();
    expect(broken({ shelf: 'pełna' })).toBeNull();
    expect(broken({ today: null })).toBeNull();
    expect(broken({ order: 4 })).toBeNull();
  });

  it('nie to, czego szukamy: nie obiekt, zła wersja, cudzy seed', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) expect(sanitizeEconomy(raw, defaults())).toBeNull();
    expect(broken({ version: 2 })).toBeNull();
    expect(broken({ version: undefined })).toBeNull();
    expect(broken({ seed: 'inny-sklep' })).toBeNull();
  });
});
