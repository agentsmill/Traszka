import { signal, type Signal } from '@preact/signals';
import type { Speed } from '@/game/loop';
import type { QualityPresetId } from '@/render/quality';
import type { TimeOfDay } from '@/render/lighting';
import type { PerfSnapshot } from './perfMeter';

/*
 * Stan widoczny w interfejsie. Zmienia go i przycisk, i klawisz, a czyta interfejs. Sterowanie światem jest w main.ts
 * (obiekt `Controls`), więc jedno wywołanie aktualizuje i świat, i sygnał.
 */
export const seed: Signal<string> = signal('');
export const preset: Signal<QualityPresetId> = signal<QualityPresetId>('srednia');
export const speed: Signal<Speed> = signal<Speed>(1);
export const timeOfDay: Signal<TimeOfDay> = signal<TimeOfDay>('day');
export const perf: Signal<PerfSnapshot> = signal<PerfSnapshot>({ fps: 0, ms: 0, calls: 0, tris: 0 });
export const showPerf: Signal<boolean> = signal(false);
/** Komunikat dla gracza z `traszka:notice` albo null. */
export const notice: Signal<string | null> = signal<string | null>(null);

/** Akcje, które interfejs wywołuje w grze. Implementuje je main.ts, wspólnie z klawiszami. */
export interface Controls {
  setSpeed(next: Speed): void;
  /** −1 w lewo (Q), +1 w prawo (E). */
  rotate(dir: 1 | -1): void;
  setTimeOfDay(next: TimeOfDay): void;
  setPreset(next: QualityPresetId): void;
  /** Przebudowuje świat dla wpisanego seeda, bez przeładowania strony. Pusty tekst daje losowy seed. */
  generate(text: string): void;
  /** Nowy losowy seed (klawisz R, przycisk „Losuj”). */
  randomize(): void;
}
