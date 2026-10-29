import { describe, expect, it } from 'vitest';
import { Box3, Mesh, PointLight, Vector3, type BufferGeometry, type DataTexture, type Material, type Object3D } from 'three';
import { generateStore } from '@/sim/store/generateStore';
import { layoutFromParts, validParts } from '@/sim/store/testLayouts';
import type { Facing, Fixture, FixtureKind, StoreLayout } from '@/sim/store/types';
import { CELL_SIZE_M } from '@/sim/grid';
import { cellToWorld } from '@/render/coords';
import { PALETTE } from '@/render/style';
import { cornerSide, SIDE_STREET, storeOuter } from '@/render/street/buildings';
import { buildStore, FIXTURE_BUILDERS, type StoreView } from './buildStore';
import { wallBehind, type Cutaway, type YawIndex } from './cutaway';
import { CAP_H, CURB_W_M, SIDEWALK_DEPTH, type WallSide } from './shell';
import { buildSelfCheckout } from './fixtures';
import { TOBACCO_CUT_H } from './fixtures/tobaccoShelf';
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
    // buildSelfCheckout nie jest pod żadnym rodzajem z FIXTURE_BUILDERS (slot to tylko znacznik), więc idzie osobno
    const cases: [string, FixtureKind, (f: Fixture) => Object3D][] = [
      ...KINDS.filter((kind) => kind !== 'backroomDoor').map((kind): [string, FixtureKind, (f: Fixture) => Object3D] => [kind, kind, FIXTURE_BUILDERS[kind]]),
      ['selfCheckout', 'selfCheckoutSlot', buildSelfCheckout],
    ];
    for (const [name, kind, build] of cases) {
      for (const facing of ['N', 'E', 'S', 'W'] as const) {
        const f = sample(kind, facing);
        const box = new Box3().setFromObject(build(f));
        const eps = 0.01; // 1 cm: przy 6 cm tolerancji 3 cm wystającej nadstawki kasy przechodziłyby niezauważone
        expect(box.min.x, `${name}/${facing} min.x`).toBeGreaterThanOrEqual(-eps);
        expect(box.min.z, `${name}/${facing} min.z`).toBeGreaterThanOrEqual(-eps);
        expect(box.max.x, `${name}/${facing} max.x`).toBeLessThanOrEqual(f.w * CELL_SIZE_M + eps);
        expect(box.max.z, `${name}/${facing} max.z`).toBeLessThanOrEqual(f.d * CELL_SIZE_M + eps);
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
    const meshes = meshesOf(view.root);
    expect(meshes.length).toBeLessThan(150);
  });

  it('setCutaway(yaw) obniża ściany od strony kamery do ≤ 0,5 m (ściana działowa zaplecza z tylną)', () => {
    const expected = [['front', 'left'], ['back', 'mid', 'left'], ['back', 'mid', 'right'], ['front', 'right']] as const;
    for (const yaw of [0, 1, 2, 3] as const) {
      view.setCutaway(yaw);
      for (const side of ['front', 'back', 'left', 'right', 'mid'] as const) {
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

  it('noc: ≤ 6 ciepłych świateł punktowych bez cieni, świecących tylko w nocy (zawsze w scenie: bez rekompilacji)', () => {
    const lights: PointLight[] = [];
    view.root.traverse((o) => { if ((o as PointLight).isPointLight) lights.push(o as PointLight); });
    expect(lights.length).toBeGreaterThan(0);
    expect(lights.length).toBeLessThanOrEqual(6);
    view.setTimeOfDay('day');
    expect(lights.every((l) => l.visible && l.intensity === 0)).toBe(true);
    expect(view.root.getObjectByName('window-glow')!.visible).toBe(false);
    view.setTimeOfDay('night');
    expect(lights.every((l) => l.visible && l.intensity > 0 && !l.castShadow)).toBe(true);
    expect(view.root.getObjectByName('window-glow')!.visible).toBe(true);
    view.setTimeOfDay('day');
  });

  it('lampy sufitowe świecą wg przewodnika §4 (brand.cream, 2–2,5), nocą mocniej niż w dzień', () => {
    const panel = (): number => ((view.root.getObjectByName('lamps')!.children[0] as Mesh).material as Material & { emissiveIntensity: number }).emissiveIntensity;
    view.setTimeOfDay('day');
    const day = panel();
    view.setTimeOfDay('night');
    const night = panel();
    view.setTimeOfDay('day');
    for (const v of [day, night]) { expect(v).toBeGreaterThanOrEqual(2); expect(v).toBeLessThanOrEqual(2.5); }
    expect(night).toBeGreaterThan(day);
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

describe('poświata witryn nocą', () => {
  /** Kratka siatki: 0,5 m. Krawężnik (lico od strony chodnika) leży na początku wiersza 0, czyli w z = −głębokość/2. */
  const kerbZ = (l: StoreLayout): number => -(l.depth * CELL_SIZE_M) / 2;

  for (const seed of ['kiełbasa-42', 'kiełbasa-12', 'traszka-1']) {
    it(`${seed}: plama kończy się na krawężniku (front i boczna witryna), nie wisi nad jezdnią z twardym brzegiem`, () => {
      const l = generateStore(seed);
      const view = buildStore(l);
      const glow = view.root.getObjectByName('window-glow')!;
      glow.updateMatrixWorld(true);
      const box = new Box3().setFromObject(glow);
      const o = storeOuter(l);
      expect(box.min.z).toBeGreaterThanOrEqual(kerbZ(l) - 1e-6);
      expect(box.min.z).toBeLessThan(o.z0 - 1);   // ale wciąż sięga na chodnik, a nie jest ścięta do zera
      const side = cornerSide(l);
      if (side === 'minX') expect(box.min.x).toBeGreaterThanOrEqual(o.x0 - SIDEWALK_DEPTH.side - 1e-6);
      if (side === 'maxX') expect(box.max.x).toBeLessThanOrEqual(o.x1 + SIDEWALK_DEPTH.side + 1e-6);
      view.dispose();
    });
  }

  it('boczna witryna lokalu narożnego ma plamę krótszą niż front (chodnik wzdłuż przecznicy jest węższy)', () => {
    expect(SIDEWALK_DEPTH.side).toBeLessThan(SIDEWALK_DEPTH.front);
    expect(SIDEWALK_DEPTH.front).toBeLessThan(2.6);   // bez ścięcia front wychodziłby poza krawężnik o ok. 0,3 m
    // chodnik wzdłuż przecznicy: SIDE_STREET.sidewalk od lica muru do krawędzi jezdni, z czego krawężnik zajmuje CURB_W_M
    expect(SIDE_STREET.sidewalk - CURB_W_M).toBeCloseTo(SIDEWALK_DEPTH.side, 9);
  });

  it('plama i poświata latarni są oznaczone dla N8AO (AO zostaje pod nimi): userData.treatAsOpaque', () => {
    const view = buildStore(generateStore('kiełbasa-12'));
    const glow = view.root.getObjectByName('window-glow')!;
    const meshes = meshesOf(glow);
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) expect(m.userData.treatAsOpaque, m.name).toBe(true);
    view.dispose();
  });
});

describe('makeSignTexture', () => {
  it('w Node (bez document) zwraca atrapę 1×1 zamiast rzucać', () => {
    const t = makeSignTexture('TRASZKA') as DataTexture;
    expect(t.isDataTexture).toBe(true);
    expect(t.image.width).toBe(1);
    expect(t.image.height).toBe(1);
  });
});


describe('regał z papierosami tnie się razem ze ścianą, przy której stoi (R49: kasjer widoczny z każdego kąta kamery)', () => {
  const YAWS = [0, 1, 2, 3] as const;
  /** Dwa sklepy: regał przy lewej ścianie (front E) i jego lustro przy prawej (front W). */
  const CASES: { name: string; seed: string; wall: WallSide }[] = [
    { name: 'przy lewej ścianie (E)', seed: 'bigos-101', wall: 'left' },
    { name: 'przy prawej ścianie (W, sklep w lustrze)', seed: 'kiełbasa-42', wall: 'right' },
  ];
  const shelfOf = (l: StoreLayout): Fixture => l.fixtures.find((f) => f.kind === 'tobaccoShelf')!;
  /** Ściana przy regale policzona z siatki, niezależnie od `wallBehind`: kratka za jego plecami to kolumna ściany bocznej. */
  const wallFromGrid = (l: StoreLayout, f: Fixture): WallSide => (f.x === 1 ? 'left' : f.x + f.w === l.width - 1 ? 'right' : 'mid');

  /**
   * Prostokąt regału w świecie (x, z), zwężony o 5 mm do środka: lico ściany i sąsiednie meble leżą dokładnie na jego brzegu
   * (poza prostokątem), a wierzchołki cienkiej płyty przekroju siedzą ≈ 8 mm od jej krawędzi (w środku).
   */
  function footprint(l: StoreLayout, f: Fixture): { x0: number; x1: number; z0: number; z1: number } {
    const a = cellToWorld(l, f.x, f.y), b = cellToWorld(l, f.x + f.w - 1, f.y + f.d - 1);
    const h = CELL_SIZE_M / 2 - 0.005;
    return { x0: Math.min(a.x, b.x) - h, x1: Math.max(a.x, b.x) + h, z0: Math.min(a.z, b.z) - h, z1: Math.max(a.z, b.z) + h };
  }
  /** Wierzchołki tego, co się naprawdę rysuje (widoczne siatki, zakres rysowania), w prostokącie footprintu poniżej sufitu. */
  function drawnInside(root: Object3D, r: ReturnType<typeof footprint>): { y: number; key: string; mesh: Mesh }[] {
    root.updateMatrixWorld(true);
    const out: { y: number; key: string; mesh: Mesh }[] = [];
    const v = new Vector3();
    root.traverseVisible((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry;
      const p = g.getAttribute('position');
      const end = Math.min(p.count, g.drawRange.start + g.drawRange.count);
      for (let i = g.drawRange.start; i < end; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        if (v.x < r.x0 || v.x > r.x1 || v.z < r.z0 || v.z > r.z1 || v.y > 2.4) continue;   // sufit i lampy wiszą nad regałem
        out.push({ y: v.y, key: `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`, mesh });
      }
    });
    return out;
  }
  const topOfDrawn = (root: Object3D, r: ReturnType<typeof footprint>): number => Math.max(...drawnInside(root, r).map((d) => d.y));
  /**
   * Ile wywołań rysowania da ta scena: każda widoczna siatka to jedno, także z pustym zakresem (three 0.186 wywołuje wtedy
   * `drawArrays` z zerem i liczy je w `info.render.calls`), więc siatka z samą górą regału musi być ukryta, a nie tylko opróżniona.
   */
  function drawCalls(root: Object3D): { calls: number; empty: number } {
    let calls = 0, empty = 0;
    root.traverseVisible((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      calls++;
      const g = mesh.geometry;
      if (Math.min(g.getAttribute('position').count, g.drawRange.start + g.drawRange.count) <= g.drawRange.start) empty++;
    });
    return { calls, empty };
  }
  const wallIsCut = (view: StoreView, side: WallSide): boolean => topOf(view.root.getObjectByName(`wall:${side}`)!) <= 0.5 + 1e-6;

  it('budowniczy opisuje przekrój: cięcie na styku rzędów frontów (≈ blat kasy), płyta zamykająca w kolorze przekroju ściany, w footprincie regału', () => {
    const f = sample('tobaccoShelf', 'E');
    const obj = FIXTURE_BUILDERS.tobaccoShelf(f);
    const cutaway = obj.userData.cutaway as Cutaway;
    expect(cutaway.height).toBe(TOBACCO_CUT_H);
    expect(TOBACCO_CUT_H).toBeGreaterThanOrEqual(0.85);   // kasjer ma być widoczny co najmniej od pasa w górę (najwyżej ~1 m nad podłogą)
    expect(TOBACCO_CUT_H).toBeLessThanOrEqual(1.0);
    const meshes = meshesOf(cutaway.cap);
    expect(meshes.length).toBeGreaterThan(0);
    for (const m of meshes) {
      expect(hex(m.material as Material), 'płyta ma kolor przekroju ścian').toBe(PALETTE.wall[4]);
      expect(m.castShadow, 'płyta nie dokłada przebiegu cienia').toBe(false);
    }
    cutaway.cap.updateMatrixWorld(true);
    const box = new Box3().setFromObject(cutaway.cap);
    expect(box.min.y).toBeCloseTo(TOBACCO_CUT_H, 6);
    expect(box.max.y).toBeCloseTo(TOBACCO_CUT_H + CAP_H, 6);
    const eps = 0.01;
    expect(box.min.x).toBeGreaterThanOrEqual(-eps);
    expect(box.min.z).toBeGreaterThanOrEqual(-eps);
    expect(box.max.x).toBeLessThanOrEqual(f.w * CELL_SIZE_M + eps);
    expect(box.max.z).toBeLessThanOrEqual(f.d * CELL_SIZE_M + eps);
    // pokrywa przekrój regału: prawie cały footprint (korpus z płytami pleców) bez wystawania
    expect(box.max.x - box.min.x).toBeGreaterThan(f.w * CELL_SIZE_M * 0.9);
    expect(box.max.z - box.min.z).toBeGreaterThan(f.d * CELL_SIZE_M * 0.9);
  });

  it('tylko regał z papierosami ma przekrój (pozostałe meble zostają pełne: R22)', () => {
    for (const kind of KINDS) expect(!!FIXTURE_BUILDERS[kind](sample(kind)).userData.cutaway, kind).toBe(kind === 'tobaccoShelf');
  });

  for (const { name, seed, wall } of CASES) {
    describe(`regał ${name}`, () => {
      const l = generateStore(seed);
      const f = shelfOf(l);
      const rect = footprint(l, f);
      const view = buildStore(l);

      it('ściana za regałem wyliczona z siatki zgadza się z wallBehind(facing)', () => {
        expect(wallFromGrid(l, f)).toBe(wall);
        expect(wallBehind(f.facing)).toBe(wall);
      });

      it('regał jest ścięty dokładnie wtedy, gdy ściana za nim jest obniżona: dla każdego yaw, a widok z zewnątrz zostawia go w całości', () => {
        let cutAtSomeYaw = false, fullAtSomeYaw = false;
        for (const yaw of YAWS) {
          view.setCutaway(yaw);
          const cut = wallIsCut(view, wall);
          const top = topOfDrawn(view.root, rect);
          if (cut) {
            cutAtSomeYaw = true;
            expect(top, `yaw ${yaw}`).toBeCloseTo(TOBACCO_CUT_H + CAP_H, 4);                   // przekrój zamyka płyta, a nad nim nic nie zostało
          } else {
            fullAtSomeYaw = true;
            expect(top, `yaw ${yaw}`).toBeGreaterThan(1.9);                                    // nadstawka z tabliczką ma 2,0 m
          }
        }
        expect(cutAtSomeYaw && fullAtSomeYaw).toBe(true);
        view.setExteriorMode(true);
        for (const yaw of YAWS) {
          view.setCutaway(yaw);
          expect(topOfDrawn(view.root, rect), `zewnątrz, yaw ${yaw}`).toBeGreaterThan(1.9);
        }
        view.setExteriorMode(false);
        for (const yaw of YAWS) {
          view.setCutaway(yaw);
          expect(topOfDrawn(view.root, rect) < 1.0, `po powrocie z zewnątrz, yaw ${yaw}`).toBe(wallIsCut(view, wall));
        }
      });

      it('kasjer widoczny: z obu kątów po stronie regału po nim nic nie wystaje nad cięcie, a przy pozostałych dwóch regał stoi za nim w całości', () => {
        const byYaw = YAWS.map((yaw) => { view.setCutaway(yaw); return topOfDrawn(view.root, rect) < 1.0; });
        expect(byYaw.filter(Boolean)).toHaveLength(2);
        expect(YAWS.filter((yaw) => byYaw[yaw]).map((yaw) => yaw)).toEqual(wall === 'left' ? [0, 1] : [2, 3]);
      });

      it('to cięcie, nie ściśnięcie: wszystko pod linią cięcia zostaje na swoich miejscach, a nad nią nic nie zostaje ani nie jest pomniejszone', () => {
        const below = (yaw: YawIndex): Set<string> => {
          view.setCutaway(yaw);
          return new Set(drawnInside(view.root, rect).filter((d) => d.y < TOBACCO_CUT_H - 1e-3).map((d) => d.key));
        };
        const cutYaw = YAWS.find((yaw) => { view.setCutaway(yaw); return wallIsCut(view, wall); })!;
        const fullYaw = YAWS.find((yaw) => { view.setCutaway(yaw); return !wallIsCut(view, wall); })!;
        const full = below(fullYaw), cut = below(cutYaw);
        expect(full.size).toBeGreaterThan(100);
        expect([...cut].sort()).toEqual([...full].sort());
        view.setCutaway(cutYaw);
        expect(drawnInside(view.root, rect).filter((d) => d.y > TOBACCO_CUT_H + CAP_H + 1e-4)).toHaveLength(0);
      });

      it('przekrój zamyka płyta w kolorze przekroju ścian (wall[4]): jej wierzch to jedyne, co sięga powyżej cięcia', () => {
        const cutYaw = YAWS.find((yaw) => { view.setCutaway(yaw); return wallIsCut(view, wall); })!;
        view.setCutaway(cutYaw);
        const drawn = drawnInside(view.root, rect);
        const topY = Math.max(...drawn.map((d) => d.y));
        const onTop = drawn.filter((d) => d.y > topY - 1e-4);
        expect(onTop.length).toBeGreaterThan(8);
        for (const d of onTop) expect(hex(d.mesh.material as Material)).toBe(PALETTE.wall[4]);
      });

      it('draw calle: pełny regał nie dokłada żadnego, a ścięty najwyżej jeden (płyta zamykająca; siatki opróżnione z góry regału znikają)', () => {
        const statics = (): Mesh[] => meshesOf(view.root.getObjectByName('static')!);
        const cap = view.root.getObjectByName(`${f.id}:cap`)!;
        expect(meshesOf(cap)).toHaveLength(1);
        for (const yaw of YAWS) {
          view.setCutaway(yaw);
          const cut = wallIsCut(view, wall);
          expect(cap.visible, `yaw ${yaw}: płyta tylko w przekroju`).toBe(cut);
          const now = drawCalls(view.root);
          expect(now.empty, `yaw ${yaw}: siatka z pustym zakresem nadal kosztuje wywołanie rysowania`).toBe(0);
          // stan sprzed R49: góra regału zawsze włączona i żadnej płyty
          for (const m of statics()) { m.geometry.setDrawRange(0, Infinity); m.visible = true; }
          cap.visible = false;
          const before = drawCalls(view.root);
          expect(now.calls, `yaw ${yaw}`).toBeLessThanOrEqual(before.calls + 1);
          if (!cut) expect(now.calls, `yaw ${yaw}: pełny regał`).toBe(before.calls);
          view.setCutaway(yaw);
        }
      });

      it('wielokrotne przełączanie nie przecieka: te same geometrie i materiały, te same zakresy rysowania, a dispose zwalnia każdą scaloną geometrię raz', () => {
        const own = buildStore(l);
        const states: [YawIndex, boolean][] = [...YAWS.map((y): [YawIndex, boolean] => [y, false]), [0, true]];
        const identities = (): { geometries: string[]; materials: string[]; meshes: number } => {
          const geometries = new Set<string>(), materials = new Set<string>();
          let meshes = 0;
          for (const [yaw, exterior] of states) {          // wszystkie stany: ściany wymieniają `high` i `cap`, więc sumujemy
            own.setExteriorMode(exterior);
            own.setCutaway(yaw);
            own.root.traverse((o) => {
              const m = o as Mesh;
              if (!m.isMesh) return;
              meshes++;
              geometries.add(m.geometry.uuid);
              materials.add((m.material as Material).uuid);
            });
          }
          own.setExteriorMode(false);
          return { geometries: [...geometries].sort(), materials: [...materials].sort(), meshes };
        };
        const before = identities();
        let seed = 7;
        for (let i = 0; i < 600; i++) {
          seed = (seed * 1103515245 + 12345) % 2147483648;
          if (seed % 5 === 0) own.setExteriorMode(seed % 2 === 0);
          else own.setCutaway((seed % 4) as YawIndex);
        }
        expect(identities()).toEqual(before);

        const owned = new Map<string, number>();
        for (const [yaw, exterior] of states) {
          own.setExteriorMode(exterior);
          own.setCutaway(yaw);
          own.root.traverse((o) => {
            const m = o as Mesh;
            if (m.isMesh && /^(static|lamps|window-glow|wall:[a-z]+:(low|high|cap)):/.test(m.name) && !owned.has(m.geometry.uuid)) {
              owned.set(m.geometry.uuid, 0);
              m.geometry.addEventListener('dispose', () => owned.set(m.geometry.uuid, owned.get(m.geometry.uuid)! + 1));
            }
          });
        }
        expect(owned.size).toBeGreaterThan(10);
        own.dispose();
        expect([...owned.values()].every((n) => n === 1)).toBe(true);
      });
    });
  }

  it('sklep bez regału z papierosami buduje się i przełącza kąty bez wyjątków', () => {
    const parts = validParts();
    const noTobacco = layoutFromParts({ ...parts, fixtures: parts.fixtures.filter((f) => f.kind !== 'tobaccoShelf') });
    const view = buildStore(noTobacco);
    for (const yaw of YAWS) expect(() => view.setCutaway(yaw)).not.toThrow();
    view.dispose();
  });

  it('gdy regałów z papierosami jest kilka (generator daje jeden), tnie się pierwszy; reszta zostaje w całości i nic się nie psuje', () => {
    const parts = validParts();
    const second: Fixture = { id: 'tobaccoShelf-2', kind: 'tobaccoShelf', x: parts.lot.interiorWidth, y: 6, w: 1, d: 3, facing: 'W' };
    const two = layoutFromParts({ ...parts, fixtures: [...parts.fixtures.filter((f) => f.kind !== 'wallShelf'), second] });
    const view = buildStore(two);
    const first = shelfOf(two);
    for (const yaw of YAWS) {
      view.setCutaway(yaw);
      expect(topOfDrawn(view.root, footprint(two, second)), `drugi regał, yaw ${yaw}`).toBeGreaterThan(1.9);
      expect(topOfDrawn(view.root, footprint(two, first)) < 1.0, `pierwszy regał, yaw ${yaw}`).toBe(wallIsCut(view, wallBehind(first.facing)));
    }
    view.dispose();
  });
});

describe('drzwi na zaplecze: skrzydło na zawiasie otwiera się przed idącym i wraca do ściany', () => {
  const view = buildStore(layout);
  const door = layout.fixtures.find((f) => f.kind === 'backroomDoor')!;
  const FRAME = 1 / 60;
  const person = (x: number, y: number, moving = true): { walker: { x: number; y: number; moving: boolean } } => ({ walker: { x, y, moving } });
  const run = (people: ReturnType<typeof person>[], seconds: number): void => {
    for (let t = 0; t < seconds; t += FRAME) view.updateDoor(FRAME, people);
  };
  const hinge = (): Object3D | undefined => view.root.getObjectByName(`${door.id}:leaf`);
  /** Wierzchołki rysowane przez scalone siatki ściany działowej (z zakresem rysowania, bez skrzydła na zawiasie). */
  const drawnMid = (): number => view.root.getObjectByName('wall:mid:high')!.children
    .filter((c): c is Mesh => (c as Mesh).isMesh && c.visible)
    .reduce((n, m) => n + Math.min(m.geometry.drawRange.count, m.geometry.getAttribute('position').count), 0);
  /** Lico ściany działowej od strony sali (z świata); zaplecze leży dalej w +z. */
  const front = cellToWorld(layout, door.x, door.y).z - CELL_SIZE_M / 2;
  view.setCutaway(0);

  it('zamknięte: skrzydło jest w scalonej ścianie, a jego kopia na zawiasie ukryta (bez dodatkowych draw calls)', () => {
    expect(view.doorAngle).toBe(0);
    expect(hinge()).toBeDefined();
    expect(hinge()!.visible).toBe(false);
    hinge()!.rotation.y = 0;
    const closed = new Box3().setFromObject(hinge()!);
    expect(closed.min.z).toBeGreaterThanOrEqual(front - 1e-6);
    expect(closed.max.z).toBeLessThanOrEqual(front + 0.22 + 1e-6);   // w grubości ściany
  });

  it('idący w przejściu otwiera je na zaplecze: kopia na zawiasie widoczna, skrzydło w ścianie wyłączone zakresem rysowania', () => {
    const full = drawnMid();
    run([person(door.x + 0.5, door.y + 0.5)], 0.5);
    expect(view.doorAngle).toBeGreaterThan(Math.PI / 2);
    expect(hinge()!.visible).toBe(true);
    expect(drawnMid()).toBeLessThan(full);
    const open = new Box3().setFromObject(hinge()!);
    expect(open.min.z).toBeGreaterThanOrEqual(front - 1e-6);
    expect(open.max.z).toBeGreaterThan(front + 0.8);   // skrzydło stoi w głąb zaplecza
    // ściana obniżona w przekroju chowa drzwi razem ze skrzydłem na zawiasie
    view.setCutaway(1);
    expect(hinge()).toBeUndefined();
    view.setCutaway(0);
    expect(hinge()).toBeDefined();
  });

  it('po przejściu zamyka się i wraca do ściany; stojący obok na zapleczu go nie otwiera', () => {
    run([person(door.x + 0.5, door.y + 0.5)], 0.5);
    const open = drawnMid();
    run([person(door.x - 0.5, door.y + 1.5, false)], 1.5);
    expect(view.doorAngle).toBe(0);
    expect(hinge()!.visible).toBe(false);
    expect(drawnMid()).toBeGreaterThan(open);
  });
});
