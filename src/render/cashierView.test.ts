import { Box3, Color, Group, Matrix4, Mesh, SkinnedMesh, Vector3, type Material, type Object3D } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CASHIER_LOOK, REGULAR_OUTFITS, cashierSpot, type CashierLook } from '@/game/cashier';
import { SIM_STEP, type Agent, type Crowd } from '@/sim/crowd/crowd';
import { CELL_SIZE_M } from '@/sim/grid';
import { generateStore } from '@/sim/store/generateStore';
import { layoutFromParts, validParts } from '@/sim/store/testLayouts';
import { pickAppearance } from './characters/appearance';
import { BLOB_Y, characterBlobRadii, createBlobShadows, type BlobShadows } from './characters/blobShadows';
import { REGION } from './characters/characterMaterial';
import { createCharacterFactory, type CharacterFactory, type CharacterInstance, type OutfitOverrides } from './characters/characterFactory';
import type { OutfitFile } from './characters/modularPack';
import { loadFromDisk } from './characters/testAssets';
import { walkTimeScale } from './characters/walkSpeed';
import { CashierView, GESTURE_BOW_RAD, GESTURE_HOP_M, GESTURE_S, createCashierCharacter, isOutfitReady, type CashierPose } from './cashierView';
import { cellToWorld } from './coords';
import { CrowdView, IDLE_DELAY_S, TURN_RATE_MAX, headingToYaw, turnTowards } from './crowdView';
import { STAFF_WALK_SPEED } from './staff/walker';
import { PALETTE } from './style';

const layout = generateStore('kielbasa-42');
const spot = cashierSpot(layout)!;
const home = cellToWorld(layout, spot.cell.x, spot.cell.y);

interface Made {
  seed: string; outfit: OutfitFile; overrides: OutfitOverrides | undefined;
  character: CharacterInstance; setAnim: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>;
}

/** Obietnica rozstrzygana ręcznie: test sam decyduje, kiedy plik stroju „dochodzi”. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * Fabryka-atrapa kasjera: postać to grupa z jedną siatką (jest czym rzucać cień), wywołania zapisujemy. `built` mówi, w jakim
 * stroju faktycznie powstanie postać dla poproszonego stroju (domyślnie w tym samym; prawdziwa fabryka daje strój zwykły, gdy plik
 * stroju specjalnego się nie wczytał, albo postać zastępczą, `null`). `hasOutfit` odpowiada jak prawdziwa: strój specjalny jest
 * gotowy dopiero po rozstrzygnięciu `ensureOutfit`.
 */
function fakeFactory(
  ensure: (outfit: OutfitFile) => Promise<void> = () => Promise.resolve(),
  built: (outfit: OutfitFile) => OutfitFile | null = (outfit) => outfit,
) {
  const made: Made[] = [];
  const ready = new Set<OutfitFile>();
  const ensureOutfit = vi.fn((outfit: OutfitFile) => ensure(outfit).then(() => { ready.add(outfit); }));
  const hasOutfit = vi.fn((outfit: OutfitFile) => !outfit.startsWith('special-') || ready.has(outfit));
  const factory: CharacterFactory = {
    walkSpeedMps: 1.15,
    dispose: vi.fn(),
    create() { throw new Error('kasjer nie jest klientem'); },
    ensureOutfit,
    hasOutfit,
    createWithOutfit(seed, outfit, overrides) {
      const object = new Group();
      object.scale.set(0.9 * 1.2, 0.9, 0.9 * 1.2);   // wzrost 0,9 × model, tusza 1,2
      const body = new Mesh();
      body.castShadow = true;
      object.add(body);
      const setAnim = vi.fn();
      const update = vi.fn();
      const dispose = vi.fn(() => object.removeFromParent());
      const character: CharacterInstance = { object, outfit: built(outfit), setAnim, update, dispose, isFallback: false };
      made.push({ seed, outfit, overrides, character, setAnim, update, dispose });
      return character;
    },
  };
  return { factory, made, ensureOutfit, hasOutfit };
}

const REGULAR_LOOK: CashierLook = { outfit: 'men-suit', appearanceSeed: 'kasjer-a' };
const KING_LOOK: CashierLook = { outfit: 'special-men-king', appearanceSeed: 'kasjer-b' };
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/** Klient przy kasie: agent stojący `dy` kratek dalej w głąb sali niż kasjer (inny kierunek niż spojrzenie na kasę). */
function customer(dx: number, dy: number): Agent {
  return {
    id: 1, x: spot.cell.x + 0.5 + dx, y: spot.cell.y + 0.5 + dy, heading: 0, state: 'paying', moving: false, ghost: false,
    appearanceSeed: 'klient', speed: 2.4,
  };
}
const yawOf = (view: CashierView): number => view.character!.object.rotation.y;
/** Kierunek patrzenia postaci w siatce (rad, 0 = +x): przód to +z obiektu obrócony o yaw wokół y. */
const facingOf = (view: CashierView): number => Math.atan2(Math.cos(yawOf(view)), Math.sin(yawOf(view)));
const angleDiff = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('CashierView: miejsce i wygląd', () => {
  it('stawia jednego kasjera w grupie rodzica na kratce za kasą, twarzą w stronę kasy; seed i strój z wyglądu', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    expect(made).toHaveLength(1);
    expect(made[0]!.seed).toBe('kasjer-a');
    expect(made[0]!.outfit).toBe('men-suit');
    expect(parent.children).toEqual([made[0]!.character.object]);
    expect(view.character).toBe(made[0]!.character);
    const o = made[0]!.character.object;
    expect(o.position.x).toBeCloseTo(home.x, 12);
    expect(o.position.z).toBeCloseTo(home.z, 12);
    expect(o.position.y).toBe(0);
    expect(angleDiff(facingOf(view), spot.heading)).toBeLessThan(1e-9);   // patrzy na kasę (i klienta przy niej)
  });

  it('strój zwykły dostaje mundur w zieleni marki (nadpisanie góry), strój specjalny zostaje sobą (bez nadpisania)', async () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const regular = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    expect(made[0]!.overrides).toEqual({ top: PALETTE.brand.green });
    const special = new CashierView(factory, layout, parent, null, KING_LOOK);
    await flush();
    expect(made[1]!.outfit).toBe('special-men-king');
    expect(made[1]!.overrides).toBeUndefined();
    regular.dispose();
    special.dispose();
  });

  it('strój zwykły powstaje od razu i bez ensureOutfit; specjalny dopiero po ensureOutfit, a do tego czasu miejsce jest puste', async () => {
    const gate = deferred();
    const { factory, made, ensureOutfit } = fakeFactory(() => gate.promise);
    const parent = new Group();
    const regular = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    expect(made).toHaveLength(1);
    expect(ensureOutfit).not.toHaveBeenCalled();
    regular.dispose();

    const king = new CashierView(factory, layout, parent, null, KING_LOOK);
    expect(ensureOutfit).toHaveBeenCalledWith('special-men-king');
    expect(made).toHaveLength(1);                 // strój jeszcze się wczytuje
    expect(king.character).toBeNull();
    expect(parent.children).toHaveLength(0);
    king.update(SIM_STEP, null, true);            // klatki w trakcie wczytywania niczego nie psują
    gate.resolve();
    await flush();
    expect(made).toHaveLength(2);
    expect(parent.children).toEqual([made[1]!.character.object]);
    king.dispose();
  });

  it('układ bez kasy nie ma kasjera: nic nie powstaje, a update, setLook i dispose nie rzucają', () => {
    const { factory, made } = fakeFactory();
    const parts = validParts();
    const noTill = layoutFromParts({ ...parts, fixtures: parts.fixtures.filter((f) => f.kind !== 'checkout') });
    const parent = new Group();
    const blobs = createBlobShadows(4);
    const view = new CashierView(factory, noTill, parent, blobs, REGULAR_LOOK);
    expect(made).toHaveLength(0);
    expect(parent.children).toHaveLength(0);
    expect(view.character).toBeNull();
    view.update(SIM_STEP, null, true);
    view.setLook(KING_LOOK);
    view.setCharacterShadows(false);
    view.dispose();
    expect(blobs.mesh.count).toBe(0);
  });

  it('w sklepach z generatora kasjer stoi na kratce z cashierSpot (tuż za kasą), nigdy poza podłogą', () => {
    for (const seed of ['kasjer-widok-1', 'kasjer-widok-2', 'kasjer-widok-3', 'kasjer-widok-4']) {
      const store = generateStore(seed);
      const { factory } = fakeFactory();
      const view = new CashierView(factory, store, new Group(), null, REGULAR_LOOK);
      const at = cashierSpot(store)!.cell;
      const w = cellToWorld(store, at.x, at.y);
      expect(view.character!.object.position.x, seed).toBeCloseTo(w.x, 12);
      expect(view.character!.object.position.z, seed).toBeCloseTo(w.z, 12);
    }
  });
});

describe('CashierView: obrót do klienta, Idle i gest przy sprzedaży', () => {
  it('klient przy kasie: obraca się do niego nie szybciej niż TURN_RATE_MAX, najkrótszą drogą, a po jego odejściu wraca do kasy', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const who = customer(0, 3);                       // 3 kratki w głąb sali: 90° od spojrzenia na kasę
    const toward = Math.atan2(3, 0);
    let prev = yawOf(view);
    for (let i = 0; i < 6; i++) {
      view.update(SIM_STEP, who, false);
      expect(Math.abs(yawOf(view) - prev)).toBeLessThanOrEqual(TURN_RATE_MAX * SIM_STEP + 1e-9);
      prev = yawOf(view);
    }
    expect(angleDiff(facingOf(view), spot.heading)).toBeGreaterThan(0.3);   // naprawdę się obraca
    for (let i = 0; i < 90; i++) view.update(SIM_STEP, who, false);
    expect(angleDiff(facingOf(view), toward)).toBeLessThan(1e-3);
    for (let i = 0; i < 90; i++) view.update(SIM_STEP, null, false);
    expect(angleDiff(facingOf(view), spot.heading)).toBeLessThan(1e-3);
  });

  it('klient dokładnie w linii kasy nie obraca kasjera (tak stoją klienci w grze)', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const rest = yawOf(view);
    const ahead = Math.round(Math.cos(spot.heading)) * 2;
    for (let i = 0; i < 30; i++) view.update(SIM_STEP, customer(ahead, 0), false);
    expect(yawOf(view)).toBeCloseTo(rest, 9);
  });

  it('klient w samej kratce kasjera (odległość zero) nie ma kierunku: kasjer dalej patrzy na kasę, zamiast obrócić się ku +x', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    expect(angleDiff(spot.heading, 0), 'bez tego sklep atan2(0, 0) = 0 zgadzałby się z kierunkiem spojrzenia na kasę').toBeGreaterThan(1);
    for (let i = 0; i < 30; i++) view.update(SIM_STEP, customer(0, 0), false);
    expect(Number.isFinite(yawOf(view))).toBe(true);
    expect(angleDiff(facingOf(view), spot.heading)).toBeLessThan(1e-9);
  });

  it('przy pauzie (dt = 0) nie obraca się ani nie rusza gestem', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const yaw = yawOf(view);
    view.update(0, customer(0, 3), true, 0);
    view.update(0, customer(0, 3), false, 0);
    expect(yawOf(view)).toBe(yaw);
    expect(view.character!.object.position.y).toBe(0);
    expect(view.character!.object.rotation.x).toBe(0);
  });

  it('postać gra Idle: update dostaje czas animacji (animDt, domyślnie dt), a klipy się nie zmieniają', () => {
    const { factory, made } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    view.update(0.04, null, false);
    expect(made[0]!.update).toHaveBeenLastCalledWith(0.04);
    view.update(0.08, customer(0, 3), true, 0.02);   // obrót z dt, animacja i gest z animDt
    expect(made[0]!.update).toHaveBeenLastCalledWith(0.02);
    expect(made[0]!.setAnim).not.toHaveBeenCalled();  // idle to klip domyślny; gest jest proceduralny, bez nowych klipów
  });

  it('sprzedaż: krótki gest (ukłon i podskok) trwający do 0,4 s, który wraca do zera; bez sprzedaży nic się nie dzieje', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const o = view.character!.object;
    for (let i = 0; i < 10; i++) view.update(SIM_STEP, null, false);
    expect([o.position.y, o.rotation.x]).toEqual([0, 0]);

    expect(GESTURE_S).toBeLessThanOrEqual(0.4);
    expect(GESTURE_S).toBeGreaterThan(0.15);
    const samples: { t: number; y: number; bow: number }[] = [];
    view.update(SIM_STEP, null, true);
    samples.push({ t: SIM_STEP, y: o.position.y, bow: o.rotation.x });
    for (let i = 2; i <= 20; i++) {
      view.update(SIM_STEP, null, false);
      samples.push({ t: i * SIM_STEP, y: o.position.y, bow: o.rotation.x });
    }
    const active = samples.filter((s) => s.y > 0 || s.bow > 0);
    expect(Math.max(...samples.map((s) => s.y))).toBeGreaterThan(GESTURE_HOP_M * 0.8);
    expect(Math.max(...samples.map((s) => s.y))).toBeLessThanOrEqual(GESTURE_HOP_M + 1e-9);
    expect(Math.max(...samples.map((s) => s.bow))).toBeGreaterThan(GESTURE_BOW_RAD * 0.8);
    expect(Math.max(...samples.map((s) => s.bow))).toBeLessThanOrEqual(GESTURE_BOW_RAD + 1e-9);
    expect(samples.every((s) => s.y >= 0 && s.bow >= 0)).toBe(true);            // ukłon do przodu, podskok w górę
    expect(active[active.length - 1]!.t).toBeLessThanOrEqual(0.4 + 1e-9);        // po 0,4 s po geście nie ma śladu
    expect(active.length * SIM_STEP).toBeGreaterThan(0.2);                       // ale nie jest błyskiem
    expect([o.position.y, o.rotation.x]).toEqual([0, 0]);
    expect(Math.abs(o.rotation.y - headingToYaw(spot.heading))).toBeLessThan(1e-9);   // gest nie zmienia kierunku
  });

  it('ukłon pochyla do przodu względem kierunku patrzenia, a nie wokół osi świata (kolejność obrotów YXZ)', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const o = view.character!.object;
    view.update(SIM_STEP, null, true);
    for (let i = 0; i < 4; i++) view.update(SIM_STEP, null, false);
    o.updateMatrixWorld(true);
    const up = new Vector3(0, 1, 0).applyMatrix4(new Matrix4().extractRotation(o.matrixWorld));
    const forward = new Vector3(Math.cos(spot.heading), 0, Math.sin(spot.heading));   // kierunek patrzenia (x, z świata)
    expect(up.dot(forward)).toBeGreaterThan(0.1);   // czubek głowy przechyla się w stronę patrzenia
    expect(Math.abs(up.x * -Math.sin(spot.heading) + up.z * Math.cos(spot.heading))).toBeLessThan(1e-9);   // nie w bok
  });

  it('gest napędza czas animacji, nie czas symulacji: stoi z animDt = 0, a nowa sprzedaż zaczyna go od początku', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const o = view.character!.object;
    view.update(SIM_STEP, null, true);
    view.update(SIM_STEP, null, false);
    const y = o.position.y;
    expect(y).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) view.update(SIM_STEP, null, false, 0);
    expect(o.position.y).toBe(y);
    for (let i = 0; i < 4; i++) view.update(SIM_STEP, null, false);
    const near = o.position.y;                          // blisko szczytu
    view.update(SIM_STEP, null, true);                  // druga sprzedaż w trakcie gestu
    expect(o.position.y).toBeLessThan(near);            // zaczyna od początku
  });
});

describe('CashierView: zmiana wyglądu', () => {
  it('setLook w stroju zwykłym podmienia postać (stara zwolniona), w tym samym miejscu i z tym samym obrotem; ten sam wygląd nic nie robi', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    for (let i = 0; i < 20; i++) view.update(SIM_STEP, customer(0, 3), false);
    const yaw = yawOf(view);
    view.setLook({ ...REGULAR_LOOK });
    expect(made).toHaveLength(1);
    view.setLook({ outfit: 'women-casual', appearanceSeed: 'kasjer-c' });
    expect(made).toHaveLength(2);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(made[1]!.seed).toBe('kasjer-c');
    expect(parent.children).toEqual([made[1]!.character.object]);
    const o = made[1]!.character.object;
    expect(o.position.x).toBeCloseTo(home.x, 12);
    expect(o.position.z).toBeCloseTo(home.z, 12);
    expect(yawOf(view)).toBeCloseTo(yaw, 12);
  });

  it('strój specjalny: stara postać stoi do końca wczytywania, potem jest podmieniona; przestarzałe wczytanie nic nie stawia', async () => {
    const gates = new Map<OutfitFile, ReturnType<typeof deferred>>([['special-men-king', deferred()], ['special-women-witch', deferred()]]);
    const { factory, made } = fakeFactory((outfit) => gates.get(outfit)?.promise ?? Promise.resolve());
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    view.setLook(KING_LOOK);
    expect(parent.children).toEqual([made[0]!.character.object]);   // jeszcze stary kasjer
    view.setLook({ outfit: 'special-women-witch', appearanceSeed: 'kasjer-d' });   // zmiana zdania w trakcie wczytywania
    gates.get('special-men-king')!.resolve();                        // król dochodzi za późno: wiedźma jest nowsza
    await flush();
    expect(made.map((m) => m.outfit)).toEqual(['men-suit']);
    gates.get('special-women-witch')!.resolve();
    await flush();
    expect(made.map((m) => m.outfit)).toEqual(['men-suit', 'special-women-witch']);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toEqual([made[1]!.character.object]);
  });

  it('powrót do stroju zwykłego w trakcie wczytywania specjalnego unieważnia wczytywanie', async () => {
    const gate = deferred();
    const { factory, made } = fakeFactory(() => gate.promise);
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    view.setLook(KING_LOOK);
    view.setLook({ outfit: 'women-casual', appearanceSeed: 'kasjer-e' });
    gate.resolve();
    await flush();
    expect(made.map((m) => m.outfit)).toEqual(['men-suit', 'women-casual']);
    expect(parent.children).toHaveLength(1);
  });

  it('wczytywanie, które zawiodło (obietnica odrzucona), nie zostawia pustego miejsca: kasjer powstaje, a fabryka dobiera strój zastępczy', async () => {
    const { factory, made } = fakeFactory(() => Promise.reject(new Error('404')));
    const parent = new Group();
    new CashierView(factory, layout, parent, null, KING_LOOK);
    await flush();
    expect(made).toHaveLength(1);
    expect(parent.children).toHaveLength(1);
  });

  it('zmiana seeda i remont nie dublują kasjera: kolejne widoki po dispose zostawiają w grupie dokładnie jednego', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    let view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    for (const seed of ['inny-sklep-1', 'inny-sklep-2', 'kielbasa-42']) {
      view.dispose();
      expect(parent.children).toHaveLength(0);
      view = new CashierView(factory, generateStore(seed), parent, null, REGULAR_LOOK);
      expect(parent.children).toHaveLength(1);
    }
    expect(made).toHaveLength(4);
    expect(made.filter((m) => m.dispose.mock.calls.length === 0)).toHaveLength(1);
  });
});

describe('CashierView: wczytanie stroju, które zawodzi albo rzuca', () => {
  it('wyjątek przy budowie kasjera po wczytaniu stroju specjalnego nie ucieka z obietnicy: jest błąd w konsoli, a widok żyje dalej', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { factory, made } = fakeFactory();
    const create = factory.createWithOutfit.bind(factory);
    let boom = true;
    factory.createWithOutfit = (seed, outfit, overrides) => { if (boom) throw new Error('nie da się zbudować'); return create(seed, outfit, overrides); };
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, KING_LOOK);
    await flush();                                        // gdyby wyjątek uciekł z obietnicy, vitest zgłosi nieobsłużone odrzucenie
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('kasjera');
    expect(view.character).toBeNull();
    expect(parent.children).toHaveLength(0);
    boom = false;                                         // widok nie jest zepsuty: następna zmiana wyglądu działa
    view.setLook(REGULAR_LOOK);
    expect(view.character).not.toBeNull();
    expect(made).toHaveLength(1);
    error.mockRestore();
  });
});

describe('CashierView: mundur wg stroju, który naprawdę powstał', () => {
  const UNIFORM = { top: PALETTE.brand.green };

  it('strój specjalny, którego plik się nie wczytał (fabryka dała strój zwykły): ta postać jest personelem i nosi mundur, a próba bez munduru jest zwolniona', async () => {
    const { factory, made } = fakeFactory(() => Promise.resolve(), () => 'women-punk');
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, KING_LOOK);
    await flush();
    expect(made.map((m) => m.overrides)).toEqual([undefined, UNIFORM]);   // najpierw jako specjalny (bez munduru), potem z mundurem
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(made[1]!.dispose).not.toHaveBeenCalled();
    expect(view.character).toBe(made[1]!.character);
    expect(parent.children).toEqual([made[1]!.character.object]);        // jeden kasjer w scenie
    view.dispose();
    expect(made[1]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('postać zastępcza (kapsuła, bez stroju) też jest personelem: mundur', async () => {
    const { factory, made } = fakeFactory(() => Promise.resolve(), () => null);
    const view = new CashierView(factory, layout, new Group(), null, KING_LOOK);
    await flush();
    expect(made.map((m) => m.overrides)).toEqual([undefined, UNIFORM]);
    expect(view.character).toBe(made[1]!.character);
  });

  it('odrzucone ensureOutfit też kończy się mundurem na stroju zastępczym', async () => {
    const { factory, made } = fakeFactory(() => Promise.reject(new Error('404')), () => 'men-casual-2');
    const view = new CashierView(factory, layout, new Group(), null, KING_LOOK);
    await flush();
    expect(view.character).toBe(made[made.length - 1]!.character);
    expect(made[made.length - 1]!.overrides).toEqual(UNIFORM);
  });

  it('strój specjalny, który się wczytał, zostaje sobą: jedna budowa i bez munduru; zwykły dostaje mundur od razu, też jedną budową', async () => {
    const special = fakeFactory();
    const king = new CashierView(special.factory, layout, new Group(), null, KING_LOOK);
    await flush();
    expect(special.made).toHaveLength(1);
    expect(special.made[0]!.overrides).toBeUndefined();
    expect(king.character!.outfit).toBe('special-men-king');
    const regular = fakeFactory();
    new CashierView(regular.factory, layout, new Group(), null, REGULAR_LOOK);
    expect(regular.made).toHaveLength(1);
    expect(regular.made[0]!.overrides).toEqual(UNIFORM);
  });

  it('setLook na strój specjalny z brakującym plikiem kończy jedną postacią w mundurze i bez śladu po poprzedniej', async () => {
    const { factory, made } = fakeFactory(() => Promise.resolve(), (outfit) => (outfit.startsWith('special-') ? 'men-casual-2' : outfit));
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    view.setLook(KING_LOOK);
    await flush();
    expect(parent.children).toEqual([view.character!.object]);
    expect(made[made.length - 1]!.overrides).toEqual(UNIFORM);
    expect(made.filter((m) => m.dispose.mock.calls.length === 0)).toHaveLength(1);
  });
});

describe('createCashierCharacter i isOutfitReady: ta sama reguła w sklepie i w podglądzie ekranu startowego', () => {
  const UNIFORM = { top: PALETTE.brand.green };

  it('strój zwykły: jedna budowa z mundurem w zieleni marki', () => {
    const { factory, made } = fakeFactory();
    const character = createCashierCharacter(factory, REGULAR_LOOK);
    expect(made).toHaveLength(1);
    expect(made[0]!.seed).toBe('kasjer-a');
    expect(made[0]!.outfit).toBe('men-suit');
    expect(made[0]!.overrides).toEqual(UNIFORM);
    expect(character).toBe(made[0]!.character);
  });

  it('strój specjalny, który powstał: zostaje sobą, jedna budowa, bez munduru', async () => {
    const { factory, made } = fakeFactory();
    await factory.ensureOutfit('special-men-king');
    const character = createCashierCharacter(factory, KING_LOOK);
    expect(made).toHaveLength(1);
    expect(made[0]!.overrides).toBeUndefined();
    expect(character.outfit).toBe('special-men-king');
  });

  it('strój specjalny, którego nie ma (fabryka dała zwykły albo kapsułę): ta sama postać w mundurze, a próba bez munduru jest zwolniona i zdjęta ze sceny', () => {
    for (const built of ['women-punk', null] as const) {
      const { factory, made } = fakeFactory(() => Promise.resolve(), () => built);
      const parent = new Group();
      const character = createCashierCharacter(factory, KING_LOOK);
      expect(made.map((m) => m.overrides), String(built)).toEqual([undefined, UNIFORM]);
      expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
      expect(made[0]!.character.object.parent).toBeNull();
      expect(character).toBe(made[1]!.character);
      parent.add(character.object);
      expect(parent.children).toEqual([made[1]!.character.object]);
    }
  });

  it('isOutfitReady: strój zwykły zawsze, specjalny dopiero po ensureOutfit', async () => {
    const { factory } = fakeFactory();
    for (const outfit of REGULAR_OUTFITS) expect(isOutfitReady(factory, outfit), outfit).toBe(true);
    expect(isOutfitReady(factory, 'special-women-witch')).toBe(false);
    await factory.ensureOutfit('special-women-witch');
    expect(isOutfitReady(factory, 'special-women-witch')).toBe(true);
    expect(isOutfitReady(factory, 'special-men-king')).toBe(false);
  });
});

describe('CashierView: strój już gotowy powstaje od razu (remont w klatce nie zostawia klatki bez kasjera)', () => {
  it('po ensureOutfit nowy widok z tym wyglądem ma postać natychmiast, bez ponownego ensureOutfit', async () => {
    const { factory, made, ensureOutfit } = fakeFactory();
    const first = new CashierView(factory, layout, new Group(), null, KING_LOOK);
    expect(first.character).toBeNull();                   // plik jeszcze „idzie”
    await flush();
    expect(first.character).not.toBeNull();
    first.dispose();
    ensureOutfit.mockClear();

    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, KING_LOOK);   // jak load() po remoncie
    expect(view.character).not.toBeNull();                // bez żadnego czekania
    expect(parent.children).toEqual([view.character!.object]);
    expect(made).toHaveLength(2);
    expect(ensureOutfit).not.toHaveBeenCalled();
    await flush();
    expect(made).toHaveLength(2);                         // i nic nie powstaje drugi raz
    expect(parent.children).toHaveLength(1);
  });

  it('setLook na strój gotowy podmienia postać od razu, a na niegotowy dopiero po ensureOutfit', async () => {
    const gates = new Map<OutfitFile, ReturnType<typeof deferred>>([['special-men-king', deferred()], ['special-women-witch', deferred()]]);
    const { factory, made } = fakeFactory((outfit) => gates.get(outfit)?.promise ?? Promise.resolve());
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    view.setLook(KING_LOOK);
    gates.get('special-men-king')!.resolve();
    await flush();                                        // król jest gotowy
    view.setLook(REGULAR_LOOK);
    expect(view.character!.outfit).toBe('men-suit');
    view.setLook({ outfit: 'special-men-king', appearanceSeed: 'kasjer-inny' });   // gotowy: od razu, bez await
    expect(view.character!.outfit).toBe('special-men-king');
    expect(view.character!.object.parent).toBe(parent);
    view.setLook({ outfit: 'special-women-witch', appearanceSeed: 'kasjer-d' });   // niegotowy: stary zostaje
    expect(view.character!.outfit).toBe('special-men-king');
    gates.get('special-women-witch')!.resolve();
    await flush();
    expect(view.character!.outfit).toBe('special-women-witch');
    expect(parent.children).toHaveLength(1);
    expect(made.filter((m) => m.dispose.mock.calls.length === 0)).toHaveLength(1);
  });

  it('wygląd zmieniony na gotowy strój unieważnia wczytywanie innego, które jeszcze trwa', async () => {
    const gate = deferred();
    const { factory, made } = fakeFactory((outfit) => (outfit === 'special-women-witch' ? gate.promise : Promise.resolve()));
    const view = new CashierView(factory, layout, new Group(), null, KING_LOOK);
    await flush();                                        // król gotowy
    view.setLook({ outfit: 'special-women-witch', appearanceSeed: 'kasjer-d' });   // wiedźma trwa
    view.setLook({ outfit: 'special-men-king', appearanceSeed: 'kasjer-inny' });   // wracamy do gotowego króla: od razu
    expect(view.character!.outfit).toBe('special-men-king');
    gate.resolve();
    await flush();
    expect(view.character!.outfit).toBe('special-men-king');   // spóźniona wiedźma niczego nie nadpisuje
    expect(made.filter((m) => m.outfit === 'special-women-witch')).toHaveLength(0);
  });
});

describe('CashierView: dispose, cienie i plamy', () => {
  it('dispose zwalnia postać i zdejmuje ją ze sceny; potem update i setLook nic nie robią, a drugie dispose niczego nie zwalnia drugi raz', async () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    view.dispose();
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(view.character).toBeNull();
    view.update(SIM_STEP, customer(0, 3), true);
    view.setLook(KING_LOOK);
    view.setLook({ outfit: 'women-casual', appearanceSeed: 'po-dispose' });
    await flush();
    expect(made).toHaveLength(1);
    view.dispose();
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('dispose w trakcie wczytywania stroju specjalnego: po dojściu pliku nic nie powstaje', async () => {
    const gate = deferred();
    const { factory, made } = fakeFactory(() => gate.promise);
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, KING_LOOK);
    view.dispose();
    gate.resolve();
    await flush();
    expect(made).toHaveLength(0);
    expect(parent.children).toHaveLength(0);
  });

  it('zajmuje jedno miejsce w plamach cienia (pod stopami, elipsa wg tuszy) i oddaje je w dispose', () => {
    const { factory } = fakeFactory();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, new Group(), blobs, REGULAR_LOOK);
    expect(blobs.mesh.count).toBe(1);
    const m = new Matrix4();
    blobs.mesh.getMatrixAt(0, m);
    const p = new Vector3().setFromMatrixPosition(m);
    expect([p.x, p.y, p.z]).toEqual([expect.closeTo(home.x, 5), expect.closeTo(BLOB_Y, 5), expect.closeTo(home.z, 5)]);
    const [rx, rz] = characterBlobRadii(view.character!.object);
    expect(new Vector3().setFromMatrixColumn(m, 0).length()).toBeCloseTo(rx, 5);
    expect(new Vector3().setFromMatrixColumn(m, 2).length()).toBeCloseTo(rz, 5);
    expect(blobs.reserve()).toBeNull();            // jedyne miejsce zajęte
    view.dispose();
    expect(blobs.mesh.count).toBe(0);
    expect(blobs.reserve()).not.toBeNull();        // i znów wolne
  });

  it('zmiana wyglądu zostaje przy jednym miejscu w plamach (nowe promienie, bez drugiego miejsca)', () => {
    const { factory } = fakeFactory();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, new Group(), blobs, REGULAR_LOOK);
    view.setLook({ outfit: 'women-casual', appearanceSeed: 'kasjer-c' });
    expect(blobs.mesh.count).toBe(1);
    view.dispose();
    expect(blobs.mesh.count).toBe(0);
  });

  it('plama kasjera żyje obok plam tłumu: tłum zapisuje swoje miejsca co klatkę, a dispose widoku tłumu jej nie zabiera', () => {
    const { factory } = fakeFactory();
    const blobs = createBlobShadows(8);
    const parent = new Group();
    const crowdMade: CharacterInstance[] = [];
    const crowdFactory: CharacterFactory = {
      ...factory,
      create() {
        const object = new Group();
        const character: CharacterInstance = { object, outfit: null, setAnim: vi.fn(), update: vi.fn(), dispose: vi.fn(() => object.removeFromParent()), isFallback: false };
        crowdMade.push(character);
        return character;
      },
    };
    const crowdView = new CrowdView(crowdFactory, layout, parent, blobs);
    const view = new CashierView(factory, layout, parent, blobs, REGULAR_LOOK);
    const agent = (id: number, x: number): Agent => ({ id, x, y: 8.5, heading: 0, state: 'browsing', moving: false, ghost: false, appearanceSeed: `a${id}`, speed: 2.4 });
    const crowd = { seed: 's', time: 0, agents: [agent(1, 10.5), agent(2, 12.5)] } as unknown as Crowd;
    crowdView.sync(crowd, 0, 0);
    expect(blobs.mesh.count).toBe(3);
    crowdView.sync(crowd, 0, 0);
    expect(blobs.mesh.count).toBe(3);
    crowdView.dispose();
    expect(blobs.mesh.count).toBe(1);               // tłum zniknął, kasjer został
    view.dispose();
    expect(blobs.mesh.count).toBe(0);
  });

  it('setCharacterShadows wyłącza i włącza cień z mapy dla obecnej i następnej postaci (preset: cień tylko na wysokiej)', () => {
    const { factory } = fakeFactory();
    const parent = new Group();
    const castOf = (): boolean[] => {
      const out: boolean[] = [];
      parent.traverse((o) => { if ((o as Mesh).isMesh) out.push(o.castShadow); });
      return out;
    };
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    expect(castOf()).toEqual([true]);
    view.setCharacterShadows(false);
    expect(castOf()).toEqual([false]);
    view.setLook({ outfit: 'women-casual', appearanceSeed: 'kasjer-c' });
    expect(castOf()).toEqual([false]);
    view.setCharacterShadows(true);
    expect(castOf()).toEqual([true]);
  });
});

/** Poza: `dx`, `dy` kratek od środka kratki kasjera (środek kratki = indeks + 0.5, jak `Agent.x/y`). */
const poseAt = (dx: number, dy: number, heading = 0, moving = true): CashierPose => ({ x: spot.cell.x + 0.5 + dx, y: spot.cell.y + 0.5 + dy, heading, moving });
/** Położenie i promienie plamy z miejsca `i` w siatce plam. */
function blobAt(blobs: BlobShadows, i = 0): { x: number; y: number; z: number; rx: number; rz: number } {
  const m = new Matrix4();
  blobs.mesh.getMatrixAt(i, m);
  const p = new Vector3().setFromMatrixPosition(m);
  return { x: p.x, y: p.y, z: p.z, rx: new Vector3().setFromMatrixColumn(m, 0).length(), rz: new Vector3().setFromMatrixColumn(m, 2).length() };
}

describe('CashierView: chodzenie (setPose)', () => {
  const footMps = 1.15;
  const walkScale = walkTimeScale(footMps, STAFF_WALK_SPEED * CELL_SIZE_M, 0.9 * 1.2);

  it('poza przesuwa postać na jej pozycję (środek kratki = indeks + 0.5, także między kratkami), na podłodze, bez drugiej postaci', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    const o = view.character!.object;
    view.setPose(poseAt(3, 2, 0.4));
    view.update(SIM_STEP, null, false);
    const w = cellToWorld(layout, spot.cell.x + 3, spot.cell.y + 2);
    expect(o.position.x).toBeCloseTo(w.x, 12);
    expect(o.position.z).toBeCloseTo(w.z, 12);
    expect(o.position.y).toBe(0);
    view.setPose(poseAt(3.25, 2.75));
    view.update(SIM_STEP, null, false);
    const between = cellToWorld(layout, spot.cell.x + 3.25, spot.cell.y + 2.75);
    expect(o.position.x).toBeCloseTo(between.x, 12);
    expect(o.position.z).toBeCloseTo(between.z, 12);
    expect(made).toHaveLength(1);
    expect(parent.children).toEqual([o]);
    view.setPose(poseAt(0, 0));                                       // środek jego własnej kratki to dokładnie miejsce za ladą
    view.update(SIM_STEP, null, false);
    expect(o.position.x).toBeCloseTo(home.x, 12);
    expect(o.position.z).toBeCloseTo(home.z, 12);
  });

  it('poza jest kopiowana: zmiana obiektu przez wołającego po setPose niczego nie przestawia, a kolejne setPose bierze nowe wartości', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const o = view.character!.object;
    const pose = poseAt(3, 0);
    view.setPose(pose);
    pose.x += 10;
    pose.moving = false;
    view.update(SIM_STEP, null, false);
    expect(o.position.x).toBeCloseTo(cellToWorld(layout, spot.cell.x + 3, spot.cell.y).x, 12);
    view.setPose(pose);
    view.update(SIM_STEP, null, false);
    expect(o.position.x).toBeCloseTo(cellToWorld(layout, spot.cell.x + 13, spot.cell.y).x, 12);
  });

  it('obrót z pozy doganiany przez turnTowards: w jednej klatce tyle co turnTowards (≤ TURN_RATE_MAX), najkrótszą drogą, aż do heading', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const heading = spot.heading + Math.PI * 0.9;                     // prawie zawrót
    view.setPose(poseAt(2, 1, heading));
    let prev = yawOf(view);
    const expected = turnTowards(prev, headingToYaw(heading), SIM_STEP);
    view.update(SIM_STEP, null, false);
    expect(yawOf(view)).toBeCloseTo(expected, 12);
    expect(Math.abs(yawOf(view) - prev)).toBeGreaterThan(0.01);       // naprawdę się obraca
    prev = yawOf(view);
    for (let i = 0; i < 8; i++) {
      view.update(SIM_STEP, null, false);
      expect(Math.abs(yawOf(view) - prev)).toBeLessThanOrEqual(TURN_RATE_MAX * SIM_STEP + 1e-9);
      prev = yawOf(view);
    }
    expect(angleDiff(facingOf(view), heading)).toBeGreaterThan(0.05);  // zawrót nie jest natychmiastowy
    for (let i = 0; i < 120; i++) view.update(SIM_STEP, null, false);
    expect(angleDiff(facingOf(view), heading)).toBeLessThan(1e-3);
    view.update(0, null, false, 0);                                    // pauza: nie obraca
    const frozen = yawOf(view);
    view.setPose(poseAt(2, 1, heading + 1));
    view.update(0, null, false, 0);
    expect(yawOf(view)).toBe(frozen);
  });

  it('klient przy kasie nie obraca chodzącego kasjera: patrzy tam, dokąd idzie', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    view.setPose(poseAt(2, 0, 0));
    for (let i = 0; i < 90; i++) view.update(SIM_STEP, customer(0, 3), false);
    expect(angleDiff(facingOf(view), 0)).toBeLessThan(1e-3);
  });

  it('w marszu nie ma gestu ani ukłonu: sprzedaż nic nie zaczyna, a gest zaczęty przed marszem nie wraca po nim', () => {
    const { factory } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const o = view.character!.object;
    view.update(SIM_STEP, null, true);
    view.update(SIM_STEP, null, false);
    expect(o.position.y).toBeGreaterThan(0);                           // gest trwa
    expect(o.rotation.x).toBeGreaterThan(0);
    view.setPose(poseAt(3, 0));
    for (let i = 0; i < 20; i++) {
      view.update(SIM_STEP, null, i % 3 === 0);                        // sprzedaże w trakcie marszu
      expect([o.position.y, o.rotation.x]).toEqual([0, 0]);
    }
    view.setPose(null);
    for (let i = 0; i < 20; i++) {
      view.update(SIM_STEP, null, false);
      expect([o.position.y, o.rotation.x]).toEqual([0, 0]);            // przerwany gest nie wznawia się za ladą
    }
    view.update(SIM_STEP, null, true);                                 // a nowa sprzedaż znów robi gest
    expect(o.position.y).toBeGreaterThan(0);
  });

  it('klip: ruch z pozy włącza walk od razu, z tempem walkTimeScale (animDt × mnożnik); stanie z pozy wraca do idle po IDLE_DELAY_S', () => {
    const { factory, made } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    view.setPose(poseAt(3, 0, 0, true));
    view.update(0.04, null, false);
    expect(made[0]!.setAnim).toHaveBeenCalledTimes(1);
    expect(made[0]!.setAnim).toHaveBeenLastCalledWith('walk');
    expect(made[0]!.update).toHaveBeenLastCalledWith(0.04 * walkScale);
    view.update(0.08, null, false, 0.02);                              // czas animacji osobno od czasu ramki
    expect(made[0]!.update).toHaveBeenLastCalledWith(0.02 * walkScale);

    view.setPose(poseAt(3, 0, 0, false));                              // doszedł: stoi na miejscu
    view.update(IDLE_DELAY_S / 3, null, false);
    expect(made[0]!.setAnim).toHaveBeenCalledTimes(1);                 // chwilowy postój nie miga animacją
    view.update(IDLE_DELAY_S, null, false);
    expect(made[0]!.setAnim).toHaveBeenCalledTimes(2);
    expect(made[0]!.setAnim).toHaveBeenLastCalledWith('idle');
    view.update(0.04, null, false);
    expect(made[0]!.update).toHaveBeenLastCalledWith(0.04);            // Idle gra w tempie 1
  });

  it('setPose(null) wraca za ladę: pozycja na kratce kasjera, obrót do kasy i klienta, klip do Idle, gest znów działa', () => {
    const { factory, made } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const o = view.character!.object;
    view.setPose(poseAt(4, 2, 1.1));
    for (let i = 0; i < 30; i++) view.update(SIM_STEP, null, false);
    expect(made[0]!.setAnim).toHaveBeenLastCalledWith('walk');
    expect(o.position.x).not.toBeCloseTo(home.x, 3);

    view.setPose(null);
    for (let i = 0; i < 20; i++) view.update(SIM_STEP, null, false);   // 0,33 s > IDLE_DELAY_S
    expect(o.position.x).toBeCloseTo(home.x, 12);
    expect(o.position.z).toBeCloseTo(home.z, 12);
    expect(o.position.y).toBe(0);
    expect(made[0]!.setAnim).toHaveBeenLastCalledWith('idle');
    expect(made[0]!.update).toHaveBeenLastCalledWith(SIM_STEP);        // znów animDt bez mnożnika
    for (let i = 0; i < 90; i++) view.update(SIM_STEP, null, false);
    expect(angleDiff(facingOf(view), spot.heading)).toBeLessThan(1e-3);
    const who = customer(0, 3);                                         // i znów obraca się do klienta
    for (let i = 0; i < 90; i++) view.update(SIM_STEP, who, false);
    expect(angleDiff(facingOf(view), Math.atan2(3, 0))).toBeLessThan(1e-3);
  });

  it('setPose(null) bez poprzedniej pozy niczego nie rusza: postać stoi tam, gdzie stała, a gest i Idle działają jak dotąd', () => {
    const { factory, made } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const o = view.character!.object;
    o.position.x += 0.123;                                              // ktoś przestawił postać: setPose(null) jej nie wraca, bo nie było pozy
    const x = o.position.x;
    for (let i = 0; i < 5; i++) { view.setPose(null); view.update(SIM_STEP, null, false); }
    expect(o.position.x).toBe(x);
    expect(made[0]!.setAnim).not.toHaveBeenCalled();
  });

  it('plama podąża za postacią co klatkę (pod stopami, ten sam rozmiar) i wraca za ladę po setPose(null), nie tracąc miejsca', () => {
    const { factory } = fakeFactory();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, new Group(), blobs, REGULAR_LOOK);
    const [rx, rz] = characterBlobRadii(view.character!.object);
    for (const [dx, dy] of [[3, 2], [3.5, 2.25], [5, 4]] as const) {
      view.setPose(poseAt(dx, dy));
      view.update(SIM_STEP, null, false);
      const w = cellToWorld(layout, spot.cell.x + dx, spot.cell.y + dy);
      const b = blobAt(blobs);
      expect([b.x, b.y, b.z]).toEqual([expect.closeTo(w.x, 5), expect.closeTo(BLOB_Y, 5), expect.closeTo(w.z, 5)]);
      expect(b.rx).toBeCloseTo(rx, 5);
      expect(b.rz).toBeCloseTo(rz, 5);
      expect(blobs.mesh.count).toBe(1);
    }
    view.setPose(null);
    view.update(SIM_STEP, null, false);
    const b = blobAt(blobs);
    expect(b.x).toBeCloseTo(home.x, 5);
    expect(b.z).toBeCloseTo(home.z, 5);
    expect(blobs.mesh.count).toBe(1);
    expect(blobs.reserve()).toBeNull();                                 // jedyne miejsce nadal jego
  });

  it('poza przed zbudowaniem postaci (strój specjalny się wczytuje) nie przerywa żądania ani nie dubluje postaci: kasjer powstaje od razu na pozycji z pozy', async () => {
    const gate = deferred();
    const { factory, made } = fakeFactory(() => gate.promise);
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, KING_LOOK);
    view.setPose(poseAt(3, 1));
    view.update(SIM_STEP, null, false);                                 // brak postaci: nic się nie dzieje
    view.setPose(null);
    view.setPose(poseAt(3, 1));
    expect(made).toHaveLength(0);
    expect(parent.children).toHaveLength(0);
    gate.resolve();
    await flush();
    expect(made).toHaveLength(1);                                       // wczytywanie przeżyło zmiany pozy
    expect(parent.children).toEqual([made[0]!.character.object]);
    const w = cellToWorld(layout, spot.cell.x + 3, spot.cell.y + 1);
    expect(made[0]!.character.object.position.x).toBeCloseTo(w.x, 12);  // bez update: nie błyska przez chwilę za ladą
    expect(made[0]!.character.object.position.z).toBeCloseTo(w.z, 12);
    view.update(SIM_STEP, null, false);
    expect(made[0]!.setAnim).toHaveBeenLastCalledWith('walk');
  });

  it('setPose w trakcie wczytywania zmiany wyglądu: stara postać chodzi do końca, potem nowa przejmuje pozycję z pozy, a stara jest zwolniona raz', async () => {
    const gate = deferred();
    const { factory, made } = fakeFactory(() => gate.promise);
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, REGULAR_LOOK);
    view.setLook(KING_LOOK);
    view.setPose(poseAt(4, 0));
    view.update(SIM_STEP, null, false);
    view.setPose(null);
    view.setPose(poseAt(5, 1));
    gate.resolve();
    await flush();
    expect(made.map((m) => m.outfit)).toEqual(['men-suit', 'special-men-king']);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toEqual([made[1]!.character.object]);
    const w = cellToWorld(layout, spot.cell.x + 5, spot.cell.y + 1);
    expect(made[1]!.character.object.position.x).toBeCloseTo(w.x, 12);
    expect(made[1]!.character.object.position.z).toBeCloseTo(w.z, 12);
  });

  it('zmiana wyglądu w marszu: nowa postać stoi tam, gdzie kasjer idzie, z własnym klipem (zaczyna od walk), obrót zostaje, stara przestaje być animowana', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, parent, blobs, REGULAR_LOOK);
    view.setPose(poseAt(4, 1, 0.7));
    for (let i = 0; i < 12; i++) view.update(SIM_STEP, null, false);
    const yaw = yawOf(view);
    expect(made[0]!.setAnim).toHaveBeenCalledTimes(1);
    const oldUpdates = made[0]!.update.mock.calls.length;

    view.setLook({ outfit: 'women-casual', appearanceSeed: 'kasjer-c' });
    expect(made).toHaveLength(2);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toEqual([made[1]!.character.object]);
    const w = cellToWorld(layout, spot.cell.x + 4, spot.cell.y + 1);
    const o = made[1]!.character.object;
    expect(o.position.x).toBeCloseTo(w.x, 12);
    expect(o.position.z).toBeCloseTo(w.z, 12);
    expect(yawOf(view)).toBeCloseTo(yaw, 12);
    expect(blobAt(blobs).x).toBeCloseTo(w.x, 5);                        // plama od razu pod nową postacią
    expect(blobs.mesh.count).toBe(1);

    view.update(SIM_STEP, null, false);
    expect(made[1]!.setAnim).toHaveBeenCalledWith('walk');              // nowy Gait: nowa postać dostaje swój klip chodu
    expect(made[1]!.update).toHaveBeenLastCalledWith(SIM_STEP * walkScale);
    expect(made[0]!.update.mock.calls.length).toBe(oldUpdates);         // stara już nie jest animowana
  });

  it('zmiana wyglądu bez pozy tworzy nowy Gait: nowa postać gra Idle (nie dziedziczy chodu poprzedniej)', () => {
    const { factory, made } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    view.setPose(poseAt(3, 0));
    view.update(SIM_STEP, null, false);
    view.setPose(null);
    view.setLook({ outfit: 'women-casual', appearanceSeed: 'kasjer-c' });
    for (let i = 0; i < 5; i++) view.update(SIM_STEP, null, false);
    expect(made[1]!.setAnim).not.toHaveBeenCalled();
    expect(made[1]!.update).toHaveBeenLastCalledWith(SIM_STEP);
  });
});

describe('CashierView: poza zmianą (setVisible)', () => {
  it('setVisible(false) chowa postać i plamę (zerowy promień), niczego nie zwalniając; true przywraca jedno i drugie', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, parent, blobs, REGULAR_LOOK);
    const o = view.character!.object;
    const [rx, rz] = characterBlobRadii(o);
    expect(o.visible).toBe(true);

    view.setVisible(false);
    expect(o.visible).toBe(false);
    const hidden = blobAt(blobs);
    expect([hidden.rx, hidden.rz]).toEqual([0, 0]);
    expect(blobs.mesh.count).toBe(1);                                   // miejsce nadal zajęte
    expect(made[0]!.dispose).not.toHaveBeenCalled();
    expect(parent.children).toEqual([o]);
    expect(view.character).toBe(made[0]!.character);
    expect(blobs.reserve()).toBeNull();

    view.setVisible(false);                                             // powtórzone nic nie psuje
    view.setVisible(true);
    expect(o.visible).toBe(true);
    const shown = blobAt(blobs);
    expect([shown.x, shown.z]).toEqual([expect.closeTo(home.x, 5), expect.closeTo(home.z, 5)]);
    expect(shown.rx).toBeCloseTo(rx, 5);
    expect(shown.rz).toBeCloseTo(rz, 5);
    expect(made).toHaveLength(1);
  });

  it('ukryty kasjer nie jest animowany ani przestawiany, a po pokazaniu znów pracuje', () => {
    const { factory, made } = fakeFactory();
    const view = new CashierView(factory, layout, new Group(), null, REGULAR_LOOK);
    const o = view.character!.object;
    view.update(SIM_STEP, null, false);
    const updates = made[0]!.update.mock.calls.length;
    view.setVisible(false);
    view.setPose(poseAt(3, 0));
    for (let i = 0; i < 10; i++) view.update(SIM_STEP, customer(0, 3), true);
    expect(made[0]!.update.mock.calls.length).toBe(updates);            // nikt go nie widzi: bez kosztu animacji
    expect(o.visible).toBe(false);
    expect(o.position.x).toBeCloseTo(home.x, 12);
    view.setVisible(true);
    view.update(SIM_STEP, null, false);
    expect(made[0]!.update.mock.calls.length).toBe(updates + 1);
    expect(o.visible).toBe(true);
    expect(o.position.x).toBeCloseTo(cellToWorld(layout, spot.cell.x + 3, spot.cell.y).x, 12);   // poza zadziałała dopiero teraz
    expect(o.position.y).toBe(0);                                       // gest z czasu ukrycia nie wrócił
  });

  it('ukrycie przed zbudowaniem postaci (strój specjalny się wczytuje) ukrywa też tę, która dopiero powstanie, razem z plamą; true ją pokazuje', async () => {
    const gate = deferred();
    const { factory, made } = fakeFactory(() => gate.promise);
    const parent = new Group();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, parent, blobs, KING_LOOK);
    view.setVisible(false);
    expect(view.character).toBeNull();
    gate.resolve();
    await flush();
    const o = made[0]!.character.object;
    expect(parent.children).toEqual([o]);
    expect(o.visible).toBe(false);
    const hidden = blobAt(blobs);
    expect([hidden.rx, hidden.rz]).toEqual([0, 0]);
    expect(blobs.mesh.count).toBe(1);

    view.setVisible(true);
    expect(o.visible).toBe(true);
    expect(blobAt(blobs).rx).toBeGreaterThan(0.1);
    view.dispose();
  });

  it('ukrycie, a potem pokazanie przed zbudowaniem postaci: powstaje widoczna', async () => {
    const gate = deferred();
    const { factory, made } = fakeFactory(() => gate.promise);
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, new Group(), blobs, KING_LOOK);
    view.setVisible(false);
    view.setVisible(true);
    gate.resolve();
    await flush();
    expect(made[0]!.character.object.visible).toBe(true);
    expect(blobAt(blobs).rx).toBeGreaterThan(0.1);
  });

  it('zmiana wyglądu zachowuje ukrycie (nowa postać i jej plama są niewidoczne), a pokazanie pokazuje nową', () => {
    const { factory, made } = fakeFactory();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, new Group(), blobs, REGULAR_LOOK);
    view.setVisible(false);
    view.setLook({ outfit: 'women-casual', appearanceSeed: 'kasjer-c' });
    expect(made).toHaveLength(2);
    const o = made[1]!.character.object;
    expect(o.visible).toBe(false);
    expect(blobAt(blobs).rx).toBe(0);
    expect(blobs.mesh.count).toBe(1);
    view.setVisible(true);
    expect(o.visible).toBe(true);
    expect(blobAt(blobs).rx).toBeGreaterThan(0.1);
  });

  it('ukryty chodzący kasjer: pokazanie stawia go na pozycji z pozy, a plama idzie za nim', () => {
    const { factory } = fakeFactory();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, new Group(), blobs, REGULAR_LOOK);
    view.setPose(poseAt(5, 2));
    view.update(SIM_STEP, null, false);
    view.setVisible(false);
    view.update(SIM_STEP, null, false);
    expect(blobAt(blobs).rx).toBe(0);                                   // update w ukryciu nie odsłania plamy
    view.setVisible(true);
    view.update(SIM_STEP, null, false);
    const w = cellToWorld(layout, spot.cell.x + 5, spot.cell.y + 2);
    expect(blobAt(blobs).x).toBeCloseTo(w.x, 5);
    expect(blobAt(blobs).rx).toBeGreaterThan(0.1);
  });

  it('dispose po pozie i ukryciu: postać zwolniona raz, plama oddana, a późniejsze setPose, setVisible i update niczego nie ożywiają ani nie rzucają', () => {
    const { factory, made } = fakeFactory();
    const parent = new Group();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, parent, blobs, REGULAR_LOOK);
    view.setPose(poseAt(3, 1));
    view.update(SIM_STEP, null, false);
    view.setVisible(false);
    view.dispose();
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(blobs.mesh.count).toBe(0);
    view.setPose(poseAt(1, 1));
    view.setVisible(true);
    view.setPose(null);
    view.update(SIM_STEP, null, true);
    view.dispose();
    expect(made).toHaveLength(1);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(blobs.mesh.count).toBe(0);
    expect(blobs.reserve()).not.toBeNull();                             // miejsce w plamach wolne i nikt go znów nie zajął
  });

  it('dispose w trakcie wczytywania po setPose i setVisible: po dojściu pliku nic nie powstaje', async () => {
    const gate = deferred();
    const { factory, made } = fakeFactory(() => gate.promise);
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, KING_LOOK);
    view.setPose(poseAt(2, 0));
    view.setVisible(false);
    view.dispose();
    gate.resolve();
    await flush();
    expect(made).toHaveLength(0);
    expect(parent.children).toHaveLength(0);
  });

  it('układ bez kasy: setPose, setVisible i update nie rzucają i nic nie powstaje', () => {
    const { factory, made } = fakeFactory();
    const parts = validParts();
    const noTill = layoutFromParts({ ...parts, fixtures: parts.fixtures.filter((f) => f.kind !== 'checkout') });
    const parent = new Group();
    const blobs = createBlobShadows(2);
    const view = new CashierView(factory, noTill, parent, blobs, REGULAR_LOOK);
    view.setPose(poseAt(1, 1));
    view.setVisible(false);
    view.update(SIM_STEP, null, true);
    view.setVisible(true);
    view.setPose(null);
    view.dispose();
    expect(made).toHaveLength(0);
    expect(parent.children).toHaveLength(0);
    expect(blobs.mesh.count).toBe(0);
  });
});

describe('CashierView z prawdziwą fabryką postaci', () => {
  const load =(log: string[]) => (url: string) => { log.push(url); return loadFromDisk(url); };
  let factory: CharacterFactory;
  const requested: string[] = [];
  beforeAll(async () => { factory = await createCharacterFactory(load(requested)); }, 60_000);

  const meshesIn = (root: Object3D): Mesh[] => {
    const out: Mesh[] = [];
    root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
    return out;
  };
  const paletteOf = (view: CashierView): Color[] => ((view.character!.object.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh).material as Material).userData.palette as Color[];

  it('kasjer w stroju zwykłym to jedna siatka (1 draw call), w zielonym mundurze, stopami na podłodze, a po dispose nie zostaje nic', () => {
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, { outfit: 'men-suit', appearanceSeed: 'kasjer-prawdziwy' });
    expect(view.character!.isFallback).toBe(false);
    expect(view.character!.outfit).toBe('men-suit');
    expect(meshesIn(parent)).toHaveLength(1);
    expect(paletteOf(view)[REGION.top].getHexString()).toBe(new Color(PALETTE.brand.green).getHexString());
    view.character!.object.updateMatrixWorld(true);
    expect(new Box3().setFromObject(meshesIn(parent)[0]!, true).min.y).toBeCloseTo(0, 1);
    for (let i = 0; i < 12; i++) view.update(SIM_STEP, null, i === 0);   // Idle, obrót i gest na prawdziwej postaci niczego nie psują
    view.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('z wyglądu zostają skóra i włosy z seeda, tylko góra jest zielona; wygląd domyślny buduje się w stroju zwykłym', () => {
    const a = pickAppearance('kasjer-mundur-widok');
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, { outfit: 'women-worker', appearanceSeed: 'kasjer-mundur-widok' });
    const palette = paletteOf(view);
    expect(palette[REGION.skin].getHexString()).toBe(new Color(a.skin).getHexString());
    expect(palette[REGION.hair].getHexString()).toBe(new Color(a.hair).getHexString());
    expect(palette[REGION.top].getHexString()).toBe(new Color(PALETTE.brand.green).getHexString());
    view.dispose();
    const standard = new CashierView(factory, layout, parent, null, DEFAULT_CASHIER_LOOK);
    expect(standard.character!.outfit).toBe(DEFAULT_CASHIER_LOOK.outfit);
    expect(paletteOf(standard)[REGION.top].getHexString()).toBe(new Color(PALETTE.brand.green).getHexString());
    standard.dispose();
  });

  it('strój specjalny: pobierany dopiero przy tworzeniu kasjera (tylko ten jeden plik), kolor góry zostaje z wyglądu, nie z munduru', async () => {
    expect(requested.some((url) => url.includes('special-'))).toBe(false);   // start nic specjalnego nie ściągnął
    const parent = new Group();
    const view = new CashierView(factory, layout, parent, null, { outfit: 'special-men-king', appearanceSeed: 'kasjer-krol' });
    await vi.waitFor(() => expect(view.character).not.toBeNull(), { timeout: 20_000 });
    expect(requested.filter((url) => url.includes('special-'))).toEqual(['/assets/characters/special-men-king.glb']);
    expect(view.character!.outfit).toBe('special-men-king');
    expect(meshesIn(parent)).toHaveLength(1);
    expect(paletteOf(view)[REGION.top].getHexString()).toBe(new Color(pickAppearance('kasjer-krol').top).getHexString());
    expect(paletteOf(view)[REGION.top].getHexString()).not.toBe(new Color(PALETTE.brand.green).getHexString());
    view.dispose();
  }, 60_000);

  it('prawdziwy kasjer chodzi i da się go ukryć: nadal jedna siatka (1 draw call), stopy na podłodze, klip chodu faktycznie rusza kośćmi, a po dispose nie zostaje nic', () => {
    const parent = new Group();
    const blobs = createBlobShadows(1);
    const view = new CashierView(factory, layout, parent, blobs, { outfit: 'men-suit', appearanceSeed: 'kasjer-spacer' });
    const skinned = view.character!.object.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh;
    const boneYs = (): number[] => skinned.skeleton.bones.map((b) => b.position.y + b.rotation.x + b.rotation.z);
    view.setPose(poseAt(4, 2, 0.5));
    view.update(SIM_STEP, null, false);
    view.character!.object.updateMatrixWorld(true);
    expect(meshesIn(parent)).toHaveLength(1);
    const w = cellToWorld(layout, spot.cell.x + 4, spot.cell.y + 2);
    expect(view.character!.object.position.x).toBeCloseTo(w.x, 12);
    expect(new Box3().setFromObject(meshesIn(parent)[0]!, true).min.y).toBeCloseTo(0, 1);
    const before = boneYs();
    for (let i = 0; i < 20; i++) view.update(SIM_STEP, null, false);        // 0,33 s chodu
    expect(boneYs()).not.toEqual(before);                                   // animacja idzie
    view.setVisible(false);
    expect(view.character!.object.visible).toBe(false);
    expect(blobs.mesh.count).toBe(1);
    view.setVisible(true);
    view.setPose(null);
    for (let i = 0; i < 20; i++) view.update(SIM_STEP, null, i === 0);      // wraca za ladę, Idle i gest na prawdziwej postaci niczego nie psują
    expect(view.character!.object.position.x).toBeCloseTo(home.x, 12);
    view.dispose();
    expect(parent.children).toHaveLength(0);
    expect(blobs.mesh.count).toBe(0);
  });
});
