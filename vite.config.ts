import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Wersja gry wstawiana do kodu jako `__GAME_VERSION__` (czyta ją `src/game/version.ts`). Poza Vitest to
 * `<wersja z package.json>+<12 znaków commita>`: commit z Vercela, a lokalnie z gita; bez jednego i drugiego `dev`.
 * Pod Vitest stałe `test`, żeby testy i zapisy w fixturach nie zależały od tego, na którym commicie je puszczono.
 */
function gameVersion(mode: string): string {
  if (mode === 'test') return 'test';
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string };
  let sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 12);
  if (!sha) {
    try {
      // stderr w pustkę: bez gita (albo poza repozytorium) build ma po cichu dostać `dev`, a nie zaśmiecić konsoli.
      sha = execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().slice(0, 12);
    } catch {
      sha = '';
    }
  }
  return `${pkg.version}+${sha || 'dev'}`;
}

export default defineConfig(({ mode }) => ({
  // Ścieżki względne: build działa z dowolnego katalogu (GitHub Pages: /Traszka/). Assety GLB idą przez `assetUrl`.
  base: './',
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion(mode)),
  },
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
}));
