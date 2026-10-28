import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import {
  COMBO_WINDOW, GIFT_FIRST, GIFT_GAP_MIN, GIFT_GAP_SPREAD, GIFT_OPEN, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO,
} from './catalog';
import { dayOf, minuteOfDay } from './calendar';
import {
  commitTap, comboMult, createEconomy, giftOpen, giftWindowFrom, nextTapStreak, scheduleGift, stepMinute, tapCombo,
  type EconEvent, type EconomyState,
} from './economy';
import { rand01 } from './rand';
import { LIMITS, sanitizeEconomy } from './sanitize';
import { computeStoreInfo } from './storeInfo';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));
const fresh = (seed = SEED): EconomyState => createEconomy(seed, info);
const json = (s: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
const step = (s: EconomyState, minutes = 1): void => {
  const events: EconEvent[] = [];
  for (let i = 0; i < minutes; i++) stepMinute(s, info, events);
};

/** Okno paczki mieści się w godzinach otwarcia: od otwarcia do ostatniej minuty, w której jeszcze zdąży trwać `GIFT_OPEN`. */
const LAST_OPENING = OPEN_TO - GIFT_OPEN;
const insideWindowRange = (minute: number): boolean => {
  const mod = minuteOfDay(minute);
  return mod >= OPEN_FROM && mod <= LAST_OPENING;
};
/**
 * Najdłuższy odstęp od wygaśnięcia okna do następnego: 899 + 1200 minut po losowaniu (`GIFT_GAP_MIN` + `GIFT_GAP_SPREAD` - 1) i do
 * 599 minut przesunięcia, gdy wylosowana minuta wypada o jedną za późno na dzień (przesunięcie na otwarcie następnego): 2698.
 */
const MAX_GIFT_GAP = GIFT_GAP_MIN + GIFT_GAP_SPREAD - 1 + (MINUTES_PER_DAY + OPEN_FROM - LAST_OPENING - 1);

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

describe('okna paczek od Centrali', () => {
  it('nowa gra: pierwsze okno paczki w GIFT_FIRST od startu, w godzinach otwarcia', () => {
    const s = fresh();
    expect(s.giftAt).toBe(s.minute + GIFT_FIRST);
    expect(s.giftAt).toBe(OPEN_FROM + GIFT_FIRST);
    expect(insideWindowRange(s.giftAt)).toBe(true);
    expect(giftOpen(s)).toBe(false);
  });

  it('giftOpen: otwarte w [giftAt, giftAt + GIFT_OPEN), nigdy po końcu gry', () => {
    const s = fresh();
    s.minute = s.giftAt - 1;
    expect(giftOpen(s)).toBe(false);
    s.minute = s.giftAt;
    expect(giftOpen(s)).toBe(true);
    s.minute = s.giftAt + GIFT_OPEN - 1;
    expect(giftOpen(s)).toBe(true);
    s.gameOver = true;
    expect(giftOpen(s)).toBe(false);
    s.gameOver = false;
    s.minute = s.giftAt + GIFT_OPEN;
    expect(giftOpen(s)).toBe(false);
  });

  it('okno bez odbioru wygasa w stepMinute i następne otwiera się 900–2698 minut po wygaśnięciu, zawsze w godzinach otwarcia', () => {
    // prawdziwe kroki: okno z nowej gry zamyka się dokładnie po GIFT_OPEN minutach
    const s = fresh();
    const first = s.giftAt;
    step(s, first - s.minute);
    expect(giftOpen(s)).toBe(true);
    step(s, GIFT_OPEN - 1);
    expect(s.minute).toBe(first + GIFT_OPEN - 1);
    expect(s.giftAt).toBe(first);
    expect(giftOpen(s)).toBe(true);
    step(s);   // minuta first + GIFT_OPEN - 1 jest ostatnią otwartą
    expect(s.minute).toBe(first + GIFT_OPEN);
    expect(s.giftAt).toBe(first);
    expect(giftOpen(s)).toBe(false);
    step(s);   // tu stepMinute widzi wygasłe okno i planuje następne
    expect(s.giftAt).toBeGreaterThanOrEqual(first + GIFT_OPEN + GIFT_GAP_MIN);
    expect(s.giftAt).toBeGreaterThan(s.minute);
    expect(giftOpen(s)).toBe(false);

    // 1000 seedów w różnych porach doby: odstęp od chwili wygaśnięcia i godziny otwarcia
    let sameDayShift = 0;
    let nextDayShift = 0;
    for (let i = 0; i < 1000; i++) {
      const e = createEconomy(`paczka-${i}`, info);
      const before = OPEN_FROM + i * 97;   // 97 i 1440 są względnie pierwsze: pory doby wypełniają całą dobę
      e.minute = before;
      e.giftAt = before - GIFT_OPEN - (i % 7);   // okno właśnie wygasło
      const oldGiftAt = e.giftAt;
      step(e);
      const raw = before + GIFT_GAP_MIN + Math.floor(rand01(e.seedHash, oldGiftAt, 30) * GIFT_GAP_SPREAD);
      expect(e.giftAt, `seed ${i}`).toBe(giftWindowFrom(raw));
      expect(raw - before, `seed ${i}`).toBeGreaterThanOrEqual(GIFT_GAP_MIN);
      expect(raw - before, `seed ${i}`).toBeLessThan(GIFT_GAP_MIN + GIFT_GAP_SPREAD);
      expect(insideWindowRange(e.giftAt), `seed ${i}: minuta dnia ${minuteOfDay(e.giftAt)}`).toBe(true);
      expect(e.giftAt, `seed ${i}`).toBeGreaterThanOrEqual(raw);   // przesunięcie nigdy nie przybliża okna
      expect(e.giftAt - before, `seed ${i}`).toBeLessThanOrEqual(MAX_GIFT_GAP);
      if (e.giftAt !== raw) {
        if (dayOf(e.giftAt) === dayOf(raw)) sameDayShift++; else nextDayShift++;
      }
    }
    expect(sameDayShift, 'okna przesunięte na otwarcie tego samego dnia').toBeGreaterThan(0);
    expect(nextDayShift, 'okna przesunięte na otwarcie następnego dnia').toBeGreaterThan(0);
  });

  it('okno niewygasłe nie jest planowane od nowa; scheduleGift liczy od bieżącej minuty', () => {
    const s = fresh();
    const first = s.giftAt;
    step(s, first + GIFT_OPEN - 1 - s.minute);
    expect(s.giftAt).toBe(first);

    const t = fresh();
    t.minute = 3000;
    t.giftAt = 100;
    scheduleGift(t);
    expect(t.giftAt).toBeGreaterThanOrEqual(3000 + GIFT_GAP_MIN);
    expect(insideWindowRange(t.giftAt)).toBe(true);
  });

  it('okna są deterministyczne: ten sam seed, te same okna', () => {
    const windows = (seed: string): number[] => {
      const s = createEconomy(seed, info);
      const out = [s.giftAt];
      for (let i = 0; i < 40; i++) {
        s.minute = s.giftAt + GIFT_OPEN;   // okno wygasa bez odbioru
        step(s);
        out.push(s.giftAt);
      }
      return out;
    };
    const a = windows('okna-1');
    expect(windows('okna-1')).toEqual(a);
    expect(new Set(a).size).toBe(a.length);   // okna się nie powtarzają
    for (let i = 1; i < a.length; i++) expect(a[i]! - a[i - 1]!, `okno ${i}`).toBeGreaterThanOrEqual(GIFT_OPEN + GIFT_GAP_MIN);
    expect(windows('okna-2')).not.toEqual(a);

    // także w prawdziwym biegu: te same decyzje (tu: żadnych), ten sam przebieg okien
    const run = (): number[] => {
      const s = createEconomy('okna-3', info);
      const seen: number[] = [s.giftAt];
      for (let i = 0; i < 6 * MINUTES_PER_DAY; i++) {
        step(s);
        if (s.giftAt !== seen[seen.length - 1]) seen.push(s.giftAt);
      }
      return seen;
    };
    const r = run();
    expect(r.length).toBeGreaterThan(2);
    expect(run()).toEqual(r);
  });

  it('giftWindowFrom: każda minuta dwóch dób ląduje w zakresie okien, a w zakresie jest tożsamością', () => {
    for (let m = 0; m < 2 * MINUTES_PER_DAY; m++) {
      const out = giftWindowFrom(m);
      expect(insideWindowRange(out), `minuta ${m} -> ${out}`).toBe(true);
      expect(out, `minuta ${m}`).toBeGreaterThanOrEqual(m);
      if (insideWindowRange(m)) expect(out, `minuta ${m}`).toBe(m);
    }
    expect(giftWindowFrom(0)).toBe(OPEN_FROM);
    expect(giftWindowFrom(OPEN_FROM - 1)).toBe(OPEN_FROM);
    expect(giftWindowFrom(LAST_OPENING)).toBe(LAST_OPENING);
    expect(giftWindowFrom(LAST_OPENING + 1)).toBe(MINUTES_PER_DAY + OPEN_FROM);
    expect(giftWindowFrom(MINUTES_PER_DAY - 1)).toBe(MINUTES_PER_DAY + OPEN_FROM);
    expect(giftWindowFrom(MINUTES_PER_DAY + OPEN_FROM - 1)).toBe(MINUTES_PER_DAY + OPEN_FROM);
  });
});

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../game/fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>;

describe('combo i okna paczek w zapisie', () => {
  const OLD_SAVES: [string, string, () => Record<string, unknown>][] = [
    ['save-v1-blok-dzien40.json', 'kiełbasa-42', () => fixture('save-v1-blok-dzien40.json')],
    ['save-v1-remont1.json', 'traszka-1', () => fixture('save-v1-remont1.json')],
    ['save-v2-dzien30.json', 'traszka-v2-a', () => fixture('save-v2-dzien30.json').econ as Record<string, unknown>],
    ['save-v2-remont2.json', 'traszka-v2-b', () => fixture('save-v2-remont2.json').econ as Record<string, unknown>],
  ];

  it('stary zapis bez pól: tapStreak 0, lastTapAt -1e9, giftAt = minuta zapisu + GIFT_FIRST', () => {
    for (const [file, seed, raw] of OLD_SAVES) {
      const save = raw();
      for (const k of ['tapStreak', 'lastTapAt', 'giftAt']) expect(k in save, `${file}: zapis sprzed L1/L3 nie ma ${k}`).toBe(false);
      const minute = save.minute as number;
      const inf = computeStoreInfo(generateStore(seed));
      const out = sanitizeEconomy(save, createEconomy(seed, inf), inf)!;
      expect(out, file).not.toBeNull();
      expect(out.tapStreak, file).toBe(0);
      expect(out.lastTapAt, file).toBe(-1e9);
      // pierwsze okno po wczytaniu: GIFT_FIRST od minuty zapisu, przesunięte w godziny otwarcia (giftWindowFrom)
      expect(out.giftAt, file).toBe(giftWindowFrom(minute + GIFT_FIRST));
      expect(out.giftAt, file).toBeGreaterThanOrEqual(minute + GIFT_FIRST);
      expect(insideWindowRange(out.giftAt), file).toBe(true);
    }
  });

  it('zapis i wczytanie w trakcie okna: okno zostaje', () => {
    const s = fresh();
    step(s, s.giftAt - s.minute + 30);   // 30 minut po otwarciu okna
    expect(giftOpen(s)).toBe(true);
    commitTap(s);
    commitTap(s);
    const back = sanitizeEconomy(json(s), fresh(), info)!;
    expect(back).toEqual(s);
    expect(giftOpen(back)).toBe(true);
    expect(back.giftAt).toBe(s.giftAt);
    expect(back.tapStreak).toBe(2);
    expect(back.lastTapAt).toBe(s.lastTapAt);
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));   // także kolejność kluczy

    // giftAt z zakresu [0, minuta + 2 doby] wraca bez zmian, także to z przyszłej doby
    const ahead = { ...json(s), giftAt: s.minute + 2 * MINUTES_PER_DAY };
    expect(sanitizeEconomy(ahead, fresh(), info)!.giftAt).toBe(s.minute + 2 * MINUTES_PER_DAY);
    expect(sanitizeEconomy({ ...json(s), giftAt: 0 }, fresh(), info)!.giftAt).toBe(0);
  });

  it('sanitize przycina combo i okno do zakresów, a nieliczbę zastępuje wartością z migracji', () => {
    const s = fresh();
    s.minute = 5000;
    const base = json(s);
    const load = (patch: Record<string, unknown>): EconomyState => sanitizeEconomy({ ...base, ...patch }, fresh(), info)!;

    expect(load({ giftAt: 1e12 }).giftAt).toBe(5000 + 2 * MINUTES_PER_DAY);
    expect(load({ giftAt: -50 }).giftAt).toBe(0);
    expect(load({ giftAt: null }).giftAt).toBe(giftWindowFrom(5000 + GIFT_FIRST));
    expect(load({ giftAt: 'jutro' }).giftAt).toBe(giftWindowFrom(5000 + GIFT_FIRST));

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
