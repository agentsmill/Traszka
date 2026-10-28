import { applyCommand, type Command } from '@/sim/economy/commands';
import type { CommandResult, EconEvent } from '@/sim/economy/economy';
import type { Sfx } from '@/ui/sfx';
import type { ToastKind } from '@/ui/state';
import { RUN_LOG_MAX, type GameSession } from './session';

/**
 * Warstwa gry nad `applyCommand`: każde polecenie gracza przechodzi tędy. Dyspozytor stosuje je do stanu (czysta symulacja),
 * dopisuje do dziennika sesji (`session.run`, z którego `replayRun` odtwarza bieg co do bajtu) i uruchamia kroki po poleceniu:
 * dźwięk, wibrację, komunikaty, zdarzenia, zapis i przebudowę sceny po remoncie. Same efekty wstrzykuje wołający (`CommandEffects`),
 * więc moduł nie dotyka ani przeglądarki, ani sceny i da się go sprawdzić w node; z `@/ui/*` bierze tylko typy.
 */

/** Efekty uboczne po poleceniu. Wołający (main.ts) podaje je z dzisiejszych funkcji gry i interfejsu. */
export interface CommandEffects {
  play(sfx: Sfx): void;
  buzz(pattern: number | number[]): void;
  toast(text: string, kind: ToastKind): void;
  /** `fx` i `fy` to ułamki szerokości i wysokości okna (wołający przelicza je na piksele). */
  confetti(fx: number, fy: number, count: number): void;
  handleEvents(events: EconEvent[]): void;
  persist(): void;
  clearSelection(): void;
  /** Buduje scenę od nowa z układu `session.layout` (po remoncie). Może rzucić: `dispatchCommand` to łapie. */
  rebuildScene(): void;
  /** Komunikat u góry ekranu, który zostaje dłużej niż toast (błąd, który wymaga reakcji gracza). */
  notice(text: string): void;
  refresh(): void;
}

/** Co robi gra po poleceniu danego typu. Dźwięk, wibracja, konfetti i zapis tylko wtedy, gdy polecenie się udało. */
interface AfterStep {
  /** Czy udane polecenie pokazuje swój tekst jako toast (gdy go ma). Błąd zawsze idzie do toastu. */
  okToast: boolean;
  sfx?: Sfx;
  buzz?: number | number[];
  confetti?: { fx: number; fy: number; count: number };
  persist?: boolean;
  /** Kiedy zdjąć zaznaczenie w scenie: przed poleceniem albo po nim (po nim także wtedy, gdy polecenie się nie udało). */
  clearSelection?: 'before' | 'after';
}

/** Kroki po poleceniu, przeniesione z dawnego `game` w main.ts (`act` + `afterAction`). Kompilator pilnuje wpisu dla każdego typu. */
export const AFTER: Record<Command['type'], AfterStep> = {
  tapPallet: { okToast: false, sfx: 'tap', buzz: 8 },
  tapTill: { okToast: false, sfx: 'cash', buzz: 8 },
  claimQuest: { okToast: true, sfx: 'coins', buzz: [15, 30, 15], confetti: { fx: 0.5, fy: 0.6, count: 28 }, persist: true },
  claimGift: { okToast: true, sfx: 'gift', buzz: [10, 20, 10] },
  movePallet: { okToast: true },
  returnPallet: { okToast: true, clearSelection: 'after' },
  setOrder: { okToast: false },
  setPriority: { okToast: false },
  hire: { okToast: false },
  fire: { okToast: false },
  buyUpgrade: { okToast: true, sfx: 'coins', persist: true },
  buyEquipment: { okToast: true, sfx: 'coins', persist: true },
  startRemont: { okToast: true, persist: true, clearSelection: 'before' },
  campaign: { okToast: true },
  rushRemont: { okToast: true },
};

/** Typ spoza tabeli (polecenie obejściem typów): bez kroków po poleceniu, a odmowę z komunikatem da `applyCommand`. */
const NO_STEPS: AfterStep = { okToast: false };

const REBUILD_FAILED = 'Nie udało się przebudować sklepu po remoncie. Postęp jest zapisany — odśwież stronę.';

/**
 * Wyłącza dziennik sesji: stan zmienił się poza poleceniami (nagroda powitalna za nieobecność, `skip`), więc odtworzenie
 * z dziennika już by go nie dało. Gra toczy się dalej bez dziennika.
 */
export function markOffLog(session: GameSession): void {
  session.run = null;
}

/**
 * Polecenie gracza: kroki po kolei, jak w dawnym `act` + `afterAction` z main.ts.
 * 1. zaznaczenie zdjęte przed poleceniem (`clearSelection: 'before'`);
 * 2. wpis do dziennika, także polecenia, które się nie uda (serwer odtwarzający robi to samo);
 * 3. `applyCommand`;
 * 4. wynik: błąd to toast i dźwięk błędu, sukces to toast (gdy `okToast` i jest tekst), dźwięk, wibracja i konfetti;
 * 5. zdarzenia (poziom, złota paleta…);
 * 6. po remoncie: nowy układ w sesji, zapis i przebudowa sceny, której błąd nie przerywa polecenia;
 * 7. zapis po udanym poleceniu, o ile nie zapisano go już w kroku 6;
 * 8. zaznaczenie zdjęte po poleceniu (`clearSelection: 'after'`);
 * 9. odświeżenie sceny i interfejsu.
 *
 * Wyjątek z `rebuildScene` nie wychodzi stąd (scena zostaje pusta, ale gracz dostaje komunikat, a postęp jest zapisany).
 * Każdy inny wyjątek (np. z `applyCommand`) leci dalej: to błąd w kodzie, którego nie wolno połknąć.
 */
export function dispatchCommand(session: GameSession, cmd: Command, fx: CommandEffects): CommandResult {
  // Kopia płytka, raz: dziennik, `applyCommand` i tabela czytają to samo polecenie, a późniejsza zmiana obiektu interfejsu
  // (albo getter) niczego w dzienniku nie zmieni.
  const command = { ...cmd };
  const after = Object.hasOwn(AFTER, command.type) ? AFTER[command.type] : NO_STEPS;

  if (after.clearSelection === 'before') fx.clearSelection();

  const run = session.run;
  if (run) {
    if (run.record.log.length >= RUN_LOG_MAX) markOffLog(session);   // ten wpis przekroczyłby limit: dziennika już nie prowadzimy
    else run.record.log.push({ minute: session.econ.minute, seq: run.seq++, cmd: command });
  }

  const outcome = applyCommand(session.econ, session.info, command);
  const { result } = outcome;
  if (!result.ok) {
    fx.toast(result.text, 'error');
    fx.play('error');
  } else {
    if (after.okToast && result.text) fx.toast(result.text, 'ok');
    if (after.sfx) fx.play(after.sfx);
    if (after.buzz !== undefined) fx.buzz(after.buzz);
    if (after.confetti) fx.confetti(after.confetti.fx, after.confetti.fy, after.confetti.count);
  }

  fx.handleEvents(outcome.events);

  let persisted = false;
  if (outcome.layoutChanged && outcome.layout && outcome.info) {
    session.layout = outcome.layout;
    session.info = outcome.info;
    session.layoutLevel = session.econ.remontLevel;
    fx.persist();   // zapis przed przebudową: gdy scena się nie zbuduje, postęp i tak jest bezpieczny
    persisted = true;
    try {
      fx.rebuildScene();
    } catch (error) {
      console.error('Przebudowa sklepu po remoncie nie powiodła się.', error);
      fx.notice(REBUILD_FAILED);
    }
  }

  if (after.persist && result.ok && !persisted) fx.persist();
  if (after.clearSelection === 'after') fx.clearSelection();
  fx.refresh();
  return result;
}
