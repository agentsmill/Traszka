import { MathUtils, type Object3D } from 'three';
import { SIM_STEP, type Agent, type Crowd } from '@/sim/crowd/crowd';
import { CELL_SIZE_M, type Cell } from '@/sim/grid';
import { createRng, subSeed } from '@/sim/rng';
import { FRONT_WALL_Y, type StoreLayout } from '@/sim/store/types';
import { isWalkable } from '@/sim/store/validate';
import { characterBlobRadii, setCharacterShadowCasting, type BlobShadows } from './characters/blobShadows';
import type { CharacterFactory, CharacterInstance } from './characters/characterFactory';
import { walkTimeScale } from './characters/walkSpeed';
import { cellToWorld } from './coords';

/** Największa prędkość obrotu postaci, rad/s (wygładzanie kierunku: wykładnicze doganianie, ale nie szybciej niż to). */
export const TURN_RATE_MAX = 10;
const TURN_SMOOTHING = 12;          // 1/s
/**
 * Tyle sekund agent musi stać, zanim postać przejdzie z chodu w postój (pojedynczy krok bez ruchu nie miga animacją).
 * Wspólne dla tłumu i dla `Gait` (personel i kasjer), żeby wszyscy na ekranie przełączali klipy tak samo.
 */
export const IDLE_DELAY_S = 0.15;
/**
 * Najszybsze tempo animacji względem czasu rzeczywistego. Przy ×8 klip chodu migałby (stroboskop: ~2 kroki na klatkę przy
 * 60 FPS), więc powyżej ×4 nogi chodzą w tempie ×4, a postać przesuwa się dalej z prędkością gry (lekki poślizg stóp).
 */
export const ANIM_SPEED_CAP = 4;

type Anim = 'idle' | 'walk';

/** Ruch z kart od tej wartości (1 + modyfikator, np. „Bez limitu” w zrzucie Traszkomonów daje 2,6) stawia przed sklepem kolejkę. */
export const QUEUE_TRAFFIC_MIN = 1.8;
/** Kolejka stoi rano: od 6:00 (minuta doby 360) do 12:00 (720, bez tej minuty). */
export const QUEUE_FROM_MINUTE = 6 * 60;
export const QUEUE_TO_MINUTE = 12 * 60;
export const QUEUE_MIN = 6;
export const QUEUE_MAX = 12;
/** Tyle postaci kolejka dokłada albo zdejmuje przy jednym `setQueue` (co ~100 ms): fala dochodzi w kilka klatek, a nie w jednej. */
const QUEUE_STEP = 2;
/** Rozrzut postaci w obrębie kratki (część kratki w każdą stronę) i kąt, o jaki odchyla się od kierunku na wejście (rad). */
const QUEUE_JITTER = 0.2;
const QUEUE_YAW_JITTER = 0.35;

/**
 * Ile postaci ma stać w kolejce przed sklepem: `min(12, 6 + floor((traffic − 1,8) · 10))` przy ruchu z kart ≥ 1,8 między 6:00
 * a 12:00 (`minuteOfDay` w minutach doby), inaczej 0. Czyta tylko mnożnik z kart (`cardModifiers(...).traffic`), nie stan ekonomii.
 */
export function queueSizeFor(traffic: number, minuteOfDay: number): number {
  if (!(traffic >= QUEUE_TRAFFIC_MIN) || minuteOfDay < QUEUE_FROM_MINUTE || minuteOfDay >= QUEUE_TO_MINUTE) return 0;
  return Math.min(QUEUE_MAX, QUEUE_MIN + Math.floor((traffic - QUEUE_TRAFFIC_MIN) * 10));
}

/**
 * Kratki chodnika, na których stoi kolejka przed wejściem: pierwsze `count` z listy ułożonej od najbliższej środka wejścia.
 * Bierze wiersze przed ścianą frontową (y < FRONT_WALL_Y), tylko chodliwe, bez strefy palet (`palletZoneOutside`) i bez
 * kolumn samego wejścia: przejście do drzwi zostaje wolne, a kolejka stoi po obu stronach. Remisy rozstrzyga bliższy wiersz
 * ściany, potem mniejsze x, więc wynik jest stały, a dłuższa kolejka to ta sama lista z dopisanym końcem.
 */
export function queueOutside(layout: StoreLayout, count: number): Cell[] {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return [];
  const pallets = new Set(layout.palletZoneOutside.map((c) => c.x + c.y * layout.width));
  const lane = new Set(layout.entrance.map((e) => e.x));
  const midX = layout.entrance.reduce((sum, e) => sum + e.x, 0) / Math.max(1, layout.entrance.length);
  const out: { cell: Cell; d: number }[] = [];
  for (let y = 0; y < FRONT_WALL_Y; y++) {
    for (let x = 0; x < layout.width; x++) {
      if (!isWalkable(layout, x, y) || pallets.has(x + y * layout.width) || lane.has(x)) continue;
      out.push({ cell: { x, y }, d: (x - midX) * (x - midX) + (y - FRONT_WALL_Y) * (y - FRONT_WALL_Y) });
    }
  }
  out.sort((a, b) => a.d - b.d || b.cell.y - a.cell.y || a.cell.x - b.cell.x);
  return out.slice(0, n).map((o) => o.cell);
}

/** Postać jednego agenta wraz z tym, co potrzebne do płynnego rysowania między krokami symulacji. */
interface Tracked {
  character: CharacterInstance;
  /** Pozycja agenta (w kratkach, jak `Agent.x/y`) po przedostatnim i po ostatnim kroku symulacji. */
  prevX: number; prevY: number;
  currX: number; currY: number;
  yaw: number;                      // rad, obrót wokół osi y obiektu
  anim: Anim;
  stillFor: number;                 // s od ostatniego kroku z ruchem
  walkScale: number;                // mnożnik czasu klipu chodu
}

/** Obrót obiektu (przód postaci to +z), żeby patrzyła w kierunku `heading` agenta (0 = +x siatki = +x świata). */
export const headingToYaw = (heading: number): number => Math.PI / 2 - heading;

const wrapAngle = (a: number): number => MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;

/**
 * Jeden krok wygładzonego obrotu: nowy obrót (rad) bliżej `targetYaw`, najkrótszą drogą, wykładniczo (TURN_SMOOTHING), ale nie
 * szybciej niż TURN_RATE_MAX. `dt` to czas ramki w sekundach gry (0 przy pauzie: bez obrotu). Wspólne dla tłumu i kasjera.
 */
export function turnTowards(yaw: number, targetYaw: number, dt: number): number {
  const diff = wrapAngle(targetYaw - yaw);
  const limit = TURN_RATE_MAX * dt;
  return yaw + MathUtils.clamp(diff * (1 - Math.exp(-TURN_SMOOTHING * dt)), -limit, limit);
}

/**
 * Rysuje tłum z symulacji: jedna postać (`CharacterFactory`) na agenta, tworzona przy pojawieniu się `agent.id`
 * i zwalniana, gdy agent znika z listy albo ma stan 'gone'. Nie trzyma stanu symulacji, tylko to, co widać.
 *
 * Pozycja: między dwoma ostatnimi krokami symulacji (współczynnik `alpha` z pętli stałego kroku) i przeliczona przez
 * `cellToWorld`. Poprzednia pozycja to stan sprzed ostatniego kroku; gdy w ramce wykonano k > 1 kroków, widz zna tylko
 * stan końcowy, więc poprzedni jest szacowany jako 1/k drogi z powrotem do stanu z poprzedniej ramki (dokładnie na
 * prostej, a zakręt w obrębie jednej ramki przy ×8 nie jest widoczny).
 *
 * Program shadera postaci żyje tylko tak długo, jak jakikolwiek materiał, który go użył przy rysowaniu. Gdy sklep się
 * opróżnia, ostatnia postać, która z niego wyszła (rysowana jeszcze w poprzedniej ramce, więc z programem pasującym do
 * bieżącego światła), nie jest zwalniana, tylko odpinana od sceny i trzymana jako „ciepła”: kolejny klient nie
 * wymusza ponownej kompilacji. Jest dokładnie jedna taka postać; `dispose` zwalnia i ją.
 */
export class CrowdView {
  private readonly tracked = new Map<number, Tracked>();
  /** Ostatnia postać, która opuściła pusty już sklep: poza sceną, ale żywa (trzyma program shadera). */
  private warm: CharacterInstance | null = null;
  private lastTime = 0;
  private disposed = false;
  private castShadows = true;
  /** Kolejka przed wejściem przy zrzucie kart: postacie z tej samej fabryki co tłum, nieruchome, w kolejności kratek `queueOutside`. */
  private readonly queue: CharacterInstance[] = [];

  /** `shadows`: wspólne plamy cienia pod postaciami (main.ts trzyma je w grupie tłumu); bez nich postacie są bez plam. */
  constructor(
    private readonly factory: CharacterFactory,
    private readonly layout: StoreLayout,
    private readonly parent: Object3D,
    private readonly shadows: BlobShadows | null = null,
  ) {}

  /**
   * Czy postacie rzucają cień z mapy cieni (polityka cieni z presetu jakości, `QualitySettings.characterShadows`).
   * Działa na istniejące postacie (także „ciepłą”) i na nowe. Wołane co klatkę: bez zmiany nic nie robi.
   */
  setCharacterShadows(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const t of this.tracked.values()) setCharacterShadowCasting(t.character.object, on);
    for (const q of this.queue) setCharacterShadowCasting(q.object, on);
    if (this.warm) setCharacterShadowCasting(this.warm.object, on);
  }

  /** Liczba postaci w kolejce przed sklepem (do diagnostyki, testów i pula postaci w scenie). */
  get queueSize(): number { return this.queue.length; }

  /**
   * Dopasowuje kolejkę przed wejściem do ruchu z kart (`traffic` = `cardModifiers(...).traffic`) i minuty doby; `cap` to ile
   * postaci wolno jej mieć (pula postaci presetu grafiki, domyślnie `QUEUE_MAX`). Postacie dochodzą i odchodzą po `QUEUE_STEP`
   * na wywołanie. Rozstawienie bierze się z numeru postaci w kolejce (kratka z `queueOutside`, rozrzut i obrót z jego skrótu),
   * bez losowania. Zwraca liczbę postaci, które teraz stoją.
   */
  setQueue(traffic: number, minuteOfDay: number, cap: number = QUEUE_MAX): number {
    if (this.disposed) return 0;
    const want = Math.min(queueSizeFor(traffic, minuteOfDay), Math.max(0, Math.floor(cap)));
    if (want > this.queue.length) {
      const cells = queueOutside(this.layout, want);
      const to = Math.min(cells.length, want, this.queue.length + QUEUE_STEP);
      for (let i = this.queue.length; i < to; i++) this.queue.push(this.spawnQueued(i, cells[i]!));
    } else {
      for (let k = 0; k < QUEUE_STEP && this.queue.length > want; k++) this.release(this.queue.pop()!);
    }
    return this.queue.length;
  }

  /** Liczba postaci w scenie (do diagnostyki i testów). */
  get size(): number { return this.tracked.size; }

  /** Czy trzymana jest „ciepła” postać poza sceną (do diagnostyki i testów). */
  get hasWarm(): boolean { return this.warm !== null; }

  /**
   * Dopasowuje postacie do `crowd` i ustawia je w pozycji dla `alpha` ∈ [0, 1] (ułamek kroku po ostatnim kroku).
   * `frameDt` to czas ramki w sekundach symulacji (rzeczywisty dt × prędkość gry; 0 przy pauzie): napędza obrót i,
   * gdy nie podano `animDt`, animacje. `animDt` to czas ramki dla animacji (np. przycięty do `ANIM_SPEED_CAP` × dt).
   */
  sync(crowd: Crowd, alpha: number, frameDt: number, animDt: number = frameDt): void {
    if (this.disposed) return;
    const advanced = crowd.time - this.lastTime;
    if (advanced < 0) this.clear();   // inny tłum niż poprzednio: zaczynamy od zera
    const steps = advanced > 0 ? Math.max(1, Math.round(advanced / SIM_STEP)) : 0;
    this.lastTime = crowd.time;

    const live = new Set<number>();
    for (const agent of crowd.agents) {
      if (agent.state === 'gone') continue;
      live.add(agent.id);
      const t = this.tracked.get(agent.id) ?? this.spawn(agent);
      if (steps > 0) this.advance(t, agent, steps);
      this.animate(t, agent, frameDt, animDt);
      this.place(t, alpha);
    }
    const left: Tracked[] = [];
    for (const [id, t] of this.tracked) {
      if (live.has(id)) continue;
      left.push(t);
      this.tracked.delete(id);
    }
    this.retire(left);
    for (const q of this.queue) q.update(animDt);
    this.placeShadows();
  }

  /** Zwalnia wszystkie postacie. Po `dispose` kolejne `sync` nic nie robi. */
  dispose(): void {
    this.disposed = true;
    this.clear();
    this.shadows?.commit(0);
  }

  /** Plama pod każdą widoczną postacią, elipsa wg jej szerokości (skala x/z obiektu). */
  private placeShadows(): void {
    if (!this.shadows) return;
    let i = 0;
    const put = (o: Object3D): void => {
      const [rx, rz] = characterBlobRadii(o);
      this.shadows!.set(i++, o.position.x, o.position.z, rx, rz);
    };
    for (const t of this.tracked.values()) put(t.character.object);
    for (const q of this.queue) put(q.object);
    this.shadows.commit(i);
  }

  private spawn(agent: Agent): Tracked {
    const character = this.factory.create(agent.appearanceSeed);
    if (!this.castShadows) setCharacterShadowCasting(character.object, false);
    this.parent.add(character.object);
    const t: Tracked = {
      character,
      prevX: agent.x, prevY: agent.y, currX: agent.x, currY: agent.y,
      yaw: headingToYaw(agent.heading),
      anim: 'idle',
      stillFor: 0,
      walkScale: walkTimeScale(this.factory.walkSpeedMps, agent.speed * CELL_SIZE_M, character.object.scale.z),
    };
    this.tracked.set(agent.id, t);
    if (agent.moving) {
      character.setAnim('walk', 0);
      t.anim = 'walk';
    }
    return t;
  }

  /** Nowy stan symulacji (po `steps` krokach od ostatniej ramki): przesuwa parę poprzednia/bieżąca pozycja. */
  private advance(t: Tracked, agent: Agent, steps: number): void {
    t.prevX = agent.x + (t.currX - agent.x) / steps;
    t.prevY = agent.y + (t.currY - agent.y) / steps;
    t.currX = agent.x;
    t.currY = agent.y;
  }

  private animate(t: Tracked, agent: Agent, frameDt: number, animDt: number): void {
    if (agent.moving) {
      t.stillFor = 0;
      if (t.anim !== 'walk') { t.anim = 'walk'; t.character.setAnim('walk'); }
    } else {
      t.stillFor += frameDt;
      if (t.anim === 'walk' && t.stillFor >= IDLE_DELAY_S) { t.anim = 'idle'; t.character.setAnim('idle'); }
    }
    t.character.update(t.anim === 'walk' ? animDt * t.walkScale : animDt);

    t.yaw = turnTowards(t.yaw, headingToYaw(agent.heading), frameDt);
  }

  private place(t: Tracked, alpha: number): void {
    // agent.x/y: środek kratki = całkowita + 0.5, a cellToWorld podaje środek kratki o indeksie całkowitym
    const x = t.prevX + (t.currX - t.prevX) * alpha - 0.5;
    const y = t.prevY + (t.currY - t.prevY) * alpha - 0.5;
    const w = cellToWorld(this.layout, x, y);
    t.character.object.position.set(w.x, 0, w.z);
    t.character.object.rotation.y = t.yaw;
  }

  /** Zwalnia postacie, które zniknęły ze sceny. Gdy sklep jest pusty, ostatnia z nich zostaje jako „ciepła” (zastępuje poprzednią). */
  private retire(left: Tracked[]): void {
    if (left.length === 0) return;
    const keep = this.tracked.size === 0 ? left.pop()! : null;
    for (const t of left) this.release(t.character);
    if (keep) {
      keep.character.object.removeFromParent();
      // najpierw nowa „ciepła”, potem zwolnienie starej, żeby program nie spadł do zera użyć w międzyczasie
      const old = this.warm;
      this.warm = keep.character;
      if (old) this.release(old);
    }
  }

  /** Postać nr `index` w kolejce na kratce `cell`: wygląd i rozrzut z numeru, przodem do wejścia, w postoju. */
  private spawnQueued(index: number, cell: Cell): CharacterInstance {
    const seed = subSeed(this.layout.seed, `queue:${index}`);
    const rng = createRng(seed);
    const character = this.factory.create(seed);
    if (!this.castShadows) setCharacterShadowCasting(character.object, false);
    const at = cellToWorld(this.layout, cell.x, cell.y);
    const e = this.layout.entrance;
    const doorX = e.reduce((sum, c) => sum + c.x, 0) / Math.max(1, e.length);
    const heading = Math.atan2(FRONT_WALL_Y - cell.y, doorX - cell.x) + rng.range(-QUEUE_YAW_JITTER, QUEUE_YAW_JITTER);
    character.object.position.set(
      at.x + rng.range(-QUEUE_JITTER, QUEUE_JITTER) * CELL_SIZE_M, 0, at.z + rng.range(-QUEUE_JITTER, QUEUE_JITTER) * CELL_SIZE_M,
    );
    character.object.rotation.y = headingToYaw(heading);
    this.parent.add(character.object);
    return character;
  }

  private release(character: CharacterInstance): void {
    character.dispose();
    character.object.removeFromParent();
  }

  private clear(): void {
    for (const t of this.tracked.values()) this.release(t.character);
    this.tracked.clear();
    for (const q of this.queue) this.release(q);
    this.queue.length = 0;
    if (this.warm) this.release(this.warm);
    this.warm = null;
  }
}
