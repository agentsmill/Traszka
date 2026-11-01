import { afterEach, describe, expect, it } from 'vitest';
import { lang } from '@/i18n';
import { glossaryEn } from '@/i18n/en/glossary';
import { GUARANTEE, OWN_COSTS } from '@/sim/economy/catalog';
import { WUT } from '@/sim/economy/tycoon/wut';
import { PARTNER_MONTHS, PARTNER_TRUST } from '@/sim/firm/commands';
import { zl } from '../game/format';
import { openingPlan } from '../tutorial/city';
import { glossary } from './glossary';
import { percent } from './howToText';

afterEach(() => { lang.value = 'pl'; });

describe('słowniczek', () => {
  it('ma dokładnie hasła właściciela, w tej kolejności', () => {
    expect(glossary().map((e) => e.term)).toEqual([
      'Saldo u Centrali', 'Przelew', 'Wyciąg', 'Raty', 'Remanent', 'Ubytki', '„Zostaje Ci”', 'ZUS', 'Księgowa',
      'Partner Strategiczny', 'Pakiet otwarcia', 'Zastępca', 'Dzielnica', 'Rozliczenie końcowe',
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

  it('Zastępca, Dzielnica i Rozliczenie końcowe: pojęcia z ekranów Miasta i sklepu w tle', () => {
    expect(entry('Zastępca')).toContain('odpowiedź zaznaczoną z góry');
    for (const d of ['Osiedle', 'Śródmieście', 'Dworzec', 'Biurowce']) expect(entry('Dzielnica'), d).toContain(d);
    expect(entry('Rozliczenie końcowe')).toContain('Niespłacone raty');
    expect(entry('Rozliczenie końcowe')).toContain('ubytki od ostatniego remanentu');
  });

  it('po angielsku: te same hasła, w tej samej kolejności, w ustalonych terminach', () => {
    lang.value = 'en';
    expect(glossaryEn().length).toBe(glossary().length);
    expect(glossaryEn().slice(-5).map((e) => e.term)).toEqual(['Strategic Partner', 'Opening package', 'Deputy', 'District', 'Final settlement']);
    const en = (term: string): string => glossaryEn().find((e) => e.term === term)!.text;
    expect(en('Strategic Partner')).toContain(`${PARTNER_MONTHS} months in a row`);
    expect(en('Strategic Partner')).toContain(`at least ${PARTNER_TRUST}`);
    expect(en('Opening package')).toContain('12 instalments with a fee of 15%');
    expect(en('Opening package')).toContain('25,000 zł');
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
