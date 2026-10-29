import { describe, expect, it } from 'vitest';
import { people, signedPts } from './format';

describe('people: osoby i osobominuty w interfejsie', () => {
  it('jedno miejsce po przecinku, bez zbędnego „,0”', () => {
    expect(people(0)).toBe('0');
    expect(people(1)).toBe('1');
    expect(people(2.0000001)).toBe('2');
    expect(people(0.4375)).toBe('0,4');
    expect(people(1.66)).toBe('1,7');
  });
});

describe('signedPts: zmiana zaufania ze znakiem', () => {
  it('całe liczby bez ułamka, niecałe z jednym miejscem po przecinku, znak minus typograficzny', () => {
    expect(signedPts(3)).toBe('+3');
    expect(signedPts(-4)).toBe('−4');
    expect(signedPts(2.5)).toBe('+2,5');
    expect(signedPts(-0.5)).toBe('−0,5');
    expect(signedPts(-2.4999)).toBe('−2,5');
    expect(signedPts(3.0000001)).toBe('+3');
  });

  it('zero i wartości, które zaokrąglają się do zera, nie dostają znaku ani „−0”', () => {
    expect(signedPts(0)).toBe('0');
    expect(signedPts(-0)).toBe('0');
    expect(signedPts(0.04)).toBe('0');
    expect(signedPts(-0.04)).toBe('0');
  });
});
