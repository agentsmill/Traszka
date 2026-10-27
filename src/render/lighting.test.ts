import { Box3, DirectionalLight, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { LIGHT_PRESETS } from './style';
import { fitShadowCamera, sunDirection } from './lighting';

describe('sunDirection', () => {
  it('zgadza się z konwencją z style.ts: (cos e · cos a, sin e, cos e · sin a)', () => {
    const { azimuthDeg, elevationDeg } = LIGHT_PRESETS.day.sun;
    const d = sunDirection(azimuthDeg, elevationDeg);
    const a = (azimuthDeg * Math.PI) / 180;
    const e = (elevationDeg * Math.PI) / 180;
    expect(d.length()).toBeCloseTo(1, 9);
    expect(d.x).toBeCloseTo(Math.cos(e) * Math.cos(a), 9);
    expect(d.y).toBeCloseTo(Math.sin(e), 9);
    expect(d.z).toBeCloseTo(Math.cos(e) * Math.sin(a), 9);
  });

  it('dzień świeci od strony ulicy (−z), czyli cienie padają w głąb sklepu', () => {
    const { azimuthDeg, elevationDeg } = LIGHT_PRESETS.day.sun;
    expect(sunDirection(azimuthDeg, elevationDeg).z).toBeLessThan(0);
  });
});

describe('fitShadowCamera', () => {
  const box = new Box3(new Vector3(-4.5, 0, -7), new Vector3(4.5, 4, 7));

  function project(light: DirectionalLight, p: Vector3): Vector3 {
    const cam = light.shadow.camera;
    return p.clone().applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
  }

  it.each(['day', 'night'] as const)('wszystkie narożniki bryły sklepu mieszczą się w kamerze cienia (%s)', (time) => {
    const { azimuthDeg, elevationDeg } = LIGHT_PRESETS[time].sun;
    const light = new DirectionalLight();
    fitShadowCamera(light, box, sunDirection(azimuthDeg, elevationDeg));
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    light.shadow.updateMatrices(light);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const n = project(light, new Vector3(x, y, z));
      for (const c of [n.x, n.y, n.z]) {
        expect(c).toBeGreaterThanOrEqual(-1);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('światło stoi po stronie słońca, a cel w środku bryły', () => {
    const light = new DirectionalLight();
    const dir = sunDirection(250, 52);
    fitShadowCamera(light, box, dir);
    const center = box.getCenter(new Vector3());
    expect(light.target.position.distanceTo(center)).toBeLessThan(1e-9);
    expect(light.position.clone().sub(center).normalize().distanceTo(dir)).toBeLessThan(1e-9);
  });

  it('kamera cienia nie jest dużo większa niż bryła (nie marnuje rozdzielczości mapy)', () => {
    const light = new DirectionalLight();
    fitShadowCamera(light, box, sunDirection(250, 52));
    const cam = light.shadow.camera;
    const diag = box.getSize(new Vector3()).length();
    expect(cam.right - cam.left).toBeLessThan(diag * 1.6);
    expect(cam.top - cam.bottom).toBeLessThan(diag * 1.6);
  });
});
