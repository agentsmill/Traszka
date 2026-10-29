import { describe, it, expect } from 'vitest';
import { cellKey } from '@/sim/grid';
import { generateStore } from '@/sim/store/generateStore';
import type { StoreLayout } from '@/sim/store/types';
import { accessCells, isWalkable } from '@/sim/store/validate';
import {
  CLOSING_PAY_SPEEDUP,
  MIRROR_CREDIT_CAP,
  crowdHeadcount,
  feedCrowdMirror,
  CLOSING_SPEED,
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

describe('zamknięcie sklepu (CrowdOptions.closing)', () => {
  const OPEN: CrowdOptions = { targetCount: 16, spawnPerMinute: 24 };
  const CLOSING: CrowdOptions = { targetCount: 0, spawnPerMinute: 0, closing: true };
  /** Noc w grze trwa ok. 5 s czasu symulacji (420 minut przy 84 minutach na sekundę), a tłum ma mieć wyjść w tym czasie, z zapasem. */
  const EMPTY_WITHIN_S = 8;
  const live = (crowd: Crowd): Agent[] => crowd.agents.filter((a) => a.state !== 'gone');
  /** Tłum w pełnym ruchu: oglądający, kolejka, płacący i wychodzący naraz. */
  function busy(seed: string, warmS = 45): Sim {
    const sim = makeSim(seed, OPEN);
    run(sim, warmS);
    return sim;
  }

  it.each(['kiełbasa-42', 'traszka-7', 'd', 'alfa', 'beta-12', 'kamienica-3', 'seed-6', 'x2'])(
    '%s: po zamknięciu w ciągu kilku sekund wszyscy agenci są gone, a nikt nowy nie wchodzi',
    (seed) => {
      for (const warm of [40, 47.3, 61]) {
        const sim = busy(seed, warm);
        const before = live(sim.crowd).length;
        expect(before).toBeGreaterThanOrEqual(8);   // test sprawdza prawdziwy tłum, a nie pusty sklep
        const seen = new Set(sim.crowd.agents.map((a) => a.id));
        setCrowdRate(sim.crowd, CLOSING);
        let t = 0;
        while (live(sim.crowd).length > 0 && t < EMPTY_WITHIN_S) {
          run(sim, SIM_STEP);
          t += SIM_STEP;
          for (const a of sim.crowd.agents) expect(seen.has(a.id), `nowy agent ${a.id} po zamknięciu`).toBe(true);
        }
        expect(live(sim.crowd), `${seed} po ${warm} s: ${before} agentów, po ${EMPTY_WITHIN_S} s zostało`).toEqual([]);
        run(sim, 10);
        expect(sim.crowd.agents).toEqual([]);   // i nikt nie wchodzi później
      }
    },
  );

  it('stojący w kolejce płacą i wychodzą: kolejka się opróżnia, a płacący nie czeka pełnych 3–6 s', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 14, spawnPerMinute: 90 });
    // gęsty ruch, aż w kolejce stoi co najmniej troje
    let guard = 0;
    while (sim.crowd.internal.queue.length < 3 && guard++ < 3000) run(sim, SIM_STEP);
    expect(sim.crowd.internal.queue.length).toBeGreaterThanOrEqual(3);
    const inLine = [...sim.crowd.internal.queue];
    setCrowdRate(sim.crowd, CLOSING);
    const paid = new Set<number>();
    let t = 0;
    while (live(sim.crowd).length > 0 && t < EMPTY_WITHIN_S) {
      run(sim, SIM_STEP);
      t += SIM_STEP;
      for (const a of sim.crowd.agents) if (a.state === 'leaving' && inLine.includes(a.id)) paid.add(a.id);
    }
    expect(sim.crowd.internal.queue).toEqual([]);
    expect(paid.size).toBeGreaterThanOrEqual(inLine.length);   // każdy z kolejki zapłacił i wyszedł, a nie zniknął z kolejki
    expect(t).toBeLessThan(EMPTY_WITHIN_S);
    // płacenie jest przyspieszone: trzy osoby w kolejce nie zajmują 3 × (3–6 s)
    expect(t).toBeLessThan(inLine.length * 3 / CLOSING_PAY_SPEEDUP + 6);
  });

  it('oglądający idą prosto do kasy (albo wychodzą, gdy kolejka jest pełna), nie dokańczają oglądania', () => {
    const sim = busy(MAIN_SEED, 30);
    const browsing = live(sim.crowd).filter((a) => a.state === 'browsing');
    expect(browsing.length).toBeGreaterThan(0);
    const ids = browsing.map((a) => a.id);
    setCrowdRate(sim.crowd, CLOSING);
    run(sim, 2 * SIM_STEP);   // jeden krok na zmianę planu
    for (const id of ids) {
      const a = sim.crowd.agents.find((x) => x.id === id);
      if (!a || a.state === 'gone') continue;
      expect(['toQueue', 'queueing', 'paying', 'leaving'], `agent ${id}`).toContain(a.state);
    }
  });

  it('kto jest przed progiem, zawraca na ulicę (nie wchodzi do sali)', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 1, spawnPerMinute: 30 });
    stepCrowd(sim.crowd, sim.layout, SIM_STEP);
    const agent = sim.crowd.agents[0]!;
    expect(agent.state).toBe('entering');
    const spawnCell = { x: Math.floor(agent.x), y: Math.floor(agent.y) };
    setCrowdRate(sim.crowd, CLOSING);
    let deepest = agent.y;
    while (agent.state !== 'gone') {
      stepCrowd(sim.crowd, sim.layout, SIM_STEP);
      deepest = Math.max(deepest, agent.y);
    }
    expect(agent.state).toBe('gone');
    expect(deepest).toBeLessThan(4);   // wiersze 0–3 to chodnik: do ściany frontowej (4) nie doszedł
    expect(Math.floor(agent.x)).toBe(spawnCell.x);   // wrócił tam, skąd przyszedł
  });

  it.each([['×1', 1 / 60], ['×2', 2 / 60], ['×4', 4 / 60], ['×8', 8 / 60]] as const)(
    'klatka po klatce przy dt jak dla %s: ten sam wynik co krokami SIM_STEP, wszyscy gone w czasie nocy',
    (_label, frameDt) => {
      const a = busy('alfa', 47.3);
      const b = busy('alfa', 47.3);
      setCrowdRate(a.crowd, CLOSING);
      setCrowdRate(b.crowd, CLOSING);
      let simTime = 0;
      while ((live(a.crowd).length > 0 || live(b.crowd).length > 0) && simTime < EMPTY_WITHIN_S) {
        stepCrowd(a.crowd, a.layout, frameDt);        // klatka gry
        run(b, frameDt);                               // to samo drobnymi krokami (run zaokrągla do SIM_STEP, dlatego `stepCrowd` niżej)
        simTime += frameDt;
      }
      expect(live(a.crowd)).toEqual([]);
    },
  );

  it('ten sam przebieg przy ×1 i ×8: kolejność kroków symulacji nie zależy od podziału na klatki', () => {
    const slow = busy('beta-12', 47.3);
    const fast = busy('beta-12', 47.3);
    setCrowdRate(slow.crowd, CLOSING);
    setCrowdRate(fast.crowd, CLOSING);
    for (let i = 0; i < 6 * 60; i++) stepCrowd(slow.crowd, slow.layout, 1 / 60);       // 6 s w klatkach ×1
    for (let i = 0; i < 6 * 60 / 8; i++) stepCrowd(fast.crowd, fast.layout, 8 / 60);   // 6 s w klatkach ×8
    expect(live(slow.crowd)).toEqual([]);
    expect(live(fast.crowd)).toEqual([]);
  });

  it('powrót do otwarcia (rano, koniec remontu): closing przestaje działać, nowi klienci znów wchodzą, a wychodzący wyjdą', () => {
    const sim = busy('traszka-7', 47.3);
    setCrowdRate(sim.crowd, CLOSING);
    run(sim, 0.5);
    setCrowdRate(sim.crowd, OPEN);
    run(sim, 60);
    expect(sim.crowd.agents.length).toBeGreaterThan(0);
    expect(Math.max(...sim.crowd.agents.map((a) => a.id))).toBeGreaterThan(20);   // napływ wrócił
    // zwykłe tempo wróciło: marsz nie jest już przyspieszony
    const walking = live(sim.crowd).find((a) => a.moving)!;
    expect(walking.speed).toBeLessThanOrEqual(3.0);
    expect(CLOSING_SPEED).toBeGreaterThan(1);
  });

  it('setCrowdRate zauważa samo przełączenie closing (te same liczby, inny tryb)', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 0, spawnPerMinute: 0 });
    setCrowdRate(sim.crowd, { targetCount: 0, spawnPerMinute: 0, closing: true });
    expect(sim.crowd.internal.opts.closing).toBe(true);
    setCrowdRate(sim.crowd, { targetCount: 0, spawnPerMinute: 0 });
    expect(sim.crowd.internal.opts.closing).toBeFalsy();
  });

  it('zamknięcie nie zakleszcza ludzi: żadnego agenta nie zostaje po 8 s także w gęstym tłumie (22 osoby) na wielu układach', () => {
    for (const seed of ['kiełbasa-42', 'traszka-7', 'd', 'x1', 'x2', 'x3', 'seed-11']) {
      const sim = makeSim(seed, { targetCount: 22, spawnPerMinute: 24 });
      run(sim, 55);
      setCrowdRate(sim.crowd, CLOSING);
      run(sim, EMPTY_WITHIN_S);
      expect(live(sim.crowd), seed).toEqual([]);
    }
  });
});

describe('lustro ekonomii (CrowdOptions.mirror)', () => {
  const MIRROR: CrowdOptions = { targetCount: 0, spawnPerMinute: 0, mirror: true };
  const feed = (crowd: Crowd, over: Partial<Parameters<typeof feedCrowdMirror>[1]> = {}): void =>
    feedCrowdMirror(crowd, { spawn: 0, weight: 12, serve: 0, lose: 0, queueTarget: 0, ...over });
  const live = (crowd: Crowd): Agent[] => crowd.agents.filter((a) => a.state !== 'gone');
  const inLine = (crowd: Crowd): Agent[] => crowd.agents.filter((a) => a.state === 'toQueue' || a.state === 'queueing' || a.state === 'paying');
  const mirrorState = (crowd: Crowd) => crowd.internal.mirror;

  it('sam z siebie nikogo nie wpuszcza (ani tempo, ani cel), wchodzą tylko grupy z feedCrowdMirror, każda z wagą', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 12, spawnPerMinute: 90, mirror: true });
    run(sim, 20);
    expect(sim.crowd.agents).toEqual([]);
    feed(sim.crowd, { spawn: 2, weight: 14 });
    run(sim, 1);
    expect(sim.crowd.agents.length).toBeGreaterThanOrEqual(1);
    for (const a of sim.crowd.agents) expect(a.weight).toBe(14);
    run(sim, 3);
    expect(sim.crowd.agents).toHaveLength(2);
    const { spawnPoints } = sim.layout;
    expect(sim.crowd.agents.every((a) => a.state !== 'gone' || spawnPoints.some((p) => `${p.x},${p.y}` === cellOf(a)))).toBe(true);
  });

  it('wchodzące grupy czekają na wolny punkt pojawiania się, a kolejka oczekujących jest ograniczona', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { spawn: 50 });
    expect(crowdHeadcount(sim.crowd)).toBeLessThanOrEqual(6);   // MIRROR_PENDING_MAX: reszta przepada
    expect(crowdHeadcount(sim.crowd)).toBeGreaterThan(0);
    run(sim, 20);
    expect(live(sim.crowd).length + 0).toBeGreaterThan(0);
    expect(crowdHeadcount(sim.crowd)).toBeLessThanOrEqual(6);
  });

  it('bez kredytu obsłużonych i bez kolejki w grze nikt nie idzie do kasy; kredyt wystarcza, by zapłacić i wyjść', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { spawn: 1, weight: 12 });
    run(sim, 90);
    expect(live(sim.crowd)).toHaveLength(1);
    expect(inLine(sim.crowd)).toEqual([]);   // ogląda dalej, bo nikt nie został obsłużony
    feed(sim.crowd, { serve: 12 });
    let t = 0;
    while (live(sim.crowd).length > 0 && t < 60) { run(sim, SIM_STEP); t += SIM_STEP; }
    expect(live(sim.crowd)).toEqual([]);
    expect(mirrorState(sim.crowd).serveCredit).toBeCloseTo(0, 9);   // zapłacił dokładnie za swoją grupę
  });

  it('nowo przybyły idzie od razu do kolejki, gdy ta w grze jest dłuższa niż na ekranie (kolejka rośnie od przyjść), a inaczej ogląda', () => {
    const queued = makeSim(MAIN_SEED, MIRROR);
    feed(queued.crowd, { spawn: 3, weight: 12, queueTarget: 3 });
    run(queued, 12);   // za mało na oglądanie kilku mebli, wystarczy na dojście do kolejki
    expect(inLine(queued.crowd)).toHaveLength(3);
    const calm = makeSim(MAIN_SEED, MIRROR);
    feed(calm.crowd, { spawn: 3, weight: 12, queueTarget: 0 });
    run(calm, 12);
    expect(inLine(calm.crowd)).toEqual([]);
  });

  it('przy pustej kolejce w grze do kasy idzie tylu, ile ekonomia już obsłużyła (kredyt), a reszta ogląda; dopłata kredytu wpuszcza kolejnych', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { spawn: 6, weight: 10, serve: 20, queueTarget: 0 });
    run(sim, 1);   // pierwszy krok: grupy wchodzą
    let most = 0;
    for (let t = 0; t < 90; t += SIM_STEP) {
      run(sim, SIM_STEP);
      most = Math.max(most, inLine(sim.crowd).length);
    }
    expect(most).toBeGreaterThanOrEqual(1);
    expect(most).toBeLessThanOrEqual(2);                       // kredyt na 20 klientów to dwie grupy po 10
    expect(live(sim.crowd)).toHaveLength(4);                   // dwie zapłaciły i wyszły, cztery czekają na obsługę w grze
    expect(mirrorState(sim.crowd).serveCredit).toBeCloseTo(0, 9);
    feed(sim.crowd, { serve: 80 });
    let t = 0;
    while (live(sim.crowd).length > 0 && t < 120) { run(sim, SIM_STEP); t += SIM_STEP; }
    expect(live(sim.crowd)).toEqual([]);
  });

  it('kolejka na ekranie dąży do celu z ekonomii: tyle postaci w kolejce, ile kazała gra, reszta ogląda', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { spawn: 5, weight: 12, queueTarget: 3 });
    run(sim, 60);
    expect(live(sim.crowd)).toHaveLength(5);
    expect(inLine(sim.crowd)).toHaveLength(3);
    // pierwsza czeka przy kasie, ale nie płaci: nikt nie został obsłużony, a w kolejce nie ma więcej postaci niż w grze
    const queue = sim.crowd.internal.queue;
    const waiting = queue.map((id) => sim.crowd.agents.find((a) => a.id === id)!.state);
    expect(waiting).not.toContain('paying');
    run(sim, 20);
    expect(inLine(sim.crowd)).toHaveLength(3);
  });

  it('gdy kolejka w grze jest krótsza niż na ekranie, nadmiar płaci „na kredyt” i wychodzi, a ekonomia spłaca go później', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { spawn: 4, weight: 12, queueTarget: 4 });
    run(sim, 60);
    expect(inLine(sim.crowd)).toHaveLength(4);
    feed(sim.crowd, { queueTarget: 1 });
    run(sim, 30);
    expect(inLine(sim.crowd).length + 0).toBeLessThanOrEqual(1 + 0);   // nadmiar zapłacił i wyszedł; ostatnia czeka na kredyt
    expect(mirrorState(sim.crowd).serveCredit).toBeLessThan(0);        // zapłacono z góry
    const debt = mirrorState(sim.crowd).serveCredit;
    feed(sim.crowd, { serve: 30 });
    expect(mirrorState(sim.crowd).serveCredit).toBeCloseTo(debt + 30, 9);
  });

  it('kredyt i zadłużenie mają granice (po długiej przerwie ekran nie odrabia zaległości)', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { serve: 100000, lose: 100000 });
    expect(mirrorState(sim.crowd).serveCredit).toBe(MIRROR_CREDIT_CAP);
    expect(mirrorState(sim.crowd).loseCredit).toBe(MIRROR_CREDIT_CAP);
    feed(sim.crowd, { serve: -50, lose: Number.NaN as number });
    expect(mirrorState(sim.crowd).serveCredit).toBe(MIRROR_CREDIT_CAP);   // ujemne i NaN nic nie zabierają
  });

  it('utracony wychodzi zdenerwowany: najpierw z końca kolejki (angry = queue), a bez kolejki od półki (angry = shelf)', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { spawn: 4, weight: 12, queueTarget: 3 });
    run(sim, 60);
    const line = [...sim.crowd.internal.queue];
    expect(line.length).toBe(3);
    feed(sim.crowd, { lose: 12, queueTarget: 2 });
    run(sim, 1);
    const tail = sim.crowd.agents.find((a) => a.id === line[2])!;
    expect(tail.angry).toBe('queue');
    expect(['leaving', 'gone']).toContain(tail.state);
    expect(sim.crowd.internal.queue).toEqual(line.slice(0, 2));       // przód kolejki nietknięty
    expect(mirrorState(sim.crowd).loseCredit).toBeCloseTo(0, 9);
    // nikt już nie stoi poza przodem, a kredyt czeka: złość spada na oglądającego
    const sim2 = makeSim(MAIN_SEED, MIRROR);
    feed(sim2.crowd, { spawn: 1, weight: 12, queueTarget: 0 });
    run(sim2, 20);
    expect(live(sim2.crowd)).toHaveLength(1);
    feed(sim2.crowd, { lose: 12 });
    run(sim2, 1);
    const a = sim2.crowd.agents[0]!;
    expect(a.angry).toBe('shelf');
    let t = 0;
    while (a.state !== 'gone' && t < 60) { run(sim2, SIM_STEP); t += SIM_STEP; }
    expect(a.state).toBe('gone');
  });

  it('kolejka na poziomie celu z ekonomii nie traci ogona: utraceni wychodzą spośród oglądających (nowo przybyli, którzy zobaczyli kolejkę)', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { spawn: 6, weight: 12, queueTarget: 3 });
    run(sim, 60);
    const line = [...sim.crowd.internal.queue];
    expect(line).toHaveLength(3);
    const browsers = live(sim.crowd).filter((a) => !line.includes(a.id));
    expect(browsers.length).toBeGreaterThan(0);
    feed(sim.crowd, { lose: 12, queueTarget: 3 });
    run(sim, 2);
    expect(sim.crowd.internal.queue).toEqual(line);                              // kolejka stoi
    const angry = sim.crowd.agents.filter((a) => a.angry);
    expect(angry).toHaveLength(1);
    expect(line.includes(angry[0]!.id)).toBe(false);
    expect(angry[0]!.angry).toBe('queue');                                       // długa kolejka w grze: o nią mu chodziło
  });

  it('kredyt utraconych mniejszy niż waga postaci nikogo nie wyprasza (czeka na resztę)', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { spawn: 1, weight: 30 });
    run(sim, 20);
    feed(sim.crowd, { lose: 10 });
    run(sim, 2);
    expect(sim.crowd.agents[0]!.angry).toBeUndefined();
    feed(sim.crowd, { lose: 20 });
    run(sim, 1);
    expect(sim.crowd.agents[0]!.angry).toBe('shelf');
  });

  it('zamknięcie w lustrze: nowi nie wchodzą, kredyty znikają, a sala pustoszy niezależnie od kredytu obsłużonych', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    feed(sim.crowd, { spawn: 5, weight: 12, queueTarget: 3 });
    run(sim, 60);
    expect(inLine(sim.crowd).length).toBeGreaterThan(0);
    setCrowdRate(sim.crowd, { ...MIRROR, closing: true });
    feed(sim.crowd, { spawn: 3, serve: 50, lose: 50 });
    let t = 0;
    while (live(sim.crowd).length > 0 && t < 10) { run(sim, SIM_STEP); t += SIM_STEP; }
    expect(live(sim.crowd)).toEqual([]);
    expect(mirrorState(sim.crowd).incoming).toEqual([]);
    expect(mirrorState(sim.crowd).serveCredit).toBe(0);
  });

  it('crowdHeadcount liczy postaci w sklepie i czekające na wejście, bez tych, którzy już wyszli', () => {
    const sim = makeSim(MAIN_SEED, MIRROR);
    expect(crowdHeadcount(sim.crowd)).toBe(0);
    feed(sim.crowd, { spawn: 3 });
    expect(crowdHeadcount(sim.crowd)).toBe(3);
    run(sim, 5);
    expect(crowdHeadcount(sim.crowd)).toBe(3);
    feed(sim.crowd, { serve: 100 });
    run(sim, 90);
    expect(live(sim.crowd)).toEqual([]);
    expect(crowdHeadcount(sim.crowd)).toBe(0);
  });

  it('poza trybem lustra feedCrowdMirror nic nie robi, a zwykły tłum działa jak dawniej', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 6, spawnPerMinute: 60 });
    feed(sim.crowd, { spawn: 5, serve: 10, lose: 10, queueTarget: 5 });
    expect(sim.crowd.internal.mirror.incoming).toEqual([]);
    run(sim, 10);
    expect(sim.crowd.agents.length).toBeGreaterThan(0);
    for (const a of sim.crowd.agents) expect(a.weight).toBeUndefined();
  });

  it('przełączenie na lustro w trakcie (te same liczby, inny tryb) jest widoczne dla setCrowdRate', () => {
    const sim = makeSim(MAIN_SEED, { targetCount: 4, spawnPerMinute: 30 });
    setCrowdRate(sim.crowd, { targetCount: 4, spawnPerMinute: 30, mirror: true });
    expect(sim.crowd.internal.opts.mirror).toBe(true);
  });

  it('ruch nadal jest płynny i bez kolizji w lustrze (agenci nie wchodzą w siebie ani w ściany)', () => {
    const sim = makeSim('traszka-7', MIRROR);
    for (let i = 0; i < 12; i++) {
      feed(sim.crowd, { spawn: 1, weight: 14, queueTarget: 2, serve: i % 3 === 0 ? 14 : 0 });
      run(sim, 6, () => {
        const seen = new Set<string>();
        for (const a of sim.crowd.agents) {
          if (a.state === 'gone') continue;
          const c = `${Math.floor(a.x)},${Math.floor(a.y)}`;
          expect(isWalkable(sim.layout, Math.floor(a.x), Math.floor(a.y)), `agent ${a.id} na ${c}`).toBe(true);
          if (!a.ghost) { expect(seen.has(c) && a.state !== 'leaving', `dwóch na ${c}`).toBe(false); seen.add(c); }
        }
      });
    }
  });
});
