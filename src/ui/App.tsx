import { render } from 'preact';
import { PALETTE } from '@/render/style';
import { BenchOverlay } from './BenchOverlay';
import { CardDesk } from './game/cards';
import { Hud } from './game/Hud';
import {
  CelebrationBanner, ClickerBar, ComboChip, FirstDayHints, PrestigeModal, ReportModal, RotateButtons, SelectionCard, Settings,
  StoreBadge, StoryModal, Toasts, WelcomeModal,
} from './game/overlays';
import { Sheet, TabBar } from './game/panels';
import { HowTo } from './howto/HowTo';
import { Notice } from './Notice';
import { PerfOverlay } from './PerfOverlay';
import { StartHost } from './start/StartScreen';
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
 * Cała nakładka. Bez `controls` (renderer nie wstał, benchmark albo gra jeszcze nie ruszyła) zostaje komunikat, wyniki benchmarku
 * i ekran startowy „Twój kasjer”, który otwiera się przy pierwszym wejściu, zanim powstanie gra. W grze: górny pasek, zakładki
 * z arkuszami, karta zaznaczenia, przyciski klikera, podpowiedzi pierwszego dnia, komunikaty i okna. Kolejność okien to ich
 * warstwy: karta decyzji leży nad panelami, a pod raportem miesiąca, „Jak grać”, powitaniem i ustawieniami.
 */
export function App({ controls, game }: { controls: Controls | null; game: GameActions | null }) {
  return (
    <div class="tt-ui" style={brandVars}>
      {controls && game && <Hud controls={controls} />}
      <Notice />
      <BenchOverlay />
      {controls && game && (
        <>
          <StoreBadge />
          <div class="tt-topstack">
            <SelectionCard game={game} />
            <Toasts />
            <FirstDayHints />
          </div>
          <ClickerBar game={game} onFloat={floatText} />
          <ComboChip />
          <RotateButtons controls={controls} />
          <Sheet game={game} />
          <TabBar />
          <CardDesk game={game} />
          <StoryModal />
          <ReportModal game={game} />
          <HowTo />
          <WelcomeModal game={game} />
          <PrestigeModal game={game} />
          <CelebrationBanner />
          <Settings controls={controls} game={game} />
        </>
      )}
      {controls && <PerfOverlay />}
      <StartHost />
    </div>
  );
}

/** Montuje albo odświeża nakładkę w `root` (kontener `#ui` z index.html). */
export function renderUi(root: HTMLElement, controls: Controls | null, game: GameActions | null): void {
  render(<App controls={controls} game={game} />, root);
}
