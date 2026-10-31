import { dayOf, isLastDayOfMonth } from '@/sim/economy/calendar';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { awaitingDecision, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { buildStatement } from '@/sim/economy/franchisee';
import { defaultAnswer, type MonthPreview, type PreviewProgress } from '@/sim/economy/monthPreview';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { trustTerminates } from '@/sim/economy/tycoon/trust';
import { activeStore, applyStoreCommand, emptyStepOut, refreshSites, stepFirmMinute } from './firm';
import type { FirmState, FirmStore, NetworkSummary } from './types';

/**
 * Podgląd końca miesiąca dla sieci (spec §11.3): to samo co `startMonthPreview`, tylko na kopii firmy i rdzeniem firmy
 * (`stepFirmMinute`), więc każdy sklep liczy się razem z pozostałymi na wspólnej gotówce, w kolejności `id`, z zastępcą w sklepach
 * w tle, otwarciem budów i zamknięciem sklepów dokładnie jak w grze. Wynik zgadza się z zamknięciem miesiąca co do złotówki.
 *
 * Założenie jak w podglądzie sklepu: gracz niczego nie robi, a karta aktywnego sklepu, która zatrzymuje grę, dostaje odpowiedź
 * domyślną (karty sklepów w tle rozstrzyga zastępca w kroku firmy). Prawdziwa firma, jej miasto i dziennik poleceń zostają nietknięte.
 */

/** Podgląd firmy: sumy sieci i podgląd każdego sklepu, który zamknął miesiąc w tym scenariuszu (rosnąco po `id`). */
export interface FirmPreview {
  /** Miesiąc, który zamyka podgląd (etykieta jak w raporcie miesiąca); pusta, gdy gra kończy się przed zamknięciem. */
  label: string;
  /** Gotówka firmy (portfel osoby) w chwili uruchomienia podglądu. */
  cashNow: number;
  /** Gotówka firmy po zamknięciu miesiąca: po przelewach wszystkich sklepów i rozliczeniach sklepów, którym kończy się umowa. */
  cashAfter: number;
  /** Najniższa gotówka firmy po drodze (z przelewami na koniec miesiąca włącznie). */
  lowestCash: number;
  /**
   * Podgląd każdego sklepu jak z `startMonthPreview`; `cashNow` i `lowestCash` to gotówka firmy (kasa jest wspólna), a `cashAfter`
   * to gotówka z wyciągu tego sklepu: sklepy zamykają się po kolei, więc ostatni sklep ma gotówkę po przelewach wszystkich.
   * Sklep, który otworzył się w trakcie podglądu (budowa), też ma swoją część.
   */
  stores: { id: number; preview: MonthPreview }[];
  /** Pakiety otwarcia zapłacone gotówką od ostatniego podsumowania sieci (to samo pole co w podsumowaniu sieci przy zamknięciu). */
  invest: number;
  /**
   * Czy gra firmy kończy się w tym scenariuszu: debet całej gotówki albo zamknięcie ostatniego sklepu. Sklep, który traci umowę,
   * gdy inny gra dalej, gry nie kończy (ma `gameOver` w swojej części). Zamknięcie ostatniego sklepu po wypowiedzeniu to też `trust`
   * (typ zna tylko dwa powody).
   */
  gameOver: 'debt' | 'trust' | null;
  /** Gra skończyła się, zanim którykolwiek sklep zdążył zamknąć miesiąc (debet w środku miesiąca): sumy są wtedy częściowe. */
  endedEarly: boolean;
}

export interface FirmPreviewJob {
  /** Wykonuje najwyżej `maxMinutes` minut gry na kopii; `true`, gdy podgląd jest skończony (miesiąc zamknięty albo koniec gry). */
  step(maxMinutes: number): boolean;
  progress(): PreviewProgress;
  /** Wynik, gdy skończony; do tego czasu `null`. */
  result(): FirmPreview | null;
}

/** Bezpiecznik jak w podglądzie sklepu: miesiąc ma najwyżej 31 dni, plus dzień zapasu. Podgląd, który tyle nie wystarczył, kończy się bez wyniku. */
const MAX_PREVIEW_MINUTES = 32 * 1440;

/** Ostatni dzień miesiąca, w którym jest dzień `from` (jego zamknięcie kończy podgląd). */
function lastDayOfMonthFrom(from: number): number {
  let day = from;
  while (!isLastDayOfMonth(day)) day++;
  return day;
}

/**
 * Kopia do liczenia: wszystko poza miastem przez `structuredClone`, miasto to samo (jest niezmienne, to czysta funkcja seeda, a jego
 * kopia kosztowałaby najwięcej). Flagi sklepów liczą się od nowa z miasta, jak po każdej zmianie składu.
 */
function cloneFirm(f: FirmState): FirmState {
  const { city, ...rest } = f;
  const copy: FirmState = { ...structuredClone(rest), city };
  refreshSites(copy);
  return copy;
}

/** Powód końca gry sklepu jak w podglądzie sklepu: debet (gotówka poniżej granicy) przed zaufaniem. */
const storeReason = (s: EconomyState): MonthPreview['gameOver'] =>
  !s.gameOver ? null : s.cash < DEBT_LIMIT ? 'debt' : trustTerminates(s.tycoon.trust.value) ? 'trust' : null;

/**
 * Zaczyna podgląd: kopiuje `f` i zwraca zadanie do wykonywania porcjami. Gra, która już się skończyła, daje zadanie od razu skończone
 * bez wyniku.
 */
export function startFirmMonthPreview(f: FirmState): FirmPreviewJob {
  const copy = cloneFirm(f);
  const startMinute = activeStore(copy).econ.minute;
  const startDay = dayOf(startMinute);
  const lastDay = lastDayOfMonthFrom(startDay);
  const cashNow = copy.person.wallet;
  let lowest = cashNow;
  let result: FirmPreview | null = null;
  let finished = copy.over !== null || activeStore(copy).econ.gameOver;
  const out = emptyStepOut();
  const reports = new Map<number, MonthReport>();   // wyciągi miesiąca po `id` sklepu (zamknięty w tej minucie też ma wyciąg)
  let summary: NetworkSummary | undefined;

  /** Koniec gry firmy: koniec z `over`, albo jedyny sklep z własnym debetem lub zaufaniem (wtedy `over` ustawia dopiero zamknięcie). */
  const ended = (): boolean => copy.over !== null || activeStore(copy).econ.gameOver;

  /** Odpowiada na kartę aktywnego sklepu odpowiedzią domyślną; `false`, gdy odpowiedź nie przeszła (nie zapętlamy się). */
  const answerDefault = (): boolean => {
    const card = visibleCards(activeStore(copy).econ.tycoon.cards, activeStore(copy).econ.minute)[0];
    if (!card) return false;
    const ok = applyStoreCommand(copy, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) }).result.ok;
    lowest = Math.min(lowest, copy.person.wallet);
    return ok;
  };

  /** Podgląd sklepu: z wyciągu zamknięcia albo, gdy gra skończyła się w środku miesiąca, z naliczeń do tej chwili (bez rat, gwarancji i premii od obrotu). */
  const storePreview = (st: FirmStore): MonthPreview | null => {
    const month = reports.get(st.id);
    const reason = storeReason(st.econ);
    if (month?.statement) {
      const c = month.counters;
      return {
        label: month.label, cashNow, cashAfter: month.cash, lowestCash: lowest, revenue: c.revenue, customers: c.customers,
        statement: month.statement, profit: month.profit, gameOver: reason, endedEarly: false,
      };
    }
    if (st.closed || !st.econ.gameOver) return null;
    const e = st.econ;
    const c = e.month;
    const statement = buildStatement({
      month: e.franchisee.month, guarantee: 0, installments: 0, remanent: e.franchisee.remanent.pending, spent: c.investments,
      fines: c.fines, other: c.other, cashBefore: e.cash, partial: false, ownCosts: st.info.site?.ownCosts ?? true,
    });
    return {
      label: '', cashNow, cashAfter: e.cash, lowestCash: lowest, revenue: c.revenue, customers: c.customers, statement,
      profit: statement.result, gameOver: reason, endedEarly: true,
    };
  };

  const finish = (): void => {
    finished = true;
    const stores: FirmPreview['stores'] = [];
    for (const st of copy.stores) {
      const preview = storePreview(st);
      if (preview) stores.push({ id: st.id, preview });
    }
    if (stores.length === 0) return;
    // debet całej gotówki; sklep zamknięty zaufaniem zostawia rozliczenie na portfelu, więc granicę przekracza dopiero ono (koniec gry
    // ogłasza wtedy pozostały sklep w następnej minucie)
    const gameOver: FirmPreview['gameOver'] = copy.person.wallet < DEBT_LIMIT ? 'debt' : copy.over === 'closed' ? 'trust' : null;
    result = {
      label: stores.find((s) => !s.preview.endedEarly)?.preview.label ?? '', cashNow, cashAfter: copy.person.wallet, lowestCash: lowest, stores,
      invest: summary?.invest ?? copy.monthInvest, gameOver, endedEarly: reports.size === 0,
    };
  };

  return {
    step(maxMinutes: number): boolean {
      if (finished) return true;
      let left = Math.max(1, Math.floor(maxMinutes));
      while (left > 0 && !finished) {
        if (activeStore(copy).econ.minute - startMinute > MAX_PREVIEW_MINUTES) { finished = true; break; }   // bezpiecznik: bez wyniku
        if (awaitingDecision(activeStore(copy).econ)) {
          if (!answerDefault()) { finished = true; break; }
          if (ended()) finish();
          continue;
        }
        const activeId = copy.activeId;   // zdarzenia `active` należą do sklepu aktywnego przed krokiem (zamknięcie sklepu mogło przełączyć)
        out.active.length = 0;
        out.background.length = 0;
        out.firm.length = 0;
        stepFirmMinute(copy, out);
        lowest = Math.min(lowest, copy.person.wallet);
        left--;
        let closed = false;
        for (const e of out.active) if (e.kind === 'month' && e.report) { reports.set(activeId, e.report); closed = true; }
        for (const b of out.background) if (b.event.kind === 'month' && b.event.report) { reports.set(b.storeId, b.event.report); closed = true; }
        for (const e of out.firm) if (e.kind === 'network-report') summary = e.summary;
        if (closed || ended()) finish();
      }
      return finished;
    },
    progress(): PreviewProgress {
      const days = lastDay - startDay + 1;
      return { day: Math.min(days, Math.max(1, dayOf(activeStore(copy).econ.minute) - startDay + 1)), days };
    },
    result: () => result,
  };
}
