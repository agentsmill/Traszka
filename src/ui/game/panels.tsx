import type { ComponentChildren } from 'preact';
import {
  CATS, CAT_INFO, HIRE_COST, HOUR_CURVE, ORDER_DEADLINE, RESTOCK_RATE, SCO_RATE, STAFF_MAX, TILL_RATE, UNLOAD_RATE, WAGE_PER_DAY,
} from '@/sim/economy/catalog';
import { formatClock, minuteOfDay } from '@/sim/economy/calendar';
import {
  DEBT_WARN, LOC_LABEL, aislePallets, assistantSuggestion, debtWarningText, effects, expectedDailyCustomers, franchiseFee, freeSpots, isClosedForRemont, kpiMetricsOf, kpiScaleOf, level, nextRemont,
  plPallets, robotFleet, slotFree, slotUsage, upgradeBlocker, workshopUnlocked, type EconomyState,
} from '@/sim/economy/economy';
import { forecastMonth, spendCheck } from '@/sim/economy/forecast';
import { MILESTONES } from '@/sim/economy/milestones';
import { KPI, KPI_FLAVOR, kpiProgress, kpiTitle } from '@/sim/economy/tycoon/kpi';
import { dayOfMinute, roundNice } from '@/sim/economy/tycoon/time';
import { WEATHER_LABEL } from '@/sim/economy/tycoon/cleanliness';
import { staffOnShift } from '@/sim/economy/tycoon/shift';
import { PROFILE_HINT, PROFILE_LABEL, STAFF_PROFILES, STAFF_TASKS, TASK_LABEL } from '@/sim/economy/tycoon/staff';
import { trustTier } from '@/sim/economy/tycoon/trust';
import { WUT, wutCharge, wutTotal } from '@/sim/economy/tycoon/wut';
import type { PalletLoc, StoreInfo } from '@/sim/economy/storeInfo';
import {
  EQUIPMENT, GROUP_LABEL, UPGRADES, WORKSHOP_LEVEL, equipmentCost, upgradeCost, type UpgradeGroup,
} from '@/sim/economy/upgrades';
import { nextRankAt, rankFor, xpToNext } from '@/sim/economy/progress';
import { networkIncomeOf, prestigePoints, prestigeReady } from '@/game/meta';
import { econ, metaView, openMonthPreview, ranked, selection, showPrestige, tab, type GameActions, type TabId } from '../state';
import { duration, int, pct, people, plural, signedZl, zl } from './format';
import { SpendNote, spendRisk } from './spend';
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
  return <div class="tt-row"><span>{label}</span><span>{children}</span></div>;
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return <section class="tt-section"><h3>{title}</h3>{children}</section>;
}

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'sklep', icon: '🏪', label: 'Sklep' },
  { id: 'palety', icon: '📦', label: 'Palety' },
  { id: 'ludzie', icon: '👥', label: 'Ludzie' },
  { id: 'ulepszenia', icon: '🛠️', label: 'Ulepszenia' },
  { id: 'cele', icon: '🎯', label: 'Cele' },
];

/** Dolny pasek zakładek. Drugie stuknięcie w otwartą zakładkę ją zamyka. */
export function TabBar() {
  const view = econ.value;
  const badge: Partial<Record<TabId, number>> = {};
  if (view) {
    // pod sklepem grozi mandat, w przejściach zagracenie: obie lokalizacje to palety, którymi trzeba się zająć
    badge.palety = view.s.pallets.filter((p) => p.loc === 'sidewalk' || p.loc === 'aisle').length || undefined;
    badge.cele = view.s.milestonesReady.length || undefined;
    const affordable = UPGRADES.filter((u) => !upgradeBlocker(view.s, u) && upgradeCost(u, level(view.s, u.id)) <= view.s.cash).length;
    badge.ulepszenia = affordable || undefined;
  }
  return (
    <nav class="tt-tabs" aria-label="Zakładki">
      {TABS.map((t) => (
        <button key={t.id} type="button" class={`tt-tab${tab.value === t.id ? ' on' : ''}`} aria-pressed={tab.value === t.id}
          onClick={() => { tab.value = tab.value === t.id ? null : t.id; selection.value = null; }}>
          <span class="tt-tab-icon" aria-hidden="true">{t.icon}</span>
          <span class="tt-tab-label">{t.label}</span>
          {badge[t.id] ? <span class="tt-badge">{badge[t.id]}</span> : null}
        </button>
      ))}
    </nav>
  );
}

/** Arkusz z zawartością otwartej zakładki. */
export function Sheet({ game }: { game: GameActions }) {
  const view = econ.value;
  const open = tab.value;
  if (!view || !open) return null;
  const title = TABS.find((t) => t.id === open)!.label;
  return (
    <aside class="tt-sheet" aria-label={title}>
      <div class="tt-sheet-head">
        <h2>{title}</h2>
        <button type="button" class="tt-iconbtn" aria-label="Zamknij" onClick={() => { tab.value = null; }}>✕</button>
      </div>
      <div class="tt-sheet-body">
        {/* `v` (wersja stanu) jest w propsach celowo: stan ekonomii zmienia się w miejscu, a @preact/signals pomija
            render komponentu, którego propsy są płytko równe. Bez `v` panel po „Odbierz!” albo zakupie zostawał nieaktualny. */}
        {open === 'sklep' && <StorePanel s={view.s} info={view.info} v={view.v} />}
        {open === 'palety' && <PalletsPanel s={view.s} info={view.info} game={game} v={view.v} />}
        {open === 'ludzie' && <PeoplePanel s={view.s} info={view.info} game={game} v={view.v} />}
        {open === 'ulepszenia' && <ShopPanel s={view.s} info={view.info} game={game} v={view.v} />}
        {open === 'cele' && <GoalsPanel s={view.s} info={view.info} game={game} v={view.v} />}
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

export function StorePanel({ s, info }: { s: EconomyState; info: StoreInfo; v: number }) {
  const fx = effects(s, info);
  const cap = capacityPerHour(s, info);
  const hour = Math.floor(minuteOfDay(s.minute) / 60);
  const demand = expectedDailyCustomers(s, info) / 15.6 * (HOUR_CURVE[hour] ?? 0);
  const peak = expectedDailyCustomers(s, info) / 15.6 * 1.3;
  const backroom = CATS.reduce((n, c) => n + s.backroom[c], 0);
  const usage = slotUsage(s);
  const trust = s.tycoon.trust.value;
  const tier = trustTier(trust);
  const wut = wutTotal(s.tycoon.wut);
  const wutLimit = WUT.threshold * Math.max(0, s.month.revenue);
  const wutOver = wutCharge(s.tycoon.wut, s.month.revenue);
  const hall = s.tycoon.hall;
  const dirty = hall.cleanliness < 50;
  return (
    <>
      <Section title="Kasa i kolejka">
        <Row label="Kolejka">{int(s.queue)} {plural(Math.round(s.queue), 'osoba', 'osoby', 'osób')} (cierpliwość: {fx.patience})</Row>
        <Bar value={s.queue / Math.max(1, fx.patience)} warn={s.queue >= fx.patience} />
        <Row label="Stanowiska kasowe">{fx.tills}, teraz na kasie: {people(s.lastCashiers)}</Row>
        <Row label="Kasy samoobsługowe">{fx.sco}</Row>
        <Row label="Ruch teraz / w szczycie">{int(demand)} / {int(peak)} klientów/h</Row>
        <Row label="Przepustowość (max)">{int(cap.max)} klientów/h</Row>
        {peak > cap.max && <p class="tt-hint warn">W szczycie przyjdzie więcej ludzi, niż obsłużysz. Kasa samoobsługowa, druga kasa albo szkolenie pomogą.</p>}
        <Row label="Utraceni dziś">{int(s.today.lost)}</Row>
      </Section>
      <Section title="Półki">
        {CATS.map((c) => {
          const fill = info.shelfCap[c] > 0 ? s.shelf[c] / info.shelfCap[c] : 0;
          return <div key={c} class="tt-cat"><span>{CAT_INFO[c].label}</span><Bar value={fill} warn={fill < 0.25} /><span>{pct(fill)}</span></div>;
        })}
        <Row label="Zaplecze">{int(backroom)} / {int(fx.backroomCap)} szt.</Row>
        <Bar value={backroom / Math.max(1, fx.backroomCap)} />
      </Section>
      <Section title="Opinia">
        <Row label="Reputacja">{int(s.reputation)} / 100</Row>
        <Bar value={s.reputation / 100} warn={s.reputation < 30} />
        <Row label="Zaufanie Centrali">{int(trust)} / 100 · {tier.label}</Row>
        <Bar value={trust / 100} warn={trust < 30} />
        <p class="tt-hint tt-flavor">{tier.flavor}</p>
        <p class="tt-hint">Reputacja rośnie, gdy klienci znajdują towar i nie czekają. Spada przez puste półki, kolejki i mandaty.</p>
      </Section>
      <Section title="Ubytki w tym miesiącu">
        <Row label="Ubytki (limit Centrali)">{zl(wut)} z {zl(wutLimit)}</Row>
        <Bar value={wutLimit > 0 ? wut / wutLimit : wut > 0 ? 1 : 0} warn={wut > wutLimit} />
        {wutOver > 0
          ? <p class="tt-hint warn">Ubytki ponad limit Centrali na dziś: {zl(wutOver)}. Rozliczenie dopiero przy zamknięciu miesiąca, a obrót jeszcze rośnie, więc kwota może się zmienić.</p>
          : <p class="tt-hint">Ubytki to przeterminowany towar, kradzieże, pomyłki i skutki decyzji dnia. Centrala pokrywa je do {(WUT.threshold * 100).toLocaleString('pl-PL')}% obrotu miesiąca, resztę płacisz Ty.</p>}
      </Section>
      <Section title="Czystość sali">
        <Row label="Czystość">{Math.round(hall.cleanliness)}%</Row>
        <Bar value={hall.cleanliness / 100} warn={dirty} />
        <Row label="Pogoda">{WEATHER_LABEL[hall.weather]}</Row>
        <p class={`tt-hint${dirty ? ' warn' : ''}`}>{dirty ? 'Brudna sala odstrasza klientów i obniża reputację. Ktoś musi wziąć mopa.' : 'Klienci i deszcz brudzą salę, sprzątanie ją czyści. Zimą i w deszczu brudu jest więcej.'}</p>
      </Section>
      <Section title="Sloty na sprzęt">
        {info.slots.length === 0 && <p class="tt-hint">Ten lokal nie ma slotów. Remont je doda.</p>}
        {info.slots.map((slot, i) => {
          const items = usage.get(slot.id) ?? [];
          const free = slotFree(s, info, slot.id);
          return (
            <button key={slot.id} type="button" class="tt-listbtn" onClick={() => { selection.value = { kind: 'slot', slotId: slot.id }; tab.value = null; }}>
              <span>Slot {i + 1} ({slot.capacity === 2 ? '2×2' : '2×1'})</span>
              <span>{items.length ? items.map((id) => EQUIPMENT.find((e) => e.id === id)!.name).join(', ') : 'pusty'}{free > 0 ? ` · wolne: ${free}` : ''}</span>
            </button>
          );
        })}
      </Section>
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
        <div class="tt-seg wide" role="group" aria-label="Kto zamawia">
          <button type="button" class={`tt-btn${s.order.auto ? ' on' : ''}`} onClick={() => game.dispatch({ type: 'setOrder', auto: true })}>Asystent Traszki</button>
          <button type="button" class={`tt-btn${!s.order.auto ? ' on' : ''}`} onClick={() => game.dispatch({ type: 'setOrder', auto: false, manual: s.order.manual })}>Ręcznie</button>
        </div>
        {s.order.auto
          ? <p class="tt-hint">Asystent zamówi <b>{suggestion} {plPallets(suggestion)}</b>. {level(s, 'asystent') === 0 ? 'Zwykle trochę przesadza („klienci to kochają”).' : 'Po szkoleniu już mniej przesadza.'}</p>
          : (
            <div class="tt-stepper">
              <button type="button" class="tt-btn" aria-label="Mniej" onClick={() => game.dispatch({ type: 'setOrder', auto: false, manual: s.order.manual - 1 })}>−</button>
              <b>{s.order.manual} {plPallets(s.order.manual)}</b>
              <button type="button" class="tt-btn" aria-label="Więcej" onClick={() => game.dispatch({ type: 'setOrder', auto: false, manual: s.order.manual + 1 })}>+</button>
              <span class="tt-muted">asystent: {suggestion}</span>
            </div>
          )}
        <p class="tt-hint">Zamówienie zamyka się o {formatClock(ORDER_DEADLINE)}{mod < ORDER_DEADLINE ? ' (dziś)' : ' (jutro)'}. Dostawa rano{fx.splitDelivery ? ' i o 15:00' : ''}. W drodze: {pending} {plPallets(pending)}.</p>
      </Section>
      <Section title={`Palety (${s.pallets.length})`}>
        <Row label="Wolne miejsca">pod sklepem {freeSpots(s, info, 'sidewalk')} · zaplecze {freeSpots(s, info, 'backroom')} · sala {freeSpots(s, info, 'floor')}{aisle > 0 ? ` · w przejściach ${aisle} ${plPallets(aisle)} ⚠️` : ''}</Row>
        <Row label="Rozładunek teraz">~{int(workPerHour)} szt./h ({people(s.shift.human.rozladunek)} os.{robots.tasmociag > 0 || robots.edward > 0 ? ' + automatyka' : ''})</Row>
        {s.pallets.length === 0 && <p class="tt-hint">Brak palet. Cisza przed dostawą.</p>}
        {s.pallets.map((p) => <PalletItem key={p.id} s={s} info={info} id={p.id} game={game} />)}
        <p class="tt-hint">Pod sklepem: ryzyko mandatu Straży Miejskiej. W sali: korek i mniej klientów. Zaplecze: bezpiecznie, ale miejsc jest mało. Nadmiar staje w przejściach, a klienci się o niego potykają: rozładuj go, zanim spadnie reputacja.</p>
      </Section>
    </>
  );
}

export function PalletItem({ s, info, id, game, compact = false }: { s: EconomyState; info: StoreInfo; id: number; game: GameActions; compact?: boolean }) {
  const p = s.pallets.find((x) => x.id === id);
  if (!p) return <p class="tt-hint">Paleta rozładowana. 💪</p>;
  const age = s.minute - p.since;
  // do przejść stawia tylko kierowca, gdy zabraknie miejsc, więc nie ma ich wśród celów przenosin; z przejścia paletę da się zabrać na zwykłe miejsce
  const moves = (['backroom', 'floor', 'sidewalk'] as PalletLoc[]).filter((l) => l !== p.loc);
  const block = tapBlock(s, 'paleta');
  const warn = p.loc === 'sidewalk' || p.loc === 'aisle';
  return (
    <div class={`tt-pallet${warn ? ' risk' : ''}`}>
      <div class="tt-row">
        <span><b>{LOC_LABEL[p.loc]}</b>{warn ? ' ⚠️' : ''}</span>
        <span class="tt-muted">{int(p.total)} szt. · {duration(age)}</span>
      </div>
      <Bar value={p.total / p.initial} />
      <div class="tt-actions">
        <button type="button" class="tt-btn tt-primary" disabled={!!block} title={block} onClick={() => game.dispatch({ type: 'tapPallet', palletId: p.id })}>Rozładuj</button>
        {moves.map((l) => (
          <button key={l} type="button" class="tt-btn" disabled={freeSpots(s, info, l) === 0} onClick={() => game.dispatch({ type: 'movePallet', palletId: p.id, loc: l })}>
            {l === 'backroom' ? 'Na zaplecze' : l === 'floor' ? 'Do sali' : 'Pod sklep'}
          </button>
        ))}
      </div>
      {p.loc === 'aisle' && !compact && <p class="tt-hint">Stoi w przejściu: klienci się o nią potykają, a reputacja spada. Rozładuj ją albo przenieś na wolne miejsce.</p>}
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
        <div class="tt-stepper">
          <button type="button" class="tt-btn" aria-label="Zwolnij" onClick={() => game.dispatch({ type: 'fire' })}>−</button>
          <b>{osoby(s.staff)}</b>
          <button type="button" class="tt-btn" aria-label="Zatrudnij" data-risk={s.staff >= STAFF_MAX ? undefined : spendRisk(s, HIRE_COST)} disabled={s.staff >= STAFF_MAX} onClick={() => game.dispatch({ type: 'hire' })}>+</button>
        </div>
        <Row label="Płace">{int(s.staff * WAGE_PER_DAY)} zł / dzień</Row>
        <p class="tt-hint">Rekrutacja: {HIRE_COST} zł. Każda osoba na zmianie to {WAGE_PER_DAY} zł dziennie (dwa etaty na 17-godzinny dzień).</p>
        {s.staff < STAFF_MAX && <SpendNote s={s} price={HIRE_COST} />}
      </Section>
      <Section title="Profil pracy">
        <div class="tt-seg wide" role="group" aria-label="Profil pracy">
          {STAFF_PROFILES.map((p) => (
            <button key={p} type="button" class={`tt-btn${profile === p ? ' on' : ''}`} onClick={() => game.dispatch({ type: 'setStaffProfile', profile: p })}>{PROFILE_LABEL[p]}</button>
          ))}
        </div>
        <p class="tt-hint">{profile === 'wlasny' ? PROFILE_LABEL.wlasny : PROFILE_HINT[profile]}</p>
        <p class="tt-hint">Jedna osoba: kasa ~{int(TILL_RATE * fx.tillSpeed * 60)} klientów/h albo rozładunek ~{int(UNLOAD_RATE * fx.unloadMult * 60)} szt./h, wykładanie ~{int(RESTOCK_RATE * 60)} szt./h.</p>
      </Section>
      <Section title="Kto co robi teraz">
        {STAFF_TASKS.map((t) => {
          const pinned = pool.pinned[t];
          return (
            <Row key={t} label={TASK_LABEL[t]}>
              <span class="tt-task-n">{osoby(doing(t))}</span>
              <span class="tt-pin" role="group" aria-label={`Przypięcie: ${TASK_LABEL[t]}`}>
                <button type="button" class="tt-btn" aria-label={`Odepnij od zadania: ${TASK_LABEL[t]}`} disabled={pinned <= 0}
                  onClick={() => game.dispatch({ type: 'pinStaff', task: t, count: pinned - 1 })}>−</button>
                <span class="tt-pin-n">📌 {pinned}</span>
                <button type="button" class="tt-btn" aria-label={`Przypnij do zadania: ${TASK_LABEL[t]}`} disabled={pinnedAll >= s.staff}
                  onClick={() => game.dispatch({ type: 'pinStaff', task: t, count: pinned + 1 })}>+</button>
              </span>
            </Row>
          );
        })}
        <Row label="Wolni"><span class="tt-task-n">{osoby(doing('wolny'))}</span></Row>
        <p class="tt-hint">Liczby to zgadnięcie z ostatniej minuty pracy; nocą nikogo nie ma. 📌 przypina osoby do zadania: biorą je najpierw, a gdy nie ma w nim pracy, wracają do puli (przypiętych razem najwyżej {osoby(s.staff)}).</p>
      </Section>
      <Section title="Dziś">
        {STAFF_TASKS.map((t) => {
          const worked = pool.day.worked[t];
          const robot = pool.day.robot[t];
          const waited = pool.day.starved[t];
          return (
            <div key={t}>
              <Row label={TASK_LABEL[t]}>{int(worked)} osobomin{robot > 0 ? ` (w tym automatyka ${int(robot)})` : ''}</Row>
              {waited > STARVED_WARN_MIN && <div class="tt-muted warn tt-starved">czekało {int(waited)} min</div>}
            </div>
          );
        })}
        <p class="tt-hint">Osobominuta to minuta pracy jednej osoby. „Czekało” znaczy, że zadanie miało pracę, a nikt jej nie wziął: brakuje rąk albo przypięć.</p>
      </Section>
      {(robots.tasmociag > 0 || robots.wykladacz > 0 || fx.humanoid) && (
        <Section title="Automatyka (warsztat)">
          {robots.tasmociag > 0 && <Row label="Taśmociąg">poziom {robots.tasmociag}</Row>}
          {robots.wykladacz > 0 && <Row label="Wykładacz">poziom {robots.wykladacz}</Row>}
          {fx.humanoid && <Row label="Humanoid eDward">pracuje 24/7 🤖</Row>}
          <p class="tt-hint">Automatyka pracuje także w nocy, gdy sklep jest zamknięty.</p>
        </Section>
      )}
    </>
  );
}

// --- Ulepszenia --------------------------------------------------------------------------------------

export function ShopPanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
  const remont = nextRemont(s);
  const closed = isClosedForRemont(s);
  const groups: UpgradeGroup[] = ['kasa', 'palety', 'klienci', 'warsztat'];
  const capacityFree = info.slots.reduce((n, x) => n + slotFree(s, info, x.id), 0);
  return (
    <>
      <Section title="Sprzęt do slotów">
        <p class="tt-hint">Wolne miejsce w slotach: {capacityFree}. Slot 2×2 mieści dwie kasy samoobsługowe. Możesz też stuknąć slot w sklepie.</p>
        {EQUIPMENT.map((e) => {
          const cost = equipmentCost(e, s.equipment.filter((x) => x.id === e.id).length);
          const owned = s.equipment.filter((x) => x.id === e.id).length;
          const locked = s.level < e.minLevel;
          return (
            <div key={e.id} class={`tt-item${locked ? ' locked' : ''}`}>
              <div><b>{locked ? '🔒 ' : ''}{e.name}</b>{owned > 0 ? <span class="tt-muted"> ×{owned}</span> : null}<div class="tt-muted">{e.effect}{e.size === 2 ? ' · zajmuje cały slot 2×2' : ''}</div>
                {locked && <div class="tt-muted warn">Odblokujesz na {e.minLevel}. poziomie</div>}
                {!locked && <SpendNote s={s} price={cost} />}</div>
              <button type="button" class="tt-btn tt-buy" data-risk={locked ? undefined : spendRisk(s, cost)} disabled={locked || cost > s.cash} onClick={() => game.dispatch({ type: 'buyEquipment', id: e.id })}>{zl(cost)}</button>
            </div>
          );
        })}
      </Section>
      {groups.map((g) => {
        if (g === 'warsztat' && !workshopUnlocked(s)) {
          return (
            <Section key={g} title={`🔒 ${GROUP_LABEL[g]}`}>
              <p class="tt-hint">Franczyzobiorca zakasuje rękawy: automatyka DIY, a na końcu humanoid eDward. Odblokujesz na {WORKSHOP_LEVEL}. poziomie albo po pierwszym remoncie (teraz: poziom {s.level}).</p>
            </Section>
          );
        }
        const items = UPGRADES.filter((u) => u.group === g).filter((u) => {
          const b = upgradeBlocker(s, u);
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
                    <b>{maxed ? u.names[u.names.length - 1] : name}</b>
                    {u.maxLevel > 1 && <span class="tt-muted"> {lvl}/{u.maxLevel}</span>}
                    <div class="tt-muted">{u.effect}</div>
                    <div class="tt-flavor">{u.flavor}</div>
                    {blocker && !maxed && <div class="tt-muted warn">{blocker}</div>}
                    {!blocker && !maxed && <SpendNote s={s} price={cost} />}
                  </div>
                  {maxed
                    ? <span class="tt-check">✓</span>
                    : <button type="button" class="tt-btn tt-buy" data-risk={blocker ? undefined : spendRisk(s, cost)} disabled={!!blocker || cost > s.cash} onClick={() => game.dispatch({ type: 'buyUpgrade', id: u.id })}>{zl(cost)}</button>}
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
              <p class="tt-hint">Remont trwa jeszcze {duration((s.remontUntil ?? 0) - s.minute)}.</p>
              <button type="button" class="tt-btn" disabled={s.ogonki < 40} onClick={() => game.dispatch({ type: 'rushRemont' })}>Przyspiesz o dzień (40 🦎)</button>
            </>
          )
          : remont
            ? (
              <div class="tt-item">
                <div><b>{s.level < remont.minLevel ? '🔒 ' : ''}{remont.name}</b><div class="tt-muted">Większy lokal: więcej półek, slotów ({remont.slots} × 2×2) i miejsc na palety, więcej klientów. Sklep zamknięty {remont.days} {plural(remont.days, 'dzień', 'dni', 'dni')}.</div>
                  {s.level < remont.minLevel && <div class="tt-muted warn">Odblokujesz na {remont.minLevel}. poziomie</div>}
                  {s.level >= remont.minLevel && <SpendNote s={s} price={remont.cost} />}</div>
                <button type="button" class="tt-btn tt-buy" data-risk={s.level < remont.minLevel ? undefined : spendRisk(s, remont.cost)} disabled={s.level < remont.minLevel || remont.cost > s.cash} onClick={() => game.dispatch({ type: 'startRemont' })}>{zl(remont.cost)}</button>
              </div>
            )
            : <p class="tt-hint">To już Flagowiec. Większego sklepu nie będzie.</p>}
      </Section>
      <Section title="Za Ogonki">
        <div class="tt-item">
          <div><b>Kampania w Traszkapce</b><div class="tt-muted">+30% klientów przez dobę</div></div>
          <button type="button" class="tt-btn tt-buy" disabled={s.ogonki < 30} onClick={() => game.dispatch({ type: 'campaign' })}>30 🦎</button>
        </div>
      </Section>
    </>
  );
}

// --- Cele i wyniki -------------------------------------------------------------------------------------

export function GoalsPanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
  const t = s.today;
  const m = s.month;
  const profit = (k: typeof t): number => k.margin + k.bonus + k.other - k.wages - k.media - k.fee - k.fines - k.logistics - k.wut;
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
  // w trakcie miesiąca `m.fee` jest zerem (opłata schodzi dopiero przy zamknięciu), więc pokazujemy, ile naliczy się od dzisiejszego obrotu
  const fee = franchiseFee(m.revenue);
  const forecast = forecastMonth(s);   // rachunek końca miesiąca (ten sam co w pasku): opłata, premia, ubytki i wolne środki
  const nextRank = nextRankAt(s.level);
  const meta = metaView.value;
  return (
    <>
      <Section title="KPI tygodnia">
        <div class="tt-kpi">
          <div class="tt-row"><b>{kpiTitle(kpi.kind, kpi.target, int)}</b></div>
          <Bar value={kpiDone} />
          <div class="tt-row"><span class="tt-muted">{KPI_FLAVOR[kpi.kind]}</span><span class="tt-muted">{pct(kpiDone)}</span></div>
          <div class="tt-kpi-days">do niedzieli: <b>{daysLeft === 0 ? 'dziś' : `${daysLeft} ${plural(daysLeft, 'dzień', 'dni', 'dni')}`}</b></div>
          <div class="tt-kpi-reward">Nagroda: zaufanie +{KPI.trustHit}, premia ok. {zl(kpiBonus)}, +{kpiXp} XP</div>
        </div>
        <p class="tt-hint">Rozliczenie w niedzielę o 23:00. Nietrafiony cel: zaufanie −{-KPI.trustMiss}.</p>
      </Section>
      <Section title={`Poziom ${s.level}: ${rankFor(s.level)}`}>
        <Bar value={s.xp / xpToNext(s.level)} />
        <Row label="Doświadczenie">{int(s.xp)} / {int(xpToNext(s.level))} XP</Row>
        {nextRank && <p class="tt-hint">Następna ranga ({rankFor(nextRank)}) na {nextRank}. poziomie. Każdy poziom to nagroda, a niektóre coś odblokowują.</p>}
      </Section>
      <Section title="Twoja sieć Traszek">
        <Row label="Sklepy w sieci">{meta.stores}</Row>
        <Row label="Dochód z sieci">{zl(meta.networkIncome)} / dzień</Row>
        <Row label="Punkty Partnera">{meta.points} (+{4 * meta.points}% marży, +{3 * meta.points}% ruchu)</Row>
        {ranked.value
          ? <p class="tt-hint">W biegu rankingowym nie ma sieci sklepów: ten sklep nie dostaje premii z sieci i do niej nie dołączy.</p>
          : meta.network.includes(s.seed)
          ? <p class="tt-hint">Ten lokal już jest w Twojej sieci, więc drugi raz nie da Punktów Partnera ani dochodu. Otwórz sklep z innym seedem (Ustawienia), żeby sieć rosła.</p>
          : prestigeReady(s)
          ? (
            <>
              <p class="tt-hint">Ten sklep jest gotowy, by dołączyć do sieci: da <b>+{prestigePoints(s)} Punktów Partnera</b> i <b>{zl(networkIncomeOf(s))}</b> dziennie w każdej kolejnej grze.</p>
              <button type="button" class="tt-btn tt-primary big" onClick={() => { showPrestige.value = true; }}>Otwórz kolejną Traszkę</button>
            </>
          )
          : <p class="tt-hint">Po drugim remoncie albo na 20. poziomie otworzysz kolejną Traszkę. Ten sklep dołączy do sieci i będzie zarabiał na każdą następną.</p>}
      </Section>
      <Section title="Kamienie milowe">
        {ready.map((g) => (
          <div key={g.id} class="tt-goal ready">
            <div class="tt-row">
              <span><span class="tt-goal-tag">🎁 Do odebrania</span> <b>{g.label}</b></span>
              <button type="button" class="tt-btn tt-primary" aria-label={`Odbierz: ${g.label}`} onClick={() => game.dispatch({ type: 'claimMilestone', id: g.id })}>Odbierz</button>
            </div>
            <div class="tt-muted">Nagroda: +{g.reward} 🦎 i XP</div>
          </div>
        ))}
        {goals.map((g) => <div key={g.id} class="tt-goal"><b>{g.label}</b> <span class="tt-muted">+{g.reward} 🦎</span><div class="tt-muted">{g.hint}</div></div>)}
        <p class="tt-hint">Zdobyte: {s.milestones.length} / {MILESTONES.length}</p>
      </Section>
      <Section title="Dziś">
        <Row label="Klienci">{int(t.customers)} (utraceni: {int(t.lost)})</Row>
        <Row label="Obrót">{zl(t.revenue)}</Row>
        <Row label="Marża i premie (Twój przychód)">{zl(t.margin + t.bonus + t.other)}</Row>
        <Row label="Koszty (bez płac)">{zl(t.fines + t.logistics + t.wut)}</Row>
        <p class="tt-hint">Płace i media rozliczają się przy zamknięciu, o 23:00.</p>
      </Section>
      <Section title="Ten miesiąc">
        <Row label="Obrót">{zl(m.revenue)}</Row>
        <Row label="Marża i premie">{zl(m.margin + m.bonus + m.other)}</Row>
        <Row label="Płace">−{zl(m.wages)}</Row>
        <Row label="Media">−{zl(m.media)}</Row>
        <Row label="Mandaty">−{zl(m.fines)}</Row>
        <Row label="Logistyka">−{zl(m.logistics)}</Row>
        <Row label="Ubytki ponad limit Centrali">−{zl(m.wut)}</Row>
        <Row label="Opłata franczyzowa (naliczona do dziś)">−{zl(fee)}</Row>
        <Row label="Wynik po opłacie (do dziś)"><b>{signedZl(profit(m) - fee)}</b></Row>
        <Row label="Inwestycje">{zl(m.investments)}</Row>
        {forecast.bonus > 0 && <Row label="Premia od obrotu (naliczona do dziś)">+{zl(forecast.bonus)}</Row>}
        {forecast.wut > 0 && <Row label="Ubytki ponad limit (naliczone do dziś)">−{zl(forecast.wut)}</Row>}
        <Row label="Do oddania Centrali przy zamknięciu"><b>{zl(forecast.due)}</b></Row>
        <Row label="Wolne środki po rozliczeniu"><b class={`tt-free ${spendCheck(forecast, 0).level}`}>{signedZl(forecast.free)}</b></Row>
        <p class="tt-hint">Opłatę franczyzową, ubytki ponad limit Centrali i premię od obrotu Centrala rozlicza przy zamknięciu miesiąca. Zostaw gotówkę na opłaty.</p>
        <p class="tt-hint">Kwota „do oddania” rośnie z obrotem. Wolne środki to gotówka minus ona, bez dochodów i płac z reszty miesiąca.</p>
        <button type="button" class="tt-btn" onClick={openMonthPreview}>Koniec miesiąca: rachunek i podgląd</button>
        {/* ostrzeżenie wynika ze stanu (gotówka), więc wraca po przeładowaniu, a okno „OK” z chwili zejścia pod próg nie jest zapisywane */}
        {s.cash < DEBT_WARN && <p class="tt-hint warn">{debtWarningText(s.cash)}</p>}
      </Section>
      {s.history.length > 0 && (
        <Section title="Poprzednie miesiące">
          {s.history.slice(-6).map((h) => (
            <div key={h.label} class="tt-hist">
              <span>{h.label}</span>
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

