import { describe, it, expect } from 'vitest';
import { layoutToAscii } from './ascii';
import { BREAKS, layoutFromParts, makeValidLayout, patchFixture, removeFixture, validParts } from './testLayouts';
import { FRONT_WALL_Y, type Fixture } from './types';
import { accessCells, isWalkable, validateLayout } from './validate';

describe('makeValidLayout', () => {
  it('ma spójne wymiary i punkty specjalne', () => {
    const l = makeValidLayout();
    const { lot } = l;
    expect(l.width).toBe(lot.interiorWidth + 2);
    expect(l.depth).toBe(4 + 1 + lot.salesDepth + 1 + lot.backroomDepth + 1);
    expect(l.midWallY).toBe(5 + lot.salesDepth);
    expect(l.cells).toHaveLength(l.width * l.depth);
    expect(l.entrance).toHaveLength(2);
    expect(l.entrance.every((c) => c.y === FRONT_WALL_Y)).toBe(true);
    expect(l.spawnPoints).toEqual([{ x: 0, y: 1 }, { x: l.width - 1, y: 1 }]);
    expect(l.palletZoneOutside.length).toBeGreaterThan(0);
    expect(l.palletZoneOutside.every((c) => c.y >= 1 && c.y <= 2 && isWalkable(l, c.x, c.y))).toBe(true);
  });
});

describe('validateLayout', () => {
  it('poprawny układ → ok: true, errors: []', () => {
    expect(validateLayout(makeValidLayout())).toEqual({ ok: true, errors: [] });
  });

  it('nie modyfikuje układu', () => {
    const l = makeValidLayout();
    const copy = structuredClone(l);
    validateLayout(l);
    expect(l).toEqual(copy);
  });

  it.each(BREAKS)('$name → $code', ({ make, code }) => {
    const result = validateLayout(make());
    expect(result.errors).toEqual([code]);
    expect(result.ok).toBe(false);
  });

  it('każdy kod z kontraktu jest pokryty przez jakieś uszkodzenie', () => {
    const covered = new Set(BREAKS.map((b) => b.code.split(':')[0]));
    expect([...covered].sort()).toEqual([
      'aisle-narrow',
      'checkout-far',
      'entrance-not-front',
      'fixture-overlap',
      'fridge-not-back',
      'hot-far',
      'no-backroom-door',
      'queue-invalid',
      'tobacco-not-behind',
      'unreachable',
    ]);
  });

  it('brak kasy → checkout-far i queue-invalid (pozostałe reguły wokół kasy się pomijają)', () => {
    const result = validateLayout(layoutFromParts(removeFixture(validParts(), 'checkout-1')));
    expect(result.errors).toEqual(['checkout-far', 'queue-invalid']);
  });

  describe('odstęp personelu za kasą (regał z papierosami)', () => {
    // kasa przesunięta w prawo; regał stoi w x=1 (w=1), więc odstęp = kasa.x − 2
    const withCheckoutAt = (x: number) => validateLayout(layoutFromParts(patchFixture(validParts(), 'checkout-1', { x })));

    it('1 kratka (układ wzorcowy) i 2 kratki są dozwolone', () => {
      expect(validateLayout(makeValidLayout()).errors).not.toContain('tobacco-not-behind');
      expect(withCheckoutAt(4).errors).not.toContain('tobacco-not-behind');
    });
    it('3 kratki to za dużo', () => {
      expect(withCheckoutAt(5).errors).toContain('tobacco-not-behind');
    });
    it('0 kratek (regał przylega do kasy) to za mało', () => {
      const p = patchFixture(validParts(), 'tobaccoShelf-1', { x: 2 });
      expect(validateLayout(layoutFromParts(p)).errors).toContain('tobacco-not-behind');
    });
  });

  it('kasa na granicy: ostatni dozwolony wiersz sali to FRONT_WALL_Y + 6', () => {
    // wzorcowa kasa zajmuje wiersze 7..10, czyli kończy się dokładnie na FRONT_WALL_Y + 6
    const checkout = makeValidLayout().fixtures.find((f) => f.kind === 'checkout')!;
    expect(checkout.y + checkout.d - 1).toBe(FRONT_WALL_Y + 6);
    expect(validateLayout(makeValidLayout()).errors).not.toContain('checkout-far');
  });
});

describe('isWalkable', () => {
  const l = makeValidLayout();
  it.each([
    ['chodnik', 0, 0, true],
    ['wejście', 6, FRONT_WALL_Y, true],
    ['podłoga sali', 5, 5, true],
    ['kratka kolejki', 4, 8, true],
    ['ściana frontowa (witryna)', 1, FRONT_WALL_Y, false],
    ['ściana boczna', 0, 8, false],
    ['mebel', 3, 8, false],
    ['drzwi na zaplecze', 2, 14, false],
    ['zaplecze', 4, 15, false],
    ['poza siatką (x < 0)', -1, 0, false],
    ['poza siatką (x ≥ width)', 16, 0, false],
    ['poza siatką (y < 0)', 0, -1, false],
    ['poza siatką (y ≥ depth)', 0, 19, false],
  ])('%s (%i,%i) → %s', (_, x, y, expected) => {
    expect(isWalkable(l, x, y)).toBe(expected);
  });
});

describe('accessCells', () => {
  const l = makeValidLayout();
  const f = (facing: Fixture['facing'], x = 5, y = 7, w = 3, d = 2): Fixture => ({ id: 't', kind: 'gondola', x, y, w, d, facing });

  it('N: wiersz nad meblem, od lewej do prawej', () => {
    expect(accessCells(l, f('N'))).toEqual([{ x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 }]);
  });
  it('S: wiersz pod meblem', () => {
    expect(accessCells(l, f('S'))).toEqual([{ x: 5, y: 9 }, { x: 6, y: 9 }, { x: 7, y: 9 }]);
  });
  it('W: kolumna na lewo od mebla, od góry do dołu', () => {
    expect(accessCells(l, f('W'))).toEqual([{ x: 4, y: 7 }, { x: 4, y: 8 }]);
  });
  it('E: kolumna na prawo od mebla', () => {
    expect(accessCells(l, f('E'))).toEqual([{ x: 8, y: 7 }, { x: 8, y: 8 }]);
  });
  it('pomija kratki poza siatką', () => {
    expect(accessCells(l, f('N', 0, 0, 2, 1))).toEqual([]);
    expect(accessCells(l, f('W', 0, 3, 1, 2))).toEqual([]);
    expect(accessCells(l, f('E', 14, 3, 2, 1))).toEqual([]);
  });
  it('front wzorcowej kasy to kolumna przed nią, a [0] kolejki jest jedną z tych kratek', () => {
    const checkout = l.fixtures.find((m) => m.kind === 'checkout')!;
    const cells = accessCells(l, checkout);
    expect(cells).toEqual([{ x: 4, y: 7 }, { x: 4, y: 8 }, { x: 4, y: 9 }, { x: 4, y: 10 }]);
    expect(cells).toContainEqual(l.checkoutQueue[0]);
  });
});

describe('layoutToAscii', () => {
  const ascii = layoutToAscii(makeValidLayout());

  it('układ wzorcowy (obejrzany ręcznie) zgadza się ze snapshotem', () => {
    expect(ascii).toMatchSnapshot();
  });

  it('ma depth wierszy po width znaków, od ulicy (y=0) w dół', () => {
    const l = makeValidLayout();
    const rows = ascii.split('\n');
    expect(rows).toHaveLength(l.depth);
    expect(rows.every((r) => r.length === l.width)).toBe(true);
    expect(rows[0]).toBe(','.repeat(l.width));
    expect(rows[FRONT_WALL_Y]).toBe('#WWWWWDDWWWWWWW#');
    expect(rows[l.depth - 1]).toBe('#'.repeat(l.width));
  });

  it('legenda: każdy rodzaj mebla ma swoją literę, kolejka to q', () => {
    for (const ch of 'GSFCTHKXEB') expect(ascii, `brak ${ch}`).toContain(ch);
    expect(ascii.split('\n').filter((r) => r.includes('q'))).toHaveLength(5);
  });

  it('kolejka nie zasłania mebli', () => {
    const p = validParts();
    p.checkoutQueue = [{ x: 4, y: 8 }, { x: 4, y: 9 }, { x: 4, y: 10 }, { x: 5, y: 10 }, { x: 6, y: 10 }];
    const rows = layoutToAscii(layoutFromParts(p)).split('\n');
    // x=3..7 w wierszu 10: kasa, dwie kratki kolejki, gondola; kolejka na (6,10) nie zasłania mebla
    expect(rows[10]!.slice(3, 8)).toBe('CqqGG');
  });
});
