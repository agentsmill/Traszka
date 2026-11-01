import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DISTRICTS, siteHours } from '@/sim/city/districts';
import type { StoreDistrict } from '@/sim/city/types';
import { generateStore } from '@/sim/store/generateStore';
import { layoutFor } from '@/sim/store/layoutFor';
import { pickLot } from '@/sim/store/lots';
import type { LotSpec } from '@/sim/store/types';
import { DEBT_LIMIT, GUARANTEE, HOUR_CURVE, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO, OWN_COSTS } from './catalog';
import { applyCommand } from './commands';
import {
  arrivalRate, awaitingDecision, createEconomy, customersPerHour, effects, expectedDailyCustomers, isClosedForRemont, kpiMetricsOf, kpiScaleOf,
  peakCustomersPerHour, sell, stepMinute, type EconEvent, type EconomyState,
} from './economy';
import { forecastMonth } from './forecast';
import { buildStatement, emptySettleMonth } from './franchisee';
import { NEUTRAL_SITE, activeSite, hourCurveOf, siteDayTraffic, type SiteMods } from './site';
import { computeStoreInfo, type StoreInfo } from './storeInfo';
import { visibleCards } from './tycoon/cards';
import { rollWeather } from './tycoon/cleanliness';
import { KPI, newKpiWeek, weekEnd } from './tycoon/kpi';
import { SUNDAY_TRAFFIC } from './tycoon/sunday';
import { dateOfGameDay, roundNice, weekdayOf } from './tycoon/time';
import { WUT, createWut, wutFromSales, wutFromSco } from './tycoon/wut';

/*
 * `StoreInfo.site` (spec §8.3, §10.4, §11.2, §11.4): dzielnica, flagi dodatkowego sklepu i kontrola debetu przez firmę wchodzą do
 * ekonomii jednym opcjonalnym polem. Brak pola i pole neutralne to dzisiejsza gra co do bitu; reszta testów pilnuje kierunku
 * każdego modyfikatora i flag. Miasta jeszcze tu nie ma: `SiteMods` składa się ręcznie z liczb `DISTRICTS`.
 */

const SEED = 'kiełbasa-42';   // blok
const DAY = MINUTES_PER_DAY;

/** `SiteMods` dzielnicy z tabeli `DISTRICTS` (bez natężenia lokalnego i konkurencji), z poprawkami `over`. */
function siteOf(id: StoreDistrict, over: Partial<SiteMods> = {}): SiteMods {
  const d = DISTRICTS[id];
  return {
    ...NEUTRAL_SITE, district: id, traffic: d.traffic, weekendTraffic: d.weekendTraffic, basket: d.basket, patience: d.patience,
    repPenalty: d.repPenalty, theft: d.theft, ...over,
  };
}

const infoOf = (seed: string, site?: SiteMods): StoreInfo => {
  const info = computeStoreInfo(layoutFor(seed, 0, site?.lot ?? undefined));
  return site ? { ...info, site } : info;
};

interface Played { s: EconomyState; info: StoreInfo; events: EconEvent[] }

/** Bierna gra do minuty `until`: karty z odpowiedzią domyślną, opcjonalnie remont 1 w minucie `remontAt` (poziom 8 i gotówka dodane z góry). */
function playTo(p: Played, until: number, remontAt?: number): Played {
  const { s, events } = p;
  let remonted = remontAt === undefined;
  while (s.minute < until && !s.gameOver) {
    if (!remonted && s.minute >= remontAt!) {
      remonted = true;
      s.level = 8;
      s.cash += 50_000;
      const out = applyCommand(s, p.info, { type: 'startRemont' });
      if (out.layoutChanged && out.info) p.info = out.info;
    }
    if (awaitingDecision(s)) {
      const card = visibleCards(s.tycoon.cards, s.minute)[0]!;
      applyCommand(s, p.info, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
      continue;
    }
    stepMinute(s, p.info, events);
  }
  return p;
}

const start = (seed: string, site?: SiteMods): Played => {
  const info = infoOf(seed, site);
  return { s: createEconomy(seed, info), info, events: [] };
};

const hashOf = (s: EconomyState): string => createHash('sha256').update(JSON.stringify(s)).digest('hex');

describe('SiteMods: neutralna dzielnica i aktywność', () => {
  it('NEUTRAL_SITE to osiedle bez żadnego modyfikatora, z kosztami własnymi i bez kontroli debetu przez firmę', () => {
    expect(NEUTRAL_SITE).toEqual({
      district: 'osiedle', traffic: 1, weekendTraffic: null, basket: 1, patience: 0, repPenalty: 1, theft: 1, lot: null, weatherHash: null,
      hours: null, extra: false, ownCosts: true, firmDebt: false,
    });
  });

  it('activeSite: brak pola, pole neutralne i same flagi to null; każdy modyfikator dzielnicy, profil dnia, lokal i pogoda włączają gałąź', () => {
    const info = infoOf(SEED);
    expect(activeSite(info)).toBeNull();
    expect(activeSite({ ...info, site: NEUTRAL_SITE })).toBeNull();
    expect(activeSite({ ...info, site: { ...NEUTRAL_SITE, firmDebt: true, extra: true, ownCosts: false } })).toBeNull();
    const lot: LotSpec = { kind: 'kamienica', interiorWidth: 14, salesDepth: 13, backroomDepth: 3, corner: false };
    const D = DISTRICTS;
    const active: Partial<SiteMods>[] = [
      { traffic: D.srodmiescie.traffic }, { weekendTraffic: D.biurowce.weekendTraffic }, { basket: D.dworzec.basket }, { patience: D.srodmiescie.patience },
      { repPenalty: D.srodmiescie.repPenalty }, { theft: D.dworzec.theft }, { lot },
      { weatherHash: 0 },   // 0 to poprawny skrót, więc liczy się `!== null`, a nie prawda/fałsz
      { hours: siteHours('srodmiescie') },
    ];
    for (const over of active) {
      const site = { ...NEUTRAL_SITE, ...over };
      expect(activeSite({ ...info, site }), JSON.stringify(over)).toBe(site);
    }
  });

  it('Effects.site jest tylko przy aktywnej dzielnicy; cierpliwość dostaje poprawkę dzielnicy', () => {
    const info = infoOf(SEED);
    const s = createEconomy(SEED, info);
    expect('site' in effects(s, info)).toBe(false);
    expect('site' in effects(s, { ...info, site: { ...NEUTRAL_SITE, extra: true } })).toBe(false);
    const site = siteOf('srodmiescie');
    const fx = effects(s, { ...info, site });
    expect(fx.site).toBe(site);
    expect(fx.patience).toBe(effects(s, info).patience + DISTRICTS.srodmiescie.patience);
  });

  it('siteDayTraffic: dni robocze to ruch dzielnicy, niedziela ma premię, weekend Biurowców zastępuje i ruch, i premię', () => {
    const plain = siteOf('srodmiescie');
    const offices = siteOf('biurowce');
    // dzień 0 to wtorek; 4 to sobota, 5 niedziela, 6 poniedziałek
    expect([0, 1, 2, 3, 6].map((d) => weekdayOf(d))).toEqual([2, 3, 4, 5, 1]);
    const mid = DISTRICTS.srodmiescie.traffic;
    const office = DISTRICTS.biurowce;
    for (const day of [0, 1, 2, 3, 6]) {
      expect(siteDayTraffic(plain, day)).toBe(mid);
      expect(siteDayTraffic(offices, day)).toBe(office.traffic);
    }
    expect(siteDayTraffic(plain, 4)).toBe(mid);                       // sobota bez weekendTraffic: dzień jak inne
    expect(siteDayTraffic(plain, 5)).toBe(mid * SUNDAY_TRAFFIC);      // niedziela: premia
    expect(siteDayTraffic(offices, 4)).toBe(office.weekendTraffic);
    expect(siteDayTraffic(offices, 5)).toBe(office.weekendTraffic);   // bez premii niedzieli
  });
});

describe('neutralność §8.3: brak site to dzisiejsza gra co do bitu', () => {
  it('brak site, NEUTRAL_SITE i NEUTRAL_SITE z firmDebt dają ten sam skrót po 61 dniach (3 seedy, remont 1)', () => {
    for (const seed of ['traszka-1', 'kiełbasa-42', 'makieta']) {
      const run = (site: SiteMods | undefined): Played => playTo(start(seed, site), 61 * DAY, 10 * DAY + 12 * 60);
      const plain = run(undefined);
      expect(plain.s.remontLevel, `${seed}: remont się odbył`).toBe(1);
      expect(plain.s.history.length, `${seed}: dwa zamknięte miesiące`).toBe(2);
      const hash = hashOf(plain.s);
      const neutral = run(NEUTRAL_SITE);
      expect(hashOf(neutral.s)).toBe(hash);
      expect(neutral.info.site, 'site wraca do StoreInfo po remoncie').toBe(NEUTRAL_SITE);
      const firmDebt = { ...NEUTRAL_SITE, firmDebt: true };
      const debt = run(firmDebt);
      expect(hashOf(debt.s)).toBe(hash);
      expect(debt.info.site).toBe(firmDebt);
    }
  }, 120_000);

  it('stare wywołania: createEconomy(seed, info) = createEconomy(seed, info, undefined, OPEN_FROM), layoutFor(seed, 2) = layoutFor(seed, 2, undefined)', () => {
    for (const seed of ['traszka-1', 'kiełbasa-42', 'makieta']) {
      const info = infoOf(seed);
      expect(JSON.stringify(createEconomy(seed, info, undefined, OPEN_FROM))).toBe(JSON.stringify(createEconomy(seed, info)));
      expect(layoutFor(seed, 2, undefined)).toEqual(layoutFor(seed, 2));
      expect(layoutFor(seed, 0, undefined)).toEqual(generateStore(seed));
    }
  });
});

describe('kierunki dzielnic (30 dni)', () => {
  const DAYS = 30;
  const play30 = (site?: SiteMods): EconomyState => playTo(start(SEED, site), DAYS * DAY).s;

  it('Śródmieście ma większy obrót na klienta niż Osiedle, a Dworzec mniejszy', () => {
    const perCustomer = (s: EconomyState): number => s.total.revenue / s.total.customers;
    const osiedle = perCustomer(play30());
    expect(perCustomer(play30(siteOf('srodmiescie')))).toBeGreaterThan(1.2 * osiedle);
    expect(perCustomer(play30(siteOf('dworzec')))).toBeLessThan(0.9 * osiedle);
  });

  it('Dworzec ma kradzieże w WUT na złotówkę obrotu co najmniej 1,5 raza większe niż Osiedle, także przez SCO', () => {
    const withSco = (site?: SiteMods): EconomyState => {
      const p = start(SEED, site);
      p.s.equipment.push({ id: 'sco', slot: p.info.slots.find((x) => x.capacity === 1)!.id });
      return playTo(p, DAYS * DAY).s;
    };
    const share = (s: EconomyState): number => s.tycoon.wut.month.kradziez / s.total.revenue;
    expect(share(withSco(siteOf('dworzec')))).toBeGreaterThanOrEqual(1.5 * share(withSco()));   // próg testu, nie liczba z tabeli: Dworzec ma co najmniej 1,5×

    // bez zgadywania z przebiegu: ta sama sprzedaż, cała przez SCO i cała przez kasę
    for (const scoShare of [0, 1]) {
      const sold = (site?: SiteMods): EconomyState => {
        const info = infoOf(SEED, site);
        const s = createEconomy(SEED, info);
        sell(s, effects(s, info), 40, scoShare);
        return s;
      };
      expect(share(sold(siteOf('dworzec')))).toBeCloseTo(DISTRICTS.dworzec.theft * share(sold()), 9);
    }
  });

  it('Biurowce mają w niedzielę mniej niż 0,6 klientów dnia roboczego; Śródmieście zachowuje premię niedzieli', () => {
    const ratio = (site: SiteMods): number => {
      const p = start(SEED, site);
      const perDay: number[] = [];
      for (let d = 0; d < DAYS; d++) {
        const before = p.s.total.customers;
        playTo(p, (d + 1) * DAY);
        perDay.push(p.s.total.customers - before);
      }
      const avg = (days: number[]): number => days.reduce((n, d) => n + perDay[d]!, 0) / days.length;
      const all = perDay.map((_, d) => d);
      return avg(all.filter((d) => weekdayOf(d) === 0)) / avg(all.filter((d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5));
    };
    expect(ratio(siteOf('biurowce'))).toBeLessThan(0.6);
    expect(ratio(siteOf('srodmiescie'))).toBeGreaterThan(1.1);
  });

  it('arrivalRate: w niedzielę Biurowców ruch dzielnicy bez premii niedzieli, w poniedziałek ruch roboczy', () => {
    const offices = siteOf('biurowce');
    const info = infoOf(SEED, offices);
    const s = createEconomy(SEED, info);
    const plainInfo = infoOf(SEED);
    const rateAt = (inf: StoreInfo, day: number): number => {
      s.minute = day * DAY + 12 * 60;
      return arrivalRate(s, inf);
    };
    expect(rateAt(info, 6)).toBeCloseTo(DISTRICTS.biurowce.traffic * rateAt(plainInfo, 6), 12);          // poniedziałek
    expect(rateAt(info, 5)).toBeCloseTo(DISTRICTS.biurowce.weekendTraffic! * rateAt(plainInfo, 6), 12);  // niedziela: ruch weekendu, a nie razy 1,35
    expect(rateAt(plainInfo, 5)).toBeCloseTo(SUNDAY_TRAFFIC * rateAt(plainInfo, 6), 12);
  });

  it('oczekiwani klienci dnia liczą się od ruchu roboczego dzielnicy (skala KPI i zamówień nie zależy od dnia tygodnia)', () => {
    const plain = infoOf(SEED);
    const s = createEconomy(SEED, plain);
    const base = expectedDailyCustomers(s, plain);
    const offices = { ...plain, site: siteOf('biurowce') };
    s.minute = 5 * DAY + 12 * 60;   // niedziela
    expect(expectedDailyCustomers(s, offices)).toBeCloseTo(DISTRICTS.biurowce.traffic * base, 9);
    s.minute = 6 * DAY + 12 * 60;   // poniedziałek
    expect(expectedDailyCustomers(s, offices)).toBeCloseTo(DISTRICTS.biurowce.traffic * base, 9);
  });

  it('cel KPI tygodnia w Biurowcach liczy weekend po swojemu: tyle, ile przyjdzie klientów, a nie tydzień dni roboczych (przegląd balansu)', () => {
    const offices = siteOf('biurowce');
    const info = infoOf(SEED, offices);
    const s = createEconomy(SEED, info);
    const scale = kpiScaleOf(s, info);
    expect(scale.weekendRatio).toBeCloseTo(offices.weekendTraffic! / offices.traffic, 12);
    // inne dzielnice i sklep bez dzielnicy nie mają tego pola: ich cel liczy się dokładnie jak dziś
    expect('weekendRatio' in kpiScaleOf(s, infoOf(SEED))).toBe(false);
    expect('weekendRatio' in kpiScaleOf(s, infoOf(SEED, siteOf('srodmiescie')))).toBe(false);
    expect('weekendRatio' in kpiScaleOf(s, infoOf(SEED, { ...NEUTRAL_SITE, extra: true }))).toBe(false);

    let seq = 1;
    while (newKpiWeek(s.seedHash, seq, 0, kpiMetricsOf(s), scale).kind !== 'klienci') seq++;
    // pełny tydzień od poniedziałku (dzień 6) do niedzieli (12), tydzień od soboty (dzień 4) i od wtorku (dzień 0)
    for (const from of [6, 4, 0]) {
      const week = newKpiWeek(s.seedHash, seq, from, kpiMetricsOf(s), scale);
      // ruch dnia względem dnia roboczego, wprost z ekonomii sklepu: to samo, czego cel ma się spodziewać
      let expected = 0;
      for (let d = week.fromDay; d <= week.toDay; d++) expected += siteDayTraffic(offices, d) / offices.traffic;
      expect(week.target, `tydzień od dnia ${from}`).toBe(Math.max(10, roundNice(KPI.customersStretch * scale.dailyCustomers * expected)));
    }
    // dawny cel (tydzień dni roboczych z premią niedzieli) był ok. 27% za wysoki dla pełnego tygodnia
    const { weekendRatio: _drop, ...plainScale } = scale;
    const full = newKpiWeek(s.seedHash, seq, 6, kpiMetricsOf(s), scale).target;
    expect(newKpiWeek(s.seedHash, seq, 6, kpiMetricsOf(s), plainScale).target / full).toBeGreaterThan(1.2);
  });

  it('sell: koszyk mnoży obrót i marżę, ale nie zużycie towaru', () => {
    const sold = (site?: SiteMods): EconomyState => {
      const info = infoOf(SEED, site);
      const s = createEconomy(SEED, info);
      sell(s, effects(s, info), 30, 0);
      return s;
    };
    const a = sold();
    const b = sold(siteOf('srodmiescie'));
    expect(b.shelf).toEqual(a.shelf);
    expect(b.today.customers).toBe(a.today.customers);
    expect(b.today.hotSold).toBe(a.today.hotSold);
    const basket = DISTRICTS.srodmiescie.basket;
    expect(b.today.revenue).toBeCloseTo(basket * a.today.revenue, 9);
    expect(b.today.margin).toBeCloseTo(basket * a.today.margin, 9);
    expect(b.franchisee.month.margin).toBeCloseTo(basket * a.franchisee.month.margin, 9);
  });

  it('reputacja: kara za puste półki, brud i kolejkę rośnie o repPenalty, nagroda za obsługę nie', () => {
    const rep = (site: SiteMods | undefined, prepare: (s: EconomyState) => void): number => {
      const info = infoOf(SEED, site);
      const s = createEconomy(SEED, info);
      s.reputation = 50;
      prepare(s);
      sell(s, effects(s, info), 10, 0);
      return s.reputation - 50;
    };
    const mult = DISTRICTS.srodmiescie.repPenalty;
    const penalty = { ...NEUTRAL_SITE, repPenalty: mult };
    const empty = (s: EconomyState): void => { for (const c of Object.keys(s.shelf) as (keyof typeof s.shelf)[]) s.shelf[c] = 0; };
    expect(rep(undefined, empty)).toBeCloseTo(-0.2, 12);
    expect(rep(penalty, empty)).toBeCloseTo(-0.2 * mult, 12);
    const dirty = (s: EconomyState): void => { s.tycoon.hall.cleanliness = 0; };
    const gain = rep(undefined, () => {});
    expect(gain).toBeCloseTo(10 * 0.0025, 12);
    expect(rep(penalty, () => {})).toBeCloseTo(gain, 12);                       // pełne półki, czysta sala: bez kary
    expect(rep(undefined, dirty)).toBeCloseTo(10 * (0.0025 - 0.003), 12);
    expect(rep(penalty, dirty)).toBeCloseTo(10 * (0.0025 - 0.003 * mult), 12);
  });

  it('przy tej samej kolejce Śródmieście traci więcej reputacji niż Osiedle', () => {
    const afterMinute = (site?: SiteMods): number => {
      const info = infoOf(SEED, site);
      const s = createEconomy(SEED, info);
      s.minute = 12 * 60;
      s.reputation = 50;
      s.queue = 25;
      stepMinute(s, info, []);
      return s.reputation;
    };
    // tylko kary: Osiedle i Osiedle z samym repPenalty mają tę samą kolejkę i ten sam ruch
    expect(afterMinute({ ...NEUTRAL_SITE, repPenalty: DISTRICTS.srodmiescie.repPenalty })).toBeLessThan(afterMinute());
    expect(afterMinute(siteOf('srodmiescie'))).toBeLessThan(afterMinute());
  });
});

describe('profil dnia dzielnicy (spec §8.1, 4a.2): ten sam ruch doby w innym rozkładzie', () => {
  const PROFILED = (Object.keys(DISTRICTS) as StoreDistrict[]).filter((d) => d !== 'osiedle');
  const HOURS = Array.from({ length: 17 }, (_, i) => 6 + i);   // 6:00–22:00, godziny z HOUR_CURVE
  const withProfile = (id: StoreDistrict): SiteMods => siteOf(id, { hours: siteHours(id) });

  /** `arrivalRate` po godzinach 6–22 dnia `day` na jednym stanie: czysta funkcja stanu, więc wystarczy przestawić `minute`. */
  const ratesOn = (s: EconomyState, info: StoreInfo, day: number): number[] => HOURS.map((h) => {
    s.minute = day * DAY + h * 60;
    return arrivalRate(s, info);
  });
  const sumOf = (xs: number[]): number => xs.reduce((n, v) => n + v, 0);

  it('profil zmienia rozkład, nie dobę: suma arrivalRate po godzinach 6–22 dnia roboczego z profilem i bez (te same pozostałe pola site) jest równa', () => {
    expect(weekdayOf(0), 'dzień 0 to dzień roboczy').toBe(2);
    for (const id of PROFILED) {
      const plain = infoOf(SEED, siteOf(id));
      const profiled = infoOf(SEED, withProfile(id));
      const s = createEconomy(SEED, plain);
      const without = ratesOn(s, plain, 0);
      const withHours = ratesOn(s, profiled, 0);
      expect(sumOf(withHours), id).toBeCloseTo(sumOf(without), 9);
      expect(withHours.some((v, i) => Math.abs(v - without[i]!) > 1e-6), `${id}: rozkład się zmienił`).toBe(true);
      // godziny poza 6–22 zostają bez klientów: sklep jest wtedy zamknięty, a krzywa nie ma tam wartości
      for (const hour of [0, 3, 5, 23]) {
        s.minute = hour * 60;
        expect(arrivalRate(s, profiled), `${id}: ${hour}:00`).toBe(0);
        expect(arrivalRate(s, plain), `${id}: ${hour}:00 bez profilu`).toBe(0);
      }
    }
    // Osiedle nie ma profilu: z siteHours (null) arrivalRate liczy się dokładnie jak bez niego
    const osiedle = infoOf(SEED, siteOf('osiedle', { hours: siteHours('osiedle') }));
    const s = createEconomy(SEED, osiedle);
    expect(ratesOn(s, osiedle, 0)).toEqual(ratesOn(s, infoOf(SEED), 0));
  });

  it('profil nie dotyka pozostałych pól: klient o godzinie h przychodzi z krzywej dzielnicy zamiast HOUR_CURVE, reszta wzoru ta sama', () => {
    for (const id of PROFILED) {
      const plain = infoOf(SEED, siteOf(id));
      const profiled = infoOf(SEED, withProfile(id));
      const s = createEconomy(SEED, plain);
      const without = ratesOn(s, plain, 0);
      const withHours = ratesOn(s, profiled, 0);
      const h = siteHours(id)!;
      HOURS.forEach((hour, i) => expect(withHours[i]! / without[i]!, `${id}: ${hour}:00`).toBeCloseTo(h[hour]! / HOUR_CURVE[hour]!, 12));
    }
  });

  it('kierunki §8.1: Śródmieście ma udział godzin 17–22 ≥ 1,15× udziału Osiedla; Dworzec max/min po godzinach 6–22 ≤ 1,05; Biurowce 19–22 ≤ 5% doby, a dwa najmocniejsze okna trzygodzinne to 7–9 i 12–14', () => {
    const share = (h: (hour: number) => number, from: number, to: number): number => {
      let part = 0;
      let all = 0;
      for (const hour of HOURS) { all += h(hour); if (hour >= from && hour <= to) part += h(hour); }
      return part / all;
    };
    const curve = (hour: number): number => HOUR_CURVE[hour]!;
    const hoursOf = (id: StoreDistrict): ((hour: number) => number) => { const h = siteHours(id)!; return (hour) => h[hour]!; };

    expect(share(hoursOf('srodmiescie'), 17, 22)).toBeGreaterThanOrEqual(1.15 * share(curve, 17, 22));

    const flat = HOURS.map((hour) => hoursOf('dworzec')(hour));
    expect(Math.max(...flat) / Math.min(...flat)).toBeLessThanOrEqual(1.05);

    const office = hoursOf('biurowce');
    expect(share(office, 19, 22)).toBeLessThanOrEqual(0.05);
    const windows = HOURS.slice(0, -2).map((from) => ({ from, sum: office(from) + office(from + 1) + office(from + 2) }));
    windows.sort((a, b) => b.sum - a.sum || a.from - b.from);
    expect(windows.slice(0, 2).map((w) => w.from).sort((a, b) => a - b)).toEqual([7, 12]);
  });

  it('krzywa dla podpowiedzi (panel Sklep, scena): profil dzielnicy, a bez niego HOUR_CURVE i dzisiejsze liczby co do bitu (szczyt 1,3)', () => {
    // brak site, NEUTRAL_SITE, same flagi i dzielnica bez profilu: ten sam obiekt HOUR_CURVE
    const plain = infoOf(SEED);
    expect(hourCurveOf(plain)).toBe(HOUR_CURVE);
    expect(hourCurveOf({ ...plain, site: NEUTRAL_SITE })).toBe(HOUR_CURVE);
    expect(hourCurveOf(infoOf(SEED, { ...NEUTRAL_SITE, extra: true, ownCosts: false, firmDebt: true }))).toBe(HOUR_CURVE);
    expect(hourCurveOf(infoOf(SEED, siteOf('osiedle', { hours: siteHours('osiedle') })))).toBe(HOUR_CURVE);
    expect(hourCurveOf(infoOf(SEED, siteOf('biurowce')))).toBe(HOUR_CURVE);
    for (const id of PROFILED) expect(hourCurveOf(infoOf(SEED, withProfile(id))), id).toBe(siteHours(id));

    const s = createEconomy(SEED, plain);
    const daily = expectedDailyCustomers(s, plain);
    for (const hour of [0, 5, 6, 8, 12, 17, 18, 22, 23]) expect(customersPerHour(s, plain, hour), `${hour}:00`).toBe(daily / 15.6 * (HOUR_CURVE[hour] ?? 0));
    expect(peakCustomersPerHour(s, plain)).toBe(daily / 15.6 * 1.3);
    expect(Math.max(...HOURS.map((h) => HOUR_CURVE[h]!)), '1,3 to naprawdę szczyt HOUR_CURVE').toBe(1.3);
  });

  it('Biurowce i Dworzec: szczyt i popyt bieżącej godziny z profilu, nie z HOUR_CURVE; doba ta sama', () => {
    for (const id of PROFILED) {
      const info = infoOf(SEED, withProfile(id));
      const s = createEconomy(SEED, info);
      const h = siteHours(id)!;
      const perUnit = expectedDailyCustomers(s, info) / 15.6;
      expect(peakCustomersPerHour(s, info), id).toBeCloseTo(perUnit * Math.max(...h), 12);
      HOURS.forEach((hour) => expect(customersPerHour(s, info, hour), `${id}: ${hour}:00`).toBeCloseTo(perUnit * h[hour]!, 12));
      for (const hour of [0, 5, 23]) expect(customersPerHour(s, info, hour), `${id}: ${hour}:00`).toBe(0);
      // podpowiedź godzinowa nie zmienia doby: suma po godzinach 6–22 to oczekiwani klienci dnia
      expect(sumOf(HOURS.map((hour) => customersPerHour(s, info, hour))), id).toBeCloseTo(expectedDailyCustomers(s, info), 9);
    }

    const offices = infoOf(SEED, withProfile('biurowce'));
    const so = createEconomy(SEED, offices);
    const perUnitO = expectedDailyCustomers(so, offices) / 15.6;
    expect(peakCustomersPerHour(so, offices) / perUnitO, 'szczyt Biurowców ok. 1,86 zamiast 1,3').toBeGreaterThan(1.7);
    expect(customersPerHour(so, offices, 20) / perUnitO, 'o 20:00 w Biurowcach prawie pusto, a HOUR_CURVE daje 0,9').toBeLessThan(0.2);
    expect(customersPerHour(so, offices, 8) / perUnitO).toBeGreaterThan(1.7);

    const station = infoOf(SEED, withProfile('dworzec'));
    const ss = createEconomy(SEED, station);
    const perUnitD = expectedDailyCustomers(ss, station) / 15.6;
    expect(peakCustomersPerHour(ss, station) / perUnitD, 'płaski Dworzec: szczyt poniżej 1,3').toBeLessThan(1);
    expect(customersPerHour(ss, station, 17) / perUnitD, 'o 17:00 na Dworcu nie ma szczytu 1,3').toBeLessThan(1);
  });

  it('Review Focus 3: Biurowce w sobotę mają kształt dnia roboczego razy weekendTraffic / traffic; expectedDailyCustomers i cel KPI tygodnia (createEconomy) są jak bez profilu', () => {
    const offices = DISTRICTS.biurowce;
    const plain = infoOf(SEED, siteOf('biurowce'));
    const profiled = infoOf(SEED, withProfile('biurowce'));
    const s = createEconomy(SEED, profiled);
    expect([weekdayOf(2), weekdayOf(4)], 'dzień 2 to dzień roboczy, dzień 4 sobota').toEqual([4, 6]);

    const weekday = ratesOn(s, profiled, 2);
    const saturday = ratesOn(s, profiled, 4);
    weekday.forEach((rate, i) => expect(saturday[i]! / rate, `${HOURS[i]}:00`).toBeCloseTo(offices.weekendTraffic! / offices.traffic, 12));
    // sobota bez profilu ma tę samą dobę, więc z profilem też
    expect(sumOf(saturday)).toBeCloseTo(sumOf(ratesOn(s, plain, 4)), 9);
    // niedziela to ten sam weekendTraffic, bez premii niedzieli
    expect(sumOf(ratesOn(s, profiled, 5))).toBeCloseTo(sumOf(saturday), 12);

    // skala sklepu, widełki i cel KPI nie widzą profilu: liczą dobę, nie jej rozkład
    const base = createEconomy(SEED, plain);
    expect(expectedDailyCustomers(createEconomy(SEED, profiled), profiled)).toBe(expectedDailyCustomers(base, plain));
    expect(kpiScaleOf(createEconomy(SEED, profiled), profiled)).toEqual(kpiScaleOf(base, plain));
    expect(createEconomy(SEED, profiled).tycoon.kpi).toEqual(base.tycoon.kpi);
    expect(hashOf(createEconomy(SEED, profiled))).toBe(hashOf(base));
    for (const id of PROFILED) {
      const p = infoOf(SEED, withProfile(id));
      const q = infoOf(SEED, siteOf(id));
      expect(expectedDailyCustomers(createEconomy(SEED, p), p), id).toBe(expectedDailyCustomers(createEconomy(SEED, q), q));
    }
  });
});

describe('WUT: mnożnik kradzieży', () => {
  it('wutFromSales mnoży tylko kradzieże, wutFromSco ich ubytek na kasach; bez mnożnika jak dawniej', () => {
    const base = createWut();
    wutFromSales(base, 1000);
    const theft = createWut();
    const mult = DISTRICTS.dworzec.theft;
    wutFromSales(theft, 1000, mult);
    expect(theft.month.kradziez).toBeCloseTo(mult * base.month.kradziez, 12);
    expect(theft.month.termin).toBe(base.month.termin);
    expect(theft.month.pomylki).toBe(base.month.pomylki);

    const sco = createWut();
    wutFromSco(sco, 1000, 0.6);
    const scoTheft = createWut();
    wutFromSco(scoTheft, 1000, 0.6, mult);
    expect(sco.month.kradziez).toBe(1000 * WUT.scoShrink * 0.6);
    expect(scoTheft.month.kradziez).toBeCloseTo(mult * sco.month.kradziez, 12);
  });
});

describe('flagi dodatkowego sklepu', () => {
  it('extra: statement.guarantee jest 0 w trzech pierwszych miesiącach, a sklep bez flagi dostaje gwarancję', () => {
    // sklep na koniec miesiąca z przychodem daleko pod gwarancją (liczniki miesiąca); zamknięcie we wrześniu, październiku i listopadzie
    const closings = (site: SiteMods | undefined, fined: boolean): EconEvent[] => {
      const p = start(SEED, site);
      for (const lastDay of [29, 60, 90]) {
        p.s.minute = lastDay * DAY + OPEN_TO;
        p.s.month.margin = 5000;
        p.s.month.fineCount = fined ? 1 : 0;
        stepMinute(p.s, p.info, p.events);
      }
      return p.events;
    };
    const guarantees = (events: EconEvent[]): number[] => events.filter((e) => e.kind === 'month').map((e) => e.report!.statement!.guarantee);

    expect(guarantees(closings(undefined, false))).toEqual([20_000, 20_000, 20_000]);
    const extra = closings({ ...NEUTRAL_SITE, extra: true }, false);
    expect(guarantees(extra)).toEqual([0, 0, 0]);
    expect(extra.some((e) => e.text.includes('gwarantowany'))).toBe(false);

    // miesiąc z mandatem: sklep bez flagi dostaje odmowę, a dodatkowy nie słyszy o gwarancji wcale
    expect(closings(undefined, true).some((e) => e.kind === 'info' && e.text.includes('Centrala nie dopłaci'))).toBe(true);
    expect(closings({ ...NEUTRAL_SITE, extra: true }, true).some((e) => e.kind === 'info')).toBe(false);
  });

  it('ownCosts: false daje ZUS i księgową 0, reszta kosztów zostaje; domyślnie sklep płaci jak dziś', () => {
    const input = { month: { ...emptySettleMonth(), margin: 20_000, wages: 3000, media: 800 }, guarantee: 0, installments: 0, remanent: 0, spent: 0, fines: 0, other: 0, cashBefore: 1000, partial: false };
    const own = buildStatement(input);
    expect(own.zus).toBe(OWN_COSTS.zus);
    expect(own.accounting).toBe(OWN_COSTS.accounting);
    expect(buildStatement({ ...input, ownCosts: true })).toEqual(own);
    const free = buildStatement({ ...input, ownCosts: false });
    expect(free.zus).toBe(0);
    expect(free.accounting).toBe(0);
    expect(free.vat).toBe(own.vat);
    expect(free.costs).toBe(own.costs - OWN_COSTS.zus - OWN_COSTS.accounting);
    expect(free.net).toBe(own.net + OWN_COSTS.zus + OWN_COSTS.accounting);

    const p = start(SEED, { ...NEUTRAL_SITE, ownCosts: false });
    const month = playTo(p, 30 * DAY).events.find((e) => e.kind === 'month')!.report!.statement!;
    expect(month.zus).toBe(0);
    expect(month.accounting).toBe(0);
    expect(month.costs).toBeGreaterThan(0);
  });

  it('firmDebt: gotówka poniżej DEBT_LIMIT nie kończy gry ani w kroku, ani w poleceniu (bez flagi kończy)', () => {
    const below = (site?: SiteMods): Played => {
      const p = start(SEED, site);
      p.s.cash = DEBT_LIMIT - 1000;
      return p;
    };
    const stepped = below({ ...NEUTRAL_SITE, firmDebt: true });
    stepMinute(stepped.s, stepped.info, stepped.events);
    expect(stepped.s.gameOver).toBe(false);
    expect(stepped.events.map((e) => e.kind)).not.toContain('gameover');
    const control = below();
    stepMinute(control.s, control.info, control.events);
    expect(control.s.gameOver).toBe(true);

    const ordered = below({ ...NEUTRAL_SITE, firmDebt: true });
    const out = applyCommand(ordered.s, ordered.info, { type: 'setOrder', auto: true });
    expect(out.result.ok).toBe(true);
    expect(ordered.s.gameOver).toBe(false);
    expect(out.events.map((e) => e.kind)).not.toContain('gameover');
    const controlOut = below();
    expect(applyCommand(controlOut.s, controlOut.info, { type: 'setOrder', auto: true }).events.map((e) => e.kind)).toContain('gameover');
    expect(controlOut.s.gameOver).toBe(true);
  });

  it('forecastMonth: extra nie liczy gwarancji, ownCosts: false nie liczy ZUS i księgowej', () => {
    const info = infoOf(SEED);
    const s = createEconomy(SEED, info);
    s.tycoon.trust.value = GUARANTEE.minTrust;
    s.month.margin = -1e6;   // przychód miesiąca daleko pod gwarancją
    expect(forecastMonth(s, info).statement.guarantee).toBeGreaterThan(0);
    expect(forecastMonth(s, { ...info, site: { ...NEUTRAL_SITE, extra: true } }).statement.guarantee).toBe(0);
    expect(forecastMonth(s, info).statement.zus).toBe(OWN_COSTS.zus);
    const free = forecastMonth(s, { ...info, site: { ...NEUTRAL_SITE, ownCosts: false } }).statement;
    expect(free.zus).toBe(0);
    expect(free.accounting).toBe(0);
  });
});

describe('pogoda miasta', () => {
  it('sklep z weatherHash = h ma każdego dnia tę samą pogodę co sklep o seedHash równym h', () => {
    const a = start('pogoda-a');
    const own = start('pogoda-b');
    const shared = start('pogoda-b', { ...NEUTRAL_SITE, weatherHash: a.s.seedHash });
    let differs = false;
    for (let day = 0; day < 40; day++) {
      // pogoda dnia jest losowana o północy; dzień 0 ma ją od `createEconomy`
      for (const p of [a, own, shared]) playTo(p, day * DAY + 2);
      expect(shared.s.tycoon.hall.weather, `dzień ${day}`).toBe(a.s.tycoon.hall.weather);
      expect(shared.s.tycoon.hall.weather).toBe(rollWeather(a.s.seedHash, day, dateOfGameDay(day).month));
      differs ||= own.s.tycoon.hall.weather !== a.s.tycoon.hall.weather;
    }
    expect(differs, 'bez weatherHash pogoda sklepu b idzie własnym seedem').toBe(true);
  }, 60_000);
});

describe('remont sklepu z lokalu miasta', () => {
  const lot: LotSpec = { kind: 'kamienica', interiorWidth: 14, salesDepth: 13, backroomDepth: 3, corner: false };

  it('układ po remoncie powstaje z lokalu miasta, a site wraca do nowego StoreInfo (ten sam obiekt)', () => {
    expect(pickLot(SEED).kind, 'seed jest blokowy: bez lokalu miasta remont dałby blok').not.toBe('kamienica');
    expect(layoutFor(SEED, 1).lot.kind).not.toBe('kamienica');
    expect(layoutFor(SEED, 0, lot)).toEqual(generateStore(SEED, lot));

    const site = siteOf('srodmiescie', { lot });
    const p = start(SEED, site);
    expect(p.info.lotKind).toBe('kamienica');
    p.s.level = 8;
    p.s.cash = 100_000;
    const out = applyCommand(p.s, p.info, { type: 'startRemont' });
    expect(out.result.ok).toBe(true);
    expect(out.layoutChanged).toBe(true);
    expect(out.layout!.lot.kind).toBe('kamienica');
    expect(out.layout!.lot.interiorWidth).toBeGreaterThan(lot.interiorWidth);
    expect(out.info!.lotKind).toBe('kamienica');
    expect(out.info!.site).toBe(site);

    // przewinięcie remontu do końca na nowym StoreInfo
    const info = out.info!;
    while (isClosedForRemont(p.s)) {
      if (awaitingDecision(p.s)) {
        const card = visibleCards(p.s.tycoon.cards, p.s.minute)[0]!;
        applyCommand(p.s, info, { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer });
      } else stepMinute(p.s, info, p.events);
    }
    stepMinute(p.s, info, p.events);   // minuta, w której sklep się otwiera
    expect(p.s.remontUntil).toBeNull();
    expect(p.events.some((e) => e.kind === 'remont')).toBe(true);
  });

  it('remont sklepu bez site zostaje taki jak dziś: StoreInfo bez pola site', () => {
    const p = start(SEED);
    p.s.level = 8;
    p.s.cash = 100_000;
    const out = applyCommand(p.s, p.info, { type: 'startRemont' });
    expect(out.layoutChanged).toBe(true);
    expect('site' in out.info!).toBe(false);
    expect(out.layout).toEqual(layoutFor(SEED, 1));
  });
});

describe('createEconomy: sklep otwierany w środku gry', () => {
  it('sklep otwarty w dniu 40 dochodzi do raportu miesiąca; KPI kończy się w niedzielę, remanent wypada jak w sklepie z dnia 0', () => {
    const info = infoOf(SEED);
    const openAt = 40 * DAY + OPEN_FROM;
    const late = createEconomy(SEED, info, undefined, openAt);
    const first = createEconomy(SEED, info);
    expect(late.minute).toBe(openAt);
    expect(late.tycoon.kpi.fromDay).toBe(40);
    expect(late.tycoon.kpi.toDay).toBe(weekEnd(40));
    expect(weekdayOf(late.tycoon.kpi.toDay)).toBe(0);
    expect(late.franchisee.remanent.nextDay).toBe(first.franchisee.remanent.nextDay);
    expect(late.tycoon.hall.weather).toBe(rollWeather(late.seedHash, 40, dateOfGameDay(40).month));
    expect(late.cash).toBe(first.cash);
    expect(late.history).toEqual([]);

    const events: EconEvent[] = [];
    const p: Played = { s: late, info, events };
    late.cash = 200_000;
    // tydzień KPI zamyka się w niedzielę 47 o zamknięciu dnia (23:00), nie wcześniej
    playTo(p, 47 * DAY + OPEN_TO);
    expect(events.some((e) => e.kind === 'kpi-week')).toBe(false);
    playTo(p, 47 * DAY + OPEN_TO + 1);
    expect(events.filter((e) => e.kind === 'kpi-week')).toHaveLength(1);
    playTo(p, 62 * DAY);
    const month = events.find((e) => e.kind === 'month')!;
    expect(month.report!.label).toBe('październik 2026');
    expect(month.report!.statement!.partial).toBe(false);
    const remanent = playTo(p, 92 * DAY).events.find((e) => e.kind === 'remanent');
    expect(remanent, 'remanent w sklepie z dnia 40').toBeDefined();
    expect(remanent!.remanent!.day).toBe(first.franchisee.remanent.nextDay);
  }, 60_000);
});
