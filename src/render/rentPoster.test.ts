import { afterEach, describe, expect, it } from 'vitest';
import { lang, tr } from '@/i18n';
import { EN_RENDER } from '@/i18n/en/render';
import { PALETTE } from '@/render/style';
import { fakeContext, fontPx, type Call } from '../../tests/canvasFake';
import { drawRentPoster } from './rentPoster';

const texts = (calls: Call[]): string[] => calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));

afterEach(() => { lang.value = 'pl'; });

describe('drawRentPoster: wspólna kartka „DO WYNAJĘCIA”', () => {
  it('rysuje „DO”, „WYNAJĘCIA” i dopisek, w tej kolejności', () => {
    const { ctx, calls } = fakeContext();
    drawRentPoster(ctx, 20, 62, 216, 160, 'pytać w Centrali');
    expect(texts(calls)).toEqual([tr('DO'), tr('WYNAJĘCIA'), 'pytać w Centrali']);
  });

  it('po angielsku napisy kartki idą przez tr(): „TO” nad „LET”, a dopisek zostaje taki, jaki podał wołający', () => {
    lang.value = 'en';
    const { ctx, calls } = fakeContext();
    drawRentPoster(ctx, 0, 0, 216, 160, tr('pytać w Centrali'));
    expect(texts(calls)).toEqual(['TO', 'LET', 'ask Head Office']);
  });

  it('bez dopisku (null) kartka ma tylko dwa napisy', () => {
    const { ctx, calls } = fakeContext();
    drawRentPoster(ctx, 0, 0, 108, 80, null);
    expect(texts(calls)).toEqual([tr('DO'), tr('WYNAJĘCIA')]);
  });

  it('żółty arkusz w czerwonej ramce, litery czerwone, wszystko w prostokącie kartki (taśma wystaje nad górną krawędź)', () => {
    const red = PALETTE.productCategory.napoje[0];
    const yellow = PALETTE.productCategory.przekaski[0];
    const { ctx, calls } = fakeContext();
    drawRentPoster(ctx, 20, 62, 216, 160, 'dopisek');
    const rects = calls.filter((c) => c.op === 'fillRect');
    expect(rects.some((c) => c.fill === red && c.alpha === 1)).toBe(true);
    expect(rects.some((c) => c.fill === yellow && c.alpha === 1)).toBe(true);
    for (const c of calls.filter((x) => x.op === 'fillText')) expect(c.fill).toBe(red);
    // dopisek stoi na środku kartki w poziomie
    const note = calls.find((c) => c.op === 'fillText' && c.args[0] === 'dopisek')!;
    expect(note.args[1]).toBe(20 + 108);
  });

  it('ten sam układ co kartka z witryny ulicy przed wydzieleniem (komórka 256 × 256 atlasu): „DO” na y + 36, „WYNAJĘCIA” na y + 94, dopisek na y + h − 26', () => {
    const { ctx, calls } = fakeContext();
    drawRentPoster(ctx, 20, 62, 216, 160, 'pytać w Centrali');
    const moves = calls.filter((c) => c.op === 'translate').map((c) => c.args);
    expect(moves).toContainEqual([20 + 108, 62 + 36]);
    expect(moves).toContainEqual([20 + 108, 62 + 94]);
    expect(calls.find((c) => c.op === 'fillText' && c.args[0] === 'pytać w Centrali')!.args).toEqual(['pytać w Centrali', 20 + 108, 62 + 160 - 26]);
    expect(calls.filter((c) => c.op === 'fillText').map(fontPx)).toEqual([50, 70, 20]);
  });

  it('skaluje się z prostokątem: kartka o połowę mniejsza ma czcionki o połowę mniejsze, a napisy w tych samych proporcjach', () => {
    const big = fakeContext();
    const small = fakeContext();
    drawRentPoster(big.ctx, 0, 0, 216, 160, 'dopisek');
    drawRentPoster(small.ctx, 0, 0, 108, 80, 'dopisek');
    const sizes = (calls: Call[]): number[] => calls.filter((c) => c.op === 'fillText').map(fontPx);
    expect(sizes(small.calls).map((s) => s * 2)).toEqual(sizes(big.calls));
    const centres = (calls: Call[]): number[] => calls.filter((c) => c.op === 'translate').map((c) => c.args[1] as number);
    expect(centres(small.calls).map((y) => y * 2)).toEqual(centres(big.calls));
  });
});

describe('słownik sceny', () => {
  it('EN_RENDER ma napisy kartki i dopisek „po Traszce” (lokal po zamkniętym sklepie)', () => {
    expect(EN_RENDER['DO']).toBe('TO');
    expect(EN_RENDER['WYNAJĘCIA']).toBe('LET');
    expect(EN_RENDER['po Traszce']).toBe('ex-Traszka');
  });
});
