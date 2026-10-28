import { basename } from 'node:path';
import { AnimationClip, Box3, BufferGeometry, Color, Group, Mesh, ShaderLib, SkinnedMesh, type Bone, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ASSETS } from '@/render/assets';
import { CHARACTER_STYLE, PALETTE } from '@/render/style';
import { pickAppearance } from './appearance';
import { CHARACTER_PROGRAM_KEY, FIXED_BASE, PALETTE_SIZE, REGION, type RegionName } from './characterMaterial';
import { createCharacterFactory, type CharacterFactory } from './characterFactory';
import { OUTFIT_PAINT, buildModularPack, buildVariant, findClip, outfitPart, type OutfitFile } from './modularPack';
import { loadFromDisk } from './testAssets';
import { WALK_SPEED_MPS } from './walkSpeed';

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
    await expect(factory.ensureOutfit('special-men-king')).resolves.toBeUndefined();   // nie ma czego wczytywać, ale kontrakt trzyma
    expect(factory.hasOutfit?.('special-men-king')).toBe(true);                         // kapsuła powstaje od razu w każdym stroju
    expect(() => factory.dispose()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('kasjer w mundurze z postaci zastępczej: nadpisana góra jest zielenią marki, reszta wyglądu z seeda', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const factory = await createCharacterFactory(() => Promise.reject(new Error('404')));
    const a = pickAppearance('seed-mundur');
    const paletteOf = (c: { object: Object3D }): Color[] => paletteUniform((c.object.children[0] as Mesh).material as Material);
    const hex = (c: string): string => new Color(c).getHexString();
    const plain = paletteOf(factory.createWithOutfit('seed-mundur', 'men-suit'));
    const uniform = paletteOf(factory.createWithOutfit('seed-mundur', 'men-suit', { top: PALETTE.brand.green }));
    expect(plain[REGION.top].getHexString()).toBe(hex(a.top));
    expect(uniform[REGION.top].getHexString()).toBe(hex(PALETTE.brand.green));
    for (const region of [REGION.skin, REGION.bottom, REGION.hair]) expect(uniform[region].getHexString()).toBe(plain[region].getHexString());
    vi.restoreAllMocks();
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

  it('plik każdego stroju ma budżet trójkątów z potoku: 3 tys., a kosmonauta, król i poszukiwacz przygód (m) 5 tys.', async () => {
    // Uproszczenie permissive schodzi dokładnie do celu zadania. „Sloppy” zostawiał stroje zwykłe na 2,7–2,9 tys. trójkątów i z dziurami
    // (kamizelka i kask robotnika, spodnie robotnicy), a kosmonaucie przy 3 tys. rwał się pancerz, królowi i poszukiwaczowi znikały oczy.
    const target = (file: OutfitFile): number => (['special-men-spacesuit', 'special-men-king', 'special-men-adventurer'].includes(file) ? 5000 : 3000);
    for (const url of urls) {
      const file = outfitName(url);
      let triangles = 0;
      for (const mesh of skinnedMeshes((await loadFromDisk(url)).scene)) {
        triangles += (mesh.geometry.index ?? mesh.geometry.getAttribute('position')).count / 3;
      }
      expect(triangles, `${file}: ${triangles} trójkątów, cel ${target(file)}`).toBeGreaterThan(target(file) * 0.98);
      expect(triangles, `${file}: ${triangles} trójkątów, cel ${target(file)}`).toBeLessThanOrEqual(target(file) * 1.1);
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
      await expect(factory.ensureOutfit(outfit)).resolves.toBeUndefined();   // błąd wczytania nie odrzuca obietnicy
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

  it('brakujący strój ostrzega raz na strój, a nie przy każdym createWithOutfit (kasjer powstaje od nowa przy każdej zmianie wyglądu)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loadWithoutSpecial = (url: string): Promise<GLTF> => (ASSETS.characters.special.includes(url) ? Promise.reject(new Error('404')) : loadFromDisk(url));
    const factory = await createCharacterFactory(loadWithoutSpecial);
    const missingOutfitWarnings = (): string[] => warn.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('brak stroju'));
    await factory.ensureOutfit('special-men-king');
    await factory.ensureOutfit('special-women-witch');
    warn.mockClear(); // ostrzeżenie o niewczytanym pliku to osobna sprawa

    for (const seed of ['a', 'b', 'c', 'd', 'e']) factory.createWithOutfit(seed, 'special-men-king').dispose();
    expect(missingOutfitWarnings()).toHaveLength(1);
    expect(missingOutfitWarnings()[0]).toContain('special-men-king');

    // inny brakujący strój ostrzega osobno, a powtórki obu już nie
    for (const seed of ['a', 'b', 'c']) factory.createWithOutfit(seed, 'special-women-witch').dispose();
    for (const seed of ['f', 'g']) factory.createWithOutfit(seed, 'special-men-king').dispose();
    expect(missingOutfitWarnings()).toHaveLength(2);
    expect(missingOutfitWarnings()[1]).toContain('special-women-witch');

    // licznik należy do fabryki: druga fabryka (np. podgląd na ekranie startowym) ostrzega o tym samym stroju jeszcze raz
    const second = await createCharacterFactory(loadWithoutSpecial);
    await second.ensureOutfit('special-men-king');
    warn.mockClear();
    second.createWithOutfit('a', 'special-men-king').dispose();
    second.createWithOutfit('b', 'special-men-king').dispose();
    expect(missingOutfitWarnings()).toHaveLength(1);
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
    await Promise.all(SPECIAL.map((outfit) => factory.ensureOutfit(outfit)));   // specjalne dochodzą na żądanie (R40)
  }, 60_000);

  it('PAINTABLE opisuje dokładnie stroje specjalne z ASSETS', () => {
    expect(Object.keys(PAINTABLE).sort()).toEqual([...SPECIAL].sort());
  });

  it('wczytują się wszystkie stroje, a stałe kolory każdego mieszczą się w wolnych miejscach palety (nadmiar zlałby się w ostatnim)', async () => {
    const pack = await buildModularPack(loadFromDisk);
    await Promise.all(SPECIAL.map((outfit) => pack!.ensure(outfit)));
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
    await Promise.all(SPECIAL.map((outfit) => own.ensureOutfit(outfit)));
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

describe('stroje specjalne na żądanie (ruling R40) i mundur kasjera', () => {
  /** Loader-szpieg: zapisuje pobrane adresy; `fail` wskazuje adresy, które mają się nie wczytać. */
  function spyLoader(fail: (url: string) => boolean = () => false): { load: (url: string) => Promise<GLTF>; urls: string[] } {
    const urls: string[] = [];
    return { urls, load: (url) => { urls.push(url); return fail(url) ? Promise.reject(new Error('404')) : loadFromDisk(url); } };
  }
  const specialUrls = (urls: string[]): string[] => urls.filter((u) => u.includes('special-'));
  const hex = (c: string): string => new Color(c).getHexString();
  const topOf = (c: { object: Object3D }): string => (materialOf(skinnedMeshes(c.object)[0]).userData.palette as Color[])[REGION.top].getHexString();

  it('start pobiera tylko stroje zwykłe: żaden adres special- nie jest pobrany przed ensureOutfit, także przez createWithOutfit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = spyLoader();
    const factory = await createCharacterFactory(spy.load);
    expect([...spy.urls].sort()).toEqual([...ASSETS.characters.modular].sort());
    factory.createWithOutfit('a', 'special-men-king').dispose();   // zły porządek wołania niczego nie dociąga po cichu
    factory.create('b').dispose();
    expect(specialUrls(spy.urls)).toEqual([]);
    warn.mockRestore();
  });

  it('ensureOutfit(specjalny) pobiera tylko ten strój, raz; równoległe wywołania dzielą jedną obietnicę; potem createWithOutfit daje ten strój', async () => {
    const spy = spyLoader();
    const factory = await createCharacterFactory(spy.load);
    const first = factory.ensureOutfit('special-men-king');
    const second = factory.ensureOutfit('special-men-king');
    expect(second).toBe(first);
    await first;
    expect(specialUrls(spy.urls)).toEqual(['/assets/characters/special-men-king.glb']);
    await factory.ensureOutfit('special-men-king');
    expect(specialUrls(spy.urls)).toHaveLength(1);
    for (const seed of ['a', 'b']) {
      const c = factory.createWithOutfit(seed, 'special-men-king');
      expect(c.outfit).toBe('special-men-king');
      expect(c.isFallback).toBe(false);
      c.dispose();
    }
    await factory.ensureOutfit('special-women-witch');
    expect(specialUrls(spy.urls)).toHaveLength(2);
  }, 60_000);

  it('ensureOutfit(zwykły) wraca od razu i niczego nie pobiera', async () => {
    const spy = spyLoader();
    const factory = await createCharacterFactory(spy.load);
    const before = spy.urls.length;
    await Promise.all(REGULAR.map((outfit) => factory.ensureOutfit(outfit)));
    expect(spy.urls).toHaveLength(before);
  });

  it('createWithOutfit przed ensureOutfit: strój zwykły tej samej płci, bez wyjątku i bez cichego dociągania', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const factory = await createCharacterFactory(spyLoader().load);
    for (const outfit of SPECIAL) {
      const c = factory.createWithOutfit('przed-ensure', outfit);
      expect(c.isFallback, outfit).toBe(false);
      expect(REGULAR, outfit).toContain(c.outfit);
      expect(c.outfit!.includes('women-'), outfit).toBe(outfit.includes('women-'));
      c.dispose();
    }
    warn.mockRestore();
  });

  it('błąd wczytania nie odrzuca obietnicy, kasjer dostaje strój zwykły (jedno ostrzeżenie), a kolejne ensureOutfit próbuje jeszcze raz', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let down = true;
    const spy = spyLoader((url) => down && url.includes('special-men-king'));
    const factory = await createCharacterFactory(spy.load);
    await expect(factory.ensureOutfit('special-men-king')).resolves.toBeUndefined();
    const fallback = factory.createWithOutfit('a', 'special-men-king');
    expect(REGULAR).toContain(fallback.outfit);
    expect(fallback.outfit!.includes('women-')).toBe(false);
    fallback.dispose();
    expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('brak stroju special-men-king'))).toHaveLength(1);

    down = false;                                              // sieć wróciła: gracz wybiera ten strój jeszcze raz
    await factory.ensureOutfit('special-men-king');
    expect(specialUrls(spy.urls)).toHaveLength(2);
    expect(factory.createWithOutfit('a', 'special-men-king').outfit).toBe('special-men-king');
    warn.mockRestore();
  }, 60_000);

  it('plik, którego nie da się zbudować w wariant (bez klipów), też nie odrzuca obietnicy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const empty = { scene: new Group(), animations: [] } as unknown as GLTF;
    const factory = await createCharacterFactory((url) => (url.includes('special-men-king') ? Promise.resolve(empty) : loadFromDisk(url)));
    await expect(factory.ensureOutfit('special-men-king')).resolves.toBeUndefined();
    expect(REGULAR).toContain(factory.createWithOutfit('a', 'special-men-king').outfit);
    warn.mockRestore();
  });

  it('plik, którego budowa wariantu rzuca wyjątek (siatka bez szkieletu), też nie odrzuca obietnicy, ostrzega raz, a strój zostaje nieobecny', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = new Group();
    const skinless = new SkinnedMesh(new BufferGeometry());   // SkinnedMesh bez bind: extractRig sięga po skeleton.bones
    skinless.name = 'Body';
    scene.add(skinless);
    const gltf = { scene, animations: [new AnimationClip('Idle', 1, []), new AnimationClip('Walk', 1, [])] } as unknown as GLTF;
    expect(() => buildVariant('special-men-king', gltf)).toThrow(TypeError);   // to buildVariant rzuca; `.catch` w ensure musi to złapać
    const factory = await createCharacterFactory((url) => (url.includes('special-men-king') ? Promise.resolve(gltf) : loadFromDisk(url)));
    await expect(factory.ensureOutfit('special-men-king')).resolves.toBeUndefined();
    const built = warn.mock.calls.filter((call) => String(call[0]).includes('nie udało się zbudować stroju special-men-king'));
    expect(built).toHaveLength(1);
    expect(built[0]![1]).toBeInstanceOf(TypeError);                              // przyczyna idzie do ostrzeżenia
    expect(factory.hasOutfit?.('special-men-king')).toBe(false);
    expect(REGULAR).toContain(factory.createWithOutfit('a', 'special-men-king').outfit);   // jak przy braku pliku
    warn.mockRestore();
  });

  it('hasOutfit mówi, czy createWithOutfit zbuduje strój od razu: zwykłe tak, specjalne dopiero po udanym ensureOutfit (nieudany niczego nie zmienia)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let down = true;
    const spy = spyLoader((url) => down && url.includes('special-men-king'));
    const factory = await createCharacterFactory(spy.load);
    for (const outfit of REGULAR) expect(factory.hasOutfit?.(outfit), outfit).toBe(true);
    for (const outfit of SPECIAL) expect(factory.hasOutfit?.(outfit), outfit).toBe(false);
    await factory.ensureOutfit('special-women-witch');
    expect(factory.hasOutfit?.('special-women-witch')).toBe(true);
    expect(factory.hasOutfit?.('special-men-swat')).toBe(false);              // inne specjalne dalej czekają
    await factory.ensureOutfit('special-men-king');                           // plik nie dochodzi
    expect(factory.hasOutfit?.('special-men-king')).toBe(false);
    down = false;
    await factory.ensureOutfit('special-men-king');
    expect(factory.hasOutfit?.('special-men-king')).toBe(true);
    const before = spy.urls.length;
    expect(factory.createWithOutfit('a', 'special-men-king').outfit).toBe('special-men-king');
    expect(spy.urls).toHaveLength(before);                                    // pytanie i budowa nic nie pobierają
    warn.mockRestore();
  }, 60_000);

  it('buildVariant składa wariant z wczytanego pliku, a z pustego zwraca null', async () => {
    const gltf = await loadFromDisk('/assets/characters/men-suit.glb');
    const variant = buildVariant('men-suit', gltf)!;
    expect(variant.outfit).toBe('men-suit');
    expect(variant.shared.count).toBeGreaterThan(1000);
    expect(variant.height).toBeGreaterThan(1);
    expect(buildVariant('men-suit', { scene: new Group(), animations: [] } as unknown as GLTF)).toBeNull();
  });

  it('ModularPack.variants jest żywym widokiem: stroje dobudowane później też są na liście (dispose fabryki je zwolni)', async () => {
    const pack = (await buildModularPack(loadFromDisk))!;
    expect(pack.variants.map((v) => v.outfit).sort()).toEqual([...REGULAR].sort());
    expect(pack.variantOf('special-men-swat')).toBeUndefined();
    await pack.ensure('special-men-swat');
    expect(pack.variants.map((v) => v.outfit).sort()).toEqual([...REGULAR, 'special-men-swat'].sort());
    expect(pack.variantOf('special-men-swat')).toBeDefined();
  });

  it('dispose fabryki zwalnia geometrię stroju dociągniętego później', async () => {
    const own = await createCharacterFactory(loadFromDisk);
    await own.ensureOutfit('special-women-scifi');
    const c = own.createWithOutfit('dispose-lazy', 'special-women-scifi');
    const geometry = skinnedMeshes(c.object)[0].geometry;
    const freed = vi.fn();
    geometry.addEventListener('dispose', freed);
    c.dispose();
    own.dispose();
    expect(freed).toHaveBeenCalledTimes(1);
  }, 60_000);

  describe('mundur kasjera (nadpisanie góry)', () => {
    let factory: CharacterFactory;
    beforeAll(async () => {
      factory = await createCharacterFactory(loadFromDisk);
      await factory.ensureOutfit('special-men-king');
    }, 60_000);

    it('strój zwykły z nadpisaną górą ma kolor zieleni marki w regionie top, a reszta wyglądu zostaje z seeda', () => {
      const seed = 'kasjer-mundur';
      const a = pickAppearance(seed);
      for (const outfit of ['men-suit', 'women-casual', 'men-farmer'] as OutfitFile[]) {
        const c = factory.createWithOutfit(seed, outfit, { top: PALETTE.brand.green });
        const palette = materialOf(skinnedMeshes(c.object)[0]).userData.palette as Color[];
        expect(palette[REGION.top].getHexString(), outfit).toBe(hex(PALETTE.brand.green));
        expect([REGION.skin, REGION.bottom, REGION.hair].map((r) => palette[r].getHexString()), outfit).toEqual([a.skin, a.bottom, a.hair].map(hex));
        expect(c.outfit).toBe(outfit);
        c.dispose();
      }
    });

    it('bez nadpisania góra jest z seeda (także w stroju specjalnym), a nadpisanie dotyczy tylko tego wywołania', () => {
      const seed = 'kasjer-mundur-2';
      const green = factory.createWithOutfit(seed, 'men-suit', { top: PALETTE.brand.green });
      const plain = factory.createWithOutfit(seed, 'men-suit');
      const king = factory.createWithOutfit(seed, 'special-men-king');
      expect(topOf(green)).toBe(hex(PALETTE.brand.green));
      expect(topOf(plain)).toBe(hex(pickAppearance(seed).top));
      expect(topOf(king)).toBe(hex(pickAppearance(seed).top));
      expect(topOf(king)).not.toBe(hex(PALETTE.brand.green));
      for (const c of [green, plain, king]) c.dispose();
    });

    it('klient nigdy nie dostaje zieleni marki w górze (personel nosi brand.green, klient nie): wygląd z seeda i postać z create', () => {
      expect(PALETTE.clothes.map(hex)).not.toContain(hex(PALETTE.brand.green));
      for (let i = 0; i < 500; i++) expect(hex(pickAppearance(`klient-zielen-${i}`).top), `klient-zielen-${i}`).not.toBe(hex(PALETTE.brand.green));
      for (let i = 0; i < 120; i++) {
        const c = factory.create(`klient-zielen-${i}`);
        expect(topOf(c), `klient-zielen-${i}`).not.toBe(hex(PALETTE.brand.green));
        c.dispose();
      }
    });
  });
});
