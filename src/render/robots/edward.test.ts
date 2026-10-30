import { Group, Mesh } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EDWARD_BLOB_RADIUS, createEdward } from './edward';

const meshesOf = (o: Group): Mesh[] => { const out: Mesh[] = []; o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c as Mesh); }); return out; };
const arms = (o: Group): Mesh[] => meshesOf(o).filter((m) => m.name.includes('ramię'));
const step = (e: ReturnType<typeof createEdward>, s: number, moving: boolean, working: boolean): void => {
  for (let t = 0; t < s; t += 1 / 30) e.update(1 / 30, moving, working);
};

describe('createEdward', () => {
  it('to jedna grupa z pięcioma siatkami (korpus, głowa, dwa ramiona, ekran), stojąca na podłodze', () => {
    const e = createEdward();
    expect(e.object.name).toBe('eDward');
    expect(meshesOf(e.object)).toHaveLength(5);
    expect(e.object.position.y).toBe(0);
    expect(EDWARD_BLOB_RADIUS).toBeLessThan(0.54);       // ciaśniejsza plama niż pod człowiekiem
    e.dispose();
  });

  it('mieści się w 1,8 m i nie jest szerszy niż metr (po skali)', () => {
    const e = createEdward();
    e.object.updateMatrixWorld(true);
    let top = 0;
    let wide = 0;
    for (const m of meshesOf(e.object)) {
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
      top = Math.max(top, b.max.y);
      wide = Math.max(wide, b.max.x - b.min.x, b.max.z - b.min.z);
    }
    expect(top).toBeGreaterThan(1.3);
    expect(top).toBeLessThan(1.8);
    expect(wide).toBeLessThan(1);
    e.dispose();
  });

  it('w marszu wycieraczki wymachują do przodu i do tyłu na przemian, w pracy omiatają na boki', () => {
    const e = createEdward();
    step(e, 0.3, true, false);
    const [left, right] = arms(e.object);
    expect(Math.sign(left!.rotation.x)).toBe(-Math.sign(right!.rotation.x));
    expect(Math.abs(left!.rotation.x)).toBeGreaterThan(0.05);
    step(e, 0.5, false, true);
    expect(left!.rotation.x).toBe(0);
    // szeroki wymach: ramiona odchylają się od korpusu bardziej niż w spoczynku
    let widest = 0;
    for (let t = 0; t < 1.2; t += 1 / 30) { e.update(1 / 30, false, true); widest = Math.max(widest, Math.abs(right!.rotation.z)); }
    expect(widest).toBeGreaterThan(0.8);
    e.dispose();
  });

  it('stojąc bez pracy rozgląda się, w pracy kiwa głową, a w marszu podskakuje', () => {
    const e = createEdward();
    const head = e.object.children[0]!.children[1]!;   // rig: korpus, głowa (grupa z siatką i ekranem), dwa ramiona
    let yaw = 0;
    for (let t = 0; t < 4; t += 1 / 30) { e.update(1 / 30, false, false); yaw = Math.max(yaw, Math.abs(head.rotation.y)); }
    expect(yaw).toBeGreaterThan(0.1);
    let nod = 0;
    for (let t = 0; t < 2; t += 1 / 30) { e.update(1 / 30, false, true); nod = Math.max(nod, Math.abs(head.rotation.x)); }
    expect(nod).toBeGreaterThan(0.03);
    let hop = 0;
    for (let t = 0; t < 1; t += 1 / 30) { e.update(1 / 30, true, false); hop = Math.max(hop, e.object.children[0]!.position.y); }
    expect(hop).toBeGreaterThan(0.005);
    e.dispose();
  });

  it('dt nieskończone albo ujemne (pauza, błąd wołającego) nie psuje stanu', () => {
    const e = createEdward();
    for (const dt of [0, -1, NaN, Infinity]) expect(() => e.update(dt, true, true)).not.toThrow();
    const rig = e.object.children[0]!;
    expect(Number.isFinite(rig.position.y)).toBe(true);
    for (const a of arms(e.object)) expect(Number.isFinite(a.rotation.z)).toBe(true);
    e.dispose();
  });

  it('cień z mapy cieni przełącza się dla siatek korpusu, głowy i ramion, ale nie dla ekranu', () => {
    const e = createEdward();
    e.setCasting(true);
    const cast = meshesOf(e.object).filter((m) => m.castShadow);
    expect(cast).toHaveLength(4);
    e.setCasting(false);
    expect(meshesOf(e.object).some((m) => m.castShadow)).toBe(false);
    e.dispose();
  });

  it('dispose zdejmuje bryłę ze sceny i zwalnia tylko własne geometrie (wspólne zostają)', () => {
    const e = createEdward();
    const parent = new Group();
    parent.add(e.object);
    const own = meshesOf(e.object).filter((m) => m.name.startsWith('eDward'));
    const spies = own.map((m) => vi.spyOn(m.geometry, 'dispose'));
    const shared = meshesOf(e.object).filter((m) => !m.name.startsWith('eDward')).map((m) => vi.spyOn(m.geometry, 'dispose'));
    e.dispose();
    expect(e.object.parent).toBeNull();
    for (const s of spies) expect(s).toHaveBeenCalled();
    for (const s of shared) expect(s).not.toHaveBeenCalled();
  });
});
