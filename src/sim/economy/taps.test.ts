import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { CATS, COMBO_WINDOW, MINUTES_PER_DAY, OPEN_TO, TAP_ITEMS, TILL_RATE, TILL_TAP_QUEUE_MIN, type Cat } from './catalog';
import { applyCommand } from './commands';
import {
  commitTap, comboMult, createEconomy, nextTapStreak, stepMinute, tapCombo, tapPallet, tapTill, tillTapBlock,
  type CommandResult, type EconEvent, type EconomyState,
} from './economy';
import { LIMITS, sanitizeEconomy } from './sanitize';
import { computeStoreInfo } from './storeInfo';
import { FATIGUE, fatigueEfficiency } from './tycoon/fatigue';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));
const fresh = (seed = SEED): EconomyState => createEconomy(seed, info);
const json = (s: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
const step = (s: EconomyState, minutes = 1): void => {
  const events: EconEvent[] = [];
  for (let i = 0; i < minutes; i++) stepMinute(s, info, events);
};
const value = (r: CommandResult): number => (r.ok ? r.value ?? 0 : 0);

describe('combo z czasu gry', () => {
  it('combo: 1..3 stuknięcie ×1, 4. ×2, 8. ×3, 16. i dalej ×5; przerwa > COMBO_WINDOW zaczyna od 1', () => {
    const s = fresh();
    expect(s.tapStreak).toBe(0);
    expect(s.lastTapAt).toBe(-1e9);

    const mults: number[] = [];
    for (let n = 1; n <= 20; n++) {
      const streak = nextTapStreak(s);
      expect(streak, `stuknięcie ${n}`).toBe(n);
      mults.push(comboMult(streak));
      commitTap(s);
      expect(s.tapStreak).toBe(streak);
      expect(s.lastTapAt).toBe(s.minute);
      s.minute += 1;   // szybkie stukanie: minuta gry między stuknięciami
    }
    expect(mults.slice(0, 3)).toEqual([1, 1, 1]);
    expect(mults[3]).toBe(2);   // 4.
    expect(mults[7]).toBe(3);   // 8.
    expect(mults[11]).toBe(4);  // 12.
    expect(mults[15]).toBe(5);  // 16.
    expect(mults.slice(15)).toEqual([5, 5, 5, 5, 5]);
    expect(Math.max(...mults)).toBe(5);

    // odstęp równy oknu jeszcze podtrzymuje serię, o minutę dłuższy zaczyna od nowa
    const kept = fresh();
    commitTap(kept);
    kept.minute += COMBO_WINDOW;
    expect(nextTapStreak(kept)).toBe(2);
    kept.minute += 1;
    expect(nextTapStreak(kept)).toBe(1);

    s.minute += COMBO_WINDOW - 1;   // od ostatniego stuknięcia minęło dokładnie COMBO_WINDOW
    expect(nextTapStreak(s)).toBe(21);
    s.minute += 1;
    expect(nextTapStreak(s)).toBe(1);
    commitTap(s);
    expect(s.tapStreak).toBe(1);
  });

  it('comboMult: ×1 do 3 stuknięć, co 4 o jeden wyżej, nie więcej niż ×5', () => {
    expect([0, 1, 3, 4, 7, 8, 11, 12, 15, 16, 17, 100, 1e9].map(comboMult)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5]);
  });

  it('tapCombo wygasa po COMBO_WINDOW minutach', () => {
    const s = fresh();
    expect(tapCombo(s)).toEqual({ count: 0, mult: 1 });   // nowa gra: lastTapAt -1e9
    for (let i = 0; i < 4; i++) commitTap(s);
    expect(tapCombo(s)).toEqual({ count: 4, mult: 2 });
    s.minute += COMBO_WINDOW;
    expect(tapCombo(s)).toEqual({ count: 4, mult: 2 });
    s.minute += 1;
    expect(tapCombo(s)).toEqual({ count: 0, mult: 1 });
  });

  it('seria liczy się w minutach gry: stepMinute ją wygasza bez udziału zegara', () => {
    const s = fresh();
    commitTap(s);
    commitTap(s);
    expect(tapCombo(s).count).toBe(2);
    step(s, COMBO_WINDOW);
    expect(tapCombo(s).count).toBe(2);
    step(s);
    expect(tapCombo(s)).toEqual({ count: 0, mult: 1 });
  });
});


describe('siły franczyzobiorcy przy stukaniu', () => {
  /** Otwarty sklep (6:00 pierwszego dnia) z kolejką `queue` klientów i pełną pulą sił. */
  /** Kolejka bez kasjera: stukanie zawsze pomaga (kiedy pomaga przy kasjerze, sprawdza `tillTapBlock` niżej). */
  const withQueue = (queue: number): EconomyState => {
    const s = fresh();
    s.queue = queue;
    s.lastCashiers = 0;
    return s;
  };
  const refusalText = (r: CommandResult): string => (r.ok ? '' : r.text);
  /** Paleta, na którą nie ma miejsca: zaplecze zapchane, a półki pełne (w kategoriach `onlyCats`; domyślnie we wszystkich). */
  const noRoom = (s: EconomyState, onlyCats: readonly Cat[] = CATS): void => {
    for (const c of CATS) s.backroom[c] = 1e4;
    for (const c of onlyCats) s.shelf[c] = info.shelfCap[c];
  };
  const emptyBackroom = (s: EconomyState): void => { for (const c of CATS) s.backroom[c] = 0; };

  it('50 stuknięć w kasę zużywa pulę, 51. to odmowa rąk', () => {
    const s = withQueue(60);
    for (let i = 1; i <= 50; i++) expect(tapTill(s, info, 1).ok, `stuknięcie ${i}`).toBe(true);
    expect(s.tycoon.fatigue.energy).toBe(0);
    expect(s.queue).toBeCloseTo(10, 6);
    expect(s.total.taps).toBe(50);

    const cash = s.cash;
    const r = tapTill(s, info, 1);
    expect(r.ok).toBe(false);
    expect(refusalText(r)).toContain('Ręce odmawiają');
    expect(s.cash).toBe(cash);
    expect(s.queue).toBeCloseTo(10, 6);
    expect(s.total.taps).toBe(50);
    expect(s.tycoon.fatigue.refusedToday).toBe(1);
  });

  it('odmowa rąk nie podtrzymuje combo', () => {
    const s = withQueue(60);
    emptyBackroom(s);
    s.tycoon.fatigue.energy = 0;
    s.tapStreak = 7;
    s.lastTapAt = s.minute - 3;
    for (const cmd of [{ type: 'tapTill' }, { type: 'tapPallet' }] as const) {
      const out = applyCommand(s, info, cmd);
      expect(out.result.ok, cmd.type).toBe(false);
      expect(refusalText(out.result), cmd.type).toContain('Ręce odmawiają');
      expect(s.tapStreak, cmd.type).toBe(7);
      expect(s.lastTapAt, cmd.type).toBe(s.minute - 3);
    }
  });

  it('stuknięcie w zamknięty sklep nie zużywa sił', () => {
    const s = withQueue(5);
    s.minute = 3 * 60;   // 3:00: sklep zamknięty, choć kolejka (zepsuta ręką) stoi
    expect(tapTill(s, info, 1).ok).toBe(false);
    expect(s.tycoon.fatigue.energy).toBe(100);
    expect(s.tycoon.fatigue.refusedToday).toBe(0);
    expect(s.queue).toBe(5);
  });

  it('nikt nie czeka przy kasie: odmowa bez zużycia sił', () => {
    const s = withQueue(0.9);
    const r = tapTill(s, info, 3);
    expect(r.ok).toBe(false);
    expect(refusalText(r)).toContain('Nikt nie czeka');
    expect(s.tycoon.fatigue).toEqual(fresh().tycoon.fatigue);
  });

  it('brak palety nie zużywa sił', () => {
    const s = fresh();
    s.pallets = [];
    const r = tapPallet(s, info, undefined, 2);
    expect(r.ok).toBe(false);
    expect(refusalText(r)).toContain('Brak palet');
    expect(tapPallet(s, info, 999, 2).ok).toBe(false);   // takiej palety nie ma
    expect(s.tycoon.fatigue.energy).toBe(100);
    expect(s.tycoon.fatigue.refusedToday).toBe(0);
  });

  it('paleta bez miejsca nie zużywa sił', () => {
    const s = fresh();
    noRoom(s);
    const before = s.pallets.map((p) => p.total);
    const r = tapPallet(s, info, undefined, 1);
    expect(r.ok).toBe(false);
    expect(refusalText(r)).toContain('nie ma gdzie wyłożyć');
    expect(s.tycoon.fatigue.energy).toBe(100);
    expect(s.tycoon.fatigue.tapsToday).toBe(0);
    expect(s.tycoon.fatigue.refusedToday).toBe(0);
    expect(s.pallets.map((p) => p.total)).toEqual(before);
    expect(s.total.taps).toBe(0);
  });

  it('miejsce na palecie liczą tylko półki kategorii, które na niej leżą', () => {
    const s = fresh();
    const p = s.pallets[0]!;
    const only = CATS[0]!;
    for (const c of CATS) p.items[c] = 0;
    p.items[only] = 100;
    p.total = 100;
    noRoom(s, [only]);   // półka tej kategorii pełna, pozostałe puste, ale z palety nic na nie nie trafi
    expect(tapPallet(s, info, p.id, 1).ok).toBe(false);
    expect(s.tycoon.fatigue.energy).toBe(100);

    s.shelf[only] = info.shelfCap[only] - 20;   // 20 sztuk miejsca na półce kategorii z palety
    const r = tapPallet(s, info, p.id, 1);
    expect(r.ok).toBe(true);
    expect(value(r)).toBeCloseTo(8, 6);
    expect(s.tycoon.fatigue.energy).toBe(100 - FATIGUE.tapCost.paleta);
  });

  it('pusta pula: stuknięcie w paletę to odmowa rąk, towar zostaje na palecie', () => {
    const s = fresh();
    emptyBackroom(s);
    s.tycoon.fatigue.energy = 1;
    const p = s.pallets[0]!;
    const total = p.total;
    const r = tapPallet(s, info, p.id, 1);
    expect(r.ok).toBe(false);
    expect(refusalText(r)).toContain('Ręce odmawiają');
    expect(p.total).toBe(total);
    expect(s.total.taps).toBe(0);
    expect(s.tycoon.fatigue.energy).toBe(1);
    expect(s.tycoon.fatigue.refusedToday).toBe(1);
  });

  it('combo mnoży sztuki z palety i koszt po równo', () => {
    const a = fresh();
    const b = fresh();
    emptyBackroom(a);
    emptyBackroom(b);
    const one = value(tapPallet(a, info, undefined, 1));
    const three = value(tapPallet(b, info, undefined, 3));
    expect(one).toBeCloseTo(TAP_ITEMS, 6);
    expect(three).toBeCloseTo(one * 3, 6);
    expect(a.tycoon.fatigue.energy).toBe(100 - FATIGUE.tapCost.paleta);
    expect(b.tycoon.fatigue.energy).toBe(100 - 3 * FATIGUE.tapCost.paleta);
    expect(a.tycoon.fatigue.tapsToday).toBe(1);
    expect(b.tycoon.fatigue.tapsToday).toBe(3);
    expect(b.total.taps).toBe(1);   // licznik zleceń liczy polecenia, a nie stuknięcia z combo
  });

  it('combo w kasie obsługuje kilku klientów naraz za tyle samo sił na klienta', () => {
    const s = withQueue(20);
    const r = tapTill(s, info, 4);
    expect(r.ok).toBe(true);
    expect(s.queue).toBeCloseTo(16, 6);
    expect(s.tycoon.fatigue.energy).toBe(100 - 4 * FATIGUE.tapCost.kasa);
  });

  it('pula przycina combo: tyle stuknięć, na ile starcza sił', () => {
    const s = fresh();
    emptyBackroom(s);
    s.tycoon.fatigue.energy = 2 * FATIGUE.tapCost.paleta;
    expect(value(tapPallet(s, info, undefined, 5))).toBeCloseTo(2 * TAP_ITEMS, 6);
    expect(s.tycoon.fatigue.energy).toBe(0);

    const t = withQueue(20);
    t.tycoon.fatigue.energy = 3;
    expect(tapTill(t, info, 5).ok).toBe(true);
    expect(t.queue).toBeCloseTo(19, 6);   // 3 siły to jedno stuknięcie w kasę za 2
    expect(t.tycoon.fatigue.energy).toBe(1);
  });

  it('combo nie płaci za ponad to, co da się obsłużyć: kolejka 1 przy ×5 to jedno stuknięcie', () => {
    const s = withQueue(1);
    s.tapStreak = 15;   // następne stuknięcie to 16. w serii: combo ×5
    s.lastTapAt = s.minute;
    const served = s.total.customers;
    const out = applyCommand(s, info, { type: 'tapTill' });
    expect(out.result.ok).toBe(true);
    expect(s.tapStreak).toBe(16);
    expect(s.total.customers - served).toBeCloseTo(1, 6);
    expect(s.queue).toBeCloseTo(0, 6);
    expect(s.tycoon.fatigue.energy).toBe(100 - FATIGUE.tapCost.kasa);
    expect(s.tycoon.fatigue.tapsToday).toBe(1);

    const t = withQueue(2.5);   // 2,5 klienta to trzy stuknięcia, nie pięć
    expect(tapTill(t, info, 5).ok).toBe(true);
    expect(t.queue).toBeCloseTo(0, 6);
    expect(t.tycoon.fatigue.energy).toBe(100 - 3 * FATIGUE.tapCost.kasa);
  });

  it('zmęczenie przeniesione zwiększa liczbę stuknięć potrzebnych na kolejkę', () => {
    const s = withQueue(2);
    s.tycoon.fatigue.carried = 30;   // moc 0,82 na stuknięcie: dwóch klientów to 3 stuknięcia
    expect(tapTill(s, info, 5).ok).toBe(true);
    expect(s.queue).toBeCloseTo(0, 6);
    expect(s.tycoon.fatigue.energy).toBe(100 - 3 * FATIGUE.tapCost.kasa);
  });

  it('combo nie płaci za ponad to, co zostało na palecie: 3 sztuki przy ×5 to jedno stuknięcie', () => {
    const s = fresh();
    emptyBackroom(s);
    const p = s.pallets[0]!;
    for (const c of CATS) p.items[c] = 0;
    p.items.napoje = 3;
    p.total = 3;
    s.tapStreak = 15;
    s.lastTapAt = s.minute;
    const out = applyCommand(s, info, { type: 'tapPallet', palletId: p.id });
    expect(out.result.ok).toBe(true);
    expect(value(out.result)).toBeCloseTo(3, 6);
    expect(s.tapStreak).toBe(16);
    expect(s.tycoon.fatigue.energy).toBe(100 - FATIGUE.tapCost.paleta);
    expect(s.tycoon.fatigue.tapsToday).toBe(1);
  });

  it('combo jest też przycięte miejscem: 12 sztuk wolnego miejsca przy ×5 to dwa stuknięcia', () => {
    const s = fresh();
    const p = s.pallets[0]!;
    const only = CATS[0]!;
    for (const c of CATS) p.items[c] = 0;
    p.items[only] = 100;
    p.total = 100;
    noRoom(s, [only]);
    s.shelf[only] = info.shelfCap[only] - 12;
    const r = tapPallet(s, info, p.id, 5);
    expect(value(r)).toBeCloseTo(12, 6);
    expect(s.tycoon.fatigue.energy).toBe(100 - 2 * FATIGUE.tapCost.paleta);
  });

  it('paleta, z której zmieści się ułamek sztuki, to odmowa przed zużyciem sił', () => {
    const s = fresh();
    const p = s.pallets[0]!;
    const [full, almostEmpty] = [CATS[0]!, CATS[1]!];
    for (const c of CATS) p.items[c] = 0;
    p.items[full] = 100;           // ta kategoria nie ma miejsca na półce
    p.items[almostEmpty] = 0.01;   // ta ma całą wolną półkę, ale na palecie jest jej prawie nic
    p.total = 100.01;
    noRoom(s, [full]);
    s.shelf[almostEmpty] = 0;
    const before = JSON.stringify(s.pallets);
    const r = tapPallet(s, info, p.id, 5);
    expect(r.ok).toBe(false);
    expect(refusalText(r)).toContain('nie ma gdzie wyłożyć');
    expect(s.tycoon.fatigue.energy).toBe(100);
    expect(s.tycoon.fatigue.tapsToday).toBe(0);
    expect(s.tycoon.fatigue.refusedToday).toBe(0);
    expect(JSON.stringify(s.pallets)).toBe(before);
  });

  it('wózek z ulepszeń mnoży sztuki z palety', () => {
    const s = fresh();
    emptyBackroom(s);
    s.upgrades.wozek = 2;
    expect(value(tapPallet(s, info, undefined, 1))).toBeCloseTo(TAP_ITEMS * 1.5, 6);
  });

  it('noc oddaje 70 sił', () => {
    const s = fresh();
    s.tycoon.fatigue.energy = 0;
    step(s, OPEN_TO - s.minute + 1);   // minuta 23:00 zamyka dzień
    expect(s.tycoon.fatigue.energy).toBe(FATIGUE.nightRecovery);
    expect(s.tycoon.fatigue.energy).toBe(70);
    expect(s.tycoon.fatigue.carried).toBe(30);
    expect(s.tycoon.fatigue.exhaustedDays).toBe(1);
    expect(s.tycoon.fatigue.refusedToday).toBe(0);
  });

  it('nietknięta pula po nocy jest pełna, a dzień bez stukania nie męczy', () => {
    const s = fresh();
    step(s, OPEN_TO - s.minute + 1);
    expect(s.tycoon.fatigue.energy).toBe(FATIGUE.pool);
    expect(s.tycoon.fatigue.carried).toBe(0);
    expect(s.tycoon.fatigue.exhaustedDays).toBe(0);
  });

  it('zmęczenie przeniesione obniża moc: następnego dnia kasa obsługuje 0,82 klienta', () => {
    const s = fresh();
    s.tycoon.fatigue.energy = 0;
    step(s, MINUTES_PER_DAY + 10 * 60 - s.minute);   // następny dzień, 10:00
    expect(s.tycoon.fatigue.carried).toBe(30);
    expect(fatigueEfficiency(s.tycoon.fatigue)).toBeCloseTo(0.82, 6);

    s.queue = 5;
    const served = s.total.customers;
    expect(tapTill(s, info, 1).ok).toBe(true);
    expect(s.total.customers - served).toBeCloseTo(0.82, 6);
    expect(s.queue).toBeCloseTo(5 - 0.82, 6);
  });

  it('zmęczenie przeniesione zmniejsza też sztuki z palety', () => {
    const s = fresh();
    emptyBackroom(s);
    s.tycoon.fatigue.carried = 30;
    expect(value(tapPallet(s, info, undefined, 1))).toBeCloseTo(TAP_ITEMS * 0.82, 6);
  });

  it('bzdura zamiast combo to jedno stuknięcie, bez NaN w stanie', () => {
    for (const combo of [NaN, Infinity, -3, 0, 1e9]) {
      const s = withQueue(10);
      emptyBackroom(s);
      expect(tapTill(s, info, combo).ok, `kasa ${combo}`).toBe(true);
      expect(tapPallet(s, info, undefined, combo).ok, `paleta ${combo}`).toBe(true);
      const f = s.tycoon.fatigue;
      expect(Object.values(f).every(Number.isFinite), `siły przy combo ${combo}`).toBe(true);
      expect(Number.isFinite(s.cash) && Number.isFinite(s.queue), `stan przy combo ${combo}`).toBe(true);
      expect(f.tapsToday).toBe(combo === 1e9 ? FATIGUE.maxCombo * 2 : 2);
    }
  });

  it('polecenia: combo z serii mnoży stuknięcie i koszt, a udane stuknięcie podtrzymuje serię', () => {
    const s = withQueue(60);
    s.tapStreak = 3;           // następne stuknięcie to 4. w serii: ×2
    s.lastTapAt = s.minute;
    const out = applyCommand(s, info, { type: 'tapTill' });
    expect(out.result.ok).toBe(true);
    expect(s.tapStreak).toBe(4);
    expect(s.tycoon.fatigue.energy).toBe(100 - 2 * FATIGUE.tapCost.kasa);
    expect(s.queue).toBeCloseTo(58, 6);
  });

  it('zapis w trakcie dnia zachowuje siły co do bajta', () => {
    const s = withQueue(60);
    for (let i = 0; i < 17; i++) applyCommand(s, info, { type: 'tapTill' });
    s.tycoon.fatigue.carried = 12;
    const f = s.tycoon.fatigue;
    expect(f.energy).toBeLessThan(100);
    expect(f.tapsToday).toBeGreaterThan(0);
    const back = sanitizeEconomy(json(s), fresh(), info)!;
    expect(back.tycoon.fatigue).toEqual(f);
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
  });
});

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../game/fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;

describe('stukanie w kasę tylko wtedy, gdy pomaga (decyzja właściciela z 29.10.2026)', () => {
  const ready = (queue: number, cashiers: number): EconomyState => {
    const s = fresh();
    s.queue = queue;
    s.lastCashiers = cashiers;
    return s;
  };

  it('kasjer nadąża: odmowa z powodem i bez zużycia sił', () => {
    const s = ready(TILL_RATE * TILL_TAP_QUEUE_MIN, 1);   // kolejka dokładnie na granicy: kasjer obsłuży ją w czasie progu
    expect(tillTapBlock(s, info)).toBe('Kasjer nadąża z kolejką.');
    const r = tapTill(s, info);
    expect(r.ok).toBe(false);
    expect(s.tycoon.fatigue.energy).toBe(FATIGUE.pool);
  });

  it('kolejka przerasta kasjerów albo przy kasie nikogo nie ma: stukanie działa', () => {
    expect(tillTapBlock(ready(TILL_RATE * TILL_TAP_QUEUE_MIN + 0.5, 1), info)).toBeNull();
    expect(tillTapBlock(ready(1, 0), info)).toBeNull();
    // dwóch kasjerów obsługuje dwa razy więcej: ta sama kolejka już ich nie przerasta
    expect(tillTapBlock(ready(TILL_RATE * TILL_TAP_QUEUE_MIN + 0.5, 2), info)).toBe('Kasjer nadąża z kolejką.');
    const s = ready(10, 1);
    expect(tapTill(s, info).ok).toBe(true);
    expect(s.queue).toBeCloseTo(9, 6);
  });

  it('pusta kolejka i sklep zamknięty mają własne powody', () => {
    expect(tillTapBlock(ready(0, 0), info)).toBe('Nikt nie czeka przy kasie.');
    const closed = ready(10, 0);
    closed.minute = OPEN_TO + 5;
    expect(tillTapBlock(closed, info)).toBe('Sklep zamknięty.');
  });
});

describe('combo w zapisie', () => {
  const OLD_SAVES: [string, string, () => Record<string, unknown>][] = [
    ['save-v1-blok-dzien40.json', 'kiełbasa-42', () => fixture('save-v1-blok-dzien40.json')],
    ['save-v1-remont1.json', 'traszka-1', () => fixture('save-v1-remont1.json')],
    ['save-v2-dzien30.json', 'traszka-v2-a', () => fixture('save-v2-dzien30.json').econ as Record<string, unknown>],
    ['save-v2-remont2.json', 'traszka-v2-b', () => fixture('save-v2-remont2.json').econ as Record<string, unknown>],
  ];

  it('stary zapis bez pól: tapStreak 0, lastTapAt -1e9, siły pełne', () => {
    for (const [file, seed, raw] of OLD_SAVES) {
      const save = raw();
      for (const k of ['tapStreak', 'lastTapAt']) expect(k in save, `${file}: zapis sprzed L1 nie ma ${k}`).toBe(false);
      const inf = computeStoreInfo(generateStore(seed));
      const out = sanitizeEconomy(save, createEconomy(seed, inf), inf)!;
      expect(out, file).not.toBeNull();
      expect(out.tapStreak, file).toBe(0);
      expect(out.lastTapAt, file).toBe(-1e9);
      expect(out.tycoon.fatigue.energy, file).toBe(FATIGUE.pool);
      expect(out.tycoon.fatigue.carried, file).toBe(0);
    }
  });

  it('zapis i wczytanie z combo w toku: seria wraca co do bajta', () => {
    const s = fresh();
    commitTap(s);
    commitTap(s);
    const back = sanitizeEconomy(json(s), fresh(), info)!;
    expect(back).toEqual(s);
    expect(back.tapStreak).toBe(2);
    expect(back.lastTapAt).toBe(s.lastTapAt);
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));   // także kolejność kluczy
  });

  it('sanitize przycina combo do zakresów, a nieliczbę zastępuje wartością z migracji', () => {
    const s = fresh();
    s.minute = 5000;
    const base = json(s);
    const load = (patch: Record<string, unknown>): EconomyState => sanitizeEconomy({ ...base, ...patch }, fresh(), info)!;

    expect(load({ tapStreak: -3 }).tapStreak).toBe(0);
    expect(load({ tapStreak: 1e12 }).tapStreak).toBe(LIMITS.id);
    expect(load({ tapStreak: 4.6 }).tapStreak).toBe(5);
    expect(load({ tapStreak: null }).tapStreak).toBe(0);

    expect(load({ lastTapAt: 1e12 }).lastTapAt).toBe(5000);
    expect(load({ lastTapAt: -1e300 }).lastTapAt).toBe(-1e9);
    expect(load({ lastTapAt: 'wczoraj' }).lastTapAt).toBe(-1e9);
    expect(load({ lastTapAt: 4990 }).lastTapAt).toBe(4990);
  });
});
