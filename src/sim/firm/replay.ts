import { CITY_GENERATOR_VERSION } from '@/sim/city/types';
import { isCommand, type Command } from '@/sim/economy/commands';
import { awaitingDecision } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { freshRun } from '@/sim/run';
import { applyFirmCommand, isFirmCommand, type FirmCommand } from './commands';
import { activeStore, applyStoreCommand, createFirm, emptyStepOut, stepFirmMinute } from './firm';
import type { FirmState, FirmStepOut } from './types';

/*
 * Dziennik firmy i jego odtworzenie (spec §3.2). Zwykła gra, która ma więcej niż jeden sklep, nie mieści się w `RunRecord`
 * (jedno `Command` na wpis, jeden sklep), więc ma własny dziennik: polecenia sklepu niosą numer sklepu, w którym je wydano, a
 * polecenia firmy (wynajem, przełączenie, wypowiedzenie) nie. Odtworzenie to ta sama pętla co `replayRun`, tylko na firmie.
 * `run.ts`, `ranked.ts` i sędzia tego pliku nie importują: ich bundel zostaje taki, jaki był.
 */

/**
 * Wpis dziennika firmy: minuta gry (`minute` aktywnego sklepu w chwili wydania, wszystkie otwarte sklepy stoją w tej samej) i numer
 * w biegu `seq` (kolejność w jednej minucie). Polecenie sklepu niesie `store`, czyli `id` sklepu, który był wtedy aktywny.
 */
export type FirmLogEntry =
  | { minute: number; seq: number; store: number; cmd: Command }
  | { minute: number; seq: number; firm: FirmCommand };

/**
 * Bieg zwykłej gry z firmą: seed i dziennik. `cityGeneratorVersion` to `CITY_GENERATOR_VERSION` z chwili gry (inne miasto to inna
 * gra); `gameVersion` tylko jedzie z zapisem, odtworzenie jej nie czyta. Bieg rankingowy zostaje przy `RunRecord`.
 */
export interface FirmRecord { seed: string; gameVersion: string; cityGeneratorVersion: number; log: FirmLogEntry[] }

/**
 * Czy `x` da się ustawić w kolejności: obiekt ze skończonymi `minute` i `seq` (jak `isLogEntry` w `run.ts`). Czy ma polecenie i jakie,
 * rozstrzyga dopiero odtworzenie, bo `NaN` w `minute` rozwaliłby porządek sortowania, a reszta wpisu może być czymkolwiek.
 */
const isOrdered = (x: unknown): x is { minute: number; seq: number } =>
  typeof x === 'object' && x !== null && Number.isFinite((x as { minute: number }).minute) && Number.isFinite((x as { seq: number }).seq);

/**
 * Wpis idzie do firmy tak, jak poszedłby z klienta: polecenie firmy zawsze (odmowę zwraca `applyFirmCommand`), polecenie sklepu
 * tylko do sklepu, który jest teraz aktywny (inaczej pominięte: w żywej grze nie dotarłoby do tamtego sklepu). Wpis o nieznanym
 * kształcie nie rusza stanu.
 */
function applyEntry(f: FirmState, entry: Record<string, unknown>, scratch: FirmStepOut): void {
  if (Object.hasOwn(entry, 'firm')) {
    const cmd = entry.firm;
    if (isFirmCommand(cmd)) applyFirmCommand(f, cmd, scratch);
  } else if (Object.hasOwn(entry, 'store') && entry.store === f.activeId) {
    const cmd = entry.cmd;
    if (isCommand(cmd)) applyStoreCommand(f, cmd);
  }
}

/**
 * Odtwarza bieg firmy do minuty `untilMinute` i zwraca stan, jaki miała wtedy żywa gra: po poleceniach tej minuty, przed jej krokiem.
 * Start to `createFirm(seed, freshRun(seed), { ranked: false })`, potem pętla `replayRun` na firmie. W minucie M, w tej kolejności:
 * 1. polecenia z minuty M po `(minute, seq)` (wpis sprzed startu wchodzi na starcie, późniejszy niż `untilMinute` odpada);
 * 2. karta aktywnego sklepu bez odpowiedzi w dzienniku dostaje odpowiedź zaznaczoną z góry (poza dziennikiem, jak w `replayRun`);
 *    karty sklepów w tle rozstrzyga w kroku zastępca (`stepFirmMinute`), a karta, która pokazała się w sklepie w minucie przełączenia,
 *    jest już kartą aktywnego sklepu;
 * 3. `stepFirmMinute`.
 * Pętla kończy się też na końcu gry: `over` firmy (debet całej gotówki, zamknięcie ostatniego sklepu) albo `gameOver` aktywnego sklepu.
 *
 * Dziennik przychodzi od klienta, więc nie rzucamy z jego powodu: wpisy bez skończonej minuty albo `seq` odpadają, wpisy o nieznanym
 * kształcie i polecenia, które nie są `isCommand` ani `isFirmCommand`, nie ruszają stanu, a odmowy (brak statusu, limit, zły sklep)
 * zwraca `applyFirmCommand` bez zmiany stanu. Sortowanie jest na kopii i stabilne (remis `(minute, seq)` rozstrzyga kolejność w dzienniku).
 * Rzuca tylko wtedy, gdy odtworzenie nie mogłoby być wierne: inna `cityGeneratorVersion` (to byłoby inne miasto), seed bez sklepu
 * (jak `freshRun`) albo `untilMinute` poza liczbami skończonymi. Górną granicę `untilMinute` ustawia wołający.
 */
export function replayFirm(rec: FirmRecord, untilMinute: number): FirmState {
  if (rec.cityGeneratorVersion !== CITY_GENERATOR_VERSION) {
    throw new Error(`Dziennik pochodzi z generatora miasta w wersji ${rec.cityGeneratorVersion}, a ten kod ma ${CITY_GENERATOR_VERSION}: to byłoby inne miasto.`);
  }
  if (!Number.isFinite(untilMinute)) throw new RangeError(`untilMinute musi być liczbą skończoną, jest: ${untilMinute}.`);

  const log = (Array.isArray(rec.log) ? rec.log.filter(isOrdered) : []).sort((a, b) => a.minute - b.minute || a.seq - b.seq);
  const { state, layout, info } = freshRun(rec.seed);
  const f = createFirm(rec.seed, { econ: state, layout, info }, { ranked: false });
  const scratch = emptyStepOut();   // zdarzenia są tylko dla gracza; tablice są wspólne i czyszczone co krok
  let next = 0;
  for (;;) {
    while (next < log.length && log[next]!.minute <= activeStore(f).econ.minute) applyEntry(f, log[next++]! as Record<string, unknown>, scratch);
    const active = activeStore(f).econ;
    if (active.minute >= untilMinute || f.over !== null || active.gameOver) return f;
    if (awaitingDecision(active)) {
      for (const card of visibleCards(active.tycoon.cards, active.minute)) {
        applyStoreCommand(f, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) });
      }
    }
    scratch.active.length = 0;
    scratch.background.length = 0;
    scratch.firm.length = 0;
    stepFirmMinute(f, scratch);
  }
}
