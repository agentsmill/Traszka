import { forecastMonth, type MonthForecast } from '@/sim/economy/forecast';
import type { Statement } from '@/sim/economy/franchisee';
import { openStores } from './firm';
import type { FirmState } from './types';

/**
 * Prognoza paska dla sieci (spec §11.3): `forecastMonth` każdego otwartego sklepu (czysta, bez symulacji, niczego nie zmienia) i ich
 * suma. Debet dotyczy wspólnej gotówki, więc „Zostanie” i ostrzeżenia przy zakupach liczą sumę, a każdy sklep ma w `stores` własną
 * prognozę do osobnej części wyciągu. Dokładny wynik daje podgląd końca miesiąca (`preview.ts`).
 *
 * Sklepy w budowie i rozliczenie końcowe sklepu, któremu kończy się wypowiedzenie, nie wchodzą do prognozy: ich pieniądze nie są
 * jeszcze naliczone w wyciągach (pakiet za gotówkę już zszedł z portfela, rata pakietu wejdzie do wyciągu nowego sklepu).
 */

export interface FirmForecast extends MonthForecast {
  /** Prognoza każdego otwartego sklepu, rosnąco po `id`. Gotówka po zamknięciu sklepu to portfel plus jego „Zostaje Ci”. */
  stores: { id: number; f: MonthForecast }[];
}

/** Pola wyciągu, które sumują się między sklepami; `cashAfter` (portfel plus suma „Zostaje Ci”) i `partial` składa `forecastFirm`. */
const SUMMED = [
  'margin', 'bonus', 'guarantee', 'transfer', 'installments', 'pallets', 'remanent', 'deductions', 'wages', 'media', 'zus', 'vat',
  'accounting', 'costs', 'net', 'result', 'spent', 'fines', 'other',
] as const satisfies readonly Exclude<keyof Statement, 'cashAfter' | 'partial'>[];

const sum = (list: readonly MonthForecast[], pick: (m: MonthForecast) => number): number => list.reduce((n, m) => n + pick(m), 0);

/**
 * Prognoza całej firmy. Jeden otwarty sklep to `forecastMonth` tego sklepu bez zmian. Kasy otwartych sklepów są odbiciem portfela
 * osoby (`syncWallet` po każdym kroku i poleceniu), więc prognoza sklepu liczy od tej samej gotówki co portfel.
 */
export function forecastFirm(f: FirmState): FirmForecast {
  const stores = openStores(f).map((st) => ({ id: st.id, f: forecastMonth(st.econ, st.info) }));
  if (stores.length === 1) return { ...stores[0]!.f, stores };

  const list = stores.map((s) => s.f);
  const net = sum(list, (m) => m.net);
  const cashAfter = f.person.wallet + net;
  const statement: Statement = {
    ...list[0]!.statement, cashAfter, partial: list.some((m) => m.statement.partial),
    ...Object.fromEntries(SUMMED.map((k) => [k, sum(list, (m) => m.statement[k])])),
  };
  return { saldo: sum(list, (m) => m.saldo), installments: sum(list, (m) => m.installments), statement, net, cashAfter, stores };
}
