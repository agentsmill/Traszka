import { DEBT_LIMIT } from './catalog';
import { DEBT_WARN, franchiseFee } from './economy';
import { turnoverBonusShare } from './tycoon/trust';
import { wutCharge, type WutState } from './tycoon/wut';

/**
 * Prognoza końca miesiąca: ile Centrala zabierze przy zamknięciu (`closeMonth`) i ile gotówki zostanie wolnej, zanim to
 * zabierze. Czyste liczenie ze stanu, bez zapisu i bez zegara: nie wchodzi do symulacji, więc nie zmienia biegu gry ani
 * `SIM_VERSION`. Interfejs pokazuje ją przy gotówce i przy zakupach, żeby gracz widział rachunek, zanim wyda pieniądze.
 *
 * Liczy to, co naliczyło się do tej chwili (obrót miesiąca do dziś), a nie przewidywany obrót do końca: dlatego kwota
 * „do oddania” rośnie z każdym klientem, a dochody i płace z reszty miesiąca są poza prognozą.
 */

/** Z czego liczy się prognoza (`EconomyState` spełnia ten kształt; testy podają go bez pełnego stanu). */
export interface ForecastInput {
  cash: number;
  month: { revenue: number };
  tycoon: { trust: { value: number }; wut: WutState };
}

export interface MonthForecast {
  /** Opłata franczyzowa naliczona od obrotu do dziś (stała część plus udział w obrocie). */
  fee: number;
  /** Premia Centrali od obrotu za dotychczasowy obrót (zaufanie decyduje o jej wysokości). */
  bonus: number;
  /** Ubytki ponad limit Centrali (WUT), które zapłaci franczyzobiorca, gdyby miesiąc skończył się teraz. */
  wut: number;
  /** Ile netto zejdzie przy zamknięciu miesiąca: opłata plus WUT minus premia (może być ujemne, gdy premia przewyższa resztę). */
  due: number;
  /** Wolne środki: gotówka minus to, co netto zejdzie przy zamknięciu miesiąca. Poniżej zera to debet po rozliczeniu. */
  free: number;
}

/** Rachunek końca miesiąca z obrotu i ubytków do dziś. Nie zeruje liczników (`closeWutMonth` zerowałby WUT, tu jest `wutCharge`). */
export function forecastMonth(s: ForecastInput): MonthForecast {
  const revenue = s.month.revenue;
  const fee = franchiseFee(revenue);
  const bonus = Math.round(turnoverBonusShare(s.tycoon.trust.value) * revenue);
  const wut = wutCharge(s.tycoon.wut, revenue);
  const due = fee + wut - bonus;
  return { fee, bonus, wut, due, free: s.cash - due };
}

/**
 * Jak poważny jest wydatek na tle prognozy:
 * `ok` mieści się w wolnych środkach, `tight` je przekracza, ale koniec miesiąca zostaje nad progiem ostrzeżenia,
 * `warn` zjeżdża poniżej `DEBT_WARN`, `danger` poniżej `DEBT_LIMIT` (po rozliczeniu miesiąca gra by się skończyła).
 */
export type SpendLevel = 'ok' | 'tight' | 'warn' | 'danger';

export interface SpendCheck {
  level: SpendLevel;
  /** Wolne środki po wydatku (prognoza stanu po zamknięciu miesiąca). */
  freeAfter: number;
  /** Progi, z którymi porównano (bieżące stałe gry), żeby napis nie zgadywał ich po swojemu. */
  warnAt: number;
  limitAt: number;
}

/**
 * Ocena wydatku `price` (zł z gotówki) względem prognozy. Tylko opisuje: nigdy nie blokuje zakupu, decyzja zostaje przy graczu
 * (brak gotówki na sam zakup odrzuca polecenie w symulacji, to osobna sprawa). Granica `DEBT_LIMIT` jest „poniżej”, jak
 * w `checkDebt`: dokładnie na niej gra jeszcze trwa. Wydatek zerowy albo zwrot nie jest „ciasny”, nawet gdy wolne środki są ujemne.
 */
export function spendCheck(f: MonthForecast, price: number): SpendCheck {
  const freeAfter = f.free - price;
  const level: SpendLevel = freeAfter < DEBT_LIMIT ? 'danger' : freeAfter < DEBT_WARN ? 'warn' : price > 0 && price > f.free ? 'tight' : 'ok';
  return { level, freeAfter, warnAt: DEBT_WARN, limitAt: DEBT_LIMIT };
}
