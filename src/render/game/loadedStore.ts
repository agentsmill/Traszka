import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3, type Material, type Object3D } from 'three';
import { cellToWorld } from '@/render/coords';
import { buildStore, type StoreView } from '@/render/store/buildStore';
import { createGoods, type Goods } from '@/render/store/products';
import type { BlobShadows } from '@/render/characters/blobShadows';
import type { CharacterFactory } from '@/render/characters/characterFactory';
import { CashierView } from '@/render/cashierView';
import { CrowdView } from '@/render/crowdView';
import { RobotsView } from '@/render/robots/robotsView';
import { StaffView } from '@/render/staff/staffView';
import type { StreetView } from '@/render/street/buildStreet';
import type { CashierLook } from '@/game/cashier';
import { createWorld, type World } from '@/game/world';
import type { Speed } from '@/game/loop';
import type { CrowdOptions } from '@/sim/crowd/crowd';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import { CELL_SIZE_M } from '@/sim/grid';
import type { StoreLayout } from '@/sim/store/types';
import { createEquipmentView, type EquipmentView } from './equipmentView';
import { createPalletsView, type PalletsView } from './palletsView';

/** Wszystko, co zależy od układu sklepu. `unloadStore` zwalnia to w całości, więc zmiana seeda albo remont niczego nie zostawia. */
export interface Loaded {
  world: World;
  view: StoreView;                  // razem z towarem na półkach (jest jego dzieckiem)
  goods: Goods;
  pallets: PalletsView | null;      // tylko w grze (bez benchmarku)
  equipment: EquipmentView | null;
  robots: RobotsView | null;        // maszyny z warsztatu (taśmociąg, prasa, wykładacz); eDward chodzi w `staffView`
  till: Mesh | null;                // niewidoczna bryła nad kasą do stukania
  tillTop: Vector3 | null;          // punkt nad kasą dla dymka kolejki
  street: StreetView | null;        // dochodzi asynchronicznie (modele GLB)
  crowdView: CrowdView | null;      // dochodzi, gdy fabryka postaci jest gotowa
  cashierView: CashierView | null;  // razem z widokiem tłumu; stoi za kasą
  staffView: StaffView | null;      // załoga na ekranie; prowadzi `cashierView`, więc powstaje po nim
}

/** Z czego i do czego budować sklep. */
export interface StoreSource {
  /** Scena, do której trafia sklep. */
  scene: Object3D;
  seed: string;
  layout: StoreLayout;
  /** Opis układu dla ekonomii; null poza grą (benchmark): wtedy bez palet, sprzętu i kasy do stukania. */
  info: StoreInfo | null;
  /** Rozmiar tłumu (benchmark: 60 postaci); bez tego domyślny z `createWorld`. */
  crowd?: CrowdOptions;
  speed: Speed;
  /** Grupa tłumu w scenie i wspólne plamy cienia pod postaciami. */
  crowdParent: Object3D;
  blobs: BlobShadows | null;
  /** Fabryka postaci, jeśli już gotowa; bez niej tłum i kasjer dochodzą później (main.ts, `attachCharacters`). */
  factory: CharacterFactory | null;
  /** Wygląd kasjera za ladą. Jedno miejsce, z którego gra bierze go dla każdego sklepu (wygląd z meta gracza). */
  cashierLook: CashierLook;
}

/** Skąd sklep bierze swoje postacie: fabryka, grupa w scenie, wspólne plamy cienia i wygląd kasjera. */
export type CharacterSource = Pick<StoreSource, 'crowdParent' | 'blobs' | 'cashierLook'> & { factory: CharacterFactory };

/**
 * Dokłada sklepowi postacie: widok tłumu, kasjera za ladą i załogi (wszystkie w grupie tłumu, ze wspólnymi plamami cienia; załoga
 * prowadzi kasjera, więc dostaje jego widok). Wołane przy budowie sklepu, gdy fabryka jest już gotowa, a w przeciwnym razie przez
 * main.ts, gdy fabryka dojdzie. Części, które już stoją, zostają (nic się nie dubluje). Gdy któraś się wywróci, wyjątek idzie
 * dalej, a to, co już stoi, zwalnia `unloadStore`.
 */
export function attachCharacters(loaded: Loaded, src: CharacterSource): void {
  const { layout } = loaded.world;
  loaded.crowdView ??= new CrowdView(src.factory, layout, src.crowdParent, src.blobs);
  loaded.cashierView ??= new CashierView(src.factory, layout, src.crowdParent, src.blobs, src.cashierLook);
  // Załoga trzyma własną kopię układu, więc remont (nowy układ) to nowy sklep, a w nim nowy `StaffView`.
  loaded.staffView ??= new StaffView(src.factory, layout, src.crowdParent, src.blobs, loaded.cashierView);
}

/**
 * Buduje sklep w scenie: świat symulacji, bryłę z towarem, palety, sprzęt, maszyny z warsztatu, kasę do stukania, widok tłumu, kasjera i załogi. Gdy któraś część
 * się wywróci, wszystko już zbudowane jest zdjęte ze sceny i zwolnione, zanim wyjątek pójdzie dalej: odzyskiwanie po błędzie
 * (poprzedni sklep w `setSeed`, sklep awaryjny przy starcie) zaczyna od czystej sceny, a nie od pół-zbudowanego sklepu,
 * którego nikt by już nie znalazł.
 */
export function loadStore(src: StoreSource): Loaded {
  const { layout, info, seed } = src;
  const world = createWorld(seed, src.crowd, layout);
  world.speed = src.speed;
  const view = buildStore(layout);
  let goods: Goods;
  try {
    goods = createGoods(view, seed);
  } catch (error) {
    view.dispose();
    throw error;
  }
  view.root.add(goods.root);   // view.dispose() zwalnia też bufory instancji towaru
  src.scene.add(view.root);

  // Od tej chwili sklep jest w scenie: pola wypełniamy po kolei, a przy wyjątku `unloadStore` zwalnia te, które już stoją.
  const loaded: Loaded = { world, view, goods, pallets: null, equipment: null, robots: null, till: null, tillTop: null, street: null, crowdView: null, cashierView: null, staffView: null };
  try {
    if (info) {
      loaded.pallets = createPalletsView(layout, info);
      view.root.add(loaded.pallets.root);
      loaded.equipment = createEquipmentView(layout, info, view);
      view.root.add(loaded.equipment.root);
      loaded.robots = new RobotsView(layout, info, view.root);
      const checkout = layout.fixtures.find((f) => f.kind === 'checkout');
      if (checkout) {
        const a = cellToWorld(layout, checkout.x, checkout.y);
        const b = cellToWorld(layout, checkout.x + checkout.w - 1, checkout.y + checkout.d - 1);
        const till = new Mesh(new BoxGeometry(checkout.w * CELL_SIZE_M + 0.4, 1.6, checkout.d * CELL_SIZE_M + 0.4), new MeshBasicMaterial({ visible: false }));
        till.position.set((a.x + b.x) / 2, 0.8, (a.z + b.z) / 2);
        till.userData = { pick: { kind: 'till' } };
        view.root.add(till);
        loaded.till = till;
        loaded.tillTop = new Vector3((a.x + b.x) / 2, 1.9, (a.z + b.z) / 2);
      }
    }
    if (src.factory) attachCharacters(loaded, { factory: src.factory, crowdParent: src.crowdParent, blobs: src.blobs, cashierLook: src.cashierLook });
    return loaded;
  } catch (error) {
    try {
      unloadStore(loaded);
    } catch (cleanup) {
      console.error('Nie udało się posprzątać po nieudanej budowie sklepu.', cleanup);   // pierwotny błąd jest ważniejszy
    }
    throw error;
  }
}

/**
 * Zdejmuje sklep ze sceny i zwalnia wszystko, co dla niego zbudowano (pola puste, bo budowa przerwana, są pomijane). Sprząta do
 * końca, nawet gdy któryś krok rzuci: każdy wykonuje się osobno, bryła sklepu schodzi ze sceny zawsze (także gdy jej własne
 * `dispose` rzuciło przed zdjęciem), a dopiero na końcu idzie dalej pierwszy z błędów. Inaczej jeden zepsuty `dispose` zostawiałby
 * w scenie sklep, którego nikt już nie znajdzie.
 */
export function unloadStore(loaded: Loaded): void {
  const errors: unknown[] = [];
  const attempt = (step: () => void): void => {
    try {
      step();
    } catch (error) {
      errors.push(error);
    }
  };
  attempt(() => loaded.crowdView?.dispose());
  attempt(() => loaded.staffView?.dispose());   // przed kasjerem: załoga go prowadzi i przy zwolnieniu odstawia
  attempt(() => loaded.cashierView?.dispose());
  attempt(() => loaded.street?.dispose());
  attempt(() => loaded.pallets?.dispose());
  attempt(() => loaded.equipment?.dispose());
  attempt(() => loaded.robots?.dispose());
  attempt(() => loaded.till?.geometry.dispose());
  attempt(() => (loaded.till?.material as Material | undefined)?.dispose());
  attempt(() => loaded.view.dispose());
  attempt(() => loaded.view.root.removeFromParent());
  if (errors.length > 0) throw errors[0];
}
