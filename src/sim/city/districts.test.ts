import { describe, expect, it } from 'vitest';
import { activeSite } from '@/sim/economy/site';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { LOT_RANGES } from '@/sim/store/lots';
import { layoutFor } from '@/sim/store/layoutFor';
import type { LotKind } from '@/sim/store/types';
import { DISTRICTS, districtSite } from './districts';
import type { StoreDistrict } from './types';

const IDS = Object.keys(DISTRICTS) as StoreDistrict[];

describe('districtSite: drugi sklep w środku widełek dzielnicy (balans, spec §8.4)', () => {
  it.each(IDS)('%s: liczby z DISTRICTS, flagi dodatkowego sklepu, bez własnej pogody', (id) => {
    const d = DISTRICTS[id];
    const site = districtSite(id);
    expect(site).toMatchObject({
      district: id, traffic: d.traffic, weekendTraffic: d.weekendTraffic, basket: d.basket, patience: d.patience, repPenalty: d.repPenalty,
      theft: d.theft, extra: true, ownCosts: false, firmDebt: true, weatherHash: null,
    });
  });

  it('lokal ma format dzielnicy (albo podany) i wymiary ze środka widełek, bez narożnika, a układ się z niego buduje', () => {
    for (const id of IDS) {
      expect(districtSite(id).lot!.kind).toBe(DISTRICTS[id].lotKind);
      for (const kind of ['blok', 'kamienica', 'pawilon'] as LotKind[]) {
        const lot = districtSite(id, kind).lot!;
        const r = LOT_RANGES[kind];
        expect(lot.kind).toBe(kind);
        expect(lot.corner).toBe(false);
        for (const [v, [lo, hi]] of [[lot.interiorWidth, r.interiorWidth], [lot.salesDepth, r.salesDepth], [lot.backroomDepth, r.backroomDepth]] as const) {
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(hi);
          expect(Math.abs(v - (lo + hi) / 2)).toBeLessThanOrEqual(0.5);
        }
        expect(computeStoreInfo(layoutFor('kiełbasa-42', 0, lot)).lotKind).toBe(kind);
      }
    }
  });

  it('Osiedle ma neutralne liczby dzielnicy (ruch, koszyk, oczekiwania, kradzieże), ale własny lokal: gałąź dzielnicy włącza tylko układ', () => {
    const site = districtSite('osiedle');
    expect([site.traffic, site.basket, site.patience, site.repPenalty, site.theft]).toEqual([1, 1, 0, 1, 1]);
    expect(site.weekendTraffic).toBeNull();
    const info = { ...computeStoreInfo(layoutFor('kiełbasa-42', 0, site.lot!)), site };
    expect(activeSite(info)).toBe(site);
  });
});
