import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, Raycaster, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { generateCity } from '@/sim/city/generateCity';
import { BLOCK_M } from '@/sim/city/districts';
import { CITY_SIZE, type CityState, type LotState } from '@/sim/city/types';
import { CameraRig, VIEW_SIZE_MAX } from '@/render/cameraRig';
import { createFacadeAtlas, type AtlasCellName } from '@/render/street/facadeAtlas';
import { PALETTE, material } from '@/render/style';
import {
  CITY_BOUNDS, CITY_UNIT_M, DISTRICT_COLOR, FLAT_SCALE, buildCity, cityFitViewSize, cityToWorld, countDrawCalls,
  type CityLayer, type CityView,
} from './buildCity';
import { buildChunkGeometries, planCityBuildings, type ChunkGeometry } from './cityBuildings';

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

describe('buildCity: materiał bez świateł', () => {
  const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  it('każda siatka miasta ma materiał bez świateł (MeshBasicMaterial z kolorami wierzchołków), więc mapa wygląda tak samo o każdej porze doby', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city));
    const meshes = meshesOf(view.root);
    expect(meshes.length).toBeGreaterThan(2);
    for (const m of meshes) {
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        expect(mat.type, m.name).toBe('MeshBasicMaterial');
        expect((mat as MeshBasicMaterial).vertexColors, m.name).toBe(true);
        expect('roughness' in mat || 'metalness' in mat || 'emissive' in mat, m.name).toBe(false);
      }
      expect(m.castShadow, m.name).toBe(false);
      expect(m.receiveShadow, m.name).toBe(false);
    }
    view.dispose();
  });

  it('cieniowanie jest w kolorach: dach jaśniejszy od ściany ±z, a ta od ściany ±x (w rzucie izometrycznym zawsze widać po jednej z nich)', () => {
    const city = cityOf(SEEDS[0]!);
    const plain = Object.fromEntries(city.lots.map((l) => [l.id, 'zajety' as LotState]));
    const view = buildCity(city, plain);
    const chunks = meshesOf(view.root).filter((m) => m.name.startsWith('chunk:'));
    for (const m of chunks) {
      const g = m.geometry;
      for (let box = 0; box < g.getAttribute('position').count / 20; box++) {
        const face = (k: number): number => { const [r, gr, b] = colorOf(g, box * 20 + k * 4); return lum(r, gr, b); };
        const [roof, wallZ, wallX] = [face(0), face(1), face(3)];
        expect(roof, `${m.name} bryła ${box}`).toBeGreaterThan(wallZ);
        expect(wallZ, `${m.name} bryła ${box}`).toBeGreaterThan(wallX);
        // dwie ściany tego samego kierunku mają ten sam kolor
        expect(face(2)).toBeCloseTo(wallZ, 10);
        expect(face(4)).toBeCloseTo(wallX, 10);
      }
    }
    view.dispose();
  });

  it('żaden kolor wierzchołka nie sięga progu bloomu (luminancja 0,9 w post.ts), w obu warstwach i przy wszystkich stanach lokali', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city));
    const states = ['zajety', 'wolny', 'konkurencja', 'twoj', 'obok', 'budowa', 'po-traszce'] as const;
    for (const layer of ['ruch', 'dzielnice'] as const) {
      view.setLayer(layer);
      for (const state of states) {
        view.setLots(Object.fromEntries(city.lots.map((l) => [l.id, state])));
        for (const m of meshesOf(view.root)) {
          const attr = m.geometry.getAttribute('color');
          for (let i = 0; i < attr.count; i++) {
            expect(lum(attr.getX(i), attr.getY(i), attr.getZ(i)), `${layer} ${state} ${m.name}`).toBeLessThan(0.85);
          }
        }
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

  it('cityFitViewSize: całe miasto mieści się w danym prostokącie ekranu, także na telefonie w pionie (390×844) i w oknie z panelem', () => {
    const cases: { w: number; h: number; visW: number; visH: number }[] = [
      { w: 1280, h: 800, visW: 1280, visH: 800 },
      { w: 390, h: 844, visW: 390, visH: 844 },
      { w: 390, h: 844, visW: 390, visH: 284 },    // telefon: mapa nad arkuszem
      { w: 1280, h: 800, visW: 878, visH: 628 },   // komputer: mapa obok panelu
      { w: 844, h: 390, visW: 844, visH: 330 },    // telefon poziomo
    ];
    for (const { w, h, visW, visH } of cases) {
      const rig = new CameraRig(w / h);
      const size = cityFitViewSize(visW, visH, h);
      rig.setViewMax(Math.max(VIEW_SIZE_MAX, size));
      rig.zoomBy(rig.viewSize / size);
      expect(rig.viewSize).toBeCloseTo(size, 6);
      for (const yaw of [0, 1, 2, 3] as const) {
        rig.yawIndex = yaw;
        for (const x of [CITY_BOUNDS.minX, CITY_BOUNDS.maxX]) {
          for (const z of [CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ]) {
            for (const y of [0, 0.6]) {
              const p = new Vector3(x, y, z).project(rig.camera);
              // piksele widocznego prostokąta (wyśrodkowanego w oknie) liczymy z NDC: pół okna to 1
              expect(Math.abs(p.x) * (w / 2), `${w}×${h} yaw ${yaw}`).toBeLessThanOrEqual(visW / 2 + 1e-6);
              expect(Math.abs(p.y) * (h / 2), `${w}×${h} yaw ${yaw}`).toBeLessThanOrEqual(visH / 2 + 1e-6);
            }
          }
        }
      }
    }
  });

  it('cityFitViewSize: ekran poziomy mieści się w VIEW_SIZE_MAX, telefon w pionie wymaga więcej', () => {
    expect(cityFitViewSize(1280, 800, 800)).toBeLessThanOrEqual(VIEW_SIZE_MAX);
    expect(cityFitViewSize(390, 844, 844)).toBeGreaterThan(VIEW_SIZE_MAX);
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

// --- 4a.2: makieta i warstwy na jednej geometrii (szczegółowość `pelny`) ------------------------------------------

const LAYERS: readonly CityLayer[] = ['makieta', 'ruch', 'dzielnice'];
const atlas = createFacadeAtlas();

/** Te same chunki, z których `buildCity` składa `pelny` (geometria jest deterministyczna): zakresy witryn i budynków lokali. */
const chunksFor = new Map<string, ChunkGeometry[]>();
const referenceChunks = (seed: string): ChunkGeometry[] => {
  let c = chunksFor.get(seed);
  if (!c) { const city = cityOf(seed); c = buildChunkGeometries(city, planCityBuildings(city), atlas); chunksFor.set(seed, c); }
  return c;
};
const chunkMeshes = (view: CityView): Mesh[] => meshesOf(view.root).filter((m) => m.name.startsWith('chunk:'));
const chunkMesh = (view: CityView, chunk: number): Mesh => meshNamed(view.root, `chunk:${chunk}`);
/** Najwyższy wierzchołek budynku lokalu (z nadbudówką) w geometrii chunku, bez skali siatki. */
function lotTop(chunks: readonly ChunkGeometry[], lotId: number): number {
  for (const c of chunks) {
    const b = c.boxes.find((x) => x.lotId === lotId);
    if (!b) continue;
    const pos = c.geometry.getAttribute('position');
    let top = 0;
    for (let i = b.first; i < b.first + b.count; i++) top = Math.max(top, pos.getY(i));
    return top;
  }
  throw new Error(`brak lokalu ${lotId}`);
}
const uvInCell = (g: BufferGeometry, i: number, cell: AtlasCellName): boolean => {
  const [u0, v0, u1, v1] = atlas.cell(cell);
  const uv = g.getAttribute('uv');
  return uv.getX(i) >= u0 - 1e-6 && uv.getX(i) <= u1 + 1e-6 && uv.getY(i) >= v0 - 1e-6 && uv.getY(i) <= v1 + 1e-6;
};
const all = (city: CityState, state: LotState): Record<number, LotState> => Object.fromEntries(city.lots.map((l) => [l.id, state]));

describe('buildCity pelny: tryby na jednej geometrii', () => {
  it('prosty to domyślna szczegółowość i nie umie makiety; pelny umie wszystkie trzy tryby', () => {
    const city = cityOf(SEEDS[0]!);
    const simple = buildCity(city, generated(city));
    expect(simple.detail).toBe('prosty');
    expect(simple.supports('makieta')).toBe(false);
    expect(simple.supports('ruch')).toBe(true);
    expect(simple.supports('dzielnice')).toBe(true);
    simple.dispose();
    const full = buildCity(city, generated(city), { detail: 'pelny' });
    expect(full.detail).toBe('pelny');
    for (const layer of LAYERS) expect(full.supports(layer), layer).toBe(true);
    full.dispose();
  });

  it('poniżej 60 draw calli w każdym trybie (10 seedów)', () => {
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const view = buildCity(city, generated(city), { detail: 'pelny' });
      for (const layer of LAYERS) {
        view.setLayer(layer);
        const n = countDrawCalls(view.root);
        expect(n, `${seed} ${layer}`).toBeLessThan(60);
        expect(n, `${seed} ${layer}`).toBeGreaterThanOrEqual(3);
      }
      view.dispose();
    }
  });

  it('setLayer nie zmienia obiektów BufferGeometry ani tablic position, a zmienia materiał i scale.y chunków', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const city = cityOf(seed);
      const view = buildCity(city, generated(city), { detail: 'pelny' });
      const meshes = meshesOf(view.root);
      const geoms = meshes.map((m) => m.geometry);
      const positions = geoms.map((g) => g.getAttribute('position'));
      const arrays = positions.map((p) => p.array);
      const copies = arrays.map((a) => Array.from(a));
      const materialIn: Partial<Record<CityLayer, Material>> = {};
      for (const layer of ['makieta', 'ruch', 'dzielnice', 'makieta', 'ruch'] as const) {
        view.setLayer(layer);
        meshes.forEach((m, i) => {
          expect(m.geometry, `${seed} ${layer} ${m.name}`).toBe(geoms[i]);
          expect(m.geometry.getAttribute('position'), `${seed} ${layer} ${m.name}`).toBe(positions[i]);
          expect(m.geometry.getAttribute('position').array, `${seed} ${layer} ${m.name}`).toBe(arrays[i]);
        });
        // jeden materiał na tryb dla wszystkich siatek
        const mats = new Set(meshes.map((m) => m.material as Material));
        expect(mats.size, `${seed} ${layer}`).toBe(1);
        const mat = [...mats][0]!;
        if (materialIn[layer]) expect(mat, `${seed} ${layer}`).toBe(materialIn[layer]);
        materialIn[layer] = mat;
        for (const m of chunkMeshes(view)) expect(m.scale.y, `${seed} ${layer} ${m.name}`).toBe(layer === 'makieta' ? 1 : FLAT_SCALE);
        expect(meshNamed(view.root, 'blocks').scale.y).toBe(1);
        expect(meshNamed(view.root, 'streets').scale.y).toBe(1);
      }
      expect(materialIn.makieta).not.toBe(materialIn.ruch);
      expect(materialIn.ruch).toBe(materialIn.dzielnice);
      arrays.forEach((a, i) => expect(Array.from(a), `${seed} pozycje ${meshes[i]!.name}`).toEqual(copies[i]));
      view.dispose();
    }
  });

  it('makieta: MeshStandardMaterial z mapą i emissive atlasu i kolorami wierzchołków; warstwy: MeshBasicMaterial z kolorami wierzchołków, bez cieni', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city), { detail: 'pelny' });
    view.setLayer('makieta');
    const lit = chunkMeshes(view)[0]!.material as MeshStandardMaterial;
    expect(lit.type).toBe('MeshStandardMaterial');
    expect(lit.vertexColors).toBe(true);
    expect(lit.map).toBe(atlas.map);
    expect(lit.emissiveMap).toBe(atlas.emissive);
    view.setLayer('ruch');
    const flat = chunkMeshes(view)[0]!.material as MeshBasicMaterial;
    expect(flat.type).toBe('MeshBasicMaterial');
    expect(flat.vertexColors).toBe(true);
    expect(flat.map).toBeNull();
    for (const m of meshesOf(view.root)) {
      expect(m.castShadow, m.name).toBe(false);
      expect(m.receiveShadow, m.name).toBe(false);
    }
    view.dispose();
  });

  it('noc zapala okna makiety (emissive), dzień je gasi; prosty nie ma czego zapalać', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city), { detail: 'pelny' });
    view.setLayer('makieta');
    const lit = chunkMeshes(view)[0]!.material as MeshStandardMaterial;
    expect(lit.emissiveIntensity).toBe(0);
    view.setTimeOfDay('night');
    expect(lit.emissiveIntensity).toBeGreaterThan(0);
    view.setTimeOfDay('day');
    expect(lit.emissiveIntensity).toBe(0);
    view.dispose();
    const simple = buildCity(city, generated(city));
    expect(() => simple.setTimeOfDay('night')).not.toThrow();
    simple.dispose();
  });

  it('trzy bufory kolorów: makieta ma barwy budynków z Zadania 10 (park zielony, ulice asfalt), warstwy biel z wypieczonym cieniowaniem i ziemię jak w 4a.1', () => {
    const seed = SEEDS[0]!;
    const city = cityOf(seed);
    const plain = all(city, 'zajety');
    const view = buildCity(city, plain, { detail: 'pelny' });
    const ref = referenceChunks(seed);
    const blocks = meshNamed(view.root, 'blocks').geometry;
    const streets = meshNamed(view.root, 'streets').geometry;

    view.setLayer('makieta');
    // budynki: kolory wierzchołków takie jak z budowy (wszystkie lokale zajęte: witryna bez barwy)
    for (const c of ref) expect(Array.from(chunkMesh(view, c.chunk).geometry.getAttribute('color').array), `chunk ${c.chunk}`).toEqual(Array.from(c.geometry.getAttribute('color').array));
    const close = (got: [number, number, number], want: Color, label: string): void => [want.r, want.g, want.b].forEach((x, k) => expect(got[k], label).toBeCloseTo(x, 5));
    city.blocks.forEach((d, i) => { if (d === 'park') close(colorOf(blocks, i * 4), new Color(PALETTE.street.grass[0]!), `park ${i}`); });
    city.streets.forEach((_, i) => close(colorOf(streets, i * 4), new Color(PALETTE.street.asphalt[0]!), `ulica ${i}`));
    const makietaBlocks = Array.from(blocks.getAttribute('color').array);

    view.setLayer('dzielnice');
    city.blocks.forEach((d, i) => close(colorOf(blocks, i * 4), new Color(DISTRICT_COLOR[d]), `dzielnica ${i}`));
    expect(Array.from(blocks.getAttribute('color').array)).not.toEqual(makietaBlocks);
    // ziemia warstw jak w prostym widoku
    const simple = buildCity(city, plain);
    for (const layer of ['ruch', 'dzielnice'] as const) {
      view.setLayer(layer);
      simple.setLayer(layer);
      expect(Array.from(blocks.getAttribute('color').array), layer).toEqual(Array.from(meshNamed(simple.root, 'blocks').geometry.getAttribute('color').array));
      expect(Array.from(streets.getAttribute('color').array), layer).toEqual(Array.from(meshNamed(simple.root, 'streets').geometry.getAttribute('color').array));
    }
    simple.dispose();

    // budynki warstw: biel budynków z 4a.1 (te same proporcje kanałów), dach jaśniejszy od ścian ±z, te od ścian ±x, poniżej progu bloomu
    const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const white = new Color(PALETTE.wall[0]!);
    for (const layer of ['ruch', 'dzielnice'] as const) {
      view.setLayer(layer);
      for (const m of chunkMeshes(view)) {
        const g = m.geometry;
        const col = g.getAttribute('color');
        const nor = g.getAttribute('normal');
        const byFace = { roof: new Set<number>(), z: new Set<number>(), x: new Set<number>() };
        for (let i = 0; i < col.count; i++) {
          const [r, gr, b] = [col.getX(i), col.getY(i), col.getZ(i)];
          expect(lum(r, gr, b), `${layer} ${m.name} ${i}`).toBeLessThan(0.85);
          expect(gr / r, `${layer} ${m.name} ${i} biel`).toBeCloseTo(white.g / white.r, 3);
          expect(b / r, `${layer} ${m.name} ${i} biel`).toBeCloseTo(white.b / white.r, 3);
          const [nx, ny, nz] = [nor.getX(i), nor.getY(i), nor.getZ(i)];
          const face = ny > 0.99 ? 'roof' : Math.abs(nz) > 0.99 ? 'z' : Math.abs(nx) > 0.99 ? 'x' : null;
          if (face) byFace[face].add(Math.round(lum(r, gr, b) * 1e4));
        }
        expect(Math.min(...byFace.roof), m.name).toBeGreaterThan(Math.max(...byFace.z));
        expect(Math.min(...byFace.z), m.name).toBeGreaterThan(Math.max(...byFace.x));
      }
    }
    view.dispose();
  });

  it('warstwy barwią cały budynek lokalu wg stanu (własny sklep zielony), a dworzec i reszta chunku zostają białe', () => {
    const seed = SEEDS[0]!;
    const city = cityOf(seed);
    const plain = all(city, 'zajety');
    const view = buildCity(city, plain, { detail: 'pelny' });
    view.setLayer('ruch');
    const lot = city.lots[city.startLotId]!;
    const ref = referenceChunks(seed);
    const c = ref.find((x) => x.boxes.some((b) => b.lotId === lot.id))!;
    const box = c.boxes.find((b) => b.lotId === lot.id)!;
    const g = chunkMesh(view, c.chunk).geometry;
    const before = Array.from(g.getAttribute('color').array);
    view.setLots({ ...plain, [lot.id]: 'twoj' });
    const after = Array.from(g.getAttribute('color').array);
    for (let i = 0; i < g.getAttribute('color').count; i++) {
      const changed = [0, 1, 2].some((k) => after[i * 3 + k] !== before[i * 3 + k]);
      expect(changed, `wierzchołek ${i}`).toBe(i >= box.first && i < box.first + box.count);
    }
    const [r, gr, b] = [after[box.first * 3]!, after[box.first * 3 + 1]!, after[box.first * 3 + 2]!];
    expect(gr).toBeGreaterThan(r);
    expect(gr).toBeGreaterThan(b);
    view.dispose();
  });
});

describe('buildCity pelny: witryny wg stanu lokalu', () => {
  const brandTint = (city: CityState, lotId: number): string => (city.lots[lotId]!.brand === 'kawka' ? PALETTE.clothes[6]! : PALETTE.brand.orange);
  const EXPECTED: Record<LotState, (city: CityState, lotId: number) => { cell: AtlasCellName; tint: string }> = {
    wolny: () => ({ cell: 'witrynaWynajem', tint: '#ffffff' }),
    obok: () => ({ cell: 'witrynaWynajem', tint: '#ffffff' }),
    'po-traszce': () => ({ cell: 'witrynaPoTraszce', tint: '#ffffff' }),
    twoj: () => ({ cell: 'witryna', tint: PALETTE.brand.green }),
    konkurencja: (city, id) => ({ cell: 'witryna', tint: brandTint(city, id) }),
    budowa: () => ({ cell: 'tynk', tint: PALETTE.brand.orange }),
    zajety: () => ({ cell: 'witryna', tint: '#ffffff' }),
  };

  it('setLots z „wolny” daje UV komórki witrynaWynajem, z „po-traszce” komórki witrynaPoTraszce, a pozycje się nie zmieniają', () => {
    const seed = SEEDS[0]!;
    const city = cityOf(seed);
    const view = buildCity(city, all(city, 'zajety'), { detail: 'pelny' });
    view.setLayer('makieta');
    const ref = referenceChunks(seed);
    const positions = chunkMeshes(view).map((m) => Array.from(m.geometry.getAttribute('position').array));
    for (const [state, cell] of [['wolny', 'witrynaWynajem'], ['po-traszce', 'witrynaPoTraszce'], ['zajety', 'witryna']] as const) {
      view.setLots(all(city, state));
      for (const c of ref) {
        const g = chunkMesh(view, c.chunk).geometry;
        for (const f of c.fronts) for (let i = f.first; i < f.first + f.count; i++) expect(uvInCell(g, i, cell), `${state} #${f.lotId} uv ${i}`).toBe(true);
      }
    }
    expect(chunkMeshes(view).map((m) => Array.from(m.geometry.getAttribute('position').array))).toEqual(positions);
    view.dispose();
  });

  it('każdy stan ma swoją komórkę i barwę witryny (tabela zadania), także po przejściu przez warstwy', () => {
    const seed = SEEDS[0]!;
    const city = cityOf(seed);
    const view = buildCity(city, all(city, 'zajety'), { detail: 'pelny' });
    const ref = referenceChunks(seed);
    for (const state of Object.keys(EXPECTED) as LotState[]) {
      view.setLayer('ruch');
      view.setLots(all(city, state));    // stan zmieniony pod warstwą: witryna makiety czeka na powrót
      view.setLayer('makieta');
      for (const c of ref) {
        const g = chunkMesh(view, c.chunk).geometry;
        const col = g.getAttribute('color');
        for (const f of c.fronts) {
          const want = EXPECTED[state](city, f.lotId);
          const tint = new Color(want.tint);
          for (let i = f.first; i < f.first + f.count; i++) {
            expect(uvInCell(g, i, want.cell), `${state} #${f.lotId} uv ${i}`).toBe(true);
            expect(col.getX(i), `${state} #${f.lotId}`).toBeCloseTo(tint.r, 5);
            expect(col.getY(i), `${state} #${f.lotId}`).toBeCloseTo(tint.g, 5);
            expect(col.getZ(i), `${state} #${f.lotId}`).toBeCloseTo(tint.b, 5);
          }
        }
      }
    }
    view.dispose();
  });
});

describe('buildCity pelny: kotwice, wybór lokalu i kadr', () => {
  it('kotwice w makiecie leżą nad najwyższym punktem budynku i wyżej niż w warstwach; promień z góry trafia lokal w obu trybach', () => {
    for (const seed of SEEDS) {
      const city = cityOf(seed);
      const view = buildCity(city, generated(city), { detail: 'pelny' });
      const ref = referenceChunks(seed);
      view.setLayer('makieta');
      const mock = new Map(view.pinAnchors().map((a) => [a.lotId, a.world.clone()]));
      view.setLayer('ruch');
      const flat = new Map(view.pinAnchors().map((a) => [a.lotId, a.world.clone()]));
      expect([...mock.keys()].sort(), seed).toEqual([...flat.keys()].sort());
      expect(mock.size, seed).toBeGreaterThan(0);
      for (const [lotId, m] of mock) {
        const f = flat.get(lotId)!;
        const top = lotTop(ref, lotId);
        expect(m.y, `${seed} #${lotId}`).toBeGreaterThan(top);
        expect(f.y, `${seed} #${lotId}`).toBeGreaterThan(top * FLAT_SCALE);
        expect(m.y, `${seed} #${lotId}`).toBeGreaterThan(f.y);
        expect(f.x).toBeCloseTo(m.x, 10);
        expect(f.z).toBeCloseTo(m.z, 10);
      }
      for (const layer of LAYERS) {
        view.setLayer(layer);
        for (const { lotId, world } of view.pinAnchors()) {
          const ray = new Raycaster(new Vector3(world.x, world.y + 20, world.z), new Vector3(0, -1, 0));
          expect(view.pickLot(ray), `${seed} ${layer} #${lotId}`).toBe(lotId);
        }
      }
      view.dispose();
    }
  });

  it('pickLot liczy z bieżącym scale.y: poziomy promień ponad spłaszczonymi dachami trafia wieżę w makiecie, a w warstwach nic', () => {
    const seed = SEEDS[0]!;
    const city = cityOf(seed);
    const view = buildCity(city, generated(city), { detail: 'pelny' });
    const ref = referenceChunks(seed);
    const tops = city.lots.map((l) => ({ lot: l, top: lotTop(ref, l.id) }));
    const tallest = tops.reduce((a, b) => (b.top > a.top ? b : a));
    const y = Math.max(...tops.map((t) => t.top)) * FLAT_SCALE + 0.02;
    expect(tallest.top).toBeGreaterThan(y + 0.1);
    const box = ref.flatMap((c) => c.boxes).find((b) => b.lotId === tallest.lot.id)!.box;
    const ray = new Raycaster(new Vector3(box.min.x - 0.01, y, (box.min.z + box.max.z) / 2), new Vector3(1, 0, 0));
    view.setLayer('makieta');
    expect(view.pickLot(ray)).toBe(tallest.lot.id);
    view.setLayer('dzielnice');
    expect(view.pickLot(ray)).toBeNull();
    view.dispose();
  });

  it('kadr: w makiecie wysokość do kadru to najwyższy punkt sceny (wieże), w warstwach zostaje kadr z 4a.1; miasto mieści się w oknie', () => {
    const city = cityOf(SEEDS[0]!);
    const simple = buildCity(city, generated(city));
    const view = buildCity(city, generated(city), { detail: 'pelny' });
    const maxY = Math.max(...chunkMeshes(view).map((m) => m.geometry.boundingBox!.max.y));
    expect(maxY).toBeGreaterThan(1);   // wieże biurowców w prawdziwej skali
    view.setLayer('makieta');
    const roof = view.fitHeight();
    expect(roof).toBeGreaterThanOrEqual(maxY);
    for (const layer of ['ruch', 'dzielnice'] as const) {
      view.setLayer(layer);
      simple.setLayer(layer);
      expect(view.fitHeight(), layer).toBe(simple.fitHeight());
      expect(cityFitViewSize(1280, 800, 800, view.fitHeight()), layer).toBe(cityFitViewSize(1280, 800, 800));
    }
    expect(cityFitViewSize(1280, 800, 800, roof)).toBeGreaterThan(cityFitViewSize(1280, 800, 800));
    // makieta w kadrze: narożniki miasta z najwyższym punktem mieszczą się w oknie przy każdym obrocie
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      const rig = new CameraRig(w / h);
      const size = cityFitViewSize(w, h, h, roof);
      rig.setViewMax(Math.max(VIEW_SIZE_MAX, size));
      rig.zoomBy(rig.viewSize / size);
      for (const yaw of [0, 1, 2, 3] as const) {
        rig.yawIndex = yaw;
        for (const x of [CITY_BOUNDS.minX, CITY_BOUNDS.maxX]) {
          for (const z of [CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ]) {
            for (const yy of [0, roof]) {
              const p = new Vector3(x, yy, z).project(rig.camera);
              expect(Math.abs(p.x), `${w}×${h} yaw ${yaw}`).toBeLessThanOrEqual(1);
              expect(Math.abs(p.y), `${w}×${h} yaw ${yaw}`).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
    simple.dispose();
    view.dispose();
  });
});

describe('buildCity pelny: sprzątanie', () => {
  it('dispose zwalnia wszystkie geometrie i oba materiały, ale nie tekstury atlasu (wspólny cache)', () => {
    const city = cityOf(SEEDS[0]!);
    const view = buildCity(city, generated(city), { detail: 'pelny' });
    const geometries = new Set(meshesOf(view.root).map((m) => m.geometry));
    const materials = new Set<Material>();
    for (const layer of LAYERS) { view.setLayer(layer); for (const m of meshesOf(view.root)) materials.add(m.material as Material); }
    expect(materials.size).toBe(2);
    let geometry = 0;
    let mat = 0;
    let texture = 0;
    for (const g of geometries) g.addEventListener('dispose', () => { geometry++; });
    for (const m of materials) m.addEventListener('dispose', () => { mat++; });
    for (const t of [atlas.map, atlas.emissive]) t.addEventListener('dispose', () => { texture++; });
    const parent = new Mesh();
    parent.add(view.root);
    view.dispose();
    expect(geometry).toBe(geometries.size);
    expect(mat).toBe(2);
    expect(texture).toBe(0);
    expect(view.root.parent).toBeNull();
    expect(() => view.dispose()).not.toThrow();
    expect(geometry).toBe(geometries.size);
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

  it('skrót numeru lokalu `unit` ma jedną definicję (cityCoords.ts), a cityBuildings.ts nie importuje buildCity.ts (bez cyklu importów)', () => {
    const def = /const unit = \(id: number\)/;
    expect(read('src/render/city/cityCoords.ts')).toMatch(def);
    for (const rel of ['src/render/city/buildCity.ts', 'src/render/city/cityBuildings.ts']) expect(read(rel), rel).not.toMatch(def);
    expect(read('src/render/city/cityBuildings.ts')).not.toMatch(/from '\.\/buildCity'/);
  });
});
