import { CHARACTER_STYLE, PALETTE } from '@/render/style';
import { createRng, subSeed } from '@/sim/rng';

/**
 * Wygląd postaci wylosowany z seeda. Czysta funkcja, bez three: ten sam seed zawsze daje ten sam wygląd,
 * więc klient odtworzony z zapisu wygląda tak samo. Kolory pochodzą wyłącznie z PALETTE.
 */
export interface Appearance {
  /** Płeć wybiera strój (męski albo damski); fryzura jest częścią stroju. */
  body: 'male' | 'female';
  skin: string;
  hair: string;
  top: string;
  bottom: string;
  /** Wzrost w metrach, od podeszwy do czubka głowy (po powiększeniu głowy). */
  height: number;
  /** Mnożnik szerokości (osie X i Z): „tusza”. */
  width: number;
  accessory: 'none' | 'backpack' | 'bag' | 'phone';
}

const ACCESSORY_WEIGHTS: ReadonlyArray<readonly [Appearance['accessory'], number]> = [
  ['none', 0.5], ['backpack', 0.2], ['bag', 0.2], ['phone', 0.1],
];

/** Odległość dwóch kolorów #rrggbb w sRGB (0..√3). Ubranie zbyt zbliżone do skóry czytałoby się jak jej brak. */
function colorDistance(a: string, b: string): number {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return Math.hypot(channel(a, 0) - channel(b, 0), channel(a, 1) - channel(b, 1), channel(a, 2) - channel(b, 2));
}
export const MIN_CLOTHES_SKIN_DISTANCE = 0.3;

export function pickAppearance(seed: string): Appearance {
  const rng = createRng(subSeed(seed, 'appearance'));
  const body: Appearance['body'] = rng.chance(0.5) ? 'male' : 'female';
  const skin = rng.pick(PALETTE.skin);
  const hair = rng.pick(PALETTE.hair);
  const visible = PALETTE.clothes.filter((c) => colorDistance(c, skin) >= MIN_CLOTHES_SKIN_DISTANCE);
  const top = rng.pick(visible);
  const bottom = rng.pick(visible.filter((c) => c !== top));

  // Kobiety statystycznie niżsi, ale oba zakresy zostają w całości w heightRange.
  const [lo, hi] = CHARACTER_STYLE.heightRange;
  const t = body === 'male' ? 0.25 + 0.75 * rng.next() : 0.75 * rng.next();
  const height = lo + (hi - lo) * t;
  const width = rng.range(CHARACTER_STYLE.widthRange[0], CHARACTER_STYLE.widthRange[1]);

  let roll = rng.next();
  let accessory: Appearance['accessory'] = 'none';
  for (const [kind, weight] of ACCESSORY_WEIGHTS) {
    if (roll < weight) { accessory = kind; break; }
    roll -= weight;
  }
  return { body, skin, hair, top, bottom, height, width, accessory };
}
