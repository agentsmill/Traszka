import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, join, posix, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CH } from '@/sim/economy/tycoon/channels';

function files(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, match) : match.test(p) ? [p] : [];
  });
}

// Reguły warstwy symulacji (kontrakty §3): src/sim ma zostać czysty i niezależny od silnika JS,
// żeby serwer mógł odtworzyć przebieg gry bit w bit. Test jest strażnikiem dla strumieni B i C.

interface Scanned {
  /** Kod: komentarze wycięte, literały tekstowe zamienione na `"N"`, regex na `/_/`, z szablonów zostaje kod z `${…}`. */
  code: string;
  /** Treść literałów tekstowych i szablonów bez `${…}`; `"N"` w kodzie to indeks tej tablicy (potrzebny do specyfikatorów importów). */
  literals: string[];
}

/**
 * Po tych słowach kluczowych `/` zaczyna regex; po innych identyfikatorach, liczbach, `)` i `]` to dzielenie. Słowo po
 * `.` albo `?.` (`cfg.of`, `x.in`, `a.new`) jest nazwą pola, więc wyjątek go nie dotyczy.
 */
const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const isWordChar = (c: string): boolean => /[\w$]/.test(c) || c > '\x7f';

/**
 * Przechodzi kod znak po znaku i zostawia tylko to, co silnik wykona: bez komentarzy, bez treści literałów (`'Date'` w
 * komunikacie to nie zegar) i bez regexów, ale z kodem w `${…}` szablonów (także zagnieżdżonych). Wycinanie komentarzy
 * samym regexem myliło się na `"${Date.now()}"` w szablonie i na `/a\//` (regex zjadał resztę linii).
 */
function scanCode(src: string): Scanned {
  const literals: string[] = [];
  let i = 0;
  const literal = (text: string): string => `"${literals.push(text) - 1}"`;

  /** Literał w cudzysłowie `q` (`i` stoi na otwierającym); urwany na końcu linii nie zjada reszty pliku. */
  function quoted(q: string): string {
    const from = ++i;
    while (i < src.length && src[i] !== q && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
    const text = src.slice(from, i);
    if (src[i] === q) i++;
    return literal(text);
  }

  /** Przesuwa `i` za literał regex zaczynający się na `/` (klasa `[...]` może zawierać `/`). Bez zamknięcia w tej linii to było dzielenie: false. */
  function skipRegex(): boolean {
    let inClass = false;
    for (let j = i + 1; j < src.length && src[j] !== '\n'; j++) {
      const c = src[j]!;
      if (c === '\\') j++;
      else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        i = j + 1;
        while (i < src.length && isWordChar(src[i]!)) i++;   // flagi
        return true;
      }
    }
    return false;
  }

  /** Szablon od backticka na `i`: bez `${…}` to zwykły literał, z nimi zostaje sam kod podstawień. */
  function template(): string {
    let text = '';
    let substitutions = '';
    i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        substitutions += '${' + code(true) + '}';
      } else {
        const width = src[i] === '\\' ? 2 : 1;
        text += src.slice(i, i + width);
        i += width;
      }
    }
    i++;
    return substitutions === '' ? literal(text) : '`' + substitutions + '`';
  }

  /** Kod do końca pliku albo, w `${…}`, do zamykającego `}` (który też zjada). */
  function code(nested: boolean): string {
    let out = '';
    let depth = 0;
    let value = false;   // poprzedni znaczący token kończy wartość, więc `/` jest dzieleniem
    let member = false;  // poprzedni znaczący token to `.` dostępu do pola (nie `...`), więc następne słowo jest nazwą pola
    while (i < src.length) {
      const c = src[i]!;
      const next = src[i + 1];
      if (c === '/' && next === '/') {
        while (i < src.length && src[i] !== '\n') i++;
        out += ' ';
      } else if (c === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end < 0 ? src.length : end + 2;
        out += src.slice(i, stop).includes('\n') ? '\n' : ' ';   // nowa linia bywa separatorem pól w interfejsie
        i = stop;
      } else if (c === '"' || c === "'") {
        out += quoted(c);
        value = true;
        member = false;
      } else if (c === '`') {
        out += template();
        value = true;
        member = false;
      } else if (c === '/' && !value && skipRegex()) {
        out += '/_/';
        value = true;
        member = false;
      } else if (isWordChar(c)) {
        let j = i + 1;
        while (j < src.length && isWordChar(src[j]!)) j++;
        const word = src.slice(i, j);
        out += word;
        i = j;
        value = member || !REGEX_AFTER.has(word);
        member = false;
      } else if (/\s/.test(c)) {
        out += c;
        i++;
      } else if ((c === '+' || c === '-') && next === c) {
        out += c + c;   // `i++ / 2`: ++ i -- nie zmieniają tego, czy `/` jest dzieleniem
        i += 2;
      } else if ((c === '!' && value && next !== '=') || c === '#') {
        // `xs[i]! / 2`: asercja nie-null po wartości (nie `!=`) i `#` nazwy prywatnej (`this.#of`) zostawiają `value` i `member` jak były.
        // Znana pomyłka: negacja zaraz po nagłówku (`if (x) !/Date/.test(s)`) albo na początku linii po wyrażeniu bez średnika
        // (`f(x)\n!/Date/.test(s)`) wygląda jak asercja po wartości, więc regex jest czytany jak dzielenie. Treść regexu staje się kodem
        // (fałszywy alarm), ale też zdarza się odwrotnie: regex z apostrofem, cudzysłowem albo backtickiem (`!/'/.test(s)`) otwiera
        // literał, który zjada resztę linii, i może schować prawdziwe naruszenie za nim (`!/'/.test(s); Date.now()` przechodzi).
        // W src/sim nie ma takiego zapisu; gdyby się pojawił, wstaw średnik albo nawiasy: `if (x) { ... }`, `(!/'/.test(s))`.
        out += c;
        i++;
      } else {
        if (c === '}' && nested && depth === 0) {
          i++;
          return out;
        }
        depth += c === '{' ? 1 : c === '}' ? -1 : 0;
        out += c;
        value = c === ')' || c === ']';
        member = c === '.' && src[i - 1] !== '.';   // `...` nie jest dostępem do pola: spread przed `new` zostaje słowem kluczowym
        i++;
      }
    }
    return out;
  }

  return { code: code(false), literals };
}

/** Specyfikatory modułów: `from '...'`, `import('...')`, `import '...'` i `require('...')` (szablon bez `${…}` też jest literałem). */
function importSpecifiers({ code, literals }: Scanned): string[] {
  const found: string[] = [];
  for (const re of [/\bfrom\s*"(\d+)"/g, /\bimport\s*\(\s*"(\d+)"/g, /\bimport\s*"(\d+)"/g, /\brequire\s*\(\s*"(\d+)"/g]) {
    for (const m of code.matchAll(re)) found.push(literals[Number(m[1])]!);
  }
  return found;
}

/** Ścieżka od korzenia repozytorium (`src/…`), do której prowadzi specyfikator (alias `@/` albo ścieżka względna od pliku); '' dla pakietów. */
function resolveTarget(path: string, specifier: string): string {
  return specifier.startsWith('@/')
    ? 'src/' + specifier.slice(2)
    : specifier.startsWith('.')
      ? posix.normalize(posix.join(posix.dirname(path), specifier))
      : '';
}

/** Czy specyfikator wchodzi w warstwę render/ui/game (alias `@/` albo ścieżka względna od pliku). */
function reachesUpperLayer(path: string, specifier: string): boolean {
  return /^src\/(render|ui|game)(\/|$)/.test(resolveTarget(path, specifier));
}

/** Moduł Node (`node:fs`, ale też `fs` i `fs/promises`): w przeglądarce go nie ma, a na serwerze odtwarzającym bieg nie ma czego szukać. */
const isNodeModule = (specifier: string): boolean => specifier.startsWith('node:') || builtinModules.includes(specifier.split('/')[0]!);

interface Rule {
  name: string;
  test: (code: string) => boolean;
}

const matches = (name: string, re: RegExp): Rule => ({ name, test: (code) => re.test(code) });

/**
 * Odwołanie do globalnej nazwy. Poza dostępem do pola (`staff.performance`, `a?.performance`; ale nie `...performance`)
 * i poza deklaracją w pozycji klucza, pola albo parametru z adnotacją (`{ performance: 1 }`, `window?: boolean`,
 * `(performance: number)`): to są zwykłe nazwy własne. Dalej łapie `cond ? window : null`, `{ a: window }`, `{ window }`
 * i `typeof window`. `globalThis.window` i `global.Date` (Node) łapią zakazy `globalThis` i `global`.
 */
function globalName(name: string): Rule {
  const member = new RegExp(`(?<!\\.)\\.\\s*${name}\\b`, 'g');
  const modifiers = 'public|protected|private|readonly|static|declare|abstract|override';
  const declared = new RegExp(`((?:^|[{,;(])\\s*|\\b(?:${modifiers})\\s+)${name}([ \\t]*\\??[ \\t]*:)`, 'gm');
  const reference = new RegExp(`(?<![\\w$#])${name}(?![\\w$])`);
  return { name, test: (code) => reference.test(code.replace(member, ' ').replace(declared, '$1_$2')) };
}

/** Metoda zależna od locale/ICU (`a.localeCompare(b)` daje inną kolejność w innym silniku). Samo `toLocaleString` zostaje: używa go tekst wyświetlany. */
const localeMethod = (name: string): Rule => matches(name, new RegExp(`\\.\\s*${name}\\b`));

/** Zależne od silnika JS (wyniki mogą różnić się w ostatnim bicie) — poza crowd/ i nav/. */
const ENGINE_MATH: Rule[] = [
  matches('Math.hypot', /\bMath\s*\.\s*hypot\b/),
  matches('Math.log', /\bMath\s*\.\s*log\w*/),
  matches('Math.pow', /\bMath\s*\.\s*pow\b/),
  matches('**', /\*\*/),
  matches('Math.exp', /\bMath\s*\.\s*exp\w*/),
  matches('Math.cbrt', /\bMath\s*\.\s*cbrt\b/),
  matches('trig', /\bMath\s*\.\s*(?:a?(?:sin|cos|tan)h?|atan2)\b/),
];

/** Zegar, losowość, przeglądarka, wejście-wyjście: wszędzie w src/sim, także w crowd/ i nav/. */
const GLOBAL_NAMES = [
  'Date', 'performance', 'localStorage', 'window',
  'globalThis', 'global', 'self', 'crypto', 'Intl', 'document', 'navigator', 'sessionStorage', 'indexedDB',
  'fetch', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'process', 'require',
];
const ALWAYS: Rule[] = [
  matches('Math.random', /\bMath\s*\.\s*random\b/),
  ...GLOBAL_NAMES.map(globalName),
  ...['localeCompare', 'toLocaleLowerCase', 'toLocaleUpperCase'].map(localeMethod),
  // `const { hypot } = Math` albo `Math['random']` omijałyby reguły powyżej; samo `typeof Math` niczego nie woła
  { name: 'Math-alias', test: (code) => /\bMath\b(?!\s*\.)/.test(code.replace(/\btypeof\s+Math\b/g, ' ')) },
];

/** crowd/ (kierunki do rysowania) i nav/ nie wpływają na stan gry, więc reguły matematyczne ich nie dotyczą. */
function exemptFromEngineMath(path: string): boolean {
  return /^src\/sim\/(crowd|nav)\//.test(path);
}

/** Zwraca nazwy złamanych reguł dla pliku `path` (np. 'src/sim/economy/x.ts') o treści `source`. */
function simViolations(path: string, source: string): string[] {
  const file = path.replace(/\\/g, '/');
  const scanned = scanCode(source);
  const specifiers = importSpecifiers(scanned);
  const found: string[] = [];
  if (specifiers.some((s) => s === 'three' || s.startsWith('three/'))) found.push('three');
  if (specifiers.some(isNodeModule)) found.push('node-import');
  for (const { name, test } of ALWAYS) if (test(scanned.code)) found.push(name);
  if (specifiers.some((s) => reachesUpperLayer(file, s))) found.push('layer-import');
  if (!exemptFromEngineMath(file)) {
    for (const { name, test } of ENGINE_MATH) if (test(scanned.code)) found.push(name);
  }
  return found;
}

// --- Pliki gry testowane w node ------------------------------------------------------------------------------------

/**
 * Pliki warstwy gry, które testy puszczają w node (atrapy zamiast sceny i renderera): `dispatchCommand` i powłoka gry oraz
 * decyzje pętli klatek. Import wartości z `three`, renderera albo sceny wciągnąłby WebGL do tych testów (i rozpadł je w node),
 * więc z tych modułów wolno brać tylko typy (`import type`).
 */
const NODE_TESTABLE_FILES = ['src/game/actions.ts', 'src/game/frame.ts'];

/** Czy cel to renderer (`src/render/…`) albo scena (`src/game/scene`, z rozszerzeniem lub bez). */
const isRendererTarget = (target: string): boolean => /^src\/render(\/|$)/.test(target) || /^src\/game\/scene(\.[mc]?[jt]sx?)?$/.test(target);

/** Czy klauzula `import … ` / `export … ` (bez `from '…'`) niesie same typy: `import type …`, `export type …` albo `{ type A, type B }`. */
function isTypeOnlyClause(clause: string): boolean {
  const c = clause.trim();
  if (/^(?:import|export)\s+type(?:\s+[\w$]|\s*[{*])/.test(c)) return true;   // `import type from './x'` (nic po `type`) to domyślny import o nazwie `type`
  const named = /^(?:import|export)\s*\{([^}]*)\}$/.exec(c);
  const items = named ? named[1]!.split(',').map((x) => x.trim()).filter(Boolean) : [];
  return items.length > 0 && items.every((item) => /^type\s/.test(item));
}

/**
 * Specyfikatory, z których plik bierze wartości: `import x from`, `import { a, type B } from`, `export … from`, `import 'x'`,
 * `import('x')` i `require('x')`. Pomija `import type …`, `export type …` i `{ type A }` oraz `typeof import('x')` (to tylko typ).
 * Dynamiczny `import('x')` w pozycji typu (`x: import('./a').T`) liczy się jak wartość: zapisz to jako `import type`.
 */
function valueImportSpecifiers({ code, literals }: Scanned): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/\bfrom\s*"(\d+)"/g)) {
    let start = 0;
    for (const k of code.slice(0, m.index).matchAll(/\b(?:import|export)\b/g)) start = k.index;
    if (!isTypeOnlyClause(code.slice(start, m.index))) found.push(literals[Number(m[1])]!);
  }
  for (const re of [/(?<!\btypeof\s*)\bimport\s*\(\s*"(\d+)"/g, /\bimport\s*"(\d+)"/g, /\brequire\s*\(\s*"(\d+)"/g]) {
    for (const m of code.matchAll(re)) found.push(literals[Number(m[1])]!);
  }
  return found;
}

/** Specyfikatory (bez powtórzeń), którymi plik z `NODE_TESTABLE_FILES` bierze wartości z `three`, renderera albo sceny; dla innych plików pusto. */
function nodeTestableViolations(path: string, source: string): string[] {
  const file = path.replace(/\\/g, '/');
  if (!NODE_TESTABLE_FILES.includes(file)) return [];
  const bad = valueImportSpecifiers(scanCode(source)).filter((s) => s === 'three' || s.startsWith('three/') || isRendererTarget(resolveTarget(file, s)));
  return [...new Set(bad)];
}

// --- Kanały rand01 (kontrakty §3) ----------------------------------------------------------------------------------

/** Moduły strumienia C: kanały losowości 100–199; reszta src/sim zostaje poniżej 100 (zajęte 1, 3, 7, 21, 22). */
const TYCOON_DIR = 'src/sim/economy/tycoon/';

/** Trzeci argument wywołania, którego nawias otwierający stoi tuż przed `from`; null, gdy wywołanie ma mniej argumentów. */
function thirdArgument(code: string, from: number): string | null {
  const args: string[] = [];
  let depth = 0;
  let begin = from;
  for (let i = from; i < code.length; i++) {
    const c = code[i]!;
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) {
        args.push(code.slice(begin, i));
        break;
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(code.slice(begin, i));
      begin = i + 1;
    }
  }
  return args[2]?.trim() ?? null;
}

const NUMBER_LITERAL = /^[+-]?(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)$/;
/** Kanał z rejestru `CH` w `tycoon/channels.ts` (np. `CH.cardPick`): wartość bierzemy z samego rejestru. */
const CHANNEL_CONST = /^CH\s*\.\s*([A-Za-z_$][\w$]*)$/;

/** Numer kanału: literał liczbowy albo stała z rejestru `CH`; null, gdy argument jest czymś innym (wyrażenie, inna stała). */
function channelValue(arg: string): number | null {
  if (NUMBER_LITERAL.test(arg)) return Number(arg.replace(/_/g, ''));
  const name = CHANNEL_CONST.exec(arg)?.[1];
  return name !== undefined && Object.hasOwn(CH, name) ? CH[name as keyof typeof CH] : null;
}

/**
 * Złamane kanały `rand01(seedHash, a, K)`: poza tycoon/ K < 100, w nim 100 ≤ K ≤ 199. W tycoon/ kanał musi być literałem
 * albo stałą `CH.nazwa` z `channels.ts` (rejestr jest jeden, więc dwa moduły nie wezmą tego samego strumienia, a nazwa
 * mówi, co losuje); wywołanie bez kanału (to kanał 0 ekonomii) albo z wyrażeniem jest tam błędem, bo nie da się go
 * sprawdzić. Poza tycoon/ wyrażenia i stałe spoza `CH` nie są sprawdzane.
 */
function channelViolations(path: string, source: string): string[] {
  const inTycoon = path.replace(/\\/g, '/').startsWith(TYCOON_DIR);
  const { code } = scanCode(source);
  const bad: string[] = [];
  for (const m of code.matchAll(/\brand01\s*\(/g)) {
    const arg = thirdArgument(code, m.index + m[0].length);
    if (arg === null) {
      if (inTycoon) bad.push('rand01 bez kanału');
      continue;
    }
    const channel = channelValue(arg);
    if (channel === null) {
      if (inTycoon) bad.push(`rand01 kanał ${arg}`);
      continue;
    }
    if (inTycoon ? !(channel >= 100 && channel <= 199) : !(channel < 100)) bad.push(`rand01 kanał ${arg}`);
  }
  return bad;
}

// --- Które pliki skanujemy -----------------------------------------------------------------------------------------

/** Wszystkie rodzaje kodu: .ts, .mts, .cts, .js, .mjs, .cjs, .tsx, .jsx. */
const SIM_SOURCE = /\.(m|c)?[jt]sx?$/;
const SIM_TEST = /\.test\.[^/\\]+$/;
const SIM_JSX = /\.[jt]sx$/;
/** Tyle plików produkcyjnych ma dziś src/sim (30); mniej znaczy, że skan nic nie widzi (przeniesiony katalog, zły filtr). */
const MIN_SIM_FILES = 25;

/** Pliki produkcyjne src/sim: testy celowo używają Date, **, Math.hypot itd. do dowodów równoważności. */
function simProductionFiles(): string[] {
  const all = files('src/sim', SIM_SOURCE).map((f) => f.split(sep).join('/'));
  const production = all.filter((f) => !SIM_TEST.test(f));
  expect(
    production.length,
    `skan src/sim znalazł ${production.length} plików produkcyjnych, a oczekuje co najmniej ${MIN_SIM_FILES}: sprawdź katalog i filtr plików`,
  ).toBeGreaterThanOrEqual(MIN_SIM_FILES);
  return production;
}

const SIM_FILE = 'src/sim/economy/x.ts';
const TYCOON_FILE = 'src/sim/economy/tycoon/x.ts';

describe('simViolations: reguły na próbkach', () => {
  it.each<[string, string, string]>([
    [SIM_FILE, "import * as T from 'three';", 'three'],
    [SIM_FILE, "import { Vector3 } from 'three/src/math/Vector3.js';", 'three'],
    [SIM_FILE, "const T = await import('three');", 'three'],
    [SIM_FILE, "import 'three';", 'three'],
    [SIM_FILE, "export * from 'three';", 'three'],
    [SIM_FILE, "const T = require('three');", 'three'],
    [SIM_FILE, 'const T = await import(`three`);', 'three'],
    [SIM_FILE, 'const T = await import(`three/examples/x.js`);', 'three'],
    [SIM_FILE, "const fs = require('node:fs');", 'require'],
    [SIM_FILE, "import fs from 'node:fs';", 'node-import'],
    [SIM_FILE, "import { readFileSync } from 'node:fs';", 'node-import'],
    [SIM_FILE, "import { join } from 'node:path';", 'node-import'],
    [SIM_FILE, "import fs from 'fs';", 'node-import'],
    [SIM_FILE, "import { readFile } from 'fs/promises';", 'node-import'],
    [SIM_FILE, "const fs = await import('node:fs');", 'node-import'],
    [SIM_FILE, 'const r = Math.random();', 'Math.random'],
    [SIM_FILE, 'const r = Math . random();', 'Math.random'],
    [SIM_FILE, 'const d = new Date();', 'Date'],
    [SIM_FILE, 'const t = Date.now();', 'Date'],
    [SIM_FILE, 'const t = performance.now();', 'performance'],
    [SIM_FILE, "const v = localStorage.getItem('x');", 'localStorage'],
    [SIM_FILE, 'const f = window.foo;', 'window'],
    [SIM_FILE, 'const w = typeof window !== "undefined";', 'window'],
    [SIM_FILE, 'const w = cond ? window : null;', 'window'],
    [SIM_FILE, 'const w = cond\n  ? window\n  : null;', 'window'],
    [SIM_FILE, 'const o = { a: window };', 'window'],
    [SIM_FILE, 'const o = { a: 1, window };', 'window'],
    [SIM_FILE, 'const o = { window: window };', 'window'],
    [SIM_FILE, 'const o = { ...window };', 'window'],
    [SIM_FILE, 'const o = [...performance];', 'performance'],
    [SIM_FILE, 'for (const k in window) f(k);', 'window'],
    [SIM_FILE, 'const t = cond ? Date.now() : 0;', 'Date'],
    [SIM_FILE, 'const t = typeof performance === "object";', 'performance'],
    [SIM_FILE, "import { x } from '@/render/y';", 'layer-import'],
    [SIM_FILE, "import { x } from '@/ui/state';", 'layer-import'],
    [SIM_FILE, "import { x } from '@/game/session';", 'layer-import'],
    [SIM_FILE, "import type { S } from '@/game/session';", 'layer-import'],
    [SIM_FILE, "export { x } from '@/ui/y';", 'layer-import'],
    [SIM_FILE, "const m = await import('@/render/y');", 'layer-import'],
    [SIM_FILE, 'const m = await import(`@/render/y`);', 'layer-import'],
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
    // globalThis i self: po wyjęciu dostępu do pola (`.window`, `.performance`) tylko one zdradzają odwołanie do globalu
    [SIM_FILE, 'const w = globalThis.window.foo;', 'globalThis'],
    [SIM_FILE, 'const t = globalThis.performance.now();', 'globalThis'],
    [SIM_FILE, 'const t = globalThis["performance"].now();', 'globalThis'],
    [SIM_FILE, "const t = globalThis['performance'].now();", 'globalThis'],
    [SIM_FILE, 'const t = self.performance.now();', 'self'],
    [SIM_FILE, 'const w = self.window;', 'self'],
    // `global` w Node to to samo co `globalThis`: `global.Date` zostaje po wyjęciu pola, więc zdradza je tylko ta nazwa
    [SIM_FILE, 'global.Date.now()', 'global'],
    [SIM_FILE, 'global.performance', 'global'],
    [SIM_FILE, 'const t = global.performance.now();', 'global'],
    [SIM_FILE, 'const t = cond ? global : null;', 'global'],
    // losowość, locale, zegary, sieć i środowisko (determinizm odtworzenia biegu między przeglądarką a serwerem)
    [SIM_FILE, 'const id = crypto.randomUUID();', 'crypto'],
    [SIM_FILE, 'crypto.getRandomValues(new Uint8Array(4));', 'crypto'],
    [SIM_FILE, 'names.sort((a, b) => a.localeCompare(b));', 'localeCompare'],
    [SIM_FILE, 'const c = a?.localeCompare(b);', 'localeCompare'],
    [SIM_FILE, 'const k = name.toLocaleLowerCase();', 'toLocaleLowerCase'],
    [SIM_FILE, 'const k = name.toLocaleUpperCase("pl");', 'toLocaleUpperCase'],
    [SIM_FILE, "const f = new Intl.NumberFormat('pl-PL');", 'Intl'],
    [SIM_FILE, 'const c = new Intl.Collator();', 'Intl'],
    [SIM_FILE, 'setTimeout(f, 10);', 'setTimeout'],
    [SIM_FILE, 'setTimeout(f);', 'setTimeout'],
    [SIM_FILE, 'const h = setInterval(f, 10);', 'setInterval'],
    [SIM_FILE, 'requestAnimationFrame(tick);', 'requestAnimationFrame'],
    [SIM_FILE, 'queueMicrotask(f);', 'queueMicrotask'],
    [SIM_FILE, 'const r = await fetch(u);', 'fetch'],
    [SIM_FILE, 'fetch(u);', 'fetch'],
    [SIM_FILE, 'const el = document.createElement("div");', 'document'],
    [SIM_FILE, 'const ua = navigator.userAgent;', 'navigator'],
    [SIM_FILE, 'sessionStorage.setItem("a", "b");', 'sessionStorage'],
    [SIM_FILE, 'const db = indexedDB.open("x");', 'indexedDB'],
    [SIM_FILE, 'const home = process.env.HOME;', 'process'],
    [SIM_FILE, 'const m = require(name);', 'require'],
    // literały, które ukrywały kod: szablon z `"…"` wokół podstawienia, regex z `/` w środku
    [SIM_FILE, 'const s = `"${Date.now()}"`;', 'Date'],
    [SIM_FILE, 'const s = `a "${Date.now()}" b`;', 'Date'],
    [SIM_FILE, "const s = `a '${Date.now()}' b`;", 'Date'],
    [SIM_FILE, 'const s = `${`${Date.now()}`}`;', 'Date'],
    [SIM_FILE, 'const s = `${f({ x: Date.now() })}`;', 'Date'],
    [SIM_FILE, "const s = `${'}'}${Date.now()}`;", 'Date'],
    [SIM_FILE, 'const s = `a\\`b${Date.now()}`;', 'Date'],
    [SIM_FILE, 'const re = /a\\//; const r = Math.random();', 'Math.random'],
    [SIM_FILE, '/a\\//; Math.random()', 'Math.random'],
    [SIM_FILE, 'const r = /[/*]/; Math.random();', 'Math.random'],
    [SIM_FILE, '/[/*]/; Math.random(); /* x */', 'Math.random'],
    [SIM_FILE, 'const r = /"/; const t = Date.now();', 'Date'],
    [SIM_FILE, "const r = /'/g; const t = Date.now();", 'Date'],
    [SIM_FILE, 'const r = /`/; const t = Date.now();', 'Date'],
    [SIM_FILE, 'if (x) { return /a/.test(s) && Math.random(); }', 'Math.random'],
    [SIM_FILE, 'const ok = [/a/, /b\\//].some((re) => re.test(s)) && Date.now();', 'Date'],
    // dzielenie nie jest regexem: kod po nim nie może zniknąć
    [SIM_FILE, 'const h = (a + b) / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = xs[0] / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = a / b; const r = Math.random(); const q = c / d;', 'Math.random'],
    [SIM_FILE, 'const h = i++ / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = `${a}` / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    // `!` po wartości to asercja nie-null, nie negacja: `/` za nią dalej jest dzieleniem (inaczej `/ ys[j]!; Math.random(); const q = a /` byłoby regexem)
    [SIM_FILE, 'xs[i]! / ys[j]!; Math.random(); const q = a / b;', 'Math.random'],
    [SIM_FILE, 'm.get(k)! / 2; const t = Date.now(); const q = c / 3;', 'Date'],
    [SIM_FILE, 'const h = x! / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = a.b!.c! / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    // słowo kluczowe jako nazwa pola (po `.` albo `?.`) to identyfikator, więc kończy wartość: `cfg.of / 2`
    [SIM_FILE, 'cfg.of / 2; Math.random(); c / 3', 'Math.random'],
    [SIM_FILE, 'const h = cfg.in / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = a.new / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = b.delete / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = cfg?.of / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = cfg\n  .of / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = this.#of / 2; const r = Math.random(); const q = c / 3;', 'Math.random'],
    [SIM_FILE, 'const h = a / 2; // 2 / 3\nconst r = Math.random();', 'Math.random'],
    // `//` w literale tekstowym nie jest komentarzem, więc nie chowa reszty linii
    [SIM_FILE, "const u = 'http://x'; const r = Math.random();", 'Math.random'],
    [SIM_FILE, 'const u = "http://x"; const r = Math.random();', 'Math.random'],
    [SIM_FILE, 'const u = `//${Date.now()}`;', 'Date'],
    [SIM_FILE, String.raw`const s = '\\'; const r = Math.random();`, 'Math.random'],
    [SIM_FILE, String.raw`const s = '\''; const r = Math.random();`, 'Math.random'],
    [SIM_FILE, String.raw`const s = "\""; const r = Math.random();`, 'Math.random'],
    // niedomknięty literał w linii nie zjada reszty pliku
    [SIM_FILE, "const s = 'oops;\nconst r = Math.random();", 'Math.random'],
    // crowd/ i nav/ są zwolnione tylko z matematyki
    ['src/sim/crowd/x.ts', 'const t = Date.now();', 'Date'],
    ['src/sim/crowd/x.ts', 'const r = Math.random();', 'Math.random'],
    ['src/sim/crowd/x.ts', 'const id = crypto.randomUUID();', 'crypto'],
    ['src/sim/crowd/x.ts', 'a.localeCompare(b);', 'localeCompare'],
    ['src/sim/nav/x.ts', "import { x } from '@/game/session';", 'layer-import'],
    ['src/sim/nav/x.ts', 'const f = window.foo;', 'window'],
    ['src/sim/nav/x.ts', 'setTimeout(f);', 'setTimeout'],
    ['src/sim/economy/crowd/x.ts', 'const a = Math.atan2(1, 2);', 'trig'],
    // moduły strumienia C podlegają tym samym zakazom
    [TYCOON_FILE, 'const t = Date.now();', 'Date'],
    [TYCOON_FILE, 'const id = crypto.randomUUID();', 'crypto'],
    [TYCOON_FILE, 'cards.sort((a, b) => a.name.localeCompare(b.name));', 'localeCompare'],
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
    [SIM_FILE, "/* import 'three'; require('node:fs'); fetch(u); */ const x = 1;"],
    [SIM_FILE, 'const update = 1;'],
    [SIM_FILE, 'const dates = [1]; const Dates = 2; const toDateString = 3;'],
    // 'window' to w sklepie typ komórki (CellType), a nie obiekt przeglądarki
    [SIM_FILE, "type CellType = 'wall' | 'window' | 'floor'; const t: CellType = 'window';"],
    [SIM_FILE, "const GLYPH = { wall: '#', window: 'W', floor: '.' };"],
    [SIM_FILE, 'const ALLOWED: Record<string, true> = {\n  wall: true,\n  window: true,\n  floor: true,\n};'],
    [SIM_FILE, 'interface Cell { kind: number; window: boolean }'],
    [SIM_FILE, "const msg = 'Date, performance i localStorage w tekście'; const bold = '**x**';"],
    [SIM_FILE, 'const windowSize = 3; const performanceScore = 4; const mywindow = 5;'],
    // zwykłe nazwy własne: pole, klucz, pole interfejsu i parametr z adnotacją, dostęp do pola (§6.5, ranking)
    [SIM_FILE, 'const p = staff.performance;'],
    [SIM_FILE, 'const p = staff?.performance ?? 0;'],
    [SIM_FILE, 'const p = a.b\n  .performance;'],
    [SIM_FILE, 'const w = season.window.start;'],
    [SIM_FILE, 'const w = GLYPH.window;'],
    [SIM_FILE, 'const s = { performance: 0.8 };'],
    [SIM_FILE, 'const s = { staff: 1, performance: 0.8, window: 3 };'],
    [SIM_FILE, 'const s = {\n  performance: 0.8,\n  window: 3,\n};'],
    [SIM_FILE, 'const { performance: perf } = staff;'],
    [SIM_FILE, 'interface Worker { performance: number }'],
    [SIM_FILE, 'interface Worker { name: string; performance: number }'],
    [SIM_FILE, 'interface Cell {\n  window?: boolean\n}'],
    [SIM_FILE, 'interface X {\n  a: number\n  window: boolean\n}'],
    [SIM_FILE, 'interface X { window?: boolean }'],
    [SIM_FILE, 'interface X { a: number\n  window: boolean }'],
    [SIM_FILE, 'type Season = { window: number; Date: string };'],
    [SIM_FILE, 'function f(performance: number) {}'],
    [SIM_FILE, 'function score(performance: number): number { return 1; }'],
    [SIM_FILE, 'const g = (a: number, window: number) => a;'],
    [SIM_FILE, 'const g = (window?: number) => 1;'],
    [SIM_FILE, 'class A { private window: number = 1; readonly Date: string = ""; #performance = 1; }'],
    [SIM_FILE, 'class A { m() { return this.#performance; } }'],
    // szablony: tekst poza `${…}` nie jest kodem
    [SIM_FILE, 'const s = `**${a}**`;'],
    [SIM_FILE, 'const s = `Date: ${d}`;'],
    [SIM_FILE, 'const s = `Okno window: ${a}`;'],
    [SIM_FILE, 'const s = `Math.random() i crypto, fetch(u), setTimeout(f), localeCompare`;'],
    [SIM_FILE, 'const s = `a ${b} Date ${c.window} performance ${d}`;'],
    [SIM_FILE, 'const s = `${`**${a}**`}`;'],
    [SIM_FILE, "const s = `${'Date'} i ${\"window\"}`;"],
    [SIM_FILE, 'const s = `a\\`Date\\`b`;'],
    // regexy: treść nie jest kodem
    [SIM_FILE, 'const re = /Date|window|performance/g;'],
    [SIM_FILE, 'const re = /a\\//;'],
    [SIM_FILE, 'const re = /[/*]/; const x = 1; /* Date */'],
    [SIM_FILE, 'const re = /Math\\.random()/;'],
    [SIM_FILE, 'const re = /\\*\\*/;'],
    [SIM_FILE, "const a = s.replace(/'/g, '').split(/\\s*,\\s*/);"],
    [SIM_FILE, 'const half = (a + b) / 2; const third = c / 3;'],
    // asercja nie-null przed dzieleniem; komentarz po niej dalej jest komentarzem
    [SIM_FILE, 'xs[0]! / 2; // Date w komentarzu'],
    [SIM_FILE, 'const h = a.b!.c! / 2; // Date.now()\nconst q = c / 3; // Math.random()'],
    // `!` poza pozycją po wartości to negacja albo `!=`/`!==`: regex za nią dalej jest regexem, nie dzieleniem
    [SIM_FILE, 'const ok = !/Date|window/.test(s);'],
    [SIM_FILE, 'if (a && !/Math.random()/.test(s)) f();'],
    [SIM_FILE, 'const ok = x != /Date/.test(s);'],
    [SIM_FILE, 'const ok = xs[0] !== /Date/.test(s);'],
    // słowo kluczowe jako pole nie zamienia dzielenia w regex; prawdziwe `of`/`in` przed regexem nadal go zaczynają
    [SIM_FILE, 'const h = cfg.of / 2; // Date w komentarzu'],
    [SIM_FILE, 'for (const m of /Date/g.exec(s) ?? []) f(m);'],
    [SIM_FILE, 'for (const k in /Date/g.exec(s) ?? {}) f(k);'],
    // typeof Math nic nie woła
    [SIM_FILE, 'type MathLike = typeof Math;'],
    [SIM_FILE, 'const ok = typeof Math !== "undefined";'],
    [SIM_FILE, 'const s = Math.sqrt(4);'],
    [SIM_FILE, 'const f = Math.floor(1.5);'],
    [SIM_FILE, 'const n = Math.abs(-1) + Math.min(1, 2) + Math.max(1, 2) + Math.round(1.5) + Math.trunc(2.5) + Math.ceil(0.1);'],
    [SIM_FILE, 'const n = Math.sign(-2) + Math.imul(3, 4);'],
    [SIM_FILE, 'const m = a * b * c;'],
    // tekst wyświetlany jest dozwolony (nie trafia do stanu); jego strażnikiem jest test podmiany w run.test.ts
    [SIM_FILE, "const label = n.toLocaleString('pl-PL');"],
    [SIM_FILE, 'const sorted = [...names].sort();'],
    [SIM_FILE, 'const eq = a === b || a < b;'],
    [SIM_FILE, "import { rand01 } from './rand';"],
    [SIM_FILE, "import type { StoreInfo } from '../store/types';"],
    [SIM_FILE, "import { x } from '@/sim/rng';"],
    [SIM_FILE, "import x from 'threejs-thing';"],
    [SIM_FILE, "import { x } from './fs';"],
    [SIM_FILE, "import { x } from './node:fs';"],
    [SIM_FILE, 'const path = "node:fs";'],
    [SIM_FILE, "const t = 'process, fetch(u)';"],
    [SIM_FILE, 'const requirement = 1; const processed = 2; const fetched = 3; const selfie = 4;'],
    // względna ścieżka, która zostaje w src/sim, nie jest wejściem do warstwy game
    [SIM_FILE, "import { x } from '../game/x';"],
    ['src/sim/crowd/x.ts', 'const a = Math.atan2(1, 2);'],
    ['src/sim/nav/x.ts', 'const d = Math.hypot(1, 2) + Math.sin(0) + 2 ** 3;'],
    [TYCOON_FILE, 'const s = { performance: 0.8, window: 3 }; const p = staff.performance;'],
  ])('%s: %s -> brak naruszeń', (path, code) => {
    expect(simViolations(path, code)).toEqual([]);
  });

  it('zwraca każdą złamaną regułę raz, w stałej kolejności', () => {
    const code = 'Math.random(); Math.random(); Date.now(); Date.now(); 2 ** 3;';
    expect(simViolations(SIM_FILE, code)).toEqual(['Math.random', 'Date', '**']);
  });
});

const ACTIONS_FILE = 'src/game/actions.ts';
const FRAME_FILE = 'src/game/frame.ts';

describe('nodeTestableViolations: actions.ts i frame.ts bez importów wartości z three, renderera i sceny (próbki)', () => {
  it.each<[string, string, string[]]>([
    [ACTIONS_FILE, "import * as THREE from 'three';", ['three']],
    [ACTIONS_FILE, "import { Vector3 } from 'three/src/math/Vector3.js';", ['three/src/math/Vector3.js']],
    [ACTIONS_FILE, "import { loadStore } from '@/render/game/loadedStore';", ['@/render/game/loadedStore']],
    [ACTIONS_FILE, "import { renderer } from '../render/renderer';", ['../render/renderer']],
    [ACTIONS_FILE, "import { SceneHost } from './scene';", ['./scene']],
    [ACTIONS_FILE, "import { SceneHost } from './scene.ts';", ['./scene.ts']],
    [ACTIONS_FILE, "import { SceneHost } from '@/game/scene';", ['@/game/scene']],
    [FRAME_FILE, "import { createScene } from './scene';", ['./scene']],
    [FRAME_FILE, "import * as THREE from 'three';", ['three']],
    // mieszany import niesie wartość, choć część nazw to typy
    [ACTIONS_FILE, "import { type SceneHost, createScene } from './scene';", ['./scene']],
    [ACTIONS_FILE, "import Scene, { type SceneHost } from './scene';", ['./scene']],
    [ACTIONS_FILE, "import {\n  type A,\n  b,\n} from '@/render/y';", ['@/render/y']],
    // nazwy, które tylko zaczynają się od `type`, i domyślny import o nazwie `type`
    [ACTIONS_FILE, "import typeOf from './scene';", ['./scene']],
    [ACTIONS_FILE, "import { typeA } from './scene';", ['./scene']],
    [ACTIONS_FILE, "import type from './scene';", ['./scene']],
    [ACTIONS_FILE, "import {} from './scene';", ['./scene']],
    // wejścia bez klauzuli i re-eksporty
    [ACTIONS_FILE, "import './scene';", ['./scene']],
    [ACTIONS_FILE, "const m = await import('./scene');", ['./scene']],
    [ACTIONS_FILE, 'const m = await import(`@/render/y`);', ['@/render/y']],
    [ACTIONS_FILE, "const T = require('three');", ['three']],
    [ACTIONS_FILE, "export { SceneHost } from './scene';", ['./scene']],
    [ACTIONS_FILE, "export * from '@/render/y';", ['@/render/y']],
    // typ obok wartości: tylko wartość się liczy; ten sam specyfikator raz
    [ACTIONS_FILE, "import type { A } from './scene';\nimport { b } from '@/render/y';\nimport { c } from '@/render/y';", ['@/render/y']],
    [ACTIONS_FILE, "import * as T from 'three'; import { x } from './scene';", ['three', './scene']],
  ])('%s: %s -> %j', (path, code, expected) => {
    expect(nodeTestableViolations(path, code)).toEqual(expected);
  });

  it.each<[string, string]>([
    [ACTIONS_FILE, "import type { SceneHost } from './scene';"],
    [ACTIONS_FILE, "import type { ScenePick } from './scene';\nimport type { RenderContext } from '@/render/renderer';"],
    [ACTIONS_FILE, "import type * as THREE from 'three';"],
    [ACTIONS_FILE, "import type Scene from '@/game/scene';"],
    [ACTIONS_FILE, "import { type SceneHost } from './scene';"],
    [ACTIONS_FILE, "import { type A, type B } from '@/render/y';"],
    [ACTIONS_FILE, "import {\n  type A,\n  type B,\n} from '@/render/y';"],
    [ACTIONS_FILE, "export type { SceneHost } from './scene';"],
    [ACTIONS_FILE, "export type * from '@/render/y';"],
    [ACTIONS_FILE, "type Loader = typeof import('@/render/game/loadedStore');"],
    [FRAME_FILE, "import type { SceneHost } from './scene';\nimport { advanceEconomy } from '@/sim/economy/clock';"],
    // inne moduły: symulacja, interfejs, sąsiednie pliki gry, pakiety o podobnej nazwie
    [ACTIONS_FILE, "import { applyCommand } from '@/sim/economy/commands';\nimport * as ui from '@/ui/state';"],
    [ACTIONS_FILE, "import { openStore } from './openStore';\nimport { saveSession } from './session';"],
    [ACTIONS_FILE, "import { x } from './scenery';\nimport { y } from './scene-pick';\nimport { z } from '@/game/scenes/y';"],
    [ACTIONS_FILE, "import x from 'three-stdlib';\nimport y from 'threejs-thing';"],
    [ACTIONS_FILE, "import { x } from '@/rendering/y';"],
    // komentarze i literały nie są importami
    [ACTIONS_FILE, "// import { SceneHost } from './scene';\nconst x = 1;"],
    [ACTIONS_FILE, "const s = \"import { SceneHost } from './scene'\";"],
    // pliki spoza listy mogą importować scenę i three (scene.ts, main.ts, ...)
    ['src/game/scene.ts', "import * as THREE from 'three';\nimport { loadStore } from '@/render/game/loadedStore';"],
    ['src/game/controls.ts', "import { MathUtils } from 'three';"],
    ['src/main.ts', "import { createScene } from '@/game/scene';"],
    ['src/game/actions.test.ts', "import { FakeScene } from './scene';"],
  ])('%s: %s -> brak naruszeń', (path, code) => {
    expect(nodeTestableViolations(path, code)).toEqual([]);
  });
});

describe('channelViolations: kanały rand01 na próbkach', () => {
  it.each<[string, string]>([
    [SIM_FILE, 'rand01(h, a, 100)'],
    [SIM_FILE, 'rand01(h, a, 105)'],
    [SIM_FILE, 'rand01(h, a, 0x64)'],
    [SIM_FILE, 'rand01(h, a, 1_000)'],
    [SIM_FILE, 'const r = rand01(s.seedHash, Math.floor(f(x, y)), 150);'],
    [SIM_FILE, 'rand01(h,\n  a,\n  150,\n)'],
    ['src/sim/store/x.ts', 'rand01(h, a, 199)'],
    [TYCOON_FILE, 'rand01(h, a, 99)'],
    [TYCOON_FILE, 'rand01(h, a, 7)'],
    [TYCOON_FILE, 'rand01(h, a, 0)'],
    [TYCOON_FILE, 'rand01(h, a, 200)'],
    [TYCOON_FILE, 'rand01(h, a, -1)'],
    ['src/sim/economy/tycoon/cards/x.ts', 'rand01(h, a, 30)'],
    // w tycoon/ kanał musi dać się sprawdzić: bez kanału to kanał 0 ekonomii, a wyrażenie albo obca stała to niewiadoma
    [TYCOON_FILE, 'rand01(h, a)'],
    [TYCOON_FILE, 'rand01(h, a, CARD_CHANNEL)'],
    [TYCOON_FILE, 'rand01(h, a, CH.nieMaTakiego)'],
    [TYCOON_FILE, 'rand01(h, a, CH.cardPick + 1)'],
    [TYCOON_FILE, 'rand01(h, a, CH["cardPick"])'],
    [TYCOON_FILE, 'rand01(h, a, CH.toString)'],
    // stała z rejestru tycoona poza tycoon/ to kanał ≥ 100
    [SIM_FILE, 'rand01(h, a, CH.cardPick)'],
  ])('%s: %s -> złamany kanał', (path, code) => {
    expect(channelViolations(path, code)).toHaveLength(1);
  });

  it.each<[string, string]>([
    [SIM_FILE, 'rand01(h, a)'],
    [SIM_FILE, 'rand01(h, a, 0)'],
    [SIM_FILE, 'rand01(h, a, 99)'],
    [SIM_FILE, 'rand01(h, a, 30)'],
    [SIM_FILE, 'rand01(h, f(a, 150), 7)'],
    [SIM_FILE, 'rand01(h, [1, 150, 160][i], 22)'],
    [SIM_FILE, 'rand01(h, a, CHANNEL)'],
    [SIM_FILE, 'rand01(h, a, base + 150)'],
    [SIM_FILE, 'rand01(h, a, channelFor(150))'],
    [SIM_FILE, 'export function rand01(seedHash: number, a: number, b = 150): number {}'],
    [SIM_FILE, "import { rand01 } from './rand';"],
    [SIM_FILE, 'const r = rand01;'],
    [SIM_FILE, '// rand01(h, a, 150)'],
    [SIM_FILE, "const s = 'rand01(h, a, 150)';"],
    [SIM_FILE, 'const s = `rand01(h, a, 150)`;'],
    [SIM_FILE, 'rand01(h, a, 99); rand01(h, b)'],
    [TYCOON_FILE, 'rand01(h, a, 100)'],
    [TYCOON_FILE, 'rand01(h, a, 150)'],
    [TYCOON_FILE, 'rand01(h, a, 199)'],
    [TYCOON_FILE, 'rand01(h, a, CH.cardPick)'],
    [TYCOON_FILE, 'rand01(h, a, CH . weather)'],
    [TYCOON_FILE, 'rand01(h, a, 100); rand01(h, b, 199)'],
    // katalog o podobnej nazwie to nie moduły strumienia C
    ['src/sim/economy/tycoonish/x.ts', 'rand01(h, a, 50)'],
  ])('%s: %s -> brak naruszeń', (path, code) => {
    expect(channelViolations(path, code)).toEqual([]);
  });

  it('rejestr CH: każdy kanał w zakresie 100–199', () => {
    for (const [name, value] of Object.entries(CH)) expect(channelViolations(TYCOON_FILE, `rand01(h, a, CH.${name})`), name).toEqual([]);
    expect(Object.values(CH).every((v) => v >= 100 && v <= 199)).toBe(true);
  });

  it('liczy każde wywołanie osobno', () => {
    expect(channelViolations(SIM_FILE, 'rand01(h, a, 100); rand01(h, a, 5); rand01(h, a, 200)')).toEqual(['rand01 kanał 100', 'rand01 kanał 200']);
  });
});

describe('które pliki src/sim są skanowane', () => {
  it.each(['a.ts', 'a.mts', 'a.cts', 'a.js', 'a.mjs', 'a.cjs', 'a.tsx', 'a.jsx', 'src/sim/economy/a.d.ts'])('%s: tak', (name) => {
    expect(SIM_SOURCE.test(name) && !SIM_TEST.test(name)).toBe(true);
  });

  it.each(['a.test.ts', 'a.test.mjs', 'src/sim/economy/a.test.tsx', 'a.json', 'a.snap', 'a.md', 'a.tsv', 'a.tsx.snap'])('%s: nie', (name) => {
    expect(SIM_SOURCE.test(name) && !SIM_TEST.test(name)).toBe(false);
  });
});

describe('architektura', () => {
  it('src/sim: bez three, zegara, przeglądarki, node, warstw wyżej i matematyki zależnej od silnika', () => {
    const offenders = simProductionFiles().flatMap((f) =>
      simViolations(f, readFileSync(f, 'utf8')).map((rule) => `${f}: ${rule}`),
    );
    expect(offenders).toEqual([]);
  });

  it('src/game/actions.ts i frame.ts: bez importów wartości z three, renderera i sceny (zostają testowalne w node)', () => {
    const offenders = NODE_TESTABLE_FILES.flatMap((f) =>
      nodeTestableViolations(f, readFileSync(f, 'utf8')).map((specifier) => `${f}: import wartości z '${specifier}' (użyj \`import type\`)`),
    );
    expect(offenders).toEqual([]);
  });

  it('src/sim: kanały rand01 poza tycoon/ poniżej 100, w tycoon/ w zakresie 100–199', () => {
    const offenders = simProductionFiles().flatMap((f) =>
      channelViolations(f, readFileSync(f, 'utf8')).map((violation) => `${f}: ${violation}`),
    );
    expect(offenders).toEqual([]);
  });

  it('src/sim nie zawiera plików .tsx ani .jsx', () => {
    expect(files('src/sim', SIM_JSX)).toEqual([]);
  });

  it('każdy plik .glb w public/assets ma wpis w public/assets/LICENSES.md', () => {
    const licenses = readFileSync('public/assets/LICENSES.md', 'utf8');
    const glbs = files('public/assets', /\.glb$/).map((f) => basename(f));
    expect(glbs.length).toBeGreaterThan(0);
    // nazwa w komórce tabeli z backtickami: `men-suit.glb` nie może przejść dzięki `women-suit.glb`
    const missing = glbs.filter((name) => !licenses.includes('`' + name + '`'));
    expect(missing).toEqual([]);
  });
});
