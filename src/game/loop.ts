import { SIM_STEP } from '@/sim/crowd/crowd';

/** Prędkość gry: 0 = pauza, reszta to mnożnik czasu symulacji. */
export type Speed = 0 | 1 | 2 | 4 | 8;

/** Ramka dłuższa niż to (karta w tle, zacięcie) liczy się jako tyle, żeby symulacja nie „nadrabiała” w jednym skoku. */
export const MAX_FRAME_DT = 0.1;          // s
/** Bezpiecznik: ile kroków SIM_STEP wolno wykonać w jednej ramce. */
export const MAX_STEPS_PER_FRAME = 32;

const STEP_EPSILON = 1e-9;                // s; błąd zaokrągleń przy porównaniu acc ≥ SIM_STEP

/**
 * Pętla o stałym kroku: dolicza czas ramki (przycięty do MAX_FRAME_DT i przeskalowany prędkością) do `clock.acc`
 * i zwraca, ile kroków SIM_STEP trzeba wykonać. Mutuje `clock.acc` (zostaje w nim reszta, mniejsza niż SIM_STEP).
 * Porównanie `acc ≥ SIM_STEP` ma tolerancję 1e-9 s. Gdy bezpiecznik MAX_STEPS_PER_FRAME zadziała, reszta czasu
 * przepada (symulacja zwalnia zamiast gonić w nieskończoność). Pauza (prędkość 0) nie zmienia `acc`.
 */
export function advanceClock(clock: { acc: number }, frameDt: number, speed: Speed): number {
  if (speed === 0) return 0;
  if (frameDt > 0) clock.acc += Math.min(frameDt, MAX_FRAME_DT) * speed;   // NaN i ujemne dt nic nie dodają

  let steps = 0;
  while (clock.acc >= SIM_STEP - STEP_EPSILON && steps < MAX_STEPS_PER_FRAME) {
    clock.acc -= SIM_STEP;
    steps++;
  }
  if (clock.acc >= SIM_STEP - STEP_EPSILON) clock.acc = 0;   // bezpiecznik: porzucamy zaległość
  else if (clock.acc < 0) clock.acc = 0;                     // tolerancja mogła zejść tuż poniżej zera
  return steps;
}

/** Ułamek kroku, który minął od ostatniego wykonanego: współczynnik interpolacji dla renderu, w [0, 1]. */
export function clockAlpha(clock: { acc: number }): number {
  return Math.min(1, Math.max(0, clock.acc / SIM_STEP));
}
