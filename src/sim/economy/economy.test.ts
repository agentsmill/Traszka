import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { BANKRUPTCY_AT, CATS, CAT_INFO, MINUTES_PER_DAY, OPEN_FROM, START_CASH, TILL_RATE, UNLOAD_AT, UNLOAD_RATE, WAGE_PER_DAY } from './catalog';
import { dateOfDay, formatDate, isLastDayOfMonth } from './calendar';
import { advanceEconomy } from './clock';
import {
  arrivalRate, buyEquipment, buyUpgrade, changeTrust, claimQuest, createEconomy, effects, estimatedDailyMargin,
  expectedDailyCustomers, fire, freeSpots, kpiMetricsOf, kpiScaleOf, movePallet, relayout, returnPallet, robotFleet, slotFree,
  startRemont, stepMinute, tapPallet, tapTill, unlocksAt, upgradeBlocker, workshopUnlocked, type CommandResult, type EconEvent,
  type EconomyState,
} from './economy';
import { rand01 } from './rand';
import { computeStoreInfo, type StoreInfo } from './storeInfo';
import { rollWeather } from './tycoon/cleanliness';
import { pinStaff, setStaffProfile } from './tycoon/staff';
import { dateOfGameDay, isSunday } from './tycoon/time';
import { TRUST, trustTier } from './tycoon/trust';
import { hallObstacle, palletBags } from './tycoon/waste';
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

  it('zegar: dzień sklepu przy ×1 trwa ok. 51 s, noc ok. 5 s', () => {
    const s = createEconomy(SEED, info);
    const clock = { acc: 0 };
    let minutes = 0;
    for (let t = 0; t < 51; t++) minutes += advanceEconomy(s, info, clock, 1, []);
    expect(Math.abs(minutes - 17 * 60)).toBeLessThanOrEqual(1);   // błąd zaokrągleń sumy ułamków minut
    for (let t = 0; t < 5; t++) minutes += advanceEconomy(s, info, clock, 1, []);
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
    // pola dla interfejsu i adaptera „Ludzie na ekranie” to ten sam przydział
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
    run(s, info, 30 * MINUTES_PER_DAY);
    expect(s.gameOver).toBe(true);
    const restored = JSON.parse(JSON.stringify(s)) as EconomyState;
    expect(restored.gameOver).toBe(true);
    expect(restored.lastReport?.label).toBe('wrzesień 2026');
    expect(restored.lastReport?.cash).toBeLessThan(BANKRUPTCY_AT);
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

describe('nagrody i postęp', () => {
  it('XP z klientów i palet daje kolejne poziomy z nagrodą', () => {
    const s = createEconomy(SEED, info);
    const events = run(s, info, MINUTES_PER_DAY);
    const ups = events.filter((e) => e.kind === 'levelup');
    expect(s.level).toBeGreaterThan(1);
    expect(ups.length).toBe(s.level - 1);
    expect(ups[0]!.level).toBe(2);
  });

  it('trzy zlecenia; wykonane można odebrać, a na ich miejsce przychodzi nowe innego rodzaju', () => {
    const s = createEconomy(SEED, info);
    expect(s.quests).toHaveLength(3);
    expect(new Set(s.quests.map((q) => q.kind)).size).toBe(3);
    const q = s.quests[0]!;
    expect(claimQuest(s, info, q.id).ok).toBe(false);
    // wykonanie: podbijamy licznik zlecenia
    const metric: Record<string, () => void> = {
      serve: () => { s.total.customers += q.target; }, pallets: () => { s.total.palletsUnloaded += q.target; },
      taps: () => { s.total.taps += q.target; }, margin: () => { s.total.margin += q.target; },
      upgrade: () => { s.total.purchases += q.target; }, clean: () => { s.cleanDays += q.target; },
      rep: () => { s.reputation = 100; }, hot: () => { s.total.hotSold += q.target; },
    };
    metric[q.kind]!();
    const cash = s.cash;
    const r = claimQuest(s, info, q.id);
    expect(r.ok).toBe(true);
    expect(s.cash).toBe(cash + q.reward.cash);
    expect(s.quests).toHaveLength(3);
    expect(s.quests.some((x) => x.id === q.id)).toBe(false);
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
    expect(s.cash).toBeGreaterThan(cash + 300);
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
    s.tycoon.trust.value = 90;       // próg ulubieńca: 1,5% obrotu
    const events = run(s, info, 2 * 60);
    const c = events.find((e) => e.kind === 'month')!.report!.counters;
    expect(c.bonus).toBe(Math.round(0.015 * c.revenue));
    expect(c.bonus).toBeGreaterThan(0);
    const report = events.find((e) => e.kind === 'month')!.report!;
    expect(report.profit).toBeCloseTo(c.margin + c.bonus + c.other - c.wages - c.media - c.fee - c.fines - c.logistics - c.wut, 6);
  });

  it('poniżej 70 premii od obrotu nie ma (dawne „≥ 70 to 1%” zastąpiły progi z tycoona)', () => {
    const s = createEconomy(SEED, info);
    toMonthEnd(s);
    s.tycoon.trust.value = 69;
    const events = run(s, info, 2 * 60);
    expect(events.find((e) => e.kind === 'month')!.report!.counters.bonus).toBe(0);
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
      const expected = lambda * (0.75 + 0.5 * rand01(s.seedHash, s.minute, 1));
      stepMinute(s, info, []);
      expect(s.arrivalAcc).toBeCloseTo(expected - Math.floor(expected), 9);
    }
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
