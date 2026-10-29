import {
  BANKRUPTCY_AT, CATS, CAT_INFO, DELIVERY_AT, FINE_BASE, FINE_PER_PALLET, FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE, HOT, MEDIA_PER_DAY,
  MINUTES_PER_DAY, MINUTES_PER_SECOND_CLOSED, MINUTES_PER_SECOND_OPEN, OPEN_FROM, OPEN_TO, ORDER_DEADLINE, PALLETS_FREE, PALLET_FEE,
  RETURN_FEE, STAFF_MAX, STAFF_START, WAGE_PER_DAY, type Cat,
} from '@/sim/economy/catalog';
import { nextRankAt, rankFor } from '@/sim/economy/progress';
import { CARDS } from '@/sim/economy/tycoon/cards';
import { FATIGUE } from '@/sim/economy/tycoon/fatigue';
import { KPI } from '@/sim/economy/tycoon/kpi';
import { DEFAULT_PROFILE, PROFILE_LABEL, STAFF_PROFILES } from '@/sim/economy/tycoon/staff';
import { SUNDAY_TRAFFIC } from '@/sim/economy/tycoon/sunday';
import { TRUST, turnoverBonusShare } from '@/sim/economy/tycoon/trust';
import { WUT } from '@/sim/economy/tycoon/wut';
import { plural, signedPts, signedZl, zl } from '../game/format';
import { SPEEDS } from '../game/Hud';

/*
 * Treść okna „Jak grać”: sekcje z akapitami, w których każda liczba pochodzi ze stałych gry (zmiana stałej zmienia tekst).
 * Nazwy zakładek i przycisków są takie jak w interfejsie. Okno (HowTo.tsx) tylko to wyświetla.
 */

export interface HowToSection {
  title: string;
  paragraphs: string[];
  /** Akapity jako punkty listy (krótkie wskazówki), a nie ciągły tekst. */
  list?: boolean;
}

/** Liczba po polsku, do dwóch miejsc po przecinku, bez zbędnych zer: „100”, „2,5”, „1,35”. */
export const num = (n: number): string => n.toLocaleString('pl-PL', { maximumFractionDigits: 2 });

/** Ułamek jako procent z co najwyżej jednym miejscem po przecinku: 0,12 daje „12%”, 0,012 daje „1,2%”, 0,035 daje „3,5%”. */
export const percent = (share: number): string => `${(Math.round(share * 1000) / 10).toLocaleString('pl-PL')}%`;

/** Godzina z minuty doby bez zera z przodu: „6:00”, „23:00”. */
export const hourOf = (minute: number): string => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;

/** Ile sekund trwa doba przy ×1: godziny otwarcia idą wolniej, noc szybciej (`MINUTES_PER_SECOND_*`). */
export function daySeconds(): number {
  const open = OPEN_TO - OPEN_FROM;
  return open / MINUTES_PER_SECOND_OPEN + (MINUTES_PER_DAY - open) / MINUTES_PER_SECOND_CLOSED;
}

/** Długość doby przy ×1 zaokrąglona do 10 s: „3 min 20 s”, a przy pełnych minutach „3 min”. */
export function dayLengthText(): string {
  const total = Math.round(daySeconds() / 10) * 10;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes > 0 ? `${minutes} min ` : ''}${seconds} s`;
}

/** Najwyższa ranga z listy rang gry i poziom, od którego obowiązuje (lista rang w `progress.ts` nie jest wyeksportowana). */
export function finalRank(): { name: string; level: number } {
  let level = 1;
  for (let next = nextRankAt(level); next !== null; next = nextRankAt(level)) level = next;
  return { name: rankFor(level), level };
}

/** Progi zaufania, od których Centrala oddaje premię od obrotu, razem z jej wysokością (wyczytane z `turnoverBonusShare`). */
export function trustBonusSteps(): { from: number; share: number }[] {
  const steps: { from: number; share: number }[] = [];
  for (let value = 0; value <= 100; value++) {
    const share = turnoverBonusShare(value);
    if (share > 0 && share !== (steps[steps.length - 1]?.share ?? 0)) steps.push({ from: value, share });
  }
  return steps;
}

/** Najmniejsza i największa marża kategorii towaru z katalogu. */
export function marginRange(): { low: { label: string; margin: number }; high: { label: string; margin: number } } {
  const sorted = [...CATS].sort((a, b) => CAT_INFO[a].margin - CAT_INFO[b].margin);
  const pick = (c: Cat) => ({ label: CAT_INFO[c].label.toLowerCase(), margin: CAT_INFO[c].margin });
  return { low: pick(sorted[0]!), high: pick(sorted[sorted.length - 1]!) };
}

const persons = (n: number): string => `${num(n)} ${plural(n, 'osobę', 'osoby', 'osób')}`;

/** Sekcje okna „Jak grać” z liczbami z bieżących stałych gry. */
export function howToSections(): HowToSection[] {
  const rank = finalRank();
  const running = SPEEDS.filter((s) => s.value > 0);
  const slowest = running[0]!;
  const fastest = running[running.length - 1]!;
  const margins = marginRange();
  const steps = trustBonusSteps();
  const both = CARDS.none + CARDS.one;
  const lastCircular = CARDS.circularGapMin + CARDS.circularGapSpan - 1;
  const profiles = STAFF_PROFILES.map((p) => `„${PROFILE_LABEL[p]}”`).join(', ');
  const queueProfile = PROFILE_LABEL.kolejka;
  const queueIsDefault = DEFAULT_PROFILE === 'kolejka' ? ' (domyślny)' : '';
  const bonus = steps.length === 0 ? '' : `${steps.map((x, i) => (i === 0
    ? `Od ${x.from} punktów Centrala oddaje premię od obrotu: ${percent(x.share)}` : `od ${x.from} punktów ${percent(x.share)}`)).join(', ')}. `;

  return [
    {
      title: 'Cel gry',
      paragraphs: [
        `Prowadzisz franczyzę sklepu Traszka: zarabiasz, zdobywasz poziomy i dochodzisz do rangi „${rank.name}” (poziom ${rank.level}).`,
        `Centrala wypowiada umowę, gdy zaufanie spadnie do zera przy zamknięciu miesiąca albo gdy dwa raporty z rzędu zastaną Cię z gotówką poniżej ${signedZl(BANKRUPTCY_AT)}.`,
      ],
    },
    {
      title: 'Jak mija czas',
      paragraphs: [
        `Sklep działa od ${hourOf(OPEN_FROM)} do ${hourOf(OPEN_TO)}. Przy ${slowest.label} doba trwa ok. ${dayLengthText()}, a tempo zmieniasz u góry (${slowest.label}–${fastest.label}). Spacja pauzuje.`,
        'Gra stoi też przy kartach decyzji, raporcie miesiąca, ważnych zdarzeniach i w tym oknie.',
      ],
    },
    {
      title: 'Karty decyzji',
      paragraphs: [
        `Dzień przynosi zwykle jedną kartę (szanse: ${percent(CARDS.none)} brak, ${percent(CARDS.one)} jedna, ${percent(1 - both)} dwie). Co ${CARDS.circularGapMin}–${lastCircular} dni jedną z kart jest okólnik Centrali z haczykiem.`,
        'Odpowiedź pokazuje koszt na czerwono i zysk na zielono. Ta z napisem „domyślnie” jest zaznaczona z góry.',
      ],
    },
    {
      title: 'Pieniądze',
      paragraphs: [
        `Zarabiasz marżę, nie obrót: od ${percent(margins.low.margin)} (${margins.low.label}) do ${percent(margins.high.margin)} (${margins.high.label}) ceny towaru z półek, a hot-dogi i kawa dają więcej: ${percent(HOT.margin)}. Płacisz ${zl(WAGE_PER_DAY)} dziennie za osobę, a za media ok. ${zl(MEDIA_PER_DAY)} dziennie w przeciętnym sklepie (mały płaci mniej, duży więcej).`,
        `Na koniec miesiąca Centrala pobiera opłatę franczyzową: ${zl(FRANCHISE_FEE_FIXED)} plus ${percent(FRANCHISE_FEE_SHARE)} obrotu. Zostaw na nią gotówkę: zakładka Cele, sekcja „Ten miesiąc”, pokazuje, ile już się naliczyło.`,
        'Raport miesiąca pokazuje pozycje, zmianę zaufania i jedną wskazówkę.',
      ],
    },
    {
      title: 'Palety',
      paragraphs: [
        `Zamówienie na jutro zamyka się o ${hourOf(ORDER_DEADLINE)}. Domyślnie zamawia Asystent Traszki, a ręcznie ustawisz je w zakładce Palety. Dostawa przyjeżdża następnego dnia, zwykle o ${hourOf(DELIVERY_AT)}. Palety ponad ${PALLETS_FREE} w zamówieniu kosztują po ${zl(PALLET_FEE)}; gdy brakuje miejsca, kierowca zabiera paletę i liczy ${zl(RETURN_FEE)}.`,
        `Paleta pod sklepem grozi mandatem Straży Miejskiej: ${zl(FINE_BASE)} plus ${zl(FINE_PER_PALLET)} za każdą kolejną. Straż patroluje w dzień, a ryzyko rośnie z czasem. Przestaw paletę w zakładce Palety: „Na zaplecze” (miejsc mało) albo „Do sali” (przeszkadza: mniej klientów, krótsza cierpliwość w kolejce).`,
        'Rozładunek to czas ludzi. Po nim zostają worki ze śmieciami: ktoś musi je wynieść, inaczej zajmą zaplecze, a potem salę.',
      ],
    },
    {
      title: 'Ludzie',
      paragraphs: [
        `Na start masz ${persons(STAFF_START)}, najwięcej zatrudnisz ${STAFF_MAX}. Profil pracy w zakładce Ludzie (${profiles}) mówi, co robią najpierw. Osoby możesz przypiąć do zadania; „Kto co robi teraz” pokazuje, kto jest gdzie.`,
      ],
    },
    {
      title: 'Twoje siły',
      paragraphs: [
        `Stukanie to Twoje ręce. Pula to ${num(FATIGUE.pool)} sił na dobę: stuknięcie w kasę kosztuje ${num(FATIGUE.tapCost.kasa)}, w paletę ${num(FATIGUE.tapCost.paleta)}, a noc oddaje ${num(FATIGUE.nightRecovery)}. Zmęczenie przeniesione na jutro osłabia ręce. Stukanie pomaga, ale decyzji nie zastąpi.`,
      ],
    },
    {
      title: 'Zaufanie Centrali',
      paragraphs: [
        `Zaufanie startuje od ${num(TRUST.start)} punktów. Rośnie za trafione KPI (${signedPts(KPI.trustHit)}) i miesiąc na plusie (${signedPts(TRUST.monthProfit)}), a spada za mandat (${signedPts(TRUST.fine)}), miesiąc na minusie (${signedPts(TRUST.monthLoss)}) i odesłaną paletę (${signedPts(TRUST.returnedPallet)}) albo zabraną przez kierowcę (${signedPts(TRUST.driverReturned)}). Zmieniają je też karty decyzji i audyty Centrali.`,
        `${bonus}Zero na koniec miesiąca oznacza wypowiedzenie umowy.`,
      ],
    },
    {
      title: 'WUT (ubytki)',
      paragraphs: [
        `To przeterminowany towar, kradzieże, pomyłki i „zapomniane” skany na kasach samoobsługowych. Do ${percent(WUT.threshold)} obrotu miesiąca pokrywa je Centrala, ponad próg płacisz Ty.`,
      ],
    },
    {
      title: 'KPI tygodnia',
      paragraphs: [
        `W zakładce Cele czeka cel do niedzieli. Trafiony daje premię, zaufanie i XP, a nietrafiony odbiera zaufanie (${signedPts(KPI.trustMiss)}).`,
      ],
    },
    {
      title: 'Czystość, pogoda, niedziela',
      paragraphs: [
        `Brudna sala skraca cierpliwość klientów, a deszcz i śnieg nanoszą więcej błota. W niedzielę duże sklepy są zamknięte, a Traszka działa: ruch rośnie ×${num(SUNDAY_TRAFFIC)}.`,
      ],
    },
    {
      title: 'Na start',
      list: true,
      paragraphs: [
        'Po dostawie przenieś palety spod sklepu na zaplecze, zanim Straż Miejska zacznie obchód.',
        `Profil „${queueProfile}”${queueIsDefault} stawia ludzi najpierw przy kasie. Gdy kolejka i tak rośnie, kup kasę samoobsługową albo drugą kasę (zakładka Ulepszenia): kasjerów jest tyle, ile stanowisk, więc samo zatrudnianie nie pomoże.`,
        'Pilnuj paska WUT (zakładka Sklep) i gotówki na opłatę franczyzową.',
      ],
    },
  ];
}
