import { BoxGeometry, Group, MathUtils, Mesh, MeshBasicMaterial, Raycaster, Vector2, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BENCH_CROWD, BENCH_SEED, createBenchSession } from '@/bench/bench';
import { createRenderContext, type RenderContext } from '@/render/renderer';
import { ISO_PITCH_DEG } from '@/render/cameraRig';
import { QUALITY, detectDeviceCaps, pickInitialPreset, type QualityPresetId } from '@/render/quality';
import type { TimeOfDay } from '@/render/lighting';
import { BEVEL, PALETTE, material } from '@/render/style';
import { cellToWorld } from '@/render/coords';
import { buildStore, type StoreView } from '@/render/store/buildStore';
import { createGoods, type Goods } from '@/render/store/products';
import { createPalletsView, type PalletsView } from '@/render/game/palletsView';
import { createEquipmentView, type EquipmentView } from '@/render/game/equipmentView';
import { buildStreet, type StreetView } from '@/render/street/buildStreet';
import { startCharTestPage } from '@/render/characters/charTestPage';
import { createCharacterFactory, type CharacterFactory, type CharacterPack } from '@/render/characters/characterFactory';
import { ANIM_SPEED_CAP, CrowdView } from '@/render/crowdView';
import { createBlobShadows } from '@/render/characters/blobShadows';
import { MAX_FRAME_DT, advanceClock, clockAlpha } from '@/game/loop';
import { randomSeed } from '@/game/seedWords';
import { createWorld, type World } from '@/game/world';
import { createSession, deleteSave, lastSavedSeed, saveSession, syncLayout, type GameSession } from '@/game/session';
import { SIM_STEP, payLook, setCrowdExtras, setCrowdRate, stepCrowd } from '@/sim/crowd/crowd';
import { CATS, HOUR_CURVE, OPEN_FROM } from '@/sim/economy/catalog';
import { minuteOfDay } from '@/sim/economy/calendar';
import { advanceEconomy } from '@/sim/economy/clock';
import {
  buyEquipment, buyUpgrade, campaign, effects, expectedDailyCustomers, fire, hire, isClosedForRemont, isStoreOpen, movePallet,
  returnPallet, rushRemont, setOrder, setPriority, slotUsage, startRemont, stepMinute, tapPallet, tapTill, type CommandResult,
  type EconEvent,
} from '@/sim/economy/economy';
import { slotUnits } from '@/sim/economy/slots';
import { spotCells } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { CELL_SIZE_M } from '@/sim/grid';
import { renderUi } from '@/ui/App';
import { listenForNotices } from '@/ui/Notice';
import { createWorldOverlay } from '@/ui/worldOverlay';
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
  /** Stuknięcie (klik bez przeciągania) w scenę, współrzędne ekranu w px. */
  onTap?: (x: number, y: number) => void;
}

/** Klawisze nie działają, gdy gracz pisze w polu (np. seed), bo litery są wtedy tekstem, a nie poleceniem. */
const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement);

/** Przesunięcie (px), powyżej którego dotknięcie jest przeciąganiem, a nie stuknięciem. */
const TAP_SLOP = 8;

/**
 * Sterowanie wspólne dla scen: Q/E obrót, +/− zoom, strzałki pan, kółko myszy zoom, 1/2/3 preset jakości.
 * Mysz i dotyk na płótnie: przeciąganie (lewym albo prawym przyciskiem, jednym palcem) przesuwa widok, dwa palce
 * przybliżają (pinch), a krótkie stuknięcie bez ruchu woła `onTap`. `extra` dokłada klawisze sceny.
 */
function bindControls(ctx: RenderContext, { extra = {}, setPreset = (id) => ctx.setPreset(id), onTap }: Bindings = {}): void {
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
  const canvas = ctx.renderer.domElement;
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); ctx.rig.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const pointers = new Map<number, { x: number; y: number }>();
  let tap: { id: number; x: number; y: number; t: number } | null = null;
  let pinch: number | null = null;   // odległość między palcami w poprzedniej klatce
  const mid = (): { x: number; y: number } => {
    const ps = [...pointers.values()];
    return { x: (ps[0]!.x + ps[1]!.x) / 2, y: (ps[0]!.y + ps[1]!.y) / 2 };
  };
  const spread = (): number => {
    const ps = [...pointers.values()];
    return Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y);
  };

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap = pointers.size === 1 && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
    pinch = pointers.size === 2 ? spread() : null;
  });
  canvas.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size === 2) {
      const before = mid();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = mid();
      const d = spread();
      if (pinch && d > 0) ctx.rig.zoomBy(d / pinch);
      pinch = d;
      dragPan(ctx, after.x - before.x, after.y - before.y);
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < TAP_SLOP) return;   // jeszcze stuknięcie
    tap = null;
    dragPan(ctx, e.clientX - prev.x, e.clientY - prev.y);
  });
  const end = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (e.type === 'pointerup' && tap && tap.id === e.pointerId && performance.now() - tap.t < 600) onTap?.(e.clientX, e.clientY);
    tap = null;
    pinch = pointers.size === 2 ? spread() : null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
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

/** Wszystko, co zależy od układu sklepu. `unload` zwalnia to w całości, więc zmiana seeda albo remont niczego nie zostawia. */
interface Loaded {
  world: World;
  view: StoreView;                  // razem z towarem na półkach (jest jego dzieckiem)
  goods: Goods;
  pallets: PalletsView | null;      // tylko w grze (bez benchmarku)
  equipment: EquipmentView | null;
  till: Mesh | null;                // niewidoczna bryła nad kasą do stukania
  tillTop: Vector3 | null;          // punkt nad kasą dla dymka kolejki
  street: StreetView | null;        // dochodzi asynchronicznie (modele GLB)
  crowdView: CrowdView | null;      // dochodzi, gdy fabryka postaci jest gotowa
}

/** Wpisuje seed do adresu (zachowując pozostałe parametry), żeby odświeżenie albo link odtworzyły ten sam sklep. */
function writeSeedToUrl(seed: string): void {
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  history.replaceState(null, '', url);
}

/** Najwięcej postaci w sklepie naraz: telefon i słabsza grafika dostają mniej. */
const CROWD_MAX: Record<QualityPresetId, number> = { niska: 10, srednia: 16, wysoka: 22 };

/**
 * Gra `?seed=<seed>` (bez seeda: ostatnio grany sklep z zapisu albo losowy): ekonomia sklepu (src/sim/economy) toczy się
 * w czasie gry, a scena ją pokazuje: palety pod sklepem, na zapleczu i w sali, sprzęt w slotach, pustoszejące półki,
 * tłum o gęstości zależnej od ruchu, dzień i noc według zegara. Stuknięcie w paletę rozładowuje kawałek (kliker),
 * w kasę obsługuje klienta, w slot otwiera kartę zakupu. Remont podmienia układ sklepu na większy.
 * Parametry do zrzutów: `yaw` (0–3), `night=1` (stała noc), `ext=1`, `zoom` (wysokość widoku w m), `q` (preset jakości),
 * `pack` (`ubc` zamiast postaci `modular`, tylko do porównań), `perf=1` (nakładka wydajności od startu), `new=1` (nowa gra
 * zamiast zapisu).
 *
 * `bench=1` to benchmark (src/bench): seed `bench`, 60 postaci, stała kamera, bez sterowania i bez ekonomii. Parametry
 * `seed`, `yaw`, `zoom`, `night` i `ext` są wtedy ignorowane, żeby wyniki były porównywalne. `quick=1` skraca bieg.
 *
 * Symulacja tłumu idzie stałym krokiem SIM_STEP (advanceClock), render interpoluje pozycje współczynnikiem acc / SIM_STEP.
 * Ekonomia ma własny zegar (advanceEconomy): minuta gry na krok, noc mija szybciej niż dzień.
 */
function startGame(canvas: HTMLCanvasElement, root: HTMLElement, initialSeed: string, preset: QualityPresetId, params: URLSearchParams, pack: CharacterPack): void {
  // Nakładka wstaje pierwsza: komunikat z createRenderContext musi trafić w działający nasłuch. Bez renderera nie ma czego sterować.
  listenForNotices();
  renderUi(root, null, null);

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
  // plamy cienia pod postaciami: jedna siatka na całą grę, w grupie tłumu (benchmark ukrywa je razem z tłumem)
  const blobs = createBlobShadows();
  crowdRoot.add(blobs.mesh);

  const benchMode = params.get('bench') === '1';
  const forcedNight = !benchMode && params.get('night') === '1';
  let tod: TimeOfDay = forcedNight ? 'night' : 'day';
  let exterior = !benchMode && params.get('ext') === '1';
  let factory: CharacterFactory | null = null;
  let loaded: Loaded | null = null;
  let generation = 0;               // odrzuca wyniki asynchroniczne, które wróciły po zmianie seeda
  const clock = { acc: 0 };
  let session: GameSession | null = benchMode ? null : createSession(initialSeed, params.get('new') === '1');
  const overlay = benchMode ? null : createWorldOverlay(document.body);
  const raycaster = new Raycaster();

  function unload(): void {
    generation++;
    if (!loaded) return;
    loaded.crowdView?.dispose();
    loaded.street?.dispose();
    loaded.pallets?.dispose();
    loaded.equipment?.dispose();
    loaded.view.dispose();
    loaded = null;
  }

  function load(seed: string): void {
    const speed = loaded?.world.speed ?? ui.speed.value;
    unload();
    const mine = generation;

    const layout = session ? session.layout : generateStore(seed);
    const world = createWorld(seed, benchMode ? BENCH_CROWD : undefined, layout);
    world.speed = speed;
    const view = buildStore(layout);
    const goods = createGoods(view, seed);
    view.root.add(goods.root);   // view.dispose() zwalnia też bufory instancji towaru
    ctx.scene.add(view.root);

    let pallets: PalletsView | null = null;
    let equipment: EquipmentView | null = null;
    let till: Mesh | null = null;
    let tillTop: Vector3 | null = null;
    if (session) {
      pallets = createPalletsView(layout, session.info);
      view.root.add(pallets.root);
      equipment = createEquipmentView(layout, session.info, view);
      view.root.add(equipment.root);
      const checkout = layout.fixtures.find((f) => f.kind === 'checkout');
      if (checkout) {
        const a = cellToWorld(layout, checkout.x, checkout.y);
        const b = cellToWorld(layout, checkout.x + checkout.w - 1, checkout.y + checkout.d - 1);
        till = new Mesh(new BoxGeometry(checkout.w * CELL_SIZE_M + 0.4, 1.6, checkout.d * CELL_SIZE_M + 0.4), new MeshBasicMaterial({ visible: false }));
        till.position.set((a.x + b.x) / 2, 0.8, (a.z + b.z) / 2);
        till.userData = { pick: { kind: 'till' } };
        view.root.add(till);
        tillTop = new Vector3((a.x + b.x) / 2, 1.9, (a.z + b.z) / 2);
      }
    }

    const current: Loaded = {
      world, view, goods, pallets, equipment, till, tillTop, street: null,
      crowdView: factory ? new CrowdView(factory, layout, crowdRoot, pack, blobs) : null,
    };
    loaded = current;
    clock.acc = 0;
    lastVisual = -1;

    const lo = cellToWorld(layout, 0, 0);
    const hi = cellToWorld(layout, layout.width - 1, layout.depth - 1);
    ctx.rig.setBounds(lo.x - CELL_SIZE_M / 2, lo.z - CELL_SIZE_M / 2, hi.x + CELL_SIZE_M / 2, hi.z + CELL_SIZE_M / 2);
    // cel kamery: środek sali sprzedaży i zaplecza (bez chodnika); na pionowym ekranie z chodnikiem, bo tam stoją palety
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const portrait = aspect < 0.9;
    // telefon: środek kadru bliżej frontu sklepu (chodnik z paletami, wejście, kasa), a zaplecze wypada u góry ekranu
    ctx.rig.panBy(-ctx.rig.target.x, cellToWorld(layout, 0, portrait ? layout.midWallY * 0.55 : (5 + layout.depth) / 2).z - ctx.rig.target.z);
    if (portrait && !(Number(params.get('zoom')) > 0)) {
      // sala w kadrze: rzut izometryczny ma szerokość ~ (szerokość + głębokość sali) · cos 45°
      const fit = ((layout.width + layout.midWallY) * CELL_SIZE_M * Math.SQRT1_2 * 0.8) / aspect;
      ctx.rig.zoomBy(ctx.rig.viewSize / Math.min(28, Math.max(14, fit)));
    }
    view.setCutaway(ctx.rig.yawIndex);
    view.setExteriorMode(exterior);
    view.setTimeOfDay(tod);
    syncVisuals(true);

    void buildStreet(layout, seed).then((built) => {
      if (mine !== generation) { built.dispose(); return; }
      current.street = built;
      built.setBuildingCutaway(!exterior, ctx.rig.yawIndex);
      built.setTimeOfDay(tod);
      ctx.scene.add(built.root);
    }).catch((error: unknown) => console.error('Nie udało się zbudować ulicy.', error));
  }

  function setSeed(next: string, fresh = false): void {
    if (session) saveSession(session);
    writeSeedToUrl(next);
    if (!benchMode) session = createSession(next, fresh);
    ui.selection.value = null;
    load(next);
    ui.seed.value = next;
    publish();
    if (session) saveSession(session);
  }

  // --- Ekonomia → scena i interfejs ---

  let lastVisual = -1;
  let lastPublish = -1;
  let econVersion = 0;

  function publish(): void {
    if (!session) return;
    ui.econ.value = { s: session.econ, info: session.info, v: ++econVersion };
  }

  /** Scena według stanu gry: palety, sprzęt, półki, tłum, pora dnia. Co ~100 ms (albo od razu z `force`). */
  function syncVisuals(force = false): void {
    if (!session || !loaded) return;
    const now = performance.now();
    if (!force && now - lastVisual < 100) return;
    lastVisual = now;
    const { econ: s, info, layout } = session;
    const sel = ui.selection.value;
    loaded.pallets?.sync(s.pallets, sel?.kind === 'pallet' ? sel.id : null);
    loaded.equipment?.sync(slotUsage(s));
    for (const c of CATS) loaded.goods.setFill(c, info.shelfCap[c] > 0 ? s.shelf[c] / info.shelfCap[c] : 0);

    // tłum: przeszkody z palet (chodnik, sala) i miejsca płacenia przy kasach samoobsługowych
    const obstacles = s.pallets.filter((p) => p.loc !== 'backroom').flatMap((p) => {
      const spot = info.spots[p.loc][p.spot];
      return spot ? spotCells(spot) : [];
    });
    const usage = slotUsage(s);
    const pay = info.slots.flatMap((slot) => slotUnits(layout, slot, usage.get(slot.id) ?? []))
      .filter((u) => u.equipment === 'sco' && u.access)
      .map((u) => ({ cell: u.access!, look: payLook(u.fixture.facing) }));
    setCrowdExtras(loaded.world.crowd, obstacles, pay);
    const open = isStoreOpen(s);
    const perHour = open ? expectedDailyCustomers(s, info) / 15.6 * (HOUR_CURVE[Math.floor(minuteOfDay(s.minute) / 60)] ?? 0) : 0;
    setCrowdRate(loaded.world.crowd, open
      ? { targetCount: Math.max(4, Math.min(CROWD_MAX[ctx.preset], Math.round(perHour * 0.35))), spawnPerMinute: Math.max(3, Math.min(24, perHour * 0.3)) }
      : { targetCount: 0, spawnPerMinute: 0 });

    // pora dnia z zegara gry (20:00–6:00 noc), chyba że zrzut wymusza noc
    if (!forcedNight) {
      const hour = minuteOfDay(s.minute) / 60;
      const want: TimeOfDay = hour >= 20 || hour < 6 ? 'night' : 'day';
      if (want !== tod) controls.setTimeOfDay(want);
    }
    const closed = isClosedForRemont(s) ? 'REMONT' : !open ? 'ZAMKNIĘTE' : null;
    const q = Math.round(s.queue);
    overlay?.setTill(loaded.tillTop, closed ?? (q > 0 ? `👥 ${q}` : '🙂'), !closed && s.queue >= effects(s, info).patience);
  }

  function handleEvents(events: EconEvent[]): void {
    for (const e of events) {
      if (e.kind === 'day') { if (session) saveSession(session); continue; }
      if (e.kind === 'month' && e.report) ui.report.value = e.report;
      ui.pushToast(e.text, e.kind);
    }
  }

  /** Polecenie gracza: wynik, odświeżenie sceny i interfejsu, komunikat przy błędzie. */
  const act = (r: CommandResult, okToast = true): CommandResult => {
    if (!r.ok) ui.pushToast(r.text, 'error');
    else if (okToast && r.text) ui.pushToast(r.text, 'ok');
    afterAction();
    return r;
  };
  function afterAction(): void {
    if (!session) return;
    if (syncLayout(session)) load(session.seed);
    syncVisuals(true);
    publish();
  }
  const money = (n: number): string => `+${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

  const game: ui.GameActions = {
    tapPallet: (id) => act(session ? tapPallet(session.econ, session.info, id) : { ok: false, text: '' }, false),
    tapTill: () => act(session ? tapTill(session.econ, session.info) : { ok: false, text: '' }, false),
    movePallet: (id, loc) => act(session ? movePallet(session.econ, session.info, id, loc) : { ok: false, text: '' }),
    returnPallet: (id) => { const r = act(session ? returnPallet(session.econ, id) : { ok: false, text: '' }); ui.selection.value = null; return r; },
    setOrder: (auto, manual) => { if (session) setOrder(session.econ, auto, manual); afterAction(); },
    hire: () => act(session ? hire(session.econ) : { ok: false, text: '' }, false),
    fire: () => act(session ? fire(session.econ) : { ok: false, text: '' }, false),
    setPriority: (p) => { if (session) setPriority(session.econ, p); afterAction(); },
    buyUpgrade: (id) => { const r = act(session ? buyUpgrade(session.econ, id) : { ok: false, text: '' }); if (session && r.ok) saveSession(session); return r; },
    buyEquipment: (id, slot) => { const r = act(session ? buyEquipment(session.econ, session.info, id, slot) : { ok: false, text: '' }); if (session && r.ok) saveSession(session); return r; },
    startRemont: () => { ui.selection.value = null; const r = act(session ? startRemont(session.econ) : { ok: false, text: '' }); if (session && r.ok) saveSession(session); return r; },
    campaign: () => act(session ? campaign(session.econ) : { ok: false, text: '' }),
    rushRemont: () => act(session ? rushRemont(session.econ) : { ok: false, text: '' }),
    restart: () => {
      if (!session) return;
      deleteSave(session.seed);
      ui.report.value = null;
      setSeed(session.seed, true);
    },
  };

  /** Stuknięcie w scenę: paleta (rozładunek), kasa (obsługa klienta), slot (karta zakupu) albo nic (zamyka kartę). */
  function onTap(x: number, y: number): void {
    if (!session || !loaded) return;
    const ndc = new Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, ctx.rig.camera);
    const targets: Object3D[] = [loaded.pallets?.root, loaded.equipment?.root, loaded.till, loaded.view.root.getObjectByName('fixtures')]
      .filter((o): o is Object3D => !!o);
    for (const hit of raycaster.intersectObjects(targets, true)) {
      const pallet = loaded.pallets?.palletAt(hit.object, hit.instanceId) ?? null;
      if (pallet !== null) {
        ui.selection.value = { kind: 'pallet', id: pallet };
        const r = game.tapPallet(pallet);
        if (r.ok) overlay?.floater(x, y, `+${Math.round(r.value ?? 0)} szt.`, 'work');
        return;
      }
      let o: Object3D | null = hit.object;
      while (o && !o.userData.pick) o = o.parent;
      const pick = o?.userData.pick as { kind: string; slotId?: string } | undefined;
      if (!pick) continue;
      if (pick.kind === 'till') {
        ui.selection.value = { kind: 'till' };
        const r = game.tapTill();
        if (r.ok) overlay?.floater(x, y, money(r.value ?? 0), 'money');
        return;
      }
      if (pick.kind === 'slot' && pick.slotId) {
        ui.selection.value = { kind: 'slot', slotId: pick.slotId };
        ui.tab.value = null;
        return;
      }
    }
    ui.selection.value = null;
  }

  const zoom = Number(params.get('zoom'));
  if (!benchMode && zoom > 0) ctx.rig.zoomBy(14 / zoom);
  const yaw = Number(params.get('yaw'));
  if (!benchMode && yaw >= 1 && yaw <= 3) ctx.rig.yawIndex = yaw as 1 | 2 | 3;
  ctx.setTimeOfDay(tod);
  ctx.rig.onChange(() => {
    loaded?.view.setCutaway(ctx.rig.yawIndex);
    loaded?.street?.setBuildingCutaway(!exterior, ctx.rig.yawIndex);
  });

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

  load(initialSeed);
  if (session) {
    writeSeedToUrl(session.seed);
    publish();
    saveSession(session);
    if (session.econ.minute === OPEN_FROM && session.econ.total.customers === 0) ui.showIntro.value = true;
  }

  // W benchmarku nic nie steruje kamerą ani presetem: wynik zależy tylko od biegu.
  if (!benchMode) {
    bindControls(ctx, {
      setPreset: (id) => controls.setPreset(id),
      onTap,
      extra: {
        x: () => {
          exterior = !exterior;
          loaded?.view.setExteriorMode(exterior);
          loaded?.street?.setBuildingCutaway(!exterior, ctx.rig.yawIndex);
        },
        ' ': () => controls.setSpeed(ui.speed.value === 0 ? 1 : 0),
        F3: () => { ui.showPerf.value = !ui.showPerf.value; },
      },
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && session) saveSession(session); });
    window.addEventListener('pagehide', () => { if (session) saveSession(session); });
  }

  void createCharacterFactory(pack).then((created) => {
    factory = created;
    if (loaded && !loaded.crowdView) loaded.crowdView = new CrowdView(created, loaded.world.layout, crowdRoot, pack, blobs);
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
    const realDt = Math.min(frameDt, MAX_FRAME_DT);

    if (session && loaded && loaded.world.speed > 0 && !ui.report.value && !ui.showIntro.value) {
      const events: EconEvent[] = [];
      advanceEconomy(session.econ, session.info, session.clock, realDt * loaded.world.speed, events);
      handleEvents(events);
      if (syncLayout(session)) load(session.seed);
    }
    syncVisuals();
    if (session && now - lastPublish > 200) { lastPublish = now; publish(); }

    if (loaded?.crowdView) {
      const { world, crowdView } = loaded;
      const paused = !!ui.report.value || ui.showIntro.value;
      const steps = paused ? 0 : advanceClock(clock, frameDt, world.speed);
      for (let i = 0; i < steps; i++) stepCrowd(world.crowd, world.layout, SIM_STEP);
      crowdView.setCharacterShadows(QUALITY[ctx.preset].characterShadows);
      const speed = paused ? 0 : world.speed;
      crowdView.sync(world.crowd, clockAlpha(clock), realDt * speed, realDt * Math.min(speed, ANIM_SPEED_CAP));
    }
    bench?.beforeRender();
    ctx.render();
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

  // uchwyt do ręcznych testów w konsoli; pola odczytywane na bieżąco
  Object.assign(window, {
    traszkaGame: {
      ctx,
      setSeed,
      game,
      /** Przewija grę o `minutes` minut (testy ręczne i zrzuty). */
      skip(minutes: number) {
        if (!session) return;
        const events: EconEvent[] = [];
        for (let i = 0; i < minutes && !session.econ.gameOver; i++) stepMinute(session.econ, session.info, events);
        handleEvents(events);
        afterAction();
      },
      get session() { return session; },
      get world() { return loaded?.world ?? null; },
      get view() { return loaded?.view ?? null; },
      get street() { return loaded?.street ?? null; },
      get crowdView() { return loaded?.crowdView ?? null; },
      get factory() { return factory; },
    },
  });

  if (!benchMode) renderUi(root, controls, game);   // sterowanie działa od tej chwili; benchmark zostaje z samą nakładką wyników
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
  const seed = requested || lastSavedSeed() || randomSeed();
  if (!requested) writeSeedToUrl(seed);
  // Zadanie 16: modular to jedyna paczka gry (docs/style-guide.md §5). `?pack=ubc` zostaje tylko do porównań, dopóki
  // zadanie 16b nie usunie paczki UBC z potoku assetów.
  const pack: CharacterPack = params.get('pack') === 'ubc' ? 'ubc' : 'modular';
  startGame(canvas, uiRoot, seed, q && q in QUALITY ? (q as QualityPresetId) : pickInitialPreset(detectDeviceCaps()), params, pack);
}
