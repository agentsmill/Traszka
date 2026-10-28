import {
  AnimationMixer, Color, Group, Matrix4, Skeleton, SkinnedMesh,
  type AnimationAction, type Object3D,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadGLB } from '@/render/assets';
import { PALETTE } from '@/render/style';
import { createRng, subSeed } from '@/sim/rng';
import { disposeVariantGeometries, variantGeometry } from './accessories';
import { pickAppearance, type Appearance } from './appearance';
import { REGION, characterPalette, createCharacterMaterial } from './characterMaterial';
import { createFallbackCharacter } from './fallbackCharacter';
import { applyProportions, bonesByName, buildModularPack, outfitBody, type ModularPack, type OutfitFile, type Variant } from './modularPack';
import { WALK_SPEED_MPS } from './walkSpeed';

export interface CharacterInstance {
  object: Object3D;
  /** Strój, z którego zbudowano postać (nazwa pliku bez rozszerzenia); null dla postaci zastępczej. */
  readonly outfit: OutfitFile | null;
  setAnim(name: 'idle' | 'walk', fadeS?: number): void;
  update(dt: number): void;
  dispose(): void;
  readonly isFallback: boolean;
}

export interface CharacterFactory {
  /** Klient: wygląd i strój zwykły (nigdy specjalny) z seeda. */
  create(appearanceSeed: string): CharacterInstance;
  /**
   * Kasjer gracza: wygląd (skóra, włosy, ubranie, wzrost, szerokość) z seeda jak w `create`, ale w wybranym stroju, zwykłym albo
   * specjalnym (`OutfitFile`). Ten sam seed daje tę samą twarz i kolory w każdym stroju. Kasjer nie nosi akcesoriów klientów
   * (plecak, torba, telefon): zasłaniałyby strój, a męski strój Adventurer ma własny plecak. Gdy plik stroju się nie wczytał, kasjer
   * dostaje strój zwykły tej samej płci (z ostrzeżeniem, jednym na strój), a gdy nie wczytało się nic, postać zastępczą.
   */
  createWithOutfit(appearanceSeed: string, outfit: OutfitFile): CharacterInstance;
  /**
   * Prędkość stopy podporowej w klipie chodu, m/s dla modelu bazowego (postać skalowana w poziomie o `s` ma na podłodze
   * `walkSpeedMps · s`). Jedyne źródło tej liczby: tłum (CrowdView) dobiera po niej tempo klipu do prędkości agenta.
   */
  readonly walkSpeedMps: number;
  /**
   * Zwalnia geometrie współdzielone przez postacie tej fabryki (cache wariantów i akcesoriów). Postacie zwalnia ich własne
   * `dispose()` (materiał, szkielet); po `dispose` fabryki `create` nadal działa i buduje geometrię od nowa.
   */
  dispose(): void;
}

/**
 * Postacie z paczki `modular` (Quaternius, CC0; modularPack.ts), każda jako JEDEN SkinnedMesh: 1 draw call w głównym
 * przebiegu i 1 w cieniu na postać, bez względu na liczbę części (strój, włosy, oczy, brwi, akcesorium). Geometria wariantu
 * jest wspólna dla wszystkich postaci; wygląd to paleta w materiale postaci (characterMaterial.ts), a akcesoria
 * (accessories.ts) są scalone z siatką. Postać ma własne kości (klon szablonu szkieletu), własny materiał i mixer z klipami
 * `Idle` i `Walk`.
 */

const SHOES = [PALETTE.wall[4], PALETTE.fixture.fridgeFrame, PALETTE.clothes[12], PALETTE.clothes[9]];

function assemble(variant: Variant, a: Appearance, seed: string): CharacterInstance {
  const rng = createRng(subSeed(seed, 'character'));
  const animRng = createRng(subSeed(seed, 'anim'));
  const { rig } = variant;

  // szkielet postaci: własne kości (klon szablonu), wspólne macierze odwrotne
  const root = new Group();
  root.name = 'character';
  const armature = cloneSkinned(rig.template);
  const byName = bonesByName(armature);
  applyProportions(byName);
  const skeleton = new Skeleton(rig.boneNames.map((n) => byName.get(n) as never), rig.boneInverses);

  // paleta (wygląd) i materiał; akcenty zależą od akcesorium
  const palette = characterPalette(a, rng.pick(SHOES));
  if (a.accessory === 'backpack') {
    palette[REGION.accent] = new Color(rng.pick(PALETTE.clothes.filter((c) => c !== a.top && c !== a.bottom)));
    palette[REGION.accent2] = palette[REGION.accent].clone().lerp(new Color(PALETTE.wall[4]), 0.25);
  } else if (a.accessory === 'bag') {
    palette[REGION.accent] = new Color(PALETTE.brand.orange);
    palette[REGION.accent2] = new Color(PALETTE.brand.cream);
  } else if (a.accessory === 'phone') {
    palette[REGION.accent] = new Color(PALETTE.fixture.fridgeFrame);
  }
  palette.push(...variant.shared.fixed);
  const material = createCharacterMaterial(palette);
  material.userData.palette = palette;

  const geometry = variantGeometry(variant, a.accessory, rng.chance(0.5) ? 'l' : 'r');
  const mesh = new SkinnedMesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  // Wierzchołki geometrii są już w przestrzeni świata pozy bind (MeshAccumulator.add zastosował macierz bind każdej
  // siatki źródłowej), więc macierz bind nowej siatki to tożsamość.
  mesh.bind(skeleton, new Matrix4());
  mesh.boundingSphere = geometry.boundingSphere!.clone();
  armature.add(mesh);
  armature.position.y = -variant.minY;
  const s = a.height / variant.height;
  root.scale.set(s * a.width, s, s * a.width);
  root.add(armature);

  // animacje: idle i walk na jednym mixerze
  const mixer = new AnimationMixer(armature);
  const actions: Record<'idle' | 'walk', AnimationAction> = {
    idle: mixer.clipAction(variant.idle), walk: mixer.clipAction(variant.walk),
  };
  let current: 'idle' | 'walk' = 'idle';
  actions.idle.play().time = animRng.next() * variant.idle.duration;
  mixer.update(0);

  return {
    object: root,
    outfit: variant.outfit,
    isFallback: false,
    setAnim(name, fadeS = 0.25) {
      if (name === current) return;
      const from = actions[current], to = actions[name];
      current = name;
      to.reset().play().time = animRng.next() * to.getClip().duration;
      if (fadeS > 0) from.crossFadeTo(to, fadeS, false);
      else from.stop();
    },
    update(dt) { mixer.update(dt); },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(armature);
      skeleton.dispose();
      material.dispose(); // geometria jest wspólna wariantu (zwalnia ją dispose fabryki), więc zostaje
      root.removeFromParent();
    },
  };
}

/**
 * Fabryka postaci. Wczytuje (i buduje warianty) z góry, więc `create` jest synchroniczne i tanie.
 * Gdy modele się nie wczytają (404, uszkodzone pliki), zwraca fabrykę postaci zastępczych (kapsuła + kula) i nie rzuca;
 * pojedyncze brakujące pliki (jeden strój) są pomijane z ostrzeżeniem.
 */
export async function createCharacterFactory(load: typeof loadGLB = loadGLB): Promise<CharacterFactory> {
  let pack: ModularPack | null = null;
  try {
    pack = await buildModularPack(load);
  } catch (error) {
    console.warn('Postacie: nie udało się zbudować modeli.', error);
  }
  const fallback = (seed: string): CharacterInstance => createFallbackCharacter(pickAppearance(seed));
  if (!pack) {
    console.warn('Postacie: używam postaci zastępczych.');
    return { create: fallback, createWithOutfit: fallback, walkSpeedMps: WALK_SPEED_MPS, dispose() {} };
  }
  const loaded = pack;
  // Kasjer powstaje od nowa przy każdej zmianie wyglądu, więc brak pliku stroju ostrzega raz na strój, nie przy każdym wywołaniu.
  const warnedMissing = new Set<OutfitFile>();
  return {
    walkSpeedMps: WALK_SPEED_MPS,
    create(seed) {
      try {
        const a = pickAppearance(seed);
        return assemble(loaded.variantFor(a, createRng(subSeed(seed, 'outfit'))), a, seed);
      } catch (error) {
        console.warn('Postacie: nie udało się zbudować postaci, używam zastępczej.', error);
        return fallback(seed);
      }
    },
    createWithOutfit(seed, outfit) {
      try {
        const a: Appearance = { ...pickAppearance(seed), accessory: 'none' };
        let variant = loaded.variantOf(outfit);
        if (!variant) {
          if (!warnedMissing.has(outfit)) {
            warnedMissing.add(outfit);
            console.warn(`Postacie: brak stroju ${outfit}, używam stroju zwykłego tej samej płci.`);
          }
          variant = loaded.variantFor({ ...a, body: outfitBody(outfit) }, createRng(subSeed(seed, 'outfit')));
        }
        return assemble(variant, a, seed);
      } catch (error) {
        console.warn('Postacie: nie udało się zbudować postaci, używam zastępczej.', error);
        return fallback(seed);
      }
    },
    dispose() {
      for (const variant of loaded.variants) disposeVariantGeometries(variant);
    },
  };
}
