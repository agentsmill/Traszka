import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lang } from '@/i18n';
import { dispatchFirm } from '@/game/actions';
import { createSession, firmOf } from '@/game/session';
import { dateText } from '@/i18n';
import { dayOf } from '@/sim/economy/calendar';
import { CATS } from '@/sim/economy/catalog';
import { cardDef } from '@/sim/economy/tycoon/cards';
import { DECK } from '@/sim/economy/tycoon/deck';
import type { FirmCommand, FirmCommandResult } from '@/sim/firm/commands';
import { NO_FX, openSecond, openThird, partnerSession } from '../../../tests/firmKit';
import { firm, isWindowOpen, speed, type GameActions } from '../state';
import { signedZl } from '../game/format';
import { buttonsOf, click, textOf, walk, type Vnode } from '../game/vnodeTree';
import { StoreSwitcher, storeList } from './StoreSwitcher';
import { storeMinis } from './storeSwitcherModel';
import { storeName } from './firmText';

/*
 * Chip sklepu w górnym pasku (spec §9.4): jest tylko przy dwóch otwartych sklepach, otwiera listę z mini-stanem i skrzynką zastępcy,
 * a wybór sklepu z listy wysyła `switchStore`. Komponent bez haków, więc wołamy go jak funkcję i oglądamy drzewo vnode.
 */

function fakeGame(result: FirmCommandResult = { ok: true }): GameActions & { firm: ReturnType<typeof vi.fn<(cmd: FirmCommand) => FirmCommandResult>> } {
  return { firm: vi.fn<(cmd: FirmCommand) => FirmCommandResult>(() => result) } as unknown as GameActions & { firm: ReturnType<typeof vi.fn<(cmd: FirmCommand) => FirmCommandResult>> };
}

function setup() {
  const session = partnerSession();
  openSecond(session);
  const f = firmOf(session);
  firm.value = { f, v: 1 };
  return { session, f };
}
/** Trzy otwarte sklepy (limit 4a.2). */
function setupThree() {
  const session = partnerSession();
  openSecond(session);
  openThird(session);
  const f = firmOf(session);
  firm.value = { f, v: 1 };
  return { session, f };
}
const render = (game: GameActions = fakeGame()): Vnode | null => StoreSwitcher({ game }) as Vnode | null;
const byTut = (tree: Vnode, tut: string): Vnode => {
  const found = walk(tree).filter((v) => v.props['data-tut'] === tut);
  if (found.length !== 1) throw new Error(`Elementów data-tut="${tut}": ${found.length}, oczekiwano jednego.`);
  return found[0]!;
};
const withClass = (tree: Vnode, cls: string): Vnode[] => walk(tree).filter((v) => String(v.props.class ?? '').split(' ').includes(cls));
const rows = (tree: Vnode): Vnode[] => withClass(tree, 'tt-store-row');
const plain = (s: string): string => s.replace(/[\s  ]/g, ' ');

/** Paleta w przejściu w danym sklepie: istniejącej zmienia miejsce, a gdy sklep nie ma żadnej, dostawia kopię palety z innego sklepu. */
function putInAisle(f: ReturnType<typeof firmOf>, storeId: number): void {
  const econ = f.stores.find((st) => st.id === storeId)!.econ;
  if (econ.pallets.length === 0) econ.pallets.push({ ...structuredClone(f.stores.find((st) => st.econ.pallets.length > 0)!.econ.pallets[0]!), id: 9_000 + storeId });
  econ.pallets[0]!.loc = 'aisle';
}

beforeEach(() => { storeList.value = false; });
afterEach(() => { firm.value = null; storeList.value = false; speed.value = 1; lang.value = 'pl'; });

describe('chip sklepu w pasku', () => {
  it('przy jednym sklepie chipa nie ma, a bez firmy też nie', () => {
    expect(render()).toBeNull();
    firm.value = { f: firmOf(createSession('kiełbasa-42', true)), v: 1 };
    expect(render()).toBeNull();
  });

  it('przy jednym otwartym sklepie (drugi zamknięty) nie ma przełączania, więc chipa też nie ma', () => {
    const { f } = setup();
    f.stores[0]!.closed = true;
    f.activeId = 2;
    expect(render()).toBeNull();
  });

  it('przy dwóch sklepach: przycisk data-tut="store-switch" z nazwą aktywnego sklepu („Traszka #1, Ogrodowa”)', () => {
    const { f } = setup();
    const tree = render()!;
    const chip = byTut(tree, 'store-switch');
    expect(chip.type).toBe('button');
    expect(textOf(chip)).toContain(storeName(f, 1));
    expect(textOf(chip)).toMatch(/^Traszka #1, \S+/);
    expect(chip.props['aria-expanded']).toBe(false);
    f.activeId = 2;
    expect(textOf(byTut(render()!, 'store-switch'))).toContain(storeName(f, 2));
  });

  it('lista jest zamknięta, dopóki gracz nie stuknie w chip; stuknięcie otwiera ją, drugie zamyka', () => {
    setup();
    expect(rows(render()!)).toHaveLength(0);
    click(byTut(render()!, 'store-switch'));
    expect(storeList.value).toBe(true);
    expect(rows(render()!)).toHaveLength(2);
    expect(byTut(render()!, 'store-switch').props['aria-expanded']).toBe(true);
    click(byTut(render()!, 'store-switch'));
    expect(storeList.value).toBe(false);
    expect(rows(render()!)).toHaveLength(0);
  });

  it('lista nie zatrzymuje gry: to nie jest okno', () => {
    setup();
    storeList.value = true;
    expect(isWindowOpen()).toBe(false);
  });

  it('chip świeci znakiem, gdy sklep w tle ma ostrzeżenie; aktywny sklep go nie zapala', () => {
    const { f } = setup();
    expect(withClass(render()!, 'tt-stores-alert')).toHaveLength(0);
    putInAisle(f, 1);   // aktywny sklep: widać go na ekranie
    expect(withClass(render()!, 'tt-stores-alert')).toHaveLength(0);
    putInAisle(f, 2);
    expect(withClass(render()!, 'tt-stores-alert')).toHaveLength(1);
  });
});

describe('lista sklepów z mini-stanem', () => {
  it('każdy sklep ma wiersz: nazwa, dziś, „Zostanie”, zaufanie; aktywny jest oznaczony', () => {
    const { f } = setup();
    f.stores[1]!.econ.today.margin = 1200;
    f.stores[1]!.econ.tycoon.trust.value = 62;
    storeList.value = true;
    const tree = render()!;
    const list = rows(tree);
    expect(list).toHaveLength(2);
    const minis = storeMinis(f);
    minis.forEach((m, i) => {
      const text = plain(textOf(list[i]!));
      expect(text, `sklep ${m.id}`).toContain(storeName(f, m.id));
      expect(text).toContain(plain(`Dziś ${signedZl(m.todayProfit)}`));
      expect(text).toContain(plain(`Zostanie ${signedZl(m.net)}`));
      expect(text).toContain(`🤝 ${Math.round(m.trust)}`);
    });
    expect(list.map((r) => r.props['aria-current'])).toEqual(['true', undefined]);
    expect(list[1]!.props.disabled).toBeFalsy();
  });

  it('znaki ostrzegawcze: paleta w przejściu, pusta półka i karta rozstrzygnięta przez zastępcę (każdy z własnym data-warn)', () => {
    const { f } = setup();
    storeList.value = true;
    const warnsOf = (i: number): string[] => walk(rows(render()!)[i]!).filter((v) => v.props['data-warn']).map((v) => String(v.props['data-warn']));
    expect(warnsOf(1)).toEqual([]);
    putInAisle(f, 2);
    f.stores[1]!.econ.shelf[CATS[0]!] = 0;
    f.inbox.push({ day: dayOf(f.stores[1]!.econ.minute), storeId: 2, card: DECK[0]!.id, answer: 0 });
    expect(warnsOf(1)).toEqual(['paleta', 'polka', 'zastepca']);
    expect(warnsOf(0)).toEqual([]);
    const text = plain(textOf(rows(render()!)[1]!));
    expect(text).toContain('paleta w przejściu');
    expect(text).toContain('pusta półka');
    expect(text).toContain('zastępca odpowiedział na kartę');
  });

  it('zaufanie poniżej 40 w tle: chip świeci znakiem, a wiersz sklepu mówi, ile ma i jaki to próg', () => {
    const { f } = setup();
    f.stores[1]!.econ.tycoon.trust.value = 32;
    expect(withClass(render()!, 'tt-stores-alert')).toHaveLength(1);
    storeList.value = true;
    const row2 = rows(render()!)[1]!;
    expect(plain(textOf(row2))).toContain('⚠ zaufanie 32 (Na cenzurowanym)');
    expect(walk(row2).filter((v) => v.props['data-warn'] === 'zaufanie')).toHaveLength(1);
  });

  it('po angielsku: ostrzeżenie o zaufaniu z tą samą etykietą progu co w grze', () => {
    const { f } = setup();
    f.stores[1]!.econ.tycoon.trust.value = 32;
    lang.value = 'en';
    storeList.value = true;
    expect(plain(textOf(rows(render()!)[1]!))).toContain('⚠ trust 32 (In the Bad Books)');
  });

  it('sklep z wypowiedzeniem mówi, do kiedy działa; zamknięty jest wyłączony i opisany', () => {
    const { f } = setup();
    f.stores[1]!.notice = { endDay: 120 };
    storeList.value = true;
    expect(plain(textOf(rows(render()!)[1]!))).toContain(plain(`umowa wygasa ${dateText(120)}`));
    f.stores.push({ ...f.stores[1]!, id: 3, closed: true });   // trzeci sklep, zamknięty przez Centralę: dwa otwarte wciąż dają chip
    const closed = rows(render()!);
    expect(closed).toHaveLength(3);   // zamknięty zostaje na liście
    expect(closed[2]!.props.disabled).toBe(true);
    expect(plain(textOf(closed[2]!))).toContain('zamknięta');
    expect(plain(textOf(closed[2]!))).not.toContain('Zostanie');   // zamknięty nie ma prognozy
  });

  it('skrzynka zastępcy: najnowsze wpisy z nazwą sklepu i odpowiedzią; pusta mówi, że zastępca jeszcze nic nie rozstrzygał', () => {
    const { f } = setup();
    storeList.value = true;
    expect(plain(textOf(render()!))).toContain('Zastępca jeszcze niczego nie rozstrzygał.');
    const card = DECK.find((c) => c.answers.length >= 2)!;
    f.inbox.push({ day: 40, storeId: 2, card: card.id, answer: 1 }, { day: 41, storeId: 2, card: card.id, answer: 0 });
    const entries = withClass(render()!, 'tt-inbox-row');
    expect(entries).toHaveLength(2);
    expect(plain(textOf(entries[0]!))).toContain(dateText(41));   // najnowszy pierwszy
    expect(plain(textOf(entries[0]!))).toContain(`${storeName(f, 2)}: zastępca wybrał: ${cardDef(card.id)!.answers[0]!.label}`);
    expect(plain(textOf(entries[1]!))).toContain(dateText(40));
    expect(plain(textOf(render()!))).not.toContain('Zastępca jeszcze niczego');
  });

  it('skrzynka pokazuje najwyżej kilka najnowszych wpisów', () => {
    const { f } = setup();
    storeList.value = true;
    for (let i = 0; i < 12; i++) f.inbox.push({ day: i, storeId: 2, card: DECK[0]!.id, answer: 0 });
    const entries = withClass(render()!, 'tt-inbox-row');
    expect(entries.length).toBeLessThan(12);
    expect(plain(textOf(entries[0]!))).toContain(dateText(11));
  });

  it('po angielsku: napisy listy i skrzynki', () => {
    const { f } = setup();
    lang.value = 'en';
    storeList.value = true;
    putInAisle(f, 2);
    const text = plain(textOf(render()!));
    expect(text).toContain('Today');
    expect(text).toContain('You’ll keep');
    expect(text).toContain('pallet in the aisle');
    expect(text).toContain('The deputy has not settled anything yet.');
  });
});

describe('przełączanie z listy', () => {
  it('wiersz nieaktywnego sklepu wysyła switchStore i zamyka listę', () => {
    setup();
    storeList.value = true;
    const game = fakeGame();
    click(buttonsOf(render(game)!).find((b) => String(b.props.class).includes('tt-store-row') && !b.props['aria-current'])!);
    expect(game.firm).toHaveBeenCalledTimes(1);
    expect(game.firm).toHaveBeenCalledWith({ type: 'switchStore', storeId: 2 });
    expect(storeList.value).toBe(false);
  });

  it('wiersz aktywnego sklepu nic nie wysyła, tylko zamyka listę', () => {
    setup();
    storeList.value = true;
    const game = fakeGame();
    click(rows(render(game)!)[0]!);
    expect(game.firm).not.toHaveBeenCalled();
    expect(storeList.value).toBe(false);
  });

  it('zamknięty sklep nie jest przełączalny', () => {
    const { f } = setup();
    f.stores.push({ ...f.stores[1]!, id: 3, closed: true });
    storeList.value = true;
    const game = fakeGame();
    click(rows(render(game)!)[2]!);
    expect(game.firm).not.toHaveBeenCalled();
  });

  it('w pauzie też przełącza: sesja idzie za nowym aktywnym sklepem bez udziału zegara', () => {
    const { session, f } = setup();
    speed.value = 0;
    storeList.value = true;
    const minuteBefore = f.stores[0]!.econ.minute;
    const game = { firm: (cmd: FirmCommand) => dispatchFirm(session, cmd, NO_FX) } as unknown as GameActions;
    click(rows(render(game)!)[1]!);
    expect(f.activeId).toBe(2);
    expect(session.econ).toBe(f.stores[1]!.econ);
    expect(f.stores[0]!.econ.minute).toBe(minuteBefore);   // nic się nie przesunęło
    expect(textOf(byTut(render(game)!, 'store-switch'))).toContain(storeName(f, 2));
  });

  it('backdrop zamyka listę bez przełączania', () => {
    setup();
    storeList.value = true;
    const game = fakeGame();
    const backdrop = withClass(render(game)!, 'tt-stores-backdrop')[0]!;
    (backdrop.props.onClick as () => void)();
    expect(storeList.value).toBe(false);
    expect(game.firm).not.toHaveBeenCalled();
  });
});

describe('chip i lista przy trzech sklepach', () => {
  it('chip z nazwą aktywnego sklepu jest, a lista ma trzy wiersze z mini-stanem każdego', () => {
    const { f } = setupThree();
    expect(f.stores).toHaveLength(3);
    expect(textOf(byTut(render()!, 'store-switch'))).toContain(storeName(f, 1));
    expect(rows(render()!)).toHaveLength(0);
    click(byTut(render()!, 'store-switch'));
    const list = rows(render()!);
    expect(list).toHaveLength(3);
    const minis = storeMinis(f);
    expect(minis.map((m) => m.id)).toEqual([1, 2, 3]);
    minis.forEach((m, i) => {
      const text = plain(textOf(list[i]!));
      expect(text, `sklep ${m.id}`).toContain(storeName(f, m.id));
      expect(text).toContain(plain(`Dziś ${signedZl(m.todayProfit)}`));
      expect(text).toContain(plain(`Zostanie ${signedZl(m.net)}`));
      expect(text).toContain(`🤝 ${Math.round(m.trust)}`);
    });
    expect(list.map((r) => r.props['aria-current'])).toEqual(['true', undefined, undefined]);
    expect(list.every((r) => !r.props.disabled)).toBe(true);
  });

  it('wiersz trzeciego sklepu wysyła switchStore z id 3, a chip pokazuje go po przełączeniu', () => {
    const { session, f } = setupThree();
    storeList.value = true;
    const game = { firm: (cmd: FirmCommand) => dispatchFirm(session, cmd, NO_FX) } as unknown as GameActions;
    click(rows(render(game)!)[2]!);
    expect(f.activeId).toBe(3);
    expect(storeList.value).toBe(false);
    expect(textOf(byTut(render(game)!, 'store-switch'))).toContain(storeName(f, 3));
  });

  it('chip świeci znakiem, gdy ostrzeżenie ma którykolwiek sklep w tle, także trzeci, a lista ma znak tylko przy nim', () => {
    const { f } = setupThree();
    expect(withClass(render()!, 'tt-stores-alert')).toHaveLength(0);
    putInAisle(f, 3);
    expect(withClass(render()!, 'tt-stores-alert')).toHaveLength(1);
    storeList.value = true;
    const warnsOf = (i: number): string[] => walk(rows(render()!)[i]!).filter((v) => v.props['data-warn']).map((v) => String(v.props['data-warn']));
    expect(warnsOf(0)).toEqual([]);
    expect(warnsOf(1)).toEqual([]);
    expect(warnsOf(2)).toEqual(['paleta']);
  });

  it('zamknięty sklep z trzech zostaje na liście, a chip jest dalej, bo dwa sklepy działają', () => {
    const { f } = setupThree();
    f.stores[2]!.closed = true;
    storeList.value = true;
    const list = rows(render()!);
    expect(list).toHaveLength(3);
    expect(list[2]!.props.disabled).toBe(true);
    expect(plain(textOf(list[2]!))).toContain('zamknięta');
  });
});
