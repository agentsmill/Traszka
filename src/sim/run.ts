import { applyCommand, type Command } from '@/sim/economy/commands';
import { awaitingDecision, createEconomy, stepMinute, type EconEvent, type EconomyState } from '@/sim/economy/economy';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { layoutFor } from '@/sim/store/layoutFor';
import type { StoreLayout } from '@/sim/store/types';

/**
 * Bieg rankingowy to (seed, dziennik poleceń), a serwer odtwarza go tym samym kodem `src/sim`, który liczy żywą grę.
 * Odtworzenie jest wierne, bo cała gra to stan, `applyCommand` (polecenia) i `stepMinute` (upływ minuty): nic nie zależy
 * od zegara, losowości spoza stanu ani formatowania liczb.
 */

/** Polecenie gracza z minutą gry, w której je wydał (`state.minute` w chwili wydania), i numerem w biegu (rozstrzyga kolejność w jednej minucie). */
export interface LogEntry {
  minute: number;
  seq: number;
  cmd: Command;
}

/**
 * `gameVersion` i `mode` tylko jadą z biegiem (sprawdza je serwer rankingu); odtworzenie liczy wyłącznie z seeda i dziennika.
 * `simVersion` to wersja wyniku symulacji (`SIM_VERSION`, `src/sim/simVersion.ts`), według której bieg został rozegrany. Wypełnia
 * ją gra, gdy bieg się zaczyna (`newRunLog` w `src/game/session.ts`), a porównuje sędzia na serwerze (`src/server/judge.ts`) z
 * `SIM_VERSION` swojego bundla: inna wersja to `old-version`, bez odtwarzania. `replayRun` jej nie porównuje, bo sam jest częścią
 * tej symulacji i nie ma jak wiedzieć, że dziennik pochodzi z innej.
 */
export interface RunRecord {
  seed: string;
  gameVersion: string;
  generatorVersion: number;
  simVersion: number;
  mode: 'casual' | 'ranked';
  log: LogEntry[];
}

/** Świeża gra bez premii partnera: układ 0 z seeda, jego `StoreInfo` i stan startowy. Tak zaczyna i sesja, i odtworzenie. */
export function freshRun(seed: string): { state: EconomyState; layout: StoreLayout; info: StoreInfo } {
  const layout = layoutFor(seed, 0);
  const info = computeStoreInfo(layout);
  return { state: createEconomy(seed, info), layout, info };
}

/**
 * Czy `x` jest wpisem dziennika, który da się ustawić w kolejności: obiekt ze skończonymi `minute` i `seq`. `cmd` może być
 * czymkolwiek, bo polecenia odrzuca dopiero `applyCommand` (`isCommand`), a `NaN` w `minute` rozwaliłby porządek sortowania.
 */
export const isLogEntry = (x: unknown): x is LogEntry =>
  typeof x === 'object' && x !== null && Number.isFinite((x as LogEntry).minute) && Number.isFinite((x as LogEntry).seq);

/**
 * Czy `x` ma kształt biegu: `seed` i `gameVersion` to napisy, `generatorVersion` i `simVersion` liczby całkowite, `mode` 'casual'
 * albo 'ranked', `log` tablica. Którą `simVersion` przyjąć, rozstrzyga sędzia, nie ta funkcja. Wpisów dziennika nie sprawdza
 * (robi to `isLogEntry` i `applyCommand`), a granice (długość seeda, liczba wpisów, minuty) ustawia wołający, np. serwer rankingu
 * przed `replayRun`.
 */
export function isRunRecord(x: unknown): x is RunRecord {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return typeof r.seed === 'string' && typeof r.gameVersion === 'string' && Number.isInteger(r.generatorVersion)
    && Number.isInteger(r.simVersion) && (r.mode === 'casual' || r.mode === 'ranked') && Array.isArray(r.log);
}

/**
 * Odtwarza bieg do minuty `untilMinute` i zwraca stan, jaki miała wtedy żywa gra: po poleceniach tej minuty, przed jej krokiem.
 * Pętla jest ta sama co w żywej grze: w minucie M najpierw polecenia z M (w kolejności `(minute, seq)`), dopiero potem
 * `stepMinute`. Dlatego:
 * - wpis sprzed startu (minuta mniejsza od minuty początkowej) wchodzi na starcie, zanim ruszy pierwszy krok;
 * - wpis późniejszy niż `untilMinute` jest pomijany, bo pętla zatrzymuje się, zanim dojdzie do jego minuty;
 * - po końcu gry (bankructwo) pętla się kończy, a pozostałe polecenia `applyCommand` i tak odrzuca;
 * - karta bez odpowiedzi w dzienniku dostaje odpowiedź zaznaczoną z góry: żywa gra stoi na karcie do odpowiedzi gracza, a
 *   `stepMinute` sam jej nie pilnuje, więc po poleceniach minuty (odpowiedź gracza, jeśli jest, wchodzi z dziennika) każda
 *   widoczna karta, która nadal czeka, dostaje `answerCard` z `defaultAnswer` (poza dziennikiem, jak każdy krok symulacji).
 *   Dzięki temu dziennik z samymi stuknięciami dochodzi do końca, zamiast zawisnąć na pierwszej karcie. Stan w minucie
 *   `untilMinute` jest sprzed takiej odpowiedzi (pętla wraca wcześniej), czyli taki, jaki żywa gra miała przed kliknięciem.
 * Dziennik przychodzi od klienta, więc nie rzucamy z jego powodu: wpisy bez skończonej minuty albo `seq` odpadają, nieznane
 * i zepsute polecenia odrzuca `applyCommand`, a sortowanie na kopii jest stabilne (remis `(minute, seq)` rozstrzyga kolejność
 * w dzienniku). Rzuca tylko wtedy, gdy odtworzenie nie mogłoby być wierne: inna wersja generatora (to byłby inny sklep),
 * seed, dla którego generator nie daje sklepu (jak przy `createSession`), albo `untilMinute` poza liczbami skończonymi (pętla
 * nigdy by się nie zatrzymała). Górną granicę `untilMinute` ustawia wołający: bieg, który nie kończy się bankructwem, liczy
 * się tyle minut, ile mu każe.
 */
export function replayRun(run: RunRecord, untilMinute: number): EconomyState {
  if (run.generatorVersion !== GENERATOR_VERSION) {
    throw new Error(`Dziennik pochodzi z generatora sklepów w wersji ${run.generatorVersion}, a ten kod ma ${GENERATOR_VERSION}: to byłby inny sklep.`);
  }
  if (!Number.isFinite(untilMinute)) throw new RangeError(`untilMinute musi być liczbą skończoną, jest: ${untilMinute}.`);

  const log = (Array.isArray(run.log) ? run.log.filter(isLogEntry) : []).sort((a, b) => a.minute - b.minute || a.seq - b.seq);
  const { state, info: start } = freshRun(run.seed);
  let info = start;
  const events: EconEvent[] = [];   // zdarzenia są tylko dla gracza; tablica jest wspólna i czyszczona co krok
  let next = 0;
  for (;;) {
    while (next < log.length && log[next]!.minute <= state.minute) {
      const out = applyCommand(state, info, log[next++]!.cmd);
      if (out.layoutChanged && out.info) info = out.info;   // po remoncie dalsze kroki liczą na nowym układzie
    }
    if (state.minute >= untilMinute || state.gameOver) return state;
    if (awaitingDecision(state)) {
      for (const card of visibleCards(state.tycoon.cards, state.minute)) {
        applyCommand(state, info, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
      }
    }
    events.length = 0;
    stepMinute(state, info, events);
  }
}
