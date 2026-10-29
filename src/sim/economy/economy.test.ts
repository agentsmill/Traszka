import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import {
  BANKRUPTCY_AT, CATS, CAT_INFO, FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE, HOT, ITEMS_PER_CUSTOMER, MARGIN_PER_CUSTOMER, MINUTES_PER_DAY, OPEN_FROM, OPEN_TO, REVENUE_PER_CUSTOMER,
  START_CASH, STRAZ, TILL_RATE, UNLOAD_AT, UNLOAD_RATE, WAGE_PER_DAY, WAVES,
} from './catalog';
import { dateOfDay, dayOf, formatDate, isLastDayOfMonth, minuteOfDay } from './calendar';
import { advanceEconomy } from './clock';
import {
  answerCard, arrivalRate, assistantSuggestion, awaitingDecision, buyEquipment, buyUpgrade, cardContext, changeTrust, createEconomy, crewPalletCap, effects,
  estimatedDailyMargin, expectedDailyCustomers, fire, franchiseFee, freeSpots, GOLDEN_PRIZE, isOpenForCustomers, kpiMetricsOf, kpiScaleOf, movePallet, orderedPallets, relayout,
  returnPallet, robotFleet, sell, slotFree, startRemont, stepMinute, tapPallet, tapTill, unlocksAt, upgradeBlocker, waveAt, workshopUnlocked,
  type CommandResult, type EconEvent, type EconomyState, type MonthReport,
} from './economy';
import { rand01 } from './rand';
import { computeStoreInfo, type StoreInfo } from './storeInfo';
import { cardDef, visibleCards, type CardDelta, type CardInstance } from './tycoon/cards';
import { rollWeather } from './tycoon/cleanliness';
import { kpiTitle, newKpiWeek } from './tycoon/kpi';
import { HINT_IDS, REPORT_LINES, reportCommentText } from './tycoon/report';
import { emptyStaffStats, pinStaff, setStaffProfile } from './tycoon/staff';
import { SUNDAY_TRAFFIC } from './tycoon/sunday';
import { dateOfGameDay, isSunday, roundNice } from './tycoon/time';
import { TRUST, trustTier, turnoverBonusShare } from './tycoon/trust';
import { hallObstacle, palletBags } from './tycoon/waste';
import { WUT } from './tycoon/wut';
import { UPGRADE_BY_ID } from './upgrades';

const SEED = 'kiełbasa-42';   // blok z 1 slotem SCO i 3 slotami 2×2
const info = computeStoreInfo(generateStore(SEED));

function run(s: EconomyState, inf: StoreInfo, minutes: number, events: EconEvent[] = []): EconEvent[] {
  for (let i = 0; i < minutes; i++) stepMinute(s, inf, events);
  return events;
}

describe('kalendarz', () => {
  it('gra startuje we wtorek 1 września 2026, wrzesień ma 30 dni', () => {
    expect(dateOfDay(0)).toEqual({ year: 2026, month: 8, date: 1, weekday: 2 });
    expect(formatDate(0)).toBe('wt 1 września');
    expect(isLastDayOfMonth(28)).toBe(false);
    expect(isLastDayOfMonth(29)).toBe(true);
    expect(dateOfDay(122).month).toBe(0);   // 1 stycznia 2027
  });
});

describe('ekonomia', () => {
  it('nowa gra: 6:00, gotówka startowa, dwie palety pod sklepem', () => {
    const s = createEconomy(SEED, info);
    expect(s.minute).toBe(OPEN_FROM);
    expect(s.cash).toBe(START_CASH);
    expect(s.pallets.map((p) => p.loc)).toEqual(['sidewalk', 'sidewalk']);
  });

  it('ten sam seed i te same decyzje dają ten sam przebieg; zapis JSON wznawia grę bez różnic', () => {
    const a = createEconomy(SEED, info);
    const b = createEconomy(SEED, info);
    run(a, info, 2 * MINUTES_PER_DAY);
    run(b, info, 2 * MINUTES_PER_DAY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const restored = JSON.parse(JSON.stringify(a)) as EconomyState;
    run(a, info, 1000);
    run(restored, info, 1000);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(a));
  });

  it('stepMinute nie stuka za gracza: bez poleceń ani combo, ani siły się nie ruszają', () => {
    const a = createEconomy(SEED, info);
    run(a, info, 6 * MINUTES_PER_DAY);
    expect(a.tapStreak).toBe(0);
    expect(a.lastTapAt).toBe(-1e9);
    expect(a.tycoon.fatigue).toEqual(createEconomy(SEED, info).tycoon.fatigue);
    expect(a.total.taps).toBe(0);
  });

  it('pierwszy dzień: sprzedaż, zamówienie o 11:00, zamknięcie dnia z płacami', () => {
    const s = createEconomy(SEED, info);
    const events = run(s, info, MINUTES_PER_DAY);
    expect(s.total.customers).toBeGreaterThan(200);
    expect(s.total.margin).toBeGreaterThan(500);
    expect(s.total.wages).toBe(2 * WAGE_PER_DAY);
    expect(events.some((e) => e.kind === 'order')).toBe(true);
    expect(events.some((e) => e.kind === 'day')).toBe(true);
  });

  it('kasy samoobsługowe i druga kasa zmniejszają liczbę klientów, którzy odchodzą od kolejki', () => {
    const busy = (setup: (s: EconomyState) => void): number => {
      const s = createEconomy(SEED, info);
      s.reputation = 100;
      s.upgrades.ulotki = 5;
      s.cash = 1e6;
      setup(s);
      run(s, info, MINUTES_PER_DAY);
      return s.total.lost;
    };
    const base = busy(() => {});
    const twoTills = busy((s) => { s.upgrades.szkolenie = 1; s.upgrades.drugaKasa = 1; s.staff = 4; });
    const sco = busy((s) => { buyEquipment(s, info, 'sco'); buyEquipment(s, info, 'sco'); buyEquipment(s, info, 'sco'); });
    expect(base).toBeGreaterThan(50);
    expect(twoTills).toBeLessThan(base * 0.5);
    expect(sco).toBeLessThan(base * 0.7);
  });

  it('palety pod sklepem ściągają Straż Miejską, na zapleczu nie', () => {
    const fines = (onSidewalk: boolean): number => {
      const s = createEconomy(SEED, info);
      s.staff = 0;            // nikt nie rozładowuje: pula ludzi oddaje wolne ręce paletom, więc jedyny pewny sposób to brak ludzi
      s.order = { auto: false, manual: 0 };
      if (!onSidewalk) for (const p of [...s.pallets]) movePallet(s, info, p.id, 'backroom');
      for (const c of CATS) s.backroom[c] = 0;
      let total = 0;
      for (let day = 0; day < 6; day++) {
        // palety wracają co rano, żeby ryzyko trwało cały czas
        while (s.pallets.length < 4) s.pallets.push({ ...s.pallets[0]!, id: 100 + s.pallets.length + day * 10, spot: s.pallets.length, since: s.minute });
        run(s, info, MINUTES_PER_DAY);
        total = s.total.fines;
        for (const p of s.pallets) { p.items = { ...p.items }; }
      }
      return total;
    };
    expect(fines(true)).toBeGreaterThan(0);
    expect(fines(false)).toBe(0);
  });

  it('Straż Miejska: tolerancja po dostawie, najpierw upomnienie, mandat dopiero przy powtórce tego samego dnia (STRAZ)', () => {
    const s = createEconomy(SEED, info);
    s.staff = 0;            // nikt nie rozładowuje, więc palety stoją na chodniku całe dnie
    s.order = { auto: false, manual: 0 };
    const log: { minute: number; kind: 'upomnienie' | 'mandat'; since: number }[] = [];
    for (let day = 0; day < 20; day++) {
      const events: EconEvent[] = [];
      while (s.pallets.length < 4) s.pallets.push({ ...s.pallets[0]!, id: 100 + s.pallets.length + day * 10, spot: s.pallets.length, since: s.minute });
      for (let i = 0; i < MINUTES_PER_DAY; i++) {
        const before = events.length;
        stepMinute(s, info, events);
        for (const e of events.slice(before)) {
          const since = Math.min(...s.pallets.filter((p) => p.loc === 'sidewalk').map((p) => p.since));
          if (e.kind === 'warning' && e.text.startsWith('Straż Miejska: upomnienie')) log.push({ minute: s.minute - 1, kind: 'upomnienie', since });
          if (e.kind === 'fine') log.push({ minute: s.minute - 1, kind: 'mandat', since });
        }
      }
    }
    const warnings = log.filter((e) => e.kind === 'upomnienie');
    const fines = log.filter((e) => e.kind === 'mandat');
    expect(warnings.length).toBeGreaterThan(0);
    expect(fines.length).toBeGreaterThan(0);
    for (const e of log) {
      const mod = minuteOfDay(e.minute);
      expect(mod).toBeGreaterThanOrEqual(STRAZ.from);
      expect(mod).toBeLessThan(STRAZ.to);
      expect(e.minute - e.since).toBeGreaterThanOrEqual(STRAZ.graceMin);
    }
    // każdy mandat ma upomnienie tego samego dnia, co najmniej `warnGapMin` wcześniej; jedno upomnienie na dzień
    for (const f of fines) {
      const warn = warnings.find((w) => dayOf(w.minute) === dayOf(f.minute));
      expect(warn).toBeDefined();
      expect(f.minute - warn!.minute).toBeGreaterThanOrEqual(STRAZ.warnGapMin);
    }
    const days = warnings.map((w) => dayOf(w.minute));
    expect(new Set(days).size).toBe(days.length);
    // upomnienie nic nie kosztuje: wszystkie mandaty z kasy to kwoty mandatów
    expect(s.total.fineCount).toBe(fines.length);
  });

  it('Asystent Traszki nie zamawia więcej palet, niż zmiana rozładuje przed obchodem (crewPalletCap)', () => {
    const s = createEconomy(SEED, info);
    for (const c of CATS) { s.shelf[c] = 0; s.backroom[c] = 0; }
    s.pallets = [];
    s.staff = 2;
    const cap2 = crewPalletCap(s, info);
    expect(assistantSuggestion(s, info)).toBe(cap2);   // puste półki: potrzeba więcej, niż zmiana rozładuje
    s.staff = 4;
    expect(crewPalletCap(s, info)).toBeGreaterThan(cap2);   // więcej ludzi, więcej palet
    s.staff = 1;
    expect(crewPalletCap(s, info)).toBeGreaterThanOrEqual(1);
    s.order = { auto: false, manual: 30 };
    expect(orderedPallets(s, info)).toBe(30);   // ręczne zamówienie gracza nie ma limitu asystenta (za duże → mandaty)
  });

  it('przesadne zamówienie bez rąk do pracy: palety się kumulują, a nadmiar kierowca zabiera za opłatą', () => {
    const s = createEconomy(SEED, info);
    s.staff = 0;
    s.order = { auto: false, manual: 12 };
    const events = run(s, info, 4 * MINUTES_PER_DAY);
    expect(s.pallets.length).toBeGreaterThanOrEqual(8);
    expect(events.some((e) => e.kind === 'warning' && e.text.includes('zabrał'))).toBe(true);
    expect(s.total.logistics).toBeGreaterThan(0);
  });

  it('stuknięcie w paletę rozładowuje kawałek, stuknięcie w kasę obsługuje klienta', () => {
    const s = createEconomy(SEED, info);
    const before = s.pallets[0]!.total;
    for (const c of CATS) s.backroom[c] = 0;
    expect(tapPallet(s, info).ok).toBe(true);
    expect(s.pallets[0]!.total).toBeLessThan(before);
    expect(tapTill(s, info).ok).toBe(false);   // pusta kolejka
    s.queue = 3;
    const cash = s.cash;
    expect(tapTill(s, info).ok).toBe(true);
    expect(s.queue).toBe(2);
    expect(s.cash).toBeGreaterThan(cash);
  });

  it('ulepszenia: cena, poziom, wymagania; warsztat zamknięty na starcie', () => {
    const s = createEconomy(SEED, info);
    s.cash = 100_000;
    expect(buyUpgrade(s, 'ulotki').ok).toBe(true);
    expect(s.upgrades.ulotki).toBe(1);
    expect(s.cash).toBe(100_000 - 800);
    expect(upgradeBlocker(s, UPGRADE_BY_ID.rampa)).toMatch(/6\. poziomie/);
    s.level = 6;
    expect(upgradeBlocker(s, UPGRADE_BY_ID.rampa)).toMatch(/Wymaga/);
    expect(workshopUnlocked(s)).toBe(false);
    expect(buyUpgrade(s, 'tasmociag').ok).toBe(false);
    s.level = 10;
    expect(buyUpgrade(s, 'tasmociag').ok).toBe(true);
    expect(robotFleet(s)).toEqual({ tasmociag: 1, wykladacz: 0, prasa: 0, edward: 0 });
  });

  it('slot 2×2 mieści dwie kasy samoobsługowe; bez slotów zakup się nie udaje', () => {
    const s = createEconomy(SEED, info);
    s.cash = 1e6;
    const capacity = info.slots.reduce((n, x) => n + x.capacity, 0);
    for (let i = 0; i < capacity; i++) expect(buyEquipment(s, info, 'sco').ok).toBe(true);
    expect(buyEquipment(s, info, 'sco').ok).toBe(false);
    const big = info.slots.find((x) => x.capacity === 2)!;
    expect(s.equipment.filter((e) => e.slot === big.id)).toHaveLength(2);
    expect(slotFree(s, info, big.id)).toBe(0);
  });

  it('koniec września: opłata franczyzowa i raport miesięczny', () => {
    const s = createEconomy(SEED, info);
    const events = run(s, info, 30 * MINUTES_PER_DAY);
    const report = events.find((e) => e.kind === 'month');
    expect(report?.report?.label).toBe('wrzesień 2026');
    expect(report?.report?.counters.fee).toBeGreaterThan(3500);
    expect(s.history).toHaveLength(1);
  });

  it('remont zamyka sklep na kilka dni, a po nim większy sklep przejmuje palety i sprzęt', () => {
    const s = createEconomy(SEED, info);
    s.cash = 1e6;
    buyEquipment(s, info, 'sco');
    expect(startRemont(s).ok).toBe(false);   // remont od 8. poziomu
    s.level = 8;
    expect(startRemont(s).ok).toBe(true);
    const lot = generateStore(SEED).lot;
    const bigger = computeStoreInfo(generateStore(`${SEED}:remont:1`, { ...lot, interiorWidth: lot.interiorWidth + 4, salesDepth: lot.salesDepth + 2, backroomDepth: lot.backroomDepth + 1 }, { equipmentSlots: 4 }));
    relayout(s, bigger);
    const customers = s.total.customers;
    run(s, bigger, MINUTES_PER_DAY);
    expect(s.total.customers).toBe(customers);   // zamknięte
    const events = run(s, bigger, 2 * MINUTES_PER_DAY);
    expect(events.some((e) => e.kind === 'remont')).toBe(true);
    expect(s.total.customers).toBeGreaterThan(customers);
    expect(s.equipment[0]!.slot).not.toBeNull();
    expect(bigger.shelfCapTotal).toBeGreaterThan(info.shelfCapTotal);
  });

  it('zegar: dzień sklepu przy ×1 trwa 2 min 50 s, noc 30 s', () => {
    const s = createEconomy(SEED, info);
    s.tycoon.cards.pending = [];   // zegar mierzymy bez kart: karta zatrzymuje grę, a reszta klatki przepada (clock.test.ts)
    const clock = { acc: 0 };
    let minutes = 0;
    for (let t = 0; t < 170; t++) minutes += advanceEconomy(s, info, clock, 1, []);
    expect(Math.abs(minutes - 17 * 60)).toBeLessThanOrEqual(1);   // błąd zaokrągleń sumy ułamków minut
    for (let t = 0; t < 30; t++) minutes += advanceEconomy(s, info, clock, 1, []);
    expect(Math.abs(minutes - 24 * 60)).toBeLessThanOrEqual(2);
  });
});

describe('rozładunek z automatyką warsztatu', () => {
  const emptyItems = () => Object.fromEntries(CATS.map((c) => [c, 0])) as Record<(typeof CATS)[number], number>;

  it('złota paleta rozładowana przez ludzi i taśmociąg w jednej minucie daje premię i licznik dokładnie raz', () => {
    const s = createEconomy(SEED, info);
    s.upgrades.tasmociag = 1;   // całą dobę
    s.staff = 2;
    s.order = { auto: false, manual: 0 };
    setStaffProfile(s.tycoon.staff, 'dostawa');   // ludzie najpierw przy paletach, nie przy półkach
    // ułamek nad tym, co zdejmuje człowiek przy jednej minucie pracy: pula dokłada taśmociąg w tej samej minucie
    const total = UNLOAD_RATE * UNLOAD_AT.sidewalk + 0.2;
    s.pallets = [{ id: 900, loc: 'sidewalk', spot: 0, items: { ...emptyItems(), napoje: total }, total, initial: total, since: s.minute, golden: true }];
    const events: EconEvent[] = [];
    stepMinute(s, info, events);
    expect(s.pallets).toHaveLength(0);
    expect(s.total.palletsUnloaded).toBe(1);
    // jedna premia (komunikat powstaje razem z wypłatą), nie dwie
    expect(events.filter((e) => e.kind === 'golden' && e.text.includes('rozładowana'))).toHaveLength(1);
  });

  it('przy długiej grze z taśmociągiem licznik rozładowanych palet zgadza się z liczbą palet, które zeszły ze sklepu', () => {
    const pavilion = computeStoreInfo(generateStore('traszka-1'));
    const s = createEconomy('traszka-1', pavilion);
    s.cash = 1e6;
    s.level = 12;
    s.upgrades.tasmociag = 2;
    s.order = { auto: false, manual: 6 };
    run(s, pavilion, 40 * MINUTES_PER_DAY);
    const created = s.nextPalletId - 1;
    expect(created).toBeGreaterThan(100);
    expect(s.total.palletsUnloaded).toBe(created - s.pallets.length);
  });
});

describe('personel w jednej minucie', () => {
  it('kasjerzy, którzy obsłużyli kolejkę, nie rozładowują palet w tej samej minucie', () => {
    const s = createEconomy(SEED, info);
    s.upgrades.drugaKasa = 1;
    s.staff = 3;
    s.order = { auto: false, manual: 0 };
    s.queue = 4.3;   // przed obsługą kolejka starcza na dwa stanowiska; profil „Kolejka” daje im pierwszeństwo
    const before = s.total.customers;
    stepMinute(s, info, []);
    const served = s.total.customers - before;
    expect(served).toBeCloseTo(2 * TILL_RATE, 6);   // obsłużyło dwóch kasjerów
    expect(s.lastCashiers).toBeCloseTo(2, 9);
    expect(s.lastWorkers).toBeCloseTo(1, 9);
    expect(s.lastCashiers + s.lastWorkers).toBeCloseTo(s.staff, 9);
    expect(s.shift.staff).toBe(3);
    expect(s.shift.human.kasa).toBeCloseTo(2, 9);
  });
});

describe('pula ludzi zamiast priorytetu', () => {
  const sumTotals = (s: EconomyState): number => s.pallets.reduce((n, p) => n + p.total, 0);
  const sumOf = (r: Record<(typeof CATS)[number], number>): number => CATS.reduce((n, c) => n + r[c], 0);

  it('profil „dostawa” rozładowuje więcej niż „kolejka”, gdy kolejka stoi', () => {
    const left = (profile: 'kolejka' | 'dostawa'): number => {
      const s = createEconomy(SEED, info);
      setStaffProfile(s.tycoon.staff, profile);
      s.order = { auto: false, manual: 0 };
      s.queue = 12;
      run(s, info, 60);
      return sumTotals(s);
    };
    expect(left('dostawa')).toBeLessThan(left('kolejka'));
  });

  it('przypięta osoba obsługuje kasę wbrew profilowi „dostawa”, dopóki jest kolejka', () => {
    const served = (pinned: boolean): number => {
      const s = createEconomy(SEED, info);
      setStaffProfile(s.tycoon.staff, 'dostawa');
      if (pinned) expect(pinStaff(s.tycoon.staff, 'kasa', 1, s.staff).ok).toBe(true);
      s.order = { auto: false, manual: 0 };
      s.queue = 12;
      stepMinute(s, info, []);
      return s.total.customers;
    };
    expect(served(true)).toBeCloseTo(TILL_RATE, 6);
    expect(served(false)).toBeLessThan(served(true));   // sama „dostawa” wysyła obu ludzi do palet
  });

  it('taśmociąg rozładowuje nocą, gdy nikogo nie ma na zmianie', () => {
    const night = (tasmociag: number): { before: number; after: number; shift: EconomyState['shift'] } => {
      const s = createEconomy(SEED, info);
      s.minute = 2 * 60;
      s.upgrades.tasmociag = tasmociag;
      expect(movePallet(s, info, s.pallets[0]!.id, 'backroom').ok).toBe(true);
      s.pallets = s.pallets.filter((p) => p.loc === 'backroom');
      const before = s.pallets[0]!.total;
      run(s, info, 30);
      return { before, after: s.pallets[0]!.total, shift: s.shift };
    };
    const belt = night(1);
    expect(belt.after).toBeLessThan(belt.before);
    expect(belt.shift.staff).toBe(0);
    const none = night(0);
    expect(none.after).toBe(none.before);   // bez taśmociągu noc nic nie robi
  });

  it('wykładacz uzupełnia półki nocą z zaplecza', () => {
    const s = createEconomy(SEED, info);
    s.minute = 2 * 60;
    s.upgrades.wykladacz = 1;
    for (const c of CATS) s.shelf[c] = 0.5 * info.shelfCap[c];
    const before = sumOf(s.shelf);
    run(s, info, 30);
    expect(sumOf(s.shelf)).toBeGreaterThan(before + 100);
  });

  it('eDward bierze zadania z puli także nocą', () => {
    const s = createEconomy(SEED, info);
    s.minute = 2 * 60;
    s.upgrades.humanoid = 1;
    expect(robotFleet(s).edward).toBe(1);
    const before = sumTotals(s);
    run(s, info, 30);
    expect(sumTotals(s)).toBeLessThan(before);
  });

  it('shift: w godzinach pracy tyle osób, ile personelu, nocą zero; ludzie mają pracę tylko w godzinach pracy', () => {
    const s = createEconomy(SEED, info);
    s.staff = 3;
    run(s, info, 6 * 60);                       // 12:00
    expect(s.shift.staff).toBe(3);
    const sum = Object.values(s.shift.human).reduce((n, v) => n + v, 0);
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(3 + 1e-9);
    // pola dla interfejsu (`lastCashiers`, `lastWorkers`) to ten sam przydział co `shift.human`
    const h = s.shift.human;
    expect(s.lastCashiers).toBe(h.kasa);
    expect(s.lastWorkers).toBe(h.rozladunek + h.wykladanie + h.sprzatanie);
    run(s, info, 12 * 60);                      // 0:00
    expect(s.shift.staff).toBe(0);
    expect(Object.values(s.shift.human).reduce((n, v) => n + v, 0)).toBe(0);
    expect(s.lastCashiers).toBe(0);
    expect(s.lastWorkers).toBe(0);
  });

  it('efekt karty „chory” zmniejsza zmianę w symulacji, a nie tylko na ekranie', () => {
    const s = createEconomy(SEED, info);
    s.staff = 3;
    s.tycoon.cards.active.push({ kind: 'staff', value: -1, from: 0, until: 1e9, seq: 1 });
    run(s, info, 10);
    expect(s.shift.staff).toBe(2);
  });

  it('zwolnienie przycina przypiętych do personelu', () => {
    const s = createEconomy(SEED, info);
    s.staff = 3;
    expect(pinStaff(s.tycoon.staff, 'kasa', 3, s.staff).ok).toBe(true);
    expect(s.tycoon.staff.pinned.kasa).toBe(3);
    expect(fire(s).ok).toBe(true);
    expect(s.staff).toBe(2);
    expect(s.tycoon.staff.pinned.kasa).toBe(2);
    expect(fire(s).ok).toBe(true);
    expect(fire(s).ok).toBe(false);   // ostatnia osoba zostaje
    expect(s.tycoon.staff.pinned.kasa).toBe(1);
  });

  it('wykonana minuta nocą nie zabiera ludziom pracy z kart (czas kart odrabiają tylko ludzie na zmianie)', () => {
    const s = createEconomy(SEED, info);
    s.minute = 2 * 60;
    s.tycoon.staff.chores = 5;
    run(s, info, 30);
    expect(s.tycoon.staff.chores).toBe(5);
  });
});

describe('ostatni raport miesięczny w stanie', () => {
  it('po zamknięciu miesiąca raport zostaje w stanie i przechodzi przez zapis JSON', () => {
    const s = createEconomy(SEED, info);
    expect(s.lastReport).toBeNull();
    const events = run(s, info, 30 * MINUTES_PER_DAY);
    const report = events.find((e) => e.kind === 'month')!.report!;
    expect(s.lastReport).toEqual(report);
    expect((JSON.parse(JSON.stringify(s)) as EconomyState).lastReport).toEqual(report);
  });

  it('bankructwo: stan z wypowiedzianą umową niesie raport, który okno końca gry pokaże po przeładowaniu', () => {
    const s = createEconomy(SEED, info);
    s.cash = -1e6;
    run(s, info, 61 * MINUTES_PER_DAY);
    expect(s.gameOver).toBe(true);
    const restored = JSON.parse(JSON.stringify(s)) as EconomyState;
    expect(restored.gameOver).toBe(true);
    expect(restored.lastReport?.label).toBe('październik 2026');
    expect(restored.lastReport?.cash).toBeLessThan(BANKRUPTCY_AT);
  });

  it('pierwszy miesiąc bez opłacenia Centrali to ostrzeżenie, drugi z rzędu kończy umowę (spec §10)', () => {
    const s = createEconomy(SEED, info);
    s.cash = -1e6;
    const first = run(s, info, 30 * MINUTES_PER_DAY);
    expect(s.gameOver).toBe(false);
    expect(first.filter((e) => e.kind === 'debt')).toHaveLength(1);
    expect(first.some((e) => e.kind === 'gameover')).toBe(false);
    const second = run(s, info, 31 * MINUTES_PER_DAY);
    expect(s.gameOver).toBe(true);
    expect(second.some((e) => e.kind === 'gameover')).toBe(true);
    expect(second.some((e) => e.kind === 'debt')).toBe(false);
  });

  it('miesiąc z opłaconą Centralą między dwoma nieopłaconymi zeruje licznik', () => {
    const s = createEconomy(SEED, info);
    s.cash = -1e6;
    run(s, info, 30 * MINUTES_PER_DAY);   // wrzesień: ostrzeżenie
    s.cash = 1e6;
    run(s, info, 31 * MINUTES_PER_DAY);   // październik: opłacony
    expect(s.gameOver).toBe(false);
    s.cash = -1e6;
    const third = run(s, info, 30 * MINUTES_PER_DAY);   // listopad: znów pierwszy z rzędu
    expect(s.gameOver).toBe(false);
    expect(third.some((e) => e.kind === 'debt')).toBe(true);
  });
});

describe('opłata franczyzowa', () => {
  it('stała część plus udział w obrocie, w pełnych złotych', () => {
    expect(franchiseFee(0)).toBe(FRANCHISE_FEE_FIXED);
    expect(franchiseFee(200_000)).toBe(Math.round(FRANCHISE_FEE_FIXED + FRANCHISE_FEE_SHARE * 200_000));
    expect(franchiseFee(123_456.78)).toBe(Math.round(FRANCHISE_FEE_FIXED + FRANCHISE_FEE_SHARE * 123_456.78));
  });

  it('zamknięcie miesiąca nalicza dokładnie tyle, ile pokazuje franchiseFee dla obrotu tego miesiąca', () => {
    const s = createEconomy(SEED, info);
    const report = run(s, info, 30 * MINUTES_PER_DAY).find((e) => e.kind === 'month')!.report!;
    expect(report.counters.revenue).toBeGreaterThan(0);
    expect(report.counters.fee).toBe(franchiseFee(report.counters.revenue));
  });
});

describe('miejsca na palety', () => {
  it('nie nachodzą na siebie, a palety w sali nie odcinają mebli ani kolejki', () => {
    for (const seed of ['kiełbasa-42', 'kiełbasa-12', 'traszka-1', 'a', 'b']) {
      const layout = generateStore(seed);
      const inf = computeStoreInfo(layout);
      const cells = Object.values(inf.spots).flat().flatMap((s) => [s.x + s.y * 4096, s.x + 1 + s.y * 4096, s.x + (s.y + 1) * 4096, s.x + 1 + (s.y + 1) * 4096]);
      expect(new Set(cells).size).toBe(cells.length);
      expect(inf.spots.sidewalk.length).toBeGreaterThan(0);
      expect(inf.spots.backroom.length).toBeGreaterThan(0);
      for (const s of inf.spots.floor) {
        for (const c of [{ x: s.x, y: s.y }, { x: s.x + 1, y: s.y + 1 }]) expect(layout.cells[c.y * layout.width + c.x]).toBe('floor');
      }
    }
  });
});

describe('średni klient z katalogu', () => {
  it('marża i obrót na klienta z catalog.ts to dokładnie to, co sprzedaż liczy przy pełnych półkach (bez partnera i kart)', () => {
    const s = createEconomy(SEED, info);
    const served = 10;
    const margin = sell(s, effects(s, info), served, 0);
    expect(margin / served).toBeCloseTo(MARGIN_PER_CUSTOMER, 9);
    expect(s.total.revenue / served).toBeCloseTo(REVENUE_PER_CUSTOMER, 9);
    expect(s.total.missingItems).toBe(0);
  });

  it('skala sklepu (estimatedDailyMargin, cardContext) liczy z tej samej pary, razem ze strefą hot', () => {
    const s = createEconomy(SEED, info);
    const customers = expectedDailyCustomers(s, info);
    expect(estimatedDailyMargin(s, info)).toBeCloseTo(customers * MARGIN_PER_CUSTOMER * effects(s, info).marginMult, 6);
    expect(cardContext(s, info).dailyRevenue).toBeCloseTo(customers * REVENUE_PER_CUSTOMER, 6);
  });
});

describe('nagrody i postęp', () => {
  it('XP z klientów i palet daje kolejne poziomy z nagrodą', () => {
    const s = createEconomy(SEED, info);
    const events = run(s, info, MINUTES_PER_DAY);
    const ups = events.filter((e) => e.kind === 'levelup');
    expect(s.level).toBeGreaterThan(1);
    expect(ups.length).toBe(s.level - 1);
    expect(ups[0]!.level).toBe(2);
  });

  it('combo mnoży stuknięcia', () => {
    const s = createEconomy(SEED, info);
    for (const c of CATS) s.backroom[c] = 0;
    const val = (r: CommandResult): number => (r.ok ? r.value ?? 0 : 0);
    const one = val(tapPallet(s, info, undefined, 1));
    const three = val(tapPallet(s, info, undefined, 3));
    expect(three).toBeCloseTo(one * 3, 5);
    expect(s.total.taps).toBe(2);
  });

  it('złota paleta po rozładunku daje premię i komunikat', () => {
    const s = createEconomy(SEED, info);
    for (const c of CATS) s.backroom[c] = 0;
    const p = s.pallets[0]!;
    p.golden = true;
    const cash = s.cash;
    let text: string | undefined;
    for (let i = 0; i < 200 && s.pallets.some((x) => x.id === p.id); i++) {
      s.tycoon.fatigue.energy = 100;   // siły nie są tu tematem: pula wystarcza na całą paletę
      text = tapPallet(s, info, p.id, 5).text ?? text;
    }
    expect(s.pallets.some((x) => x.id === p.id)).toBe(false);
    expect(text).toMatch(/Złota paleta/);
    expect(s.cash).toBeGreaterThanOrEqual(cash + GOLDEN_PRIZE.min);
  });

  it('punkty partnera z sieci sklepów podnoszą marżę, a sieć daje dochód co dzień', () => {
    const base = createEconomy(SEED, info);
    const partner = createEconomy(SEED, info, { points: 5, networkIncome: 1000, stores: 1 });
    run(base, info, MINUTES_PER_DAY);
    run(partner, info, MINUTES_PER_DAY);
    expect(partner.total.margin).toBeGreaterThan(base.total.margin * 1.2);
    expect(partner.total.other - base.total.other).toBeGreaterThanOrEqual(1000);
  });

  it('poziom odblokowuje sprzęt', () => {
    const s = createEconomy(SEED, info);
    s.cash = 1e6;
    expect(buyEquipment(s, info, 'piec').ok).toBe(false);
    s.level = 4;
    expect(buyEquipment(s, info, 'piec').ok).toBe(true);
    expect(unlocksAt(4)).toContain('Piec do pizzy');
  });
});

describe('zaufanie Centrali przez moduł tycoona', () => {
  /** Dochodzi do pierwszego mandatu (palety pod sklepem, nikt ich nie rozładowuje) i staje zaraz po nim. */
  const untilFine = (s: EconomyState): EconEvent[] => {
    s.staff = 0;            // nikt nie rozładowuje, więc palety zostają na chodniku
    s.order = { auto: false, manual: 0 };
    const events: EconEvent[] = [];
    for (let i = 0; i < 10 * MINUTES_PER_DAY && !events.some((e) => e.kind === 'fine'); i++) stepMinute(s, info, events);
    expect(events.some((e) => e.kind === 'fine')).toBe(true);
    return events;
  };

  it('nowa gra: zaufanie startowe 60 w stanie tycoona, a starego pola trust nie ma', () => {
    const s = createEconomy(SEED, info);
    expect(s.tycoon.trust.value).toBe(TRUST.start);
    expect('trust' in s).toBe(false);
    expect(s.tycoon.staff.profile).toBe('kolejka');
  });

  it('tydzień KPI nowej gry liczy się od liczników sklepu i jego skali', () => {
    const s = createEconomy(SEED, info);
    expect(s.tycoon.kpi.fromDay).toBe(0);
    expect(s.tycoon.kpi.start).toEqual(kpiMetricsOf(s));
    expect(s.tycoon.kpi.target).toBeGreaterThan(0);
  });

  it('kpiMetricsOf: klienci, hot-dogi i odstraszeni z licznika gry, mandaty z fineCount, czystość z sali', () => {
    const s = createEconomy(SEED, info);
    Object.assign(s.total, { customers: 120, hotSold: 31, lost: 7, fineCount: 2, fines: 900 });
    Object.assign(s.tycoon.hall, { totalSum: 5000, totalMinutes: 60 });
    expect(kpiMetricsOf(s)).toEqual({ customers: 120, hotSold: 31, lost: 7, fines: 2, cleanSum: 5000, cleanMinutes: 60 });
  });

  it('kpiScaleOf: oczekiwani klienci i marża dnia sklepu oraz poziom gracza', () => {
    const s = createEconomy(SEED, info);
    s.level = 6;
    expect(kpiScaleOf(s, info)).toEqual({
      dailyCustomers: expectedDailyCustomers(s, info), dailyMargin: estimatedDailyMargin(s, info), level: 6,
    });
  });

  it('mandat obniża zaufanie z przyczyną mandaty', () => {
    const s = createEconomy(SEED, info);
    untilFine(s);
    expect(s.tycoon.trust.month.mandaty).toBe(-1);
    expect(s.tycoon.trust.value).toBe(TRUST.start + TRUST.fine);
    expect(s.total.fineCount).toBe(1);
    expect(s.month.fineCount).toBe(1);
    expect(s.total.fines).toBeGreaterThan(0);
  });

  it('kierowca, który zabrał palety, obniża zaufanie z przyczyną palety', () => {
    const s = createEconomy(SEED, info);
    s.staff = 0;
    s.order = { auto: false, manual: 12 };
    const events = run(s, info, 4 * MINUTES_PER_DAY);
    expect(events.some((e) => e.kind === 'warning' && e.text.includes('zabrał'))).toBe(true);
    expect(s.tycoon.trust.month.palety).toBeLessThan(0);
  });

  it('odesłana paleta: -4 z przyczyną palety', () => {
    const s = createEconomy(SEED, info);
    expect(returnPallet(s, s.pallets[0]!.id).ok).toBe(true);
    expect(s.tycoon.trust.month).toEqual({ palety: TRUST.returnedPallet });
    expect(s.tycoon.trust.value).toBe(TRUST.start + TRUST.returnedPallet);
  });

  it('zmiana progu zaufania daje zdarzenie trust-tier, drobna zmiana w tym samym progu niczego nie dopisuje', () => {
    const s = createEconomy(SEED, info);
    const out: EconEvent[] = [];
    expect(changeTrust(s, 'inne', -40, out)).toBe(-40);
    const tier = trustTier(20);
    expect(out).toEqual([{ kind: 'trust-tier', text: `Zaufanie Centrali: ${tier.label}. ${tier.flavor}` }]);
    expect(changeTrust(s, 'inne', 0.1, out)).toBeCloseTo(0.1, 9);
    expect(out).toHaveLength(1);
    expect(changeTrust(s, 'inne', 0, out)).toBe(0);
    expect(out).toHaveLength(1);
  });

  it('changeTrust bez tablicy zdarzeń też działa, a miękkie granice zostają w addTrust', () => {
    const s = createEconomy(SEED, info);
    s.tycoon.trust.value = 80;
    expect(changeTrust(s, 'kpi', 10)).toBe(5);   // powyżej 75 zysk liczy się w połowie
    expect(s.tycoon.trust.value).toBe(85);
    expect(s.tycoon.trust.month.kpi).toBe(5);
  });

  /** Dochodzi do 22:00 ostatniego dnia września (dzień 29), tuż przed zamknięciem dnia i miesiąca. */
  const toMonthEnd = (s: EconomyState): void => {
    run(s, info, 29 * MINUTES_PER_DAY + 16 * 60);
    expect(dateOfDay(Math.floor(s.minute / MINUTES_PER_DAY)).date).toBe(30);
  };

  it('zaufanie 0 przy zamknięciu miesiąca to koniec gry', () => {
    const s = createEconomy(SEED, info);
    toMonthEnd(s);
    s.cash = 1e6;                    // to nie bankructwo
    s.tycoon.trust.value = 2;
    s.month.fines += 1e6;            // wynik miesiąca ujemny: -8 (w połowie, bo poniżej 30) zbija zaufanie do zera
    const events = run(s, info, 2 * 60);
    expect(s.tycoon.trust.value).toBe(0);
    expect(s.gameOver).toBe(true);
    const over = events.filter((e) => e.kind === 'gameover');
    expect(over).toHaveLength(1);
    expect(over[0]!.text).toBe('Centrala wypowiada umowę franczyzową: zaufanie spadło do zera. Dziękujemy za współpracę.');
    // raport miesiąca wyszedł przed końcem gry, a nowy miesiąc zaczyna się od tej wartości
    expect(events.some((e) => e.kind === 'month')).toBe(true);
    expect(s.tycoon.trust.monthStart).toBe(0);
    expect(s.tycoon.trust.month).toEqual({});
  });

  it('zaufanie 0 w środku miesiąca to tylko ostrzeżenie, a dobry wynik miesiąca ratuje umowę', () => {
    const mid = createEconomy(SEED, info);
    run(mid, info, 3 * MINUTES_PER_DAY);
    mid.tycoon.trust.value = 0;
    run(mid, info, 2 * MINUTES_PER_DAY);
    expect(mid.gameOver).toBe(false);

    const s = createEconomy(SEED, info);
    toMonthEnd(s);
    s.cash = 1e6;
    s.tycoon.trust.value = 2;
    s.month.margin += 1e6;           // wynik miesiąca dodatni: +5 podnosi zaufanie
    const events = run(s, info, 2 * 60);
    expect(s.gameOver).toBe(false);
    expect(s.tycoon.trust.value).toBe(7);
    expect(events.some((e) => e.kind === 'gameover')).toBe(false);
  });

  it('bankructwo i wypowiedzenie umowy naraz: jedno zdarzenie gameover', () => {
    const s = createEconomy(SEED, info);
    toMonthEnd(s);
    s.cash = -1e6;
    s.tycoon.trust.value = 1;
    s.month.fines += 1e6;
    const events = run(s, info, 2 * 60);
    expect(s.gameOver).toBe(true);
    expect(events.filter((e) => e.kind === 'gameover')).toHaveLength(1);
  });

  it('premia od obrotu idzie do licznika bonus według progu zaufania, a wynik miesiąca ją liczy', () => {
    const s = createEconomy(SEED, info);
    toMonthEnd(s);
    s.tycoon.trust.value = 90;       // najwyższy próg premii od obrotu (od 85)
    const before = s.month.bonus;    // premie z KPI tygodnia (niedziele) i ze złotych palet są już w liczniku; liczy się to, co dojdzie przy zamknięciu
    const events = run(s, info, 2 * 60);
    const c = events.find((e) => e.kind === 'month')!.report!.counters;
    expect(c.bonus - before).toBe(Math.round(turnoverBonusShare(90) * c.revenue));
    expect(c.bonus - before).toBeGreaterThan(0);
    const report = events.find((e) => e.kind === 'month')!.report!;
    expect(report.profit).toBeCloseTo(c.margin + c.bonus + c.other - c.wages - c.media - c.fee - c.fines - c.logistics - c.wut, 6);
  });

  it('poniżej 70 premii od obrotu nie ma (dawne „≥ 70 to 1%” zastąpiły progi z tycoona)', () => {
    const s = createEconomy(SEED, info);
    toMonthEnd(s);
    s.tycoon.trust.value = 69;
    const before = s.month.bonus;    // KPI tygodnia dały już premie w tym miesiącu; przy zamknięciu nie dochodzi nic
    const events = run(s, info, 2 * 60);
    expect(events.find((e) => e.kind === 'month')!.report!.counters.bonus).toBe(before);
  });

  it('wynik miesiąca w zaufaniu ląduje w zamkniętym miesiącu (zmiana z przyczyną wynik przed closeTrustMonth)', () => {
    // closeTrustMonth wołany jest po changeTrust('wynik'): po zamknięciu start nowego miesiąca to wartość PO zmianie z wyniku
    const s = createEconomy(SEED, info);
    toMonthEnd(s);
    s.tycoon.trust.value = 60;
    s.tycoon.trust.monthStart = 60;
    s.month.margin += 1e6;
    run(s, info, 2 * 60);
    expect(s.tycoon.trust.monthStart).toBe(65);
  });

  it('licznik fineCount rośnie razem z mandatami i przechodzi przez zapis JSON', () => {
    const s = createEconomy(SEED, info);
    untilFine(s);
    const restored = JSON.parse(JSON.stringify(s)) as EconomyState;
    expect(restored.total.fineCount).toBe(1);
    expect(restored.tycoon.trust.month.mandaty).toBe(-1);
  });
});

describe('WUT, KPI tygodnia zamiast zleceń i raport miesięczny', () => {
  const fmt = (n: number): string => Math.round(n).toLocaleString('pl-PL');
  /** Stoi o 22:00 ostatniego dnia września: za godzinę zamknięcie dnia i miesiąca. */
  const toMonthEnd = (s: EconomyState): void => {
    run(s, info, 29 * MINUTES_PER_DAY + 16 * 60);
    expect(dateOfDay(Math.floor(s.minute / MINUTES_PER_DAY)).date).toBe(30);
  };
  const monthReport = (events: EconEvent[]): MonthReport => events.find((e) => e.kind === 'month')!.report!;
  const weekEvents = (events: EconEvent[]): EconEvent[] => events.filter((e) => e.kind === 'kpi-week');
  /** Stoi o 22:59 pierwszej niedzieli (dzień 5): następna minuta to 23:00, zamknięcie dnia i tygodnia KPI. */
  const toFirstSundayEnd = (s: EconomyState): EconEvent[] => run(s, info, 5 * MINUTES_PER_DAY + (OPEN_TO - OPEN_FROM));

  describe('WUT w sprzedaży', () => {
    /** Ubytki z `n` obsłużonych klientów, w tym `scoShare` przez SCO, przy `cameras` poziomach kamer. */
    const sold = (scoShare: number, cameras: number): { margin: number; revenue: number; wut: EconomyState['tycoon']['wut']['month'] } => {
      const s = createEconomy(SEED, info);
      s.upgrades.kamery = cameras;
      const margin = sell(s, effects(s, info), 40, scoShare);
      return { margin, revenue: s.total.revenue, wut: { ...s.tycoon.wut.month } };
    };

    it('naturalne ubytki idą od każdej sprzedaży: 0,9% obrotu wg przyczyn', () => {
      const { revenue, wut } = sold(0, 0);
      expect(revenue).toBeGreaterThan(0);
      expect(wut.termin).toBeCloseTo(revenue * WUT.baseline.termin, 9);
      expect(wut.kradziez).toBeCloseTo(revenue * WUT.baseline.kradziez, 9);
      expect(wut.pomylki).toBeCloseTo(revenue * WUT.baseline.pomylki, 9);
      expect(wut.karty).toBe(0);
    });

    it('SCO dopisuje kradzieże do WUT, kamery mniej: 1000 zł obrotu przez SCO to 40 zł bez kamer i 24 zł z kamerami poziomu 1', () => {
      for (const [cameras, perThousand] of [[0, 40], [1, 24]] as const) {
        const none = sold(0, cameras);
        const sco = sold(1, cameras);
        expect(sco.revenue).toBe(none.revenue);
        expect((sco.wut.kradziez - none.wut.kradziez) / sco.revenue * 1000, `kamery ${cameras}`).toBeCloseTo(perThousand, 9);
        // pozostałe przyczyny się nie ruszają
        expect(sco.wut.termin).toBe(none.wut.termin);
        expect(sco.wut.pomylki).toBe(none.wut.pomylki);
      }
    });

    it('„zapomniane” skany nie obcinają już marży: margin jest taki sam przez SCO i przez kasę', () => {
      expect(sold(1, 0).margin).toBe(sold(0, 0).margin);
      expect(sold(1, 0).margin).toBeGreaterThan(0);
    });

    it('stuknięcie w kasę też liczy naturalne ubytki (bez SCO)', () => {
      const s = createEconomy(SEED, info);
      s.minute = 12 * 60;
      s.queue = 3;
      tapTill(s, info, 1);
      expect(s.tycoon.wut.month.termin).toBeGreaterThan(0);
      expect(s.tycoon.wut.month.kradziez).toBeCloseTo(s.total.revenue * WUT.baseline.kradziez, 9);
    });
  });

  describe('WUT w zamknięciu miesiąca', () => {
    it('WUT ponad próg to pozycja raportu: opłata w liczniku wut, wiersz „wut” w szczegółach, miesiąc WUT wyzerowany', () => {
      const s = createEconomy(SEED, info);
      toMonthEnd(s);
      const manual = 0.05 * s.month.revenue;               // 5% obrotu ręcznie: dużo ponad próg 1,2%
      s.tycoon.wut.month.pomylki += manual;
      const report = monthReport(run(s, info, 2 * 60));
      const line = report.detail!.lines.find((l) => l.key === 'wut')!;
      // naturalne ubytki to 0,9% obrotu, próg 1,2%: opłata to ręczny dopis minus 0,3% obrotu
      expect(report.counters.wut).toBeGreaterThan(0);
      expect(report.counters.wut).toBeCloseTo(manual - 0.003 * report.counters.revenue, 6);
      expect(line.amount).toBe(0 - report.counters.wut);
      expect(s.lastReport!.detail!.lines.map((l) => l.key)).toContain('wut');
      // tożsamość raportu przy WUT > 0: wynik szczegółów = wynik raportu = suma pozycji = wynik w historii
      const detail = report.detail!;
      expect(detail.result).toBeCloseTo(report.profit, 6);
      expect(detail.lines.reduce((n, l) => n + l.amount, 0)).toBeCloseTo(detail.result, 6);
      expect(s.history[s.history.length - 1]!.profit).toBeCloseTo(report.profit, 6);
      // po zamknięciu nowy miesiąc: licznik opłaty i ubytki od zera, a opłata została w sumie gry
      expect(s.month.wut).toBe(0);
      expect(s.tycoon.wut.month).toEqual({ termin: 0, kradziez: 0, pomylki: 0, karty: 0 });
      expect(s.total.wut).toBe(report.counters.wut);
    });

    it('WUT z kart wchodzi do sumy miesiąca i do opłaty (przyczyna „karty”)', () => {
      const s = createEconomy(SEED, info);
      s.tycoon.cards.pending = [];
      const card: CardInstance = {
        seq: s.tycoon.cards.seq++, id: 'fefo', day: 0, showAt: s.minute, params: {}, defaultAnswer: 0,
        answers: [{ delta: { wut: 5000 }, mods: [], risk: null }],
      };
      s.tycoon.cards.pending.push(card);
      expect(answerCard(s, card.seq, 0, []).ok).toBe(true);
      expect(s.tycoon.wut.month.karty).toBe(5000);
      toMonthEnd(s);
      const report = monthReport(run(s, info, 2 * 60));
      // 5000 zł z karty plus naturalne ubytki (0,9% obrotu) minus próg (1,2% obrotu)
      expect(report.counters.wut).toBeCloseTo(5000 - 0.003 * report.counters.revenue, 6);
      expect(s.tycoon.wut.month.karty).toBe(0);
    });

    it('ubytki mieszczące się w progu nie kosztują nic: bierny miesiąc ma opłatę 0, a pozycja „wut” w raporcie jest zerem', () => {
      const s = createEconomy(SEED, info);
      const report = monthReport(run(s, info, 30 * MINUTES_PER_DAY));
      expect(report.counters.wut).toBe(0);
      expect(report.detail!.lines.find((l) => l.key === 'wut')!.amount).toBe(0);
    });
  });

  describe('raport miesięczny', () => {
    it('wynik raportu = suma pozycji = wynik w historii (30 dni biernej gry), z dziewięcioma pozycjami', () => {
      const s = createEconomy(SEED, info);
      const report = monthReport(run(s, info, 30 * MINUTES_PER_DAY));
      const detail = report.detail!;
      expect(detail.lines.map((l) => l.key)).toEqual(REPORT_LINES);
      expect(detail.lines.reduce((n, l) => n + l.amount, 0)).toBeCloseTo(detail.result, 6);
      expect(detail.result).toBeCloseTo(s.history[0]!.profit, 6);
      expect(detail.result).toBeCloseTo(report.profit, 6);
      expect(detail.revenue).toBeCloseTo(s.history[0]!.revenue, 6);
      expect(detail.monthIndex).toBe(0);
      // pozycje z liczników miesiąca
      const c = report.counters;
      const line = (key: string): number => detail.lines.find((l) => l.key === key)!.amount;
      expect(line('marza')).toBe(c.margin);
      expect(line('premie')).toBe(c.bonus);
      expect(line('place')).toBe(0 - c.wages);
      expect(line('oplata')).toBe(0 - c.fee);
      expect(line('logistyka')).toBe(0 - c.logistics);
    });

    it('komentarz to tekst z identyfikatora w raporcie, a szczegóły przeżywają zapis JSON bez zmian', () => {
      const s = createEconomy(SEED, info);
      const report = monthReport(run(s, info, 30 * MINUTES_PER_DAY));
      expect(report.comment).toBe(reportCommentText(report.detail!.commentId));
      expect(report.comment.length).toBeGreaterThan(10);
      expect(s.lastReport).toEqual(report);
      expect(JSON.parse(JSON.stringify(s.lastReport))).toEqual(report);
    });

    it('zaufanie w raporcie: początek, koniec i przyczyny, wynik miesiąca jest wśród nich (closeTrustMonth raz, po „wynik”)', () => {
      const s = createEconomy(SEED, info);
      toMonthEnd(s);
      s.tycoon.trust.value = 60;
      s.tycoon.trust.monthStart = 60;
      s.tycoon.trust.month = {};
      s.month.margin += 1e6;                     // wynik dodatni: +5
      const report = monthReport(run(s, info, 2 * 60));
      expect(report.detail!.trust).toEqual({ start: 60, end: 65, delta: 5, reasons: [['wynik', 5]] });
      // nowy miesiąc zaczyna się od zaufania po zmianie z wyniku
      expect(s.tycoon.trust.monthStart).toBe(65);
      expect(s.tycoon.trust.month).toEqual({});
    });

    it('podsumowania modułów trafiają do raportu raz: ludzie, sala, siły, karty i KPI miesiąca zerują się', () => {
      const s = createEconomy(SEED, info);
      toMonthEnd(s);
      s.tycoon.fatigue.exhaustedDays = 7;
      s.tycoon.cards.month = { answered: 6, defaults: 5, riskHits: 0 };
      const report = monthReport(run(s, info, 2 * 60));
      const d = report.detail!;
      expect(d.cleanlinessAvg).toBeGreaterThan(0);
      expect(d.cleanlinessAvg).toBeLessThanOrEqual(100);
      expect(s.tycoon.hall.monthMinutes).toBe(0);
      expect(s.tycoon.staff.month).toEqual(emptyStaffStats());
      expect(s.tycoon.staff.day).toEqual(emptyStaffStats());      // zamknięcie dnia zerowało statystyki dnia (22:00–23:00 coś w nich zostawiło)
      expect(s.tycoon.fatigue.exhaustedDays).toBe(0);
      expect(s.tycoon.cards.month).toEqual({ answered: 0, defaults: 0, riskHits: 0 });
      // niedziele września: 6, 13, 20 i 27 dnia gry (dni 5, 12, 19, 26) = cztery tygodnie KPI w jednym miesiącu
      expect(d.kpi.hit + d.kpi.miss).toBe(4);
      expect(s.tycoon.kpi.month).toEqual({ hit: 0, miss: 0 });
      expect(HINT_IDS).toContain(d.hint.id);
    });

    it('pozycje zamknięcia miesiąca (opłata, premia od obrotu, WUT) są w miesiącu i sumie gry, ale nie w wyniku następnego dnia', () => {
      const s = createEconomy(SEED, info);
      toMonthEnd(s);
      s.tycoon.trust.value = 90;                                  // najwyższy próg premii od obrotu
      s.tycoon.trust.monthStart = 90;
      s.tycoon.wut.month.pomylki += 0.05 * s.month.revenue;       // dużo ponad próg
      const totalBefore = { ...s.total };
      const report = monthReport(run(s, info, 61));               // 22:00–23:00: zamknięcie dnia i miesiąca
      const c = report.counters;
      const turnoverBonus = Math.round(turnoverBonusShare(90) * c.revenue);
      expect(c.fee).toBeGreaterThan(0);
      expect(c.wut).toBeGreaterThan(0);
      expect(turnoverBonus).toBeGreaterThan(0);
      // suma gry i miesiąc je mają
      expect(s.total.fee - totalBefore.fee).toBe(c.fee);
      expect(s.total.wut - totalBefore.wut).toBeCloseTo(c.wut, 6);
      expect(s.total.bonus - totalBefore.bonus).toBe(turnoverBonus);
      // a dzień, który zaczyna się po zamknięciu, nie
      expect(s.today.fee).toBe(0);
      expect(s.today.wut).toBe(0);
      expect(s.today.bonus).toBe(0);
      // wynik pierwszego dnia nowego miesiąca liczy tylko jego własne pozycje
      const t0 = { ...s.total };
      run(s, info, MINUTES_PER_DAY);                              // do zamknięcia 1 października o 23:00
      const t1 = s.total;
      const ownProfit = t1.margin - t0.margin + t1.bonus - t0.bonus + t1.other - t0.other - (t1.wages - t0.wages)
        - (t1.media - t0.media) - (t1.fines - t0.fines) - (t1.logistics - t0.logistics) - (t1.wut - t0.wut);
      expect(t1.fee).toBe(t0.fee);
      expect(s.lastDayProfit).toBeCloseTo(ownProfit, 6);
      expect(s.bestDayProfit).toBeGreaterThanOrEqual(s.lastDayProfit);
    });

    it('wypowiedzenie umowy po raporcie: raport z zaufaniem na zerze wychodzi przed końcem gry', () => {
      const s = createEconomy(SEED, info);
      toMonthEnd(s);
      s.cash = 1e6;
      s.tycoon.trust.value = 2;
      s.tycoon.trust.monthStart = 2;
      s.month.fines += 1e6;                       // strata: −8 (w połowie poniżej 30) zbija zaufanie do zera
      const events = run(s, info, 2 * 60);
      expect(s.gameOver).toBe(true);
      expect(monthReport(events).detail!.trust).toMatchObject({ start: 2, end: 0, delta: -2 });
    });
  });

  describe('KPI tygodnia', () => {
    it('quests, questSeq i cleanDays zniknęły ze stanu', () => {
      const s = createEconomy(SEED, info);
      run(s, info, 8 * MINUTES_PER_DAY);
      for (const k of ['quests', 'questSeq', 'cleanDays']) expect(k in s, k).toBe(false);
      expect(JSON.stringify(s)).not.toMatch(/quest|cleanDays/);
    });

    it('tydzień zamyka się w niedzielę o 23:00: zdarzenie, zaufanie z przyczyną kpi, premia i XP przy trafieniu', () => {
      const s = createEconomy(SEED, info);
      expect(s.tycoon.kpi.toDay).toBe(5);
      expect(isSunday(5)).toBe(true);
      Object.assign(s.tycoon.kpi, { kind: 'klienci', target: 1 });   // trafione od pierwszego klienta
      const early = toFirstSundayEnd(s);
      expect(weekEvents(early)).toEqual([]);                 // ani poniedziałek–sobota, ani niedziela przed 23:00
      expect(s.minute % MINUTES_PER_DAY).toBe(OPEN_TO);
      expect(s.tycoon.trust.month.kpi).toBeUndefined();
      s.level = 20;
      s.xp = 0;
      const bonusBefore = s.month.bonus;
      const expectedBonus = roundNice(0.3 * kpiScaleOf(s, info).dailyMargin);

      const events = run(s, info, 1);
      const week = weekEvents(events);
      expect(week).toHaveLength(1);
      expect(week[0]!.text).toContain(kpiTitle('klienci', 1, fmt));
      expect(week[0]!.text).toContain('trafione');
      expect(s.tycoon.trust.month.kpi).toBe(3);
      expect(s.month.bonus - bonusBefore).toBe(expectedBonus);
      expect(expectedBonus).toBeGreaterThan(0);
      expect(s.xp).toBe(40 + 10 * 20);
      expect(s.tycoon.kpi.month).toEqual({ hit: 1, miss: 0 });
    });

    it('nietrafiony KPI odbiera zaufanie i nie daje premii ani XP', () => {
      const s = createEconomy(SEED, info);
      Object.assign(s.tycoon.kpi, { kind: 'klienci', target: 1e9 });
      toFirstSundayEnd(s);
      s.level = 20;
      s.xp = 0;
      const bonusBefore = s.month.bonus;
      const events = run(s, info, 1);
      expect(weekEvents(events)).toHaveLength(1);
      expect(weekEvents(events)[0]!.text).toContain('nietrafione');
      expect(s.tycoon.trust.month.kpi).toBe(-2);
      expect(s.month.bonus).toBe(bonusBefore);
      expect(s.xp).toBe(0);
      expect(s.tycoon.kpi.month).toEqual({ hit: 0, miss: 1 });
    });

    it('tekst zdarzenia niesie zaufanie naliczone po miękkich granicach: połowa od 75, nic przy 100, połowa strat do 30', () => {
      /** Zmiana zaufania z ostatniego zdania tekstu KPI tygodnia (trafiony: „…, zaufanie Centrali +3.”, nietrafiony: „Zaufanie Centrali −2.”). */
      const shown = (target: number, trust: number): string => {
        const s = createEconomy(SEED, info);
        Object.assign(s.tycoon.kpi, { kind: 'klienci', target });
        toFirstSundayEnd(s);
        s.tycoon.trust.value = trust;
        s.tycoon.trust.monthStart = trust;
        s.tycoon.trust.month = {};
        const week = weekEvents(run(s, info, 1));
        expect(week).toHaveLength(1);
        return /aufanie Centrali (.+)\.$/.exec(week[0]!.text)![1]!;
      };
      expect(shown(1, 60)).toBe('+3');             // trafiony, poniżej progu: pełne +3
      expect(shown(1, 80)).toBe('+1,5');           // od 75 zyski liczą się w połowie
      expect(shown(1, 100)).toBe('bez zmian');     // na 100 nie ma co dodać
      expect(shown(1e9, 60)).toBe('−2');           // nietrafiony: pełne −2
      expect(shown(1e9, 20)).toBe('−1');           // poniżej 30 straty liczą się w połowie
      expect(shown(1e9, 0)).toBe('bez zmian');     // na zerze nie ma co zabrać
    });

    it('zmiana progu zaufania po KPI daje zdarzenie trust-tier', () => {
      const s = createEconomy(SEED, info);
      Object.assign(s.tycoon.kpi, { kind: 'klienci', target: 1 });
      toFirstSundayEnd(s);
      s.tycoon.trust.value = 59;                     // „Pod obserwacją”; +3 przenosi do „W porządku”
      const events = run(s, info, 1);
      expect(events.some((e) => e.kind === 'trust-tier')).toBe(true);
    });

    it('po zamknięciu zaczyna się następny tydzień do kolejnej niedzieli, a zamknięcie dzieje się raz na tydzień', () => {
      const s = createEconomy(SEED, info);
      const events = run(s, info, 20 * MINUTES_PER_DAY);      // niedziele: dni 5, 12 i 19
      expect(weekEvents(events)).toHaveLength(3);
      expect(s.tycoon.kpi.seq).toBe(4);                      // tydzień 1 + trzy zamknięcia, bez drugiego wywołania
      expect(s.tycoon.kpi.fromDay).toBe(20);
      expect(s.tycoon.kpi.toDay).toBe(26);
      expect(s.tycoon.kpi.month.hit + s.tycoon.kpi.month.miss).toBe(3);
    });

    it('cel tygodnia liczy niedzielny ruch (×1,35), a expectedDailyCustomers go nie zawiera', () => {
      const s = createEconomy(SEED, info);
      const scale = kpiScaleOf(s, info);
      expect(scale.dailyCustomers).toBe(expectedDailyCustomers(s, info));
      let seq = 1;
      while (newKpiWeek(s.seedHash, seq, 0, kpiMetricsOf(s), scale).kind !== 'klienci') seq++;
      const week = newKpiWeek(s.seedHash, seq, 0, kpiMetricsOf(s), scale);
      const days = week.toDay - week.fromDay + 1;
      expect(days).toBe(6);                                    // wtorek–niedziela
      expect(week.target).toBe(Math.max(10, roundNice(1.08 * scale.dailyCustomers * (days - 1 + SUNDAY_TRAFFIC))));
      expect(week.target).toBeGreaterThan(roundNice(1.08 * scale.dailyCustomers * days));
    });

    it('tydzień zamknięty w ostatnim dniu miesiąca (niedziela 31 stycznia) liczy się do raportu tego miesiąca', () => {
      const s = createEconomy(SEED, info);
      const sunday = 152;                                      // 31 stycznia 2027
      expect(isSunday(sunday)).toBe(true);
      expect(dateOfGameDay(sunday + 1).month).toBe(1);
      s.minute = sunday * MINUTES_PER_DAY + 22 * 60;
      Object.assign(s.tycoon.kpi, { kind: 'klienci', target: 1, fromDay: sunday - 6, toDay: sunday, seq: 20 });
      s.tycoon.kpi.start = { ...kpiMetricsOf(s), customers: s.total.customers - 5 };
      const events = run(s, info, 2 * 60);
      expect(weekEvents(events)).toHaveLength(1);
      expect(monthReport(events).detail!.kpi).toEqual({ hit: 1, miss: 0 });
      expect(s.tycoon.kpi.month).toEqual({ hit: 0, miss: 0 });
      expect(s.tycoon.kpi.fromDay).toBe(sunday + 1);
    });
  });

  describe('premia ze złotej palety', () => {
    it('złota paleta idzie do licznika premii Centrali, a nie do innych przychodów', () => {
      const s = createEconomy(SEED, info);
      for (const c of CATS) s.backroom[c] = 0;
      const p = s.pallets[0]!;
      p.golden = true;
      const other = s.total.other;
      for (let i = 0; i < 200 && s.pallets.some((x) => x.id === p.id); i++) {
        s.tycoon.fatigue.energy = 100;
        tapPallet(s, info, p.id, 5);
      }
      expect(s.pallets.some((x) => x.id === p.id)).toBe(false);
      expect(s.total.bonus).toBeGreaterThanOrEqual(GOLDEN_PRIZE.min);
      expect(s.month.bonus).toBe(s.total.bonus);
      expect(s.total.other).toBe(other);
    });
  });

  describe('godziny pracy w statystykach ludzi', () => {
    it('noc z paletami do rozładunku nie dolicza czekania ani niedoborów rąk: statystyki liczą tylko minuty zmiany', () => {
      const s = createEconomy(SEED, info);
      s.minute = 23 * 60 + 1;
      s.staff = 2;
      expect(s.pallets.length).toBeGreaterThan(0);                 // paleta czeka na rozładunek całą noc
      run(s, info, 7 * 60 - 1);                                     // do 6:00
      expect(s.minute % MINUTES_PER_DAY).toBe(OPEN_FROM);
      const day = s.tycoon.staff.day;
      expect(day.starved).toEqual({ kasa: 0, rozladunek: 0, wykladanie: 0, sprzatanie: 0 });
      expect(day.waiting.rozladunek).toBe(0);
      expect(s.tycoon.staff.month.starved.rozladunek).toBe(0);
      // od 6:00 ludzie pracują i statystyki ruszają
      run(s, info, 60);
      expect(s.tycoon.staff.day.worked.rozladunek + s.tycoon.staff.day.worked.kasa + s.tycoon.staff.day.worked.wykladanie).toBeGreaterThan(0);
    });

    it('taśmociąg pracuje nocą mimo braku statystyk, a w godzinach pracy bez ludzi niedobór rąk się liczy', () => {
      const night = createEconomy(SEED, info);
      night.minute = 2 * 60;
      night.upgrades.tasmociag = 1;
      const before = night.pallets.reduce((n, p) => n + p.total, 0);
      run(night, info, 30);
      expect(night.pallets.reduce((n, p) => n + p.total, 0)).toBeLessThan(before);

      const empty = createEconomy(SEED, info);
      empty.staff = 0;                                              // w godzinach pracy nikogo: paleta czeka naprawdę
      empty.order = { auto: false, manual: 0 };
      run(empty, info, 30);
      expect(empty.tycoon.staff.day.starved.rozladunek).toBeGreaterThan(0);
    });
  });
});

describe('śmieci z palet, czystość sali, pogoda, niedziela i prasa', () => {
  const emptyItems = () => Object.fromEntries(CATS.map((c) => [c, 0])) as Record<(typeof CATS)[number], number>;
  const NOON = 12 * 60;

  /** Sklep bez palet, dostaw i zamówień, o danej minucie dnia (kolejne dni od `day`). */
  const quiet = (day = 1, mod = NOON): EconomyState => {
    const s = createEconomy(SEED, info);
    s.pallets = [];
    s.order = { auto: false, manual: 0 };
    s.minute = day * MINUTES_PER_DAY + mod;
    return s;
  };

  /** Paleta z `total` sztuk napojów (nic poza tym), do ręcznego ustawienia na miejscu. */
  const drinkPallet = (id: number, loc: 'sidewalk' | 'floor' | 'backroom', spot: number, total: number, bags?: number) => ({
    id, loc, spot, items: { ...emptyItems(), napoje: total }, total, initial: total, since: 0, ...(bags === undefined ? {} : { bags }),
  });

  /** Półki i zaplecze pełne wszystkiego poza napojami: najbliższa dostawa to prawie same napoje. */
  const drinksSoldOut = (s: EconomyState): void => {
    const backroomCap = effects(s, info).backroomCap;
    for (const c of CATS) {
      s.shelf[c] = c === 'napoje' ? 0 : info.shelfCap[c];
      s.backroom[c] = c === 'napoje' ? 0 : 0.6 * backroomCap * CAT_INFO[c].basket;
    }
  };

  it('dostawa: paleta niesie worki liczone z jej składu, a zwykła ma jeden', () => {
    const s = createEconomy(SEED, info);
    expect(s.pallets.length).toBeGreaterThan(0);
    for (const p of s.pallets) expect(p.bags).toBe(palletBags(p.items));
    expect(s.pallets[0]!.bags).toBe(1);

    const t = quiet(1, 6 * 60);
    drinksSoldOut(t);
    t.deliveries = [{ at: t.minute, count: 1 }];
    stepMinute(t, info, []);
    expect(t.pallets).toHaveLength(1);
    expect(palletBags(t.pallets[0]!.items)).toBe(2);   // zgrzewki w folii: ponad 40% to napoje
    expect(t.pallets[0]!.bags).toBe(2);
  });

  it('rozładowana paleta zostawia worki: ponad 40% napojów to dwa, zwykła jeden', () => {
    const bagsAfterDelivery = (soldOut: boolean): number => {
      const s = quiet(1, 6 * 60);
      s.staff = 0;                   // nikt nie wynosi worków
      s.upgrades.tasmociag = 3;      // paletę rozładuje automatyka, także bez ludzi
      if (soldOut) drinksSoldOut(s);
      s.deliveries = [{ at: s.minute, count: 1 }];
      for (let i = 0; i < 600 && (i === 0 || s.pallets.length > 0); i++) stepMinute(s, info, []);
      expect(s.pallets).toHaveLength(0);
      expect(s.tycoon.waste.hall).toBe(0);
      return s.tycoon.waste.backroom;
    };
    expect(bagsAfterDelivery(true)).toBe(2);
    expect(bagsAfterDelivery(false)).toBe(1);
  });

  it('paleta ze starego zapisu (bez pola bags) zostawia jeden worek', () => {
    const s = quiet(1, 8 * 60);
    setStaffProfile(s.tycoon.staff, 'dostawa');   // ludzie najpierw przy paletach
    s.pallets = [drinkPallet(900, 'sidewalk', 0, 5)];
    expect(s.pallets[0]!.bags).toBeUndefined();
    stepMinute(s, info, []);
    expect(s.pallets).toHaveLength(0);
    expect(s.tycoon.waste.month.produced).toBe(1);
  });

  it('worki zajmują miejsca palet na zapleczu: cztery worki to jedno miejsce mniej', () => {
    const s = quiet();
    const free = freeSpots(s, info, 'backroom');
    expect(free).toBeGreaterThanOrEqual(2);
    s.tycoon.waste.backroom = 4;
    expect(freeSpots(s, info, 'backroom')).toBe(free - 1);
    s.tycoon.waste.backroom = 5;   // piąty worek zaczyna kolejne miejsce
    expect(freeSpots(s, info, 'backroom')).toBe(free - 2);
    expect(freeSpots(s, info, 'sidewalk')).toBe(info.spots.sidewalk.length);   // chodnik i sala bez zmian
  });

  it('worki blokują też przestawienie palety na zaplecze, a sama paleta zmieści się, gdy worków nie ma', () => {
    const s = quiet();
    const spots = effects(s, info).backroomSpots;
    s.pallets = [drinkPallet(900, 'backroom', 0, 100)];
    s.nextPalletId = 901;
    for (let i = 1; i < spots - 1; i++) s.pallets.push(drinkPallet(900 + i, 'backroom', i, 100));
    s.pallets.push(drinkPallet(990, 'sidewalk', 0, 100));   // ta chce na zaplecze: zostaje jedno wolne miejsce
    s.tycoon.waste.backroom = 4;
    const r = movePallet(s, info, 990, 'backroom');
    expect(r.ok).toBe(false);
    s.tycoon.waste.backroom = 0;
    expect(movePallet(s, info, 990, 'backroom').ok).toBe(true);
  });

  it('pełne zaplecze wyrzuca worki do sali i skraca cierpliwość', () => {
    // zaplecze zajęte paletami: worki z nowo rozładowanej palety trafiają do sali
    const s = quiet(1, 8 * 60);
    setStaffProfile(s.tycoon.staff, 'dostawa');
    const spots = effects(s, info).backroomSpots;
    s.pallets = Array.from({ length: spots }, (_, i) => drinkPallet(900 + i, 'backroom', i, 200));
    s.pallets.push(drinkPallet(990, 'sidewalk', 0, 5, 2));
    s.nextPalletId = 1000;
    stepMinute(s, info, []);
    expect(s.pallets.some((p) => p.id === 990)).toBe(false);   // rozładowana
    expect(s.tycoon.waste.hall).toBe(2);
    expect(s.tycoon.waste.backroom).toBe(0);

    // worki w sali liczą się jak palety w sali: kolejka tej samej długości już zniechęca klientów
    const lostWith = (hallBags: number): number => {
      const c = quiet();
      c.arrivalAcc = 0.99;   // pewne przyjście w tej minucie
      c.tycoon.waste.hall = hallBags;
      c.queue = effects(c, info).patience - 0.5;
      stepMinute(c, info, []);
      return c.total.lost;
    };
    expect(hallObstacle({ ...s.tycoon.waste, hall: 4 })).toBe(1);
    expect(lostWith(0)).toBe(0);
    expect(lostWith(4)).toBeGreaterThan(0);
  });

  it('worki w sali zmniejszają też ruch, jak palety w sali (nie mniej niż połowa)', () => {
    const s = quiet();
    const base = arrivalRate(s, info);
    s.tycoon.waste.hall = 8;   // dwa „miejsca” przeszkody
    expect(arrivalRate(s, info)).toBeCloseTo(base * (1 - 0.08 * 2), 9);
    s.tycoon.waste.hall = 1000;
    expect(arrivalRate(s, info)).toBeCloseTo(base * 0.5, 9);
  });

  it('brudna sala skraca cierpliwość: ta sama kolejka zniechęca klientów dopiero przy niskiej czystości', () => {
    const lostAt = (cleanliness: number): number => {
      const c = quiet();
      c.arrivalAcc = 0.99;
      c.tycoon.hall.cleanliness = cleanliness;
      c.queue = effects(c, info).patience - 1.5;   // czystość 20 to −2 do cierpliwości, 60 i więcej to 0
      stepMinute(c, info, []);
      return c.total.lost;
    };
    expect(lostAt(100)).toBe(0);
    expect(lostAt(60)).toBe(0);
    expect(lostAt(20)).toBeGreaterThan(0);
  });

  it('sprzątanie najpierw wynosi worki, i to z sali', () => {
    const s = quiet(1, 8 * 60);
    s.staff = 2;
    setStaffProfile(s.tycoon.staff, 'porzadek');
    s.tycoon.waste.hall = 2;
    s.tycoon.waste.backroom = 6;
    run(s, info, 30);
    const w = s.tycoon.waste;
    expect(w.hall).toBe(0);
    expect(w.backroom).toBeLessThan(6);
    expect(w.hall + w.backroom).toBeLessThan(8);
    expect(w.month.removed).toBeGreaterThan(2);
  });

  it('prasa do kartonów skraca wynoszenie worka z pięciu osobominut do dwóch', () => {
    const removed = (press: boolean): number => {
      const s = quiet(1, 8 * 60);
      s.staff = 1;
      s.upgrades.prasa = press ? 1 : 0;
      setStaffProfile(s.tycoon.staff, 'porzadek');
      s.tycoon.waste.backroom = 10;
      run(s, info, 10);
      return 10 - s.tycoon.waste.backroom;
    };
    expect(removed(false)).toBeCloseTo(2, 9);   // 10 osobominut / 5
    expect(removed(true)).toBeCloseTo(5, 9);    // 10 osobominut / 2
    const s = quiet();
    s.upgrades.prasa = 1;
    expect(robotFleet(s).prasa).toBe(1);
  });

  it('prasa to ulepszenie warsztatu za 6000 zł, jeden poziom', () => {
    const def = UPGRADE_BY_ID.prasa;
    expect(def.group).toBe('warsztat');
    expect(def.names).toEqual(['Prasa do kartonów z imadła po dziadku']);
    expect(def.maxLevel).toBe(1);
    expect(def.baseCost).toBe(6000);
    expect(def.costMult).toBe(1);
    const s = quiet();
    s.cash = 100_000;
    expect(buyUpgrade(s, 'prasa').ok).toBe(false);   // warsztat zamknięty na starcie
    s.level = 10;
    expect(buyUpgrade(s, 'prasa').ok).toBe(true);
    expect(s.cash).toBe(100_000 - 6000);
    expect(buyUpgrade(s, 'prasa').ok).toBe(false);   // maksymalny poziom
  });

  it('niedziela ma więcej klientów: arrivalRate o 12:00 to ×1,35 soboty przy tym samym stanie', () => {
    let saturday = 0;
    while (dateOfGameDay(saturday).date > 0 && (saturday + 2) % 7 !== 6) saturday++;
    expect(isSunday(saturday + 1)).toBe(true);
    const base = createEconomy(SEED, info);
    const at = (day: number): number => arrivalRate({ ...base, minute: day * MINUTES_PER_DAY + NOON }, info);
    expect(at(saturday)).toBeGreaterThan(0);
    expect(at(saturday + 1)).toBeCloseTo(1.35 * at(saturday), 9);
    expect(at(saturday - 1)).toBeCloseTo(at(saturday), 9);   // piątek jak sobota
  });

  it('stepMinute losuje przyjścia z arrivalRate (niedziela też): ułamek przyjść po minucie zgadza się z lambdą', () => {
    for (const day of [4, 5]) {   // sobota i niedziela
      const s = quiet(day);
      s.arrivalAcc = 0;
      const lambda = arrivalRate(s, info);
      const expected = lambda * waveAt(s.seedHash, s.minute) * (0.75 + 0.5 * rand01(s.seedHash, s.minute, 1));
      stepMinute(s, info, []);
      expect(s.arrivalAcc).toBeCloseTo(expected - Math.floor(expected), 9);
    }
  });

  it('fale klientów: w każdym bloku średnia mnożnika to dokładnie 1, fala trwa `length` minut, a bloków z falą jest ok. `chance`', () => {
    const { block, length, chance, depth } = WAVES;
    const peak = 1 + depth * (block - length) / length;
    const blocks = 3000;
    let withWave = 0;
    for (let b = 0; b < blocks; b++) {
      const m = (s: number): number => waveAt(1234567, b * block + s);
      const values = Array.from({ length: block }, (_, i) => m(i));
      expect(values.reduce((n, v) => n + v, 0), `blok ${b}`).toBeCloseTo(block, 9);
      const inWave = values.filter((v) => Math.abs(v - peak) < 1e-9).length;
      if (inWave === 0) {
        expect(values.every((v) => v === 1), `blok ${b} bez fali`).toBe(true);
        continue;
      }
      withWave++;
      expect(inWave, `blok ${b}`).toBe(length);
      // fala to jeden ciąg minut, reszta bloku ma mniej klientów
      const first = values.findIndex((v) => Math.abs(v - peak) < 1e-9);
      expect(values.slice(first, first + length).every((v) => Math.abs(v - peak) < 1e-9), `blok ${b}`).toBe(true);
      expect(values.filter((v) => Math.abs(v - (1 - depth)) < 1e-9).length, `blok ${b}`).toBe(block - length);
    }
    expect(withWave / blocks).toBeGreaterThan(chance - 0.03);
    expect(withWave / blocks).toBeLessThan(chance + 0.03);
    // bez stanu: ta sama minuta i ten sam seed dają ten sam mnożnik, a inny seed układa fale inaczej
    expect(waveAt(42, 9000)).toBe(waveAt(42, 9000));
    expect(Array.from({ length: 200 }, (_, i) => waveAt(42, i)).join()).not.toBe(Array.from({ length: 200 }, (_, i) => waveAt(43, i)).join());
  });

  it('pogoda losuje się o północy: po przejściu przez 0:00 jest taka, jaką daje rollWeather dla tego dnia', () => {
    const s = createEconomy(SEED, info);
    expect(s.tycoon.hall.weather).toBe(rollWeather(s.seedHash, 0, dateOfGameDay(0).month));
    let changes = 0;
    for (let day = 1; day <= 40; day++) {
      s.minute = day * MINUTES_PER_DAY - 1;
      const before = s.tycoon.hall.weather;
      const wrong = (['sucho', 'upal', 'deszcz', 'snieg'] as const).find((w) => w !== rollWeather(s.seedHash, day, dateOfGameDay(day).month))!;
      s.tycoon.hall.weather = wrong;   // dzień wcześniej coś innego: o północy ma się zmienić
      run(s, info, 2);
      expect(s.tycoon.hall.weather).toBe(rollWeather(s.seedHash, day, dateOfGameDay(day).month));
      if (s.tycoon.hall.weather !== before) changes++;
    }
    expect(changes).toBeGreaterThan(0);
    // w ciągu dnia pogoda nie zmienia się
    const w = s.tycoon.hall.weather;
    run(s, info, 600);
    expect(s.tycoon.hall.weather).toBe(w);
  });

  it('klienci brudzą salę, deszcz bardziej niż sucho, a bez sprzątania czystość tylko spada', () => {
    const cleanlinessAfter = (weather: 'sucho' | 'deszcz'): number => {
      const s = quiet(1, 8 * 60);
      s.staff = 0;
      s.tycoon.hall.weather = weather;
      run(s, info, 4 * 60);
      return s.tycoon.hall.cleanliness;
    };
    const dry = cleanlinessAfter('sucho');
    const rain = cleanlinessAfter('deszcz');
    expect(dry).toBeLessThan(100);
    expect(rain).toBeLessThan(dry);
  });

  it('ludzie sprzątają salę: przy profilu „porządek” czystość wraca do 100', () => {
    const s = quiet(1, 8 * 60);
    s.tycoon.hall.cleanliness = 40;
    setStaffProfile(s.tycoon.staff, 'porzadek');
    run(s, info, 2 * 60);
    expect(s.tycoon.hall.cleanliness).toBeGreaterThan(90);
  });

  it('średnia czystości liczy tylko minuty otwarcia, a koniec miesiąca zeruje jej licznik i worki miesiąca', () => {
    const s = createEconomy(SEED, info);
    run(s, info, MINUTES_PER_DAY);   // od 6:00 do 6:00 następnego dnia
    expect(s.tycoon.hall.monthMinutes).toBe(17 * 60);
    expect(s.tycoon.hall.totalMinutes).toBe(17 * 60);
    expect(s.tycoon.waste.month.produced).toBeGreaterThan(0);
    // dociągamy do zamknięcia ostatniego dnia września (23:00 dnia 29)
    while (!(dateOfGameDay(Math.floor(s.minute / MINUTES_PER_DAY)).date === 30 && s.minute % MINUTES_PER_DAY === 23 * 60 + 1)) stepMinute(s, info, []);
    expect(s.lastReport).not.toBeNull();
    expect(s.tycoon.hall.monthMinutes).toBe(0);
    expect(s.tycoon.hall.monthSum).toBe(0);
    expect(s.tycoon.hall.totalMinutes).toBeGreaterThan(17 * 60);   // średnia „od początku gry” (KPI) zostaje
    expect(s.tycoon.waste.month).toEqual({ produced: 0, removed: 0, hallBagMinutes: 0 });
  });

  it('reputacja za obsłużonego klienta spada o brud w sali: czystość 0 to −0,003 na klienta, od 70 nic', () => {
    const repAfterTaps = (cleanliness: number): number => {
      const s = quiet();
      s.tycoon.hall.cleanliness = cleanliness;
      s.queue = 10;
      const r = tapTill(s, info, 5);
      expect(r.ok).toBe(true);
      return s.reputation;
    };
    const clean = repAfterTaps(100);
    expect(repAfterTaps(70)).toBe(clean);
    expect(repAfterTaps(0)).toBeCloseTo(clean - 5 * 0.003, 9);
  });

  it('relayout z workami na zapleczu: palety i worki razem nie przekraczają miejsc zaplecza', () => {
    const s = quiet();
    const spots = effects(s, info).backroomSpots;
    s.pallets = Array.from({ length: spots }, (_, i) => drinkPallet(900 + i, 'backroom', i, 100));
    s.tycoon.waste.backroom = 4;   // stan sprzed poprawki układu: jedno miejsce jest podwójnie zajęte
    relayout(s, info);
    const inBackroom = s.pallets.filter((p) => p.loc === 'backroom').length;
    expect(s.pallets).toHaveLength(spots);   // żadna paleta nie przepadła
    expect(inBackroom + Math.ceil(s.tycoon.waste.backroom / 4)).toBeLessThanOrEqual(spots);
    expect(s.tycoon.waste.backroom + s.tycoon.waste.hall).toBe(4);   // worki nie przepadły, najwyżej wylądowały w sali
  });

  it('zapis JSON w środku gry z workami wznawia grę bez różnic', () => {
    const s = createEconomy(SEED, info);
    s.upgrades.prasa = 1;
    run(s, info, 3 * MINUTES_PER_DAY);
    expect(s.tycoon.waste.month.produced).toBeGreaterThan(0);
    const restored = JSON.parse(JSON.stringify(s)) as EconomyState;
    run(s, info, 2 * MINUTES_PER_DAY);
    run(restored, info, 2 * MINUTES_PER_DAY);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(s));
  });
});

describe('karty dnia i okólniki', () => {
  /** Karta na biurku od tej minuty: odpowiedzi to same skutki z `deltas` (bez efektów na czas i ryzyka). */
  function plant(s: EconomyState, id: string, deltas: CardDelta[], over: Partial<CardInstance> = {}): CardInstance {
    const card: CardInstance = {
      seq: s.tycoon.cards.seq++, id, day: Math.floor(s.minute / MINUTES_PER_DAY), showAt: s.minute, params: {},
      answers: deltas.map((delta) => ({ delta, mods: [], risk: null })), defaultAnswer: 0, ...over,
    };
    s.tycoon.cards.pending.push(card);
    return card;
  }
  /** Gra bez kart na biurku, żeby liczyły się tylko te wstawione przez test. */
  const quiet = (): EconomyState => {
    const s = createEconomy(SEED, info);
    s.tycoon.cards.pending = [];
    return s;
  };
  const answer = (s: EconomyState, card: CardInstance, n: number, out: EconEvent[] = []): CommandResult => answerCard(s, card.seq, n, out);

  describe('losowanie i stan', () => {
    it('nowa gra losuje karty dnia 0: 1–3 sztuki, wszystkie z godziną w tym dniu, żadna jeszcze nie czeka o 6:00', () => {
      const s = createEconomy(SEED, info);
      const { pending, drawnDay } = s.tycoon.cards;
      expect(drawnDay).toBe(0);
      expect(pending.length).toBeGreaterThanOrEqual(1);
      expect(pending.length).toBeLessThanOrEqual(3);
      for (const c of pending) {
        expect(c.day).toBe(0);
        expect(c.showAt).toBeGreaterThanOrEqual(OPEN_FROM);
        expect(c.showAt).toBeLessThan(MINUTES_PER_DAY);
      }
      expect(awaitingDecision(s)).toBe(pending.some((c) => c.showAt <= s.minute));
    });

    it('o północy losują się karty nowego dnia, raz na dzień, tak samo przy tym samym seedzie', () => {
      const a = createEconomy(SEED, info);
      const b = createEconomy(SEED, info);
      run(a, info, MINUTES_PER_DAY - OPEN_FROM);        // 0:00 dnia 1, przed pierwszą minutą nowego dnia
      expect(a.tycoon.cards.drawnDay).toBe(0);
      run(a, info, 1);                                  // minuta północy losuje karty dnia (jak pogodę)
      expect(a.tycoon.cards.drawnDay).toBe(1);
      const day1 = a.tycoon.cards.pending.filter((c) => c.day === 1);
      expect(day1.length).toBeGreaterThanOrEqual(1);
      for (const c of day1) expect(c.showAt).toBeGreaterThanOrEqual(MINUTES_PER_DAY + OPEN_FROM);
      run(a, info, 100);
      expect(a.tycoon.cards.pending.filter((c) => c.day === 1)).toEqual(day1);   // drugi raz tego samego dnia nie losuje
      run(b, info, MINUTES_PER_DAY - OPEN_FROM + 100);
      expect(JSON.stringify(b.tycoon.cards)).toBe(JSON.stringify(a.tycoon.cards));
    });

    it('stepMinute nie sprawdza karty: minuta mija mimo karty na biurku (pauza to sprawa wołających)', () => {
      const s = quiet();
      plant(s, 'fefo', [{}, {}, {}]);
      expect(awaitingDecision(s)).toBe(true);
      run(s, info, 5);
      expect(s.minute).toBe(OPEN_FROM + 5);
      expect(awaitingDecision(s)).toBe(true);
    });

    it('karta ze showAt w przyszłości nie zatrzymuje, a w showAt zatrzymuje', () => {
      const s = quiet();
      const c = plant(s, 'fefo', [{}, {}, {}], { showAt: s.minute + 3 });
      expect(awaitingDecision(s)).toBe(false);
      run(s, info, 2);
      expect(awaitingDecision(s)).toBe(false);
      const events = run(s, info, 1);
      expect(awaitingDecision(s)).toBe(true);
      expect(events.filter((e) => e.kind === 'card')).toEqual([{ kind: 'card', text: cardDef('fefo')!.title }]);
      expect(visibleCards(s.tycoon.cards, s.minute).map((x) => x.seq)).toEqual([c.seq]);
    });

    it('zdarzenie card jest raz, w minucie showAt, i bez liczb w tekście', () => {
      const s = quiet();
      plant(s, 'glitch', [{}, {}, {}], { showAt: s.minute + 2, params: { p: 30 } });
      const events = run(s, info, 10);
      const cards = events.filter((e) => e.kind === 'card');
      expect(cards).toHaveLength(1);
      expect(cards[0]!.text).toBe(cardDef('glitch')!.title);
      expect(cards[0]!.text).not.toMatch(/\d{2}/);
    });

    it('zapis JSON z kartą na biurku wznawia grę bez różnic', () => {
      const s = createEconomy(SEED, info);
      run(s, info, 2 * MINUTES_PER_DAY);
      const restored = JSON.parse(JSON.stringify(s)) as EconomyState;
      run(s, info, MINUTES_PER_DAY);
      run(restored, info, MINUTES_PER_DAY);
      expect(JSON.stringify(restored)).toBe(JSON.stringify(s));
    });
  });

  describe('cardContext', () => {
    it('dostawa dziś to dostawy w kolejce na ten dzień, palety dziś to ich suma', () => {
      const s = createEconomy(SEED, info);
      s.minute = MINUTES_PER_DAY;   // północ dnia 1 (środa)
      s.deliveries = [{ at: MINUTES_PER_DAY + 360, count: 3 }, { at: MINUTES_PER_DAY + 900, count: 2 }, { at: 2 * MINUTES_PER_DAY + 360, count: 7 }];
      const c = cardContext(s, info);
      expect(c).toMatchObject({
        day: 1, now: MINUTES_PER_DAY, weekday: 3, deliveryToday: true, palletsToday: 5, staff: s.staff, trust: s.tycoon.trust.value,
        cleanliness: s.tycoon.hall.cleanliness, sidewalkPallets: 2, weather: s.tycoon.hall.weather,
      });
      s.deliveries = [{ at: 2 * MINUTES_PER_DAY + 360, count: 7 }];
      expect(cardContext(s, info)).toMatchObject({ deliveryToday: false, palletsToday: 0 });
    });

    it('skala sklepu: marża dnia z estimatedDailyMargin, obrót dnia = oczekiwani klienci × średni obrót na klienta (z hot)', () => {
      const s = createEconomy(SEED, info);
      const perCustomer = CATS.reduce((n, c) => n + CAT_INFO[c].price * CAT_INFO[c].basket, 0) * ITEMS_PER_CUSTOMER + HOT.chance * HOT.price;
      const c = cardContext(s, info);
      expect(c.dailyMargin).toBe(estimatedDailyMargin(s, info));
      expect(c.dailyRevenue).toBeCloseTo(expectedDailyCustomers(s, info) * perCustomer, 6);
      expect(c.dailyRevenue).toBeGreaterThan(c.dailyMargin);
      expect(c.dailyMargin).toBeGreaterThan(0);
    });
  });

  describe('answerCard: skutki trafiają do liczników', () => {
    it('mandat z karty: month.fines, fineCount i gotówka; zła odpowiedź nic nie księguje', () => {
      const s = quiet();
      const card = plant(s, 'fefo', [{ fine: -300 }, {}, {}]);
      const cash = s.cash;
      expect(answer(s, card, 0).ok).toBe(true);
      for (const k of [s.today, s.month, s.total]) {
        expect(k.fines).toBe(300);
        expect(k.fineCount).toBe(1);
      }
      expect(s.cash).toBe(cash - 300);
      expect(s.tycoon.cards.pending).toEqual([]);
    });

    it('premia Centrali z karty idzie do licznika bonus i do gotówki', () => {
      const s = quiet();
      const card = plant(s, 'okolnik-premia', [{ bonus: 500 }, {}]);
      const cash = s.cash;
      answer(s, card, 0);
      for (const k of [s.today, s.month, s.total]) expect(k.bonus).toBe(500);
      expect(s.cash).toBe(cash + 500);
    });

    it('inne przychody i koszty są ze znakiem: koszt z karty zmniejsza other, wpływ go zwiększa', () => {
      const s = quiet();
      const cost = plant(s, 'fefo', [{ cash: -200 }]);
      const cash = s.cash;
      answer(s, cost, 0);
      expect(s.cash).toBe(cash - 200);
      for (const k of [s.today, s.month, s.total]) expect(k.other).toBe(-200);
      const gain = plant(s, 'fefo', [{ cash: 350 }]);
      answer(s, gain, 0);
      expect(s.cash).toBe(cash + 150);
      for (const k of [s.today, s.month, s.total]) expect(k.other).toBe(150);
    });

    it('opłata logistyczna z karty idzie do logistics jako koszt', () => {
      const s = quiet();
      const card = plant(s, 'fefo', [{ logistics: -120 }]);
      const cash = s.cash;
      answer(s, card, 0);
      for (const k of [s.today, s.month, s.total]) expect(k.logistics).toBe(120);
      expect(s.cash).toBe(cash - 120);
    });

    it('reputacja przycięta do 0–100, Ogonki dopisane', () => {
      const s = quiet();
      s.reputation = 98;
      answer(s, plant(s, 'fefo', [{ reputation: 5, ogonki: 3 }]), 0);
      expect(s.reputation).toBe(100);
      expect(s.ogonki).toBe(3);
      s.reputation = 2;
      answer(s, plant(s, 'fefo', [{ reputation: -5 }]), 0);
      expect(s.reputation).toBe(0);
    });

    it('skutki karty tycoona (zaufanie z przyczyną, WUT, siły) idą przez applyCardOutcome', () => {
      const s = quiet();
      const energy = s.tycoon.fatigue.energy;
      answer(s, plant(s, 'fefo', [{ trust: 2, wut: 80, energy: -10 }]), 0);
      expect(s.tycoon.trust.value).toBe(TRUST.start + 2);
      expect(s.tycoon.trust.month.karty).toBe(2);
      expect(s.tycoon.wut.month.karty).toBe(80);
      expect(s.tycoon.fatigue.energy).toBe(energy - 10);
    });

    it('XP za kartę: zdarzenie +10, okólnik +15', () => {
      const s = quiet();
      answer(s, plant(s, 'fefo', [{}]), 0);
      expect(s.xp).toBe(10);
      answer(s, plant(s, 'okolnik-paleta', [{}]), 0);
      expect(s.xp).toBe(25);
    });

    it('zmiana progu zaufania daje trust-tier, drobna zmiana w progu nie', () => {
      const s = quiet();
      const out: EconEvent[] = [];
      answer(s, plant(s, 'fefo', [{ trust: 1 }]), 0, out);   // 60 → 61: nadal próg „W porządku”
      expect(out.filter((e) => e.kind === 'trust-tier')).toEqual([]);
      answer(s, plant(s, 'fefo', [{ trust: -10 }]), 0, out);
      const tier = trustTier(s.tycoon.trust.value);
      expect(tier.id).not.toBe(trustTier(TRUST.start).id);
      expect(out.filter((e) => e.kind === 'trust-tier')).toEqual([{ kind: 'trust-tier', text: `Zaufanie Centrali: ${tier.label}. ${tier.flavor}` }]);
    });

    it('wynik karty: zdarzenie card-result z komentarzem odpowiedzi; liczby formatuje polskie fmt, pusty komentarz nie daje zdarzenia', () => {
      const s = quiet();
      const out: EconEvent[] = [];
      const fefo = plant(s, 'fefo', [{}, {}, {}], { params: { n: 12, v: 1234 } });
      answer(s, fefo, 1, out);
      expect(out).toEqual([{ kind: 'card-result', text: cardDef('fefo')!.answers[1]!.result }]);

      // komentarz z liczbą: {v} przechodzi przez polskie formatowanie (tak jak liczby w reszcie zdarzeń)
      const def = cardDef('fefo')!;
      const original = def.answers[0]!.result;
      def.answers[0]!.result = 'Zapłacono {v} zł.';
      try {
        const out2: EconEvent[] = [];
        answer(s, plant(s, 'fefo', [{}, {}, {}], { params: { v: 1234567 } }), 0, out2);
        expect(out2).toEqual([{ kind: 'card-result', text: `Zapłacono ${(1234567).toLocaleString('pl-PL')} zł.` }]);
      } finally {
        def.answers[0]!.result = original;
      }

      const out3: EconEvent[] = [];
      answer(s, plant(s, 'nieznana-karta', [{ cash: 5 }]), 0, out3);   // karta z nowszej wersji bez definicji: bez komentarza
      expect(out3).toEqual([]);
    });

    it('ryzyko odpowiedzi spełnia się albo nie: skutek ryzyka dochodzi do skutku odpowiedzi, a komentarz jest z ryzyka', () => {
      const s = quiet();
      const card = plant(s, 'fefo', [{}, {}, {}]);
      card.answers[2] = { delta: {}, mods: [], risk: { chance: 1, delta: { fine: -500 } } };   // pewne
      const out: EconEvent[] = [];
      answer(s, card, 2, out);
      expect(s.month.fines).toBe(500);
      expect(out[0]).toEqual({ kind: 'card-result', text: cardDef('fefo')!.answers[2]!.risk!.text });
    });

    it('efekt na czas z odpowiedzi trafia do aktywnych i działa od chwili odpowiedzi', () => {
      const s = quiet();
      const card = plant(s, 'glitch', [{}]);
      card.answers[0]!.mods = [{ kind: 'closed', value: 1, minutes: 60, from: null, estimate: 0 }];
      answer(s, card, 0);
      expect(s.tycoon.cards.active).toEqual([{ kind: 'closed', value: 1, from: s.minute, until: s.minute + 60, seq: card.seq }]);
    });
  });

  describe('odrzucone odpowiedzi nie zmieniają stanu', () => {
    const refused = (s: EconomyState, seq: number, n: number): void => {
      const before = JSON.stringify(s);
      const out: EconEvent[] = [];
      const r = answerCard(s, seq, n, out);
      expect(r.ok, `seq ${seq}, odpowiedź ${n}`).toBe(false);
      expect(JSON.stringify(s)).toBe(before);
      expect(out).toEqual([]);
    };

    it('nieznany seq i odpowiedź poza zakresem (ujemna, za duża, ułamek, NaN)', () => {
      const s = quiet();
      const card = plant(s, 'fefo', [{ cash: -10 }, { cash: -20 }, { cash: -30 }]);
      refused(s, 9999, 0);
      refused(s, card.seq, -1);
      refused(s, card.seq, 3);
      refused(s, card.seq, 1.5);
      refused(s, card.seq, Number.NaN);
      expect(answer(s, card, 2).ok).toBe(true);
      refused(s, card.seq, 0);   // karta już rozstrzygnięta
    });

    it('karta, której godzina jeszcze nie nadeszła, nie przyjmuje odpowiedzi', () => {
      const s = quiet();
      const card = plant(s, 'fefo', [{}, {}, {}], { showAt: s.minute + 1 });
      refused(s, card.seq, 0);
    });
  });

  describe('efekty kart w symulacji', () => {
    const effect = (s: EconomyState, kind: 'traffic' | 'margin' | 'closed' | 'staff', value: number, minutes = 600): void => {
      s.tycoon.cards.active.push({ kind, value, from: s.minute, until: s.minute + minutes, seq: 1 });
    };

    it('ruch karty mnoży przyjścia w arrivalRate (jedynym miejscu lambdy), −100% daje zero', () => {
      const s = quiet();
      s.minute = 12 * 60;
      const base = arrivalRate(s, info);
      effect(s, 'traffic', 0.5);
      expect(arrivalRate(s, info)).toBeCloseTo(1.5 * base, 9);
      s.tycoon.cards.active = [];
      effect(s, 'traffic', -1);
      expect(arrivalRate(s, info)).toBe(0);
    });

    it('ruch karty działa tylko w jej oknie czasu', () => {
      const s = quiet();
      s.minute = 12 * 60;
      const base = arrivalRate(s, info);
      s.tycoon.cards.active.push({ kind: 'traffic', value: 1, from: s.minute + 10, until: s.minute + 20, seq: 1 });
      expect(arrivalRate(s, info)).toBe(base);
      s.minute += 10;
      expect(arrivalRate(s, info)).toBeCloseTo(2 * base, 9);   // ta sama godzina, więc krzywa ruchu się nie zmienia
      s.minute += 10;
      expect(arrivalRate(s, info)).toBe(base);
    });

    it('stepMinute losuje przyjścia z uwzględnieniem ruchu karty: −100% to godzina bez klientów', () => {
      const s = quiet();
      s.minute = 12 * 60;
      effect(s, 'traffic', -1, 60);
      run(s, info, 60);
      expect(s.total.customers).toBe(0);
      expect(s.total.lost).toBe(0);
      run(s, info, 120);
      expect(s.total.customers).toBeGreaterThan(0);
    });

    it('marża karty mnoży marżę sprzedaży, także ze stuknięcia w kasę', () => {
      const margin = (mult: number | null): number => {
        const s = quiet();
        s.queue = 3;
        if (mult !== null) effect(s, 'margin', mult);
        const r = tapTill(s, info);
        expect(r.ok).toBe(true);
        return (r as { value: number }).value;
      };
      const plain = margin(null);
      expect(margin(0.5)).toBeCloseTo(1.5 * plain, 9);
      expect(margin(-0.5)).toBeCloseTo(0.5 * plain, 9);
    });

    it('sklep zamknięty kartą: nikt nie przychodzi, kolejka znika, stuknięcie w kasę odmawia; po efekcie sklep wraca', () => {
      const s = quiet();
      s.minute = 12 * 60;
      s.queue = 4;
      effect(s, 'closed', 1, 60);
      expect(isOpenForCustomers(s)).toBe(false);
      s.queue = 4;
      expect(tapTill(s, info)).toEqual({ ok: false, text: 'Sklep zamknięty.' });
      run(s, info, 60);
      expect(s.total.customers).toBe(0);
      expect(s.queue).toBe(0);
      expect(isOpenForCustomers(s)).toBe(true);
      run(s, info, 30);
      expect(s.total.customers).toBeGreaterThan(0);
    });

    it('sklep zamknięty z innego powodu (noc, remont) dalej jest zamknięty', () => {
      const s = quiet();
      s.minute = 2 * 60;
      expect(isOpenForCustomers(s)).toBe(false);
      s.minute = 12 * 60;
      expect(isOpenForCustomers(s)).toBe(true);
      s.remontUntil = s.minute + 100;
      expect(isOpenForCustomers(s)).toBe(false);
    });

    it('efekty po czasie znikają ze stanu (pruneCardMods co minutę)', () => {
      const s = quiet();
      effect(s, 'margin', 0.2, 5);
      run(s, info, 5);
      expect(s.tycoon.cards.active).toHaveLength(1);
      run(s, info, 1);
      expect(s.tycoon.cards.active).toEqual([]);
    });
  });
});
