/**
 * „Otwieramy sklep!”: odpowiedź na kliknięcie ma być widoczna od razu, a ciężka praca (budowa świata sklepu, ~1 s na słabszym
 * sprzęcie) zaczyna się dopiero po namalowaniu tej odpowiedzi. Bez tego przeglądarka stoi przez całą budowę z wciśniętym przyciskiem
 * i bez żadnej zmiany na ekranie, bo praca idzie w tym samym zadaniu co kliknięcie, przed pierwszym malowaniem.
 */

/** Najdłużej czekamy na klatkę (ms): karta w tle nie maluje, więc gra nie może czekać na powrót do niej w nieskończoność. */
const PAINT_FALLBACK_MS = 120;

/**
 * Spełnia się tuż po namalowaniu bieżącego stanu interfejsu: `requestAnimationFrame` woła się PRZED malowaniem klatki, więc dopiero
 * zadanie zaplanowane z niego (`setTimeout`) wykonuje się po nim. Karta w tle klatek nie rysuje (rAF stoi), więc po `fallbackMs`
 * spełnia się i tak. Wywołania `raf` i `later` można podmienić w testach.
 */
export function nextPaint(
  fallbackMs: number = PAINT_FALLBACK_MS,
  raf: (callback: () => void) => unknown = (callback) => requestAnimationFrame(callback),
  later: (callback: () => void, ms: number) => unknown = (callback, ms) => setTimeout(callback, ms),
): Promise<void> {
  return new Promise((resolve) => {
    raf(() => later(resolve, 0));
    later(resolve, fallbackMs);
  });
}

export interface Launcher {
  /** Czy start już ruszył (przycisk jest wyłączony, „Wróć do gry” i Escape też nie działają). */
  readonly busy: boolean;
  /**
   * Daje odpowiedź (`feedback`: np. wyłączony przycisk z napisem „Otwieramy…”) od razu, a `work` uruchamia po namalowaniu jej.
   * Drugie wywołanie w międzyczasie nic nie robi. Zwraca, czy ruszyło.
   */
  launch(feedback: () => void, work: () => void): boolean;
}

/** Start sklepu jeden raz, z odpowiedzią przed pracą (`wait` to `nextPaint`; w testach podmieniane). */
export function createLauncher(wait: () => Promise<void> = nextPaint): Launcher {
  let busy = false;
  return {
    get busy() { return busy; },
    launch(feedback, work) {
      if (busy) return false;
      busy = true;
      feedback();
      void wait().then(work);
      return true;
    },
  };
}
