import { dateOfDay, isLastDayOfMonth, dayOf, minuteOfDay } from './calendar';
import { DEBT_LIMIT, GUARANTEE, OPEN_FROM, OPEN_TO, WAGE_PER_DAY } from './catalog';
import {
  DEBT_WARN, estimatedDailyMargin, estimatedDailyRevenue, mediaPerDay, type EconomyState,
} from './economy';
import { buildStatement, installmentsDue, saldoOf, type Statement } from './franchisee';
import type { StoreInfo } from './storeInfo';
import { turnoverBonusShare } from './tycoon/trust';

/**
 * Prognoza wyciągu od Centrali na koniec miesiąca (spec SIM 6, §8): to, co już naliczone (saldo, płace, media, palety), plus reszta
 * miesiąca w tempie marży i obrotu od początku miesiąca (w pierwszym dniu z przewidywań: `estimatedDailyMargin`, `estimatedDailyRevenue`),
 * płac i mediów razy dni do zamknięcia,
 * do tego premia od obrotu, dopłata z gwarancji, raty i koszty stałe. Szacunek bez symulacji (pasek liczy go co klatkę), czysta funkcja:
 * nie wchodzi do symulacji, więc nie zmienia biegu gry ani `SIM_VERSION`. Dokładny wyciąg daje podgląd końca miesiąca (`monthPreview.ts`).
 *
 * Remanent, który jeszcze się nie odbył, nie wchodzi do prognozy: jego licznik jest ukryty (gracz poznaje go przy remanencie).
 * Nadwyżka z remanentu, który już był, czeka na przelew i wchodzi.
 */

export interface MonthForecast {
  /** Saldo u Centrali teraz: marża i premie naliczone w miesiącu. */
  saldo: number;
  /** Raty do potrącenia w najbliższym przelewie. */
  installments: number;
  /** Prognozowany wyciąg na zamknięcie miesiąca. */
  statement: Statement;
  /** Prognoza „Zostaje Ci” (`statement.net`). */
  net: number;
  /** Gotówka po zamknięciu miesiąca: gotówka teraz plus „Zostaje Ci”. */
  cashAfter: number;
}

/**
 * Ile jeszcze zamknięć dnia przed zamknięciem miesiąca (z dzisiejszym, jeśli jeszcze się nie odbyło), ile dni ruchu przed nami i ile
 * już za nami (dni otwarcia od początku miesiąca, z ułamkiem dzisiejszego).
 */
function remaining(minute: number): { closes: number; days: number; elapsed: number } {
  const day = dayOf(minute);
  const mod = minuteOfDay(minute);
  let last = day;
  while (!isLastDayOfMonth(last)) last++;
  const todayClose = mod <= OPEN_TO ? 1 : 0;
  const todayOpen = Math.min(1, Math.max(0, (OPEN_TO - Math.max(mod, OPEN_FROM)) / (OPEN_TO - OPEN_FROM)));
  return { closes: last - day + todayClose, days: last - day + todayOpen, elapsed: dateOfDay(day).date - 1 + (1 - todayOpen) };
}

export function forecastMonth(s: EconomyState, info: StoreInfo): MonthForecast {
  const f = s.franchisee;
  const m = s.month;
  const { closes, days, elapsed } = remaining(s.minute);
  // reszta miesiąca w tempie od jego początku (liczniki całego miesiąca), a przed pierwszym pełnym dniem z przewidywań sklepu. Przewidywania
  // nie znają fal, rosnącej reputacji ani premii, więc z nich prognoza wychodzi ok. 10–15% za nisko; od kilku dni miesiąca tempo trafia
  // w zamknięcie z dokładnością do ok. 2–3 tys. zł (pomiar: tests/measure/forecast.measure.test.ts)
  const pace = elapsed >= 1 ? { ...m, days: elapsed } : null;
  const margin = f.month.margin + days * (pace ? pace.margin / pace.days : estimatedDailyMargin(s, info));
  const revenue = m.revenue + days * (pace ? pace.revenue / pace.days : estimatedDailyRevenue(s, info));
  const turnoverBonus = Math.round(turnoverBonusShare(s.tycoon.trust.value) * revenue);
  // premie z miesiąca (KPI tygodnia, złote palety, karty) też w tym samym tempie
  const bonus = f.month.bonus + (pace ? (pace.bonus / pace.days) * days : 0) + turnoverBonus;
  // gwarancja z liczników całego miesiąca (jak `guaranteeTopUp`), przy dzisiejszym zaufaniu i bez mandatu w miesiącu
  const income = m.margin + m.bonus + (margin - f.month.margin) + (bonus - f.month.bonus);
  const guaranteed = s.history.length < GUARANTEE.months && s.tycoon.trust.value >= GUARANTEE.minTrust && m.fineCount === 0;
  const guarantee = guaranteed ? Math.max(0, Math.round(GUARANTEE.income - income)) : 0;
  const installments = installmentsDue(f);
  const statement = buildStatement({
    month: {
      margin, bonus, pallets: f.month.pallets,
      wages: f.month.wages + closes * s.staff * WAGE_PER_DAY, media: f.month.media + closes * mediaPerDay(info),
    },
    guarantee, installments, remanent: f.remanent.pending, spent: m.investments, fines: m.fines, other: m.other, cashBefore: s.cash,
    partial: false,
  });
  return { saldo: saldoOf(f), installments, statement, net: statement.net, cashAfter: statement.cashAfter };
}

/**
 * Jak poważny jest wydatek na tle prognozy gotówki po zamknięciu miesiąca:
 * `ok` zostaje nad zerem, `tight` schodzi pod zero, ale nad progiem ostrzeżenia, `warn` poniżej `DEBT_WARN`, `danger` poniżej
 * `DEBT_LIMIT` (przy zamknięciu miesiąca gra by się skończyła).
 */
export type SpendLevel = 'ok' | 'tight' | 'warn' | 'danger';

export interface SpendCheck {
  level: SpendLevel;
  /** Gotówka po zamknięciu miesiąca po tym wydatku (prognoza). */
  cashAfter: number;
  /** Progi, z którymi porównano (bieżące stałe gry), żeby napis nie zgadywał ich po swojemu. */
  warnAt: number;
  limitAt: number;
}

/**
 * Ocena wydatku `amount` (zł z gotówki teraz albo pierwsza rata w tym przelewie) względem prognozy. Tylko opisuje: nigdy nie blokuje
 * zakupu (brak gotówki albo limitu rat odrzuca polecenie w symulacji, to osobna sprawa). Granica `DEBT_LIMIT` jest „poniżej”, jak
 * w `checkDebt`: dokładnie na niej gra jeszcze trwa. Wydatek zerowy albo zwrot nie jest „ciasny”, nawet gdy prognoza jest pod zerem.
 */
export function spendCheck(f: MonthForecast, amount: number): SpendCheck {
  const cashAfter = f.cashAfter - amount;
  const level: SpendLevel = cashAfter < DEBT_LIMIT ? 'danger' : cashAfter < DEBT_WARN ? 'warn' : amount > 0 && cashAfter < 0 ? 'tight' : 'ok';
  return { level, cashAfter, warnAt: DEBT_WARN, limitAt: DEBT_LIMIT };
}
