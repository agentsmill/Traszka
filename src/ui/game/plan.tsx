import type { PlanOutlook } from '@/sim/economy/plan';
import { forecastMonth } from '@/sim/economy/forecast';
import { forecastFirm } from '@/sim/firm/forecast';
import { isNetwork } from '../city/storeSwitcherModel';
import type { EconView, FirmView, GameActions } from '../state';
import { planFirstText, planLines, topUpLabel, topUpNote } from './planText';

/*
 * Plan sprzedaży Centrali w interfejsie: wiersz pod paskiem prognozy (`PlanRow`: postęp, werdykt z karą albo kosztem dobicia i stopniem,
 * przełącznik „dobij z własnej kieszeni”) oraz ten sam opis bez przełącznika w podglądzie miesiąca (`PlanSummary`). Zdania są w `planText.ts`.
 * Komponenty bez haków (testy wołają je jak funkcje).
 */

/**
 * Plan aktywnego sklepu z prognozy: przy sieci z prognozy tego sklepu (suma sieci planu nie ma), inaczej z prognozy jedynego sklepu.
 * `storeId` to numer sklepu w firmie (polecenie `planTopUp` go wymaga); bez firmy 1.
 */
export function activePlan(view: EconView, firmView: FirmView | null): { plan: PlanOutlook | null; first: number | null; storeId: number } {
  const storeId = firmView?.f.activeId ?? 1;
  const f = firmView && isNetwork(firmView.f)
    ? forecastFirm(firmView.f).stores.find((x) => x.id === storeId)?.f ?? forecastMonth(view.s, view.info)
    : forecastMonth(view.s, view.info);
  return { plan: f.plan, first: f.planFirst, storeId };
}

/** Opis planu bez przełącznika: trzy zdania w tonie planu albo, przed pierwszym planem, zdanie o planie od dziś. Bez planu nic. */
export function PlanSummary({ plan, first, name }: { plan: PlanOutlook | null; first: number | null; name?: string }) {
  if (!plan) return first === null ? null : <p class="tt-hint tt-plan-sum" role="note">{name ? `${name}: ` : ''}{planFirstText(first)}</p>;
  const l = planLines(plan);
  return (
    <div class={`tt-plan-sum ${l.tone}`} role="note">
      {name && <b class="tt-plan-name">{name}</b>}
      <span class="tt-plan-head">{l.head}</span>
      <span class="tt-plan-progress">{l.progress}</span>
      <span class="tt-plan-verdict">{l.verdict}</span>
    </div>
  );
}

/**
 * Wiersz planu pod paskiem prognozy aktywnego sklepu. Bez planu i bez pierwszego planu nic nie rysuje. Przełącznik wysyła polecenie firmy
 * `planTopUp` (odmowę pokazuje wspólna ścieżka `dispatchFirm`); stan przełącznika czyta z prognozy (`plan.topUp`), więc po poleceniu odświeża się
 * razem z paskiem. Kwota kary, koszt dobicia i stopień po wpadce to prognoza `forecastMonth`: gracz widzi je, zanim cokolwiek się stanie.
 */
export function PlanRow({ plan, first, storeId, game }: { plan: PlanOutlook | null; first: number | null; storeId: number; game: Pick<GameActions, 'firm'> }) {
  if (!plan) {
    return first === null ? null : <div class="tt-hud-row tt-hud-plan tt-plan ok" data-tut="plan" role="note"><span class="tt-plan-verdict">{planFirstText(first)}</span></div>;
  }
  const l = planLines(plan);
  const on = plan.topUp;
  return (
    <div class={`tt-hud-row tt-hud-plan tt-plan ${l.tone}`} data-tut="plan">
      <div class="tt-plan-text" role="note">
        <span class="tt-plan-head">{l.head}</span>
        <span class="tt-plan-progress">{l.progress}</span>
        <span class="tt-plan-verdict">{l.verdict}</span>
      </div>
      <button type="button" role="switch" aria-checked={on ? 'true' : 'false'} class={`tt-plan-switch${on ? ' on' : ''}`} title={topUpNote()}
        onClick={() => { game.firm({ type: 'planTopUp', storeId, on: !on }); }}>
        <span class="tt-plan-knob" aria-hidden="true" />
        <span class="tt-plan-switch-text"><span>{topUpLabel()}</span><span class="tt-plan-note">{topUpNote()}</span></span>
      </button>
    </div>
  );
}

/** Wiersz planu w pasku: plan aktywnego sklepu z prognozy (`activePlan`) pod wierszem prognozy. */
export function HudPlan({ view, firmView, game }: { view: EconView; firmView: FirmView | null; game: Pick<GameActions, 'firm'> }) {
  const { plan, first, storeId } = activePlan(view, firmView);
  return <PlanRow plan={plan} first={first} storeId={storeId} game={game} />;
}
