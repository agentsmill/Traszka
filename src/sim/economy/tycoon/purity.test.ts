import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dateOfDay, isLastDayOfMonth } from '../calendar';
import { CH, CHANNEL_RANGE } from './channels';
import { dateOfGameDay, isMonthEnd, monthIndexOf, roundNice, weekdayOf } from './time';

const DIR = 'src/sim/economy/tycoon';
const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

/** Kod bez komentarzy: zakazy dotyczą kodu, a komentarz może opisać, czego unikamy. */
const code = (f: string): string => readFileSync(join(DIR, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// Zasady modułów tycoona: deterministycznie (bez zegara, przeglądarki i losowania spoza rand01), bez funkcji, które
// przeglądarki liczą różnie (logarytmy, trygonometria, hypot, potęgi ułamkowe), bez formatowania liczb wg języka w stanie
// gry. Wzorce są składane z kawałków, żeby ten plik sam nie zawierał zakazanych napisów (pilnuje tego tests/architecture).
const M = 'Math\\.';
const FORBIDDEN: [string, RegExp][] = [
  ['import biblioteki 3D', new RegExp(`from ['"]${'thr'}ee`)],
  ['losowanie z Math', new RegExp(`${M}${'rand'}om`)],
  ['Date', /\bDate\b/],
  ['performance', /\bperformance\b/],
  ['localStorage', /\blocalStorage\b/],
  ['window', /\bwindow\b/],
  ['hypot', new RegExp(`${M}hypot`)],
  ['logarytmy', new RegExp(`${M}log`)],
  ['trygonometria', new RegExp(`${M}(a?sin|a?cos|a?tan|atan2|sinh|cosh|tanh|asinh|acosh|atanh)\\b`)],
  ['pow, sqrt, cbrt, exp', new RegExp(`${M}(pow|sqrt|cbrt|exp|expm1)\\b`)],
  ['operator potęgi', /\*\*/],
  ['toLocaleString / Intl', /toLocaleString|\bIntl\b/],
  ['calendar.ts (liczy przez Date)', /from ['"]\.\.\/calendar['"]/],
];

describe('moduły tycoona: czystość', () => {
  it('są pliki do sprawdzenia', () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  for (const [name, re] of FORBIDDEN) {
    it(`żaden plik nie używa: ${name}`, () => {
      expect(sources.filter((f) => re.test(code(f)))).toEqual([]);
    });
  }

  it('z economy.ts importujemy tylko typy (economy.ts zaimportuje te moduły w części 2 bez cyklu)', () => {
    expect(sources.filter((f) => /^import (?!type )[^;]*from ['"]\.\.\/economy['"]/m.test(code(f)))).toEqual([]);
  });

  it('kanały losowości są w zakresie 100–199 i się nie powtarzają', () => {
    const values = Object.values(CH);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(CHANNEL_RANGE[0]);
      expect(v).toBeLessThanOrEqual(CHANNEL_RANGE[1]);
    }
  });
});

describe('czas bez Date', () => {
  it('data, dzień tygodnia i koniec miesiąca zgadzają się z calendar.ts przez 3 lata gry', () => {
    for (let day = 0; day < 3 * 366; day++) {
      const ref = dateOfDay(day);
      expect(dateOfGameDay(day)).toEqual({ year: ref.year, month: ref.month, date: ref.date });
      expect(weekdayOf(day)).toBe(ref.weekday);
      expect(isMonthEnd(day)).toBe(isLastDayOfMonth(day));
    }
  });

  it('daleka przyszłość też się zgadza (lata przestępne co 4, 100 i 400 lat)', () => {
    for (const day of [36_524, 73_048, 146_097, 200_000, 365_000]) {
      const ref = dateOfDay(day);
      expect(dateOfGameDay(day)).toEqual({ year: ref.year, month: ref.month, date: ref.date });
      expect(weekdayOf(day)).toBe(ref.weekday);
    }
  });

  it('numer miesiąca: wrzesień 2026 to 0, styczeń 2027 to 4', () => {
    expect(monthIndexOf(0)).toBe(0);
    expect(monthIndexOf(29)).toBe(0);
    expect(monthIndexOf(30)).toBe(1);
    expect(monthIndexOf(122)).toBe(4);
  });

  it('kwoty zaokrąglane do okrągłych liczb', () => {
    expect(roundNice(42)).toBe(40);
    expect(roundNice(437)).toBe(440);
    expect(roundNice(-1234)).toBe(-1250);
    expect(roundNice(23_456)).toBe(23_500);
  });
});
