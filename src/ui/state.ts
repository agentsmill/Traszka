import { computed, signal, type Signal } from '@preact/signals';
import type { Speed } from '@/game/loop';
import type { StartChoice, StartForm } from '@/game/start';
import type { CharacterFactory } from '@/render/characters/characterFactory';
import type { QualityPresetId } from '@/render/quality';
import type { TimeOfDay } from '@/render/lighting';
import type { BenchProgress } from '@/bench/bench';
import type { PerfSnapshot } from './perfMeter';
import type { Command } from '@/sim/economy/commands';
import { awaitingDecision, type CommandResult, type EconEventKind, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import { readMs } from '@/sim/economy/tycoon/notices';

/*
 * Stan widoczny w interfejsie. Zmienia go i przycisk, i klawisz, a czyta interfejs. Sterowanie światem to obiekt `Controls`
 * (składa go main.ts ze sceny, `src/game/scene.ts`, i powłoki gry, `src/game/actions.ts`; klawisze podpina `src/game/controls.ts`),
 * więc jedno wywołanie aktualizuje i świat, i sygnał.
 */
export const seed: Signal<string> = signal('');
export const preset: Signal<QualityPresetId> = signal<QualityPresetId>('srednia');
export const speed: Signal<Speed> = signal<Speed>(1);
export const timeOfDay: Signal<TimeOfDay> = signal<TimeOfDay>('day');
export const perf: Signal<PerfSnapshot> = signal<PerfSnapshot>({ fps: 0, ms: 0, calls: 0, tris: 0 });
export const showPerf: Signal<boolean> = signal(false);
/** Postęp benchmarku (`?bench=1`) albo null poza nim. */
export const bench: Signal<BenchProgress | null> = signal<BenchProgress | null>(null);
/** Komunikat dla gracza z `traszka:notice` albo null. */
export const notice: Signal<string | null> = signal<string | null>(null);

/** Akcje, które interfejs wywołuje w grze. Te same funkcje wołają klawisze (`src/game/controls.ts`); realizują je scena (`src/game/scene.ts`) i powłoka gry (`src/game/actions.ts`). */
export interface Controls {
  setSpeed(next: Speed): void;
  /** −1 w lewo (Q), +1 w prawo (E). */
  rotate(dir: 1 | -1): void;
  setTimeOfDay(next: TimeOfDay): void;
  setPreset(next: QualityPresetId): void;
  /** Przebudowuje świat dla wpisanego seeda, bez przeładowania strony. Pusty tekst daje losowy seed. */
  generate(text: string): void;
  /** Nowy losowy seed (klawisz R, przycisk „Losuj”). */
  randomize(): void;
}

// --- Gra (ekonomia sklepu) ---------------------------------------------------------------------------

/** Stan ekonomii dla interfejsu. `v` rośnie przy każdej publikacji, więc komponenty odświeżają się kilka razy na sekundę. */
export interface EconView { s: EconomyState; info: StoreInfo; v: number }
export const econ: Signal<EconView | null> = signal<EconView | null>(null);

export type Selection = { kind: 'pallet'; id: number } | { kind: 'slot'; slotId: string } | { kind: 'till' };
export const selection: Signal<Selection | null> = signal<Selection | null>(null);

export type TabId = 'sklep' | 'palety' | 'ludzie' | 'ulepszenia' | 'cele';
export const tab: Signal<TabId | null> = signal<TabId | null>(null);

export type ToastKind = EconEventKind | 'ok' | 'error';
export interface Toast { id: number; text: string; kind: ToastKind }
export const toasts: Signal<Toast[]> = signal<Toast[]>([]);
export const report: Signal<MonthReport | null> = signal<MonthReport | null>(null);
export const showSettings: Signal<boolean> = signal(false);
/**
 * Okno „Jak grać” (`ui/howto/HowTo.tsx`): otwiera się po ekranie startowym i z ⚙, a dopóki jest otwarte, gra stoi (`isModalOpen`),
 * a podpowiedzi pierwszego dnia czekają. Otwiera i zamyka je `openHowTo` / `closeHowTo`. Nie jest częścią zapisu.
 */
export const howTo: Signal<boolean> = signal(false);
/** Sklep tymczasowy (zapis się nie zbudował albo jest z nowszej wersji gry): nic się w nim nie zapisuje, więc ekran gry to pokazuje. */
export const ephemeral: Signal<boolean> = signal(false);

/**
 * Ekran startowy „Twój kasjer”: otwarty z danymi, z którymi się pokazuje, albo null. Zastępuje dawne okno „Witaj w Traszce”;
 * jego wskazówki przeszły do podpowiedzi pierwszego dnia (`hints`).
 */
export interface StartRequest {
  /** `first`: wejście na stronę (gry jeszcze nie ma); `new`: „Nowy sklep” z ⚙ (gra stoi pod ekranem i czeka). */
  mode: 'first' | 'new';
  form: StartForm;
  /** Fabryka postaci dla podglądu: ta sama, z której korzysta gra (strój specjalny dociąga się przy pokazaniu). */
  factory: Promise<CharacterFactory>;
  /**
   * Gracz zatwierdził: ekran jest już zamknięty, a podgląd zwolniony (renderer i kontekst WebGL), gra może ruszać. Zwykły start woła to
   * z samym wyborem; „Porzuć i zacznij” z pytania o bieg rankingowy dokłada `{ replace: true }` (nowy bieg zastępuje niewysłany bieg
   * i aktywny zapis, `GameShell.startRanked`). Ekran nie czeka na wynik: pytanie zadaje przed zamknięciem (`rankedBlock`).
   */
  onStart(choice: StartChoice, opts?: { replace?: boolean }): void;
  /** „Wróć do gry”; tylko w trybie `new`. */
  onBack?(): void;
  /**
   * Seed tygodnia z serwera rankingu dla chipa „Seed tygodnia” (`createRankingClient().board('week')`); null, gdy serwer nie odpowiada
   * (ranking wyłączony, brak sieci). Bez tej funkcji ekran nie ma chipa.
   */
  weekSeed?(): Promise<string | null>;
  /**
   * Czy start rankingowy musi najpierw zapytać gracza (niewysłany bieg w szufladzie albo trwający bieg rankingowy; `null`: nie musi).
   * Ekran woła to po kliknięciu „Start rankingowy”, ZANIM cokolwiek zamknie: podgląd 3D oddaje kontekst WebGL bezpowrotnie, więc
   * pytanie nie może paść po jego zamknięciu. Bez tej funkcji ekran nie pyta (start rankingowy sam sprawdzi i, gdyby stan zmienił się
   * po drodze, wróci do pytania: `openChosenStore`). Nie zmienia niczego; pytanie ustawia ekran (`confirmRankedStart`).
   */
  rankedBlock?(): RankedStartRequest['reason'] | null;
}
export const start: Signal<StartRequest | null> = signal<StartRequest | null>(null);

/** Ile (ms) widać jedną podpowiedź pierwszego dnia, zanim wejdzie następna. */
export const HINT_MS = 9000;
/** Podpowiedzi pierwszego dnia (krótkie dymki): pierwsza jest widoczna, kolejne wchodzą po kolei. */
export const hints: Signal<string[]> = signal<string[]>([]);
let hintTimer: ReturnType<typeof setTimeout> | undefined;
function armHint(): void {
  clearTimeout(hintTimer);
  // pod oknem, które zatrzymuje grę (w tym „Jak grać” i kartą decyzji), dymki czekają: gracz czyta okno, a ich czas liczy się
  // dopiero od jego zamknięcia (`hintsHeld` uzbraja zegar od nowa, gdy okno znika)
  hintTimer = hints.value.length > 0 && !hintsHeld.value ? setTimeout(nextHint, HINT_MS) : undefined;
}
/** Otwiera „Jak grać”; zegar podpowiedzi pierwszego dnia staje (`hintsHeld`). */
export function openHowTo(): void {
  howTo.value = true;
}
/** „Zaczynamy”: zamyka „Jak grać”, a obecna podpowiedź dostaje pełny czas od nowa (`hintsHeld`). */
export function closeHowTo(): void {
  howTo.value = false;
}
/** Pokazuje podpowiedzi po kolei (lista zastępuje poprzednią; pusta czyści). */
export function showHints(list: readonly string[]): void {
  hints.value = [...list];
  armHint();
}
/** Następna podpowiedź („Dalej”); czas kolejnej liczy się od nowa. */
export function nextHint(): void {
  hints.value = hints.value.slice(1);
  armHint();
}

let toastId = 0;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** Ile (ms) błąd zostaje na ekranie; zwykły toast tyle, ile potrzeba na przeczytanie (`readMs`). */
export const ERROR_TOAST_MS = 2200;

/**
 * Krótki komunikat u góry ekranu; znika sam po czasie czytania (`readMs`: dłuższy tekst zostaje dłużej, najkrócej 4 s, najdłużej 12 s),
 * a błąd po 2,2 s. Najwyżej 2 naraz. Ten sam tekst się nie dubluje: zostaje ten sam toast (interfejs nie montuje go od nowa, więc nie miga),
 * a jego czas liczy się od nowa.
 */
export function pushToast(text: string, kind: ToastKind = 'info'): void {
  const same = toasts.value.find((t) => t.text === text && t.kind === kind);
  const toast: Toast = same ?? { id: ++toastId, text, kind };
  if (!same) {
    const kept = toasts.value.filter((t) => t.text !== text).slice(-1);
    for (const t of toasts.value) if (!kept.includes(t)) forgetToast(t);
    toasts.value = [...kept, toast];
  }
  clearTimeout(toastTimers.get(toast.id));
  toastTimers.set(toast.id, setTimeout(() => {
    toastTimers.delete(toast.id);
    toasts.value = toasts.value.filter((t) => t !== toast);
  }, kind === 'error' ? ERROR_TOAST_MS : readMs(text)));
}
function forgetToast(t: Toast): void {
  clearTimeout(toastTimers.get(t.id));
  toastTimers.delete(t.id);
}

/**
 * Ważne zdarzenia fabularne (nowy próg zaufania, koniec remontu, poziom z odblokowaniami): gra stoi, aż gracz kliknie „OK”
 * (`noticeLevel` w tycoon/notices.ts rozstrzyga, co się tu łapie; `handleEvents` w game/actions.ts je kieruje). Kolejka, bo
 * w jednej chwili gry może ich przyjść kilka. `text` może mieć kilka wierszy (rozdzielonych `\n`). Nie jest częścią zapisu.
 */
export interface Story { id: number; title: string; text: string }
export const story: Signal<Story[]> = signal<Story[]>([]);
let storyId = 0;
export function pushStory(title: string, text: string): void {
  story.value = [...story.value, { id: ++storyId, title, text }];
}
/** „OK”: zdejmuje pierwszy wpis (pusta kolejka zostaje pusta). */
export function dismissStory(): void {
  if (story.value.length > 0) story.value = story.value.slice(1);
}

/**
 * Wybór gracza na wyświetlonej karcie decyzji: numer karty (`seq`) i zaznaczona odpowiedź. Wybór dotyczy jednej karty, a numery
 * kart zaczynają się w każdej grze od 1, więc `setSeed` (nowy sklep, „Zacznij od nowa”) czyści ten sygnał. Okno karty
 * (`game/cards.tsx`) i tak ignoruje wybór cudzej karty albo spoza zakresu odpowiedzi. Nie jest częścią zapisu.
 */
export interface PickedAnswer { seq: number; answer: number }
export const picked: Signal<PickedAnswer | null> = signal<PickedAnswer | null>(null);

/** Wielki komunikat nagrody na środku ekranu (nowy poziom). Znika sam. */
export interface Celebration { title: string; subtitle: string; lines: string[] }
export const celebration: Signal<Celebration | null> = signal<Celebration | null>(null);

/** Okno „Witaj z powrotem”: zarobek pod nieobecność i premia za serię dni (do odebrania jednym przyciskiem). */
export interface Welcome { hours: number; offline: number; streak: number | null; daily: { cash: number; ogonki: number } | null }
export const welcome: Signal<Welcome | null> = signal<Welcome | null>(null);

/** Sieć sklepów i ustawienia z mety (meta.ts) dla interfejsu. */
export interface MetaView { points: number; stores: number; networkIncome: number; /** Seedy sklepów już w sieci. */ network: string[]; sound: boolean; vibration: boolean }
export const metaView: Signal<MetaView> = signal<MetaView>({ points: 0, stores: 0, networkIncome: 0, network: [], sound: true, vibration: true });
export const showPrestige: Signal<boolean> = signal(false);

// --- Tryb rankingowy (spec §14.7) -----------------------------------------------------------------------------------

/**
 * Bieg rankingowy, który toczy się na ekranie: seed, dzień sezonu (`day` od 1, nie więcej niż `days`; `days` to 91, od 1 września do
 * 30 listopada) i faza. `over` znaczy, że sezon się skończył. Liczy to powłoka gry (`publish` w game/actions.ts) ze stanu sesji.
 */
export interface RankedView { seed: string; day: number; days: number; phase: 'playing' | 'over' }
/** Widok biegu rankingowego albo null poza trybem rankingowym (zwykły sklep). Nie jest częścią zapisu. */
export const ranked: Signal<RankedView | null> = signal<RankedView | null>(null);
/**
 * Szuflada niewysłanego biegu (`traszka:ranked:done`, rankedRun.ts): seed i wynik biegu, który skończył sezon i czeka na przyjęcie przez
 * serwer, albo null, gdy szuflada jest pusta. Powłoka gry ustawia go przy starcie i po każdej zmianie szuflady (`syncUnsent`).
 */
export interface UnsentRun { seed: string; score: number }
export const unsent: Signal<UnsentRun | null> = signal<UnsentRun | null>(null);
/**
 * Okno końca sezonu i ponownej wysyłki wyniku (`ui/ranking/FinishWindow.tsx`): otwarte, gdy sygnał ma wartość. Otwiera je powłoka gry,
 * gdy sezon się kończy i bieg czeka na wysłanie (`concludeSeason`), oraz `openFinish` (z panelu rankingu i ⚙). Dopóki jest otwarte, gra
 * stoi (`isWindowOpen`), a okno leży nad kartą decyzji, wpisem „OK” i raportem miesiąca (kolejność w App.tsx). Zamyka je `closeFinish`.
 * Nie jest częścią zapisu.
 */
export const finish: Signal<{ open: true } | null> = signal<{ open: true } | null>(null);

/**
 * Zamyka okno końca sezonu. W skończonym biegu rankingowym (`ranked.phase === 'over'`) gracz nie ma po co zostawać w zatrzymanym
 * sezonie, więc zamknięcie (z dowolnym wynikiem, także gdy bieg nie został przyjęty i czeka w szufladzie) wychodzi do zwykłej gry
 * (`leaveRanked`). Okno otwarte z panelu rankingu albo z ⚙ w zwykłej grze się tylko zamyka. Sygnał schodzi przed wyjściem z biegu,
 * żeby zwykły sklep nie otworzył się pod oknem, które gra jeszcze uważa za otwarte.
 */
export function closeFinish(game: Pick<GameActions, 'leaveRanked'>): void {
  finish.value = null;
  if (ranked.value?.phase === 'over') game.leaveRanked();
}

/**
 * Prośba o decyzję gracza: start nowego biegu rankingowego na `seed` porzuciłby coś, co jeszcze żyje. `unsent`: szuflada niewysłanego
 * biegu jest pełna; `active`: trwa bieg rankingowy (też taki z innej wersji gry, którego nie da się wznowić). Pytanie zadaje
 * `startRanked` (bez `replace` nic wtedy nie zmienia); odpowiedź „porzuć i zacznij” to `startRanked(seed, { replace: true })`.
 */
export interface RankedStartRequest { seed: string; reason: 'unsent' | 'active' }
export const confirmRankedStart: Signal<RankedStartRequest | null> = signal<RankedStartRequest | null>(null);

/**
 * Gra widziana z interfejsu. Polecenia gracza (stuknięcie, zakup, remont, paczka…) to jedno `dispatch(Command)`: powłoka gry (`createShell` w game/actions.ts)
 * przepuszcza je przez `dispatchCommand` (dziennik, `applyCommand`, dźwięk, zapis, odświeżenie), a wynik wraca tutaj.
 * Reszta to czynności spoza symulacji: powitanie, sieć sklepów, ustawienia, nowy sklep.
 */
export interface GameActions {
  /** Polecenie gracza. Zawsze zwraca wynik; bez gry (sesji) to odmowa z pustym tekstem. */
  dispatch(cmd: Command): CommandResult;
  /** Odbiera nagrodę za nieobecność i premię dzienną z okna powitalnego (nie jest poleceniem: stan zmienia się poza dziennikiem). */
  claimWelcome(): void;
  /** Zamyka obecny sklep (dołącza do sieci) i otwiera nowy z premią. W biegu rankingowym nie ma sieci: komunikat i nic więcej. */
  openNextStore(): void;
  setSound(on: boolean): void;
  setVibration(on: boolean): void;
  /** Zaczyna od nowa w tym samym sklepie (kasuje zapis). W biegu rankingowym odmawia z komunikatem: bieg porzuca się osobno (`abandonRanked`). */
  restart(): void;
  /** „Nowy sklep” z ⚙: otwiera ekran startowy (nick, kasjer, seed). Obecny sklep zostaje zapisany pod swoim seedem. */
  newStore(): void;
  /**
   * Świeży bieg rankingowy na seedzie (po normalizacji, jak przy zwykłym sklepie). Gdy szuflada niewysłanego biegu jest pełna albo trwa
   * bieg rankingowy, a `opts.replace` nie jest ustawione, nic nie zmienia, ustawia `confirmRankedStart` i zwraca false. Zwraca, czy bieg ruszył.
   */
  startRanked(seed: string, opts?: { replace?: boolean }): boolean;
  /** Wraca do aktywnego biegu rankingowego z zapisu. Zwraca, czy się udało (brak biegu, uszkodzony zapis albo zapis z innej wersji gry: false i komunikat). */
  resumeRanked(): boolean;
  /** Wychodzi z biegu rankingowego do ostatniego zwykłego sklepu; bieg zostaje zapisany i da się go wznowić. */
  leaveRanked(): void;
  /** Porzuca aktywny bieg rankingowy (kasuje zapis) i wraca do zwykłej gry; szuflada niewysłanego biegu zostaje. */
  abandonRanked(): void;
  /** Otwiera okno końca sezonu dla niewysłanego biegu (szuflada albo pamięć karty); bez takiego biegu nic nie robi. Otwarte okna nie podmienia. */
  openFinish(): void;
  /** Zapamiętuje nick w mecie gracza po przyjęciu biegu (klucz gracza zostaje). Bez gracza w mecie nic nie robi. */
  rememberNick(nick: string): void;
}

/**
 * Czy otwarte jest okno, które zatrzymuje grę i ma swój sygnał: raport miesiąca, ważne zdarzenie czekające na „OK”, ekran startowy,
 * powitanie, prestiż, „Jak grać” albo okno końca sezonu (`finish`). Czyta to `isModalOpen` (game/frame.ts: pętla klatek) i `hintsHeld`.
 * Karta decyzji i koniec gry nie mają sygnału okna: wynikają ze stanu gry.
 */
export const isWindowOpen = (): boolean =>
  !!report.value || story.value.length > 0 || !!start.value || !!welcome.value || showPrestige.value || howTo.value || !!finish.value;

/**
 * Czy dymki pierwszego dnia mają czekać: pod każdym oknem, które zatrzymuje grę (`isWindowOpen`), pod kartą decyzji, która ją trzyma
 * (zawsze jest jedna w dniu 0), i po końcu gry. Wartość logiczna zmienia się tylko przy otwarciu i zamknięciu okna, więc zegar
 * dymków uzbraja się od nowa dokładnie wtedy, a nie przy każdej publikacji stanu.
 */
const hintsHeld = computed(() => {
  const s = econ.value?.s;
  return isWindowOpen() || (!!s && (s.gameOver || awaitingDecision(s)));
});
hintsHeld.subscribe(armHint);
