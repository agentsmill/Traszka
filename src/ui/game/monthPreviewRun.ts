import { startMonthPreview, type MonthPreview } from '@/sim/economy/monthPreview';
import { startFirmMonthPreview, type FirmPreview } from '@/sim/firm/preview';
import { firm, monthPreview, type EconView, type FirmView, type MonthPreviewView } from '../state';

/*
 * Liczenie podglądu końca miesiąca w tle wątku interfejsu: porcje minut gry z oddawaniem wątku między nimi, żeby telefon nie zamarzał
 * (miesiąc to kilkadziesiąt tysięcy minut). Silnik działa na kopii stanu: przy firmie `startFirmMonthPreview` (wszystkie sklepy na wspólnej
 * gotówce, spec §11.3), bez firmy `startMonthPreview` jednego sklepu; tu tylko plan porcji i sygnał `monthPreview`. Nie dotyka `econ`,
 * firmy, zapisu, dziennika poleceń ani zegara gry.
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
 * Wynik do sygnału: sklep bez firmy to jego podgląd; firma daje podgląd aktywnego sklepu (albo pierwszego, który zamknął miesiąc) jako
 * `result` i, gdy po drodze działają co najmniej dwa sklepy, część na każdy sklep w `firm`. Firma bez wyniku (gra skończona) to `none`.
 */
function doneView(solo: MonthPreview | null, group: FirmPreview | null, activeId: number | null, ms: number): MonthPreviewView {
  if (!group) return solo ? { phase: 'done', result: solo, ms } : { phase: 'none' };
  const mine = group.stores.find((x) => x.id === activeId) ?? group.stores[0];
  if (!mine) return { phase: 'none' };
  return group.stores.length >= 2 ? { phase: 'done', result: mine.preview, ms, firm: group } : { phase: 'done', result: mine.preview, ms };
}

/**
 * Uruchamia podgląd dla bieżącego stanu gry. Gra stoi pod oknem, więc stan się nie zmienia w trakcie liczenia. Zamknięcie okna albo
 * kolejne uruchomienie porzuca to liczenie (po `run` w sygnale). Gdy gry nie ma albo już się skończyła, faza to `none`. `firmView`:
 * firma, na której stoi gra (domyślnie sygnał `firm`); z nią podgląd liczy wszystkie sklepy razem.
 */
export function runMonthPreview(view: EconView | null, deps: RunDeps = defaultDeps, firmView: FirmView | null = firm.value): void {
  if (!view || view.s.gameOver || firmView?.f.over) { monthPreview.value = { phase: 'none' }; return; }
  const run = ++runCounter;
  const solo = firmView ? null : startMonthPreview(view.s, view.info);
  const group = firmView ? startFirmMonthPreview(firmView.f) : null;
  const job = solo ?? group!;
  const activeId = firmView ? firmView.f.activeId : null;
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
      monthPreview.value = doneView(solo?.result() ?? null, group?.result() ?? null, activeId, deps.now() - startedAt);
      return;
    }
    const p = job.progress();
    monthPreview.value = { phase: 'running', run, day: p.day, days: p.days };
    deps.later(tick);
  };
  deps.later(tick);
}
