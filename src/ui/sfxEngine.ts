import { MASTER_GAIN, PITCH_SPREAD, SFX_GAIN, SFX_KINDS, activeVoices, leadSilence, parseManifest, planPlayback, type Sfx } from './sfxBank';
import { playSynth } from './sfxSynth';

/**
 * Silnik dźwięków: próbki z public/assets/audio (Kenney, CC0), a gdy ich nie ma, synteza (sfxSynth.ts). Kontekst audio powstaje
 * przy pierwszym geście gracza (wymóg przeglądarek) i wtedy zaczyna się wczytywanie: manifest.json, potem pliki, każdy rodzaj
 * niezależnie od pozostałych. Do końca wczytywania (albo na stałe, gdy się nie uda) `play` gra syntezą, więc brak próbek niczego
 * nie psuje, a błąd wczytania daje najwyżej jedno ostrzeżenie w konsoli. Przy wyłączonym dźwięku nic się nie pobiera.
 * Wyboru wariantu, rozrzutu wysokości i limitu głosów dotyczy sfxBank.ts.
 *
 * Środowisko przeglądarki (`SfxEnv`) przychodzi z zewnątrz: sfx.ts podaje prawdziwe, testy podają atrapy.
 */
export interface SfxEnv {
  /** Tworzy kontekst audio; rzuca, gdy przeglądarka nie ma Web Audio. */
  createContext(): AudioContext;
  fetch(url: string): Promise<Pick<Response, 'ok' | 'status' | 'json' | 'arrayBuffer'>>;
  /** Adres pliku z public/assets/audio (`manifest.json` albo próbka z manifestu). */
  audioUrl(file: string): string;
  rand(): number;
  warn(message: string): void;
  vibrate(pattern: number | number[]): void;
}

export interface SfxPlayer {
  setSound(on: boolean): void;
  setVibration(on: boolean): void;
  play(kind: Sfx): void;
  buzz(pattern: number | number[]): void;
  /** Dla testów: kończy się, gdy skończy się wczytywanie próbek (udane albo nie); nigdy nie jest odrzucona. */
  whenLoaded(): Promise<void>;
}

/** Zdekodowany wariant i ile sekund jego początku pominąć przy odtwarzaniu (leadSilence). */
interface Sample {
  buffer: AudioBuffer;
  offset: number;
}

/** Stuknięcie tuż po poprzednim (w tylu sekundach) to combo: synteza podnosi wtedy wysokość. */
const COMBO_SECONDS = 0.5;

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createSfx(env: SfxEnv): SfxPlayer {
  let ctx: AudioContext | null = null;
  let enabled = true;
  let vibrate = true;
  let lastTap = 0;
  let warned = false;
  let loading: Promise<void> = Promise.resolve();
  const bank = new Map<Sfx, Sample[]>();
  const lastVariant = new Map<Sfx, number>();
  /** Czasy końca grających próbek (czas kontekstu audio). */
  let voices: number[] = [];

  /** Konsola dostaje najwyżej jedno ostrzeżenie na sesję, nawet gdy zawiodło kilka rzeczy. */
  function warnOnce(message: string): void {
    if (warned) return;
    warned = true;
    env.warn(message);
  }

  async function loadSample(a: AudioContext, file: string): Promise<Sample> {
    const res = await env.fetch(env.audioUrl(file));
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const buffer = await a.decodeAudioData(await res.arrayBuffer());
    return { buffer, offset: leadSilence(buffer.getChannelData(0), buffer.sampleRate) };
  }

  /** Wczytuje manifest i próbki; każdy rodzaj trafia do banku, gdy zdekodują się jego pliki, więc jeden wiszący plik nie wstrzymuje reszty. Nie rzuca. */
  async function loadBank(a: AudioContext): Promise<void> {
    let wanted = 0;
    let failed = 0;
    try {
      const res = await env.fetch(env.audioUrl('manifest.json'));
      if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
      const manifest = parseManifest(await res.json());
      await Promise.all(SFX_KINDS.map(async (kind) => {
        const files = manifest[kind];
        if (!files) return;
        const results = await Promise.allSettled(files.map((file) => loadSample(a, file)));
        const samples = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        wanted += results.length;
        failed += results.length - samples.length;
        if (samples.length > 0) bank.set(kind, samples);
      }));
      if (failed > 0) warnOnce(`Dźwięki: nie wczytano ${failed} z ${wanted} próbek, te dźwięki grają syntezą.`);
    } catch (err) {
      warnOnce(`Dźwięki: nie wczytano próbek (${reason(err)}), grają dźwięki syntezowane.`);
    }
  }

  function audio(): AudioContext | null {
    if (!enabled) return null;
    try {
      if (!ctx) {
        ctx = env.createContext();
        loading = loadBank(ctx);
      }
      if (ctx.state === 'suspended') void Promise.resolve(ctx.resume()).catch(() => { /* kontekst zamknięty */ });
      return ctx;
    } catch {
      return null;
    }
  }

  /** Rozpoczyna próbkę (źródło → głośność rodzaju → wyjście). Zwraca false, gdy Web Audio rzuciło: wtedy gra synteza. */
  function startSample(a: AudioContext, kind: Sfx, sample: Sample, rate: number, now: number): boolean {
    try {
      const source = a.createBufferSource();
      source.buffer = sample.buffer;
      source.playbackRate.value = rate;
      const gain = a.createGain();
      gain.gain.value = MASTER_GAIN * SFX_GAIN[kind];
      source.connect(gain).connect(a.destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(0, sample.offset);
      voices.push(now + (sample.buffer.duration - sample.offset) / rate);
      return true;
    } catch {
      return false;
    }
  }

  function play(kind: Sfx): void {
    try {
      const a = audio();
      if (!a) return;
      const now = a.currentTime;
      // stuknięcia: kolejne w ciągu pół sekundy to combo (słychać je w syntezie; próbki mają zamiast tego losowy rozrzut wysokości)
      const combo = kind === 'tap' && now - lastTap < COMBO_SECONDS;
      if (kind === 'tap') lastTap = now;
      voices = activeVoices(voices, now);
      const samples = bank.get(kind);
      const plan = planPlayback({ variants: samples?.length ?? 0, last: lastVariant.get(kind), active: voices.length, spread: PITCH_SPREAD[kind], rand: env.rand });
      if (plan.how === 'drop') return;
      if (plan.how === 'sample' && samples && startSample(a, kind, samples[plan.variant]!, plan.rate, now)) {
        lastVariant.set(kind, plan.variant);
        return;
      }
      playSynth(a, kind, combo);
    } catch (err) {
      warnOnce(`Dźwięki: błąd odtwarzania (${reason(err)}).`);
    }
  }

  return {
    setSound(on) { enabled = on; },
    setVibration(on) { vibrate = on; },
    play,
    buzz(pattern) {
      if (!vibrate) return;
      try { env.vibrate(pattern); } catch { /* brak wibracji */ }
    },
    whenLoaded: () => loading,
  };
}
