import type { MonthForecast, SpendCheck } from '@/sim/economy/forecast';
import { t } from '@/i18n';
import { money, signedZl, zl } from './format';

/*
 * Napisy prognozy końca miesiąca: pasek (HUD) i ostrzeżenia przy zakupach. Czyste funkcje, bez interfejsu, więc testuje się je
 * bez DOM (`forecastText.test.ts`). Progi (`warnAt`, `limitAt`) przychodzą z oceny wydatku, nic nie jest tu wpisane na sztywno.
 */

/**
 * Jedno zdanie o skutku wydatku dla gotówki po zamknięciu miesiąca albo `null`, gdy zakup nie zepchnie jej pod zero. Kwota to
 * prognoza „po zamknięciu miesiąca zostanie Ci” (gotówka plus „Zostaje Ci” minus zakup), więc gracz widzi wynik, a nie regułę.
 * `rata`: wydatek to pierwsza rata zakupu na raty (schodzi z najbliższego przelewu), a nie cena za gotówkę.
 */
export function spendWarningText(c: SpendCheck, rata = false): string | null {
  const lead = rata ? t`Po zamknięciu miesiąca, z pierwszą ratą, zostanie Ci` : t`Po zamknięciu miesiąca zostanie Ci`;
  const after = signedZl(c.cashAfter);
  switch (c.level) {
    case 'ok': return null;
    case 'tight': return t`${lead} ${after}: gotówka zejdzie pod zero.`;
    case 'warn': return t`${lead} ${after}, poniżej progu ostrzeżenia (${signedZl(c.warnAt)}).`;
    case 'danger': return t`${lead} ${after}, poniżej granicy debetu (${signedZl(c.limitAt)}): Centrala wypowie umowę.`;
  }
}

/** Czytnik ekranu na pasku: trzy liczby w jednym zdaniu (długie etykiety zniknęły z wąskiego ekranu, ten opis zostaje). */
export function forecastLabel(f: MonthForecast): string {
  return t`Saldo u Centrali ${zl(f.saldo)}, raty w tym miesiącu ${zl(f.installments)}, po zamknięciu zostanie ${signedZl(f.net)}`;
}

/**
 * Podpowiedź paska (`title`): z czego składa się każda liczba i że dokładny wyciąg jest po stuknięciu. `check` to ocena zerowego
 * wydatku (`spendCheck(f, 0)`): z niej wynika, czy dopisać bliskość granicy debetu.
 */
export function forecastTitle(f: MonthForecast, cash: number, check: SpendCheck): string {
  const debt = check.level === 'danger'
    ? t` Poniżej granicy debetu (${signedZl(check.limitAt)}) Centrala wypowie umowę.`
    : check.level === 'warn' ? t` Blisko granicy debetu (${signedZl(check.limitAt)}).` : '';
  return t`Saldo u Centrali to marża i premie naliczone w tym miesiącu (${zl(f.saldo)}): przyjdą przelewem przy zamknięciu miesiąca, a gotówka rusza się dopiero wtedy. `
    + t`Z przelewu Centrala potrąca raty (${zl(f.installments)}) i palety ponad darmowe, a Ty płacisz pensje, media, ZUS, VAT i księgową. `
    + t`Po zamknięciu miesiąca zostanie Ci ${signedZl(f.net)}, czyli gotówka ${money(f.cashAfter)} (teraz ${money(cash)}).${debt} `
    + t`To szybki szacunek z dotychczasowego obrotu. Dokładny wyciąg: stuknij.`;
}
