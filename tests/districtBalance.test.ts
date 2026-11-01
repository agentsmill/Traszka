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
/**
 * Czas na kilkadziesiąt pełnych gier: ten sam wzorzec co `TIMEOUT` w `tests/rankedSeason.test.ts` (tam 120 s), ale 180 s, bo jeden test liczy
 * ok. 60 gier (osobno ok. 35 s), a cały zestaw równolegle obciąża maszynę (domyślne 5 s nie wystarcza).
 */
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

interface Variant {
  /** Kupuje kasę samoobsługową przed pierwszą minutą (bez kamer). */
  sco?: boolean;
  /** Ta sama dzielnica z wyłączonymi oczekiwaniami klientów (cierpliwość 0, kary reputacji ×1), reszta bez zmian: do pomiaru, ile one kosztują. */
  calm?: boolean;
}

/** Jeden bot w jednej dzielnicy na wszystkich seedach. */
function runs(bot: BotName, district: StoreDistrict, { sco = false, calm = false }: Variant = {}): Result[] {
  const key = `${bot}:${district}:${sco}:${calm}`;
  let out = cache.get(key);
  if (!out) {
    out = SEEDS.map((seed) => {
      const setup = sco ? (run: EconomyRun): void => {
        expect(applyCommand(run.state, run.info, { type: 'buyEquipment', id: 'sco' }).result.ok, `${seed}: kasa samoobsługowa`).toBe(true);
      } : undefined;
      const site = calm ? { ...districtSite(district), patience: 0, repPenalty: 1 } : districtSite(district);
      const play = playBot(bot, seed, DAYS * MINUTES_PER_DAY, site, setup);
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
    const profit = (bot: BotName, d: StoreDistrict, v?: Variant): number => sum(runs(bot, d, v), (r) => r.profit);
    const walkedOut = (bot: BotName, d: StoreDistrict, v?: Variant): number => {
      const rs = runs(bot, d, v);
      return sum(rs, (r) => r.lost) / sum(rs, (r) => r.customers + r.lost);
    };

    // 1) w złotych: tyle, ile bierny zostawia na stole wobec mistrza w tej samej dzielnicy. To tylko kontrola sensu: różnica rośnie też z samego
    //    koszyka (przy wyłączonych oczekiwaniach też jest większa niż na Osiedlu), więc nie dowodzi, że winne są oczekiwania.
    const gap = (d: StoreDistrict): number => profit('mistrz', d) - profit('bierny', d);
    expect(gap('osiedle'), 'na osiedlu bierny też traci wobec mistrza').toBeGreaterThan(0);
    expect(gap('srodmiescie')).toBeGreaterThan(gap('osiedle'));

    // 2) mechanizm: to samo Śródmieście z wyłączonymi oczekiwaniami (cierpliwość 0, kary ×1). Oczekiwania kosztują biernego wynik (zmierzone:
    //    1,5% wyniku, próg 0,5%) i wyganiają klientów z kolejki (zmierzone: +0,29 pkt proc., próg +0,1). Mistrza kosztują jeszcze więcej
    //    (1,9% wyniku; średnio na seed 253 klientów więcej odchodzi z kolejki wobec 87 u biernego), więc nie twierdzimy, że bierny traci na
    //    oczekiwaniach więcej niż mistrz, tylko że traci więcej niż na Osiedlu, gdzie oczekiwania są neutralne.
    const calm = { calm: true };
    const cost = profit('bierny', 'srodmiescie', calm) - profit('bierny', 'srodmiescie');
    expect(cost, 'oczekiwania kosztują biernego wynik').toBeGreaterThanOrEqual(0.005 * profit('bierny', 'srodmiescie', calm));
    expect(walkedOut('bierny', 'srodmiescie') - walkedOut('bierny', 'srodmiescie', calm), 'oczekiwania wyganiają klientów z kolejki')
      .toBeGreaterThanOrEqual(0.001);

    // 3) klienci, którzy odeszli z kolejki: u biernego w Śródmieściu więcej niż na Osiedlu (zmierzone: 0,29% wobec 0,14%)
    expect(walkedOut('bierny', 'osiedle'), 'na osiedlu bierny też kogoś gubi').toBeGreaterThan(0);
    expect(walkedOut('bierny', 'srodmiescie')).toBeGreaterThan(walkedOut('bierny', 'osiedle'));
  }, TIMEOUT);

  it('srodmiescie: obrót na klienta ≥ 1,25× osiedla; dworzec: obsłużonych (bierny) i przychodzących klientów ≥ 1,3× osiedla', () => {
    for (const bot of ['bierny', 'mistrz'] as const) {
      const perCustomer = (d: StoreDistrict): number => sum(runs(bot, d), (r) => r.revenue) / sum(runs(bot, d), (r) => r.customers);
      expect(perCustomer('srodmiescie') / perCustomer('osiedle'), `${bot}: obrót na klienta`).toBeGreaterThanOrEqual(1.25);
    }

    // „Klientów” na Dworcu liczymy dwojako, bo sama liczba obsłużonych zależy od przepustowości kas, a nie tylko od ruchu:
    //  - obsłużeni (dosłownie): bierny 1,39× Osiedla (zapas 7% nad progiem), mistrz 1,30× (bez zapasu: kasy ucinają Dworzec, 4% klientów
    //    odchodzi z kolejki), więc u mistrza tego nie sprawdzamy;
    //  - przyszli = obsłużeni + odeszli z kolejki: bierny 1,42× (zapas 9%), mistrz 1,35× (zapas 4%).
    //  Cel projektu to ruch ok. 1,4× (spec §8.1); 1,3× to próg z planu, z zapasem 4–9% nad zmierzonymi wartościami. Zapas mistrza (4%)
    //  jest cienki, ale to wynik deterministycznej gry, a nie losowania; gdyby ruch Dworca spadł, test to pokaże.
    const served = (bot: BotName, d: StoreDistrict): number => sum(runs(bot, d), (r) => r.customers);
    const came = (bot: BotName, d: StoreDistrict): number => sum(runs(bot, d), (r) => r.customers + r.lost);
    expect(served('bierny', 'dworzec') / served('bierny', 'osiedle'), 'bierny: obsłużeni klienci Dworca').toBeGreaterThanOrEqual(1.3);
    for (const bot of ['bierny', 'mistrz'] as const) {
      expect(came(bot, 'dworzec') / came(bot, 'osiedle'), `${bot}: klienci, którzy przyszli na Dworzec`).toBeGreaterThanOrEqual(1.3);
    }
  }, TIMEOUT);

  it('dworzec, bierny bez SCO: remanent kilka tysięcy zł; z SCO bez kamer wyraźnie więcej (≥ 3×)', () => {
    const plain = mean(runs('bierny', 'dworzec'), (r) => r.remanent);
    expect(plain, 'bez SCO').toBeGreaterThanOrEqual(2_000);
    expect(plain, 'bez SCO').toBeLessThanOrEqual(9_000);
    const withSco = mean(runs('bierny', 'dworzec', { sco: true }), (r) => r.remanent);
    expect(withSco, 'z SCO bez kamer').toBeGreaterThanOrEqual(3 * plain);
    // Osiedle z tą samą kasą płaci mniej: o resztę robi mnożnik kradzieży Dworca
    expect(withSco).toBeGreaterThan(mean(runs('bierny', 'osiedle', { sco: true }), (r) => r.remanent));
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
