import { assetUrl } from '@/render/assets';
import { createSfx } from './sfxEngine';
import type { Sfx } from './sfxBank';

/**
 * Dźwięki gry: przyjemne próbki Kenneya (CC0, public/assets/audio, `npm run audio`), a gdy próbek nie ma (jeszcze się
 * ładują, błąd sieci, brak rodzaju w manifeście), krótkie sygnały syntezowane w Web Audio. Kontekst audio powstaje przy
 * pierwszym geście gracza (wymóg przeglądarek), wtedy też zaczyna się wczytywanie próbek. Wyłączane w ustawieniach. Wibracja
 * na telefonie przez navigator.vibrate. Logika w sfxBank.ts (czysta) i sfxEngine.ts (silnik), synteza w sfxSynth.ts.
 */
export type { Sfx } from './sfxBank';

const player = createSfx({
  createContext: () => new AudioContext(),
  fetch: (url) => fetch(url),
  audioUrl: (file) => assetUrl(`/assets/audio/${file}`),
  rand: Math.random,   // zakaz Math.random dotyczy tylko src/sim
  warn: (message) => console.warn(message),
  vibrate: (pattern) => navigator.vibrate?.(pattern),
});

export function setSound(on: boolean): void { player.setSound(on); }
export function setVibration(on: boolean): void { player.setVibration(on); }
export function play(kind: Sfx): void { player.play(kind); }
export function buzz(pattern: number | number[]): void { player.buzz(pattern); }
