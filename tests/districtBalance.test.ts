import { describe, expect, it } from 'vitest';
import { DISTRICTS, districtSite } from '@/sim/city/districts';
import { generateCity } from '@/sim/city/generateCity';
import type { StoreDistrict } from '@/sim/city/types';
import { MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { applyCommand } from '@/sim/economy/commands';
import { installmentLimit, planFor } from '@/sim/economy/franchisee';
import type { BotName } from '@/sim/economy/tycoon/bots';
import { playBot, type EconomyRun } from '@/sim/economy/tycoon/economyEnv';
import { TRUST } from '@/sim/economy/tycoon/trust';

/**
 * Cele balansu dzielnic (spec §8.4) na botach z harnessu SIM 6: drugi sklep w środku widełek dzielnicy (`districtSite`: ruch dzielnicy,
 * natężenie lokalne 1, bez rywali, flagi dodatkowego sklepu) gra 92 dni od 1 września, czyli trzy zamknięte miesiące z remanentem 30 listopada,
 * na ośmiu seedach. Liczby `DISTRICTS` stroi ten przegląd: test czyta wyniki, a nie powtarza liczb z tabeli. Wynik sklepu to suma
 * `history[].profit` (wynik bez rat, jak w statusie Partnera).
 *
 * Przebiegi są ciężkie (ok. 100 pełnych gier), więc liczą się raz na parę (bot, dzielnica) i dzielą je testy. Jeśli któryś cel przestanie
 * się trzymać po zmianie ekonomii, popraw `DISTRICTS`, a nie próg: te progi są z projektu.
 */

const SEEDS = ['traszka-1', 'kopytka-541', 'makieta', 'lublin-9', 'seed-3', 'kiełbasa-42', 'warszawa-7', 'poznan-12'];
const DAYS = 92;
/** Czas na kilkadziesiąt pełnych gier (cały zestaw równolegle obciąża maszynę, więc więcej niż domyślne 5 s; jak w `tests/rankedSeason.test.ts`). */
const TIMEOUT = 180_000;
const DISTRICT_IDS = Object.keys(DISTRICTS) as StoreDistrict[];
const OTHERS = DISTRICT_IDS.filter((d) => d !== 'osiedle');

interface Result {
  /** Suma wyników trzech zamkniętych miesięcy. */
  profit: number;
  /** Obsłużeni klienci i ci, którzy odeszli z kolejki. */
  customers: number;
  lost: number;
  revenue: number;
  /** Nadwyżka z remanentów (potrącenie z przelewu), zł. */
  remanent: number;
  months: number;
}

const cache = new Map<string, Result[]>();

/** Jeden bot w jednej dzielnicy na wszystkich seedach; `sco`: kupuje kasę samoobsługową przed pierwszą minutą (bez kamer). */
function runs(bot: BotName, district: StoreDistrict, sco = false): Result[] {
  const key = `${bot}:${district}:${sco}`;
  let out = cache.get(key);
  if (!out) {
    out = SEEDS.map((seed) => {
      const setup = sco ? (run: EconomyRun): void => {
        expect(applyCommand(run.state, run.info, { type: 'buyEquipment', id: 'sco' }).result.ok, `${seed}: kasa samoobsługowa`).toBe(true);
      } : undefined;
      const play = playBot(bot, seed, DAYS * MINUTES_PER_DAY, districtSite(district), setup);
      const s = play.state;
      return {
        profit: s.history.reduce((n, h) => n + h.profit, 0),
        customers: s.total.customers,
        lost: s.total.lost,
        revenue: s.total.revenue,
        remanent: play.reports.reduce((n, r) => n + (r.statement?.remanent ?? 0), 0),
        months: s.history.length,
      };
    });
    cache.set(key, out);
  }
  return out;
}

const sum = (rs: Result[], f: (r: Result) => number): number => rs.reduce((n, r) => n + f(r), 0);
const mean = (rs: Result[], f: (r: Result) => number): number => sum(rs, f) / rs.length;

describe('balans dzielnic na botach (spec §8.4)', () => {
  it('92 dni to trzy zamknięte miesiące (z remanentem 30 listopada) i żadna gra nie kończy się wcześniej', () => {
    for (const d of DISTRICT_IDS) {
      for (const r of runs('bierny', d)) expect(r.months, d).toBe(3);
    }
  }, TIMEOUT);

  it('mistrz i decydent zarabiają na drugim sklepie w każdej dzielnicy w ±30% wyniku z osiedla', () => {
    for (const bot of ['mistrz', 'decydent'] as const) {
      const osiedle = sum(runs(bot, 'osiedle'), (r) => r.profit);
      expect(osiedle, `${bot}: osiedle zarabia`).toBeGreaterThan(0);
      for (const d of OTHERS) {
        const ratio = sum(runs(bot, d), (r) => r.profit) / osiedle;
        expect(ratio, `${bot} w dzielnicy ${d}: wynik względem osiedla`).toBeGreaterThanOrEqual(0.7);
        expect(ratio, `${bot} w dzielnicy ${d}: wynik względem osiedla`).toBeLessThanOrEqual(1.3);
      }
    }
  }, TIMEOUT);

  it('bierny traci w srodmiesciu więcej niż na osiedlu', () => {
    // 1) w złotych: tyle, ile bierny zostawia na stole wobec mistrza w tej samej dzielnicy (koszyk i oczekiwania powiększają każdą stratę)
    const gap = (d: StoreDistrict): number => sum(runs('mistrz', d), (r) => r.profit) - sum(runs('bierny', d), (r) => r.profit);
    expect(gap('osiedle'), 'na osiedlu bierny też traci wobec mistrza').toBeGreaterThan(0);
    expect(gap('srodmiescie')).toBeGreaterThan(gap('osiedle'));

    // 2) klienci, którzy odeszli z kolejki (oczekiwania: cierpliwość −4 osoby): u biernego dwa razy większy udział niż na osiedlu
    const walkedOut = (d: StoreDistrict): number => {
      const rs = runs('bierny', d);
      return sum(rs, (r) => r.lost) / sum(rs, (r) => r.customers + r.lost);
    };
    expect(walkedOut('osiedle'), 'na osiedlu bierny też kogoś gubi').toBeGreaterThan(0);
    expect(walkedOut('srodmiescie')).toBeGreaterThanOrEqual(2 * walkedOut('osiedle'));
  }, TIMEOUT);

  it('srodmiescie: obrót na klienta ≥ 1,25× osiedla; dworzec: klientów ≥ 1,3× osiedla', () => {
    for (const bot of ['bierny', 'mistrz'] as const) {
      const perCustomer = (d: StoreDistrict): number => sum(runs(bot, d), (r) => r.revenue) / sum(runs(bot, d), (r) => r.customers);
      expect(perCustomer('srodmiescie') / perCustomer('osiedle'), `${bot}: obrót na klienta`).toBeGreaterThanOrEqual(1.25);

      // klienci to ci, którzy przyszli: obsłużeni i ci, którzy odeszli z kolejki (ile obsłuży sklep, zależy jeszcze od jego przepustowości)
      const came = (d: StoreDistrict): number => sum(runs(bot, d), (r) => r.customers + r.lost);
      expect(came('dworzec') / came('osiedle'), `${bot}: klienci Dworca`).toBeGreaterThanOrEqual(1.3);
    }
  }, TIMEOUT);

  it('dworzec, bierny bez SCO: remanent kilka tysięcy zł; z SCO bez kamer wyraźnie więcej (≥ 3×)', () => {
    const plain = mean(runs('bierny', 'dworzec'), (r) => r.remanent);
    expect(plain, 'bez SCO').toBeGreaterThanOrEqual(2_000);
    expect(plain, 'bez SCO').toBeLessThanOrEqual(9_000);
    const withSco = mean(runs('bierny', 'dworzec', true), (r) => r.remanent);
    expect(withSco, 'z SCO bez kamer').toBeGreaterThanOrEqual(3 * plain);
    // Osiedle z tą samą kasą płaci mniej: o resztę robi mnożnik kradzieży Dworca
    expect(withSco).toBeGreaterThan(mean(runs('bierny', 'osiedle', true), (r) => r.remanent));
  }, TIMEOUT);

  it('rata pakietu każdego wolnego lokalu mieści się w limicie nowego sklepu (35% × 25 tys. zł, zaufanie startowe)', () => {
    const limit = installmentLimit([], TRUST.start);
    for (const d of DISTRICT_IDS) expect(planFor(DISTRICTS[d].package[1]).monthly, `górna granica pakietu w dzielnicy ${d}`).toBeLessThanOrEqual(limit);
    let free = 0;
    for (let i = 1; i <= 60; i++) {
      const city = generateCity(`miasto-${i}`);
      for (const lot of city.lots.filter((l) => l.state === 'wolny')) {
        free++;
        expect(planFor(lot.package).monthly, `miasto-${i}, lokal ${lot.id}`).toBeLessThanOrEqual(limit);
      }
    }
    expect(free, 'zestaw miast ma wolne lokale').toBeGreaterThan(200);
  });
});
