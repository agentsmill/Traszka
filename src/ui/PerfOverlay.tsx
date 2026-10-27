import { perf, showPerf } from './state';

/** Nakładka wydajności w lewym dolnym rogu. Przełącza ją F3 albo `?perf=1`. */
export function PerfOverlay() {
  if (!showPerf.value) return null;
  const { fps, ms, calls, tris } = perf.value;
  return (
    <div class="tt-perf">
      <div><span>FPS</span><b>{Math.round(fps)}</b></div>
      <div><span>Klatka</span><b>{ms.toFixed(1)} ms</b></div>
      <div><span>Wywołania rysowania</span><b>{calls.toLocaleString('pl-PL')}</b></div>
      <div><span>Trójkąty</span><b>{tris.toLocaleString('pl-PL')}</b></div>
      <p>F3 ukrywa</p>
    </div>
  );
}
