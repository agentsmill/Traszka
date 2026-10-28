import { Group, Mesh, Raycaster, Vector2, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createRenderContext, type RenderContext } from '@/render/renderer';
import { QUALITY, detectDeviceCaps, pickInitialPreset, type QualityPresetId } from '@/render/quality';
import type { TimeOfDay } from '@/render/lighting';
import { BEVEL, PALETTE, material } from '@/render/style';
import { cellToWorld } from '@/render/coords';
import { attachCharacters, loadStore, unloadStore, type Loaded } from '@/render/game/loadedStore';
import { buildStreet, type StreetView } from '@/render/street/buildStreet';
import { createCharacterFactory, type CharacterFactory } from '@/render/characters/characterFactory';
import { ANIM_SPEED_CAP } from '@/render/crowdView';
import { createBlobShadows } from '@/render/characters/blobShadows';
import { DEFAULT_CASHIER_LOOK, cashierCues, type CashierLook } from '@/game/cashier';
import { MAX_FRAME_DT, advanceClock, clockAlpha } from '@/game/loop';
import { randomSeed } from '@/game/seedWords';
import { chooseStore, entrySeed, freeSeed } from '@/game/seeds';
import {
  NEWER_SAVE_NOTICE, UNBUILDABLE_SAVE_NOTICE, createSession, discardSave, hasStoredSave, lastSavedSeed, retireSession, reviveSession, saveSession,
  type GameSession,
} from '@/game/session';
import { dispatchCommand, markOffLog, type CommandEffects } from '@/game/actions';
import { bindControls } from '@/game/controls';
import { advanceSession, debugHandleEnabled, installDebugHandle, isModalOpen } from '@/game/frame';
import { openStore } from '@/game/openStore';
import { addToNetwork, claimDaily, loadMeta, needsStartScreen, partnerOf, saveMeta, startupWindow, type Meta } from '@/game/meta';
import { initialStartForm, noticeAfterOpen, openChosen, openRequestFor, playerOf, type StartChoice, type StoreSwitch } from '@/game/start';
import { rankFor } from '@/sim/economy/progress';
import { play, buzz, setSound, setVibration, type Sfx } from '@/ui/sfx';
import { confetti } from '@/ui/fx';
import { LINES, missingLine, pick } from '@/ui/game/lines';
import { SIM_STEP, payLook, setCrowdExtras, setCrowdRate, stepCrowd } from '@/sim/crowd/crowd';
import { CATS, HOUR_CURVE } from '@/sim/economy/catalog';
import { minuteOfDay } from '@/sim/economy/calendar';
import {
  effects, expectedDailyCustomers, grantDaily, grantOffline, isClosedForRemont, isStoreOpen, processLevels, slotUsage, stepMinute, tapCombo,
  type EconEvent,
} from '@/sim/economy/economy';
import { slotUnits } from '@/sim/economy/slots';
import { spotCells } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { CELL_SIZE_M } from '@/sim/grid';
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

/** Wpisuje seed do adresu (zachowując pozostałe parametry), żeby odświeżenie albo link odtworzyły ten sam sklep. */
function writeSeedToUrl(seed: string): void {
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  history.replaceState(null, '', url);
}

/** Najwięcej postaci w sklepie naraz: telefon i słabsza grafika dostają mniej. */
const CROWD_MAX: Record<QualityPresetId, number> = { niska: 10, srednia: 16, wysoka: 22 };

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
  const crowdRoot = new Group();
  crowdRoot.name = 'crowd';
  ctx.scene.add(crowdRoot);
  // plamy cienia pod postaciami: jedna siatka na całą grę, w grupie tłumu (benchmark ukrywa je razem z tłumem)
  const blobs = createBlobShadows();
  crowdRoot.add(blobs.mesh);
  const benchMode = benchKit !== null;
  const forcedNight = !benchMode && params.get('night') === '1';
  let tod: TimeOfDay = forcedNight ? 'night' : 'day';
  let exterior = !benchMode && params.get('ext') === '1';
  let factory: CharacterFactory | null = null;
  /** Fabryka postaci: z ekranu startowego (podgląd i gra mają te same stroje) albo własna, startowana niżej. Ekran „Nowy sklep” też z niej korzysta. */
  let factoryPromise: Promise<CharacterFactory> | null = entry?.factory ?? null;
  let loaded: Loaded | null = null;
  let generation = 0;               // odrzuca wyniki asynchroniczne, które wróciły po zmianie seeda
  let payingId: number | null = null;   // klient obsługiwany przy kasie w poprzedniej klatce (kasjer: gest przy sprzedaży)
  const clock = { acc: 0 };
  let meta: Meta = loadMeta();
  if (entry) {
    meta.player = playerOf(entry.choice);   // meta z nowszej wersji gry tego nie zapisze (saveMeta pomija ją), ale ta karta ma gracza
    saveMeta(meta);
  }
  // wygląd kasjera za ladą: jedno miejsce, z którego idzie do każdego sklepu (load i późna fabryka); zmiana na żywo: `setLook`
  let cashierLook: CashierLook = meta.player?.look ?? DEFAULT_CASHIER_LOOK;
  setSound(meta.sound);
  setVibration(meta.vibration);
  if (meta.readOnly) postNotice(NEWER_SAVE_NOTICE);   // meta z nowszej wersji gry: nic jej nie nadpisze w tej karcie
  // Sesja powstaje dopiero przy otwieraniu świata (openStore niżej): dopiero wtedy wiadomo, czy zapis dało się użyć i czy świat
  // z niego stanął. Benchmark nie ma sesji.
  let session: GameSession | null = null;
  const persist = (): void => {
    if (!session) return;
    saveSession(session);   // sklep tymczasowy się nie zapisuje
    // zarobek z nieobecności czeka na „Odbierz!”, więc czas wyjścia zostaje stary; sklep tymczasowy nie jest prawdziwą grą
    if (!ui.welcome.value && !session.ephemeral) meta.lastSeen = Date.now();
    saveMeta(meta);
  };
  const publishMeta = (): void => {
    const p = partnerOf(meta);
    ui.metaView.value = {
      points: p.points, stores: p.stores, networkIncome: p.networkIncome, network: meta.network.map((n) => n.seed), sound: meta.sound, vibration: meta.vibration,
    };
  };
  publishMeta();
  const overlay = benchMode ? null : createWorldOverlay(document.body);
  const raycaster = new Raycaster();

  function unload(): void {
    generation++;
    if (!loaded) return;
    const old = loaded;
    loaded = null;   // unloadStore sprząta do końca także wtedy, gdy rzuca: zwolnionego sklepu nie zwalniamy drugi raz
    unloadStore(old);
  }

  /**
   * Buduje świat sklepu `seed` w scenie. Gdy się nie uda, w scenie nie zostaje nic (ani z tej próby, ani z poprzedniego
   * sklepu), a wyjątek idzie dalej: wołający odtwarza poprzedni sklep albo otwiera awaryjny na czystej scenie.
   */
  function load(seed: string): void {
    const speed = loaded?.world.speed ?? ui.speed.value;
    unload();
    const mine = generation;

    const layout = session ? session.layout : generateStore(seed);
    const current = loadStore({
      scene: ctx.scene, seed, layout, info: session ? session.info : null, crowd: benchKit?.BENCH_CROWD, speed,
      crowdParent: crowdRoot, blobs, factory, cashierLook,
    });
    loaded = current;
    try {
      clock.acc = 0;
      payingId = null;   // nowy tłum liczy id agentów od początku
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
      current.view.setCutaway(ctx.rig.yawIndex);
      current.view.setExteriorMode(exterior);
      current.view.setTimeOfDay(tod);
      syncVisuals(true);
    } catch (error) {
      unload();   // sklep jest już w `loaded`: zdejmujemy go ze sceny, żeby wyjątek nie zostawił pół-sklepu
      throw error;
    }

    void buildStreet(layout, seed).then((built) => {
      if (mine !== generation) { built.dispose(); return; }
      current.street = built;
      built.setBuildingCutaway(!exterior, ctx.rig.yawIndex);
      built.setTimeOfDay(tod);
      ctx.scene.add(built.root);
    }).catch((error: unknown) => console.error('Nie udało się zbudować ulicy.', error));
  }

  /**
   * Przechodzi do sklepu `next`: zapisuje obecny, buduje świat nowego i dopiero wtedy zmienia adres. Gdy coś po drodze
   * rzuci, zostaje poprzedni sklep (świat budowany od nowa z jego sesji), a gracz dostaje komunikat. Zwraca, czy się udało.
   * `ephemeral`: świeża gra ma być tymczasowa (nic jej nie zapisze), np. „zacznij od nowa” w sklepie tymczasowym.
   */
  function setSeed(next: string, fresh = false, ephemeral = false): boolean {
    persist();
    const previous = session;
    const previousSeed = loaded?.world.seed ?? ui.seed.value;
    try {
      if (!benchMode) session = createSession(next, fresh, partnerOf(meta), { ephemeral });
      ui.selection.value = null;
      load(next);
    } catch (error) {
      console.error(`Nie udało się otworzyć sklepu „${next}”.`, error);
      session = previous;
      try {
        load(previous ? previous.seed : previousSeed);
      } catch (again) {
        console.error('Nie udało się odtworzyć poprzedniego sklepu.', again);
      }
      postNotice(`Nie udało się otworzyć sklepu „${next}”. Zostajesz w poprzednim.`);
      return false;
    }
    writeSeedToUrl(next);
    ui.seed.value = next;
    publish();
    persist();
    if (session?.loadNotice) postNotice(session.loadNotice);
    return true;
  }

  // --- Ekonomia → scena i interfejs ---

  let lastVisual = -1;
  let lastPublish = -1;
  let econVersion = 0;

  function publish(): void {
    if (!session) return;
    ui.econ.value = { s: session.econ, info: session.info, v: ++econVersion };
    ui.ephemeral.value = session.ephemeral;
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
    // znaczniki nad paletami: złota (premia) i stojąca pod sklepem ponad godzinę (ryzyko mandatu)
    const marks = [];
    for (const p of s.pallets) {
      const at = loaded.pallets?.worldPosition(p.id);
      if (!at) continue;
      at.y = 1.45;
      if (p.golden) marks.push({ key: `g${p.id}`, world: at, text: '✨', kind: 'golden' as const });
      else if (p.loc === 'sidewalk' && s.minute - p.since >= 60) marks.push({ key: `r${p.id}`, world: at, text: '⚠️', kind: 'risk' as const });
    }
    overlay?.setMarkers(marks);
    const closed = isClosedForRemont(s) ? 'REMONT' : !open ? 'ZAMKNIĘTE' : null;
    const q = Math.round(s.queue);
    overlay?.setTill(loaded.tillTop, closed ?? (q > 0 ? `👥 ${q}` : '🙂'), !closed && s.queue >= effects(s, info).patience);
  }

  const EVENT_SFX: Partial<Record<EconEvent['kind'], Sfx>> = { delivery: 'delivery', fine: 'fine', golden: 'golden', milestone: 'coins', warning: 'error' };

  function handleEvents(events: EconEvent[]): void {
    for (const e of events) {
      if (e.kind === 'day') { persist(); continue; }
      if (e.kind === 'month' && e.report) ui.report.value = e.report;
      if (e.kind === 'levelup' && e.level) {
        ui.celebration.value = {
          title: `POZIOM ${e.level}`,
          subtitle: rankFor(e.level),
          lines: [e.text.replace(/^Poziom \d+! /, ''), ...(e.unlocks ?? []).map((u) => `🔓 ${u}`)],
        };
        play('levelup');
        buzz([30, 40, 30]);
        confetti();
        continue;
      }
      const sfx = EVENT_SFX[e.kind];
      if (sfx) play(sfx);
      if (e.kind === 'golden' && e.text.startsWith('✨ Złota paleta rozładowana')) confetti(window.innerWidth / 2, window.innerHeight / 2, 24);
      ui.pushToast(e.text, e.kind);
    }
  }

  /**
   * Stan zmieniony poza poleceniami (nagroda powitalna, `skip`): poziomy z nagrody, ich zdarzenia i odświeżenie sceny oraz
   * interfejsu. Polecenia gracza przechodzą przez `dispatchCommand`, który robi to sam.
   */
  function settleOutsideCommand(): void {
    if (!session) return;
    const events: EconEvent[] = [];
    processLevels(session.econ, events);
    handleEvents(events);
    syncVisuals(true);
    publish();
  }

  /**
   * Efekty uboczne poleceń (`dispatchCommand`): dźwięk, wibracja, komunikaty, zapis i odświeżenie. Kolejność i warunki ich
   * użycia (które polecenie gra jaki dźwięk, kiedy zapisuje, kiedy zdejmuje zaznaczenie) trzyma tabela `AFTER` w `actions.ts`.
   */
  const commandEffects: CommandEffects = {
    play,
    buzz,
    toast: (text, kind) => ui.pushToast(text, kind),
    confetti: (fx, fy, count) => confetti(window.innerWidth * fx, window.innerHeight * fy, count),
    handleEvents,
    persist,
    clearSelection: () => { ui.selection.value = null; },
    rebuildScene: () => { if (session) load(session.seed); },   // `load` rzuca przy błędzie; `dispatchCommand` to łapie i pokazuje komunikat
    notice: postNotice,
    refresh: () => { syncVisuals(true); publish(); },
  };
  const money = (n: number): string => `+${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

  const game: ui.GameActions = {
    dispatch: (cmd) => (session ? dispatchCommand(session, cmd, commandEffects) : { ok: false, text: '' }),
    claimWelcome: () => {
      const w = ui.welcome.value;
      ui.welcome.value = null;
      if (!session || !w) return;
      grantOffline(session.econ, w.offline);
      if (w.daily && w.streak !== null) {
        grantDaily(session.econ, w.daily.cash, w.daily.ogonki);
        claimDaily(meta, w.streak, new Date());   // seria przesuwa się dopiero po odebraniu premii
      }
      markOffLog(session);   // nagroda poza poleceniami: dziennika już nie prowadzimy
      play('coins');
      confetti();
      settleOutsideCommand();
      persist();
    },
    openNextStore: () => {
      if (!session) return;
      if (session.ephemeral || meta.readOnly) {   // sieć sklepów trzeba zapisać, a ta karta nie może: sklep zniknąłby bez śladu
        postNotice('Kolejną Traszkę otworzysz po odświeżeniu strony: ta karta nie może teraz zapisać sieci sklepów.');
        return;
      }
      const closed = session;
      const before = meta;
      // nowa gra nie czyta zapisu, więc seed musi być wolny (inaczej pierwszy zapis zjadłby cudzą grę); losujemy przed
      // zamknięciem, kiedy zapis zamykanego sklepu jeszcze leży, więc i jego seed nie wróci; seed z sieci też jest zajęty,
      // bo addToNetwork przyjmuje każdy seed raz i drugi sklep pod nim nie dałby premii
      const next = freeSeed(randomSeed, (s) => hasStoredSave(s) || meta.network.some((n) => n.seed === s));
      meta = addToNetwork(meta, closed.econ);   // nowy sklep dostaje już premię z tego; ten sam seed drugi raz niczego nie daje
      retireSession(closed);                    // zapis znika i nie wróci: setSeed zaraz zapisuje „bieżący” sklep
      if (!setSeed(next, true)) {               // nowy sklep się nie otworzył: wszystko wraca na miejsce
        meta = before;
        reviveSession(closed);
        persist();
        return;
      }
      publishMeta();
      ui.tab.value = null;
      ui.celebration.value = {
        title: 'NOWA TRASZKA!',
        subtitle: `Sieć: ${meta.network.length} ${meta.network.length === 1 ? 'sklep' : 'sklepy'} · ${meta.partnerPoints} Punktów Partnera`,
        lines: [`Dochód z sieci: ${partnerOf(meta).networkIncome.toLocaleString('pl-PL')} zł dziennie`],
      };
      play('levelup');
      confetti();
    },
    setSound: (on) => { meta.sound = on; setSound(on); saveMeta(meta); publishMeta(); },
    setVibration: (on) => { meta.vibration = on; setVibration(on); saveMeta(meta); publishMeta(); },
    restart: () => {
      if (!session) return;
      const ephemeral = session.ephemeral;   // zapis pod seedem sklepu tymczasowego jest cudzy: zostaje, a świeża gra też jest tymczasowa
      discardSave(session);
      ui.report.value = null;
      setSeed(session.seed, true, ephemeral);
    },
    newStore: () => {
      if (benchMode) return;
      ui.showSettings.value = false;
      ui.tab.value = null;
      ui.selection.value = null;
      // gra czeka pod ekranem (modal w pętli klatek); seed w polu to wolny, losowy: „Otwieramy sklep!” otwiera NOWY sklep
      ui.start.value = {
        mode: 'new',
        form: initialStartForm(meta, freeSeed(randomSeed, hasStoredSave)),
        factory: (factoryPromise ??= createCharacterFactory()),
        onStart: openChosenStore,
        onBack: () => {},
      };
    },
  };

  /** Przejście na sklep dla `openChosen` (start.ts): `setSeed` z argumentami z wyboru, bieżąca sesja i komunikat u góry ekranu. */
  const storeSwitch: StoreSwitch = {
    setSeed: (seed, fresh) => setSeed(seed, fresh),
    session: () => session,
    toast: (text) => ui.pushToast(text, 'info'),
  };

  /**
   * Wybór gracza z ekranu „Nowy sklep”: nick i wygląd kasjera do meta (w pamięci także wtedy, gdy meta jest tylko do odczytu), a
   * sklep otwiera `openChosen` (start.ts, z testem): przez `setSeed` zawsze bez `fresh`, więc seed z zapisem wczytuje ten zapis, a
   * zapisu z nowszej wersji gry ani takiego, którego świata nie dało się zbudować, nic nie nadpisze (`createSession`). Wygląd idzie
   * do `cashierLook` przed `setSeed`: każdy sklep (także poprzedni, odtworzony, gdy nowy się nie otworzył) stawia kasjera z tej
   * zmiennej, więc `CashierView.setLook` na żywo nie jest tu potrzebne.
   */
  function openChosenStore(choice: StartChoice): void {
    meta.player = playerOf(choice);
    saveMeta(meta);
    cashierLook = choice.look;
    openChosen(choice, storeSwitch);
  }

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
        const r = game.dispatch({ type: 'tapPallet', palletId: pallet });
        const mult = tapCombo(session.econ).mult;   // seria po tym stuknięciu, ze stanu gry
        if (r.ok) overlay?.floater(x, y, `+${Math.round(r.value ?? 0)} szt.${mult > 1 ? ` ×${mult}` : ''}`, 'work');
        return;
      }
      let o: Object3D | null = hit.object;
      while (o && !o.userData.pick) o = o.parent;
      const pick = o?.userData.pick as { kind: string; slotId?: string } | undefined;
      if (!pick) continue;
      if (pick.kind === 'till') {
        ui.selection.value = { kind: 'till' };
        const r = game.dispatch({ type: 'tapTill' });
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
    // te same zasady co na ekranie startowym: zapis pod seedem wygrywa, dziwny tekst też daje sklep, a otwiera go to samo `openChosen`
    generate: (text) => { openChosen(chooseStore(text), storeSwitch); },
    randomize: () => setSeed(randomSeed()),
  };

  if (benchMode) {
    load(initialSeed);   // benchmark nie ma sesji ani zapisu: wyjątek idzie dalej
  } else {
    // Zapis, który przeszedł walidację, nie przepada z powodu świata, który się nie zbudował (openStore: druga próba z układem
    // z seeda, potem sklep tymczasowy); do kopii idzie tylko zapis, którego nie da się przeczytać. Każda nieudana próba budowy
    // sprząta po sobie scenę (loadStore), więc kolejna zaczyna od czystej.
    try {
      const build = (opening: GameSession): void => { session = opening; load(opening.seed); };
      session = openStore(entry
        ? openRequestFor(entry.choice, { partner: partnerOf(meta), randomSeed, build })   // ekran startowy: nigdy `fresh`
        : { seed: initialSeed, fresh: params.get('new') === '1', partner: partnerOf(meta), randomSeed, build });
    } catch (error) {
      // żaden sklep się nie zbudował (renderer): zapis nietknięty, a gracz dostaje komunikat zamiast pustej strony
      console.error('Nie udało się zbudować żadnego sklepu.', error);
      postNotice(UNBUILDABLE_SAVE_NOTICE);
      return;
    }
    ui.seed.value = session.seed;
    const chosenNotice = entry ? noticeAfterOpen(entry.choice, session) : null;   // „Wczytujemy…” tylko, gdy zapis wczytał się normalnie
    if (chosenNotice) ui.pushToast(chosenNotice, 'info');
    if (session.loadNotice) postNotice(session.loadNotice);   // po komunikacie z ekranu: ten o zapisie zostaje na wierzchu
  }
  if (session) {
    // Adres dopiero po tym, jak świat stoi. Sklep tymczasowy o innym seedzie niż ten, o który prosił adres, go nie przepisuje:
    // odświeżenie ma wrócić do sklepu gracza (jego zapis jest cały), a nie utknąć w zastępczym.
    if (!session.ephemeral || session.seed === initialSeed) writeSeedToUrl(session.seed);
    publish();
    // nic się nie zapisuje, dopóki gracz nie kliknie „Odbierz!”; po wypowiedzeniu umowy wstaje samo okno końca gry
    const start = startupWindow(meta, session.econ, session.ephemeral, new Date());
    ui.showHints(start.intro ? FIRST_DAY_HINTS : []);   // nowa gra: wskazówki pierwszego dnia w krótkich dymkach
    ui.welcome.value = start.welcome;
    persist();
  }

  // W benchmarku nic nie steruje kamerą ani presetem: wynik zależy tylko od biegu.
  if (!benchMode) {
    bindControls(ctx, {
      setPreset: (id) => controls.setPreset(id),
      onTap,
      blocked: () => !!ui.start.value,
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
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
    window.addEventListener('pagehide', persist);
  }

  void (factoryPromise ??= createCharacterFactory()).then((created) => {
    factory = created;
    if (loaded) attachCharacters(loaded, { factory: created, crowdParent: crowdRoot, blobs, cashierLook });   // tłum i kasjer
  }).catch((error: unknown) => console.error('Nie udało się wczytać postaci.', error));

  const bench = benchKit
    ? benchKit.createBenchSession(ctx, crowdRoot, {
      quick: params.get('quick') === '1',
      onProgress: (progress) => { ui.bench.value = progress; },
      onPreset: (id) => { ui.preset.value = id; },
    })
    : null;
  /** Dymek z wypowiedzią losowego klienta, dobraną do sytuacji w sklepie (kolejka, puste półki, palety…). */
  let nextSpeech = performance.now() + 6000;
  function speak(sess: GameSession, current: Loaded): void {
    const s = sess.econ;
    if (!isStoreOpen(s)) return;
    const agents = current.world.crowd.agents.filter((a) => a.state === 'browsing' || a.state === 'queueing' || a.state === 'paying' || a.state === 'toQueue');
    if (agents.length === 0) return;
    const agent = agents[Math.floor(Math.random() * agents.length)]!;
    const fx = effects(s, sess.info);
    const empty = CATS.filter((c) => sess.info.shelfCap[c] > 0 && s.shelf[c] / sess.info.shelfCap[c] < 0.15);
    const hour = minuteOfDay(s.minute) / 60;
    let text: string;
    if (s.queue >= fx.patience * 0.8 && (agent.state === 'queueing' || agent.state === 'toQueue')) text = pick(LINES.queue);
    else if (empty.length > 0 && Math.random() < 0.6) text = missingLine(pick(empty));
    else if (s.pallets.some((p) => p.loc === 'floor') && Math.random() < 0.4) text = pick(LINES.pallets);
    else if (fx.sco > 0 && agent.state === 'paying' && Math.random() < 0.4) text = pick(LINES.sco);
    else if (s.minute < s.boostUntil && Math.random() < 0.5) text = pick(LINES.rush);
    else if (hour >= 21 && Math.random() < 0.5) text = pick(LINES.night);
    else text = pick(LINES.happy);
    const { width, depth } = current.world.layout;
    overlay?.say(() => {
      const a = current.world.crowd.agents.find((x) => x.id === agent.id);
      return a && loaded === current ? new Vector3((a.x - width / 2) * CELL_SIZE_M, 2.0, (a.y - depth / 2) * CELL_SIZE_M) : null;
    }, text);
  }

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

    const modal = isModalOpen(session);
    if (session && loaded) {
      const events: EconEvent[] = [];
      advanceSession(session, realDt, loaded.world.speed, modal, events);
      handleEvents(events);   // układ zmienia tylko polecenie (`dispatchCommand`), więc tu sceny nie przebudowujemy
    }
    syncVisuals();
    if (session && now - lastPublish > 200) { lastPublish = now; publish(); }
    if (session && loaded && !modal && loaded.world.speed > 0 && now > nextSpeech) {
      nextSpeech = now + 4000 + Math.random() * 5000;
      speak(session, loaded);
    }

    if (loaded?.crowdView) {
      const { world, crowdView, cashierView } = loaded;
      const paused = modal;
      const steps = paused ? 0 : advanceClock(clock, frameDt, world.speed);
      for (let i = 0; i < steps; i++) stepCrowd(world.crowd, world.layout, SIM_STEP);
      crowdView.setCharacterShadows(QUALITY[ctx.preset].characterShadows);
      const speed = paused ? 0 : world.speed;
      const animDt = realDt * Math.min(speed, ANIM_SPEED_CAP);
      crowdView.sync(world.crowd, clockAlpha(clock), realDt * speed, animDt);
      if (cashierView) {
        const cues = cashierCues(payingId, world.crowd.agents, world.layout);
        payingId = cues.payingId;
        cashierView.setCharacterShadows(QUALITY[ctx.preset].characterShadows);
        cashierView.update(realDt * speed, cues.serving, cues.sale, animDt);
      }
    }
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
  installDebugHandle(window, {
    ctx,
    setSeed,
    game,
    /** Przewija grę o `minutes` minut (testy ręczne i zrzuty). */
    skip(minutes: number) {
      if (!session) return;
      const events: EconEvent[] = [];
      for (let i = 0; i < minutes && !session.econ.gameOver; i++) stepMinute(session.econ, session.info, events);
      handleEvents(events);
      markOffLog(session);   // przewinięcie nie jest poleceniem: dziennik nie odtworzy takiego stanu
      settleOutsideCommand();
    },
    get session() { return session; },
    get world() { return loaded?.world ?? null; },
    get view() { return loaded?.view ?? null; },
    get street() { return loaded?.street ?? null; },
    get crowdView() { return loaded?.crowdView ?? null; },
    get cashierView() { return loaded?.cashierView ?? null; },
    get factory() { return factory; },
  }, debugHandleEnabled(import.meta.env.DEV, params));

  if (!benchMode) renderUi(root, controls, game);   // sterowanie działa od tej chwili; benchmark zostaje z samą nakładką wyników
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
