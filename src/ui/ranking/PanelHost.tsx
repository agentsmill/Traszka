import { closePanel, panel, unsent, type GameActions } from '../state';
import { RankingPanel } from './RankingPanel';
import { RecoveryPanel } from './RecoveryPanel';
import type { RankingServices } from './services';

/**
 * Panele rankingu i kodu odzyskiwania w aplikacji: pokazuje ten, który wskazuje sygnał `panel` (otwierają go przycisk 🏆 w HUD-zie
 * i sekcja „Ranking” w ⚙), z modelem z usług. Komponent bez hooków, więc testy wołają go jak funkcję. Modele powstają przy pierwszym
 * odczyciu (`RankingServices`), więc host dotyka tylko tego, który pokazuje. Bez usług (benchmark, nakładka bez gry) nie pokazuje
 * nic. Zamknięcie panelu (✕, tło) to `closePanel`: gra wraca tam, gdzie stała, także gdy serwer rankingu nie odpowiada (panel pokazuje
 * wtedy komunikat modelu i nic poza tym nie blokuje).
 *
 * Przygotowanie modelu przy każdym otwarciu (zakładka rankingu, zakrycie kodu) robią same usługi (`createRankingServices` słucha sygnału
 * `panel`), więc host niczego nie wywołuje na wejściu i nie da się go zamontować bez tego przygotowania.
 *
 * Niewysłany bieg (`unsent`) ma w panelu rankingu baner z przyciskiem „Wyślij”: panel zamyka się, a okno końca sezonu otwiera się
 * w jego miejsce (`openFinish`).
 */
export function PanelHost({ game, services }: { game: Pick<GameActions, 'openFinish'>; services: RankingServices | null }) {
  const open = panel.value;
  if (!open || !services) return null;
  if (open.id === 'recovery') return <RecoveryPanel model={services.recoveryModel} onClose={closePanel} />;
  return (
    <RankingPanel
      model={services.rankingModel} onClose={closePanel} unsent={unsent.value}
      onSendUnsent={() => { closePanel(); game.openFinish(); }}
    />
  );
}
