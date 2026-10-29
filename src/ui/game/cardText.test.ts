import { describe, expect, it } from 'vitest';
import type { AnswerInstance, CardDelta, CardMod } from '@/sim/economy/tycoon/cards';
import { deltaLines } from './cardText';

/** Formatowanie liczb w testach: bez separatorów, żeby napisy były przewidywalne (w grze podaje je interfejs po polsku). */
const fmt = (n: number): string => String(n);

const answer = (delta: CardDelta, extra: Partial<AnswerInstance> = {}): AnswerInstance => ({ delta, mods: [], risk: null, ...extra });
const mod = (kind: CardMod['kind'], value: number, minutes: number, estimate: number): CardMod => ({ kind, value, minutes, from: null, estimate });

describe('deltaLines: skutki odpowiedzi na karcie', () => {
  it('mandat ze znakiem minus (U+2212) i „zł”', () => {
    expect(deltaLines(answer({ fine: -300 }), fmt)).toContain('−300 zł');
  });

  it('pieniądze: koszt, premia, mandat i logistyka mają własne wiersze ze znakiem', () => {
    expect(deltaLines(answer({ cash: -120, bonus: 500, fine: -300, logistics: -80 }), fmt)).toEqual(['−120 zł', '+500 zł', '−300 zł', '−80 zł']);
    expect(deltaLines(answer({ cash: 90 }), fmt)).toEqual(['+90 zł']);
  });

  it('zaufanie, WUT, czas ludzi, siły, reputacja i Ogonki', () => {
    expect(deltaLines(answer({ trust: 2, wut: 120, staffMinutes: 45, energy: -60, reputation: -1.5, ogonki: 3 }), fmt)).toEqual([
      'zaufanie +2', 'WUT +120 zł', 'czas ludzi 45 min', 'siły −60', 'reputacja −1.5', 'Ogonki +3',
    ]);
    expect(deltaLines(answer({ trust: -1, wut: -50, energy: 10 }), fmt)).toEqual(['zaufanie −1', 'WUT −50 zł', 'siły +10']);
  });

  it('liczby idą przez podaną funkcję formatującą (interfejs: polski zapis z odstępem tysięcy)', () => {
    const pl = (n: number): string => n.toLocaleString('pl-PL');
    expect(deltaLines(answer({ cash: -12_500 }), pl)).toEqual([`−${(12_500).toLocaleString('pl-PL')} zł`]);
    expect(deltaLines(answer({ trust: 0.5 }), pl)).toEqual([`zaufanie +${(0.5).toLocaleString('pl-PL')}`]);
  });

  it('odpowiedź bez skutków (np. „nic nie robię”) nie ma żadnych wierszy', () => {
    expect(deltaLines(answer({}), fmt)).toEqual([]);
    expect(deltaLines(answer({ cash: 0, trust: 0 }), fmt)).toEqual([]);   // zera nic nie mówią
  });

  it('ryzyko: szansa w procentach i skutek, który dojdzie', () => {
    const lines = deltaLines(answer({}, { risk: { chance: 0.3, delta: { fine: -300 } } }), fmt);
    expect(lines).toEqual(['ryzyko 30%: −300 zł']);
    expect(deltaLines(answer({ cash: -50 }, { risk: { chance: 0.76, delta: { wut: 90, trust: -2 } } }), fmt))
      .toEqual(['−50 zł', 'ryzyko 76%: zaufanie −2, WUT +90 zł']);
  });

  it('ryzyko bez skutku liczbowego dalej pokazuje szansę, a ryzyko zerowe znika', () => {
    expect(deltaLines(answer({}, { risk: { chance: 0.5, delta: {} } }), fmt)).toEqual(['ryzyko 50%']);
    expect(deltaLines(answer({}, { risk: { chance: 0, delta: { fine: -300 } } }), fmt)).toEqual([]);
    expect(deltaLines(answer({}, { risk: { chance: 0.002, delta: { fine: -300 } } }), fmt)).toEqual(['ryzyko 1%: −300 zł']);   // nie „0%”
  });

  it('efekty na czas: szacunek „ok. ±n zł” z mods[].estimate', () => {
    expect(deltaLines(answer({}, { mods: [mod('traffic', 0.3, 120, 240)] }), fmt)).toEqual(['ok. +240 zł']);
    expect(deltaLines(answer({ cash: -50 }, { mods: [mod('margin', -0.1, 1440, -180)] }), fmt)).toEqual(['−50 zł', 'ok. −180 zł']);
  });

  it('kilka efektów daje jeden wspólny szacunek, a szacunek zerowy znika', () => {
    expect(deltaLines(answer({}, { mods: [mod('traffic', 0.08, 1440, 300), mod('margin', -0.1, 1440, -180)] }), fmt)).toEqual(['ok. +120 zł']);
    expect(deltaLines(answer({}, { mods: [mod('traffic', 0.08, 1440, 100), mod('margin', -0.1, 1440, -100)] }), fmt)).toEqual([]);
  });

  it('sklep zamknięty: czas w godzinach i szacunek straty', () => {
    expect(deltaLines(answer({ cash: -120 }, { mods: [mod('closed', 1, 60, -150)] }), fmt)).toEqual(['−120 zł', 'sklep zamknięty 1 h', 'ok. −150 zł']);
    expect(deltaLines(answer({}, { mods: [mod('closed', 1, 90, 0)] }), fmt)).toEqual(['sklep zamknięty 1 h 30 min']);
  });

  it('ludzie na zmianie: znak i odmiana „osoba / osoby / osób”', () => {
    expect(deltaLines(answer({}, { mods: [mod('staff', -1, 1020, -200)] }), fmt)).toEqual(['−1 osoba na zmianie', 'ok. −200 zł']);
    expect(deltaLines(answer({}, { mods: [mod('staff', 2, 240, 0)] }), fmt)).toEqual(['+2 osoby na zmianie']);
    expect(deltaLines(answer({}, { mods: [mod('staff', 5, 240, 0)] }), fmt)).toEqual(['+5 osób na zmianie']);
  });

  it('kolejność: skutki pewne, potem efekty na czas, na końcu ryzyko', () => {
    const a = answer({ cash: -100, trust: 1 }, { mods: [mod('closed', 1, 60, -150)], risk: { chance: 0.2, delta: { fine: -300 } } });
    expect(deltaLines(a, fmt)).toEqual(['−100 zł', 'zaufanie +1', 'sklep zamknięty 1 h', 'ok. −150 zł', 'ryzyko 20%: −300 zł']);
  });

  it('nie zmienia przekazanej odpowiedzi (czysta funkcja)', () => {
    const a = answer({ cash: -100 }, { mods: [mod('closed', 1, 60, -150)], risk: { chance: 0.2, delta: { fine: -300 } } });
    const before = JSON.stringify(a);
    deltaLines(a, fmt);
    expect(JSON.stringify(a)).toBe(before);
  });
});
