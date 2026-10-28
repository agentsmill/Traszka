import { render } from 'preact';
import { PALETTE } from '@/render/style';
import { BenchOverlay } from './BenchOverlay';
import { Hud } from './game/Hud';
import {
  CelebrationBanner, ClickerBar, ComboChip, GiftDrop, Intro, PrestigeModal, ReportModal, RotateButtons, SelectionCard, Settings,
  Toasts, WelcomeModal,
} from './game/overlays';
import { Sheet, TabBar } from './game/panels';
import { Notice } from './Notice';
import { PerfOverlay } from './PerfOverlay';
import { floatText } from './worldOverlay';
import type { Controls, GameActions } from './state';
import './ui.css';

/** Kolory marki jako zmienne CSS, żeby arkusz i TypeScript nie rozjechały się co do palety. */
const brandVars = {
  '--tt-green': PALETTE.brand.green,
  '--tt-green-dark': PALETTE.brand.greenDark,
  '--tt-orange': PALETTE.brand.orange,
  '--tt-cream': PALETTE.brand.cream,
} as Record<string, string>;

/**
 * Cała nakładka. Bez `controls` (renderer nie wstał albo benchmark) zostaje komunikat i wyniki benchmarku.
 * W grze: górny pasek, zakładki z arkuszami, karta zaznaczenia, przyciski klikera, komunikaty i okna.
 */
export function App({ controls, game }: { controls: Controls | null; game: GameActions | null }) {
  return (
    <div class="tt-ui" style={brandVars}>
      {controls && game && <Hud controls={controls} />}
      <Notice />
      <BenchOverlay />
      {controls && game && (
        <>
          <div class="tt-topstack">
            <SelectionCard game={game} />
            <Toasts />
          </div>
          <ClickerBar game={game} onFloat={floatText} />
          <ComboChip />
          <GiftDrop game={game} onClaim={(x, y, text) => floatText(x, y, text.split(':').pop()?.trim() ?? '', 'money')} />
          <RotateButtons controls={controls} />
          <Sheet game={game} />
          <TabBar />
          <ReportModal game={game} />
          <WelcomeModal game={game} />
          <PrestigeModal game={game} />
          <CelebrationBanner />
          <Intro />
          <Settings controls={controls} game={game} />
        </>
      )}
      {controls && <PerfOverlay />}
    </div>
  );
}

/** Montuje albo odświeża nakładkę w `root` (kontener `#ui` z index.html). */
export function renderUi(root: HTMLElement, controls: Controls | null, game: GameActions | null): void {
  render(<App controls={controls} game={game} />, root);
}
