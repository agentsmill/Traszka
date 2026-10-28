import type { VNode } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '@/sim/economy/commands';
import { createEconomy, emptyCounters, type CommandResult, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { EQUIPMENT } from '@/sim/economy/upgrades';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import {
  econ, ephemeral, hints, report, selection, showHints, showSettings, start, tab, welcome, type GameActions,
} from '../state';
import {
  ClickerBar, ComboChip, EPHEMERAL_BADGE, EPHEMERAL_NOTE, FIRST_DAY_HINTS, FirstDayHints, RESTART_CONFIRM, ReportBody, SelectionCard,
  StoreActions, StoreBadge,
} from './overlays';
import { buttonsOf, click, labels, textOf, walk, type Vnode } from './vnodeTree';

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
  it('lista krótkich wskazówek z dawnego okna (cel gry, palety, kolejka, zlecenia, siły, sterowanie), każda krótka i po polsku', () => {
    expect(FIRST_DAY_HINTS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(FIRST_DAY_HINTS).size).toBe(FIRST_DAY_HINTS.length);
    for (const hint of FIRST_DAY_HINTS) {
      expect(hint.length, hint).toBeLessThanOrEqual(120);
      expect(hint, hint).toMatch(/[ąćęłńóśźż]/i);
    }
    const all = FIRST_DAY_HINTS.join(' ').toLowerCase();
    for (const word of ['franczyz', 'palet', 'kolejk', 'cele', 'sił', 'przeciągnij']) expect(all, word).toContain(word);
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

describe('raport miesięczny: pozycje sumują się do wyniku', () => {
  /** Wiersze raportu jako napis → liczba (zł, ze znakiem): „−2 000 zł” to -2000, spacje tysięcy bywają twarde. */
  const rows = (r: MonthReport): Map<string, number> => new Map(
    walk(ReportBody({ r })).filter((v) => String(v.props.class).startsWith('tt-row'))
      .map((v) => [textOf((v.props.children as Vnode[])[0]), textOf((v.props.children as Vnode[])[1])] as const)
      .map(([label, text]) => [label, Number(text.replace(/[\s\u00a0\u202f]|zł/g, '').replace('−', '-').replace('+', '')) || 0]),
  );
  const report = (bonus: number): MonthReport => {
    const counters = { ...emptyCounters(), margin: 10_000, other: 500, bonus, wages: 2000, media: 600, fee: 4500, fines: 100, logistics: 200 };
    return { label: 'wrzesień 2026', counters, profit: 10_000 + bonus + 500 - 2000 - 600 - 4500 - 100 - 200, cash: 5000, comment: 'x' };
  };

  it('premia Centrali ma własny wiersz, a wiersze razem dają wynik miesiąca', () => {
    const r = report(300);
    const v = rows(r);
    expect(v.get('Premie Centrali')).toBe(300);
    const sum = ['Marża i inne przychody', 'Premie Centrali', 'Płace', 'Media', 'Opłata franczyzowa', 'Mandaty', 'Logistyka']
      .reduce((n, label) => n + v.get(label)!, 0);
    expect(sum).toBe(r.profit);
    expect(v.get('Wynik miesiąca')).toBe(r.profit);
  });

  it('raport bez premii (stary zapis) pokazuje zerowy wiersz i też się sumuje', () => {
    const r = report(0);
    const v = rows(r);
    expect(v.get('Premie Centrali')).toBe(0);
    expect(['Marża i inne przychody', 'Płace', 'Media', 'Opłata franczyzowa', 'Mandaty', 'Logistyka'].reduce((n, l) => n + v.get(l)!, 0)).toBe(r.profit);
  });
});
