import {
  CapsuleGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, SphereGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Appearance } from './appearance';
import type { CharacterInstance } from './characterFactory';
import { REGION, characterPalette, createCharacterMaterial } from './characterMaterial';

// Postać zastępcza, gdy modele się nie wczytały. Materiał i paleta regionów są wspólne z modelami (characterMaterial.ts).

/** Ustawia jeden region na całej geometrii. */
function regionOf(geometry: BufferGeometry, region: number): BufferGeometry {
  const n = geometry.getAttribute('position').count;
  geometry.setAttribute('region', new Float32BufferAttribute(new Float32Array(n).fill(region), 1));
  return geometry;
}

const STEP_HZ = 1.45;
const SWAY_RAD = 0.07;
const BOB_M = 0.03;

/**
 * Postać zastępcza: dół (walec), góra (kapsuła), głowa (kula) i czapa włosów w kolorach z `Appearance`, jako jedna siatka
 * (1 draw call). W chodzie kiwa się na boki i podskakuje. Wzrost = `appearance.height`, szerokość = `appearance.width`.
 */
export function createFallbackCharacter(a: Appearance): CharacterInstance {
  const h = a.height;
  const headR = 0.13 * h;
  const legsTop = 0.45 * h;
  const torsoTop = h - 2 * headR + 0.03;
  const torsoR = 0.17;

  const parts = [
    regionOf(new CylinderGeometry(0.13, 0.12, legsTop, 12).translate(0, legsTop / 2, 0), REGION.bottom),
    regionOf(new CapsuleGeometry(torsoR, Math.max(0.05, torsoTop - legsTop - 2 * torsoR), 4, 12)
      .translate(0, (legsTop + torsoTop) / 2, 0), REGION.top),
    regionOf(new SphereGeometry(headR, 16, 12).translate(0, h - headR, 0), REGION.skin),
    regionOf(new SphereGeometry(headR * 1.05, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, h - headR + 0.01, 0), REGION.hair),
  ];
  const geometry = mergeGeometries(parts)!;
  for (const g of parts) g.dispose();

  const mat = createCharacterMaterial(characterPalette(a));
  const body = new Mesh(geometry, mat);
  body.castShadow = body.receiveShadow = true;
  const object = new Group();
  object.name = 'character-fallback';
  object.add(body);
  object.scale.set(a.width, 1, a.width);

  let time = 0;
  let walking = 0;     // waga chodu 0..1 (miękkie przejście)
  let target = 0;
  let rate = 1 / 0.2;  // jednostki wagi na sekundę
  return {
    object,
    outfit: null,
    isFallback: true,
    setAnim(name, fadeS = 0.2) {
      target = name === 'walk' ? 1 : 0;
      rate = 1 / Math.max(fadeS, 1e-6);
    },
    update(dt) {
      time += dt;
      walking += Math.sign(target - walking) * Math.min(Math.abs(target - walking), rate * dt);
      if (walking === 0) {
        body.rotation.z = 0;
        body.position.y = 0;
        return;
      }
      const phase = time * Math.PI * 2 * STEP_HZ;
      body.rotation.z = Math.sin(phase) * SWAY_RAD * walking;
      body.position.y = Math.abs(Math.sin(phase)) * BOB_M * walking;
    },
    dispose() {
      object.removeFromParent();
      geometry.dispose();
      mat.dispose();
    },
  };
}
