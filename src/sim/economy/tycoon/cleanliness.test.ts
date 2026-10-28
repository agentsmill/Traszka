import { describe, expect, it } from 'vitest';
import { HOUR_CURVE, PATIENCE } from '../catalog';
import {
  CLEAN, WEATHERS, cleanHall, cleaningDemand, cleanlinessEffects, closeHallMonth, createHall, monthCleanliness, rollWeather,
  sampleHall, sanitizeHall, soilHall, type HallState, type Weather,
} from './cleanliness';

const DAILY_CUSTOMERS = 30 * Object.values(HOUR_CURVE).reduce((n, v) => n + v, 0);

describe('czystość sali', () => {
  it('brud rośnie z klientami: suchy dzień bez sprzątania to ok. połowa czystości', () => {
    const h = createHall();
    soilHall(h, DAILY_CUSTOMERS);
    expect(h.cleanliness).toBeGreaterThan(45);
    expect(h.cleanliness).toBeLessThan(60);
  });

  it('deszcz i śnieg brudzą bardziej niż sucha pogoda', () => {
    const after = (weather: Weather): number => {
      const h = createHall(weather);
      soilHall(h, 200);
      return h.cleanliness;
    };
    expect(after('deszcz')).toBeLessThan(after('sucho'));
    expect(after('snieg')).toBeLessThan(after('deszcz'));
  });

  it('worki w sali też brudzą', () => {
    const h = createHall();
    for (let i = 0; i < 60; i++) soilHall(h, 0, 2);
    expect(h.cleanliness).toBeCloseTo(100 - 60 * 2 * CLEAN.dirtPerHallBag);
  });

  it('sprzątanie przywraca czystość i nie zużywa więcej minut, niż trzeba', () => {
    const h = createHall();
    soilHall(h, 200);
    const work = (100 - h.cleanliness) / CLEAN.cleanPerMinute;
    expect(cleaningDemand(h)).toBe(1);
    expect(cleanHall(h, 10)).toBe(10);
    expect(cleanHall(h, 1000)).toBeCloseTo(work - 10);
    expect(h.cleanliness).toBe(100);
    expect(cleaningDemand(h)).toBe(0);
  });

  it('niska czystość obniża cierpliwość, reputację i wynik audytu; wysoka nie szkodzi', () => {
    const clean = cleanlinessEffects(95);
    expect(clean.patience).toBe(-0);
    expect(clean.repPerCustomer).toBe(-0);
    expect(clean.score).toBe(1);
    const dirty = cleanlinessEffects(20);
    expect(dirty.patience).toBe(-2);
    expect(PATIENCE + dirty.patience).toBe(4);
    expect(dirty.repPerCustomer).toBeLessThan(-0.002);
    expect(dirty.score).toBe(0);
    expect(cleanlinessEffects(55).score).toBeCloseTo(0.5);
  });

  it('średnia miesiąca liczy tylko minuty otwarcia i zeruje się w raporcie', () => {
    const h = createHall();
    sampleHall(h);
    soilHall(h, 500);
    sampleHall(h);
    expect(monthCleanliness(h)).toBeCloseTo((100 + h.cleanliness) / 2);
    expect(closeHallMonth(h)).toBeCloseTo(75);
    expect(h.monthMinutes).toBe(0);
    expect(h.totalMinutes).toBe(2);
  });

  it('pogoda: deterministyczna z seeda, jesienią pada, latem bywa upał, a śnieg nie spada w lipcu', () => {
    const count = (month: number, w: Weather): number => {
      let n = 0;
      for (let d = 0; d < 2000; d++) if (rollWeather(42, d, month) === w) n++;
      return n;
    };
    expect(rollWeather(42, 17, 9)).toBe(rollWeather(42, 17, 9));
    expect(count(9, 'deszcz')).toBeGreaterThan(500);
    expect(count(6, 'upal')).toBeGreaterThan(400);
    expect(count(6, 'snieg')).toBe(0);
    expect(count(0, 'snieg')).toBeGreaterThan(400);
    for (const w of WEATHERS) expect(count(0, w) + count(6, w)).toBeGreaterThan(0);
  });

  it('zapis: JSON w obie strony, zła pogoda wraca do suchej', () => {
    const h = createHall('snieg');
    soilHall(h, 100);
    sampleHall(h);
    expect(sanitizeHall(JSON.parse(JSON.stringify(h)) as HallState)).toEqual(h);
    const bad = sanitizeHall({ cleanliness: 400, weather: 'tornado' });
    expect(bad.cleanliness).toBe(100);
    expect(bad.weather).toBe('sucho');
  });
});
