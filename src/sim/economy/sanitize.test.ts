import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateStore } from '@/sim/store/generateStore';
import { CATS, MINUTES_PER_DAY, PALLET_ITEMS } from './catalog';
import { dateOfDay } from './calendar';
import { buyEquipment, buyUpgrade, createEconomy, stepMinute, type EconEvent, type EconomyState } from './economy';
import { LIMITS, sanitizeEconomy } from './sanitize';
import { xpToNext } from './progress';
import { computeStoreInfo, type StoreInfo } from './storeInfo';
import { TRUST } from './tycoon/trust';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));
const defaults = (inf: StoreInfo = info, seed = SEED): EconomyState => createEconomy(seed, inf);

const play = (s: EconomyState, inf: StoreInfo, days: number): void => {
  const events: EconEvent[] = [];
  for (let i = 0; i < days * MINUTES_PER_DAY; i++) stepMinute(s, inf, events);
};
const inspectDetail = (v: unknown): string => JSON.stringify(v) ?? String(v);
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

/** Liczniki z zapisu sprzed tycoona: trzy nowe pola (premie Centrali, WUT, mandaty) są zerowe. */
const withNewCounters = (c: unknown): Record<string, unknown> => ({ ...(c as Record<string, unknown>), bonus: 0, wut: 0, fineCount: 0 });

describe('sanitizeEconomy: poprawny stan przechodzi bez zmian', () => {
  it('nowa gra', () => {
    const s = defaults();
    expect(sanitizeEconomy(json(s), defaults(), info)).toEqual(s);
  });

  it('gra po 30 dniach z zakupami, KPI tygodnia i raportem miesięcznym', () => {
    const s = defaults();
    s.cash = 500_000;
    s.level = 12;
    for (const id of ['ulotki', 'szkolenie', 'wozek', 'regaly', 'tasmociag', 'wykladacz'] as const) buyUpgrade(s, id);
    buyEquipment(s, info, 'sco');
    buyEquipment(s, info, 'piec');
    play(s, info, 30);
    expect(s.lastReport).not.toBeNull();
    expect(sanitizeEconomy(json(s), defaults(), info)).toEqual(s);
    // także co do bajta po zapisie w JSON (kolejność kluczy): na tym oprze się porównywanie i haszowanie stanów
    expect(JSON.stringify(sanitizeEconomy(json(s), defaults(), info))).toBe(JSON.stringify(s));
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
      expect(JSON.stringify(sanitizeEconomy(json(s), defaults(), info))).toBe(JSON.stringify(s));
    }
    expect(s.total.palletsUnloaded).toBeGreaterThan(50);
  });

  it('stan w trakcie remontu i stan po bankructwie też przechodzą bez zmian', () => {
    const closed = defaults();
    closed.remontLevel = 1;
    closed.remontUntil = closed.minute + 3 * MINUTES_PER_DAY;
    expect(sanitizeEconomy(json(closed), defaults(), info)).toEqual(closed);
    const bankrupt = defaults();
    bankrupt.cash = -1e6;
    play(bankrupt, info, 61);   // dwa zamknięcia z rzędu bez opłacenia Centrali
    expect(bankrupt.gameOver).toBe(true);
    expect(JSON.stringify(sanitizeEconomy(json(bankrupt), defaults(), info))).toBe(JSON.stringify(bankrupt));
  });

  it('prawdziwe zapisy v1 z produkcji (sprzed koperty v2): wszystkie pola zachowane, nowe uzupełnione', () => {
    for (const [file, seed] of [['save-v1-blok-dzien40.json', 'kiełbasa-42'], ['save-v1-remont1.json', 'traszka-1']] as const) {
      const raw = fixture(file);
      const inf = computeStoreInfo(generateStore(seed));
      const out = sanitizeEconomy(raw, defaults(inf, seed), inf)!;
      expect(out).not.toBeNull();
      // L1: zapis nie ma combo, więc dostaje brak serii i ostatnie stuknięcie dawno temu. Paczka od Centrali zniknęła: `giftSeq`
      // i `tapBoostUntil` z zapisu przepadają (`giftAt` nie ma w żadnym). Zlecenia Centrali też: `quests`, `questSeq` i `cleanDays`
      // zastąpiło KPI tygodnia w `tycoon.kpi`. Tycoon: stare `trust` przechodzi do `tycoon.trust`, a liczniki dostają zerowe
      // `bonus`, `wut` i `fineCount`. Pula ludzi: dawny `priority` zamienia się na profil w `tycoon.staff`, a `shift` (ostatnia
      // minuta) startuje pusty.
      const { trust, priority, giftSeq: _gs, tapBoostUntil: _tb, quests: _q, questSeq: _qs, cleanDays: _cd, ...rest } = raw;
      const { tycoon, ...progress } = out;
      expect(progress).toEqual({
        ...rest, lastReport: null, shift: defaults(inf, seed).shift, milestonesReady: [],
        tapStreak: 0, lastTapAt: -1e9, lastWarnAt: -1e9,
        today: withNewCounters(raw.today), month: withNewCounters(raw.month), total: withNewCounters(raw.total),
      });
      expect(tycoon.trust.value).toBe(trust);
      expect(tycoon.staff.profile).toBe({ klienci: 'kolejka', rowno: 'kolejka', palety: 'dostawa' }[priority as string]);
    }
  });

  it('stary zapis z giftAt, giftSeq i tapBoostUntil wczytuje się bez tych pól, a reszta stanu zostaje', () => {
    const s = defaults();
    s.cash = 123_456;
    s.xp = 40;
    const old = { ...json(s), giftAt: s.minute + 480, giftSeq: 9, tapBoostUntil: s.minute + 200 };
    for (const k of ['giftAt', 'giftSeq', 'tapBoostUntil']) expect(k in old).toBe(true);

    const out = sanitizeEconomy(old, defaults(), info)!;
    expect(out).not.toBeNull();
    for (const k of ['giftAt', 'giftSeq', 'tapBoostUntil']) expect(k in out, k).toBe(false);
    expect(out.cash).toBe(123_456);
    expect(out.xp).toBe(40);
    // poza przepadłymi polami wynik jest zapisem bez paczek co do bajta
    expect(JSON.stringify(out)).toBe(JSON.stringify(s));
    expect(JSON.stringify(out)).not.toMatch(/gift|tapBoost/i);
  });

  it('zapisy ze zleceniami (v1 i v2 z produkcji): wczytują się bez zleceń, a postęp gracza zostaje', () => {
    const cases: [string, string, Record<string, unknown>][] = [
      ['save-v1-blok-dzien40.json', 'kiełbasa-42', fixture('save-v1-blok-dzien40.json')],
      ['save-v1-remont1.json', 'traszka-1', fixture('save-v1-remont1.json')],
      ['save-v2-dzien30.json', 'traszka-v2-a', fixture('save-v2-dzien30.json').econ as Record<string, unknown>],
      ['save-v2-remont2.json', 'traszka-v2-b', fixture('save-v2-remont2.json').econ as Record<string, unknown>],
    ];
    for (const [file, seed, raw] of cases) {
      expect((raw.quests as unknown[]).length, `${file}: zapis z produkcji ma zlecenia`).toBeGreaterThan(0);
      expect(typeof raw.questSeq, file).toBe('number');
      const inf = computeStoreInfo(generateStore(seed));
      const out = sanitizeEconomy(raw, defaults(inf, seed), inf);
      expect(out, file).not.toBeNull();
      for (const k of ['quests', 'questSeq', 'cleanDays']) expect(k in out!, `${file}: ${k}`).toBe(false);
      for (const field of ['cash', 'level', 'xp', 'upgrades', 'equipment', 'remontLevel', 'history'] as const) {
        expect(out![field], `${file}: ${field}`).toEqual(raw[field]);
      }
      expect(JSON.stringify(out), file).not.toMatch(/"title"|quest/);
    }
  });

  it('nie gubi żadnego pola stanu: klucze wyniku to klucze createEconomy, z tycoon i bez trust', () => {
    const out = sanitizeEconomy(json(defaults()), defaults(), info)!;
    expect(Object.keys(out).sort()).toEqual(Object.keys(defaults()).sort());
    expect(Object.keys(out)).toContain('tycoon');
    expect(Object.keys(out)).not.toContain('trust');
  });

  it('createEconomy przez JSON i sanitize wraca bajt w bajt', () => {
    const e = defaults();
    const d = defaults();
    expect(JSON.stringify(sanitizeEconomy(JSON.parse(JSON.stringify(e)), d, info))).toBe(JSON.stringify(e));
  });

  it('tycoon po 70 dniach gry (dwa miesiące, kolejne tygodnie KPI) wraca bajt w bajt', () => {
    const s = defaults();
    s.cash = 1e6;
    for (const days of [11, 30, 29]) {
      play(s, info, days);
      expect(JSON.stringify(sanitizeEconomy(json(s), defaults(), info))).toBe(JSON.stringify(s));
    }
    expect(s.history.length).toBeGreaterThanOrEqual(2);
  });

  it('zapis tuż po niedzielnym zamknięciu tygodnia (23:01, KPI już na poniedziałek) wraca bajt w bajt', () => {
    // tak zapisuje automatyczny zapis na zdarzeniu „dzień”: gra stoi jeszcze w niedzielę, a nowy tydzień KPI zaczyna się jutro
    const s = defaults();
    s.cash = 1e6;
    const events: EconEvent[] = [];
    for (const sunday of [5, 12, 19]) {
      while (s.minute < sunday * MINUTES_PER_DAY + 23 * 60 + 1) stepMinute(s, info, events);
      expect(s.tycoon.kpi.fromDay, `niedziela ${sunday}`).toBe(sunday + 1);   // tydzień już otwarty na jutro
      const loaded = sanitizeEconomy(json(s), defaults(), info)!;
      expect(loaded.tycoon.kpi, `niedziela ${sunday}`).toEqual(s.tycoon.kpi);   // wcześniej: tydzień „z przyszłości” przepadał, a cel, seria i licznik miesiąca wracały do początku
      expect(JSON.stringify(loaded), `niedziela ${sunday}`).toBe(JSON.stringify(s));
    }
  });
});

describe('sanitizeEconomy: zlecenia zniknęły, raport miesięczny ma szczegóły', () => {
  const OLD_QUESTS = [
    { id: 1, kind: 'serve', target: 100, start: 0, reward: { cash: 400, ogonki: 3, xp: 50 } },
    { id: 2, kind: 'clean', target: 1, start: 0, reward: { cash: 300, ogonki: 2, xp: 50 } },
  ];

  it('zapis z quests, questSeq i cleanDays wczytuje się bez nich, a reszta stanu zostaje', () => {
    const s = defaults();
    s.cash = 123_456;
    s.xp = 40;
    const old = { ...json(s), quests: OLD_QUESTS, questSeq: 7, cleanDays: 3 };
    for (const k of ['quests', 'questSeq', 'cleanDays']) expect(k in old, k).toBe(true);
    const out = sanitizeEconomy(old, defaults(), info)!;
    expect(out).not.toBeNull();
    for (const k of ['quests', 'questSeq', 'cleanDays']) expect(k in out, k).toBe(false);
    expect(out.cash).toBe(123_456);
    expect(out.xp).toBe(40);
    expect(JSON.stringify(out)).toBe(JSON.stringify(s));
  });

  it('uszkodzone quests (liczba zamiast listy) nie psują wczytania: pole i tak przepada', () => {
    const out = sanitizeEconomy({ ...json(defaults()), quests: 3, questSeq: 'x', cleanDays: null }, defaults(), info)!;
    expect(out).not.toBeNull();
    expect(JSON.stringify(out)).toBe(JSON.stringify(defaults()));
  });

  const OLD_REPORT = { label: 'wrzesień 2026', counters: { ...json(defaults().total), margin: 9000 }, profit: 1234, cash: 5678, comment: 'Jest dodatnio!' };

  it('lastReport bez detail (zapis sprzed raportu tycoona) daje detail: null i zachowuje resztę', () => {
    const out = sanitizeEconomy({ ...json(defaults()), lastReport: OLD_REPORT }, defaults(), info)!;
    expect(out.lastReport).toEqual({ ...OLD_REPORT, counters: { ...OLD_REPORT.counters, bonus: 0, wut: 0, fineCount: 0 }, detail: null });
  });

  it('lastReport z uszkodzonym detail (tekst, lista, brak pozycji) też daje detail: null', () => {
    for (const detail of ['x', 7, [], {}, { lines: 3 }, null]) {
      const out = sanitizeEconomy({ ...json(defaults()), lastReport: { ...OLD_REPORT, detail } }, defaults(), info)!;
      expect(out.lastReport, inspectDetail(detail)).toMatchObject({ label: 'wrzesień 2026', profit: 1234, detail: null });
    }
  });

  it('raport zamkniętego miesiąca ze szczegółami wraca z zapisu bajt w bajt, także przy rachunku z samych zer', () => {
    const s = defaults();
    play(s, info, 30);
    expect(s.lastReport?.detail).not.toBeNull();
    const out = sanitizeEconomy(json(s), defaults(), info)!;
    expect(JSON.stringify(out.lastReport)).toBe(JSON.stringify(s.lastReport));
    expect(out.lastReport!.detail!.lines.map((l) => l.key)).toHaveLength(9);
  });
});

describe('sanitizeEconomy: dawny priorytet pracy a profil puli ludzi', () => {
  /** Zapis sprzed puli ludzi: `priority` na wierzchu i żadnego `tycoon`. */
  const legacy = (priority: unknown): Record<string, unknown> => {
    const { tycoon: _, ...old } = json(defaults());
    return { ...old, priority };
  };
  const profileOf = (raw: unknown): string => sanitizeEconomy(raw, defaults(), info)!.tycoon.staff.profile;

  it('zapis bez tycoon: klienci to kolejka, palety to dostawa, rowno to kolejka', () => {
    expect(profileOf(legacy('klienci'))).toBe('kolejka');
    expect(profileOf(legacy('palety'))).toBe('dostawa');
    expect(profileOf(legacy('rowno'))).toBe('kolejka');
  });

  it('profil niesie ze sobą kolejność zadań, a stare pole priority nie zostaje w stanie', () => {
    const out = sanitizeEconomy(legacy('palety'), defaults(), info)!;
    expect(out.tycoon.staff.order).toEqual(['rozladunek', 'kasa', 'wykladanie', 'sprzatanie']);
    expect('priority' in out).toBe(false);
  });

  it('brak, śmieć albo nazwa z prototypu zostawia profil domyślny', () => {
    for (const bad of [undefined, null, 5, 'szalony', '__proto__', 'toString', 'constructor', {}, []]) {
      expect(profileOf(legacy(bad)), String(bad)).toBe('kolejka');
    }
  });

  it('zapis z tycoon zostaje przy własnym profilu, nawet gdy ma jeszcze stary priorytet', () => {
    const s = defaults();
    s.tycoon.staff.profile = 'porzadek';
    s.tycoon.staff.order = ['sprzatanie', 'kasa', 'wykladanie', 'rozladunek'];
    s.tycoon.staff.pinned.kasa = 1;
    const out = sanitizeEconomy({ ...json(s), priority: 'palety' }, defaults(), info)!;
    expect(out.tycoon.staff).toEqual(s.tycoon.staff);
  });

  it('przypięci ze starego zapisu się nie pojawiają, a zapis z przypiętymi ponad personel jest przycięty do personelu', () => {
    expect(sanitizeEconomy(legacy('palety'), defaults(), info)!.tycoon.staff.pinned).toEqual({ kasa: 0, rozladunek: 0, wykladanie: 0, sprzatanie: 0 });
    const s = defaults();
    s.staff = 2;
    s.tycoon.staff.pinned = { kasa: 5, rozladunek: 0, wykladanie: 0, sprzatanie: 0 };
    expect(sanitizeEconomy(json(s), defaults(), info)!.tycoon.staff.pinned.kasa).toBe(2);
  });

  it('ułamki osobominut z ostatniego przydziału wracają z zapisu bez zaokrąglenia', () => {
    const s = defaults();
    s.lastCashiers = 0.4375;
    s.lastWorkers = 1.25;
    s.shift = { staff: 2, human: { kasa: 0.4375, rozladunek: 1, wykladanie: 0.25, sprzatanie: 0 }, people: ['rozladunek', 'kasa'] };
    const out = sanitizeEconomy(json(s), defaults(), info)!;
    expect(out.lastCashiers).toBe(0.4375);
    expect(out.lastWorkers).toBe(1.25);
    expect(JSON.stringify(out)).toBe(JSON.stringify(s));
  });
});

describe('sanitizeEconomy: migracja do stanu tycoona', () => {
  /** Zapis sprzed tycoona: pole `trust` na wierzchu i żadnego `tycoon`. */
  const legacy = (trust: unknown, patch: Record<string, unknown> = {}): Record<string, unknown> => {
    const { tycoon: _, ...old } = json(defaults());
    return { ...old, trust, ...patch };
  };
  const trustOf = (raw: unknown): number => sanitizeEconomy(raw, defaults(), info)!.tycoon.trust.value;

  it('zapis bez pola tycoon bierze zaufanie ze starego trust', () => {
    expect(trustOf(legacy(42))).toBe(42);
    expect(trustOf(legacy(0))).toBe(0);
    expect(trustOf(legacy(null))).toBe(TRUST.start);
    expect(trustOf(legacy('x'))).toBe(TRUST.start);
    expect(trustOf(legacy(undefined))).toBe(TRUST.start);
    expect(trustOf(legacy(150))).toBe(100);
    expect(trustOf(legacy(-30))).toBe(0);
  });

  it('migracja nie zostawia starego pola trust, a zaufanie startuje miesiąc od wczytanej wartości', () => {
    const out = sanitizeEconomy(legacy(42), defaults(), info)!;
    expect('trust' in out).toBe(false);
    expect(out.tycoon.trust).toEqual({ value: 42, monthStart: 42, month: {} });
  });

  it('zapis z tycoon ma pierwszeństwo przed starym trust, a zepsuty tycoon wraca do świeżego z zaufaniem ze starego pola', () => {
    const s = defaults();
    s.tycoon.trust.value = 33;
    expect(trustOf({ ...json(s), trust: 80 })).toBe(33);
    expect(trustOf({ ...json(s), trust: 80, tycoon: 'zepsute' })).toBe(80);
    expect(trustOf({ ...json(s), trust: 80, tycoon: [] })).toBe(80);
    expect(trustOf({ ...json(s), tycoon: { ...json(s.tycoon), version: 2 } })).toBe(TRUST.start);
  });

  it('świeży tydzień KPI liczy się od dnia i liczników wczytanego zapisu, w skali sklepu z zapisu', () => {
    const s = defaults();
    play(s, info, 3);
    const day = Math.floor(s.minute / MINUTES_PER_DAY);
    const { tycoon: _, ...old } = json(s);
    const out = sanitizeEconomy({ ...old, trust: 55 }, defaults(), info)!;
    expect(out.tycoon.kpi.fromDay).toBe(day);
    expect(out.tycoon.kpi.toDay).toBeGreaterThanOrEqual(day);
    expect(out.tycoon.kpi.start).toEqual({
      customers: s.total.customers, hotSold: s.total.hotSold, lost: s.total.lost, fines: s.total.fineCount, cleanSum: 0, cleanMinutes: 0,
    });
    expect(out.tycoon.cards.pending).toEqual([]);
    expect(out.tycoon.hall.weather).toBeDefined();
  });

  it('licznik bez nowych pól (zapis sprzed tycoona) dostaje je zerowe, a wpisane liczby przycina do granic', () => {
    const base = json(defaults());
    const old = (c: unknown): Record<string, unknown> => { const { bonus: _b, wut: _w, fineCount: _f, ...rest } = c as Record<string, unknown>; return rest; };
    const out = sanitizeEconomy({ ...base, today: old(base.today), month: old(base.month), total: { ...old(base.total), bonus: 1e99, fineCount: 'x' } }, defaults(), info)!;
    expect(out.today).toMatchObject({ bonus: 0, wut: 0, fineCount: 0 });
    expect(out.month).toMatchObject({ bonus: 0, wut: 0, fineCount: 0 });
    expect(out.total).toMatchObject({ bonus: 1e60, wut: 0, fineCount: 0 });
  });

  it('tydzień KPI z dalekiej przyszłości jest zastępowany świeżym od dnia wczytania', () => {
    const s = defaults();
    play(s, info, 2);
    const raw = json(s);
    (raw.tycoon as { kpi: { fromDay: number; toDay: number } }).kpi.fromDay = 5000;
    (raw.tycoon as { kpi: { fromDay: number; toDay: number } }).kpi.toDay = 5006;
    const out = sanitizeEconomy(raw, defaults(), info)!;
    expect(out.tycoon.kpi.fromDay).toBeLessThanOrEqual(Math.floor(s.minute / MINUTES_PER_DAY));
  });
});

describe('sanitizeEconomy: napraw to, co da się naprawić', () => {
  const repaired = (patch: Record<string, unknown>): EconomyState => {
    const s = defaults();
    play(s, info, 2);
    const out = sanitizeEconomy({ ...json(s), ...patch }, defaults(), info);
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
    const s = repaired({ reputation: null, tycoon: { ...json(defaults()).tycoon as object, trust: { value: 'x', monthStart: 'y', month: null } }, queue: -4, staff: 99, level: -3, remontLevel: 17 });
    expect(s.reputation).toBe(50);
    expect(s.tycoon.trust.value).toBe(TRUST.start);
    expect(s.tycoon.trust.monthStart).toBe(TRUST.start);
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
    }, defaults(), info)!;
    expect(out.pallets).toHaveLength(1);
    expect(out.pallets[0]!.id).toBe(s.pallets[0]!.id);
    expect(out.deliveries).toEqual([{ at: 9000, count: 2 }]);
    expect(out.equipment).toEqual([{ id: 'sco', slot: 'a' }, { id: 'piec', slot: null }]);
    expect(out.history).toEqual([{ label: 'wrzesień 2026', profit: 0, revenue: 10 }]);
    expect(out.milestones).toEqual(['pallet1', 'upgrade1']);
  });

  it('ulepszenia: nieznane i zbyt wysokie poziomy są odrzucone albo przycięte', () => {
    const out = sanitizeEconomy({ ...json(defaults()), upgrades: { ulotki: 99, szkolenie: 'x', czołg: 3, wozek: 2.4, klima: -1 } }, defaults(), info)!;
    expect(out.upgrades).toEqual({ ulotki: 5, wozek: 2 });
  });

  it('paleta: suma sztuk wynika z zawartości, a nowy numer palety nie koliduje z istniejącymi', () => {
    const s = defaults();
    const p = json(s.pallets[0]) as { id: number; total: number };
    const out = sanitizeEconomy({ ...json(s), nextPalletId: 1, pallets: [{ ...p, id: 40, total: null }] }, defaults(), info)!;
    expect(out.pallets[0]!.total).toBeCloseTo(CATS.reduce((n, c) => n + out.pallets[0]!.items[c], 0), 9);
    expect(out.nextPalletId).toBe(41);
  });

  it('worki na palecie: liczba od 1 wraca z zapisu (od SIM_VERSION 5 także ułamek, 1,5), a śmieć usuwa pole (rozładunek weźmie wtedy jeden worek)', () => {
    const s = defaults();
    const p = json(s.pallets[0]) as Record<string, unknown>;
    const bagsOf = (bags: unknown): unknown => {
      const out = sanitizeEconomy({ ...json(s), pallets: [{ ...p, bags }] }, defaults(), info)!;
      return out.pallets[0]!.bags;
    };
    expect(bagsOf(2)).toBe(2);
    expect(bagsOf(1)).toBe(1);
    expect(bagsOf(1.5)).toBe(1.5);     // zwykła paleta od SIM_VERSION 5
    expect(bagsOf(2.4)).toBe(2.4);
    expect(bagsOf(0)).toBe(1);         // od 1
    expect(bagsOf(-3)).toBe(1);
    expect(bagsOf(1e308)).toBeLessThanOrEqual(8);   // mała górna granica, nie nieskończoność
    expect(bagsOf(1e308)).toBeGreaterThanOrEqual(2);
    for (const bad of ['dwa', null, {}, [2], true]) expect('bags' in sanitizeEconomy({ ...json(s), pallets: [{ ...p, bags: bad }] }, defaults(), info)!.pallets[0]!).toBe(false);
  });

  it('paleta bez worków (zapis sprzed tej zmiany) nie dostaje pola bags, a z workami wraca co do bajta', () => {
    const s = defaults();
    const old = json(s) as { pallets: Record<string, unknown>[] };
    for (const p of old.pallets) delete p.bags;
    const out = sanitizeEconomy(old, defaults(), info)!;
    expect(out.pallets.every((p) => !('bags' in p))).toBe(true);
    expect(JSON.stringify(out.pallets)).toBe(JSON.stringify(old.pallets));
    // paleta z workami, także z polem golden, zachowuje kolejność kluczy (porównanie stanów po bajtach)
    expect(s.pallets.every((p) => typeof p.bags === 'number')).toBe(true);
    expect(JSON.stringify(sanitizeEconomy(json(s), defaults(), info))).toBe(JSON.stringify(s));
  });

  it('tryb gry po zepsuciu enuma wraca do domyślnego', () => {
    const out = sanitizeEconomy({ ...json(defaults()), order: { auto: 'tak', manual: null } }, defaults(), info)!;
    expect(out.order).toEqual({ auto: true, manual: 3 });
  });

  it('profil puli ludzi po zepsuciu wraca do domyślnego, a zmiana z ostatniej minuty do pustej', () => {
    const raw = json(defaults());
    (raw.tycoon as { staff: { profile: unknown } }).staff.profile = 'szalony';
    raw.shift = { staff: 'dwóch', human: { kasa: -1, rozladunek: 'x' }, people: 'kasa' };
    const out = sanitizeEconomy(raw, defaults(), info)!;
    expect(out.tycoon.staff.profile).toBe('kolejka');
    expect(out.shift).toEqual(defaults().shift);
    expect(sanitizeEconomy({ ...raw, shift: undefined }, defaults(), info)!.shift).toEqual(defaults().shift);
  });
});

describe('sanitizeEconomy: czego nie da się naprawić', () => {
  const broken = (patch: Record<string, unknown>): EconomyState | null => sanitizeEconomy({ ...json(defaults()), ...patch }, defaults(), info);

  it('lista tam, gdzie ma być lista, i obiekt tam, gdzie ma być obiekt', () => {
    expect(broken({ pallets: null })).toBeNull();
    expect(broken({ pallets: {} })).toBeNull();
    expect(broken({ upgrades: null })).toBeNull();
    expect(broken({ upgrades: [] })).toBeNull();
    expect(broken({ equipment: 'sco' })).toBeNull();
    expect(broken({ shelf: 'pełna' })).toBeNull();
    expect(broken({ today: null })).toBeNull();
    expect(broken({ order: 4 })).toBeNull();
  });

  it('nie to, czego szukamy: nie obiekt, zła wersja, cudzy seed', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) expect(sanitizeEconomy(raw, defaults(), info)).toBeNull();
    expect(broken({ version: 2 })).toBeNull();
    expect(broken({ version: undefined })).toBeNull();
    expect(broken({ seed: 'inny-sklep' })).toBeNull();
  });
});

// --- Absurdalne, ale skończone liczby ----------------------------------------------------------------------------

describe('sanitizeEconomy: skończone, ale absurdalne liczby (zapis ręcznie zmieniony)', () => {
  /** Stan po długiej grze z zakupami, zatrzymany tuż po porannej dostawie: ma palety, dostawy w drodze, KPI tygodnia, historię i raport. */
  const rich = (): EconomyState => {
    const s = defaults();
    s.cash = 500_000;
    s.level = 12;
    for (const id of ['ulotki', 'szkolenie', 'wozek', 'regaly', 'tasmociag', 'wykladacz', 'dostawy2'] as const) {
      s.upgrades[id] = 1;
    }
    buyEquipment(s, info, 'sco');
    buyEquipment(s, info, 'piec');
    play(s, info, 35);
    const events: EconEvent[] = [];
    for (let i = 0; i < 3 * MINUTES_PER_DAY && s.pallets.length === 0; i++) stepMinute(s, info, events);   // dostawa o 7:00
    s.deliveries.push({ at: s.minute + 600, count: 2 }, { at: s.minute + 1200, count: 3 });   // zamówienie w drodze
    expect(s.deliveries.length).toBeGreaterThan(0);
    expect(s.pallets.length).toBeGreaterThan(0);
    expect(s.history.length).toBeGreaterThan(0);
    expect(s.lastReport).not.toBeNull();
    return s;
  };
  const load = (patch: Record<string, unknown>, base: EconomyState = rich()): EconomyState => {
    const out = sanitizeEconomy({ ...json(base), ...patch }, defaults(), info);
    expect(out).not.toBeNull();
    return out!;
  };
  /** Ile dni gry minie w ułamku sekundy; zawieszenie (pętla bez końca) wywaliłoby test na limicie czasu. */
  const plays = (s: EconomyState, days = 2): void => {
    play(s, info, days);
    expect(nonFinite(s)).toEqual([]);
  };

  it('liczba palet w dostawie: 1e308 nie zawiesza deliver(), ujemna i ułamkowa też są sensowne', () => {
    const s = rich();
    const at = s.minute + 5;
    const out = load({ deliveries: [{ at, count: 1e308 }, { at: at + 1, count: -4 }, { at: at + 2, count: 2.6 }] }, s);
    expect(out.deliveries.map((d) => d.count)).toEqual([100, 0, 3]);   // największe zamówienie w grze mieści się w 100 paletach
    plays(out);
  });

  it('lista dostaw, palet, sprzętu, historii i kamieni milowych ma górną granicę (milion elementów to nie zapis)', () => {
    const s = rich();
    const big = <T>(item: T): T[] => Array.from({ length: 200_000 }, () => item);
    const out = load({
      deliveries: big({ at: s.minute + 5, count: 1 }),
      pallets: big(json(s.pallets[0])).map((p, i) => ({ ...(p as object), id: i + 1 })),
      equipment: big({ id: 'sco', slot: 'a' }),
      history: big({ label: 'x', profit: 1, revenue: 1 }),
      milestones: big('pallet1'),
    }, s);
    expect(out.deliveries.length).toBeLessThanOrEqual(8);
    expect(out.pallets.length).toBeLessThanOrEqual(256);
    expect(out.equipment.length).toBeLessThanOrEqual(64);
    expect(out.history.length).toBeLessThanOrEqual(12_000);
    expect(out.milestones.length).toBeLessThanOrEqual(200);
    expect(out.nextPalletId).toBeGreaterThan(Math.max(...out.pallets.map((p) => p.id)));
  });

  it('XP: skrajna wartość nie zawiesza processLevels (odejmowanie 120 od 1e308 niczego nie zmienia)', () => {
    for (const xp of [1e308, 1e15, Number.MAX_VALUE]) {
      const out = load({ xp });
      expect(out.xp).toBeLessThanOrEqual(3 * xpToNext(out.level));
      plays(out);
    }
  });

  it('poziom gracza: skrajny jest przycięty, a ułamkowy zaokrąglony', () => {
    expect(load({ level: 1e300 }).level).toBe(1000);
    expect(load({ level: 7.4 }).level).toBe(7);
    expect(load({ level: -5 }).level).toBe(1);
  });

  it('minuty: całkowite i w granicach tysiąca lat gry (ułamkowa minuta cicho wyłączała zamykanie dni)', () => {
    const fractional = load({ minute: 360.5 });
    expect(Number.isInteger(fractional.minute)).toBe(true);
    const before = fractional.total.wages;
    plays(fractional, 2);
    expect(fractional.total.wages).toBeGreaterThan(before);   // dzień się zamknął, pensje poszły

    const far = load({ minute: 1e308 });
    expect(far.minute).toBeLessThanOrEqual(1000 * 366 * MINUTES_PER_DAY);
    expect(Number.isNaN(dateOfDay(far.minute / MINUTES_PER_DAY).year)).toBe(false);   // kalendarz nadal poprawny
    expect(load({ minute: -50 }).minute).toBe(0);
  });

  it('znaczniki czasu: remont najwyżej tak długi jak największy w grze, kary i premie nie wybiegają w przyszłość', () => {
    const s = rich();
    const out = load({ remontUntil: 1e300, boostUntil: 1e300, lastFineAt: 1e300 }, s);
    expect(out.remontUntil).toBeLessThanOrEqual(s.minute + 4 * MINUTES_PER_DAY);
    expect(out.boostUntil).toBeLessThanOrEqual(1000 * 366 * MINUTES_PER_DAY);
    expect(out.lastFineAt).toBeLessThanOrEqual(s.minute);
    expect(load({ lastFineAt: -1e300 }, s).lastFineAt).toBe(-1e9);
    expect(load({ remontUntil: null }, s).remontUntil).toBeNull();
    const deliveries = load({ deliveries: [{ at: 1e300, count: 1 }, { at: -1e300, count: 1 }] }, s).deliveries;
    expect(deliveries.every((d) => d.at >= 0 && d.at <= 1000 * 366 * MINUTES_PER_DAY)).toBe(true);
  });

  it('paleta: sztuki w kategorii i na całej palecie nie przekraczają jednej palety, a numery i miejsca są w zakresie', () => {
    const s = rich();
    const p = json(s.pallets[0]) as Record<string, unknown>;
    const items = Object.fromEntries(CATS.map((c) => [c, 1e308]));
    const out = load({ pallets: [{ ...p, id: 1e308, spot: 1e308, items, total: 1e308, initial: 1e308, since: -1e308 }] }, s);
    const [pallet] = out.pallets;
    const sum = CATS.reduce((n, c) => n + pallet!.items[c], 0);
    expect(sum).toBeLessThanOrEqual(PALLET_ITEMS + 1);
    expect(Number.isFinite(sum) && Number.isFinite(pallet!.total)).toBe(true);
    expect(pallet!.initial).toBeLessThanOrEqual(PALLET_ITEMS + 1);
    expect(pallet!.id).toBeLessThanOrEqual(2 ** 30);
    expect(pallet!.spot).toBeLessThanOrEqual(256);
    expect(pallet!.since).toBeGreaterThanOrEqual(0);
    expect(out.nextPalletId).toBeGreaterThan(pallet!.id);
    plays(out);
  });

  it('towar na półkach i zapleczu, kolejka i ich zapasy: przycięte do wartości, które gra może osiągnąć', () => {
    const shelf = Object.fromEntries(CATS.map((c) => [c, 1e308]));
    const out = load({ shelf, backroom: shelf, queue: 1e308, arrivalAcc: 1e308, ogonkiAcc: 1e308 });
    for (const c of CATS) {
      expect(out.shelf[c]).toBeLessThanOrEqual(100_000);
      expect(out.backroom[c]).toBeLessThanOrEqual(100_000);
    }
    expect(out.queue).toBeLessThanOrEqual(1000);
    expect(out.arrivalAcc).toBeLessThanOrEqual(1);
    expect(out.ogonkiAcc).toBeLessThanOrEqual(1);
    plays(out);
  });

  it('pieniądze i liczniki: straż przed przepełnieniem na 1e60 w obie strony (1e61 i 1e308 też), a raport i historia tak samo', () => {
    const base = json(rich());
    for (const huge of [1e61, 1e308]) {
      const counters = Object.fromEntries(Object.keys(base.total as object).map((k) => [k, huge]));
      const out = load({
        cash: huge, ogonki: huge, lastDayProfit: -huge, bestDayProfit: huge,
        today: counters, month: counters, total: counters,
        history: [{ label: 'x', profit: huge, revenue: -huge }],
        lastReport: { label: 'x', comment: 'y', counters, profit: huge, cash: -huge },
      });
      expect(out.cash).toBe(1e60);
      expect(out.ogonki).toBe(1e60);
      expect(out.lastDayProfit).toBe(-1e60);
      expect(out.total.margin).toBe(1e60);
      expect(out.history[0]).toEqual({ label: 'x', profit: 1e60, revenue: -1e60 });
      expect(out.lastReport).toMatchObject({ profit: 1e60, cash: -1e60 });
      expect(nonFinite(out)).toEqual([]);
      plays(out, 1);
    }
  });

  it('sieć sklepów i numery: premia partnerska, serie numerów i hasz seeda mają granice', () => {
    const out = load({
      partner: { points: 1e308, networkIncome: 1e308, stores: 1e308 }, nextPalletId: 1e308,
      seedHash: 1e308, lastCashiers: 1e308, lastWorkers: -1e308,
    });
    expect(out.partner.points).toBeLessThanOrEqual(1e7);
    expect(out.partner.networkIncome).toBe(1e60);
    expect(out.partner.stores).toBeLessThanOrEqual(1000);
    expect(out.nextPalletId).toBeLessThanOrEqual(2 ** 30 + 1);
    expect(out.seedHash).toBeLessThanOrEqual(0xffffffff);
    expect(out.lastCashiers).toBeLessThanOrEqual(8);
    expect(out.lastWorkers).toBeGreaterThanOrEqual(0);
    plays(out, 1);
  });

  it('przegląd wszystkich liczb stanu: po wpisaniu 1e308, -1e308 albo 1e15 w dowolne pole żadna nie przekracza 1e60, a gra się toczy', () => {
    const base = rich();
    const raw = json(base);
    // ścieżki do liczb; z list bierzemy dwa pierwsze elementy (te same pola, inne wywołania)
    const paths = (v: unknown, path: (string | number)[] = []): (string | number)[][] => {
      if (typeof v === 'number') return [path];
      if (Array.isArray(v)) return v.slice(0, 2).flatMap((x, i) => paths(x, [...path, i]));
      if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => paths(x, [...path, k]));
      return [];
    };
    const withValue = (path: (string | number)[], value: number): Record<string, unknown> => {
      const copy = structuredClone(raw) as Record<string, unknown>;
      let at: any = copy;
      for (const key of path.slice(0, -1)) at = at[key];
      at[path[path.length - 1]!] = value;
      return copy;
    };
    const biggest = (v: unknown): number => {
      if (typeof v === 'number') return Math.abs(v);
      if (Array.isArray(v)) return Math.max(0, ...v.map(biggest));
      if (v && typeof v === 'object') return Math.max(0, ...Object.values(v).map(biggest));
      return 0;
    };

    const all = paths(raw).filter((p) => p[0] !== 'version');
    expect(all.length).toBeGreaterThan(150);
    const unbounded: string[] = [];
    const broken: string[] = [];
    for (const path of all) {
      for (const value of [1e308, -1e308, 1e15]) {
        const out = sanitizeEconomy(withValue(path, value), defaults(), info);
        const where = `${path.join('.')} = ${value}`;
        if (!out) { broken.push(`${where}: null`); continue; }
        if (biggest(out) > 1e60) { unbounded.push(`${where} → ${biggest(out)}`); continue; }   // bez gry: mogłaby się zawiesić
        play(out, info, 1);
        if (nonFinite(out).length > 0) broken.push(`${where}: ${nonFinite(out)[0]}`);
      }
    }
    expect(unbounded).toEqual([]);
    expect(broken).toEqual([]);
  }, 60_000);

  it('granice nie ruszają prawdziwej gry: stan z pełnymi listami wraca co do bajta', () => {
    const s = rich();
    expect(JSON.stringify(load({}, s))).toBe(JSON.stringify(s));
  });

  it('granice mają sens względem siebie', () => {
    expect(LIMITS.orderPallets).toBeGreaterThanOrEqual(30);   // zamówienie ręczne (setOrder) ma najwyżej 30 palet
    expect(LIMITS.minute).toBeLessThan(2 ** 31);              // rand01 liczy minutę jako int32
    expect(LIMITS.id).toBeLessThan(2 ** 31);
    expect(LIMITS.palletItems).toBeGreaterThan(320);
  });
});
