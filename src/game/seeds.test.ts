import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRng } from '@/sim/rng';
import { generateStore } from '@/sim/store/generateStore';
import { MemoryStorage } from './memoryStorage';
import {
  EXISTING_STORE_NOTICE, NEIGHBOUR_STORE_NOTICE, SEED_MAX, chooseStore, entrySeed, freeSeed, normalizeSeed, resolveStore,
} from './seeds';
import { randomSeed } from './seedWords';
import { BROKEN_SAVE_NOTICE, NEWER_SAVE_NOTICE, createSession, hasStoredSave, saveSession } from './session';

/** Losowanie, które oddaje kolejne seedy z listy (po ostatnim ciągle ostatni) i liczy wywołania. */
function draws(seeds: string[]): { draw: () => string; count: () => number } {
  let calls = 0;
  return { draw: () => seeds[Math.min(calls++, seeds.length - 1)]!, count: () => calls };
}

describe('freeSeed: seed bez zapisu pod spodem (nowy sklep nie może nadpisać cudzej gry)', () => {
  it('pierwsze losowanie wolne: jedno losowanie, jedno pytanie o zajętość', () => {
    const { draw, count } = draws(['bigos-101', 'kawa-200']);
    const asked: string[] = [];
    expect(freeSeed(draw, (s) => { asked.push(s); return false; })).toBe('bigos-101');
    expect(count()).toBe(1);
    expect(asked).toEqual(['bigos-101']);
  });

  it('zajęte losowania są odrzucane, pierwsze wolne wygrywa i dalej się nie losuje', () => {
    const { draw, count } = draws(['bigos-101', 'kawa-200', 'chleb-300', 'sernik-400', 'babka-500']);
    const taken = new Set(['bigos-101', 'kawa-200', 'chleb-300']);
    expect(freeSeed(draw, (s) => taken.has(s))).toBe('sernik-400');
    expect(count()).toBe(4);
  });

  it('dwudzieste losowanie jeszcze się liczy: wolne, to bez numeru', () => {
    const list = Array.from({ length: 20 }, (_, i) => `seed-${i + 1}`);
    const { draw, count } = draws(list);
    expect(freeSeed(draw, (s) => s !== 'seed-20')).toBe('seed-20');
    expect(count()).toBe(20);
  });

  it('dwadzieścia zajętych losowań: do ostatniego z nich dopisuje ·2, ·3… aż trafi na wolny seed, a losuje dokładnie 20 razy', () => {
    const list = Array.from({ length: 25 }, (_, i) => `seed-${i + 1}`);   // 21. i dalsze nie mogą się pojawić
    const { draw, count } = draws(list);
    const taken = new Set([...list, 'seed-20·2', 'seed-20·3']);
    expect(freeSeed(draw, (s) => taken.has(s))).toBe('seed-20·4');
    expect(count()).toBe(20);
  });

  it('dwadzieścia zajętych losowań i wolne ·2: numeracja zaczyna się od 2', () => {
    const { draw } = draws(['pierogi-100']);
    expect(freeSeed(draw, (s) => s === 'pierogi-100')).toBe('pierogi-100·2');
  });

  it('wszystko zajęte (magazyn, który tak twierdzi, kłamie): wynik jest, strona się nie zawiesza', () => {
    const { draw, count } = draws(['x-100']);
    const result = freeSeed(draw, () => true);
    expect(result).toMatch(/^x-100·\d+$/);
    expect(count()).toBe(20);
  });
});

describe('freeSeed z prawdziwym losowaniem i zapisami w przeglądarce (to samo złożenie, które woła main.ts)', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** `randomSeed` z podstawionym źródłem liczb: 0,0 daje „pierogi-100”, 1,1 daje „bigos-101”, 2,2 daje „zurek-102”. */
  const drawFrom = (numbers: number[]): (() => string) => {
    let i = 0;
    return () => randomSeed(() => numbers[i++ % numbers.length]!);
  };

  it('omija seed, pod którym leży zapis (poprawny, uszkodzony albo z nowszej wersji gry)', () => {
    storage.setItem('traszka:save:pierogi-100', '{"schema":2}');
    storage.setItem('traszka:save:bigos-101', '{"ucięty');
    storage.setItem('traszka:save:zurek-102', '{"schema":9}');
    expect(freeSeed(drawFrom([0, 0, 1, 1, 2, 2, 3, 3]), hasStoredSave)).toBe('kielbasa-103');
  });

  it('seed bez zapisu zostaje', () => {
    storage.setItem('traszka:save:bigos-101', '{"schema":2}');
    expect(freeSeed(drawFrom([0, 0, 1, 1]), hasStoredSave)).toBe('pierogi-100');
  });
});

// --- Seed wpisany przez gracza ---------------------------------------------------------------------------------------

/** Szuka pojedynczego niesparowanego surogatu (tekst, który `JSON`/adres zamieniłyby na znak zastępczy). */
const hasLoneSurrogate = (s: string): boolean => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
const codePoints = (s: string): number => Array.from(s).length;

describe('normalizeSeed: przycięcie, małe litery, zwinięte spacje, najwyżej 40 znaków, pusty to losowy', () => {
  const draw = (): string => 'losowy-777';

  it('przycina brzegi, zwija spacje (także tabulatory i nowe wiersze) i zamienia litery na małe', () => {
    expect(normalizeSeed('  Moja   PIZZA  ', draw)).toBe('moja pizza');
    expect(normalizeSeed('Ala\tma\nkota', draw)).toBe('ala ma kota');
    expect(normalizeSeed('ŻÓŁĆ Gęślą', draw)).toBe('żółć gęślą');
  });

  it('seed z gry (słowo-liczba) zostaje bez zmian', () => {
    expect(normalizeSeed('kielbasa-42', draw)).toBe('kielbasa-42');
    expect(normalizeSeed('pierogi-731', draw)).toBe('pierogi-731');
  });

  it('emoji zostają (są częścią tekstu), w tym złożone', () => {
    expect(normalizeSeed('🍕 Pizza 🍕', draw)).toBe('🍕 pizza 🍕');
    expect(normalizeSeed('👨‍👩‍👧', draw)).toBe('👨‍👩‍👧');
  });

  it('dwieście znaków daje dokładnie 40', () => {
    const long = normalizeSeed('Ab'.repeat(100), draw);
    expect(codePoints(long)).toBe(SEED_MAX);
    expect(long).toBe('ab'.repeat(20));
    expect(SEED_MAX).toBe(40);
  });

  it('dwieście emoji daje 40 znaków i poprawny tekst (bez pojedynczego surogatu na końcu)', () => {
    const long = normalizeSeed('🍕'.repeat(200), draw);
    expect(codePoints(long)).toBe(40);
    expect(hasLoneSurrogate(long)).toBe(false);
    expect(long).toBe('🍕'.repeat(40));
  });

  it('obcięcie w miejscu spacji nie zostawia spacji na końcu', () => {
    expect(normalizeSeed(`${'a'.repeat(39)} bbbb`, draw)).toBe('a'.repeat(39));
    expect(normalizeSeed(`${'a'.repeat(39)}      `, draw)).toBe('a'.repeat(39));
  });

  it('pusty tekst, same spacje i same znaki sterujące dają losowy seed z podanego losowania', () => {
    expect(normalizeSeed('', draw)).toBe('losowy-777');
    expect(normalizeSeed('   \t\n ', draw)).toBe('losowy-777');
    expect(normalizeSeed('\u0000\u0007\u001f', draw)).toBe('losowy-777');
  });

  it('domyślne losowanie to randomSeed: słowo-liczba', () => {
    for (let i = 0; i < 20; i++) expect(normalizeSeed('')).toMatch(/^[a-z]+-[1-9]\d{2}$/);
  });

  it('znaki sterujące znikają z tekstu, a litery z akcentem składają się (NFC), więc ten sam napis to ten sam seed', () => {
    expect(normalizeSeed('ab\u0000c', draw)).toBe('abc');
    expect(normalizeSeed('zȧ́', draw)).toBe(normalizeSeed('zȧ́', draw));
    expect(normalizeSeed('ą', draw)).toBe('ą');       // „a” + ogonek = „ą”
    expect(normalizeSeed('ą', draw)).toBe(normalizeSeed('ą', draw));
  });

  it('idempotentny: ponowna normalizacja niczego nie zmienia (także dla dziwnych tekstów)', () => {
    const rng = createRng('normalizeSeed-idempotent');
    const alphabet = ['a', 'B', ' ', '\t', 'Ż', '🍕', '\u0000', '-', '9', '́', ' ', 'ß', 'İ'];
    const samples = ['', '  ', 'Ala ma kota', '🍕'.repeat(60), 'x'.repeat(200), ...Array.from({ length: 200 }, () =>
      Array.from({ length: rng.int(0, 90) }, () => rng.pick(alphabet)).join(''))];
    for (const raw of samples) {
      const once = normalizeSeed(raw, draw);
      expect(normalizeSeed(once, draw), JSON.stringify(raw)).toBe(once);
      expect(hasLoneSurrogate(once)).toBe(false);
      expect(codePoints(once)).toBeLessThanOrEqual(SEED_MAX);
      expect(once.length).toBeGreaterThan(0);
    }
  });
});

describe('entrySeed: od jakiego seeda zaczyna się wejście na stronę', () => {
  it('adres (?seed=) wygrywa, potem ostatnio grany sklep, potem losowy', () => {
    const draw = (): string => 'losowy-1';
    expect(entrySeed('z-adresu', 'ostatni-5', draw)).toBe('z-adresu');
    expect(entrySeed(null, 'ostatni-5', draw)).toBe('ostatni-5');
    expect(entrySeed(null, null, draw)).toBe('losowy-1');
  });

  it('pusty ?seed= nie liczy się jako seed', () => {
    expect(entrySeed('', 'ostatni-5', () => 'x')).toBe('ostatni-5');
    expect(entrySeed('', null, () => 'losowy-2')).toBe('losowy-2');
  });

  it('losowanie ruszy tylko wtedy, gdy trzeba', () => {
    const draw = vi.fn(() => 'x-100');
    entrySeed('a', null, draw);
    entrySeed(null, 'b', draw);
    expect(draw).not.toHaveBeenCalled();
  });
});

/** Zapisów w przeglądarce nie ma (testy bez magazynu nie sięgają do prawdziwego `localStorage`). */
const noSaves = (): boolean => false;

describe('resolveStore: lokal, który się nie mieści, zamienia się na sąsiedni (deterministycznie)', () => {
  /** `build`, które rzuca dla wskazanych seedów i zapisuje, co było próbowane. */
  const builder = (broken: string[]): { build: (s: string) => unknown; tried: string[] } => {
    const tried: string[] = [];
    return { tried, build: (s) => { tried.push(s); if (broken.includes(s)) throw new Error(`generateStore: brak układu dla ${s}`); return {}; } };
  };

  it('generator składa sklep: ten sam seed, bez komunikatu, jedna próba', () => {
    const { build, tried } = builder([]);
    expect(resolveStore('pierogi-731', { build })).toEqual({ seed: 'pierogi-731', notice: null });
    expect(tried).toEqual(['pierogi-731']);
  });

  it('wymuszona porażka generatora: próbuje seed·1 i zwraca go z komunikatem o sąsiednim lokalu', () => {
    const { build, tried } = builder(['bigos-1']);
    expect(resolveStore('bigos-1', { build })).toEqual({ seed: 'bigos-1·1', notice: NEIGHBOUR_STORE_NOTICE });
    expect(tried).toEqual(['bigos-1', 'bigos-1·1']);
    expect(NEIGHBOUR_STORE_NOTICE).toBe('Ten lokal się nie zmieścił, otwieramy sąsiedni');
  });

  it('kolejne sąsiednie też mogą nie wstać: seed·1 … seed·5 po kolei, bierze pierwszy, który wstaje', () => {
    const { build, tried } = builder(['x', 'x·1', 'x·2', 'x·3', 'x·4']);
    expect(resolveStore('x', { build })).toEqual({ seed: 'x·5', notice: NEIGHBOUR_STORE_NOTICE });
    expect(tried).toEqual(['x', 'x·1', 'x·2', 'x·3', 'x·4', 'x·5']);
  });

  it('ten sam wynik za każdym razem (żadnej losowości przy sąsiednich)', () => {
    const run = (): unknown => resolveStore('x', { build: builder(['x', 'x·1']).build });
    expect(run()).toEqual(run());
    expect(run()).toEqual({ seed: 'x·2', notice: NEIGHBOUR_STORE_NOTICE });
  });

  it('żaden z sześciu nie wstaje: losowy seed bez zapisu pod spodem, a próbowanych jest dokładnie sześć', () => {
    const broken = ['x', 'x·1', 'x·2', 'x·3', 'x·4', 'x·5'];
    const { build, tried } = builder(broken);
    const taken = new Set(['losowy-1']);
    let n = 0;
    const result = resolveStore('x', { build, draw: () => `losowy-${++n}`, hasSave: (s) => taken.has(s) });
    expect(result).toEqual({ seed: 'losowy-2', notice: NEIGHBOUR_STORE_NOTICE });
    expect(tried).toEqual(broken);
  });

  it('prawdziwy generator: zwykłe seedy z gry zostają bez zmian i bez komunikatu', () => {
    for (const seed of ['kielbasa-42', 'pierogi-731', 'traszka-1', 'bigos-100']) expect(resolveStore(seed, { hasSave: noSaves })).toEqual({ seed, notice: null });
  });

  it('prawdziwy generator: dziwne teksty zawsze dają sklep, który się składa (żadnego wyjątku)', () => {
    const weird = ['', ' ', '🍕', '🍕'.repeat(40), 'x'.repeat(40), 'Ala ma kota', 'a\u0000b', '́', 'ß', '0', '-', '·', 'x·1', 'seed:with:colons'];
    for (const text of weird) {
      const { seed } = resolveStore(normalizeSeed(text), { hasSave: noSaves });
      expect(() => generateStore(seed), JSON.stringify(text)).not.toThrow();
    }
  });
});

describe('chooseStore: seed z ekranu startowego (wpisany tekst → sklep, który się otwiera)', () => {
  /** Zapisy i generator w atrapie: `saves` to seedy z zapisem, `broken` to seedy, z których generator nie składa sklepu. */
  const deps = (saves: string[] = [], broken: string[] = [], draws: string[] = ['losowy-1', 'losowy-2', 'losowy-3']) => {
    let n = 0;
    const built: string[] = [];
    return {
      built,
      deps: {
        hasSave: (s: string) => saves.includes(s),
        build: (s: string) => { built.push(s); if (broken.includes(s)) throw new Error('brak układu'); },
        draw: () => draws[Math.min(n++, draws.length - 1)]!,
      },
    };
  };

  it('seed bez zapisu: znormalizowany, bez komunikatu', () => {
    expect(chooseStore('  Moja   Pizza ', deps().deps)).toEqual({ seed: 'moja pizza', notice: null });
  });

  it('pod seedem leży zapis: wczytujemy ten sklep, z komunikatem, i nic nie nadpisujemy', () => {
    expect(chooseStore('kielbasa-42', deps(['kielbasa-42']).deps)).toEqual({ seed: 'kielbasa-42', notice: EXISTING_STORE_NOTICE });
    expect(EXISTING_STORE_NOTICE).toBe('Wczytujemy Twój sklep spod tego seeda');
  });

  it('zapis leży pod znormalizowanym seedem, choć gracz wpisał go inaczej (wielkie litery, spacje)', () => {
    expect(chooseStore('  KIELBASA-42  ', deps(['kielbasa-42']).deps)).toEqual({ seed: 'kielbasa-42', notice: EXISTING_STORE_NOTICE });
  });

  it('stary sklep z wielkimi literami (zapis sprzed normalizacji) otwiera się pod swoim seedem, a nie jako nowy', () => {
    expect(chooseStore(' Bigos-12 ', deps(['Bigos-12']).deps)).toEqual({ seed: 'Bigos-12', notice: EXISTING_STORE_NOTICE });
    // dosłowny wpis ma pierwszeństwo; mała litera to już inny seed
    expect(chooseStore('Bigos-12', deps(['Bigos-12', 'bigos-12']).deps).seed).toBe('Bigos-12');
    expect(chooseStore('bigos-12', deps(['Bigos-12', 'bigos-12']).deps).seed).toBe('bigos-12');
    expect(chooseStore('bigos-12', deps(['Bigos-12']).deps)).toEqual({ seed: 'bigos-12', notice: null });
  });

  it('seed z zapisem nie pyta generatora: zapis wygrywa, nawet gdy generator by go nie złożył', () => {
    const { built, deps: d } = deps(['bigos-1'], ['bigos-1']);
    expect(chooseStore('bigos-1', d)).toEqual({ seed: 'bigos-1', notice: EXISTING_STORE_NOTICE });
    expect(built).toEqual([]);
  });

  it('generator nie składa sklepu: sąsiedni lokal z komunikatem; przy następnym wejściu wraca ten sam lokal, także ze swoim zapisem', () => {
    expect(chooseStore('bigos-1', deps([], ['bigos-1']).deps)).toEqual({ seed: 'bigos-1·1', notice: NEIGHBOUR_STORE_NOTICE });
    // sąsiedni lokal ma już zapis z poprzedniego razu: wybór ten sam (a openStore wczyta zapis, nie nadpisze go)
    expect(chooseStore('bigos-1', deps(['bigos-1·1'], ['bigos-1']).deps)).toEqual({ seed: 'bigos-1·1', notice: NEIGHBOUR_STORE_NOTICE });
  });

  it('pusty seed: losowy, z pominięciem seedów, pod którymi leży zapis, bez komunikatu', () => {
    expect(chooseStore('', deps(['losowy-1']).deps)).toEqual({ seed: 'losowy-2', notice: null });
    expect(chooseStore('   ', deps().deps)).toEqual({ seed: 'losowy-1', notice: null });
  });

  it('dziwne teksty (spacje, emoji, 200 znaków, sterujące) zawsze dają seed, z którego da się zagrać', () => {
    const weird = ['', '   ', '🍕'.repeat(200), 'x'.repeat(200), '\u0000\u0001', 'A B  C', '·', '😀 ' + 'ż'.repeat(100)];
    for (const text of weird) {
      const choice = chooseStore(text, { hasSave: noSaves });
      expect(codePoints(choice.seed), JSON.stringify(text)).toBeLessThanOrEqual(SEED_MAX + 2);   // + ·n przy sąsiednim lokalu
      expect(hasLoneSurrogate(choice.seed)).toBe(false);
      expect(() => generateStore(choice.seed)).not.toThrow();
    }
  });
});

describe('chooseStore z prawdziwymi zapisami w przeglądarce: seed z ekranu nigdy nie nadpisuje cudzej gry', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());
  const key = (seed: string): string => `traszka:save:${seed}`;

  it('zapis z gry: ten sam sklep, ten sam postęp, a następny zapis go nie kasuje', () => {
    const played = createSession('kielbasa-42', true);
    played.econ.cash = 123_456;
    saveSession(played);
    const choice = chooseStore('  Kielbasa-42 ');
    expect(choice).toEqual({ seed: 'kielbasa-42', notice: EXISTING_STORE_NOTICE });
    const opened = createSession(choice.seed, false);   // tak otwiera sklep main.ts (setSeed i openStore): nigdy `fresh`
    expect(opened.fromSave).toBe(true);
    expect(opened.econ.cash).toBe(123_456);
    saveSession(opened);
    expect(createSession('kielbasa-42', false).econ.cash).toBe(123_456);
  });

  it('zapis z nowszej wersji gry: sklep tymczasowy z komunikatem, a zapis zostaje bajt w bajt', () => {
    const newer = JSON.stringify({ schema: 9, seed: 'nowy-9', econ: { przyszłość: true } });
    storage.setItem(key('nowy-9'), newer);
    const choice = chooseStore('Nowy-9');
    expect(choice.seed).toBe('nowy-9');
    const opened = createSession(choice.seed, false);
    expect(opened.ephemeral).toBe(true);
    expect(opened.loadNotice).toBe(NEWER_SAVE_NOTICE);
    saveSession(opened);
    expect(storage.getItem(key('nowy-9'))).toBe(newer);
    expect(storage.getItem(`${key('nowy-9')}:broken`)).toBeNull();
  });

  it('uszkodzony zapis nie ginie bez śladu: idzie do kopii, a sklep zaczyna się od nowa z komunikatem', () => {
    storage.setItem(key('zepsuty-1'), '{"ucięty');
    const choice = chooseStore('zepsuty-1');
    expect(choice).toEqual({ seed: 'zepsuty-1', notice: EXISTING_STORE_NOTICE });
    const opened = createSession(choice.seed, false);
    expect(opened.fromSave).toBe(false);
    expect(opened.loadNotice).toBe(BROKEN_SAVE_NOTICE);
    expect(storage.getItem(`${key('zepsuty-1')}:broken`)).toBe('{"ucięty');
  });

  it('seed bez zapisu: nowa gra, a cudze zapisy leżą nietknięte', () => {
    const other = createSession('cudzy-7', true);
    saveSession(other);
    const raw = storage.getItem(key('cudzy-7'));
    const choice = chooseStore('Nowy sklep');
    expect(choice).toEqual({ seed: 'nowy sklep', notice: null });
    saveSession(createSession(choice.seed, false));
    expect(storage.getItem(key('cudzy-7'))).toBe(raw);
    expect(storage.getItem(key('nowy sklep'))).not.toBeNull();
  });
});
