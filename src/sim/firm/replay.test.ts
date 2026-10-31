import { describe, expect, it } from 'vitest';
import { CITY_GENERATOR_VERSION } from '@/sim/city/types';
import { MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from '@/sim/economy/catalog';
import type { Command } from '@/sim/economy/commands';
import { awaitingDecision } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { freshRun, replayRun, type LogEntry, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { applyFirmCommand, type FirmCommand } from './commands';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, stepFirmMinute } from './firm';
import { replayFirm, type FirmLogEntry, type FirmRecord } from './replay';
import type { FirmState } from './types';

/*
 * Dziennik firmy i odtworzenie (spec §3.2): ten sam seed i ten sam dziennik poleceń dają ten sam stan miasta i wszystkich sklepów.
 * Żywa firma w testach pisze dziennik sama (każde polecenie dostaje minutę i `seq`, polecenia sklepu też numer sklepu), a odtworzenie
 * z niego ma dać skrót co do znaku, w tym w punktach pośrednich.
 */

/** Ziarno, dla którego status Partnera przychodzi sam z odpowiedzi zaznaczonych z góry (zaufanie 81 po dwóch miesiącach). */
const SEED = 'c';
const DAY = MINUTES_PER_DAY;
/** Minuta zamknięcia października (dzień 60): w tym kroku sklep startowy zamyka drugi miesiąc, więc przychodzi status. */
const OCT_CLOSE = 60 * DAY + OPEN_TO;

interface Live { seed: string; f: FirmState; log: FirmLogEntry[]; seq: number }
/** Punkt kontrolny: skrót żywej firmy w minucie `minute`, po poleceniach tej minuty i przed jej krokiem. */
interface Mark { name: string; minute: number; json: string }

const digest = (f: FirmState): string => JSON.stringify(f);
const clockOf = (l: Live): number => activeStore(l.f).econ.minute;

function live(seed: string): Live {
  const { state, layout, info } = freshRun(seed);
  return { seed, f: createFirm(seed, { econ: state, layout, info }, { ranked: false }), log: [], seq: 0 };
}

const recordOf = (l: Live, log: FirmLogEntry[] = l.log): FirmRecord =>
  ({ seed: l.seed, gameVersion: 'test', cityGeneratorVersion: CITY_GENERATOR_VERSION, log });

/** Polecenie gracza w aktywnym sklepie: do stanu i do dziennika (z numerem sklepu), także gdy sklep je odmówi. */
function store(l: Live, cmd: Command): boolean {
  const minute = clockOf(l);
  const { result } = applyStoreCommand(l.f, cmd);
  l.log.push({ minute, seq: l.seq++, store: l.f.activeId, cmd });
  return result.ok;
}

/** Polecenie firmy: do stanu i do dziennika. */
function firm(l: Live, cmd: FirmCommand): boolean {
  const minute = clockOf(l);
  const { ok } = applyFirmCommand(l.f, cmd, emptyStepOut());
  l.log.push({ minute, seq: l.seq++, firm: cmd });
  return ok;
}

/** Gracz klika „OK” na kartach aktywnego sklepu (odpowiedź zaznaczona z góry); odpowiedzi idą do dziennika. */
function answerActive(l: Live): void {
  const st = activeStore(l.f);
  while (awaitingDecision(st.econ)) {
    const card = visibleCards(st.econ.tycoon.cards, st.econ.minute)[0]!;
    expect(store(l, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) })).toBe(true);
  }
}

function tick(l: Live): void {
  answerActive(l);
  stepFirmMinute(l.f, emptyStepOut());
}

function playTo(l: Live, minute: number): void {
  while (clockOf(l) < minute && l.f.over === null && !activeStore(l.f).econ.gameOver) tick(l);
}

/** Punkt kontrolny po odpowiedziach na karty. Odtworzenie do minuty M zawiera wszystkie polecenia M, więc po punkcie scenariusz robi krok, zanim wyda kolejne. */
function mark(l: Live, name: string, marks: Mark[]): void {
  answerActive(l);
  marks.push({ name, minute: clockOf(l), json: digest(l.f) });
}

const freeLot = (f: FirmState): number => f.city.lots.find((lot) => lot.state === 'wolny')!.id;

/**
 * Cała gra firmy z poleceniami obu poziomów: status Partnera z samej gry, wynajem na raty, budowa, polecenia sklepu #1,
 * `switchStore` i polecenia w sklepie #2 (z kartami sklepu #1 w tle), powrót, `terminateStore` i rozliczenie końcowe.
 */
function scenario(seed = SEED): { l: Live; marks: Mark[] } {
  const l = live(seed);
  const marks: Mark[] = [];

  playTo(l, OCT_CLOSE);
  tick(l);   // zamknięcie października
  expect(l.f.person.partner).toBe(true);

  expect(store(l, { type: 'setOrder', auto: true, manual: 4 })).toBe(true);
  expect(firm(l, { type: 'rentLot', lotId: freeLot(l.f), pay: 'raty' })).toBe(true);
  const build = l.f.builds[0]!;
  playTo(l, (build.readyDay - 2) * DAY + OPEN_FROM);
  expect(store(l, { type: 'hire' })).toBe(true);
  playTo(l, build.readyDay * DAY + OPEN_FROM);
  mark(l, 'dzień odbioru, przed otwarciem', marks);
  tick(l);   // w tym kroku sklep #2 się otwiera
  expect(l.f.stores).toHaveLength(2);

  expect(store(l, { type: 'setStaffProfile', profile: 'porzadek' })).toBe(true);
  playTo(l, clockOf(l) + 3 * DAY);
  mark(l, 'dwa sklepy, aktywny #1', marks);
  tick(l);   // dalsze polecenia w innej minucie niż punkt kontrolny: odtworzenie do minuty M zawiera wszystkie jej polecenia

  expect(firm(l, { type: 'switchStore', storeId: 2 })).toBe(true);
  expect(l.f.activeId).toBe(2);
  expect(store(l, { type: 'hire' })).toBe(true);
  expect(store(l, { type: 'setOrder', auto: true, manual: 2 })).toBe(true);
  playTo(l, clockOf(l) + 2 * DAY);
  expect(store(l, { type: 'setStaffProfile', profile: 'dostawa' })).toBe(true);
  mark(l, 'aktywny #2', marks);
  tick(l);

  expect(firm(l, { type: 'switchStore', storeId: 1 })).toBe(true);
  expect(store(l, { type: 'campaign' })).toBe(true);
  expect(firm(l, { type: 'terminateStore', storeId: 2 })).toBe(true);
  playTo(l, clockOf(l) + 4 * DAY);
  mark(l, 'okres wypowiedzenia', marks);

  const endDay = l.f.stores[1]!.notice!.endDay;
  playTo(l, (endDay + 1) * DAY + OPEN_FROM);
  expect(l.f.stores[1]!.closed).toBe(true);
  playTo(l, clockOf(l) + 2 * DAY);
  mark(l, 'po rozliczeniu końcowym', marks);
  return { l, marks };
}

/** Scenariusz liczy się raz na plik: testy tylko czytają żywą firmę, dziennik i punkty kontrolne. */
let cached: ReturnType<typeof scenario> | undefined;
const played = (): ReturnType<typeof scenario> => (cached ??= scenario());

describe('replayFirm: żywa firma i odtworzenie z dziennika', () => {
  it('po scenariuszu (status, rentLot na raty, budowa, switchStore, polecenia w obu sklepach, terminateStore) odtworzenie równa się żywej firmie, także w punktach pośrednich', () => {
    const { l, marks } = played();
    const rec = recordOf(l);
    // dziennik ma polecenia obu poziomów i obu sklepów
    expect(rec.log.some((e) => 'firm' in e)).toBe(true);
    expect(new Set(rec.log.flatMap((e) => ('store' in e ? [e.store] : [])))).toEqual(new Set([1, 2]));
    expect(l.f.stores.map((s) => s.closed)).toEqual([false, true]);   // rozliczenie końcowe sklepu #2 poszło
    expect(l.f.inbox.some((n) => n.storeId === 2)).toBe(true);   // zastępca odpowiadał w tle na karty (to też jest w skrócie)
    expect(l.f.over).toBeNull();   // a gra idzie dalej na sklepie #1

    for (const m of marks) expect(digest(replayFirm(rec, m.minute)), m.name).toBe(m.json);
    expect(marks[marks.length - 1]!.json).toBe(digest(l.f));   // ostatni punkt to koniec scenariusza
  }, 120_000);

  it('§3.2: ten sam seed i dziennik dają ten sam FirmState w dwóch przebiegach', () => {
    const { l } = played();
    const rec = recordOf(l);
    const until = clockOf(l);
    const a = replayFirm(rec, until);
    const b = replayFirm(rec, until);
    expect(a).not.toBe(b);
    expect(digest(a)).toBe(digest(b));
    expect(rec.log.length).toBeGreaterThan(10);   // porównujemy coś, co ma historię
    expect(a.stores).toHaveLength(2);
    expect(a.person.partner).toBe(true);
  }, 120_000);

  it('kolejność w tablicy dziennika nie ma znaczenia: wpisy ustawiają się po (minute, seq), a dziennik wejściowy zostaje nietknięty', () => {
    const { l, marks } = played();
    const m = marks.find((x) => x.name === 'aktywny #2')!;
    const reversed = [...l.log].reverse();
    const before = JSON.stringify(reversed);
    expect(digest(replayFirm(recordOf(l, reversed), m.minute))).toBe(m.json);
    expect(JSON.stringify(reversed)).toBe(before);
  }, 120_000);

  it('polecenie sklepu działa tylko wtedy, gdy jego store jest aktywny; inaczej jest pomijane', () => {
    const { l, marks } = played();
    const m = marks.find((x) => x.name === 'aktywny #2')!;   // aktywny jest sklep #2, w minucie po wszystkich poleceniach
    const extra = (storeId: number): FirmLogEntry => ({ minute: m.minute, seq: 1_000_000, store: storeId, cmd: { type: 'setOrder', auto: false, manual: 9 } });

    expect(digest(replayFirm(recordOf(l, [...l.log, extra(1)]), m.minute))).toBe(m.json);   // sklep #1 nie jest aktywny: pominięte
    expect(digest(replayFirm(recordOf(l, [...l.log, extra(7)]), m.minute))).toBe(m.json);   // sklepu #7 nie ma: pominięte
    expect(digest(replayFirm(recordOf(l, [...l.log, extra(2)]), m.minute))).not.toBe(m.json);   // sklep #2 jest aktywny: zadziałało
  }, 120_000);
});

describe('replayFirm: sklep nr 1 jak replayRun', () => {
  const store1: LogEntry[] = [];
  const cmds: Command[] = [
    { type: 'setOrder', auto: false, manual: 3 }, { type: 'hire' }, { type: 'campaign' }, { type: 'tapTill' },
    { type: 'setStaffProfile', profile: 'dostawa' }, { type: 'setOrder', auto: true }, { type: 'fire' }, { type: 'tapPallet' },
  ];
  for (let i = 0; i < 40; i++) store1.push({ minute: Math.floor(i / 2) * DAY + OPEN_FROM + (i % 2) * 90, seq: i, cmd: cmds[i % cmds.length]! });
  const run = (log: LogEntry[]): RunRecord =>
    ({ seed: SEED, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'casual', log });
  const firmLog = (log: LogEntry[]): FirmLogEntry[] => log.map((e) => ({ minute: e.minute, seq: e.seq, store: 1, cmd: e.cmd }));
  const firmRec = (log: FirmLogEntry[]): FirmRecord =>
    ({ seed: SEED, gameVersion: 'test', cityGeneratorVersion: CITY_GENERATOR_VERSION, log });

  it('same polecenia sklepu nr 1 dają sklep 1 o skrócie równym replayRun z tego samego dziennika', () => {
    for (const days of [1, 5, 14, 35, 65]) {
      const until = days * DAY + OPEN_TO;
      const expected = replayRun(run(store1), until);
      const f = replayFirm(firmRec(firmLog(store1)), until);
      expect(expected.gameOver, `${days} dni`).toBe(false);   // porównujemy żywą grę, nie stan po bankructwie
      expect(f.over).toBeNull();
      expect(f.stores).toHaveLength(1);
      expect(JSON.stringify(f.stores[0]!.econ), `${days} dni`).toBe(JSON.stringify(expected));
      expect(f.person.wallet).toBe(expected.cash);
      expect(f.stores[0]!.info.site).toBeUndefined();   // jeden sklep startowy gra jak dziś, bez dzielnicy
    }
    // dziennik ma wpływ na stan: bez poleceń wychodzi inna gra
    const until = 14 * DAY;
    expect(JSON.stringify(replayRun(run(store1), until))).not.toBe(JSON.stringify(replayRun(run([]), until)));
  }, 60_000);

  it('bez dziennika i z samymi odpowiedziami domyślnymi firma dochodzi do końca minuty, zamiast zawisnąć na pierwszej karcie', () => {
    const until = 30 * DAY;
    const f = replayFirm(firmRec([]), until);
    expect(activeStore(f).econ.minute).toBe(until);
    expect(JSON.stringify(f.stores[0]!.econ)).toBe(JSON.stringify(replayRun(run([]), until)));
  }, 30_000);

  it('na końcu gry odtworzenie staje tam, gdzie replayRun, i nie liczy dalej', () => {
    // trzy rekrutacje i zamówienia na zero: sklep zadłuża się do limitu przed końcem dwóch miesięcy
    const bust: LogEntry[] = [
      { minute: 0, seq: 0, cmd: { type: 'setOrder', auto: false, manual: 0 } },
      { minute: 0, seq: 1, cmd: { type: 'hire' } }, { minute: 0, seq: 2, cmd: { type: 'hire' } }, { minute: 0, seq: 3, cmd: { type: 'hire' } },
    ];
    const until = 400 * DAY;
    const expected = replayRun(run(bust), until);
    expect(expected.gameOver).toBe(true);
    expect(expected.minute).toBeLessThan(until);
    const f = replayFirm(firmRec(firmLog(bust)), until);
    expect(activeStore(f).econ.gameOver).toBe(true);
    expect(activeStore(f).econ.minute).toBe(expected.minute);
    expect(JSON.stringify(f.stores[0]!.econ)).toBe(JSON.stringify(expected));
    expect(digest(replayFirm(firmRec(firmLog(bust)), until + 100 * DAY))).toBe(digest(f));
  }, 30_000);

  it('stan w untilMinute jest po poleceniach tej minuty i przed jej krokiem; późniejsze wpisy odpadają, wcześniejsze niż start wchodzą na starcie', () => {
    const start = activeStore(replayFirm(firmRec([]), 0)).econ.minute;
    const log: LogEntry[] = [
      { minute: start - 500, seq: 0, cmd: { type: 'setOrder', auto: false, manual: 2 } },   // sprzed startu: wchodzi na starcie
      { minute: start + 10, seq: 1, cmd: { type: 'hire' } },
      { minute: start + 11, seq: 2, cmd: { type: 'fire' } },
    ];
    const at = (m: number, entries: LogEntry[] = log): FirmState => replayFirm(firmRec(firmLog(entries)), m);
    const staff = (m: number): number => at(m).stores[0]!.econ.staff;
    const base = staff(start + 9);
    expect(staff(start + 10)).toBe(base + 1);   // polecenie z minuty 10 jest już w stanie z minuty 10
    expect(staff(start + 11)).toBe(base);       // a zwolnienie z minuty 11 w stanie z minuty 11, ale nie wcześniej
    expect(staff(start + 9)).toBe(base);
    for (const m of [start, start + 9, start + 10, start + 11, start + 12]) {
      expect(activeStore(at(m)).econ.minute).toBe(m);
      expect(JSON.stringify(at(m).stores[0]!.econ), `minuta ${m}`).toBe(JSON.stringify(replayRun(run(log), m)));
    }
    expect(JSON.stringify(at(start).stores[0]!.econ)).not.toBe(JSON.stringify(at(start, []).stores[0]!.econ));   // wpis sprzed startu zadziałał
  });
});

describe('replayFirm: granice i dziennik od klienta', () => {
  const rec = (log: unknown[], extra: Partial<FirmRecord> = {}): FirmRecord =>
    ({ seed: SEED, gameVersion: 'test', cityGeneratorVersion: CITY_GENERATOR_VERSION, log: log as FirmLogEntry[], ...extra });

  it('inna cityGeneratorVersion rzuca błąd (to byłoby inne miasto), a ta sama przechodzi', () => {
    expect(() => replayFirm(rec([], { cityGeneratorVersion: CITY_GENERATOR_VERSION + 1 }), 100)).toThrow(/generator/i);
    expect(() => replayFirm(rec([], { cityGeneratorVersion: 0 }), 100)).toThrow();
    expect(() => replayFirm(rec([]), 100)).not.toThrow();
  });

  it('untilMinute poza liczbami skończonymi rzuca RangeError, zamiast pętlić bez końca', () => {
    for (const bad of [Infinity, -Infinity, NaN]) expect(() => replayFirm(rec([]), bad)).toThrow(RangeError);
  });

  it('zepsute wpisy odpadają bez rzucania i nie ruszają stanu: bez minuty i seq, bez polecenia, nieznane i zepsute polecenia obu poziomów', () => {
    const until = 3 * DAY;
    const clean = digest(replayFirm(rec([]), until));
    const junk: unknown[] = [
      null, 7, 'x', [], {},
      { minute: NaN, seq: 0, store: 1, cmd: { type: 'hire' } },
      { minute: 5, seq: Infinity, store: 1, cmd: { type: 'hire' } },
      { minute: 5, seq: 1 },
      { minute: 5, seq: 2, store: 1 },
      { minute: 5, seq: 3, store: 1, cmd: { type: 'nieznane' } },
      { minute: 5, seq: 4, store: 1, cmd: null },
      { minute: 5, seq: 5, store: 'jeden', cmd: { type: 'hire' } },
      { minute: 5, seq: 6, cmd: { type: 'hire' } },
      { minute: 5, seq: 7, firm: null },
      { minute: 5, seq: 8, firm: { type: 'nieznane' } },
      { minute: 5, seq: 9, firm: { type: 'rentLot', lotId: 'x', pay: 'raty' } },
      { minute: 5, seq: 10, firm: { type: 'switchStore', storeId: 2 } },   // sklepu #2 nie ma
      { minute: 5, seq: 11, firm: { type: 'rentLot', lotId: 1, pay: 'raty' } },   // brak statusu Partnera
      { minute: 5, seq: 12, firm: { type: 'terminateStore', storeId: 1 } },   // jedyny sklep
    ];
    expect(digest(replayFirm(rec(junk), until))).toBe(clean);
    expect(digest(replayFirm(rec(undefined as never), until))).toBe(clean);   // dziennik nie jest tablicą: pusty
    expect(() => replayFirm(rec(junk), until)).not.toThrow();
  });
});
