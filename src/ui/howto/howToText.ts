import {
  ASSISTANT_UNLOAD_MIN, BANKRUPTCY_AT, CATS, CAT_INFO, DELIVERY_AT, FRANCHISE_FEE_FIXED, FRANCHISE_FEE_SHARE, HOT, MINUTES_PER_DAY, MINUTES_PER_SECOND_CLOSED,
  MINUTES_PER_SECOND_OPEN, OPEN_FROM, OPEN_TO, ORDER_DEADLINE, PALLETS_FREE, PALLET_FEE, RETURN_FEE, STAFF_MAX, STRAZ, TILL_TAP_QUEUE_MIN, type Cat,
} from '@/sim/economy/catalog';
import { nextRankAt, rankFor } from '@/sim/economy/progress';
import { KPI } from '@/sim/economy/tycoon/kpi';
import { PROFILE_LABEL, PROFILE_ORDER, STAFF_PROFILES, type StaffTask } from '@/sim/economy/tycoon/staff';
import { SUNDAY_TRAFFIC } from '@/sim/economy/tycoon/sunday';
import { TRUST, turnoverBonusShare } from '@/sim/economy/tycoon/trust';
import { WUT } from '@/sim/economy/tycoon/wut';
import { plural, signedPts, signedZl, zl } from '../game/format';
import { SPEEDS } from '../game/Hud';
import { ENERGY_TITLE } from '../game/tapBlock';

/*
 * Treść okna „Jak grać”: na górze kilka punktów „co robić” (jedno zdanie: co kliknąć albo ustawić i po co), pod spodem krótkie
 * rozwijane szczegóły. Każda liczba pochodzi ze stałych gry (zmiana stałej zmienia tekst), nazwy zakładek i przycisków są takie
 * jak w interfejsie. Okno (HowTo.tsx) tylko to wyświetla.
 */

/** Rozwijana sekcja szczegółów: tytuł w nagłówku `<summary>`, akapity pod spodem. */
export interface HowToSection {
  title: string;
  paragraphs: string[];
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
/** Godziny po polsku: „2 godziny”, „6 godzin”, a ułamek „7,5 godziny”. */
export const hours = (n: number): string => `${num(n)} ${Number.isInteger(n) ? plural(n, 'godzinę', 'godziny', 'godzin') : 'godziny'}`;


/** Czym ludzie zajmują się najpierw w danym profilu pracy: pierwsze zadanie z kolejki profilu (biernik, po „co ludzie robią najpierw”). */
const FIRST_TASK: Record<StaffTask, string> = { kasa: 'kasę', rozladunek: 'palety', wykladanie: 'półki', sprzatanie: 'sprzątanie' };

/**
 * Punkty „co robić” z góry okna: jedno zdanie na punkt, co kliknąć albo ustawić (nazwy jak w interfejsie) i po co. Razem mieszczą się
 * na jednym ekranie telefonu (okno nie przewija się, gdy szczegóły są zwinięte). O mandatach i stukaniu w kasę tylko ogólnie albo wcale:
 * ich szczegóły zmienia balans, a opisuje je dopiero `howToDetails`.
 */
export function howToPoints(): string[] {
  const running = SPEEDS.filter((s) => s.value > 0);
  const slowest = running[0]!;
  const fastest = running[running.length - 1]!;
  const profiles = STAFF_PROFILES.map((p) => `„${PROFILE_LABEL[p]}” ${FIRST_TASK[PROFILE_ORDER[p][0]!]}`).join(', ');

  return [
    `Cel: dojść do rangi „${finalRank().name}” i nie stracić umowy. Centrala wypowie ją przy zerowym zaufaniu.`,
    'Gdy pojawi się karta decyzji, wybierz odpowiedź: gra czeka, a koszty i zyski widać na przyciskach.',
    'Po dostawie przenieś palety spod sklepu na zaplecze (zakładka Palety, przycisk „Na zaplecze”), zanim wróci Straż Miejska.',
    `W zakładce Ludzie ustaw profil pracy, czyli co ludzie robią najpierw: ${profiles}.`,
    'Gdy kolejka rośnie, kup kasę samoobsługową albo drugą kasę (zakładka Ulepszenia): kasjerów jest tyle, ile stanowisk.',
    'Na koniec miesiąca Centrala pobiera opłatę franczyzową: zostaw na nią gotówkę (zakładka Cele, sekcja „Ten miesiąc”).',
    `Tempo zmieniasz u góry (${slowest.label}–${fastest.label}), a Spacja pauzuje.`,
  ];
}

/** Szczegóły pod punktami: zwinięte sekcje z liczbami z bieżących stałych gry. */
export function howToDetails(): HowToSection[] {
  const slowest = SPEEDS.filter((s) => s.value > 0)[0]!;
  const margins = marginRange();
  const steps = trustBonusSteps();
  const bonus = steps.length === 0 ? [] : [`${steps.map((x, i) => (i === 0
    ? `Od ${x.from} punktów Centrala oddaje premię od obrotu: ${percent(x.share)}` : `od ${x.from} punktów ${percent(x.share)}`)).join(', ')}.`];

  return [
    {
      title: 'Pieniądze i ubytki',
      paragraphs: [
        `Zarabiasz marżę, nie obrót: od ${percent(margins.low.margin)} (${margins.low.label}) do ${percent(margins.high.margin)} (${margins.high.label}) ceny towaru, a hot-dogi i kawa dają ${percent(HOT.margin)}.`,
        `Opłata franczyzowa to ${zl(FRANCHISE_FEE_FIXED)} plus ${percent(FRANCHISE_FEE_SHARE)} obrotu.`,
        `Ubytki to przeterminowany towar, kradzieże, pomyłki i „zapomniane” skany na kasach samoobsługowych. Do ${percent(WUT.threshold)} obrotu miesiąca pokrywa je Centrala, ponad limit płacisz Ty (zakładka Sklep).`,
      ],
    },
    {
      title: 'Palety i dostawy',
      paragraphs: [
        `Zamówienie na jutro zamyka się o ${hourOf(ORDER_DEADLINE)}, dostawa przyjeżdża zwykle o ${hourOf(DELIVERY_AT)}. Domyślnie zamawia Asystent Traszki, ręcznie ustawisz je w zakładce Palety.`,
        `Asystent zamawia najwyżej tyle palet, ile ludzie poza kasą rozładują w ${hours(ASSISTANT_UNLOAD_MIN / 60)}: więcej ludzi, więcej towaru.`,
        `Straż Miejska zagląda od ${hourOf(STRAZ.from)}, gdy palety stoją pod sklepem ponad ${hours(STRAZ.graceMin / 60)}: najpierw upomina, potem daje mandat.`,
        `Palety ponad ${PALLETS_FREE} w zamówieniu kosztują po ${zl(PALLET_FEE)}, a gdy brakuje miejsca, kierowca zabiera paletę i liczy ${zl(RETURN_FEE)}.`,
        'Paleta „Do sali” przeszkadza klientom. Worki po rozładunku trzeba wynieść, inaczej zajmą zaplecze.',
      ],
    },
    {
      title: 'Twoje ręce',
      paragraphs: [
        ENERGY_TITLE,
        `W kasę stukasz, gdy nikt przy niej nie stoi albo kolejka czekałaby ponad ${num(TILL_TAP_QUEUE_MIN)} minuty.`,
      ],
    },
    {
      title: 'Ludzie',
      paragraphs: [
        `Najwięcej zatrudnisz ${persons(STAFF_MAX)}. Osobę przypniesz do zadania, a „Kto co robi teraz” pokazuje, kto gdzie jest.`,
      ],
    },
    {
      title: 'Zaufanie Centrali',
      paragraphs: [
        `Zaufanie startuje od ${num(TRUST.start)} punktów, rośnie za trafione KPI (${signedPts(KPI.trustHit)}) i miesiąc na plusie (${signedPts(TRUST.monthProfit)}), a spada za mandat (${signedPts(TRUST.fine)}), miesiąc na minusie (${signedPts(TRUST.monthLoss)}) i palety odesłane (${signedPts(TRUST.returnedPallet)}) lub zabrane (${signedPts(TRUST.driverReturned)}).`,
        ...bonus,
        `Umowę stracisz przy zerze na koniec miesiąca albo gdy dwa raporty z rzędu zastaną Cię z gotówką poniżej ${signedZl(BANKRUPTCY_AT)}.`,
      ],
    },
    {
      title: 'Czas i cele',
      paragraphs: [
        `Doba trwa ok. ${dayLengthText()} przy ${slowest.label}, a sklep działa od ${hourOf(OPEN_FROM)} do ${hourOf(OPEN_TO)}. W niedzielę ruch rośnie ×${num(SUNDAY_TRAFFIC)}.`,
        `W zakładce Cele czeka cel do niedzieli: trafiony daje premię, zaufanie i XP, a nietrafiony odbiera zaufanie (${signedPts(KPI.trustMiss)}).`,
      ],
    },
  ];
}
