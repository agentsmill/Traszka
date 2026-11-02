import { closeFameOffer, closePanel, fameOffer, firm, openPanel, panel, seed, unsent, type FameOffer, type GameActions } from '../state';
import { FameWindow } from './FameWindow';
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
 *
 * Galeria sław (4b §5.7): okno gratulacji `FameWindow` pokazuje się, gdy sygnał `fameOffer` ma wartość (zdarzenie `million` albo „Wyślij mój
 * wpis” w zakładce Galerii) i ma pierwszeństwo przed panelami; zakładka „Galeria sław” jest częścią panelu rankingu.
 */
export function PanelHost({ game, services }: { game: Pick<GameActions, 'openFinish'>; services: RankingServices | null }) {
  const open = panel.value;
  const offer = fameOffer.value;
  if (!services || (!open && !offer)) return null;
  // Gratulacje za milion mają pierwszeństwo: gdy `fameOffer` jest ustawiony, host pokazuje samo okno (panel nie jest wtedy montowany, a jego stan
  // leży w modelach, więc wraca po zamknięciu okna). Zdarzenie `million` i tak przychodzi przy zamkniętych panelach, bo otwarty panel zatrzymuje grę.
  if (offer) {
    return (
      <FameWindow
        model={services.fameModel} offer={offer} onClose={closeFameOffer}
        onOpenGallery={() => { closeFameOffer(); openPanel('ranking', 'fame'); }}
      />
    );
  }
  if (!open) return null;
  if (open.id === 'recovery') return <RecoveryPanel model={services.recoveryModel} onClose={closePanel} />;
  const mine = fameEntryOfFirm();
  return (
    <RankingPanel
      model={services.rankingModel} onClose={closePanel} unsent={unsent.value}
      onSendUnsent={() => { closePanel(); game.openFinish(); }}
      fame={services.fameModel} fameEntry={mine}
      onSendFame={() => { closePanel(); if (mine) fameOffer.value = mine; }}
    />
  );
}

/** Milion firmy z zapisu (`fame`: dzień i gotówka z chwili przekroczenia) z seedem otwartej gry albo null, gdy firma jeszcze go nie ma. */
function fameEntryOfFirm(): FameOffer | null {
  const fame = firm.value?.f.fame;
  return fame ? { seed: seed.value, day: fame.day, cash: fame.cash } : null;
}
