import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveStore } from '@/game/seeds';
import { GENERATOR_VERSION } from '@/sim/store/generateStore';
import { RANKED_SEASON_END_MINUTE } from '@/sim/ranked';
import { KNOWN_GENERATOR_VERSIONS, SEASON_END_MINUTE, SEED_NEIGHBOURS } from './config';

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

/**
 * Pliki, które Vercel załaduje w czasie działania, idąc od `api/**` i `src/server/**` po importach (bez `import type`), oraz importy,
 * których funkcja nie rozwiąże (nie względne, bez `.js`, do nieistniejącego pliku).
 */
function runtimeGraph(): { seen: Set<string>; bad: string[] } {
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
  return { seen, bad };
}

describe('funkcje serwerowe: importy, które Vercel uruchomi', () => {
  it('api/** i src/server/** (i wszystko, co importują) mają tylko względne importy z rozszerzeniem .js do istniejących plików .ts', () => {
    // Vercel kompiluje każdy plik osobno do ESM: bez `.js` Node nie znajdzie modułu, a alias `@/` nie jest rozwiązywany wcale
    // (build przechodzi, funkcja pada przy pierwszym wywołaniu; sprawdzone `vercel build` na kopii repozytorium).
    const { seen, bad } = runtimeGraph();
    expect(bad).toEqual([]);
    expect([...seen].some((f) => f.includes(`${join('src', 'game', 'nick.ts')}`))).toBe(true);
  });

  it('typy biegu z gry (src/sim/run.ts, src/sim/economy/commands.ts) serwer bierze tylko przez import type: w czasie działania ich nie ma', () => {
    // `import type` znika przy kompilacji, więc plik z aliasem `@/` w środku (jak run.ts) nie trafia do funkcji i jej nie wywraca.
    const typeOnly = (file: string, from: string): boolean => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      return new RegExp(`^import type \\{[^}]*\\} from '${from.replace(/\./g, '\\.')}';`, 'm').test(src) && !runtimeImports(src).includes(from);
    };
    expect(typeOnly('src/server/runs.ts', '../sim/run.js')).toBe(true);
    expect(typeOnly('src/server/runs.ts', '../sim/economy/commands.js')).toBe(true);
    const { seen } = runtimeGraph();
    const loaded = [...seen].map((f) => relative(ROOT, f));
    expect(loaded).not.toContain(join('src', 'sim', 'run.ts'));
    expect(loaded).not.toContain(join('src', 'sim', 'economy', 'commands.ts'));
    expect(loaded).toContain(join('src', 'server', 'runs.ts'));   // graf jest prawdziwy, a nie pusty
  });

  it('wspólny walidator seeda (src/game/seedText.ts) jest osiągalny z serwera i nie ma żadnych importów', () => {
    const file = join(ROOT, 'src/game/seedText.ts');
    expect(readFileSync(join(ROOT, 'src/server/runs.ts'), 'utf8')).toContain("from '../game/seedText.js'");
    expect(readFileSync(file, 'utf8')).not.toMatch(/^\s*import\b/m);
  });

  it('serwer zna bieżącą wersję generatora (inaczej odrzuci każdy bieg jako „nieaktualna wersja”); wersji gry nie sprawdza, bo o przyjęciu decyduje simVersion', () => {
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

describe('kod serwera i klucza gracza: znaki niewidoczne tylko jako zapis \\uXXXX, nigdy dosłownie', () => {
  // Dosłowny niewidoczny znak w wyrażeniu regularnym ginie przy kopiowaniu i edycji i po cichu zmienia jego sens: z `(?!<ZWJ>)\p{Cf}`
  // zostaje `(?!)\p{Cf}` i serwer wpuszcza wszystkie znaki formatujące (dosłowny U+200D był w `runs.ts`). Zapis \u200d tego nie traci.
  // Klasy ogólne (formatujące, separatory wierszy i akapitów, surogaty) plus jawne zakresy ze `src/game/seedText.ts` (`ALSO_HIDDEN`): puste litery,
  // selektory wariantów, nieprzydzielone obok znaków niewidocznych i blok znaczników aż do U+E0FFF. U+FE0F (emoji) jest dozwolony.
  const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}\p{Cs}\u{034f}\u{115f}-\u{1160}\u{17b4}-\u{17b5}\u{180b}-\u{180f}\u{2065}\u{3164}\u{fe00}-\u{fe0e}\u{ffa0}\u{fff0}-\u{fff8}\u{e0000}-\u{e0fff}]/u;

  it('api/**, src/server/**, src/ui/ranking/** i playerKey.ts (bez testów) nie zawierają dosłownych znaków niewidocznych', () => {
    const sources = [
      ...files(join(ROOT, 'api')), ...files(join(ROOT, 'src/server')), ...files(join(ROOT, 'src/ui/ranking')),
      join(ROOT, 'src/game/playerKey.ts'), join(ROOT, 'src/game/seedText.ts'),
    ];
    expect(sources.length).toBeGreaterThan(20);
    const found: string[] = [];
    for (const file of sources) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const m = INVISIBLE.exec(line);
        if (m) found.push(`${relative(ROOT, file)}:${i + 1} U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
      });
    }
    expect(found).toEqual([]);
  });

  it('wykrywacz łapie wstawiony znak (inaczej test powyżej niczego nie pilnuje)', () => {
    const inserted = [
      0x200d, 0x200b, 0x00ad, 0xfeff, 0x202e, 0xe0067, 0x0600, 0x110bd, 0x1d173, 0xfff9, 0xe0100, 0x3164, 0x034f, 0x115f, 0x17b4, 0x180b,
      0x2065, 0xfe00, 0xfe0e, 0xffa0, 0xfff0, 0xe0fff, 0x2028, 0x2029,
    ];
    for (const cp of inserted) expect(INVISIBLE.test(`const x = /(?!${String.fromCodePoint(cp)})/u;`), cp.toString(16)).toBe(true);
    // zwykłe znaki i dozwolone emoji z selektorem wariantu nie są znakami niewidocznymi
    for (const cp of [0x61, 0x20, 0x00a0, 0x2800, 0xfe0f, 0x1f3f4, 0x1f469]) expect(INVISIBLE.test(`const x = '${String.fromCodePoint(cp)}';`), cp.toString(16)).toBe(false);
    expect(INVISIBLE.test('const x = /(?!\\u200d)\\p{Cf}/u;')).toBe(false);
    expect(INVISIBLE.test('const x = /\\u{e0100}/u;')).toBe(false);
  });
});
