import { describe, expect, it } from 'vitest';
import { firmOf } from '@/game/session';
import { MINUTES_PER_DAY, OPEN_TO } from '@/sim/economy/catalog';
import { DEBT_WARN, PLAN_GAMEOVER_TEXT, type EconEvent } from '@/sim/economy/economy';
import type { PlanState } from '@/sim/economy/plan';
import { OCT_CLOSE, SEPT_CLOSE, closeStoreFitted, openSecond, openThird, partnerSession, playTo, reopenLot, tick } from '../../../tests/firmKit';
import { endedByPlan } from './closure';
import { applyFirmCommand, isFirmCommand, FIRM_COMMAND_TYPES } from './commands';
import { activeStore, emptyStepOut, openStores } from './firm';
import type { FirmState, FirmStepOut, FirmStore } from './types';

/*
 * Plan Centrali w firmie (etap 5a, Task 3): trzecia wpadka planu zamyka sklep jak zaufanie 0 (z rozliczeniem końcowym, gdy gra idzie dalej
 * na innym sklepie; bez rozliczenia, gdy to ostatni sklep), a polecenie firmy `planTopUp` przełącza dobicie w dowolnym otwartym sklepie.
 * Plany powstają prawdziwą drogą dopiero w czwartym miesiącu umowy, więc testy wstawiają blok planu do sklepu tuż przed zamknięciem września.
 */

const DAY = MINUTES_PER_DAY;
const TRUST_GAMEOVER = 'Centrala wypowiada umowę franczyzową: zaufanie spadło do zera. Dziękujemy za współpracę.';
/** Zamknięcie przedostatniego dnia września (dzień 28): wtedy ekonomia ostrzega, że do planu brakuje. */
const SEPT_PENULT = 28 * DAY + OPEN_TO;

const ofKind = <T extends { kind: string }>(events: readonly T[], kind: string): T[] => events.filter((e) => e.kind === kind);
const eventsOf = (out: FirmStepOut): EconEvent[] => [...out.active, ...out.background.map((b) => b.event)];
const storeOf = (f: FirmState, id: number): FirmStore => f.stores.find((s) => s.id === id)!;

/** Blok planu sklepu o stopniu `stage`, z dniami otwartymi wstawionymi tak, by zamknięcie dnia dało pełny miesiąc (30 dni września). */
function armPlan(st: FirmStore, p: Partial<PlanState> & { target: number }, openDays = 29): void {
  st.econ.franchisee.plan = { base: 0, recent: [], streak: 0, stage: 0, openDays, topUp: false, ...p };
}

/** Plan ponad tempo sklepu, ale nie absurdalnie: obrót dotychczasowy razy 1,3, więc udział w planie to ok. 77% (poniżej progu dobicia). */
const missTarget = (st: FirmStore): number => Math.round(st.econ.month.revenue * 1.3);

describe('polecenie planTopUp', () => {
  it('ma kształt polecenia firmy, a typ jest na liście poleceń firmy', () => {
    expect(isFirmCommand({ type: 'planTopUp', storeId: 2, on: true })).toBe(true);
    expect(isFirmCommand({ type: 'planTopUp', storeId: 2 })).toBe(false);
    expect(isFirmCommand({ type: 'planTopUp', storeId: 'x', on: true })).toBe(false);
    expect(FIRM_COMMAND_TYPES).toContain('planTopUp');
  });

  it('przełącza dobicie we wskazanym sklepie, także w tle', () => {
    const s = partnerSession();
    const st2 = openSecond(s);
    const f = firmOf(s);
    expect(f.activeId).toBe(1);   // sklep 2 jest w tle
    armPlan(st2, { target: 500_000 });
    expect(applyFirmCommand(f, { type: 'planTopUp', storeId: 2, on: true }, emptyStepOut())).toEqual({ ok: true });
    expect(st2.econ.franchisee.plan!.topUp).toBe(true);
    expect(applyFirmCommand(f, { type: 'planTopUp', storeId: 2, on: false }, emptyStepOut())).toEqual({ ok: true });
    expect(st2.econ.franchisee.plan!.topUp).toBe(false);
    // sklep aktywny bez bloku planu: odmowa `plan`, stan bez zmian
    expect(activeStore(f).econ.franchisee.plan).toBeUndefined();
    expect(applyFirmCommand(f, { type: 'planTopUp', storeId: 1, on: true }, emptyStepOut())).toEqual({ ok: false, reason: 'plan' });
    expect(activeStore(f).econ.franchisee.plan).toBeUndefined();
    // nieznany sklep i zły kształt: odmowa `store`
    expect(applyFirmCommand(f, { type: 'planTopUp', storeId: 99, on: true }, emptyStepOut())).toEqual({ ok: false, reason: 'store' });
    expect(applyFirmCommand(f, { type: 'planTopUp', storeId: 2, on: 'tak' } as never, emptyStepOut())).toEqual({ ok: false, reason: 'store' });
  });

  it('zamknięty sklep nie przyjmuje polecenia (store), a po końcu gry jest `over`', () => {
    const s = partnerSession();
    openSecond(s);
    const f = closeStoreFitted(s, 2);
    expect(applyFirmCommand(f, { type: 'planTopUp', storeId: 2, on: true }, emptyStepOut())).toEqual({ ok: false, reason: 'store' });
    f.over = 'closed';
    expect(applyFirmCommand(f, { type: 'planTopUp', storeId: 1, on: true }, emptyStepOut())).toEqual({ ok: false, reason: 'over' });
  });
});

describe('zamknięcie sklepu planem', () => {
  it('trzecia wpadka w drugim sklepie zamyka tylko ten sklep, z rozliczeniem końcowym', () => {
    const s = partnerSession();
    const st2 = openSecond(s);
    const f = firmOf(s);
    playTo(s, SEPT_CLOSE);
    armPlan(st2, { target: missTarget(st2), stage: 2 });   // trzecia wpadka z rzędu: stopień 2 → 3
    const out = tick(s);

    expect(ofKind(out.firm, 'closed')).toEqual([{ kind: 'closed', storeId: 2, params: { reason: 'plan' } }]);
    expect(out.firm.some((e) => e.kind === 'settlement' && e.storeId === 2)).toBe(true);
    expect(f.over).toBeNull();
    expect(st2.closed).toBe(true);
    expect(st2.econ.franchisee.plan).toBeUndefined();   // plan należy do umowy
    // gracz nie widzi ekranu końca gry: żadnego `gameover` (ani aktywnego, ani z tła, ani firmy)
    expect(eventsOf(out).some((e) => e.kind === 'gameover')).toBe(false);
    expect(ofKind(out.firm, 'gameover')).toEqual([]);
    expect(activeStore(f).econ.gameOver).toBe(false);
    expect(openStores(f).map((x) => x.id)).toEqual([1]);
    // zamknięty sklep zamknął miesiąc: jego wyciąg (z rozliczeniem planu) przyszedł zwykłą drogą
    const month = out.background.find((b) => b.storeId === 2 && b.event.kind === 'month')!.event;
    expect(month.report!.plan).toMatchObject({ hit: false, stage: 3, fine: 0 });
  });

  it('endedByPlan: tylko po zdarzeniu month z gameOver, stopniem 3 i zaufaniem ponad zero', () => {
    const s = partnerSession();
    const st2 = openSecond(s);
    const month: EconEvent[] = [{ kind: 'month', text: '' }];
    armPlan(st2, { target: 1, stage: 3 });
    expect(endedByPlan(st2, month)).toBe(false);   // gra dalej
    st2.econ.gameOver = true;
    expect(endedByPlan(st2, month)).toBe(true);
    expect(endedByPlan(st2, [])).toBe(false);   // gameOver bez zamknięcia miesiąca (np. debet) to nie plan
    st2.econ.franchisee.plan!.stage = 2;
    expect(endedByPlan(st2, month)).toBe(false);
    st2.econ.franchisee.plan!.stage = 3;
    st2.econ.tycoon.trust.value = 0;
    expect(endedByPlan(st2, month)).toBe(false);   // zaufanie 0 ma pierwszeństwo
  });

  it('trzecia wpadka w ostatnim sklepie kończy grę bez rozliczenia', () => {
    const s = partnerSession();
    const f = firmOf(s);
    const st1 = activeStore(f);
    playTo(s, SEPT_CLOSE);
    armPlan(st1, { target: missTarget(st1), stage: 2 });
    const out = tick(s);

    expect(f.over).toBe('closed');
    expect(ofKind(out.firm, 'settlement')).toEqual([]);
    expect(ofKind(out.firm, 'closed')).toEqual([]);
    expect(st1.closed).toBe(false);   // jedyny sklep zostaje na ekranie końca gry
    expect(st1.econ.gameOver).toBe(true);
    // ekran końca gry niesie tekst planu, dokładnie raz
    expect(ofKind(out.active, 'gameover').map((e) => e.text)).toEqual([PLAN_GAMEOVER_TEXT]);
  });

  it('zaufanie 0 i plan naraz: sklep zamknięty raz, powód trust', () => {
    const s = partnerSession();
    const st2 = openSecond(s);
    const f = firmOf(s);
    playTo(s, SEPT_CLOSE);
    armPlan(st2, { target: missTarget(st2), stage: 2 });
    st2.econ.tycoon.trust.value = 3;
    st2.econ.franchisee.month = { margin: 0, bonus: 0, pallets: 0, wages: 40_000, media: 0 };   // strata miesiąca zbije zaufanie do zera
    const out = tick(s);

    expect(ofKind(out.firm, 'closed')).toEqual([{ kind: 'closed', storeId: 2, params: { reason: 'trust' } }]);
    expect(ofKind(out.firm, 'settlement')).toHaveLength(1);
    expect(f.over).toBeNull();
    expect(st2.closed).toBe(true);
    expect(eventsOf(out).some((e) => e.kind === 'gameover')).toBe(false);
    // plan naprawdę doszedł do stopnia 3 przy tym zamknięciu (powód zamknięcia to zaufanie tylko dlatego, że ma pierwszeństwo)
    const month = out.background.find((b) => b.storeId === 2 && b.event.kind === 'month')!.event;
    expect(month.report!.plan).toMatchObject({ hit: false, stage: 3, fine: 0 });
  });

  it('zaufanie 0 i plan naraz w ostatnim sklepie: jeden `gameover`, z tekstem zaufania', () => {
    const s = partnerSession();
    const f = firmOf(s);
    const st1 = activeStore(f);
    playTo(s, SEPT_CLOSE);
    armPlan(st1, { target: missTarget(st1), stage: 2 });
    st1.econ.tycoon.trust.value = 3;
    st1.econ.franchisee.month = { margin: 0, bonus: 0, pallets: 0, wages: 40_000, media: 0 };
    const out = tick(s);

    expect(st1.econ.franchisee.plan).toMatchObject({ stage: 3 });
    expect(ofKind(out.active, 'month')[0]!.report!.plan).toMatchObject({ hit: false, stage: 3 });
    expect(f.over).toBe('closed');
    const over = eventsOf(out).filter((e) => e.kind === 'gameover');
    expect(over.map((e) => e.text)).toEqual([TRUST_GAMEOVER]);
    expect(ofKind(out.firm, 'gameover')).toEqual([]);
  });

  it('dwa sklepy z dobiciem w tej samej minucie: drugi liczy na portfelu po pierwszym i nie schodzi poniżej DEBT_WARN', () => {
    const s = partnerSession(undefined, 400_000);
    const st2 = openSecond(s, 'gotowka');
    const st3 = openThird(s, 'gotowka');
    const f = firmOf(s);
    playTo(s, SEPT_CLOSE);
    // plan o ok. 10% ponad obrót miesiąca: udział ok. 91%, dobicie możliwe w obu sklepach
    for (const st of [st2, st3]) armPlan(st, { target: Math.round(st.econ.month.revenue / 0.91), topUp: true });
    // portfel starcza na dobicie jednego sklepu do progu ostrzeżenia (wyciągi sklepów dokładają kilka tysięcy), ale nie dwóch naraz
    const cost = (st: FirmStore): number => Math.round(0.83 * (st.econ.franchisee.plan!.target - st.econ.month.revenue));
    const c2 = cost(st2);
    f.person.wallet = DEBT_WARN + c2;
    for (const st of openStores(f)) st.econ.cash = f.person.wallet;
    const out = tick(s);

    const plans = [st2, st3].map((st) => (out.background.find((b) => b.storeId === st.id && b.event.kind === 'month') ?? { event: out.active.find((e) => e.kind === 'month')! }).event.report!.plan!);
    expect(plans[0]!.bought).toBeGreaterThan(0);   // pierwszy po `id` dobił
    expect(plans[0]!.hit).toBe(true);
    expect(plans[1]!.bought).toBe(0);   // drugi widzi portfel po pierwszym: za mało do progu
    expect(plans[1]!.hit).toBe(false);
    expect(f.person.wallet).toBeGreaterThanOrEqual(DEBT_WARN);
    expect(f.over).toBeNull();
  });

  it('sklep wynajęty ponownie zaczyna od miesiąca zapowiedzi, bez starego stopnia', () => {
    const s = partnerSession();
    const st2 = openSecond(s);
    playTo(s, SEPT_CLOSE);
    armPlan(st2, { target: missTarget(st2), stage: 2, streak: 0 });
    tick(s);
    const f = firmOf(s);
    expect(st2.closed).toBe(true);
    expect(st2.econ.franchisee.plan).toBeUndefined();

    const back = reopenLot(s, st2.lotId);
    expect(back.id).toBe(2);
    // ponowny wynajem to świeża ekonomia z pustą historią: bez bloku planu, więc bez stopnia i serii ze starej umowy
    expect(back.econ.history).toEqual([]);
    expect(back.econ.franchisee.plan).toBeUndefined();
    // pierwszy miesiąc nowej umowy nie ma rozliczenia planu ani zdarzeń planu
    const out = playTo(s, OCT_CLOSE + 2 * DAY);
    tick(s, out);
    expect(back.econ.history.length).toBeGreaterThanOrEqual(1);
    expect(back.econ.franchisee.plan).toBeUndefined();
    const own = out.background.filter((b) => b.storeId === 2);
    expect(own.some((b) => b.event.kind === 'plan')).toBe(false);
    for (const b of own) if (b.event.kind === 'month') expect(b.event.report!.plan).toBeUndefined();
    expect(f.over).toBeNull();
  });

  it('zdarzenie plan sklepu w tle jest ważne (czeka na OK)', () => {
    const s = partnerSession();
    const st2 = openSecond(s);
    playTo(s, SEPT_PENULT);
    // ostrzeżenie przedostatniego dnia: prognoza ok. 95% planu
    armPlan(st2, { target: 1 }, 29);
    st2.econ.franchisee.plan!.target = Math.round(st2.econ.month.revenue * 31 / 30 / 0.95);
    const out = tick(s);
    const warn = out.background.find((b) => b.storeId === 2 && b.event.kind === 'plan')!;
    expect(warn.event.plan!.reason).toBe('short');
    expect(warn.important).toBe(true);
  });
});
