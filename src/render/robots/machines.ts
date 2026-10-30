import { Group, MathUtils, type BufferGeometry, type Mesh } from 'three';
import { cellToWorld } from '@/render/coords';
import {
  BRAND, FIX, M, box, cachedTexture, canvasTexture, cyl, glow, matte, painted, plane, texturedMaterial,
} from '@/render/store/parts';
import { PALETTE } from '@/render/style';
import type { Cell } from '@/sim/grid';
import type { Fixture, StoreLayout } from '@/sim/store/types';
import { bake } from './bake';

// Maszyny z warsztatu złotej rączki (upgrades.ts: `tasmociag`, `wykladacz`, `prasa`). Rekwizyty jak reszta sprzętu: bryły z parts.ts
// wypieczone w kilka siatek (`bake`), a tylko to, co się rusza, jest osobną siatką. Symulacja ich nie zna, więc nie stoją tam,
// gdzie chodzą klienci: taśmociąg i prasa na zapleczu, ramię wykładacza na szynie na wierzchu mebla.
//
// Wygląd rośnie z poziomem ulepszenia (nazwy z `UPGRADES`): bieżnia, napęd od pralki, przemysłowy „od szwagra”; wydruk 3D, ramię
// z wyprzedaży, ramię z czujnikiem. Kolory z PALETTE.

export type MachineLevel = 1 | 2 | 3;

export interface MachineRig {
  readonly object: Group;
  /** Jedna klatka: `dt` to czas animacji (s, 0 przy pauzie), `working` mówi, czy maszyna właśnie pracuje. */
  update(dt: number, working: boolean): void;
  dispose(): void;
}

const DARK = PALETTE.fixture.fridgeFrame;
const RUBBER = PALETTE.clothes[12]!;
const YELLOW = PALETTE.clothes[2]!;
const CARDBOARD = PALETTE.productCategory.pieczywo[1]!;
const CARDBOARD_LIGHT = PALETTE.productCategory.pieczywo[0]!;
const SCREEN = PALETTE.productCategory.nabial[2]!;

/** Czysty rekwizyt z ruchomymi częściami: wspólny szkielet wszystkich maszyn. */
function rig(name: string): { object: Group; owned: BufferGeometry[]; dispose(): void } {
  const object = new Group();
  object.name = name;
  const owned: BufferGeometry[] = [];
  return { object, owned, dispose: () => { object.removeFromParent(); for (const g of owned) g.dispose(); } };
}

/** Środek kratek (świat) i kąt ich osi: 0 dla rzędu wzdłuż x, π/2 dla wzdłuż y. */
function centreOf(layout: StoreLayout, cells: readonly Cell[]): { x: number; z: number } {
  const a = cellToWorld(layout, cells[0]!.x, cells[0]!.y);
  const b = cellToWorld(layout, cells[cells.length - 1]!.x, cells[cells.length - 1]!.y);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

/** Wyskakiwanie maszyny po zakupie: krótkie „sprężyste” powiększenie z zera (0,5 s). */
const APPEAR_S = 0.5;
const easeOutBack = (t: number): number => {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** Stan wyskakiwania i pracy wspólny dla maszyn: `appear` rośnie do 1, `drive` płynnie dąży do 0/1 razem z `working`. */
function motion(object: Group): { tick(dt: number, working: boolean): void; readonly drive: number; clock: number; phase: number } {
  let appear = 0;
  const state = {
    drive: 0, clock: 0, phase: 0,
    tick(dt: number, working: boolean) {
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      state.clock += step;
      if (appear < 1) {
        appear = Math.min(1, appear + step / APPEAR_S);
        object.scale.setScalar(Math.max(0.001, easeOutBack(appear)));
      }
      state.drive = MathUtils.clamp(state.drive + (working ? step * 4 : -step * 2.5), 0, 1);
      state.phase += step * state.drive;
    },
  };
  object.scale.setScalar(0.001);
  return state;
}

// --- Taśmociąg -------------------------------------------------------------------------------------------------------

const BELT_RIB_M = 0.1;
const BELT_SPEED = 0.32;

function beltMaterial() {
  const map = cachedTexture('conveyor-belt', () => canvasTexture(32, 32, (ctx, w, h) => {
    ctx.fillStyle = RUBBER;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = FIX.metal;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, 7, h);
  }, true));
  return { map, material: texturedMaterial('conveyor-belt', map, { roughness: 0.85 }) };
}

/**
 * Taśmociąg na `cells` (rząd kratek wzdłuż x przy tylnej ścianie zaplecza). 1: bieżnia z konsolą, 2: napęd od pralki (biała skrzynia
 * z bębnem), 3: przemysłowy, żółty, z barierkami i lampą. Gdy pracuje, taśma jedzie, a po niej jadą kartony i migocze lampa.
 */
export function createConveyor(layout: StoreLayout, cells: readonly Cell[], level: MachineLevel): MachineRig {
  const { object, owned, dispose } = rig('taśmociąg');
  const at = centreOf(layout, cells);
  object.position.set(at.x, 0, at.z);
  const L = cells.length * M - 0.04;
  const rail = [DARK, BRAND.cream, YELLOW][level - 1]!;
  const accent = [BRAND.orange, BRAND.green, DARK][level - 1]!;
  const TOP = 0.42;

  const frame = new Group();
  for (const x of L > 1.4 ? [-L / 2 + 0.05, 0, L / 2 - 0.05] : [-L / 2 + 0.05, L / 2 - 0.05]) {
    for (const z of [-0.17, 0.17]) box(frame, [0.045, 0.34, 0.045], [x, 0, z], painted(rail));
  }
  for (const z of [-0.19, 0.19]) box(frame, [L, 0.08, 0.035], [0, TOP - 0.09, z], painted(rail));
  box(frame, [L - 0.06, 0.03, 0.32], [0, 0.3, 0], matte(DARK));
  for (const x of [-L / 2 + 0.05, L / 2 - 0.05]) cyl(frame, 0.04, 0.34, [x, TOP - 0.035, 0], painted(FIX.metal), { segs: 10, rot: [Math.PI / 2, 0, 0] });
  // paczka czekająca na końcu taśmy
  box(frame, [0.17, 0.12, 0.15], [L / 2 - 0.15, TOP, 0.02], matte(CARDBOARD));
  box(frame, [0.04, 0.122, 0.152], [L / 2 - 0.15, TOP, 0.02], matte(CARDBOARD_LIGHT));
  if (level === 1) {
    // konsola z bieżni: słupek i pochylony panel z ekranem (bieżnia i tak stała nieużywana od stycznia)
    box(frame, [0.04, 0.5, 0.04], [-L / 2 + 0.07, TOP, 0], painted(FIX.metal));
    box(frame, [0.2, 0.13, 0.03], [-L / 2 + 0.07, TOP + 0.5, 0], matte(accent), { rot: [0, Math.PI / 2, -0.35] });
    box(frame, [0.012, 0.09, 0.15], [-L / 2 + 0.085, TOP + 0.51, 0], matte(SCREEN), { rot: [0, 0, -0.35], seg: 1, radius: 0.004 });
  } else if (level === 2) {
    // napęd od pralki: biała skrzynia pod końcem taśmy z bębnem w okienku
    box(frame, [0.22, 0.3, 0.3], [-L / 2 + 0.13, 0, 0], matte(BRAND.cream));
    cyl(frame, 0.085, 0.02, [-L / 2 + 0.13, 0.17, -0.155], matte(DARK), { segs: 14, rot: [Math.PI / 2, 0, 0] });
    cyl(frame, 0.055, 0.024, [-L / 2 + 0.13, 0.17, -0.158], matte(SCREEN), { segs: 12, rot: [Math.PI / 2, 0, 0] });
    box(frame, [0.2, 0.025, 0.02], [-L / 2 + 0.13, 0.26, -0.155], matte(accent));
  } else {
    // przemysłowy „od szwagra”: wzmocniona rama w pasy i barierki po bokach
    for (const x of [-L / 2 + 0.05, L / 2 - 0.05]) for (const z of [-0.19, 0.19]) box(frame, [0.035, 0.3, 0.035], [x, TOP, z], painted(DARK));
    for (const z of [-0.19, 0.19]) box(frame, [L, 0.03, 0.03], [0, TOP + 0.28, z], painted(DARK));
    for (let i = 0; i < Math.floor(L / 0.16); i++) box(frame, [0.07, 0.081, 0.037], [-L / 2 + 0.1 + i * 0.16, TOP - 0.09, -0.19], matte(DARK));
    box(frame, [0.25, 0.28, 0.3], [-L / 2 + 0.15, 0, 0], painted(DARK));
    box(frame, [0.2, 0.05, 0.02], [-L / 2 + 0.15, 0.2, -0.155], matte(YELLOW));
  }
  object.add(bake(frame, owned, 'taśmociąg rama'));

  const belt = beltMaterial();
  const ribs = (L - 0.1) / BELT_RIB_M;
  plane(object, [L - 0.1, 0.32], [0, TOP - 0.01, 0], belt.material, { uv: [ribs, 1], rot: [-Math.PI / 2, 0, 0], receive: true });

  // kartony jadące po taśmie (widać je tylko w pracy)
  const loads: Mesh[] = [0, 1].map((i) => {
    const m = box(object, [0.15, 0.11, 0.13], [0, TOP - 0.01, 0.01], matte(i === 0 ? CARDBOARD : CARDBOARD_LIGHT), { cast: false });
    m.visible = false;
    return m;
  });

  let beacon: Mesh | null = null;
  if (level === 3) {
    box(object, [0.03, 0.4, 0.03], [L / 2 - 0.06, TOP, 0.19], painted(DARK));
    beacon = cyl(object, 0.032, 0.07, [L / 2 - 0.06, TOP + 0.44, 0.19], glow(BRAND.orange, 1.8), { segs: 10, cast: false });
    beacon.visible = false;
  }

  const m = motion(object);
  return {
    object,
    update(dt, working) {
      m.tick(dt, working);
      belt.map.offset.x = (belt.map.offset.x - (Number.isFinite(dt) && dt > 0 ? dt : 0) * BELT_SPEED / BELT_RIB_M * m.drive) % 1;
      const run = m.drive > 0.02;
      const span = L - 0.1;
      loads.forEach((load, i) => {
        load.visible = run;
        const t = (m.phase * BELT_SPEED / span + i * 0.5) % 1;
        load.position.x = -span / 2 + 0.08 + t * (span - 0.16);
      });
      if (beacon) beacon.visible = run && Math.sin(m.clock * 9) > 0;
    },
    dispose,
  };
}

// --- Prasa do kartonów -----------------------------------------------------------------------------------------------

/**
 * Prasa do kartonów z imadła po dziadku: warsztatowy stół z zielonym imadłem, w którym zgniata się karton, i stosem już sprasowanych
 * paczek obok. Gdy pracuje, ruchoma szczęka dociska, a pokrętło kręci się.
 */
export function createPress(layout: StoreLayout, cells: readonly Cell[]): MachineRig {
  const { object, owned, dispose } = rig('prasa');
  const at = centreOf(layout, cells);
  object.position.set(at.x, 0, at.z);

  const frame = new Group();
  for (const x of [-0.43, 0.43]) for (const z of [-0.17, 0.17]) box(frame, [0.05, 0.5, 0.05], [x, 0, z], matte(FIX.wood));
  box(frame, [0.96, 0.05, 0.4], [0, 0.5, 0], matte(FIX.wood));
  box(frame, [0.88, 0.03, 0.34], [0, 0.14, 0], matte(FIX.wood));
  // imadło: nieruchoma szczęka na wspornikach i zgniatany karton
  box(frame, [0.22, 0.1, 0.26], [-0.3, 0.55, 0], painted(BRAND.green));
  box(frame, [0.07, 0.22, 0.26], [-0.4, 0.65, 0], painted(BRAND.green));
  box(frame, [0.09, 0.16, 0.18], [-0.31, 0.65, 0], matte(CARDBOARD));
  // sprasowane paczki obok, z wiązaniem
  for (let i = 0; i < 3; i++) box(frame, [0.34, 0.06, 0.26], [0.2, 0.55 + i * 0.06, 0.01 * (i - 1)], matte(i === 1 ? CARDBOARD_LIGHT : CARDBOARD));
  box(frame, [0.025, 0.19, 0.27], [0.2, 0.55, 0], matte(DARK));
  object.add(bake(frame, owned, 'prasa rama'));

  // ruchoma szczęka ze śrubą i pokrętłem (T), osobna siatka na ruch wzdłuż x
  const jaw = new Group();
  const jawParts = new Group();
  box(jawParts, [0.07, 0.2, 0.24], [0, 0, 0], painted(BRAND.green));
  cyl(jawParts, 0.017, 0.24, [0.12, 0.1, 0], painted(FIX.metal), { segs: 8, rot: [0, 0, Math.PI / 2] });
  jaw.add(bake(jawParts, owned, 'prasa szczęka', false));
  jaw.position.set(-0.22, 0.55, 0);
  const handle = new Group();
  const handleParts = new Group();
  box(handleParts, [0.02, 0.02, 0.2], [0, -0.01, 0], painted(FIX.metal));
  for (const z of [-0.1, 0.1]) cyl(handleParts, 0.018, 0.026, [0, 0, z], matte(BRAND.orange), { segs: 8, rot: [Math.PI / 2, 0, 0] });
  handle.add(bake(handleParts, owned, 'prasa pokrętło', false));
  handle.position.set(0.24, 0.1, 0);
  jaw.add(handle);
  object.add(jaw);

  const m = motion(object);
  return {
    object,
    update(dt, working) {
      m.tick(dt, working);
      // docisk: szczęka podjeżdża o ~4 cm i wraca, pokrętło kręci się w tym samym tempie
      const squeeze = m.drive * (0.5 - 0.5 * Math.cos(m.phase * 4.2));
      jaw.position.x = -0.22 - 0.04 * squeeze;
      handle.rotation.x = m.phase * 4.2;
    },
    dispose,
  };
}

// --- Ramię wykładacza ------------------------------------------------------------------------------------------------

/** Wysokość wierzchu mebla, na którym stoi szyna (gondola z nadstawką 1,58 m, regał ścienny 2,0 m). */
const FIXTURE_TOP: Partial<Record<Fixture['kind'], number>> = { gondola: 1.6, wallShelf: 2.0 };

/**
 * Ramię wykładacza na szynie na wierzchu mebla (`fixture`; stoi tam, gdzie klient go nie dotknie). 1: wydruk 3D, pomarańczowe i
 * grube, 2: ramię z wyprzedaży, żółte, 3: ramię z czujnikiem pustej półki (kremowe, zielone oko). Gdy pracuje, wózek jeździ po
 * szynie, a ramię przerzuca się nad półki; bez pracy stoi zaparkowane na końcu szyny ze złożonym ramieniem.
 */
export function createRestocker(layout: StoreLayout, fixture: Fixture, level: MachineLevel): MachineRig {
  const { object, owned, dispose } = rig('wykładacz');
  const cells = [{ x: fixture.x, y: fixture.y }, { x: fixture.x + fixture.w - 1, y: fixture.y + fixture.d - 1 }];
  const at = centreOf(layout, cells);
  const top = FIXTURE_TOP[fixture.kind] ?? 1.6;
  const along = fixture.d > fixture.w ? 'z' : 'x';
  const long = Math.max(fixture.w, fixture.d) * M;
  object.position.set(at.x, top, at.z);
  object.rotation.y = along === 'z' ? Math.PI / 2 : 0;
  const Lr = long - 0.2;

  // ramię jest przerysowane (grube i długie): przy domyślnym zbliżeniu cała maszyna ma ok. 20 px, a ma być widać, co robi
  const body = [BRAND.orange, YELLOW, BRAND.cream][level - 1]!;
  const joint = [DARK, DARK, BRAND.green][level - 1]!;
  const thick = [0.11, 0.095, 0.085][level - 1]!;
  const upper = 0.62;
  const fore = 0.68;

  const railParts = new Group();
  for (const z of [-0.09, 0.09]) box(railParts, [Lr, 0.025, 0.025], [0, 0.02, z], painted(FIX.metal));
  for (const x of [-Lr / 2, 0, Lr / 2]) box(railParts, [0.04, 0.04, 0.26], [x, 0, 0], matte(joint));
  for (const x of [-Lr / 2 - 0.02, Lr / 2 + 0.02]) box(railParts, [0.04, 0.09, 0.22], [x, 0, 0], matte(body));
  object.add(bake(railParts, owned, 'wykładacz szyna'));

  // wózek na szynie z barkiem; pozycja wzdłuż szyny to x wózka
  const carriage = new Group();
  carriage.position.y = 0.045;
  const carriageParts = new Group();
  box(carriageParts, [0.3, 0.07, 0.26], [0, 0, 0], painted(joint));
  cyl(carriageParts, 0.08, 0.12, [0, 0.13, 0], matte(body), { segs: 12 });
  carriage.add(bake(carriageParts, owned, 'wykładacz wózek', false));
  const shoulder = new Group();
  shoulder.position.y = 0.2;
  const upperParts = new Group();
  box(upperParts, [thick, upper, thick], [0, 0, 0], matte(body));
  cyl(upperParts, thick * 0.8, thick * 1.5, [0, 0, 0], painted(joint), { segs: 10, rot: [0, 0, Math.PI / 2] });
  shoulder.add(bake(upperParts, owned, 'wykładacz ramię', false));
  const elbow = new Group();
  elbow.position.y = upper;
  const foreParts = new Group();
  box(foreParts, [thick * 0.9, fore, thick * 0.9], [0, 0, 0], matte(body));
  cyl(foreParts, thick * 0.75, thick * 1.4, [0, 0, 0], painted(joint), { segs: 10, rot: [0, 0, Math.PI / 2] });
  // chwytak z dwoma szczękami i skrzynką z towarem
  for (const z of [-0.07, 0.07]) box(foreParts, [0.04, 0.16, 0.03], [0, fore - 0.02, z], painted(joint));
  box(foreParts, [0.13, 0.09, 0.16], [0, fore + 0.14, 0], matte(CARDBOARD));
  elbow.add(bake(foreParts, owned, 'wykładacz przedramię', false));
  if (level === 3) {
    // oko czujnika pustej półki na przedramieniu: świeci na zielono
    const eye = cyl(elbow, 0.035, 0.03, [0, fore * 0.45, thick * 0.55], glow(BRAND.green, 1.6), { segs: 10, rot: [Math.PI / 2, 0, 0], cast: false });
    eye.name = 'czujnik';
  }
  shoulder.add(elbow);
  carriage.add(shoulder);
  object.add(carriage);

  const m = motion(object);
  const parkX = -Lr / 2 + 0.14;
  carriage.position.x = parkX;
  let x = parkX;
  return {
    object,
    update(dt, working) {
      m.tick(dt, working);
      // wózek dojeżdża do miejsca pracy albo parkuje; ramię przerzuca się nad półkę po jednej i po drugiej stronie mebla
      const reach = Math.max(0, Lr / 2 - 0.2);
      const target = m.drive > 0.02 ? Math.sin(m.phase * 0.55) * reach : parkX;
      x += (target - x) * Math.min(1, dt * 6);
      carriage.position.x = x;
      const swing = m.drive * 1.45 * Math.sin(m.phase * 1.7);
      shoulder.rotation.x = swing;
      // przedramię wisi pionowo w dół przy pracy, a w postoju jest złożone wzdłuż górnego ramienia (czubek wraca do barku)
      elbow.rotation.x = Math.PI - swing;
    },
    dispose,
  };
}
