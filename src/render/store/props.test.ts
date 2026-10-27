import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Box3, Color, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { PALETTE } from '@/render/style';
import {
  BOARD_LINES, POSTERS, SLOGANS, buildBench, buildBin, buildNewsStand, buildPlanter, buildPylon, buildSandwichBoard,
} from './props';

const meshesOf = (o: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c as Mesh); });
  return out;
};

const paletteHex = new Set<string>();
const walk = (v: unknown): void => {
  if (typeof v === 'string') paletteHex.add(new Color(v).getHexString());
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') Object.values(v).forEach(walk);
};
walk(PALETTE);

describe('props: teksty (docs/style-guide.md §6)', () => {
  it('nagłówki plakatów mają ≤ 6 słów, hasła i potykacze są niepuste', () => {
    for (const p of POSTERS) expect(p.title.split(/\s+/).length, p.title).toBeLessThanOrEqual(6);
    expect(SLOGANS.length).toBeGreaterThanOrEqual(3);
    for (const lines of BOARD_LINES) expect(lines.length).toBeGreaterThan(0);
  });

  it('żadnych prawdziwych marek: w tekstach rekwizytów i murali nie ma nazwy sieci, którą parodiujemy', () => {
    const source = readFileSync('src/render/store/props.ts', 'utf8') + readFileSync('src/render/street/facadeAtlas.ts', 'utf8');
    expect(source).not.toMatch(/żabk|zabk/i);
  });
});

describe('props: rekwizyty uliczne', () => {
  const face = new MeshStandardMaterial({ name: 'face' });
  const builders: [string, () => Object3D][] = [
    ['prop:bench:0', buildBench], ['prop:bin:0', buildBin], ['prop:planter:0', buildPlanter],
    ['prop:newsstand:0', buildNewsStand], ['prop:board:0', () => buildSandwichBoard(BOARD_LINES[0]!)],
    ['prop:pylon:0', () => buildPylon(face)],
  ];

  for (const [name, build] of builders) {
    it(`${name}: nazwa, kolory z PALETTE, mieści się w wierszu 0 chodnika (≤ 0,5 m w głąb)`, () => {
      const g = build();
      expect(g.name).toBe(name);
      const meshes = meshesOf(g);
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) {
        const mat = m.material as MeshStandardMaterial;
        if (mat.map || mat === face) continue;   // napisy z tekstury
        expect(paletteHex.has(mat.color.getHexString()), `${name} ${m.name} #${mat.color.getHexString()}`).toBe(true);
      }
      g.updateMatrixWorld(true);
      const box = new Box3().setFromObject(g);
      expect(box.max.z - box.min.z, `${name} głębokość`).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(box.max.y).toBeLessThan(2.6);
    });
  }
});
