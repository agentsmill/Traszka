import { Scene, Vector3, type Mesh } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraRig, VIEW_SIZE_DEFAULT, VIEW_SIZE_MAX } from '@/render/cameraRig';
import { CITY_BOUNDS, cityFitViewSize } from '@/render/city/buildCity';
import type { QualityPresetId } from '@/render/quality';
import type { RenderContext } from '@/render/renderer';
import { generateCity } from '@/sim/city/generateCity';
import type { LotState } from '@/sim/city/types';
import { createSceneHost, type SceneHost } from './scene';

/*
 * Ekran Miasta w scenie gry: `showCity` / `hideCity` na atrapie kontekstu renderera (prawdziwa kamera i scena three.js, bez WebGL).
 * Reszta `createSceneHost` (tłum, sklep w ruchu) zostaje dla przeglądarki; tu tylko to, co miasto robi ze sklepem i z kamerą.
 */

/** Bez sieci: ulica dostaje same grupy rekwizytów (ruling R5), a prawdziwy loader nie trzyma w Node niedokończonych żądań. */
vi.mock('@/render/assets', async (original) => ({
  ...(await original<typeof import('@/render/assets')>()),
  loadGLB: () => Promise.reject(new Error('brak sieci')),
}));

const CITY = generateCity('kiełbasa-42');
const STATES: Record<number, LotState> = Object.fromEntries(CITY.lots.map((l) => [l.id, l.state]));

function fakeContext(preset: QualityPresetId, aspect = 1.6): RenderContext {
  let current = preset;
  return {
    renderer: {} as RenderContext['renderer'],
    scene: new Scene(),
    rig: new CameraRig(aspect),
    get preset() { return current; },
    setPreset(id: QualityPresetId) { current = id; },
    setTimeOfDay: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  } as RenderContext;
}

function hostOn(preset: QualityPresetId, aspect = 1.6): { host: SceneHost; ctx: RenderContext } {
  const ctx = fakeContext(preset, aspect);
  const host = createSceneHost({ ctx, cashierLook: { kind: 'default' } as never, forcedNight: false, exterior: false, zoomPinned: false, overlay: null });
  return { host, ctx };
}

/** Sklep w scenie z ulicą (budowa ulicy jest asynchroniczna, GLB bez sieci kończy się atrapą rekwizytów). */
async function withStore(host: SceneHost, seed = 'traszka-1'): Promise<void> {
  host.load(seed, null);
  await vi.waitFor(() => expect(host.loaded?.street).toBeTruthy(), { timeout: 4000, interval: 10 });
}

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1280, innerHeight: 800 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('showCity / hideCity', () => {
  it('pokazuje miasto zamiast sklepu: sklep, ulica i tłum ukryte, kamera na całym mieście', async () => {
    const { host, ctx } = hostOn('srednia');
    await withStore(host);
    const loaded = host.loaded!;
    expect(host.cityShown).toBe(false);
    expect(host.cityView).toBeNull();

    host.showCity(CITY, STATES, 'ruch');

    expect(host.cityShown).toBe(true);
    expect(host.cityView).not.toBeNull();
    expect(host.cityView!.root.parent).toBe(ctx.scene);
    expect(host.cityView!.root.visible).toBe(true);
    expect(loaded.view.root.visible).toBe(false);
    expect(loaded.street!.root.visible).toBe(false);
    expect(host.crowdRoot.visible).toBe(false);
    expect(ctx.rig.viewSize).toBeCloseTo(cityFitViewSize(1280, 800, 800), 6);   // bez prostokąta całe okno
    expect(ctx.rig.bounds).toEqual(CITY_BOUNDS);
    expect(ctx.rig.target.x).toBeCloseTo(0, 10);
    expect(ctx.rig.target.z).toBeCloseTo(0, 10);
  });

  it('hideCity oddaje sklep, ulicę, tłum i kadr kamery: granice, zoom i cel jak przed pokazaniem miasta', async () => {
    const { host, ctx } = hostOn('srednia');
    await withStore(host);
    ctx.rig.zoomBy(1.2);
    ctx.rig.panBy(0.5, -0.4);
    const before = { bounds: { ...ctx.rig.bounds! }, viewSize: ctx.rig.viewSize, x: ctx.rig.target.x, z: ctx.rig.target.z };
    expect(before.viewSize).not.toBe(VIEW_SIZE_DEFAULT);

    host.showCity(CITY, STATES, 'dzielnice');
    host.hideCity();

    expect(host.cityShown).toBe(false);
    expect(host.cityView).toBeNull();
    expect(host.loaded!.view.root.visible).toBe(true);
    expect(host.loaded!.street!.root.visible).toBe(true);
    expect(host.crowdRoot.visible).toBe(true);
    expect(ctx.rig.bounds).toEqual(before.bounds);
    expect(ctx.rig.viewSize).toBeCloseTo(before.viewSize, 6);
    expect(ctx.rig.target.x).toBeCloseTo(before.x, 6);
    expect(ctx.rig.target.z).toBeCloseTo(before.z, 6);
  });

  it('drugie showCity (zmiana warstwy albo stanów) niczego nie buduje od nowa i nie nadpisuje kadru sklepu', async () => {
    const { host, ctx } = hostOn('srednia');
    await withStore(host);
    const before = { viewSize: ctx.rig.viewSize, bounds: { ...ctx.rig.bounds! } };
    host.showCity(CITY, STATES, 'ruch');
    const view = host.cityView!;
    ctx.rig.panBy(3, 3);   // gracz przesuwa mapę
    host.showCity(CITY, { ...STATES, [CITY.startLotId]: 'zajety' }, 'dzielnice');
    expect(host.cityView).toBe(view);
    expect(view.pinAnchors().map((a) => a.lotId)).not.toContain(CITY.startLotId);
    host.hideCity();
    expect(ctx.rig.viewSize).toBeCloseTo(before.viewSize, 6);
    expect(ctx.rig.bounds).toEqual(before.bounds);
  });

  it('poza presetem „niska” scena miasta zostaje na następne wejście (ukryta), a „niska” zwalnia ją po wyjściu', async () => {
    for (const preset of ['srednia', 'wysoka', 'niska'] as const) {
      const { host, ctx } = hostOn(preset);
      await withStore(host);
      host.showCity(CITY, STATES, 'ruch');
      const root = host.cityView!.root;
      let disposed = false;
      (root.getObjectByName('streets') as Mesh).geometry.addEventListener('dispose', () => { disposed = true; });
      host.hideCity();
      if (preset === 'niska') {
        expect(disposed, preset).toBe(true);
        expect(root.parent, preset).toBeNull();
        host.showCity(CITY, STATES, 'ruch');
        expect(host.cityView!.root, preset).not.toBe(root);   // nowa scena
      } else {
        expect(disposed, preset).toBe(false);
        expect(root.parent, preset).toBe(ctx.scene);
        expect(root.visible, preset).toBe(false);
        host.showCity(CITY, STATES, 'ruch');
        expect(host.cityView!.root, preset).toBe(root);       // ta sama scena, znów widoczna
        expect(root.visible, preset).toBe(true);
      }
    }
  });

  it('inne miasto (inny seed) wymienia scenę miasta i zwalnia starą', async () => {
    const { host } = hostOn('srednia');
    await withStore(host);
    host.showCity(CITY, STATES, 'ruch');
    const first = host.cityView!.root;
    const other = generateCity('traszka-2');
    host.showCity(other, Object.fromEntries(other.lots.map((l) => [l.id, l.state])), 'ruch');
    expect(host.cityView!.root).not.toBe(first);
    expect(first.parent).toBeNull();
  });

  it('pod miastem sklep nie odpowiada na stuknięcie (promień nie sprawdza visible)', async () => {
    const { host } = hostOn('srednia');
    await withStore(host);
    host.showCity(CITY, STATES, 'ruch');
    for (const [x, y] of [[640, 400], [100, 100], [900, 500]] as const) expect(host.pick(x, y)).toBeNull();
  });

  it('sklep wczytany pod miastem (przełączenie sklepu z mapy) zostaje ukryty, kamera zostaje na mieście, a po powrocie ma kadr sklepu z dawnym zoomem', async () => {
    const { host, ctx } = hostOn('srednia');
    await withStore(host);
    ctx.rig.zoomBy(1.3);
    const zoom = ctx.rig.viewSize;
    host.showCity(CITY, STATES, 'ruch');

    await withStore(host, 'traszka-2');

    expect(host.cityShown).toBe(true);
    expect(host.loaded!.view.root.visible).toBe(false);
    expect(host.loaded!.street!.root.visible).toBe(false);
    expect(ctx.rig.viewSize).toBeCloseTo(cityFitViewSize(1280, 800, 800), 6);
    expect(ctx.rig.bounds).toEqual(CITY_BOUNDS);

    host.hideCity();
    expect(host.loaded!.view.root.visible).toBe(true);
    expect(host.loaded!.street!.root.visible).toBe(true);
    expect(ctx.rig.viewSize).toBeCloseTo(zoom, 6);
    const b = ctx.rig.bounds!;
    expect(b.maxX).toBeLessThan(CITY_BOUNDS.maxX);   // granice nowego sklepu, nie miasta
  });

  it('showCity przed wczytaniem jakiegokolwiek sklepu: po hideCity granice kamery znikają (nie zostają granice miasta)', () => {
    const { host, ctx } = hostOn('srednia');
    expect(ctx.rig.bounds).toBeNull();
    host.showCity(CITY, STATES, 'ruch');
    expect(ctx.rig.bounds).toEqual(CITY_BOUNDS);
    host.hideCity();
    expect(host.cityShown).toBe(false);
    expect(ctx.rig.bounds).toBeNull();
    ctx.rig.panBy(500, 500);   // bez granic pan nie jest ucinany do miasta
    expect(ctx.rig.target.x).toBeCloseTo(500, 6);
  });

  describe('kadr kamery miasta', () => {
    /**
     * Narożniki miasta (z najwyższym budynkiem) w pikselach okna `w` × `h` przy kamerze `rig`. `allYaws`: każdy obrót kamery (tylko gdy cel
     * stoi w środku miasta; po przesunięciu kadru obrót wokół celu przestawia miasto, więc liczy się obecny obrót).
     */
    function cornersPx(rig: CameraRig, w: number, h: number, allYaws = false): { x: number; y: number }[] {
      const out: { x: number; y: number }[] = [];
      const yaws = allYaws ? ([0, 1, 2, 3] as const) : ([rig.yawIndex] as const);
      const before = rig.yawIndex;
      for (const yaw of yaws) {
        rig.yawIndex = yaw;
        for (const x of [CITY_BOUNDS.minX, CITY_BOUNDS.maxX]) {
          for (const z of [CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ]) {
            for (const y of [0, 0.6]) {
              const p = new Vector3(x, y, z).project(rig.camera);
              out.push({ x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h });
            }
          }
        }
      }
      rig.yawIndex = before;
      return out;
    }

    it('telefon w pionie (390×844): całe miasto widać na starcie, więc limit zoomu rośnie ponad VIEW_SIZE_MAX, a hideCity go przywraca', async () => {
      vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
      const { host, ctx } = hostOn('niska', 390 / 844);
      await withStore(host);
      ctx.rig.zoomBy(1.2);
      const zoom = ctx.rig.viewSize;
      host.showCity(CITY, STATES, 'ruch');
      expect(ctx.rig.viewSize).toBeGreaterThan(VIEW_SIZE_MAX);
      expect(ctx.rig.viewMax).toBeGreaterThanOrEqual(ctx.rig.viewSize);
      for (const p of cornersPx(ctx.rig, 390, 844, true)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(390);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(844);
      }
      host.hideCity();
      expect(ctx.rig.viewMax).toBe(VIEW_SIZE_MAX);
      expect(ctx.rig.viewSize).toBeCloseTo(zoom, 6);
      ctx.rig.zoomBy(0.0001);
      expect(ctx.rig.viewSize).toBe(VIEW_SIZE_MAX);   // zwykły sklep znów nie oddali się dalej
    });

    it('prostokąt widoczny spod interfejsu: miasto mieści się w nim i stoi w jego środku (telefon: nad arkuszem, komputer: obok kolumny)', () => {
      const cases: { w: number; h: number; area: { left: number; top: number; right: number; bottom: number } }[] = [
        { w: 390, h: 844, area: { left: 0, top: 112, right: 390, bottom: 430 } },
        { w: 1280, h: 800, area: { left: 0, top: 52, right: 866, bottom: 740 } },
      ];
      for (const { w, h, area } of cases) {
        vi.stubGlobal('window', { innerWidth: w, innerHeight: h });
        const { host, ctx } = hostOn('srednia', w / h);
        host.showCity(CITY, STATES, 'ruch', area);
        const px = cornersPx(ctx.rig, w, h);
        const xs = px.map((p) => p.x);
        const ys = px.map((p) => p.y);
        const eps = 2;
        expect(Math.min(...xs), `${w}×${h}`).toBeGreaterThanOrEqual(area.left - eps);
        expect(Math.max(...xs), `${w}×${h}`).toBeLessThanOrEqual(area.right + eps);
        expect(Math.min(...ys), `${w}×${h}`).toBeGreaterThanOrEqual(area.top - eps);
        expect(Math.max(...ys), `${w}×${h}`).toBeLessThanOrEqual(area.bottom + eps);
        // środek miasta (podłoga) stoi w środku prostokąta, o ile kamera mogła się tam przesunąć w granicach miasta
        const c = new Vector3(0, 0, 0).project(ctx.rig.camera);
        const cx = (c.x * 0.5 + 0.5) * w;
        const cy = (-c.y * 0.5 + 0.5) * h;
        expect(Math.abs(cx - (area.left + area.right) / 2), `${w}×${h} x`).toBeLessThan(w * 0.06);
        expect(Math.abs(cy - (area.top + area.bottom) / 2), `${w}×${h} y`).toBeLessThan(h * 0.06);
      }
    });

    it('przełączenie sklepu pod miastem zostawia ten sam kadr miasta (prostokąt pamiętany do hideCity)', async () => {
      vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
      const { host, ctx } = hostOn('srednia', 390 / 844);
      await withStore(host);
      const area = { left: 0, top: 112, right: 390, bottom: 430 };
      host.showCity(CITY, STATES, 'ruch', area);
      const size = ctx.rig.viewSize;
      const x = ctx.rig.target.x;
      const z = ctx.rig.target.z;
      await withStore(host, 'traszka-2');
      expect(ctx.rig.viewSize).toBeCloseTo(size, 6);
      expect(ctx.rig.target.x).toBeCloseTo(x, 6);
      expect(ctx.rig.target.z).toBeCloseTo(z, 6);
    });
  });

  describe('pickCityLot', () => {
    it('poza ekranem Miasta zawsze null; na mapie zwraca lokal pod punktem ekranu, a puste miejsce null', async () => {
      const { host, ctx } = hostOn('srednia');
      await withStore(host);
      expect(host.pickCityLot(640, 400)).toBeNull();
      host.showCity(CITY, STATES, 'ruch');
      ctx.rig.camera.updateMatrixWorld();
      const anchors = host.cityView!.pinAnchors();
      expect(anchors.length).toBeGreaterThan(5);
      const picked = anchors.map((a) => {
        const p = a.world.clone().project(ctx.rig.camera);
        return host.pickCityLot((p.x * 0.5 + 0.5) * 1280, (-p.y * 0.5 + 0.5) * 800);
      });
      // promień przez kotwicę trafia w budynek (sąsiad bliżej kamery może go przesłonić, ale zawsze coś stoi na drodze)
      expect(picked.every((id) => id !== null)).toBe(true);
      expect(picked.filter((id, i) => id === anchors[i]!.lotId).length).toBeGreaterThan(anchors.length / 2);
      expect(host.pickCityLot(2, 2)).toBeNull();   // róg okna leży poza rombem miasta
      host.hideCity();
      expect(host.pickCityLot(640, 400)).toBeNull();
    });
  });

  it('hideCity bez showCity nic nie robi', async () => {
    const { host, ctx } = hostOn('srednia');
    await withStore(host);
    const before = ctx.rig.viewSize;
    expect(() => host.hideCity()).not.toThrow();
    expect(ctx.rig.viewSize).toBe(before);
    expect(host.loaded!.view.root.visible).toBe(true);
  });
});
