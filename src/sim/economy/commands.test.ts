import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { layoutFor } from '@/sim/store/layoutFor';
import { GIFT_OPEN, HIRE_COST } from './catalog';
import { applyCommand, COMMAND_TYPES, isCommand, type Command } from './commands';
import {
  buyEquipment, buyUpgrade, campaign, claimGift, claimQuest, commitTap, createEconomy, fire, freeSpots, hire, movePallet,
  processLevels, relayout, returnPallet, rushRemont, scheduleGift, setOrder, setPriority, startRemont, tapPallet, tapTill,
  type CommandResult, type EconomyState,
} from './economy';
import { questMetric } from './quests';
import { computeStoreInfo, type StoreInfo } from './storeInfo';
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
  claimQuest: () => {
    const { s, info } = base();
    const q = s.quests[0]!;
    q.start = questMetric(s, q.kind) - q.target - 1;   // cel już spełniony
    return { s, info, cmd: { type: 'claimQuest', questId: q.id }, legacy: (b, i) => claimQuest(b, i, q.id) };
  },
  claimGift: () => {
    const { s, info } = base();
    s.minute = s.giftAt;   // okno paczki otwarte
    // dziś okno gasił licznik w interfejsie; w stanie gry odbiór planuje następne okno
    return { s, info, cmd: { type: 'claimGift' }, legacy: (b, i) => { const r = claimGift(b, i); scheduleGift(b); return r; } };
  },
  movePallet: () => {
    const { s, info } = base();
    const p = s.pallets[0]!;
    const loc = (['backroom', 'floor', 'sidewalk'] as const).find((l) => l !== p.loc && freeSpots(s, info, l) > 0)!;
    return { s, info, cmd: { type: 'movePallet', palletId: p.id, loc }, legacy: (b, i) => movePallet(b, i, p.id, loc) };
  },
  returnPallet: () => {
    const { s, info } = base();
    const id = s.pallets[0]!.id;
    return { s, info, cmd: { type: 'returnPallet', palletId: id }, legacy: (b) => returnPallet(b, id) };
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
  setPriority: () => {
    const { s, info } = base();
    return { s, info, cmd: { type: 'setPriority', priority: 'palety' }, legacy: (b) => { setPriority(b, 'palety'); return { ok: true }; } };
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

/** To, co `main.ts` robi po każdym poleceniu: poziomy, a po remoncie nowy układ i przeniesienie palet (`syncLayout`). */
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

    expect(legacyResult.ok, 'przygotowanie ma doprowadzić do powodzenia').toBe(true);
    expect(out.result).toEqual(legacyResult);
    expect(snapshot(a.s)).toBe(snapshot(b.s));
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

describe('paczka od Centrali', () => {
  it('poza oknem odmowa bez zmiany stanu; w oknie raz, drugi odbiór w tym samym oknie odmowa', () => {
    const { s, info } = base();
    s.xp = xpToNext(1) + 5;   // gdyby odmowa wołała processLevels, poziom by się zmienił

    // przed oknem
    expect(s.minute).toBeLessThan(s.giftAt);
    let before = snapshot(s);
    let out = applyCommand(s, info, { type: 'claimGift' });
    expect(out.result).toEqual({ ok: false, text: 'Paczki od Centrali już nie ma.' });
    expect(out.events).toEqual([]);
    expect(out.layoutChanged).toBe(false);
    expect(snapshot(s)).toBe(before);

    // po oknie
    s.minute = s.giftAt + GIFT_OPEN;
    before = snapshot(s);
    out = applyCommand(s, info, { type: 'claimGift' });
    expect(out.result.ok).toBe(false);
    expect(snapshot(s)).toBe(before);

    // w oknie: odbiór raz
    s.minute = s.giftAt;
    const window = s.giftAt;
    const seq = s.giftSeq;
    out = applyCommand(s, info, { type: 'claimGift' });
    expect(out.result.ok).toBe(true);
    expect(s.giftSeq).toBe(seq + 1);
    expect(s.giftAt).toBeGreaterThan(window);   // następne okno zaplanowane

    // drugi odbiór w tej samej minucie
    before = snapshot(s);
    out = applyCommand(s, info, { type: 'claimGift' });
    expect(out.result).toEqual({ ok: false, text: 'Paczki od Centrali już nie ma.' });
    expect(snapshot(s)).toBe(before);
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
    const out = applyCommand(s, info, { type: 'setPriority', priority: 'klienci' });
    expect(out.result).toEqual({ ok: true });
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

describe('zepsute polecenia', () => {
  const BROKEN: unknown[] = [
    { type: 'nuke' },
    { type: 'buyUpgrade', id: 'toString' },
    { type: 'buyUpgrade', id: '__proto__' },
    { type: 'buyEquipment', id: 'x' },
    { type: 'movePallet', palletId: 1, loc: 'roof' },
    { type: 'setPriority', priority: 'all' },
    { type: 'setOrder', auto: 'yes' },
    { type: 'setOrder', auto: true, manual: NaN },
    { type: 'claimQuest', questId: '1' },
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
});

describe('isCommand', () => {
  it('przyjmuje poprawne polecenia każdego typu, także z dodatkowymi kluczami', () => {
    const valid: unknown[] = [
      { type: 'tapPallet' },
      { type: 'tapPallet', palletId: 3 },
      { type: 'tapPallet', palletId: undefined },
      { type: 'tapTill' },
      { type: 'claimQuest', questId: 7 },
      { type: 'claimGift' },
      { type: 'movePallet', palletId: 1, loc: 'sidewalk' },
      { type: 'movePallet', palletId: 1, loc: 'backroom' },
      { type: 'movePallet', palletId: 1, loc: 'floor' },
      { type: 'returnPallet', palletId: 2 },
      { type: 'setOrder', auto: true },
      { type: 'setOrder', auto: false, manual: 12.4 },
      { type: 'hire' },
      { type: 'fire' },
      { type: 'setPriority', priority: 'klienci' },
      { type: 'setPriority', priority: 'rowno' },
      { type: 'setPriority', priority: 'palety' },
      { type: 'buyUpgrade', id: 'wozek' },
      { type: 'buyEquipment', id: 'piec' },
      { type: 'buyEquipment', id: 'sco', slotId: 'slot-1' },
      { type: 'startRemont' },
      { type: 'campaign' },
      { type: 'rushRemont' },
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
      { type: 'tapPallet', palletId: Infinity }, { type: 'claimQuest' }, { type: 'claimQuest', questId: 1.5 },
      { type: 'claimQuest', questId: -Infinity }, { type: 'movePallet', palletId: 1 }, { type: 'movePallet', loc: 'floor' },
      { type: 'movePallet', palletId: 1, loc: 'constructor' }, { type: 'returnPallet' }, { type: 'returnPallet', palletId: NaN },
      { type: 'setOrder' }, { type: 'setOrder', auto: 1 }, { type: 'setOrder', auto: true, manual: '4' },
      { type: 'setOrder', auto: true, manual: Infinity }, { type: 'setOrder', auto: true, manual: null },
      { type: 'setPriority' }, { type: 'setPriority', priority: 'toString' }, { type: 'setPriority', priority: 1 },
      { type: 'buyUpgrade' }, { type: 'buyUpgrade', id: 5 }, { type: 'buyUpgrade', id: 'constructor' },
      { type: 'buyUpgrade', id: 'sco' }, { type: 'buyEquipment', id: 'szkolenie' }, { type: 'buyEquipment', id: 'toString' },
      { type: 'buyEquipment', id: 'sco', slotId: 5 }, { type: 'buyEquipment', id: 'sco', slotId: null },
    ];
    for (const cmd of invalid) expect(isCommand(cmd), inspect(cmd)).toBe(false);
  });

  it('odrzuca polecenie po przejściu przez JSON z nieskończoną liczbą (null)', () => {
    const roundTrip = JSON.parse(JSON.stringify({ type: 'setOrder', auto: true, manual: Infinity })) as unknown;
    expect(isCommand(roundTrip)).toBe(false);
  });
});
