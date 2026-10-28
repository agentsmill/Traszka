import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { createEconomy, stepMinute, type EconEvent } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { MemoryStorage } from './memoryStorage';
import {
  addToNetwork, claimDaily, loadMeta, partnerOf, pendingDaily, prestigePoints, saveMeta, startupWindow, welcomeOffer, type Meta,
} from './meta';
import { createSession, retireSession, saveSession } from './session';

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => vi.unstubAllGlobals());

const META_KEY = 'traszka:meta';
const fresh = (): Meta => loadMeta();
/** Sklep po długiej grze: tyle marży, że zamknięcie daje kilka punktów. */
const richStore = (seed: string): ReturnType<typeof createEconomy> => {
  const s = createEconomy(seed, computeStoreInfo(generateStore(seed)));
  s.total.margin = 400_000;
  s.bestDayProfit = 9000;
  s.level = 21;
  return s;
};

describe('sieć sklepów', () => {
  it('zamknięcie sklepu dopisuje go do sieci i daje punkty', () => {
    const s = richStore('stary-sklep');
    const meta = addToNetwork(fresh(), s);
    expect(meta.network).toHaveLength(1);
    expect(meta.network[0]).toMatchObject({ seed: 'stary-sklep', level: 21 });
    expect(meta.partnerPoints).toBe(prestigePoints(s));
    expect(meta.partnerPoints).toBeGreaterThan(1);
  });

  it('ten sam sklep zamknięty drugi raz nie daje ani punktów, ani drugiego wpisu', () => {
    const s = richStore('stary-sklep');
    const once = addToNetwork(fresh(), s);
    const twice = addToNetwork(once, s);
    expect(twice.network).toHaveLength(1);
    expect(twice.partnerPoints).toBe(once.partnerPoints);
    expect(partnerOf(twice)).toEqual(partnerOf(once));
    const other = addToNetwork(twice, richStore('drugi-sklep'));
    expect(other.network.map((n) => n.seed)).toEqual(['stary-sklep', 'drugi-sklep']);
  });

  it('nie zmienia przekazanej mety (zwraca nową)', () => {
    const before = fresh();
    addToNetwork(before, richStore('stary-sklep'));
    expect(before.network).toHaveLength(0);
    expect(before.partnerPoints).toBe(0);
  });

  it('otwarcie kolejnej Traszki (ta sama kolejność co w grze): zamknięty sklep nie wraca do zapisów i nie da się go zamknąć drugi raz', () => {
    const old = createSession('stary-sklep', true);
    old.econ.total.margin = 400_000;
    old.econ.bestDayProfit = 9000;
    saveSession(old);

    let meta = fresh();
    meta = addToNetwork(meta, old.econ);
    retireSession(old);
    const next = createSession('nowy-sklep', true, partnerOf(meta));
    saveSession(old);        // setSeed zapisuje „bieżący” sklep, zanim przełączy świat
    saveSession(next);
    saveMeta(meta);

    expect(storage.getItem('traszka:save:stary-sklep')).toBeNull();
    expect(storage.getItem('traszka:save:nowy-sklep')).not.toBeNull();
    expect(next.econ.partner.points).toBe(meta.partnerPoints);
    expect(loadMeta().network.map((n) => n.seed)).toEqual(['stary-sklep']);

    // gracz wpisuje stary seed: zaczyna czystą grę i nawet jeśli dojdzie do końca, sieć się nie powiększy
    const again = createSession('stary-sklep', false, partnerOf(meta));
    expect(again.fromSave).toBe(false);
    again.econ.total.margin = 900_000;
    const afterSecond = addToNetwork(meta, again.econ);
    expect(afterSecond.network).toHaveLength(1);
    expect(afterSecond.partnerPoints).toBe(meta.partnerPoints);
  });
});

describe('seria dni', () => {
  const day1 = new Date(2026, 9, 28, 12, 0);
  const day2 = new Date(2026, 9, 29, 8, 30);
  const day4 = new Date(2026, 9, 31, 9, 0);

  it('sama zapowiedź nagrody niczego nie zmienia: seria przesuwa się dopiero po odebraniu', () => {
    const meta = fresh();
    expect(pendingDaily(meta, day1)).toBe(1);
    expect(pendingDaily(meta, day1)).toBe(1);   // odświeżenie strony przed „Odbierz!” nie zjada nagrody
    expect(meta.daily).toEqual({ date: '', streak: 0 });
    saveMeta(meta);
    expect(pendingDaily(loadMeta(), day1)).toBe(1);
  });

  it('odebrana seria liczy się raz dziennie, rośnie dzień po dniu i zeruje się po przerwie', () => {
    const meta = fresh();
    claimDaily(meta, 1, day1);
    expect(pendingDaily(meta, day1)).toBeNull();
    expect(pendingDaily(meta, day2)).toBe(2);
    claimDaily(meta, 2, day2);
    expect(meta.daily).toEqual({ date: '2026-10-29', streak: 2 });
    expect(pendingDaily(meta, day4)).toBe(1);   // 30. października nie było
  });

  it('oferta powitalna: zarobek z nieobecności i premia dzienna, a po odebraniu dnia tylko zarobek', () => {
    const s = richStore('sklep');
    s.lastDayProfit = 8000;
    const meta = fresh();
    meta.lastSeen = day1.getTime() - 3 * 3_600_000;
    const offer = welcomeOffer(meta, s, day1)!;
    expect(offer.offline).toBe(Math.round(8000 * 0.25 * 3));
    expect(offer.streak).toBe(1);
    expect(offer.daily).toEqual({ cash: 300 + 50 * 21, ogonki: 2 });
    expect(welcomeOffer(meta, s, day1)).toEqual(offer);   // to samo po odświeżeniu
    claimDaily(meta, offer.streak!, day1);
    const later = welcomeOffer(meta, s, day1)!;
    expect(later.daily).toBeNull();
    expect(later.streak).toBeNull();
    expect(later.offline).toBe(offer.offline);
  });

  it('bez zarobku i bez premii nie ma okna powitalnego', () => {
    const s = richStore('sklep');
    const meta = fresh();
    claimDaily(meta, 1, day1);
    meta.lastSeen = day1.getTime();
    expect(welcomeOffer(meta, s, day1)).toBeNull();
  });
});

describe('meta z uszkodzonego zapisu', () => {
  const load = (blob: unknown): Meta => {
    storage.setItem(META_KEY, typeof blob === 'string' ? blob : JSON.stringify(blob));
    return loadMeta();
  };
  const ok = (m: Meta): void => {
    expect(() => partnerOf(m)).not.toThrow();
    const p = partnerOf(m);
    expect(Number.isFinite(p.points) && Number.isFinite(p.networkIncome) && Number.isFinite(p.stores)).toBe(true);
    expect(() => pendingDaily(m, new Date(2026, 9, 28))).not.toThrow();
    expect(Array.isArray(m.network)).toBe(true);
  };

  it('zły typ pola nie wywraca startu (wcześniej partnerOf rzucał na network: null)', () => {
    const base = { version: 1, partnerPoints: 4, network: [{ seed: 'a', income: 300, level: 12, margin: 90_000 }], daily: { date: '2026-10-27', streak: 3 }, lastSeen: 5, sound: false, vibration: false };
    for (const patch of [
      { network: null }, { network: 'x' }, { daily: null }, { daily: { date: 4, streak: 'x' } }, { partnerPoints: 'dużo' },
      { partnerPoints: null }, { lastSeen: null }, { sound: 'tak' }, { network: [null, 3, { seed: 'b' }, { seed: 'c', income: null, level: 1, margin: 1 }] },
    ]) ok(load({ ...base, ...patch }));
  });

  it('nie-JSON, zła wersja i nie-obiekty dają metę domyślną', () => {
    for (const blob of ['{"ucięty', 'null', '[]', '7', '"x"', { version: 0 }, { version: '1' }, { version: -1 }, {}]) {
      const m = load(blob);
      ok(m);
      expect(m).toEqual({ version: 1, partnerPoints: 0, network: [], daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true });
    }
  });

  it('poprawna meta wraca bez zmian, a dobre wpisy sieci zostają obok zepsutych', () => {
    const good: Meta = { version: 1, partnerPoints: 4, network: [{ seed: 'a', income: 300, level: 12, margin: 90_000 }], daily: { date: '2026-10-27', streak: 3 }, lastSeen: 12345, sound: false, vibration: true };
    expect(load(good)).toEqual(good);
    expect(load({ ...good, network: [...good.network, { seed: 'b', income: null }] }).network).toEqual(good.network);
  });
});

describe('meta ze skrajnymi liczbami', () => {
  const load = (blob: unknown): Meta => {
    storage.setItem(META_KEY, JSON.stringify(blob));
    return loadMeta();
  };
  const entry = (seed: string, income: number, level: number, margin: number) => ({ seed, income, level, margin });

  it('punkty, dochód sieci, poziom, seria i czas wyjścia mają granice (nic nie przechodzi w nieskończoność)', () => {
    const m = load({
      version: 1, partnerPoints: 1e308, daily: { date: '2026-10-27', streak: 1e308 }, lastSeen: 1e308, sound: true, vibration: true,
      network: [entry('a', 1e308, 1e308, 1e308), entry('b', 1e308, 7, 5), entry('c', -1e308, -3, -9)],
    });
    expect(m.partnerPoints).toBe(1e7);
    expect(m.daily.streak).toBeLessThanOrEqual(366_000);
    expect(m.lastSeen).toBeLessThanOrEqual(8.64e15);
    expect(m.network.map((n) => n.income)).toEqual([1e12, 1e12, 0]);
    expect(m.network.map((n) => n.level)).toEqual([1000, 7, 1]);
    expect(m.network.map((n) => n.margin)).toEqual([1e12, 5, 0]);
    const p = partnerOf(m);
    expect(Number.isFinite(p.networkIncome)).toBe(true);
    expect(p.networkIncome).toBeLessThanOrEqual(3e12);
  });

  it('sieć ma najwyżej tysiąc sklepów', () => {
    const m = load({ version: 1, partnerPoints: 1, network: Array.from({ length: 5000 }, (_, i) => entry(`s${i}`, 1, 1, 1)), daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true });
    expect(m.network).toHaveLength(1000);
  });

  it('nowy sklep z taką premią gra się normalnie: trzy dni bez NaN', () => {
    const m = load({
      version: 1, partnerPoints: 1e308, lastSeen: 0, daily: { date: '', streak: 0 }, sound: true, vibration: true,
      network: [entry('a', 1e308, 1, 1), entry('b', 1e308, 1, 1)],
    });
    const s = createSession('sklep-z-siecia', true, partnerOf(m));
    const events: EconEvent[] = [];
    for (let i = 0; i < 3 * MINUTES_PER_DAY; i++) stepMinute(s.econ, s.info, events);
    for (const v of [s.econ.cash, s.econ.reputation, s.econ.queue, s.econ.total.margin, s.econ.xp]) expect(Number.isFinite(v)).toBe(true);
  });

  it('poprawna meta z dużymi, ale prawdopodobnymi liczbami wraca bez zmian', () => {
    const good: Meta = {
      version: 1, partnerPoints: 5000, network: [entry('a', 90_000, 60, 5e9)], daily: { date: '2026-10-27', streak: 400 },
      lastSeen: Date.UTC(2026, 9, 27), sound: true, vibration: false,
    };
    expect(load(good)).toEqual(good);
  });
});

describe('meta z nowszej wersji gry', () => {
  const GOOD = { version: 1, partnerPoints: 4, network: [{ seed: 'a', income: 300, level: 12, margin: 90_000 }], daily: { date: '2026-10-27', streak: 3 }, lastSeen: 5, sound: false, vibration: true };
  const put = (blob: unknown): string => {
    const raw = typeof blob === 'string' ? blob : JSON.stringify(blob);
    storage.setItem(META_KEY, raw);
    return raw;
  };
  const newer: [string, unknown][] = [
    ['version: 2', { ...GOOD, version: 2, sieć: { nowy: 'kształt' } }],
    ['version: 9', { version: 9 }],
    ['schema: 2 (znacznik w stylu koperty zapisu)', { ...GOOD, schema: 2 }],
    ['schema: 7, version: 1', { ...GOOD, schema: 7 }],
    ['version: 1.5', { ...GOOD, version: 1.5 }],
  ];

  for (const [name, blob] of newer) {
    it(`${name}: meta zostaje nietknięta, gra dostaje wartości domyślne i nie zapisze niczego pod tym kluczem`, () => {
      const raw = put(blob);
      const meta = loadMeta();
      expect(meta.readOnly).toBe(true);
      expect(meta).toMatchObject({ version: 1, partnerPoints: 0, network: [], sound: true, vibration: true });
      expect(() => partnerOf(meta)).not.toThrow();
      saveMeta(meta);
      saveMeta({ ...meta, sound: false });            // przełącznik dźwięku w tej karcie
      saveMeta(addToNetwork(meta, richStore('x')));   // kopia mety niesie znacznik dalej
      expect(addToNetwork(meta, richStore('x')).readOnly).toBe(true);
      expect(storage.getItem(META_KEY)).toBe(raw);
    });
  }

  it('meta uszkodzona (zła wersja, nie-obiekt) nie jest „z przyszłości”: zostaje do nadpisania jak dotąd', () => {
    for (const blob of ['{"ucięty', 'null', { version: 0 }, { version: '2' }, {}]) {
      put(blob);
      const meta = loadMeta();
      expect(meta.readOnly).toBeUndefined();
      saveMeta({ ...meta, partnerPoints: 3 });
      expect(JSON.parse(storage.getItem(META_KEY)!)).toMatchObject({ partnerPoints: 3 });
    }
  });

  it('zwykła meta nie ma znacznika w ogóle, więc zapis i odczyt wyglądają jak dotąd', () => {
    put(GOOD);
    const meta = loadMeta();
    expect('readOnly' in meta).toBe(false);
    saveMeta(meta);
    expect(JSON.parse(storage.getItem(META_KEY)!)).toEqual(GOOD);
  });
});

describe('okno po otwarciu sklepu (startupWindow)', () => {
  const now = new Date(2026, 9, 28, 12, 0);
  const plainMeta = (): Meta => loadMeta();
  const played = (): ReturnType<typeof richStore> => {
    const s = richStore('sklep');
    s.minute = 8 * 60 + 1440 * 3;
    s.total.customers = 800;
    s.lastDayProfit = 8000;
    return s;
  };

  it('nowa gra pokazuje ekran powitalny i niczego nie odbiera', () => {
    const fresh = createEconomy('nowy', computeStoreInfo(generateStore('nowy')));
    expect(startupWindow(plainMeta(), fresh, false, now)).toEqual({ intro: true, welcome: null });
  });

  it('istniejąca gra: okno „Witaj z powrotem” z zarobkiem i premią dzienną', () => {
    const meta = plainMeta();
    meta.lastSeen = now.getTime() - 3 * 3_600_000;
    const w = startupWindow(meta, played(), false, now);
    expect(w.intro).toBe(false);
    expect(w.welcome).toEqual(welcomeOffer(meta, played(), now));
    expect(w.welcome!.offline).toBeGreaterThan(0);
  });

  it('po końcu gry, w sklepie tymczasowym i przy mecie z nowszej wersji nie ma ani ekranu powitalnego, ani premii', () => {
    const none = { intro: false, welcome: null };
    const meta = plainMeta();
    meta.lastSeen = now.getTime() - 3 * 3_600_000;
    const over = played();
    over.gameOver = true;
    expect(startupWindow(meta, over, false, now)).toEqual(none);
    expect(startupWindow(meta, played(), true, now)).toEqual(none);
    expect(startupWindow({ ...meta, readOnly: true }, played(), false, now)).toEqual(none);
    const fresh = createEconomy('nowy', computeStoreInfo(generateStore('nowy')));
    expect(startupWindow(meta, fresh, true, now)).toEqual(none);   // awaryjny świat nie jest pierwszą grą gracza
  });
});
