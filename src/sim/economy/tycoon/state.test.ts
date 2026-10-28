import { describe, expect, it } from 'vitest';
import { createCards, drawDayCards, resolveCard, type CardContext } from './cards';
import { FATIGUE } from './fatigue';
import { createSandbox, stepSandbox } from './sandbox';
import { applyCardOutcome, createTycoon, sanitizeTycoon, type TycoonInit, type TycoonState } from './state';
import { TRUST } from './trust';
import { wutTotal } from './wut';
import { weekdayOf } from './time';

const INIT: TycoonInit = {
  day: 0, seedHash: 99, metrics: { customers: 0, hotSold: 0, lost: 0, fines: 0, cleanSum: 0, cleanMinutes: 0 },
  scale: { dailyCustomers: 470, dailyMargin: 2000 },
};

describe('stan tycoona w jednym obiekcie', () => {
  it('nowa gra: zaufanie 60 (albo z dzisiejszego EconomyState.trust), pełna pula sił, czysta sala, KPI do niedzieli', () => {
    const t = createTycoon(INIT);
    expect(t.trust.value).toBe(TRUST.start);
    expect(createTycoon({ ...INIT, trust: 72 }).trust.value).toBe(72);
    expect(t.fatigue.energy).toBe(FATIGUE.pool);
    expect(t.hall.cleanliness).toBe(100);
    expect(t.kpi.toDay).toBe(5);
    expect(t.staff.profile).toBe('kolejka');
  });

  it('zapis po 15 dniach makiety wraca bez zmian; brak pola tycoon (stary zapis) daje świeży stan z zaufaniem ze starego pola', () => {
    const s = createSandbox();
    for (let i = 0; i < 15 * 1440; i++) stepSandbox(s);
    const t = s.tycoon;
    const restored = sanitizeTycoon(JSON.parse(JSON.stringify(t)), { ...INIT, day: 15, staff: 2 });
    expect(restored).toEqual(t);
    const legacy = sanitizeTycoon(undefined, { ...INIT, trust: 44, staff: 2 });
    expect(legacy.trust.value).toBe(44);
    expect(sanitizeTycoon({ version: 2 }, { ...INIT, staff: 2 })).toEqual(createTycoon(INIT));
  });

  it('zapis wraca bajt w bajt w wielu chwilach dwóch miesięcy gry (także w środku miesiąca)', () => {
    const s = createSandbox({ seed: 'bajt' });
    for (let i = 1; i <= 61 * 1440 - 360; i++) {
      stepSandbox(s);
      if (i % 2017 !== 0) continue;
      const day = Math.floor(s.minute / 1440);
      const json = JSON.stringify(s.tycoon);
      expect(JSON.stringify(sanitizeTycoon(JSON.parse(json), { ...INIT, day, staff: 2 }))).toBe(json);
    }
  });

  it('stary zapis z zaufaniem null albo tekstem: 60, a nie wypowiedzenie umowy', () => {
    expect(sanitizeTycoon(undefined, { ...INIT, trust: null as unknown as number, staff: 2 }).trust.value).toBe(TRUST.start);
    expect(createTycoon({ ...INIT, trust: 'abc' as unknown as number }).trust.value).toBe(TRUST.start);
  });

  it('uszkodzony kawałek naprawia się sam, reszta zostaje', () => {
    const t = createTycoon(INIT);
    t.fatigue.energy = 33;
    const raw = JSON.parse(JSON.stringify(t)) as Record<string, unknown>;
    raw.hall = 'zepsute';
    raw.cards = { pending: [{ id: 'nieznana' }] };
    const fixed = sanitizeTycoon(raw, { ...INIT, staff: 2 });
    expect(fixed.fatigue.energy).toBe(33);
    expect(fixed.hall.cleanliness).toBe(100);
    expect(fixed.cards.pending).toEqual([]);
  });

  it('skutek karty: zaufanie z przyczyną z karty, WUT, czas ludzi i siły po stronie tycoona; reszta dla ekonomii', () => {
    const t: TycoonState = createTycoon(INIT);
    const day = 10;
    const ctx: CardContext = {
      day, now: day * 1440, weekday: weekdayOf(day), deliveryToday: true, palletsToday: 5, staff: 2, trust: 60, cleanliness: 90,
      sidewalkPallets: 0, weather: 'sucho', dailyMargin: 2000, dailyRevenue: 10_000,
    };
    let card = null;
    for (let seed = 0; seed < 3000 && !card; seed++) {
      const cs = createCards(day);
      cs.nextCircularDay = day;
      card = drawDayCards(cs, ctx, seed).find((c) => c.id === 'okolnik-premia') ?? null;
      if (card) t.cards = cs;
    }
    if (!card) throw new Error('brak okólnika');
    const r = resolveCard(t.cards, card.seq, 0, card.showAt, 1);
    if (!r.ok) throw new Error(r.text);
    const side = applyCardOutcome(t, r.outcome);
    expect(side.bonus).toBe(card.answers[0].delta.bonus);
    expect(side.other).toBe(0);
    expect(t.staff.chores).toBe(45);
    expect(wutTotal(t.wut)).toBe(card.answers[0].delta.wut);
    expect(t.trust.month).toEqual({});
  });
});
