import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/game/memoryStorage';
import type { Speed } from '@/game/loop';
import { applyCommand } from '@/sim/economy/commands';
import { createEconomy, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { econ, isWindowOpen, offerTutorial, ranked, report, selection, showSettings, speed, tab, toasts, tutorialOffer } from '../state';
import { loadTutorial, setTour } from './memory';
import {
  RANKED_TOUR_TEXT, TASK_DONE_MS, acceptOffer, bindTourControls, declineOffer, finishTour, nextStep, requestTour, skipTour, tour, tourActive,
  tourSuspended, tourVisible,
} from './tour';

let g: { s: EconomyState; info: StoreInfo };
let version = 0;
const publish = (): void => { econ.value = { s: g.s, info: g.info, v: ++version }; };
const stepId = (): string | undefined => tour.value?.steps[tour.value.index]?.id;
/** „Dalej” aż do kroku `id` (zadania po drodze zalicza test sam, jak gracz). */
function goTo(id: string): void {
  for (let i = 0; i < 20 && stepId() !== id; i++) nextStep();
  expect(stepId()).toBe(id);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', new MemoryStorage());
  const info = computeStoreInfo(layoutFor('przelot-1', 0));
  g = { s: createEconomy('przelot-1', info), info };
  publish();
  speed.value = 1;
  tab.value = null;
  selection.value = null;
  ranked.value = null;
  report.value = null;
  showSettings.value = false;
  tutorialOffer.value = false;
  toasts.value = [];
  bindTourControls(null);
});
afterEach(() => {
  skipTour();
  tour.value = null;
  econ.value = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('start przelotu', () => {
  it('pauzuje, zapamiętuje prędkość, zamyka zakładkę i zaznaczenie, zaczyna od kroku „cel”', () => {
    speed.value = 4;
    tab.value = 'ludzie';
    selection.value = { kind: 'till' };
    expect(requestTour()).toBe(true);
    expect(tourActive()).toBe(true);
    expect(speed.value).toBe(0);
    expect(tour.value!.saved).toBe(4);
    expect(stepId()).toBe('cel');
    expect(tab.value).toBeNull();
    expect(selection.value).toBeNull();
    expect(tour.value!.steps).toHaveLength(16);
  });

  it('prędkość idzie przez controls, gdy są podpięte (świat i sygnał razem)', () => {
    const calls: Speed[] = [];
    bindTourControls({ setSpeed: (v) => { calls.push(v); speed.value = v; } });
    requestTour();
    expect(calls).toEqual([0]);
  });

  it('w biegu rankingowym: tylko toast „Samouczek działa w zwykłym sklepie.”', () => {
    ranked.value = { seed: 'x', day: 3, days: 91, phase: 'playing' };
    expect(requestTour()).toBe(false);
    expect(tourActive()).toBe(false);
    expect(speed.value).toBe(1);
    expect(toasts.value.map((t) => t.text)).toEqual([RANKED_TOUR_TEXT]);
  });

  it('bez gry, po końcu gry i w trakcie innego przelotu: nic', () => {
    econ.value = null;
    expect(requestTour()).toBe(false);
    publish();
    g.s.gameOver = true;
    expect(requestTour()).toBe(false);
    g.s.gameOver = false;
    expect(requestTour()).toBe(true);
    expect(requestTour()).toBe(false);
  });
});

describe('kroki i zadania', () => {
  it('„Dalej” idzie krok po kroku; kroki ustawiają swoje zakładki', () => {
    requestTour();
    goTo('miejsca');
    expect(tab.value).toBe('palety');
    nextStep();
    expect(stepId()).toBe('ludzie');
    expect(tab.value).toBe('ludzie');
    goTo('cele');
    expect(tab.value).toBe('cele');
    nextStep();
    expect(tab.value).toBeNull();
  });

  it('zadanie z zakładkami: gracz otwiera Palety, dymek pokazuje „✓ Zrobione” i po chwili idzie dalej sam', () => {
    requestTour();
    goTo('zakladki');
    tab.value = 'palety';
    expect(tour.value!.done).toBe(true);
    expect(stepId()).toBe('zakladki');
    vi.advanceTimersByTime(TASK_DONE_MS);
    expect(stepId()).toBe('reczne');
  });

  it('przełącznik zamówienia: dwa zadania gracza, przelot zostawia Asystenta', () => {
    requestTour();
    goTo('reczne');
    applyCommand(g.s, g.info, { type: 'setOrder', auto: false, manual: g.s.order.manual });
    publish();
    vi.advanceTimersByTime(TASK_DONE_MS);
    expect(stepId()).toBe('asystent');
    applyCommand(g.s, g.info, { type: 'setOrder', auto: true });
    publish();
    vi.advanceTimersByTime(TASK_DONE_MS);
    expect(stepId()).toBe('miejsca');
    expect(g.s.order.auto).toBe(true);
  });

  it('krok „start” zdejmuje pauzę: prędkość sprzed startu, a z pauzy ×1; stuknięcie gracza zalicza zadanie', () => {
    speed.value = 2;
    requestTour();
    goTo('start');
    expect(speed.value).toBe(2);
    applyCommand(g.s, g.info, { type: 'tapPallet' });
    publish();
    vi.advanceTimersByTime(TASK_DONE_MS);
    expect(stepId()).toBe('pomoc');
    skipTour();
    speed.value = 0;
    requestTour();
    goTo('start');
    expect(speed.value).toBe(1);
  });

  it('ostatni krok to „?”, a jego przycisk kończy przelot: pamięć „done”, czas idzie', () => {
    requestTour();
    goTo('pomoc');
    expect(tour.value!.steps[tour.value!.index]!.target).toBe('help');
    nextStep();
    expect(tourActive()).toBe(false);
    expect(loadTutorial().tour).toBe('done');
    expect(speed.value).toBe(1);
  });
});

describe('„Pomiń” i koniec', () => {
  it('przed krokiem „start”: prędkość sprzed startu, zakładka zamknięta, pamięć „skipped”', () => {
    speed.value = 8;
    requestTour();
    goTo('miejsca');
    skipTour();
    expect(tourActive()).toBe(false);
    expect(speed.value).toBe(8);
    expect(tab.value).toBeNull();
    expect(loadTutorial().tour).toBe('skipped');
  });

  it('uruchomiony w pauzie: „Pomiń” wraca do pauzy', () => {
    speed.value = 0;
    requestTour();
    skipTour();
    expect(speed.value).toBe(0);
  });

  it('po kroku „start” czas już idzie i tak zostaje', () => {
    requestTour();
    goTo('pomoc');
    skipTour();
    expect(speed.value).toBe(1);
  });

  it('„Pomiń” nie odbiera przejścia: gracz, który raz skończył, zostaje z „done”', () => {
    setTour('done');
    requestTour();
    skipTour();
    expect(loadTutorial().tour).toBe('done');
  });

  it('finishTour bez kroku „start” (przelot ucięty) nie zostawia gry w pauzie', () => {
    requestTour();
    finishTour();
    expect(speed.value).toBe(1);
  });
});

describe('okno gry w trakcie przelotu', () => {
  it('raport miesiąca wstrzymuje przelot: warstwy nie ma, zadania nie są liczone, krok zostaje', () => {
    requestTour();
    goTo('zakladki');
    report.value = { statement: null } as unknown as MonthReport;
    expect(tourSuspended.value).toBe(true);
    expect(tourVisible.value).toBe(false);
    tab.value = 'palety';
    expect(tour.value!.done).toBe(false);
    report.value = null;
    expect(tourVisible.value).toBe(true);
    expect(tour.value!.done).toBe(true);   // po zamknięciu okna zadanie liczy się od razu
  });

  it('ustawienia też wstrzymują przelot', () => {
    requestTour();
    showSettings.value = true;
    expect(tourSuspended.value).toBe(true);
    showSettings.value = false;
    expect(tourSuspended.value).toBe(false);
  });
});

describe('okno wyboru', () => {
  it('offerTutorial: tylko przy pustej pamięci; okno trzyma grę', () => {
    offerTutorial();
    expect(tutorialOffer.value).toBe(true);
    expect(isWindowOpen()).toBe(true);
    tutorialOffer.value = false;
    setTour('skipped');
    offerTutorial();
    expect(tutorialOffer.value).toBe(false);
  });

  it('„Samouczek (ok. 3 min)”: okno znika, pamięć „started”, przelot rusza', () => {
    tutorialOffer.value = true;
    acceptOffer();
    expect(tutorialOffer.value).toBe(false);
    expect(loadTutorial().tour).toBe('started');
    expect(tourActive()).toBe(true);
    expect(tourVisible.value).toBe(true);
  });

  it('„Pomiń, znam grę”: okno znika, pamięć „skipped”, czas bez zmian', () => {
    tutorialOffer.value = true;
    declineOffer();
    expect(tutorialOffer.value).toBe(false);
    expect(loadTutorial().tour).toBe('skipped');
    expect(tourActive()).toBe(false);
    expect(speed.value).toBe(1);
  });
});
