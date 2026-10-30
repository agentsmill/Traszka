import { BufferAttribute, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Jedna siatka z wielu brył: kolor z materiału każdej bryły trafia do kolorów wierzchołków, a całość rysuje wspólny materiał
 * (docs/style-guide.md §1: „kolory z kolorami wierzchołków, żeby rekwizyt kosztował jeden draw call”). Maszyna z kilkudziesięciu
 * klocków (`box`, `cyl` z parts.ts) kosztuje przez to kilka draw calli, a nie kilkadziesiąt. Błysk i przezroczystość się nie
 * przenoszą, więc szyby i ekrany (materiał `glow`) zostają osobnymi siatkami.
 */

/** Wspólny materiał wypieczonych siatek: biała baza mnożona przez kolor wierzchołka. Współdzielony, więc go nie zwalniamy. */
const BAKED = new MeshStandardMaterial({ name: 'robots:baked', vertexColors: true, roughness: 0.58, metalness: 0.12 });

/**
 * Scala wszystkie siatki z `parts` (grupa poza sceną, jej własna macierz to tożsamość) w jedną. Geometria wyniku trafia do `owned`
 * (zwalnia ją właściciel); geometrie źródłowe są współdzielone (cache w parts.ts) i zostają nietknięte.
 */
export function bake(parts: Group, owned: BufferGeometry[], name: string, cast = true): Mesh {
  parts.updateMatrixWorld(true);
  const geometries: BufferGeometry[] = [];
  parts.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as Material & { color?: { r: number; g: number; b: number } };
    if (!material.color) throw new Error(`bake: bryła „${mesh.name}” nie ma koloru materiału`);
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    // spójne atrybuty (pozycja, normalna, kolor): różne bryły mają różne uv, a tu tekstury nie ma
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([material.color.r, material.color.g, material.color.b], i * 3);
    g.setAttribute('color', new BufferAttribute(colors, 3));
    geometries.push(g);
  });
  const merged = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  if (!merged) throw new Error(`bake: nie udało się scalić „${name}”`);
  owned.push(merged);
  const result = new Mesh(merged, BAKED);
  result.name = name;
  result.castShadow = cast;
  result.receiveShadow = true;
  return result;
}
