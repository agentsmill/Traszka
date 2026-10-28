import { Group, Mesh, type Object3D } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CashierLook } from '@/game/cashier';
import type { CharacterFactory, CharacterInstance, OutfitOverrides } from '@/render/characters/characterFactory';
import type { OutfitFile } from '@/render/characters/modularPack';
import { PALETTE } from '@/render/style';
import { DRAG_RAD_PER_PX, RESUME_SPIN_AFTER_MS, SPIN_RAD_S, cameraDistance, createStartPreview, type PreviewRenderer } from './preview';

const REGULAR: CashierLook = { outfit: 'men-suit', appearanceSeed: 'kasjer-a' };
const KING: CashierLook = { outfit: 'special-men-king', appearanceSeed: 'kasjer-b' };
const WITCH: CashierLook = { outfit: 'special-women-witch', appearanceSeed: 'kasjer-c' };

interface Made { seed: string; outfit: OutfitFile; overrides: OutfitOverrides | undefined; character: CharacterInstance; update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/** Fabryka-atrapa jak w teście CashierView: postać to grupa z jedną siatką; `hasOutfit` odpowiada jak prawdziwa. */
function fakeFactory(ensure: (outfit: OutfitFile) => Promise<void> = () => Promise.resolve()) {
  const made: Made[] = [];
  const ready = new Set<OutfitFile>();
  const ensureOutfit = vi.fn((outfit: OutfitFile) => ensure(outfit).then(() => { ready.add(outfit); }));
  const factory: CharacterFactory = {
    walkSpeedMps: 1.15,
    dispose: vi.fn(),
    create() { throw new Error('kasjer nie jest klientem'); },
    ensureOutfit,
    hasOutfit: (outfit) => !outfit.startsWith('special-') || ready.has(outfit),
    createWithOutfit(seed, outfit, overrides) {
      const object = new Group();
      object.add(new Mesh());
      const update = vi.fn();
      const dispose = vi.fn(() => object.removeFromParent());
      const character: CharacterInstance = { object, outfit, setAnim: vi.fn(), update, dispose, isFallback: false };
      made.push({ seed, outfit, overrides, character, update, dispose });
      return character;
    },
  };
  return { factory, made, ensureOutfit };
}

/** Renderer-atrapa: zapisuje wywołania; scena do sprawdzenia przychodzi z `render`. */
function fakeRenderer() {
  const renderer = {
    setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn(),
  } satisfies PreviewRenderer;
  return renderer;
}

/** Kanwa-atrapa: zdarzenia wskaźnika (przeciąganie) i rozmiar z CSS. */
function fakeCanvas(width = 400, height = 300) {
  const target = new EventTarget();
  return Object.assign(target, { clientWidth: width, clientHeight: height, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() }) as unknown as
    HTMLCanvasElement & { clientWidth: number; clientHeight: number };
}
const pointer = (type: string, clientX: number): Event => Object.assign(new Event(type), { clientX, pointerId: 1 });

/** Ręczne sterowanie klatkami: `step(ms)` woła zapisaną klatkę z zegarem przesuniętym o `ms`. */
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let clock: number;
const step = (ms: number): void => {
  clock += ms;
  const pending = [...frames.entries()];
  frames.clear();
  for (const [, callback] of pending) callback(clock);
};
beforeEach(() => {
  frames = new Map();
  nextFrame = 1;
  clock = 1000;
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, cb); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
  vi.stubGlobal('devicePixelRatio', 3);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const turntableOf = (renderer: ReturnType<typeof fakeRenderer>): Object3D => {
  const scene = renderer.render.mock.calls.at(-1)![0] as Object3D;
  return scene.children.find((c) => c.name === 'turntable')!;
};
const characters = (renderer: ReturnType<typeof fakeRenderer>): Object3D[] => turntableOf(renderer).children.filter((c) => c.name !== 'pedestal');

describe('cameraDistance: kadr mieści kasjera i na szerokim, i na wąskim podglądzie', () => {
  it('im węższy podgląd, tym dalej kamera (nie krócej niż dla szerokiego), a na szerokim liczy się tylko wysokość', () => {
    const wide = cameraDistance(2);
    expect(cameraDistance(3)).toBeCloseTo(wide, 9);         // wysokość rządzi: szerokość nie ogranicza
    expect(cameraDistance(1)).toBeGreaterThanOrEqual(wide);
    expect(cameraDistance(0.5)).toBeGreaterThan(cameraDistance(1));
    expect(cameraDistance(0.25)).toBeGreaterThan(cameraDistance(0.5));
  });

  it('zawsze skończona i dodatnia, także dla zerowego, ujemnego i nieskończonego stosunku boków (kanwa jeszcze bez rozmiaru)', () => {
    for (const aspect of [0, -1, NaN, Infinity, 1e-9]) {
      const d = cameraDistance(aspect);
      expect(Number.isFinite(d) && d > 0, String(aspect)).toBe(true);
    }
  });
});

describe('createStartPreview: scena i pętla klatek', () => {
  it('rysuje podest z kasjerem na własnym rendererze, dopasowuje rozmiar kanwy i gęstość pikseli (najwyżej 2×)', () => {
    const renderer = fakeRenderer();
    const { factory } = fakeFactory();
    createStartPreview(fakeCanvas(400, 300), factory, { renderer });
    step(16);
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(renderer.setSize).toHaveBeenLastCalledWith(400, 300, false);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    const scene = renderer.render.mock.calls[0]![0] as Object3D;
    expect(scene.children.some((c) => c.name === 'turntable')).toBe(true);
    expect(turntableOf(renderer).children.filter((c) => c.name === 'pedestal').length).toBeGreaterThan(0);
  });

  it('zmiana rozmiaru kanwy dopasowuje renderer, ten sam rozmiar nie robi nic, a kanwa bez rozmiaru niczego nie rysuje', () => {
    const renderer = fakeRenderer();
    const canvas = fakeCanvas(0, 0);
    createStartPreview(canvas, fakeFactory().factory, { renderer });
    step(16);
    expect(renderer.render).not.toHaveBeenCalled();
    canvas.clientWidth = 320;
    canvas.clientHeight = 240;
    step(16);
    step(16);
    expect(renderer.setSize).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    canvas.clientWidth = 600;
    step(16);
    expect(renderer.setSize).toHaveBeenLastCalledWith(600, 240, false);
  });

  it('obraca podest samoczynnie (SPIN_RAD_S) i gra Idle postaci tym samym krokiem czasu (najwyżej 0,1 s na klatkę)', () => {
    const renderer = fakeRenderer();
    const { factory, made } = fakeFactory();
    const preview = createStartPreview(fakeCanvas(), factory, { renderer });
    void preview.show(REGULAR);
    step(16);                                  // pierwsza klatka tylko startuje zegar
    const yaw0 = turntableOf(renderer).rotation.y;
    step(100);
    expect(turntableOf(renderer).rotation.y - yaw0).toBeCloseTo(SPIN_RAD_S * 0.1, 9);
    expect(made[0]!.update).toHaveBeenLastCalledWith(0.1);
    step(5000);                                // karta w tle: kroki są ograniczone, nie „skacze”
    expect(turntableOf(renderer).rotation.y - yaw0).toBeCloseTo(SPIN_RAD_S * 0.2, 9);
    expect(made[0]!.update).toHaveBeenLastCalledWith(0.1);
  });
});

describe('createStartPreview: show (strój zwykły i specjalny dociągany na żądanie)', () => {
  it('strój zwykły staje od razu i bez ensureOutfit, w mundurze w zieleni marki (ta sama reguła co w sklepie)', () => {
    const renderer = fakeRenderer();
    const { factory, made, ensureOutfit } = fakeFactory();
    const preview = createStartPreview(fakeCanvas(), factory, { renderer });
    void preview.show(REGULAR);
    step(16);
    expect(made).toHaveLength(1);
    expect(made[0]!.seed).toBe('kasjer-a');
    expect(made[0]!.outfit).toBe('men-suit');
    expect(made[0]!.overrides).toEqual({ top: PALETTE.brand.green });
    expect(ensureOutfit).not.toHaveBeenCalled();
    expect(characters(renderer)).toEqual([made[0]!.character.object]);
    expect(preview.look).toEqual(REGULAR);
  });

  it('strój specjalny niewczytany: ensureOutfit raz, do tego czasu zostaje poprzednia postać, potem nowa (bez munduru)', async () => {
    const gate = deferred();
    const renderer = fakeRenderer();
    const { factory, made, ensureOutfit } = fakeFactory(() => gate.promise);
    const preview = createStartPreview(fakeCanvas(), factory, { renderer });
    void preview.show(REGULAR);
    const done = preview.show(KING);
    step(16);
    expect(ensureOutfit).toHaveBeenCalledTimes(1);
    expect(ensureOutfit).toHaveBeenCalledWith('special-men-king');
    expect(made.map((m) => m.outfit)).toEqual(['men-suit']);                 // stary kasjer stoi
    expect(preview.look).toEqual(REGULAR);
    gate.resolve();
    await done;
    expect(made.map((m) => m.outfit)).toEqual(['men-suit', 'special-men-king']);
    expect(made[1]!.overrides).toBeUndefined();                              // strój specjalny zostaje sobą
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(characters(renderer)).toEqual([made[1]!.character.object]);
    expect(preview.look).toEqual(KING);
  });

  it('strój specjalny, który fabryka już ma, staje od razu, bez drugiego ensureOutfit', async () => {
    const renderer = fakeRenderer();
    const { factory, made, ensureOutfit } = fakeFactory();
    await factory.ensureOutfit('special-men-king');
    ensureOutfit.mockClear();
    const preview = createStartPreview(fakeCanvas(), factory, { renderer });
    void preview.show(KING);
    step(16);
    expect(made.map((m) => m.outfit)).toEqual(['special-men-king']);
    expect(ensureOutfit).not.toHaveBeenCalled();
  });

  it('późniejsze show wyprzedza wcześniejsze: spóźniony strój specjalny niczego już nie stawia', async () => {
    const gates = new Map<OutfitFile, ReturnType<typeof deferred>>([['special-men-king', deferred()], ['special-women-witch', deferred()]]);
    const renderer = fakeRenderer();
    const { factory, made } = fakeFactory((outfit) => gates.get(outfit)?.promise ?? Promise.resolve());
    const preview = createStartPreview(fakeCanvas(), factory, { renderer });
    const king = preview.show(KING);
    const witch = preview.show(WITCH);
    void preview.show(REGULAR);                       // strój zwykły stoi natychmiast
    expect(made.map((m) => m.outfit)).toEqual(['men-suit']);
    gates.get('special-men-king')!.resolve();
    gates.get('special-women-witch')!.resolve();
    await Promise.all([king, witch]);
    step(16);
    expect(made.map((m) => m.outfit)).toEqual(['men-suit']);    // żadnego króla ani wiedźmy
    expect(characters(renderer)).toHaveLength(1);
    expect(preview.look).toEqual(REGULAR);
  });

  it('ten sam wygląd drugi raz nie buduje postaci od nowa, a nowy wygląd zwalnia poprzednią (zawsze jedna na podeście)', () => {
    const renderer = fakeRenderer();
    const { factory, made } = fakeFactory();
    const preview = createStartPreview(fakeCanvas(), factory, { renderer });
    void preview.show(REGULAR);
    void preview.show({ ...REGULAR });
    expect(made).toHaveLength(1);
    void preview.show({ outfit: 'men-suit', appearanceSeed: 'kasjer-inny' });
    step(16);
    expect(made).toHaveLength(2);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(made[1]!.dispose).not.toHaveBeenCalled();
    expect(characters(renderer)).toEqual([made[1]!.character.object]);
  });

  it('look to kopia: zmiana obiektu przekazanego do show nie zmienia tego, co stoi na podeście', () => {
    const { factory } = fakeFactory();
    const preview = createStartPreview(fakeCanvas(), factory, { renderer: fakeRenderer() });
    const mine = { ...REGULAR };
    void preview.show(mine);
    mine.outfit = 'women-punk';
    expect(preview.look).toEqual(REGULAR);
    void preview.show(REGULAR);   // dalej ten sam wygląd: bez przebudowy
  });

  it('odrzucone ensureOutfit (fabryka nie powinna, ale) nie zostawia pustego podestu: kasjer powstaje (strój zastępczy fabryki)', async () => {
    const { factory, made } = fakeFactory(() => Promise.reject(new Error('404')));
    const preview = createStartPreview(fakeCanvas(), factory, { renderer: fakeRenderer() });
    await preview.show(KING);
    expect(made).toHaveLength(1);
    expect(preview.look).toEqual(KING);
  });

  it('wyjątek przy budowie postaci nie ucieka z show: błąd w konsoli, poprzedni kasjer zostaje', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const renderer = fakeRenderer();
    const { factory, made } = fakeFactory();
    const preview = createStartPreview(fakeCanvas(), factory, { renderer });
    void preview.show(REGULAR);
    const create = factory.createWithOutfit.bind(factory);
    factory.createWithOutfit = () => { throw new Error('nie da się zbudować'); };
    await expect(preview.show({ ...REGULAR, appearanceSeed: 'kasjer-x' })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('kasjera');
    expect(preview.look).toEqual(REGULAR);
    expect(made).toHaveLength(1);
    factory.createWithOutfit = create;
    await preview.show({ ...REGULAR, appearanceSeed: 'kasjer-y' });   // podgląd nie jest zepsuty
    expect(made).toHaveLength(2);
  });
});

describe('createStartPreview: przeciąganie i setYaw', () => {
  it('setYaw ustawia kąt podestu i wstrzymuje samoczynny obrót (zrzuty z przodu i z tyłu)', () => {
    const renderer = fakeRenderer();
    const preview = createStartPreview(fakeCanvas(), fakeFactory().factory, { renderer });
    step(16);
    preview.setYaw(Math.PI);
    step(1000);
    step(1000);
    expect(turntableOf(renderer).rotation.y).toBeCloseTo(Math.PI, 12);
  });

  it('przeciągnięcie obraca podest (DRAG_RAD_PER_PX), a po RESUME_SPIN_AFTER_MS samoczynny obrót wraca', () => {
    const renderer = fakeRenderer();
    const canvas = fakeCanvas();
    createStartPreview(canvas, fakeFactory().factory, { renderer });
    step(16);
    const yaw0 = turntableOf(renderer).rotation.y;
    canvas.dispatchEvent(pointer('pointerdown', 100));
    canvas.dispatchEvent(pointer('pointermove', 150));
    step(16);
    expect(turntableOf(renderer).rotation.y - yaw0).toBeCloseTo(50 * DRAG_RAD_PER_PX, 9);   // w czasie przeciągania podest stoi
    canvas.dispatchEvent(pointer('pointerup', 150));
    const held = turntableOf(renderer).rotation.y;
    step(RESUME_SPIN_AFTER_MS - 100);
    expect(turntableOf(renderer).rotation.y).toBeCloseTo(held, 9);                             // jeszcze trzyma
    step(300);
    step(100);
    expect(turntableOf(renderer).rotation.y).toBeGreaterThan(held);                            // znów się obraca
  });

  it('ruch bez wciśniętego wskaźnika niczego nie obraca', () => {
    const renderer = fakeRenderer();
    const canvas = fakeCanvas();
    createStartPreview(canvas, fakeFactory().factory, { renderer });
    step(16);
    const yaw0 = turntableOf(renderer).rotation.y;
    canvas.dispatchEvent(pointer('pointermove', 300));
    expect(turntableOf(renderer).rotation.y).toBe(yaw0);
  });
});

describe('createStartPreview: dispose zwalnia renderer przy starcie gry', () => {
  it('zwalnia postać, renderer (dispose i utrata kontekstu), zatrzymuje pętlę i zdejmuje obsługę wskaźnika', () => {
    const renderer = fakeRenderer();
    const canvas = fakeCanvas();
    const remove = vi.spyOn(canvas, 'removeEventListener');
    const { factory, made } = fakeFactory();
    const preview = createStartPreview(canvas, factory, { renderer });
    void preview.show(REGULAR);
    step(16);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    preview.dispose();
    expect(remove.mock.calls.map((c) => c[0]).sort()).toEqual(['pointercancel', 'pointerdown', 'pointermove', 'pointerup']);
    expect(made[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(made[0]!.character.object.parent).toBeNull();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
    step(16);
    step(16);
    expect(renderer.render).toHaveBeenCalledTimes(1);          // żadnej klatki po dispose
    expect(frames.size).toBe(0);
    canvas.dispatchEvent(pointer('pointerdown', 10));
    expect(canvas.setPointerCapture).not.toHaveBeenCalled();
  });

  it('jest idempotentne, a show po dispose niczego nie buduje', async () => {
    const renderer = fakeRenderer();
    const { factory, made } = fakeFactory();
    const preview = createStartPreview(fakeCanvas(), factory, { renderer });
    preview.dispose();
    preview.dispose();
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    await expect(preview.show(REGULAR)).resolves.toBeUndefined();
    expect(made).toHaveLength(0);
    preview.setYaw(1);   // nic nie rzuca
  });

  it('dispose w trakcie wczytywania stroju specjalnego: po dojściu pliku nic nie powstaje', async () => {
    const gate = deferred();
    const { factory, made } = fakeFactory(() => gate.promise);
    const preview = createStartPreview(fakeCanvas(), factory, { renderer: fakeRenderer() });
    const pending = preview.show(KING);
    preview.dispose();
    gate.resolve();
    await pending;
    await flush();
    expect(made).toHaveLength(0);
  });

  it('współdzielona fabryka zostaje: podgląd zwalnia tylko swoje (postać), nie fabrykę ani jej geometrie', () => {
    const { factory } = fakeFactory();
    const preview = createStartPreview(fakeCanvas(), factory, { renderer: fakeRenderer() });
    void preview.show(REGULAR);
    preview.dispose();
    expect(factory.dispose).not.toHaveBeenCalled();
  });
});
