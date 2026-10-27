import { Group, MathUtils, Mesh, type BufferGeometry, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BENCH_CROWD, BENCH_SEED, createBenchSession } from '@/bench/bench';
import { createRenderContext, type RenderContext } from '@/render/renderer';
import { ISO_PITCH_DEG } from '@/render/cameraRig';
import { QUALITY, detectDeviceCaps, pickInitialPreset, type QualityPresetId } from '@/render/quality';
import type { TimeOfDay } from '@/render/lighting';
import { BEVEL, PALETTE, material } from '@/render/style';
import { cellToWorld } from '@/render/coords';
import { buildStore, type StoreView } from '@/render/store/buildStore';
import { fillShelves } from '@/render/store/products';
import { buildStreet, type StreetView } from '@/render/street/buildStreet';
import { startCharTestPage } from '@/render/characters/charTestPage';
import { createCharacterFactory, type CharacterFactory, type CharacterPack } from '@/render/characters/characterFactory';
import { CrowdView } from '@/render/crowdView';
import { MAX_FRAME_DT, advanceClock, clockAlpha } from '@/game/loop';
import { randomSeed } from '@/game/seedWords';
import { createWorld, type World } from '@/game/world';
import { SIM_STEP, stepCrowd } from '@/sim/crowd/crowd';
import { CELL_SIZE_M } from '@/sim/grid';
import { renderUi } from '@/ui/App';
import { listenForNotices } from '@/ui/Notice';
import { FrameMeter } from '@/ui/perfMeter';
import * as ui from '@/ui/state';

/** Ile metrów na ekranie to jeden piksel (kamera ortograficzna: tyle samo w poziomie i w pionie). */
const metersPerPixel = (ctx: RenderContext): number => ctx.rig.viewSize / Math.max(1, window.innerHeight);

/**
 * Przesuwa cel kamery tak, żeby punkt podłogi pod kursorem został pod kursorem po przeciągnięciu o (dx, dy) pikseli.
 * W prawo na ekranie to prostopadła do kierunku patrzenia, w górę ekranu to kierunek patrzenia na podłodze, którego
 * odcinek jest na ekranie skrócony o sin(nachylenie), więc pion przeliczamy z tym dzieleniem.
 */
function dragPan(ctx: RenderContext, dx: number, dy: number): void {
  const yaw = MathUtils.degToRad(45 + 90 * ctx.rig.yawIndex);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);   // kierunek patrzenia na podłodze (x, z)
  const right = dx * metersPerPixel(ctx);
  const forward = (dy * metersPerPixel(ctx)) / Math.sin(MathUtils.degToRad(ISO_PITCH_DEG));
  ctx.rig.panBy(fz * right + fx * forward, -fx * right + fz * forward);
}

interface Bindings {
  /** Klawisze sceny (np. N dzień/noc). Nadpisują domyślne, jeśli mają tę samą nazwę. */
  extra?: Record<string, () => void>;
  /** Zmiana presetu klawiszami 1/2/3. Gra przekazuje wersję, która od razu aktualizuje sygnał UI. */
  setPreset?: (id: QualityPresetId) => void;
}

/** Klawisze nie działają, gdy gracz pisze w polu (np. seed), bo litery są wtedy tekstem, a nie poleceniem. */
const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement);

/**
 * Sterowanie wspólne dla scen: Q/E obrót, +/− zoom, strzałki pan, kółko myszy zoom, przeciąganie prawym przyciskiem pan,
 * 1/2/3 preset jakości. `extra` dokłada klawisze sceny (np. N dzień/noc).
 */
function bindControls(ctx: RenderContext, { extra = {}, setPreset = (id) => ctx.setPreset(id) }: Bindings = {}): void {
  const keys: Record<string, () => void> = {
    q: () => ctx.rig.rotate(-1),
    e: () => ctx.rig.rotate(1),
    '+': () => ctx.rig.zoomBy(1.15),
    '=': () => ctx.rig.zoomBy(1.15),
    '-': () => ctx.rig.zoomBy(1 / 1.15),
    ArrowLeft: () => ctx.rig.panBy(-0.5, 0),
    ArrowRight: () => ctx.rig.panBy(0.5, 0),
    ArrowUp: () => ctx.rig.panBy(0, -0.5),
    ArrowDown: () => ctx.rig.panBy(0, 0.5),
    '1': () => setPreset('niska'),
    '2': () => setPreset('srednia'),
    '3': () => setPreset('wysoka'),
    ...extra,
  };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;   // np. Cmd+R to przeładowanie strony, nie nowy seed
    const action = keys[e.key] ?? keys[e.key.toLowerCase()];
    if (!action) return;
    e.preventDefault();   // F3 nie otwiera wyszukiwania przeglądarki, strzałki nie przewijają strony
    action();
  });
  window.addEventListener('wheel', (e) => ctx.rig.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1), { passive: true });

  // pan: przeciąganie prawym przyciskiem (menu kontekstowe wyłączone, żeby nie wyskakiwało po puszczeniu)
  let drag: { x: number; y: number } | null = null;
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('pointerdown', (e) => { if (e.button === 2) drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if ((e.buttons & 2) === 0) { drag = null; return; }   // puszczony poza oknem
    dragPan(ctx, e.clientX - drag.x, e.clientY - drag.y);
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = (e: PointerEvent): void => { if (e.button === 2) drag = null; };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
}

function startRenderLoop(ctx: RenderContext): void {
  const loop = (): void => {
    ctx.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * Tymczasowa scena `?scene=test` do oglądania renderera: kilka zaokrąglonych brył na podłodze, kolory z PALETTE.
 * Sterowanie: Q/E obrót, +/− zoom, strzałki pan, N dzień/noc, 1/2/3 preset jakości. Zastąpi ją właściwy świat.
 */
function startTestScene(canvas: HTMLCanvasElement, preset: QualityPresetId): void {
  let ctx: RenderContext;
  try {
    ctx = createRenderContext(canvas, preset);
  } catch (error) {
    // Bez renderera nie ma pętli. Komunikat dla gracza już poszedł zdarzeniem `traszka:notice`.
    console.error('Nie udało się uruchomić renderera.', error);
    return;
  }

  const block = (w: number, h: number, d: number, x: number, z: number, mat: Material, y = 0, radius: number = BEVEL.medium): Mesh => {
    const geometry: BufferGeometry = new RoundedBoxGeometry(w, h, d, 3, Math.min(radius, Math.min(w, h, d) * 0.4));
    const mesh = new Mesh(geometry, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = mesh.receiveShadow = true;
    ctx.scene.add(mesh);
    return mesh;
  };
  const matte = (color: string) => material('plasticMatte', color);

  block(10, 0.2, 10, 0, 0, matte(PALETTE.floor[0]), -0.2);
  block(10, 3, 0.2, 0, 5, matte(PALETTE.wall[0]));            // ściana tylna (dalsza od domyślnej kamery)
  block(0.2, 3, 10, 5, 0, matte(PALETTE.wall[0]));            // ściana prawa
  block(10, 0.3, 0.22, 0, 5, matte(PALETTE.wall[2]));         // cokół
  block(1.6, 1.4, 0.5, -1.5, -1, matte(PALETTE.fixture.shelf));
  block(1.6, 0.25, 0.54, -1.5, -1, matte(PALETTE.brand.green));
  block(1.6, 1.4, 0.5, -1.5, 1.2, matte(PALETTE.fixture.shelf));
  block(1.2, 0.95, 0.7, 2.5, -3.5, matte(PALETTE.fixture.counter));
  block(0.9, 2, 0.7, 3.8, 1.5, matte(PALETTE.fixture.fridgeFrame));
  block(0.5, 0.5, 0.5, 0.2, 2.5, matte(PALETTE.brand.orange), 0, BEVEL.small);
  block(0.4, 0.3, 0.4, 0.2, 2.5, matte(PALETTE.brand.cream), 0.5, BEVEL.small);

  ctx.rig.setBounds(-5, -5, 5, 5);
  ctx.setTimeOfDay('day');

  let night = false;
  bindControls(ctx, { extra: { n: () => ctx.setTimeOfDay((night = !night) ? 'night' : 'day') } });

  startRenderLoop(ctx);
  Object.assign(window, { traszkaTest: ctx });
}

/** Wszystko, co zależy od seeda sklepu. `unload` zwalnia to w całości, więc zmiana seeda niczego nie zostawia. */
interface Loaded {
  world: World;
  view: StoreView;                  // razem z towarem na półkach (jest jego dzieckiem)
  street: StreetView | null;        // dochodzi asynchronicznie (modele GLB)
  crowdView: CrowdView | null;      // dochodzi, gdy fabryka postaci jest gotowa
}

/** Wpisuje seed do adresu (zachowując pozostałe parametry), żeby odświeżenie albo link odtworzyły ten sam sklep. */
function writeSeedToUrl(seed: string): void {
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  history.replaceState(null, '', url);
}

/**
 * Gra `?seed=<seed>` (bez seeda: losowy, wpisany do adresu): generateStore → buildStore → buildStreet + tłum z symulacji.
 * Sterowanie jak w scenie próbnej (bindControls) plus N dzień/noc, X widok z zewnątrz (pełne ściany, szyld i pełna zabudowa
 * ulicy), R nowy losowy seed; przekrój (cutaway) podąża za obrotem kamery. F3 włącza nakładkę wydajności.
 * Parametry do zrzutów: `yaw` (0–3), `night=1`, `ext=1`, `zoom` (wysokość widoku w m), `q` (preset jakości), `pack`
 * (`ubc` zamiast domyślnych postaci `modular`), `perf=1` (nakładka wydajności od startu).
 *
 * `bench=1` to benchmark (src/bench): seed `bench`, 60 postaci, stała kamera, bez sterowania. Parametry `seed`, `yaw`, `zoom`,
 * `night` i `ext` są wtedy ignorowane, żeby wyniki były porównywalne. Bieg liczy klatki w tej samej pętli co gra
 * (te same liczniki rysowania), a `quick=1` skraca go do próbnego uruchomienia.
 *
 * Symulacja idzie stałym krokiem SIM_STEP (advanceClock), render interpoluje pozycje współczynnikiem acc / SIM_STEP.
 * Prędkość to `world.speed`; sklep i tłum startują, gdy postacie są gotowe (do tego czasu symulacja stoi).
 *
 * Nakładka (`src/ui`) steruje grą przez `Controls`. Przyciski i klawisze wołają te same funkcje, a te aktualizują
 * sygnały, które czyta interfejs, więc oba sposoby zawsze pokazują to samo.
 */
function startGame(canvas: HTMLCanvasElement, root: HTMLElement, initialSeed: string, preset: QualityPresetId, params: URLSearchParams, pack: CharacterPack): void {
  // Nakładka wstaje pierwsza: komunikat z createRenderContext musi trafić w działający nasłuch. Bez renderera nie ma czego sterować.
  listenForNotices();
  renderUi(root, null);

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
  const crowdRoot = new Group();
  crowdRoot.name = 'crowd';
  ctx.scene.add(crowdRoot);

  const benchMode = params.get('bench') === '1';
  let tod: TimeOfDay = !benchMode && params.get('night') === '1' ? 'night' : 'day';
  let exterior = !benchMode && params.get('ext') === '1';
  let factory: CharacterFactory | null = null;
  let loaded: Loaded | null = null;
  let generation = 0;               // odrzuca wyniki asynchroniczne, które wróciły po zmianie seeda
  const clock = { acc: 0 };

  function unload(): void {
    generation++;
    if (!loaded) return;
    loaded.crowdView?.dispose();
    loaded.street?.dispose();
    loaded.view.dispose();
    loaded = null;
  }

  function load(seed: string): void {
    const speed = loaded?.world.speed ?? 1;
    unload();
    const mine = generation;

    const world = createWorld(seed, benchMode ? BENCH_CROWD : undefined);
    world.speed = speed;
    const { layout } = world;
    const view = buildStore(layout);
    view.root.add(fillShelves(view, seed));   // view.dispose() zwalnia też bufory instancji towaru
    ctx.scene.add(view.root);
    const current: Loaded = { world, view, street: null, crowdView: factory ? new CrowdView(factory, layout, crowdRoot, pack) : null };
    loaded = current;
    clock.acc = 0;

    const lo = cellToWorld(layout, 0, 0);
    const hi = cellToWorld(layout, layout.width - 1, layout.depth - 1);
    ctx.rig.setBounds(lo.x - CELL_SIZE_M / 2, lo.z - CELL_SIZE_M / 2, hi.x + CELL_SIZE_M / 2, hi.z + CELL_SIZE_M / 2);
    // cel kamery: środek sali sprzedaży i zaplecza (bez chodnika)
    ctx.rig.panBy(-ctx.rig.target.x, cellToWorld(layout, 0, (5 + layout.depth) / 2).z - ctx.rig.target.z);
    view.setCutaway(ctx.rig.yawIndex);
    view.setExteriorMode(exterior);
    view.setTimeOfDay(tod);

    void buildStreet(layout, seed).then((built) => {
      if (mine !== generation) { built.dispose(); return; }
      current.street = built;
      built.setBuildingCutaway(!exterior);
      built.setTimeOfDay(tod);
      ctx.scene.add(built.root);
    }).catch((error: unknown) => console.error('Nie udało się zbudować ulicy.', error));
  }

  function setSeed(next: string): void {
    writeSeedToUrl(next);
    load(next);
    ui.seed.value = next;
  }

  const zoom = Number(params.get('zoom'));
  if (!benchMode && zoom > 0) ctx.rig.zoomBy(14 / zoom);
  const yaw = Number(params.get('yaw'));
  if (!benchMode && yaw >= 1 && yaw <= 3) ctx.rig.yawIndex = yaw as 1 | 2 | 3;
  ctx.setTimeOfDay(tod);
  ctx.rig.onChange(() => loaded?.view.setCutaway(ctx.rig.yawIndex));
  load(initialSeed);

  // stan startowy dla nakładki (świat startuje z prędkością ×1)
  ui.seed.value = initialSeed;
  ui.speed.value = 1;
  ui.timeOfDay.value = tod;
  ui.preset.value = ctx.preset;
  ui.showPerf.value = params.get('perf') === '1';

  // Jedyne miejsce, w którym zmienia się stan gry na żądanie gracza. Przyciski i klawisze wołają te funkcje.
  const controls: ui.Controls = {
    setSpeed(next) {
      ui.speed.value = next;
      if (loaded) loaded.world.speed = next;
    },
    rotate: (dir) => ctx.rig.rotate(dir),
    setTimeOfDay(next) {
      tod = next;
      ui.timeOfDay.value = next;
      ctx.setTimeOfDay(next);
      loaded?.view.setTimeOfDay(next);
      loaded?.street?.setTimeOfDay(next);
    },
    setPreset(next) {
      ctx.setPreset(next);
      ui.preset.value = ctx.preset;   // bez AO renderer schodzi niżej i sam o tym informuje (traszka:notice)
    },
    generate: (text) => setSeed(text.trim() || randomSeed()),
    randomize: () => setSeed(randomSeed()),
  };

  // W benchmarku nic nie steruje kamerą ani presetem: wynik zależy tylko od biegu.
  if (!benchMode) {
    bindControls(ctx, {
      setPreset: (id) => controls.setPreset(id),
      extra: {
        n: () => controls.setTimeOfDay(tod === 'day' ? 'night' : 'day'),
        x: () => {
          exterior = !exterior;
          loaded?.view.setExteriorMode(exterior);
          loaded?.street?.setBuildingCutaway(!exterior);
        },
        r: () => controls.randomize(),
        F3: () => { ui.showPerf.value = !ui.showPerf.value; },
      },
    });
  }

  void createCharacterFactory(pack).then((created) => {
    factory = created;
    if (loaded && !loaded.crowdView) loaded.crowdView = new CrowdView(created, loaded.world.layout, crowdRoot, pack);
  }).catch((error: unknown) => console.error('Nie udało się wczytać postaci.', error));

  const bench = benchMode
    ? createBenchSession(ctx, crowdRoot, {
      quick: params.get('quick') === '1',
      onProgress: (progress) => { ui.bench.value = progress; },
      onPreset: (id) => { ui.preset.value = id; },
    })
    : null;
  const meter = new FrameMeter();
  let last: number | null = null;
  const frame = (now: number): void => {
    // Następną klatkę planujemy od razu, przed resztą: wyjątek w tej klatce (np. w benchmarku) nie może zerwać pętli.
    requestAnimationFrame(frame);
    const cpuStart = performance.now();
    ctx.renderer.info.reset();
    const frameDt = last === null ? 0 : Math.max(0, (now - last) / 1000);
    last = now;
    if (loaded?.crowdView) {
      const { world, crowdView } = loaded;
      const steps = advanceClock(clock, frameDt, world.speed);
      for (let i = 0; i < steps; i++) stepCrowd(world.crowd, world.layout, SIM_STEP);
      crowdView.sync(world.crowd, clockAlpha(clock), Math.min(frameDt, MAX_FRAME_DT) * world.speed);
    }
    bench?.beforeRender();
    ctx.render();
    const { calls, triangles } = ctx.renderer.info.render;
    const sample = meter.tick(now, calls, triangles);
    if (sample) ui.perf.value = sample;
    bench?.afterRender(now, {
      calls, tris: triangles, agents: loaded?.world.crowd.agents.length ?? 0, ready: !!loaded?.crowdView && !!loaded.street,
      cpuMs: performance.now() - cpuStart,
    });
  };
  requestAnimationFrame(frame);

  // uchwyt do ręcznych testów w konsoli; pola odczytywane na bieżąco
  Object.assign(window, {
    traszkaGame: {
      ctx,
      setSeed,
      get world() { return loaded?.world ?? null; },
      get view() { return loaded?.view ?? null; },
      get street() { return loaded?.street ?? null; },
      get crowdView() { return loaded?.crowdView ?? null; },
      get factory() { return factory; },
    },
  });

  if (!benchMode) renderUi(root, controls);   // sterowanie działa od tej chwili; benchmark zostaje z samą nakładką wyników
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

if (params.get('charTest') === '1') {
  const q = params.get('q');
  startCharTestPage(canvas, q && q in QUALITY ? (q as QualityPresetId) : pickInitialPreset(detectDeviceCaps()), params);
} else if (params.get('scene') === 'test') {
  const q = params.get('q');
  startTestScene(canvas, q && q in QUALITY ? (q as QualityPresetId) : pickInitialPreset(detectDeviceCaps()));
} else {
  const q = params.get('q');
  const requested = params.get('bench') === '1' ? BENCH_SEED : params.get('seed');
  const seed = requested || randomSeed();
  if (!requested) writeSeedToUrl(seed);
  const pack: CharacterPack = params.get('pack') === 'ubc' ? 'ubc' : 'modular';   // ruling R31: modular, dopóki zadanie 16 nie wybierze
  startGame(canvas, uiRoot, seed, q && q in QUALITY ? (q as QualityPresetId) : pickInitialPreset(detectDeviceCaps()), params, pack);
}
