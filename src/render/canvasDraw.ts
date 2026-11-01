import { font } from '@/render/store/parts';

/**
 * Wspólne klocki rysowania na płótnie 2D dla tekstur z napisami: atlas elewacji ulicy (`street/facadeAtlas.ts`) i kartka
 * „DO WYNAJĘCIA” (`rentPoster.ts`).
 */

type Ctx = CanvasRenderingContext2D;

/** Wypełniony prostokąt w kolorze `color` z przezroczystością `alpha` (po rysowaniu przezroczystość wraca do 1). */
export function rect(ctx: Ctx, color: string, x: number, y: number, w: number, h: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

/** Wyśrodkowany napis o szerokości ≤ `maxW` (czcionka zmniejszana do skutku). */
export function fitText(ctx: Ctx, text: string, x: number, y: number, px: number, maxW: number, color: string): void {
  ctx.font = font(px, '900');
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.font = font(Math.floor((px * maxW) / w), '900');
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
