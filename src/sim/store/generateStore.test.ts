import { describe, it, expect, vi } from 'vitest';
import { createRng } from '@/sim/rng';
import { layoutToAscii } from './ascii';
import { GENERATOR_VERSION, generateStore } from './generateStore';
import { LOT_RANGES, pickLot } from './lots';
import { FRONT_WALL_Y, type LotSpec, type StoreLayout } from './types';
import { isWalkable, validateLayout } from './validate';

// Opakowanie zostawia createRng bez zmian, ale pozwala policzyć próby generatora (podseedy `store:try:n`).
vi.mock('@/sim/rng', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/sim/rng')>();
  return { ...actual, createRng: vi.fn(actual.createRng) };
});

/** Kolumna ściany bocznej bliższej wejścia (0 albo width − 1). */
const nearerSideColumn = (l: StoreLayout): number => {
  const xs = l.entrance.map((e) => e.x);
  return Math.min(...xs) <= l.width - 1 - Math.max(...xs) ? 0 : l.width - 1;
};

const triedSeeds = (): string[] =>
  vi.mocked(createRng).mock.calls.map(([seed]) => seed).filter((seed) => seed.includes(':store:try:'));

describe('generateStore', () => {
  it('jest deterministyczny', () => {
    expect(generateStore('kiełbasa-42')).toEqual(generateStore('kiełbasa-42'));
  });

  it('złoty seed: snapshot ASCII', () => {
    expect(layoutToAscii(generateStore('kiełbasa-42'))).toMatchSnapshot();
  });

  it('200 seedów → każdy układ przechodzi walidację', () => {
    for (let i = 0; i < 200; i++) {
      const l = generateStore(`seed-${i}`);
      expect(validateLayout(l), `seed-${i}\n${layoutToAscii(l)}`).toEqual({ ok: true, errors: [] });
    }
  });

  it('rozmiary mieszczą się w LOT_RANGES dla wszystkich rodzajów', () => {
    for (const kind of ['blok', 'kamienica', 'pawilon'] as const) {
      for (let i = 0; i < 30; i++) {
        const l = generateStore(`${kind}-${i}`);
        const r = LOT_RANGES[l.lot.kind];
        expect(l.lot.interiorWidth).toBeGreaterThanOrEqual(r.interiorWidth[0]);
        expect(l.lot.interiorWidth).toBeLessThanOrEqual(r.interiorWidth[1]);
        expect(l.width).toBe(l.lot.interiorWidth + 2);
      }
    }
  });

  it('różne seedy dają różne sklepy (≥ 15 z 20 unikalnych)', () => {
    const set = new Set(Array.from({ length: 20 }, (_, i) => layoutToAscii(generateStore(`r-${i}`))));
    expect(set.size).toBeGreaterThanOrEqual(15);
  });

  it('wszystkie trzy rodzaje lokali występują wśród 60 seedów', () => {
    const kinds = new Set(Array.from({ length: 60 }, (_, i) => pickLot(`k-${i}`).kind));
    expect(kinds).toEqual(new Set(['blok', 'kamienica', 'pawilon']));
  });

  it('nietypowe seedy działają', () => {
    for (const s of ['', 'ąęółżźćń🦎', 'x'.repeat(1000)]) {
      expect(validateLayout(generateStore(s)).ok).toBe(true);
    }
  });

  it('zapisuje seed i wersję generatora', () => {
    const l = generateStore('kiełbasa-42');
    expect(l.seed).toBe('kiełbasa-42');
    expect(l.generatorVersion).toBe(GENERATOR_VERSION);
  });

  it('szkielet siatki: chodnik, witryna z wejściem, ściany, zaplecze, drzwi w ścianie środkowej', () => {
    for (let i = 0; i < 40; i++) {
      const l = generateStore(`szkielet-${i}`);
      const { lot, width, depth, midWallY } = l;
      expect(depth).toBe(4 + 1 + lot.salesDepth + 1 + lot.backroomDepth + 1);
      expect(midWallY).toBe(5 + lot.salesDepth);
      expect(l.cells).toHaveLength(width * depth);
      const at = (x: number, y: number) => l.cells[y * width + x];
      const cornerX = lot.corner ? nearerSideColumn(l) : -1;   // w lokalu narożnym druga witryna, inaczej nie ma jej wcale
      for (let y = 0; y < depth; y++) {
        for (let x = 0; x < width; x++) {
          const edge = x === 0 || x === width - 1;
          const t = at(x, y);
          if (y < FRONT_WALL_Y) expect(t).toBe('outside');
          else if (y === FRONT_WALL_Y) expect(edge ? t === 'wall' : ['window', 'entrance'].includes(t!)).toBe(true);
          else if (x === cornerX && y < midWallY) expect(t).toBe('window');
          else if (edge || y === depth - 1) expect(t).toBe('wall');
          else if (y === midWallY) expect(['wall', 'fixture']).toContain(t);
          else if (y > midWallY) expect(t).toBe('backroom');
          else expect(['floor', 'fixture']).toContain(t);
        }
      }
      expect(l.cells.filter((t) => t === 'entrance')).toHaveLength(2);
      expect(l.entrance.map((c) => c.x)).toEqual([l.entrance[0]!.x, l.entrance[0]!.x + 1]);
      expect(l.checkoutQueue.length).toBeGreaterThanOrEqual(4);
      expect(l.checkoutQueue.length).toBeLessThanOrEqual(6);
      expect(l.spawnPoints).toEqual([{ x: 0, y: 1 }, { x: width - 1, y: 1 }]);
      const entranceXs = l.entrance.map((c) => c.x);
      expect(l.palletZoneOutside.length).toBeGreaterThan(0);
      for (const c of l.palletZoneOutside) {
        expect(c.y === 1 || c.y === 2).toBe(true);
        expect(isWalkable(l, c.x, c.y)).toBe(true);
        expect(entranceXs.every((ex) => Math.abs(c.x - ex) > 1)).toBe(true);
      }
    }
  });

  it('lokal narożny: druga witryna w bocznej ścianie bliższej wejścia', () => {
    const sides = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const lot: LotSpec = { kind: 'kamienica', interiorWidth: 12 + (i % 7), salesDepth: 12 + (i % 5), backroomDepth: 3 + (i % 2), corner: true };
      const l = generateStore(`narożnik-${i}`, lot);
      const { width, depth, midWallY } = l;
      expect(validateLayout(l), `narożnik-${i}\n${layoutToAscii(l)}`).toEqual({ ok: true, errors: [] });

      const column = (x: number) => Array.from({ length: depth }, (_, y) => l.cells[y * width + x]);
      const salesRows = (x: number) => column(x).slice(FRONT_WALL_Y + 1, midWallY);
      const cornerX = [0, width - 1].filter((x) => salesRows(x).every((t) => t === 'window'));
      expect(cornerX).toHaveLength(1);                                  // dokładnie jedna boczna witryna
      const [corner] = cornerX as [number];
      const opposite = corner === 0 ? width - 1 : 0;
      expect(salesRows(opposite).every((t) => t === 'wall')).toBe(true);
      // poza wierszami sali kolumna rogu zostaje ścianą (róg ściany frontowej, ściana środkowa, zaplecze, tył)
      expect(column(corner).filter((_, y) => y === FRONT_WALL_Y || y >= midWallY).every((t) => t === 'wall')).toBe(true);

      // wejście jest po stronie rogu: bliżej niego niż przeciwległej ściany i najwyżej 6 kratek od ściany rogu
      const distance = (x: number) => Math.min(...l.entrance.map((e) => Math.abs(e.x - x)));
      expect(distance(corner)).toBeLessThan(distance(opposite));
      expect(distance(corner)).toBeLessThanOrEqual(6);
      sides.add(corner === 0 ? 'W' : 'E');
    }
    expect(sides).toEqual(new Set(['W', 'E']));                         // odbicie daje oba warianty
  });

  it('lokal bez narożnika nie ma bocznych witryn', () => {
    for (let i = 0; i < 20; i++) {
      const lot: LotSpec = { kind: 'blok', interiorWidth: 16 + (i % 5), salesDepth: 12 + (i % 5), backroomDepth: 4 + (i % 3), corner: false };
      const l = generateStore(`bez-narożnika-${i}`, lot);
      for (let y = FRONT_WALL_Y + 1; y < l.depth; y++) {
        expect(l.cells[y * l.width]).toBe('wall');
        expect(l.cells[y * l.width + l.width - 1]).toBe('wall');
      }
    }
  });

  it('po nieudanej próbie ponawia z podseedem store:try:n', () => {
    // Lokal węższy niż w LOT_RANGES: część prób kończy się brakiem miejsca.
    const tight: LotSpec = { kind: 'kamienica', interiorWidth: 11, salesDepth: 12, backroomDepth: 3, corner: false };
    vi.mocked(createRng).mockClear();
    const l = generateStore('s0', tight);
    expect(validateLayout(l).ok).toBe(true);
    const tries = triedSeeds();
    expect(tries.length).toBeGreaterThan(1);
    expect(tries).toEqual(tries.map((_, n) => `s0:store:try:${n}`));
  });

  it('po 10 nieudanych próbach rzuca błąd', () => {
    const impossible: LotSpec = { kind: 'kamienica', interiorWidth: 4, salesDepth: 12, backroomDepth: 3, corner: false };
    vi.mocked(createRng).mockClear();
    expect(() => generateStore('x', impossible)).toThrow('generateStore: brak poprawnego układu');
    expect(triedSeeds()).toEqual(Array.from({ length: 10 }, (_, n) => `x:store:try:${n}`));
  });
});
