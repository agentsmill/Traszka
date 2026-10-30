import { dayOf, isLastDayOfMonth } from './calendar';
import { DEBT_LIMIT } from './catalog';
import { applyCommand } from './commands';
import { awaitingDecision, stepMinute, type EconEvent, type EconomyState } from './economy';
import type { StoreInfo } from './storeInfo';
import { visibleCards } from './tycoon/cards';
import { trustTerminates } from './tycoon/trust';

/**
 * Podgląd końca miesiąca: „co będzie na koniec, jeśli do tego czasu nic nie zrobię”. Liczy się na KOPII stanu (`structuredClone`),
 * tym samym rdzeniem co gra i sędzia rankingu (`stepMinute`), więc prawdziwy stan, dziennik poleceń i zegar się nie zmieniają.
 * To widok, nie przewinięcie czasu: nie ma tu żadnego zapisu, sygnału ani stanu modułu (sim jest czysty), a nowa wersja symulacji
 * nie jest potrzebna.
 *
 * Założenie: gracz nie stuka, nie kupuje i nie przestawia niczego, a karta decyzji, która zatrzyma grę, dostaje odpowiedź
 * domyślną (tę zaznaczoną z góry w oknie karty). Wynik to same sumy miesiąca: żadnych kart, fal klientów ani złotych palet
 * z przyszłości (seed jest deterministyczny, więc w biegu rankingowym szczegóły zdradzałyby, co będzie).
 *
 * Liczenie idzie porcjami (`step`), żeby interfejs mógł oddawać wątek między nimi: miesiąc to kilkadziesiąt tysięcy minut gry.
 */

/** Sumy miesiąca z podglądu (kwoty w zł). Liczniki obejmują cały miesiąc, także dni, które już minęły. */
export interface MonthPreview {
  /** Miesiąc, który zamyka podgląd (etykieta jak w raporcie miesiąca). */
  label: string;
  /** Gotówka w chwili uruchomienia podglądu. */
  cashNow: number;
  /** Gotówka po zamknięciu miesiąca (po opłacie, WUT i premii). */
  cashAfter: number;
  /** Najniższa gotówka po drodze (z przelewem na koniec miesiąca włącznie). */
  lowestCash: number;
  revenue: number;
  customers: number;
  /** Marża z klientów (bez premii). */
  margin: number;
  /** Premie Centrali: od obrotu przy zamknięciu miesiąca i KPI tygodnia. */
  bonus: number;
  /** Inne przychody i koszty z kart (ze znakiem: koszt zmniejsza). */
  other: number;
  wages: number;
  media: number;
  fines: number;
  logistics: number;
  /** Opłata franczyzowa za cały miesiąc. */
  fee: number;
  /** Ubytki (WUT) ponad limit Centrali. */
  wut: number;
  /** Wynik miesiąca jak w raporcie (przed inwestycjami: te liczy gracz sam). */
  profit: number;
  /** Czy gra kończy się w tym scenariuszu (przed zamknięciem miesiąca albo przy nim) i dlaczego. */
  gameOver: 'debt' | 'trust' | null;
  /** Gra skończyła się, zanim miesiąc zdążył się zamknąć (debet w środku miesiąca): sumy są wtedy częściowe. */
  endedEarly: boolean;
}

export interface PreviewProgress {
  /** Numer dnia podglądu: 1 to dzisiaj. */
  day: number;
  /** Ile dni liczy podgląd (od dziś do ostatniego dnia miesiąca włącznie). */
  days: number;
}

export interface MonthPreviewJob {
  /** Wykonuje najwyżej `maxMinutes` minut gry na kopii; `true`, gdy podgląd jest skończony (miesiąc zamknięty albo koniec gry). */
  step(maxMinutes: number): boolean;
  progress(): PreviewProgress;
  /** Wynik, gdy skończony; do tego czasu `null`. */
  result(): MonthPreview | null;
}

/** Bezpiecznik: miesiąc ma najwyżej 31 dni, plus dzień zapasu. Podgląd, który tyle nie wystarczył, kończy się bez wyniku. */
const MAX_PREVIEW_MINUTES = 32 * 1440;

/** Numer odpowiedzi domyślnej karty (jak `selectedAnswer` w oknie karty: poza zakresem pierwsza). */
function defaultAnswer(card: { answers: readonly unknown[]; defaultAnswer: number }): number {
  const ok = Number.isInteger(card.defaultAnswer) && card.defaultAnswer >= 0 && card.defaultAnswer < card.answers.length;
  return ok ? card.defaultAnswer : 0;
}

/** Ostatni dzień miesiąca, w którym jest dzień `from` (jego zamknięcie kończy podgląd). */
function lastDayOfMonthFrom(from: number): number {
  let day = from;
  while (!isLastDayOfMonth(day)) day++;
  return day;
}

/**
 * Zaczyna podgląd: kopiuje `s` i zwraca zadanie do wykonywania porcjami. `s` i `info` zostają nietknięte (`info` to wspólny, tylko
 * do odczytu opis sklepu; sim go nie zmienia). Gra, która już się skończyła, daje zadanie od razu skończone bez wyniku.
 */
export function startMonthPreview(s: EconomyState, info: StoreInfo): MonthPreviewJob {
  const copy = structuredClone(s);
  const startDay = dayOf(copy.minute);
  const lastDay = lastDayOfMonthFrom(startDay);
  const cashNow = copy.cash;
  const startMinute = copy.minute;
  let lowest = copy.cash;
  let result: MonthPreview | null = null;
  let finished = copy.gameOver;
  const events: EconEvent[] = [];
  let seen = 0;   // ile zdarzeń już przejrzano w poszukiwaniu zamknięcia miesiąca (bez skanowania całej listy co minutę)

  /** Odpowiada na kartę, która zatrzymała grę, odpowiedzią domyślną; `false`, gdy odpowiedź nie przeszła (nie zapętlamy się). */
  const answerDefault = (): boolean => {
    const card = visibleCards(copy.tycoon.cards, copy.minute)[0];
    if (!card) return false;
    const out = applyCommand(copy, info, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
    lowest = Math.min(lowest, copy.cash);
    return out.result.ok;
  };

  const finish = (): void => {
    finished = true;
    const month = events.find((e) => e.kind === 'month')?.report;
    const reason: MonthPreview['gameOver'] = !copy.gameOver ? null : copy.cash < DEBT_LIMIT ? 'debt' : trustTerminates(copy.tycoon.trust.value) ? 'trust' : null;
    if (month) {
      const c = month.counters;
      result = {
        label: month.label, cashNow, cashAfter: month.cash, lowestCash: lowest, revenue: c.revenue, customers: c.customers, margin: c.margin,
        bonus: c.bonus, other: c.other, wages: c.wages, media: c.media, fines: c.fines, logistics: c.logistics, fee: c.fee, wut: c.wut,
        profit: month.profit, gameOver: reason, endedEarly: false,
      };
    } else if (copy.gameOver) {
      // koniec gry w środku miesiąca (debet): sumy z liczników miesiąca do tej chwili
      const c = copy.month;
      result = {
        label: '', cashNow, cashAfter: copy.cash, lowestCash: lowest, revenue: c.revenue, customers: c.customers, margin: c.margin,
        bonus: c.bonus, other: c.other, wages: c.wages, media: c.media, fines: c.fines, logistics: c.logistics, fee: c.fee, wut: c.wut,
        profit: c.margin + c.bonus + c.other - c.wages - c.media - c.fee - c.fines - c.logistics - c.wut, gameOver: reason, endedEarly: true,
      };
    }
  };

  return {
    step(maxMinutes: number): boolean {
      if (finished) return true;
      let left = Math.max(1, Math.floor(maxMinutes));
      while (left > 0 && !finished) {
        if (copy.minute - startMinute > MAX_PREVIEW_MINUTES) { finished = true; break; }   // bezpiecznik: bez wyniku
        if (awaitingDecision(copy)) {
          if (!answerDefault()) { finished = true; break; }
          continue;
        }
        stepMinute(copy, info, events);
        lowest = Math.min(lowest, copy.cash);
        left--;
        const closed = events.slice(seen).some((e) => e.kind === 'month');
        seen = events.length;
        if (copy.gameOver || closed) finish();
      }
      return finished;
    },
    progress(): PreviewProgress {
      const days = lastDay - startDay + 1;
      return { day: Math.min(days, Math.max(1, dayOf(copy.minute) - startDay + 1)), days };
    },
    result: () => result,
  };
}
