import type { Mesh, Object3D } from 'three';
import type { SceneHost, CityStats } from '@/game/scene';
import type { CityLayer } from '@/render/city/buildCity';
import { cityProfile, type CityProfile } from '@/render/city/cityQuality';
import { QUALITY, detectDeviceCaps, type QualityPresetId } from '@/render/quality';
import type { RenderContext } from '@/render/renderer';
import { generateCity } from '@/sim/city/generateCity';
import type { CityState, LotState } from '@/sim/city/types';
import type { CrowdOptions } from '@/sim/crowd/crowd';

/*
 * Benchmark wydajności etapu 1 (`?bench=1`, krótszy `?bench=1&quick=1` do próbnego uruchomienia).
 *
 * Gra rysuje zwykłą ścieżką (ten sam composer i postprocessing), a ten moduł tylko prowadzi bieg: dla każdego presetu
 * czeka, aż tłum dobije do ~55 postaci, rozgrzewa 5 s i mierzy 20 s, po czym robi krótkie próby, które pokazują, na co
 * idzie czas (cienie postaci, sama obecność tłumu, AO). Potem (etap 4a.2, bramka makiety) ten sam bieg mierzy miasto:
 * dla każdego presetu makietę (rozgrzewka i pomiar), a na Niskiej jeszcze warstwę „Ruch”, czyli widok, od którego miasto zaczyna
 * na telefonie. Maszyna stanów `BenchRun` nie zna ani three.js, ani DOM: dostaje czas z rAF i liczniki renderera, a skutki
 * uboczne (preset, próby, miasto) zleca gospodarzowi (`BenchHost`).
 */

export const BENCH_SEED = 'bench';
/** 60 postaci naraz; 1200 klientów na minutę napełnia sklep w kilka sekund (ruling R6). */
export const BENCH_CROWD: CrowdOptions = { targetCount: 60, spawnPerMinute: 1200 };
export const BENCH_PRESETS: readonly QualityPresetId[] = ['niska', 'srednia', 'wysoka'];
/** Przerwa między klatkami dłuższa niż to (ms): karta w tle albo zawieszenie. Krok, który trwa, liczymy od nowa. */
export const BENCH_STALL_MS = 500;
/** Ile razy jeden krok powtarzamy po przerwach; kolejna przerwa tylko zostawia ostrzeżenie. */
export const BENCH_MAX_STALL_RESTARTS = 3;

export interface BenchTimings {
  /** Tyle postaci (`crowd.agents.length`) uznajemy za pełny tłum. */
  fillTarget: number;
  /** Najdłużej czekamy na pełny tłum (w każdym presecie); potem idziemy dalej z ostrzeżeniem. */
  fillMaxMs: number;
  /**
   * Napełnianie sklepu przed pierwszym presetem. Klienci wchodzą tylko przez wolne punkty spawnu (kilka na sekundę), więc
   * pierwsze 55 postaci to ok. 15 s: bez tego pierwszy preset mierzyłby jeszcze niepełny tłum.
   */
  prefillMaxMs: number;
  warmupMs: number;
  measureMs: number;
  /** Próba: najpierw tyle ms na ustabilizowanie się (kompilacja shaderów, bufory), potem `probeMs` pomiaru. */
  probeSettleMs: number;
  probeMs: number;
  /** Najdłużej czekamy na wczytanie ulicy i postaci (modele GLB). */
  loadMaxMs: number;
  /** Miasto: na każdy wiersz (preset × widok) tyle ms rozgrzewki (budowa sceny, shadery, mapa cieni) i potem `cityMeasureMs` pomiaru. */
  cityWarmupMs: number;
  cityMeasureMs: number;
}

export const BENCH_TIMINGS: BenchTimings = {
  fillTarget: 55, fillMaxMs: 15_000, prefillMaxMs: 30_000, warmupMs: 5_000, measureMs: 20_000, probeSettleMs: 1_000, probeMs: 4_000,
  loadMaxMs: 30_000, cityWarmupMs: 2_000, cityMeasureMs: 8_000,
};
/** Wersja do sprawdzenia, że bieg się kończy (np. na programowym GL): liczby z niej nie mają wartości. */
export const BENCH_TIMINGS_QUICK: BenchTimings = {
  fillTarget: 55, fillMaxMs: 8_000, prefillMaxMs: 20_000, warmupMs: 1_000, measureMs: 3_000, probeSettleMs: 500, probeMs: 1_500,
  loadMaxMs: 20_000, cityWarmupMs: 500, cityMeasureMs: 1_500,
};

/**
 * Próby przypisujące koszt: każda zmienia jedną rzecz względem pomiaru głównego.
 * - charShadowsOff: postacie nie rzucają cienia (o tyle mniej wywołań rysowania, ile postaci),
 * - crowdHidden: tłum niewidoczny (cały koszt rysowania postaci: skórkowanie, główny przebieg i cień; animacje CPU zostają),
 * - aoOff: preset bez AO.
 */
export type BenchProbe = 'charShadowsOff' | 'crowdHidden' | 'aoOff';

/** Wiersz wyniku, `window.__benchResult[i]`. */
export interface BenchRow { preset: QualityPresetId; avgFps: number; p95FrameMs: number; calls: number; tris: number }

export interface SampleStats {
  frames: number;
  avgFps: number;
  p95FrameMs: number;
  maxFrameMs: number;
  /** Średnie z klatek (wszystkie przebiegi: cienie, AO, postprocessing). */
  calls: number;
  callsMax: number;
  tris: number;
  trisMax: number;
  /** Średnia liczba postaci w sklepie. */
  agents: number;
  /**
   * Czas pracy wątku JS w klatce (symulacja, animacje, przygotowanie i wysłanie rysowania; bez czekania na GPU),
   * średnia i 95. percentyl w ms. Gdy `avgFps` stoi na limicie ekranu, to jedyna liczba, która jeszcze rozróżnia próby.
   */
  cpuMs: number;
  cpuP95Ms: number;
}

export interface BenchProbeRow extends SampleStats { preset: QualityPresetId; probe: BenchProbe }
export interface BenchPresetDetail extends SampleStats { preset: QualityPresetId; applied: QualityPresetId }

/**
 * Wiersz miasta (`window.__benchExtra.city`): jedna para preset × widok. Liczby z okna pomiaru (`SampleStats`, tak jak wiersz sklepu),
 * a obok dowód, czym naprawdę rysowało się miasto: `stats` to `SceneHost.cityStats()` z końca pomiaru (szczegółowość geometrii, auta,
 * wywołania rysowania i rzucające cień), `profile` to profil, wg którego scena miała być zbudowana dla presetu, który renderer
 * faktycznie miał (`applied`; na telefonie profil „telefon” wygrywa z presetem). Zgodność jednego z drugim to warunek ważności wiersza.
 * `null`: gospodarz bez miasta albo bez migawki.
 */
export interface BenchCityRow extends SampleStats {
  preset: QualityPresetId;
  layer: CityLayer;
  applied: QualityPresetId;
  stats: CityStats | null;
  profile: CityProfile | null;
}

/** Stan sceny miasta i profil, wg którego ją zbudowano: to, co host oddaje biegowi po pomiarze wiersza. */
export interface BenchCitySnapshot { stats: CityStats; profile: CityProfile }

export interface BenchEnv {
  date: string;
  userAgent: string;
  gpu: string;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  quick: boolean;
  /** Urządzenie mobilne (telefon, tablet): miasto używa wtedy profilu „telefon” bez względu na preset. */
  isMobile: boolean;
}

/** `window.__benchExtra`: szczegóły poza kształtem `__benchResult`. */
export interface BenchExtra {
  env: BenchEnv | null;
  timings: BenchTimings;
  presets: BenchPresetDetail[];
  probes: BenchProbeRow[];
  /** Miasto (bramka makiety): po jednym wierszu na preset z makietą, a na Niskiej jeszcze „Ruch”. */
  city: BenchCityRow[];
  warnings: string[];
}

/** Co nakładka pokazuje na bieżąco. */
export interface BenchProgress {
  done: boolean;
  /** Np. „srednia · pomiar 12 / 20 s · 58 FPS · postaci 60”. */
  status: string;
  /** „krok 4 z 14”. */
  step: string;
  /** Wiersze presetów z ramkami i maksimum klatki (liczby te same co w `__benchResult`, plus szczegóły do nakładki). */
  rows: BenchPresetDetail[];
  probes: BenchProbeRow[];
  city: BenchCityRow[];
  warnings: string[];
  /** Bieg próbny (`quick=1`), nakładka to podpisuje. Ustawia sesja. */
  quick?: boolean;
}

declare global {
  interface Window {
    /** Ustawiane dopiero po końcu biegu. */
    __benchResult?: BenchRow[];
    __benchExtra?: BenchExtra;
  }
}

// --- Statystyki -----------------------------------------------------------------------------------------

/** Wartość z najbliższej rangi (bez interpolacji) w tablicy posortowanej rosnąco; `p` ∈ (0, 1]. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil(p * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1]!;
}

const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length);
const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Próbka klatek: odstępy między klatkami (ms) i liczniki z każdej klatki. */
export interface Samples { dt: number[]; calls: number[]; tris: number[]; agents: number[]; cpu: number[] }

export function summarize(s: Samples): SampleStats {
  const frames = s.dt.length;
  const totalMs = s.dt.reduce((sum, x) => sum + x, 0);
  const sorted = [...s.dt].sort((a, b) => a - b);
  return {
    frames,
    avgFps: totalMs > 0 ? round1((frames * 1000) / totalMs) : 0,
    p95FrameMs: round1(percentile(sorted, 0.95)),
    maxFrameMs: round1(sorted[sorted.length - 1] ?? 0),
    calls: Math.round(mean(s.calls)),
    callsMax: s.calls.reduce((m, x) => Math.max(m, x), 0),
    tris: Math.round(mean(s.tris)),
    trisMax: s.tris.reduce((m, x) => Math.max(m, x), 0),
    agents: Math.round(mean(s.agents)),
    cpuMs: round1(mean(s.cpu)),
    cpuP95Ms: round1(percentile([...s.cpu].sort((a, b) => a - b), 0.95)),
  };
}

const emptySamples = (): Samples => ({ dt: [], calls: [], tris: [], agents: [], cpu: [] });

// --- Gospodarz: skutki uboczne w rendererze -------------------------------------------------------------

export interface BenchHost {
  /** Ustawia preset i oddaje ten, który faktycznie działa (renderer może zejść do 'niska', gdy sprzęt nie wspiera AO). */
  setPreset(id: QualityPresetId): QualityPresetId;
  /** Włącza próbę (poprzednia jest wcześniej zdejmowana) albo zdejmuje bieżącą (`null`). */
  setProbe(probe: BenchProbe | null): void;
  /**
   * Pokazuje miasto benchmarku w danym widoku (od świeżego stanu, pod bieżącym presetem) albo wraca do sklepu (`null`).
   * Preset ustawia się przed tym wywołaniem, więc miasto ma zawsze profil swojego wiersza.
   */
  setCity(layer: CityLayer | null): void;
  /** Stan sceny miasta i jego profil (wołane po pomiarze wiersza); `null`, gdy miasta nie widać albo host go nie mierzy. */
  citySnapshot?(): BenchCitySnapshot | null;
  /** Koniec biegu: zdejmuje próbę i miasto i wraca do presetu, który był aktywny przed startem. */
  restore(): void;
}

export interface RenderBenchHost extends BenchHost {
  /** Wołać co klatkę po synchronizacji tłumu, przed rysowaniem: postacie, które pojawiły się w trakcie próby, też jej podlegają. */
  beforeRender(): void;
  citySnapshot(): BenchCitySnapshot | null;
}

/**
 * Miasto benchmarku widziane przez gospodarza: scena pokazuje je i chowa, `stats` to jej `cityStats()`, a `profile` profil, który
 * scena stosuje dla presetu (telefon wygrywa z presetem). Atrapa w testach, `createBenchCityScene` w grze.
 */
export interface BenchCityScene {
  show(layer: CityLayer): void;
  hide(): void;
  stats(): CityStats;
  profile(preset: QualityPresetId): CityProfile;
}

/**
 * Miasto benchmarku: `generateCity(BENCH_SEED)` ze stanami lokali z generatora, bez firmy (jak miasto sprzed pierwszej gry), więc
 * wiersze są porównywalne między urządzeniami. Powstaje przy pierwszym pokazaniu i zostaje to samo (scena porównuje miasta po
 * tożsamości). `show` najpierw chowa miasto: wiersz zaczyna od widoku, jaki gracz dostaje po wejściu w zakładkę przy tym presecie
 * (Niska i telefon zwalniają scenę przy wyjściu, więc „Ruch” staje na prostej geometrii, a Średnia i Wysoka zostają przy pełnej),
 * z tym samym kadrem kamery, auta i cienie wg profilu presetu, który host właśnie ustawił.
 */
export function createBenchCityScene(
  scene: Pick<SceneHost, 'showCity' | 'hideCity' | 'cityStats'>, isMobile: boolean = detectDeviceCaps().isMobile,
): BenchCityScene {
  let city: CityState | null = null;
  let states: Record<number, LotState> = {};
  return {
    show(layer) {
      if (!city) {
        city = generateCity(BENCH_SEED);
        states = Object.fromEntries(city.lots.map((lot) => [lot.id, lot.state]));
      }
      scene.hideCity();
      scene.showCity(city, states, layer);
    },
    hide: () => scene.hideCity(),
    stats: () => scene.cityStats(),
    profile: (preset) => cityProfile(preset, isMobile),
  };
}

/**
 * Gospodarz dla prawdziwego renderera. `crowdRoot` to grupa z postaciami tłumu, `city` to miasto benchmarku (`createBenchCityScene`),
 * a `onPreset` dostaje każdy preset, który renderer faktycznie ustawił (żeby `ui.preset` był zgodny z grą).
 *
 * AO wyłączamy przez chwilowe nadpisanie `QUALITY[preset].ao`, bo `RenderContext.setPreset` czyta ustawienia z tej tabeli
 * i nie ma osobnego wejścia na pojedynczy parametr. Postprocessing czyta `ao` tylko przy zmianie presetu, więc tabela
 * wraca do stanu wyjściowego zaraz po `setPreset`, w `finally`, nawet gdy renderer rzuci wyjątek.
 */
export function createBenchHost(
  ctx: Pick<RenderContext, 'preset' | 'setPreset'>, crowdRoot: Object3D, city: BenchCityScene, onPreset: (id: QualityPresetId) => void = () => {},
): RenderBenchHost {
  const initial = ctx.preset;
  let probe: BenchProbe | null = null;
  const shadowless = new Set<Mesh>();                        // siatki, którym wyłączyliśmy cień
  let aoProbePreset: QualityPresetId | null = null;          // preset, na którym działa próba bez AO

  function applyPreset(id: QualityPresetId): QualityPresetId {
    ctx.setPreset(id);
    onPreset(ctx.preset);
    return ctx.preset;
  }

  function applyPresetWithoutAo(id: QualityPresetId): void {
    const saved = QUALITY[id].ao;
    QUALITY[id].ao = 'off';
    try {
      applyPreset(id);
    } finally {
      QUALITY[id].ao = saved;
    }
  }

  function disableCharacterShadows(): void {
    crowdRoot.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh && mesh.castShadow) {
        shadowless.add(mesh);
        mesh.castShadow = false;
      }
    });
  }

  function clearProbe(): void {
    const was = probe;
    probe = null;
    switch (was) {
      case 'charShadowsOff':
        for (const mesh of shadowless) mesh.castShadow = true;
        shadowless.clear();
        break;
      case 'crowdHidden':
        crowdRoot.visible = true;
        break;
      case 'aoOff':
        if (aoProbePreset !== null) {
          const id = aoProbePreset;
          aoProbePreset = null;
          applyPreset(id);
        }
        break;
      case null:
        break;
    }
  }

  return {
    setPreset: applyPreset,
    setProbe(next) {
      clearProbe();
      probe = next;
      switch (next) {
        case 'charShadowsOff':
          disableCharacterShadows();
          break;
        case 'crowdHidden':
          crowdRoot.visible = false;
          break;
        case 'aoOff': {
          const id = ctx.preset;
          aoProbePreset = id;
          applyPresetWithoutAo(id);
          break;
        }
        case null:
          break;
      }
    },
    setCity(layer) {
      if (layer === null) city.hide();
      else city.show(layer);
    },
    citySnapshot() {
      const stats = city.stats();
      return stats.shown ? { stats, profile: city.profile(ctx.preset) } : null;
    },
    restore() {
      clearProbe();
      city.hide();   // bieg przerwany w mieście (zwykle już ukryte przez `setCity(null)`)
      applyPreset(initial);
    },
    beforeRender() {
      if (probe === 'charShadowsOff') disableCharacterShadows();
    },
  };
}

// --- Maszyna stanów biegu -------------------------------------------------------------------------------

/** Co `BenchRun.frame` dostaje z każdej klatki (po narysowaniu). */
export interface FrameInfo {
  /** `renderer.info.render.calls` z całej klatki (Task 14: bez autoReset, zerowane raz na klatkę). */
  calls: number;
  tris: number;
  /** Liczba postaci w symulacji. */
  agents: number;
  /** Ulica i postacie wczytane. */
  ready: boolean;
  /** ms pracy wątku JS od początku klatki do końca `ctx.render()`. */
  cpuMs: number;
}

type StepKind = 'loading' | 'fill' | 'warmup' | 'measure' | 'probe' | 'cityWarmup' | 'cityMeasure';

/** Kroki, w których przerwa restartuje krok. Ładowanie ma własny limit czasu. */
const STALLABLE: ReadonlySet<StepKind> = new Set<StepKind>(['fill', 'warmup', 'measure', 'probe', 'cityWarmup', 'cityMeasure']);

interface Step {
  kind: StepKind;
  preset: QualityPresetId | null;
  probe: BenchProbe | null;
  /** Widok miasta w krokach miasta (`cityWarmup`, `cityMeasure`). */
  layer: CityLayer | null;
  /** Czas od wejścia w krok, w którym jeszcze nie mierzymy. */
  settleMs: number;
  durationMs: number;
  startedAt: number | null;
}

const probesFor = (preset: QualityPresetId): BenchProbe[] =>
  preset === 'srednia' ? ['charShadowsOff', 'crowdHidden', 'aoOff'] : ['charShadowsOff'];

const PROBE_LABEL: Record<BenchProbe, string> = {
  charShadowsOff: 'bez cieni postaci', crowdHidden: 'bez widocznego tłumu', aoOff: 'bez AO',
};

/**
 * Widoki miasta danego presetu: makieta zawsze, a na Niskiej jeszcze „Ruch”: Niska i telefon otwierają miasto w warstwie na prostej
 * geometrii, więc to ten widok (nie makieta) rozstrzyga o FPS telefonu w bramce („telefon, ruch”).
 */
const cityLayersFor = (preset: QualityPresetId): CityLayer[] => (preset === 'niska' ? ['makieta', 'ruch'] : ['makieta']);

function buildSteps(presets: readonly QualityPresetId[], t: BenchTimings): Step[] {
  const step = (kind: StepKind, preset: QualityPresetId | null, durationMs: number, settleMs = 0, probe: BenchProbe | null = null, layer: CityLayer | null = null): Step =>
    ({ kind, preset, probe, layer, settleMs, durationMs, startedAt: null });
  const steps: Step[] = [step('loading', null, t.loadMaxMs), step('fill', null, t.prefillMaxMs)];
  for (const preset of presets) {
    steps.push(step('fill', preset, t.fillMaxMs), step('warmup', preset, t.warmupMs), step('measure', preset, t.measureMs));
    for (const probe of probesFor(preset)) steps.push(step('probe', preset, t.probeMs, t.probeSettleMs, probe));
  }
  // miasto po sklepie: tłum pod ekranem Miasta jest ukryty, więc nie czekamy już na jego napełnienie
  for (const preset of presets) {
    for (const layer of cityLayersFor(preset)) {
      steps.push(step('cityWarmup', preset, t.cityWarmupMs, 0, null, layer), step('cityMeasure', preset, t.cityMeasureMs, 0, null, layer));
    }
  }
  return steps;
}

const seconds = (ms: number): number => Math.floor(ms / 1000);
/** Sekundy do komunikatów: jedno miejsce po przecinku, żeby krótkie czasy (w testach) nie dawały „0 s”. */
const secs = (ms: number): number => Math.round(ms / 100) / 10;
/** Nazwa kroku w ostrzeżeniach: `srednia`, `srednia/aoOff`, `miasto niska/makieta`, a napełnianie przed pierwszym presetem to `rozruch`. */
const stepLabel = (step: Step): string => {
  if (step.layer) return `miasto ${step.preset}/${step.layer}`;
  return step.probe ? `${step.preset}/${step.probe}` : (step.preset ?? 'rozruch');
};

/**
 * Prowadzi bieg klatka po klatce. `frame` wołamy po narysowaniu każdej klatki, z czasem rAF (ms) i licznikami.
 * Zmiany presetu i prób dzieją się na końcu klatki, więc działają od następnej. Pierwsza klatka kroku nie jest mierzona.
 * Przerwa dłuższa niż `BENCH_STALL_MS` (albo ukrycie karty, `markHidden`) w kroku, który mierzy lub czeka na tłum, restartuje
 * ten krok: jego zegar i próbki zaczynają się od nowa, a klatka przerwy nie wchodzi do pomiaru.
 *
 * Pomiar to odstępy między kolejnymi klatkami rAF (z vsync): `avgFps` = klatki / czas, `p95FrameMs` = 95. percentyl
 * odstępów. Wyniki rosną w `rows` (po jednym na preset), `probes`, `city` (po presetach: makieta, a na Niskiej jeszcze „Ruch”)
 * i `warnings`; `done` mówi o końcu. Miasto biegnie po sklepie: każdy jego wiersz zaczyna od `setPreset` (gdy preset się zmienia) i
 * `setCity(widok)`, rozgrzewa się `cityWarmupMs`, mierzy `cityMeasureMs` i zapisuje migawkę sceny; na końcu `setCity(null)` i `restore`.
 * Przerwa w karcie powtarza krok miasta tak samo jak krok presetu.
 */
export class BenchRun {
  private readonly steps: Step[];
  private index = 0;
  private prevNow: number | null = null;
  private samples = emptySamples();
  private lastPublish = Number.NEGATIVE_INFINITY;
  private finished = false;
  private applied: QualityPresetId = 'srednia';
  private cityPreset: QualityPresetId | null = null;   // preset, który ustawiły już kroki miasta
  private stalls = 0;                 // przerwy w bieżącym kroku
  private hiddenSinceFrame = false;   // karta była ukryta od ostatniej klatki

  private readonly resultRows: BenchRow[] = [];
  private readonly presetDetails: BenchPresetDetail[] = [];
  private readonly probeRows: BenchProbeRow[] = [];
  private readonly cityRows: BenchCityRow[] = [];
  private readonly warns: string[] = [];

  constructor(
    private readonly host: BenchHost,
    private readonly timings: BenchTimings,
    private readonly onProgress: (progress: BenchProgress) => void = () => {},
    presets: readonly QualityPresetId[] = BENCH_PRESETS,
    private readonly publishEveryMs = 500,
  ) {
    this.steps = buildSteps(presets, timings);
  }

  get done(): boolean { return this.finished; }
  get rows(): readonly BenchRow[] { return this.resultRows; }
  get probes(): readonly BenchProbeRow[] { return this.probeRows; }
  get city(): readonly BenchCityRow[] { return this.cityRows; }
  get warnings(): readonly string[] { return this.warns; }
  get extra(): BenchExtra {
    return {
      env: null, timings: this.timings, presets: [...this.presetDetails], probes: [...this.probeRows], city: [...this.cityRows],
      warnings: [...this.warns],
    };
  }

  /** Karta przeszła w tło: rAF tam stoi, więc następna klatka sprawdzi przerwę (zob. `checkStall`). */
  markHidden(): void {
    this.hiddenSinceFrame = true;
  }

  frame(now: number, info: FrameInfo): void {
    if (this.finished) return;
    const dt = this.prevNow === null ? null : now - this.prevNow;
    this.prevNow = now;

    const step = this.steps[this.index]!;
    if (step.startedAt === null) {
      this.enter(step, now);
    } else {
      const stalled = this.checkStall(step, now, dt);
      const elapsed = now - step.startedAt;
      const measuring = step.kind === 'measure' || step.kind === 'probe' || step.kind === 'cityMeasure';
      if (measuring && !stalled && dt !== null && elapsed >= step.settleMs && elapsed < step.settleMs + step.durationMs) {
        this.samples.dt.push(dt);
        this.samples.calls.push(info.calls);
        this.samples.tris.push(info.tris);
        this.samples.agents.push(info.agents);
        this.samples.cpu.push(info.cpuMs);
      }
      if (this.isOver(step, elapsed, info)) {
        this.leave(step, elapsed, info);
        this.index++;
        if (this.index >= this.steps.length) {
          this.finish();
          return;
        }
        this.enter(this.steps[this.index]!, now);
      }
    }
    this.publish(now, info);
  }

  private isOver(step: Step, elapsed: number, info: FrameInfo): boolean {
    switch (step.kind) {
      case 'loading': return info.ready || elapsed >= step.durationMs;
      case 'fill': return info.agents >= this.timings.fillTarget || elapsed >= step.durationMs;
      default: return elapsed >= step.settleMs + step.durationMs;
    }
  }

  /**
   * Czy ta klatka to przerwa w kroku, który mierzy albo czeka na tłum. Do `BENCH_MAX_STALL_RESTARTS` przerw krok zaczyna
   * się od nowa (z ostrzeżeniem). Kolejna przerwa tylko zapisuje ostrzeżenie, a krok idzie dalej po swoim czasie.
   * Klatka przerwy nigdy nie jest próbką.
   */
  private checkStall(step: Step, now: number, dt: number | null): boolean {
    const hidden = this.hiddenSinceFrame;
    this.hiddenSinceFrame = false;
    const gap = dt !== null && dt > BENCH_STALL_MS;
    if (!(hidden || gap) || !STALLABLE.has(step.kind)) return false;
    this.stalls++;
    const head = `${stepLabel(step)}: przerwa w klatkach ${Math.round(dt ?? 0)} ms (${hidden ? 'karta ukryta' : 'karta w tle?'})`;
    if (this.stalls <= BENCH_MAX_STALL_RESTARTS) {
      this.warns.push(`${head} — krok powtórzony`);
      step.startedAt = now;
      this.samples = emptySamples();
    } else if (this.stalls === BENCH_MAX_STALL_RESTARTS + 1) {
      this.warns.push(`${head} — za dużo przerw, wynik niepewny`);
    }
    return true;
  }

  private enter(step: Step, now: number): void {
    step.startedAt = now;
    this.samples = emptySamples();
    this.stalls = 0;
    if (step.kind === 'fill' && step.preset !== null) {
      this.applied = this.host.setPreset(step.preset);
      if (this.applied !== step.preset) this.warns.push(`${step.preset}: renderer użył presetu ${this.applied} (sprzęt nie obsługuje pełnej grafiki)`);
    } else if (step.kind === 'probe') {
      this.host.setProbe(step.probe);
    } else if (step.kind === 'cityWarmup') {
      // preset przed miastem: `setCity` buduje widok pod presetem, który renderer ma w tej chwili
      if (step.preset !== this.cityPreset) {
        this.cityPreset = step.preset;
        this.applied = this.host.setPreset(step.preset!);
        if (this.applied !== step.preset) this.warns.push(`miasto ${step.preset}: renderer użył presetu ${this.applied} (sprzęt nie obsługuje pełnej grafiki)`);
      }
      this.host.setCity(step.layer!);
      // `setCity` buduje scenę synchronicznie, a pierwsza klatka kompiluje jej shadery: ten odstęp nie jest przerwą w karcie (rozgrzewka
      // i tak nie mierzy), więc następna klatka nie ma odstępu, od którego liczyłaby przerwę
      this.prevNow = null;
    }
  }

  private leave(step: Step, elapsed: number, info: FrameInfo): void {
    switch (step.kind) {
      case 'loading':
        if (!info.ready) this.warns.push(`Wczytywanie sceny (ulica, postacie) przekroczyło ${secs(step.durationMs)} s, bieg rusza bez niej.`);
        break;
      case 'fill':
        if (info.agents < this.timings.fillTarget) {
          this.warns.push(`${step.preset ?? 'rozruch'}: po ${secs(elapsed)} s w sklepie jest ${info.agents} postaci (cel ${this.timings.fillTarget}), pomiar idzie dalej.`);
        }
        break;
      case 'measure': {
        const stats = summarize(this.samples);
        this.resultRows.push({ preset: step.preset!, avgFps: stats.avgFps, p95FrameMs: stats.p95FrameMs, calls: stats.calls, tris: stats.tris });
        this.presetDetails.push({ preset: step.preset!, applied: this.applied, ...stats });
        break;
      }
      case 'probe':
        this.probeRows.push({ preset: step.preset!, probe: step.probe!, ...summarize(this.samples) });
        this.host.setProbe(null);
        break;
      case 'cityMeasure': {
        const snapshot = this.host.citySnapshot?.() ?? null;
        this.cityRows.push({
          preset: step.preset!, layer: step.layer!, applied: this.applied, ...summarize(this.samples),
          stats: snapshot?.stats ?? null, profile: snapshot?.profile ?? null,
        });
        break;
      }
      case 'warmup':
      case 'cityWarmup':
        break;
    }
  }

  private finish(): void {
    this.finished = true;
    try {
      try {
        this.host.setCity(null);   // sklep wraca przed przywróceniem presetu; wyjątek miasta nie może zablokować `restore`
      } finally {
        this.host.restore();
      }
    } finally {
      // wyniki trafiają do nakładki i do window.__benchResult nawet wtedy, gdy przywracanie presetu rzuci wyjątek
      this.onProgress(this.progress('Gotowe.', this.steps.length));
    }
  }

  private publish(now: number, info: FrameInfo): void {
    if (now - this.lastPublish < this.publishEveryMs) return;
    this.lastPublish = now;
    this.onProgress(this.progress(this.statusLine(now, info), this.index));
  }

  private statusLine(now: number, info: FrameInfo): string {
    const step = this.steps[this.index]!;
    const elapsed = step.startedAt === null ? 0 : now - step.startedAt;
    const total = step.settleMs + step.durationMs;
    const clock = `${seconds(Math.min(elapsed, total))} / ${seconds(total)} s`;
    const live = summarize(this.samples);
    const fps = live.frames > 0 ? ` · ${Math.round(live.avgFps)} FPS` : '';
    switch (step.kind) {
      case 'loading': return `Wczytywanie sceny… ${clock}`;
      case 'fill': return `${step.preset ?? 'rozruch'} · tłum ${info.agents} / ${this.timings.fillTarget}`;
      case 'warmup': return `${step.preset} · rozgrzewka ${clock} · postaci ${info.agents}`;
      case 'measure': return `${step.preset} · pomiar ${clock}${fps} · postaci ${info.agents}`;
      case 'probe': return `${step.preset} · próba: ${PROBE_LABEL[step.probe!]} ${clock}${fps}`;
      case 'cityWarmup': return `${step.preset} · miasto ${step.layer} · rozgrzewka ${clock}`;
      case 'cityMeasure': return `${step.preset} · miasto ${step.layer} · pomiar ${clock}${fps}`;
    }
  }

  private progress(status: string, stepIndex: number): BenchProgress {
    return {
      done: this.finished,
      status,
      step: `krok ${Math.min(stepIndex + 1, this.steps.length)} z ${this.steps.length}`,
      rows: [...this.presetDetails],
      probes: [...this.probeRows],
      city: [...this.cityRows],
      warnings: [...this.warns],
    };
  }
}

// --- Podpięcie do gry -----------------------------------------------------------------------------------

export interface BenchSession {
  /** Po synchronizacji tłumu, przed `ctx.render()`. */
  beforeRender(): void;
  /** Po `ctx.render()`: `now` to czas rAF, liczniki to `renderer.info.render` z tej klatki. */
  afterRender(now: number, info: FrameInfo): void;
}

function readEnvironment(ctx: RenderContext, quick: boolean): BenchEnv {
  let gpu = 'nieznany';
  try {
    const gl = ctx.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { /* przeglądarka może ukrywać dane o GPU */ }
  return {
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    gpu,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    quick,
    isMobile: detectDeviceCaps().isMobile,
  };
}

/**
 * Uruchamia bieg na prawdziwym rendererze. Na końcu: `console.table` (presety, próby, miasto), `window.__benchResult` (kształt z planu,
 * tylko sklep) i `window.__benchExtra` (środowisko, próby, miasto, ostrzeżenia). `onProgress` dostaje stan do nakładki, `onPreset` każdy
 * preset, który renderer ustawia. Od startu do końca biegu sesja słucha zmiany widoczności karty.
 */
export function createBenchSession(
  ctx: RenderContext, crowdRoot: Object3D,
  opts: { quick: boolean; onProgress: (progress: BenchProgress) => void; city: BenchCityScene; onPreset?: (id: QualityPresetId) => void },
): BenchSession {
  const host = createBenchHost(ctx, crowdRoot, opts.city, opts.onPreset);
  const timings = opts.quick ? BENCH_TIMINGS_QUICK : BENCH_TIMINGS;
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') run.markHidden();
  };
  const run = new BenchRun(host, timings, (progress) => {
    opts.onProgress({ ...progress, quick: opts.quick });
    if (!progress.done) return;
    document.removeEventListener('visibilitychange', onVisibility);
    const extra = { ...run.extra, env: readEnvironment(ctx, opts.quick) };
    console.table(extra.presets.map(({ preset, avgFps, p95FrameMs, maxFrameMs, frames, calls, tris }) => ({ preset, avgFps, p95FrameMs, maxFrameMs, frames, calls, tris })));
    console.table(extra.probes.map(({ preset, probe, avgFps, p95FrameMs, maxFrameMs, frames, calls, tris, cpuMs }) => ({ preset, probe, avgFps, p95FrameMs, maxFrameMs, frames, calls, tris, cpuMs })));
    console.table(extra.city.map(({ preset, layer, avgFps, p95FrameMs, maxFrameMs, frames, calls, tris, cpuMs, stats }) => ({
      preset, layer, avgFps, p95FrameMs, maxFrameMs, frames, calls, tris, cpuMs, detail: stats?.detail ?? null, cars: stats?.cars ?? null, casters: stats?.shadowCasters ?? null,
    })));
    if (extra.warnings.length > 0) console.warn('Ostrzeżenia benchmarku:', extra.warnings);
    window.__benchExtra = extra;
    window.__benchResult = [...run.rows];
  });
  document.addEventListener('visibilitychange', onVisibility);
  return {
    beforeRender: () => host.beforeRender(),
    afterRender: (now, info) => run.frame(now, info),
  };
}
