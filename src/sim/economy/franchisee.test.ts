import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { GUARANTEE, INSTALLMENTS, MINUTES_PER_DAY, OPEN_TO, REMANENT } from './catalog';
import { dateOfDay, isLastDayOfMonth } from './calendar';
import { applyCommand } from './commands';
import { awaitingDecision, buyUpgrade, createEconomy, installmentRoom, stepMinute, type EconEvent, type EconomyState } from './economy';
import {
  createFranchisee, installmentLimit, installmentsDue, outstandingDebt, payInstallments, planFor, remanentDayFrom, sanitizeFranchisee,
  trustCreditMult,
} from './franchisee';
import { sanitizeEconomy } from './sanitize';
import { computeStoreInfo } from './storeInfo';
import { visibleCards } from './tycoon/cards';
import { UPGRADE_BY_ID, upgradeCost } from './upgrades';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));

function playTo(s: EconomyState, until: number, out: EconEvent[] = []): EconEvent[] {
  while (s.minute < until) {
    if (awaitingDecision(s)) {
      const c = visibleCards(s.tycoon.cards, s.minute)[0]!;
      applyCommand(s, info, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer });
      continue;
    }
    stepMinute(s, info, out);
  }
  return out;
}

describe('plany rat (INSTALLMENTS)', () => {
  it('liczba rat i opłata z ceny; rata w górę, ostatnia wyrównuje do złotówki', () => {
    expect(planFor(800)).toEqual({ months: 3, feeShare: 0.04, fee: 32, total: 832, monthly: 278 });
    expect(planFor(25_000)).toMatchObject({ months: 6, fee: 2_000, total: 27_000, monthly: 4_500 });
    expect(planFor(80_000)).toMatchObject({ months: 12, fee: 12_000, total: 92_000, monthly: 7_667 });
    for (const price of [800, 3_500, 25_000, 80_000, 200_000]) {
      const p = planFor(price);
      expect(p.total).toBeGreaterThan(price);   // gotówka zawsze taniej
      const f = createFranchisee(0);
      f.installments.push({ id: 1, label: 'x', price, fee: p.fee, total: p.total, monthly: p.monthly, paid: 0, months: p.months });
      let paid = 0;
      for (let m = 0; m < p.months; m++) paid += payInstallments(f);
      expect(paid).toBe(p.total);
      expect(f.installments).toEqual([]);
      expect(outstandingDebt(f)).toBe(0);
    }
  });

  it('limit: 35% przelewu bazowego razy mnożnik zaufania; bez historii od gwarancji, potem średnia z ostatnich trzech przelewów', () => {
    expect(installmentLimit([], 50)).toBe(Math.floor(INSTALLMENTS.limitShare * GUARANTEE.income));
    const h = [{ transfer: 10_000 }, { transfer: 30_000 }, { transfer: 40_000 }, { transfer: 50_000 }, {}];
    expect(installmentLimit(h, 50)).toBe(Math.floor(INSTALLMENTS.limitShare * 40_000));
    expect(installmentLimit(h, 90)).toBe(Math.floor(INSTALLMENTS.limitShare * 40_000 * 1.5));
    expect(trustCreditMult(24)).toBe(0);
    expect(trustCreditMult(25)).toBe(0.5);
    expect(trustCreditMult(70)).toBe(1.25);
    expect(installmentLimit([], 10)).toBe(0);
  });
});

describe('zakup na raty', () => {
  it('ulepszenie od razu, gotówka bez zmian; pierwsza rata schodzi z przelewu tego samego miesiąca', () => {
    const s = createEconomy(SEED, info);
    const cash = s.cash;
    const price = upgradeCost(UPGRADE_BY_ID.wozek, 0);
    const r = buyUpgrade(s, 'wozek', true);
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/na raty: 3 ×/);
    expect(s.upgrades.wozek).toBe(1);
    expect(s.cash).toBe(cash);
    expect(s.month.investments).toBe(0);
    expect(s.franchisee.installments).toEqual([{ id: 1, label: 'Wózek paletowy', price, ...planFor(price), feeShare: undefined, paid: 0 }].map(
      ({ feeShare: _f, ...x }) => x,
    ));
    const out = playTo(s, 29 * MINUTES_PER_DAY + OPEN_TO + 1);
    const st = out.find((e) => e.kind === 'month')!.report!.statement!;
    expect(st.installments).toBe(planFor(price).monthly);
    expect(s.franchisee.installments[0]!.paid).toBe(planFor(price).monthly);
    expect(s.total.installments).toBe(planFor(price).monthly);
  });

  it('ponad wolny limit albo przy zaufaniu poniżej 25: odmowa, nic się nie zmienia', () => {
    const s = createEconomy(SEED, info);
    s.level = 30;
    s.remontLevel = 0;
    s.tycoon.trust.value = 10;
    const before = JSON.stringify(s);
    expect(buyUpgrade(s, 'ulotki', true)).toEqual({ ok: false, text: expect.stringMatching(/nie finansuje/) });
    expect(JSON.stringify(s)).toBe(before);
    s.tycoon.trust.value = 50;
    const room = installmentRoom(s);
    expect(room.free).toBe(room.limit);
    expect(applyCommand(s, info, { type: 'buyUpgrade', id: 'humanoid', raty: true }).result.ok).toBe(false);   // 220 tys.: rata ponad limit
    expect(s.franchisee.installments).toEqual([]);
  });

  it('gwarancja razem z ratami: dopłata do 25 tys. przed potrąceniami, a raty schodzą normalnie', () => {
    const s = createEconomy(SEED, info);
    buyUpgrade(s, 'wozek', true);
    playTo(s, 29 * MINUTES_PER_DAY + OPEN_TO);
    s.month.margin = 5_000;   // słaby miesiąc na licznikach: gwarancja dopłaci
    s.month.bonus = 0;
    s.month.fineCount = 0;
    s.tycoon.trust.value = 60;
    const st = playTo(s, s.minute + 1).find((e) => e.kind === 'month')!.report!.statement!;
    expect(st.guarantee).toBeGreaterThan(0);
    expect(st.installments).toBe(planFor(upgradeCost(UPGRADE_BY_ID.wozek, 0)).monthly);
    expect(st.net).toBeCloseTo(st.transfer - st.installments - st.pallets - st.remanent - st.costs, 6);
  });
});

describe('termin remanentu', () => {
  it('ostatni dzień co trzeciego miesiąca gry: 30 listopada, potem koniec lutego, maja i sierpnia', () => {
    const days: number[] = [];
    let d = remanentDayFrom(0, false);
    for (let i = 0; i < 4; i++) { days.push(d); d = remanentDayFrom(d, true); }
    expect(days[0]).toBe(90);
    expect(days.map((x) => { const g = dateOfDay(x); return `${g.date}.${g.month + 1}`; })).toEqual(['30.11', '28.2', '31.5', '31.8']);
    for (const x of days) expect(isLastDayOfMonth(x)).toBe(true);
  });

  it('nowa gra i migracja: następny remanent nie wcześniej niż przy końcu gwarancji; w dniu remanentu po 5:00 — kolejny', () => {
    expect(createFranchisee(0).remanent.nextDay).toBe(90);
    expect(createFranchisee(45 * MINUTES_PER_DAY).remanent.nextDay).toBe(90);
    expect(createFranchisee(90 * MINUTES_PER_DAY + REMANENT.at - 1).remanent.nextDay).toBe(90);
    expect(createFranchisee(90 * MINUTES_PER_DAY + REMANENT.at + 1).remanent.nextDay).toBeGreaterThan(90);
  });
});

describe('zapis w połowie miesiąca i migracja', () => {
  it('saldo, naliczenia, raty i remanent przechodzą przez zapis bajt w bajt', () => {
    const s = createEconomy(SEED, info);
    buyUpgrade(s, 'ulotki', true);
    playTo(s, 45 * MINUTES_PER_DAY + 13 * 60);
    expect(s.franchisee.month.margin).toBeGreaterThan(0);
    expect(installmentsDue(s.franchisee)).toBeGreaterThan(0);
    const back = sanitizeEconomy(JSON.parse(JSON.stringify(s)), createEconomy(SEED, info), info)!;
    expect(JSON.stringify(back)).toBe(JSON.stringify(s));
  });

  it('zapis bez bloku franczyzobiorcy (sprzed SIM_VERSION 6): saldo zero, okres remanentu od obrotu miesiąca', () => {
    const f = sanitizeFranchisee(undefined, 45 * MINUTES_PER_DAY + 13 * 60, 123_456);
    expect(f.month).toEqual({ margin: 0, bonus: 0, pallets: 0, wages: 0, media: 0 });
    expect(f.installments).toEqual([]);
    expect(f.remanent).toMatchObject({ revenue: 123_456, fromDay: 45, nextDay: 90, known: false, pending: 0, last: null });
  });
});
