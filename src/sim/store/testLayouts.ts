// Pomocnik testów: ręcznie złożony, poprawny sklep (bez generatora) oraz funkcje psujące
// dokładnie jedną regułę walidacji. Nie jest importowany przez kod gry.
import type { Cell } from '@/sim/grid';
import { palletZone, spawnPoints, storeDimensions, typeCells } from './assemble';
import { FRONT_WALL_Y, type Fixture, type LotSpec, type StoreLayout } from './types';

export interface LayoutParts {
  lot: LotSpec;
  entrance: Cell[];
  fixtures: Fixture[];
  checkoutQueue: Cell[];
}

const fx = (id: string, kind: Fixture['kind'], x: number, y: number, w: number, d: number, facing: Fixture['facing']): Fixture =>
  ({ id, kind, x, y, w, d, facing });

/**
 * Sklep 16 × 19 (interiorWidth 14, sala 9 wierszy, zaplecze 3). Wejście w x=6..7.
 * Po lewej „blok kasowy”: regał z papierosami przy ścianie (x=1), kratka personelu (x=2),
 * potem kawa, kasa i hot-dogi w jednej linii (x=3), a przed nią kolejka (x=4) w dół sali.
 * Dalej dwa gondole pionowe, regał ścienny po prawej i cztery lodówki przy ścianie środkowej.
 * Świeże obiekty przy każdym wywołaniu, więc wolno je mutować.
 */
export function validParts(): LayoutParts {
  return {
    lot: { kind: 'kamienica', interiorWidth: 14, salesDepth: 9, backroomDepth: 3, corner: false },
    entrance: [{ x: 6, y: FRONT_WALL_Y }, { x: 7, y: FRONT_WALL_Y }],
    fixtures: [
      fx('tobaccoShelf-1', 'tobaccoShelf', 1, 6, 1, 7, 'E'),
      fx('coffee-1', 'coffee', 3, 6, 1, 1, 'E'),
      fx('checkout-1', 'checkout', 3, 7, 1, 4, 'E'),
      fx('hotFood-1', 'hotFood', 3, 11, 1, 2, 'E'),
      fx('backroomDoor-1', 'backroomDoor', 2, 14, 2, 1, 'N'),
      fx('gondola-1', 'gondola', 6, 7, 2, 4, 'W'),
      fx('gondola-2', 'gondola', 10, 7, 2, 4, 'E'),
      fx('wallShelf-1', 'wallShelf', 14, 7, 1, 4, 'W'),
      fx('fridge-1', 'fridge', 6, 12, 2, 2, 'N'),
      fx('fridge-2', 'fridge', 8, 12, 2, 2, 'N'),
      fx('fridge-3', 'fridge', 10, 12, 2, 2, 'N'),
      fx('fridge-4', 'fridge', 12, 12, 2, 2, 'N'),
      fx('equipmentSlot-1', 'equipmentSlot', 13, 5, 2, 2, 'W'),
      fx('selfCheckoutSlot-1', 'selfCheckoutSlot', 9, 5, 2, 1, 'S'),
    ],
    checkoutQueue: [{ x: 4, y: 8 }, { x: 4, y: 9 }, { x: 4, y: 10 }, { x: 4, y: 11 }, { x: 4, y: 12 }],
  };
}

/** Składa pełny StoreLayout produkcyjnym kodem siatki (assemble.ts), bez generatora. */
export function layoutFromParts(parts: LayoutParts): StoreLayout {
  const { lot } = parts;
  const { width, depth, midWallY } = storeDimensions(lot);
  return {
    generatorVersion: 0,
    seed: 'test-valid',
    lot,
    width,
    depth,
    midWallY,
    cells: typeCells(lot, parts.entrance, parts.fixtures),
    fixtures: parts.fixtures,
    entrance: parts.entrance,
    checkoutQueue: parts.checkoutQueue,
    palletZoneOutside: palletZone(width, parts.entrance),
    spawnPoints: spawnPoints(width),
  };
}

export function makeValidLayout(): StoreLayout {
  return layoutFromParts(validParts());
}

/** Zmienia pola mebla o danym id (mutuje `parts`, które i tak są świeże). */
export function patchFixture(parts: LayoutParts, id: string, patch: Partial<Fixture>): LayoutParts {
  const f = parts.fixtures.find((m) => m.id === id);
  if (!f) throw new Error(`testLayouts: brak mebla ${id}`);
  Object.assign(f, patch);
  return parts;
}

export function removeFixture(parts: LayoutParts, id: string): LayoutParts {
  if (!parts.fixtures.some((m) => m.id === id)) throw new Error(`testLayouts: brak mebla ${id}`);
  parts.fixtures = parts.fixtures.filter((m) => m.id !== id);
  return parts;
}

export interface Break {
  /** Opis uszkodzenia. */
  name: string;
  /** Jedyny kod błędu, jaki ma zgłosić walidator. */
  code: string;
  make(): StoreLayout;
}

const q = (...xy: [number, number][]): Cell[] => xy.map(([x, y]) => ({ x, y }));

/** Każdy wpis psuje dokładnie jedną regułę (walidator ma zwrócić tylko `code`). */
export const BREAKS: Break[] = [
  {
    name: 'wejście w złym wierszu',
    code: 'entrance-not-front',
    make: () => {
      const p = validParts();
      p.entrance = q([6, FRONT_WALL_Y], [7, FRONT_WALL_Y + 1]);
      return layoutFromParts(p);
    },
  },
  {
    name: 'tylko jedna kratka wejścia',
    code: 'entrance-not-front',
    make: () => {
      const p = validParts();
      p.entrance = q([6, FRONT_WALL_Y]);
      return layoutFromParts(p);
    },
  },
  {
    name: 'wejście daleko od kasy (manhattan > 8)',
    code: 'checkout-far',
    make: () => {
      const p = validParts();
      p.entrance = q([11, FRONT_WALL_Y], [12, FRONT_WALL_Y]);
      return layoutFromParts(p);
    },
  },
  {
    name: 'kasa sięga poza pierwsze 6 wierszy sali',
    code: 'checkout-far',
    make: () => {
      const p = validParts();
      patchFixture(p, 'checkout-1', { y: 8 });
      patchFixture(p, 'hotFood-1', { y: 12, d: 1 });
      return layoutFromParts(p);
    },
  },
  {
    name: 'regał z papierosami ustawiony bokiem do kasy',
    code: 'tobacco-not-behind',
    make: () => layoutFromParts(patchFixture(validParts(), 'tobaccoShelf-1', { facing: 'N' })),
  },
  {
    name: 'regał z papierosami nie leży za kasą (brak zakładki wzdłuż ściany)',
    code: 'tobacco-not-behind',
    make: () => layoutFromParts(patchFixture(validParts(), 'tobaccoShelf-1', { y: 11, d: 3 })),
  },
  {
    name: 'w pasie personelu za kasą stoi mebel',
    code: 'tobacco-not-behind',
    make: () => {
      const p = validParts();
      p.fixtures.push(fx('coffee-2', 'coffee', 2, 8, 1, 1, 'N'));
      return layoutFromParts(p);
    },
  },
  {
    name: 'brak regału z papierosami',
    code: 'tobacco-not-behind',
    make: () => layoutFromParts(removeFixture(validParts(), 'tobaccoShelf-1')),
  },
  {
    name: 'kawa daleko od kasy',
    code: 'hot-far',
    make: () => layoutFromParts(patchFixture(validParts(), 'coffee-1', { x: 11, y: 5, facing: 'S' })),
  },
  {
    name: 'hot-dogi daleko od kasy',
    code: 'hot-far',
    make: () => layoutFromParts(patchFixture(validParts(), 'hotFood-1', { x: 11, y: 5, facing: 'W' })),
  },
  {
    name: 'brak ekspresu do kawy',
    code: 'hot-far',
    make: () => layoutFromParts(removeFixture(validParts(), 'coffee-1')),
  },
  {
    name: 'lodówka zwrócona bokiem',
    code: 'fridge-not-back',
    make: () => layoutFromParts(patchFixture(validParts(), 'fridge-4', { facing: 'E' })),
  },
  {
    name: 'lodówka nie dotyka ściany środkowej',
    code: 'fridge-not-back',
    make: () => layoutFromParts(patchFixture(validParts(), 'fridge-4', { y: 11 })),
  },
  {
    name: 'gondola z jedną kratką alejki po wschodniej stronie',
    code: 'aisle-narrow:gondola-2',
    make: () => layoutFromParts(patchFixture(validParts(), 'gondola-2', { x: 11 })),
  },
  {
    name: 'dwie lodówki nakładają się',
    code: 'fixture-overlap',
    make: () => layoutFromParts(patchFixture(validParts(), 'fridge-2', { x: 7 })),
  },
  {
    name: 'regał wchodzi w boczną ścianę',
    code: 'fixture-overlap',
    make: () => {
      const p = validParts();
      p.fixtures.push(fx('wallShelf-2', 'wallShelf', 15, 11, 1, 2, 'W'));
      return layoutFromParts(p);
    },
  },
  {
    name: 'mebel nie oznaczony w cells jako fixture',
    code: 'fixture-overlap',
    make: () => {
      const l = makeValidLayout();
      l.fixtures.push(fx('coffee-2', 'coffee', 9, 6, 1, 1, 'E'));
      return l;
    },
  },
  {
    name: 'front sprzętu zastawiony drugim sprzętem',
    code: 'unreachable:equipmentSlot-1',
    make: () => {
      const p = validParts();
      p.fixtures.push(fx('equipmentSlot-2', 'equipmentSlot', 11, 5, 2, 2, 'W'));
      return layoutFromParts(p);
    },
  },
  {
    name: 'kolejka z dziurą',
    code: 'queue-invalid',
    make: () => {
      const p = validParts();
      p.checkoutQueue = q([4, 8], [4, 9], [4, 11], [4, 12]);
      return layoutFromParts(p);
    },
  },
  {
    name: 'kolejka zaczyna się z dala od kasy',
    code: 'queue-invalid',
    make: () => {
      const p = validParts();
      p.checkoutQueue = q([4, 12], [4, 11], [4, 10], [4, 9], [4, 8]);
      return layoutFromParts(p);
    },
  },
  {
    name: 'kolejka przechodzi przez regał',
    code: 'queue-invalid',
    make: () => {
      const p = validParts();
      p.checkoutQueue = q([4, 8], [4, 9], [4, 10], [5, 10], [6, 10]);
      return layoutFromParts(p);
    },
  },
  {
    name: 'kolejka powtarza kratki',
    code: 'queue-invalid',
    make: () => {
      const p = validParts();
      p.checkoutQueue = q([4, 8], [4, 9], [4, 8], [4, 9], [4, 10]);
      return layoutFromParts(p);
    },
  },
  {
    name: 'pusta kolejka',
    code: 'queue-invalid',
    make: () => {
      const p = validParts();
      p.checkoutQueue = [];
      return layoutFromParts(p);
    },
  },
  {
    name: 'brak drzwi na zaplecze',
    code: 'no-backroom-door',
    make: () => layoutFromParts(removeFixture(validParts(), 'backroomDoor-1')),
  },
  {
    name: 'dwoje drzwi na zaplecze',
    code: 'no-backroom-door',
    make: () => {
      const p = validParts();
      p.fixtures.push(fx('backroomDoor-2', 'backroomDoor', 8, 14, 2, 1, 'N'));
      return layoutFromParts(p);
    },
  },
];
