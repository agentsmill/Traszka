import { describe, expect, it } from 'vitest';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { DEBT_WARN } from '@/sim/economy/economy';
import { spendCheck, type MonthForecast } from '@/sim/economy/forecast';
import { dueTitle, spendWarningText } from './forecastText';
import { signedZl, zl } from './format';

/** Prognoza z wolnymi środkami `free` (reszta pól nie ma tu znaczenia). */
const forecast = (free: number, parts: Partial<MonthForecast> = {}): MonthForecast => ({ fee: 2000, bonus: 0, wut: 0, due: 2000, free, ...parts });

describe('spendWarningText: napis ostrzeżenia przy wydatku', () => {
  it('zakup mieszczący się w wolnych środkach nie ma ostrzeżenia', () => {
    expect(spendWarningText(spendCheck(forecast(8_000), 3_000))).toBeNull();
  });

  it('ponad wolne środki: mówi, ile wyjdzie po rozliczeniu miesiąca', () => {
    const c = spendCheck(forecast(8_000), 9_000);
    expect(c.level).toBe('tight');
    expect(spendWarningText(c)).toBe(`Ponad wolne środki: po rozliczeniu miesiąca wyjdzie ${signedZl(-1_000)}.`);
  });

  it('poniżej progu ostrzeżenia: podaje próg ze stałej', () => {
    const c = spendCheck(forecast(0), -DEBT_WARN + 1);   // freeAfter = DEBT_WARN − 1
    expect(c.level).toBe('warn');
    expect(spendWarningText(c)).toBe(`Po rozliczeniu miesiąca wyjdzie ${signedZl(DEBT_WARN - 1)}, poniżej progu ostrzeżenia (${signedZl(DEBT_WARN)}).`);
  });

  it('poniżej granicy debetu: mówi o wypowiedzeniu umowy i podaje granicę ze stałej', () => {
    const c = spendCheck(forecast(0), -DEBT_LIMIT + 1);
    expect(c.level).toBe('danger');
    const text = spendWarningText(c)!;
    expect(text).toContain(`poniżej granicy debetu (${signedZl(DEBT_LIMIT)})`);
    expect(text).toContain('Centrala wypowie umowę');
    expect(text).toContain(signedZl(DEBT_LIMIT - 1));
  });
});

describe('dueTitle: opis rachunku z paska', () => {
  it('na początku miesiąca: sama opłata, bez ubytków i premii', () => {
    const f = forecast(8_000);
    const t = dueTitle(f, 10_000, spendCheck(f, 0));
    expect(t).toContain(`opłata franczyzowa ${zl(2000)}`);
    expect(t).not.toContain('ubytki');
    expect(t).not.toContain('premia');
    expect(t).toContain(`Do oddania ${zl(2000)}`);
    expect(t).toContain(`gotówka ${zl(10_000)} minus ta kwota: ${zl(8_000)}`);
    expect(t).toContain('rośnie z każdym klientem');
  });

  it('z ubytkami i premią wymienia obie pozycje', () => {
    const f = forecast(1_000, { fee: 50_000, wut: 700, bonus: 2_000, due: 48_700 });
    const t = dueTitle(f, 49_700, spendCheck(f, 0));
    expect(t).toContain(`ubytki ponad limit ${zl(700)}`);
    expect(t).toContain(`minus premia od obrotu ${zl(2_000)}`);
  });

  it('pod granicą debetu dopisuje wypowiedzenie, nad nią (pod progiem ostrzeżenia) tylko bliskość granicy', () => {
    const danger = forecast(DEBT_LIMIT - 1);
    expect(dueTitle(danger, 0, spendCheck(danger, 0))).toContain('Centrala wypowie umowę');
    const warn = forecast(DEBT_WARN - 1);
    const t = dueTitle(warn, 0, spendCheck(warn, 0));
    expect(t).toContain('Blisko granicy debetu');
    expect(t).not.toContain('wypowie');
    const ok = forecast(0);
    expect(dueTitle(ok, 0, spendCheck(ok, 0))).not.toMatch(/debetu/);
  });
});
