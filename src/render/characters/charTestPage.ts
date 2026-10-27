import { Mesh, MathUtils, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ISO_PITCH_DEG, computeFrustum } from '@/render/cameraRig';
import type { QualityPresetId } from '@/render/quality';
import { createRenderContext, type RenderContext } from '@/render/renderer';
import { BEVEL, PALETTE, material } from '@/render/style';
import { createCharacterFactory, type CharacterInstance, type CharacterPack } from './characterFactory';

/**
 * Strona porównawcza `?charTest=1`: 10 postaci z paczki ubc (jasna płyta) i 10 z modular (ciemna płyta), wszystkie w chodzie,
 * kamera okrąża scenę. Parametry (do zrzutów): `layout=ring` (domyślnie: każda grupa chodzi po okręgu) albo `layout=row`
 * (dwa rzędy, chód w miejscu, twarzą do kamery; `turn` obraca o podane stopnie), `orbit` (stopnie na sekundę, 0 zatrzymuje,
 * domyślnie 12), `yaw` (początkowy kąt kamery), `zoom` (wysokość widoku w m), `close=ubc|modular` i `n` (numer postaci w rzędzie:
 * kadr na jednej postaci, wymusza layout=row), `night=1`, `q` (preset jakości). Zoom i obrót są własne (CameraRig ma
 * obrót co 90° i zoom ≥ 6 m, a tu potrzebny jest kadr na jedną postać).
 * Klawisze: +/− zoom, spacja zatrzymuje obrót, W chód, I postoje, N dzień/noc, 1/2/3 preset jakości.
 */

const PER_PACK = 10;
const RING_RADIUS_M = 2.6;
/** Prędkość stopy podporowej w klipach chodu (m/s dla modelu bazowego; po skali postaci mnożona przez jej wzrost/bazę), żeby stopy nie ślizgały się po podłodze. */
const WALK_SPEED_MPS: Record<CharacterPack, number> = { ubc: 0.95, modular: 1.15 };
const CAMERA_DISTANCE_M = 60;
const PACKS: readonly CharacterPack[] = ['ubc', 'modular'];
/** Środek płyty pierścienia (oś x) i rzędu (oś z). */
const SLAB_X: Record<CharacterPack, number> = { ubc: -3.6, modular: 3.6 };
const ROW_Z: Record<CharacterPack, number> = { ubc: -1.4, modular: 1.4 };
const ROW_STEP_M = 0.75;

interface Walker { pack: CharacterPack; index: number; character: CharacterInstance; theta: number }

export function startCharTestPage(canvas: HTMLCanvasElement, preset: QualityPresetId, params: URLSearchParams): void {
  let ctx: RenderContext;
  try {
    ctx = createRenderContext(canvas, preset);
  } catch (error) {
    console.error('Nie udało się uruchomić renderera.', error);
    return;
  }
  const close = PACKS.find((p) => p === params.get('close')) ?? null;
  const row = params.get('layout') === 'row' || close !== null;
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
  for (const pack of PACKS) {
    const color = pack === 'ubc' ? PALETTE.floor[0] : PALETTE.floor[1];
    if (row) slab(8.2, 2.6, 0, ROW_Z[pack], color, 0.01);
    else slab(7, 7, SLAB_X[pack], 0, color, 0.01);
  }
  ctx.rig.setBounds(-9, -5.5, 9, 5.5);
  ctx.setTimeOfDay(night ? 'night' : 'day');

  const label = document.createElement('div');
  label.textContent = 'Test postaci: jasna płyta UBC, ciemna płyta Modular';
  label.style.cssText = 'position:fixed;left:12px;top:10px;font:600 14px system-ui,sans-serif;color:#4b3f3a;text-shadow:0 1px 0 #fff3df;pointer-events:none';
  document.body.appendChild(label);

  const walkers: Walker[] = [];
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
        w.theta += (WALK_SPEED_MPS[w.pack] * o.scale.y * dt) / RING_RADIUS_M;
        o.position.set(SLAB_X[w.pack] + Math.cos(w.theta) * RING_RADIUS_M, 0, Math.sin(w.theta) * RING_RADIUS_M);
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
    /** Kadr w locie (układ `row`): `focus` ustawia cel kamery na postaci `n` z paczki `pack`. */
    setView(opts: { yaw?: number; zoom?: number; orbit?: number; turn?: number; y?: number; focus?: { pack: CharacterPack; n: number } }): void {
      if (opts.yaw !== undefined) yawDeg = opts.yaw;
      if (opts.orbit !== undefined) orbitDegPerS = opts.orbit;
      if (opts.zoom !== undefined) viewSize = opts.zoom;
      if (opts.turn !== undefined) turnRad = MathUtils.degToRad(opts.turn);
      if (opts.y !== undefined) target.y = opts.y;
      const f = opts.focus && walkers.find((w) => w.pack === opts.focus!.pack && w.index === opts.focus!.n);
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

  void Promise.all(PACKS.map((pack) => createCharacterFactory(pack))).then(([ubc, modular]) => {
    const factories = { ubc, modular };
    for (const pack of PACKS) {
      for (let index = 0; index < PER_PACK; index++) {
        const character = factories[pack].create(`postac-${pack}-${index}`);
        character.setAnim('walk', 0);
        ctx.scene.add(character.object);
        const w: Walker = { pack, index, character, theta: (index / PER_PACK) * Math.PI * 2 };
        if (row) character.object.position.set((index - (PER_PACK - 1) / 2) * ROW_STEP_M, 0, ROW_Z[pack]);
        walkers.push(w);
      }
    }
    if (close) handle.setView({ focus: { pack: close, n: params.has('n') ? Number(params.get('n')) : 4 } });
    requestAnimationFrame((n) => frame(n, n));
  });
}
