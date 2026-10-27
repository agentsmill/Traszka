import { describe, expect, it } from 'vitest';
import { QUALITY, pickInitialPreset } from './quality';

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
