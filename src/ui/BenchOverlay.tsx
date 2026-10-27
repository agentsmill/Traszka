import type { BenchProbe } from '@/bench/bench';
import { bench } from './state';

const PROBE_NAME: Record<BenchProbe, string> = {
  charShadowsOff: 'bez cieni postaci',
  crowdHidden: 'bez tłumu',
  aoOff: 'bez AO',
};

const num = (n: number): string => n.toLocaleString('pl-PL');

/** Nakładka benchmarku (`?bench=1`): postęp, a po końcu tabela wyników i prób. Styl jak nakładka wydajności. */
export function BenchOverlay() {
  const progress = bench.value;
  if (progress === null) return null;
  const { done, status, step, rows, probes, warnings } = progress;
  return (
    <div class="tt-perf tt-bench" role="status">
      <h2>Benchmark etapu 1</h2>
      <p class="tt-bench-status">{done ? 'Gotowe.' : status}</p>
      {!done && <p class="tt-bench-step">{step}</p>}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr><th>Preset</th><th>FPS</th><th>p95 ms</th><th>Wywołania</th><th>Trójkąty</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.preset}>
                <td>{r.preset}</td><td>{r.avgFps}</td><td>{r.p95FrameMs}</td><td>{num(r.calls)}</td><td>{num(r.tris)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {probes.length > 0 && (
        <table>
          <thead>
            <tr><th>Próba</th><th>FPS</th><th>p95 ms</th><th>Wywołania</th><th>Trójkąty</th><th>JS ms</th></tr>
          </thead>
          <tbody>
            {probes.map((p) => (
              <tr key={`${p.preset}-${p.probe}`}>
                <td>{p.preset} {PROBE_NAME[p.probe]}</td><td>{p.avgFps}</td><td>{p.p95FrameMs}</td><td>{num(p.calls)}</td><td>{num(p.tris)}</td><td>{p.cpuMs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {warnings.map((w) => <p class="tt-bench-warn" key={w}>{w}</p>)}
    </div>
  );
}
