import { Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cellToWorld } from '@/render/coords';
import { PALETTE, material } from '@/render/style';
import { roundedBoxGeometry } from '@/render/store/parts';
import type { Pallet } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import type { StoreLayout } from '@/sim/store/types';

const MAX = 48;
const LAYERS = 3;
const LAYER_H = 0.36;
const BASE_H = 0.14;
const CARDBOARD = ['#c9a46a', '#d1ad74', '#bf9a5f', '#d8b783'].map((c) => new Color(c));
/** Złota paleta (premia): kartony w folii w kolorze złota, jaśniejsze piętro na przemian. */
const GOLD = [new Color('#ffc93c'), new Color('#ffdb6e')];

/** Paleta: drewniana podstawa (deski i klocki) jako jedna geometria. */
function baseGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number): void => {
    const g = roundedBoxGeometry(w, h, d).clone();
    g.translate(x, y + h / 2, z);
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  for (const x of [-0.4, 0, 0.4]) for (const z of [-0.36, 0, 0.36]) add(0.12, 0.08, 0.12, x, 0, z);
  for (const x of [-0.4, 0, 0.4]) add(0.14, 0.025, 0.86, x, 0.08, 0);
  for (const z of [-0.38, -0.19, 0, 0.19, 0.38]) add(0.94, 0.025, 0.12, 0, 0.11, z);
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

/** Warstwa kartonów 2×2 owiniętych folią: jedna geometria, kolor z instancji. */
function layerGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const x of [-0.22, 0.22]) {
    for (const z of [-0.2, 0.2]) {
      const g = roundedBoxGeometry(0.42, LAYER_H - 0.02, 0.38).clone();
      g.translate(x, (LAYER_H - 0.02) / 2, z);
      parts.push(g.index ? g.toNonIndexed() : g);
    }
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

export interface PalletsView {
  root: Group;
  sync(pallets: readonly Pallet[], selected: number | null): void;
  /** Id palety trafionej promieniem (instancja → paleta) albo null. */
  palletAt(object: unknown, instanceId: number | undefined): number | null;
  /** Środek palety w świecie (do etykiet i efektów). */
  worldPosition(id: number): Vector3 | null;
  dispose(): void;
}

/**
 * Palety w scenie: instancje podstaw i warstw kartonów; wysokość stosu pokazuje, ile zostało do rozładunku,
 * a złota paleta ma złote kartony.
 */
export function createPalletsView(layout: StoreLayout, info: StoreInfo): PalletsView {
  const root = new Group();
  root.name = 'pallets';
  const baseGeo = baseGeometry();
  const layerGeo = layerGeometry();
  const bases = new InstancedMesh(baseGeo, material('wood', PALETTE.fixture.wood), MAX);
  const layers = new InstancedMesh(layerGeo, material('plasticMatte', '#ffffff'), MAX * LAYERS);
  bases.name = 'pallet bases';
  layers.name = 'pallet boxes';
  for (const m of [bases, layers]) { m.castShadow = true; m.receiveShadow = true; m.count = 0; m.frustumCulled = false; }
  for (let i = 0; i < MAX * LAYERS; i++) layers.setColorAt(i, CARDBOARD[i % CARDBOARD.length]!);
  const ring = new Mesh(new RingGeometry(0.62, 0.72, 32), new MeshBasicMaterial({ color: PALETTE.brand.orange, transparent: true, opacity: 0.9 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  root.add(bases, layers, ring);

  const baseOwner: number[] = [];
  const layerOwner: number[] = [];
  const centers = new Map<number, Vector3>();
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);

  const center = (p: Pallet): Vector3 | null => {
    const spot = info.spots[p.loc][p.spot];
    if (!spot) return null;
    const a = cellToWorld(layout, spot.x, spot.y);
    const b = cellToWorld(layout, spot.x + 1, spot.y + 1);
    return new Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  };

  return {
    root,
    sync(pallets, selected) {
      let nb = 0;
      let nl = 0;
      centers.clear();
      ring.visible = false;
      for (const p of pallets) {
        if (nb >= MAX) break;
        const c = center(p);
        if (!c) continue;
        centers.set(p.id, c);
        q.setFromAxisAngle(new Vector3(0, 1, 0), (p.id % 3) * 0.05 - 0.05);
        m.compose(c, q, one);
        bases.setMatrixAt(nb, m);
        baseOwner[nb++] = p.id;
        const fill = p.initial > 0 ? Math.max(0, Math.min(1, p.total / p.initial)) : 0;
        const full = fill * LAYERS;
        for (let k = 0; k < LAYERS && k < full; k++) {
          const h = Math.min(1, full - k);
          m.compose(new Vector3(c.x, BASE_H + k * LAYER_H, c.z), q, new Vector3(1, Math.max(0.15, h), 1));
          layers.setMatrixAt(nl, m);
          layers.setColorAt(nl, p.golden ? GOLD[k % 2]! : CARDBOARD[(p.id + k) % CARDBOARD.length]!);
          layerOwner[nl++] = p.id;
        }
        if (p.id === selected) { ring.visible = true; ring.position.set(c.x, 0.02, c.z); }
      }
      bases.count = nb;
      layers.count = nl;
      bases.instanceMatrix.needsUpdate = true;
      layers.instanceMatrix.needsUpdate = true;
      layers.instanceColor!.needsUpdate = true;
    },
    palletAt(object, instanceId) {
      if (instanceId === undefined) return null;
      if (object === bases) return baseOwner[instanceId] ?? null;
      if (object === layers) return layerOwner[instanceId] ?? null;
      return null;
    },
    worldPosition(id) {
      return centers.get(id)?.clone() ?? null;
    },
    dispose() {
      root.removeFromParent();
      baseGeo.dispose();
      layerGeo.dispose();
      bases.dispose();
      layers.dispose();
      ring.geometry.dispose();
      (ring.material as MeshBasicMaterial).dispose();
    },
  };
}
