import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY } from '../catalog';
import {
  CARDS, DELTA_KEYS, answerValue, bestAnswer, cardDef, cardModifiers, cardsBlocking, closeCardsMonth, createCards, drawDayCards, fillText,
  pruneCardMods,
  resolveCard, sanitizeCards, visibleCards, type CardContext, type CardInstance, type CardsState, type Valuation,
} from './cards';
import { CIRCULARS, DECK, type CardDef } from './deck';
import { weekdayOf } from './time';

const SEED = 0x5eed;
const VAL: Valuation = { trust: 120, wut: 1, staffMinute: 0.6, energy: 3, reputation: 100, ogonki: 2 };

function ctx(day: number, over: Partial<CardContext> = {}): CardContext {
  return {
    day, now: day * MINUTES_PER_DAY, weekday: weekdayOf(day), deliveryToday: true, palletsToday: 5, staff: 2, trust: 60,
    cleanliness: 80, sidewalkPallets: 1, weather: 'sucho', dailyMargin: 2000, dailyRevenue: 10_000, ...over,
  };
}

/** Kontekst, w którym karta może wypaść (dzień tygodnia i pogoda pod jej warunek), na bazie dnia 10. */
function ctxFor(id: string, over: Partial<CardContext> = {}): CardContext {
  const def = cardDef(id)!;
  for (let day = 10; day < 17; day++) {
    for (const weather of ['sucho', 'deszcz'] as const) {
      const c = ctx(day, { weather, ...over });
      if (!def.when || def.when(c)) return c;
    }
  }
  throw new Error(`warunek karty ${id} nie do spełnienia`);
}

/** Karta z talii wyliczona tak jak przy losowaniu: losujemy (deterministycznie, kolejne seedy), aż wypadnie. */
function make(id: string, over: Partial<CardContext> = {}): CardInstance {
  const def = cardDef(id)!;
  const c = ctxFor(id, over);
  for (let s = 0; s < 5000; s++) {
    const fresh = createCards(c.day);
    fresh.nextCircularDay = def.kind === 'okolnik' ? c.day : c.day + 99;
    const card = drawDayCards(fresh, c, s).find((x) => x.id === id);
    if (card) return card;
  }
  throw new Error(`karta ${id} nie wypadła`);
}

const ALL: readonly CardDef[] = [...DECK, ...CIRCULARS];

describe('talia: treść', () => {
  it('identyfikatory są unikalne; każda karta ma 2–3 odpowiedzi', () => {
    expect(new Set(ALL.map((d) => d.id)).size).toBe(ALL.length);
    for (const d of ALL) {
      expect(d.answers.length, d.id).toBeGreaterThanOrEqual(2);
      expect(d.answers.length, d.id).toBeLessThanOrEqual(3);
      expect(d.title.length).toBeGreaterThan(3);
      for (const a of d.answers) {
        expect(a.label.length, d.id).toBeGreaterThan(3);
        expect(a.result.length, d.id).toBeGreaterThan(10);
      }
    }
  });

  it('są karty ze specu: FEFO o 18:00, glitch kasowy, „chory” pracownik w dzień dostawy, zapowiedź audytu, obowiązkowa promocja', () => {
    expect(cardDef('fefo')!.at).toBe(18 * 60);
    for (const id of ['glitch', 'chory', 'audyt', 'promocja']) expect(cardDef(id)).toBeDefined();
    expect(cardDef('chory')!.when!(ctx(3, { deliveryToday: false }))).toBe(false);
    expect(cardDef('chory')!.when!(ctx(3))).toBe(true);
  });

  it('każda odpowiedź ma widoczny koszt albo skutek (najwyżej jedna to „nic nie robię”); okólnik zawsze ma haczyk', () => {
    for (const d of ALL) {
      const card = make(d.id);
      const empty = card.answers.filter((a) => Object.keys(a.delta).length + a.mods.length + (a.risk ? 1 : 0) === 0);
      expect(empty.length, d.id).toBeLessThanOrEqual(1);
    }
    for (const d of CIRCULARS) {
      const card = make(d.id);
      const tempting = card.answers.filter((a) => (a.delta.bonus ?? 0) > 0 || (a.delta.trust ?? 0) > 0 || (a.delta.ogonki ?? 0) > 0
        || (a.delta.reputation ?? 0) > 0 || (a.delta.wut ?? 0) < 0);
      expect(tempting.length, d.id).toBeGreaterThan(0);
      for (const a of tempting) {
        const catchCost = (a.delta.staffMinutes ?? 0) > 0 || (a.delta.wut ?? 0) > 0 || (a.delta.energy ?? 0) < 0
          || (a.delta.cash ?? 0) < 0 || a.risk !== null;
        expect(catchCost, `${d.id}: haczyk`).toBe(true);
      }
    }
    const circular = make('okolnik-ankieta');
    const cs = createCards(circular.day);
    cs.pending.push(circular);
    const r = resolveCard(cs, circular.seq, 1, circular.showAt, SEED);
    expect(r.ok && r.outcome.xp).toBe(CARDS.xp.okolnik);
  });

  it('teksty po polsku, bez dziur w miejscach na liczby i bez prawdziwych marek', () => {
    const banned = ['excel', 'żabk', 'zabk', 'biedronk', 'lidl', 'carrefour', 'lewiatan', 'orlen', 'stokrotk', 'kaufland', 'auchan',
      'ekipa', 'książul', 'ksiazul', 'zappk', 'coca', 'pepsi', 'kinder', 'red bull', 'mcdonald', 'kfc', 'starbucks', 'inpost',
      'paczkomat', 'allegro', 'blik'];
    let polish = 0;
    for (const d of ALL) {
      const card = make(d.id);
      const texts = [d.title, d.text, ...d.answers.flatMap((a) => [a.label, a.result, a.risk?.text ?? ''])];
      for (const t of texts) {
        const filled = fillText(t, card.params);
        expect(filled, `${d.id}: ${t}`).not.toMatch(/\{\w+\}/);
        for (const b of banned) expect(filled.toLowerCase(), `${d.id}: ${b}`).not.toContain(b);
        if (/[ąćęłńóśźż]/i.test(filled)) polish++;
      }
    }
    expect(polish).toBeGreaterThan(ALL.length * 2);
  });
});

describe('losowanie kart dnia', () => {
  function season(seed: number, days: number, over: (day: number) => Partial<CardContext> = () => ({})): { cs: CardsState; byDay: CardInstance[][] } {
    const cs = createCards(0);
    const byDay: CardInstance[][] = [];
    for (let d = 0; d < days; d++) {
      byDay.push(drawDayCards(cs, ctx(d, over(d)), seed));
      cs.pending = [];
    }
    return { cs, byDay };
  }

  it('każdy dzień przynosi 1–3 karty, deterministycznie z seeda', () => {
    const a = season(SEED, 200);
    const b = season(SEED, 200);
    expect(JSON.stringify(a.byDay)).toBe(JSON.stringify(b.byDay));
    const counts = a.byDay.map((x) => x.length);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...counts)).toBe(3);
    const mean = counts.reduce((n, x) => n + x, 0) / counts.length;
    expect(mean).toBeGreaterThan(1.6);
    expect(mean).toBeLessThan(2.1);
    expect(JSON.stringify(season(SEED + 1, 200).byDay)).not.toBe(JSON.stringify(a.byDay));
  });

  it('drugie losowanie tego samego dnia nic nie daje', () => {
    const cs = createCards(0);
    expect(drawDayCards(cs, ctx(0), SEED).length).toBeGreaterThan(0);
    expect(drawDayCards(cs, ctx(0), SEED)).toEqual([]);
  });

  it('okólnik Centrali przychodzi raz na 2–4 dni', () => {
    const { byDay } = season(SEED, 240);
    const days = byDay.flatMap((cards, d) => (cards.some((c) => cardDef(c.id)!.kind === 'okolnik') ? [d] : []));
    const gaps = days.slice(1).map((d, i) => d - days[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2);
    expect(days.length).toBeGreaterThan(240 / 4.5);
    expect(days.length).toBeLessThanOrEqual(240 / 2);
    expect(gaps.filter((g) => g > 4).length).toBeLessThan(gaps.length / 10);
  });

  it('karta nie wraca przed końcem przerwy i nie wypada, gdy jej warunek nie jest spełniony', () => {
    const { byDay } = season(SEED, 300, (d) => ({ deliveryToday: d % 2 === 0, sidewalkPallets: d % 3 === 0 ? 2 : 0 }));
    const seen = new Map<string, number>();
    for (const [d, cards] of byDay.entries()) {
      for (const c of cards) {
        const def = cardDef(c.id)!;
        const last = seen.get(c.id);
        if (last !== undefined) expect(d - last, c.id).toBeGreaterThanOrEqual(def.cooldown);
        seen.set(c.id, d);
        if (c.id === 'chory' || c.id === 'widmo') expect(d % 2).toBe(0);
        if (c.id === 'sasiad') expect(d % 3).toBe(0);
        if (c.id === 'sejf') expect(weekdayOf(d)).toBe(6);
        if (c.id === 'audyt') expect(d).toBeGreaterThanOrEqual(3);
      }
    }
    expect(seen.size).toBeGreaterThan(15);
  });

  it('gdy przerwy blokują wszystkie karty, dzień i tak dostaje kartę: tę, która najdawniej była na biurku', () => {
    const cs = createCards(30);
    cs.nextCircularDay = 99;
    for (const d of DECK) cs.lastSeen[d.id] = 29;
    cs.lastSeen.memy = 25;
    const cards = drawDayCards(cs, ctx(30, { sidewalkPallets: 0 }), SEED);
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(cards[0].id).toBe('memy');
  });

  it('karta przychodzi o swojej porze; na starcie gry karta z wcześniejszą porą przychodzi od razu', () => {
    const c = make('fefo');
    expect(c.showAt).toBe(10 * MINUTES_PER_DAY + 18 * 60);
    const late = make('glitch', { now: 10 * MINUTES_PER_DAY + 14 * 60 });
    expect(late.showAt).toBe(10 * MINUTES_PER_DAY + 14 * 60);
  });

  it('pełne biurko: nowe karty nie przychodzą, a należny okólnik czeka na miejsce', () => {
    const cs = createCards(10);
    cs.nextCircularDay = 10;
    for (let i = 0; i < CARDS.maxPending; i++) cs.pending.push({ ...make('fefo'), seq: 1000 + i });
    expect(drawDayCards(cs, ctx(10), SEED)).toEqual([]);
    expect(cs.nextCircularDay).toBe(10);
    cs.pending.splice(0, 2);
    const next = drawDayCards(cs, ctx(11), SEED);
    expect(next.length).toBeGreaterThan(0);
    expect(next.length).toBeLessThanOrEqual(2);
    expect(next.some((c) => cardDef(c.id)!.kind === 'okolnik')).toBe(true);
    expect(cs.pending.length).toBeLessThanOrEqual(CARDS.maxPending);
  });

  it('kwoty rosną z wielkością sklepu', () => {
    const small = make('lodowka', { dailyMargin: 1000 });
    const big = make('lodowka', { dailyMargin: 8000 });
    expect(-(big.answers[0].delta.cash ?? 0)).toBeGreaterThan(-(small.answers[0].delta.cash ?? 0) * 4);
  });

  it('zaufanie zmienia przydział wiralowy na karcie i częstość audytu', () => {
    const low = make('wiralowy', { trust: 30 });
    const high = make('wiralowy', { trust: 90 });
    expect(high.params.s).toBeGreaterThan(low.params.s);
    expect(answerValue(high.answers[0], VAL)).toBeGreaterThan(answerValue(low.answers[0], VAL));
    const audits = (trust: number): number => season(SEED, 400, () => ({ trust })).byDay.flat().filter((x) => x.id === 'audyt').length;
    expect(audits(20)).toBeGreaterThan(audits(85));
  });
});

describe('rozstrzyganie', () => {
  it('odpowiedź gracza: skutek, karta znika, dziennik i licznik miesiąca', () => {
    const cs = createCards(10);
    const card = make('lodowka');
    cs.pending.push(card);
    expect(visibleCards(cs, card.showAt - 1)).toEqual([]);
    expect(visibleCards(cs, card.showAt)).toEqual([card]);
    expect(resolveCard(cs, card.seq, 0, card.showAt - 1, SEED)).toEqual({ ok: false, text: 'Na tę kartę jeszcze za wcześnie.' });
    expect(resolveCard(cs, card.seq, 7, card.showAt, SEED).ok).toBe(false);
    const r = resolveCard(cs, card.seq, 1, card.showAt + 5, SEED);
    if (!r.ok) throw new Error(r.text);
    expect(r.outcome.delta).toEqual(card.answers[1].delta);
    expect(r.outcome.xp).toBe(CARDS.xp.zdarzenie);
    expect(r.outcome.text).toMatch(/jogurty/);
    expect(cs.pending).toEqual([]);
    expect(cs.log).toEqual([{ seq: card.seq, id: 'lodowka', day: 10, answer: 1, riskHit: false }]);
    expect(r.outcome.isDefault).toBe(false);
    expect(closeCardsMonth(cs)).toEqual({ answered: 1, defaults: 0, riskHits: 0 });
    expect(resolveCard(cs, card.seq, 1, card.showAt + 6, SEED).ok).toBe(false);
  });

  it('ryzyko losuje się z numeru karty: ten sam los przy każdej odpowiedzi i po wczytaniu zapisu', () => {
    let hits = 0;
    for (let seed = 0; seed < 200; seed++) {
      const card = make('cenowki');
      const a = createCards(10);
      a.pending.push(card);
      const b = sanitizeCards(JSON.parse(JSON.stringify(a)), 10);
      const ra = resolveCard(a, card.seq, 2, card.showAt, seed);
      const rb = resolveCard(b, card.seq, 2, card.showAt + 30, seed);
      if (!ra.ok || !rb.ok) throw new Error('nie rozstrzygnięto');
      expect(rb.outcome.riskHit).toBe(ra.outcome.riskHit);
      if (ra.outcome.riskHit) {
        hits++;
        expect(ra.outcome.delta.fine).toBeLessThan(0);
        expect(ra.outcome.text).toMatch(/Mandat/);
      }
    }
    expect(hits).toBeGreaterThan(110);
    expect(hits).toBeLessThan(170);
  });

  it('karta decyzji zatrzymuje grę i czeka bez terminu; odpowiedź zaznaczona z góry nie wybiera się sama', () => {
    const cs = createCards(10);
    const card = make('chory');
    cs.pending.push(card);
    expect(card.defaultAnswer).toBe(cardDef('chory')!.defaultAnswer);
    expect(cardsBlocking(cs, card.showAt - 1)).toBe(false);
    expect(cardsBlocking(cs, card.showAt)).toBe(true);
    pruneCardMods(cs, card.showAt + 600);
    expect(cardsBlocking(cs, card.showAt + 600)).toBe(true);
    expect(cardModifiers(cs, card.showAt + 600)).toEqual({ traffic: 1, margin: 1, closed: false, staff: 0 });
    const r = resolveCard(cs, card.seq, card.defaultAnswer, card.showAt, SEED);
    if (!r.ok) throw new Error(r.text);
    expect(r.outcome.isDefault).toBe(true);
    expect(cardsBlocking(cs, card.showAt)).toBe(false);
    expect(closeCardsMonth(cs)).toEqual({ answered: 1, defaults: 1, riskHits: 0 });
  });

  it('każda karta ma odpowiedź zaznaczoną z góry, zwykle „nic nie robię” (najtańszą od ręki, nie najlepszą)', () => {
    for (const d of ALL) {
      expect(d.defaultAnswer, d.id).toBeGreaterThanOrEqual(0);
      expect(d.defaultAnswer, d.id).toBeLessThan(d.answers.length);
    }
    const fefo = make('fefo');
    expect(bestAnswer(fefo, VAL)).not.toBe(fefo.defaultAnswer);
  });

  it('spóźniona odpowiedź: efekt z godziną dotyczy dnia karty, więc zostaje tylko to, co jeszcze trwa', () => {
    const cs = createCards(10);
    const sick = make('chory');
    const match = make('mecz');
    cs.pending.push(sick, match);
    // „chory” o 15:00 tego samego dnia: brak osoby tylko do 23:00
    resolveCard(cs, sick.seq, 2, 10 * MINUTES_PER_DAY + 15 * 60, SEED);
    expect(cardModifiers(cs, 10 * MINUTES_PER_DAY + 15 * 60 + 30).staff).toBe(-1);
    expect(cardModifiers(cs, 11 * MINUTES_PER_DAY + 8 * 60).staff).toBe(0);
    // mecz dwa dni po fakcie: paleta piwa kosztuje, ale kibiców już nie ma
    const r = resolveCard(cs, match.seq, 0, 12 * MINUTES_PER_DAY + 9 * 60, SEED);
    if (!r.ok) throw new Error(r.text);
    expect(r.outcome.mods).toEqual([]);
    expect(r.outcome.delta.logistics).toBeLessThan(0);
    expect(cardModifiers(cs, 12 * MINUTES_PER_DAY + 18 * 60).traffic).toBe(1);
  });

  it('efekty na czas: ruch, marża, zamknięcie; po czasie znikają', () => {
    const cs = createCards(10);
    const promo = make('promocja');
    const glitch = make('glitch');
    cs.pending.push(promo, glitch);
    const t = glitch.showAt;
    resolveCard(cs, promo.seq, 0, t, SEED);
    resolveCard(cs, glitch.seq, 0, t, SEED);
    const now = cardModifiers(cs, t + 10);
    expect(now.traffic).toBeCloseTo(1.08);
    expect(now.margin).toBeCloseTo(0.9);
    expect(now.closed).toBe(true);
    expect(cardModifiers(cs, t + 61).closed).toBe(false);
    pruneCardMods(cs, t + MINUTES_PER_DAY);
    expect(cs.active).toEqual([]);
    expect(cardModifiers(cs, t + MINUTES_PER_DAY)).toEqual({ traffic: 1, margin: 1, closed: false, staff: 0 });
  });

  it('mecz: efekt zaczyna się wieczorem, nie w chwili decyzji', () => {
    const cs = createCards(10);
    const card = make('mecz');
    cs.pending.push(card);
    resolveCard(cs, card.seq, 0, card.showAt, SEED);
    expect(cardModifiers(cs, card.showAt + 30).traffic).toBe(1);
    expect(cardModifiers(cs, 10 * MINUTES_PER_DAY + 18 * 60).traffic).toBeCloseTo(1.35);
  });
});

describe('ocena odpowiedzi', () => {
  it('FEFO: gdy WUT boli, opłaca się przecenić albo oddać w paczkach; gdy pod progiem jest luz, można zaryzykować', () => {
    const card = make('fefo');
    const risky = card.defaultAnswer;   // „Zostaw, może ktoś się skusi”
    expect(bestAnswer(card, VAL)).not.toBe(risky);
    expect(bestAnswer(card, { ...VAL, wut: 0 })).toBe(risky);
  });

  it('glitch: mały rabat można przeczekać przy kasie, duży lepiej zamknąć', () => {
    const at = (p: number): number => {
      for (let s = 0; s < 3000; s++) {
        const cs = createCards(10);
        cs.nextCircularDay = 99;
        const card = drawDayCards(cs, ctx(10), s).find((x) => x.id === 'glitch' && x.params.p === p);
        if (card) return bestAnswer(card, VAL);
      }
      throw new Error(`brak glitcha ${p}%`);
    };
    expect(at(20)).toBe(1);
    expect(at(60)).toBe(0);
  });

  it('szacunek efektów na czas liczy tylko godziny otwarcia', () => {
    const card = make('promocja');
    const [traffic, margin] = card.answers[0].mods;
    expect(traffic.estimate).toBeCloseTo(0.08 * 2000, -1);
    expect(margin.estimate).toBeCloseTo(-0.1 * 2000, -1);
    expect(make('glitch').answers[0].mods[0].estimate).toBeCloseTo(-2000 * 60 / 1020, -1);
  });

  it('tekst z liczbami: formatowanie należy do interfejsu', () => {
    expect(fillText('Masz {n} kanapek za {v} zł, {x}.', { n: 12, v: 1080.4 })).toBe('Masz 12 kanapek za 1080 zł, {x}.');
    expect(fillText('{v} zł', { v: 1500 }, (n) => `${n / 1000} tys.`)).toBe('1.5 tys. zł');
  });
});

describe('zapis', () => {
  it('JSON w obie strony bez zmian (karty, efekty, dziennik)', () => {
    const cs = createCards(0);
    for (let d = 0; d < 12; d++) {
      drawDayCards(cs, ctx(d), SEED);
      for (const c of [...cs.pending]) {
        if (c.seq % 2 === 0) resolveCard(cs, c.seq, 0, c.showAt, SEED);
      }
      pruneCardMods(cs, (d + 1) * MINUTES_PER_DAY - 600);
    }
    const copy = JSON.parse(JSON.stringify(cs)) as CardsState;
    expect(sanitizeCards(copy, 12)).toEqual(cs);
  });

  it('zepsute dni w zapisie nie zatrzymują losowania na zawsze ani nie zostawiają efektu na lata', () => {
    const cs = createCards(10);
    const card = make('fefo');
    cs.pending.push(card, { ...card, seq: card.seq + 1, day: 500 }, { ...card, seq: card.seq + 2, showAt: 1e12 });
    cs.active.push({ kind: 'traffic', value: 0.5, from: 0, until: 1e12, seq: 1 });
    const raw = { ...JSON.parse(JSON.stringify(cs)), drawnDay: 999_999, nextCircularDay: 999_999, lastSeen: { fefo: 999_999 } };
    const s = sanitizeCards(raw, 10);
    expect(s.drawnDay).toBe(10);
    expect(s.nextCircularDay).toBeLessThanOrEqual(15);
    expect(s.lastSeen.fefo).toBe(10);
    expect(s.pending.map((c) => c.seq)).toEqual([card.seq, card.seq + 2]);
    expect(s.pending[1].showAt).toBeLessThan(11 * MINUTES_PER_DAY);
    expect(s.active[0].until).toBeLessThanOrEqual(14 * MINUTES_PER_DAY);
    expect(drawDayCards(s, ctx(11), SEED).length).toBeGreaterThan(0);
  });

  it('uszkodzona albo nieznana karta wypada, reszta zostaje; numer następnej karty nie powtarza starych', () => {
    const cs = createCards(10);
    const good = make('fefo');
    cs.pending.push(good, { ...good, id: 'z-nowszej-wersji' }, { ...good, answers: [] });
    cs.seq = 1;
    const s = sanitizeCards(JSON.parse(JSON.stringify(cs)), 10);
    expect(s.pending.map((c) => c.id)).toEqual(['fefo']);
    expect(s.seq).toBeGreaterThan(good.seq);
    expect(sanitizeCards('śmieci', 4)).toEqual(createCards(4));
    const bad = sanitizeCards(JSON.parse(JSON.stringify({ ...cs, pending: [{ ...good, defaultAnswer: 9 }] })), 10);
    expect(bad.pending[0].defaultAnswer).toBeLessThan(good.answers.length);
    for (const k of DELTA_KEYS) expect(typeof k).toBe('string');
  });
});
