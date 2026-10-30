import { describe, expect, it } from 'vitest';
import { GUARANTEE, OWN_COSTS } from '@/sim/economy/catalog';
import { WUT } from '@/sim/economy/tycoon/wut';
import { zl } from '../game/format';
import { glossary } from './glossary';
import { percent } from './howToText';

describe('słowniczek', () => {
  it('ma dokładnie hasła właściciela, w tej kolejności', () => {
    expect(glossary().map((e) => e.term)).toEqual([
      'Saldo u Centrali', 'Przelew', 'Wyciąg', 'Raty', 'Remanent', 'Ubytki', '„Zostaje Ci”', 'ZUS', 'Księgowa',
    ]);
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
