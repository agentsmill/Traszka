import { describe, expect, it } from 'vitest';
import { freshRun } from '@/sim/run';
import { MINUTES_PER_DAY, OPEN_FROM, PATIENCE } from '../catalog';
import { awaitingDecision, type EconomyState } from '../economy';
import { BOT_NAMES, runBot, type Bot } from './bots';
import type { CardInstance } from './cards';
import { FATIGUE } from './fatigue';
import { economyEnv, economyView, measureBots, playBot } from './economyEnv';
import { TWO_MONTHS } from './sandbox';

const SEED = 'traszka-1';

/** Ścieżki wszystkich liczb nieskończonych albo `NaN` w stanie (po JSON-ie `NaN` zamieniłby się w `null`, więc idziemy po obiekcie). */
function nonFinite(value: unknown, path = '$'): string[] {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [`${path}=${value}`];
  if (Array.isArray(value)) return value.flatMap((v, i) => nonFinite(v, `${path}[${i}]`));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([k, v]) => nonFinite(v, `${path}.${k}`));
  return [];
}

/** Karta na biurku od tej minuty; odpowiedź 0 to „nic się nie dzieje”, 1 kosztuje 100 zł. */
function plant(s: EconomyState): CardInstance {
  const card: CardInstance = {
    seq: s.tycoon.cards.seq++, id: 'fefo', day: Math.floor(s.minute / MINUTES_PER_DAY), showAt: s.minute, params: {},
    answers: [{ delta: {}, mods: [], risk: null }, { delta: { cash: -100 }, mods: [], risk: null }], defaultAnswer: 0,
  };
  s.tycoon.cards.pending.push(card);
  return card;
}

/** Świeża gra bez kart na biurku, żeby liczyły się tylko te, które wstawia test. */
function quietRun(): ReturnType<typeof freshRun> {
  const run = freshRun(SEED);
  run.state.tycoon.cards.pending = [];
  return run;
}

describe('widok bota z prawdziwej ekonomii', () => {
  it('świeża gra: sklep otwarty o 6:00, dwie palety pod drzwiami, pełne siły, profil „kolejka”, zaufanie 60', () => {
    const { state, info } = quietRun();
    const v = economyView(state, info);
    expect(v).toMatchObject({
      minute: OPEN_FROM, mod: OPEN_FROM, open: true, queue: 0, sidewalkPallets: 2, pallets: 2, hallBags: 0, backroomBags: 0,
      energy: FATIGUE.pool, spentToday: 0, profile: 'kolejka', cards: [], trust: 60,
    });
    expect(v.patience).toBeGreaterThanOrEqual(PATIENCE - 2);
    expect(v.cleanliness).toBeGreaterThan(0);
    expect(v.tapCost).toEqual({ kasa: FATIGUE.tapCost.kasa, paleta: FATIGUE.tapCost.paleta });
    expect(nonFinite(v)).toEqual([]);
  });

  it('otwarcie: noc i karta „zamknij na godzinę” zamykają sklep w widoku tak jak w symulacji', () => {
    const { state, info } = quietRun();
    state.minute = 3 * 60;
    expect(economyView(state, info).open).toBe(false);
    state.minute = 12 * 60;
    expect(economyView(state, info).open).toBe(true);
    state.tycoon.cards.active.push({ kind: 'closed', value: 1, from: state.minute, until: state.minute + 60, seq: 99 });
    expect(economyView(state, info).open).toBe(false);
  });

  it('cierpliwość to ta sama liczba, którą kolejka: ulepszenia ją podnoszą, brudna sala i worki w sali obniżają', () => {
    const { state, info } = quietRun();
    const base = economyView(state, info).patience;
    state.upgrades.klima = 1;
    expect(economyView(state, info).patience).toBe(base + 2);
    state.upgrades.klima = 0;
    state.tycoon.hall.cleanliness = 5;
    expect(economyView(state, info).patience).toBeLessThan(base);
    state.tycoon.hall.cleanliness = 100;
    const clean = economyView(state, info).patience;
    state.tycoon.waste.hall = 4;
    expect(economyView(state, info).patience).toBeLessThan(clean);
  });

  it('luz pod progiem WUT: na początku miesiąca dodatni, po dużym ubytku z kart ujemny', () => {
    const { state, info } = quietRun();
    expect(economyView(state, info).wutSlack).toBeGreaterThan(0);
    state.tycoon.wut.month.karty = 1e6;
    expect(economyView(state, info).wutSlack).toBeLessThan(0);
  });

  it('widzi karty, które czekają na odpowiedź, ale nie te, które jeszcze nie nadeszły', () => {
    const { state, info } = quietRun();
    const later = plant(state);
    later.showAt = state.minute + 120;
    expect(economyView(state, info).cards).toEqual([]);
    const now = plant(state);
    expect(economyView(state, info).cards.map((c) => c.seq)).toEqual([now.seq]);
  });
});

describe('polecenia botów idą przez applyCommand', () => {
  it('card.answer: karta na biurku zatrzymuje minutę (step zwraca false), odpowiedź ją zwalnia', () => {
    const run = quietRun();
    const env = economyEnv(run);
    const card = plant(run.state);
    expect(awaitingDecision(run.state)).toBe(true);
    expect(env.step()).toBe(false);
    expect(run.state.minute).toBe(OPEN_FROM);
    expect(env.apply({ type: 'card.answer', seq: card.seq, answer: 1 })).toBe(true);
    expect(env.apply({ type: 'card.answer', seq: card.seq, answer: 1 })).toBe(false);   // odpowiedź jest ważna dokładnie raz
    expect(env.step()).toBe(true);
    expect(run.state.minute).toBe(OPEN_FROM + 1);
  });

  it('card.answer: koszt odpowiedzi trafia do gotówki, a odpowiedź spoza karty jest odmową bez zmian w stanie', () => {
    const run = quietRun();
    const env = economyEnv(run);
    const card = plant(run.state);
    const before = JSON.stringify(run.state);
    expect(env.apply({ type: 'card.answer', seq: card.seq, answer: 7 })).toBe(false);
    expect(env.apply({ type: 'card.answer', seq: 12345, answer: 0 })).toBe(false);
    expect(JSON.stringify(run.state)).toBe(before);
    const cash = run.state.cash;
    expect(env.apply({ type: 'card.answer', seq: card.seq, answer: 1 })).toBe(true);
    expect(run.state.cash).toBe(cash - 100);
  });

  it('staff.profile zmienia profil ludzi, widok go pokazuje; zły profil nie przechodzi', () => {
    const run = quietRun();
    const env = economyEnv(run);
    expect(env.apply({ type: 'staff.profile', profile: 'porzadek' })).toBe(true);
    expect(run.state.tycoon.staff.profile).toBe('porzadek');
    expect(env.view().profile).toBe('porzadek');
    expect(env.apply({ type: 'staff.profile', profile: 'nie-ma' as never })).toBe(false);
  });

  it('tap.till obsługuje klientów z kolejki za siły; combo z BotCommand jest pomijane, a ekonomia liczy je z serii stuknięć', () => {
    const run = quietRun();
    const env = economyEnv(run);
    run.state.minute = 12 * 60;
    run.state.queue = 8;
    expect(env.apply({ type: 'tap.till', combo: 5 })).toBe(true);
    // pierwsze stuknięcie serii to ×1, niezależnie od combo w poleceniu bota
    expect(run.state.queue).toBeCloseTo(7, 9);
    expect(run.state.total.taps).toBe(1);
    expect(env.view().spentToday).toBeCloseTo(FATIGUE.tapCost.kasa, 9);
    expect(env.view().energy).toBeCloseTo(FATIGUE.pool - FATIGUE.tapCost.kasa, 9);
  });

  it('tap.pallet rozładowuje paletę za siły', () => {
    const run = quietRun();
    const env = economyEnv(run);
    const items = run.state.pallets.reduce((n, p) => n + p.total, 0);
    expect(env.apply({ type: 'tap.pallet', combo: 3 })).toBe(true);
    expect(run.state.pallets.reduce((n, p) => n + p.total, 0)).toBeLessThan(items);
    expect(run.state.total.taps).toBe(1);
    expect(env.view().spentToday).toBeGreaterThan(0);
  });

  it('stuknięcie, którego nie da się wykonać (pusta kolejka, zamknięty sklep, brak palet, karta na biurku), to false bez zużycia sił', () => {
    const run = quietRun();
    const env = economyEnv(run);
    run.state.minute = 12 * 60;
    expect(env.apply({ type: 'tap.till', combo: 3 })).toBe(false);   // nikt nie czeka
    run.state.queue = 4;
    run.state.minute = 3 * 60;
    expect(env.apply({ type: 'tap.till', combo: 3 })).toBe(false);   // noc
    run.state.minute = 12 * 60;
    run.state.pallets = [];
    expect(env.apply({ type: 'tap.pallet', combo: 3 })).toBe(false); // brak palet
    run.state.queue = 4;
    plant(run.state);
    expect(env.apply({ type: 'tap.till', combo: 3 })).toBe(false);   // najpierw karta
    expect(run.state.tycoon.fatigue.spentToday).toBe(0);
    expect(run.state.total.taps).toBe(0);
    expect(nonFinite(run.state)).toEqual([]);
  });

  it('bot, który nie odpowie na kartę, nie zawiesza gry w nieskończoność: runBot rzuca wyjątek', () => {
    const mute: Bot = { name: 'bierny', label: 'Niemy', act: () => [] };
    expect(() => runBot(mute, economyEnv(freshRun(SEED)), 3 * MINUTES_PER_DAY)).toThrow(/nie odpowiedział na kartę/);
  });
});

describe('boty przechodzą dwa miesiące prawdziwej gry', () => {
  it.each(BOT_NAMES)('%s: dwa raporty w historii, gra nie stoi i nie ma NaN w stanie', (name) => {
    const play = playBot(name, SEED, TWO_MONTHS);
    const s = play.state;
    expect(s.gameOver).toBe(false);
    expect(s.minute).toBe(61 * MINUTES_PER_DAY);                       // 1 września 6:00 → północ 1 listopada
    expect(s.history).toHaveLength(2);
    expect(s.history.map((h) => h.label)).toEqual(['wrzesień 2026', 'październik 2026']);
    expect(play.reports).toHaveLength(2);
    expect(play.reports.map((r) => r.profit)).toEqual(s.history.map((h) => h.profit));
    expect(play.reports.every((r) => r.detail !== null)).toBe(true);
    expect(nonFinite(s)).toEqual([]);
    expect(nonFinite(play.reports)).toEqual([]);
    expect(awaitingDecision(s)).toBe(false);
  }, 60_000);

  it('ten sam seed i ten sam bot dają ten sam przebieg co do bajtu', () => {
    const a = playBot('mistrz', SEED, 6 * MINUTES_PER_DAY);
    const b = playBot('mistrz', SEED, 6 * MINUTES_PER_DAY);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.state.total.taps).toBeGreaterThan(0);
  });

  it('bot stukający zużywa siły i stuka, bierny nie rusza ani ich, ani kasy', () => {
    const passive = playBot('bierny', SEED, 10 * MINUTES_PER_DAY).state;
    const tapper = playBot('stukacz', SEED, 10 * MINUTES_PER_DAY).state;
    expect(passive.total.taps).toBe(0);
    expect(tapper.total.taps).toBeGreaterThan(50);
  });

  // Pomiar na trzech seedach to dwanaście przebiegów, więc test bierze jeden miesiąc (do raportu za wrzesień); dwa miesiące
  // ma wyżej każdy bot na jednym seedzie. Limit czasu z zapasem, bo pełny zestaw testów liczy równolegle.
  it('measureBots: suma wyników miesięcy każdego bota na każdym seedzie, w kolejności seedów', () => {
    const month = 30 * MINUTES_PER_DAY - OPEN_FROM;
    const seeds = ['makieta', 'kielbasa-42', SEED];
    const table = measureBots(seeds, month);
    expect(Object.keys(table).sort()).toEqual([...BOT_NAMES].sort());
    for (const name of BOT_NAMES) {
      expect(table[name]).toHaveLength(seeds.length);
      expect(nonFinite(table[name])).toEqual([]);
    }
    const play = playBot('mistrz', SEED, month).state;
    expect(play.history).toHaveLength(1);
    expect(table.mistrz[2]).toBe(play.history[0]!.profit);
    expect(table.mistrz[0]).not.toBe(table.mistrz[2]);   // seedy dają różne sklepy
  }, 60_000);
});
