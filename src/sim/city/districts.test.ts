import { describe, expect, it } from 'vitest';
import { HOUR_CURVE } from '@/sim/economy/catalog';
import { NEUTRAL_SITE, activeSite } from '@/sim/economy/site';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { LOT_RANGES } from '@/sim/store/lots';
import { layoutFor } from '@/sim/store/layoutFor';
import type { LotKind } from '@/sim/store/types';
import { DISTRICTS, districtSite, siteHours } from './districts';
import type { StoreDistrict } from './types';

const IDS = Object.keys(DISTRICTS) as StoreDistrict[];

describe('districtSite: drugi sklep w środku widełek dzielnicy (balans, spec §8.4)', () => {
  it.each(IDS)('%s: liczby z DISTRICTS, flagi dodatkowego sklepu, bez własnej pogody', (id) => {
    const d = DISTRICTS[id];
    const site = districtSite(id);
    expect(site).toMatchObject({
      district: id, traffic: d.traffic, weekendTraffic: d.weekendTraffic, basket: d.basket, patience: d.patience, repPenalty: d.repPenalty,
      theft: d.theft, difficult: d.difficult, extra: true, ownCosts: false, firmDebt: true, weatherHash: null,
    });
  });

  it('trudni klienci (4a.2, §8.1): Osiedle 1, Śródmieście 0,6, Dworzec 1,6, Biurowce 0,7', () => {
    expect(IDS.map((id) => [id, DISTRICTS[id].difficult])).toEqual([['osiedle', 1], ['srodmiescie', 0.6], ['dworzec', 1.6], ['biurowce', 0.7]]);
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

describe('siteHours: profil dnia dzielnicy (spec §8.1, 4a.2)', () => {
  const CURVE_SUM = Object.values(HOUR_CURVE).reduce((n, v) => n + v, 0);

  it('24 liczby, zera poza 6–22, suma 6–22 równa sumie HOUR_CURVE (±1e-9); osiedle i NEUTRAL_SITE: null', () => {
    expect(NEUTRAL_SITE.hours).toBeNull();
    expect(DISTRICTS.osiedle.hours).toBeNull();
    expect(siteHours('osiedle')).toBeNull();
    for (const id of IDS.filter((d) => DISTRICTS[d].hours !== null)) {
      const raw = DISTRICTS[id].hours!;
      expect(raw, `${id}: surowy kształt godzin 6–22`).toHaveLength(17);
      const h = siteHours(id)!;
      expect(h, id).toHaveLength(24);
      for (let hour = 0; hour < 24; hour++) {
        if (hour < 6 || hour > 22) expect(h[hour], `${id}: ${hour}:00`).toBe(0);
        else expect(h[hour]!, `${id}: ${hour}:00`).toBeGreaterThan(0);
      }
      expect(h.slice(6, 23).reduce((n, v) => n + v, 0), id).toBeCloseTo(CURVE_SUM, 9);
      // normalizacja skaluje cały kształt jednym współczynnikiem: proporcje godzin zostają z surowego kształtu
      for (let i = 1; i < 17; i++) expect(h[6 + i]! / h[6]!, `${id}: ${6 + i}:00`).toBeCloseTo(raw[i]! / raw[0]!, 9);
    }
  });

  it('zamrożona tablica liczona raz: to samo odwołanie przy każdym wywołaniu, bez możliwości zmiany', () => {
    for (const id of IDS.filter((d) => DISTRICTS[d].hours !== null)) {
      const h = siteHours(id)!;
      expect(siteHours(id)).toBe(h);
      expect(Object.isFrozen(h), id).toBe(true);
    }
  });

  it('districtSite przepisuje profil dzielnicy; Osiedle zostaje bez profilu', () => {
    for (const id of IDS) expect(districtSite(id).hours, id).toBe(siteHours(id));
    expect(districtSite('osiedle').hours).toBeNull();
    expect(districtSite('biurowce').hours).not.toBeNull();
  });
});
