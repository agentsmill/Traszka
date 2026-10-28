import type { StaffAssignment, StaffDuty } from './types';

// Histereza zadań pracowników na ekranie. Gra płynie ok. 20 minut gry na sekundę rzeczywistą, a ekonomia przydziela zadania
// od nowa co minutę gry (czyli co ~0,05 s), więc „co ekonomia chce teraz” przerzucałoby postać między kasą a półką kilkanaście
// razy na sekundę. Widz ma zobaczyć ludzi, którzy dochodzą do miejsca i pracują, więc pokazywane zadanie zmienia się rzadko:
// tylko na granicy kwadransa gry i dopiero wtedy, gdy osoba trzymała poprzednie co najmniej `TASK_DWELL_S`.
//
// Na granicy kwadransa osoba dostaje to zadanie, które ekonomia dawała jej najdłużej w minionym oknie (głosy ważone minutami
// gry), a nie to z ostatniej chwili, więc chwilowy zryw w ostatniej minucie nie przestawia nikogo. Warstwa jest czystą
// „scenografią”: żadnej losowości, zegar to czas widoku przekazywany przez wołającego.

/** Kwadrans gry w minutach: zadanie osoby zmienia się najwyżej na granicy kwadransa. */
export const QUARTER_MIN = 15;
/** Najkrócej tyle sekund czasu widoku (s, jak czas marszu) osoba trzyma zadanie, zanim je zmieni: musi zdążyć dojść i pokazać pracę. */
export const TASK_DWELL_S = 6;

/** Kolejność rozstrzygania remisów, gdy trzymanego zadania nie ma wśród remisujących. */
const DUTY_ORDER: readonly StaffDuty[] = ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny'];

interface Held {
  /** Zadanie pokazywane teraz. */
  duty: StaffDuty;
  /** Czas widoku (s), od którego osoba trzyma `duty` (albo od którego jest w ekipie). */
  since: number;
  /** Minuty gry, przez które ekonomia chciała danego zadania w bieżącym oknie kwadransa. */
  votes: Map<StaffDuty, number>;
}

/** Zadanie z największą liczbą głosów; remis: trzymane, a gdy go w remisie nie ma, pierwsze według `DUTY_ORDER`. */
function majorityDuty(votes: ReadonlyMap<StaffDuty, number>, held: StaffDuty): StaffDuty {
  let best = 0;
  for (const v of votes.values()) if (v > best) best = v;
  if ((votes.get(held) ?? 0) === best) return held;
  return DUTY_ORDER.find((d) => (votes.get(d) ?? 0) === best) ?? held;
}

export class TaskHold {
  private people = new Map<number, Held>();
  /** Minuta gry z poprzedniego przyjętego `update` (null: jeszcze żadnego, albo po `reset`). */
  private lastMinute: number | null = null;
  /** Kwadrans (`floor(minuta / 15)`) ostatnio oceniony; null razem z `lastMinute`. */
  private lastQuarter: number | null = null;

  /** `minute`: minuta gry, `clock`: czas widoku (s), `desired`: co ekonomia chce od każdej osoby teraz. */
  update(minute: number, clock: number, desired: readonly StaffAssignment[]): void {
    // Śmieci na wejściu nie mogą zepsuć stanu: takie wywołanie jest pominięte w całości.
    if (!Number.isFinite(minute) || !Number.isFinite(clock)) return;

    // Minuta cofnęła się: to nowa oś czasu (np. nowa gra), więc nic ze starej nie ma sensu, a wszyscy są nowi.
    if (this.lastMinute !== null && minute < this.lastMinute) this.reset();

    // Przy powtórzonym id liczy się pierwsze wystąpienie.
    const wanted = new Map<number, StaffDuty>();
    for (const a of desired) if (!wanted.has(a.id)) wanted.set(a.id, a.task);

    // Kogo nie ma w `desired`, ten znika od razu (po powrocie jest nową osobą, bez starych głosów).
    for (const id of this.people.keys()) if (!wanted.has(id)) this.people.delete(id);

    // Przyrost głosu: tyle minut, ile minęło od poprzedniego wywołania, ale najwyżej kwadrans (po skoku o godzinę ekonomia
    // „chciała” bieżącego zadania najwyżej kwadrans, bo nie wiemy, co chciała w skoczonym czasie).
    const elapsed = this.lastMinute === null ? 0 : Math.min(minute - this.lastMinute, QUARTER_MIN);
    const gain = elapsed > 0 ? elapsed : 0;

    for (const [id, task] of wanted) {
      const person = this.people.get(id);
      if (person === undefined) {
        // Nowa osoba pokazuje od razu to, czego ekonomia chce, i nie miała jeszcze okna, w którym mogłaby zebrać głosy.
        this.people.set(id, { duty: task, since: clock, votes: new Map() });
      } else if (gain > 0) {
        person.votes.set(task, (person.votes.get(task) ?? 0) + gain);
      }
    }

    // Granica kwadransa. Przy skoku przez wiele kwadransów ocena jest jedna: głosy z okna zbiera się do tego miejsca, więc
    // nic się nie gubi, a po ocenie okno zaczyna od zera.
    const quarter = Math.floor(minute / QUARTER_MIN);
    if (this.lastQuarter !== null && quarter !== this.lastQuarter) this.evaluate(clock);
    this.lastQuarter = quarter;
    this.lastMinute = minute;
  }

  /** Zadanie, które osoba trzyma teraz (undefined: nie ma jej na zmianie). */
  get(id: number): StaffDuty | undefined {
    return this.people.get(id)?.duty;
  }

  reset(): void {
    this.people = new Map();
    this.lastMinute = null;
    this.lastQuarter = null;
  }

  /** Zamyka okno: każdy przechodzi na zadanie przeważające w oknie, o ile odczekał dwell, po czym głosy są zerowane. */
  private evaluate(clock: number): void {
    for (const person of this.people.values()) {
      const next = majorityDuty(person.votes, person.duty);
      if (next !== person.duty && clock - person.since >= TASK_DWELL_S) {
        person.duty = next;
        person.since = clock;
      }
      person.votes.clear();
    }
  }
}
