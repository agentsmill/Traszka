// Drzwi na zaplecze otwierają się same przed idącym pracownikiem i zamykają po chwili pustki, żeby nikt nie przenikał przez
// skrzydło. Czysta logika widoku bez three.js: kąt skrzydła z odległości najbliższej postaci i z czasu widoku (s). Obraca nim
// buildStore.ts (`StoreView.updateDoor`). Klienci tędy nie chodzą (`isWalkable` nie wpuszcza na kratki drzwi), więc liczy się załoga.

/** Prostokąt drzwi w kratkach (jak `Fixture`: róg `x`, `y`, rozmiar `w` × `d`). Zaplecze leży po stronie większego y. */
export interface DoorRect { readonly x: number; readonly y: number; readonly w: number; readonly d: number }

/** Postać przy drzwiach: środek w kratkach (kratka + 0,5, jak `StaffWalker`) i czy właśnie idzie. */
export interface DoorMover { readonly x: number; readonly y: number; readonly moving: boolean }

/**
 * Z ilu kratek (0,5 m) od framugi idąca postać otwiera drzwi. Skrzydło (0,86 m) zamiata prawie 2 kratki zaplecza, więc od tamtej
 * strony trzeba zacząć wcześnie: przy 2 kratkach i tempie załogi skrzydło jest z drogi, zanim idący do niego dojdzie.
 */
export const DOOR_REACH = 2;
/** Pełne otwarcie (s czasu widoku). */
export const DOOR_OPEN_S = 0.25;
/** Tyle sekund pustki drzwi stoją jeszcze otwarte. */
export const DOOR_HOLD_S = 0.5;
/** Pełne zamknięcie (s czasu widoku), wolniej niż otwarcie. */
export const DOOR_CLOSE_S = 0.4;
/**
 * Kąt pełnego otwarcia (rad), na zaplecze. 100°: skrzydło odchodzi za linię ościeżnicy, więc w głębi zaplecza nie stoi przy barku
 * idącego kolumną przy zawiasie (przy 90° stałoby tuż obok niego na całej długości), a nie dochodzi do kratki obok przejścia, na
 * której stają bezczynni (targets.ts, `IDLE_DOOR_DISTANCE`).
 */
export const DOOR_OPEN_ANGLE = (100 * Math.PI) / 180;

/** Odległość (kratki) punktu `x`, `y` od prostokąta drzwi; 0 w środku i na brzegu. */
export function doorGap(door: DoorRect, x: number, y: number): number {
  const dx = Math.max(door.x - x, 0, x - (door.x + door.w));
  const dy = Math.max(door.y - y, 0, y - (door.y + door.d));
  return Math.hypot(dx, dy);
}

/** Czy środek postaci leży tam, gdzie zamiata skrzydło: w przejściu albo w rzędzie kratek tuż za nim (od strony zaplecza). */
function inSwing(door: DoorRect, x: number, y: number): boolean {
  return x >= door.x && x <= door.x + door.w && y >= door.y && y <= door.y + door.d + 1;
}

/**
 * Odległość (kratki) najbliższej postaci, dla której drzwi mają się otworzyć: idącej z dowolnej strony albo stojącej tam, gdzie
 * zamiata skrzydło. Stojący obok (bezczynni na zapleczu) drzwi nie trzymają. Nikogo: `Infinity`. Bez alokacji (woła się co klatkę).
 */
export function nearestMover(door: DoorRect, people: readonly { readonly walker: DoorMover }[]): number {
  let best = Infinity;
  for (const { walker: w } of people) {
    if (!w.moving && !inSwing(door, w.x, w.y)) continue;
    const gap = doorGap(door, w.x, w.y);
    if (gap < best) best = gap;
  }
  return best;
}

/** Wygładzenie ruchu skrzydła: rusza i staje łagodnie (smoothstep). */
const ease = (t: number): number => t * t * (3 - 2 * t);

/** Stan skrzydła jednych drzwi. `step` co klatkę; pauza to `dt` = 0. */
export class DoorSwing {
  /** Otwarcie 0..1 (0 zamknięte, 1 pełne). */
  private open = 0;
  /** Sekundy bez nikogo w zasięgu. */
  private empty = DOOR_HOLD_S;

  /** Kąt skrzydła (rad, 0..`DOOR_OPEN_ANGLE`). */
  get angle(): number {
    return DOOR_OPEN_ANGLE * ease(this.open);
  }

  /** Krok o `dt` s czasu widoku; `nearest` to wynik `nearestMover`. Zwraca kąt skrzydła po kroku. */
  step(nearest: number, dt: number): number {
    const t = Number.isFinite(dt) && dt > 0 ? dt : 0;
    if (nearest <= DOOR_REACH) {
      this.empty = 0;
      this.open = Math.min(1, this.open + t / DOOR_OPEN_S);
    } else {
      this.empty += t;
      // zamyka tylko ta część kroku, która wypada po odczekaniu (długi krok po powrocie do karty liczy się dobrze)
      const late = Math.min(t, this.empty - DOOR_HOLD_S);
      if (late > 0) this.open = Math.max(0, this.open - late / DOOR_CLOSE_S);
    }
    return this.angle;
  }
}
