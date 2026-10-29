import { describe, expect, it } from 'vitest';
import { CATS, COMBO_WINDOW, MINUTES_PER_DAY, OPEN_FROM, type Cat } from '@/sim/economy/catalog';
import { applyCommand, type Command } from '@/sim/economy/commands';
import { awaitingDecision, stepMinute, type CommandResult, type EconEvent, type EconomyState, type Pallet } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { FATIGUE, tapCost, type TapKind } from '@/sim/economy/tycoon/fatigue';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
import { freshRun, replayRun, type LogEntry, type RunRecord } from '@/sim/run';
import { SIM_VERSION } from '@/sim/simVersion';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { RUN_MAX_LOG_ENTRIES } from '../src/server/config';

/**
 * Tempo stukania (pytanie z raportu B2a): serwer rankingu przyjmuje dziennik do `RUN_MAX_LOG_ENTRIES` wpisów, a parser (`runs.ts`)
 * nie ogranicza „szybkości klikania”. Decyzja: parser dostaje limit dopiero wtedy, gdy symulacja przestanie sama odrzucać stuknięcia
 * ponad siły. Dziś odrzuca: każde stuknięcie zużywa dzienną pulę `FATIGUE.pool` (kasa i paleta po `FATIGUE.tapCost`, a combo mnoży
 * koszt razem z efektem), pula wraca tylko częściowo w nocy (`nightRecovery`, przy zamknięciu dnia o 23:00), a przy pustej puli
 * ręce odmawiają. Przy otwartej karcie decyzji stuknięcie też jest odrzucane. Ten plik przypina to liczbami wyprowadzonymi ze stałych,
 * nie z pomiaru, więc zdjęcie limitu sił (albo koszt zero) zaczerwieni test, zamiast po cichu otworzyć sezon na dziesiątki tysięcy
 * przyjętych stuknięć.
 *
 * Czego to NIE ogranicza: odrzucone polecenia też trafiają do dziennika (`dispatchCommand` loguje także te, które się nie uda), więc
 * liczbę wpisów ograniczają dopiero limity dziennika (gra: `RUN_LOG_MAX`, serwer: `RUN_MAX_LOG_ENTRIES`), a nie zmęczenie. Odrzucone
 * wpisy nie zmieniają wyniku (poza licznikiem odmów rąk), więc koszt serwera pilnuje pomiar najgorszego przypadku
 * (scripts/judge-worst-case.mjs), a nie ten test. Test nie czyta zegara ani `Math.random`; seed jest stały.
 */

const SEED = 'kiełbasa-42';
/** Ile dni gry trwa stukanie (dzień 0 zaczyna się o 6:00, więc dni 0…2 to niecałe trzy doby). */
const DAYS = 3;
const TIRED_HANDS = 'Ręce odmawiają';
/** Tekst odmowy przy otwartej karcie (`CARD_FIRST` w src/sim/economy/commands.ts; stała nie jest eksportowana). */
const CARD_FIRST = 'Najpierw karta na biurku.';

type TapType = 'tapPallet' | 'tapTill';
const KIND: Record<TapType, TapKind> = { tapPallet: 'paleta', tapTill: 'kasa' };

// --- Limity wyprowadzone ze stałych ---------------------------------------------------------------------------------

/** Najtańsze stuknięcie: każde przyjęte polecenie zużywa co najmniej tyle sił (combo tylko podnosi koszt). */
const MIN_COST = Math.min(...Object.values(FATIGUE.tapCost));
/** Przyjętych poleceń na jedną pulę sił, gdy wszystkie kosztują najmniej i bez combo (w praktyce jest ich mniej). */
const PER_POOL = Math.ceil(FATIGUE.pool / MIN_COST);
/**
 * Przyjętych poleceń w dniu kalendarzowym. Siły wracają przy zamknięciu dnia o 23:00, więc doba od północy do północy zawiera koniec
 * jednego okna sił i początek następnego: pula plus zapas z regeneracji (`nightRecovery`).
 */
const PER_DAY = PER_POOL + Math.ceil(FATIGUE.nightRecovery / MIN_COST);
/** Przyjętych poleceń od startu do końca dnia, w którym minęło `nights` nocy: pula startowa plus regeneracja każdej nocy. */
const maxTaps = (nights: number): number => Math.ceil((FATIGUE.pool + nights * FATIGUE.nightRecovery) / MIN_COST);

// --- Stukanie bez przerwy -------------------------------------------------------------------------------------------

interface Attempt {
  minute: number;
  day: number;
  type: TapType;
  /** Siły tuż przed stuknięciem i tuż po nim. */
  before: number;
  after: number;
  result: CommandResult;
  /** Czy odmowa przy braku sił zmieniła stan poza licznikami odmów rąk (`refusedToday`, `refusedMonth`); tylko dla prób bez sił. */
  changedState?: boolean;
}

/** Odpowiada na widoczne karty zaznaczoną z góry odpowiedzią, tak jak robi to `replayRun` (karta zatrzymuje stuknięcia, ale nie dzień). */
function answerOpenCards(state: EconomyState, info: StoreInfo): void {
  if (!awaitingDecision(state)) return;
  for (const card of visibleCards(state.tycoon.cards, state.minute)) {
    applyCommand(state, info, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
  }
}

/**
 * Stan najgorszy dla limitu sił: kolejka przy kasie niepusta, a na zapleczu miejsce na towar z palety, która nie kończy się.
 * Dzięki temu stuknięcie bywa odrzucone tylko z powodu sił, karty albo zamkniętego sklepu, a nie braku klientów czy palet
 * (bez tego limit dzienny wynikałby w dużej mierze z braku roboty, a zdjęcie limitu sił nie zmieniłoby wyniku testu).
 */
function readyForTaps(s: EconomyState): void {
  s.queue = Math.max(s.queue, 8);
  for (const c of CATS) s.backroom[c] = 0;
  if (s.pallets.some((p) => p.total >= 100)) return;
  const used = new Set(s.pallets.filter((p) => p.loc === 'sidewalk').map((p) => p.spot));
  let spot = 0;
  while (used.has(spot)) spot++;
  const items = Object.fromEntries(CATS.map((c) => [c, 100])) as Record<Cat, number>;
  const pallet: Pallet = { id: s.nextPalletId++, loc: 'sidewalk', spot, items, total: 100 * CATS.length, initial: 100 * CATS.length, since: s.minute };
  s.pallets.push(pallet);
}

/**
 * Gracz, który stuka co `every` minut przez `DAYS` dni gry, na przemian w paletę i w kasę (`applyCommand` na `freshRun` w pętli
 * z `stepMinute`, bez zegara). Przy próbie bez sił zapamiętuje, czy odmowa ruszyła stan poza licznikami odmów.
 */
function spam(every: number): Attempt[] {
  const { state, info } = freshRun(SEED);
  const events: EconEvent[] = [];
  const attempts: Attempt[] = [];
  const start = state.minute;
  let n = 0;
  while (state.minute < DAYS * MINUTES_PER_DAY) {
    answerOpenCards(state, info);
    if ((state.minute - start) % every === 0) {
      const type: TapType = n++ % 2 === 0 ? 'tapPallet' : 'tapTill';
      readyForTaps(state);
      const fatigue = state.tycoon.fatigue;
      const before = fatigue.energy;
      const tired = before + 1e-9 < tapCost(KIND[type]);
      const snapshot = tired ? structuredClone(state) : null;
      const { result } = applyCommand(state, info, { type });
      const attempt: Attempt = { minute: state.minute, day: Math.floor(state.minute / MINUTES_PER_DAY), type, before, after: fatigue.energy, result };
      if (snapshot) {
        if (!result.ok && result.text.startsWith(TIRED_HANDS)) {
          snapshot.tycoon.fatigue.refusedToday++;
          snapshot.tycoon.fatigue.refusedMonth++;
        }
        attempt.changedState = JSON.stringify(state) !== JSON.stringify(snapshot);
      }
      attempts.push(attempt);
    }
    events.length = 0;
    stepMinute(state, info, events);
  }
  return attempts;
}

/** Rytmy stukania: co minutę (combo rośnie do ×5, więc koszt stuknięcia rośnie) i za wolno na combo (każde stuknięcie kosztuje tyle, co w stałych). */
const RHYTHMS: readonly { name: string; every: number }[] = [
  { name: 'co minutę', every: 1 },
  { name: `co ${COMBO_WINDOW + 1} minut (za rzadko na combo)`, every: COMBO_WINDOW + 1 },
];

const cache = new Map<number, Attempt[]>();
/** Próby danego rytmu, liczone raz (czysta funkcja stałych; testy tylko je czytają). */
const attemptsOf = (every: number): Attempt[] => {
  let attempts = cache.get(every);
  if (!attempts) cache.set(every, (attempts = spam(every)));
  return attempts;
};

const isTiredRefusal = (a: Attempt): boolean => !a.result.ok && a.result.text.startsWith(TIRED_HANDS);
/** Opis próby do komunikatu o błędzie. */
const describeAttempt = (a: Attempt): string => `dzień ${a.day}, minuta ${a.minute}, ${a.type}, siły ${a.before} → ${a.after}, ${a.result.ok ? 'przyjęte' : `odmowa „${a.result.text}”`}`;

describe('stałe sił: z nich wynikają limity poniżej', () => {
  it('koszt stuknięcia jest dodatni, a limity skończone (koszt zero albo pula bez dna zdjęłyby ograniczenie)', () => {
    expect(MIN_COST).toBeGreaterThan(0);
    expect(Number.isFinite(PER_DAY) && Number.isFinite(maxTaps(DAYS))).toBe(true);
  });

  it('przyjętych stuknięć w całym sezonie jest o rząd wielkości mniej niż wpisów, które przyjmuje serwer', () => {
    const nights = Math.ceil(RANKED_SEASON_END_MINUTE / MINUTES_PER_DAY);
    expect(maxTaps(nights), `${maxTaps(nights)} przyjętych stuknięć w sezonie przy limicie wpisów ${RUN_MAX_LOG_ENTRIES}`)
      .toBeLessThan(RUN_MAX_LOG_ENTRIES / 10);
  });
});

describe.each(RHYTHMS)('stukanie $name przez trzy dni gry, bez karty decyzji', ({ every }) => {
  it('dziennie przyjętych stuknięć jest najwyżej pula z kosztów i regeneracji, a w trzech dniach pula i trzy noce', () => {
    const accepted = Array.from({ length: DAYS }, (_, day) => attemptsOf(every).filter((a) => a.day === day && a.result.ok).length);
    accepted.forEach((n, day) => expect(n, `dzień ${day}: przyjęte stuknięcia (limit ${PER_DAY})`).toBeLessThanOrEqual(PER_DAY));
    expect(accepted.reduce((sum, n) => sum + n, 0), 'razem w trzech dniach').toBeLessThanOrEqual(maxTaps(DAYS));
    expect(accepted[0], 'pierwszego dnia stuknięcia są przyjmowane, więc test nie przechodzi z braku roboty').toBeGreaterThan(0);
  });

  it('każde przyjęte stuknięcie zużywa co najmniej najtańszy koszt, a pula naprawdę się wyczerpuje', () => {
    const attempts = attemptsOf(every);
    const cheap = attempts.filter((a) => a.result.ok && a.before - a.after < MIN_COST - 1e-9).map(describeAttempt);
    expect(cheap, 'przyjęte stuknięcia tańsze niż najtańszy koszt').toEqual([]);
    expect(attempts.filter(isTiredRefusal).length, 'odmowy rąk (pula wyczerpana)').toBeGreaterThan(0);
  });

  it('bez sił polecenie jest odrzucone i nie zmienia stanu poza licznikiem odmów rąk', () => {
    const tired = attemptsOf(every).filter((a) => a.changedState !== undefined);
    expect(tired.length, 'próby bez sił').toBeGreaterThan(0);
    expect(tired.filter((a) => a.result.ok).map(describeAttempt), 'przyjęte bez sił').toEqual([]);
    expect(tired.filter((a) => a.changedState).map(describeAttempt), 'odmowa zmieniła stan').toEqual([]);
    // paleta jest zawsze do rozładunku (`readyForTaps`), więc jedyną przyczyną jej odmowy bez sił są ręce
    expect(tired.filter((a) => a.type === 'tapPallet' && !isTiredRefusal(a)).map(describeAttempt)).toEqual([]);
  });
});

describe('stuknięcie przy otwartej karcie decyzji', () => {
  /** Stan w minucie, w której gra stanęła na pierwszej karcie (siły pełne, nic jeszcze nie stukano). */
  function atFirstCard(): { state: EconomyState; info: StoreInfo } {
    const { state, info } = freshRun(SEED);
    const events: EconEvent[] = [];
    for (let i = 0; i < DAYS * MINUTES_PER_DAY && !awaitingDecision(state); i++) {
      events.length = 0;
      stepMinute(state, info, events);
    }
    return { state, info };
  }

  it('oba stuknięcia są odrzucone tekstem „Najpierw karta na biurku.” i nie zmieniają stanu, choć siły są', () => {
    const { state, info } = atFirstCard();
    expect(awaitingDecision(state), 'w trzy dni gry pojawiła się karta').toBe(true);
    readyForTaps(state);
    expect(state.tycoon.fatigue.energy, 'siły są, więc odmowa nie bierze się ze zmęczenia').toBeGreaterThanOrEqual(tapCost('paleta'));
    const before = JSON.stringify(state);
    for (const type of ['tapPallet', 'tapTill'] as const) {
      const { result } = applyCommand(state, info, { type });
      expect(result, type).toEqual({ ok: false, text: CARD_FIRST });
    }
    expect(JSON.stringify(state), 'odmowa przy karcie nie rusza nawet liczników').toBe(before);
  });

  it('po odpowiedzi na kartę to samo stuknięcie jest przyjęte', () => {
    const { state, info } = atFirstCard();
    readyForTaps(state);
    expect(applyCommand(state, info, { type: 'tapPallet' }).result.ok, 'przy karcie').toBe(false);
    answerOpenCards(state, info);
    expect(awaitingDecision(state)).toBe(false);
    expect(applyCommand(state, info, { type: 'tapPallet' }).result.ok, 'po odpowiedzi').toBe(true);
  });
});

describe('stukanie szybsze niż minuta', () => {
  it('tysiące stuknięć w jednej minucie: przyjętych najwyżej jedna pula sił, reszta odrzucona rękami', () => {
    const { state, info } = freshRun(SEED);
    let accepted = 0;
    let tired = 0;
    for (let i = 0; i < 5000; i++) {
      readyForTaps(state);
      const { result } = applyCommand(state, info, { type: i % 2 === 0 ? 'tapPallet' : 'tapTill' });
      if (result.ok) accepted++;
      else if (result.text.startsWith(TIRED_HANDS)) tired++;
    }
    expect(accepted, 'przyjęte stuknięcia w jednej minucie').toBeGreaterThan(0);
    expect(accepted, 'przy 5000 próbach w jednej minucie').toBeLessThanOrEqual(PER_POOL);
    expect(tired, 'odmowy rąk').toBeGreaterThan(0);
  });
});

describe('dziennik ze stukaniem w odtworzeniu (tak, jak dostaje go serwer)', () => {
  it('stuknięcie co minutę przez trzy dni: wpisów tysiące, przyjętych najwyżej tyle, na ile starcza sił', () => {
    const log: LogEntry[] = [];
    for (let minute = OPEN_FROM; minute < DAYS * MINUTES_PER_DAY; minute++) {
      const cmd: Command = log.length % 2 === 0 ? { type: 'tapPallet' } : { type: 'tapTill' };
      log.push({ minute, seq: log.length, cmd });
    }
    const run: RunRecord = { seed: SEED, gameVersion: 'test', generatorVersion: GENERATOR_VERSION, simVersion: SIM_VERSION, mode: 'ranked', log };
    const state = replayRun(run, DAYS * MINUTES_PER_DAY);
    expect(state.total.taps, 'przyjęte stuknięcia w odtworzeniu').toBeGreaterThan(0);
    expect(state.total.taps, `przy ${log.length} wpisach`).toBeLessThanOrEqual(maxTaps(DAYS));
    expect(state.tycoon.fatigue.refusedMonth, 'ręce odmówiły (pula się wyczerpała), więc wpisów jest dużo więcej niż przyjętych stuknięć').toBeGreaterThan(0);
  });
});
