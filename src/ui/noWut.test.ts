import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AnswerInstance } from '@/sim/economy/tycoon/cards';
import { CIRCULARS, DECK } from '@/sim/economy/tycoon/deck';
import { HINT_IDS, REPORT_LINE_LABEL, hintText } from '@/sim/economy/tycoon/report';
import { deltaLines } from './game/cardText';
import { jsxTexts, stringLiterals } from './game/sourceLiterals';
import { howToDetails, howToPoints } from './howto/howToText';

/*
 * Strażnik słownictwa (poprawki po graniu właściciela, 29.10.2026): gracz nie zna skrótu WUT, więc w tekstach dla niego mówimy
 * „ubytki”, „ubytki ponad limit Centrali” i „limit ubytków”. Nazwy w kodzie (`WUT`, `wut`, `WUT_LABEL`) zostają, dlatego skan źródeł
 * szuka tylko wielkich liter WUT jako osobnego słowa w literałach napisowych i w tekście JSX, nigdy w identyfikatorach i komentarzach.
 */

const WUT_WORD = /\bwut\b/i;
const root = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

describe('skrót WUT nie trafia do gracza', () => {
  it('żaden tekst instrukcji ani żadna treść karty z talii nie zawiera „WUT”', () => {
    const howTo = [...howToPoints(), ...howToDetails().flatMap((s) => [s.title, ...s.paragraphs])];
    const cards = [...DECK, ...CIRCULARS].flatMap((c) => [c.title, c.text, ...c.answers.flatMap((a) => [a.label, a.result, ...(a.risk ? [a.risk.text] : [])])]);
    expect(howTo.length).toBeGreaterThan(10);
    expect(cards.length).toBeGreaterThan(100);   // skan naprawdę przeszedł przez talię
    expect(howTo.filter((t) => WUT_WORD.test(t))).toEqual([]);
    expect(cards.filter((t) => WUT_WORD.test(t))).toEqual([]);
  });

  it('raport miesięczny (pozycje i wszystkie wskazówki) i skutki kart mówią „ubytki”', () => {
    const labels = Object.values(REPORT_LINE_LABEL);
    expect(REPORT_LINE_LABEL.wut).toBe('Ubytki ponad limit Centrali');
    const hints = HINT_IDS.map((id) => hintText({ id, value: 45_000 }));
    expect(hintText({ id: 'wut', value: 450 })).toContain('Remanent: ubytki ponad limit Centrali 450 zł');
    const answer = (delta: AnswerInstance['delta']): AnswerInstance => ({ delta, mods: [], risk: null });
    const chips = deltaLines(answer({ wut: 120 }), String).map((l) => l.text);
    expect(chips).toEqual(['ubytki +120 zł']);
    expect([...labels, ...hints, ...chips].filter((t) => WUT_WORD.test(t))).toEqual([]);
  });

  it('skan źródeł łapie WUT w literale i w tekście JSX, a omija identyfikatory, klucze i kod', () => {
    const src = "const a = 'WUT ponad próg'; const b = <p>Ubytki (WUT)</p>; const c = WUT.threshold; const d = { wut: 1, k: 'wut' }; if (x > WUT.t && y < 2) {}";
    const hits = [...stringLiterals(src), ...jsxTexts(src)].filter((t) => /\bWUT\b/.test(t));
    expect(hits).toEqual(['WUT ponad próg', 'Ubytki (WUT)']);
  });

  it('żaden literał napisowy ani tekst JSX w interfejsie, talii, raporcie i ekonomii nie zawiera „WUT”', () => {
    const ui = (readdirSync(root('./'), { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => root(`./${f}`));
    const sim = ['economy/economy.ts', 'economy/catalog.ts', 'economy/tycoon/deck.ts', 'economy/tycoon/report.ts', 'economy/tycoon/cards.ts',
      'economy/tycoon/wut.ts', 'economy/tycoon/state.ts'].map((f) => root(`../sim/${f}`));
    const files = [...ui, ...sim, root('../game/meta.ts')];
    expect(ui.length).toBeGreaterThan(10);
    const found: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const t of [...stringLiterals(src), ...jsxTexts(src)]) if (/\bWUT\b/.test(t)) found.push(`${file.split('/src/')[1]}: ${t}`);
    }
    expect(found).toEqual([]);
  });
});
