import { Group, Mesh } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUALITY, type QualityPresetId } from '@/render/quality';
import type { RenderContext } from '@/render/renderer';
import {
  BENCH_CROWD, BENCH_MAX_STALL_RESTARTS, BENCH_PRESETS, BENCH_SEED, BENCH_STALL_MS, BenchRun, createBenchHost, createBenchSession,
  percentile, summarize,
  type BenchHost, type BenchProbe, type BenchProgress, type BenchTimings, type FrameInfo,
} from './bench';

const TIMINGS: BenchTimings = {
  fillTarget: 55, fillMaxMs: 500, prefillMaxMs: 700, warmupMs: 200, measureMs: 1000, probeSettleMs: 100, probeMs: 300, loadMaxMs: 400,
};
const FRAME_MS = 20;

/** Atrapa gospodarza: zapisuje wywołania i pamięta, jaka próba jest włączona. `initial` to preset sprzed biegu. */
function fakeHost(
  applied: Partial<Record<QualityPresetId, QualityPresetId>> = {}, initial: QualityPresetId = 'srednia',
): BenchHost & { log: string[]; probe: BenchProbe | null } {
  const host = {
    log: [] as string[],
    probe: null as BenchProbe | null,
    setPreset(id: QualityPresetId): QualityPresetId {
      host.log.push(`preset:${id}`);
      return applied[id] ?? id;
    },
    setProbe(probe: BenchProbe | null): void {
      host.log.push(`probe:${probe}`);
      host.probe = probe;
    },
    restore(): void {
      host.log.push(`restore:${initial}`);
      host.probe = null;
    },
  };
  return host;
}

interface Drive {
  agents?: (host: { probe: BenchProbe | null }) => number;
  ready?: boolean;
  maxFrames?: number;
  /** Odstęp (ms) przed daną klatką (numer od 1) zamiast FRAME_MS: przerwa w rAF. */
  intervals?: Record<number, number>;
  /** Numery klatek, przed którymi karta przechodzi w tło (`markHidden`). */
  hiddenBefore?: number[];
}

/**
 * Karmi bieg klatkami co FRAME_MS; liczby z renderera zależą od próby (bez cieni postaci mniej wywołań, bez tłumu mniej
 * trójkątów i czasu JS). Klatka i jej numer: klatka 0 startuje zegar, każda następna dostaje swój odstęp.
 */
function drive(
  run: BenchRun, host: { probe: BenchProbe | null },
  { agents = () => 60, ready = true, maxFrames = 5000, intervals = {}, hiddenBefore = [] }: Drive = {},
): void {
  let now = 5000;
  for (let i = 0; i < maxFrames && !run.done; i++) {
    if (i > 0) now += intervals[i] ?? FRAME_MS;
    if (hiddenBefore.includes(i)) run.markHidden();
    const info: FrameInfo = {
      calls: host.probe === 'charShadowsOff' ? 100 : 160,
      tris: host.probe === 'crowdHidden' ? 50_000 : 200_000,
      agents: agents(host),
      ready,
      cpuMs: host.probe === 'crowdHidden' ? 2 : 5,
    };
    run.frame(now, info);
  }
}

describe('percentile i summarize', () => {
  it('percentile: najbliższa ranga, bez interpolacji', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);   // 1..100
    expect(percentile(sorted, 0.95)).toBe(95);
    expect(percentile(sorted, 1)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
  });

  it('summarize: avgFps z sumy czasu, p95 i maksimum z odstępów, średnie liczniki', () => {
    const dt = [...Array(95).fill(10), ...Array(5).fill(50)];   // 95 × 10 ms, 5 × 50 ms
    const stats = summarize({
      dt, calls: dt.map(() => 300), tris: dt.map((_, i) => (i % 2 === 0 ? 1000 : 2001)), agents: dt.map(() => 60),
      cpu: dt.map((_, i) => (i < 90 ? 2 : 6)),
    });
    expect(stats.frames).toBe(100);
    expect(stats.avgFps).toBeCloseTo(100 / 1.2, 1);              // 1200 ms na 100 klatek
    expect(stats.p95FrameMs).toBe(10);                           // 95. wartość z 100 posortowanych to jeszcze 10
    expect(stats.maxFrameMs).toBe(50);
    expect(stats.calls).toBe(300);
    expect(stats.tris).toBe(1501);                               // (50 × 1000 + 50 × 2001) / 100 = 1500,5, zaokrąglone
    expect(stats.agents).toBe(60);
    expect(stats.cpuMs).toBe(2.4);                               // (90 × 2 + 10 × 6) / 100
    expect(stats.cpuP95Ms).toBe(6);                              // 10 największych z 100 to 6 ms
  });

  it('summarize: brak klatek daje zera, nie NaN', () => {
    const stats = summarize({ dt: [], calls: [], tris: [], agents: [], cpu: [] });
    expect(stats).toMatchObject({ frames: 0, avgFps: 0, p95FrameMs: 0, calls: 0, tris: 0, cpuMs: 0, cpuP95Ms: 0 });
  });
});

describe('stałe benchmarku', () => {
  it('seed bench, 60 postaci i 1200 klientów na minutę (ruling R6), presety w kolejności niska, srednia, wysoka', () => {
    expect(BENCH_SEED).toBe('bench');
    expect(BENCH_CROWD).toEqual({ targetCount: 60, spawnPerMinute: 1200 });
    expect(BENCH_PRESETS).toEqual(['niska', 'srednia', 'wysoka']);
  });

  it('przerwy w klatkach: próg 500 ms i do 3 powtórzeń kroku', () => {
    expect(BENCH_STALL_MS).toBe(500);
    expect(BENCH_MAX_STALL_RESTARTS).toBe(3);
  });
});

describe('BenchRun', () => {
  it('przechodzi przez presety po kolei, a próby zdejmuje po każdej', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host);
    expect(run.done).toBe(true);
    expect(host.log).toEqual([
      'preset:niska', 'probe:charShadowsOff', 'probe:null',
      'preset:srednia', 'probe:charShadowsOff', 'probe:null', 'probe:crowdHidden', 'probe:null', 'probe:aoOff', 'probe:null',
      'preset:wysoka', 'probe:charShadowsOff', 'probe:null',
      'restore:srednia',
    ]);
  });

  it('wynik ma dokładnie pola z planu, po jednym wierszu na preset, z liczbami z okna pomiaru', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host);
    const rows = run.rows;
    expect(rows.map((r) => r.preset)).toEqual(['niska', 'srednia', 'wysoka']);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['avgFps', 'calls', 'p95FrameMs', 'preset', 'tris']);
      expect(row.avgFps).toBe(50);              // klatka co 20 ms
      expect(row.p95FrameMs).toBe(20);
      expect(row.calls).toBe(160);              // próba (calls 100) nie wlicza się do pomiaru głównego
      expect(row.tris).toBe(200_000);
    }
  });

  it('próby mają własne liczby: bez cieni postaci mniej wywołań, bez postaci mniej trójkątów; srednia ma trzy próby, reszta jedną', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host);
    const byKey = (preset: string, probe: string) => run.probes.find((p) => p.preset === preset && p.probe === probe);
    expect(run.probes.filter((p) => p.preset === 'niska').map((p) => p.probe)).toEqual(['charShadowsOff']);
    expect(run.probes.filter((p) => p.preset === 'srednia').map((p) => p.probe)).toEqual(['charShadowsOff', 'crowdHidden', 'aoOff']);
    expect(run.probes.filter((p) => p.preset === 'wysoka').map((p) => p.probe)).toEqual(['charShadowsOff']);
    expect(byKey('srednia', 'charShadowsOff')).toMatchObject({ calls: 100, tris: 200_000, cpuMs: 5 });
    expect(byKey('srednia', 'crowdHidden')).toMatchObject({ calls: 160, tris: 50_000, cpuMs: 2 });
    expect(byKey('srednia', 'aoOff')).toMatchObject({ calls: 160, tris: 200_000 });
  });

  it('w oknie próby nie liczy się czas ustalania (probeSettleMs): próba ma ok. probeMs / FRAME_MS klatek', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host);
    const probe = run.probes[0]!;
    expect(probe.frames).toBeGreaterThanOrEqual(TIMINGS.probeMs / FRAME_MS - 2);
    expect(probe.frames).toBeLessThanOrEqual(TIMINGS.probeMs / FRAME_MS);
  });

  it('rozgrzewka tłumu kończy się, gdy jest ≥ 55 postaci, bez czekania na limit', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    let frames = 0;
    drive(run, host, { agents: () => (frames++ < 5 ? 10 : 56) });
    expect(run.warnings).toEqual([]);
    // 5 klatek ustalania nie przekracza fillMaxMs, więc cały bieg trwa krócej niż z limitem
    expect(run.done).toBe(true);
  });

  it('gdy tłum nie dobije do 55, po fillMaxMs idzie dalej i zapisuje ostrzeżenie dla presetu', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host, { agents: () => 30 });
    expect(run.done).toBe(true);
    expect(run.warnings).toHaveLength(4);            // napełnianie przed pierwszym presetem i po jednym na preset
    expect(run.warnings[0]).toContain('rozruch');
    expect(run.warnings[1]).toContain('niska');
    expect(run.warnings[1]).toContain('30');
  });

  it('czeka na scenę (ready), a po loadMaxMs rusza z ostrzeżeniem', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host, { ready: false });
    expect(run.done).toBe(true);
    expect(run.warnings[0]).toContain('sceny');

    const host2 = fakeHost();
    const run2 = new BenchRun(host2, TIMINGS);
    let now = 0;
    const frame = (ready: boolean): void => { run2.frame(now, { calls: 1, tris: 1, agents: 60, ready, cpuMs: 1 }); now += FRAME_MS; };
    for (let i = 0; i < 5; i++) frame(false);
    expect(host2.log).toEqual([]);          // do czasu ready preset nie jest ruszany
    frame(true);                            // scena gotowa: zaczyna się napełnianie sklepu
    frame(true);                            // tłum już pełny: pierwszy preset
    expect(host2.log[0]).toBe('preset:niska');
  });

  it('zapisuje preset faktycznie użyty, gdy renderer zszedł niżej (np. brak AO)', () => {
    const host = fakeHost({ srednia: 'niska' });
    const run = new BenchRun(host, TIMINGS);
    drive(run, host);
    expect(run.warnings.some((w) => w.includes('srednia') && w.includes('niska'))).toBe(true);
    expect(run.extra.presets.find((p) => p.preset === 'srednia')?.applied).toBe('niska');
  });

  it('postęp: status po polsku i wiersze dochodzą po kolei, ostatni raport jest done', () => {
    const host = fakeHost();
    const seen: BenchProgress[] = [];
    const run = new BenchRun(host, TIMINGS, (p) => seen.push(p), BENCH_PRESETS, 0);
    drive(run, host);
    expect(seen.length).toBeGreaterThan(3);
    expect(seen[0]!.done).toBe(false);
    expect(seen.some((p) => /rozgrzewka/.test(p.status))).toBe(true);
    expect(seen.some((p) => /pomiar/.test(p.status))).toBe(true);
    const last = seen[seen.length - 1]!;
    expect(last.done).toBe(true);
    expect(last.rows).toHaveLength(3);
    expect(last.probes).toHaveLength(5);
  });

  it('ramki po zakończeniu są ignorowane', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host);
    const before = host.log.length;
    run.frame(1e9, { calls: 1, tris: 1, agents: 60, ready: true, cpuMs: 1 });
    expect(host.log.length).toBe(before);
    expect(run.rows).toHaveLength(3);
  });

  it('wiersze postępu niosą ramki i maksimum klatki (tabela w nakładce i konsola z tych samych liczb)', () => {
    const host = fakeHost();
    const seen: BenchProgress[] = [];
    const run = new BenchRun(host, TIMINGS, (p) => seen.push(p), BENCH_PRESETS, 0);
    drive(run, host);
    const last = seen[seen.length - 1]!;
    expect(last.rows.every((r) => r.frames >= TIMINGS.measureMs / FRAME_MS - 2 && r.maxFrameMs === FRAME_MS)).toBe(true);
    expect(last.probes.every((p) => p.maxFrameMs === FRAME_MS)).toBe(true);
  });
});

describe('BenchRun: przerwy w klatkach', () => {
  it('przerwa 10 s w środku pomiaru: krok powtórzony z ostrzeżeniem, okno pełne i bez 10-sekundowej klatki w wynikach', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host, { intervals: { 20: 10_000 } });
    expect(run.warnings).toEqual(['niska: przerwa w klatkach 10000 ms (karta w tle?) — krok powtórzony']);
    const niska = run.extra.presets.find((p) => p.preset === 'niska')!;
    expect(niska.frames).toBeGreaterThanOrEqual(TIMINGS.measureMs / FRAME_MS - 2);
    expect(niska.frames).toBeLessThanOrEqual(TIMINGS.measureMs / FRAME_MS);
    expect(niska.maxFrameMs).toBe(FRAME_MS);
    expect(run.rows[0]).toMatchObject({ preset: 'niska', avgFps: 50, p95FrameMs: FRAME_MS });
  });

  it('przerwa 60 s w rozgrzewce: rozgrzewka zaczyna się od nowa, pomiar dopiero po pełnej rozgrzewce', () => {
    const host = fakeHost();
    const statuses: string[] = [];
    const run = new BenchRun(host, TIMINGS, (p) => statuses.push(p.status), BENCH_PRESETS, 0);
    drive(run, host, { intervals: { 6: 60_000 } });
    expect(run.warnings).toEqual(['niska: przerwa w klatkach 60000 ms (karta w tle?) — krok powtórzony']);
    // statuses[i] to stan po klatce i (publikacja przy każdej klatce), więc pierwszy „pomiar” to pierwsza klatka po rozgrzewce
    const measureAt = statuses.findIndex((s) => s.includes('pomiar'));
    expect(measureAt - 6).toBeGreaterThanOrEqual(TIMINGS.warmupMs / FRAME_MS);
  });

  it('przerwa w próbie: etykieta to preset/próba i próba zaczyna się od nowa', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host, { intervals: { 70: 10_000 } });
    expect(run.warnings).toEqual(['niska/charShadowsOff: przerwa w klatkach 10000 ms (karta w tle?) — krok powtórzony']);
    expect(run.probes.find((p) => p.preset === 'niska')).toMatchObject({ probe: 'charShadowsOff', maxFrameMs: FRAME_MS });
  });

  it('cztery przerwy w jednym kroku: trzy powtórzenia, potem ostrzeżenie „za dużo przerw”', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host, { intervals: { 20: 10_000, 25: 10_000, 30: 10_000, 35: 10_000 } });
    expect(run.done).toBe(true);
    expect(run.warnings.filter((w) => w.endsWith('— krok powtórzony'))).toHaveLength(BENCH_MAX_STALL_RESTARTS);
    expect(run.warnings.filter((w) => w.endsWith('— za dużo przerw, wynik niepewny'))).toEqual([
      'niska: przerwa w klatkach 10000 ms (karta w tle?) — za dużo przerw, wynik niepewny',
    ]);
  });

  it('karta ukryta przed klatką (markHidden): krok powtórzony z ostrzeżeniem o ukryciu', () => {
    const host = fakeHost();
    const run = new BenchRun(host, TIMINGS);
    drive(run, host, { hiddenBefore: [20] });
    expect(run.warnings).toEqual(['niska: przerwa w klatkach 20 ms (karta ukryta) — krok powtórzony']);
    const niska = run.extra.presets.find((p) => p.preset === 'niska')!;
    expect(niska.frames).toBeGreaterThanOrEqual(TIMINGS.measureMs / FRAME_MS - 2);
  });
});

describe('BenchRun: koniec biegu', () => {
  it('po ostatniej próbie przywraca preset sprzed biegu', () => {
    const host = fakeHost({}, 'niska');
    const run = new BenchRun(host, TIMINGS);
    drive(run, host);
    expect(host.log[host.log.length - 1]).toBe('restore:niska');
  });

  it('gdy przywracanie rzuci wyjątek, wyniki i stan „Gotowe” i tak trafiają do nakładki', () => {
    const host = fakeHost();
    host.restore = () => { throw new Error('renderer'); };
    const seen: BenchProgress[] = [];
    const run = new BenchRun(host, TIMINGS, (p) => seen.push(p), BENCH_PRESETS, 0);
    expect(() => drive(run, host)).toThrow('renderer');
    const last = seen[seen.length - 1]!;
    expect(last.done).toBe(true);
    expect(last.rows).toHaveLength(3);
  });
});

describe('createBenchHost', () => {
  function setup() {
    let current: QualityPresetId = 'srednia';
    const seen: { id: QualityPresetId; ao: string }[] = [];
    const ctx = {
      get preset() { return current; },
      setPreset(id: QualityPresetId) { current = id; seen.push({ id, ao: QUALITY[id].ao }); },
    };
    const crowd = new Group();
    const character = (): Mesh => { const m = new Mesh(); m.castShadow = true; return m; };
    return { ctx, crowd, seen, character, host: createBenchHost(ctx, crowd) };
  }

  it('setPreset przekazuje do renderera i oddaje preset, który faktycznie działa', () => {
    const { host, seen } = setup();
    expect(host.setPreset('wysoka')).toBe('wysoka');
    expect(seen).toEqual([{ id: 'wysoka', ao: 'full' }]);
  });

  it('charShadowsOff wyłącza cienie także postaciom dodanym później i oddaje je po zdjęciu próby', () => {
    const { host, crowd, character } = setup();
    const a = character();
    const bystander = new Mesh();      // mesh, który z natury nie rzuca cienia, zostaje taki
    crowd.add(a, bystander);
    host.setProbe('charShadowsOff');
    expect(a.castShadow).toBe(false);

    const late = character();
    crowd.add(late);                   // nowy klient pojawia się w trakcie próby
    expect(late.castShadow).toBe(true);
    host.beforeRender();
    expect(late.castShadow).toBe(false);

    host.setProbe(null);
    expect(a.castShadow).toBe(true);
    expect(late.castShadow).toBe(true);
    expect(bystander.castShadow).toBe(false);
  });

  it('beforeRender bez próby niczego nie rusza', () => {
    const { host, crowd, character } = setup();
    const a = character();
    crowd.add(a);
    host.beforeRender();
    expect(a.castShadow).toBe(true);
  });

  it('crowdHidden chowa grupę tłumu i ją odsłania', () => {
    const { host, crowd } = setup();
    host.setProbe('crowdHidden');
    expect(crowd.visible).toBe(false);
    host.setProbe(null);
    expect(crowd.visible).toBe(true);
  });

  it('aoOff: renderer dostaje preset bez AO, a tabela QUALITY wraca od razu po ustawieniu presetu', () => {
    const { host, seen } = setup();
    host.setProbe('aoOff');
    expect(seen).toEqual([{ id: 'srednia', ao: 'off' }]);    // renderer zobaczył preset bez AO
    expect(QUALITY.srednia.ao).toBe('half');
    host.setProbe(null);
    expect(seen[1]).toEqual({ id: 'srednia', ao: 'half' });  // zdjęcie próby przywraca AO
    expect(QUALITY.srednia.ao).toBe('half');
  });

  it('aoOff: gdy renderer rzuci wyjątek, tabela QUALITY i tak wraca do stanu wyjściowego (finally)', () => {
    const before = QUALITY.srednia.ao;
    const ctx = {
      get preset(): QualityPresetId { return 'srednia'; },
      setPreset(id: QualityPresetId) { if (QUALITY[id].ao === 'off') throw new Error('brak AO w sterowniku'); },
    };
    const host = createBenchHost(ctx, new Group());
    expect(() => host.setProbe('aoOff')).toThrow('brak AO w sterowniku');
    expect(QUALITY.srednia.ao).toBe(before);
  });

  it('restore wraca do presetu sprzed biegu, zdejmuje próbę i zgłasza każdy ustawiony preset', () => {
    let current: QualityPresetId = 'srednia';
    const ctx = { get preset() { return current; }, setPreset(id: QualityPresetId) { current = id; } };
    const crowd = new Group();
    const reported: QualityPresetId[] = [];
    const host = createBenchHost(ctx, crowd, (id) => { reported.push(id); });
    host.setPreset('wysoka');
    host.setProbe('crowdHidden');
    host.restore();
    expect(current).toBe('srednia');
    expect(crowd.visible).toBe(true);
    expect(reported).toEqual(['wysoka', 'srednia']);
  });

  it('zmiana próby na inną najpierw zdejmuje poprzednią', () => {
    const { host, crowd } = setup();
    host.setProbe('crowdHidden');
    host.setProbe('charShadowsOff');
    expect(crowd.visible).toBe(true);
    host.setProbe(null);
  });
});

describe('createBenchSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('karta ukryta w trakcie biegu restartuje krok; po końcu słuchacz zdjęty, a nakładka dostaje bieg próbny', () => {
    const doc = {
      visibilityState: 'visible' as 'visible' | 'hidden',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 728, devicePixelRatio: 2 });
    vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    let current: QualityPresetId = 'srednia';
    const ctx = {
      get preset() { return current; },
      setPreset(id: QualityPresetId) { current = id; },
    } as unknown as RenderContext;
    const progress: BenchProgress[] = [];
    const session = createBenchSession(ctx, new Group(), { quick: true, onProgress: (p) => progress.push(p) });
    expect(doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    const onVisibility = doc.addEventListener.mock.calls[0]![1] as () => void;

    const info: FrameInfo = { calls: 100, tris: 1000, agents: 60, ready: true, cpuMs: 1 };
    let now = 0;
    for (let i = 0; i < 5000 && !(progress[progress.length - 1]?.done); i++) {
      if (i === 60) {
        // klatka 60 to pomiar pierwszego presetu w biegu quick (rozruch i rozgrzewka trwają ok. 55 klatek)
        doc.visibilityState = 'hidden';
        onVisibility();
        doc.visibilityState = 'visible';
      }
      session.beforeRender();
      session.afterRender(now, info);
      now += FRAME_MS;
    }
    const last = progress[progress.length - 1]!;
    expect(last.done).toBe(true);
    expect(last.quick).toBe(true);
    expect(last.warnings).toEqual(['niska: przerwa w klatkach 20 ms (karta ukryta) — krok powtórzony']);
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', onVisibility);
  });
});
