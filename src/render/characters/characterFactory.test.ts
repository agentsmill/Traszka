import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationClip, Box3, Color, Mesh, ShaderLib, SkinnedMesh, type Bone, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ASSETS } from '@/render/assets';
import { CHARACTER_STYLE } from '@/render/style';
import { pickAppearance } from './appearance';
import { CHARACTER_PROGRAM_KEY, REGION } from './characterMaterial';
import { createCharacterFactory, type CharacterFactory } from './characterFactory';
import { OUTFIT_PAINT, findClip, outfitPart, type OutfitFile } from './modularPack';
import { WALK_SPEED_MPS } from './walkSpeed';

/**
 * Loader testowy: czyta prawdziwe GLB z public/, usuwa tekstury (Node nie ma obrazów) i parsuje GLTFLoaderem,
 * więc fabryka dostaje te same siatki, szkielety i klipy co w przeglądarce.
 */
const io = new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const cache = new Map<string, Promise<GLTF>>();
function loadFromDisk(url: string): Promise<GLTF> {
  let hit = cache.get(url);
  if (!hit) {
    hit = (async () => {
      const bytes = readFileSync(join('public', url));
      const doc = await io.readBinary(new Uint8Array(bytes));
      for (const t of doc.getRoot().listTextures()) t.dispose();
      for (const ext of doc.getRoot().listExtensionsUsed()) ext.dispose();
      const out = await io.writeBinary(doc);
      const buffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
      return new GLTFLoader().parseAsync(buffer, '');
    })();
    cache.set(url, hit);
  }
  return hit;
}

function skinnedMeshes(root: Object3D): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  root.traverse((o) => { if (o instanceof SkinnedMesh) out.push(o); });
  return out;
}
function materialOf(mesh: SkinnedMesh): Material {
  if (Array.isArray(mesh.material)) throw new Error('postać ma mieć jeden materiał');
  return mesh.material;
}
function meshCount(root: Object3D): number {
  let n = 0;
  root.traverse((o) => { if (o instanceof Mesh) n++; });
  return n;
}
/** Wartość uniformu `uPalette`, który materiał ustawia przy kompilacji (na kopii shadera `standard` z three). */
function paletteUniform(material: Material): Color[] {
  const shader = { uniforms: {} as Record<string, { value: Color[] }>, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  (material as MeshStandardMaterial).onBeforeCompile(shader as never, undefined as never);
  return shader.uniforms.uPalette.value;
}
function bone(root: Object3D, pattern: RegExp): Bone {
  let found: Bone | undefined;
  root.traverse((o) => { if (!found && (o as Bone).isBone && pattern.test(o.name)) found = o as Bone; });
  if (!found) throw new Error(`brak kości ${pattern}`);
  return found;
}

describe('createCharacterFactory: postać zastępcza', () => {
  it('gdy wczytanie assetów zawiedzie, zwraca fabrykę postaci zastępczych i nie rzuca', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const factory = await createCharacterFactory(() => Promise.reject(new Error('404')));
    const c = factory.create('x');
    expect(c.isFallback).toBe(true);
    expect(c.object.children.length).toBeGreaterThan(0);
    c.setAnim('walk');
    c.update(0.1);
    c.setAnim('idle', 0);
    c.update(0.1);
    c.dispose();
    expect(factory.walkSpeedMps).toBe(WALK_SPEED_MPS);
    expect(() => factory.dispose()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('postać zastępcza ma kolory z Appearance, wzrost z Appearance i kiwa się w chodzie', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const factory = await createCharacterFactory(() => Promise.reject(new Error('404')));
    const a = pickAppearance('seed-a');
    const c = factory.create('seed-a');
    const box = new Box3().setFromObject(c.object);
    expect(box.max.y - box.min.y).toBeCloseTo(a.height, 1);
    expect(meshCount(c.object)).toBe(1);
    c.setAnim('walk');
    const before = c.object.children[0].rotation.z;
    c.update(0.2);
    expect(c.object.children[0].rotation.z).not.toBe(before);
    c.setAnim('idle', 0);
    c.update(0.2);
    expect(c.object.children[0].rotation.z).toBe(0);
    vi.restoreAllMocks();
  });
});

describe('createCharacterFactory na prawdziwych assetach', () => {
  let factory: CharacterFactory;
  beforeAll(async () => {
    factory = await createCharacterFactory(loadFromDisk);
  }, 60_000);

  it('prędkość stopy w klipie chodu pochodzi z fabryki (jedno źródło dla tłumu)', () => {
    expect(factory.walkSpeedMps).toBe(WALK_SPEED_MPS);
  });

  it('buduje prawdziwą postać (nie zastępczą) z jednym SkinnedMesh i jednym materiałem', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const c = factory.create(seed);
      expect(c.isFallback).toBe(false);
      const skinned = skinnedMeshes(c.object);
      expect(skinned).toHaveLength(1);
      expect(meshCount(c.object)).toBe(1); // 1 draw call w głównym przebiegu (+1 w cieniu), także z akcesorium
      expect(Array.isArray(skinned[0].material)).toBe(false);
      expect(skinned[0].geometry.getAttribute('region')).toBeDefined();
      c.dispose();
    }
  });

  it('każdy wierzchołek ma region mieszczący się w palecie, a skóra i włosy występują w siatce', () => {
    const c = factory.create('regiony');
    const mesh = skinnedMeshes(c.object)[0];
    const regions = mesh.geometry.getAttribute('region').array as Float32Array;
    expect(Math.min(...regions)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...regions)).toBeLessThanOrEqual(23);
    const used = new Set(Array.from(regions, Math.round));
    expect(used.has(REGION.skin)).toBe(true);
    c.dispose();
  });

  it('wzrost postaci (z głową i włosami) odpowiada Appearance', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const a = pickAppearance(seed);
      const c = factory.create(seed);
      const mesh = skinnedMeshes(c.object)[0];
      c.object.updateMatrixWorld(true);
      const box = new Box3().setFromObject(mesh, true);
      expect(box.max.y - box.min.y).toBeCloseTo(a.height, 1);
      expect(box.min.y).toBeCloseTo(0, 1);
      c.dispose();
    }
  });

  it('skaluje głowę o headScale, a dłonie o handScale (animacja ich nie nadpisuje)', () => {
    const c = factory.create('proporcje');
    c.setAnim('walk');
    c.update(0.4);
    const rig = skinnedMeshes(c.object)[0].skeleton;
    const head = rig.bones.find((b) => /^head$/i.test(b.name))!;
    const hands = rig.bones.filter((b) => /^(hand|wrist)_?[lr]$/i.test(b.name));
    expect(head.scale.x).toBeCloseTo(CHARACTER_STYLE.headScale, 5);
    expect(hands).toHaveLength(2);
    for (const h of hands) expect(h.scale.x).toBeCloseTo(CHARACTER_STYLE.handScale, 5);
    c.dispose();
  });

  it('tułów rośnie o torsoScale, a barki i szyja wracają do 1 (ręce i głowa nie rosną razem z tułowiem)', () => {
    const c = factory.create('tulow');
    c.setAnim('walk');
    c.update(0.3);
    const bones = skinnedMeshes(c.object)[0].skeleton.bones;
    /** Skala kości względem modelu bazowego: iloczyn skal lokalnych kości od niej do korzenia szkieletu. */
    const absolute = (re: RegExp): number => {
      let k = 1;
      for (let o: Object3D | null = bones.find((b) => re.test(b.name))!; o && (o as Bone).isBone; o = o.parent) k *= o.scale.x;
      return k;
    };
    // Szkielet stroju MA mieć kość chest: bez niej test by nic nie sprawdzał.
    expect(bones.some((b) => /^chest$/i.test(b.name)), 'kość chest w szkielecie').toBe(true);
    for (const re of [/^hips$/i, /^abdomen$/i, /^torso$/i, /^chest$/i]) expect(absolute(re), String(re)).toBeCloseTo(CHARACTER_STYLE.torsoScale, 5);
    for (const re of [/^neck$/i, /^shoulderl$/i, /^shoulderr$/i]) expect(absolute(re), String(re)).toBeCloseTo(1, 5);
    expect(absolute(/^head$/i)).toBeCloseTo(CHARACTER_STYLE.headScale, 5);
    expect(absolute(/^wristl$/i)).toBeCloseTo(CHARACTER_STYLE.handScale, 5);
    c.dispose();
  });

  it('wygląd jest deterministyczny i zależy od seeda (paleta materiału: skóra, włosy, góra, dół)', () => {
    const palette = (seed: string): number[] => {
      const c = factory.create(seed);
      const colors = (materialOf(skinnedMeshes(c.object)[0]).userData.palette as Color[]).slice(REGION.skin, REGION.brow);
      c.dispose();
      return colors.flatMap((col) => col.toArray());
    };
    expect(palette('ten sam')).toEqual(palette('ten sam'));
    expect(palette('ten sam')).not.toEqual(palette('inny'));
    const a = pickAppearance('ten sam');
    const [skin, top, bottom] = palette('ten sam').reduce<number[][]>((acc, _, i, all) => (i % 3 === 0 ? [...acc, all.slice(i, i + 3)] : acc), []);
    expect(skin).toEqual(new Color(a.skin).toArray());
    expect(top).toEqual(new Color(a.top).toArray());
    expect(bottom).toEqual(new Color(a.bottom).toArray());
  });

  it('chód porusza kośćmi nóg', () => {
    const c = factory.create('chodzi');
    c.setAnim('idle', 0);
    c.update(0.01);
    const thigh = bone(c.object, /^(thigh_l|upperleg_?l)$/i);
    const idleQ = thigh.quaternion.clone();
    c.setAnim('walk', 0);
    c.update(0.35);
    expect(thigh.quaternion.angleTo(idleQ)).toBeGreaterThan(0.1);
    c.dispose();
  });

  it('płynne przejście: w trakcie fade pozy są skończone, po nim działa nowa animacja, powrót do idle też', () => {
    const c = factory.create('fade');
    const thigh = bone(c.object, /^(thigh_l|upperleg_?l)$/i);
    c.setAnim('walk', 0.3);
    for (let i = 0; i < 10; i++) {
      c.update(0.05);
      expect(thigh.quaternion.toArray().every(Number.isFinite)).toBe(true);
    }
    c.setAnim('idle', 0);
    c.update(0.01);
    const idleQ = thigh.quaternion.clone();
    c.update(0.3);
    expect(thigh.quaternion.angleTo(idleQ)).toBeLessThan(0.15); // idle prawie nie rusza udem
    c.dispose();
  });

  it('dispose zwalnia materiał i odpina postać od sceny, a geometria wariantu zostaje dla innych postaci', () => {
    const a = factory.create('zwolnij');
    const b = factory.create('zwolnij');
    const geoA = skinnedMeshes(a.object)[0].geometry;
    expect(skinnedMeshes(b.object)[0].geometry).toBe(geoA); // ten sam seed: ten sam wariant i akcesorium
    const geoDisposed = vi.fn();
    geoA.addEventListener('dispose', geoDisposed);
    const material = materialOf(skinnedMeshes(a.object)[0]);
    const matDisposed = vi.fn();
    material.addEventListener('dispose', matDisposed);
    a.dispose();
    expect(matDisposed).toHaveBeenCalledTimes(1);
    expect(geoDisposed).not.toHaveBeenCalled();
    expect(a.object.parent).toBeNull();
    b.dispose();
  });

  it('każda postać ma własny materiał i własną paletę (uniform), ale dwie postacie dzielą program shadera', () => {
    const [a, b] = ['seed-a', 'seed-b'].map((s) => factory.create(s));
    const [ma, mb] = [a, b].map((c) => materialOf(skinnedMeshes(c.object)[0]));
    expect(ma).not.toBe(mb);
    expect(ma.customProgramCacheKey()).toBe(mb.customProgramCacheKey());
    expect(ma.customProgramCacheKey()).toBe(CHARACTER_PROGRAM_KEY);   // własny klucz programu, nie domyślny
    const [pa, pb] = [paletteUniform(ma), paletteUniform(mb)];
    expect(pa).toHaveLength(24);
    expect(pb).toHaveLength(24);
    expect(pa.map((c) => c.getHex())).not.toEqual(pb.map((c) => c.getHex()));
    a.dispose();
    b.dispose();
  });

  it('akcesorium widać w siatce: regiony 8/9 są tylko u postaci z plecakiem, torbą albo telefonem', () => {
    const kinds = new Set<string>();
    for (let i = 0; i < 80; i++) {
      const seed = `akcesorium-${i}`;
      const { accessory } = pickAppearance(seed);
      kinds.add(accessory);
      const c = factory.create(seed);
      const regions = skinnedMeshes(c.object)[0].geometry.getAttribute('region').array as Float32Array;
      const hasAccent = regions.some((r) => r === REGION.accent || r === REGION.accent2);
      expect(hasAccent, `${seed}: ${accessory}`).toBe(accessory !== 'none');
      c.dispose();
    }
    expect(kinds).toEqual(new Set(['none', 'backpack', 'bag', 'phone']));
  });

  it('dispose fabryki zwalnia współdzieloną geometrię i opróżnia cache, a create nadal działa', async () => {
    const own = await createCharacterFactory(loadFromDisk);   // własna fabryka: nie ruszamy geometrii pozostałych testów
    const seeds = ['dispose-a', 'dispose-b', 'dispose-c', 'dispose-d'];
    const chars = seeds.map((s) => own.create(s));
    const geometries = new Set(chars.map((c) => skinnedMeshes(c.object)[0].geometry));
    const freed = vi.fn();
    for (const g of geometries) g.addEventListener('dispose', freed);
    for (const c of chars) c.dispose();
    expect(freed).not.toHaveBeenCalled();          // postać zwalnia tylko swoje (materiał, szkielet)
    own.dispose();
    expect(freed).toHaveBeenCalledTimes(geometries.size);
    const again = own.create(seeds[0]);
    expect(again.isFallback).toBe(false);
    expect(geometries.has(skinnedMeshes(again.object)[0].geometry)).toBe(false); // zbudowana od nowa
    again.dispose();
  }, 60_000);
});

describe('paczka modular: stroje, klipy, tabela OUTFIT_PAINT', () => {
  const files = ASSETS.characters.modular.map((url) => basename(url, '.glb'));

  it('każdy strój z ASSETS ma wpis w OUTFIT_PAINT i odwrotnie', () => {
    expect(Object.keys(OUTFIT_PAINT).sort()).toEqual([...files].sort());
  });

  it('każda reguła OUTFIT_PAINT trafia w istniejący materiał części stroju (literówka w nazwie materiału się nie ukryje)', async () => {
    for (const url of ASSETS.characters.modular) {
      const file = basename(url, '.glb') as OutfitFile;
      const present = new Set<string>();
      for (const mesh of skinnedMeshes((await loadFromDisk(url)).scene)) {
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
        present.add(`${outfitPart(mesh)}:${mat.name}`);
      }
      for (const key of Object.keys(OUTFIT_PAINT[file])) expect(present.has(key), `${file}: ${key}`).toBe(true);
    }
  }, 60_000);

  it('plik każdego stroju niesie dokładnie dwa klipy: Idle i Walk (pipeline usuwa pozostałe)', async () => {
    for (const url of ASSETS.characters.modular) {
      const names = (await loadFromDisk(url)).animations.map((a) => a.name).sort();
      expect(names, url).toEqual(['Idle', 'Walk']);
    }
  }, 60_000);

  it('klip wybierany jest po dokładnej nazwie, a dopiero potem po wzorcu (najzwyklejsza nazwa)', () => {
    const clip = (name: string): AnimationClip => new AnimationClip(name, 1, []);
    // „WALK” sortuje się alfabetycznie przed „Walk”: sam wzorzec wybrałby go, dokładna nazwa nie
    expect(findClip([clip('WALK'), clip('Walk'), clip('Idle')], 'Walk')?.name).toBe('Walk');
    expect(findClip([clip('Idle_Talking_Loop'), clip('Idle_Loop'), clip('Idle')], 'Idle')?.name).toBe('Idle');
    // zapas: brak dokładnej nazwy → najkrótsza pasująca
    expect(findClip([clip('Walk_Formal_Loop'), clip('Walk_Loop')], 'Walk')?.name).toBe('Walk_Loop');
    expect(findClip([clip('Run')], 'Walk')).toBeUndefined();
  });
});

describe('createCharacterFactory: częściowe awarie', () => {
  it('modular używa tych strojów, które się wczytały', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const only = ASSETS.characters.modular[0];
    const factory = await createCharacterFactory((url) => (url === only ? loadFromDisk(url) : Promise.reject(new Error('404'))));
    for (const seed of ['a', 'b', 'c', 'd']) {
      const c = factory.create(seed);
      expect(c.isFallback).toBe(false);
      c.dispose();
    }
    warn.mockRestore();
  }, 60_000);
});
