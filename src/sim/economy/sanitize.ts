import { isNum, isRec, num, whole, type Rec } from '@/sim/guards';
import { CATS, MINUTES_PER_DAY, PALLET_ITEMS, STAFF_MAX, type Cat } from './catalog';
import {
  emptyCounters, type Counters, type Delivery, type EconomyState, type EquipmentUnit, type MonthReport, type Pallet, type Priority,
} from './economy';
import { xpToNext } from './progress';
import { QUESTS_ACTIVE, QUEST_KINDS, type Quest, type QuestKind } from './quests';
import { EQUIPMENT_BY_ID, REMONTS, UPGRADE_BY_ID, type EquipmentId, type UpgradeId } from './upgrades';

/**
 * Granice liczb z zapisu. „Skończona” nie znaczy „rozsądna”: zapis zmieniony ręcznie (albo zepsuty) potrafi mieć 1e308
 * tam, gdzie gra liczy sztuki, minuty i poziomy. Wtedy `deliver()` kręci pętlę po 1e308 paletach, `processLevels`
 * odejmuje 120 od 1e308 bez końca, a ułamkowa minuta po cichu wyłącza zamykanie dni (`mod === OPEN_TO`). Każda granica
 * jest wzięta z maksimum samej gry (komentarz przy polu) i ma duży zapas: prawdziwy zapis nigdy jej nie dotyka, więc wraca
 * bez zmian co do bajta, a zapis ze skrajną liczbą wczytuje się i gra normalnie. Test w `game/session.test.ts` pilnuje,
 * żeby granice nie zeszły poniżej tego, co potrafi największy sklep z generatora.
 */
export const LIMITS = {
  /** Minuty gry: 1000 lat. Kalendarz zostaje poprawną datą, a `rand01` (int32) się nie zawija: 5,3e8 < 2^31. */
  minute: 1000 * 366 * MINUTES_PER_DAY,
  /** Złotówki i liczniki: bilion. Sklep zarabia dziesiątki tysięcy dziennie, bilion to tysiące lat ciągłej gry. */
  money: 1e12,
  /** Palet w jednej dostawie: zamówienie ręczne ma najwyżej 30, a limit kredytu po trzecim remoncie (CREDIT_LIMIT × 2,5) mieści 91 palet. */
  orderPallets: 100,
  /** Palet naraz w sklepie: miejsc jest najwyżej 28 (do 17 na chodniku, 3 w sali, 8 na zapleczu). */
  pallets: 64,
  /** Sprzęt w slotach: największy sklep ma 8 slotów o łącznej pojemności 15. */
  equipment: 64,
  /** Dostawy w drodze: zamówienie raz dziennie, najwyżej w dwóch turach, więc w drodze są najwyżej trzy. */
  deliveries: 8,
  /** Historia: jeden wiersz na miesiąc przez tysiąc lat gry. */
  history: 12_000,
  /** Kamienie milowe: w grze jest ich 15. */
  milestones: 200,
  /** Sztuk jednej kategorii na półkach albo zapleczu: największy sklep mieści na półkach 2145 sztuk kategorii, zaplecze 18 810 w sumie. */
  stockPerCat: 100_000,
  /** Sztuk na palecie: PALLET_ITEMS i sztuka zapasu na zaokrąglenia (suma składu palety wychodzi z ułamków). */
  palletItems: PALLET_ITEMS + 1,
  /** Kolejka przy kasie: klienci rezygnują dużo wcześniej (cierpliwość ≤ 10, potem rezygnuje każdy kolejny). */
  queue: 1000,
  /** Poziom gracza: do 1000. poziomu potrzeba ok. 2 mld XP (`xpToNext`), czyli tysięcy lat gry. */
  level: 1000,
  /** Numery palet i zleceń: 2^30; `rand01` liczy je jako int32. */
  id: 2 ** 30,
  /** Punkty Partnera: sklep daje pierwiastek z marży / 20 000 (do ok. 7000 przy bilionie), sklepów w sieci jest do tysiąca. */
  partnerPoints: 1e7,
  /** Sklepy w sieci. */
  network: 1000,
} as const;

/** Najdłuższy remont w grze (dni × minuty): remont nie trwa dłużej, więc `remontUntil` nie wybiega dalej. */
const LONGEST_REMONT = Math.max(...REMONTS.map((r) => r.days)) * MINUTES_PER_DAY;

/**
 * Wczytywanie stanu ekonomii ze źródła, któremu nie ufamy (zapis w przeglądarce): sprawdza kształt i typy, naprawia to,
 * co da się naprawić, i zwraca nowy obiekt. Zasady:
 * - brak pola (zapis ze starszej wersji) daje wartość z `defaults`;
 * - liczba, która nie jest skończona (JSON zapisuje NaN jako null, ktoś wpisał tekst), też daje wartość domyślną,
 *   a brakująca kategoria towaru na półce i zapleczu to 0; wartości skrajne są przycinane do dopuszczalnego zakresu,
 *   a skończone, lecz absurdalne (1e308 palet w dostawie) do `LIMITS`; liczby całkowite z natury (minuty, numery,
 *   poziomy, liczby palet) są zaokrąglane, listy mają górną długość;
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

  const minute = whole(raw.minute, defaults.minute, 0, LIMITS.minute);
  const level = whole(raw.level, defaults.level, 1, LIMITS.level);
  const pallets = uniqueBy((raw.pallets as unknown[] | undefined)?.map((p) => pallet(p, minute)) ?? defaults.pallets, (p) => p.id)
    .slice(0, LIMITS.pallets);
  const quests = uniqueBy((raw.quests as unknown[] | undefined)?.map(quest) ?? defaults.quests, (q) => q.id).slice(0, QUESTS_ACTIVE);
  const partner = raw.partner as Rec | undefined;

  return {
    version: 1,
    seed: defaults.seed,
    seedHash: whole(raw.seedHash, defaults.seedHash, 0, 0xffff_ffff),
    minute,
    cash: money(raw.cash, defaults.cash),
    ogonki: num(raw.ogonki, defaults.ogonki, 0, LIMITS.money),
    ogonkiAcc: num(raw.ogonkiAcc, defaults.ogonkiAcc, 0, 1),
    reputation: num(raw.reputation, defaults.reputation, 0, 100),
    trust: num(raw.trust, defaults.trust, 0, 100),
    shelf: stock(raw.shelf, defaults.shelf, LIMITS.stockPerCat),
    backroom: stock(raw.backroom, defaults.backroom, LIMITS.stockPerCat),
    pallets,
    nextPalletId: Math.max(whole(raw.nextPalletId, defaults.nextPalletId, 1, LIMITS.id + 1), 1 + Math.max(0, ...pallets.map((p) => p.id))),
    order: order(raw.order, defaults.order),
    deliveries: (raw.deliveries as unknown[] | undefined)?.map(delivery).filter(notNull).slice(0, LIMITS.deliveries) ?? defaults.deliveries,
    staff: whole(raw.staff, defaults.staff, 1, STAFF_MAX),
    priority: priority(raw.priority, defaults.priority),
    queue: num(raw.queue, defaults.queue, 0, LIMITS.queue),
    arrivalAcc: num(raw.arrivalAcc, defaults.arrivalAcc, 0, 1),
    upgrades: upgrades(raw.upgrades),
    equipment: (raw.equipment as unknown[] | undefined)?.map(equipmentUnit).filter(notNull).slice(0, LIMITS.equipment) ?? defaults.equipment,
    remontLevel: whole(raw.remontLevel, defaults.remontLevel, 0, REMONTS.length),
    remontUntil: isNum(raw.remontUntil) ? whole(raw.remontUntil, 0, 0, minute + LONGEST_REMONT) : defaults.remontUntil,
    boostUntil: whole(raw.boostUntil, defaults.boostUntil, 0, LIMITS.minute),
    lastFineAt: whole(raw.lastFineAt, defaults.lastFineAt, defaults.lastFineAt, minute),
    today: counters(raw.today),
    month: counters(raw.month),
    total: counters(raw.total),
    history: (raw.history as unknown[] | undefined)?.map(historyRow).filter(notNull).slice(-LIMITS.history) ?? defaults.history,
    lastReport: report(raw.lastReport),
    milestones: (raw.milestones as unknown[] | undefined)?.filter((m): m is string => typeof m === 'string').slice(0, LIMITS.milestones)
      ?? defaults.milestones,
    gameOver: typeof raw.gameOver === 'boolean' ? raw.gameOver : defaults.gameOver,
    lastCashiers: whole(raw.lastCashiers, defaults.lastCashiers, 0, STAFF_MAX),
    lastWorkers: whole(raw.lastWorkers, defaults.lastWorkers, 0, STAFF_MAX),
    level,
    // pasek XP mieści najwyżej kilka poziomów (nagroda ze zlecenia wpada przed `processLevels`); więcej to pętla bez końca
    xp: num(raw.xp, defaults.xp, 0, 3 * xpToNext(level)),
    quests,
    questSeq: Math.max(whole(raw.questSeq, defaults.questSeq, 1, LIMITS.id + 1), 1 + Math.max(0, ...quests.map((q) => q.id))),
    cleanDays: whole(raw.cleanDays, defaults.cleanDays, 0, LIMITS.minute / MINUTES_PER_DAY),
    giftSeq: whole(raw.giftSeq, defaults.giftSeq, 1, LIMITS.id),
    tapBoostUntil: whole(raw.tapBoostUntil, defaults.tapBoostUntil, 0, LIMITS.minute),
    lastDayProfit: money(raw.lastDayProfit, defaults.lastDayProfit),
    bestDayProfit: money(raw.bestDayProfit, defaults.bestDayProfit),
    partner: {
      points: num(partner?.points, defaults.partner.points, 0, LIMITS.partnerPoints),
      networkIncome: num(partner?.networkIncome, defaults.partner.networkIncome, 0, LIMITS.money),
      stores: whole(partner?.stores, defaults.partner.stores, 0, LIMITS.network),
    },
  };
}

// --- Części stanu ----------------------------------------------------------------------------------------------

function notNull<T>(v: T | null): v is T {
  return v !== null;
}

/** Kwota w złotych: skończona, w granicach ±bilion (ujemna to dług, nie błąd). */
const money = (v: unknown, fallback: number): number => num(v, fallback, -LIMITS.money, LIMITS.money);

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

/** Zapas w kategoriach: brakująca albo zła kategoria to 0, ilość mieści się w [0, `max`]. Brak całego obiektu to `fallback`. */
function stock(v: unknown, fallback: Record<Cat, number>, max: number): Record<Cat, number> {
  if (!isRec(v)) return { ...fallback };
  const out = {} as Record<Cat, number>;
  for (const c of CATS) out[c] = num(v[c], 0, 0, max);
  return out;
}

function pallet(v: unknown, minute: number): Pallet | null {
  if (!isRec(v) || !isRec(v.items) || !isNum(v.id) || !isNum(v.spot)) return null;
  if (v.loc !== 'sidewalk' && v.loc !== 'floor' && v.loc !== 'backroom') return null;
  const items = stock(v.items, {} as Record<Cat, number>, LIMITS.palletItems);
  let total = CATS.reduce((n, c) => n + items[c], 0);
  if (total > LIMITS.palletItems) {   // na palecie mieści się jedna paleta: nadmiar skalujemy, skład zostaje
    for (const c of CATS) items[c] *= LIMITS.palletItems / total;
    total = CATS.reduce((n, c) => n + items[c], 0);
  }
  const out: Pallet = {
    id: whole(v.id, 0, 0, LIMITS.id),
    loc: v.loc,
    spot: whole(v.spot, 0, 0, LIMITS.pallets),
    items,
    total,
    initial: Math.max(total, num(v.initial, total, 0, LIMITS.palletItems)),
    since: whole(v.since, minute, 0, minute),
  };
  if (typeof v.golden === 'boolean') out.golden = v.golden;
  return out;
}

function quest(v: unknown): Quest | null {
  if (!isRec(v) || !isNum(v.id) || !isNum(v.target) || v.target <= 0 || !isNum(v.start) || typeof v.title !== 'string') return null;
  if (!QUEST_KINDS.includes(v.kind as QuestKind) || !isRec(v.reward)) return null;
  const { cash, ogonki, xp } = v.reward;
  if (!isNum(cash) || !isNum(ogonki) || !isNum(xp)) return null;
  return {
    id: whole(v.id, 0, 0, LIMITS.id),
    kind: v.kind as QuestKind,
    title: v.title,
    target: Math.min(v.target, LIMITS.money),
    start: money(v.start, 0),
    // XP z nagrody trafia do `processLevels`, więc nie więcej niż daje zlecenie na najwyższym poziomie (newQuest: 40 + 10 · poziom)
    reward: { cash: num(cash, 0, 0, LIMITS.money), ogonki: num(ogonki, 0, 0, LIMITS.money), xp: num(xp, 0, 0, 40 + 10 * LIMITS.level) },
  };
}

function delivery(v: unknown): Delivery | null {
  return isRec(v) && isNum(v.at) && isNum(v.count)
    ? { at: whole(v.at, 0, 0, LIMITS.minute), count: whole(v.count, 0, 0, LIMITS.orderPallets) } : null;
}

function equipmentUnit(v: unknown): EquipmentUnit | null {
  if (!isRec(v) || typeof v.id !== 'string' || !Object.hasOwn(EQUIPMENT_BY_ID, v.id)) return null;
  return { id: v.id as EquipmentId, slot: typeof v.slot === 'string' ? v.slot : null };
}

function historyRow(v: unknown): EconomyState['history'][number] | null {
  return isRec(v) && typeof v.label === 'string' ? { label: v.label, profit: money(v.profit, 0), revenue: money(v.revenue, 0) } : null;
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
  for (const k of Object.keys(out) as (keyof Counters)[]) out[k] = money(v[k], 0);
  return out;
}

function report(v: unknown): MonthReport | null {
  if (!isRec(v) || typeof v.label !== 'string' || typeof v.comment !== 'string' || !isRec(v.counters)) return null;
  return { label: v.label, counters: counters(v.counters), profit: money(v.profit, 0), cash: money(v.cash, 0), comment: v.comment };
}
