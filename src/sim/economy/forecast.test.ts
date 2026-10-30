import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { DEBT_LIMIT, GUARANTEE, OPEN_TO, OWN_COSTS } from './catalog';
import { applyCommand } from './commands';
import { DEBT_WARN, awaitingDecision, createEconomy, stepMinute, type EconEvent, type EconomyState } from './economy';
import { forecastMonth, spendCheck, type MonthForecast } from './forecast';
import { buildStatement, emptySettleMonth, installmentsDue } from './franchisee';
import { computeStoreInfo } from './storeInfo';
import { visibleCards } from './tycoon/cards';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));
const fresh = (): EconomyState => createEconomy(SEED, info);

/** Bierna gra do minuty `until` (karty z odpowiedzią domyślną). */
function playTo(s: EconomyState, until: number, out: EconEvent[] = []): EconomyState {
  while (s.minute < until) {
    if (awaitingDecision(s)) {
      const c = visibleCards(s.tycoon.cards, s.minute)[0]!;
      applyCommand(s, info, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
      continue;
    }
    stepMinute(s, info, out);
  }
  return s;
}

describe('forecastMonth: prognoza wyciągu od Centrali', () => {
  it('saldo to marża i premie z bieżącego miesiąca, raty to raty najbliższego przelewu; stan się nie zmienia', () => {
    const s = playTo(fresh(), 5 * 1440 + 12 * 60);
    applyCommand(s, info, { type: 'buyUpgrade', id: 'ulotki', raty: true });
    const before = JSON.stringify(s);
    const f = forecastMonth(s, info);
    expect(JSON.stringify(s)).toBe(before);
    expect(f.saldo).toBeCloseTo(s.franchisee.month.margin + s.franchisee.month.bonus, 6);
    expect(f.saldo).toBeGreaterThan(0);
    expect(f.installments).toBe(installmentsDue(s.franchisee));
    expect(f.installments).toBeGreaterThan(0);
    expect(f.net).toBe(f.statement.net);
    expect(f.cashAfter).toBeCloseTo(s.cash + f.net, 6);
  });

  it('w ostatniej minucie przed zamknięciem równa się prawdziwemu wyciągowi (30 września, środa: bez premii KPI w dniu zamknięcia)', () => {
    const s = playTo(fresh(), 29 * 1440 + OPEN_TO);
    const f = forecastMonth(s, info);
    const out: EconEvent[] = [];
    playTo(s, 29 * 1440 + OPEN_TO + 1, out);
    const st = out.find((e) => e.kind === 'month')!.report!.statement!;
    expect(f.statement.transfer).toBeCloseTo(st.transfer, 6);
    expect(f.statement.costs).toBe(st.costs);
    expect(f.net).toBeCloseTo(st.net, 6);
  });

  it('na początku miesiąca reszta miesiąca idzie z przewidywanej marży: prognoza przelewu jest bliska prawdziwemu (±25%)', () => {
    const s = fresh();
    const f = forecastMonth(s, info);
    const out: EconEvent[] = [];
    playTo(s, 29 * 1440 + OPEN_TO + 1, out);
    const st = out.find((e) => e.kind === 'month')!.report!.statement!;
    expect(f.statement.transfer).toBeGreaterThan(0.75 * st.transfer);
    expect(f.statement.transfer).toBeLessThan(1.25 * st.transfer);
    expect(f.statement.zus).toBe(OWN_COSTS.zus);
  });

  it('gwarancja: dopłata do 25 tys. przy słabej prognozie, w pierwszych miesiącach, bez mandatu i przy zaufaniu od progu', () => {
    const s = fresh();
    s.tycoon.trust.value = GUARANTEE.minTrust;
    s.month.margin = -1e6;   // przychód miesiąca daleko pod gwarancją
    expect(forecastMonth(s, info).statement.guarantee).toBeGreaterThan(0);
    s.month.fineCount = 1;
    expect(forecastMonth(s, info).statement.guarantee).toBe(0);
  });

  it('remanent, który jeszcze się nie odbył, nie wchodzi; nadwyżka z remanentu, który był, wchodzi do potrąceń', () => {
    const s = fresh();
    s.tycoon.wut.month.termin = 1e6;   // ukryty licznik: prognoza go nie zdradza
    expect(forecastMonth(s, info).statement.remanent).toBe(0);
    s.franchisee.remanent.pending = 4321;
    expect(forecastMonth(s, info).statement.remanent).toBe(4321);
  });
});

describe('spendCheck: ostrzeżenie przed wydatkiem (nigdy blokada)', () => {
  /** Prognoza z gotówką po zamknięciu równą `cashAfter`. */
  const forecast = (cashAfter: number): MonthForecast => {
    const statement = buildStatement({
      month: emptySettleMonth(), guarantee: 0, installments: 0, remanent: 0, spent: 0, fines: 0, other: 0, cashBefore: 0, partial: false,
    });
    return { saldo: 0, installments: 0, statement, net: statement.net, cashAfter };
  };

  it('po zakupie zostaje nad zerem: bez ostrzeżenia', () => {
    const c = spendCheck(forecast(10_000), 3_000);
    expect(c.level).toBe('ok');
    expect(c.cashAfter).toBe(7_000);
  });

  it('pod zero, ale nad progiem ostrzeżenia: „ciasno”', () => {
    expect(spendCheck(forecast(10_000), 11_000).level).toBe('tight');
  });

  it('poniżej DEBT_WARN: „ostrzeżenie”, poniżej DEBT_LIMIT: „koniec gry”, dokładnie na granicy jeszcze ostrzeżenie', () => {
    expect(spendCheck(forecast(0), -DEBT_WARN + 1).level).toBe('warn');
    expect(spendCheck(forecast(0), -DEBT_LIMIT + 1).level).toBe('danger');
    expect(spendCheck(forecast(0), -DEBT_LIMIT).level).toBe('warn');
  });

  it('wydatek zerowy albo zwrot nie jest „ciasny”, nawet przy prognozie pod zerem; progi to bieżące stałe', () => {
    expect(spendCheck(forecast(-5_000), 0).level).toBe('ok');
    expect(spendCheck(forecast(-5_000), -500).cashAfter).toBe(-4_500);
    const c = spendCheck(forecast(0), 1);
    expect(c.warnAt).toBe(DEBT_WARN);
    expect(c.limitAt).toBe(DEBT_LIMIT);
  });
});
