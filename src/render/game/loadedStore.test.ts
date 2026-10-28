import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Scene } from 'three';
import type { CharacterFactory } from '@/render/characters/characterFactory';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { loadStore, unloadStore, type StoreSource } from './loadedStore';

/**
 * `loadStore` składa sklep z kilku części (bryła, towar, palety, sprzęt, kasa, widok tłumu). Każda z nich może się wywrócić
 * (shader, bufor, nietypowy układ), a `load()` w main.ts wołane z odzyskiwania po błędzie zostawiało wtedy w scenie
 * pół-zbudowany sklep, którego nikt już nie zwolni. Części udają tu awarię, reszta jest prawdziwa.
 */
const mocks = vi.hoisted(() => ({
  fail: { goods: false, pallets: false, equipment: false, crowd: false },
  /** Część, której `dispose` ma rzucić (sprzątanie, które samo się wywraca). */
  disposeThrows: null as string | null,
  disposed: [] as string[],
}));

/** Opakowuje `dispose` obiektu, żeby test widział, że część została zwolniona. */
function watch<T extends { dispose(): void }>(name: string, part: T): T {
  const original = part.dispose.bind(part);
  part.dispose = () => {
    mocks.disposed.push(name);
    if (mocks.disposeThrows === name) throw new Error(`dispose: ${name}`);
    original();
  };
  return part;
}

vi.mock('@/render/store/buildStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/render/store/buildStore')>();
  return { ...actual, buildStore: (...args: Parameters<typeof actual.buildStore>) => watch('view', actual.buildStore(...args)) };
});
vi.mock('@/render/store/products', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/render/store/products')>();
  return {
    ...actual,
    createGoods: (...args: Parameters<typeof actual.createGoods>) => {
      if (mocks.fail.goods) throw new Error('towar');
      return actual.createGoods(...args);
    },
  };
});
vi.mock('./palletsView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./palletsView')>();
  return {
    ...actual,
    createPalletsView: (...args: Parameters<typeof actual.createPalletsView>) => {
      if (mocks.fail.pallets) throw new Error('palety');
      return watch('pallets', actual.createPalletsView(...args));
    },
  };
});
vi.mock('./equipmentView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./equipmentView')>();
  return {
    ...actual,
    createEquipmentView: (...args: Parameters<typeof actual.createEquipmentView>) => {
      if (mocks.fail.equipment) throw new Error('sprzęt');
      return watch('equipment', actual.createEquipmentView(...args));
    },
  };
});
vi.mock('@/render/crowdView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/render/crowdView')>();
  class CrowdView extends actual.CrowdView {
    constructor(...args: ConstructorParameters<typeof actual.CrowdView>) {
      if (mocks.fail.crowd) throw new Error('tłum');
      super(...args);
      watch('crowd', this);
    }
  }
  return { ...actual, CrowdView };
});

const SEED = 'kiełbasa-42';
const layout = generateStore(SEED);
const info = computeStoreInfo(layout);

let scene: Scene;
let crowdParent: Group;
beforeEach(() => {
  mocks.fail.goods = mocks.fail.pallets = mocks.fail.equipment = mocks.fail.crowd = false;
  mocks.disposeThrows = null;
  mocks.disposed.length = 0;
  vi.restoreAllMocks();
  scene = new Scene();
  crowdParent = new Group();
  crowdParent.name = 'crowd';
  crowdParent.add(new Group());   // np. plamy cienia, które main.ts trzyma w grupie tłumu przez całą grę
  scene.add(crowdParent);
});

const source = (over: Partial<StoreSource> = {}): StoreSource => ({
  scene, seed: SEED, layout, info, speed: 2, crowdParent, blobs: null, factory: {} as CharacterFactory, ...over,
});
const stores = (): number => scene.children.filter((c) => c.name === 'store').length;

describe('loadStore / unloadStore', () => {
  it('składa sklep w scenie: bryła z towarem, palety, sprzęt, kasa do stukania i widok tłumu; prędkość świata z wywołania', () => {
    const loaded = loadStore(source());
    expect(stores()).toBe(1);
    expect(loaded.world.speed).toBe(2);
    expect(loaded.pallets!.root.parent).toBe(loaded.view.root);
    expect(loaded.equipment!.root.parent).toBe(loaded.view.root);
    expect(loaded.till!.parent).toBe(loaded.view.root);
    expect(loaded.till!.userData.pick).toEqual({ kind: 'till' });
    expect(loaded.tillTop).not.toBeNull();
    expect(loaded.crowdView).not.toBeNull();
    expect(loaded.street).toBeNull();
  });

  it('bez opisu układu dla ekonomii (benchmark) nie ma palet, sprzętu ani kasy; bez fabryki postaci nie ma widoku tłumu', () => {
    const loaded = loadStore(source({ info: null, factory: null }));
    expect([loaded.pallets, loaded.equipment, loaded.till, loaded.tillTop, loaded.crowdView]).toEqual([null, null, null, null, null]);
    expect(stores()).toBe(1);
  });

  it('unloadStore zdejmuje sklep ze sceny i zwalnia wszystkie części (tłum zostaje, bo należy do gry)', () => {
    const loaded = loadStore(source());
    unloadStore(loaded);
    expect(stores()).toBe(0);
    expect(mocks.disposed.sort()).toEqual(['crowd', 'equipment', 'pallets', 'view']);
    expect(crowdParent.parent).toBe(scene);
    expect(crowdParent.children).toHaveLength(1);
  });

  const failures: [string, keyof typeof mocks.fail, string[]][] = [
    ['towar (przed wstawieniem do sceny)', 'goods', ['view']],
    ['palety (bryła już w scenie)', 'pallets', ['view']],
    ['sprzęt (palety już zbudowane)', 'equipment', ['pallets', 'view']],
    ['widok tłumu (wszystko inne gotowe, z kasą włącznie)', 'crowd', ['equipment', 'pallets', 'view']],
  ];
  for (const [name, which, released] of failures) {
    it(`awaria przy budowie części „${name}”: wyjątek idzie dalej, w scenie nic nie zostaje, zbudowane części są zwolnione`, () => {
      mocks.fail[which] = true;
      expect(() => loadStore(source())).toThrow();
      expect(stores()).toBe(0);
      expect(scene.children).toEqual([crowdParent]);
      expect(crowdParent.children).toHaveLength(1);
      expect(mocks.disposed.sort()).toEqual(released);
    });
  }

  it('sprzątanie, które samo się wywraca, nie zasłania pierwotnego błędu', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.fail.equipment = true;
    mocks.disposeThrows = 'pallets';
    expect(() => loadStore(source())).toThrow('sprzęt');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('po nieudanej budowie następna udana zostawia w scenie dokładnie jeden sklep (odzyskiwanie po błędzie w setSeed i przy starcie)', () => {
    mocks.fail.equipment = true;
    expect(() => loadStore(source())).toThrow();
    expect(() => loadStore(source())).toThrow();
    mocks.fail.equipment = false;
    const good = loadStore(source());
    expect(stores()).toBe(1);
    expect(scene.getObjectByName('store')).toBe(good.view.root);
    unloadStore(good);
    expect(stores()).toBe(0);
  });
});
