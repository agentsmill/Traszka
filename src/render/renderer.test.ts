import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderContext, NOTICE_EVENT, NOTICE_NO_WEBGL2 } from './renderer';

/** Kanwa, z której nie da się dostać żadnego kontekstu (przeglądarka bez WebGL 2). */
function canvasWithoutWebGL2(): HTMLCanvasElement {
  return { getContext: () => null, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLCanvasElement;
}

describe('createRenderContext bez WebGL 2', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rzuca wyjątek i wysyła traszka:notice z polskim komunikatem, który odbiera listener zarejestrowany wcześniej', async () => {
    const received: string[] = [];
    window.addEventListener(NOTICE_EVENT, (e) => received.push((e as CustomEvent<{ text: string }>).detail.text));

    expect(() => createRenderContext(canvasWithoutWebGL2(), 'srednia')).toThrow('WebGL 2');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual([NOTICE_NO_WEBGL2]);
    expect(NOTICE_NO_WEBGL2).toBe(
      'Twoja przeglądarka nie obsługuje WebGL 2, więc gra nie może się uruchomić. Spróbuj aktualnej wersji Chrome, Edge, Firefox lub Safari.',
    );
  });
});

/**
 * Cienie statyczne (makieta miasta): `setStaticShadows` wyłącza ciągłe odświeżanie mapy cienia, a `refreshShadows` zleca jedno. Renderer
 * to atrapa (WebGL nie ma w Node): liczy się tylko to, co kontekst robi z `renderer.shadowMap`. Postprocessing podstawiony, żeby preset
 * zostawał taki, jaki zamówiono.
 */
describe('cienie statyczne', () => {
  interface FakeShadowMap { enabled: boolean; type: number; autoUpdate: boolean; needsUpdate: boolean }
  type Created = ReturnType<typeof import('./renderer').createRenderContext>;

  async function createFakeContext(preset: 'niska' | 'srednia' | 'wysoka' = 'srednia'): Promise<Created & { shadowMap: FakeShadowMap }> {
    vi.resetModules();
    vi.doMock('three', async (original) => {
      const actual = await original<typeof import('three')>();
      class FakeRenderer {
        outputColorSpace = '';
        toneMapping = 0;
        toneMappingExposure = 1;
        shadowMap: FakeShadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };   // domyślne wartości three.js
        setPixelRatio(): void {}
        setSize(): void {}
        render(): void {}
        dispose(): void {}
      }
      class FakePMREM {
        fromScene(): { texture: object; dispose(): void } { return { texture: {}, dispose() {} }; }
        dispose(): void {}
      }
      return { ...actual, WebGLRenderer: FakeRenderer, PMREMGenerator: FakePMREM };
    });
    vi.doMock('./post', () => ({
      createPostPipeline: () => ({ aoAvailable: true, setPreset() {}, setSize() {}, setBloomStrength() {}, render() {}, dispose() {} }),
    }));
    vi.stubGlobal('window', {
      innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
      matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    });
    const { createRenderContext: create } = await import('./renderer');
    const ctx = create({ getContext: () => ({}) } as unknown as HTMLCanvasElement, preset);
    return Object.assign(ctx, { shadowMap: (ctx.renderer as unknown as { shadowMap: FakeShadowMap }).shadowMap });
  }

  afterEach(() => {
    vi.doUnmock('three');
    vi.doUnmock('./post');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('domyślnie cienie są dynamiczne: mapa odświeża się co klatkę', async () => {
    const ctx = await createFakeContext();
    expect(ctx.shadowMap.enabled).toBe(true);
    expect(ctx.shadowMap.autoUpdate).toBe(true);
  });

  it('setStaticShadows przełącza autoUpdate: true wyłącza ciągłe odświeżanie i zleca pierwszą mapę, false przywraca dynamiczne cienie', async () => {
    const ctx = await createFakeContext();
    ctx.setStaticShadows(true);
    expect(ctx.shadowMap.autoUpdate).toBe(false);
    expect(ctx.shadowMap.needsUpdate).toBe(true);   // mapa ze sklepu nie może zostać pod miastem
    ctx.shadowMap.needsUpdate = false;              // three.js zużył zlecenie przy rysowaniu
    ctx.setStaticShadows(false);
    expect(ctx.shadowMap.autoUpdate).toBe(true);
    expect(ctx.shadowMap.enabled).toBe(true);       // cienie sklepu dalej włączone, jak przed miastem
    ctx.setStaticShadows(false);
    expect(ctx.shadowMap.autoUpdate).toBe(true);
  });

  it('refreshShadows ustawia needsUpdate (jedno przerysowanie mapy), niczego innego nie rusza', async () => {
    const ctx = await createFakeContext();
    ctx.setStaticShadows(true);
    ctx.shadowMap.needsUpdate = false;
    ctx.refreshShadows();
    expect(ctx.shadowMap.needsUpdate).toBe(true);
    expect(ctx.shadowMap.autoUpdate).toBe(false);
  });

  it('przy cieniach statycznych własne zdarzenia renderera (pora dnia, preset, granice kamery cienia) same odświeżają mapę', async () => {
    const ctx = await createFakeContext('wysoka');
    ctx.setStaticShadows(true);
    const used = (): void => { ctx.shadowMap.needsUpdate = false; };

    used();
    ctx.setTimeOfDay('night');
    expect(ctx.shadowMap.needsUpdate, 'pora dnia').toBe(true);

    used();
    ctx.setPreset('srednia');
    expect(ctx.shadowMap.needsUpdate, 'preset (nowa mapa cienia)').toBe(true);

    used();
    ctx.rig.setBounds(-11, -11, 11, 11);   // inne granice: kamera cienia dopasowuje się do miasta
    expect(ctx.shadowMap.needsUpdate, 'granice').toBe(true);
  });

  it('przy cieniach dynamicznych te zdarzenia nie dotykają needsUpdate (sklep gra jak dotąd)', async () => {
    const ctx = await createFakeContext('wysoka');
    ctx.setTimeOfDay('night');
    ctx.setPreset('srednia');
    ctx.rig.setBounds(-11, -11, 11, 11);
    expect(ctx.shadowMap.needsUpdate).toBe(false);
    expect(ctx.shadowMap.autoUpdate).toBe(true);
  });
});
