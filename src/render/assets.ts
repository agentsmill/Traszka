import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Ścieżki assetów z `public/assets/`. Pliki powstają z `assets-src/` przez `npm run assets`
 * (scripts/process-assets.mjs). Licencje: public/assets/LICENSES.md.
 */
export const ASSETS: {
  characters: {
    ubc: { male: string; female: string; hair: string[]; eyebrows: string[] };
    modular: string[];
    animations: string;
  };
  props: Record<'tree1' | 'tree2' | 'lamp' | 'van', string>;
} = {
  characters: {
    ubc: {
      male: '/assets/characters/ubc-male.glb',
      female: '/assets/characters/ubc-female.glb',
      hair: [
        '/assets/characters/hair-beard.glb',
        '/assets/characters/hair-buns.glb',
        '/assets/characters/hair-buzzed.glb',
        '/assets/characters/hair-buzzed-female.glb',
        '/assets/characters/hair-long.glb',
        '/assets/characters/hair-simple-parted.glb',
      ],
      eyebrows: ['/assets/characters/eyebrows-regular.glb', '/assets/characters/eyebrows-female.glb'],
    },
    modular: [
      '/assets/characters/men-casual-hoodie.glb',
      '/assets/characters/men-casual-2.glb',
      '/assets/characters/men-suit.glb',
      '/assets/characters/men-worker.glb',
      '/assets/characters/men-farmer.glb',
      '/assets/characters/men-beach.glb',
      '/assets/characters/men-punk.glb',
      '/assets/characters/women-casual.glb',
      '/assets/characters/women-suit.glb',
      '/assets/characters/women-formal.glb',
      '/assets/characters/women-worker.glb',
      '/assets/characters/women-punk.glb',
    ],
    animations: '/assets/characters/ual1-standard.glb',
  },
  props: {
    tree1: '/assets/props/tree-default.glb',
    tree2: '/assets/props/tree-fat.glb',
    lamp: '/assets/props/lamp-curved.glb',
    van: '/assets/props/van-delivery.glb',
  },
};

const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();

/**
 * Ścieżka z `ASSETS` (względem `public/`) jako URL względem `base` z vite.config.ts. Dzięki temu build działa
 * także spod podkatalogu, np. na GitHub Pages (`/Traszka/`).
 */
export function assetUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}

/**
 * Wczytuje GLB (kompresja meshopt). Wynik jest cache'owany po URL; błędne wczytanie nie zostaje w cache.
 * `GLTF.scene` jest współdzielona: przed dodaniem do sceny klonuj ją przez `SkeletonUtils.clone`.
 */
export function loadGLB(url: string): Promise<GLTF> {
  let pending = cache.get(url);
  if (!pending) {
    pending = gltfLoader.loadAsync(assetUrl(url)).catch((err: unknown) => {
      cache.delete(url);
      throw err;
    });
    cache.set(url, pending);
  }
  return pending;
}
