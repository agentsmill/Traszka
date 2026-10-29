import { beforeAll, describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, MINUTES_PER_SECOND_CLOSED, MINUTES_PER_SECOND_OPEN, OPEN_FROM, OPEN_TO } from '../catalog';
import { BOT_NAMES } from './bots';
import { measureBots, type BotMeasure } from './economyEnv';

/**
 * Balans na prawdziwej ekonomii (spec §7.5, kryterium właściciela z 29.10.2026): boty z `bots.ts` grają dwa miesiące
 * (wrzesień i październik, 61 dni) na kilku sklepach. Wynik to suma wyników miesięcy (`history[].profit`). Liczby gry stroi
 * się tak, żeby te asercje przechodziły: opłata franczyzowa, mandaty, złota paleta, nagroda za poziom i premia od obrotu.
 *
 * Seedy dają sklepy o różnej wielkości, ale obrót dwóch miesięcy wychodzi podobny (ok. 680–760 tys. zł), bo sprzedaż ogranicza
 * dostawa, jaką rozładuje dwuosobowa zmiana. Wynik biernego rozjeżdżają losowe zdarzenia: dni z chorym pracownikiem (mandaty), złote
 * palety i trafione KPI. Widełki są ciasne i trzymają na tych pięciu seedach, ale nie na każdym sklepie (na próbie dziewięciu innych
 * seedów, SIM_VERSION 4, wynik biernego wychodził od −8 do +10 tys. zł, mistrza od 22 do 34 tys. zł; np. `kiełbasa-42` daje biernemu
 * −7,6 tys. zł). Dodając seed, trzeba więc wiedzieć, że może nie przejść bez dalszego strojenia.
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
  it('bierny gracz kończy dwa miesiące w okolicy zera: najwyżej 5 000 zł na plus albo minus na każdym sklepie', () => {
    for (const [seed, total] of results('bierny')) expect(Math.abs(total), `${seed}: bierny ${Math.round(total)} zł`).toBeLessThanOrEqual(5000);
  });

  it('mistrz (decyzje i stukanie) zarabia 20–40 tys. zł na każdym sklepie', () => {
    for (const [seed, total] of results('mistrz')) {
      expect(total, `${seed}: mistrz ${Math.round(total)} zł`).toBeGreaterThanOrEqual(20_000);
      expect(total, `${seed}: mistrz ${Math.round(total)} zł`).toBeLessThanOrEqual(40_000);
    }
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

  it('karta decyzji wypada średnio 0,95–1,35 razy na dobę: co 2,5–3,5 min przy ×1 i co ok. 19–26 s przy ×8', () => {
    // doba w sekundach z zegara gry: dzień sklepu idzie wolniej niż noc, więc nie wpisujemy okrągłej liczby na sztywno
    const open = OPEN_TO - OPEN_FROM;
    const secondsPerDay = open / MINUTES_PER_SECOND_OPEN + (MINUTES_PER_DAY - open) / MINUTES_PER_SECOND_CLOSED;
    SEEDS.forEach((seed, i) => {
      const perDay = run.cards.bierny[i]! / DAYS;
      const everyAtX1 = secondsPerDay / perDay;
      expect(perDay, `${seed}: ${perDay.toFixed(2)} karty na dobę`).toBeGreaterThanOrEqual(0.95);
      expect(perDay, `${seed}: ${perDay.toFixed(2)} karty na dobę`).toBeLessThanOrEqual(1.35);
      expect(everyAtX1, `${seed}: karta co ${everyAtX1.toFixed(0)} s przy ×1`).toBeGreaterThanOrEqual(2.5 * 60 - 3);
      expect(everyAtX1, `${seed}: karta co ${everyAtX1.toFixed(0)} s przy ×1`).toBeLessThanOrEqual(3.5 * 60 + 3);
      expect(everyAtX1 / 8, `${seed}: karta co ${(everyAtX1 / 8).toFixed(1)} s przy ×8`).toBeGreaterThanOrEqual(2.5 * 60 / 8 - 1);
      expect(everyAtX1 / 8, `${seed}: karta co ${(everyAtX1 / 8).toFixed(1)} s przy ×8`).toBeLessThanOrEqual(3.5 * 60 / 8 + 1);
    });
  });
});
