import { signal, type Signal } from '@preact/signals';
import type { Speed } from '@/game/loop';
import type { StartChoice, StartForm } from '@/game/start';
import type { CharacterFactory } from '@/render/characters/characterFactory';
import type { QualityPresetId } from '@/render/quality';
import type { TimeOfDay } from '@/render/lighting';
import type { BenchProgress } from '@/bench/bench';
import type { PerfSnapshot } from './perfMeter';
import type { Command } from '@/sim/economy/commands';
import type { CommandResult, EconEventKind, EconomyState, MonthReport } from '@/sim/economy/economy';
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
/** Okno „Jak grać” (`ui/howto/HowTo.tsx`): otwiera się po ekranie startowym i z ⚙, a dopóki jest otwarte, gra stoi (`isModalOpen`). Nie jest częścią zapisu. */
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
  /** Gracz zatwierdził: ekran jest już zamknięty, a podgląd zwolniony (renderer i kontekst WebGL), gra może ruszać. */
  onStart(choice: StartChoice): void;
  /** „Wróć do gry”; tylko w trybie `new`. */
  onBack?(): void;
}
export const start: Signal<StartRequest | null> = signal<StartRequest | null>(null);

/** Ile (ms) widać jedną podpowiedź pierwszego dnia, zanim wejdzie następna. */
export const HINT_MS = 9000;
/** Podpowiedzi pierwszego dnia (krótkie dymki): pierwsza jest widoczna, kolejne wchodzą po kolei. */
export const hints: Signal<string[]> = signal<string[]>([]);
let hintTimer: ReturnType<typeof setTimeout> | undefined;
function armHint(): void {
  clearTimeout(hintTimer);
  hintTimer = hints.value.length > 0 ? setTimeout(nextHint, HINT_MS) : undefined;
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
  /** Zamyka obecny sklep (dołącza do sieci) i otwiera nowy z premią. */
  openNextStore(): void;
  setSound(on: boolean): void;
  setVibration(on: boolean): void;
  /** Zaczyna od nowa w tym samym sklepie (kasuje zapis). */
  restart(): void;
  /** „Nowy sklep” z ⚙: otwiera ekran startowy (nick, kasjer, seed). Obecny sklep zostaje zapisany pod swoim seedem. */
  newStore(): void;
}
