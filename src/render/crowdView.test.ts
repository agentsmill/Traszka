import { Group, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { SIM_STEP, createCrowd, stepCrowd, type Agent, type Crowd } from '@/sim/crowd/crowd';
import { CELL_SIZE_M } from '@/sim/grid';
import { generateStore } from '@/sim/store/generateStore';
import type { CharacterFactory, CharacterInstance } from './characters/characterFactory';
import { cellToWorld } from './coords';
import { WALK_SPEED_MPS } from './characters/walkSpeed';
import { BLOB_RADIUS, createBlobShadows } from './characters/blobShadows';
import { ANIM_SPEED_CAP, CrowdView, TURN_RATE_MAX } from './crowdView';

/** Fabryka-atrapa: postać to pusta grupa, a wywołania zapisujemy. */
function fakeFactory(scale = 1) {
  const made: { seed: string; character: CharacterInstance; setAnim: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];
  const factory: CharacterFactory = {
    create(seed) {
      const object = new Group();
      object.scale.set(scale, scale, scale);
      const setAnim = vi.fn();
      const update = vi.fn();
      const dispose = vi.fn(() => object.removeFromParent());
      const character: CharacterInstance = { object, setAnim, update, dispose, isFallback: false };
      made.push({ seed, character, setAnim, update, dispose });
      return character;
    },
  };
  return { factory, made };
}

const layout = generateStore('kielbasa-42');

function agent(over: Partial<Agent> = {}): Agent {
  return { id: 1, x: 10.5, y: 8.5, heading: 0, state: 'browsing', moving: false, ghost: false, appearanceSeed: 'wyglad-1', speed: 2.4, ...over };
}
/** Tłum-atrapa: widok czyta tylko `time` i `agents`. */
function crowdOf(time: number, ...agents: Agent[]): Crowd {
  return { seed: 's', time, agents } as unknown as Crowd;
}

describe('CrowdView', () => {
  it('tworzy postać z appearanceSeed przy nowym id i dodaje ją do rodzica; drugi sync nie dubluje', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const view = new CrowdView(factory, layout, parent);
    const crowd = crowdOf(0, agent());
    view.sync(crowd, 0, 0);
    view.sync(crowd, 0, 0);
    expect(made.map((m) => m.seed)).toEqual(['wyglad-1']);
    expect(parent.children).toEqual([made[0]!.character.object]);
    expect(view.size).toBe(1);
  });

  it('pomija agenta w stanie gone i zdejmuje jego postać ze sceny', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const view = new CrowdView(factory, layout, parent);
    const a = agent();
    view.sync(crowdOf(0, a), 0, 0);
    expect(parent.children).toHaveLength(1);
    a.state = 'gone';
    view.sync(crowdOf(SIM_STEP, a), 0, 0);
    expect(parent.children).toHaveLength(0);
    expect(view.size).toBe(0);
    // agent od razu w stanie gone w ogóle nie dostaje postaci
    view.sync(crowdOf(2 * SIM_STEP, agent({ id: 2, state: 'gone' })), 0, 0);
    expect(made).toHaveLength(1);
  });

  it('zwalnia postać agenta, który zniknął z listy', () => {
    const { factory, made } = fakeFactory();
    const view = new CrowdView(factory, layout, new Group());
    view.sync(crowdOf(0, agent({ id: 1 }), agent({ id: 2 })), 0, 0);
    view.sync(crowdOf(SIM_STEP, agent({ id: 2 })), 0, 0);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(made[1]!.dispose).not.toHaveBeenCalled();
    expect(view.size).toBe(1);
    expect(view.hasWarm).toBe(false);   // w sklepie ktoś jeszcze jest, więc nic nie jest trzymane na zapas
  });

  it('gdy sklep się opróżnia, ostatnia postać zostaje „ciepła” (poza sceną, nie zwolniona), a nie wszystkie', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const view = new CrowdView(factory, layout, parent);
    view.sync(crowdOf(0, agent({ id: 1 }), agent({ id: 2 }), agent({ id: 3 })), 0, 0);
    view.sync(crowdOf(SIM_STEP), 0, 0);   // wszyscy wyszli naraz
    expect(view.size).toBe(0);
    expect(parent.children).toHaveLength(0);
    expect(view.hasWarm).toBe(true);
    expect(made.filter((m) => m.dispose.mock.calls.length === 0)).toHaveLength(1);   // dokładnie jedna żyje
    expect(made[2]!.dispose).not.toHaveBeenCalled();                                  // ostatnia z listy wyjść
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(made[1]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('kolejna „ciepła” postać zastępuje poprzednią, a dispose zwalnia ostatnią', () => {
    const { factory, made } = fakeFactory();
    const view = new CrowdView(factory, layout, new Group());
    view.sync(crowdOf(0, agent({ id: 1 })), 0, 0);
    view.sync(crowdOf(SIM_STEP), 0, 0);                              // pusty sklep: postać 1 jest ciepła
    view.sync(crowdOf(2 * SIM_STEP, agent({ id: 2 })), 0, 0);        // nowy klient dostaje nową postać
    expect(made).toHaveLength(2);
    expect(made[0]!.dispose).not.toHaveBeenCalled();
    view.sync(crowdOf(3 * SIM_STEP), 0, 0);                          // znów pusto: ciepła jest postać 2, postać 1 zwolniona
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(made[1]!.dispose).not.toHaveBeenCalled();
    view.dispose();
    expect(made[1]!.dispose).toHaveBeenCalledTimes(1);
    expect(view.hasWarm).toBe(false);
  });

  it('ustawia pozycję przez cellToWorld (y = 0) i interpoluje między dwoma ostatnimi krokami', () => {
    const { factory, made } = fakeFactory();
    const view = new CrowdView(factory, layout, new Group());
    const a = agent({ x: 10.5, y: 8.5 });
    view.sync(crowdOf(0, a), 0, 0);
    const o = made[0]!.character.object;
    const start = cellToWorld(layout, 10, 8);
    expect(o.position.x).toBeCloseTo(start.x, 12);
    expect(o.position.z).toBeCloseTo(start.z, 12);
    expect(o.position.y).toBe(0);

    a.x = 11.5;                                  // jeden krok symulacji: o całą kratkę
    view.sync(crowdOf(SIM_STEP, a), 0, 0);
    expect(o.position.x).toBeCloseTo(start.x, 12);                  // alpha 0: jeszcze poprzedni stan
    view.sync(crowdOf(SIM_STEP, a), 0.5, 0);
    expect(o.position.x).toBeCloseTo(start.x + CELL_SIZE_M / 2, 12);
    view.sync(crowdOf(SIM_STEP, a), 1, 0);
    expect(o.position.x).toBeCloseTo(cellToWorld(layout, 11, 8).x, 12);
  });

  it('po k krokach w jednej ramce szacuje poprzednią pozycję jako 1/k drogi (ruch po prostej jest gładki)', () => {
    const { factory, made } = fakeFactory();
    const view = new CrowdView(factory, layout, new Group());
    const a = agent({ x: 10.5 });
    view.sync(crowdOf(0, a), 0, 0);
    a.x = 14.5;                                  // 4 kroki po 1 kratce
    view.sync(crowdOf(4 * SIM_STEP, a), 0, 0);
    expect(made[0]!.character.object.position.x).toBeCloseTo(cellToWorld(layout, 13, 8).x, 9);   // stan sprzed ostatniego kroku
  });

  it('obraca postać przodem (+z) w kierunku heading: 0 = +x świata, π/2 = +z świata', () => {
    const { factory, made } = fakeFactory();
    const view = new CrowdView(factory, layout, new Group());
    view.sync(crowdOf(0, agent({ id: 1, heading: 0 }), agent({ id: 2, heading: Math.PI / 2 })), 0, 0);
    for (const [i, expected] of [[0, [1, 0]], [1, [0, 1]]] as const) {
      const yaw = made[i]!.character.object.rotation.y;
      expect(Math.sin(yaw)).toBeCloseTo(expected[0], 12);
      expect(Math.cos(yaw)).toBeCloseTo(expected[1], 12);
    }
  });

  it('wygładza obrót: nie szybciej niż TURN_RATE_MAX rad/s, najkrótszą drogą, aż do celu', () => {
    const { factory, made } = fakeFactory();
    const view = new CrowdView(factory, layout, new Group());
    const a = agent({ heading: 0 });
    view.sync(crowdOf(0, a), 0, 0);
    const o = made[0]!.character.object;
    const yaw0 = o.rotation.y;
    a.heading = Math.PI;                         // zawrócenie o 180°
    let time = 0;
    let prev = yaw0;
    for (let i = 0; i < 6; i++) {
      time += SIM_STEP;
      view.sync(crowdOf(time, a), 0, SIM_STEP);
      expect(Math.abs(o.rotation.y - prev)).toBeLessThanOrEqual(TURN_RATE_MAX * SIM_STEP + 1e-9);
      prev = o.rotation.y;
    }
    expect(Math.abs(o.rotation.y - yaw0)).toBeGreaterThan(0.5);   // naprawdę się obraca
    for (let i = 0; i < 90; i++) { time += SIM_STEP; view.sync(crowdOf(time, a), 0, SIM_STEP); }
    expect(Math.cos(o.rotation.y)).toBeCloseTo(Math.cos(Math.PI / 2 - Math.PI), 3);
    expect(Math.sin(o.rotation.y)).toBeCloseTo(Math.sin(Math.PI / 2 - Math.PI), 3);
  });

  it('nie obraca postaci przy pauzie (frameDt = 0)', () => {
    const { factory, made } = fakeFactory();
    const view = new CrowdView(factory, layout, new Group());
    const a = agent({ heading: 0 });
    view.sync(crowdOf(0, a), 0, 0);
    const yaw = made[0]!.character.object.rotation.y;
    a.heading = 2;
    view.sync(crowdOf(0, a), 0, 0);
    expect(made[0]!.character.object.rotation.y).toBe(yaw);
  });

  it('chód, gdy agent.moving, inaczej postój; krótka przerwa w ruchu nie przełącza animacji', () => {
    const { factory, made } = fakeFactory();
    const view = new CrowdView(factory, layout, new Group());
    const a = agent({ moving: true });
    let time = 0;
    const tick = (): void => { time += SIM_STEP; view.sync(crowdOf(time, a), 0, SIM_STEP); };
    view.sync(crowdOf(0, a), 0, 0);
    const m = made[0]!;
    expect(m.setAnim.mock.calls).toEqual([['walk', 0]]);   // zaczyna od razu w chodzie, bez przenikania

    a.moving = false; tick();                              // jeden krok bez ruchu
    expect(m.setAnim).toHaveBeenCalledTimes(1);
    a.moving = true; tick();
    expect(m.setAnim).toHaveBeenCalledTimes(1);

    a.moving = false;
    for (let i = 0; i < 10; i++) tick();                   // 0,33 s postoju
    expect(m.setAnim).toHaveBeenLastCalledWith('idle');
    const calls = m.setAnim.mock.calls.length;
    a.moving = true; tick();
    expect(m.setAnim).toHaveBeenCalledTimes(calls + 1);
    expect(m.setAnim).toHaveBeenLastCalledWith('walk');
  });

  it('skaluje czas klipu chodu do agent.speed (stopy nie ślizgają się), a postój gra w normalnym tempie', () => {
    const { factory, made } = fakeFactory(0.9);
    const view = new CrowdView(factory, layout, new Group(), 'modular');
    const walker = agent({ id: 1, moving: true, speed: 2.6 });
    const idler = agent({ id: 2, moving: false, speed: 2.6 });
    view.sync(crowdOf(0, walker, idler), 0, 0.02);
    const expected = (2.6 * CELL_SIZE_M) / (WALK_SPEED_MPS.modular * 0.9);
    expect(expected).toBeGreaterThan(0.5);
    expect(expected).toBeLessThan(2);
    expect(made[0]!.update).toHaveBeenLastCalledWith(expect.closeTo(0.02 * expected, 12));
    expect(made[1]!.update).toHaveBeenLastCalledWith(0.02);
  });

  it('mnożnik chodu jest ograniczony do [0,5; 2]', () => {
    const { factory, made } = fakeFactory(0.05);   // bardzo mała postać: stopa ma ułamek m/s
    const view = new CrowdView(factory, layout, new Group());
    view.sync(crowdOf(0, agent({ moving: true })), 0, 1);
    expect(made[0]!.update).toHaveBeenLastCalledWith(2);
  });

  it('dispose zwalnia wszystkie postacie, a dalszy sync nic nie tworzy', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const view = new CrowdView(factory, layout, parent);
    view.sync(crowdOf(0, agent({ id: 1 }), agent({ id: 2 }), agent({ id: 3 })), 0, 0);
    view.dispose();
    expect(made.every((m) => m.dispose.mock.calls.length === 1)).toBe(true);
    expect(parent.children).toHaveLength(0);
    view.sync(crowdOf(SIM_STEP, agent({ id: 4 })), 0, 0);
    expect(made).toHaveLength(3);
    view.dispose();                                 // drugie dispose nie zwalnia po raz drugi
    expect(made.every((m) => m.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('tłum z symulacji: liczba postaci = liczba żywych agentów, a każda utworzona postać jest zwolniona albo żywa', () => {
    const real = generateStore('kielbasa-42');
    const crowd = createCrowd(real, 'kielbasa-42', { targetCount: 12, spawnPerMinute: 30 });
    const { factory, made } = fakeFactory();
    const parent: Object3D = new Group();
    const view = new CrowdView(factory, real, parent);
    let maxLive = 0;
    let seenGone = false;
    for (let i = 0; i < 30 * 240; i++) {            // 4 minuty symulacji, sync co krok
      stepCrowd(crowd, real, SIM_STEP);
      view.sync(crowd, 0, SIM_STEP);
      const live = crowd.agents.filter((a) => a.state !== 'gone').length;
      seenGone ||= crowd.agents.some((a) => a.state === 'gone');
      maxLive = Math.max(maxLive, live);
      expect(view.size).toBe(live);
      expect(parent.children).toHaveLength(live);
    }
    expect(made.length).toBeGreaterThan(12);        // klienci przychodzą i wychodzą
    expect(seenGone).toBe(true);
    expect(maxLive).toBeLessThanOrEqual(12);
    const disposed = made.filter((m) => m.dispose.mock.calls.length === 1).length;
    expect(disposed).toBe(made.length - view.size - (view.hasWarm ? 1 : 0));
    view.dispose();
    expect(made.every((m) => m.dispose.mock.calls.length === 1)).toBe(true);
  });
});

describe('CrowdView: plamy cienia i polityka cieni (zadanie 16)', () => {
  /** Fabryka, której postać ma jedną siatkę (żeby było czym rzucać cień). */
  function meshFactory(): CharacterFactory {
    return {
      create() {
        const object = new Group();
        object.scale.set(0.9 * 1.2, 0.9, 0.9 * 1.2);   // wzrost 0,9 × model, tusza 1,2
        const body = new Mesh();
        body.castShadow = true;
        object.add(body);
        return { object, setAnim: vi.fn(), update: vi.fn(), dispose: vi.fn(() => object.removeFromParent()), isFallback: false };
      },
    };
  }
  const castOf = (parent: Object3D): boolean[] => {
    const out: boolean[] = [];
    parent.traverse((o) => { if ((o as Mesh).isMesh) out.push(o.castShadow); });
    return out;
  };

  it('jedna plama na widoczną postać, pod jej stopami, elipsa wg tuszy; dispose chowa plamy', () => {
    const blobs = createBlobShadows(8);
    const view = new CrowdView(meshFactory(), layout, new Group(), 'modular', blobs);
    view.sync(crowdOf(0, agent({ id: 1 }), agent({ id: 2, x: 12.5 }), agent({ id: 3, state: 'gone' })), 0, 0);
    expect(blobs.mesh.count).toBe(2);
    const m = new (blobs.mesh.instanceMatrix.array.constructor as Float32ArrayConstructor)(16);
    blobs.mesh.instanceMatrix.array.slice(0, 16).forEach((v, i) => { m[i] = v; });
    const at = cellToWorld(layout, 10, 8);
    expect(m[12]).toBeCloseTo(at.x, 5);
    expect(m[14]).toBeCloseTo(at.z, 5);
    expect(m[0]).toBeCloseTo(BLOB_RADIUS * 1.2, 5);   // promień w metrach × tusza, bez skali wzrostu
    // postać, która odchodzi (znika z tłumu albo przechodzi w 'gone'), traci plamę w tej samej klatce
    view.sync(crowdOf(SIM_STEP, agent({ id: 1 })), 0, 0);
    expect(blobs.mesh.count).toBe(1);
    view.sync(crowdOf(2 * SIM_STEP, agent({ id: 1, state: 'gone' })), 0, 0);
    expect(blobs.mesh.count).toBe(0);
    view.sync(crowdOf(3 * SIM_STEP, agent({ id: 1 }), agent({ id: 2, x: 12.5 })), 0, 0);
    expect(blobs.mesh.count).toBe(2);
    view.dispose();
    expect(blobs.mesh.count).toBe(0);
    blobs.dispose();
  });

  it('setCharacterShadows wyłącza i włącza cień z mapy dla obecnych i nowych postaci', () => {
    const parent = new Group();
    const view = new CrowdView(meshFactory(), layout, parent);
    view.sync(crowdOf(0, agent({ id: 1 })), 0, 0);
    expect(castOf(parent)).toEqual([true]);
    view.setCharacterShadows(false);
    expect(castOf(parent)).toEqual([false]);
    view.sync(crowdOf(SIM_STEP, agent({ id: 1 }), agent({ id: 2, x: 12.5 })), 0, 0);
    expect(castOf(parent)).toEqual([false, false]);
    view.setCharacterShadows(true);
    expect(castOf(parent)).toEqual([true, true]);
  });

  it('animDt napędza animację niezależnie od czasu symulacji (×8 gra, nogi najwyżej ×4)', () => {
    const { factory, made } = fakeFactory();
    const view = new CrowdView(factory, layout, new Group());
    const dt = 1 / 60;
    view.sync(crowdOf(0, agent()), 0, 8 * dt, Math.min(8, ANIM_SPEED_CAP) * dt);
    expect(made[0]!.update).toHaveBeenLastCalledWith(4 * dt);
    expect(new Vector3().copy(made[0]!.character.object.position).length()).toBeGreaterThan(0);
  });
});

