import { isNum, isRec, num, whole, type Rec } from '@/sim/guards';
import { CATS, MINUTES_PER_DAY, PALLET_ITEMS, STAFF_MAX, type Cat } from './catalog';
import { dayOf } from './calendar';
import {
  emptyCounters, kpiMetrics, kpiScaleOf, type Counters, type Delivery, type EconomyState, type EquipmentUnit,
  type MonthReport, type Pallet,
} from './economy';
import { xpToNext } from './progress';
import { sanitizeFranchisee, sanitizeStatement } from './franchisee';
import { sanitizeHall } from './tycoon/cleanliness';
import { sanitizeReport } from './tycoon/report';
import { sanitizeShift } from './tycoon/shift';
import { PROFILE_ORDER, type StaffProfile } from './tycoon/staff';
import { sanitizeTycoon } from './tycoon/state';
import type { StoreInfo } from './storeInfo';
import { EQUIPMENT_BY_ID, REMONTS, UPGRADE_BY_ID, type EquipmentId, type UpgradeId } from './upgrades';

/**
 * Granice liczb z zapisu. „Skończona” nie znaczy „rozsądna”: zapis zmieniony ręcznie (albo zepsuty) potrafi mieć 1e308
 * tam, gdzie gra liczy sztuki, minuty i poziomy. Wtedy `deliver()` kręci pętlę po 1e308 paletach, `processLevels`
 * odejmuje 120 od 1e308 bez końca, a ułamkowa minuta po cichu wyłącza zamykanie dni (`mod === OPEN_TO`). Granice sztuk,
 * minut, numerów i poziomów są wzięte z maksimum samej gry (komentarz przy polu) i mają duży zapas: prawdziwy zapis nigdy
 * ich nie dotyka, więc wraca bez zmian co do bajta, a zapis ze skrajną liczbą wczytuje się i gra normalnie. Pieniądze to
 * wyjątek: gra nie ma dla nich górnej granicy (pętla prestiżu nie kończy się), więc `money` jest tylko strażą przed
 * przepełnieniem. Test w `game/session.test.ts` pilnuje, żeby granice nie zeszły poniżej tego, co potrafi największy sklep
 * z generatora i długa gra.
 */
export const LIMITS = {
  /** Minuty gry: 1000 lat. Kalendarz zostaje poprawną datą, a `rand01` (int32) się nie zawija: 5,3e8 < 2^31. */
  minute: 1000 * 366 * MINUTES_PER_DAY,
  /**
   * Złotówki i liczniki: straż przed przepełnieniem, nie granica rozgrywki (resztę robi `Number.isFinite`). Dochód z sieci
   * rośnie o ok. 10% na każdy kolejny sklep: zmierzone 1,1e12 zł w kasie po 97 sklepach sieci (aktywny gracz, 8–12 godzin przy
   * ×8), a tysiąc sklepów to ok. 3e49. 1e60 leży ponad tym z zapasem i daleko od 1e308, więc sumy i mnożenia przez stawki
   * zostają skończone.
   */
  money: 1e60,
  /** Palet w jednej dostawie: zamówienie ręczne ma najwyżej 30, a limit kredytu po trzecim remoncie (CREDIT_LIMIT × 2,5) mieści 91 palet. */
  orderPallets: 100,
  /**
   * Palet naraz w sklepie: zwykłych miejsc jest najwyżej 28 (do 17 na chodniku, 3 w sali, 8 na zapleczu), a nadmiar stoi w
   * przejściach bez granicy miejsc. Liczbę palet ogranicza kredyt kupiecki (po trzecim remoncie ok. 60 palet towaru razem z półkami).
   */
  pallets: 256,
  /** Sprzęt w slotach: największy sklep ma 8 slotów o łącznej pojemności 15. */
  equipment: 64,
  /** Dostawy w drodze: zamówienie raz dziennie, najwyżej w dwóch turach, więc w drodze są najwyżej trzy. */
  deliveries: 8,
  /** Historia: jeden wiersz na miesiąc przez tysiąc lat gry. */
  history: 12_000,
  /** Kamienie milowe: w grze jest ich 15. */
  milestones: 200,
  /**
   * Sztuk jednej kategorii na półkach albo zapleczu: największa półka z generatora mieści 2451 sztuk kategorii (zmierzone na
   * wszystkich 45 000 seedach, które losuje gra, na czterech poziomach remontu), zaplecze 18 810 w sumie.
   */
  stockPerCat: 100_000,
  /** Sztuk na palecie: PALLET_ITEMS i sztuka zapasu na zaokrąglenia (suma składu palety wychodzi z ułamków). */
  palletItems: PALLET_ITEMS + 1,
  /** Worków z jednej palety: gra liczy 1,5 albo 3 (`palletBags`; zapisy sprzed SIM_VERSION 5 mają 1 albo 2), reszta to zapas. */
  palletBags: 8,
  /**
   * Kolejka przy kasie: ruch rośnie z Punktami Partnera, więc w 4000 dniach gry kolejka sięgała 538 osób przy 5,3 tys. punktów
   * i 2799 przy 40 tys. Granica przycina tylko chwilowe zaległości (kolejka zeruje się co wieczór po zamknięciu sklepu).
   */
  queue: 1000,
  /** Poziom gracza: do 1000. poziomu potrzeba ok. 2 mld XP (`xpToNext`), czyli tysięcy lat gry. */
  level: 1000,
  /** Numery palet (i serii stuknięć): 2^30 (1 073 741 824); `rand01` liczy je jako int32. */
  id: 1_073_741_824,
  /**
   * Punkty Partnera: sklep daje pierwiastek z marży / 20 000, a marża jednego sklepu jest mała (zmierzone 5094 punkty po 97
   * sklepach sieci); 1e7 mieści tysiąc sklepów po ok. 10 tys. punktów.
   */
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
 *   bo nie wiadomo, co jeszcze w takim zapisie jest nie tak;
 * - zapis sprzed tycoona nie ma pola `tycoon`: dostaje świeży stan, a zaufanie Centrali bierze ze starego pola `trust`
 *   (`null`, tekst albo brak to 60, liczba spoza 0–100 jest przycinana). Tydzień KPI liczy się wtedy od dnia i liczników
 *   wczytanego zapisu, w skali sklepu (`info`). Uszkodzony `tycoon` naprawia się sam, kawałek po kawałku, i nie kasuje zapisu.
 * - zlecenia Centrali zniknęły (zastąpiło je KPI tygodnia w `tycoon.kpi`): `quests`, `questSeq` i `cleanDays` z dawnego zapisu przepadają,
 *   także uszkodzone. Ostatni raport miesiąca bez szczegółów tycoona (`detail`) wczytuje się z `detail: null`.
 * - ten sam zapis ma jeszcze dawny `priority` (kasa/po równo/palety): zamienia się na profil puli ludzi (`klienci` i `rowno`
 *   na `kolejka`, `palety` na `dostawa`). Zapis z `tycoon` zostaje przy profilu z własnej puli.
 * Wynik ma dokładnie pola `EconomyState` (test pilnuje, żeby nowe pole nie umknęło tej funkcji).
 */
export function sanitizeEconomy(raw: unknown, defaults: EconomyState, info: StoreInfo): EconomyState | null {
  if (!isRec(raw) || raw.version !== 1 || raw.seed !== defaults.seed) return null;

  const wantsList = ['pallets', 'deliveries', 'equipment', 'history', 'milestones', 'milestonesReady'];
  const wantsRecord = ['shelf', 'backroom', 'upgrades', 'order', 'today', 'month', 'total', 'partner'];
  if (wantsList.some((k) => raw[k] !== undefined && !Array.isArray(raw[k]))) return null;
  if (wantsRecord.some((k) => raw[k] !== undefined && !isRec(raw[k]))) return null;

  const minute = whole(raw.minute, defaults.minute, 0, LIMITS.minute);
  const level = whole(raw.level, defaults.level, 1, LIMITS.level);
  const pallets = uniqueBy((raw.pallets as unknown[] | undefined)?.map((p) => pallet(p, minute)) ?? defaults.pallets, (p) => p.id)
    .slice(0, LIMITS.pallets);
  const partner = raw.partner as Rec | undefined;
  const seedHash = whole(raw.seedHash, defaults.seedHash, 0, 0xffff_ffff);
  const staff = whole(raw.staff, defaults.staff, 1, STAFF_MAX);
  const total = counters(raw.total);
  const milestones = (raw.milestones as unknown[] | undefined)?.filter((m): m is string => typeof m === 'string').slice(0, LIMITS.milestones)
    ?? defaults.milestones;

  const wynik: EconomyState = {
    version: 1,
    seed: defaults.seed,
    seedHash,
    minute,
    cash: money(raw.cash, defaults.cash),
    ogonki: num(raw.ogonki, defaults.ogonki, 0, LIMITS.money),
    ogonkiAcc: num(raw.ogonkiAcc, defaults.ogonkiAcc, 0, 1),
    reputation: num(raw.reputation, defaults.reputation, 0, 100),
    shelf: stock(raw.shelf, defaults.shelf, LIMITS.stockPerCat),
    backroom: stock(raw.backroom, defaults.backroom, LIMITS.stockPerCat),
    pallets,
    nextPalletId: Math.max(whole(raw.nextPalletId, defaults.nextPalletId, 1, LIMITS.id + 1), 1 + Math.max(0, ...pallets.map((p) => p.id))),
    order: order(raw.order, defaults.order),
    deliveries: (raw.deliveries as unknown[] | undefined)?.map(delivery).filter(notNull).slice(0, LIMITS.deliveries) ?? defaults.deliveries,
    staff,
    queue: num(raw.queue, defaults.queue, 0, LIMITS.queue),
    arrivalAcc: num(raw.arrivalAcc, defaults.arrivalAcc, 0, 1),
    upgrades: upgrades(raw.upgrades),
    equipment: (raw.equipment as unknown[] | undefined)?.map(equipmentUnit).filter(notNull).slice(0, LIMITS.equipment) ?? defaults.equipment,
    remontLevel: whole(raw.remontLevel, defaults.remontLevel, 0, REMONTS.length),
    remontUntil: isNum(raw.remontUntil) ? whole(raw.remontUntil, 0, 0, minute + LONGEST_REMONT) : defaults.remontUntil,
    boostUntil: whole(raw.boostUntil, defaults.boostUntil, 0, LIMITS.minute),
    lastFineAt: whole(raw.lastFineAt, defaults.lastFineAt, defaults.lastFineAt, minute),
    lastWarnAt: whole(raw.lastWarnAt, defaults.lastWarnAt, defaults.lastWarnAt, minute),
    today: counters(raw.today),
    month: counters(raw.month),
    total,
    history: (raw.history as unknown[] | undefined)?.map(historyRow).filter(notNull).slice(-LIMITS.history) ?? defaults.history,
    lastReport: report(raw.lastReport),
    milestones,
    // zapis sprzed SIM_VERSION 5 nie ma pola: wszystkie jego cele są już odebrane, a nowe spełnione złapie najbliższa pełna godzina
    milestonesReady: [...new Set(
      (raw.milestonesReady as unknown[] | undefined)?.filter((m): m is string => typeof m === 'string' && !milestones.includes(m)) ?? defaults.milestonesReady,
    )].slice(0, LIMITS.milestones),
    gameOver: typeof raw.gameOver === 'boolean' ? raw.gameOver : defaults.gameOver,
    // osobominuty z ostatniego przydziału (ułamki), nie liczba osób: `whole` zaokrągliłoby je i zapis nie wracałby co do bajta
    lastCashiers: num(raw.lastCashiers, defaults.lastCashiers, 0, STAFF_MAX),
    lastWorkers: num(raw.lastWorkers, defaults.lastWorkers, 0, STAFF_MAX),
    shift: sanitizeShift(raw.shift),
    level,
    // pasek XP mieści najwyżej kilka poziomów (nagroda, np. za KPI, wpada przed `processLevels`); więcej to pętla bez końca
    xp: num(raw.xp, defaults.xp, 0, 3 * xpToNext(level)),
    // zapis sprzed L1 nie ma combo: brak serii, ostatnie stuknięcie dawno temu (jak lastFineAt)
    tapStreak: whole(raw.tapStreak, defaults.tapStreak, 0, LIMITS.id),
    lastTapAt: whole(raw.lastTapAt, defaults.lastTapAt, defaults.lastTapAt, minute),
    lastDayProfit: money(raw.lastDayProfit, defaults.lastDayProfit),
    bestDayProfit: money(raw.bestDayProfit, defaults.bestDayProfit),
    partner: {
      points: num(partner?.points, defaults.partner.points, 0, LIMITS.partnerPoints),
      networkIncome: num(partner?.networkIncome, defaults.partner.networkIncome, 0, LIMITS.money),
      stores: whole(partner?.stores, defaults.partner.stores, 0, LIMITS.network),
    },
    tycoon: defaults.tycoon,   // zaślepka: skala KPI poniżej liczy się z reszty wczytanego stanu
    franchisee: defaults.franchisee,   // zaślepka: blok franczyzobiorcy poniżej liczy się z wczytanej minuty i obrotu miesiąca
  };
  // zapis sprzed SIM_VERSION 6 nie ma bloku: saldo i naliczenia od zera, okres remanentu od obrotu bieżącego miesiąca (franchisee.ts)
  wynik.franchisee = sanitizeFranchisee(raw.franchisee, minute, wynik.month.revenue);
  // liczniki i sala są już po sanitize, a `trust` to surowe stare pole (sanitizeTrust je sprawdza)
  const rawTycoon = isRec(raw.tycoon) ? raw.tycoon : null;
  wynik.tycoon = sanitizeTycoon(raw.tycoon, {
    day: dayOf(minute), seedHash, trust: raw.trust as number, staff,
    metrics: kpiMetrics(total, sanitizeHall(rawTycoon?.hall)), scale: kpiScaleOf(wynik, info),
  });
  // zapis sprzed puli ludzi ma tylko stary priorytet pracy: profil z mapy; zapis z `tycoon` zostaje przy własnym profilu
  if (!rawTycoon) setLegacyProfile(wynik.tycoon.staff, raw.priority);
  return wynik;
}

// --- Części stanu ----------------------------------------------------------------------------------------------

function notNull<T>(v: T | null): v is T {
  return v !== null;
}

/** Kwota w złotych: skończona, w granicach ±`LIMITS.money` (ujemna to dług, nie błąd). */
const money = (v: unknown, fallback: number): number => num(v, fallback, -LIMITS.money, LIMITS.money);

/** Zostawia pierwszy element z danym kluczem (zdublowany numer palety to uszkodzenie) i pomija wypadłe (null). */
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
  if (v.loc !== 'sidewalk' && v.loc !== 'floor' && v.loc !== 'backroom' && v.loc !== 'aisle') return null;
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
  // paleta z zapisu sprzed worków nie ma pola: rozładunek bierze wtedy jeden worek, a zapis wraca co do bajta
  if (isNum(v.bags)) out.bags = num(v.bags, 1, 1, LIMITS.palletBags);
  return out;
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
  if (!isRec(v) || typeof v.label !== 'string') return null;
  const row: EconomyState['history'][number] = { label: v.label, profit: money(v.profit, 0), revenue: money(v.revenue, 0) };
  if (isNum(v.transfer)) row.transfer = money(v.transfer, 0);   // przelew od Centrali: od SIM_VERSION 6
  return row;
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

/** Dawny priorytet pracy (zniknął z `EconomyState`) i profil puli ludzi, który go zastępuje. */
const PRIORITY_PROFILE: Record<string, StaffProfile> = { klienci: 'kolejka', rowno: 'kolejka', palety: 'dostawa' };

/** Stary priorytet na profil; nieznany albo brak zostawia profil domyślny świeżej puli. `hasOwn`, bo `__proto__` nie jest priorytetem. */
function setLegacyProfile(pool: EconomyState['tycoon']['staff'], priority: unknown): void {
  if (typeof priority !== 'string' || !Object.hasOwn(PRIORITY_PROFILE, priority)) return;
  const profile = PRIORITY_PROFILE[priority]!;
  pool.profile = profile;
  pool.order = [...PROFILE_ORDER[profile]];
}

function counters(v: unknown): Counters {
  const out = emptyCounters();
  if (!isRec(v)) return out;
  for (const k of Object.keys(out) as (keyof Counters)[]) out[k] = money(v[k], 0);
  return out;
}

/** Ostatni raport miesiąca. Raport ze starego zapisu nie ma szczegółów tycoona (`detail`): wczytuje się jako `null`, reszta zostaje. */
function report(v: unknown): MonthReport | null {
  if (!isRec(v) || typeof v.label !== 'string' || typeof v.comment !== 'string' || !isRec(v.counters)) return null;
  return {
    label: v.label, counters: counters(v.counters), profit: money(v.profit, 0), cash: money(v.cash, 0), comment: v.comment,
    detail: sanitizeReport(v.detail), statement: sanitizeStatement(v.statement),
  };
}
