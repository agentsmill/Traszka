import { afterEach, describe, expect, it, vi } from 'vitest';
import { lang } from '@/i18n';
import { firmOf } from '@/game/session';
import { createEconomy } from '@/sim/economy/economy';
import { forecastMonth } from '@/sim/economy/forecast';
import { PLAN, type PlanOutlook, type PlanState } from '@/sim/economy/plan';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import type { FirmCommand, FirmCommandResult } from '@/sim/firm/commands';
import { layoutFor } from '@/sim/store/layoutFor';
import { openSecond, partnerSession } from '../../../tests/firmKit';
import { PL_CHARS } from '../../../tests/i18nScan';
import { firm, type GameActions } from '../state';
import { zl } from './format';
import { HudPlan, PlanRow, activePlan } from './plan';
import { STAGE_NAME, TIGHT_MARGIN, planFirstText, planLines } from './planText';
import { click, textOf, walk, type Vnode } from './vnodeTree';

/*
 * Pasek planu Centrali (HUD, `plan.tsx`) i wszystkie zdania o planie (`planText.ts`). Komponent bez haków, więc wołamy go jak funkcję.
 */

afterEach(() => { lang.value = 'pl'; firm.value = null; });

const outlook = (over: Partial<PlanOutlook> = {}): PlanOutlook => ({
  target: 412_000, due: 412_000, done: 251_320, share: 0.61, forecastShare: 0.97, verdict: 'miss', fine: 1_240, cost: 0,
  stage: 0, stageAfter: 1, streak: 3, topUp: false, ...over,
});
const fakeGame = (result: FirmCommandResult = { ok: true }) => ({ firm: vi.fn<(cmd: FirmCommand) => FirmCommandResult>(() => result) }) as unknown as GameActions & { firm: ReturnType<typeof vi.fn<(cmd: FirmCommand) => FirmCommandResult>> };
const plain = (s: string): string => s.replace(/[\s  ]/g, ' ');

describe('planLines: zdania paska', () => {
  it('głowa i postęp: plan, seria, wykonanie i prognoza', () => {
    const l = planLines(outlook());
    expect(plain(l.head)).toBe(plain(`Plan Centrali: ${zl(412_000)} · seria: 3 mies.`));
    expect(l.progress).toBe('wykonane 61% · prognoza 97%');
  });

  it('werdykt „plan zrobiony”, ton ok', () => {
    const l = planLines(outlook({ verdict: 'hit', forecastShare: 1.03, fine: 0, stageAfter: 0 }));
    expect(l.verdict).toBe('Prognoza: plan zrobiony.');
    expect(l.tone).toBe('ok');
  });

  it('trafienie na styk: poniżej 103% prognozy ostrzeżenie zamiast „plan zrobiony”, 103% już zrobiony', () => {
    const hit = (forecastShare: number, stage = 0): ReturnType<typeof planLines> =>
      planLines(outlook({ verdict: 'hit', forecastShare, fine: 0, stage, stageAfter: Math.max(0, stage - 1) }));
    for (const share of [1.005, 1.029]) {
      expect(hit(share).verdict).toBe('Prognoza: plan na styk. Jeśli zabraknie choć trochę, będzie kara.');
      expect(hit(share).tone).toBe('warn');
      expect(hit(share, 1).tone).toBe('danger');   // wpadka ze stopnia 1 dałaby stopień 2
    }
    expect(hit(1 + TIGHT_MARGIN).verdict).toBe('Prognoza: plan zrobiony.');
    expect(hit(1.03).tone).toBe('ok');
    expect(hit(1.03, 1).tone).toBe('ok');
  });

  it('werdykt „dobicie z kieszeni” z kosztem, ton warn', () => {
    const l = planLines(outlook({ verdict: 'topup', cost: 9_960, fine: 0, stageAfter: 0, topUp: true }));
    expect(plain(l.verdict)).toBe(plain(`Jeśli nic się nie zmieni: dobicie z kieszeni ok. ${zl(9_960)}.`));
    expect(l.tone).toBe('warn');
  });

  it('werdykt „kara” z kwotą i stopniem, ton warn przy stopniu 1', () => {
    const l = planLines(outlook());
    expect(plain(l.verdict)).toBe(plain(`Jeśli nic się nie zmieni: kara ${zl(1_240)}, stopień 1 (Rozmowa z partnerem regionalnym).`));
    expect(l.tone).toBe('warn');
  });

  it('stopień 2 po wpadce: ton danger, nazwa stopnia „Program naprawczy”', () => {
    const l = planLines(outlook({ stage: 1, stageAfter: 2, fine: 3_000 }));
    expect(plain(l.verdict)).toBe(plain(`Jeśli nic się nie zmieni: kara ${zl(3_000)}, stopień 2 (Program naprawczy).`));
    expect(l.tone).toBe('danger');
  });

  it('stopień 3: Centrala wypowie umowę na tę placówkę, ton danger', () => {
    const l = planLines(outlook({ stage: 2, stageAfter: 3, fine: 0 }));
    expect(l.verdict).toBe('Jeśli nic się nie zmieni: Centrala wypowie umowę na tę placówkę.');
    expect(l.tone).toBe('danger');
  });

  it('STAGE_NAME: cztery stopnie drabiny', () => {
    expect(STAGE_NAME).toEqual(['W planie', 'Rozmowa z partnerem regionalnym', 'Program naprawczy', 'Wypowiedzenie placówki']);
    expect(STAGE_NAME).toHaveLength(PLAN.stageMax + 1);
  });

  it('po angielsku te same liczby, bez polskich liter', () => {
    const pl = planLines(outlook()).verdict;
    lang.value = 'en';
    const l = planLines(outlook());
    expect(l.head).toContain('412');
    expect(l.verdict).toContain('1');
    for (const text of [l.head, l.progress, l.verdict, planLines(outlook({ stageAfter: 3 })).verdict, planFirstText(412_000)]) expect(text.replace(/zł/g, 'PLN')).not.toMatch(PL_CHARS);
    expect(l.verdict).not.toBe(pl);
    expect(l.verdict).toBe('If nothing changes: penalty 1,240 zł, stage 1 (Talk with the regional partner).');
  });
});

describe('PlanRow: pasek planu z przełącznikiem', () => {
  it('bez planu i bez pierwszego planu nic nie rysuje', () => {
    expect(PlanRow({ plan: null, first: null, storeId: 1, game: fakeGame() })).toBeNull();
  });

  it('przed pierwszym planem: jedno zdanie o planie od dziś i żadnego przełącznika', () => {
    const tree = PlanRow({ plan: null, first: 412_000, storeId: 1, game: fakeGame() }) as Vnode;
    expect(plain(textOf(tree))).toBe(plain(`Od dziś obowiązuje plan Centrali: ${zl(412_000)} w tym miesiącu.`));
    expect(walk(tree).filter((v) => v.type === 'button')).toHaveLength(0);
  });

  it('z planem: głowa, postęp, werdykt i przełącznik z dopiskiem', () => {
    const tree = PlanRow({ plan: outlook(), first: null, storeId: 1, game: fakeGame() }) as Vnode;
    const text = plain(textOf(tree));
    expect(text).toContain(plain(`Plan Centrali: ${zl(412_000)} · seria: 3 mies.`));
    expect(text).toContain('wykonane 61% · prognoza 97%');
    expect(text).toContain(plain(`kara ${zl(1_240)}, stopień 1 (Rozmowa z partnerem regionalnym)`));
    expect(text).toContain('Dobij plan z własnej kieszeni, jeśli zabraknie do 10%');
    expect(text).toContain('Kupujesz brakujący towar sam. Miesiąc jest zaliczony, ale następny plan rośnie.');
  });

  it('ton paska trafia do klasy (`warn`, `danger`, `ok`)', () => {
    const cls = (o: PlanOutlook): string => String((PlanRow({ plan: o, first: null, storeId: 1, game: fakeGame() }) as Vnode).props.class);
    expect(cls(outlook())).toContain('warn');
    expect(cls(outlook({ stageAfter: 2 }))).toContain('danger');
    expect(cls(outlook({ verdict: 'hit', forecastShare: 1.08, fine: 0, stageAfter: 0 }))).toContain('ok');
  });

  it('kliknięcie przełącznika wysyła planTopUp z włączeniem (i z wyłączeniem, gdy już włączony)', () => {
    const game = fakeGame();
    const off = PlanRow({ plan: outlook(), first: null, storeId: 2, game }) as Vnode;
    const sw = walk(off).find((v) => v.props.role === 'switch')!;
    expect(sw.props['aria-checked']).toBe('false');
    click(sw);
    expect(game.firm).toHaveBeenLastCalledWith({ type: 'planTopUp', storeId: 2, on: true });
    const on = PlanRow({ plan: outlook({ topUp: true, verdict: 'topup', cost: 9_960, fine: 0, stageAfter: 0 }), first: null, storeId: 2, game }) as Vnode;
    const sw2 = walk(on).find((v) => v.props.role === 'switch')!;
    expect(sw2.props['aria-checked']).toBe('true');
    click(sw2);
    expect(game.firm).toHaveBeenLastCalledWith({ type: 'planTopUp', storeId: 2, on: false });
    expect(game.firm).toHaveBeenCalledTimes(2);
  });
});

describe('activePlan: plan aktywnego sklepu z prognozy', () => {
  const state = (over: Partial<PlanState> = {}): PlanState => ({ target: 400_000, base: 12_900, recent: [12_900], streak: 2, stage: 1, openDays: 10, topUp: false, ...over });

  it('jeden sklep: prognoza sklepu (plan i pierwszy plan), numer sklepu z firmy', () => {
    const info = computeStoreInfo(layoutFor('plan-hud', 0));
    const s = createEconomy('plan-hud', info);
    s.franchisee.plan = state();
    const session = partnerSession();
    const f = firmOf(session);
    const view = { s, info, v: 1 };
    const got = activePlan(view, { f, v: 1 });
    expect(got.storeId).toBe(f.activeId);
    expect(got.plan).toEqual(forecastMonth(s, info).plan);
    expect(got.plan?.target).toBe(400_000);
    expect(got.first).toBeNull();
  });

  it('sieć: plan aktywnego sklepu z prognozy tego sklepu, nie z sumy sieci (suma nie ma planu)', () => {
    const session = partnerSession();
    openSecond(session);
    const f = firmOf(session);
    f.activeId = 2;
    const second = f.stores.find((st) => st.id === 2)!;
    second.econ.franchisee.plan = state({ stage: 2 });
    const got = activePlan({ s: second.econ, info: second.info, v: 1 }, { f, v: 1 });
    expect(got.storeId).toBe(2);
    expect(got.plan?.stage).toBe(2);
    expect(got.plan?.target).toBe(400_000);
  });
});

describe('HudPlan: wiersz planu w pasku', () => {
  it('bez planu nic, z planem wiersz z przełącznikiem aktywnego sklepu wysyłającym planTopUp', () => {
    const info = computeStoreInfo(layoutFor('plan-hud-2', 0));
    const s = createEconomy('plan-hud-2', info);
    const session = partnerSession();
    const f = firmOf(session);
    const game = fakeGame();
    const view = { s, info, v: 1 };
    const none = HudPlan({ view, firmView: { f, v: 1 }, game }) as Vnode;
    expect(none.type).toBe(PlanRow);
    expect(none.props.plan).toBeNull();
    expect(PlanRow(none.props as unknown as Parameters<typeof PlanRow>[0])).toBeNull();
    s.franchisee.plan = { target: 400_000, base: 12_900, recent: [12_900], streak: 2, stage: 0, openDays: 10, topUp: false };
    const row = HudPlan({ view, firmView: { f, v: 1 }, game }) as Vnode;
    expect(row.props.storeId).toBe(f.activeId);
    expect(row.props.plan).toEqual(forecastMonth(s, info).plan);
    const sw = walk(PlanRow(row.props as unknown as Parameters<typeof PlanRow>[0]) as Vnode).find((v) => v.props.role === 'switch')!;
    click(sw);
    expect(game.firm).toHaveBeenCalledWith({ type: 'planTopUp', storeId: f.activeId, on: true });
  });
});
