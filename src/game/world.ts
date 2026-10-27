import { createCrowd, type Crowd } from '@/sim/crowd/crowd';
import { generateStore } from '@/sim/store/generateStore';
import type { StoreLayout } from '@/sim/store/types';
import type { Speed } from './loop';

/** Stan symulacji jednego sklepu. Układ jest wspólny dla sklepu w scenie i dla tłumu: `stepCrowd` dostaje ten sam obiekt. */
export interface World { seed: string; layout: StoreLayout; crowd: Crowd; speed: Speed }

/** Normalny rozmiar tłumu w etapie 1: do 12 klientów naraz, 10 nowych na minutę. */
export const CROWD_OPTIONS = { targetCount: 12, spawnPerMinute: 10 } as const;

export function createWorld(seed: string): World {
  const layout = generateStore(seed);
  return { seed, layout, crowd: createCrowd(layout, seed, { ...CROWD_OPTIONS }), speed: 1 };
}
