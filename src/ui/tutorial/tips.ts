import { signal, type Signal } from '@preact/signals';
import { awaitingDecision, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import type { TabId } from '../state';
import { TIP_IDS, markSeen, type TipId, type TutorialMemory } from './memory';
import { MONEY_TIPS } from './money';

/*
 * Dymki „pierwszy raz” (spec samouczka, §5): każdy wyskakuje najwyżej raz na przeglądarkę, przy pierwszym zdarzeniu danego rodzaju,
 * i tylko coś pokazuje (działa też w biegu rankingowym). Warunki to czyste funkcje stanu gry i sygnałów widoku; warstwa
 * (`TipLayer` w `Tutorial.tsx`) bierze pierwszy dymek, którego element jest na ekranie.
 */

/** Co widzą warunki dymków: stan gry, otwarta zakładka i okna, które leżą nad grą. */
export interface TipCtx {
  s: EconomyState;
  tab: TabId | null;
  /** Raport miesiąca na ekranie (`ui.report`). */
  report: MonthReport | null;
  /** Protokół remanentu na ekranie (`ui.remanent`). */
  remanentOpen: boolean;
  /** Wpis czekający na „OK” (`ui.story`). */
  storyOpen: boolean;
  /** Okno, które zasłania grę (`isWindowOpen()`) albo ustawienia. */
  windowOpen: boolean;
  /** Okno wyboru samouczka. */
  offerOpen: boolean;
  /** Warstwa przelotu na ekranie (przelot wstrzymany oknem gry jej nie ma). */
  tourVisible: boolean;
}

export interface TipDef {
  id: TipId;
  /** Dymek wskazuje samo okno gry (karta, wyciąg, protokół) i pokazuje się nad nim; reszta czeka, aż okna znikną. */
  inWindow?: boolean;
  when(ctx: TipCtx): boolean;
  /** Wartości `data-tut` w kolejności: pierwszy element obecny na ekranie dostaje dymek. */
  targets(ctx: TipCtx): string[];
  text(ctx: TipCtx): string;
}

/** Dymek gotowy do pokazania: pierwszy z `targets`, który jest na ekranie, dostaje strzałkę. */
export interface TipCandidate { id: TipId; inWindow: boolean; targets: string[]; text: string }

/** Okno karty jest na ekranie: ten sam warunek co w `CardDesk` (raport, protokół, wpis „OK” i koniec gry ją zasłaniają). */
export const cardShown = (ctx: TipCtx): boolean =>
  visibleCards(ctx.s.tycoon.cards, ctx.s.minute).length > 0 && !ctx.report && !ctx.remanentOpen && !ctx.storyOpen && !ctx.s.gameOver;

export const TIPS: readonly TipDef[] = [
  {
    id: 'tip-cel',
    when: (ctx) => ctx.s.milestonesReady.length > 0,
    targets: (ctx) => (ctx.tab === 'cele' ? ['claim-btn', 'tab-cele'] : ['claim']),
    text: (ctx) => (ctx.tab === 'cele' ? 'Tu „Odbierz”. Centrala lubi, jak się o coś prosi.' : 'Cel spełniony. Nagroda nie przyjdzie sama: stuknij 🎁.'),
  },
  {
    id: 'tip-przejscia',
    when: (ctx) => ctx.s.pallets.some((p) => p.loc === 'aisle'),
    targets: (ctx) => (ctx.tab === 'palety' ? ['pallet-aisle', 'tab-palety'] : ['tab-palety']),
    text: (ctx) => (ctx.tab === 'palety'
      ? 'Rozładuj ją albo przenieś na wolne miejsce. Na przyszłość: mniej palet w zamówieniu.'
      : 'Zabrakło miejsc: palety stoją w przejściach, a klienci się o nie potykają. Zajrzyj do Palet.'),
  },
  {
    id: 'tip-karta',
    inWindow: true,
    when: (ctx) => cardShown(ctx) && ctx.s.history.length === 0,
    targets: () => ['card'],
    text: () => 'Karta decyzji. Gra czeka, aż wybierzesz. Koszty i zyski są na przyciskach, a domyślna odpowiedź jest już zaznaczona.',
  },
];

const ALL: readonly TipDef[] = [...TIPS, ...MONEY_TIPS].sort((a, b) => TIP_IDS.indexOf(a.id) - TIP_IDS.indexOf(b.id));

/**
 * Dymki, które teraz mogą się pokazać, w kolejności z §5: bez wyłączonych podpowiedzi, bez tych, które już były, i nic pod oknem
 * wyboru ani przy widocznym przelocie. Zwykły dymek czeka, gdy grę zasłania okno, karta albo koniec gry; dymek „w oknie” właśnie
 * wtedy się pokazuje.
 */
export function tipsFor(ctx: TipCtx, mem: TutorialMemory): TipCandidate[] {
  if (!mem.tips || ctx.offerOpen || ctx.tourVisible) return [];
  const covered = ctx.windowOpen || awaitingDecision(ctx.s) || ctx.s.gameOver;
  const out: TipCandidate[] = [];
  for (const tip of ALL) {
    if (mem.seen.includes(tip.id) || !tip.when(ctx)) continue;
    if (!tip.inWindow && covered) continue;
    out.push({ id: tip.id, inWindow: !!tip.inWindow, targets: tip.targets(ctx), text: tip.text(ctx) });
  }
  return out;
}

/** Dymek, który właśnie jest na ekranie (albo null). Nie jest częścią zapisu. */
export const shownTip: Signal<TipId | null> = signal<TipId | null>(null);

/**
 * Po każdym przeliczeniu kandydatów: dymek na ekranie, którego zdarzenie się rozwiązało (cel odebrany, okno zamknięte…) albo który
 * zasłonił przelot, trafia do `seen` i znika.
 */
export function settleTips(candidates: readonly TipCandidate[]): void {
  const shown = shownTip.value;
  if (shown && !candidates.some((c) => c.id === shown)) {
    markSeen(shown);
    shownTip.value = null;
  }
}

/** Pokazuje dymek (warstwa woła to, gdy jego element jest na ekranie). */
export function showTip(id: TipId): void {
  if (shownTip.value !== id) shownTip.value = id;
}

/** „OK”: dymek trafia do `seen` i znika. */
export function dismissTip(): void {
  const shown = shownTip.value;
  if (!shown) return;
  markSeen(shown);
  shownTip.value = null;
}
