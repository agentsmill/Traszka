import { describe, expect, it } from 'vitest';
import { SIM_STEP } from '@/sim/crowd/crowd';
import { MAX_FRAME_DT, MAX_STEPS_PER_FRAME, advanceClock, clockAlpha, type Speed } from './loop';

describe('advanceClock', () => {
  it('jeden krok SIM_STEP przy prędkości ×1', () => {
    const clock = { acc: 0 };
    expect(advanceClock(clock, 1 / 30, 1)).toBe(1);
    expect(clock.acc).toBeCloseTo(0, 9);
  });

  it('przycina dt do MAX_FRAME_DT: 5 s przy ×8 daje 24 kroki', () => {
    const clock = { acc: 0 };
    expect(MAX_FRAME_DT).toBe(0.1);
    expect(advanceClock(clock, 5, 8)).toBe(24);
    expect(clock.acc).toBeLessThan(SIM_STEP);
  });

  it('prędkość 0 nie wykonuje kroków i nie rusza acc', () => {
    const clock = { acc: 0.01 };
    expect(advanceClock(clock, 0.05, 0)).toBe(0);
    expect(clock.acc).toBe(0.01);
  });

  it('mała ramka tylko gromadzi czas, a krok wypada po kilku ramkach', () => {
    const clock = { acc: 0 };
    let steps = 0;
    for (let i = 0; i < 4; i++) steps += advanceClock(clock, 1 / 120, 1);
    expect(steps).toBe(1);
    expect(clock.acc).toBeCloseTo(0, 9);
  });

  it('tolerancja 1e-9: acc tuż poniżej SIM_STEP liczy się jako pełny krok', () => {
    const clock = { acc: SIM_STEP - 5e-10 };
    expect(advanceClock(clock, 0, 1)).toBe(1);
    expect(clock.acc).toBe(0);
  });

  it('nigdy nie przekracza MAX_STEPS_PER_FRAME i nie gromadzi zaległości', () => {
    const clock = { acc: 100 };
    expect(advanceClock(clock, MAX_FRAME_DT, 8)).toBe(MAX_STEPS_PER_FRAME);
    expect(clock.acc).toBeLessThan(SIM_STEP);
    for (const speed of [1, 2, 4, 8] as Speed[]) {
      const c = { acc: 0 };
      for (let i = 0; i < 100; i++) expect(advanceClock(c, 3, speed)).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
    }
  });

  it('średnio wykonuje speed · dt / SIM_STEP kroków (60 FPS, ×2)', () => {
    const clock = { acc: 0 };
    let steps = 0;
    for (let i = 0; i < 600; i++) steps += advanceClock(clock, 1 / 60, 2);
    expect(steps).toBe(600);   // 10 s · 2 · 30 kroków/s = 600
  });

  it('ujemne i niefinitywne dt nic nie robią', () => {
    const clock = { acc: 0.01 };
    expect(advanceClock(clock, -1, 1)).toBe(0);
    expect(advanceClock(clock, Number.NaN, 1)).toBe(0);
    expect(advanceClock(clock, Number.POSITIVE_INFINITY, 8)).toBe(0);
    expect(advanceClock(clock, 1 / 30, Number.NaN as unknown as 1)).toBe(0);
    expect(clock.acc).toBe(0.01);
  });
});

describe('clockAlpha', () => {
  it('to acc / SIM_STEP w [0, 1]', () => {
    expect(clockAlpha({ acc: 0 })).toBe(0);
    expect(clockAlpha({ acc: SIM_STEP / 2 })).toBeCloseTo(0.5, 12);
    expect(clockAlpha({ acc: SIM_STEP * 3 })).toBe(1);
    expect(clockAlpha({ acc: -1 })).toBe(0);
  });
});
