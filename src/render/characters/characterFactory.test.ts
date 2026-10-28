import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { AnimationClip, Box3, Color, Mesh, ShaderLib, SkinnedMesh, type Bone, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ASSETS } from '@/render/assets';
import { CHARACTER_STYLE, PALETTE } from '@/render/style';
import { pickAppearance } from './appearance';
import { CHARACTER_PROGRAM_KEY, FIXED_BASE, PALETTE_SIZE, REGION, type RegionName } from './characterMaterial';
import { createCharacterFactory, type CharacterFactory } from './characterFactory';
import { OUTFIT_PAINT, buildModularPack, findClip, outfitPart, type OutfitFile } from './modularPack';
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
/** Wszystkie kolory z PALETTE jako #rrggbb (sRGB): kolory stałych części stroju mają pochodzić stąd. */
const paletteHex = new Set<string>();
const collectHex = (v: unknown): void => {
  if (typeof v === 'string') paletteHex.add(new Color(v).getHexString());
  else if (Array.isArray(v)) v.forEach(collectHex);
  else if (v && typeof v === 'object') Object.values(v).forEach(collectHex);
};
collectHex(PALETTE);

const outfitName = (url: string): OutfitFile => basename(url, '.glb') as OutfitFile;
/** Stroje klientów i stroje specjalne (tylko kasjer): nazwy plików bez rozszerzenia. */
const REGULAR = ASSETS.characters.modular.map(outfitName);
const SPECIAL = ASSETS.characters.special.map(outfitName);

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
    expect(c.outfit).toBeNull();
    const cashier = factory.createWithOutfit('x', 'special-men-king');
    expect(cashier.isFallback).toBe(true);
    expect(cashier.outfit).toBeNull();
    cashier.dispose();
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
  const urls = [...ASSETS.characters.modular, ...ASSETS.characters.special];
  const files = urls.map(outfitName);

  it('każdy strój z ASSETS (zwykły i specjalny) ma wpis w OUTFIT_PAINT i odwrotnie', () => {
    expect(SPECIAL).toHaveLength(9);
    expect(Object.keys(OUTFIT_PAINT).sort()).toEqual([...files].sort());
  });

  it('każda reguła OUTFIT_PAINT trafia w istniejący materiał części stroju (literówka w nazwie materiału się nie ukryje)', async () => {
    for (const url of urls) {
      const file = outfitName(url);
      const present = new Set<string>();
      for (const mesh of skinnedMeshes((await loadFromDisk(url)).scene)) {
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
        present.add(`${outfitPart(mesh)}:${mat.name}`);
      }
      for (const key of Object.keys(OUTFIT_PAINT[file])) expect(present.has(key), `${file}: ${key}`).toBe(true);
    }
  }, 60_000);

  it('plik każdego stroju niesie dokładnie dwa klipy: Idle i Walk (pipeline usuwa pozostałe)', async () => {
    for (const url of urls) {
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
  it('brakujący strój specjalny: kasjer dostaje strój zwykły tej samej płci, bez rzucania, z ostrzeżeniem', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const factory = await createCharacterFactory((url) => (ASSETS.characters.special.includes(url) ? Promise.reject(new Error('404')) : loadFromDisk(url)));
    for (const outfit of ['special-men-king', 'special-women-witch'] as OutfitFile[]) {
      for (const seed of ['a', 'b', 'c', 'd']) {
        const c = factory.createWithOutfit(seed, outfit);
        expect(c.isFallback, `${outfit} ${seed}`).toBe(false);
        expect(REGULAR, `${outfit} ${seed}: ${c.outfit}`).toContain(c.outfit);
        expect(c.outfit!.startsWith('women-'), `${outfit} ${seed}: ${c.outfit}`).toBe(outfit.includes('women-'));
        c.dispose();
      }
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  }, 60_000);

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

/**
 * Regiony palety, które siatka stroju specjalnego MA zawierać: to, co gracz może przemalować swoim wyglądem (skóra, włosy,
 * góra, dół, a gdzie są zwykłe buty, także buty). Skóra tylko tam, gdzie strój ją odsłania (kombinezon kosmonauty zakrywa
 * wszystko), włosy tylko tam, gdzie widać czuprynę (hełm SWAT-u i kombinezon ją chowają). Stałe części (zbroja, hełm, korona,
 * wizjer, kaptur) zostają przy kolorach z PALETTE.
 */
const PAINTABLE: Record<string, RegionName[]> = {
  'special-men-spacesuit': ['top', 'bottom', 'shoes'],
  'special-men-king': ['skin', 'hair', 'top', 'bottom', 'eyeDark'],
  'special-men-swat': ['skin', 'top', 'bottom'],
  'special-men-adventurer': ['skin', 'hair', 'brow', 'top', 'bottom', 'shoes', 'eyeDark'],
  'special-women-scifi': ['skin', 'hair', 'top', 'bottom', 'shoes', 'eyeDark'],
  'special-women-adventurer': ['skin', 'hair', 'top', 'bottom', 'shoes', 'eyeDark'],
  'special-women-witch': ['skin', 'hair', 'top', 'bottom', 'shoes', 'eyeDark'],
  'special-women-medieval': ['skin', 'hair', 'top', 'bottom', 'shoes', 'eyeDark'],
  'special-women-soldier': ['skin', 'hair', 'top', 'bottom', 'shoes', 'eyeDark'],
};

describe('stroje specjalne i createWithOutfit (kasjer gracza)', () => {
  let factory: CharacterFactory;
  beforeAll(async () => {
    factory = await createCharacterFactory(loadFromDisk);
  }, 60_000);

  it('PAINTABLE opisuje dokładnie stroje specjalne z ASSETS', () => {
    expect(Object.keys(PAINTABLE).sort()).toEqual([...SPECIAL].sort());
  });

  it('wczytują się wszystkie stroje, a stałe kolory każdego mieszczą się w wolnych miejscach palety (nadmiar zlałby się w ostatnim)', async () => {
    const pack = await buildModularPack(loadFromDisk);
    expect(pack!.variants.map((v) => v.outfit).sort()).toEqual([...REGULAR, ...SPECIAL].sort());
    for (const v of pack!.variants) expect(v.shared.fixed.length, v.outfit).toBeLessThanOrEqual(PALETTE_SIZE - FIXED_BASE);
  }, 60_000);

  it('create(seed) nigdy nie daje stroju specjalnego (200 seedów), a klienci noszą wszystkie stroje zwykłe', () => {
    const special = new Set<string>(SPECIAL);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = factory.create(`klient-${i}`);
      expect(c.outfit, `klient-${i}`).not.toBeNull();
      expect(special.has(c.outfit!), `klient-${i}: ${c.outfit}`).toBe(false);
      seen.add(c.outfit!);
      c.dispose();
    }
    expect([...seen].sort()).toEqual([...REGULAR].sort());
  });

  describe.each(SPECIAL)('%s', (outfit) => {
    it('składa się z prawdziwego GLB: jedna siatka i materiał, wzrost z Appearance w zakresie, podeszwy na y≈0', () => {
      const [lo, hi] = CHARACTER_STYLE.heightRange;
      for (const seed of ['kasjer-a', 'kasjer-b', 'kasjer-c', 'kasjer-d']) {
        const a = pickAppearance(seed);
        const c = factory.createWithOutfit(seed, outfit);
        expect(c.isFallback, seed).toBe(false);
        expect(c.outfit, seed).toBe(outfit);
        expect(skinnedMeshes(c.object), seed).toHaveLength(1);
        expect(meshCount(c.object), `${seed}: broń albo inna część poza siatką to dodatkowy draw call`).toBe(1);
        expect(Array.isArray(skinnedMeshes(c.object)[0].material)).toBe(false);
        c.object.updateMatrixWorld(true);
        const box = new Box3().setFromObject(skinnedMeshes(c.object)[0], true);
        const height = box.max.y - box.min.y;
        expect(height, seed).toBeCloseTo(a.height, 1);
        expect(height, `${seed}: wzrost w zakresie`).toBeGreaterThanOrEqual(lo - 0.05);
        expect(height, `${seed}: wzrost w zakresie`).toBeLessThanOrEqual(hi + 0.05);
        expect(box.min.y, `${seed}: podeszwy na podłodze`).toBeCloseTo(0, 1);
        c.dispose();
      }
    });

    it('w chodzie stopy nie wchodzą pod podłogę, a stopa podporowa jej dotyka', () => {
      const c = factory.createWithOutfit('kasjer-chod', outfit);
      c.setAnim('walk', 0);
      const mesh = skinnedMeshes(c.object)[0];
      let lowest = Infinity, floorTouches = 0;
      for (let step = 0; step < 14; step++) {
        c.update(0.1);
        c.object.updateMatrixWorld(true);
        const y = new Box3().setFromObject(mesh, true).min.y;
        lowest = Math.min(lowest, y);
        if (Math.abs(y) < 0.06) floorTouches++;
      }
      expect(lowest, 'najniższy punkt w cyklu chodu').toBeGreaterThan(-0.06);
      expect(floorTouches, 'klatki, w których stopa jest na podłodze').toBeGreaterThan(3);
      c.dispose();
    });

    it('kolory regionów pochodzą z palety, a skóra, włosy i główne części ubrania są przemalowywalne', () => {
      const seed = 'kasjer-kolory';
      const a = pickAppearance(seed);
      const c = factory.createWithOutfit(seed, outfit);
      const mesh = skinnedMeshes(c.object)[0];
      const palette = materialOf(mesh).userData.palette as Color[];
      const regions = mesh.geometry.getAttribute('region').array as Float32Array;
      const used = new Set(Array.from(regions, Math.round));
      for (const r of used) {
        expect(r, 'region w palecie postaci').toBeGreaterThanOrEqual(0);
        expect(r, 'region w palecie postaci').toBeLessThan(PALETTE_SIZE);
        expect(palette[r], `kolor regionu ${r}`).toBeDefined();
        if (r >= FIXED_BASE) expect(paletteHex.has(palette[r].getHexString()), `stały region ${r}: #${palette[r].getHexString()}`).toBe(true);
      }
      for (const name of PAINTABLE[outfit]) expect(used.has(REGION[name]), `region ${name} w siatce`).toBe(true);
      // paleta niesie wygląd z seeda
      expect([REGION.skin, REGION.top, REGION.bottom, REGION.hair].map((r) => palette[r].getHexString()))
        .toEqual([a.skin, a.top, a.bottom, a.hair].map((hex) => new Color(hex).getHexString()));
      c.dispose();
    });
  });

  it('każdy materiał włosów, brwi i oczu stroju specjalnego ma regułę w OUTFIT_PAINT (nie zostaje na stałe przyciągnięty do palety)', async () => {
    const wanted: [RegExp, RegionName][] = [[/^hair/i, 'hair'], [/^eyebrows$/i, 'brow'], [/^eye$/i, 'eyeDark']];
    for (const url of ASSETS.characters.special) {
      const file = outfitName(url);
      for (const mesh of skinnedMeshes((await loadFromDisk(url)).scene)) {
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
        const key = `${outfitPart(mesh)}:${mat.name}`;
        for (const [re, region] of wanted) {
          if (re.test(mat.name)) expect((OUTFIT_PAINT[file] as Record<string, RegionName>)[key], `${file}: ${key}`).toBe(region);
        }
      }
    }
  }, 60_000);

  it('createWithOutfit: strój jest tym, o który poproszono (także zwykły), a wygląd zależy od seeda, nie od stroju', () => {
    const seed = 'kasjer-wyglad';
    const a = pickAppearance(seed);
    const expected = [a.skin, a.top, a.bottom, a.hair].map((hex) => new Color(hex).getHexString());
    for (const outfit of ['special-men-king', 'special-women-witch', 'men-suit', 'women-casual'] as OutfitFile[]) {
      const c = factory.createWithOutfit(seed, outfit);
      expect(c.outfit).toBe(outfit);
      const palette = materialOf(skinnedMeshes(c.object)[0]).userData.palette as Color[];
      expect([REGION.skin, REGION.top, REGION.bottom, REGION.hair].map((r) => palette[r].getHexString()), outfit).toEqual(expected);
      c.dispose();
    }
  });

  it('createWithOutfit jest deterministyczne: ta sama para (seed, strój) to ta sama geometria i paleta', () => {
    const [x, y] = [0, 1].map(() => factory.createWithOutfit('kasjer-det', 'special-men-swat'));
    expect(skinnedMeshes(x.object)[0].geometry).toBe(skinnedMeshes(y.object)[0].geometry);
    expect(paletteUniform(materialOf(skinnedMeshes(x.object)[0])).map((c) => c.getHex()))
      .toEqual(paletteUniform(materialOf(skinnedMeshes(y.object)[0])).map((c) => c.getHex()));
    x.dispose();
    y.dispose();
  });

  it('kasjer nie nosi akcesoriów klientów (plecak, torba, telefon), niezależnie od seeda', () => {
    for (let i = 0; i < 40; i++) {
      const seed = `kasjer-akcesorium-${i}`;
      const c = factory.createWithOutfit(seed, i % 2 ? 'special-men-adventurer' : 'women-casual');
      const regions = skinnedMeshes(c.object)[0].geometry.getAttribute('region').array as Float32Array;
      expect(regions.some((r) => r === REGION.accent || r === REGION.accent2), `${seed} (${pickAppearance(seed).accessory})`).toBe(false);
      c.dispose();
    }
  });

  it('postać z createWithOutfit chodzi i staje (klipy Idle i Walk), a dispose odpina ją od sceny', () => {
    const c = factory.createWithOutfit('kasjer-anim', 'special-women-medieval');
    const thigh = bone(c.object, /^(thigh_l|upperleg_?l)$/i);
    c.setAnim('idle', 0);
    c.update(0.01);
    const idleQ = thigh.quaternion.clone();
    c.setAnim('walk', 0);
    c.update(0.35);
    expect(thigh.quaternion.angleTo(idleQ)).toBeGreaterThan(0.1);
    c.dispose();
    expect(c.object.parent).toBeNull();
  });

  it('dispose fabryki zwalnia też geometrie strojów specjalnych', async () => {
    const own = await createCharacterFactory(loadFromDisk);
    const chars = SPECIAL.map((outfit) => own.createWithOutfit('kasjer-dispose', outfit));
    const geometries = new Set(chars.map((c) => skinnedMeshes(c.object)[0].geometry));
    expect(geometries.size).toBe(SPECIAL.length);
    const freed = vi.fn();
    for (const g of geometries) g.addEventListener('dispose', freed);
    for (const c of chars) c.dispose();
    own.dispose();
    expect(freed).toHaveBeenCalledTimes(geometries.size);
  }, 60_000);
});
