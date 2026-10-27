import { describe, it, expect } from 'vitest';
import { MeshStandardMaterial } from 'three';
import { PALETTE, BEVEL, material, LIGHT_PRESETS, CHARACTER_STYLE } from './style';

/** Kanały 0–255 z '#rrggbb'. */
function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
/** HSV: s, v w [0, 1]. */
function sv(hex: string): { s: number; v: number; chroma: number } {
  const c = rgb(hex);
  const max = Math.max(...c);
  const min = Math.min(...c);
  return { s: max === 0 ? 0 : (max - min) / max, v: max / 255, chroma: max - min };
}

function allPaletteColors(): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(PALETTE);
  return out;
}

describe('PALETTE', () => {
  it('każdy kolor to #rrggbb, bez czystej szarości, bieli i czerni', () => {
    const colors = allPaletteColors();
    expect(colors.length).toBeGreaterThan(80);
    for (const c of colors) {
      expect(c, c).toMatch(/^#[0-9a-f]{6}$/);
      expect(sv(c).chroma, `${c}: za szary`).toBeGreaterThanOrEqual(8);
      expect(sv(c).v, `${c}: za ciemny`).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('kolory marki są nasycone', () => {
    for (const c of [PALETTE.brand.green, PALETTE.brand.greenDark, PALETTE.brand.orange]) {
      expect(sv(c).s, c).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('każda kategoria towaru ma ≥ 4 kolory, w tym ≥ 3 nasycone (S ≥ 0,5)', () => {
    for (const [cat, list] of Object.entries(PALETTE.productCategory)) {
      expect(list.length, cat).toBeGreaterThanOrEqual(4);
      expect(list.filter((c) => sv(c).s >= 0.5).length, cat).toBeGreaterThanOrEqual(3);
    }
  });

  it('tło jest spokojne (S ≤ 0,35): floor, wall poza cokołem wall[2], asphalt, sidewalk, curb', () => {
    const calm = [...PALETTE.floor, ...PALETTE.wall.filter((_, i) => i !== 2), ...PALETTE.street.asphalt,
      ...PALETTE.street.sidewalk, ...PALETTE.street.curb];
    for (const c of calm) expect(sv(c).s, c).toBeLessThanOrEqual(0.35);
  });

  it('elewacje nie przekrzykują sklepu (S ≤ 0,5), pastele bloków są jasne (V ≥ 0,78, S ≥ 0,15)', () => {
    for (const c of PALETTE.street.kamienicaPlaster) expect(sv(c).s, c).toBeLessThanOrEqual(0.5);
    for (const c of PALETTE.street.blokPastel) {
      const { s, v } = sv(c);
      expect(v, c).toBeGreaterThanOrEqual(0.78);
      expect(s, c).toBeGreaterThanOrEqual(0.15);
      expect(s, c).toBeLessThanOrEqual(0.5);
    }
  });

  it('klienci nie noszą zieleni marki (to kolor personelu)', () => {
    expect(PALETTE.clothes).not.toContain(PALETTE.brand.green);
    expect(PALETTE.clothes).not.toContain(PALETTE.brand.greenDark);
  });

  it('jest zamrożona, więc nikt nie zmieni wspólnej palety', () => {
    expect(() => { (PALETTE.skin as string[]).push('#123456'); }).toThrow();
    expect(() => { (PALETTE.brand as { green: string }).green = '#123456'; }).toThrow();
  });
});

describe('material()', () => {
  it('zwraca tę samą instancję dla tego samego klucza kind:color:opts', () => {
    const a = material('plasticMatte', '#2faa4f');
    expect(material('plasticMatte', '#2faa4f')).toBe(a);
    expect(material('plasticMatte', '#2FAA4F')).toBe(a);
    const e = material('emissive', '#ff8a1f', { emissiveIntensity: 2, opacity: 0.5 });
    expect(material('emissive', '#ff8a1f', { opacity: 0.5, emissiveIntensity: 2 })).toBe(e);
  });

  it('różne rodzaje, kolory lub opcje dają różne instancje', () => {
    const a = material('plasticMatte', '#2faa4f');
    expect(material('plasticGloss', '#2faa4f')).not.toBe(a);
    expect(material('plasticMatte', '#2faa50')).not.toBe(a);
    expect(material('plasticMatte', '#2faa4f', { opacity: 0.5 })).not.toBe(a);
  });

  it('jawne opcje domyślne trafiają w ten sam wpis co brak opcji', () => {
    const g = material('glass', '#d6eef0') as MeshStandardMaterial;
    expect(material('glass', '#d6eef0', { opacity: g.opacity })).toBe(g);
  });

  it('ustawia właściwości według rodzaju', () => {
    const glass = material('glass', '#d6eef0') as MeshStandardMaterial;
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    expect(glass.opacity).toBeLessThan(0.5);

    const neon = material('emissive', '#2faa4f', { emissiveIntensity: 3 }) as MeshStandardMaterial;
    expect(neon.emissiveIntensity).toBe(3);
    expect(neon.emissive.getHexString()).toBe('2faa4f');

    const matte = material('plasticMatte', '#e57f3f') as MeshStandardMaterial;
    const gloss = material('plasticGloss', '#e57f3f') as MeshStandardMaterial;
    expect(gloss.roughness).toBeLessThan(matte.roughness);
    expect(matte.transparent).toBe(false);
    expect(matte.color.getHexString()).toBe('e57f3f');

    const marker = material('plasticMatte', '#e57f3f', { opacity: 0.5 }) as MeshStandardMaterial;
    expect(marker.transparent).toBe(true);
  });

  it('odrzuca kolor spoza #rrggbb i opcje spoza zakresu', () => {
    expect(() => material('wood', 'brown')).toThrow();
    expect(() => material('wood', '#abc')).toThrow();
    expect(() => material('glass', '#d6eef0', { opacity: 1.5 })).toThrow();
    expect(() => material('emissive', '#d6eef0', { emissiveIntensity: -1 })).toThrow();
  });
});

describe('BEVEL, LIGHT_PRESETS, CHARACTER_STYLE', () => {
  it('fazowanie: 0 < small < medium ≤ 5 cm', () => {
    expect(BEVEL.small).toBeGreaterThan(0);
    expect(BEVEL.small).toBeLessThan(BEVEL.medium);
    expect(BEVEL.medium).toBeLessThanOrEqual(0.05);
  });

  it('noc jest ciemniejsza od dnia i ma mocniejszy bloom', () => {
    const { day, night } = LIGHT_PRESETS;
    expect(night.sun.intensity).toBeLessThan(day.sun.intensity);
    expect(night.envIntensity).toBeLessThan(day.envIntensity);
    expect(night.bloomStrength).toBeGreaterThan(day.bloomStrength);
    for (const p of [day, night]) {
      expect(p.sun.elevationDeg).toBeGreaterThan(0);
      expect(p.sun.elevationDeg).toBeLessThanOrEqual(90);
    }
  });

  it('postacie: większa głowa i dłonie, rosnące zakresy', () => {
    expect(CHARACTER_STYLE.headScale).toBeGreaterThan(1);
    expect(CHARACTER_STYLE.handScale).toBeGreaterThan(1);
    const [h0, h1] = CHARACTER_STYLE.heightRange;
    const [w0, w1] = CHARACTER_STYLE.widthRange;
    expect(h0).toBeLessThan(h1);
    expect(w0).toBeLessThan(w1);
    expect(h0).toBeGreaterThan(1.4);   // metry, dorośli
    expect(h1).toBeLessThan(2.05);
  });
});
