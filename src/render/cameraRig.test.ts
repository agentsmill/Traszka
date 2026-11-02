import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { CELL_SIZE_M } from '@/sim/grid';
import { layoutFor } from '@/sim/store/layoutFor';
import { LOT_RANGES } from '@/sim/store/lots';
import type { LotSpec } from '@/sim/store/types';
import { CameraRig, ISO_PITCH_DEG, VIEW_SIZE_MAX, VIEW_SIZE_MIN, computeFrustum } from './cameraRig';
import { cellToWorld } from './coords';
import { WALL_H } from './store/shell';
import { storeOuter } from './street/buildings';

describe('computeFrustum', () => {
  it('viewSize to wysokość widoku w metrach, szerokość wynika z proporcji', () => {
    expect(computeFrustum(2, 10)).toEqual({ left: -10, right: 10, top: 5, bottom: -5 });
  });

  it('przy proporcjach 0,5 szerokość jest mniejsza od wysokości', () => {
    const f = computeFrustum(0.5, 10);
    expect(f.right - f.left).toBeLessThan(f.top - f.bottom);
    expect(f.right - f.left).toBeCloseTo(5, 9);
  });
});

describe('CameraRig', () => {
  it('startuje z yawIndex 0, viewSize 14 i izometrycznym nachyleniem', () => {
    const rig = new CameraRig(16 / 9);
    expect(rig.yawIndex).toBe(0);
    expect(rig.viewSize).toBe(14);
    const d = rig.camera.position.clone().sub(rig.target);
    const horizontal = Math.hypot(d.x, d.z);
    expect((Math.atan2(d.y, horizontal) * 180) / Math.PI).toBeCloseTo(ISO_PITCH_DEG, 6);
  });

  it('yawIndex 0 patrzy od strony ulicy: kamera leży w ćwiartce (−x, −z) względem celu', () => {
    const rig = new CameraRig(1);
    expect(rig.camera.position.x).toBeLessThan(rig.target.x);
    expect(rig.camera.position.z).toBeLessThan(rig.target.z);
  });

  it('yaw wynosi 45° + 90° · yawIndex: kamera leży na przekątnych poziomu', () => {
    const rig = new CameraRig(1);
    for (let i = 0; i < 4; i++) {
      const d = rig.camera.position.clone().sub(rig.target);
      expect(Math.abs(d.x)).toBeCloseTo(Math.abs(d.z), 6);
      rig.rotate(1);
    }
  });

  it('rotate(1) cztery razy wraca do yawIndex 0 i tej samej pozycji kamery', () => {
    const rig = new CameraRig(1.5);
    const start = rig.camera.position.clone();
    const seen = new Set<number>();
    for (let i = 0; i < 4; i++) {
      seen.add(rig.yawIndex);
      rig.rotate(1);
    }
    expect(seen.size).toBe(4);
    expect(rig.yawIndex).toBe(0);
    expect(rig.camera.position.distanceTo(start)).toBeLessThan(1e-6);
  });

  it('rotate(-1) z 0 daje 3, a rotate(1) po nim wraca do 0', () => {
    const rig = new CameraRig(1);
    rig.rotate(-1);
    expect(rig.yawIndex).toBe(3);
    rig.rotate(1);
    expect(rig.yawIndex).toBe(0);
  });

  it('kolejne obroty przesuwają kamerę o 90° wokół celu przy stałej odległości i wysokości', () => {
    const rig = new CameraRig(1);
    const a = rig.camera.position.clone().sub(rig.target);
    rig.rotate(1);
    const b = rig.camera.position.clone().sub(rig.target);
    expect(b.y).toBeCloseTo(a.y, 9);
    expect(Math.hypot(b.x, b.z)).toBeCloseTo(Math.hypot(a.x, a.z), 9);
    expect(a.x * b.x + a.z * b.z).toBeCloseTo(0, 6);
  });

  it('zoomBy(>1) przybliża, zoomBy(<1) oddala, a viewSize zostaje w [6, 30]', () => {
    const rig = new CameraRig(1);
    rig.zoomBy(2);
    expect(rig.viewSize).toBeCloseTo(7, 9);
    rig.zoomBy(0.5);
    expect(rig.viewSize).toBeCloseTo(14, 9);
    rig.zoomBy(1000);
    expect(rig.viewSize).toBe(6);
    rig.zoomBy(0.0001);
    expect(rig.viewSize).toBe(30);
  });

  it('setViewMax podnosi górną granicę zoomu (miasto na telefonie w pionie), a powrót do VIEW_SIZE_MAX skraca widok', () => {
    const rig = new CameraRig(0.46);
    expect(rig.viewMax).toBe(VIEW_SIZE_MAX);
    rig.setViewMax(70);
    expect(rig.viewMax).toBe(70);
    rig.zoomBy(0.0001);
    expect(rig.viewSize).toBe(70);
    expect(rig.camera.top).toBeCloseTo(35, 9);
    rig.setViewMax(VIEW_SIZE_MAX);   // widok większy od nowej granicy wraca do niej
    expect(rig.viewSize).toBe(VIEW_SIZE_MAX);
    expect(rig.camera.top).toBeCloseTo(15, 9);
    rig.zoomBy(0.0001);
    expect(rig.viewSize).toBe(VIEW_SIZE_MAX);
  });

  it('setViewMax powiadamia nasłuchujących tylko wtedy, gdy coś się zmieniło, i nie schodzi poniżej VIEW_SIZE_MIN', () => {
    const rig = new CameraRig(1);
    const cb = vi.fn();
    rig.onChange(cb);
    rig.setViewMax(VIEW_SIZE_MAX);
    expect(cb).not.toHaveBeenCalled();
    rig.setViewMax(50);
    expect(cb).toHaveBeenCalledTimes(1);
    rig.setViewMax(50);
    expect(cb).toHaveBeenCalledTimes(1);
    rig.setViewMax(1);
    expect(rig.viewMax).toBe(VIEW_SIZE_MIN);
    expect(rig.viewSize).toBe(VIEW_SIZE_MIN);
  });

  it('zoom i resize przestawiają frustum kamery', () => {
    const rig = new CameraRig(2);
    expect(rig.camera.top).toBeCloseTo(7, 9);
    expect(rig.camera.right).toBeCloseTo(14, 9);
    rig.zoomBy(14 / 10);
    expect(rig.camera.top).toBeCloseTo(5, 9);
    rig.resize(0.5);
    expect(rig.camera.right).toBeCloseTo(2.5, 9);
    expect(rig.camera.left).toBeCloseTo(-2.5, 9);
  });

  it('panBy przesuwa cel i kamerę razem, bez zmiany orientacji', () => {
    const rig = new CameraRig(1);
    const offset = rig.camera.position.clone().sub(rig.target);
    rig.panBy(3, -2);
    expect(rig.target.x).toBeCloseTo(3, 9);
    expect(rig.target.z).toBeCloseTo(-2, 9);
    expect(rig.camera.position.clone().sub(rig.target).distanceTo(offset)).toBeLessThan(1e-9);
  });

  it('setBounds ogranicza pan do granic z marginesem 4 m', () => {
    const rig = new CameraRig(1);
    rig.setBounds(-5, -7, 5, 7);
    rig.panBy(100, 100);
    expect(rig.target.x).toBeCloseTo(9, 9);
    expect(rig.target.z).toBeCloseTo(11, 9);
    rig.panBy(-100, -100);
    expect(rig.target.x).toBeCloseTo(-9, 9);
    expect(rig.target.z).toBeCloseTo(-11, 9);
  });

  it('setBounds przyciąga cel, który wypadł poza nowe granice', () => {
    const rig = new CameraRig(1);
    rig.panBy(50, 0);
    rig.setBounds(-2, -2, 2, 2);
    expect(rig.target.x).toBeCloseTo(6, 9);
  });

  it('clearBounds zdejmuje granice: bounds wraca do null, pan nie jest już ograniczony, a onChange dostaje powiadomienie', () => {
    const rig = new CameraRig(1);
    rig.setBounds(-2, -2, 2, 2);
    const cb = vi.fn();
    rig.onChange(cb);
    rig.clearBounds();
    expect(rig.bounds).toBeNull();
    expect(cb).toHaveBeenCalledTimes(1);
    rig.panBy(100, 100);
    expect(rig.target.x).toBeCloseTo(100, 9);
    expect(cb).toHaveBeenCalledTimes(2);
    rig.clearBounds();   // bez granic nie ma czego zdejmować: bez powiadomienia
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('onChange woła się przy obrocie, zoomie, panie i resize, ale nie przy braku zmiany', () => {
    const rig = new CameraRig(1);
    const cb = vi.fn();
    rig.onChange(cb);
    rig.rotate(1);
    rig.zoomBy(1.5);
    rig.panBy(1, 1);
    rig.resize(2);
    expect(cb).toHaveBeenCalledTimes(4);
    rig.zoomBy(1);
    rig.panBy(0, 0);
    rig.resize(2);
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it('onChange zwraca funkcję odpinającą', () => {
    const rig = new CameraRig(1);
    const cb = vi.fn();
    const off = rig.onChange(cb);
    off();
    rig.rotate(1);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('kadr największego sklepu po piątym remoncie', () => {
  /** Największy pawilon: wszystkie wymiary lokalu na górze zakresu, a remont 5 dokłada do szerokości 16 kratek (26 + 16 = 42). */
  const widest: LotSpec = {
    kind: 'pawilon', interiorWidth: LOT_RANGES.pawilon.interiorWidth[1], salesDepth: LOT_RANGES.pawilon.salesDepth[1],
    backroomDepth: LOT_RANGES.pawilon.backroomDepth[1], corner: false,
  };

  /** Kamera ustawiona tak jak przy wczytaniu sklepu w `game/scene.ts` (granice z wymiarów układu, cel w środku sali i zaplecza). */
  function frame(aspect: number): { rig: CameraRig; layout: ReturnType<typeof layoutFor> } {
    const layout = layoutFor('kadr-l5', 5, widest);
    const rig = new CameraRig(aspect);
    const lo = cellToWorld(layout, 0, 0);
    const hi = cellToWorld(layout, layout.width - 1, layout.depth - 1);
    rig.setBounds(lo.x - CELL_SIZE_M / 2, lo.z - CELL_SIZE_M / 2, hi.x + CELL_SIZE_M / 2, hi.z + CELL_SIZE_M / 2);
    rig.panBy(-rig.target.x, cellToWorld(layout, 0, (5 + layout.depth) / 2).z - rig.target.z);
    return { rig, layout };
  }

  it('największy pawilon po remoncie 5 ma 26 + 16 kratek szerokości wnętrza, a granice widoku zawierają cały jego obrys', () => {
    const { rig, layout } = frame(16 / 9);
    expect(layout.lot.interiorWidth).toBe(LOT_RANGES.pawilon.interiorWidth[1] + 16);
    const o = storeOuter(layout);
    const b = rig.bounds!;
    expect([b.minX <= o.x0, b.maxX >= o.x1, b.minZ <= o.z0, b.maxZ >= o.z1], 'obrys w granicach').toEqual([true, true, true, true]);
    // pan sięga każdego rogu obrysu (z marginesem 4 m): cel da się ustawić nad każdym rogiem sklepu
    for (const [x, z] of [[o.x0, o.z0], [o.x1, o.z0], [o.x0, o.z1], [o.x1, o.z1]] as const) {
      rig.panBy(x - rig.target.x, z - rig.target.z);
      expect([rig.target.x, rig.target.z]).toEqual([x, z]);
    }
  });

  it('po maksymalnym oddaleniu cały obrys sklepu (podłoga i górna krawędź ścian) mieści się w kadrze 16:9 i 4:3', () => {
    for (const aspect of [16 / 9, 4 / 3]) {
      for (const yaw of [0, 1, 2, 3] as const) {
        const { rig, layout } = frame(aspect);
        rig.yawIndex = yaw;
        rig.zoomBy(1 / VIEW_SIZE_MAX);   // do granicy oddalenia
        expect(rig.viewSize).toBe(VIEW_SIZE_MAX);
        rig.camera.updateMatrixWorld(true);
        const o = storeOuter(layout);
        for (const [x, z] of [[o.x0, o.z0], [o.x1, o.z0], [o.x0, o.z1], [o.x1, o.z1]] as const) {
          for (const y of [0, WALL_H]) {
            const p = new Vector3(x, y, z).project(rig.camera);
            const label = `${aspect.toFixed(2)} yaw ${yaw} róg (${x.toFixed(1)}, ${y}, ${z.toFixed(1)})`;
            expect(Math.abs(p.x), `${label} x`).toBeLessThanOrEqual(1);
            expect(Math.abs(p.y), `${label} y`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});
