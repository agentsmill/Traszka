import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REMONTS } from '@/sim/economy/upgrades';
import { generateStore } from './generateStore';
import { layoutFor } from './layoutFor';
import { LOT_RANGES, pickLot } from './lots';
import type { LotKind, LotSpec, StoreLayout } from './types';

const SEEDS = ['kiełbasa-42', 'traszka-1', 'pawilon-7', 'rynek-3'];

const slotsOf = (l: StoreLayout): number => l.fixtures.filter((f) => f.kind === 'equipmentSlot').length;

describe('layoutFor', () => {
  it('poziom 0 to generateStore(seed)', () => {
    for (const seed of SEEDS) expect(layoutFor(seed, 0), seed).toEqual(generateStore(seed));
  });

  it('poziomy 1..5: większy lokal, ten sam rodzaj, sloty z REMONTS', () => {
    for (const seed of SEEDS) {
      const base = layoutFor(seed, 0);
      for (const r of REMONTS) {
        const l = layoutFor(seed, r.level);
        expect(l.width, `${seed} @${r.level}`).toBeGreaterThanOrEqual(base.width);
        expect(l.lot.kind, `${seed} @${r.level}`).toBe(base.lot.kind);
        expect(slotsOf(l), `${seed} @${r.level}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('remonty ponad liczbę poziomów dają układ ostatniego remontu', () => {
    for (const seed of SEEDS) expect(layoutFor(seed, REMONTS.length + 3), seed).toEqual(layoutFor(seed, REMONTS.length));
  });

  /** Skrót układu: pierwsze 16 znaków SHA-256 z JSON-a (razem z `generatorVersion`). */
  const digest = (l: StoreLayout): string => createHash('sha256').update(JSON.stringify(l)).digest('hex').slice(0, 16);

  it('poziomy 1–3 jak przed etapem 4b: skrót JSON layoutFor(seed, l) dla 10 seedów × l ∈ {1, 2, 3} równy tablicy z kodu bazowego', () => {
    // Tablica policzona na kodzie bazowym (main po 4a.2, REMONTS z trzema poziomami). Ten test przechodzi przed i po zmianie REMONTS
    // i pilnuje, że poziomy 1–3 (a z nimi GENERATOR_VERSION 1 i LAYOUTS_GOLDEN) zostają bez zmian.
    const BASE: Record<string, [string, string, string]> = {
      'kiełbasa-42': ['42371337ce4fb28e', 'a136607545f3476b', '2d6de64e974b5ce0'],
      'traszka-1': ['70e8eb66b4cdf6c5', '6bdb9d5bc1927379', 'd8226d3bab7de2bf'],
      'pawilon-7': ['b66ab7e167aea5e0', 'fda5c6f18140e992', '8d623efd331625d9'],
      'rynek-3': ['cc2830d9bfe8ef1a', 'd09990fba1416f54', '78b80f769c73bb0a'],
      'kamienica-3': ['e12b5623371cb201', '85a14e0a89dc3e9a', '09b62c4492051117'],
      'seed-0': ['28f3fc8eab0076e3', '3796f23de6834f69', '58767d45aaa123b4'],
      'seed-2': ['fa8e0c6c0eb68361', '7723e6efb087e9aa', 'c810a20c33103419'],
      'seed-5': ['1e93cf9dad0db6a1', '8db5d053d5611361', '8d7ed44eb2df05b1'],
      'pierogi-731': ['33fc016ffb8c212d', '0866acdd9b2bcb2b', '14ce20428db58aae'],
      'bigos': ['17425c76f80154c4', '67c7738d8142b16f', '67895c992862c6f9'],
    };
    expect(Object.keys(BASE)).toHaveLength(10);
    // rodzaje lokali w tablicy: pokrywa blok, kamienicę i pawilon
    expect(new Set(Object.keys(BASE).map((s) => generateStore(s).lot.kind))).toEqual(new Set(['blok', 'kamienica', 'pawilon']));
    for (const [seed, hashes] of Object.entries(BASE)) {
      expect([1, 2, 3].map((l) => digest(layoutFor(seed, l))), seed).toEqual(hashes);
    }
  });

  it('poziomy 4 i 5 na 200 seedach (pickLot i trzy rodzaje LotSpec): bez wyjątku, szerokość L5 ≥ L4 ≥ L3, sloty sprzętu L4 i L5 ≥ L3', () => {
    const KINDS: LotKind[] = ['blok', 'kamienica', 'pawilon'];
    /** Lokal rodzaju `kind` z wymiarami rozrzuconymi po całym zakresie (deterministycznie, bez losowania). */
    const lotOf = (kind: LotKind, i: number): LotSpec => {
      const r = LOT_RANGES[kind];
      const pick = ([min, max]: [number, number], step: number): number => min + ((i * step) % (max - min + 1));
      return {
        kind,
        interiorWidth: pick(r.interiorWidth, 7),
        salesDepth: pick(r.salesDepth, 5),
        backroomDepth: pick(r.backroomDepth, 3),
        corner: r.cornerChance > 0 && i % 2 === 0,
      };
    };
    let widest = 0;
    for (let i = 0; i < 200; i++) {
      const seed = `plac-${i}`;
      const lots: (LotSpec | undefined)[] = [undefined, pickLot(seed), ...KINDS.map((k) => lotOf(k, i))];
      for (const lot of lots) {
        const tag = `${seed} ${lot ? `${lot.kind} ${lot.interiorWidth}×${lot.salesDepth}×${lot.backroomDepth}` : 'bez lot'}`;
        const [l3, l4, l5] = [3, 4, 5].map((lv) => layoutFor(seed, lv, lot));
        expect(l4!.width, `${tag}: szerokość L4 ≥ L3`).toBeGreaterThanOrEqual(l3!.width);
        expect(l5!.width, `${tag}: szerokość L5 ≥ L4`).toBeGreaterThanOrEqual(l4!.width);
        expect(slotsOf(l4!), `${tag}: sloty L4 ≥ L3`).toBeGreaterThanOrEqual(slotsOf(l3!));
        expect(slotsOf(l5!), `${tag}: sloty L5 ≥ L3`).toBeGreaterThanOrEqual(slotsOf(l3!));
        expect(l5!.lot.kind, tag).toBe(l3!.lot.kind);
        widest = Math.max(widest, l5!.width);
      }
    }
    expect(widest).toBeGreaterThan(0);
  }, 60_000);

  it('poziom 5 jest deterministyczny: ten sam seed i lokal dają ten sam układ', () => {
    for (const seed of SEEDS) {
      const lot = pickLot(seed);
      expect(digest(layoutFor(seed, 5, lot)), seed).toBe(digest(layoutFor(seed, 5, lot)));
    }
  });
});
