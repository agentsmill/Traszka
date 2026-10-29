import type { Cell } from '@/sim/grid';
import { findPath } from '@/sim/nav/astar';
import type { StaffNav } from './staffNav';

// Marsz pracownika po siatce `StaffNav` (te same drogi A* co u klientów, ale z zapleczem i pasem za kasą). Czysta
// „scenografia”: ekonomia i `pickStaffSpots` mówią, dokąd ma stanąć, a tu postać tylko tam idzie i patrzy w dobrą stronę.
// Ruch jest liniowy po środkach kratek ścieżki, jak u `Agent` w crowd.ts; czasem jest czas widoku (s) przekazywany do `step`.
// Żadnej losowości, żadnych zależności od three.js, argumentów (poza własnym stanem) nie zmieniamy.

/** Tempo marszu pracownika, kratek na sekundę czasu widoku (klienci: 2,2–3,0). */
export const STAFF_WALK_SPEED = 2.6;
/** Co ile sekund czasu widoku walker ponawia planowanie, gdy do celu nie ma drogi (np. paleta zastawiła przejście). */
export const NO_PATH_RETRY_S = 1;

const isCell = (c: Cell): boolean => Number.isInteger(c.x) && Number.isInteger(c.y);

export class StaffWalker {
  /** Środek postaci w kratkach (kratka + 0.5, jak `Agent`). */
  x: number;
  y: number;
  /** Dokąd patrzy: w czasie marszu kierunek ruchu, po dojściu kierunek zadania. */
  heading: number;
  moving = false;

  private readonly speed: number;
  private goalCell: Cell | null = null;
  /** Kierunek patrzenia po dojściu do `goalCell`. */
  private facing = 0;
  /** Ścieżka z A* (start, …, cel) albo null, gdy postać stoi (doszła, nie ma celu albo nie ma drogi). */
  private path: Cell[] | null = null;
  /** Indeks kratki ścieżki, do której środka postać idzie teraz. */
  private next = 0;
  /** Cel jest wyznaczony, ale ostatnie planowanie nie znalazło drogi: czekamy na kolejną próbę. */
  private noRoute = false;
  private retryIn = 0;
  /** `repath()` albo `teleport()` kazały zaplanować drogę od nowa przy najbliższym `step` (tam jest siatka). */
  private stale = false;

  constructor(start: Cell, heading: number, speed: number = STAFF_WALK_SPEED) {
    this.x = start.x + 0.5;
    this.y = start.y + 0.5;
    this.heading = Number.isFinite(heading) ? heading : 0;
    this.speed = Number.isFinite(speed) && speed > 0 ? speed : STAFF_WALK_SPEED;
  }

  /** Cel marszu (kopia: zmiana zwróconego obiektu nie przestawia postaci). */
  get goal(): Cell | null {
    return this.goalCell ? { x: this.goalCell.x, y: this.goalCell.y } : null;
  }

  /** Czy stoi na celu (i nie idzie). */
  get atGoal(): boolean {
    const g = this.goalCell;
    return g !== null && !this.moving && this.x === g.x + 0.5 && this.y === g.y + 0.5;
  }

  /** Cel i kierunek patrzenia po dojściu. Ten sam cel co dotąd nie planuje ścieżki od nowa (zmienia najwyżej kierunek). */
  setGoal(goal: Cell, facing: number, nav: StaffNav): void {
    if (!isCell(goal)) return;
    if (Number.isFinite(facing)) this.facing = facing;
    const g = this.goalCell;
    if (g !== null && g.x === goal.x && g.y === goal.y) {
      // Wołający podaje cel co klatkę, więc ten sam cel to normalny przypadek. W marszu kierunek patrzenia nadal wyznacza
      // ruch, a nowy `facing` zadziała po dojściu; na miejscu obracamy się od razu.
      if (this.atGoal) this.heading = this.facing;
      return;
    }
    this.goalCell = { x: goal.x, y: goal.y };
    this.plan(nav);
  }

  /**
   * Przenosi na środek kratki (pojawienie się od razu na miejscu) i zeruje marsz. Cel zostaje: jeśli to jego kratka, postać
   * stoi na nim i patrzy zgodnie z zadaniem, a w przeciwnym razie najbliższy `step` zaplanuje drogę od nowego miejsca.
   */
  teleport(cell: Cell): void {
    if (!isCell(cell)) return;
    this.x = cell.x + 0.5;
    this.y = cell.y + 0.5;
    this.path = null;
    this.noRoute = false;
    this.moving = false;
    this.stale = false;
    const g = this.goalCell;
    if (g === null) return;
    if (g.x === cell.x && g.y === cell.y) this.heading = this.facing;
    else this.stale = true;
  }

  /** Wymusza nowe planowanie ścieżki (siatka się zmieniła: pojawiła się paleta). Zrobi to najbliższy `step`. */
  repath(): void {
    if (this.goalCell !== null) this.stale = true;
  }

  /** `dt`: czas widoku w sekundach. Nie-skończone i niedodatnie `dt` jest pomijane. `nav` to bieżąca siatka (z paletami). */
  step(dt: number, nav: StaffNav): void {
    // `NaN > 0` jest fałszem, więc jedno porównanie odrzuca NaN, zero i ujemne; Infinity odrzuca drugie.
    if (!(dt > 0) || !Number.isFinite(dt) || this.goalCell === null) return;

    // Czas, który zostaje na marsz w tym kroku. Normalnie cały `dt`; gdy czekaliśmy na ponowną próbę planowania,
    // tylko to, co upłynęło po jej terminie.
    let spend = dt;
    if (this.stale) {
      this.plan(nav);
    } else if (this.noRoute) {
      this.retryIn -= dt;
      if (this.retryIn > 0) return;
      spend = -this.retryIn;
      this.plan(nav);
    }

    // Zużywamy drogę odcinek po odcinku, więc nawet ogromne `dt` nie przeskoczy kratek poza ścieżką ani nie ściśnie zakrętu.
    let budget = this.speed * spend;
    while (budget > 0 && this.path !== null) {
      let cell = this.path[this.next]!;
      // Następna kratka zrobiła się zajęta (paleta): planujemy od bieżącej. Kratki o indeksie 0 (stoimy w niej) to nie dotyczy.
      if (this.next > 0 && nav.blocked(cell.x, cell.y)) {
        this.plan(nav);
        if (this.path === null) break;
        cell = this.path[this.next]!;
      }
      const tx = cell.x + 0.5;
      const ty = cell.y + 0.5;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) {
        this.heading = Math.atan2(dy, dx);
        this.moving = true;
      }
      if (dist <= budget) {
        this.x = tx;
        this.y = ty;
        budget -= dist;
        this.next++;
        if (this.next >= this.path.length) this.arrive();
      } else {
        this.x += (dx / dist) * budget;
        this.y += (dy / dist) * budget;
        budget = 0;
      }
    }
  }

  /**
   * Plan drogi z kratki, w której stoi postać (start może być zablokowany, wolno z niego wyjść). Bez drogi postać stoi i
   * wróci tu za `NO_PATH_RETRY_S`. Ścieżka ma start na [0], więc pierwszy odcinek prowadzi do [1]; gdy start jest celem,
   * zostaje dojść do środka tej kratki.
   */
  private plan(nav: StaffNav): void {
    const goal = this.goalCell!;
    this.stale = false;
    const found = findPath(nav.width, nav.depth, (x, y) => nav.blocked(x, y), { x: Math.floor(this.x), y: Math.floor(this.y) }, goal);
    if (found === null) {
      this.path = null;
      this.moving = false;
      this.noRoute = true;
      this.retryIn = NO_PATH_RETRY_S;
      return;
    }
    this.noRoute = false;
    this.path = found;
    this.next = found.length > 1 ? 1 : 0;
    this.moving = true;
    if (found.length === 1 && this.x === goal.x + 0.5 && this.y === goal.y + 0.5) this.arrive();
  }

  /** Dojście: stoi dokładnie na środku celu i patrzy zgodnie z zadaniem. */
  private arrive(): void {
    const goal = this.goalCell!;
    this.path = null;
    this.noRoute = false;
    this.moving = false;
    this.x = goal.x + 0.5;
    this.y = goal.y + 0.5;
    this.heading = this.facing;
  }
}
