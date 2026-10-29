import { describe, expect, it } from 'vitest';
import { SIM_STEP, createCrowd, crowdHeadcount, feedCrowdMirror, setCrowdRate, stepCrowd, type Crowd } from '@/sim/crowd/crowd';
import { generateStore } from '@/sim/store/generateStore';
import {
  BROWSER_SHARE, CrowdMirror, GROUP_MAX, GROUP_MIN, GROUP_SLEW_PER_S, MAX_SPAWN_PER_UPDATE, QUEUE_GROUP, VISIT_S,
  arrivalsPerSimSecond, groupSizeFor, queueCharacters, smoothGroupSize, type MirrorInput,
} from './crowdMirror';
import { CROWD_MAX } from './scene';

/*
 * Czyste mapowanie liczników ekonomii na zdarzenia tłumu (bez three i bez sceny) oraz jego współpraca z prawdziwą symulacją tłumu.
 * Ekonomii tu nie ma: liczniki podajemy ręcznie, tak jak robi to widok.
 */

const PRESETS = Object.keys(CROWD_MAX) as (keyof typeof CROWD_MAX)[];

describe('arrivalsPerSimSecond', () => {
  it('klienci na godzinę gry → na sekundę czasu symulacji (6 minut gry na sekundę, godzina to 60)', () => {
    expect(arrivalsPerSimSecond(60)).toBeCloseTo(6, 12);
    expect(arrivalsPerSimSecond(30)).toBeCloseTo(3, 12);
    expect(arrivalsPerSimSecond(0)).toBe(0);
  });
  it('wartości spoza zakresu dają zero, nie NaN', () => {
    for (const v of [-5, Number.NaN, Infinity, -Infinity]) expect(Number.isFinite(arrivalsPerSimSecond(v))).toBe(true);
    expect(arrivalsPerSimSecond(Number.NaN)).toBe(0);
    expect(arrivalsPerSimSecond(-1)).toBe(0);
  });
});

describe('groupSizeFor: ilu klientów to jedna postać', () => {
  it('zawsze w widełkach GROUP_MIN…GROUP_MAX, także dla zera, ujemnych i NaN', () => {
    for (const rate of [0, -3, Number.NaN, 0.1, 1, 3, 6, 20, 1000]) {
      for (const max of [0, 1, 10, 16, 22, 500]) {
        for (const speed of [0, 1, 2, 4, 8]) {
          const n = groupSizeFor(rate, max, speed);
          expect(n, `${rate} ${max} ×${speed}`).toBeGreaterThanOrEqual(GROUP_MIN);
          expect(n, `${rate} ${max} ×${speed}`).toBeLessThanOrEqual(GROUP_MAX);
          expect(Number.isInteger(n)).toBe(true);
        }
      }
    }
  });

  it('rośnie z ruchem, maleje z limitem postaci presetu i łagodnie rośnie z prędkością gry', () => {
    const at = (rate: number, preset: keyof typeof CROWD_MAX, speed = 1): number => groupSizeFor(rate, CROWD_MAX[preset], speed);
    for (const preset of PRESETS) {
      let last = 0;
      for (const rate of [0.5, 1, 2, 3, 4.5, 6, 9, 14]) {
        const n = at(rate, preset);
        expect(n).toBeGreaterThanOrEqual(last);
        last = n;
      }
    }
    expect(at(6, 'niska')).toBeGreaterThan(at(6, 'srednia'));
    expect(at(6, 'srednia')).toBeGreaterThanOrEqual(at(6, 'wysoka'));
    expect(at(6, 'niska', 8)).toBeGreaterThanOrEqual(at(6, 'niska', 1));
    expect(at(6, 'niska', 8)).toBeLessThanOrEqual(Math.ceil(at(6, 'niska', 1) * 1.35));   // „łagodnie”: ×8 to ok. 30%
  });

  it('typowy ruch gry (1–3 klientów na sekundę symulacji) mieści się w 10–25 klientach na postać na każdym presecie', () => {
    for (const preset of PRESETS) {
      for (const rate of [1.17, 2.11, 3.05]) expect(groupSizeFor(rate, CROWD_MAX[preset])).toBeLessThanOrEqual(25);
    }
    expect(groupSizeFor(3.05, CROWD_MAX.srednia)).toBeLessThanOrEqual(15);
    expect(groupSizeFor(3.05, CROWD_MAX.wysoka)).toBe(GROUP_MIN);
  });

  it('liczba oglądających (przyjścia × czas pobytu / N) mieści się w udziale limitu postaci, gdy N nie jest przycięte do GROUP_MAX', () => {
    for (const preset of PRESETS) {
      for (const rate of [0.5, 1.2, 2.1, 3.05, 4.4, 6]) {
        const n = groupSizeFor(rate, CROWD_MAX[preset]);
        if (n >= GROUP_MAX || n <= GROUP_MIN) continue;
        expect(rate * VISIT_S / n).toBeLessThanOrEqual(CROWD_MAX[preset] * BROWSER_SHARE + 1e-9);
      }
    }
  });
});

describe('smoothGroupSize: N zmienia się płynnie', () => {
  it('najwyżej GROUP_SLEW_PER_S na sekundę, w obie strony, i nie przeskakuje celu', () => {
    expect(smoothGroupSize(10, 40, 1)).toBeCloseTo(10 + GROUP_SLEW_PER_S, 12);
    expect(smoothGroupSize(40, 10, 3)).toBeCloseTo(40 - 3 * GROUP_SLEW_PER_S, 12);
    expect(smoothGroupSize(10, 10.1, 5)).toBeCloseTo(10.1, 12);
    expect(smoothGroupSize(12, 12, 1)).toBe(12);
  });
  it('dt zerowe, ujemne i NaN nic nie zmieniają (pauza)', () => {
    for (const dt of [0, -1, Number.NaN, -Infinity]) expect(smoothGroupSize(15, 30, dt)).toBe(15);
  });
  it('skok ruchu o godzinę (np. 1,2 → 3 klientów na sekundę) rozkłada zmianę N na kilkanaście sekund, a nie na jedną klatkę', () => {
    let n = groupSizeFor(1.2, CROWD_MAX.niska);
    const goal = groupSizeFor(3.05, CROWD_MAX.niska);
    expect(goal).toBeGreaterThan(n);
    let t = 0;
    let biggestStep = 0;
    while (n < goal && t < 200) {
      const next = smoothGroupSize(n, goal, 0.1);
      biggestStep = Math.max(biggestStep, next - n);
      n = next;
      t += 0.1;
    }
    expect(biggestStep).toBeLessThanOrEqual(GROUP_SLEW_PER_S * 0.1 + 1e-9);
    expect(t).toBeGreaterThan((goal - groupSizeFor(1.2, CROWD_MAX.niska)) / GROUP_SLEW_PER_S - 0.5);
  });
});

describe('queueCharacters: kolejka w grze → postacie w kolejce', () => {
  it('ceil(kolejka / N), przycięte do miejsc w kolejce', () => {
    expect(queueCharacters(0, 10, 6)).toBe(0);
    expect(queueCharacters(1, 10, 6)).toBe(1);
    expect(queueCharacters(10, 10, 6)).toBe(1);
    expect(queueCharacters(11, 10, 6)).toBe(2);
    expect(queueCharacters(25, 10, 6)).toBe(3);
    expect(queueCharacters(25, 12, 6)).toBe(3);
    expect(queueCharacters(500, 10, 6)).toBe(6);
    expect(queueCharacters(60, 10, 4)).toBe(4);
  });
  it('ułamek kolejki liczy się jak w pasku (poniżej pół klienta nikt nie czeka), a dalej zaokrągla do góry', () => {
    expect(queueCharacters(0.3, 10, 6)).toBe(0);
    expect(queueCharacters(0.49, 10, 6)).toBe(0);
    expect(queueCharacters(0.5, 10, 6)).toBe(1);
    expect(queueCharacters(10.4, 10, 6)).toBe(1);   // 10 po zaokrągleniu: jedna grupa
    expect(queueCharacters(10.6, 10, 6)).toBe(2);
  });
  it('wartości spoza zakresu (ujemna kolejka, NaN, brak miejsc, zerowe N) dają zero', () => {
    expect(queueCharacters(-3, 10, 6)).toBe(0);
    expect(queueCharacters(Number.NaN, 10, 6)).toBe(0);
    expect(queueCharacters(20, 10, 0)).toBe(0);
    expect(queueCharacters(20, 0, 6)).toBe(0);
    expect(queueCharacters(20, Number.NaN, 6)).toBe(0);
  });
  it('rośnie z kolejką i maleje z N (dłuższa kolejka w grze to dłuższa na ekranie)', () => {
    for (const n of [10, 15, 25, 40]) {
      let last = 0;
      for (let q = 0; q <= 120; q += 3) {
        const c = queueCharacters(q, n, 8);
        expect(c).toBeGreaterThanOrEqual(last);
        last = c;
      }
    }
    expect(queueCharacters(40, 10, 8)).toBeGreaterThan(queueCharacters(40, 25, 8));
  });
});

/** Wejście z wartościami „spokojnego otwartego sklepu”; test nadpisuje, co go interesuje. */
const input = (over: Partial<MirrorInput> = {}): MirrorInput => ({
  customers: 100, lost: 5, queue: 0, open: true, perHour: 30, maxCharacters: 16, queueSlots: 6, speed: 1, simDt: 0.1, headcount: 0, ...over,
});

describe('CrowdMirror: liczniki → zdarzenia', () => {
  it('pierwsze odświeżenie nie odgrywa zaległości (liczniki gry mogą mieć tysiące klientów z zapisu)', () => {
    const m = new CrowdMirror();
    const feed = m.update(input({ customers: 4000, lost: 300 }));
    expect(feed.spawn).toBe(0);
    expect(feed.serve).toBe(0);
    expect(feed.lose).toBe(0);
    expect(feed.weight).toBeGreaterThanOrEqual(GROUP_MIN);
  });

  it('każde N przyjść to jedna nowa postać o wadze N; ułamek grupy czeka na resztę', () => {
    const m = new CrowdMirror();
    m.update(input());
    const n = m.weight;
    let spawned = 0;
    let served = 0;
    for (let i = 1; i <= 2 * n; i++) {   // po jednym obsłużonym na odświeżenie (kolejka stała)
      const f = m.update(input({ customers: 100 + i }));
      spawned += f.spawn;
      served += f.serve;
      expect(f.weight).toBe(n);
    }
    expect(served).toBe(2 * n);
    expect(spawned).toBe(2);
  });

  it('przyjście to obsłużeni + utraceni + przyrost kolejki (bilans), więc rosnąca kolejka też wprowadza ludzi', () => {
    const m = new CrowdMirror();
    m.update(input({ queue: 0 }));
    const n = m.weight;
    // nikt nie jest obsłużony, nikt nie odpada, a kolejka rośnie o N: przyszła cała grupa
    const grow = m.update(input({ queue: n }));
    expect(grow.spawn).toBe(1);
    expect(grow.serve).toBe(0);
    // kolejka maleje (obsłużeni z kolejki): to nie są nowe przyjścia
    const shrink = m.update(input({ queue: 0, customers: 100 + n }));
    expect(shrink.spawn).toBe(0);
    expect(shrink.serve).toBe(n);
  });

  it('utraceni też są przyjściami (przyszli i odeszli) i dostają własny kredyt', () => {
    const m = new CrowdMirror();
    m.update(input());
    const n = m.weight;
    const f = m.update(input({ lost: 5 + n }));
    expect(f.spawn).toBe(1);
    expect(f.lose).toBe(n);
    expect(f.serve).toBe(0);
  });

  it('kolejka na ekranie: ceil(kolejka / QUEUE_GROUP) przycięte do miejsc, zero gdy sklep zamknięty; N na to nie wpływa', () => {
    for (const perHour of [10, 30, 120]) {
      const m = new CrowdMirror();
      m.update(input({ perHour }));
      expect(m.update(input({ perHour, queue: 0 })).queueTarget).toBe(0);
      expect(m.update(input({ perHour, queue: 1 })).queueTarget).toBe(1);
      expect(m.update(input({ perHour, queue: QUEUE_GROUP })).queueTarget).toBe(1);
      expect(m.update(input({ perHour, queue: 7 })).queueTarget).toBe(Math.ceil(7 / QUEUE_GROUP));   // typowa nasycona kolejka: kilka postaci
      expect(m.update(input({ perHour, queue: 100, queueSlots: 5 })).queueTarget).toBe(5);
      expect(m.update(input({ perHour, queue: 30, open: false })).queueTarget).toBe(0);
    }
  });

  it('zamknięcie: nikt nie wchodzi, zaległe przyjścia przepadają, po ponownym otwarciu liczy się od zera', () => {
    const m = new CrowdMirror();
    m.update(input());
    const n = m.weight;
    m.update(input({ customers: 100 + n - 1 }));                       // prawie cała grupa w drodze
    const closed = m.update(input({ customers: 100 + n + 5, open: false }));
    expect(closed.spawn).toBe(0);
    expect(closed.queueTarget).toBe(0);
    const open = m.update(input({ customers: 100 + n + 6, open: true }));
    expect(open.spawn).toBe(0);                                        // zaległość z przed zamknięcia nie wraca
    expect(open.serve).toBe(1);
  });

  it('przeskok o wiele minut naraz (przewinięcie, nagroda za nieobecność) nie odgrywa zaległej doby w drzwiach', () => {
    const m = new CrowdMirror();
    m.update(input());
    const f = m.update(input({ customers: 100 + 530, lost: 5 + 40, queue: 0 }));
    expect(f.spawn).toBe(0);
    // zwykły ruch po przeskoku działa jak przedtem
    const n = m.weight;
    let spawned = 0;
    for (let i = 1; i <= n; i++) spawned += m.update(input({ customers: 100 + 530 + i, lost: 5 + 40 })).spawn;
    expect(spawned).toBe(1);
  });

  it('liczniki, które cofnęły się (inna gra, inny sklep), biorą się od nowa bez zdarzeń', () => {
    const m = new CrowdMirror();
    m.update(input({ customers: 900 }));
    const f = m.update(input({ customers: 10, lost: 0 }));
    expect(f.spawn).toBe(0);
    expect(f.serve).toBe(0);
    expect(f.lose).toBe(0);
  });

  it('NaN i Infinity w licznikach nie psują automatu (i nie robią zdarzeń)', () => {
    const m = new CrowdMirror();
    m.update(input());
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const f = m.update(input({ customers: bad }));
      expect(f.spawn).toBe(0);
      expect(Number.isFinite(f.weight)).toBe(true);
    }
    const f = m.update(input({ customers: 101 }));
    expect(f.serve).toBe(0);   // po śmieciach liczy się od nowa
  });

  it('przy ×8 jedno odświeżenie niesie osiem razy więcej: nowych postaci najwyżej MAX_SPAWN_PER_UPDATE, reszta nie rośnie bez końca', () => {
    const m = new CrowdMirror();
    m.update(input({ speed: 8, maxCharacters: 22 }));
    const n = m.weight;
    const f = m.update(input({ speed: 8, maxCharacters: 22, customers: 100 + 5 * n }));   // pięć grup naraz
    expect(f.spawn).toBe(MAX_SPAWN_PER_UPDATE);
    // zaległość jest ograniczona do dwóch grup, więc po tym nie wejdzie więcej niż 2 + zwykły ruch
    let later = 0;
    for (let i = 0; i < 5; i++) later += m.update(input({ speed: 8, maxCharacters: 22, customers: 100 + 5 * n })).spawn;
    expect(later).toBeLessThanOrEqual(2);
  });

  it('pełny ekran (headcount = limit) wstrzymuje nowe postaci, a po zwolnieniu miejsca wchodzą', () => {
    const m = new CrowdMirror();
    m.update(input({ maxCharacters: 10 }));
    const n = m.weight;
    const full = m.update(input({ maxCharacters: 10, headcount: 10, customers: 100 + 3 * n }));
    expect(full.spawn).toBe(0);
    const freed = m.update(input({ maxCharacters: 10, headcount: 8, customers: 100 + 3 * n }));
    expect(freed.spawn).toBeGreaterThanOrEqual(1);
    expect(freed.spawn).toBeLessThanOrEqual(2);
  });

  it('zmiana N (inny ruch) nie szarpie: waga rośnie najwyżej o GROUP_SLEW_PER_S na sekundę czasu symulacji', () => {
    const m = new CrowdMirror();
    m.update(input({ perHour: 15, maxCharacters: 10 }));
    let last = m.weight;
    for (let i = 0; i < 1500; i++) {
      m.update(input({ perHour: 45, maxCharacters: 10, simDt: 0.1, customers: 100 }));
      expect(m.weight - last).toBeLessThanOrEqual(1);
      last = m.weight;
    }
    expect(last).toBe(groupSizeFor(arrivalsPerSimSecond(45), 10));
  });

  it('reset zapomina liczniki: następne odświeżenie niczego nie odgrywa', () => {
    const m = new CrowdMirror();
    m.update(input());
    m.reset();
    expect(m.update(input({ customers: 5000 })).spawn).toBe(0);
  });
});

describe('lustro z prawdziwą symulacją tłumu (stały ruch)', () => {
  /** Ruch stały: `rate` klientów na sekundę czasu symulacji, wszyscy obsłużeni (kolejka w grze 0), odświeżenie co 0,1 s. */
  function steady(preset: keyof typeof CROWD_MAX, rate: number, seconds: number, speed = 1): { crowd: Crowd; peak: number; spawned: number; groups: Map<number, number> } {
    const seed = 'lustro-1';
    const layout = generateStore(seed);
    const crowd = createCrowd(layout, seed, { targetCount: 0, spawnPerMinute: 0, mirror: true });
    const mirror = new CrowdMirror();
    const max = CROWD_MAX[preset];
    const perHour = rate * 10;   // 6 minut gry na sekundę: godzina gry to 10 s
    let customers = 0;
    let peak = 0;
    let spawned = 0;
    const groups = new Map<number, number>();
    const dt = 0.1;
    for (let t = 0; t < seconds; t += dt) {
      customers += rate * dt;
      const feed = mirror.update({ customers, lost: 0, queue: 0, open: true, perHour, maxCharacters: max, queueSlots: layout.checkoutQueue.length, speed, simDt: dt, headcount: crowdHeadcount(crowd) });
      spawned += feed.spawn;
      feedCrowdMirror(crowd, feed);
      for (let i = 0; i < Math.round(dt / SIM_STEP); i++) stepCrowd(crowd, layout, SIM_STEP);
      peak = Math.max(peak, crowdHeadcount(crowd));
      for (const a of crowd.agents) groups.set(a.id, a.weight ?? 1);
    }
    return { crowd, peak, spawned, groups };
  }

  it.each(PRESETS)('%s: przy stałym ruchu liczba postaci nie przekracza CROWD_MAX presetu', (preset) => {
    for (const rate of [0.5, 1.2, 2.1, 3.05, 4.5, 6]) {
      const { peak } = steady(preset, rate, 150);
      expect(peak, `${preset} ${rate}/s`).toBeLessThanOrEqual(CROWD_MAX[preset]);
    }
  });

  it('postacie niosą wagę N, a suma wag wchodzących grup odpowiada przyjściom (z dokładnością do grupy w drodze)', () => {
    const rate = 2.1;
    const { groups, spawned } = steady('srednia', rate, 120);
    const weights = [...groups.values()];
    expect(weights.length).toBe(spawned);
    for (const w of weights) { expect(w).toBeGreaterThanOrEqual(GROUP_MIN); expect(w).toBeLessThanOrEqual(GROUP_MAX); }
    const represented = weights.reduce((a, w) => a + w, 0);
    expect(represented).toBeGreaterThan(rate * 120 * 0.85 - 2 * GROUP_MAX);
    expect(represented).toBeLessThanOrEqual(rate * 120 + 1);
  });

  it('typowy ruch na presecie srednia wypełnia salę kilkoma postaciami, a nie jedną i nie dwudziestoma', () => {
    const { crowd, peak } = steady('srednia', 2.1, 150);
    expect(peak).toBeGreaterThanOrEqual(3);
    expect(peak).toBeLessThanOrEqual(CROWD_MAX.srednia);
    expect(crowd.agents.filter((a) => a.state !== 'gone').length).toBeGreaterThanOrEqual(1);
  });

  it('bez ruchu (zamknięty sklep) nikt nie wchodzi, a ci w środku wychodzą', () => {
    const seed = 'lustro-2';
    const layout = generateStore(seed);
    const crowd = createCrowd(layout, seed, { targetCount: 0, spawnPerMinute: 0, mirror: true });
    feedCrowdMirror(crowd, { spawn: 3, weight: 12, serve: 0, lose: 0, queueTarget: 0 });
    for (let i = 0; i < 6 * 30; i++) stepCrowd(crowd, layout, SIM_STEP);
    expect(crowdHeadcount(crowd)).toBe(3);
    setCrowdRate(crowd, { targetCount: 0, spawnPerMinute: 0, closing: true, mirror: true });
    feedCrowdMirror(crowd, { spawn: 5, weight: 12, serve: 0, lose: 0, queueTarget: 0 });   // zamknięte: nikt nie wejdzie
    for (let i = 0; i < 12 * 30; i++) stepCrowd(crowd, layout, SIM_STEP);
    expect(crowd.agents.filter((a) => a.state !== 'gone')).toEqual([]);
    expect(crowdHeadcount(crowd)).toBe(0);
  });
});
