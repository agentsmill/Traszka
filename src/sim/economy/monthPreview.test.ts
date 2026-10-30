import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { DEBT_LIMIT } from './catalog';
import { advanceEconomy } from './clock';
import { applyCommand } from './commands';
import { awaitingDecision, createEconomy, stepMinute, type EconEvent, type EconomyState, type MonthReport } from './economy';
import { forecastMonth } from './forecast';
import { startMonthPreview, type MonthPreview } from './monthPreview';
import { computeStoreInfo, type StoreInfo } from './storeInfo';
import { visibleCards } from './tycoon/cards';

const SEED = 'kiełbasa-42';
const info: StoreInfo = computeStoreInfo(generateStore(SEED));
const fresh = (): EconomyState => createEconomy(SEED, info);

/** Doprowadza zadanie do końca porcjami po `chunk` minut; zwraca wynik. */
function finish(s: EconomyState, chunk: number): MonthPreview | null {
  const job = startMonthPreview(s, info);
  let guard = 0;
  while (!job.step(chunk)) if (++guard > 1e6) throw new Error('podgląd się nie kończy');
  return job.result();
}

/** „Prawdziwy” przebieg: ten sam rdzeń co gra i sędzia (`advanceEconomy`), karty z odpowiedzią domyślną, do zamknięcia miesiąca. */
function realMonthEnd(s0: EconomyState): MonthReport {
  const s = structuredClone(s0);
  const before = s.lastReport;
  const clock = { acc: 0 };
  for (let guard = 0; guard < 100_000; guard++) {
    if (s.gameOver || (s.lastReport && s.lastReport !== before)) break;
    if (awaitingDecision(s)) {
      const card = visibleCards(s.tycoon.cards, s.minute)[0]!;
      applyCommand(s, info, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
      continue;
    }
    advanceEconomy(s, info, clock, 600, []);
  }
  return s.lastReport!;
}

/** Stan w środku miesiąca: kilka dni gry już za nami (karty odpowiedziane domyślnie, jak zrobiłby bierny gracz). */
function midMonth(days: number): EconomyState {
  const s = fresh();
  const out: EconEvent[] = [];
  for (let i = 0; i < days * 1440; i++) {
    if (awaitingDecision(s)) {
      const card = visibleCards(s.tycoon.cards, s.minute)[0]!;
      applyCommand(s, info, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
    }
    stepMinute(s, info, out);
  }
  return s;
}

describe('podgląd końca miesiąca: nic nie rusza w prawdziwej grze', () => {
  it('stan i opis sklepu są po podglądzie identyczne co do bajtu', () => {
    const s = midMonth(6);
    const stateBefore = JSON.stringify(s);
    const infoBefore = JSON.stringify(info);
    const result = finish(s, 1440);
    expect(result).not.toBeNull();
    expect(JSON.stringify(s)).toBe(stateBefore);
    expect(JSON.stringify(info)).toBe(infoBefore);
  });

  it('podgląd w połowie biegu nie zmienia dalszego przebiegu (żadnego stanu globalnego): z podglądem i bez to ten sam stan i te same zdarzenia', () => {
    const play = (withPreview: boolean): { s: EconomyState; events: EconEvent[] } => {
      const s = fresh();
      const events: EconEvent[] = [];
      for (let i = 0; i < 12 * 1440; i++) {
        if (withPreview && (i === 3 * 1440 || i === 9 * 1440 + 17)) finish(s, 2000);   // dwa podglądy w różnych momentach
        if (awaitingDecision(s)) {
          const card = visibleCards(s.tycoon.cards, s.minute)[0]!;
          applyCommand(s, info, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
        }
        stepMinute(s, info, events);
      }
      return { s, events };
    };
    const a = play(true);
    const b = play(false);
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('dziennik poleceń (`answerCard` na kopii) nie przecieka: polecenia podglądu nie trafiają do prawdziwego stanu', () => {
    const s = midMonth(2);
    const cardsBefore = JSON.stringify(s.tycoon.cards);
    finish(s, 1440);
    expect(JSON.stringify(s.tycoon.cards)).toBe(cardsBefore);
    expect(s.lastReport).toBe(null);
  });
});

describe('podgląd końca miesiąca: wynik', () => {
  it('zgadza się z prawdziwym przebiegiem tym samym rdzeniem (advanceEconomy, karty domyślne) co do złotówki', () => {
    for (const days of [0, 4, 17]) {
      const s = midMonth(days);
      const preview = finish(s, 1440)!;
      const real = realMonthEnd(s);
      expect(preview.label, `dzień ${days}`).toBe(real.label);
      expect(preview.cashAfter, `dzień ${days}`).toBe(real.cash);
      expect(preview.profit, `dzień ${days}`).toBe(real.profit);
      expect(preview.revenue).toBe(real.counters.revenue);
      expect(preview.fee).toBe(real.counters.fee);
      expect(preview.wut).toBe(real.counters.wut);
      expect(preview.bonus).toBe(real.counters.bonus);
      expect(preview.wages).toBe(real.counters.wages);
      expect(preview.customers).toBe(real.counters.customers);
      expect(preview.gameOver).toBeNull();
      expect(preview.endedEarly).toBe(false);
    }
  });

  it('wynik nie zależy od wielkości porcji', () => {
    const s = midMonth(5);
    const whole = finish(s, 100_000);
    expect(finish(s, 1)).toEqual(whole);
    expect(finish(s, 240)).toEqual(whole);
    expect(finish(s, 777)).toEqual(whole);
  });

  it('opłata z podglądu to opłata od obrotu całego miesiąca, a prognoza „na dziś” jest od niej niższa (obrót jeszcze rośnie)', () => {
    const s = midMonth(10);
    const now = forecastMonth(s);
    const end = finish(s, 1440)!;
    expect(end.cashNow).toBe(s.cash);
    expect(end.fee).toBeGreaterThan(now.fee);
    expect(end.revenue).toBeGreaterThan(s.month.revenue);
    expect(end.lowestCash).toBeLessThanOrEqual(Math.min(s.cash, end.cashAfter));
  });

  it('postęp liczy dni od dziś do ostatniego dnia miesiąca', () => {
    const s = midMonth(7);   // 8. września
    const job = startMonthPreview(s, info);
    expect(job.progress()).toEqual({ day: 1, days: 23 });   // wrzesień ma 30 dni: 8.–30. września
    expect(job.result()).toBeNull();
    job.step(3 * 1440);
    expect(job.progress().day).toBeGreaterThanOrEqual(3);
    while (!job.step(1440)) { /* do końca */ }
    expect(job.progress().day).toBe(23);
    expect(job.result()).not.toBeNull();
  });

  it('wielki obrót przy pustej kasie: opłata kończy grę, podgląd mówi o debecie i podaje gotówkę po przelewie', () => {
    const s = midMonth(3);
    s.cash = 0;
    s.month.revenue = Math.ceil((2 * Math.abs(DEBT_LIMIT)) / 0.151);   // opłata ponad dwie granice debetu
    const r = finish(s, 1440)!;
    expect(r.gameOver).toBe('debt');
    expect(r.cashAfter).toBeLessThan(DEBT_LIMIT);
    expect(r.lowestCash).toBe(Math.min(r.lowestCash, r.cashAfter));
    expect(r.endedEarly).toBe(false);   // miesiąc zdążył się zamknąć: to jego opłata przekroczyła granicę
  });

  it('gra, która już się skończyła, nie ma podglądu', () => {
    const s = midMonth(1);
    s.gameOver = true;
    const job = startMonthPreview(s, info);
    expect(job.step(1440)).toBe(true);
    expect(job.result()).toBeNull();
  });
});
