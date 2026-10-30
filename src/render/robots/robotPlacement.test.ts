import { describe, expect, it } from 'vitest';
import { computeStoreInfo, spotCells } from '@/sim/economy/storeInfo';
import { cellKey } from '@/sim/grid';
import { generateStore } from '@/sim/store/generateStore';
import { layoutFor } from '@/sim/store/layoutFor';
import type { StoreLayout } from '@/sim/store/types';
import { CONVEYOR_MAX_CELLS, placeRobots } from './robotPlacement';

const SEEDS = Array.from({ length: 60 }, (_, i) => `kielbasa-${i}`);

const layouts = (): Array<[string, StoreLayout]> => [
  ...SEEDS.map((seed): [string, StoreLayout] => [seed, generateStore(seed)]),
  ...SEEDS.slice(0, 12).flatMap((seed) => [1, 2, 3].map((lvl): [string, StoreLayout] => [`${seed}/remont${lvl}`, layoutFor(seed, lvl)])),
];

describe('placeRobots', () => {
  it('daje taśmociąg i prasę na kratkach zaplecza, poza miejscami na palety i poza pierwszym rzędem za drzwiami', () => {
    for (const [name, layout] of layouts()) {
      const info = computeStoreInfo(layout);
      const spots = new Set(info.spots.backroom.flatMap(spotCells).map(cellKey));
      const { conveyor, press } = placeRobots(layout, info);
      for (const [label, cells] of [['taśmociąg', conveyor], ['prasa', press]] as const) {
        expect(cells, `${name}: ${label}`).not.toBeNull();
        for (const c of cells!) {
          expect(layout.cells[c.y * layout.width + c.x], `${name}: ${label} ${c.x},${c.y}`).toBe('backroom');
          expect(spots.has(cellKey(c)), `${name}: ${label} na miejscu palety ${c.x},${c.y}`).toBe(false);
          expect(c.y, `${name}: ${label} w przejściu za drzwiami`).toBeGreaterThan(layout.midWallY + 1);
        }
      }
      expect(conveyor!.length, name).toBeGreaterThanOrEqual(2);
      expect(conveyor!.length, name).toBeLessThanOrEqual(CONVEYOR_MAX_CELLS);
      expect(press!.length, name).toBe(2);
      const all = [...conveyor!, ...press!].map(cellKey);
      expect(new Set(all).size, `${name}: maszyny na tych samych kratkach`).toBe(all.length);
    }
  });

  it('kratki taśmociągu i prasy tworzą ciągły rząd w jednej linii', () => {
    for (const [name, layout] of layouts()) {
      const { conveyor, press } = placeRobots(layout, computeStoreInfo(layout));
      for (const cells of [conveyor!, press!]) {
        const y = cells[0]!.y;
        cells.forEach((c, i) => {
          expect(c.y, name).toBe(y);
          expect(c.x, name).toBe(cells[0]!.x + i);
        });
      }
    }
  });

  it('wykładacz stoi na najdłuższej gondoli (bez gondoli: na regale ściennym), a bez mebli do wykładania go nie ma', () => {
    const layout = generateStore('kielbasa-42');
    const info = computeStoreInfo(layout);
    const picked = placeRobots(layout, info).restocker!;
    expect(picked.kind).toBe('gondola');
    const longest = Math.max(...layout.fixtures.filter((f) => f.kind === 'gondola').map((f) => Math.max(f.w, f.d)));
    expect(Math.max(picked.w, picked.d)).toBe(longest);

    const noGondola = { ...layout, fixtures: layout.fixtures.filter((f) => f.kind !== 'gondola') };
    expect(placeRobots(noGondola, info).restocker?.kind).toBe('wallShelf');
    const none = { ...layout, fixtures: layout.fixtures.filter((f) => f.kind !== 'gondola' && f.kind !== 'wallShelf') };
    expect(placeRobots(none, info).restocker).toBeNull();
  });

  it('jest deterministyczne i nie zmienia układu', () => {
    const layout = generateStore('kielbasa-7');
    const info = computeStoreInfo(layout);
    const before = JSON.stringify(layout);
    expect(placeRobots(layout, info)).toEqual(placeRobots(layout, info));
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('bez zaplecza nie rzuca i nie zwraca maszyn', () => {
    const layout = generateStore('kielbasa-42');
    const info = computeStoreInfo(layout);
    const gutted = { ...layout, cells: layout.cells.map((t) => (t === 'backroom' ? 'floor' as const : t)) };
    const out = placeRobots(gutted, info);
    expect(out.conveyor).toBeNull();
    expect(out.press).toBeNull();
  });
});
