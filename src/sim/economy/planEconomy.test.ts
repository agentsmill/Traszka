import { beforeAll, describe, expect, it } from 'vitest';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
import { freshRun } from '@/sim/run';
import { MINUTES_PER_DAY as DAY, OPEN_FROM, OPEN_TO } from './catalog';
import { applyCommand } from './commands';
import {
  PLAN_GAMEOVER_TEXT, awaitingDecision, cardContext, planOf, stepMinute, type EconEvent, type EconomyState,
} from './economy';
import { defaultAnswer, gameOverReason } from './monthPreview';
import { PLAN, dailyFromHistory, firstPlanPreview } from './plan';
import { sanitizeEconomy } from './sanitize';
import type { StoreInfo } from './storeInfo';
import { visibleCards } from './tycoon/cards';
import { DECK } from './tycoon/deck';

/*
 * Plan sprzedaży Centrali w ekonomii sklepu (etap 5a, Task 2): powstaje przy zamknięciu 1 grudnia, liczy dni otwarte, rozlicza się
 * przy zamknięciu miesiąca (premia, kara w wyciągu, zaufanie, drabina) i kończy umowę po trzeciej wpadce z rzędu. Bieg rankingowy
 * (do 30 listopada) go nie widzi. Jeden bieg bazowy liczony raz; testy pracują na kopiach.
 */

const SEED = 'kiełbasa-42';
const TRUST_GAMEOVER = 'Centrala wypowiada umowę franczyzową: zaufanie spadło do zera. Dziękujemy za współpracę.';

/** Przewija `stepMinute` do minuty `minute` (albo końca gry); karty dostają odpowiedź domyślną. Zwraca zdarzenia z tego odcinka. */
function runTo(s: EconomyState, info: StoreInfo, minute: number): EconEvent[] {
  const events: EconEvent[] = [];
  while (s.minute < minute && !s.gameOver) {
    if (awaitingDecision(s)) {
      const card = visibleCards(s.tycoon.cards, s.minute)[0]!;
      const out = applyCommand(s, info, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
      expect(out.result.ok).toBe(true);
      events.push(...out.events);
      continue;
    }
    stepMinute(s, info, events);
  }
  return events;
}

const clone = (s: EconomyState): EconomyState => structuredClone(s);
const planEvents = (events: EconEvent[], reason: string): EconEvent[] =>
  events.filter((e) => e.kind === 'plan' && e.plan?.reason === reason);

let info: StoreInfo;
let atSeasonEnd: EconomyState;   // dzień 90, 23:01
let atDec1Morning: EconomyState;  // dzień 91, 6:00
let atDec2: EconomyState;         // dzień 92, 0:00 (plan grudnia już jest)
let seasonEvents: EconEvent[];
let dec1Events: EconEvent[];

beforeAll(() => {
  const run = freshRun(SEED);
  info = run.info;
  const s = run.state;
  seasonEvents = runTo(s, info, RANKED_SEASON_END_MINUTE);
  atSeasonEnd = clone(s);
  runTo(s, info, 91 * DAY + OPEN_FROM);
  atDec1Morning = clone(s);
  dec1Events = runTo(s, info, 92 * DAY);
  atDec2 = clone(s);
}, 120_000);

/** Kopia stanu z planem grudnia; `target` ustawiony na `mult` razy plan wyliczony przez grę. */
function december(mult = 1): EconomyState {
  const s = clone(atDec2);
  s.franchisee.plan!.target = Math.round(s.franchisee.plan!.target * mult);
  return s;
}

describe('plan Centrali w ekonomii sklepu', () => {
  it('neutralność: przez trzy miesiące w stanie nie ma klucza plan ani w wyciągu, ani w raporcie', () => {
    const s = atSeasonEnd;
    expect(s.history).toHaveLength(3);
    expect('plan' in s.franchisee).toBe(false);
    expect('plan' in s.lastReport!).toBe(false);
    expect('plan' in s.lastReport!.statement!).toBe(false);
    expect(seasonEvents.some((e) => e.kind === 'plan' || 'plan' in e)).toBe(false);
    expect('planStage' in cardContext(s, info)).toBe(false);
    expect(planOf(s)).toBeUndefined();
  });

  it('pierwszy plan powstaje wieczorem 1 grudnia i jest równy podglądowi z rana', () => {
    expect('plan' in atDec1Morning.franchisee).toBe(false);
    const preview = firstPlanPreview(atDec1Morning.history, 91);
    expect(preview).toBeGreaterThan(0);
    const s = atDec2;
    expect(s.franchisee.plan!.target).toBe(preview);
    expect(s.franchisee.plan!.openDays).toBe(1);
    const start = planEvents(dec1Events, 'start');
    expect(start).toHaveLength(1);
    expect(start[0]!.plan!.target).toBe(preview);
    expect(start[0]!.text).toBe(
      `Gwarancja się skończyła. Od dziś Centrala przysyła plan sprzedaży: ${preview!.toLocaleString('pl-PL')} zł w tym miesiącu. „Wierzymy w Ciebie. Liczbowo.”`,
    );
    expect(cardContext(s, info).planStage).toBe(0);
  });

  it('trafiony grudzień: premia na saldzie, raport z planem, nowy plan na styczeń', () => {
    const s = clone(atDec2);
    s.franchisee.plan!.target = 1_000;   // plan nie do chybienia
    runTo(s, info, 122 * DAY);
    expect(s.lastReport!.label).toBe('grudzień 2026');
    expect(s.lastReport!.plan).toMatchObject({ hit: true, stage: 0, stageBefore: 0, streak: 1, fine: 0, bought: 0 });
    expect(s.lastReport!.plan!.bonus).toBe(Math.round(0.01 * s.lastReport!.counters.revenue));
    expect('plan' in s.lastReport!.statement!).toBe(false);
    expect(s.franchisee.plan!.target).toBe(s.lastReport!.plan!.nextTarget);
    expect(s.franchisee.plan!.openDays).toBe(0);
    expect(s.lastReport!.detail!.trust.reasons.some(([r, v]) => r === 'plan' && v > 0)).toBe(true);
  });

  it('wpadka: kara w potrąceniach wyciągu, zaufanie z przyczyną „plan”, stopień 1', () => {
    const s = december(1.5);   // ok. 50% ponad tempo: kara w dziesiątkach tysięcy zł, bez debetu
    runTo(s, info, 122 * DAY);
    expect(s.gameOver).toBe(false);
    const st = s.lastReport!.statement!;
    expect(s.lastReport!.plan!.hit).toBe(false);
    expect(s.lastReport!.plan!.fine).toBeGreaterThan(10_000);
    expect(st.plan).toBe(s.lastReport!.plan!.fine);
    expect(st.deductions).toBe(st.installments + st.pallets + st.remanent + st.plan!);
    expect(s.lastReport!.detail!.trust.reasons.some(([r, v]) => r === 'plan' && v < 0)).toBe(true);
    expect(s.franchisee.plan!.stage).toBe(1);
    expect(s.lastReport!.plan).toMatchObject({ stage: 1, stageBefore: 0 });
    expect(s.franchisee.plan!.streak).toBe(0);
  });

  it('stopień 2 zawiesza premię od obrotu i podwaja wagę audytu', () => {
    const base = clone(atDec2);
    base.franchisee.plan!.target = 1_000;   // plan nie do chybienia
    runTo(base, info, 121 * DAY + OPEN_TO - 1);   // minuta przed zamknięciem grudnia: karty miesiąca już rozegrane
    const a = clone(base);
    const b = clone(base);
    for (const s of [a, b]) s.tycoon.trust.value = 90;   // premia od obrotu przy zaufaniu ≥ 85 to 1%
    b.franchisee.plan!.stage = 2;
    expect(cardContext(a, info).planStage).toBe(0);
    expect(cardContext(b, info).planStage).toBe(2);
    runTo(a, info, 122 * DAY);
    runTo(b, info, 122 * DAY);
    const revenue = a.lastReport!.counters.revenue;
    expect(b.lastReport!.counters.revenue).toBe(revenue);
    expect(a.lastReport!.plan!.hit && b.lastReport!.plan!.hit).toBe(true);
    const bonusStage0 = a.lastReport!.counters.bonus;
    const bonusStage2 = b.lastReport!.counters.bonus;
    expect(bonusStage0 - bonusStage2).toBe(Math.round(0.01 * revenue));
    expect(b.franchisee.plan!.stage).toBe(1);   // trafienie schodzi o stopień

    const audit = DECK.find((d) => d.id === 'audyt')!;
    const ctx = cardContext(a, info);
    const w = (planStage?: number): number => {
      const c = { ...ctx };
      if (planStage === undefined) delete c.planStage; else c.planStage = planStage;
      return typeof audit.weight === 'function' ? audit.weight(c) : audit.weight;
    };
    expect(w(2)).toBe(2 * w(undefined));
    expect(w(3)).toBe(2 * w(undefined));
    expect(w(1)).toBe(w(undefined));
    expect(w(0)).toBe(w(undefined));
  });

  it('trzecia wpadka z rzędu kończy grę komunikatem o planie', () => {
    const s = december(1.5);
    const events: EconEvent[] = [];
    events.push(...runTo(s, info, 122 * DAY));
    expect(s.franchisee.plan!.stage).toBe(1);
    s.franchisee.plan!.target = Math.round(s.franchisee.plan!.target * 1.5);
    events.push(...runTo(s, info, 153 * DAY));
    expect(s.franchisee.plan!.stage).toBe(2);
    expect(s.gameOver).toBe(false);
    s.franchisee.plan!.target = Math.round(s.franchisee.plan!.target * 1.5);
    events.push(...runTo(s, info, 181 * DAY));
    expect(s.lastReport!.label).toBe('luty 2027');
    expect(s.lastReport!.plan!.stage).toBe(3);
    expect(s.gameOver).toBe(true);
    expect(events.filter((e) => e.kind === 'gameover').map((e) => e.text)).toEqual([PLAN_GAMEOVER_TEXT]);
    expect(gameOverReason(s)).toBe('plan');
  });

  it('zaufanie 0 i stopień 3 naraz: jedno zdarzenie gameover, o zaufaniu', () => {
    const s = december(1.5);
    runTo(s, info, 121 * DAY + OPEN_TO - 1);
    s.franchisee.plan!.stage = 2;   // ta wpadka to trzecia
    s.tycoon.trust.value = 0;
    s.month.other -= 1_000_000;   // miesiąc na stracie: wynik nie podniesie zaufania nad zero
    const events = runTo(s, info, 122 * DAY);
    expect(s.lastReport!.plan!.stage).toBe(3);
    expect(s.tycoon.trust.value).toBe(0);
    expect(s.gameOver).toBe(true);
    expect(events.filter((e) => e.kind === 'gameover').map((e) => e.text)).toEqual([TRUST_GAMEOVER]);
    expect(gameOverReason(s)).toBe('trust');
  });

  it('komunikat przedostatniego dnia tylko przy prognozie 90–100%', () => {
    const lastButOne = 120 * DAY + OPEN_TO + 1;   // po zamknięciu 30 grudnia
    const dry = clone(atDec2);
    runTo(dry, info, lastButOne);   // liczniki miesiąca zerują się dopiero przy zamknięciu 31 grudnia
    expect(dry.franchisee.plan!.openDays).toBe(30);
    const forecast = dry.month.revenue * 31 / 30;

    const shortFor = (share: number, stage = 0): EconEvent[] => {
      const s = clone(atDec2);
      s.franchisee.plan!.target = Math.round(forecast / share);
      runTo(s, info, lastButOne - 2);
      s.franchisee.plan!.stage = stage;   // stopień tuż przed zamknięciem dnia: karty miesiąca bez zmian
      return planEvents(runTo(s, info, lastButOne), 'short');
    };
    const near = shortFor(0.95);
    expect(near).toHaveLength(1);
    const target = Math.round(forecast / 0.95);
    const p = near[0]!.plan!;
    expect(p.missing).toBe(Math.round(target - forecast));
    expect(p.cost).toBe(Math.round(p.missing! * PLAN.topUpCost));
    expect(p.fine).toBe(Math.round(PLAN.fineShare[1]! * p.missing!));
    const fmt = (n: number): string => n.toLocaleString('pl-PL');
    expect(near[0]!.text).toBe(
      `Do planu brakuje ok. ${fmt(p.missing!)} zł. Dobicie z kieszeni: ok. ${fmt(p.cost!)} zł. Bez dobicia: kara ${fmt(p.fine!)} zł i stopień 1.`,
    );
    expect(shortFor(0.5)).toHaveLength(0);
    expect(shortFor(2)).toHaveLength(0);
    const last = shortFor(0.95, 2);
    expect(last).toHaveLength(1);
    expect(last[0]!.text.endsWith('Bez dobicia: Centrala wypowie umowę na tę placówkę.')).toBe(true);
  });

  it('stary zapis w środku miesiąca: zapowiedź, miesiąc bez rozliczenia, plan od następnego', () => {
    const s = clone(atDec2);
    runTo(s, info, 100 * DAY + OPEN_FROM);   // 10 grudnia
    delete s.franchisee.plan;
    s.history.unshift({ ...s.history[0]! }, { ...s.history[1]! });   // pięć raportów w historii
    expect(s.history).toHaveLength(5);
    const events = runTo(s, info, 122 * DAY);
    expect(planEvents(events, 'announce')).toHaveLength(1);
    expect(planEvents(events, 'announce')[0]!.text).toBe('Od przyszłego miesiąca ten sklep ma plan sprzedaży Centrali. W tym miesiącu jeszcze bez rozliczenia.');
    expect(planEvents(events, 'start')).toHaveLength(0);
    expect(s.lastReport!.plan).toBeUndefined();
    expect('plan' in s.lastReport!).toBe(false);
    expect('plan' in s.lastReport!.statement!).toBe(false);
    expect(s.franchisee.plan!.target).toBeGreaterThan(0);
    expect(s.franchisee.plan!.openDays).toBe(0);
    expect(s.franchisee.plan!.recent).toEqual(dailyFromHistory(s.history, 122));
  });

  it('dzień zamknięty remontem nie liczy się do dni otwartych', () => {
    const s = clone(atDec2);
    runTo(s, info, 95 * DAY + OPEN_FROM);   // 5 grudnia, 6:00
    expect(s.franchisee.plan!.openDays).toBe(4);
    s.remontUntil = s.minute + 2 * DAY;   // remont na dwa pełne dni: zamknięcia 5 i 6 grudnia w czasie remontu
    runTo(s, info, 96 * DAY + OPEN_TO + 1);
    expect(s.franchisee.plan!.openDays).toBe(4);
    runTo(s, info, 97 * DAY + OPEN_TO + 1);
    expect(s.franchisee.plan!.openDays).toBe(5);
  });

  it('zapis i odczyt: blok planu i raport z planem wracają bajt w bajt', () => {
    const defaults = freshRun(SEED).state;
    const roundTrip = (s: EconomyState): string =>
      JSON.stringify(sanitizeEconomy(JSON.parse(JSON.stringify(s)), defaults, info));
    const hit = clone(atDec2);
    hit.franchisee.plan!.target = 1_000;
    hit.franchisee.plan!.topUp = true;
    runTo(hit, info, 122 * DAY);
    expect(hit.lastReport!.plan).toBeDefined();
    expect(roundTrip(hit)).toBe(JSON.stringify(hit));
    // raport z zapisu bez `stageBefore`: wraca ze `stageBefore = stage` (bez zmiany stopnia, bez listu)
    const old = JSON.parse(JSON.stringify(hit));
    delete old.lastReport.plan.stageBefore;
    expect(sanitizeEconomy(old, defaults, info)!.lastReport!.plan).toMatchObject({ stage: hit.lastReport!.plan!.stage, stageBefore: hit.lastReport!.plan!.stage });
    const miss = december(1.5);
    runTo(miss, info, 122 * DAY);
    expect(miss.lastReport!.statement!.plan).toBeGreaterThan(0);
    expect(roundTrip(miss)).toBe(JSON.stringify(miss));
    expect(roundTrip(atSeasonEnd)).toBe(JSON.stringify(atSeasonEnd));
    expect(roundTrip(atSeasonEnd)).not.toContain('"plan"');
  });

  it('zapis: wrogi raport planu nie staje się wyzerowanym rozliczeniem, stopnie i seria całe i przycięte', () => {
    const defaults = freshRun(SEED).state;
    const s = clone(atDec2);
    s.franchisee.plan!.target = 1_000;
    runTo(s, info, 122 * DAY);
    const load = (plan: unknown): EconomyState['lastReport'] => {
      const raw = JSON.parse(JSON.stringify(s));
      raw.lastReport.plan = plan;
      return sanitizeEconomy(raw, defaults, info)!.lastReport;
    };
    for (const junk of [{}, { hit: true }, { target: 400_000 }, { target: 'x', hit: true }, { target: null, hit: false }, { target: 1, hit: 1 }, [], 'plan']) {
      expect('plan' in load(junk)!).toBe(false);
    }
    const good = s.lastReport!.plan!;
    expect(load({ ...good, stage: 2.6, stageBefore: -4, streak: 5000.4 })!.plan).toMatchObject({ stage: 3, stageBefore: 0, streak: 1000 });
    expect(load({ ...good, stage: 9, stageBefore: 7.2, streak: 2.5 })!.plan).toMatchObject({ stage: 3, stageBefore: 3, streak: 3 });
    expect(load({ ...good, stage: 1.4, stageBefore: 'x' })!.plan).toMatchObject({ stage: 1, stageBefore: 1 });
  });
});
