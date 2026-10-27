import { Mesh, type BufferGeometry, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createRenderContext, type RenderContext } from '@/render/renderer';
import { QUALITY, detectDeviceCaps, pickInitialPreset, type QualityPresetId } from '@/render/quality';
import { BEVEL, PALETTE, material } from '@/render/style';
import { cellToWorld } from '@/render/coords';
import { buildStore } from '@/render/store/buildStore';
import { fillShelves } from '@/render/store/products';
import { buildStreet, type StreetView } from '@/render/street/buildStreet';
import { generateStore } from '@/sim/store/generateStore';
import { CELL_SIZE_M } from '@/sim/grid';

/**
 * Sterowanie wspólne dla scen próbnych: Q/E obrót, +/− zoom, strzałki pan, kółko myszy, 1/2/3 preset jakości.
 * `extra` dokłada klawisze sceny (np. N dzień/noc).
 */
function bindControls(ctx: RenderContext, extra: Record<string, () => void> = {}): void {
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
    '1': () => ctx.setPreset('niska'),
    '2': () => ctx.setPreset('srednia'),
    '3': () => ctx.setPreset('wysoka'),
    ...extra,
  };
  window.addEventListener('keydown', (e) => keys[e.key]?.());
  window.addEventListener('wheel', (e) => ctx.rig.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1), { passive: true });
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
  bindControls(ctx, { n: () => ctx.setTimeOfDay((night = !night) ? 'night' : 'day') });

  startRenderLoop(ctx);
  Object.assign(window, { traszkaTest: ctx });
}

/**
 * Podgląd sklepu `?seed=<seed>`: generateStore → buildStore → buildStreet. Sterowanie jak w scenie próbnej plus N dzień/noc,
 * X widok z zewnątrz (pełne ściany, szyld i pełna zabudowa ulicy); przekrój (cutaway) podąża za obrotem kamery.
 * Parametry do zrzutów: `yaw` (0–3), `night=1`, `ext=1`, `zoom` (wysokość widoku w m), `q` (preset jakości).
 */
function startStoreScene(canvas: HTMLCanvasElement, seed: string, preset: QualityPresetId, params: URLSearchParams): void {
  let ctx: RenderContext;
  try {
    ctx = createRenderContext(canvas, preset);
  } catch (error) {
    console.error('Nie udało się uruchomić renderera.', error);
    return;
  }
  const layout = generateStore(seed);
  const view = buildStore(layout);
  const goods = fillShelves(view, seed);
  view.root.add(goods); // view.dispose() zwalnia też bufory instancji towaru
  ctx.scene.add(view.root);

  // ulica dochodzi asynchronicznie (modele GLB); przed jej gotowością sklep jest już widoczny
  let street: StreetView | null = null;
  let disposed = false;

  const lo = cellToWorld(layout, 0, 0);
  const hi = cellToWorld(layout, layout.width - 1, layout.depth - 1);
  ctx.rig.setBounds(lo.x - CELL_SIZE_M / 2, lo.z - CELL_SIZE_M / 2, hi.x + CELL_SIZE_M / 2, hi.z + CELL_SIZE_M / 2);
  // start: środek sali sprzedaży i zaplecza (bez chodnika)
  ctx.rig.panBy(0, cellToWorld(layout, 0, (5 + layout.depth) / 2).z);
  const zoom = Number(params.get('zoom'));
  if (zoom > 0) ctx.rig.zoomBy(14 / zoom);
  const yaw = Number(params.get('yaw'));
  if (yaw >= 1 && yaw <= 3) ctx.rig.yawIndex = yaw as 1 | 2 | 3;

  let night = params.get('night') === '1';
  let exterior = params.get('ext') === '1';
  view.setCutaway(ctx.rig.yawIndex);
  view.setExteriorMode(exterior);
  view.setTimeOfDay(night ? 'night' : 'day');
  ctx.setTimeOfDay(night ? 'night' : 'day');
  ctx.rig.onChange(() => view.setCutaway(ctx.rig.yawIndex));

  bindControls(ctx, {
    n: () => {
      night = !night;
      ctx.setTimeOfDay(night ? 'night' : 'day');
      view.setTimeOfDay(night ? 'night' : 'day');
      street?.setTimeOfDay(night ? 'night' : 'day');
    },
    x: () => {
      view.setExteriorMode((exterior = !exterior));
      street?.setBuildingCutaway(!exterior);
    },
  });
  startRenderLoop(ctx);
  // zmiana seeda: zwolnić ulicę razem ze sklepem
  const dispose = (): void => {
    disposed = true;
    street?.dispose();
    view.dispose();
  };
  const handle = { ctx, view, layout, goods, street: null as StreetView | null, dispose };
  Object.assign(window, { traszkaStore: handle });
  void buildStreet(layout, seed).then((built) => {
    if (disposed) { built.dispose(); return; }
    street = handle.street = built;
    built.setBuildingCutaway(!exterior);
    built.setTimeOfDay(night ? 'night' : 'day');
    ctx.scene.add(built.root);
  }).catch((error: unknown) => console.error('Nie udało się zbudować ulicy.', error));
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene') as HTMLCanvasElement;

if (params.get('scene') === 'test') {
  const q = params.get('q');
  startTestScene(canvas, q && q in QUALITY ? (q as QualityPresetId) : pickInitialPreset(detectDeviceCaps()));
} else if (params.get('seed')) {
  const q = params.get('q');
  startStoreScene(canvas, params.get('seed')!, q && q in QUALITY ? (q as QualityPresetId) : pickInitialPreset(detectDeviceCaps()), params);
} else {
  console.log('Traszka Tycoon');
}
