import type { ReadonlySignal } from '@preact/signals';
import { closePanel, panel, unsent, type GameActions, type PanelState } from '../state';
import { RankingPanel } from './RankingPanel';
import { RecoveryPanel } from './RecoveryPanel';
import type { RecoveryModel } from './recoveryModel';
import type { RankingServices } from './services';

/**
 * Panele rankingu i kodu odzyskiwania w aplikacji: pokazuje ten, który wskazuje sygnał `panel` (otwierają go przycisk 🏆 w HUD-zie
 * i sekcja „Ranking” w ⚙), z modelem z usług. Komponent bez hooków, więc testy wołają go jak funkcję. Modele powstają przy pierwszym
 * odczyciu (`RankingServices`), więc host dotyka tylko tego, który pokazuje. Bez usług (benchmark, nakładka bez gry) nie pokazuje
 * nic. Zamknięcie panelu (✕, tło) to `closePanel`: gra wraca tam, gdzie stała, także gdy serwer rankingu nie odpowiada (panel pokazuje
 * wtedy komunikat modelu i nic poza tym nie blokuje).
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

/** Panel kodu odzyskiwania wchodzi czysty: kod zakryty, pole puste i bez pytania wiszącego od poprzedniego otwarcia. */
function resetRecovery(model: RecoveryModel): void {
  if (model.revealed.value) model.toggleReveal();
  model.setInput('');
  model.cancelPending();
}

/**
 * Przygotowuje model do panelu przy każdym jego otwarciu (sygnał dostaje nową wartość): ranking ładuje wskazaną zakładkę
 * (domyślnie „Globalny”), a kod odzyskiwania zakrywa kod i zdejmuje stare pytanie, żeby odsłonięty kod nie czekał na następnego,
 * kto otworzy panel. Zamknięcie niczego nie robi. Panel, który jest już otwarty w chwili podpięcia, też się przygotowuje. Zwraca funkcję
 * odpinającą. Subskrypcja woła funkcję poza śledzeniem sygnałów, więc zmiana zakładki w panelu nie ładuje zakładki z sygnału od nowa.
 */
export function bindPanelOpen(services: RankingServices, opened: ReadonlySignal<PanelState | null>): () => void {
  return opened.subscribe((open) => {
    if (!open) return;
    if (open.id === 'ranking') void services.rankingModel.select(open.tab ?? 'global');
    else resetRecovery(services.recoveryModel);
  });
}
