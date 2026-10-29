/*
 * Pomocnik testów: wyciąga teksty ze źródła TypeScript bez uruchamiania go. Używają go testy „liczby nie są wpisane w treść”
 * (`howToText.test.ts`) i „nigdzie nie ma skrótu WUT” (`noWut.test.ts`); gra go nie importuje.
 */

/**
 * Teksty ze źródła: zawartość literałów napisowych i szablonów (bez fragmentów `${...}`, które są kodem, i bez komentarzy).
 * Mały skaner znaków, bo regex nie radzi sobie z szablonami zagnieżdżonymi w `${...}`.
 */
export function stringLiterals(src: string): string[] {
  const out: string[] = [];
  type Frame = { kind: 'code' | 'tpl'; depth: number };
  const stack: Frame[] = [{ kind: 'code', depth: 0 }];
  let cur = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    const top = stack[stack.length - 1]!;
    if (top.kind === 'tpl') {
      if (c === '\\') cur += src[++i] ?? '';
      else if (c === '`') { out.push(cur); cur = ''; stack.pop(); }
      else if (c === '$' && src[i + 1] === '{') { out.push(cur); cur = ''; stack.push({ kind: 'code', depth: 0 }); i++; }
      else cur += c;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 1;
    } else if (c === "'" || c === '"') {
      let s = '';
      for (i++; i < src.length && src[i] !== c; i++) s += src[i] === '\\' ? src[++i] ?? '' : src[i];
      out.push(s);
    } else if (c === '`') {
      stack.push({ kind: 'tpl', depth: 0 });
      cur = '';
    } else if (c === '{') top.depth++;
    else if (c === '}') {
      if (top.depth === 0 && stack.length > 1) { stack.pop(); cur = ''; } else top.depth--;
    }
  }
  return out;
}

/**
 * Tekst między znacznikami JSX (`<b>tekst</b>`): to też napisy dla gracza, a skaner literałów ich nie widzi. Fragmenty z `;`, `=`, `&`, `|` albo
 * klamrą to kod (strzałki, porównania, warunki), nie tekst.
 */
export function jsxTexts(src: string): string[] {
  return [...src.matchAll(/(?<!=)>([^<>{};=&|]+)</g)].map((m) => m[1]!.trim()).filter((t) => t !== '');
}
