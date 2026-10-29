import type { GameShell } from '@/game/actions';
import { saveMeta } from '@/game/meta';
import { adoptRecoveryCode } from '@/game/playerKey';
import { panel } from '../state';
import { createRankingClient, type RankingClient } from './client';
import { createRankingModel, type RankingModel } from './rankingModel';
import { createRecoveryModel, type RecoveryModel } from './recoveryModel';
import { exportTransfer, readSaveSync, stageImport, writeSaveSync } from './saveTransfer';

/**
 * Modele paneli rankingu i kodu odzyskiwania, podpięte do gry (spec §14.7). Paneli nie obchodzi, skąd klucz gracza, seed sklepu
 * i zapis; tu je dostają z powłoki gry (`GameShell`), z przeglądarki (zapis przeniesienia, znacznik kopii) i z jednego klienta API.
 * Model powstaje przy pierwszym odczycie i zostaje (leniwie, raz): gracz, który nigdy nie otworzy panelu, nie płaci za nic, a ten, który
 * otwiera go ponownie, widzi wybraną zakładkę. Samo utworzenie usług niczego nie wysyła do serwera.
 *
 * Usługi same słuchają sygnału `panel` (`ui/state.ts`) i przy każdym otwarciu panelu przygotowują jego model: ranking ładuje zakładkę
 * z sygnału (domyślnie „Globalny”), a kod odzyskiwania wchodzi czysty (kod zakryty, pole puste, bez pytania z poprzedniego otwarcia),
 * żeby odsłonięty kod nie czekał na następnego, kto otworzy panel. Ta praca nie zależy od tego, kto montuje panele: kto ma usługi, ma ją
 * wykonaną, a „zakryty, dopóki gracz nie odsłoni” nie wisi na jednym wywołaniu w `main.ts`. Nasłuch jest nieśledzący (`subscribe`), więc
 * zmiana zakładki w otwartym panelu nie ładuje zakładki z sygnału od nowa. Gra nie odpina go (żyje tyle co strona); `dispose` jest dla
 * testów i dla każdego, kto usługi zastępuje innymi.
 */
export interface RankingServices {
  readonly rankingModel: RankingModel;
  readonly recoveryModel: RecoveryModel;
  /** Odpina nasłuch sygnału `panel`; kolejne otwarcia panelu niczego już nie przygotowują. Wołanie drugi raz nic nie psuje. */
  dispose(): void;
}

/** Tyle powłoki gry potrzeba usługom (test podaje prawdziwą powłokę na atrapach albo samą atrapę z tymi polami). */
export type ServicesShell = Pick<GameShell, 'meta' | 'session' | 'persist'> & { game: Pick<GameShell['game'], 'rememberNick'> };

export interface RankingServicesDeps {
  shell: ServicesShell;
  /** Klient API; domyślnie nowy. Gra podaje ten sam, którego używa ekran startowy i okno końca sezonu. */
  client?: RankingClient;
  /** Przeładowanie strony po odłożeniu pobranego zapisu (`location.reload`); do podmiany w testach. */
  reload?: () => void;
}

/** Wynik sprawdzenia i odłożenia paczki (`stageImport`) jako komunikat dla gracza albo null. */
const stageSave = (text: string): string | null => {
  const result = stageImport(text);
  return 'error' in result ? result.error : null;
};

/** Panel kodu odzyskiwania wchodzi czysty: kod zakryty, pole puste i bez pytania wiszącego od poprzedniego otwarcia. */
function resetRecovery(model: RecoveryModel): void {
  if (model.revealed.value) model.toggleReveal();
  model.setInput('');
  model.cancelPending();
}

/** Pamięta wynik pierwszego wywołania (model tworzy się raz, przy pierwszym odczycie). */
function once<T>(make: () => T): () => T {
  let made: T | undefined;
  return () => (made ??= make());
}

export function createRankingServices({ shell, client = createRankingClient(), reload = () => location.reload() }: RankingServicesDeps): RankingServices {
  const ranking = once(() => createRankingModel({
    client,
    player: () => shell.meta.player,
    seed: () => shell.session?.seed ?? null,
  }));
  const recovery = once(() => createRecoveryModel({
    client,
    key: () => shell.meta.player?.key ?? null,
    /**
     * Nowy klucz zastępuje metę powłoki w pamięci, a nie tylko zapis w przeglądarce: powłoka zapisuje własną metę przy każdym zamknięciu
     * karty (`persist`), więc zmiana samego zapisu cofnęłaby się przy najbliższym `pagehide`, a odłożony zapis z kodu (`stageSave`) składa
     * się potem z kluczem odczytanym z przeglądarki.
     */
    adoptKey: (code) => {
      const adopted = adoptRecoveryCode(shell.meta, code);
      if ('error' in adopted) return adopted.error;
      shell.meta = adopted.meta;
      saveMeta(shell.meta);
      return null;
    },
    useNick: (nick) => shell.game.rememberNick(nick),
    /** Zapis gry w pamięci idzie do przeglądarki przed złożeniem paczki: inaczej paczka byłaby o dzień wstecz (ostatni zapis to koniec dnia). */
    exportSave: () => {
      shell.persist();
      return exportTransfer();
    },
    stageSave,
    reload,
    sync: { get: readSaveSync, set: writeSaveSync },
  }));
  // Każde otwarcie panelu to nowa wartość sygnału. Model powstaje dopiero tu (albo przy pierwszym odczycie z zewnątrz).
  const stop = panel.subscribe((open) => {
    if (!open) return;
    if (open.id === 'ranking') void ranking().select(open.tab ?? 'global');
    else resetRecovery(recovery());
  });
  return {
    get rankingModel() { return ranking(); },
    get recoveryModel() { return recovery(); },
    dispose: stop,
  };
}
