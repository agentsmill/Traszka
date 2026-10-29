import { describe, expect, it } from 'vitest';
import { generateStore } from '@/sim/store/generateStore';
import { CATS, MINUTES_PER_DAY, OPEN_FROM, STAFF_MAX } from '../catalog';
import { createEconomy, stepMinute, type EconEvent, type EconomyState } from '../economy';
import { computeStoreInfo } from '../storeInfo';
import { peopleOnShift, placePeople, sanitizeShift, staffOnShift, taskCounts, type ShiftTask } from './shift';
import { STAFF_TASKS, zeroTasks, type TaskMinutes } from './staff';

const SEED = 'kiełbasa-42';
const info = computeStoreInfo(generateStore(SEED));

/** Kto stoi gdzie według przydziału `shift.human`, tak jak zapisałby to `stepMinute` po pierwszej minucie zmiany (nikt nie miał wcześniej zadania). */
function settle(s: EconomyState): EconomyState {
  s.shift.people = s.shift.staff === 0 ? [] : placePeople([], peopleOnShift(s), s.shift.human, s.tycoon.staff.pinned);
  return s;
}

/**
 * Sklep w godzinach pracy (12:00 dnia 0), `n` osób na zmianie i przydział z ostatniej minuty (`shiftStaff` to liczba osób
 * w tamtej minucie; 0 to pierwsza minuta po nocy, bez zapisanych zadań).
 */
function onShift(n: number, human: Partial<TaskMinutes> = {}, shiftStaff = n): EconomyState {
  const s = createEconomy(SEED, info);
  s.minute = 12 * 60;
  s.staff = n;
  s.shift = { staff: shiftStaff, human: { ...zeroTasks(), ...human }, people: [] };
  return settle(s);
}

const tasks = (s: EconomyState): ShiftTask[] => staffOnShift(s).map((p) => p.task);

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
    expect(tasks(settle(s))).toEqual(['kasa', 'sprzatanie']);
  });

  it('przypięty bez pracy wraca do puli', () => {
    const s = onShift(2, { kasa: 2 });
    s.tycoon.staff.pinned.rozladunek = 1;
    expect(tasks(settle(s))).toEqual(['kasa', 'kasa']);
  });

  it('przypięty nie bierze więcej osób, niż jest pracy przy jego zadaniu', () => {
    const s = onShift(3, { kasa: 1, rozladunek: 1.6 });
    s.tycoon.staff.pinned.rozladunek = 3;
    // przypięta jedna osoba (praca 1,6 daje całą jedną), reszta: kasa 1 i ułamek 0,6 rozładunku
    expect(tasks(settle(s))).toEqual(['kasa', 'rozladunek', 'rozladunek']);
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

  it('zapis z większej zmiany, niż jest teraz (zwolnienie, chory): pozycji nie więcej niż osób, ucięte od najwyższych numerów', () => {
    const s = onShift(2, { kasa: 2, rozladunek: 1, wykladanie: 1 }, 4);
    s.shift.people = ['kasa', 'wykladanie', 'rozladunek', 'kasa'];   // przydział z minuty, w której było 4 osoby
    expect(staffOnShift(s)).toEqual([{ id: 0, task: 'kasa' }, { id: 1, task: 'wykladanie' }]);
  });

  it('zapis z mniejszej zmiany (zatrudnienie): nowe numery to wolni, dotychczasowe zostają', () => {
    const s = onShift(2, { kasa: 1, rozladunek: 1 });
    s.staff = 4;
    expect(tasks(s)).toEqual(['kasa', 'rozladunek', 'wolny', 'wolny']);
  });

  it('zapis sprzed stałych numerów (staff > 0, ale people puste): pierwsza osoba na kasie, reszta wolna', () => {
    const s = onShift(3, { kasa: 1, rozladunek: 2 });
    s.shift.people = [];
    expect(tasks(s)).toEqual(['kasa', 'wolny', 'wolny']);
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

  it('stepMinute zapisuje kto czym się zajmuje: tyle osób, ile na zmianie, a nocą nikogo', () => {
    const s = createEconomy(SEED, info);
    s.staff = 3;
    s.queue = 8;
    const events: EconEvent[] = [];
    stepMinute(s, info, events);
    expect(s.shift.people).toHaveLength(3);
    expect(s.shift.people).toEqual(placePeople([], 3, s.shift.human, s.tycoon.staff.pinned));   // pierwsza minuta: nikt nie miał zadania
    s.minute = 2 * 60;                  // noc
    stepMinute(s, info, events);
    expect(s.shift).toMatchObject({ staff: 0, people: [] });
  });

  it('przez całe trzy doby z zatrudnieniami i zwolnieniami: kto mógł zostać przy zadaniu, zostaje', () => {
    const s = createEconomy(SEED, info);
    s.staff = 2;
    s.queue = 6;
    const events: EconEvent[] = [];
    let compared = 0;
    for (let i = 0; i < 3 * MINUTES_PER_DAY; i++) {
      const hour = Math.floor((s.minute % MINUTES_PER_DAY) / 60);
      if (s.minute % 60 === 0) s.staff = 1 + ((hour + Math.floor(s.minute / MINUTES_PER_DAY)) % 5);   // zmiany co godzinę: zatrudnienie i zwolnienie
      if (i % 7 === 0) s.queue += 5;
      const before = s.shift.people.slice();
      stepMinute(s, info, events);
      const after = s.shift.people;
      expect(after).toHaveLength(s.shift.staff);
      if (before.length === 0 || after.length === 0) continue;
      // najwięcej osób, które mogły zostać: tyle, ile przy zadaniu było i będzie
      const common = STAFF_TASKS.reduce((n, task) => n + Math.min(
        before.slice(0, after.length).filter((x) => x === task).length, after.filter((x) => x === task).length), 0);
      const kept = after.filter((task, id) => task !== 'wolny' && task === before[id]).length;
      expect(kept).toBe(common);
      compared++;
    }
    expect(compared).toBeGreaterThan(MINUTES_PER_DAY);
  });
});

describe('placePeople: stałe numery osób', () => {
  const need = (m: Partial<TaskMinutes>): TaskMinutes => ({ ...zeroTasks(), ...m });

  it('od zera: zadania w kolejności STAFF_TASKS (kasa ma najniższe numery), reszta wolna', () => {
    expect(placePeople([], 5, need({ kasa: 1, rozladunek: 2, sprzatanie: 1 }), zeroTasks()))
      .toEqual(['kasa', 'rozladunek', 'rozladunek', 'sprzatanie', 'wolny']);
    expect(placePeople([], 0, need({ kasa: 3 }), zeroTasks())).toEqual([]);
  });

  it('osoba zostaje przy zadaniu, gdy liczba ludzi przy nim się nie zmienia', () => {
    // rozładunek idzie z jednej osoby na dwie; zniknęło za to miejsce na kasie. Osoba 2 stała przy paletach i nadal stoi
    const prev: ShiftTask[] = ['kasa', 'wykladanie', 'rozladunek'];
    const next = placePeople(prev, 3, need({ wykladanie: 1, rozladunek: 2 }), zeroTasks());
    expect(next[2]).toBe('rozladunek');
    expect(next[1]).toBe('wykladanie');
    expect(next[0]).toBe('rozladunek');   // dawny kasjer bierze nowe miejsce przy paletach
  });

  it('osoba przy zadaniu, które ma teraz mniej miejsc, oddaje je od najwyższego numeru', () => {
    const next = placePeople(['rozladunek', 'rozladunek', 'rozladunek'], 3, need({ rozladunek: 2, kasa: 1 }), zeroTasks());
    expect(next).toEqual(['rozladunek', 'rozladunek', 'kasa']);
  });

  it('zatrudnienie dodaje najwyższe id i nie rusza dotychczasowych', () => {
    const prev: ShiftTask[] = ['rozladunek', 'wykladanie'];
    // przybyła praca przy kasie: nowa osoba (id 2) staje na kasie, choć kasa jest pierwsza w kolejności zadań
    const next = placePeople(prev, 3, need({ kasa: 1, rozladunek: 1, wykladanie: 1 }), zeroTasks());
    expect(next).toEqual(['rozladunek', 'wykladanie', 'kasa']);
    expect(next.slice(0, 2)).toEqual(prev);
  });

  it('zwolnienie zabiera najwyższe id: pozostali zostają przy swoich zadaniach', () => {
    const prev: ShiftTask[] = ['rozladunek', 'wykladanie', 'kasa'];
    expect(placePeople(prev, 2, need({ rozladunek: 1, wykladanie: 1 }), zeroTasks())).toEqual(['rozladunek', 'wykladanie']);
  });

  it('wolny bierze wolne miejsce, ale nikogo nie wypycha', () => {
    const next = placePeople(['wolny', 'kasa', 'wolny'], 3, need({ kasa: 1, wykladanie: 1 }), zeroTasks());
    expect(next).toEqual(['wykladanie', 'kasa', 'wolny']);
  });

  it('przypięci mają miejsca pierwsi, a przypięcie nie przestawia tych, którzy już tam stoją', () => {
    const pinned = need({ sprzatanie: 1 });
    const next = placePeople(['kasa', 'rozladunek', 'sprzatanie'], 3, need({ kasa: 1, rozladunek: 1, sprzatanie: 1 }), pinned);
    expect(next).toEqual(['kasa', 'rozladunek', 'sprzatanie']);
  });

  it('własność: długość n, liczby przy zadaniach jak w taskCounts, najwięcej osób zostaje przy swoim', () => {
    let seed = 12345;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pickTask = (): ShiftTask => (['kasa', 'rozladunek', 'wykladanie', 'sprzatanie', 'wolny'] as const)[Math.floor(rnd() * 5)]!;
    for (let round = 0; round < 500; round++) {
      const n = Math.floor(rnd() * (STAFF_MAX + 1));
      const prev = Array.from({ length: Math.floor(rnd() * (STAFF_MAX + 1)) }, pickTask);
      const human = need({ kasa: rnd() * 3, rozladunek: rnd() * 3, wykladanie: rnd() * 3, sprzatanie: rnd() * 3 });
      const pinned = need({ kasa: Math.floor(rnd() * 2), rozladunek: Math.floor(rnd() * 2) });
      const next = placePeople(prev, n, human, pinned);
      const counts = taskCounts(n, human, pinned);
      expect(next).toHaveLength(n);
      for (const task of STAFF_TASKS) expect(next.filter((x) => x === task).length, `runda ${round}, ${task}`).toBe(counts[task]);
      const common = STAFF_TASKS.reduce((k, task) => k + Math.min(prev.slice(0, n).filter((x) => x === task).length, counts[task]), 0);
      expect(next.filter((task, id) => task !== 'wolny' && task === prev[id]).length, `runda ${round}`).toBe(common);
    }
  });
});

describe('staffOnShift: stałe numery', () => {
  it('odczyt shift.people: numery to miejsca w zapisie, a nie kolejność zadań', () => {
    const s = onShift(3, { kasa: 1, wykladanie: 1, rozladunek: 1 });
    s.shift.people = ['wykladanie', 'rozladunek', 'kasa'];
    expect(staffOnShift(s)).toEqual([{ id: 0, task: 'wykladanie' }, { id: 1, task: 'rozladunek' }, { id: 2, task: 'kasa' }]);
  });

  it('zatrudnienie na zmianie: dotychczasowi mają te same numery i zadania, nowy dostaje najwyższy', () => {
    const s = onShift(2, { rozladunek: 1, wykladanie: 1 });
    s.shift.people = ['wykladanie', 'rozladunek'];
    const before = staffOnShift(s);
    s.staff = 3;
    const after = staffOnShift(s);
    expect(after.slice(0, 2)).toEqual(before);
    expect(after[2]).toEqual({ id: 2, task: 'wolny' });
  });

  it('po stepMinute z zatrudnieniem nowa osoba ma najwyższe id, a dotychczasowi zostają przy zadaniach', () => {
    const s = onShift(2, { kasa: 1, wykladanie: 1 });
    s.shift.people = ['wykladanie', 'kasa'];        // wykładający ma niższy numer niż kasjer, wbrew kolejności zadań
    s.queue = 40;                                   // kasa ma pracę
    for (const c of CATS) {                         // wykładanie ma pracę: puste półki i pełne zaplecze
      s.shelf[c] = 0;
      s.backroom[c] = 100;
    }
    s.staff = 3;                                    // zatrudnienie między minutami
    stepMinute(s, info, []);
    expect(s.shift.people).toHaveLength(3);
    expect(s.shift.people.slice(0, 2)).toEqual(['wykladanie', 'kasa']);
    expect(s.shift.people).toEqual(placePeople(['wykladanie', 'kasa'], 3, s.shift.human, s.tycoon.staff.pinned));
  });
});

describe('sanitizeShift', () => {
  it('brak pola albo śmieci dają pustą zmianę, wartości są przycięte', () => {
    const empty = { staff: 0, human: zeroTasks(), people: [] };
    expect(sanitizeShift(undefined)).toEqual(empty);
    expect(sanitizeShift(null)).toEqual(empty);
    expect(sanitizeShift('dwóch')).toEqual(empty);
    expect(sanitizeShift({ staff: 'dwóch', human: [] })).toEqual(empty);
    expect(sanitizeShift({ staff: 1e308, human: { kasa: -4, rozladunek: 1e308, wykladanie: 'x', sprzatanie: null } }))
      .toEqual({ staff: STAFF_MAX, human: { kasa: 0, rozladunek: STAFF_MAX, wykladanie: 0, sprzatanie: 0 }, people: [] });
  });

  it('poprawna zmiana wraca bez zmian, z tą samą kolejnością pól', () => {
    const shift = {
      staff: 3, human: { kasa: 1.25, rozladunek: 0.5, wykladanie: 1, sprzatanie: 0.25 }, people: ['rozladunek', 'kasa', 'wolny'],
    };
    expect(JSON.stringify(sanitizeShift(JSON.parse(JSON.stringify(shift))))).toBe(JSON.stringify(shift));
  });

  it('zapis sprzed stałych numerów (bez people) wczytuje się z pustą listą', () => {
    const old = { staff: 2, human: { kasa: 1, rozladunek: 1, wykladanie: 0, sprzatanie: 0 } };
    expect(sanitizeShift(old)).toEqual({ ...old, people: [] });
  });

  it('people: nie tablica daje pustą listę, nieznane zadanie to wolny (numery się nie przesuwają), nadmiar ucięty', () => {
    expect(sanitizeShift({ staff: 1, people: 'kasa' }).people).toEqual([]);
    expect(sanitizeShift({ staff: 1, people: { 0: 'kasa' } }).people).toEqual([]);
    expect(sanitizeShift({ staff: 4, people: ['kasa', 'szefowa', 7, null] }).people).toEqual(['kasa', 'wolny', 'wolny', 'wolny']);
    const long = Array.from({ length: STAFF_MAX + 5 }, () => 'kasa');
    expect(sanitizeShift({ staff: STAFF_MAX, people: long }).people).toEqual(long.slice(0, STAFF_MAX));
  });

  it('stan z symulacji przechodzi przez JSON i sanityzację co do bajta', () => {
    const s = createEconomy(SEED, info);
    s.staff = 4;
    s.queue = 9;
    const events: EconEvent[] = [];
    for (let i = 0; i < 90; i++) stepMinute(s, info, events);
    expect(s.shift.people.length).toBeGreaterThan(0);
    expect(JSON.stringify(sanitizeShift(JSON.parse(JSON.stringify(s.shift))))).toBe(JSON.stringify(s.shift));
  });
});

