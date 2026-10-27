import {
  CapsuleGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, SphereGeometry,
  type BufferGeometry, type MeshStandardMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, material } from '@/render/style';
import type { Appearance } from './appearance';
import type { CharacterInstance } from './characterFactory';

/**
 * Wspólne podstawy rysowania postaci (materiał z paletą regionów) i postać zastępcza, gdy modele się nie wczytały.
 *
 * Siatka postaci ma atrybut `region` (liczba zmiennoprzecinkowa): indeks koloru w palecie postaci. Wartość między
 * całkowitymi (np. 2,5 na granicy skóry i góry) shader tnie progiem w połowie między sąsiednimi indeksami, z antyaliasingiem
 * po `fwidth`, więc granica dwóch regionów (rękaw, pas, tęczówka) to ostra, gładka linia, a nie gradient po dużych
 * trójkątach. Kolory leżą w uniformie materiału, a nie w geometrii: geometria wariantu jest wspólna dla wszystkich
 * postaci, a wygląd to tylko paleta (jeden program shadera, materiał na postać).
 */
export const REGION = { eyeDark: 0, eyeWhite: 1, skin: 2, top: 3, bottom: 4, shoes: 5, hair: 6, brow: 7, accent: 8, accent2: 9 } as const;
/** Pierwszy indeks stałych kolorów części stroju (kask, kamizelka itp.). */
export const FIXED_BASE = 10;
export const PALETTE_SIZE = 24;

/** Paleta postaci z `Appearance` (indeksy z REGION; akcenty uzupełnia wołający). Kolory z PALETTE, liniowe jak `new Color(hex)`. */
export function characterPalette(a: Appearance, shoes: string = PALETTE.wall[4]): Color[] {
  const hair = new Color(a.hair);
  return [
    new Color(PALETTE.hair[0]), new Color(PALETTE.wall[0]), new Color(a.skin), new Color(a.top), new Color(a.bottom),
    new Color(shoes), hair, hair.clone().lerp(new Color(PALETTE.hair[0]), 0.4), new Color(a.top), new Color(a.bottom),
  ];
}

/**
 * Szorstkość tkaniny (`fabric` z docs/style-guide.md §3) dla regionów od włosów w górę i ubrań: skóra i oczy zostają
 * `plasticMatte` (lekki połysk, „zabawkowa” skóra jak w Two Point), reszta jest matowa jak materiał. Zadanie 16.
 */
const FABRIC_ROUGHNESS = 0.95;

/**
 * Materiał jednej postaci: `MeshStandardMaterial` (rodzaj plasticMatte) z kolorem z palety po `region`; regiony ubrań,
 * włosów i akcesoriów dostają szorstkość tkaniny (FABRIC_ROUGHNESS), więc jedna postać to nadal jeden materiał i jeden
 * draw call. Programy shadera są wspólne (ten sam `customProgramCacheKey`), każda postać ma własny materiał z własną
 * paletą. Zwalnia go `dispose()` postaci.
 */
export function createCharacterMaterial(palette: Color[]): MeshStandardMaterial {
  const colors = palette.slice(0, PALETTE_SIZE);
  while (colors.length < PALETTE_SIZE) colors.push(colors[0]);
  const m = (material('plasticMatte', '#ffffff') as MeshStandardMaterial).clone();
  m.name = 'character';
  m.customProgramCacheKey = () => 'traszka-character-v3';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPalette = { value: colors };
    shader.vertexShader = shader.vertexShader
      .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float region;\nvarying float vRegion;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvRegion = region;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', `#include <color_pars_fragment>\nuniform vec3 uPalette[${PALETTE_SIZE}];\nvarying float vRegion;`)
      .replace('#include <color_fragment>', `float regionFloor = floor(vRegion);
float regionCut = max(fwidth(vRegion), 1e-4);
int regionIndex = int(regionFloor);
diffuseColor.rgb *= mix(uPalette[regionIndex], uPalette[min(regionIndex + 1, ${PALETTE_SIZE - 1})],
  smoothstep(0.5 - regionCut, 0.5 + regionCut, vRegion - regionFloor));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, ${FABRIC_ROUGHNESS.toFixed(2)}, step(${REGION.skin + 0.5}, vRegion));`);
  };
  return m;
}

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
