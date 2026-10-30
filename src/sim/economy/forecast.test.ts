import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { DEBT_LIMIT, FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE } from './catalog';
import { DEBT_WARN, createEconomy, franchiseFee, type EconomyState } from './economy';
import { forecastMonth, spendCheck } from './forecast';
import { computeStoreInfo } from './storeInfo';
import { turnoverBonusShare } from './tycoon/trust';
import { WUT, wutCharge } from './tycoon/wut';

const SEED = 'kiełbasa-42';
const fresh = (): EconomyState => createEconomy(SEED, computeStoreInfo(generateStore(SEED)));

describe('forecastMonth: co Centrala zabierze przy zamknięciu miesiąca', () => {
  it('na początku miesiąca naliczona jest tylko stała część opłaty, a wolne środki to gotówka minus ona', () => {
    const s = fresh();
    s.cash = 10_000;
    const f = forecastMonth(s);
    expect(f.fee).toBe(FRANCHISE_FEE_FIXED);
    expect(f.bonus).toBe(0);
    expect(f.wut).toBe(0);
    expect(f.due).toBe(FRANCHISE_FEE_FIXED);
    expect(f.free).toBe(10_000 - FRANCHISE_FEE_FIXED);
  });

  it('opłata rośnie z obrotem dokładnie tak, jak liczy ją closeMonth (franchiseFee)', () => {
    const s = fresh();
    s.month.revenue = 690_000;
    const f = forecastMonth(s);
    expect(f.fee).toBe(franchiseFee(690_000));
    expect(f.fee).toBe(Math.round(FRANCHISE_FEE_FIXED + FRANCHISE_FEE_SHARE * 690_000));
  });

  it('premia od obrotu idzie z zaufania i obrotu jak w closeMonth i pomniejsza kwotę do oddania', () => {
    const s = fresh();
    s.month.revenue = 100_000;
    s.tycoon.trust.value = 90;
    const f = forecastMonth(s);
    expect(f.bonus).toBe(Math.round(turnoverBonusShare(90) * 100_000));
    expect(f.bonus).toBeGreaterThan(0);
    expect(f.due).toBe(f.fee + f.wut - f.bonus);

    s.tycoon.trust.value = 50;   // poniżej progu premii
    expect(forecastMonth(s).bonus).toBe(0);
  });

  it('WUT to nadwyżka ubytków ponad próg Centrali (wutCharge), bez zerowania liczników miesiąca', () => {
    const s = fresh();
    s.month.revenue = 50_000;
    s.tycoon.wut.month.termin = WUT.threshold * 50_000 + 700;   // 700 zł ponad próg
    const f = forecastMonth(s);
    expect(f.wut).toBeCloseTo(700, 6);
    expect(f.wut).toBe(wutCharge(s.tycoon.wut, 50_000));
    forecastMonth(s);
    expect(s.tycoon.wut.month.termin).toBeCloseTo(WUT.threshold * 50_000 + 700, 6);   // closeWutMonth zerowałby je przy odczycie
  });

  it('ubytki pod progiem nic nie kosztują', () => {
    const s = fresh();
    s.month.revenue = 50_000;
    s.tycoon.wut.month.termin = 100;
    expect(forecastMonth(s).wut).toBe(0);
  });

  it('przypadek z produkcji: po zakupach gotówka pozwala wejść w głęboki debet, a prognoza to pokazuje przed zakupem', () => {
    const s = fresh();
    s.month.revenue = 690_000;
    s.tycoon.trust.value = 50;
    s.cash = 5_000;   // wydano prawie wszystko, zanim przyszła opłata
    const f = forecastMonth(s);
    expect(f.due).toBeGreaterThan(100_000);
    expect(f.free).toBe(5_000 - f.due);
    expect(f.free).toBeLessThan(-100_000);   // stan, w którym właściciel zobaczył koniec gry (30.10.2026)
  });

  it('nie zmienia stanu', () => {
    const s = fresh();
    s.month.revenue = 12_345;
    const before = JSON.stringify(s);
    forecastMonth(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('spendCheck: ostrzeżenie przed wydatkiem (nigdy blokada)', () => {
  const base = (cash: number, revenue = 0): ReturnType<typeof forecastMonth> => {
    const s = fresh();
    s.cash = cash;
    s.month.revenue = revenue;
    s.tycoon.trust.value = 50;
    return forecastMonth(s);
  };

  it('cena w granicach wolnych środków: bez ostrzeżenia', () => {
    const f = base(10_000);   // wolne 8 000
    const c = spendCheck(f, 3_000);
    expect(c.level).toBe('ok');
    expect(c.freeAfter).toBe(f.free - 3_000);
  });

  it('cena równa wolnym środkom jeszcze mieści się', () => {
    const f = base(10_000);
    expect(spendCheck(f, f.free).level).toBe('ok');
  });

  it('cena ponad wolne środki, ale prognoza nad progiem ostrzeżenia: „ciasno”', () => {
    const f = base(10_000);   // wolne 8 000
    const c = spendCheck(f, 8_000 + 1_000);
    expect(c.freeAfter).toBe(-1_000);
    expect(c.freeAfter).toBeGreaterThan(DEBT_WARN);
    expect(c.level).toBe('tight');
  });

  it('prognoza po zakupie poniżej DEBT_WARN: „ostrzeżenie”', () => {
    const f = base(10_000);
    const c = spendCheck(f, f.free - DEBT_WARN + 1);   // freeAfter = DEBT_WARN − 1
    expect(c.freeAfter).toBe(DEBT_WARN - 1);
    expect(c.level).toBe('warn');
  });

  it('prognoza po zakupie poniżej DEBT_LIMIT: „koniec gry”', () => {
    const f = base(10_000);
    const c = spendCheck(f, f.free - DEBT_LIMIT + 1);   // freeAfter = DEBT_LIMIT − 1
    expect(c.freeAfter).toBe(DEBT_LIMIT - 1);
    expect(c.level).toBe('danger');
  });

  it('dokładnie na progu DEBT_LIMIT jeszcze nie kończy gry (checkDebt używa „poniżej”)', () => {
    const f = base(10_000);
    const c = spendCheck(f, f.free - DEBT_LIMIT);
    expect(c.freeAfter).toBe(DEBT_LIMIT);
    expect(c.level).toBe('warn');
  });

  it('gdy wolne środki są już ujemne, każdy wydatek przekracza je, a poziom zależy od progów', () => {
    // obrót tak duży, żeby opłata sama zjadła dwie granice debetu, bez względu na to, gdzie ją ustawiono
    const f = base(1_000, Math.ceil((2 * Math.abs(DEBT_LIMIT)) / FRANCHISE_FEE_SHARE));
    expect(f.free).toBeLessThan(DEBT_LIMIT);
    expect(spendCheck(f, 1).level).toBe('danger');
  });

  it('wydatek zerowy albo ujemny (zwrot) nie ostrzega ponad to, co już jest', () => {
    const f = base(10_000);
    expect(spendCheck(f, 0).level).toBe('ok');
    expect(spendCheck(f, -500).freeAfter).toBe(f.free + 500);
  });

  it('wszystko liczy z bieżących stałych, bez zaszytych liczb', () => {
    const f = base(10_000);
    const c = spendCheck(f, f.free - (DEBT_WARN - 1));
    expect(c.level).toBe('warn');
    expect(c.warnAt).toBe(DEBT_WARN);
    expect(c.limitAt).toBe(DEBT_LIMIT);
  });
});
