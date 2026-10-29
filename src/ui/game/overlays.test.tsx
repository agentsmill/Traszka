import type { VNode } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '@/sim/economy/commands';
import { createEconomy, emptyCounters, type CommandResult, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { EQUIPMENT } from '@/sim/economy/upgrades';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { FATIGUE } from '@/sim/economy/tycoon/fatigue';
import type { CardInstance } from '@/sim/economy/tycoon/cards';
import { hintText, reportCommentText, type TycoonMonthReport } from '@/sim/economy/tycoon/report';
import { trustTier } from '@/sim/economy/tycoon/trust';
import {
  econ, ephemeral, hints, pushStory, report, selection, showHints, showSettings, speed, start, story, tab, welcome, type GameActions,
} from '../state';
import { TrustChip } from './Hud';
import { int, zl } from './format';
import { Bar } from './panels';
import {
  ClickerBar, ComboChip, EPHEMERAL_BADGE, EPHEMERAL_NOTE, FIRST_DAY_HINTS, FirstDayHints, RESTART_CONFIRM, ReportBody, ReportModal,
  STORY_GRACE_MS, SelectionCard, StoreActions, StoreBadge, StoryModal,
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

  it('karta kasy: „Obsłuż klienta” jest nieaktywny bez sił, na pauzie i przy zamkniętym sklepie, a w przeciwnym razie aktywny', () => {
    const { s, info } = base();
    s.queue = 2;
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
  const LINES = ['Marża i inne przychody', 'Premie Centrali', 'Płace', 'Media', 'Opłata franczyzowa', 'Mandaty', 'WUT ponad próg', 'Logistyka'];

  it('premia Centrali ma własny wiersz, a wiersze razem dają wynik miesiąca', () => {
    const r = report(300);
    const v = rows(r);
    expect(v.get('Premie Centrali')).toBe(300);
    const sum = LINES.reduce((n, label) => n + v.get(label)!, 0);
    expect(sum).toBe(r.profit);
    expect(v.get('Wynik miesiąca')).toBe(r.profit);
  });

  it('WUT ponad próg ma własny wiersz jako koszt, a wiersze razem dalej dają wynik miesiąca', () => {
    const r = report(300, 450);
    const v = rows(r);
    expect(v.get('WUT ponad próg')).toBe(-450);
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

/** Raport tycoona: wynik 2 950 zł, zaufanie 62 → 58 (pięć przyczyn), 3 KPI trafione i 1 nietrafione, wskazówka o WUT. */
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
      ['Mandaty i kary', '−100 zł'], ['WUT ponad próg', '−450 zł'], ['Logistyka', '−200 zł'],
    ]);
  });

  it('pozycje „inne” na minusie i zero nie psują znaków (bez „−0”)', () => {
    const d = detailed({ lines: [{ key: 'inne', amount: -300 }, { key: 'premie', amount: 0 }, { key: 'wut', amount: 0 - 0.2 }] });
    const text = plain(textOf(tree(d)));
    expect(text).toContain('Inne przychody i koszty−300 zł');
    expect(text).toContain('Premie Centrali0 zł');
    expect(text).toContain('WUT ponad próg0 zł');
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
    expect(plain(textOf(hint))).toContain('Ubytki ponad próg WUT: 45 000 zł');
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
    expect(rows.slice(0, 2)).toEqual([['Marża ze sprzedaży', z(10_001)], ['WUT ponad próg', `−${z(450)}`]]);
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
    expect(labelsOf).toEqual(['Klienci', 'Obrót', 'Marża i inne przychody', 'Premie Centrali', 'Płace', 'Media', 'Opłata franczyzowa', 'Mandaty', 'WUT ponad próg', 'Logistyka',
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
    expect(textWithBody(tree)).toContain('WUT ponad próg');
    expect(textWithBody(tree)).toContain('Centrala dziękuje za współpracę');
    expect(textWithBody(tree)).not.toContain(reportCommentText('strata-0'));
    expect(labels(tree)).toEqual(['Zacznij od nowa']);
    click(closeButton(tree, 'Zacznij od nowa'));
    expect(game.restart).toHaveBeenCalledTimes(1);
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
