import type { ComponentChildren } from 'preact';
import {
  CATS, CAT_INFO, HIRE_COST, ORDER_DEADLINE, REMANENT, RESTOCK_RATE, SCO_RATE, STAFF_MAX, TILL_RATE, UNLOAD_RATE, WAGE_PER_DAY,
} from '@/sim/economy/catalog';
import { dayOf, formatClock, minuteOfDay } from '@/sim/economy/calendar';
import { dateText, kpiTitleText, rankText, t, tr } from '@/i18n';
import {
  DEBT_WARN, LOC_LABEL, aislePallets, assistantSuggestion, customersPerHour, debtWarningText, effects, freeSpots, isClosedForRemont, kpiMetricsOf, kpiScaleOf, level, nextRemont, peakCustomersPerHour,
  robotFleet, slotFree, slotUsage, upgradeBlocker, wagesPerDay, workshopUnlocked, type EconomyState,
} from '@/sim/economy/economy';
import { forecastMonth, spendCheck } from '@/sim/economy/forecast';
import { noticeEndDay } from '@/sim/firm/closure';
import { openStores } from '@/sim/firm/firm';
import { FIRM_GOALS, FIRM_GOAL_BY_ID, type FirmGoal } from '@/sim/firm/goals';
import type { FirmState } from '@/sim/firm/types';
import { dueOf } from '@/sim/economy/franchisee';
import { MILESTONES } from '@/sim/economy/milestones';
import { KPI, KPI_FLAVOR, kpiProgress } from '@/sim/economy/tycoon/kpi';
import { dayOfMinute, roundNice } from '@/sim/economy/tycoon/time';
import { WEATHER_LABEL } from '@/sim/economy/tycoon/cleanliness';
import { staffOnShift } from '@/sim/economy/tycoon/shift';
import { PROFILE_HINT, PROFILE_LABEL, STAFF_PROFILES, STAFF_TASKS, TASK_LABEL } from '@/sim/economy/tycoon/staff';
import { trustTier } from '@/sim/economy/tycoon/trust';
import { WUT } from '@/sim/economy/tycoon/wut';
import type { PalletLoc, StoreInfo } from '@/sim/economy/storeInfo';
import {
  EQUIPMENT, GROUP_LABEL, UPGRADES, WORKSHOP_LEVEL, equipmentCost, upgradeCost, type UpgradeDef, type UpgradeGroup,
} from '@/sim/economy/upgrades';
import { nextRankAt, xpToNext } from '@/sim/economy/progress';
import { CityPanel } from '../city/CityPanel';
import { lotAddress, storeName, storeStateText } from '../city/firmText';
import { forecastNow, isNetwork, networkRow } from '../city/storeSwitcherModel';
import { econ, firm, metaView, openMonthPreview, ranked, selection, sheetFolded, tab, type GameActions, type TabId } from '../state';
import { duration, int, money, minusZl, pct, people, percentOf, plural, signedZl, zl } from './format';
import { SpendNote, buyButtons, buyNotes, spendRisk } from './spend';
import { tapBlock } from './tapBlock';

// --- Wspólne -----------------------------------------------------------------------------------------

export function Bar({ value, warn = false }: { value: number; warn?: boolean }) {
  return (
    <span class={`tt-bar${warn ? ' warn' : ''}`} role="presentation">
      <span style={{ width: pct(value) }} />
    </span>
  );
}

function Row({ label, children }: { label: ComponentChildren; children: ComponentChildren }) {
  return <div class="tt-row"><span>{typeof label === 'string' ? tr(label) : label}</span><span>{children}</span></div>;
}

/** Sekcja panelu; `tut`: wartość `data-tut`, gdy sekcję wskazuje samouczek (`ui/tutorial/steps.ts`). */
function Section({ title, tut, children }: { title: string; tut?: string; children: ComponentChildren }) {
  return <section class="tt-section" data-tut={tut}><h3>{tr(title)}</h3>{children}</section>;
}

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'sklep', icon: '🏪', label: 'Sklep' },
  { id: 'palety', icon: '📦', label: 'Palety' },
  { id: 'ludzie', icon: '👥', label: 'Ludzie' },
  { id: 'ulepszenia', icon: '🛠️', label: 'Ulepszenia' },
  { id: 'cele', icon: '🎯', label: 'Cele' },
  { id: 'miasto', icon: '🗺️', label: 'Miasto' },
];

/** Dolny pasek zakładek. Drugie stuknięcie w otwartą zakładkę ją zamyka, a zwiniętą (`sheetFolded`) rozwija. */
export function TabBar() {
  const view = econ.value;
  const badge: Partial<Record<TabId, number>> = {};
  if (view) {
    // pod sklepem grozi mandat, w przejściach zagracenie: obie lokalizacje to palety, którymi trzeba się zająć
    badge.palety = view.s.pallets.filter((p) => p.loc === 'sidewalk' || p.loc === 'aisle').length || undefined;
    const fv = firm.value;
    const netReady = fv && !fv.f.ranked ? fv.f.goals.ready.length : 0;   // cele sieci też czekają na „Odbierz” w Celach
    badge.cele = view.s.milestonesReady.length + netReady || undefined;
    const affordable = UPGRADES.filter((u) => !upgradeBlocker(view.s, u) && upgradeCost(u, level(view.s, u.id)) <= view.s.cash).length;
    badge.ulepszenia = affordable || undefined;
  }
  return (
    <nav class="tt-tabs" data-tut="tabs" aria-label={t`Zakładki`}>
      {TABS.map((x) => (
        <button key={x.id} type="button" class={`tt-tab${tab.value === x.id ? ' on' : ''}`} data-tut={`tab-${x.id}`} aria-pressed={tab.value === x.id}
          onClick={() => { tab.value = tab.value === x.id && !sheetFolded.value ? null : x.id; sheetFolded.value = false; selection.value = null; }}>
          <span class="tt-tab-icon" aria-hidden="true">{x.icon}</span>
          <span class="tt-tab-label">{tr(x.label)}</span>
          {badge[x.id] ? <span class="tt-badge">{badge[x.id]}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/** Przesunięcie palcem po nagłówku arkusza (px), od którego arkusz się zwija albo rozwija. */
export const FOLD_MIN_PX = 40;
/** Krótszy ruch palcem po nagłówku to stuknięcie. */
const FOLD_TAP_PX = 8;

/** Stan arkusza po geście na nagłówku: w dół zwija, w górę rozwija, stuknięcie przełącza; ruch pośredni niczego nie zmienia (null). */
export function foldGesture(dy: number, folded: boolean): boolean | null {
  if (Math.abs(dy) < FOLD_TAP_PX) return !folded;
  if (dy >= FOLD_MIN_PX) return true;
  if (dy <= -FOLD_MIN_PX) return false;
  return null;
}

let foldFrom: { id: number; y: number } | null = null;   // początek gestu na nagłówku (jak `swipeFrom` w `LotCard.tsx`)

const foldDown = (e: PointerEvent): void => {
  // od 900 px arkusz to prawa kolumna (ui.css) i się nie zwija; przyciski nagłówka działają po swojemu
  if (window.innerWidth >= 900 || (e.target as Element).closest('button')) return;
  foldFrom = { id: e.pointerId, y: e.clientY };
  (e.currentTarget as Element).setPointerCapture(e.pointerId);
};

const foldUp = (e: PointerEvent): void => {
  const from = foldFrom;
  foldFrom = null;
  if (!from || from.id !== e.pointerId) return;
  const next = foldGesture(e.clientY - from.y, sheetFolded.value);
  if (next !== null) sheetFolded.value = next;
};

/**
 * Arkusz z zawartością otwartej zakładki. Na telefonie nagłówek jest uchwytem: ruch palcem w dół (albo ▾) zwija arkusz do samego nagłówka,
 * żeby było widać scenę, w górę go rozwija. Ciało ma klucz zakładki: każda zakładka zaczyna od góry, a nie od miejsca, do którego
 * przewinęła się poprzednia (wspólny element przenosił `scrollTop`).
 */
export function Sheet({ game }: { game: GameActions }) {
  const view = econ.value;
  const open = tab.value;
  if (!view || !open) return null;
  const title = tr(TABS.find((x) => x.id === open)!.label);
  const folded = sheetFolded.value;
  return (
    <aside class={`tt-sheet${open === 'miasto' ? ' tt-sheet-city' : ''}${folded ? ' folded' : ''}`} data-tut="sheet" aria-label={title}>
      <div class="tt-sheet-head" onPointerDown={foldDown} onPointerUp={foldUp} onPointerCancel={() => { foldFrom = null; }}>
        <h2>{title}</h2>
        <div class="tt-sheet-btns">
          <button type="button" class="tt-iconbtn tt-sheet-fold" aria-expanded={!folded} aria-label={folded ? t`Rozwiń arkusz` : t`Zwiń arkusz`}
            onClick={() => { sheetFolded.value = !folded; }}>{folded ? '▴' : '▾'}</button>
          <button type="button" class="tt-iconbtn" aria-label={t`Zamknij`} onClick={() => { tab.value = null; }}>✕</button>
        </div>
      </div>
      <div class="tt-sheet-body" key={open}>
        {/* `v` (wersja stanu) jest w propsach celowo: stan ekonomii zmienia się w miejscu, a @preact/signals pomija
            render komponentu, którego propsy są płytko równe. Bez `v` panel po „Odbierz!” albo zakupie zostawał nieaktualny. */}
        {open === 'sklep' && <StorePanel s={view.s} info={view.info} game={game} v={view.v} />}
        {open === 'palety' && <PalletsPanel s={view.s} info={view.info} game={game} v={view.v} />}
        {open === 'ludzie' && <PeoplePanel s={view.s} info={view.info} game={game} v={view.v} />}
        {open === 'ulepszenia' && <ShopPanel s={view.s} info={view.info} game={game} v={view.v} />}
        {open === 'cele' && <GoalsPanel s={view.s} info={view.info} game={game} v={view.v} />}
        {open === 'miasto' && <CityPanel game={game} />}
      </div>
    </aside>
  );
}

// --- Sklep -------------------------------------------------------------------------------------------

/** Ilu klientów na godzinę sklep obsłuży (kasjerzy przy obecnym przydziale, maksymalnie wszystkie kasy, SCO). */
function capacityPerHour(s: EconomyState, info: StoreInfo): { now: number; max: number } {
  const fx = effects(s, info);
  const sco = fx.sco * SCO_RATE * fx.scoSpeed * 60;
  const till = TILL_RATE * fx.tillSpeed * 60;
  return { now: s.lastCashiers * till + sco, max: Math.min(s.staff, fx.tills) * till + sco };
}

/** Pytanie przed wypowiedzeniem umowy sklepu (jak `RESTART_CONFIRM`, dwa kroki zamiast jednego kliknięcia): nazwa sklepu i dzień końca umowy. */
export const terminateConfirm = (name: string, endDay: number): string =>
  t`Wypowiedzieć umowę: ${name}? Sklep działa do ${dateText(endDay)}, potem Centrala robi rozliczenie końcowe: ubytki ponad limit i niespłacone raty zejdą z gotówki. Tego nie da się cofnąć.`;

export function StorePanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
  const fx = effects(s, info);
  const cap = capacityPerHour(s, info);
  const hour = Math.floor(minuteOfDay(s.minute) / 60);
  const demand = customersPerHour(s, info, hour);
  const peak = peakCustomersPerHour(s, info);
  const backroom = CATS.reduce((n, c) => n + s.backroom[c], 0);
  const usage = slotUsage(s);
  const trust = s.tycoon.trust.value;
  const tier = trustTier(trust);
  const rem = s.franchisee.remanent;
  const hall = s.tycoon.hall;
  const dirty = hall.cleanliness < 50;
  // umowa tego sklepu (§13.2): wypowiedzieć można, gdy zostaje inny otwarty sklep bez wypowiedzenia (inaczej sim odmawia: `single`)
  const f = firm.value?.f;
  const own = f?.stores.find((x) => x.econ === s);
  const canTerminate = !!f && !!own && !own.closed && own.notice === null && f.over === null && !s.gameOver
    && openStores(f).some((x) => x.id !== own.id && x.notice === null);
  const endDay = noticeEndDay(dayOf(s.minute));
  return (
    <>
      <Section title="Kasa i kolejka">
        <Row label="Kolejka">{t`${int(s.queue)} ${plural(Math.round(s.queue), 'osoba', 'osoby', 'osób')} (cierpliwość: ${fx.patience})`}</Row>
        <Bar value={s.queue / Math.max(1, fx.patience)} warn={s.queue >= fx.patience} />
        <Row label="Stanowiska kasowe">{t`${fx.tills}, teraz na kasie: ${people(s.lastCashiers)}`}</Row>
        <Row label="Kasy samoobsługowe">{fx.sco}</Row>
        <Row label="Ruch teraz / w szczycie">{t`${int(demand)} / ${int(peak)} klientów/h`}</Row>
        <Row label="Przepustowość (max)">{t`${int(cap.max)} klientów/h`}</Row>
        {peak > cap.max && <p class="tt-hint warn">{t`W szczycie przyjdzie więcej ludzi, niż obsłużysz. Kasa samoobsługowa, druga kasa albo szkolenie pomogą.`}</p>}
        <Row label="Utraceni dziś">{int(s.today.lost)}</Row>
      </Section>
      <Section title="Półki">
        {CATS.map((c) => {
          const fill = info.shelfCap[c] > 0 ? s.shelf[c] / info.shelfCap[c] : 0;
          return <div key={c} class="tt-cat"><span>{tr(CAT_INFO[c].label)}</span><Bar value={fill} warn={fill < 0.25} /><span>{pct(fill)}</span></div>;
        })}
        <Row label="Zaplecze">{t`${int(backroom)} / ${int(fx.backroomCap)} szt.`}</Row>
        <Bar value={backroom / Math.max(1, fx.backroomCap)} />
      </Section>
      <Section title="Opinia">
        <Row label="Reputacja">{int(s.reputation)} / 100</Row>
        <Bar value={s.reputation / 100} warn={s.reputation < 30} />
        <Row label="Zaufanie Centrali">{int(trust)} / 100 · {tr(tier.label)}</Row>
        <Bar value={trust / 100} warn={trust < 30} />
        <p class="tt-hint tt-flavor">{tr(tier.flavor)}</p>
        <p class="tt-hint">{t`Reputacja rośnie, gdy klienci znajdują towar i nie czekają. Spada przez puste półki, kolejki i mandaty.`}</p>
      </Section>
      <Section title="Remanent">
        <Row label="Limit ubytków">{rem.known ? t`${percentOf(WUT.threshold)} obrotu od ostatniego remanentu` : t`Centrala poda przy remanencie`}</Row>
        {rem.last && <Row label="Ostatni remanent">{dateText(rem.last.day)}, {rem.last.charge > 0 ? t`nadwyżka ${zl(rem.last.charge)}` : t`w limicie`}</Row>}
        <Row label="Następny remanent">{dateText(rem.nextDay)}</Row>
        <p class="tt-hint">{t`Ubytki (przeterminowany towar, kradzieże, pomyłki i skutki decyzji dnia) liczy się dopiero przy remanencie: o ${formatClock(REMANENT.at)} ostatniego dnia co ${REMANENT.everyMonths} ${plural(REMANENT.everyMonths, 'miesiąc', 'miesiące', 'miesięcy')}. Nadwyżkę ponad limit Centrali potrąca z przelewu tego samego dnia.`}</p>
      </Section>
      <Section title="Czystość sali">
        <Row label="Czystość">{Math.round(hall.cleanliness)}%</Row>
        <Bar value={hall.cleanliness / 100} warn={dirty} />
        <Row label="Pogoda">{tr(WEATHER_LABEL[hall.weather])}</Row>
        <p class={`tt-hint${dirty ? ' warn' : ''}`}>{dirty ? t`Brudna sala odstrasza klientów i obniża reputację. Ktoś musi wziąć mopa.` : t`Klienci i deszcz brudzą salę, sprzątanie ją czyści. Zimą i w deszczu brudu jest więcej.`}</p>
      </Section>
      <Section title="Sloty na sprzęt">
        {info.slots.length === 0 && <p class="tt-hint">{t`Ten lokal nie ma slotów. Remont je doda.`}</p>}
        {info.slots.map((slot, i) => {
          const items = usage.get(slot.id) ?? [];
          const free = slotFree(s, info, slot.id);
          return (
            <button key={slot.id} type="button" class="tt-listbtn" onClick={() => { selection.value = { kind: 'slot', slotId: slot.id }; tab.value = null; }}>
              <span>{t`Slot ${i + 1} (${slot.capacity === 2 ? '2×2' : '2×1'})`}</span>
              <span>{items.length ? items.map((id) => tr(EQUIPMENT.find((e) => e.id === id)!.name)).join(', ') : t`pusty`}{free > 0 ? t` · wolne: ${free}` : ''}</span>
            </button>
          );
        })}
      </Section>
      {f && own && (own.notice !== null || canTerminate) && (
        <Section title="Umowa">
          {own.notice !== null
            ? (
              <>
                <Row label="Umowa wygasa">{dateText(own.notice.endDay)}</Row>
                <p class="tt-hint">{t`Do tego dnia sklep działa normalnie, ale Centrala nie finansuje w nim nowych rat. Potem następuje rozliczenie końcowe.`}</p>
              </>
            )
            : (
              <>
                <button type="button" class="tt-btn" onClick={() => { if (confirm(terminateConfirm(storeName(f, own.id), endDay))) game.firm({ type: 'terminateStore', storeId: own.id }); }}>{t`Wypowiedz umowę`}</button>
                <p class="tt-hint">{t`Sklep działa normalnie do końca następnego miesiąca. Potem Centrala robi rozliczenie końcowe, a w okresie wypowiedzenia nie finansuje w nim nowych rat.`}</p>
              </>
            )}
        </Section>
      )}
    </>
  );
}

// --- Palety ------------------------------------------------------------------------------------------

export function PalletsPanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
  const suggestion = assistantSuggestion(s, info);
  const mod = minuteOfDay(s.minute);
  const pending = s.deliveries.reduce((n, d) => n + d.count, 0);
  const aisle = aislePallets(s);
  const fx = effects(s, info);
  const robots = robotFleet(s);
  const workPerHour = s.shift.human.rozladunek * UNLOAD_RATE * fx.unloadMult * 60;
  return (
    <>
      <Section title="Zamówienie na jutro">
        <div class="tt-seg wide" data-tut="order" role="group" aria-label={t`Kto zamawia`}>
          <button type="button" class={`tt-btn${s.order.auto ? ' on' : ''}`} data-tut="order-auto" onClick={() => game.dispatch({ type: 'setOrder', auto: true })}>{t`Asystent Traszki`}</button>
          <button type="button" class={`tt-btn${!s.order.auto ? ' on' : ''}`} data-tut="order-manual" onClick={() => game.dispatch({ type: 'setOrder', auto: false, manual: s.order.manual })}>{t`Ręcznie`}</button>
        </div>
        {s.order.auto
          ? <p class="tt-hint">{t`Asystent zamówi `}<b>{suggestion} {plural(suggestion, 'paleta', 'palety', 'palet')}</b>. {level(s, 'asystent') === 0 ? t`Zwykle trochę przesadza („klienci to kochają”).` : t`Po szkoleniu już mniej przesadza.`}</p>
          : (
            <div class="tt-stepper">
              <button type="button" class="tt-btn" aria-label={t`Mniej`} onClick={() => game.dispatch({ type: 'setOrder', auto: false, manual: s.order.manual - 1 })}>−</button>
              <b>{s.order.manual} {plural(s.order.manual, 'paleta', 'palety', 'palet')}</b>
              <button type="button" class="tt-btn" aria-label={t`Więcej`} onClick={() => game.dispatch({ type: 'setOrder', auto: false, manual: s.order.manual + 1 })}>+</button>
              <span class="tt-muted">{t`asystent: ${suggestion}`}</span>
            </div>
          )}
        <p class="tt-hint">{t`Zamówienie zamyka się o ${formatClock(ORDER_DEADLINE)}${mod < ORDER_DEADLINE ? t` (dziś)` : t` (jutro)`}. Dostawa rano${fx.splitDelivery ? t` i o 15:00` : ''}. W drodze: ${pending} ${plural(pending, 'paleta', 'palety', 'palet')}.`}</p>
      </Section>
      <Section title={t`Palety (${s.pallets.length})`} tut="pallets">
        <Row label="Wolne miejsca">{t`pod sklepem ${freeSpots(s, info, 'sidewalk')} · zaplecze ${freeSpots(s, info, 'backroom')} · sala ${freeSpots(s, info, 'floor')}`}{aisle > 0 ? t` · w przejściach ${aisle} ${plural(aisle, 'paleta', 'palety', 'palet')} ⚠️` : ''}</Row>
        <Row label="Rozładunek teraz">{t`~${int(workPerHour)} szt./h (${people(s.shift.human.rozladunek)} os.${robots.tasmociag > 0 || robots.edward > 0 ? t` + automatyka` : ''})`}</Row>
        {s.pallets.length === 0 && <p class="tt-hint">{t`Brak palet. Cisza przed dostawą.`}</p>}
        {s.pallets.map((p) => <PalletItem key={p.id} s={s} info={info} id={p.id} game={game} />)}
        <p class="tt-hint">{t`Pod sklepem: ryzyko mandatu Straży Miejskiej. W sali: korek i mniej klientów. Zaplecze: bezpiecznie, ale miejsc jest mało. Nadmiar staje w przejściach, a klienci się o niego potykają: rozładuj go, zanim spadnie reputacja.`}</p>
      </Section>
    </>
  );
}

export function PalletItem({ s, info, id, game, compact = false }: { s: EconomyState; info: StoreInfo; id: number; game: GameActions; compact?: boolean }) {
  const p = s.pallets.find((x) => x.id === id);
  if (!p) return <p class="tt-hint">{t`Paleta rozładowana. 💪`}</p>;
  const age = s.minute - p.since;
  // do przejść stawia tylko kierowca, gdy zabraknie miejsc, więc nie ma ich wśród celów przenosin; z przejścia paletę da się zabrać na zwykłe miejsce
  const moves = (['backroom', 'floor', 'sidewalk'] as PalletLoc[]).filter((l) => l !== p.loc);
  const block = tapBlock(s, 'paleta');
  const warn = p.loc === 'sidewalk' || p.loc === 'aisle';
  return (
    <div class={`tt-pallet${warn ? ' risk' : ''}`} data-tut={p.loc === 'aisle' ? 'pallet-aisle' : undefined}>
      <div class="tt-row">
        <span><b>{tr(LOC_LABEL[p.loc])}</b>{warn ? ' ⚠️' : ''}</span>
        <span class="tt-muted">{t`${int(p.total)} szt. · ${duration(age)}`}</span>
      </div>
      <Bar value={p.total / p.initial} />
      <div class="tt-actions">
        <button type="button" class="tt-btn tt-primary" disabled={!!block} title={tr(block)} onClick={() => game.dispatch({ type: 'tapPallet', palletId: p.id })}>{t`Rozładuj`}</button>
        {moves.map((l) => (
          <button key={l} type="button" class="tt-btn" disabled={freeSpots(s, info, l) === 0} onClick={() => game.dispatch({ type: 'movePallet', palletId: p.id, loc: l })}>
            {l === 'backroom' ? t`Na zaplecze` : l === 'floor' ? t`Do sali` : t`Pod sklep`}
          </button>
        ))}
      </div>
      {p.loc === 'aisle' && !compact && <p class="tt-hint">{t`Stoi w przejściu: klienci się o nią potykają, a reputacja spada. Rozładuj ją albo przenieś na wolne miejsce.`}</p>}
    </div>
  );
}

// --- Ludzie ------------------------------------------------------------------------------------------

const osoby = (n: number): string => `${n} ${plural(n, 'osoba', 'osoby', 'osób')}`;

/** Powyżej tylu minut czekania w dniu zadanie dostaje w „Dziś” ostrzeżenie (brakowało rąk). */
const STARVED_WARN_MIN = 30;

export function PeoplePanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
  const fx = effects(s, info);
  const robots = robotFleet(s);
  const pool = s.tycoon.staff;
  const profile = pool.profile;
  const onShift = staffOnShift(s);
  const doing = (task: string): number => onShift.filter((x) => x.task === task).length;
  const pinnedAll = STAFF_TASKS.reduce((n, t) => n + pool.pinned[t], 0);
  return (
    <>
      <Section title="Zmiana">
        <div class="tt-stepper" data-tut="hire">
          <button type="button" class="tt-btn" aria-label={t`Zwolnij`} onClick={() => game.dispatch({ type: 'fire' })}>−</button>
          <b>{osoby(s.staff)}</b>
          <button type="button" class="tt-btn" aria-label={t`Zatrudnij`} data-risk={s.staff >= STAFF_MAX ? undefined : spendRisk(s, info, HIRE_COST)} disabled={s.staff >= STAFF_MAX} onClick={() => game.dispatch({ type: 'hire' })}>+</button>
        </div>
        <Row label="Płace">{t`${int(wagesPerDay(s, info))} zł / dzień`}</Row>
        <p class="tt-hint">{t`Rekrutacja: ${HIRE_COST} zł. Każda osoba na zmianie to ${WAGE_PER_DAY} zł dziennie (dwa etaty na 17-godzinny dzień).`}</p>
        {info.site?.net && info.site.net.wages < 1 && <p class="tt-hint">{t`Wspólna obsada (badania Sieci) obniża płace w tym sklepie o ${percentOf(1 - info.site.net.wages)}.`}</p>}
        {s.staff < STAFF_MAX && <SpendNote s={s} info={info} price={HIRE_COST} />}
      </Section>
      <Section title="Profil pracy">
        <div class="tt-seg wide" role="group" aria-label={t`Profil pracy`}>
          {STAFF_PROFILES.map((p) => (
            <button key={p} type="button" class={`tt-btn${profile === p ? ' on' : ''}`} onClick={() => game.dispatch({ type: 'setStaffProfile', profile: p })}>{tr(PROFILE_LABEL[p])}</button>
          ))}
        </div>
        <p class="tt-hint">{tr(profile === 'wlasny' ? PROFILE_LABEL.wlasny : PROFILE_HINT[profile])}</p>
        <p class="tt-hint">{t`Jedna osoba: kasa ~${int(TILL_RATE * fx.tillSpeed * 60)} klientów/h albo rozładunek ~${int(UNLOAD_RATE * fx.unloadMult * 60)} szt./h, wykładanie ~${int(RESTOCK_RATE * 60)} szt./h.`}</p>
      </Section>
      <Section title="Kto co robi teraz">
        {STAFF_TASKS.map((task) => {
          const pinned = pool.pinned[task];
          return (
            <Row key={task} label={TASK_LABEL[task]}>
              <span class="tt-task-n">{osoby(doing(task))}</span>
              <span class="tt-pin" role="group" aria-label={t`Przypięcie: ${tr(TASK_LABEL[task])}`}>
                <button type="button" class="tt-btn" aria-label={t`Odepnij od zadania: ${tr(TASK_LABEL[task])}`} disabled={pinned <= 0}
                  onClick={() => game.dispatch({ type: 'pinStaff', task, count: pinned - 1 })}>−</button>
                <span class="tt-pin-n">📌 {pinned}</span>
                <button type="button" class="tt-btn" aria-label={t`Przypnij do zadania: ${tr(TASK_LABEL[task])}`} disabled={pinnedAll >= s.staff}
                  onClick={() => game.dispatch({ type: 'pinStaff', task, count: pinned + 1 })}>+</button>
              </span>
            </Row>
          );
        })}
        <Row label="Wolni"><span class="tt-task-n">{osoby(doing('wolny'))}</span></Row>
        <p class="tt-hint">{t`Liczby to zgadnięcie z ostatniej minuty pracy; nocą nikogo nie ma. 📌 przypina osoby do zadania: biorą je najpierw, a gdy nie ma w nim pracy, wracają do puli (przypiętych razem najwyżej ${osoby(s.staff)}).`}</p>
      </Section>
      <Section title="Dziś">
        {STAFF_TASKS.map((task) => {
          const worked = pool.day.worked[task];
          const robot = pool.day.robot[task];
          const waited = pool.day.starved[task];
          return (
            <div key={task}>
              <Row label={TASK_LABEL[task]}>{t`${int(worked)} osobomin`}{robot > 0 ? t` (w tym automatyka ${int(robot)})` : ''}</Row>
              {waited > STARVED_WARN_MIN && <div class="tt-muted warn tt-starved">{t`czekało ${int(waited)} min`}</div>}
            </div>
          );
        })}
        <p class="tt-hint">{t`Osobominuta to minuta pracy jednej osoby. „Czekało” znaczy, że zadanie miało pracę, a nikt jej nie wziął: brakuje rąk albo przypięć.`}</p>
      </Section>
      {(robots.tasmociag > 0 || robots.wykladacz > 0 || fx.humanoid) && (
        <Section title="Automatyka (warsztat)">
          {robots.tasmociag > 0 && <Row label="Taśmociąg">{t`poziom ${robots.tasmociag}`}</Row>}
          {robots.wykladacz > 0 && <Row label="Wykładacz">{t`poziom ${robots.wykladacz}`}</Row>}
          {fx.humanoid && <Row label="Humanoid eDward">{t`pracuje 24/7 🤖`}</Row>}
          <p class="tt-hint">{t`Automatyka pracuje także w nocy, gdy sklep jest zamknięty.`}</p>
        </Section>
      )}
    </>
  );
}

// --- Ulepszenia --------------------------------------------------------------------------------------

/**
 * Ile poziomów remontu brakuje do wymagania ulepszenia (0, gdy nie ma wymagania albo już jest spełnione). Ulepszenia późnej gry (remont 3–4)
 * od pierwszego dnia stały w panelu jako zablokowane: panel pokazuje je dopiero, gdy brakuje najwyżej jednego poziomu.
 */
export const remontsAway = (s: EconomyState, u: UpgradeDef): number => Math.max(0, (u.requires?.remont ?? 0) - s.remontLevel);

export function ShopPanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
  const remont = nextRemont(s);
  const closed = isClosedForRemont(s);
  const groups: UpgradeGroup[] = ['kasa', 'palety', 'klienci', 'warsztat'];
  const capacityFree = info.slots.reduce((n, x) => n + slotFree(s, info, x.id), 0);
  const fv = firm.value;
  const network = !!fv && !fv.f.ranked && openStores(fv.f).length >= 2;   // badania Sieci mieszkają w panelu Miasto, a sklep w sieci ma o nich wiedzieć
  return (
    <>
      <Section title="Sprzęt do slotów">
        <p class="tt-hint">{t`Wolne miejsce w slotach: ${capacityFree}. Slot 2×2 mieści dwie kasy samoobsługowe. Możesz też stuknąć slot w sklepie.`}</p>
        {EQUIPMENT.map((e) => {
          const cost = equipmentCost(e, s.equipment.filter((x) => x.id === e.id).length);
          const owned = s.equipment.filter((x) => x.id === e.id).length;
          const locked = s.level < e.minLevel;
          return (
            <div key={e.id} class={`tt-item${locked ? ' locked' : ''}`}>
              <div><b>{locked ? '🔒 ' : ''}{tr(e.name)}</b>{owned > 0 ? <span class="tt-muted"> ×{owned}</span> : null}<div class="tt-muted">{tr(e.effect)}{e.size === 2 ? t` · zajmuje cały slot 2×2` : ''}</div>
                {locked && <div class="tt-muted warn">{t`Odblokujesz na ${e.minLevel}. poziomie`}</div>}
                {buyNotes(s, info, cost, locked)}</div>
              {buyButtons(s, info, cost, locked, (raty) => game.dispatch(raty ? { type: 'buyEquipment', id: e.id, raty: true } : { type: 'buyEquipment', id: e.id }))}
            </div>
          );
        })}
      </Section>
      {groups.map((g) => {
        if (g === 'warsztat' && !workshopUnlocked(s)) {
          return (
            <Section key={g} title={`🔒 ${tr(GROUP_LABEL[g])}`}>
              <p class="tt-hint">{t`Franczyzobiorca zakasuje rękawy: automatyka DIY, a na końcu humanoid eDward. Odblokujesz na ${WORKSHOP_LEVEL}. poziomie albo po pierwszym remoncie (teraz: poziom ${s.level}).`}</p>
            </Section>
          );
        }
        const items = UPGRADES.filter((u) => u.group === g).filter((u) => {
          const b = upgradeBlocker(s, u);
          if (remontsAway(s, u) > 1 && u.id !== 'humanoid') return false;   // ulepszenia późnej gry pokazują się, gdy do remontu zostaje jeden poziom
          return b === null || b === 'Maksymalny poziom' || /^Wymaga remontu|^Odblokujesz na/.test(b) || u.id === 'humanoid';
        });
        if (items.length === 0) return null;
        return (
          <Section key={g} title={GROUP_LABEL[g]}>
            {items.map((u) => {
              const lvl = level(s, u.id);
              const maxed = lvl >= u.maxLevel;
              const blocker = upgradeBlocker(s, u);
              const cost = upgradeCost(u, lvl);
              const name = u.names[Math.min(lvl, u.names.length - 1)]!;
              return (
                <div key={u.id} class={`tt-item${maxed ? ' done' : ''}${blocker && !maxed ? ' locked' : ''}`}>
                  <div>
                    <b>{tr(maxed ? u.names[u.names.length - 1]! : name)}</b>
                    {u.maxLevel > 1 && <span class="tt-muted"> {lvl}/{u.maxLevel}</span>}
                    <div class="tt-muted">{tr(u.effect)}</div>
                    <div class="tt-flavor">{tr(u.flavor)}</div>
                    {blocker && !maxed && <div class="tt-muted warn">{tr(blocker)}</div>}
                    {!maxed && buyNotes(s, info, cost, !!blocker)}
                  </div>
                  {maxed
                    ? <span class="tt-check">✓</span>
                    : buyButtons(s, info, cost, !!blocker, (raty) => game.dispatch(raty ? { type: 'buyUpgrade', id: u.id, raty: true } : { type: 'buyUpgrade', id: u.id }))}
                </div>
              );
            })}
          </Section>
        );
      })}
      <Section title="Remont generalny">
        {closed
          ? (
            <>
              <p class="tt-hint">{t`Remont trwa jeszcze ${duration((s.remontUntil ?? 0) - s.minute)}.`}</p>
              <button type="button" class="tt-btn" disabled={s.ogonki < 40} onClick={() => game.dispatch({ type: 'rushRemont' })}>{t`Przyspiesz o dzień (40 🦎)`}</button>
            </>
          )
          : remont
            ? (
              <div class="tt-item">
                <div><b>{s.level < remont.minLevel ? '🔒 ' : ''}{tr(remont.name)}</b><div class="tt-muted">{t`Większy lokal: więcej półek, slotów (${remont.slots} × 2×2) i miejsc na palety, więcej klientów. Sklep zamknięty ${remont.days} ${plural(remont.days, 'dzień', 'dni', 'dni')}.`}</div>
                  {s.level < remont.minLevel && <div class="tt-muted warn">{t`Odblokujesz na ${remont.minLevel}. poziomie`}</div>}
                  {buyNotes(s, info, remont.cost, s.level < remont.minLevel)}</div>
                {buyButtons(s, info, remont.cost, s.level < remont.minLevel, (raty) => game.dispatch(raty ? { type: 'startRemont', raty: true } : { type: 'startRemont' }))}
              </div>
            )
            : <p class="tt-hint">{t`To już Traszka Max Pro Ultra. Większego sklepu nie będzie.`}</p>}
      </Section>
      {network && (
        <Section title="Sieć">
          <p class="tt-hint">{t`Badania Sieci znajdziesz w panelu Miasto. Działają we wszystkich sklepach naraz.`}</p>
          <button type="button" class="tt-btn" onClick={() => { tab.value = 'miasto'; }}>{t`Do Miasta`}</button>
        </Section>
      )}
      <Section title="Za Ogonki">
        <div class="tt-item">
          <div><b>{t`Kampania w Traszkapce`}</b><div class="tt-muted">{t`+30% klientów przez dobę`}</div></div>
          <button type="button" class="tt-btn tt-buy" disabled={s.ogonki < 30} onClick={() => game.dispatch({ type: 'campaign' })}>30 🦎</button>
        </div>
      </Section>
    </>
  );
}

// --- Cele i wyniki -------------------------------------------------------------------------------------

/** Ścieżki celów sieci (przedrostek `id` w `FIRM_GOALS`): gotówka, liczba sklepów i badania. Każda pokazuje swój najbliższy cel. */
const GOAL_TRACKS = ['cash', 'stores', 'research'] as const;

/**
 * Cele sieci do pokazania w Celach (4b §5.6): spełnione czekają na „Odbierz” (`ready`, w kolejności spełnienia), a z niespełnionych po jednym,
 * najbliższym z każdej ścieżki (`next`: gotówka, sklepy, badania; najwyżej trzy). Same najbliższe z kolejki tabeli pokazałyby trzy cele
 * gotówkowe pod rząd, a o sklepach i badaniach gracz dowiedziałby się dopiero po milionie.
 */
export function networkGoals(f: FirmState): { ready: FirmGoal[]; next: FirmGoal[]; claimed: number } {
  const { ready, claimed } = f.goals;
  const known = (id: string): FirmGoal | undefined => (Object.hasOwn(FIRM_GOAL_BY_ID, id) ? FIRM_GOAL_BY_ID[id] : undefined);
  return {
    ready: ready.flatMap((id) => known(id) ?? []),
    next: GOAL_TRACKS.flatMap((track) => FIRM_GOALS.find((g) => g.id.startsWith(track) && !ready.includes(g.id) && !claimed.includes(g.id)) ?? []),
    claimed: claimed.length,
  };
}

/**
 * Czy Cele pokazują sekcję „Sieć”: tylko w zwykłej grze i dopiero od statusu Partnera albo gdy jakiś cel już czeka na odbiór (cele gotówkowe
 * da się spełnić jednym sklepem). Wcześniej podpowiedzi celów (badania w panelu Miasto, kolejne placówki) prowadziłyby do ekranów, których
 * przed statusem nie ma (`CityPanel` chowa badania do statusu).
 */
export const networkGoalsShown = (f: FirmState): boolean => !f.ranked && (f.person.partner || f.goals.ready.length > 0);

/**
 * Sekcja „Sieć” w Celach: cele całej firmy (gotówka, sklepy, badania), nie jednego sklepu. Nagroda to Ogonki do wspólnego portfela, bez XP.
 * Tylko w zwykłej grze (w rankingu ich nie ma). Zwykła funkcja z `Section`, żeby testy `vnodeTree` widziały wiersze.
 */
function NetworkGoals({ f, game }: { f: FirmState; game: GameActions }) {
  const { ready, next, claimed } = networkGoals(f);
  return (
    <Section title="Sieć">
      {ready.map((g) => (
        <div key={g.id} class="tt-goal ready" data-goal={g.id}>
          <div class="tt-row">
            <span><span class="tt-goal-tag">{t`🎁 Do odebrania`}</span> <b>{tr(g.label)}</b></span>
            <button type="button" class="tt-btn tt-primary" aria-label={t`Odbierz: ${tr(g.label)}`} onClick={() => { game.firm({ type: 'claimGoal', id: g.id }); }}>{t`Odbierz`}</button>
          </div>
          <div class="tt-muted">{t`Nagroda: +${g.reward} 🦎`}</div>
        </div>
      ))}
      {next.map((g) => <div key={g.id} class="tt-goal" data-goal={g.id}><b>{tr(g.label)}</b> <span class="tt-muted">+{g.reward} 🦎</span><div class="tt-muted">{tr(g.hint)}</div></div>)}
      <p class="tt-hint">{t`Cele całej sieci, nie jednego sklepu. Zdobyte: ${claimed} / ${FIRM_GOALS.length}`}</p>
    </Section>
  );
}

export function GoalsPanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
  const today = s.today;
  const m = s.month;
  const kpi = s.tycoon.kpi;
  const kpiDone = kpiProgress(kpi, kpiMetricsOf(s));
  const daysLeft = Math.max(0, kpi.toDay - dayOfMinute(s.minute));
  // premia i XP liczy sim przy zamknięciu tygodnia (closeKpiWeek); tu ta sama zasada na bieżącej skali sklepu, stąd „ok.”
  const kpiBonus = roundNice(KPI.bonusShare * Math.max(0, kpiScaleOf(s, info).dailyMargin));
  const kpiXp = KPI.xpBase + KPI.xpPerLevel * Math.max(1, s.level);
  // spełnione czekają na „Odbierz” (nagroda wpada dopiero po kliknięciu), reszta to trzy najbliższe jeszcze niespełnione
  const ready = MILESTONES.filter((x) => s.milestonesReady.includes(x.id) && !s.milestones.includes(x.id));
  const goals = MILESTONES.filter((x) => !s.milestones.includes(x.id) && !s.milestonesReady.includes(x.id)).slice(0, 3);
  const best = Math.max(1, ...s.history.map((h) => Math.abs(h.profit)));
  const forecast = forecastMonth(s, info);   // prognoza wyciągu tego sklepu na koniec miesiąca: saldo, raty, „Zostaje Ci”
  const fv = firm.value;
  const network = !!fv && isNetwork(fv.f);
  const all = network ? forecastNow({ s, info, v: 0 }, fv) : forecast;   // przy dwóch sklepach gotówka po zamknięciu liczy całą sieć (jak pasek)
  const settle = s.franchisee;
  const nextRank = nextRankAt(s.level);
  const previous = networkRow(metaView.value);
  return (
    <>
      <Section title="KPI tygodnia">
        <div class="tt-kpi">
          <div class="tt-row"><b>{kpiTitleText(kpi.kind, kpi.target, int)}</b></div>
          <Bar value={kpiDone} />
          <div class="tt-row"><span class="tt-muted">{tr(KPI_FLAVOR[kpi.kind])}</span><span class="tt-muted">{pct(kpiDone)}</span></div>
          <div class="tt-kpi-days">{t`do niedzieli: `}<b>{daysLeft === 0 ? t`dziś` : `${daysLeft} ${plural(daysLeft, 'dzień', 'dni', 'dni')}`}</b></div>
          <div class="tt-kpi-reward">{t`Nagroda: zaufanie +${KPI.trustHit}, premia ok. ${zl(kpiBonus)}, +${kpiXp} XP`}</div>
        </div>
        <p class="tt-hint">{t`Rozliczenie w niedzielę o 23:00. Nietrafiony cel: zaufanie −${-KPI.trustMiss}.`}</p>
      </Section>
      <Section title={t`Poziom ${s.level}: ${rankText(s.level)}`}>
        <Bar value={s.xp / xpToNext(s.level)} />
        <Row label="Doświadczenie">{int(s.xp)} / {int(xpToNext(s.level))} XP</Row>
        {nextRank && <p class="tt-hint">{t`Następna ranga (${rankText(nextRank)}) na ${nextRank}. poziomie. Każdy poziom to nagroda, a niektóre coś odblokowują.`}</p>}
      </Section>
      <Section title="Twoja sieć Traszek">
        {fv && fv.f.stores.map((st) => <Row key={st.id} label={storeName(fv.f, st.id)}>{`${lotAddress(fv.f, st.lotId)} · ${storeStateText(fv.f, st)}`}</Row>)}
        {fv && fv.f.builds.map((b) => <Row key={b.lotId} label={t`W budowie: ${lotAddress(fv.f, b.lotId)}`}>{t`otwarcie ${dateText(b.readyDay)}`}</Row>)}
        {previous && <p class="tt-hint">{previous}</p>}
        {ranked.value
          ? <p class="tt-hint">{t`W biegu rankingowym nie ma sieci sklepów: ten sklep nie dostaje premii z sieci i do niej nie dołączy.`}</p>
          : fv && !fv.f.person.partner && <p class="tt-hint">{t`Kolejną placówkę wynajmiesz w zakładce Miasto, gdy Centrala nada Ci status Partnera Strategicznego.`}</p>}
      </Section>
      <Section title="Kamienie milowe">
        {ready.map((g) => (
          <div key={g.id} class="tt-goal ready">
            <div class="tt-row">
              <span><span class="tt-goal-tag">{t`🎁 Do odebrania`}</span> <b>{tr(g.label)}</b></span>
              <button type="button" class="tt-btn tt-primary" data-tut="claim-btn" aria-label={t`Odbierz: ${tr(g.label)}`} onClick={() => game.dispatch({ type: 'claimMilestone', id: g.id })}>{t`Odbierz`}</button>
            </div>
            <div class="tt-muted">{t`Nagroda: +${g.reward} 🦎 i XP`}</div>
          </div>
        ))}
        {goals.map((g) => <div key={g.id} class="tt-goal"><b>{tr(g.label)}</b> <span class="tt-muted">+{g.reward} 🦎</span><div class="tt-muted">{tr(g.hint)}</div></div>)}
        <p class="tt-hint">{t`Zdobyte: ${s.milestones.length} / ${MILESTONES.length}`}</p>
      </Section>
      {fv && networkGoalsShown(fv.f) && !ranked.value && NetworkGoals({ f: fv.f, game })}
      <Section title="Dziś">
        <Row label="Klienci">{t`${int(today.customers)} (utraceni: ${int(today.lost)})`}</Row>
        <Row label="Obrót">{zl(today.revenue)}</Row>
        <Row label="Marża i premie (Twój przychód)">{zl(today.margin + today.bonus + today.other)}</Row>
        <Row label="Koszty (bez płac)">{zl(today.fines + today.logistics)}</Row>
        <p class="tt-hint">{t`Marża i premie idą na saldo u Centrali. Płace i media naliczają się co dzień, a płacisz je przy zamknięciu miesiąca.`}</p>
      </Section>
      <Section title="Ten miesiąc">
        <Row label="Obrót">{zl(m.revenue)}</Row>
        <Row label="Saldo u Centrali">{zl(forecast.saldo)}</Row>
        <Row label="Płace (naliczone)">{minusZl(settle.month.wages)}</Row>
        <Row label="Media (naliczone)">{minusZl(settle.month.media)}</Row>
        <Row label="Palety do potrącenia">{minusZl(settle.month.pallets)}</Row>
        <Row label="Raty w tym miesiącu">{minusZl(forecast.installments)}</Row>
        {settle.installments.map((r) => (
          <div key={r.id} class="tt-inst">
            <span>{tr(r.label)}</span>
            <span class="tt-muted">{t`rata ${zl(dueOf(r))} · zostało ${zl(r.total - r.paid)}`}</span>
          </div>
        ))}
        <Row label="Mandaty (z gotówki)">{minusZl(m.fines)}</Row>
        <Row label="Zakupy za gotówkę">{minusZl(m.investments)}</Row>
        {network
          ? (
            <>
              <Row label="Zostanie Ci po zamknięciu (ten sklep)"><b>{signedZl(forecast.net)}</b></Row>
              <Row label="Zostanie Ci po zamknięciu (sieć)"><b>{signedZl(all.net)}</b></Row>
            </>
          )
          : <Row label="Zostanie Ci po zamknięciu"><b>{signedZl(forecast.net)}</b></Row>}
        <Row label="Gotówka po zamknięciu"><b class={`tt-free ${spendCheck(all, 0).level}`}>{money(all.cashAfter)}</b></Row>
        <p class="tt-hint">{t`Marża i premie wpadają na saldo, a gotówka rusza się przy zamknięciu miesiąca: Centrala robi przelew, potrąca raty i palety, a Ty płacisz pensje, media, ZUS, VAT i księgową.`}</p>
        <p class="tt-hint">{t`To szybki szacunek: resztę miesiąca liczy z dotychczasowego obrotu. Dokładny wyciąg daje podgląd.`}</p>
        <button type="button" class="tt-btn" onClick={openMonthPreview}>{t`Koniec miesiąca: wyciąg i podgląd`}</button>
        {/* ostrzeżenie wynika ze stanu (gotówka), więc wraca po przeładowaniu, a okno „OK” z chwili zejścia pod próg nie jest zapisywane */}
        {s.cash < DEBT_WARN && <p class="tt-hint warn">{tr(debtWarningText(s.cash))}</p>}
      </Section>
      {s.history.length > 0 && (
        <Section title="Poprzednie miesiące">
          {s.history.slice(-6).map((h) => (
            <div key={h.label} class="tt-hist">
              <span>{tr(h.label)}</span>
              <span class={`tt-histbar${h.profit < 0 ? ' neg' : ''}`}><span style={{ width: pct(Math.abs(h.profit) / best) }} /></span>
              <span>{signedZl(h.profit)}</span>
            </div>
          ))}
        </Section>
      )}
      <Section title="Od początku">
        <Row label="Klienci">{int(s.total.customers)}</Row>
        <Row label="Obrót">{zl(s.total.revenue)}</Row>
        <Row label="Rozładowane palety">{int(s.total.palletsUnloaded)}</Row>
        <Row label="Mandaty">{zl(s.total.fines)}</Row>
      </Section>
    </>
  );
}

