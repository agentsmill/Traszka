import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Arkusz stylów Miasta nie ma testu układu w node (bez przeglądarki), więc to, co smoke na 390 px wyłapał, przypinamy tu: przyciski sposobu
 * zapłaty na karcie wolnego lokalu muszą się łamać, bo angielski napis raty nie mieści się w jednym wierszu (wylew 26 px za przycisk).
 */
const css = readFileSync(new URL('./city.css', import.meta.url), 'utf8');

/** Treść reguły o dokładnie takim selektorze (bez zagnieżdżeń). */
function rule(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`brak reguły ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

describe('city.css: karta lokalu na 390 px', () => {
  it('przyciski „za gotówkę” i „na raty” łamią wiersz (white-space: normal), bo `.tt-btn` ma nowrap', () => {
    expect(rule('.tt-lotpay .tt-btn')).toMatch(/white-space:\s*normal/);
    const ui = readFileSync(new URL('../ui.css', import.meta.url), 'utf8');
    expect(ui).toMatch(/\.tt-btn \{[^}]*white-space:\s*nowrap/);   // powód, dla którego reguła jest potrzebna
  });

  it('profil godzinowy jest płynny (width: 100%, height: auto), a nagłówek z legendą i blok „po Traszce” łamią wiersz', () => {
    expect(rule('.tt-hours-svg')).toMatch(/width:\s*100%/);
    expect(rule('.tt-hours-svg')).toMatch(/height:\s*auto/);
    expect(rule('.tt-hours-head')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.tt-hours-legend')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.tt-relet')).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('city.css: pinezka lokalu obok na telefonie', () => {
  it('do 899 px napis „lokal obok” znika, a kartka zostaje (napis zachodziłby na sąsiednie pinezki)', () => {
    const at = css.indexOf('@media (max-width: 899px) {');
    expect(at).toBeGreaterThan(-1);
    const phone = css.slice(at, css.indexOf('\n}\n', at));   // treść bloku telefonu bez reguł poza nim
    expect(phone).toMatch(/\.tt-cpin-obok \.tt-cpin-label \{\s*display:\s*none;?\s*\}/);
    expect(phone).not.toMatch(/\.tt-cpin-obok \{[^}]*display:\s*none/);
  });
});
