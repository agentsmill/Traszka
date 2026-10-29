import { MINUTES_PER_SECOND_OPEN } from '@/sim/economy/catalog';
import type { MirrorFeed } from '@/sim/crowd/crowd';

/**
 * Tłum jako lustro ekonomii: liczniki gry (`total.customers`, `total.lost`, `queue`) zamieniają się w zdarzenia postaci-grup, a jedna
 * postać to `N` klientów (od `GROUP_MIN` do `GROUP_MAX`). Czyste funkcje i mały automat bez three, bez losowości i bez zapisu do stanu
 * gry: widok tylko czyta liczniki, a symulacja o tłumie nic nie wie (ranking odtwarza grę z dziennika poleceń, tłum nie liczy się do wyniku).
 *
 * Skala: ok. 1–3 klientów na sekundę czasu symulacji (dzień sklepu to 170 s przy ×1, a czas symulacji to czas rzeczywisty razy
 * prędkość gry), więc przy N od 10 w sali stoi kilka postaci, a nie kilkadziesiąt. Co się dzieje przy większej prędkości, widać po
 * czasie symulacji: ×8 to ten sam film przewinięty 8 razy szybciej, tyle że przyjścia na sekundę rzeczywistą są 8 razy gęstsze.
 */

/** Widełki wielkości grupy (decyzja właściciela: od kilkunastu do kilkudziesięciu, zaczynamy od 10, żeby przy małym ruchu sklep nie świecił pustką). */
export const GROUP_MIN = 10;
export const GROUP_MAX = 40;
/** Ile czasu symulacji (s) grupa zajmuje miejsce w sali: dojście od chodnika, oglądanie (1–3 mebli), kolejka, płacenie i wyjście (zmierzone w tłumie: ok. 40 s). */
export const VISIT_S = 40;
/** Jaką część limitu postaci presetu (`CROWD_MAX`) mogą zająć oglądający; reszta zostaje na kolejkę, płacących i wychodzących. */
export const BROWSER_SHARE = 0.6;
/** Nie więcej nowych postaci na jedno odświeżenie widoku (po przeskoku czasu ekran nie wysypuje całej zaległej doby w drzwiach). */
export const MAX_SPAWN_PER_UPDATE = 3;
/** Najszybciej `N` zmienia się o tyle na sekundę czasu symulacji: płynnie, bez skoków przy zmianie godziny. */
export const GROUP_SLEW_PER_S = 1 / 3;
/**
 * Ile klientów z kolejki w grze przypada na postać w kolejce na ekranie. Kolejka w grze nasyca się przy cierpliwości klientów
 * (ok. 6–8 osób, reszta odchodzi jako utraceni), więc `ceil(kolejka / N)` przy N ≥ 10 dawałoby 0–1 postaci i kolejki nie byłoby widać.
 * Przepływ (przyjścia, płacenie) liczy się grupami po N, a o samej kolejce mówi drobniejsza grupa: 7 w grze to 3 postacie, 15 to 5.
 */
export const QUEUE_GROUP = 3;
/** Przyrost liczników większy niż tyle razy (limit postaci × N) to przeskok czasu (przewinięcie, nagroda za nieobecność), a nie ruch: nie odgrywamy go. */
export const JUMP_FACTOR = 1;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Przyjścia klientów na sekundę czasu symulacji, gdy ekonomia daje `perHour` klientów na godzinę gry. */
export const arrivalsPerSimSecond = (perHour: number): number => (Number.isFinite(perHour) && perHour > 0 ? perHour / 60 * MINUTES_PER_SECOND_OPEN : 0);

/**
 * Do czego dąży wielkość grupy: tyle klientów na postać, żeby oglądający (przyjścia na sekundę × czas pobytu / N postaci) mieścili się w
 * `BROWSER_SHARE` limitu postaci presetu, w widełkach `GROUP_MIN`…`GROUP_MAX`. Większa prędkość gry zwiększa N łagodnie (×8 o 30%):
 * przyjścia na sekundę rzeczywistą są wtedy gęstsze, więc mniej, a większych postaci czyta się lepiej.
 */
export function groupSizeFor(perSimSecond: number, maxCharacters: number, speed = 1): number {
  const budget = Math.max(1, maxCharacters * BROWSER_SHARE);
  const stretch = 1 + 0.1 * Math.log2(Math.max(1, speed));
  const raw = (perSimSecond > 0 ? perSimSecond : 0) * VISIT_S / budget * stretch;
  return clamp(Math.ceil(raw - 1e-9), GROUP_MIN, GROUP_MAX);
}

/** Jeden krok płynnej zmiany N w stronę `target` w `simDt` s czasu symulacji (najwyżej `GROUP_SLEW_PER_S` na sekundę). */
export function smoothGroupSize(current: number, target: number, simDt: number): number {
  const step = GROUP_SLEW_PER_S * (Number.isFinite(simDt) && simDt > 0 ? simDt : 0);
  return current + clamp(target - current, -step, step);
}

/**
 * Ile postaci stoi w kolejce: `ceil(kolejka / grupa)` (kolejka w grze zaokrąglona jak w pasku: poniżej pół klienta nikt nie czeka), nie więcej
 * niż miejsc w kolejce (`checkoutQueue`). Długa kolejka na ekranie znaczy długą kolejkę w grze. Grupą jest `QUEUE_GROUP`, a nie N.
 */
export function queueCharacters(queue: number, groupSize: number, slots: number): number {
  const waiting = Number.isFinite(queue) ? Math.round(queue) : 0;
  if (waiting <= 0 || !(groupSize > 0) || !(slots > 0)) return 0;
  return Math.min(Math.floor(slots), Math.ceil(waiting / groupSize - 1e-9));
}

/** Co widok wie o ekonomii przy jednym odświeżeniu. */
export interface MirrorInput {
  /** Liczniki gry od początku (`total.customers`, `total.lost`) i długość kolejki w grze (`queue`, klientów, ułamek). */
  customers: number;
  lost: number;
  queue: number;
  /** Czy do sklepu wolno teraz wejść klientowi (godziny, remont, karta „zamknij”): `isOpenForCustomers`. */
  open: boolean;
  /** Klientów na godzinę gry z bieżącej godziny (jak w `crowdRateFor`). */
  perHour: number;
  /** Limit postaci presetu grafiki (`CROWD_MAX`) i liczba miejsc w kolejce układu. */
  maxCharacters: number;
  queueSlots: number;
  /** Prędkość gry i czas symulacji (s) od poprzedniego odświeżenia: rzeczywisty czas razy prędkość, 0 przy pauzie. */
  speed: number;
  simDt: number;
  /** Postaci w sklepie wraz z czekającymi na wejście (z `crowdHeadcount`). */
  headcount: number;
}

/**
 * Automat zamieniający przyrosty liczników na zdarzenia postaci. Trzyma tylko resztki (ułamek grupy w drodze), poprzednie wartości
 * liczników i płynne N. Nie zna ani sceny, ani symulacji tłumu: wynik (`MirrorFeed`) oddaje wołający.
 *
 * - **Przyjścia** to prawdziwy napływ do sklepu: obsłużeni + utraceni + przyrost kolejki (bilans: kolejka rośnie o przyjścia minus
 *   obsłużeni minus utraceni). Samo „obsłużeni + utraceni” gubiłoby ludzi, gdy kolejka rośnie, a nikt jeszcze nie został obsłużony.
 *   Co `N` przyjść to jedna nowa postać (waga `N`). Zamknięty sklep nikogo nie wpuszcza.
 * - **Obsłużeni** i **utraceni** idą do tłumu jako kredyt (w klientach): postać płaci, gdy ma za co, a utracony wychodzi ze złością.
 * - **Kolejka** w grze to `queueCharacters(kolejka, QUEUE_GROUP, ...)` postaci przy kasie.
 * - **Przeskok** (przewinięcie, nagroda za nieobecność, wczytanie innej gry): zaległości nie są odgrywane, liczniki biorą się od nowa.
 */
export class CrowdMirror {
  private base: { customers: number; lost: number; queue: number } | null = null;
  private groupSize: number | null = null;
  /** Przyjścia, które jeszcze nie złożyły się na całą grupę (ułamek postaci). */
  private pending = 0;

  /** Zapomina poprzednie liczniki (nowy sklep, nowa sesja): następne odświeżenie niczego nie odgrywa. */
  reset(): void {
    this.base = null;
    this.groupSize = null;
    this.pending = 0;
  }

  /** Aktualna wielkość grupy (klientów na postać, zaokrąglona), do diagnostyki i testów. */
  get weight(): number {
    return Math.round(this.groupSize ?? GROUP_MIN);
  }

  update(i: MirrorInput): MirrorFeed {
    const target = groupSizeFor(arrivalsPerSimSecond(i.perHour), i.maxCharacters, i.speed);
    this.groupSize = this.groupSize === null ? target : smoothGroupSize(this.groupSize, target, i.simDt);
    const weight = this.weight;
    const queueTarget = i.open ? queueCharacters(i.queue, QUEUE_GROUP, i.queueSlots) : 0;
    const idle: MirrorFeed = { spawn: 0, weight, serve: 0, lose: 0, queueTarget };

    const counters = [i.customers, i.lost, i.queue];
    if (!counters.every(Number.isFinite)) {   // śmieci w licznikach: nic nie odgrywamy, a po nich liczymy od nowa
      this.base = null;
      this.pending = 0;
      return { ...idle, queueTarget: 0 };
    }
    const before = this.base;
    this.base = { customers: i.customers, lost: i.lost, queue: i.queue };
    if (before === null || i.customers < before.customers || i.lost < before.lost) {
      this.pending = 0;   // pierwsze odświeżenie, nowy sklep albo cofnięcie liczników: od teraz, bez zaległości
      return idle;
    }
    const served = i.customers - before.customers;
    const lost = i.lost - before.lost;
    const arrivals = Math.max(0, served + lost + (i.queue - before.queue));
    if (!i.open) {
      this.pending = 0;
      return { ...idle, queueTarget: 0 };
    }
    if (arrivals > JUMP_FACTOR * Math.max(1, i.maxCharacters) * weight) {
      this.pending = 0;   // przeskok czasu: nie odgrywamy zaległej doby w drzwiach
      return idle;
    }

    this.pending += arrivals;
    const room = Math.max(0, Math.floor(i.maxCharacters - i.headcount));
    const spawn = Math.min(Math.floor(this.pending / weight), room, MAX_SPAWN_PER_UPDATE);
    this.pending -= spawn * weight;
    this.pending = Math.min(this.pending, 2 * weight);   // gdy ekran jest pełny, zaległość nie rośnie bez końca
    return { spawn, weight, serve: served, lose: lost, queueTarget };
  }
}
