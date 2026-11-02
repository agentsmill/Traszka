import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEconomy, expectedDailyCustomers, type StoreFittings } from '@/sim/economy/economy';
import { NEUTRAL_SITE } from '@/sim/economy/site';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { subSeed } from '@/sim/rng';
import { layoutFor } from '@/sim/store/layoutFor';
import { DISTRICTS, siteHours } from './districts';
import { generateCity, lotById } from './generateCity';
import {
  ESTIMATE_SHIFT, ESTIMATE_SPREAD, LOCAL_RANGE, OWN_FACTOR, OWN_RADIUS_M, RIVAL_FACTOR, RIVAL_RADIUS_M, lotEstimate, lotLocalFactor,
  lotTrafficMult, ownNear, rivalsNear, siteFor, sourceProfile, storeSeedFor, streetIntensity,
} from './traffic';
import type { CityLot, CityState, SourceKind, StoreDistrict, TrafficSource } from './types';

/*
 * Ruch w mieście (spec §7.3): natężenie ulic z punktów ruchu, mnożnik lokalu (dzielnica × natężenie lokalne × konkurencja),
 * `siteFor` (lokal miasta → `SiteMods`) i widełki klientów na karcie lokalu. Liczby ekonomii pochodzą z `expectedDailyCustomers`
 * sklepu w lokalu (skala SIM 6: komentarz przy `TRAFFIC_BASE`).
 */

const SEEDS: string[] = [
  'kiełbasa-42', 'kiełbasa-12', 'a', 'b', 'c', 'd',
  ...Array.from({ length: 12 }, (_, i) => `traszka-${i + 1}`),
  ...Array.from({ length: 25 }, (_, i) => `miasto-${i + 1}`),
];
const ESTIMATE_SEEDS = Array.from({ length: 40 }, (_, i) => `estymata-${i + 1}`);

const KINDS: SourceKind[] = ['przystanek', 'szkola', 'uczelnia', 'biurowiec', 'dworzec', 'osiedle'];

const cities = new Map<string, CityState>();
/** Miasto z pamięci podręcznej testu: generator jest czysty, a testy niczego w stanie nie zmieniają. */
function cityOf(seed: string): CityState {
  let c = cities.get(seed);
  if (!c) { c = generateCity(seed); cities.set(seed, c); }
  return c;
}

const nonStart = (c: CityState): CityLot[] => c.lots.filter((l) => l.id !== c.startLotId);

describe('sourceProfile: profil godzinowy i tygodniowy punktów ruchu', () => {
  it('każdy rodzaj, godzina i dzień dają liczbę z [0, 1], a każdy rodzaj ma w tygodniu jakiś ruch', () => {
    for (const kind of KINDS) {
      let total = 0;
      for (const weekend of [false, true]) {
        for (let h = 0; h < 24; h++) {
          const p = sourceProfile(kind, h, weekend);
          expect(p, `${kind} ${h}:00 weekend=${weekend}`).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          total += p;
        }
      }
      expect(total, kind).toBeGreaterThan(0);
    }
  });

  it('biurowiec: szczyty 7–9 i 12–14 w dni robocze, pusto po 18, w weekend pusto po południu', () => {
    const day = (h: number): number => sourceProfile('biurowiec', h, false);
    expect(Math.max(day(7), day(8), day(9))).toBe(1);
    expect(Math.max(day(12), day(13), day(14))).toBeGreaterThanOrEqual(0.8);
    expect(day(10)).toBeLessThan(day(8));
    for (const h of [19, 21, 23, 2]) expect(day(h), `${h}:00`).toBe(0);
    for (let h = 12; h < 24; h++) expect(sourceProfile('biurowiec', h, true), `weekend ${h}:00`).toBe(0);
  });

  it('szkoła milczy w weekend, osiedle i dworzec nie', () => {
    for (let h = 0; h < 24; h++) expect(sourceProfile('szkola', h, true)).toBe(0);
    expect(sourceProfile('osiedle', 12, true)).toBeGreaterThan(sourceProfile('osiedle', 12, false));
    expect(sourceProfile('dworzec', 12, true)).toBeGreaterThan(0.4);
  });
});

describe('natężenie ulic', () => {
  it('każdy odcinek ma 24 liczby całkowite z 0–255, a miasto używa skali (maksimum blisko 255) i ma ciche noce', () => {
    for (const seed of SEEDS) {
      const c = cityOf(seed);
      let peak = 0;
      let night = 0;
      for (const s of c.streets) {
        expect(s.hourly, `${seed} ulica ${s.id}`).toHaveLength(24);
        for (const v of s.hourly) {
          expect(Number.isInteger(v) && v >= 0 && v <= 255, `${seed} ulica ${s.id}: ${v}`).toBe(true);
        }
        peak = Math.max(peak, ...s.hourly);
        night = Math.max(night, s.hourly[3]!);
      }
      expect(peak, `${seed}: najruchliwszy odcinek`).toBeGreaterThanOrEqual(150);
      expect(night, `${seed}: noc o 3:00 jest cichsza niż szczyt`).toBeLessThan(peak / 4);
    }
  });

  it('hourly to natężenie dnia roboczego z streetIntensity, a punkty ruchu są w mieście i obejmują wszystkie rodzaje', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const c = cityOf(seed);
      for (const s of c.streets) for (let h = 0; h < 24; h++) expect(s.hourly[h], `${seed} ulica ${s.id} ${h}:00`).toBe(streetIntensity(c.sources, s, h, false));
      expect(new Set(c.sources.map((p) => p.kind)), seed).toEqual(new Set(KINDS));
      for (const p of c.sources) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y), `${seed}: punkt ${p.kind} w metrach całkowitych`).toBe(true);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(660);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(660);
        expect(p.weight).toBeGreaterThan(0);
      }
    }
  });

  it('odcinki przy biurowcach są puste w weekend po południu (miasto tylko z biurowcami), a w dzień roboczy ruchliwe', () => {
    const c = cityOf('kiełbasa-42');
    const offices: TrafficSource[] = c.sources.filter((p) => p.kind === 'biurowiec');
    expect(offices.length).toBeGreaterThan(0);
    for (const s of c.streets) {
      for (let h = 13; h < 24; h++) expect(streetIntensity(offices, s, h, true), `ulica ${s.id} ${h}:00`).toBe(0);
    }
    expect(Math.max(...c.streets.map((s) => streetIntensity(offices, s, 13, false)))).toBeGreaterThan(50);
  });

  it('w prawdziwym mieście odcinek najbliżej biurowca jest w weekend po południu wyraźnie cichszy niż w dzień roboczy w południe', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const c = cityOf(seed);
      for (const office of c.sources.filter((p) => p.kind === 'biurowiec')) {
        const near = [...c.streets].sort((p, q) => segmentDistance(office, p) - segmentDistance(office, q))[0]!;
        const weekday = streetIntensity(c.sources, near, 13, false);
        const weekend = streetIntensity(c.sources, near, 16, true);
        expect(weekend, `${seed}: biurowiec (${office.x}, ${office.y}), ulica ${near.id}`).toBeLessThan(weekday * 0.75);
      }
    }
  });
});

/** Odległość punktu od odcinka ulicy (m), jak w teście generatora. */
function segmentDistance(p: { x: number; y: number }, s: CityState['streets'][number]): number {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const t = Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.y - s.ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (s.ax + t * dx), p.y - (s.ay + t * dy));
}

describe('lotLocalFactor: natężenie przy wejściu względem średniej dzielnicy', () => {
  it('zawsze w [0,85; 1,15], a dla lokalu startowego dokładnie 1', () => {
    expect(LOCAL_RANGE).toEqual([0.85, 1.15]);
    for (const seed of SEEDS) {
      const c = cityOf(seed);
      expect(lotLocalFactor(c, c.startLotId), seed).toBe(1);
      for (const l of c.lots) {
        const f = lotLocalFactor(c, l.id);
        expect(f, `${seed} lokal ${l.id}`).toBeGreaterThanOrEqual(0.85);
        expect(f).toBeLessThanOrEqual(1.15);
      }
    }
  });

  it('nie jest stałą: lokale różnią się natężeniem, w dzielnicy są i lepsze, i gorsze od średniej, a średni lokal ma ok. 1', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const c = cityOf(seed);
      for (const d of ['osiedle', 'srodmiescie', 'dworzec', 'biurowce'] as StoreDistrict[]) {
        const fs = nonStart(c).filter((l) => l.district === d).map((l) => lotLocalFactor(c, l.id));
        expect(Math.min(...fs), `${seed} ${d}: najgorszy lokal`).toBeLessThan(0.97);
        expect(Math.max(...fs), `${seed} ${d}: najlepszy lokal`).toBeGreaterThan(1.03);
        const mean = fs.reduce((n, f) => n + f, 0) / fs.length;
        expect(mean, `${seed} ${d}: średnia`).toBeGreaterThan(0.95);
        expect(mean).toBeLessThan(1.05);
      }
    }
  });
});

/**
 * Miasto z ręcznie wstawionymi lokalami: cel (0, Śródmieście) w (500, 500), rywale 100 m na wschód (1) i 100 m na północ (2),
 * 200 m na wschód (3), dokładnie `RIVAL_RADIUS_M` na wschód (5), lokal startowy (4) w (60, 60) i jego sąsiad rywal (6) w 100 m.
 * Punkty ruchu z prawdziwego miasta, więc natężenie lokalne jest prawdziwe, a różnice między wariantami robi tylko konkurencja.
 */
const HAND: { id: number; x: number; y: number; district: StoreDistrict }[] = [
  { id: 0, x: 500, y: 500, district: 'srodmiescie' },
  { id: 1, x: 600, y: 500, district: 'srodmiescie' },
  { id: 2, x: 500, y: 400, district: 'srodmiescie' },
  { id: 3, x: 700, y: 500, district: 'srodmiescie' },
  { id: 4, x: 60, y: 60, district: 'osiedle' },
  { id: 5, x: 500 + RIVAL_RADIUS_M, y: 500, district: 'srodmiescie' },
  { id: 6, x: 160, y: 60, district: 'osiedle' },
];

function handCity(rivals: number[]): CityState {
  const base = cityOf('a');
  const spec = base.lots[0]!.spec;
  const lots: CityLot[] = HAND.map((h) => ({
    id: h.id, bx: 0, by: 0, x: h.x, y: h.y, street: 'Testowa', number: h.id + 1, spec, district: h.district,
    state: rivals.includes(h.id) ? 'konkurencja' : h.id === 4 ? 'twoj' : 'zajety',
    brand: rivals.includes(h.id) ? 'szop' : null, package: 50_000, buildDays: 5,
  }));
  return { ...base, lots, startLotId: 4, neighbourLotId: null };
}

describe('konkurencja w promieniu', () => {
  it('stałe z przeglądu balansu: promień 150 m (wcześniej 250 m: rywal w 76% wolnych lokali), ×0,8 za rywala', () => {
    expect(RIVAL_RADIUS_M).toBe(150);
    expect(RIVAL_FACTOR).toBe(0.8);
    // ręczne miasto niżej zakłada rywali w 100 m (bliżej niż promień) i w 200 m (dalej)
    expect(RIVAL_RADIUS_M).toBeGreaterThan(100);
    expect(RIVAL_RADIUS_M).toBeLessThan(200);
  });

  it('rywal w 100 m daje ×0,8, dwóch ×0,64, a rywal w 200 m (albo dokładnie w promieniu) nic nie zmienia', () => {
    const none = lotTrafficMult(handCity([]), 0);
    expect(lotTrafficMult(handCity([1]), 0) / none).toBeCloseTo(0.8, 12);
    expect(lotTrafficMult(handCity([1, 2]), 0) / none).toBeCloseTo(0.64, 12);
    expect(lotTrafficMult(handCity([3]), 0)).toBe(none);
    expect(lotTrafficMult(handCity([5]), 0)).toBe(none);
    expect(lotTrafficMult(handCity([1, 3, 5]), 0) / none).toBeCloseTo(0.8, 12);
  });

  it('rivalsNear: tylko konkurencja bliżej niż promień, z odległością w metrach, od najbliższej; lokal nie jest własnym rywalem', () => {
    expect(rivalsNear(handCity([]), 0)).toEqual([]);
    const near = rivalsNear(handCity([1, 2, 3, 5]), 0);
    expect(near.map((r) => [r.lot.id, r.meters])).toEqual([[1, 100], [2, 100]]);
    expect(rivalsNear(handCity([0]), 0)).toEqual([]);
    expect(rivalsNear(handCity([6]), 4).map((r) => [r.lot.id, r.meters])).toEqual([[6, 100]]);
  });

  it('lokal startowy ma mnożnik 1 także z rywalem w pobliżu (sklep startowy nie ma site), a lotTrafficMult liczy się wszędzie indziej', () => {
    expect(lotTrafficMult(handCity([6]), 4)).toBe(1);
    expect(lotTrafficMult(handCity([]), 4)).toBe(1);
  });
});

describe('lotTrafficMult', () => {
  it('to ruch dzielnicy × natężenie lokalne × 0,8^liczba rywali w promieniu', () => {
    let withRivals = 0;
    for (const seed of SEEDS) {
      const c = cityOf(seed);
      for (const l of nonStart(c)) {
        const n = rivalsNear(c, l.id).length;
        if (n > 0) withRivals++;
        expect(lotTrafficMult(c, l.id), `${seed} lokal ${l.id}`).toBeCloseTo(DISTRICTS[l.district].traffic * lotLocalFactor(c, l.id) * RIVAL_FACTOR ** n, 12);
      }
      expect(lotTrafficMult(c, c.startLotId), `${seed}: start`).toBe(1);
    }
    expect(withRivals, 'zestaw seedów ma lokale z konkurencją w pobliżu').toBeGreaterThan(20);
  });
});

describe('storeSeedFor i siteFor', () => {
  const FLAGS = { extra: true, ownCosts: false, firmDebt: true, weatherHash: 12345 } as const;

  it('storeSeedFor to subSeed(seed, "store:" + id)', () => {
    expect(storeSeedFor('abc', 7)).toBe(subSeed('abc', 'store:7'));
    expect(storeSeedFor('abc', 7)).toBe('abc:store:7');
  });

  it('lokal z Dworca: dzielnica, kradzieże i koszyk z DISTRICTS, lokal miasta i flagi przepisane', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const c = cityOf(seed);
      const lot = c.lots.find((l) => l.district === 'dworzec')!;
      const site = siteFor(c, lot.id, FLAGS);
      expect(site.district).toBe('dworzec');
      const d = DISTRICTS.dworzec;
      expect(site.theft).toBe(d.theft);
      expect(site.basket).toBe(d.basket);
      expect(site.patience).toBe(d.patience);
      expect(site.repPenalty).toBe(d.repPenalty);
      expect(site.weekendTraffic).toBeNull();
      expect(site.hours).toBe(siteHours('dworzec'));
      expect(site.lot).toBe(lot.spec);
      expect(site.traffic).toBe(lotTrafficMult(c, lot.id));
      expect([site.extra, site.ownCosts, site.firmDebt, site.weatherHash]).toEqual([true, false, true, 12345]);
    }
  });

  it('Biurowce: weekend z dzielnicy razem z natężeniem lokalnym i konkurencją; Śródmieście: oczekiwania wysokie', () => {
    const c = cityOf('kiełbasa-42');
    for (const l of nonStart(c).filter((x) => x.district === 'biurowce')) {
      const site = siteFor(c, l.id, FLAGS);
      expect(site.weekendTraffic).toBeCloseTo(site.traffic * (DISTRICTS.biurowce.weekendTraffic! / DISTRICTS.biurowce.traffic), 12);
      expect(site.hours).toBe(siteHours('biurowce'));
    }
    const mid = siteFor(c, nonStart(c).find((l) => l.district === 'srodmiescie')!.id, FLAGS);
    const d = DISTRICTS.srodmiescie;
    expect([mid.basket, mid.patience, mid.repPenalty, mid.theft]).toEqual([d.basket, d.patience, d.repPenalty, d.theft]);
    expect(mid.patience).toBeLessThan(0);
    expect(mid.repPenalty).toBeGreaterThan(1);
  });

  it('lokal startowy: NEUTRAL_SITE z flagami (sklep startowy gra jak dziś), także gdy rywal jest w pobliżu', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const c = cityOf(seed);
      expect(siteFor(c, c.startLotId, FLAGS)).toEqual({ ...NEUTRAL_SITE, ...FLAGS });
    }
    const hand = handCity([6]);
    expect(siteFor(hand, 4, FLAGS)).toEqual({ ...NEUTRAL_SITE, ...FLAGS });
  });

  it('lokal na Osiedlu nie jest lokalem startowym: ma własny lokal i mnożnik z natężenia', () => {
    const c = cityOf('traszka-3');
    const lot = nonStart(c).find((l) => l.district === 'osiedle')!;
    const site = siteFor(c, lot.id, FLAGS);
    expect(site.lot).toBe(lot.spec);
    expect(site.district).toBe('osiedle');
    expect(site.traffic).toBe(lotTrafficMult(c, lot.id));
    expect(site.hours, 'Osiedle gra rozkład godzin jak dziś').toBeNull();
  });
});

describe('lotEstimate: widełki klientów na karcie lokalu', () => {
  const freeLot = (c: CityState): CityLot => c.lots.find((l) => l.state === 'wolny')!;

  it('stałe z projektu: ±25%, przesunięcie środka do 15%', () => {
    expect(ESTIMATE_SPREAD).toBe(0.25);
    expect(ESTIMATE_SHIFT).toBe(0.15);
  });

  it('prawdziwa liczba zawsze w [lo, hi], granice w dziesiątkach, a hi / lo to 1,25 / 0,75', () => {
    for (const seed of ESTIMATE_SEEDS) {
      const c = cityOf(seed);
      const lot = freeLot(c);
      const e = lotEstimate(seed, c, lot.id);
      expect(e.trueDaily, `${seed} lokal ${lot.id}`).toBeGreaterThanOrEqual(e.lo);
      expect(e.trueDaily).toBeLessThanOrEqual(e.hi);
      expect(e.lo % 10).toBe(0);
      expect(e.hi % 10).toBe(0);
      // granice to 0,75 i 1,25 środka, każda zaokrąglona do dziesiątek (błąd a, b ≤ 5): (H + b) / (L + a) − H / L = (b − a · H / L) / lo,
      // czyli co najwyżej (5 + 5 · 5/3) / lo = 13,3 / lo. Przy kilkuset klientach to ±0,05, w Śródmieściu (ruch 0,8) ok. ±0,1.
      const tolerance = (5 + 5 * (1.25 / 0.75)) / e.lo + 1e-9;
      expect(e.hi / e.lo, `${seed}: ${e.lo}–${e.hi}`).toBeGreaterThan(1.25 / 0.75 - tolerance);
      expect(e.hi / e.lo).toBeLessThan(1.25 / 0.75 + tolerance);
      expect(e.who).toHaveLength(2);
      expect(new Set(e.who).size).toBe(2);
      for (const k of e.who) expect(KINDS).toContain(k);
    }
  });

  it('środek widełek jest przesunięty: na 40 seedach co najmniej połowa estymat ma środek dalej niż 2% od prawdziwej liczby, żadna dalej niż 17%', () => {
    let off = 0;
    for (const seed of ESTIMATE_SEEDS) {
      const c = cityOf(seed);
      const e = lotEstimate(seed, c, freeLot(c).id);
      const offset = Math.abs((e.lo + e.hi) / 2 - e.trueDaily) / e.trueDaily;
      if (offset > 0.02) off++;
      expect(offset, seed).toBeLessThan(ESTIMATE_SHIFT + 0.02);
    }
    expect(off).toBeGreaterThanOrEqual(20);
  });

  it('jest deterministyczne i zależy od lokalu: ten sam seed daje to samo, a lokale mają różne liczby', () => {
    const c = cityOf('kiełbasa-42');
    const free = c.lots.filter((l) => l.state === 'wolny');
    const first = free.map((l) => lotEstimate('kiełbasa-42', c, l.id));
    expect(free.map((l) => lotEstimate('kiełbasa-42', c, l.id))).toEqual(first);
    expect(new Set(first.map((e) => e.trueDaily)).size).toBeGreaterThan(2);
  });

  it('trueDaily to expectedDailyCustomers sklepu z lokalu miasta z mnożnikiem ruchu lokalu (flagi dodatkowego sklepu)', () => {
    const seed = 'kiełbasa-42';
    const c = cityOf(seed);
    for (const lot of c.lots.filter((l) => l.state === 'wolny')) {
      const sSeed = storeSeedFor(seed, lot.id);
      const site = siteFor(c, lot.id, { extra: true, ownCosts: false, firmDebt: true, weatherHash: null });
      const info = { ...computeStoreInfo(layoutFor(sSeed, 0, lot.spec)), site };
      const bare = { ...info, site: undefined };
      const withMult = expectedDailyCustomers(createEconomy(sSeed, info), info);
      const without = expectedDailyCustomers(createEconomy(sSeed, bare), bare);
      expect(withMult, `lokal ${lot.id}`).toBeCloseTo(without * site.traffic, 9);
      expect(lotEstimate(seed, c, lot.id).trueDaily, `lokal ${lot.id}`).toBe(withMult);
    }
  });

  it('lokal o mnożniku 1 (startowy, Osiedle) daje trueDaily 250–450 (skala SIM 6: ok. 300–350 klientów dziennie na start)', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const seed of SEEDS) {
      const c = cityOf(seed);
      const e = lotEstimate(seed, c, c.startLotId);
      lo = Math.min(lo, e.trueDaily);
      hi = Math.max(hi, e.trueDaily);
      // sklep startowy ma układ z seeda, więc jego liczba to liczba z gry
      const info = computeStoreInfo(layoutFor(seed, 0));
      expect(e.trueDaily, `${seed}: start`).toBe(expectedDailyCustomers(createEconomy(seed, info), info));
    }
    expect(lo).toBeGreaterThanOrEqual(250);
    expect(hi).toBeLessThanOrEqual(450);
  });

  it('lokale Osiedla z mnożnikiem bliskim 1 też mieszczą się w 250–450', () => {
    let n = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      const c = cityOf(seed);
      for (const l of nonStart(c).filter((x) => x.district === 'osiedle' && x.state === 'zajety').slice(0, 6)) {
        const mult = lotTrafficMult(c, l.id);
        if (mult < 0.97 || mult > 1.03) continue;
        const e = lotEstimate(seed, c, l.id);
        expect(e.trueDaily, `${seed} lokal ${l.id} (mnożnik ${mult.toFixed(3)})`).toBeGreaterThanOrEqual(250);
        expect(e.trueDaily).toBeLessThanOrEqual(450);
        n++;
      }
    }
    expect(n).toBeGreaterThan(5);
  });

  describe('lokal „po Traszce” (relet): układ i wyposażenie zamkniętego sklepu', () => {
    const fittings1: StoreFittings = { upgrades: { ulotki: 3, szkolenie: 1 }, equipment: [{ id: 'sco', slot: null }], remontLevel: 1 };
    const reletFor = (seed: string, c: CityState, lotId: number, level: number, fittings: StoreFittings = fittings1) => {
      const lot = lotById(c, lotId);
      const storeSeed = lotId === c.startLotId ? seed : storeSeedFor(seed, lotId);
      return { storeSeed, lot, input: { layout: layoutFor(storeSeed, level, lot.spec), fittings } };
    };

    it('bez wyposażenia i z układem poziomu 0 widełki są dokładnie takie jak dla wolnego lokalu (bez `relet` nic się nie zmienia)', () => {
      for (const seed of SEEDS.slice(0, 8)) {
        const c = cityOf(seed);
        for (const lot of [freeLot(c), lotById(c, c.startLotId)]) {
          const { input } = reletFor(seed, c, lot.id, 0, { upgrades: {}, equipment: [], remontLevel: 0 });
          expect(lotEstimate(seed, c, lot.id, input), `${seed} lokal ${lot.id}`).toEqual(lotEstimate(seed, c, lot.id));
          expect(lotEstimate(seed, c, lot.id, undefined)).toEqual(lotEstimate(seed, c, lot.id));
        }
      }
    });

    it('trueDaily to expectedDailyCustomers sklepu otwartego z tego układu i wyposażenia (jak `reopenStoreAt`), a widełki go obejmują', () => {
      for (const seed of SEEDS.slice(0, 8)) {
        const c = cityOf(seed);
        for (const lot of [freeLot(c), lotById(c, c.startLotId)]) {
          const { storeSeed, input } = reletFor(seed, c, lot.id, 1);
          const site = siteFor(c, lot.id, { extra: true, ownCosts: false, firmDebt: true, weatherHash: null });
          const info = { ...computeStoreInfo(input.layout), site };
          const real = expectedDailyCustomers(createEconomy(storeSeed, info, undefined, undefined, input.fittings), info);
          const e = lotEstimate(seed, c, lot.id, input);
          expect(e.trueDaily, `${seed} lokal ${lot.id}`).toBe(real);
          expect(e.lo, `${seed} lokal ${lot.id}`).toBeLessThanOrEqual(real);
          expect(e.hi).toBeGreaterThanOrEqual(real);
          expect(e.trueDaily, 'remont i ulotki zwiększają ruch ponad układ poziomu 0').toBeGreaterThan(1.2 * lotEstimate(seed, c, lot.id).trueDaily);
          expect(e.who).toEqual(lotEstimate(seed, c, lot.id).who);   // „kto przychodzi” zależy od lokalu, nie od wyposażenia
        }
      }
    });
  });

  it('who: dwa najbliższe rodzaje punktów ruchu, najbliższy pierwszy', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const c = cityOf(seed);
      const lot = lotById(c, freeLot(c).id);
      const nearest = (kind: SourceKind): number => Math.min(...c.sources.filter((p) => p.kind === kind).map((p) => Math.hypot(p.x - lot.x, p.y - lot.y)));
      const expected = [...new Set(c.sources.map((p) => p.kind))].sort((p, q) => nearest(p) - nearest(q)).slice(0, 2);
      expect(lotEstimate(seed, c, lot.id).who, seed).toEqual(expected);
    }
  });
});

// --- Własne sklepy w promieniu (kanibalizacja, etap 4b §5.4) -------------------------------------------------------------

describe('własne sklepy w promieniu: kanibalizacja', () => {
  const FLAGS = { extra: true, ownCosts: false, firmDebt: true, weatherHash: 12345 } as const;
  const digest = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');

  it('stałe [W] start: promień 150 m jak rywale, ×0,9 za każdy własny sklep (ręczne miasto ma lokale w 100 m i w 200 m)', () => {
    expect(OWN_RADIUS_M).toBe(150);
    expect(OWN_FACTOR).toBe(0.9);
    expect(OWN_RADIUS_M).toBeGreaterThan(100);
    expect(OWN_RADIUS_M).toBeLessThan(200);
  });

  it('ownNear: własne lokale bliżej niż 150 m, od najbliższego, bez siebie', () => {
    const c = handCity([]);
    expect(ownNear(c, 0, [])).toEqual([]);
    // 3 (200 m) i 5 (dokładnie 150 m) są za daleko, 0 to sam lokal; remis odległości rozstrzyga numer lokalu
    expect(ownNear(c, 0, [5, 3, 2, 1, 0])).toEqual([{ lotId: 1, meters: 100 }, { lotId: 2, meters: 100 }]);
    expect(ownNear(c, 0, [0])).toEqual([]);
    expect(ownNear(c, 4, [6, 0])).toEqual([{ lotId: 6, meters: 100 }]);
    // rywal nie jest własnym sklepem i odwrotnie: ownNear patrzy tylko na listę `own`, nie na stan lokalu z generatora
    expect(ownNear(handCity([1]), 0, [])).toEqual([]);
    expect(ownNear(handCity([1]), 0, [1])).toEqual([{ lotId: 1, meters: 100 }]);
  });

  it('siteFor z own: traffic = bez own × 0.9^k (k własnych w promieniu), weekendTraffic tak samo; lokal startowy dalej NEUTRAL_SITE', () => {
    const hand = handCity([]);
    const base = siteFor(hand, 0, FLAGS);
    expect(siteFor(hand, 0, FLAGS, [1]).traffic / base.traffic).toBeCloseTo(0.9, 12);
    expect(siteFor(hand, 0, FLAGS, [1, 2]).traffic / base.traffic).toBeCloseTo(0.81, 12);
    expect(siteFor(hand, 0, FLAGS, [3, 5, 0]).traffic).toBe(base.traffic);
    // rywal i własny sklep naraz: 0,8 × 0,9
    expect(siteFor(handCity([1]), 0, FLAGS, [2]).traffic / base.traffic).toBeCloseTo(0.72, 12);
    // reszta lokalu (dzielnica, koszyk, kradzieże, flagi) bez zmian
    const { traffic: _a, weekendTraffic: _b, ...rest } = siteFor(hand, 0, FLAGS, [1, 2]);
    const { traffic: _c, weekendTraffic: _d, ...restBase } = base;
    expect(rest).toEqual(restBase);

    // prawdziwe miasto, Biurowce (mają ruch weekendowy): własne sklepy to inne lokale miasta w promieniu
    let checked = 0;
    for (const seed of SEEDS.slice(0, 12)) {
      const c = cityOf(seed);
      for (const l of nonStart(c).filter((x) => x.district === 'biurowce')) {
        const near = c.lots.filter((o) => o.id !== l.id && (o.x - l.x) * (o.x - l.x) + (o.y - l.y) * (o.y - l.y) < OWN_RADIUS_M * OWN_RADIUS_M).map((o) => o.id);
        const far = c.lots.filter((o) => o.id !== l.id && !near.includes(o.id)).map((o) => o.id).slice(0, 3);
        if (near.length === 0) continue;
        const without = siteFor(c, l.id, FLAGS);
        const own = siteFor(c, l.id, FLAGS, [...far, ...near]);
        let k = 1;
        for (let i = 0; i < near.length; i++) k *= 0.9;
        expect(ownNear(c, l.id, [...far, ...near]).map((o) => o.lotId).sort((a, b) => a - b)).toEqual([...near].sort((a, b) => a - b));
        expect(own.traffic / without.traffic, `${seed} lokal ${l.id}`).toBeCloseTo(k, 12);
        expect(own.weekendTraffic! / without.weekendTraffic!, `${seed} lokal ${l.id}: weekend`).toBeCloseTo(k, 12);
        checked++;
      }
      // lokal startowy: własny sklep obok nie zmienia sklepu startowego (gra jak zatwierdzony balans 4a.1)
      const beside = c.lots.filter((o) => o.id !== c.startLotId).map((o) => o.id);
      expect(siteFor(c, c.startLotId, FLAGS, beside), seed).toEqual({ ...NEUTRAL_SITE, ...FLAGS });
    }
    expect(checked, 'zestaw seedów ma lokale Biurowców z sąsiadami w promieniu').toBeGreaterThan(5);
    expect(siteFor(hand, 4, FLAGS, [6, 0])).toEqual({ ...NEUTRAL_SITE, ...FLAGS });
  });

  it('siteFor bez own ≡ dzisiejszy wynik co do bitu (Object.is na traffic)', () => {
    const seeds = ['kiełbasa-42', 'kiełbasa-12', 'a', 'b', 'traszka-1', 'traszka-3', 'miasto-1', 'miasto-2'];
    const sites = seeds.flatMap((seed) => cityOf(seed).lots.map((l) => siteFor(cityOf(seed), l.id, FLAGS)));
    // skrót wyników `siteFor` z kodu sprzed etapu 4b (89149ab) na tych samych miastach: JSON liczb zmiennoprzecinkowych jest dokładny
    expect(sites).toHaveLength(2168);
    expect(digest(sites)).toBe('8a3adebc33fedfd2cf124aec95e1d83f23cb996ff7f8f68f9df3c0e74cbc6ffd');
    for (const seed of seeds) {
      const c = cityOf(seed);
      for (const l of c.lots) {
        const today = siteFor(c, l.id, FLAGS);
        // pusta lista i własne sklepy poza promieniem nie mnożą przez 1: wynik to te same bity
        const far = c.lots.filter((o) => o.id !== l.id && (o.x - l.x) * (o.x - l.x) + (o.y - l.y) * (o.y - l.y) >= OWN_RADIUS_M * OWN_RADIUS_M).map((o) => o.id);
        for (const own of [[], far]) {
          const site = siteFor(c, l.id, FLAGS, own);
          expect(Object.is(site.traffic, today.traffic), `${seed} lokal ${l.id}`).toBe(true);
          expect(Object.is(site.weekendTraffic, today.weekendTraffic)).toBe(true);
          expect(site).toEqual(today);
        }
        if (l.id !== c.startLotId) expect(Object.is(today.traffic, lotTrafficMult(c, l.id))).toBe(true);
      }
    }
  }, 20_000);

  it('lotEstimate z own: trueDaily mniejsze niż bez own, gdy własny sklep jest w promieniu', () => {
    // skrót widełek z kodu sprzed etapu 4b (89149ab): bez `own` nic się nie zmienia
    const est = ['kiełbasa-42', 'traszka-1'].flatMap((seed) => cityOf(seed).lots.map((l) => lotEstimate(seed, cityOf(seed), l.id)));
    expect(digest(est)).toBe('1c96bd570d37435b27c517659bb1d86cc0b31d8dcd748a220cbb78f1fb394e3f');

    let checked = 0;
    for (const seed of SEEDS.slice(0, 8)) {
      const c = cityOf(seed);
      for (const l of c.lots.filter((x) => x.state === 'wolny')) {
        const near = c.lots.filter((o) => o.id !== l.id && (o.x - l.x) * (o.x - l.x) + (o.y - l.y) * (o.y - l.y) < OWN_RADIUS_M * OWN_RADIUS_M);
        if (near.length === 0) continue;
        const without = lotEstimate(seed, c, l.id);
        const own = lotEstimate(seed, c, l.id, undefined, [near[0]!.id]);
        expect(own.trueDaily, `${seed} lokal ${l.id}`).toBeLessThan(without.trueDaily);
        expect(own.trueDaily).toBeGreaterThanOrEqual(own.lo);
        expect(own.trueDaily).toBeLessThanOrEqual(own.hi);
        expect(own.who).toEqual(without.who);
        expect(lotEstimate(seed, c, l.id, undefined, [])).toEqual(without);
        checked++;
      }
    }
    expect(checked, 'wolne lokale z sąsiadem w promieniu').toBeGreaterThan(3);
    // lokal startowy: widełki jak bez własnych sklepów (NEUTRAL_SITE)
    const c = cityOf('kiełbasa-42');
    const others = c.lots.filter((l) => l.id !== c.startLotId).map((l) => l.id);
    expect(lotEstimate('kiełbasa-42', c, c.startLotId, undefined, others)).toEqual(lotEstimate('kiełbasa-42', c, c.startLotId));
  }, 30_000);
});
