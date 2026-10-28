import { spotCells } from '@/sim/economy/storeInfo';
import { cellKey, manhattan, type Cell } from '@/sim/grid';
import type { StoreLayout } from '@/sim/store/types';
import { buildStaffNav, type StaffNav } from './staffNav';
import { pickStaffSpots } from './targets';
import { TaskHold } from './taskHold';
import { STAFF_VIEW_MAX, type PalletRef, type StaffAssignment, type StaffDuty, type StaffSpot } from './types';
import { StaffWalker } from './walker';

// Załoga na ekranie: kto jest w sklepie, gdzie ma stanąć i jak tam dochodzi. Ekonomia mówi tylko, kto jest na zmianie i czego
// chce od niego w tej chwili; tutaj te informacje zamieniają się w ludzi, którzy wchodzą z chodnika, dochodzą na miejsce,
// pracują i wychodzą. Czysta „scenografia” (jak reszta src/render/staff): bez three.js, bez losowości, a nic z widoku nie wraca
// do symulacji.

/** Najdłużej (s czasu widoku) ktoś idzie do wyjścia: potem znika, choćby nie doszedł (np. paleta zamknęła mu drogę). */
const LEAVE_TIMEOUT_S = 20;

export interface CrewInput {
  /** Osoby na zmianie z tym, czego chce ekonomia (adapter albo `staffOnShift`). */
  people: readonly StaffAssignment[];
  /** Minuta gry. */
  minute: number;
  /** Palety (przeszkody i cele rozładunku). */
  pallets: readonly PalletRef[];
}

export interface CrewMember {
  readonly id: number;
  /** Zadanie trzymane (po histerezie), nie chwilowe. */
  readonly task: StaffDuty;
  readonly walker: StaffWalker;
  /** Wychodzi ze sklepu (zwolniony albo koniec zmiany); znika po dojściu na chodnik albo po 20 s czasu widoku. */
  readonly leaving: boolean;
  /**
   * To ciało „kasjera z ekranu startowego” (wygląd gracza). Najwyżej jedna osoba naraz. Kasjer trzyma je do zniknięcia ze
   * sklepu (zwolniony wychodzi z nim), ale gdy ktoś nowy obejmuje ciało kasjera, wychodzący kasjer znika od razu.
   */
  readonly isCashier: boolean;
}

/** Rekord osoby: to, co widzi widok (`CrewMember`), plus czas rozpoczęcia wychodzenia, którego tylko załoga potrzebuje. */
class Person implements CrewMember {
  readonly id: number;
  readonly walker: StaffWalker;
  task: StaffDuty;
  leaving = false;
  isCashier: boolean;
  /** Czas widoku (s), od którego osoba wychodzi (do limitu `LEAVE_TIMEOUT_S`). */
  leaveSince = 0;

  constructor(id: number, task: StaffDuty, walker: StaffWalker, isCashier: boolean) {
    this.id = id;
    this.task = task;
    this.walker = walker;
    this.isCashier = isCashier;
  }
}

/** Gdzie i z jakim zadaniem osoba stanęła przy ostatnim liczeniu miejsc: podstawa dla `previous` w `pickStaffSpots`. */
interface Placed { task: StaffDuty; spot: StaffSpot }

/** Id musi być skończoną liczbą całkowitą ≥ 0, a przy powtórzeniu liczy się pierwsze wystąpienie; wynik rośnie po id i ma najwyżej `STAFF_VIEW_MAX` osób. */
function normalise(people: readonly StaffAssignment[]): StaffAssignment[] {
  const seen = new Set<number>();
  const out: StaffAssignment[] = [];
  for (const { id, task } of people) {
    if (!Number.isInteger(id) || id < 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, task });
  }
  return out.sort((a, b) => a.id - b.id).slice(0, STAFF_VIEW_MAX);
}

/**
 * Punkt na chodniku, którym ludzie wchodzą i wychodzą: ten z `spawnPoints`, który jest najbliżej pierwszej kratki wejścia
 * (manhattan; przy remisie pierwszy). Bez punktów pojawiania się wchodzi się przez samo wejście, a bez wejścia z rogu (0, 0).
 */
function streetPoint(layout: StoreLayout): Cell {
  const door = layout.entrance[0];
  let best: Cell = layout.spawnPoints[0] ?? door ?? { x: 0, y: 0 };
  if (door) {
    for (const p of layout.spawnPoints) if (manhattan(p, door) < manhattan(best, door)) best = p;
  }
  return { x: best.x, y: best.y };
}

export class StaffCrew {
  /** Własna kopia układu: wołający może go dalej używać (a nawet zmieniać) bez wpływu na ludzi na ekranie. */
  private readonly layout: StoreLayout;
  /** Punkt na chodniku (wejście i wyjście ludzi) i kierunek, w którym stoi się tam twarzą do drzwi. */
  private readonly street: Cell;
  private readonly streetHeading: number;
  /** Histereza i zegar należą do załogi razem: zegar nigdy nie startuje od nowa osobno (histereza zakłada, że idzie tylko w górę). */
  private readonly hold = new TaskHold();
  private elapsed = 0;
  private nav: StaffNav;
  /** Klucz zbioru kratek palet, z którego zbudowano `nav` (przebudowa, gdy się zmieni). */
  private palletCells = '';
  /** „Podpis” ostatniego liczenia miejsc: zadania osób nie wychodzących i palety. Bez zmiany podpisu cele zostają. */
  private signature: string | null = null;
  private placed = new Map<number, Placed>();
  private list: Person[] = [];
  /** Czy był już jakiś `sync`: pierwszy stawia ludzi od razu na miejscach, kolejne wpuszczają nowych z chodnika. */
  private synced = false;

  constructor(layout: StoreLayout) {
    this.layout = structuredClone(layout);
    this.street = streetPoint(this.layout);
    const door = this.layout.entrance[0];
    this.streetHeading = door ? Math.atan2(door.y - this.street.y, door.x - this.street.x) : 0;
    this.nav = buildStaffNav(this.layout, []);
  }

  /**
   * Ludzie w kolejności rosnącego id, razem z tymi, którzy jeszcze wychodzą. Nigdy więcej niż `STAFF_VIEW_MAX` (twardy limit:
   * jedna postać to jeden SkinnedMesh): gdy nowi przychodzą, a brakuje miejsca, od razu znika wychodzący od najdawniej.
   * Ta sama tablica, dopóki nikt nie przyjdzie ani nie zniknie.
   */
  get members(): readonly CrewMember[] {
    return this.list;
  }

  /** Czas widoku (s): suma `dt` z `step`. */
  get clock(): number {
    return this.elapsed;
  }

  /** Wywoływane co ~100 ms z ekonomii. */
  sync(input: CrewInput): void {
    const wanted = normalise(input.people);
    this.hold.update(input.minute, this.elapsed, wanted);
    this.followPallets(input.pallets);

    const byId = new Map(this.list.map((p) => [p.id, p]));
    const wantedIds = new Set(wanted.map((a) => a.id));
    for (const p of this.list) if (!p.leaving && !wantedIds.has(p.id)) this.startLeaving(p);

    // Miejsca dostają tylko ci, którzy zostają. Kto już wychodzi, wychodzi do końca, także gdy ekonomia znów go wymienia
    // (wróci jako nowa osoba, gdy zniknie ze sklepu): w połowie drogi do wyjścia nie zawracamy nikogo.
    const active: StaffAssignment[] = [];
    for (const { id, task: desired } of wanted) {
      const person = byId.get(id);
      if (person?.leaving) continue;
      // `hold.get` jest puste tylko wtedy, gdy histereza pominęła to wywołanie (minuta nie jest liczbą): wtedy liczy się chcenie.
      const task = this.hold.get(id) ?? desired;
      if (person) person.task = task;
      active.push({ id, task });
    }

    const pallets = input.pallets;
    const signature = `${active.map((a) => `${a.id}:${a.task}`).join(',')}|${pallets.map((p) => `${p.loc}@${cellKey(p.spot)}`).join(',')}`;
    if (signature !== this.signature) {
      this.retarget(active, byId, pallets);
      this.signature = signature;   // dopiero po udanym liczeniu: wyjątek nie może sprawić, że kolejne sync pominą liczenie
    }
    this.synced = true;
  }

  /** Co klatkę: `dt` to czas gry w sekundach (rzeczywisty dt × prędkość; 0 przy pauzie). */
  step(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.elapsed += dt;
    // Klatka bez wychodzącego, który skończył, niczego nie alokuje: tablicę budujemy od nowa dopiero, gdy ktoś znika.
    let someoneLeft = false;
    for (const p of this.list) {
      p.walker.step(dt, this.nav);
      if (this.hasLeft(p)) someoneLeft = true;
    }
    if (someoneLeft) this.list = this.list.filter((p) => !this.hasLeft(p));
  }

  /** Wychodzący, który doszedł na chodnik albo wychodzi już `LEAVE_TIMEOUT_S` (np. droga zastawiona): znika ze sklepu. */
  private hasLeft(p: Person): boolean {
    return p.leaving && (p.walker.atGoal || this.elapsed - p.leaveSince >= LEAVE_TIMEOUT_S);
  }

  /** Gdy zmienił się zbiór kratek palet: nowa siatka i ponowne planowanie dróg u wszystkich (stare ścieżki mogły przejść przez paletę). */
  private followPallets(pallets: readonly PalletRef[]): void {
    const cells = [...new Set(pallets.map((p) => cellKey(p.spot)))].sort((a, b) => a - b).join(',');
    if (cells === this.palletCells) return;
    this.palletCells = cells;
    this.nav = buildStaffNav(this.layout, pallets.flatMap((p) => spotCells(p.spot)));
    for (const p of this.list) p.walker.repath();
  }

  private startLeaving(p: Person): void {
    p.leaving = true;
    p.leaveSince = this.elapsed;
    p.walker.setGoal(this.street, p.walker.heading, this.nav);
  }

  /**
   * Liczy miejsca dla osób, które zostają, i ustawia im cele. Poprzednie miejsce dostają do `pickStaffSpots` ci, których zadanie
   * trzymane nie zmieniło się od ostatniego liczenia, więc zmiana składu ekipy albo pojawienie się palety nie przegania ludzi
   * bez powodu. Nowych (jeszcze bez ciała) wpuszcza tak, jak opisuje `arrive`.
   */
  private retarget(active: readonly StaffAssignment[], byId: ReadonlyMap<number, Person>, pallets: readonly PalletRef[]): void {
    const previous = new Map<number, StaffSpot>();
    for (const { id, task } of active) {
      const before = this.placed.get(id);
      if (before?.task === task) previous.set(id, before.spot);
    }
    const spots = pickStaffSpots(this.layout, this.nav, pallets, active, previous);

    this.placed = new Map();
    const arrivals: Person[] = [];
    // Ciało kasjera dostaje najmniejsze id spośród nowych (`active` rośnie po id), o ile nikt, kto zostaje, go jeszcze nie ma.
    // Wychodzący kasjer go nie blokuje: noc w grze trwa kilka sekund widoku, a wyjście z zaplecza kilka sekund dłużej, więc
    // rano poprzednia ekipa (z kasjerem) często jeszcze wychodzi i gdyby jej kasjer zajmował ciało, nikt by go nie dostał.
    // Skoro nowy kasjer obejmuje ciało, wychodzący kasjer znika od razu (jedno krótkie „puf” w rzadkim zbiegu okoliczności),
    // żeby ciało miała najwyżej jedna osoba. Zwolniony kasjer, po którego ciało nikt nie przychodzi, wychodzi z nim do końca.
    // Środkowy dzień: nowo zatrudniony nie odbiera ciała kasjerowi, który zostaje, nawet gdy ma mniejsze id.
    let cashierTaken = this.list.some((p) => p.isCashier && !p.leaving);
    for (const { id, task } of active) {
      const spot = spots.get(id)!;   // `pickStaffSpots` daje miejsce każdemu id z ekipy
      this.placed.set(id, { task, spot });
      const person = byId.get(id);
      if (person) {
        person.walker.setGoal(spot.cell, spot.heading, this.nav);
      } else {
        arrivals.push(this.arrive(id, task, spot, !cashierTaken));
        cashierTaken = true;
      }
    }
    if (arrivals.length > 0) {
      const claimed = arrivals.some((a) => a.isCashier);
      const staying = claimed ? this.list.filter((p) => !(p.leaving && p.isCashier)) : this.list;
      this.list = [...staying, ...arrivals].sort((a, b) => a.id - b.id);
      this.makeRoom();
    }
  }

  /**
   * Twardy limit ciał: dopóki jest ich więcej niż `STAFF_VIEW_MAX`, znika od razu wychodzący, który wychodzi najdawniej (remis:
   * o wyższym id). Zostający mieszczą się w limicie (`normalise`), więc ktoś wychodzący zawsze się znajdzie.
   */
  private makeRoom(): void {
    while (this.list.length > STAFF_VIEW_MAX) {
      let drop: Person | undefined;
      for (const p of this.list) {
        if (!p.leaving) continue;
        if (!drop || p.leaveSince < drop.leaveSince || (p.leaveSince === drop.leaveSince && p.id > drop.id)) drop = p;
      }
      if (!drop) return;   // niemożliwe, gdy zostający mieszczą się w limicie; zabezpiecza tylko przed pętlą bez końca
      const gone = drop;
      this.list = this.list.filter((p) => p !== gone);
    }
  }

  /**
   * Nowa osoba. Przy pierwszym `sync` w ogóle (start gry, po przebudowie sklepu) stoi od razu na swoim miejscu: nikt wtedy nie
   * wchodzi z ulicy. Później pojawia się na chodniku, twarzą do drzwi, i idzie na miejsce. `teleport` przed `setGoal`, żeby
   * droga nie była liczona od ulicy tam, gdzie osoba i tak od razu stoi u celu.
   */
  private arrive(id: number, task: StaffDuty, spot: StaffSpot, isCashier: boolean): Person {
    const walker = new StaffWalker(this.street, this.streetHeading);
    if (!this.synced) walker.teleport(spot.cell);
    walker.setGoal(spot.cell, spot.heading, this.nav);
    return new Person(id, task, walker, isCashier);
  }
}
