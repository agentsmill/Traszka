import type { Texture } from 'three';
import { PALETTE } from '@/render/style';
import { cachedTexture, canvasTexture, font } from '@/render/store/parts';
import { drawNewt } from '@/render/store/signTexture';

/**
 * Atlas elewacji (1024×1024): jedna tekstura koloru i jedna emissive dla wszystkich budynków ulicy, więc budynki
 * to jedna siatka z UV w tym atlasie (jeden draw call na budynek). Komórki są prostokątami o różnych proporcjach.
 *
 * Tekstury są neutralne (kremowe), żeby kolor wierzchołków (pastele z PALETTE.street) mnożył się z nimi jak farba:
 * 'szewPlyty' i 'tynk' niosą kolor budynku. Okna, loggie, witryny i brama mają własne kolory i dostają biały kolor
 * wierzchołków. Mapa emissive ma tę samą siatkę: świecą szyby okien (nocą, patrz buildings.ts), loggii i witryn.
 *
 * Tekstury są współdzielone w całym procesie (cache): nie zwalniaj ich. W Node (testy) są to atrapy 1×1 (ruling R4),
 * a `cell()` działa tak samo, bo zależy tylko od układu. Mapa emissive jest maską w skali szarości (jasność = siła
 * świecenia), nie kolorem powierzchni, więc czerń i szarości w niej nie łamią zasady „bez czerni i szarości” z przewodnika.
 */

export type AtlasCellName = 'okno' | 'oknoGasne' | 'loggia' | 'szewPlyty' | 'tynk' | 'witryna' | 'brama' | 'gzyms'
  | 'mural' | 'muralSzop' | 'podloga';

export interface FacadeAtlas {
  map: Texture;
  emissive: Texture;
  /** Prostokąt komórki w UV: [u0, v0, u1, v1], v0 to dolna krawędź. Wnętrze komórki, bez marginesu na mipmapy. */
  cell(name: AtlasCellName): [number, number, number, number];
}

const SIZE = 1024;
/** Margines (px) wokół komórki, który nie wchodzi do UV, żeby mipmapy nie mieszały sąsiadów. */
const GUTTER = 6;

interface Rect { x: number; y: number; w: number; h: number }

const LAYOUT: Record<AtlasCellName, Rect> = {
  okno: { x: 0, y: 0, w: 256, h: 256 },
  oknoGasne: { x: 256, y: 0, w: 256, h: 256 },
  loggia: { x: 512, y: 0, w: 256, h: 256 },
  witryna: { x: 768, y: 0, w: 256, h: 256 },
  szewPlyty: { x: 0, y: 256, w: 256, h: 256 },
  tynk: { x: 256, y: 256, w: 256, h: 256 },
  brama: { x: 512, y: 256, w: 256, h: 320 },
  gzyms: { x: 768, y: 256, w: 256, h: 64 },
  podloga: { x: 768, y: 320, w: 256, h: 256 },
  mural: { x: 0, y: 512, w: 512, h: 512 },
  muralSzop: { x: 512, y: 576, w: 512, h: 448 },
};

const CELL_NAMES = Object.keys(LAYOUT) as AtlasCellName[];

type Ctx = CanvasRenderingContext2D;
type DrawCell = (ctx: Ctx, w: number, h: number) => void;

const { brand } = PALETTE;
const plaster = PALETTE.street.kamienicaPlaster;
const pastel = PALETTE.street.blokPastel;
const FRAME = brand.cream;
const DARK_FRAME = PALETTE.fixture.fridgeFrame;
const SKY_LIGHT = PALETTE.productCategory.nabial[2];
const SKY_DEEP = PALETTE.productCategory.nabial[1];

function rect(ctx: Ctx, color: string, x: number, y: number, w: number, h: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

/** Okno dwuskrzydłowe: kremowa rama, szyba z gradientem nieba, listwa środkowa, rolety/zasłona wg `curtain`. */
function drawWindow(ctx: Ctx, w: number, h: number, curtain: string | null, blind: boolean): void {
  rect(ctx, FRAME, 0, 0, w, h);
  const m = 22;
  const glass = ctx.createLinearGradient(0, m, 0, h - m);
  glass.addColorStop(0, SKY_LIGHT);
  glass.addColorStop(1, SKY_DEEP);
  ctx.fillStyle = glass;
  ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
  // odbicie światła w szybie
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = FRAME;
  ctx.beginPath();
  ctx.moveTo(m, h * 0.55);
  ctx.lineTo(m + (w - 2 * m) * 0.45, m);
  ctx.lineTo(m + (w - 2 * m) * 0.7, m);
  ctx.lineTo(m, h * 0.8);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (curtain) {
    rect(ctx, curtain, m, m, (w - 2 * m) * 0.3, h - 2 * m, 0.9);
    rect(ctx, curtain, w - m - (w - 2 * m) * 0.22, m, (w - 2 * m) * 0.22, h - 2 * m, 0.9);
  }
  if (blind) rect(ctx, PALETTE.productCategory.pieczywo[2], m, m, w - 2 * m, (h - 2 * m) * 0.42, 0.95);
  // słupek i poprzeczka, cień wewnętrzny z góry i z lewej (okno siedzi w murze)
  rect(ctx, FRAME, w / 2 - 6, m, 12, h - 2 * m);
  rect(ctx, FRAME, m, h * 0.34, w - 2 * m, 10);
  rect(ctx, PALETTE.wall[4], m, m, w - 2 * m, 7, 0.28);
  rect(ctx, PALETTE.wall[4], m, m, 7, h - 2 * m, 0.2);
  rect(ctx, PALETTE.wall[3], 0, h - 10, w, 10);
}

/** Maska emissive okna: szyba świeci ciepłym światłem, ramy, słupek i poprzeczka zostają ciemne. */
function drawWindowGlow(ctx: Ctx, w: number, h: number): void {
  rect(ctx, '#000000', 0, 0, w, h);
  const m = 22;
  const g = ctx.createRadialGradient(w / 2, h * 0.55, 8, w / 2, h * 0.55, w * 0.7);
  g.addColorStop(0, '#f0f0f0');
  g.addColorStop(1, '#a0a0a0');
  ctx.fillStyle = g;
  ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
  rect(ctx, '#000000', w / 2 - 6, m, 12, h - 2 * m);
  rect(ctx, '#000000', m, h * 0.34, w - 2 * m, 10);
}

/** Wyśrodkowany napis o szerokości ≤ `maxW` (czcionka zmniejszana do skutku). */
function fitText(ctx: Ctx, text: string, x: number, y: number, px: number, maxW: number, color: string): void {
  ctx.font = font(px, '900');
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.font = font(Math.floor((px * maxW) / w), '900');
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/**
 * Mural na odsłoniętej ścianie szczytowej sąsiada (widać ją w przekroju, gdy bryła nad sklepem znika): reklama
 * Centrali w barwach marki. Duże litery, więc to żart czytelny z domyślnego zoomu (przewodnik §6).
 */
function drawMural(ctx: Ctx, w: number, h: number): void {
  rect(ctx, brand.cream, 0, 0, w, h);
  rect(ctx, brand.green, 18, 18, w - 36, h - 36);
  rect(ctx, brand.greenDark, 18, h - 132, w - 36, 114);
  drawNewt(ctx, w / 2, 120, 330, brand.orange, brand.cream, brand.greenDark);
  fitText(ctx, 'CENTRALA', w / 2, 262, 92, w - 80, brand.cream);
  fitText(ctx, 'MYŚLI ZA CIEBIE', w / 2, 340, 56, w - 80, brand.orange);
  fitText(ctx, 'Ty tylko uzupełnij tabelkę.', w / 2, h - 92, 30, w - 80, brand.cream);
  fitText(ctx, 'TRASZKA · ZAWSZE BLISKO', w / 2, h - 46, 26, w - 80, brand.orange);
  // zacieki i spłowienie starego muralu
  for (let x = 40; x < w - 40; x += 57) rect(ctx, PALETTE.wall[4], x, 18, 3, 26 + ((x * 7) % 40), 0.12);
}

/** Mural konkurencji: „Szop 24h” (sieć z gry, bez prawdziwych marek), szop z maską i żart z całodobowej Traszki. */
function drawMuralSzop(ctx: Ctx, w: number, h: number): void {
  const violet = PALETTE.clothes[6];
  const grey = PALETTE.street.kamienicaPlaster[5];
  rect(ctx, brand.cream, 0, 0, w, h);
  rect(ctx, violet, 18, 18, w - 36, h - 36);
  // szop: uszy, głowa, maska, oczy, nos
  const cx = w / 2, cy = 128;
  ctx.fillStyle = grey;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * 50, cy - 40);
    ctx.lineTo(cx + sx * 92, cy - 96);
    ctx.lineTo(cx + sx * 104, cy - 22);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, 108, 80, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.wall[4];
  ctx.beginPath();
  ctx.ellipse(cx - 44, cy - 6, 44, 26, -0.25, 0, Math.PI * 2);
  ctx.ellipse(cx + 44, cy - 6, 44, 26, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = brand.cream;
  for (const sx of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sx * 40, cy - 8, 11, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = PALETTE.wall[4];
  ctx.beginPath();
  ctx.ellipse(cx, cy + 40, 16, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  fitText(ctx, 'SZOP 24h', w / 2, 270, 96, w - 80, brand.cream);
  fitText(ctx, 'OTWARTE, GDY TRASZKA ŚPI', w / 2, 340, 38, w - 70, PALETTE.productCategory.przekaski[0]);
  fitText(ctx, '* Traszka nie śpi. Sprawdzaliśmy.', w / 2, h - 52, 26, w - 80, brand.cream);
}

/** Podłoga w przekroju sąsiada: deski w jodełkę (kremowe, kolor daje wierzchołek). */
function drawFloorBoards(ctx: Ctx, w: number, h: number): void {
  rect(ctx, FRAME, 0, 0, w, h);
  const bw = 32, bl = 96;
  let k = 0;
  for (let y = -bl; y < h + bl; y += bw) {
    for (let x = -bl; x < w + bl; x += bl) {
      const off = (Math.floor(y / bw) % 2) * (bl / 2);
      rect(ctx, k++ % 3 === 0 ? plaster[5] : plaster[0], x + off + 2, y + 2, bl - 4, bw - 4, 0.08 + (k % 4) * 0.03);
      rect(ctx, PALETTE.wall[4], x + off, y, bl, 2, 0.12);
      rect(ctx, PALETTE.wall[4], x + off, y, 2, bw, 0.12);
    }
  }
}

const DIM_GLOW: DrawCell = (ctx, w, h) => rect(ctx, '#404040', 0, 0, w, h);

const DRAW: Record<AtlasCellName, { color: DrawCell; glow: DrawCell | null }> = {
  mural: { color: drawMural, glow: DIM_GLOW },
  muralSzop: { color: drawMuralSzop, glow: DIM_GLOW },
  podloga: { color: drawFloorBoards, glow: null },
  okno: { color: (c, w, h) => drawWindow(c, w, h, pastel[1], false), glow: drawWindowGlow },
  oknoGasne: { color: (c, w, h) => drawWindow(c, w, h, null, true), glow: null },
  loggia: {
    color: (ctx, w, h) => {
      // wnęka loggii: ciepłe wnętrze, szklone drzwi balkonowe, balustrada z poziomych szczebli
      rect(ctx, PALETTE.wall[4], 0, 0, w, h);
      rect(ctx, plaster[0], 12, 12, w - 24, h - 24);
      rect(ctx, SKY_LIGHT, 40, 26, w - 80, h * 0.5);
      rect(ctx, FRAME, w / 2 - 5, 26, 10, h * 0.5);
      rect(ctx, PALETTE.wall[4], 12, 12, w - 24, 10, 0.4);
      const railTop = h * 0.64;
      rect(ctx, brand.greenDark, 8, railTop, w - 16, 12);
      for (let x = 20; x < w - 16; x += 26) rect(ctx, brand.greenDark, x, railTop, 6, h - railTop - 8);
      rect(ctx, brand.green, 8, h - 20, w - 16, 12);
      rect(ctx, PALETTE.productCategory.przekaski[3], w * 0.62, railTop - 26, 30, 28);
    },
    glow: (ctx, w, h) => {
      rect(ctx, '#000000', 0, 0, w, h);
      rect(ctx, '#a0a0a0', 40, 26, w - 80, h * 0.5);
      rect(ctx, '#000000', w / 2 - 5, 26, 10, h * 0.5);
    },
  },
  szewPlyty: {
    color: (ctx, w, h) => {
      // płyta prefabrykowana: kremowa, fazowane brzegi, spoina dookoła i krzyż spoin środkiem
      rect(ctx, FRAME, 0, 0, w, h);
      rect(ctx, plaster[5], 0, 0, w, 10, 0.55);
      rect(ctx, plaster[5], 0, 0, 10, h, 0.55);
      rect(ctx, plaster[5], 0, h / 2 - 3, w, 6, 0.4);
      rect(ctx, plaster[5], w / 2 - 3, 0, 6, h, 0.4);
      rect(ctx, FRAME, 10, 10, w - 20, 5, 0.6);
      rect(ctx, PALETTE.wall[4], 0, h - 6, w, 6, 0.1);
    },
    glow: null,
  },
  tynk: {
    color: (ctx, w, h) => {
      rect(ctx, FRAME, 0, 0, w, h);
      let seed = 1234567;
      const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < 70; i++) rect(ctx, rnd() > 0.5 ? plaster[5] : plaster[0], rnd() * w, rnd() * h, 6 + rnd() * 18, 6 + rnd() * 18, 0.035);
    },
    glow: null,
  },
  witryna: {
    color: (ctx, w, h) => {
      // witryna sklepu: ciemna rama, duża szyba, pas szyldu u góry, cokolik
      rect(ctx, DARK_FRAME, 0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, SKY_LIGHT);
      g.addColorStop(1, SKY_DEEP);
      ctx.fillStyle = g;
      ctx.fillRect(14, 54, w - 28, h - 80);
      rect(ctx, plaster[1], 14, 14, w - 28, 34);
      rect(ctx, FRAME, 14, 14, w - 28, 6, 0.8);
      rect(ctx, FRAME, w / 2 - 5, 54, 10, h - 80);
      rect(ctx, FRAME, 14, h * 0.6, w - 28, 8, 0.7);
      rect(ctx, FRAME, 28, 70, 50, 14, 0.35);
    },
    glow: (ctx, w, h) => {
      rect(ctx, '#000000', 0, 0, w, h);
      rect(ctx, '#808080', 14, 54, w - 28, h - 80);
      rect(ctx, '#000000', w / 2 - 5, 54, 10, h - 80);
    },
  },
  brama: {
    color: (ctx, w, h) => {
      // brama przejazdowa: kamienny łuk, drewniane skrzydła z deskami, ciemny prześwit w lunecie
      rect(ctx, plaster[5], 0, 0, w, h);
      const r = w / 2 - 14;
      ctx.fillStyle = PALETTE.wall[4];
      ctx.beginPath();
      ctx.moveTo(14, h);
      ctx.lineTo(14, r + 24);
      ctx.arc(w / 2, r + 24, r, Math.PI, 0);
      ctx.lineTo(w - 14, h);
      ctx.fill();
      ctx.fillStyle = PALETTE.fixture.wood;
      ctx.beginPath();
      ctx.moveTo(34, h - 6);
      ctx.lineTo(34, r + 44);
      ctx.arc(w / 2, r + 44, r - 20, Math.PI, 0);
      ctx.lineTo(w - 34, h - 6);
      ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = PALETTE.wall[4];
      for (let x = 34 + 22; x < w - 34; x += 22) ctx.fillRect(x, r + 44, 3, h - r - 50);
      ctx.fillRect(w / 2 - 2, r + 24, 4, h - r - 30);
      ctx.globalAlpha = 1;
      rect(ctx, brand.orange, w / 2 - 22, h * 0.62, 10, 10);
      rect(ctx, brand.orange, w / 2 + 12, h * 0.62, 10, 10);
      rect(ctx, plaster[2], 0, 0, w, 8, 0.7);
    },
    glow: null,
  },
  gzyms: {
    color: (ctx, w, h) => {
      // gzyms: jasna listwa z zębami pod okapem, cień pod spodem
      rect(ctx, FRAME, 0, 0, w, h);
      rect(ctx, FRAME, 0, 0, w, 8, 0.6);
      for (let x = 6; x < w - 6; x += 22) rect(ctx, plaster[5], x, h * 0.45, 12, h * 0.3, 0.55);
      rect(ctx, plaster[5], 0, h - 12, w, 12, 0.6);
    },
    glow: null,
  },
};

function paintAtlas(glow: boolean): (ctx: Ctx, w: number, h: number) => void {
  return (ctx, w, h) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    for (const name of CELL_NAMES) {
      const r = LAYOUT[name];
      const draw = glow ? DRAW[name].glow : DRAW[name].color;
      if (!draw) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.translate(r.x, r.y);
      draw(ctx, r.w, r.h);
      ctx.restore();
    }
  };
}

export function createFacadeAtlas(): FacadeAtlas {
  const map = cachedTexture('facadeAtlas|map', () => canvasTexture(SIZE, SIZE, paintAtlas(false)));
  const emissive = cachedTexture('facadeAtlas|emissive', () => canvasTexture(SIZE, SIZE, paintAtlas(true)));
  return {
    map,
    emissive,
    cell(name) {
      const r = LAYOUT[name];
      const u0 = (r.x + GUTTER) / SIZE;
      const u1 = (r.x + r.w - GUTTER) / SIZE;
      // canvas ma początek u góry, tekstura (flipY) u dołu
      const v1 = 1 - (r.y + GUTTER) / SIZE;
      const v0 = 1 - (r.y + r.h - GUTTER) / SIZE;
      return [u0, v0, u1, v1];
    },
  };
}
