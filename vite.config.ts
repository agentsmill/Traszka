import { fileURLToPath, URL } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Ścieżki względne: build działa z dowolnego katalogu (GitHub Pages: /Traszka/). Assety GLB idą przez `assetUrl`.
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // `.claude/worktrees/` trzyma worktree równoległych sesji: pełne kopie repozytorium z własnymi testami i plikami,
  // których ten katalog nie powinien ani testować, ani obserwować (vite przeładowywał się w trakcie testów).
  server: {
    watch: { ignored: ['**/.claude/**'] },
  },
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
