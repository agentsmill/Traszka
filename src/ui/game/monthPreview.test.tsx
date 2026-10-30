import type { ComponentChild } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { DEBT_WARN, createEconomy, type EconomyState } from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import { buildStatement } from '@/sim/economy/franchisee';
import type { MonthPreview } from '@/sim/economy/monthPreview';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { closeMonthPreview, econ, isWindowOpen, monthPreview, openMonthPreview } from '../state';
import { MonthPreviewModal, PREVIEW_ASSUMPTION, previewWarning } from './monthPreview';
import { BUDGET_MS, CHUNK_MINUTES, runMonthPreview, type RunDeps } from './monthPreviewRun';
import { minusZl, money, signedZl, zl } from './format';
import { buttonLabelled, buttonsOf, click, textOf, walk, type Vnode } from './vnodeTree';

function world(): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor('podglad', 0));
  const s = createEconomy('podglad', info);
  s.tycoon.cards.pending = [];
  return { s, info };
}

/** Zegar i planista pod kontrolą testu: `now` rośnie o `step` ms przy każdym odczycie, `later` kolejkuje do ręcznego uruchomienia. */
function fakeDeps(step = 0): RunDeps & { queue: (() => void)[]; reads: number; flush(max?: number): number } {
  const d = {
    queue: [] as (() => void)[], reads: 0, t: 0,
    now(): number { d.reads++; d.t += step; return d.t; },
    later(fn: () => void): void { d.queue.push(fn); },
    flush(max = 1e6): number { let n = 0; while (d.queue.length && n < max) { d.queue.shift()!(); n++; } return n; },
  };
  return d;
}

/** Okno z rozwiniętymi komponentami funkcyjnymi (`walk` ich nie woła): to, co gracz naprawdę zobaczy, także w `PreviewResult`. */
function expand(node: ComponentChild): ComponentChild {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object') return node;
  const v = node as Vnode;
  if (typeof v.type === 'function') return expand((v.type as (p: unknown) => ComponentChild)(v.props));
  return { ...v, props: { ...v.props, children: expand(v.props.children as ComponentChild) } } as Vnode;
}
const shown = (): Vnode => expand(MonthPreviewModal()) as Vnode;

beforeEach(() => { monthPreview.value = null; econ.value = null; });
afterEach(() => { monthPreview.value = null; econ.value = null; vi.useRealTimers(); });

describe('okno rachunku: otwieranie i zatrzymywanie gry', () => {
  it('open/close przełączają sygnał, a otwarte okno zatrzymuje grę (isWindowOpen)', () => {
    expect(isWindowOpen()).toBe(false);
    openMonthPreview();
    expect(monthPreview.value).toEqual({ phase: 'idle' });
    expect(isWindowOpen()).toBe(true);
    closeMonthPreview();
    expect(monthPreview.value).toBeNull();
    expect(isWindowOpen()).toBe(false);
  });

  it('zamknięte albo bez gry nic nie rysuje', () => {
    const { s, info } = world();
    expect(MonthPreviewModal()).toBeNull();
    econ.value = { s, info, v: 1 };
    expect(MonthPreviewModal()).toBeNull();
    monthPreview.value = { phase: 'idle' };
    econ.value = null;
    expect(MonthPreviewModal()).toBeNull();
  });
});

describe('okno rachunku: widok', () => {
  const open = (cash = 10_000, revenue = 100_000): EconomyState => {
    const { s, info } = world();
    s.cash = cash;
    s.month.revenue = revenue;
    s.tycoon.trust.value = 50;
    econ.value = { s, info, v: 1 };
    openMonthPreview();
    return s;
  };

  it('na dziś: saldo, raty, „Zostaje Ci” i gotówka z prognozy; przycisk „Koniec miesiąca” i założenie powiedziane wprost', () => {
    const s = open();
    s.franchisee.month.margin = 8_000;
    s.franchisee.installments.push({ id: 1, label: 'Wózek', price: 1500, fee: 60, total: 1560, monthly: 520, paid: 0, months: 3 });
    const f = forecastMonth(s, econ.value!.info);
    const tree = MonthPreviewModal() as Vnode;
    const text = textOf(shown());
    expect(text).toContain('Wyciąg na koniec miesiąca');
    expect(text).toContain(`Saldo u Centrali${zl(f.saldo)}`);
    expect(f.saldo).toBe(8_000);
    expect(text).toContain(`Raty w tym przelewie${minusZl(f.installments)}`);
    expect(text).toContain(`Zostaje Ci po zamknięciu (prognoza)${signedZl(f.net)}`);
    expect(text).toContain(`Gotówka teraz${money(s.cash)}`);
    expect(text).toContain(`Gotówka po zamknięciu${money(f.cashAfter)}`);
    expect(text).not.toMatch(/Opłata franczyzowa|Do oddania|Wolne środki/);
    expect(text).toContain(PREVIEW_ASSUMPTION);
    expect(PREVIEW_ASSUMPTION).toContain('nic nie robisz');
    expect(PREVIEW_ASSUMPTION).toContain('odpowiedź domyślną');
    expect(buttonsOf(tree).map(textOf)).toEqual(['Koniec miesiąca: policz podgląd', 'Zamknij']);
  });

  it('„Koniec miesiąca” liczy podgląd (running → done), a stan gry zostaje nietknięty', () => {
    vi.useFakeTimers();
    const s = open();
    const before = JSON.stringify(s);
    const view = econ.value;
    click(buttonLabelled(MonthPreviewModal() as Vnode, 'Koniec miesiąca: policz podgląd'));
    expect(monthPreview.value?.phase).toBe('running');
    const running = textOf(MonthPreviewModal() as Vnode);
    expect(running).toMatch(/Liczę: dzień 1 z \d+/);
    expect(buttonsOf(MonthPreviewModal() as Vnode).map(textOf)).toEqual(['Zamknij']);   // w trakcie liczenia nie ma drugiego przycisku
    vi.runAllTimers();
    expect(monthPreview.value?.phase).toBe('done');
    const done = textOf(shown());
    expect(done).toContain('Jeśli nic nie zrobisz');
    for (const label of ['Obrót', 'Klienci', 'Przelew od Centrali', 'Marża', 'Potrącenia', 'Twoje koszty', 'Pensje', 'ZUS', 'VAT', 'Księgowa', 'Media', 'Zostaje Ci',
      'Wynik miesiąca bez rat (do rankingu)', 'Gotówka teraz', 'Gotówka po zamknięciu']) {
      expect(done, label).toContain(label);
    }
    expect(done).not.toMatch(/Opłata franczyzowa|Ubytki ponad limit/);   // opłaty i miesięcznych ubytków już nie ma
    expect(JSON.stringify(s)).toBe(before);
    expect(econ.value).toBe(view);   // sygnał gry ten sam obiekt: podgląd go nie podmienił
  });

  it('wynik to prognozowany wyciąg tym samym widokiem co raport: sumy sekcji i „Zostaje Ci” zgadzają się z `MonthPreview.statement`', () => {
    vi.useFakeTimers();
    open();
    click(buttonLabelled(MonthPreviewModal() as Vnode, 'Koniec miesiąca: policz podgląd'));
    vi.runAllTimers();
    const view = monthPreview.value;
    expect(view?.phase).toBe('done');
    const st = (view as Extract<NonNullable<typeof view>, { phase: 'done' }>).result.statement;
    const text = textOf(shown());
    expect(text).toContain(`Razem${zl(st.transfer)}`);
    expect(text).toContain(`Razem${minusZl(st.deductions)}`);
    expect(text).toContain(`Razem${minusZl(st.costs)}`);
    expect(text).toContain(`Zostaje Ci${signedZl(st.net)}`);
    expect(text).toContain(`Gotówka po zamknięciu${money(st.cashAfter)}`);
    expect(st.net).toBeCloseTo(st.transfer - st.deductions - st.costs, 6);
  });

  it('pokazuje tylko sumy: żadnych kart, fal klientów ani złotych palet w oknie wyniku', () => {
    vi.useFakeTimers();
    open();
    click(buttonLabelled(MonthPreviewModal() as Vnode, 'Koniec miesiąca: policz podgląd'));
    vi.runAllTimers();
    const text = textOf(shown()).toLowerCase();
    expect(text).not.toMatch(/fal[ae]\b|złot[aey] palet|karta dnia|okólnik/);
  });

  it('„Zamknij” zamyka okno i porzuca liczenie w toku', () => {
    vi.useFakeTimers();
    open();
    click(buttonLabelled(MonthPreviewModal() as Vnode, 'Koniec miesiąca: policz podgląd'));
    expect(monthPreview.value?.phase).toBe('running');
    click(buttonLabelled(MonthPreviewModal() as Vnode, 'Zamknij'));
    expect(monthPreview.value).toBeNull();
    vi.runAllTimers();
    expect(monthPreview.value).toBeNull();   // porzucone liczenie nie otwiera okna z powrotem
  });
});

describe('runMonthPreview: porcje i porzucanie', () => {
  it('liczy do końca porcjami, oddając wątek między nimi (każda porcja to osobne `later`)', () => {
    const { s, info } = world();
    const view = { s, info, v: 1 };
    const deps = fakeDeps(BUDGET_MS + 1);   // każdy odczyt zegara „zjada” cały budżet: jedna porcja minut na wywołanie
    runMonthPreview(view, deps);
    expect(monthPreview.value).toMatchObject({ phase: 'running', day: 1 });
    const ticks = deps.flush();
    expect(ticks).toBeGreaterThan(100);   // miesiąc w setkach porcji, nie w jednej
    expect(monthPreview.value?.phase).toBe('done');
  });

  it('budżet czasu: przy szybkim zegarze jedna porcja robi wiele kawałków, przy wolnym jeden', () => {
    const { s, info } = world();
    const fast = fakeDeps(0);
    runMonthPreview({ s, info, v: 1 }, fast);
    const fastTicks = fast.flush();
    const slow = fakeDeps(BUDGET_MS + 1);
    runMonthPreview({ s, info, v: 1 }, slow);
    const slowTicks = slow.flush();
    expect(slowTicks).toBeGreaterThan(fastTicks);
    expect(CHUNK_MINUTES).toBeGreaterThan(0);
  });

  it('kolejne uruchomienie zastępuje poprzednie: stare liczenie się nie dopisuje', () => {
    const { s, info } = world();
    const deps = fakeDeps(BUDGET_MS + 1);
    runMonthPreview({ s, info, v: 1 }, deps);
    const stale = deps.queue.splice(0);
    runMonthPreview({ s, info, v: 1 }, deps);
    const before = monthPreview.value;
    for (const fn of stale) fn();   // stare porcje nic nie robią
    expect(monthPreview.value).toBe(before);
  });

  it('gra skończona albo jej brak: faza „none”', () => {
    runMonthPreview(null, fakeDeps());
    expect(monthPreview.value).toEqual({ phase: 'none' });
    const { s, info } = world();
    s.gameOver = true;
    runMonthPreview({ s, info, v: 1 }, fakeDeps());
    expect(monthPreview.value).toEqual({ phase: 'none' });
  });

  it('nie dotyka niczego poza sygnałem podglądu: stan, opis sklepu i sygnał gry bez zmian', () => {
    const { s, info } = world();
    const view = { s, info, v: 7 };
    econ.value = view;
    const state = JSON.stringify(s);
    const infoJson = JSON.stringify(info);
    const deps = fakeDeps(0);
    runMonthPreview(view, deps);
    deps.flush();
    expect(JSON.stringify(s)).toBe(state);
    expect(JSON.stringify(info)).toBe(infoJson);
    expect(econ.value).toBe(view);
    expect(view.v).toBe(7);
  });
});

describe('previewWarning: czerwone ostrzeżenie z progów gry', () => {
  const statement = buildStatement({
    month: { margin: 0, bonus: 0, pallets: 0, wages: 0, media: 0 }, guarantee: 0, installments: 0, remanent: 0, spent: 0, fines: 0, other: 0, cashBefore: 5_000, partial: false,
  });
  const base: MonthPreview = {
    label: 'wrzesień', cashNow: 5_000, cashAfter: 5_000, lowestCash: 5_000, revenue: 0, customers: 0, statement, profit: 0, gameOver: null, endedEarly: false,
  };

  it('bezpieczna gotówka: bez ostrzeżenia', () => {
    expect(previewWarning(base)).toBeNull();
  });

  it('poniżej DEBT_WARN: ostrzeżenie z kwotą do granicy', () => {
    const w = previewWarning({ ...base, cashAfter: DEBT_WARN - 1, lowestCash: DEBT_WARN - 1 })!;
    expect(w.level).toBe('warn');
    expect(w.text).toContain('Do granicy debetu');
  });

  it('dołek w środku miesiąca pod progiem, ale koniec nad nim: osobne ostrzeżenie o dołku', () => {
    const w = previewWarning({ ...base, lowestCash: DEBT_WARN - 100 })!;
    expect(w.level).toBe('warn');
    expect(w.text).toContain(`spadnie do ${signedZl(DEBT_WARN - 100)}`);
  });

  it('koniec gry z debetu i z zaufania oraz przed zamknięciem miesiąca: „danger”', () => {
    const debt = previewWarning({ ...base, cashAfter: DEBT_LIMIT - 1, lowestCash: DEBT_LIMIT - 1, gameOver: 'debt' })!;
    expect(debt.level).toBe('danger');
    expect(debt.text).toContain(`poniżej granicy debetu (${signedZl(DEBT_LIMIT)})`);
    expect(debt.text).toContain(signedZl(DEBT_LIMIT - 1));
    expect(previewWarning({ ...base, gameOver: 'trust' })!.text).toContain('zaufanie');
    const early = previewWarning({ ...base, gameOver: 'debt', endedEarly: true })!;
    expect(early.level).toBe('danger');
    expect(early.text).toContain('przed zamknięciem miesiąca');
  });

  it('okno z wynikiem wyświetla ostrzeżenie (role=alert) i kolor gotówki po zamknięciu', () => {
    vi.useFakeTimers();
    const { s, info } = world();
    s.cash = 0;
    s.franchisee.month.pallets = 2 * Math.abs(DEBT_LIMIT) + 50_000;   // potrącenia z przelewu głęboko ponad granicę debetu
    econ.value = { s, info, v: 1 };
    openMonthPreview();
    click(buttonLabelled(MonthPreviewModal() as Vnode, 'Koniec miesiąca: policz podgląd'));
    vi.runAllTimers();
    const alert = walk(shown()).find((v) => v.props.role === 'alert')!;
    expect(textOf(alert)).toContain('Centrala wypowie umowę');
    expect(String(alert.props.class)).toContain('danger');
    const free = walk(shown()).filter((v) => String(v.props.class ?? '').startsWith('tt-free'));
    expect(free.length).toBeGreaterThan(0);
    expect(free.map((v) => String(v.props.class))).toContain('tt-free danger');   // gotówka po zamknięciu w wyciągu
  });

  it('gra kończy się przed zamknięciem (debet w środku miesiąca): podgląd mówi, że to naliczenia do tej chwili', () => {
    const { s, info } = world();
    const early = { ...base, endedEarly: true, gameOver: 'debt' as const, cashAfter: DEBT_LIMIT - 1, lowestCash: DEBT_LIMIT - 1, label: '' };
    monthPreview.value = { phase: 'done', result: early, ms: 1 };
    econ.value = { s, info, v: 1 };
    const text = textOf(shown());
    expect(text).toContain('To naliczenia do chwili końca gry');
    expect(text).toContain('Jeśli nic nie zrobisz');
  });
});
