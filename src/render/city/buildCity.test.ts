import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Color, Mesh, MeshStandardMaterial, Raycaster, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { generateCity } from '@/sim/city/generateCity';
import { BLOCK_M } from '@/sim/city/districts';
import { CITY_SIZE, type CityState, type LotState } from '@/sim/city/types';
import { CameraRig, VIEW_SIZE_MAX } from '@/render/cameraRig';
import { material } from '@/render/style';
import { CITY_BOUNDS, CITY_UNIT_M, DISTRICT_COLOR, buildCity, cityToWorld, countDrawCalls } from './buildCity';

/** Dziesięć seedów z testów generatora miasta. */
const SEEDS = ['kiełbasa-42', 'kiełbasa-12', 'a', 'b', 'traszka-1', 'traszka-2', 'miasto-1', 'miasto-2', 'miasto-3', 'miasto-4'];

const cities = new Map<string, CityState>();
const cityOf = (seed: string): CityState => {
  let c = cities.get(seed);
  if (!c) { c = generateCity(seed); cities.set(seed, c); }
  return c;
};
/** Stany z generatora (to, co gra podaje na starcie, zanim firma coś zmieni). */
const generated = (city: CityState): Record<number, LotState> => Object.fromEntries(city.lots.map((l) => [l.id, l.state]));

const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
  return out;
};
const meshNamed = (root: Object3D, name: string): Mesh => {
  const m = root.getObjectByName(name);
  if (!m) throw new Error(`brak siatki ${name}`);
  return m as Mesh;
};
const colorOf = (g: BufferGeometry, i: number): [number, number, number] => {
  const a = g.getAttribute('color');
  return [a.getX(i), a.getY(i), a.getZ(i)];
};
const meanOf = (hourly: number[]): number => hourly.reduce((a, b) => a + b, 0) / hourly.length;

describe('buildCity: budżet draw calli', () => {
  it('poniżej 60 draw calli dla dziesięciu seedów, a scena ma budynki, ulice i tło kwartałów', () => {
    const counts: Record<string, number> = {};
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const view = buildCity(city, generated(city));
      counts[seed] = countDrawCalls(view.root);
      expect(counts[seed], seed).toBeLessThan(60);
      expect(counts[seed], seed).toBeGreaterThanOrEqual(3);
      expect(view.root.getObjectByName('streets'), seed).toBeDefined();
      expect(view.root.getObjectByName('blocks'), seed).toBeDefined();
      view.dispose();
    }
    // jedna siatka na ulice, jedna na tło kwartałów i najwyżej jedna na chunk 2×2 kwartały (3 × 3)
    for (const n of Object.values(counts)) expect(n).toBeLessThanOrEqual(2 + (CITY_SIZE / 2) ** 2);
  });

  it('countDrawCalls liczy widoczne siatki, pomija ukryte gałęzie i liczy grupy materiałów', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city));
    const all = countDrawCalls(view.root);
    const first = meshesOf(view.root)[0]!;
    first.visible = false;
    expect(countDrawCalls(view.root)).toBe(all - 1);
    view.root.visible = false;
    expect(countDrawCalls(view.root)).toBe(0);
    view.root.visible = true;
    first.visible = true;
    // siatka z dwoma grupami materiałów to dwa wywołania rysowania
    const g = first.geometry.clone();
    g.clearGroups();
    g.addGroup(0, 3, 0);
    g.addGroup(3, 3, 1);
    const multi = new Mesh(g, [new MeshStandardMaterial(), new MeshStandardMaterial()]);
    expect(countDrawCalls(multi)).toBe(2);
    view.dispose();
  });
});

describe('buildCity: warstwa „Ruch”', () => {
  it('najruchliwszy odcinek jest bardziej czerwony niż najcichszy (R − G), a kolor rośnie z natężeniem dobowym', () => {
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const view = buildCity(city, generated(city));
      view.setLayer('ruch');
      const g = meshNamed(view.root, 'streets').geometry;
      const byMean = [...city.streets].sort((a, b) => meanOf(a.hourly) - meanOf(b.hourly));
      const quiet = byMean[0]!;
      const busy = byMean[byMean.length - 1]!;
      expect(meanOf(busy.hourly), seed).toBeGreaterThan(meanOf(quiet.hourly));
      // odcinek ma cztery wierzchołki, po kolei jak w `city.streets`
      const rg = (id: number): number => { const [r, gr] = colorOf(g, id * 4); return r - gr; };
      expect(rg(busy.id), seed).toBeGreaterThan(rg(quiet.id));
      // wszystkie cztery wierzchołki odcinka mają ten sam kolor
      for (let k = 1; k < 4; k++) expect(colorOf(g, busy.id * 4 + k)).toEqual(colorOf(g, busy.id * 4));
      view.dispose();
    }
  });

  it('skala jest stała, nie zależy od miasta: odcinek o tym samym natężeniu ma ten sam kolor, choćby był jedynym ruchliwym', () => {
    const a = cityOf(SEEDS[0]!);
    const va = buildCity(a, generated(a));
    const b: CityState = { ...a, streets: a.streets.map((s, i) => ({ ...s, hourly: i === 0 ? a.streets[1]!.hourly : s.hourly.map(() => 0) })) };
    const vb = buildCity(b, generated(b));
    expect(colorOf(meshNamed(vb.root, 'streets').geometry, 0)).toEqual(colorOf(meshNamed(va.root, 'streets').geometry, 4));
    va.dispose();
    vb.dispose();
  });
});

describe('buildCity: warstwy', () => {
  it('setLayer zmienia kolory kwartałów (w „Dzielnicach” kolor dzielnicy), a geometria zostaje ta sama', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const city = cityOf(seed);
      const view = buildCity(city, generated(city));
      const blocks = meshNamed(view.root, 'blocks');
      const streets = meshNamed(view.root, 'streets');
      const buildings = meshesOf(view.root).filter((m) => m.name.startsWith('chunk:'));
      view.setLayer('ruch');
      const posBlocks = Array.from(blocks.geometry.getAttribute('position').array);
      const posStreets = Array.from(streets.geometry.getAttribute('position').array);
      const geoms = [blocks.geometry, streets.geometry, ...buildings.map((m) => m.geometry)];
      const positionAttrs = geoms.map((g) => g.getAttribute('position'));
      const calls = countDrawCalls(view.root);
      const ruch = Array.from(blocks.geometry.getAttribute('color').array);
      const ruchStreets = Array.from(streets.geometry.getAttribute('color').array);

      view.setLayer('dzielnice');
      const dz = Array.from(blocks.geometry.getAttribute('color').array);
      expect(dz, seed).not.toEqual(ruch);
      expect(Array.from(streets.geometry.getAttribute('color').array), seed).not.toEqual(ruchStreets);
      // każdy kwartał ma cztery wierzchołki w kolorze swojej dzielnicy (park też)
      city.blocks.forEach((d, i) => {
        const want = new Color(DISTRICT_COLOR[d]);
        for (let k = 0; k < 4; k++) {
          const got = colorOf(blocks.geometry, i * 4 + k);
          [want.r, want.g, want.b].forEach((x, c) => expect(got[c], `${seed} kwartał ${i}`).toBeCloseTo(x, 5));
        }
      });
      // te same bufory i te same współrzędne, ta sama liczba wywołań rysowania
      expect(Array.from(blocks.geometry.getAttribute('position').array)).toEqual(posBlocks);
      expect(Array.from(streets.geometry.getAttribute('position').array)).toEqual(posStreets);
      expect(geoms.map((g) => g.getAttribute('position'))).toEqual(positionAttrs);
      geoms.forEach((g, i) => expect(g.getAttribute('position')).toBe(positionAttrs[i]));
      expect(countDrawCalls(view.root)).toBe(calls);

      view.setLayer('ruch');
      expect(Array.from(blocks.geometry.getAttribute('color').array)).toEqual(ruch);
      view.dispose();
    }
  });

  it('cztery dzielnice i park mają różne kolory tła', () => {
    expect(new Set(Object.values(DISTRICT_COLOR)).size).toBe(Object.keys(DISTRICT_COLOR).length);
    expect(Object.keys(DISTRICT_COLOR).sort()).toEqual(['biurowce', 'dworzec', 'osiedle', 'park', 'srodmiescie']);
  });
});

describe('buildCity: kotwice pinezek i wybór lokalu', () => {
  it('cityToWorld: środek miasta w (0, 0), jednostka sceny to CITY_UNIT_M metrów, y miasta to z sceny', () => {
    const mid = (CITY_SIZE * BLOCK_M) / 2;
    expect(cityToWorld(mid, mid)).toMatchObject({ x: 0, z: 0 });
    const p = cityToWorld(mid + CITY_UNIT_M, mid + 2 * CITY_UNIT_M);
    expect(p.x).toBeCloseTo(1, 10);
    expect(p.z).toBeCloseTo(2, 10);
  });

  it('kotwice leżą w granicach miasta, a promień z góry nad kotwicą trafia jej lokal', () => {
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const states = generated(city);
      const view = buildCity(city, states);
      const anchors = view.pinAnchors();
      expect(anchors.length, seed).toBeGreaterThan(0);
      const seen = new Set<number>();
      for (const { lotId, world } of anchors) {
        expect(seen.has(lotId), `${seed} lokal ${lotId} dwa razy`).toBe(false);
        seen.add(lotId);
        expect(world.x).toBeGreaterThanOrEqual(CITY_BOUNDS.minX);
        expect(world.x).toBeLessThanOrEqual(CITY_BOUNDS.maxX);
        expect(world.z).toBeGreaterThanOrEqual(CITY_BOUNDS.minZ);
        expect(world.z).toBeLessThanOrEqual(CITY_BOUNDS.maxZ);
        const ray = new Raycaster(new Vector3(world.x, world.y + 20, world.z), new Vector3(0, -1, 0));
        expect(view.pickLot(ray), `${seed} lokal ${lotId}`).toBe(lotId);
      }
      view.dispose();
    }
  });

  it('kotwice są dla lokali, które mają pinezkę (nie dla zwykłych zajętych); setLots je przestawia', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city));
    const ids = (): number[] => view.pinAnchors().map((a) => a.lotId).sort((a, b) => a - b);
    const marked = city.lots.filter((l) => l.state !== 'zajety').map((l) => l.id).sort((a, b) => a - b);
    expect(ids()).toEqual(marked);
    expect(ids()).toContain(city.startLotId);
    const plain = city.lots.find((l) => l.state === 'zajety')!;
    view.setLots({ ...generated(city), [plain.id]: 'po-traszce' });
    expect(ids()).toContain(plain.id);
    view.setLots({ ...generated(city), [city.startLotId]: 'zajety' });
    expect(ids()).not.toContain(city.startLotId);
    view.dispose();
  });

  it('brak stanu lokalu w `states` oznacza stan z generatora', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, {});
    expect(view.pinAnchors().map((a) => a.lotId)).toContain(city.startLotId);
    view.dispose();
  });

  it('promień obok budynków (nad ulicą) i z dala od miasta nie trafia w nic', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city));
    const street = cityToWorld(BLOCK_M, BLOCK_M);   // skrzyżowanie
    expect(view.pickLot(new Raycaster(new Vector3(street.x, 20, street.z), new Vector3(0, -1, 0)))).toBeNull();
    expect(view.pickLot(new Raycaster(new Vector3(500, 20, 500), new Vector3(0, -1, 0)))).toBeNull();
    view.dispose();
  });

  it('setLots barwi budynki lokali ze stanem; wszystko zajęte to sam biały, a geometria się nie zmienia', () => {
    const city = cityOf(SEEDS[0]!);
    const plain = Object.fromEntries(city.lots.map((l) => [l.id, 'zajety' as LotState]));
    const view = buildCity(city, plain);
    const chunks = meshesOf(view.root).filter((m) => m.name.startsWith('chunk:'));
    const snapshot = (): number[][] => chunks.map((m) => Array.from(m.geometry.getAttribute('color').array));
    const positions = chunks.map((m) => Array.from(m.geometry.getAttribute('position').array));
    const before = snapshot();
    view.setLots(generated(city));
    expect(snapshot()).not.toEqual(before);
    view.setLots(plain);
    expect(snapshot()).toEqual(before);
    expect(chunks.map((m) => Array.from(m.geometry.getAttribute('position').array))).toEqual(positions);
    view.dispose();
  });

  it('stan zmienia tylko budynek tego lokalu: reszta chunku zostaje, a lokal dostaje barwę stanu (zielony własny sklep)', () => {
    const city = cityOf(SEEDS[0]!);
    const plain = Object.fromEntries(city.lots.map((l) => [l.id, 'zajety' as LotState]));
    const view = buildCity(city, plain);
    const lot = city.lots[city.startLotId]!;
    const chunk = meshesOf(view.root).find((m) => m.name === `chunk:${Math.floor(lot.by / 2) * 3 + Math.floor(lot.bx / 2)}`)!;
    const before = Array.from(chunk.geometry.getAttribute('color').array);
    view.setLots({ ...plain, [lot.id]: 'twoj' });
    const after = Array.from(chunk.geometry.getAttribute('color').array);
    const changed = new Set<number>();
    after.forEach((x, i) => { if (x !== before[i]) changed.add(Math.floor(i / 3)); });
    expect(changed.size).toBe(20);   // dach i cztery ściany jednej bryły
    const first = Math.min(...changed);
    const [r, g, b] = [after[first * 3]!, after[first * 3 + 1]!, after[first * 3 + 2]!];
    expect(g).toBeGreaterThan(r);    // zielony przeważa nad czerwonym
    expect(g).toBeGreaterThan(b);
    view.dispose();
  });

  it('trójkąty mają zwrot zgodny z normalnymi, więc widać je z góry i z zewnątrz', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city));
    for (const m of meshesOf(view.root)) {
      const pos = m.geometry.getAttribute('position');
      const nor = m.geometry.getAttribute('normal');
      const idx = m.geometry.getIndex()!;
      for (let t = 0; t < idx.count; t += 3) {
        const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
        const pa = new Vector3().fromBufferAttribute(pos, a);
        const geometric = new Vector3().subVectors(new Vector3().fromBufferAttribute(pos, b), pa).cross(new Vector3().subVectors(new Vector3().fromBufferAttribute(pos, c), pa));
        expect(geometric.dot(new Vector3().fromBufferAttribute(nor, a)), `${m.name} trójkąt ${t / 3}`).toBeGreaterThan(0);
      }
    }
    view.dispose();
  });
});

describe('buildCity: kadr kamery', () => {
  it('całe miasto mieści się w VIEW_SIZE_MAX kamery (ekran poziomy 16:10), także z najwyższym budynkiem', () => {
    const rig = new CameraRig(1.6);
    rig.zoomBy(rig.viewSize / VIEW_SIZE_MAX);
    expect(rig.viewSize).toBe(VIEW_SIZE_MAX);
    for (const yaw of [0, 1, 2, 3] as const) {
      rig.yawIndex = yaw;
      for (const x of [CITY_BOUNDS.minX, CITY_BOUNDS.maxX]) {
        for (const z of [CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ]) {
          for (const y of [0, 1]) {
            const p = new Vector3(x, y, z).project(rig.camera);
            expect(Math.abs(p.x), `yaw ${yaw}`).toBeLessThanOrEqual(1);
            expect(Math.abs(p.y), `yaw ${yaw}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('granice są symetryczne wokół (0, 0), więc kamera celuje w środek miasta', () => {
    expect(CITY_BOUNDS.minX).toBeCloseTo(-CITY_BOUNDS.maxX, 10);
    expect(CITY_BOUNDS.minZ).toBeCloseTo(-CITY_BOUNDS.maxZ, 10);
    expect(CITY_BOUNDS.maxX).toBeGreaterThan((CITY_SIZE * BLOCK_M) / 2 / CITY_UNIT_M);
  });
});

describe('buildCity: sprzątanie', () => {
  /** Podpina licznik do zdarzenia `dispose` każdej geometrii i materiału sceny. */
  function watch(root: Object3D): { geometries: Set<BufferGeometry>; materials: Set<Material>; disposed: { geometry: number; material: number } } {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    for (const m of meshesOf(root)) {
      geometries.add(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
    }
    const disposed = { geometry: 0, material: 0 };
    for (const g of geometries) g.addEventListener('dispose', () => { disposed.geometry++; });
    for (const m of materials) m.addEventListener('dispose', () => { disposed.material++; });
    return { geometries, materials, disposed };
  }

  it('dispose zwalnia wszystkie geometrie i materiały, odpina korzeń, a drugie wywołanie nic nie psuje', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city));
    const parent = new Mesh();
    parent.add(view.root);
    const { geometries, materials, disposed } = watch(view.root);
    expect(geometries.size).toBeGreaterThan(2);
    expect(materials.size).toBeGreaterThan(0);
    view.dispose();
    expect(disposed.geometry).toBe(geometries.size);
    expect(disposed.material).toBe(materials.size);
    expect(view.root.parent).toBeNull();
    expect(() => view.dispose()).not.toThrow();
    expect(disposed.geometry).toBe(geometries.size);
  });

  it('materiały miasta są własne (nie z współdzielonej pamięci podręcznej style.ts), więc zwolnienie nie psuje sklepu', () => {
    const shared = material('plasticMatte', '#ffffff');
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city));
    const { materials } = watch(view.root);
    expect(materials.has(shared)).toBe(false);
    view.dispose();
  });
});

describe('źródła: wspólna kartka „DO WYNAJĘCIA”', () => {
  const read = (rel: string): string => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

  it('facadeAtlas.ts i cityPins.ts importują drawRentPoster z rentPoster.ts', () => {
    for (const rel of ['src/render/street/facadeAtlas.ts', 'src/render/city/cityPins.ts']) {
      expect(read(rel), rel).toMatch(/import\s*\{[^}]*\bdrawRentPoster\b[^}]*\}\s*from\s*'@\/render\/rentPoster'/);
    }
  });

  it('facadeAtlas.ts nie rysuje już kartki sam: napisy „DO” i „WYNAJĘCIA” i ściśnięty tekst mieszkają tylko w rentPoster.ts', () => {
    const atlas = read('src/render/street/facadeAtlas.ts');
    expect(atlas).not.toMatch(/tr\('DO'\)/);
    expect(atlas).not.toMatch(/tr\('WYNAJĘCIA'\)/);
    expect(atlas).not.toMatch(/condensedText/);
    expect(atlas).toMatch(/drawRentPoster\(/);
    const poster = read('src/render/rentPoster.ts');
    expect(poster).toMatch(/tr\('DO'\)/);
    expect(poster).toMatch(/tr\('WYNAJĘCIA'\)/);
  });

  it('cityPins.ts rysuje kartkę z dopiskiem „po Traszce” przez tr()', () => {
    expect(read('src/render/city/cityPins.ts')).toMatch(/tr\('po Traszce'\)/);
  });
});
