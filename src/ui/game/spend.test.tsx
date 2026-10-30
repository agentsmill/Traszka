import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE, HIRE_COST } from '@/sim/economy/catalog';
import type { Command } from '@/sim/economy/commands';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { DEBT_WARN, createEconomy, nextRemont, type CommandResult, type EconomyState } from '@/sim/economy/economy';
import { forecastMonth, spendCheck } from '@/sim/economy/forecast';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import type { AnswerInstance } from '@/sim/economy/tycoon/cards';
import { EQUIPMENT, UPGRADES } from '@/sim/economy/upgrades';
import { upgradeBlocker, level } from '@/sim/economy/economy';
import { equipmentCost, upgradeCost } from '@/sim/economy/upgrades';
import { layoutFor } from '@/sim/store/layoutFor';
import { econ, monthPreview, ranked, selection, speed, tab, type GameActions } from '../state';
import { DueChip } from './Hud';
import { SelectionCard } from './overlays';
import { PeoplePanel, ShopPanel } from './panels';
import { SpendNote, answerCashCost, spendLevel, spendRisk } from './spend';
import { signedZl, zl } from './format';
import { buttonsOf, click, textOf, walk, type Vnode } from './vnodeTree';

function fakeGame(): GameActions & { dispatch: ReturnType<typeof vi.fn<(cmd: Command) => CommandResult>> } {
  return {
    dispatch: vi.fn<(cmd: Command) => CommandResult>(() => ({ ok: true })),
    claimWelcome: vi.fn(), openNextStore: vi.fn(), setSound: vi.fn(), setVibration: vi.fn(), restart: vi.fn(), newStore: vi.fn(),
    startRanked: vi.fn(() => false), resumeRanked: vi.fn(() => false), leaveRanked: vi.fn(), abandonRanked: vi.fn(),
    openFinish: vi.fn(), rememberNick: vi.fn(),
  };
}

/** Sklep z gotówką `cash` i obrotem miesiąca `revenue`, poziomem i Ogonkami na wszystko (żadna blokada poza pieniędzmi). */
function shop(cash: number, revenue: number): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor('wydatki', 0));
  const s = createEconomy('wydatki', info);
  s.cash = cash;
  s.level = 30;
  s.ogonki = 500;
  s.month.revenue = revenue;
  s.tycoon.trust.value = 50;   // bez premii od obrotu: prognoza to sama opłata
  return { s, info };
}

afterEach(() => {
  tab.value = null;
  monthPreview.value = null;
  econ.value = null;
  selection.value = null;
  speed.value = 1;
  ranked.value = null;
});

const notes = (tree: unknown): Vnode[] => walk(tree as never).filter((v) => v.type === SpendNote);
/** Notki, które naprawdę coś pokazują (komponent w drzewie vnode nie jest wołany, więc wołamy go tu). */
const shown = (tree: unknown): Vnode[] => notes(tree).filter((n) => SpendNote(n.props as never) !== null);
const buy = (tree: unknown): Vnode[] => buttonsOf(tree as never).filter((b) => String(b.props.class).includes('tt-buy'));

describe('SpendNote: ostrzeżenie pod ceną', () => {
  it('zakup w wolnych środkach: nic', () => {
    const { s } = shop(20_000, 0);   // wolne 18 000
    expect(SpendNote({ s, price: 5_000 })).toBeNull();
  });

  it('ponad wolne środki: wiersz z kwotą po rozliczeniu miesiąca', () => {
    const { s } = shop(20_000, 0);
    const f = forecastMonth(s);
    const v = SpendNote({ s, price: f.free + 1_000 }) as unknown as Vnode;
    expect(String(v.props.class)).toBe('tt-spend tight');
    expect(v.props.role).toBe('note');
    expect(textOf(v)).toBe(`Ponad wolne środki: po rozliczeniu miesiąca wyjdzie ${signedZl(-1_000)}.`);
  });

  it('cena ponad gotówką: bez dubla do „Za mało gotówki” (przycisk i tak wyłączony)', () => {
    const { s } = shop(1_000, 0);
    expect(SpendNote({ s, price: 5_000 })).toBeNull();
    expect(spendLevel(s, 5_000)).toBe('ok');
  });

  it('brak ceny (zero, zwrot): nic', () => {
    const { s } = shop(1_000, 300_000);
    expect(SpendNote({ s, price: 0 })).toBeNull();
    expect(SpendNote({ s, price: -50 })).toBeNull();
  });

  it('`always` (karta księguje się nawet na debet): ostrzega także przy cenie ponad gotówką', () => {
    const { s } = shop(1_000, 0);
    expect(SpendNote({ s, price: 5_000, always: true })).not.toBeNull();
    expect(spendLevel(s, 5_000, true)).not.toBe('ok');
  });

  it('spendRisk koloruje przycisk dopiero od progu ostrzeżenia, „ciasno” zostawia zwykły', () => {
    // opłata ok. dwóch granic debetu, gotówka trzy granice: wolne ok. jednej granicy, a zakup może zjechać pod próg i pod granicę
    const limit = -DEBT_LIMIT;
    const { s } = shop(3 * limit, (2 * limit - FRANCHISE_FEE_FIXED) / FRANCHISE_FEE_SHARE);
    const f = forecastMonth(s);
    expect(spendRisk(s, 1_000)).toBeUndefined();
    expect(spendLevel(s, f.free + 1)).toBe('tight');
    expect(spendRisk(s, f.free + 1)).toBeUndefined();   // ciasno, ale nad progiem ostrzeżenia
    const warnPrice = f.free - DEBT_WARN + 1;           // wolne po zakupie = DEBT_WARN − 1
    expect(warnPrice).toBeLessThanOrEqual(s.cash);
    expect(spendRisk(s, warnPrice)).toBe('warn');
    const dangerPrice = f.free - DEBT_LIMIT + 1;        // wolne po zakupie = DEBT_LIMIT − 1
    expect(dangerPrice).toBeLessThanOrEqual(s.cash);
    expect(spendRisk(s, dangerPrice)).toBe('danger');
  });
});

describe('answerCashCost: ile gotówki zabiera odpowiedź na kartę', () => {
  const answer = (delta: AnswerInstance['delta']): Pick<AnswerInstance, 'delta'> => ({ delta });
  it('suma pewnych pozycji pieniężnych ze znakiem odwróconym', () => {
    expect(answerCashCost(answer({ cash: -300, fine: -200, logistics: -100 }))).toBe(600);
    expect(answerCashCost(answer({ cash: -300, bonus: 100 }))).toBe(200);
  });
  it('zysk albo brak pieniędzy to zero kosztu; zaufanie, WUT i czas nie wchodzą', () => {
    expect(answerCashCost(answer({ cash: 500 }))).toBe(0);
    expect(answerCashCost(answer({ trust: -3, wut: 400, staffMinutes: 90, energy: -10 }))).toBe(0);
    expect(answerCashCost(answer({}))).toBe(0);
  });
});

describe('wydatki w panelach: ostrzega, ale nie blokuje', () => {
  // gotówka 50 000, opłata ok. 47 000: wolne środki ok. 2 700, więc większość zakupów jest ponad nie
  const tight = (): { s: EconomyState; info: StoreInfo } => shop(50_000, 300_000);

  it('Ulepszenia: każda cena z przycisku przechodzi przez SpendNote (sprzęt, ulepszenia, remont)', () => {
    const { s, info } = tight();
    const tree = ShopPanel({ s, info, game: fakeGame(), v: 1 });
    const prices = notes(tree).map((n) => n.props.price as number).sort((a, b) => a - b);
    const expected: number[] = [];
    for (const e of EQUIPMENT) if (s.level >= e.minLevel) expected.push(equipmentCost(e, s.equipment.filter((x) => x.id === e.id).length));
    for (const u of UPGRADES) {
      if (upgradeBlocker(s, u) === null) expected.push(upgradeCost(u, level(s, u.id)));
    }
    const remont = nextRemont(s);
    if (remont && s.level >= remont.minLevel) expected.push(remont.cost);
    expect(prices).toEqual(expected.sort((a, b) => a - b));
    expect(prices.length).toBeGreaterThan(5);
    for (const n of notes(tree)) expect((n.props.s as EconomyState)).toBe(s);
  });

  it('przycisk zakupu nie jest wyłączony przez prognozę: tylko brak gotówki go wyłącza, kolor idzie z data-risk', () => {
    const { s, info } = tight();
    const forecast = forecastMonth(s);
    const tree = ShopPanel({ s, info, game: fakeGame(), v: 1 });
    const prices = buy(tree).map((b) => ({ b, price: Number(textOf(b).replace(/\D/g, '')) }));
    expect(prices.length).toBeGreaterThan(5);
    for (const { b, price } of prices) {
      const exceeds = price > forecast.free;
      if (exceeds && price <= s.cash) expect(b.props.disabled, `${price}`).toBe(false);   // ponad wolne środki, ale gotówka jest: klik działa
      const want = price <= s.cash && spendCheck(forecast, price).level;
      expect(b.props['data-risk'], `${price}`).toBe(want === 'warn' || want === 'danger' ? want : undefined);
    }
    // wiersze „ciasno/ostrzeżenie/koniec gry” trafiają w teście na prawdziwe ceny (nie same „ok”)
    expect(prices.some(({ price }) => price > forecast.free && price <= s.cash)).toBe(true);
  });

  it('klik w drogi zakup nadal wysyła polecenie (żadnej blokady po stronie interfejsu)', () => {
    const { s, info } = tight();
    const game = fakeGame();
    const tree = ShopPanel({ s, info, game, v: 1 });
    const forecast = forecastMonth(s);
    const pricey = buy(tree).find((b) => {
      const price = Number(textOf(b).replace(/\D/g, ''));
      return price > forecast.free && price <= s.cash && !b.props.disabled;
    })!;
    expect(pricey).toBeDefined();
    click(pricey);
    expect(game.dispatch).toHaveBeenCalledTimes(1);
  });

  it('w sklepie z grubym zapasem nie ma ani jednej notki', () => {
    const { s, info } = shop(1e7, 0);
    expect(shown(ShopPanel({ s, info, game: fakeGame(), v: 1 }))).toHaveLength(0);
  });

  it('Ludzie: rekrutacja ma notkę z ceną HIRE_COST i kolor przycisku „+”', () => {
    const { s, info } = shop(HIRE_COST + 50, 300_000);   // gotówki starcza, wolnych środków nie
    const tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    const n = notes(tree);
    expect(n).toHaveLength(1);
    expect(n[0]!.props.price).toBe(HIRE_COST);
    const plus = buttonsOf(tree).find((b) => b.props['aria-label'] === 'Zatrudnij')!;
    expect(plus.props.disabled).toBe(false);
    expect(plus.props['data-risk']).toBe(spendRisk(s, HIRE_COST));
  });

  it('okno slotu: sprzęt z notką i kolorem przycisku, polecenie dalej wychodzi', () => {
    const { s, info } = tight();
    const slot = info.slots[0]!;
    econ.value = { s, info, v: 1 };
    selection.value = { kind: 'slot', slotId: slot.id };
    const game = fakeGame();
    const tree = SelectionCard({ game });
    expect(tree).not.toBeNull();
    const n = notes(tree);
    expect(n.length).toBeGreaterThan(0);
    const bought = buy(tree)[0]!;
    const price = Number(textOf(bought).replace(/\D/g, ''));
    expect(bought.props['data-risk']).toBe(spendRisk(s, price));
    click(bought);
    expect(game.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'buyEquipment', slotId: slot.id }));
  });
});

describe('DueChip: rachunek Centrali w pasku', () => {
  it('pokazuje kwotę do oddania i wolne środki, a stuknięcie otwiera okno rachunku z podglądem końca miesiąca', () => {
    const { s } = shop(10_000, 0);
    const f = forecastMonth(s);
    const chip = DueChip({ f, cash: s.cash }) as unknown as Vnode;
    expect(chip.type).toBe('button');
    expect(textOf(chip)).toContain(zl(f.due));
    expect(textOf(chip)).toContain(zl(f.free));
    expect(textOf(chip)).toContain('Centrali');
    expect(String(chip.props.class)).toBe('tt-due');
    expect(chip.props['aria-label']).toBe(`Do oddania Centrali ${zl(f.due)}, wolne środki ${zl(f.free)}`);
    expect(monthPreview.value).toBeNull();
    click(chip);
    expect(monthPreview.value).toEqual({ phase: 'idle' });
    expect(tab.value).toBeNull();   // zakładka Cele nie otwiera się sama
  });

  it('kwota rośnie z obrotem (z każdym klientem)', () => {
    const { s } = shop(10_000, 0);
    const before = forecastMonth(s);
    s.month.revenue += 500;   // jeden klient
    const after = forecastMonth(s);
    expect(after.due).toBeGreaterThan(before.due);
    expect(textOf(DueChip({ f: after, cash: s.cash }) as never)).toContain(zl(after.due));
  });

  it('kolor: wolne poniżej zera „neg”, poniżej progu ostrzeżenia „warn”, poniżej granicy gry „danger” z wykrzyknikiem', () => {
    const cls = (cash: number, revenue: number): string => {
      const { s } = shop(cash, revenue);
      return String((DueChip({ f: forecastMonth(s), cash: s.cash }) as unknown as Vnode).props.class);
    };
    expect(cls(10_000, 0)).toBe('tt-due');
    expect(cls(1_000, 0)).toBe('tt-due neg');   // opłata 2 000 > gotówka 1 000: wolne −1 000, nad progiem ostrzeżenia
    const warnCash = 2_000 + DEBT_WARN - 1;   // wolne = DEBT_WARN − 1
    expect(cls(warnCash, 0)).toBe('tt-due warn');
    const danger = shop(0, 1_500_000);
    const chip = DueChip({ f: forecastMonth(danger.s), cash: 0 }) as unknown as Vnode;
    expect(String(chip.props.class)).toBe('tt-due danger');
    expect(textOf(chip)).toContain('⚠');
  });
});

describe('zakupy nie zmieniają stanu', () => {
  it('render paneli i pasek tylko czytają stan', () => {
    const { s, info } = shop(50_000, 300_000);
    const before = JSON.stringify(s);
    ShopPanel({ s, info, game: fakeGame(), v: 1 });
    PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    DueChip({ f: forecastMonth(s), cash: s.cash });
    expect(JSON.stringify(s)).toBe(before);
  });
});
