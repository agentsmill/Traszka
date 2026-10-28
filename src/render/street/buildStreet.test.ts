import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Box3, BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type BufferGeometry } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { generateStore } from '@/sim/store/generateStore';
import { cellToWorld } from '@/render/coords';
import { CameraRig } from '@/render/cameraRig';
import { CELL_SIZE_M } from '@/sim/grid';
import type { LotKind, StoreLayout } from '@/sim/store/types';
import { PALETTE } from '@/render/style';
import { WALL_H } from '@/render/store/shell';
import { SIDE_STREET, cornerSide, planRow, storeOuter, volumeHeight } from './buildings';
import { buildStreet, type StreetView } from './buildStreet';
import { createFacadeAtlas, type AtlasCellName } from './facadeAtlas';

/** Po jednym seedzie na rodzaj lokalu; `d` to kamienica narożna z przecznicą po prawej, `kiełbasa-12` z przecznicą po lewej. */
const SEEDS: Record<LotKind, string> = { blok: 'kiełbasa-42', kamienica: 'kiełbasa-12', pawilon: 'traszka-1' };
const KINDS = Object.keys(SEEDS) as LotKind[];
const CELLS: AtlasCellName[] = ['okno', 'oknoGasne', 'loggia', 'szewPlyty', 'tynk', 'witryna', 'brama', 'gzyms', 'mural', 'muralSzop', 'podloga'];

/** Loader, który zawsze zawodzi: w Node nie ma sieci ani WebGL, a ulica ma wtedy dać same grupy rekwizytów (ruling R5). */
const failing = (): Promise<GLTF> => Promise.reject(new Error('brak sieci'));

/** Atrapa modelu GLB (latarnia, dostawczak): jedna siatka o wysokości 1,66 m, którą ulica skaluje do wysokości rekwizytu. */
const stubLoader = (): Promise<GLTF> => {
  const scene = new Group();
  const geometry = new BoxGeometry(0.7, 1.66, 0.6);
  geometry.translate(0, 0.78, 0);
  scene.add(new Mesh(geometry, new MeshStandardMaterial({ name: 'stub' })));
  return Promise.resolve({ scene } as unknown as GLTF);
};

const built: StreetView[] = [];
async function street(seed: string, load: (url: string) => Promise<GLTF> = failing): Promise<{ view: StreetView; layout: StoreLayout }> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const layout = generateStore(seed);
  const view = await buildStreet(layout, seed, load);
  built.push(view);
  return { view, layout };
}
afterEach(() => {
  for (const v of built.splice(0)) v.dispose();
  vi.restoreAllMocks();
});

function meshesOf(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
  return out;
}
/** Mesh widoczny w scenie: on i wszyscy przodkowie mają visible. */
const visible = (o: Object3D): boolean => {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
};
const boxOf = (m: Mesh): Box3 => {
  m.updateWorldMatrix(true, false);
  return new Box3().setFromObject(m);
};
/** Pozycja i obrót wokół y rekwizytów o danym prefiksie nazwy. */
const positions = (view: StreetView, prefix: string): [number, number, number, number][] =>
  view.root.children.filter((c) => c.name.startsWith(prefix)).map((c) => [c.position.x, c.position.y, c.position.z, c.rotation.y]);

describe('buildStreet: budynki', () => {
  for (const kind of KINDS) {
    it(`${kind}: root ma obiekt building:${kind}, a sąsiedzi i rekwizyty mają nazwane grupy`, async () => {
      const { view, layout } = await street(SEEDS[kind]);
      expect(layout.lot.kind).toBe(kind);
      expect(view.root.getObjectByName(`building:${kind}`)).toBeDefined();
      expect(view.root.getObjectByName('neighbour:0')).toBeDefined();
      expect(view.root.getObjectByName('neighbour:1')).toBeDefined();
      for (const name of ['prop:lamp:0', 'prop:lamp:1', 'prop:van:0', 'prop:bench:0', 'prop:bin:0', 'prop:tree:0', 'prop:tree:1']) {
        expect(view.root.getObjectByName(name), name).toBeDefined();
      }
    });

    it(`${kind}: w przekroju nic nad sklepem nie przekracza stropu (${WALL_H} m), po wyłączeniu przekroju stoi pełny budynek`, async () => {
      const { view, layout } = await street(SEEDS[kind]);
      const o = storeOuter(layout);
      // wierzchołki (nie bryły brzegowe): siatka podłoża obejmuje też podwórko z drzewami, a dalszy sąsiad stoi przy
      // sklepie i jego relief (parapety 14 cm, mural) wchodzi nad obrys, więc liczy się wnętrze obrysu z marginesem 20 cm
      const topOver = (): number => {
        let top = 0;
        const p = new Vector3();
        for (const m of meshesOf(view.root).filter(visible)) {
          m.updateWorldMatrix(true, false);
          const pos = m.geometry.attributes.position!;
          for (let i = 0; i < pos.count; i++) {
            p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
            if (p.x > o.x0 + 0.2 && p.x < o.x1 - 0.2 && p.z > o.z0 + 0.2 && p.z < o.z1 - 0.2) top = Math.max(top, p.y);
          }
        }
        return top;
      };

      for (const yaw of [0, 1, 2, 3] as const) {
        view.setBuildingCutaway(true, yaw);
        expect(topOver(), `yaw ${yaw}`).toBeLessThanOrEqual(WALL_H + 1e-6);
      }

      view.setBuildingCutaway(false);
      const spec = planRow(layout, SEEDS[kind]).own[0]!;
      expect(topOver()).toBeGreaterThan(volumeHeight(spec) + 0.4);
      expect(topOver()).toBeGreaterThan(WALL_H);
    });

    it(`${kind}: w przekroju sąsiad od strony kamery spada do 0,5 m, dalszy i oba bez przekroju mają pełną wysokość`, async () => {
      const { view, layout } = await street(SEEDS[kind]);
      const plan = planRow(layout, SEEDS[kind]);
      const o = storeOuter(layout);
      const topOfNeighbour = (i: number): number =>
        Math.max(...meshesOf(view.root.getObjectByName(`neighbour:${i}`)!).filter(visible).map((m) => boxOf(m).max.y));
      for (const yaw of [0, 1, 2, 3] as const) {
        view.setBuildingCutaway(true, yaw);
        // kamera stoi po stronie −x dla yaw 0 i 1 (tabela w CameraRig), więc wtedy blisko jest sąsiad od strony −x
        plan.neighbours.forEach((n, i) => {
          const near = (n.x1 <= o.x0 + 1e-6) === (yaw <= 1);
          if (near) expect(topOfNeighbour(i), `yaw ${yaw} sąsiad ${i}`).toBeLessThanOrEqual(0.5 + 1e-6);
          else expect(topOfNeighbour(i), `yaw ${yaw} sąsiad ${i}`).toBeGreaterThan(volumeHeight(n));
        });
      }
      view.setBuildingCutaway(false);
      plan.neighbours.forEach((n, i) => expect(topOfNeighbour(i)).toBeGreaterThan(volumeHeight(n)));
    });

    it(`${kind}: elewacja nad sklepem nie schodzi poniżej szyldu (y ≥ ${WALL_H} m), więc nie nakłada się na niego`, async () => {
      const { view, layout } = await street(SEEDS[kind]);
      const o = storeOuter(layout);
      const mesh = view.root.getObjectByName(`building:${kind}:full`) as Mesh;
      const p = mesh.geometry.attributes.position!;
      for (let i = 0; i < p.count; i++) {
        if (p.getX(i) > o.x0 && p.getX(i) < o.x1 && p.getZ(i) < o.z0 - 1e-6) {
          expect(p.getY(i), `wierzchołek ${i}`).toBeGreaterThanOrEqual(WALL_H - 1e-6);
        }
      }
    });
  }

  it('kondygnacje: blok 5, kamienica 3–4, pawilon 1 (parter to sklep)', () => {
    const blok = planRow(generateStore(SEEDS.blok), SEEDS.blok).own[0]!;
    const kamienica = planRow(generateStore(SEEDS.kamienica), SEEDS.kamienica).own[0]!;
    const pawilon = planRow(generateStore(SEEDS.pawilon), SEEDS.pawilon).own[0]!;
    expect(blok.floors).toBe(5);
    expect(kamienica.floors).toBeGreaterThanOrEqual(3);
    expect(kamienica.floors).toBeLessThanOrEqual(4);
    expect(pawilon.floors).toBe(1);
  });

  it('kamienica ma bramę obok sklepu, a lokal narożny przecznicę zamiast sąsiada po stronie drugiej witryny', () => {
    for (const seed of [SEEDS.kamienica, 'd']) {
      const layout = generateStore(seed);
      const plan = planRow(layout, seed);
      const o = storeOuter(layout);
      const corner = cornerSide(layout);
      expect(corner, seed).not.toBeNull();
      const gate = plan.own.find((v) => v.gate)!;
      expect(gate, seed).toBeDefined();
      // brama przylega do sklepu po stronie przeciwnej do przecznicy
      expect(gate.x1 <= o.x0 + 1e-6, seed).toBe(corner === 'maxX');
      expect(gate.x0 >= o.x1 - 1e-6, seed).toBe(corner === 'minX');
      // po stronie przecznicy sąsiad zaczyna się za nią: chodnik + jezdnia + chodnik
      const [left, right] = plan.neighbours;
      if (corner === 'minX') expect(o.x0 - left!.x1).toBeCloseTo(SIDE_STREET.total, 5);
      else expect(right!.x0 - o.x1).toBeCloseTo(SIDE_STREET.total, 5);
    }
  });

  it('sąsiedzi stykają się z budynkiem sklepu (bez szpar), poza przecznicą', async () => {
    const layout = generateStore(SEEDS.blok);
    const plan = planRow(layout, SEEDS.blok);
    const [store] = plan.own;
    const [left, right] = plan.neighbours;
    expect(left!.x1).toBeCloseTo(store!.x0, 6);
    expect(right!.x0).toBeCloseTo(store!.x1, 6);
    expect(left!.coverMax).toBeGreaterThan(0);
    expect(right!.coverMin).toBeGreaterThan(0);
  });
});

describe('buildStreet: rekwizyty i seed', () => {
  it('ten sam seed daje te same pozycje drzew i rekwizytów, inny seed inne', async () => {
    const a = await street('kiełbasa-42');
    const b = await street('kiełbasa-42');
    const c = await street('kiełbasa-7');
    for (const prefix of ['prop:tree:', 'prop:lamp:', 'prop:van:', 'prop:bench:', 'prop:bin:']) {
      expect(positions(a.view, prefix), prefix).toEqual(positions(b.view, prefix));
    }
    expect(positions(a.view, 'prop:tree:')).not.toEqual(positions(c.view, 'prop:tree:'));
  });

  it('losowość ulicy idzie tylko przez createRng: żaden plik ulicy nie używa Math.random', () => {
    const dir = new URL('.', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(/Math\.random/);
  });

  it('2–4 drzewa stoją na chodniku z dala od sklepu, a latarnie i dostawczak poza wejściem', async () => {
    for (const seed of ['kiełbasa-42', 'kiełbasa-12', 'traszka-1', 'd', 'a', 'b', 'c']) {
      const { view, layout } = await street(seed);
      const o = storeOuter(layout);
      const trees = positions(view, 'prop:tree:');
      expect(trees.length, seed).toBeGreaterThanOrEqual(2);
      expect(trees.length, seed).toBeLessThanOrEqual(4);
      for (const [x, , z] of trees) {
        // korona wysokiego drzewa zasłoniłaby wnętrze w którymś z obrotów kamery, więc: ≥ 5 m od obrysu sklepu wzdłuż ulicy
        expect(x < o.x0 - 5 || x > o.x1 + 5, `${seed} drzewo x=${x}`).toBe(true);
        expect(z, `${seed} drzewo na chodniku`).toBeGreaterThan(o.zs);
        expect(z, `${seed} drzewo na chodniku`).toBeLessThan(o.z0);
      }
      expect(positions(view, 'prop:lamp:')).toHaveLength(2);
      const [van] = positions(view, 'prop:van:');
      expect(van![2], `${seed} dostawczak na jezdni`).toBeLessThan(o.zs);
    }
  });

  it('ławka i kosz stoją w wierszu 0 siatki (przy krawężniku) przed sklepem lub bramą, z dala od wejścia i od siebie', async () => {
    for (const seed of ['kiełbasa-42', 'kiełbasa-12', 'traszka-1', 'd', 'a', 'b', 'c', 'e', 'f']) {
      const { view, layout } = await street(seed);
      const o = storeOuter(layout);
      const plan = planRow(layout, seed);
      const lo = Math.min(...plan.own.map((v) => v.x0));
      const hi = Math.max(...plan.own.map((v) => v.x1));
      const entranceX = layout.entrance.reduce((sum, c) => sum + cellToWorld(layout, c.x, c.y).x, 0) / layout.entrance.length;
      const spots: number[] = [];
      for (const prefix of ['prop:bench:', 'prop:bin:']) {
        const [x, , z] = positions(view, prefix)[0]!;
        expect(x, `${seed} ${prefix}`).toBeGreaterThan(lo);
        expect(x, `${seed} ${prefix}`).toBeLessThan(hi);
        expect(Math.abs(x - entranceX), `${seed} ${prefix} przy wejściu`).toBeGreaterThan(1);
        expect(z).toBeGreaterThan(o.zs);
        expect(z).toBeLessThan(o.zs + 0.5);
        spots.push(x);
      }
      expect(Math.abs(spots[0]! - spots[1]!), `${seed} ławka i kosz`).toBeGreaterThan(1.5);
    }
    // ławka i kosz mają własną geometrię (w Node z modeli nie ma nic, więc to nie pusta grupa)
    const { view } = await street('kiełbasa-42');
    for (const name of ['prop:bench:0', 'prop:bin:0']) expect(meshesOf(view.root.getObjectByName(name)!)).toHaveLength(1);
  });

  it('gdy model nie wczyta się, grupy rekwizytów zostają puste i jest jedno ostrzeżenie', async () => {
    const { view } = await street('kiełbasa-42');
    const warn = vi.mocked(console.warn);
    expect(warn).toHaveBeenCalledTimes(1);
    for (const prefix of ['prop:lamp:', 'prop:van:']) {
      for (const c of view.root.children.filter((o) => o.name.startsWith(prefix))) expect(c.children, c.name).toHaveLength(0);
    }
    // drzewa są proceduralne (zadanie 16), więc nie zależą od wczytania modeli
    for (const c of view.root.children.filter((o) => o.name.startsWith('prop:tree:'))) expect(meshesOf(c), c.name).toHaveLength(1);
  });

  it('wczytany model trafia do grupy, jest skalowany do rzeczywistych wymiarów i stoi na ziemi', async () => {
    const { view } = await street('kiełbasa-42', stubLoader);
    expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
    const heightOf = (name: string): { min: number; height: number } => {
      const group = view.root.getObjectByName(name)!;
      expect(group.children.length, name).toBeGreaterThan(0);
      const box = new Box3().setFromObject(group);
      return { min: box.min.y, height: box.max.y - box.min.y };
    };
    for (const name of ['prop:lamp:0', 'prop:van:0']) expect(heightOf(name).min, name).toBeCloseTo(0, 5);
    expect(heightOf('prop:lamp:0').height).toBeCloseTo(4.5, 3);
    expect(heightOf('prop:van:0').height).toBeCloseTo(2.2, 3);
    // model spłaszczony do jednej siatki z kolorami wierzchołków (draw calls), bez rzucania cienia (poza zasięgiem kamery cienia)
    for (const name of ['prop:lamp:0', 'prop:van:0']) {
      const parts = meshesOf(view.root.getObjectByName(name)!);
      expect(parts.length, name).toBeGreaterThanOrEqual(1);
      for (const part of parts) expect(part.castShadow, `${name}:${part.name}`).toBe(false);
      expect((parts.find((p) => p.name.endsWith(':main'))!.material as MeshStandardMaterial).vertexColors, name).toBe(true);
    }
  });

  it('drzewa są proceduralne: 3,5–5,7 m, stoją na ziemi, to jedna siatka z kolorami wierzchołków bez cienia (bez modeli)', async () => {
    for (const seed of ['kiełbasa-42', 'kiełbasa-12', 'traszka-1']) {
      const { view } = await street(seed);
      const trees = view.root.children.filter((c) => c.name.startsWith('prop:tree:'));
      expect(trees.length, seed).toBeGreaterThanOrEqual(2);
      for (const tree of trees) {
        const box = new Box3().setFromObject(tree);
        expect(box.max.y - box.min.y, `${seed} ${tree.name}`).toBeGreaterThanOrEqual(3.5);
        expect(box.max.y - box.min.y, `${seed} ${tree.name}`).toBeLessThanOrEqual(5.7);
        expect(box.min.y, `${seed} ${tree.name}`).toBeCloseTo(0, 5);
        const crowns = meshesOf(tree);
        expect(crowns, tree.name).toHaveLength(1);
        expect(crowns[0]!.castShadow).toBe(false);
        expect((crowns[0]!.material as MeshStandardMaterial).vertexColors).toBe(true);
      }
    }
  });
});

describe('buildStreet: kolory, tekstury, noc, zwalnianie', () => {
  it('kolory wierzchołków budynków, podłoża i rekwizytów pochodzą z PALETTE (plus biała baza pod własne kolory komórek)', async () => {
    const allowed = new Set<string>();
    const walk = (v: unknown): void => {
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) allowed.add(new Color(v).getHexString());
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(PALETTE);
    const white = new Color('#ffffff').getHexString();
    for (const kind of KINDS) {
      const { view } = await street(SEEDS[kind], stubLoader);
      for (const mesh of meshesOf(view.root)) {
        const color = mesh.geometry.attributes.color;
        if (!color) continue;
        const seen = new Set<string>();
        const c = new Color();
        for (let i = 0; i < color.count; i++) seen.add(c.setRGB(color.getX(i), color.getY(i), color.getZ(i)).getHexString());
        for (const hex of seen) expect(allowed.has(hex) || hex === white, `${kind} ${mesh.name} kolor #${hex}`).toBe(true);
      }
    }
  });

  it('UV budynków leżą wewnątrz komórek atlasu, a komórki atlasu się nie nakładają', async () => {
    const atlas = createFacadeAtlas();
    const rects = CELLS.map((n) => atlas.cell(n));
    for (const r of rects) {
      expect(r[0]).toBeGreaterThanOrEqual(0);
      expect(r[2]).toBeLessThanOrEqual(1);
      expect(r[0]).toBeLessThan(r[2]);
      expect(r[1]).toBeLessThan(r[3]);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlap = a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
        expect(overlap, `${CELLS[i]} ∩ ${CELLS[j]}`).toBe(false);
      }
    }
    const { view } = await street(SEEDS.kamienica);
    const eps = 1e-6;
    for (const mesh of meshesOf(view.root.getObjectByName('buildings')!)) {
      const uv = mesh.geometry.attributes.uv!;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        expect(rects.some((r) => u >= r[0] - eps && u <= r[2] + eps && v >= r[1] - eps && v <= r[3] + eps), `${mesh.name} uv ${u},${v}`).toBe(true);
      }
    }
  });

  it('budynki to kilka draw calls: jedna zmergowana siatka na budynek, a całość ulicy mieści się w budżecie', async () => {
    for (const kind of KINDS) {
      const { view } = await street(SEEDS[kind]);
      const buildings = view.root.getObjectByName('buildings')!;
      view.setBuildingCutaway(false);
      expect(meshesOf(buildings).filter(visible)).toHaveLength(3);
      view.setBuildingCutaway(true);
      expect(meshesOf(buildings).filter(visible).length).toBeLessThanOrEqual(3);
    }
    // wszystkie widoczne siatki ulicy z modelami (po jednej na rekwizyt) przybliżają liczbę draw calls dokładaną do klatki
    const { view } = await street(SEEDS.blok, stubLoader);
    view.setBuildingCutaway(true);
    expect(meshesOf(view.root).filter(visible).length).toBeLessThanOrEqual(24);
  });

  it('noc zapala emissive okien i poświatę latarni, dzień je gasi', async () => {
    const { view } = await street(SEEDS.blok);
    const material = (view.root.getObjectByName('building:blok:full') as Mesh).material as MeshStandardMaterial;
    const pools = view.root.getObjectByName('lamp-pools')!;
    expect(material.emissiveIntensity).toBe(0);
    expect(pools.visible).toBe(false);
    view.setTimeOfDay('night');
    expect(material.emissiveIntensity).toBeGreaterThanOrEqual(1);
    expect(material.emissiveIntensity).toBeLessThanOrEqual(1.6);
    expect(material.emissiveMap).toBe(createFacadeAtlas().emissive);
    expect(pools.visible).toBe(true);
    view.setTimeOfDay('day');
    expect(material.emissiveIntensity).toBe(0);
    expect(pools.visible).toBe(false);
  });

  it('mural na odsłoniętej ścianie mieści się w domyślnym kadrze pod paskiem UI (yaw 0, zoom domyślny, 1400×860 i 1200×672)', async () => {
    // Kadr jak w main.ts: granice sklepu, cel kamery na środku sali i zaplecza.
    const TOP_BAR_PX = 44;   // pasek gry (ui.css .tt-hud) ma ok. 43 px wysokości
    const atlas = createFacadeAtlas();
    const rects = [atlas.cell('mural'), atlas.cell('muralSzop')];
    let framed = 0;
    for (const seed of ['kiełbasa-42', 'kiełbasa-7', 'kiełbasa-12', 'traszka-1', 'traszka-5', 'kiełbasa-3']) {
      const { view, layout } = await street(seed);
      view.setBuildingCutaway(true, 0);
      const lo = cellToWorld(layout, 0, 0);
      const hi = cellToWorld(layout, layout.width - 1, layout.depth - 1);
      const pts: Vector3[] = [];
      for (const mesh of meshesOf(view.root.getObjectByName('buildings')!)) {
        if (!visible(mesh)) continue;
        mesh.updateWorldMatrix(true, false);
        const uv = mesh.geometry.attributes.uv!;
        const pos = mesh.geometry.attributes.position!;
        for (let i = 0; i < uv.count; i++) {
          const u = uv.getX(i);
          const v = uv.getY(i);
          if (rects.some((r) => u >= r[0] - 1e-6 && u <= r[2] + 1e-6 && v >= r[1] - 1e-6 && v <= r[3] + 1e-6)) {
            pts.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
          }
        }
      }
      if (pts.length === 0) continue;   // niski sąsiad (kamienica/pawilon) muralu nie dostaje
      framed++;
      for (const [w, h] of [[1400, 860], [1200, 672]] as const) {
        const rig = new CameraRig(w / h);
        rig.setBounds(lo.x - CELL_SIZE_M / 2, lo.z - CELL_SIZE_M / 2, hi.x + CELL_SIZE_M / 2, hi.z + CELL_SIZE_M / 2);
        rig.panBy(-rig.target.x, cellToWorld(layout, 0, (5 + layout.depth) / 2).z - rig.target.z);
        rig.camera.updateMatrixWorld(true);
        let top = Infinity;
        for (const p of pts) {
          const ndc = p.clone().project(rig.camera);
          top = Math.min(top, ((1 - ndc.y) / 2) * h);
        }
        expect(top, `${seed} ${w}×${h}: górna krawędź muru (px od góry ekranu)`).toBeGreaterThanOrEqual(TOP_BAR_PX + 6);
      }
    }
    expect(framed, 'co najmniej jeden seed ma mural w kadrze').toBeGreaterThanOrEqual(2);
  });

  it('dispose zwalnia geometrie ulicy i odpina root, a ponowne wywołanie nic nie psuje', async () => {
    const { view } = await street(SEEDS.pawilon);
    const parent = new Group();
    parent.add(view.root);
    const geometries = new Set<BufferGeometry>(meshesOf(view.root).map((m) => m.geometry));
    let disposed = 0;
    for (const g of geometries) g.addEventListener('dispose', () => { disposed++; });
    view.dispose();
    expect(view.root.parent).toBeNull();
    expect(disposed).toBe(geometries.size);
    expect(() => view.dispose()).not.toThrow();
    expect(new Vector3().copy(view.root.position)).toEqual(new Vector3());
  });
});
