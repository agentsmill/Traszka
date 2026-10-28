import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { describe, expect, it } from 'vitest';
import type { Facing } from '@/sim/store/types';
import { WALL_SIDES } from './shell';
import { loweredWalls, splitAtHeight, wallBehind } from './cutaway';

/** Trójkąty geometrii bez indeksu jako trójki punktów. */
function trianglesOf(g: BufferGeometry): Vector3[][] {
  const p = g.getAttribute('position');
  const out: Vector3[][] = [];
  for (let i = 0; i < p.count; i += 3) out.push([0, 1, 2].map((k) => new Vector3().fromBufferAttribute(p, i + k)));
  return out;
}
const areaOf = (t: Vector3[]): number => new Vector3().subVectors(t[1]!, t[0]!).cross(new Vector3().subVectors(t[2]!, t[0]!)).length() / 2;
const totalArea = (g: BufferGeometry | null): number => (g ? trianglesOf(g).reduce((n, t) => n + areaOf(t), 0) : 0);
const ys = (g: BufferGeometry): number[] => trianglesOf(g).flat().map((v) => v.y);

/** Bryła 1 × 2 × 1 stojąca na y = 0 (zaokrąglona jak meble: normalne gładkie na fazach; RoundedBoxGeometry jest bez indeksu). */
function pillar(): BufferGeometry {
  return new RoundedBoxGeometry(1, 2, 1, 3, 0.04).translate(0, 1, 0);
}

describe('splitAtHeight: cięcie geometrii płaszczyzną y = h', () => {
  it('dzieli bryłę na część pod i nad płaszczyzną: nic nie wystaje poza swoją stronę, a pole obu części razem to pole całości', () => {
    const source = pillar();
    const { below, above } = splitAtHeight(source, 0.7);
    expect(below).not.toBeNull();
    expect(above).not.toBeNull();
    expect(Math.max(...ys(below!))).toBeCloseTo(0.7, 6);   // położenia są w Float32
    expect(Math.min(...ys(below!))).toBeCloseTo(0, 6);
    expect(Math.min(...ys(above!))).toBeCloseTo(0.7, 6);
    expect(Math.max(...ys(above!))).toBeCloseTo(2, 6);
    expect(totalArea(below) + totalArea(above)).toBeCloseTo(totalArea(source), 4);
    expect(totalArea(below)).toBeLessThan(totalArea(above));   // 0,7 m z 2 m wysokości
  });

  it('bryła w całości pod płaszczyzną zostaje cała pod, a w całości nad nią cała nad (bez pustych trójkątów i bez kopii połówek)', () => {
    const source = pillar();
    const low = splitAtHeight(source, 5);
    expect(low.above).toBeNull();
    expect(trianglesOf(low.below!)).toHaveLength(trianglesOf(source).length);
    const high = splitAtHeight(source, -1);
    expect(high.below).toBeNull();
    expect(trianglesOf(high.above!)).toHaveLength(trianglesOf(source).length);
  });

  it('trójkąty, których nie przecina płaszczyzna, przechodzą bez zmian: cięcie dokłada tylko trójkąty przy samym przekroju', () => {
    const source = pillar();
    const n = trianglesOf(source).length;
    const { below, above } = splitAtHeight(source, 0.7);
    const crossing = trianglesOf(source).filter((t) => Math.min(...t.map((v) => v.y)) < 0.7 - 1e-6 && Math.max(...t.map((v) => v.y)) > 0.7 + 1e-6).length;
    expect(crossing).toBeGreaterThan(0);
    const count = trianglesOf(below!).length + trianglesOf(above!).length;
    expect(count).toBeGreaterThanOrEqual(n);
    expect(count).toBeLessThanOrEqual(n + 2 * crossing);   // każdy przecięty trójkąt daje najwyżej 3 kawałki (zamiast 1): +2
  });

  it('kawałki zachowują zwrot ścian: normalna z wierzchołków zgadza się z normalną geometryczną trójkąta', () => {
    const { below, above } = splitAtHeight(new RoundedBoxGeometry(1, 2, 1, 1, 0.001).translate(0, 1, 0), 0.7);
    for (const g of [below!, above!]) {
      const n = g.getAttribute('normal');
      trianglesOf(g).forEach((t, i) => {
        const geometric = new Vector3().subVectors(t[1]!, t[0]!).cross(new Vector3().subVectors(t[2]!, t[0]!));
        if (geometric.length() < 1e-12) return;
        const stored = new Vector3().fromBufferAttribute(n, 3 * i);
        expect(geometric.normalize().dot(stored.normalize())).toBeGreaterThan(0);
      });
    }
  });

  it('atrybuty w nowych wierzchołkach są interpolowane liniowo (położenie, normalna, uv), a w starych zostają', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 2, 0], 3));
    g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 0, 0], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    const { below, above } = splitAtHeight(g, 1);                       // płaszczyzna w połowie krawędzi (0,0,0)-(0,2,0)
    const cutPoint = (geometry: BufferGeometry): number => {
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - 1) < 1e-9 && Math.abs(p.getX(i)) < 1e-9) return i;
      return -1;
    };
    const i = cutPoint(below!);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(below!.getAttribute('normal').getX(i)).toBeCloseTo(0.5, 9);     // połowa drogi od (0,0,1) do (1,0,0)
    expect(below!.getAttribute('normal').getZ(i)).toBeCloseTo(0.5, 9);
    expect(below!.getAttribute('uv').getY(i)).toBeCloseTo(0.5, 9);
    const j = cutPoint(above!);
    expect(above!.getAttribute('uv').getY(j)).toBeCloseTo(0.5, 9);
    expect(totalArea(below) + totalArea(above)).toBeCloseTo(totalArea(g), 9);
  });

  it('wierzchołek leżący dokładnie na płaszczyźnie nie robi zdegenerowanych trójkątów', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 1, 0, 0, 0, 1, 0], 3));   // y = −1, 0, 1: środkowy dokładnie na płaszczyźnie y = 0
    g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    const { below, above } = splitAtHeight(g, 0);
    for (const half of [below!, above!]) for (const t of trianglesOf(half)) expect(areaOf(t)).toBeGreaterThan(1e-6);
    expect(totalArea(below) + totalArea(above)).toBeCloseTo(totalArea(g), 9);
  });

  it('nie rusza wejścia (geometria źródłowa zostaje cała), a geometria z indeksem też się tnie', () => {
    const indexed = new BoxGeometry(1, 2, 1, 2, 2, 2).translate(0, 1, 0);
    expect(indexed.index).not.toBeNull();
    const before = indexed.getAttribute('position').count;
    const { below, above } = splitAtHeight(indexed, 0.7);
    expect(indexed.getAttribute('position').count).toBe(before);
    expect(indexed.index).not.toBeNull();
    expect(totalArea(below) + totalArea(above)).toBeCloseTo(10, 4);   // pole bryły 1 × 2 × 1
  });
});

describe('wallBehind: ściana za meblem to ta po przeciwnej stronie frontu', () => {
  it('E → lewa (x najmniejsze), W → prawa, S → frontowa (od ulicy), N → działowa zaplecza (tak stoją lodówki)', () => {
    const expected: Record<Facing, string> = { E: 'left', W: 'right', S: 'front', N: 'mid' };
    for (const facing of ['N', 'E', 'S', 'W'] as const) expect(wallBehind(facing)).toBe(expected[facing]);
  });
});

describe('loweredWalls: które ściany spadają do przekroju', () => {
  it('tabela z CameraRig: yaw 0 front+lewa, 1 tylna+działowa+lewa, 2 tylna+działowa+prawa, 3 front+prawa; widok z zewnątrz nie obniża żadnej', () => {
    expect([...loweredWalls(0, false)].sort()).toEqual(['front', 'left']);
    expect([...loweredWalls(1, false)].sort()).toEqual(['back', 'left', 'mid']);
    expect([...loweredWalls(2, false)].sort()).toEqual(['back', 'mid', 'right']);
    expect([...loweredWalls(3, false)].sort()).toEqual(['front', 'right']);
    for (const yaw of [0, 1, 2, 3] as const) expect(loweredWalls(yaw, true)).toEqual([]);
    for (const yaw of [0, 1, 2, 3] as const) for (const side of loweredWalls(yaw, false)) expect(WALL_SIDES).toContain(side);
  });
});
