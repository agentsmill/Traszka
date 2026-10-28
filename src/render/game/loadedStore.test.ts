import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Mesh, Scene, type Material, type Object3D } from 'three';
import { DEFAULT_CASHIER_LOOK, cashierSpot } from '@/game/cashier';
import { createBlobShadows } from '@/render/characters/blobShadows';
import type { CharacterFactory, CharacterInstance } from '@/render/characters/characterFactory';
import { cellToWorld } from '@/render/coords';
import type { StreetView } from '@/render/street/buildStreet';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { generateStore } from '@/sim/store/generateStore';
import { attachCharacters, loadStore, unloadStore, type Loaded, type StoreSource } from './loadedStore';

/**
 * `loadStore` składa sklep z kilku części (bryła, towar, palety, sprzęt, kasa, widok tłumu, kasjer). Każda z nich może się wywrócić
 * (shader, bufor, nietypowy układ), a `load()` w main.ts wołane z odzyskiwania po błędzie zostawiało wtedy w scenie
 * pół-zbudowany sklep, którego nikt już nie zwolni. Części udają tu awarię, reszta jest prawdziwa.
 */
const mocks = vi.hoisted(() => ({
  fail: { goods: false, pallets: false, equipment: false, crowd: false, cashier: false },
  /** Części, których `dispose` ma rzucić (sprzątanie, które samo się wywraca); rzucają po zapisaniu się w `disposed`, bez zwalniania. */
  disposeThrows: [] as string[],
  /** Części, których `dispose` zostało zawołane (także te, które rzuciły). */
  disposed: [] as string[],
}));

/** Opakowuje `dispose` obiektu, żeby test widział, że część została zwolniona. */
function watch<T extends { dispose(): void }>(name: string, part: T): T {
  const original = part.dispose.bind(part);
  part.dispose = () => {
    mocks.disposed.push(name);
    if (mocks.disposeThrows.includes(name)) throw new Error(`dispose: ${name}`);
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
vi.mock('@/render/cashierView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/render/cashierView')>();
  class CashierView extends actual.CashierView {
    constructor(...args: ConstructorParameters<typeof actual.CashierView>) {
      if (mocks.fail.cashier) throw new Error('kasjer');
      super(...args);
      watch('cashier', this);
    }
  }
  return { ...actual, CashierView };
});

const SEED = 'kiełbasa-42';
const layout = generateStore(SEED);
const info = computeStoreInfo(layout);

let scene: Scene;
let crowdParent: Group;
beforeEach(() => {
  mocks.fail.goods = mocks.fail.pallets = mocks.fail.equipment = mocks.fail.crowd = mocks.fail.cashier = false;
  mocks.disposeThrows.length = 0;
  mocks.disposed.length = 0;
  vi.restoreAllMocks();
  scene = new Scene();
  crowdParent = new Group();
  crowdParent.name = 'crowd';
  crowdParent.add(new Group());   // np. plamy cienia, które main.ts trzyma w grupie tłumu przez całą grę
  scene.add(crowdParent);
});

/** Fabryka-atrapa: klient i kasjer to grupy z jedną siatką; zapisuje, kogo zbudowano. */
function fakeFactory(): { factory: CharacterFactory; made: { seed: string; outfit: string | null; character: CharacterInstance }[] } {
  const made: { seed: string; outfit: string | null; character: CharacterInstance }[] = [];
  const build = (seed: string, outfit: string | null): CharacterInstance => {
    const object = new Group();
    object.add(new Mesh());
    const character = { object, outfit, setAnim: vi.fn(), update: vi.fn(), dispose: vi.fn(() => object.removeFromParent()), isFallback: false } as unknown as CharacterInstance;
    made.push({ seed, outfit, character });
    return character;
  };
  const factory: CharacterFactory = {
    walkSpeedMps: 1.15,
    dispose: vi.fn(),
    create: (seed) => build(seed, null),
    createWithOutfit: (seed, outfit) => build(seed, outfit),
    ensureOutfit: () => Promise.resolve(),
  };
  return { factory, made };
}

const source = (over: Partial<StoreSource> = {}): StoreSource => ({
  scene, seed: SEED, layout, info, speed: 2, crowdParent, blobs: null, factory: fakeFactory().factory, cashierLook: DEFAULT_CASHIER_LOOK, ...over,
});
const stores = (): number => scene.children.filter((c) => c.name === 'store').length;
/** Zapisuje, co z kasy do stukania zostało zwolnione (geometria, materiał): zdarzenie `dispose` z three.js, nie atrapa. */
function watchTill(loaded: Loaded): string[] {
  const released: string[] = [];
  loaded.till!.geometry.addEventListener('dispose', () => released.push('geometry'));
  (loaded.till!.material as Material).addEventListener('dispose', () => released.push('material'));
  return released;
}
/** Kasjerzy w grupie tłumu: obiekty postaci z `createWithOutfit` (klienci to `create`, ich fabryka-atrapa tu nie buduje). */
const cashiersIn = (made: { outfit: string | null; character: CharacterInstance }[]): Object3D[] =>
  made.filter((m) => m.outfit !== null && m.character.object.parent === crowdParent).map((m) => m.character.object);

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
    expect(loaded.cashierView).not.toBeNull();
    expect(loaded.street).toBeNull();
  });

  it('bez opisu układu dla ekonomii (benchmark) nie ma palet, sprzętu ani kasy; bez fabryki postaci nie ma widoku tłumu ani kasjera', () => {
    const loaded = loadStore(source({ info: null, factory: null }));
    expect([loaded.pallets, loaded.equipment, loaded.till, loaded.tillTop, loaded.crowdView, loaded.cashierView]).toEqual([null, null, null, null, null, null]);
    expect(stores()).toBe(1);
    expect(crowdParent.children).toHaveLength(1);
  });

  it('unloadStore zdejmuje sklep ze sceny i zwalnia wszystkie części, także geometrię i materiał kasy do stukania (tłum zostaje, bo należy do gry)', () => {
    const loaded = loadStore(source());
    const till = watchTill(loaded);
    expect(till).toEqual([]);   // nic nie zwolniono przed sprzątaniem
    unloadStore(loaded);
    expect(stores()).toBe(0);
    expect(mocks.disposed.sort()).toEqual(['cashier', 'crowd', 'equipment', 'pallets', 'view']);
    expect(till.sort()).toEqual(['geometry', 'material']);
    expect(crowdParent.parent).toBe(scene);
    expect(crowdParent.children).toHaveLength(1);
  });

  it('kasjer: w grupie tłumu, na kratce za kasą, w wyglądzie ze źródła sklepu; zwolniony razem ze sklepem wraz z miejscem w plamach cienia', () => {
    const { factory, made } = fakeFactory();
    const blobs = createBlobShadows(4);
    const look = { outfit: 'women-suit' as const, appearanceSeed: 'kasjer-ze-zrodla' };
    const loaded = loadStore(source({ factory, blobs, cashierLook: look }));
    const [cashier] = cashiersIn(made);
    expect(made.map((m) => [m.seed, m.outfit])).toEqual([['kasjer-ze-zrodla', 'women-suit']]);   // klientów jeszcze nie ma
    expect(crowdParent.children).toContain(cashier);
    const { cell } = cashierSpot(layout)!;
    const at = cellToWorld(layout, cell.x, cell.y);
    expect([cashier!.position.x, cashier!.position.z]).toEqual([expect.closeTo(at.x, 9), expect.closeTo(at.z, 9)]);
    expect(blobs.mesh.count).toBe(1);
    expect(loaded.cashierView!.character!.object).toBe(cashier);
    unloadStore(loaded);
    expect(crowdParent.children).toHaveLength(1);
    expect(made[0]!.character.dispose).toHaveBeenCalledTimes(1);
    expect(blobs.mesh.count).toBe(0);
  });

  it('zmiana seeda i remont (kolejny loadStore po unloadStore) nie dublują kasjera: w grupie tłumu zawsze najwyżej jeden', () => {
    const { factory, made } = fakeFactory();
    const blobs = createBlobShadows(4);
    let loaded = loadStore(source({ factory, blobs }));
    for (const seed of ['inny-sklep-1', 'inny-sklep-2', SEED]) {
      unloadStore(loaded);
      expect(cashiersIn(made)).toHaveLength(0);
      expect(blobs.mesh.count).toBe(0);
      const next = generateStore(seed);
      loaded = loadStore(source({ factory, blobs, seed, layout: next, info: computeStoreInfo(next) }));
      expect(cashiersIn(made)).toHaveLength(1);
      expect(blobs.mesh.count).toBe(1);
    }
    expect(made).toHaveLength(4);
    unloadStore(loaded);
    expect(cashiersIn(made)).toHaveLength(0);
  });

  it('attachCharacters dokłada tłum i kasjera, gdy fabryka dochodzi później (main.ts), i niczego nie dubluje', () => {
    const { factory, made } = fakeFactory();
    const blobs = createBlobShadows(4);
    const loaded = loadStore(source({ factory: null, blobs }));
    expect([loaded.crowdView, loaded.cashierView]).toEqual([null, null]);
    const parts = { factory, crowdParent, blobs, cashierLook: DEFAULT_CASHIER_LOOK };
    attachCharacters(loaded, parts);
    expect(loaded.crowdView).not.toBeNull();
    expect(loaded.cashierView).not.toBeNull();
    const [crowdView, cashierView] = [loaded.crowdView, loaded.cashierView];
    attachCharacters(loaded, parts);
    expect([loaded.crowdView, loaded.cashierView]).toEqual([crowdView, cashierView]);
    expect(cashiersIn(made)).toHaveLength(1);
    unloadStore(loaded);
    expect(cashiersIn(made)).toHaveLength(0);
    expect(blobs.mesh.count).toBe(0);
  });

  const failures: [string, keyof typeof mocks.fail, string[]][] = [
    ['towar (przed wstawieniem do sceny)', 'goods', ['view']],
    ['palety (bryła już w scenie)', 'pallets', ['view']],
    ['sprzęt (palety już zbudowane)', 'equipment', ['pallets', 'view']],
    ['widok tłumu (wszystko inne gotowe, z kasą włącznie)', 'crowd', ['equipment', 'pallets', 'view']],
    ['kasjer (widok tłumu już stoi)', 'cashier', ['crowd', 'equipment', 'pallets', 'view']],
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

  it('sprzątanie, które samo się wywraca, nie zasłania pierwotnego błędu, a w scenie i tak nic nie zostaje', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.fail.equipment = true;
    mocks.disposeThrows.push('pallets');
    expect(() => loadStore(source())).toThrow('sprzęt');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![1]).toEqual(new Error('dispose: pallets'));   // zalogowany jest błąd sprzątania, rzucony jest pierwotny
    expect(mocks.disposed.sort()).toEqual(['pallets', 'view']);             // widok zwolniony mimo błędu w paletach
    expect(stores()).toBe(0);
    expect(scene.children).toEqual([crowdParent]);
    expect(crowdParent.children).toHaveLength(1);
  });

  describe('unloadStore sprząta do końca, nawet gdy któryś krok rzuci', () => {
    /** Sklep z wszystkimi częściami, także z ulicą (w grze dochodzi później); `street` to atrapa z własnym `dispose`. */
    function fullStore(): { loaded: Loaded; till: string[] } {
      const loaded = loadStore(source());
      loaded.street = watch('street', { root: new Group(), dispose: () => {} } as unknown as StreetView);
      return { loaded, till: watchTill(loaded) };
    }
    const ALL = ['cashier', 'crowd', 'equipment', 'pallets', 'street', 'view'];
    const steps = ['crowd', 'cashier', 'street', 'pallets', 'equipment', 'view'];   // w kolejności sprzątania

    for (const step of steps) {
      it(`rzuca krok „${step}”: pozostałe i tak się wykonują (z geometrią i materiałem kasy), bryła schodzi ze sceny, wyjątek idzie dalej`, () => {
        const { loaded, till } = fullStore();
        mocks.disposeThrows.push(step);
        expect(() => unloadStore(loaded)).toThrow(`dispose: ${step}`);
        expect(mocks.disposed.sort()).toEqual(ALL);
        expect(till.sort()).toEqual(['geometry', 'material']);
        expect(stores()).toBe(0);
        expect(scene.children).toEqual([crowdParent]);   // ten krok rzucił, zanim cokolwiek zwolnił, więc jego własnych obiektów nie sprawdzamy
      });
    }

    it('rzuca kilka kroków naraz: wszystkie się wykonują, a dalej idzie pierwszy błąd (w kolejności sprzątania)', () => {
      const { loaded, till } = fullStore();
      mocks.disposeThrows.push('view', 'pallets', 'cashier');
      expect(() => unloadStore(loaded)).toThrow('dispose: cashier');
      expect(mocks.disposed.sort()).toEqual(ALL);
      expect(till.sort()).toEqual(['geometry', 'material']);
      expect(stores()).toBe(0);
    });

    it('bez błędów nie rzuca nic, a tłum gry (plamy cienia) zostaje w scenie', () => {
      const { loaded, till } = fullStore();
      expect(() => unloadStore(loaded)).not.toThrow();
      expect(mocks.disposed.sort()).toEqual(ALL);
      expect(till.sort()).toEqual(['geometry', 'material']);
      expect(stores()).toBe(0);
      expect(scene.children).toEqual([crowdParent]);
      expect(crowdParent.children).toHaveLength(1);
    });
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
