import type { ComponentChildren } from 'preact';
import { t } from '@/i18n';
import { DISTRICT_COLOR } from '@/render/city/buildCity';
import { RIVAL_RADIUS_M } from '@/sim/city/traffic';
import type { CityLot } from '@/sim/city/types';
import { lotState } from '@/sim/firm/commands';
import type { FirmState } from '@/sim/firm/types';
import { lotPay, selectedLot, tab, type GameActions } from '../state';
import { percentOf, plural, zl } from '../game/format';
import { freeLotRows, lotCardModel, neighbourLot, swipeDirection, type LotRow } from './cityModel';
import { brandName, districtName, levelText, lotKindName, lotStateName, refusalText, sourceText } from './cityText';
import { addressText } from './firmText';

/*
 * Karta lokalu (spec §9.3): widełki klientów, kto przychodzi, koszyk, oczekiwania i kradzieże słowami, konkurencja obok, czas budowy
 * i pakiet otwarcia (za gotówkę albo na raty) z przyciskiem „Biorę lokal”, który mówi tekstem Centrali, dlaczego nie działa. Lokal
 * obok sklepu prowadzi do Ulepszeń (zajmuje go remont), reszta lokali ma kartę informacyjną. Liczby z `cityModel.ts`, teksty z
 * `cityText.ts`. Bez haków: przesunięcie palcem po karcie trzyma pamięć na poziomie modułu (jedna karta naraz).
 */

const row = (label: string, value: ComponentChildren) => <div class="tt-row"><span>{label}</span><span>{value}</span></div>;

/** Początek przesunięcia palcem po karcie. */
let swipeFrom: { id: number; x: number; y: number } | null = null;

const close = (): void => { selectedLot.value = null; };

/** Nagłówek: numer na kartce, adres, ✕, dzielnica, format i (dla wolnego lokalu) ‹ › po liście wolnych lokali. */
function head(lot: CityLot, no: number, nav: { rows: readonly LotRow[]; lotId: number } | null) {
  const at = nav ? nav.rows.findIndex((r) => r.lotId === nav.lotId) : -1;
  return (
    <div class="tt-lotcard-head">
      <div class="tt-lotcard-title">
        {no > 0 && <span class="tt-lotno">{no}</span>}
        <h3>{addressText(lot.street, lot.number)}</h3>
        <button type="button" class="tt-iconbtn tt-lotcard-close" aria-label={t`Zamknij`} onClick={close}>✕</button>
      </div>
      <div class="tt-lotcard-sub">
        <span class="tt-dz" style={{ background: DISTRICT_COLOR[lot.district] }}>{districtName(lot.district)}</span>
        <span class="tt-muted">{lotKindName(lot.spec.kind, lot.spec.corner, lot.district)}</span>
        {nav && at >= 0 && nav.rows.length > 1 && (
          <div class="tt-lotnav">
            <button type="button" class="tt-iconbtn" aria-label={t`Poprzedni lokal`} onClick={() => { selectedLot.value = neighbourLot(nav.rows, nav.lotId, -1); }}>‹</button>
            <span class="tt-muted">{t`lokal ${at + 1} z ${nav.rows.length}`}</span>
            <button type="button" class="tt-iconbtn" aria-label={t`Następny lokal`} onClick={() => { selectedLot.value = neighbourLot(nav.rows, nav.lotId, 1); }}>›</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Karta wolnego lokalu: wszystko, co trzeba wiedzieć przed wynajmem, i przycisk „Biorę lokal”. */
function rentCard(f: FirmState, lot: CityLot, game: GameActions) {
  const lotId = lot.id;
  const pay = lotPay.value;
  const model = lotCardModel(f.seed, f, lotId, pay);
  const rows = freeLotRows(f.seed, f);
  const { plan, price } = model;
  const rent = (): void => {
    const result = game.firm({ type: 'rentLot', lotId, pay });
    if (result.ok) selectedLot.value = null;
  };
  // przesunięcie palcem w lewo to następny lokal, w prawo poprzedni (telefon: karta wysuwa się od dołu, mapa zostaje u góry)
  const down = (e: PointerEvent): void => { swipeFrom = { id: e.pointerId, x: e.clientX, y: e.clientY }; };
  const up = (e: PointerEvent): void => {
    const from = swipeFrom;
    swipeFrom = null;
    if (!from || from.id !== e.pointerId) return;
    const dir = swipeDirection(e.clientX - from.x, e.clientY - from.y);
    if (dir !== null) selectedLot.value = neighbourLot(rows, lotId, dir);
  };
  return (
    <article class="tt-lotcard" onPointerDown={down} onPointerUp={up} onPointerCancel={() => { swipeFrom = null; }}>
      {head(lot, model.row.no, { rows, lotId })}
      {row(t`Klienci dziennie`, <><b>{`${model.row.lo}–${model.row.hi}`}</b> <span class="tt-muted">{t`(szacunek)`}</span></>)}
      {row(t`Kto przychodzi`, model.who.map(sourceText).join(', '))}
      {row(t`Koszyk`, levelText(model.basket, true))}
      {row(t`Oczekiwania`, levelText(model.expectations))}
      {row(t`Kradzieże`, levelText(model.theft))}
      {model.theft === 'wysokie' && <p class="tt-hint warn">⚠️ {t`kradzieże: wysokie, zobaczysz je przy remanencie`}</p>}
      {row(t`Konkurencja obok`, model.rivals.length === 0
        ? t`brak w promieniu ${RIVAL_RADIUS_M} m`
        : model.rivals.map((r, i) => <div key={i}>{`${brandName(r.brand)}, ${r.meters} m`}</div>))}
      {row(t`Budowa`, <>{model.buildDays} {plural(model.buildDays, 'dzień', 'dni', 'dni')}</>)}
      <div class="tt-lotprice" data-tut="lot-price">
        <h4>{t`Pakiet otwarcia`}</h4>
        <div class="tt-seg wide tt-lotpay" role="group" aria-label={t`Sposób zapłaty`}>
          <button type="button" class={`tt-btn${pay === 'gotowka' ? ' on' : ''}`} aria-pressed={pay === 'gotowka'} onClick={() => { lotPay.value = 'gotowka'; }}>
            {t`za gotówkę ${zl(price)}`}
          </button>
          <button type="button" class={`tt-btn${pay === 'raty' ? ' on' : ''}`} aria-pressed={pay === 'raty'} onClick={() => { lotPay.value = 'raty'; }}>
            {t`na raty ${zl(plan.monthly)} × ${plan.months} z przelewów tego sklepu`}
          </button>
        </div>
        <p class="tt-hint">{t`Raty razem ${zl(plan.total)}, w tym opłata ${zl(plan.fee)} (${percentOf(plan.feeShare)}). Za gotówkę po zapłacie musi zostać co najmniej 0 zł.`}</p>
      </div>
      <div class="tt-lotact">
        <button type="button" class="tt-btn tt-primary big" disabled={!model.action.enabled} onClick={rent}>{t`Biorę lokal`}</button>
        {!model.action.enabled && <p class="tt-lockmsg">{refusalText(model.action.reason)}</p>}
      </div>
    </article>
  );
}

/** Lokal obok własnego sklepu: nie leży na liście wolnych, bo zajmuje go remont, więc karta wysyła do Ulepszeń. */
function nextDoorCard(lot: CityLot) {
  return (
    <article class="tt-lotcard">
      {head(lot, 0, null)}
      <p>{t`Ten lokal zajmiesz remontem „Dokupienie lokalu obok”`}</p>
      <div class="tt-lotact">
        <button type="button" class="tt-btn tt-primary big" onClick={() => { tab.value = 'ulepszenia'; }}>{t`Do Ulepszeń`}</button>
      </div>
    </article>
  );
}

/** Pozostałe lokale (konkurencja, własne, w budowie, po Traszce): sam opis, bez zakupu. */
function infoCard(f: FirmState, lot: CityLot) {
  const state = lotState(f, lot.id);
  return (
    <article class="tt-lotcard">
      {head(lot, 0, null)}
      {row(t`Stan`, lotStateName(state))}
      {lot.brand && state === 'konkurencja' && row(t`Marka`, brandName(lot.brand))}
    </article>
  );
}

/** Karta lokalu `lotId` miasta (stan lokalu rozstrzyga, która). Nieznany lokal to brak karty. */
export function LotCard({ f, lotId, game }: { f: FirmState; lotId: number; game: GameActions; v: number }) {
  const lot = f.city.lots[lotId];
  if (!lot || lot.id !== lotId) return null;
  const state = lotState(f, lotId);
  if (state === 'wolny') return rentCard(f, lot, game);
  if (state === 'obok') return nextDoorCard(lot);
  return infoCard(f, lot);
}
