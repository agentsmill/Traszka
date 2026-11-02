import { dayOf } from '@/sim/economy/calendar';
import { RESEARCH_IDS } from './research';
import type { FirmState, FirmStepOut } from './types';

/*
 * Cele firmy i próg miliona (spec etapu 4b §5.6, §5.7). Cele firmy dotyczą całej sieci (gotówka osoby, liczba sklepów, badania Sieci), więc leżą
 * w `FirmState.goals`, a nie w `MILESTONES` sklepu: w kamieniach milowych każdy sklep odebrałby je osobno. Tylko w zwykłej grze: bieg rankingowy
 * i sędzia ich nie widzą, bo Ogonki spoza ekonomii rozjechałyby ranking. Spełniony cel trafia do `goals.ready` i daje zdarzenie `goal`; odbiera
 * się go poleceniem `claimGoal` (`commands.ts`). Pierwszy milion na portfelu osoby zapisuje się w `FirmState.fame` raz na zawsze i daje zdarzenie
 * `million`, na którym klient oprze wpis do Galerii sław. Moduł nie importuje `firm.ts` (ten woła stąd sprawdzenia): stan sklepów czyta
 * wprost z `FirmState`, jak `research.ts`.
 */

/** Gotówka osoby, od której firma wchodzi do Galerii sław (§5.7). Test pilnuje zgodności z `FAME_CASH` serwera (`src/server/config.ts`). */
export const FAME_CASH = 1_000_000;

/**
 * Cel firmy: `label` to nazwa w liście Celów, `hint` mówi, co zrobić, `reward` to Ogonki do portfela osoby (bez XP), a `done` mówi, czy firma
 * spełnia warunek teraz. Polski tekst tłumaczy `tr` (`src/i18n/en/ui/firm.ts`).
 */
export interface FirmGoal {
  id: string;
  label: string;
  hint: string;
  reward: number;
  done(f: FirmState): boolean;
}

const openCount = (f: FirmState): number => f.stores.filter((s) => !s.closed).length;
const researchLevels = (f: FirmState): number => RESEARCH_IDS.reduce((n, id) => n + (f.research[id] ?? 0), 0);

/** Dziesięć celów z tabeli §5.6, w jej kolejności (w tej kolejności firma dopisuje je do `ready` i pokazuje w Celach). */
export const FIRM_GOALS: readonly FirmGoal[] = [
  { id: 'cash250k', label: 'Ćwierć bańki na koncie', hint: 'Miej na koncie 250 000 zł', reward: 30, done: (f) => f.person.wallet >= 250_000 },
  { id: 'cash500k', label: 'Pół bańki', hint: 'Miej na koncie 500 000 zł', reward: 50, done: (f) => f.person.wallet >= 500_000 },
  { id: 'cash1m', label: 'Milioner spod znaku Traszki', hint: 'Miej na koncie 1 000 000 zł', reward: 100, done: (f) => f.person.wallet >= FAME_CASH },
  { id: 'cash2m', label: 'Dwa miliony (Centrala pyta, czy nie za dużo)', hint: 'Miej na koncie 2 000 000 zł', reward: 150, done: (f) => f.person.wallet >= 2_000_000 },
  { id: 'stores3', label: 'Trzy placówki', hint: 'Miej jednocześnie trzy otwarte sklepy', reward: 40, done: (f) => openCount(f) >= 3 },
  { id: 'stores4', label: 'Czwarta placówka', hint: 'Miej jednocześnie cztery otwarte sklepy', reward: 60, done: (f) => openCount(f) >= 4 },
  { id: 'stores5', label: 'Sieć pełna: pięć Traszek', hint: 'Miej jednocześnie pięć otwartych sklepów', reward: 100, done: (f) => openCount(f) >= 5 },
  { id: 'research1', label: 'Pierwsze badanie Sieci', hint: 'Kup dowolne badanie Sieci w panelu Miasto', reward: 20, done: (f) => researchLevels(f) >= 1 },
  { id: 'research10', label: 'Dziesięć poziomów badań', hint: 'Kup łącznie dziesięć poziomów badań Sieci', reward: 60, done: (f) => researchLevels(f) >= 10 },
  { id: 'researchAll', label: 'Wszystkie badania Sieci', hint: 'Kup każde badanie Sieci przynajmniej raz', reward: 80, done: (f) => RESEARCH_IDS.every((id) => (f.research[id] ?? 0) >= 1) },
];

export const FIRM_GOAL_BY_ID: Readonly<Record<string, FirmGoal>> = Object.fromEntries(FIRM_GOALS.map((g) => [g.id, g]));

/** Czy `id` to cel firmy. `Object.hasOwn`, bo `in` przepuszczałby `toString` i `__proto__`. */
export const isFirmGoalId = (id: unknown): id is string => typeof id === 'string' && Object.hasOwn(FIRM_GOAL_BY_ID, id);

/** Cele firmy i Galeria liczą się tylko w zwykłej grze, która trwa: bieg rankingowy i firma po końcu gry tu w ogóle nie wchodzą. */
const counts = (f: FirmState): boolean => !f.ranked && f.over === null;

/**
 * Dopisuje do `goals.ready` każdy cel, którego warunek firma właśnie spełnia, a który nie czeka jeszcze na odbiór i nie został odebrany; na każdy
 * jedno zdarzenie `goal` z `id`. Cel zostaje w `ready` (albo `claimed`) na zawsze, więc spadek gotówki niczego nie odbiera i nie dubluje zdarzeń.
 * Kolejność jest z tabeli, więc zapis i odczyt dają ten sam stan.
 */
export function checkFirmGoals(f: FirmState, out: FirmStepOut): void {
  if (!counts(f)) return;
  const { ready, claimed } = f.goals;
  if (ready.length + claimed.length >= FIRM_GOALS.length) return;
  const reached = FIRM_GOALS.filter((g) => !ready.includes(g.id) && !claimed.includes(g.id) && g.done(f));
  if (reached.length === 0) return;
  f.goals = { ready: [...ready, ...reached.map((g) => g.id)], claimed };
  for (const g of reached) out.firm.push({ kind: 'goal', params: { id: g.id } });
}

/** Dzień gry (numer doby od początku) aktywnego sklepu, a gdy ten zamknięto w tej minucie, pierwszego otwartego; wszystkie otwarte stoją w tej samej minucie. */
function gameDay(f: FirmState): number {
  const open = f.stores.filter((s) => !s.closed);
  const st = open.find((s) => s.id === f.activeId) ?? open[0] ?? f.stores[0]!;
  return dayOf(st.econ.minute);
}

/**
 * Próg miliona (§5.7): gdy portfel osoby pierwszy raz osiąga `FAME_CASH`, firma zapamiętuje dzień i gotówkę w `fame` i wysyła zdarzenie
 * `million`. `fame` zostaje (także po wczytaniu zapisu), więc próg nie pada drugi raz, choćby gotówka spadła i wróciła. Zapis, w którym portfel
 * już przekracza milion, a `fame` jest null, dostaje zdarzenie w pierwszej minucie po wczytaniu.
 */
export function checkFame(f: FirmState, out: FirmStepOut): void {
  if (!counts(f) || f.fame !== null) return;
  const cash = f.person.wallet;
  if (!(cash >= FAME_CASH)) return;
  const day = gameDay(f);
  f.fame = { day, cash };
  out.firm.push({ kind: 'million', params: { day, cash } });
}
