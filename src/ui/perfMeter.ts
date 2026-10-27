/** Co pokazuje nakładka wydajności: FPS i czas klatki (średnia z ostatniej sekundy) oraz liczniki rysowania. */
export interface PerfSnapshot { fps: number; ms: number; calls: number; tris: number }

/**
 * Średnia z klatek z ostatnich `windowMs` i publikacja co `publishEveryMs`, żeby sygnał UI nie przerysowywał się 60 razy na sekundę.
 * `tick` wołany co klatkę z czasem rAF i licznikami z renderera (`info.render`) z tej klatki. Zwraca próbkę tylko przy publikacji.
 */
export class FrameMeter {
  private readonly frames: { at: number; dt: number }[] = [];
  private last: number | null = null;
  private lastPublish = Number.NEGATIVE_INFINITY;

  constructor(private readonly windowMs = 1000, private readonly publishEveryMs = 250) {}

  tick(now: number, calls: number, tris: number): PerfSnapshot | null {
    if (this.last !== null && now > this.last) this.frames.push({ at: now, dt: now - this.last });
    this.last = now;
    while (this.frames.length > 0 && now - this.frames[0].at > this.windowMs) this.frames.shift();

    if (this.frames.length === 0 || now - this.lastPublish < this.publishEveryMs) return null;
    this.lastPublish = now;
    const ms = this.frames.reduce((sum, f) => sum + f.dt, 0) / this.frames.length;
    return { fps: 1000 / ms, ms, calls, tris };
  }
}
