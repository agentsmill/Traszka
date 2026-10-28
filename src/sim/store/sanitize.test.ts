import { describe, expect, it } from 'vitest';
import { generateStore } from './generateStore';
import { sanitizeLayout } from './sanitize';
import type { StoreLayout } from './types';

const json = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v)) as Record<string, unknown>;

describe('sanitizeLayout', () => {
  it('układ po zapisie w JSON wraca bez zmian, dla różnych lokali i seedów', () => {
    for (const seed of ['kiełbasa-42', 'kiełbasa-12', 'traszka-1', 'a', 'b']) {
      const layout = generateStore(seed);
      expect(sanitizeLayout(json(layout))).toEqual(layout);
    }
  });

  it('zwraca nowy obiekt: zmiana wyniku nie rusza wejścia', () => {
    const raw = json(generateStore('traszka-1'));
    const out = sanitizeLayout(raw)!;
    out.cells[0] = 'wall';
    out.fixtures.pop();
    expect(sanitizeLayout(raw)).toEqual(generateStore('traszka-1'));
  });

  it('odrzuca to, co nie jest układem', () => {
    for (const raw of [null, undefined, 3, 'x', [], {}]) expect(sanitizeLayout(raw)).toBeNull();
  });

  it('odrzuca zepsute pola: wymiary, komórki, meble, listy kratek', () => {
    const good = json(generateStore('kiełbasa-42')) as unknown as StoreLayout & Record<string, unknown>;
    const bad = (patch: Record<string, unknown>): StoreLayout | null => sanitizeLayout({ ...good, ...patch });
    expect(bad({ width: null })).toBeNull();
    expect(bad({ width: 5 })).toBeNull();                              // komórek jest więcej niż width × depth
    expect(bad({ depth: 'x' })).toBeNull();
    expect(bad({ midWallY: 9999 })).toBeNull();
    expect(bad({ cells: null })).toBeNull();
    expect(bad({ cells: good.cells.slice(1) })).toBeNull();            // za krótka siatka
    expect(bad({ cells: good.cells.map((c, i) => (i === 3 ? 'lawa' : c)) })).toBeNull();
    expect(bad({ cells: good.cells.map((c, i) => (i === 3 ? 'toString' : c)) })).toBeNull();   // klucz z prototypu to nie typ komórki
    expect(bad({ fixtures: null })).toBeNull();
    expect(bad({ fixtures: [{ ...good.fixtures[0], kind: 'czołg' }] })).toBeNull();
    expect(bad({ fixtures: [{ ...good.fixtures[0], x: -1 }] })).toBeNull();
    expect(bad({ fixtures: [{ ...good.fixtures[0], x: good.width }] })).toBeNull();   // wystaje poza siatkę
    expect(bad({ fixtures: [{ ...good.fixtures[0], facing: 'Z' }] })).toBeNull();
    expect(bad({ fixtures: [{ ...good.fixtures[0], w: null }] })).toBeNull();
    expect(bad({ entrance: [] })).toBeNull();
    expect(bad({ checkoutQueue: [] })).toBeNull();
    expect(bad({ spawnPoints: [{ x: 0 }] })).toBeNull();
    expect(bad({ palletZoneOutside: [{ x: good.width + 5, y: 0 }] })).toBeNull();
    expect(bad({ lot: null })).toBeNull();
    expect(bad({ lot: { ...good.lot, kind: 'hala' } })).toBeNull();
    expect(bad({ lot: { ...good.lot, corner: 'tak' } })).toBeNull();
    expect(bad({ generatorVersion: null })).toBeNull();
    expect(bad({ seed: 4 })).toBeNull();
  });
});
