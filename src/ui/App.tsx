import { render } from 'preact';
import { PALETTE } from '@/render/style';
import { BenchOverlay } from './BenchOverlay';
import { Notice } from './Notice';
import { PerfOverlay } from './PerfOverlay';
import { TopBar } from './TopBar';
import type { Controls } from './state';
import './ui.css';

/** Kolory marki jako zmienne CSS, żeby arkusz i TypeScript nie rozjechały się co do palety. */
const brandVars = {
  '--tt-green': PALETTE.brand.green,
  '--tt-green-dark': PALETTE.brand.greenDark,
  '--tt-orange': PALETTE.brand.orange,
  '--tt-cream': PALETTE.brand.cream,
} as Record<string, string>;

/**
 * Cała nakładka. Bez `controls` (renderer nie wstał) zostaje tylko komunikat, bo sterowanie nie ma czego sterować.
 */
export function App({ controls }: { controls: Controls | null }) {
  return (
    <div class="tt-ui" style={brandVars}>
      <Notice />
      <BenchOverlay />
      {controls && <TopBar controls={controls} />}
      {controls && <PerfOverlay />}
    </div>
  );
}

/** Montuje albo odświeża nakładkę w `root` (kontener `#ui` z index.html). */
export function renderUi(root: HTMLElement, controls: Controls | null): void {
  render(<App controls={controls} />, root);
}
