import { describe, expect, it } from 'vitest';
import { Color, type BufferAttribute, type BufferGeometry } from 'three';
import { BLOCK_M } from '@/sim/city/districts';
import { SLOT_M, STREET_HALF_M, generateCity } from '@/sim/city/generateCity';
import { CITY_SIZE, type CityLot, type CityState, type StoreDistrict } from '@/sim/city/types';
import { createFacadeAtlas, type AtlasCellName } from '@/render/street/facadeAtlas';
import { PALETTE } from '@/render/style';
import { CITY_UNIT_M } from './buildCity';
import {
  MOCKUP_TRIS_MAX, buildChunkGeometries, buildingStyle, planCityBuildings, setFront,
  type BuildingPlan, type BuildingStyle, type ChunkGeometry,
} from './cityBuildings';

/** Dziesięć seedów z testów generatora i widoku warstw miasta. */
const SEEDS = ['kiełbasa-42', 'kiełbasa-12', 'a', 'b', 'traszka-1', 'traszka-2', 'miasto-1', 'miasto-2', 'miasto-3', 'miasto-4'];

const atlas = createFacadeAtlas();
const CITY_M = CITY_SIZE * BLOCK_M;
const EPS = 1e-6;

interface Built { city: CityState; plans: BuildingPlan[]; chunks: ChunkGeometry[] }
const built = new Map<string, Built>();
const builtOf = (seed: string): Built => {
  let b = built.get(seed);
  if (!b) {
    const city = generateCity(seed);
    const plans = planCityBuildings(city);
    b = { city, plans, chunks: buildChunkGeometries(city, plans, atlas) };
    built.set(seed, b);
  }
  return b;
};

/** Prostokąt w metrach miasta (x miasta to x sceny, y miasta to z sceny). */
interface RectM { x0: number; x1: number; z0: number; z1: number }
const toM = (s: number): number => s * CITY_UNIT_M + CITY_M / 2;
const rectOf = (p: BuildingPlan): RectM => ({ x0: toM(p.x0), x1: toM(p.x1), z0: toM(p.z0), z1: toM(p.z1) });
const isNorth = (lot: CityLot): boolean => lot.y - lot.by * BLOCK_M < BLOCK_M / 2;

/** Slot lokalu: jego odcinek pierzei (SLOT_M) od krawędzi ulicy do połowy głębokości kwartału. */
function slotOf(lot: CityLot): RectM {
  const x0 = lot.x - Math.floor(SLOT_M / 2);
  const mid = lot.by * BLOCK_M + BLOCK_M / 2;
  return isNorth(lot)
    ? { x0, x1: x0 + SLOT_M, z0: lot.by * BLOCK_M + STREET_HALF_M, z1: mid }
    : { x0, x1: x0 + SLOT_M, z0: mid, z1: (lot.by + 1) * BLOCK_M - STREET_HALF_M };
}

/** Prostokąty ulic (z chodnikiem): pasy ±STREET_HALF_M wokół każdej linii siatki, przez całe miasto. */
const STREET_RECTS: RectM[] = (() => {
  const out: RectM[] = [];
  for (let j = 0; j <= CITY_SIZE; j++) {
    out.push({ x0: -STREET_HALF_M, x1: CITY_M + STREET_HALF_M, z0: j * BLOCK_M - STREET_HALF_M, z1: j * BLOCK_M + STREET_HALF_M });
    out.push({ x0: j * BLOCK_M - STREET_HALF_M, x1: j * BLOCK_M + STREET_HALF_M, z0: -STREET_HALF_M, z1: CITY_M + STREET_HALF_M });
  }
  return out;
})();

/** Wnętrza się przecinają (styk krawędzią to nie nachodzenie). */
const overlaps = (a: RectM, b: RectM): boolean => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
const inside = (a: RectM, b: RectM): boolean => a.x0 >= b.x0 - EPS && a.x1 <= b.x1 + EPS && a.z0 >= b.z0 - EPS && a.z1 <= b.z1 + EPS;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const trianglesOf = (chunks: readonly ChunkGeometry[]): number => chunks.reduce((n, c) => n + c.geometry.getAttribute('position').count / 3, 0);

/** Skrót FNV-1a bitów atrybutu `name` wszystkich chunków (w kolejności chunków). */
function attrHash(chunks: readonly ChunkGeometry[], name = 'position'): string {
  let h = 0x811c9dc5;
  for (const c of chunks) {
    h = Math.imul(h ^ c.chunk, 0x01000193);
    const a = c.geometry.getAttribute(name).array as Float32Array;
    const words = new Uint32Array(a.buffer, a.byteOffset, a.length);
    for (const w of words) h = Math.imul(h ^ w, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
const positionHash = (chunks: readonly ChunkGeometry[]): string => attrHash(chunks, 'position');

/** Wszystkie kolory PALETTE (płasko) i biel pod komórki atlasu z własnym kolorem. */
const PALETTE_COLORS: Set<string> = (() => {
  const out = new Set<string>(['#ffffff']);
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.add(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(PALETTE);
  return out;
})();

/** Obszar chunku (2 × 2 kwartały) w metrach. */
const chunkArea = (chunk: number): RectM => {
  const cx = (chunk % (CITY_SIZE / 2)) * 2 * BLOCK_M;
  const cz = Math.floor(chunk / (CITY_SIZE / 2)) * 2 * BLOCK_M;
  return { x0: cx, x1: cx + 2 * BLOCK_M, z0: cz, z1: cz + 2 * BLOCK_M };
};

/** UV wierzchołka `i` leżą w komórce atlasu (z tolerancją Float32). */
const uvIn = (g: BufferGeometry, i: number, cell: AtlasCellName): boolean => {
  const [u0, v0, u1, v1] = atlas.cell(cell);
  const uv = g.getAttribute('uv');
  const u = uv.getX(i);
  const v = uv.getY(i);
  return u >= u0 - 1e-6 && u <= u1 + 1e-6 && v >= v0 - 1e-6 && v <= v1 + 1e-6;
};

const EXPECTED_STYLE: Record<StoreDistrict, BuildingStyle> = { osiedle: 'blok', srodmiescie: 'kamienica', dworzec: 'pawilon', biurowce: 'biurowiec' };

describe('planCityBuildings: style i liczba brył', () => {
  it('buildingStyle bierze styl z dzielnicy: Osiedle blok, Śródmieście kamienica, Dworzec pawilon, Biurowce biurowiec', () => {
    for (const seed of SEEDS) {
      const { city, plans } = builtOf(seed);
      for (const lot of city.lots) {
        expect(buildingStyle(lot), `${seed} #${lot.id}`).toBe(EXPECTED_STYLE[lot.district]);
        expect(plans[lot.id]!.style, `${seed} #${lot.id}`).toBe(EXPECTED_STYLE[lot.district]);
      }
    }
  });

  it('jeden plan na lokal (w kolejności id) i jeden dworzec bez lokalu na końcu', () => {
    for (const seed of SEEDS) {
      const { city, plans } = builtOf(seed);
      expect(plans, seed).toHaveLength(city.lots.length + 1);
      city.lots.forEach((lot, i) => expect(plans[i]!.lotId, seed).toBe(lot.id));
      const station = plans[plans.length - 1]!;
      expect(station.lotId, seed).toBeNull();
      expect(station.style, seed).toBe('dworzec');
      expect(plans.filter((p) => p.style === 'dworzec'), seed).toHaveLength(1);
      expect(plans.filter((p) => p.lotId === null), seed).toHaveLength(1);
    }
  });

  it('kondygnacje i wysokości wg stylu (blok 4–11 po 2,8 m, kamienica 4–5 po 3,3 m, pawilon 1 po 3,5 m, biurowiec 6–14 po 3,5 m)', () => {
    const ranges: Record<Exclude<BuildingStyle, 'dworzec'>, [number, number, number]> = {
      blok: [4, 11, 2.8], kamienica: [4, 5, 3.3], pawilon: [1, 1, 3.5], biurowiec: [6, 14, 3.5],
    };
    const seen = new Map<string, Set<number>>();
    for (const seed of SEEDS) {
      for (const p of builtOf(seed).plans) {
        if (p.style === 'dworzec') {
          expect(p.height * CITY_UNIT_M, seed).toBeGreaterThanOrEqual(10);
          expect(p.height * CITY_UNIT_M, seed).toBeLessThanOrEqual(14);
          continue;
        }
        const [lo, hi, floorM] = ranges[p.style];
        expect(p.floors, `${seed} ${p.style}`).toBeGreaterThanOrEqual(lo);
        expect(p.floors, `${seed} ${p.style}`).toBeLessThanOrEqual(hi);
        expect(p.height * CITY_UNIT_M, `${seed} ${p.style}`).toBeCloseTo(p.floors * floorM, 6);
        if (!seen.has(p.style)) seen.set(p.style, new Set());
        seen.get(p.style)!.add(p.floors);
      }
    }
    // cały zakres kondygnacji występuje (na dziesięciu miastach)
    for (const [style, [lo, hi]] of Object.entries(ranges)) {
      for (let f = lo; f <= hi; f++) expect(seen.get(style)?.has(f), `${style} ${f}`).toBe(true);
    }
  });

  it('mediana wysokości biurowców jest najwyższa, a pawilonów najniższa', () => {
    for (const seed of SEEDS) {
      const by = (style: BuildingStyle): number => median(builtOf(seed).plans.filter((p) => p.style === style).map((p) => p.height));
      const office = by('biurowiec');
      const pavilion = by('pawilon');
      for (const other of ['blok', 'kamienica'] as const) {
        expect(office, `${seed} ${other}`).toBeGreaterThan(by(other));
        expect(pavilion, `${seed} ${other}`).toBeLessThan(by(other));
      }
    }
  });

  it('kolory brył to wpisy z PALETTE, front od strony ulicy lokalu', () => {
    for (const seed of SEEDS) {
      const { city, plans } = builtOf(seed);
      for (const lot of city.lots) {
        const p = plans[lot.id]!;
        expect(p.front, `${seed} #${lot.id}`).toBe(isNorth(lot) ? 'n' : 's');
      }
      for (const p of plans) {
        expect(PALETTE_COLORS.has(p.main), `${seed} ${p.style} ${p.main}`).toBe(true);
        expect(PALETTE_COLORS.has(p.accent), `${seed} ${p.style} ${p.accent}`).toBe(true);
      }
    }
  });
});

describe('planCityBuildings: obrysy', () => {
  it('obrys każdego budynku lokalu mieści się w slocie lokalu', () => {
    for (const seed of SEEDS) {
      const { city, plans } = builtOf(seed);
      for (const lot of city.lots) {
        const r = rectOf(plans[lot.id]!);
        expect(inside(r, slotOf(lot)), `${seed} #${lot.id} ${JSON.stringify(r)}`).toBe(true);
        expect(r.x1 - r.x0, `${seed} #${lot.id}`).toBeGreaterThan(5);
        expect(r.z1 - r.z0, `${seed} #${lot.id}`).toBeGreaterThan(4);
      }
    }
  });

  it('obrysy (z dworcem) nie nachodzą na siebie ani na prostokąty ulic', () => {
    for (const seed of SEEDS) {
      const { city, plans } = builtOf(seed);
      const rects = plans.map(rectOf);
      expect(rects, seed).toHaveLength(city.lots.length + 1);
      rects.forEach((a, i) => {
        for (const s of STREET_RECTS) expect(overlaps(a, s), `${seed} plan ${i} na ulicy`).toBe(false);
        for (let j = i + 1; j < rects.length; j++) expect(overlaps(a, rects[j]!), `${seed} plany ${i} i ${j}`).toBe(false);
      });
    }
  });

  it('dworzec stoi tylko w kwartale punktu ruchu „dworzec”, we wnętrzu kwartału', () => {
    for (const seed of SEEDS) {
      const { city, plans } = builtOf(seed);
      const sources = city.sources.filter((s) => s.kind === 'dworzec');
      expect(sources, seed).toHaveLength(1);
      const src = sources[0]!;
      const bx = Math.floor(src.x / BLOCK_M);
      const by = Math.floor(src.y / BLOCK_M);
      const station = plans.find((p) => p.style === 'dworzec')!;
      const interior: RectM = {
        x0: bx * BLOCK_M + STREET_HALF_M, x1: (bx + 1) * BLOCK_M - STREET_HALF_M,
        z0: by * BLOCK_M + STREET_HALF_M, z1: (by + 1) * BLOCK_M - STREET_HALF_M,
      };
      expect(inside(rectOf(station), interior), seed).toBe(true);
      expect(city.blocks[by * CITY_SIZE + bx], seed).toBe('dworzec');
    }
  });
});

describe('buildChunkGeometries: geometria', () => {
  it('chunk ma 2×2 kwartały: każda bryła leży w swoim chunku, chunków najwyżej 9, numery rosną', () => {
    for (const seed of SEEDS) {
      const { plans, chunks } = builtOf(seed);
      expect(chunks.length, seed).toBeLessThanOrEqual((CITY_SIZE / 2) ** 2);
      chunks.forEach((c, i) => { if (i > 0) expect(c.chunk, seed).toBeGreaterThan(chunks[i - 1]!.chunk); });
      for (const c of chunks) {
        const area = chunkArea(c.chunk);
        const a = c.geometry.getAttribute('position').array;
        for (let i = 0; i < a.length; i += 3) {
          const x = toM(a[i]!);
          const z = toM(a[i + 2]!);
          if (x < area.x0 - EPS || x > area.x1 + EPS || z < area.z0 - EPS || z > area.z1 + EPS) {
            throw new Error(`${seed} chunk ${c.chunk}: wierzchołek ${i / 3} (${x}, ${z}) poza chunkiem`);
          }
        }
      }
      // każdy plan ma wierzchołki dokładnie w jednym chunku
      expect(new Set(chunks.flatMap((c) => c.boxes.map((b) => b.lotId))).size, seed).toBe(plans.length - 1);
    }
  });

  it('wszystkie y ≥ 0, a każdy wierzchołek leży w obrysie jakiejś bryły swojego chunku', () => {
    for (const seed of SEEDS) {
      const { plans, chunks } = builtOf(seed);
      const rects = plans.map(rectOf);
      expect(trianglesOf(chunks), seed).toBeGreaterThan(0);
      for (const c of chunks) {
        const area = chunkArea(c.chunk);
        const here = rects.filter((r) => inside(r, area));
        const a = c.geometry.getAttribute('position').array;
        for (let i = 0; i < a.length; i += 3) {
          if (a[i + 1]! < 0) throw new Error(`${seed} chunk ${c.chunk}: y < 0 w wierzchołku ${i / 3}`);
          const x = toM(a[i]!);
          const z = toM(a[i + 2]!);
          if (!here.some((r) => x >= r.x0 - 1e-4 && x <= r.x1 + 1e-4 && z >= r.z0 - 1e-4 && z <= r.z1 + 1e-4)) {
            throw new Error(`${seed} chunk ${c.chunk}: wierzchołek ${i / 3} (${x}, ${z}) poza obrysami`);
          }
        }
      }
    }
  });

  it('deterministycznie: ten sam seed daje tę samą tablicę pozycji (skrót), inny seed inną', () => {
    const hashes = new Set<string>();
    for (const seed of SEEDS) {
      const { city, chunks } = builtOf(seed);
      const again = buildChunkGeometries(city, planCityBuildings(city), atlas);
      expect(positionHash(again), seed).toBe(positionHash(chunks));
      // to samo dotyczy UV i kolorów (warianty fasad ze skrótu numeru, bez losowania)
      expect(attrHash(again, 'uv'), seed).toBe(attrHash(chunks, 'uv'));
      expect(attrHash(again, 'color'), seed).toBe(attrHash(chunks, 'color'));
      for (const c of again) c.geometry.dispose();
      hashes.add(positionHash(chunks));
    }
    expect(hashes.size).toBe(SEEDS.length);
  });

  it(`trójkąty całego miasta < MOCKUP_TRIS_MAX (${MOCKUP_TRIS_MAX})`, () => {
    for (const seed of SEEDS) {
      const tris = trianglesOf(builtOf(seed).chunks);
      expect(tris, seed).toBeLessThan(MOCKUP_TRIS_MAX);
      expect(tris, seed).toBeGreaterThan(10_000);
    }
  });

  it('fasady od frontu i od tyłu: ok. 40% okien świeci (komórka „okno” zamiast „oknoGasne”)', () => {
    let lit = 0;
    let dark = 0;
    for (const seed of SEEDS) {
      for (const c of builtOf(seed).chunks) {
        const g = c.geometry;
        const n = g.getAttribute('position').count;
        for (let i = 0; i < n; i += 6) {
          if (uvIn(g, i, 'okno') && uvIn(g, i + 2, 'okno')) lit++;
          else if (uvIn(g, i, 'oknoGasne') && uvIn(g, i + 2, 'oknoGasne')) dark++;
        }
      }
    }
    expect(lit + dark).toBeGreaterThan(10_000);
    expect(lit / (lit + dark)).toBeGreaterThan(0.37);
    expect(lit / (lit + dark)).toBeLessThan(0.43);
  });
});

describe('buildChunkGeometries: witryny i bryły do wskazywania', () => {
  it('każdy lokal ma dokładnie jedną ShopFront: w chunku lokalu, z komórką „witryna”, zwrócona do ulicy', () => {
    for (const seed of SEEDS) {
      const { city, plans, chunks } = builtOf(seed);
      const count = new Map<number, number>();
      for (const c of chunks) {
        const g = c.geometry;
        const nor = g.getAttribute('normal');
        const col = g.getAttribute('color');
        for (const f of c.fronts) {
          count.set(f.lotId, (count.get(f.lotId) ?? 0) + 1);
          expect(f.count % 6, `${seed} #${f.lotId}`).toBe(0);
          expect(f.count, `${seed} #${f.lotId}`).toBeGreaterThan(0);
          expect(f.first + f.count, `${seed} #${f.lotId}`).toBeLessThanOrEqual(g.getAttribute('position').count);
          const lot = city.lots[f.lotId]!;
          const nz = plans[lot.id]!.front === 'n' ? -1 : 1;
          for (let i = f.first; i < f.first + f.count; i++) {
            expect(uvIn(g, i, 'witryna'), `${seed} #${f.lotId} uv ${i}`).toBe(true);
            expect(nor.getZ(i), `${seed} #${f.lotId}`).toBeCloseTo(nz, 6);
            expect([col.getX(i), col.getY(i), col.getZ(i)], `${seed} #${f.lotId}`).toEqual([1, 1, 1]);
          }
          // witryna jest w chunku, w którym leży lokal
          expect(c.boxes.some((b) => b.lotId === f.lotId), `${seed} #${f.lotId}`).toBe(true);
        }
      }
      expect(count.size, seed).toBe(city.lots.length);
      for (const lot of city.lots) expect(count.get(lot.id), `${seed} #${lot.id}`).toBe(1);
    }
  });

  it('każdy lokal ma jedną bryłę do wskazywania: obrys planu, dach na wysokości planu, wierzchołki budynku w niej', () => {
    for (const seed of SEEDS) {
      const { city, plans, chunks } = builtOf(seed);
      const seen = new Set<number>();
      for (const c of chunks) {
        const pos = c.geometry.getAttribute('position');
        for (const b of c.boxes) {
          expect(seen.has(b.lotId), `${seed} #${b.lotId}`).toBe(false);
          seen.add(b.lotId);
          const p = plans[b.lotId]!;
          expect(b.box.min.x).toBeCloseTo(p.x0, 6);
          expect(b.box.max.x).toBeCloseTo(p.x1, 6);
          expect(b.box.min.z).toBeCloseTo(p.z0, 6);
          expect(b.box.max.z).toBeCloseTo(p.z1, 6);
          expect(b.box.min.y).toBe(0);
          expect(b.box.max.y).toBeCloseTo(p.height, 6);
          expect(b.top.y).toBeCloseTo(p.height, 6);
          expect(b.top.x).toBeCloseTo((p.x0 + p.x1) / 2, 6);
          expect(b.top.z).toBeCloseTo((p.z0 + p.z1) / 2, 6);
          // zakres wierzchołków budynku obejmuje jego witrynę, a wierzchołki leżą w obrysie (dach z nadbudówką może wystawać w górę)
          const f = c.fronts.find((x) => x.lotId === b.lotId)!;
          expect(f.first).toBeGreaterThanOrEqual(b.first);
          expect(f.first + f.count).toBeLessThanOrEqual(b.first + b.count);
          for (let i = b.first; i < b.first + b.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            if (x < p.x0 - EPS || x > p.x1 + EPS || z < p.z0 - EPS || z > p.z1 + EPS) throw new Error(`${seed} #${b.lotId}: wierzchołek ${i} poza obrysem`);
          }
        }
      }
      expect(seen.size, seed).toBe(city.lots.length);
    }
  });

  it('setFront zmienia tylko uv i color w [first, first + count), a UV leżą w komórce atlasu', () => {
    const { chunks } = builtOf(SEEDS[0]!);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const tint = new Color('#ff8a1f');
    for (const cell of ['witrynaWynajem', 'tynk', 'witryna'] as const) {
      for (const c of chunks.slice(0, 3)) {
        const g = c.geometry;
        const front = c.fronts[Math.floor(c.fronts.length / 2)]!;
        const before = Object.fromEntries(['position', 'normal', 'uv', 'color'].map((k) => [k, Array.from(g.getAttribute(k).array)]));
        const versionOf = (name: string): number => (g.getAttribute(name) as BufferAttribute).version;
        const uvVersion = versionOf('uv');
        const colorVersion = versionOf('color');
        setFront(g, front, cell, tint);
        expect(Array.from(g.getAttribute('position').array)).toEqual(before.position);
        expect(Array.from(g.getAttribute('normal').array)).toEqual(before.normal);
        expect(versionOf('uv')).toBeGreaterThan(uvVersion);
        expect(versionOf('color')).toBeGreaterThan(colorVersion);
        const uv = Array.from(g.getAttribute('uv').array);
        const col = Array.from(g.getAttribute('color').array);
        const n = g.getAttribute('position').count;
        for (let i = 0; i < n; i++) {
          const inFront = i >= front.first && i < front.first + front.count;
          if (!inFront) {
            if (uv[2 * i] !== before.uv![2 * i] || uv[2 * i + 1] !== before.uv![2 * i + 1]) throw new Error(`uv ${i} zmienione poza witryną`);
            for (let k = 0; k < 3; k++) if (col[3 * i + k] !== before.color![3 * i + k]) throw new Error(`kolor ${i} zmieniony poza witryną`);
            continue;
          }
          expect(uvIn(g, i, cell), `${cell} uv ${i}`).toBe(true);
          expect(col[3 * i]).toBeCloseTo(tint.r, 5);
          expect(col[3 * i + 1]).toBeCloseTo(tint.g, 5);
          expect(col[3 * i + 2]).toBeCloseTo(tint.b, 5);
        }
        // czworokąt witryny dostaje całą komórkę: każdy róg komórki występuje w każdej szóstce wierzchołków
        const [u0, v0, u1, v1] = atlas.cell(cell);
        for (let q = front.first; q < front.first + front.count; q += 6) {
          const corners = new Set<string>();
          for (let i = q; i < q + 6; i++) corners.add(`${Math.abs(uv[2 * i]! - u0) < 1e-6 ? 0 : Math.abs(uv[2 * i]! - u1) < 1e-6 ? 1 : 'x'},${Math.abs(uv[2 * i + 1]! - v0) < 1e-6 ? 0 : Math.abs(uv[2 * i + 1]! - v1) < 1e-6 ? 1 : 'x'}`);
          expect([...corners].sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
        }
      }
    }
    // z powrotem domyślna witryna bez barwy, żeby inne testy widziały stan z budowy
    for (const c of chunks) for (const f of c.fronts) setFront(c.geometry, f, 'witryna', new Color('#ffffff'));
  });
});
