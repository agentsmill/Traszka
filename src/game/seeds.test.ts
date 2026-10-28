import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRng } from '@/sim/rng';
import { generateStore } from '@/sim/store/generateStore';
import { MemoryStorage } from './memoryStorage';
import {
  EXISTING_STORE_NOTICE, NEIGHBOUR_STORE_NOTICE, SEED_MAX, chooseStore, clipSeedInput, entrySeed, freeSeed, normalizeSeed, resolveStore,
} from './seeds';
import { randomSeed } from './seedWords';
import { BROKEN_SAVE_NOTICE, NEWER_SAVE_NOTICE, createSession, hasStoredSave, lastSavedSeed, saveSession } from './session';

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

  it('znaki sterujące znikają z tekstu', () => {
    expect(normalizeSeed('ab\u0000c', draw)).toBe('abc');
    expect(normalizeSeed('a\u0007b\u001fc\u007fd', draw)).toBe('abcd');
  });

  it('litery z akcentem składają się (NFC), więc ten sam napis w dwóch zapisach to ten sam seed', () => {
    // rozłożone („a” + kropka nad + ostry) po lewej, złożone („ȧ” U+0227 + ostry) po prawej: w teście nie ma żadnego NFC
    expect(normalizeSeed('za\u0307\u0301', draw)).toBe('z\u0227\u0301');
    expect(normalizeSeed('a\u0328', draw)).toBe('\u0105');                  // „a” + ogonek = „ą” (U+0105)
    expect(normalizeSeed('A\u0328', draw)).toBe('\u0105');                  // wielka litera po małej też składa się
    expect(normalizeSeed('e\u0301', draw)).toBe('\u00e9');                  // „é”
  });

  it('znaki łączące w innej kolejności to ten sam napis po NFC (porządek kanoniczny), więc ten sam seed', () => {
    const lowerFirst = normalizeSeed('a\u0323\u0307', draw);   // kropka pod, potem kropka nad
    const upperFirst = normalizeSeed('a\u0307\u0323', draw);   // kropka nad, potem kropka pod: NFC ustawia je tak samo
    expect(upperFirst).toBe(lowerFirst);
    expect(lowerFirst).toBe('\u1ea1\u0307');
  });

  it('idempotentny: ponowna normalizacja niczego nie zmienia (także dla dziwnych tekstów, niewidocznych znaków i spójników emoji)', () => {
    const rng = createRng('normalizeSeed-idempotent');
    const alphabet = ['a', 'B', ' ', '\t', 'Ż', '🍕', '\u0000', '-', '9', '\u0301', '\u00a0', 'ß', 'İ', '\u200b', '\u200d', '\u202e', '\ufeff', '👩', '💻', '\ufe0f', '🏽'];
    const cuts = ['a'.repeat(38) + '👩\u200d💻', 'a'.repeat(39) + '👩\u200d💻', 'a'.repeat(39) + '\u200d', 'a'.repeat(40) + '\u200d💻', '👩\u200d'.repeat(30)];
    const samples = ['', '  ', 'Ala ma kota', '🍕'.repeat(60), 'x'.repeat(200), ...cuts, ...Array.from({ length: 300 }, () =>
      Array.from({ length: rng.int(0, 90) }, () => rng.pick(alphabet)).join(''))];
    for (const raw of samples) {
      const once = normalizeSeed(raw, draw);
      expect(normalizeSeed(once, draw), JSON.stringify(raw)).toBe(once);
      expect(hasLoneSurrogate(once)).toBe(false);
      expect(codePoints(once)).toBeLessThanOrEqual(SEED_MAX);
      expect(once.length).toBeGreaterThan(0);
      expect(once.startsWith('\u200d') || once.endsWith('\u200d'), `spójnik na brzegu: ${JSON.stringify(raw)}`).toBe(false);
      expect(/[\u200b\u200c\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(once), `niewidoczny znak: ${JSON.stringify(raw)}`).toBe(false);
    }
  });
});

/** Znaki, które nic nie rysują: spacje zerowej szerokości, łączniki, BOM i sterowanie kierunkiem tekstu (seed trafia do rankingu). */
const INVISIBLE = [
  ['U+200B spacja zerowej szerokości', '\u200b'], ['U+200C łącznik zerowej szerokości (ZWNJ)', '\u200c'], ['U+200D spójnik zerowej szerokości (ZWJ)', '\u200d'],
  ['U+2060 łącznik słów', '\u2060'], ['U+FEFF BOM', '\ufeff'],
  ['U+200E znak lewo-prawo', '\u200e'], ['U+200F znak prawo-lewo', '\u200f'],
  ['U+202A LRE', '\u202a'], ['U+202B RLE', '\u202b'], ['U+202C PDF', '\u202c'], ['U+202D LRO', '\u202d'], ['U+202E RLO (nadpisanie kierunku)', '\u202e'],
  ['U+2066 LRI', '\u2066'], ['U+2067 RLI', '\u2067'], ['U+2068 FSI', '\u2068'], ['U+2069 PDI', '\u2069'],
] as const;

describe('normalizeSeed: znaki niewidoczne (zerowej szerokości i sterujące kierunkiem tekstu) nie trafiają do seeda', () => {
  const draw = (): string => 'losowy-777';

  it.each(INVISIBLE)('%s znika z tekstu: w środku, na brzegach i obok spacji', (_name, c) => {
    expect(normalizeSeed(`ab${c}cd`, draw)).toBe('abcd');
    expect(normalizeSeed(`${c}ab${c}`, draw)).toBe('ab');
    expect(normalizeSeed(`a ${c} b`, draw)).toBe('a b');            // spacja, niewidoczny, spacja: jedna spacja
    expect(normalizeSeed(`ab${c}${c}${c}cd`, draw)).toBe('abcd');
  });

  it.each(INVISIBLE)('seed złożony wyłącznie z %s to seed losowy, a nie niewidzialny', (_name, c) => {
    expect(normalizeSeed(c, draw)).toBe('losowy-777');
    expect(normalizeSeed(c.repeat(40), draw)).toBe('losowy-777');
    expect(normalizeSeed(` ${c} `, draw)).toBe('losowy-777');
  });

  it('nadpisanie kierunku tekstu nie trafia do seeda (do adresu i pola w ⚙): wynik to czysty tekst', () => {
    const seed = normalizeSeed('\u202ekcab\u202c-1', draw);
    expect(seed).toBe('kcab-1');
    expect(/[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(seed)).toBe(false);
  });

  it('spójnik ZWJ zostaje tylko tam, gdzie skleja emoji (rodzina, zawód), a luzem, między literami albo na brzegu znika', () => {
    expect(normalizeSeed('👨\u200d👩\u200d👧', draw)).toBe('👨\u200d👩\u200d👧');         // rodzina to jedno emoji
    expect(normalizeSeed('👩\u200d💻', draw)).toBe('👩\u200d💻');                        // programistka
    expect(normalizeSeed('👩🏽\u200d💻', draw)).toBe('👩🏽\u200d💻');                      // z odcieniem skóry
    expect(normalizeSeed('❤\ufe0f\u200d🔥', draw)).toBe('❤\ufe0f\u200d🔥');            // z selektorem wariantu przed spójnikiem
    expect(normalizeSeed('a\u200d👩', draw)).toBe('a👩');                               // litera, ZWJ, emoji: nic nie skleja
    expect(normalizeSeed('👩\u200da', draw)).toBe('👩a');
    expect(normalizeSeed('👩\u200d', draw)).toBe('👩');
    expect(normalizeSeed('\u200d👩', draw)).toBe('👩');
    expect(normalizeSeed('👩\u200d\u200d💻', draw)).toBe('👩💻');                         // dwa spójniki z rzędu nie skleją niczego
  });

  it('inne znaki formatujące, których gra nie wymienia, zostają (np. selektor wariantu emoji)', () => {
    expect(normalizeSeed('❤\ufe0f', draw)).toBe('❤\ufe0f');
  });

  it('niewidoczne znaki nie zmieniają tego, czy to ten sam seed: z nimi i bez nich wychodzi ten sam tekst', () => {
    expect(normalizeSeed('\u200bMoja\u200c PIZZA\u202e', draw)).toBe(normalizeSeed('Moja PIZZA', draw));
  });
});

describe('clipSeedInput: limit pola seeda liczy punkty kodowe (emoji to jeden znak), a nie jednostki UTF-16', () => {
  it('tekst do 40 punktów kodowych przechodzi bez zmian, także ze spacjami, wielkimi literami i niewidocznymi znakami (to nie normalizacja)', () => {
    for (const text of ['', 'Ala', '  Moja   PIZZA ', 'a'.repeat(40), '🍕'.repeat(40), `a\u200b${'b'.repeat(38)}`]) expect(clipSeedInput(text)).toBe(text);
  });

  it('40 emoji (80 jednostek UTF-16) mieści się w całości, a 41. i dalsze są obcinane (maxLength=40 ucinałoby po 20 emoji)', () => {
    expect(clipSeedInput('🍕'.repeat(40))).toBe('🍕'.repeat(40));
    expect(clipSeedInput('🍕'.repeat(41))).toBe('🍕'.repeat(40));
    expect(clipSeedInput('🍕'.repeat(200))).toBe('🍕'.repeat(40));
    expect(clipSeedInput('🍕'.repeat(40)).length).toBe(80);
  });

  it('zwykły tekst obcina się na 40 znakach, a obcięcie nigdy nie dzieli emoji na pojedynczy surogat', () => {
    expect(clipSeedInput('x'.repeat(200))).toBe('x'.repeat(40));
    expect(clipSeedInput(`${'x'.repeat(39)}🍕🍕`)).toBe(`${'x'.repeat(39)}🍕`);
    for (let n = 0; n < 90; n++) {
      const clipped = clipSeedInput(`${'a'.repeat(n)}${'😀'.repeat(60)}`);
      expect(hasLoneSurrogate(clipped), String(n)).toBe(false);
      expect(codePoints(clipped)).toBeLessThanOrEqual(SEED_MAX);
    }
  });

  it('limit pola i limit normalizacji to ta sama liczba: po przycięciu normalizacja niczego już nie ucina (dla tekstu bez spacji)', () => {
    const typed = clipSeedInput('ż'.repeat(200));
    expect(normalizeSeed(typed)).toBe(typed);
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

  it('nowy sklep powstaje z tego samego tekstu, który daje normalizeSeed (jedna reguła): żaden nieznormalizowany wpis nie trafia do sklepu', () => {
    const rng = createRng('chooseStore-vs-normalizeSeed');
    const alphabet = ['a', 'B', ' ', '\t', 'Ż', '🍕', '\u0000', '-', '9', '\u0301', 'ß', 'İ', '\u200b', '\u200d', '\u202e', '\ufeff', '\u2060'];
    const samples = ['  Moja   PIZZA ', '\u200bpizza\u200b', '\u202ekcab', 'a\u200db', ...Array.from({ length: 150 }, () =>
      Array.from({ length: rng.int(1, 60) }, () => rng.pick(alphabet)).join(''))];
    for (const raw of samples) {
      const fixed = normalizeSeed(raw, () => 'losowy-x');
      if (fixed === 'losowy-x') continue;                                                     // pusty po czyszczeniu: losowy, sprawdza go test niżej
      expect(chooseStore(raw, deps().deps).seed, JSON.stringify(raw)).toBe(fixed);
    }
  });

  it('wpis złożony z samych niewidocznych znaków to losowy wolny seed (jak pusty), a nie niewidzialny sklep', () => {
    for (const text of ['\u200b', '\u200b'.repeat(40), ' \u202e ', '\ufeff\u2060']) {
      expect(chooseStore(text, deps(['losowy-1']).deps), JSON.stringify(text)).toEqual({ seed: 'losowy-2', notice: null });
    }
  });

  it('niewidoczne znaki we wpisie nie zmieniają sklepu: zapis pod czystym seedem wczytuje się', () => {
    expect(chooseStore('kielbasa\u200b-42\u202e', deps(['kielbasa-42']).deps)).toEqual({ seed: 'kielbasa-42', notice: EXISTING_STORE_NOTICE });
  });

  it('stary zapis pod seedem ze spacją na brzegu (ręcznie edytowany ?seed=%20x) też się znajduje, pod tekstem wpisanym dosłownie', () => {
    expect(chooseStore(' bigos-7', { hasSave: (s) => s === ' bigos-7' })).toEqual({ seed: ' bigos-7', notice: EXISTING_STORE_NOTICE });
    expect(chooseStore('bigos-7 ', { hasSave: (s) => s === 'bigos-7 ' })).toEqual({ seed: 'bigos-7 ', notice: EXISTING_STORE_NOTICE });
    expect(chooseStore('  Bigos-7  ', { hasSave: (s) => s === '  Bigos-7  ' })).toEqual({ seed: '  Bigos-7  ', notice: EXISTING_STORE_NOTICE });
  });

  it('kolejność szukania zapisu: tekst dosłownie, potem przycięty, potem znormalizowany', () => {
    const all = ['  Bigos-7  ', 'Bigos-7', 'bigos-7'];
    expect(chooseStore('  Bigos-7  ', { hasSave: (s) => all.includes(s) }).seed).toBe('  Bigos-7  ');
    expect(chooseStore('  Bigos-7  ', { hasSave: (s) => all.slice(1).includes(s) }).seed).toBe('Bigos-7');
    expect(chooseStore('  Bigos-7  ', { hasSave: (s) => s === 'bigos-7' }).seed).toBe('bigos-7');
    expect(chooseStore('  Bigos-7  ', { hasSave: noSaves })).toEqual({ seed: 'bigos-7', notice: null });
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

  it('gracz, którego ostatni zapis leży pod seedem ze spacją na brzegu (stary adres), dostaje ten sam sklep, a nie nowy pusty', () => {
    const played = createSession(' bigos-7', true);
    played.econ.cash = 55_555;
    saveSession(played);
    expect(lastSavedSeed()).toBe(' bigos-7');
    const choice = chooseStore(entrySeed(null, lastSavedSeed()));   // pole ekranu startowego wypełnia ostatni zapis, „Otwieramy sklep!” idzie przez chooseStore
    expect(choice).toEqual({ seed: ' bigos-7', notice: EXISTING_STORE_NOTICE });
    expect(createSession(choice.seed, false).econ.cash).toBe(55_555);
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
