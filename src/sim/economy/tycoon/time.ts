import { MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from '../catalog';

/**
 * Czas gry bez `Date`: dzień, minuta dnia, dzień tygodnia i data liczone arytmetyką od dnia 0, czyli wtorku 1 września
 * 2026 (jak w `calendar.ts`). Moduły tycoona nie importują `calendar.ts`, bo ten liczy daty przez `Date`; test sprawdza,
 * że oba dają to samo.
 */

export const dayOfMinute = (minute: number): number => Math.floor(minute / MINUTES_PER_DAY);
export const minuteInDay = (minute: number): number => minute - dayOfMinute(minute) * MINUTES_PER_DAY;
export const isOpenMinute = (mod: number): boolean => mod >= OPEN_FROM && mod < OPEN_TO;

/** Minut otwarcia w ciągu doby (6:00–23:00). */
export const OPEN_MINUTES = OPEN_TO - OPEN_FROM;

/** 0 = niedziela … 6 = sobota (jak `getUTCDay`). Dzień 0 to wtorek. */
export const weekdayOf = (day: number): number => (((day + 2) % 7) + 7) % 7;
export const isSunday = (day: number): boolean => weekdayOf(day) === 0;

const START_YEAR = 2026;
const START_MONTH = 8;
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthLength = (y: number, m: number): number => (m === 1 && isLeap(y) ? 29 : MONTH_DAYS[m]);
/** Dni od 1 września roku `y` do 1 września roku `y + 1` (luty wypada w roku `y + 1`). */
const yearFromSeptember = (y: number): number => (isLeap(y + 1) ? 366 : 365);

export interface DayDate { year: number; month: number; date: number }

/** Rok, miesiąc (0–11) i dzień miesiąca dla dnia gry ≥ 0. */
export function dateOfGameDay(day: number): DayDate {
  let d = Math.max(0, Math.floor(day));
  let y = START_YEAR;
  while (d >= yearFromSeptember(y)) d -= yearFromSeptember(y++);
  let m = START_MONTH;
  while (d >= monthLength(y, m)) {
    d -= monthLength(y, m);
    m++;
    if (m === 12) { m = 0; y++; }
  }
  return { year: y, month: m, date: d + 1 };
}

export const isMonthEnd = (day: number): boolean => dateOfGameDay(day + 1).month !== dateOfGameDay(day).month;

/** Ile dni miesiąca zostało razem z dniem `day` (ostatni dzień miesiąca: 1). */
export function daysLeftInMonth(day: number): number {
  const d = dateOfGameDay(day);
  return monthLength(d.year, d.month) - d.date + 1;
}

/** Numer miesiąca gry: 0 to wrzesień 2026. Służy jako numer zdarzenia w losowaniu (komentarz Centrali). */
export function monthIndexOf(day: number): number {
  const d = dateOfGameDay(day);
  return (d.year - START_YEAR) * 12 + d.month - START_MONTH;
}

/** Zaokrąglenie kwot na kartach i w celach do „okrągłych” liczb (bez logarytmów: progi są stałe). */
export function roundNice(n: number): number {
  const a = Math.abs(n);
  const step = a < 100 ? 5 : a < 1000 ? 10 : a < 10_000 ? 50 : 100;
  return Math.round(n / step) * step;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
