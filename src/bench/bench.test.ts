import { Group, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY, type QualityPresetId } from '@/render/quality';
import {
  BENCH_CROWD, BENCH_PRESETS, BENCH_SEED, BenchRun, createBenchHost, percentile, summarize,
  type BenchHost, type BenchProbe, type BenchProgress, type BenchTimings, type FrameInfo,
} from './bench';

const TIMINGS: BenchTimings = {
  fillTarget: 55, fillMaxMs: 500, prefillMaxMs: 700, warmupMs: 200, measureMs: 1000, probeSettleMs: 100, probeMs: 300, loadMaxMs: 400,
};
const FRAME_MS = 20;

/** Atrapa gospodarza: zapisuje wywołania i pamięta, jaka próba jest włączona. */
function fakeHost(applied: Partial<Record<QualityPresetId, QualityPresetId>> = {}): BenchHost & { log: string[]; probe: BenchProbe | null } {
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
  };
  return host;
}

interface Drive { agents?: (host: { probe: BenchProbe | null }) => number; ready?: boolean; maxFrames?: number }

/** Karmi bieg klatkami co FRAME_MS; liczby z renderera zależą od próby (bez cieni postaci mniej wywołań, bez tłumu mniej trójkątów i czasu JS). */
function drive(run: BenchRun, host: { probe: BenchProbe | null }, { agents = () => 60, ready = true, maxFrames = 5000 }: Drive = {}): void {
  let now = 5000;
  for (let i = 0; i < maxFrames && !run.done; i++) {
    const info: FrameInfo = {
      calls: host.probe === 'charShadowsOff' ? 100 : 160,
      tris: host.probe === 'crowdHidden' ? 50_000 : 200_000,
      agents: agents(host),
      ready,
      cpuMs: host.probe === 'crowdHidden' ? 2 : 5,
    };
    run.frame(now, info);
    now += FRAME_MS;
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

  it('aoOff chwilowo wyłącza AO w bieżącym presecie i przywraca QUALITY co do pola', () => {
    const { host, seen } = setup();
    const before = QUALITY.srednia.ao;
    host.setProbe('aoOff');
    expect(seen[0]).toEqual({ id: 'srednia', ao: 'off' });   // renderer zobaczył preset bez AO
    expect(QUALITY.srednia.ao).toBe('off');
    host.setProbe(null);
    expect(seen[1]).toEqual({ id: 'srednia', ao: before });
    expect(QUALITY.srednia.ao).toBe(before);
    expect(QUALITY.srednia.ao).toBe('half');
  });

  it('zmiana próby na inną najpierw zdejmuje poprzednią', () => {
    const { host, crowd } = setup();
    host.setProbe('crowdHidden');
    host.setProbe('charShadowsOff');
    expect(crowd.visible).toBe(true);
    host.setProbe(null);
  });
});
