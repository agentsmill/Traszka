import { isRec, num, whole, type Rec } from '@/sim/guards';
import { RESTOCK_RATE, STAFF_MAX, UNLOAD_RATE } from '../catalog';
import type { CommandResult } from '../economy';

/**
 * Praca ludzi (spec §6.5). Czas personelu to wspólna pula osobominut: każda minuta zmiany każdej osoby idzie na jedno
 * z czterech zadań (kasa, rozładunek palet, wykładanie towaru, sprzątanie i śmieci). Gracz ustawia kolejność albo wybiera
 * profil („Kolejka”, „Dostawa”, „Porządek”) i może przypiąć osobę do zadania: przypięta osoba bierze najpierw swoje
 * zadanie, a gdy nie ma w nim pracy, wraca do puli (decyzja użytkownika z 28.10.2026). Zadanie, na które nie starcza
 * ludzi, czeka.
 *
 * Moduł nie zna stanu sklepu: wywołujący liczy zapotrzebowanie zadań w osobominutach na tę minutę (funkcje pomocnicze
 * na dole pliku), a dostaje przydział, który sam zamienia na obsłużonych klientów, sztuki i czystość. Ludzie mogą dzielić
 * minutę między zadania (model zbiorczy, jak kolejka w `economy.ts`).
 */

export type StaffTask = 'kasa' | 'rozladunek' | 'wykladanie' | 'sprzatanie';
export const STAFF_TASKS: readonly StaffTask[] = ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie'];
export const TASK_LABEL: Record<StaffTask, string> = {
  kasa: 'Kasa',
  rozladunek: 'Rozładunek palet',
  wykladanie: 'Wykładanie towaru',
  sprzatanie: 'Sprzątanie i śmieci',
};

export type StaffProfile = 'kolejka' | 'dostawa' | 'porzadek';
export const STAFF_PROFILES: readonly StaffProfile[] = ['kolejka', 'dostawa', 'porzadek'];
export const PROFILE_ORDER: Record<StaffProfile, readonly StaffTask[]> = {
  kolejka: ['kasa', 'wykladanie', 'rozladunek', 'sprzatanie'],
  dostawa: ['rozladunek', 'kasa', 'wykladanie', 'sprzatanie'],
  porzadek: ['sprzatanie', 'kasa', 'wykladanie', 'rozladunek'],
};
export const PROFILE_LABEL: Record<StaffProfile | 'wlasny', string> = {
  kolejka: 'Kolejka', dostawa: 'Dostawa', porzadek: 'Porządek', wlasny: 'Własna kolejność',
};
export const PROFILE_HINT: Record<StaffProfile, string> = {
  kolejka: 'Najpierw kasa, potem półki, palety i miotła. Klient nasz pan, paleta poczeka.',
  dostawa: 'Najpierw palety, potem kasa. Klienci postoją, Straż Miejska nie będzie czekać.',
  porzadek: 'Najpierw sprzątanie i śmieci. Audytor ma białe rękawiczki i dużo czasu.',
};
export const DEFAULT_PROFILE: StaffProfile = 'kolejka';

export type TaskMinutes = Record<StaffTask, number>;
export const zeroTasks = (): TaskMinutes => ({ kasa: 0, rozladunek: 0, wykladanie: 0, sprzatanie: 0 });

/** Osobominuty z dnia albo miesiąca: do interfejsu („kto co robił”) i do wskazówki w raporcie miesięcznym. */
export interface StaffStats {
  /** Praca ludzi i robotów wg zadania. */
  worked: TaskMinutes;
  robot: TaskMinutes;
  /** Zapotrzebowanie, którego nikt nie wziął, w osobominutach (ile rąk by się przydało). */
  waiting: TaskMinutes;
  /** Minuty, w których zadanie miało pracę, a nie dostało nikogo (zadanie czekało). */
  starved: TaskMinutes;
  /** Ludzie bez zadania (także przypięci do zadania, które akurat nie miało pracy). */
  idle: number;
  /** Czas ludzi oddany kartom decyzji. */
  chores: number;
  /** Minuty kasjera, których nie zabrali klienci obsłużeni przez kasy samoobsługowe. */
  scoFreed: number;
}

export const emptyStaffStats = (): StaffStats => ({
  worked: zeroTasks(), robot: zeroTasks(), waiting: zeroTasks(), starved: zeroTasks(), idle: 0, chores: 0, scoFreed: 0,
});

export interface StaffPoolState {
  /** Profil albo 'wlasny', gdy gracz ułożył kolejność sam (`order`). */
  profile: StaffProfile | 'wlasny';
  /** Własna kolejność zadań (permutacja STAFF_TASKS); liczy się tylko przy profilu 'wlasny'. */
  order: StaffTask[];
  /** Ile osób gracz przypiął ręcznie do zadania (całe osoby, razem nie więcej niż personel). Bez pracy wracają do puli. */
  pinned: TaskMinutes;
  /** Osobominuty winne kartom decyzji („czas ludzi”). Odrabia je jedna osoba naraz, zanim reszta weźmie zadania. */
  chores: number;
  day: StaffStats;
  month: StaffStats;
}

export function createStaffPool(): StaffPoolState {
  return {
    profile: DEFAULT_PROFILE,
    order: [...PROFILE_ORDER[DEFAULT_PROFILE]],
    pinned: zeroTasks(),
    chores: 0,
    day: emptyStaffStats(),
    month: emptyStaffStats(),
  };
}

// --- Automatyka ------------------------------------------------------------------------------------

/** Automatyka z warsztatu (liczba sztuk albo poziom ulepszenia). Prasa nie zastępuje ludzi, tylko skraca śmieci (waste.ts). */
export interface RobotFleet { tasmociag: number; wykladacz: number; prasa: number; edward: number }
export const NO_ROBOTS: RobotFleet = { tasmociag: 0, wykladacz: 0, prasa: 0, edward: 0 };

/**
 * Osobominuty na minutę jednej sztuki automatyki: taśmociąg rozładowuje 4 szt./min (człowiek 6), wykładacz wykłada
 * 12 szt./min (człowiek 20), a humanoid eDward bierze każde zadanie i robi za trzech (jak w `economy.ts`).
 */
export const ROBOT_RATE = { tasmociag: 4 / UNLOAD_RATE, wykladacz: 12 / RESTOCK_RATE, edward: 3 } as const;

/** Osób naraz przy pracy z kart decyzji: jedna osoba odchodzi od zadań, reszta pracuje dalej. */
export const CHORE_PEOPLE = 1;

// --- Przydział -------------------------------------------------------------------------------------

export interface StaffInput {
  /** Osoby na zmianie w tej minucie (0 poza godzinami pracy: wtedy pracuje tylko automatyka). */
  staff: number;
  /** Zapotrzebowanie zadań w osobominutach na tę minutę (ile osób zadanie przyjmie). */
  demand: TaskMinutes;
  robots?: RobotFleet;
  /** Minuty kasjera oddane puli przez kasy samoobsługowe (`tillDemand().freed`), tylko do statystyk. */
  scoFreed?: number;
}

export interface StaffAllocation {
  human: TaskMinutes;
  robot: TaskMinutes;
  /** Ludzie i automatyka razem: tyle pracy zadanie dostało w tej minucie. */
  total: TaskMinutes;
  /** Zapotrzebowanie, na które zabrakło rąk (zadanie czeka). */
  waiting: TaskMinutes;
  chores: number;
  idle: number;
}

export const effectiveOrder = (pool: StaffPoolState): readonly StaffTask[] =>
  (pool.profile === 'wlasny' ? pool.order : PROFILE_ORDER[pool.profile]);

/**
 * Przydział jednej minuty. Kolejność: (1) automatyka przy swoim zadaniu, (2) ludzie przypięci ręcznie przy swoim
 * zadaniu (ile tam jest pracy; reszta ich czasu wraca do puli), (3) jedna osoba na pracę z kart (przypięta tylko wtedy,
 * gdy nikt inny nie jest wolny), (4) eDward według kolejności, (5) reszta ludzi według kolejności.
 * Robot idzie przed ludźmi, bo zastępuje ich minuty. Funkcja nie zmienia stanu (zob. `stepStaff`).
 */
export function allocateStaff(pool: StaffPoolState, input: StaffInput): StaffAllocation {
  const need = zeroTasks();
  for (const t of STAFF_TASKS) need[t] = Math.max(0, input.demand[t]);
  const human = zeroTasks();
  const robot = zeroTasks();
  const give = (t: StaffTask, to: TaskMinutes, cap: number): number => {
    const x = Math.max(0, Math.min(cap, need[t]));
    to[t] += x;
    need[t] -= x;
    return x;
  };
  const fleet = input.robots ?? NO_ROBOTS;
  give('rozladunek', robot, fleet.tasmociag * ROBOT_RATE.tasmociag);
  give('wykladanie', robot, fleet.wykladacz * ROBOT_RATE.wykladacz);

  let people = Math.max(0, input.staff);
  // praca z karty bierze najpierw kogoś nieprzypiętego; gdy wszyscy są przypięci, schodzi ktoś z posterunku
  // (inaczej przypięcie wszystkich pozwalałoby nie odrabiać czasu z kart)
  const chores = Math.min(people, CHORE_PEOPLE, Math.max(0, pool.chores));
  const pinnedWanted = STAFF_TASKS.reduce((n, t) => n + pool.pinned[t], 0);
  const fromPinned = Math.max(0, chores - Math.max(0, people - pinnedWanted));
  people -= fromPinned;
  let spare = 0;
  for (const t of STAFF_TASKS) {
    const p = Math.min(pool.pinned[t], people);
    people -= p;
    spare += p - give(t, human, p);
  }
  // przypięci, dla których przy ich zadaniu nie ma pracy, wracają do puli
  people += spare - (chores - fromPinned);

  const order = effectiveOrder(pool);
  let ed = fleet.edward * ROBOT_RATE.edward;
  for (const t of order) ed -= give(t, robot, ed);
  for (const t of order) people -= give(t, human, people);
  const idle = people;

  const total = zeroTasks();
  for (const t of STAFF_TASKS) total[t] = human[t] + robot[t];
  return { human, robot, total, waiting: need, chores, idle };
}

/** Zadanie „czeka”, gdy chciało co najmniej tyle osobominut, a nie dostało nic. */
const STARVED_MIN = 0.05;

function addStats(st: StaffStats, a: StaffAllocation, scoFreed: number): void {
  for (const t of STAFF_TASKS) {
    st.worked[t] += a.total[t];
    st.robot[t] += a.robot[t];
    st.waiting[t] += a.waiting[t];
    if (a.waiting[t] > STARVED_MIN && a.total[t] < 1e-9) st.starved[t]++;
  }
  st.idle += a.idle;
  st.chores += a.chores;
  st.scoFreed += scoFreed;
}

/** Minuta pracy: przydział, odrobiony czas z kart i statystyki dnia i miesiąca. */
export function stepStaff(pool: StaffPoolState, input: StaffInput): StaffAllocation {
  const a = allocateStaff(pool, input);
  pool.chores = Math.max(0, pool.chores - a.chores);
  const freed = Math.max(0, input.scoFreed ?? 0);
  addStats(pool.day, a, freed);
  addStats(pool.month, a, freed);
  return a;
}

/** Koniec dnia: statystyki dnia do interfejsu, licznik od zera. */
export function closeStaffDay(pool: StaffPoolState): StaffStats {
  const out = pool.day;
  pool.day = emptyStaffStats();
  return out;
}

/** Koniec miesiąca: statystyki do raportu miesięcznego. */
export function closeStaffMonth(pool: StaffPoolState): StaffStats {
  const out = pool.month;
  pool.month = emptyStaffStats();
  return out;
}

// --- Polecenia gracza -----------------------------------------------------------------------------

export function setStaffProfile(pool: StaffPoolState, profile: StaffProfile): CommandResult {
  if (!STAFF_PROFILES.includes(profile)) return { ok: false, text: 'Nie ma takiego profilu.' };
  pool.profile = profile;
  pool.order = [...PROFILE_ORDER[profile]];
  return { ok: true, text: `Profil „${PROFILE_LABEL[profile]}”. ${PROFILE_HINT[profile]}` };
}

/** Własna kolejność: permutacja czterech zadań. */
export function setStaffOrder(pool: StaffPoolState, order: readonly string[]): CommandResult {
  const valid = order.length === STAFF_TASKS.length && STAFF_TASKS.every((t) => order.includes(t));
  if (!valid) return { ok: false, text: 'Kolejność musi zawierać każde z czterech zadań dokładnie raz.' };
  pool.profile = 'wlasny';
  pool.order = [...order] as StaffTask[];
  return { ok: true };
}

/** Ręczny przydział: `count` osób na stałe przy zadaniu (0 zdejmuje przydział). */
export function pinStaff(pool: StaffPoolState, task: StaffTask, count: number, staff: number): CommandResult {
  if (!STAFF_TASKS.includes(task)) return { ok: false, text: 'Nie ma takiego zadania.' };
  if (!Number.isFinite(count)) return { ok: false, text: 'Podaj liczbę osób.' };
  const n = Math.max(0, Math.floor(count));
  const others = STAFF_TASKS.reduce((s, t) => s + (t === task ? 0 : pool.pinned[t]), 0);
  if (others + n > staff) return { ok: false, text: `Na zmianie ${plPeople(staff)}: więcej się nie przydzieli.` };
  pool.pinned[task] = n;
  return { ok: true };
}

/** „jest 1 osoba”, „są 3 osoby”, „jest 5 osób”. */
export function plPeople(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n === 1) return 'jest 1 osoba';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `są ${n} osoby`;
  return `jest ${n} osób`;
}

/** Po zwolnieniu osoby: przydziały ręczne nie mogą przekraczać personelu (zdejmujemy od końca listy zadań). */
export function normalizePins(pool: StaffPoolState, staff: number): void {
  let over = STAFF_TASKS.reduce((s, t) => s + pool.pinned[t], 0) - Math.max(0, staff);
  for (let i = STAFF_TASKS.length - 1; i >= 0 && over > 0; i--) {
    const t = STAFF_TASKS[i];
    const cut = Math.min(over, pool.pinned[t]);
    pool.pinned[t] -= cut;
    over -= cut;
  }
}

/** Czas ludzi z karty decyzji (osobominuty). */
export function addChores(pool: StaffPoolState, minutes: number): void {
  if (minutes > 0) pool.chores += minutes;
}

// --- Zapotrzebowanie zadań -------------------------------------------------------------------------

/**
 * Potwierdzenie wieku na kasie samoobsługowej (decyzja użytkownika z 28.10.2026): klient z alkoholem albo innym towarem
 * od 18 lat czeka przy SCO, aż człowiek z kasy potwierdzi wiek. `share` to udział takich klientów SCO, `minutes` to
 * osobominuty na jedno potwierdzenie (podejść, spojrzeć na dowód, zatwierdzić). Liczby to decyzja balansu [C].
 */
export const SCO_AGE = { share: 0.3, minutes: 0.25 } as const;

export interface TillInput {
  queue: number;
  /** Stanowiska kasowe (kasa nie przyjmie więcej kasjerów). */
  tills: number;
  /** Klientów na minutę jednego kasjera (z szkoleniami). */
  tillRate: number;
  sco: number;
  scoRate: number;
  /** Udział klientów, którzy w ogóle podejdą do kasy samoobsługowej. */
  scoAccept: number;
  /** Udział klientów SCO, którym trzeba potwierdzić wiek (domyślnie `SCO_AGE.share`). */
  ageShare?: number;
}

export interface TillSplit {
  /** Klienci SCO obsłużeni w tej minucie bez udziału człowieka. */
  scoServed: number;
  /** Klienci SCO, którzy czekają, aż człowiek potwierdzi wiek. */
  ageChecks: number;
  /** Kolejka, która czeka na kasjera. */
  humanQueue: number;
  /** Osobominuty, które kasa przyjmie w tej minucie: potwierdzenia wieku i stanowiska kasowe. */
  demand: number;
  /** Minuty kasjera, których klienci SCO nie zabrali (po odjęciu potwierdzeń wieku): wracają do puli. */
  freed: number;
}

/**
 * Kasa samoobsługowa odciąża kasę, ale nie zastępuje ludzi: klient obsłużony przez nią nie zabiera minut kasjera, więc
 * zapotrzebowanie kasy liczy się z kolejki do człowieka i z potwierdzeń wieku, a puli wraca tyle minut, ilu klientów SCO
 * przejęła, minus czas potwierdzeń. Potwierdzenie nie zajmuje stanowiska kasowego.
 */
export function tillDemand(t: TillInput): TillSplit {
  const queue = Math.max(0, t.queue);
  const atSco = Math.min(Math.max(0, t.sco) * t.scoRate, queue * t.scoAccept);
  const ageChecks = atSco * Math.min(1, Math.max(0, t.ageShare ?? SCO_AGE.share));
  const humanQueue = Math.max(0, queue - atSco);
  const rate = Math.max(1e-9, t.tillRate);
  const ageMinutes = ageChecks * SCO_AGE.minutes;
  return {
    scoServed: atSco - ageChecks,
    ageChecks,
    humanQueue,
    demand: ageMinutes + Math.min(Math.max(0, t.tills), humanQueue / rate),
    freed: Math.max(0, atSco / rate - ageMinutes),
  };
}

export interface TillServed {
  /** Klienci SCO: bez potwierdzenia i z potwierdzonym wiekiem. */
  sco: number;
  /** Klienci obsłużeni przy kasie przez kasjera. */
  human: number;
  total: number;
}

/**
 * Obsługa, gdy kasa dostała `minutes` osobominut: najpierw potwierdzenia wieku (krótkie, a SCO stoi), resztą czasu
 * kasjer obsługuje kolejkę. Klient SCO bez potwierdzenia zostaje w kolejce.
 */
export function serveTill(split: TillSplit, minutes: number, tillRate: number): TillServed {
  const m = Math.max(0, minutes);
  const approved = Math.min(split.ageChecks, m / SCO_AGE.minutes);
  const human = Math.min(split.humanQueue, (m - approved * SCO_AGE.minutes) * tillRate);
  const sco = split.scoServed + approved;
  return { sco, human, total: sco + human };
}

/** Przy jednej palecie mieszczą się najwyżej dwie osoby. */
export const PEOPLE_PER_PALLET = 2;
/** Przy wykładaniu najwyżej dwie osoby naraz (wąskie alejki). */
export const PEOPLE_RESTOCK = 2;

/** Rozładunek: każda paleta przyjmie tyle osobominut, ile zostało na niej pracy, ale najwyżej dwie osoby. */
export function unloadDemand(pallets: readonly { items: number; rate: number }[]): number {
  return pallets.reduce((n, p) => n + Math.min(PEOPLE_PER_PALLET, Math.max(0, p.items) / Math.max(1e-9, p.rate)), 0);
}

/** Wykładanie: braki na półkach, które da się uzupełnić z zaplecza. */
export const restockDemand = (items: number, rate: number): number =>
  Math.min(PEOPLE_RESTOCK, Math.max(0, items) / Math.max(1e-9, rate));

// --- Zapis -----------------------------------------------------------------------------------------

function tasks(v: unknown, fallback: TaskMinutes, max: number, round = false): TaskMinutes {
  const r = isRec(v) ? v : {};
  const out = zeroTasks();
  for (const t of STAFF_TASKS) out[t] = round ? whole(r[t], fallback[t], 0, max) : num(r[t], fallback[t], 0, max);
  return out;
}

const STAT_MAX = 1e12;

function stats(v: unknown): StaffStats {
  const r: Rec = isRec(v) ? v : {};
  const z = zeroTasks();
  return {
    worked: tasks(r.worked, z, STAT_MAX),
    robot: tasks(r.robot, z, STAT_MAX),
    waiting: tasks(r.waiting, z, STAT_MAX),
    starved: tasks(r.starved, z, STAT_MAX),
    idle: num(r.idle, 0, 0, STAT_MAX),
    chores: num(r.chores, 0, 0, STAT_MAX),
    scoFreed: num(r.scoFreed, 0, 0, STAT_MAX),
  };
}

/** Wczytanie z zapisu: zły profil albo kolejność wracają do domyślnych, przydziały ręczne mieszczą się w personelu. */
export function sanitizeStaffPool(raw: unknown, staff: number): StaffPoolState {
  const d = createStaffPool();
  if (!isRec(raw)) return d;
  const profile = raw.profile === 'wlasny' || STAFF_PROFILES.includes(raw.profile as StaffProfile)
    ? raw.profile as StaffPoolState['profile'] : d.profile;
  const order = Array.isArray(raw.order) && raw.order.length === STAFF_TASKS.length
    && STAFF_TASKS.every((t) => (raw.order as unknown[]).includes(t)) ? [...raw.order] as StaffTask[] : d.order;
  const pool: StaffPoolState = {
    profile: profile === 'wlasny' && order === d.order ? d.profile : profile,
    order,
    pinned: tasks(raw.pinned, d.pinned, STAFF_MAX, true),
    chores: num(raw.chores, 0, 0, 100_000),
    day: stats(raw.day),
    month: stats(raw.month),
  };
  normalizePins(pool, staff);
  return pool;
}
