import type { CharacterFactory } from '@/render/characters/characterFactory';
import { applyCommand, type Command } from '@/sim/economy/commands';
import {
  grantDaily, grantOffline, processLevels, stepMinute, tapCombo, type CommandResult, type EconEvent,
} from '@/sim/economy/economy';
import { rankFor } from '@/sim/economy/progress';
import type { Sfx } from '@/ui/sfx';
import * as ui from '@/ui/state';
import type { CashierLook } from './cashier';
import { addToNetwork, claimDaily, partnerOf, saveMeta, startupWindow, type Meta } from './meta';
import { openStore } from './openStore';
import type { ScenePick } from './scene';
import { chooseStore, freeSeed } from './seeds';
import {
  NEWER_SAVE_NOTICE, RUN_LOG_MAX, UNBUILDABLE_SAVE_NOTICE, createSession, discardSave, hasStoredSave, retireSession, reviveSession, saveSession,
  type GameSession,
} from './session';
import { initialStartForm, noticeAfterOpen, openChosen, openRequestFor, playerOf, type StartChoice, type StoreSwitch } from './start';

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
  claimQuest: { okToast: true, sfx: 'coins', buzz: [15, 30, 15], confetti: { fx: 0.5, fy: 0.6, count: 28 }, persist: true },
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
  /** Wpisuje seed do adresu strony (`writeSeedToUrl` w scene.ts). */
  writeSeedToUrl(seed: string): void;
  /** Fabryka postaci dla ekranu „Nowy sklep”: ta sama, z której korzysta gra. */
  characterFactory(): Promise<CharacterFactory>;
  /** Podpowiedzi pierwszego dnia w krótkich dymkach (`FIRST_DAY_HINTS` w ui/game/overlays.tsx: moduł interfejsu, więc podaje je main.ts). */
  firstDayHints: readonly string[];
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
  /** Zdarzenia ekonomii: zapis na koniec dnia, raport miesiąca, feta poziomu, dźwięki i toasty. */
  handleEvents(events: EconEvent[]): void;
  /** Stuknięcie w scenę (`hit` z `SceneHost.pick`, `x`, `y` to punkt ekranu w px): rozładunek, obsługa klienta, karta zakupu albo zdjęcie zaznaczenia. */
  tap(hit: ScenePick | null, x: number, y: number): void;
  /** Sklep z tekstu wpisanego w ⚙: te same zasady co na ekranie startowym. */
  generate(text: string): void;
  /** Nowy losowy seed (klawisz R, przycisk „Losuj”). */
  randomize(): void;
  /** Przewija grę o `minutes` minut (testy ręczne i zrzuty); wyłącza dziennik biegu. */
  skip(minutes: number): void;
  /** Gra widziana z interfejsu (`dispatch` i czynności spoza symulacji). */
  game: ui.GameActions;
}

const EVENT_SFX: Partial<Record<EconEvent['kind'], Sfx>> = { delivery: 'delivery', fine: 'fine', golden: 'golden', milestone: 'coins', warning: 'error' };

const money = (n: number): string => `+${n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

/**
 * Składa powłokę. Przy tworzeniu: dźwięk i wibracja z mety, komunikat o nowszej wersji gry (gdy meta jest tylko do odczytu) i
 * widok mety dla interfejsu. Sesji jeszcze nie ma: otwiera ją rozruch (`openStore`), który przypisuje ją do `shell.session`.
 */
export function createShell(deps: ShellDeps): GameShell {
  const { scene, effects: fx, benchMode } = deps;
  let econVersion = 0;

  function persist(): void {
    const { session, meta } = shell;
    if (!session) return;
    saveSession(session);   // sklep tymczasowy się nie zapisuje
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
  }

  function handleEvents(events: EconEvent[]): void {
    for (const e of events) {
      if (e.kind === 'day') { persist(); continue; }
      if (e.kind === 'month' && e.report) ui.report.value = e.report;
      if (e.kind === 'levelup' && e.level) {
        ui.celebration.value = {
          title: `POZIOM ${e.level}`,
          subtitle: rankFor(e.level),
          lines: [e.text.replace(/^Poziom \d+! /, ''), ...(e.unlocks ?? []).map((u) => `🔓 ${u}`)],
        };
        fx.play('levelup');
        fx.buzz([30, 40, 30]);
        fx.confetti();
        continue;
      }
      const sfx = EVENT_SFX[e.kind];
      if (sfx) fx.play(sfx);
      if (e.kind === 'golden' && e.text.startsWith('✨ Złota paleta rozładowana')) fx.confetti(0.5, 0.5, 24);
      ui.pushToast(e.text, e.kind);
    }
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

  function setSeed(next: string, fresh = false, ephemeral = false): boolean {
    persist();
    const previous = shell.session;
    const previousSeed = scene.seed ?? ui.seed.value;
    try {
      if (!benchMode) shell.session = createSession(next, fresh, partnerOf(shell.meta), { ephemeral });
      ui.selection.value = null;
      scene.load(next, shell.session);
    } catch (error) {
      console.error(`Nie udało się otworzyć sklepu „${next}”.`, error);
      shell.session = previous;
      try {
        scene.load(previous ? previous.seed : previousSeed, previous);
      } catch (again) {
        console.error('Nie udało się odtworzyć poprzedniego sklepu.', again);
      }
      fx.notice(`Nie udało się otworzyć sklepu „${next}”. Zostajesz w poprzednim.`);
      return false;
    }
    deps.writeSeedToUrl(next);
    ui.seed.value = next;
    publish();
    persist();
    if (shell.session?.loadNotice) fx.notice(shell.session.loadNotice);
    return true;
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
   * Wybór gracza z ekranu „Nowy sklep”: nick i wygląd kasjera do meta (w pamięci także wtedy, gdy meta jest tylko do odczytu), a
   * sklep otwiera `openChosen` (start.ts, z testem): przez `setSeed` zawsze bez `fresh`, więc seed z zapisem wczytuje ten zapis, a
   * zapisu z nowszej wersji gry ani takiego, którego świata nie dało się zbudować, nic nie nadpisze (`createSession`). Wygląd idzie
   * do sceny przed `setSeed`: każdy sklep (także poprzedni, odtworzony, gdy nowy się nie otworzył) stawia kasjera z tego wyglądu,
   * więc `CashierView.setLook` na żywo nie jest tu potrzebne.
   */
  function openChosenStore(choice: StartChoice): void {
    shell.meta.player = playerOf(choice);
    saveMeta(shell.meta);
    scene.setCashierLook(choice.look);
    openChosen(choice, storeSwitch);
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
      // gra czeka pod ekranem (modal w pętli klatek); seed w polu to wolny, losowy: „Otwieramy sklep!” otwiera NOWY sklep
      ui.start.value = {
        mode: 'new',
        form: initialStartForm(shell.meta, freeSeed(deps.randomSeed, hasStoredSave)),
        factory: deps.characterFactory(),
        onStart: openChosenStore,
        onBack: () => {},
      };
    },
  };

  const shell: GameShell = {
    session: null,
    meta: deps.meta,
    persist,
    publish,
    setSeed,
    handleEvents,

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
      const start = startupWindow(shell.meta, session.econ, session.ephemeral, new Date());
      ui.showHints(start.intro ? deps.firstDayHints : []);   // nowa gra: wskazówki pierwszego dnia w krótkich dymkach
      ui.welcome.value = start.welcome;
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
      if (!session) return;
      const events: EconEvent[] = [];
      for (let i = 0; i < minutes && !session.econ.gameOver; i++) stepMinute(session.econ, session.info, events);
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
  return shell;
}
