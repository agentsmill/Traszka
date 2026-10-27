import { describe, expect, it } from 'vitest';
import { QUALITY, pickInitialPreset, resolveStartPreset } from './quality';

describe('QUALITY', () => {
  it('ma wartości z wymagań dla trzech presetów', () => {
    expect(QUALITY.niska).toEqual({ maxPixelRatio: 1, shadowMapSize: 1024, ao: 'off', bloom: false, smaa: true });
    expect(QUALITY.srednia).toEqual({ maxPixelRatio: 1.5, shadowMapSize: 2048, ao: 'half', bloom: true, smaa: true });
    expect(QUALITY.wysoka).toEqual({ maxPixelRatio: 2, shadowMapSize: 4096, ao: 'full', bloom: true, smaa: true });
  });

  it('pixelRatio nigdy nie przekracza 2', () => {
    for (const q of Object.values(QUALITY)) expect(q.maxPixelRatio).toBeLessThanOrEqual(2);
  });
});

describe('pickInitialPreset', () => {
  it('bez WebGL 2 wybiera niską', () => {
    expect(pickInitialPreset({ webgl2: false, isMobile: false })).toBe('niska');
  });

  it('na telefonie wybiera niską, także z WebGL 2', () => {
    expect(pickInitialPreset({ webgl2: true, isMobile: true })).toBe('niska');
    expect(pickInitialPreset({ webgl2: false, isMobile: true })).toBe('niska');
  });

  it('na komputerze z WebGL 2 wybiera średnią', () => {
    expect(pickInitialPreset({ webgl2: true, isMobile: false })).toBe('srednia');
  });
});

describe('resolveStartPreset', () => {
  const all = { context: true, post: true, ao: true };

  it('zostawia zamówiony preset, gdy wszystko działa', () => {
    for (const id of ['niska', 'srednia', 'wysoka'] as const) {
      expect(resolveStartPreset(id, all)).toEqual({ preset: id, reduced: false });
    }
  });

  it('bez kontekstu WebGL 2 schodzi na niską i oznacza tryb oszczędny', () => {
    expect(resolveStartPreset('wysoka', { ...all, context: false })).toEqual({ preset: 'niska', reduced: true });
    expect(resolveStartPreset('niska', { ...all, context: false })).toEqual({ preset: 'niska', reduced: true });
  });

  it('bez postprocessingu schodzi na niską', () => {
    expect(resolveStartPreset('srednia', { ...all, post: false })).toEqual({ preset: 'niska', reduced: true });
  });

  it('bez AO schodzi na niską, a niska nie potrzebuje AO i zostaje', () => {
    expect(resolveStartPreset('wysoka', { ...all, ao: false })).toEqual({ preset: 'niska', reduced: true });
    expect(resolveStartPreset('srednia', { ...all, ao: false })).toEqual({ preset: 'niska', reduced: true });
    expect(resolveStartPreset('niska', { ...all, ao: false })).toEqual({ preset: 'niska', reduced: false });
  });

  it('po zejściu na niską cień ma rozmiar mapy z niskiej (regresja: zostawał rozmiar z zamówionego presetu)', () => {
    const { preset } = resolveStartPreset('wysoka', { ...all, ao: false });
    expect(QUALITY[preset].shadowMapSize).toBe(1024);
  });
});
