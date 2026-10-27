import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, type Effect, type Pass,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Color, HalfFloatType, Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import type { QualitySettings } from './quality';
import { LIGHT_PRESETS, PALETTE } from './style';

export interface PostPipeline {
  render(): void;
  /** Rozmiar w pikselach CSS; bufory dostają rozmiar po uwzględnieniu pixelRatio renderera. */
  setSize(w: number, h: number): void;
  setPreset(q: QualitySettings): void;
  /** Intensywność bloomu (`LIGHT_PRESETS[...].bloomStrength`); działa od razu, bez przebudowy przebiegów. */
  setBloomStrength(strength: number): void;
  /** false, gdy nie udało się utworzyć AO (wtedy pipeline działa dalej bez niego). */
  readonly aoAvailable: boolean;
  dispose(): void;
}

export type ComposerLike = Pick<EffectComposer, 'addPass' | 'removePass' | 'render' | 'setSize' | 'dispose'>;
export interface AoHandle { pass: Pass; setQuality(mode: 'half' | 'full'): void }
export interface EffectsHandle { passes: Pass[]; setBloomStrength(strength: number): void }

/** Fabryki elementów pipeline'u. Test jednostkowy podstawia atrapy, bo w Node nie ma WebGL. */
export interface PostFactories {
  composer(renderer: WebGLRenderer): ComposerLike;
  ao(scene: Scene, camera: Camera, width: number, height: number): AoHandle;
  effects(camera: Camera, q: QualitySettings, bloomStrength: number): EffectsHandle;
}

/** Poświata ciepłego brązu z palety zamiast czerni: cień kontaktowy ma być miękki i „cozy”. */
const AO_TINT = PALETTE.wall[4];
/** Bloom łapie tylko to, co jaśniejsze od oświetlonej powierzchni, czyli materiały emissive (patrz style.ts). */
const BLOOM_LUMINANCE_THRESHOLD = 0.9;

export const defaultPostFactories: PostFactories = {
  // Bufory half-float, bo bloom i tone mapping liczą na HDR. Bez MSAA, bo AO go nie znosi (antyaliasing robi SMAA).
  composer: (renderer) => new EffectComposer(renderer, { frameBufferType: HalfFloatType, multisampling: 0 }),

  ao(scene, camera, width, height) {
    const pass = new N8AOPostPass(scene, camera, width, height);
    const c = pass.configuration;
    c.aoRadius = 0.7; // metry: pół metra cienia kontaktowego pod półką i przy ścianie
    c.distanceFalloff = 1;
    c.intensity = 4;
    c.color = new Color(AO_TINT);
    return {
      pass,
      setQuality(mode) {
        c.halfRes = mode === 'half';
        pass.setQualityMode(mode === 'half' ? 'Low' : 'Medium');
      },
    };
  },

  effects(camera, q, bloomStrength) {
    const chain: Effect[] = [];
    let bloom: BloomEffect | null = null;
    if (q.bloom) {
      bloom = new BloomEffect({
        luminanceThreshold: BLOOM_LUMINANCE_THRESHOLD, luminanceSmoothing: 0.03, mipmapBlur: true, radius: 0.7,
        intensity: bloomStrength,
      });
      chain.push(bloom);
    }
    // Neutral, nie AgX: AgX szarzy ciepłą paletę (docs/style-guide.md). Ekspozycję bierze z renderer.toneMappingExposure.
    chain.push(new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }), new VignetteEffect({ offset: 0.3, darkness: 0.45 }));
    // SMAA w osobnym przebiegu po tone mappingu: EffectPass układa efekty splotowe przed resztą, a SMAA ma wykrywać
    // krawędzie na obrazie po mapowaniu tonalnym, nie na HDR.
    const passes: Pass[] = [new EffectPass(camera, ...chain)];
    if (q.smaa) passes.push(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    return {
      passes,
      setBloomStrength(strength) {
        if (bloom) bloom.intensity = strength;
      },
    };
  },
};

/**
 * Pipeline: RenderPass → N8AO (preset ≠ niska) → EffectPass(bloom, tone mapping Neutral, winieta) → EffectPass(SMAA).
 * Błąd przy tworzeniu AO nie przerywa pracy: pipeline działa bez niego i ma `aoAvailable === false`. Błąd tworzenia
 * samego composera propaguje się do wywołującego, który wtedy renderuje bezpośrednio.
 */
export function createPostPipeline(
  renderer: WebGLRenderer, scene: Scene, camera: Camera, q: QualitySettings, factories: PostFactories = defaultPostFactories,
): PostPipeline {
  const composer = factories.composer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  let aoAvailable = true;
  let ao: AoHandle | null = null;
  let fx: EffectsHandle | null = null;
  let current: QualitySettings | null = null;
  let bloomStrength = LIGHT_PRESETS.day.bloomStrength;

  function applyAo(mode: QualitySettings['ao']): void {
    if (mode === 'off') {
      if (ao) {
        composer.removePass(ao.pass);
        ao.pass.dispose();
        ao = null;
      }
      return;
    }
    if (!ao && aoAvailable) {
      try {
        const size = renderer.getDrawingBufferSize(new Vector2());
        const handle = factories.ao(scene, camera, size.x, size.y);
        composer.addPass(handle.pass, 1); // zaraz po RenderPass
        ao = handle;
      } catch (error) {
        aoAvailable = false;
        console.warn('Ambient occlusion niedostępny, renderuję bez niego.', error);
      }
    }
    ao?.setQuality(mode);
  }

  function applyEffects(next: QualitySettings): void {
    if (fx && current && current.bloom === next.bloom && current.smaa === next.smaa) return;
    if (fx) {
      for (const pass of fx.passes) {
        composer.removePass(pass);
        pass.dispose();
      }
    }
    fx = factories.effects(camera, next, bloomStrength);
    for (const pass of fx.passes) composer.addPass(pass);
  }

  function apply(next: QualitySettings): void {
    applyAo(next.ao);
    applyEffects(next);
    current = next;
  }

  apply(q);

  return {
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h, true),
    setPreset: apply,
    setBloomStrength(strength) {
      bloomStrength = strength;
      fx?.setBloomStrength(strength);
    },
    get aoAvailable() { return aoAvailable; },
    dispose: () => composer.dispose(),
  };
}
