import { describe, expect, it } from 'vitest';
import { MONTH_NAME, WEEKDAY_SHORT, dateOfDay, formatDate, formatMonth, isLastDayOfMonth, type GameDate } from './calendar';

/**
 * Kopia implementacji sprzed zmiany, na `Date` (w testach wolno). Wzorzec, z którym kalendarz bez `Date` ma się zgadzać
 * co do dnia, miesiąca, roku i dnia tygodnia.
 */
const START_UTC = Date.UTC(2026, 8, 1);
const DAY_MS = 86_400_000;

function legacyDateOfDay(day: number): GameDate {
  const d = new Date(START_UTC + day * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(), weekday: d.getUTCDay() };
}

const legacyIsLastDayOfMonth = (day: number): boolean => legacyDateOfDay(day + 1).month !== legacyDateOfDay(day).month;

describe('kalendarz gry', () => {
  it('dzień 0 gry to dzień 20 697 od 1970-01-01', () => {
    expect(START_UTC / DAY_MS).toBe(20_697);
  });

  it('dateOfDay jak Date.UTC dla dni −1000..80 000', () => {
    for (let day = -1000; day <= 80_000; day++) {
      expect(dateOfDay(day), `dzień ${day}`).toEqual(legacyDateOfDay(day));
    }
  });

  it('isLastDayOfMonth i formatMonth jak przy Date.UTC dla tych samych dni', () => {
    for (let day = -1000; day <= 80_000; day++) {
      expect(isLastDayOfMonth(day), `dzień ${day}`).toBe(legacyIsLastDayOfMonth(day));
      const d = legacyDateOfDay(day);
      expect(formatMonth(day), `dzień ${day}`).toBe(`${MONTH_NAME[d.month]} ${d.year}`);
    }
  });

  it('formatDate jak przy Date.UTC dla dni −1000..80 000', () => {
    const genitive = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października',
      'listopada', 'grudnia'];
    for (let day = -1000; day <= 80_000; day++) {
      const d = legacyDateOfDay(day);
      expect(formatDate(day), `dzień ${day}`).toBe(`${WEEKDAY_SHORT[d.weekday]} ${d.date} ${genitive[d.month]}`);
    }
  });

  it('daty przypięte na literałach, niezależnie od silnika', () => {
    expect(dateOfDay(0)).toEqual({ year: 2026, month: 8, date: 1, weekday: 2 });   // wtorek 1 września 2026
    expect(formatDate(0)).toBe('wt 1 września');
    expect(formatMonth(0)).toBe('wrzesień 2026');
    expect(dateOfDay(29)).toEqual({ year: 2026, month: 8, date: 30, weekday: 3 });
    expect(isLastDayOfMonth(29)).toBe(true);
    expect(isLastDayOfMonth(28)).toBe(false);
    expect(dateOfDay(30)).toEqual({ year: 2026, month: 9, date: 1, weekday: 4 });
    expect(dateOfDay(-1)).toEqual({ year: 2026, month: 7, date: 31, weekday: 1 });   // dzień przed startem: poniedziałek 31 sierpnia
    expect(dateOfDay(122)).toEqual({ year: 2027, month: 0, date: 1, weekday: 5 });   // piątek 1 stycznia 2027
    // rok przestępny 2028 ma 29 lutego, a 2100 (podzielny przez 100, ale nie przez 400) nie ma
    expect(dateOfDay(546)).toEqual({ year: 2028, month: 1, date: 29, weekday: 2 });
    expect(dateOfDay(547)).toEqual({ year: 2028, month: 2, date: 1, weekday: 3 });
    expect(dateOfDay(26_843)).toEqual({ year: 2100, month: 1, date: 28, weekday: 0 });
    expect(dateOfDay(26_844)).toEqual({ year: 2100, month: 2, date: 1, weekday: 1 });
    expect(isLastDayOfMonth(545)).toBe(false);
    expect(isLastDayOfMonth(546)).toBe(true);
    expect(isLastDayOfMonth(26_843)).toBe(true);
  });
});
