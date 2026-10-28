import {
  AnimationMixer, Color, Matrix3, Matrix4, Vector3,
  type AnimationClip, type BufferGeometry, type MeshStandardMaterial, type Object3D, type SkinnedMesh,
} from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ASSETS, type loadGLB } from '@/render/assets';
import { CHARACTER_STYLE, PALETTE } from '@/render/style';
import type { Rng } from '@/sim/rng';
import type { Appearance } from './appearance';
import { FIXED_BASE, PALETTE_SIZE, REGION, type RegionName } from './characterMaterial';

/**
 * Paczka postaci `modular` (Quaternius Modular Men/Women, CC0): gotowe stroje na jednym szkielecie (62 kości) z własnymi
 * klipami `Idle` i `Walk`. Każdy strój to wariant: wszystkie jego siatki scalone w jedną geometrię z wagami skóry, z
 * atrybutem `region` zamiast koloru (patrz characterMaterial.ts). Tabela `OUTFIT_PAINT` mówi, który materiał stroju
 * przejmuje kolor góry, dołu, butów, włosów i brwi; reszta (kask, kamizelka itp.) zostaje przy kolorze przyciągniętym do PALETTE.
 * Geometria wariantu jest wspólna dla wszystkich postaci; wygląd to paleta w materiale postaci.
 *
 * Stroje dzielą się na zwykłe (`ASSETS.characters.modular`: dostają je klienci, losowo spośród strojów swojej płci) i specjalne
 * (`ASSETS.characters.special`: kosmonauta, król, SWAT itd., tylko dla kasjera gracza przez `variantOf`). `variantFor` nigdy
 * nie zwraca stroju specjalnego.
 */

export type Loader = typeof loadGLB;

/** Siatka wariantu (tablice tylko do odczytu, współdzielone przez wszystkie postaci wariantu). */
export interface Shared {
  count: number;
  position: Float32Array; normal: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array;
  index: Uint16Array | Uint32Array;
  region: Float32Array;
  /** Stałe kolory części stroju (regiony od FIXED_BASE), z PALETTE. */
  fixed: Color[];
}

/** Dozwolone kolory stałych części stroju: ubrania, marka i neutralne materiały z PALETTE (docs/style-guide.md §2). */
const FIXED_CHOICES = [
  ...PALETTE.clothes, PALETTE.brand.cream, PALETTE.brand.orange, PALETTE.fixture.metal, PALETTE.fixture.wood, PALETTE.wall[4],
].map((hex) => new Color(hex));

/** Najbliższy kolor z PALETTE (odległość w przestrzeni liniowej): oryginalne kolory modeli nie trafiają do gry wprost. */
function nearestPaletteColor(color: Color): Color {
  let best = FIXED_CHOICES[0], bestDist = Infinity;
  for (const c of FIXED_CHOICES) {
    const d = (c.r - color.r) ** 2 + (c.g - color.g) ** 2 + (c.b - color.b) ** 2;
    if (d < bestDist) { best = c; bestDist = d; }
  }
  return best;
}

class MeshAccumulator {
  readonly position: number[] = []; readonly normal: number[] = [];
  readonly skinIndex: number[] = []; readonly skinWeight: number[] = [];
  readonly region: number[] = []; readonly index: number[] = [];
  readonly fixed: Color[] = [];

  /** Region stałego koloru części stroju (kolor materiału przyciągnięty do PALETTE, bez duplikatów; nadmiar zlewa się z ostatnim miejscem). */
  fixedRegion(color: Color): number {
    const snapped = nearestPaletteColor(color);
    let i = this.fixed.indexOf(snapped);
    if (i < 0) { i = this.fixed.length; this.fixed.push(snapped); }
    return Math.min(FIXED_BASE + i, PALETTE_SIZE - 1);
  }

  /**
   * Dokłada siatkę w przestrzeni bind szkieletu docelowego, cała w jednym regionie; `jointMap[j]` to indeks kości
   * docelowej dla kości j siatki (−1: brak).
   */
  add(mesh: SkinnedMesh, jointMap: ArrayLike<number>, region: number): void {
    const g = mesh.geometry;
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    const bind = mesh.bindMatrix, normalMat = new Matrix3().getNormalMatrix(bind);
    const base = this.region.length;
    const p = new Vector3(), n = new Vector3();
    const joints = [0, 0, 0, 0], weights = [0, 0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(bind);
      n.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const j = jointMap[si.getComponent(i, k)];
        const w = j >= 0 ? sw.getComponent(i, k) : 0;
        joints[k] = j >= 0 ? j : 0;
        weights[k] = w;
        sum += w;
      }
      if (sum > 0) for (let k = 0; k < 4; k++) weights[k] /= sum;
      this.position.push(p.x, p.y, p.z);
      this.normal.push(n.x, n.y, n.z);
      this.skinIndex.push(...joints);
      this.skinWeight.push(...weights);
      this.region.push(region);
    }
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i++) this.index.push(base + (idx ? idx.getX(i) : i));
  }

  finish(): Shared {
    const count = this.region.length;
    return {
      count,
      position: new Float32Array(this.position), normal: new Float32Array(this.normal),
      skinIndex: new Uint16Array(this.skinIndex), skinWeight: new Float32Array(this.skinWeight),
      index: count > 65535 ? new Uint32Array(this.index) : new Uint16Array(this.index),
      region: new Float32Array(this.region), fixed: this.fixed,
    };
  }
}

// --- Szkielet, proporcje, animacje, wariant -----------------------------------------------------------------------

const HEAD_RE = /^head$/i;
const HAND_RE = /^(hand|wrist)_?[lr]$/i;
const CHEST_RE = /^(spine_03|chest)$/i;
/** Tułów stroju (miednica, brzuch, klatka): rośnie o `torsoScale`. */
const TORSO_RE = /^(hips|abdomen|torso|chest)$/i;
/**
 * Szyja i barki wracają do skali 1, żeby głowa i ręce nie rosły razem z tułowiem (rosną tylko o własne mnożniki).
 * GLTFLoader usuwa kropki z nazw węzłów (`Shoulder.L` → `ShoulderL`), więc kropka jest opcjonalna.
 */
const TORSO_END_RE = /^(neck|shoulder\.?_?[lr])$/i;

/** Szkielet wspólny dla wariantów jednej bryły: szablon węzłów bez siatek i dane skórowania. */
export interface Rig {
  template: Object3D;
  boneNames: string[];
  boneInverses: Matrix4[];
  nameToIndex: Map<string, number>;
}

export interface Variant {
  /** Nazwa stroju (plik bez rozszerzenia). */
  outfit: OutfitFile;
  shared: Shared;
  rig: Rig;
  idle: AnimationClip;
  walk: AnimationClip;
  /** Wzrost (m) w pozie idle po powiększeniu głowy i dłoni oraz najniższy punkt (m): baza skali i ustawienia stóp. */
  height: number;
  minY: number;
  /** Indeksy kości: klatka piersiowa i dłonie (do akcesoriów). */
  chest: number;
  hands: { l: number; r: number };
  /** Geometrie wariantu (z akcesorium albo bez), budowane przy pierwszym użyciu (accessories.ts) i współdzielone do `dispose` fabryki. */
  geometries: Map<string, BufferGeometry>;
}

function skinnedMeshesOf(root: Object3D): SkinnedMesh[] {
  const out: SkinnedMesh[] = [];
  root.traverse((o) => { if ((o as SkinnedMesh).isSkinnedMesh) out.push(o as SkinnedMesh); });
  return out;
}

function extractRig(scene: Object3D, skeletonOwner: SkinnedMesh): Rig {
  const template = scene.clone(true);
  for (const m of skinnedMeshesOf(template)) m.removeFromParent();
  const boneNames = skeletonOwner.skeleton.bones.map((b) => b.name);
  return {
    template, boneNames,
    boneInverses: skeletonOwner.skeleton.boneInverses,
    nameToIndex: new Map(boneNames.map((n, i) => [n, i])),
  };
}

function jointMapFor(mesh: SkinnedMesh, rig: Rig): number[] {
  return mesh.skeleton.bones.map((b) => rig.nameToIndex.get(b.name) ?? -1);
}

export function bonesByName(root: Object3D): Map<string, Object3D> {
  const m = new Map<string, Object3D>();
  root.traverse((o) => { if ((o as { isBone?: boolean }).isBone) m.set(o.name, o); });
  return m;
}

/** Docelowa skala kości względem modelu bazowego (nie względem rodzica) albo undefined: kość dziedziczy skalę rodzica. */
function proportionScale(name: string): number | undefined {
  if (HEAD_RE.test(name)) return CHARACTER_STYLE.headScale;
  if (HAND_RE.test(name)) return CHARACTER_STYLE.handScale;
  if (TORSO_RE.test(name)) return CHARACTER_STYLE.torsoScale;
  if (TORSO_END_RE.test(name)) return 1;
  return undefined;
}

/**
 * Przesada proporcji Two Point: większa głowa, dłonie i tułów. Skale są jednorodne, więc skala lokalna kości to jej skala
 * docelowa podzielona przez docelową skalę najbliższego przodka z tabeli (bez ścinania przy obrotach animacji). Nogi
 * zostają (stopy stroju to kości IK przypięte do korzenia, więc skala uda oderwałaby stopę), a wzrost i tak wyrównuje
 * skala całej postaci, więc dłuższy tułów i większa głowa dają krótsze nogi w proporcji. Animacje nie mają ścieżek skali.
 */
export function applyProportions(byName: Map<string, Object3D>): void {
  for (const [name, bone] of byName) {
    const target = proportionScale(name);
    if (target === undefined) continue;
    let parent = 1;
    for (let p = bone.parent; p; p = p.parent) {
      const s = (p as { isBone?: boolean }).isBone ? proportionScale(p.name) : undefined;
      if (s !== undefined) { parent = s; break; }
    }
    bone.scale.setScalar(target / parent);
  }
}

/**
 * Klip o dokładnie tej nazwie (`Idle`, `Walk`); gdy go nie ma, najkrótsza (najzwyklejsza) nazwa zawierająca ją bez względu
 * na wielkość liter. Pipeline zostawia w plikach tylko te dwa klipy, więc zapas działa tylko dla innych źródeł.
 */
export function findClip(clips: AnimationClip[], name: 'Idle' | 'Walk'): AnimationClip | undefined {
  const exact = clips.find((c) => c.name === name);
  if (exact) return exact;
  const pattern = new RegExp(name, 'i');
  return clips.filter((c) => pattern.test(c.name)).sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : 1))[0];
}

/** Wzrost i najniższy punkt siatki w pozie idle (klatka 0), z głową i dłońmi powiększonymi. */
function measure(shared: Shared, rig: Rig, idle: AnimationClip): { height: number; minY: number } {
  const root = cloneSkinned(rig.template);
  const byName = bonesByName(root);
  applyProportions(byName);
  const mixer = new AnimationMixer(root);
  mixer.clipAction(idle).play();
  mixer.update(0);
  root.updateMatrixWorld(true);
  const skin = rig.boneNames.map((n, i) => byName.get(n)!.matrixWorld.clone().multiply(rig.boneInverses[i]));
  const p = new Vector3(), acc = new Vector3(), at = new Vector3();
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < shared.count; i++) {
    p.set(shared.position[3 * i], shared.position[3 * i + 1], shared.position[3 * i + 2]);
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = shared.skinWeight[4 * i + k];
      if (w > 0) acc.add(at.copy(p).applyMatrix4(skin[shared.skinIndex[4 * i + k]]).multiplyScalar(w));
    }
    lo = Math.min(lo, acc.y); hi = Math.max(hi, acc.y);
  }
  mixer.uncacheRoot(root);
  return { height: hi - lo, minY: lo };
}

function finishVariant(acc: MeshAccumulator, rig: Rig, idle: AnimationClip, walk: AnimationClip, outfit: OutfitFile): Variant {
  const shared = acc.finish();
  const find = (re: RegExp): number => rig.boneNames.findIndex((n) => re.test(n));
  return {
    outfit, shared, rig, idle, walk, ...measure(shared, rig, idle),
    chest: find(CHEST_RE),
    hands: { l: find(/^(hand|wrist)_?l$/i), r: find(/^(hand|wrist)_?r$/i) },
    geometries: new Map(),
  };
}

// --- Tabela malowania strojów -------------------------------------------------------------------------------------

/**
 * Nazwa pliku stroju bez rozszerzenia (`public/assets/characters/<nazwa>.glb`). Pierwsze dwanaście to stroje klientów
 * (`ASSETS.characters.modular`), ostatnie dziewięć to stroje specjalne kasjera (`ASSETS.characters.special`, przedrostek `special-`).
 */
export type OutfitFile =
  | 'men-casual-hoodie' | 'men-casual-2' | 'men-suit' | 'men-worker' | 'men-farmer' | 'men-beach' | 'men-punk'
  | 'women-casual' | 'women-suit' | 'women-formal' | 'women-worker' | 'women-punk'
  | 'special-men-spacesuit' | 'special-men-king' | 'special-men-swat' | 'special-men-adventurer'
  | 'special-women-scifi' | 'special-women-adventurer' | 'special-women-witch' | 'special-women-medieval' | 'special-women-soldier';

/** Nazwa stroju ze ścieżki pliku z `ASSETS.characters` (`/assets/characters/men-suit.glb` → `men-suit`). */
export function outfitOfPath(path: string): OutfitFile {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.glb$/, '') as OutfitFile;
}

/** Płeć postaci stroju: z nazwy pliku (`men-…`, `women-…`, `special-men-…`, `special-women-…`). */
export function outfitBody(outfit: OutfitFile): Appearance['body'] {
  return outfit.includes('women-') ? 'female' : 'male';
}

/** Część stroju z nazwy węzła siatki (patrz `outfitPart`). */
type OutfitPart = 'body' | 'legs' | 'pants' | 'feet' | 'head';
/** Klucz reguły: „część:Materiał”, np. `body:Suit` (materiał `Suit` na części `body`). */
export type PaintKey = `${OutfitPart}:${string}`;

/**
 * Które materiały stroju przejmują kolory z `Appearance` (region w palecie postaci). Skóra (`Skin*`) zawsze jest skórą.
 * Białe części (kołnierz koszuli, szorty, podeszwy) idą do `eyeWhite` (ciepła biel `wall[0]`): przyciągnięte do PALETTE
 * dawały szaroniebieski kołnierz, który pod brodą czytał się jak zarost. Materiały spoza tabeli (kask, kamizelka, krawat,
 * podeszwy, kolczyki) zostają przy najbliższym kolorze z PALETTE. Typ pilnuje literówek w nazwie stroju, części i regionu,
 * a test sprawdza, że każda reguła trafia w istniejący materiał pliku.
 */
export const OUTFIT_PAINT: Record<OutfitFile, Record<PaintKey, RegionName>> = {
  'men-casual-hoodie': {
    'body:Purple': 'top', 'feet:Purple': 'shoes', 'feet:White': 'eyeWhite', 'legs:LightBlue': 'bottom',
    'head:Eyebrows': 'brow', 'head:Eye': 'eyeDark', 'head:Hair': 'hair',
  },
  'men-casual-2': {
    'body:LightBrown': 'top', 'feet:Red_Dark': 'shoes', 'feet:White': 'eyeWhite', 'legs:LightBlue': 'bottom',
    'head:Skin_Darker': 'skin', 'head:Eyebrows': 'brow', 'head:Eye': 'eyeDark', 'head:Hair': 'hair',
  },
  'men-suit': {
    'body:Suit': 'top', 'body:White': 'eyeWhite', 'body:Tie': 'bottom', 'legs:Suit': 'bottom', 'feet:Black': 'shoes',
    'head:Eyebrows': 'brow', 'head:Eye': 'eyeDark', 'head:Hair': 'hair',
  },
  'men-worker': {
    'body:LightBrown': 'top', 'legs:Brown': 'bottom', 'feet:Black': 'shoes',
    'head:Eyebrows': 'brow', 'head:Moustache': 'brow', 'head:Eye': 'eyeDark',
  },
  'men-farmer': {
    'body:Brown': 'top', 'body:LightBlue': 'bottom', 'pants:LightBlue': 'bottom', 'feet:Brown': 'shoes',
    'head:Eyebrows': 'brow', 'head:Eye': 'eyeDark',
  },
  'men-beach': {
    'body:LightBrown': 'top', 'legs:Red_Dark': 'bottom', 'legs:White': 'eyeWhite', 'feet:Red_Dark': 'shoes',
    'head:Eyebrows': 'brow', 'head:Eye': 'eyeDark', 'head:Hair': 'hair',
  },
  'men-punk': {
    'body:White': 'top', 'legs:LightBlue': 'bottom', 'feet:Black': 'shoes', 'head:Red': 'hair', 'head:Red_Dark': 'brow',
    'head:Eyebrows': 'brow', 'head:Eye': 'eyeDark',
  },
  'women-casual': {
    'body:White': 'top', 'legs:Orange': 'bottom', 'feet:Grey': 'shoes', 'head:Hair_Blond': 'hair', 'head:Hair_Brown': 'brow',
    'head:Brown': 'eyeDark',
  },
  'women-suit': {
    'body:Black': 'top', 'body:White': 'eyeWhite', 'legs:Black': 'bottom', 'feet:Black': 'shoes', 'head:Hair_Blond': 'hair',
    'head:Hair_Brown': 'brow', 'head:Brown': 'eyeDark',
  },
  'women-formal': {
    'body:LimeGreen': 'top', 'legs:LimeGreen': 'top', 'feet:Red': 'shoes', 'head:Red': 'hair', 'head:Brown': 'brow',
  },
  'women-worker': {
    'body:White': 'top', 'legs:Brown2': 'bottom', 'feet:Black': 'shoes', 'head:DarkBrown': 'hair', 'head:Brown': 'eyeDark',
  },
  'women-punk': {
    'body:Pink': 'top', 'legs:Black': 'bottom', 'feet:Black': 'shoes', 'head:Pink': 'hair', 'head:Hair_Brown': 'brow',
    'head:Brown': 'eyeDark',
  },
  'special-men-spacesuit': {
    'body:SciFi_Main': 'top', 'legs:SciFi_MainDark': 'bottom', 'legs:SciFi_Main': 'bottom', 'feet:SciFi_Light_Accent': 'shoes',
  },
  'special-men-king': {
    'body:Blue': 'top', 'legs:DarkBrown': 'bottom', 'head:Hair_White': 'hair', 'head:Eye': 'eyeDark',
  },
  'special-men-swat': {
    'body:Swat': 'top', 'legs:Swat': 'bottom',
  },
  'special-men-adventurer': {
    'body:Green': 'top', 'legs:Brown': 'bottom', 'feet:Grey': 'shoes', 'head:Hair': 'hair', 'head:Eyebrows': 'brow', 'head:Eye': 'eyeDark',
  },
  'special-women-scifi': {
    'body:Blue': 'top', 'head:Blue': 'top', 'legs:LightBlue': 'bottom', 'feet:Metal': 'shoes', 'head:Hair_Black': 'hair', 'head:Brown': 'eyeDark',
  },
  'special-women-adventurer': {
    'body:LightGreen': 'top', 'legs:Brown_02': 'bottom', 'feet:Brown_02': 'shoes', 'head:Hair_Brown': 'hair', 'head:Brown': 'eyeDark',
  },
  'special-women-witch': {
    'body:Purple': 'top', 'legs:Purple': 'top', 'head:Purple': 'top', 'legs:Brown': 'bottom', 'feet:Brown2': 'shoes',
    'head:Hair_Black': 'hair', 'head:Brown': 'eyeDark',
  },
  'special-women-medieval': {
    'body:LightBrown': 'top', 'body:DarkBrown': 'top', 'legs:Black': 'bottom', 'feet:DarkBrown': 'shoes', 'head:White': 'hair', 'head:Brown': 'eyeDark',
  },
  'special-women-soldier': {
    'body:Black': 'top', 'body:Swat': 'top', 'legs:Swat': 'bottom', 'feet:Grey': 'shoes', 'head:Hair_Brown': 'hair', 'head:Brown': 'eyeDark',
  },
};

/** Część stroju z nazwy węzła (albo jego przodków), np. `Punk_Head_1` → `head`. `pistol` (broń w stroju Suit) jest pomijana. */
export function outfitPart(mesh: Object3D): OutfitPart | 'pistol' | undefined {
  for (let o: Object3D | null = mesh; o; o = o.parent) {
    const m = /(body|legs|pants|feet|head|pistol)(_\d+)?$/i.exec(o.name);
    if (m) return m[1].toLowerCase() as OutfitPart | 'pistol';
  }
  return undefined;
}

// --- Budowa paczki ------------------------------------------------------------------------------------------------

export interface ModularPack {
  /** Wszystkie wczytane stroje, także specjalne (do zwalniania pamięci podręcznej geometrii). */
  variants: readonly Variant[];
  /**
   * Strój klienta dla wyglądu: losowy spośród strojów ZWYKŁYCH danej płci (gdy żadnego nie wczytano, spośród wszystkich zwykłych).
   * Nigdy nie zwraca stroju specjalnego.
   */
  variantFor(a: Appearance, rng: Rng): Variant;
  /** Strój o danej nazwie, zwykły albo specjalny (kasjer); undefined, gdy jego plik się nie wczytał. */
  variantOf(outfit: OutfitFile): Variant | undefined;
}

/** Wczytuje pliki; nieudane dają null (i jedno ostrzeżenie na całość), bez rzucania. */
async function loadAll(load: Loader, urls: string[]): Promise<(GLTF | null)[]> {
  const failed: string[] = [];
  let reason: unknown;
  const out = await Promise.all(urls.map((url) =>
    Promise.resolve().then(() => load(url)).catch((error: unknown) => { failed.push(url); reason ??= error; return null; })));
  if (failed.length) console.warn(`Postacie: nie wczytano ${failed.length} z ${urls.length} plików (${failed.join(', ')}).`, reason);
  return out;
}

/**
 * Wczytuje stroje z `ASSETS.characters.modular` (klienci) i `ASSETS.characters.special` (kasjer). Zwraca null, gdy żaden strój
 * zwykły się nie wczytał (wtedy fabryka daje postacie zastępcze: bez strojów klientów pack nie ma po co istnieć).
 */
export async function buildModularPack(load: Loader): Promise<ModularPack | null> {
  const regular = ASSETS.characters.modular;
  const files = [...regular, ...ASSETS.characters.special];
  const gltfs = await loadAll(load, files);
  const byBody: Record<Appearance['body'], Variant[]> = { male: [], female: [] };
  const byOutfit = new Map<OutfitFile, Variant>();
  files.forEach((url, i) => {
    const gltf = gltfs[i];
    if (!gltf) return;
    const file = outfitOfPath(url);
    const idle = findClip(gltf.animations, 'Idle'), walk = findClip(gltf.animations, 'Walk');
    const meshes = skinnedMeshesOf(gltf.scene).filter((m) => outfitPart(m) !== 'pistol');
    if (!idle || !walk || meshes.length === 0) return;
    const rig = extractRig(gltf.scene, meshes[0]);
    const rules: Partial<Record<PaintKey, RegionName>> = OUTFIT_PAINT[file] ?? {};
    const acc = new MeshAccumulator();
    for (const mesh of meshes) {
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
      const rule = rules[`${outfitPart(mesh)}:${mat.name}` as PaintKey];
      const region = /^skin/i.test(mat.name) ? REGION.skin : rule !== undefined ? REGION[rule] : acc.fixedRegion(mat.color);
      acc.add(mesh, jointMapFor(mesh, rig), region);
    }
    const variant = finishVariant(acc, rig, idle, walk, file);
    byOutfit.set(file, variant);
    if (i < regular.length) byBody[outfitBody(file)].push(variant);   // klienci dostają tylko stroje zwykłe
  });
  const customers = [...byBody.male, ...byBody.female];
  if (customers.length === 0) return null;
  return {
    variants: [...byOutfit.values()],
    variantFor: (a, rng) => rng.pick(byBody[a.body].length ? byBody[a.body] : customers),
    variantOf: (outfit) => byOutfit.get(outfit),
  };
}
