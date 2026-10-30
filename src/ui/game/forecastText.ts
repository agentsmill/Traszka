import type { MonthForecast, SpendCheck } from '@/sim/economy/forecast';
import { signedZl, zl } from './format';

/*
 * Napisy prognozy końca miesiąca: pasek (HUD) i ostrzeżenia przy zakupach. Czyste funkcje, bez interfejsu, więc testuje się je
 * bez DOM (`forecastText.test.ts`). Progi (`warnAt`, `limitAt`) przychodzą z oceny wydatku, nic nie jest tu wpisane na sztywno.
 */

/**
 * Jedno zdanie o skutku wydatku dla końca miesiąca albo `null`, gdy zakup mieści się w wolnych środkach. Kwota to prognoza po
 * rozliczeniu miesiąca (gotówka po zakupie minus to, co Centrala zabierze od obrotu do dziś), więc gracz widzi wynik, a nie regułę.
 */
export function spendWarningText(c: SpendCheck): string | null {
  const after = signedZl(c.freeAfter);
  switch (c.level) {
    case 'ok': return null;
    case 'tight': return `Ponad wolne środki: przy dotychczasowym obrocie po rozliczeniu miesiąca wyjdzie ${after}.`;
    case 'warn': return `Po rozliczeniu miesiąca wyjdzie ${after}, poniżej progu ostrzeżenia (${signedZl(c.warnAt)}).`;
    case 'danger': return `Po rozliczeniu miesiąca wyjdzie ${after}, poniżej granicy debetu (${signedZl(c.limitAt)}): Centrala wypowie umowę.`;
  }
}

/** Opis rachunku z paska (podpowiedź i `aria-label`): z czego składa się kwota do oddania i co z niej wynika dla gotówki. */
export function dueTitle(f: MonthForecast, cash: number, check: SpendCheck): string {
  const parts = [`opłata franczyzowa ${zl(f.fee)}`];
  if (f.wut > 0) parts.push(`ubytki ponad limit ${zl(f.wut)}`);
  if (f.bonus > 0) parts.push(`minus premia od obrotu ${zl(f.bonus)}`);
  const debt = check.level === 'danger'
    ? ` Poniżej granicy debetu (${signedZl(check.limitAt)}) Centrala wypowie umowę.`
    : check.level === 'warn' ? ` Blisko granicy debetu (${signedZl(check.limitAt)}).` : '';
  return `Centrala rozlicza się raz, przy zamknięciu miesiąca: ${parts.join(', ')}. Do oddania ${zl(f.due)}, liczone od obrotu do dziś, więc rośnie z każdym klientem. `
    + `Wolne środki to gotówka ${zl(cash)} minus ta kwota: ${zl(f.free)}.${debt} Stuknij po rachunek i podgląd końca miesiąca.`;
}
