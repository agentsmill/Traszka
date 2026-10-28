import type { Sfx } from './sfxBank';

/**
 * Dźwięki syntezowane w Web Audio (bez plików): krótkie, przyjemne sygnały nagrody. To zapas na czas, gdy próbki z
 * public/assets/audio jeszcze się ładują, nie wczytały się albo nie ma ich w manifeście dla danego rodzaju (sfxEngine.ts).
 * Brzmienie bez zmian względem wersji, która grała wyłącznie syntezą.
 */

/** Jeden ton: częstotliwość (z poślizgiem do `to`), czas, głośność, kształt fali, opóźnienie. */
function tone(a: AudioContext, freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0, to?: number): void {
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Gra syntezowany dźwięk danego rodzaju. `combo`: stuknięcie tuż po poprzednim (przy szybkim stukaniu wysokość lekko rośnie). */
export function playSynth(a: AudioContext, kind: Sfx, combo: boolean): void {
  switch (kind) {
    case 'tap': {
      // przy szybkim stukaniu wysokość lekko rośnie: słychać combo
      const pitch = combo ? 1.06 : 1;
      tone(a, 180 * pitch, 0.07, 0.18, 'triangle', 0, 90);
      break;
    }
    case 'cash': tone(a, 1318, 0.08, 0.12, 'square'); tone(a, 1760, 0.18, 0.1, 'square', 0.06); break;
    case 'coins': [0, 0.06, 0.12].forEach((d, i) => tone(a, 1046 + i * 262, 0.14, 0.1, 'triangle', d)); break;
    case 'levelup': [523, 659, 784, 1046].forEach((f, i) => tone(a, f, 0.22, 0.13, 'triangle', i * 0.1)); tone(a, 1318, 0.5, 0.1, 'sine', 0.42); break;
    case 'gift': [784, 988, 1175, 1568].forEach((f, i) => tone(a, f, 0.16, 0.1, 'sine', i * 0.05)); break;
    case 'pop': tone(a, 600, 0.12, 0.1, 'sine', 0, 1200); break;
    case 'fine': tone(a, 2100, 0.18, 0.08, 'square'); tone(a, 1700, 0.3, 0.08, 'square', 0.2); break;
    case 'golden': [1046, 1318, 1568, 2093].forEach((f, i) => tone(a, f, 0.3, 0.09, 'sine', i * 0.07)); break;
    case 'delivery': tone(a, 440, 0.12, 0.08, 'square'); tone(a, 440, 0.12, 0.08, 'square', 0.18); break;
    case 'error': tone(a, 220, 0.15, 0.1, 'sawtooth', 0, 160); break;
  }
}
