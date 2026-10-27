import type { CanvasTexture, DataTexture } from 'three';
import { BRAND, canvasTexture, font } from './parts';

/**
 * Rysuje traszkę (logo marki): faliste ciało z ogonem, cztery łapki, głowa z okiem i jaśniejszy brzuch.
 * Układ: środek (x, y), `size` = długość od czubka ogona do nosa w pikselach, głowa po prawej.
 */
export function drawNewt(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, body: string, belly: string, eye: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const spine = (): void => {
    ctx.beginPath();
    ctx.moveTo(-0.52, 0.16);
    ctx.bezierCurveTo(-0.38, -0.12, -0.2, 0.22, -0.03, 0.04);
    ctx.bezierCurveTo(0.1, -0.1, 0.22, 0.04, 0.34, -0.03);
  };
  // łapki (pod ciałem, żeby nasada ginęła w grzbiecie)
  ctx.strokeStyle = body;
  ctx.lineWidth = 0.06;
  for (const [x1, y1, x2, y2] of [[-0.12, 0.11, -0.2, 0.24], [-0.0, 0.0, 0.04, 0.17], [0.16, -0.03, 0.12, -0.2], [0.28, -0.04, 0.34, -0.2]] as const) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.lineWidth = 0.17;
  spine();
  ctx.stroke();
  // brzuch: węższy, jaśniejszy pas wzdłuż ciała
  ctx.strokeStyle = belly;
  ctx.lineWidth = 0.06;
  spine();
  ctx.stroke();
  // głowa i oko
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0.4, -0.04, 0.115, 0.095, -0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(0.43, -0.07, 0.024, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const W = 1024;
const H = 192;

function drawSign(ctx: CanvasRenderingContext2D, text: string, glowOnly: boolean): void {
  const cream = BRAND.cream;
  if (glowOnly) {
    // czarne tło, nie przezroczyste: mapa emissive czyta tylko RGB, a półprzezroczyste brzegi liter po clearRect mają
    // pełny kolor (canvas oddaje kolor bez premnożenia przez alfę), więc neon miał jaśniejszą, poszarpaną obwódkę
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = BRAND.green;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = BRAND.greenDark;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, W - 10, H - 10);
  }
  // logo
  drawNewt(ctx, 150, 96, 190, BRAND.orange, cream, glowOnly ? cream : BRAND.greenDark);
  // napis
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(124, '900');
  const metrics = ctx.measureText(text);
  const tracking = 8;
  const total = metrics.width + tracking * (text.length - 1);
  let px = 290 + (W - 290 - 40 - total) / 2;
  for (const ch of text) {
    if (!glowOnly) {
      ctx.fillStyle = BRAND.greenDark;
      ctx.fillText(ch, px + 5, 104 + 5);
    }
    ctx.fillStyle = cream;
    ctx.fillText(ch, px, 100);
    px += ctx.measureText(ch).width + tracking;
  }
  ctx.fillStyle = BRAND.orange;
  ctx.fillRect(290, 160, W - 290 - 40, 8);
}

/** Szyld „TRASZKA” z logo traszki (kolor). W Node (bez `document`) zwraca atrapę 1×1 (ruling R4). */
export function makeSignTexture(text: string): CanvasTexture | DataTexture {
  return canvasTexture(W, H, (ctx) => drawSign(ctx, text, false));
}

/** Mapa świecenia szyldu: tylko napis i logo na czerni (maska, nie kolor powierzchni), żeby neon świecił, a tło szyldu nie. */
export function makeSignGlowTexture(text: string): CanvasTexture | DataTexture {
  return canvasTexture(W, H, (ctx) => drawSign(ctx, text, true));
}

/** Proporcje szyldu (szerokość / wysokość). */
export const SIGN_ASPECT = W / H;
