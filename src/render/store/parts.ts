import {
  CanvasTexture,
  CylinderGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CELL_SIZE_M } from '@/sim/grid';
import { createRng, subSeed } from '@/sim/rng';
import type { Facing, Fixture } from '@/sim/store/types';
import { BEVEL, PALETTE, material } from '@/render/style';

/**
 * Wspólne klocki budowniczych mebli i powłoki sklepu: zaokrąglone bryły z fazą wg docs/style-guide.md §1,
 * kolory/materiały z PALETTE, tekstury z canvasu (z atrapą w Node, ruling R4) i układ kanoniczny mebla.
 *
 * Geometrie, tekstury i materiały z tekstur są współdzielone w całym procesie (jak materiały w style.ts):
 * nie zmieniaj ich i nie zwalniaj. Zwalnia się wyłącznie to, co `buildStore` sam stworzył (scalone geometrie).
 */

export type Vec3 = [number, number, number];
export const M = CELL_SIZE_M;

export type Category = keyof typeof PALETTE.productCategory;
export const CATEGORY_LABEL: Record<Category, string> = {
  napoje: 'NAPOJE', nabial: 'NABIAŁ', slodycze: 'SŁODYCZE', przekaski: 'PRZEKĄSKI', pieczywo: 'PIECZYWO',
  chemia: 'CHEMIA', alkohol: 'ALKOHOL',
};

/** Półka do wypełnienia towarem (Task 9) w układzie `root` mebla (origin w lewym-przednim rogu footprintu). */
export interface ShelfSlotLocal {
  /** Środek górnej powierzchni najniższej półki (m). */
  position: Vec3;
  /** Długość półki wzdłuż osi `rotationY` (lokalne +x po obrocie), m. */
  width: number;
  /** Głębokość półki (lokalne +z po obrocie to kierunek „do klienta”), m. */
  depth: number;
  levels: number;
  /** Odstęp pionowy między półkami, m. */
  levelStep: number;
  /** Obrót wokół osi y: lokalne +x półki → oś długości, lokalne +z → w stronę klienta. */
  rotationY: number;
  category: Category;
}

// --- Kolory i materiały ----------------------------------------------------------------------------

export const BRAND = PALETTE.brand;
export const FIX = PALETTE.fixture;
/** Szkło: blady błękit z PALETTE (kategoria nabiał), przy domyślnej przezroczystości 0,28. */
export const GLASS_TINT = PALETTE.productCategory.nabial[2];
/** Ekrany (docs/style-guide.md §4). */
export const SCREEN_COLOR = '#8fd3ff';

export const matte = (c: string): Material => material('plasticMatte', c);
export const gloss = (c: string): Material => material('plasticGloss', c);
export const painted = (c: string): Material => material('metalPainted', c);
export const woodMat = (c: string): Material => material('wood', c);
export const fabricMat = (c: string): Material => material('fabric', c);
export const glassMat = (): Material => material('glass', GLASS_TINT);
export const glow = (c: string, intensity: number): Material => material('emissive', c, { emissiveIntensity: intensity });

// --- Bryły ------------------------------------------------------------------------------------------

export interface PartOpts {
  cast?: boolean;
  receive?: boolean;
  /** Nadpisuje liczbę segmentów fazy (domyślnie z reguły przewodnika stylu). */
  seg?: number;
  /** Nadpisuje promień fazy w metrach. */
  radius?: number;
  rot?: Vec3;
  name?: string;
}

/** Faza wg przewodnika §1: medium (3 seg.) od 10 cm najmniejszego wymiaru, small (2) dla cieńszych, <3 cm: min(small, 0,4·wymiar), drobiazgi <5 cm: 1 seg. */
export function bevelFor(w: number, h: number, d: number): { segments: number; radius: number } {
  const min = Math.min(w, h, d);
  if (Math.max(w, h, d) < 0.05) return { segments: 1, radius: Math.min(BEVEL.small, 0.4 * min) };
  if (min >= 0.1) return { segments: 3, radius: BEVEL.medium };
  if (min >= 0.03) return { segments: 2, radius: BEVEL.small };
  return { segments: 1, radius: Math.min(BEVEL.small, 0.4 * min) };
}

const geometryCache = new Map<string, BufferGeometry>();
const cached = <G extends BufferGeometry>(key: string, make: () => G): G => {
  let g = geometryCache.get(key) as G | undefined;
  if (!g) { g = make(); geometryCache.set(key, g); }
  return g;
};
const k = (n: number): string => n.toFixed(4);

export function roundedBoxGeometry(w: number, h: number, d: number, seg?: number, radius?: number): BufferGeometry {
  const auto = bevelFor(w, h, d);
  const s = seg ?? auto.segments;
  const r = radius ?? auto.radius;
  return cached(`box|${k(w)}|${k(h)}|${k(d)}|${s}|${k(r)}`, () => new RoundedBoxGeometry(w, h, d, s, r));
}

function flags(mesh: Mesh, mat: Material, o: PartOpts): void {
  const solid = !mat.transparent;
  mesh.castShadow = o.cast ?? solid;
  mesh.receiveShadow = o.receive ?? solid;
  if (o.name) mesh.name = o.name;
  if (o.rot) mesh.rotation.set(...o.rot);
}

/** Zaokrąglona bryła. `at` = [środek x, SPÓD y, środek z]. */
export function box(parent: Object3D, size: Vec3, at: Vec3, mat: Material, o: PartOpts = {}): Mesh {
  const mesh = new Mesh(roundedBoxGeometry(size[0], size[1], size[2], o.seg, o.radius), mat);
  mesh.position.set(at[0], at[1] + size[1] / 2, at[2]);
  flags(mesh, mat, o);
  parent.add(mesh);
  return mesh;
}

/** Walec (oś y, z `rot` dowolna). `at` = ŚRODEK bryły. `rTop` pozwala zrobić stożek ściętym (kubek, lejek). */
export function cyl(parent: Object3D, r: number, h: number, at: Vec3, mat: Material, o: PartOpts & { rTop?: number; segs?: number } = {}): Mesh {
  const segs = o.segs ?? 14;
  const geo = cached(`cyl|${k(r)}|${k(o.rTop ?? r)}|${k(h)}|${segs}`, () => new CylinderGeometry(o.rTop ?? r, r, h, segs));
  const mesh = new Mesh(geo, mat);
  mesh.position.set(...at);
  flags(mesh, mat, { cast: o.cast, receive: o.receive, rot: o.rot, name: o.name });
  parent.add(mesh);
  return mesh;
}

/** Płaszczyzna zwrócona w +z (obrót `rot` ją przekręca). `at` = środek. `uv` skaluje współrzędne tekstury (powtarzanie). */
export function plane(parent: Object3D, size: [number, number], at: Vec3, mat: Material, o: PartOpts & { uv?: [number, number] } = {}): Mesh {
  const uv = o.uv ?? [1, 1];
  const geo = cached(`plane|${k(size[0])}|${k(size[1])}|${k(uv[0])}|${k(uv[1])}`, () => {
    const g = new PlaneGeometry(size[0], size[1]);
    if (uv[0] !== 1 || uv[1] !== 1) {
      const a = g.attributes.uv!;
      for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * uv[0], a.getY(i) * uv[1]);
    }
    return g;
  });
  const mesh = new Mesh(geo, mat);
  mesh.position.set(...at);
  flags(mesh, mat, { cast: o.cast ?? false, receive: o.receive ?? false, rot: o.rot, name: o.name });
  parent.add(mesh);
  return mesh;
}

// --- Tekstury z canvasu -----------------------------------------------------------------------------

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

/** 1×1 biała atrapa tekstury na czas testów w Node, gdzie nie ma `document` (ruling R4). */
export function placeholderTexture(): DataTexture {
  const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function canvasTexture(w: number, h: number, draw: Draw, repeat = false): CanvasTexture | DataTexture {
  if (typeof document === 'undefined') return placeholderTexture();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

const textureCache = new Map<string, Texture>();
export function cachedTexture(key: string, make: () => Texture): Texture {
  let t = textureCache.get(key);
  if (!t) { t = make(); textureCache.set(key, t); }
  return t;
}

const FONT = '"Trebuchet MS", "Segoe UI", system-ui, Arial, sans-serif';
export const font = (px: number, weight = 'bold'): string => `${weight} ${px}px ${FONT}`;

/** Łamie tekst na linie o szerokości ≤ maxWidth (w bieżącej czcionce kontekstu). */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Tabliczka: kremowe tło, pomarańczowa obwódka, ciemnozielony napis (linie po `\n`). Nadstawki, wyceny, szyldziki. */
export function plateTexture(text: string): Texture {
  return cachedTexture(`plate|${text}`, () => canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = BRAND.cream;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = BRAND.orange;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = BRAND.greenDark;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = text.split('\n');
    const px = lines.length > 1 ? 24 : 34;
    ctx.font = font(px);
    // zmniejsz czcionkę, jeśli najdłuższa linia się nie mieści
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest > w - 24) ctx.font = font(Math.floor((px * (w - 24)) / widest));
    lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (px + 2)));
  }));
}

/** Pasek cenówek (kremowe kartoniki z cenami rozdzielone pomarańczowymi szczelinami), powtarzalny co 1 m. */
export function priceStripTexture(): Texture {
  return cachedTexture('priceStrip', () => canvasTexture(512, 32, (ctx, w, h) => {
    ctx.fillStyle = BRAND.orange;
    ctx.fillRect(0, 0, w, h);
    const prices = ['4,99', '2,49', '7,89', '3,29', '12,99', '5,49', '1,99', '8,79'];
    const tag = w / prices.length;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    prices.forEach((p, i) => {
      ctx.fillStyle = BRAND.cream;
      ctx.fillRect(i * tag + 3, 3, tag - 6, h - 6);
      ctx.fillStyle = PALETTE.wall[4];
      ctx.font = font(20);
      ctx.fillText(p, i * tag + tag / 2, h / 2 + 1);
    });
  }, true));
}

const texturedCache = new Map<string, MeshStandardMaterial>();
export interface TexturedOpts {
  roughness?: number;
  metalness?: number;
  emissiveMap?: Texture;
  emissive?: string;
  emissiveIntensity?: number;
}
/** Materiał z mapą koloru, współdzielony po `name`. */
export function texturedMaterial(name: string, map: Texture, o: TexturedOpts = {}): MeshStandardMaterial {
  let m = texturedCache.get(name);
  if (!m) {
    m = makeTextured(name, map, o);
    texturedCache.set(name, m);
  }
  return m;
}
/** To samo bez cache: dla zasobów tworzonych per sklep (szyld, podłoga), które sklep sam zwalnia. */
export function makeTextured(name: string, map: Texture, o: TexturedOpts = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ name, map, roughness: o.roughness ?? 0.7, metalness: o.metalness ?? 0 });
  if (o.emissiveMap) {
    m.emissiveMap = o.emissiveMap;
    m.emissive.set(o.emissive ?? BRAND.cream);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  return m;
}

// --- Cenówki, nadstawki ----------------------------------------------------------------------------

/** Listwa cenowa na krawędzi półki: pomarańczowy profil + kremowy pasek cenówek. `z` = przód półki, `dir` = +1 / −1 (strona). */
export function priceRail(parent: Object3D, length: number, x: number, y: number, z: number, dir: 1 | -1): void {
  box(parent, [length, 0.045, 0.03], [x, y, z - dir * 0.015], gloss(BRAND.orange));
  const mat = texturedMaterial('priceStrip', priceStripTexture(), { roughness: 0.4 });
  plane(parent, [length, 0.03], [x, y + 0.0225, z + dir * 0.0015], mat, { uv: [length, 1], rot: [0, dir === 1 ? 0 : Math.PI, 0] });
}

/** Kremowa tabliczka z napisem (kategoria, cena) zwrócona w +z lub −z. */
export function plateSign(parent: Object3D, text: string, size: [number, number], at: Vec3, dir: 1 | -1 = 1): void {
  plane(parent, size, at, texturedMaterial(`plate|${text}`, plateTexture(text), { roughness: 0.45 }), { rot: [0, dir === 1 ? 0 : Math.PI, 0] });
}

// --- Układ kanoniczny mebla --------------------------------------------------------------------------

const ROT: Record<Facing, number> = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

export interface FixtureFrame {
  /** Zwracany obiekt: nazwany `id`, origin w lewym-przednim rogu footprintu (min x, min z), osie +x/+z. */
  root: Group;
  /** Układ kanoniczny: origin = środek footprintu na podłodze, oś x = długość, +z = front (strona klienta). */
  inner: Group;
  length: number;
  depth: number;
  rotY: number;
  /** Punkt układu kanonicznego → układ `root`. */
  toRoot(p: Vec3): Vec3;
}

export function fixtureFrame(f: Fixture): FixtureFrame {
  const root = new Group();
  root.name = f.id;
  root.userData = { fixtureId: f.id, kind: f.kind };
  const horizontal = f.facing === 'N' || f.facing === 'S';
  const rotY = ROT[f.facing];
  const cx = (f.w * M) / 2;
  const cz = (f.d * M) / 2;
  const inner = new Group();
  inner.rotation.y = rotY;
  inner.position.set(cx, 0, cz);
  root.add(inner);
  const sin = Math.sin(rotY);
  const cos = Math.cos(rotY);
  return {
    root,
    inner,
    length: (horizontal ? f.w : f.d) * M,
    depth: (horizontal ? f.d : f.w) * M,
    rotY,
    toRoot: ([x, y, z]) => [cx + x * cos + z * sin, y, cz - x * sin + z * cos],
  };
}

/** Rozmieszcza `count` punktów równomiernie w [−half, +half] (środki równych przedziałów). */
export function spread(count: number, half: number): number[] {
  return Array.from({ length: count }, (_, i) => -half + ((i + 0.5) * 2 * half) / count);
}

// --- Kategorie towaru ----------------------------------------------------------------------------------

/** Deterministyczny dobór kategorii dla mebla: te same (seed, id) dają te same kategorie; `n` różnych z `pool`. */
export function pickCategories(seed: string, id: string, pool: readonly Category[], n: number): Category[] {
  const rng = createRng(subSeed(seed, `kategoria:${id}`));
  return rng.shuffle(pool).slice(0, n);
}
