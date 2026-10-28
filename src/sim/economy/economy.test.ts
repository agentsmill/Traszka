import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { CATS, MINUTES_PER_DAY, OPEN_FROM, START_CASH, WAGE_PER_DAY } from './catalog';
import { dateOfDay, formatDate, isLastDayOfMonth } from './calendar';
import { advanceEconomy } from './clock';
import {
  buyEquipment, buyUpgrade, createEconomy, effects, movePallet, relayout, slotFree, startRemont, stepMinute, tapPallet,
  tapTill, upgradeBlocker, workshopUnlocked, type EconEvent, type EconomyState,
} from './economy';
import { computeStoreInfo, type StoreInfo } from './storeInfo';
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
      s.staff = 1;            // nikt nie rozładowuje: jedyna osoba stoi na kasie
      s.priority = 'klienci';
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
    s.staff = 1;
    s.priority = 'klienci';
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
    expect(upgradeBlocker(s, UPGRADE_BY_ID.rampa)).toMatch(/Wymaga/);
    expect(workshopUnlocked(s)).toBe(false);
    expect(buyUpgrade(s, 'tasmociag').ok).toBe(false);
    s.total.margin = 30_000;
    expect(buyUpgrade(s, 'tasmociag').ok).toBe(true);
    expect(effects(s, info).autoUnload).toBe(4);
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
