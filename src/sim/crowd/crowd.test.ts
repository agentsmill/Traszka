import { describe, it, expect } from 'vitest';
import { cellKey } from '@/sim/grid';
import { generateStore } from '@/sim/store/generateStore';
import type { StoreLayout } from '@/sim/store/types';
import { accessCells, isWalkable } from '@/sim/store/validate';
import {
  MAX_DT,
  SIM_STEP,
  createCrowd,
  payLook,
  setCrowdExtras,
  setCrowdRate,
  staffStripCells,
  stepCrowd,
  type Agent,
  type AgentState,
  type Crowd,
  type CrowdOptions,
} from './crowd';

// Blok, pawilon i narożna kamienica: trzy różne kształty sali.
const SEEDS = ['kiełbasa-42', 'traszka-7', 'd'];
const MAIN_SEED = SEEDS[0]!;

const cellOf = (a: Agent): string => `${Math.floor(a.x)},${Math.floor(a.y)}`;

interface Sim { layout: StoreLayout; crowd: Crowd }

function makeSim(seed: string, opts: CrowdOptions): Sim {
  const layout = generateStore(seed);
  return { layout, crowd: createCrowd(layout, seed, opts) };
}

/** Wykonuje `seconds` sekund symulacji krokami SIM_STEP i po każdym kroku woła `onStep`. */
function run(sim: Sim, seconds: number, onStep?: (step: number) => void): void {
  const steps = Math.round(seconds / SIM_STEP);
  for (let i = 0; i < steps; i++) {
    stepCrowd(sim.crowd, sim.layout, SIM_STEP);
    onStep?.(i);
  }
}

describe('stałe', () => {
  it('SIM_STEP = 1/30 s, MAX_DT = 0,25 s', () => {
    expect(SIM_STEP).toBe(1 / 30);
    expect(MAX_DT).toBe(0.25);
  });
});

describe('createCrowd', () => {
  it('startuje pusty', () => {
    const { crowd } = makeSim(MAIN_SEED, { targetCount: 5, spawnPerMinute: 60 });
    expect(crowd.seed).toBe(MAIN_SEED);
    expect(crowd.time).toBe(0);
    expect(crowd.agents).toEqual([]);
  });
});

describe('determinizm', () => {
  it.each(SEEDS)('dwa tłumy z seedem %s dają identyczny JSON po 600 krokach', (seed) => {
    const a = makeSim(seed, { targetCount: 12, spawnPerMinute: 90 });
    const b = makeSim(seed, { targetCount: 12, spawnPerMinute: 90 });
    run(a, 20);
    run(b, 20);
    expect(a.crowd.agents.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.crowd.agents)).toBe(JSON.stringify(b.crowd.agents));
  });

  it('inny seed daje inny tłum', () => {
    const a = makeSim(MAIN_SEED, { targetCount: 12, spawnPerMinute: 90 });
    const layout = a.layout;
    const other = createCrowd(layout, 'inny-seed', { targetCount: 12, spawnPerMinute: 90 });
    run(a, 20);
    run({ layout, crowd: other }, 20);
    expect(JSON.stringify(other.agents)).not.toBe(JSON.stringify(a.crowd.agents));
  });

  it('agent ma deterministyczne ziarno wyglądu i prędkość 2,2–3,0 kratki/s', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 8, spawnPerMinute: 120 });
    run(sim, 10);
    expect(sim.crowd.agents.length).toBeGreaterThan(1);
    for (const a of sim.crowd.agents) {
      expect(a.appearanceSeed).toBe(`${MAIN_SEED}:agent:${a.id}`);
      expect(a.speed).toBeGreaterThanOrEqual(2.2);
      expect(a.speed).toBeLessThanOrEqual(3.0);
    }
    expect(new Set(sim.crowd.agents.map((a) => a.id)).size).toBe(sim.crowd.agents.length);
  });
});

describe('pełny cykl', () => {
  it.each(SEEDS)('jeden klient (%s) przechodzi wszystkie stany w 120 s', (seed) => {
    const sim = makeSim(seed, { targetCount: 1, spawnPerMinute: 30 });
    stepCrowd(sim.crowd, sim.layout, SIM_STEP);
    const agent = sim.crowd.agents[0]!;
    expect(agent).toBeDefined();

    const seen: AgentState[] = [agent.state];
    for (let i = 0; i < 120 / SIM_STEP && agent.state !== 'gone'; i++) {
      stepCrowd(sim.crowd, sim.layout, SIM_STEP);
      if (agent.state !== seen[seen.length - 1]) seen.push(agent.state);
    }
    expect(seen).toEqual(['entering', 'browsing', 'toQueue', 'queueing', 'paying', 'leaving', 'gone']);
  });

  it('agenta w stanie gone usuwa następne wywołanie stepCrowd', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 1, spawnPerMinute: 30 });
    stepCrowd(sim.crowd, sim.layout, SIM_STEP);
    const agent = sim.crowd.agents[0]!;
    while (agent.state !== 'gone') stepCrowd(sim.crowd, sim.layout, SIM_STEP);
    expect(sim.crowd.agents).toContain(agent);   // renderer widzi 'gone' jeszcze raz
    stepCrowd(sim.crowd, sim.layout, SIM_STEP);
    expect(sim.crowd.agents).not.toContain(agent);
  });

  it('po wyjściu klienta pojawia się następny (utrzymuje targetCount)', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 1, spawnPerMinute: 60 });
    const ids = new Set<number>();
    run(sim, 150, () => sim.crowd.agents.forEach((a) => ids.add(a.id)));
    expect(ids.size).toBeGreaterThanOrEqual(2);
    expect(sim.crowd.agents.filter((a) => a.state !== 'gone').length).toBeLessThanOrEqual(1);
  });
});

describe('kolejka', () => {
  it.each(SEEDS)('FIFO: kolejność wejścia w paying zgadza się z queueing (%s)', (seed) => {
    const sim = makeSim(seed, { targetCount: 5, spawnPerMinute: 120 });
    const last = new Map<number, AgentState>();
    const queueingOrder: number[] = [];
    const payingOrder: number[] = [];
    let longest = 0;

    run(sim, 150, () => {
      let inLine = 0;
      for (const a of sim.crowd.agents) {
        if (last.get(a.id) !== a.state) {
          if (a.state === 'queueing') queueingOrder.push(a.id);
          if (a.state === 'paying') payingOrder.push(a.id);
          last.set(a.id, a.state);
        }
        if (a.state === 'queueing' || a.state === 'paying') inLine++;
      }
      longest = Math.max(longest, inLine);
    });

    expect(payingOrder.length).toBeGreaterThanOrEqual(5);
    expect(payingOrder).toEqual(queueingOrder.slice(0, payingOrder.length));
    expect(longest).toBeGreaterThanOrEqual(2);   // test nie jest pusty: kolejka naprawdę się tworzyła
  });

  it('płaci co najwyżej jeden klient naraz, na checkoutQueue[0]', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 8, spawnPerMinute: 120 });
    const front = sim.layout.checkoutQueue[0]!;
    let sawPaying = false;
    run(sim, 90, () => {
      const paying = sim.crowd.agents.filter((a) => a.state === 'paying');
      expect(paying.length).toBeLessThanOrEqual(1);
      for (const a of paying) {
        sawPaying = true;
        expect(cellOf(a)).toBe(`${front.x},${front.y}`);
        expect(a.moving).toBe(false);
      }
    });
    expect(sawPaying).toBe(true);
  });

  it('w kolejce (idący na jej koniec, czekający i płacący) jest nie więcej osób niż kratek', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 30, spawnPerMinute: 240 });
    const capacity = sim.layout.checkoutQueue.length;
    let longest = 0;
    run(sim, 120, () => {
      const inLine = sim.crowd.agents.filter((a) => a.state === 'toQueue' || a.state === 'queueing' || a.state === 'paying').length;
      longest = Math.max(longest, inLine);
      expect(inLine).toBeLessThanOrEqual(capacity);
    });
    expect(longest).toBe(capacity);   // przy takim natłoku kolejka dochodzi do pełnej długości
  });

  it('płacący patrzy na kasę', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 5, spawnPerMinute: 120 });
    const checkout = sim.layout.fixtures.find((f) => f.kind === 'checkout')!;
    const centre = { x: checkout.x + checkout.w / 2, y: checkout.y + checkout.d / 2 };
    let checked = 0;
    run(sim, 90, () => {
      for (const a of sim.crowd.agents.filter((x) => x.state === 'paying')) {
        const dot = Math.cos(a.heading) * (centre.x - a.x) + Math.sin(a.heading) * (centre.y - a.y);
        expect(dot).toBeGreaterThan(0.5);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(0);
  });

  it('czekający stoją na kratkach kolejki, w kolejności, bez luk na początku', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 10, spawnPerMinute: 120 });
    const queue = sim.layout.checkoutQueue.map((c) => `${c.x},${c.y}`);
    run(sim, 90, () => {
      const standing = sim.crowd.agents.filter((a) => (a.state === 'queueing' || a.state === 'paying') && !a.moving);
      for (const a of standing) expect(queue).toContain(cellOf(a));
    });
  });
});

describe.each(SEEDS)('ruch (%s)', (seed) => {
  it('brak kolizji: żadna kratka nie ma dwóch agentów, którzy nie są w trybie ducha', () => {
    const sim = makeSim(seed, { targetCount: 30, spawnPerMinute: 240 });
    run(sim, 60, (step) => {
      const taken = new Map<string, number>();
      for (const a of sim.crowd.agents) {
        if (a.ghost) continue;
        const key = cellOf(a);
        expect(taken.get(key), `krok ${step}: kratka ${key} zajęta przez agentów ${taken.get(key)} i ${a.id}`).toBeUndefined();
        taken.set(key, a.id);
      }
    });
  });

  it('nie przenika ścian: każdy agent stoi na chodliwej kratce', () => {
    const sim = makeSim(seed, { targetCount: 30, spawnPerMinute: 240 });
    run(sim, 60, (step) => {
      for (const a of sim.crowd.agents) {
        expect(isWalkable(sim.layout, Math.floor(a.x), Math.floor(a.y)), `krok ${step}: agent ${a.id} w ${a.x},${a.y}`).toBe(true);
      }
    });
  });

  it('nie wchodzi do pasa personelu między kasą a regałem z papierosami', () => {
    const sim = makeSim(seed, { targetCount: 30, spawnPerMinute: 240 });
    const strip = new Set(staffStripCells(sim.layout).map(cellKey));
    expect(strip.size).toBeGreaterThan(0);
    run(sim, 60, () => {
      for (const a of sim.crowd.agents) {
        expect(strip.has(cellKey({ x: Math.floor(a.x), y: Math.floor(a.y) }))).toBe(false);
      }
    });
  });

  it('tryb ducha to wyjątek, a nie norma (poniżej 3% kroków agentów)', () => {
    const sim = makeSim(seed, { targetCount: 30, spawnPerMinute: 240 });
    let ghostSteps = 0;
    let agentSteps = 0;
    run(sim, 60, () => {
      for (const a of sim.crowd.agents) {
        agentSteps++;
        if (a.ghost) ghostSteps++;
      }
    });
    expect(agentSteps).toBeGreaterThan(10_000);
    expect(ghostSteps / agentSteps).toBeLessThan(0.03);
  });

  it('flaga moving zgadza się z ruchem: stoi wtedy i tylko wtedy, gdy pozycja się nie zmienia', () => {
    const sim = makeSim(seed, { targetCount: 20, spawnPerMinute: 120 });
    const prev = new Map<number, { x: number; y: number }>();
    let idle = 0;
    let walking = 0;
    run(sim, 40, () => {
      for (const a of sim.crowd.agents) {
        const p = prev.get(a.id);
        if (p) {
          const changed = a.x !== p.x || a.y !== p.y;
          expect(a.moving, `agent ${a.id} (${a.state})`).toBe(changed);
          if (changed) walking++; else idle++;
        }
        prev.set(a.id, { x: a.x, y: a.y });
      }
    });
    expect(walking).toBeGreaterThan(0);
    expect(idle).toBeGreaterThan(0);
  });

  it('ruch jest płynny: agent nigdy nie przeskakuje więcej niż jedną kratkę na krok', () => {
    const sim = makeSim(seed, { targetCount: 20, spawnPerMinute: 120 });
    const prev = new Map<number, { x: number; y: number }>();
    run(sim, 40, () => {
      for (const a of sim.crowd.agents) {
        const p = prev.get(a.id);
        if (p) expect(Math.hypot(a.x - p.x, a.y - p.y)).toBeLessThanOrEqual(a.speed * SIM_STEP + 1e-9);
        prev.set(a.id, { x: a.x, y: a.y });
      }
    });
  });
});

describe('pas personelu', () => {
  it.each(SEEDS)('leży na podłodze sali między kasą a regałem z papierosami (%s)', (seed) => {
    const layout = generateStore(seed);
    const strip = staffStripCells(layout);
    expect(strip.length).toBeGreaterThan(0);
    const checkout = layout.fixtures.find((f) => f.kind === 'checkout')!;
    const tobacco = layout.fixtures.find((f) => f.kind === 'tobaccoShelf')!;
    const between = (lo: number, hi: number, v: number): boolean => v > lo && v < hi;
    for (const c of strip) {
      expect(isWalkable(layout, c.x, c.y)).toBe(true);
      // kolumna pasa leży ściśle między kasą a regałem (kasa i regał stoją w pionowych rzędach)
      const lo = Math.min(checkout.x, tobacco.x);
      const hi = Math.max(checkout.x, tobacco.x);
      expect(between(lo, hi, c.x)).toBe(true);
    }
  });
});

describe('czas', () => {
  it('skok czasu: stepCrowd(c, l, 30) zwiększa time o dokładnie MAX_DT', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 5, spawnPerMinute: 60 });
    const before = sim.crowd.time;
    stepCrowd(sim.crowd, sim.layout, 30);
    expect(Math.abs(sim.crowd.time - before - MAX_DT)).toBeLessThan(1e-9);
  });

  it('time rośnie o dt, a ujemne dt jest ignorowane', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 5, spawnPerMinute: 60 });
    stepCrowd(sim.crowd, sim.layout, 0.1);
    stepCrowd(sim.crowd, sim.layout, -1);
    expect(sim.crowd.time).toBeCloseTo(0.1, 9);
  });

  it('małe dt się sumują: dwa razy SIM_STEP/2 daje to samo co raz SIM_STEP', () => {
    const half = makeSim(MAIN_SEED, { targetCount: 6, spawnPerMinute: 120 });
    const whole = makeSim(MAIN_SEED, { targetCount: 6, spawnPerMinute: 120 });
    for (let i = 0; i < 300; i++) {
      stepCrowd(half.crowd, half.layout, SIM_STEP / 2);
      stepCrowd(half.crowd, half.layout, SIM_STEP / 2);
      stepCrowd(whole.crowd, whole.layout, SIM_STEP);
    }
    expect(JSON.stringify(half.crowd.agents)).toBe(JSON.stringify(whole.crowd.agents));
  });

  it('duże dt daje tyle samo kroków co przycięte: 30 s == MAX_DT', () => {
    const big = makeSim(MAIN_SEED, { targetCount: 6, spawnPerMinute: 120 });
    const clamped = makeSim(MAIN_SEED, { targetCount: 6, spawnPerMinute: 120 });
    for (let i = 0; i < 40; i++) {
      stepCrowd(big.crowd, big.layout, 30);
      stepCrowd(clamped.crowd, clamped.layout, MAX_DT);
    }
    expect(JSON.stringify(big.crowd.agents)).toBe(JSON.stringify(clamped.crowd.agents));
  });
});

describe('spawn', () => {
  it('nie przekracza targetCount i dochodzi do niego w tempie spawnPerMinute', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 6, spawnPerMinute: 60 });
    run(sim, 3.5);
    // 1 klient na sekundę, pierwszy od razu: po 3,5 s są cztery
    expect(sim.crowd.agents).toHaveLength(4);
    run(sim, 10);
    expect(sim.crowd.agents.filter((a) => a.state !== 'gone').length).toBeLessThanOrEqual(6);
  });

  it('spawnPerMinute = 0 nie tworzy nikogo', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 6, spawnPerMinute: 0 });
    run(sim, 10);
    expect(sim.crowd.agents).toEqual([]);
  });

  it('klienci pojawiają się na punktach spawnu i wychodzą drugim', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 1, spawnPerMinute: 30 });
    const { spawnPoints } = sim.layout;
    stepCrowd(sim.crowd, sim.layout, SIM_STEP);
    const agent = sim.crowd.agents[0]!;
    const spawnCell = spawnPoints.findIndex((p) => cellOf(agent) === `${p.x},${p.y}`);
    expect(spawnCell).toBeGreaterThanOrEqual(0);

    while (agent.state !== 'gone') stepCrowd(sim.crowd, sim.layout, SIM_STEP);
    const exit = spawnPoints.findIndex((p) => cellOf(agent) === `${p.x},${p.y}`);
    expect(exit).toBeGreaterThanOrEqual(0);
    expect(exit).not.toBe(spawnCell);
  });
});

describe('wydajność', () => {
  it('60 agentów i 30 s symulacji trwa < 200 ms', () => {
    const layout = generateStore(MAIN_SEED);
    const t0 = performance.now();
    const crowd = createCrowd(layout, MAIN_SEED, { targetCount: 60, spawnPerMinute: 600 });
    for (let i = 0; i < Math.round(30 / SIM_STEP); i++) stepCrowd(crowd, layout, SIM_STEP);
    const elapsed = performance.now() - t0;
    expect(crowd.agents.filter((a) => a.state !== 'gone')).toHaveLength(60);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('pas mebli ulicznych', () => {
  it('żaden klient nie wchodzi w wiersz 0 chodnika (ławka i kosz stoją tam w buildStreet)', () => {
    for (const seed of SEEDS) {
      const sim = makeSim(seed, { targetCount: 12, spawnPerMinute: 30 });
      let lowest = Infinity;
      run(sim, 120, () => { for (const a of sim.crowd.agents) lowest = Math.min(lowest, Math.floor(a.y)); });
      expect(lowest, seed).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('gra: kasy samoobsługowe, palety, tempo', () => {
  it('część klientów płaci przy kasie samoobsługowej', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 12, spawnPerMinute: 90 });
    const slot = sim.layout.fixtures.find((f) => f.kind === 'selfCheckoutSlot')!;
    const cell = accessCells(sim.layout, slot).at(-1)!;
    setCrowdExtras(sim.crowd, [], [{ cell, look: payLook(slot.facing) }]);
    let paidThere = 0;
    run(sim, 240, () => {
      for (const a of sim.crowd.agents) {
        if (a.state === 'paying' && cellOf(a) === `${cell.x},${cell.y}`) paidThere++;
      }
    });
    expect(paidThere).toBeGreaterThan(0);
  });

  it('nikt nie staje na kratkach palety (poza przejściem „na ducha” z zakleszczenia)', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 12, spawnPerMinute: 90 });
    const pallet = [{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 2 }].filter((c) => isWalkable(sim.layout, c.x, c.y));
    setCrowdExtras(sim.crowd, pallet, []);
    const blocked = new Set(pallet.map((c) => `${c.x},${c.y}`));
    let standing = 0;
    run(sim, 120, () => {
      for (const a of sim.crowd.agents) if (!a.ghost && !a.moving && blocked.has(cellOf(a))) standing++;
    });
    expect(standing).toBe(0);
  });

  it('tempo napływu daje się zmienić w trakcie: zero zatrzymuje nowych klientów', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 12, spawnPerMinute: 90 });
    run(sim, 20);
    setCrowdRate(sim.crowd, { targetCount: 0, spawnPerMinute: 0 });
    run(sim, 300);
    expect(sim.crowd.agents.length).toBe(0);
  });
});
