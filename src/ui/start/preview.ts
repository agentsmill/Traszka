import {
  CylinderGeometry, DirectionalLight, Group, HemisphereLight, MathUtils, Mesh, NeutralToneMapping, PCFShadowMap, PerspectiveCamera,
  Scene, SRGBColorSpace, Texture, WebGLRenderer, type BufferGeometry, type Camera, type Material, type Object3D,
} from 'three';
import type { CashierLook } from '@/game/cashier';
import { createCashierCharacter, isOutfitReady, releaseCharacter } from '@/render/cashierView';
import type { CharacterFactory, CharacterInstance } from '@/render/characters/characterFactory';
import { LIGHT_PRESETS, PALETTE, material } from '@/render/style';

/**
 * Podgląd kasjera na ekranie startowym: własny, lekki renderer three.js na własnej kanwie (bez postprocessingu, AO i bloomu,
 * z jedną małą mapą cienia), kasjer na obrotowym podeście, animacja `Idle`. Nie dzieli kontekstu z grą: powstaje przy
 * otwarciu ekranu, a `dispose` zwalnia renderer i kontekst WebGL, zanim ruszy gra. Fabryka postaci jest WSPÓLNA z grą (przekazuje
 * ją wołający): podgląd zwalnia tylko swoją postać, nigdy fabrykę ani jej geometrie.
 *
 * Podgląd rysuje WYŁĄCZNIE to, co sam zwalnia. Three zapisuje renderer na zdarzenie `dispose` każdej geometrii i każdego materiału,
 * które narysuje, a jego własne `dispose()` tych zapisów nie zdejmuje. Gdyby podgląd rysował geometrię wspólną z grą albo materiał
 * z pamięci stylu, każde otwarcie ekranu zostawiałoby w nim nasłuch, który trzyma przy życiu cały renderer (jeden `WebGLRenderer`
 * wycieka na otwarcie). Dlatego podest ma własne materiały (kopie z pamięci stylu), a pod siatkę każdej postaci podgląd podstawia
 * własną kopię geometrii (`ownGeometries`) i zwalnia ją razem z postacią. Materiał postaci jest jej własny (zwalnia go `dispose`
 * postaci). Trzeci taki obiekt nie leży w scenie: three 0.186 daje każdemu materiałowi fizycznemu GLOBALNĄ teksturę DFG LUT (jedną na
 * stronę, `getDFGLUT()`) i każdy renderer zapisuje się na jej `dispose`, więc po zwolnionym rendererze zostaje w niej nasłuch, który
 * trzyma jego programy, a przez nie jego samego (`dfgLutOf`, zwalniana w `dispose`; graczowi, którego renderer żyje dalej, zostaje
 * jedna ponowna klatka z wgraniem 16×16 px). Kasjera buduje ta sama funkcja co w sklepie
 * (`createCashierCharacter`: mundur dla stroju zwykłego, strój specjalny zostaje sobą), więc podgląd pokazuje dokładnie tego
 * kasjera, który stanie za ladą. Strój specjalny dociąga się dopiero przy pokazaniu (`ensureOutfit`, ruling R40).
 */

/** Kąt widzenia kamery podglądu (stopnie): wąski, żeby kasjer nie miał zniekształconej perspektywy. */
const FOV_DEG = 24;
/** Wysokość (m), na której kamera patrzy: trochę nad połową wzrostu, żeby zmieściły się kapelusz i korona. */
const TARGET_Y_M = 0.8;
/** Ile metrów w pionie i w poziomie ma się zmieścić w kadrze (kasjer do 1,88 m z nakryciem głowy, podest, barki i ręce w ruchu). */
const FRAME_HEIGHT_M = 2.45;
const FRAME_WIDTH_M = 1.9;
/** Kamera patrzy z lekkiej góry (stopnie nad poziomem): widać podest i stopy na nim. */
const ELEVATION_DEG = 9;
/** Obrót podestu (rad/s): pełny obrót co ~12 s. */
export const SPIN_RAD_S = 0.52;
/** Obrót podestu przy przeciąganiu palcem albo myszą (rad na piksel). */
export const DRAG_RAD_PER_PX = 0.012;
/** Po puszczeniu podest stoi jeszcze tyle (ms), zanim wróci samoczynny obrót. */
export const RESUME_SPIN_AFTER_MS = 2500;
/** Najdłuższy krok czasu klatki (s): karta w tle nie „przeskakuje” po powrocie. */
const MAX_DT_S = 0.1;
/** Górna granica gęstości pikseli: podgląd jest mały, więcej niż 2× nie widać. */
const MAX_PIXEL_RATIO = 2;

/** Podest: dwa walce (cream na wierzchu, zieleń marki wokół); `top` to wysokość wierzchu (m), wierzch cream leży na y = 0. */
const PEDESTAL = [
  { radius: 0.62, height: 0.07, top: 0, color: PALETTE.brand.cream },
  { radius: 0.7, height: 0.09, top: -0.07, color: PALETTE.brand.green },
] as const;

/** Czego podgląd potrzebuje od renderera (prawdziwy `WebGLRenderer` to spełnia; test podaje atrapę). */
export interface PreviewRenderer {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
  /** Oddaje kontekst WebGL od razu (przeglądarka ma ich ograniczoną liczbę), a nie dopiero po zbiórce śmieci. */
  forceContextLoss(): void;
  /** Właściwości, które renderer zapisał przy obiektach (`WebGLRenderer.properties`): stąd podgląd bierze globalną teksturę three (`dfgLutOf`). */
  readonly properties: { get(object: unknown): unknown };
}

export interface PreviewOptions {
  /** Własny renderer (testy); domyślnie `WebGLRenderer` na przekazanej kanwie. */
  renderer?: PreviewRenderer;
}

export interface StartPreview {
  /**
   * Pokazuje wygląd na podeście. Strój zwykły staje od razu (przed zwróceniem obietnicy), strój specjalny po `ensureOutfit`, a do
   * tego czasu zostaje poprzednia postać. Obietnica spełnia się po pokazaniu albo gdy wyprzedziło ją nowsze `show`; nigdy nie
   * odrzuca (błąd budowy idzie do konsoli, a poprzednia postać zostaje).
   */
  show(look: CashierLook): Promise<void>;
  /** Ustawia kąt podestu (rad, 0 = przodem do kamery) i wstrzymuje samoczynny obrót (zrzuty z przodu i z tyłu, testy). */
  setYaw(yaw: number): void;
  /** Wygląd, który stoi teraz na podeście, albo null. */
  readonly look: CashierLook | null;
  /** Zwalnia postać, podest, światła i renderer razem z kontekstem WebGL. Po `dispose` reszta niczego nie robi. */
  dispose(): void;
}

/**
 * Odległość kamery (m) tak, żeby kadr mieścił `FRAME_HEIGHT_M` w pionie i `FRAME_WIDTH_M` w poziomie przy danym stosunku boków
 * kanwy: na szerokiej kanwie rządzi wysokość, na wąskiej (telefon w pionie) szerokość. Stosunek boków spoza (0, ∞) liczy się jak 1.
 */
export function cameraDistance(aspect: number): number {
  const a = Number.isFinite(aspect) && aspect > 0 ? Math.max(aspect, 0.05) : 1;
  const half = Math.tan(MathUtils.degToRad(FOV_DEG) / 2);
  return Math.max(FRAME_HEIGHT_M / 2 / half, FRAME_WIDTH_M / 2 / (half * a));
}

/** Renderer podglądu: przezroczyste tło (kanwę podkłada CSS), tone mapping jak w grze (Neutral), mała mapa cienia. */
function createWebglRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

const sameLook = (a: CashierLook, b: CashierLook): boolean => a.outfit === b.outfit && a.appearanceSeed === b.appearanceSeed;

/**
 * Podstawia pod każdą siatkę postaci własną kopię jej geometrii i oddaje te kopie (do zwolnienia razem z postacią). Fabryka dzieli
 * geometrię wariantu z grą i klientami, więc renderer podglądu nie może jej narysować (patrz nagłówek pliku). Kopia ma te same
 * atrybuty (położenie, normalne, wagi i kości skinu, region), indeks i kulę otaczającą; siatka skinowana (`SkinnedMesh`) zostaje
 * podpięta do tego samego szkieletu.
 */
function ownGeometries(object: Object3D): BufferGeometry[] {
  const owned: BufferGeometry[] = [];
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const copy = mesh.geometry.clone();
    mesh.geometry = copy;
    owned.push(copy);
  });
  return owned;
}

/**
 * Globalna tekstura DFG LUT three 0.186 (`getDFGLUT()` w `renderers/shaders/DFGLUTData.js`): jedna na stronę, w uniformie `dfgLUT`
 * każdego materiału fizycznego, który renderer narysował (nie ma jej w scenie). Zwraca ją albo null, gdy renderer niczego jeszcze
 * nie narysował. Trzeba ją wziąć, ZANIM materiały zostaną zwolnione: zwolnienie materiału kasuje jego właściwości w rendererze.
 */
function dfgLutOf(renderer: PreviewRenderer, scene: Object3D): Texture | null {
  let lut: Texture | null = null;
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (lut || !mesh.isMesh) return;
    for (const surface of [mesh.material].flat()) {
      const uniforms = (renderer.properties.get(surface) as { uniforms?: Record<string, { value?: unknown } | undefined> } | undefined)?.uniforms;
      const value = uniforms?.dfgLUT?.value;
      if (value instanceof Texture) {
        lut = value;
        return;
      }
    }
  });
  return lut;
}

export function createStartPreview(canvas: HTMLCanvasElement, factory: CharacterFactory, options: PreviewOptions = {}): StartPreview {
  const renderer = options.renderer ?? createWebglRenderer(canvas);

  const scene = new Scene();
  const day = LIGHT_PRESETS.day;
  // światło z przodu i z góry (inne niż słońce gry, które świeci zza sklepu): twarz i strój mają być czytelne z każdej strony podestu
  const hemi = new HemisphereLight(day.hemi.sky, day.hemi.ground, 1.15);
  const key = new DirectionalLight(day.sun.color, 2.1);
  key.position.set(-2.4, 4.4, 3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 1, far: 12 });
  scene.add(hemi, key, key.target);

  const turntable = new Group();
  turntable.name = 'turntable';
  scene.add(turntable);
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  for (const part of PEDESTAL) {
    const geometry = new CylinderGeometry(part.radius, part.radius, part.height, 48);
    geometries.push(geometry);
    const surface = material('plasticMatte', part.color).clone();   // własna kopia: materiał z pamięci stylu przeżywa podgląd, więc go nie zwalniamy
    materials.push(surface);
    const mesh = new Mesh(geometry, surface);
    mesh.name = 'pedestal';
    mesh.position.y = part.top - part.height / 2;
    mesh.receiveShadow = true;
    turntable.add(mesh);
  }

  const camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 40);
  const placeCamera = (aspect: number): void => {
    const distance = cameraDistance(aspect);
    const elevation = MathUtils.degToRad(ELEVATION_DEG);
    camera.aspect = aspect;
    camera.position.set(0, TARGET_Y_M + Math.sin(elevation) * distance, Math.cos(elevation) * distance);
    camera.lookAt(0, TARGET_Y_M, 0);
    camera.updateProjectionMatrix();
  };

  /** Kasjer na podeście: postać z fabryki i kopie geometrii, które podgląd narysował zamiast wspólnych (zwalnia je razem z postacią). */
  interface Standing { look: CashierLook; character: CharacterInstance; geometries: BufferGeometry[] }
  const release = ({ character, geometries: owned }: Standing): void => {
    releaseCharacter(character);
    for (const geometry of owned) geometry.dispose();
  };
  let current: Standing | null = null;
  let request = 0;
  let disposed = false;
  let raf = 0;
  let last: number | null = null;
  let width = 0;
  let height = 0;
  /** Do kiedy (czas klatki, ms) podest stoi: `Infinity` po `setYaw`, chwila po puszczeniu palca przy przeciąganiu. */
  let holdUntil = 0;
  let dragging = false;
  let dragX = 0;

  /** Dopasowuje renderer do rozmiaru kanwy z CSS; false, gdy kanwa nie ma jeszcze rozmiaru (nic do rysowania). */
  const fit = (): boolean => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!(w > 0 && h > 0)) return false;
    if (w !== width || h !== height) {
      width = w;
      height = h;
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO));
      renderer.setSize(w, h, false);
      placeCamera(w / h);
    }
    return true;
  };

  const frame = (now: number): void => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = last === null ? 0 : Math.min(MAX_DT_S, Math.max(0, (now - last) / 1000));
    last = now;
    if (!fit()) return;
    if (!dragging && now >= holdUntil) turntable.rotation.y += SPIN_RAD_S * dt;
    current?.character.update(dt);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  const onDown = (e: PointerEvent): void => {
    if (disposed) return;
    dragging = true;
    dragX = e.clientX;
    holdUntil = Infinity;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // wskaźnik już zniknął: przeciąganie i tak działa na kanwie
    }
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging || disposed) return;
    turntable.rotation.y += (e.clientX - dragX) * DRAG_RAD_PER_PX;
    dragX = e.clientX;
  };
  const onUp = (): void => {
    if (!dragging) return;
    dragging = false;
    holdUntil = performance.now() + RESUME_SPIN_AFTER_MS;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  async function show(look: CashierLook): Promise<void> {
    if (disposed) return;
    const wanted: CashierLook = { outfit: look.outfit, appearanceSeed: look.appearanceSeed };   // kopia: wołający może zmieniać swój obiekt
    const mine = ++request;                                  // nowsze show unieważnia wcześniejsze, także to w toku
    if (current && sameLook(current.look, wanted)) return;
    if (!isOutfitReady(factory, wanted.outfit)) {
      try {
        await factory.ensureOutfit(wanted.outfit);
      } catch {
        // fabryka nie odrzuca; gdyby, kasjer powstanie w stroju zastępczym (createCashierCharacter)
      }
      if (disposed || mine !== request) return;
    }
    let next: CharacterInstance | null = null;
    try {
      next = createCashierCharacter(factory, wanted);
      const standing: Standing = { look: wanted, character: next, geometries: ownGeometries(next.object) };
      turntable.add(next.object);
      if (current) release(current);
      current = standing;
    } catch (error) {
      if (next && current?.character !== next) releaseCharacter(next);   // nowa postać się nie ustawiła: nie zostaje po niej nic
      console.error('Nie udało się zbudować kasjera w podglądzie.', error);   // poprzedni kasjer zostaje
    }
  }

  return {
    show,
    setYaw(yaw) {
      if (disposed) return;
      turntable.rotation.y = yaw;
      holdUntil = Infinity;
    },
    get look() { return current ? { ...current.look } : null; },
    dispose() {
      if (disposed) return;
      disposed = true;                                       // wczytywanie w toku niczego już nie postawi (show sprawdza `disposed`)
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      const lut = dfgLutOf(renderer, scene);                 // zanim materiały odejdą razem z właściwościami, z których ją czytamy
      if (current) release(current);
      current = null;
      turntable.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const surface of materials) surface.dispose();
      key.dispose();
      hemi.dispose();
      lut?.dispose();                                        // zdejmuje z niej nasłuch tego renderera (żywe renderery zapiszą się znowu)
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
