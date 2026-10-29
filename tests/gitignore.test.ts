import { spawnSync } from 'node:child_process';
import { devNull } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Repozytorium jest publiczne, a `vercel link` i `vercel pull` tworzą `.vercel/` (identyfikatory projektu i zespołu), więc pliki
 * środowiskowe i katalog `.vercel` nie mogą trafić do commita przez przypadek (`git add .`). Pytamy samego gita (`check-ignore`),
 * a nie czytamy `.gitignore` jako tekstu: liczy się to, co git zignoruje, w tym kolejność reguł z wyjątkiem `!.env.example`.
 * Globalne wykluczenia użytkownika są wyłączone, żeby wynik zależał tylko od pliku w repozytorium.
 */
const ROOT = resolve(__dirname, '..');

/** 0: ścieżka jest ignorowana, 1: nie jest (inny status to błąd gita). `--no-index`: ścieżka nie musi istnieć ani być śledzona. */
function checkIgnore(path: string): number | null {
  const res = spawnSync('git', ['-c', `core.excludesFile=${devNull}`, 'check-ignore', '--no-index', '-q', '--', path], { cwd: ROOT });
  return res.status;
}

describe('.gitignore: sekrety i dane lokalnego połączenia z Vercelem', () => {
  it.each([
    '.env', '.env.local', '.env.production', '.env.development.local', '.env.production.local', '.env.preview',
    'api/.env', 'scripts/.env.local',
    '.vercel', '.vercel/project.json', '.vercel/.env.preview.local', '.vercel/output/config.json',
  ])('%s jest ignorowany (nie trafi do commita)', (path) => {
    expect(checkIgnore(path)).toBe(0);
  });

  it('wzorzec do wypełnienia .env.example nie jest ignorowany (wolno go commitować), także w podkatalogu', () => {
    expect(checkIgnore('.env.example')).toBe(1);
    expect(checkIgnore('api/.env.example')).toBe(1);
  });

  it.each(['src/server/env.ts', 'src/server/env.test.ts', 'scripts/env-check.mjs', 'docs/env.md', 'vercel.json', 'src/vercel.ts', 'api/runs.ts', 'package.json'])(
    '%s nie jest ignorowany (reguły nie są zbyt szerokie)', (path) => {
      expect(checkIgnore(path)).toBe(1);
    },
  );
});
