import { layoutFor } from '@/sim/store/layoutFor';
import type { StoreLayout } from '@/sim/store/types';
import {
  buyEquipment, buyUpgrade, campaign, claimGift, claimQuest, commitTap, comboMult, fire, giftOpen, hire, movePallet, nextTapStreak,
  PRIORITY_LABEL, processLevels, relayout, returnPallet, rushRemont, scheduleGift, setOrder, setPriority, startRemont, tapPallet, tapTill,
  type CommandResult, type EconEvent, type EconomyState, type Priority,
} from './economy';
import { computeStoreInfo, type PalletLoc, type StoreInfo } from './storeInfo';
import { EQUIPMENT_BY_ID, UPGRADE_BY_ID, type EquipmentId, type UpgradeId } from './upgrades';

/**
 * Jedyne miejsce zmiany stanu w odpowiedzi na gracza (§14.1, I5): każda akcja to serializowalne `Command`, a
 * `applyCommand` sprawdza je, stosuje, liczy poziomy i po remoncie przebudowuje układ. Czyste, bez zegara: minuta gry
 * jest w stanie, więc przeglądarka i serwer odtwarzający dziennik poleceń dostają ten sam stan co do bajtu.
 */

export type Command =
  | { type: 'tapPallet'; palletId?: number }
  | { type: 'tapTill' }
  | { type: 'claimQuest'; questId: number }
  | { type: 'claimGift' }
  | { type: 'movePallet'; palletId: number; loc: PalletLoc }
  | { type: 'returnPallet'; palletId: number }
  | { type: 'setOrder'; auto: boolean; manual?: number }
  | { type: 'hire' }
  | { type: 'fire' }
  | { type: 'setPriority'; priority: Priority }
  | { type: 'buyUpgrade'; id: UpgradeId }
  | { type: 'buyEquipment'; id: EquipmentId; slotId?: string }
  | { type: 'startRemont' }
  | { type: 'campaign' }
  | { type: 'rushRemont' };

/** Wszystkie typy poleceń (do testów pokrycia i do walidacji). */
export const COMMAND_TYPES: readonly Command['type'][] = [
  'tapPallet', 'tapTill', 'claimQuest', 'claimGift', 'movePallet', 'returnPallet', 'setOrder', 'hire', 'fire', 'setPriority',
  'buyUpgrade', 'buyEquipment', 'startRemont', 'campaign', 'rushRemont',
];

const LOCS: readonly PalletLoc[] = ['sidewalk', 'backroom', 'floor'];

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Klucz własny katalogu: `hasOwn`, bo `in` i `[]` przepuszczałyby `toString`, `constructor` i `__proto__`. */
const isKeyOf = (catalog: object, x: unknown): boolean => typeof x === 'string' && Object.hasOwn(catalog, x);

/**
 * Czy `x` ma kształt polecenia: znany `type` i pola właściwych typów. Dziennik poleceń przychodzi od klienta, więc
 * to jedyna bariera przed `NaN`, tekstem zamiast liczby czy `id` spoza katalogów. Zbędne klucze są dozwolone.
 */
export function isCommand(x: unknown): x is Command {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const c = x as Record<string, unknown>;
  switch (c.type) {
    case 'tapPallet': return c.palletId === undefined || isInt(c.palletId);
    case 'claimQuest': return isInt(c.questId);
    case 'movePallet': return isInt(c.palletId) && LOCS.includes(c.loc as PalletLoc);
    case 'returnPallet': return isInt(c.palletId);
    case 'setOrder': return typeof c.auto === 'boolean' && (c.manual === undefined || isFiniteNumber(c.manual));
    case 'setPriority': return isKeyOf(PRIORITY_LABEL, c.priority);
    case 'buyUpgrade': return isKeyOf(UPGRADE_BY_ID, c.id);
    case 'buyEquipment': return isKeyOf(EQUIPMENT_BY_ID, c.id) && (c.slotId === undefined || typeof c.slotId === 'string');
    case 'tapTill': case 'claimGift': case 'hire': case 'fire': case 'startRemont': case 'campaign': case 'rushRemont': return true;
    default: return false;
  }
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

/** Stuknięcie: mnożnik z serii, jaką da to stuknięcie; do serii liczy się dopiero udane. */
function tap(s: EconomyState, attempt: (combo: number) => CommandResult): CommandResult {
  const r = attempt(comboMult(nextTapStreak(s)));
  if (r.ok) commitTap(s);
  return r;
}

function run(s: EconomyState, info: StoreInfo, cmd: Command, events: EconEvent[]): CommandResult {
  switch (cmd.type) {
    case 'tapPallet': return tap(s, (combo) => tapPallet(s, info, cmd.palletId, combo, events));
    case 'tapTill': return tap(s, (combo) => tapTill(s, info, combo));
    case 'claimQuest': return claimQuest(s, info, cmd.questId);
    case 'claimGift': {
      const r = claimGift(s, info);
      scheduleGift(s);   // jedno okno to jeden odbiór: następne dopiero za kilka godzin gry
      return r;
    }
    case 'movePallet': return movePallet(s, info, cmd.palletId, cmd.loc);
    case 'returnPallet': return returnPallet(s, cmd.palletId);
    case 'setOrder': setOrder(s, cmd.auto, cmd.manual); return { ok: true };
    case 'hire': return hire(s);
    case 'fire': return fire(s);
    case 'setPriority': setPriority(s, cmd.priority); return { ok: true };
    case 'buyUpgrade': return buyUpgrade(s, cmd.id);
    case 'buyEquipment': return buyEquipment(s, info, cmd.id, cmd.slotId);
    case 'startRemont': return startRemont(s);
    case 'campaign': return campaign(s);
    case 'rushRemont': return rushRemont(s);
    default: return { ok: false, text: 'Nieznane polecenie.' };   // nieosiągalne po `isCommand`, ale wynik ma być zawsze
  }
}

/**
 * Stosuje polecenie gracza do stanu. Odmowa z powodu kształtu, końca gry albo zamkniętego okna paczki nie rusza stanu
 * i nie rzuca. Przyjęte polecenie (także to, które się nie udało) kończy się przeliczeniem poziomów, a gdy zmienił się
 * poziom remontu, nowym układem sklepu i przeniesieniem palet oraz sprzętu.
 */
export function applyCommand(state: EconomyState, info: StoreInfo, cmd: Command): CommandOutcome {
  if (!isCommand(cmd)) return refused('Nieznane polecenie.');
  const type = cmd.type;   // raz: `type` z getterem mógłby za drugim razem dać co innego, a przejść `isCommand`
  if (state.gameOver) return refused('Gra skończona: Centrala wypowiedziała umowę.');
  if (type === 'claimGift' && !giftOpen(state)) return refused('Paczki od Centrali już nie ma.');

  const events: EconEvent[] = [];
  const remontBefore = state.remontLevel;
  const result = run(state, info, cmd, events);
  processLevels(state, events);   // poziom z nagrody albo stuknięcia od razu, także w pauzie (H1)
  if (state.remontLevel === remontBefore) return { result, events, layoutChanged: false };

  // remont zmienił wielkość sklepu: układ z seeda i poziomu, a palety i sprzęt na jego miejsca (H2)
  const layout = layoutFor(state.seed, state.remontLevel);
  const next = computeStoreInfo(layout);
  relayout(state, next);
  return { result, events, layoutChanged: true, layout, info: next };
}
