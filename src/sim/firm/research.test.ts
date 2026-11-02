import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { awaitingDecision, stepMinute, type EconEvent } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { applyCommand } from '@/sim/economy/commands';
import type { NetMods } from '@/sim/economy/site';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { freshRun } from '@/sim/run';
import { closeStore } from './closure';
import { applyFirmCommand, openDueBuilds, rentRefusal, type FirmCommand } from './commands';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, openStores, stepFirmMinute, syncWallet } from './firm';
import {
  NET_SCALE, RESEARCH, RESEARCH_BY_ID, RESEARCH_IDS, RESEARCH_MAX_LEVEL, coordinationFee, netMods, netScale, researchCost, researchRefusal,
  type ResearchId,
} from './research';
import type { FirmBuild, FirmState, FirmStepOut, FirmStore } from './types';

/*
 * Badania Sieci (spec 4b §5.3): tabela definicji, ceny, skala od liczby sklepów, mnożniki `netMods`, odmowy kupna i droga do sklepów
 * (`site.net`) razem z powrotem do jednego sklepu. Hooki w ekonomii sprawdza `site.test.ts`, polecenie `research` `commands.test.ts`.
 */

const SEED = 'kiełbasa-42';
const DAY = MINUTES_PER_DAY;

const NEUTRAL_NET: NetMods = { traffic: 1, basket: 1, wages: 1, media: 1, logistics: 1, backroom: 1 };

const newFirm = (seed = SEED, ranked = false): FirmState => {
  const { state, layout, info } = freshRun(seed);
  return createFirm(seed, { econ: state, layout, info }, { ranked });
};
/** Firma ze statusem Partnera i gotówką na pakiety otwarcia i badania. */
function partnerFirm(wallet = 3_000_000): FirmState {
  const f = newFirm();
  f.person.partner = true;
  f.person.wallet = wallet;
  syncWallet(f);
  return f;
}
const clockOf = (f: FirmState): number => activeStore(f).econ.minute;

/** Gracz klika „OK” na kartach aktywnego sklepu (odpowiedź zaznaczona z góry). */
function answerActive(f: FirmState): void {
  const st = activeStore(f);
  while (awaitingDecision(st.econ)) {
    const card = visibleCards(st.econ.tycoon.cards, st.econ.minute)[0]!;
    expect(applyStoreCommand(f, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) }).result.ok).toBe(true);
  }
}
function tick(f: FirmState, out: FirmStepOut = emptyStepOut()): FirmStepOut {
  answerActive(f);
  stepFirmMinute(f, out);
  return out;
}
function playTo(f: FirmState, minute: number, out: FirmStepOut = emptyStepOut()): FirmStepOut {
  while (clockOf(f) < minute && f.over === null && !activeStore(f).econ.gameOver) tick(f, out);
  return out;
}
const freeLots = (f: FirmState): number[] => f.city.lots.filter((l) => l.state === 'wolny').map((l) => l.id);
const openMinute = (b: FirmBuild): number => b.readyDay * DAY + OPEN_FROM;

/** Wynajem za gotówkę i otwarcie w kolejnym wolnym lokalu, który wynajem przyjmuje: sklep stoi o 6:00 dnia otwarcia. */
function rentAndOpen(f: FirmState): FirmStore {
  const lotId = freeLots(f).find((id) => rentRefusal(f, id, 'gotowka') === null)!;
  expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay: 'gotowka' }, emptyStepOut())).toEqual({ ok: true });
  playTo(f, openMinute(f.builds[f.builds.length - 1]!));
  openDueBuilds(f, emptyStepOut());
  return f.stores[f.stores.length - 1]!;
}

const research = (f: FirmState, id: ResearchId, out: FirmStepOut = emptyStepOut()): void => {
  expect(applyFirmCommand(f, { type: 'research', id } satisfies FirmCommand, out)).toEqual({ ok: true });
};

describe('tabela badań Sieci (spec §5.3)', () => {
  it('RESEARCH: 6 wierszy dokładnie z tabeli §5.3 (id, pole, znak, perLevel, cap, maxLevel, baseCost, costMult)', () => {
    expect(RESEARCH.map((d) => [d.id, d.field, d.sign, d.perLevel, d.cap, d.maxLevel, d.baseCost, d.costMult])).toEqual([
      ['dostawy', 'logistics', -1, 0.10, 0.60, 3, 25_000, 2.0],
      ['obsada', 'wages', -1, 0.03, 0.25, 4, 60_000, 2.0],
      ['marketing', 'traffic', 1, 0.025, 0.30, 5, 50_000, 1.8],
      ['magazyn', 'backroom', 1, 0.10, 0.50, 3, 30_000, 2.2],
      ['lojalnosc', 'basket', 1, 0.015, 0.20, 5, 80_000, 1.9],
      ['media', 'media', -1, 0.05, 0.30, 3, 35_000, 2.0],
    ]);
  });

  it('kolejność i poziomy maksymalne: RESEARCH idzie w kolejności RESEARCH_IDS, a maxLevel każdego badania to RESEARCH_MAX_LEVEL z zapisu (jedno źródło)', () => {
    expect(RESEARCH.map((d) => d.id)).toEqual([...RESEARCH_IDS]);
    for (const d of RESEARCH) {
      expect(d.maxLevel, d.id).toBe(RESEARCH_MAX_LEVEL[d.id]);
      expect(RESEARCH_BY_ID[d.id], d.id).toBe(d);
    }
    expect(new Set(RESEARCH.map((d) => d.field)).size).toBe(6);   // każde pole NetMods ma dokładnie jedno badanie
    for (const d of RESEARCH) for (const text of [d.name, d.effect, d.flavor]) expect(text.length, d.id).toBeGreaterThan(10);
  });

  it('researchCost (powInt z exactMath): obsada 60 000, 120 000, 240 000, 480 000; lojalnosc poziom 4 = 1 042 600', () => {
    const obsada = RESEARCH_BY_ID.obsada;
    expect([0, 1, 2, 3].map((l) => researchCost(obsada, l))).toEqual([60_000, 120_000, 240_000, 480_000]);
    expect(researchCost(RESEARCH_BY_ID.lojalnosc, 4)).toBe(1_042_600);
  });

  it('suma cen wszystkich poziomów ≈ 4,8 mln zł, a każda cena jest wielokrotnością 100 zł', () => {
    let total = 0;
    for (const d of RESEARCH) {
      for (let l = 0; l < d.maxLevel; l++) {
        const cost = researchCost(d, l);
        expect(cost % 100, `${d.id} ${l}`).toBe(0);
        total += cost;
      }
    }
    expect(total).toBeGreaterThan(4_700_000);
    expect(total).toBeLessThan(4_900_000);
  });

  it('coordinationFee(120 000) = 24 000, do pełnych setek (20% ceny)', () => {
    expect(coordinationFee(120_000)).toBe(24_000);
    expect(coordinationFee(50_000)).toBe(10_000);
    expect(coordinationFee(162_000)).toBe(32_400);
    expect(coordinationFee(1_042_600)).toBe(208_500);   // 208 520 → 208 500
  });

  it('NET_SCALE i netScale: 0→0, 1→0, 2→1, 3→1.5, 4→1.8, 5→2, 7→2', () => {
    expect([...NET_SCALE]).toEqual([0, 0, 1, 1.5, 1.8, 2]);
    expect([0, 1, 2, 3, 4, 5, 7].map(netScale)).toEqual([0, 0, 1, 1.5, 1.8, 2, 2]);
    expect([-1, NaN].map(netScale)).toEqual([0, 0]);
  });

  it('każdy kolejny sklep dokłada coraz mniej: przyrosty skali 1, 0,5, 0,3, 0,2', () => {
    const steps = [2, 3, 4, 5].map((n) => netScale(n) - netScale(n - 1));
    expect(steps[0]).toBe(1);
    for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThan(steps[i - 1]!);
  });
});

describe('netMods', () => {
  it('null przy mniej niż dwóch sklepach, przy samych zerach i przy pustym stanie', () => {
    expect(netMods({ marketing: 3 }, 0)).toBeNull();
    expect(netMods({ marketing: 3 }, 1)).toBeNull();
    expect(netMods({}, 2)).toBeNull();
    expect(netMods({}, 5)).toBeNull();
    expect(netMods({ marketing: 0, media: 0 }, 4)).toBeNull();
  });

  it('marketing 3 przy 3 sklepach → traffic 1 + 0.025 × 3 × 1.5, pozostałe pola 1', () => {
    expect(netMods({ marketing: 3 }, 3)).toEqual({ ...NEUTRAL_NET, traffic: 1 + 0.025 * 3 * 1.5 });
    expect(netMods({ marketing: 3 }, 3)!.traffic).toBeCloseTo(1.1125, 12);
  });

  it('obsada 4 przy 5 sklepach → wages 0.76: cap 0.25 (mnożnik 0.75) tu nie wiąże, bo 0.03 × 4 × 2 = 0.24 (K3)', () => {
    expect(netMods({ obsada: 4 }, 5)).toEqual({ ...NEUTRAL_NET, wages: 1 - 0.03 * 4 * 2 });
    expect(netMods({ obsada: 4 }, 5)!.wages).toBeCloseTo(0.76, 12);
    // obsada ma cap 0,25 i maxLevel 4: najmocniejsze możliwe badanie (poziom 4, 5+ sklepów) daje 0,24 < 0,25, więc ten cap nigdy nie wiąże
    expect(RESEARCH_BY_ID.obsada.perLevel * RESEARCH_BY_ID.obsada.maxLevel * netScale(9)).toBeLessThan(RESEARCH_BY_ID.obsada.cap);
  });

  it('cap wiąże: magazyn 3 przy 4 sklepach (0.1 × 3 × 1.8 = 0.54 > 0.5) → backroom 1.5; przy 3 sklepach 1.45 (0.45 < cap)', () => {
    expect(netMods({ magazyn: 3 }, 4)).toEqual({ ...NEUTRAL_NET, backroom: 1 + 0.5 });
    expect(netMods({ magazyn: 3 }, 5)!.backroom).toBe(1.5);
    expect(netMods({ magazyn: 3 }, 3)!.backroom).toBeCloseTo(1.45, 12);
    // cap w drugą stronę: dostawy 3 przy 5 sklepach → opłata za palety × 0.4 (cap 0.60), media 3 przy 5 → × 0.7 (cap 0.30)
    expect(netMods({ dostawy: 3 }, 5)!.logistics).toBeCloseTo(0.4, 12);
    expect(netMods({ media: 3 }, 5)!.media).toBeCloseTo(0.7, 12);
    expect(RESEARCH_BY_ID.dostawy.perLevel * 3 * netScale(5)).toBeGreaterThan(RESEARCH_BY_ID.dostawy.cap - 1e-12);
  });

  it('mnożnik zawsze rośnie z liczbą sklepów (nie maleje) i nigdy nie przekracza capu: każde badanie na maxLevel, 2–9 sklepów', () => {
    for (const d of RESEARCH) {
      let last = 1;
      for (let open = 2; open <= 9; open++) {
        const v = netMods({ [d.id]: d.maxLevel }, open)![d.field];
        const moved = d.sign * (v - 1);
        expect(moved, `${d.id} ${open}`).toBeGreaterThanOrEqual(last === 1 ? 0 : d.sign * (last - 1) - 1e-12);
        expect(moved, `${d.id} ${open}`).toBeLessThanOrEqual(d.cap + 1e-12);
        last = v;
      }
    }
  });

  it('badania kupione razem składają się w jeden obiekt, pole po polu', () => {
    const all = Object.fromEntries(RESEARCH.map((d) => [d.id, 1])) as Record<ResearchId, number>;
    const net = netMods(all, 2)!;
    expect(net).toEqual({ traffic: 1.025, basket: 1.015, wages: 0.97, media: 0.95, logistics: 0.9, backroom: 1.1 });
  });
});

describe('researchRefusal', () => {
  it('po kolei: over, ranked, siec (jeden otwarty sklep), max, gotowka; potem null', () => {
    const f = partnerFirm();
    expect(researchRefusal(f, 'marketing')).toBe('siec');
    rentAndOpen(f);
    expect(researchRefusal(f, 'marketing')).toBeNull();

    f.person.wallet = researchCost(RESEARCH_BY_ID.marketing, 0) - 100;
    expect(researchRefusal(f, 'marketing')).toBe('gotowka');
    f.person.wallet = researchCost(RESEARCH_BY_ID.marketing, 0);   // po zapłacie dokładnie zero: wolno
    expect(researchRefusal(f, 'marketing')).toBeNull();

    f.research = { marketing: RESEARCH_MAX_LEVEL.marketing };
    expect(researchRefusal(f, 'marketing')).toBe('max');
    f.person.wallet = 0;
    expect(researchRefusal(f, 'marketing')).toBe('max');   // max przed gotówką

    f.ranked = true;
    expect(researchRefusal(f, 'marketing')).toBe('ranked');
    f.over = 'debt';
    expect(researchRefusal(f, 'marketing')).toBe('over');
  });

  it('bieg rankingowy: jeden sklep to ranked, nie siec', () => {
    expect(researchRefusal(newFirm(SEED, true), 'dostawy')).toBe('ranked');
  });
});

describe('droga do sklepów: site.net', () => {
  it('kupno badania podaje site.net wszystkim otwartym sklepom, także startowemu; bez badań sklepy nie mają pola net', () => {
    const f = partnerFirm();
    rentAndOpen(f);
    for (const st of openStores(f)) expect(st.info.site && 'net' in st.info.site, `#${st.id} przed`).toBe(false);

    research(f, 'marketing');
    research(f, 'lojalnosc');
    research(f, 'lojalnosc');
    const want = netMods({ marketing: 1, lojalnosc: 2 }, 2)!;
    expect(want).toEqual({ ...NEUTRAL_NET, traffic: 1.025, basket: 1 + 0.015 * 2 * 1 });
    for (const st of openStores(f)) expect(st.info.site?.net, `#${st.id}`).toEqual(want);
    // dzielnica sklepu startowego zostaje neutralna: `net` nie włącza gałęzi dzielnicy
    expect(f.stores[0]!.info.site).toMatchObject({ district: 'osiedle', traffic: 1, basket: 1 });
  });

  it('trzeci sklep podnosi skalę do 1.5 u wszystkich trzech; nowy sklep ma net już w info, z którego powstaje jego ekonomia', () => {
    const f = partnerFirm();
    rentAndOpen(f);
    research(f, 'marketing');
    research(f, 'marketing');
    expect(f.stores[1]!.info.site?.net?.traffic).toBeCloseTo(1 + 0.025 * 2 * 1, 12);
    const third = rentAndOpen(f);
    expect(openStores(f)).toHaveLength(3);
    for (const st of openStores(f)) expect(st.info.site?.net?.traffic, `#${st.id}`).toBeCloseTo(1 + 0.025 * 2 * 1.5, 12);
    expect(third.info.site?.net).toEqual(f.stores[0]!.info.site?.net);
  }, 60_000);

  it('badanie działa od następnej minuty: ruch aktywnego sklepu rośnie o mnożnik', () => {
    const f = partnerFirm();
    rentAndOpen(f);
    const st = activeStore(f);
    const before = st.info;
    research(f, 'marketing');
    expect(activeStore(f).info).not.toBe(before);   // refreshSites podmienia `info` (sesja przepina się przez pointAtActive)
    expect(activeStore(f).info.site?.net?.traffic).toBe(1.025);
  });
});

describe('powrót do jednego sklepu', () => {
  it('jeden sklep po badaniach gra jak bez Sieci: kupione badania, wypowiedzenie #2, po zamknięciu #2 sklep #1 bez site i krok bitowo równy ekonomii bez firmy', () => {
    const f = partnerFirm();
    const second = rentAndOpen(f);
    for (const id of RESEARCH_IDS) research(f, id);
    const bought = { ...f.research };
    expect(Object.keys(bought)).toEqual([...RESEARCH_IDS]);
    expect(f.stores[0]!.info.site?.net).toBeDefined();
    expect(second.info.site?.net).toBeDefined();

    // wypowiedzenie #2 i gra do końca umowy
    const out = emptyStepOut();
    expect(applyFirmCommand(f, { type: 'terminateStore', storeId: second.id }, out)).toEqual({ ok: true });
    const guard = clockOf(f) + 75 * DAY;
    while (!second.closed && clockOf(f) < guard && f.over === null) tick(f, out);
    expect(second.closed).toBe(true);
    expect(openStores(f)).toHaveLength(1);

    // #1 znów bez site, badania zostają kupione, ale nie działają
    const first = f.stores[0]!;
    expect(first.info.site).toBeUndefined();
    expect(f.research).toEqual(bought);
    expect(netMods(f.research, openStores(f).length)).toBeNull();

    // krok sklepu jak w ekonomii bez firmy: ten sam stan i ta sama `info` krokowane samym `stepMinute`
    const solo = structuredClone(first.econ);
    const soloInfo = first.info;
    const events: EconEvent[] = [];
    for (let i = 0; i < 2 * DAY; i++) {
      answerActive(f);
      while (awaitingDecision(solo)) {
        const card = visibleCards(solo.tycoon.cards, solo.minute)[0]!;
        expect(applyCommand(solo, soloInfo, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) }).result.ok).toBe(true);
      }
      stepFirmMinute(f, emptyStepOut());
      stepMinute(solo, soloInfo, events);
      if (i % 360 === 0) expect(JSON.stringify(first.econ), `minuta ${i}`).toBe(JSON.stringify(solo));
    }
    expect(JSON.stringify(first.econ)).toBe(JSON.stringify(solo));
    expect(first.info.site).toBeUndefined();
  }, 180_000);

  it('zamknięcie sklepu #1 przy działającym #2: #2 zostaje sam w lokalu poza startowym i też traci net (skala 0), a po ponownym wynajmie #1 net wraca', () => {
    const f = partnerFirm();
    const second = rentAndOpen(f);
    research(f, 'media');
    research(f, 'obsada');
    expect(second.info.site?.net).toBeDefined();
    closeStore(f, 1, 'trust', emptyStepOut());
    expect(openStores(f)).toEqual([second]);
    expect(second.info.site).toBeDefined();   // sklep poza lokalem startowym ma dzielnicę i flagi dodatkowego sklepu
    expect('net' in second.info.site!).toBe(false);
    expect(f.research).toEqual({ obsada: 1, media: 1 });
    expect(rentRefusal(f, f.stores[0]!.lotId, 'gotowka')).toBeNull();   // lokal startowy jest „po Traszce”: da się go wynająć znów

    expect(applyFirmCommand(f, { type: 'rentLot', lotId: f.stores[0]!.lotId, pay: 'gotowka' }, emptyStepOut())).toEqual({ ok: true });
    playTo(f, openMinute(f.builds[f.builds.length - 1]!));
    openDueBuilds(f, emptyStepOut());
    expect(openStores(f)).toHaveLength(2);
    const want = netMods(f.research, 2)!;
    for (const st of openStores(f)) expect(st.info.site?.net, `#${st.id}`).toEqual(want);
  }, 60_000);
});

describe('neutralność firmy z dwoma sklepami bez badań', () => {
  it('bez kupionych badań dwa sklepy grają co do bitu jak przed badaniami Sieci: skrót stanu firmy po 3 dniach', () => {
    const f = partnerFirm(500_000);
    rentAndOpen(f);
    playTo(f, clockOf(f) + 3 * DAY);
    const digest = createHash('sha256').update(JSON.stringify({ stores: f.stores, person: f.person })).digest('hex');
    expect(digest).toBe('29506945474609f274bacb39a2b25648e11ef9c47c9ba8ce429b13e8f896c606');   // policzony na kodzie sprzed badań Sieci (b643c92)
  }, 120_000);
});
