import { RANKED_DAYS, loadRanked, pendingFinished, rankedDayOf } from '@/game/rankedRun';
import { zl } from '../game/format';
import { ranked, unsent, type RankedStartRequest } from '../state';

/**
 * Pytanie na ekranie startowym przed porzuceniem biegu rankingowego: tekst zależny od tego, co stoi na przeszkodzie (niewysłany bieg
 * z wynikiem albo trwający bieg z dniem sezonu) i skąd wziąć te liczby. Bez DOM i bez haków, żeby miało testy.
 */

/** Liczby do pytania; null, gdy ich nie da się ustalić (bieg z innej wersji gry, nieczytelna szuflada): pytanie jest wtedy bez nawiasu. */
export interface RankedAskFacts {
  /** Wynik niewysłanego biegu (zł). */
  score: number | null;
  /** Dzień trwającego biegu, od 1. */
  day: number | null;
  /** Ile dni ma sezon. */
  days: number;
}

const TAIL = 'Zacząć nowy i porzucić tamten?';

/** „Masz niewysłany bieg (wynik … zł).” albo „Masz rozpoczęty bieg rankingowy (dzień N z 91).”, a po nim pytanie. */
export function rankedAskText(reason: RankedStartRequest['reason'], facts: RankedAskFacts): string {
  if (reason === 'unsent') return facts.score === null ? `Masz niewysłany bieg. ${TAIL}` : `Masz niewysłany bieg (wynik ${zl(facts.score)}). ${TAIL}`;
  return facts.day === null ? `Masz rozpoczęty bieg rankingowy. ${TAIL}` : `Masz rozpoczęty bieg rankingowy (dzień ${facts.day} z ${facts.days}). ${TAIL}`;
}

/**
 * Liczby do pytania. Wynik: z `ui.unsent` (pilnuje go powłoka gry), a gdy powłoki jeszcze nie ma (ekran „pierwsze wejście”), z szuflady
 * w przeglądarce. Dzień: z `ui.ranked`, gdy gracz jest w biegu; gdy bieg czeka w zapisie, a gracz stoi w zwykłym sklepie (albo powłoki
 * jeszcze nie ma), z zapisu (`loadRanked`; zapis z innej wersji gry nie daje dnia). Odczyt, nie subskrypcja: pytanie liczy się raz, gdy się pojawia.
 */
export function rankedAskFacts(): RankedAskFacts {
  const score = unsent.peek()?.score ?? pendingFinished()?.score ?? null;
  const view = ranked.peek();
  if (view) return { score, day: view.day, days: view.days };
  const stored = loadRanked();
  return { score, day: stored.status === 'ok' ? rankedDayOf(stored.session.econ) : null, days: RANKED_DAYS };
}
