import { describe, it, expect, vi } from 'vitest';
import { createRng } from '@/sim/rng';
import { layoutToAscii } from './ascii';
import { GENERATOR_VERSION, generateStore } from './generateStore';
import { LOT_RANGES, pickLot } from './lots';
import { FRONT_WALL_Y, type LotSpec } from './types';
import { isWalkable, validateLayout } from './validate';

// Opakowanie zostawia createRng bez zmian, ale pozwala policzyć próby generatora (podseedy `store:try:n`).
vi.mock('@/sim/rng', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/sim/rng')>();
  return { ...actual, createRng: vi.fn(actual.createRng) };
});

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
      for (let y = 0; y < depth; y++) {
        for (let x = 0; x < width; x++) {
          const edge = x === 0 || x === width - 1;
          const t = at(x, y);
          if (y < FRONT_WALL_Y) expect(t).toBe('outside');
          else if (y === FRONT_WALL_Y) expect(edge ? t === 'wall' : ['window', 'entrance'].includes(t!)).toBe(true);
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
