import { awaitingDecision, type EconomyState } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import { tapCost } from '@/sim/economy/tycoon/fatigue';
import { PRESTIGE_LEVEL, PRESTIGE_REMONT } from '@/game/meta';
import { dayLengthText, finalRank } from '../howto/howToText';
import type { TabId } from '../state';
import { MONEY_NOTES, moneySteps } from './money';

/*
 * Kroki przelotu samouczka (spec samouczka, §4.6): dane, nie kod widoku. Każdy krok wskazuje element gry wartością `data-tut`
 * (albo nic: dymek na środku), ma tytuł i tekst ze stałych gry, a krok z zadaniem ma warunek zaliczenia czytany ze stanu. Kroki
 * o pieniądzach, zaufaniu i ratach leżą w `money.ts`. Samouczek nie wysyła poleceń: zadania wykonuje gracz, a krok najwyżej
 * zmienia stan widoku (zakładkę, zaznaczenie, pauzę).
 */

/** Co krok widzi: stan gry, sklep, otwarta zakładka i prędkość czasu (0 to pauza). */
export interface TourCtx { s: EconomyState; info: StoreInfo; tab: TabId | null; speed: number }

/** Migawka z wejścia w krok: zadanie „stuknij” porównuje z nią licznik stuknięć gracza. */
export interface TourMark { taps: number }
export const markOf = (s: EconomyState): TourMark => ({ taps: s.total.taps });

export interface TourTask {
  /** Wiersz „👉 …” w dymku. */
  hint: string;
  /** Czy zadanie da się teraz wykonać; bez tego krok jest zwykłym krokiem z „Dalej”. Brak pola: zawsze. */
  can?: (ctx: TourCtx) => boolean;
  /** Czy gracz już to zrobił (względem migawki z wejścia w krok). */
  done: (ctx: TourCtx, mark: TourMark) => boolean;
}

export interface TourStep {
  id: string;
  /** Wartość `data-tut` wskazanego elementu albo null (dymek na środku ekranu). */
  target: string | null;
  title: string;
  text: string;
  /** Zakładka ustawiana przy wejściu w krok (null zamyka arkusz); bez pola krok jej nie rusza. */
  tab?: TabId | null;
  /** Zdjąć zaznaczenie obiektu przy wejściu (kliker chowa się pod kartą zaznaczenia). */
  clearSelection?: boolean;
  /** Zdjąć pauzę przy wejściu (stukanie działa tylko, gdy czas idzie). */
  resume?: boolean;
  task?: TourTask;
}

/** Czy 📦 jest teraz aktywny: te same blokady co `tapBlock` (siły, pauza, karta), plus palety, które jest co rozładować. */
export function canTapPallet(ctx: TourCtx): boolean {
  const { s } = ctx;
  return ctx.speed > 0 && s.tycoon.fatigue.energy >= tapCost('paleta') && !awaitingDecision(s) && s.pallets.length > 0;
}

const cel = (): TourStep => ({
  id: 'cel', target: null, tab: null, clearSelection: true,
  title: 'Witaj w Traszce',
  text: `Prowadzisz sklep Traszki na franczyzie. Cel: dojść do rangi „${finalRank().name}” i nie stracić umowy z Centralą. Czas stoi, dopóki nie skończymy.`,
});

const czas = (): TourStep => ({
  id: 'czas', target: 'speed',
  title: 'Czas',
  text: `❚❚ zatrzymuje grę (także spacja), ×1–×8 przyspiesza. Doba przy ×1 trwa ok. ${dayLengthText()}. Teraz czas stoi: samouczek trzyma pauzę.`,
});

const zakladki = (): TourStep => ({
  id: 'zakladki', target: 'tabs',
  title: 'Zakładki',
  text: 'Tu jest zarządzanie: Sklep (kolejka, półki, remanent), Palety, Ludzie, Ulepszenia i Cele. Drugie stuknięcie zamyka zakładkę.',
  task: { hint: 'Otwórz Palety.', done: (ctx) => ctx.tab === 'palety' },
});

/** Zamówienie: przy Asystencie dwa zadania (na „Ręcznie” i z powrotem), przy ręcznym jeden krok bez namawiania do zmiany. */
function zamowienie(auto: boolean): TourStep[] {
  if (!auto) {
    return [{
      id: 'zamowienie', target: 'order', tab: 'palety',
      title: 'Zamówienie',
      text: 'Zamawiasz ręcznie. Gdy zechcesz, Asystent Traszki policzy za Ciebie: przełącznik jest tutaj.',
    }];
  }
  return [
    {
      id: 'reczne', target: 'order-manual', tab: 'palety',
      title: 'Zamówienie',
      text: 'Domyślnie zamawia Asystent Traszki. Zwykle trochę przesadza, bo „klienci to kochają”. Ręcznie sam ustawiasz liczbę palet na jutro.',
      task: { hint: 'Przełącz na „Ręcznie”.', done: (ctx) => !ctx.s.order.auto },
    },
    {
      id: 'asystent', target: 'order-auto', tab: 'palety',
      title: 'Zamówienie',
      text: 'Teraz liczbę palet ustawiasz przyciskami − i +. Na początek zostaw to Asystentowi: liczy za Ciebie.',
      task: { hint: 'Wróć do „Asystent Traszki”.', done: (ctx) => ctx.s.order.auto },
    },
  ];
}

const miejsca = (): TourStep => ({
  id: 'miejsca', target: 'pallets', tab: 'palety',
  title: 'Gdzie stoją palety',
  text: `Pod sklepem grozi mandat Straży Miejskiej. Zaplecze jest bezpieczne, ale małe. W sali i w przejściach palety przeszkadzają klientom, a ⭐ reputacja spada. ${MONEY_NOTES.palety()}`,
});

const ludzie = (): TourStep => ({
  id: 'ludzie', target: 'hire', tab: 'ludzie',
  title: 'Ludzie',
  text: `„+” zatrudnia, „−” zwalnia. ${MONEY_NOTES.ludzie()} Niżej ustawiasz, czym ludzie zajmują się najpierw. Samouczek niczego tu nie kupi.`,
});

const ulepszenia = (): TourStep => ({
  id: 'ulepszenia', target: 'buy', tab: 'ulepszenia',
  title: 'Ulepszenia',
  text: `Sprzęt do slotów, szkolenia i remont, który powiększa sklep. ${MONEY_NOTES.ulepszenia()}`,
});

const cele = (): TourStep => ({
  id: 'cele', target: 'sheet', tab: 'cele',
  title: 'Cele i rozwój',
  text: `Cel tygodnia od Centrali daje XP, ${MONEY_NOTES.kpi()}. Poziomy odblokowują sprzęt i remonty. Kamienie milowe dają Ogonki 🦎: „Odbierz”. `
    + `Po ${PRESTIGE_REMONT}. remoncie albo na ${PRESTIGE_LEVEL}. poziomie otworzysz kolejną Traszkę.`,
});

const karta = (): TourStep => ({
  id: 'karta', target: null, tab: null,
  title: 'Karty decyzji',
  text: 'Codziennie może przyjść karta: sprawa od Centrali albo od życia. Gra czeka, aż wybierzesz. Koszty i zyski są na przyciskach, a domyślna odpowiedź jest zaznaczona.',
});

const start = (): TourStep => ({
  id: 'start', target: 'clicker', tab: null, clearSelection: true, resume: true,
  title: 'Czas rusza',
  text: 'Twoje ręce: 📦 rozładowuje najpilniejszą paletę, 🧾 obsługuje klienta, gdy kasa się korkuje. Każde stuknięcie zjada siły z paska nad przyciskami.',
  task: { hint: 'Stuknij 📦.', can: canTapPallet, done: (ctx, mark) => ctx.s.total.taps > mark.taps },
});

/** Ostatni krok: gdzie szukać więcej (decyzja właściciela: przelot kończy się na „?”). */
const pomoc = (): TourStep => ({
  id: 'pomoc', target: 'help', tab: null,
  title: 'Więcej informacji',
  text: 'Pod „?” jest instrukcja, słowniczek (saldo, wyciąg, raty, remanent…) i ten samouczek. Przy pierwszych zdarzeniach podpowiemy jeszcze krótko.',
});

/**
 * Kroki przelotu ułożone ze stanu na starcie (spec samouczka, §4.5): 16 przy zamówieniu przez Asystenta, 15 przy ręcznym. Kolejność
 * nie zmienia się w trakcie, więc licznik „N / M” zna M od początku.
 */
export function buildTour(ctx: TourCtx): TourStep[] {
  return [
    cel(),
    ...moneySteps(),
    czas(),
    zakladki(),
    ...zamowienie(ctx.s.order.auto),
    miejsca(),
    ludzie(),
    ulepszenia(),
    cele(),
    karta(),
    start(),
    pomoc(),
  ];
}
