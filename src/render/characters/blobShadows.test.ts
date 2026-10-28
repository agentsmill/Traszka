import { describe, expect, it } from 'vitest';
import { Box3, Group, Matrix4, Vector3 } from 'three';
import { N8AOPostPass } from 'n8ao';
import { buildDoormat } from '@/render/store/props';
import { BLOB_OPACITY, BLOB_RADIUS, BLOB_Y, createBlobShadows } from './blobShadows';

describe('plamy cienia pod postaciami', () => {
  it('leżą nad matą przy drzwiach (3 cm) i tuż nad podłogą: nie wiszą i nie barwią podeszw bardziej, niż trzeba', () => {
    const g = new Group();
    buildDoormat(g, 0, 0);
    const matTop = new Box3().setFromObject(g).max.y;
    expect(BLOB_Y).toBeGreaterThan(matTop);
    expect(BLOB_Y).toBeLessThanOrEqual(0.05);   // wcześniejsze „obejście” z podniesieniem do 0,10 m oderwałoby plamę od stóp
  });

  it('przezroczysta, bez zapisu głębi, ale z testem głębi (nie świeci przez meble); wystarczająco kryjąca, by była widać', () => {
    const b = createBlobShadows(4);
    const m = b.mesh.material as { transparent: boolean; depthWrite: boolean; depthTest: boolean; opacity: number };
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.opacity).toBe(BLOB_OPACITY);
    expect(BLOB_OPACITY).toBeGreaterThanOrEqual(0.7);
    expect(BLOB_RADIUS).toBeGreaterThanOrEqual(0.5);
    b.dispose();
  });

  it('N8AO nie zeruje AO pod plamą: mesh ma userData.treatAsOpaque, a biblioteka ten znacznik faktycznie czyta', () => {
    const b = createBlobShadows(4);
    expect(b.mesh.userData.treatAsOpaque).toBe(true);
    b.dispose();
    // Bez tego znacznika AO pod plamą było zerowane (N8AO „transparencyAware”), więc plama znikała na `srednia`/`wysoka`.
    // Test pilnuje, żeby aktualizacja n8ao nie zmieniła nazwy znacznika po cichu.
    expect((N8AOPostPass.prototype as unknown as { renderTransparency(): void }).renderTransparency.toString()).toContain('treatAsOpaque');
  });

  it('instancja ma pozycję (x, BLOB_Y, z) i promienie rx, rz', () => {
    const b = createBlobShadows(4);
    b.set(1, 2, 3, 0.4, 0.6);
    b.commit(2);
    const m = new Matrix4();
    b.mesh.getMatrixAt(1, m);
    const p = new Vector3().setFromMatrixPosition(m);
    expect(p.x).toBeCloseTo(2, 5);
    expect(p.y).toBeCloseTo(BLOB_Y, 5);
    expect(p.z).toBeCloseTo(3, 5);
    expect(b.mesh.count).toBe(2);
    b.dispose();
  });
});
