import { MathUtils, type Object3D } from 'three';
import { SIM_STEP, type Agent, type Crowd } from '@/sim/crowd/crowd';
import { CELL_SIZE_M } from '@/sim/grid';
import type { StoreLayout } from '@/sim/store/types';
import { BLOB_RADIUS, type BlobShadows } from './characters/blobShadows';
import type { CharacterFactory, CharacterInstance } from './characters/characterFactory';
import { walkTimeScale } from './characters/walkSpeed';
import { cellToWorld } from './coords';

/** Największa prędkość obrotu postaci, rad/s (wygładzanie kierunku: wykładnicze doganianie, ale nie szybciej niż to). */
export const TURN_RATE_MAX = 10;
const TURN_SMOOTHING = 12;          // 1/s
/** Tyle sekund agent musi stać, zanim postać przejdzie z chodu w postój (pojedynczy krok bez ruchu nie miga animacją). */
const IDLE_DELAY_S = 0.15;
/**
 * Najszybsze tempo animacji względem czasu rzeczywistego. Przy ×8 klip chodu migałby (stroboskop: ~2 kroki na klatkę przy
 * 60 FPS), więc powyżej ×4 nogi chodzą w tempie ×4, a postać przesuwa się dalej z prędkością gry (lekki poślizg stóp).
 */
export const ANIM_SPEED_CAP = 4;

type Anim = 'idle' | 'walk';

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
const headingToYaw = (heading: number): number => Math.PI / 2 - heading;

const wrapAngle = (a: number): number => MathUtils.euclideanModulo(a + Math.PI, Math.PI * 2) - Math.PI;

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
    for (const t of this.tracked.values()) this.applyShadow(t.character);
    if (this.warm) this.applyShadow(this.warm);
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
    for (const t of this.tracked.values()) {
      const o = t.character.object;
      const k = BLOB_RADIUS / Math.max(1e-6, o.scale.y);
      this.shadows.set(i++, o.position.x, o.position.z, o.scale.x * k, o.scale.z * k);
    }
    this.shadows.commit(i);
  }

  private applyShadow(character: CharacterInstance): void {
    const on = this.castShadows;
    character.object.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) o.castShadow = on; });
  }

  private spawn(agent: Agent): Tracked {
    const character = this.factory.create(agent.appearanceSeed);
    if (!this.castShadows) this.applyShadow(character);
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

    const diff = wrapAngle(headingToYaw(agent.heading) - t.yaw);
    const limit = TURN_RATE_MAX * frameDt;
    t.yaw += MathUtils.clamp(diff * (1 - Math.exp(-TURN_SMOOTHING * frameDt)), -limit, limit);
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

  private release(character: CharacterInstance): void {
    character.dispose();
    character.object.removeFromParent();
  }

  private clear(): void {
    for (const t of this.tracked.values()) this.release(t.character);
    this.tracked.clear();
    if (this.warm) this.release(this.warm);
    this.warm = null;
  }
}
