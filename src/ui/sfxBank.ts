/**
 * Czysta logika dźwięków z próbek: rodzaje dźwięków, tabele głośności i rozrzutu wysokości, wybór wariantu, limit głosów,
 * decyzja „próbka czy synteza” i odczyt manifestu. Bez Web Audio i bez DOM, a losowość dostaje z zewnątrz (`rand`), więc
 * testy są deterministyczne. Silnik, który tego używa, to sfxEngine.ts; pliki powstają z `npm run audio`
 * (scripts/process-audio.mjs, wybór dźwięków: scripts/audio-map.json) i leżą w public/assets/audio.
 */

/** Rodzaje dźwięków gry. Te same nazwy są kluczami w scripts/audio-map.json i public/assets/audio/manifest.json. */
export const SFX_KINDS = ['tap', 'cash', 'coins', 'levelup', 'gift', 'pop', 'fine', 'golden', 'delivery', 'error'] as const;
export type Sfx = (typeof SFX_KINDS)[number];

/** Ile próbek może grać naraz; nowy dźwięk ponad limit przepada (stuknięcia są częste, a ich nadmiar i tak zlewa się w szum). */
export const MAX_VOICES = 8;

/**
 * Głośność całości. Pliki są wyrównane do −22 LUFS (maksimum „momentary”, K-ważone) przy szczytach do −1 dBFS, a dawna synteza
 * miała w tej samej mierze od −29 do −40 LUFS (obwiednie wykładnicze skracały ją do kilkunastu milisekund). Przy 1,0 gra byłaby
 * więc o 7 do 18 dB głośniejsza niż dotąd; 0,5 daje nagrodom poziom dawnych (+0…+5 dB) i zostawia 6 dB zapasu na nakładające
 * się dźwięki.
 */
export const MASTER_GAIN = 0.5;

/**
 * Głośność rodzaju względem pozostałych (1 = tyle, ile mają pliki po wyrównaniu), mnożona przez MASTER_GAIN. Wartości
 * startowe, do ustawienia na ucho: stuknięcie jest najczęstsze, więc o 6 dB cichsze od nagród (dawna synteza trzymała je jeszcze
 * ciszej); dżingle trochę ciszej, bo przy tej samej głośności „momentary” zajmują słuch dłużej; dostawa i błąd ciszej, bo mają
 * ostre szczyty.
 */
export const SFX_GAIN: Record<Sfx, number> = {
  tap: 0.5, cash: 1, coins: 1, levelup: 0.9, gift: 1, pop: 1, fine: 1, golden: 0.9, delivery: 0.8, error: 0.8,
};

/**
 * Rozrzut wysokości: `playbackRate` losowany z [1 − r, 1 + r]. Tylko częste dźwięki, żeby szybkie stukanie nie brzmiało jak
 * karabin maszynowy; dżingle i rzadkie dźwięki grają zawsze tak samo.
 */
export const PITCH_SPREAD: Record<Sfx, number> = {
  tap: 0.04, cash: 0.04, coins: 0.04, levelup: 0, gift: 0, pop: 0, fine: 0, golden: 0, delivery: 0, error: 0,
};

/** Liczba z [0, 1) z dowolnego `rand`: NaN i wartości spoza przedziału nie wyprowadzają indeksów ani wysokości poza zakres. */
function unit(rand: () => number): number {
  const r = rand();
  if (r >= 0 && r < 1) return r;
  return r >= 1 ? 1 - Number.EPSILON : 0;
}

/**
 * Indeks wariantu 0..count−1, losowy, ale różny od `last` (poprzednio zagranego), gdy wariantów jest więcej niż jeden.
 * Losuje spośród pozostałych count−1 i przeskakuje `last`, więc rozkład jest równy, a nie „losuj do skutku”.
 */
export function pickVariant(count: number, last: number | undefined, rand: () => number): number {
  if (!(count > 1)) return 0;
  const skip = last !== undefined && last >= 0 && last < count ? last : -1;
  const pool = skip < 0 ? count : count - 1;
  const i = Math.min(pool - 1, Math.floor(unit(rand) * pool));
  return skip >= 0 && i >= skip ? i + 1 : i;
}

/** `playbackRate` z rozrzutem ±`spread`: zawsze w [1 − spread, 1 + spread]; bez rozrzutu dokładnie 1. */
export function pitchRate(spread: number, rand: () => number): number {
  if (!(spread > 0)) return 1;
  return 1 + (unit(rand) * 2 - 1) * spread;
}

/** Czasy końca (w czasie kontekstu audio) tych głosów, które jeszcze grają w chwili `now`. */
export function activeVoices(ends: readonly number[], now: number): number[] {
  return ends.filter((end) => end > now);
}

/** Co zrobić z `play(kind)`: zagrać próbkę, zagrać syntezę albo porzucić dźwięk. */
export type Playback =
  | { how: 'sample'; variant: number; rate: number }
  | { how: 'synth' }
  | { how: 'drop' };

export interface PlaybackInput {
  /** Ile wariantów tego rodzaju jest wczytanych i zdekodowanych (0 = jeszcze się ładują, błąd albo brak w manifeście). */
  variants: number;
  /** Wariant zagrany poprzednio. */
  last: number | undefined;
  /** Ile głosów gra teraz. */
  active: number;
  /** Rozrzut wysokości tego rodzaju (PITCH_SPREAD). */
  spread: number;
  maxVoices?: number;
  rand: () => number;
}

/**
 * Decyzja „próbka czy synteza”: bez wczytanych próbek gra synteza (zawsze, także gdy głosy są zajęte: dźwięk syntezowany nie
 * zajmuje głosu); z próbkami, ale przy pełnym limicie głosów dźwięk przepada; w pozostałych przypadkach gra próbka z wariantem
 * innym niż poprzedni i wysokością z rozrzutem.
 */
export function planPlayback({ variants, last, active, spread, maxVoices = MAX_VOICES, rand }: PlaybackInput): Playback {
  if (!(variants > 0)) return { how: 'synth' };
  if (active >= maxVoices) return { how: 'drop' };
  return { how: 'sample', variant: pickVariant(variants, last, rand), rate: pitchRate(spread, rand) };
}

/** Nazwa pliku z manifestu: sam plik .mp3 w tym katalogu, bez ścieżek (manifest nie może wskazać adresu poza public/assets/audio). */
const SAFE_FILE = /^[A-Za-z0-9_-]+\.mp3$/;

/** Odczyt manifestu (public/assets/audio/manifest.json): tylko znane rodzaje i bezpieczne nazwy plików, reszta jest pomijana. */
export function parseManifest(json: unknown): Partial<Record<Sfx, string[]>> {
  const manifest: Partial<Record<Sfx, string[]>> = {};
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return manifest;
  for (const kind of SFX_KINDS) {
    if (!Object.hasOwn(json, kind)) continue;   // tylko własne pola: dziedziczone z prototypu nie są częścią manifestu
    const list: unknown = (json as Record<string, unknown>)[kind];
    if (!Array.isArray(list)) continue;
    const files = list.filter((file): file is string => typeof file === 'string' && SAFE_FILE.test(file));
    if (files.length > 0) manifest[kind] = files;
  }
  return manifest;
}

/** Cisza na początku bufora poniżej tego (≈ −50 dBFS) albo tego ułamka szczytu (−30 dB), co większe, nie liczy się jako dźwięk. */
const LEAD_FLOOR = 0.003;
const LEAD_RELATIVE = 0.03;
/** Przed pierwszą głośną próbką zostaje 1 ms, żeby nie ściąć początku ataku. */
const LEAD_KEEP = 0.001;
/** Tyle co najwyżej pomijamy (25 ms opóźnienia enkodera MP3 plus miękki początek dźwięku, np. brzęk monet); bez początku w tym czasie bufor gra od początku. */
const LEAD_MAX = 0.06;

/**
 * Ile sekund od początku zdekodowanego bufora pominąć przy odtwarzaniu (argument `offset` w `start`). Pliki z public/assets/audio
 * zaczynają się od ataku, ale MP3 ma opóźnienie enkodera (25 ms) i tylko dekodery, które czytają nagłówek LAME, je odcinają;
 * bez tego stuknięcie spóźniałoby się o 25 ms. Gdy dekoder już je odciął, wynik to 0. Próg jest względny do szczytu, bo przed
 * ostrym atakiem koder rozsmarowuje ciche pre-echo, które nie jest początkiem dźwięku.
 */
export function leadSilence(samples: ArrayLike<number>, sampleRate: number): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));
  const threshold = Math.max(LEAD_FLOOR, peak * LEAD_RELATIVE);
  const limit = Math.min(samples.length, Math.round(LEAD_MAX * sampleRate));
  for (let i = 0; i < limit; i++) {
    if (Math.abs(samples[i]!) >= threshold) return Math.max(0, i / sampleRate - LEAD_KEEP);
  }
  return 0;
}
