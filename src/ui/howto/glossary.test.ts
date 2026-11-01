import { afterEach, describe, expect, it } from 'vitest';
import { lang } from '@/i18n';
import { glossaryEn } from '@/i18n/en/glossary';
import { DISTRICTS } from '@/sim/city/districts';
import { GUARANTEE, OWN_COSTS } from '@/sim/economy/catalog';
import { planFor } from '@/sim/economy/franchisee';
import { WUT } from '@/sim/economy/tycoon/wut';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { PARTNER_MONTHS, PARTNER_TRUST, RELET_BUILD_DAYS, RELET_SHARE } from '@/sim/firm/commands';
import { zl } from '../game/format';
import { openingPlan, reletPlan } from '../tutorial/city';
import { glossary } from './glossary';
import { percent } from './howToText';

afterEach(() => { lang.value = 'pl'; });

describe('słowniczek', () => {
  it('ma dokładnie hasła właściciela, w tej kolejności', () => {
    expect(glossary().map((e) => e.term)).toEqual([
      'Saldo u Centrali', 'Przelew', 'Wyciąg', 'Raty', 'Remanent', 'Ubytki', '„Zostaje Ci”', 'ZUS', 'Księgowa',
      'Partner Strategiczny', 'Pakiet otwarcia', 'Lokal po Traszce', 'Zastępca', 'Dzielnica', 'Rozliczenie końcowe',
    ]);
  });

  const entry = (term: string): string => glossary().find((e) => e.term === term)!.text;

  it('hasła miasta (4a): Partner Strategiczny z progiem ze stałych gry, bez prestiżu „kolejnej Traszki”', () => {
    const text = entry('Partner Strategiczny');
    expect(text).toContain(`zysk ${PARTNER_MONTHS} miesiące z rzędu`);
    expect(text).toContain(`co najmniej ${PARTNER_TRUST}`);
    expect(text).toContain('w sezonie rankingowym nie przychodzi');
    expect(glossary().map((e) => e.text).join('\n')).not.toContain('kolejną Traszkę');
  });

  it('Pakiet otwarcia: cena urządzenia zamiast czynszu, raty i opłata z planu, brak gwarancji nowego sklepu', () => {
    const plan = openingPlan();
    const text = entry('Pakiet otwarcia');
    expect(plan.months).toBe(12);
    expect(text).toContain(`w ${plan.months} ratach z opłatą ${percent(plan.feeShare)}`);
    expect(text).toContain('zamiast czynszu');
    expect(text).toContain(`Nowy sklep nie ma gwarancji ${zl(GUARANTEE.income)}`);
  });

  it('Pakiet otwarcia mówi o obu planach rat: nowy lokal w 12, lokal po Traszce zwykle w 6 (z planu ceny po zniżce)', () => {
    const plan = reletPlan();
    expect(plan.months).toBe(6);
    expect(plan).toEqual(planFor(Math.round(Math.min(...Object.values(DISTRICTS).map((d) => d.package[0])) * RELET_SHARE / 100) * 100));
    const text = entry('Pakiet otwarcia');
    expect(text).toContain(`w ${openingPlan().months} ratach`);
    expect(text).toContain(`zwykle ${plan.months} (opłata ${percent(plan.feeShare)})`);
  });

  it('Lokal po Traszce: ułamek pakietu, dni budowy i zaufanie ze stałych gry, wyposażenie zostaje, poziom i zaufanie od nowa', () => {
    const text = entry('Lokal po Traszce');
    expect(text).toContain(`${percent(RELET_SHARE)} ceny`);
    expect(text).toContain(`${RELET_BUILD_DAYS} dni`);
    expect(text).toContain('remont, sprzęt i ulepszenia');
    expect(text).toContain('Poziom i zaufanie Centrali zaczynasz od nowa');
    expect(text).toContain(`zaufanie ${TRUST.start}`);
    expect(text).toContain(`nigdy nie ma gwarancji ${zl(GUARANTEE.income)}`);
  });

  it('Dzielnica: rytm dnia (Biurowce, Śródmieście, Dworzec) i trudni klienci obok ruchu, koszyka i ceny pakietu', () => {
    const text = entry('Dzielnica');
    expect(text).toContain('rytm dnia');
    expect(text).toContain('a nie ilu ich jest');
    expect(text).toContain('Trudni klienci');
    expect(text).toContain('koszyk klienta');
  });

  it('Zastępca, Dzielnica i Rozliczenie końcowe: pojęcia z ekranów Miasta i sklepu w tle', () => {
    expect(entry('Zastępca')).toContain('odpowiedź zaznaczoną z góry');
    for (const d of ['Osiedle', 'Śródmieście', 'Dworzec', 'Biurowce']) expect(entry('Dzielnica'), d).toContain(d);
    expect(entry('Rozliczenie końcowe')).toContain('Niespłacone raty');
    expect(entry('Rozliczenie końcowe')).toContain('ubytki od ostatniego remanentu');
  });

  it('po angielsku: te same hasła, w tej samej kolejności, w ustalonych terminach', () => {
    lang.value = 'en';
    expect(glossaryEn().length).toBe(glossary().length);
    expect(glossaryEn().slice(-6).map((e) => e.term)).toEqual(['Strategic Partner', 'Opening package', 'Ex-Traszka unit', 'Deputy', 'District', 'Final settlement']);
    const en = (term: string): string => glossaryEn().find((e) => e.term === term)!.text;
    expect(en('Strategic Partner')).toContain(`${PARTNER_MONTHS} months in a row`);
    expect(en('Strategic Partner')).toContain(`at least ${PARTNER_TRUST}`);
    expect(en('Opening package')).toContain('12 instalments with a fee of 15%');
    expect(en('Opening package')).toContain('25,000 zł');
    expect(en('Opening package')).toContain(`usually takes ${reletPlan().months} instalments (fee ${percent(reletPlan().feeShare)})`);
    expect(en('Ex-Traszka unit')).toContain(`${percent(RELET_SHARE)} of the price`);
    expect(en('Ex-Traszka unit')).toContain(`${RELET_BUILD_DAYS} days`);
    expect(en('Ex-Traszka unit')).toContain('refit, equipment and upgrades');
    expect(en('Ex-Traszka unit')).toContain(`trust ${TRUST.start}`);
    expect(en('District')).toContain('daily rhythm');
    expect(en('District')).toContain('Difficult customers');
  });

  it('ZUS zostaje skrótem, z rozwinięciem i kwotą ze stałej', () => {
    const zus = glossary().find((e) => e.term === 'ZUS')!;
    expect(zus.text).toContain('Zakład Ubezpieczeń Społecznych');
    expect(zus.text).toContain(zl(OWN_COSTS.zus));
  });

  it('liczby ze stałych: księgowa, gwarancja, plany rat, remanent', () => {
    const all = glossary().map((e) => e.text).join('\n');
    expect(all).toContain(zl(OWN_COSTS.accounting));
    expect(all).toContain(zl(GUARANTEE.income));
    expect(all).toContain('3, 6 albo 12 ratach');
    expect(all).toContain('4%, 8% albo 15%');
    expect(all).toContain('co 3 miesiące, ostatniego dnia miesiąca o 5:00');
  });

  it('bez opłaty franczyzowej i „do oddania” (zniknęły w SIM 6) i bez limitu ubytków przed pierwszym remanentem', () => {
    const all = glossary().map((e) => `${e.term} ${e.text}`).join('\n').toLowerCase();
    expect(all).not.toContain('franczyzow');
    expect(all).not.toContain('do oddania');
    expect(all).not.toContain(percent(WUT.threshold));
    expect(all).not.toMatch(/\bwut\b/);
  });
});
