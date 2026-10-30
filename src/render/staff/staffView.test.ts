import { Color, Group, Matrix4, Mesh, Object3D, SkinnedMesh, Vector3, type Material } from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cashierSpot, type CashierLook } from '@/game/cashier';
import { CashierView, type CashierPose } from '@/render/cashierView';
import { BLOB_Y, characterBlobRadii, createBlobShadows, type BlobShadows } from '@/render/characters/blobShadows';
import { REGION } from '@/render/characters/characterMaterial';
import { createCharacterFactory, type CharacterFactory, type CharacterInstance, type OutfitOverrides } from '@/render/characters/characterFactory';
import type { OutfitFile } from '@/render/characters/modularPack';
import { loadFromDisk } from '@/render/characters/testAssets';
import { walkTimeScale } from '@/render/characters/walkSpeed';
import { cellToWorld } from '@/render/coords';
import { IDLE_DELAY_S, headingToYaw, turnTowards } from '@/render/crowdView';
import { PALETTE } from '@/render/style';
import type { Agent } from '@/sim/crowd/crowd';
import { CELL_SIZE_M } from '@/sim/grid';
import { generateStore } from '@/sim/store/generateStore';
import { layoutFromParts, validParts } from '@/sim/store/testLayouts';
import type { CrewInput, CrewMember } from './crew';
import { buildStaffNav } from './staffNav';
import { StaffView } from './staffView';
import { EDWARD_ID, STAFF_VIEW_MAX, type StaffAssignment, type StaffDuty } from './types';
import { STAFF_WALK_SPEED } from './walker';

afterEach(() => { vi.restoreAllMocks(); });

const layout = generateStore('kielbasa-42');
const spot = cashierSpot(layout)!;
const home = cellToWorld(layout, spot.cell.x, spot.cell.y);

/** Krok czasu widoku: potęga dwójki, więc sumy kroków są dokładne. */
const DT = 1 / 16;
const MINUTE = 8 * 60;
const UNIFORM: OutfitOverrides = { top: PALETTE.brand.green };
const LOOK: CashierLook = { outfit: 'men-suit', appearanceSeed: 'kasjer-test' };
const MIX: StaffDuty[] = ['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny', 'kasa', 'wykladanie', 'rozladunek'];

/** Załoga n osób o id 0…n−1; pierwsza z `kasa` (id 0) dostaje ciało kasjera. */
const crowd = (n: number): StaffAssignment[] => MIX.slice(0, n).map((task, id) => ({ id, task }));
const input = (people: readonly StaffAssignment[]): CrewInput => ({ people, minute: MINUTE, pallets: [] });

interface Made {
  seed: string; outfit: OutfitFile; overrides: OutfitOverrides | undefined;
  character: CharacterInstance; setAnim: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>;
}

/**
 * Fabryka-atrapa: postać to grupa z jedną siatką (jest czym rzucać cień), wywołania zapisujemy. `failSeed` mówi, dla których
 * seedów budowa ma rzucić. Klientów tu nie ma, więc `create` przy każdej próbie krzyczy.
 */
function fakeFactory(failSeed: (seed: string) => boolean = () => false) {
  const made: Made[] = [];
  const attempts = new Map<string, number>();
  const factory: CharacterFactory = {
    walkSpeedMps: 1.15,
    dispose: vi.fn(),
    create() { throw new Error('załoga nie jest klientem'); },
    ensureOutfit: () => Promise.resolve(),
    hasOutfit: () => true,
    createWithOutfit(seed, outfit, overrides) {
      attempts.set(seed, (attempts.get(seed) ?? 0) + 1);
      if (failSeed(seed)) throw new Error(`nie da się zbudować ${seed}`);
      const object = new Group();
      object.scale.set(0.9 * 1.2, 0.9, 0.9 * 1.2);   // wzrost 0,9 × model, tusza 1,2
      const body = new Mesh();
      body.castShadow = true;
      object.add(body);
      const setAnim = vi.fn();
      const update = vi.fn();
      const dispose = vi.fn(() => object.removeFromParent());
      const character: CharacterInstance = { object, outfit, setAnim, update, dispose, isFallback: false };
      made.push({ seed, outfit, overrides, character, setAnim, update, dispose });
      return character;
    },
  };
  return { factory, made, attempts };
}

interface Rig {
  made: Made[];
  attempts: Map<string, number>;
  parent: Group;
  blobs: BlobShadows;
  cashier: CashierView | null;
  staff: StaffView;
  /** Pozy, jakie widok przekazał kasjerowi (kopie: `setPose` dostaje obiekt, który widok potem nadpisuje). */
  poses: (CashierPose | null)[];
  visibility: boolean[];
}

function rig(options: { blobCapacity?: number; cashier?: boolean; failSeed?: (seed: string) => boolean } = {}): Rig {
  const { factory, made, attempts } = fakeFactory(options.failSeed);
  const parent = new Group();
  const blobs = createBlobShadows(options.blobCapacity ?? 16);
  const poses: (CashierPose | null)[] = [];
  const visibility: boolean[] = [];
  let cashier: CashierView | null = null;
  if (options.cashier !== false) {
    cashier = new CashierView(factory, layout, parent, blobs, LOOK);
    const setPose = cashier.setPose.bind(cashier);
    cashier.setPose = (pose) => { poses.push(pose ? { ...pose } : null); setPose(pose); };
    const setVisible = cashier.setVisible.bind(cashier);
    cashier.setVisible = (visible) => { visibility.push(visible); setVisible(visible); };
  }
  const staff = new StaffView(factory, layout, parent, blobs, cashier);
  return { made, attempts, parent, blobs, cashier, staff, poses, visibility };
}

/** Jedna klatka gry: najpierw załoga, potem kasjer (tak woła je scena). */
function frame(r: Rig, serving: Agent | null = null, dt = DT): void {
  r.staff.update(dt, dt, serving);
  r.cashier?.update(dt, serving, false, dt);
}

/** Klatki, aż `done()` albo upłynie `limitS` s (czasu widoku). Zwraca, czy `done()` się spełniło. */
function until(r: Rig, done: () => boolean, limitS = 60, serving: Agent | null = null): boolean {
  for (let t = 0; t < limitS && !done(); t += DT) frame(r, serving);
  return done();
}

const members = (r: Rig): readonly CrewMember[] => r.staff.crew.members;
const member = (r: Rig, id: number): CrewMember => {
  const found = members(r).find((m) => m.id === id);
  if (!found) throw new Error(`brak osoby ${id} w załodze`);
  return found;
};
/** Ostatnia postać zbudowana dla pracownika `id` (ciało kasjera nie ma seeda `pracownik-…`). */
const bodyOf = (r: Rig, id: number): Made => {
  const found = [...r.made].reverse().find((m) => m.seed === `pracownik-${id}`);
  if (!found) throw new Error(`brak ciała pracownika ${id}`);
  return found;
};
const employees = (r: Rig): Made[] => r.made.filter((m) => m.seed.startsWith('pracownik-'));
const idsOnScene = (r: Rig): string[] => r.made.filter((m) => m.character.object.parent === r.parent && m.seed.startsWith('pracownik-')).map((m) => m.seed).sort();

/** Klient w danej odległości (w kratkach) od kratki kasjera. */
function customer(dx: number, dy: number): Agent {
  return {
    id: 1, x: spot.cell.x + 0.5 + dx, y: spot.cell.y + 0.5 + dy, heading: 0, state: 'paying', moving: false, ghost: false,
    appearanceSeed: 'klient', speed: 2.4,
  };
}
/** Kierunek patrzenia postaci w siatce (rad, 0 = +x): przód to +z obiektu obrócony o yaw wokół y. */
const facingOf = (o: Object3D): number => Math.atan2(Math.cos(o.rotation.y), Math.sin(o.rotation.y));
const angleDiff = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** Położenie i promienie plamy z miejsca `i` w siatce plam. */
function blobAt(blobs: BlobShadows, i: number): { x: number; y: number; z: number; rx: number; rz: number } {
  const m = new Matrix4();
  blobs.mesh.getMatrixAt(i, m);
  const p = new Vector3().setFromMatrixPosition(m);
  return { x: p.x, y: p.y, z: p.z, rx: new Vector3().setFromMatrixColumn(m, 0).length(), rz: new Vector3().setFromMatrixColumn(m, 2).length() };
}
/** Gdzie świat stawia osobę z walkerem w (x, y) kratek: środek kratki to indeks + 0.5. */
const worldOf = (m: CrewMember): { x: number; z: number } => cellToWorld(layout, m.walker.x - 0.5, m.walker.y - 0.5);

describe('StaffView: ciała pracowników', () => {
  it('ciała powstają dopiero w update (sync jest tani), po jednym na osobę poza kasjerem, w grupie rodzica', () => {
    const r = rig();
    expect(r.made).toHaveLength(1);                       // tylko kasjer z konstruktora CashierView
    r.staff.sync(input(crowd(4)));
    expect(r.staff.size).toBe(0);
    expect(r.made).toHaveLength(1);
    frame(r);
    expect(r.staff.size).toBe(3);                         // id 0 to ciało kasjera: ma je CashierView
    expect(r.parent.children).toHaveLength(4);            // kasjer + trzech pracowników
    expect(employees(r).map((m) => m.character.object.parent)).toEqual([r.parent, r.parent, r.parent]);
    frame(r);
    expect(r.made).toHaveLength(4);                       // kolejne klatki niczego nie dobudowują
  });

  it('mundur jak u kasjera (zieleń marki), strój i seed z id: parzyste men-casual-2, nieparzyste women-casual', () => {
    const r = rig();
    r.staff.sync(input(crowd(6)));
    frame(r);
    expect(employees(r).map((m) => [m.seed, m.outfit])).toEqual([
      ['pracownik-1', 'women-casual'], ['pracownik-2', 'men-casual-2'], ['pracownik-3', 'women-casual'],
      ['pracownik-4', 'men-casual-2'], ['pracownik-5', 'women-casual'],
    ]);
    for (const m of employees(r)) expect(m.overrides, m.seed).toEqual(UNIFORM);
  });

  it('kasjer nie jest dublowany: jedna postać z wyglądu gracza na CashierView, pracownicy tylko dla reszty', () => {
    const r = rig();
    r.staff.sync(input(crowd(5)));
    for (let i = 0; i < 30; i++) frame(r);
    const cashierBodies = r.made.filter((m) => !m.seed.startsWith('pracownik-'));
    expect(cashierBodies.map((m) => m.seed)).toEqual(['kasjer-test']);
    expect(r.made.some((m) => m.seed === 'pracownik-0')).toBe(false);
    expect(member(r, 0).isCashier).toBe(true);
    expect(r.parent.children).toHaveLength(5);            // pięć osób, pięć postaci
    expect(r.cashier!.character).toBe(cashierBodies[0]!.character);
  });

  it('bez widoku kasjera (benchmark) nie ma wywołań mostu, a ciało kasjera nie dostaje drugiej postaci', () => {
    const r = rig({ cashier: false });
    r.staff.sync(input(crowd(3)));
    expect(() => { for (let i = 0; i < 10; i++) frame(r); }).not.toThrow();
    expect(r.staff.size).toBe(2);
    expect(r.made.map((m) => m.seed)).toEqual(['pracownik-1', 'pracownik-2']);
    expect(r.poses).toEqual([]);
  });

  it('twardy limit: tłum zgłoszeń ponad STAFF_VIEW_MAX daje w scenie najwyżej tyle postaci, ile osób w widoku', () => {
    const r = rig();
    r.staff.sync(input(Array.from({ length: STAFF_VIEW_MAX + 5 }, (_, id) => ({ id, task: MIX[id % MIX.length]! }))));
    for (let i = 0; i < 5; i++) frame(r);
    expect(r.parent.children).toHaveLength(STAFF_VIEW_MAX);
    expect(r.staff.size).toBe(STAFF_VIEW_MAX - 1);
  });

  it('zatrudnienie dodaje ciało, zwolnienie i koniec zmiany zwalniają je razem z miejscem w plamach', () => {
    const r = rig();
    r.staff.sync(input(crowd(2)));
    frame(r);
    expect(idsOnScene(r)).toEqual(['pracownik-1']);
    expect(r.blobs.mesh.count).toBe(2);                   // kasjer + pracownik

    r.staff.sync(input([...crowd(2), { id: 2, task: 'wykladanie' }]));   // zatrudnienie: nowy wchodzi z chodnika
    frame(r);
    expect(idsOnScene(r)).toEqual(['pracownik-1', 'pracownik-2']);
    expect(r.blobs.mesh.count).toBe(3);

    r.staff.sync(input([{ id: 0, task: 'kasa' }, { id: 2, task: 'wykladanie' }]));   // zwolnienie 1: wychodzi i dopiero wtedy znika
    frame(r);
    expect(idsOnScene(r)).toEqual(['pracownik-1', 'pracownik-2']);
    expect(bodyOf(r, 1).dispose).not.toHaveBeenCalled();
    expect(until(r, () => !members(r).some((m) => m.id === 1))).toBe(true);
    frame(r);
    expect(idsOnScene(r)).toEqual(['pracownik-2']);
    expect(bodyOf(r, 1).dispose).toHaveBeenCalledTimes(1);
    expect(bodyOf(r, 1).character.object.parent).toBeNull();
    expect(r.blobs.mesh.count).toBe(2);
    expect(r.staff.size).toBe(1);

    r.staff.sync(input([]));                              // koniec zmiany: wszyscy wychodzą
    expect(until(r, () => members(r).length === 0)).toBe(true);
    frame(r);
    expect(r.staff.size).toBe(0);
    expect(bodyOf(r, 2).dispose).toHaveBeenCalledTimes(1);
    expect(r.parent.children).toHaveLength(1);            // został kasjer (ukryty, ale nie zwolniony)
    expect(r.blobs.mesh.count).toBe(1);                   // i jego miejsce w plamach
  });

  it('rezerwacje plam są zbilansowane: pojemność wraca do tłumu po zwolnieniu ciała i po dispose', () => {
    const r = rig({ blobCapacity: 3 });                   // kasjer + dwóch pracowników zajmują wszystko
    r.staff.sync(input(crowd(3)));
    frame(r);
    expect(r.blobs.mesh.count).toBe(3);
    expect(r.blobs.reserve()).toBeNull();
    r.staff.sync(input([{ id: 0, task: 'kasa' }, { id: 1, task: 'rozladunek' }]));
    expect(until(r, () => !members(r).some((m) => m.id === 2))).toBe(true);
    frame(r);
    const [again, tooMany] = [r.blobs.reserve(), r.blobs.reserve()];
    expect(again).not.toBeNull();                         // miejsce po zwolnionym wróciło
    expect(tooMany).toBeNull();                           // i jest tylko jedno
    again!.release();
    r.staff.dispose();
    expect(r.blobs.mesh.count).toBe(1);                   // zostaje kasjer
    const free = [r.blobs.reserve(), r.blobs.reserve(), r.blobs.reserve()];
    expect(free.map((slot) => slot !== null)).toEqual([true, true, false]);   // reszta pojemności wróciła
  });

  it('gdy plamy się skończyły, pracownik i tak powstaje (bez plamy), a nie psuje reszty', () => {
    const r = rig({ blobCapacity: 2 });                   // kasjer + jedna plama
    r.staff.sync(input(crowd(3)));
    expect(() => frame(r)).not.toThrow();
    expect(r.staff.size).toBe(2);
    expect(r.blobs.mesh.count).toBe(2);
  });

  it('fabryka rzuca przy budowie jednej osoby: błąd w konsoli raz na osobę, reszta powstaje, klatka się nie wywraca, brak ponownych prób', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = rig({ failSeed: (seed) => seed === 'pracownik-2' });
    r.staff.sync(input(crowd(4)));
    expect(() => { for (let i = 0; i < 10; i++) frame(r); }).not.toThrow();
    expect(idsOnScene(r)).toEqual(['pracownik-1', 'pracownik-3']);
    expect(r.staff.size).toBe(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('2');
    expect(r.attempts.get('pracownik-2')).toBe(1);
    expect(r.blobs.mesh.count).toBe(3);                   // kasjer i dwaj pracownicy; nieudany niczego nie zarezerwował

    r.staff.sync(input(crowd(4).filter((p) => p.id !== 2)));   // znika z załogi: przy kolejnym wejściu to nowa próba
    expect(until(r, () => !members(r).some((m) => m.id === 2))).toBe(true);
    frame(r);
    r.staff.sync(input(crowd(4)));
    frame(r);
    expect(r.attempts.get('pracownik-2')).toBe(2);
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe('StaffView: ruch, obrót i klip', () => {
  /** Dwie osoby, druga (id 1) dochodzi z chodnika. */
  function arrivals(): Rig {
    const r = rig();
    r.staff.sync(input([]));
    r.staff.sync(input([{ id: 0, task: 'kasa' }, { id: 1, task: 'rozladunek' }]));
    return r;
  }
  const walkScale = walkTimeScale(1.15, STAFF_WALK_SPEED * CELL_SIZE_M, 0.9 * 1.2);

  it('postać stoi tam, gdzie walker (środek kratki = indeks + 0.5), na podłodze, w każdej klatce marszu', () => {
    const r = arrivals();
    frame(r);
    const o = bodyOf(r, 1).character.object;
    let moved = 0;
    const start = { x: o.position.x, z: o.position.z };
    for (let i = 0; i < 60; i++) {
      const w = worldOf(member(r, 1));
      expect(o.position.x).toBeCloseTo(w.x, 12);
      expect(o.position.z).toBeCloseTo(w.z, 12);
      expect(o.position.y).toBe(0);
      if (member(r, 1).walker.moving) moved++;
      frame(r);
    }
    expect(moved).toBeGreaterThan(10);
    expect(Math.hypot(o.position.x - start.x, o.position.z - start.z)).toBeGreaterThan(1);   // naprawdę poszedł
  });

  it('obrót: zaczyna od kierunku walkera, potem doganie go tak jak turnTowards (≤ TURN_RATE_MAX), najkrótszą drogą', () => {
    const r = arrivals();
    frame(r);
    const o = bodyOf(r, 1).character.object;
    expect(o.rotation.y).toBeCloseTo(headingToYaw(member(r, 1).walker.heading), 12);
    let expected = o.rotation.y;
    let turning = 0;
    for (let i = 0; i < 400; i++) {
      r.staff.update(DT, DT, null);                      // crew.step(DT) i ciała w jednym wywołaniu
      const target = headingToYaw(member(r, 1).walker.heading);
      if (angleDiff(expected, target) > 0.01) turning++;
      expected = turnTowards(expected, target, DT);
      expect(o.rotation.y).toBeCloseTo(expected, 12);
    }
    expect(turning).toBeGreaterThan(0);                  // trasa ma zakręty, więc obrót naprawdę był doganiany
    expect(member(r, 1).walker.atGoal).toBe(true);
    expect(angleDiff(facingOf(o), member(r, 1).walker.heading)).toBeLessThan(1e-3);   // stoi na miejscu i patrzy zgodnie z zadaniem
  });

  it('klip: marsz włącza walk od razu z tempem walkTimeScale (animDt × mnożnik), postój wraca do idle po IDLE_DELAY_S', () => {
    const r = arrivals();
    frame(r);
    const { setAnim, update } = bodyOf(r, 1);
    expect(member(r, 1).walker.moving).toBe(true);
    expect(setAnim).toHaveBeenCalledTimes(1);
    expect(setAnim).toHaveBeenLastCalledWith('walk');
    expect(update).toHaveBeenLastCalledWith(DT * walkScale);
    r.staff.update(DT, 0.02, null);                       // czas animacji osobno od czasu ramki
    expect(update).toHaveBeenLastCalledWith(0.02 * walkScale);

    expect(until(r, () => !member(r, 1).walker.moving)).toBe(true);
    frame(r);
    expect(setAnim).toHaveBeenCalledTimes(1);             // chwilowy postój nie miga animacją
    for (let t = 0; t < IDLE_DELAY_S + 2 * DT; t += DT) frame(r);
    expect(setAnim).toHaveBeenCalledTimes(2);
    expect(setAnim).toHaveBeenLastCalledWith('idle');
    expect(update).toHaveBeenLastCalledWith(DT);          // Idle gra w tempie 1
  });

  it('pauza (dt = 0): nikt się nie rusza ani nie obraca, a animacja dostaje swoje animDt', () => {
    const r = arrivals();
    for (let i = 0; i < 10; i++) frame(r);
    expect(member(r, 1).walker.moving).toBe(true);        // jeszcze idzie: klip chodu gra w tempie walkScale
    const o = bodyOf(r, 1).character.object;
    const before = { x: o.position.x, z: o.position.z, yaw: o.rotation.y, clock: r.staff.crew.clock };
    r.staff.update(0, 0.05, customer(0, 3));
    expect([o.position.x, o.position.z, o.rotation.y, r.staff.crew.clock]).toEqual([before.x, before.z, before.yaw, before.clock]);
    expect(bodyOf(r, 1).update).toHaveBeenLastCalledWith(0.05 * walkScale);
  });

  it('plamy pracowników podążają za postaciami (pod stopami, promienie wg tuszy), a miejsca zostają przy ich właścicielach', () => {
    const r = arrivals();
    frame(r);
    const o = bodyOf(r, 1).character.object;
    const [rx, rz] = characterBlobRadii(o);
    const first = blobAt(r.blobs, 1);                     // miejsce 0 ma kasjer, 1 pierwszy pracownik
    let travelled = 0;
    for (let i = 0; i < 60; i++) {
      frame(r);
      const b = blobAt(r.blobs, 1);
      expect([b.x, b.y, b.z]).toEqual([expect.closeTo(o.position.x, 4), expect.closeTo(BLOB_Y, 4), expect.closeTo(o.position.z, 4)]);
      expect(b.rx).toBeCloseTo(rx, 5);
      expect(b.rz).toBeCloseTo(rz, 5);
      travelled = Math.max(travelled, Math.hypot(b.x - first.x, b.z - first.z));
    }
    expect(travelled).toBeGreaterThan(1);
    expect(r.blobs.mesh.count).toBe(2);
  });

  it('stojący na kasie patrzy na obsługiwanego klienta, a bez klienta na kasę; kto stoi gdzie indziej, klienta ignoruje', () => {
    const r = rig();
    // id 0 dostaje ciało kasjera, ale ma być wolny; id 1 to jedyna osoba z kasą, więc stoi na kratce kasjera jako zwykły pracownik;
    // id 2 wykłada towar gdzie indziej.
    r.staff.sync(input([{ id: 0, task: 'wolny' }, { id: 1, task: 'kasa' }, { id: 2, task: 'wykladanie' }]));
    frame(r);
    const till = member(r, 1);
    const away = member(r, 2);
    expect(away.walker.atGoal).toBe(true);
    expect(away.walker.goal).not.toEqual(spot.cell);
    expect(till.isCashier).toBe(false);
    expect(till.walker.atGoal).toBe(true);
    expect(till.walker.goal).toEqual(spot.cell);
    const other = member(r, 0);
    expect(other.isCashier).toBe(true);

    const o = bodyOf(r, 1).character.object;
    const who = customer(0, 3);
    const toward = Math.atan2(3, 0);
    expect(angleDiff(toward, spot.heading)).toBeGreaterThan(0.3);   // klient stoi w innym kierunku niż kasa
    for (let i = 0; i < 90; i++) frame(r, who);
    expect(angleDiff(facingOf(o), toward)).toBeLessThan(1e-3);
    expect(angleDiff(facingOf(bodyOf(r, 2).character.object), away.walker.heading)).toBeLessThan(1e-3);   // kto stoi gdzie indziej, klienta nie widzi
    expect(angleDiff(facingOf(r.cashier!.character!.object), other.walker.heading)).toBeLessThan(1e-3);   // wolny kasjer idzie swoim torem
    for (let i = 0; i < 90; i++) frame(r, null);
    expect(angleDiff(facingOf(o), spot.heading)).toBeLessThan(1e-3);
    // klient w samej kratce osoby nie ma kierunku: zostaje spojrzenie na kasę
    for (let i = 0; i < 30; i++) frame(r, customer(0, 0));
    expect(Number.isFinite(o.rotation.y)).toBe(true);
    expect(angleDiff(facingOf(o), spot.heading)).toBeLessThan(1e-3);
  });

  it('obrót do klienta nie szybszy niż TURN_RATE_MAX (wspólne wygładzanie z tłumem i kasjerem)', () => {
    const r = rig();
    r.staff.sync(input([{ id: 0, task: 'wolny' }, { id: 1, task: 'kasa' }]));
    frame(r);
    const o = bodyOf(r, 1).character.object;
    const start = o.rotation.y;
    let prev = start;
    for (let i = 0; i < 6; i++) {
      frame(r, customer(0, 3), 1 / 60);
      expect(Math.abs(o.rotation.y - prev)).toBeLessThanOrEqual(10 / 60 + 1e-9);
      prev = o.rotation.y;
    }
    expect(Math.abs(prev - start)).toBeGreaterThan(0.01);                   // obraca się
    expect(angleDiff(facingOf(o), Math.atan2(3, 0))).toBeGreaterThan(1e-3);   // ale po sześciu krótkich klatkach jeszcze nie skończył
  });
});

describe('StaffView: most do CashierView', () => {
  it('kasjer w marszu dostaje setPose z pozycją walkera, a po dojściu na kasę setPose(null); postać kasjera idzie z walkerem', () => {
    const r = rig();
    r.staff.sync(input([]));
    r.staff.sync(input([{ id: 0, task: 'kasa' }]));       // jedyna osoba to kasjer: wchodzi z chodnika
    frame(r);
    const m = member(r, 0);
    expect(m.isCashier).toBe(true);
    expect(m.walker.moving).toBe(true);
    expect(r.poses[r.poses.length - 1]).toEqual({ x: m.walker.x, y: m.walker.y, heading: m.walker.heading, moving: true });
    const o = r.cashier!.character!.object;
    let walked = 0;
    while (!m.walker.atGoal && walked < 60 * 16) {
      const w = worldOf(m);
      expect(o.position.x).toBeCloseTo(w.x, 12);          // CashierView.update korzysta z pozy z tej samej klatki
      expect(o.position.z).toBeCloseTo(w.z, 12);
      expect(r.poses[r.poses.length - 1]).toEqual({ x: m.walker.x, y: m.walker.y, heading: m.walker.heading, moving: m.walker.moving });
      frame(r);
      walked++;
    }
    expect(m.walker.atGoal).toBe(true);
    expect(walked).toBeGreaterThan(20);
    expect(m.walker.goal).toEqual(spot.cell);
    frame(r);
    expect(r.poses[r.poses.length - 1]).toBeNull();       // stoi za ladą: CashierView sam obsługuje klienta
    for (let i = 0; i < 10; i++) frame(r);
    expect(o.position.x).toBeCloseTo(home.x, 12);
    expect(o.position.z).toBeCloseTo(home.z, 12);
    const firstNull = r.poses.indexOf(null);
    expect(firstNull).toBeGreaterThan(20);                // wcześniej cały czas z pozą
    expect(r.poses.slice(firstNull).every((p) => p === null)).toBe(true);   // a od dojścia już tylko null
  });

  it('kasjer na kasie od startu gry (pierwszy sync) dostaje null, nie pozę, i jest widoczny', () => {
    const r = rig();
    r.staff.sync(input([{ id: 0, task: 'kasa' }]));
    frame(r);
    expect(member(r, 0).walker.atGoal).toBe(true);
    expect(r.poses).toEqual([null]);
    expect(r.visibility).toEqual([true]);
    expect(r.cashier!.character!.object.visible).toBe(true);
    const customerAt = customer(0, 3);
    for (let i = 0; i < 90; i++) frame(r, customerAt);    // i patrzy na klienta jak zawsze
    expect(angleDiff(facingOf(r.cashier!.character!.object), Math.atan2(3, 0))).toBeLessThan(1e-3);
  });

  it('kasjer, który dostał nowy cel, a jeszcze stoi na środku kratki za kasą (pauza), dostaje pozę w marszu, nie null', () => {
    const r = rig();
    r.staff.sync(input([{ id: 0, task: 'kasa' }]));
    frame(r);
    expect(r.poses).toEqual([null]);
    const m = member(r, 0);
    m.walker.setGoal(layout.entrance[0]!, 0, buildStaffNav(layout, []));   // jak po zmianie zadania: nowy cel, a walker jeszcze nie ruszył
    expect(m.walker.moving).toBe(true);
    r.staff.update(0, 0, null);                           // pauza: dt = 0, więc nadal na środku kratki kasjera
    expect(m.walker.atGoal).toBe(false);
    expect(r.poses[r.poses.length - 1]).toEqual({ x: spot.cell.x + 0.5, y: spot.cell.y + 0.5, heading: m.walker.heading, moving: true });
  });

  it('kasjer, który nie ma kasy jako zadania, chodzi po sklepie jak pracownik: poza z miejsca, w którym stoi', () => {
    const r = rig();
    r.staff.sync(input([{ id: 0, task: 'wolny' }]));
    frame(r);
    const m = member(r, 0);
    expect(m.walker.atGoal).toBe(true);
    expect(m.walker.goal).not.toEqual(spot.cell);
    expect(r.poses[r.poses.length - 1]).toEqual({ x: m.walker.x, y: m.walker.y, heading: m.walker.heading, moving: false });
    const w = worldOf(m);
    expect(r.cashier!.character!.object.position.x).toBeCloseTo(w.x, 12);
    expect(r.cashier!.character!.object.position.z).toBeCloseTo(w.z, 12);
  });

  it('załoga bez kasjera ukrywa CashierView (postać, plama), a gdy kasjer jest, pokazuje go; widok nie jest zwalniany', () => {
    const r = rig();
    const o = r.cashier!.character!;
    const object = o.object;
    frame(r);                                             // ekonomia jeszcze nic nie podała (benchmark, pierwsze ~100 ms): kasjer stoi jak dawniej
    expect(object.visible).toBe(true);
    expect(r.poses).toEqual([]);
    expect(r.visibility).toEqual([]);

    r.staff.sync(input([]));                              // ekonomia mówi, że nikogo nie ma na zmianie
    frame(r);
    expect(object.visible).toBe(false);
    expect(blobAt(r.blobs, 0).rx).toBe(0);
    expect(r.poses).toEqual([null]);
    expect(r.blobs.mesh.count).toBe(1);                   // miejsce zostaje

    r.staff.sync(input([{ id: 0, task: 'kasa' }]));
    frame(r);
    expect(object.visible).toBe(true);
    expect(blobAt(r.blobs, 0).rx).toBeGreaterThan(0);

    r.staff.sync(input([]));                              // koniec zmiany: kasjer wychodzi z ekranu i dopiero wtedy się chowa
    frame(r);
    expect(object.visible).toBe(true);
    expect(until(r, () => members(r).length === 0)).toBe(true);
    frame(r);
    expect(object.visible).toBe(false);
    expect(r.made[0]!.dispose).not.toHaveBeenCalled();
    expect(r.cashier!.character).toBe(r.made[0]!.character);
  });

  it('układ bez kasy: most nie rzuca i nic nie powstaje po stronie kasjera', () => {
    const parts = validParts();
    const noTill = layoutFromParts({ ...parts, fixtures: parts.fixtures.filter((f) => f.kind !== 'checkout') });
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const blobs = createBlobShadows(4);
    const cashier = new CashierView(factory, noTill, parent, blobs, LOOK);
    const staff = new StaffView(factory, noTill, parent, blobs, cashier);
    staff.sync(input(crowd(3)));
    expect(() => { for (let i = 0; i < 20; i++) { staff.update(DT, DT, customer(0, 3)); cashier.update(DT, customer(0, 3), false, DT); } }).not.toThrow();
    expect(made.map((m) => m.seed)).toEqual(['pracownik-1', 'pracownik-2']);   // kasjera nie ma, ale reszta stoi
    staff.dispose();
    cashier.dispose();
    expect(blobs.mesh.count).toBe(0);
  });
});

describe('StaffView: cienie z mapy cieni', () => {
  const castOf = (m: Made): boolean[] => {
    const out: boolean[] = [];
    m.character.object.traverse((o) => { if ((o as Mesh).isMesh) out.push(o.castShadow); });
    return out;
  };

  it('setCharacterShadows wyłącza i włącza cień istniejącym i przyszłym ciałom (preset: cień tylko na wysokiej), nie ruszając kasjera', () => {
    const r = rig();
    r.staff.sync(input(crowd(3)));
    frame(r);
    expect(castOf(bodyOf(r, 1))).toEqual([true]);
    r.staff.setCharacterShadows(false);
    expect(castOf(bodyOf(r, 1))).toEqual([false]);
    expect(castOf(bodyOf(r, 2))).toEqual([false]);
    expect(castOf(r.made[0]!)).toEqual([true]);           // kasjer ma własne setCharacterShadows
    r.staff.sync(input([...crowd(3), { id: 3, task: 'sprzatanie' }]));
    frame(r);
    expect(castOf(bodyOf(r, 3))).toEqual([false]);        // nowy rodzi się zgodnie z polityką
    r.staff.setCharacterShadows(true);
    expect([1, 2, 3].map((id) => castOf(bodyOf(r, id)))).toEqual([[true], [true], [true]]);
  });

  it('przechodzi po siatkach tylko przy zmianie polityki, nie co klatkę ani przy powtórzeniu tej samej', () => {
    const r = rig();
    r.staff.sync(input(crowd(3)));
    frame(r);
    const traverse = vi.spyOn(Object3D.prototype, 'traverse');
    const roots = (): Object3D[] => (traverse.mock.contexts as Object3D[]).filter((o) => o.parent === r.parent);   // traverse jest rekurencyjne: liczą się wejścia od postaci
    for (let i = 0; i < 20; i++) { frame(r); r.staff.setCharacterShadows(true); }
    expect(traverse).not.toHaveBeenCalled();
    r.staff.setCharacterShadows(false);
    expect(roots()).toEqual([bodyOf(r, 1).character.object, bodyOf(r, 2).character.object]);   // dwóch pracowników, bez kasjera
    const calls = traverse.mock.calls.length;
    r.staff.setCharacterShadows(false);
    expect(traverse.mock.calls.length).toBe(calls);
  });
});

describe('StaffView: dispose', () => {
  it('zwalnia wszystkie ciała i miejsca w plamach, jest idempotentne, a po nim sync i update niczego nie robią', () => {
    const r = rig();
    r.staff.sync(input(crowd(4)));
    frame(r);
    expect(r.staff.size).toBe(3);
    r.staff.dispose();
    r.staff.dispose();
    expect(r.staff.size).toBe(0);
    for (const m of employees(r)) {
      expect(m.dispose, m.seed).toHaveBeenCalledTimes(1);
      expect(m.character.object.parent, m.seed).toBeNull();
    }
    expect(r.parent.children).toEqual([r.cashier!.character!.object]);
    expect(r.blobs.mesh.count).toBe(1);                   // zostaje kasjer
    expect(r.blobs.reserve()).not.toBeNull();

    const poses = r.poses.length;
    const clock = r.staff.crew.clock;
    r.staff.sync(input(crowd(8)));
    r.staff.update(DT, DT, customer(0, 3));
    r.staff.setCharacterShadows(false);
    expect(members(r)).toHaveLength(4);                   // sync po dispose nie dotarł do załogi
    expect(r.staff.crew.clock).toBe(clock);
    expect(r.staff.size).toBe(0);
    expect(employees(r)).toHaveLength(3);
    expect(r.poses).toHaveLength(poses);                  // i nie ruszył kasjera
  });

  it('w dowolnej kolejności z CashierView.dispose: nic nie rzuca, nic nie jest zwalniane dwa razy, w plamach zostaje zero', () => {
    for (const order of ['staff-first', 'cashier-first'] as const) {
      const r = rig();
      r.staff.sync(input(crowd(3)));
      frame(r);
      const [a, b] = order === 'staff-first' ? [r.staff, r.cashier!] : [r.cashier!, r.staff];
      expect(() => { a.dispose(); b.dispose(); a.dispose(); b.dispose(); }, order).not.toThrow();
      for (const m of r.made) expect(m.dispose, `${order}: ${m.seed}`).toHaveBeenCalledTimes(1);
      expect(r.parent.children, order).toHaveLength(0);
      expect(r.blobs.mesh.count, order).toBe(0);
      expect(() => frame(r), order).not.toThrow();        // kolejne klatki po obu dispose też są bezpieczne
    }
  });

  it('dispose odstawia kasjera, którego widok prowadził (idącego za ladę, ukrytego na widoczny), jeśli ten jeszcze żyje', () => {
    const walking = rig();
    walking.staff.sync(input([{ id: 0, task: 'wolny' }]));
    frame(walking);
    const o = walking.cashier!.character!.object;
    expect(o.position.x).not.toBeCloseTo(home.x, 3);      // chodzi po sklepie, nie stoi za ladą
    walking.staff.dispose();
    expect(o.position.x).toBeCloseTo(home.x, 12);         // nikt już go nie prowadzi: wraca na swoje miejsce
    expect(o.position.z).toBeCloseTo(home.z, 12);

    const hidden = rig();
    hidden.staff.sync(input([]));
    frame(hidden);                                        // ekonomia podała pustą zmianę: kasjer schowany
    expect(hidden.cashier!.character!.object.visible).toBe(false);
    hidden.staff.dispose();
    expect(hidden.cashier!.character!.object.visible).toBe(true);
  });
});

describe('StaffView z prawdziwą fabryką postaci', () => {
  let factory: CharacterFactory;
  beforeAll(async () => { factory = await createCharacterFactory(loadFromDisk); }, 60_000);

  const skinnedIn = (root: Object3D): SkinnedMesh[] => {
    const out: SkinnedMesh[] = [];
    root.traverse((o) => { if (o instanceof SkinnedMesh) out.push(o); });
    return out;
  };
  const meshesIn = (root: Object3D): Mesh[] => {
    const out: Mesh[] = [];
    root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
    return out;
  };
  const paletteOf = (mesh: SkinnedMesh): Color[] => (mesh.material as Material).userData.palette as Color[];
  const real = (): { parent: Group; blobs: BlobShadows; cashier: CashierView; staff: StaffView } => {
    const parent = new Group();
    const blobs = createBlobShadows(16);
    const cashier = new CashierView(factory, layout, parent, blobs, LOOK);
    return { parent, blobs, cashier, staff: new StaffView(factory, layout, parent, blobs, cashier) };
  };

  for (const n of [1, 3, STAFF_VIEW_MAX]) {
    it(`załoga ${n} osób: ${n} postaci w scenie, każda to jedna SkinnedMesh (1 draw call jak klient), mundur w zieleni marki, plama na osobę`, () => {
      const { parent, blobs, cashier, staff } = real();
      staff.sync(input(crowd(n)));
      for (let i = 0; i < 5; i++) { staff.update(DT, DT, null); cashier.update(DT, null, false, DT); }
      expect(staff.size).toBe(n - 1);
      expect(parent.children).toHaveLength(n);
      expect(meshesIn(parent)).toHaveLength(n);
      for (const body of parent.children) {
        expect(skinnedIn(body)).toHaveLength(1);
        expect(meshesIn(body)).toHaveLength(1);
        expect(paletteOf(skinnedIn(body)[0]!)[REGION.top]!.getHexString()).toBe(new Color(PALETTE.brand.green).getHexString());
      }
      expect(blobs.mesh.count).toBe(n);
      staff.dispose();
      cashier.dispose();
      expect(parent.children).toHaveLength(0);
      expect(blobs.mesh.count).toBe(0);
    });
  }

  it('pracownik wchodzący z chodnika naprawdę animuje szkielet (klip chodu), a po zwolnieniu nie zostaje po nim nic', () => {
    const { parent, blobs, cashier, staff } = real();
    staff.sync(input([]));
    staff.sync(input([{ id: 0, task: 'kasa' }, { id: 1, task: 'rozladunek' }]));
    const step = (): void => { staff.update(DT, DT, null); cashier.update(DT, null, false, DT); };
    step();
    const body = parent.children.find((o) => o !== cashier.character!.object)!;
    const skinned = skinnedIn(body)[0]!;
    const boneYs = (): number[] => skinned.skeleton.bones.map((b) => b.position.y + b.rotation.x + b.rotation.z);
    const before = boneYs();
    for (let i = 0; i < 20; i++) step();
    expect(boneYs()).not.toEqual(before);
    staff.dispose();
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toBe(cashier.character!.object);
    cashier.dispose();
    expect(blobs.mesh.count).toBe(0);
  });
});

describe('StaffView: robot (eDward)', () => {
  const edward = (r: Rig): Object3D | undefined => r.parent.children.find((o) => o.name === 'eDward');
  const withEdward = (n: number, task: StaffDuty = 'wolny'): StaffAssignment[] => [...crowd(n), { id: EDWARD_ID, task }];

  it('ma własną bryłę, a postaci z fabryki nie buduje (nie ma dla niego munduru ani seeda)', () => {
    const r = rig();
    r.staff.sync(input(withEdward(3)));
    frame(r);
    expect(edward(r)).toBeDefined();
    expect(employees(r).map((m) => m.seed)).toEqual(['pracownik-1', 'pracownik-2']);
    expect(r.attempts.has(`pracownik-${EDWARD_ID}`)).toBe(false);
    expect(r.staff.size).toBe(3);                       // dwóch pracowników i eDward; kasjer ma CashierView
    expect(member(r, EDWARD_ID).isCashier).toBe(false);
    expect(member(r, 0).isCashier).toBe(true);
  });

  it('samotny eDward (noc, wczytany zapis) nie rusza kasjera i też ma bryłę', () => {
    const r = rig();
    r.staff.sync(input([{ id: EDWARD_ID, task: 'wolny' }]));
    frame(r);
    expect(edward(r)).toBeDefined();
    expect(r.poses.every((p) => p === null)).toBe(true);   // robot nie prowadzi `CashierView` (bez kasjera w załodze jest on schowany)
    expect(r.visibility.at(-1)).toBe(false);
    expect(members(r).some((m) => m.isCashier)).toBe(false);
  });

  it('stoi na swojej kratce, patrzy w kierunku marszu i ma plamę cienia o promieniu robota', () => {
    const r = rig();
    r.staff.sync(input(withEdward(1, 'wykladanie')));
    frame(r);
    const m = member(r, EDWARD_ID);
    const at = worldOf(m);
    const o = edward(r)!;
    expect(o.position.x).toBeCloseTo(at.x, 6);
    expect(o.position.z).toBeCloseTo(at.z, 6);
    const free = [...Array(r.blobs.capacity).keys()].map((i) => blobAt(r.blobs, i));
    expect(free.some((b) => Math.abs(b.x - at.x) < 1e-6 && Math.abs(b.z - at.z) < 1e-6 && b.rx < 0.5)).toBe(true);
  });

  it('chodzi: po wejściu z chodnika zmienia pozycję i dochodzi na swoje miejsce', () => {
    const r = rig();
    r.staff.sync(input(crowd(2)));                      // pierwsza synchronizacja: wszyscy stoją na miejscach
    frame(r);
    r.staff.sync(input(withEdward(2, 'wykladanie')));   // eDward dochodzi później: wchodzi z chodnika
    frame(r);
    const m = member(r, EDWARD_ID);
    const start = { ...worldOf(m) };
    expect(until(r, () => m.walker.atGoal, 40)).toBe(true);
    const end = worldOf(m);
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(1);
  });

  it('cień z mapy cieni obejmuje robota tak samo jak ludzi (tylko wysoka), także nowo zbudowanego', () => {
    const r = rig();
    r.staff.sync(input(withEdward(2)));
    r.staff.setCharacterShadows(false);
    frame(r);
    const castFlags = (o: Object3D): boolean[] => { const out: boolean[] = []; o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c.castShadow); }); return out; };
    expect(castFlags(edward(r)!).some(Boolean)).toBe(false);
    r.staff.setCharacterShadows(true);
    expect(castFlags(edward(r)!).some(Boolean)).toBe(true);
  });

  it('znika razem z załogą: zwalnia bryłę i miejsce w plamach cienia', () => {
    const r = rig();
    r.staff.sync(input(withEdward(1)));
    frame(r);
    const o = edward(r)!;
    r.staff.dispose();
    expect(o.parent).toBeNull();
    expect(r.staff.size).toBe(0);
    r.staff.dispose();                                   // kolejne wywołania nic nie robią
  });

  it('człowiek i robot mieszczą się razem w komplecie, a plamy dla wszystkich są zarezerwowane', () => {
    const r = rig({ blobCapacity: 16 });
    r.staff.sync(input([...crowd(STAFF_VIEW_MAX), { id: EDWARD_ID, task: 'wolny' }]));
    frame(r);
    expect(r.staff.size).toBe(STAFF_VIEW_MAX);          // osiem osób bez kasjera: siedmiu pracowników i eDward
  });
});
