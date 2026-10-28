import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAT_INFO, CATS, CREDIT_LIMIT, MINUTES_PER_DAY, OPEN_FROM, PALLET_ITEMS } from '@/sim/economy/catalog';
import { buyEquipment, buyUpgrade, startRemont, stepMinute, tapPallet, type EconEvent, type EconomyState } from '@/sim/economy/economy';
import { LIMITS } from '@/sim/economy/sanitize';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { REMONTS } from '@/sim/economy/upgrades';
import { GENERATOR_VERSION, generateStore } from '@/sim/store/generateStore';
import { MemoryStorage } from './memoryStorage';
import {
  BROKEN_SAVE_NOTICE, NEWER_SAVE_NOTICE, SAVE_SCHEMA, createSession, deleteSave, discardSave, lastSavedSeed, layoutFor, quarantineSave,
  retireSession, reviveSession, saveSession, syncLayout, type GameSession,
} from './session';

const BLOK = 'kiełbasa-42';
const PAWILON = 'traszka-1';
const key = (seed: string): string => `traszka:save:${seed}`;
const text = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const gameVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

let storage: MemoryStorage;
let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});   // wczytanie uszkodzonego zapisu loguje przyczynę
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const play = (s: GameSession, days: number): EconEvent[] => {
  const events: EconEvent[] = [];
  for (let i = 0; i < days * MINUTES_PER_DAY; i++) stepMinute(s.econ, s.info, events);
  return events;
};

function nonFinite(v: unknown, path = 'stan'): string[] {
  if (typeof v === 'number') return Number.isFinite(v) ? [] : [`${path} = ${v}`];
  if (Array.isArray(v)) return v.flatMap((x, i) => nonFinite(x, `${path}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => nonFinite(x, `${path}.${k}`));
  return [];
}

/** Sesja ma się dać grać: trzy dni bez wyjątku, bez NaN w stanie. */
function expectPlayable(s: GameSession): void {
  expect(nonFinite(s.econ)).toEqual([]);
  play(s, 3);
  expect(Number.isFinite(s.econ.cash)).toBe(true);
  expect(Number.isFinite(s.econ.reputation)).toBe(true);
  expect(nonFinite(s.econ)).toEqual([]);
}

/** Gra z kilkoma zakupami i stuknięciami, zapisana na dysku jak w prawdziwej grze. */
function playedSession(seed: string): GameSession {
  const s = createSession(seed, true);
  s.econ.cash = 300_000;
  s.econ.level = 9;
  buyUpgrade(s.econ, 'ulotki');
  buyUpgrade(s.econ, 'wozek');
  buyEquipment(s.econ, s.info, 'sco');
  play(s, 6);
  tapPallet(s.econ, s.info);
  saveSession(s);
  return s;
}

describe('koperta zapisu v2', () => {
  it('zapis ma schemat, wersję gry i generatora, seed, układ sklepu i stan ekonomii', () => {
    const s = playedSession(BLOK);
    const saved = JSON.parse(storage.getItem(key(BLOK))!) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['econ', 'gameVersion', 'generatorVersion', 'layout', 'schema', 'seed']);
    expect(saved.schema).toBe(SAVE_SCHEMA);
    expect(SAVE_SCHEMA).toBe(2);
    expect(saved.gameVersion).toBe(gameVersion);
    expect(saved.generatorVersion).toBe(GENERATOR_VERSION);
    expect(saved.seed).toBe(BLOK);
    expect(saved.layout).toEqual(JSON.parse(JSON.stringify(s.layout)));
    expect(saved.econ).toEqual(JSON.parse(JSON.stringify(s.econ)));
    expect(lastSavedSeed()).toBe(BLOK);
  });

  it('zapis i wczytanie dają ten sam stan ekonomii i ten sam układ, a gra toczy się dalej tak samo', () => {
    for (const seed of [BLOK, PAWILON]) {
      const s = playedSession(seed);
      const loaded = createSession(seed);
      expect(loaded.econ).toEqual(s.econ);
      expect(loaded.layout).toEqual(s.layout);
      expect(loaded.info).toEqual(s.info);
      expect(loaded.layoutLevel).toBe(s.layoutLevel);
      expect(loaded.loadNotice).toBeNull();
      expect(loaded.fromSave).toBe(true);
      play(s, 2);
      play(loaded, 2);
      expect(JSON.stringify(loaded.econ)).toBe(JSON.stringify(s.econ));
    }
  });

  it('wczytany zostaje zapisany układ, nawet gdy generator dałby dziś inny (spec §14.1: zapis nie zależy od generatora)', () => {
    const s = playedSession(BLOK);
    const stored = JSON.parse(storage.getItem(key(BLOK))!) as { layout: Record<string, unknown>; generatorVersion: number };
    const other = JSON.parse(JSON.stringify(generateStore('zupełnie-inny-sklep'))) as Record<string, unknown>;
    other.seed = BLOK;
    other.generatorVersion = 0;
    stored.layout = other;
    stored.generatorVersion = 0;
    storage.setItem(key(BLOK), JSON.stringify({ ...stored, econ: s.econ }));
    const loaded = createSession(BLOK);
    expect(loaded.layout).toEqual(other);
    expect(loaded.layout).not.toEqual(generateStore(BLOK));
    expect(loaded.info.shelfCapTotal).toBeGreaterThan(0);
  });

  it('remont: nowy układ zastępuje zapisany, a po wczytaniu stoi ten sam większy sklep', () => {
    const s = createSession(PAWILON, true);
    s.econ.cash = 1e6;
    s.econ.level = 8;
    saveSession(s);
    const small = (JSON.parse(storage.getItem(key(PAWILON))!) as { layout: { width: number } }).layout.width;
    expect(startRemont(s.econ).ok).toBe(true);
    expect(syncLayout(s)).toBe(true);
    saveSession(s);
    const after = JSON.parse(storage.getItem(key(PAWILON))!) as { layout: { width: number } };
    expect(after.layout.width).toBeGreaterThan(small);
    const loaded = createSession(PAWILON);
    expect(loaded.layout).toEqual(s.layout);
    expect(loaded.layout).toEqual(layoutFor(PAWILON, 1));
    expect(loaded.layoutLevel).toBe(1);
    expect(syncLayout(loaded)).toBe(false);
  });

  it('seed ma własny zapis: inny sklep nie widzi cudzego', () => {
    playedSession(BLOK);
    expect(createSession(PAWILON).fromSave).toBe(false);
  });

  it('nowa gra (fresh) nie czyta zapisu, a deleteSave go usuwa', () => {
    playedSession(BLOK);
    const fresh = createSession(BLOK, true);
    expect(fresh.econ.minute).toBe(OPEN_FROM);
    expect(fresh.fromSave).toBe(false);
    deleteSave(BLOK);
    expect(storage.getItem(key(BLOK))).toBeNull();
  });

  it('brak miejsca albo tryb prywatny: zapis i odczyt nie rzucają', () => {
    const s = createSession(BLOK, true);
    storage.failWrites = true;
    expect(() => saveSession(s)).not.toThrow();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('zablokowane'); }, setItem: () => { throw new Error('zablokowane'); }, removeItem: () => { throw new Error('zablokowane'); } });
    expect(() => createSession(BLOK)).not.toThrow();
    expect(createSession(BLOK).econ.minute).toBe(OPEN_FROM);
    expect(lastSavedSeed()).toBeNull();
  });
});

describe('migracja zapisu v1 (sam stan ekonomii, bez układu)', () => {
  const cases = [
    { file: 'save-v1-blok-dzien40.json', seed: BLOK, remont: 0 },
    { file: 'save-v1-remont1.json', seed: PAWILON, remont: 1 },
  ];

  for (const { file, seed, remont } of cases) {
    it(`${file}: stan zostaje, układ powstaje jak dotąd (layoutFor), zapis zmienia się w v2`, () => {
      const v1 = JSON.parse(text(file)) as EconomyState;
      expect(v1.remontLevel).toBe(remont);
      storage.setItem(key(seed), text(file));

      const s = createSession(seed);
      expect(s.fromSave).toBe(true);
      expect(s.loadNotice).toBeNull();
      expect(s.econ).toEqual({ ...v1, lastReport: null });
      expect(s.layout).toEqual(layoutFor(seed, remont));
      expect(s.layoutLevel).toBe(remont);
      // palety i sprzęt wskazują na istniejące miejsca i sloty w układzie
      for (const p of s.econ.pallets) expect(s.info.spots[p.loc][p.spot], `${p.loc}#${p.spot}`).toBeDefined();
      for (const e of s.econ.equipment) expect(s.info.slots.some((x) => x.id === e.slot), String(e.slot)).toBe(true);
      expect(s.econ.pallets.length).toBeGreaterThan(0);

      const saved = JSON.parse(storage.getItem(key(seed))!) as { schema: number; seed: string; layout: unknown; econ: unknown };
      expect(saved.schema).toBe(2);
      expect(saved.seed).toBe(seed);
      expect(saved.layout).toEqual(JSON.parse(JSON.stringify(s.layout)));
      expect(saved.econ).toEqual(JSON.parse(JSON.stringify(s.econ)));
      expect(storage.getItem(`${key(seed)}:broken`)).toBeNull();

      const again = createSession(seed);
      expect(again.econ).toEqual(s.econ);
      expect(again.layout).toEqual(s.layout);
      expectPlayable(s);
    });
  }

  it('premia z sieci przy wczytaniu jest aktualna, jak dotąd', () => {
    storage.setItem(key(BLOK), text('save-v1-blok-dzien40.json'));
    const partner = { points: 3, networkIncome: 450, stores: 2 };
    expect(createSession(BLOK, false, partner).econ.partner).toEqual(partner);
  });
});

describe('uszkodzone zapisy', () => {
  const v1 = (): Record<string, unknown> => JSON.parse(text('save-v1-blok-dzien40.json')) as Record<string, unknown>;
  const v2 = (econ: unknown = v1(), layout: unknown = layoutFor(BLOK, 0)): Record<string, unknown> => ({
    schema: 2, gameVersion, generatorVersion: GENERATOR_VERSION, seed: BLOK, layout: JSON.parse(JSON.stringify(layout)), econ,
  });
  const without = (rec: Record<string, unknown>, field: string): Record<string, unknown> => {
    const copy = { ...rec };
    delete copy[field];
    return copy;
  };
  const put = (blob: unknown): string => {
    const raw = typeof blob === 'string' ? blob : JSON.stringify(blob);
    storage.setItem(key(BLOK), raw);
    return raw;
  };

  const unrepairable: [string, () => unknown][] = [
    ['ucięty JSON', () => '{"version":1,"seed":"kiełb'],
    ['null', () => 'null'],
    ['lista', () => '[]'],
    ['liczba', () => '42'],
    ['tekst', () => '"zapis"'],
    ['pusty obiekt', () => '{}'],
    ['v1: pallets: null', () => ({ ...v1(), pallets: null })],
    ['v1: upgrades: null', () => ({ ...v1(), upgrades: null })],
    ['v1: cudzy seed', () => ({ ...v1(), seed: 'inny' })],
    ['v1: nieznana wersja stanu', () => ({ ...v1(), version: 7 })],
    ['v2: econ.pallets: null', () => v2({ ...v1(), pallets: null })],
    ['v2: econ.upgrades: null', () => v2({ ...v1(), upgrades: null })],
    ['v2: econ: null', () => v2(null)],
    ['v2: econ.shelf: tekst', () => v2({ ...v1(), shelf: 'pełna' })],
    ['v2: cudzy seed w kopercie', () => ({ ...v2(), seed: 'inny' })],
    ['schemat jako tekst', () => ({ ...v2(), schema: '2' })],
    ['schemat jako tekst z przyszłości', () => ({ ...v2(), schema: '3' })],
    ['schemat 1 w kopercie (żadna wersja gry go nie pisała)', () => ({ ...v2(), schema: 1 })],
  ];
  for (const [name, blob] of unrepairable) {
    it(`nie do naprawienia (${name}): kopia w :broken, komunikat, nowa gra, bez wyjątku`, () => {
      const raw = put(blob());
      const s = createSession(BLOK);
      expect(s.fromSave).toBe(false);
      expect(s.loadNotice).toBe(BROKEN_SAVE_NOTICE);
      expect(BROKEN_SAVE_NOTICE).toBe('Zapis sklepu był uszkodzony — zaczynamy od nowa. Kopia została w przeglądarce.');
      expect(storage.getItem(`${key(BLOK)}:broken`)).toBe(raw);
      expect(storage.getItem(key(BLOK))).toBeNull();   // uszkodzony zapis nie zostaje na swoim miejscu
      expect(s.econ.minute).toBe(OPEN_FROM);
      expect(s.econ.total.customers).toBe(0);
      expect(s.layout).toEqual(generateStore(BLOK));
      expectPlayable(s);
    });
  }

  it('przyczyna uszkodzenia trafia do konsoli (ucięty JSON), a poprawny zapis niczego nie loguje', () => {
    put('{"ucięty');
    createSession(BLOK);
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockClear();
    put(v2());
    createSession(BLOK);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('kolejna awaria nie kasuje wcześniejszej kopii bez śladu: :broken trzyma ostatni uszkodzony zapis', () => {
    put('{"pierwszy":');
    createSession(BLOK);
    const second = put('{"drugi":');
    createSession(BLOK);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBe(second);
  });

  const repairable: [string, () => unknown][] = [
    ['v1: cash: "abc"', () => ({ ...v1(), cash: 'abc' })],
    ['v1: cash: null (NaN zapisane przez JSON)', () => ({ ...v1(), cash: null })],
    ['v1: reputation: null', () => ({ ...v1(), reputation: null })],
    ['v1: półka bez jednej kategorii', () => ({ ...v1(), shelf: without(v1().shelf as Record<string, unknown>, 'alkohol') })],
    ['v1: zaplecze bez jednej kategorii', () => ({ ...v1(), backroom: without(v1().backroom as Record<string, unknown>, 'napoje') })],
    ['v1: półka z null', () => ({ ...v1(), shelf: { ...(v1().shelf as object), chemia: null } })],
    ['v1: licznik z null', () => ({ ...v1(), total: { ...(v1().total as object), customers: null, margin: null } })],
    ['v1: kolejka i personel zepsute', () => ({ ...v1(), queue: null, staff: 'trzech' })],
    ['v1: paleta bez zawartości', () => ({ ...v1(), pallets: [...(v1().pallets as unknown[]), { id: 1, loc: 'floor', spot: 0, items: null }] })],
    ['v2: econ.cash: "abc"', () => v2({ ...v1(), cash: 'abc' })],
    ['v2: econ.reputation: null', () => v2({ ...v1(), reputation: null })],
    ['v2: układ: null (stan zostaje, układ powstaje z seeda)', () => v2(v1(), null)],
    ['v2: układ z zepsutą siatką', () => v2(v1(), { ...JSON.parse(JSON.stringify(layoutFor(BLOK, 0))), cells: ['floor'] })],
    ['v2: bez układu', () => without(v2(), 'layout')],
  ];
  for (const [name, blob] of repairable) {
    it(`do naprawienia (${name}): bez wyjątku, bez :broken, skończone liczby, gra się toczy`, () => {
      put(blob());
      const s = createSession(BLOK);
      expect(s.loadNotice).toBeNull();
      expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
      expect(s.fromSave).toBe(true);
      expect(s.econ.level).toBeGreaterThan(10);   // postęp zostaje
      expect(Object.keys(s.econ.upgrades).length).toBeGreaterThan(3);
      expect(Number.isFinite(s.econ.cash)).toBe(true);
      expect(Number.isFinite(s.econ.reputation)).toBe(true);
      expectPlayable(s);
    });
  }

  it('NaN zapisany jako null przechodzi cały obieg: zapis → wczytanie → gra', () => {
    const s = createSession(BLOK, true);
    s.econ.cash = Number.NaN;
    s.econ.reputation = Number.NaN;
    s.econ.shelf.napoje = Number.NaN;
    saveSession(s);
    expect((JSON.parse(storage.getItem(key(BLOK))!) as { econ: { cash: unknown } }).econ.cash).toBeNull();
    const loaded = createSession(BLOK);
    expect(loaded.loadNotice).toBeNull();
    expectPlayable(loaded);
  });

  it('quarantineSave: kopiuje zapis do :broken i zwalnia miejsce; bez zapisu nie ma czego kopiować', () => {
    expect(quarantineSave(BLOK)).toBe(false);
    storage.setItem(key(BLOK), 'x');
    expect(quarantineSave(BLOK)).toBe(true);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBe('x');
    expect(storage.getItem(key(BLOK))).toBeNull();
  });

  it('gdy kopii nie da się zapisać, komunikat nie obiecuje kopii', () => {
    put('{"ucięty');
    storage.failWrites = true;
    const s = createSession(BLOK);
    expect(s.loadNotice).toBe('Zapis sklepu był uszkodzony — zaczynamy od nowa.');
  });
});

describe('zamknięty sklep nie wraca do zapisów (otwarcie kolejnej Traszki)', () => {
  it('retireSession kasuje zapis i blokuje każdy następny zapis tej sesji, także ten z setSeed', () => {
    const old = playedSession(BLOK);
    expect(storage.getItem(key(BLOK))).not.toBeNull();
    retireSession(old);
    expect(storage.getItem(key(BLOK))).toBeNull();
    saveSession(old);   // setSeed woła persist() zamykanego sklepu zaraz po jego wycofaniu
    saveSession(old);
    expect(storage.getItem(key(BLOK))).toBeNull();
    expect(createSession(BLOK).fromSave).toBe(false);
  });

  it('reviveSession (nowy sklep się nie otworzył) przywraca zapis i dalsze zapisy', () => {
    const old = playedSession(BLOK);
    retireSession(old);
    reviveSession(old);
    expect(storage.getItem(key(BLOK))).not.toBeNull();
    expect(createSession(BLOK).econ).toEqual(old.econ);
    play(old, 1);
    saveSession(old);
    expect(createSession(BLOK).econ).toEqual(old.econ);
  });
});

describe('granice wartości z zapisu (LIMITS) nie schodzą poniżej tego, co potrafi gra', () => {
  const seeds = [BLOK, PAWILON, 'bench', 'kiełbasa-12', ...Array.from({ length: 20 }, (_, i) => `granice-${i}`)];
  const infos = seeds.flatMap((seed) => REMONTS.map((r) => computeStoreInfo(layoutFor(seed, r.level))).concat(computeStoreInfo(layoutFor(seed, 0))));

  it('miejsca na palety, sloty sprzętu i zapasy największych sklepów z generatora mieszczą się z zapasem', () => {
    const pallets = Math.max(...infos.map((i) => i.spots.sidewalk.length + i.spots.floor.length + i.spots.backroom.length));
    const equipment = Math.max(...infos.map((i) => i.slots.reduce((n, slot) => n + slot.capacity, 0)));
    const shelf = Math.max(...infos.flatMap((i) => CATS.map((c) => i.shelfCap[c])));
    const backroom = Math.max(...infos.map((i) => i.backroomCap)) * 2.5;   // regały magazynowe na maksymalnym poziomie: +150%
    expect(pallets * 2).toBeLessThanOrEqual(LIMITS.pallets);
    expect(equipment * 4).toBeLessThanOrEqual(LIMITS.equipment);
    expect(Math.max(shelf, backroom) * 4).toBeLessThanOrEqual(LIMITS.stockPerCat);
  });

  it('największe zamówienie: limit kredytu na ostatnim remoncie mieści mniej palet niż granica dostawy', () => {
    const avgPrice = CATS.reduce((n, c) => n + CAT_INFO[c].price * CAT_INFO[c].basket, 0);
    const room = Math.floor((CREDIT_LIMIT * (1 + 0.5 * REMONTS.length)) / (PALLET_ITEMS * avgPrice));
    expect(room).toBeLessThanOrEqual(LIMITS.orderPallets);
    expect(30).toBeLessThanOrEqual(LIMITS.orderPallets);   // zamówienie ręczne
  });

  it('w długiej grze największego sklepu kolejka, dostawy w drodze i palety nie sięgają granic', () => {
    const s = createSession(BLOK, true);
    s.econ.cash = 5e6;
    s.econ.level = 30;
    s.econ.remontLevel = 3;
    s.econ.upgrades.dostawy2 = 1;
    s.econ.order = { auto: false, manual: 30 };
    s.layout = layoutFor(BLOK, 3);
    s.info = computeStoreInfo(s.layout);
    const most = { queue: 0, deliveries: 0, pallets: 0, xp: 0 };
    const events: EconEvent[] = [];
    for (let i = 0; i < 40 * MINUTES_PER_DAY; i++) {
      stepMinute(s.econ, s.info, events);
      most.queue = Math.max(most.queue, s.econ.queue);
      most.deliveries = Math.max(most.deliveries, s.econ.deliveries.length);
      most.pallets = Math.max(most.pallets, s.econ.pallets.length);
    }
    expect(most.deliveries).toBeGreaterThan(0);
    expect(most.pallets).toBeGreaterThan(5);
    expect(most.queue * 4).toBeLessThanOrEqual(LIMITS.queue);
    expect(most.deliveries * 2).toBeLessThanOrEqual(LIMITS.deliveries);
    expect(most.pallets * 2).toBeLessThanOrEqual(LIMITS.pallets);
  });
});

describe('zapis z nowszej wersji gry (schemat wyższy niż obsługiwany)', () => {
  const futureBlob = (schema: unknown): string => JSON.stringify({
    schema, seed: BLOK, gameVersion: '9.9.9', generatorVersion: 99, layout: { zupełnie: 'inny kształt' },
    econ: { nowePole: [1, 2, 3], cash: 'tysiąc' }, tylkoPrzyszłość: true,
  });
  const put = (raw: string): string => { storage.setItem(key(BLOK), raw); return raw; };
  const versions: [string, string][] = [
    ['schema: 3', futureBlob(3)],
    ['schema: 4', futureBlob(4)],
    ['schema: 99', futureBlob(99)],
    ['schema: 2.5', futureBlob(2.5)],
    ['schema: 1e999 (JSON.parse daje Infinity)', '{"schema":1e999,"seed":"kiełbasa-42","econ":{}}'],
  ];

  for (const [name, raw] of versions) {
    it(`${name}: zapis zostaje nietknięty, bez :broken, gra rusza w sklepie tymczasowym z komunikatem`, () => {
      put(raw);
      storage.setItem('traszka:last', 'inny-sklep');
      const s = createSession(BLOK);
      expect(NEWER_SAVE_NOTICE).toBe('Zapis pochodzi z nowszej wersji gry — odśwież stronę');
      expect(s.loadNotice).toBe(NEWER_SAVE_NOTICE);
      expect(s.ephemeral).toBe(true);
      expect(s.fromSave).toBe(false);
      expect(s.seed).toBe(BLOK);
      expect(s.econ.minute).toBe(OPEN_FROM);
      expect(storage.getItem(key(BLOK))).toBe(raw);
      expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
      expectPlayable(s);

      // nic, co tab robi w trakcie gry, nie rusza cudzego zapisu: zapis, zamknięcie w sieci, odświeżenie, wczytanie
      saveSession(s);
      play(s, 2);
      saveSession(s);
      retireSession(s);
      reviveSession(s);
      discardSave(s);
      expect(storage.getItem(key(BLOK))).toBe(raw);
      expect(lastSavedSeed()).toBe('inny-sklep');   // „ostatni sklep” też stoi tam, gdzie stał
      const again = createSession(BLOK);
      expect(again.ephemeral).toBe(true);
      expect(again.loadNotice).toBe(NEWER_SAVE_NOTICE);
      expect(storage.getItem(key(BLOK))).toBe(raw);
    });
  }

  it('zwykły zapis (schemat 2) i nowa gra nie są tymczasowe, a ich komunikaty się nie zmieniły', () => {
    const played = playedSession(BLOK);
    expect(played.ephemeral).toBe(false);
    const loaded = createSession(BLOK);
    expect(loaded.ephemeral).toBe(false);
    expect(loaded.loadNotice).toBeNull();
    expect(createSession(PAWILON).ephemeral).toBe(false);
    storage.setItem(key(PAWILON), '{"ucięty');
    const broken = createSession(PAWILON);
    expect(broken.ephemeral).toBe(false);
    expect(broken.loadNotice).toBe(BROKEN_SAVE_NOTICE);
  });

  it('discardSave („zacznij od nowa”) kasuje zapis zwykłego sklepu, ale nie ruszy zapisu pod sklepem tymczasowym', () => {
    const normal = playedSession(BLOK);
    discardSave(normal);
    expect(storage.getItem(key(BLOK))).toBeNull();
    const raw = put(futureBlob(3));
    discardSave(createSession(BLOK));
    expect(storage.getItem(key(BLOK))).toBe(raw);
  });

  it('po „zacznij od nowa” w sklepie tymczasowym świeża gra też jest tymczasowa (createSession z fresh nie zna cudzego zapisu)', () => {
    const raw = put(futureBlob(3));
    const first = createSession(BLOK);
    const restarted = createSession(BLOK, true, undefined, { ephemeral: first.ephemeral });
    expect(restarted.ephemeral).toBe(true);
    expect(restarted.fromSave).toBe(false);
    saveSession(restarted);
    expect(storage.getItem(key(BLOK))).toBe(raw);
  });
});
