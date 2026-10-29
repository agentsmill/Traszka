import type { VNode } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import type { Command } from '@/sim/economy/commands';
import { DEBT_WARN, createEconomy, debtWarningText, emptyCounters, type CommandResult, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { EQUIPMENT } from '@/sim/economy/upgrades';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { FATIGUE } from '@/sim/economy/tycoon/fatigue';
import type { CardInstance } from '@/sim/economy/tycoon/cards';
import { hintText, reportCommentText, type TycoonMonthReport } from '@/sim/economy/tycoon/report';
import { trustTier } from '@/sim/economy/tycoon/trust';
import { MemoryStorage } from '@/game/memoryStorage';
import { RANKED_BANKRUPT_TEXT, RANKED_KEYS, createRankedSession, saveFinished, saveRanked, clearFinished, type FinishedRun } from '@/game/rankedRun';
import { newRunLog } from '@/game/session';
import {
  econ, ephemeral, hints, panel, pushStory, ranked, report, selection, showHints, showSettings, speed, start, story, tab, unsent, welcome, type GameActions,
} from '../state';
import { RankingButton, TrustChip } from './Hud';
import { int, zl } from './format';
import { Bar } from './panels';
import { ENERGY_TITLE } from './tapBlock';
import {
  ClickerBar, ComboChip, EPHEMERAL_BADGE, EPHEMERAL_NOTE, FIRST_DAY_HINTS, FirstDayHints, RANKED_NOTE, RESTART_CONFIRM, RankingSettings, ReportBody,
  ReportModal, STORY_GRACE_MS, SelectionCard, StoreActions, StoreBadge, StoryModal, WelcomeModal, abandonQuestion, refreshStoredRun, storedRun,
  storedRunNow, terminationReason,
} from './overlays';
import { buttonLabelled, buttonsOf, click, labels, textOf, walk, type Vnode } from './vnodeTree';

/** Sygnały, które sterują widocznością nakładek, do stanu wyjściowego (nic nie otwarte, brak gry). */
const resetSignals = (): void => {
  ephemeral.value = false;
  ranked.value = null;
  econ.value = null;
  selection.value = null;
  tab.value = null;
  report.value = null;
  welcome.value = null;
  start.value = null;
  showSettings.value = false;
  panel.value = null;
  unsent.value = null;
  speed.value = 1;
  story.value = [];
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

  it('bieg rankingowy: zostaje tylko „Nowy sklep”, a „Zacznij od nowa” znika; tekst mówi dlaczego', () => {
    const onNewStore = vi.fn();
    const onRestart = vi.fn();
    const tree = StoreActions({ ephemeral: false, ranked: true, onNewStore, onRestart });
    expect(labels(tree)).toEqual(['Nowy sklep']);
    expect(textOf(tree)).toContain(RANKED_NOTE);
    expect(textOf(tree)).not.toContain('Zacznij od nowa');
    expect(onRestart).not.toHaveBeenCalled();
    expect(labels(StoreActions({ ephemeral: false, ranked: false, onNewStore, onRestart }))).toEqual(['Nowy sklep', 'Zacznij od nowa']);
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

describe('plakietka biegu rankingowego', () => {
  it('bez biegu rankingowego jej nie ma; w biegu jedna linia „Ranking · dzień N/91”, bez przycisków', () => {
    expect(StoreBadge()).toBeNull();
    ranked.value = { seed: 'kielbasa-42', day: 3, days: 91, phase: 'playing' };
    const badge = StoreBadge() as VNode<Record<string, unknown>>;
    expect(textOf(badge)).toBe('Ranking · dzień 3/91');
    expect(badge.props.role).toBe('status');
    expect(labels(badge)).toEqual([]);

    ranked.value = { seed: 'kielbasa-42', day: 91, days: 91, phase: 'over' };
    expect(textOf(StoreBadge())).toBe('Ranking · dzień 91/91');
    ranked.value = null;
    expect(StoreBadge()).toBeNull();
  });

  it('plakietka sklepu tymczasowego zostaje, gdy bieg i tymczasowość zapalą się razem (osobna linia)', () => {
    ephemeral.value = true;
    ranked.value = { seed: 'kielbasa-42', day: 1, days: 91, phase: 'playing' };
    const text = textOf(StoreBadge());
    expect(text).toContain(EPHEMERAL_BADGE);
    expect(text).toContain('Ranking · dzień 1/91');
  });
});

describe('podpowiedzi pierwszego dnia: dymki zamiast okna powitalnego', () => {
  it('lista krótkich wskazówek z dawnego okna (cel gry, palety, kolejka, KPI tygodnia, siły, sterowanie), każda krótka i po polsku', () => {
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
    startRanked: vi.fn(() => false), resumeRanked: vi.fn(() => false), leaveRanked: vi.fn(), abandonRanked: vi.fn(),
    openFinish: vi.fn(), rememberNick: vi.fn(),
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
    withTaps(30, 16);   // od ostatniego stuknięcia minęło więcej niż COMBO_WINDOW (5 minut gry)
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

  it('karta kasy: „Obsłuż klienta” jest nieaktywny bez sił, na pauzie i przy zamkniętym sklepie, a w przeciwnym razie aktywny', () => {
    const { s, info } = base();
    s.queue = 10;   // kolejka przerasta jednego kasjera, więc stukanie pomaga (`tillTapBlock`)
    publishState(s, info);
    selection.value = { kind: 'till' };
    const till = (): Vnode => buttonsOf(SelectionCard({ game: fakeGame() })).find((b) => textOf(b) === 'Obsłuż klienta')!;
    expect(till().props.disabled).toBe(false);
    speed.value = 0;
    expect(till().props.disabled).toBe(true);
    speed.value = 1;
    s.tycoon.fatigue.energy = 1;
    expect(till().props.disabled).toBe(true);
    expect(till().props.title).toBe('Ręce odmawiają, odpocznij do jutra');
    s.tycoon.fatigue.energy = 100;
    s.minute = 3 * 60;
    expect(till().props.disabled).toBe(true);
  });

  it('kasa nie proponuje stukania, gdy kasjer nadąża: przycisk wyszarzony z krótkim powodem obok (decyzja z 29.10.2026)', () => {
    const { s, info } = base();
    s.queue = 1;
    s.lastCashiers = 1;
    publishState(s, info);
    const till = (): Vnode => buttonsOf(ClickerBar({ game: fakeGame(), onFloat: vi.fn() }))[1]!;
    const note = (): string | undefined => {
      const v = walk(ClickerBar({ game: fakeGame(), onFloat: vi.fn() }) as Vnode).find((x) => x.props.class === 'tt-fab-note');
      return v ? textOf(v) : undefined;
    };
    expect(till().props.disabled).toBe(true);
    expect(note()).toBe('Kasjer nadąża z kolejką');
    s.queue = 10;   // kolejka przerasta kasjera: przycisk działa i nie ma podpisu
    publishState(s, info);
    expect(till().props.disabled).toBe(false);
    expect(note()).toBeUndefined();
    s.queue = 1;
    s.lastCashiers = 0;   // przy kasie nikogo: stukanie pomaga przy każdej kolejce
    publishState(s, info);
    expect(till().props.disabled).toBe(false);
    s.queue = 0;
    publishState(s, info);
    expect(note()).toBe('Nikt nie czeka przy kasie');
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
  const report = (bonus: number, wut = 0): MonthReport => {
    const counters = { ...emptyCounters(), margin: 10_000, other: 500, bonus, wages: 2000, media: 600, fee: 4500, fines: 100, wut, logistics: 200 };
    return { label: 'wrzesień 2026', counters, profit: 10_000 + bonus + 500 - 2000 - 600 - 4500 - 100 - wut - 200, cash: 5000, comment: 'x', detail: null };
  };
  const LINES = ['Marża i inne przychody', 'Premie Centrali', 'Płace', 'Media', 'Opłata franczyzowa', 'Mandaty', 'Ubytki ponad limit Centrali', 'Logistyka'];

  it('premia Centrali ma własny wiersz, a wiersze razem dają wynik miesiąca', () => {
    const r = report(300);
    const v = rows(r);
    expect(v.get('Premie Centrali')).toBe(300);
    const sum = LINES.reduce((n, label) => n + v.get(label)!, 0);
    expect(sum).toBe(r.profit);
    expect(v.get('Wynik miesiąca')).toBe(r.profit);
  });

  it('Ubytki ponad limit Centrali mają własny wiersz jako koszt, a wiersze razem dalej dają wynik miesiąca', () => {
    const r = report(300, 450);
    const v = rows(r);
    expect(v.get('Ubytki ponad limit Centrali')).toBe(-450);
    expect(LINES.reduce((n, label) => n + v.get(label)!, 0)).toBe(r.profit);
    expect(r.profit).toBe(report(300, 0).profit - 450);
  });

  it('raport bez premii (stary zapis) pokazuje zerowy wiersz i też się sumuje', () => {
    const r = report(0);
    const v = rows(r);
    expect(v.get('Premie Centrali')).toBe(0);
    expect(LINES.filter((l) => l !== 'Premie Centrali').reduce((n, l) => n + v.get(l)!, 0)).toBe(r.profit);
  });
});

describe('pasek sił nad przyciskami klikera', () => {
  const withEnergy = (energy: number, queue = 3): { s: EconomyState; info: StoreInfo } => {
    const { s, info } = base();
    s.queue = queue;
    s.tycoon.fatigue.energy = energy;
    publishState(s, info);
    return { s, info };
  };
  const bar = (): Vnode => ClickerBar({ game: fakeGame(), onFloat: vi.fn() }) as Vnode;
  const tapButtons = (tree: Vnode): Vnode[] => buttonsOf(tree);
  const OUT_OF_ENERGY = 'Ręce odmawiają, odpocznij do jutra';

  it('pokazuje siły ze stanu jako „Siły N/100” z paskiem', () => {
    withEnergy(73);
    const tree = bar();
    expect(textOf(tree)).toContain(`Siły 73/${FATIGUE.pool}`);
    const gauge = walk(tree).find((v) => v.type === Bar)!;
    expect(gauge.props.value).toBeCloseTo(0.73);
    withEnergy(41.4);
    expect(textOf(bar())).toContain('Siły 41/100');
    // dymek mówi jednym zdaniem, czym są Siły (to samo zdanie co w „Jak grać”)
    expect(walk(tree).find((v) => v.props?.class === 'tt-energy')!.props.title).toBe(ENERGY_TITLE);
  });

  it('pasek ostrzega poniżej 20 sił, od 20 w górę nie', () => {
    withEnergy(19);
    expect(walk(bar()).find((v) => v.type === Bar)!.props.warn).toBe(true);
    withEnergy(20);
    expect(walk(bar()).find((v) => v.type === Bar)!.props.warn).toBe(false);
  });

  it('przy 1 sile oba przyciski są nieaktywne, z podpowiedzią o odpoczynku', () => {
    withEnergy(1);
    const [pallet, till] = tapButtons(bar());
    for (const b of [pallet!, till!]) {
      expect(b.props.disabled).toBe(true);
      expect(b.props.title).toBe(OUT_OF_ENERGY);
    }
  });

  it('każdy przycisk wymaga siły na swoje stuknięcie: kasa 2, paleta 2,5', () => {
    withEnergy(2.2);   // kasa (koszt 2) jeszcze działa, paleta (koszt 2,5) już nie
    const [pallet, till] = tapButtons(bar());
    expect(till!.props.disabled).toBe(false);
    expect(pallet!.props.disabled).toBe(true);
    expect(pallet!.props.title).toBe(OUT_OF_ENERGY);
    expect(till!.props.title).toBeUndefined();
  });

  it('z pełnymi siłami, otwartym sklepem i kolejką przycisk kasy jest aktywny, a paleta też (są palety)', () => {
    const { s } = withEnergy(100);
    expect(s.pallets.length).toBeGreaterThan(0);
    const [pallet, till] = tapButtons(bar());
    expect(pallet!.props.disabled).toBe(false);
    expect(till!.props.disabled).toBe(false);
  });

  it('bez klienta w kolejce albo przy zamkniętym sklepie kasa jest nieaktywna', () => {
    withEnergy(100, 0);
    expect(tapButtons(bar())[1]!.props.disabled).toBe(true);
    const { s, info } = withEnergy(100, 3);
    s.minute = 3 * 60;   // noc
    publishState(s, info);
    expect(tapButtons(bar())[1]!.props.disabled).toBe(true);
  });

  it('karta „zamknij na godzinę” zamyka kasę (isOpenForCustomers), mimo że godziny są otwarte', () => {
    const { s, info } = withEnergy(100, 3);
    s.tycoon.cards.active.push({ kind: 'closed', value: 1, from: s.minute - 1, until: s.minute + 60, seq: 1 });
    publishState(s, info);
    expect(tapButtons(bar())[1]!.props.disabled).toBe(true);
  });

  it('pauza wyłącza oba przyciski, a ×1 je włącza', () => {
    withEnergy(100);
    speed.value = 0;
    expect(tapButtons(bar()).map((b) => b.props.disabled)).toEqual([true, true]);
    speed.value = 1;
    expect(tapButtons(bar()).map((b) => b.props.disabled)).toEqual([false, false]);
  });

  it('karta czekająca na odpowiedź wyłącza oba przyciski', () => {
    const { s, info } = withEnergy(100);
    s.tycoon.cards.pending.push({ seq: 1, id: 'x', day: 0, showAt: s.minute, params: {}, answers: [], defaultAnswer: 0 } as unknown as CardInstance);
    publishState(s, info);
    expect(tapButtons(bar()).map((b) => b.props.disabled)).toEqual([true, true]);
  });

  it('udane stuknięcie dalej pokazuje dymek (onFloat), a odmowa z pustych sił nic nie rysuje', () => {
    withEnergy(100);
    const onFloat = vi.fn();
    const game = fakeGame({ ok: true, value: 5 });
    click(buttonsOf(ClickerBar({ game, onFloat }))[0]!, { clientX: 3, clientY: 4 });
    expect(onFloat).toHaveBeenCalledWith(3, 4, '+5 szt.', 'work');
  });
});

describe('znaczek zaufania Centrali w pasku u góry', () => {
  it('pokazuje wartość i nazwę progu, a pełny opis w podpowiedzi', () => {
    const chip = TrustChip({ value: 62 }) as Vnode;
    const tier = trustTier(62);
    expect(textOf(chip)).toContain('62');
    expect(textOf(chip)).toContain(tier.label);
    expect(chip.props['aria-label']).toBe(`Zaufanie ${62}: ${tier.label}`);
    expect(String(chip.props.title)).toContain(tier.flavor);
    expect(String(chip.props.title)).toContain('62');
  });

  it('klasa ostrzeżenia tylko poniżej 30', () => {
    expect(String((TrustChip({ value: 29 }) as Vnode).props.class).split(' ')).toContain('warn');
    expect(String((TrustChip({ value: 30 }) as Vnode).props.class).split(' ')).not.toContain('warn');
    expect(String((TrustChip({ value: 85 }) as Vnode).props.class).split(' ')).not.toContain('warn');
  });

  it('wartość jest zaokrąglona do całości', () => {
    expect(textOf(TrustChip({ value: 61.6 }))).toContain('62');
  });
});

// --- Raport miesięczny z danymi tycoona ---------------------------------------------------------------------------

/** Spacje tysięcy bywają twarde (U+00A0, U+202F): do porównań zamieniamy je na zwykłe. */
const plain = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, ' ');
/** Kwota po polsku jak w oknie, spacje zwykłe (pl-PL grupuje dopiero od 5 cyfr: „2950 zł”, ale „10 000 zł”). */
const z = (n: number): string => plain(zl(n));

/** Raport tycoona: wynik 2 950 zł, zaufanie 62 → 58 (pięć przyczyn), 3 KPI trafione i 1 nietrafione, wskazówka o ubytkach. */
function detailed(over: Partial<TycoonMonthReport> = {}): TycoonMonthReport {
  return {
    monthIndex: 0,
    lines: [
      { key: 'marza', amount: 10_000 }, { key: 'premie', amount: 300 }, { key: 'inne', amount: 500 },
      { key: 'place', amount: -2000 }, { key: 'media', amount: -600 }, { key: 'oplata', amount: -4500 },
      { key: 'mandaty', amount: -100 }, { key: 'wut', amount: -450 }, { key: 'logistyka', amount: -200 },
    ],
    result: 2950,
    revenue: 51_000,
    trust: { start: 62, end: 58, delta: -4, reasons: [['mandaty', -4], ['kpi', 3], ['wynik', -2.5], ['audyt', -1], ['inne', 0.5]] },
    cleanlinessAvg: 71,
    kpi: { hit: 3, miss: 1 },
    commentId: 'plus-0',
    hint: { id: 'wut', value: 450, impact: 450 },
    ...over,
  };
}
function monthReport(detail: TycoonMonthReport | null, over: Partial<MonthReport> = {}): MonthReport {
  const counters = { ...emptyCounters(), customers: 3200, lost: 40, revenue: 51_000, investments: 1500 };
  return { label: 'wrzesień 2026', counters, profit: detail?.result ?? 0, cash: 12_345, comment: detail ? reportCommentText(detail.commentId) : 'Stary komentarz.', detail, ...over };
}
/** Element drzewa o danej klasie. */
const byClass = (tree: Vnode, cls: string): Vnode => {
  const found = walk(tree).filter((v) => String(v.props.class ?? '').split(' ').includes(cls));
  if (found.length !== 1) throw new Error(`Elementów .${cls}: ${found.length}, oczekiwano jednego.`);
  return found[0]!;
};

describe('raport miesięczny z danymi tycoona (detail)', () => {
  const tree = (d = detailed(), r = monthReport(d)): Vnode => ReportBody({ r }) as Vnode;

  it('na górze wynik miesiąca dużą liczbą ze znakiem: plus na zielono, minus na czerwono', () => {
    const head = byClass(tree(), 'tt-report-result');
    expect(plain(textOf(head))).toBe(`+${z(2950)}`);
    expect(head.props.class).toContain('pos');
    const loss = detailed({ lines: [{ key: 'oplata', amount: -12_340 }], result: -12_340 });   // nagłówek liczy się z pozycji, więc fixture je zgadza
    const negative = byClass(tree(loss), 'tt-report-result');
    expect(plain(textOf(negative))).toBe('−12 340 zł');
    expect(negative.props.class).toContain('neg');
  });

  it('pozycje z etykietami z REPORT_LINE_LABEL, w kolejności raportu; koszty ze znakiem minus, przychody bez', () => {
    const rows = walk(tree()).filter((v) => v.props.class === 'tt-row')
      .map((v) => [textOf((v.props.children as Vnode[])[0]), plain(textOf((v.props.children as Vnode[])[1]))] as const);
    expect(rows.slice(0, 9)).toEqual([
      ['Marża ze sprzedaży', '10 000 zł'], ['Premie Centrali', '300 zł'], ['Inne przychody i koszty', '500 zł'],
      ['Płace', `−${z(2000)}`], ['Media', '−600 zł'], ['Opłata franczyzowa', `−${z(4500)}`],
      ['Mandaty i kary', '−100 zł'], ['Ubytki ponad limit Centrali', '−450 zł'], ['Logistyka', '−200 zł'],
    ]);
  });

  it('pozycje „inne” na minusie i zero nie psują znaków (bez „−0”)', () => {
    const d = detailed({ lines: [{ key: 'inne', amount: -300 }, { key: 'premie', amount: 0 }, { key: 'wut', amount: 0 - 0.2 }] });
    const text = plain(textOf(tree(d)));
    expect(text).toContain('Inne przychody i koszty−300 zł');
    expect(text).toContain('Premie Centrali0 zł');
    expect(text).toContain('Ubytki ponad limit Centrali0 zł');
    expect(text).not.toContain('−0');
  });

  it('obrót, klienci i gotówka na koniec zostają w raporcie (pod wynikiem)', () => {
    const text = plain(textOf(byClass(tree(), 'tt-report-head')));
    expect(text).toContain('51 000 zł');
    expect(text).toContain(`klienci ${plain(int(3200))}`);
    expect(text).toContain('utraceni: 40');
    expect(text).toContain('12 345 zł');
    expect(text).toContain(`inwestycje: ${z(1500)}`);
  });

  it('zaufanie: „start → koniec” i najwyżej cztery przyczyny z etykietami, ze znakiem i jednym miejscem po przecinku', () => {
    const trust = byClass(tree(), 'tt-report-trust');
    expect(textOf(trust)).toContain('Zaufanie Centrali: 62 → 58');
    const reasons = walk(trust).filter((v) => String(v.props.class).split(' ').includes('tt-reason'))
      .map((v) => [textOf((v.props.children as Vnode[])[0]), textOf((v.props.children as Vnode[])[1])] as const);
    expect(reasons).toEqual([
      ['Mandaty', '−4'], ['KPI tygodnia', '+3'], ['Wynik miesiąca', '−2,5'], ['Audyty i tajemniczy klient', '−1'],
    ]);   // piąta („Inne”) już się nie mieści
    expect(textOf(trust)).not.toContain('Inne');
  });

  it('zaufanie bez zmian w miesiącu: pokazuje to jednym zdaniem zamiast pustej listy', () => {
    const d = detailed({ trust: { start: 70, end: 70, delta: 0, reasons: [] } });
    const trust = byClass(tree(d), 'tt-report-trust');
    expect(textOf(trust)).toContain('Zaufanie Centrali: 70 → 70');
    expect(textOf(trust)).toContain('Bez zmian');
  });

  it('komentarz Centrali z commentId, kursywą (.tt-quote)', () => {
    const quote = byClass(tree(), 'tt-quote');
    expect(textOf(quote)).toContain(reportCommentText('plus-0'));
    expect(textOf(quote)).toContain('Centrala');
  });

  it('wskazówka (hintText z polskim formatowaniem liczb) w wyróżnionym polu', () => {
    const d = detailed({ hint: { id: 'wut', value: 45_000, impact: 45_000 } });
    const hint = byClass(tree(d), 'tt-report-hint');
    expect(textOf(hint)).toContain(hintText(d.hint, int));
    expect(plain(textOf(hint))).toContain('Ubytki ponad limit Centrali: 45 000 zł');
  });

  it('KPI w miesiącu: „X trafione, Y nietrafione”; bez rozliczonego tygodnia osobne zdanie', () => {
    expect(textOf(byClass(tree(), 'tt-report-kpi'))).toBe('KPI tygodnia w miesiącu: 3 trafione, 1 nietrafione');
    const none = byClass(tree(detailed({ kpi: { hit: 0, miss: 0 } })), 'tt-report-kpi');
    expect(textOf(none)).not.toContain('trafione');
    expect(textOf(none)).toContain('KPI tygodnia');
  });

  it('kolejność sekcji: wynik, pozycje, zaufanie, komentarz, wskazówka, KPI', () => {
    const order = ['tt-report-head', 'tt-report-lines', 'tt-report-trust', 'tt-quote', 'tt-report-hint', 'tt-report-kpi'];
    const classes = walk(tree()).map((v) => String(v.props.class ?? '').split(' ')[0]);
    const at = order.map((c) => classes.indexOf(c));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('pozycje razem dają wynik w nagłówku', () => {
    const d = detailed();
    expect(d.lines.reduce((n, l) => n + l.amount, 0)).toBe(d.result);
    expect(plain(textOf(byClass(tree(d), 'tt-report-result')))).toBe(`+${z(2950)}`);
  });

  it('pozycje z groszami: wynik w nagłówku to suma pozycji tak, jak je widać, nie zaokrąglona suma (bez 1 zł różnicy)', () => {
    // 10 000,5 → 10 001 (zaokrąglenie w górę), −450,5 → −450 (połówki w stronę plusa); suma dokładna 9 550, suma widocznych pozycji 9 551
    const d = detailed({ lines: [{ key: 'marza', amount: 10_000.5 }, { key: 'wut', amount: -450.5 }], result: 9550 });
    const rows = walk(tree(d)).filter((v) => v.props.class === 'tt-row')
      .map((v) => [textOf((v.props.children as Vnode[])[0]), plain(textOf((v.props.children as Vnode[])[1]))] as const);
    expect(rows.slice(0, 2)).toEqual([['Marża ze sprzedaży', z(10_001)], ['Ubytki ponad limit Centrali', `−${z(450)}`]]);
    expect(plain(textOf(byClass(tree(d), 'tt-report-result')))).toBe(`+${z(9551)}`);
  });

  it('pozycje z groszami na minusie: wynik ujemny też bierze się z widocznych pozycji', () => {
    // −100,4 → −100, −200,4 → −200: suma widoczna −300, dokładna −300,8 (zaokrąglona −301)
    const d = detailed({ lines: [{ key: 'oplata', amount: -100.4 }, { key: 'media', amount: -200.4 }], result: -300.8 });
    expect(plain(textOf(byClass(tree(d), 'tt-report-result')))).toBe(`−${z(300)}`);
  });

  it('bez porady o zatrudnianiu przy kolejce: wskazówka o kolejce odsyła do profilu i kasy samoobsługowej', () => {
    const d = detailed({ hint: { id: 'kolejka', value: 80, impact: 900 } });
    const text = textOf(byClass(tree(d), 'tt-report-hint'));
    expect(text).not.toMatch(/zatrudni/i);
    expect(text).toContain('Kolejka odstraszyła 80 klientów');
  });

  it('raport bez detail (stary zapis) zostaje dawnym widokiem: te same wiersze, komentarz ze stanu, bez sekcji tycoona', () => {
    const old = tree(undefined, monthReport(null));
    const labelsOf = walk(old).filter((v) => String(v.props.class).startsWith('tt-row')).map((v) => textOf((v.props.children as Vnode[])[0]));
    expect(labelsOf).toEqual(['Klienci', 'Obrót', 'Marża i inne przychody', 'Premie Centrali', 'Płace', 'Media', 'Opłata franczyzowa', 'Mandaty', 'Ubytki ponad limit Centrali', 'Logistyka',
      'Wynik miesiąca', 'Inwestycje', 'Gotówka na koniec']);
    expect(textOf(byClass(old, 'tt-quote'))).toContain('Stary komentarz.');
    expect(walk(old).some((v) => String(v.props.class ?? '').startsWith('tt-report-'))).toBe(false);
  });
});

describe('okno raportu miesiąca', () => {
  const closeButton = (tree: Vnode, label: string): Vnode => buttonsOf(tree).find((b) => textOf(b) === label)!;
  /** Tekst okna razem z treścią raportu (komponent `ReportBody` w drzewie nie jest wołany, więc wołamy go z jego propsami). */
  const textWithBody = (tree: Vnode): string => {
    const body = walk(tree).find((v) => v.type === ReportBody);
    return textOf(tree) + (body ? textOf(ReportBody(body.props as unknown as Parameters<typeof ReportBody>[0])) : '');
  };

  it('„Dalej” zamyka raport (sygnał report) i nie rusza gry', () => {
    report.value = monthReport(detailed());
    const tree = ReportModal({ game: fakeGame() }) as Vnode;
    expect(textOf(tree)).toContain('Raport: wrzesień 2026');
    click(closeButton(tree, 'Dalej'));
    expect(report.value).toBeNull();
  });

  it('bez raportu i bez końca gry nic nie widać', () => {
    expect(ReportModal({ game: fakeGame() })).toBeNull();
  });

  it('koniec gry z danymi tycoona: okno „Koniec współpracy” z pozycjami, bez monetarnego komentarza, z „Zacznij od nowa”', () => {
    const { s, info } = base();
    s.gameOver = true;
    s.lastReport = monthReport(detailed({ result: -9000, commentId: 'strata-0' }));
    publishState(s, info);
    const game = fakeGame();
    const tree = ReportModal({ game }) as Vnode;
    expect(textOf(tree)).toContain('Koniec współpracy');
    expect(textWithBody(tree)).toContain('Ubytki ponad limit Centrali');
    expect(textWithBody(tree)).toContain('Centrala dziękuje za współpracę');
    expect(textWithBody(tree)).not.toContain(reportCommentText('strata-0'));
    expect(labels(tree)).toEqual(['Zacznij od nowa']);
    click(closeButton(tree, 'Zacznij od nowa'));
    expect(game.restart).toHaveBeenCalledTimes(1);
    expect(game.leaveRanked).not.toHaveBeenCalled();
  });

  it('koniec gry w biegu rankingowym: zamiast „Zacznij od nowa” (tu odmawiane) przycisk „Wróć do zwykłej gry”, który wychodzi z biegu', () => {
    const { s, info } = base();
    s.gameOver = true;
    s.lastReport = monthReport(detailed({ result: -9000, commentId: 'strata-0' }));
    publishState(s, info);
    ranked.value = { seed: s.seed, day: 41, days: 91, phase: 'over' };
    const game = fakeGame();
    const tree = ReportModal({ game }) as Vnode;
    expect(textOf(tree)).toContain('Koniec współpracy');
    expect(textWithBody(tree)).toContain('Centrala dziękuje za współpracę');   // treść okna ta sama
    expect(labels(tree)).toEqual(['Wróć do zwykłej gry']);
    click(closeButton(tree, 'Wróć do zwykłej gry'));
    expect(game.leaveRanked).toHaveBeenCalledTimes(1);
    expect(game.restart).not.toHaveBeenCalled();

    ranked.value = null;   // ten sam stan gry w zwykłym sklepie: dawny przycisk i dawna czynność
    const casual = fakeGame();
    const casualTree = ReportModal({ game: casual }) as Vnode;
    expect(labels(casualTree)).toEqual(['Zacznij od nowa']);
    click(closeButton(casualTree, 'Zacznij od nowa'));
    expect(casual.restart).toHaveBeenCalledTimes(1);
    expect(casual.leaveRanked).not.toHaveBeenCalled();
  });

  it('koniec gry w biegu rankingowym: pod powodem jeden akapit (role=note), że bieg nie trafi do rankingu; zwykły sklep i raport miesiąca go nie mają', () => {
    const notes = (tree: Vnode): string[] => walk(tree).filter((v) => v.props.role === 'note' && v.props.class === 'tt-end-reason').map((v) => textOf(v));
    const { s, info } = base();
    s.gameOver = true;
    s.cash = DEBT_LIMIT - 500;
    s.lastReport = monthReport(detailed());
    publishState(s, info);
    ranked.value = { seed: s.seed, day: 41, days: 91, phase: 'over' };
    const tree = ReportModal({ game: fakeGame() }) as Vnode;
    const found = notes(tree);
    expect(found).toHaveLength(2);   // powód końca współpracy i akapit o rankingu, w tej kolejności
    expect(found[0]).toMatch(/^Powód: /);
    expect(found[1]).toBe('Ten bieg nie trafi do rankingu: sezon zakończony bankructwem.');
    expect(found[1]).toBe(RANKED_BANKRUPT_TEXT);
    expect(labels(tree)).toEqual(['Wróć do zwykłej gry']);   // przycisk zostaje

    // zapis sprzed powodu (bez powodu) też mówi o rankingu
    s.cash = 0;
    s.tycoon.trust.value = 50;
    publishState(s, info);
    expect(notes(ReportModal({ game: fakeGame() }) as Vnode)).toEqual([RANKED_BANKRUPT_TEXT]);

    ranked.value = null;   // zwykły sklep: tylko powód
    s.cash = DEBT_LIMIT - 500;
    publishState(s, info);
    expect(notes(ReportModal({ game: fakeGame() }) as Vnode)).toHaveLength(1);
    expect(textOf(ReportModal({ game: fakeGame() }) as Vnode)).not.toContain('rankingu');

    // raport miesiąca w trwającym biegu: bez akapitu
    s.gameOver = false;
    publishState(s, info);
    ranked.value = { seed: s.seed, day: 30, days: 91, phase: 'playing' };
    report.value = monthReport(detailed());
    expect(notes(ReportModal({ game: fakeGame() }) as Vnode)).toEqual([]);
  });

  it('raport miesiąca w biegu rankingowym nadal ma „Dalej” (przycisk wyjścia dotyczy tylko końca współpracy)', () => {
    ranked.value = { seed: 'x', day: 30, days: 91, phase: 'playing' };
    report.value = monthReport(detailed());
    const tree = ReportModal({ game: fakeGame() }) as Vnode;
    expect(labels(tree)).toEqual(['Dalej']);
  });

  it('koniec gry w zapisie sprzed raportu: samo wypowiedzenie umowy', () => {
    const { s, info } = base();
    s.gameOver = true;
    s.lastReport = null;
    publishState(s, info);
    const tree = ReportModal({ game: fakeGame() }) as Vnode;
    expect(textOf(tree)).toContain('Koniec współpracy');
    expect(textWithBody(tree)).toContain('Centrala dziękuje za współpracę');
    expect(labels(tree)).toEqual(['Zacznij od nowa']);
  });

  it('koniec gry z raportem bez detail (stary zapis): dawne wiersze i wypowiedzenie', () => {
    const { s, info } = base();
    s.gameOver = true;
    s.lastReport = monthReport(null);
    publishState(s, info);
    const tree = ReportModal({ game: fakeGame() }) as Vnode;
    expect(textWithBody(tree)).toContain('Gotówka na koniec');
    expect(textWithBody(tree)).toContain('Centrala dziękuje za współpracę');
    expect(textWithBody(tree)).not.toContain('Stary komentarz.');
  });
});

describe('okno końca współpracy podaje powód ze stanu gry', () => {
  const plain = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, ' ');
  const floor = plain(`−${zl(-DEBT_LIMIT)}`);
  /** Gra zakończona; `cash` to gotówka w chwili końca (gra staje w tej minucie), `trust` zaufanie w chwili wypowiedzenia. */
  const ended = (cash: number, trust: number, withReport = true): ReturnType<typeof base> => {
    const b = base();
    b.s.gameOver = true;
    b.s.cash = cash;
    b.s.lastReport = withReport ? monthReport(detailed()) : null;
    b.s.tycoon.trust.value = trust;
    publishState(b.s, b.info);
    return b;
  };
  const modalText = (): string => plain(textOf(ReportModal({ game: fakeGame() })));

  it('debet: gotówka poniżej DEBT_LIMIT, a zaufanie w porządku; kwota granicy ze stałej i gotówka z chwili końca', () => {
    ended(DEBT_LIMIT - 1234, 55);
    expect(modalText()).toContain(`Powód: za duży debet. Gotówka spadła do ${plain(`−${zl(1234 - DEBT_LIMIT)}`)}, poniżej granicy ${floor}`);
    expect(modalText()).not.toContain('zaufanie Centrali spadło do zera');
  });

  it('zaufanie zero: gotówka powyżej granicy', () => {
    ended(DEBT_LIMIT + 5000, 0);
    expect(modalText()).toContain('Powód: zaufanie Centrali spadło do zera.');
    expect(modalText()).not.toContain('debet');
  });

  it('gotówka równa granicy nie jest za dużym debetem (granica jest ostra: poniżej)', () => {
    ended(DEBT_LIMIT, 0);
    expect(modalText()).toContain('Powód: zaufanie Centrali spadło do zera.');
    expect(modalText()).not.toContain('debet');
  });

  it('debet i zaufanie zero naraz: tekst mówi o obu i nie rozstrzyga, które zakończyło umowę', () => {
    ended(DEBT_LIMIT - 10_000, 0);
    expect(modalText()).toContain(`Powód: zaufanie Centrali spadło do zera, a gotówka spadła poniżej granicy debetu ${floor}.`);
  });

  it('powód wynika ze stanu, nie z toastu ani z okna raportu: jest po przeładowaniu (brak sygnału report), także bez raportu w zapisie', () => {
    const { s } = ended(DEBT_LIMIT - 1, 55, false);
    expect(report.value).toBeNull();
    expect(terminationReason(s)).toContain('za duży debet');
    expect(modalText()).toContain('Powód: za duży debet');
  });

  it('zapis bez debetu i bez zera zaufania: samo wypowiedzenie, bez zgadywania powodu', () => {
    const { s } = ended(1000, 55, false);
    expect(terminationReason(s)).toBeNull();
    expect(modalText()).not.toContain('Powód');
  });

  it('zwykły raport miesiąca (gra trwa) nie ma powodu; przy gotówce pod progiem ostrzeżenia mówi, ile zostało do granicy', () => {
    const { s, info } = base();
    s.lastReport = monthReport(detailed(), { cash: DEBT_WARN - 500 });
    publishState(s, info);
    report.value = s.lastReport;
    expect(modalText()).toContain('Raport: wrzesień 2026');
    expect(modalText()).not.toContain('Powód');
    // ostrzeżenie stoi w treści raportu (ReportBody), w obu jego wersjach: ze szczegółami i ze starego zapisu
    const bodyText = (r: MonthReport): string => plain(textOf(ReportBody({ r })));
    expect(bodyText(s.lastReport)).toContain(plain(debtWarningText(DEBT_WARN - 500)));
    expect(bodyText(monthReport(null, { cash: DEBT_WARN - 500 }))).toContain(plain(debtWarningText(DEBT_WARN - 500)));
    expect(bodyText({ ...s.lastReport, cash: DEBT_WARN })).not.toContain('granicy debetu');
  });
});

describe('okno ważnego zdarzenia (StoryModal): gra czeka na „OK”', () => {
  // „OK” przez pierwsze STORY_GRACE_MS po pojawieniu się wpisu nic nie robi (czas rzeczywisty), więc testy sterują zegarem
  beforeEach(() => { vi.useFakeTimers(); });
  const waitGrace = (): void => { vi.advanceTimersByTime(STORY_GRACE_MS); };

  it('bez wpisów nic nie widać', () => {
    expect(StoryModal()).toBeNull();
  });

  it('pokazuje pierwszy wpis: tytuł, tekst (wiersze listy zostają) i jedyny przycisk „OK”', () => {
    pushStory('Poziom 5', 'Nagroda: +500 zł.\n🔓 Ulotki\n🔓 Kasa');
    pushStory('Remont zakończony', 'Sklep otwarty.');
    const tree = StoryModal() as Vnode;
    const dialog = walk(tree).find((v) => v.props.role === 'dialog')!;
    expect(dialog.props['aria-label']).toBe('Poziom 5');
    expect(dialog.props['aria-modal']).toBe('true');
    expect(textOf(walk(tree).find((v) => v.type === 'h2'))).toBe('Poziom 5');
    expect(textOf(byClass(tree, 'tt-story-text'))).toBe('Nagroda: +500 zł.\n🔓 Ulotki\n🔓 Kasa');
    expect(textOf(tree)).not.toContain('Sklep otwarty');
    expect(labels(tree)).toEqual(['OK']);
  });

  it('„OK” zdejmuje wpis: pokazuje się następny, a po ostatnim okno znika', () => {
    pushStory('Zaufanie Centrali', 'Zaufanie Centrali: W porządku.');
    pushStory('Remont zakończony', 'Sklep otwarty.');
    const first = StoryModal() as Vnode;
    waitGrace();
    click(buttonsOf(first)[0]!);
    expect(story.value.map((e) => e.title)).toEqual(['Remont zakończony']);
    const second = StoryModal() as Vnode;
    expect(textOf(second)).toContain('Remont zakończony');
    waitGrace();
    click(buttonsOf(second)[0]!);
    expect(story.value).toEqual([]);
    expect(StoryModal()).toBeNull();
  });

  it('podwójne stuknięcie nie odrzuca nieprzeczytanego drugiego wpisu: „OK” czeka 400 ms od jego pojawienia się', () => {
    pushStory('Zaufanie Centrali', 'Pierwszy.');
    pushStory('Remont zakończony', 'Drugi.');
    const first = StoryModal() as Vnode;
    const ok = buttonsOf(first)[0]!;
    click(ok);   // zbyt wcześnie także dla pierwszego wpisu
    expect(story.value).toHaveLength(2);
    waitGrace();
    click(ok);   // pierwsze stuknięcie zdejmuje pierwszy wpis
    expect(story.value.map((e) => e.title)).toEqual(['Remont zakończony']);
    click(ok);   // drugie stuknięcie w to samo, spóźnione okno nic nie robi
    expect(story.value).toHaveLength(1);
    const second = StoryModal() as Vnode;   // okno odświeża się na drugi wpis
    expect(textOf(second)).toContain('Drugi.');
    vi.advanceTimersByTime(STORY_GRACE_MS - 1);
    click(buttonsOf(second)[0]!);   // tuż przed końcem karencji
    expect(story.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    click(buttonsOf(second)[0]!);   // 400 ms od pojawienia się
    expect(story.value).toEqual([]);
  });

  it('karencja liczy się od pojawienia się wpisu na ekranie, a nie od jego dodania do kolejki', () => {
    pushStory('Zaufanie Centrali', 'Tekst.');
    vi.advanceTimersByTime(5000);   // wpis czekał w kolejce, nikt go jeszcze nie widział
    const tree = StoryModal() as Vnode;
    click(buttonsOf(tree)[0]!);
    expect(story.value).toHaveLength(1);
    waitGrace();
    click(buttonsOf(tree)[0]!);
    expect(story.value).toEqual([]);
  });

  it('wpis zasłonięty raportem dostaje karencję od nowa, gdy raport się zamknie (podwójne „Dalej” nie zdejmie go od razu)', () => {
    pushStory('Zaufanie Centrali', 'Tekst.');
    const before = StoryModal() as Vnode;
    waitGrace();
    report.value = monthReport(detailed());
    expect(StoryModal()).toBeNull();
    vi.advanceTimersByTime(30_000);   // gracz czyta raport
    report.value = null;
    const after = StoryModal() as Vnode;
    click(buttonsOf(after)[0]!);
    expect(story.value).toHaveLength(1);
    click(buttonsOf(before)[0]!);   // stare okno tego samego wpisu liczy się tak samo: karencja trwa
    expect(story.value).toHaveLength(1);
    waitGrace();
    click(buttonsOf(after)[0]!);
    expect(story.value).toEqual([]);
  });

  it('każdy wpis to osobne okno: okno ma key z id wpisu, więc kolejny wpis nie dziedziczy stanu poprzedniego', () => {
    pushStory('Zaufanie Centrali', 'Pierwszy.');
    pushStory('Remont zakończony', 'Drugi.');
    const dialogKey = (tree: Vnode): unknown => walk(tree).find((v) => v.props.role === 'dialog')!.key;
    const first = StoryModal() as Vnode;
    expect(dialogKey(first)).toBe(story.value[0]!.id);
    waitGrace();
    click(buttonsOf(first)[0]!);
    const second = StoryModal() as Vnode;
    expect(dialogKey(second)).toBe(story.value[0]!.id);
    expect(dialogKey(second)).not.toBe(dialogKey(first));
  });

  it('raport miesiąca i koniec gry mają pierwszeństwo: okno czeka za nimi', () => {
    pushStory('Zaufanie Centrali', 'Tekst.');
    report.value = monthReport(detailed());
    expect(StoryModal()).toBeNull();
    report.value = null;
    expect(StoryModal()).not.toBeNull();
    const { s, info } = base();
    s.gameOver = true;
    publishState(s, info);
    expect(StoryModal()).toBeNull();
  });
});

describe('podpowiedź pierwszego dnia o kolejce', () => {
  it('nie radzi zatrudniać: kasa obsługuje najwyżej jedną osobę na stanowisko, więc kolejki nie skróci kolejny pracownik', () => {
    const hint = FIRST_DAY_HINTS.find((h) => h.includes('Kolejka'))!;
    expect(hint).toBeDefined();
    expect(hint).not.toMatch(/zatrudni/i);
    expect(hint).toContain('kasę samoobsługową');
  });
});

describe('„Witaj z powrotem”: wiersz gotówki tylko tam, gdzie jest gotówka', () => {
  it('seria dni to same Ogonki: bez kwoty w złotych, z serią i przyciskiem odbioru', () => {
    welcome.value = { hours: 2, offline: 0, streak: 3, daily: { cash: 0, ogonki: 6 } };
    const game = fakeGame();
    const tree = WelcomeModal({ game }) as Vnode;
    const text = textOf(tree);
    expect(text).toContain('Premia Centrali za 3. dzień z rzędu');
    expect(text).toContain('+6 🦎');
    expect(text).not.toContain('zł');
    expect(text).not.toContain('kierownik zmiany');   // zarobku z nieobecności nie ma, więc i zdania o nim
    click(buttonLabelled(tree, 'Odbierz!'));
    expect(game.claimWelcome).toHaveBeenCalledTimes(1);
  });

  it('zarobek kierownika zmiany ma kwotę, a premia dzienna obok niego dalej tylko Ogonki', () => {
    welcome.value = { hours: 5.5, offline: 1250, streak: 1, daily: { cash: 0, ogonki: 2 } };
    const text = textOf(WelcomeModal({ game: fakeGame() }));
    expect(text).toContain('Przez 5 h Twojej nieobecności kierownik zmiany zarobił');
    expect(text).toContain(`+${zl(1250)}`);
    expect(text).toContain('+2 🦎');
    expect(text.match(/zł/g)).toHaveLength(1);   // jedna kwota: zarobek, nie premia
  });

  it('sam zarobek bez premii dziennej: żadnych Ogonków w oknie', () => {
    welcome.value = { hours: 0.5, offline: 125, streak: null, daily: null };
    const text = textOf(WelcomeModal({ game: fakeGame() }));
    expect(text).toContain('Przez 30 min');
    expect(text).toContain(`+${zl(125)}`);
    expect(text).not.toContain('🦎');
  });

  it('premia z gotówką (zapis okna z innej wersji) nadal pokazuje kwotę przed Ogonkami', () => {
    welcome.value = { hours: 1, offline: 0, streak: 2, daily: { cash: 800, ogonki: 4 } };
    expect(textOf(WelcomeModal({ game: fakeGame() }))).toContain(`+${zl(800)} · +4 🦎`);
  });

  it('bez oferty okna nie ma', () => {
    expect(WelcomeModal({ game: fakeGame() })).toBeNull();
  });
});

describe('⚙: sekcja „Ranking”', () => {
  const gameActions = () => ({ leaveRanked: vi.fn(), resumeRanked: vi.fn(() => true), abandonRanked: vi.fn(), openFinish: vi.fn() });
  function section(over: Partial<Parameters<typeof RankingSettings>[0]> = {}) {
    const game = gameActions();
    const props = { game, stored: null, confirming: false, onConfirming: vi.fn(), onRefresh: vi.fn(), close: vi.fn(), ...over };
    return { game, props, tree: RankingSettings(props) };
  }
  const run = { seed: 'kielbasa-42', day: 12, days: 91, phase: 'playing' as const };

  it('zwykła gra bez biegu: nagłówek „Ranking” i dwa przyciski, nic o biegu ani o niewysłanym wyniku', () => {
    const { tree } = section();
    expect(textOf(walk(tree).find((v) => v.type === 'h3'))).toBe('Ranking');
    expect(labels(tree)).toEqual(['Ranking', 'Kod odzyskiwania i zapis']);
  });

  it('„Ranking” zamyka ustawienia i otwiera panel: „Globalny” w zwykłej grze, „Ten seed” w biegu rankingowym', () => {
    const plain = section();
    click(buttonLabelled(plain.tree, 'Ranking'));
    expect(plain.props.close).toHaveBeenCalledTimes(1);
    expect(panel.value).toEqual({ id: 'ranking', tab: 'global' });

    panel.value = null;
    ranked.value = run;
    const inRun = section();
    click(buttonLabelled(inRun.tree, 'Ranking'));
    expect(inRun.props.close).toHaveBeenCalledTimes(1);
    expect(panel.value).toEqual({ id: 'ranking', tab: 'seed' });
  });

  it('„Kod odzyskiwania i zapis” zamyka ustawienia i otwiera panel kodu', () => {
    const { tree, props } = section();
    click(buttonLabelled(tree, 'Kod odzyskiwania i zapis'));
    expect(props.close).toHaveBeenCalledTimes(1);
    expect(panel.value).toEqual({ id: 'recovery' });
  });

  it('wiersz „Wyślij niewysłany bieg (wynik …)” jest tylko wtedy, gdy szuflada ma bieg; prowadzi do okna wysyłki', () => {
    expect(labels(section().tree).some((l) => l.startsWith('Wyślij'))).toBe(false);
    unsent.value = { seed: 'pierogi-731', score: 12_345 };
    const { tree, game, props } = section();
    const label = `Wyślij niewysłany bieg (wynik ${zl(12_345)})`;
    expect(labels(tree)).toContain(label);
    click(buttonLabelled(tree, label));
    expect(props.close).toHaveBeenCalledTimes(1);
    expect(game.openFinish).toHaveBeenCalledTimes(1);
    expect(panel.value).toBeNull();   // okno wysyłki, nie panel rankingu
    unsent.value = null;
    expect(labels(section().tree).some((l) => l.startsWith('Wyślij'))).toBe(false);
  });

  it('w biegu rankingowym: „Wróć do zwykłej gry” i „Porzuć bieg”, bez „Kontynuuj”', () => {
    ranked.value = run;
    const { tree, game, props } = section();
    expect(labels(tree)).toEqual(['Ranking', 'Kod odzyskiwania i zapis', 'Wróć do zwykłej gry', 'Porzuć bieg']);
    click(buttonLabelled(tree, 'Wróć do zwykłej gry'));
    expect(props.close).toHaveBeenCalledTimes(1);
    expect(game.leaveRanked).toHaveBeenCalledTimes(1);
    expect(game.abandonRanked).not.toHaveBeenCalled();
  });

  it('„Porzuć bieg” nie porzuca od razu, tylko pyta (dwa kroki, bez window.confirm)', () => {
    const confirmDialog = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmDialog);
    ranked.value = run;
    const { tree, game, props } = section();
    click(buttonLabelled(tree, 'Porzuć bieg'));
    expect(props.onConfirming).toHaveBeenCalledWith(true);
    expect(game.abandonRanked).not.toHaveBeenCalled();
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it('pytanie: „Porzucić bieg rankingowy? Dzień N z 91 przepadnie.”, „Porzuć” porzuca i zamyka ustawienia, „Anuluj” wraca', () => {
    ranked.value = run;
    const asking = section({ confirming: true });
    expect(textOf(asking.tree)).toContain('Porzucić bieg rankingowy? Dzień 12 z 91 przepadnie.');
    expect(labels(asking.tree).slice(-2)).toEqual(['Porzuć', 'Anuluj']);
    expect(labels(asking.tree)).not.toContain('Porzuć bieg');   // pytanie zastępuje przyciski biegu
    expect(labels(asking.tree)).not.toContain('Wróć do zwykłej gry');
    click(buttonLabelled(asking.tree, 'Anuluj'));
    expect(asking.props.onConfirming).toHaveBeenLastCalledWith(false);
    expect(asking.game.abandonRanked).not.toHaveBeenCalled();
    expect(asking.props.close).not.toHaveBeenCalled();
    click(buttonLabelled(asking.tree, 'Porzuć'));
    expect(asking.game.abandonRanked).toHaveBeenCalledTimes(1);
    expect(asking.props.onConfirming).toHaveBeenLastCalledWith(false);
    expect(asking.props.close).toHaveBeenCalledTimes(1);
  });

  it('pytanie ma rolę alertu (czytnik ekranu odczyta je od razu)', () => {
    ranked.value = run;
    const alert = walk(section({ confirming: true }).tree).find((v) => v.props?.role === 'alert');
    expect(textOf(alert)).toContain('Porzucić bieg rankingowy?');
  });

  it('poza biegiem, z zapisanym biegiem w przeglądarce: „Kontynuuj bieg rankingowy” i „Porzuć bieg”', () => {
    const { tree, game, props } = section({ stored: { day: 40 } });
    expect(labels(tree)).toEqual(['Ranking', 'Kod odzyskiwania i zapis', 'Kontynuuj bieg rankingowy', 'Porzuć bieg']);
    click(buttonLabelled(tree, 'Kontynuuj bieg rankingowy'));
    expect(game.resumeRanked).toHaveBeenCalledTimes(1);
    expect(props.close).toHaveBeenCalledTimes(1);   // bieg ruszył: ustawienia niepotrzebne
    expect(props.onRefresh).not.toHaveBeenCalled();
    expect(textOf(section({ stored: { day: 40 }, confirming: true }).tree)).toContain('Porzucić bieg rankingowy? Dzień 40 z 91 przepadnie.');
  });

  it('wznowienie, które się nie udało, zostawia ustawienia otwarte (komunikat idzie osobno) i odświeża wiersz', () => {
    const game = { ...gameActions(), resumeRanked: vi.fn(() => false) };
    const { tree, props } = section({ stored: { day: 40 }, game });
    click(buttonLabelled(tree, 'Kontynuuj bieg rankingowy'));
    expect(game.resumeRanked).toHaveBeenCalledTimes(1);
    expect(props.close).not.toHaveBeenCalled();
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('zapisany bieg bez odczytanego dnia (z innej wersji gry): pytanie nie zmyśla dnia', () => {
    const text = textOf(section({ stored: { day: null }, confirming: true }).tree);
    expect(text).toContain('Porzucić bieg rankingowy? Zapisany bieg przepadnie.');
    expect(text).not.toMatch(/Dzień/);
    expect(abandonQuestion(null)).toBe('Porzucić bieg rankingowy? Zapisany bieg przepadnie.');
    expect(abandonQuestion(7)).toBe('Porzucić bieg rankingowy? Dzień 7 z 91 przepadnie.');
  });

  it('bieg na ekranie ma pierwszeństwo przed zapisanym: nie ma „Kontynuuj”, dzień z biegu na ekranie', () => {
    ranked.value = run;
    const { tree } = section({ stored: { day: 40 }, confirming: true });
    expect(labels(tree)).not.toContain('Kontynuuj bieg rankingowy');
    expect(textOf(tree)).toContain('Dzień 12 z 91');
  });

  it('bez paneli (nakładka bez usług rankingu) nie ma przycisków „Ranking” i „Kod odzyskiwania i zapis”, wiersze biegu zostają', () => {
    ranked.value = run;
    unsent.value = { seed: 'pierogi-731', score: 1_000 };
    const text = labels(section({ panels: false }).tree);
    expect(text).not.toContain('Ranking');
    expect(text).not.toContain('Kod odzyskiwania i zapis');
    expect(text).toEqual([`Wyślij niewysłany bieg (wynik ${zl(1_000)})`, 'Wróć do zwykłej gry', 'Porzuć bieg']);
  });

  it('pytanie bez biegu (bieg zniknął, gdy pytanie wisiało): nie pokazuje się, wiersz biegu też nie', () => {
    const { tree } = section({ confirming: true });
    expect(labels(tree)).toEqual(['Ranking', 'Kod odzyskiwania i zapis']);
    expect(textOf(tree)).not.toContain('Porzucić');
  });
});

describe('⚙: zapisany bieg rankingowy w przeglądarce', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    clearFinished();
  });
  afterEach(() => clearFinished());

  const finished = (): FinishedRun => ({
    v: 1, seed: 'kielbasa-42', record: { ...newRunLog('kielbasa-42', 'ranked').record, log: [{ minute: 400, seq: 0, cmd: { type: 'tapTill' } }] }, score: 5_000, finishedAt: 1,
  });
  const saveActive = (days: number): void => {
    const s = createRankedSession('kielbasa-42');
    s.econ.minute += days * 1440;
    expect(saveRanked(s)).toBe(true);
  };

  it('brak zapisu: null (nic do kontynuowania ani porzucania)', () => {
    expect(storedRunNow()).toBeNull();
  });

  it('aktywny zapis: dzień sezonu, w którym stoi bieg (od 1)', () => {
    saveActive(0);
    expect(storedRunNow()).toEqual({ day: 1 });
    saveActive(11);
    expect(storedRunNow()).toEqual({ day: 12 });
  });

  it('zapis z innej wersji gry: bieg jest, ale dnia nie znamy', () => {
    storage.setItem(RANKED_KEYS.active, JSON.stringify({ schema: 999, seed: 'x' }));
    expect(storedRunNow()).toEqual({ day: null });
  });

  it('niewysłany bieg w szufladzie to nie „bieg do kontynuowania” (jego wysyła osobny wiersz)', () => {
    saveFinished(finished());
    expect(storedRunNow()).toBeNull();
  });

  it('sygnał storedRun liczy się raz na otwarcie ustawień, nie przy każdym odczycie', () => {
    saveActive(3);
    const reads = vi.spyOn(storage, 'getItem');
    expect(storedRun.value).toBeNull();   // ustawienia zamknięte: nie czytamy przeglądarki
    expect(reads).not.toHaveBeenCalled();
    showSettings.value = true;
    expect(storedRun.value).toEqual({ day: 4 });
    const afterFirst = reads.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) expect(storedRun.value).toEqual({ day: 4 });
    expect(reads.mock.calls.length).toBe(afterFirst);   // kolejne rendery tego samego otwarcia nie dotykają przeglądarki
    showSettings.value = false;
    expect(storedRun.value).toBeNull();
    saveActive(5);
    showSettings.value = true;
    expect(storedRun.value).toEqual({ day: 6 });        // nowe otwarcie czyta od nowa
  });

  it('odświeżenie (po nieudanym wznowieniu) czyta zapis jeszcze raz', () => {
    saveActive(3);
    showSettings.value = true;
    expect(storedRun.value).toEqual({ day: 4 });
    storage.removeItem(RANKED_KEYS.active);
    expect(storedRun.value).toEqual({ day: 4 });   // bez odświeżenia wiersz jest ten sam
    refreshStoredRun();
    expect(storedRun.value).toBeNull();
  });

  it('w biegu rankingowym zapisu nie czyta wcale (bieg jest na ekranie)', () => {
    saveActive(3);
    ranked.value = { seed: 'kielbasa-42', day: 4, days: 91, phase: 'playing' };
    const reads = vi.spyOn(storage, 'getItem');
    showSettings.value = true;
    expect(storedRun.value).toBeNull();
    expect(reads).not.toHaveBeenCalled();
  });
});

describe('HUD: przycisk 🏆', () => {
  it('ma opis dla czytnika i otwiera ranking: „Globalny” w zwykłej grze, „Ten seed” w biegu rankingowym', () => {
    const tree = RankingButton();
    const trophy = buttonsOf(tree)[0]!;
    expect(textOf(trophy)).toBe('🏆');
    expect(trophy.props['aria-label']).toBe('Ranking');
    click(trophy);
    expect(panel.value).toEqual({ id: 'ranking', tab: 'global' });
    panel.value = null;
    ranked.value = { seed: 'kielbasa-42', day: 3, days: 91, phase: 'playing' };
    click(trophy);
    expect(panel.value).toEqual({ id: 'ranking', tab: 'seed' });
  });
});
