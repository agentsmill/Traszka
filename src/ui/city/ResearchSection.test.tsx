import { afterEach, describe, expect, it, vi } from 'vitest';
import { lang } from '@/i18n';
import { firmOf, type GameSession } from '@/game/session';
import { activeStore, syncWallet } from '@/sim/firm/firm';
import { forecastFirm } from '@/sim/firm/forecast';
import { spendCheck } from '@/sim/economy/forecast';
import type { FirmCommand, FirmCommandResult } from '@/sim/firm/commands';
import { RESEARCH, RESEARCH_BY_ID, coordinationFee, researchCost, type ResearchId } from '@/sim/firm/research';
import type { FirmState } from '@/sim/firm/types';
import { PL_CHARS } from '../../../tests/i18nScan';
import { openSecond, openThird, partnerSession } from '../../../tests/firmKit';
import { firm, type GameActions } from '../state';
import { percentOf, zl } from '../game/format';
import { SpendNote, spendRisk } from '../game/spend';
import { buttonsOf, click, labels, textOf, walk, type Vnode } from '../game/vnodeTree';
import { ResearchSection, blockedText, researchRow, researchTotal } from './ResearchSection';

/*
 * Sekcja „Sieć: badania” w panelu Miasto (spec 4b §5.3, §5.9). Komponent nie ma haków, więc wołamy go jak funkcję i oglądamy drzewo vnode;
 * kupno idzie przez `game.firm`, a symulacja liczy tylko to, co tu pokazujemy (`researchRow` bierze `netMods`, `researchCost`, `researchRefusal`).
 */

afterEach(() => { lang.value = 'pl'; firm.value = null; });

function fakeGame(result: FirmCommandResult = { ok: true }): GameActions & { firm: ReturnType<typeof vi.fn<(cmd: FirmCommand) => FirmCommandResult>> } {
  return {
    dispatch: vi.fn(() => ({ ok: true })),
    claimWelcome: vi.fn(), setSound: vi.fn(), setVibration: vi.fn(), restart: vi.fn(), newStore: vi.fn(),
    startRanked: vi.fn(() => false), resumeRanked: vi.fn(() => false), leaveRanked: vi.fn(), abandonRanked: vi.fn(),
    openFinish: vi.fn(), rememberNick: vi.fn(),
    firm: vi.fn<(cmd: FirmCommand) => FirmCommandResult>(() => result),
  } as GameActions & { firm: ReturnType<typeof vi.fn<(cmd: FirmCommand) => FirmCommandResult>> };
}

/** Firma z `count` otwartymi sklepami i dużym portfelem (gotówka na wszystkie badania). */
function firmWith(count: 1 | 2 | 3, wallet = 1_000_000): FirmState {
  const s: GameSession = partnerSession();
  if (count >= 2) openSecond(s);
  if (count >= 3) openThird(s);
  const f = firmOf(s);
  f.person.wallet = wallet;
  syncWallet(f);
  return f;
}

const render = (f: FirmState, game: GameActions = fakeGame()): Vnode => ResearchSection({ f, game, v: 1 }) as Vnode;
const rowFor = (tree: Vnode, id: ResearchId): Vnode => {
  const found = walk(tree).filter((v) => v.props['data-research'] === id);
  if (found.length !== 1) throw new Error(`Wierszy badania „${id}”: ${found.length}, oczekiwano jednego.`);
  return found[0]!;
};
/** Teksty z drzewa bez rozróżniania twardych spacji (polski zapis kwot ma U+00A0). */
const plain = (x: string): string => x.replace(/[\s  ]/g, ' ');

describe('ResearchSection: jeden sklep', () => {
  it('sześć wierszy z „Działa od 2 sklepów”, przyciski wyłączone, sekcja zwinięta', () => {
    const f = firmWith(1);
    const tree = render(f);
    expect(tree.type).toBe('details');
    expect(tree.props.open).toBe(false);   // przy jednym sklepie badania nie działają, więc sekcja czeka zwinięta
    const rows = RESEARCH.map((d) => rowFor(tree, d.id));
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(textOf(row)).toContain('Działa od 2 sklepów');
      const [button] = buttonsOf(row);
      expect(button!.props.disabled).toBe(true);
    }
    expect(textOf(tree)).toContain('Sieć: badania');
    expect(textOf(tree)).toContain('poziomy 0/23');   // 3 + 4 + 5 + 3 + 5 + 3
  });

  it('wiersz podaje cenę pierwszego poziomu i opłatę koordynacyjną nawet wtedy, gdy badanie jeszcze nie działa', () => {
    const f = firmWith(1);
    const text = plain(textOf(rowFor(render(f), 'obsada')));
    expect(text).toContain(plain(zl(60_000)));
    expect(text).toContain(plain('w tym opłata koordynacyjna Centrali: 12 000 zł'));
    expect(text).toContain('0/4');
  });

  it('researchRow przy jednym sklepie: bez efektu (badania nie działają), zablokowane przez „siec”', () => {
    const r = researchRow(firmWith(1), 'marketing');
    expect(r).toEqual({ level: 0, max: 5, price: 50_000, fee: 10_000, effectNow: '', blocked: 'siec' });
  });
});

describe('ResearchSection: trzy sklepy', () => {
  it('obsada: „60 000 zł”, opłata koordynacyjna 12 000 zł i efekt „płace −4,5%”; klik wysyła research z id', () => {
    const f = firmWith(3);
    const game = fakeGame();
    const tree = render(f, game);
    expect(tree.props.open).toBe(true);
    const row = rowFor(tree, 'obsada');
    const text = plain(textOf(row));
    expect(text).toContain(plain('60 000 zł'));
    expect(text).toContain(plain('w tym opłata koordynacyjna Centrali: 12 000 zł'));
    expect(text).toContain('płace −4,5%');
    expect(text).not.toContain('Działa od 2 sklepów');
    const [button] = buttonsOf(row);
    expect(textOf(button!)).toBe(zl(60_000));
    expect(button!.props.disabled).toBe(false);
    click(button!);
    expect(game.firm).toHaveBeenCalledTimes(1);
    expect(game.firm).toHaveBeenCalledWith({ type: 'research', id: 'obsada' });
  });

  it('efekt następnego poziomu przy trzech sklepach (skala 1,5) dla każdego badania, z kierunkiem zmiany', () => {
    const f = firmWith(3);
    const got = Object.fromEntries(RESEARCH.map((d) => [d.id, researchRow(f, d.id).effectNow]));
    expect(got).toEqual({
      dostawy: 'opłata za palety −15%',
      obsada: 'płace −4,5%',
      marketing: 'ruch +3,8%',
      magazyn: 'zaplecze +15%',
      lojalnosc: 'koszyk +2,3%',
      media: 'media −7,5%',
    });
  });

  it('przycisk bez gotówki jest wyłączony, a powód mówi o badaniu, nie o pakiecie lokalu', () => {
    const f = firmWith(3, 40_000);
    const row = researchRow(f, 'obsada');   // 60 000 zł
    expect(row.blocked).toBe('gotowka');
    const tree = render(f);
    const rowTree = rowFor(tree, 'obsada');
    expect(buttonsOf(rowTree)[0]!.props.disabled).toBe(true);
    expect(textOf(rowTree)).toContain('Za mało gotówki na badanie');
    expect(textOf(rowTree)).not.toContain('pakietu');
    expect(buttonsOf(rowFor(tree, 'dostawy'))[0]!.props.disabled).toBe(false);   // 25 000 zł mieści się w portfelu
  });

  it('po kupnie poziomu pokazuje „Teraz” z sumą efektu, a cena i efekt następnego poziomu idą dalej', () => {
    const f = firmWith(3);
    f.research = { obsada: 1 };
    const cost2 = researchCost(RESEARCH_BY_ID.obsada, 1);
    expect(cost2).toBe(120_000);
    const row = researchRow(f, 'obsada');
    expect(row).toMatchObject({ level: 1, max: 4, price: 120_000, fee: coordinationFee(120_000), effectNow: 'płace −4,5%' });
    expect(researchTotal(f, 'obsada')).toBe('płace −4,5%');
    f.research = { obsada: 2 };
    expect(researchTotal(f, 'obsada')).toBe('płace −9%');
    const text = plain(textOf(rowFor(render(f), 'obsada')));
    expect(text).toContain('Teraz: płace −9%');
    expect(text).toContain('Kolejny poziom: płace −4,5%');
    expect(text).toContain('2/4');
  });

  it('efekt nie przekracza limitu `cap`: przy pięciu sklepach ostatni poziom magazynu daje tylko tyle, ile zostało do 50%', () => {
    const f = firmWith(3);
    f.research = { magazyn: 2 };
    expect(researchRow(f, 'magazyn').effectNow).toBe('zaplecze +15%');   // trzy sklepy: skala 1,5, poziom 3 to 0,45, poniżej limitu 0,5
    f.stores.push({ ...f.stores[1]!, id: 4 }, { ...f.stores[1]!, id: 5 });   // pięć otwartych sklepów: skala 2, poziom 3 to 0,6 ucięte do 0,5
    expect(researchRow(f, 'magazyn').effectNow).toBe('zaplecze +10%');   // 0,5 − 0,4
  });
});

describe('ResearchSection: poziom maksymalny i inne blokady', () => {
  it('poziom max: ✓ i „4/4”, bez przycisku i bez ceny', () => {
    const f = firmWith(3);
    f.research = { obsada: 4 };
    const row = rowFor(render(f), 'obsada');
    expect(textOf(row)).toContain('✓');
    expect(textOf(row)).toContain('4/4');
    expect(buttonsOf(row)).toEqual([]);
    expect(textOf(row)).not.toContain('koordynacyjna');
    expect(researchRow(f, 'obsada')).toMatchObject({ level: 4, max: 4, price: null, fee: null, effectNow: '', blocked: 'max' });
  });

  it('poziom max przy jednym sklepie też pokazuje ✓, a nie „Działa od 2 sklepów” (nic już nie do kupienia)', () => {
    const f = firmWith(1);
    f.research = { dostawy: 3 };
    const row = rowFor(render(f), 'dostawy');
    expect(textOf(row)).toContain('✓');
    expect(textOf(row)).not.toContain('Działa od 2 sklepów');
  });

  it('bieg rankingowy i koniec gry: powód Centrali zamiast „Działa od 2 sklepów”, przycisk wyłączony', () => {
    const f = firmWith(3);
    f.ranked = true;
    expect(researchRow(f, 'obsada').blocked).toBe('ranked');
    expect(buttonsOf(rowFor(render(f), 'obsada'))[0]!.props.disabled).toBe(true);
    expect(textOf(rowFor(render(f), 'obsada'))).toContain('W sezonie rankingowym');
    f.ranked = false;
    f.over = 'debt';
    expect(researchRow(f, 'obsada').blocked).toBe('over');
    expect(blockedText('over', f)).toContain('Gra skończona');
  });

  it('nagłówek liczy kupione poziomy z możliwych', () => {
    const f = firmWith(3);
    f.research = { dostawy: 2, obsada: 1 };
    expect(textOf(render(f))).toContain('poziomy 3/23');
  });

  it('sekcja ma tylko przyciski kupna (po jednym na badanie, które nie jest na maksimum)', () => {
    const f = firmWith(3);
    f.research = { media: 3 };
    expect(labels(render(f))).toHaveLength(5);
  });
});

describe('ResearchSection: angielski', () => {
  it('wszystkie teksty wiersza i nagłówka są po angielsku, kwoty i efekty w angielskim zapisie', () => {
    const f = firmWith(3);
    f.research = { obsada: 1 };
    lang.value = 'en';
    const tree = render(f);
    const text = textOf(tree);
    expect(PL_CHARS.test(text.replace(/zł/g, ''))).toBe(false);
    expect(text).toContain('Network: research');
    expect(text).toContain('levels 1/23');
    expect(text).toContain('including Head Office’s coordination fee: 24,000 zł');
    expect(text).toContain('wages −4.5%');
    expect(text).toContain('Now: wages −4.5%');
    expect(text).toContain('Next level: footfall +3.8%');
    expect(percentOf(0.0375)).toBe('3.8%');
    const one = firmWith(1);
    expect(textOf(render(one))).toContain('Works from 2 shops');
    expect(blockedText('gotowka', one)).toContain('Not enough cash for this research');
  });

  it('opis przycisku kupna niesie nazwę badania i poziom', () => {
    const f = firmWith(3);
    lang.value = 'en';
    const button = buttonsOf(rowFor(render(f), 'obsada'))[0]!;
    expect(button.props['aria-label']).toBe(`Buy: Shared staffing (network rota), level 1, ${zl(60_000)}`);   // nazwa dostępna zawiera cenę z widocznego napisu
    expect(textOf(button)).toBe(zl(60_000));
  });

  it('✓ na poziomie maksymalnym jest obrazkiem z czytelną etykietą (aria-label bez roli nie byłby odczytany)', () => {
    const f = firmWith(3);
    f.research = { obsada: 4 };
    lang.value = 'en';
    const check = walk(rowFor(render(f), 'obsada')).find((v) => String(v.props.class) === 'tt-check')!;
    expect(check.props.role).toBe('img');
    expect(check.props['aria-label']).toBe('Top level');
  });
});

describe('ResearchSection: ostrzeżenie o wydatku (jak przy innych zakupach za gotówkę)', () => {
  /** Firma z trzema sklepami i portfelem na wszystko, której prognoza „gotówka po zamknięciu” jest przesunięta na `cashAfter` (potrącenie za palety w sklepie #1). */
  function firmForecasting(cashAfter: number): FirmState {
    const f = firmWith(3);
    firm.value = { f, v: 1 };
    const shift = forecastFirm(f).cashAfter - cashAfter;
    f.stores[0]!.econ.franchisee.month.pallets += shift;
    expect(Math.round(forecastFirm(f).cashAfter)).toBe(cashAfter);
    return f;
  }
  const noteOf = (row: Vnode): Vnode => walk(row).find((v) => v.type === SpendNote)!;
  const shownNote = (row: Vnode): string | null => {
    const n = noteOf(row);
    return n ? textOf(SpendNote(n.props as never) as never) : null;
  };

  it('badanie, po którym gotówka po zamknięciu miesiąca zejdzie pod zero, ma notkę z kwotą „zostanie Ci”, a tańsze, które się mieści, nie', () => {
    const f = firmForecasting(30_000);
    const tree = render(f);
    const a = activeStore(f);
    // 25 000 zł (Wspólne dostawy) mieści się: zostaje 5 000 zł
    expect(shownNote(rowFor(tree, 'dostawy'))).toBe('');
    // 60 000 zł (Wspólna obsada): zostaje −30 000 zł
    const note = shownNote(rowFor(tree, 'obsada'))!;
    expect(note).toContain('Po zamknięciu miesiąca zostanie Ci');
    expect(spendCheck(forecastFirm(f), 60_000).cashAfter).toBeCloseTo(-30_000, 0);
    expect(note.replace(/[\s\u00a0\u202f]/g, '')).toContain('−30000zł');
    expect(note).toContain('gotówka zejdzie pod zero');
    expect(a.econ.cash).toBeGreaterThanOrEqual(60_000);   // sam zakup się opłaca z portfela: ostrzeżenie nie blokuje
    expect(buttonsOf(rowFor(tree, 'obsada'))[0]!.props.disabled).toBe(false);
  });

  it('każdy wiersz z ceną przechodzi przez SpendNote z ceną badania i sklepem aktywnym', () => {
    const f = firmForecasting(30_000);
    const a = activeStore(f);
    const prices = RESEARCH.map((d) => {
      const n = noteOf(rowFor(render(f), d.id));
      expect(n.props.s).toBe(a.econ);
      expect(n.props.info).toBe(a.info);
      return n.props.price;
    });
    expect(prices).toEqual(RESEARCH.map((d) => researchCost(d, 0)));
  });

  it('przycisk dostaje kolor ostrzeżenia (data-risk) dopiero od progu, tak jak inne zakupy; „ciasno” zostaje zwykłe', () => {
    const f = firmForecasting(-10_000);
    const a = activeStore(f);
    const tree = render(f);
    const risk = (id: ResearchId): unknown => buttonsOf(rowFor(tree, id))[0]!.props['data-risk'];
    expect(risk('dostawy')).toBeUndefined();   // −35 000 zł: ciasno (pod zerem, nad progiem ostrzeżenia)
    expect(risk('obsada')).toBe('warn');       // −70 000 zł: poniżej progu ostrzeżenia (−60 000 zł)
    expect(risk('lojalnosc')).toBe('warn');    // −90 000 zł
    for (const d of RESEARCH) expect(risk(d.id), d.id).toBe(spendRisk(a.econ, a.info, researchCost(d, 0)));
  });

  it('badanie niedostępne (jeden sklep, brak gotówki, ranking) nie dokłada ostrzeżenia o wydatku', () => {
    const one = firmWith(1);
    expect(walk(rowFor(render(one), 'obsada')).some((v) => v.type === SpendNote)).toBe(false);
    expect(buttonsOf(rowFor(render(one), 'obsada'))[0]!.props['data-risk']).toBeUndefined();
    const poor = firmWith(3, 40_000);
    expect(walk(rowFor(render(poor), 'obsada')).some((v) => v.type === SpendNote)).toBe(false);
    const max = firmWith(3);
    max.research = { obsada: 4 };
    expect(walk(rowFor(render(max), 'obsada')).some((v) => v.type === SpendNote)).toBe(false);
  });

  it('po angielsku notka mówi o gotówce po zamknięciu miesiąca', () => {
    const f = firmForecasting(30_000);
    lang.value = 'en';
    expect(shownNote(rowFor(render(f), 'obsada'))).toContain('After the month closes you’ll keep −30,000 zł: your cash will go below zero.');
  });
});
