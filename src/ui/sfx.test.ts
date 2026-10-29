import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetUrl } from '@/render/assets';
import { SFX_KINDS } from './sfxBank';

/**
 * Publiczne API sfx.ts (to, czego używa reszta gry) z prawdziwym manifestem i plikami z public/assets/audio. Web Audio i fetch to
 * atrapy: fetch czyta z dysku, więc test łapie rozjazd między adresami w kodzie, manifestem i plikami.
 */

class FakeParam {
  value = 1;
  setValueAtTime(): this { return this; }
  exponentialRampToValueAtTime(): this { return this; }
}
class FakeNode {
  connect<T>(destination: T): T { return destination; }
  disconnect(): void { /* atrapa */ }
}
class FakeContext {
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();
  sources = 0;
  oscillators = 0;
  static last: FakeContext | null = null;
  constructor() { FakeContext.last = this; }
  resume(): Promise<void> { return Promise.resolve(); }
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createOscillator() { this.oscillators++; return Object.assign(new FakeNode(), { type: 'sine', frequency: new FakeParam(), start() {}, stop() {} }); }
  createBufferSource() { this.sources++; return Object.assign(new FakeNode(), { buffer: null, playbackRate: new FakeParam(), onended: null, start() {} }); }
  async decodeAudioData(bytes: ArrayBuffer) {
    return { duration: bytes.byteLength / 12000, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => new Float32Array([0.5, 0.4, 0.3]) };
  }
}

/** Odpowiedź fetch z pliku w public/ (adres z BASE_URL jak w przeglądarce), a dla brakującego pliku 404. */
function diskFetch(requested: string[]) {
  return async (url: string) => {
    requested.push(url);
    const path = join('public', url.slice(import.meta.env.BASE_URL.length));
    if (!url.startsWith(import.meta.env.BASE_URL) || !existsSync(path)) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const bytes = readFileSync(path);
    return {
      ok: true, status: 200,
      json: async () => JSON.parse(bytes.toString('utf8')) as unknown,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  FakeContext.last = null;
});

describe('sfx.ts', () => {
  it('eksportuje to samo API co dawniej: play, buzz, setSound, setVibration', async () => {
    const sfx = await import('./sfx');
    expect(Object.keys(sfx).sort()).toEqual(['buzz', 'play', 'setSound', 'setVibration']);
    for (const fn of Object.values(sfx)) expect(typeof fn).toBe('function');
  });

  it('w node (bez Web Audio i bez wibracji) żadne wywołanie nie rzuca', async () => {
    const { play, buzz, setSound, setVibration } = await import('./sfx');
    for (const kind of SFX_KINDS) expect(() => play(kind), kind).not.toThrow();
    expect(() => buzz(8)).not.toThrow();
    expect(() => buzz([15, 30, 15])).not.toThrow();
    expect(() => { setSound(false); play('tap'); setSound(true); setVibration(false); buzz(8); setVibration(true); }).not.toThrow();
  });

  it('z prawdziwym manifestem i plikami z public/assets/audio każdy rodzaj z manifestu gra próbką, a reszta syntezą', async () => {
    const requested: string[] = [];
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', diskFetch(requested));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { play, setSound } = await import('./sfx');

    setSound(false);
    play('tap');
    expect(requested).toEqual([]);   // dźwięk wyłączony: nic się nie pobiera
    setSound(true);

    play('pop');   // pierwszy gest: powstaje kontekst, zaczyna się wczytywanie
    expect(requested[0]).toBe(assetUrl('/assets/audio/manifest.json'));
    await vi.waitFor(() => {
      const manifest = JSON.parse(readFileSync(join('public', 'assets', 'audio', 'manifest.json'), 'utf8')) as Record<string, string[]>;
      expect(requested.length).toBe(1 + Object.values(manifest).flat().length);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));   // dekodowanie ostatnich plików

    const manifest = JSON.parse(readFileSync(join('public', 'assets', 'audio', 'manifest.json'), 'utf8')) as Record<string, string[]>;
    for (const file of Object.values(manifest).flat()) expect(requested, file).toContain(assetUrl(`/assets/audio/${file}`));

    const ctx = FakeContext.last!;
    for (const kind of SFX_KINDS) {
      ctx.currentTime += 10;   // głosy z poprzednich dźwięków dawno skończyły
      const sources = ctx.sources;
      const oscillators = ctx.oscillators;
      play(kind);
      if (manifest[kind]) {
        expect(ctx.sources - sources, `${kind}: próbka`).toBe(1);
        expect(ctx.oscillators - oscillators, `${kind}: bez syntezy`).toBe(0);
      } else {
        expect(ctx.sources - sources, `${kind}: brak próbki`).toBe(0);
        expect(ctx.oscillators - oscillators, `${kind}: synteza`).toBeGreaterThan(0);
      }
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('gdy nie ma manifestu (404): jedno ostrzeżenie w konsoli i dalej gra synteza', async () => {
    vi.stubGlobal('AudioContext', FakeContext);
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { play } = await import('./sfx');
    play('tap');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 10; i++) play('cash');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(FakeContext.last!.sources).toBe(0);
    expect(FakeContext.last!.oscillators).toBeGreaterThan(10);
  });
});
