import { describe, expect, it } from 'vitest';
import { firmOf } from '@/game/session';
import { openSecond, partnerSession } from '../../../tests/firmKit';
import { buttonsOf, click, textOf, type Vnode } from '../game/vnodeTree';
import { shortStoreName } from './storeSwitcherModel';
import { StoreTabs } from './StoreTabs';
import { nameOf, resolveTab, storeTabDefs, tabLabel, tabState } from './tabState';

/*
 * Zakładki sklepów: wspólny wybór zakładki (`tabState` + `resolveTab`) dla okna końca miesiąca, remanentu i podglądu. Jedno miejsce na
 * regułę „wybór gracza, o ile zakładka wciąż jest, inaczej domyślna; nowy widok zaczyna od domyślnej”.
 */

describe('resolveTab: wybór zakładki przypięty do widoku', () => {
  const tabs = [{ id: 'siec' as const, label: 'Sieć' }, { id: 1, label: '#1 A' }, { id: 2, label: '#2 B' }];

  it('bez wyboru daje domyślną (domyślnie „Sieć”, a podana ma pierwszeństwo)', () => {
    const state = tabState<object>();
    const view = {};
    expect(resolveTab(state, view, tabs)).toBe('siec');
    expect(resolveTab(state, view, tabs, 2)).toBe(2);
  });

  it('wybór gracza obowiązuje dla tego widoku, a nowy widok zaczyna od domyślnej', () => {
    const state = tabState<object>();
    const view = {};
    state.set(view, 1);
    expect(resolveTab(state, view, tabs)).toBe(1);
    expect(resolveTab(state, {}, tabs)).toBe('siec');
  });

  it('zakładka, której nie ma już na liście (sklep zniknął z widoku), wraca do domyślnej', () => {
    const state = tabState<object>();
    const view = {};
    state.set(view, 9);
    expect(resolveTab(state, view, tabs)).toBe('siec');
    expect(resolveTab(state, view, tabs, 2)).toBe(2);
  });
});

describe('storeTabDefs i nazwy', () => {
  it('„Sieć” i po jednej zakładce na sklep; bez sieci same sklepy; nazwy z firmy, a bez firmy samo „#n”', () => {
    const session = partnerSession();
    openSecond(session);
    const f = firmOf(session);
    expect(storeTabDefs(f, [1, 2]).map((x) => [x.id, x.label])).toEqual([['siec', 'Sieć'], [1, shortStoreName(f, 1)], [2, shortStoreName(f, 2)]]);
    expect(storeTabDefs(f, [2], false)).toEqual([{ id: 2, label: tabLabel(f, 2) }]);
    expect(storeTabDefs(null, [1], false)).toEqual([{ id: 1, label: '#1' }]);
    expect(nameOf(null, 3)).toBe('Traszka #3');
    expect(nameOf(f, 1)).toMatch(/^Traszka #1, \S+/);
  });

  it('StoreTabs oznacza aktywną zakładkę i woła onPick z jej identyfikatorem', () => {
    const picked: unknown[] = [];
    const tree = StoreTabs({ tabs: [{ id: 'siec', label: 'Sieć' }, { id: 2, label: '#2 Lipowa' }], active: 2, onPick: (id) => picked.push(id) }) as Vnode;
    expect(buttonsOf(tree).map((b) => b.props['aria-selected'])).toEqual([false, true]);
    expect(buttonsOf(tree).map(textOf)).toEqual(['Sieć', '#2 Lipowa']);
    click(buttonsOf(tree)[0]!);
    expect(picked).toEqual(['siec']);
  });
});
