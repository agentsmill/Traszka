import { describe, expect, it } from 'vitest';
import { ASSETS } from '@/render/assets';
import { OUTFIT_PAINT, outfitOfPath } from '@/render/characters/modularPack';
import { SIM_STEP, createCrowd, staffStripCells, stepCrowd, type Agent, type AgentState } from '@/sim/crowd/crowd';
import { REMONTS } from '@/sim/economy/upgrades';
import { createRng } from '@/sim/rng';
import { generateStore } from '@/sim/store/generateStore';
import { layoutFor } from '@/sim/store/layoutFor';
import { layoutFromParts, validParts } from '@/sim/store/testLayouts';
import type { Fixture, StoreLayout } from '@/sim/store/types';
import {
  APPEARANCE_SEED_MAX, DEFAULT_CASHIER_LOOK, OUTFIT_ORDER, REGULAR_OUTFITS, SPECIAL_LOOK_CHANCE, SPECIAL_OUTFITS,
  cashierCues, cashierSpot, isCashierLook, isSpecialOutfit, randomCashierLook, rollCashierLook, stepOutfit, type CashierLook,
} from './cashier';

describe('stroje kasjera', () => {
  it('listy strojów zgadzają się z ASSETS (zwykłe i specjalne) i z tabelą OUTFIT_PAINT', () => {
    expect([...REGULAR_OUTFITS]).toEqual(ASSETS.characters.modular.map(outfitOfPath));
    expect([...SPECIAL_OUTFITS]).toEqual(ASSETS.characters.special.map(outfitOfPath));
    expect([...REGULAR_OUTFITS, ...SPECIAL_OUTFITS].sort()).toEqual(Object.keys(OUTFIT_PAINT).sort());
  });

  it('isSpecialOutfit odróżnia stroje specjalne od zwykłych', () => {
    for (const o of SPECIAL_OUTFITS) expect(isSpecialOutfit(o), o).toBe(true);
    for (const o of REGULAR_OUTFITS) expect(isSpecialOutfit(o), o).toBe(false);
  });

  it('DEFAULT_CASHIER_LOOK to poprawny wygląd w stroju zwykłym', () => {
    expect(isCashierLook(DEFAULT_CASHIER_LOOK)).toBe(true);
    expect(isSpecialOutfit(DEFAULT_CASHIER_LOOK.outfit)).toBe(false);
  });
});

describe('randomCashierLook', () => {
  it('daje poprawne wyglądy i jest deterministyczne dla tego samego rng', () => {
    const a = Array.from({ length: 30 }, (_, i) => randomCashierLook(createRng(`k-${i}`)));
    const b = Array.from({ length: 30 }, (_, i) => randomCashierLook(createRng(`k-${i}`)));
    expect(a).toEqual(b);
    for (const look of a) expect(isCashierLook(look), JSON.stringify(look)).toBe(true);
    expect(new Set(a.map((l) => l.appearanceSeed)).size).toBeGreaterThan(25);   // różne losowania, różne twarze
  });

  it('stroje specjalne to okazja: ok. 20% losowań, a z includeSpecial = false nigdy', () => {
    const rng = createRng('losowanie');
    const looks = Array.from({ length: 2000 }, () => randomCashierLook(rng));
    const share = looks.filter((l) => isSpecialOutfit(l.outfit)).length / looks.length;
    expect(SPECIAL_LOOK_CHANCE).toBe(0.2);
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
    expect(new Set(looks.filter((l) => isSpecialOutfit(l.outfit)).map((l) => l.outfit)).size).toBe(SPECIAL_OUTFITS.length);   // każdy może wypaść

    const plainRng = createRng('losowanie');
    const plain = Array.from({ length: 2000 }, () => randomCashierLook(plainRng, false));
    expect(plain.every((l) => !isSpecialOutfit(l.outfit))).toBe(true);
    expect(new Set(plain.map((l) => l.outfit)).size).toBe(REGULAR_OUTFITS.length);
  });

  it('przełącznik nie zmienia reszty losowania: ten sam rng, ten sam seed wyglądu', () => {
    for (let i = 0; i < 50; i++) {
      const withSpecial = randomCashierLook(createRng(`przelacznik-${i}`), true);
      const without = randomCashierLook(createRng(`przelacznik-${i}`), false);
      expect(without.appearanceSeed).toBe(withSpecial.appearanceSeed);
    }
  });
});

describe('isCashierLook', () => {
  const good = { outfit: 'men-suit', appearanceSeed: 'abc' };

  it('przyjmuje poprawny wygląd (także po przejściu przez JSON, jak z zapisu)', () => {
    expect(isCashierLook(good)).toBe(true);
    expect(isCashierLook(JSON.parse(JSON.stringify({ outfit: 'special-women-witch', appearanceSeed: '🦎 x' })))).toBe(true);
    expect(isCashierLook({ ...good, appearanceSeed: 'x'.repeat(APPEARANCE_SEED_MAX) })).toBe(true);
  });

  it('odrzuca wszystko inne: nie-obiekty, nieznany strój, brak albo zły seed', () => {
    for (const bad of [null, undefined, 42, 'men-suit', [], [good], {}, { outfit: 'men-suit' }, { appearanceSeed: 'abc' },
      { outfit: 'men-spy', appearanceSeed: 'abc' }, { outfit: 'MEN-SUIT', appearanceSeed: 'abc' }, { outfit: 7, appearanceSeed: 'abc' },
      { outfit: 'men-suit', appearanceSeed: '' }, { outfit: 'men-suit', appearanceSeed: 5 }, { outfit: 'men-suit', appearanceSeed: null },
      { outfit: 'men-suit', appearanceSeed: 'x'.repeat(APPEARANCE_SEED_MAX + 1) }, { outfit: ['men-suit'], appearanceSeed: 'abc' },
      { outfit: 'toString', appearanceSeed: 'abc' }, { outfit: '__proto__', appearanceSeed: 'abc' }]) {
      expect(isCashierLook(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

const inside = (f: Fixture, c: { x: number; y: number }): boolean => c.x >= f.x && c.x < f.x + f.w && c.y >= f.y && c.y < f.y + f.d;

describe('cashierSpot', () => {
  it('układ testowy: kratka tuż za kasą w wierszu miejsca klienta, wzrok w stronę kasy (front E: heading 0)', () => {
    const layout = layoutFromParts(validParts());   // kasa x=3, y=7..10 frontem na E, kolejka od (4, 8), pas personelu x=2
    expect(cashierSpot(layout)).toEqual({ cell: { x: 2, y: 8 }, heading: 0 });
  });

  /** Sklep z samą kasą `till` i miejscem klienta `head`: reszta układu nie przeszkadza w sprawdzaniu geometrii. */
  const withTill = (till: Partial<Fixture>, head: { x: number; y: number }): StoreLayout => {
    const parts = validParts();
    const checkout = { ...parts.fixtures.find((f) => f.kind === 'checkout')!, ...till };
    return layoutFromParts({ ...parts, fixtures: [checkout], checkoutQueue: [head] });
  };

  it('kasa zwrócona w drugą stronę (front W, lustrzane odbicie sklepu): kasjer stoi po wschodniej stronie i patrzy na zachód', () => {
    expect(cashierSpot(withTill({ x: 12, facing: 'W' }, { x: 11, y: 8 }))).toEqual({ cell: { x: 13, y: 8 }, heading: Math.PI });
  });

  it('front S i N: kasjer stoi nad albo pod kasą, w kolumnie miejsca klienta', () => {
    expect(cashierSpot(withTill({ x: 6, y: 10, w: 4, d: 1, facing: 'S' }, { x: 8, y: 11 }))).toEqual({ cell: { x: 8, y: 9 }, heading: Math.PI / 2 });
    expect(cashierSpot(withTill({ x: 6, y: 10, w: 4, d: 1, facing: 'N' }, { x: 8, y: 9 }))).toEqual({ cell: { x: 8, y: 11 }, heading: -Math.PI / 2 });
  });

  it('null, gdy nie ma kasy, kolejki ani wolnej podłogi za kasą', () => {
    const parts = validParts();
    expect(cashierSpot(layoutFromParts({ ...parts, fixtures: parts.fixtures.filter((f) => f.kind !== 'checkout') }))).toBeNull();
    expect(cashierSpot(layoutFromParts({ ...parts, checkoutQueue: [] }))).toBeNull();
    const walled = layoutFromParts(validParts());
    walled.cells[8 * walled.width + 2] = 'wall';   // za kasą ściana zamiast podłogi
    expect(cashierSpot(walled)).toBeNull();
    const blocked = layoutFromParts(validParts());
    blocked.cells[8 * blocked.width + 2] = 'fixture';
    expect(cashierSpot(blocked)).toBeNull();
  });

  it('200 sklepów z generatora: kratka to podłoga poza meblami, tuż za kasą, w pasie personelu zamkniętym dla klientów, wzrok na kasę', () => {
    const headings = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const seed = `kasjer-miejsce-${i}`;
      const layout = generateStore(seed);
      const spot = cashierSpot(layout);
      expect(spot, seed).not.toBeNull();
      const { cell, heading } = spot!;
      const till = layout.fixtures.find((f) => f.kind === 'checkout')!;
      expect(layout.cells[cell.y * layout.width + cell.x], `${seed}: typ kratki`).toBe('floor');
      expect(layout.fixtures.some((f) => inside(f, cell)), `${seed}: kratka w meblu`).toBe(false);
      expect(cell.y, `${seed}: wiersz miejsca klienta`).toBe(layout.checkoutQueue[0]!.y);
      // kasa leży o jedną kratkę dalej w kierunku wzroku, a front kasy patrzy na klientów, czyli w tę samą stronę
      const ahead = { x: cell.x + Math.round(Math.cos(heading)), y: cell.y + Math.round(Math.sin(heading)) };
      expect(inside(till, ahead), `${seed}: kasjer sąsiaduje z kasą od tyłu`).toBe(true);
      expect(Math.abs(Math.cos(heading)) + Math.abs(Math.sin(heading)), seed).toBeCloseTo(1, 9);
      expect(heading, `${seed}: front kasy ${till.facing}`).toBeCloseTo(till.facing === 'E' ? 0 : Math.PI, 9);
      const strip = new Set(staffStripCells(layout).map((c) => `${c.x},${c.y}`));
      expect(strip.has(`${cell.x},${cell.y}`), `${seed}: pas personelu (klienci tam nie wchodzą)`).toBe(true);
      headings.add(heading);
    }
    expect([...headings].sort()).toEqual([0, Math.PI]);   // generator odbija sklep: kasa raz na zachodzie, raz na wschodzie
  });

  it('po każdym remoncie (większy sklep z tego samego seeda) kasjer też ma swoje miejsce w pasie personelu', () => {
    for (const seed of ['kasjer-remont-1', 'kasjer-remont-2', 'kasjer-remont-3']) {
      for (let level = 0; level <= REMONTS.length; level++) {
        const layout = layoutFor(seed, level);
        const spot = cashierSpot(layout);
        expect(spot, `${seed} po ${level} remontach`).not.toBeNull();
        const strip = new Set(staffStripCells(layout).map((c) => `${c.x},${c.y}`));
        expect(strip.has(`${spot!.cell.x},${spot!.cell.y}`), `${seed} po ${level} remontach: pas personelu`).toBe(true);
        expect(layout.fixtures.some((f) => inside(f, spot!.cell)), `${seed} po ${level} remontach: kratka w meblu`).toBe(false);
      }
    }
  });

  it('klienci nigdy nie wchodzą na kratkę kasjera (4 minuty ruchu w kilku sklepach)', () => {
    for (const seed of ['kasjer-ruch-1', 'kasjer-ruch-2', 'kasjer-ruch-3']) {
      const layout = generateStore(seed);
      const { cell } = cashierSpot(layout)!;
      const crowd = createCrowd(layout, seed, { targetCount: 12, spawnPerMinute: 30 });
      let served = 0;
      for (let i = 0; i < 30 * 240; i++) {
        stepCrowd(crowd, layout, SIM_STEP);
        for (const a of crowd.agents) {
          if (a.state === 'paying') served++;
          expect(Math.floor(a.x) === cell.x && Math.floor(a.y) === cell.y, `${seed}: agent ${a.id} na kratce kasjera`).toBe(false);
        }
      }
      expect(served, `${seed}: ktoś płacił przy kasie`).toBeGreaterThan(0);
    }
  });
});

describe('cashierCues', () => {
  const layout = layoutFromParts(validParts());   // miejsce klienta przy kasie: (4, 8)
  const agent = (id: number, state: AgentState, x = 4, y = 8): Agent =>
    ({ id, x: x + 0.5, y: y + 0.5, heading: 0, state, moving: false, ghost: false, appearanceSeed: `a${id}`, speed: 2.4 });

  it('bez klientów nic się nie dzieje', () => {
    expect(cashierCues(null, [], layout)).toEqual({ serving: null, sale: false, payingId: null });
    expect(cashierCues(null, [agent(1, 'browsing', 9, 9), agent(2, 'queueing', 4, 9)], layout)).toEqual({ serving: null, sale: false, payingId: null });
  });

  it('klient płacący przy kasie jest obsługiwany; dopóki płaci, sprzedaży nie ma', () => {
    const payer = agent(7, 'paying');
    const first = cashierCues(null, [agent(1, 'queueing', 4, 9), payer], layout);
    expect(first).toEqual({ serving: payer, sale: false, payingId: 7 });
    expect(cashierCues(first.payingId, [agent(1, 'queueing', 4, 9), payer], layout)).toEqual({ serving: payer, sale: false, payingId: 7 });
  });

  it('sprzedaż: klient, który płacił, jest teraz w stanie leaving, gone albo zniknął z listy', () => {
    for (const next of [[agent(7, 'leaving', 5, 8)], [agent(7, 'gone', 20, 1)], []]) {
      expect(cashierCues(7, next, layout), JSON.stringify(next.map((a) => a.state))).toEqual({ serving: null, sale: true, payingId: null });
    }
  });

  it('następny klient płaci w tej samej klatce, w której poprzedni odszedł: sprzedaż i nowy obsługiwany naraz', () => {
    const next = agent(8, 'paying');
    expect(cashierCues(7, [agent(7, 'leaving', 5, 8), next], layout)).toEqual({ serving: next, sale: true, payingId: 8 });
  });

  it('płacący gdzie indziej (kasa samoobsługowa) nie jest obsługiwany ani nie daje sprzedaży', () => {
    const sco = agent(3, 'paying', 9, 6);
    const first = cashierCues(null, [sco], layout);
    expect(first).toEqual({ serving: null, sale: false, payingId: null });
    expect(cashierCues(first.payingId, [agent(3, 'leaving', 9, 7)], layout).sale).toBe(false);
  });

  it('układ bez kolejki nie ma kogo obsługiwać', () => {
    expect(cashierCues(null, [agent(1, 'paying')], { checkoutQueue: [] })).toEqual({ serving: null, sale: false, payingId: null });
  });

  it('w prawdziwym tłumie: każdy klient obsłużony przy kasie daje dokładnie jedną sprzedaż, a wołający tylko przekazuje payingId', () => {
    for (const seed of ['kasjer-sprzedaz-1', 'kasjer-sprzedaz-2']) {
      const real = generateStore(seed);
      const crowd = createCrowd(real, seed, { targetCount: 12, spawnPerMinute: 30 });
      const served = new Set<number>();
      const sold: number[] = [];
      let prev: number | null = null;
      for (let i = 0; i < 30 * 300; i++) {
        stepCrowd(crowd, real, SIM_STEP);
        const cues = cashierCues(prev, crowd.agents, real);
        if (cues.serving) {
          expect(cues.serving.state).toBe('paying');
          served.add(cues.serving.id);
        }
        if (cues.sale) sold.push(prev!);
        prev = cues.payingId;
      }
      expect(sold.length, seed).toBeGreaterThanOrEqual(4);
      expect(new Set(sold).size, `${seed}: sprzedaż dwa razy temu samemu klientowi`).toBe(sold.length);
      expect(sold.every((id) => served.has(id))).toBe(true);
      expect(served.size - sold.length, `${seed}: obsłużeni bez sprzedaży (najwyżej ten, który jeszcze płaci)`).toBeLessThanOrEqual(1);
    }
  });
});

describe('strzałki ‹ › ekranu startowego: kolejność strojów i przełączanie', () => {
  const look = (outfit: CashierLook['outfit'], appearanceSeed = 'kasjer-twarz'): CashierLook => ({ outfit, appearanceSeed });

  it('kolejność to najpierw wszystkie zwykłe, potem wszystkie specjalne, każdy strój raz', () => {
    expect([...OUTFIT_ORDER]).toEqual([...REGULAR_OUTFITS, ...SPECIAL_OUTFITS]);
    expect(OUTFIT_ORDER).toHaveLength(21);
    expect(new Set(OUTFIT_ORDER).size).toBe(21);
    expect(OUTFIT_ORDER.slice(0, 12).every((o) => !isSpecialOutfit(o))).toBe(true);
    expect(OUTFIT_ORDER.slice(12).every(isSpecialOutfit)).toBe(true);
  });

  it('następny strój zostawia twarz i kolory (seed wyglądu), zmienia tylko strój', () => {
    const next = stepOutfit(look('men-suit', 'kasjer-xyz'), 1);
    expect(next).toEqual({ outfit: 'men-worker', appearanceSeed: 'kasjer-xyz' });
    expect(stepOutfit(next, -1)).toEqual(look('men-suit', 'kasjer-xyz'));
  });

  it('od wyglądu domyślnego strzałka w prawo przechodzi przez stroje zwykłe, dopiero potem trafia w specjalne', () => {
    let at = DEFAULT_CASHIER_LOOK;
    const seen: CashierLook['outfit'][] = [];
    for (let i = 0; i < 11; i++) { at = stepOutfit(at, 1); seen.push(at.outfit); }
    expect(seen.slice(0, 10).every((o) => !isSpecialOutfit(o))).toBe(true);
    expect(seen[10]).toBe('special-men-spacesuit');   // pierwszy specjalny po jedenastu krokach od men-casual-2
  });

  it('po ostatnim stroju wraca pierwszy i odwrotnie (cykl), a 21 kroków w jedną stronę to ten sam strój', () => {
    expect(stepOutfit(look('special-women-soldier'), 1).outfit).toBe('men-casual-hoodie');
    expect(stepOutfit(look('men-casual-hoodie'), -1).outfit).toBe('special-women-soldier');
    for (const dir of [1, -1] as const) {
      let at = look('women-suit');
      for (let i = 0; i < OUTFIT_ORDER.length; i++) at = stepOutfit(at, dir);
      expect(at).toEqual(look('women-suit'));
    }
  });

  it('każdy krok daje poprawny wygląd (isCashierLook) i nie zmienia przekazanego obiektu', () => {
    const start = look('men-beach', 'kasjer-a');
    const frozen = JSON.stringify(start);
    for (const outfit of OUTFIT_ORDER) {
      for (const dir of [1, -1] as const) expect(isCashierLook(stepOutfit(look(outfit), dir))).toBe(true);
    }
    stepOutfit(start, 1);
    expect(JSON.stringify(start)).toBe(frozen);
  });
});

describe('rollCashierLook: przycisk „Losuj” ekranu startowego', () => {
  /** Źródło liczb 32-bitowych z deterministycznego rng (zamiast crypto). */
  const source = (seed: string): (() => number) => { const rng = createRng(seed); return () => rng.int(0, 2 ** 32); };

  it('poprawny wygląd; to samo źródło daje ten sam wygląd, inne źródło inny', () => {
    const a = rollCashierLook(true, source('a'));
    expect(isCashierLook(a)).toBe(true);
    expect(rollCashierLook(true, source('a'))).toEqual(a);
    expect(rollCashierLook(true, source('b'))).not.toEqual(a);
  });

  it('z wyłączonym przełącznikiem nigdy nie wypada strój specjalny, z włączonym ok. 20% losowań', () => {
    const next = source('rzuty');
    const looks = Array.from({ length: 1000 }, () => rollCashierLook(true, next));
    const share = looks.filter((l) => isSpecialOutfit(l.outfit)).length / looks.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.25);
    const nextPlain = source('rzuty-zwykle');
    expect(Array.from({ length: 1000 }, () => rollCashierLook(false, nextPlain)).every((l) => !isSpecialOutfit(l.outfit))).toBe(true);
  });

  it('domyślne źródło (crypto) daje poprawne, różne wyglądy', () => {
    const looks = Array.from({ length: 30 }, () => rollCashierLook(true));
    for (const l of looks) expect(isCashierLook(l)).toBe(true);
    expect(new Set(looks.map((l) => l.appearanceSeed)).size).toBe(30);
  });
});
