import { BufferAttribute, BufferGeometry, type Object3D } from 'three';
import type { Facing } from '@/sim/store/types';
import type { WallSide } from './shell';

/**
 * Przekrój (cutaway) mebli przy ścianach. Ściany od strony kamery spadają do 0,5 m (`buildStore`), a mebel, który stoi
 * przy takiej ścianie, mógłby zasłaniać wnętrze: regał z papierosami za kasą chowa kasjera przy dwóch z czterech kątów.
 * Mebel, który ma się ciąć razem ze ścianą, opisuje to w `userData.cutaway` (`Cutaway`), a `buildStore` wyłącza wtedy jego
 * część nad `height` i pokazuje zamknięcie przekroju.
 */

export type YawIndex = 0 | 1 | 2 | 3;

/** Opis meblu, który tnie się razem ze ścianą za nim (`Object3D.userData.cutaway`, ustawia go budowniczy mebla). */
export interface Cutaway {
  /** Wysokość cięcia (m od podłogi): wszystko powyżej znika, gdy ściana za meblem jest ścięta. */
  height: number;
  /** Zamknięcie przekroju: osobny obiekt w układzie mebla (jak zwracany `root`, z początkiem w rogu footprintu; położenie ustawia `buildStore`). */
  cap: Object3D;
}

/** Które ściany są bliżej kamery dla danego `yawIndex`. Ściana działowa zaplecza idzie ze ścianą tylną. */
const NEAR_WALLS: Record<YawIndex, readonly WallSide[]> = {
  0: ['front', 'left'],
  1: ['back', 'mid', 'left'],
  2: ['back', 'mid', 'right'],
  3: ['front', 'right'],
};

/** Ściany obniżone do przekroju przy danym kącie kamery; widok z zewnątrz pokazuje wszystkie w pełnej wysokości. */
export function loweredWalls(yaw: YawIndex, exterior: boolean): readonly WallSide[] {
  return exterior ? [] : NEAR_WALLS[yaw];
}

/**
 * Ściana, przy której stoi mebel: ta za jego plecami, po przeciwnej stronie frontu (`facing` to strona klienta).
 * N stoi tyłem do ściany działowej zaplecza (tak stoją lodówki), nie do tylnej: w zapleczu nie ma mebli z przekrojem.
 */
export function wallBehind(facing: Facing): WallSide {
  switch (facing) {
    case 'E': return 'left';
    case 'W': return 'right';
    case 'S': return 'front';
    case 'N': return 'mid';
  }
}

/** Wierzchołek jako lista wartości kolejnych atrybutów (każdy atrybut to lista składowych). */
type Vertex = number[][];

const lerp = (a: Vertex, b: Vertex, t: number): Vertex => a.map((va, i) => va.map((x, k) => x + (b[i]![k]! - x) * t));
const SAME_POINT = 1e-9;

/** Ten sam punkt (po położeniu) jako sąsiedni w wielokącie: zdegenerowany bok, który dałby trójkąt o zerowym polu. */
function dropRepeats(polygon: Vertex[], at: number): Vertex[] {
  return polygon.filter((v, i) => {
    const next = polygon[(i + 1) % polygon.length]!;
    return v[at]!.some((x, k) => Math.abs(x - next[at]![k]!) > SAME_POINT);
  });
}

/**
 * Tnie geometrię płaszczyzną y = `h` (w układzie, w którym leży: dla scalonych siatek sklepu to układ świata) na trójkąty
 * pod nią i nad nią. Trójkąt przecięty płaszczyzną jest dzielony: nowe wierzchołki leżą dokładnie na niej, a wszystkie atrybuty
 * (położenie, normalne, uv) są interpolowane liniowo, więc rysowana powierzchnia i jej cieniowanie zostają bez zmian. Trójkąty
 * po jednej stronie przechodzą bez zmian, zwrot ścian jest zachowany. Wejście zostaje nietknięte; część pusta to `null`.
 * Wynik jest bez indeksu (geometria z indeksem jest najpierw rozwijana).
 */
export function splitAtHeight(source: BufferGeometry, h: number): { below: BufferGeometry | null; above: BufferGeometry | null } {
  const geometry = source.index ? source.toNonIndexed() : source;
  const names = Object.keys(geometry.attributes);
  const attributes = names.map((n) => geometry.getAttribute(n));
  const at = names.indexOf('position');
  if (at < 0) throw new Error('splitAtHeight: geometria bez położenia');
  const vertex = (i: number): Vertex => attributes.map((a) => Array.from({ length: a.itemSize }, (_, k) => a.getComponent(i, k)));
  const y = (v: Vertex): number => v[at]![1]!;

  const low: Vertex[] = [];
  const high: Vertex[] = [];
  const EPS = 1e-6;
  const fan = (polygon: Vertex[], out: Vertex[]): void => {
    const p = dropRepeats(polygon, at);
    for (let i = 1; i + 1 < p.length; i++) out.push(p[0]!, p[i]!, p[i + 1]!);
  };
  for (let i = 0; i < attributes[at]!.count; i += 3) {
    const tri = [vertex(i), vertex(i + 1), vertex(i + 2)];
    const heights = tri.map(y);
    if (Math.max(...heights) <= h + EPS) { low.push(...tri); continue; }
    if (Math.min(...heights) >= h - EPS) { high.push(...tri); continue; }
    // Przecięty trójkąt: idziemy po bokach, wierzchołki trafiają do swojej strony, a punkt przecięcia do obu.
    const lowPoly: Vertex[] = [];
    const highPoly: Vertex[] = [];
    for (let k = 0; k < 3; k++) {
      const p = tri[k]!, q = tri[(k + 1) % 3]!;
      const pLow = y(p) <= h, qLow = y(q) <= h;
      (pLow ? lowPoly : highPoly).push(p);
      if (pLow !== qLow) {
        const cut = lerp(p, q, (h - y(p)) / (y(q) - y(p)));
        cut[at]![1] = h;   // dokładnie na płaszczyźnie, bez dryfu zmiennoprzecinkowego
        lowPoly.push(cut);
        highPoly.push(cut);
      }
    }
    fan(lowPoly, low);
    fan(highPoly, high);
  }

  const build = (vertices: Vertex[]): BufferGeometry | null => {
    if (vertices.length === 0) return null;
    const out = new BufferGeometry();
    names.forEach((name, i) => {
      const itemSize = attributes[i]!.itemSize;
      const data = new Float32Array(vertices.length * itemSize);
      vertices.forEach((v, j) => data.set(v[i]!, j * itemSize));
      out.setAttribute(name, new BufferAttribute(data, itemSize));
    });
    return out;
  };
  const result = { below: build(low), above: build(high) };
  if (geometry !== source) geometry.dispose();
  return result;
}
