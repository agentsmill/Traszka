import { createCrowd, type Crowd, type CrowdOptions } from '@/sim/crowd/crowd';
import { generateStore } from '@/sim/store/generateStore';
import type { StoreLayout } from '@/sim/store/types';
import type { Speed } from './loop';

/** Stan symulacji jednego sklepu. Układ jest wspólny dla sklepu w scenie i dla tłumu: `stepCrowd` dostaje ten sam obiekt. */
export interface World { seed: string; layout: StoreLayout; crowd: Crowd; speed: Speed }

/** Normalny rozmiar tłumu w etapie 1: do 12 klientów naraz, 10 nowych na minutę. */
export const CROWD_OPTIONS = { targetCount: 12, spawnPerMinute: 10 } as const;

/** `crowd` zmienia rozmiar tłumu (benchmark: 60 postaci); układ sklepu zależy od seeda, a po remoncie podaje go gra. */
export function createWorld(seed: string, crowd: CrowdOptions = CROWD_OPTIONS, layout: StoreLayout = generateStore(seed)): World {
  return { seed, layout, crowd: createCrowd(layout, seed, { ...crowd }), speed: 1 };
}
