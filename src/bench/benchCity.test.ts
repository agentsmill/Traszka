import { Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraRig } from '@/render/cameraRig';
import { cityProfile, type CityProfile } from '@/render/city/cityQuality';
import type { QualityPresetId } from '@/render/quality';
import type { RenderContext } from '@/render/renderer';
import { createSceneHost, type SceneHost } from '@/game/scene';
import { generateCity } from '@/sim/city/generateCity';
import { benchProblems } from '../../scripts/city-smoke.mjs';
import {
  BENCH_SEED, BenchRun, createBenchCityScene, createBenchHost,
  type BenchCityRow, type BenchTimings, type FrameInfo,
} from './bench';

/*
 * Miasto w benchmarku na prawdziwej scenie gry (atrapa kontekstu renderera, prawdziwa kamera i scena three.js, bez WebGL): bieg `BenchRun`
 * na sztucznym zegarze przechodzi przez presety, a każdy wiersz miasta ma mierzyć się pod profilem własnego presetu (Rozstrzygnięcie 13:
 * liczby bramki z prawdziwych urządzeń nie mogą pochodzić z profilu poprzedniego wiersza). Dowód to `cityStats()` zapisane w wierszu.
 */

/**
 * Szczeble drabiny profilu (Rozstrzygnięcie 13) bez zmiany `CITY_PROFILES` (jest zamrożona): `override` podmienia wynik `cityProfile`
 * dla sceny i dla benchmarku naraz (oba czytają go z tego modułu), więc test widzi to, co zobaczyłby bieg po zmianie profilu.
 */
const profileOverride = vi.hoisted(() => ({ fn: null as null | ((preset: string, mobile: boolean, base: unknown) => unknown) }));
vi.mock('@/render/city/cityQuality', async (original) => {
  const mod = await original<typeof import('@/render/city/cityQuality')>();
  return {
    ...mod,
    cityProfile: (preset: Parameters<typeof mod.cityProfile>[0], mobile: boolean) => {
      const base = mod.cityProfile(preset, mobile);
      return profileOverride.fn ? (profileOverride.fn(preset, mobile, base) as CityProfile) : base;
    },
  };
});

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

/** Komunikaty konsoli z testu: połykamy tylko te, których się spodziewamy (brak sieci przy GLB), reszta ma oblać test. */
const EXPECTED_NOISE = /brak sieci/;
let consoleNoise: string[] = [];

beforeEach(() => {
  consoleNoise = [];
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  const collect = (...args: unknown[]): void => { consoleNoise.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')); };
  vi.spyOn(console, 'warn').mockImplementation(collect);
  vi.spyOn(console, 'error').mockImplementation(collect);
});
afterEach(() => {
  profileOverride.fn = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(consoleNoise.filter((m) => !EXPECTED_NOISE.test(m))).toEqual([]);
});

/** Co profil każe dla wiersza (niezależnie od skryptu smoke'a): widok faktycznie rysowany, geometria, auta i cienie. */
function expectedOf(row: BenchCityRow): { layer: string; detail: string; cars: boolean; casters: boolean } {
  const p = row.profile!;
  const layer = row.layer === 'makieta' && !p.mockup ? 'ruch' : row.layer;   // bez makiety scena rysuje „Ruch” (scene.ts: showCity)
  return { layer, detail: layer === 'makieta' ? 'pelny' : p.firstDetail, cars: layer === 'makieta' && p.cars, casters: layer === 'makieta' && p.shadows === 'static' };
}

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
  async function fullRun(isMobile: boolean, initial: QualityPresetId = 'srednia', override: typeof profileOverride.fn = null) {
    profileOverride.fn = override;
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
      const id = `${row.preset}/${row.layer}`;
      const want = expectedOf(row);
      expect(row.profile, id).toBe(cityProfile(row.preset, false));
      expect(row.applied).toBe(row.preset);
      expect(row.stats!.cars > 0, `${id}: auta`).toBe(want.cars);
      expect(row.stats!.shadowCasters > 0, `${id}: cienie`).toBe(want.casters);
      expect(row.stats!.detail, `${id}: geometria`).toBe(want.detail);
      expect(row.stats!.layer, `${id}: widok`).toBe(want.layer);
      expect(row.drawn, `${id}: drawn`).toBe(want.layer);
    }
  });

  it('telefon: wszystkie wiersze pod profilem „telefon” (bez aut i cieni), także przy Średniej i Wysokiej', async () => {
    const { run } = await fullRun(true, 'niska');
    expect(run.city).toHaveLength(4);
    for (const row of run.city) {
      const want = expectedOf(row);
      expect(row.profile).toBe(cityProfile(row.preset, true));
      expect(row.stats).toMatchObject({ cars: 0, shadowCasters: 0, detail: want.detail, layer: want.layer });
    }
  });

  it('miasto mieści się w budżecie §19 w każdym wierszu (wywołania rysowania sceny i rzucające cień)', async () => {
    const { run } = await fullRun(false);
    for (const row of run.city) {
      const { drawCalls, shadowCasters } = row.stats!;
      expect(drawCalls + shadowCasters, `${row.preset}/${row.layer}`).toBeLessThan(row.layer === 'makieta' ? 150 : 60);
    }
  });

  /**
   * Drabina z Rozstrzygnięcia 13: po porażce progu zmienia się tylko `CITY_PROFILES`. Każdy szczebel to tu podmiana profilu (bez edycji
   * tabeli); bieg, jego wiersze i sprawdzenie z `--bench` (`benchProblems`) mają dalej mówić prawdę, bez poprawek skryptu ani testów.
   */
  const LADDER: { name: string; mobile: boolean; initial: QualityPresetId; override: (preset: string, mobile: boolean, base: CityProfile) => CityProfile }[] = [
    { name: 'Średnia: cars: false', mobile: false, initial: 'srednia', override: (p, _m, base) => (p === 'srednia' ? { ...base, cars: false } : base) },
    { name: 'Średnia: cars: false, shadows: off', mobile: false, initial: 'srednia', override: (p, _m, base) => (p === 'srednia' ? { ...base, cars: false, shadows: 'off' } : base) },
    { name: 'telefon: mockup: false', mobile: true, initial: 'niska', override: (_p, m, base) => (m ? { ...base, mockup: false } : base) },
  ];

  it.each(LADDER)('drabina profilu, szczebel „$name”: każdy wiersz pod zmienionym profilem, a sprawdzenie biegu (--bench) nie ma uwag', async ({ mobile, initial, override }) => {
    const { run } = await fullRun(mobile, initial, override as typeof profileOverride.fn);
    expect(run.city.map((r) => `${r.preset}/${r.layer}`)).toEqual(['niska/makieta', 'niska/ruch', 'srednia/makieta', 'wysoka/makieta']);
    for (const row of run.city) {
      const id = `${row.preset}/${row.layer}`;
      const want = expectedOf(row);
      expect(row.stats!.layer, `${id}: widok`).toBe(want.layer);
      expect(row.stats!.detail, `${id}: geometria`).toBe(want.detail);
      expect(row.stats!.cars > 0, `${id}: auta`).toBe(want.cars);
      expect(row.stats!.shadowCasters > 0, `${id}: cienie`).toBe(want.casters);
      expect(row.drawn, `${id}: drawn`).toBe(want.layer);
    }
    expect(benchProblems(run.rows, { city: run.city, env: { isMobile: mobile } }, { mobile })).toEqual([]);
  });

  it('szczebel „telefon: mockup: false”: makieta nie istnieje, więc wiersze „makieta” rysują „Ruch” na prostej geometrii, a etykieta wiersza zostaje', async () => {
    const { run } = await fullRun(true, 'niska', ((_p: string, m: boolean, base: CityProfile) => (m ? { ...base, mockup: false } : base)) as typeof profileOverride.fn);
    for (const row of run.city) expect(row.stats).toMatchObject({ layer: 'ruch', detail: 'prosty', cars: 0, shadowCasters: 0 });
    expect(run.city.map((r) => r.layer)).toEqual(['makieta', 'ruch', 'makieta', 'makieta']);
    expect(run.city.map((r) => r.drawn)).toEqual(['ruch', 'ruch', 'ruch', 'ruch']);
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
