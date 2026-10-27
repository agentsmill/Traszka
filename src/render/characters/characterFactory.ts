import {
  AnimationClip, AnimationMixer, BufferAttribute, BufferGeometry, Color, Group, MathUtils, Matrix3, Matrix4, Quaternion,
  QuaternionKeyframeTrack, Skeleton, SkinnedMesh, Vector2, Vector3, VectorKeyframeTrack,
  type AnimationAction, type KeyframeTrack, type MeshStandardMaterial, type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ASSETS, loadGLB } from '@/render/assets';
import { BEVEL, CHARACTER_STYLE, PALETTE } from '@/render/style';
import { createRng, subSeed } from '@/sim/rng';
import { pickAppearance, type Appearance } from './appearance';
import { FIXED_BASE, PALETTE_SIZE, REGION, characterPalette, createCharacterMaterial, createFallbackCharacter } from './fallbackCharacter';

export type CharacterPack = 'ubc' | 'modular';

export interface CharacterInstance {
  object: Object3D;
  setAnim(name: 'idle' | 'walk', fadeS?: number): void;
  update(dt: number): void;
  dispose(): void;
  readonly isFallback: boolean;
}

export interface CharacterFactory { create(appearanceSeed: string): CharacterInstance }

/**
 * Postacie z dwóch paczek CC0 (Quaternius), każda jako JEDEN SkinnedMesh: 1 draw call w głównym przebiegu i 1 w cieniu na
 * postać, bez względu na liczbę części (korpus, oczy, brwi, włosy, ubranie, akcesorium). Fabryka scala siatki wariantu
 * (ciało + fryzura albo strój) w jedną geometrię z wagami skóry na wspólnym szkielecie. Geometria wariantu jest wspólna
 * dla wszystkich postaci; wygląd to paleta w materiale postaci (patrz fallbackCharacter.ts): wierzchołek ma tylko
 * współrzędną `region` (skóra, góra, dół, buty, włosy, brwi, oczy, akcesorium albo stały kolor części stroju).
 *
 * - ubc: nagie ciało bazowe, więc ubranie to region wyznaczony z wag kości (tułów i rękaw do połowy ramienia = góra,
 *   miednica i nogi = dół, stopy = buty, granica góry i dołu na wysokości pasa) + fryzura z osobnego pliku, przypięta
 *   do kości ciała po nazwie. Klipy z UAL (te same 65 kości), przeniesione na proporcje ciała: obroty jako różnica
 *   względem pozy spoczynkowej, z translacji tylko miednica (skalowana), bez skali (żeby nie zdejmować skali głowy i dłoni).
 * - modular: gotowe stroje na innym szkielecie (62 kości) z własnymi klipami. Tabela `OUTFIT_PAINT` mówi, który
 *   materiał stroju przejmuje kolor góry, dołu, butów, włosów i brwi; reszta (np. kask, kamizelka) zostaje oryginalna.
 */

type RegionName = keyof typeof REGION;

/** Siatka wariantu (tablice tylko do odczytu, współdzielone przez wszystkie postaci wariantu). */
interface Shared {
  count: number;
  position: Float32Array; normal: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array;
  index: Uint16Array | Uint32Array;
  region: Float32Array;
  /** Stałe kolory części stroju (regiony od FIXED_BASE), z PALETTE. */
  fixed: Color[];
}

interface Vertex { pos: Vector3; uv: Vector2 | null; joints: number[]; weights: number[] }
/** Region wierzchołka: liczba całkowita (czysty region) albo pośrednia na granicy dwóch sąsiednich regionów. */
type Painter = (v: Vertex) => number;

const flat = (region: number): Painter => () => region;

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

  /** Dokłada siatkę w przestrzeni bind szkieletu docelowego; `jointMap[j]` to indeks kości docelowej dla kości j siatki (−1: brak). */
  add(mesh: SkinnedMesh, jointMap: ArrayLike<number>, paint: Painter): void {
    const g = mesh.geometry;
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight'), uvAttr = g.getAttribute('uv');
    const bind = mesh.bindMatrix, normalMat = new Matrix3().getNormalMatrix(bind);
    const base = this.region.length;
    const v: Vertex = { pos: new Vector3(), uv: uvAttr ? new Vector2() : null, joints: [0, 0, 0, 0], weights: [0, 0, 0, 0] };
    const n = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.pos.fromBufferAttribute(pos, i).applyMatrix4(bind);
      n.fromBufferAttribute(nor, i).applyMatrix3(normalMat).normalize();
      if (v.uv) v.uv.set(uvAttr.getX(i), uvAttr.getY(i));
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const j = jointMap[si.getComponent(i, k)];
        const w = j >= 0 ? sw.getComponent(i, k) : 0;
        v.joints[k] = j >= 0 ? j : 0;
        v.weights[k] = w;
        sum += w;
      }
      if (sum > 0) for (let k = 0; k < 4; k++) v.weights[k] /= sum;
      this.position.push(v.pos.x, v.pos.y, v.pos.z);
      this.normal.push(n.x, n.y, n.z);
      this.skinIndex.push(...v.joints);
      this.skinWeight.push(...v.weights);
      this.region.push(paint(v));
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

// --- Szkielet, animacje, wariant ---------------------------------------------------------------------------------

const HEAD_RE = /^head$/i;
const HAND_RE = /^(hand|wrist)_?[lr]$/i;
const CHEST_RE = /^(spine_03|chest)$/i;

/** Szkielet wspólny dla wariantów jednej bryły: szablon węzłów bez siatek i dane skórowania. */
interface Rig {
  template: Object3D;
  boneNames: string[];
  boneInverses: Matrix4[];
  bindMatrix: Matrix4;
  nameToIndex: Map<string, number>;
}

interface Variant {
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
  /** Geometrie wariantu (z akcesorium albo bez), budowane przy pierwszym użyciu i współdzielone; nigdy nie zwalniane. */
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
    bindMatrix: skeletonOwner.bindMatrix,
    nameToIndex: new Map(boneNames.map((n, i) => [n, i])),
  };
}

function jointMapFor(mesh: SkinnedMesh, rig: Rig): number[] {
  return mesh.skeleton.bones.map((b) => rig.nameToIndex.get(b.name) ?? -1);
}

function bonesByName(root: Object3D): Map<string, Object3D> {
  const m = new Map<string, Object3D>();
  root.traverse((o) => { if ((o as { isBone?: boolean }).isBone) m.set(o.name, o); });
  return m;
}

/** Przesada proporcji Two Point: głowa i dłonie (z palcami) większe. Animacje nie mają ścieżek skali, więc to zostaje. */
function applyProportions(byName: Map<string, Object3D>): void {
  for (const [name, bone] of byName) {
    if (HEAD_RE.test(name)) bone.scale.setScalar(CHARACTER_STYLE.headScale);
    else if (HAND_RE.test(name)) bone.scale.setScalar(CHARACTER_STYLE.handScale);
  }
}

/** Najkrótsza (najzwyklejsza) nazwa klipu pasująca do wzorca, np. `Idle_Loop` przed `Idle_Talking_Loop`. */
function plainestClip(clips: AnimationClip[], pattern: RegExp): AnimationClip | undefined {
  return clips.filter((c) => pattern.test(c.name)).sort((a, b) => a.name.length - b.name.length || (a.name < b.name ? -1 : 1))[0];
}

/**
 * Klip UAL dla ciała UBC: obroty jako różnica względem pozy spoczynkowej UAL nałożona na pozę spoczynkową ciała,
 * z translacji tylko miednica (pomnożona przez stosunek długości), bez skali. Reszta ścieżek odpada.
 */
function retargetClip(src: AnimationClip, srcRest: Map<string, Object3D>, dstRest: Map<string, Object3D>): AnimationClip {
  const ratio = (dstRest.get('pelvis')?.position.length() ?? 1) / (srcRest.get('pelvis')?.position.length() || 1);
  const tracks: KeyframeTrack[] = [];
  const q = new Quaternion(), delta = new Quaternion(), srcInv = new Quaternion();
  for (const track of src.tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = track.name.slice(0, dot), prop = track.name.slice(dot + 1);
    const s = srcRest.get(bone), d = dstRest.get(bone);
    if (!s || !d) continue;
    if (prop === 'quaternion') {
      const out = new Float32Array(track.values.length);
      srcInv.copy(s.quaternion).invert();
      for (let i = 0; i < out.length; i += 4) {
        q.fromArray(track.values, i);
        delta.copy(srcInv).multiply(q);
        q.copy(d.quaternion).multiply(delta).toArray(out, i);
      }
      tracks.push(new QuaternionKeyframeTrack(track.name, track.times, out));
    } else if (prop === 'position' && bone === 'pelvis') {
      tracks.push(new VectorKeyframeTrack(track.name, track.times, track.values.map((x) => x * ratio)));
    }
  }
  return new AnimationClip(src.name, src.duration, tracks);
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

function finishVariant(acc: MeshAccumulator, rig: Rig, idle: AnimationClip, walk: AnimationClip): Variant {
  const shared = acc.finish();
  const find = (re: RegExp): number => rig.boneNames.findIndex((n) => re.test(n));
  return {
    shared, rig, idle, walk, ...measure(shared, rig, idle),
    chest: find(CHEST_RE),
    hands: { l: find(/^(hand|wrist)_?l$/i), r: find(/^(hand|wrist)_?r$/i) },
    geometries: new Map(),
  };
}

// --- Paczka ubc ---------------------------------------------------------------------------------------------------

/** Grupa koloru kości: 0 skóra, 1 góra, 2 dół, 3 buty, −1 ramię (rękaw kończy się w połowie ramienia). */
function boneGroup(name: string): number {
  if (/^(spine_\d+|clavicle_[lr])$/.test(name)) return 1;
  if (/^upperarm_[lr]$/.test(name)) return -1;
  if (/^(pelvis|thigh_[lr]|calf_[lr])$/.test(name)) return 2;
  if (/^(foot_[lr]|ball_)/.test(name)) return 3;
  return 0;
}

/**
 * Ciało UBC: region z wag kości na łańcuchu skóra (2) – góra (3) – dół (4) – buty (5) jako średnia ważona indeksu, więc
 * granice to izolinie wag (szyja, kostka), rękaw kończy się w połowie ramienia (położenie wzdłuż ramienia), a góra i dół
 * rozdziela pozioma linia na wysokości pasa. Wszystkie te pola są liniowe, więc krawędzie wychodzą gładkie.
 */
function bodyPainter(rig: Rig): Painter {
  const groups = rig.boneNames.map(boneGroup);
  const jointPos = (name: string): Vector3 =>
    new Vector3().setFromMatrixPosition(rig.boneInverses[rig.nameToIndex.get(name) ?? 0].clone().invert());
  const arm = { l: [jointPos('upperarm_l'), jointPos('lowerarm_l')], r: [jointPos('upperarm_r'), jointPos('lowerarm_r')] };
  const waist = jointPos('pelvis').y + 0.06;
  const w = [0, 0, 0, 0], axis = new Vector3(), rel = new Vector3();
  return (v) => {
    w.fill(0);
    for (let k = 0; k < 4; k++) {
      const wt = v.weights[k];
      if (wt <= 0) continue;
      const g = groups[v.joints[k]];
      if (g >= 0) { w[g] += wt; continue; }
      const [from, to] = rig.boneNames[v.joints[k]].endsWith('_l') ? arm.l : arm.r;
      axis.subVectors(to, from);
      const along = rel.subVectors(v.pos, from).dot(axis) / axis.lengthSq();
      const sleeve = MathUtils.clamp(0.5 + (0.56 - along) / 0.12, 0, 1); // 0,5 w połowie ramienia
      w[1] += wt * sleeve;
      w[0] += wt * (1 - sleeve);
    }
    const clothed = w[1] + w[2];
    const above = MathUtils.clamp(0.5 + (v.pos.y - waist) / 0.12, 0, 1); // 0,5 na wysokości pasa
    w[1] = clothed * above;
    w[2] = clothed * (1 - above);
    const sum = w[0] + w[1] + w[2] + w[3];
    return REGION.skin + (sum > 0 ? (w[1] + 2 * w[2] + 3 * w[3]) / sum : 0);
  };
}

/** Oczy UBC: środek tęczówki w UV to wierzchołek najbardziej wysunięty do przodu (osobno dla każdego oka). */
function eyePainter(eyes: SkinnedMesh): Painter {
  const pos = eyes.geometry.getAttribute('position'), uv = eyes.geometry.getAttribute('uv');
  const centre = [new Vector2(0.5, 0.5), new Vector2(0.5, 0.5)];
  const front = [-Infinity, -Infinity];
  for (let i = 0; i < pos.count; i++) {
    const side = pos.getX(i) < 0 ? 0 : 1;
    if (pos.getZ(i) > front[side]) { front[side] = pos.getZ(i); centre[side].set(uv.getX(i), uv.getY(i)); }
  }
  // łańcuch tęczówka (0) – białko (1) – powieka w kolorze skóry (2); progi w UV: tęczówka ≈ 0,12, białko ≈ 0,3 od środka
  return (v) => {
    const d = v.uv!.distanceTo(centre[v.pos.x < 0 ? 0 : 1]);
    return d < 0.21 ? MathUtils.clamp(0.5 + (d - 0.12) * (0.5 / 0.09), 0, 1) : MathUtils.clamp(1 + (d - 0.21) * (0.5 / 0.09), 1, 2);
  };
}

interface Source {
  /** Wybiera wariant dla wyglądu; `rng` służy do wyboru stroju. */
  variantFor(a: Appearance, rng: ReturnType<typeof createRng>): Variant;
}

type Loader = typeof loadGLB;

/** Wczytuje pliki; nieudane dają null (i jedno ostrzeżenie na całość), bez rzucania. */
async function loadAll(load: Loader, urls: string[]): Promise<(GLTF | null)[]> {
  const failed: string[] = [];
  let reason: unknown;
  const out = await Promise.all(urls.map((url) =>
    Promise.resolve().then(() => load(url)).catch((error: unknown) => { failed.push(url); reason ??= error; return null; })));
  if (failed.length) console.warn(`Postacie: nie wczytano ${failed.length} z ${urls.length} plików (${failed.join(', ')}).`, reason);
  return out;
}

async function buildUbc(load: Loader): Promise<Source | null> {
  const { male, female, hair } = ASSETS.characters.ubc;
  const [maleGltf, femaleGltf, ual, ...hairGltfs] = await loadAll(load, [male, female, ASSETS.characters.animations, ...hair]);
  if (!ual) return null;

  const ualRest = bonesByName(ual.scene);
  const variants = new Map<string, Variant>();
  for (const [gender, gltf] of [['male', maleGltf], ['female', femaleGltf]] as const) {
    if (!gltf) continue;
    const meshes = skinnedMeshesOf(gltf.scene);
    const body = meshes.filter((m) => !/eye/i.test(m.name)).sort((a, b) => b.geometry.getAttribute('position').count - a.geometry.getAttribute('position').count)[0];
    const eyes = meshes.find((m) => /^eyes?$/i.test(m.name));
    const brows = meshes.find((m) => /eyebrow/i.test(m.name));
    if (!body) continue;
    const rig = extractRig(gltf.scene, body);
    const dstRest = bonesByName(rig.template);
    const idleSrc = plainestClip(ual.animations, /^idle/i), walkSrc = plainestClip(ual.animations, /^walk/i);
    if (!idleSrc || !walkSrc) continue;
    const idle = retargetClip(idleSrc, ualRest, dstRest), walk = retargetClip(walkSrc, ualRest, dstRest);

    const build = (hairMesh: SkinnedMesh | null): Variant => {
      const acc = new MeshAccumulator();
      acc.add(body, jointMapFor(body, rig), bodyPainter(rig));
      if (eyes) acc.add(eyes, jointMapFor(eyes, rig), eyePainter(eyes));
      if (brows) acc.add(brows, jointMapFor(brows, rig), flat(REGION.brow));
      if (hairMesh) acc.add(hairMesh, jointMapFor(hairMesh, rig), flat(REGION.hair));
      return finishVariant(acc, rig, idle, walk);
    };
    variants.set(`${gender}:none`, build(null));
    hairGltfs.forEach((h, i) => {
      const hairMesh = h && skinnedMeshesOf(h.scene)[0];
      if (hairMesh) variants.set(`${gender}:${i}`, build(hairMesh));
    });
  }
  if (variants.size === 0) return null;
  return {
    variantFor: (a) => variants.get(`${a.body}:${a.hairIndex}`) ?? variants.get(`${a.body}:none`) ?? [...variants.values()][0],
  };
}

// --- Paczka modular -----------------------------------------------------------------------------------------------

/**
 * Które materiały stroju przejmują kolory z `Appearance`: „część:materiał=region”, część to koniec nazwy węzła
 * (body, legs, pants, feet, head). Skóra (`Skin*`) zawsze jest skórą. Materiały spoza tabeli (kask, kamizelka,
 * krawat, podeszwy, kolczyki) zostają w oryginalnym kolorze. Część `pistol` (broń w stroju Suit) jest pomijana.
 */
const OUTFIT_PAINT: Record<string, string> = {
  'men-casual-hoodie': 'body:Purple=top feet:Purple=shoes legs:LightBlue=bottom head:Eyebrows=brow head:Eye=eyeDark head:Hair=hair',
  'men-casual-2': 'body:LightBrown=top feet:Red_Dark=shoes legs:LightBlue=bottom head:Skin_Darker=skin head:Eyebrows=brow head:Eye=eyeDark head:Hair=hair',
  'men-suit': 'body:Suit=top body:Tie=bottom legs:Suit=bottom feet:Black=shoes head:Eyebrows=brow head:Eye=eyeDark head:Hair=hair',
  'men-worker': 'body:LightBrown=top legs:Brown=bottom feet:Black=shoes head:Eyebrows=brow head:Moustache=brow head:Eye=eyeDark',
  'men-farmer': 'body:Brown=top body:LightBlue=bottom pants:LightBlue=bottom feet:Brown=shoes head:Eyebrows=brow head:Eye=eyeDark',
  'men-beach': 'body:LightBrown=top legs:Red_Dark=bottom feet:Red_Dark=shoes head:Eyebrows=brow head:Eye=eyeDark head:Hair=hair',
  'men-punk': 'body:White=top legs:LightBlue=bottom feet:Black=shoes head:Red=hair head:Red_Dark=brow head:Eyebrows=brow head:Eye=eyeDark',
  'women-casual': 'body:White=top legs:Orange=bottom feet:Grey=shoes head:Hair_Blond=hair head:Hair_Brown=brow head:Brown=eyeDark',
  'women-suit': 'body:Black=top legs:Black=bottom feet:Black=shoes head:Hair_Blond=hair head:Hair_Brown=brow head:Brown=eyeDark',
  'women-formal': 'body:LimeGreen=top legs:LimeGreen=top feet:Red=shoes head:Red=hair head:Brown=brow',
  'women-worker': 'body:White=top legs:Brown2=bottom feet:Black=shoes head:DarkBrown=hair head:Brown=eyeDark',
  'women-punk': 'body:Pink=top legs:Black=bottom feet:Black=shoes head:Pink=hair head:Hair_Brown=brow head:Brown=eyeDark',
};

function outfitTable(file: string): Map<string, number> {
  const table = new Map<string, number>();
  for (const rule of (OUTFIT_PAINT[file] ?? '').split(' ').filter(Boolean)) {
    const [key, region] = rule.split('=');
    table.set(key, REGION[region as RegionName]);
  }
  return table;
}

/** Część stroju z nazwy węzła (albo jego przodków), np. `Punk_Head_1` → `head`. */
function outfitPart(mesh: Object3D): string | undefined {
  for (let o: Object3D | null = mesh; o; o = o.parent) {
    const m = /(body|legs|pants|feet|head|pistol)(_\d+)?$/i.exec(o.name);
    if (m) return m[1].toLowerCase();
  }
  return undefined;
}

async function buildModular(load: Loader): Promise<Source | null> {
  const files = ASSETS.characters.modular;
  const gltfs = await loadAll(load, files);
  const byBody: Record<Appearance['body'], Variant[]> = { male: [], female: [] };
  files.forEach((url, i) => {
    const gltf = gltfs[i];
    if (!gltf) return;
    const file = url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
    const idle = plainestClip(gltf.animations, /idle/i), walk = plainestClip(gltf.animations, /walk/i);
    const meshes = skinnedMeshesOf(gltf.scene).filter((m) => outfitPart(m) !== 'pistol');
    if (!idle || !walk || meshes.length === 0) return;
    const rig = extractRig(gltf.scene, meshes[0]);
    const table = outfitTable(file);
    const acc = new MeshAccumulator();
    for (const mesh of meshes) {
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
      const region = /^skin/i.test(mat.name) ? REGION.skin : table.get(`${outfitPart(mesh)}:${mat.name}`) ?? acc.fixedRegion(mat.color);
      acc.add(mesh, jointMapFor(mesh, rig), flat(region));
    }
    byBody[file.startsWith('women-') ? 'female' : 'male'].push(finishVariant(acc, rig, idle, walk));
  });
  const all = [...byBody.male, ...byBody.female];
  if (all.length === 0) return null;
  return { variantFor: (a, rng) => rng.pick(byBody[a.body].length ? byBody[a.body] : all) };
}

// --- Akcesoria i geometria wariantu --------------------------------------------------------------------------------------

interface Parts { position: number[]; normal: number[]; index: number[]; skinIndex: number[]; skinWeight: number[]; region: number[] }
type Side = 'l' | 'r';

/** Dokłada zaokrąglone pudełko (w układzie `frame`, czyli przestrzeni bind kości) przypięte do kości z wagą 1. */
function addBox(out: Parts, bone: number, frame: Matrix4, size: Vector3, at: Vector3, region: number): void {
  const g = new RoundedBoxGeometry(size.x, size.y, size.z, 1, Math.min(BEVEL.small * 2, 0.4 * Math.min(size.x, size.y, size.z)));
  g.translate(at.x, at.y, at.z).applyMatrix4(frame);
  const base = out.position.length / 3;
  out.position.push(...g.getAttribute('position').array);
  out.normal.push(...g.getAttribute('normal').array);
  const n = g.getAttribute('position').count;
  const idx = g.index;
  for (let i = 0, count = idx ? idx.count : n; i < count; i++) out.index.push(base + (idx ? idx.getX(i) : i));
  for (let i = 0; i < n; i++) {
    out.skinIndex.push(bone, 0, 0, 0);
    out.skinWeight.push(1, 0, 0, 0);
    out.region.push(region);
  }
  g.dispose();
}

/**
 * Plecak (na plecach, układ świata w pozie bind), torba (wisi na dłoni) albo telefon (w dłoni). Przypięte sztywno do kości,
 * więc ruszają się z postacią, i scalone z jej siatką (0 dodatkowych draw calls). Dłonie są powiększone o `handScale`, więc
 * przedmioty w układzie dłoni są pomniejszone o tyle samo. Kolory z regionów `accent` i `accent2` palety postaci.
 */
function accessoryParts(kind: Exclude<Appearance['accessory'], 'none'>, v: Variant, side: Side): Parts | null {
  const out: Parts = { position: [], normal: [], index: [], skinIndex: [], skinWeight: [], region: [] };
  const world = (bone: number): Matrix4 => v.rig.boneInverses[bone].clone().invert();
  if (kind === 'backpack') {
    if (v.chest < 0) return null;
    const frame = new Matrix4().makeTranslation(new Vector3().setFromMatrixPosition(world(v.chest)));
    addBox(out, v.chest, frame, new Vector3(0.32, 0.38, 0.15), new Vector3(0, -0.04, -0.19), REGION.accent);
    addBox(out, v.chest, frame, new Vector3(0.22, 0.14, 0.06), new Vector3(0, -0.14, -0.29), REGION.accent2);
    return out;
  }
  const bone = v.hands[side];
  if (bone < 0) return null;
  const k = 1 / CHARACTER_STYLE.handScale;
  const frame = world(bone).multiply(new Matrix4().makeScale(k, k, k));
  if (kind === 'bag') {
    addBox(out, bone, frame, new Vector3(0.1, 0.27, 0.22), new Vector3(0, 0.23, 0), REGION.accent);
    addBox(out, bone, frame, new Vector3(0.11, 0.07, 0.23), new Vector3(0, 0.3, 0), REGION.accent2);
    addBox(out, bone, frame, new Vector3(0.03, 0.1, 0.03), new Vector3(0, 0.12, 0), REGION.accent2);
  } else {
    addBox(out, bone, frame, new Vector3(0.02, 0.17, 0.09), new Vector3(0.03, 0.1, 0), REGION.accent);
  }
  return out;
}

/** Geometria wariantu z akcesorium (albo bez), z cache: wspólna dla wszystkich postaci o tym samym wariancie i akcesorium. */
function variantGeometry(v: Variant, kind: Appearance['accessory'], side: Side): BufferGeometry {
  const key = kind === 'none' || kind === 'backpack' ? kind : `${kind}:${side}`;
  const hit = v.geometries.get(key);
  if (hit) return hit;
  const { shared } = v;
  const extra = kind === 'none' ? null : accessoryParts(kind, v, side);
  const cat = <T extends Float32Array | Uint16Array>(base: T, more: ArrayLike<number> | undefined): T => {
    if (!more) return base;
    const out = new (base.constructor as new (n: number) => T)(base.length + more.length);
    out.set(base);
    out.set(more, base.length);
    return out;
  };
  const n = shared.count + (extra ? extra.region.length : 0);
  const index = new (n > 65535 ? Uint32Array : Uint16Array)(shared.index.length + (extra ? extra.index.length : 0));
  index.set(shared.index);
  if (extra) index.set(extra.index.map((i) => i + shared.count), shared.index.length);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(cat(shared.position, extra?.position), 3));
  geometry.setAttribute('normal', new BufferAttribute(cat(shared.normal, extra?.normal), 3));
  geometry.setAttribute('skinIndex', new BufferAttribute(cat(shared.skinIndex, extra?.skinIndex), 4));
  geometry.setAttribute('skinWeight', new BufferAttribute(cat(shared.skinWeight, extra?.skinWeight), 4));
  geometry.setAttribute('region', new BufferAttribute(cat(shared.region, extra?.region), 1));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere(); // z pozy bind (T-pose): obejmuje postać w każdej animacji
  v.geometries.set(key, geometry);
  return geometry;
}

// --- Postać ---------------------------------------------------------------------------------------------------------

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
  mesh.bind(skeleton, rig.bindMatrix);
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
      material.dispose(); // geometria jest wspólna wariantu, więc zostaje
      root.removeFromParent();
    },
  };
}

/**
 * Fabryka postaci dla paczki. Wczytuje (i buduje warianty) z góry, więc `create` jest synchroniczne i tanie.
 * Gdy modele się nie wczytają (404, uszkodzone pliki), zwraca fabrykę postaci zastępczych (kapsuła + kula) i nie rzuca;
 * pojedyncze brakujące pliki (fryzura, jeden strój) są pomijane z ostrzeżeniem.
 */
export async function createCharacterFactory(pack: CharacterPack, load: typeof loadGLB = loadGLB): Promise<CharacterFactory> {
  let source: Source | null = null;
  try {
    source = await (pack === 'ubc' ? buildUbc(load) : buildModular(load));
  } catch (error) {
    console.warn(`Postacie (${pack}): nie udało się zbudować modeli.`, error);
  }
  const fallback = (seed: string): CharacterInstance => createFallbackCharacter(pickAppearance(seed));
  if (!source) {
    console.warn(`Postacie (${pack}): używam postaci zastępczych.`);
    return { create: fallback };
  }
  const src = source;
  return {
    create(seed) {
      try {
        const a = pickAppearance(seed);
        return assemble(src.variantFor(a, createRng(subSeed(seed, 'outfit'))), a, seed);
      } catch (error) {
        console.warn('Postacie: nie udało się zbudować postaci, używam zastępczej.', error);
        return fallback(seed);
      }
    },
  };
}
