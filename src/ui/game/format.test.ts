import { describe, expect, it } from 'vitest';
import { minusZl, money, percentOf, people, signedPts, zl } from './format';

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

describe('money, minusZl i percentOf: kwoty i udziały na wyciągu', () => {
  it('money: ujemny stan z „−” typograficznym, dodatni bez plusa, zaokrąglenie do zera nie daje „−0”', () => {
    expect(money(1500)).toBe(zl(1500));
    expect(money(-3200)).toBe(`−${zl(3200)}`);
    expect(money(-0.3)).toBe(zl(0));
  });

  it('minusZl: odejmowana kwota z „−”, zero i grosze bez „−0”', () => {
    expect(minusZl(1200)).toBe(`−${zl(1200)}`);
    expect(minusZl(0)).toBe(zl(0));
    expect(minusZl(0.4)).toBe(zl(0));
  });

  it('percentOf: udział z jednym miejscem po przecinku tylko wtedy, gdy trzeba', () => {
    expect(percentOf(0.012)).toBe('1,2%');
    expect(percentOf(0.04)).toBe('4%');
    expect(percentOf(0.35)).toBe('35%');
  });
});
