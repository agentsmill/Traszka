import { Scene, Vector3, type BufferGeometry, type InstancedMesh, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraRig, VIEW_SIZE_DEFAULT, VIEW_SIZE_MAX } from '@/render/cameraRig';
import { CITY_BOUNDS, cityFitViewSize, type CityView } from '@/render/city/buildCity';
import { CITY_PROFILES } from '@/render/city/cityQuality';
import type { QualityPresetId } from '@/render/quality';
import type { RenderContext } from '@/render/renderer';
import { generateCity } from '@/sim/city/generateCity';
import type { LotState } from '@/sim/city/types';
import { cityClockOf, createSceneHost, type SceneHost } from './scene';

/*
 * Ekran Miasta w scenie gry: `showCity` / `hideCity` na atrapie kontekstu renderera (prawdziwa kamera i scena three.js, bez WebGL).
 * Reszta `createSceneHost` (tłum, sklep w ruchu) zostaje dla przeglądarki; tu tylko to, co miasto robi ze sklepem i z kamerą.
 */

/** Bez sieci: ulica dostaje same grupy rekwizytów (ruling R5), a prawdziwy loader nie trzyma w Node niedokończonych żądań. */
vi.mock('@/render/assets', async (original) => ({
  ...(await original<typeof import('@/render/assets')>()),
  loadGLB: () => Promise.reject(new Error('brak sieci')),
}));

/** Licznik budów sceny miasta: szczegółowość każdego wywołania `buildCity` (scena nie może budować pełnej geometrii częściej, niż trzeba). */
const builds = vi.hoisted(() => ({ details: [] as string[] }));
vi.mock('@/render/city/buildCity', async (original) => {
  const mod = await original<typeof import('@/render/city/buildCity')>();
  return {
    ...mod,
    buildCity: (...args: Parameters<typeof mod.buildCity>) => {
      builds.details.push(args[2]?.detail ?? 'prosty');
      return mod.buildCity(...args);
    },
  };
});

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
    setStaticShadows: vi.fn(),
    refreshShadows: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  } as RenderContext;
}

/** `isMobile` jawnie (domyślnie komputer): profil miasta nie zależy od tego, pod jakim Node'em biegną testy. */
function hostOn(preset: QualityPresetId, aspect = 1.6, isMobile = false): { host: SceneHost; ctx: RenderContext } {
  const ctx = fakeContext(preset, aspect);
  const host = createSceneHost({ ctx, cashierLook: { kind: 'default' } as never, forcedNight: false, exterior: false, zoomPinned: false, overlay: null, isMobile });
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

  describe('makieta: jedna geometria dla trybów', () => {
    const meshesOf = (root: Object3D): Mesh[] => {
      const out: Mesh[] = [];
      root.traverse((o) => { if ((o as Mesh).isMesh) out.push(o as Mesh); });
      return out;
    };

    it('przejście ruch → makieta → ruch (niska: pierwsza geometria prosty) buduje pelny raz, a liczniki zwolnionych geometrii i materiałów zgadzają się z siatkami prosty', async () => {
      const { host, ctx } = hostOn('niska');
      await withStore(host);
      builds.details.length = 0;

      host.showCity(CITY, STATES, 'ruch');
      expect(builds.details).toEqual(['prosty']);
      const simple = host.cityView!;
      expect(simple.detail).toBe('prosty');
      const simpleMeshes = meshesOf(simple.root);
      let disposed = 0;
      let disposedMaterials = 0;
      for (const g of new Set(simpleMeshes.map((m) => m.geometry))) g.addEventListener('dispose', () => { disposed++; });
      const simpleMaterials = new Set(simpleMeshes.map((m) => m.material as Material));
      for (const m of simpleMaterials) m.addEventListener('dispose', () => { disposedMaterials++; });

      host.showCity(CITY, STATES, 'makieta');
      expect(builds.details).toEqual(['prosty', 'pelny']);
      const full = host.cityView!;
      expect(full.detail).toBe('pelny');
      expect(full.root.parent).toBe(ctx.scene);
      expect(simple.root.parent).toBeNull();
      expect(disposed).toBe(simpleMeshes.length);
      expect(disposedMaterials).toBe(simpleMaterials.size);   // także materiały starego widoku, nie tylko geometrie

      host.showCity(CITY, STATES, 'ruch');
      expect(builds.details).toEqual(['prosty', 'pelny']);   // warstwy zostają na pełnej geometrii, spłaszczonej
      expect(host.cityView).toBe(full);
      expect(disposed).toBe(simpleMeshes.length);
      expect(disposedMaterials).toBe(simpleMaterials.size);
      const chunks = meshesOf(full.root).filter((m) => m.name.startsWith('chunk:'));
      expect(chunks.length).toBeGreaterThan(0);
      for (const m of chunks) expect(m.scale.y, m.name).toBeLessThan(1);
    });

    it('pierwsza geometria wg profilu: Średnia buduje od razu pelny (także dla warstw), Niska i telefon prosty dla warstw, a makieta zawsze od razu pelny', () => {
      const first = (preset: QualityPresetId, layer: Parameters<SceneHost['showCity']>[2], isMobile = false): string[] => {
        builds.details.length = 0;
        const { host } = hostOn(preset, 1.6, isMobile);
        host.showCity(CITY, STATES, layer);
        host.hideCity();
        return [...builds.details];
      };
      expect(first('srednia', 'makieta')).toEqual(['pelny']);
      expect(first('srednia', 'dzielnice')).toEqual(['pelny']);
      expect(first('wysoka', 'ruch')).toEqual(['pelny']);
      expect(first('niska', 'dzielnice')).toEqual(['prosty']);
      expect(first('niska', 'makieta')).toEqual(['pelny']);           // bez prostego po drodze
      expect(first('wysoka', 'ruch', true)).toEqual(['prosty']);      // telefon wygrywa z presetem
      expect(first('wysoka', 'makieta', true)).toEqual(['pelny']);
    });

    it('kadr makiety obejmuje wieże: zoom z najwyższego punktu sceny, większy niż kadr warstw; przejście z warstwy do makiety podnosi limit zoomu', () => {
      const layersHost = hostOn('srednia');
      layersHost.host.showCity(CITY, STATES, 'ruch');
      const layersSize = layersHost.ctx.rig.viewSize;
      expect(layersSize).toBeCloseTo(cityFitViewSize(1280, 800, 800), 6);

      const { host, ctx } = hostOn('srednia');
      host.showCity(CITY, STATES, 'makieta');
      const roof = host.cityView!.fitHeight();
      expect(roof).toBeGreaterThan(1);
      expect(ctx.rig.viewSize).toBeCloseTo(cityFitViewSize(1280, 800, 800, roof), 6);
      expect(ctx.rig.viewSize).toBeGreaterThan(layersSize);
      for (const yaw of [0, 1, 2, 3] as const) {
        ctx.rig.yawIndex = yaw;
        for (const x of [CITY_BOUNDS.minX, CITY_BOUNDS.maxX]) {
          for (const z of [CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ]) {
            const p = new Vector3(x, roof, z).project(ctx.rig.camera);
            expect(Math.abs(p.x), `yaw ${yaw}`).toBeLessThanOrEqual(1);
            expect(Math.abs(p.y), `yaw ${yaw}`).toBeLessThanOrEqual(1);
          }
        }
      }

      // telefon w pionie: gracz w „Ruchu” przełącza na makietę; kadr staje na całej makiecie z wieżami (raz), a limit zoomu jej starcza
      vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
      const phone = hostOn('srednia', 390 / 844);
      phone.host.showCity(CITY, STATES, 'ruch');
      phone.ctx.rig.panBy(5, 3);   // gracz przesunął kadr po warstwie
      phone.host.showCity(CITY, STATES, 'makieta');
      const need = cityFitViewSize(390, 844, 844, phone.host.cityView!.fitHeight());
      expect(phone.ctx.rig.viewMax).toBeGreaterThanOrEqual(need - 1e-9);
      expect(phone.ctx.rig.viewSize).toBeCloseTo(need, 6);
      expect(phone.ctx.rig.target.x).toBeCloseTo(0, 6);   // makieta stoi znów w środku okna
      expect(phone.ctx.rig.target.z).toBeCloseTo(0, 6);
      phone.host.showCity(CITY, STATES, 'ruch');
      expect(phone.ctx.rig.viewMax).toBeGreaterThanOrEqual(need - 1e-9);   // limit nie maleje pod nogami gracza
    });

    it('wejście w makietę przy pokazanym mieście kadruje całe miasto raz; ruch ↔ dzielnice i wyjście z makiety zostawiają kadr gracza', () => {
      const { host, ctx } = hostOn('srednia');
      host.showCity(CITY, STATES, 'ruch');
      const moved = (): { x: number; z: number; size: number } => ({ x: ctx.rig.target.x, z: ctx.rig.target.z, size: ctx.rig.viewSize });
      // gracz przybliża (zoomBy dzieli rozmiar widoku przez współczynnik) i przesuwa kadr
      ctx.rig.zoomBy(2);
      ctx.rig.panBy(6, -4);
      const own = moved();
      expect(own.size).toBeLessThan(cityFitViewSize(1280, 800, 800));
      expect(Math.hypot(own.x, own.z)).toBeGreaterThan(1);

      host.showCity(CITY, STATES, 'dzielnice');   // warstwa ↔ warstwa: kadr zostaje
      expect(moved()).toEqual(own);

      host.showCity(CITY, STATES, 'makieta');     // do makiety: kadr na całe miasto z wieżami
      const fit = cityFitViewSize(1280, 800, 800, host.cityView!.fitHeight());
      expect(ctx.rig.viewSize).toBeCloseTo(fit, 6);
      expect(ctx.rig.target.x).toBeCloseTo(0, 6);
      expect(ctx.rig.target.z).toBeCloseTo(0, 6);

      ctx.rig.zoomBy(1.5);                         // gracz znów kadruje po swojemu
      ctx.rig.panBy(3, 2);
      const again = moved();
      host.showCity(CITY, STATES, 'makieta');      // to samo wywołanie (zmiana stanów lokali, presetu): bez ponownego kadru
      expect(moved()).toEqual(again);
      host.showCity(CITY, STATES, 'ruch');         // z makiety do warstwy: kadr zostaje
      expect(moved()).toEqual(again);
      host.showCity(CITY, STATES, 'makieta');      // i znów do makiety: kadr na całość
      expect(ctx.rig.viewSize).toBeCloseTo(fit, 6);
    });

    it('pickCityLot w makiecie: promień przez kotwicę trafia w budynek', () => {
      const { host, ctx } = hostOn('srednia');
      host.showCity(CITY, STATES, 'makieta');
      ctx.rig.camera.updateMatrixWorld();
      const anchors = host.cityView!.pinAnchors();
      expect(anchors.length).toBeGreaterThan(5);
      const picked = anchors.map((a) => {
        const p = a.world.clone().project(ctx.rig.camera);
        return host.pickCityLot((p.x * 0.5 + 0.5) * 1280, (-p.y * 0.5 + 0.5) * 800);
      });
      expect(picked.every((id) => id !== null)).toBe(true);
      expect(picked.filter((id, i) => id === anchors[i]!.lotId).length).toBeGreaterThan(anchors.length / 2);
    });

    it('pora dnia trafia do makiety: noc zapala okna, także w makiecie zbudowanej nocą', () => {
      const { host } = hostOn('srednia');
      host.setTimeOfDay('night');
      host.showCity(CITY, STATES, 'makieta');
      const mat = () => (meshesOf(host.cityView!.root).find((m) => m.name.startsWith('chunk:'))!.material as MeshStandardMaterial);
      expect(mat().emissiveIntensity).toBeGreaterThan(0);
      host.setTimeOfDay('day');
      expect(mat().emissiveIntensity).toBe(0);
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

// --- Zadanie 12: profile miasta, cienie statyczne, auta w klatce, zwalnianie sceny, cityStats ----------------------------------

type Stats = ReturnType<SceneHost['cityStats']>;
const NO_CITY: Stats = { shown: false, built: false, detail: null, layer: null, cars: 0, drawCalls: 0, shadowCasters: 0 };

/**
 * Wszystko, co widok miasta trzyma w pamięci GPU: geometrie, materiały (także te, których tryb teraz nie używa: obejrzane we wszystkich
 * trzech trybach) i siatki instancjonowane (każda ma własne bufory instancji). Liczy zdarzenia `dispose`; tryb widoku wraca do pierwotnego.
 */
function watchCity(view: CityView): { geometries: Set<BufferGeometry>; materials: Set<Material>; instanced: Set<Mesh>; freed: () => { geometry: number; material: number; instances: number } } {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const instanced = new Set<Mesh>();
  const original = view.stats().layer;
  for (const layer of ['makieta', 'ruch', 'dzielnice'] as const) {
    view.setLayer(layer);
    view.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      geometries.add(m.geometry);
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
      if ((m as InstancedMesh).isInstancedMesh) instanced.add(m);
    });
  }
  view.setLayer(original);
  const done = { geometry: 0, material: 0, instances: 0 };
  for (const g of geometries) g.addEventListener('dispose', () => { done.geometry++; });
  for (const m of materials) m.addEventListener('dispose', () => { done.material++; });
  for (const m of instanced) (m as unknown as { addEventListener(t: string, f: () => void): void }).addEventListener('dispose', () => { done.instances++; });
  return { geometries, materials, instanced, freed: () => ({ ...done }) };
}
/** Liczba korzeni miasta w scenie (jedna geometria w każdej chwili, zero po zwolnieniu). */
const cityRoots = (ctx: RenderContext): number => ctx.scene.children.filter((o) => o.name === 'city').length;
const calls = (fn: unknown): unknown[][] => (fn as ReturnType<typeof vi.fn>).mock.calls;

describe('profil miasta w scenie (cityStats)', () => {
  it('Średnia: makieta z autami i cieniem statycznym, budżet §19 (draw calle + rzucające cień < 150), cityStats mówi prawdę', () => {
    const { host, ctx } = hostOn('srednia');
    expect(host.cityStats()).toEqual(NO_CITY);

    host.showCity(CITY, STATES, 'makieta');
    const s = host.cityStats();
    expect(s).toMatchObject({ shown: true, built: true, detail: 'pelny', layer: 'makieta' });
    expect(s.cars).toBeGreaterThan(0);
    expect(s.shadowCasters).toBeGreaterThan(0);
    expect(s.drawCalls + s.shadowCasters).toBeLessThan(150);
    expect(calls(ctx.setStaticShadows).at(-1)).toEqual([true]);
    expect(ctx.refreshShadows).toHaveBeenCalled();

    host.showCity(CITY, STATES, 'ruch');
    expect(host.cityStats()).toMatchObject({ shown: true, built: true, detail: 'pelny', layer: 'ruch', cars: 0, shadowCasters: 0 });
    expect(host.cityStats().drawCalls).toBeLessThan(60);

    host.showCity(CITY, STATES, 'makieta');
    expect(host.cityStats().cars).toBe(s.cars);   // auta wracają od razu, bez czekania na klatkę

    host.hideCity();   // Średnia zostawia scenę na następne wejście: zbudowana, ale niepokazana i niewidoczna
    expect(host.cityStats()).toEqual({ ...NO_CITY, built: true, detail: 'pelny', layer: 'makieta' });
  });

  it('Niska i telefon: makieta bez aut i bez cieni (drzewa zostają), cieni statycznych nie włącza', () => {
    for (const [preset, mobile] of [['niska', false], ['wysoka', true]] as const) {
      const { host, ctx } = hostOn(preset, 1.6, mobile);
      host.showCity(CITY, STATES, 'makieta');
      expect(host.cityStats(), `${preset} ${mobile}`).toMatchObject({ detail: 'pelny', layer: 'makieta', cars: 0, shadowCasters: 0 });
      expect(host.cityStats().drawCalls, `${preset} ${mobile}`).toBeLessThan(150);
      for (const [on] of calls(ctx.setStaticShadows)) expect(on, `${preset} ${mobile}`).toBe(false);
      expect(ctx.refreshShadows).not.toHaveBeenCalled();
      host.hideCity();
    }
  });

  it('auta jadą w klatce (animate) tylko przy pokazanej makiecie, a pauza je zatrzymuje', () => {
    const { host } = hostOn('srednia');
    host.showCity(CITY, STATES, 'makieta');
    const cars = host.cityView!.root.getObjectByName('cars') as InstancedMesh;
    const snapshot = (): number[] => Array.from(cars.instanceMatrix.array.slice(0, cars.count * 16));
    const t0 = snapshot();
    host.animate(0.5, 0.5, true);   // pauza
    expect(snapshot()).toEqual(t0);
    host.animate(0.5, 0.5, false);
    expect(snapshot()).not.toEqual(t0);
    const t1 = snapshot();
    host.showCity(CITY, STATES, 'ruch');   // warstwa: auta ukryte, animate ich nie liczy
    host.animate(1, 1, false);
    expect(host.cityStats().cars).toBe(0);
    host.showCity(CITY, STATES, 'makieta');
    expect(cars.count).toBeGreaterThan(0);
    expect(snapshot().length).toBe(t1.length);
    host.hideCity();
    const hidden = Array.from(cars.instanceMatrix.array.slice(0, cars.count * 16));
    host.animate(1, 1, false);   // miasto niepokazane: nic się nie liczy
    expect(Array.from(cars.instanceMatrix.array.slice(0, cars.count * 16))).toEqual(hidden);
  });

  it('godzina i dzień z gry sterują autami: szczyt ma ich więcej niż noc, a weekend mniej niż dzień roboczy', () => {
    const cars = (minute: number): number => {
      const { host } = hostOn('srednia');
      host.syncVisuals({ econ: { minute } } as never);   // zegar miasta czytany z sesji, także bez wczytanego sklepu
      host.showCity(CITY, STATES, 'makieta');
      return host.cityStats().cars;
    };
    const day = (d: number, h: number): number => d * 1440 + h * 60;
    // dzień 0 to wtorek (1.09.2026), dzień 4 sobota
    const night = cars(day(0, 3));
    const peak = cars(day(0, 8));
    const saturday = cars(day(4, 8));
    expect(peak).toBeGreaterThan(night);
    expect(saturday).toBeLessThan(peak);
  });

  it('cityClockOf: godzina z minuty gry, weekend to sobota i niedziela (dzień 0 to wtorek)', () => {
    expect(cityClockOf(0)).toEqual({ hour: 0, weekend: false });
    expect(cityClockOf(8 * 60 + 30)).toEqual({ hour: 8.5, weekend: false });
    expect(cityClockOf(4 * 1440 + 6 * 60)).toEqual({ hour: 6, weekend: true });    // sobota
    expect(cityClockOf(5 * 1440 + 23 * 60)).toEqual({ hour: 23, weekend: true });  // niedziela
    expect(cityClockOf(6 * 1440 + 12 * 60)).toEqual({ hour: 12, weekend: false }); // poniedziałek
  });

  it('cienie statyczne: odświeżane przy showCity, setLots i zmianie pory dnia, a hideCity przywraca dynamiczne cienie sklepu', async () => {
    const { host, ctx } = hostOn('srednia');
    await withStore(host);
    const refreshed = (): number => calls(ctx.refreshShadows).length;
    const staticCalls = (): unknown[][] => calls(ctx.setStaticShadows);
    expect(staticCalls()).toHaveLength(0);

    host.showCity(CITY, STATES, 'makieta');
    expect(staticCalls().at(-1)).toEqual([true]);
    const afterShow = refreshed();
    expect(afterShow).toBeGreaterThan(0);

    host.showCity(CITY, { ...STATES, [CITY.startLotId]: 'zajety' }, 'makieta');   // setLots
    expect(refreshed()).toBeGreaterThan(afterShow);

    const afterLots = refreshed();
    host.setTimeOfDay('night');
    expect(refreshed()).toBeGreaterThan(afterLots);
    const afterNight = refreshed();
    host.setTimeOfDay('day');
    expect(refreshed()).toBeGreaterThan(afterNight);

    host.hideCity();
    expect(staticCalls().at(-1)).toEqual([false]);
    const afterHide = refreshed();
    host.setTimeOfDay('night');   // sklep: cienia dynamicznego nikt nie zleca ręcznie
    expect(refreshed()).toBe(afterHide);
  });

  it('zmiana presetu pod pokazanym miastem: następne showCity buduje je od nowa bez aut i bez cieni, a stare zwalnia razem z autami', () => {
    const { host, ctx } = hostOn('srednia');
    host.showCity(CITY, STATES, 'makieta');
    const old = host.cityView!;
    expect(host.cityStats().cars).toBeGreaterThan(0);
    const watched = watchCity(old);
    expect(watched.instanced.size).toBe(2);   // drzewa i auta

    ctx.setPreset('niska');
    host.showCity(CITY, STATES, 'makieta');
    expect(host.cityView).not.toBe(old);
    expect(old.root.parent).toBeNull();
    expect(watched.freed()).toEqual({ geometry: watched.geometries.size, material: watched.materials.size, instances: 2 });
    expect(host.cityStats()).toMatchObject({ detail: 'pelny', layer: 'makieta', cars: 0, shadowCasters: 0 });
    expect(calls(ctx.setStaticShadows).at(-1)).toEqual([false]);
    expect(cityRoots(ctx)).toBe(1);
  });
});

describe('Review Focus 5: makieta przy zmianie trybu, presetu i zakładki', () => {
  it('telefon (profil „telefon” także przy Wysokiej): wyjście z zakładki zwalnia wszystkie geometrie i materiały miasta, powrót buduje prosty bez wycieku', async () => {
    const { host, ctx } = hostOn('wysoka', 390 / 844, true);
    vi.stubGlobal('window', { innerWidth: 390, innerHeight: 844 });
    await withStore(host);
    builds.details.length = 0;
    expect(host.cityStats()).toEqual(NO_CITY);

    // wejście w zakładkę: warstwa „Ruch” na prostej geometrii
    host.showCity(CITY, STATES, 'ruch');
    expect(builds.details).toEqual(['prosty']);
    expect(host.cityStats()).toMatchObject({ shown: true, built: true, detail: 'prosty', layer: 'ruch', cars: 0, shadowCasters: 0 });
    expect(host.cityStats().drawCalls).toBeGreaterThan(0);
    expect(cityRoots(ctx)).toBe(1);

    // „Makieta” na telefonie: pełna geometria, prosta zwolniona od razu, aut i cieni nie ma
    const simple = watchCity(host.cityView!);
    host.showCity(CITY, STATES, 'makieta');
    expect(builds.details).toEqual(['prosty', 'pelny']);
    expect(simple.freed()).toEqual({ geometry: simple.geometries.size, material: simple.materials.size, instances: 0 });
    expect(host.cityStats()).toMatchObject({ shown: true, built: true, detail: 'pelny', layer: 'makieta', cars: 0, shadowCasters: 0 });
    expect(host.cityStats().drawCalls).toBeLessThan(150);
    expect(cityRoots(ctx)).toBe(1);
    for (const [on] of calls(ctx.setStaticShadows)) expect(on).toBe(false);

    // wyjście z zakładki: scena miasta (geometrie, materiały, drzewa) zwolniona w całości
    const full = watchCity(host.cityView!);
    expect(full.instanced.size).toBe(1);   // drzewa; aut na telefonie nie ma
    const fullRoot = host.cityView!.root;
    host.hideCity();
    expect(host.cityStats()).toEqual(NO_CITY);
    expect(host.cityView).toBeNull();
    expect(fullRoot.parent).toBeNull();
    expect(cityRoots(ctx)).toBe(0);
    expect(full.freed()).toEqual({ geometry: full.geometries.size, material: full.materials.size, instances: 1 });
    expect(full.geometries.size).toBeGreaterThan(9);
    expect(full.materials.size).toBeGreaterThanOrEqual(3);   // warstwy, makieta, drzewa
    expect(calls(ctx.setStaticShadows).at(-1)).toEqual([false]);   // cienie sklepu jak przed miastem
    expect(host.loaded!.view.root.visible).toBe(true);
    // w scenie nie został żaden rzucający cień kawałek miasta (chunki, drzewa, auta, ziemia)
    const leftovers: string[] = [];
    ctx.scene.traverse((o) => { if (/^(chunk:|trees|cars|blocks|streets|city)/.test(o.name)) leftovers.push(o.name); });
    expect(leftovers).toEqual([]);

    // powrót: znów prosty, jedna geometria, nic z poprzedniej nie wraca
    builds.details.length = 0;
    host.showCity(CITY, STATES, 'ruch');
    expect(builds.details).toEqual(['prosty']);
    expect(host.cityStats()).toMatchObject({ shown: true, built: true, detail: 'prosty', layer: 'ruch', cars: 0 });
    expect(host.cityView!.root).not.toBe(fullRoot);
    expect(cityRoots(ctx)).toBe(1);
    const again = watchCity(host.cityView!);
    host.hideCity();
    expect(again.freed()).toEqual({ geometry: again.geometries.size, material: again.materials.size, instances: 0 });
    expect(host.cityStats()).toEqual(NO_CITY);
    expect(cityRoots(ctx)).toBe(0);
  });

  it('wolne presety: Niska zwalnia scenę po wyjściu z zakładki (trzy cykle bez narastania), Średnia i Wysoka zostawiają ją ukrytą', () => {
    for (const preset of ['niska', 'srednia', 'wysoka'] as const) {
      const { host, ctx } = hostOn(preset);
      const release = CITY_PROFILES[preset].releaseOnExit;
      let previous: Object3D | null = null;
      for (let cycle = 0; cycle < 3; cycle++) {
        host.showCity(CITY, STATES, 'makieta');
        const view = host.cityView!;
        const root = view.root;
        expect(root === previous, `${preset} cykl ${cycle}`).toBe(!release && cycle > 0);   // zwolniona scena buduje się od nowa, zostawiona wraca ta sama
        expect(cityRoots(ctx), `${preset} cykl ${cycle} w zakładce`).toBe(1);
        const w = watchCity(view);
        host.hideCity();
        expect(cityRoots(ctx), `${preset} cykl ${cycle}`).toBe(release ? 0 : 1);
        expect(host.cityStats().built, `${preset} cykl ${cycle}`).toBe(!release);
        if (release) expect(w.freed()).toEqual({ geometry: w.geometries.size, material: w.materials.size, instances: w.instanced.size });
        else expect(w.freed()).toEqual({ geometry: 0, material: 0, instances: 0 });
        previous = root;
      }
    }
  });

  it('po spłaszczeniu do warstwy kotwice pinezek i pickCityLot nadal trafiają w dachy, a aut w warstwie nie ma', () => {
    const { host, ctx } = hostOn('srednia');
    host.showCity(CITY, STATES, 'makieta');
    expect(host.cityStats().cars).toBeGreaterThan(0);
    host.showCity(CITY, STATES, 'ruch');
    ctx.rig.camera.updateMatrixWorld();
    expect(host.cityStats().cars).toBe(0);
    const anchors = host.cityView!.pinAnchors();
    expect(anchors.length).toBeGreaterThan(5);
    const picked = anchors.map((a) => {
      const p = a.world.clone().project(ctx.rig.camera);
      return host.pickCityLot((p.x * 0.5 + 0.5) * 1280, (-p.y * 0.5 + 0.5) * 800);
    });
    expect(picked.every((id) => id !== null)).toBe(true);
    expect(picked.filter((id, i) => id === anchors[i]!.lotId).length).toBeGreaterThan(anchors.length / 2);
  });
});
