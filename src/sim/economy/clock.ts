import { MINUTES_PER_SECOND_CLOSED, MINUTES_PER_SECOND_OPEN } from './catalog';
import { isOpenAt, minuteOfDay } from './calendar';
import { stepMinute, type EconEvent, type EconomyState } from './economy';
import type { StoreInfo } from './storeInfo';

/** Ile minut gry upływa w sekundzie przy ×1: w godzinach otwarcia wolniej, noc mija szybko. */
export function gameMinutesPerSecond(minute: number): number {
  return isOpenAt(minuteOfDay(minute)) ? MINUTES_PER_SECOND_OPEN : MINUTES_PER_SECOND_CLOSED;
}

/** Ułamek bieżącej minuty gry, który już upłynął (poza stanem gry: nie trafia do zapisu). */
export interface EconClock { acc: number }

/** Bezpiecznik: tyle minut gry najwyżej w jednym wywołaniu (×8 w nocy to ~11 minut na klatkę). */
export const MAX_MINUTES_PER_ADVANCE = 240;

/**
 * Przesuwa ekonomię o `seconds` czasu gry (już przemnożonego przez prędkość) i wykonuje pełne minuty. Tempo zegara
 * zmienia się na granicy minut (otwarcie, zamknięcie). Zwraca liczbę wykonanych minut.
 */
export function advanceEconomy(s: EconomyState, info: StoreInfo, clock: EconClock, seconds: number, out: EconEvent[]): number {
  if (!(seconds > 0) || s.gameOver) return 0;
  let budget = seconds;
  let steps = 0;
  while (steps < MAX_MINUTES_PER_ADVANCE) {
    const rate = gameMinutesPerSecond(s.minute);
    const need = (1 - clock.acc) / rate;
    if (budget < need) { clock.acc += budget * rate; break; }
    budget -= need;
    clock.acc = 0;
    stepMinute(s, info, out);
    steps++;
    if (s.gameOver) break;
  }
  return steps;
}
