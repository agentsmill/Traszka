import type { VNode } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GIFT_OPEN } from '@/sim/economy/catalog';
import type { Command } from '@/sim/economy/commands';
import { createEconomy, type CommandResult, type EconomyState } from '@/sim/economy/economy';
import { EQUIPMENT } from '@/sim/economy/upgrades';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import {
  econ, ephemeral, hints, report, selection, showHints, showSettings, start, tab, welcome, type GameActions,
} from '../state';
import {
  ClickerBar, ComboChip, EPHEMERAL_BADGE, EPHEMERAL_NOTE, FIRST_DAY_HINTS, FirstDayHints, GiftDrop, RESTART_CONFIRM, SelectionCard, StoreActions,
  StoreBadge,
} from './overlays';
import { buttonsOf, click, labels, textOf, walk } from './vnodeTree';

/** Sygnały, które sterują widocznością nakładek, do stanu wyjściowego (nic nie otwarte, brak gry). */
const resetSignals = (): void => {
  ephemeral.value = false;
  econ.value = null;
  selection.value = null;
  tab.value = null;
  report.value = null;
  welcome.value = null;
  start.value = null;
  showSettings.value = false;
  showHints([]);
};
beforeEach(resetSignals);
afterEach(() => {
  resetSignals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('⚙: Nowy sklep zamiast „Zacznij od nowa” w sklepie tymczasowym (R46, Minor-4)', () => {
  it('zwykły sklep: „Nowy sklep” (ekran startowy) i „Zacznij od nowa” (kasuje zapis, więc z potwierdzeniem w ⚙)', () => {
    const onNewStore = vi.fn();
    const onRestart = vi.fn();
    const tree = StoreActions({ ephemeral: false, onNewStore, onRestart });
    expect(labels(tree)).toEqual(['Nowy sklep', 'Zacznij od nowa']);
    const [newStore, restart] = buttonsOf(tree);
    (newStore!.props.onClick as () => void)();
    expect(onNewStore).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    (restart!.props.onClick as () => void)();
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).not.toContain('tymczasow');
  });

  it('sklep tymczasowy: zostaje tylko „Nowy sklep”, a tekst nie mówi, że cokolwiek zostanie usunięte', () => {
    const onNewStore = vi.fn();
    const onRestart = vi.fn();
    const tree = StoreActions({ ephemeral: true, onNewStore, onRestart });
    expect(labels(tree)).toEqual(['Nowy sklep']);
    (buttonsOf(tree)[0]!.props.onClick as () => void)();
    expect(onNewStore).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain(EPHEMERAL_NOTE);
    expect(textOf(tree)).not.toMatch(/usunię/i);
    expect(textOf(tree)).not.toContain('Zacznij od nowa');
  });

  it('potwierdzenie „Zacznij od nowa” mówi prawdę o sklepie zwykłym: zapis zostanie usunięty (w tymczasowym tego przycisku nie ma)', () => {
    expect(RESTART_CONFIRM).toBe('Zacząć od nowa w tym sklepie? Zapis zostanie usunięty.');
    expect(EPHEMERAL_NOTE).toMatch(/nie jest zapisywany|nie zapisuje/);
    expect(EPHEMERAL_NOTE).toMatch(/nietknięt/);
  });

  it('ten sam komponent odpowiada na zmianę rodzaju sklepu (bez stanu własnego)', () => {
    const props = { onNewStore: vi.fn(), onRestart: vi.fn() };
    expect(labels(StoreActions({ ...props, ephemeral: false }))).toHaveLength(2);
    expect(labels(StoreActions({ ...props, ephemeral: true }))).toHaveLength(1);
    expect(labels(StoreActions({ ...props, ephemeral: false }))).toHaveLength(2);
  });
});

describe('plakietka sklepu tymczasowego', () => {
  it('sklep zwykły: nic nie widać', () => {
    ephemeral.value = false;
    expect(StoreBadge()).toBeNull();
  });

  it('sklep tymczasowy: stale widoczna plakietka „Sklep tymczasowy: postęp nie jest zapisywany”', () => {
    ephemeral.value = true;
    const badge = StoreBadge() as VNode<Record<string, unknown>>;
    expect(badge).not.toBeNull();
    expect(EPHEMERAL_BADGE).toBe('Sklep tymczasowy: postęp nie jest zapisywany');
    expect(textOf(badge)).toBe(EPHEMERAL_BADGE);
    expect(badge.props.role).toBe('status');
    ephemeral.value = false;
    expect(StoreBadge()).toBeNull();   // wraca do zwykłego sklepu: znika
  });
});

describe('podpowiedzi pierwszego dnia: dymki zamiast okna powitalnego', () => {
  it('lista krótkich wskazówek z dawnego okna (cel gry, palety, kolejka, zlecenia, paczki, sterowanie), każda krótka i po polsku', () => {
    expect(FIRST_DAY_HINTS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(FIRST_DAY_HINTS).size).toBe(FIRST_DAY_HINTS.length);
    for (const hint of FIRST_DAY_HINTS) {
      expect(hint.length, hint).toBeLessThanOrEqual(120);
      expect(hint, hint).toMatch(/[ąćęłńóśźż]/i);
    }
    const all = FIRST_DAY_HINTS.join(' ').toLowerCase();
    for (const word of ['franczyz', 'palet', 'kolejk', 'cele', 'paczk', 'przeciągnij']) expect(all, word).toContain(word);
    expect(FIRST_DAY_HINTS[0]).toContain('Cel');   // najpierw o co chodzi, potem jak grać
  });

  it('bez podpowiedzi nic nie widać; z listą widać pierwszą z przyciskiem „Dalej” (ostatnia: „OK”)', () => {
    expect(FirstDayHints()).toBeNull();
    showHints(['Pierwsza', 'Druga']);
    const first = FirstDayHints();
    expect(textOf(first)).toContain('Pierwsza');
    expect(labels(first)).toEqual(['Dalej']);
    (buttonsOf(first)[0]!.props.onClick as () => void)();
    expect(hints.value).toEqual(['Druga']);
    const last = FirstDayHints();
    expect(textOf(last)).toContain('Druga');
    expect(labels(last)).toEqual(['OK']);
    (buttonsOf(last)[0]!.props.onClick as () => void)();
    expect(hints.value).toEqual([]);
    expect(FirstDayHints()).toBeNull();
  });
});


// --- Polecenia z interfejsu, paczka i combo ze stanu symulacji ---------------------------------------------------

/** Świeża gra na układzie `level` (remont 1 daje sloty na sprzęt), tak jak zaczyna ją sesja. */
function base(level = 0, seed = 'nakladki'): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor(seed, level));
  return { s: createEconomy(seed, info), info };
}
const publishState = (s: EconomyState, info: StoreInfo): void => { econ.value = { s, info, v: 1 }; };

/** Atrapa `GameActions`: tylko `dispatch` coś robi, resztę interfejs w tych testach nie woła. */
function fakeGame(result: CommandResult = { ok: true }): GameActions & { dispatch: ReturnType<typeof vi.fn<(cmd: Command) => CommandResult>> } {
  return {
    dispatch: vi.fn<(cmd: Command) => CommandResult>(() => result),
    claimWelcome: vi.fn(), openNextStore: vi.fn(), setSound: vi.fn(), setVibration: vi.fn(), restart: vi.fn(), newStore: vi.fn(),
  };
}

describe('paczka od Centrali: okno z symulacji, a nie timer interfejsu (L1)', () => {
  const GIFT_AT = 1000;
  /** Stan z oknem paczki otwartym od `GIFT_AT`; `minute` ustawia, gdzie jest zegar gry. */
  const at = (minute: number, giftAt = GIFT_AT): EconomyState => {
    const { s, info } = base();
    s.giftAt = giftAt;
    s.minute = minute;
    publishState(s, info);
    return s;
  };

  it('paczka widoczna tylko w oknie z symulacji', () => {
    const game = fakeGame();
    const shown = (minute: number): boolean => { at(minute); return GiftDrop({ game, onClaim: vi.fn() }) !== null; };
    expect(shown(GIFT_AT - 1)).toBe(false);          // przed oknem
    expect(shown(GIFT_AT)).toBe(true);               // okno otwiera się w minucie giftAt
    expect(shown(GIFT_AT + GIFT_OPEN - 1)).toBe(true);
    expect(shown(GIFT_AT + GIFT_OPEN)).toBe(false);  // okno zamknięte (nieodebrana paczka wygasa)
    econ.value = null;
    expect(GiftDrop({ game, onClaim: vi.fn() })).toBeNull();   // bez gry
    const s = at(GIFT_AT + 1);
    s.gameOver = true;
    expect(GiftDrop({ game, onClaim: vi.fn() })).toBeNull();   // po końcu gry paczek nie ma
  });

  it('nic nie zasłania paczki tylko wtedy, gdy nie ma raportu, ekranu startowego, powitania ani ustawień (jak dotąd)', () => {
    const game = fakeGame();
    at(GIFT_AT + 1);
    expect(GiftDrop({ game, onClaim: vi.fn() })).not.toBeNull();
    report.value = {} as never;
    expect(GiftDrop({ game, onClaim: vi.fn() })).toBeNull();
    report.value = null;
    start.value = {} as never;
    expect(GiftDrop({ game, onClaim: vi.fn() })).toBeNull();
    start.value = null;
    welcome.value = { hours: 1, offline: 0, streak: null, daily: null };
    expect(GiftDrop({ game, onClaim: vi.fn() })).toBeNull();
    welcome.value = null;
    showSettings.value = true;
    expect(GiftDrop({ game, onClaim: vi.fn() })).toBeNull();
    showSettings.value = false;
    expect(GiftDrop({ game, onClaim: vi.fn() })).not.toBeNull();
  });

  it('pozycja jest losowana raz na okno (klucz giftAt), a nowe okno losuje na nowo', () => {
    const game = fakeGame();
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValueOnce(0).mockReturnValueOnce(0);   // lewy górny róg dozwolonego pola: x 20%, y 30%
    at(2000 + 1, 2000);
    const first = GiftDrop({ game, onClaim: vi.fn() }) as VNode<Record<string, unknown>>;
    expect(first.props.style).toEqual({ left: '20%', top: '30%' });
    expect(random).toHaveBeenCalledTimes(2);
    random.mockReturnValue(0.5);   // kolejne renderowanie tego samego okna nie losuje drugi raz
    at(2000 + 50, 2000);
    const again = GiftDrop({ game, onClaim: vi.fn() }) as VNode<Record<string, unknown>>;
    expect(again.props.style).toEqual({ left: '20%', top: '30%' });
    expect(random).toHaveBeenCalledTimes(2);
    at(3000 + 1, 3000);   // następne okno
    const next = GiftDrop({ game, onClaim: vi.fn() }) as VNode<Record<string, unknown>>;
    expect(next.props.style).toEqual({ left: '50%', top: '45%' });
    expect(random).toHaveBeenCalledTimes(4);
  });

  it('klik paczki wysyła claimGift, a onClaim dostaje tekst nagrody w miejscu paczki (w pikselach okna)', () => {
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // x 50%, y 45%
    const game = fakeGame({ ok: true, text: 'Paczka od Centrali: +120 zł' });
    const onClaim = vi.fn();
    at(4000 + 1, 4000);
    const drop = GiftDrop({ game, onClaim }) as VNode<Record<string, unknown>>;
    expect(drop.type).toBe('button');
    click(drop);
    expect(game.dispatch).toHaveBeenCalledTimes(1);
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'claimGift' });
    expect(onClaim).toHaveBeenCalledWith(500, 360, 'Paczka od Centrali: +120 zł');
  });

  it('odmowa przy odbiorze (okno już zamknięte) nie daje napisu z nagrodą', () => {
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
    const game = fakeGame({ ok: false, text: 'Paczki od Centrali już nie ma.' });
    const onClaim = vi.fn();
    at(5000 + 1, 5000);
    click(GiftDrop({ game, onClaim }) as VNode<Record<string, unknown>>);
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'claimGift' });
    expect(onClaim).not.toHaveBeenCalled();
  });

  it('klik już po zamknięciu okna (stan poszedł dalej od ostatniej publikacji): bez polecenia, bez napisu, paczka znika', () => {
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
    const game = fakeGame();
    const onClaim = vi.fn();
    const s = at(6000 + 1, 6000);
    const drop = GiftDrop({ game, onClaim }) as VNode<Record<string, unknown>>;
    expect(drop.type).toBe('button');   // paczka wyrenderowana, okno jeszcze otwarte

    // symulacja przesuwa ten sam obiekt stanu, a interfejs dostaje go dopiero przy następnej publikacji (co najwyżej co 200 ms)
    s.minute = 6000 + GIFT_OPEN;
    click(drop);

    expect(game.dispatch).not.toHaveBeenCalled();   // bez polecenia, więc bez czerwonego toastu i dźwięku błędu
    expect(onClaim).not.toHaveBeenCalled();
    expect(GiftDrop({ game, onClaim })).toBeNull();

    // paczka schowana dla tej sesji i tego okna (zegar cofnięty tylko po to, żeby pokazać, że chowa ją znacznik, a nie sam zegar)...
    s.minute = 6000 + 1;
    expect(GiftDrop({ game, onClaim })).toBeNull();
    // ...ale nie dla nowej gry z tym samym `giftAt` (np. „Zacznij od nowa”: okno wylicza się z seeda)
    at(6000 + 1, 6000);
    expect(GiftDrop({ game, onClaim })).not.toBeNull();
  });

  it('klik w oknie, które jeszcze trwa, nadal wysyła claimGift (stan odczytany w chwili kliknięcia)', () => {
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
    const game = fakeGame({ ok: true, text: 'ok' });
    const onClaim = vi.fn();
    const s = at(7000 + 1, 7000);
    const drop = GiftDrop({ game, onClaim }) as VNode<Record<string, unknown>>;
    s.minute = 7000 + GIFT_OPEN - 1;   // ostatnia minuta okna
    click(drop);
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'claimGift' });
    expect(onClaim).toHaveBeenCalledTimes(1);
  });
});

describe('combo stukania: z tapCombo stanu symulacji, nie z timera interfejsu (L3)', () => {
  const withTaps = (streak: number, minutesAgo: number): void => {
    const { s, info } = base();
    s.minute = 1000;
    s.lastTapAt = 1000 - minutesAgo;
    s.tapStreak = streak;
    publishState(s, info);
  };

  it('combo chip z tapCombo stanu', () => {
    withTaps(8, 3);   // 8 stuknięć w serii: ×3 (co 4 stuknięcia o 1 wyżej)
    const chip = ComboChip() as VNode<Record<string, unknown>>;
    expect(chip.props.class).toBe('tt-combo m3');
    expect(textOf(chip)).toContain('COMBO ×3');
    expect(textOf(walk(chip).find((v) => v.type === 'small'))).toBe('8 stuknięć');
    withTaps(20, 0);   // mnożnik ma sufit ×5
    expect((ComboChip() as VNode<Record<string, unknown>>).props.class).toBe('tt-combo m5');
  });

  it('chip pokazuje się od 3 stuknięć w serii, przy dłuższej przerwie niż okno combo znika, a bez gry nie ma go wcale', () => {
    withTaps(2, 0);
    expect(ComboChip()).toBeNull();
    withTaps(3, 0);
    expect(ComboChip()).not.toBeNull();
    withTaps(30, 16);   // od ostatniego stuknięcia minęło więcej niż COMBO_WINDOW (15 minut gry)
    expect(ComboChip()).toBeNull();
    econ.value = null;
    expect(ComboChip()).toBeNull();
  });
});

describe('przyciski nakładek wysyłają polecenia', () => {
  it('przyciski klikera: paczka bez id (najpilniejsza) i kasa; pływający napis tylko po udanym poleceniu', () => {
    const { s, info } = base();
    s.queue = 3;
    publishState(s, info);
    const onFloat = vi.fn();
    const game = fakeGame({ ok: true, value: 12 });
    const bar = ClickerBar({ game, onFloat });
    const [pallet, till] = buttonsOf(bar);
    click(pallet!, { clientX: 10, clientY: 20 });
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'tapPallet' });
    expect(onFloat).toHaveBeenLastCalledWith(10, 20, '+12 szt.', 'work');
    click(till!, { clientX: 30, clientY: 40 });
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'tapTill' });
    expect(onFloat).toHaveBeenLastCalledWith(30, 40, expect.stringContaining('zł'), 'money');
    const refused = fakeGame({ ok: false, text: 'Brak palet.' });
    onFloat.mockClear();
    click(buttonsOf(ClickerBar({ game: refused, onFloat }))[0]!, { clientX: 1, clientY: 2 });
    expect(refused.dispatch).toHaveBeenCalledWith({ type: 'tapPallet' });
    expect(onFloat).not.toHaveBeenCalled();
  });

  it('karta kasy: „Obsłuż klienta” wysyła tapTill', () => {
    const { s, info } = base();
    publishState(s, info);
    selection.value = { kind: 'till' };
    const game = fakeGame();
    click(buttonsOf(SelectionCard({ game })).find((b) => textOf(b) === 'Obsłuż klienta')!);
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'tapTill' });
  });

  it('karta slotu: zakup sprzętu wysyła buyEquipment z id slotu', () => {
    const { s, info } = base(1);   // po pierwszym remoncie sklep ma sloty
    expect(info.slots.length).toBeGreaterThan(0);
    s.cash = 1e6;
    publishState(s, info);
    const slot = info.slots[0]!;
    selection.value = { kind: 'slot', slotId: slot.id };
    const game = fakeGame();
    const buy = buttonsOf(SelectionCard({ game })).filter((b) => b.props.class === 'tt-btn tt-buy');
    expect(buy.length).toBeGreaterThan(0);
    click(buy[0]!);
    const first = EQUIPMENT.find((e) => e.size <= 2)!;
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'buyEquipment', id: first.id, slotId: slot.id });
  });
});
