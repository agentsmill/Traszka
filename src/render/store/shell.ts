import { Group, Vector3, type Texture } from 'three';
import { createRng, subSeed, type Rng } from '@/sim/rng';
import type { Cell } from '@/sim/grid';
import { FRONT_WALL_Y, type CellType, type StoreLayout } from '@/sim/store/types';
import { cellToWorld } from '@/render/coords';
import { PALETTE } from '@/render/style';
import {
  BRAND, FIX, M, box, cachedTexture, canvasTexture, cyl, fabricMat, font, glassMat, glow, gloss, makeTextured, matte, painted,
  plane, texturedMaterial, wrapLines, woodMat, type Vec3,
} from './parts';
import { BACKROOM_DOOR_H, DOOR_WALL_T } from './fixtures/backroomDoor';
import { SIGN_ASPECT, drawNewt, makeSignGlowTexture, makeSignTexture } from './signTexture';

/**
 * Powłoka sklepu: podłoga z płytek i fugą, ściany z oknami, szyldem i wejściem, lampy sufitowe (bez stropu),
 * plakaty, mata, zaplecze. Ściany są złożone z trzech grup, żeby przekrój (cutaway) mógł je obniżać do 0,5 m:
 * `low` (boazeria 0–0,48 m, zawsze), `high` (od 0,48 m do sufitu, znika w przekroju) i `cap` (przekrój wierzchu
 * ściętej ściany `wall[4]`, widoczny tylko w przekroju). Układ ściany: u wzdłuż ściany, v w głąb ściany od jej
 * wewnętrznego lica (v ≤ 0 to bryła muru, v > 0 to wnętrze).
 */

export type WallSide = 'front' | 'back' | 'left' | 'right' | 'mid';
export const WALL_SIDES: readonly WallSide[] = ['front', 'back', 'left', 'right', 'mid'];

export const WALL_H = 3.2;
export const WALL_T = DOOR_WALL_T;
export const WAINSCOT_H = 0.48;
export const CAP_H = 0.02;
/** Wysokość, do której obniża się ściana od strony kamery. */
export const CUTAWAY_H = WAINSCOT_H + CAP_H;
const STRIPE_H = 0.45;
const SILL = 0.9;
const GLASS_TOP = 2.55;
const ENTRANCE_H = 2.3;
const LAMP_Y = 2.7;

export interface WallParts { low: Group; cap: Group; high: Group }
export interface Shell {
  walls: Record<WallSide, WallParts>;
  /** Podłogi, maty, zaplecze: zawsze widoczne. */
  floor: Group;
  /** Pręty i oprawy lamp. */
  ceiling: Group;
  /** Świecące panele lamp (jeden materiał, żeby dzień/noc przełączało jedno podmienienie). */
  lamps: Group;
  lampPositions: Vector3[];
  /** Zasoby stworzone dla tego sklepu (szyld), które zwalnia `dispose()`. */
  disposables: { dispose(): void }[];
}

// --- Tekstury ----------------------------------------------------------------------------------------

/** Płytki z fugą: 4×4 płytki po 0,5 m (powtarzane co 2 m), delikatne różnice odcieni, fazowanie krawędzi. */
function tileTexture(name: string, base: string, grout: string): Texture {
  return cachedTexture(`tile|${name}`, () => canvasTexture(512, 512, (ctx, w, h) => {
    const tile = w / 4;
    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, w, h);
    let s = 12345;
    const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        const x = tx * tile + 3;
        const y = ty * tile + 3;
        const size = tile - 6;
        ctx.fillStyle = base;
        ctx.fillRect(x, y, size, size);
        const v = rnd();
        ctx.fillStyle = v > 0.5 ? BRAND.cream : PALETTE.wall[4];
        ctx.globalAlpha = Math.abs(v - 0.5) * 0.14;
        ctx.fillRect(x, y, size, size);
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = BRAND.cream;
        ctx.fillRect(x, y, size, 3);
        ctx.fillRect(x, y, 3, size);
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = PALETTE.wall[4];
        ctx.fillRect(x, y + size - 3, size, 3);
        ctx.fillRect(x + size - 3, y, 3, size);
        ctx.globalAlpha = 1;
      }
    }
  }, true));
}

function foilTexture(): Texture {
  return cachedTexture('foil', () => canvasTexture(384, 416, (ctx, w, h) => {
    ctx.fillStyle = BRAND.orange;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = BRAND.cream;
    ctx.globalAlpha = 0.18;
    for (let i = -h; i < w; i += 56) {            // ukośne pasy w tle
      ctx.beginPath();
      ctx.moveTo(i, h);
      ctx.lineTo(i + 28, h);
      ctx.lineTo(i + 28 + h, 0);
      ctx.lineTo(i + h, 0);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // gwiazda promocji
    ctx.fillStyle = BRAND.cream;
    ctx.beginPath();
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r = i % 2 ? 88 : 112;
      ctx.lineTo(w / 2 + Math.cos(a) * r, 130 + Math.sin(a) * r);
    }
    ctx.fill();
    ctx.fillStyle = BRAND.orange;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(84, '900');
    ctx.fillText('-30%', w / 2, 132);
    ctx.fillStyle = BRAND.green;
    ctx.fillRect(0, 270, w, 84);
    ctx.fillStyle = BRAND.cream;
    ctx.font = font(46, '900');
    ctx.fillText('3 W CENIE 3!', w / 2, 312);
    ctx.fillStyle = BRAND.greenDark;
    ctx.font = font(34, '900');
    ctx.fillText('PROMOCJA', w / 2, 386);
  }, true));
}

function matTexture(): Texture {
  return cachedTexture('doormat', () => canvasTexture(512, 320, (ctx, w, h) => {
    ctx.fillStyle = BRAND.greenDark;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = BRAND.orange;
    ctx.lineWidth = 10;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    drawNewt(ctx, 74, 88, 90, BRAND.orange, BRAND.cream, BRAND.greenDark);
    ctx.fillStyle = BRAND.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(92, '900');
    ctx.fillText('WITAMY', w / 2 + 40, 100);
    ctx.fillStyle = BRAND.orange;
    ctx.font = font(34);
    ctx.fillText('Centrala widzi, że wchodzisz', w / 2, 232);
  }));
}

const POSTERS: readonly { title: string; footer: string }[] = [
  { title: 'KPI to stan umysłu.', footer: '— Centrala' },
  { title: 'Promocja: 3 w cenie 3!', footer: 'Tylko w Traszce' },
  { title: 'Nadgodziny budują charakter.', footer: '— Centrala' },
  { title: 'Ogonki: chrupią, więc zdrowe.', footer: 'Ogonki. Chrup i wróć' },
];

function posterTexture(p: { title: string; footer: string }): Texture {
  return cachedTexture(`poster|${p.title}`, () => canvasTexture(256, 352, (ctx, w, h) => {
    ctx.fillStyle = BRAND.cream;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = BRAND.green;
    ctx.fillRect(0, 0, w, 72);
    drawNewt(ctx, 62, 40, 84, BRAND.orange, BRAND.cream, BRAND.greenDark);
    ctx.fillStyle = BRAND.cream;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = font(34, '900');
    ctx.fillText('TRASZKA', 168, 40);
    ctx.fillStyle = BRAND.greenDark;
    ctx.font = font(36, '900');
    const lines = wrapLines(ctx, p.title, w - 40);
    lines.forEach((l, i) => ctx.fillText(l, w / 2, 150 + (i - (lines.length - 1) / 2) * 44));
    ctx.fillStyle = BRAND.orange;
    ctx.fillRect(0, h - 58, w, 58);
    ctx.fillStyle = BRAND.cream;
    ctx.font = font(22);
    ctx.fillText(p.footer, w / 2, h - 29);
    ctx.strokeStyle = BRAND.greenDark;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
  }));
}

// --- Ściany --------------------------------------------------------------------------------------------

type SegKind = 'solid' | 'window' | 'foil' | 'entrance' | 'door';
type Tone = 'sales' | 'back';
interface Seg { len: number; kind: SegKind; tone: Tone; cell: Cell | null; inner: Cell | null }
interface Line { side: WallSide; at: Vec3; rotY: number; segs: Seg[] }

function cellAt(layout: StoreLayout, c: Cell | null): CellType | null {
  return c ? layout.cells[c.y * layout.width + c.x] ?? null : null;
}

function wallLines(layout: StoreLayout): Line[] {
  const { width, depth, midWallY } = layout;
  const x0 = (i: number): number => (i - width / 2) * M;
  const z0 = (j: number): number => (j - depth / 2) * M;
  const solid = (len: number, tone: Tone, cell: Cell | null = null, inner: Cell | null = null): Seg => ({ len, kind: 'solid', tone, cell, inner });

  // ściana frontowa (wiersz FRONT_WALL_Y): narożniki grubości muru, potem kratki od x=1 do width−2
  const front: Seg[] = [solid(WALL_T, 'sales')];
  for (let x = 1; x <= width - 2; x++) {
    const type = layout.cells[FRONT_WALL_Y * width + x];
    front.push({ len: M, kind: type === 'entrance' ? 'entrance' : type === 'window' ? 'window' : 'solid', tone: 'sales', cell: { x, y: FRONT_WALL_Y }, inner: null });
  }
  front.push(solid(WALL_T, 'sales'));

  // ściany boczne: kratki kolumny 0 / width−1 w wierszach od FRONT_WALL_Y+1 do depth−2; okno w lokalu narożnym
  const side = (col: number, innerCol: number, rows: number[]): Seg[] => rows.map((y) => {
    const type = layout.cells[y * width + col];
    const inner = { x: innerCol, y };
    const tone: Tone = y >= midWallY ? 'back' : 'sales';
    if (type !== 'window') return solid(M, tone, { x: col, y }, inner);
    return { len: M, kind: cellAt(layout, inner) === 'fixture' ? 'foil' : 'window', tone, cell: { x: col, y }, inner };
  });
  const rowsFront = Array.from({ length: depth - 2 - FRONT_WALL_Y }, (_, i) => FRONT_WALL_Y + 1 + i);

  const mid: Seg[] = [];
  for (let x = width - 2; x >= 1; x--) {
    const type = layout.cells[midWallY * width + x];
    mid.push(type === 'fixture'
      ? { len: M, kind: 'door', tone: 'sales', cell: { x, y: midWallY }, inner: null }
      : solid(M, 'sales', { x, y: midWallY }, { x, y: midWallY - 1 }));
  }

  return [
    { side: 'front', at: [x0(1) - WALL_T, 0, z0(FRONT_WALL_Y + 1)], rotY: 0, segs: front },
    { side: 'back', at: [x0(width - 1) + WALL_T, 0, z0(depth - 1)], rotY: Math.PI, segs: [solid((width - 2) * M + 2 * WALL_T, 'back')] },
    { side: 'left', at: [x0(1), 0, z0(depth - 1)], rotY: Math.PI / 2, segs: side(0, 1, [...rowsFront].reverse()) },
    { side: 'right', at: [x0(width - 1), 0, z0(FRONT_WALL_Y + 1)], rotY: -Math.PI / 2, segs: side(width - 1, width - 2, rowsFront) },
    { side: 'mid', at: [x0(width - 1), 0, z0(midWallY)], rotY: Math.PI, segs: mid },
  ];
}

/** Złącza kolejne segmenty o tym samym rodzaju i tonie w jeden odcinek [u0, u1]. */
function runsOf(segs: Seg[]): { kind: SegKind; tone: Tone; u0: number; u1: number }[] {
  const out: { kind: SegKind; tone: Tone; u0: number; u1: number }[] = [];
  let u = 0;
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.kind === s.kind && last.tone === s.tone) last.u1 = u + s.len;
    else out.push({ kind: s.kind, tone: s.tone, u0: u, u1: u + s.len });
    u += s.len;
  }
  return out;
}

interface LineGroups { low: Group; cap: Group; high: Group }

/** Mur od `y0` do sufitu: pas ton + (w sali) jasnozielony pas marki u góry. */
function upper(g: Group, u: number, len: number, y0: number, y1: number, tone: Tone): void {
  if (y1 <= y0 + 1e-6) return;
  const main = matte(tone === 'sales' ? PALETTE.wall[0] : PALETTE.wall[3]);
  const stripeBottom = WALL_H - STRIPE_H;
  if (tone === 'sales' && y1 > stripeBottom) {
    if (stripeBottom > y0) box(g, [len, stripeBottom - y0, WALL_T], [u, y0, -WALL_T / 2], main, { name: 'wall' });
    box(g, [len, y1 - Math.max(stripeBottom, y0), WALL_T], [u, Math.max(stripeBottom, y0), -WALL_T / 2], matte(PALETTE.wall[1]), { name: 'wall stripe' });
  } else box(g, [len, y1 - y0, WALL_T], [u, y0, -WALL_T / 2], main, { name: 'wall' });
}

function skirting(l: LineGroups, u: number, len: number): void {
  box(l.low, [len, WAINSCOT_H, WALL_T], [u, 0, -WALL_T / 2], matte(PALETTE.wall[2]), { name: 'wainscot' });
  box(l.cap, [len, CAP_H, WALL_T], [u, WAINSCOT_H, -WALL_T / 2], matte(PALETTE.wall[4]), { name: 'cut' });
}

function windowRun(l: LineGroups, u0: number, u1: number, tone: Tone, foil: boolean): void {
  const len = u1 - u0;
  const u = (u0 + u1) / 2;
  const frame = painted(BRAND.greenDark);
  skirting(l, u, len);
  upper(l.high, u, len, WAINSCOT_H, SILL, tone);
  upper(l.high, u, len, GLASS_TOP, WALL_H, tone);
  const openH = GLASS_TOP - SILL;
  box(l.high, [len, 0.06, WALL_T * 0.7], [u, GLASS_TOP - 0.06, -WALL_T / 2], frame, { name: 'window head' });
  box(l.high, [len, 0.05, WALL_T * 0.7], [u, SILL, -WALL_T / 2], frame, { name: 'window sill' });
  if (foil) {
    // folia reklamowa na całej szybie, tam gdzie stoi mebel: nieprzezroczysta, naklejki z obu stron
    const mat = texturedMaterial('foil', foilTexture(), { roughness: 0.45 });
    const size: [number, number] = [len, openH - 0.11];
    const uv: [number, number] = [len / 1.5, 1];
    plane(l.high, size, [u, SILL + 0.05 + size[1] / 2, -WALL_T / 2 + 0.006], mat, { uv, name: 'foil' });
    plane(l.high, size, [u, SILL + 0.05 + size[1] / 2, -WALL_T / 2 - 0.006], mat, { uv, rot: [0, Math.PI, 0], name: 'foil' });
    box(l.high, [0.07, openH, WALL_T * 0.7], [u0 + 0.035, SILL, -WALL_T / 2], frame, { name: 'mullion' });
    box(l.high, [0.07, openH, WALL_T * 0.7], [u1 - 0.035, SILL, -WALL_T / 2], frame, { name: 'mullion' });
    return;
  }
  const panes = Math.max(1, Math.round(len / 1.0));
  const pw = len / panes;
  for (let i = 0; i <= panes; i++) {
    const mu = u0 + i * pw;
    box(l.high, [0.07, openH, WALL_T * 0.7], [Math.min(Math.max(mu, u0 + 0.035), u1 - 0.035), SILL, -WALL_T / 2], frame, { name: 'mullion' });
  }
  for (let i = 0; i < panes; i++) {
    box(l.high, [pw - 0.07, openH - 0.11, 0.012], [u0 + (i + 0.5) * pw, SILL + 0.055, -WALL_T / 2], glassMat(), { name: 'glass' });
  }
}

/** Wejście: nadproże, ościeżnice, belka automatyki i dwa skrzydła przesuwne „otwarte” po zewnętrznej stronie ściany. */
function entranceRun(l: LineGroups, u0: number, u1: number, tone: Tone): void {
  const len = u1 - u0;
  const u = (u0 + u1) / 2;
  const frame = painted(BRAND.greenDark);
  box(l.low, [len, 0.02, WALL_T], [u, 0, -WALL_T / 2], painted(FIX.metal), { name: 'threshold' });
  upper(l.high, u, len, ENTRANCE_H, WALL_H, tone);
  for (const eu of [u0 + 0.035, u1 - 0.035]) box(l.high, [0.07, ENTRANCE_H, WALL_T * 0.8], [eu, 0, -WALL_T / 2], frame, { name: 'door jamb' });
  box(l.high, [len, 0.07, WALL_T * 0.8], [u, ENTRANCE_H - 0.07, -WALL_T / 2], frame, { name: 'door head' });
  const outer = -WALL_T - 0.04;
  box(l.high, [len + 1.2, 0.1, 0.07], [u, ENTRANCE_H, outer - 0.012], frame, { name: 'door track' });
  for (const side of [-1, 1]) {
    const cu = side < 0 ? u0 - 0.27 : u1 + 0.27;
    const h = ENTRANCE_H - 0.08;
    for (const eu of [cu - 0.235, cu + 0.235]) box(l.high, [0.03, h, 0.04], [eu, 0.02, outer], frame, { name: 'door leaf' });
    for (const y of [0.02, h - 0.01]) box(l.high, [0.47, 0.03, 0.04], [cu, y, outer], frame, { name: 'door leaf' });
    box(l.high, [0.43, h - 0.06, 0.012], [cu, 0.05, outer], glassMat(), { name: 'door glass' });
    box(l.high, [0.025, 0.5, 0.03], [cu + side * -0.18, 0.8, outer - 0.04], painted(FIX.metal), { name: 'door handle' });
  }
}

function doorRun(l: LineGroups, u0: number, u1: number): void {
  const len = u1 - u0;
  const u = (u0 + u1) / 2;
  box(l.low, [len, 0.02, WALL_T], [u, 0, -WALL_T / 2], painted(FIX.metal), { name: 'threshold' });
  upper(l.high, u, len, BACKROOM_DOOR_H, WALL_H, 'sales');
}

function buildSign(g: Group, uc: number, disposables: { dispose(): void }[]): void {
  const SH = 0.6;
  const SW = SH * SIGN_ASPECT;
  const y0 = WALL_H - SH - 0.06;
  const face = makeSignTexture('TRASZKA');
  const glowMap = makeSignGlowTexture('TRASZKA');
  const mat = makeTextured('sign', face, { roughness: 0.5, emissiveMap: glowMap, emissive: BRAND.cream, emissiveIntensity: 3 });
  disposables.push(face, glowMap, mat);
  box(g, [SW + 0.1, SH + 0.06, 0.1], [uc, y0 - 0.0, -WALL_T - 0.05], gloss(BRAND.orange), { name: 'sign rim' });
  box(g, [SW, SH, 0.06], [uc, y0 + 0.03, -WALL_T - 0.13], matte(BRAND.green), { name: 'sign body' });
  plane(g, [SW, SH], [uc, y0 + 0.03 + SH / 2, -WALL_T - 0.1605], mat, { rot: [0, Math.PI, 0], name: 'sign face', cast: false });
}

function poster(g: Group, u: number, p: { title: string; footer: string }): void {
  box(g, [0.46, 0.62, 0.012], [u, 1.43, 0.006], matte(BRAND.cream), { name: 'poster frame' });
  plane(g, [0.42, 0.58], [u, 1.45 + 0.29, 0.0125], texturedMaterial(`poster|${p.title}`, posterTexture(p), { roughness: 0.6 }), { name: 'poster' });
}

// --- Podłoga, zaplecze, lampy -----------------------------------------------------------------------

function floorPlane(g: Group, name: string, tex: Texture, w: number, d: number, cx: number, cz: number, y: number): void {
  const mat = texturedMaterial(`floor|${name}`, tex, { roughness: 0.5 });
  plane(g, [w, d], [cx, y, cz], mat, { rot: [-Math.PI / 2, 0, 0], uv: [w / 2, d / 2], receive: true, name: `floor ${name}` });
}

function buildFloor(layout: StoreLayout, g: Group): void {
  const { width, depth, midWallY, entrance } = layout;
  const x1 = cellToWorld(layout, 1, 0).x - M / 2;
  const x2 = cellToWorld(layout, width - 1, 0).x - M / 2;
  const zFront = cellToWorld(layout, 0, FRONT_WALL_Y + 1).z - M / 2;
  const zMid = cellToWorld(layout, 0, midWallY).z - M / 2;
  const zBack = cellToWorld(layout, 0, depth - 1).z - M / 2;
  const w = x2 - x1;
  const sales = zMid - zFront;

  const main = tileTexture('sala', PALETTE.floor[0], PALETTE.floor[2]);
  const accent = tileTexture('akcent', PALETTE.floor[1], PALETTE.floor[2]);
  floorPlane(g, 'sala', main, w, sales, (x1 + x2) / 2, (zFront + zMid) / 2, 0);
  floorPlane(g, 'zaplecze', tileTexture('zaplecze', PALETTE.floor[3], PALETTE.floor[2]), w, zBack - zMid, (x1 + x2) / 2, (zMid + zBack) / 2, 0);

  // obwódka z płytek akcentowych (jedna płytka szerokości) wokół sali
  const ring = M;
  floorPlane(g, 'akcent', accent, w, ring, (x1 + x2) / 2, zFront + ring / 2, 0.003);
  floorPlane(g, 'akcent', accent, w, ring, (x1 + x2) / 2, zMid - ring / 2, 0.003);
  floorPlane(g, 'akcent', accent, ring, sales - 2 * ring, x1 + ring / 2, (zFront + zMid) / 2, 0.003);
  floorPlane(g, 'akcent', accent, ring, sales - 2 * ring, x2 - ring / 2, (zFront + zMid) / 2, 0.003);
  // pas przy wejściu: 4 kratki szerokości, 2 kratki w głąb
  const ex = (cellToWorld(layout, entrance[0]!.x, 0).x + cellToWorld(layout, entrance[1]!.x, 0).x) / 2;
  floorPlane(g, 'akcent', accent, 4 * M, 2 * M, ex, zFront + M, 0.004);
  // mata przy drzwiach
  const matMat = texturedMaterial('doormat', matTexture(), { roughness: 0.95 });
  box(g, [1.0, 0.025, 0.62], [ex, 0.004, zFront + 0.4], fabricMat(BRAND.greenDark), { name: 'doormat', seg: 1, radius: 0.008 });
  plane(g, [0.94, 0.56], [ex, 0.0305, zFront + 0.4], matMat, { rot: [-Math.PI / 2, 0, 0], receive: true, name: 'doormat top' });
}

function buildBackroom(layout: StoreLayout, g: Group, rng: Rng): void {
  const { width, depth } = layout;
  const door = layout.fixtures.find((f) => f.kind === 'backroomDoor');
  const xFrom = cellToWorld(layout, 1, 0).x - M / 2 + 0.15;
  const xTo = cellToWorld(layout, width - 1, 0).x - M / 2 - 0.15;
  const zBack = cellToWorld(layout, 0, depth - 1).z - M / 2 - 0.15;
  const blockedFrom = door ? cellToWorld(layout, door.x, 0).x - M / 2 - 0.5 : 0;
  const blockedTo = door ? cellToWorld(layout, door.x + door.w, 0).x - M / 2 + 0.5 : 0;
  const carton = [PALETTE.productCategory.pieczywo[1], PALETTE.productCategory.pieczywo[3], PALETTE.productCategory.pieczywo[0]];
  let x = xFrom + 0.5;
  while (x < xTo - 0.5) {
    const block = x > blockedFrom - 0.5 && x < blockedTo + 0.5;
    if (!block && rng.chance(0.75)) {
      box(g, [0.8, 0.12, 0.6], [x, 0, zBack - 0.3], woodMat(FIX.wood), { name: 'pallet' });
      const rows = rng.int(1, 4);
      for (let r = 0; r < rows; r++) {
        for (const dx of [-0.2, 0.2]) {
          box(g, [0.36, 0.28, 0.5], [x + dx + rng.range(-0.015, 0.015), 0.12 + r * 0.28, zBack - 0.3 + rng.range(-0.02, 0.02)], matte(rng.pick(carton)), { name: 'carton', rot: [0, rng.range(-0.05, 0.05), 0] });
        }
      }
    }
    x += 1.1;
  }
}

function buildLamps(layout: StoreLayout, ceiling: Group, lamps: Group, positions: Vector3[]): void {
  const { width, midWallY } = layout;
  const x1 = cellToWorld(layout, 1, 0).x - M / 2;
  const x2 = cellToWorld(layout, width - 1, 0).x - M / 2;
  const zFront = cellToWorld(layout, 0, FRONT_WALL_Y + 1).z - M / 2;
  const zMid = cellToWorld(layout, 0, midWallY).z - M / 2;
  const nx = Math.max(2, Math.round((x2 - x1 - 1.2) / 3.2));
  const nz = Math.max(2, Math.round((zMid - zFront - 1.2) / 3.2));
  const hx = (x2 - x1 - 1.2) / 2;
  const hz = (zMid - zFront - 1.2) / 2;
  const cx = (x1 + x2) / 2;
  const cz = (zFront + zMid) / 2;
  const housing = painted(FIX.metal);
  const panel = glow(BRAND.cream, 2.2);
  const one = (x: number, z: number, light: boolean): void => {
    // świecąca belka widoczna z góry i z dołu, z metalowymi zaślepkami na końcach
    box(lamps, [1.2, 0.05, 0.14], [x, LAMP_Y, z], panel, { name: 'lamp panel', cast: false });
    for (const sx of [-1, 1]) box(ceiling, [0.04, 0.07, 0.17], [x + sx * 0.62, LAMP_Y - 0.01, z], housing, { name: 'lamp cap', cast: false });
    for (const dx of [-0.45, 0.45]) {
      cyl(ceiling, 0.007, WALL_H - LAMP_Y - 0.05, [x + dx, LAMP_Y + 0.05 + (WALL_H - LAMP_Y - 0.05) / 2, z], housing, { name: 'lamp rod', segs: 6, cast: false });
      cyl(ceiling, 0.022, 0.025, [x + dx, WALL_H - 0.0125, z], housing, { name: 'lamp canopy', segs: 8, cast: false });
    }
    if (light) positions.push(new Vector3(x, LAMP_Y - 0.1, z));
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) one(cx - hx + ((i + 0.5) * 2 * hx) / nx, cz - hz + ((j + 0.5) * 2 * hz) / nz, true);
  // jedna lampa na zapleczu (bez światła punktowego: ciepłe światło tylko w sali)
  one(cx, (zMid + cellToWorld(layout, 0, layout.depth - 1).z - M / 2) / 2, false);
}

// --- Całość ------------------------------------------------------------------------------------------

export function buildShell(layout: StoreLayout): Shell {
  const rng = createRng(subSeed(layout.seed, 'powłoka'));
  const disposables: { dispose(): void }[] = [];
  const walls = Object.fromEntries(WALL_SIDES.map((s) => [s, { low: new Group(), cap: new Group(), high: new Group() }])) as Record<WallSide, WallParts>;
  const floor = new Group();
  const ceiling = new Group();
  const lamps = new Group();
  const lampPositions: Vector3[] = [];

  const lines = wallLines(layout);
  const posterSpots: { side: WallSide; g: Group; u: number }[] = [];
  for (const line of lines) {
    const parts = walls[line.side];
    const lg: LineGroups = { low: new Group(), cap: new Group(), high: new Group() };
    for (const [key, group] of Object.entries(lg) as ['low' | 'cap' | 'high', Group][]) {
      group.position.set(...line.at);
      group.rotation.y = line.rotY;
      parts[key].add(group);
    }
    for (const run of runsOf(line.segs)) {
      const len = run.u1 - run.u0;
      const uc = (run.u0 + run.u1) / 2;
      switch (run.kind) {
        case 'solid': skirting(lg, uc, len); upper(lg.high, uc, len, WAINSCOT_H, WALL_H, run.tone); break;
        case 'window': windowRun(lg, run.u0, run.u1, run.tone, false); break;
        case 'foil': windowRun(lg, run.u0, run.u1, run.tone, true); break;
        case 'entrance': entranceRun(lg, run.u0, run.u1, run.tone); break;
        case 'door': doorRun(lg, run.u0, run.u1); break;
      }
    }
    // kratki, na których można powiesić plakat: goły mur z pustą podłogą przed nim
    if (line.side === 'left' || line.side === 'right' || line.side === 'mid') {
      let u = 0;
      for (const seg of line.segs) {
        if (seg.kind === 'solid' && seg.tone === 'sales' && cellAt(layout, seg.inner) === 'floor') posterSpots.push({ side: line.side, g: lg.high, u: u + seg.len / 2 });
        u += seg.len;
      }
    }
    if (line.side === 'front') {
      const e = layout.entrance;
      const uEntrance = (e[0]!.x - 1) * M + WALL_T + M; // środek dwóch kratek wejścia w układzie u frontu
      const uc = Math.min(Math.max(uEntrance, 1.9), (layout.width - 2) * M + 2 * WALL_T - 1.9);
      buildSign(lg.high, uc, disposables);
    }
  }

  // plakaty: do 4, nie bliżej niż 4 kratki od siebie na jednej ścianie
  const chosen: typeof posterSpots = [];
  for (const spot of rng.shuffle(posterSpots)) {
    if (chosen.length >= POSTERS.length) break;
    if (chosen.every((c) => c.g !== spot.g || Math.abs(c.u - spot.u) >= 4 * M)) chosen.push(spot);
  }
  chosen.forEach((s, i) => poster(s.g, s.u, POSTERS[i]!));

  buildFloor(layout, floor);
  buildBackroom(layout, floor, rng);
  buildLamps(layout, ceiling, lamps, lampPositions);
  return { walls, floor, ceiling, lamps, lampPositions, disposables };
}
