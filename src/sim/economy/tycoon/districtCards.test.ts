import { describe, expect, it } from 'vitest';
import { generateCity } from '@/sim/city/generateCity';
import { DISTRICTS } from '@/sim/city/districts';
import { siteFor, storeSeedFor } from '@/sim/city/traffic';
import { MINUTES_PER_DAY } from '../catalog';
import { awaitingDecision, cardContext, createEconomy } from '../economy';
import { defaultAnswer } from '../monthPreview';
import { activeSite } from '../site';
import { computeStoreInfo, type StoreInfo } from '../storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { freshRun } from '@/sim/run';
import { activeStore, createFirm, emptyStepOut, openStoreAt, stepFirmMinute } from '@/sim/firm/firm';
import { createCards, drawDayCards, visibleCards, type CardContext, type CardInstance } from './cards';
import { DECK, DWORZEC_CARD_IDS, difficultWeight, type CardDef } from './deck';
import { weekdayOf } from './time';

/*
 * Trudni klienci i karty Dworca (4a.2, spec §8.1): `wiek` waży tyle, ile mówi dzielnica (`difficult`), a trzy karty Dworca mają wagę 0
 * poza Dworcem, więc talia sklepu bez dzielnicy (także sklepu startowego) losuje dokładnie jak przed 4a.2.
 */

const SEED = 0x5eed;
const SEED_STR = 'kiełbasa-42';

function ctx(day: number, over: Partial<CardContext> = {}): CardContext {
  return {
    day, now: day * MINUTES_PER_DAY, weekday: weekdayOf(day), deliveryToday: true, palletsToday: 5, staff: 2, trust: 60,
    cleanliness: 80, sidewalkPallets: 1, weather: 'sucho', dailyMargin: 2000, dailyRevenue: 10_000, ...over,
  };
}

/** Karty kolejnych dni (biurko czyszczone co dzień, jak w `cards.test.ts`) przy danym dopisku do kontekstu. */
function season(seed: number, days: number, over: Partial<CardContext> = {}): CardInstance[][] {
  const cs = createCards(0);
  const byDay: CardInstance[][] = [];
  for (let d = 0; d < days; d++) {
    byDay.push(drawDayCards(cs, ctx(d, over), seed));
    cs.pending = [];
  }
  return byDay;
}

const idsOf = (byDay: CardInstance[][]): string[] => byDay.flatMap((day) => day.map((c) => c.id));
const count = (ids: readonly string[], id: string): number => ids.filter((x) => x === id).length;

describe('difficultWeight', () => {
  it('bez `difficult` w kontekście to dokładnie `base`, z `difficult` base × mnożnik dzielnicy', () => {
    expect(difficultWeight(1.3)(ctx(0))).toBe(1.3);
    expect(difficultWeight(1.3)(ctx(0, { difficult: 0.6 }))).toBe(1.3 * 0.6);
    expect(difficultWeight(1)(ctx(0, { district: 'dworzec', difficult: 1.6 }))).toBe(1.6);
  });
});

describe('talia: karty Dworca i trudni klienci w losowaniu', () => {
  it('kontekst bez dzielnicy i z samym `difficult` 1 (bez `district`) losuje tę samą talię przez 400 dni; Osiedle losuje inaczej, bo karty 4b mają dla niego osobne wagi', () => {
    const none = season(SEED, 400);
    const neutral = season(SEED, 400, { difficult: 1 });
    expect(idsOf(neutral)).toEqual(idsOf(none));
    expect(JSON.stringify(neutral)).toBe(JSON.stringify(none));
    expect(idsOf(none).length).toBeGreaterThan(100);
    // spec §5.5 (4b): `byDistrict` odróżnia sklep bez aktywnej dzielnicy od Osiedla (np. festyn 0,6 kontra 1,4)
    expect(idsOf(season(SEED, 400, { district: 'osiedle', difficult: 1 }))).not.toEqual(idsOf(none));
  });

  it('§20: karty Dworca wypadają tylko na Dworcu; bez dzielnicy, na Osiedlu, w Śródmieściu i w Biurowcach jest ich 0', () => {
    const days = 2000;
    const contexts: [string, Partial<CardContext>][] = [
      ['bez dzielnicy', {}],
      ['osiedle', { district: 'osiedle', difficult: DISTRICTS.osiedle.difficult }],
      ['srodmiescie', { district: 'srodmiescie', difficult: DISTRICTS.srodmiescie.difficult }],
      ['biurowce', { district: 'biurowce', difficult: DISTRICTS.biurowce.difficult }],
    ];
    for (const [label, over] of contexts) {
      const ids = idsOf(season(SEED, days, over));
      expect(ids.length, label).toBeGreaterThan(300);
      for (const id of DWORZEC_CARD_IDS) expect(count(ids, id), `${label}: ${id}`).toBe(0);
    }
    const dworzec = idsOf(season(SEED, days, { district: 'dworzec', difficult: DISTRICTS.dworzec.difficult }));
    for (const id of DWORZEC_CARD_IDS) expect(count(dworzec, id), `dworzec: ${id}`).toBeGreaterThan(0);
  });

  it('„Nastolatek po energetyka” (`wiek`) wypada najczęściej na Dworcu, rzadziej na Osiedlu, najrzadziej w Śródmieściu', () => {
    const days = 6000;
    const wiek = (d: 'osiedle' | 'srodmiescie' | 'dworzec'): number =>
      count(idsOf(season(SEED, days, { district: d, difficult: DISTRICTS[d].difficult })), 'wiek');
    const [dworzec, osiedle, srodmiescie] = [wiek('dworzec'), wiek('osiedle'), wiek('srodmiescie')];
    expect(dworzec).toBeGreaterThan(osiedle);
    expect(osiedle).toBeGreaterThan(srodmiescie);
  });

  it('karty Dworca stoją w talii po `wiralowy` (przed dwunastoma kartami 4b, które dopisano na końcu) i mają wagę 0 poza Dworcem', () => {
    expect([...DWORZEC_CARD_IDS]).toEqual(['dworzec-pociag', 'dworzec-bilon', 'dworzec-walizka']);
    expect(DECK.slice(-16, -12).map((d) => d.id)).toEqual(['wiralowy', ...DWORZEC_CARD_IDS]);
    const weightOf = (d: CardDef, c: CardContext): number => (typeof d.weight === 'function' ? d.weight(c) : d.weight);
    for (const d of DECK.slice(-15, -12)) {
      expect(weightOf(d, ctx(3)), d.id).toBe(0);
      expect(weightOf(d, ctx(3, { district: 'biurowce', difficult: 0.7 })), d.id).toBe(0);
      expect(weightOf(d, ctx(3, { district: 'dworzec', difficult: 1.6 })), d.id).toBeGreaterThan(0);
    }
  });
});

describe('cardContext niesie dzielnicę tylko wtedy, gdy zmienia ekonomię', () => {
  it('sklep bez `site` nie ma kluczy `district` ani `difficult`', () => {
    const { state, info } = freshRun(SEED_STR);
    const c = cardContext(state, info);
    expect('district' in c).toBe(false);
    expect('difficult' in c).toBe(false);
  });

  it('sklep z `siteFor` lokalu Dworca ma `district: dworzec` i `difficult: 1.6`', () => {
    const city = generateCity(SEED_STR);
    const lot = city.lots.find((l) => l.district === 'dworzec' && l.id !== city.startLotId)!;
    const seed = storeSeedFor(SEED_STR, lot.id);
    const site = siteFor(city, lot.id, { extra: true, ownCosts: false, firmDebt: true, weatherHash: null });
    const info: StoreInfo = { ...computeStoreInfo(layoutFor(seed, 0, lot.spec)), site };
    expect(activeSite(info)).not.toBeNull();
    const c = cardContext(createEconomy(seed, info), info);
    expect(c.district).toBe('dworzec');
    expect(c.difficult).toBe(1.6);
  });

  it('sklep startowy w firmie z dwoma sklepami (flagi bez dzielnicy) nie ma `district` ani `difficult`', () => {
    const { state, layout, info } = freshRun(SEED_STR);
    const f = createFirm(SEED_STR, { econ: state, layout, info }, { ranked: false });
    openStoreAt(f, f.city.lots.find((l) => l.state === 'wolny' && l.district === 'dworzec')!.id, state.minute);
    const first = f.stores[0]!;
    expect(first.info.site).toBeDefined();
    expect(activeSite(first.info)).toBeNull();
    const c = cardContext(first.econ, first.info);
    expect('district' in c).toBe(false);
    expect('difficult' in c).toBe(false);
    const second = f.stores[1]!;
    expect(cardContext(second.econ, second.info)).toMatchObject({ district: 'dworzec', difficult: 1.6 });
  });
});

describe('zastępca i karty Dworca', () => {
  it('sklep w tle na Dworcu odpowiada na kartę Dworca odpowiedzią zaznaczoną z góry (`defaultAnswer`)', () => {
    const { state, layout, info } = freshRun(SEED_STR);
    const f = createFirm(SEED_STR, { econ: state, layout, info }, { ranked: false });
    const lotId = f.city.lots.find((l) => l.state === 'wolny' && l.district === 'dworzec')!.id;
    const bg = openStoreAt(f, lotId, state.minute);
    // karta Dworca z prawdziwego kontekstu sklepu w tle, wylosowana tak jak o północy (kolejne seedy, aż wypadnie)
    let card: CardInstance | undefined;
    for (let s = 0; s < 5000 && !card; s++) {
      const cs = createCards(0);
      cs.nextCircularDay = 99;
      card = drawDayCards(cs, cardContext(bg.econ, bg.info), s).find((x) => (DWORZEC_CARD_IDS as readonly string[]).includes(x.id));
    }
    expect(card, 'karta Dworca nie wypadła').toBeDefined();
    const minute = bg.econ.minute;
    bg.econ.tycoon.cards.pending.push({ ...card!, seq: 900, showAt: minute });
    expect(awaitingDecision(bg.econ)).toBe(true);
    expect(activeStore(f).id).toBe(1);

    const out = emptyStepOut();
    stepFirmMinute(f, out);

    const expected = defaultAnswer(card!);
    expect(bg.econ.tycoon.cards.log.find((l) => l.seq === 900)?.answer).toBe(expected);
    expect(f.inbox).toContainEqual({ day: Math.floor(minute / MINUTES_PER_DAY), storeId: 2, card: card!.id, answer: expected });
    expect(out.firm).toContainEqual({ kind: 'deputy', storeId: 2, params: { card: card!.id, answer: expected } });
    expect(visibleCards(bg.econ.tycoon.cards, minute)).toEqual([]);
  });
});
