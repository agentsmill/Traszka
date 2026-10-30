import { computed, effect, signal, untracked, type ReadonlySignal, type Signal } from '@preact/signals';
import type { Speed } from '@/game/loop';
import { awaitingDecision } from '@/sim/economy/economy';
import { econ, isWindowOpen, pushToast, ranked, selection, showSettings, speed, tab, tutorialOffer, type Controls } from '../state';
import { setTour } from './memory';
import { buildTour, markOf, type TourCtx, type TourMark, type TourStep } from './steps';

/*
 * Przelot samouczka (spec samouczka, §4): stan, przejścia między krokami, pauza i zaliczanie zadań. Bez DOM: pomiar, fokus
 * i przewijanie robi `TourLayer` (`Tutorial.tsx`). Samouczek nie wysyła poleceń gry; zmienia tylko prędkość (przez `controls`),
 * otwartą zakładkę i zaznaczenie, a zadania wykonuje gracz.
 */

/** Trwający przelot: kroki ułożone na starcie, bieżący krok, prędkość sprzed startu, migawka z wejścia w krok i „✓ Zrobione”. */
export interface TourRun { steps: TourStep[]; index: number; saved: Speed; mark: TourMark; done: boolean }

export const tour: Signal<TourRun | null> = signal<TourRun | null>(null);
export const tourActive = (): boolean => tour.value !== null;

/** Tyle ms po zaliczeniu zadania dymek pokazuje „✓ Zrobione”, zanim przejdzie dalej. */
export const TASK_DONE_MS = 700;
export const RANKED_TOUR_TEXT = 'Samouczek działa w zwykłym sklepie.';

let controls: Pick<Controls, 'setSpeed'> | null = null;
/** Prędkość zmienia się przez `controls` (świat i sygnał razem); podaje je nakładka (`TutorialHost`). Bez nich tylko sygnał (testy). */
export function bindTourControls(c: Pick<Controls, 'setSpeed'> | null): void {
  controls = c;
}
function setSpeed(next: Speed): void {
  if (controls) controls.setSpeed(next);
  else speed.value = next;
}

/** Stan dla kroków: gra, sklep, zakładka i prędkość; null bez gry. */
export function tourCtx(): TourCtx | null {
  const view = econ.value;
  return view ? { s: view.s, info: view.info, tab: tab.value, speed: speed.value } : null;
}

/**
 * Czy przelot czeka, bo nad grą stoi okno, które gracz musi obsłużyć (spec, §4.2): okno z sygnałem, ustawienia, karta decyzji albo
 * koniec gry. Warstwa wtedy znika, a krok i pauza zostają.
 */
export const tourSuspended: ReadonlySignal<boolean> = computed(() => {
  if (!tour.value) return false;
  const s = econ.value?.s;
  return isWindowOpen() || showSettings.value || (!!s && (awaitingDecision(s) || s.gameOver));
});

/** Warstwa przelotu jest na ekranie (dymki „pierwszy raz” wtedy milczą). */
export const tourVisible: ReadonlySignal<boolean> = computed(() => tour.value !== null && !tourSuspended.value);

let advanceTimer: ReturnType<typeof setTimeout> | undefined;
let watching = false;

/** Zaliczanie zadań przy każdej publikacji stanu, zmianie zakładki, prędkości i kroku (raz na życie modułu). */
function watch(): void {
  if (watching) return;
  watching = true;
  effect(() => {
    void econ.value;
    void tab.value;
    void speed.value;
    void tour.value;
    void tourSuspended.value;
    untracked(syncTour);
  });
}

/** Wejście w krok `index`: zakładka, zaznaczenie i pauza według kroku, świeża migawka. */
function enter(run: TourRun, index: number): void {
  const step = run.steps[index]!;
  if (step.tab !== undefined) tab.value = step.tab;
  if (step.clearSelection) selection.value = null;
  if (step.resume) setSpeed(run.saved > 0 ? run.saved : 1);
  const s = econ.value?.s;
  tour.value = { ...run, index, mark: s ? markOf(s) : run.mark, done: false };
}

/**
 * Uruchamia przelot (z okna wyboru, z „Jak grać” albo z ⚙). W biegu rankingowym tylko toast; bez gry, po końcu gry albo w trakcie
 * innego przelotu nic. Zapamiętuje prędkość i pauzuje. Zwraca, czy przelot ruszył.
 */
export function requestTour(): boolean {
  if (ranked.value) {
    pushToast(RANKED_TOUR_TEXT, 'info');
    return false;
  }
  const ctx = tourCtx();
  if (!ctx || ctx.s.gameOver || tour.value) return false;
  clearTimeout(advanceTimer);
  watch();
  const run: TourRun = { steps: buildTour(ctx), index: 0, saved: speed.value, mark: markOf(ctx.s), done: false };
  setSpeed(0);
  enter(run, 0);
  return true;
}

/** „Dalej” (albo zaliczone zadanie): następny krok, a po ostatnim koniec przelotu. */
export function nextStep(): void {
  const run = tour.value;
  if (!run) return;
  clearTimeout(advanceTimer);
  if (run.index >= run.steps.length - 1) finishTour();
  else enter(run, run.index + 1);
}

/** Czy przelot zdjął już pauzę (krok `start` albo dalszy): wtedy czas idzie dalej także po „Pomiń”. */
const resumed = (run: TourRun): boolean => run.steps.slice(0, run.index + 1).some((x) => x.resume);

/** „Pomiń”: koniec przelotu bez przejścia, prędkość sprzed startu (o ile przelot nie zdjął już pauzy), zakładka zamknięta. */
export function skipTour(): void {
  const run = tour.value;
  if (!run) return;
  clearTimeout(advanceTimer);
  tour.value = null;
  setTour('skipped');
  if (!resumed(run)) setSpeed(run.saved);
  tab.value = null;
}

/** „Zakończ” na ostatnim kroku: przelot przejdzie do pamięci jako zrobiony, a czas idzie dalej. */
export function finishTour(): void {
  const run = tour.value;
  if (!run) return;
  clearTimeout(advanceTimer);
  tour.value = null;
  setTour('done');
  if (!resumed(run)) setSpeed(run.saved > 0 ? run.saved : 1);
}

/**
 * Sprawdza zadanie bieżącego kroku. Zaliczone: dymek pokazuje „✓ Zrobione”, a po `TASK_DONE_MS` przelot przechodzi dalej (o ile
 * w tym czasie nic go nie zmieniło). Pod oknem gry (`tourSuspended`) zadania nie są liczone.
 */
export function syncTour(): void {
  const run = tour.value;
  if (!run || run.done || tourSuspended.value) return;
  const task = run.steps[run.index]?.task;
  const ctx = tourCtx();
  if (!task || !ctx || !task.done(ctx, run.mark)) return;
  const doneRun: TourRun = { ...run, done: true };
  tour.value = doneRun;
  clearTimeout(advanceTimer);
  advanceTimer = setTimeout(() => { if (tour.value === doneRun) nextStep(); }, TASK_DONE_MS);
}

/** „Samouczek (ok. 3 min)” w oknie wyboru: odpowiedź do pamięci, okno znika, przelot rusza. */
export function acceptOffer(): void {
  tutorialOffer.value = false;
  setTour('started');
  requestTour();
}

/** „Pomiń, znam grę”: odpowiedź do pamięci, okno znika, gra rusza z prędkością, jaką miała. */
export function declineOffer(): void {
  tutorialOffer.value = false;
  setTour('skipped');
}
