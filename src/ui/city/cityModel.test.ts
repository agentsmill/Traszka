import { afterEach, describe, expect, it, vi } from 'vitest';
import { lang } from '@/i18n';
import { closeFirstStore, openSecond, partnerSession } from '../../../tests/firmKit';
import { createSession, firmOf } from '@/game/session';
import { DISTRICTS } from '@/sim/city/districts';
import { lotById } from '@/sim/city/generateCity';
import { lotEstimate, rivalsNear } from '@/sim/city/traffic';
import type { StoreDistrict } from '@/sim/city/types';
import { HOUR_CURVE, MINUTES_PER_DAY } from '@/sim/economy/catalog';
import { CELL_SIZE_M } from '@/sim/grid';
import { planFor } from '@/sim/economy/franchisee';
import { RELET_BUILD_DAYS, RELET_SHARE, applyFirmCommand, lotRentable, lotState, rentBuildDays, rentPrice } from '@/sim/firm/commands';
import { emptyStepOut, syncWallet } from '@/sim/firm/firm';
import type { FirmState } from '@/sim/firm/types';
import {
  SWIPE_MIN_PX, basketLevel, cityLotStates, cityPinSpecs, expectationsLevel, freeLotRows, lotCardModel, lotHours, neighbourLot, swipeDirection,
  theftLevel, validLot, type LotRow,
} from './cityModel';

// licznik wywołań `lotEstimate` (ta sama funkcja co zawsze, tylko policzona): przypina pamięć podręczną widełek
vi.mock('@/sim/city/traffic', async (original) => {
  const real = await original<typeof import('@/sim/city/traffic')>();
  return { ...real, lotEstimate: vi.fn(real.lotEstimate) };
});

/*
 * Model ekranu Miasta (spec §9.3): lista wolnych lokali, karta lokalu, poziomy słowami, nawigacja po lokalach i pinezki. Czyste funkcje
 * firmy i miasta, bez interfejsu; tekst składa `cityText.ts`.
 */

afterEach(() => { lang.value = 'pl'; });

const SEED = 'kiełbasa-42';
const partnerFirm = (seed = SEED, wallet = 200_000): FirmState => firmOf(partnerSession(seed, wallet));
const rowOf = (rows: LotRow[], district: StoreDistrict): LotRow => rows.find((r) => r.district === district)!;
/** Firma po zamknięciu sklepu #1 przy działającym #2: lokal startowy jest „po Traszce” (wyposażenie: remont 1, sprzęt 2 szt., ulepszenia 3 + 1). */
function reletFirm(seed = SEED): FirmState {
  const s = partnerSession(seed);
  openSecond(s, 'raty');
  return closeFirstStore(s);
}

describe('freeLotRows: lista wolnych lokali', () => {
  it('tylko lokale w stanie „wolny”, rosnąco po numerze, z numerem, adresem, dzielnicą, formatem, metrażem, widełkami i pakietem', () => {
    const f = partnerFirm();
    const rows = freeLotRows(SEED, f);
    const free = f.city.lots.filter((l) => lotState(f, l.id) === 'wolny');
    expect(rows.map((r) => r.lotId)).toEqual(free.map((l) => l.id));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.map((r) => r.no)).toEqual(rows.map((_, i) => i + 1));
    for (const r of rows) {
      const lot = lotById(f.city, r.lotId);
      const est = lotEstimate(SEED, f.city, r.lotId);
      expect(r).toEqual({
        lotId: lot.id, no: r.no, street: lot.street, number: lot.number, district: lot.district, kind: lot.spec.kind, corner: lot.spec.corner,
        area: Math.round(lot.spec.interiorWidth * lot.spec.salesDepth * CELL_SIZE_M * CELL_SIZE_M), lo: est.lo, hi: est.hi, price: lot.package,
      });
      expect(r.lo).toBeLessThan(r.hi);
      expect(r.area).toBeGreaterThan(20);
    }
  });

  it('wynajęty lokal znika z listy, a numery pozostałych zostają (numer to miejsce w mieście, nie w kolejce)', () => {
    const f = partnerFirm();
    const before = freeLotRows(SEED, f);
    const taken = before[1]!;
    expect(applyFirmCommand(f, { type: 'rentLot', lotId: taken.lotId, pay: 'raty' }, emptyStepOut())).toEqual({ ok: true });
    const after = freeLotRows(SEED, f);
    expect(after.map((r) => r.lotId)).toEqual(before.filter((r) => r.lotId !== taken.lotId).map((r) => r.lotId));
    expect(after.map((r) => r.no)).toEqual(before.filter((r) => r.lotId !== taken.lotId).map((r) => r.no));
  });

  it('estymaty liczy się raz na miasto: lista, karta i kolejne odświeżenia nie wołają lotEstimate drugi raz, nowa gra liczy od nowa', () => {
    const f = partnerFirm();
    const free = f.city.lots.filter((l) => lotState(f, l.id) === 'wolny').length;
    expect(free).toBeGreaterThanOrEqual(5);
    vi.mocked(lotEstimate).mockClear();
    const a = freeLotRows(SEED, f);
    expect(lotEstimate).toHaveBeenCalledTimes(free);
    const b = freeLotRows(SEED, f);
    for (const r of a) lotCardModel(SEED, f, r.lotId, 'raty');
    cityPinSpecs(SEED, f, a[0]!.lotId);
    expect(lotEstimate).toHaveBeenCalledTimes(free);   // bez pamięci podręcznej byłoby 3 × free i więcej
    expect(b).toEqual(a);
    freeLotRows(SEED, partnerFirm());                  // inny obiekt miasta (nowa gra) ma własne widełki
    expect(lotEstimate).toHaveBeenCalledTimes(2 * free);
    // widełki z modelu to widełki z symulacji (cache nie zmienia liczb)
    expect(b.map((r) => [r.lo, r.hi])).toEqual(b.map((r) => { const e = lotEstimate(SEED, f.city, r.lotId); return [e.lo, e.hi]; }));
  });
});

describe('freeLotRows: lokal „po Traszce” (4a.2)', () => {
  it('lokal po zamkniętym sklepie jest na liście z ceną rentPrice (30% pakietu co 100 zł), a lista to dokładnie lokale, które przyjmują wynajem', () => {
    const f = reletFirm();
    const id = f.city.startLotId;
    expect(lotState(f, id)).toBe('po-traszce');
    const rows = freeLotRows(SEED, f);
    const relet = rows.find((r) => r.lotId === id)!;
    expect(relet).toBeDefined();
    expect(relet.price).toBe(rentPrice(f, id));
    expect(relet.price).toBe(Math.round(lotById(f.city, id).package * RELET_SHARE / 100) * 100);
    expect(relet.price).toBeLessThan(lotById(f.city, id).package);
    expect(relet.relet).toBe(true);
    expect(rows.filter((r) => r.lotId !== id).every((r) => r.relet === undefined)).toBe(true);   // zwykły wolny lokal nie ma znacznika
    expect(rows.map((r) => r.lotId)).toEqual(f.city.lots.filter((l) => lotRentable(f, l.id)).map((l) => l.id));
    // widełki lokalu „po Traszce” to te same, które liczy symulacja dla lokalu
    const est = lotEstimate(SEED, f.city, id);
    expect([relet.lo, relet.hi]).toEqual([est.lo, est.hi]);
  });

  it('lokal startowy „po Traszce” nie ma numeru kartki (numer miała tylko kartka „DO WYNAJĘCIA” z generatora), a numery pozostałych zostają', () => {
    const f = reletFirm();
    const rows = freeLotRows(SEED, f);
    expect(rows.find((r) => r.lotId === f.city.startLotId)!.no).toBe(0);
    const numbered = rows.filter((r) => r.lotId !== f.city.startLotId);
    const generated = f.city.lots.filter((l) => l.state === 'wolny').map((l) => l.id);   // kolejność kartek z generatora
    expect(numbered.length).toBeGreaterThanOrEqual(3);
    expect(numbered.map((r) => r.no)).toEqual(numbered.map((r) => generated.indexOf(r.lotId) + 1));
    expect(numbered.every((r) => r.no > 0)).toBe(true);
  });

  it('lokal, który wziąłeś znów (budowa), znika z listy', () => {
    const f = reletFirm();
    const id = f.city.startLotId;
    expect(applyFirmCommand(f, { type: 'rentLot', lotId: id, pay: 'gotowka' }, emptyStepOut())).toEqual({ ok: true });
    expect(lotState(f, id)).toBe('budowa');
    expect(freeLotRows(SEED, f).some((r) => r.lotId === id)).toBe(false);
  });
});

describe('lotHours: profil godzinowy karty lokalu (§8.1, 4a.2)', () => {
  const f = partnerFirm();
  const rows = freeLotRows(SEED, f);
  const total = (a: readonly number[]): number => a.reduce((n, v) => n + v, 0);
  const hoursOf = (district: StoreDistrict): ReturnType<typeof lotHours> => lotHours(SEED, f, rowOf(rows, district).lotId);

  it('17 godzin (6–22), a suma doby to środek widełek z karty (±1%) w każdym wolnym lokalu', () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const r of rows) {
      const { weekday } = lotHours(SEED, f, r.lotId);
      expect(weekday, `lokal ${r.no}`).toHaveLength(17);
      expect(weekday.every((v) => v > 0), `lokal ${r.no}`).toBe(true);
      const mid = (r.lo + r.hi) / 2;
      expect(Math.abs(total(weekday) - mid) / mid, `lokal ${r.no}`).toBeLessThan(0.01);
    }
  });

  it('weekend jest tylko tam, gdzie dzielnica ma ruch weekendowy (Biurowce): ten sam kształt razy weekendTraffic / traffic', () => {
    const d = DISTRICTS.biurowce;
    const { weekday, weekend } = hoursOf('biurowce');
    expect(weekend).not.toBeNull();
    expect(weekend).toHaveLength(17);
    weekend!.forEach((v, i) => expect(v).toBeCloseTo(weekday[i]! * d.weekendTraffic! / d.traffic, 9));
    expect(total(weekend!)).toBeLessThan(total(weekday));
    for (const district of ['osiedle', 'srodmiescie', 'dworzec'] as const) expect(hoursOf(district).weekend, district).toBeNull();
  });

  it('Biurowce: wieczór (od 19:00) to mniej niż 5% doby, a rano (godzina 8) tłoczniej niż o 14', () => {
    const { weekday } = hoursOf('biurowce');
    expect(total(weekday.slice(19 - 6)) / total(weekday)).toBeLessThan(0.05);
    expect(weekday[8 - 6]!).toBeGreaterThan(weekday[14 - 6]!);
  });

  it('Dworzec jest płaski, a Osiedle ma kształt HOUR_CURVE', () => {
    const flat = hoursOf('dworzec').weekday;
    for (const v of flat) expect(v).toBeCloseTo(flat[0]!, 9);
    const { weekday } = hoursOf('osiedle');
    const curve = Array.from({ length: 17 }, (_, i) => HOUR_CURVE[6 + i]!);
    weekday.forEach((v, i) => expect(v / total(weekday)).toBeCloseTo(curve[i]! / total(curve), 9));
  });

  it('godziny liczą się z widełek raz na miasto: żadnego nowego wywołania lotEstimate', () => {
    vi.mocked(lotEstimate).mockClear();
    for (const r of rows) lotHours(SEED, f, r.lotId);
    expect(lotEstimate).not.toHaveBeenCalled();   // widełki tego miasta już policzyła lista (pamięć podręczna)
  });
});

describe('validLot: wybór spoza miasta', () => {
  it('istniejący lokal zostaje, brak wyboru, id spoza zakresu i ujemne dają null', () => {
    const f = partnerFirm();
    const last = f.city.lots.length - 1;
    expect(validLot(f, 0)).toBe(0);
    expect(validLot(f, last)).toBe(last);
    expect(validLot(f, null)).toBeNull();
    expect(validLot(f, last + 1)).toBeNull();
    expect(validLot(f, 99_999)).toBeNull();
    expect(validLot(f, -1)).toBeNull();
    expect(validLot(f, 1.5)).toBeNull();
  });
});

describe('poziomy słowami (progi z planu)', () => {
  it('koszyk: ≤ 0,9 niskie, ≥ 1,2 wysokie, pomiędzy średnie', () => {
    expect([0.8, 0.9].map(basketLevel)).toEqual(['niskie', 'niskie']);
    expect([0.91, 1, 1.1, 1.19].map(basketLevel)).toEqual(['srednie', 'srednie', 'srednie', 'srednie']);
    expect([1.2, 1.35].map(basketLevel)).toEqual(['wysokie', 'wysokie']);
  });

  it('oczekiwania: wysokie przy patience < 0 albo repPenalty > 1, niskie przy patience > 0', () => {
    expect(expectationsLevel(-2, 1.5)).toBe('wysokie');
    expect(expectationsLevel(-1, 1)).toBe('wysokie');
    expect(expectationsLevel(0, 1.2)).toBe('wysokie');
    expect(expectationsLevel(1, 1)).toBe('niskie');
    expect(expectationsLevel(0, 1)).toBe('srednie');
    expect(expectationsLevel(1, 1.5)).toBe('wysokie');   // wymagający klienci wygrywają z cierpliwością
  });

  it('kradzieże: ≥ 1,3 wysokie, ≤ 0,7 niskie, pomiędzy średnie', () => {
    expect([1.3, 1.8].map(theftLevel)).toEqual(['wysokie', 'wysokie']);
    expect([0.6, 0.7].map(theftLevel)).toEqual(['niskie', 'niskie']);
    expect([0.8, 1, 1.29].map(theftLevel)).toEqual(['srednie', 'srednie', 'srednie']);
  });
});

describe('lotCardModel: karta lokalu', () => {
  it('liczby z miasta i dzielnicy: poziomy z mnożników dzielnicy, konkurencja z marką i odległością, pakiet z planem 12 rat', () => {
    const f = partnerFirm();
    for (const row of freeLotRows(SEED, f)) {
      const card = lotCardModel(SEED, f, row.lotId, 'raty');
      const lot = lotById(f.city, row.lotId);
      const d = DISTRICTS[lot.district];
      expect(card.row).toEqual(row);
      expect(card.who).toEqual(lotEstimate(SEED, f.city, row.lotId).who);
      expect(card.basket).toBe(basketLevel(d.basket));
      expect(card.expectations).toBe(expectationsLevel(d.patience, d.repPenalty));
      expect(card.theft).toBe(theftLevel(d.theft));
      expect(card.price).toBe(lot.package);
      expect(card.plan).toEqual(planFor(lot.package));
      expect(card.plan.months).toBe(12);
      expect(card.buildDays).toBe(lot.buildDays);
      expect(card.rivals).toEqual(rivalsNear(f.city, row.lotId).map((r) => ({ brand: r.lot.brand, meters: Math.round(r.meters) })));
    }
  });

  it('dzielnice mają swoje poziomy: Dworzec tani i złodziejski, Śródmieście drogie i wymagające, Osiedle średnie', () => {
    const f = partnerFirm();
    const rows = freeLotRows(SEED, f);
    const dworzec = lotCardModel(SEED, f, rowOf(rows, 'dworzec').lotId, 'raty');
    expect([dworzec.basket, dworzec.expectations, dworzec.theft]).toEqual(['niskie', 'niskie', 'wysokie']);
    const centrum = lotCardModel(SEED, f, rowOf(rows, 'srodmiescie').lotId, 'raty');
    expect([centrum.basket, centrum.expectations, centrum.theft]).toEqual(['wysokie', 'wysokie', 'niskie']);
    const osiedle = lotCardModel(SEED, f, rowOf(rows, 'osiedle').lotId, 'raty');
    expect([osiedle.basket, osiedle.expectations, osiedle.theft]).toEqual(['srednie', 'srednie', 'srednie']);
  });

  it('przycisk: z gotówką i statusem działa, a bez statusu, w rankingu, przy limicie i bez pieniędzy ma powód odmowy', () => {
    const lotId = freeLotRows(SEED, partnerFirm())[0]!.lotId;
    expect(lotCardModel(SEED, partnerFirm(), lotId, 'gotowka').action).toEqual({ enabled: true });
    expect(lotCardModel(SEED, partnerFirm(), lotId, 'raty').action).toEqual({ enabled: true });

    const noStatus = firmOf(createSession(SEED, true));
    expect(lotCardModel(SEED, noStatus, lotId, 'raty').action).toEqual({ enabled: false, reason: 'status' });

    const ranked = partnerFirm();
    ranked.ranked = true;
    expect(lotCardModel(SEED, ranked, lotId, 'gotowka').action).toEqual({ enabled: false, reason: 'ranked' });

    const poor = partnerFirm(SEED, 1_000);
    expect(lotCardModel(SEED, poor, lotId, 'gotowka').action).toEqual({ enabled: false, reason: 'gotowka' });
    expect(lotCardModel(SEED, poor, lotId, 'raty').action).toEqual({ enabled: true });   // raty nie ruszają gotówki

    const full = partnerFirm();
    const [first, second, third] = freeLotRows(SEED, full);
    expect(applyFirmCommand(full, { type: 'rentLot', lotId: first!.lotId, pay: 'raty' }, emptyStepOut())).toEqual({ ok: true });
    expect(lotCardModel(SEED, full, second!.lotId, 'raty').action).toEqual({ enabled: true });   // sklep i budowa to jeszcze nie komplet trzech
    expect(applyFirmCommand(full, { type: 'rentLot', lotId: second!.lotId, pay: 'raty' }, emptyStepOut())).toEqual({ ok: true });
    expect(lotCardModel(SEED, full, third!.lotId, 'raty').action).toEqual({ enabled: false, reason: 'limit' });   // budowy liczą się do limitu
  });

  it('rata ponad limit nowego sklepu: powód „raty”', () => {
    const f = partnerFirm();
    const row = freeLotRows(SEED, f)[0]!;
    lotById(f.city, row.lotId).package = 150_000;   // 150 tys. zł w 12 ratach z opłatą 15% to ok. 14,4 tys. zł miesięcznie
    expect(lotCardModel(SEED, f, row.lotId, 'raty').action).toEqual({ enabled: false, reason: 'raty' });
  });
});

describe('lotCardModel: profil godzinowy i lokal „po Traszce” (4a.2)', () => {
  it('karta wolnego lokalu niesie godziny tego lokalu, a bloku wyposażenia nie ma', () => {
    const f = partnerFirm();
    for (const row of freeLotRows(SEED, f)) {
      const card = lotCardModel(SEED, f, row.lotId, 'raty');
      expect(card.hours).toEqual(lotHours(SEED, f, row.lotId));
      expect(card.relet).toBeNull();
    }
  });

  it('lokal „po Traszce”: cena i dni budowy z reguł wynajmu, raty z planFor ceny (6 rat, nie 12), wyposażenie z zamkniętego sklepu', () => {
    const f = reletFirm();
    const id = f.city.startLotId;
    const lot = lotById(f.city, id);
    const card = lotCardModel(SEED, f, id, 'raty');
    expect(card.price).toBe(rentPrice(f, id));
    expect(card.price).not.toBe(lot.package);
    expect(card.plan).toEqual(planFor(card.price));
    expect(card.plan.months).toBe(6);
    expect(card.buildDays).toBe(rentBuildDays(f, id));
    expect(card.buildDays).toBe(RELET_BUILD_DAYS);
    expect(card.relet).toEqual({ remontLevel: 1, equipment: 2, upgrades: 4 });
    expect(card.row.price).toBe(card.price);
    expect(card.action).toEqual({ enabled: true });
  });

  it('lokal „po Traszce” i gotówka: powód odmowy liczy się od ceny po rabacie', () => {
    const f = reletFirm();
    const id = f.city.startLotId;
    const price = rentPrice(f, id);
    f.person.wallet = price;   // po zapłacie dokładnie zero: wystarcza tylko przy cenie ze zniżką
    expect(lotCardModel(SEED, f, id, 'gotowka').action).toEqual({ enabled: true });
    f.person.wallet = price - 100;
    expect(lotCardModel(SEED, f, id, 'gotowka').action).toEqual({ enabled: false, reason: 'gotowka' });
  });
});

describe('nawigacja po wolnych lokalach', () => {
  const rows = [{ lotId: 10 }, { lotId: 20 }, { lotId: 30 }] as LotRow[];

  it('‹ › idą po liście w kółko', () => {
    expect(neighbourLot(rows, 10, 1)).toBe(20);
    expect(neighbourLot(rows, 30, 1)).toBe(10);
    expect(neighbourLot(rows, 20, -1)).toBe(10);
    expect(neighbourLot(rows, 10, -1)).toBe(30);
  });

  it('bez wyboru (albo przy lokalu spoza listy) strzałka wchodzi na początek albo koniec listy; pusta lista daje null', () => {
    expect(neighbourLot(rows, null, 1)).toBe(10);
    expect(neighbourLot(rows, null, -1)).toBe(30);
    expect(neighbourLot(rows, 99, 1)).toBe(10);
    expect(neighbourLot([], null, 1)).toBeNull();
    expect(neighbourLot([rows[0]!], 10, 1)).toBe(10);
  });

  it('przesunięcie palcem w lewo to następny lokal, w prawo poprzedni; krótkie albo pionowe nie liczy się', () => {
    expect(swipeDirection(-SWIPE_MIN_PX, 0)).toBe(1);
    expect(swipeDirection(SWIPE_MIN_PX, 4)).toBe(-1);
    expect(swipeDirection(-SWIPE_MIN_PX + 1, 0)).toBeNull();
    expect(swipeDirection(-120, 100)).toBeNull();   // to przewijanie karty, nie przesunięcie
    expect(swipeDirection(0, 0)).toBeNull();
  });
});

describe('stany lokali i pinezki dla sceny miasta', () => {
  it('cityLotStates zna stan każdego lokalu, także tego, który generator oznaczył inaczej', () => {
    const f = partnerFirm();
    const states = cityLotStates(f);
    expect(Object.keys(states)).toHaveLength(f.city.lots.length);
    for (const l of f.city.lots) expect(states[l.id]).toBe(lotState(f, l.id));
    expect(states[f.city.startLotId]).toBe('twoj');
  });

  it('wolny lokal ma pinezkę-kartkę z numerem, a wybrany dopisuje adres', () => {
    const f = partnerFirm();
    const rows = freeLotRows(SEED, f);
    const pins = cityPinSpecs(SEED, f, null);
    for (const r of rows) expect(pins.find((p) => p.lotId === r.lotId)).toEqual({ lotId: r.lotId, kind: 'wolny', label: String(r.no) });
    const chosen = rows[2]!;
    expect(cityPinSpecs(SEED, f, chosen.lotId).find((p) => p.lotId === chosen.lotId)!.label).toBe(`${chosen.no} · ul. ${chosen.street} ${chosen.number}`);
  });

  it('własny sklep jest zielony z numerem, konkurencja ma markę, lokal obok kartkę, a zwykły zajęty nie ma pinezki', () => {
    const f = partnerFirm();
    const pins = cityPinSpecs(SEED, f, null);
    expect(pins.find((p) => p.lotId === f.city.startLotId)).toEqual({ lotId: f.city.startLotId, kind: 'twoj', label: 'Traszka #1' });
    for (const l of f.city.lots.filter((x) => x.state === 'konkurencja')) {
      expect(pins.find((p) => p.lotId === l.id)).toEqual({ lotId: l.id, kind: l.brand, label: l.brand === 'kawka' ? 'Kawka Express' : 'Szop 24h' });
    }
    const next = f.city.neighbourLotId;
    if (next !== null) expect(pins.find((p) => p.lotId === next)).toMatchObject({ kind: 'wolny', label: 'lokal obok' });
    const plain = f.city.lots.find((l) => lotState(f, l.id) === 'zajety')!;
    expect(pins.some((p) => p.lotId === plain.id)).toBe(false);
    // pinezki są dokładnie tam, gdzie scena ma kotwice: każdy lokal poza zwykłym zajętym
    expect(pins.map((p) => p.lotId).sort((a, b) => a - b)).toEqual(f.city.lots.filter((l) => lotState(f, l.id) !== 'zajety').map((l) => l.id));
  });

  it('budowa ma licznik dni z odmianą', () => {
    const f = partnerFirm();
    const row = freeLotRows(SEED, f)[0]!;
    syncWallet(f);
    expect(applyFirmCommand(f, { type: 'rentLot', lotId: row.lotId, pay: 'raty' }, emptyStepOut())).toEqual({ ok: true });
    const build = f.builds[0]!;
    const label = (): string => cityPinSpecs(SEED, f, null).find((p) => p.lotId === row.lotId)!.label;
    expect(cityPinSpecs(SEED, f, null).find((p) => p.lotId === row.lotId)!.kind).toBe('budowa');
    const left = build.readyDay - Math.floor(f.stores[0]!.econ.minute / MINUTES_PER_DAY);
    expect(label()).toBe(`za ${left} ${left === 1 ? 'dzień' : 'dni'}`);
    build.readyDay = Math.floor(f.stores[0]!.econ.minute / MINUTES_PER_DAY) + 1;
    expect(label()).toBe('za 1 dzień');
    build.readyDay = Math.floor(f.stores[0]!.econ.minute / MINUTES_PER_DAY);
    expect(label()).toBe('otwarcie dziś');
  });

  it('lokal po zamkniętym sklepie ma kartkę z dopiskiem „po Traszce” w tekście, bo napis na samej kartce jest za mały', () => {
    const f = partnerFirm();
    f.stores[0]!.closed = true;
    const pin = cityPinSpecs(SEED, f, null).find((p) => p.lotId === f.city.startLotId)!;
    expect(pin).toEqual({ lotId: f.city.startLotId, kind: 'po-traszce', label: 'po Traszce' });
    lang.value = 'en';
    expect(cityPinSpecs(SEED, f, null).find((p) => p.lotId === f.city.startLotId)!.label).toBe('ex-Traszka');
  });
});
