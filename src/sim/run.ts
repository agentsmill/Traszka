import { applyCommand, type Command } from '@/sim/economy/commands';
import { createEconomy, stepMinute, type EconEvent, type EconomyState } from '@/sim/economy/economy';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
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

/** `gameVersion` i `mode` tylko jadą z biegiem (sprawdza je serwer rankingu); odtworzenie liczy wyłącznie z seeda i dziennika. */
export interface RunRecord {
  seed: string;
  gameVersion: string;
  generatorVersion: number;
  mode: 'casual' | 'ranked';
  log: LogEntry[];
}

/** Świeża gra bez premii partnera: układ 0 z seeda, jego `StoreInfo` i stan startowy. Tak zaczyna i sesja, i odtworzenie. */
export function freshRun(seed: string): { state: EconomyState; layout: StoreLayout; info: StoreInfo } {
  const layout = layoutFor(seed, 0);
  const info = computeStoreInfo(layout);
  return { state: createEconomy(seed, info), layout, info };
}

/** Wpis, który da się ustawić w kolejności. `cmd` sprawdza dopiero `applyCommand`, a `NaN` w `minute` rozwaliłby porządek sortowania. */
const isOrderable = (e: unknown): e is LogEntry =>
  typeof e === 'object' && e !== null && Number.isFinite((e as LogEntry).minute) && Number.isFinite((e as LogEntry).seq);

/**
 * Odtwarza bieg do minuty `untilMinute` i zwraca stan, jaki miała wtedy żywa gra: po poleceniach tej minuty, przed jej krokiem.
 * Pętla jest ta sama co w żywej grze: w minucie M najpierw polecenia z M (w kolejności `(minute, seq)`), dopiero potem
 * `stepMinute`. Dlatego:
 * - wpis sprzed startu (minuta mniejsza od minuty początkowej) wchodzi na starcie, zanim ruszy pierwszy krok;
 * - wpis późniejszy niż `untilMinute` jest pomijany, bo pętla zatrzymuje się, zanim dojdzie do jego minuty;
 * - po końcu gry (bankructwo) pętla się kończy, a pozostałe polecenia `applyCommand` i tak odrzuca.
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

  const log = (Array.isArray(run.log) ? run.log.filter(isOrderable) : []).sort((a, b) => a.minute - b.minute || a.seq - b.seq);
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
    events.length = 0;
    stepMinute(state, info, events);
  }
}
