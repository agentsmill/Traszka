import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeContext, fontPx } from '../../tests/canvasFake';
import { fitText, rect } from './canvasDraw';

describe('rect', () => {
  it('wypełnia prostokąt kolorem z przezroczystością i oddaje przezroczystość 1', () => {
    const { ctx, calls } = fakeContext();
    rect(ctx, '#e23d3d', 1, 2, 30, 40, 0.25);
    const fill = calls.find((c) => c.op === 'fillRect')!;
    expect(fill.args).toEqual([1, 2, 30, 40]);
    expect(fill.fill).toBe('#e23d3d');
    expect(fill.alpha).toBe(0.25);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('bez podanej przezroczystości rysuje w pełni kryjąco', () => {
    const { ctx, calls } = fakeContext();
    rect(ctx, '#000000', 0, 0, 5, 5);
    expect(calls.find((c) => c.op === 'fillRect')!.alpha).toBe(1);
  });
});

describe('fitText', () => {
  it('mieszczący się napis zostaje w zadanym rozmiarze czcionki, wyśrodkowany w (x, y)', () => {
    const { ctx, calls } = fakeContext();
    fitText(ctx, 'abcd', 50, 60, 20, 100, '#123456');
    const t = calls.find((c) => c.op === 'fillText')!;
    expect(t.args).toEqual(['abcd', 50, 60]);
    expect(fontPx(t)).toBe(20);
    expect(t.fill).toBe('#123456');
    expect(ctx.textAlign).toBe('center');
    expect(ctx.textBaseline).toBe('middle');
  });

  it('za szeroki napis dostaje czcionkę zmniejszoną do skutku (całkowity rozmiar)', () => {
    const { ctx, calls } = fakeContext();
    // atrapa mierzy 0,5 px czcionki na znak: 20 znaków przy 20 px to 200 px, a miejsca jest 150
    fitText(ctx, 'x'.repeat(20), 0, 0, 20, 150, '#000000');
    expect(fontPx(calls.find((c) => c.op === 'fillText')!)).toBe(Math.floor((20 * 150) / 200));
  });
});

describe('źródła: jedno miejsce na rect i fitText', () => {
  const read = (rel: string): string => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

  it('facadeAtlas.ts i rentPoster.ts importują rect i fitText z canvasDraw.ts, a własnych kopii nie mają', () => {
    for (const rel of ['src/render/street/facadeAtlas.ts', 'src/render/rentPoster.ts']) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/function (rect|fitText)\(/);
      expect(src, rel).toMatch(/import\s*\{[^}]*\bfitText\b[^}]*\}\s*from\s*'@\/render\/canvasDraw'/);
      expect(src, rel).toMatch(/import\s*\{[^}]*\brect\b[^}]*\}\s*from\s*'@\/render\/canvasDraw'/);
    }
  });
});
