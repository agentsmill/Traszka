import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, posix, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

function files(dir: string, ext = '.ts'): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

// Reguły warstwy symulacji (kontrakty §3): src/sim ma zostać czysty i niezależny od silnika JS,
// żeby serwer mógł odtworzyć przebieg gry bit w bit. Test jest strażnikiem dla strumieni B i C.

/** Usuwa komentarze, zostawiając literały tekstowe (np. 'http://x' nie jest komentarzem). */
function stripComments(source: string): string {
  return source.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (_match, literal?: string) => literal ?? ' ',
  );
}

/**
 * Kod do reguł nazw: bez treści zwykłych literałów tekstowych ('Date' w komunikacie albo 'window' jako typ
 * komórki sklepu to nie przeglądarka) i bez kluczy `window:` (pole obiektu, np. { window: 'W' }).
 * Szablony zostają, bo ich `${...}` zawiera kod.
 */
function bareCode(code: string): string {
  return code
    .replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/([{,;]\s*)window(\s*:)/g, '$1_$2');
}

/** Specyfikatory modułów: `from '...'`, `import('...')` i `import '...'`. */
function importSpecifiers(code: string): string[] {
  const found: string[] = [];
  for (const re of [
    /\bfrom\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*(['"])([^'"\n]+)\1/g,
  ]) {
    for (const m of code.matchAll(re)) found.push(m[2]);
  }
  return found;
}

/** Czy specyfikator wchodzi w warstwę render/ui/game (alias `@/` albo ścieżka względna od pliku). */
function reachesUpperLayer(path: string, specifier: string): boolean {
  const target = specifier.startsWith('@/')
    ? 'src/' + specifier.slice(2)
    : specifier.startsWith('.')
      ? posix.normalize(posix.join(posix.dirname(path), specifier))
      : '';
  return /^src\/(render|ui|game)(\/|$)/.test(target);
}

interface Rule {
  name: string;
  re: RegExp;
}

/** Zależne od silnika JS (wyniki mogą różnić się w ostatnim bicie) — poza crowd/ i nav/. */
const ENGINE_MATH: Rule[] = [
  { name: 'Math.hypot', re: /\bMath\s*\.\s*hypot\b/ },
  { name: 'Math.log', re: /\bMath\s*\.\s*log\w*/ },
  { name: 'Math.pow', re: /\bMath\s*\.\s*pow\b/ },
  { name: '**', re: /\*\*/ },
  { name: 'Math.exp', re: /\bMath\s*\.\s*exp\w*/ },
  { name: 'Math.cbrt', re: /\bMath\s*\.\s*cbrt\b/ },
  { name: 'trig', re: /\bMath\s*\.\s*(?:a?(?:sin|cos|tan)h?|atan2)\b/ },
];

/** Zegar, losowość, przeglądarka: wszędzie w src/sim, także w crowd/ i nav/. */
const ALWAYS: Rule[] = [
  { name: 'Math.random', re: /\bMath\s*\.\s*random\b/ },
  { name: 'Date', re: /\bDate\b/ },
  { name: 'performance', re: /\bperformance\b/ },
  { name: 'localStorage', re: /\blocalStorage\b/ },
  { name: 'window', re: /\bwindow\b/ },
  // `const { hypot } = Math` albo `Math['random']` omijałyby reguły powyżej
  { name: 'Math-alias', re: /\bMath\b(?!\s*\.)/ },
];

/** crowd/ (kierunki do rysowania) i nav/ nie wpływają na stan gry, więc reguły matematyczne ich nie dotyczą. */
function exemptFromEngineMath(path: string): boolean {
  return /^src\/sim\/(crowd|nav)\//.test(path);
}

/** Zwraca nazwy złamanych reguł dla pliku `path` (np. 'src/sim/economy/x.ts') o treści `source`. */
function simViolations(path: string, source: string): string[] {
  const file = path.replace(/\\/g, '/');
  const code = stripComments(source);
  const bare = bareCode(code);
  const specifiers = importSpecifiers(code);
  const found: string[] = [];
  if (specifiers.some((s) => s === 'three' || s.startsWith('three/'))) found.push('three');
  for (const { name, re } of ALWAYS) if (re.test(bare)) found.push(name);
  if (specifiers.some((s) => reachesUpperLayer(file, s))) found.push('layer-import');
  if (!exemptFromEngineMath(file)) {
    for (const { name, re } of ENGINE_MATH) if (re.test(bare)) found.push(name);
  }
  return found;
}

const SIM_FILE = 'src/sim/economy/x.ts';

describe('simViolations: reguły na próbkach', () => {
  it.each<[string, string, string]>([
    [SIM_FILE, "import * as T from 'three';", 'three'],
    [SIM_FILE, "import { Vector3 } from 'three/src/math/Vector3.js';", 'three'],
    [SIM_FILE, "const T = await import('three');", 'three'],
    [SIM_FILE, "import 'three';", 'three'],
    [SIM_FILE, 'const r = Math.random();', 'Math.random'],
    [SIM_FILE, 'const r = Math . random();', 'Math.random'],
    [SIM_FILE, 'const d = new Date();', 'Date'],
    [SIM_FILE, 'const t = Date.now();', 'Date'],
    [SIM_FILE, 'const t = performance.now();', 'performance'],
    [SIM_FILE, "const v = localStorage.getItem('x');", 'localStorage'],
    [SIM_FILE, 'const f = window.foo;', 'window'],
    [SIM_FILE, 'const w = typeof window !== "undefined";', 'window'],
    [SIM_FILE, 'const w = globalThis.window.foo;', 'window'],
    [SIM_FILE, 'const w = cond ? window : null;', 'window'],
    [SIM_FILE, 'const o = { a: window };', 'window'],
    [SIM_FILE, 'const o = { a: 1, window };', 'window'],
    [SIM_FILE, 'const o = { window: window };', 'window'],
    [SIM_FILE, "import { x } from '@/render/y';", 'layer-import'],
    [SIM_FILE, "import { x } from '@/ui/state';", 'layer-import'],
    [SIM_FILE, "import { x } from '@/game/session';", 'layer-import'],
    [SIM_FILE, "import type { S } from '@/game/session';", 'layer-import'],
    [SIM_FILE, "export { x } from '@/ui/y';", 'layer-import'],
    [SIM_FILE, "const m = await import('@/render/y');", 'layer-import'],
    [SIM_FILE, "import { x } from '../../ui/state';", 'layer-import'],
    [SIM_FILE, "import { x } from '../../render/scene';", 'layer-import'],
    ['src/sim/x.ts', "import { x } from '../game/x';", 'layer-import'],
    ['src/sim/store/x.ts', "const m = await import('../../ui/z');", 'layer-import'],
    [SIM_FILE, 'const d = Math.hypot(1, 2);', 'Math.hypot'],
    [SIM_FILE, 'const l = Math.log10(5);', 'Math.log'],
    [SIM_FILE, 'const l = Math.log(5);', 'Math.log'],
    [SIM_FILE, 'const l = Math.log2(5);', 'Math.log'],
    [SIM_FILE, 'const p = Math.pow(2, 3);', 'Math.pow'],
    [SIM_FILE, 'const p = 2 ** 3;', '**'],
    [SIM_FILE, 'x **= 2;', '**'],
    [SIM_FILE, 'const a = Math.atan2(1, 2);', 'trig'],
    [SIM_FILE, 'const s = Math.sin(1);', 'trig'],
    [SIM_FILE, 'const s = Math.cos(1);', 'trig'],
    [SIM_FILE, 'const s = Math.tan(1);', 'trig'],
    [SIM_FILE, 'const s = Math.asin(1);', 'trig'],
    [SIM_FILE, 'const s = Math.atan(1);', 'trig'],
    [SIM_FILE, 'const s = Math.tanh(1);', 'trig'],
    [SIM_FILE, 'const e = Math.exp(1);', 'Math.exp'],
    [SIM_FILE, 'const e = Math.expm1(1);', 'Math.exp'],
    [SIM_FILE, 'const c = Math.cbrt(8);', 'Math.cbrt'],
    // obejścia: alias Math i dostęp przez nawias
    [SIM_FILE, 'const { hypot } = Math;', 'Math-alias'],
    [SIM_FILE, "const r = Math['random']();", 'Math-alias'],
    // `//` w literale tekstowym nie jest komentarzem, więc nie chowa reszty linii
    [SIM_FILE, "const u = 'http://x'; const r = Math.random();", 'Math.random'],
    [SIM_FILE, 'const u = `//${Date.now()}`;', 'Date'],
    // crowd/ i nav/ są zwolnione tylko z matematyki
    ['src/sim/crowd/x.ts', 'const t = Date.now();', 'Date'],
    ['src/sim/crowd/x.ts', 'const r = Math.random();', 'Math.random'],
    ['src/sim/nav/x.ts', "import { x } from '@/game/session';", 'layer-import'],
    ['src/sim/nav/x.ts', 'const f = window.foo;', 'window'],
    ['src/sim/economy/crowd/x.ts', 'const a = Math.atan2(1, 2);', 'trig'],
  ])('%s: %s -> %s', (path, code, rule) => {
    expect(simViolations(path, code)).toContain(rule);
  });

  it.each<[string, string]>([
    [SIM_FILE, ''],
    [SIM_FILE, '/** komentarz z Date i ** */ const x = 1;'],
    [SIM_FILE, '// Math.random w komentarzu'],
    [SIM_FILE, '/* window, performance i localStorage\n   Math.hypot(1, 2) oraz 2 ** 3 */\nconst x = 1;'],
    [SIM_FILE, "// import { x } from '@/ui/state';\nconst x = 1;"],
    [SIM_FILE, '/* a */ const x = 1; // Date.now()'],
    [SIM_FILE, 'const update = 1;'],
    [SIM_FILE, 'const dates = [1]; const Dates = 2; const toDateString = 3;'],
    // 'window' to w sklepie typ komórki (CellType), a nie obiekt przeglądarki
    [SIM_FILE, "type CellType = 'wall' | 'window' | 'floor'; const t: CellType = 'window';"],
    [SIM_FILE, "const GLYPH = { wall: '#', window: 'W', floor: '.' };"],
    [SIM_FILE, 'const ALLOWED: Record<string, true> = {\n  wall: true,\n  window: true,\n  floor: true,\n};'],
    [SIM_FILE, 'interface Cell { kind: number; window: boolean }'],
    [SIM_FILE, "const msg = 'Date, performance i localStorage w tekście'; const bold = '**x**';"],
    [SIM_FILE, 'const windowSize = 3; const performanceScore = 4; const mywindow = 5;'],
    [SIM_FILE, 'const s = Math.sqrt(4);'],
    [SIM_FILE, 'const f = Math.floor(1.5);'],
    [SIM_FILE, 'const n = Math.abs(-1) + Math.min(1, 2) + Math.max(1, 2) + Math.round(1.5) + Math.trunc(2.5) + Math.ceil(0.1);'],
    [SIM_FILE, 'const n = Math.sign(-2) + Math.imul(3, 4);'],
    [SIM_FILE, 'const m = a * b * c;'],
    [SIM_FILE, "import { rand01 } from './rand';"],
    [SIM_FILE, "import type { StoreInfo } from '../store/types';"],
    [SIM_FILE, "import { x } from '@/sim/rng';"],
    [SIM_FILE, "import x from 'threejs-thing';"],
    // względna ścieżka, która zostaje w src/sim, nie jest wejściem do warstwy game
    [SIM_FILE, "import { x } from '../game/x';"],
    ['src/sim/crowd/x.ts', 'const a = Math.atan2(1, 2);'],
    ['src/sim/nav/x.ts', 'const d = Math.hypot(1, 2) + Math.sin(0) + 2 ** 3;'],
  ])('%s: %s -> brak naruszeń', (path, code) => {
    expect(simViolations(path, code)).toEqual([]);
  });

  it('zwraca każdą złamaną regułę raz, w stałej kolejności', () => {
    const code = 'Math.random(); Math.random(); Date.now(); Date.now(); 2 ** 3;';
    expect(simViolations(SIM_FILE, code)).toEqual(['Math.random', 'Date', '**']);
  });
});

describe('architektura', () => {
  it('src/sim: bez three, zegara, przeglądarki, warstw wyżej i matematyki zależnej od silnika', () => {
    const simFiles = files('src/sim').map((f) => f.split(sep).join('/'));
    // zabezpieczenie przed pustym przebiegiem (np. po przeniesieniu katalogu)
    expect(simFiles).toContain('src/sim/economy/economy.ts');
    // testy w src/sim celowo używają Date, **, Math.hypot itd. do dowodów równoważności
    const production = simFiles.filter((f) => !f.endsWith('.test.ts'));
    const offenders = production.flatMap((f) =>
      simViolations(f, readFileSync(f, 'utf8')).map((rule) => `${f}: ${rule}`),
    );
    expect(offenders).toEqual([]);
  });

  it('src/sim nie zawiera plików .tsx', () => {
    expect(files('src/sim', '.tsx')).toEqual([]);
  });

  it('każdy plik .glb w public/assets ma wpis w public/assets/LICENSES.md', () => {
    const licenses = readFileSync('public/assets/LICENSES.md', 'utf8');
    const glbs = files('public/assets', '.glb').map((f) => basename(f));
    expect(glbs.length).toBeGreaterThan(0);
    // nazwa w komórce tabeli z backtickami: `men-suit.glb` nie może przejść dzięki `women-suit.glb`
    const missing = glbs.filter((name) => !licenses.includes('`' + name + '`'));
    expect(missing).toEqual([]);
  });
});
