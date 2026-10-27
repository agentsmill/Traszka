import { describe, expect, it, vi } from 'vitest';
import { CameraRig, ISO_PITCH_DEG, computeFrustum } from './cameraRig';

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
