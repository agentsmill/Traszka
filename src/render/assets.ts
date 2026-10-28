import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Ścieżki assetów z `public/assets/`. Pliki powstają z `assets-src/` przez `npm run assets`
 * (scripts/process-assets.mjs). Licencje: public/assets/LICENSES.md.
 */
export const ASSETS: {
  characters: { modular: string[]; special: string[] };
  props: Record<'lamp' | 'van', string>;
} = {
  characters: {
    /** Stroje klientów (`factory.create`): losowane z seeda. */
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
    /** Stroje specjalne: tylko dla kasjera gracza (`factory.createWithOutfit`), klienci ich nie dostają. Wczytują się na żądanie (`factory.ensureOutfit`), nie na starcie. */
    special: [
      '/assets/characters/special-men-spacesuit.glb',
      '/assets/characters/special-men-king.glb',
      '/assets/characters/special-men-swat.glb',
      '/assets/characters/special-men-adventurer.glb',
      '/assets/characters/special-women-scifi.glb',
      '/assets/characters/special-women-adventurer.glb',
      '/assets/characters/special-women-witch.glb',
      '/assets/characters/special-women-medieval.glb',
      '/assets/characters/special-women-soldier.glb',
    ],
  },
  props: {
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
