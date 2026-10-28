import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { buyUpgrade, stepMinute, type EconEvent } from '@/sim/economy/economy';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { MemoryStorage } from './memoryStorage';
import { openStore, type OpenRequest } from './openStore';
import {
  BROKEN_SAVE_NOTICE, NEWER_SAVE_NOTICE, UNBUILDABLE_SAVE_NOTICE, createSession, lastSavedSeed, saveSession, type GameSession,
} from './session';
import { openRequestFor, submitStart } from './start';

/**
 * Otwieranie sklepu przy starcie: `build` to budowa świata w scenie (w grze main.ts `load`), tu zastąpiona funkcją, która
 * wywraca się na zawołanie. Zapis w pamięci jest prawdziwy. Zasada, której pilnują testy: dobry zapis (przeszedł
 * walidację) nigdy nie ginie z powodu świata, który się nie zbudował.
 */
const faults = vi.hoisted(() => ({ generatorThrowsFor: new Set<string>() }));
vi.mock('@/sim/store/generateStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/sim/store/generateStore')>();
  return {
    ...actual,
    generateStore: (seed: string, ...rest: Parameters<typeof actual.generateStore> extends [string, ...infer R] ? R : never) => {
      if (faults.generatorThrowsFor.has(seed)) throw new Error(`generateStore: brak układu dla ${seed}`);
      return actual.generateStore(seed, ...rest);
    },
  };
});

const BLOK = 'kiełbasa-42';
const key = (seed: string): string => `traszka:save:${seed}`;
const unableToOpen = (seed: string): string => `Nie udało się otworzyć sklepu „${seed}”. Zaczynamy w nowym.`;

let storage: MemoryStorage;
let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  faults.generatorThrowsFor.clear();
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Zagrany sklep zapisany w kopercie v2; zwraca surowy zapis. */
function savedGame(seed = BLOK): string {
  const s = createSession(seed, true);
  s.econ.cash = 250_000;
  s.econ.level = 11;
  buyUpgrade(s.econ, 'ulotki');
  const events: EconEvent[] = [];
  for (let i = 0; i < 4 * MINUTES_PER_DAY; i++) stepMinute(s.econ, s.info, events);
  saveSession(s);
  return storage.getItem(key(seed))!;
}

/** Ten sam zapis, ale zapisany układ ma oznaczenie, po którym `failFor` go rozpozna. */
function markLayout(raw: string, seed = BLOK): string {
  const blob = JSON.parse(raw) as { layout: { generatorVersion: number } };
  blob.layout.generatorVersion = 777;
  const marked = JSON.stringify(blob);
  storage.setItem(key(seed), marked);
  return marked;
}

/** `build`, który zapamiętuje sesje i rzuca dla tych, które wskazuje `failFor`. */
function builder(failFor: (s: GameSession) => boolean = () => false): { build: OpenRequest['build']; built: GameSession[] } {
  const built: GameSession[] = [];
  return { built, build: (s) => { built.push(s); if (failFor(s)) throw new Error(`render: ${s.seed}`); } };
}

let nextRandom = 0;
const open = (build: OpenRequest['build'], over: Partial<OpenRequest> = {}): GameSession => {
  nextRandom = 0;
  return openStore({ seed: BLOK, fresh: false, randomSeed: () => `losowy-${++nextRandom}`, build, ...over });
};

describe('openStore: świat się buduje', () => {
  it('zapis wczytany z przeglądarki, jedna próba budowy, bez komunikatu', () => {
    savedGame();
    const { build, built } = builder();
    const s = open(build, { partner: { points: 2, networkIncome: 300, stores: 1 } });
    expect(built).toEqual([s]);
    expect(s.fromSave).toBe(true);
    expect(s.ephemeral).toBe(false);
    expect(s.loadNotice).toBeNull();
    expect(s.econ.cash).toBeGreaterThan(200_000);
    expect(s.econ.partner).toEqual({ points: 2, networkIncome: 300, stores: 1 });
  });

  it('nowa gra (bez zapisu i z fresh)', () => {
    const { build, built } = builder();
    const s = open(build);
    expect(built).toEqual([s]);
    expect(s.fromSave).toBe(false);
    expect(s.econ.minute).toBe(OPEN_FROM);
    savedGame();
    expect(open(builder().build, { fresh: true }).fromSave).toBe(false);
  });
});

describe('openStore: dobry zapis, którego świat się nie zbudował (nigdy do :broken)', () => {
  it('zapisany układ się nie buduje, układ z seeda tak: ta sama gra z całym postępem, bez komunikatu i kopii', () => {
    const marked = markLayout(savedGame());
    const saved = JSON.parse(marked) as { econ: { cash: number; level: number } };
    const { build, built } = builder((s) => s.layout.generatorVersion === 777);
    const s = open(build);
    expect(built).toHaveLength(2);
    expect(built[1]).toBe(s);
    expect(s.fromSave).toBe(true);
    expect(s.ephemeral).toBe(false);
    expect(s.loadNotice).toBeNull();
    expect(s.layout.generatorVersion).toBe(GENERATOR_VERSION);
    expect(s.econ.cash).toBe(saved.econ.cash);
    expect(s.econ.level).toBe(saved.econ.level);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
    // zapis (robi go persist() po otwarciu) zastępuje układ, który się nie budował
    expect(storage.getItem(key(BLOK))).toBe(marked);
    saveSession(s);
    expect((JSON.parse(storage.getItem(key(BLOK))!) as { layout: { generatorVersion: number } }).layout.generatorVersion).toBe(GENERATOR_VERSION);
  });

  it('nic z tego zapisu się nie buduje: sklep tymczasowy tego seeda z komunikatem, zapis bajt w bajt na miejscu', () => {
    const raw = savedGame();
    const { build, built } = builder((s) => s.fromSave);
    const s = open(build);
    expect(built).toHaveLength(3);   // zapisany układ, układ z seeda, sklep tymczasowy
    expect(s).toBe(built[2]);
    expect(s.seed).toBe(BLOK);
    expect(s.ephemeral).toBe(true);
    expect(s.fromSave).toBe(false);
    expect(s.loadNotice).toBe(UNBUILDABLE_SAVE_NOTICE);
    expect(s.econ.minute).toBe(OPEN_FROM);
    expect(storage.getItem(key(BLOK))).toBe(raw);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
    saveSession(s);   // persist() po otwarciu
    expect(storage.getItem(key(BLOK))).toBe(raw);
    expect(lastSavedSeed()).toBe(BLOK);
    expect(errorLog).toHaveBeenCalled();
  });

  it('zapis v1 też zostaje dokładnie taki, jaki był (migracja do v2 czeka na pierwszy zapis po zbudowaniu świata)', () => {
    const v1 = JSON.stringify({ ...(JSON.parse(savedGame()) as { econ: object }).econ });
    storage.setItem(key(BLOK), v1);
    const s = open(builder((x) => x.fromSave).build);
    expect(s.ephemeral).toBe(true);
    saveSession(s);
    expect(storage.getItem(key(BLOK))).toBe(v1);
  });

  it('nawet sklep tymczasowy tego seeda się nie buduje: sklep o losowym seedzie, też tymczasowy, adres i „ostatni sklep” nie wędrują', () => {
    const raw = savedGame();
    const { build, built } = builder((s) => s.seed === BLOK);
    const s = open(build);
    expect(built.map((x) => x.seed)).toEqual([BLOK, BLOK, BLOK, 'losowy-1']);
    expect(s.seed).toBe('losowy-1');
    expect(s.ephemeral).toBe(true);
    expect(s.loadNotice).toBe(UNBUILDABLE_SAVE_NOTICE);
    saveSession(s);
    expect(storage.getItem(key(BLOK))).toBe(raw);
    expect(storage.getItem(key('losowy-1'))).toBeNull();
    expect(lastSavedSeed()).toBe(BLOK);
  });

  it('nic się nie buduje: wyjątek idzie dalej (po sześciu próbach), a zapis dalej leży na swoim miejscu', () => {
    const raw = savedGame();
    const { build, built } = builder(() => true);
    expect(() => open(build)).toThrow('render');
    expect(built).toHaveLength(6);   // zapis, układ z seeda, sklep tymczasowy i trzy losowe
    expect(storage.getItem(key(BLOK))).toBe(raw);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
  });

  it('generator nie daje sklepu dla seeda z dobrym zapisem (v1 nie niesie układu): losowy sklep jako tymczasowy, zapis nietknięty', () => {
    const raw = JSON.stringify((JSON.parse(savedGame()) as { econ: object }).econ);
    storage.setItem(key(BLOK), raw);
    faults.generatorThrowsFor.add(BLOK);
    const { build, built } = builder();
    const s = open(build);
    expect(built).toEqual([s]);
    expect(s.seed).toBe('losowy-1');
    expect(s.ephemeral).toBe(true);
    expect(s.loadNotice).toBe(UNBUILDABLE_SAVE_NOTICE);
    expect(storage.getItem(key(BLOK))).toBe(raw);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
  });
});

describe('openStore: zapis z nowszej wersji gry', () => {
  const newer = JSON.stringify({ schema: 5, seed: BLOK, econ: { przyszłość: true } });

  it('sklep tymczasowy z komunikatem, zapis nietknięty', () => {
    storage.setItem(key(BLOK), newer);
    const s = open(builder().build);
    expect(s.ephemeral).toBe(true);
    expect(s.loadNotice).toBe(NEWER_SAVE_NOTICE);
    saveSession(s);
    expect(storage.getItem(key(BLOK))).toBe(newer);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
  });

  it('gdyby i ten sklep się nie zbudował: losowy seed, nadal tymczasowy, z tym samym komunikatem', () => {
    storage.setItem(key(BLOK), newer);
    const s = open(builder((x) => x.seed === BLOK).build);
    expect(s.seed).toBe('losowy-1');
    expect(s.ephemeral).toBe(true);
    expect(s.loadNotice).toBe(NEWER_SAVE_NOTICE);
    expect(storage.getItem(key(BLOK))).toBe(newer);
  });
});

describe('openStore: do kopii (:broken) idzie tylko to, co nie przeszło parsowania ani walidacji', () => {
  it('uszkodzony zapis: kopia, komunikat, nowa gra (zachowanie z poprzedniej rundy)', () => {
    storage.setItem(key(BLOK), '{"ucięty');
    const { build, built } = builder();
    const s = open(build);
    expect(built).toEqual([s]);
    expect(s.fromSave).toBe(false);
    expect(s.ephemeral).toBe(false);
    expect(s.loadNotice).toBe(BROKEN_SAVE_NOTICE);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBe('{"ucięty');
    expect(storage.getItem(key(BLOK))).toBeNull();
  });

  it('zapis, który nie przeszedł walidacji (lista tam, gdzie ma być obiekt), też', () => {
    const bad = JSON.stringify({ ...(JSON.parse(savedGame()) as { econ: object }).econ, pallets: null });
    storage.setItem(key(BLOK), bad);
    const s = open(builder().build);
    expect(s.loadNotice).toBe(BROKEN_SAVE_NOTICE);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBe(bad);
  });
});

describe('openStore: nowa gra, której nie da się zbudować (zapisu do ochrony nie ma)', () => {
  it('seed, z którego świat nie wstaje: losowy sklep, zwykły (zapisywany), z komunikatem', () => {
    const { build, built } = builder((s) => s.seed === BLOK);
    const s = open(build);
    expect(built.map((x) => x.seed)).toEqual([BLOK, 'losowy-1']);
    expect(s.seed).toBe('losowy-1');
    expect(s.ephemeral).toBe(false);
    expect(s.loadNotice).toBe(unableToOpen(BLOK));
    saveSession(s);
    expect(storage.getItem(key('losowy-1'))).not.toBeNull();
    expect(storage.getItem(key(BLOK))).toBeNull();
  });

  it('generator nie daje sklepu dla seeda bez zapisu: to samo', () => {
    faults.generatorThrowsFor.add(BLOK);
    const s = open(builder().build);
    expect(s.seed).toBe('losowy-1');
    expect(s.ephemeral).toBe(false);
    expect(s.loadNotice).toBe(unableToOpen(BLOK));
  });

  it('komunikat o uszkodzonym zapisie nie ginie, gdy seed i tak się nie zbuduje', () => {
    storage.setItem(key(BLOK), '{"ucięty');
    const s = open(builder((x) => x.seed === BLOK).build);
    expect(s.loadNotice).toBe(`${BROKEN_SAVE_NOTICE} ${unableToOpen(BLOK)}`);
  });

  it('nowa gra na życzenie (fresh) nie rusza dobrego zapisu, nawet gdy jej świat się nie zbuduje', () => {
    const raw = savedGame();
    const s = open(builder((x) => x.seed === BLOK).build, { fresh: true });
    expect(s.seed).toBe('losowy-1');
    expect(storage.getItem(key(BLOK))).toBe(raw);
  });
});

describe('openStore: sklep zastępczy nigdy nie siada na cudzym zapisie', () => {
  it('wylosowany seed ma zapis: losuje jeszcze raz, a zapis leży bajt w bajt także po zapisie nowej gry', () => {
    const other = savedGame('losowy-1');   // pierwsze losowanie trafia w cudzą grę
    const { build, built } = builder((s) => s.seed === BLOK);
    const s = open(build, { fresh: true });
    expect(built.map((x) => x.seed)).toEqual([BLOK, 'losowy-2']);
    expect(s.seed).toBe('losowy-2');
    expect(s.ephemeral).toBe(false);
    saveSession(s);   // persist() po otwarciu
    expect(storage.getItem(key('losowy-1'))).toBe(other);
    expect(storage.getItem(key('losowy-2'))).not.toBeNull();
  });

  it('generator nie daje sklepu dla seeda bez zapisu: zastępczy też omija seedy z zapisem', () => {
    const other = savedGame('losowy-1');
    faults.generatorThrowsFor.add(BLOK);
    const s = open(builder().build);
    expect(s.seed).toBe('losowy-2');
    saveSession(s);
    expect(storage.getItem(key('losowy-1'))).toBe(other);
  });

  it('każda kolejna próba losuje od nowa spośród wolnych: nieudany zastępczy nie zostawia losowania na zapisie', () => {
    const other = savedGame('losowy-1');
    const { build, built } = builder((s) => s.seed === BLOK || s.seed === 'losowy-2');
    const s = open(build, { fresh: true });
    expect(built.map((x) => x.seed)).toEqual([BLOK, 'losowy-2', 'losowy-3']);
    expect(s.seed).toBe('losowy-3');
    saveSession(s);
    expect(storage.getItem(key('losowy-1'))).toBe(other);
  });

  it('sklep tymczasowy (zapis z nowszej wersji gry, jego seed się nie buduje) też losuje spośród seedów bez zapisu', () => {
    storage.setItem(key(BLOK), JSON.stringify({ schema: 5, seed: BLOK, econ: { przyszłość: true } }));
    const other = savedGame('losowy-1');
    const s = open(builder((x) => x.seed === BLOK).build);
    expect(s.seed).toBe('losowy-2');
    expect(s.ephemeral).toBe(true);
    expect(storage.getItem(key('losowy-1'))).toBe(other);
  });
});

describe('openStore: sklep wybrany na ekranie startowego ("Nowy sklep") nigdy nie nadpisuje zapisu spod tego seeda', () => {
  const newer = JSON.stringify({ schema: 5, seed: 'nowy-9', econ: { przyszłość: true } });
  const form = (seed: string) => ({ nick: 'Ala', seed, look: { outfit: 'men-suit' as const, appearanceSeed: 'kasjer-a' }, specialOutfits: true });
  /** To samo złożenie, które robi gra: wybór z ekranu → prośba bez `fresh` → `openStore`. */
  const openChosen = (seed: string, build: OpenRequest['build']): GameSession => {
    const result = submitStart(form(seed));
    if (!result.ok) throw new Error('nick jest poprawny');
    nextRandom = 0;
    return openStore(openRequestFor(result.choice, { randomSeed: () => `losowy-${++nextRandom}`, build }));
  };

  it('zapis z nowszej wersji gry pod wpisanym seedem: sklep tymczasowy z komunikatem, zapis bajt w bajt, bez kopii', () => {
    storage.setItem(key('nowy-9'), newer);
    const { build, built } = builder();
    const s = openChosen('Nowy-9', build);
    expect(built).toEqual([s]);
    expect(s.seed).toBe('nowy-9');
    expect(s.ephemeral).toBe(true);
    expect(s.loadNotice).toBe(NEWER_SAVE_NOTICE);
    saveSession(s);   // persist() po otwarciu
    expect(storage.getItem(key('nowy-9'))).toBe(newer);
    expect(storage.getItem(`${key('nowy-9')}:broken`)).toBeNull();
  });

  it('zapis, którego świata nie dało się zbudować: sklep zastępczy (tymczasowy) bez zapisywania, zapis nietknięty', () => {
    const raw = savedGame('nowy-9');
    const { build, built } = builder((x) => x.seed === 'nowy-9');
    const s = openChosen('NOWY-9', build);
    expect(built.map((x) => x.seed)).toEqual(['nowy-9', 'nowy-9', 'nowy-9', 'losowy-1']);   // zapis, układ z seeda, tymczasowy tego seeda, zastępczy
    expect(s.seed).toBe('losowy-1');
    expect(s.ephemeral).toBe(true);
    expect(s.loadNotice).toBe(UNBUILDABLE_SAVE_NOTICE);
    saveSession(s);
    expect(storage.getItem(key('nowy-9'))).toBe(raw);
    expect(storage.getItem(key('losowy-1'))).toBeNull();
    expect(storage.getItem(`${key('nowy-9')}:broken`)).toBeNull();
  });

  it('generator nie składa układu dla seeda z dobrym zapisem (v1 nie niesie układu): zapis zostaje, gracz dostaje zastępczy sklep tymczasowy', () => {
    const raw = JSON.stringify((JSON.parse(savedGame('nowy-9')) as { econ: object }).econ);
    storage.setItem(key('nowy-9'), raw);
    faults.generatorThrowsFor.add('nowy-9');
    const s = openChosen('nowy-9', builder().build);
    expect(s.ephemeral).toBe(true);
    expect(s.loadNotice).toBe(UNBUILDABLE_SAVE_NOTICE);
    expect(s.seed).not.toBe('nowy-9');
    saveSession(s);
    expect(storage.getItem(key('nowy-9'))).toBe(raw);
  });

  it('seed bez zapisu: zwykła nowa gra pod wpisanym seedem (zapisywana), cudze zapisy nietknięte', () => {
    const other = savedGame('cudzy-3');
    const s = openChosen('Mój Sklep', builder().build);
    expect(s.seed).toBe('mój sklep');
    expect(s.ephemeral).toBe(false);
    expect(s.fromSave).toBe(false);
    saveSession(s);
    expect(storage.getItem(key('mój sklep'))).not.toBeNull();
    expect(storage.getItem(key('cudzy-3'))).toBe(other);
  });
});
