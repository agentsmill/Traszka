import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_UNLOAD_MIN, CATS, CAT_INFO, DEBT_LIMIT, DELIVERY_AT, FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE, HOT, MINUTES_PER_DAY, MINUTES_PER_SECOND_CLOSED,
  MINUTES_PER_SECOND_OPEN, OPEN_FROM, OPEN_TO, ORDER_DEADLINE, PALLETS_FREE, PALLET_FEE, PALLET_ITEMS, STAFF_MAX, STRAZ, TAP_ITEMS,
  TILL_TAP_QUEUE_MIN,
} from '@/sim/economy/catalog';
import { nextRankAt, rankFor } from '@/sim/economy/progress';
import { FATIGUE } from '@/sim/economy/tycoon/fatigue';
import { KPI } from '@/sim/economy/tycoon/kpi';
import { PROFILE_LABEL, PROFILE_ORDER, STAFF_PROFILES } from '@/sim/economy/tycoon/staff';
import { SUNDAY_TRAFFIC } from '@/sim/economy/tycoon/sunday';
import { TRUST, turnoverBonusShare } from '@/sim/economy/tycoon/trust';
import { WUT } from '@/sim/economy/tycoon/wut';
import { plural } from '../game/format';
import { SPEEDS } from '../game/Hud';
import { ENERGY_TITLE } from '../game/tapBlock';
import { stringLiterals } from '../game/sourceLiterals';
import { dayLengthText, daySeconds, finalRank, hourOf, hours, howToDetails, howToPoints, marginRange, num, percent, trustBonusSteps } from './howToText';

/** Cały tekst okna: punkty, potem tytuły i akapity szczegółów, jeden na wiersz. */
const text = (): string => [...howToPoints(), ...howToDetails().flatMap((s) => [s.title, ...s.paragraphs])].join('\n');
/** Słowa jak w szkicu instrukcji: tokeny z literą albo cyfrą, razem z nagłówkami. */
const words = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const pl = (n: number): string => n.toLocaleString('pl-PL');

/** Podmienia pola obiektu stałych na czas `fn` (obiekty `as const` są w czasie działania zwykłymi obiektami) i przywraca je zawsze. */
function patched(target: object, patch: Record<string, number>, fn: () => void): void {
  const obj = target as Record<string, number>;
  const before = Object.fromEntries(Object.keys(patch).map((k) => [k, obj[k]!]));
  Object.assign(obj, patch);
  try { fn(); } finally { Object.assign(obj, before); }
}

describe('funkcje pomocnicze treści', () => {
  it('percent: udział jako procent z jednym miejscem po przecinku tylko wtedy, gdy trzeba', () => {
    expect(percent(0.12)).toBe('12%');
    expect(percent(0.012)).toBe('1,2%');
    expect(percent(0.035)).toBe('3,5%');
    expect(percent(1 - 0.15 - 0.6)).toBe('25%');   // 0,25000000000000006 w liczbach zmiennoprzecinkowych
  });

  it('hours: liczba godzin z odmianą, ułamek w dopełniaczu („7,5 godziny”)', () => {
    expect(hours(1)).toBe('1 godzinę');
    expect(hours(2)).toBe('2 godziny');
    expect(hours(6)).toBe('6 godzin');
    expect(hours(7.5)).toBe('7,5 godziny');
    expect(hours(22)).toBe('22 godziny');
  });

  it('hourOf: godzina z minuty doby bez zera z przodu', () => {
    expect(hourOf(6 * 60)).toBe('6:00');
    expect(hourOf(23 * 60)).toBe('23:00');
    expect(hourOf(11 * 60 + 5)).toBe('11:05');
  });

  it('num: polski zapis liczb, do dwóch miejsc po przecinku', () => {
    expect(num(100)).toBe('100');
    expect(num(2.5)).toBe('2,5');
    expect(num(1.35)).toBe('1,35');
  });

  it('doba przy ×1 to godziny otwarcia przy jednym tempie i noc przy drugim, w tekście zaokrąglona do 10 s', () => {
    const open = OPEN_TO - OPEN_FROM;
    expect(daySeconds()).toBeCloseTo(open / MINUTES_PER_SECOND_OPEN + (MINUTES_PER_DAY - open) / MINUTES_PER_SECOND_CLOSED, 9);
    expect(dayLengthText()).toBe('3 min 20 s');   // 170 s dnia i 30 s nocy
  });

  it('finalRank: ostatnia ranga z listy i poziom, od którego obowiązuje', () => {
    const { name, level } = finalRank();
    expect(name).toBe(rankFor(level));
    expect(nextRankAt(level)).toBeNull();                 // dalej nie ma nazwanej rangi
    expect(nextRankAt(level - 1)).toBe(level);            // a poprzedni poziom prowadzi dokładnie do niej
    expect(level).toBe(50);
    expect(name).toBe('Legendarna Paleta');
  });

  it('trustBonusSteps: progi i wysokości premii wyczytane z turnoverBonusShare', () => {
    const steps = trustBonusSteps();
    expect(steps.length).toBeGreaterThan(0);
    for (const { from, share } of steps) {
      expect(turnoverBonusShare(from)).toBe(share);
      expect(turnoverBonusShare(from - 1)).toBeLessThan(share);   // próg jest pierwszym punktem z taką premią
    }
    expect(steps.map((x) => x.share)).toEqual([...steps.map((x) => x.share)].sort((a, b) => a - b));
  });

  it('marginRange: najmniejsza i największa marża z katalogu, z nazwą kategorii małymi literami', () => {
    const margins = CATS.map((c) => CAT_INFO[c].margin);
    const { low, high } = marginRange();
    expect(low.margin).toBe(Math.min(...margins));
    expect(high.margin).toBe(Math.max(...margins));
    expect(low.label).toBe('alkohol');
    expect(high.label).toBe('słodycze');
  });
});

describe('treść okna „Jak grać”', () => {
  const pointsText = (): string => howToPoints().join('\n');
  const detailsText = (): string => howToDetails().flatMap((s) => s.paragraphs).join('\n');

  it('na górze 5–7 punktów „co robić”, razem najwyżej ok. 110 słów (jeden ekran telefonu)', () => {
    const points = howToPoints();
    expect(points.length).toBeGreaterThanOrEqual(5);
    expect(points.length).toBeLessThanOrEqual(7);
    expect(words(pointsText())).toBeGreaterThanOrEqual(60);
    expect(words(pointsText())).toBeLessThanOrEqual(110);
    for (const p of points) expect(words(p), p).toBeLessThanOrEqual(24);   // jedno krótkie zdanie na punkt
  });

  it('szczegóły to zwinięte sekcje w ustalonej kolejności, każda z treścią', () => {
    expect(howToDetails().map((s) => s.title)).toEqual(['Pieniądze i ubytki', 'Palety i dostawy', 'Twoje ręce', 'Ludzie', 'Zaufanie Centrali', 'Czas i cele']);
    for (const s of howToDetails()) expect(s.paragraphs.length, s.title).toBeGreaterThan(0);
  });

  it('punkty i szczegóły razem mają najwyżej ok. 450 słów (z nagłówkami)', () => {
    const n = words(text());
    expect(n).toBeGreaterThanOrEqual(200);
    expect(n).toBeLessThanOrEqual(450);
  });

  it('żadnych śladów po szablonie, wykrzykników ani sklejonych spacji; każdy punkt i akapit kończy się kropką', () => {
    const lines = [...howToPoints(), ...howToDetails().flatMap((s) => [s.title, ...s.paragraphs])];
    for (const p of lines) {
      expect(p, p).not.toMatch(/[{}$]|undefined|NaN|null|\[object|Infinity|!/);
      expect(p, p).not.toMatch(/ {2}|\s$|^\s/);
    }
    for (const p of [...howToPoints(), ...howToDetails().flatMap((s) => s.paragraphs)]) expect(p, p).toMatch(/\.$/);
  });

  it('punkty: cel, karta, palety, ludzie, kolejka, opłata i tempo, z nazwami jak w interfejsie', () => {
    const [goal, card, pallets, people, queue, fee, speed] = howToPoints();
    expect(goal).toBe(`Cel: dojść do rangi „${rankFor(50)}” i nie stracić umowy. Centrala wypowie ją przy zerowym zaufaniu.`);
    expect(card).toContain('karta decyzji');
    expect(pallets).toContain('zakładka Palety, przycisk „Na zaplecze”');
    expect(people).toContain('W zakładce Ludzie ustaw profil pracy');
    expect(queue).toContain('zakładka Ulepszenia');
    expect(fee).toContain('zakładka Cele, sekcja „Ten miesiąc”');
    expect(speed).toBe(`Tempo zmieniasz u góry (${SPEEDS[1]!.label}–${SPEEDS[SPEEDS.length - 1]!.label}), a Spacja pauzuje.`);
  });

  it('punkty nie obiecują nic o częstości mandatów ani o stukaniu w kasę (to opisze balans po zmianie mechaniki)', () => {
    expect(pointsText()).not.toMatch(/stuk|raz na|co \d/i);
    expect(howToPoints().slice(0, -1).join('\n')).not.toMatch(/\d/);   // bez cyfr (poza zakresem tempa w ostatnim punkcie)
  });

  it('profile pracy w punkcie: pierwsze zadanie każdego profilu to zadanie z jego kolejki w grze', () => {
    expect(PROFILE_ORDER.kolejka[0]).toBe('kasa');
    expect(PROFILE_ORDER.dostawa[0]).toBe('rozladunek');
    expect(PROFILE_ORDER.porzadek[0]).toBe('sprzatanie');
    expect(howToPoints()[3]).toBe('W zakładce Ludzie ustaw profil pracy, czyli co ludzie robią najpierw: „Kolejka” kasę, „Dostawa” palety, „Porządek” sprzątanie.');
    for (const p of STAFF_PROFILES) expect(pointsText()).toContain(`„${PROFILE_LABEL[p]}”`);
  });

  it('każda liczba w szczegółach to stała gry: pieniądze i ubytki', () => {
    const t = detailsText();
    expect(t).toContain(`od ${Math.round(CAT_INFO.alkohol.margin * 100)}% (alkohol) do ${Math.round(CAT_INFO.slodycze.margin * 100)}% (słodycze) ceny towaru`);
    expect(t).toContain(`hot-dogi i kawa dają ${Math.round(HOT.margin * 100)}%`);
    expect(HOT.margin).toBeGreaterThan(marginRange().high.margin);   // „dają więcej niż reszta” jest prawdą
    expect(t).toContain(`Opłata franczyzowa to ${FRANCHISE_FEE_FIXED} zł plus ${percent(FRANCHISE_FEE_SHARE)} obrotu.`);
    expect(t).toContain(`Do ${pl(WUT.threshold * 100)}% obrotu miesiąca pokrywa je Centrala, ponad limit płacisz Ty`);
    expect(t).toContain('Ubytki to przeterminowany towar, kradzieże, pomyłki i „zapomniane” skany');
  });

  it('każda liczba w szczegółach to stała gry: palety, ludzie, czas', () => {
    const t = detailsText();
    expect(t).toContain(`Zamówienie na jutro zamyka się o ${ORDER_DEADLINE / 60}:00, dostawa przyjeżdża zwykle o ${DELIVERY_AT / 60}:00`);
    expect(t).toContain('Domyślnie zamawia Asystent Traszki, ręcznie ustawisz je w zakładce Palety');
    expect(t).toContain(`Palety ponad ${PALLETS_FREE} w zamówieniu kosztują po ${PALLET_FEE} zł`);
    expect(t).toContain('Palet nikt nie odsyła: gdy zabraknie miejsca, nadmiar stoi w przejściach sali, klienci się o niego potykają i odchodzą, a reputacja spada, dopóki palet nie rozładujesz');
    expect(t).not.toMatch(/odesł|zabiera paletę|zabrane/);   // odsyłania palet już nie ma (decyzja z 30.10.2026)
    expect(t).toContain(`Najwięcej zatrudnisz ${STAFF_MAX} ${plural(STAFF_MAX, 'osobę', 'osoby', 'osób')}`);
    expect(t).toContain(`Doba trwa ok. 3 min 20 s przy ${SPEEDS[1]!.label}, a sklep działa od ${OPEN_FROM / 60}:00 do ${OPEN_TO / 60}:00`);
    expect(t).toContain(`W niedzielę ruch rośnie ×${pl(SUNDAY_TRAFFIC)}`);
  });

  it('Straż, limit asystenta i stukanie: liczby ze stałych (zmiany z 29.10.2026)', () => {
    const t = detailsText();
    expect(t).toContain(`rozładują w ${hours(ASSISTANT_UNLOAD_MIN / 60)}: więcej ludzi, więcej towaru`);
    expect(t).toContain(`Straż Miejska zagląda od ${STRAZ.from / 60}:00, gdy palety stoją pod sklepem ponad ${hours(STRAZ.graceMin / 60)}: najpierw upomina, potem daje mandat`);
    expect(t).toContain(`kolejka czekałaby ponad ${TILL_TAP_QUEUE_MIN} minuty`);
  });

  it('„Twoje ręce” zaczyna się od zdania o Siłach z dymka paska, a liczby w nim są ze stałych', () => {
    const hands = howToDetails().find((s) => s.title === 'Twoje ręce')!;
    expect(hands.paragraphs[0]).toBe(ENERGY_TITLE);
    expect(ENERGY_TITLE).toMatch(/^Siły to Twoja energia na stukanie: /);
    expect(ENERGY_TITLE).toContain(`stuknięcie w paletę to ${TAP_ITEMS} sztuk`);
    expect(ENERGY_TITLE).toContain(`noc oddaje ${FATIGUE.nightRecovery}`);
    // „cała pula to mniej więcej dwie trzecie palety”: pełne siły w stuknięciach w paletę dają 320 sztuk, a paleta ma od SIM 5 480 (±15%)
    expect(ENERGY_TITLE).toContain('cała pula to mniej więcej dwie trzecie palety');
    const poolItems = FATIGUE.pool / FATIGUE.tapCost.paleta * TAP_ITEMS;
    expect(Math.abs(poolItems / PALLET_ITEMS - 2 / 3)).toBeLessThanOrEqual(0.15);
    expect(words(ENERGY_TITLE)).toBeLessThanOrEqual(32);   // jedno zdanie
  });

  it('każda liczba w szczegółach to stała gry: zaufanie, umowa i cele', () => {
    const t = detailsText();
    expect(t).toContain(`Zaufanie startuje od ${TRUST.start} punktów`);
    expect(t).toContain(`trafione KPI (+${KPI.trustHit}) i miesiąc na plusie (+${TRUST.monthProfit})`);
    expect(t).toContain(`mandat (−${-TRUST.fine}) i miesiąc na minusie (−${-TRUST.monthLoss}).`);
    expect([turnoverBonusShare(69), turnoverBonusShare(70), turnoverBonusShare(84), turnoverBonusShare(85)]).toEqual([0, 0.02, 0.02, 0.03]);
    expect(t).toContain('Od 70 punktów Centrala oddaje premię od obrotu: 2%, od 85 punktów 3%.');
    expect(t).toContain(`Umowę stracisz przy zerze na koniec miesiąca albo od razu, gdy gotówka spadnie poniżej −${pl(-DEBT_LIMIT)} zł`);
    expect(t).toContain(`nietrafiony odbiera zaufanie (−${-KPI.trustMiss})`);
  });

  it('zmiana stałej zmienia tekst (liczby nie są wpisane w treść)', () => {
    const before = text();
    patched(TRUST, { start: 45, fine: -2, monthLoss: -9 }, () => {
      expect(text()).toContain('Zaufanie startuje od 45 punktów');
      expect(text()).toContain('mandat (−2)');
      expect(text()).toContain('miesiąc na minusie (−9)');
    });
    patched(HOT, { margin: 0.5 }, () => expect(text()).toContain('hot-dogi i kawa dają 50%'));
    patched(WUT, { threshold: 0.02 }, () => expect(text()).toContain('Do 2% obrotu miesiąca'));
    patched(KPI, { trustMiss: -5 }, () => expect(text()).toContain('odbiera zaufanie (−5)'));
    expect(text()).toBe(before);   // po podmianach wszystko wróciło
  });
});

describe('treść nie ma liczb wpisanych na sztywno', () => {
  it('skaner literałów: napisy i szablony bez kodu z ${...} i bez komentarzy', () => {
    const src = "const a = `x ${f(`y 1`, 'z 2')} w 3`; // 4 `nie`\n/* 5 */ const b = \"q \\\" 6\";";
    expect(stringLiterals(src)).toEqual(['x ', 'y 1', 'z 2', ' w 3', 'q " 6']);
  });

  it('żaden literał napisowy w howToText.ts nie zawiera cyfry (liczby idą ze stałych, a nie z tekstu)', () => {
    // Stałe pierwotne (`WAGE_PER_DAY`, `FRANCHISE_FEE_*`…) to wiązania modułów, których test nie podmieni, więc "równa się stałej" przeszłoby
    // także dla liczby wpisanej w tekst. Ten skan to uzupełnia. Wyjątek: znak dopełnienia '0' w `padStart` przy godzinach, który nie jest liczbą z gry.
    const src = readFileSync(fileURLToPath(new URL('./howToText.ts', import.meta.url)), 'utf8');
    const literals = stringLiterals(src);
    expect(literals.length).toBeGreaterThan(50);   // skaner naprawdę coś znalazł
    const withDigits = literals.filter((s) => /\d/.test(s) && s !== '0');
    expect(withDigits).toEqual([]);
  });
});
