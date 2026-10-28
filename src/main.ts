import { createRenderContext, type RenderContext } from '@/render/renderer';
import { QUALITY, detectDeviceCaps, pickInitialPreset, type QualityPresetId } from '@/render/quality';
import { createCharacterFactory, type CharacterFactory } from '@/render/characters/characterFactory';
import { DEFAULT_CASHIER_LOOK } from '@/game/cashier';
import { MAX_FRAME_DT } from '@/game/loop';
import { randomSeed } from '@/game/seedWords';
import { entrySeed } from '@/game/seeds';
import { lastSavedSeed } from '@/game/session';
import { createShell } from '@/game/actions';
import { bindControls } from '@/game/controls';
import { advanceSession, debugHandleEnabled, debugHandleOf, installDebugHandle, isModalOpen } from '@/game/frame';
import { loadMeta, needsStartScreen, saveMeta } from '@/game/meta';
import { createSceneHost, startTestScene, writeSeedToUrl } from '@/game/scene';
import { initialStartForm, playerOf, type StartChoice } from '@/game/start';
import { play, buzz, setSound, setVibration } from '@/ui/sfx';
import { confetti } from '@/ui/fx';
import type { EconEvent } from '@/sim/economy/economy';
import { renderUi } from '@/ui/App';
import { listenForNotices, postNotice } from '@/ui/Notice';
import { FIRST_DAY_HINTS } from '@/ui/game/overlays';
import { createWorldOverlay } from '@/ui/worldOverlay';
import { FrameMeter } from '@/ui/perfMeter';
import * as ui from '@/ui/state';

/**
 * Moduł benchmarku (`?bench=1`). Ładowany dynamicznie tylko dla tego trybu: zwykła gra nie pobiera maszyny stanów pomiaru.
 * Nakładka wyników (`ui/BenchOverlay`, kilkadziesiąt linii JSX, z samymi importami typów z modułu) zostaje w pakiecie statycznie.
 */
type BenchModule = typeof import('@/bench/bench');

/** Wybór gracza z ekranu startowego (pierwsze wejście) i fabryka postaci, której używał podgląd: gra dostaje tę samą (patrz `startGame`). */
interface StartEntry { choice: StartChoice; factory: Promise<CharacterFactory> }

/**
 * Gra `?seed=<seed>` (bez seeda: ostatnio grany sklep z zapisu albo losowy; przy pierwszym wejściu ten seed wypełnia pole na
 * ekranie startowym „Twój kasjer”, a gracz, który już ma nick w meta, wchodzi prosto do sklepu): ekonomia sklepu (src/sim/economy) toczy się
 * w czasie gry, a scena ją pokazuje: palety pod sklepem, na zapleczu i w sali, sprzęt w slotach, pustoszejące półki,
 * tłum o gęstości zależnej od ruchu, dzień i noc według zegara. Stuknięcie w paletę rozładowuje kawałek (kliker),
 * w kasę obsługuje klienta, w slot otwiera kartę zakupu. Remont podmienia układ sklepu na większy.
 * Parametry do zrzutów: `yaw` (0–3), `night=1` (stała noc), `ext=1`, `zoom` (wysokość widoku w m), `q` (preset jakości),
 * `perf=1` (nakładka wydajności od startu), `new=1` (nowa gra zamiast zapisu). `?charTest=1` to osobna strona podglądu
 * postaci (ładowana dynamicznie).
 *
 * `bench=1` to benchmark (src/bench): seed `bench`, 60 postaci, stała kamera, bez sterowania i bez ekonomii. Parametry
 * `seed`, `yaw`, `zoom`, `night` i `ext` są wtedy ignorowane, żeby wyniki były porównywalne. `quick=1` skraca bieg.
 * `startGame` dostaje moduł benchmarku jako `benchKit` (dynamiczny import w main.ts); `null` to zwykła gra.
 *
 * Symulacja tłumu idzie stałym krokiem SIM_STEP (advanceClock), render interpoluje pozycje współczynnikiem acc / SIM_STEP.
 * Ekonomia ma własny zegar (advanceEconomy): minuta gry na krok, noc mija szybciej niż dzień.
 *
 * `entry` to wybór gracza z ekranu startowego (pierwsze wejście) wraz z fabryką postaci, której używał podgląd: nick i wygląd
 * kasjera idą do meta, sklep otwiera się z wybranego seeda i nigdy jako nowa gra (nie nadpisze zapisu). Bez niego (gracz już jest
 * w meta, meta z nowszej wersji gry, benchmark) sklep otwiera się z `initialSeed`, a kasjer ma wygląd z meta albo domyślny.
 * Nakładka z komunikatami (`listenForNotices`, `renderUi`) wstaje przed tą funkcją, razem z ekranem startowym.
 *
 * Ta funkcja tylko składa grę z części: scena (`createSceneHost`, scene.ts), powłoka z sesją, metą i przepływami sklepu
 * (`createShell`, actions.ts), sterowanie (controls.ts), pętla klatek (frame.ts) i uchwyt debugowania.
 */
function startGame(
  canvas: HTMLCanvasElement, root: HTMLElement, initialSeed: string, preset: QualityPresetId, params: URLSearchParams,
  benchKit: BenchModule | null, entry: StartEntry | null,
): void {
  let ctx: RenderContext;
  try {
    ctx = createRenderContext(canvas, preset);
  } catch (error) {
    // Komunikat dla gracza już poszedł zdarzeniem `traszka:notice` i zostaje na ekranie.
    console.error('Nie udało się uruchomić renderera.', error);
    return;
  }
  // Liczniki z całej klatki (cienie, AO, postprocessing), a nie z ostatniego `render()`. Zerowane raz na klatkę w pętli.
  ctx.renderer.info.autoReset = false;
  const benchMode = benchKit !== null;
  const meta = loadMeta();
  if (entry) {
    meta.player = playerOf(entry.choice);   // meta z nowszej wersji gry tego nie zapisze (saveMeta pomija ją), ale ta karta ma gracza
    saveMeta(meta);
  }
  const zoom = Number(params.get('zoom'));
  const overlay = benchMode ? null : createWorldOverlay(document.body);
  const scene = createSceneHost({
    ctx, benchCrowd: benchKit?.BENCH_CROWD, overlay, zoomPinned: zoom > 0,
    cashierLook: meta.player?.look ?? DEFAULT_CASHIER_LOOK,   // wygląd kasjera za ladą: jedno miejsce, z którego idzie do każdego sklepu
    forcedNight: !benchMode && params.get('night') === '1',
    exterior: !benchMode && params.get('ext') === '1',
  });
  /** Fabryka postaci: z ekranu startowego (podgląd i gra mają te same stroje) albo własna, startowana przy pierwszym użyciu. Ekran „Nowy sklep” też z niej korzysta. */
  let factoryPromise: Promise<CharacterFactory> | null = entry?.factory ?? null;
  const characterFactory = (): Promise<CharacterFactory> => (factoryPromise ??= createCharacterFactory());
  // Sesja powstaje dopiero przy otwieraniu pierwszego sklepu (`shell.open` niżej): dopiero wtedy wiadomo, czy zapis dało się użyć
  // i czy świat z niego stanął. Benchmark nie ma sesji.
  const shell = createShell({
    meta, benchMode, scene, writeSeedToUrl, randomSeed, characterFactory, firstDayHints: FIRST_DAY_HINTS,
    effects: {
      play, buzz, setSound, setVibration, notice: postNotice,
      confetti: (fx, fy, count) => confetti(fx === undefined ? undefined : window.innerWidth * fx, fy === undefined ? undefined : window.innerHeight * fy, count),
      floater: (x, y, text, kind) => overlay?.floater(x, y, text, kind),
    },
  });

  if (!benchMode && zoom > 0) ctx.rig.zoomBy(14 / zoom);
  const yaw = Number(params.get('yaw'));
  if (!benchMode && yaw >= 1 && yaw <= 3) ctx.rig.yawIndex = yaw as 1 | 2 | 3;

  // stan startowy dla nakładki (świat startuje z prędkością ×1)
  ui.seed.value = initialSeed;
  ui.speed.value = 1;
  ui.preset.value = ctx.preset;
  ui.showPerf.value = params.get('perf') === '1';

  // Jedyne miejsce, w którym zmienia się stan gry na żądanie gracza. Przyciski i klawisze wołają te funkcje.
  const controls: ui.Controls = {
    setSpeed(next) {
      ui.speed.value = next;
      if (scene.loaded) scene.loaded.world.speed = next;
    },
    rotate: (dir) => ctx.rig.rotate(dir),
    setTimeOfDay: (next) => scene.setTimeOfDay(next),
    setPreset(next) {
      ctx.setPreset(next);
      ui.preset.value = ctx.preset;   // bez AO renderer schodzi niżej i sam o tym informuje (traszka:notice)
    },
    generate: shell.generate,
    randomize: shell.randomize,
  };

  if (benchMode) {
    scene.load(initialSeed, null);   // benchmark nie ma sesji ani zapisu: wyjątek idzie dalej
  } else {
    if (!shell.open({ seed: initialSeed, fresh: params.get('new') === '1', choice: entry?.choice ?? null })) return;
    // Sterowanie tylko w zwykłej grze: w benchmarku nic nie rusza kamerą ani presetem, wynik zależy tylko od biegu.
    bindControls(ctx, {
      setPreset: (id) => controls.setPreset(id),
      onTap: (x, y) => { if (shell.session && scene.loaded) shell.tap(scene.pick(x, y), x, y); },
      blocked: () => !!ui.start.value,
      extra: {
        x: () => scene.toggleExterior(),
        ' ': () => controls.setSpeed(ui.speed.value === 0 ? 1 : 0),
        F3: () => { ui.showPerf.value = !ui.showPerf.value; },
      },
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) shell.persist(); });
    window.addEventListener('pagehide', () => shell.persist());
  }

  void characterFactory().then((created) => scene.attachFactory(created)).catch((error: unknown) => console.error('Nie udało się wczytać postaci.', error));

  const bench = benchKit
    ? benchKit.createBenchSession(ctx, scene.crowdRoot, {
      quick: params.get('quick') === '1',
      onProgress: (progress) => { ui.bench.value = progress; },
      onPreset: (id) => { ui.preset.value = id; },
    })
    : null;
  const meter = new FrameMeter();
  let last: number | null = null;
  let lastPublish = -1;
  let nextSpeech = performance.now() + 6000;
  const frame = (now: number): void => {
    // Następną klatkę planujemy od razu, przed resztą: wyjątek w tej klatce (np. w benchmarku) nie może zerwać pętli.
    requestAnimationFrame(frame);
    const cpuStart = performance.now();
    ctx.renderer.info.reset();
    const frameDt = last === null ? 0 : Math.max(0, (now - last) / 1000);
    last = now;
    const realDt = Math.min(frameDt, MAX_FRAME_DT);

    const { session } = shell;
    const { loaded } = scene;
    const modal = isModalOpen(session);
    if (session && loaded) {
      const events: EconEvent[] = [];
      advanceSession(session, realDt, loaded.world.speed, modal, events);
      shell.handleEvents(events);   // układ zmienia tylko polecenie (`dispatchCommand`), więc tu sceny nie przebudowujemy
    }
    scene.syncVisuals(session);
    if (session && now - lastPublish > 200) { lastPublish = now; shell.publish(); }
    if (session && loaded && !modal && loaded.world.speed > 0 && now > nextSpeech) {
      nextSpeech = now + 4000 + Math.random() * 5000;
      scene.speak(session);
    }
    scene.animate(frameDt, realDt, modal);
    bench?.beforeRender();
    if (!ui.start.value) ctx.render();   // ekran „Nowy sklep” zasłania scenę: nie rysujemy jej pod nim (podgląd ma własny renderer, a telefon ma dość roboty)
    overlay?.update(ctx.rig.camera);
    const { calls, triangles } = ctx.renderer.info.render;
    const sample = meter.tick(now, calls, triangles);
    if (sample) ui.perf.value = sample;
    bench?.afterRender(now, {
      calls, tris: triangles, agents: loaded?.world.crowd.agents.length ?? 0, ready: !!loaded?.crowdView && !!loaded.street,
      cpuMs: performance.now() - cpuStart,
    });
  };
  requestAnimationFrame(frame);

  // uchwyt do ręcznych testów w konsoli (pola odczytywane na bieżąco); tylko w buildzie deweloperskim albo pod adresem z `?debug=1` (M11)
  installDebugHandle(window, debugHandleOf({ ctx, shell, scene }), debugHandleEnabled(import.meta.env.DEV, params));

  if (!benchMode) renderUi(root, controls, shell.game);   // sterowanie działa od tej chwili; benchmark zostaje z samą nakładką wyników
}

/**
 * Ekran startowy „Twój kasjer” przy wejściu na stronę. Spełnia się wyborem gracza (nick, wygląd kasjera, seed sklepu) razem z
 * fabryką postaci, której używał podgląd: gra dostanie tę samą, więc stroje nie ładują się drugi raz. `null`, gdy ekranu nie
 * trzeba pokazywać (gracz jest już w meta albo meta pochodzi z nowszej wersji gry). Gry jeszcze nie ma: podgląd ma własny, lekki
 * renderer i oddaje go, zanim ruszy `startGame`. `seed` wypełnia pole: `?seed=`, ostatnio grany sklep (gracz ze starymi zapisami
 * kontynuuje swoją grę) albo losowy.
 */
async function startScreen(seed: string): Promise<StartEntry | null> {
  const meta = loadMeta();
  if (!needsStartScreen(meta)) return null;
  const factory = createCharacterFactory();
  const choice = await new Promise<StartChoice>((resolve) => {
    ui.start.value = { mode: 'first', form: initialStartForm(meta, seed), factory, onStart: resolve };
  });
  return { choice, factory };
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const presetFromUrl = (): QualityPresetId => {
  const q = params.get('q');
  return q && q in QUALITY ? (q as QualityPresetId) : pickInitialPreset(detectDeviceCaps());
};

if (params.get('charTest') === '1') {
  // podgląd postaci to narzędzie deweloperskie: osobny fragment pakietu, pobierany tylko pod tym adresem
  void import('@/render/characters/charTestPage')
    .then(({ startCharTestPage }) => startCharTestPage(canvas, presetFromUrl(), params))
    .catch((error: unknown) => console.error('Nie udało się wczytać podglądu postaci.', error));
} else if (params.get('scene') === 'test') {
  startTestScene(canvas, presetFromUrl());
} else {
  // benchmark też jest osobnym fragmentem: zwykła gra go nie pobiera
  const benchKit = params.get('bench') === '1' ? await import('@/bench/bench') : null;
  const requested = benchKit ? benchKit.BENCH_SEED : params.get('seed');
  const seed = entrySeed(requested, lastSavedSeed());
  // Nakładka wstaje pierwsza: komunikat z createRenderContext musi trafić w działający nasłuch, a ekran startowy ma gdzie się pokazać.
  listenForNotices();
  renderUi(uiRoot, null, null);
  const entry = benchKit ? null : await startScreen(seed);
  startGame(canvas, uiRoot, entry?.choice.seed ?? seed, presetFromUrl(), params, benchKit, entry);   // adres wpisze sam, gdy świat już stoi
}
