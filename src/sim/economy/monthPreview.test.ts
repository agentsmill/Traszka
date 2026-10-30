import { readFileSync } from 'node:fs';
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

describe('podgląd końca miesiąca: cele czekające na „Odbierz” (SIM_VERSION 5)', () => {
  it('nieodebrane cele się w podglądzie nie odbierają: wynik jak w przebiegu bez odbioru, prawdziwy stan bez zmian', () => {
    const s = midMonth(6);
    s.milestones = s.milestones.filter((id) => id !== 'pallet1' && id !== 'cust500');
    s.milestonesReady = ['pallet1', 'cust500'];
    const before = JSON.stringify(s);
    const preview = finish(s, 1440)!;
    expect(JSON.stringify(s)).toBe(before);
    // przebieg bez odbioru (karty domyślne): te same sumy miesiąca co do złotówki, także inne przychody z nagród za poziomy
    const real = realMonthEnd(s);
    expect(preview.statement.other).toBeCloseTo(real.counters.other, 6);
    expect(preview.profit).toBeCloseTo(real.profit, 6);
    // podgląd wydaje tylko odpowiedzi na karty, nigdy odbioru celu
    const source = readFileSync(new URL('./monthPreview.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/claimMilestone/);
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
      expect(preview.customers).toBe(real.counters.customers);
      // prognozowany wyciąg to ten sam wyciąg co przy zamknięciu, pozycja w pozycję
      expect(preview.statement).toEqual(real.statement);
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

  it('przelew z podglądu to przelew za cały miesiąc, więc jest większy niż saldo „na dziś” (marża jeszcze narasta)', () => {
    const s = midMonth(10);
    const now = forecastMonth(s, info);
    const end = finish(s, 1440)!;
    expect(end.cashNow).toBe(s.cash);
    expect(end.statement.transfer).toBeGreaterThan(now.saldo);
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

  it('potrącenie ponad granicę debetu przy pustej kasie: przelew kończy grę, podgląd mówi o debecie i podaje gotówkę po przelewie', () => {
    const s = midMonth(3);
    s.cash = 0;
    s.franchisee.remanent.pending = 2 * Math.abs(DEBT_LIMIT);   // nadwyżka z remanentu czeka na przelew: potrącenie ponad dwie granice debetu
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
