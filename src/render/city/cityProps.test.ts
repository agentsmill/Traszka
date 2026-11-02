import { describe, expect, it } from 'vitest';
import { Color, InstancedMesh, Matrix4, Mesh, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { BLOCK_M } from '@/sim/city/districts';
import { generateCity, STREET_HALF_M } from '@/sim/city/generateCity';
import { streetIntensity } from '@/sim/city/traffic';
import { CITY_SIZE, type CityState, type LotState } from '@/sim/city/types';
import { PALETTE } from '@/render/style';
import { buildCity, countDrawCalls, countShadowCasters as countFromBuildCity, streetRect as streetRectFromBuildCity } from './buildCity';
import { planCityBuildings } from './cityBuildings';
import { CITY_M, CITY_UNIT_M, streetRect } from './cityCoords';
import {
  CAR_LENGTH_M, CAR_SPEED_MPS, CAR_WIDTH_M, CARS_MAX, LANE_OFFSET_M, TREES_MAX, TREE_SCALE_MAX, buildCityProps, countShadowCasters, type CityProps,
} from './cityProps';

/** Dziesięć seedów z testów generatora miasta. */
const SEEDS = ['kiełbasa-42', 'kiełbasa-12', 'a', 'b', 'traszka-1', 'traszka-2', 'miasto-1', 'miasto-2', 'miasto-3', 'miasto-4'];

const cities = new Map<string, CityState>();
const cityOf = (seed: string): CityState => {
  let c = cities.get(seed);
  if (!c) { c = generateCity(seed); cities.set(seed, c); }
  return c;
};
const generated = (city: CityState): Record<number, LotState> => Object.fromEntries(city.lots.map((l) => [l.id, l.state]));
const propsOf = (seed: string, cars: boolean): CityProps => {
  const city = cityOf(seed);
  return buildCityProps(city, planCityBuildings(city), { cars });
};

const instanced = (root: Object3D, name: string): InstancedMesh | null => {
  const o = root.getObjectByName(name);
  return o && (o as InstancedMesh).isInstancedMesh ? (o as InstancedMesh) : null;
};
const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
  return out;
};
/** Siatka i wszystkie jej przodkowie widoczni (jak widzi to renderer). */
const visibleInTree = (o: Object3D): boolean => { for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false; return true; };
/** Liczba aut, które renderer narysuje: widoczna siatka aut ma `count` instancji. */
const visibleCars = (root: Object3D): number => {
  const m = instanced(root, 'cars');
  return m && visibleInTree(m) ? m.count : 0;
};

const toMetres = (v: number): number => v * CITY_UNIT_M + CITY_M / 2;
const matrix = new Matrix4();
/** Pozycja (metry miasta) i wersor jazdy (x, y miasta) instancji `i`. */
function instanceAt(mesh: InstancedMesh, i: number): { x: number; y: number; hx: number; hy: number } {
  mesh.getMatrixAt(i, matrix);
  const p = new Vector3().setFromMatrixPosition(matrix);
  return { x: toMetres(p.x), y: toMetres(p.z), hx: matrix.elements[0]!, hy: matrix.elements[2]! };
}
const carsOf = (props: CityProps): { x: number; y: number; hx: number; hy: number }[] => {
  const m = instanced(props.root, 'cars');
  if (!m) return [];
  return Array.from({ length: m.count }, (_, i) => instanceAt(m, i));
};

/** Prostokąt ulicy w metrach i odcinek, do którego należy punkt (ulice nie nachodzą na siebie). */
const segmentAt = (city: CityState, x: number, y: number): number => city.streets.findIndex((s) => {
  const [x0, y0, x1, y1] = streetRect(s);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
});
/** Odcinki sąsiadujące z kwartałem Biurowców. */
function biurowceSegments(city: CityState): Set<number> {
  const out = new Set<number>();
  city.streets.forEach((s, i) => {
    const horizontal = s.ay === s.by;
    const blocks = horizontal
      ? [[s.ax / BLOCK_M, s.ay / BLOCK_M - 1], [s.ax / BLOCK_M, s.ay / BLOCK_M]]
      : [[s.ax / BLOCK_M - 1, s.ay / BLOCK_M], [s.ax / BLOCK_M, s.ay / BLOCK_M]];
    for (const [bx, by] of blocks) {
      if (bx! >= 0 && bx! < CITY_SIZE && by! >= 0 && by! < CITY_SIZE && city.blocks[by! * CITY_SIZE + bx!] === 'biurowce') out.add(i);
    }
  });
  return out;
}

describe('stałe i eksporty', () => {
  it('limity z briefu: 400 drzew, 80 aut, prędkość 8 m/s', () => {
    expect(TREES_MAX).toBe(400);
    expect(CARS_MAX).toBe(80);
    expect(CAR_SPEED_MPS).toBe(8);
  });

  it('streetRect i countShadowCasters mają jedno źródło: buildCity.ts je tylko wystawia (bez cyklu importów)', () => {
    expect(streetRectFromBuildCity).toBe(streetRect);
    expect(countFromBuildCity).toBe(countShadowCasters);
  });
});

describe('countShadowCasters', () => {
  it('liczy widoczne siatki rzucające cień (siatka instancjonowana to jedna), pomija ukryte gałęzie i siatki bez cienia', () => {
    const props = propsOf(SEEDS[0]!, true);
    const trees = instanced(props.root, 'trees')!;
    props.setShadows(true);
    props.tick(0, 8, false);
    expect(trees.castShadow).toBe(true);
    expect(countShadowCasters(props.root)).toBe(1);
    trees.visible = false;
    expect(countShadowCasters(props.root)).toBe(0);
    trees.visible = true;
    props.root.visible = false;
    expect(countShadowCasters(props.root)).toBe(0);
    props.root.visible = true;
    trees.castShadow = false;
    expect(countShadowCasters(props.root)).toBe(0);
    props.dispose();
  });
});

describe('drzewa', () => {
  it('jedna InstancedMesh z pniem i koroną (kolory wierzchołków), najwyżej TREES_MAX, dla dziesięciu seedów', () => {
    const counts: number[] = [];
    for (const seed of SEEDS) {
      const props = propsOf(seed, false);
      const all = props.root.children.filter((o) => (o as InstancedMesh).isInstancedMesh && o.name === 'trees');
      expect(all.length, seed).toBe(1);
      const trees = all[0] as InstancedMesh;
      expect(trees.count, seed).toBeGreaterThan(30);
      expect(trees.count, seed).toBeLessThanOrEqual(TREES_MAX);
      expect((trees.material as Material & { vertexColors: boolean }).vertexColors, seed).toBe(true);
      // pień (brąz: r > g) i korona (zieleń: g > r) w jednej geometrii
      const color = trees.geometry.getAttribute('color');
      let trunk = 0;
      let crown = 0;
      for (let i = 0; i < color.count; i++) {
        if (color.getX(i) > color.getY(i)) trunk++;
        else if (color.getY(i) > color.getX(i)) crown++;
      }
      expect(trunk, seed).toBeGreaterThan(0);
      expect(crown, seed).toBeGreaterThan(trunk);
      counts.push(trees.count);
      props.dispose();
    }
    expect(Math.max(...counts)).toBeLessThanOrEqual(TREES_MAX);
  });

  it('drzewa stoją we wnętrzach kwartałów: nie w obrysach budynków (z zapasem na koronę), nie na ulicach i nie na brzegu kwartału', () => {
    const crown = 2.5;
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const plans = planCityBuildings(city);
      const props = buildCityProps(city, plans, { cars: false });
      const trees = instanced(props.root, 'trees')!;
      const rects = plans.map((p) => ({ x0: toMetres(p.x0), x1: toMetres(p.x1), y0: toMetres(p.z0), y1: toMetres(p.z1) }));
      for (let i = 0; i < trees.count; i++) {
        const t = instanceAt(trees, i);
        const label = `${seed} drzewo ${i} (${t.x.toFixed(1)}, ${t.y.toFixed(1)})`;
        for (const r of rects) {
          const inside = t.x > r.x0 - crown && t.x < r.x1 + crown && t.y > r.y0 - crown && t.y < r.y1 + crown;
          if (inside) throw new Error(`${label}: w obrysie budynku (z zapasem ${crown} m)`);
        }
        expect(segmentAt(city, t.x, t.y), label).toBe(-1);   // nie na ulicy
        const bx = Math.floor(t.x / BLOCK_M);
        const by = Math.floor(t.y / BLOCK_M);
        expect(bx >= 0 && bx < CITY_SIZE && by >= 0 && by < CITY_SIZE, label).toBe(true);
        const lx = t.x - bx * BLOCK_M;
        const ly = t.y - by * BLOCK_M;
        for (const v of [lx, ly]) {
          expect(v, label).toBeGreaterThanOrEqual(STREET_HALF_M + crown - 1e-6);
          expect(v, label).toBeLessThanOrEqual(BLOCK_M - STREET_HALF_M - crown + 1e-6);
        }
      }
      props.dispose();
    }
  });

  it('w kwartałach parku co ok. 12 m, a reszta na podwórkach (wnętrza kwartałów z lokalami)', () => {
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const props = buildCityProps(city, planCityBuildings(city), { cars: false });
      const trees = instanced(props.root, 'trees')!;
      const pts = Array.from({ length: trees.count }, (_, i) => instanceAt(trees, i));
      const blockOf = (p: { x: number; y: number }): number => Math.floor(p.y / BLOCK_M) * CITY_SIZE + Math.floor(p.x / BLOCK_M);
      const parks = pts.filter((p) => city.blocks[blockOf(p)] === 'park');
      const yards = pts.filter((p) => city.blocks[blockOf(p)] !== 'park');
      expect(parks.length, seed).toBeGreaterThan(40);   // każde miasto ma park
      expect(yards.length, seed).toBeGreaterThan(20);   // i podwórka
      // odległość do najbliższego sąsiada w parku: mediana bliska 12 m, żaden nie stoi na drugim
      const nearest = parks.map((p) => Math.min(...parks.filter((q) => q !== p && blockOf(q) === blockOf(p)).map((q) => Math.hypot(p.x - q.x, p.y - q.y))))
        .filter(Number.isFinite).sort((a, b) => a - b);
      expect(nearest[0], seed).toBeGreaterThan(6);
      const median = nearest[Math.floor(nearest.length / 2)]!;
      expect(median, seed).toBeGreaterThan(9);
      expect(median, seed).toBeLessThan(15);
      props.dispose();
    }
  });

  it('deterministycznie z seeda: ten sam seed daje te same macierze co do bitu, inny seed inne', () => {
    const a = instanced(propsOf(SEEDS[0]!, false).root, 'trees')!;
    const b = instanced(propsOf(SEEDS[0]!, false).root, 'trees')!;
    const c = instanced(propsOf(SEEDS[1]!, false).root, 'trees')!;
    expect(b.count).toBe(a.count);
    expect(Array.from(b.instanceMatrix.array.slice(0, a.count * 16))).toEqual(Array.from(a.instanceMatrix.array.slice(0, a.count * 16)));
    expect(Array.from(c.instanceMatrix.array.slice(0, 64))).not.toEqual(Array.from(a.instanceMatrix.array.slice(0, 64)));
  });

  it('korona i pień nie wychodzą ponad najwyższe budynki: najwyższy wierzchołek drzewa mieści się w kamerze cienia', () => {
    const props = propsOf(SEEDS[0]!, false);
    const trees = instanced(props.root, 'trees')!;
    trees.geometry.computeBoundingBox();
    const top = trees.geometry.boundingBox!.max.y * TREE_SCALE_MAX;   // największe drzewo ma skalę do TREE_SCALE_MAX
    expect(top * CITY_UNIT_M).toBeGreaterThan(5);          // to prawdziwe drzewo (≥ 5 m), a nie krzaczek
    expect(top * CITY_UNIT_M).toBeLessThan(14);
    props.dispose();
  });
});

describe('auta', () => {
  it('bez cars nie ma siatki aut: zero aut, także po tick', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const props = propsOf(seed, false);
      expect(instanced(props.root, 'cars'), seed).toBeNull();
      props.tick(10, 8, false);
      expect(visibleCars(props.root), seed).toBe(0);
      expect(props.stats().cars, seed).toBe(0);
      props.dispose();
    }
  });

  it('jedna InstancedMesh z kolorami instancji z PALETTE.clothes, pojemność CARS_MAX, bez cienia', () => {
    const props = propsOf(SEEDS[0]!, true);
    const cars = instanced(props.root, 'cars')!;
    expect(cars).not.toBeNull();
    expect(props.root.children.filter((o) => (o as InstancedMesh).isInstancedMesh && o.name === 'cars')).toHaveLength(1);
    expect(cars.instanceMatrix.count).toBe(CARS_MAX);
    expect(cars.instanceColor).not.toBeNull();   // od razu, jeszcze przed pierwszym autem (bez drugiej kompilacji shadera)
    expect(cars.castShadow).toBe(false);
    props.setShadows(true);
    props.tick(0, 8, false);
    expect(cars.castShadow).toBe(false);
    expect(cars.count).toBeGreaterThan(0);
    expect(cars.instanceColor).not.toBeNull();
    const allowed = new Set(PALETTE.clothes.map((hex) => new Color(hex).getHex()));
    const c = new Color();
    for (let i = 0; i < cars.count; i++) {
      cars.getColorAt(i, c);
      expect(allowed.has(c.getHex()), `auto ${i}`).toBe(true);
    }
    props.dispose();
  });

  it('auta leżą w prostokątach swoich ulic i jadą prawym pasem, o każdej godzinie, w dni robocze i w weekend', () => {
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const props = buildCityProps(city, planCityBuildings(city), { cars: true });
      let seen = 0;
      for (const weekend of [false, true]) {
        for (const hour of [0, 3, 8, 12, 17, 22]) {
          props.tick(0.7, hour, weekend);
          for (const car of carsOf(props)) {
            seen++;
            const label = `${seed} ${hour}:00 ${weekend ? 'weekend' : 'roboczy'} (${car.x.toFixed(1)}, ${car.y.toFixed(1)})`;
            const seg = segmentAt(city, car.x, car.y);
            expect(seg, label).toBeGreaterThanOrEqual(0);
            const s = city.streets[seg]!;
            const [x0, y0, x1, y1] = streetRect(s);
            const horizontal = s.ay === s.by;
            // cały korpus w prostokącie ulicy
            const halfAlong = CAR_LENGTH_M / 2;
            const halfAcross = CAR_WIDTH_M / 2;
            if (horizontal) {
              expect(car.x - halfAlong, label).toBeGreaterThanOrEqual(x0 - 1e-6);
              expect(car.x + halfAlong, label).toBeLessThanOrEqual(x1 + 1e-6);
              expect(car.y - halfAcross, label).toBeGreaterThanOrEqual(y0 - 1e-6);
              expect(car.y + halfAcross, label).toBeLessThanOrEqual(y1 + 1e-6);
              // jazda wzdłuż ulicy, prawy pas: na wschód po południowej połowie (y większe), na zachód po północnej
              expect(Math.abs(car.hx), label).toBeCloseTo(1, 5);
              expect(car.y - s.ay, label).toBeCloseTo(car.hx > 0 ? LANE_OFFSET_M : -LANE_OFFSET_M, 3);   // macierze są float32
            } else {
              expect(car.y - halfAlong, label).toBeGreaterThanOrEqual(y0 - 1e-6);
              expect(car.y + halfAlong, label).toBeLessThanOrEqual(y1 + 1e-6);
              expect(car.x - halfAcross, label).toBeGreaterThanOrEqual(x0 - 1e-6);
              expect(car.x + halfAcross, label).toBeLessThanOrEqual(x1 + 1e-6);
              // na południe po zachodniej połowie (x mniejsze), na północ po wschodniej
              expect(Math.abs(car.hy), label).toBeCloseTo(1, 5);
              expect(car.x - s.ax, label).toBeCloseTo(car.hy > 0 ? -LANE_OFFSET_M : LANE_OFFSET_M, 3);
            }
          }
        }
      }
      expect(seen, seed).toBeGreaterThan(50);
      props.dispose();
    }
  });

  it('auta jadą ok. 8 m/s wzdłuż swojego pasa', () => {
    const props = propsOf(SEEDS[0]!, true);
    props.tick(0, 8, false);
    const before = carsOf(props);
    props.tick(0.5, 8, false);
    const after = carsOf(props);
    expect(after.length).toBe(before.length);
    let measured = 0;
    for (let i = 0; i < before.length; i++) {
      const moved = (after[i]!.x - before[i]!.x) * before[i]!.hx + (after[i]!.y - before[i]!.y) * before[i]!.hy;
      if (Math.abs(moved - CAR_SPEED_MPS * 0.5) < 1e-3) measured++;   // macierze są float32   // pozostałe zawinęły się na końcu odcinka
    }
    expect(measured).toBeGreaterThan(before.length / 2);
    props.dispose();
  });

  it('auta tego samego pasa nie nachodzą na siebie przez cały obieg', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const city = cityOf(seed);
      const props = buildCityProps(city, planCityBuildings(city), { cars: true });
      for (const [hour, weekend] of [[8, false], [17, false], [12, true]] as const) {
        for (let step = 0; step < 24; step++) {
          props.tick(step === 0 ? 0 : 1.7, hour, weekend);
          // pas = odcinek + kierunek; współrzędna wzdłuż ulicy i obwód obiegu (auto zawija się na końcu odcinka, więc odstęp liczy się cyklicznie)
          const lanes = new Map<string, { along: number[]; loop: number }>();
          for (const car of carsOf(props)) {
            const seg = segmentAt(city, car.x, car.y);
            const s = city.streets[seg]!;
            const [x0, y0, x1, y1] = streetRect(s);
            const horizontal = s.ay === s.by;
            const key = `${seg}:${Math.abs(car.hx) > 0.5 ? Math.sign(car.hx) : Math.sign(car.hy)}`;   // strona jazdy wzdłuż osi ulicy
            const lane = lanes.get(key) ?? { along: [], loop: (horizontal ? x1 - x0 : y1 - y0) - CAR_LENGTH_M };
            lane.along.push(horizontal ? car.x : car.y);
            lanes.set(key, lane);
          }
          for (const [key, lane] of lanes) {
            for (let a = 0; a < lane.along.length; a++) {
              for (let b = a + 1; b < lane.along.length; b++) {
                const d = Math.abs(lane.along[a]! - lane.along[b]!);
                expect(Math.min(d, lane.loop - d), `${seed} ${key} krok ${step}`).toBeGreaterThan(CAR_LENGTH_M + 1);
              }
            }
          }
        }
      }
      props.dispose();
    }
  });

  it('w szczycie (8:00) aut jest więcej niż w nocy (3:00), a ruch idzie za natężeniem: pusty odcinek bez aut, tłoczny z autami', () => {
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const props = buildCityProps(city, planCityBuildings(city), { cars: true });
      props.tick(0, 3, false);
      const night = props.stats().cars;
      props.tick(0, 8, false);
      const peak = props.stats().cars;
      expect(peak, seed).toBeGreaterThan(night);
      expect(peak, seed).toBeGreaterThan(CARS_MAX / 3);
      expect(peak, seed).toBeLessThanOrEqual(CARS_MAX);
      // proporcjonalnie do natężenia odcinka w tej godzinie
      const perSeg = new Map<number, number>();
      for (const car of carsOf(props)) perSeg.set(segmentAt(city, car.x, car.y), (perSeg.get(segmentAt(city, car.x, car.y)) ?? 0) + 1);
      const ranked = city.streets.map((s, i) => ({ i, v: streetIntensity(city.sources, s, 8, false) })).sort((p, q) => q.v - p.v);
      for (const { i, v } of ranked) if (v === 0) expect(perSeg.get(i) ?? 0, `${seed} odcinek ${i}`).toBe(0);
      const quarter = Math.floor(ranked.length / 4);
      const half = Math.floor(ranked.length / 2);
      const sum = (rows: typeof ranked): number => rows.reduce((n, r) => n + (perSeg.get(r.i) ?? 0), 0);
      expect(sum(ranked.slice(0, quarter)), seed).toBeGreaterThan(sum(ranked.slice(-quarter)));   // najtłoczniejsza ćwiartka ma więcej niż najluźniejsza
      expect(sum(ranked.slice(0, half)), seed).toBeGreaterThan(sum(ranked.slice(-half)));
      props.dispose();
    }
  });

  it('w weekend w Biurowcach aut jest mniej niż w dzień roboczy (8:00), a w całym mieście nigdy więcej niż CARS_MAX', () => {
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const props = buildCityProps(city, planCityBuildings(city), { cars: true });
      const office = biurowceSegments(city);
      expect(office.size, seed).toBeGreaterThan(5);
      const inOffices = (): number => carsOf(props).filter((c) => office.has(segmentAt(city, c.x, c.y))).length;
      props.tick(0, 8, false);
      const weekday = inOffices();
      props.tick(0, 8, true);
      const weekend = inOffices();
      expect(weekend, seed).toBeLessThan(weekday);
      for (const w of [false, true]) {
        for (let h = 0; h < 24; h++) {
          props.tick(0, h, w);
          expect(props.stats().cars, `${seed} ${h}:00`).toBeLessThanOrEqual(CARS_MAX);
        }
      }
      props.dispose();
    }
  });

  it('deterministycznie z seeda: ten sam seed i te same tiki dają te same macierze i kolory co do bitu, inny seed inne', () => {
    const run = (seed: string): CityProps => {
      const p = propsOf(seed, true);
      p.tick(0, 7, false);
      p.tick(2.3, 8, false);
      p.tick(0.4, 9, false);
      return p;
    };
    const a = run(SEEDS[0]!);
    const b = run(SEEDS[0]!);
    const c = run(SEEDS[1]!);
    const ca = instanced(a.root, 'cars')!;
    const cb = instanced(b.root, 'cars')!;
    const cc = instanced(c.root, 'cars')!;
    expect(cb.count).toBe(ca.count);
    expect(Array.from(cb.instanceMatrix.array)).toEqual(Array.from(ca.instanceMatrix.array));
    expect(Array.from(cb.instanceColor!.array)).toEqual(Array.from(ca.instanceColor!.array));
    expect(Array.from(cc.instanceMatrix.array)).not.toEqual(Array.from(ca.instanceMatrix.array));
  });

  it('warstwy chowają drzewa i auta (zero widocznych aut), tick w warstwie nic nie robi, a powrót do makiety je przywraca', () => {
    const props = propsOf(SEEDS[0]!, true);
    const trees = instanced(props.root, 'trees')!;
    props.tick(0, 8, false);
    expect(visibleCars(props.root)).toBeGreaterThan(0);
    expect(visibleInTree(trees)).toBe(true);
    for (const layer of ['ruch', 'dzielnice'] as const) {
      props.setLayer(layer);
      expect(visibleCars(props.root), layer).toBe(0);
      expect(props.stats(), layer).toEqual({ trees: 0, cars: 0 });
      expect(visibleInTree(trees), layer).toBe(false);
      expect(countDrawCalls(props.root), layer).toBe(0);
      expect(countShadowCasters(props.root), layer).toBe(0);
      props.tick(5, 8, false);
      expect(visibleCars(props.root), layer).toBe(0);
    }
    props.setLayer('makieta');
    props.tick(0, 8, false);
    expect(visibleCars(props.root)).toBeGreaterThan(0);
    expect(visibleInTree(trees)).toBe(true);
    expect(props.stats().trees).toBe(trees.count);
    props.dispose();
  });

  it('dispose zwalnia geometrie, materiały i siatki instancjonowane (bufory instancji), odpina korzeń i jest idempotentne', () => {
    const props = propsOf(SEEDS[0]!, true);
    const holder = new Mesh();
    holder.add(props.root);
    props.tick(0, 8, false);
    const meshes = meshesOf(props.root);
    expect(meshes).toHaveLength(2);
    const geometries = new Set<BufferGeometry>(meshes.map((m) => m.geometry));
    const materials = new Set<Material>(meshes.map((m) => m.material as Material));
    let g = 0;
    let m = 0;
    let i = 0;
    for (const geo of geometries) geo.addEventListener('dispose', () => { g++; });
    for (const mat of materials) mat.addEventListener('dispose', () => { m++; });
    for (const mesh of meshes) (mesh as unknown as { addEventListener(t: string, f: () => void): void }).addEventListener('dispose', () => { i++; });
    props.dispose();
    expect([g, m, i]).toEqual([geometries.size, materials.size, meshes.length]);
    expect(props.root.parent).toBeNull();
    expect(() => props.dispose()).not.toThrow();
    expect([g, m, i]).toEqual([geometries.size, materials.size, meshes.length]);
  });
});

describe('budżet §19: draw calle i rzucające cień', () => {
  it('makieta z drzewami, autami i cieniami: draw calle + rzucające cień < 150 (10 seedów), a warstwy < 60', () => {
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const view = buildCity(city, generated(city), { detail: 'pelny', cars: true, shadows: true });
      view.setLayer('makieta');
      view.tick(0, 8, false);
      const calls = countDrawCalls(view.root);
      const casters = countShadowCasters(view.root);
      expect(calls, seed).toBeGreaterThan(11);          // ziemia (2) + chunki + drzewa + auta
      expect(casters, seed).toBeGreaterThan(5);         // chunki i drzewa
      expect(calls + casters, seed).toBeLessThan(150);
      expect(view.stats().cars, seed).toBeGreaterThan(0);
      for (const layer of ['ruch', 'dzielnice'] as const) {
        view.setLayer(layer);
        expect(countDrawCalls(view.root) + countShadowCasters(view.root), `${seed} ${layer}`).toBeLessThan(60);
        expect(view.stats().cars, `${seed} ${layer}`).toBe(0);
      }
      view.dispose();
    }
  });
});
