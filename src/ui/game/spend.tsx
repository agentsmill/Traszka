import type { EconomyState } from '@/sim/economy/economy';
import { installmentRoom } from '@/sim/economy/economy';
import { forecastMonth, spendCheck, type SpendLevel } from '@/sim/economy/forecast';
import { planFor, type InstallmentPlan } from '@/sim/economy/franchisee';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import type { AnswerInstance } from '@/sim/economy/tycoon/cards';
import { spendWarningText } from './forecastText';
import { t, tr } from '@/i18n';
import { int, percentOf, zl } from './format';

/*
 * Ostrzeżenie przy wydatku: gracz widzi, ile gotówki zostanie mu po zamknięciu miesiąca, zanim kliknie. Tylko ostrzega:
 * przycisk zakupu zostaje włączony, bo decyzja jest jego. Gdy zakupu za gotówkę i tak nie da się zrobić (`price` ponad gotówką),
 * nie dokładamy drugiego komunikatu do „za mało gotówki”. Zakup na raty ma własny wariant (`rata`): kwota to pierwsza rata,
 * a gotówka nie jest potrzebna.
 */

/**
 * Ile gotówki od razu zabierze odpowiedź na kartę (zł, dodatnie to koszt; 0, gdy zyskuje albo nic nie kosztuje): suma pewnych
 * pozycji pieniężnych, tych samych, które `answerCard` księguje w gotówce. Ryzyko i efekty na czas (szacunek `mods`) nie wchodzą.
 */
export function answerCashCost(a: Pick<AnswerInstance, 'delta'>): number {
  const d = a.delta;
  return Math.max(0, -((d.cash ?? 0) + (d.bonus ?? 0) + (d.fine ?? 0) + (d.logistics ?? 0)));
}

/**
 * Czy wydatek `price` w ogóle trzeba oceniać: ma cenę i, o ile nie jest „zawsze” (karta księguje się bez względu na gotówkę),
 * mieści się w gotówce. Rata (`rata`) nie bierze gotówki z góry, więc ocenia się ją zawsze.
 */
const assessable = (s: EconomyState, price: number, always: boolean, rata: boolean): boolean => price > 0 && (always || rata || price <= s.cash);

/** Poziom wydatku `price` na tle prognozy; `ok` dla zakupu poza zasięgiem gotówki albo bez ceny. */
export function spendLevel(s: EconomyState, info: StoreInfo, price: number, always = false, rata = false): SpendLevel {
  return assessable(s, price, always, rata) ? spendCheck(forecastMonth(s, info), price).level : 'ok';
}

/** Atrybut `data-risk` przycisku zakupu: `warn` i `danger` zmieniają jego kolor (CSS), `ok` i `tight` zostawiają zwykły. */
export const spendRisk = (s: EconomyState, info: StoreInfo, price: number, rata = false): SpendLevel | undefined => {
  const level = spendLevel(s, info, price, false, rata);
  return level === 'warn' || level === 'danger' ? level : undefined;
};

/**
 * Wiersz pod opisem zakupu o cenie `price`; nic, gdy zakup nie zepchnie gotówki po zamknięciu miesiąca pod zero. `always`: odpowiedź
 * na kartę decyzji księguje się także wtedy, gdy kosztuje więcej niż gotówka (debet), więc ostrzega zawsze. `rata`: `price` to
 * pierwsza rata. To `span` (blokowy w CSS), bo stoi też w przycisku odpowiedzi, gdzie `div` byłby niedozwolony.
 */
export function SpendNote({ s, info, price, always = false, rata = false }: { s: EconomyState; info: StoreInfo; price: number; always?: boolean; rata?: boolean }) {
  if (!assessable(s, price, always, rata)) return null;
  const check = spendCheck(forecastMonth(s, info), price);
  const text = spendWarningText(check, rata);
  return text ? <span class={`tt-spend ${check.level}`} role="note">{text}</span> : null;
}

// --- Zakup za gotówkę albo na raty ---------------------------------------------------------------------------------------

/** Napis na przycisku rat: „na raty: 6 × 4 500 zł”. */
export const ratyLabel = (plan: InstallmentPlan): string => t`na raty: ${plan.months} × ${zl(plan.monthly)}`;

/**
 * Podpowiedź przycisku rat: ile rat, opłata za finansowanie i suma do spłaty oraz wolny limit rat. Przy limicie zerowym (zaufanie
 * poniżej progu) Centrala nie finansuje wcale. Liczby z `planFor` i `installmentRoom`, tak jak liczy je symulacja.
 */
export function ratyTitle(plan: InstallmentPlan, room: { limit: number; free: number }): string {
  if (room.limit <= 0) return tr('Centrala nie finansuje zakupów przy tak niskim zaufaniu.');
  const limit = t`wolny limit rat ${int(room.free)} z ${zl(room.limit)} miesięcznie`;
  return t`Na raty: ${plan.months} × ${zl(plan.monthly)}. Opłata za finansowanie ${zl(plan.fee)} (${percentOf(plan.feeShare)}), razem do spłaty ${zl(plan.total)}. `
    + t`Pierwsza rata zejdzie z najbliższego przelewu. ${plan.monthly > room.free ? t`Rata przekracza ${limit}.` : t`Mieści się w limicie: ${limit}.`}`;
}

/**
 * Ostrzeżenia pod opisem zakupu o cenie `cost`: za gotówkę i na raty (pierwsza rata). Zwykła funkcja, nie komponent: testy `vnodeTree`
 * widzą wtedy `SpendNote` w drzewie panelu. `locked`: zakup zablokowany (poziom, wymagania), więc ostrzeżeń nie ma. Rata, której limit
 * nie przepuści, nie dostaje ostrzeżenia (przycisk jest wyłączony).
 */
export function buyNotes(s: EconomyState, info: StoreInfo, cost: number, locked: boolean) {
  if (locked) return null;
  const plan = planFor(cost);
  const ratyOk = plan.monthly <= installmentRoom(s).free;
  return (
    <>
      <SpendNote s={s} info={info} price={cost} />
      {ratyOk && <SpendNote s={s} info={info} price={plan.monthly} rata />}
    </>
  );
}

/**
 * Dwa przyciski zakupu o cenie `cost`: za gotówkę (cena, jak dotąd) i na raty („na raty: N × Y zł”). `locked`: blokada zakupu
 * (poziom, wymagania), wtedy oba są wyłączone. Raty są też wyłączone, gdy rata przekracza wolny limit (`installmentRoom`) albo
 * Centrala nie finansuje przy tym zaufaniu. `buy(true)` ma wysłać polecenie z `raty: true`, `buy(false)` zwykłe. Zwykła funkcja
 * (nie komponent) z tego samego powodu co `buyNotes`.
 */
export function buyButtons(s: EconomyState, info: StoreInfo, cost: number, locked: boolean, buy: (raty: boolean) => void) {
  const plan = planFor(cost);
  const room = installmentRoom(s);
  const noRaty = locked || plan.monthly > room.free;
  return (
    <div class="tt-buys" data-tut="buy">
      <button type="button" class="tt-btn tt-buy" data-risk={locked ? undefined : spendRisk(s, info, cost)} disabled={locked || cost > s.cash} onClick={() => buy(false)}>{zl(cost)}</button>
      <button type="button" class="tt-btn tt-rata" data-risk={noRaty ? undefined : spendRisk(s, info, plan.monthly, true)} disabled={noRaty}
        title={ratyTitle(plan, room)} onClick={() => buy(true)}>{ratyLabel(plan)}</button>
    </div>
  );
}
