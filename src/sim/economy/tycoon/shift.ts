import { isRec, num, whole } from '@/sim/guards';
import { STAFF_MAX } from '../catalog';
import type { EconomyState } from '../economy';
import { cardModifiers } from './cards';
import { STAFF_TASKS, zeroTasks, type StaffTask, type TaskMinutes } from './staff';
import { clamp, isOpenMinute, minuteInDay } from './time';

/** Czym zajmuje się osoba na zmianie: jednym z czterech zadań albo niczym (`'wolny'`). */
export type ShiftTask = StaffTask | 'wolny';

/**
 * Zmiana w ostatniej wykonanej minucie: ile osób pracowało, ile osobominut każda grupa zrobiła przy zadaniu (bez
 * automatyki) i kto czym się zajmował. Zapisuje to `stepMinute` w każdej minucie, także nocą (`staff: 0`, `people: []`).
 * Z tego widok „Ludzie na ekranie” czyta, kto co robi (`staffOnShift`), a panele pokazują, ilu stoi na kasie.
 *
 * `people[i]` to zadanie osoby o stałym numerze `i`: zatrudnienie dodaje osobę o najwyższym numerze, zwolnienie zabiera
 * tę o najwyższym, a zmiana liczby ludzi przy jednym zadaniu nie przestawia pozostałych (`placePeople`).
 */
export interface ShiftState {
  staff: number;
  human: TaskMinutes;
  people: ShiftTask[];
}

export const createShift = (): ShiftState => ({ staff: 0, human: zeroTasks(), people: [] });

/**
 * Ile osób jest na zmianie w minucie `state.minute`: personel w godzinach pracy, z efektem karty (chory, dodatkowa
 * osoba), w granicach 0…`STAFF_MAX`. Nocą nikogo (pracuje tylko automatyka). To samo liczby `stepMinute` do puli ludzi,
 * więc widok i symulacja nie rozjadą się o osobę.
 */
export function peopleOnShift(state: Pick<EconomyState, 'minute' | 'staff' | 'tycoon'>): number {
  if (!isOpenMinute(minuteInDay(state.minute))) return 0;
  return clamp(Math.floor(state.staff + cardModifiers(state.tycoon.cards, state.minute).staff), 0, STAFF_MAX);
}

const isShiftTask = (x: unknown): x is ShiftTask => x === 'wolny' || (STAFF_TASKS as readonly unknown[]).includes(x);

/**
 * Zapis: brak pola, tekst albo liczba spoza zakresu dają pustą zmianę albo wartość przyciętą do 0…`STAFF_MAX`. Numer osoby
 * to jej miejsce w tablicy, więc nieznane zadanie staje się `'wolny'` (nie wypada z listy i nie przesuwa pozostałych), a
 * tablica dłuższa niż `STAFF_MAX` jest ucięta. Zapis sprzed stałych numerów nie ma `people`: pusta lista.
 */
export function sanitizeShift(raw: unknown): ShiftState {
  const r = isRec(raw) ? raw : {};
  const h = isRec(r.human) ? r.human : {};
  const human = zeroTasks();
  for (const t of STAFF_TASKS) human[t] = num(h[t], 0, 0, STAFF_MAX);
  const people = Array.isArray(r.people) ? r.people.slice(0, STAFF_MAX).map((x): ShiftTask => (isShiftTask(x) ? x : 'wolny')) : [];
  return { staff: whole(r.staff, 0, 0, STAFF_MAX), human, people };
}

/** Zaokrąglenia osobominut nie mogą zgubić osoby, która ma dokładnie całą minutę pracy (1,9999999999 to 2). */
const EPS = 1e-9;

/** Ilość pracy z przydziału: tylko skończona i nieujemna (zepsuty stan nie ma prawa zepsuć widoku). */
const minutesOf = (x: number): number => (Number.isFinite(x) ? Math.max(0, x) : 0);

/**
 * Ile osób stoi przy każdym zadaniu, gdy zmiana liczy `n` osób, a przydział to `human` osobominut:
 * - Najpierw przypięci: tyle osób przy zadaniu, ile jest tam pracy (przypięty bez pracy wraca do puli).
 * - Reszta metodą największych reszt: całe osoby z osobominut, potem największe ułamki (remis: kolejność zadań).
 *   Miejsc tyle, ile wynosi zaokrąglona suma pracy, ale nie więcej niż zostało ludzi; reszta to „wolny”.
 */
export function taskCounts(n: number, human: TaskMinutes, pinned: TaskMinutes): TaskMinutes {
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
  return count;
}

/**
 * Kto z `n` ludzi na zmianie czym się zajmuje, z zachowaniem poprzednich zadań (`prev[i]` to zadanie osoby `i` w poprzedniej
 * minucie). Liczby osób przy zadaniach daje `taskCounts` (pula liczy osobominuty, nie osoby, więc to zgadnięcie z przydziału).
 * - Osoba `i` zostaje przy `prev[i]`, jeśli to zadanie ma jeszcze wolne miejsce: zmiana liczby ludzi przy jednym zadaniu
 *   nie przestawia osób przy pozostałych (więcej kroków zostaje na postaciach, które i tak mają coś do zrobienia).
 * - Pozostali, od najniższego numeru, biorą wolne miejsca w kolejności `STAFF_TASKS` (kasa ma więc najniższe numery, gdy
 *   zaczyna się od zera, np. rano). Nowa osoba ma numer wyższy niż wszyscy, więc nie ma `prev` i też bierze wolne miejsce.
 * - Kto nie dostał miejsca, jest `'wolny'`.
 * Funkcja jest czysta i deterministyczna: tylko `stepMinute` zapisuje jej wynik do `shift.people`.
 */
export function placePeople(prev: readonly ShiftTask[], n: number, human: TaskMinutes, pinned: TaskMinutes): ShiftTask[] {
  const free = taskCounts(n, human, pinned);
  const out: (ShiftTask | null)[] = Array.from({ length: n }, () => null);
  for (let i = 0; i < n; i++) {
    const t = prev[i];
    if (t !== undefined && t !== 'wolny' && free[t] > 0) {
      out[i] = t;
      free[t]--;
    }
  }
  for (let i = 0; i < n; i++) {
    if (out[i] !== null) continue;
    const t = STAFF_TASKS.find((x) => free[x] > 0);
    if (t) free[t]--;
    out[i] = t ?? 'wolny';
  }
  return out as ShiftTask[];
}

/**
 * Kto z ludzi na zmianie czym się zajmuje: jedna pozycja na każdą osobę (`id` od 0), z zadaniem albo `'wolny'`. To odczyt
 * `shift.people`, zapisanego w ostatniej minucie, dopasowany do liczby osób na zmianie teraz:
 * - Więcej osób niż w zapisie (zatrudnienie, początek zmiany): nowe numery to `'wolny'`. Gdy w zapisie nikogo nie ma
 *   (pierwsza minuta po otwarciu: poprzednia była nocna), osoba 0 stoi na kasie, żeby rano nikt nie zaczynał na zapleczu.
 * - Mniej osób (zwolnienie, chory): ucięte od najwyższych numerów.
 * - Poza godzinami pracy pusto.
 */
export function staffOnShift(state: EconomyState): Array<{ id: number; task: ShiftTask }> {
  const n = peopleOnShift(state);
  const stored = state.shift.people;
  const list: ShiftTask[] = stored.slice(0, n);
  if (stored.length === 0 && n > 0) list.push('kasa');
  while (list.length < n) list.push('wolny');
  return list.map((task, id) => ({ id, task }));
}
