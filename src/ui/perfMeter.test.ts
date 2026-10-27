import { describe, expect, it } from 'vitest';
import { FrameMeter, type PerfSnapshot } from './perfMeter';

const FRAME_60 = 1000 / 60;

/** Prowadzi licznik klatkami o stałym odstępie i zwraca wszystkie publikacje z ich czasem. */
function run(meter: FrameMeter, frames: number, dtMs: number, start = 0, calls = 7, tris = 1234): { t: number; sample: PerfSnapshot }[] {
  const out: { t: number; sample: PerfSnapshot }[] = [];
  let t = start;
  for (let i = 0; i < frames; i++) {
    const sample = meter.tick(t, calls, tris);
    if (sample) out.push({ t, sample });
    t += dtMs;
  }
  return out;
}

const lastSample = (samples: { sample: PerfSnapshot }[]): PerfSnapshot => samples[samples.length - 1].sample;

describe('FrameMeter', () => {
  it('liczy FPS i czas klatki ze średniej z ostatniej sekundy', () => {
    const last = lastSample(run(new FrameMeter(), 120, FRAME_60));
    expect(last.fps).toBeCloseTo(60, 6);
    expect(last.ms).toBeCloseTo(FRAME_60, 6);
  });

  it('publikuje około 4 razy na sekundę, a nie co klatkę', () => {
    const samples = run(new FrameMeter(), 120, FRAME_60);   // 2 s przy 60 FPS
    expect(samples.length).toBeGreaterThanOrEqual(7);
    expect(samples.length).toBeLessThanOrEqual(9);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].t - samples[i - 1].t).toBeGreaterThanOrEqual(249);
    }
  });

  it('przekazuje liczniki rysowania z ostatniej klatki bez zmian', () => {
    const last = lastSample(run(new FrameMeter(), 60, FRAME_60, 0, 191, 499717));
    expect(last.calls).toBe(191);
    expect(last.tris).toBe(499717);
  });

  it('zacięcie obniża FPS, a po sekundzie okno je wypycha i średnia wraca do normy', () => {
    const meter = new FrameMeter();
    run(meter, 120, FRAME_60);                               // płynnie przez 2 s
    const stallAt = 119 * FRAME_60 + 500;                    // jedna klatka trwała pół sekundy
    meter.tick(stallAt, 0, 0);
    const dip = lastSample(run(meter, 20, FRAME_60, stallAt + FRAME_60));
    expect(dip.fps).toBeLessThan(50);
    const recovered = lastSample(run(meter, 90, FRAME_60, stallAt + 21 * FRAME_60));
    expect(recovered.fps).toBeCloseTo(60, 6);
  });

  it('nie dzieli przez zero, gdy znacznik czasu się nie zmienia', () => {
    const meter = new FrameMeter();
    expect(meter.tick(100, 0, 0)).toBeNull();               // pierwsza klatka: brak odstępu
    expect(meter.tick(100, 0, 0)).toBeNull();
    const sample = meter.tick(100 + FRAME_60, 0, 0);
    expect(Number.isFinite(sample?.fps ?? Number.NaN)).toBe(true);
  });
});
