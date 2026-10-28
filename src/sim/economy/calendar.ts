import { MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from './catalog';

/**
 * Dzień 0 gry to 1 września 2026 (wtorek), spec §10; w dniach od 1970-01-01 to dzień 20 697.
 * Kalendarz liczy datę z liczby dni samą arytmetyką całkowitą, bez `Date`. `Date.UTC` ze stałymi to co prawda zachowanie
 * określone w ECMAScript, ale wyjątek od prostej reguły „w `src/sim` nie ma `Date`” osłabiłby ją dla pozostałych
 * strumieni, a serwer odtwarzający bieg nie powinien zależeć od żadnego API daty. Dzielenia całkowite (`Math.floor`)
 * na liczbach tej wielkości są dokładne w każdym silniku. Zgodność z `Date.UTC` dla dni −1000..80 000 dowodzi `calendar.test.ts`.
 */
const START_EPOCH_DAY = 20_697;

export const WEEKDAY_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'] as const;
export const MONTH_NAME = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień',
  'październik', 'listopad', 'grudzień'] as const;
const MONTH_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września',
  'października', 'listopada', 'grudnia'] as const;

export interface GameDate { year: number; month: number; date: number; weekday: number }

/** Data z numeru dnia gry (algorytm „civil from days” H. Hinnanta, kalendarz gregoriański; miesiące od 0, dzień tygodnia od niedzieli = 0). */
export function dateOfDay(day: number): GameDate {
  const days = START_EPOCH_DAY + Math.floor(day);   // dni od 1970-01-01
  // 1970-01-01 to czwartek (4); reszta z dzielenia może wyjść ujemna, stąd druga reszta
  const weekday = (((days + 4) % 7) + 7) % 7;
  const z = days + 719_468;   // dni od 0000-03-01, żeby rok przestępny kończył się dniem 29 lutego na końcu roku
  const era = Math.floor(z / 146_097);   // 400 lat = 146 097 dni
  const dayOfEra = z - era * 146_097;   // 0..146 096
  const yearOfEra = Math.floor((dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36_524) - Math.floor(dayOfEra / 146_096)) / 365);   // 0..399
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));   // od 1 marca, 0..365
  const mp = Math.floor((5 * dayOfYear + 2) / 153);   // miesiąc licząc od marca, 0..11
  const date = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 2 : mp - 10;   // 0 = styczeń
  return { year: yearOfEra + era * 400 + (month < 2 ? 1 : 0), month, date, weekday };
}

export function isLastDayOfMonth(day: number): boolean {
  return dateOfDay(day + 1).month !== dateOfDay(day).month;
}

export const dayOf = (minute: number): number => Math.floor(minute / MINUTES_PER_DAY);
export const minuteOfDay = (minute: number): number => minute - dayOf(minute) * MINUTES_PER_DAY;
export const isOpenAt = (mod: number): boolean => mod >= OPEN_FROM && mod < OPEN_TO;

/** „wt 1 września” */
export function formatDate(day: number): string {
  const d = dateOfDay(day);
  return `${WEEKDAY_SHORT[d.weekday]} ${d.date} ${MONTH_GENITIVE[d.month]}`;
}

/** „07:05” */
export function formatClock(minute: number): string {
  const m = Math.floor(minuteOfDay(minute));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** „wrzesień 2026” */
export function formatMonth(day: number): string {
  const d = dateOfDay(day);
  return `${MONTH_NAME[d.month]} ${d.year}`;
}
