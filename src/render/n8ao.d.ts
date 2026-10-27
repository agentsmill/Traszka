// Pakiet n8ao nie dostarcza typów. Opisany tylko ten fragment API, którego używa src/render/post.ts.
declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Color, Scene } from 'three';

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    gammaCorrection: boolean;
    halfRes: boolean;
    transparencyAware: boolean;
  }

  export type N8AOQualityMode = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra';

  /** Ambient occlusion jako przebieg pmndrs/postprocessing; wymaga RenderPass przed sobą. */
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    readonly configuration: N8AOConfiguration;
    setQualityMode(mode: N8AOQualityMode): void;
  }
}
