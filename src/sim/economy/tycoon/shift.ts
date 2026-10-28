import { isRec, num, whole } from '@/sim/guards';
import { STAFF_MAX } from '../catalog';
import type { EconomyState } from '../economy';
import { cardModifiers } from './cards';
import { STAFF_TASKS, zeroTasks, type StaffTask, type TaskMinutes } from './staff';
import { clamp, isOpenMinute, minuteInDay } from './time';

/**
 * Zmiana w ostatniej wykonanej minucie: ile osób pracowało i ile osobominut każda grupa zrobiła przy zadaniu (bez
 * automatyki). Zapisuje to `stepMinute` w każdej minucie, także nocą (`staff: 0`). Z tego widok „Ludzie na ekranie” zgaduje,
 * kto czym się zajmuje (`staffOnShift`), a panele pokazują, ilu stoi na kasie.
 */
export interface ShiftState {
  staff: number;
  human: TaskMinutes;
}

export const createShift = (): ShiftState => ({ staff: 0, human: zeroTasks() });

/**
 * Ile osób jest na zmianie w minucie `state.minute`: personel w godzinach pracy, z efektem karty (chory, dodatkowa
 * osoba), w granicach 0…`STAFF_MAX`. Nocą nikogo (pracuje tylko automatyka). To samo liczby `stepMinute` do puli ludzi,
 * więc widok i symulacja nie rozjadą się o osobę.
 */
export function peopleOnShift(state: Pick<EconomyState, 'minute' | 'staff' | 'tycoon'>): number {
  if (!isOpenMinute(minuteInDay(state.minute))) return 0;
  return clamp(Math.floor(state.staff + cardModifiers(state.tycoon.cards, state.minute).staff), 0, STAFF_MAX);
}

/** Zapis: brak pola, tekst albo liczba spoza zakresu dają pustą zmianę albo wartość przyciętą do 0…`STAFF_MAX`. */
export function sanitizeShift(raw: unknown): ShiftState {
  const r = isRec(raw) ? raw : {};
  const h = isRec(r.human) ? r.human : {};
  const human = zeroTasks();
  for (const t of STAFF_TASKS) human[t] = num(h[t], 0, 0, STAFF_MAX);
  return { staff: whole(r.staff, 0, 0, STAFF_MAX), human };
}

export type ShiftTask = StaffTask | 'wolny';

/** Zaokrąglenia osobominut nie mogą zgubić osoby, która ma dokładnie całą minutę pracy (1,9999999999 to 2). */
const EPS = 1e-9;

/** Ilość pracy z przydziału: tylko skończona i nieujemna (zepsuty stan nie ma prawa zepsuć widoku). */
const minutesOf = (x: number): number => (Number.isFinite(x) ? Math.max(0, x) : 0);

/**
 * Kto z ludzi na zmianie czym się zajmuje: jedna pozycja na każdą osobę (`id` od 0), z zadaniem albo `'wolny'`. To
 * zgadnięcie z ostatniego przydziału (`state.shift`), a nie osobny stan: pula ludzi liczy osobominuty, nie osoby.
 * - Pierwsza minuta po otwarciu (`shift.staff === 0`): osoba 0 stoi na kasie, reszta jest wolna.
 * - Najpierw przypięci: tyle osób przy zadaniu, ile jest tam pracy (przypięty bez pracy wraca do puli).
 * - Reszta metodą największych reszt: całe osoby z osobominut, potem największe ułamki (remis: kolejność zadań).
 *   Miejsc tyle, ile wynosi zaokrąglona suma pracy, ale nie więcej niż zostało ludzi; reszta to „wolny”.
 * - Kolejność wyniku: zadania jak w `STAFF_TASKS`, potem wolni. Dzięki temu kasa ma najniższe numery.
 */
export function staffOnShift(state: EconomyState): Array<{ id: number; task: ShiftTask }> {
  const n = peopleOnShift(state);
  const list: ShiftTask[] = n === 0 ? [] : state.shift.staff === 0 ? ['kasa'] : assign(n, state.shift.human, state.tycoon.staff.pinned);
  while (list.length < n) list.push('wolny');
  return list.map((task, id) => ({ id, task }));
}

function assign(n: number, human: TaskMinutes, pinned: TaskMinutes): StaffTask[] {
  const count = zeroTasks();
  let left = n;
  for (const t of STAFF_TASKS) {
    const k = Math.max(0, Math.min(minutesOf(pinned[t]), Math.floor(minutesOf(human[t]) + EPS), left));
    count[t] = k;
    left -= k;
  }
  const rest = zeroTasks();
  for (const t of STAFF_TASKS) rest[t] = Math.max(0, minutesOf(human[t]) - count[t]);
  let seats = Math.min(left, Math.round(STAFF_TASKS.reduce((sum, t) => sum + rest[t], 0)));
  for (const t of STAFF_TASKS) {
    const k = Math.min(Math.floor(rest[t] + EPS), seats);
    count[t] += k;
    seats -= k;
  }
  // sort jest stabilny, więc przy równych ułamkach zostaje kolejność STAFF_TASKS
  const byFraction = STAFF_TASKS.map((t) => ({ t, fraction: rest[t] - Math.floor(rest[t] + EPS) }))
    .filter((x) => x.fraction > EPS)
    .sort((a, b) => b.fraction - a.fraction);
  for (const { t } of byFraction) {
    if (seats <= 0) break;
    count[t]++;
    seats--;
  }
  return STAFF_TASKS.flatMap((t) => Array.from({ length: count[t] }, () => t));
}
