import { describe, expect, it } from 'vitest';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { DEBT_WARN } from '@/sim/economy/economy';
import { spendCheck, type MonthForecast } from '@/sim/economy/forecast';
import type { Statement } from '@/sim/economy/franchisee';
import { forecastLabel, forecastTitle, spendWarningText } from './forecastText';
import { money, signedZl, zl } from './format';

/** Prognoza z gotówką po zamknięciu `cashAfter` (reszta pól nie ma tu znaczenia dla ostrzeżeń). */
const forecast = (cashAfter: number, parts: Partial<MonthForecast> = {}): MonthForecast => ({
  saldo: 12_000, installments: 0, statement: {} as Statement, net: 8_000, cashAfter, ...parts,
});

describe('spendWarningText: napis ostrzeżenia przy wydatku', () => {
  it('zakup, po którym gotówka po zamknięciu zostaje nad zerem, nie ma ostrzeżenia', () => {
    expect(spendWarningText(spendCheck(forecast(8_000), 3_000))).toBeNull();
  });

  it('gotówka po zamknięciu pod zerem: mówi, ile zostanie Ci po zamknięciu miesiąca', () => {
    const c = spendCheck(forecast(8_000), 11_200);
    expect(c.level).toBe('tight');
    expect(spendWarningText(c)).toBe(`Po zamknięciu miesiąca zostanie Ci ${signedZl(-3_200)}: gotówka zejdzie pod zero.`);
  });

  it('poniżej progu ostrzeżenia: podaje próg ze stałej', () => {
    const c = spendCheck(forecast(0), -DEBT_WARN + 1);   // cashAfter = DEBT_WARN − 1
    expect(c.level).toBe('warn');
    expect(spendWarningText(c)).toBe(`Po zamknięciu miesiąca zostanie Ci ${signedZl(DEBT_WARN - 1)}, poniżej progu ostrzeżenia (${signedZl(DEBT_WARN)}).`);
  });

  it('poniżej granicy debetu: mówi o wypowiedzeniu umowy i podaje granicę ze stałej', () => {
    const c = spendCheck(forecast(0), -DEBT_LIMIT + 1);
    expect(c.level).toBe('danger');
    const text = spendWarningText(c)!;
    expect(text).toContain(`poniżej granicy debetu (${signedZl(DEBT_LIMIT)})`);
    expect(text).toContain('Centrala wypowie umowę');
    expect(text).toContain(signedZl(DEBT_LIMIT - 1));
  });

  it('wariant dla rat: kwota liczy się z pierwszą ratą i tak to brzmi', () => {
    const c = spendCheck(forecast(1_000), 4_200);
    expect(spendWarningText(c, true)).toBe(`Po zamknięciu miesiąca, z pierwszą ratą, zostanie Ci ${signedZl(-3_200)}: gotówka zejdzie pod zero.`);
    expect(spendWarningText(c)).not.toContain('z pierwszą ratą');
    const danger = spendCheck(forecast(0), -DEBT_LIMIT + 1);
    expect(spendWarningText(danger, true)).toContain('z pierwszą ratą');
    expect(spendWarningText(danger, true)).toContain('Centrala wypowie umowę');
    expect(spendWarningText(spendCheck(forecast(8_000), 1_000), true)).toBeNull();
  });
});

describe('forecastLabel i forecastTitle: opis paska z trzema kieszeniami', () => {
  it('aria-label podaje saldo, raty i prognozę „zostanie” w jednym zdaniu', () => {
    const f = forecast(10_000, { saldo: 12_345, installments: 4_500, net: 8_250 });
    expect(forecastLabel(f)).toBe(`Saldo u Centrali ${zl(12_345)}, raty w tym miesiącu ${zl(4_500)}, po zamknięciu zostanie ${signedZl(8_250)}`);
    expect(forecastLabel(forecast(0, { net: -6_500 }))).toContain(`po zamknięciu zostanie ${signedZl(-6_500)}`);
  });

  it('podpowiedź mówi, z czego składa się każda liczba, i odsyła po dokładny wyciąg', () => {
    const f = forecast(20_000, { saldo: 12_345, installments: 4_500, net: 8_250 });
    const t = forecastTitle(f, 11_750, spendCheck(f, 0));
    expect(t).toContain(`Saldo u Centrali to marża i premie naliczone w tym miesiącu (${zl(12_345)})`);
    expect(t).toContain(`raty (${zl(4_500)})`);
    expect(t).toContain('pensje, media, ZUS, VAT i księgową');
    expect(t).toContain(`zostanie Ci ${signedZl(8_250)}, czyli gotówka ${zl(20_000)} (teraz ${zl(11_750)})`);
    expect(t).toContain('Dokładny wyciąg: stuknij.');
    expect(t).not.toMatch(/opłat|Do oddania|Wolne środki/);
  });

  it('ujemna gotówka po zamknięciu ma „−”, a nie łącznik', () => {
    const f = forecast(-4_000, { net: -9_000 });
    expect(forecastTitle(f, 5_000, spendCheck(f, 0))).toContain(`czyli gotówka ${money(-4_000)} (teraz ${zl(5_000)})`);
    expect(money(-4_000)).toBe(`−${zl(4_000)}`);
  });

  it('pod granicą debetu dopisuje wypowiedzenie, nad nią (pod progiem ostrzeżenia) tylko bliskość granicy', () => {
    const danger = forecast(DEBT_LIMIT - 1);
    expect(forecastTitle(danger, 0, spendCheck(danger, 0))).toContain('Centrala wypowie umowę');
    const warn = forecast(DEBT_WARN - 1);
    const t = forecastTitle(warn, 0, spendCheck(warn, 0));
    expect(t).toContain('Blisko granicy debetu');
    expect(t).not.toContain('wypowie');
    const ok = forecast(0);
    expect(forecastTitle(ok, 0, spendCheck(ok, 0))).not.toMatch(/debetu/);
  });
});
