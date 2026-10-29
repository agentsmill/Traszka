import { signal, type Signal } from '@preact/signals';
import type { RankingClient } from '../ranking/client';

/**
 * Chip „Seed tygodnia” na ekranie startowym: pyta serwer rankingu o seed bieżącego tygodnia i wpisuje go w pole seeda. Stan chipa
 * i unieważnianie spóźnionych odpowiedzi są tutaj (bez haków), żeby miały testy; widok tylko je pokazuje (StartScreen.tsx).
 */

export const WEEK_CHIP = 'Seed tygodnia';
export const WEEK_WAITING = 'Pytamy Centralę…';
export const WEEK_UNAVAILABLE = 'Seed tygodnia jest teraz niedostępny';

/** `idle`: chip do kliknięcia; `loading`: czekamy na serwer; `unavailable`: serwer nie odpowiedział (komunikat pod polem). */
export type WeekStatus = 'idle' | 'loading' | 'unavailable';

export interface WeekSeedPicker {
  readonly status: Signal<WeekStatus>;
  /** Pyta serwer (raz naraz) i przy odpowiedzi woła `apply` z seedem; przy braku odpowiedzi zostawia pole nietknięte i ustawia `unavailable`. */
  pick(): void;
  /** Gracz sam zmienił seed (wpis, kostka) albo ekran się zamyka: komunikat znika, a odpowiedź, która jeszcze nadejdzie, jest ignorowana. */
  reset(): void;
}

export function createWeekSeedPicker(load: () => Promise<string | null>, apply: (seed: string) => void): WeekSeedPicker {
  const status = signal<WeekStatus>('idle');
  /** Numer zapytania: odpowiedź na zapytanie unieważnione przez `reset` albo nowsze nic nie zmienia. */
  let ticket = 0;
  return {
    status,
    pick() {
      if (status.value === 'loading') return;
      const mine = ++ticket;
      status.value = 'loading';
      const settle = (seed: string | null): void => {
        if (mine !== ticket) return;
        if (seed) {
          status.value = 'idle';
          apply(seed);
        } else {
          status.value = 'unavailable';
        }
      };
      let asked: Promise<string | null>;
      try {
        asked = load();
      } catch {
        asked = Promise.resolve(null);   // funkcja, która rzuca zamiast zwrócić obietnicę, to też brak odpowiedzi
      }
      void asked.then(settle, () => settle(null));
    },
    reset() {
      ticket++;
      status.value = 'idle';
    },
  };
}

/**
 * Seed tygodnia z klienta rankingu (`board('week')`): seed z odpowiedzi albo null, gdy serwer nie odpowiada (`ranking-off`, `network`,
 * `unavailable`), odpowiedź nie ma seeda albo klient rzuci.
 */
export function weekSeedOf(client: Pick<RankingClient, 'board'>): () => Promise<string | null> {
  return async () => {
    try {
      const reply = await client.board('week');
      return reply.ok && reply.week.seed ? reply.week.seed : null;
    } catch {
      return null;
    }
  };
}
