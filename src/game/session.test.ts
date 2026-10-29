import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMonth, isLastDayOfMonth } from '@/sim/economy/calendar';
import { CAT_INFO, CATS, CREDIT_LIMIT, MINUTES_PER_DAY, OPEN_FROM, PALLET_ITEMS } from '@/sim/economy/catalog';
import {
  buyEquipment, buyUpgrade, effects, emptyCounters, kpiMetricsOf, kpiScaleOf, stepMinute, tapPallet, type CommandResult,
  type Counters, type EconEvent, type EconomyState,
} from '@/sim/economy/economy';
import { newKpiWeek } from '@/sim/economy/tycoon/kpi';
import { LIMITS } from '@/sim/economy/sanitize';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { REMONTS } from '@/sim/economy/upgrades';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION, generateStore } from '@/sim/store/generateStore';
import { layoutFor } from '@/sim/store/layoutFor';
import { dispatchCommand, type CommandEffects } from './actions';
import { MemoryStorage } from './memoryStorage';
import {
  BROKEN_SAVE_NOTICE, NEWER_SAVE_NOTICE, SAVE_SCHEMA, UNBUILDABLE_SAVE_NOTICE, createSession, deleteSave, discardSave, hasStoredSave,
  lastSavedSeed, newRunLog, retireSession, reviveSession, saveSession, withLayoutFromSeed, type GameSession, type SaveEnvelope,
} from './session';

/** Efekty poleceń bez skutków: remont w tych testach ma tylko zmienić sesję (stan i układ), bez dźwięku, sceny i zapisu. */
const NO_EFFECTS: CommandEffects = {
  play: () => {}, buzz: () => {}, toast: () => {}, confetti: () => {}, handleEvents: () => {}, persist: () => {}, clearSelection: () => {},
  rebuildScene: () => {}, notice: () => {}, refresh: () => {},
};
/** Remont tak, jak robi to gra: polecenie `startRemont` przez `dispatchCommand`, który po zmianie poziomu podmienia układ i `info` w sesji. */
const remont = (s: GameSession): CommandResult => dispatchCommand(s, { type: 'startRemont' }, NO_EFFECTS);

/**
 * Awarie świata do testów: układ, z którego `computeStoreInfo` się wywraca, i seedy, dla których generator nie daje sklepu.
 * Poza tymi dwoma miejscami moduły są prawdziwe.
 */
const faults = vi.hoisted(() => ({
  infoThrows: null as ((layout: { generatorVersion: number; width: number }) => boolean) | null,
  generatorThrowsFor: new Set<string>(),
}));
vi.mock('@/sim/economy/storeInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/sim/economy/storeInfo')>();
  return {
    ...actual,
    computeStoreInfo: (layout: Parameters<typeof actual.computeStoreInfo>[0]) => {
      if (faults.infoThrows?.(layout)) throw new Error('computeStoreInfo: układ nie do użycia');
      return actual.computeStoreInfo(layout);
    },
  };
});
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
const PAWILON = 'traszka-1';
const key = (seed: string): string => `traszka:save:${seed}`;
const text = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
// Vite wstawia pod Vitest wersję 'test' (vite.config.ts), a nie wersję z package.json.
const gameVersion = 'test';

const effectsBackroomCap = (s: GameSession): number => effects(s.econ, s.info).backroomCap;

/**
 * Zlecenia Centrali zniknęły (zastąpiło je KPI tygodnia w `tycoon.kpi`): zapisy z produkcji (fixtures) mają jeszcze `quests`
 * (z tytułami sprzed L9), `questSeq` i `cleanDays`, a po wczytaniu oczekiwany stan to fixture bez tych pól.
 */
const withoutQuests = (e: EconomyState): EconomyState => {
  const { quests: _q, questSeq: _qs, cleanDays: _cd, ...rest } = e as EconomyState & { quests?: unknown; questSeq?: unknown; cleanDays?: unknown };
  return rest;
};

/** Stan bez tycoona: zapisy z produkcji go nie mają, więc tycoon sprawdzamy osobno (zaufanie ze starego pola `trust`). */
const withoutTycoon = (e: EconomyState): Omit<EconomyState, 'tycoon'> => {
  const { tycoon: _, ...rest } = e;
  return rest;
};
/** Zaufanie z zapisu sprzed tycoona (stare pole `trust`, którego typ `EconomyState` już nie ma). */
const legacyTrust = (e: EconomyState): number => (e as unknown as { trust: number }).trust;

/**
 * Stan, jaki daje wczytanie zapisu z produkcji (fixtures), bez `tycoon`: bez zleceń (`quests`, `questSeq`, `cleanDays`), bez starego pola `trust`
 * (przeszło do `tycoon.trust`), bez starego `priority` (przeszedł do profilu w `tycoon.staff`), z pustą zmianą (`shift`: zapis
 * nie pamięta ostatniej minuty), z zerowymi licznikami `bonus`, `wut` i `fineCount` (także w raporcie, który dostaje `detail: null`), z polami combo,
 * których zapisy sprzed L1 jeszcze nie mają, i bez pól paczki od Centrali (`giftSeq`, `tapBoostUntil`), które przepadają.
 * Migracja: brak serii (`tapStreak` 0) i ostatnie stuknięcie dawno temu (`lastTapAt` -1e9, jak `lastFineAt`).
 */
const asLoaded = (e: EconomyState): Omit<EconomyState, 'tycoon'> => {
  const { trust: _, priority: __, giftSeq: ___, tapBoostUntil: ____, ...rest } = withoutTycoon(withoutQuests(e)) as
    Omit<EconomyState, 'tycoon'> & { trust?: number; priority?: string; giftSeq?: number; tapBoostUntil?: number };
  const counters = (c: Counters): Counters => ({ ...c, bonus: 0, wut: 0, fineCount: 0 });
  return {
    ...rest,
    today: counters(rest.today),
    month: counters(rest.month),
    total: counters(rest.total),
    lastReport: rest.lastReport && { ...rest.lastReport, counters: counters(rest.lastReport.counters), detail: null },
    shift: { staff: 0, human: { kasa: 0, rozladunek: 0, wykladanie: 0, sprzatanie: 0 }, people: [] },
    tapStreak: 0,
    lastTapAt: -1e9,
  };
};

let storage: MemoryStorage;
let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  faults.infoThrows = null;
  faults.generatorThrowsFor.clear();
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

  it('zapis nie niesie zleceń Centrali, a KPI tygodnia przechodzi przez zapis bez zmian', () => {
    const s = playedSession(BLOK);
    const saved = JSON.parse(storage.getItem(key(BLOK))!) as { econ: Record<string, unknown> };
    for (const k of ['quests', 'questSeq', 'cleanDays']) expect(k in saved.econ, k).toBe(false);
    expect(JSON.stringify(saved.econ)).not.toMatch(/quest|"title"/);

    const loaded = createSession(BLOK);
    expect(loaded.fromSave).toBe(true);
    expect(loaded.econ).toEqual(s.econ);
    expect(loaded.econ.tycoon.kpi).toEqual(s.econ.tycoon.kpi);
    // ponowny zapis po wczytaniu daje tę samą kopertę
    const before = storage.getItem(key(BLOK));
    saveSession(loaded);
    expect(storage.getItem(key(BLOK))).toBe(before);
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
    expect(remont(s).ok).toBe(true);
    expect(s.layoutLevel).toBe(1);
    saveSession(s);
    const after = JSON.parse(storage.getItem(key(PAWILON))!) as { layout: { width: number } };
    expect(after.layout.width).toBeGreaterThan(small);
    const loaded = createSession(PAWILON);
    expect(loaded.layout).toEqual(s.layout);
    expect(loaded.layout).toEqual(layoutFor(PAWILON, 1));
    expect(loaded.layoutLevel).toBe(1);
    expect(loaded.layoutLevel).toBe(loaded.econ.remontLevel);   // układ i poziom remontu się zgadzają, nic do przestawienia
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
      expect(withoutTycoon(s.econ)).toEqual({ ...asLoaded(v1), lastReport: null });
      expect(s.econ.tycoon.trust.value).toBe(legacyTrust(v1));
      expect(s.layout).toEqual(layoutFor(seed, remont));
      expect(s.layoutLevel).toBe(remont);
      // palety i sprzęt wskazują na istniejące miejsca i sloty w układzie
      for (const p of s.econ.pallets) expect(s.info.spots[p.loc][p.spot], `${p.loc}#${p.spot}`).toBeDefined();
      for (const e of s.econ.equipment) expect(s.info.slots.some((x) => x.id === e.slot), String(e.slot)).toBe(true);
      expect(s.econ.pallets.length).toBeGreaterThan(0);

      // samo wczytanie niczego nie zapisuje (zapis dobry zostaje, jakim był, dopóki świat nie stanie); pierwszy zapis robi v2
      expect(storage.getItem(key(seed))).toBe(text(file));
      saveSession(s);
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

/**
 * Koperty v2 wygenerowane kodem produkcji (`src/sim` i `session.ts` sprzed zmian etapu 2) przez bota: stuka w palety i kasę,
 * odbiera zlecenia i paczki (wtedy jeszcze były), kupuje ulepszenia i sprzęt, robi remonty. To dokładnie ten format, jaki mają zapisy graczy w
 * przeglądarkach. Dalsze zmiany stanu gry wolno robić tylko tak, żeby te pliki wczytywały się dalej; jeśli któraś zmiana
 * wymaga innego wyniku wczytania, trzeba to opisać jawnie jako migrację (i zaktualizować tę próbę), a nie po cichu.
 */
describe('zapisy v2 z produkcji', () => {
  const FIXTURE_A = 'traszka-v2-a';
  const FIXTURE_B = 'traszka-v2-b';
  const cases: { file: string; seed: string; partner: EconomyState['partner']; remont: number; describeIt: (e: EconomyState) => void }[] = [
    {
      // 30 dni od otwarcia i jeszcze pięć godzin: raport za wrzesień, palety z porannej dostawy i zamówienie z 11:00 w drodze
      file: 'save-v2-dzien30.json', seed: FIXTURE_A, partner: { points: 0, networkIncome: 0, stores: 0 }, remont: 1,
      describeIt: (e) => {
        expect(e.lastReport?.label).toBe('wrzesień 2026');
        expect(e.pallets.length).toBeGreaterThan(0);
        expect(e.deliveries.length).toBeGreaterThan(0);
        // zapis z produkcji niesie jeszcze zlecenia Centrali (z tytułami); po wczytaniu ich nie ma
        const old = e as EconomyState & { quests: { title: unknown }[] };
        expect(old.quests).toHaveLength(3);
        for (const q of old.quests) expect(typeof q.title).toBe('string');
        expect(e.equipment.length).toBeGreaterThan(0);
      },
    },
    {
      // remont poziomu 2 (łącznie z premią z sieci sklepów) i trzy dni po nim: sprzęt rozstawiony w slotach nowego układu
      file: 'save-v2-remont2.json', seed: FIXTURE_B, partner: { points: 120, networkIncome: 350, stores: 2 }, remont: 2,
      describeIt: (e) => {
        expect(e.level).toBeGreaterThanOrEqual(14);
        expect(e.equipment.length).toBeGreaterThan(0);
        for (const unit of e.equipment) expect(unit.slot, unit.id).not.toBeNull();
        expect(e.pallets.length).toBeGreaterThan(0);
        expect(e.deliveries.length).toBeGreaterThan(0);
        expect(e.partner).toEqual({ points: 120, networkIncome: 350, stores: 2 });
      },
    },
  ];

  for (const { file, seed, partner, remont, describeIt } of cases) {
    const fixture = (): SaveEnvelope => JSON.parse(text(file)) as SaveEnvelope;

    describe(file, () => {
      it('to koperta v2 z treścią, na której opiera się przypięcie', () => {
        const f = fixture();
        expect(Object.keys(f).sort()).toEqual(['econ', 'gameVersion', 'generatorVersion', 'layout', 'schema', 'seed']);
        expect(f.schema).toBe(2);
        expect(f.seed).toBe(seed);
        expect(f.econ.version).toBe(1);
        expect(f.econ.seed).toBe(seed);
        expect(f.econ.remontLevel).toBe(remont);
        expect(f.econ.gameOver).toBe(false);
        expect(f.econ.partner).toEqual(partner);
        expect(nonFinite(f)).toEqual([]);
        describeIt(f.econ);
      });

      it('wczytuje się jak zwykły zapis: stan i układ bez zmian, bez komunikatu i bez błędów', () => {
        const f = fixture();
        storage.setItem(key(seed), text(file));

        const s = createSession(seed, false, partner);
        expect(s.fromSave).toBe(true);
        expect(s.loadNotice).toBeNull();
        expect(s.ephemeral).toBe(false);
        expect(s.retired).toBe(false);
        expect(s.layout).toEqual(f.layout);
        expect(withoutTycoon(s.econ)).toEqual(asLoaded(f.econ));
        expect(s.econ.tycoon.trust.value).toBe(legacyTrust(f.econ));
        for (const k of ['quests', 'questSeq', 'cleanDays']) expect(k in s.econ, k).toBe(false);
        expect(s.layoutLevel).toBe(remont);
        expect(errorLog).not.toHaveBeenCalled();

        // samo wczytanie niczego nie zapisuje ani nie tworzy kopii
        expect(storage.getItem(key(seed))).toBe(text(file));
        expect(storage.getItem(`${key(seed)}:broken`)).toBeNull();
        // palety i sprzęt stoją w miejscach, które istnieją w zapisanym układzie
        for (const p of s.econ.pallets) expect(s.info.spots[p.loc][p.spot], `${p.loc}#${p.spot}`).toBeDefined();
        for (const e of s.econ.equipment) expect(s.info.slots.some((slot) => slot.id === e.slot), String(e.slot)).toBe(true);
      });

      it('po wczytaniu gra toczy się dalej: dziesięć dni bez NaN i bez wyjątku', () => {
        storage.setItem(key(seed), text(file));
        const s = createSession(seed, false, partner);
        const from = s.econ.minute;
        play(s, 10);
        expect(s.econ.minute).toBe(from + 10 * MINUTES_PER_DAY);
        expect(s.econ.gameOver).toBe(false);
        expect(nonFinite(s.econ)).toEqual([]);
        expect(JSON.parse(JSON.stringify(s.econ))).toEqual(s.econ);   // NaN i Infinity zamieniłyby się w null
        expect(errorLog).not.toHaveBeenCalled();
      });

      it('zapis po wczytaniu daje kopertę v2 z tym samym układem i stanem', () => {
        const f = fixture();
        storage.setItem(key(seed), text(file));
        const s = createSession(seed, false, partner);
        saveSession(s);

        const saved = JSON.parse(storage.getItem(key(seed))!) as SaveEnvelope;
        expect(Object.keys(saved).sort()).toEqual(['econ', 'gameVersion', 'generatorVersion', 'layout', 'schema', 'seed']);
        expect(saved.schema).toBe(2);
        expect(saved.seed).toBe(seed);
        expect(saved.gameVersion).toBe(gameVersion);
        expect(saved.generatorVersion).toBe(GENERATOR_VERSION);
        expect(saved.layout).toEqual(f.layout);
        // w kopercie nie ma już zleceń (ani ich liczników); reszta stanu jest tym, co dała migracja
        expect(saved.econ).toEqual({ ...asLoaded(f.econ), tycoon: s.econ.tycoon });
        expect(JSON.stringify(saved.econ)).not.toMatch(/quest|"title"/);
        expect(storage.getItem(`${key(seed)}:broken`)).toBeNull();

        const again = createSession(seed, false, partner);
        expect(withoutTycoon(again.econ)).toEqual(asLoaded(f.econ));
        expect(again.econ.tycoon).toEqual(s.econ.tycoon);   // tycoon z migracji wraca z zapisu bez zmian
        expect(again.layout).toEqual(f.layout);
      });
    });
  }
});

/**
 * Stan tycoona dochodzi do zapisów z produkcji (v1 i v2) migracją w `sanitizeEconomy`: zapisy nie mają pola `tycoon`, a stare
 * `trust` przechodzi do `tycoon.trust`. `EconomyState.version` zostaje 1, a `SAVE_SCHEMA` 2, więc cofnięcie wdrożenia nadal
 * wczyta nowy zapis (nieznane pole przepadnie, postęp zostanie).
 */
describe('zapisy z produkcji a stan tycoona', () => {
  const cases = [
    { file: 'save-v1-blok-dzien40.json', seed: BLOK, partner: undefined, v2: false },
    { file: 'save-v1-remont1.json', seed: PAWILON, partner: undefined, v2: false },
    { file: 'save-v2-dzien30.json', seed: 'traszka-v2-a', partner: { points: 0, networkIncome: 0, stores: 0 }, v2: true },
    { file: 'save-v2-remont2.json', seed: 'traszka-v2-b', partner: { points: 120, networkIncome: 350, stores: 2 }, v2: true },
  ];

  it('stałe wersji zapisu się nie zmieniły (cofnięcie wdrożenia wczytuje nowy zapis)', () => {
    expect(SAVE_SCHEMA).toBe(2);
    expect(createSession(BLOK, true).econ.version).toBe(1);
  });

  for (const { file, seed, partner, v2 } of cases) {
    it(`${file}: gotówka, poziom, XP, ulepszenia, sprzęt, remont i historia równe zapisowi, zaufanie przeszło do tycoona`, () => {
      const raw = JSON.parse(text(file)) as EconomyState | SaveEnvelope;
      const was = (v2 ? (raw as SaveEnvelope).econ : raw) as EconomyState;
      storage.setItem(key(seed), text(file));

      const s = createSession(seed, false, partner);
      expect(s.fromSave).toBe(true);
      expect(s.loadNotice).toBeNull();
      expect(errorLog).not.toHaveBeenCalled();
      for (const field of ['cash', 'level', 'xp', 'upgrades', 'equipment', 'remontLevel', 'history'] as const) {
        expect(s.econ[field], field).toEqual(was[field]);
      }
      expect(s.econ.tycoon.trust.value).toBe(legacyTrust(was));
      expect(s.econ.tycoon.trust.monthStart).toBe(legacyTrust(was));
      expect('trust' in s.econ).toBe(false);
      // dawny priorytet pracy ('rowno') przeszedł do profilu puli ludzi
      expect('priority' in s.econ).toBe(false);
      expect(s.econ.tycoon.staff.profile).toBe('kolejka');
      // tydzień KPI liczy się od dnia wczytania i od liczników zapisu
      expect(s.econ.tycoon.kpi.fromDay).toBe(Math.floor(was.minute / MINUTES_PER_DAY));
      expect(s.econ.tycoon.kpi.start.customers).toBe(was.total.customers);
      expect(s.econ.total.fineCount).toBe(0);
      expectPlayable(s);
    });
  }
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

describe('minuty i historia z długiej, ale możliwej gry wracają z zapisu bez zmian (granice nie schodzą niżej)', () => {
  /** Jeden wiersz na każdy miesiąc od początku gry, tak jak go dopisuje `closeMonth`: etykieta z kalendarza, wynik i obrót. */
  function monthlyHistory(days: number): EconomyState['history'] {
    const rows: EconomyState['history'] = [];
    for (let day = 0; day < days; day++) {
      if (isLastDayOfMonth(day)) rows.push({ label: formatMonth(day), profit: 12_000 + rows.length * 37, revenue: 180_000 + rows.length * 211 });
    }
    return rows;
  }
  const savedEcon = (): EconomyState => (JSON.parse(storage.getItem(key(BLOK))!) as { econ: EconomyState }).econ;

  // 100 lat gry to ok. 3 doby przy ×8 bez przerwy (tysiąc lat, czyli granica, to ok. 30 dób); sim niczego nie obcina, więc
  // historia ma wiersz za każdy miesiąc. Sto lat, a nie dziesięć: granica obniżona do dziesięciu lat przepuściłaby jeszcze dziesięć.
  it('sto lat gry i 1200 wierszy historii: zapis → wczytanie → zapis bez zmian, a gra się toczy dalej', () => {
    const played = playedSession(BLOK);
    const days = Math.round(100 * 365.2425);
    played.econ.minute = days * MINUTES_PER_DAY + OPEN_FROM;
    // sto lat później tydzień KPI też już jest ten sam co dziś (przeskok zegara bez gry zostawiłby go sprzed stu lat)
    played.econ.tycoon.kpi = newKpiWeek(played.econ.seedHash, 1, days, kpiMetricsOf(played.econ), kpiScaleOf(played.econ, played.info));
    played.econ.history = monthlyHistory(days);
    expect(played.econ.history).toHaveLength(1200);
    saveSession(played);
    const before = savedEcon();

    const loaded = createSession(BLOK);
    expect(loaded.fromSave).toBe(true);
    expect(loaded.loadNotice).toBeNull();
    expect(loaded.econ.minute).toBe(played.econ.minute);
    expect(loaded.econ.history).toEqual(played.econ.history);
    saveSession(loaded);
    expect(savedEcon()).toEqual(before);

    play(loaded, 3);   // kalendarz i losowanie z `minute` tej wielkości nadal działają
    expect(loaded.econ.minute).toBe(played.econ.minute + 3 * MINUTES_PER_DAY);
    expect(nonFinite(loaded.econ)).toEqual([]);
  });
});

describe('pieniądze w zapisie: LIMITS.money to straż przed przepełnieniem, a nie granica rozgrywki', () => {
  /** Ta sama kwota we wszystkich polach pieniężnych: kasa, liczniki, najlepszy dzień, historia, raport miesięczny, dochód z sieci. */
  function setMoney(e: EconomyState, value: number): void {
    e.cash = value;
    e.lastDayProfit = value;
    e.bestDayProfit = value;
    e.partner = { ...e.partner, networkIncome: value };
    for (const k of Object.keys(emptyCounters()) as (keyof Counters)[]) e.today[k] = e.month[k] = e.total[k] = value;
    e.history = [{ label: 'wrzesień 2026', profit: value, revenue: value }];
    e.lastReport = { label: 'wrzesień 2026', counters: { ...e.total }, profit: value, cash: value, comment: 'Rekordowy miesiąc!', detail: null };
  }
  const savedEcon = (): EconomyState => (JSON.parse(storage.getItem(key(BLOK))!) as { econ: EconomyState }).econ;

  // 1,5e12: kasa po ok. 100 sklepach sieci (aktywny gracz, ok. 10 godzin przy ×8); 1e45: sieć kilkuset sklepów
  for (const value of [1.5e12, 1e45]) {
    it(`${value}: zapis wczytany i zapisany ponownie wraca bez zmian (kasa, liczniki, najlepszy dzień, historia, raport, dochód z sieci)`, () => {
      const played = playedSession(BLOK);
      setMoney(played.econ, value);
      saveSession(played);
      const before = savedEcon();

      const loaded = createSession(BLOK);   // wczytanie
      expect(loaded.fromSave).toBe(true);
      expect(loaded.loadNotice).toBeNull();
      expect(loaded.econ.cash).toBe(value);
      expect(loaded.econ.total.other).toBe(value);
      expect(loaded.econ.history[0]!.profit).toBe(value);
      expect(loaded.econ.lastReport).toMatchObject({ cash: value, profit: value });
      expect(loaded.econ.bestDayProfit).toBe(value);

      saveSession(loaded);                  // zapis po wczytaniu: pierwszy persist() po starcie
      expect(savedEcon()).toEqual(before);
      expectPlayable(loaded);
    });
  }

  it('1e61 (i 1e308) jest przycięte do granicy 1e60, liczby zostają skończone, a gra się toczy', () => {
    for (const huge of [1e61, 1e308]) {
      const played = playedSession(BLOK);
      setMoney(played.econ, huge);
      saveSession(played);
      const loaded = createSession(BLOK);
      expect(LIMITS.money).toBe(1e60);
      expect(loaded.econ.cash).toBe(1e60);
      expect(loaded.econ.total.other).toBe(1e60);
      expect(loaded.econ.history[0]).toEqual({ label: 'wrzesień 2026', profit: 1e60, revenue: 1e60 });
      expect(loaded.econ.lastReport).toMatchObject({ cash: 1e60, profit: 1e60 });
      expect(loaded.econ.bestDayProfit).toBe(1e60);
      expect(loaded.econ.partner.networkIncome).toBe(1e60);
      expectPlayable(loaded);   // także NaN i Infinity po dniu gry (dochód z sieci dolicza się do kasy co wieczór)
    }
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

describe('zapis, który przeszedł walidację, ale z którego nie da się zbudować świata, nigdy nie idzie do :broken', () => {
  /** Zagrany sklep na poziomie remontu 1, zapisany w kopercie v2; zwraca surowy zapis. */
  const savedRemont = (): { raw: string; session: GameSession } => {
    const s = createSession(BLOK, true);
    s.econ.cash = 400_000;
    s.econ.level = 12;
    expect(remont(s).ok).toBe(true);
    play(s, 5);
    saveSession(s);
    return { raw: storage.getItem(key(BLOK))!, session: s };
  };
  /** Ten sam zapis z oznaczonym układem (generatorVersion 777), który mock `computeStoreInfo` potrafi odrzucić. */
  const markStoredLayout = (raw: string): string => {
    const blob = JSON.parse(raw) as { layout: { generatorVersion: number } };
    blob.layout.generatorVersion = 777;
    const marked = JSON.stringify(blob);
    storage.setItem(key(BLOK), marked);
    return marked;
  };
  const baseWidth = layoutFor(BLOK, 0).width;

  it('zapisany układ się nie buduje, układ z seeda tak: gra wraca na układzie z seeda z całym postępem, bez kopii', () => {
    const { raw, session: played } = savedRemont();
    markStoredLayout(raw);
    faults.infoThrows = (l) => l.generatorVersion === 777;
    const s = createSession(BLOK);
    expect(s.fromSave).toBe(true);
    expect(s.ephemeral).toBe(false);
    expect(s.loadNotice).toBeNull();
    expect(s.layout).toEqual(layoutFor(BLOK, 1));
    expect(s.econ.cash).toBe(played.econ.cash);
    expect(s.econ.level).toBe(played.econ.level);
    expect(s.econ.remontLevel).toBe(1);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
    // układ z seeda zastępuje w zapisie ten, który się nie budował, ale dopiero przy pierwszym zapisie (po zbudowaniu świata)
    expect((JSON.parse(storage.getItem(key(BLOK))!) as { layout: { generatorVersion: number } }).layout.generatorVersion).toBe(777);
    saveSession(s);
    expect((JSON.parse(storage.getItem(key(BLOK))!) as { layout: { generatorVersion: number } }).layout.generatorVersion).toBe(GENERATOR_VERSION);
    expectPlayable(s);
  });

  it('ani zapisany układ, ani układ z seeda się nie budują: sklep tymczasowy z komunikatem, a zapis zostaje bajt w bajt na swoim miejscu', () => {
    const { raw } = savedRemont();
    const marked = markStoredLayout(raw);
    storage.setItem('traszka:last', BLOK);
    faults.infoThrows = (l) => l.generatorVersion === 777 || l.width > baseWidth;   // sklep po remoncie nie wstaje, nowa gra tak
    const s = createSession(BLOK);
    expect(UNBUILDABLE_SAVE_NOTICE).toBe('Nie udało się zbudować Twojego sklepu — zapis jest bezpieczny, spróbuj odświeżyć stronę');
    expect(s.loadNotice).toBe(UNBUILDABLE_SAVE_NOTICE);
    expect(s.ephemeral).toBe(true);
    expect(s.fromSave).toBe(false);
    expect(s.seed).toBe(BLOK);
    expect(s.layout.width).toBe(baseWidth);
    expect(s.econ.minute).toBe(OPEN_FROM);
    expect(storage.getItem(key(BLOK))).toBe(marked);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
    saveSession(s);
    discardSave(s);
    expect(storage.getItem(key(BLOK))).toBe(marked);
    expect(lastSavedSeed()).toBe(BLOK);
    expectPlayable(s);
  });

  it('zapis v1 (bez układu), którego układ po remoncie się nie buduje: to samo, zapis nietknięty', () => {
    const v1 = JSON.parse(text('save-v1-remont1.json')) as EconomyState;
    const raw = JSON.stringify(v1);
    storage.setItem(key(PAWILON), raw);
    const base = layoutFor(PAWILON, 0).width;
    faults.infoThrows = (l) => l.width > base;
    const s = createSession(PAWILON);
    expect(s.ephemeral).toBe(true);
    expect(s.loadNotice).toBe(UNBUILDABLE_SAVE_NOTICE);
    expect(storage.getItem(key(PAWILON))).toBe(raw);
    expect(storage.getItem(`${key(PAWILON)}:broken`)).toBeNull();
  });

  it('generator nie daje sklepu dla tego seeda w ogóle: createSession rzuca, a zapis zostaje nietknięty', () => {
    const raw = text('save-v1-blok-dzien40.json');
    storage.setItem(key(BLOK), raw);
    faults.generatorThrowsFor.add(BLOK);
    expect(() => createSession(BLOK)).toThrow('generateStore');
    expect(storage.getItem(key(BLOK))).toBe(raw);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBeNull();
    expect(hasStoredSave(BLOK)).toBe(true);
    expect(hasStoredSave(PAWILON)).toBe(false);
  });

  it('nadal do :broken idzie to, co nie przeszło parsowania albo walidacji (zachowanie z poprzedniej rundy)', () => {
    storage.setItem(key(BLOK), '{"ucięty');
    const s = createSession(BLOK);
    expect(s.loadNotice).toBe(BROKEN_SAVE_NOTICE);
    expect(s.ephemeral).toBe(false);
    expect(storage.getItem(`${key(BLOK)}:broken`)).toBe('{"ucięty');
    expect(storage.getItem(key(BLOK))).toBeNull();
  });
});

describe('withLayoutFromSeed (druga próba po nieudanej budowie świata w scenie)', () => {
  /** Świeży sklep z dwiema paletami pod drzwiami i kasą samoobsługową w slocie. */
  const withStock = (): GameSession => {
    const s = createSession(BLOK, true);
    s.econ.cash = 100_000;
    s.econ.level = 9;
    buyEquipment(s.econ, s.info, 'sco');
    expect(s.econ.pallets.length).toBeGreaterThan(0);
    expect(s.econ.equipment.some((e) => e.slot !== null)).toBe(true);
    return s;
  };

  it('daje tę samą grę na układzie z seeda; gdy układ jest ten sam, palety i sprzęt stoją tam, gdzie stały', () => {
    const played = withStock();
    const before = JSON.stringify(played.econ);
    const again = withLayoutFromSeed(played);
    expect(again).not.toBe(played);
    expect(again.layout).toEqual(layoutFor(BLOK, played.econ.remontLevel));
    expect(JSON.stringify(again.econ)).toBe(before);
    expect(again.fromSave).toBe(played.fromSave);
    expect(again.ephemeral).toBe(false);
    expect(again.econ).not.toBe(played.econ);
    expect(JSON.stringify(played.econ)).toBe(before);   // sesja, która się nie udała, nie została zmieniona
  });

  it('gdy nowy układ nie ma miejsc, w których stały palety i sprzęt, ustawia je na istniejących', () => {
    const played = withStock();
    played.econ.pallets[0] = { ...played.econ.pallets[0]!, loc: 'sidewalk', spot: 40 };
    played.econ.equipment.push({ id: 'bankomat', slot: 'slot-którego-nie-ma' });
    const again = withLayoutFromSeed(played);
    expect(again.econ.pallets.length).toBeGreaterThan(0);
    for (const p of again.econ.pallets) expect(again.info.spots[p.loc][p.spot], `${p.loc}#${p.spot}`).toBeDefined();
    for (const e of again.econ.equipment) expect(e.slot === null || again.info.slots.some((x) => x.id === e.slot), String(e.slot)).toBe(true);
    expectPlayable(again);
  });
});

describe('newRunLog', () => {
  it('domyślnie zakłada bieg „casual”; tryb podaje wołający, a simVersion zawsze bierze z SIM_VERSION', () => {
    expect(newRunLog(BLOK)).toEqual({
      record: { seed: BLOK, gameVersion, generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'casual', log: [] }, seq: 0,
    });
    expect(newRunLog(BLOK, 'ranked').record).toEqual({
      seed: BLOK, gameVersion, generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log: [],
    });
    expect(newRunLog(BLOK).record.log).not.toBe(newRunLog(BLOK).record.log);   // każdy dziennik ma własną tablicę
  });
});

describe('dziennik poleceń sesji (run)', () => {
  it('nowa gra ma pusty bieg „casual” od świeżego sklepu, z wersjami gry, generatora i symulacji', () => {
    const s = createSession(BLOK, true);
    expect(s.run).toEqual({
      record: { seed: BLOK, gameVersion, generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'casual', log: [] }, seq: 0,
    });
    expect(s.run?.record.simVersion).toBe(SIM_VERSION);
    expect(s.run?.record.mode).toBe('casual');
    expect(createSession(BLOK, true).run).not.toBe(s.run);   // każda sesja ma własny dziennik
  });

  it('premia sieci sklepów wyłącza dziennik, bo replayRun startuje bez partnera: z zerowym partnerem dziennik jest', () => {
    const zero = { points: 0, networkIncome: 0, stores: 0 };
    expect(createSession(BLOK, true, zero).run).not.toBeNull();
    expect(createSession(BLOK, true, { points: 3, networkIncome: 200, stores: 1 }).run).toBeNull();
    // każde pole z osobna: dwa pierwsze zmieniają gospodarkę, `stores` tylko leży w stanie (odtworzony stan miałby inne bajty)
    expect(createSession(BLOK, true, { ...zero, points: 1 }).run).toBeNull();
    expect(createSession(BLOK, true, { ...zero, networkIncome: 50 }).run).toBeNull();
    expect(createSession(BLOK, true, { ...zero, stores: 1 }).run).toBeNull();
    // także sklep tymczasowy i gra bez zapisu
    expect(createSession(PAWILON, false, { points: 3, networkIncome: 200, stores: 1 }).run).toBeNull();
    expect(createSession(PAWILON, true, { points: 3, networkIncome: 200, stores: 1 }, { ephemeral: true }).run).toBeNull();
  });

  it('gra bez zapisu, uszkodzony zapis i sklep tymczasowy zaczynają nowy dziennik', () => {
    expect(createSession(PAWILON).run?.record.log).toEqual([]);
    storage.setItem(key(BLOK), '{"ucięty');
    const afterBroken = createSession(BLOK);
    expect(afterBroken.fromSave).toBe(false);
    expect(afterBroken.run?.record.seed).toBe(BLOK);
    const temporary = createSession(PAWILON, true, undefined, { ephemeral: true });
    expect(temporary.ephemeral).toBe(true);
    expect(temporary.run?.record.mode).toBe('casual');
  });

  it('sesja z zapisu (schemat 2 i 1) nie ma dziennika: jej stan nie zaczął się od świeżego sklepu', () => {
    saveSession(createSession(BLOK, true));
    expect(createSession(BLOK).run).toBeNull();
    storage.setItem(key(BLOK), text('save-v1-blok-dzien40.json'));
    const fromV1 = createSession(BLOK);
    expect(fromV1.fromSave).toBe(true);
    expect(fromV1.run).toBeNull();
  });

  it('withLayoutFromSeed zwraca sesję bez dziennika (stan przestawiony `relayout`) i nie rusza dziennika oryginału', () => {
    const played = createSession(BLOK, true);
    const run = played.run;
    expect(withLayoutFromSeed(played).run).toBeNull();
    expect(played.run).toBe(run);
  });
});

describe('stan z zapisu pasuje do układu sklepu (palety, sprzęt i zapasy po ręcznej zmianie)', () => {
  it('paleta w miejscu, którego nie ma, sprzęt w nieistniejącym slocie i zapas ponad pojemność: gra naprawia je przy wczytaniu', () => {
    const played = playedSession(BLOK);
    const blob = JSON.parse(storage.getItem(key(BLOK))!) as { econ: EconomyState };
    blob.econ.pallets[0] = { ...blob.econ.pallets[0]!, loc: 'sidewalk', spot: 40 };
    blob.econ.equipment.push({ id: 'bankomat', slot: 'nie-ma-takiego-slotu' });
    blob.econ.shelf.napoje = 90_000;
    blob.econ.backroom.nabial = 90_000;
    storage.setItem(key(BLOK), JSON.stringify(blob));
    const s = createSession(BLOK);
    expect(s.loadNotice).toBeNull();
    expect(s.econ.cash).toBe(played.econ.cash);
    for (const p of s.econ.pallets) expect(s.info.spots[p.loc][p.spot], `${p.loc}#${p.spot}`).toBeDefined();
    for (const e of s.econ.equipment) expect(e.slot === null || s.info.slots.some((x) => x.id === e.slot), String(e.slot)).toBe(true);
    expect(s.econ.shelf.napoje).toBeLessThanOrEqual(s.info.shelfCap.napoje);
    expect(CATS.reduce((n, c) => n + s.econ.backroom[c], 0)).toBeLessThanOrEqual(effectsBackroomCap(s));
    expectPlayable(s);
  });

  it('prawdziwy zapis jest w porządku sam z siebie: wczytanie niczego nie przestawia (zapis i wczytanie dają ten sam stan)', () => {
    for (const seed of [BLOK, PAWILON]) {
      const s = playedSession(seed);
      s.econ.cash += 1;   // coś zmienionego po zapisie nie ma znaczenia, liczy się zapisane
      const savedEcon = JSON.parse(storage.getItem(key(seed))!).econ as EconomyState;
      expect(JSON.stringify(createSession(seed).econ)).toBe(JSON.stringify(savedEcon));
    }
  });
});
