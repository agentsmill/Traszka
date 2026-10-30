import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { layoutFor } from '@/sim/store/layoutFor';
import { HIRE_COST } from './catalog';
import { applyCommand, COMMAND_TYPES, isCommand, type Command } from './commands';
import {
  answerCard, awaitingDecision, buyEquipment, buyUpgrade, campaign, commitTap, createEconomy, fire, freeSpots, hire, movePallet,
  claimMilestone, processLevels, relayout, rushRemont, setOrder, startRemont, tapPallet, tapTill,
  type CommandResult, type EconomyState,
} from './economy';
import { computeStoreInfo, type StoreInfo } from './storeInfo';
import { visibleCards } from './tycoon/cards';
import { pinStaff, setStaffProfile } from './tycoon/staff';
import { xpToNext } from './progress';

const SEED = 'kiełbasa-42';

/** Świeża gra na układzie 0, tak jak zaczyna ją sesja. */
function base(seed = SEED): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor(seed, 0));
  return { s: createEconomy(seed, info), info };
}
const snapshot = (s: EconomyState): string => JSON.stringify(s);

/** Stan, w którym polecenie się uda, razem z dzisiejszą ścieżką (funkcja z economy.ts) dla tego polecenia. */
interface Prepared {
  s: EconomyState;
  info: StoreInfo;
  cmd: Command;
  /** Wywołanie funkcji z economy.ts tak, jak robi to `main.ts` (bez poziomów i przebudowy układu). */
  legacy: (s: EconomyState, info: StoreInfo) => CommandResult;
}

const CASES: Record<Command['type'], () => Prepared> = {
  tapPallet: () => {
    const { s, info } = base();
    const id = s.pallets[0]!.id;
    // dziś interfejs podaje `combo` (przy pierwszym stuknięciu ×1) i nic nie liczy w stanie; seria jest nowa
    return { s, info, cmd: { type: 'tapPallet', palletId: id }, legacy: (b, i) => { const r = tapPallet(b, i, id, 1); if (r.ok) commitTap(b); return r; } };
  },
  tapTill: () => {
    const { s, info } = base();
    s.queue = 3;
    return { s, info, cmd: { type: 'tapTill' }, legacy: (b, i) => { const r = tapTill(b, i, 1); if (r.ok) commitTap(b); return r; } };
  },
  movePallet: () => {
    const { s, info } = base();
    const p = s.pallets[0]!;
    const loc = (['backroom', 'floor', 'sidewalk'] as const).find((l) => l !== p.loc && freeSpots(s, info, l) > 0)!;
    return { s, info, cmd: { type: 'movePallet', palletId: p.id, loc }, legacy: (b, i) => movePallet(b, i, p.id, loc) };
  },
  returnPallet: () => {
    // od SIM_VERSION 5 tylko odmowa (dzienniki z SIM 4): stan zostaje, jak bez polecenia
    const { s, info } = base();
    const id = s.pallets[0]!.id;
    return { s, info, cmd: { type: 'returnPallet', palletId: id }, legacy: () => ({ ok: false, text: 'Centrala nie przyjmuje zwrotów: każda paleta zostaje w sklepie.' }) };
  },
  setOrder: () => {
    const { s, info } = base();
    return { s, info, cmd: { type: 'setOrder', auto: false, manual: 12 }, legacy: (b) => { setOrder(b, false, 12); return { ok: true }; } };
  },
  hire: () => {
    const { s, info } = base();
    s.cash = 10 * HIRE_COST;
    return { s, info, cmd: { type: 'hire' }, legacy: (b) => hire(b) };
  },
  fire: () => {
    const { s, info } = base();
    s.staff = 3;
    return { s, info, cmd: { type: 'fire' }, legacy: (b) => fire(b) };
  },
  setStaffProfile: () => {
    const { s, info } = base();
    return { s, info, cmd: { type: 'setStaffProfile', profile: 'dostawa' }, legacy: (b) => setStaffProfile(b.tycoon.staff, 'dostawa') };
  },
  pinStaff: () => {
    const { s, info } = base();
    return { s, info, cmd: { type: 'pinStaff', task: 'kasa', count: 1 }, legacy: (b) => pinStaff(b.tycoon.staff, 'kasa', 1, b.staff) };
  },
  buyUpgrade: () => {
    const { s, info } = base();
    s.cash = 1_000_000;
    return { s, info, cmd: { type: 'buyUpgrade', id: 'szkolenie' }, legacy: (b) => buyUpgrade(b, 'szkolenie') };
  },
  buyEquipment: () => {
    const { s, info } = base();
    s.cash = 1_000_000;
    const slotId = info.slots[0]!.id;
    return { s, info, cmd: { type: 'buyEquipment', id: 'sco', slotId }, legacy: (b, i) => buyEquipment(b, i, 'sco', slotId) };
  },
  startRemont: () => {
    const { s, info } = base();
    s.level = 8;
    s.cash = 1_000_000;
    // piec w ostatnim slocie: dopiero `relayout` po remoncie przenosi go na pierwszy slot 2×2, więc brak przebudowy byłby widać
    buyEquipment(s, info, 'piec', info.slots[info.slots.length - 1]!.id);
    return { s, info, cmd: { type: 'startRemont' }, legacy: (b) => startRemont(b) };
  },
  campaign: () => {
    const { s, info } = base();
    s.ogonki = 100;
    return { s, info, cmd: { type: 'campaign' }, legacy: (b) => campaign(b) };
  },
  answerCard: () => {
    // karta czeka na odpowiedź od tej minuty; interfejs podaje odpowiedź zaznaczoną z góry
    const { s, info } = base();
    const card = s.tycoon.cards.pending[0]!;
    card.showAt = s.minute;
    return { s, info, cmd: { type: 'answerCard', seq: card.seq, answer: card.defaultAnswer }, legacy: (b) => answerCard(b, card.seq, card.defaultAnswer, []) };
  },
  claimMilestone: () => {
    const { s, info } = base();
    s.milestonesReady = ['pallet1'];
    return { s, info, cmd: { type: 'claimMilestone', id: 'pallet1' }, legacy: (b) => claimMilestone(b, 'pallet1') };
  },
  rushRemont: () => {
    // remont w toku: sklep już ma układ po remoncie, tak jak po `startRemont` i przebudowie w sesji
    const { s } = base();
    s.level = 8;
    s.cash = 1_000_000;
    s.ogonki = 100;
    startRemont(s);
    const info = computeStoreInfo(layoutFor(SEED, s.remontLevel));
    relayout(s, info);
    return { s, info, cmd: { type: 'rushRemont' }, legacy: (b) => rushRemont(b) };
  },
};

/** To, co dawny `main.ts` robił po każdym poleceniu: poziomy, a po remoncie nowy układ i przeniesienie palet (`syncLayout`). */
function legacyAfter(s: EconomyState, layoutLevel: number): void {
  processLevels(s, []);
  if (s.remontLevel === layoutLevel) return;
  relayout(s, computeStoreInfo(layoutFor(s.seed, s.remontLevel)));
}

describe('każdy typ polecenia daje ten sam stan co dzisiejsza ścieżka main.ts', () => {
  it('COMMAND_TYPES to dokładnie typy z unii (przygotowanie jest dla każdego)', () => {
    expect([...COMMAND_TYPES].sort()).toEqual(Object.keys(CASES).sort());
    expect(new Set(COMMAND_TYPES).size).toBe(COMMAND_TYPES.length);
  });

  it.each(COMMAND_TYPES)('%s', (type) => {
    const a = CASES[type]();
    const b = CASES[type]();
    expect(snapshot(a.s), 'przygotowanie jest deterministyczne').toBe(snapshot(b.s));

    const layoutLevel = b.s.remontLevel;
    const out = applyCommand(a.s, a.info, a.cmd);
    const legacyResult = b.legacy(b.s, b.info);
    legacyAfter(b.s, layoutLevel);

    expect(legacyResult.ok, 'przygotowanie ma doprowadzić do powodzenia').toBe(type !== 'returnPallet');
    expect(out.result).toEqual(legacyResult);
    expect(snapshot(a.s)).toBe(snapshot(b.s));
  });
});

/** Pola polecenia (`typ.pole`), których wartość nie jest tekstem, liczbą, wartością logiczną ani `undefined` (tablica, obiekt, `null`, funkcja…). */
function nestedFields(cmd: object): string[] {
  const type = (cmd as { type: unknown }).type;
  return Object.entries(cmd)
    .filter(([, value]) => !['string', 'number', 'boolean', 'undefined'].includes(typeof value) || value === null)
    .map(([key]) => `${String(type)}.${key}`);
}

describe('polecenia są płaskie: dziennik i applyCommand kopiują je płytko', () => {
  // Gdy ten test pęka: nowe pole nie jest prostą wartością. Kopia `{ ...cmd }` w `dispatchCommand` i `applyCommand` dzieliłaby wtedy
  // referencję ze stanem albo z obiektem interfejsu, a późniejsza zmiana po cichu przepisałaby dziennik (i `replayRun` rozjechałby
  // się ze stanem). Albo zostaw pole płaskie, albo skopiuj je głęboko w `dispatchCommand` i `applyCommand` oraz sprawdź je w `isCommand`.
  it.each(COMMAND_TYPES)('%s: każde pole to string, number, boolean albo undefined', (type) => {
    const { cmd } = CASES[type]();
    expect(nestedFields(cmd), `pola ${type} poza prostymi wartościami: patrz komentarz nad tym testem i nad typem Command`).toEqual([]);
  });

  it('wykrywa tablicę, obiekt, null i funkcję (kontrola nie jest pusta)', () => {
    expect(nestedFields({ type: 'x', order: ['a'], nested: { a: 1 }, nothing: null, fn: () => 1 }))
      .toEqual(['x.order', 'x.nested', 'x.nothing', 'x.fn']);
    expect(nestedFields({ type: 'x', n: 1, s: 'a', b: false, u: undefined })).toEqual([]);
  });

  it('przypadki testowe ustawiają pola opcjonalne, więc kontrola obejmuje wszystkie pola', () => {
    // pole pominięte w `CASES` byłoby poza kontrolą na wartościach (kompilator i tak sprawdza typ)
    expect(CASES.tapPallet().cmd).toHaveProperty('palletId');
    expect(CASES.setOrder().cmd).toHaveProperty('manual');
    expect(CASES.buyEquipment().cmd).toHaveProperty('slotId');
  });
});

describe('stuknięcia w serii', () => {
  it('4. stuknięcie rozładowuje 2× tyle co 1.', () => {
    const { s, info } = base();
    const id = s.pallets[0]!.id;
    const moved: number[] = [];
    for (let n = 1; n <= 8; n++) {
      const out = applyCommand(s, info, { type: 'tapPallet', palletId: id });
      expect(out.result.ok, `stuknięcie ${n}`).toBe(true);
      moved.push((out.result as { value: number }).value);
      expect(s.tapStreak).toBe(n);
    }
    expect(moved[1]).toBeCloseTo(moved[0]!, 9);
    expect(moved[2]).toBeCloseTo(moved[0]!, 9);
    expect(moved[3]).toBeCloseTo(2 * moved[0]!, 9);   // 4.: ×2
    expect(moved[6]).toBeCloseTo(2 * moved[0]!, 9);
    expect(moved[7]).toBeCloseTo(3 * moved[0]!, 9);   // 8.: ×3
  });

  it('przerwa dłuższa niż okno combo zaczyna serię od nowa', () => {
    const { s, info } = base();
    const id = s.pallets[0]!.id;
    for (let n = 0; n < 5; n++) applyCommand(s, info, { type: 'tapPallet', palletId: id });
    expect(s.tapStreak).toBe(5);
    s.minute += 60;
    const out = applyCommand(s, info, { type: 'tapPallet', palletId: id });
    expect(out.result.ok).toBe(true);
    expect(s.tapStreak).toBe(1);
  });

  it('nieudane stuknięcie nie liczy się do serii', () => {
    const { s, info } = base();
    const id = s.pallets[0]!.id;
    for (let n = 0; n < 3; n++) applyCommand(s, info, { type: 'tapPallet', palletId: id });
    expect(s.tapStreak).toBe(3);

    const failedTill = applyCommand(s, info, { type: 'tapTill' });   // kolejka pusta
    expect(failedTill.result.ok).toBe(false);
    const failedPallet = applyCommand(s, info, { type: 'tapPallet', palletId: 999 });   // takiej palety nie ma
    expect(failedPallet.result.ok).toBe(false);
    expect(s.tapStreak).toBe(3);
    expect(s.lastTapAt).toBe(s.minute);

    const fourth = applyCommand(s, info, { type: 'tapPallet', palletId: id });
    expect(fourth.result.ok).toBe(true);
    expect(s.tapStreak).toBe(4);   // gdyby nieudane się liczyły, byłoby 6

    // seria, która dopiero ma się zacząć, też nie rusza się od samej odmowy
    const fresh = base();
    fresh.s.pallets = [];
    const none = applyCommand(fresh.s, fresh.info, { type: 'tapPallet' });
    expect(none.result.ok).toBe(false);
    expect(fresh.s.tapStreak).toBe(0);
    expect(fresh.s.lastTapAt).toBe(-1e9);
  });

  it('stuknięcie w kasę też ciągnie serię i mnoży obsłużonych klientów', () => {
    const { s, info } = base();
    s.queue = 20;
    for (let n = 1; n <= 4; n++) {
      const out = applyCommand(s, info, { type: 'tapTill' });
      expect(out.result.ok, `stuknięcie ${n}`).toBe(true);
    }
    expect(s.tapStreak).toBe(4);
    expect(s.queue).toBe(20 - 1 - 1 - 1 - 2);   // 4. stuknięcie obsługuje dwóch klientów naraz
  });

  it('złota paleta: zdarzenie trafia do events, a nie do result.text', () => {
    const { s, info } = base();
    const p = s.pallets[0]!;
    p.golden = true;
    for (const c of Object.keys(p.items) as (keyof typeof p.items)[]) p.items[c] = 0;
    p.items.napoje = 1;   // jedno stuknięcie opróżnia paletę
    p.total = 1;

    const out = applyCommand(s, info, { type: 'tapPallet', palletId: p.id });
    expect(out.result.ok).toBe(true);
    expect((out.result as { text?: string }).text).toBeUndefined();
    expect(out.events.filter((e) => e.kind === 'golden')).toHaveLength(1);
    expect(out.events.find((e) => e.kind === 'golden')!.text).toContain('Złota paleta rozładowana');
  });

  it('tapPallet bez `out` zwraca tekst złotej palety w wyniku, jak dotąd', () => {
    const { s, info } = base();
    const p = s.pallets[0]!;
    p.golden = true;
    for (const c of Object.keys(p.items) as (keyof typeof p.items)[]) p.items[c] = 0;
    p.items.napoje = 1;
    p.total = 1;

    const r = tapPallet(s, info, p.id, 1);
    expect(r.ok).toBe(true);
    expect((r as { text?: string }).text).toContain('Złota paleta rozładowana');
  });
});

describe('poziomy', () => {
  it('XP z polecenia od razu podnosi poziom (processLevels) i zdarzenie levelup jest w events', () => {
    const { s, info } = base();
    s.cash = 1_000_000;
    s.xp = xpToNext(1) - 1;   // zakup daje 20 XP
    const out = applyCommand(s, info, { type: 'buyUpgrade', id: 'szkolenie' });
    expect(out.result.ok).toBe(true);
    expect(s.level).toBe(2);
    expect(s.xp).toBeLessThan(xpToNext(2));
    const ups = out.events.filter((e) => e.kind === 'levelup');
    expect(ups).toHaveLength(1);
    expect(ups[0]!.level).toBe(2);
    expect(out.layoutChanged).toBe(false);
  });

  it('nieudane polecenie też przelicza poziomy', () => {
    const { s, info } = base();
    s.staff = 1;
    s.xp = xpToNext(1) + 3;
    const out = applyCommand(s, info, { type: 'fire' });
    expect(out.result.ok).toBe(false);
    expect(s.level).toBe(2);
    expect(out.events.some((e) => e.kind === 'levelup')).toBe(true);
  });
});

describe('remont', () => {
  it('layoutChanged, nowy układ = layoutFor(seed, 1), palety i sprzęt mają miejsca w nowym układzie', () => {
    const { s, info } = base();
    s.level = 8;
    s.cash = 1_000_000;
    const lastSlot = info.slots[info.slots.length - 1]!.id;
    expect(applyCommand(s, info, { type: 'buyEquipment', id: 'sco' }).result.ok).toBe(true);
    expect(applyCommand(s, info, { type: 'buyEquipment', id: 'piec', slotId: lastSlot }).result.ok).toBe(true);
    expect(s.pallets.length).toBeGreaterThan(0);
    expect(s.equipment.length).toBe(2);

    const out = applyCommand(s, info, { type: 'startRemont' });
    expect(out.result.ok).toBe(true);
    expect(out.layoutChanged).toBe(true);
    expect(s.remontLevel).toBe(1);

    const expected = layoutFor(SEED, 1);
    expect(out.layout).toEqual(expected);
    expect(out.info).toEqual(computeStoreInfo(expected));
    expect(out.info).not.toEqual(info);

    for (const p of s.pallets) expect(out.info!.spots[p.loc][p.spot], `paleta ${p.id} w ${p.loc}`).toBeDefined();
    expect(s.equipment).toHaveLength(2);
    for (const e of s.equipment) {
      expect(e.slot, `sprzęt ${e.id}`).not.toBeNull();
      expect(out.info!.slots.some((x) => x.id === e.slot), `slot ${e.slot}`).toBe(true);
    }
    // sprzęt ustawiony od nowa w nowym układzie (`relayout`): piec wraca z ostatniego slotu na pierwszy slot 2×2
    expect(s.equipment.find((e) => e.id === 'piec')!.slot).toBe(out.info!.slots.find((x) => x.capacity === 2)!.id);
  });

  it('zwykłe polecenie nie przebudowuje układu i nie zwraca layout ani info', () => {
    const { s, info } = base();
    const out = applyCommand(s, info, { type: 'setStaffProfile', profile: 'porzadek' });
    expect(out.result.ok).toBe(true);
    expect(s.tycoon.staff.profile).toBe('porzadek');
    expect(out.layoutChanged).toBe(false);
    expect(out.layout).toBeUndefined();
    expect(out.info).toBeUndefined();
  });

  it('nieudany remont (za mało gotówki) nie zmienia układu', () => {
    const { s, info } = base();
    s.level = 8;
    s.cash = 100;
    const out = applyCommand(s, info, { type: 'startRemont' });
    expect(out.result.ok).toBe(false);
    expect(out.layoutChanged).toBe(false);
    expect(s.remontLevel).toBe(0);
  });
});

describe('polecenia puli ludzi', () => {
  it('setStaffProfile ustawia profil i kolejność zadań w stanie tycoona', () => {
    const { s, info } = base();
    expect(s.tycoon.staff.profile).toBe('kolejka');
    const out = applyCommand(s, info, { type: 'setStaffProfile', profile: 'dostawa' });
    expect(out.result.ok).toBe(true);
    expect(s.tycoon.staff.profile).toBe('dostawa');
    expect(s.tycoon.staff.order[0]).toBe('rozladunek');
  });

  it('pinStaff przypina osoby, a więcej niż jest na zmianie to odmowa bez zmiany stanu', () => {
    const { s, info } = base();
    s.staff = 3;
    expect(applyCommand(s, info, { type: 'pinStaff', task: 'kasa', count: 2 }).result.ok).toBe(true);
    expect(s.tycoon.staff.pinned.kasa).toBe(2);
    const before = snapshot(s);
    const refused = applyCommand(s, info, { type: 'pinStaff', task: 'rozladunek', count: 2 });   // 2 + 2 > 3
    expect(refused.result.ok).toBe(false);
    expect(snapshot(s)).toBe(before);
    expect(applyCommand(s, info, { type: 'pinStaff', task: 'kasa', count: 0 }).result.ok).toBe(true);   // zdjęcie przydziału
    expect(s.tycoon.staff.pinned.kasa).toBe(0);
  });

  it('zwolnienie po przypięciu wszystkich przycina przypiętych', () => {
    const { s, info } = base();
    s.staff = 3;
    expect(applyCommand(s, info, { type: 'pinStaff', task: 'kasa', count: 3 }).result.ok).toBe(true);
    expect(applyCommand(s, info, { type: 'fire' }).result.ok).toBe(true);
    expect(s.staff).toBe(2);
    expect(s.tycoon.staff.pinned.kasa).toBe(2);
  });
});

describe('zepsute polecenia', () => {
  const BROKEN: unknown[] = [
    { type: 'nuke' },
    { type: 'buyUpgrade', id: 'toString' },
    { type: 'buyUpgrade', id: '__proto__' },
    { type: 'buyEquipment', id: 'x' },
    { type: 'movePallet', palletId: 1, loc: 'roof' },
    { type: 'setPriority', priority: 'palety' },
    { type: 'claimGift' },   // paczka od Centrali zniknęła; stare dzienniki odpadają jako nieznane polecenie
    { type: 'claimQuest', questId: 1 },   // zlecenia Centrali zastąpiło KPI tygodnia (bez odbioru): to samo
    { type: 'setStaffProfile', profile: 'all' },
    { type: 'setStaffProfile', profile: '__proto__' },
    { type: 'pinStaff', task: 'kawa', count: 1 },
    { type: 'pinStaff', task: 'kasa', count: 1.5 },
    { type: 'setOrder', auto: 'yes' },
    { type: 'setOrder', auto: true, manual: NaN },
    { type: 'tapPallet', palletId: 1.5 },
    null,
    'tapTill',
    [],
  ];

  it.each(BROKEN.map((cmd) => [inspect(cmd), cmd] as const))('%s: odmowa bez zmiany stanu i bez wyjątku', (_label, cmd) => {
    const { s, info } = base();
    s.xp = xpToNext(1) + 5;   // gdyby odmowa wołała processLevels, poziom by się zmienił
    const before = snapshot(s);
    let out!: ReturnType<typeof applyCommand>;
    expect(() => { out = applyCommand(s, info, cmd as Command); }).not.toThrow();
    expect(out.result).toEqual({ ok: false, text: 'Nieznane polecenie.' });
    expect(out.events).toEqual([]);
    expect(out.layoutChanged).toBe(false);
    expect(snapshot(s)).toBe(before);
  });

  it('po końcu gry każde polecenie jest odrzucane', () => {
    for (const type of COMMAND_TYPES) {
      const { s, info, cmd } = CASES[type]();
      s.gameOver = true;
      s.xp = xpToNext(1) + 5;
      const before = snapshot(s);
      const out = applyCommand(s, info, cmd);
      expect(out.result, type).toEqual({ ok: false, text: 'Gra skończona: Centrala wypowiedziała umowę.' });
      expect(out.events, type).toEqual([]);
      expect(out.layoutChanged, type).toBe(false);
      expect(snapshot(s), type).toBe(before);
    }
  });

  describe('polecenie z getterem, którego type zmienia się między odczytami (tylko obiekt spoza JSON-a)', () => {
    /** Polecenie, którego kolejne odczyty `type` dają kolejne `types` (ostatni zostaje); `reads()` mówi, ile razy je odczytano. */
    function flipping(...types: string[]): { cmd: Command; reads: () => number } {
      let reads = 0;
      const cmd = { get type() { return types[Math.min(reads++, types.length - 1)]; } } as unknown as Command;
      return { cmd, reads: () => reads };
    }

    it('hire, hire, potem fire: o poleceniu rozstrzyga pierwszy odczyt, więc wykonuje się tylko hire', () => {
      const { s, info } = base();
      s.cash = 10 * HIRE_COST;
      const staff = s.staff;
      const { cmd, reads } = flipping('hire', 'hire', 'fire');
      const out = applyCommand(s, info, cmd);
      expect(reads()).toBe(1);
      expect(out.result).toEqual({ ok: true });
      expect(s.staff).toBe(staff + 1);
    });

    it('poprawny typ, potem nieznany: odczyt jest jeden, więc polecenie się wykonuje, a nie kończy brakiem wyniku', () => {
      const { s, info } = base();
      s.cash = 10 * HIRE_COST;
      const staff = s.staff;
      const { cmd, reads } = flipping('hire', 'nuke');
      const out = applyCommand(s, info, cmd);
      expect(reads()).toBe(1);
      expect(out.result).toEqual({ ok: true });
      expect(s.staff).toBe(staff + 1);
    });
  });
});

describe('isCommand', () => {
  it('przyjmuje poprawne polecenia każdego typu, także z dodatkowymi kluczami', () => {
    const valid: unknown[] = [
      { type: 'tapPallet' },
      { type: 'tapPallet', palletId: 3 },
      { type: 'tapPallet', palletId: undefined },
      { type: 'tapTill' },
      { type: 'movePallet', palletId: 1, loc: 'sidewalk' },
      { type: 'movePallet', palletId: 1, loc: 'backroom' },
      { type: 'movePallet', palletId: 1, loc: 'floor' },
      { type: 'movePallet', palletId: 1, loc: 'aisle' },   // poprawny kształt; odmawia dopiero `movePallet`
      { type: 'returnPallet', palletId: 2 },
      { type: 'claimMilestone', id: 'pallet1' },
      { type: 'setOrder', auto: true },
      { type: 'setOrder', auto: false, manual: 12.4 },
      { type: 'hire' },
      { type: 'fire' },
      { type: 'setStaffProfile', profile: 'kolejka' },
      { type: 'setStaffProfile', profile: 'dostawa' },
      { type: 'setStaffProfile', profile: 'porzadek' },
      { type: 'pinStaff', task: 'kasa', count: 1 },
      { type: 'pinStaff', task: 'rozladunek', count: 0 },
      { type: 'pinStaff', task: 'sprzatanie', count: 100 },   // górną granicę sprawdza dopiero stan (pinStaff odmawia)
      { type: 'buyUpgrade', id: 'wozek' },
      { type: 'buyEquipment', id: 'piec' },
      { type: 'buyEquipment', id: 'sco', slotId: 'slot-1' },
      { type: 'startRemont' },
      { type: 'campaign' },
      { type: 'rushRemont' },
      { type: 'answerCard', seq: 12, answer: 0 },
      { type: 'answerCard', seq: 0, answer: 2 },
      { type: 'hire', note: 'zbędny klucz' },
    ];
    for (const cmd of valid) expect(isCommand(cmd), inspect(cmd)).toBe(true);
    // każdy typ z unii ma co najmniej jeden poprawny przykład
    for (const type of COMMAND_TYPES) expect(valid.some((c) => (c as { type: string }).type === type), type).toBe(true);
  });

  it('odrzuca zły kształt i typy pól', () => {
    const invalid: unknown[] = [
      undefined, 0, 1, true, '', {}, { type: 1 }, { type: 'toString' }, { type: '__proto__' }, { type: 'constructor' },
      { type: 'tapPallet', palletId: '1' }, { type: 'tapPallet', palletId: null }, { type: 'tapPallet', palletId: NaN },
      { type: 'tapPallet', palletId: Infinity }, { type: 'claimQuest', questId: 1 }, { type: 'claimQuest' },   // zlecenia zniknęły
      { type: 'movePallet', palletId: 1 }, { type: 'movePallet', loc: 'floor' },
      { type: 'movePallet', palletId: 1, loc: 'constructor' }, { type: 'returnPallet' }, { type: 'returnPallet', palletId: NaN },
      { type: 'claimMilestone' }, { type: 'claimMilestone', id: 1 }, { type: 'claimMilestone', id: 'nie-ma' }, { type: 'claimMilestone', id: 'toString' },
      { type: 'setOrder' }, { type: 'setOrder', auto: 1 }, { type: 'setOrder', auto: true, manual: '4' },
      { type: 'setOrder', auto: true, manual: Infinity }, { type: 'setOrder', auto: true, manual: null },
      { type: 'setPriority' }, { type: 'setPriority', priority: 'rowno' },   // dawny priorytet pracy: polecenie znikło
      { type: 'setStaffProfile' }, { type: 'setStaffProfile', profile: 'toString' }, { type: 'setStaffProfile', profile: '__proto__' },
      { type: 'setStaffProfile', profile: 'wlasny' }, { type: 'setStaffProfile', profile: 1 }, { type: 'setStaffProfile', profile: null },
      { type: 'pinStaff' }, { type: 'pinStaff', task: 'kasa' }, { type: 'pinStaff', count: 1 },
      { type: 'pinStaff', task: 'kawa', count: 1 }, { type: 'pinStaff', task: '__proto__', count: 1 },
      { type: 'pinStaff', task: 'toString', count: 1 }, { type: 'pinStaff', task: 1, count: 1 },
      { type: 'pinStaff', task: 'kasa', count: NaN }, { type: 'pinStaff', task: 'kasa', count: Infinity },
      { type: 'pinStaff', task: 'kasa', count: -1 }, { type: 'pinStaff', task: 'kasa', count: 1.5 },
      { type: 'pinStaff', task: 'kasa', count: '2' }, { type: 'pinStaff', task: 'kasa', count: null },
      { type: 'buyUpgrade' }, { type: 'buyUpgrade', id: 5 }, { type: 'buyUpgrade', id: 'constructor' },
      { type: 'buyUpgrade', id: 'sco' }, { type: 'buyEquipment', id: 'szkolenie' }, { type: 'buyEquipment', id: 'toString' },
      { type: 'buyEquipment', id: 'sco', slotId: 5 }, { type: 'buyEquipment', id: 'sco', slotId: null },
      { type: 'answerCard' }, { type: 'answerCard', seq: 1 }, { type: 'answerCard', answer: 0 },
      { type: 'answerCard', seq: '1', answer: 0 }, { type: 'answerCard', seq: 1, answer: '0' }, { type: 'answerCard', seq: 1.5, answer: 0 },
      { type: 'answerCard', seq: 1, answer: 0.5 }, { type: 'answerCard', seq: NaN, answer: 0 }, { type: 'answerCard', seq: 1, answer: Infinity },
      { type: 'answerCard', seq: null, answer: 0 }, { type: 'answerCard', seq: 1, answer: null },
      { type: 'card.answer', seq: 1, answer: 0 },   // nazwa z INTEGRATION.md; w kodzie poleceń są w camelCase
    ];
    for (const cmd of invalid) expect(isCommand(cmd), inspect(cmd)).toBe(false);
  });

  it('odrzuca polecenie po przejściu przez JSON z nieskończoną liczbą (null)', () => {
    const roundTrip = JSON.parse(JSON.stringify({ type: 'setOrder', auto: true, manual: Infinity })) as unknown;
    expect(isCommand(roundTrip)).toBe(false);
  });
});

describe('karta na biurku', () => {
  /** Karta widoczna od tej minuty: gra czeka na odpowiedź. */
  function withCard(): { s: EconomyState; info: StoreInfo; seq: number; answer: number } {
    const { s, info } = base();
    s.queue = 5;
    const card = s.tycoon.cards.pending[0]!;
    card.showAt = s.minute;
    return { s, info, seq: card.seq, answer: card.defaultAnswer };
  }

  it.each(['tapPallet', 'tapTill'] as const)('%s: póki karta czeka, odmowa „Najpierw karta na biurku.” bez zmiany stanu', (type) => {
    const { s, info } = withCard();
    expect(awaitingDecision(s)).toBe(true);
    const before = snapshot(s);
    const out = applyCommand(s, info, { type });
    expect(out.result).toEqual({ ok: false, text: 'Najpierw karta na biurku.' });
    expect(out.events).toEqual([]);
    expect(snapshot(s)).toBe(before);
    expect(s.tapStreak).toBe(0);   // odmowa nie podtrzymuje serii
  });

  it('po odpowiedzi na wszystkie widoczne karty stuknięcia znów działają', () => {
    const { s, info } = withCard();
    for (const c of visibleCards(s.tycoon.cards, s.minute)) {
      expect(applyCommand(s, info, { type: 'answerCard', seq: c.seq, answer: c.defaultAnswer }).result.ok).toBe(true);
    }
    expect(awaitingDecision(s)).toBe(false);
    expect(applyCommand(s, info, { type: 'tapTill' }).result.ok).toBe(true);
  });

  it('pozostałe polecenia przechodzą mimo karty (kupowanie, ludzie, zamówienia)', () => {
    const { s, info } = withCard();
    s.cash = 1_000_000;
    for (const cmd of [
      { type: 'setOrder', auto: false, manual: 3 }, { type: 'setStaffProfile', profile: 'dostawa' }, { type: 'hire' },
      { type: 'buyUpgrade', id: 'szkolenie' },
    ] as Command[]) expect(applyCommand(s, info, cmd).result.ok, cmd.type).toBe(true);
    expect(awaitingDecision(s)).toBe(true);
  });

  it('answerCard: odpowiedź księguje skutek i daje zdarzenie z wynikiem; poziom z XP karty liczy się od razu', () => {
    const { s, info, seq, answer } = withCard();
    s.xp = xpToNext(s.level) - 5;   // dziesięć XP za kartę przeskakuje poziom
    const out = applyCommand(s, info, { type: 'answerCard', seq, answer });
    expect(out.result).toEqual({ ok: true });
    expect(s.level).toBe(2);
    expect(out.events.some((e) => e.kind === 'levelup')).toBe(true);
    expect(out.events.some((e) => e.kind === 'card-result')).toBe(true);
  });

  it('zła odpowiedź przez applyCommand: odmowa z tekstem karty, stan nietknięty', () => {
    const { s, info, seq } = withCard();
    const before = snapshot(s);
    for (const cmd of [
      { type: 'answerCard', seq: 123456, answer: 0 }, { type: 'answerCard', seq, answer: 99 }, { type: 'answerCard', seq, answer: -1 },
      { type: 'answerCard', seq: 1.5, answer: 0 },
    ] as Command[]) {
      const out = applyCommand(s, info, cmd);
      expect(out.result.ok, JSON.stringify(cmd)).toBe(false);
      expect(snapshot(s)).toBe(before);
    }
  });

  it('po końcu gry karta nie zatrzymuje i nie przyjmuje odpowiedzi', () => {
    const { s, info, seq, answer } = withCard();
    s.gameOver = true;
    expect(awaitingDecision(s)).toBe(false);
    const before = snapshot(s);
    expect(applyCommand(s, info, { type: 'answerCard', seq, answer }).result.ok).toBe(false);
    expect(snapshot(s)).toBe(before);
  });
});
