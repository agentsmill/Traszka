import type { EconomyState } from './economy';
import { pow10Floor } from './exactMath';
import { rand01 } from './rand';

/**
 * Zlecenia Centrali: trzy krótkie cele naraz. Postęp liczy się od chwili przyjęcia zlecenia (różnica licznika),
 * a nagrodę gracz odbiera sam przyciskiem: to moment nagrody, który ma być wyraźny. Po odebraniu przychodzi nowe
 * zlecenie innego rodzaju, skalowane do obecnej wielkości sklepu.
 */
export type QuestKind = 'serve' | 'pallets' | 'taps' | 'margin' | 'upgrade' | 'clean' | 'rep' | 'hot';

export interface Quest {
  id: number;
  kind: QuestKind;
  title: string;
  target: number;
  /** Wartość licznika w chwili przyjęcia zlecenia (dla `rep`: 0, liczy się wartość bieżąca). */
  start: number;
  reward: { cash: number; ogonki: number; xp: number };
}

export const QUESTS_ACTIVE = 3;

/** Skala sklepu do wyliczenia celów i nagród. */
export interface QuestScale { dailyCustomers: number; dailyMargin: number }

/** Wartość licznika, którego dotyczy zlecenie. */
export function questMetric(s: EconomyState, kind: QuestKind): number {
  switch (kind) {
    case 'serve': return s.total.customers;
    case 'pallets': return s.total.palletsUnloaded;
    case 'taps': return s.total.taps;
    case 'margin': return s.total.margin;
    case 'upgrade': return s.total.purchases;
    case 'clean': return s.cleanDays;
    case 'rep': return s.reputation;
    case 'hot': return s.total.hotSold;
  }
}

/** Postęp 0–1. */
export function questProgress(s: EconomyState, q: Quest): number {
  const value = questMetric(s, q.kind) - q.start;
  return Math.max(0, Math.min(1, value / q.target));
}

export const questDone = (s: EconomyState, q: Quest): boolean => questProgress(s, q) >= 1;

/** Zaokrąglenie do „ładnej” liczby (1, 2, 5 × 10^n), żeby cele brzmiały jak z maila Centrali. */
export function niceRound(n: number): number {
  if (n <= 10) return Math.max(1, Math.round(n));
  const p = pow10Floor(n);
  const m = n / p;
  const step = m < 2 ? 0.2 : m < 5 ? 0.5 : 1;
  return Math.round(m / step) * step * p;
}

export const QUEST_KINDS: readonly QuestKind[] = ['serve', 'pallets', 'taps', 'margin', 'upgrade', 'clean', 'rep', 'hot'];

const TITLE: Record<QuestKind, (n: number) => string> = {
  serve: (n) => `Obsłuż ${n.toLocaleString('pl-PL')} klientów`,
  pallets: (n) => `Rozładuj ${n} ${n === 1 ? 'paletę' : n < 5 ? 'palety' : 'palet'}`,
  taps: (n) => `Pomóż osobiście: ${n} stuknięć w palety albo kasę`,
  margin: (n) => `Zarób ${n.toLocaleString('pl-PL')} zł marży`,
  upgrade: () => 'Zainwestuj: kup dowolne ulepszenie albo sprzęt',
  clean: (n) => (n === 1 ? 'Zamknij dzień bez mandatu' : `Zamknij ${n} dni bez mandatu`),
  rep: (n) => `Podnieś reputację do ${n}`,
  hot: (n) => `Sprzedaj ${n.toLocaleString('pl-PL')} hot-dogów i kaw`,
};

/** Nowe zlecenie innego rodzaju niż aktywne. Deterministyczne z seeda i numeru zlecenia. */
export function newQuest(s: EconomyState, scale: QuestScale): Quest {
  const id = s.questSeq++;
  const active = new Set(s.quests.map((q) => q.kind));
  let pool = QUEST_KINDS.filter((k) => !active.has(k) && !(k === 'rep' && s.reputation >= 90));
  if (pool.length === 0) pool = [...QUEST_KINDS];
  const kind = pool[Math.floor(rand01(s.seedHash, id, 21) * pool.length)]!;
  const lvl = s.level;
  let target: number;
  switch (kind) {
    case 'serve': target = niceRound(scale.dailyCustomers * 0.5); break;
    case 'pallets': target = Math.min(12, 3 + Math.floor(lvl / 4)); break;
    case 'taps': target = niceRound(40 + 10 * Math.min(lvl, 12)); break;
    case 'margin': target = niceRound(scale.dailyMargin * 0.5); break;
    case 'upgrade': target = 1; break;
    case 'clean': target = 1 + Math.floor(lvl / 15); break;
    case 'rep': target = Math.min(100, Math.floor(s.reputation / 5) * 5 + 10); break;
    case 'hot': target = niceRound(scale.dailyCustomers * 0.09); break;
  }
  const start = kind === 'rep' ? 0 : questMetric(s, kind);
  const r = rand01(s.seedHash, id, 22);
  return {
    id,
    kind,
    title: TITLE[kind](target),
    target,
    start,
    reward: {
      cash: niceRound(Math.max(300, scale.dailyMargin * (0.2 + 0.2 * r))),
      ogonki: 2 + Math.floor(r * 4),
      xp: 40 + 10 * lvl,
    },
  };
}
