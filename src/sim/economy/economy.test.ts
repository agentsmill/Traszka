import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { CATS, MINUTES_PER_DAY, OPEN_FROM, START_CASH, TILL_RATE, UNLOAD_AT, UNLOAD_RATE, WAGE_PER_DAY } from './catalog';
import { dateOfDay, formatDate, isLastDayOfMonth } from './calendar';
import { advanceEconomy } from './clock';
import {
  buyEquipment, buyUpgrade, claimGift, claimQuest, createEconomy, effects, movePallet, relayout, slotFree, startRemont,
  stepMinute, tapPallet, tapTill, unlocksAt, upgradeBlocker, workshopUnlocked, type CommandResult, type EconEvent,
  type EconomyState,
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
    expect(upgradeBlocker(s, UPGRADE_BY_ID.rampa)).toMatch(/6\. poziomie/);
    s.level = 6;
    expect(upgradeBlocker(s, UPGRADE_BY_ID.rampa)).toMatch(/Wymaga/);
    expect(workshopUnlocked(s)).toBe(false);
    expect(buyUpgrade(s, 'tasmociag').ok).toBe(false);
    s.level = 10;
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

  it('złota paleta, którą pracownik prawie rozładował, a taśmociąg dokończył, daje premię i licznik dokładnie raz', () => {
    const s = createEconomy(SEED, info);
    s.upgrades.tasmociag = 1;   // 4 szt./min, całą dobę
    s.staff = 2;
    s.priority = 'palety';      // jedna osoba na kasie, druga rozładowuje
    s.order = { auto: false, manual: 0 };
    // pracownik zdejmie UNLOAD_RATE × UNLOAD_AT.sidewalk sztuk i zostawi 0,2 szt., które w tej samej minucie dobierze taśmociąg
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
    s.priority = 'rowno';
    s.order = { auto: false, manual: 0 };
    s.queue = 4.3;   // przed obsługą: ceil(4,3 / 4) = 2 kasjerów; po niej zostaje ok. 2,9, czyli „1 kasjer”
    const before = s.total.customers;
    stepMinute(s, info, []);
    const served = s.total.customers - before;
    expect(served).toBeCloseTo(2 * TILL_RATE, 6);   // obsłużyło dwóch kasjerów
    expect(s.lastCashiers).toBe(2);
    expect(s.lastWorkers).toBe(1);
    expect(s.lastCashiers + s.lastWorkers).toBe(s.staff);
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

  it('combo i paczka „turbo” mnożą stuknięcia', () => {
    const s = createEconomy(SEED, info);
    for (const c of CATS) s.backroom[c] = 0;
    const val = (r: CommandResult): number => (r.ok ? r.value ?? 0 : 0);
    const one = val(tapPallet(s, info, undefined, 1));
    const three = val(tapPallet(s, info, undefined, 3));
    expect(three).toBeCloseTo(one * 3, 5);
    s.tapBoostUntil = s.minute + 100;
    expect(val(tapPallet(s, info, undefined, 1))).toBeCloseTo(one * 3, 5);
    expect(s.total.taps).toBe(3);
  });

  it('paczka od Centrali zawsze coś daje, a kolejne paczki dają różne nagrody', () => {
    const s = createEconomy(SEED, info);
    const kinds = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const r = claimGift(s, info);
      expect(r.ok).toBe(true);
      kinds.add(r.kind!);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  it('złota paleta po rozładunku daje premię i komunikat', () => {
    const s = createEconomy(SEED, info);
    for (const c of CATS) s.backroom[c] = 0;
    const p = s.pallets[0]!;
    p.golden = true;
    const cash = s.cash;
    let text: string | undefined;
    for (let i = 0; i < 200 && s.pallets.some((x) => x.id === p.id); i++) text = tapPallet(s, info, p.id, 5).text ?? text;
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
