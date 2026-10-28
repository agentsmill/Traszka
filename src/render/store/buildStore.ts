import { Group, Mesh, PointLight, type BufferGeometry, type InstancedMesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cellToWorld } from '@/render/coords';
import type { StoreLayout } from '@/sim/store/types';
import { BRAND, M, glow, type Category, type ShelfSlotLocal, type Vec3 } from './parts';
import { FIXTURE_BUILDERS, type FixtureBuilder } from './fixtures';
import { loweredWalls, splitAtHeight, wallBehind, type Cutaway, type YawIndex } from './cutaway';
import { LAMP_EMISSIVE, WALL_SIDES, buildShell, type WallSide } from './shell';

export { FIXTURE_BUILDERS, type FixtureBuilder };
export { makeSignTexture } from './signTexture';

/**
 * Półka do wypełnienia towarem (Task 9) w układzie świata. `position` to środek górnej powierzchni najniższej półki;
 * półka biegnie wzdłuż lokalnej osi x po obrocie o `rotationY` wokół y (długość `width`), lokalne +z po obrocie to
 * kierunek do klienta (głębokość `depth`). Kolejne poziomy leżą co `levelStep` m w górę. `category` to kategoria
 * z tabliczki na nadstawce (towar powinien się z nią zgadzać).
 */
export interface ShelfSlot {
  fixtureId: string;
  position: [number, number, number];
  width: number;
  depth: number;
  levels: number;
  levelStep: number;
  rotationY: number;
  category: Category;
}

export interface StoreView {
  root: Group;
  shelfSlots: ShelfSlot[];
  /**
   * Obniża do 0,5 m ściany od strony kamery o danym `yawIndex` (tabela w CameraRig). Ignorowane w trybie zewnętrznym. Regał z
   * papierosami tnie się razem ze ścianą, przy której stoi (cutaway.ts): kasjer przed nim jest widoczny z każdego kąta.
   */
  setCutaway(yawIndex: YawIndex): void;
  /** Widok z zewnątrz: pełne ściany, szyld i witryna niezależnie od przekroju. */
  setExteriorMode(on: boolean): void;
  /**
   * Dzień: lampy świecą słabiej, ciepłe światło wnętrza ma natężenie 0. Noc: lampy pełne, do 6 świateł punktowych,
   * poświata witryn na chodniku. Światła punktowe zostają w scenie (widoczne) przez cały czas, a zmienia się tylko ich
   * natężenie: zmiana liczby świateł przekompilowałaby przy pierwszym przełączeniu wszystkie materiały (przycięcie klatki).
   */
  setTimeOfDay(t: 'day' | 'night'): void;
  dispose(): void;
}

/** Ciepłe światło wnętrza nocą: kolor okien nocą z tabeli świateł (docs/style-guide.md §4), bez cieni. */
const INTERIOR_LIGHT = { color: '#ffd28a', intensity: 9, distance: 9, decay: 2, max: 6 } as const;

interface Bucket { material: Material; cast: boolean; receive: boolean; geometries: BufferGeometry[]; upper: BufferGeometry[] }

/** Mebel (jedno ze `sources`), którego część nad `height` ma dać się wyłączyć bez dodatkowych siatek (patrz `Switchable`). */
interface CutSource { source: Object3D; height: number }

/**
 * Siatka, której końcowy odcinek bufora to górna część mebla z przekrojem: wierzchołki [0, `head`) są zawsze, [`head`, `total`)
 * tylko przy pełnej ścianie. Przełącza je sam zakres rysowania (bez kopii geometrii, bez dodatkowego draw calla), a siatka,
 * w której zostałaby sama góra, jest wtedy ukryta (zerowy zakres też kosztuje wywołanie rysowania).
 */
interface Switchable { mesh: Mesh; head: number; total: number }

function isUnder(o: Object3D, ancestor: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

/**
 * Scala siatki z `sources` w jedną siatkę na (materiał, rzucanie cienia, odbieranie cienia). Źródła przechodzą
 * do tymczasowego rodzica w początku świata, więc ich macierze są już w układzie świata. Geometrie źródeł są
 * współdzielone (cache w parts.ts) i zostają nietknięte; zwalnia się tylko wynik, zapisany w `owned`.
 * Siatki `cut.source` są cięte na wysokości `cut.height` (cutaway.ts): dolne kawałki idą do bufora jak reszta, górne na jego
 * koniec, a `switchable` opisuje, które siatki mają taki odcinek.
 */
function mergeSources(name: string, sources: Object3D[], owned: BufferGeometry[], cut?: CutSource): { meshes: Mesh[]; switchable: Switchable[] } {
  const scratch = new Group();
  scratch.add(...sources);
  scratch.updateMatrixWorld(true);
  const buckets = new Map<string, Bucket>();
  scratch.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    const mesh = o as Mesh;
    const material = mesh.material as Material;
    const key = `${material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}`;
    let b = buckets.get(key);
    if (!b) { b = { material, cast: mesh.castShadow, receive: mesh.receiveShadow, geometries: [], upper: [] }; buckets.set(key, b); }
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrixWorld);
    if (cut && isUnder(mesh, cut.source)) {
      const { below, above } = splitAtHeight(g, cut.height);
      g.dispose();
      if (below) b.geometries.push(below);
      if (above) b.upper.push(above);
    } else b.geometries.push(g);
  });
  const meshes: Mesh[] = [];
  const switchable: Switchable[] = [];
  for (const b of buckets.values()) {
    const head = b.geometries.reduce((n, g) => n + g.getAttribute('position').count, 0);
    const parts = [...b.geometries, ...b.upper];
    const merged = mergeGeometries(parts, false);
    for (const g of parts) g.dispose();
    if (!merged) throw new Error(`buildStore: nie udało się scalić geometrii "${name}"`);
    owned.push(merged);
    const mesh = new Mesh(merged, b.material);
    mesh.name = `${name}:${b.material.name || 'mat'}`;
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    meshes.push(mesh);
    if (b.upper.length > 0) switchable.push({ mesh, head, total: merged.getAttribute('position').count });
  }
  return { meshes, switchable };
}

/** Scala `sources` w grupę z jedną siatką na materiał; geometrie wyniku trafiają do `owned` (do zwolnienia). */
export function mergedGroup(name: string, sources: Object3D[], owned: BufferGeometry[]): Group {
  const g = new Group();
  g.name = name;
  g.add(...mergeSources(name, sources, owned).meshes);
  return g;
}

/** Do `max` równomiernie rozłożonych lamp (kolejność generowania to siatka, więc indeksy równo pokrywają salę). */
function pickEven<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]!);
}

/**
 * Buduje bryłę sklepu: powłokę (podłoga, ściany z witryną i szyldem, lampy) i wszystkie meble z `layout.fixtures`.
 * Geometria statyczna jest scalona w jedną siatkę na materiał (kilkadziesiąt draw calls zamiast tysięcy). Każdy mebel
 * ma w `root` obiekt o nazwie `fixture.id` (kotwica z pozycją; znaczniki slotów zachowują własne siatki, bo będą klikalne).
 */
export function buildStore(layout: StoreLayout): StoreView {
  const owned: BufferGeometry[] = [];
  const shell = buildShell(layout);
  const root = new Group();
  root.name = 'store';

  // meble: każdy do swojego rogu footprintu
  const staticSources: Object3D[] = [shell.floor, shell.ceiling];
  const midSources: Object3D[] = [shell.walls.mid.high];
  // Mebel z przekrojem (`userData.cutaway`): jego górę da się wyłączyć w statycznej siatce, a płyta zamykająca przekrój to osobna,
  // mała siatka widoczna tylko w przekroju. Zakres rysowania obsługuje jeden taki mebel (generator daje jeden regał z papierosami):
  // kolejne zostają w całości.
  let cut: (CutSource & { wall: WallSide; cap: Object3D; id: string }) | null = null;
  const shelfSlots: ShelfSlot[] = [];
  const anchors = new Group();
  anchors.name = 'fixtures';
  for (const f of layout.fixtures) {
    const obj = FIXTURE_BUILDERS[f.kind](f, layout.seed);
    const c = cellToWorld(layout, f.x, f.y);
    obj.position.set(c.x - M / 2, 0, c.z - M / 2);
    for (const s of (obj.userData.shelfSlots ?? []) as ShelfSlotLocal[]) {
      const p = s.position;
      shelfSlots.push({
        fixtureId: f.id,
        position: [obj.position.x + p[0], p[1], obj.position.z + p[2]] as Vec3,
        width: s.width, depth: s.depth, levels: s.levels, levelStep: s.levelStep, rotationY: s.rotationY, category: s.category,
      });
    }
    if (obj.userData.separate) { anchors.add(obj); continue; }
    const cutaway = obj.userData.cutaway as Cutaway | undefined;
    if (cutaway && !cut) {
      cutaway.cap.position.copy(obj.position);
      cut = { source: obj, height: cutaway.height, wall: wallBehind(f.facing), cap: cutaway.cap, id: f.id };
    }
    (f.kind === 'backroomDoor' ? midSources : staticSources).push(obj);
    const anchor = new Group();
    anchor.name = f.id;
    anchor.position.copy(obj.position);
    anchor.userData = { fixtureId: f.id, kind: f.kind };
    anchors.add(anchor);
  }

  // scalanie statycznej geometrii
  const staticMerge = mergeSources('static', staticSources, owned, cut ?? undefined);
  const staticGroup = new Group();
  staticGroup.name = 'static';
  staticGroup.add(...staticMerge.meshes);
  const lampsGroup = mergedGroup('lamps', [shell.lamps], owned);
  const lampMesh = lampsGroup.children[0] as Mesh | undefined;
  const lampDay = glow(BRAND.cream, LAMP_EMISSIVE.day);
  const lampNight = glow(BRAND.cream, LAMP_EMISSIVE.night);
  const windowGlow = mergedGroup('window-glow', [shell.windowGlow], owned);
  windowGlow.visible = false;
  // plama światła leży na chodniku: N8AO ma jej nie traktować jak szyby i zostawić AO pod nią (patrz blobShadows.ts)
  windowGlow.traverse((o) => { o.userData.treatAsOpaque = true; });

  // ściany: low zawsze, high (pełna) albo cap (przekrój) zależnie od kamery
  const walls = {} as Record<WallSide, { group: Group; high: Group; cap: Group }>;
  for (const side of WALL_SIDES) {
    const parts = shell.walls[side];
    const group = new Group();
    group.name = `wall:${side}`;
    group.add(mergedGroup(`wall:${side}:low`, [parts.low], owned));
    walls[side] = {
      group,
      high: mergedGroup(`wall:${side}:high`, side === 'mid' ? midSources : [parts.high], owned),
      cap: mergedGroup(`wall:${side}:cap`, [parts.cap], owned),
    };
    group.add(walls[side].high);
  }

  // płyta zamykająca przekrój mebla (widoczna tylko, gdy mebel jest ścięty razem ze ścianą)
  const cutCap = cut ? mergedGroup(`${cut.id}:cap`, [cut.cap], owned) : null;
  if (cutCap) cutCap.visible = false;

  // ciepłe światło wnętrza: kilka świateł punktowych przy lampach, bez cieni, tylko nocą
  const lights = new Group();
  lights.name = 'interior-lights';
  for (const p of pickEven(shell.lampPositions, INTERIOR_LIGHT.max)) {
    const light = new PointLight(INTERIOR_LIGHT.color, 0, INTERIOR_LIGHT.distance, INTERIOR_LIGHT.decay);
    light.castShadow = false;
    light.position.copy(p);
    lights.add(light);
  }

  root.add(staticGroup, lampsGroup, windowGlow, ...WALL_SIDES.map((s) => walls[s].group), ...(cutCap ? [cutCap] : []), anchors, lights);

  let yaw: YawIndex = 0;
  let exterior = false;
  const applyWalls = (): void => {
    const lowered = loweredWalls(yaw, exterior);
    for (const side of WALL_SIDES) {
      const w = walls[side];
      if (lowered.includes(side)) { w.group.remove(w.high); w.group.add(w.cap); } else { w.group.remove(w.cap); w.group.add(w.high); }
    }
    // mebel z przekrojem tnie się razem ze ścianą za nim: ściana obniżona = góra mebla wyłączona, a przekrój zamknięty płytą
    const full = !(cut && lowered.includes(cut.wall));
    for (const s of staticMerge.switchable) {
      s.mesh.geometry.setDrawRange(0, full ? s.total : s.head);
      s.mesh.visible = full || s.head > 0;
    }
    if (cutCap) cutCap.visible = !full;
  };
  applyWalls();

  let disposed = false;
  const view: StoreView = {
    root,
    shelfSlots,
    setCutaway(yawIndex) { yaw = yawIndex; applyWalls(); },
    setExteriorMode(on) { exterior = on; applyWalls(); },
    setTimeOfDay(t) {
      const night = t === 'night';
      for (const l of lights.children) (l as PointLight).intensity = night ? INTERIOR_LIGHT.intensity : 0;
      if (lampMesh) lampMesh.material = night ? lampNight : lampDay;
      windowGlow.visible = night;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // dołożony towar (Task 9): instancje mają własne bufory na GPU; geometrie i materiały są wspólne i zostają
      root.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose(); });
      root.removeFromParent();
      for (const g of owned) g.dispose();
      owned.length = 0;
      for (const d of shell.disposables) d.dispose();
      for (const l of lights.children) (l as PointLight).dispose();
    },
  };
  view.setTimeOfDay('day');
  return view;
}
