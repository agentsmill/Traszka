import { Box3, Group, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { cellToWorld } from '@/render/coords';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { createConveyor, createPress, createRestocker, type MachineLevel } from './machines';
import { placeRobots } from './robotPlacement';

const layout = generateStore('kielbasa-42');
const placed = placeRobots(layout, computeStoreInfo(layout));
const conveyorCells = placed.conveyor!;
const pressCells = placed.press!;
const restockFixture = placed.restocker!;
const LEVELS: MachineLevel[] = [1, 2, 3];

const meshesOf = (o: Group): Mesh[] => { const out: Mesh[] = []; o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c as Mesh); }); return out; };
const run = (m: { update(dt: number, working: boolean): void }, seconds: number, working: boolean): void => {
  for (let t = 0; t < seconds; t += 1 / 30) m.update(1 / 30, working);
};
const worldBox = (o: Group): Box3 => {
  o.updateMatrixWorld(true);
  const box = new Box3();
  for (const m of meshesOf(o)) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld)); }
  return box;
};

describe('maszyny z warsztatu', () => {
  it('pojawiają się z powiększeniem od zera i po pół sekundy mają skalę 1', () => {
    for (const m of [createConveyor(layout, conveyorCells, 1), createPress(layout, pressCells), createRestocker(layout, restockFixture, 1)]) {
      expect(m.object.scale.x).toBeLessThan(0.01);
      run(m, 0.2, false);
      expect(m.object.scale.x).toBeGreaterThan(0.01);
      run(m, 0.6, false);
      expect(m.object.scale.x).toBeCloseTo(1, 6);
      m.dispose();
    }
  });

  describe('taśmociąg', () => {
    it.each(LEVELS)('poziom %i: mało siatek, stoi na swoich kratkach i nie wystaje poza nie', (level) => {
      const cells = conveyorCells.slice(0, Math.min(conveyorCells.length, 2 + level));
      const m = createConveyor(layout, cells, level);
      run(m, 1, false);
      expect(meshesOf(m.object).length).toBeLessThanOrEqual(7);
      const a = cellToWorld(layout, cells[0]!.x, cells[0]!.y);
      const b = cellToWorld(layout, cells.at(-1)!.x, cells.at(-1)!.y);
      const box = worldBox(m.object);
      expect(box.min.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x) - 0.26);
      expect(box.max.x).toBeLessThanOrEqual(Math.max(a.x, b.x) + 0.26);
      expect(box.min.z).toBeGreaterThanOrEqual(a.z - 0.26);
      expect(box.max.z).toBeLessThanOrEqual(a.z + 0.26);
      m.dispose();
    });

    it('w pracy jadą kartony i taśma się przesuwa, a po przerwie wszystko staje', () => {
      const m = createConveyor(layout, conveyorCells, 3);
      run(m, 1, false);
      const loads = meshesOf(m.object).filter((x) => x.castShadow === false && x.geometry.type !== 'PlaneGeometry' && !x.name);
      const belt = meshesOf(m.object).find((x) => x.geometry.type === 'PlaneGeometry')!;
      const map = (belt.material as unknown as { map: { offset: { x: number } } }).map;
      const before = map.offset.x;
      run(m, 1, true);
      expect(map.offset.x).not.toBe(before);
      expect(loads.some((l) => l.visible)).toBe(true);
      run(m, 2, false);
      const stopped = map.offset.x;
      run(m, 0.5, false);
      expect(map.offset.x).toBe(stopped);
      expect(loads.every((l) => !l.visible)).toBe(true);
      m.dispose();
    });

    it('nie rusza się przy pauzie (dt = 0)', () => {
      const m = createConveyor(layout, conveyorCells, 2);
      run(m, 1, true);
      const belt = meshesOf(m.object).find((x) => x.geometry.type === 'PlaneGeometry')!;
      const map = (belt.material as unknown as { map: { offset: { x: number } } }).map;
      const frozen = map.offset.x;
      for (let i = 0; i < 10; i++) m.update(0, true);
      expect(map.offset.x).toBe(frozen);
      m.dispose();
    });
  });

  describe('prasa', () => {
    it('dwie ruchome siatki (szczęka, pokrętło) i rama; szczęka dociska w pracy i wraca w spoczynku', () => {
      const m = createPress(layout, pressCells);
      run(m, 1, false);
      const jaw = m.object.children.find((c) => c.children.length > 0)!;
      const rest = jaw.position.x;
      let min = rest;
      for (let t = 0; t < 2; t += 1 / 30) { m.update(1 / 30, true); min = Math.min(min, jaw.position.x); }
      expect(min).toBeLessThan(rest - 0.02);
      run(m, 2, false);
      expect(jaw.position.x).toBeCloseTo(rest, 3);
      expect(meshesOf(m.object)).toHaveLength(3);
      m.dispose();
    });
  });

  describe('ramię wykładacza', () => {
    it.each(LEVELS)('poziom %i: stoi na wierzchu mebla (nad podłogą sali), w obrysie mebla wzdłuż szyny', (level) => {
      const m = createRestocker(layout, restockFixture, level);
      run(m, 1, false);
      expect(m.object.position.y).toBeGreaterThan(1.5);
      const at = cellToWorld(layout, restockFixture.x + (restockFixture.w - 1) / 2, restockFixture.y + (restockFixture.d - 1) / 2);
      expect(m.object.position.x).toBeCloseTo(at.x, 6);
      expect(m.object.position.z).toBeCloseTo(at.z, 6);
      expect(meshesOf(m.object).length).toBeLessThanOrEqual(5);
      m.dispose();
    });

    it('w pracy przerzuca ramię i jeździ po szynie, a bez pracy parkuje ze złożonym ramieniem', () => {
      const m = createRestocker(layout, restockFixture, 2);
      run(m, 1, false);
      const carriage = m.object.children.find((c) => c.children.length > 0)!;
      const shoulder = carriage.children.find((c) => c.children.length > 0)!;
      const park = carriage.position.x;
      expect(shoulder.rotation.x).toBeCloseTo(0, 6);
      let reach = 0;
      let travel = 0;
      for (let t = 0; t < 6; t += 1 / 30) {
        m.update(1 / 30, true);
        reach = Math.max(reach, Math.abs(shoulder.rotation.x));
        travel = Math.max(travel, Math.abs(carriage.position.x - park));
      }
      expect(reach).toBeGreaterThan(1);
      expect(travel).toBeGreaterThan(0.3);
      run(m, 8, false);
      expect(carriage.position.x).toBeCloseTo(park, 2);
      expect(shoulder.rotation.x).toBeCloseTo(0, 2);
      m.dispose();
    });

    it('przedramię wisi w dół przy każdym wychyleniu ramienia (suma kątów to pół obrotu)', () => {
      const m = createRestocker(layout, restockFixture, 1);
      const carriage = m.object.children.find((c) => c.children.length > 0)!;
      const shoulder = carriage.children.find((c) => c.children.length > 0)!;
      const elbow = shoulder.children.find((c) => c.type === 'Group')!;
      for (let i = 0; i < 90; i++) {
        m.update(1 / 30, true);
        expect(shoulder.rotation.x + elbow.rotation.x).toBeCloseTo(Math.PI, 6);
      }
      m.dispose();
    });

    it('poziom 3 ma świecące oko czujnika, niższe nie', () => {
      const names = (l: MachineLevel): string[] => { const m = createRestocker(layout, restockFixture, l); const n: string[] = []; m.object.traverse((c) => n.push(c.name)); m.dispose(); return n; };
      expect(names(3)).toContain('czujnik');
      expect(names(2)).not.toContain('czujnik');
    });
  });

  it('dispose zdejmuje maszynę ze sceny (można wołać wielokrotnie)', () => {
    const parent = new Group();
    const m = createConveyor(layout, conveyorCells, 1);
    parent.add(m.object);
    m.dispose();
    expect(m.object.parent).toBeNull();
    expect(() => m.dispose()).not.toThrow();
  });
});
