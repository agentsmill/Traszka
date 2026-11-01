import { afterEach, describe, expect, it } from 'vitest';
import { lang } from '@/i18n';
import { firmOf } from '@/game/session';
import { DEBT_WARN, emptyCounters, type MonthReport } from '@/sim/economy/economy';
import { buildStatement } from '@/sim/economy/franchisee';
import type { NetworkSummary } from '@/sim/firm/types';
import { openSecond, partnerSession } from '../../../tests/firmKit';
import { firm, networkReport, type NetworkReportView } from '../state';
import { minusZl, money, signedZl, zl } from '../game/format';
import { buttonsOf, click, labels, textOf, walk, type Vnode } from '../game/vnodeTree';
import { NetworkReportBody } from './NetworkReport';
import { StoreTabs } from './StoreTabs';
import { shortStoreName } from './storeSwitcherModel';
import { storeName } from './firmText';

/*
 * Okno końca miesiąca przy kilku sklepach (spec §11.5): przełącznik „Sieć / sklep #n”. „Sieć” (data-tut="network-summary") ma
 * „Zostaje Ci” każdego sklepu i razem, pakiety za gotówkę, gotówkę po zamknięciu i wynik każdego sklepu; dalej wyciąg każdego sklepu.
 */

const plain = (s: string): string => s.replace(/[\s  ]/g, ' ');

/** Raport sklepu z wyciągiem; `margin` odróżnia jeden sklep od drugiego. */
function reportOf(label: string, margin: number, wages: number): MonthReport {
  const statement = buildStatement({
    month: { margin, bonus: 0, pallets: 0, wages, media: 0 }, guarantee: 0, installments: 0, remanent: 0, spent: 0, fines: 0, other: 0,
    cashBefore: 10_000, partial: false,
  });
  return { label, counters: { ...emptyCounters(), revenue: margin * 10, customers: 800 }, profit: statement.result, cash: statement.cashAfter, comment: 'x', detail: null, statement };
}

function setup(over: Partial<NetworkSummary> = {}) {
  const session = partnerSession();
  openSecond(session);
  const f = firmOf(session);
  firm.value = { f, v: 1 };
  const one = reportOf('wrzesień 2026', 30_000, 8_000);
  const two = reportOf('wrzesień 2026', 9_000, 12_000);
  const summary: NetworkSummary = {
    label: 'wrzesień 2026', wallet: 123_456, invest: 50_000, settlement: 0, total: one.statement!.net + two.statement!.net,
    stores: [{ id: 1, profit: one.profit, net: one.statement!.net }, { id: 2, profit: two.profit, net: two.statement!.net }], ...over,
  };
  const view: NetworkReportView = { summary, reports: [{ storeId: 1, report: one }, { storeId: 2, report: two }] };
  networkReport.value = view;
  return { f, view, one, two };
}
const render = (view: NetworkReportView): Vnode => NetworkReportBody({ view }) as Vnode;
const withTut = (tree: Vnode, tut: string): Vnode[] => walk(tree).filter((v) => v.props['data-tut'] === tut);
const rowsOf = (tree: Vnode): [string, string][] => walk(tree).filter((v) => String(v.props.class).startsWith('tt-row'))
  .map((v) => [textOf((v.props.children as Vnode[])[0]), plain(textOf((v.props.children as Vnode[])[1]))] as [string, string]);

afterEach(() => { firm.value = null; networkReport.value = null; lang.value = 'pl'; });

describe('podsumowanie sieci (zakładka „Sieć”)', () => {
  it('domyślnie jest na wierzchu i niesie data-tut="network-summary"', () => {
    const { view } = setup();
    const tree = render(view);
    expect(withTut(tree, 'network-summary')).toHaveLength(1);
    expect(labels(tree).slice(0, 3)).toEqual(['Sieć', shortStoreName(firm.value!.f, 1), shortStoreName(firm.value!.f, 2)]);
    expect(buttonsOf(tree)[0]!.props['aria-selected']).toBe(true);
  });

  it('„Zostaje Ci” każdego sklepu i razem', () => {
    const { f, view } = setup();
    const rows = rowsOf(withTut(render(view), 'network-summary')[0]!);
    const net = view.summary.stores.map((s) => s.net);
    expect(rows).toContainEqual([storeName(f, 1), plain(signedZl(net[0]!))]);
    expect(rows).toContainEqual([storeName(f, 2), plain(signedZl(net[1]!))]);
    expect(rows).toContainEqual(['Razem', plain(signedZl(view.summary.total))]);
    expect(net[0]! + net[1]!).toBe(view.summary.total);
  });

  it('pakiety otwarcia za gotówkę, gotówka po zamknięciu i wynik każdego sklepu', () => {
    const { f, view } = setup();
    const rows = rowsOf(withTut(render(view), 'network-summary')[0]!);
    expect(rows).toContainEqual(['Pakiety otwarcia za gotówkę', plain(minusZl(50_000))]);
    expect(rows).toContainEqual(['Gotówka po zamknięciu', plain(money(123_456))]);
    for (const s of view.summary.stores) expect(rows).toContainEqual([storeName(f, s.id), plain(signedZl(s.profit))]);
    const text = plain(textOf(render(view)));
    expect(text.indexOf('Wynik miesiąca')).toBeGreaterThan(-1);
  });

  it('bez pakietów za gotówkę wiersza o nich nie ma', () => {
    const { view } = setup({ invest: 0 });
    expect(rowsOf(render(view)).map(([l]) => l)).not.toContain('Pakiety otwarcia za gotówkę');
  });

  it('rozliczenie końcowe zamkniętej placówki: wiersz między pakietami a gotówką po zamknięciu, a bez rozliczenia go nie ma', () => {
    const { view } = setup({ settlement: 18_500 });
    const labelsInOrder = rowsOf(render(view)).map(([l]) => l);
    expect(rowsOf(render(view))).toContainEqual(['Rozliczenie końcowe zamkniętej placówki', plain(minusZl(18_500))]);
    const at = (l: string): number => labelsInOrder.indexOf(l);
    expect(at('Rozliczenie końcowe zamkniętej placówki')).toBeGreaterThan(at('Razem'));
    expect(at('Rozliczenie końcowe zamkniętej placówki')).toBeLessThan(at('Gotówka po zamknięciu'));
    expect(rowsOf(render(setup({ settlement: 0 }).view)).map(([l]) => l)).not.toContain('Rozliczenie końcowe zamkniętej placówki');
  });

  it('gotówka pod progiem ostrzeżenia: ostrzeżenie z kwotą do granicy debetu', () => {
    const { view } = setup({ wallet: DEBT_WARN - 1_000 });
    const warn = walk(render(view)).filter((v) => v.type === 'p' && String(v.props.class).includes('warn'));
    expect(warn).toHaveLength(1);
    expect(plain(textOf(warn[0]!))).toContain('granicy debetu');
    expect(walk(render(setup().view)).filter((v) => String(v.props.class ?? '').includes('warn') && v.type === 'p')).toHaveLength(0);
  });

  it('po angielsku', () => {
    const { view } = setup({ settlement: 18_500 });
    lang.value = 'en';
    const tree = render(view);
    expect(labels(tree)[0]).toBe('Network');
    const text = plain(textOf(tree));
    expect(text).toContain('Final settlement for the closed branch');
    expect(text).toContain('You keep');
    expect(text).toContain('Cash after closing');
    expect(text).toContain('Opening packages paid in cash');
  });
});

/** Centrala o gwarancji dodatkowego sklepu, słowo w słowo ze specu (§11.2). */
const NO_GUARANTEE = 'Gwarancja przysługuje nowym partnerom. Pan/Pani jest już strategiczny/a.';

describe('sklep dodatkowy nie ma gwarancji: tekst Centrali w jego wyciągu (spec §11.2)', () => {
  const pickTab = (view: NetworkReportView, id: number) => {
    click(buttonsOf(render(view)).find((b) => textOf(b) === shortStoreName(firm.value!.f, id))!);
    return plain(textOf(render(view)));
  };
  const fakeHistory = (f: ReturnType<typeof setup>['f'], n: number): void => {
    f.stores[1]!.econ.history.length = 0;
    for (let i = 0; i < n; i++) f.stores[1]!.econ.history.push({ label: `m${i}`, profit: 0, revenue: 0 });
  };

  it('wyciąg sklepu #2 w pierwszych trzech miesiącach ma tekst Centrali, a sklep startowy i zakładka „Sieć” go nie mają', () => {
    const { view, f } = setup();
    expect(f.stores[1]!.info.site?.extra).toBe(true);
    expect(plain(textOf(render(view)))).not.toContain(NO_GUARANTEE);   // „Sieć”
    expect(pickTab(view, 1)).not.toContain(NO_GUARANTEE);
    const text = pickTab(view, 2);
    expect(text).toContain(NO_GUARANTEE);
    expect(text.indexOf(NO_GUARANTEE)).toBeLessThan(text.indexOf('Potrącenia'));   // w przelewie, tam gdzie byłaby „Dopłata z gwarancji”
    expect(text).not.toContain('Dopłata z gwarancji');
  });

  it('okno gwarancji to trzy raporty: trzeci miesiąc jeszcze ma tekst, czwarty już nie', () => {
    const { view, f } = setup();
    for (const [months, shown] of [[1, true], [2, true], [3, true], [4, false]] as const) {
      fakeHistory(f, months);
      expect(pickTab(view, 2).includes(NO_GUARANTEE), `raport nr ${months}`).toBe(shown);
    }
  });

  it('po angielsku', () => {
    const { view } = setup();
    lang.value = 'en';
    const text = pickTab(view, 2);
    expect(text).toContain('The guarantee is reserved for new partners. You are already a Strategic Partner.');
    expect(text).not.toContain(NO_GUARANTEE);
  });
});

describe('zakładki sklepów', () => {
  it('stuknięcie w zakładkę pokazuje wyciąg tego sklepu (statementView) i chowa podsumowanie', () => {
    const { f, view, one, two } = setup();
    click(buttonsOf(render(view)).find((b) => textOf(b) === shortStoreName(f, 2))!);
    const tree = render(view);
    expect(withTut(tree, 'network-summary')).toHaveLength(0);
    const text = plain(textOf(walk(tree).find((v) => v.props['aria-label'] === 'Wyciąg od Centrali') ?? tree));
    expect(text).toContain('Przelew od Centrali');
    expect(plain(textOf(tree))).toContain(plain(signedZl(two.statement!.net)));
    expect(plain(textOf(tree))).not.toContain(plain(`Zostaje Ci${signedZl(one.statement!.net)}`));
    expect(buttonsOf(tree).map((b) => b.props['aria-selected'])).toEqual([false, false, true]);
  });

  it('wyciąg zakładki zgadza się ze statementView raportu sklepu: te same sumy', () => {
    const { f, view, one } = setup();
    click(buttonsOf(render(view)).find((b) => textOf(b) === shortStoreName(f, 1))!);
    const text = plain(textOf(render(view)));
    const st = one.statement!;
    expect(text).toContain(plain(`Razem${zl(st.transfer)}`));
    expect(text).toContain(plain(`Zostaje Ci${signedZl(st.net)}`));
    expect(text).toContain(storeName(f, 1));
  });

  it('nowy widok okna zaczyna od podsumowania, nie od zakładki poprzedniego', () => {
    const { f, view } = setup();
    click(buttonsOf(render(view)).find((b) => textOf(b) === shortStoreName(f, 2))!);
    expect(withTut(render(view), 'network-summary')).toHaveLength(0);
    const next: NetworkReportView = { ...view, reports: [...view.reports] };
    expect(withTut(render(next), 'network-summary')).toHaveLength(1);
  });

  it('zakładki mają role tab i grupę z nazwą', () => {
    const { view } = setup();
    const tree = render(view);
    const group = walk(tree).find((v) => v.props.role === 'tablist')!;
    expect(group.props['aria-label']).toBe('Sklepy');
    expect(buttonsOf(group).every((b) => b.props.role === 'tab')).toBe(true);
  });

  it('StoreTabs jako samodzielny przełącznik wywołuje onPick z identyfikatorem zakładki', () => {
    const picked: unknown[] = [];
    const tree = StoreTabs({ tabs: [{ id: 'siec', label: 'Sieć' }, { id: 2, label: '#2 Lipowa' }], active: 'siec', onPick: (id) => picked.push(id) }) as Vnode;
    click(buttonsOf(tree)[1]!);
    expect(picked).toEqual([2]);
  });
});
