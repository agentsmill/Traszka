import type { ComponentChildren } from 'preact';
import { CATS, CAT_INFO, HIRE_COST, HOUR_CURVE, ORDER_DEADLINE, RESTOCK_RATE, RETURN_FEE, SCO_RATE, STAFF_MAX, TILL_RATE, UNLOAD_RATE, WAGE_PER_DAY } from '@/sim/economy/catalog';
import { formatClock, minuteOfDay } from '@/sim/economy/calendar';
import {
  LOC_LABEL, PRIORITY_LABEL, assistantSuggestion, effects, expectedDailyCustomers, freeSpots, isClosedForRemont, level,
  nextRemont, plPallets, slotFree, slotUsage, upgradeBlocker, workshopUnlocked, type EconomyState, type Priority,
} from '@/sim/economy/economy';
import { MILESTONES } from '@/sim/economy/milestones';
import type { PalletLoc, StoreInfo } from '@/sim/economy/storeInfo';
import {
  EQUIPMENT, GROUP_LABEL, UPGRADES, WORKSHOP_LEVEL, equipmentCost, upgradeCost, type UpgradeGroup,
} from '@/sim/economy/upgrades';
import { nextRankAt, rankFor, xpToNext } from '@/sim/economy/progress';
import { questDone, questProgress } from '@/sim/economy/quests';
import { networkIncomeOf, prestigePoints, prestigeReady } from '@/game/meta';
import { econ, metaView, selection, showPrestige, tab, type GameActions, type TabId } from '../state';
import { duration, int, pct, plural, signedZl, zl } from './format';

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
    badge.palety = view.s.pallets.filter((p) => p.loc === 'sidewalk').length || undefined;
    const affordable = UPGRADES.filter((u) => !upgradeBlocker(view.s, u) && upgradeCost(u, level(view.s, u.id)) <= view.s.cash).length;
    badge.ulepszenia = affordable || undefined;
    badge.cele = view.s.quests.filter((q) => questDone(view.s, q)).length || undefined;
  }
  return (
    <nav class="tt-tabs" aria-label="Zakładki">
      {TABS.map((t) => (
        <button key={t.id} type="button" class={`tt-tab${tab.value === t.id ? ' on' : ''}${t.id === 'cele' && badge.cele ? ' ready' : ''}`} aria-pressed={tab.value === t.id}
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
        {open === 'cele' && <GoalsPanel s={view.s} game={game} v={view.v} />}
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

function StorePanel({ s, info }: { s: EconomyState; info: StoreInfo; v: number }) {
  const fx = effects(s, info);
  const cap = capacityPerHour(s, info);
  const hour = Math.floor(minuteOfDay(s.minute) / 60);
  const demand = expectedDailyCustomers(s, info) / 15.6 * (HOUR_CURVE[hour] ?? 0);
  const peak = expectedDailyCustomers(s, info) / 15.6 * 1.3;
  const backroom = CATS.reduce((n, c) => n + s.backroom[c], 0);
  const usage = slotUsage(s);
  return (
    <>
      <Section title="Kasa i kolejka">
        <Row label="Kolejka">{int(s.queue)} {plural(Math.round(s.queue), 'osoba', 'osoby', 'osób')} (cierpliwość: {fx.patience})</Row>
        <Bar value={s.queue / Math.max(1, fx.patience)} warn={s.queue >= fx.patience} />
        <Row label="Stanowiska kasowe">{fx.tills}, teraz na kasie: {s.lastCashiers}</Row>
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
        <Row label="Zaufanie Centrali">{int(s.trust)} / 100</Row>
        <Bar value={s.trust / 100} warn={s.trust < 30} />
        <p class="tt-hint">Reputacja rośnie, gdy klienci znajdują towar i nie czekają. Spada przez puste półki, kolejki i mandaty.</p>
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

function PalletsPanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
  const suggestion = assistantSuggestion(s, info);
  const mod = minuteOfDay(s.minute);
  const pending = s.deliveries.reduce((n, d) => n + d.count, 0);
  const fx = effects(s, info);
  const workPerHour = (s.lastWorkers * UNLOAD_RATE * fx.unloadMult + fx.autoUnload) * 60;
  return (
    <>
      <Section title="Zamówienie na jutro">
        <div class="tt-seg wide" role="group" aria-label="Kto zamawia">
          <button type="button" class={`tt-btn${s.order.auto ? ' on' : ''}`} onClick={() => game.setOrder(true)}>Asystent Traszki</button>
          <button type="button" class={`tt-btn${!s.order.auto ? ' on' : ''}`} onClick={() => game.setOrder(false, s.order.manual)}>Ręcznie</button>
        </div>
        {s.order.auto
          ? <p class="tt-hint">Asystent zamówi <b>{suggestion} {plPallets(suggestion)}</b>. {level(s, 'asystent') === 0 ? 'Zwykle trochę przesadza („klienci to kochają”).' : 'Po szkoleniu już mniej przesadza.'}</p>
          : (
            <div class="tt-stepper">
              <button type="button" class="tt-btn" aria-label="Mniej" onClick={() => game.setOrder(false, s.order.manual - 1)}>−</button>
              <b>{s.order.manual} {plPallets(s.order.manual)}</b>
              <button type="button" class="tt-btn" aria-label="Więcej" onClick={() => game.setOrder(false, s.order.manual + 1)}>+</button>
              <span class="tt-muted">asystent: {suggestion}</span>
            </div>
          )}
        <p class="tt-hint">Zamówienie zamyka się o {formatClock(ORDER_DEADLINE)}{mod < ORDER_DEADLINE ? ' (dziś)' : ' (jutro)'}. Dostawa rano{fx.splitDelivery ? ' i o 15:00' : ''}. W drodze: {pending} {plPallets(pending)}.</p>
      </Section>
      <Section title={`Palety (${s.pallets.length})`}>
        <Row label="Wolne miejsca">pod sklepem {freeSpots(s, info, 'sidewalk')} · zaplecze {freeSpots(s, info, 'backroom')} · sala {freeSpots(s, info, 'floor')}</Row>
        <Row label="Rozładunek teraz">~{int(workPerHour)} szt./h ({s.lastWorkers} {plural(s.lastWorkers, 'osoba', 'osoby', 'osób')}{fx.autoUnload > 0 ? ' + automatyka' : ''})</Row>
        {s.pallets.length === 0 && <p class="tt-hint">Brak palet. Cisza przed dostawą.</p>}
        {s.pallets.map((p) => <PalletItem key={p.id} s={s} info={info} id={p.id} game={game} />)}
        <p class="tt-hint">Pod sklepem: ryzyko mandatu Straży Miejskiej. W sali: korek i mniej klientów. Zaplecze: bezpiecznie, ale miejsc jest mało.</p>
      </Section>
    </>
  );
}

export function PalletItem({ s, info, id, game, compact = false }: { s: EconomyState; info: StoreInfo; id: number; game: GameActions; compact?: boolean }) {
  const p = s.pallets.find((x) => x.id === id);
  if (!p) return <p class="tt-hint">Paleta rozładowana. 💪</p>;
  const age = s.minute - p.since;
  const moves = (['backroom', 'floor', 'sidewalk'] as PalletLoc[]).filter((l) => l !== p.loc);
  return (
    <div class={`tt-pallet${p.loc === 'sidewalk' ? ' risk' : ''}`}>
      <div class="tt-row">
        <span><b>{LOC_LABEL[p.loc]}</b>{p.loc === 'sidewalk' ? ' ⚠️' : ''}</span>
        <span class="tt-muted">{int(p.total)} szt. · {duration(age)}</span>
      </div>
      <Bar value={p.total / p.initial} />
      <div class="tt-actions">
        <button type="button" class="tt-btn tt-primary" onClick={() => game.tapPallet(p.id)}>Rozładuj</button>
        {moves.map((l) => (
          <button key={l} type="button" class="tt-btn" disabled={freeSpots(s, info, l) === 0} onClick={() => game.movePallet(p.id, l)}>
            {l === 'backroom' ? 'Na zaplecze' : l === 'floor' ? 'Do sali' : 'Pod sklep'}
          </button>
        ))}
        {!compact && <button type="button" class="tt-btn" title={`Odesłanie kosztuje ${RETURN_FEE} zł i zaufanie Centrali`} onClick={() => game.returnPallet(p.id)}>Odeślij</button>}
      </div>
    </div>
  );
}

// --- Ludzie ------------------------------------------------------------------------------------------

const PRIORITY_HINT: Record<Priority, string> = {
  klienci: 'Przy kolejce otwierają się wszystkie kasy. Palety czekają.',
  rowno: 'Na kasie tyle osób, ile trzeba na kolejkę (przy SCO czasem nikt). Reszta rozładowuje.',
  palety: 'Na kasie ktoś staje dopiero przy długiej kolejce (albo gdy nie ma SCO). Reszta przy paletach.',
};

function PeoplePanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
  const fx = effects(s, info);
  return (
    <>
      <Section title="Zespół na zmianie">
        <div class="tt-stepper">
          <button type="button" class="tt-btn" aria-label="Zwolnij" onClick={() => game.fire()}>−</button>
          <b>{s.staff} {plural(s.staff, 'osoba', 'osoby', 'osób')}</b>
          <button type="button" class="tt-btn" aria-label="Zatrudnij" disabled={s.staff >= STAFF_MAX} onClick={() => game.hire()}>+</button>
        </div>
        <Row label="Płace">{int(s.staff * WAGE_PER_DAY)} zł / dzień</Row>
        <p class="tt-hint">Rekrutacja: {HIRE_COST} zł. Każda osoba na zmianie to {WAGE_PER_DAY} zł dziennie (dwa etaty na 17-godzinny dzień).</p>
        <Row label="Teraz">{s.lastCashiers} na kasie · {s.lastWorkers} przy paletach i półkach</Row>
      </Section>
      <Section title="Priorytet pracy">
        <div class="tt-seg wide" role="group" aria-label="Priorytet">
          {(['klienci', 'rowno', 'palety'] as Priority[]).map((p) => (
            <button key={p} type="button" class={`tt-btn${s.priority === p ? ' on' : ''}`} onClick={() => game.setPriority(p)}>{PRIORITY_LABEL[p]}</button>
          ))}
        </div>
        <p class="tt-hint">{PRIORITY_HINT[s.priority]}</p>
        <p class="tt-hint">Jedna osoba: kasa ~{int(TILL_RATE * fx.tillSpeed * 60)} klientów/h albo rozładunek ~{int(UNLOAD_RATE * fx.unloadMult * 60)} szt./h, wykładanie ~{int(RESTOCK_RATE * 60)} szt./h.</p>
      </Section>
      {(fx.autoUnload > 0 || fx.autoRestock > 0) && (
        <Section title="Automatyka (warsztat)">
          {level(s, 'tasmociag') > 0 && <Row label="Taśmociąg">poziom {level(s, 'tasmociag')}</Row>}
          {level(s, 'wykladacz') > 0 && <Row label="Wykładacz">poziom {level(s, 'wykladacz')}</Row>}
          {fx.humanoid && <Row label="Humanoid eDward">pracuje 24/7 🤖</Row>}
          <p class="tt-hint">Automatyka pracuje także w nocy, gdy sklep jest zamknięty.</p>
        </Section>
      )}
    </>
  );
}

// --- Ulepszenia --------------------------------------------------------------------------------------

function ShopPanel({ s, info, game }: { s: EconomyState; info: StoreInfo; game: GameActions; v: number }) {
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
                {locked && <div class="tt-muted warn">Odblokujesz na {e.minLevel}. poziomie</div>}</div>
              <button type="button" class="tt-btn tt-buy" disabled={locked || cost > s.cash} onClick={() => game.buyEquipment(e.id)}>{zl(cost)}</button>
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
                  </div>
                  {maxed
                    ? <span class="tt-check">✓</span>
                    : <button type="button" class="tt-btn tt-buy" disabled={!!blocker || cost > s.cash} onClick={() => game.buyUpgrade(u.id)}>{zl(cost)}</button>}
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
              <button type="button" class="tt-btn" disabled={s.ogonki < 40} onClick={() => game.rushRemont()}>Przyspiesz o dzień (40 🦎)</button>
            </>
          )
          : remont
            ? (
              <div class="tt-item">
                <div><b>{s.level < remont.minLevel ? '🔒 ' : ''}{remont.name}</b><div class="tt-muted">Większy lokal: więcej półek, slotów ({remont.slots} × 2×2) i miejsc na palety, więcej klientów. Sklep zamknięty {remont.days} {plural(remont.days, 'dzień', 'dni', 'dni')}.</div>
                  {s.level < remont.minLevel && <div class="tt-muted warn">Odblokujesz na {remont.minLevel}. poziomie</div>}</div>
                <button type="button" class="tt-btn tt-buy" disabled={s.level < remont.minLevel || remont.cost > s.cash} onClick={() => game.startRemont()}>{zl(remont.cost)}</button>
              </div>
            )
            : <p class="tt-hint">To już Flagowiec. Większego sklepu nie będzie.</p>}
      </Section>
      <Section title="Za Ogonki">
        <div class="tt-item">
          <div><b>Kampania w Traszkapce</b><div class="tt-muted">+30% klientów przez dobę</div></div>
          <button type="button" class="tt-btn tt-buy" disabled={s.ogonki < 30} onClick={() => game.campaign()}>30 🦎</button>
        </div>
      </Section>
    </>
  );
}

// --- Cele i wyniki -------------------------------------------------------------------------------------

function GoalsPanel({ s, game }: { s: EconomyState; game: GameActions; v: number }) {
  const t = s.today;
  const m = s.month;
  const profit = (k: typeof t): number => k.margin + k.other - k.wages - k.media - k.fee - k.fines - k.logistics;
  const goals = MILESTONES.filter((x) => !s.milestones.includes(x.id)).slice(0, 3);
  const best = Math.max(1, ...s.history.map((h) => Math.abs(h.profit)));
  const nextRank = nextRankAt(s.level);
  const meta = metaView.value;
  return (
    <>
      <Section title="Zlecenia Centrali">
        {s.quests.map((q) => {
          const done = questDone(s, q);
          return (
            <div key={q.id} class={`tt-quest${done ? ' done' : ''}`}>
              <div class="tt-row"><b>{q.title}</b></div>
              <Bar value={questProgress(s, q)} />
              <div class="tt-row">
                <span class="tt-muted">+{zl(q.reward.cash)} · +{q.reward.ogonki} 🦎 · +{q.reward.xp} XP</span>
                {done
                  ? <button type="button" class="tt-btn tt-primary tt-claim" onClick={() => game.claimQuest(q.id)}>Odbierz!</button>
                  : <span class="tt-muted">{pct(questProgress(s, q))}</span>}
              </div>
            </div>
          );
        })}
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
        {meta.network.includes(s.seed)
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
        {goals.map((g) => <div key={g.id} class="tt-goal"><b>{g.label}</b> <span class="tt-muted">+{g.reward} 🦎</span><div class="tt-muted">{g.hint}</div></div>)}
        <p class="tt-hint">Zdobyte: {s.milestones.length} / {MILESTONES.length}</p>
      </Section>
      <Section title="Dziś">
        <Row label="Klienci">{int(t.customers)} (utraceni: {int(t.lost)})</Row>
        <Row label="Obrót">{zl(t.revenue)}</Row>
        <Row label="Marża (Twój przychód)">{zl(t.margin + t.other)}</Row>
        <Row label="Koszty (bez płac)">{zl(t.fines + t.logistics)}</Row>
        <p class="tt-hint">Płace i media rozliczają się przy zamknięciu, o 23:00.</p>
      </Section>
      <Section title="Ten miesiąc">
        <Row label="Obrót">{zl(m.revenue)}</Row>
        <Row label="Marża">{zl(m.margin + m.other)}</Row>
        <Row label="Płace">−{zl(m.wages)}</Row>
        <Row label="Media">−{zl(m.media)}</Row>
        <Row label="Mandaty">−{zl(m.fines)}</Row>
        <Row label="Logistyka">−{zl(m.logistics)}</Row>
        <Row label="Wynik (przed opłatą franczyzową)"><b>{signedZl(profit(m))}</b></Row>
        <Row label="Inwestycje">{zl(m.investments)}</Row>
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

