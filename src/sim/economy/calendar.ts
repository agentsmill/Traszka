import { MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from './catalog';

/** Dzień 0 gry to 1 września 2026 (wtorek), spec §10. */
const START_UTC = Date.UTC(2026, 8, 1);
const DAY_MS = 86_400_000;

export const WEEKDAY_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'] as const;
export const MONTH_NAME = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień',
  'październik', 'listopad', 'grudzień'] as const;
const MONTH_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września',
  'października', 'listopada', 'grudnia'] as const;

export interface GameDate { year: number; month: number; date: number; weekday: number }

export function dateOfDay(day: number): GameDate {
  const d = new Date(START_UTC + day * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(), weekday: d.getUTCDay() };
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
