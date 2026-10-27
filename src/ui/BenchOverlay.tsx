import type { BenchProbe } from '@/bench/bench';
import { bench } from './state';

const PROBE_NAME: Record<BenchProbe, string> = {
  charShadowsOff: 'bez cieni postaci',
  crowdHidden: 'bez tłumu',
  aoOff: 'bez AO',
};

const num = (n: number): string => n.toLocaleString('pl-PL');

/**
 * Nakładka benchmarku (`?bench=1`): postęp, a po końcu tabele wyników i prób. Obie tabele pokazują liczbę klatek i najdłuższą
 * klatkę, bo bez nich nie widać, czy okno pomiaru jest pełne i czy nie wpadło w nie zawieszenie. Bieg próbny (`quick=1`)
 * jest podpisany w tytule. Styl jak nakładka wydajności.
 */
export function BenchOverlay() {
  const progress = bench.value;
  if (progress === null) return null;
  const { done, status, step, rows, probes, warnings, quick } = progress;
  return (
    <div class="tt-perf tt-bench" role="status">
      <h2>
        Benchmark etapu 1
        {quick && <span class="tt-bench-warn"> · bieg próbny — liczby nie do dokumentu</span>}
      </h2>
      <p class="tt-bench-status">{done ? 'Gotowe.' : status}</p>
      {!done && <p class="tt-bench-step">{step}</p>}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr><th>Preset</th><th>FPS</th><th>p95 ms</th><th>maks ms</th><th>Klatki</th><th>Wywołania</th><th>Trójkąty</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.preset}>
                <td>{r.preset}</td><td>{r.avgFps}</td><td>{r.p95FrameMs}</td><td>{r.maxFrameMs}</td><td>{r.frames}</td>
                <td>{num(r.calls)}</td><td>{num(r.tris)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {probes.length > 0 && (
        <table>
          <thead>
            <tr><th>Próba</th><th>FPS</th><th>p95 ms</th><th>maks ms</th><th>Klatki</th><th>Wywołania</th><th>Trójkąty</th><th>JS ms</th></tr>
          </thead>
          <tbody>
            {probes.map((p) => (
              <tr key={`${p.preset}-${p.probe}`}>
                <td>{p.preset} {PROBE_NAME[p.probe]}</td><td>{p.avgFps}</td><td>{p.p95FrameMs}</td><td>{p.maxFrameMs}</td>
                <td>{p.frames}</td><td>{num(p.calls)}</td><td>{num(p.tris)}</td><td>{p.cpuMs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {warnings.map((w) => <p class="tt-bench-warn" key={w}>{w}</p>)}
    </div>
  );
}
