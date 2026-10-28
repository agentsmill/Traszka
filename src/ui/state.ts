import { signal, type Signal } from '@preact/signals';
import type { Speed } from '@/game/loop';
import type { QualityPresetId } from '@/render/quality';
import type { TimeOfDay } from '@/render/lighting';
import type { BenchProgress } from '@/bench/bench';
import type { PerfSnapshot } from './perfMeter';
import type { CommandResult, EconEventKind, EconomyState, MonthReport, Priority } from '@/sim/economy/economy';
import type { PalletLoc, StoreInfo } from '@/sim/economy/storeInfo';
import type { EquipmentId, UpgradeId } from '@/sim/economy/upgrades';

/*
 * Stan widoczny w interfejsie. Zmienia go i przycisk, i klawisz, a czyta interfejs. Sterowanie światem jest w main.ts
 * (obiekt `Controls`), więc jedno wywołanie aktualizuje i świat, i sygnał.
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

/** Akcje, które interfejs wywołuje w grze. Implementuje je main.ts, wspólnie z klawiszami. */
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
export const showIntro: Signal<boolean> = signal(false);

let toastId = 0;
/** Krótki komunikat u góry ekranu; znika sam po kilku sekundach. Najwyżej 2 naraz, ten sam tekst się nie dubluje. */
export function pushToast(text: string, kind: ToastKind = 'info'): void {
  const toast: Toast = { id: ++toastId, text, kind };
  toasts.value = [...toasts.value.filter((t) => t.text !== text).slice(-1), toast];
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t !== toast); }, kind === 'error' ? 2200 : 4000);
}

/** Wielki komunikat nagrody na środku ekranu (nowy poziom). Znika sam. */
export interface Celebration { title: string; subtitle: string; lines: string[] }
export const celebration: Signal<Celebration | null> = signal<Celebration | null>(null);

/** Okno „Witaj z powrotem”: zarobek pod nieobecność i premia za serię dni (do odebrania jednym przyciskiem). */
export interface Welcome { hours: number; offline: number; streak: number | null; daily: { cash: number; ogonki: number } | null }
export const welcome: Signal<Welcome | null> = signal<Welcome | null>(null);

/** Combo stukania: mnożnik i liczba szybkich stuknięć z rzędu (0 = brak). */
export const combo: Signal<{ count: number; mult: number }> = signal({ count: 0, mult: 1 });

/** Sieć sklepów i ustawienia z mety (meta.ts) dla interfejsu. */
export interface MetaView { points: number; stores: number; networkIncome: number; sound: boolean; vibration: boolean }
export const metaView: Signal<MetaView> = signal<MetaView>({ points: 0, stores: 0, networkIncome: 0, sound: true, vibration: true });
export const showPrestige: Signal<boolean> = signal(false);

/** Polecenia gracza w grze. Implementuje je main.ts (zmienia stan ekonomii i odświeża scenę). */
export interface GameActions {
  /** Stuknięcie w paletę (combo liczy main.ts z odstępów między stuknięciami). */
  tapPallet(id?: number): CommandResult;
  tapTill(): CommandResult;
  claimQuest(id: number): CommandResult;
  /** Złapana paczka od Centrali. */
  claimGift(): CommandResult;
  claimWelcome(): void;
  /** Zamyka obecny sklep (dołącza do sieci) i otwiera nowy z premią. */
  openNextStore(): void;
  setSound(on: boolean): void;
  setVibration(on: boolean): void;
  movePallet(id: number, loc: PalletLoc): CommandResult;
  returnPallet(id: number): CommandResult;
  setOrder(auto: boolean, manual?: number): void;
  hire(): CommandResult;
  fire(): CommandResult;
  setPriority(p: Priority): void;
  buyUpgrade(id: UpgradeId): CommandResult;
  buyEquipment(id: EquipmentId, slotId?: string): CommandResult;
  startRemont(): CommandResult;
  campaign(): CommandResult;
  rushRemont(): CommandResult;
  /** Zaczyna od nowa w tym samym sklepie (kasuje zapis). */
  restart(): void;
}
