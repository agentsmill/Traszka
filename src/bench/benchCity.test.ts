import { Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraRig } from '@/render/cameraRig';
import { cityProfile } from '@/render/city/cityQuality';
import type { QualityPresetId } from '@/render/quality';
import type { RenderContext } from '@/render/renderer';
import { createSceneHost, type SceneHost } from '@/game/scene';
import { generateCity } from '@/sim/city/generateCity';
import {
  BENCH_SEED, BenchRun, createBenchCityScene, createBenchHost,
  type BenchCityRow, type BenchTimings, type FrameInfo,
} from './bench';

/*
 * Miasto w benchmarku na prawdziwej scenie gry (atrapa kontekstu renderera, prawdziwa kamera i scena three.js, bez WebGL): bieg `BenchRun`
 * na sztucznym zegarze przechodzi przez presety, a każdy wiersz miasta ma mierzyć się pod profilem własnego presetu (Rozstrzygnięcie 13:
 * liczby bramki z prawdziwych urządzeń nie mogą pochodzić z profilu poprzedniego wiersza). Dowód to `cityStats()` zapisane w wierszu.
 */

/** Bez sieci: ulica dostaje same grupy rekwizytów, a prawdziwy loader nie trzyma w Node niedokończonych żądań. */
vi.mock('@/render/assets', async (original) => ({
  ...(await original<typeof import('@/render/assets')>()),
  loadGLB: () => Promise.reject(new Error('brak sieci')),
}));

const TIMINGS: BenchTimings = {
  fillTarget: 55, fillMaxMs: 500, prefillMaxMs: 700, warmupMs: 200, measureMs: 1000, probeSettleMs: 100, probeMs: 300, loadMaxMs: 400,
  cityWarmupMs: 100, cityMeasureMs: 600,
};
const FRAME_MS = 20;

function fakeContext(preset: QualityPresetId): RenderContext {
  let current = preset;
  return {
    renderer: {} as RenderContext['renderer'],
    scene: new Scene(),
    rig: new CameraRig(1.6),
    get preset() { return current; },
    setPreset(id: QualityPresetId) { current = id; },
    setTimeOfDay: vi.fn(),
    setStaticShadows: vi.fn(),
    refreshShadows: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  } as RenderContext;
}

/** Prawdziwa scena gry + prawdziwy gospodarz benchmarku; `isMobile` jawnie, żeby profil nie zależał od Node'a, pod którym biegną testy. */
function benchOn(initial: QualityPresetId, isMobile: boolean) {
  const ctx = fakeContext(initial);
  const scene = createSceneHost({ ctx, cashierLook: { kind: 'default' } as never, forcedNight: false, exterior: false, zoomPinned: false, overlay: null, isMobile });
  const city = createBenchCityScene(scene, isMobile);
  const applied: QualityPresetId[] = [];
  const host = createBenchHost(ctx, scene.crowdRoot, city, (id) => { applied.push(id); });
  return { ctx, scene, city, host, applied };
}

function runToEnd(run: BenchRun): void {
  let now = 5000;
  const info: FrameInfo = { calls: 100, tris: 1000, agents: 60, ready: true, cpuMs: 1 };
  for (let i = 0; i < 5000 && !run.done; i++) {
    run.frame(now, info);
    now += FRAME_MS;
  }
  expect(run.done).toBe(true);
}

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rowOf = (rows: readonly BenchCityRow[], preset: string, layer: string): BenchCityRow =>
  rows.find((r) => r.preset === preset && r.layer === layer)!;

describe('createBenchCityScene', () => {
  it('miasto benchmarku to generateCity(BENCH_SEED) ze stanami lokali z generatora, bez firmy; generowane raz', () => {
    const { scene } = benchOn('srednia', false);
    const showCity = vi.spyOn(scene, 'showCity');
    const city = createBenchCityScene(scene, false);
    city.show('makieta');
    city.show('ruch');
    const [first, states, layer] = showCity.mock.calls[0]!;
    expect(first).toEqual(generateCity(BENCH_SEED));
    expect(states).toEqual(Object.fromEntries(first.lots.map((l) => [l.id, l.state])));
    expect(layer).toBe('makieta');
    expect(showCity.mock.calls[1]![0]).toBe(first);   // to samo miasto (scena porównuje po tożsamości)
  });

  it('show chowa miasto przed pokazaniem: każdy wiersz zaczyna od świeżego widoku pod bieżącym presetem i z tym samym kadrem', () => {
    const { scene, city } = benchOn('niska', false);
    const hideCity = vi.spyOn(scene, 'hideCity');
    const showCity = vi.spyOn(scene, 'showCity');
    city.show('makieta');
    expect(hideCity).toHaveBeenCalledTimes(1);
    expect(hideCity.mock.invocationCallOrder[0]!).toBeLessThan(showCity.mock.invocationCallOrder[0]!);
    expect(scene.cityShown).toBe(true);
    city.hide();
    expect(scene.cityShown).toBe(false);
  });

  it('profile(preset) to profil miasta z `cityProfile`, a telefon wygrywa z presetem', () => {
    const { scene } = benchOn('srednia', false);
    expect(createBenchCityScene(scene, false).profile('wysoka')).toBe(cityProfile('wysoka', false));
    expect(createBenchCityScene(scene, true).profile('wysoka')).toBe(cityProfile('niska', true));
  });
});

describe('bench z prawdziwą sceną: każdy wiersz miasta pod profilem własnego presetu', () => {
  async function fullRun(isMobile: boolean, initial: QualityPresetId = 'srednia') {
    const b = benchOn(initial, isMobile);
    b.scene.load(BENCH_SEED, null);
    await vi.waitFor(() => expect(b.scene.loaded?.street).toBeTruthy(), { timeout: 4000, interval: 10 });
    const run = new BenchRun(b.host, TIMINGS);
    runToEnd(run);
    return { ...b, run };
  }

  it('komputer: Niska bez aut i cieni (makieta pełna, „ruch” na prostej geometrii), Średnia i Wysoka z autami i cieniami statycznymi', async () => {
    const { run } = await fullRun(false);
    expect(run.city.map((r) => `${r.preset}/${r.layer}`)).toEqual(['niska/makieta', 'niska/ruch', 'srednia/makieta', 'wysoka/makieta']);

    const niskaMakieta = rowOf(run.city, 'niska', 'makieta').stats!;
    expect(niskaMakieta).toMatchObject({ shown: true, built: true, detail: 'pelny', layer: 'makieta', cars: 0, shadowCasters: 0 });
    const niskaRuch = rowOf(run.city, 'niska', 'ruch').stats!;
    expect(niskaRuch).toMatchObject({ shown: true, built: true, detail: 'prosty', layer: 'ruch', cars: 0, shadowCasters: 0 });
    for (const preset of ['srednia', 'wysoka']) {
      const stats = rowOf(run.city, preset, 'makieta').stats!;
      expect(stats).toMatchObject({ shown: true, built: true, detail: 'pelny', layer: 'makieta' });
      expect(stats.cars).toBeGreaterThan(0);
      expect(stats.shadowCasters).toBeGreaterThan(0);
    }
  });

  it('komputer: dla każdego wiersza auta, cienie i szczegółowość zgadzają się z profilem jego presetu (nie poprzedniego wiersza)', async () => {
    const { run } = await fullRun(false);
    for (const row of run.city) {
      const profile = cityProfile(row.preset, false);
      expect(row.profile).toBe(profile);
      expect(row.applied).toBe(row.preset);
      expect(row.stats!.cars > 0, `${row.preset}/${row.layer}: auta`).toBe(profile.cars);
      expect(row.stats!.shadowCasters > 0, `${row.preset}/${row.layer}: cienie`).toBe(profile.shadows === 'static');
      expect(row.stats!.detail, `${row.preset}/${row.layer}: geometria`).toBe(row.layer === 'makieta' ? 'pelny' : profile.firstDetail);
      expect(row.stats!.layer).toBe(row.layer);
    }
  });

  it('telefon: wszystkie wiersze pod profilem „telefon” (bez aut i cieni), także przy Średniej i Wysokiej', async () => {
    const { run } = await fullRun(true, 'niska');
    expect(run.city).toHaveLength(4);
    for (const row of run.city) {
      expect(row.profile).toBe(cityProfile(row.preset, true));
      expect(row.stats).toMatchObject({ cars: 0, shadowCasters: 0, detail: row.layer === 'makieta' ? 'pelny' : 'prosty' });
    }
  });

  it('miasto mieści się w budżecie §19 w każdym wierszu (wywołania rysowania sceny i rzucające cień)', async () => {
    const { run } = await fullRun(false);
    for (const row of run.city) {
      const { drawCalls, shadowCasters } = row.stats!;
      expect(drawCalls + shadowCasters, `${row.preset}/${row.layer}`).toBeLessThan(row.layer === 'makieta' ? 150 : 60);
    }
  });

  it('po biegu sklep wraca: miasto schowane, preset sprzed biegu, a każdy ustawiony preset zgłoszony nakładce', async () => {
    const { scene, ctx, run, applied } = await fullRun(false);
    expect(run.done).toBe(true);
    expect(scene.cityShown).toBe(false);
    expect(scene.loaded!.view.root.visible).toBe(true);
    expect(ctx.preset).toBe('srednia');
    expect(applied[applied.length - 1]).toBe('srednia');
    // na końcu: miasto pod Niską, Średnią i Wysoką (po presetach sklepu i ich próbach), potem powrót do presetu sprzed biegu
    expect(applied.slice(-4)).toEqual(['niska', 'srednia', 'wysoka', 'srednia']);
  });
});
