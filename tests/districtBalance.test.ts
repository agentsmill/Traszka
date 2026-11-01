import { describe, expect, it } from 'vitest';
import { DISTRICTS, districtSite } from '@/sim/city/districts';
import { generateCity } from '@/sim/city/generateCity';
import type { StoreDistrict } from '@/sim/city/types';
import { MINUTES_PER_DAY, OPEN_FROM } from '@/sim/economy/catalog';
import { applyCommand } from '@/sim/economy/commands';
import { createEconomy } from '@/sim/economy/economy';
import { installmentLimit, planFor } from '@/sim/economy/franchisee';
import type { BotName } from '@/sim/economy/tycoon/bots';
import { DWORZEC_CARD_IDS } from '@/sim/economy/tycoon/deck';
import { playBot, type EconomyRun } from '@/sim/economy/tycoon/economyEnv';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { RELET_SHARE } from '@/sim/firm/commands';

/**
 * Cele balansu dzielnic (spec §8.4) na botach z harnessu SIM 6: drugi sklep w środku widełek dzielnicy (`districtSite`: ruch dzielnicy,
 * natężenie lokalne 1, bez rywali, flagi dodatkowego sklepu, od 4a.2 także profil dnia i trudni klienci) gra 92 dni od 1 września, czyli
 * trzy zamknięte miesiące z remanentem 30 listopada, na ośmiu seedach. Liczby `DISTRICTS` stroi ten przegląd: test czyta wyniki, a nie
 * powtarza liczb z tabeli. Wynik sklepu to suma `history[].profit` (wynik bez rat, jak w statusie Partnera).
 *
 * Przebiegi są ciężkie (ok. 100 pełnych gier), więc liczą się raz na parę (bot, dzielnica) i dzielą je testy. Jeśli któryś cel przestanie
 * się trzymać po zmianie ekonomii, popraw `DISTRICTS`, a nie próg: te progi są z projektu. Od 4a.2 stroi się tylko to, co dołożył ten etap:
 * profil dnia (`hours`), trudnych klientów (`difficult`), liczby kart Dworca, `RELET_SHARE` i `RELET_BUILD_DAYS`; balans 4a.1 jest zatwierdzony.
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
  /** Karty Dworca (`DWORZEC_CARD_IDS`), które w tej grze wypadły choć raz (`lastSeen` pamięta każdą wylosowaną kartę, także tę, na którą bot jeszcze nie odpowiedział). */
  dworzec: string[];
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
        dworzec: DWORZEC_CARD_IDS.filter((id) => s.tycoon.cards.lastSeen[id] !== undefined),
      };
    });
    cache.set(key, out);
  }
  return out;
}

/** Pakiet otwarcia ze środka widełek dzielnicy: tyle kosztuje lokal z `districtSite` (wymiary ze środka widełek formatu). */
const midPackage = (d: StoreDistrict): number => Math.round((DISTRICTS[d].package[0] + DISTRICTS[d].package[1]) / 2);

interface NetResult {
  /** Suma „Zostaje Ci” (`statement.net`: po racie pakietu, remanencie i kosztach własnych) trzech zamkniętych miesięcy. */
  net: number;
}

const netCache = new Map<string, NetResult[]>();

/**
 * Drugi sklep z pakietem na raty i jego „Zostaje Ci” w trzech miesiącach. `relet = false`: świeży lokal dzielnicy za cały pakiet ze środka
 * widełek. `relet = true`: lokal „po Traszce” (spec §13.3): ten sam lokal po jednym remoncie (prawdziwe polecenie `startRemont`, więc większa
 * sala i zachowany poziom remontu, jak po zamknięciu sklepu), poziom 1, reputacja 50, zaufanie 65 (`createEconomy` z `fittings`, jak
 * `reopenStoreAt`) i pakiet za `RELET_SHARE` pakietu (zaokrąglony co 100 zł jak `rentPrice`). Rata z tego samego `planFor` co w firmie.
 */
function netRuns(bot: BotName, district: StoreDistrict, relet: boolean): NetResult[] {
  const key = `${bot}:${district}:${relet}`;
  let out = netCache.get(key);
  if (!out) {
    out = SEEDS.map((seed) => {
      const price = relet ? Math.round(midPackage(district) * RELET_SHARE / 100) * 100 : midPackage(district);
      const setup = (run: EconomyRun): void => {
        if (relet) {
          const closed = createEconomy(seed, run.info);   // sklep, który po zamknięciu zostawił remont 1
          closed.level = 20;
          closed.cash = 600_000;
          const remont = applyCommand(closed, run.info, { type: 'startRemont' });
          expect(remont.result.ok, `${seed}: remont`).toBe(true);
          expect(remont.layoutChanged, `${seed}: układ po remoncie`).toBe(true);
          run.info = remont.info!;
          run.state = createEconomy(seed, run.info, undefined, OPEN_FROM, { upgrades: closed.upgrades, equipment: closed.equipment, remontLevel: closed.remontLevel });
          expect(run.state.remontLevel, `${seed}: remont 1`).toBe(1);
        }
        const plan = planFor(price);
        const fr = run.state.franchisee;
        fr.installments.push({
          id: fr.nextInstallmentId++, label: 'Adaptacja lokalu', price, fee: plan.fee, total: plan.total, monthly: plan.monthly, paid: 0, months: plan.months,
        });
      };
      const play = playBot(bot, seed, DAYS * MINUTES_PER_DAY, districtSite(district), setup);
      return { net: play.reports.reduce((n, r) => n + (r.statement?.net ?? 0), 0) };
    });
    netCache.set(key, out);
  }
  return out;
}

const sum = <T>(rs: readonly T[], f: (r: T) => number): number => rs.reduce((n, r) => n + f(r), 0);
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

  it('karty Dworca: mistrz na Dworcu dostaje w 92 dniach co najmniej jedną kartę z DWORZEC_CARD_IDS na każdym seedzie, w innych dzielnicach żadnej', () => {
    // zmierzone: 2–7 wystąpień na seed (średnio 4,0 na 92 dni, ok. 8% kart); w 24 miesiącach 28–42 (ok. 1,5 na miesiąc)
    runs('mistrz', 'dworzec').forEach((r, i) => expect(r.dworzec.length, `mistrz na Dworcu, seed ${SEEDS[i]}`).toBeGreaterThanOrEqual(1));
    // waga 0 poza Dworcem: ani jedna karta Dworca nie wypada gdzie indziej (bierny i mistrz, każdy seed)
    for (const d of DISTRICT_IDS.filter((x) => x !== 'dworzec')) {
      for (const bot of ['bierny', 'mistrz'] as const) {
        runs(bot, d).forEach((r, i) => expect(r.dworzec, `${bot} w dzielnicy ${d}, seed ${SEEDS[i]}`).toEqual([]));
      }
    }
  }, TIMEOUT);

  it('lokal po Traszce: sklep z remontem 1 i pakietem RELET_SHARE zostawia w trzech miesiącach po racie (suma net) więcej niż świeży lokal tej dzielnicy, mistrz i bierny', () => {
    // zmierzone (po Traszce wobec świeżego, mistrz i bierny): Osiedle 1,80× i 2,55×, Śródmieście 1,80× i 2,34×, Biurowce 1,43× i 1,77×, Dworzec tylko 1,03×
    // u obu: remont 1 nie podnosi tam wyniku (57,5 wobec 60,0 tys. zł u mistrza), więc o różnicy decyduje sam pakiet. To najcieńszy zapas w tym teście.
    for (const bot of ['mistrz', 'bierny'] as const) {
      for (const d of DISTRICT_IDS) {
        const fresh = sum(netRuns(bot, d, false), (r) => r.net);
        const relet = sum(netRuns(bot, d, true), (r) => r.net);
        expect(relet, `${bot} w dzielnicy ${d}: lokal po Traszce (${Math.round(relet)} zł) wobec świeżego (${Math.round(fresh)} zł)`).toBeGreaterThan(fresh);
      }
    }
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
