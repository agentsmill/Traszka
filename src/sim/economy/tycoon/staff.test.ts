import { describe, expect, it } from 'vitest';
import { SCO_ACCEPT, SCO_RATE, TILL_RATE, UNLOAD_RATE } from '../catalog';
import { rand01 } from '../rand';
import {
  NO_ROBOTS, ROBOT_RATE, STAFF_TASKS, addChores, allocateStaff, closeStaffDay, createStaffPool, normalizePins, pinStaff,
  restockDemand, sanitizeStaffPool, setStaffOrder, setStaffProfile, stepStaff, tillDemand, tillServed, unloadDemand,
  type StaffPoolState, type TaskMinutes,
} from './staff';

const demand = (d: Partial<TaskMinutes>): TaskMinutes => ({ kasa: 0, rozladunek: 0, wykladanie: 0, sprzatanie: 0, ...d });
const BUSY = demand({ kasa: 0.9, rozladunek: 4, wykladanie: 1, sprzatanie: 1 });

describe('pula czasu ludzi: kolejność i profile', () => {
  it('„Kolejka”: kasa dostaje wszystko, czego chce, a na sprzątanie nie starcza ludzi (czeka)', () => {
    const a = allocateStaff(createStaffPool(), { staff: 2, demand: BUSY });
    expect(a.human.kasa).toBeCloseTo(0.9);
    expect(a.human.wykladanie).toBeCloseTo(1);
    expect(a.human.rozladunek).toBeCloseTo(0.1);
    expect(a.human.sprzatanie).toBe(0);
    expect(a.waiting.rozladunek).toBeCloseTo(3.9);
    expect(a.waiting.sprzatanie).toBeCloseTo(1);
    expect(a.idle).toBe(0);
  });

  it('„Dostawa”: obaj przy paletach, kasa czeka', () => {
    const pool = createStaffPool();
    expect(setStaffProfile(pool, 'dostawa').ok).toBe(true);
    const a = allocateStaff(pool, { staff: 2, demand: BUSY });
    expect(a.human.rozladunek).toBe(2);
    expect(a.human.kasa).toBe(0);
    expect(a.waiting.kasa).toBeCloseTo(0.9);
  });

  it('„Porządek”: najpierw sprzątanie, potem kasa', () => {
    const pool = createStaffPool();
    setStaffProfile(pool, 'porzadek');
    const a = allocateStaff(pool, { staff: 2, demand: BUSY });
    expect(a.human.sprzatanie).toBe(1);
    expect(a.human.kasa).toBeCloseTo(0.9);
    expect(a.human.wykladanie).toBeCloseTo(0.1);
  });

  it('własna kolejność musi być permutacją czterech zadań', () => {
    const pool = createStaffPool();
    expect(setStaffOrder(pool, ['kasa', 'kasa', 'wykladanie', 'sprzatanie']).ok).toBe(false);
    expect(setStaffOrder(pool, ['kasa', 'wykladanie']).ok).toBe(false);
    expect(pool.profile).toBe('kolejka');
    expect(setStaffOrder(pool, ['wykladanie', 'sprzatanie', 'kasa', 'rozladunek']).ok).toBe(true);
    expect(pool.profile).toBe('wlasny');
    const a = allocateStaff(pool, { staff: 1, demand: BUSY });
    expect(a.human.wykladanie).toBe(1);
    expect(a.waiting.kasa).toBeCloseTo(0.9);
  });

  it('bez zapotrzebowania ludzie stoją bezczynnie; nic nie ginie ani nie przybywa', () => {
    const pool = createStaffPool();
    for (let i = 0; i < 200; i++) {
      const staff = Math.floor(rand01(1, i, 1) * 6);
      const d = demand({ kasa: rand01(1, i, 2) * 2, rozladunek: rand01(1, i, 3) * 4, wykladanie: rand01(1, i, 4), sprzatanie: rand01(1, i, 5) });
      pool.chores = rand01(1, i, 6) < 0.3 ? 50 : 0;
      const a = allocateStaff(pool, { staff, demand: d });
      const humanSum = STAFF_TASKS.reduce((n, t) => n + a.human[t], 0);
      expect(humanSum + a.chores + a.idle).toBeCloseTo(staff, 9);
      for (const t of STAFF_TASKS) expect(a.total[t] + a.waiting[t]).toBeCloseTo(d[t], 9);
    }
  });
});

describe('ręczny przydział', () => {
  it('przypięta osoba stoi przy swoim zadaniu, nawet gdy nie ma pracy (nadmiar to bezczynność)', () => {
    const pool = createStaffPool();
    setStaffProfile(pool, 'dostawa');
    expect(pinStaff(pool, 'kasa', 1, 2).ok).toBe(true);
    const a = allocateStaff(pool, { staff: 2, demand: demand({ kasa: 0.3, rozladunek: 4 }) });
    expect(a.human.kasa).toBeCloseTo(0.3);
    expect(a.idle).toBeCloseTo(0.7);
    expect(a.human.rozladunek).toBe(1);
  });

  it('przydział z bzdurą zamiast liczby jest odrzucany (NaN nie wchodzi do stanu)', () => {
    const pool = createStaffPool();
    expect(pinStaff(pool, 'kasa', Number.NaN, 2).ok).toBe(false);
    expect(pinStaff(pool, 'kasa', Number.POSITIVE_INFINITY, 2).ok).toBe(false);
    expect(pool.pinned.kasa).toBe(0);
    const a = allocateStaff(pool, { staff: 2, demand: BUSY });
    expect(Number.isFinite(a.idle)).toBe(true);
  });

  it('przydziałów nie może być więcej niż ludzi; zwolnienie przycina przydziały', () => {
    const pool = createStaffPool();
    expect(pinStaff(pool, 'kasa', 2, 3).ok).toBe(true);
    expect(pinStaff(pool, 'rozladunek', 2, 3).ok).toBe(false);
    expect(pinStaff(pool, 'rozladunek', 1, 3).ok).toBe(true);
    normalizePins(pool, 2);
    expect(pool.pinned).toEqual({ kasa: 2, rozladunek: 0, wykladanie: 0, sprzatanie: 0 });
  });

  it('przypiętych więcej niż ludzi na zmianie (ktoś chory): przydział bierze tylko tych, którzy są', () => {
    const pool = createStaffPool();
    pinStaff(pool, 'kasa', 1, 2);
    pinStaff(pool, 'rozladunek', 1, 2);
    const a = allocateStaff(pool, { staff: 1, demand: BUSY });
    expect(a.human.kasa).toBeCloseTo(0.9);
    expect(a.human.rozladunek).toBe(0);
    expect(a.idle).toBeCloseTo(0.1);
  });
});

describe('czas ludzi z kart', () => {
  it('odrabia go jedna osoba naraz, reszta pracuje; po odrobieniu wraca do zadań', () => {
    const pool = createStaffPool();
    addChores(pool, 1.5);
    const a = stepStaff(pool, { staff: 2, demand: BUSY });
    expect(a.chores).toBe(1);
    expect(a.human.kasa).toBeCloseTo(0.9);
    expect(pool.chores).toBeCloseTo(0.5);
    const b = stepStaff(pool, { staff: 2, demand: BUSY });
    expect(b.chores).toBeCloseTo(0.5);
    expect(pool.chores).toBe(0);
    const c = stepStaff(pool, { staff: 2, demand: BUSY });
    expect(c.chores).toBe(0);
  });

  it('wszyscy przypięci: czas z karty i tak się odrabia (ktoś schodzi z posterunku)', () => {
    const pool = createStaffPool();
    pinStaff(pool, 'kasa', 1, 2);
    pinStaff(pool, 'rozladunek', 1, 2);
    addChores(pool, 30);
    const a = stepStaff(pool, { staff: 2, demand: BUSY });
    expect(a.chores).toBe(1);
    expect(a.human.kasa + a.human.rozladunek + a.chores + a.idle).toBeCloseTo(2);
    for (let i = 0; i < 40; i++) stepStaff(pool, { staff: 2, demand: BUSY });
    expect(pool.chores).toBe(0);
  });

  it('jedyna osoba na zmianie idzie do pracy z karty i kasa czeka', () => {
    const pool = createStaffPool();
    addChores(pool, 30);
    const a = allocateStaff(pool, { staff: 1, demand: BUSY });
    expect(a.chores).toBe(1);
    expect(a.waiting.kasa).toBeCloseTo(0.9);
  });
});

describe('automatyka zastępuje minuty ludzi', () => {
  it('taśmociąg bierze rozładunek, więc ludzie mają czas na sprzątanie', () => {
    const pool = createStaffPool();
    const d = demand({ kasa: 0.9, rozladunek: 1, wykladanie: 0.5, sprzatanie: 1 });
    const without = allocateStaff(pool, { staff: 2, demand: d });
    const robots = { ...NO_ROBOTS, tasmociag: 1 };
    const withBelt = allocateStaff(pool, { staff: 2, demand: d, robots });
    expect(withBelt.robot.rozladunek).toBeCloseTo(ROBOT_RATE.tasmociag);
    expect(withBelt.human.sprzatanie).toBeGreaterThan(without.human.sprzatanie);
    expect(withBelt.waiting.sprzatanie).toBeLessThan(without.waiting.sprzatanie);
  });

  it('eDward bierze każde zadanie według kolejności, także nocą (bez ludzi)', () => {
    const pool = createStaffPool();
    setStaffProfile(pool, 'porzadek');
    const a = allocateStaff(pool, { staff: 0, demand: demand({ sprzatanie: 1, rozladunek: 4 }), robots: { ...NO_ROBOTS, edward: 1 } });
    expect(a.robot.sprzatanie).toBe(1);
    expect(a.robot.rozladunek).toBe(ROBOT_RATE.edward - 1);
    expect(a.idle).toBe(0);
  });

  it('wykładacz bierze wykładanie, prasa nie zabiera nikomu minut', () => {
    const a = allocateStaff(createStaffPool(), {
      staff: 1, demand: demand({ wykladanie: 2 }), robots: { ...NO_ROBOTS, wykladacz: 2, prasa: 3 },
    });
    expect(a.robot.wykladanie).toBeCloseTo(2 * ROBOT_RATE.wykladacz);
    expect(a.human.wykladanie).toBeCloseTo(2 - 2 * ROBOT_RATE.wykladacz);
  });
});

describe('kasa samoobsługowa', () => {
  const till = { tills: 1, tillRate: TILL_RATE, scoRate: SCO_RATE, scoAccept: SCO_ACCEPT };

  it('klienci obsłużeni przez SCO nie zabierają minut kasjera: zapotrzebowanie kasy spada, puli wraca czas', () => {
    const none = tillDemand({ ...till, queue: 0.6, sco: 0 });
    const two = tillDemand({ ...till, queue: 0.6, sco: 2 });
    expect(none.demand).toBeCloseTo(0.6 / TILL_RATE);
    expect(two.scoServed).toBeCloseTo(0.6 * SCO_ACCEPT);
    expect(two.demand).toBeCloseTo((0.6 - 0.6 * SCO_ACCEPT) / TILL_RATE);
    expect(two.freed).toBeCloseTo(two.scoServed / TILL_RATE);
    expect(none.demand - two.demand).toBeCloseTo(two.freed);
  });

  it('SCO nie zastępuje ludzi: bez kasjera zostaje kolejka do człowieka', () => {
    const t = tillDemand({ ...till, queue: 5, sco: 3 });
    expect(t.humanQueue).toBeGreaterThan(3);
    expect(tillServed(t, 0, TILL_RATE)).toBe(0);
    expect(tillServed(t, 1, TILL_RATE)).toBeCloseTo(TILL_RATE);
  });

  it('oddany czas idzie na palety (w tej samej minucie)', () => {
    const pool = createStaffPool();
    const run = (sco: number): number => {
      const t = tillDemand({ ...till, queue: 0.6, sco });
      return allocateStaff(pool, { staff: 2, demand: demand({ kasa: t.demand, rozladunek: 4 }) }).human.rozladunek;
    };
    expect(run(2)).toBeGreaterThan(run(0));
  });

  it('kasa nie przyjmie więcej osób niż stanowisk', () => {
    expect(tillDemand({ ...till, queue: 20, sco: 0 }).demand).toBe(1);
    expect(tillDemand({ ...till, tills: 2, queue: 20, sco: 0 }).demand).toBe(2);
  });
});

describe('zapotrzebowanie zadań i statystyki', () => {
  it('przy palecie najwyżej dwie osoby, przy wykładaniu też', () => {
    expect(unloadDemand([{ items: 320, rate: UNLOAD_RATE }, { items: 3, rate: UNLOAD_RATE }])).toBeCloseTo(2.5);
    expect(restockDemand(1000, 20)).toBe(2);
    expect(restockDemand(10, 20)).toBeCloseTo(0.5);
    expect(restockDemand(-5, 20)).toBe(0);
  });

  it('statystyki dnia i miesiąca sumują pracę; koniec dnia zeruje tylko dzień', () => {
    const pool = createStaffPool();
    for (let i = 0; i < 10; i++) stepStaff(pool, { staff: 2, demand: BUSY, scoFreed: 0.1 });
    expect(pool.day.worked.kasa).toBeCloseTo(9);
    expect(pool.day.waiting.sprzatanie).toBeCloseTo(10);
    expect(pool.day.scoFreed).toBeCloseTo(1);
    expect(pool.day.starved).toEqual({ kasa: 0, rozladunek: 0, wykladanie: 0, sprzatanie: 10 });
    const day = closeStaffDay(pool);
    expect(day.worked.wykladanie).toBeCloseTo(10);
    expect(pool.day.worked.kasa).toBe(0);
    expect(pool.month.worked.kasa).toBeCloseTo(9);
  });
});

describe('zapis', () => {
  it('JSON w obie strony bez zmian', () => {
    const pool = createStaffPool();
    setStaffOrder(pool, ['sprzatanie', 'kasa', 'rozladunek', 'wykladanie']);
    pinStaff(pool, 'kasa', 1, 3);
    addChores(pool, 40);
    stepStaff(pool, { staff: 3, demand: BUSY });
    const copy = JSON.parse(JSON.stringify(pool)) as StaffPoolState;
    expect(sanitizeStaffPool(copy, 3)).toEqual(pool);
  });

  it('śmieci w zapisie wracają do wartości domyślnych, przydziały mieszczą się w personelu', () => {
    const s = sanitizeStaffPool({ profile: 'impreza', order: ['kasa'], pinned: { kasa: 7, rozladunek: 'x' }, chores: -5, day: [] }, 2);
    expect(s.profile).toBe('kolejka');
    expect(s.pinned.kasa).toBe(2);
    expect(s.pinned.rozladunek).toBe(0);
    expect(s.chores).toBe(0);
    expect(sanitizeStaffPool(null, 2)).toEqual(createStaffPool());
    expect(sanitizeStaffPool({ profile: 'wlasny', order: [1, 2] }, 2).profile).toBe('kolejka');
  });
});
