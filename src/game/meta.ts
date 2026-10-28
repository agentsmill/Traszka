import type { EconomyState } from '@/sim/economy/economy';

/**
 * Postęp ponad pojedynczym sklepem (localStorage, wspólny dla wszystkich seedów): sieć sklepów z poprzednich rozgrywek,
 * Punkty Partnera (trwała premia), seria dni gry i ustawienia dźwięku. To pętla „bez końca”: każdy kolejny sklep
 * startuje z premią i dochodem z sieci.
 */
export interface NetworkStore { seed: string; income: number; level: number; margin: number }

export interface Meta {
  version: 1;
  partnerPoints: number;
  network: NetworkStore[];
  daily: { date: string; streak: number };
  lastSeen: number;
  sound: boolean;
  vibration: boolean;
}

const KEY = 'traszka:meta';

const defaults = (): Meta => ({
  version: 1, partnerPoints: 0, network: [], daily: { date: '', streak: 0 }, lastSeen: 0, sound: true, vibration: true,
});

export function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw) as Partial<Meta>;
    return data.version === 1 ? { ...defaults(), ...data } : defaults();
  } catch {
    return defaults();
  }
}

export function saveMeta(meta: Meta): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(meta));
  } catch {
    // bez zapisu
  }
}

/** Premia sieci dla nowego albo wczytanego sklepu. */
export function partnerOf(meta: Meta): EconomyState['partner'] {
  return {
    points: meta.partnerPoints,
    networkIncome: meta.network.reduce((n, x) => n + x.income, 0),
    stores: meta.network.length,
  };
}

/** Kiedy można otworzyć kolejny sklep: po drugim remoncie albo na 20. poziomie. */
export const prestigeReady = (s: EconomyState): boolean => s.remontLevel >= 2 || s.level >= 20;

/** Ile Punktów Partnera da zamknięcie obecnego sklepu (pierwiastek z zarobionej marży, min. 1). */
export const prestigePoints = (s: EconomyState): number => Math.max(1, Math.floor(Math.sqrt(s.total.margin / 20_000)));

/** Dochód, który ten sklep będzie dawał sieci co dzień: 10% najlepszego dnia (min. 200 zł). */
export const networkIncomeOf = (s: EconomyState): number => Math.max(200, Math.round(0.1 * s.bestDayProfit));

/** Dopisuje sklep do sieci i przyznaje punkty. Zwraca nową metę (zapis robi wołający). */
export function addToNetwork(meta: Meta, s: EconomyState): Meta {
  return {
    ...meta,
    partnerPoints: meta.partnerPoints + prestigePoints(s),
    network: [...meta.network, { seed: s.seed, income: networkIncomeOf(s), level: s.level, margin: Math.round(s.total.margin) }],
  };
}

const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Seria dni: nowy dzień kalendarzowy przedłuża serię (wczoraj) albo ją zeruje. Zwraca dzień serii albo null (dziś już był). */
export function advanceDaily(meta: Meta, now: Date): number | null {
  const today = dayKey(now);
  if (meta.daily.date === today) return null;
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const streak = meta.daily.date === yesterday ? meta.daily.streak + 1 : 1;
  meta.daily = { date: today, streak };
  return streak;
}

/** Nagroda dzienna za `streak` dni z rzędu (rośnie do 7. dnia). */
export function dailyReward(streak: number, level: number): { cash: number; ogonki: number } {
  const d = Math.min(7, streak);
  return { cash: d * (300 + 50 * level), ogonki: 2 * d + (d === 7 ? 10 : 0) };
}

/** Zarobek kierownika zmiany za `hours` nieobecności: ćwierć ostatniego dnia na godzinę, najwyżej 8 godzin. */
export function offlineEarnings(s: EconomyState, hours: number): number {
  if (hours < 0.05 || s.lastDayProfit <= 0) return 0;
  return Math.round(s.lastDayProfit * 0.25 * Math.min(8, hours));
}
