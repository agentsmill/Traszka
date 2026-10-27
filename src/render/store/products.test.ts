import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Box3, Color, InstancedMesh, LatheGeometry, Matrix4, Vector3, type Group, type MeshStandardMaterial } from 'three';
import { CELL_SIZE_M } from '@/sim/grid';
import { generateStore } from '@/sim/store/generateStore';
import type { StoreLayout } from '@/sim/store/types';
import { cellToWorld } from '@/render/coords';
import { PALETTE } from '@/render/style';
import { buildStore, type ShelfSlot, type StoreView } from './buildStore';
import { fillShelves } from './products';

const SEED = 'kiełbasa-42';
const SHAPES = ['box', 'bottle', 'can', 'bag', 'carton', 'jar'];

function instancedOf(g: Group): InstancedMesh[] {
  const out: InstancedMesh[] = [];
  g.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) out.push(o as InstancedMesh); });
  return out;
}

const capacity = (slots: readonly ShelfSlot[]): number =>
  slots.reduce((n, s) => n + Math.floor(s.width / 0.12) * s.levels, 0);

/** Lokalny układ półki: x wzdłuż długości, z do klienta, y od wierzchu najniższej półki. */
function toSlotLocal(s: ShelfSlot, p: Vector3): Vector3 {
  const dx = p.x - s.position[0];
  const dz = p.z - s.position[2];
  const c = Math.cos(s.rotationY);
  const sn = Math.sin(s.rotationY);
  return new Vector3(dx * c - dz * sn, p.y - s.position[1], dx * sn + dz * c);
}

interface Placed { mesh: InstancedMesh; index: number; matrix: Matrix4; box: Box3; center: Vector3; color: Color }
function placedInstances(g: Group): Placed[] {
  const out: Placed[] = [];
  const m = new Matrix4();
  for (const mesh of instancedOf(g)) {
    mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const color = new Color();
      mesh.getColorAt(i, color);
      const box = mesh.geometry.boundingBox!.clone().applyMatrix4(m);
      out.push({ mesh, index: i, matrix: m.clone(), box, center: box.getCenter(new Vector3()), color });
    }
  }
  return out;
}

/** Półka, na której leży instancja: środek bryły w obrysie półki (z zapasem) i nad jej najniższym poziomem. */
function slotOf(slots: readonly ShelfSlot[], p: Placed): ShelfSlot | undefined {
  return slots.find((s) => {
    const l = toSlotLocal(s, p.center);
    return Math.abs(l.x) <= s.width / 2 && Math.abs(l.z) <= s.depth / 2 && l.y > -0.01 && l.y < s.levels * s.levelStep;
  });
}

describe(`fillShelves(buildStore(generateStore('${SEED}')), '${SEED}')`, () => {
  const layout = generateStore(SEED);
  const view: StoreView = buildStore(layout);
  const goods = fillShelves(view, SEED);
  const meshes = instancedOf(goods);
  const placed = placedInstances(goods);

  it('liczba instancji ≥ 80% pojemności półek (suma floor(width / 0,12) × levels)', () => {
    const total = meshes.reduce((n, m) => n + m.count, 0);
    expect(capacity(view.shelfSlots)).toBeGreaterThan(100);
    expect(total).toBeGreaterThanOrEqual(0.8 * capacity(view.shelfSlots));
  });

  it('≤ 8 obiektów InstancedMesh, po jednym na kształt: box, bottle, can, bag, carton, jar', () => {
    expect(meshes.length).toBeLessThanOrEqual(8);
    expect(meshes.map((m) => m.name).sort()).toEqual([...SHAPES].sort());
    for (const m of meshes) expect(m.count, m.name).toBeGreaterThan(0);
    expect(meshes.find((m) => m.name === 'bottle')!.geometry).toBeInstanceOf(LatheGeometry);
    // wszystko w grupie to InstancedMesh (a nie tysiące zwykłych siatek)
    let objects = 0;
    goods.traverse(() => { objects++; });
    expect(objects).toBe(1 + meshes.length);
  });

  it('kolor per instancja (setColorAt) na białej bazie materiału', () => {
    for (const m of meshes) {
      expect(m.instanceColor, m.name).not.toBeNull();
      expect((m.material as MeshStandardMaterial).color.getHexString(), m.name).toBe('ffffff');
    }
  });

  it('każda instancja leży na swojej półce, w jej obrysie, i mieści się pod półką wyżej (wysokość ≤ levelStep − 0,04)', () => {
    expect(placed.length).toBeGreaterThan(0);
    for (const p of placed) {
      const s = slotOf(view.shelfSlots, p);
      expect(s, `${p.mesh.name}#${p.index} poza każdą półką`).toBeDefined();
      const min = toSlotLocal(s!, new Vector3(p.box.min.x, p.box.min.y, p.box.min.z));
      const levelBottom = min.y;
      const level = Math.round(levelBottom / s!.levelStep);
      // spód leży na wierzchu półki swojego poziomu
      expect(Math.abs(levelBottom - level * s!.levelStep), `${p.mesh.name}#${p.index} spód`).toBeLessThan(0.002);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThan(s!.levels);
      const height = p.box.max.y - p.box.min.y;
      expect(height, `${p.mesh.name}#${p.index} wysokość`).toBeLessThanOrEqual(s!.levelStep - 0.04);
      // wszystkie narożniki obrysu bryły (przed obrotem) mieszczą się w prostokącie półki
      const gb = p.mesh.geometry.boundingBox!;
      for (const x of [gb.min.x, gb.max.x]) for (const y of [gb.min.y, gb.max.y]) for (const z of [gb.min.z, gb.max.z]) {
        const l = toSlotLocal(s!, new Vector3(x, y, z).applyMatrix4(p.matrix));
        expect(Math.abs(l.x), `${p.mesh.name}#${p.index} wzdłuż półki`).toBeLessThanOrEqual(s!.width / 2);
        expect(Math.abs(l.z), `${p.mesh.name}#${p.index} w głąb półki`).toBeLessThanOrEqual(s!.depth / 2);
      }
    }
  });

  it('kolory pochodzą z PALETTE.productCategory[kategoria półki] (tylko odcień jasności się waha)', () => {
    const dir = (c: Color): [number, number, number] => {
      const m = Math.max(c.r, c.g, c.b);
      return [c.r / m, c.g / m, c.b / m];
    };
    for (const p of placed) {
      const s = slotOf(view.shelfSlots, p)!;
      const family = PALETTE.productCategory[s.category].map((h) => new Color(h));
      const ok = family.some((f) => {
        const a = dir(f);
        const b = dir(p.color);
        const scale = Math.max(p.color.r, p.color.g, p.color.b) / Math.max(f.r, f.g, f.b);
        return a.every((v, i) => Math.abs(v - b[i]!) < 0.01) && scale > 0.85 && scale <= 1.0001;
      });
      expect(ok, `${p.mesh.name}#${p.index} kolor ${p.color.getHexString()} spoza kategorii ${s.category}`).toBe(true);
    }
  });

  it('lodówki: tylko butelki i kartony; gondole i regały: mieszanka ≥ 3 kształtów', () => {
    const kindOf = (s: ShelfSlot): string => layout.fixtures.find((f) => f.id === s.fixtureId)!.kind;
    const shapesBy = new Map<string, Set<string>>();
    for (const p of placed) {
      const s = slotOf(view.shelfSlots, p)!;
      const kind = kindOf(s);
      (shapesBy.get(kind) ?? shapesBy.set(kind, new Set()).get(kind)!).add(p.mesh.name);
    }
    expect([...shapesBy.get('fridge')!].sort()).toEqual(['bottle', 'carton']);
    expect(shapesBy.get('gondola')!.size).toBeGreaterThanOrEqual(3);
    expect(shapesBy.get('wallShelf')!.size).toBeGreaterThanOrEqual(3);
  });

  it('towar zgadza się z kategorią półki także w obrębie jednej gondoli (strona A ≠ strona B)', () => {
    const byFixture = new Map<string, Set<string>>();
    for (const s of view.shelfSlots.filter((x) => layout.fixtures.find((f) => f.id === x.fixtureId)!.kind === 'gondola')) {
      (byFixture.get(s.fixtureId) ?? byFixture.set(s.fixtureId, new Set()).get(s.fixtureId)!).add(s.category);
    }
    expect([...byFixture.values()].some((set) => set.size === 2)).toBe(true);
  });

  it('dispose() widoku zwalnia bufory instancji towaru (zdarzenie dispose na każdym InstancedMesh)', () => {
    const v = buildStore(layout);
    const g = fillShelves(v, SEED);
    v.root.add(g);
    let disposed = 0;
    for (const m of instancedOf(g)) m.addEventListener('dispose', () => { disposed++; });
    v.dispose();
    expect(disposed).toBe(instancedOf(g).length);
    expect(() => v.dispose()).not.toThrow();
  });
});

describe('fillShelves: determinizm i losowość', () => {
  const layout = generateStore(SEED);

  const firstMatrices = (g: Group, n = 10): number[][] =>
    instancedOf(g).sort((a, b) => a.name.localeCompare(b.name)).map((m) => Array.from(m.instanceMatrix.array.slice(0, n * 16)));
  const counts = (g: Group): number[] => instancedOf(g).sort((a, b) => a.name.localeCompare(b.name)).map((m) => m.count);

  it('ten sam seed daje identyczne macierze pierwszych 10 instancji (i identyczne liczby instancji)', () => {
    const a = fillShelves(buildStore(layout), SEED);
    const b = fillShelves(buildStore(layout), SEED);
    expect(firstMatrices(a)).toEqual(firstMatrices(b));
    expect(counts(a)).toEqual(counts(b));
  });

  it('inny seed daje inne ułożenie towaru na tych samych półkach', () => {
    const view = buildStore(layout);
    const a = fillShelves(view, SEED);
    const b = fillShelves(view, 'inny-seed');
    expect(firstMatrices(a)).not.toEqual(firstMatrices(b));
  });

  it('źródło nie używa Math.random (losowość tylko z createRng(subSeed(seed, "products")))', () => {
    const src = readFileSync('src/render/store/products.ts', 'utf8');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).toMatch(/createRng\(subSeed\(seed, 'products'\)\)/);
  });
});

/**
 * Kontrakt `shelfSlots` (RULING R21): konsument (Task 9) przypina to, na czym polega. Środek półki leży w obrysie
 * swojego mebla, a 5 cm za jej przednią krawędzią (w stronę klienta) nie ma ściany.
 */
describe('kontrakt shelfSlots', () => {
  for (const seed of ['kiełbasa-42', 'kiełbasa-12', 'traszka-1']) {
    describe(seed, () => {
      const layout: StoreLayout = generateStore(seed);
      const view = buildStore(layout);
      const tol = 0.01;

      it('środek półki (x, z) leży w obrysie mebla (tolerancja 1 cm)', () => {
        expect(view.shelfSlots.length).toBeGreaterThan(0);
        for (const s of view.shelfSlots) {
          const f = layout.fixtures.find((x) => x.id === s.fixtureId);
          expect(f, s.fixtureId).toBeDefined();
          const lo = cellToWorld(layout, f!.x, f!.y);
          const hi = cellToWorld(layout, f!.x + f!.w - 1, f!.y + f!.d - 1);
          const [x, , z] = s.position;
          expect(x, `${s.fixtureId} x`).toBeGreaterThanOrEqual(lo.x - CELL_SIZE_M / 2 - tol);
          expect(x, `${s.fixtureId} x`).toBeLessThanOrEqual(hi.x + CELL_SIZE_M / 2 + tol);
          expect(z, `${s.fixtureId} z`).toBeGreaterThanOrEqual(lo.z - CELL_SIZE_M / 2 - tol);
          expect(z, `${s.fixtureId} z`).toBeLessThanOrEqual(hi.z + CELL_SIZE_M / 2 + tol);
        }
      });

      it('punkt 5 cm za przednią krawędzią półki (w stronę klienta) nie leży w kratce ściany', () => {
        for (const s of view.shelfSlots) {
          const reach = s.depth / 2 + 0.05;
          const x = s.position[0] + reach * Math.sin(s.rotationY);
          const z = s.position[2] + reach * Math.cos(s.rotationY);
          const cx = Math.floor(x / CELL_SIZE_M + layout.width / 2);
          const cy = Math.floor(z / CELL_SIZE_M + layout.depth / 2);
          const cell = layout.cells[cy * layout.width + cx];
          expect(cell, `${s.fixtureId} (${cx}, ${cy}) poza siatką`).toBeDefined();
          expect(cell, `${s.fixtureId} (${cx}, ${cy}): przód półki zwrócony w ścianę`).not.toBe('wall');
        }
      });
    });
  }
});
