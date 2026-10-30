/*
 * Pomocnik testów tłumaczenia (`tests/i18n.test.ts`): wyciąga ze źródła TypeScript literały napisowe i szablony razem z tym,
 * gdzie stoją. Gra go nie importuje. Skaner znak po znaku, jak w `tests/architecture.test.ts`: komentarze i regexy wycina,
 * a szablon zapisuje z `{}` w miejscu każdego `${…}` (kod podstawień skanuje dalej, więc zagnieżdżone literały też widać).
 */

export interface Literal {
  /** Treść literału; w szablonie każde `${…}` to `{}`. */
  text: string;
  line: number;
  /** Szablon otagowany funkcją `t` (t`…`): tekst tłumaczony w miejscu. */
  tagged: boolean;
  /** Szablon, a nie literał w cudzysłowie. */
  template: boolean;
  /** Literał (lub szablon) leży w kodzie podstawienia otagowanego szablonu t`…${tu}…`. */
  inTagged: boolean;
  /** Wywołanie, w którego argumentach stoi literał, np. `tr` w `tr('…')`, `Error` w `new Error('…')`, `subSeed` w `subSeed(x, '…')`. */
  callee: string | null;
  /** Pole, któremu literał jest przypisany: `name` w `{ name: '…' }` albo w `g.name = '…'`. */
  prop: string | null;
}

const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const isWordChar = (c: string): boolean => /[\w$]/.test(c) || c > '\x7f';

export function scanLiterals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  let line = 1;
  /** Ostatnie słowo i znak przed literałem (do `callee`). */
  let lastWord = '';
  let lastWordEnd = -1;
  const lineAt = (from: number, to: number): void => { for (let k = from; k < to; k++) if (src[k] === '\n') line++; };

  /** Wywołanie, w którego nawiasie stoi literał (także jako drugi argument): wstecz do niedomkniętego `(` w tej samej instrukcji. */
  const calleeAt = (pos: number): string | null => {
    let depth = 0;
    let k = pos - 1;
    for (; k >= 0 && pos - k < 600; k--) {
      const c = src[k]!;
      if (c === ')' || c === ']') depth++;
      else if (c === '(' || c === '[') {
        if (depth === 0) break;
        depth--;
      } else if (depth === 0 && (c === ';' || c === '{' || c === '}' || c === '\n' && /^\s*$/.test(src.slice(k + 1, pos)))) return null;
    }
    if (k < 0 || src[k] !== '(') return null;
    k--;
    while (k >= 0 && /\s/.test(src[k]!)) k--;
    const end = k + 1;
    while (k >= 0 && isWordChar(src[k]!)) k--;
    const word = src.slice(k + 1, end);
    return word === '' ? null : word;
  };

  /** Pole przed literałem: `name: '…'` albo `x.name = '…'`. */
  const propAt = (pos: number): string | null => {
    let k = pos - 1;
    while (k >= 0 && /[ \t]/.test(src[k]!)) k--;
    if (src[k] !== ':' && !(src[k] === '=' && !/[=!<>]/.test(src[k - 1] ?? ''))) return null;
    k--;
    while (k >= 0 && /[ \t]/.test(src[k]!)) k--;
    const end = k + 1;
    while (k >= 0 && isWordChar(src[k]!)) k--;
    return end > k + 1 ? src.slice(k + 1, end) : null;
  };

  function quoted(q: string, inTagged: boolean): void {
    const start = i;
    const from = ++i;
    let text = '';
    while (i < src.length && src[i] !== q && src[i] !== '\n') {
      if (src[i] === '\\') { text += unescape(src[i + 1] ?? ''); i += 2; } else { text += src[i]; i++; }
    }
    void from;
    out.push({ text, line, tagged: false, template: false, inTagged, callee: calleeAt(start), prop: propAt(start) });
    if (src[i] === q) i++;
  }

  function unescape(c: string): string {
    return c === 'n' ? '\n' : c === 't' ? '\t' : c;
  }

  function template(tagged: boolean, inTagged: boolean): void {
    const start = i;
    const startLine = line;
    let text = '';
    i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        text += '{}';
        code(true, inTagged || tagged);
      } else if (src[i] === '\\') {
        text += unescape(src[i + 1] ?? '');
        if (src[i + 1] === '\n') line++;
        i += 2;
      } else {
        if (src[i] === '\n') line++;
        text += src[i];
        i++;
      }
    }
    i++;
    out.push({ text, line: startLine, tagged, template: true, inTagged, callee: tagged ? 't' : calleeAt(start), prop: propAt(start) });
  }

  function skipRegex(): boolean {
    let inClass = false;
    for (let j = i + 1; j < src.length && src[j] !== '\n'; j++) {
      const c = src[j]!;
      if (c === '\\') j++;
      else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        i = j + 1;
        while (i < src.length && isWordChar(src[i]!)) i++;
        return true;
      }
    }
    return false;
  }

  function code(nested: boolean, inTagged: boolean): void {
    let depth = 0;
    let value = false;
    let member = false;
    while (i < src.length) {
      const c = src[i]!;
      const next = src[i + 1];
      if (c === '/' && next === '/') {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (c === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end < 0 ? src.length : end + 2;
        lineAt(i, stop);
        i = stop;
      } else if (c === '"' || c === "'") {
        quoted(c, inTagged);
        value = true;
        member = false;
      } else if (c === '`') {
        const tagged = lastWord === 't' && lastWordEnd === i;
        template(tagged, inTagged);
        value = true;
        member = false;
      } else if (c === '/' && !value && src[i - 1] !== '<' && next !== '>' && skipRegex()) {   // `</b>` i `<br />` w JSX to nie regex
        value = true;
        member = false;
      } else if (isWordChar(c)) {
        let j = i + 1;
        while (j < src.length && isWordChar(src[j]!)) j++;
        const word = src.slice(i, j);
        lastWord = word;
        lastWordEnd = j;
        i = j;
        value = member || !REGEX_AFTER.has(word);
        member = false;
      } else if (/\s/.test(c)) {
        if (c === '\n') line++;
        i++;
      } else if ((c === '+' || c === '-') && next === c) {
        i += 2;
      } else if ((c === '!' && value && next !== '=') || c === '#') {
        i++;
      } else {
        if (c === '}' && nested && depth === 0) {
          i++;
          return;
        }
        depth += c === '{' ? 1 : c === '}' ? -1 : 0;
        value = c === ')' || c === ']';
        member = c === '.' && src[i - 1] !== '.';
        i++;
      }
    }
  }

  code(false, false);
  return out;
}

/** Polskie litery: najpewniejszy znak, że napis jest dla gracza (identyfikatory i klasy CSS ich nie mają). */
export const PL_CHARS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/**
 * Tekst między znacznikami JSX (`<b>tekst</b>`), z numerem linii. Fragmenty z `;`, `=`, `&`, `|`, klamrą albo bez litery to kod
 * albo same liczby i symbole (jak w `jsxTexts` z `src/ui/game/sourceLiterals.ts`).
 */
export function jsxTextsWithLines(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  // komentarze `// …` na końcu linii zamieniamy na spacje (z zachowaniem długości, więc numery linii się zgadzają)
  const code = src.replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, lead: string) => lead + ' '.repeat(m.length - lead.length));
  for (const m of code.matchAll(/(?<!=)>([^<>{};=&|]+)</g)) {
    const text = m[1]!.trim();
    if (text === '' || !/\p{L}{2,}/u.test(text)) continue;
    if (/^[)\]:?,]/.test(text)) continue;   // kod między `>` z JSX a `<` następnego znacznika (`)}`, `: <p>`), nie tekst
    const line = code.slice(0, m.index).split('\n').length;
    out.push({ text, line });
  }
  return out;
}
