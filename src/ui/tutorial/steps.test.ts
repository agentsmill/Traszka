import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCommand } from '@/sim/economy/commands';
import { createEconomy, type EconomyState } from '@/sim/economy/economy';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { tapBlock } from '../game/tapBlock';
import { speed, type TabId } from '../state';
import { moneySteps } from './money';
import { buildTour, canTapPallet, markOf, type TourCtx, type TourStep } from './steps';

const SEED = 'samouczek-1';
function game(seed = SEED): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor(seed, 0));
  return { s: createEconomy(seed, info), info };
}
const ctxOf = (g: { s: EconomyState; info: StoreInfo }, over: Partial<TourCtx> = {}): TourCtx => ({ ...g, tab: null, speed: 0, ...over });
const step = (steps: TourStep[], id: string): TourStep => steps.find((x) => x.id === id)!;

afterEach(() => { speed.value = 1; });

describe('buildTour: kolejność kroków', () => {
  it('zamówienie przez Asystenta: 16 kroków, dwa zadania z przełącznikiem, na końcu „?”', () => {
    const steps = buildTour(ctxOf(game()));
    expect(steps.map((x) => x.id)).toEqual([
      'cel', 'gotowka', 'saldo', 'zostanie', 'zaufanie', 'czas', 'zakladki', 'reczne', 'asystent', 'miejsca', 'ludzie', 'ulepszenia', 'cele',
      'karta', 'start', 'pomoc',
    ]);
    expect(steps.at(-1)!.target).toBe('help');
  });

  it('zamówienie ręczne: 15 kroków, jeden informacyjny krok o zamówieniu bez zadania', () => {
    const g = game();
    applyCommand(g.s, g.info, { type: 'setOrder', auto: false, manual: 3 });
    const steps = buildTour(ctxOf(g));
    expect(steps).toHaveLength(15);
    expect(steps.map((x) => x.id)).not.toContain('reczne');
    const order = step(steps, 'zamowienie');
    expect(order.target).toBe('order');
    expect(order.task).toBeUndefined();
  });

  it('kroki o pieniądzach to lista z money.ts, zaraz po pierwszym kroku', () => {
    const steps = buildTour(ctxOf(game()));
    expect(steps.slice(1, 5).map((x) => x.id)).toEqual(moneySteps().map((x) => x.id));
    expect(steps.slice(1, 5).map((x) => x.target)).toEqual(['cash', 'saldo', 'due', 'trust']);
  });

  it('identyfikatory są niepowtarzalne, każdy krok ma tytuł i tekst', () => {
    const steps = buildTour(ctxOf(game()));
    expect(new Set(steps.map((x) => x.id)).size).toBe(steps.length);
    for (const x of steps) {
      expect(x.title.length, x.id).toBeGreaterThan(2);
      expect(x.text.length, x.id).toBeGreaterThan(20);
    }
  });
});

describe('stan widoku ustawiany przez kroki', () => {
  const steps = buildTour(ctxOf(game()));

  it('pierwszy krok zamyka arkusz i zaznaczenie', () => {
    expect(step(steps, 'cel').tab).toBeNull();
    expect(step(steps, 'cel').clearSelection).toBe(true);
  });

  it('kroki palet trzymają otwarte Palety, a Ludzie, Ulepszenia i Cele otwierają swoje zakładki', () => {
    const tabs: [string, TabId | null][] = [
      ['reczne', 'palety'], ['asystent', 'palety'], ['miejsca', 'palety'], ['ludzie', 'ludzie'], ['ulepszenia', 'ulepszenia'], ['cele', 'cele'],
      ['karta', null], ['start', null], ['pomoc', null],
    ];
    for (const [id, tab] of tabs) expect(step(steps, id).tab, id).toBe(tab);
  });

  it('zadanie z zakładkami nie otwiera jej samo: klika gracz', () => {
    expect(step(steps, 'zakladki').tab).toBeUndefined();
  });

  it('dopiero przedostatni krok zdejmuje pauzę i chowa zaznaczenie (kliker)', () => {
    expect(steps.filter((x) => x.resume).map((x) => x.id)).toEqual(['start']);
    expect(step(steps, 'start').clearSelection).toBe(true);
  });
});

describe('zadania', () => {
  it('zakładki: zaliczone, gdy otwarte są Palety', () => {
    const g = game();
    const task = step(buildTour(ctxOf(g)), 'zakladki').task!;
    expect(task.done(ctxOf(g, { tab: null }), markOf(g.s))).toBe(false);
    expect(task.done(ctxOf(g, { tab: 'ludzie' }), markOf(g.s))).toBe(false);
    expect(task.done(ctxOf(g, { tab: 'palety' }), markOf(g.s))).toBe(true);
  });

  it('przełącznik zamówienia: na „Ręcznie”, potem z powrotem na Asystenta', () => {
    const g = game();
    const steps = buildTour(ctxOf(g));
    const manual = step(steps, 'reczne').task!;
    const auto = step(steps, 'asystent').task!;
    expect(manual.done(ctxOf(g), markOf(g.s))).toBe(false);
    applyCommand(g.s, g.info, { type: 'setOrder', auto: false, manual: g.s.order.manual });
    expect(manual.done(ctxOf(g), markOf(g.s))).toBe(true);
    expect(auto.done(ctxOf(g), markOf(g.s))).toBe(false);
    applyCommand(g.s, g.info, { type: 'setOrder', auto: true });
    expect(auto.done(ctxOf(g), markOf(g.s))).toBe(true);
  });

  it('stuknij 📦: niewykonalne w pauzie, wykonalne, gdy czas idzie, zaliczone po stuknięciu gracza', () => {
    const g = game();
    const task = step(buildTour(ctxOf(g)), 'start').task!;
    expect(task.can!(ctxOf(g, { speed: 0 }))).toBe(false);
    expect(task.can!(ctxOf(g, { speed: 1 }))).toBe(true);
    const mark = markOf(g.s);
    expect(task.done(ctxOf(g, { speed: 1 }), mark)).toBe(false);
    expect(applyCommand(g.s, g.info, { type: 'tapPallet' }).result.ok).toBe(true);
    expect(task.done(ctxOf(g, { speed: 1 }), mark)).toBe(true);
  });

  it('stuknij 📦: bez palet zadania nie da się wykonać', () => {
    const g = game();
    g.s.pallets = [];
    expect(canTapPallet(ctxOf(g, { speed: 1 }))).toBe(false);
  });

  it('canTapPallet zgadza się z blokadą przycisku 📦 (tapBlock) przy tej samej prędkości', () => {
    const g = game();
    for (const v of [0, 1, 8] as const) {
      speed.value = v;
      expect(canTapPallet(ctxOf(g, { speed: v })), `prędkość ${v}`).toBe(!tapBlock(g.s, 'paleta') && g.s.pallets.length > 0);
    }
    g.s.tycoon.fatigue.energy = 0;
    speed.value = 1;
    expect(canTapPallet(ctxOf(g, { speed: 1 }))).toBe(!tapBlock(g.s, 'paleta'));
  });
});

describe('teksty', () => {
  const all = (): string => buildTour(ctxOf(game())).map((x) => `${x.title} ${x.text} ${x.task?.hint ?? ''}`).join('\n');

  it('bez opłaty franczyzowej, „do oddania” i WUT (zniknęły w SIM 6)', () => {
    const text = all().toLowerCase();
    expect(text).not.toContain('opłata franczyzowa');
    expect(text).not.toContain('opłatę franczyzową');
    expect(text).not.toContain('do oddania');
    expect(text).not.toMatch(/\bwut\b/);
  });

  it('pojęcia SIM 6 są w przelocie: saldo, raty, „Zostaje Ci”, przelew, wyciąg, remanent', () => {
    const text = all();
    for (const word of ['Saldo u Centrali', 'raty', '„Zostaje Ci”', 'przelew', 'wyciąg', 'remanent']) expect(text, word).toContain(word);
  });

  it('liczby ze stałych: najwyższa ranga, długość doby, próg kolejnej Traszki', () => {
    const text = all();
    expect(text).toContain('Legendarna Paleta');
    expect(text).toContain('3 min 20 s');
    expect(text).toContain('Po 2. remoncie albo na 20. poziomie');
  });
});

/** Wszystkie pliki źródłowe interfejsu (bez testów): tam muszą stać atrybuty, które wskazują kroki. */
function uiSources(dir = join(process.cwd(), 'src/ui')): string {
  let out = '';
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out += uiSources(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.includes('/tutorial/')) out += readFileSync(path, 'utf8');
  }
  return out;
}

describe('każdy krok wskazuje element, który istnieje w interfejsie', () => {
  it('dla każdego celu jest atrybut data-tut w źródłach src/ui', () => {
    const src = uiSources();
    const targets = new Set(buildTour(ctxOf(game())).map((x) => x.target).filter((t): t is string => t !== null));
    const g = game();
    applyCommand(g.s, g.info, { type: 'setOrder', auto: false, manual: 3 });
    for (const x of buildTour(ctxOf(g))) if (x.target) targets.add(x.target);
    for (const t of targets) {
      const literal = src.includes(`data-tut="${t}"`) || src.includes(`tut="${t}"`);
      const tabTemplate = t.startsWith('tab-') && src.includes('data-tut={`tab-${');
      expect(literal || tabTemplate, `data-tut="${t}"`).toBe(true);
    }
  });
});
