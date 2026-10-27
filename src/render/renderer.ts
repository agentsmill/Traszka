import { NeutralToneMapping, PCFShadowMap, PMREMGenerator, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CameraRig } from './cameraRig';
import { createLighting, type TimeOfDay } from './lighting';
import { createPostPipeline, type PostPipeline } from './post';
import { QUALITY, resolveStartPreset, type QualityPresetId } from './quality';
import { LIGHT_PRESETS } from './style';

/** Zdarzenie na `window` z komunikatem dla gracza: `CustomEvent<{ text: string }>`. */
export const NOTICE_EVENT = 'traszka:notice';
export const NOTICE_REDUCED_GRAPHICS = 'Twoja przeglądarka nie obsługuje pełnej grafiki. Włączyliśmy tryb oszczędny.';
export const NOTICE_NO_WEBGL2 = 'Twoja przeglądarka nie obsługuje WebGL 2, więc gra nie może się uruchomić. Spróbuj aktualnej wersji Chrome, Edge, Firefox lub Safari.';

export interface RenderContext {
  renderer: WebGLRenderer;
  scene: Scene;
  rig: CameraRig;
  /** Aktualny preset. Może się różnić od zamówionego, gdy sprzęt nie wspiera AO (wtedy jest to 'niska'). */
  readonly preset: QualityPresetId;
  setPreset(id: QualityPresetId): void;
  setTimeOfDay(t: TimeOfDay): void;
  render(): void;
  dispose(): void;
}

// Bez MSAA na kanwie: antyaliasing robi SMAA w postprocessingu, a AO i tak nie współpracuje z MSAA.
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = { antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' };

/** Komunikat idzie po zakończeniu bieżącego zadania, żeby UI utworzone zaraz po `createRenderContext` zdążyło się podpiąć. */
function notify(text: string): void {
  if (typeof window === 'undefined') return;
  setTimeout(() => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: { text } })), 0);
}

/**
 * Tworzy renderer, scenę, kamerę izometryczną, światło i postprocessing na podanej kanwie (pełne okno).
 *
 * Awaria sprzętu nie przerywa gry, o ile da się jeszcze rysować. Gdy `getContext('webgl2')` z naszymi atrybutami zwróci
 * null (ale three.js zdoła utworzyć kontekst sam), gdy nie da się utworzyć pipeline'u postprocessingu (wtedy rysujemy
 * bezpośrednio) albo gdy zawiedzie AO, przechodzimy na preset 'niska' i wysyłamy `traszka:notice`. Brak WebGL 2 w ogóle
 * wysyła `traszka:notice` z `NOTICE_NO_WEBGL2` i dopiero potem rzuca wyjątek: three.js 0.186 nie ma ścieżki WebGL 1.
 */
export function createRenderContext(canvas: HTMLCanvasElement, preset: QualityPresetId): RenderContext {
  const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
  // Bez naszego kontekstu three.js szuka własnego, więc zamawiamy najbezpieczniejszy preset, bez AO i postprocessingu.
  const requested: QualityPresetId = gl ? preset : 'niska';

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, context: gl ?? undefined, ...CONTEXT_ATTRIBUTES });
  } catch (cause) {
    notify(NOTICE_NO_WEBGL2);
    throw new Error('Nie udało się uruchomić WebGL 2. Ta przeglądarka nie obsłuży gry.', { cause });
  }
  renderer.outputColorSpace = SRGBColorSpace;
  // Neutral, nie AgX: AgX szarzy ciepłą paletę (docs/style-guide.md). W ścieżce z postprocessingiem to samo robi
  // ToneMappingEffect, bo three nie mapuje tonalnie przy rysowaniu do bufora.
  renderer.toneMapping = NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const rig = new CameraRig(window.innerWidth / window.innerHeight);

  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  room.dispose();
  pmrem.dispose();

  let post: PostPipeline | null = null;
  try {
    post = createPostPipeline(renderer, scene, rig.camera, QUALITY[requested]);
  } catch (error) {
    console.warn('Postprocessing niedostępny, rysuję bezpośrednio.', error);
  }
  const start = resolveStartPreset(requested, { context: gl !== null, post: post !== null, ao: post?.aoAvailable ?? false });
  let current = start.preset;
  // Pipeline powstał dla zamówionego presetu; gdy zeszliśmy niżej (brak AO), zdejmujemy jego AO i ostrzejsze efekty.
  if (post && current !== requested) post.setPreset(QUALITY[current]);
  // Mapa cienia zależy od presetu, więc światło tworzymy dopiero, gdy preset startowy jest ostateczny.
  const lighting = createLighting(scene, QUALITY[current].shadowMapSize);

  function resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[current].maxPixelRatio));
    if (post) post.setSize(w, h);
    else renderer.setSize(w, h);
    rig.resize(w / h);
  }

  // Granice pana kamery są też granicami sklepu, które obejmuje kamera cienia.
  let fittedBounds = '';
  const offRig = rig.onChange(() => {
    const b = rig.bounds;
    const key = b ? `${b.minX},${b.minZ},${b.maxX},${b.maxZ}` : '';
    if (b && key !== fittedBounds) {
      fittedBounds = key;
      lighting.fitShadows(b.minX, b.minZ, b.maxX, b.maxZ);
    }
  });

  function setTimeOfDay(t: TimeOfDay): void {
    const p = LIGHT_PRESETS[t];
    lighting.setTimeOfDay(t);
    renderer.toneMappingExposure = p.exposure;
    post?.setBloomStrength(p.bloomStrength);
  }

  function setPreset(id: QualityPresetId): void {
    let next = post ? id : 'niska'; // bez postprocessingu zostaje tylko tryb oszczędny
    if (post) {
      post.setPreset(QUALITY[next]);
      if (QUALITY[next].ao !== 'off' && !post.aoAvailable) {
        post.setPreset(QUALITY.niska);
        next = 'niska';
        notify(NOTICE_REDUCED_GRAPHICS);
      }
    }
    current = next;
    lighting.setShadowMapSize(QUALITY[current].shadowMapSize);
    resize();
  }

  // Zmiana devicePixelRatio (przeniesienie okna na inny ekran, zoom przeglądarki) nie wywołuje `resize` okna.
  let dprQuery: MediaQueryList | null = null;
  const onPixelRatioChange = (): void => {
    resize();
    watchPixelRatio();
  };
  function watchPixelRatio(): void {
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onPixelRatioChange, { once: true });
  }
  window.addEventListener('resize', resize);
  watchPixelRatio();

  setTimeOfDay('day');
  resize();
  if (start.reduced) notify(NOTICE_REDUCED_GRAPHICS);

  return {
    renderer,
    scene,
    rig,
    get preset() { return current; },
    setPreset,
    setTimeOfDay,
    render() {
      if (post) post.render();
      else renderer.render(scene, rig.camera);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      dprQuery?.removeEventListener('change', onPixelRatioChange);
      offRig();
      post?.dispose();
      lighting.dispose();
      envTarget.dispose();
      renderer.dispose();
    },
  };
}
