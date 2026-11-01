import { tr } from '@/i18n';
import { fitText, rect } from '@/render/canvasDraw';
import { font } from '@/render/store/parts';
import { PALETTE } from '@/render/style';

/**
 * Kartka „DO WYNAJĘCIA” (spec §9.2): jedna funkcja rysuje ją i w witrynie lokalu obok sklepu (atlas elewacji ulicy), i w pinezce
 * wolnego lokalu na ekranie Miasta. Żółty arkusz w czerwonej ramce, doklejony taśmą, lekko krzywo. Litery „WYNAJĘCIA” są ściśnięte
 * w poziomie, żeby miały wysokość czytelną z daleka, a pod spodem jest drobny dopisek (na ulicy żart o Centrali, w mieście numer
 * lokalu albo „po Traszce”). Napisy „DO” i „WYNAJĘCIA” tłumaczy `tr` (po angielsku „TO” nad „LET”); dopisek wołający podaje już
 * w języku gracza.
 */

type Ctx = CanvasRenderingContext2D;

/** Kartka jest zaprojektowana w prostokącie 216 × 160 px; wszystko inne (litery, ramka, taśma) skaluje się z nim. */
const DESIGN_W = 216;
const DESIGN_H = 160;

/** Napis ściśnięty w poziomie do szerokości ≤ `maxW`: wysokie, wąskie litery jak na plakacie, wyśrodkowane w (`x`, `y`). */
function condensedText(ctx: Ctx, text: string, x: number, y: number, px: number, maxW: number, color: string): void {
  ctx.font = font(px, '900');
  const sx = Math.min(1, maxW / ctx.measureText(text).width);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * Rysuje kartkę w prostokącie (`x`, `y`, `w`, `h`) płótna. `note` to dopisek pod napisem (null: bez dopisku). Rozmiary liter,
 * ramki i taśmy liczą się z mniejszego z `w / 216` i `h / 160`, więc kartka w prostokącie 216 × 160 wygląda dokładnie jak na ulicy.
 * Taśma wystaje o kilka pikseli nad górną krawędź prostokąta.
 */
export function drawRentPoster(ctx: Ctx, x: number, y: number, w: number, h: number, note: string | null): void {
  const k = Math.min(w / DESIGN_W, h / DESIGN_H);
  const red = PALETTE.productCategory.napoje[0]!;
  const yellow = PALETTE.productCategory.przekaski[0]!;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(-0.025);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  rect(ctx, PALETTE.wall[4], x + 4 * k, y + 6 * k, w, h, 0.25);   // cień kartki na szybie
  rect(ctx, red, x, y, w, h);
  rect(ctx, yellow, x + 8 * k, y + 8 * k, w - 16 * k, h - 16 * k);
  condensedText(ctx, tr('DO'), x + w / 2, y + (h * 36) / DESIGN_H, 50 * k, w - 40 * k, red);
  condensedText(ctx, tr('WYNAJĘCIA'), x + w / 2, y + (h * 94) / DESIGN_H, 70 * k, w - 30 * k, red);
  if (note) fitText(ctx, note, x + w / 2, y + h - 26 * k, 20 * k, w - 40 * k, red);
  for (const tx of [x + 10 * k, x + w - 38 * k]) rect(ctx, PALETTE.brand.cream, tx, y - 7 * k, 28 * k, 14 * k, 0.85);   // taśma przy górnych rogach
  ctx.restore();
}
