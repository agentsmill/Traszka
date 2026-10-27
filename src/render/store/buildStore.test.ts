import { describe, expect, it } from 'vitest';
import { Box3, Mesh, PointLight, type BufferGeometry, type Material, type Object3D } from 'three';
import { generateStore } from '@/sim/store/generateStore';
import type { Facing, Fixture, FixtureKind, StoreLayout } from '@/sim/store/types';
import { CELL_SIZE_M } from '@/sim/grid';
import { PALETTE } from '@/render/style';
import { buildStore, FIXTURE_BUILDERS, type StoreView } from './buildStore';
import { buildSelfCheckout } from './fixtures';
import { makeSignTexture } from './signTexture';

const SEED = 'kiełbasa-42';
const layout = generateStore(SEED);
const KINDS = Object.keys(FIXTURE_BUILDERS) as FixtureKind[];

/**
 * Największe meble, jakie generuje generateStore (gondola 4 m, regał ścienny 4 m, tytoń 4,5 m, kasa 2,5 m, lodówka 2×2),
 * obrócone tak, żeby długa oś pasowała do kierunku frontu (N/S: długość w x, E/W: długość w y).
 */
function sample(kind: FixtureKind, facing: Facing = 'E'): Fixture {
  const size: Record<FixtureKind, [number, number]> = {
    gondola: [8, 2], wallShelf: [8, 1], fridge: [2, 2], checkout: [5, 1], tobaccoShelf: [9, 1], hotFood: [2, 1], coffee: [1, 1],
    selfCheckoutSlot: [2, 1], equipmentSlot: [2, 2], backroomDoor: [2, 1],
  };
  const [len, dep] = size[kind];
  const horizontal = facing === 'N' || facing === 'S';
  return { id: `${kind}-test`, kind, x: 3, y: 6, w: horizontal ? len : dep, d: horizontal ? dep : len, facing };
}

function meshesOf(o: Object3D): Mesh[] {
  const out: Mesh[] = [];
  o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c as Mesh); });
  return out;
}
const triangles = (g: BufferGeometry): number => (g.index ? g.index.count : g.attributes.position!.count) / 3;
const hex = (m: Material): string => '#' + (m as Mesh['material'] & { color: { getHexString(): string } }).color.getHexString();
/** Najwyższy punkt (m) tego, co faktycznie wisi w scenie pod `o`. */
const topOf = (o: Object3D): number => new Box3().setFromObject(o).max.y;

describe('FIXTURE_BUILDERS (przed scaleniem geometrii)', () => {
  it('ma budowniczego dla każdego rodzaju mebla', () => {
    expect(KINDS.sort()).toEqual(['backroomDoor', 'checkout', 'coffee', 'equipmentSlot', 'fridge', 'gondola', 'hotFood',
      'selfCheckoutSlot', 'tobaccoShelf', 'wallShelf'].sort());
  });

  for (const kind of KINDS) {
    for (const facing of ['N', 'E', 'S', 'W'] as const) {
      it(`${kind} (${facing}): nazwa = id, ≥ ${kind === 'gondola' || kind === 'fridge' ? 8 : 3} siatek, ≤ 10 tys. trójkątów, element w kolorze marki`, () => {
        const f = sample(kind, facing);
        const obj = FIXTURE_BUILDERS[kind](f);
        const meshes = meshesOf(obj);
        expect(obj.name).toBe(f.id);
        expect(meshes.length).toBeGreaterThanOrEqual(kind === 'gondola' || kind === 'fridge' ? 8 : 3);
        expect(meshes.reduce((n, m) => n + triangles(m.geometry), 0)).toBeLessThanOrEqual(10_000);
        const brand = [PALETTE.brand.green, PALETTE.brand.orange, PALETTE.brand.greenDark, PALETTE.brand.cream];
        expect(meshes.some((m) => brand.includes(hex(m.material as Material))), 'brak elementu w kolorze marki').toBe(true);
      });
    }
  }

  it('mebel mieści się w swoim footprincie (origin w lewym-przednim rogu, +x/+z)', () => {
    for (const kind of KINDS) {
      if (kind === 'backroomDoor') continue; // drzwi stoją we wnęce ściany, obrys liczy się osobno
      for (const facing of ['N', 'E', 'S', 'W'] as const) {
        const f = sample(kind, facing);
        const box = new Box3().setFromObject(FIXTURE_BUILDERS[kind](f));
        const eps = 0.06;
        expect(box.min.x, `${kind}/${facing} min.x`).toBeGreaterThanOrEqual(-eps);
        expect(box.min.z, `${kind}/${facing} min.z`).toBeGreaterThanOrEqual(-eps);
        expect(box.max.x, `${kind}/${facing} max.x`).toBeLessThanOrEqual(f.w * CELL_SIZE_M + eps);
        expect(box.max.z, `${kind}/${facing} max.z`).toBeLessThanOrEqual(f.d * CELL_SIZE_M + eps);
      }
    }
  });

  it('wysokości: gondola ≤ 1,6 m, regał ścienny i lodówka ≈ 2,0 m, lada 0,95 m', () => {
    expect(topOf(FIXTURE_BUILDERS.gondola(sample('gondola', 'S')))).toBeLessThanOrEqual(1.6);
    for (const kind of ['wallShelf', 'fridge'] as const) {
      expect(topOf(FIXTURE_BUILDERS[kind](sample(kind)))).toBeGreaterThan(1.9);
      expect(topOf(FIXTURE_BUILDERS[kind](sample(kind)))).toBeLessThanOrEqual(2.1);
    }
    const top = FIXTURE_BUILDERS.checkout(sample('checkout')).getObjectByName('counterTop')!;
    expect(new Box3().setFromObject(top).max.y).toBeCloseTo(0.95, 2);
  });

  it('kasa samoobsługowa (gotowy mebel): słupek, ekran, półka, skaner (≥ 4 siatki)', () => {
    const obj = buildSelfCheckout({ ...sample('selfCheckoutSlot', 'S'), kind: 'selfCheckoutSlot' });
    expect(meshesOf(obj).length).toBeGreaterThanOrEqual(4);
  });

  it('slot ma półprzezroczysty znacznik', () => {
    const meshes = meshesOf(FIXTURE_BUILDERS.equipmentSlot(sample('equipmentSlot')));
    expect(meshes.some((m) => (m.material as Material).transparent)).toBe(true);
  });
});

describe(`buildStore(generateStore('${SEED}'))`, () => {
  const view: StoreView = buildStore(layout);

  it('ma w root obiekt o nazwie każdego fixture.id', () => {
    expect(layout.fixtures.length).toBeGreaterThan(10);
    for (const f of layout.fixtures) expect(view.root.getObjectByName(f.id), f.id).toBeDefined();
  });

  it('shelfSlots: niepuste, wskazują istniejące meble, ≥ 4 poziomy, sensowne wymiary', () => {
    expect(view.shelfSlots.length).toBeGreaterThan(0);
    const ids = new Set(layout.fixtures.map((f) => f.id));
    for (const s of view.shelfSlots) {
      expect(ids.has(s.fixtureId), s.fixtureId).toBe(true);
      expect(s.levels).toBeGreaterThanOrEqual(4);
      expect(s.width).toBeGreaterThan(0.3);
      expect(s.depth).toBeGreaterThan(0.2);
      expect(s.position.every(Number.isFinite)).toBe(true);
    }
    const kinds = new Set(view.shelfSlots.map((s) => layout.fixtures.find((f) => f.id === s.fixtureId)!.kind));
    expect([...kinds].sort()).toEqual(['fridge', 'gondola', 'wallShelf']);
  });

  it('scala geometrię: mało siatek w drzewie (budżet draw calls < 300)', () => {
    const meshes = meshesOf(view.root).filter((m) => m.parent !== null);
    expect(meshes.length).toBeLessThan(150);
  });

  it('setCutaway(yaw) obniża dokładnie dwie ściany od strony kamery do ≤ 0,5 m', () => {
    const expected = [['front', 'left'], ['back', 'left'], ['back', 'right'], ['front', 'right']] as const;
    for (const yaw of [0, 1, 2, 3] as const) {
      view.setCutaway(yaw);
      for (const side of ['front', 'back', 'left', 'right'] as const) {
        const wall = view.root.getObjectByName(`wall:${side}`);
        expect(wall, `wall:${side}`).toBeDefined();
        const lowered = expected[yaw].includes(side as never);
        const top = topOf(wall!);
        if (lowered) expect(top, `yaw ${yaw} ${side}`).toBeLessThanOrEqual(0.5 + 1e-6);
        else expect(top, `yaw ${yaw} ${side}`).toBeGreaterThanOrEqual(3.0);
      }
    }
  });

  it('setExteriorMode(true) przywraca pełne ściany i pokazuje szyld; false wraca do przekroju', () => {
    view.setCutaway(0);
    const front = view.root.getObjectByName('wall:front')!;
    expect(topOf(front)).toBeLessThanOrEqual(0.5 + 1e-6);
    view.setExteriorMode(true);
    expect(topOf(front)).toBeGreaterThanOrEqual(3.0);
    expect(topOf(view.root.getObjectByName('wall:left')!)).toBeGreaterThanOrEqual(3.0);
    view.setExteriorMode(false);
    expect(topOf(front)).toBeLessThanOrEqual(0.5 + 1e-6);
    view.setCutaway(0);
  });

  it('noc: ≤ 6 ciepłych świateł punktowych bez cieni, włączonych tylko w nocy', () => {
    const lights: PointLight[] = [];
    view.root.traverse((o) => { if ((o as PointLight).isPointLight) lights.push(o as PointLight); });
    expect(lights.length).toBeGreaterThan(0);
    expect(lights.length).toBeLessThanOrEqual(6);
    view.setTimeOfDay('day');
    expect(lights.every((l) => !l.visible)).toBe(true);
    view.setTimeOfDay('night');
    expect(lights.every((l) => l.visible && !l.castShadow)).toBe(true);
    view.setTimeOfDay('day');
  });

  it('dispose() można wywołać dwa razy', () => {
    const v = buildStore(layout);
    v.dispose();
    expect(() => v.dispose()).not.toThrow();
  });
});

describe('lokal narożny (druga witryna)', () => {
  const corner: StoreLayout = generateStore('kiełbasa-12');

  it('szkli kratki typu window, a tam, gdzie stoi mebel, daje nieprzezroczystą folię', () => {
    expect(corner.lot.corner).toBe(true);
    const sideWindows = corner.cells.filter((c, i) => c === 'window' && Math.floor(i / corner.width) > 4);
    expect(sideWindows.length).toBeGreaterThan(0);
    const view = buildStore(corner);
    view.setExteriorMode(true);
    const mats = new Set(meshesOf(view.root).map((m) => (m.material as Material).name));
    expect([...mats].some((n) => n.includes('glass'))).toBe(true);
    expect([...mats].some((n) => n.includes('foil'))).toBe(true);
    view.dispose();
  });
});

describe('makeSignTexture', () => {
  it('w Node (bez document) zwraca atrapę 1×1 zamiast rzucać', () => {
    const t = makeSignTexture('TRASZKA');
    expect(t).toBeDefined();
  });
});
