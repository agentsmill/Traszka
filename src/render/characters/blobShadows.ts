import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, type Texture } from 'three';
import { cachedTexture, canvasTexture } from '@/render/store/parts';
import { PALETTE } from '@/render/style';

/**
 * Miękkie plamy cienia pod postaciami: jedna `InstancedMesh` (1 draw call) dla całego tłumu, zamiast cienia z mapy
 * cieni na każdą postać (+1 draw call i ~2,9 tys. trójkątów na postać w przebiegu cienia). Polityka cieni postaci
 * (zadanie 16, docs/style-guide.md §5): plama zawsze, prawdziwy cień z mapy tylko na presecie `wysoka`.
 *
 * Plama leży tuż nad najwyższą nakładką podłogi (mata 3 cm), w kolorze `wall[4]` (ciepły brąz, nie czerń), bez zapisu
 * głębi, więc nie zasłania niczego poza podeszwami.
 */
export const BLOB_Y = 0.034;
/** Promień plamy (m) dla postaci o mnożniku szerokości 1. */
export const BLOB_RADIUS = 0.4;
const BLOB_OPACITY = 0.62;

function blobTexture(): Texture {
  return cachedTexture('blobShadow', () => canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }));
}

export interface BlobShadows {
  readonly mesh: InstancedMesh;
  readonly capacity: number;
  /** Plama nr `i` pod punktem (x, z) świata, o promieniach `rx` i `rz` (m). Indeksy ≥ capacity są pomijane. */
  set(i: number, x: number, z: number, rx: number, rz: number): void;
  /** Liczba plam do narysowania (pierwsze `count` ustawionych). */
  commit(count: number): void;
  dispose(): void;
}

export function createBlobShadows(capacity = 96): BlobShadows {
  const geometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    name: 'blobShadow', map: blobTexture(), color: new Color(PALETTE.wall[4]), transparent: true, opacity: BLOB_OPACITY,
    depthWrite: false,
  });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = 'blob-shadows';
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;   // instancje rozrzucone po całym sklepie; bryła brzegowa geometrii ich nie obejmuje
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 1;
  const m = new Matrix4();
  return {
    mesh,
    capacity,
    set(i, x, z, rx, rz) {
      if (i < 0 || i >= capacity) return;
      m.makeScale(rx, 1, rz).setPosition(x, BLOB_Y, z);
      mesh.setMatrixAt(i, m);
    },
    commit(count) {
      mesh.count = Math.max(0, Math.min(capacity, count));
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      mesh.removeFromParent();
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
