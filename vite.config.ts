import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Ścieżki względne: build działa z dowolnego katalogu (GitHub Pages: /Traszka/). Assety GLB idą przez `assetUrl`.
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
