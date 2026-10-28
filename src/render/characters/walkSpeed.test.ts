import { describe, expect, it } from 'vitest';
import { WALK_SPEED_MPS, WALK_TIME_SCALE_RANGE, walkTimeScale } from './walkSpeed';

describe('walkTimeScale', () => {
  it('prędkość agenta równa prędkości stopy w klipie daje 1', () => {
    expect(walkTimeScale(WALK_SPEED_MPS, WALK_SPEED_MPS, 1)).toBeCloseTo(1, 12);
  });

  it('skaluje proporcjonalnie do prędkości agenta i odwrotnie do skali postaci', () => {
    expect(walkTimeScale(WALK_SPEED_MPS, 1.3, 1)).toBeCloseTo(1.3 / WALK_SPEED_MPS, 12);
    expect(walkTimeScale(WALK_SPEED_MPS, 1.3, 0.9)).toBeCloseTo(1.3 / (WALK_SPEED_MPS * 0.9), 12);
    expect(walkTimeScale(0.95, 1.3, 1)).toBeGreaterThan(walkTimeScale(1.15, 1.3, 1));   // wolniejszy klip trzeba przyspieszyć bardziej
  });

  it('jest ograniczony do WALK_TIME_SCALE_RANGE', () => {
    expect(walkTimeScale(WALK_SPEED_MPS, 100, 1)).toBe(WALK_TIME_SCALE_RANGE.max);
    expect(walkTimeScale(WALK_SPEED_MPS, 0.01, 1)).toBe(WALK_TIME_SCALE_RANGE.min);
  });

  it('zakres prędkości agentów (2,2–3,0 kratki/s) mieści się w granicach', () => {
    for (const cellsPerS of [2.2, 3.0]) {
      const k = walkTimeScale(WALK_SPEED_MPS, cellsPerS * 0.5, 0.9);
      expect(k).toBeGreaterThan(WALK_TIME_SCALE_RANGE.min);
      expect(k).toBeLessThan(WALK_TIME_SCALE_RANGE.max);
    }
  });
});
