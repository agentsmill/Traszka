import { describe, expect, it } from 'vitest';
import type { AnswerInstance, CardDelta, CardMod } from '@/sim/economy/tycoon/cards';
import { deltaLines, type DeltaLine, type Tone } from './cardText';

/** Formatowanie liczb w testach: bez separatorów, żeby napisy były przewidywalne (w grze podaje je interfejs po polsku). */
const fmt = (n: number): string => String(n);

/** Same napisy wierszy (ocenę kolorem sprawdzają osobne testy niżej). */
const lineTexts = (a: AnswerInstance, f: (n: number) => string): string[] => deltaLines(a, f).map((l) => l.text);
const toned = (a: AnswerInstance): [string, Tone][] => deltaLines(a, fmt).map((l: DeltaLine) => [l.text, l.tone]);

const answer = (delta: CardDelta, extra: Partial<AnswerInstance> = {}): AnswerInstance => ({ delta, mods: [], risk: null, ...extra });
const mod = (kind: CardMod['kind'], value: number, minutes: number, estimate: number): CardMod => ({ kind, value, minutes, from: null, estimate });

describe('deltaLines: skutki odpowiedzi na karcie', () => {
  it('mandat ze znakiem minus (U+2212) i „zł”', () => {
    expect(lineTexts(answer({ fine: -300 }), fmt)).toContain('−300 zł');
  });

  it('pieniądze: koszt, premia, mandat i logistyka mają własne wiersze ze znakiem', () => {
    expect(lineTexts(answer({ cash: -120, bonus: 500, fine: -300, logistics: -80 }), fmt)).toEqual(['−120 zł', '+500 zł', '−300 zł', '−80 zł']);
    expect(lineTexts(answer({ cash: 90 }), fmt)).toEqual(['+90 zł']);
  });

  it('zaufanie, WUT, czas ludzi, siły, reputacja i Ogonki', () => {
    expect(lineTexts(answer({ trust: 2, wut: 120, staffMinutes: 45, energy: -60, reputation: -1.5, ogonki: 3 }), fmt)).toEqual([
      'zaufanie +2', 'WUT +120 zł', 'czas ludzi 45 min', 'siły −60', 'reputacja −1.5', 'Ogonki +3',
    ]);
    expect(lineTexts(answer({ trust: -1, wut: -50, energy: 10 }), fmt)).toEqual(['zaufanie −1', 'WUT −50 zł', 'siły +10']);
  });

  it('liczby idą przez podaną funkcję formatującą (interfejs: polski zapis z odstępem tysięcy)', () => {
    const pl = (n: number): string => n.toLocaleString('pl-PL');
    expect(lineTexts(answer({ cash: -12_500 }), pl)).toEqual([`−${(12_500).toLocaleString('pl-PL')} zł`]);
    expect(lineTexts(answer({ trust: 0.5 }), pl)).toEqual([`zaufanie +${(0.5).toLocaleString('pl-PL')}`]);
  });

  it('odpowiedź bez skutków (np. „nic nie robię”) nie ma żadnych wierszy', () => {
    expect(lineTexts(answer({}), fmt)).toEqual([]);
    expect(lineTexts(answer({ cash: 0, trust: 0 }), fmt)).toEqual([]);   // zera nic nie mówią
  });

  it('ryzyko: szansa w procentach i skutek, który dojdzie', () => {
    const lines = lineTexts(answer({}, { risk: { chance: 0.3, delta: { fine: -300 } } }), fmt);
    expect(lines).toEqual(['ryzyko 30%: −300 zł']);
    expect(lineTexts(answer({ cash: -50 }, { risk: { chance: 0.76, delta: { wut: 90, trust: -2 } } }), fmt))
      .toEqual(['−50 zł', 'ryzyko 76%: zaufanie −2, WUT +90 zł']);
  });

  it('ryzyko bez skutku liczbowego dalej pokazuje szansę, a ryzyko zerowe znika', () => {
    expect(lineTexts(answer({}, { risk: { chance: 0.5, delta: {} } }), fmt)).toEqual(['ryzyko 50%']);
    expect(lineTexts(answer({}, { risk: { chance: 0, delta: { fine: -300 } } }), fmt)).toEqual([]);
    expect(lineTexts(answer({}, { risk: { chance: 0.002, delta: { fine: -300 } } }), fmt)).toEqual(['ryzyko 1%: −300 zł']);   // nie „0%”
  });

  it('efekty na czas: szacunek „ok. ±n zł” z mods[].estimate', () => {
    expect(lineTexts(answer({}, { mods: [mod('traffic', 0.3, 120, 240)] }), fmt)).toEqual(['ok. +240 zł']);
    expect(lineTexts(answer({ cash: -50 }, { mods: [mod('margin', -0.1, 1440, -180)] }), fmt)).toEqual(['−50 zł', 'ok. −180 zł']);
  });

  it('kilka efektów daje jeden wspólny szacunek, a szacunek zerowy znika', () => {
    expect(lineTexts(answer({}, { mods: [mod('traffic', 0.08, 1440, 300), mod('margin', -0.1, 1440, -180)] }), fmt)).toEqual(['ok. +120 zł']);
    expect(lineTexts(answer({}, { mods: [mod('traffic', 0.08, 1440, 100), mod('margin', -0.1, 1440, -100)] }), fmt)).toEqual([]);
  });

  it('sklep zamknięty: czas w godzinach i szacunek straty', () => {
    expect(lineTexts(answer({ cash: -120 }, { mods: [mod('closed', 1, 60, -150)] }), fmt)).toEqual(['−120 zł', 'sklep zamknięty 1 h', 'ok. −150 zł']);
    expect(lineTexts(answer({}, { mods: [mod('closed', 1, 90, 0)] }), fmt)).toEqual(['sklep zamknięty 1 h 30 min']);
  });

  it('ludzie na zmianie: znak i odmiana „osoba / osoby / osób”', () => {
    expect(lineTexts(answer({}, { mods: [mod('staff', -1, 1020, -200)] }), fmt)).toEqual(['−1 osoba na zmianie', 'ok. −200 zł']);
    expect(lineTexts(answer({}, { mods: [mod('staff', 2, 240, 0)] }), fmt)).toEqual(['+2 osoby na zmianie']);
    expect(lineTexts(answer({}, { mods: [mod('staff', 5, 240, 0)] }), fmt)).toEqual(['+5 osób na zmianie']);
  });

  it('kolejność: skutki pewne, potem efekty na czas, na końcu ryzyko', () => {
    const a = answer({ cash: -100, trust: 1 }, { mods: [mod('closed', 1, 60, -150)], risk: { chance: 0.2, delta: { fine: -300 } } });
    expect(lineTexts(a, fmt)).toEqual(['−100 zł', 'zaufanie +1', 'sklep zamknięty 1 h', 'ok. −150 zł', 'ryzyko 20%: −300 zł']);
  });

  it('nie zmienia przekazanej odpowiedzi (czysta funkcja)', () => {
    const a = answer({ cash: -100 }, { mods: [mod('closed', 1, 60, -150)], risk: { chance: 0.2, delta: { fine: -300 } } });
    const before = JSON.stringify(a);
    lineTexts(a, fmt);
    expect(JSON.stringify(a)).toBe(before);
  });
});

describe('deltaLines: ocena wiersza (koszt, zysk, bez oceny)', () => {
  it('pieniądze po znaku: wydatek, mandat i logistyka to koszt, wpływ i premia to zysk', () => {
    expect(toned(answer({ cash: -120, bonus: 500, fine: -300, logistics: -80 }))).toEqual([
      ['−120 zł', 'cost'], ['+500 zł', 'gain'], ['−300 zł', 'cost'], ['−80 zł', 'cost'],
    ]);
    expect(toned(answer({ cash: 90 }))).toEqual([['+90 zł', 'gain']]);
  });

  it('WUT rośnie na szkodę gracza (koszt), odpis z programu refundacyjnego to zysk', () => {
    expect(toned(answer({ wut: 350 }))).toEqual([['WUT +350 zł', 'cost']]);
    expect(toned(answer({ wut: -200 }))).toEqual([['WUT −200 zł', 'gain']]);
  });

  it('zaufanie, reputacja i Ogonki: wzrost to zysk, spadek to koszt', () => {
    expect(toned(answer({ trust: 2, reputation: 0.5, ogonki: 3 }))).toEqual([['zaufanie +2', 'gain'], ['reputacja +0.5', 'gain'], ['Ogonki +3', 'gain']]);
    expect(toned(answer({ trust: -1, reputation: -1.5, ogonki: -2 }))).toEqual([['zaufanie −1', 'cost'], ['reputacja −1.5', 'cost'], ['Ogonki −2', 'cost']]);
  });

  it('siły: zużycie to koszt, odzyskanie to zysk; czas ludzi: zabrany pracy to koszt, uwolniony to zysk', () => {
    expect(toned(answer({ energy: -60, staffMinutes: 45 }))).toEqual([['czas ludzi 45 min', 'cost'], ['siły −60', 'cost']]);
    expect(toned(answer({ energy: 10, staffMinutes: -30 }))).toEqual([['czas ludzi −30 min', 'gain'], ['siły +10', 'gain']]);
  });

  it('efekty na czas: zamknięcie sklepu i mniej osób to koszt, więcej osób to zysk; szacunek po znaku', () => {
    expect(toned(answer({}, { mods: [mod('closed', 1, 60, -150)] }))).toEqual([['sklep zamknięty 1 h', 'cost'], ['ok. −150 zł', 'cost']]);
    expect(toned(answer({}, { mods: [mod('staff', -1, 1020, -200)] }))).toEqual([['−1 osoba na zmianie', 'cost'], ['ok. −200 zł', 'cost']]);
    expect(toned(answer({}, { mods: [mod('staff', 1, 240, 0)] }))).toEqual([['+1 osoba na zmianie', 'gain']]);
    expect(toned(answer({}, { mods: [mod('traffic', 0.3, 120, 240)] }))).toEqual([['ok. +240 zł', 'gain']]);
  });

  it('ryzyko zawsze jest kosztem, także bez liczbowego skutku', () => {
    expect(toned(answer({}, { risk: { chance: 0.3, delta: { fine: -300 } } }))).toEqual([['ryzyko 30%: −300 zł', 'cost']]);
    expect(toned(answer({}, { risk: { chance: 0.5, delta: {} } }))).toEqual([['ryzyko 50%', 'cost']]);
  });

  it('koszt i zysk obok siebie w jednej odpowiedzi mają różne oceny (np. „WUT +350 zł” obok „+700 zł”)', () => {
    expect(toned(answer({ bonus: 700, wut: 350 }))).toEqual([['+700 zł', 'gain'], ['WUT +350 zł', 'cost']]);
  });
});
