import { describe, expect, it } from 'vitest';
import { SEED_WORDS, randomSeed } from './seedWords';

describe('seedWords', () => {
  it('lista ma 50 różnych słów z małych liter ASCII', () => {
    expect(SEED_WORDS).toHaveLength(50);
    expect(new Set(SEED_WORDS).size).toBe(50);
    for (const word of SEED_WORDS) expect(word).toMatch(/^[a-z]+$/);
  });

  it('randomSeed składa słowo i trzycyfrową liczbę z podanego źródła losowości', () => {
    const values = (...list: number[]) => { let i = 0; return () => list[i++]!; };
    expect(randomSeed(values(0, 631))).toBe('pierogi-731');
    expect(randomSeed(values(51, 900))).toBe(`${SEED_WORDS[1]}-100`);
  });

  it('domyślne źródło to crypto.getRandomValues: wynik ma postać słowo-liczba', () => {
    for (let i = 0; i < 20; i++) expect(randomSeed()).toMatch(/^[a-z]+-[1-9]\d{2}$/);
  });
});
