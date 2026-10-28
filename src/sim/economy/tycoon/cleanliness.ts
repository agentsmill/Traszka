import { isRec, num } from '@/sim/guards';
import { rand01 } from '../rand';
import { CH } from './channels';
import { clamp } from './time';

/**
 * Czystość sali (spec §6.5). Brud rośnie z ruchem klientów i pogodą (błoto na butach), spada z minutami sprzątania.
 * Niska czystość obniża cierpliwość w kolejce, reputację oraz wynik audytu i tajemniczego klienta.
 */

export type Weather = 'sucho' | 'upal' | 'deszcz' | 'snieg';
export const WEATHERS: readonly Weather[] = ['sucho', 'upal', 'deszcz', 'snieg'];
export const WEATHER_LABEL: Record<Weather, string> = { sucho: 'Sucho', upal: 'Upał', deszcz: 'Deszcz', snieg: 'Śnieg' };
/** Ile razy więcej brudu wnosi klient: deszcz to błoto, śnieg to błoto z solą. */
export const WEATHER_DIRT: Record<Weather, number> = { sucho: 1, upal: 1.15, deszcz: 1.7, snieg: 2.2 };

export interface HallState {
  /** Czystość sali 0–100 (100 lśni, 0 to podłoga, której nikt nie widział od września). */
  cleanliness: number;
  /** Pogoda dnia (zaczep: dziś losowana tu, później z systemu pogody). */
  weather: Weather;
  /** Suma czystości z minut otwarcia i ich liczba: w miesiącu (raport, audyt) i od początku gry (KPI tygodnia). */
  monthSum: number;
  monthMinutes: number;
  totalSum: number;
  totalMinutes: number;
}

export const CLEAN = {
  /** Punkty brudu na klienta przy suchej pogodzie: ok. 470 klientów dziennie to ok. 47 punktów. */
  dirtPerCustomer: 0.1,
  /** Brud na minutę od jednego worka śmieci leżącego w sali. */
  dirtPerHallBag: 0.02,
  /** Punkty czystości na osobominutę sprzątania: suchy dzień to ok. godzina sprzątania. */
  cleanPerMinute: 0.8,
  /** Przy myciu podłogi naraz najwyżej jedna osoba (mop jest jeden). */
  maxPeople: 1,
  /** Cierpliwość w kolejce spada poniżej 60: −1 osoba na każde 20 punktów. */
  patienceFrom: 60,
  patiencePer: 20,
  /** Reputacja: poniżej 70 każdy obsłużony klient odejmuje do 0,003 punktu (przy czystości 0). */
  repFrom: 70,
  repPerCustomerMax: 0.003,
  /** Wynik czystości w audycie: 0 przy 20 i mniej, pełny od 90. */
  scoreZero: 20,
  scoreFull: 90,
} as const;

export function createHall(weather: Weather = 'sucho'): HallState {
  return { cleanliness: 100, weather, monthSum: 0, monthMinutes: 0, totalSum: 0, totalMinutes: 0 };
}

/** Brud z jednej minuty: klienci tej minuty razy pogoda i worki leżące w sali. Zwraca dodany brud. */
export function soilHall(h: HallState, customers: number, hallBags = 0): number {
  const dirt = Math.max(0, customers) * CLEAN.dirtPerCustomer * WEATHER_DIRT[h.weather] + Math.max(0, hallBags) * CLEAN.dirtPerHallBag;
  const before = h.cleanliness;
  h.cleanliness = clamp(h.cleanliness - dirt, 0, 100);
  return before - h.cleanliness;
}

/** Osobominuty do pełnej czystości. */
export const cleaningWork = (h: HallState): number => (100 - h.cleanliness) / CLEAN.cleanPerMinute;

/** Zapotrzebowanie na tę minutę (część zadania „sprzątanie i śmieci”). */
export const cleaningDemand = (h: HallState): number => Math.min(CLEAN.maxPeople, cleaningWork(h));

/** Sprzątanie przez `minutes` osobominut. Zwraca zużyte minuty. */
export function cleanHall(h: HallState, minutes: number): number {
  if (!(minutes > 0)) return 0;
  const used = Math.min(minutes, cleaningWork(h));
  h.cleanliness = clamp(h.cleanliness + used * CLEAN.cleanPerMinute, 0, 100);
  return used;
}

/** Minuta otwarcia: czystość wchodzi do średniej miesiąca i średniej od początku gry. */
export function sampleHall(h: HallState): void {
  h.monthSum += h.cleanliness;
  h.monthMinutes++;
  h.totalSum += h.cleanliness;
  h.totalMinutes++;
}

export const monthCleanliness = (h: HallState): number => (h.monthMinutes > 0 ? h.monthSum / h.monthMinutes : h.cleanliness);

/** Koniec miesiąca: średnia czystość do raportu i audytu, licznik od zera. */
export function closeHallMonth(h: HallState): number {
  const avg = monthCleanliness(h);
  h.monthSum = 0;
  h.monthMinutes = 0;
  return avg;
}

export interface CleanlinessEffects {
  /** Zmiana cierpliwości (osoby w kolejce, które klient jeszcze toleruje): 0 albo ujemna. */
  patience: number;
  /** Zmiana reputacji na obsłużonego klienta: 0 albo ujemna. */
  repPerCustomer: number;
  /** Wynik czystości 0–1 do audytu (średnia miesiąca) i tajemniczego klienta (czystość w chwili wizyty). */
  score: number;
}

export function cleanlinessEffects(c: number): CleanlinessEffects {
  const v = clamp(c, 0, 100);
  return {
    patience: -Math.max(0, CLEAN.patienceFrom - v) / CLEAN.patiencePer,
    repPerCustomer: -CLEAN.repPerCustomerMax * Math.max(0, CLEAN.repFrom - v) / CLEAN.repFrom,
    score: clamp((v - CLEAN.scoreZero) / (CLEAN.scoreFull - CLEAN.scoreZero), 0, 1),
  };
}

// Szanse pogody wg miesiąca (0 = styczeń): śnieg, deszcz, upał; reszta to sucho. Polska jesień: dużo deszczu.
const SNOW = [0.3, 0.3, 0.1, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.25];
const RAIN = [0.2, 0.2, 0.25, 0.3, 0.35, 0.3, 0.3, 0.3, 0.3, 0.35, 0.35, 0.25];
const HEAT = [0, 0, 0, 0, 0.05, 0.2, 0.3, 0.25, 0.05, 0, 0, 0];

/** Pogoda dnia z seeda (miesiąc 0–11 podaje wywołujący, np. z `dateOfGameDay`). Zaczep: przyszły system pogody ją zastąpi. */
export function rollWeather(seedHash: number, day: number, month: number): Weather {
  const m = clamp(Math.floor(month), 0, 11);
  const r = rand01(seedHash, day, CH.weather);
  if (r < SNOW[m]) return 'snieg';
  if (r < SNOW[m] + RAIN[m]) return 'deszcz';
  if (r < SNOW[m] + RAIN[m] + HEAT[m]) return 'upal';
  return 'sucho';
}

export function sanitizeHall(raw: unknown): HallState {
  const d = createHall();
  if (!isRec(raw)) return d;
  return {
    cleanliness: num(raw.cleanliness, d.cleanliness, 0, 100),
    weather: WEATHERS.includes(raw.weather as Weather) ? raw.weather as Weather : d.weather,
    monthSum: num(raw.monthSum, 0, 0, 1e15),
    monthMinutes: num(raw.monthMinutes, 0, 0, 1e13),
    totalSum: num(raw.totalSum, 0, 0, 1e15),
    totalMinutes: num(raw.totalMinutes, 0, 0, 1e13),
  };
}
