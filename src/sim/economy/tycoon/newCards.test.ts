import { describe, expect, it } from 'vitest';
import { EN_CARDS } from '@/i18n/en/cards';
import { FINE_BASE, MINUTES_PER_DAY, PALLET_FEE } from '../catalog';
import {
  CARDS, cardDef, cardModifiers, createCards, drawDayCards, fillText, resolveCard, sanitizeCards,
  type CardContext, type CardDelta, type CardInstance, type CardMod,
} from './cards';
import { DECK, NEW_CARD_IDS_4B, byDistrict, type CardDef } from './deck';
import { roundNice, weekdayOf } from './time';

/*
 * Dwanaście kart dnia z etapu 4b (spec §5.5). Liczby w specu są SKUTECZNE, czyli po mnożniku `CARDS.stakes` (×3 dla pieniędzy, zaufania,
 * reputacji, WUT, opłat logistycznych, ruchu i marży), a `deck.ts` trzyma wartości przed nim, tak jak starsze karty (rozstrzygnięcie etapu 4b).
 * Dlatego ten plik sprawdza skutek gotowej karty (`drawDayCards`, `resolveCard`, `cardModifiers`), a nie liczby wpisane w talii.
 */

const SEED = 0x5eed;
const DM = 2000;
const H = 60;

type District = NonNullable<CardContext['district']>;
const PLACES: readonly [label: string, over: Partial<CardContext>][] = [
  ['none', {}],
  ['osiedle', { district: 'osiedle', difficult: 1 }],
  ['srodmiescie', { district: 'srodmiescie', difficult: 0.6 }],
  ['dworzec', { district: 'dworzec', difficult: 1.6 }],
  ['biurowce', { district: 'biurowce', difficult: 0.7 }],
];

function ctx(day: number, over: Partial<CardContext> = {}): CardContext {
  return {
    day, now: day * MINUTES_PER_DAY, weekday: weekdayOf(day), deliveryToday: true, palletsToday: 5, staff: 2, trust: 60,
    cleanliness: 80, sidewalkPallets: 1, weather: 'sucho', dailyMargin: DM, dailyRevenue: 10_000, ...over,
  };
}

const weightOf = (d: CardDef, c: CardContext): number => (typeof d.weight === 'function' ? d.weight(c) : d.weight);
const def = (id: string): CardDef => DECK.find((d) => d.id === id)!;

/** Karta wylosowana tak jak o północy (kolejne seedy, aż wypadnie) w kontekście z dnia 10. */
function make(id: string, over: Partial<CardContext> = {}): CardInstance {
  const c = ctx(10, over);
  for (let s = 0; s < 5000; s++) {
    const fresh = createCards(c.day);
    fresh.nextCircularDay = c.day + 99;
    const card = drawDayCards(fresh, c, s).find((x) => x.id === id);
    if (card) return card;
  }
  throw new Error(`karta ${id} nie wypadła`);
}

/** Karta na biurku i odpowiedź `answer` udzielona w minucie dnia `at` (domyślnie od razu po pokazaniu karty). */
function answered(id: string, answer: number, at?: number, over: Partial<CardContext> = {}): { cs: ReturnType<typeof createCards>; card: CardInstance; day0: number } {
  const card = make(id, over);
  const cs = createCards(card.day);
  cs.pending.push(card);
  const day0 = card.day * MINUTES_PER_DAY;
  const r = resolveCard(cs, card.seq, answer, at === undefined ? card.showAt : day0 + at, SEED);
  expect(r.ok, `${id}[${answer}]`).toBe(true);
  return { cs, card, day0 };
}

const traffic = (cs: ReturnType<typeof createCards>, minute: number): number => cardModifiers(cs, minute).traffic;

// --- Tabela ze specu §5.5 ---------------------------------------------------------------------------------------------

/** Wagi none / osiedle / śródmieście / dworzec / biurowce. */
const WEIGHTS: Record<string, readonly [number, number, number, number, number]> = {
  'karty-zrzut': [0.8, 1.0, 0.9, 0.6, 0.5],
  festyn: [0.6, 1.4, 0.4, 0.3, 0.3],
  sanepid: [1, 1, 1, 1.2, 0.8],
  'awaria-pradu': [0.7, 0.7, 0.7, 0.7, 0.7],
  rozkopy: [0.8, 0.8, 1.2, 0.8, 0.8],
  koncert: [0.5, 0.6, 1.3, 1.3, 0.4],
  elearning: [0.8, 0.8, 0.8, 0.8, 0.8],
  'catering-korpo': [0.3, 0.2, 0.8, 0.3, 2.0],
  kibice: [0.3, 0.2, 0.6, 2.0, 0.1],
  'bon-centrali': [0.6, 0.6, 0.6, 0.6, 0.6],
  'ai-inwentaryzacja': [0.5, 0.5, 0.5, 0.5, 0.5],
  wybory: [1.0, 1.3, 0.8, 0.5, 0.5],
};

const SHAPE: Record<string, { title: string; at: number; cooldown: number; defaultAnswer: number; answers: number }> = {
  'karty-zrzut': { title: 'Zrzut Traszkomonów', at: 6 * H, cooldown: 18, defaultAnswer: 0, answers: 3 },
  festyn: { title: 'Festyn osiedlowy z pierogami', at: 9 * H, cooldown: 21, defaultAnswer: 2, answers: 3 },
  sanepid: { title: 'Sanepid na rowerze', at: 11 * H, cooldown: 25, defaultAnswer: 0, answers: 2 },
  'awaria-pradu': { title: 'Awaria prądu na pół dzielnicy', at: 14 * H, cooldown: 30, defaultAnswer: 1, answers: 3 },
  rozkopy: { title: 'ZDM rozkopał chodnik', at: 7 * H, cooldown: 30, defaultAnswer: 1, answers: 2 },
  koncert: { title: 'Koncert disco polo na stadionie', at: 16 * H, cooldown: 21, defaultAnswer: 1, answers: 3 },
  elearning: { title: 'Obowiązkowe e-learningi Centrali', at: 8 * H, cooldown: 30, defaultAnswer: 2, answers: 3 },
  'catering-korpo': { title: 'Korporacja zamawia kanapki na spotkanie', at: 9 * H, cooldown: 10, defaultAnswer: 0, answers: 2 },
  kibice: { title: 'Pociąg z kibicami', at: 15 * H, cooldown: 14, defaultAnswer: 2, answers: 3 },
  'bon-centrali': { title: 'Bon motywacyjny od Centrali', at: 10 * H, cooldown: 40, defaultAnswer: 1, answers: 2 },
  'ai-inwentaryzacja': { title: 'Centrala testuje AI do liczenia towaru', at: 6 * H, cooldown: 45, defaultAnswer: 1, answers: 2 },
  wybory: { title: 'Lokal wyborczy w szkole obok', at: 7 * H, cooldown: 60, defaultAnswer: 1, answers: 2 },
};

/** Oczekiwany skutek odpowiedzi: pewne zmiany, efekty na czas (rodzaj, wartość, minuty, od której minuty dnia) i ryzyko. */
interface Eff {
  delta: CardDelta;
  mods?: readonly (readonly [kind: CardMod['kind'], value: number, minutes: number, from: number | null])[];
  risk?: { chance: number; delta: CardDelta };
}
const DAY3 = 3 * MINUTES_PER_DAY;

/** Skutki skuteczne przy marży dnia 2000 zł i czystości 80 (spec §5.5); kwoty „dM” liczone jak `roundNice` przy losowaniu. */
function expected(id: string, p: Record<string, number>): Eff[] {
  const dm = (x: number): number => roundNice(x * DM);
  switch (id) {
    case 'karty-zrzut': return [
      { delta: { staffMinutes: 40, trust: 1, reputation: 1 }, mods: [['traffic', 0.9, 360, 6 * H]] },
      { delta: {}, mods: [['traffic', 1.6, 240, 6 * H]], risk: { chance: 0.5, delta: { reputation: -3, wut: dm(0.15) } } },
      { delta: { trust: -2 } },
    ];
    case 'festyn': return [
      { delta: { cash: dm(-0.1), staffMinutes: 90 }, mods: [['traffic', 0.3, 480, 10 * H], ['margin', 0.15, 480, 10 * H]] },
      { delta: { cash: dm(-0.02) }, mods: [['traffic', 0.2, 480, null]] },
      { delta: {} },
    ];
    case 'sanepid': return [
      { delta: { staffMinutes: 30 }, risk: { chance: 0.1, delta: { cash: roundNice(-1.5 * FINE_BASE), trust: -2 } } },
      { delta: { cash: -15 }, risk: { chance: 0.3, delta: { trust: -3 } } },
    ];
    case 'awaria-pradu': return [
      { delta: { cash: dm(-0.15), staffMinutes: 30 } },
      { delta: { wut: dm(0.05) }, mods: [['closed', 1, 120, null]] },
      { delta: {}, mods: [['traffic', -0.3, 120, null]], risk: { chance: 0.4, delta: { wut: dm(0.2) } } },
    ];
    case 'rozkopy': return [
      { delta: { cash: dm(-0.08), staffMinutes: 45 }, mods: [['traffic', -0.1, DAY3, null]] },
      { delta: {}, mods: [['traffic', -0.3, DAY3, null]] },
    ];
    case 'koncert': return [
      { delta: { logistics: -PALLET_FEE, staffMinutes: 30 }, mods: [['traffic', 0.6, 300, 18 * H], ['margin', 0.05, 300, 18 * H]] },
      { delta: {}, mods: [['traffic', 0.3, 240, 18 * H]] },
      { delta: { cash: dm(-0.04) }, mods: [['traffic', 0.6, 300, 18 * H]] },
    ];
    case 'elearning': return [
      { delta: { staffMinutes: 180, trust: 2 } },
      { delta: { staffMinutes: 20 }, risk: { chance: 0.35, delta: { trust: -4 } } },
      { delta: { trust: -2 } },
    ];
    case 'catering-korpo': return [
      { delta: { cash: roundNice(4 * p.n!), staffMinutes: 60 }, risk: { chance: 0.2, delta: { cash: roundNice(-4 * p.n!) } } },
      { delta: { reputation: -1 } },
    ];
    case 'kibice': return [
      { delta: { cash: dm(-0.05) }, mods: [['traffic', 0.5, 180, 16 * H]] },
      { delta: {}, mods: [['closed', 1, 120, 16 * H]] },
      { delta: {}, mods: [['traffic', 0.5, 180, 16 * H]], risk: { chance: 0.6, delta: { wut: dm(0.25), reputation: -2 } } },
    ];
    case 'bon-centrali': return [
      { delta: { cash: dm(0.2), logistics: -PALLET_FEE } },
      { delta: {} },
    ];
    case 'ai-inwentaryzacja': return [
      { delta: { trust: 3 }, risk: { chance: 0.5, delta: { wut: dm(0.1) } } },
      { delta: { trust: -1 } },
    ];
    case 'wybory': return [
      { delta: {}, mods: [['traffic', 0.25, 600, 7 * H], ['margin', -0.05, 600, 7 * H]] },
      { delta: {}, mods: [['traffic', 0.15, 600, 7 * H]] },
    ];
    default: throw new Error(id);
  }
}

describe('dwanaście kart dnia z 4b: talia', () => {
  it('12 nowych kart na końcu DECK, w kolejności NEW_CARD_IDS_4B, każda z EN_CARDS', () => {
    expect(NEW_CARD_IDS_4B).toHaveLength(12);
    expect(DECK.slice(-12).map((d) => d.id)).toEqual([...NEW_CARD_IDS_4B]);
    expect([...NEW_CARD_IDS_4B]).toEqual(Object.keys(SHAPE));
    for (const id of NEW_CARD_IDS_4B) expect(EN_CARDS[id], id).toBeDefined();
    expect(new Set(DECK.map((d) => d.id)).size).toBe(DECK.length);
  });

  it('byDistrict: kontekst bez district → none; każda dzielnica → jej waga', () => {
    const w = byDistrict({ none: 1, osiedle: 2, srodmiescie: 3, dworzec: 4, biurowce: 5 });
    expect(w(ctx(3))).toBe(1);
    expect(w(ctx(3, { difficult: 1.6 }))).toBe(1);
    expect(w(ctx(3, { district: 'osiedle' }))).toBe(2);
    expect(w(ctx(3, { district: 'srodmiescie' }))).toBe(3);
    expect(w(ctx(3, { district: 'dworzec' }))).toBe(4);
    expect(w(ctx(3, { district: 'biurowce' }))).toBe(5);
  });

  it('wagi z tabeli §5.5 (5 kontekstów × 12 kart)', () => {
    for (const id of NEW_CARD_IDS_4B) {
      PLACES.forEach(([label, over], i) => expect(weightOf(def(id), ctx(3, over)), `${id}: ${label}`).toBe(WEIGHTS[id]![i]));
    }
  });

  it('tytuł, godzina, przerwa, odpowiedź domyślna i liczba odpowiedzi jak w tabeli §5.5; nowe karty nie mają warunków', () => {
    for (const id of NEW_CARD_IDS_4B) {
      const d = def(id);
      const s = SHAPE[id]!;
      expect(d.title, id).toBe(s.title);
      expect(d.kind, id).toBe('zdarzenie');
      expect(d.at, id).toBe(s.at);
      expect(d.cooldown, id).toBe(s.cooldown);
      expect(d.defaultAnswer, id).toBe(s.defaultAnswer);
      expect(d.answers, id).toHaveLength(s.answers);
      expect(d.when, `${id}: bez warunku`).toBeUndefined();
    }
  });

  it('karta-zrzut wypada z odpowiedzią domyślną 0, o 6:00, z przerwą 18 dni', () => {
    const card = make('karty-zrzut');
    expect(card.defaultAnswer).toBe(0);
    expect(card.showAt).toBe(card.day * MINUTES_PER_DAY + 6 * H);
    expect(cardDef('karty-zrzut')!.cooldown).toBe(18);
  });

  it('wartości w talii są pisane pod CARDS.stakes = 3 (zmiana mnożnika wymaga przeliczenia kart 4b)', () => {
    expect(CARDS.stakes).toBe(3);
  });
});

describe('dwanaście kart dnia z 4b: skutki skuteczne (po CARDS.stakes)', () => {
  for (const id of Object.keys(SHAPE)) {
    it(`${id}: pewne zmiany, efekty na czas i ryzyka każdej odpowiedzi jak w tabeli §5.5`, () => {
      const card = make(id);
      const want = expected(id, card.params);
      expect(card.answers).toHaveLength(want.length);
      want.forEach((w, i) => {
        const a = card.answers[i]!;
        expect(a.delta, `${id}[${i}] delta`).toEqual(w.delta);
        expect(a.mods.map((m) => [m.kind, m.minutes, m.from]), `${id}[${i}] efekty`)
          .toEqual((w.mods ?? []).map(([kind, , minutes, from]) => [kind, minutes, from]));
        (w.mods ?? []).forEach(([, value], j) => expect(a.mods[j]!.value, `${id}[${i}] wartość efektu ${j}`).toBeCloseTo(value, 9));
        if (w.risk) {
          expect(a.risk, `${id}[${i}] ryzyko`).not.toBeNull();
          expect(a.risk!.chance, `${id}[${i}] szansa`).toBeCloseTo(w.risk.chance, 9);
          expect(a.risk!.delta, `${id}[${i}] skutek ryzyka`).toEqual(w.risk.delta);
        } else {
          expect(a.risk, `${id}[${i}] bez ryzyka`).toBeNull();
        }
      });
    });
  }

  it('kwoty „× dM” rosną z marżą dnia sklepu, a stałe (opłata za paletę, mandat bazowy) nie', () => {
    const big = make('awaria-pradu', { dailyMargin: 8000 });
    expect(big.answers[0]!.delta.cash).toBe(roundNice(-0.15 * 8000));
    expect(big.answers[2]!.risk!.delta.wut).toBe(roundNice(0.2 * 8000));
    const bon = make('bon-centrali', { dailyMargin: 8000 });
    expect(bon.answers[0]!.delta).toEqual({ cash: roundNice(0.2 * 8000), logistics: -PALLET_FEE });
    const sanepid = make('sanepid', { dailyMargin: 8000 });
    expect(sanepid.answers[0]!.risk!.delta.cash).toBe(roundNice(-1.5 * FINE_BASE));
  });

  it('sanepid: szansa na mandat to 0,6 przy czystości poniżej 60, inaczej 0,1', () => {
    expect(make('sanepid', { cleanliness: 59 }).answers[0]!.risk!.chance).toBeCloseTo(0.6, 9);
    expect(make('sanepid', { cleanliness: 60 }).answers[0]!.risk!.chance).toBeCloseTo(0.1, 9);
    expect(make('sanepid', { cleanliness: 95 }).answers[0]!.risk!.chance).toBeCloseTo(0.1, 9);
  });

  it('catering: n z przedziału 40–100 (osiągalna każda wartość), premia i strata ryzyka to dokładnie ±4n', () => {
    const params = def('catering-korpo').params!;
    const ns = new Set<number>();
    for (let i = 0; i < 1000; i++) ns.add(params(ctx(10), i / 1000).n!);
    expect(Math.min(...ns)).toBe(40);
    expect(Math.max(...ns)).toBe(100);
    expect(ns.size).toBe(61);
    const card = make('catering-korpo');
    const k = card.params.n!;
    expect(card.answers[0]!.delta.cash).toBe(roundNice(4 * k));
    expect(card.answers[0]!.risk!.delta.cash).toBe(roundNice(-4 * k));
  });

  it('zrzut: w kartonie od 60 do 220 saszetek, co 20', () => {
    const params = def('karty-zrzut').params!;
    const ns = new Set<number>();
    for (let i = 0; i < 1000; i++) ns.add(params(ctx(10), i / 1000).n!);
    expect([...ns].sort((a, b) => a - b)).toEqual([60, 80, 100, 120, 140, 160, 180, 200, 220]);
  });

  it('żadna kara ruchu nie zabija ruchu: najgorszy efekt to −0,3 skutecznie (ruch ×0,7), także gdy kilka kart nakłada się naraz', () => {
    for (const id of NEW_CARD_IDS_4B) {
      for (const a of make(id).answers) for (const m of a.mods) if (m.kind === 'traffic') expect(m.value, id).toBeGreaterThanOrEqual(-0.3 - 1e-9);
    }
    const { cs, card, day0 } = answered('rozkopy', 1);
    expect(traffic(cs, card.showAt)).toBeCloseTo(0.7, 9);
    expect(traffic(cs, day0 + 2 * MINUTES_PER_DAY)).toBeCloseTo(0.7, 9);
    expect(traffic(cs, card.showAt + DAY3)).toBe(1);
    const dark = answered('awaria-pradu', 2);
    const both = createCards(dark.card.day);
    both.active.push(...cs.active, ...dark.cs.active);
    expect(traffic(both, dark.card.showAt + 1)).toBeCloseTo(0.7 * 0.7, 9);
  });
});

describe('karty-zrzut: poranna fala klientów', () => {
  it('odpowiedź 0 (limit 2 saszetki): ruch ×1,9 o 9:00 i ×1 o 12:01 tego dnia', () => {
    const { cs, day0 } = answered('karty-zrzut', 0);
    expect(traffic(cs, day0 + 6 * H)).toBeCloseTo(1.9, 9);
    expect(traffic(cs, day0 + 9 * H)).toBeCloseTo(1.9, 9);
    expect(traffic(cs, day0 + 12 * H - 1)).toBeCloseTo(1.9, 9);
    expect(traffic(cs, day0 + 12 * H + 1)).toBe(1);
    expect(traffic(cs, day0 + MINUTES_PER_DAY + 9 * H)).toBe(1);
  });

  it('odpowiedź 1 (bez limitu): ruch ×2,6 o 7:00 i ×1 o 10:01', () => {
    const { cs, day0 } = answered('karty-zrzut', 1);
    expect(traffic(cs, day0 + 7 * H)).toBeCloseTo(2.6, 9);
    expect(traffic(cs, day0 + 10 * H - 1)).toBeCloseTo(2.6, 9);
    expect(traffic(cs, day0 + 10 * H + 1)).toBe(1);
  });

  it('odpowiedź 2 (odsyłam karton): bez zmiany ruchu, zaufanie −2', () => {
    const { cs, day0, card } = answered('karty-zrzut', 2);
    expect(traffic(cs, day0 + 8 * H)).toBe(1);
    expect(card.answers[2]!.delta).toEqual({ trust: -2 });
  });

  it('tytuł i tekst mówią o Traszkomonach (parodia własna gry), po angielsku o „Traszkomon”; bez cudzych marek kart', () => {
    const d = def('karty-zrzut');
    expect(d.title).toMatch(/Traszkomon/);
    expect(d.text).toMatch(/Traszkomon/);
    expect(EN_CARDS['karty-zrzut']!.title).toMatch(/Traszkomon/);
    expect(EN_CARDS['karty-zrzut']!.text).toMatch(/Traszkomon/);
    const all = NEW_CARD_IDS_4B.flatMap((id) => {
      const x = def(id);
      const en = EN_CARDS[id]!;
      return [x.title, x.text, ...x.answers.flatMap((a) => [a.label, a.result, a.risk?.text ?? '']),
        en.title, en.text, ...en.answers.flatMap((a) => [a.label, a.result, a.risk ?? ''])];
    });
    for (const t of all) expect(t.toLowerCase(), t).not.toMatch(/pok[eé]mon|pikachu|pok[eé]ball|nintendo/);
  });
});

describe('fale ruchu startują o swojej godzinie, nie od decyzji', () => {
  it('koncert (18:00): odpowiedź o 16:30 nie rusza ruchu przed 18:00', () => {
    for (const [answer, value] of [[0, 0.6], [1, 0.3], [2, 0.6]] as const) {
      const { cs, day0 } = answered('koncert', answer, 16 * H + 30);
      expect(traffic(cs, day0 + 16 * H + 30), `odpowiedź ${answer}: w chwili decyzji`).toBe(1);
      expect(traffic(cs, day0 + 18 * H - 1), `odpowiedź ${answer}: 17:59`).toBe(1);
      expect(traffic(cs, day0 + 18 * H), `odpowiedź ${answer}: 18:00`).toBeCloseTo(1 + value, 9);
    }
    const { cs, day0 } = answered('koncert', 1, 16 * H + 30);
    expect(traffic(cs, day0 + 22 * H - 1)).toBeCloseTo(1.3, 9);
    expect(traffic(cs, day0 + 22 * H)).toBe(1);
  });

  it('kibice (16:00): odpowiedź o 15:20 nie rusza ruchu przed 16:00; „Zamykam do odjazdu” zamyka sklep 16:00–18:00', () => {
    for (const answer of [0, 2]) {
      const { cs, day0 } = answered('kibice', answer, 15 * H + 20);
      expect(traffic(cs, day0 + 15 * H + 20), `odpowiedź ${answer}`).toBe(1);
      expect(traffic(cs, day0 + 16 * H - 1), `odpowiedź ${answer}: 15:59`).toBe(1);
      expect(traffic(cs, day0 + 16 * H), `odpowiedź ${answer}: 16:00`).toBeCloseTo(1.5, 9);
      expect(traffic(cs, day0 + 19 * H), `odpowiedź ${answer}: 19:00`).toBe(1);
    }
    const { cs, day0 } = answered('kibice', 1, 15 * H + 20);
    expect(cardModifiers(cs, day0 + 15 * H + 30).closed).toBe(false);
    expect(cardModifiers(cs, day0 + 16 * H).closed).toBe(true);
    expect(cardModifiers(cs, day0 + 17 * H + 59).closed).toBe(true);
    expect(cardModifiers(cs, day0 + 18 * H).closed).toBe(false);
  });

  it('wybory (7:00): odpowiedź o 7:40 liczy ruch i marżę od 7:00, do 17:00', () => {
    const { cs, day0 } = answered('wybory', 0, 7 * H + 40);
    expect(traffic(cs, day0 + 7 * H + 10)).toBeCloseTo(1.25, 9);
    expect(cardModifiers(cs, day0 + 7 * H + 10).margin).toBeCloseTo(0.95, 9);
    expect(traffic(cs, day0 + 17 * H - 1)).toBeCloseTo(1.25, 9);
    expect(traffic(cs, day0 + 17 * H)).toBe(1);
    const quiet = answered('wybory', 1, 7 * H + 40);
    expect(traffic(quiet.cs, quiet.day0 + 7 * H + 10)).toBeCloseTo(1.15, 9);
    expect(cardModifiers(quiet.cs, quiet.day0 + 7 * H + 10).margin).toBe(1);
  });

  it('festyn: stoisko z hot-dogami rusza o 10:00, plakat od decyzji', () => {
    const stall = answered('festyn', 0, 9 * H + 15);
    expect(traffic(stall.cs, stall.day0 + 9 * H + 30)).toBe(1);
    expect(traffic(stall.cs, stall.day0 + 10 * H)).toBeCloseTo(1.3, 9);
    expect(cardModifiers(stall.cs, stall.day0 + 10 * H).margin).toBeCloseTo(1.15, 9);
    expect(traffic(stall.cs, stall.day0 + 18 * H)).toBe(1);
    const poster = answered('festyn', 1, 9 * H + 15);
    expect(traffic(poster.cs, poster.day0 + 9 * H + 15)).toBeCloseTo(1.2, 9);
    expect(traffic(poster.cs, poster.day0 + 17 * H + 14)).toBeCloseTo(1.2, 9);
    expect(traffic(poster.cs, poster.day0 + 17 * H + 15)).toBe(1);
  });

  it('efekty nowych kart przeżywają zapis i wczytanie (karta na biurku i aktywny efekt)', () => {
    const { cs, card, day0 } = answered('rozkopy', 1);
    const pending = make('koncert');
    cs.pending.push(pending);
    const back = sanitizeCards(JSON.parse(JSON.stringify(cs)), card.day);
    expect(back.pending.map((x) => x.id)).toEqual(['koncert']);
    expect(back.active).toEqual(cs.active);
    expect(cardModifiers(back, day0 + 7 * H + 5).traffic).toBeCloseTo(0.7, 9);
    expect(back.pending[0]!.answers.map((a) => a.mods)).toEqual(pending.answers.map((a) => a.mods));
  });
});

describe('teksty nowych kart', () => {
  it('bez dziur w miejscach na liczby; EN ma te same odpowiedzi, ryzyka i parametry; polskie litery', () => {
    for (const id of NEW_CARD_IDS_4B) {
      const card = make(id);
      const d = def(id);
      const en = EN_CARDS[id]!;
      expect(en.answers, id).toHaveLength(d.answers.length);
      const texts = [d.title, d.text, ...d.answers.flatMap((a) => [a.label, a.result, a.risk?.text ?? ''])];
      for (const t of texts) expect(fillText(t, card.params), id).not.toMatch(/\{\w+\}/);
      d.answers.forEach((a, i) => expect(!!en.answers[i]!.risk, `${id}[${i}]`).toBe(!!a.risk));
      expect(/[ąćęłńóśźż]/i.test(d.text), id).toBe(true);
    }
  });
});

describe('determinizm i losowanie nowych kart', () => {
  const ids = (seed: number, over: Partial<CardContext> = {}): string[] => {
    const cs = createCards(0);
    const out: string[] = [];
    for (let d = 0; d < 120; d++) {
      for (const c of drawDayCards(cs, ctx(d, over), seed)) out.push(`${d}:${c.id}:${c.showAt}`);
      cs.pending = [];
    }
    return out;
  };

  it('drawDayCards na 3 seedach × 120 dni daje ten sam ciąg id przy dwóch uruchomieniach', () => {
    for (const seed of [SEED, 7, 424242]) {
      const a = ids(seed);
      expect(a.length, `seed ${seed}`).toBeGreaterThan(30);
      expect(ids(seed)).toEqual(a);
    }
  });

  it('każda nowa karta wypada w sklepie bez dzielnicy i w każdej dzielnicy, gdzie jej waga to co najmniej 0,3', () => {
    const days = 4000;
    for (const [label, over] of PLACES) {
      const cs = createCards(0);
      const seen = new Set<string>();
      for (let d = 0; d < days; d++) {
        for (const c of drawDayCards(cs, ctx(d, over), SEED)) seen.add(c.id);
        cs.pending = [];
      }
      PLACES.forEach(([l], i) => {
        if (l !== label) return;
        for (const id of NEW_CARD_IDS_4B) if (WEIGHTS[id]![i]! >= 0.3) expect(seen.has(id), `${label}: ${id}`).toBe(true);
      });
    }
  });

  it('nowe karty nie dotykają kart Dworca: poza Dworcem tamte nadal mają wagę 0', () => {
    for (const [label, over] of PLACES) {
      for (const id of ['dworzec-pociag', 'dworzec-bilon', 'dworzec-walizka']) {
        expect(weightOf(def(id), ctx(3, over)) > 0, `${label}: ${id}`).toBe((over.district as District | undefined) === 'dworzec');
      }
    }
  });
});
