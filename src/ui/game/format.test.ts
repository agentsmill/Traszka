import { describe, expect, it } from 'vitest';
import { people } from './format';

describe('people: osoby i osobominuty w interfejsie', () => {
  it('jedno miejsce po przecinku, bez zbędnego „,0”', () => {
    expect(people(0)).toBe('0');
    expect(people(1)).toBe('1');
    expect(people(2.0000001)).toBe('2');
    expect(people(0.4375)).toBe('0,4');
    expect(people(1.66)).toBe('1,7');
  });
});
