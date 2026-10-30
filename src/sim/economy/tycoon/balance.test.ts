import { beforeAll, describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, MINUTES_PER_SECOND_CLOSED, MINUTES_PER_SECOND_OPEN, OPEN_FROM, OPEN_TO } from '../catalog';
import { BOT_NAMES } from './bots';
import { measureBots, type BotMeasure } from './economyEnv';

/**
 * Balans na prawdziwej ekonomii (spec §7.5, kryterium właściciela z 29.10.2026): boty z `bots.ts` grają dwa miesiące
 * (wrzesień i październik, 61 dni) na kilku sklepach. Wynik to suma wyników miesięcy (`history[].profit`). Liczby gry stroi
 * się tak, żeby te asercje przechodziły: opłata franczyzowa, mandaty, złota paleta, nagroda za poziom i premia od obrotu.
 *
 * Od SIM_VERSION 5 ekonomia jest urealniona (decyzja właściciela z 30.10.2026): sklep na start ma ok. 260–350 klientów dziennie
 * (6–7,5 tys. zł obrotu), franczyzobiorcy zostaje przy przeciętnym zaufaniu ok. 16,5% obrotu (marża minus opłata Centrali plus premie),
 * a płace to 500 zł dziennie za osobę na zmianie. Cel właściciela: bierny gracz kilka tysięcy złotych na plus miesięcznie, mistrz
 * wyraźnie więcej. Na tych pięciu sklepach bierny ma za dwa miesiące od +2,5 do +24 tys. zł (mediana ok. +11 tys.), mistrz od 18 do
 * 38 tys. zł. Rozrzut między sklepami robi wielkość sali (media i ruch z półek) i reputacja: przy krótkiej kolejce rośnie, a z nią ruch.
 * Kart jest ok. 0,5 na dobę, a każda waży trzy razy więcej (`CARDS.stakes`).
 * Wcześniej (SIM_VERSION 4 i SIM 5 przed urealnieniem) Centrala zabierała ok. 15% obrotu, a bierny kończył dwa miesiące w okolicy zera.
 */
const SEEDS = ['traszka-1', 'kopytka-541', 'makieta', 'lublin-9', 'seed-3'];
const DAYS = 61;

let run: BotMeasure;
beforeAll(() => {
  run = measureBots(SEEDS, DAYS * MINUTES_PER_DAY);
}, 120_000);

/** Wynik bota na każdym seedzie jako pary (seed, zł), żeby komunikat błędu mówił, który sklep zawiódł. */
const results = (bot: (typeof BOT_NAMES)[number]): [string, number][] => SEEDS.map((seed, i) => [seed, run.totals[bot][i]!]);

describe('balans na prawdziwej ekonomii (dwa miesiące, boty z bots.ts)', () => {
  it('bierny gracz zarabia kilka tysięcy złotych miesięcznie: na każdym sklepie na plus (do 30 tys. zł za dwa miesiące), mediana 5–20 tys. zł', () => {
    // decyzja właściciela z 30.10.2026 (urealnienie): bierny kilka tysięcy na plus miesięcznie, mistrz wyraźnie więcej
    const totals = results('bierny');
    for (const [seed, total] of totals) {
      expect(total, `${seed}: bierny ${Math.round(total)} zł`).toBeGreaterThanOrEqual(0);
      expect(total, `${seed}: bierny ${Math.round(total)} zł`).toBeLessThanOrEqual(30_000);
    }
    const sorted = totals.map(([, t]) => t).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    expect(median, `mediana biernego: ${sorted.map(Math.round).join(', ')}`).toBeGreaterThanOrEqual(5_000);
    expect(median, `mediana biernego: ${sorted.map(Math.round).join(', ')}`).toBeLessThanOrEqual(20_000);
  });

  it('mistrz (decyzje i stukanie) zarabia 15–50 tys. zł na każdym sklepie i co najmniej 8 tys. zł więcej niż bierny', () => {
    SEEDS.forEach((seed, i) => {
      const master = run.totals.mistrz[i]!;
      const passive = run.totals.bierny[i]!;
      expect(master, `${seed}: mistrz ${Math.round(master)} zł`).toBeGreaterThanOrEqual(15_000);
      expect(master, `${seed}: mistrz ${Math.round(master)} zł`).toBeLessThanOrEqual(50_000);
      expect(master - passive, `${seed}: mistrz ${Math.round(master)} zł, bierny ${Math.round(passive)} zł`).toBeGreaterThanOrEqual(8_000);
    });
  });

  it('stukanie dokłada najwyżej 20% wyniku mistrza (mistrz minus decydent)', () => {
    SEEDS.forEach((seed, i) => {
      const master = run.totals.mistrz[i]!;
      const extra = master - run.totals.decydent[i]!;
      expect(extra, `${seed}: stukanie dołożyło ${Math.round(extra)} zł z ${Math.round(master)} zł`).toBeLessThanOrEqual(0.2 * master);
    });
  });

  it('decyzje bez stukania wygrywają ze stukaniem bez decyzji na każdym sklepie', () => {
    SEEDS.forEach((seed, i) => {
      expect(run.totals.decydent[i]!, `${seed}: decydent ${Math.round(run.totals.decydent[i]!)}, stukacz ${Math.round(run.totals.stukacz[i]!)} zł`)
        .toBeGreaterThan(run.totals.stukacz[i]!);
    });
  });

  it('żaden bot nie kończy gry w dwa miesiące (Centrala nie wypowiada umowy)', () => {
    for (const bot of BOT_NAMES) {
      SEEDS.forEach((seed, i) => expect(run.gameOver[bot][i], `${seed}: ${bot} stracił umowę`).toBe(false));
    }
  });

  it('karta decyzji wypada średnio 0,4–0,65 razy na dobę: co ok. 5–8,5 min przy ×1 i co ok. 40–65 s przy ×8', () => {
    // decyzja właściciela z 30.10.2026: „zmniejszmy ilość eventów do 0,5 na dobę” (karty dnia i okólniki razem)
    // doba w sekundach z zegara gry: dzień sklepu idzie wolniej niż noc, więc nie wpisujemy okrągłej liczby na sztywno
    const open = OPEN_TO - OPEN_FROM;
    const secondsPerDay = open / MINUTES_PER_SECOND_OPEN + (MINUTES_PER_DAY - open) / MINUTES_PER_SECOND_CLOSED;
    SEEDS.forEach((seed, i) => {
      const perDay = run.cards.bierny[i]! / DAYS;
      const everyAtX1 = secondsPerDay / perDay;
      expect(perDay, `${seed}: ${perDay.toFixed(2)} karty na dobę`).toBeGreaterThanOrEqual(0.4);
      expect(perDay, `${seed}: ${perDay.toFixed(2)} karty na dobę`).toBeLessThanOrEqual(0.65);
      expect(everyAtX1, `${seed}: karta co ${everyAtX1.toFixed(0)} s przy ×1`).toBeGreaterThanOrEqual(secondsPerDay / 0.65 - 1);
      expect(everyAtX1, `${seed}: karta co ${everyAtX1.toFixed(0)} s przy ×1`).toBeLessThanOrEqual(secondsPerDay / 0.4 + 1);
    });
  });
});
