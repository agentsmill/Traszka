import { layoutFor } from '@/sim/store/layoutFor';
import type { StoreLayout } from '@/sim/store/types';
import {
  answerCard, awaitingDecision, buyEquipment, buyUpgrade, campaign, checkDebt, claimMilestone, commitTap, comboMult, fire, hire,
  movePallet, nextTapStreak, processLevels, relayout, rushRemont, setOrder, startRemont, tapPallet, tapTill,
  type CommandResult, type EconEvent, type EconomyState,
} from './economy';
import { computeStoreInfo, type PalletLoc, type StoreInfo } from './storeInfo';
import { MILESTONES } from './milestones';
import { STAFF_PROFILES, TASK_LABEL, pinStaff, setStaffProfile, type StaffProfile, type StaffTask } from './tycoon/staff';
import { EQUIPMENT_BY_ID, UPGRADE_BY_ID, type EquipmentId, type UpgradeId } from './upgrades';

/**
 * Jedyne miejsce zmiany stanu w odpowiedzi na gracza (§14.1, I5): każda akcja to serializowalne `Command`, a
 * `applyCommand` sprawdza je, stosuje, liczy poziomy i po remoncie przebudowuje układ. Czyste, bez zegara: minuta gry
 * jest w stanie, więc przeglądarka i serwer odtwarzający dziennik poleceń dostają ten sam stan co do bajtu.
 */

/**
 * Jak dodać nowe polecenie (każdy krok poza ostatnim pilnuje kompilator albo test, więc pominięcie wyjdzie od razu):
 * 1. wariant w tej unii; pola tylko płaskie (`string`, `number`, `boolean`, `undefined`), bez tablic i obiektów (patrz niżej);
 * 2. walidator w tabeli `VALID` (kształt pól; `tsc` wymusza wpis dla każdego typu);
 * 3. gałąź w `run` (`tsc` wymusza przez `never`);
 * 4. typ w `COMMAND_TYPES` (test `commands.test.ts` porównuje je z `CASES`);
 * 5. wpis w `CASES` w `commands.test.ts` (`tsc` wymusza; test sprawdza też, że polecenie przechodzi `isCommand`);
 * 6. wpis w `AFTER` w `src/game/actions.ts` (`tsc` wymusza) i, gdy zmienia się tabela, test, który ją przypina (`actions.test.ts`);
 * 7. wysłanie z interfejsu przez `game.dispatch` (typowane), nigdy przez wywołanie funkcji z `economy.ts`.
 * Dziennik i odtwarzanie biegu (`replayRun`) obejmą nowe polecenie same.
 *
 * Pola są płaskie, bo `dispatchCommand` (dziennik) i `applyCommand` kopiują polecenie płytko (`{ ...cmd }`): pole-obiekt albo
 * tablica dzieliłoby referencję ze stanem gry albo z obiektem interfejsu, a późniejsza zmiana po cichu przepisałaby dziennik
 * (`replayRun` rozjechałby się ze stanem). Kompilator tego pilnuje (`FlatCommands` niżej), a test w `commands.test.ts` sprawdza to samo na wartościach.
 */
export type Command =
  | { type: 'tapPallet'; palletId?: number }
  | { type: 'tapTill' }
  | { type: 'movePallet'; palletId: number; loc: PalletLoc }
  /**
   * Dawne odesłanie palety (do SIM_VERSION 4). Od SIM_VERSION 5 palet nikt nie odsyła, a interfejs tego polecenia nie wysyła;
   * typ zostaje tylko po to, żeby zapisane dzienniki biegów z SIM 4 dalej przechodziły `isCommand` (`readRun` odrzuciłby cały
   * zapis przez jeden nieznany wpis). Zawsze odmawia i nie rusza stanu.
   */
  | { type: 'returnPallet'; palletId: number }
  | { type: 'setOrder'; auto: boolean; manual?: number }
  | { type: 'hire' }
  | { type: 'fire' }
  | { type: 'setStaffProfile'; profile: StaffProfile }
  | { type: 'pinStaff'; task: StaffTask; count: number }
  // `raty`: na raty u Centrali (SIM_VERSION 6); bez pola za gotówkę, jak w dziennikach sprzed raty
  | { type: 'buyUpgrade'; id: UpgradeId; raty?: boolean }
  | { type: 'buyEquipment'; id: EquipmentId; slotId?: string; raty?: boolean }
  | { type: 'startRemont'; raty?: boolean }
  | { type: 'campaign' }
  | { type: 'rushRemont' }
  | { type: 'answerCard'; seq: number; answer: number }
  | { type: 'claimMilestone'; id: string };

/** Wartość pola polecenia: tylko to, co kopia płytka (`{ ...cmd }`) naprawdę kopiuje. */
type FieldValue = string | number | boolean | undefined;
/** `typ.pole` każdego pola każdego wariantu `Command`, którego wartość nie jest `FieldValue` (tablica, obiekt, `null`); `never`, gdy wszystkie są płaskie. */
type NestedFields<C> = C extends { type: infer T extends string }
  ? { [K in keyof C]-?: [C[K]] extends [FieldValue] ? never : `${T}.${K & string}` }[keyof C]
  : never;
type MustBeNever<Offenders extends never> = Offenders;
/**
 * Kontrola w czasie kompilacji: dodanie do `Command` pola, które nie jest prostą wartością, kończy się błędem `tsc` typu
 * „Type '"pinStaff.order"' does not satisfy the constraint 'never'” (typ i pole w cudzysłowie). Przeczytaj komentarz nad `Command`.
 */
export type FlatCommands = MustBeNever<NestedFields<Command>>;

/** Wszystkie typy poleceń (do testów pokrycia i do walidacji). */
export const COMMAND_TYPES: readonly Command['type'][] = [
  'tapPallet', 'tapTill', 'movePallet', 'returnPallet', 'setOrder', 'hire', 'fire', 'setStaffProfile', 'pinStaff',
  'buyUpgrade', 'buyEquipment', 'startRemont', 'campaign', 'rushRemont', 'answerCard', 'claimMilestone',
];

/** Dokąd gracz może przenieść paletę. Przejścia (`aisle`) to też poprawne miejsce, ale tam stawia tylko kierowca: odmawia `movePallet`. */
const LOCS: readonly PalletLoc[] = ['sidewalk', 'backroom', 'floor', 'aisle'];

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Klucz własny katalogu: `hasOwn`, bo `in` i `[]` przepuszczałyby `toString`, `constructor` i `__proto__`. */
const isKeyOf = (catalog: object, x: unknown): boolean => typeof x === 'string' && Object.hasOwn(catalog, x);

type Fields = Record<string, unknown>;
const noFields = (): boolean => true;
/** Pole opcjonalne typu prawda/fałsz (np. `raty`): brak albo `boolean`. */
const optBool = (x: unknown): boolean => x === undefined || typeof x === 'boolean';

/**
 * Walidatory pól po typie polecenia. `satisfies Record<Command['type'], …>` robi z tej tabeli kontrolę w czasie kompilacji:
 * nowy typ w `Command` bez wpisu tutaj nie przejdzie `tsc` (dawny `switch` z `default: return false` odrzuciłby go po cichu).
 */
const VALID = {
  tapPallet: (c) => c.palletId === undefined || isInt(c.palletId),
  tapTill: noFields,
  movePallet: (c) => isInt(c.palletId) && LOCS.includes(c.loc as PalletLoc),
  returnPallet: (c) => isInt(c.palletId),
  setOrder: (c) => typeof c.auto === 'boolean' && (c.manual === undefined || isFiniteNumber(c.manual)),
  hire: noFields,
  fire: noFields,
  setStaffProfile: (c) => typeof c.profile === 'string' && STAFF_PROFILES.includes(c.profile as StaffProfile),
  // liczba osób całkowita i nieujemna; górną granicę (personel na zmianie) sprawdza `pinStaff`
  pinStaff: (c) => isKeyOf(TASK_LABEL, c.task) && isInt(c.count) && c.count >= 0,
  buyUpgrade: (c) => isKeyOf(UPGRADE_BY_ID, c.id) && optBool(c.raty),
  buyEquipment: (c) => isKeyOf(EQUIPMENT_BY_ID, c.id) && (c.slotId === undefined || typeof c.slotId === 'string') && optBool(c.raty),
  startRemont: (c) => optBool(c.raty),
  campaign: noFields,
  rushRemont: noFields,
  answerCard: (c) => isInt(c.seq) && isInt(c.answer),   // czy numer odpowiedzi mieści się w karcie, rozstrzyga `resolveCard`
  claimMilestone: (c) => typeof c.id === 'string' && MILESTONES.some((m) => m.id === c.id),
} satisfies Record<Command['type'], (c: Fields) => boolean>;

/**
 * Czy `x` ma kształt polecenia: znany `type` (klucz własny tabeli `VALID`, nie `toString` ani `__proto__`) i pola właściwych
 * typów. Dziennik poleceń przychodzi od klienta, więc to jedyna bariera przed `NaN`, tekstem zamiast liczby czy `id` spoza
 * katalogów. Zbędne klucze są dozwolone.
 */
export function isCommand(x: unknown): x is Command {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const c = x as Fields;
  const type = c.type;   // raz: obiekt z getterem nie da innego `type` przy sprawdzeniu i przy wyborze walidatora
  return typeof type === 'string' && Object.hasOwn(VALID, type) && VALID[type as Command['type']](c);
}

/**
 * Wynik polecenia: odpowiedź dla gracza, zdarzenia do pokazania (złota paleta, nowy poziom) i, po remoncie, nowy układ.
 * `layout` i `info` są tylko wtedy, gdy `layoutChanged`: wołający podmienia u siebie układ bez drugiego generowania.
 */
export interface CommandOutcome {
  result: CommandResult;
  events: EconEvent[];
  layoutChanged: boolean;
  layout?: StoreLayout;
  info?: StoreInfo;
}

const refused = (text: string): CommandOutcome => ({ result: { ok: false, text }, events: [], layoutChanged: false });

/** Stuknięcie: mnożnik z serii, jaką da to stuknięcie; do serii liczy się dopiero udane (odmowa rąk jej nie podtrzymuje). */
function tap(s: EconomyState, attempt: (combo: number) => CommandResult): CommandResult {
  const r = attempt(comboMult(nextTapStreak(s)));
  if (r.ok) commitTap(s);
  return r;
}

/** Odmowa dawnego `returnPallet`: od SIM_VERSION 5 każda paleta zostaje w sklepie. */
const RETURN_GONE = 'Centrala nie przyjmuje zwrotów: każda paleta zostaje w sklepie.';

/** Stuknięcia czekają na kartę: ręce franczyzobiorcy zajmuje papier na biurku (gra i tak stoi do odpowiedzi). */
const CARD_FIRST = 'Najpierw karta na biurku.';

function run(s: EconomyState, info: StoreInfo, c: Command, events: EconEvent[]): CommandResult {
  switch (c.type) {
    case 'tapPallet': return awaitingDecision(s) ? { ok: false, text: CARD_FIRST } : tap(s, (combo) => tapPallet(s, info, c.palletId, combo, events));
    case 'tapTill': return awaitingDecision(s) ? { ok: false, text: CARD_FIRST } : tap(s, (combo) => tapTill(s, info, combo));
    case 'movePallet': return movePallet(s, info, c.palletId, c.loc);
    case 'returnPallet': return { ok: false, text: RETURN_GONE };
    case 'setOrder': setOrder(s, c.auto, c.manual); return { ok: true };
    case 'hire': return hire(s);
    case 'fire': return fire(s);
    case 'setStaffProfile': return setStaffProfile(s.tycoon.staff, c.profile);
    case 'pinStaff': return pinStaff(s.tycoon.staff, c.task, c.count, s.staff);
    case 'buyUpgrade': return buyUpgrade(s, c.id, c.raty === true);
    case 'buyEquipment': return buyEquipment(s, info, c.id, c.slotId, c.raty === true);
    case 'startRemont': return startRemont(s, c.raty === true);
    case 'campaign': return campaign(s);
    case 'rushRemont': return rushRemont(s);
    case 'answerCard': return answerCard(s, c.seq, c.answer, events);
    case 'claimMilestone': return claimMilestone(s, c.id);
    default: {
      // wyczerpanie sprawdza kompilator: nowy typ w `Command` bez gałęzi wyżej nie przejdzie `tsc`
      const unreachable: never = c;
      void unreachable;
      return { ok: false, text: 'Nieznane polecenie.' };   // nieosiągalne po `isCommand`, ale wynik ma być zawsze
    }
  }
}

/**
 * Stosuje polecenie gracza do stanu. Odmowa z powodu kształtu albo końca gry nie rusza stanu i nie rzuca. Przyjęte polecenie
 * (także to, które się nie udało) kończy się przeliczeniem poziomów, a gdy zmienił się poziom remontu, nowym układem sklepu
 * i przeniesieniem palet oraz sprzętu. Polecenie jest kopiowane raz na początku i dalej czyta się już tylko kopię: obiekt
 * z getterem (spoza JSON-a) nie da innego `type` przy walidacji i w `run`.
 * Kopia jest płytka, bo pola poleceń są płaskie (komentarz nad `Command`, kontrola `FlatCommands`).
 */
export function applyCommand(state: EconomyState, info: StoreInfo, cmd: Command): CommandOutcome {
  const c = typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) ? { ...cmd } : cmd;
  if (!isCommand(c)) return refused('Nieznane polecenie.');
  if (state.gameOver) return refused('Gra skończona: Centrala wypowiedziała umowę.');

  const events: EconEvent[] = [];
  const remontBefore = state.remontLevel;
  const cashBefore = state.cash;
  const result = run(state, info, c, events);
  processLevels(state, events);   // poziom z nagrody albo stuknięcia od razu, także w pauzie (H1)
  checkDebt(state, cashBefore, events);   // np. mandat z ryzyka karty: za duży debet kończy grę od razu, nie dopiero w następnej minucie
  if (state.remontLevel === remontBefore) return { result, events, layoutChanged: false };

  // remont zmienił wielkość sklepu: układ z seeda i poziomu, a palety i sprzęt na jego miejsca (H2)
  const layout = layoutFor(state.seed, state.remontLevel);
  const next = computeStoreInfo(layout);
  relayout(state, next);
  return { result, events, layoutChanged: true, layout, info: next };
}
