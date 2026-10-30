/*
 * Geometria samouczka bez DOM: gdzie postawić dymek przy wskazanym elemencie, żeby go nie zasłonił (spec samouczka, §11), oraz
 * prostokąty, które blokują kliknięcia poza „dziurą” w przygaszeniu. Warstwy w `Tutorial.tsx` mierzą elementy i wołają te funkcje.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export type Side = 'below' | 'above' | 'right' | 'left' | 'center';

/**
 * Wynik `placeBubble`: lewy górny róg dymka, strona celu, przesunięcie strzałki wzdłuż krawędzi dymka (od lewej przy `below`/`above`,
 * od góry przy `left`/`right`) i `covers`: żadna strona nie pasowała, więc dymek stoi tam, gdzie miejsca było najwięcej.
 */
export interface Placement { x: number; y: number; side: Side; arrow: number; covers: boolean }

/** Odstęp dymka od kotwicy. */
export const GAP = 12;
/** Najmniejszy odstęp dymka od krawędzi okna. */
export const MARGIN = 8;
/** Pierścień wokół wskazanego elementu. */
export const RING = 6;
/** Strzałka nie schodzi bliżej rogu dymka niż tyle pikseli. */
export const ARROW_INSET = 16;

const clamp = (v: number, lo: number, hi: number): number => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));
const right = (r: Rect): number => r.x + r.w;
const bottom = (r: Rect): number => r.y + r.h;

export const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

/** Czy prostokąty mają wspólne pole (same krawędzie się nie liczą). */
export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

/** Prostokąt przycięty do wszystkich `clips` (przewijani przodkowie elementu); null, gdy nic nie zostaje. */
export function clipRect(r: Rect, clips: readonly Rect[]): Rect | null {
  let x0 = r.x, y0 = r.y, x1 = right(r), y1 = bottom(r);
  for (const c of clips) {
    x0 = Math.max(x0, c.x);
    y0 = Math.max(y0, c.y);
    x1 = Math.min(x1, right(c));
    y1 = Math.min(y1, bottom(c));
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const contains = (outer: Rect, x: number, y: number): boolean => x >= outer.x && x <= right(outer) && y >= outer.y && y <= bottom(outer);

/** Strony kotwicy w kolejności prób: najpierw pion w stronę środka ekranu, potem pion przeciwny, potem poziom tak samo. */
function sidesFor(anchor: Rect, view: Size): Side[] {
  const vertical: Side[] = anchor.y + anchor.h / 2 < view.h / 2 ? ['below', 'above'] : ['above', 'below'];
  const horizontal: Side[] = anchor.x + anchor.w / 2 < view.w / 2 ? ['right', 'left'] : ['left', 'right'];
  return [...vertical, ...horizontal];
}

/** Pozycja dymka po stronie `side` kotwicy, wyrównana do środka celu (`cx`, `cy`) i docięta do okna. */
function boxAt(side: Side, anchor: Rect, bubble: Size, view: Size, cx: number, cy: number): Rect {
  const alongX = clamp(cx - bubble.w / 2, MARGIN, view.w - MARGIN - bubble.w);
  const alongY = clamp(cy - bubble.h / 2, MARGIN, view.h - MARGIN - bubble.h);
  switch (side) {
    case 'below': return { x: alongX, y: bottom(anchor) + GAP, ...bubble };
    case 'above': return { x: alongX, y: anchor.y - GAP - bubble.h, ...bubble };
    case 'right': return { x: right(anchor) + GAP, y: alongY, ...bubble };
    default: return { x: anchor.x - GAP - bubble.w, y: alongY, ...bubble };
  }
}

const fitsView = (r: Rect, view: Size): boolean =>
  r.x >= MARGIN && r.y >= MARGIN && right(r) <= view.w - MARGIN && bottom(r) <= view.h - MARGIN;

/** Ile miejsca jest po stronie `side` prostokąta w oknie. */
function room(side: Side, r: Rect, view: Size): number {
  switch (side) {
    case 'below': return view.h - bottom(r);
    case 'above': return r.y;
    case 'right': return view.w - right(r);
    default: return r.x;
  }
}

function placed(box: Rect, side: Side, cx: number, cy: number, covers: boolean): Placement {
  const vertical = side === 'below' || side === 'above';
  const arrow = vertical ? clamp(cx - box.x, ARROW_INSET, box.w - ARROW_INSET) : clamp(cy - box.y, ARROW_INSET, box.h - ARROW_INSET);
  return { x: box.x, y: box.y, side, arrow, covers };
}

/**
 * Dymek o wymiarach `bubble` przy celu `target` w oknie `view` (spec samouczka, §11). Bez celu: środek ekranu. Cel w kontenerze
 * (otwarty arkusz zakładki albo panel) najpierw stawia dymek przy krawędzi kontenera, żeby nie zasłonić jego treści; gdy wokół
 * kontenera nie ma miejsca, dymek staje przy samym celu. Strona pasuje, gdy dymek mieści się w oknie z marginesem i nie przecina
 * ani celu z pierścieniem, ani (w pierwszym podejściu) kontenera. Gdy nic nie pasuje: strona z największym miejscem i `covers`.
 */
export function placeBubble(target: Rect | null, bubble: Size, view: Size, container: Rect | null = null): Placement {
  if (!target) {
    return { x: (view.w - bubble.w) / 2, y: (view.h - bubble.h) / 2, side: 'center', arrow: 0, covers: false };
  }
  const ring = inflate(target, RING);
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const attempts: { anchor: Rect; avoid: Rect[] }[] = [];
  if (container && contains(container, cx, cy)) attempts.push({ anchor: container, avoid: [container, ring] });
  attempts.push({ anchor: ring, avoid: [ring] });
  for (const { anchor, avoid } of attempts) {
    for (const side of sidesFor(anchor, view)) {
      const box = boxAt(side, anchor, bubble, view, cx, cy);
      if (fitsView(box, view) && !avoid.some((a) => intersects(box, a))) return placed(box, side, cx, cy, false);
    }
  }
  const best = sidesFor(ring, view).reduce((a, b) => (room(b, ring, view) > room(a, ring, view) ? b : a));
  const raw = boxAt(best, ring, bubble, view, cx, cy);
  const box = { ...raw, x: clamp(raw.x, MARGIN, view.w - MARGIN - bubble.w), y: clamp(raw.y, MARGIN, view.h - MARGIN - bubble.h) };
  return placed(box, best, cx, cy, true);
}

/**
 * Cztery prostokąty wokół dziury `hole` (docięte do okna): góra, dół, lewo i prawo. Razem z dziurą pokrywają całe okno, a na dziurę
 * nie zachodzą, więc kliknięcia przechodzą tylko przez nią.
 */
export function blockersAround(hole: Rect, view: Size): Rect[] {
  const x0 = clamp(hole.x, 0, view.w);
  const y0 = clamp(hole.y, 0, view.h);
  const x1 = clamp(right(hole), x0, view.w);
  const y1 = clamp(bottom(hole), y0, view.h);
  return [
    { x: 0, y: 0, w: view.w, h: y0 },
    { x: 0, y: y1, w: view.w, h: view.h - y1 },
    { x: 0, y: y0, w: x0, h: y1 - y0 },
    { x: x1, y: y0, w: view.w - x1, h: y1 - y0 },
  ];
}
