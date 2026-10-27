import { Mesh, type BufferGeometry, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createRenderContext, type RenderContext } from '@/render/renderer';
import { QUALITY, detectDeviceCaps, pickInitialPreset, type QualityPresetId } from '@/render/quality';
import { BEVEL, PALETTE, material } from '@/render/style';

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
    n: () => ctx.setTimeOfDay((night = !night) ? 'night' : 'day'),
    '1': () => ctx.setPreset('niska'),
    '2': () => ctx.setPreset('srednia'),
    '3': () => ctx.setPreset('wysoka'),
  };
  let night = false;
  window.addEventListener('keydown', (e) => keys[e.key]?.());
  window.addEventListener('wheel', (e) => ctx.rig.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1), { passive: true });

  const loop = (): void => {
    ctx.render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  Object.assign(window, { traszkaTest: ctx });
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene') as HTMLCanvasElement;

if (params.get('scene') === 'test') {
  const q = params.get('q');
  startTestScene(canvas, q && q in QUALITY ? (q as QualityPresetId) : pickInitialPreset(detectDeviceCaps()));
} else {
  console.log('Traszka Tycoon');
}
