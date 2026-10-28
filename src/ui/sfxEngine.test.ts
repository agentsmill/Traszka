import { describe, expect, it } from 'vitest';
import { MASTER_GAIN, MAX_VOICES, SFX_GAIN, SFX_KINDS, type Sfx } from './sfxBank';
import { createSfx, type SfxEnv, type SfxPlayer } from './sfxEngine';

// --- atrapy Web Audio: zapisują, co silnik z nimi zrobił ---------------------------------------------------------------

class FakeParam {
  value = 1;
  calls: Array<[kind: 'set' | 'exp', value: number, time: number]> = [];
  setValueAtTime(value: number, time: number): this { this.value = value; this.calls.push(['set', value, time]); return this; }
  exponentialRampToValueAtTime(value: number, time: number): this { this.calls.push(['exp', value, time]); return this; }
}

class FakeNode {
  connections: unknown[] = [];
  disconnected = false;
  connect<T>(destination: T): T { this.connections.push(destination); return destination; }
  disconnect(): void { this.disconnected = true; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  start(): void { /* zapisane przez konstruktor atrapy */ }
  stop(): void { /* jw. */ }
  /** Częstotliwość początkowa tonu. */
  get freq(): number | undefined { return this.frequency.calls[0]?.[1]; }
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam();
  starts: Array<{ when: number; offset: number }> = [];
  onended: (() => void) | null = null;
  start(when = 0, offset = 0): void { this.starts.push({ when, offset }); }
}

interface FileSpec { duration: number; /** cisza przed atakiem w zdekodowanym buforze, w sekundach (opóźnienie enkodera MP3) */ lead?: number }

class FakeBuffer {
  readonly sampleRate = 44100;
  readonly numberOfChannels = 1;
  constructor(readonly file: string, readonly duration: number, private readonly lead: number) {}
  getChannelData(): Float32Array {
    const data = new Float32Array(Math.round(this.duration * this.sampleRate));
    for (let i = Math.round(this.lead * this.sampleRate); i < data.length; i++) data[i] = 0.5 * Math.sin(i * 0.2) + (i % 7 === 0 ? 0.3 : 0);
    return data;
  }
}

class FakeContext {
  currentTime = 0;
  state: 'running' | 'suspended' = 'suspended';
  resumeCalls = 0;
  resumeResult: () => Promise<void> = () => Promise.resolve();
  destination = new FakeNode();
  sources: FakeSource[] = [];
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  failCreateSource = false;
  failCreateOscillator = false;
  constructor(private readonly files: Record<string, FileSpec>, private readonly failDecode: Set<string>) {}

  resume(): Promise<void> { this.resumeCalls++; this.state = 'running'; return this.resumeResult(); }
  createGain(): FakeGain { const g = new FakeGain(); this.gains.push(g); return g; }
  createOscillator(): FakeOscillator {
    if (this.failCreateOscillator) throw new Error('oscylator niedostępny');
    const o = new FakeOscillator(); this.oscillators.push(o); return o;
  }
  createBufferSource(): FakeSource {
    if (this.failCreateSource) throw new Error('źródło niedostępne');
    const s = new FakeSource(); this.sources.push(s); return s;
  }
  async decodeAudioData(bytes: ArrayBuffer): Promise<FakeBuffer> {
    const file = new TextDecoder().decode(bytes);
    if (this.failDecode.has(file)) throw new DOMException('Unable to decode audio data', 'EncodingError');
    const spec = this.files[file];
    if (!spec) throw new Error(`atrapa: nieznany plik ${file}`);
    return new FakeBuffer(file, spec.duration, spec.lead ?? 0);
  }
}

// --- środowisko ------------------------------------------------------------------------------------------------------------

const MANIFEST = { tap: ['tap-0.mp3', 'tap-1.mp3', 'tap-2.mp3'], cash: ['cash-0.mp3'], levelup: ['levelup-0.mp3'] };
const FILES: Record<string, FileSpec> = {
  'tap-0.mp3': { duration: 0.12 }, 'tap-1.mp3': { duration: 0.12 }, 'tap-2.mp3': { duration: 0.12 },
  'cash-0.mp3': { duration: 0.3 }, 'levelup-0.mp3': { duration: 1.4 },
};

/** Generator liczb pseudolosowych z ziarnem (LCG): `Math.random` w testach by je rozchwiał. */
function lcg(seed = 7): () => number {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
}

interface Options {
  manifest?: unknown;
  files?: Record<string, FileSpec>;
  /** manifest.json: 'network' = fetch odrzucony, 'status' = HTTP 404, 'json' = odpowiedź nie jest JSON-em */
  manifestFailure?: 'network' | 'status' | 'json';
  /** pliki, które mają zawieść: 'network' | 'status' | 'decode' */
  fileFailures?: Record<string, 'network' | 'status' | 'decode'>;
  rand?: () => number;
  noWebAudio?: boolean;
}

function setup(options: Options = {}) {
  const fetched: string[] = [];
  const warnings: string[] = [];
  const vibrations: Array<number | number[]> = [];
  const contexts: FakeContext[] = [];
  let contextCalls = 0;
  const failDecode = new Set(Object.entries(options.fileFailures ?? {}).filter(([, how]) => how === 'decode').map(([file]) => file));

  const env: SfxEnv = {
    createContext: () => {
      contextCalls++;
      if (options.noWebAudio) throw new ReferenceError('AudioContext is not defined');
      const ctx = new FakeContext(options.files ?? FILES, failDecode);
      contexts.push(ctx);
      return ctx as unknown as AudioContext;
    },
    audioUrl: (file) => `./assets/audio/${file}`,
    fetch: async (url) => {
      fetched.push(url);
      const file = url.replace('./assets/audio/', '');
      if (file === 'manifest.json') {
        if (options.manifestFailure === 'network') throw new TypeError('Failed to fetch');
        if (options.manifestFailure === 'status') return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
        return {
          ok: true, status: 200,
          json: async () => { if (options.manifestFailure === 'json') throw new SyntaxError('Unexpected token <'); return options.manifest ?? MANIFEST; },
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      }
      const failure = options.fileFailures?.[file];
      if (failure === 'network') throw new TypeError('Failed to fetch');
      if (failure === 'status') return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      const encoded = new TextEncoder().encode(file);
      return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer };
    },
    rand: options.rand ?? lcg(),
    warn: (message) => { warnings.push(message); },
    vibrate: (pattern) => { vibrations.push(pattern); },
  };
  const sfx: SfxPlayer = createSfx(env);
  /** Kontekst audio powstaje przy pierwszym `play`, więc testy sięgają po niego dopiero po nim. */
  const ctx = (): FakeContext => {
    const created = contexts[0];
    if (!created) throw new Error('kontekst jeszcze nie powstał');
    return created;
  };
  return { sfx, ctx, fetched, warnings, vibrations, contexts, contextCalls: () => contextCalls };
}

/** Gra pierwszy dźwięk (powstaje kontekst, zaczyna się wczytywanie) i czeka na koniec wczytywania. */
async function loaded(options: Options = {}) {
  const t = setup(options);
  t.sfx.play('pop');   // dźwięk, którego nie ma w manifeście testowym: nie zaśmieca źródeł próbek
  await t.sfx.whenLoaded();
  t.ctx().oscillators.length = 0;
  t.ctx().sources.length = 0;
  return t;
}

// --- testy ----------------------------------------------------------------------------------------------------------------

describe('wczytywanie próbek', () => {
  it('przy wyłączonym dźwięku nic nie powstaje i nic się nie pobiera', async () => {
    const t = setup();
    t.sfx.setSound(false);
    t.sfx.play('tap');
    t.sfx.play('levelup');
    await t.sfx.whenLoaded();
    expect(t.contextCalls()).toBe(0);
    expect(t.fetched).toEqual([]);
  });

  it('bez żadnego dźwięku nic się nie pobiera: wczytywanie rusza dopiero z pierwszym play (gestem gracza)', async () => {
    const t = setup();
    t.sfx.setSound(true);
    t.sfx.setVibration(true);
    await t.sfx.whenLoaded();
    expect(t.contextCalls()).toBe(0);
    expect(t.fetched).toEqual([]);
  });

  it('pierwszy dźwięk tworzy kontekst raz, pobiera manifest i każdy plik z manifestu dokładnie raz', async () => {
    const t = setup();
    t.sfx.play('tap');
    t.sfx.play('tap');
    t.sfx.play('cash');
    await t.sfx.whenLoaded();
    expect(t.contextCalls()).toBe(1);
    expect(t.fetched[0]).toBe('./assets/audio/manifest.json');
    expect([...t.fetched].sort()).toEqual([
      './assets/audio/cash-0.mp3', './assets/audio/levelup-0.mp3', './assets/audio/manifest.json',
      './assets/audio/tap-0.mp3', './assets/audio/tap-1.mp3', './assets/audio/tap-2.mp3',
    ]);
  });

  it('do końca wczytywania gra synteza, potem próbki', async () => {
    const t = setup();
    t.sfx.play('tap');
    expect(t.ctx().sources).toHaveLength(0);
    expect(t.ctx().oscillators).toHaveLength(1);
    await t.sfx.whenLoaded();
    t.ctx().oscillators.length = 0;
    t.sfx.play('tap');
    expect(t.ctx().sources).toHaveLength(1);
    expect(t.ctx().oscillators).toHaveLength(0);
  });

  it('wyłączenie dźwięku w trakcie wczytywania nie przerywa go, ale wyłączony dźwięk nie gra', async () => {
    const t = setup();
    t.sfx.play('tap');
    t.sfx.setSound(false);
    await t.sfx.whenLoaded();
    t.ctx().oscillators.length = 0;
    t.sfx.play('tap');
    expect(t.ctx().sources).toHaveLength(0);
    expect(t.ctx().oscillators).toHaveLength(0);
    t.sfx.setSound(true);
    t.sfx.play('tap');
    expect(t.ctx().sources).toHaveLength(1);
    expect(t.contextCalls()).toBe(1);
  });

  it('rodzaj bez wpisu w manifeście gra syntezą, reszta próbkami', async () => {
    const t = await loaded();
    t.sfx.play('gift');
    t.sfx.play('cash');
    expect(t.ctx().oscillators).toHaveLength(4);   // gift: cztery tony
    expect(t.ctx().sources).toHaveLength(1);
  });

  it('nieznane rodzaje i nieprawidłowe nazwy w manifeście są pomijane bez błędu', async () => {
    const t = setup({ manifest: { tap: ['../tap-0.mp3', 'tap-1.mp3'], nieznany: ['x.mp3'], cash: 'cash-0.mp3' } });
    t.sfx.play('tap');
    await t.sfx.whenLoaded();
    expect(t.fetched).toEqual(['./assets/audio/manifest.json', './assets/audio/tap-1.mp3']);
    expect(t.warnings).toEqual([]);
  });
});

describe('błędy wczytywania: zostaje synteza, najwyżej jedno ostrzeżenie, nic nie rzuca', () => {
  const failures: Array<[string, Options]> = [
    ['manifest: fetch odrzucony (sieć)', { manifestFailure: 'network' }],
    ['manifest: HTTP 404', { manifestFailure: 'status' }],
    ['manifest: odpowiedź nie jest JSON-em (np. strona 404 z hostingu)', { manifestFailure: 'json' }],
    ['wszystkie pliki: HTTP 404', { fileFailures: { 'tap-0.mp3': 'status', 'tap-1.mp3': 'status', 'tap-2.mp3': 'status', 'cash-0.mp3': 'status', 'levelup-0.mp3': 'status' } }],
    ['wszystkie pliki: błąd dekodowania', { fileFailures: { 'tap-0.mp3': 'decode', 'tap-1.mp3': 'decode', 'tap-2.mp3': 'decode', 'cash-0.mp3': 'decode', 'levelup-0.mp3': 'decode' } }],
  ];

  it.each(failures)('%s', async (_name, options) => {
    const t = setup(options);
    t.sfx.play('tap');
    await t.sfx.whenLoaded();
    for (const kind of SFX_KINDS) {
      t.ctx().oscillators.length = 0;
      expect(() => t.sfx.play(kind), kind).not.toThrow();
      expect(t.ctx().oscillators.length, `${kind}: synteza`).toBeGreaterThan(0);
    }
    expect(t.ctx().sources).toHaveLength(0);
    expect(t.warnings).toHaveLength(1);
    for (let i = 0; i < 20; i++) t.sfx.play('tap');
    expect(t.warnings).toHaveLength(1);   // nie zasypuje konsoli
  });

  it('jeden zepsuty plik wyłącza tylko swój wariant: reszta wariantów gra, ostrzeżenie jest jedno', async () => {
    const t = await loaded({ fileFailures: { 'tap-1.mp3': 'status', 'cash-0.mp3': 'decode' } });
    const used = new Set<unknown>();
    for (let i = 0; i < 40; i++) {
      t.ctx().currentTime += 1;   // głosy z poprzednich dźwięków dawno skończyły
      t.sfx.play('tap');
    }
    for (const s of t.ctx().sources) used.add((s.buffer as FakeBuffer).file);
    expect([...used].sort()).toEqual(['tap-0.mp3', 'tap-2.mp3']);
    t.ctx().oscillators.length = 0;
    t.sfx.play('cash');
    expect(t.ctx().oscillators).toHaveLength(2);   // cash zawiodło całkiem: synteza
    t.sfx.play('levelup');
    expect(t.ctx().sources.at(-1)?.starts).toHaveLength(1);
    expect(t.warnings).toHaveLength(1);
    expect(t.warnings[0]).toContain('2 z 5');
  });

  it('wiszący plik jednego rodzaju nie wstrzymuje pozostałych', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const contexts: FakeContext[] = [];
    // plik levelup-0.mp3 nie kończy się pobierać, dopóki nie zwolnimy bramki
    const sfx = createSfx({
      createContext: () => { const c = new FakeContext(FILES, new Set()); contexts.push(c); return c as unknown as AudioContext; },
      audioUrl: (file) => file,
      fetch: async (url) => {
        if (url === 'manifest.json') return { ok: true, status: 200, json: async () => MANIFEST, arrayBuffer: async () => new ArrayBuffer(0) };
        if (url === 'levelup-0.mp3') await gate;
        const bytes = new TextEncoder().encode(url);
        return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
      },
      rand: lcg(), warn: () => {}, vibrate: () => {},
    });
    sfx.play('tap');
    await new Promise((resolve) => setTimeout(resolve, 5));   // tap i cash zdążyły się wczytać, levelup wisi
    const ctx = contexts[0]!;
    ctx.oscillators.length = 0;
    sfx.play('tap');
    sfx.play('levelup');
    expect(ctx.sources).toHaveLength(1);        // tap: już próbka
    expect(ctx.oscillators).toHaveLength(5);    // levelup: jeszcze synteza (cztery tony i ton końcowy)
    release();
    await sfx.whenLoaded();
    sfx.play('levelup');
    expect(ctx.sources).toHaveLength(2);
  });

  it('brak Web Audio w przeglądarce: play nie rzuca, niczego nie pobiera i nie ostrzega (jak dotąd)', async () => {
    const t = setup({ noWebAudio: true });
    expect(() => t.sfx.play('tap')).not.toThrow();
    expect(() => t.sfx.play('levelup')).not.toThrow();
    await t.sfx.whenLoaded();
    expect(t.fetched).toEqual([]);
    expect(t.warnings).toEqual([]);
  });

  it('wyjątek z Web Audio przy próbce: gra synteza zamiast próbki, bez wyjątku', async () => {
    const t = await loaded();
    t.ctx().failCreateSource = true;
    expect(() => t.sfx.play('tap')).not.toThrow();
    expect(t.ctx().oscillators).toHaveLength(1);
  });

  it('wyjątek z syntezy też nie wychodzi do gry; ostrzeżenie jest jedno', async () => {
    const t = setup({ manifestFailure: 'status' });
    t.sfx.play('pop');
    await t.sfx.whenLoaded();
    t.ctx().failCreateOscillator = true;
    expect(() => t.sfx.play('tap')).not.toThrow();
    expect(() => t.sfx.play('cash')).not.toThrow();
    expect(t.warnings).toHaveLength(1);   // to samo jedno ostrzeżenie co o manifeście
  });

  it('wznowienie kontekstu, które się nie uda, nie kończy się nieobsłużonym odrzuceniem obietnicy', async () => {
    const t = setup();
    t.sfx.play('pop');
    t.ctx().resumeResult = () => Promise.reject(new Error('kontekst zamknięty'));
    t.ctx().state = 'suspended';
    expect(() => t.sfx.play('tap')).not.toThrow();
    await t.sfx.whenLoaded();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('odtwarzanie próbek', () => {
  it('próbka idzie przez głośność rodzaju (MASTER_GAIN × tabela) do wyjścia kontekstu', async () => {
    const t = await loaded();
    t.sfx.play('tap');
    const source = t.ctx().sources[0]!;
    const gain = t.ctx().gains.at(-1)!;
    expect(gain.gain.value).toBeCloseTo(MASTER_GAIN * SFX_GAIN.tap, 12);
    expect(source.connections).toEqual([gain]);
    expect(gain.connections).toEqual([t.ctx().destination]);
    expect(source.starts).toHaveLength(1);
  });

  it('każdy rodzaj ma własną głośność z tabeli', async () => {
    const t = await loaded({ manifest: Object.fromEntries(SFX_KINDS.map((k) => [k, [`${k === 'tap' ? 'tap-0' : 'cash-0'}.mp3`]])) });
    for (const kind of SFX_KINDS) {
      t.ctx().currentTime += 10;
      t.sfx.play(kind);
      expect(t.ctx().gains.at(-1)!.gain.value, kind).toBeCloseTo(MASTER_GAIN * SFX_GAIN[kind], 12);
    }
  });

  it('wariant nigdy nie powtarza się dwa razy z rzędu, a wszystkie warianty są używane', async () => {
    const t = await loaded();
    const order: string[] = [];
    for (let i = 0; i < 60; i++) {
      t.ctx().currentTime += 1;
      t.sfx.play('tap');
      order.push((t.ctx().sources.at(-1)!.buffer as FakeBuffer).file);
    }
    for (let i = 1; i < order.length; i++) expect(order[i], `dźwięk ${i}`).not.toBe(order[i - 1]);
    expect(new Set(order)).toEqual(new Set(['tap-0.mp3', 'tap-1.mp3', 'tap-2.mp3']));
  });

  it('rodzaj z jednym wariantem gra ten wariant za każdym razem', async () => {
    const t = await loaded();
    for (let i = 0; i < 5; i++) { t.ctx().currentTime += 1; t.sfx.play('cash'); }
    expect(t.ctx().sources.map((s) => (s.buffer as FakeBuffer).file)).toEqual(Array(5).fill('cash-0.mp3'));
  });

  it('częste dźwięki dostają rozrzut wysokości w granicach ±4% i naprawdę się różnią; dżingle grają z rate 1', async () => {
    const t = await loaded();
    const rates = new Set<number>();
    for (let i = 0; i < 80; i++) {
      t.ctx().currentTime += 1;
      t.sfx.play(i % 2 ? 'tap' : 'cash');
      const rate = t.ctx().sources.at(-1)!.playbackRate.value;
      expect(rate).toBeGreaterThanOrEqual(0.96);
      expect(rate).toBeLessThanOrEqual(1.04);
      rates.add(rate);
    }
    expect(rates.size).toBeGreaterThan(40);
    t.sfx.play('levelup');
    expect(t.ctx().sources.at(-1)!.playbackRate.value).toBe(1);
  });

  it('początek bufora z ciszą (opóźnienie enkodera MP3, którego dekoder nie odciął) jest pomijany argumentem offset', async () => {
    const t = await loaded({ files: { ...FILES, 'tap-0.mp3': { duration: 0.15, lead: 0.025 }, 'tap-1.mp3': { duration: 0.15, lead: 0.025 }, 'tap-2.mp3': { duration: 0.15, lead: 0.025 }, 'cash-0.mp3': { duration: 0.3 } } });
    t.sfx.play('tap');
    t.sfx.play('cash');
    const [tap, cash] = t.ctx().sources;
    expect(tap!.starts[0]!.offset).toBeGreaterThan(0.022);
    expect(tap!.starts[0]!.offset).toBeLessThan(0.025);
    expect(cash!.starts[0]!.offset).toBe(0);
  });

  it('po zakończeniu źródła jego węzły są odłączane', async () => {
    const t = await loaded();
    t.sfx.play('cash');
    const source = t.ctx().sources[0]!;
    const gain = t.ctx().gains.at(-1)!;
    source.onended?.();
    expect(source.disconnected).toBe(true);
    expect(gain.disconnected).toBe(true);
  });

  it('wznawia zawieszony kontekst (wymóg przeglądarek), a działającego nie rusza', async () => {
    const t = setup();
    t.sfx.play('tap');
    expect(t.ctx().resumeCalls).toBe(1);
    t.sfx.play('tap');
    expect(t.ctx().resumeCalls).toBe(1);   // atrapa po resume jest już „running”
    t.ctx().state = 'suspended';
    t.sfx.play('tap');
    expect(t.ctx().resumeCalls).toBe(2);
    await t.sfx.whenLoaded();
  });
});

describe('limit głosów', () => {
  it(`do ${MAX_VOICES} próbek naraz, ponad limit nowy dźwięk przepada (bez syntezy)`, async () => {
    const t = await loaded();
    for (let i = 0; i < MAX_VOICES + 5; i++) t.sfx.play('levelup');   // czas stoi: żaden głos nie kończy się
    expect(t.ctx().sources).toHaveLength(MAX_VOICES);
    expect(t.ctx().oscillators).toHaveLength(0);
  });

  it('głos kończy się po długości próbki (z uwzględnieniem wysokości): potem znowu można grać', async () => {
    const t = await loaded();
    for (let i = 0; i < MAX_VOICES; i++) t.sfx.play('tap');   // stuknięcia po 0,12 s
    t.sfx.play('tap');
    expect(t.ctx().sources).toHaveLength(MAX_VOICES);          // dziewiąte przepadło
    t.ctx().currentTime = 0.05;
    t.sfx.play('tap');
    expect(t.ctx().sources).toHaveLength(MAX_VOICES);          // nadal wszystkie grają
    t.ctx().currentTime = 0.2;                                 // 0,12 s / 0,96 = 0,125 s: wszystkie skończone
    t.sfx.play('tap');
    expect(t.ctx().sources).toHaveLength(MAX_VOICES + 1);
  });

  it('wolny głos zwalnia się po jednym: dźwięk krótki kończy się przed długim', async () => {
    const t = await loaded();
    for (let i = 0; i < MAX_VOICES - 1; i++) t.sfx.play('levelup');   // 7 długich (1,4 s)
    t.sfx.play('cash');                                               // ósmy: krótki (0,3 s)
    t.sfx.play('cash');                                               // przepadł
    expect(t.ctx().sources).toHaveLength(MAX_VOICES);
    t.ctx().currentTime = 0.5;                                        // cash skończył się, levelupy grają
    t.sfx.play('tap');
    expect(t.ctx().sources).toHaveLength(MAX_VOICES + 1);
    t.sfx.play('tap');
    expect(t.ctx().sources).toHaveLength(MAX_VOICES + 1);             // znowu pełno
  });

  it('dźwięk syntezowany nie liczy się do limitu ani nie przepada, nawet przy zajętych głosach', async () => {
    const t = await loaded();
    for (let i = 0; i < MAX_VOICES; i++) t.sfx.play('levelup');
    t.sfx.play('gift');   // bez próbki w manifeście
    expect(t.ctx().oscillators).toHaveLength(4);
  });
});

describe('synteza (zapas): brzmienie jak przed próbkami', () => {
  // tony dawnej syntezy: częstotliwości początkowe po kolei (src/ui/sfxSynth.ts); kolejność wywołań jak w switchu
  const EXPECTED: Record<Sfx, number[]> = {
    tap: [180], cash: [1318, 1760], coins: [1046, 1308, 1570], levelup: [523, 659, 784, 1046, 1318],
    gift: [784, 988, 1175, 1568], pop: [600], fine: [2100, 1700], golden: [1046, 1318, 1568, 2093], delivery: [440, 440], error: [220],
  };

  it.each(SFX_KINDS.map((kind) => [kind] as const))('%s: te same tony co dawniej, wprost do wyjścia (bez głośności próbek)', async (kind) => {
    const t = setup({ manifestFailure: 'status' });
    t.sfx.play('pop');            // tworzy kontekst
    const ctx = t.ctx();
    ctx.currentTime = 10;         // pierwsze stuknięcie przy czasie 0 liczyłoby się jako combo (jak w dawnej wersji)
    ctx.oscillators.length = 0;
    ctx.gains.length = 0;
    t.sfx.play(kind);
    expect(ctx.oscillators.map((o) => o.freq)).toEqual(EXPECTED[kind]);
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.gains).toHaveLength(EXPECTED[kind].length);
    for (const g of ctx.gains) expect(g.connections).toEqual([ctx.destination]);
    await t.sfx.whenLoaded();
  });

  it('stuknięcia szybciej niż co 0,5 s podnoszą wysokość o 6% (combo), wolniejsze nie', async () => {
    const t = setup({ manifestFailure: 'status' });
    t.sfx.play('pop');   // tworzy kontekst
    const ctx = t.ctx();
    ctx.oscillators.length = 0;
    // czasy dokładnie reprezentowalne, żeby granica 0,5 s była jednoznaczna
    for (const time of [10, 10.25, 11, 11.25, 11.75]) {
      ctx.currentTime = time;
      t.sfx.play('tap');
    }
    const freqs = ctx.oscillators.map((o) => o.freq!);
    expect(freqs[0]).toBeCloseTo(180, 9);          // pierwsze po długiej przerwie
    expect(freqs[1]).toBeCloseTo(180 * 1.06, 9);   // 0,25 s po poprzednim
    expect(freqs[2]).toBeCloseTo(180, 9);          // 0,75 s po poprzednim
    expect(freqs[3]).toBeCloseTo(180 * 1.06, 9);   // 0,25 s
    expect(freqs[4]).toBeCloseTo(180, 9);          // dokładnie 0,5 s to już nie combo (jak w dawnej wersji: ostra nierówność)
    await t.sfx.whenLoaded();
  });
});

describe('wibracja', () => {
  it('buzz przekazuje wzorzec, dopóki wibracja jest włączona', () => {
    const t = setup();
    t.sfx.buzz(8);
    t.sfx.buzz([15, 30, 15]);
    expect(t.vibrations).toEqual([8, [15, 30, 15]]);
    t.sfx.setVibration(false);
    t.sfx.buzz(8);
    expect(t.vibrations).toHaveLength(2);
    t.sfx.setVibration(true);
    t.sfx.buzz(5);
    expect(t.vibrations.at(-1)).toBe(5);
  });

  it('wibracja nie zależy od dźwięku', () => {
    const t = setup();
    t.sfx.setSound(false);
    t.sfx.buzz(8);
    expect(t.vibrations).toEqual([8]);
  });

  it('wyjątek z navigator.vibrate nie wychodzi do gry', () => {
    const sfx = createSfx({
      createContext: () => { throw new Error('brak'); }, audioUrl: (f) => f, fetch: async () => { throw new Error('brak'); },
      rand: Math.random, warn: () => {}, vibrate: () => { throw new Error('zablokowane'); },
    });
    expect(() => sfx.buzz(8)).not.toThrow();
  });
});
