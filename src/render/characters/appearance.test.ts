import { describe, expect, it } from 'vitest';
import { ASSETS } from '@/render/assets';
import { CHARACTER_STYLE, PALETTE } from '@/render/style';
import { HAIRSTYLES_BY_BODY, MIN_CLOTHES_SKIN_DISTANCE, pickAppearance } from './appearance';

const SEEDS = Array.from({ length: 100 }, (_, i) => `klient-${i}`);

describe('pickAppearance', () => {
  it('jest deterministyczny: ten sam seed daje ten sam wygląd', () => {
    for (const seed of SEEDS.slice(0, 10)) expect(pickAppearance(seed)).toEqual(pickAppearance(seed));
  });

  it('100 seedów daje ≥ 6 różnych par skóra + włosy i oba typy ciała', () => {
    const all = SEEDS.map(pickAppearance);
    expect(new Set(all.map((a) => `${a.skin}|${a.hair}`)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(all.map((a) => a.body))).toEqual(new Set(['male', 'female']));
  });

  it('wzrost i tusza mieszczą się w CHARACTER_STYLE', () => {
    for (const a of SEEDS.map(pickAppearance)) {
      expect(a.height).toBeGreaterThanOrEqual(CHARACTER_STYLE.heightRange[0]);
      expect(a.height).toBeLessThanOrEqual(CHARACTER_STYLE.heightRange[1]);
      expect(a.width).toBeGreaterThanOrEqual(CHARACTER_STYLE.widthRange[0]);
      expect(a.width).toBeLessThanOrEqual(CHARACTER_STYLE.widthRange[1]);
    }
  });

  it('kolory pochodzą z PALETTE, a góra i dół różnią się', () => {
    for (const a of SEEDS.map(pickAppearance)) {
      expect(PALETTE.skin).toContain(a.skin);
      expect(PALETTE.hair).toContain(a.hair);
      expect(PALETTE.clothes).toContain(a.top);
      expect(PALETTE.clothes).toContain(a.bottom);
      expect(a.top).not.toBe(a.bottom);
    }
  });

  it('góra i dół wyraźnie odcinają się od koloru skóry', () => {
    const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    const dist = (a: string, b: string): number => Math.hypot(channel(a, 0) - channel(b, 0), channel(a, 1) - channel(b, 1), channel(a, 2) - channel(b, 2));
    for (const a of SEEDS.map(pickAppearance)) {
      expect(dist(a.top, a.skin)).toBeGreaterThanOrEqual(MIN_CLOTHES_SKIN_DISTANCE);
      expect(dist(a.bottom, a.skin)).toBeGreaterThanOrEqual(MIN_CLOTHES_SKIN_DISTANCE);
    }
  });

  it('fryzura pasuje do ciała i wskazuje istniejący plik z ASSETS', () => {
    const hair = ASSETS.characters.ubc.hair;
    const seen = { male: new Set<number>(), female: new Set<number>() };
    for (const a of SEEDS.map(pickAppearance)) {
      expect(HAIRSTYLES_BY_BODY[a.body]).toContain(a.hairIndex);
      expect(a.hairIndex).toBeLessThan(hair.length);
      seen[a.body].add(a.hairIndex);
    }
    // broda tylko u mężczyzn; koki, długie i „buzzed-female” tylko u kobiet
    const name = (i: number): string => hair[i];
    expect([...seen.female].map(name).some((f) => f.includes('beard'))).toBe(false);
    expect([...seen.male].map(name).some((f) => /buns|long|buzzed-female/.test(f))).toBe(false);
    expect(seen.male.size).toBeGreaterThanOrEqual(2);
    expect(seen.female.size).toBeGreaterThanOrEqual(2);
  });

  it('akcesorium to jedna z czterech wartości i każda się zdarza', () => {
    const kinds = new Set(SEEDS.map((s) => pickAppearance(s).accessory));
    expect(kinds).toEqual(new Set(['none', 'backpack', 'bag', 'phone']));
  });
});
