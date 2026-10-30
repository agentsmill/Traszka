import { startMonthPreview } from '@/sim/economy/monthPreview';
import { monthPreview, type EconView } from '../state';

/*
 * Liczenie podglądu końca miesiąca w tle wątku interfejsu: porcje minut gry z oddawaniem wątku między nimi, żeby telefon nie zamarzał
 * (miesiąc to kilkadziesiąt tysięcy minut). Silnik (`startMonthPreview`) działa na kopii stanu; tu tylko plan porcji i sygnał
 * `monthPreview`. Nie dotyka `econ`, zapisu, dziennika poleceń ani zegara gry.
 */

/** Ile minut gry silnik robi naraz, zanim sprawdzimy zegar (mało, żeby porcja nie wyszła ponad budżet). */
export const CHUNK_MINUTES = 60;
/** Ile ms wątku wolno zająć jednej porcji, zanim oddamy sterowanie (ramka ma ok. 16 ms). */
export const BUDGET_MS = 8;

/** Zależności zegara i planisty (testy podają własne). */
export interface RunDeps {
  now(): number;
  later(fn: () => void): void;
}

const defaultDeps: RunDeps = { now: () => performance.now(), later: (fn) => { setTimeout(fn, 0); } };

let runCounter = 0;

/**
 * Uruchamia podgląd dla bieżącego stanu gry. Gra stoi pod oknem, więc stan się nie zmienia w trakcie liczenia. Zamknięcie okna albo
 * kolejne uruchomienie porzuca to liczenie (po `run` w sygnale). Gdy gry nie ma albo już się skończyła, faza to `none`.
 */
export function runMonthPreview(view: EconView | null, deps: RunDeps = defaultDeps): void {
  if (!view || view.s.gameOver) { monthPreview.value = { phase: 'none' }; return; }
  const run = ++runCounter;
  const job = startMonthPreview(view.s, view.info);
  const startedAt = deps.now();
  const first = job.progress();
  monthPreview.value = { phase: 'running', run, day: first.day, days: first.days };

  const tick = (): void => {
    const now = monthPreview.value;
    if (!now || now.phase !== 'running' || now.run !== run) return;   // okno zamknięte albo to liczenie zastąpiono nowym
    const t0 = deps.now();
    let done = false;
    do { done = job.step(CHUNK_MINUTES); } while (!done && deps.now() - t0 < BUDGET_MS);
    if (done) {
      const result = job.result();
      monthPreview.value = result ? { phase: 'done', result, ms: deps.now() - startedAt } : { phase: 'none' };
      return;
    }
    const p = job.progress();
    monthPreview.value = { phase: 'running', run, day: p.day, days: p.days };
    deps.later(tick);
  };
  deps.later(tick);
}
