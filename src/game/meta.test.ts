import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { createEconomy, stepMinute, type EconEvent } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { MemoryStorage } from './memoryStorage';
import { DEFAULT_CASHIER_LOOK, isCashierLook } from './cashier';
import {
  addToNetwork, claimDaily, loadMeta, needsStartScreen, partnerOf, pendingDaily, prestigePoints, saveMeta, startupWindow, welcomeOffer,
  type Meta, type Player,
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
    expect(m.network.map((n) => n.income)).toEqual([1e60, 1e60, 0]);
    expect(m.network.map((n) => n.level)).toEqual([1000, 7, 1]);
    expect(m.network.map((n) => n.margin)).toEqual([1e60, 5, 0]);
    const p = partnerOf(m);
    expect(Number.isFinite(p.networkIncome)).toBe(true);
    expect(p.networkIncome).toBeLessThanOrEqual(3e60);
  });

  it('dochód i marża sklepu w sieci z długiej gry (1,5e12 i 1e45) wracają bez zmian po wczytaniu i zapisie', () => {
    for (const v of [1.5e12, 1e45]) {
      const good: Meta = {
        version: 1, partnerPoints: 5000, network: [entry('a', v, 97, v), entry('b', v / 3, 98, v / 7)],
        daily: { date: '2026-10-27', streak: 4 }, lastSeen: Date.UTC(2026, 9, 27), sound: true, vibration: true,
      };
      expect(load(good)).toEqual(good);
      saveMeta(loadMeta());   // pierwszy zapis mety po starcie
      expect(JSON.parse(storage.getItem(META_KEY)!)).toEqual(good);
      expect(partnerOf(loadMeta()).networkIncome).toBe(v + v / 3);
    }
  });

  it('1e61 jest przycięte do granicy 1e60, a suma dochodów całej sieci zostaje skończona', () => {
    const m = load({
      version: 1, partnerPoints: 1, daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true,
      network: Array.from({ length: 1000 }, (_, i) => entry(`s${i}`, 1e61, 5, 1e61)),
    });
    expect(m.network).toHaveLength(1000);
    expect(m.network.every((n) => n.income === 1e60 && n.margin === 1e60)).toBe(true);
    expect(Number.isFinite(partnerOf(m).networkIncome)).toBe(true);
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

describe('gracz w meta: nick i wygląd kasjera (ekran startowy)', () => {
  const BASE = {
    version: 1, partnerPoints: 4, network: [{ seed: 'a', income: 300, level: 12, margin: 90_000 }],
    daily: { date: '2026-10-27', streak: 3 }, lastSeen: 5, sound: false, vibration: true,
  };
  const PLAYER: Player = { nick: 'Mateusz', look: { outfit: 'special-women-witch', appearanceSeed: 'kasjer-abc' }, specialOutfits: false };
  const put = (blob: unknown): Meta => {
    storage.setItem(META_KEY, JSON.stringify(blob));
    return loadMeta();
  };
  const withPlayer = (player: unknown): Meta => put({ ...BASE, player });

  it('świeża meta nie ma gracza, więc pierwsze wejście pokazuje ekran startowy', () => {
    const meta = loadMeta();
    expect('player' in meta).toBe(false);
    expect(needsStartScreen(meta)).toBe(true);
  });

  it('stara meta bez nowych pól (sprzed ekranu startowego) działa jak dotąd: nic nie znika, gracza brak, ekran startowy się pokaże', () => {
    const meta = put(BASE);
    expect(meta).toEqual(BASE);
    expect('player' in meta).toBe(false);
    expect(needsStartScreen(meta)).toBe(true);
    saveMeta(meta);   // pierwszy zapis po starcie niczego nie dopisuje
    expect(JSON.parse(storage.getItem(META_KEY)!)).toEqual(BASE);
  });

  it('zapis i odczyt: nick, wygląd kasjera i przełącznik strojów specjalnych wracają bez zmian, reszta mety zostaje', () => {
    saveMeta({ ...(put(BASE)), player: PLAYER });
    expect(JSON.parse(storage.getItem(META_KEY)!)).toEqual({ ...BASE, player: PLAYER });
    const again = loadMeta();
    expect(again).toEqual({ ...BASE, player: PLAYER });
    expect(needsStartScreen(again)).toBe(false);
  });

  it('gracz ze zwykłym strojem i włączonym przełącznikiem (wartości domyślne ekranu) też wraca bez zmian', () => {
    const player: Player = { nick: 'Ala', look: { ...DEFAULT_CASHIER_LOOK }, specialOutfits: true };
    expect(withPlayer(player).player).toEqual(player);
  });

  it('nick wraca znormalizowany (przycięty, zwinięte spacje, NFKC), a wielkość liter zostaje', () => {
    expect(withPlayer({ ...PLAYER, nick: '  Ala   Ma  ' }).player!.nick).toBe('Ala Ma');
    expect(withPlayer({ ...PLAYER, nick: 'Ｍateusz' }).player!.nick).toBe('Mateusz');
    expect(withPlayer({ ...PLAYER, nick: 'ŁuKasz' }).player!.nick).toBe('ŁuKasz');
  });

  it('uszkodzony nick (pusty, emoji, za długi, zarezerwowany, zły typ) odbiera tylko nick: wygląd i przełącznik zostają, ekran startowy pokaże się jeszcze raz', () => {
    for (const nick of ['', '   ', '🍕', 'x'.repeat(21), 'Centrala', 'ADMIN', 5, null, undefined, [], {}, true]) {
      const meta = withPlayer({ ...PLAYER, nick });
      expect(meta.player, JSON.stringify(nick)).toEqual({ nick: null, look: PLAYER.look, specialOutfits: PLAYER.specialOutfits });
      expect(needsStartScreen(meta), JSON.stringify(nick)).toBe(true);   // bez poprawnego nicka nie ma kogo zapisać, więc ekran pyta o niego
      expect(meta.partnerPoints).toBe(4);   // reszta mety jest cała
    }
  });

  it('każde pole gracza wraca do domyślnego osobno: zły nick, zły wygląd i zły przełącznik naraz dają nick brak, wygląd domyślny i przełącznik włączony', () => {
    const meta = withPlayer({ nick: 'Centrala', look: 'zepsuty', specialOutfits: 'tak' });
    expect(meta.player).toEqual({ nick: null, look: DEFAULT_CASHIER_LOOK, specialOutfits: true });
    expect(needsStartScreen(meta)).toBe(true);
    expect(withPlayer({ nick: 5 }).player).toEqual({ nick: null, look: DEFAULT_CASHIER_LOOK, specialOutfits: true });
    expect(withPlayer({}).player).toEqual({ nick: null, look: DEFAULT_CASHIER_LOOK, specialOutfits: true });
  });

  it('wygląd z mety bez poprawnego nicka jest własną kopią, a po zapisie i odczycie nadal czeka na nick', () => {
    const meta = withPlayer({ ...PLAYER, nick: '🍕' });
    expect(meta.player!.look).not.toBe(PLAYER.look);
    saveMeta(meta);
    const again = loadMeta();
    expect(again.player).toEqual({ nick: null, look: PLAYER.look, specialOutfits: false });
    expect(needsStartScreen(again)).toBe(true);
    saveMeta({ ...again, player: PLAYER });   // gracz wybrał nick na ekranie startowym
    expect(loadMeta().player).toEqual(PLAYER);
    expect(needsStartScreen(loadMeta())).toBe(false);
  });

  it('gracz, który nie jest obiektem, to brak gracza', () => {
    for (const player of ['Mateusz', 5, null, [], true, [PLAYER]]) expect(withPlayer(player).player, JSON.stringify(player)).toBeUndefined();
  });

  it('uszkodzony wygląd kasjera daje wygląd domyślny, a nick zostaje', () => {
    const brokenLooks: unknown[] = [
      null, 'x', 5, [], {}, { outfit: 'nieznany', appearanceSeed: 'a' }, { outfit: 'men-suit' }, { appearanceSeed: 'a' },
      { outfit: 'men-suit', appearanceSeed: '' }, { outfit: 'men-suit', appearanceSeed: 'x'.repeat(65) }, { outfit: 5, appearanceSeed: 'a' },
      { outfit: 'men-suit', appearanceSeed: 5 }, { outfit: '__proto__', appearanceSeed: 'a' },
    ];
    for (const look of brokenLooks) {
      const meta = withPlayer({ ...PLAYER, look });
      expect(meta.player!.nick, JSON.stringify(look)).toBe('Mateusz');
      expect(meta.player!.look, JSON.stringify(look)).toEqual(DEFAULT_CASHIER_LOOK);
      expect(isCashierLook(meta.player!.look)).toBe(true);
    }
  });

  it('brak wyglądu w zapisie to też wygląd domyślny', () => {
    expect(withPlayer({ nick: 'Ala', specialOutfits: true }).player).toEqual({ nick: 'Ala', look: DEFAULT_CASHIER_LOOK, specialOutfits: true });
  });

  it('przełącznik strojów specjalnych, który nie jest wartością logiczną, wraca do domyślnego (włączony)', () => {
    for (const specialOutfits of ['tak', 'false', 0, 1, null, undefined, [], {}]) {
      expect(withPlayer({ ...PLAYER, specialOutfits }).player!.specialOutfits, JSON.stringify(specialOutfits)).toBe(true);
    }
    expect(withPlayer({ ...PLAYER, specialOutfits: false }).player!.specialOutfits).toBe(false);
  });

  it('obce pola w graczu i w wyglądzie odpadają, a wczytany wygląd jest własną kopią, nie wspólnym obiektem domyślnym', () => {
    const meta = withPlayer({ nick: 'Ala', look: { outfit: 'men-suit', appearanceSeed: 'a', hack: 1 }, specialOutfits: true, key: 'xyz' });
    expect(meta.player).toEqual({ nick: 'Ala', look: { outfit: 'men-suit', appearanceSeed: 'a' }, specialOutfits: true });
    const broken = withPlayer({ ...PLAYER, look: null }).player!.look;
    expect(broken).not.toBe(DEFAULT_CASHIER_LOOK);
    expect(Object.isFrozen(broken)).toBe(false);
  });

  it('uszkodzony gracz nie psuje reszty mety: sieć, seria dni i dźwięk wracają jak zawsze', () => {
    const meta = withPlayer('zepsuty');
    expect(meta).toMatchObject({ partnerPoints: 4, sound: false, vibration: true, daily: { date: '2026-10-27', streak: 3 } });
    expect(meta.network).toHaveLength(1);
  });

  it('meta z nowszej wersji gry zostaje nietknięta także wtedy, gdy w tej karcie ktoś wybierze kasjera (zmiana żyje tylko w pamięci)', () => {
    const raw = JSON.stringify({ ...BASE, version: 2, player: { przyszłość: true } });
    storage.setItem(META_KEY, raw);
    const meta = loadMeta();
    expect(meta.readOnly).toBe(true);
    expect(meta.player).toBeUndefined();
    expect(needsStartScreen(meta)).toBe(false);   // nowsza wersja gry już miała swój ekran startowy: tej karcie nie kazać go powtarzać co wejście
    const chosen: Meta = { ...meta, player: PLAYER };   // ⚙ → „Nowy sklep” w tej karcie
    saveMeta(chosen);
    expect(storage.getItem(META_KEY)).toBe(raw);
    expect(chosen.player).toEqual(PLAYER);
  });

  it('needsStartScreen: tak bez gracza, nie z graczem i nie przy mecie tylko do odczytu', () => {
    const none = loadMeta();
    expect(needsStartScreen(none)).toBe(true);
    expect(needsStartScreen({ ...none, player: PLAYER })).toBe(false);
    expect(needsStartScreen({ ...none, player: { ...PLAYER, nick: null } })).toBe(true);   // wygląd jest, nicka brak
    expect(needsStartScreen({ ...none, readOnly: true })).toBe(false);
    expect(needsStartScreen({ ...none, readOnly: true, player: PLAYER })).toBe(false);
  });
});

describe('klucz gracza w meta (ranking, spec §14.7)', () => {
  const BASE = {
    version: 1, partnerPoints: 4, network: [], daily: { date: '2026-10-27', streak: 3 }, lastSeen: 5, sound: false, vibration: true,
  };
  const KEY = 'K7QX9MBD2HFAP3WN8RTE';
  const PLAYER: Player = { nick: 'Mateusz', look: { outfit: 'special-women-witch', appearanceSeed: 'kasjer-abc' }, specialOutfits: false };
  const withPlayer = (player: unknown): Meta => {
    storage.setItem(META_KEY, JSON.stringify({ ...BASE, player }));
    return loadMeta();
  };

  it('zapis i odczyt: klucz wraca bez zmian razem z resztą gracza', () => {
    saveMeta({ ...withPlayer(PLAYER), player: { ...PLAYER, key: KEY } });
    expect(JSON.parse(storage.getItem(META_KEY)!).player).toEqual({ ...PLAYER, key: KEY });
    expect(loadMeta().player).toEqual({ ...PLAYER, key: KEY });
  });

  it('klucz zapisany ręcznie jako kod (małe litery, łączniki) wraca w postaci kanonicznej', () => {
    expect(withPlayer({ ...PLAYER, key: 'k7qx-9mbd-2hfa-p3wn-8rte' }).player).toEqual({ ...PLAYER, key: KEY });
  });

  it('uszkodzony klucz znika sam: nick, kasjer i przełącznik zostają, a reszta mety jest cała', () => {
    for (const key of ['', 'xyz', KEY.slice(1), KEY + 'A', 'U'.repeat(20), 5, null, [], {}, true]) {
      const meta = withPlayer({ ...PLAYER, key });
      expect(meta.player, JSON.stringify(key)).toEqual(PLAYER);
      expect('key' in meta.player!, JSON.stringify(key)).toBe(false);
      expect(needsStartScreen(meta)).toBe(false);
      expect(meta.partnerPoints).toBe(4);
    }
  });

  it('klucz zostaje także przy uszkodzonym nicku (ekran startowy zapyta o nick, a nicki w rankingu dalej należą do gracza)', () => {
    expect(withPlayer({ ...PLAYER, nick: 'Centrala', key: KEY }).player).toEqual({ ...PLAYER, nick: null, key: KEY });
  });
});
