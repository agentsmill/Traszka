import { afterEach, describe, expect, it, vi } from 'vitest';
import { lang } from '@/i18n';
import { firmOf, type GameSession } from '@/game/session';
import { syncWallet } from '@/sim/firm/firm';
import type { FirmCommand, FirmCommandResult } from '@/sim/firm/commands';
import { RESEARCH, RESEARCH_BY_ID, coordinationFee, researchCost, type ResearchId } from '@/sim/firm/research';
import type { FirmState } from '@/sim/firm/types';
import { PL_CHARS } from '../../../tests/i18nScan';
import { openSecond, openThird, partnerSession } from '../../../tests/firmKit';
import type { GameActions } from '../state';
import { percentOf, zl } from '../game/format';
import { buttonsOf, click, labels, textOf, walk, type Vnode } from '../game/vnodeTree';
import { ResearchSection, blockedText, researchRow, researchTotal } from './ResearchSection';

/*
 * Sekcja „Sieć: badania” w panelu Miasto (spec 4b §5.3, §5.9). Komponent nie ma haków, więc wołamy go jak funkcję i oglądamy drzewo vnode;
 * kupno idzie przez `game.firm`, a symulacja liczy tylko to, co tu pokazujemy (`researchRow` bierze `netMods`, `researchCost`, `researchRefusal`).
 */

afterEach(() => { lang.value = 'pl'; });

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
    expect(button.props['aria-label']).toBe('Buy: Shared staffing (network rota), level 1');
  });
});
