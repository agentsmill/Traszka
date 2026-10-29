import type { EconEventKind } from '../economy';
import { clamp } from './time';

/**
 * Komunikaty dla gracza według wagi (decyzja użytkownika z 28.10.2026):
 * - `info`: informacja bez decyzji (dostawa, mandat, wynik karty, KPI tygodnia). Zamyka się sama, ale nie miga: zostaje
 *   na ekranie co najmniej `readMs(tekst)` czasu rzeczywistego, także przy ×8, a stuknięcie zamyka ją wcześniej;
 * - `story`: ważne zdarzenie fabularne (raport miesięczny, koniec remontu, nowy próg zaufania, nieopłacona Centrala, koniec gry). Gra staje
 *   i czeka na „OK”, żeby gracz wiedział, co się stało;
 * - `decision`: karta decyzji. Gra stoi, aż gracz wybierze odpowiedź (`cardsBlocking` w `cards.ts`).
 * Symulacja niczego tu nie mierzy w czasie rzeczywistym: to umowa dla pętli gry i interfejsu (część 2 i strumień A).
 */

export type NoticeLevel = 'info' | 'story' | 'decision';

/** Rodzaje komunikatów z modułów tycoona (obok `EconEventKind` z ekonomii). */
export type TycoonNoticeKind = 'card' | 'card-result' | 'kpi-week' | 'trust-tier' | 'report';

const LEVEL: Partial<Record<EconEventKind | TycoonNoticeKind, NoticeLevel>> = {
  card: 'decision',
  month: 'story',
  report: 'story',
  remont: 'story',
  gameover: 'story',
  debt: 'story',
  'trust-tier': 'story',
};

/**
 * Waga komunikatu. Nowy poziom gracza zatrzymuje grę tylko wtedy, gdy coś odblokowuje (to zdarzenie fabularne);
 * zwykły awans to informacja. Nieznany rodzaj (np. dodany później w ekonomii) to informacja.
 */
export function noticeLevel(kind: EconEventKind | TycoonNoticeKind, opts: { unlocks?: number } = {}): NoticeLevel {
  if (kind === 'levelup') return (opts.unlocks ?? 0) > 0 ? 'story' : 'info';
  return LEVEL[kind] ?? 'info';
}

export const pausesGame = (level: NoticeLevel): boolean => level !== 'info';

/** Najkrócej tyle milisekund czasu rzeczywistego informacja zostaje na ekranie (niezależnie od prędkości gry). */
export const NOTICE_MIN_READ_MS = 4000;
/** Czas czytania rośnie z długością tekstu, ale informacja nie wisi dłużej niż tyle. */
export const NOTICE_MAX_READ_MS = 12_000;
const MS_PER_CHAR = 60;

/** Ile czasu rzeczywistego pokazywać informację o tekście `text`, zanim zamknie się sama. */
export const readMs = (text: string): number => clamp(MS_PER_CHAR * text.length, NOTICE_MIN_READ_MS, NOTICE_MAX_READ_MS);
