import { Box3, Color, DirectionalLight, HemisphereLight, MathUtils, Scene, Sphere, Vector3 } from 'three';
import { LIGHT_PRESETS } from './style';

export type TimeOfDay = 'day' | 'night';

/** Wysokość (m) bryły, którą ma obejmować kamera cienia: strop sklepu 3,2 m plus szyld i zapas. */
export const SHADOW_BOX_HEIGHT_M = 4;
const SHADOW_PAD_M = 0.5;
/** Bryła obejmowana przez cień, dopóki nikt nie poda granic sklepu (`fitShadows`). */
const DEFAULT_SHADOW_BOX = new Box3(new Vector3(-10, 0, -10), new Vector3(10, SHADOW_BOX_HEIGHT_M, 10));

/** Wersor skierowany do słońca, wg konwencji z `LIGHT_PRESETS` (style.ts). */
export function sunDirection(azimuthDeg: number, elevationDeg: number): Vector3 {
  const a = MathUtils.degToRad(azimuthDeg);
  const e = MathUtils.degToRad(elevationDeg);
  return new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
}

/**
 * Ustawia światło kierunkowe i jego kamerę cienia tak, żeby ortograficzny frustum ściśle obejmował `box`
 * (w osiach światła), bez względu na kierunek słońca. `towardSun` to wersor do słońca.
 */
export function fitShadowCamera(light: DirectionalLight, box: Box3, towardSun: Vector3): void {
  const center = box.getCenter(new Vector3());
  const radius = box.getBoundingSphere(new Sphere()).radius;
  light.target.position.copy(center);
  light.position.copy(center).addScaledVector(towardSun, radius + SHADOW_PAD_M);
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();

  const cam = light.shadow.camera;
  cam.position.copy(light.position);
  cam.lookAt(light.target.position);
  cam.updateMatrixWorld(true);

  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  const p = new Vector3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    p.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
    lo.min(p);
    hi.max(p);
  }
  cam.left = lo.x - SHADOW_PAD_M;
  cam.right = hi.x + SHADOW_PAD_M;
  cam.bottom = lo.y - SHADOW_PAD_M;
  cam.top = hi.y + SHADOW_PAD_M;
  cam.near = Math.max(0.01, -hi.z - SHADOW_PAD_M);
  cam.far = -lo.z + SHADOW_PAD_M;
  cam.updateProjectionMatrix();
}

export interface Lighting {
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  /** Kolory, natężenia i kierunek słońca/księżyca, półkula, tło sceny i natężenie otoczenia z `LIGHT_PRESETS`. */
  setTimeOfDay(t: TimeOfDay): void;
  /** Dopasowuje kamerę cienia do granic świata (w metrach), np. bryły sklepu. */
  fitShadows(minX: number, minZ: number, maxX: number, maxZ: number): void;
  setShadowMapSize(size: number): void;
  dispose(): void;
}

/** Światło globalne: słońce z cieniem, półkula. Oświetlenie wnętrza sklepu dokłada `buildStore`, nie ten moduł. */
export function createLighting(scene: Scene, shadowMapSize: number): Lighting {
  const sun = new DirectionalLight();
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const hemi = new HemisphereLight();
  scene.add(sun, sun.target, hemi);

  let time: TimeOfDay = 'day';
  const box = DEFAULT_SHADOW_BOX.clone();

  const refit = (): void => {
    const { azimuthDeg, elevationDeg } = LIGHT_PRESETS[time].sun;
    fitShadowCamera(sun, box, sunDirection(azimuthDeg, elevationDeg));
  };

  const lighting: Lighting = {
    sun,
    hemi,
    setTimeOfDay(t) {
      time = t;
      const p = LIGHT_PRESETS[t];
      sun.color.set(p.sun.color);
      sun.intensity = p.sun.intensity;
      hemi.color.set(p.hemi.sky);
      hemi.groundColor.set(p.hemi.ground);
      hemi.intensity = p.hemi.intensity;
      scene.environmentIntensity = p.envIntensity;
      scene.background = new Color(p.hemi.sky);
      refit();
    },
    fitShadows(minX, minZ, maxX, maxZ) {
      box.min.set(minX, 0, minZ);
      box.max.set(maxX, SHADOW_BOX_HEIGHT_M, maxZ);
      refit();
    },
    setShadowMapSize(size) {
      if (sun.shadow.mapSize.x === size) return;
      sun.shadow.mapSize.set(size, size);
      // Zwolnienie starej mapy; three zaalokuje nową o właściwym rozmiarze przy następnym renderze.
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    },
    dispose() {
      scene.remove(sun, sun.target, hemi);
      sun.dispose();
      hemi.dispose();
    },
  };
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  lighting.setTimeOfDay('day');
  return lighting;
}
