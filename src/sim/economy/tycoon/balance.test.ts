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
 * palety, trafione KPI i audyt (zaufanie od 70 to premia od obrotu, ok. 7 tys. zł miesięcznie). Od SIM_VERSION 5 kart jest ok. 0,5 na
 * dobę zamiast 1,15 (decyzja właściciela z 30.10.2026), każda waży trzy razy więcej (`CARDS.stakes`), a pojedyncze losowanie znaczy
 * więcej: na `makieta` bierny trafia KPI i audyt, kończy z zaufaniem ok. 78 i premią od obrotu, czyli ok. +11 tys. zł. Dlatego bierny
 * ma widełki na czterech z pięciu sklepów i medianę, a na każdym zostaje daleko za mistrzem (najwyżej połowa jego wyniku). Na próbie
 * dziesięciu innych seedów (SIM_VERSION 5) wynik biernego wychodził od −3,5 do +11,6 tys. zł (mediana ok. +0,7 tys.), mistrza od 20
 * do 30 tys. zł; w SIM_VERSION 4 na dziewięciu innych: bierny od −8 do +10 tys. zł, mistrz od 22 do 34 tys. zł.
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
  it('bierny gracz po mandatach i opłacie Centrali ledwo wiąże koniec z końcem: od −4 000 do +2 000 zł na czterech z pięciu sklepów, mediana najwyżej +1 000 zł, zawsze najwyżej połowa wyniku mistrza', () => {
    // decyzja właściciela z 29.10.2026: w okolicy zera albo lekko na minusie, nie wygodnie na plusie
    const totals = results('bierny');
    const inBand = totals.filter(([, total]) => total >= -4000 && total <= 2000);
    expect(inBand.length, totals.map(([seed, t]) => `${seed}: ${Math.round(t)} zł`).join(', ')).toBeGreaterThanOrEqual(4);
    SEEDS.forEach((seed, i) => {
      const passive = run.totals.bierny[i]!;
      expect(passive, `${seed}: bierny ${Math.round(passive)} zł, mistrz ${Math.round(run.totals.mistrz[i]!)} zł`).toBeLessThanOrEqual(0.5 * run.totals.mistrz[i]!);
    });
    const sorted = totals.map(([, t]) => t).sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)], `mediana biernego: ${sorted.map(Math.round).join(', ')}`).toBeLessThanOrEqual(1000);
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
