import { Group, type Mesh } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEconomy, type EconomyState } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { cellKey } from '@/sim/grid';
import { generateStore } from '@/sim/store/generateStore';
import { createConveyor, createRestocker } from './machines';
import { CONVEYOR_MAX_CELLS, placeRobots } from './robotPlacement';
import { RobotsView, WORK_HOLD_S } from './robotsView';

// fabryki maszyn przepuszczają wywołania do prawdziwych (siatki powstają naprawdę), ale zapamiętują, z jakim poziomem wyglądu je wołano
vi.mock('./machines', async (importOriginal) => {
  const real = await importOriginal<typeof import('./machines')>();
  return { ...real, createConveyor: vi.fn(real.createConveyor), createRestocker: vi.fn(real.createRestocker) };
});

const SEED = 'kielbasa-42';
const layout = generateStore(SEED);
const info = computeStoreInfo(layout);
const placed = placeRobots(layout, info);

function make(): { view: RobotsView; parent: Group; s: EconomyState } {
  const parent = new Group();
  return { view: new RobotsView(layout, info, parent), parent, s: createEconomy(SEED, info) };
}
const named = (parent: Group, name: string): boolean => !!parent.getObjectByName(name);
const meshCount = (parent: Group): number => { let n = 0; parent.traverse((c) => { if ((c as Mesh).isMesh) n++; }); return n; };

describe('RobotsView', () => {
  it('bez ulepszeń warsztatu nie ma ani maszyn, ani eDwarda', () => {
    const { view, parent, s } = make();
    expect(view.sync(s)).toEqual({ edward: null });
    expect(view.machines).toBe(0);
    expect(view.obstacles).toEqual([]);
    expect(meshCount(parent)).toBe(0);
  });

  it('maszyna staje od razu przy pierwszej synchronizacji po zakupie (także po wczytaniu zapisu: stan ma poziomy od początku)', () => {
    const { view, parent, s } = make();
    s.upgrades.tasmociag = 1;
    view.sync(s);
    expect(named(parent, 'taśmociąg')).toBe(true);
    expect(named(parent, 'prasa')).toBe(false);
    s.upgrades.prasa = 1;
    s.upgrades.wykladacz = 1;
    view.sync(s);
    expect([named(parent, 'prasa'), named(parent, 'wykładacz')]).toEqual([true, true]);
    expect(view.machines).toBe(3);
  });

  it('eDward jest w odpowiedzi, dopóki jest kupiony, i ma zadanie wolny, gdy nic nie idzie do przodu', () => {
    const { view, s } = make();
    s.upgrades.humanoid = 1;
    expect(view.sync(s)).toEqual({ edward: 'wolny' });
    s.upgrades.humanoid = 0;
    expect(view.sync(s)).toEqual({ edward: null });
  });

  it('eDward bierze zadanie z postępu prac w kolejności gracza: najpierw kasa, potem wykładanie (profil Kolejka)', () => {
    const { view, s } = make();
    s.upgrades.humanoid = 1;
    view.sync(s);
    for (const c of Object.keys(s.backroom) as Array<keyof typeof s.backroom>) s.backroom[c] -= 1;
    expect(view.sync(s).edward).toBe('wykladanie');
    s.total.customers += 3;
    for (const c of Object.keys(s.backroom) as Array<keyof typeof s.backroom>) s.backroom[c] -= 1;
    expect(view.sync(s).edward).toBe('kasa');
    s.tycoon.staff.profile = 'dostawa';
    s.total.customers += 3;
    for (const c of Object.keys(s.backroom) as Array<keyof typeof s.backroom>) s.backroom[c] -= 1;
    expect(view.sync(s).edward).toBe('kasa');   // `dostawa`: rozładunek, potem kasa; rozładunku nie było
  });

  it('taśmociąg rośnie z poziomem o kratkę (3, 4, 5), ale nie ponad miejsce, a przeszkody to jego kratki i kratki prasy', () => {
    const { view, s } = make();
    s.upgrades.prasa = 1;
    for (const level of [1, 2, 3]) {
      s.upgrades.tasmociag = level;
      view.sync(s);
      const want = Math.min(placed.conveyor!.length, 2 + level);
      const expected = [...placed.conveyor!.slice(0, want), ...placed.press!].map(cellKey).sort((a, b) => a - b);
      expect(view.obstacles.map(cellKey).sort((a, b) => a - b), `poziom ${level}`).toEqual(expected);
      expect(want).toBeLessThanOrEqual(CONVEYOR_MAX_CELLS);
    }
  });

  it('zmiana poziomu stawia maszynę od nowa (stara znika ze sceny), a poziom 0 ją zdejmuje', () => {
    const { view, parent, s } = make();
    s.upgrades.wykladacz = 1;
    view.sync(s);
    const first = parent.getObjectByName('wykładacz');
    s.upgrades.wykladacz = 2;
    view.sync(s);
    const second = parent.getObjectByName('wykładacz');
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(first!.parent).toBeNull();
    s.upgrades.wykladacz = 2;
    view.sync(s);
    expect(parent.getObjectByName('wykładacz')).toBe(second);   // ten sam poziom: nic się nie przebudowuje
    s.upgrades.wykladacz = 0;
    view.sync(s);
    expect(named(parent, 'wykładacz')).toBe(false);
  });

  describe('ulepszenia 4–5 (taśmociąg i wykładacz mają po 5 poziomów, a modele po 3)', () => {
    beforeEach(() => {
      vi.mocked(createConveyor).mockClear();
      vi.mocked(createRestocker).mockClear();
    });
    /** Poziom wyglądu z ostatniego wywołania fabryki (trzeci argument obu). */
    const lookOf = (factory: typeof createConveyor | typeof createRestocker): unknown => vi.mocked(factory).mock.calls.at(-1)?.[2];

    it('taśmociąg 5 i wykładacz 5: createConveyor i createRestocker dostają poziom 3, a sync nie rzuca', () => {
      const { view, parent, s } = make();
      s.upgrades.tasmociag = 5;
      s.upgrades.wykladacz = 5;
      expect(() => view.sync(s)).not.toThrow();
      expect(lookOf(createConveyor)).toBe(3);
      expect(lookOf(createRestocker)).toBe(3);
      expect([named(parent, 'taśmociąg'), named(parent, 'wykładacz')]).toEqual([true, true]);
      for (const level of [4, 5]) {
        s.upgrades.tasmociag = level;
        s.upgrades.wykladacz = level;
        view.sync(s);
        expect([lookOf(createConveyor), lookOf(createRestocker)], `poziom ${level}`).toEqual([3, 3]);
      }
    });

    it('wygląd poziomów 4–5 równa się wyglądowi poziomu 3: taśmociąg ma te same kratki (przeszkody), a maszyny nie są stawiane od nowa', () => {
      const { view, parent, s } = make();
      s.upgrades.tasmociag = 3;
      s.upgrades.wykladacz = 3;
      view.sync(s);
      const cells = view.obstacles.map(cellKey).sort((a, b) => a - b);
      const [conveyor, restocker] = [parent.getObjectByName('taśmociąg'), parent.getObjectByName('wykładacz')];
      expect(cells.length).toBeGreaterThan(0);
      expect([vi.mocked(createConveyor).mock.calls.length, vi.mocked(createRestocker).mock.calls.length]).toEqual([1, 1]);
      for (const level of [4, 5]) {
        s.upgrades.tasmociag = level;
        s.upgrades.wykladacz = level;
        view.sync(s);
        expect(view.obstacles.map(cellKey).sort((a, b) => a - b), `poziom ${level}`).toEqual(cells);
        expect(parent.getObjectByName('taśmociąg'), `poziom ${level} taśmociąg`).toBe(conveyor);
        expect(parent.getObjectByName('wykładacz'), `poziom ${level} wykładacz`).toBe(restocker);
      }
      expect([vi.mocked(createConveyor).mock.calls.length, vi.mocked(createRestocker).mock.calls.length]).toEqual([1, 1]);
    });
  });

  it('maszyna pracuje przez WORK_HOLD_S po postępie, a potem staje', () => {
    const { view, s } = make();
    s.upgrades.prasa = 1;
    view.sync(s);
    s.tycoon.waste.backroom = 2;
    view.sync(s);
    s.tycoon.waste.backroom = 1;   // worek wyniesiony: postęp
    view.sync(s);
    const press = (view as unknown as { press: { hold: number } }).press;
    expect(press.hold).toBe(WORK_HOLD_S);
    view.update(0.5);
    expect(press.hold).toBeCloseTo(WORK_HOLD_S - 0.5, 6);
    view.update(2);
    expect(press.hold).toBe(0);
  });

  it('postęp przy zmienionym poziomie nie jest tracony: czas pracy przechodzi na nową maszynę', () => {
    const { view, s } = make();
    s.upgrades.tasmociag = 1;
    view.sync(s);
    (view as unknown as { conveyor: { hold: number } }).conveyor.hold = 0.8;
    s.upgrades.tasmociag = 2;
    view.sync(s);
    expect((view as unknown as { conveyor: { hold: number } }).conveyor.hold).toBeCloseTo(0.8, 6);
  });

  it('w układzie bez mebli do wykładania i bez miejsca na zapleczu nie rzuca i niczego nie stawia', () => {
    const bare = { ...layout, fixtures: layout.fixtures.filter((f) => f.kind !== 'gondola' && f.kind !== 'wallShelf'), cells: layout.cells.map((t) => (t === 'backroom' ? 'floor' as const : t)) };
    const parent = new Group();
    const view = new RobotsView(bare, info, parent);
    const s = createEconomy(SEED, info);
    s.upgrades.tasmociag = 3; s.upgrades.wykladacz = 3; s.upgrades.prasa = 1; s.upgrades.humanoid = 1;
    expect(() => view.sync(s)).not.toThrow();
    expect(view.machines).toBe(0);
    expect(view.sync(s).edward).toBe('wolny');   // eDward chodzi dalej: jego ciało nie zależy od miejsc na maszyny
  });

  it('dispose zdejmuje wszystko ze sceny i jest bezpieczne przy ponownym wywołaniu oraz późniejszych sync/update', () => {
    const { view, parent, s } = make();
    s.upgrades.tasmociag = 3; s.upgrades.wykladacz = 3; s.upgrades.prasa = 1;
    view.sync(s);
    expect(view.machines).toBe(3);
    view.dispose();
    expect(parent.children).toHaveLength(0);
    expect(() => { view.dispose(); view.update(0.1); view.sync(s); }).not.toThrow();
    expect(view.sync(s)).toEqual({ edward: null });
    expect(parent.children).toHaveLength(0);
  });
});
