import { describe, expect, it } from 'vitest';
import {
  FATIGUE, closeFatigueMonth, createFatigue, dailyTapCeiling, fatigueEfficiency, fatigueNight, sanitizeFatigue,
  spendEnergy, tap, tapCost, tapItems, type FatigueState,
} from './fatigue';


/** Stuka do odmowy rąk i zwraca sumę mocy. */
function tapAll(f: FatigueState, kind: 'kasa' | 'paleta', combo: number): number {
  let power = 0;
  for (let i = 0; i < 1000; i++) {
    const r = tap(f, kind, combo);
    if (!r.ok) break;
    power += r.power;
  }
  return power;
}

describe('pula sił franczyzobiorcy', () => {
  it('stuknięcie zużywa siły; paleta męczy bardziej niż kasa', () => {
    const f = createFatigue();
    const a = tap(f, 'kasa', 1);
    expect(a).toEqual({ ok: true, taps: 1, power: 1, cost: FATIGUE.tapCost.kasa });
    const b = tap(f, 'paleta', 1);
    expect(b.cost).toBeGreaterThan(a.cost);
    expect(f.energy).toBe(FATIGUE.pool - a.cost - b.cost);
    expect(f.tapsToday).toBe(2);
  });

  it('polecenie bez combo (albo z bzdurą) to jedno stuknięcie, a stan zostaje liczbą', () => {
    const f = createFatigue();
    expect(tap(f, 'kasa', Number.NaN).taps).toBe(1);
    expect(tap(f, 'kasa', undefined as unknown as number).taps).toBe(1);
    expect(f.energy).toBe(FATIGUE.pool - 2 * FATIGUE.tapCost.kasa);
    expect(Number.isFinite(f.spentToday) && Number.isFinite(f.tapsToday)).toBe(true);
  });

  it('przy pustej puli ręce odmawiają', () => {
    const f = createFatigue();
    tapAll(f, 'kasa', 1);
    const r = tap(f, 'kasa', 1);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/Ręce odmawiają/);
    expect(f.refusedToday).toBeGreaterThan(0);
  });

  it('combo zostaje w granicach puli: szybkie stukanie nie daje więcej mocy z tych samych sił', () => {
    const one = tapAll(createFatigue(), 'kasa', 1);
    const five = tapAll(createFatigue(), 'kasa', 5);
    const huge = tapAll(createFatigue(), 'kasa', 99);
    expect(one).toBe(FATIGUE.pool / FATIGUE.tapCost.kasa);
    expect(five).toBe(one);
    expect(huge).toBe(one);
  });

  it('gdy sił brakuje na całe combo, przechodzi tylko część stuknięć', () => {
    const f = createFatigue();
    f.energy = 5;
    const r = tap(f, 'kasa', 5);
    expect(r.taps).toBe(2);
    expect(f.energy).toBe(1);
  });

  it('noc po lekkim dniu odnawia całą pulę, po ciężkim tylko część; zmęczenie obniża wydajność', () => {
    const f = createFatigue();
    tap(f, 'kasa', 5);
    fatigueNight(f);
    expect(f.energy).toBe(FATIGUE.pool);
    expect(f.carried).toBe(0);
    expect(fatigueEfficiency(f)).toBe(1);

    tapAll(f, 'kasa', 5);
    expect(fatigueNight(f)).toBe(FATIGUE.pool - FATIGUE.nightRecovery);
    expect(f.energy).toBe(FATIGUE.nightRecovery);
    expect(fatigueEfficiency(f)).toBeCloseTo(1 - FATIGUE.carryPenalty * 0.3);
    expect(tap(f, 'kasa', 1).power).toBeCloseTo(fatigueEfficiency(f));
    expect(f.exhaustedDays).toBe(1);
  });

  it('stukanie do dna dzień w dzień daje mniej niż stukanie z odpoczynkiem', () => {
    const always = createFatigue();
    const paced = createFatigue();
    let a = 0;
    let p = 0;
    for (let day = 0; day < 14; day++) {
      a += tapAll(always, 'kasa', 3);
      // rozsądnie: zużywa tyle, ile noc odda
      for (let i = 0; i < FATIGUE.nightRecovery / FATIGUE.tapCost.kasa; i++) p += tap(paced, 'kasa', 1).power;
      fatigueNight(always);
      fatigueNight(paced);
    }
    expect(paced.carried).toBe(0);
    expect(always.carried).toBe(FATIGUE.pool - FATIGUE.nightRecovery);
    expect(p).toBeGreaterThan(a);
  });

  it('niedziela bez osobnych zasad: stuknięcie kosztuje tyle samo każdego dnia (więcej klientów to sprawa ruchu)', () => {
    expect(tapCost('kasa')).toBe(FATIGUE.tapCost.kasa);
    expect(tapCost('paleta')).toBe(FATIGUE.tapCost.paleta);
    expect(Object.keys(FATIGUE).some((k) => /sunday/i.test(k))).toBe(false);
  });

  it('sufit dnia: najwyżej 50 klientów albo 320 sztuk z palety (jedna paleta), mniej po ciężkiej nocy', () => {
    expect(dailyTapCeiling('kasa')).toBe(50);
    expect(tapItems(dailyTapCeiling('paleta'))).toBe(320);
    expect(dailyTapCeiling('kasa', 70, 30)).toBeCloseTo(35 * 0.82);
  });

  it('siły z kart: nie schodzą poniżej zera i nie rosną ponad pulę', () => {
    const f = createFatigue();
    expect(spendEnergy(f, -60)).toBe(-60);
    expect(spendEnergy(f, -60)).toBe(-40);
    expect(f.energy).toBe(0);
    expect(spendEnergy(f, 500)).toBe(FATIGUE.pool);
  });

  it('raport miesięczny: dni z pustą pulą i odmowy; zapis w obie strony', () => {
    const f = createFatigue();
    tapAll(f, 'paleta', 1);
    fatigueNight(f);
    expect(closeFatigueMonth(f)).toEqual({ exhaustedDays: 1, refused: 1 });
    expect(sanitizeFatigue(JSON.parse(JSON.stringify(f)) as FatigueState)).toEqual(f);
    expect(sanitizeFatigue({ energy: 1e9, carried: -4, tapsToday: 'x' })).toEqual({ ...createFatigue(), energy: FATIGUE.pool });
  });
});
