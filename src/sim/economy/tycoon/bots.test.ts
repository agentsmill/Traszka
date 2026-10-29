import { describe, expect, it } from 'vitest';
import { MARGIN_PER_CUSTOMER, MINUTES_PER_DAY } from '../catalog';
import { BOTS, BOT_NAMES, chooseProfile, runBot, type BotName, type BotView } from './bots';
import { FATIGUE, dailyTapCeiling } from './fatigue';
import {
  TWO_MONTHS, createSandbox, sandboxEnv, sandboxScale, stepPassive, stepSandbox, summarize, SANDBOX_DEFAULT,
  type SandboxConfig, type SandboxState, type SandboxSummary,
} from './sandbox';
import { NO_ROBOTS } from './staff';
import { SUNDAY_TRAFFIC, dayTrafficMult } from './sunday';

const SEEDS = ['makieta', 'kiełbasa-42', 'traszka-1'];

function play(name: BotName, cfg: Partial<SandboxConfig> = {}, minutes = TWO_MONTHS): SandboxState {
  const s = createSandbox(cfg);
  runBot(BOTS[name], sandboxEnv(s), minutes);
  return s;
}

// Dwa miesiące na trzech seedach dla każdego bota: liczone raz dla całego pliku.
const RUNS = new Map<string, { state: SandboxState; sum: SandboxSummary }>();
function run(name: BotName, seed: string): { state: SandboxState; sum: SandboxSummary } {
  const key = `${name}:${seed}`;
  if (!RUNS.has(key)) {
    const state = play(name, { seed });
    RUNS.set(key, { state, sum: summarize(state) });
  }
  return RUNS.get(key)!;
}

describe('makieta sklepu', () => {
  it('ten sam seed i te same decyzje dają ten sam przebieg; zapis JSON w połowie wznawia go bez różnic', () => {
    const a = play('mistrz', {}, 12 * MINUTES_PER_DAY);
    const b = play('mistrz', {}, 12 * MINUTES_PER_DAY);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    const copy = JSON.parse(JSON.stringify(a)) as SandboxState;
    runBot(BOTS.mistrz, sandboxEnv(a), 5 * MINUTES_PER_DAY);
    runBot(BOTS.mistrz, sandboxEnv(copy), 5 * MINUTES_PER_DAY);
    expect(JSON.stringify(copy)).toBe(JSON.stringify(a));
  });

  it('karta decyzji zatrzymuje grę: minuta nie mija, a bot bez odpowiedzi kończy się błędem', () => {
    const s = createSandbox();
    expect(s.tycoon.cards.pending.some((c) => c.showAt <= s.minute)).toBe(true);
    const at = s.minute;
    expect(stepSandbox(s)).toBe(false);
    expect(s.minute).toBe(at);
    expect(() => runBot({ name: 'bierny', label: 'Niemy', act: () => [] }, sandboxEnv(s), 10)).toThrow(/gra stoi/);
    runBot(BOTS.bierny, sandboxEnv(s), 10);
    expect(s.minute).toBe(at + 10);
  });

  it('dwa miesiące to dwa raporty; każda złotówka gotówki jest w którejś pozycji raportu', () => {
    for (const name of BOT_NAMES) {
      const { state, sum } = run(name, 'makieta');
      expect(state.reports).toHaveLength(2);
      expect(state.cash).toBeCloseTo(2000 + state.reports.reduce((n, r) => n + r.result, 0), 6);
      expect(sum.results.every((r) => Number.isFinite(r))).toBe(true);
    }
  });

  it('wszystkie moduły pracują: palety zostawiają worki, sala się brudzi i jest sprzątana, karty przychodzą', () => {
    const s = play('bierny', {}, 10 * MINUTES_PER_DAY);
    const m = s.tycoon.staff.month;
    expect(m.worked.rozladunek).toBeGreaterThan(0);
    expect(m.worked.wykladanie).toBeGreaterThan(0);
    expect(m.worked.sprzatanie).toBeGreaterThan(0);
    expect(s.tycoon.waste.month.produced).toBeGreaterThan(20);
    expect(s.tycoon.waste.month.removed).toBeGreaterThan(15);
    expect(s.tycoon.hall.monthMinutes).toBeGreaterThan(9 * 1000);
    // karta zatrzymuje grę: bierny gracz zatwierdza odpowiedź zaznaczoną z góry
    expect(s.outcomes.length).toBeGreaterThan(10);
    expect(s.outcomes.every((o) => o.isDefault)).toBe(true);
    expect(s.tycoon.staff.profile).toBe('kolejka');
    const { state } = run('bierny', 'makieta');
    expect(state.reports[1].cleanlinessAvg).toBeGreaterThan(60);
    expect(state.reports[1].cleanlinessAvg).toBeLessThan(100);
  });

  it('za mało miejsca na zapleczu i jedna osoba: worki lądują w sali i skracają cierpliwość', () => {
    const s = createSandbox({ staff: 1, backroomSpots: 1 });
    const env = sandboxEnv(s);
    let maxHall = 0;
    let minPatience = Infinity;
    for (let i = 0; i < 10 * MINUTES_PER_DAY; i++) {
      stepPassive(s);
      maxHall = Math.max(maxHall, s.tycoon.waste.hall);
      if (s.tycoon.waste.hall > 0) minPatience = Math.min(minPatience, env.view().patience);
    }
    expect(maxHall).toBeGreaterThan(0);
    expect(minPatience).toBeLessThan(6);
  });

  it('automatyka z warsztatu zastępuje minuty ludzi: mniej mandatów, mniej czekania przy paletach, więcej czasu na sprzątanie', () => {
    // 20 dni: jeszcze przed raportem za wrzesień, więc statystyki miesiąca są całe
    const plain = play('bierny', { seed: 'traszka-1' }, 20 * MINUTES_PER_DAY);
    const robots = play('bierny', { seed: 'traszka-1', robots: { ...NO_ROBOTS, tasmociag: 2, edward: 1, prasa: 1 } }, 20 * MINUTES_PER_DAY);
    expect(robots.total.fines).toBeLessThan(plain.total.fines);
    expect(robots.tycoon.staff.month.starved.rozladunek).toBeLessThan(plain.tycoon.staff.month.starved.rozladunek);
    expect(robots.tycoon.staff.month.robot.rozladunek).toBeGreaterThan(0);
    expect(robots.tycoon.hall.monthSum / robots.tycoon.hall.monthMinutes).toBeGreaterThan(plain.tycoon.hall.monthSum / plain.tycoon.hall.monthMinutes);
  });
});

describe('decyzje użytkownika z 28.10.2026 w makiecie', () => {
  it('niedziela: sklep działa jak co dzień, ale przychodzi więcej ludzi (duże sklepy zamknięte)', () => {
    expect(dayTrafficMult(5)).toBe(SUNDAY_TRAFFIC);
    expect(dayTrafficMult(4)).toBe(1);
    const s = createSandbox();
    const perDay: number[] = [];
    let last = 0;
    for (let d = 0; d < 14; d++) {
      runBot(BOTS.bierny, sandboxEnv(s), d === 0 ? MINUTES_PER_DAY - 6 * 60 : MINUTES_PER_DAY);
      perDay.push(s.total.customers - last);
      last = s.total.customers;
    }
    const sundays = [5, 12].map((d) => perDay[d]);
    const weekdays = perDay.filter((_, d) => d !== 5 && d !== 12 && d !== 0);
    const avg = weekdays.reduce((n, x) => n + x, 0) / weekdays.length;
    for (const x of sundays) expect(x).toBeGreaterThan(1.15 * avg);
  });

  it('kasy samoobsługowe: „zapomniane” skany trafiają do WUT (kradzieże), a nie obcinają marży', () => {
    const plain = play('bierny', { seed: 'sco' }, 10 * MINUTES_PER_DAY);
    const sco = play('bierny', { seed: 'sco', sco: 2 }, 10 * MINUTES_PER_DAY);
    const share = (s: SandboxState): number => s.tycoon.wut.month.kradziez / s.month.revenue;
    expect(share(sco)).toBeGreaterThan(share(plain) + 0.005);
  });
});

describe('decyzje użytkownika z 28.10.2026, druga tura', () => {
  // od 6:00 dnia 0 do 22:00 dnia 29 (30 września): godzinę przed zamknięciem miesiąca
  const BEFORE_CLOSE = 29 * MINUTES_PER_DAY + 22 * 60 - 6 * 60;

  it('zaufanie na zerze w środku miesiąca to jeszcze nie koniec umowy', () => {
    const s = createSandbox();
    runBot(BOTS.bierny, sandboxEnv(s), 10 * MINUTES_PER_DAY);
    s.tycoon.trust.value = 0;
    runBot(BOTS.bierny, sandboxEnv(s), 5 * MINUTES_PER_DAY);
    expect(s.terminated).toBe(false);
  });

  it('wypowiedzenie przy zamknięciu miesiąca, gdy zaufanie dalej jest na zerze; dobry wynik miesiąca je ratuje', () => {
    const lost = createSandbox();
    runBot(BOTS.bierny, sandboxEnv(lost), BEFORE_CLOSE);
    lost.tycoon.trust.value = 0;
    lost.month.margin -= 1e6;   // miesiąc na minusie: wynik nie podniesie zaufania
    runBot(BOTS.bierny, sandboxEnv(lost), 120);
    expect(lost.reports).toHaveLength(1);
    expect(lost.terminated).toBe(true);

    const saved = createSandbox();
    runBot(BOTS.bierny, sandboxEnv(saved), BEFORE_CLOSE);
    saved.tycoon.trust.value = 0;
    runBot(BOTS.bierny, sandboxEnv(saved), 120);
    expect(saved.reports[0].result).toBeGreaterThan(0);
    expect(saved.terminated).toBe(false);
  });
});

describe('boty i balans na poziomie modułów (spec §7.5)', () => {
  it('bot „decyzje bez stukania” wygrywa z botem „stukanie bez decyzji” na każdym seedzie', () => {
    for (const seed of SEEDS) {
      expect(run('decydent', seed).sum.total, seed).toBeGreaterThan(run('stukacz', seed).sum.total);
    }
  });

  it('stukanie w granicach puli dokłada najwyżej 20% wyniku', () => {
    for (const seed of SEEDS) {
      const tapper = run('stukacz', seed).sum.total;
      const passive = run('bierny', seed).sum.total;
      expect(tapper - passive, seed).toBeLessThanOrEqual(0.2 * tapper);
    }
  });

  it('sufit stukania: nawet gdyby każde stuknięcie w kasę ratowało klienta, to najwyżej 12% marży typowego dnia', () => {
    const ceiling = dailyTapCeiling('kasa') * MARGIN_PER_CUSTOMER;
    expect(ceiling / sandboxScale(SANDBOX_DEFAULT).dailyMargin).toBeLessThan(0.12);
    expect(dailyTapCeiling('paleta') * 8).toBeLessThanOrEqual(320);
  });

  it('dobre decyzje dają wyraźnie lepszy wynik niż bierność (w makiecie co najmniej o 30%)', () => {
    for (const seed of SEEDS) {
      const passive = run('bierny', seed).sum.total;
      expect(run('decydent', seed).sum.total - passive, seed).toBeGreaterThan(0.3 * passive);
      expect(run('mistrz', seed).sum.total, seed).toBeGreaterThan(passive);
    }
  });

  it('decydent czyta karty, bierny zatwierdza domyślne; zaufanie idzie za decyzjami', () => {
    for (const seed of SEEDS) {
      const d = run('decydent', seed);
      const p = run('bierny', seed);
      expect(d.state.outcomes.filter((o) => o.isDefault).length, seed).toBeLessThan(d.state.outcomes.length / 2);
      expect(p.state.outcomes.every((o) => o.isDefault), seed).toBe(true);
      expect(d.state.xp, seed).toBeGreaterThan(0);
      expect(d.sum.trust, seed).toBeGreaterThan(p.sum.trust + 15);
      expect(p.sum.trust, seed).toBeGreaterThan(20);
      expect(d.sum.trust, seed).toBeLessThan(100);
    }
  });

  it('stukacz codziennie zostaje bez sił, mistrz rzadko przenosi zmęczenie na jutro', () => {
    const carried = (name: BotName): number[] => {
      const s = createSandbox({ seed: 'makieta' });
      const env = sandboxEnv(s);
      const out: number[] = [];
      runBot(BOTS[name], env, MINUTES_PER_DAY - 6 * 60);
      for (let d = 0; d < 20; d++) {
        runBot(BOTS[name], env, MINUTES_PER_DAY);
        out.push(s.tycoon.fatigue.carried);
      }
      return out;
    };
    const t = carried('stukacz');
    const m = carried('mistrz');
    // do dna: zostaje najwyżej resztka mniejsza niż jedno stuknięcie
    expect(t.every((c) => c > FATIGUE.pool - FATIGUE.nightRecovery - FATIGUE.tapCost.paleta)).toBe(true);
    expect(m.filter((c) => c > 0).length).toBeLessThanOrEqual(4);
  });

  it('wskazówka raportu pokazuje to, co naprawdę bolało (mandaty u biernego gracza)', () => {
    expect(run('bierny', 'kiełbasa-42').state.reports.map((r) => r.hint.id)).toContain('mandaty');
  });

  it('profil ludzi bota: kolejka, gdy klienci zaczynają odchodzić; palety z chodnika, gdy jest spokojnie', () => {
    const base: BotView = {
      minute: 600, mod: 600, open: true, queue: 0, patience: 6, sidewalkPallets: 0, pallets: 0, cleanliness: 90, hallBags: 0,
      backroomBags: 0, energy: 100, spentToday: 0, tapCost: { kasa: 2, paleta: 2.5 }, profile: 'kolejka', cards: [], wutSlack: 0, trust: 60,
    };
    expect(chooseProfile({ ...base, queue: 5, sidewalkPallets: 2 })).toBe('kolejka');
    expect(chooseProfile({ ...base, queue: 1, sidewalkPallets: 2 })).toBe('dostawa');
    expect(chooseProfile({ ...base, queue: 1, cleanliness: 60 })).toBe('porzadek');
    expect(chooseProfile(base)).toBe('kolejka');
    expect(BOTS.bierny.act({ ...base, queue: 9 })).toEqual([]);
    expect(BOTS.stukacz.act({ ...base, queue: 3.4 })).toEqual([{ type: 'tap.till', combo: 3 }]);
    expect(BOTS.stukacz.act({ ...base, energy: 1, queue: 3 })).toEqual([]);
  });
});
