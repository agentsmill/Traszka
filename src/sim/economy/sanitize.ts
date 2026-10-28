import { isNum, isRec, num, whole, type Rec } from '@/sim/guards';
import { CATS, STAFF_MAX, type Cat } from './catalog';
import {
  emptyCounters, type Counters, type Delivery, type EconomyState, type EquipmentUnit, type MonthReport, type Pallet, type Priority,
} from './economy';
import { QUESTS_ACTIVE, QUEST_KINDS, type Quest, type QuestKind } from './quests';
import { EQUIPMENT_BY_ID, REMONTS, UPGRADE_BY_ID, type EquipmentId, type UpgradeId } from './upgrades';

/**
 * Wczytywanie stanu ekonomii ze źródła, któremu nie ufamy (zapis w przeglądarce): sprawdza kształt i typy, naprawia to,
 * co da się naprawić, i zwraca nowy obiekt. Zasady:
 * - brak pola (zapis ze starszej wersji) daje wartość z `defaults`;
 * - liczba, która nie jest skończona (JSON zapisuje NaN jako null, ktoś wpisał tekst), też daje wartość domyślną,
 *   a brakująca kategoria towaru na półce i zapleczu to 0; wartości skrajne są przycinane do dopuszczalnego zakresu;
 * - uszkodzony element listy (paleta bez zawartości, nieznane ulepszenie) wypada, a reszta zostaje;
 * - lista tam, gdzie ma być obiekt (albo odwrotnie), cudzy seed czy nieznana wersja stanu to `null`: tego nie naprawiamy,
 *   bo nie wiadomo, co jeszcze w takim zapisie jest nie tak.
 * Wynik ma dokładnie pola `EconomyState` (test pilnuje, żeby nowe pole nie umknęło tej funkcji).
 */
export function sanitizeEconomy(raw: unknown, defaults: EconomyState): EconomyState | null {
  if (!isRec(raw) || raw.version !== 1 || raw.seed !== defaults.seed) return null;

  const wantsList = ['pallets', 'deliveries', 'equipment', 'history', 'milestones', 'quests'];
  const wantsRecord = ['shelf', 'backroom', 'upgrades', 'order', 'today', 'month', 'total', 'partner'];
  if (wantsList.some((k) => raw[k] !== undefined && !Array.isArray(raw[k]))) return null;
  if (wantsRecord.some((k) => raw[k] !== undefined && !isRec(raw[k]))) return null;

  const minute = num(raw.minute, defaults.minute, 0);
  const pallets = uniqueBy((raw.pallets as unknown[] | undefined)?.map((p) => pallet(p, minute)) ?? defaults.pallets, (p) => p.id);
  const quests = uniqueBy((raw.quests as unknown[] | undefined)?.map(quest) ?? defaults.quests, (q) => q.id).slice(0, QUESTS_ACTIVE);
  const partner = raw.partner as Rec | undefined;

  return {
    version: 1,
    seed: defaults.seed,
    seedHash: isNum(raw.seedHash) ? raw.seedHash : defaults.seedHash,
    minute,
    cash: num(raw.cash, defaults.cash),
    ogonki: num(raw.ogonki, defaults.ogonki, 0),
    ogonkiAcc: num(raw.ogonkiAcc, defaults.ogonkiAcc, 0),
    reputation: num(raw.reputation, defaults.reputation, 0, 100),
    trust: num(raw.trust, defaults.trust, 0, 100),
    shelf: stock(raw.shelf, defaults.shelf),
    backroom: stock(raw.backroom, defaults.backroom),
    pallets,
    nextPalletId: Math.max(whole(raw.nextPalletId, defaults.nextPalletId, 1), 1 + Math.max(0, ...pallets.map((p) => p.id))),
    order: order(raw.order, defaults.order),
    deliveries: (raw.deliveries as unknown[] | undefined)?.map(delivery).filter(notNull) ?? defaults.deliveries,
    staff: whole(raw.staff, defaults.staff, 1, STAFF_MAX),
    priority: priority(raw.priority, defaults.priority),
    queue: num(raw.queue, defaults.queue, 0),
    arrivalAcc: num(raw.arrivalAcc, defaults.arrivalAcc, 0),
    upgrades: upgrades(raw.upgrades),
    equipment: (raw.equipment as unknown[] | undefined)?.map(equipmentUnit).filter(notNull) ?? defaults.equipment,
    remontLevel: whole(raw.remontLevel, defaults.remontLevel, 0, REMONTS.length),
    remontUntil: isNum(raw.remontUntil) ? raw.remontUntil : defaults.remontUntil,
    boostUntil: num(raw.boostUntil, defaults.boostUntil),
    lastFineAt: num(raw.lastFineAt, defaults.lastFineAt),
    today: counters(raw.today),
    month: counters(raw.month),
    total: counters(raw.total),
    history: (raw.history as unknown[] | undefined)?.map(historyRow).filter(notNull) ?? defaults.history,
    lastReport: report(raw.lastReport),
    milestones: (raw.milestones as unknown[] | undefined)?.filter((m): m is string => typeof m === 'string') ?? defaults.milestones,
    gameOver: typeof raw.gameOver === 'boolean' ? raw.gameOver : defaults.gameOver,
    lastCashiers: num(raw.lastCashiers, defaults.lastCashiers, 0),
    lastWorkers: num(raw.lastWorkers, defaults.lastWorkers, 0),
    level: whole(raw.level, defaults.level, 1),
    xp: num(raw.xp, defaults.xp, 0),
    quests,
    questSeq: Math.max(whole(raw.questSeq, defaults.questSeq, 1), 1 + Math.max(0, ...quests.map((q) => q.id))),
    cleanDays: num(raw.cleanDays, defaults.cleanDays, 0),
    giftSeq: whole(raw.giftSeq, defaults.giftSeq, 1),
    tapBoostUntil: num(raw.tapBoostUntil, defaults.tapBoostUntil),
    lastDayProfit: num(raw.lastDayProfit, defaults.lastDayProfit),
    bestDayProfit: num(raw.bestDayProfit, defaults.bestDayProfit),
    partner: {
      points: num(partner?.points, defaults.partner.points, 0),
      networkIncome: num(partner?.networkIncome, defaults.partner.networkIncome, 0),
      stores: num(partner?.stores, defaults.partner.stores, 0),
    },
  };
}

// --- Części stanu ----------------------------------------------------------------------------------------------

function notNull<T>(v: T | null): v is T {
  return v !== null;
}

/** Zostawia pierwszy element z danym kluczem (zdublowany numer palety albo zlecenia to uszkodzenie) i pomija wypadłe (null). */
function uniqueBy<T>(items: (T | null)[], key: (item: T) => number): T[] {
  const seen = new Set<number>();
  return items.filter(notNull).filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Zapas w kategoriach: brakująca albo zła kategoria to 0, ilość nie może być ujemna. Brak całego obiektu to `fallback`. */
function stock(v: unknown, fallback: Record<Cat, number>): Record<Cat, number> {
  if (!isRec(v)) return { ...fallback };
  const out = {} as Record<Cat, number>;
  for (const c of CATS) out[c] = num(v[c], 0, 0);
  return out;
}

function pallet(v: unknown, minute: number): Pallet | null {
  if (!isRec(v) || !isRec(v.items) || !isNum(v.id) || !isNum(v.spot)) return null;
  if (v.loc !== 'sidewalk' && v.loc !== 'floor' && v.loc !== 'backroom') return null;
  const items = stock(v.items, {} as Record<Cat, number>);
  const total = CATS.reduce((n, c) => n + items[c], 0);
  const out: Pallet = {
    id: Math.round(v.id),
    loc: v.loc,
    spot: Math.max(0, Math.round(v.spot)),
    items,
    total,
    initial: Math.max(total, num(v.initial, total)),
    since: num(v.since, minute),
  };
  if (typeof v.golden === 'boolean') out.golden = v.golden;
  return out;
}

function quest(v: unknown): Quest | null {
  if (!isRec(v) || !isNum(v.id) || !isNum(v.target) || v.target <= 0 || !isNum(v.start) || typeof v.title !== 'string') return null;
  if (!QUEST_KINDS.includes(v.kind as QuestKind) || !isRec(v.reward)) return null;
  const { cash, ogonki, xp } = v.reward;
  if (!isNum(cash) || !isNum(ogonki) || !isNum(xp)) return null;
  return { id: v.id, kind: v.kind as QuestKind, title: v.title, target: v.target, start: v.start, reward: { cash, ogonki, xp } };
}

function delivery(v: unknown): Delivery | null {
  return isRec(v) && isNum(v.at) && isNum(v.count) ? { at: v.at, count: Math.max(0, v.count) } : null;
}

function equipmentUnit(v: unknown): EquipmentUnit | null {
  if (!isRec(v) || typeof v.id !== 'string' || !Object.hasOwn(EQUIPMENT_BY_ID, v.id)) return null;
  return { id: v.id as EquipmentId, slot: typeof v.slot === 'string' ? v.slot : null };
}

function historyRow(v: unknown): EconomyState['history'][number] | null {
  return isRec(v) && typeof v.label === 'string' ? { label: v.label, profit: num(v.profit, 0), revenue: num(v.revenue, 0) } : null;
}

/** Poziomy ulepszeń w kolejności zakupu (jak w stanie sprzed zapisu: ten sam zapis JSON), bez nieznanych i zerowych. */
function upgrades(v: unknown): EconomyState['upgrades'] {
  const out: EconomyState['upgrades'] = {};
  if (!isRec(v)) return out;
  for (const id of Object.keys(v)) {
    if (!Object.hasOwn(UPGRADE_BY_ID, id)) continue;
    const level = whole(v[id], 0, 0, UPGRADE_BY_ID[id as UpgradeId].maxLevel);
    if (level > 0) out[id as UpgradeId] = level;
  }
  return out;
}

function order(v: unknown, fallback: EconomyState['order']): EconomyState['order'] {
  if (!isRec(v)) return { ...fallback };
  return { auto: typeof v.auto === 'boolean' ? v.auto : fallback.auto, manual: whole(v.manual, fallback.manual, 0, 30) };
}

function priority(v: unknown, fallback: Priority): Priority {
  return v === 'klienci' || v === 'rowno' || v === 'palety' ? v : fallback;
}

function counters(v: unknown): Counters {
  const out = emptyCounters();
  if (!isRec(v)) return out;
  for (const k of Object.keys(out) as (keyof Counters)[]) out[k] = num(v[k], 0);
  return out;
}

function report(v: unknown): MonthReport | null {
  if (!isRec(v) || typeof v.label !== 'string' || typeof v.comment !== 'string' || !isRec(v.counters)) return null;
  return { label: v.label, counters: counters(v.counters), profit: num(v.profit, 0), cash: num(v.cash, 0), comment: v.comment };
}
