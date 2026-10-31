import { dayOf, isLastDayOfMonth } from '@/sim/economy/calendar';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { DEBT_WARN, type EconEvent } from '@/sim/economy/economy';
import { outstandingDebt, type RemanentProtocol } from '@/sim/economy/franchisee';
import { trustTerminates } from '@/sim/economy/tycoon/trust';
import { WUT, closeWutMonth, wutTotal } from '@/sim/economy/tycoon/wut';
import { switchStore } from './commands';
import { openStores, refreshSites, setPartner, syncWallet } from './firm';
import type { FirmState, FirmStepOut, FirmStore } from './types';

/*
 * Zamknięcie sklepu (spec §13): Centrala wypowiada umowę sklepowi z zaufaniem 0 przy zamknięciu miesiąca, a gracz może sam wypowiedzieć
 * umowę (miesiąc okresu wypowiedzenia). Gdy zostaje inny otwarty sklep, zamknięcie ma rozliczenie końcowe, płacone od razu z portfela
 * osoby, i gra idzie dalej; zamknięcie ostatniego sklepu kończy grę jak dziś, bez rozliczenia. Polskich zdań stąd nie ma, poza odmową
 * rat (`NOTICE_NO_CREDIT`): zdarzenia to identyfikatory i parametry, tekst składa interfejs.
 */

/** Odmowa raty w okresie wypowiedzenia (§13.2): `applyStoreCommand` zwraca ją jak każdą odmowę ze sklepu. */
export const NOTICE_NO_CREDIT = 'Centrala nie finansuje rat placówki w okresie wypowiedzenia.';

/** Rozliczenie końcowe sklepu: protokół remanentu od ostatniego liczenia, niespłacone raty, nadwyżka czekająca na przelew i suma do zapłaty. */
export interface FinalSettlement { storeId: number; remanent: RemanentProtocol; installments: number; pending: number; total: number }

/**
 * Rozliczenie końcowe sklepu w dniu `day` (czysta, niczego nie zmienia): ubytki od `remanent.fromDay` ponad limit Centrali jak w zwykłym
 * remanencie, niespłacone raty (`total − paid`) i nadwyżka, która czeka na przelew (`outstandingDebt` z SIM 6).
 */
export function finalSettlement(st: FirmStore, day: number): FinalSettlement {
  const fr = st.econ.franchisee;
  const r = fr.remanent;
  const wut = st.econ.tycoon.wut;
  const total = wutTotal(wut);
  const limit = WUT.threshold * Math.max(0, r.revenue);
  const charge = Math.max(0, Math.round(total - limit));
  const remanent: RemanentProtocol = { day, fromDay: r.fromDay, revenue: r.revenue, byReason: { ...wut.month }, total, limit, charge, first: !r.known };
  const installments = fr.installments.reduce((n, i) => n + i.total - i.paid, 0);
  return { storeId: st.id, remanent, installments, pending: r.pending, total: outstandingDebt(fr) + charge };
}

/** Ostatni dzień następnego miesiąca od dnia `day` (koniec miesięcznego okresu wypowiedzenia, §13.2). */
export function noticeEndDay(day: number): number {
  let d = day;
  while (!isLastDayOfMonth(d)) d++;
  d++;
  while (!isLastDayOfMonth(d)) d++;
  return d;
}

/**
 * Czy sklep w tej minucie stracił umowę przez zaufanie 0: `gameOver` ustawia je tylko zamknięcie miesiąca (`closeMonth`), więc to
 * zdarzenie `month` razem z `gameOver` i zaufaniem na zerze. Debet nie wchodzi w grę: zaufanie wygrywa z nim w tej samej minucie.
 */
export const endedByTrust = (st: FirmStore, events: readonly EconEvent[]): boolean =>
  st.econ.gameOver && trustTerminates(st.econ.tycoon.trust.value) && events.some((e) => e.kind === 'month');

/** Czy w tej minucie sklep zamknął miesiąc w dniu końca wypowiedzenia (albo po nim). */
const noticeEnded = (st: FirmStore, events: readonly EconEvent[]): boolean =>
  st.notice !== null && events.some((e) => e.kind === 'month') && dayOf(st.econ.minute - 1) >= st.notice.endDay;

/** Raty, nadwyżka z remanentu i ubytki są rozliczone: nic z tego nie wisi na zamkniętym sklepie (wyposażenie zostaje). */
function settle(st: FirmStore, day: number): void {
  const fr = st.econ.franchisee;
  closeWutMonth(st.econ.tycoon.wut, fr.remanent.revenue);
  fr.installments = [];
  fr.remanent.pending = 0;
  fr.remanent.revenue = 0;
  fr.remanent.fromDay = day;
}

/**
 * Zamyka sklep `id`. Gdy działa jeszcze inny sklep: rozliczenie końcowe schodzi z portfela jednym ruchem (nie z `econ.cash` zamkniętego
 * sklepu, bo `syncWallet` go pomija), lokal staje się „po Traszce” (`closed`, wyposażenie zostaje), aktywny sklep przechodzi na najniższe
 * otwarte `id` razem z pulą sił, a ZUS i dochód z sieci przechodzą na pozostały sklep (`refreshSites`, `setPartner`). Zdarzenia firmy:
 * `settlement` z kwotami, `closed` z powodem i, gdy rozliczenie przekroczyło próg ostrzeżenia o debecie, `debt`.
 *
 * Gdy to ostatni sklep (inne są zamknięte albo właśnie stracą umowę), gra się kończy bez rozliczenia, jak dziś: `over = 'closed'`.
 * Zaufanie 0 niesie już `gameover` sklepu, więc zdarzeń nie dokładamy; koniec wypowiedzenia ustawia `gameOver` i wysyła `gameover` z `notice`.
 */
export function closeStore(f: FirmState, id: number, reason: 'trust' | 'notice', out: FirmStepOut): void {
  const st = f.stores.find((s) => s.id === id);
  if (!st || st.closed || f.over !== null) return;
  const staying = openStores(f).filter((s) => s.id !== id && !s.econ.gameOver);
  if (staying.length === 0) {
    f.over = 'closed';
    if (reason === 'notice') {
      st.econ.gameOver = true;
      out.firm.push({ kind: 'gameover', params: { reason: 'notice' } });
    }
    return;
  }

  const day = dayOf(st.econ.minute);
  const s = finalSettlement(st, day);
  const networkPartner = openStores(f)[0]!.econ.partner;   // dochód z sieci ma sklep o najniższym otwartym `id`; przechodzi dalej
  const before = f.person.wallet;
  f.person.wallet -= s.total;
  settle(st, day);
  st.closed = true;
  if (f.activeId === id) switchStore(f, staying[0]!.id);
  refreshSites(f);
  setPartner(f, networkPartner);
  const p = s.remanent;
  out.firm.push({
    kind: 'settlement', storeId: id,
    params: { installments: s.installments, pending: s.pending, shrinkage: p.total, limit: p.limit, remanent: p.charge, total: s.total },
  });
  out.firm.push({ kind: 'closed', storeId: id, params: { reason } });
  const cash = f.person.wallet;
  // poniżej granicy debetu koniec gry ogłosi pozostały sklep sam w następnej minucie; tu tylko ostrzeżenie o przejściu progu
  if (cash >= DEBT_LIMIT && cash < DEBT_WARN && before >= DEBT_WARN) out.firm.push({ kind: 'debt', params: { cash } });
  syncWallet(f);
}

/** Zamknięcia po minucie firmy, w kolejności `id`: zaufanie 0 przy zamknięciu miesiąca (ma pierwszeństwo) albo koniec wypowiedzenia. */
export function closeDueStores(f: FirmState, stepped: readonly { st: FirmStore; events: readonly EconEvent[] }[], out: FirmStepOut): void {
  for (const { st, events } of stepped) {
    const reason = endedByTrust(st, events) ? 'trust' : noticeEnded(st, events) ? 'notice' : null;
    if (reason !== null) closeStore(f, st.id, reason, out);
  }
}
