import { Group, Mesh, Raycaster, Vector2, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createRenderContext, type RenderContext } from '@/render/renderer';
import { QUALITY, type QualityPresetId } from '@/render/quality';
import type { TimeOfDay } from '@/render/lighting';
import { BEVEL, PALETTE, material } from '@/render/style';
import { cellToWorld } from '@/render/coords';
import { attachCharacters, loadStore, unloadStore, type Loaded } from '@/render/game/loadedStore';
import { buildStreet } from '@/render/street/buildStreet';
import type { CharacterFactory } from '@/render/characters/characterFactory';
import { ANIM_SPEED_CAP } from '@/render/crowdView';
import { createBlobShadows } from '@/render/characters/blobShadows';
import { cashierCues, type CashierLook } from './cashier';
import { bindControls } from './controls';
import { advanceClock, clockAlpha } from './loop';
import type { GameSession } from './session';
import { palletRefsOf } from './palletRefs';
import { SIM_STEP, payLook, setCrowdExtras, setCrowdRate, stepCrowd, type CrowdOptions } from '@/sim/crowd/crowd';
import { CATS, HOUR_CURVE } from '@/sim/economy/catalog';
import { minuteOfDay } from '@/sim/economy/calendar';
import { effects, expectedDailyCustomers, isClosedForRemont, isOpenForCustomers, slotUsage } from '@/sim/economy/economy';
import { slotUnits } from '@/sim/economy/slots';
import { staffOnShift } from '@/sim/economy/tycoon/shift';
import { spotCells } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { CELL_SIZE_M } from '@/sim/grid';
import { LINES, missingLine, pick } from '@/ui/game/lines';
import type { WorldOverlay } from '@/ui/worldOverlay';
import * as ui from '@/ui/state';

/**
 * Scena gry: wszystko, co dotyka three.js i obrazu. `createSceneHost` trzyma świat sklepu w scenie (`Loaded`), tłum, kasjera i załogę,
 * porę dnia, widok z zewnątrz i zegar tłumu, a zmiany stanu gry pokazuje na scenie (`syncVisuals`). O tym, co gra robi, nie
 * wie nic: sesję dostaje od wołającego (`GameShell` w actions.ts), a stuknięcie oddaje jako `ScenePick`. Host potrzebuje WebGL
 * i DOM; testowalna w node jest tylko czysta część (`crowdRateFor`, `timeOfDayAt`), resztę sprawdza przeglądarka.
 */

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
export function startTestScene(canvas: HTMLCanvasElement, preset: QualityPresetId): void {
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
export function writeSeedToUrl(seed: string): void {
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  history.replaceState(null, '', url);
}

/** Najwięcej postaci w sklepie naraz: telefon i słabsza grafika dostają mniej. */
export const CROWD_MAX: Record<QualityPresetId, number> = { niska: 10, srednia: 16, wysoka: 22 };

/**
 * Tłum, jakiego chce ekonomia: ile postaci naraz i ile nowych na minutę. Zamknięty sklep (noc, remont, karta „zamknij na godzinę”) nie wpuszcza nikogo
 * i wyprasza tych w środku (`closing`: do kasy i za próg, szybko, bo noc trwa kilka sekund),
 * otwarty liczy ruch z bieżącej godziny (klientów na godzinę), ograniczony presetem grafiki (`CROWD_MAX`) i widełkami 4–… oraz 3–24.
 */
export function crowdRateFor(session: Pick<GameSession, 'econ' | 'info'>, preset: QualityPresetId): CrowdOptions {
  const { econ: s, info } = session;
  if (!isOpenForCustomers(s)) return { targetCount: 0, spawnPerMinute: 0, closing: true };
  const perHour = expectedDailyCustomers(s, info) / 15.6 * (HOUR_CURVE[Math.floor(minuteOfDay(s.minute) / 60)] ?? 0);
  return { targetCount: Math.max(4, Math.min(CROWD_MAX[preset], Math.round(perHour * 0.35))), spawnPerMinute: Math.max(3, Math.min(24, perHour * 0.3)) };
}

/** Pora dnia dla minuty gry (20:00–6:00 noc). */
export function timeOfDayAt(minute: number): TimeOfDay {
  const hour = minuteOfDay(minute) / 60;
  return hour >= 20 || hour < 6 ? 'night' : 'day';
}

/** Co jest pod punktem ekranu, o ile gra ma na to reakcję: paleta (rozładunek), kasa (obsługa klienta) albo slot (karta zakupu). */
export type ScenePick = { kind: 'pallet'; id: number } | { kind: 'till' } | { kind: 'slot'; slotId: string };

/** Czego `createSceneHost` potrzebuje od gry. */
export interface SceneDeps {
  ctx: RenderContext;
  /** Liczba postaci w tłumie w benchmarku (stała, bez ekonomii); w zwykłej grze brak. */
  benchCrowd?: CrowdOptions;
  /** Wygląd kasjera za ladą, od którego startuje każdy sklep (zmiana: `setCashierLook`). */
  cashierLook: CashierLook;
  /** Stała noc ze zrzutu (`?night=1`): zegar gry nie przełącza pory dnia. */
  forcedNight: boolean;
  /** Start w widoku z zewnątrz (`?ext=1`). */
  exterior: boolean;
  /** `?zoom=` podany w adresie: na pionowym ekranie kadr nie dopasowuje się wtedy do sali. */
  zoomPinned: boolean;
  /** Nakładka z elementami HTML przyklejonymi do sceny (znaczniki, dymki); `null` w benchmarku. */
  overlay: WorldOverlay | null;
}

export interface SceneHost {
  /** Świat bieżącego sklepu w scenie albo null (scena pusta, np. po nieudanej budowie). */
  readonly loaded: Loaded | null;
  /** Seed sklepu w scenie albo null. */
  readonly seed: string | null;
  /** Grupa tłumu: benchmark chowa ją razem z postaciami. */
  readonly crowdRoot: Group;
  /** Fabryka postaci, jeśli już wczytana (uchwyt debugowania). */
  readonly factory: CharacterFactory | null;
  /**
   * Buduje świat sklepu `seed` w scenie, na sesji `session` (jej układ i opis; `null` w benchmarku). Gdy się nie uda, w scenie
   * nie zostaje nic (ani z tej próby, ani z poprzedniego sklepu), a wyjątek idzie dalej: wołający odtwarza poprzedni sklep
   * albo otwiera awaryjny na czystej scenie.
   */
  load(seed: string, session: GameSession | null): void;
  /** Zdejmuje sklep ze sceny; wyniki asynchroniczne budowy (ulica) odrzuca. */
  unload(): void;
  /** Scena według stanu gry: palety, sprzęt, półki, tłum, pora dnia, znaczniki. Co ~100 ms (albo od razu z `force`). */
  syncVisuals(session: GameSession | null, force?: boolean): void;
  /** Krok tłumu i kasjera w klatce: `frameDt` to czas klatki, `realDt` ten sam przycięty do `MAX_FRAME_DT`, `paused` zatrzymuje ruch. */
  animate(frameDt: number, realDt: number, paused: boolean): void;
  /** Co jest pod punktem ekranu (px) albo null. */
  pick(x: number, y: number): ScenePick | null;
  setTimeOfDay(tod: TimeOfDay): void;
  /** Przełącza widok z zewnątrz (ściany sklepu i budynek). */
  toggleExterior(): void;
  /** Dymek z wypowiedzią losowego klienta, dobraną do sytuacji w sklepie (kolejka, puste półki, palety…). */
  speak(session: GameSession): void;
  /** Wygląd kasjera dla sklepów budowanych od teraz (kasjer w sklepie, który już stoi, zostaje). */
  setCashierLook(look: CashierLook): void;
  /** Fabryka postaci doszła: tłum i kasjer w sklepie, który już stoi, dostają postacie. */
  attachFactory(factory: CharacterFactory): void;
}

/**
 * Scena gry nad kontekstem renderera `deps.ctx`: grupa tłumu z plamami cienia już w scenie, pora dnia z `?night=1`, kamera
 * odświeża przekrój budynku przy obrocie.
 */
export function createSceneHost(deps: SceneDeps): SceneHost {
  const { ctx, forcedNight, overlay } = deps;
  const crowdRoot = new Group();
  crowdRoot.name = 'crowd';
  ctx.scene.add(crowdRoot);
  // plamy cienia pod postaciami: jedna siatka na całą grę, w grupie tłumu (benchmark ukrywa je razem z tłumem)
  const blobs = createBlobShadows();
  crowdRoot.add(blobs.mesh);
  const raycaster = new Raycaster();
  const clock = { acc: 0 };
  let tod: TimeOfDay = forcedNight ? 'night' : 'day';
  let exterior = deps.exterior;
  let cashierLook = deps.cashierLook;
  let factory: CharacterFactory | null = null;
  let loaded: Loaded | null = null;
  let generation = 0;               // odrzuca wyniki asynchroniczne, które wróciły po zmianie seeda
  let payingId: number | null = null;   // klient obsługiwany przy kasie w poprzedniej klatce (kasjer: gest przy sprzedaży)
  let lastVisual = -1;
  let staffSyncFailed = false;           // błąd synchronizacji załogi zgłaszamy raz, a nie co ~100 ms

  ctx.setTimeOfDay(tod);
  ui.timeOfDay.value = tod;
  ctx.rig.onChange(() => {
    loaded?.view.setCutaway(ctx.rig.yawIndex);
    loaded?.street?.setBuildingCutaway(!exterior, ctx.rig.yawIndex);
  });

  function unload(): void {
    generation++;
    if (!loaded) return;
    const old = loaded;
    loaded = null;   // unloadStore sprząta do końca także wtedy, gdy rzuca: zwolnionego sklepu nie zwalniamy drugi raz
    unloadStore(old);
  }

  function setTimeOfDay(next: TimeOfDay): void {
    tod = next;
    ui.timeOfDay.value = next;
    ctx.setTimeOfDay(next);
    loaded?.view.setTimeOfDay(next);
    loaded?.street?.setTimeOfDay(next);
  }

  function syncVisuals(session: GameSession | null, force = false): void {
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
    setCrowdRate(loaded.world.crowd, crowdRateFor(session, ctx.preset));
    // załoga: kto jest na zmianie i co robi (numery osób są stałe, `shift.people`), oraz palety (przeszkody i cele rozładunku);
    // scena tylko to odgrywa
    // Błąd w teatrze załogi nie może przerwać reszty tej metody (pora dnia, znaczniki, nakładka kasy) ani klatki: raz do konsoli.
    try {
      loaded.staffView?.sync({ people: staffOnShift(s), minute: s.minute, pallets: palletRefsOf(s, info) });
    } catch (error) {
      if (!staffSyncFailed) console.error('Nie udało się zsynchronizować załogi z ekonomią.', error);
      staffSyncFailed = true;
    }

    // pora dnia z zegara gry, chyba że zrzut wymusza noc
    if (!forcedNight) {
      const want = timeOfDayAt(s.minute);
      if (want !== tod) setTimeOfDay(want);
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
    const open = isOpenForCustomers(s);
    const closed = isClosedForRemont(s) ? 'REMONT' : !open ? 'ZAMKNIĘTE' : null;
    const q = Math.round(s.queue);
    overlay?.setTill(loaded.tillTop, closed ?? (q > 0 ? `👥 ${q}` : '🙂'), !closed && s.queue >= effects(s, info).patience);
  }

  function load(seed: string, session: GameSession | null): void {
    const speed = loaded?.world.speed ?? ui.speed.value;
    unload();
    const mine = generation;

    const layout = session ? session.layout : generateStore(seed);
    const current = loadStore({
      scene: ctx.scene, seed, layout, info: session ? session.info : null, crowd: deps.benchCrowd, speed,
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
      if (portrait && !deps.zoomPinned) {
        // sala w kadrze: rzut izometryczny ma szerokość ~ (szerokość + głębokość sali) · cos 45°
        const fit = ((layout.width + layout.midWallY) * CELL_SIZE_M * Math.SQRT1_2 * 0.8) / aspect;
        ctx.rig.zoomBy(ctx.rig.viewSize / Math.min(28, Math.max(14, fit)));
      }
      current.view.setCutaway(ctx.rig.yawIndex);
      current.view.setExteriorMode(exterior);
      current.view.setTimeOfDay(tod);
      syncVisuals(session, true);
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

  return {
    get loaded() { return loaded; },
    get seed() { return loaded?.world.seed ?? null; },
    crowdRoot,
    get factory() { return factory; },
    load,
    unload,
    syncVisuals,

    animate(frameDt, realDt, paused) {
      if (!loaded?.crowdView) return;
      const { world, crowdView, cashierView, staffView } = loaded;
      const steps = paused ? 0 : advanceClock(clock, frameDt, world.speed);
      for (let i = 0; i < steps; i++) stepCrowd(world.crowd, world.layout, SIM_STEP);
      crowdView.setCharacterShadows(QUALITY[ctx.preset].characterShadows);
      const speed = paused ? 0 : world.speed;
      const animDt = realDt * Math.min(speed, ANIM_SPEED_CAP);
      crowdView.sync(world.crowd, clockAlpha(clock), realDt * speed, animDt);
      if (cashierView || staffView) {
        const cues = cashierCues(payingId, world.crowd.agents, world.layout);
        payingId = cues.payingId;
        // załoga przed kasjerem: kasjer ma dostać pozę z bieżącej klatki (idzie do palet albo wraca za ladę)
        if (staffView) {
          staffView.setCharacterShadows(QUALITY[ctx.preset].characterShadows);
          staffView.update(realDt * speed, animDt, cues.serving);
        }
        if (cashierView) {
          cashierView.setCharacterShadows(QUALITY[ctx.preset].characterShadows);
          cashierView.update(realDt * speed, cues.serving, cues.sale, animDt);
        }
      }
    },

    pick(x, y) {
      if (!loaded) return null;
      const ndc = new Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, ctx.rig.camera);
      const targets: Object3D[] = [loaded.pallets?.root, loaded.equipment?.root, loaded.till, loaded.view.root.getObjectByName('fixtures')]
        .filter((o): o is Object3D => !!o);
      for (const hit of raycaster.intersectObjects(targets, true)) {
        const pallet = loaded.pallets?.palletAt(hit.object, hit.instanceId) ?? null;
        if (pallet !== null) return { kind: 'pallet', id: pallet };
        let o: Object3D | null = hit.object;
        while (o && !o.userData.pick) o = o.parent;
        const picked = o?.userData.pick as { kind: string; slotId?: string } | undefined;
        if (!picked) continue;
        if (picked.kind === 'till') return { kind: 'till' };
        if (picked.kind === 'slot' && picked.slotId) return { kind: 'slot', slotId: picked.slotId };
      }
      return null;
    },

    setTimeOfDay,

    toggleExterior() {
      exterior = !exterior;
      loaded?.view.setExteriorMode(exterior);
      loaded?.street?.setBuildingCutaway(!exterior, ctx.rig.yawIndex);
    },

    speak(session) {
      const current = loaded;
      if (!current) return;
      const s = session.econ;
      if (!isOpenForCustomers(s)) return;
      const agents = current.world.crowd.agents.filter((a) => a.state === 'browsing' || a.state === 'queueing' || a.state === 'paying' || a.state === 'toQueue');
      if (agents.length === 0) return;
      const agent = agents[Math.floor(Math.random() * agents.length)]!;
      const fx = effects(s, session.info);
      const empty = CATS.filter((c) => session.info.shelfCap[c] > 0 && s.shelf[c] / session.info.shelfCap[c] < 0.15);
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
    },

    setCashierLook(look) { cashierLook = look; },

    attachFactory(created) {
      factory = created;
      if (loaded) attachCharacters(loaded, { factory: created, crowdParent: crowdRoot, blobs, cashierLook });   // tłum i kasjer
    },
  };
}
