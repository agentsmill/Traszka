import { Mesh, MathUtils, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ISO_PITCH_DEG, computeFrustum } from '@/render/cameraRig';
import type { QualityPresetId } from '@/render/quality';
import { createRenderContext, type RenderContext } from '@/render/renderer';
import { BEVEL, PALETTE, material } from '@/render/style';
import { ASSETS } from '@/render/assets';
import { createCharacterFactory, type CharacterFactory, type CharacterInstance } from './characterFactory';
import { outfitOfPath } from './modularPack';

/**
 * Strona podglądu postaci `?charTest=1` (ładowana dynamicznie z main.ts, nie wchodzi do głównego pakietu gry): 12 postaci
 * z paczki modular (stroje klientów), wszystkie w chodzie, kamera okrąża scenę. Parametry (do zrzutów): `set=special` (zamiast
 * klientów dziewięć strojów specjalnych kasjera, przez `createWithOutfit`), `set=regular` (po jednym z 12 strojów zwykłych,
 * też przez `createWithOutfit`) albo `set=all` (wszystkie 21 strojów, zwykłe i specjalne), `look=<seed>` (wszystkie postacie
 * z jednym wyglądem: te same proporcje, skóra i kolory, więc strój widać bez zakłóceń; bez `set` strój i tak losuje się
 * z seeda), `layout=ring` (domyślnie: postacie chodzą po okręgu) albo `layout=row` (jeden rząd, chód w miejscu, twarzą
 * do kamery; `turn` obraca o podane stopnie), `orbit`
 * (stopnie na sekundę, 0 zatrzymuje, domyślnie 12), `yaw` (początkowy kąt kamery), `zoom` (wysokość widoku w m), `close`
 * i `n` (numer postaci: kadr na jednej postaci, wymusza layout=row), `night=1`, `q` (preset jakości). Zoom i obrót są własne
 * (CameraRig ma obrót co 90° i zoom ≥ 6 m, a tu potrzebny jest kadr na jedną postać).
 * Klawisze: +/− zoom, spacja zatrzymuje obrót, W chód, I postoje, N dzień/noc, 1/2/3 preset jakości.
 */

const CUSTOMER_COUNT = 12;
const RING_RADIUS_M = 2.6;
const CAMERA_DISTANCE_M = 60;
/** Rząd: odstęp postaci (m). */
const ROW_STEP_M = 0.75;

interface Walker { index: number; character: CharacterInstance; theta: number }

export function startCharTestPage(canvas: HTMLCanvasElement, preset: QualityPresetId, params: URLSearchParams): void {
  let ctx: RenderContext;
  try {
    ctx = createRenderContext(canvas, preset);
  } catch (error) {
    console.error('Nie udało się uruchomić renderera.', error);
    return;
  }
  const set = params.get('set');
  /** Stroje do pokazania przez `createWithOutfit` (`set=special`, `set=regular` albo `set=all`); null: klienci przez `create`. */
  const outfits = set === 'special' ? ASSETS.characters.special.map(outfitOfPath)
    : set === 'regular' ? ASSETS.characters.modular.map(outfitOfPath)
    : set === 'all' ? [...ASSETS.characters.modular, ...ASSETS.characters.special].map(outfitOfPath) : null;
  const count = outfits ? outfits.length : CUSTOMER_COUNT;
  const look = params.get('look');
  const close = params.has('close');
  const row = params.get('layout') === 'row' || close;
  const orbitParam = params.get('orbit');
  let orbitDegPerS = orbitParam !== null ? Number(orbitParam) : close ? 0 : 12;
  let yawDeg = params.has('yaw') ? Number(params.get('yaw')) : 45;
  let night = params.get('night') === '1';

  /** Płyta o górnej powierzchni na wysokości `top` (płyty grup 1 cm nad podłożem, bez migotania). */
  const slab = (w: number, d: number, x: number, z: number, color: string, top: number): void => {
    const mesh = new Mesh(new RoundedBoxGeometry(w, 0.3, d, 3, BEVEL.medium), material('plasticMatte', color) as Material);
    mesh.position.set(x, top - 0.15, z);
    mesh.receiveShadow = true;
    ctx.scene.add(mesh);
  };
  slab(18, 11, 0, 0, PALETTE.floor[2], 0);
  if (row) slab((count - 1) * ROW_STEP_M + 1.4, 2.6, 0, 0, PALETTE.floor[1], 0.01);
  else slab(7, 7, 0, 0, PALETTE.floor[1], 0.01);
  ctx.rig.setBounds(-9, -5.5, 9, 5.5);
  ctx.setTimeOfDay(night ? 'night' : 'day');

  const label = document.createElement('div');
  label.textContent = set === 'special' ? 'Test postaci (stroje specjalne)' : set === 'regular' ? 'Test postaci (stroje zwykłe)'
    : set === 'all' ? 'Test postaci (wszystkie stroje)' : 'Test postaci (modular)';
  label.style.cssText = 'position:fixed;left:12px;top:10px;font:600 14px system-ui,sans-serif;color:#4b3f3a;text-shadow:0 1px 0 #fff3df;pointer-events:none';
  document.body.appendChild(label);

  const walkers: Walker[] = [];
  let factory: CharacterFactory | null = null;
  const target = { x: 0, y: 0.9, z: 0 };
  let viewSize = Number(params.get('zoom')) || (close ? 2.8 : 10.5);
  let turnRad = MathUtils.degToRad(Number(params.get('turn')) || 0);
  let running = true;
  let walking = true;

  const frame = (now: number, last: number): void => {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    yawDeg += orbitDegPerS * dt;
    for (const w of walkers) {
      w.character.update(dt);
      if (!row && walking) {
        const o = w.character.object;
        // prędkość stopy w klipie (m/s dla modelu bazowego) razy skala postaci: stopy nie ślizgają się po podłodze
        w.theta += ((factory?.walkSpeedMps ?? 0) * o.scale.y * dt) / RING_RADIUS_M;
        o.position.set(Math.cos(w.theta) * RING_RADIUS_M, 0, Math.sin(w.theta) * RING_RADIUS_M);
        o.rotation.y = Math.atan2(-Math.sin(w.theta), Math.cos(w.theta)); // styczna do okręgu (przeciwnie do ruchu wskazówek)
      }
    }
    // własny obrót kamery (CameraRig obraca tylko co 90°): ta sama izometria, dowolny kąt
    const yaw = MathUtils.degToRad(yawDeg), pitch = MathUtils.degToRad(ISO_PITCH_DEG);
    const horizontal = Math.cos(pitch) * CAMERA_DISTANCE_M;
    const cam = ctx.rig.camera;
    cam.position.set(target.x - Math.sin(yaw) * horizontal, target.y + Math.sin(pitch) * CAMERA_DISTANCE_M, target.z - Math.cos(yaw) * horizontal);
    cam.lookAt(target.x, target.y, target.z);
    cam.updateMatrixWorld();
    Object.assign(cam, computeFrustum(window.innerWidth / Math.max(1, window.innerHeight), viewSize));
    cam.updateProjectionMatrix();
    if (row) for (const w of walkers) w.character.object.rotation.y = yaw + Math.PI + turnRad; // twarzą do kamery
    ctx.render();
    requestAnimationFrame((n) => frame(n, now));
  };

  const zoomBy = (factor: number): void => { viewSize = MathUtils.clamp(viewSize / factor, 1.5, 30); };

  const setAll = (anim: 'idle' | 'walk'): void => {
    walking = anim === 'walk';
    for (const w of walkers) w.character.setAnim(anim);
  };

  const handle = {
    ctx, walkers,
    /** Kadr w locie (układ `row`): `focus` ustawia cel kamery na postaci `n`. */
    setView(opts: { yaw?: number; zoom?: number; orbit?: number; turn?: number; y?: number; focus?: { n: number } }): void {
      if (opts.yaw !== undefined) yawDeg = opts.yaw;
      if (opts.orbit !== undefined) orbitDegPerS = opts.orbit;
      if (opts.zoom !== undefined) viewSize = opts.zoom;
      if (opts.turn !== undefined) turnRad = MathUtils.degToRad(opts.turn);
      if (opts.y !== undefined) target.y = opts.y;
      const f = opts.focus && walkers.find((w) => w.index === opts.focus!.n);
      if (f) { target.x = f.character.object.position.x; target.z = f.character.object.position.z; }
    },
    /** Draw calls i trójkąty jednego pełnego `render()` (cień + postprocessing), jak w raportach zadań 8 i 12. */
    stats(): { calls: number; triangles: number } {
      const info = ctx.renderer.info;
      info.autoReset = false;
      info.reset();
      ctx.render();
      const out = { calls: info.render.calls, triangles: info.render.triangles };
      info.autoReset = true;
      return out;
    },
    dispose(): void {
      running = false;
      for (const w of walkers) w.character.dispose();
      factory?.dispose();
      label.remove();
    },
  };
  Object.assign(window, { traszkaChars: handle });

  window.addEventListener('keydown', (e) => {
    const keys: Record<string, () => void> = {
      '+': () => zoomBy(1.15), '=': () => zoomBy(1.15), '-': () => zoomBy(1 / 1.15),
      ' ': () => { orbitDegPerS = orbitDegPerS === 0 ? 12 : 0; },
      w: () => setAll('walk'), i: () => setAll('idle'),
      n: () => { night = !night; ctx.setTimeOfDay(night ? 'night' : 'day'); },
      '1': () => ctx.setPreset('niska'), '2': () => ctx.setPreset('srednia'), '3': () => ctx.setPreset('wysoka'),
    };
    keys[e.key]?.();
  });
  window.addEventListener('wheel', (e) => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1), { passive: true });

  void createCharacterFactory().then(async (created) => {
    factory = created;
    if (outfits) await Promise.all(outfits.map((outfit) => created.ensureOutfit(outfit)));   // stroje specjalne dochodzą na żądanie (R40)
    for (let index = 0; index < count; index++) {
      const character = outfits
        ? created.createWithOutfit(look ?? `kasjer-${index}`, outfits[index])
        : created.create(look ?? `postac-modular-${index}`);
      character.setAnim('walk', 0);
      ctx.scene.add(character.object);
      const w: Walker = { index, character, theta: (index / count) * Math.PI * 2 };
      if (row) character.object.position.set((index - (count - 1) / 2) * ROW_STEP_M, 0, 0);
      walkers.push(w);
    }
    if (close) handle.setView({ focus: { n: params.has('n') ? Number(params.get('n')) : 4 } });
    requestAnimationFrame((n) => frame(n, n));
  });
}
