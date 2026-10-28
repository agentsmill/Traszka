import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStore } from '@/game/seeds';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
import { version as GAME_VERSION } from '../../package.json';
import { KNOWN_GAME_VERSIONS, KNOWN_GENERATOR_VERSIONS, SEASON_END_MINUTE, SEED_NEIGHBOURS } from './config';

const ROOT = resolve(__dirname, '../..');

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Importy z kodu, które zostają w czasie działania (bez `import type` i `export type`). */
function runtimeImports(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(re)) out.push(m[2] ?? m[3]!);
  return out;
}

describe('funkcje serwerowe: importy, które Vercel uruchomi', () => {
  it('api/** i src/server/** (i wszystko, co importują) mają tylko względne importy z rozszerzeniem .js do istniejących plików .ts', () => {
    // Vercel kompiluje każdy plik osobno do ESM: bez `.js` Node nie znajdzie modułu, a alias `@/` nie jest rozwiązywany wcale
    // (build przechodzi, funkcja pada przy pierwszym wywołaniu; sprawdzone `vercel build` na kopii repozytorium).
    const seen = new Set<string>();
    const bad: string[] = [];
    const queue = [...files(join(ROOT, 'api')), ...files(join(ROOT, 'src/server'))];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of runtimeImports(readFileSync(file, 'utf8'))) {
        const where = `${relative(ROOT, file)} → ${spec}`;
        if (!spec.startsWith('.') || !spec.endsWith('.js')) {
          bad.push(where);
          continue;
        }
        const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'));
        if (!existsSync(target)) bad.push(`${where} (brak pliku)`);
        else queue.push(target);
      }
    }
    expect(bad).toEqual([]);
    expect([...seen].some((f) => f.includes(`${join('src', 'game', 'nick.ts')}`))).toBe(true);
  });

  it('serwer zna bieżącą wersję gry i generatora (inaczej odrzuci każdy bieg jako „nieaktualna wersja”)', () => {
    expect(KNOWN_GAME_VERSIONS).toContain(GAME_VERSION);
    expect(KNOWN_GENERATOR_VERSIONS).toContain(GENERATOR_VERSION);
  });

  it('koniec sezonu na serwerze to ta sama minuta co w symulacji', () => {
    expect(SEASON_END_MINUTE).toBe(RANKED_SEASON_END_MINUTE);
  });

  it('liczba sąsiednich lokali seeda tygodnia na serwerze to ta sama liczba, którą próbuje gra (resolveStore: seed·1 … seed·N)', () => {
    // NEIGHBOURS w src/game/seeds.ts jest prywatne, więc mierzymy zachowanie: dla którego n gra otworzy sklep `seed·n`, gdy
    // generator składa tylko ten jeden lokal (poza sąsiadami resolveStore oddaje losowy seed z `draw`)
    const reached = (n: number): boolean => {
      const only = `babka-834·${n}`;
      const build = (seed: string): void => { if (seed !== only) throw new Error('lokal się nie składa'); };
      return resolveStore('babka-834', { build, draw: () => 'losowy-1', hasSave: () => false }).seed === only;
    };
    const reachable = Array.from({ length: 20 }, (_, i) => i + 1).filter(reached);
    expect(reachable).toEqual(Array.from({ length: SEED_NEIGHBOURS }, (_, i) => i + 1));
  });
});
