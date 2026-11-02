import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { restoreFirmFrom } from '@/game/firmSave';
import { FAME_CASH as SERVER_FAME_CASH, FAME_SIM } from '@/server/config';
import { dayOf } from '@/sim/economy/calendar';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { awaitingDecision } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { freshRun } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { applyFirmCommand, lotState, type FirmCommand } from './commands';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, openStoreAt, stepFirmMinute, syncWallet } from './firm';
import { FAME_CASH, FIRM_GOALS, checkFame, checkFirmGoals, isFirmGoalId } from './goals';
import { RESEARCH, RESEARCH_IDS } from './research';
import type { FirmEvent, FirmState, FirmStepOut } from './types';

/*
 * Cele firmy i próg miliona (spec 4b §5.6, §5.7): tabela celów, ich warunki, wykrywanie w kroku minuty, odbiór poleceniem `claimGoal`, wpis
 * `fame` z jednym zdarzeniem `million`, brak obu w biegu rankingowym i zapis schematu 3 z milionem. Kształt zapisu celów sprawdza `firmSave.test.ts`.
 */

const SEED = 'kiełbasa-42';

const newFirm = (seed = SEED, ranked = false): FirmState => {
  const { state, layout, info } = freshRun(seed);
  return createFirm(seed, { econ: state, layout, info }, { ranked });
};
const clockOf = (f: FirmState): number => activeStore(f).econ.minute;
const setWallet = (f: FirmState, wallet: number): void => {
  f.person.wallet = wallet;
  syncWallet(f);
};
/** Gracz klika „OK” na kartach aktywnego sklepu, potem mija minuta firmy. */
function tick(f: FirmState, out: FirmStepOut = emptyStepOut()): FirmStepOut {
  const st = activeStore(f);
  while (awaitingDecision(st.econ)) {
    const card = visibleCards(st.econ.tycoon.cards, st.econ.minute)[0]!;
    expect(applyStoreCommand(f, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) }).result.ok).toBe(true);
  }
  stepFirmMinute(f, out);
  return out;
}
const ofKind = (events: readonly FirmEvent[], kind: FirmEvent['kind']): FirmEvent[] => events.filter((e) => e.kind === kind);
/** Otwiera `n` dodatkowych sklepów w wolnych lokalach (jak firmSave.test: bez budowy i opłat, tylko skład sieci). */
function openExtra(f: FirmState, n: number): void {
  const free = f.city.lots.filter((l) => lotState(f, l.id) === 'wolny');
  for (const lot of free.slice(0, n)) openStoreAt(f, lot.id, clockOf(f));
}
const readyIds = (f: FirmState): string[] => [...f.goals.ready];

describe('tabela celów firmy (spec §5.6)', () => {
  it('FIRM_GOALS: 10 id, nazwy, nagrody i progi dokładnie z tabeli §5.6', () => {
    expect(FIRM_GOALS.map((g) => [g.id, g.label, g.reward])).toEqual([
      ['cash250k', 'Ćwierć bańki na koncie', 30],
      ['cash500k', 'Pół bańki', 50],
      ['cash1m', 'Milioner spod znaku Traszki', 100],
      ['cash2m', 'Dwa miliony (Centrala pyta, czy nie za dużo)', 150],
      ['stores3', 'Trzy placówki', 40],
      ['stores4', 'Czwarta placówka', 60],
      ['stores5', 'Sieć pełna: pięć Traszek', 100],
      ['research1', 'Pierwsze badanie Sieci', 20],
      ['research10', 'Dziesięć poziomów badań', 60],
      ['researchAll', 'Wszystkie badania Sieci', 80],
    ]);
    expect(new Set(FIRM_GOALS.map((g) => g.id)).size).toBe(10);
    for (const g of FIRM_GOALS) expect(g.hint.length, g.id).toBeGreaterThan(10);
  });

  it('progi gotówki: ≥ 250 000, 500 000, 1 000 000 i 2 000 000 na portfelu osoby, co do złotówki', () => {
    const f = newFirm();
    const done = (id: string): boolean => FIRM_GOALS.find((g) => g.id === id)!.done(f);
    for (const [id, threshold] of [['cash250k', 250_000], ['cash500k', 500_000], ['cash1m', 1_000_000], ['cash2m', 2_000_000]] as const) {
      f.person.wallet = threshold - 1;
      expect(done(id), `${id} tuż pod progiem`).toBe(false);
      f.person.wallet = threshold;
      expect(done(id), `${id} na progu`).toBe(true);
      f.person.wallet = threshold * 3;
      expect(done(id), `${id} ponad progiem`).toBe(true);
    }
    f.person.wallet = 0;
    for (const g of FIRM_GOALS.slice(0, 4)) expect(g.done(f), g.id).toBe(false);
  });

  it('progi liczby sklepów: tylko otwarte (zamknięty i budowa się nie liczą), 3, 4 i 5', () => {
    const f = newFirm();
    f.person.partner = true;
    const done = (id: string): boolean => FIRM_GOALS.find((g) => g.id === id)!.done(f);
    expect([done('stores3'), done('stores4'), done('stores5')]).toEqual([false, false, false]);
    openExtra(f, 2);
    expect([done('stores3'), done('stores4'), done('stores5')]).toEqual([true, false, false]);
    f.builds.push({ lotId: f.city.lots.find((l) => lotState(f, l.id) === 'wolny')!.id, readyDay: 99, price: 1, pay: 'gotowka' });
    expect(done('stores4'), 'budowa to jeszcze nie sklep').toBe(false);
    f.builds.length = 0;
    openExtra(f, 1);
    expect([done('stores3'), done('stores4'), done('stores5')]).toEqual([true, true, false]);
    openExtra(f, 1);
    expect([done('stores3'), done('stores4'), done('stores5')]).toEqual([true, true, true]);
    f.stores[2]!.closed = true;
    expect([done('stores3'), done('stores4'), done('stores5')], 'zamknięty sklep nie liczy się do otwartych').toEqual([true, true, false]);
  });

  it('progi badań: suma poziomów ≥ 1 i ≥ 10, a „wszystkie” to każde badanie na poziomie ≥ 1', () => {
    const f = newFirm();
    const done = (id: string): boolean => FIRM_GOALS.find((g) => g.id === id)!.done(f);
    expect([done('research1'), done('research10'), done('researchAll')]).toEqual([false, false, false]);
    f.research = { dostawy: 1 };
    expect([done('research1'), done('research10'), done('researchAll')]).toEqual([true, false, false]);
    f.research = { dostawy: 3, obsada: 4, marketing: 2 };   // suma 9
    expect([done('research10'), done('researchAll')]).toEqual([false, false]);
    f.research = { dostawy: 3, obsada: 4, marketing: 3 };   // suma 10
    expect([done('research10'), done('researchAll')]).toEqual([true, false]);
    f.research = Object.fromEntries(RESEARCH_IDS.slice(0, 5).map((id) => [id, 1]));
    expect(done('researchAll'), 'brakuje jednego badania').toBe(false);
    f.research = Object.fromEntries(RESEARCH_IDS.map((id) => [id, 1]));
    expect([done('research1'), done('research10'), done('researchAll')]).toEqual([true, false, true]);
    f.research = Object.fromEntries(RESEARCH.map((d) => [d.id, d.maxLevel]));
    expect([done('research1'), done('research10'), done('researchAll')]).toEqual([true, true, true]);
  });

  it('isFirmGoalId: znane id tak, reszta (też toString i __proto__ oraz nie-teksty) nie', () => {
    for (const g of FIRM_GOALS) expect(isFirmGoalId(g.id), g.id).toBe(true);
    for (const bad of ['nieznany', 'Cash250k', '', 'toString', '__proto__', 'constructor', 3, null, undefined, ['cash250k']]) expect(isFirmGoalId(bad), String(bad)).toBe(false);
  });
});

describe('progi Galerii zgodne z serwerem', () => {
  it('FAME_CASH gry to dolna granica gotówki, którą przyjmuje serwer Galerii (FAME_CASH[0])', () => {
    expect(FAME_CASH).toBe(1_000_000);
    expect(FAME_CASH).toBe(SERVER_FAME_CASH[0]);
  });

  it('dolna granica SIM_VERSION w Galerii (FAME_SIM[0]) to bieżący SIM_VERSION: podbicie wersji bez zmiany serwera zostałoby wykryte', () => {
    expect(SIM_VERSION).toBe(FAME_SIM[0]);
  });

  it('cel cash1m i próg miliona to ta sama liczba', () => {
    const f = newFirm();
    const cash1m = FIRM_GOALS.find((g) => g.id === 'cash1m')!;
    f.person.wallet = FAME_CASH - 1;
    expect(cash1m.done(f)).toBe(false);
    f.person.wallet = FAME_CASH;
    expect(cash1m.done(f)).toBe(true);
  });
});

describe('checkFirmGoals: cel spełniony trafia do ready', () => {
  it('wallet 250 000 → cash250k w ready i jedno zdarzenie goal; drugi krok nie dubluje', () => {
    const f = newFirm();
    // na progu, bez kroku: co do złotówki
    setWallet(f, 250_000);
    const direct = emptyStepOut();
    checkFirmGoals(f, direct);
    expect(f.goals).toEqual({ ready: ['cash250k'], claimed: [] });
    expect(direct.firm).toEqual([{ kind: 'goal', params: { id: 'cash250k' } }]);
    checkFirmGoals(f, direct);
    expect(direct.firm).toHaveLength(1);

    // w kroku minuty, od świeżej firmy
    const g = newFirm();
    setWallet(g, 260_000);
    const out = tick(g);
    expect(ofKind(out.firm, 'goal')).toEqual([{ kind: 'goal', params: { id: 'cash250k' } }]);
    expect(readyIds(g)).toEqual(['cash250k']);
    expect(g.goals.claimed).toEqual([]);
    const next = tick(g);
    expect(ofKind(next.firm, 'goal'), 'drugi krok nie dubluje').toEqual([]);
    expect(readyIds(g)).toEqual(['cash250k']);
  });

  it('kilka celów naraz: w kolejności tabeli, po jednym zdarzeniu na cel', () => {
    const f = newFirm();
    setWallet(f, 600_000);
    f.research = { dostawy: 1 };
    const out = emptyStepOut();
    checkFirmGoals(f, out);
    expect(readyIds(f)).toEqual(['cash250k', 'cash500k', 'research1']);
    expect(out.firm.map((e) => e.params?.id)).toEqual(['cash250k', 'cash500k', 'research1']);
    expect(f.goals.claimed).toEqual([]);
  });

  it('spadek gotówki niczego nie odbiera, a gotówka z powrotem nie dubluje celu', () => {
    const f = newFirm();
    setWallet(f, 300_000);
    const out = emptyStepOut();
    checkFirmGoals(f, out);
    setWallet(f, 10_000);
    checkFirmGoals(f, out);
    expect(readyIds(f)).toEqual(['cash250k']);
    setWallet(f, 400_000);
    checkFirmGoals(f, out);
    expect(readyIds(f)).toEqual(['cash250k']);
    expect(out.firm).toHaveLength(1);
  });

  it('cel odebrany nie wraca do ready, choć warunek dalej jest spełniony', () => {
    const f = newFirm();
    setWallet(f, 300_000);
    const out = emptyStepOut();
    checkFirmGoals(f, out);
    expect(applyFirmCommand(f, { type: 'claimGoal', id: 'cash250k' }, out)).toEqual({ ok: true });
    checkFirmGoals(f, out);
    tick(f, out);
    expect(f.goals).toEqual({ ready: [], claimed: ['cash250k'] });
    expect(ofKind(out.firm, 'goal')).toHaveLength(1);
  });

  it('cele sieci przez prawdziwe polecenia: kupno badań w dwóch sklepach daje research1, a kolejne poziomy research10 i researchAll', () => {
    const f = newFirm();
    f.person.partner = true;
    openExtra(f, 1);
    setWallet(f, 6_000_000);   // wszystkie poziomy badań kosztują razem ok. 4,8 mln zł
    const out = emptyStepOut();
    expect(applyFirmCommand(f, { type: 'research', id: 'dostawy' }, out)).toEqual({ ok: true });
    checkFirmGoals(f, out);
    expect(readyIds(f)).toEqual(expect.arrayContaining(['cash250k', 'cash500k', 'cash1m', 'cash2m', 'research1']));
    expect(readyIds(f)).not.toContain('research10');
    for (const d of RESEARCH) {
      for (let l = f.research[d.id] ?? 0; l < d.maxLevel; l++) expect(applyFirmCommand(f, { type: 'research', id: d.id }, out)).toEqual({ ok: true });
    }
    checkFirmGoals(f, out);
    expect(readyIds(f)).toEqual(expect.arrayContaining(['research1', 'research10', 'researchAll']));
  });

  it('po końcu gry (over) żadne sprawdzenie nic nie zmienia', () => {
    const f = newFirm();
    setWallet(f, 3_000_000);
    f.over = 'debt';
    const out = emptyStepOut();
    checkFirmGoals(f, out);
    checkFame(f, out);
    expect(f.goals).toEqual({ ready: [], claimed: [] });
    expect(f.fame).toBeNull();
    expect(out.firm).toEqual([]);
  });
});

describe('claimGoal: odbiór nagrody', () => {
  const ready = (ids: string[], wallet = 0): FirmState => {
    const f = newFirm();
    setWallet(f, wallet);
    f.goals = { ready: ids, claimed: [] };
    return f;
  };

  it('+30 Ogonków do person.ogonki, id z ready do claimed; drugi raz odmowa goal; nieznany id odmowa goal', () => {
    const f = ready(['cash250k', 'cash500k']);
    const ogonki = f.person.ogonki;
    const xp = activeStore(f).econ.xp;
    const out = emptyStepOut();
    expect(applyFirmCommand(f, { type: 'claimGoal', id: 'cash250k' } satisfies FirmCommand, out)).toEqual({ ok: true });
    expect(f.person.ogonki).toBe(ogonki + 30);
    expect(f.goals).toEqual({ ready: ['cash500k'], claimed: ['cash250k'] });
    expect(activeStore(f).econ.ogonki, 'syncWallet podaje Ogonki sklepom od razu').toBe(ogonki + 30);
    expect(activeStore(f).econ.xp, 'nagroda celu firmy nie daje XP').toBe(xp);
    expect(out.firm).toEqual([]);

    expect(applyFirmCommand(f, { type: 'claimGoal', id: 'cash250k' }, out)).toEqual({ ok: false, reason: 'goal' });
    expect(applyFirmCommand(f, { type: 'claimGoal', id: 'nieznany' }, out)).toEqual({ ok: false, reason: 'goal' });
    expect(f.person.ogonki).toBe(ogonki + 30);
    expect(f.goals).toEqual({ ready: ['cash500k'], claimed: ['cash250k'] });

    expect(applyFirmCommand(f, { type: 'claimGoal', id: 'cash500k' }, out)).toEqual({ ok: true });
    expect(f.person.ogonki).toBe(ogonki + 30 + 50);
    expect(f.goals).toEqual({ ready: [], claimed: ['cash250k', 'cash500k'] });
  });

  it('nagroda każdego celu to jego reward z tabeli', () => {
    for (const g of FIRM_GOALS) {
      const f = ready([g.id]);
      const before = f.person.ogonki;
      expect(applyFirmCommand(f, { type: 'claimGoal', id: g.id }, emptyStepOut()), g.id).toEqual({ ok: true });
      expect(f.person.ogonki - before, g.id).toBe(g.reward);
    }
  });

  it('cel jeszcze niespełniony (poza ready) i dziwne id dostają odmowę goal bez ruszania stanu', () => {
    const f = ready(['cash250k']);
    const before = JSON.stringify({ g: f.goals, o: f.person });
    for (const id of ['cash2m', 'toString', '__proto__', 'constructor', '']) {
      expect(applyFirmCommand(f, { type: 'claimGoal', id }, emptyStepOut()), id).toEqual({ ok: false, reason: 'goal' });
    }
    // zły kształt (id nie jest tekstem) to też `goal`, nie `store`
    for (const cmd of [{ type: 'claimGoal' }, { type: 'claimGoal', id: 3 }, { type: 'claimGoal', id: null }, { type: 'claimGoal', id: ['cash250k'] }]) {
      expect(applyFirmCommand(f, cmd as unknown as FirmCommand, emptyStepOut()), JSON.stringify(cmd)).toEqual({ ok: false, reason: 'goal' });
    }
    expect(JSON.stringify({ g: f.goals, o: f.person })).toBe(before);
  });

  it('Ogonki idą do portfela osoby, więc widzi je każdy otwarty sklep', () => {
    const f = newFirm();
    f.person.partner = true;
    openExtra(f, 1);
    f.goals = { ready: ['stores3'], claimed: [] };
    const before = f.person.ogonki;
    expect(applyFirmCommand(f, { type: 'claimGoal', id: 'stores3' }, emptyStepOut())).toEqual({ ok: true });
    for (const st of f.stores) expect(st.econ.ogonki, `#${st.id}`).toBe(before + 40);
  });

  it('po końcu gry odmowa over, w biegu rankingowym ranked', () => {
    const over = ready(['cash250k']);
    over.over = 'debt';
    expect(applyFirmCommand(over, { type: 'claimGoal', id: 'cash250k' }, emptyStepOut())).toEqual({ ok: false, reason: 'over' });
    const ranked = newFirm(SEED, true);
    ranked.goals = { ready: ['cash250k'], claimed: [] };
    expect(applyFirmCommand(ranked, { type: 'claimGoal', id: 'cash250k' }, emptyStepOut())).toEqual({ ok: false, reason: 'ranked' });
    expect(ranked.goals).toEqual({ ready: ['cash250k'], claimed: [] });
  });
});

describe('checkFame: próg pierwszego miliona', () => {
  it('wallet 999 999 nic; 1 000 000 → fame {day: dayOf(minute), cash: 1 000 000} i jedno million; spadek i powrót nie daje drugiego', () => {
    const f = newFirm();
    setWallet(f, 999_999);
    const out = emptyStepOut();
    checkFame(f, out);
    expect(f.fame).toBeNull();
    expect(out.firm).toEqual([]);

    setWallet(f, 1_000_000);
    checkFame(f, out);
    const day = dayOf(clockOf(f));
    expect(f.fame).toEqual({ day, cash: 1_000_000 });
    expect(out.firm).toEqual([{ kind: 'million', params: { day, cash: 1_000_000 } }]);

    // spadek poniżej progu i powrót, nawet z wyższą kwotą: zdarzenie padło raz, wpis zostaje pierwszy
    setWallet(f, 500_000);
    checkFame(f, out);
    setWallet(f, 1_500_000);
    checkFame(f, out);
    expect(f.fame).toEqual({ day, cash: 1_000_000 });
    expect(ofKind(out.firm, 'million')).toHaveLength(1);
  });

  it('w kroku minuty: dokładnie jedno million, a dzień i gotówka są z chwili przekroczenia (po kroku)', () => {
    const f = newFirm();
    setWallet(f, 1_200_000);
    const out = tick(f);
    const million = ofKind(out.firm, 'million');
    expect(million).toHaveLength(1);
    expect(f.fame).not.toBeNull();
    expect(million[0]!.params).toEqual({ day: f.fame!.day, cash: f.fame!.cash });
    expect(f.fame!.day).toBe(dayOf(clockOf(f)));
    expect(f.fame!.cash).toBe(f.person.wallet);   // wallet po kroku, bez dalszych zmian w tej minucie
    expect(f.fame!.cash).toBeGreaterThanOrEqual(FAME_CASH);
    for (let i = 0; i < 5; i++) expect(ofKind(tick(f).firm, 'million')).toEqual([]);
  });

  it('dzień wpisu to dzień gry aktywnego sklepu, nie dzień zegara ścianowego', () => {
    const f = newFirm();
    const st = activeStore(f);
    for (const s of f.stores) s.econ.minute += 123 * MINUTES_PER_DAY;
    setWallet(f, FAME_CASH);
    checkFame(f, emptyStepOut());
    expect(f.fame!.day).toBe(dayOf(st.econ.minute));
    expect(f.fame!.day).toBeGreaterThanOrEqual(123);
  });
});

describe('bieg rankingowy: bez celów firmy i bez Galerii', () => {
  it('ranked bez Sieci, celów firmy i Galerii: firma ranked z wallet 2 mln po 10 krokach ma goals puste, fame null; research i claimGoal → ranked', () => {
    const f = newFirm(SEED, true);
    setWallet(f, 2_000_000);
    const out = emptyStepOut();
    for (let i = 0; i < 10; i++) tick(f, out);
    expect(f.goals).toEqual({ ready: [], claimed: [] });
    expect(f.fame).toBeNull();
    expect(f.person.wallet).toBeGreaterThanOrEqual(FAME_CASH);
    expect(ofKind(out.firm, 'goal')).toEqual([]);
    expect(ofKind(out.firm, 'million')).toEqual([]);
    // bezpośrednie wołania też nic nie robią
    checkFirmGoals(f, out);
    checkFame(f, out);
    expect(f.goals).toEqual({ ready: [], claimed: [] });
    expect(f.fame).toBeNull();
    expect(applyFirmCommand(f, { type: 'research', id: 'dostawy' }, out)).toEqual({ ok: false, reason: 'ranked' });
    expect(applyFirmCommand(f, { type: 'claimGoal', id: 'cash250k' }, out)).toEqual({ ok: false, reason: 'ranked' });
  });

  it('zwykła firma z tą samą gotówką dostaje cele i milion (kontrola, że powyższy brak to zasługa ranked)', () => {
    const f = newFirm();
    setWallet(f, 2_000_000);
    const out = emptyStepOut();
    for (let i = 0; i < 10; i++) tick(f, out);
    expect(readyIds(f)).toEqual(['cash250k', 'cash500k', 'cash1m', 'cash2m']);
    expect(ofKind(out.firm, 'goal')).toHaveLength(4);
    expect(ofKind(out.firm, 'million')).toHaveLength(1);
    expect(f.fame).not.toBeNull();
  });
});

describe('zapis schematu 3 z milionem (Review Focus 1)', () => {
  const fixture = (name: string): Record<string, any> => JSON.parse(readFileSync(new URL(`../../game/fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, any>;

  it('schemat 3 po Traszce z milionem: save-v3-po-traszce z person.wallet 1 200 000 → po 1 kroku jedno million, ready ⊇ [cash250k, cash500k, cash1m], claimed []', () => {
    const raw = fixture('save-v3-po-traszce.json');
    expect(raw.schema).toBe(3);
    raw.firm.person.wallet = 1_200_000;
    const r = restoreFirmFrom(raw, raw.seed as string);
    if (!r.ok) throw new Error(`firma się nie otworzyła: ${r.reason}`);
    const f = r.firm;
    expect({ research: f.research, storeLimit: f.storeLimit, goals: f.goals, fame: f.fame }).toEqual({
      research: {}, storeLimit: 3, goals: { ready: [], claimed: [] }, fame: null,
    });
    expect(f.person.wallet).toBe(1_200_000);

    const out = tick(f);
    expect(ofKind(out.firm, 'million')).toHaveLength(1);
    expect(f.fame).not.toBeNull();
    expect(readyIds(f)).toEqual(expect.arrayContaining(['cash250k', 'cash500k', 'cash1m']));
    expect(readyIds(f)).not.toContain('cash2m');
    expect(f.goals.claimed).toEqual([]);
    expect(ofKind(out.firm, 'goal').map((e) => e.params?.id)).toEqual(readyIds(f));
    expect(ofKind(tick(f).firm, 'million')).toEqual([]);
  }, 30_000);
});
