import { t } from '@/i18n';
import { DISTRICT_COLOR, TRAFFIC_BUSY, TRAFFIC_QUIET, type CityLayer } from '@/render/city/buildCity';
import { partnerProgress } from '@/sim/firm/commands';
import { openStores } from '@/sim/firm/firm';
import { MAX_STORES, type FirmState } from '@/sim/firm/types';
import { cityLayer, cityMockup, firm, selectedLot, shownCityLayer, type GameActions } from '../state';
import { zl } from '../game/format';
import { LotCard } from './LotCard';
import { ResearchSection } from './ResearchSection';
import { freeLotRows, validLot } from './cityModel';
import { districtName, lotKindName, lotStateName, progressText } from './cityText';
import { addressText, limitText } from './firmText';

/*
 * Ekran Miasta w arkuszu zakładki (spec §9): pasek statusu z przełącznikiem warstw, lista wolnych lokali i karta wybranego lokalu. Mapę
 * rysuje scena (`game/cityScreen.ts` podnosi ją, gdy zakładka jest otwarta), a ten panel mówi, co na niej jest. Na komputerze lista
 * i karta stoją w prawej kolumnie; na telefonie arkusz wysuwa się od dołu i pokazuje listę albo, po wyborze lokalu, kartę (CSS `.has-card`).
 * Komponenty nie mają haków i dostają `v` (wersję firmy) w propsach, bo firma zmienia się w miejscu. Pod listą stoją badania Sieci (4b,
 * `ResearchSection`): tylko dla Partnera w zwykłej grze, bo bez drugiego sklepu badania nie działają, a w rankingu sieci nie ma.
 */

const STATUS_ICON = { missing: '🔒', granted: '✅', ranked: '🏁' } as const;

/** Legenda trybu mapy: skala ruchu od cichego do tłocznego albo kolory dzielnic. Makieta ma własne kolory budynków i legendy nie ma. */
function legend(layer: CityLayer) {
  if (layer === 'makieta') return null;
  if (layer === 'ruch') {
    return (
      <div class="tt-citylegend">
        <span class="tt-muted">{t`mały ruch`}</span>
        <span class="tt-legend-grad" style={{ background: `linear-gradient(90deg, ${TRAFFIC_QUIET}, ${TRAFFIC_BUSY})` }} role="presentation" />
        <span class="tt-muted">{t`duży ruch`}</span>
      </div>
    );
  }
  return (
    <div class="tt-citylegend">
      {(['osiedle', 'srodmiescie', 'dworzec', 'biurowce', 'park'] as const).map((d) => (
        <span key={d} class="tt-legend-chip"><i style={{ background: DISTRICT_COLOR[d] }} role="presentation" />{districtName(d)}</span>
      ))}
    </div>
  );
}

/** Przycisk trybu mapy w przełączniku paska; `shown` to tryb, który się teraz pokazuje. */
const layerButton = (id: CityLayer, label: string, shown: CityLayer) => (
  <button type="button" class={`tt-btn${shown === id ? ' on' : ''}`} aria-pressed={shown === id} onClick={() => { cityLayer.value = id; }}>{label}</button>
);

/** Pasek miasta: postęp do statusu Partnera (albo tekst rankingowy), nazwa miasta, licznik placówek i przełącznik „Makieta / Ruch / Dzielnice” (makieta tylko, gdy profil sprzętu ją ma). */
export function CityBar({ f }: { f: FirmState; v: number }) {
  const p = partnerProgress(f);
  const mockup = cityMockup.value;
  const layer = shownCityLayer(cityLayer.value, mockup);
  const text = progressText(p);
  return (
    <div class="tt-citybar">
      <div class={`tt-citystatus ${p.kind}`} data-tut="city-status">
        <span aria-hidden="true">{STATUS_ICON[p.kind]}</span>
        <span>{p.kind === 'ranked' ? text : <><b>{t`Partner Strategiczny`}</b>: {text}</>}</span>
      </div>
      <div class="tt-citytools">
        <span class="tt-cityname">{f.city.name}</span>
        <span class="tt-muted">{t`placówki ${openStores(f).length + f.builds.length}/${f.storeLimit}`}</span>
        <div class="tt-seg tt-layers" role="group" aria-label={t`Warstwa mapy`}>
          {mockup && layerButton('makieta', t`Makieta`, layer)}
          {layerButton('ruch', t`Ruch`, layer)}
          {layerButton('dzielnice', t`Dzielnice`, layer)}
        </div>
      </div>
      {legend(layer)}
    </div>
  );
}

/** Czy limit placówek jest wypełniony (otwarte sklepy i budowy wobec `storeLimit`): wtedy lista mówi, jak go odblokować (`limitText`). Tylko dla Partnera w zwykłej grze, bo inaczej odmowa jest o czymś innym. */
const atLimit = (f: FirmState): boolean =>
  f.person.partner && !f.ranked && openStores(f).length + f.builds.length >= Math.min(f.storeLimit, MAX_STORES);

/**
 * Lista lokali do wzięcia: numer z kartki, adres, dzielnica, format i metraż, widełki klientów dziennie i pakiet otwarcia. Lokal „po Traszce”
 * (4a.2) stoi na liście z dopiskiem, ceną po zniżce i bez numeru (pusty znacznik trzyma kolumnę siatki).
 */
export function LotList({ f }: { f: FirmState; v: number }) {
  const rows = freeLotRows(f.seed, f);
  const chosen = validLot(f, selectedLot.value);
  return (
    <section class="tt-lotlist" aria-label={t`Wolne lokale`}>
      <h3>{t`Wolne lokale (${rows.length})`}</h3>
      {atLimit(f) && <p class="tt-hint tt-limit">{limitText(f)}</p>}
      {rows.length === 0 && <p class="tt-hint">{t`Brak wolnych lokali.`}</p>}
      {rows.map((r) => (
        <button key={r.lotId} type="button" class={`tt-lotrow${chosen === r.lotId ? ' sel' : ''}`} data-lot={r.lotId} aria-pressed={chosen === r.lotId}
          onClick={() => { selectedLot.value = r.lotId; }}>
          {r.no > 0 ? <span class="tt-lotno">{r.no}</span> : <span class="tt-lotno none" aria-hidden="true" />}
          <span class="tt-lotaddr">{addressText(r.street, r.number)} <span class="tt-dz" style={{ background: DISTRICT_COLOR[r.district] }}>{districtName(r.district)}</span>
            {r.relet && <span class="tt-dz relet">{lotStateName('po-traszce')}</span>}</span>
          <span class="tt-lotrange"><b>{`${r.lo}–${r.hi}`}</b></span>
          <span class="tt-lotsub">{`${lotKindName(r.kind, r.corner, r.district)}, ${r.area} m²`}</span>
          <span class="tt-lotprice-sm">{zl(r.price)}</span>
        </button>
      ))}
    </section>
  );
}

/** Zawartość arkusza Miasto. Bez firmy (sklep jeszcze się nie otworzył) nic nie pokazuje. */
export function CityPanel({ game }: { game: GameActions }) {
  const view = firm.value;
  if (!view) return null;
  const { f, v } = view;
  const chosen = validLot(f, selectedLot.value);   // `has-card` tylko dla karty, która naprawdę się pokaże (lista i pasek ustępują jej)
  return (
    <div class={`tt-city${chosen !== null ? ' has-card' : ''}`}>
      <CityBar f={f} v={v} />
      <LotList f={f} v={v} />
      {f.person.partner && !f.ranked && <ResearchSection f={f} game={game} v={v} />}
      {chosen !== null && <LotCard f={f} lotId={chosen} game={game} v={v} />}
    </div>
  );
}
