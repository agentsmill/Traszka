import { describe, expect, it } from 'vitest';
import { Box3, Group, Matrix4, Mesh, Vector3 } from 'three';
import { N8AOPostPass } from 'n8ao';
import { buildDoormat } from '@/render/store/props';
import { BLOB_OPACITY, BLOB_RADIUS, BLOB_Y, characterBlobRadii, createBlobShadows, setCharacterShadowCasting, type BlobShadows } from './blobShadows';

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

describe('plamy cienia: miejsca zarezerwowane (kasjer)', () => {
  const at = (b: BlobShadows, i: number): Vector3 => {
    const m = new Matrix4();
    b.mesh.getMatrixAt(i, m);
    return new Vector3().setFromMatrixPosition(m);
  };
  const scaleAt = (b: BlobShadows, i: number): [number, number] => {
    const m = new Matrix4();
    b.mesh.getMatrixAt(i, m);
    return [new Vector3().setFromMatrixColumn(m, 0).length(), new Vector3().setFromMatrixColumn(m, 2).length()];
  };

  it('miejsce zarezerwowane jest rysowane razem z tłumem: najpierw zarezerwowane, potem plamy tłumu', () => {
    const b = createBlobShadows(8);
    const slot = b.reserve()!;
    slot.set(5, 6, 0.5, 0.7);
    expect(b.mesh.count).toBe(1);
    b.set(0, 1, 2, 0.4, 0.4);
    b.set(1, 3, 4, 0.4, 0.4);
    b.commit(2);
    expect(b.mesh.count).toBe(3);
    expect([at(b, 0).x, at(b, 0).y, at(b, 0).z]).toEqual([5, expect.closeTo(BLOB_Y, 5), 6]);
    expect(scaleAt(b, 0)).toEqual([expect.closeTo(0.5, 5), expect.closeTo(0.7, 5)]);
    expect([at(b, 1).x, at(b, 1).z]).toEqual([1, 2]);
    expect([at(b, 2).x, at(b, 2).z]).toEqual([3, 4]);
    b.dispose();
  });

  it('commit(0) tłumu (zwolnienie widoku tłumu) zostawia plamę kasjera, a zmiana jego miejsca przesuwa plamę zamiast dodawać nową', () => {
    const b = createBlobShadows(8);
    const slot = b.reserve()!;
    slot.set(5, 6, 0.5, 0.5);
    b.set(0, 1, 2, 0.4, 0.4);
    b.commit(1);
    b.commit(0);
    expect(b.mesh.count).toBe(1);
    slot.set(7, 8, 0.5, 0.5);
    expect(b.mesh.count).toBe(1);
    expect([at(b, 0).x, at(b, 0).z]).toEqual([7, 8]);
    b.dispose();
  });

  it('plamy tłumu ustawione przed rezerwacją i po niej nie rozjeżdżają się: tłum zapisuje się od nowa co klatkę, ale nie ginie', () => {
    const b = createBlobShadows(8);
    b.set(0, 1, 2, 0.4, 0.4);
    b.commit(1);
    const slot = b.reserve()!;   // rezerwacja w środku klatki, między dwoma commit tłumu
    slot.set(5, 6, 0.5, 0.5);
    expect(b.mesh.count).toBe(2);
    expect([at(b, 0).x, at(b, 1).x]).toEqual([5, 1]);   // plama tłumu przesunęła się o jeden indeks, nie zniknęła
    slot.release();
    expect(b.mesh.count).toBe(1);
    expect(at(b, 0).x).toBe(1);
    b.dispose();
  });

  it('release zwalnia miejsce (plama znika, miejsce wraca do puli); drugie release niczego nie psuje', () => {
    const b = createBlobShadows(1);
    const first = b.reserve()!;
    first.set(5, 6, 0.5, 0.5);
    expect(b.mesh.count).toBe(1);
    expect(b.reserve()).toBeNull();   // jedyne miejsce zajęte
    first.release();
    expect(b.mesh.count).toBe(0);
    const second = b.reserve()!;
    expect(second).not.toBeNull();
    first.release();                  // stary uchwyt nie zwalnia cudzego miejsca
    second.set(9, 9, 0.5, 0.5);
    expect(b.mesh.count).toBe(1);
    expect(at(b, 0).x).toBe(9);
    b.dispose();
  });

  it('zarezerwowane miejsca zmniejszają pojemność dla tłumu: nadmiar plam tłumu jest pomijany, rezerwacje zostają', () => {
    const b = createBlobShadows(3);
    const a = b.reserve()!, c = b.reserve()!;
    a.set(1, 1, 0.5, 0.5);
    c.set(2, 2, 0.5, 0.5);
    for (let i = 0; i < 5; i++) b.set(i, 10 + i, 0, 0.4, 0.4);
    b.commit(5);
    expect(b.mesh.count).toBe(3);                          // pojemność, nie 7
    expect([at(b, 0).x, at(b, 1).x, at(b, 2).x]).toEqual([1, 2, 10]);
    expect(b.reserve()).not.toBeNull();                    // trzecie miejsce jeszcze jest
    expect(b.reserve()).toBeNull();                        // czwartego nie ma
    b.dispose();
  });

  it('miejsce zarezerwowane, ale jeszcze nieustawione, niczego nie rysuje (zerowa skala)', () => {
    const b = createBlobShadows(4);
    b.reserve();
    b.commit(0);
    expect(b.mesh.count).toBe(1);
    expect(scaleAt(b, 0)).toEqual([0, 0]);
    b.dispose();
  });
});

describe('characterBlobRadii', () => {
  it('promienie plamy to BLOB_RADIUS w metrach razy tusza (skala x i z), bez skali wzrostu', () => {
    const o = new Group();
    o.scale.set(0.9 * 1.2, 0.9, 0.9 * 1.2);   // wzrost 0,9 × model, tusza 1,2
    const [rx, rz] = characterBlobRadii(o);
    expect(rx).toBeCloseTo(BLOB_RADIUS * 1.2, 9);
    expect(rz).toBeCloseTo(BLOB_RADIUS * 1.2, 9);
    o.scale.set(1.1, 1, 0.8);
    expect(characterBlobRadii(o)[0]).toBeCloseTo(BLOB_RADIUS * 1.1, 9);
    expect(characterBlobRadii(o)[1]).toBeCloseTo(BLOB_RADIUS * 0.8, 9);
  });
});

describe('setCharacterShadowCasting', () => {
  it('ustawia rzucanie cienia z mapy cieni na wszystkich siatkach postaci (także zagnieżdżonych), a grup i reszty nie rusza', () => {
    const root = new Group();
    const armature = new Group();
    const a = new Mesh(), b = new Mesh(), c = new Mesh();
    armature.add(b);
    armature.add(new Group().add(c));
    root.add(a, armature);
    for (const m of [a, b, c]) m.castShadow = true;
    root.castShadow = armature.castShadow = true;
    setCharacterShadowCasting(root, false);
    expect([a, b, c].map((m) => m.castShadow)).toEqual([false, false, false]);
    expect([root.castShadow, armature.castShadow]).toEqual([true, true]);     // grupy zostają, jak były
    setCharacterShadowCasting(root, true);
    expect([a, b, c].map((m) => m.castShadow)).toEqual([true, true, true]);
  });
});
