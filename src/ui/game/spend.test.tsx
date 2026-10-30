import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEBT_LIMIT, HIRE_COST } from '@/sim/economy/catalog';
import type { Command } from '@/sim/economy/commands';
import { DEBT_WARN, createEconomy, installmentRoom, level, nextRemont, upgradeBlocker, type CommandResult, type EconomyState } from '@/sim/economy/economy';
import { forecastMonth, spendCheck } from '@/sim/economy/forecast';
import { planFor } from '@/sim/economy/franchisee';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import type { AnswerInstance } from '@/sim/economy/tycoon/cards';
import { EQUIPMENT, UPGRADES, equipmentCost, upgradeCost } from '@/sim/economy/upgrades';
import { layoutFor } from '@/sim/store/layoutFor';
import { econ, monthPreview, ranked, selection, speed, tab, type GameActions } from '../state';
import { ForecastChip } from './Hud';
import { forecastLabel } from './forecastText';
import { SelectionCard } from './overlays';
import { PeoplePanel, ShopPanel } from './panels';
import { SpendNote, answerCashCost, ratyLabel, ratyTitle, spendLevel, spendRisk } from './spend';
import { int, money, signedZl, zl } from './format';
import { buttonsOf, click, textOf, walk, type Vnode } from './vnodeTree';

function fakeGame(): GameActions & { dispatch: ReturnType<typeof vi.fn<(cmd: Command) => CommandResult>> } {
  return {
    dispatch: vi.fn<(cmd: Command) => CommandResult>(() => ({ ok: true })),
    claimWelcome: vi.fn(), openNextStore: vi.fn(), setSound: vi.fn(), setVibration: vi.fn(), restart: vi.fn(), newStore: vi.fn(),
    startRanked: vi.fn(() => false), resumeRanked: vi.fn(() => false), leaveRanked: vi.fn(), abandonRanked: vi.fn(),
    openFinish: vi.fn(), rememberNick: vi.fn(),
  };
}

/**
 * Sklep z gotówką `cash`, poziomem i Ogonkami na wszystko (żadna blokada poza pieniędzmi) i zaufaniem 50 (limit rat bez mnożnika).
 * `net`: prognoza „Zostaje Ci” na koniec miesiąca; ustawiona potrąceniem za palety (każda złotówka potrącenia zmniejsza ją o złotówkę),
 * więc gotówka po zamknięciu to dokładnie `cash + net`. Bez `net` zostaje prognoza świeżego sklepu (kilka tysięcy na plusie).
 */
function shop(cash: number, net?: number): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor('wydatki', 0));
  const s = createEconomy('wydatki', info);
  s.cash = cash;
  s.level = 30;
  s.ogonki = 500;
  s.tycoon.trust.value = 50;   // bez premii od obrotu, limit rat × 1
  if (net !== undefined) s.franchisee.month.pallets += forecastMonth(s, info).net - net;
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
/** Notki za gotówkę (bez rat). */
const cashNotes = (tree: unknown): Vnode[] => notes(tree).filter((n) => !n.props.rata);
const rataNotes = (tree: unknown): Vnode[] => notes(tree).filter((n) => n.props.rata);
/** Notki, które naprawdę coś pokazują (komponent w drzewie vnode nie jest wołany, więc wołamy go tu). */
const shown = (tree: unknown): Vnode[] => notes(tree).filter((n) => SpendNote(n.props as never) !== null);
/** Przyciski zakupu za gotówkę (z ceną w złotych; „Kampania” za Ogonki też ma klasę `tt-buy`, ale nie jest wydatkiem). */
const buy = (tree: unknown): Vnode[] => buttonsOf(tree as never).filter((b) => String(b.props.class).includes('tt-buy') && textOf(b).includes('zł'));
const raty = (tree: unknown): Vnode[] => buttonsOf(tree as never).filter((b) => String(b.props.class).includes('tt-rata'));
const priceOf = (b: Vnode): number => Number(textOf(b).replace(/\D/g, ''));

describe('SpendNote: ostrzeżenie pod ceną', () => {
  it('zakup, po którym gotówka po zamknięciu zostaje nad zerem: nic', () => {
    const { s, info } = shop(20_000, -5_000);   // po zamknięciu 15 000
    expect(SpendNote({ s, info, price: 5_000 })).toBeNull();
    expect(SpendNote({ s, info, price: 15_000 })).toBeNull();   // równo do zera też nie ostrzega
  });

  it('zakup, po którym gotówka po zamknięciu zejdzie pod zero: wiersz z kwotą „zostanie Ci”', () => {
    const { s, info } = shop(20_000, -5_000);   // po zamknięciu 15 000, zakup 16 200 daje −1 200
    const v = SpendNote({ s, info, price: 16_200 }) as unknown as Vnode;
    expect(String(v.props.class)).toBe('tt-spend tight');
    expect(v.props.role).toBe('note');
    expect(textOf(v)).toBe(`Po zamknięciu miesiąca zostanie Ci ${signedZl(-1_200)}: gotówka zejdzie pod zero.`);
  });

  it('cena ponad gotówką: bez dubla do „Za mało gotówki” (przycisk i tak wyłączony)', () => {
    const { s, info } = shop(1_000);
    expect(SpendNote({ s, info, price: 5_000 })).toBeNull();
    expect(spendLevel(s, info, 5_000)).toBe('ok');
  });

  it('brak ceny (zero, zwrot): nic', () => {
    const { s, info } = shop(1_000, -50_000);
    expect(SpendNote({ s, info, price: 0 })).toBeNull();
    expect(SpendNote({ s, info, price: -50 })).toBeNull();
  });

  it('`always` (karta księguje się nawet na debet): ostrzega także przy cenie ponad gotówką', () => {
    const { s, info } = shop(1_000, -5_000);
    expect(SpendNote({ s, info, price: 5_000, always: true })).not.toBeNull();
    expect(spendLevel(s, info, 5_000, true)).not.toBe('ok');
  });

  it('spendRisk koloruje przycisk dopiero od progu ostrzeżenia, „ciasno” zostawia zwykły', () => {
    // gotówka 300 000 i prognoza „Zostaje Ci” tak, że po zamknięciu wychodzi równo zero: zakup za p zostawia −p
    const { s, info } = shop(300_000, -300_000);
    expect(forecastMonth(s, info).cashAfter).toBeCloseTo(0, 6);
    expect(spendRisk(s, info, 1_000)).toBeUndefined();
    expect(spendLevel(s, info, 1_000)).toBe('tight');
    const warnPrice = -DEBT_WARN + 1;                  // po zamknięciu DEBT_WARN − 1
    expect(spendRisk(s, info, warnPrice)).toBe('warn');
    const dangerPrice = -DEBT_LIMIT + 1;               // po zamknięciu DEBT_LIMIT − 1
    expect(dangerPrice).toBeLessThanOrEqual(s.cash);
    expect(spendRisk(s, info, dangerPrice)).toBe('danger');
  });

  it('rata: ocenia się pierwszą ratę i bez względu na gotówkę, a tekst mówi o pierwszej racie', () => {
    const { s, info } = shop(1_000, -5_000);   // po zamknięciu −4 000
    expect(SpendNote({ s, info, price: 1_500 })).toBeNull();   // za gotówkę to zakup poza zasięgiem: przycisk wyłączony
    const v = SpendNote({ s, info, price: 1_500, rata: true }) as unknown as Vnode;
    expect(textOf(v)).toBe(`Po zamknięciu miesiąca, z pierwszą ratą, zostanie Ci ${signedZl(-5_500)}: gotówka zejdzie pod zero.`);
    expect(spendRisk(s, info, 1_500, true)).toBeUndefined();   // ciasno, ale nad progiem ostrzeżenia
    expect(spendRisk(s, info, -DEBT_WARN, true)).toBe('warn');
    expect(spendLevel(s, info, 0, false, true)).toBe('ok');
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
  // gotówka 20 000, prognoza „Zostaje Ci” −10 000: po zamknięciu 10 000, więc zakup powyżej tego (ale w zasięgu gotówki) zejdzie pod zero
  const tight = (): { s: EconomyState; info: StoreInfo } => shop(20_000, -10_000);

  it('Ulepszenia: każda cena z przycisku przechodzi przez SpendNote (sprzęt, ulepszenia, remont), a pierwsza rata przez wariant rat', () => {
    const { s, info } = tight();
    const tree = ShopPanel({ s, info, game: fakeGame(), v: 1 });
    const prices = cashNotes(tree).map((n) => n.props.price as number).sort((a, b) => a - b);
    const expected: number[] = [];
    for (const e of EQUIPMENT) if (s.level >= e.minLevel) expected.push(equipmentCost(e, s.equipment.filter((x) => x.id === e.id).length));
    for (const u of UPGRADES) {
      if (upgradeBlocker(s, u) === null) expected.push(upgradeCost(u, level(s, u.id)));
    }
    const remont = nextRemont(s);
    if (remont && s.level >= remont.minLevel) expected.push(remont.cost);
    expect(prices).toEqual(expected.sort((a, b) => a - b));
    expect(prices.length).toBeGreaterThan(5);
    // dla rat notka dostaje pierwszą ratę z planu, o ile limit rat ją przepuszcza
    const free = installmentRoom(s).free;
    const firstRates = rataNotes(tree).map((n) => n.props.price as number).sort((a, b) => a - b);
    expect(firstRates).toEqual(expected.map((p) => planFor(p).monthly).filter((m) => m <= free).sort((a, b) => a - b));
    for (const n of notes(tree)) {
      expect(n.props.s).toBe(s);
      expect(n.props.info).toBe(info);
    }
  });

  it('przycisk zakupu nie jest wyłączony przez prognozę: tylko brak gotówki go wyłącza, kolor idzie z data-risk', () => {
    const { s, info } = tight();
    const forecast = forecastMonth(s, info);
    const tree = ShopPanel({ s, info, game: fakeGame(), v: 1 });
    const prices = buy(tree).map((b) => ({ b, price: priceOf(b) }));
    expect(prices.length).toBeGreaterThan(5);
    for (const { b, price } of prices) {
      const exceeds = price > forecast.cashAfter;
      if (exceeds && price <= s.cash) expect(b.props.disabled, `${price}`).toBe(false);   // ponad gotówkę po zamknięciu, ale gotówka jest: klik działa
      const want = price <= s.cash && spendCheck(forecast, price).level;
      expect(b.props['data-risk'], `${price}`).toBe(want === 'warn' || want === 'danger' ? want : undefined);
    }
    // wiersze „ciasno” trafiają w teście na prawdziwe ceny (nie same „ok”)
    expect(prices.some(({ price }) => price > forecast.cashAfter && price <= s.cash)).toBe(true);
  });

  it('klik w drogi zakup nadal wysyła polecenie (żadnej blokady po stronie interfejsu), bez pola raty', () => {
    const { s, info } = tight();
    const game = fakeGame();
    const tree = ShopPanel({ s, info, game, v: 1 });
    const forecast = forecastMonth(s, info);
    const pricey = buy(tree).find((b) => priceOf(b) > forecast.cashAfter && priceOf(b) <= s.cash && !b.props.disabled)!;
    expect(pricey).toBeDefined();
    click(pricey);
    expect(game.dispatch).toHaveBeenCalledTimes(1);
    expect(Object.keys(game.dispatch.mock.calls[0]![0])).not.toContain('raty');
  });

  it('w sklepie z grubym zapasem nie ma ani jednej notki', () => {
    const { s, info } = shop(1e7);
    expect(shown(ShopPanel({ s, info, game: fakeGame(), v: 1 }))).toHaveLength(0);
  });

  it('Ludzie: rekrutacja ma notkę z ceną HIRE_COST i kolor przycisku „+”, ale nie ma jej na raty', () => {
    const { s, info } = shop(HIRE_COST + 50, -5_000);   // gotówki starcza, po zamknięciu już nie
    const tree = PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    const n = notes(tree);
    expect(n).toHaveLength(1);
    expect(n[0]!.props.price).toBe(HIRE_COST);
    expect(n[0]!.props.rata).toBeUndefined();
    const plus = buttonsOf(tree).find((b) => b.props['aria-label'] === 'Zatrudnij')!;
    expect(plus.props.disabled).toBe(false);
    expect(plus.props['data-risk']).toBe(spendRisk(s, info, HIRE_COST));
    expect(raty(tree)).toHaveLength(0);   // rekrutacja tylko za gotówkę
  });

  it('okno slotu: sprzęt z notką i kolorem przycisku, polecenie dalej wychodzi (za gotówkę i na raty)', () => {
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
    const price = priceOf(bought);
    expect(bought.props['data-risk']).toBe(spendRisk(s, info, price));
    click(bought);
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'buyEquipment', id: expect.any(String), slotId: slot.id });
    expect(Object.keys(game.dispatch.mock.calls[0]![0])).not.toContain('raty');
    const onCredit = raty(tree)[0]!;
    expect(onCredit.props.disabled).toBe(false);
    click(onCredit);
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'buyEquipment', id: expect.any(String), slotId: slot.id, raty: true });
  });
});

describe('zakup na raty w panelu Ulepszenia', () => {
  const panel = (s: EconomyState, info: StoreInfo, game = fakeGame()) => ShopPanel({ s, info, game, v: 1 });

  it('przy każdej cenie jest drugi przycisk „na raty: N × Y zł” z planu (liczba rat i rata miesięczna z planFor)', () => {
    const { s, info } = shop(1e7);
    const tree = panel(s, info);
    const cash = buy(tree);
    const credit = raty(tree);
    expect(credit.length).toBe(cash.length);   // sprzęt, ulepszenia i remont: każdy zakup ma obie drogi
    for (const [i, b] of cash.entries()) {
      const plan = planFor(priceOf(b));
      expect(textOf(credit[i]!), `${priceOf(b)}`).toBe(`na raty: ${plan.months} × ${zl(plan.monthly)}`);
      expect(textOf(credit[i]!)).toBe(ratyLabel(plan));
    }
  });

  it('przycisk gotówkowy wysyła zakup bez pola raty, przycisk rat z `raty: true`: ulepszenie, sprzęt i remont', () => {
    const { s, info } = shop(1e7);
    const game = fakeGame();
    const tree = panel(s, info, game);
    const upgrade = UPGRADES.find((u) => upgradeBlocker(s, u) === null)!;
    const kinds = [
      { cash: { type: 'buyEquipment', id: EQUIPMENT[0]!.id }, price: equipmentCost(EQUIPMENT[0]!, 0) },
      { cash: { type: 'buyUpgrade', id: upgrade.id }, price: upgradeCost(upgrade, 0) },
      { cash: { type: 'startRemont' }, price: nextRemont(s)!.cost },
    ] as const;
    for (const { cash, price } of kinds) {
      const b = buy(tree).find((x) => priceOf(x) === price && !x.props.disabled)!;
      const r = raty(tree).find((x) => textOf(x) === ratyLabel(planFor(price)) && !x.props.disabled)!;
      expect(b, `${cash.type} za gotówkę`).toBeDefined();
      expect(r, `${cash.type} na raty`).toBeDefined();
      click(b);
      expect(game.dispatch).toHaveBeenLastCalledWith(cash);
      expect(Object.keys(game.dispatch.mock.calls.at(-1)![0])).not.toContain('raty');
      click(r);
      expect(game.dispatch).toHaveBeenLastCalledWith({ ...cash, raty: true });
    }
  });

  it('rata w limicie: przycisk aktywny, a podpowiedź podaje opłatę, sumę do spłaty i wolny limit rat', () => {
    const { s, info } = shop(1e7);
    const room = installmentRoom(s);
    expect(room.limit).toBeGreaterThan(0);
    const tree = panel(s, info);
    const price = equipmentCost(EQUIPMENT.find((e) => e.id === 'sco')!, 0);
    const plan = planFor(price);
    const btn = raty(tree).find((r) => textOf(r) === ratyLabel(plan))!;
    expect(plan.feeShare).toBe(0.04);
    expect(btn.props.disabled).toBe(false);
    const title = String(btn.props.title);
    expect(title).toContain(`${plan.months} × ${zl(plan.monthly)}`);
    expect(title).toContain(`Opłata za finansowanie ${zl(plan.fee)} (4%)`);
    expect(title).toContain(`razem do spłaty ${zl(plan.total)}`);
    expect(title).toContain(`wolny limit rat ${int(room.free)} z ${zl(room.limit)} miesięcznie`);
    expect(title).toContain('Mieści się w limicie');
  });

  it('rata ponad wolny limit: przycisk rat wyłączony, a gotówkowy dalej działa; podpowiedź mówi, że rata przekracza limit', () => {
    const { s, info } = shop(1e7);
    s.tycoon.trust.value = 30;   // mnożnik 0,5: limit rat spada o połowę
    const room = installmentRoom(s);
    const tree = panel(s, info);
    const over = raty(tree).filter((r) => r.props.disabled);
    const under = raty(tree).filter((r) => !r.props.disabled);
    expect(over.length).toBeGreaterThan(0);   // remont (rata ponad połowę limitu) i część ulepszeń
    expect(under.length).toBeGreaterThan(0);
    for (const r of over) {
      const m = Number(/× ([\d\s\u00a0\u202f]+) zł/.exec(textOf(r))![1]!.replace(/\D/g, ''));
      expect(m).toBeGreaterThan(room.free);
      expect(String(r.props.title)).toContain('Rata przekracza');
    }
    for (const r of under) expect(Number(/× ([\d\s\u00a0\u202f]+) zł/.exec(textOf(r))![1]!.replace(/\D/g, ''))).toBeLessThanOrEqual(room.free);
    // limit rat nie rusza zakupów za gotówkę: przy 10 mln zł wyłączony jest tylko humanoid, któremu brakuje remontu
    const humanoid = UPGRADES.find((u) => u.id === 'humanoid')!;
    expect(upgradeBlocker(s, humanoid)).toMatch(/^Wymaga remontu/);
    expect(buy(tree).filter((b) => b.props.disabled).map(priceOf)).toEqual([upgradeCost(humanoid, 0)]);
  });

  it('zaufanie poniżej progu finansowania (limit 0): wszystkie raty wyłączone, podpowiedź „Centrala nie finansuje”', () => {
    const { s, info } = shop(1e7);
    s.tycoon.trust.value = 10;
    expect(installmentRoom(s).limit).toBe(0);
    const credit = raty(panel(s, info));
    expect(credit.length).toBeGreaterThan(5);
    for (const r of credit) {
      expect(r.props.disabled).toBe(true);
      expect(String(r.props.title)).toBe('Centrala nie finansuje zakupów przy tak niskim zaufaniu.');
    }
    expect(ratyTitle(planFor(1000), { limit: 0, free: 0 })).toContain('nie finansuje');
  });

  /** Wiersz zakupu (`tt-item`) z danym tekstem (nazwa sprzętu). */
  const item = (tree: unknown, name: string): Vnode => walk(tree as never).find((v) => String(v.props.class ?? '').includes('tt-item') && textOf(v).includes(name))!;

  it('blokada zakupu (poziom sprzętu) wyłącza oba przyciski, a odblokowany ma gotówkowy i raty aktywne', () => {
    const { s, info } = shop(1e7);
    s.level = 1;
    const locked = EQUIPMENT.find((e) => s.level < e.minLevel && planFor(equipmentCost(e, 0)).monthly <= installmentRoom(s).free)!;
    expect(locked).toBeDefined();
    const row = item(panel(s, info), locked.name);
    expect(buttonsOf(row).map((b) => b.props.disabled)).toEqual([true, true]);
    s.level = 30;
    expect(buttonsOf(item(panel(s, info), locked.name)).map((b) => b.props.disabled)).toEqual([false, false]);
  });

  it('bez gotówki wyłączony jest tylko przycisk gotówkowy: rata nie potrzebuje gotówki', () => {
    const { s, info } = shop(10);
    const tree = panel(s, info);
    expect(buy(tree).every((b) => b.props.disabled === true)).toBe(true);
    const affordable = raty(tree).filter((r) => !r.props.disabled);
    expect(affordable.length).toBeGreaterThan(0);
    const game = fakeGame();
    click(raty(panel(s, info, game)).find((r) => !r.props.disabled)!);
    expect(game.dispatch).toHaveBeenCalledWith(expect.objectContaining({ raty: true }));
  });

  it('kolor przycisku rat idzie z ostrzeżenia o pierwszej racie (data-risk)', () => {
    const { s, info } = shop(1e7, -99_000);   // po zamknięciu 9,9 mln: żadne ostrzeżenie
    for (const r of raty(panel(s, info))) expect(r.props['data-risk']).toBeUndefined();
    const deep = shop(0, -(-DEBT_WARN + 100));   // po zamknięciu tuż pod progiem ostrzeżenia: każda rata go pogłębia
    const colored = raty(panel(deep.s, deep.info)).filter((r) => !r.props.disabled);
    expect(colored.length).toBeGreaterThan(0);
    for (const r of colored) expect(r.props['data-risk']).toBeDefined();
  });
});

describe('ForecastChip: trzy kieszenie w pasku', () => {
  const chip = (s: EconomyState, info: StoreInfo): Vnode => ForecastChip({ f: forecastMonth(s, info), cash: s.cash }) as unknown as Vnode;

  it('pokazuje saldo, raty i prognozę „zostanie”, a stuknięcie otwiera okno wyciągu z podglądem końca miesiąca', () => {
    const { s, info } = shop(10_000);
    s.franchisee.month.margin = 9_000;
    s.franchisee.month.bonus = 345;
    s.franchisee.installments.push({ id: 1, label: 'Wózek', price: 1500, fee: 60, total: 1560, monthly: 520, paid: 0, months: 3 });
    const f = forecastMonth(s, info);
    const el = chip(s, info);
    expect(el.type).toBe('button');
    const text = textOf(el);
    expect(text).toContain(`Saldo u Centrali ${zl(9_345)}`);
    expect(text).toContain(`Raty ${zl(520)}`);
    expect(text).toContain(`Po zamknięciu zostanie ${signedZl(f.net)}`);
    expect(f.saldo).toBe(9_345);
    expect(f.installments).toBe(520);
    expect(String(el.props.class)).toBe('tt-due');
    expect(el.props['aria-label']).toBe(forecastLabel(f));
    expect(String(el.props.title)).toContain('Dokładny wyciąg: stuknij.');
    expect(monthPreview.value).toBeNull();
    click(el);
    expect(monthPreview.value).toEqual({ phase: 'idle' });
    expect(tab.value).toBeNull();   // zakładka Cele nie otwiera się sama
  });

  it('etykiety są krótkie i długie naraz: krótką wymusza CSS (wąski ekran ukrywa `tt-due-pre`)', () => {
    const { s, info } = shop(10_000);
    const nodes = walk(chip(s, info));
    const pre = nodes.filter((v) => v.props.class === 'tt-due-pre').map((v) => textOf(v));
    expect(pre).toEqual([' u Centrali', 'Po zamknięciu ']);
    expect(textOf(nodes.find((v) => v.props.class === 'tt-due-word'))).toBe('zostanie');
    const labels = nodes.filter((v) => v.props.class === 'tt-due-label').map((v) => textOf(v));
    expect(labels).toEqual(['Saldo u Centrali', 'Raty', 'Po zamknięciu zostanie']);
  });

  it('saldo rośnie z każdą sprzedażą (marża na saldo), a raty to suma rat z najbliższego przelewu; bez rat „0 zł”', () => {
    const { s, info } = shop(10_000);
    expect(textOf(chip(s, info))).toContain(`Raty ${zl(0)}`);
    const before = forecastMonth(s, info);
    s.franchisee.month.margin += 500;   // jeden klient
    const after = forecastMonth(s, info);
    expect(after.saldo).toBe(before.saldo + 500);
    expect(textOf(chip(s, info))).toContain(zl(after.saldo));
  });

  it('kolor prognozy: poniżej zera „neg”, poniżej progu ostrzeżenia „warn”, poniżej granicy gry „danger” z wykrzyknikiem', () => {
    const cls = (cashAfter: number): { cls: string; text: string } => {
      const { s, info } = shop(0, cashAfter);   // gotówka 0: gotówka po zamknięciu to dokładnie „Zostaje Ci”
      const el = chip(s, info);
      return { cls: String(el.props.class), text: textOf(el) };
    };
    expect(cls(10_000).cls).toBe('tt-due');
    expect(cls(-1_000).cls).toBe('tt-due neg');
    expect(cls(DEBT_WARN - 1).cls).toBe('tt-due warn');
    const danger = cls(DEBT_LIMIT - 1);
    expect(danger.cls).toBe('tt-due danger');
    expect(danger.text).toContain('⚠');
    expect(cls(-1_000).text).toContain(signedZl(-1_000));
    expect(money(-1_000)).toBe(`−${zl(1_000)}`);
  });
});

describe('zakupy nie zmieniają stanu', () => {
  it('render paneli i pasek tylko czytają stan', () => {
    const { s, info } = shop(50_000, -10_000);
    const before = JSON.stringify(s);
    ShopPanel({ s, info, game: fakeGame(), v: 1 });
    PeoplePanel({ s, info, game: fakeGame(), v: 1 });
    ForecastChip({ f: forecastMonth(s, info), cash: s.cash });
    expect(JSON.stringify(s)).toBe(before);
  });
});
