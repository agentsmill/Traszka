import { describe, it, expect } from 'vitest';
import { createRng, hashString, subSeed } from './rng';

describe('rng', () => {
  it('hashString jest wzorcowy', () => {
    expect(hashString('kiełbasa-42')).toBe(2556296325);
    expect(hashString('')).toBe(167010153);
  });
  it('createRng daje wzorcowe wartości', () => {
    const r = createRng('kiełbasa-42');
    expect([r.next(), r.next(), r.next()]).toEqual([0.7423317739740014, 0.8871990016195923, 0.8230785729829222]);
    const t = createRng('traszka');
    expect(t.next()).toBe(0.8985555691178888);
  });
  it('int jest wzorcowy i w zakresie', () => {
    const r = createRng('kiełbasa-42');
    expect([0, 1, 2, 3, 4].map(() => r.int(0, 10))).toEqual([7, 8, 8, 7, 2]);
  });
  it('podstrumienie są niezależne', () => {
    expect(createRng(subSeed('a', 'city')).next()).not.toBe(createRng(subSeed('a', 'store')).next());
  });
  it('shuffle nie modyfikuje wejścia i zachowuje elementy', () => {
    const src = [1, 2, 3, 4, 5];
    const out = createRng('x').shuffle(src);
    expect(src).toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort()).toEqual(src);
  });
});
