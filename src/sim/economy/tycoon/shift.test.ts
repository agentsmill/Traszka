import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { MINUTES_PER_DAY, OPEN_FROM, STAFF_MAX } from '../catalog';
import { createEconomy, stepMinute, type EconEvent, type EconomyState } from '../economy';
import { computeStoreInfo } from '../storeInfo';
import { sanitizeShift, staffOnShift } from './shift';
import { zeroTasks, type StaffTask, type TaskMinutes } from './staff';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));

/** Sklep w godzinach pracy (12:00 dnia 0), `n` osób na zmianie i przydział z ostatniej minuty. */
function onShift(n: number, human: Partial<TaskMinutes> = {}, shiftStaff = n): EconomyState {
  const s = createEconomy(SEED, info);
  s.minute = 12 * 60;
  s.staff = n;
  s.shift = { staff: shiftStaff, human: { ...zeroTasks(), ...human } };
  return s;
}

const tasks = (s: EconomyState): (StaffTask | 'wolny')[] => staffOnShift(s).map((p) => p.task);

describe('staffOnShift: kto jest na zmianie', () => {
  it('jedna pozycja na każdą osobę na zmianie, numery po kolei od 0', () => {
    for (let staff = 0; staff <= STAFF_MAX; staff++) {
      const people = staffOnShift(onShift(staff, { kasa: staff }));
      expect(people).toHaveLength(staff);
      expect(people.map((p) => p.id)).toEqual(Array.from({ length: staff }, (_, i) => i));
    }
  });

  it('poza godzinami pracy pusto', () => {
    const s = onShift(3, { kasa: 3 });
    s.minute = 3 * 60;
    expect(staffOnShift(s)).toEqual([]);
    s.minute = 23 * 60;   // OPEN_TO: zmiana już zeszła
    expect(staffOnShift(s)).toEqual([]);
    s.minute = OPEN_FROM - 1;
    expect(staffOnShift(s)).toEqual([]);
  });

  it('chory z karty zmniejsza zmianę, a dodatkowa osoba z karty ją zwiększa', () => {
    const s = onShift(3, { kasa: 3 });
    s.tycoon.cards.active.push({ kind: 'staff', value: -1, from: 0, until: 1e9, seq: 1 });
    expect(staffOnShift(s)).toHaveLength(2);
    s.tycoon.cards.active[0]!.value = -10;   // nie schodzi poniżej zera
    expect(staffOnShift(s)).toEqual([]);
    s.tycoon.cards.active[0]!.value = 1;
    expect(staffOnShift(s)).toHaveLength(4);
    s.tycoon.cards.active[0]!.value = 99;    // ani nie przekracza limitu zmiany
    expect(staffOnShift(s)).toHaveLength(STAFF_MAX);
  });

  it('efekt karty po czasie nie liczy się do zmiany', () => {
    const s = onShift(3, { kasa: 3 });
    s.tycoon.cards.active.push({ kind: 'staff', value: -1, from: 0, until: 12 * 60, seq: 1 });   // skończył się w tej minucie
    expect(staffOnShift(s)).toHaveLength(3);
  });

  it('największe reszty: ułamki osobominut zamieniają się na całe osoby', () => {
    const s = onShift(3, { kasa: 1.4, rozladunek: 0.9, wykladanie: 0.7, sprzatanie: 0 });
    expect(tasks(s)).toEqual(['kasa', 'rozladunek', 'wykladanie']);
  });

  it('bezczynni to wolny', () => {
    expect(tasks(onShift(3, { kasa: 1.2 }))).toEqual(['kasa', 'wolny', 'wolny']);
    expect(tasks(onShift(2, {}))).toEqual(['wolny', 'wolny']);
  });

  it('najpierw przypięci, potem reszta według pracy', () => {
    const s = onShift(2, { kasa: 1, sprzatanie: 1 });
    s.tycoon.staff.pinned.sprzatanie = 1;
    expect(tasks(s)).toEqual(['kasa', 'sprzatanie']);
  });

  it('przypięty bez pracy wraca do puli', () => {
    const s = onShift(2, { kasa: 2 });
    s.tycoon.staff.pinned.rozladunek = 1;
    expect(tasks(s)).toEqual(['kasa', 'kasa']);
  });

  it('przypięty nie bierze więcej osób, niż jest pracy przy jego zadaniu', () => {
    const s = onShift(3, { kasa: 1, rozladunek: 1.6 });
    s.tycoon.staff.pinned.rozladunek = 3;
    // przypięta jedna osoba (praca 1,6 daje całą jedną), reszta: kasa 1 i ułamek 0,6 rozładunku
    expect(tasks(s)).toEqual(['kasa', 'rozladunek', 'rozladunek']);
  });

  it('remis ułamków rozstrzyga kolejność zadań (kasa przed rozładunkiem przed sprzątaniem)', () => {
    // razem 1 osobominuta, czyli jedno miejsce: dostaje je kasa
    expect(tasks(onShift(2, { kasa: 0.5, sprzatanie: 0.5 }))).toEqual(['kasa', 'wolny']);
    // razem 1,5 osobominuty, czyli dwa miejsca z trzech równych ułamków
    expect(tasks(onShift(2, { kasa: 0.5, rozladunek: 0.5, sprzatanie: 0.5 }))).toEqual(['kasa', 'rozladunek']);
  });

  it('pierwsza minuta po otwarciu: zmiana ma poprzednią minutę z nocy, więc kasa i wolny', () => {
    const s = onShift(2, { kasa: 0, rozladunek: 2 }, 0);
    expect(tasks(s)).toEqual(['kasa', 'wolny']);
    expect(tasks(onShift(1, {}, 0))).toEqual(['kasa']);
    expect(tasks(onShift(0, {}, 0))).toEqual([]);
  });

  it('przydział z większej zmiany, niż jest teraz (zwolnienie, chory): pozycji nie więcej niż osób', () => {
    const s = onShift(2, { kasa: 2, rozladunek: 1, wykladanie: 1 });   // przydział z minuty, w której było 4 osoby
    expect(staffOnShift(s)).toHaveLength(2);
    expect(tasks(s)).toEqual(['kasa', 'kasa']);
  });

  it('zepsuty przydział (więcej osobominut niż osób, ujemne, NaN) nie daje więcej pozycji niż osób', () => {
    const s = onShift(2, { kasa: 7, rozladunek: -3, wykladanie: Number.NaN });
    expect(staffOnShift(s)).toHaveLength(2);
  });
});

describe('staffOnShift razem z symulacją', () => {
  it('co minutę dnia: tyle pozycji, ile osób na zmianie (także w nocy), a numery po kolei', () => {
    const s = createEconomy(SEED, info);
    s.staff = 4;
    const events: EconEvent[] = [];
    let nightSeen = false;
    for (let i = 0; i < 2 * MINUTES_PER_DAY; i++) {
      const people = staffOnShift(s);
      const open = s.minute % MINUTES_PER_DAY >= OPEN_FROM && s.minute % MINUTES_PER_DAY < 23 * 60;
      expect(people.length).toBe(open ? 4 : 0);
      expect(people.map((p) => p.id)).toEqual(people.map((_, k) => k));
      if (!open) nightSeen = true;
      stepMinute(s, info, events);
    }
    expect(nightSeen).toBe(true);
  });

  it('po minucie symulacji zadania zgadzają się z przydziałem: kolejka i dostawa', () => {
    const s = createEconomy(SEED, info);
    s.staff = 3;
    s.queue = 8;                        // kasa chce całego stanowiska
    const events: EconEvent[] = [];
    stepMinute(s, info, events);
    stepMinute(s, info, events);        // druga minuta: przydział z pierwszej jest już w `shift`
    const t = tasks(s);
    expect(t).toHaveLength(3);
    expect(t.filter((x) => x === 'kasa').length).toBe(Math.round(s.shift.human.kasa));
    expect(t[0]).toBe('kasa');
  });
});

describe('sanitizeShift', () => {
  it('brak pola albo śmieci dają pustą zmianę, wartości są przycięte', () => {
    const empty = { staff: 0, human: zeroTasks() };
    expect(sanitizeShift(undefined)).toEqual(empty);
    expect(sanitizeShift(null)).toEqual(empty);
    expect(sanitizeShift('dwóch')).toEqual(empty);
    expect(sanitizeShift({ staff: 'dwóch', human: [] })).toEqual(empty);
    expect(sanitizeShift({ staff: 1e308, human: { kasa: -4, rozladunek: 1e308, wykladanie: 'x', sprzatanie: null } }))
      .toEqual({ staff: STAFF_MAX, human: { kasa: 0, rozladunek: STAFF_MAX, wykladanie: 0, sprzatanie: 0 } });
  });

  it('poprawna zmiana wraca bez zmian, z tą samą kolejnością pól', () => {
    const shift = { staff: 3, human: { kasa: 1.25, rozladunek: 0.5, wykladanie: 1, sprzatanie: 0.25 } };
    expect(JSON.stringify(sanitizeShift(JSON.parse(JSON.stringify(shift))))).toBe(JSON.stringify(shift));
  });
});
