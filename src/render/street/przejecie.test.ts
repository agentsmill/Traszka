import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mesh } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { lang, tr } from '@/i18n';
import { CELL_SIZE_M } from '@/sim/grid';
import { REMONTS } from '@/sim/economy/upgrades';
import { layoutFor } from '@/sim/store/layoutFor';
import { pickLot } from '@/sim/store/lots';
import type { LotKind } from '@/sim/store/types';
import { MIN_TAKEN_NEIGHBOUR_W, SIDE_STREET, buildBuildings, cornerSide, grownWidth, planRow, storeOuter, type VolumeSpec } from './buildings';
import { buildStreet, type StreetView } from './buildStreet';
import { createFacadeAtlas, type AtlasCellName } from './facadeAtlas';

/*
 * Remont „dokupienie lokalu obok”: sklep zajmuje lokal sąsiada (sąsiad po stronie przejęcia jest węższy o przyrost sklepu),
 * a zanim to zrobi, w witrynie tego sąsiada przy granicy wisi kartka „DO WYNAJĘCIA”. Cztery seedy na rodzaj lokalu:
 * kamienice nienarożne mają bramę po obu stronach, narożne przecznicę po obu stronach (w poziomie 0), a blok i pawilon
 * dostają stronę przejęcia z osobnego strumienia.
 */

const SEEDS: Record<LotKind, string[]> = {
  blok: ['kiełbasa-42', 'a', 'b', 'c'],
  kamienica: ['traszka-11', 'traszka-12', 'kiełbasa-12', 'd'],
  pawilon: ['traszka-1', 'traszka-3', 'traszka-7', 'traszka-9'],
};
const ALL = (Object.keys(SEEDS) as LotKind[]).flatMap((kind) => SEEDS[kind].map((seed): [LotKind, string] => [kind, seed]));
const LEVELS = [0, 1, 2, 3];

/** Wiersz oczekiwanych wartości: x0, x1, kondygnacje, styl, kolor ściany. */
type Row = [number, number, number, string, string];

/**
 * Plan wiersza na poziomie 0 zapisany PRZED zmianą (`planRow(layoutFor(seed, 0), seed)` z gałęzi bez przejmowania lokalu):
 * remont nie ma prawa go ruszyć.
 */
const LEVEL_ZERO: Record<string, { own: Row[]; neighbours: Row[] }> = {
  'kiełbasa-42': { own: [[-5.22, 5.22, 5, 'blok', '#c6b7e4']], neighbours: [[-16.849795, -5.22, 6, 'blok', '#f2a9a1'], [5.22, 14.78506, 5, 'blok', '#a9d9b9']] },
  'a': { own: [[-5.22, 5.22, 5, 'blok', '#a9d9b9']], neighbours: [[-17.17164, -5.22, 6, 'blok', '#9fcbe8'], [5.22, 14.778661, 4, 'blok', '#c6b7e4']] },
  'b': { own: [[-5.22, 5.22, 5, 'blok', '#f3d27a']], neighbours: [[-16.216954, -5.22, 6, 'blok', '#c6b7e4'], [5.22, 15.502143, 6, 'blok', '#f4b493']] },
  'c': { own: [[-4.22, 4.22, 5, 'blok', '#f4b493']], neighbours: [[-16.389605, -4.22, 6, 'blok', '#9fcbe8'], [4.22, 14.402866, 5, 'blok', '#a9d9b9']] },
  'traszka-11': { own: [[-3.22, 3.22, 3, 'kamienica', '#d8a5a3'], [-6.42, -3.22, 3, 'kamienica', '#d8a5a3']], neighbours: [[-14.109843, -6.42, 3, 'kamienica', '#9c9286'], [3.22, 11.923279, 5, 'kamienica', '#efe3c9']] },
  'traszka-12': { own: [[-3.97, 3.97, 3, 'kamienica', '#efe3c9'], [3.97, 7.17, 3, 'kamienica', '#efe3c9']], neighbours: [[-11.850015, -3.97, 3, 'kamienica', '#9c9286'], [7.17, 17.560217, 4, 'kamienica', '#e8cf9e']] },
  'kiełbasa-12': { own: [[-3.22, 3.22, 4, 'kamienica', '#b9c4a1'], [3.22, 6.42, 4, 'kamienica', '#b9c4a1']], neighbours: [[-22.409155, -11.82, 5, 'kamienica', '#efe3c9'], [6.42, 16.010699, 5, 'kamienica', '#e8cf9e']] },
  'd': { own: [[-3.72, 3.72, 4, 'kamienica', '#d9a07a'], [-6.92, -3.72, 4, 'kamienica', '#d9a07a']], neighbours: [[-17.199642, -6.92, 4, 'kamienica', '#d8a5a3'], [12.32, 21.628808, 3, 'kamienica', '#b9c4a1']] },
  'traszka-1': { own: [[-5.97, 5.97, 1, 'pawilon', '#e8cf9e']], neighbours: [[-14.770002, -5.97, 1, 'pawilon', '#9c9286'], [5.97, 14.853525, 1, 'pawilon', '#efe3c9']] },
  'traszka-3': { own: [[-5.47, 5.47, 1, 'pawilon', '#d8a5a3']], neighbours: [[-14.757743, -5.47, 1, 'pawilon', '#9c9286'], [5.47, 15.24171, 1, 'pawilon', '#d9a07a']] },
  'traszka-7': { own: [[-5.22, 5.22, 1, 'pawilon', '#efe3c9']], neighbours: [[-16.099877, -5.22, 5, 'blok', '#9fcbe8'], [5.22, 16.356732, 4, 'blok', '#f3d27a']] },
  'traszka-9': { own: [[-6.72, 6.72, 1, 'pawilon', '#d9a07a']], neighbours: [[-16.421651, -6.72, 1, 'pawilon', '#b9c4a1'], [6.72, 15.195993, 1, 'pawilon', '#9c9286']] },
};

const rowOf = (v: VolumeSpec): Row => [v.x0, v.x1, v.floors, v.style, v.main];
const width = (v: VolumeSpec): number => v.x1 - v.x0;
const side = (i: number): 'minX' | 'maxX' => (i === 0 ? 'minX' : 'maxX');

/** Strona przejęcia wg decyzji: kamienica nienarożna: przeciwna do bramy, narożna: brak, blok i pawilon: zawsze maxX. */
function expectedTakenSide(seed: string): 'minX' | 'maxX' | null {
  const layout = layoutFor(seed, 0);
  const o = storeOuter(layout);
  if (cornerSide(layout) !== null) return null;
  if (layout.lot.kind === 'kamienica') {
    const gate = planRow(layout, seed).own.find((v) => v.gate)!;
    return gate.x1 <= o.x0 + 1e-6 ? 'maxX' : 'minX';
  }
  return 'maxX';
}

describe('przejęcie lokalu: plan wiersza', () => {
  it('poziom 0 wychodzi dokładnie tak jak przed zmianą (x0, x1, kondygnacje, styl, kolor), a brama i bryła nad sklepem nie mają kartki', () => {
    for (const [, seed] of ALL) {
      const plan = planRow(layoutFor(seed, 0), seed);
      const expected = LEVEL_ZERO[seed]!;
      expect(plan.own.map(rowOf).length, seed).toBe(expected.own.length);
      plan.own.forEach((v, i) => {
        const e = expected.own[i]!;
        expect(v.x0, `${seed} own ${i} x0`).toBeCloseTo(e[0], 5);
        expect(v.x1, `${seed} own ${i} x1`).toBeCloseTo(e[1], 5);
        expect([v.floors, v.style, v.main], `${seed} own ${i}`).toEqual([e[2], e[3], e[4]]);
        expect(v.rentSign, `${seed} own ${i} kartka`).toBe(false);
      });
      expect(plan.neighbours).toHaveLength(2);
      plan.neighbours.forEach((v, i) => {
        const e = expected.neighbours[i]!;
        expect(v.x0, `${seed} sąsiad ${i} x0`).toBeCloseTo(e[0], 5);
        expect(v.x1, `${seed} sąsiad ${i} x1`).toBeCloseTo(e[1], 5);
        expect([v.floors, v.style, v.main], `${seed} sąsiad ${i}`).toEqual([e[2], e[3], e[4]]);
      });
    }
  });

  it('przyrost sklepu to różnica kratek względem pickLot razy kratka, równa różnicy szerokości obrysu; na poziomie 0 jest zerem', () => {
    const base = (seed: string): number => {
      const o = storeOuter(layoutFor(seed, 0));
      return o.x1 - o.x0;
    };
    for (const [, seed] of ALL) {
      expect(grownWidth(layoutFor(seed, 0), seed), seed).toBe(0);
      let previous = 0;
      for (const level of LEVELS) {
        const layout = layoutFor(seed, level);
        const o = storeOuter(layout);
        const delta = grownWidth(layout, seed);
        expect(delta, `${seed} poziom ${level}`).toBeCloseTo((layout.lot.interiorWidth - pickLot(seed).interiorWidth) * CELL_SIZE_M, 9);
        expect(delta, `${seed} poziom ${level}`).toBeCloseTo(o.x1 - o.x0 - base(seed), 9);
        expect(delta, `${seed} poziom ${level} rośnie z remontami`).toBeGreaterThanOrEqual(previous);
        previous = delta;
      }
      expect(previous, `${seed}: po ostatnim remoncie sklep jest szerszy`).toBeGreaterThan(0);
    }
  });

  it('strona przejęcia: kamienica nienarożna przeciwna do bramy (obie strony się zdarzają), narożna żadna, blok i pawilon zawsze maxX', () => {
    const sides = new Map<LotKind, Set<string>>();
    for (const [kind, seed] of ALL) {
      const taken = expectedTakenSide(seed);
      for (const level of LEVELS) {
        const plan = planRow(layoutFor(seed, level), seed, 0);
        const signs = plan.neighbours.map((n) => n.rentSign);
        if (taken === null) expect(signs, `${seed} poziom ${level}`).toEqual([false, false]);
        else expect(signs.indexOf(true), `${seed} poziom ${level}`).toBe(taken === 'minX' ? 0 : 1);
      }
      if (taken) sides.set(kind, (sides.get(kind) ?? new Set()).add(taken));
    }
    // narożna kamienica (kiełbasa-12 i d) jest w zestawie; kamienica nienarożna ma obie strony (brama), blok i pawilon tylko
    // dalszą od domyślnej kamery
    expect([...sides.get('blok')!]).toEqual(['maxX']);
    expect([...sides.get('pawilon')!]).toEqual(['maxX']);
    expect(sides.get('kamienica')!.size).toBe(2);
    expect(ALL.filter(([, seed]) => cornerSide(layoutFor(seed, 0)) !== null).map(([, seed]) => seed)).toEqual(['kiełbasa-12', 'd']);
  });

  it('poziomy 1–3: sąsiad po stronie przejęcia ma szerokość max(w0 − Δ, 4) i przylega, drugi ma szerokość z poziomu 0 i przylega, bryła nad sklepem obejmuje sklep', () => {
    let clamped = 0;
    let shrunk = 0;
    for (const [, seed] of ALL) {
      const plan0 = planRow(layoutFor(seed, 0), seed);
      const taken = expectedTakenSide(seed);
      for (const level of [1, 2, 3]) {
        const layout = layoutFor(seed, level);
        const o = storeOuter(layout);
        const plan = planRow(layout, seed, level);
        const delta = grownWidth(layout, seed);
        const corner = cornerSide(layout);
        const lo = Math.min(...plan.own.map((v) => v.x0));
        const hi = Math.max(...plan.own.map((v) => v.x1));
        const label = `${seed} poziom ${level}`;

        // bryła nad sklepem: cały obrys sklepu, bez zmian względem tego, co było przed przejmowaniem
        const store = plan.own[0]!;
        expect(store.overStore, label).toBe(true);
        expect([store.x0, store.x1, store.z0, store.z1], label).toEqual([o.x0, o.x1, o.z0, o.z1]);
        expect([store.floors, store.style, store.main, plan.own.length], label).toEqual([plan0.own[0]!.floors, plan0.own[0]!.style, plan0.own[0]!.main, plan0.own.length]);

        plan.neighbours.forEach((n, i) => {
          const w0 = width(plan0.neighbours[i]!);
          const eaten = side(i) === taken;
          const expectedWidth = eaten ? Math.max(w0 - delta, MIN_TAKEN_NEIGHBOUR_W) : w0;
          expect(width(n), `${label} sąsiad ${i} (${eaten ? 'zjedzony' : 'drugi'})`).toBeCloseTo(expectedWidth, 6);
          if (eaten && w0 - delta < MIN_TAKEN_NEIGHBOUR_W) clamped++;
          if (eaten && delta > 0) shrunk++;
          // przyleganie do sklepu (albo do bramy kamienicy), a po stronie przecznicy za nią
          const gap = corner === side(i) ? SIDE_STREET.total : 0;
          if (i === 0) expect(n.x1, `${label} sąsiad 0 przylega`).toBeCloseTo(lo - gap, 6);
          else expect(n.x0, `${label} sąsiad 1 przylega`).toBeCloseTo(hi + gap, 6);
          // wszystkie losowania jak bez remontu: tylko szerokość się zmienia
          const before = plan0.neighbours[i]!;
          expect([n.style, n.floors, n.main, n.accent], `${label} sąsiad ${i}`).toEqual([before.style, before.floors, before.main, before.accent]);
          expect(n.mural, `${label} sąsiad ${i} mural`).toBe(before.mural);
        });
      }
    }
    expect(shrunk, 'sąsiad zjedzony przynajmniej raz').toBeGreaterThan(0);
    expect(clamped, 'próg 4 m zadziałał przynajmniej raz (poziom 3)').toBeGreaterThan(0);
  });

  it('sąsiad po stronie przejęcia nigdy nie jest węższy niż 4 m, a bez remontu nie jest zjedzony', () => {
    for (const [, seed] of ALL) {
      const taken = expectedTakenSide(seed);
      for (const level of LEVELS) {
        const plan = planRow(layoutFor(seed, level), seed, level);
        plan.neighbours.forEach((n, i) => {
          if (side(i) === taken) expect(width(n) + 1e-9, `${seed} poziom ${level}`).toBeGreaterThanOrEqual(MIN_TAKEN_NEIGHBOUR_W);
        });
      }
    }
  });
});

describe('przejęcie lokalu: kartka „DO WYNAJĘCIA”', () => {
  it('jest u sąsiada po stronie przejęcia na poziomach 0–2, nie ma jej na 3 ani u drugiego sąsiada, bryły nad sklepem i bramy', () => {
    expect(REMONTS).toHaveLength(3);
    for (const [, seed] of ALL) {
      const taken = expectedTakenSide(seed);
      for (const level of LEVELS) {
        const plan = planRow(layoutFor(seed, level), seed, level);
        const label = `${seed} poziom ${level}`;
        expect(plan.own.some((v) => v.rentSign || v.towardStore !== null), `${label} bryła i brama`).toBe(false);
        plan.neighbours.forEach((n, i) => {
          const expected = taken === side(i) && level < REMONTS.length;
          expect(n.rentSign, `${label} sąsiad ${i}`).toBe(expected);
          expect(n.towardStore, `${label} sąsiad ${i}`).toBe(i === 0 ? 'x1' : 'x0');
        });
      }
    }
  });

  it('kamienica narożna: kartki nie ma na żadnym poziomie, a oba sąsiedzi mają szerokość z poziomu 0', () => {
    for (const seed of ['kiełbasa-12', 'd']) {
      const plan0 = planRow(layoutFor(seed, 0), seed);
      for (const level of LEVELS) {
        const plan = planRow(layoutFor(seed, level), seed, level);
        expect(plan.neighbours.map((n) => n.rentSign), `${seed} poziom ${level}`).toEqual([false, false]);
        plan.neighbours.forEach((n, i) => expect(width(n), `${seed} poziom ${level} sąsiad ${i}`).toBeCloseTo(width(plan0.neighbours[i]!), 6));
      }
    }
  });

  /** Przebieg wierzchołków jednej siatki w komórkach witryn: kolejne wierzchołki z jednej komórki to jeden czworokąt. */
  type Quad = { cell: AtlasCellName; xMin: number; xMax: number; vertices: number };
  const WINDOW_CELLS: AtlasCellName[] = ['witryna', 'witrynaWynajem', 'brama'];
  function quadsOf(mesh: Mesh): Quad[] {
    const atlas = createFacadeAtlas();
    const rects = WINDOW_CELLS.map((name) => [name, atlas.cell(name)] as const);
    const uv = mesh.geometry.attributes.uv!;
    const pos = mesh.geometry.attributes.position!;
    const out: Quad[] = [];
    let open: Quad | null = null;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const hit = rects.find(([, r]) => u >= r[0] - 1e-6 && u <= r[2] + 1e-6 && v >= r[1] - 1e-6 && v <= r[3] + 1e-6)?.[0] ?? null;
      if (!hit) { open = null; continue; }
      if (!open || open.cell !== hit) { open = { cell: hit, xMin: Infinity, xMax: -Infinity, vertices: 0 }; out.push(open); }
      open.xMin = Math.min(open.xMin, pos.getX(i));
      open.xMax = Math.max(open.xMax, pos.getX(i));
      open.vertices++;
    }
    return out;
  }

  it('siatka: dokładnie jedna witryna z kartką, w przęśle najbliższym sklepu (nigdy w wejściu do klatki), tylko u sąsiada po stronie przejęcia', () => {
    for (const [kind, seed] of ALL) {
      const taken = expectedTakenSide(seed);
      for (const level of LEVELS) {
        const layout = layoutFor(seed, level);
        const plan = planRow(layout, seed, level);
        const built = buildBuildings(layout, seed, createFacadeAtlas(), plan);
        try {
          const label = `${kind} ${seed} poziom ${level}`;
          const meshOf = (name: string): Mesh => built.root.getObjectByName(`${name}:full`) as Mesh;
          expect(quadsOf(meshOf(`building:${kind}`)).filter((q) => q.cell === 'witrynaWynajem'), `${label} bryła nad sklepem`).toHaveLength(0);
          plan.neighbours.forEach((n, i) => {
            const quads = quadsOf(meshOf(`neighbour:${i}`));
            const signs = quads.filter((q) => q.cell === 'witrynaWynajem');
            if (!(taken === side(i) && level < REMONTS.length)) {
              expect(signs, `${label} sąsiad ${i}`).toHaveLength(0);
              return;
            }
            expect(signs, `${label} sąsiad ${i}`).toHaveLength(1);
            const sign = signs[0]!;
            expect(sign.vertices, label).toBe(6);
            const middle = (q: Quad): number => (q.xMin + q.xMax) / 2;
            const windows = quads.filter((q) => q.cell !== 'brama');
            // najbliżej sklepu spośród witryn: dla sąsiada z lewej (−x) to największe x, dla sąsiada z prawej najmniejsze
            for (const w of windows) {
              if (i === 0) expect(middle(sign), `${label} najbliżej sklepu`).toBeGreaterThanOrEqual(middle(w) - 1e-6);
              else expect(middle(sign), `${label} najbliżej sklepu`).toBeLessThanOrEqual(middle(w) + 1e-6);
            }
            // kartka nie wisi w wejściu do klatki
            for (const door of quads.filter((q) => q.cell === 'brama')) {
              expect(sign.xMax <= door.xMin + 1e-6 || sign.xMin >= door.xMax - 1e-6, `${label} kartka nie nakłada się na wejście`).toBe(true);
            }
          });
        } finally {
          built.dispose();
        }
      }
    }
  });

  it('gdy najbliższe przęsło jest wejściem do klatki, kartka wisi w najbliższej witrynie', () => {
    // blok z sąsiadem zjedzonym do 5,6 m od strony +x: dwa przęsła, wejście w przęśle 1, które stoi przy x0 (najbliżej sklepu)
    const layout = layoutFor('kiełbasa-42', 2);
    const plan = planRow(layout, 'kiełbasa-42', 2);
    const n = plan.neighbours[1]!;
    expect(n.rentSign).toBe(true);
    expect(n.towardStore).toBe('x0');
    expect(width(n)).toBeGreaterThan(2.9 * 1.5);
    expect(width(n)).toBeLessThan(2.9 * 2.5);   // dwa przęsła
    const built = buildBuildings(layout, 'kiełbasa-42', createFacadeAtlas(), plan);
    try {
      const quads = quadsOf(built.root.getObjectByName('neighbour:1:full') as Mesh);
      const doors = quads.filter((q) => q.cell === 'brama');
      const sign = quads.find((q) => q.cell === 'witrynaWynajem')!;
      expect(doors).toHaveLength(1);
      // wejście stoi bliżej sklepu (mniejsze x) niż kartka, która przeszła do dalszego przęsła
      expect(doors[0]!.xMax).toBeLessThanOrEqual(sign.xMin + 1e-6);
    } finally {
      built.dispose();
    }
  });
});

describe('przejęcie lokalu: napis na kartce w obu językach', () => {
  it('napisy kartki idą przez tr(): po polsku „DO WYNAJĘCIA”, po angielsku „TO LET”', () => {
    const rows = ['DO', 'WYNAJĘCIA', 'pytać w Centrali'];
    expect(rows.map((r) => tr(r))).toEqual(rows);
    lang.value = 'en';
    try {
      expect(rows.map((r) => tr(r))).toEqual(['TO', 'LET', 'ask Head Office']);
    } finally {
      lang.value = 'pl';
    }
  });
});

describe('przejęcie lokalu: ulica z poziomem remontu', () => {
  const failing = (): Promise<GLTF> => Promise.reject(new Error('brak sieci'));
  const views: StreetView[] = [];
  afterEach(() => {
    for (const v of views.splice(0)) v.dispose();
    vi.restoreAllMocks();
  });

  const signsIn = (view: StreetView, name: string): number => {
    const atlas = createFacadeAtlas();
    const r = atlas.cell('witrynaWynajem');
    const mesh = view.root.getObjectByName(`${name}:full`) as Mesh;
    const uv = mesh.geometry.attributes.uv!;
    let hits = 0;
    for (let i = 0; i < uv.count; i++) {
      if (uv.getX(i) >= r[0] - 1e-6 && uv.getX(i) <= r[2] + 1e-6 && uv.getY(i) >= r[1] - 1e-6 && uv.getY(i) <= r[3] + 1e-6) hits++;
    }
    return hits / 6;
  };

  it('buildStreet(layout, seed, load, remontLevel) przekazuje poziom do planu: kartka na poziomach 0–2, brak na 3, domyślnie poziom 0', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const seed of ['kiełbasa-42', 'traszka-1', 'traszka-11']) {
      const taken = expectedTakenSide(seed)!;
      const i = taken === 'minX' ? 0 : 1;
      for (const level of LEVELS) {
        const view = await buildStreet(layoutFor(seed, level), seed, failing, level);
        views.push(view);
        expect(signsIn(view, `neighbour:${i}`), `${seed} poziom ${level}`).toBe(level < REMONTS.length ? 1 : 0);
        expect(signsIn(view, `neighbour:${1 - i}`), `${seed} poziom ${level} drugi sąsiad`).toBe(0);
      }
      const view = await buildStreet(layoutFor(seed, 0), seed, failing);
      views.push(view);
      expect(signsIn(view, `neighbour:${i}`), `${seed} domyślny poziom`).toBe(1);
    }
  });

  it('kamienica narożna: na żadnym poziomie ulica nie ma kartki', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const seed of ['kiełbasa-12', 'd']) {
      for (const level of LEVELS) {
        const view = await buildStreet(layoutFor(seed, level), seed, failing, level);
        views.push(view);
        for (const name of ['neighbour:0', 'neighbour:1']) expect(signsIn(view, name), `${seed} poziom ${level} ${name}`).toBe(0);
      }
    }
  });
});
