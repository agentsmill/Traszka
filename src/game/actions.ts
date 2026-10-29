import type { CharacterFactory } from '@/render/characters/characterFactory';
import { applyCommand, type Command } from '@/sim/economy/commands';
import {
  awaitingDecision, grantDaily, grantOffline, processLevels, stepMinute, tapCombo, type CommandResult, type EconEvent, type EconEventKind,
} from '@/sim/economy/economy';
import { rankFor } from '@/sim/economy/progress';
import { noticeLevel } from '@/sim/economy/tycoon/notices';
import type { Sfx } from '@/ui/sfx';
import * as ui from '@/ui/state';
import { bootMeta } from './bootMeta';
import type { CashierLook } from './cashier';
import { addToNetwork, claimDaily, partnerOf, saveMeta, startupWindow, type Meta } from './meta';
import { openStore } from './openStore';
import {
  RANKED_BANKRUPT_TEXT, RANKED_DAYS, clearFinished, createRankedSession, discardRanked, finishRun, getPlayMode, holdFinished, loadRanked, pendingFinished,
  rankedDayOf, rankedRunStale, saveFinished, saveRanked, seasonOver, setPlayMode, storedRankedBlock, type FinishedRun, type SentRun,
} from './rankedRun';
import type { ScenePick } from './scene';
import { chooseStore, freeSeed } from './seeds';
import {
  NEWER_SAVE_NOTICE, RANKED_TAP_LOG_MAX, RUN_LOG_MAX, UNBUILDABLE_SAVE_NOTICE, createSession, discardSave, hasStoredSave, lastSavedSeed, retireSession, reviveSession,
  saveSession, type GameSession,
} from './session';
import { initialStartForm, noticeAfterOpen, openChosen, openRequestFor, type StartChoice, type StartForm, type StoreSwitch } from './start';

/**
 * Warstwa gry nad `applyCommand`: każde polecenie gracza przechodzi tędy. Dyspozytor stosuje je do stanu (czysta symulacja),
 * dopisuje do dziennika sesji (`session.run`, z którego `replayRun` odtwarza bieg co do bajtu) i uruchamia kroki po poleceniu:
 * dźwięk, wibrację, komunikaty, zdarzenia, zapis i przebudowę sceny po remoncie. Same efekty wstrzykuje wołający (`CommandEffects`),
 * więc moduł nie dotyka ani przeglądarki, ani sceny i da się go sprawdzić w node; z `@/ui/*` bierze sygnały stanu (`state.ts`)
 * i typy, a dźwięk, konfetti, komunikaty i scenę dostaje od wołającego.
 *
 * Nad dyspozytorem stoi `GameShell` (niżej): sesja, meta i przepływy sklepu (zapis, zmiana sklepu, powitanie, sieć sklepów…).
 */

/** Efekty uboczne po poleceniu. Wołający (powłoka gry, `createShell` niżej) podaje je z funkcji gry i interfejsu. */
export interface CommandEffects {
  play(sfx: Sfx): void;
  buzz(pattern: number | number[]): void;
  toast(text: string, kind: ui.ToastKind): void;
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
  movePallet: { okToast: true },
  returnPallet: { okToast: true, clearSelection: 'after' },
  setOrder: { okToast: false },
  setStaffProfile: { okToast: false },
  pinStaff: { okToast: false },
  hire: { okToast: false },
  fire: { okToast: false },
  buyUpgrade: { okToast: true, sfx: 'coins', persist: true },
  buyEquipment: { okToast: true, sfx: 'coins', persist: true },
  startRemont: { okToast: true, persist: true, clearSelection: 'before' },
  campaign: { okToast: true },
  rushRemont: { okToast: true },
  // wynik odpowiedzi przychodzi zdarzeniem `card-result` (toast z handleEvents), więc sam wynik polecenia nie ma tekstu
  answerCard: { okToast: false, sfx: 'pop', persist: true },
};

/** Typ spoza tabeli (polecenie obejściem typów): bez kroków po poleceniu, a odmowę z komunikatem da `applyCommand`. */
const NO_STEPS: AfterStep = { okToast: false };

const REBUILD_FAILED = 'Nie udało się przebudować sklepu po remoncie. Postęp jest zapisany — odśwież stronę.';
/** Sklep tymczasowy się nie zapisuje (`saveSession`), więc odświeżenie nie przywróci tego sklepu, tylko gracza do jego własnego. */
const REBUILD_FAILED_EPHEMERAL = 'Nie udało się przebudować sklepu po remoncie. Ten sklep jest tymczasowy — odśwież stronę, żeby wrócić do swojego.';

/**
 * Wyłącza dziennik sesji: stan zmienił się poza poleceniami (nagroda powitalna za nieobecność, `skip`), więc odtworzenie
 * z dziennika już by go nie dało. Gra toczy się dalej bez dziennika.
 */
export function markOffLog(session: GameSession): void {
  session.run = null;
}

const SEASON_OVER_TEXT = 'Sezon dobiegł końca.';
const TERMINATED_TEXT = 'Umowa wypowiedziana: bieg się zakończył.';
const LOG_FULL_TEXT = 'Dziennik biegu rankingowego jest pełny.';
const TAP_LOG_FULL_TEXT = 'Dziennik biegu jest prawie pełny: ręczne stukanie się skończyło. Zakupy i decyzje działają dalej.';

/** Stuknięcia: jedyne polecenia, które gracz może wysyłać bez końca (odrzucone też trafiają do dziennika), więc kończą się przed rezerwą dziennika. */
const TAP_COMMANDS: ReadonlySet<Command['type']> = new Set<Command['type']>(['tapPallet', 'tapTill']);

/**
 * Czy sesja rankingowa nie przyjmuje polecenia `type` i dlaczego: umowa została wypowiedziana (`gameOver`: bieg się zakończył, własny
 * komunikat), sezon się skończył (`seasonOver`) albo dziennik jest pełny. Stuknięcia kończą się już na `RANKED_TAP_LOG_MAX` wpisach (rezerwa
 * `RANKED_LOG_RESERVE` zostaje na zakupy i karty), reszta poleceń na `RUN_LOG_MAX`. Bieg rankingowy bez dziennika byłby nie do wysłania,
 * więc polecenie przepada, zamiast po cichu go unieważnić. Tekst to to, co zobaczy gracz.
 */
function rankedRefusal(session: GameSession, type: Command['type']): string | null {
  if (session.econ.gameOver) return TERMINATED_TEXT;
  if (seasonOver(session.econ)) return SEASON_OVER_TEXT;
  if (session.run === null) return null;
  const entries = session.run.record.log.length;
  if (entries >= RUN_LOG_MAX) return LOG_FULL_TEXT;
  if (entries >= RANKED_TAP_LOG_MAX && TAP_COMMANDS.has(type)) return TAP_LOG_FULL_TEXT;
  return null;
}

/** Odmowa polecenia przed `applyCommand`: toast błędu i dźwięk jak przy innych odmowach, bez dziennika, zapisu i zdarzeń. */
function refuse(text: string, fx: CommandEffects): CommandResult {
  fx.toast(text, 'error');
  fx.play('error');
  return { ok: false, text };
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
 * Wyjątek z `rebuildScene` nie wychodzi stąd: scena zostaje pusta, a gracz dostaje komunikat (w sklepie zwykłym z obietnicą
 * zapisu, w tymczasowym bez niej: ten się nie zapisuje). Po takiej porażce czas gry stoi, bo pętla klatek potrzebuje załadowanej
 * sceny (`scene.loaded`), a panele dalej przyjmują polecenia. To zamierzony, bezpieczny stan: nic nie przepada niewidocznie, a
 * zwykły sklep jest już zapisany na nowym układzie, więc odświeżenie strony go wczytuje.
 * Każdy inny wyjątek (np. z `applyCommand`) leci dalej: to błąd w kodzie, którego nie wolno połknąć.
 */
export function dispatchCommand(session: GameSession, cmd: Command, fx: CommandEffects): CommandResult {
  // Kopia płytka, raz: dziennik, `applyCommand` i tabela czytają to samo polecenie, a późniejsza zmiana obiektu interfejsu
  // (albo getter) niczego w dzienniku nie zmieni. Płytka wystarcza, bo pola poleceń są płaskie (komentarz nad `Command`).
  const command = { ...cmd };
  const after = Object.hasOwn(AFTER, command.type) ? AFTER[command.type] : NO_STEPS;

  // Bieg rankingowy: po końcu sezonu (albo wypowiedzeniu umowy) i przy pełnym dzienniku polecenie jest odmawiane przed wszystkim innym,
  // żeby stan i dziennik zostały takie, jakie serwer odtworzy. Zwykła sesja nie ma sezonu, a pełny dziennik tylko wyłącza (`markOffLog`).
  if (session.mode === 'ranked') {
    const refusal = rankedRefusal(session, command.type);
    if (refusal) return refuse(refusal, fx);
  }

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
      fx.notice(session.ephemeral ? REBUILD_FAILED_EPHEMERAL : REBUILD_FAILED);
    }
  }

  if (after.persist && result.ok && !persisted) fx.persist();
  if (after.clearSelection === 'after') fx.clearSelection();
  fx.refresh();
  return result;
}

// --- Powłoka gry: sesja, meta i przepływy sklepu ----------------------------------------------------------------------

/** Czego powłoka potrzebuje od sceny. `SceneHost` (scene.ts) to spełnia; test podaje atrapę. */
export interface ShellScene {
  /** Seed sklepu stojącego w scenie albo null (scena pusta). */
  readonly seed: string | null;
  /** Buduje świat sklepu `seed` na sesji `session`; rzuca, gdy się nie da, i nie zostawia nic w scenie. */
  load(seed: string, session: GameSession | null): void;
  syncVisuals(session: GameSession | null, force?: boolean): void;
  /** Wygląd kasjera dla sklepów budowanych od teraz. */
  setCashierLook(look: CashierLook): void;
}

/** Efekty powłoki poza sceną: dźwięk, wibracja, konfetti, komunikaty i liczby nad palcem. Podaje je main.ts (testy: atrapy). */
export interface ShellEffects {
  play(sfx: Sfx): void;
  buzz(pattern: number | number[]): void;
  /** `fx` i `fy` to ułamki szerokości i wysokości okna; bez argumentów konfetti leci ze środka ekranu. */
  confetti(fx?: number, fy?: number, count?: number): void;
  /** Komunikat u góry ekranu, który zostaje dłużej niż toast. */
  notice(text: string): void;
  setSound(on: boolean): void;
  setVibration(on: boolean): void;
  /** Liczba wylatująca z punktu ekranu (px). */
  floater(x: number, y: number, text: string, kind: 'money' | 'work'): void;
}

export interface ShellDeps {
  /** Meta wczytana przy starcie (rozruch dopisał już do niej gracza z ekranu startowego). */
  meta: Meta;
  /** Benchmark nie ma sesji ani zapisu. */
  benchMode: boolean;
  scene: ShellScene;
  effects: ShellEffects;
  randomSeed(): string;
  /** Wpisuje seed do adresu strony (`writeSeedToUrl` w scene.ts). Bieg rankingowy go nie woła. */
  writeSeedToUrl(seed: string): void;
  /** Zdejmuje `?seed=` z adresu (`clearSeedFromUrl` w scene.ts): wołane przy wejściu w bieg rankingowy, żeby odświeżenie wznowiło bieg, a nie stary zwykły sklep. */
  clearSeedFromUrl(): void;
  /** Fabryka postaci dla ekranu „Nowy sklep”: ta sama, z której korzysta gra. */
  characterFactory(): Promise<CharacterFactory>;
  /** Podpowiedzi pierwszego dnia w krótkich dymkach (`FIRST_DAY_HINTS` w ui/game/overlays.tsx: moduł interfejsu, więc podaje je main.ts). */
  firstDayHints: readonly string[];
  /** Seed tygodnia z serwera rankingu dla chipa na ekranie „Nowy sklep” (main.ts: `weekSeedOf(createRankingClient())`); bez niej ekran nie ma chipa. */
  weekSeed?(): Promise<string | null>;
}

/** Prośba o pierwszy sklep przy wejściu na stronę (`GameShell.open`). */
export interface OpenAtStart {
  /** Sklep, który otwieramy: seed z adresu, ostatnio grany albo losowy; przy wyborze z ekranu startowego seed z tego wyboru. */
  seed: string;
  /** `?new=1`: nowa gra zamiast zapisu. Nie dotyczy sklepu wybranego na ekranie startowym: ten nigdy nie jest świeży. */
  fresh: boolean;
  /** Wybór gracza z ekranu startowego (pierwsze wejście) albo null, gdy gracz jest już w meta. */
  choice: StartChoice | null;
}

/**
 * Sesja, meta i to, co gracz robi poza poleceniami symulacji: zapis, zmiana sklepu, powitanie, sieć sklepów, ustawienia, nowy
 * sklep. Pola `session` i `meta` ustawia też rozruch (main.ts) i przepływy (`meta` zmienia się przy zamknięciu sklepu w sieci).
 */
export interface GameShell {
  /** Sesja otwartego sklepu; null przed otwarciem i w benchmarku. */
  session: GameSession | null;
  meta: Meta;
  /**
   * Otwiera pierwszy sklep przy wejściu na stronę (`openStore`: zapis, który przeszedł walidację, nie przepada z powodu świata,
   * który się nie zbudował) i pokazuje, co gracza czeka: komunikaty, adres, wskazówki pierwszego dnia albo okno powitalne.
   * Zwraca false, gdy żaden sklep się nie zbudował (renderer): zapis zostaje nietknięty, a gracz dostaje komunikat.
   */
  open(request: OpenAtStart): boolean;
  /** Zapisuje sklep i metę (sklep tymczasowy się nie zapisuje). */
  persist(): void;
  /** Wystawia stan gry interfejsowi (`ui.econ`, `ui.ephemeral`). */
  publish(): void;
  /**
   * Przechodzi do sklepu `next`: zapisuje obecny, buduje świat nowego i dopiero wtedy zmienia adres. Gdy coś po drodze
   * rzuci, zostaje poprzedni sklep (świat budowany od nowa z jego sesji), a gracz dostaje komunikat. Zwraca, czy się udało.
   * `ephemeral`: świeża gra ma być tymczasowa (nic jej nie zapisze), np. „zacznij od nowa” w sklepie tymczasowym.
   */
  setSeed(next: string, fresh?: boolean, ephemeral?: boolean): boolean;
  /**
   * Zdarzenia ekonomii: zapis na koniec dnia, raport miesiąca, feta poziomu, dźwięki i toasty. Pętla klatek woła to co klatkę, także z pustą
   * listą; na końcu sprawdza koniec sezonu biegu rankingowego i zamyka bieg raz (`finishRun`, szuflada, `ui.unsent`, faza `over`, okno
   * końca sezonu `ui.finish`).
   */
  handleEvents(events: EconEvent[]): void;
  /** Stuknięcie w scenę (`hit` z `SceneHost.pick`, `x`, `y` to punkt ekranu w px): rozładunek, obsługa klienta, karta zakupu albo zdjęcie zaznaczenia. */
  tap(hit: ScenePick | null, x: number, y: number): void;
  /** Sklep z tekstu wpisanego w ⚙: te same zasady co na ekranie startowym. */
  generate(text: string): void;
  /** Nowy losowy seed (klawisz R, przycisk „Losuj”). */
  randomize(): void;
  /** Przewija grę o `minutes` minut (testy ręczne i zrzuty); wyłącza dziennik biegu. W biegu rankingowym nic nie robi. */
  skip(minutes: number): void;
  /**
   * Świeży bieg rankingowy (spec §14.7) na seedzie, który powłoka sama normalizuje jak seed zwykłego sklepu (`chooseStore`, bez wczytywania
   * zwykłego zapisu pod tym seedem). Jeden aktywny bieg (`traszka:ranked`) i jedna szuflada niewysłanego biegu: gdy któreś jest zajęte,
   * a `opts.replace` nie jest ustawione, nic nie zmienia, ustawia `ui.confirmRankedStart` (`unsent` ma pierwszeństwo przed `active`)
   * i zwraca false. Z `replace` kasuje szufladę i aktywny zapis, ale dopiero gdy nowy świat stoi. Zapisuje poprzedni sklep, a gdy świat
   * się nie zbuduje, zostawia gracza w poprzednim (z komunikatem). Zwraca, czy bieg ruszył.
   */
  startRanked(seed: string, opts?: { replace?: boolean }): boolean;
  /**
   * Wznawia aktywny bieg rankingowy z zapisu. Uszkodzony zapis (`broken`, kopia w przeglądarce) i zapis z innej wersji gry
   * (`incompatible`, zostaje na miejscu) dają komunikat i false; brak biegu to false bez komunikatu. Bieg z starszej wersji symulacji
   * wznawia się z komunikatem, że nie trafi do rankingu (`rankedRunStale`).
   */
  resumeRanked(): boolean;
  /** Zapisuje bieg rankingowy i wraca do ostatniego zwykłego sklepu (ustawia tryb `casual`). Poza biegiem nic nie robi. */
  leaveRanked(): void;
  /** Kasuje aktywny bieg rankingowy i wraca do zwykłej gry; szuflada niewysłanego biegu zostaje. Gdy nie da się otworzyć zwykłego sklepu, bieg zostaje. */
  abandonRanked(): void;
  /** Gra widziana z interfejsu (`dispatch` i czynności spoza symulacji). */
  game: ui.GameActions;
}

const EVENT_SFX: Partial<Record<EconEvent['kind'], Sfx>> = {
  delivery: 'delivery', fine: 'fine', golden: 'golden', milestone: 'coins', warning: 'error', card: 'pop',
};

/**
 * Wynik karty dźwięczy monetami tylko przy premii Centrali. Zdarzenie niesie sam tekst (zob. `EconEvent`), więc premię
 * rozpoznaje słowo „premi…” w tekście; `actions.test.ts` pilnuje, żeby w talii padało ono tylko w odpowiedzi, która ją wypłaca.
 */
const PREMIUM_WORD = /premi/i;

function sfxOf(e: EconEvent): Sfx | undefined {
  if (e.kind === 'card-result') return PREMIUM_WORD.test(e.text) ? 'coins' : undefined;
  return EVENT_SFX[e.kind];
}

/**
 * Tytuł okna „OK” dla ważnych zdarzeń (poziom `story` w `notices.ts`: to tam żyje lista, co czeka na gracza). Rodzaj bez wpisu,
 * który kiedyś dostanie poziom `story`, też trafi do okna, pod ogólnym tytułem. Karta (`decision`) tu nie wchodzi: zatrzymuje
 * ją symulacja (`cardsBlocking`), a okno karty jest osobne (`CardDesk`).
 */
const STORY_TITLE: Partial<Record<EconEventKind, string>> = { 'trust-tier': 'Zaufanie Centrali', remont: 'Remont zakończony', debt: 'Centrala czeka na opłatę' };
const STORY_FALLBACK_TITLE = 'Ważne zdarzenie';
/** Mają własne okno, więc nie idą do wspólnego: raport miesiąca (`ui.report`) i koniec gry (okno końca współpracy w `ReportModal`, z `gameOver`). */
const OWN_WINDOW: ReadonlySet<EconEventKind> = new Set<EconEventKind>(['month', 'gameover']);

// --- Bieg rankingowy w powłoce -----------------------------------------------------------------------------------------

export const RANKED_BROKEN_NOTICE = 'Zapis biegu rankingowego był uszkodzony. Kopia została w przeglądarce.';
export const RANKED_INCOMPATIBLE_NOTICE = 'Zapisany bieg rankingowy powstał w innej wersji gry i nie da się go wznowić. Możesz go porzucić w ustawieniach.';
export const RANKED_STALE_NOTICE = 'Ten bieg powstał w starszej wersji gry i nie trafi do rankingu. Możesz go dograć dla zabawy albo zacząć nowy.';
export const RANKED_NO_SPACE_NOTICE = 'Przeglądarka nie ma miejsca na zapis biegu rankingowego. Gra toczy się dalej, ale po zamknięciu karty bieg przepadnie.';
export const RANKED_RESUME_FAILED_NOTICE = 'Nie udało się wznowić biegu rankingowego. Zapis jest bezpieczny, spróbuj odświeżyć stronę.';
export const RANKED_NOT_COUNTED_NOTICE = 'Ten bieg nie liczy się do rankingu.';
export const RANKED_RESULT_NOT_SAVED_NOTICE = 'Przeglądarka nie ma miejsca na zapis wyniku. Wyślij go teraz, zanim zamkniesz kartę.';
export const RANKED_FINISH_FAILED_NOTICE = 'Nie udało się podliczyć wyniku biegu. Zapis biegu zostaje w przeglądarce, odśwież stronę.';
export const RANKED_NO_NETWORK_NOTICE = 'W biegu rankingowym nie ma sieci sklepów.';
export const RANKED_NO_RESTART_NOTICE = 'W biegu rankingowym nie zaczyna się od nowa. Porzuć bieg w ustawieniach.';
const rankedStartFailed = (seed: string): string => `Nie udało się zacząć biegu rankingowego „${seed}”.`;

/** Widok biegu dla interfejsu: dzień sezonu (od 1, najwyżej `RANKED_DAYS`) i faza (`over`: sezon się skończył albo umowa została wypowiedziana); null dla zwykłego sklepu. */
function rankedViewOf(session: GameSession): ui.RankedView | null {
  if (session.mode !== 'ranked') return null;
  const over = seasonOver(session.econ) || session.econ.gameOver;
  return { seed: session.seed, day: rankedDayOf(session.econ), days: RANKED_DAYS, phase: over ? 'over' : 'playing' };
}

/** Ustawia `ui.ranked` tylko wtedy, gdy widok się zmienił: `publish` idzie kilka razy na sekundę, a ten sam widok nie powinien budzić interfejsu. */
function setRankedView(next: ui.RankedView | null): void {
  const now = ui.ranked.value;
  if (now === next) return;
  if (now && next && now.seed === next.seed && now.day === next.day && now.days === next.days && now.phase === next.phase) return;
  ui.ranked.value = next;
}

/**
 * Odświeża `ui.unsent` ze stanu niewysłanego biegu: szuflada w przeglądarce albo, gdy ta go nie przyjęła, bieg trzymany w pamięci karty
 * (`pendingFinished`). Wołać po każdej zmianie; szuflada, której nie da się odczytać, jest pusta.
 */
export function syncUnsent(): void {
  const found = pendingFinished();
  const next = found ? { seed: found.seed, score: found.score } : null;
  const now = ui.unsent.value;
  if (now === next || (now && next && now.seed === next.seed && now.score === next.score)) return;
  ui.unsent.value = next;
}

/** Toast, gdy serwer przyjął bieg po zamknięciu okna końca sezonu (okno otwarte pokazuje przyjęcie samo). */
export const RANKED_ACCEPTED_LATE_TEXT = 'Bieg przyjęty do rankingu.';

/**
 * Niewysłany bieg przestaje istnieć: serwer go przyjął (`sent`: który bieg poszedł) albo gracz kliknął „Odrzuć bieg” (bez argumentu).
 * Opróżnia szufladę i pamięć karty (`clearFinished`), kasuje aktywny zapis biegu (`discardRanked`: gdy szuflada nie przyjęła biegu przy
 * końcu sezonu, zapis czeka na „Kontynuuj bieg rankingowy” albo przeładowanie przed „Zamknij”, które zamknęłyby ten sam sezon od nowa
 * i oddały bieg do szuflady) i odświeża `ui.unsent`. Aktywnego biegu, który jeszcze się toczy, to nie dotyczy: niewysłany bieg i trwający
 * bieg nie istnieją naraz (`startRanked` pyta o to, zanim cokolwiek skasuje).
 *
 * Odpowiedź serwera bywa spóźniona: gracz zamknął okno w trakcie wysyłania i zaczął nowy bieg („Porzuć i zacznij” już opróżniło szufladę
 * i zapisało aktywny bieg nowego sezonu). Gdy podano `sent`, a niewysłany bieg to już nie ten (inny `seed` albo `finishedAt`, albo nie
 * ma żadnego), zapisu nie ruszamy: tylko odświeżamy `ui.unsent`. Gdy okno końca sezonu jest zamknięte, przyjęcie dostaje toast, bo nikt
 * inny nie powie graczowi, że bieg jest w rankingu.
 */
export function dropUnsentRun(sent?: SentRun): void {
  if (sent !== undefined && !ui.finish.value) ui.pushToast(RANKED_ACCEPTED_LATE_TEXT, 'info');
  const pending = pendingFinished();
  if (sent === undefined || (pending !== null && pending.seed === sent.seed && pending.finishedAt === sent.finishedAt)) {
    clearFinished();
    discardRanked();
  }
  syncUnsent();
}

/** Zwykły sklep stoi: zapamiętany tryb to `casual`. Zapisuje tylko powrót z `ranked`, więc gracz, który nie grał o ranking, nie dostaje klucza `traszka:mode`. */
function rememberCasual(): void {
  if (getPlayMode() !== 'casual') setPlayMode('casual');
}

const money = (n: number): string => `+${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

/**
 * Składa powłokę. Przy tworzeniu: dźwięk i wibracja z mety, komunikat o nowszej wersji gry (gdy meta jest tylko do odczytu) i
 * widok mety dla interfejsu. Sesji jeszcze nie ma: otwiera ją rozruch (`openStore`), który przypisuje ją do `shell.session`.
 */
export function createShell(deps: ShellDeps): GameShell {
  const { scene, effects: fx, benchMode } = deps;
  let econVersion = 0;

  /** Sesje rankingowe, którym przeglądarka odmówiła zapisu i które już o tym wiedzą: ostrzeżenie pada raz na sesję, nie przy każdym zapisie. */
  const noSpaceWarned = new WeakSet<GameSession>();

  /**
   * Sesje rankingowe z zamkniętym sezonem (`concludeSeason`): jedno `finishRun` na sesję, a ich aktywnego zapisu nikt już nie odnawia
   * (bieg przeszedł do szuflady albo przepadł, a zapis wskrzesiłby go przy następnym uruchomieniu).
   */
  const concluded = new WeakSet<GameSession>();

  /** Zapis biegu rankingowego (`traszka:ranked`). Odmowa przeglądarki to jedno ostrzeżenie na sesję; gra toczy się dalej. */
  function persistRanked(session: GameSession): void {
    if (saveRanked(session) || session.run === null || noSpaceWarned.has(session)) return;   // bez dziennika zapisu nie ma, ale to nie brak miejsca
    noSpaceWarned.add(session);
    fx.notice(RANKED_NO_SPACE_NOTICE);
  }

  function persist(): void {
    const { session, meta } = shell;
    if (!session) return;
    if (session.mode === 'ranked') {
      if (!concluded.has(session)) persistRanked(session);
    } else saveSession(session);   // sklep tymczasowy się nie zapisuje
    // zarobek z nieobecności czeka na „Odbierz!”, więc czas wyjścia zostaje stary; sklep tymczasowy nie jest prawdziwą grą
    if (!ui.welcome.value && !session.ephemeral) meta.lastSeen = Date.now();
    saveMeta(meta);
  }

  function publishMeta(): void {
    const { meta } = shell;
    const p = partnerOf(meta);
    ui.metaView.value = {
      points: p.points, stores: p.stores, networkIncome: p.networkIncome, network: meta.network.map((n) => n.seed), sound: meta.sound, vibration: meta.vibration,
    };
  }

  function publish(): void {
    const { session } = shell;
    if (!session) return;
    ui.econ.value = { s: session.econ, info: session.info, v: ++econVersion };
    ui.ephemeral.value = session.ephemeral;
    setRankedView(rankedViewOf(session));
  }

  function handleEvents(events: EconEvent[]): void {
    for (const e of events) {
      if (e.kind === 'day') { persist(); continue; }
      if (e.kind === 'month' && e.report) ui.report.value = e.report;
      if (e.kind === 'levelup' && e.level) {
        const lines = [e.text.replace(/^Poziom \d+! /, ''), ...(e.unlocks ?? []).map((u) => `🔓 ${u}`)];
        ui.celebration.value = { title: `POZIOM ${e.level}`, subtitle: rankFor(e.level), lines };
        fx.play('levelup');
        fx.buzz([30, 40, 30]);
        fx.confetti();
        // baner mija sam, a poziom, który coś odblokowuje, czeka jeszcze na „OK” (zwykły awans zostaje samą fetą)
        if (noticeLevel('levelup', { unlocks: e.unlocks?.length ?? 0 }) === 'story') ui.pushStory(`Poziom ${e.level}`, lines.join('\n'));
        continue;
      }
      if (!OWN_WINDOW.has(e.kind) && noticeLevel(e.kind, { unlocks: e.unlocks?.length ?? 0 }) === 'story') {
        ui.pushStory(STORY_TITLE[e.kind] ?? STORY_FALLBACK_TITLE, e.text);
        continue;
      }
      const sfx = sfxOf(e);
      if (sfx) fx.play(sfx);
      if (e.kind === 'golden' && e.text.startsWith('✨ Złota paleta rozładowana')) fx.confetti(0.5, 0.5, 24);
      ui.pushToast(e.text, e.kind);
    }
    concludeSeason();   // na końcu, bo pętla klatek woła to co klatkę (także z pustą listą): zapis dnia i raport miesiąca z tej samej klatki są już za nami
  }

  /**
   * Koniec biegu rankingowego: sezon się skończył (`seasonOver`) albo bieg zakończył się grą przed jego końcem (`gameOver`: granica
   * debetu albo wypowiedzenie umowy). Zamyka bieg dokładnie raz.
   * - Bankrut (`gameOver`) nie wchodzi do rankingu: serwer odrzuciłby go jako `season-bankrupt`, a lokalnie wiadomo to samo, więc nie ma
   *   odtwarzania (`finishRun`) ani szuflady. Aktywny zapis przepada, gracz dostaje jeden komunikat, a okno końca współpracy
   *   (`ReportModal`) mówi to samo pod powodem; okna końca sezonu nie ma.
   * - Sezon doigrany do końca: `finishRun` odtwarza cały sezon z dziennika (około sekundy), więc gra staje na ten czas; to cena za
   *   wynik liczony tym samym kodem co serwer. Gotowy bieg trafia do szuflady (`saveFinished`), a gdy przeglądarka jej nie przyjmie,
   *   zostaje w pamięci karty (`holdFinished`) z jednym ostrzeżeniem. Bieg bez dziennika (`run === null`: unieważniony) nie daje szuflady.
   *   Aktywny zapis znika dopiero, gdy bieg jest bezpieczny w szufladzie (`saveFinished` zwróciło true) albo nie ma czego ratować
   *   (bieg bez dziennika); `persist` sesji zamkniętej go nie odnawia. Gdy szuflada bieg odrzuci albo `finishRun` rzuci (błąd w kodzie,
   *   nie w dzienniku), aktywny zapis zostaje: przeładowanie strony przed „Zamknij” wznowi bieg z końca sezonu i zamknie go ponownie
   *   (to samo wejście, ten sam wynik), a po „Zamknij” (`leaveRanked` ustawia tryb `casual`) bieg wraca przez wiersz „Kontynuuj bieg
   *   rankingowy” w ustawieniach. Bieg do wysłania (w szufladzie albo w pamięci karty) otwiera okno końca sezonu (`ui.finish`): gracz
   *   widzi wynik i wysyła go albo zamyka okno. Gdy na ekranie stoi raport miesiąca (listopadowy, z tej samej klatki), okno otwiera dopiero
   *   jego „Dalej”, żeby gracz zobaczył raport końcowy sezonu.
   */
  function concludeSeason(): void {
    const { session } = shell;
    if (!session || session.mode !== 'ranked' || concluded.has(session)) return;
    if (!seasonOver(session.econ) && !session.econ.gameOver) return;
    concluded.add(session);   // przed `finishRun`: ani wyjątek, ani następna klatka nie powtórzy kosztownego odtwarzania
    if (session.econ.gameOver) {
      discardRanked();   // bankrut nie wraca w żadnej postaci: ani w szufladzie, ani z aktywnego zapisu
      syncUnsent();
      publish();   // faza `over` od razu
      fx.notice(RANKED_BANKRUPT_TEXT);
      return;
    }
    let finished: FinishedRun | null;
    try {
      finished = finishRun(session, Date.now());
    } catch (error) {
      console.error('Nie udało się podliczyć biegu rankingowego.', error);
      fx.notice(RANKED_FINISH_FAILED_NOTICE);
      publish();
      return;
    }
    if (finished === null) {
      fx.notice(RANKED_NOT_COUNTED_NOTICE);
      discardRanked();   // nie ma czego odzyskać: bieg unieważniony nie wróci w żadnej postaci
    } else if (saveFinished(finished)) {
      discardRanked();   // szuflada ma bieg: aktywny zapis kasujemy dopiero teraz
    } else {
      holdFinished(finished);   // aktywny zapis zostaje: bieg czeka w pamięci karty, a przeładowanie przed „Zamknij” wznowi go z końca sezonu
      fx.notice(RANKED_RESULT_NOT_SAVED_NOTICE);
    }
    syncUnsent();
    publish();   // faza `over` od razu, nie dopiero przy następnej publikacji
    // Bieg do wysłania (w szufladzie albo w pamięci karty): okno z wynikiem. Raport za listopad zamyka sezon w tej samej klatce co
    // `concludeSeason`, a „Zamknij” w oknie wychodzi z biegu i czyści raport, więc okno nad raportem zabrałoby graczowi raport końcowy:
    // gdy raport jest na ekranie, okno otwiera jego przycisk „Dalej” (`ReportModal`). Bez raportu (strona otwarta po końcu sezonu) otwiera się od razu.
    if (finished !== null && ui.report.value === null) openFinishWindow();
  }

  /** Otwiera okno końca sezonu, jeśli jest co wysłać; otwartego okna nie podmienia (jego model odświeża się tylko przy otwarciu). */
  function openFinishWindow(): void {
    if (ui.finish.value || pendingFinished() === null) return;
    ui.finish.value = { open: true };
  }

  /**
   * Stan zmieniony poza poleceniami (nagroda powitalna, `skip`): poziomy z nagrody, ich zdarzenia i odświeżenie sceny oraz
   * interfejsu. Polecenia gracza przechodzą przez `dispatchCommand`, który robi to sam.
   */
  function settleOutsideCommand(): void {
    const { session } = shell;
    if (!session) return;
    const events: EconEvent[] = [];
    processLevels(session.econ, events);
    handleEvents(events);
    scene.syncVisuals(session, true);
    publish();
  }

  /** Odbudowuje scenę poprzedniego sklepu po nieudanym przejściu (jego sesja stoi w `shell.session`); błąd tylko trafia do konsoli. */
  function restoreScene(previous: GameSession | null, previousSeed: string): void {
    try {
      scene.load(previous ? previous.seed : previousSeed, previous);
    } catch (again) {
      console.error('Nie udało się odtworzyć poprzedniego sklepu.', again);
    }
  }

  /** Czego chce przejście na inny sklep (`switchSession`). */
  interface SwitchRequest {
    /** Seed świata, który budujemy (scena, log błędu). */
    seed: string;
    /** Sesja nowego sklepu; może rzucić. null w benchmarku, który nie ma sesji (świat idzie z samego seeda). */
    make: () => GameSession | null;
    /** Komunikat dla gracza, gdy przejście się nie uda. */
    failure: string;
    /**
     * Czy po porażce odbudować scenę także wtedy, gdy nie było poprzedniego sklepu. Zwykłe przejście: tak (jak zawsze; w benchmarku to
     * jedyny sposób, by scena wróciła). Wejście w bieg rankingowy przy rozruchu: nie, bo `scene.load` po porażce zostawia scenę czystą,
     * a gra zaraz otworzy zwykły sklep; odtwarzanie świata bez sesji byłoby budową na darmo.
     */
    restoreWithoutPrevious: boolean;
  }

  /**
   * Szkielet każdego przejścia na inny sklep (zwykły i rankingowy): zapis obecnej sesji, nowa sesja, budowa świata, a gdy cokolwiek po
   * drodze rzuci, powrót do poprzedniego sklepu (jego sesja i świat odbudowany od nowa) i komunikat. Zwraca, czy się udało; po
   * sukcesie `shell.session` to nowa sesja, a wołający dokańcza przejście (adres, tryb, interfejs, publikacja, zapis).
   */
  function switchSession({ seed, make, failure, restoreWithoutPrevious }: SwitchRequest): boolean {
    persist();
    const previous = shell.session;
    const previousSeed = scene.seed ?? ui.seed.value;
    try {
      const next = make();
      shell.session = next;
      ui.selection.value = null;
      scene.load(seed, next);
    } catch (error) {
      console.error(`Nie udało się otworzyć sklepu „${seed}”.`, error);
      shell.session = previous;
      if (previous || restoreWithoutPrevious) restoreScene(previous, previousSeed);
      fx.notice(failure);
      return false;
    }
    return true;
  }

  /**
   * Stan interfejsu przypisany do jednego sklepu, który nie może przejść do następnego: seed w interfejsie, wpisy czekające na „OK”
   * i zaznaczona odpowiedź na kartę (numery kart zaczynają się w każdej grze od 1). `closePanels`: także otwarta zakładka i raport
   * miesiąca; robi to wejście w bieg rankingowy i powrót z niego, a zwykłe przejście między sklepami nie (tak jak zawsze).
   */
  function resetShopUi(seed: string, closePanels: boolean): void {
    ui.seed.value = seed;
    ui.story.value = [];
    ui.picked.value = null;
    if (!closePanels) return;
    ui.tab.value = null;
    ui.report.value = null;
  }

  /** Przejście na zwykły sklep: `switchSession` z sesją z `createSession`, a po sukcesie adres, tryb `casual`, interfejs, publikacja i zapis. */
  function openCasual(next: string, fresh: boolean, ephemeral: boolean, closePanels: boolean): boolean {
    const switched = switchSession({
      seed: next, restoreWithoutPrevious: true,
      make: () => (benchMode ? null : createSession(next, fresh, partnerOf(shell.meta), { ephemeral })),
      failure: `Nie udało się otworzyć sklepu „${next}”. Zostajesz w poprzednim.`,
    });
    if (!switched) return false;
    deps.writeSeedToUrl(next);
    if (!benchMode) rememberCasual();   // z biegu rankingowego wychodzi się tędy: zwykły sklep to tryb `casual`
    resetShopUi(next, closePanels);   // wpisy z poprzedniego sklepu (także po „Zacznij od nowa”) nie mają czego czekać w nowym
    publish();
    persist();
    if (shell.session?.loadNotice) fx.notice(shell.session.loadNotice);
    return true;
  }

  function setSeed(next: string, fresh = false, ephemeral = false): boolean {
    return openCasual(next, fresh, ephemeral, false);
  }

  // --- Bieg rankingowy: start, wznowienie, wyjście ---

  /**
   * Przejście na sesję rankingową (nowy bieg albo bieg z zapisu): `switchSession` z komunikatem `failure`, a po sukcesie `onEntered`
   * (porządki, które wolno zrobić dopiero teraz, np. skasowanie tego, co nowy bieg zastępuje; przed zapisem, żeby nie skasować nowego
   * biegu), tryb `ranked`, `?seed=` zdjęty z adresu (decyzja 3: bieg nie wpisuje seeda, a stary seed zwykłego sklepu kazałby odświeżeniu
   * otworzyć ten sklep zamiast wznowić bieg), interfejs sklepu (z zamknięciem zakładki i raportu), bez pytania o start i bez dymków
   * pierwszego dnia, publikacja i zapis. Bez okna powitalnego (także tego, które czekało w zwykłym sklepie) i nagród: bieg rankingowy zaczyna się od razu.
   */
  function enterRanked(seed: string, make: () => GameSession, failure: string, onEntered?: () => void): boolean {
    if (!switchSession({ seed, make, failure, restoreWithoutPrevious: false })) return false;
    onEntered?.();
    setPlayMode('ranked');
    deps.clearSeedFromUrl();
    resetShopUi(seed, true);
    ui.welcome.value = null;   // okno „Witaj z powrotem” czekające w zwykłym sklepie: „Odbierz!” dałoby nagrodę poza dziennikiem i unieważniło bieg (`markOffLog`)
    ui.confirmRankedStart.value = null;
    ui.showHints([]);
    publish();
    persist();
    return true;
  }

  /** Co blokuje start nowego biegu: niewysłany bieg w szufladzie (pierwszeństwo) albo trwający bieg rankingowy. Uszkodzony zapis nie blokuje: `loadRanked` już oddał go do kopii. */
  function rankedStartBlock(): ui.RankedStartRequest['reason'] | null {
    const current = shell.session;
    if (current?.mode === 'ranked' && !concluded.has(current)) return pendingFinished() !== null ? 'unsent' : 'active';   // bieg w pamięci karty, nawet gdy przeglądarka nie dała go zapisać; skończony sezon nie jest „rozpoczętym biegiem”
    return storedRankedBlock();   // szuflada, potem zapis w przeglądarce (to samo sprawdza ekran startowy przed powstaniem powłoki)
  }

  function startRanked(seed: string, opts: { replace?: boolean } = {}): boolean {
    if (benchMode) return false;
    // seed w postaci kanonicznej, z której da się zbudować sklep; zwykły zapis pod tym seedem nie zamienia startu we wczytanie sklepu
    const store = chooseStore(seed, { hasSave: () => false, draw: deps.randomSeed });
    if (!opts.replace) {
      const reason = rankedStartBlock();
      if (reason) {
        ui.confirmRankedStart.value = { seed: store.seed, reason };
        return false;
      }
    }
    const started = enterRanked(store.seed, () => createRankedSession(store.seed), `${rankedStartFailed(store.seed)} Zostajesz w poprzednim sklepie.`, () => {
      if (!opts.replace) return;
      clearFinished();   // dopiero teraz, gdy nowy świat stoi: nieudany start niczego nie traci
      discardRanked();
      syncUnsent();
    });
    if (started && store.notice) ui.pushToast(store.notice, 'info');   // lokal się nie zmieścił: sąsiedni
    return started;
  }

  function resumeRanked(): boolean {
    if (benchMode) return false;
    if (shell.session?.mode === 'ranked') return true;   // już w biegu: zapis w przeglądarce nie jest nowszy od stanu na ekranie
    const loaded = loadRanked();
    if (loaded.status === 'none') return false;
    if (loaded.status === 'broken') {
      fx.notice(RANKED_BROKEN_NOTICE);
      return false;
    }
    if (loaded.status === 'incompatible') {
      fx.notice(RANKED_INCOMPATIBLE_NOTICE);
      return false;
    }
    const { session } = loaded;
    if (!enterRanked(session.seed, () => session, RANKED_RESUME_FAILED_NOTICE)) return false;
    if (rankedRunStale(session)) fx.notice(RANKED_STALE_NOTICE);
    return true;
  }

  /**
   * Otwiera ostatni zwykły sklep (`traszka:last`) albo wolny losowy, tym samym przejściem co `setSeed` (`openCasual`): zapis obecnej
   * sesji (biegu też), budowa świata i, gdy się nie uda, powrót do poprzedniego z komunikatem. Po udanym przejściu zamyka zakładkę i raport biegu.
   */
  function openLastCasual(): boolean {
    return openCasual(lastSavedSeed() ?? freeSeed(deps.randomSeed, hasStoredSave), false, false, true);
  }

  function leaveRanked(): void {
    if (benchMode || shell.session?.mode !== 'ranked') return;
    openLastCasual();
  }

  function abandonRanked(): void {
    if (benchMode) return;
    // z biegu przechodzimy najpierw (to przejście zapisuje bieg i dopiero potem go kasujemy); gdy się nie uda, bieg zostaje nietknięty
    if (shell.session?.mode === 'ranked' && !openLastCasual()) return;
    discardRanked();
    rememberCasual();
  }

  /**
   * Efekty uboczne poleceń (`dispatchCommand`): dźwięk, wibracja, komunikaty, zapis i odświeżenie. Kolejność i warunki ich
   * użycia (które polecenie gra jaki dźwięk, kiedy zapisuje, kiedy zdejmuje zaznaczenie) trzyma tabela `AFTER`.
   */
  const commandEffects: CommandEffects = {
    play: (sfx) => fx.play(sfx),
    buzz: (pattern) => fx.buzz(pattern),
    toast: (text, kind) => ui.pushToast(text, kind),
    confetti: (x, y, count) => fx.confetti(x, y, count),
    handleEvents,
    persist,
    clearSelection: () => { ui.selection.value = null; },
    // `load` rzuca przy błędzie; `dispatchCommand` to łapie i pokazuje komunikat
    rebuildScene: () => { if (shell.session) scene.load(shell.session.seed, shell.session); },
    notice: (text) => fx.notice(text),
    refresh: () => { scene.syncVisuals(shell.session, true); publish(); },
  };

  /** Przejście na sklep dla `openChosen` (start.ts): `setSeed` z argumentami z wyboru, bieżąca sesja i komunikat u góry ekranu. */
  const storeSwitch: StoreSwitch = {
    setSeed: (seed, fresh) => setSeed(seed, fresh),
    session: () => shell.session,
    toast: (text) => ui.pushToast(text, 'info'),
  };

  /**
   * Wybór gracza z ekranu „Nowy sklep”: nick i wygląd kasjera do meta (w pamięci także wtedy, gdy meta jest tylko do odczytu), z kluczem
   * do rankingu poprzedniego gracza (zmiana nicka, kasjera albo seeda go nie gubi; gracz sprzed rankingu dostaje klucz tutaj, `bootMeta`), a
   * sklep otwiera `openChosen` (start.ts, z testem): przez `setSeed` zawsze bez `fresh`, więc seed z zapisem wczytuje ten zapis, a
   * zapisu z nowszej wersji gry ani takiego, którego świata nie dało się zbudować, nic nie nadpisze (`createSession`). Wygląd idzie
   * do sceny przed `setSeed`: każdy sklep (także poprzedni, odtworzony, gdy nowy się nie otworzył) stawia kasjera z tego wyglądu,
   * więc `CashierView.setLook` na żywo nie jest tu potrzebne. Po otwarciu zupełnie nowego sklepu wstaje okno „Jak grać” (gra czeka na
   * „Zaczynamy”); sklep wczytany z zapisu i sklep, który się nie otworzył (gracz zostaje w poprzednim), instrukcji nie otwierają.
   *
   * Wybór rankingowy (`choice.ranked`, „Start rankingowy”) idzie do `startRanked(seed, opts)` zamiast do `openChosen`: bieg zaczyna się
   * od zera bez wczytywania zwykłego zapisu pod tym seedem, a instrukcji nie otwiera (tylko zwykły, zupełnie nowy sklep). `opts.replace`
   * to „Porzuć i zacznij” z pytania. Ekran pyta o porzucenie biegu jeszcze przed zamknięciem (`rankedBlock`), więc tu pytanie nie powinno
   * paść; gdyby stan zmienił się po drodze (`startRanked` odmówił i ustawił `confirmRankedStart`), nic nie zostaje skasowane, a ekran
   * wraca z tym samym wyborem i pytaniem. Inna porażka (świat się nie zbudował) zostawia gracza w poprzednim sklepie z komunikatem.
   */
  function openChosenStore(choice: StartChoice, opts?: { replace?: boolean }): void {
    shell.meta = bootMeta(shell.meta, choice);   // gracz z wyboru, z kluczem poprzedniego (albo nowym u gracza sprzed rankingu)
    saveMeta(shell.meta);
    scene.setCashierLook(choice.look);
    if (choice.ranked) {
      ui.confirmRankedStart.value = null;   // po wywołaniu wartość znaczy tylko jedno: `startRanked` zapytał właśnie teraz
      if (startRanked(choice.seed, opts)) {
        if (choice.notice) ui.pushToast(choice.notice, 'info');   // np. „sąsiedni lokal”; `startRanked` zna tylko seed, który już jest kanoniczny
      } else if (ui.confirmRankedStart.value) {
        openStartScreen({ nick: choice.nick, seed: choice.seed, look: choice.look, specialOutfits: choice.specialOutfits });
      }
      return;
    }
    if (openChosen(choice, storeSwitch) && shell.session && !shell.session.fromSave) ui.openHowTo();
  }

  /** Ekran „Nowy sklep” (tryb `new`): gra czeka pod nim (modal w pętli klatek). Pola z `form`; zatwierdzenie to `openChosenStore`. */
  function openStartScreen(form: StartForm): void {
    ui.start.value = {
      mode: 'new',
      form,
      factory: deps.characterFactory(),
      onStart: openChosenStore,
      onBack: () => {},
      weekSeed: deps.weekSeed,
      rankedBlock: rankedStartBlock,
    };
  }

  const game: ui.GameActions = {
    dispatch: (cmd) => (shell.session ? dispatchCommand(shell.session, cmd, commandEffects) : { ok: false, text: '' }),
    claimWelcome: () => {
      const w = ui.welcome.value;
      ui.welcome.value = null;
      const { session } = shell;
      if (!session || !w) return;
      grantOffline(session.econ, w.offline);
      if (w.daily && w.streak !== null) {
        grantDaily(session.econ, w.daily.cash, w.daily.ogonki);
        claimDaily(shell.meta, w.streak, new Date());   // seria przesuwa się dopiero po odebraniu premii
      }
      markOffLog(session);   // nagroda poza poleceniami: dziennika już nie prowadzimy
      fx.play('coins');
      fx.confetti();
      settleOutsideCommand();
      persist();
    },
    openNextStore: () => {
      const closed = shell.session;
      if (!closed) return;
      if (closed.mode === 'ranked') {   // bieg rankingowy nie ma sieci sklepów (serwer odtwarza go bez premii z sieci)
        fx.notice(RANKED_NO_NETWORK_NOTICE);
        return;
      }
      if (closed.ephemeral || shell.meta.readOnly) {   // sieć sklepów trzeba zapisać, a ta karta nie może: sklep zniknąłby bez śladu
        fx.notice('Kolejną Traszkę otworzysz po odświeżeniu strony: ta karta nie może teraz zapisać sieci sklepów.');
        return;
      }
      const before = shell.meta;
      // nowa gra nie czyta zapisu, więc seed musi być wolny (inaczej pierwszy zapis zjadłby cudzą grę); losujemy przed
      // zamknięciem, kiedy zapis zamykanego sklepu jeszcze leży, więc i jego seed nie wróci; seed z sieci też jest zajęty,
      // bo addToNetwork przyjmuje każdy seed raz i drugi sklep pod nim nie dałby premii
      const next = freeSeed(deps.randomSeed, (s) => hasStoredSave(s) || shell.meta.network.some((n) => n.seed === s));
      shell.meta = addToNetwork(shell.meta, closed.econ);   // nowy sklep dostaje już premię z tego; ten sam seed drugi raz niczego nie daje
      retireSession(closed);                                // zapis znika i nie wróci: setSeed zaraz zapisuje „bieżący” sklep
      if (!setSeed(next, true)) {                           // nowy sklep się nie otworzył: wszystko wraca na miejsce
        shell.meta = before;
        reviveSession(closed);
        persist();
        return;
      }
      publishMeta();
      ui.tab.value = null;
      const { meta } = shell;
      ui.celebration.value = {
        title: 'NOWA TRASZKA!',
        subtitle: `Sieć: ${meta.network.length} ${meta.network.length === 1 ? 'sklep' : 'sklepy'} · ${meta.partnerPoints} Punktów Partnera`,
        lines: [`Dochód z sieci: ${partnerOf(meta).networkIncome.toLocaleString('pl-PL')} zł dziennie`],
      };
      fx.play('levelup');
      fx.confetti();
    },
    setSound: (on) => { shell.meta.sound = on; fx.setSound(on); saveMeta(shell.meta); publishMeta(); },
    setVibration: (on) => { shell.meta.vibration = on; fx.setVibration(on); saveMeta(shell.meta); publishMeta(); },
    restart: () => {
      const { session } = shell;
      if (!session) return;
      if (session.mode === 'ranked') {   // „od nowa” skasowałoby bieg; porzuca się go osobno (`abandonRanked`), a zwykłych zapisów restart nie rusza
        fx.notice(RANKED_NO_RESTART_NOTICE);
        return;
      }
      const ephemeral = session.ephemeral;   // zapis pod seedem sklepu tymczasowego jest cudzy: zostaje, a świeża gra też jest tymczasowa
      discardSave(session);
      ui.report.value = null;
      setSeed(session.seed, true, ephemeral);
    },
    newStore: () => {
      if (benchMode) return;
      ui.showSettings.value = false;
      ui.tab.value = null;
      ui.selection.value = null;
      // seed w polu to wolny, losowy: „Otwieramy sklep!” otwiera NOWY sklep; stare pytanie o bieg (z innego ekranu) nie wraca
      ui.confirmRankedStart.value = null;
      openStartScreen(initialStartForm(shell.meta, freeSeed(deps.randomSeed, hasStoredSave)));
    },
    startRanked,
    resumeRanked,
    leaveRanked,
    abandonRanked,
    openFinish: openFinishWindow,
    rememberNick: (nick) => {
      const { player } = shell.meta;
      if (!player) return;   // bez gracza nie ma komu zapamiętać nicka (a bez klucza nic by nie poszło do serwera)
      shell.meta.player = { ...player, nick };   // reszta gracza, w tym klucz, zostaje
      saveMeta(shell.meta);
    },
  };

  const shell: GameShell = {
    session: null,
    meta: deps.meta,
    persist,
    publish,
    setSeed,
    handleEvents,
    startRanked,
    resumeRanked,
    leaveRanked,
    abandonRanked,

    open({ seed, fresh, choice }) {
      let session: GameSession;
      try {
        // Każda nieudana próba budowy sprząta po sobie scenę (loadStore), więc kolejna zaczyna od czystej; do kopii idzie tylko
        // zapis, którego nie da się przeczytać.
        const build = (opening: GameSession): void => { shell.session = opening; scene.load(opening.seed, opening); };
        const partner = partnerOf(shell.meta);
        session = openStore(choice
          ? openRequestFor(choice, { partner, randomSeed: deps.randomSeed, build })   // ekran startowy: nigdy `fresh`
          : { seed, fresh, partner, randomSeed: deps.randomSeed, build });
      } catch (error) {
        // żaden sklep się nie zbudował (renderer): zapis nietknięty, a gracz dostaje komunikat zamiast pustej strony
        console.error('Nie udało się zbudować żadnego sklepu.', error);
        fx.notice(UNBUILDABLE_SAVE_NOTICE);
        return false;
      }
      shell.session = session;
      ui.seed.value = session.seed;
      const chosenNotice = choice ? noticeAfterOpen(choice, session) : null;   // „Wczytujemy…” tylko, gdy zapis wczytał się normalnie
      if (chosenNotice) ui.pushToast(chosenNotice, 'info');
      if (session.loadNotice) fx.notice(session.loadNotice);   // po komunikacie z ekranu: ten o zapisie zostaje na wierzchu
      // Adres dopiero po tym, jak świat stoi. Sklep tymczasowy o innym seedzie niż ten, o który prosił adres, go nie przepisuje:
      // odświeżenie ma wrócić do sklepu gracza (jego zapis jest cały), a nie utknąć w zastępczym.
      if (!session.ephemeral || session.seed === seed) deps.writeSeedToUrl(session.seed);
      publish();
      // nic się nie zapisuje, dopóki gracz nie kliknie „Odbierz!”; po wypowiedzeniu umowy wstaje samo okno końca gry
      const start = startupWindow(shell.meta, session.econ, session.ephemeral, new Date(), session.mode);
      ui.showHints(start.intro ? deps.firstDayHints : []);   // nowa gra: wskazówki pierwszego dnia w krótkich dymkach
      ui.welcome.value = start.welcome;
      if (choice) ui.openHowTo();   // pierwsze wejście przez ekran startowy: instrukcja, gra i dymki pierwszego dnia czekają na „Zaczynamy”
      persist();
      return true;
    },

    tap(hit, x, y) {
      const { session } = shell;
      if (!session) return;
      if (hit?.kind === 'pallet') {
        ui.selection.value = hit;
        const r = game.dispatch({ type: 'tapPallet', palletId: hit.id });
        const mult = tapCombo(session.econ).mult;   // seria po tym stuknięciu, ze stanu gry
        if (r.ok) fx.floater(x, y, `+${Math.round(r.value ?? 0)} szt.${mult > 1 ? ` ×${mult}` : ''}`, 'work');
      } else if (hit?.kind === 'till') {
        ui.selection.value = hit;
        const r = game.dispatch({ type: 'tapTill' });
        if (r.ok) fx.floater(x, y, money(r.value ?? 0), 'money');
      } else if (hit?.kind === 'slot') {
        ui.selection.value = hit;
        ui.tab.value = null;
      } else {
        ui.selection.value = null;
      }
    },

    // te same zasady co na ekranie startowym: zapis pod seedem wygrywa, dziwny tekst też daje sklep, a otwiera go to samo `openChosen`
    generate: (text) => { openChosen(chooseStore(text), storeSwitch); },
    randomize: () => { setSeed(deps.randomSeed()); },

    skip(minutes) {
      const { session } = shell;
      if (!session || session.mode === 'ranked') return;   // przewinięcie unieważniłoby bieg rankingowy (`markOffLog`)
      const events: EconEvent[] = [];
      // karta decyzji zatrzymuje także przewijanie: bez odpowiedzi gracza gra nie idzie dalej (jak pętla klatek)
      for (let i = 0; i < minutes && !session.econ.gameOver && !awaitingDecision(session.econ); i++) stepMinute(session.econ, session.info, events);
      handleEvents(events);
      markOffLog(session);   // przewinięcie nie jest poleceniem: dziennik nie odtworzy takiego stanu
      settleOutsideCommand();
    },

    game,
  };

  fx.setSound(shell.meta.sound);
  fx.setVibration(shell.meta.vibration);
  if (shell.meta.readOnly) fx.notice(NEWER_SAVE_NOTICE);   // meta z nowszej wersji gry: nic jej nie nadpisze w tej karcie
  publishMeta();
  syncUnsent();   // niewysłany bieg z poprzedniej wizyty czeka w szufladzie
  return shell;
}
