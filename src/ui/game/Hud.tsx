import { useEffect, useRef, useState } from 'preact/hooks';
import type { Speed } from '@/game/loop';
import { dayOf, formatClock } from '@/sim/economy/calendar';
import { DEBT_WARN, debtWarningText, isClosedForRemont } from '@/sim/economy/economy';
import { forecastMonth, spendCheck, type MonthForecast } from '@/sim/economy/forecast';
import { xpToNext } from '@/sim/economy/progress';
import { trustTier } from '@/sim/economy/tycoon/trust';
import { dateText, rankText, t, tr } from '@/i18n';
import { econ, openHowTo, openMonthPreview, openRanking, showSettings, speed, tab, type Controls } from '../state';
import { forecastLabel, forecastTitle } from './forecastText';
import { int, plural, signedZl, zl } from './format';

/** Przyciski prędkości w pasku (pierwszy to pauza); „Jak grać” podaje z nich zakres tempa. */
export const SPEEDS: { value: Speed; label: string; title: string }[] = [
  { value: 0, label: '❚❚', title: 'Pauza (spacja)' },
  { value: 1, label: '×1', title: 'Czas normalnie' },
  { value: 2, label: '×2', title: 'Czas ×2' },
  { value: 4, label: '×4', title: 'Czas ×4' },
  { value: 8, label: '×8', title: 'Czas ×8' },
];

/** Liczba, która „dobiega” do wartości zamiast skakać, i informacja, czy właśnie rośnie (do pulsowania). */
function useTweened(value: number): [number, boolean] {
  const [shown, setShown] = useState(value);
  const [rising, setRising] = useState(false);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (Math.abs(value - start) < 0.5) { setShown(value); from.current = value; return; }
    setRising(value > start);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number): void => {
      const k = Math.min(1, (t - t0) / 350);
      const v = start + (value - start) * (1 - (1 - k) ** 3);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else setRising(false);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return [shown, rising];
}

/** Poniżej tej wartości zaufanie Centrali świeci ostrzeżeniem (próg „Na cenzurowanym” zaczyna się od 20, „Pod obserwacją” od 40). */
export const TRUST_WARN_BELOW = 30;

/**
 * Znaczek zaufania Centrali: na telefonie sama wartość („🤝 62”), nazwę progu CSS dokłada dopiero na szerszym ekranie.
 * Pełny opis jest w podpowiedzi i w `aria-label`.
 */
export function TrustChip({ value }: { value: number }) {
  const tier = trustTier(value);
  const shown = Math.round(value);
  return (
    <span class={`tt-stat tt-trust${value < TRUST_WARN_BELOW ? ' warn' : ''}`} data-tut="trust" role="img" aria-label={t`Zaufanie ${shown}: ${tr(tier.label)}`}
      title={t`Zaufanie Centrali ${shown} / 100: ${tr(tier.label)}. ${tr(tier.flavor)}`}>
      <span>🤝 {shown}</span>
      <span class="tt-trust-tier">{tr(tier.label)}</span>
    </span>
  );
}

/**
 * Plakietka „🎁 N” w pasku: tyle celów (kamieni milowych) czeka na „Odbierz”. Pulsuje jak inne gorące znaczki, a kliknięcie otwiera
 * zakładkę Cele (tam jest przycisk odbioru). Bez celów do odebrania jej nie ma.
 */
export function ClaimChip({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = t`${count} ${plural(count, 'cel czeka', 'cele czekają', 'celów czeka')} na odbiór nagrody`;
  return (
    <button type="button" class="tt-stat tt-claim hot" data-tut="claim" title={t`${label}: zakładka Cele`} aria-label={label} onClick={() => { tab.value = 'cele'; }}>
      🎁 {count}
    </button>
  );
}

/**
 * „🏆” obok ⚙: otwiera panel rankingu (w biegu rankingowym od zakładki „Ten seed”, w zwykłej grze od globalnego). Gra stoi, dopóki panel
 * jest otwarty.
 */
export function RankingButton() {
  return <button type="button" class="tt-iconbtn tt-trophy" aria-label={t`Ranking`} title={t`Ranking`} onClick={openRanking}>🏆</button>;
}

/**
 * Trzy kieszenie pod gotówką (drugi wiersz paska): saldo u Centrali (marża i premie naliczone w miesiącu, rośnie z każdym klientem),
 * raty do potrącenia w najbliższym przelewie i prognoza „Po zamknięciu zostanie” (szybki szacunek „Zostaje Ci”). Stuknięcie otwiera
 * okno z prognozowanym wyciągiem i podglądem końca miesiąca (`MonthPreviewModal`). Na wąskim ekranie etykiety są krótkie („Saldo”,
 * „Raty”, „Zostanie”), na szerokim pełne (`tt-due-pre` pojawia się od 640 px). Kolor prognozy mówi o debecie gotówki po zamknięciu:
 * poniżej zera ostrzegawczy, poniżej progu ostrzeżenia (`DEBT_WARN`) czerwony, poniżej granicy gry (`DEBT_LIMIT`) czerwony z wykrzyknikiem.
 * Zwykła funkcja bez haków (testy wołają ją bez renderu); klasy `tt-due*` zostały z dawnego rachunku „Do oddania Centrali”.
 */
export function ForecastChip({ f, cash }: { f: MonthForecast; cash: number }) {
  const check = spendCheck(f, 0);
  const level = check.level;
  const tone = level === 'danger' || level === 'warn' ? level : f.cashAfter < 0 ? 'neg' : '';
  return (
    <button type="button" class={`tt-due${tone ? ` ${tone}` : ''}`} title={forecastTitle(f, cash, check)} aria-label={forecastLabel(f)} onClick={openMonthPreview}>
      <span class="tt-due-part" data-tut="saldo"><span class="tt-due-label">{t`Saldo`}<span class="tt-due-pre">{t` u Centrali`}</span></span> <b>{zl(f.saldo)}</b></span>
      <span class="tt-due-part"><span class="tt-due-label">{t`Raty`}</span> <b>{zl(f.installments)}</b></span>
      <span class="tt-due-part">
        <span class="tt-due-label"><span class="tt-due-pre">{t`Po zamknięciu `}</span><span class="tt-due-word">{t`zostanie`}</span></span>
        {' '}<b class="tt-due-free">{level === 'danger' ? '⚠ ' : ''}{signedZl(f.net)}</b>
      </span>
    </button>
  );
}

/**
 * Górny pasek: poziom z pierścieniem XP, gotówka, reputacja, Ogonki, zaufanie Centrali, trzy kieszenie (saldo, raty, prognoza), data
 * i godzina, prędkość czasu, ranking i ustawienia. `ranking`: czy gra ma panele rankingu (bez nich przycisku „🏆” nie ma, bo nie miałby czego otworzyć).
 */
export function Hud({ controls, ranking = false }: { controls: Controls; ranking?: boolean }) {
  const view = econ.value;
  const [cash, rising] = useTweened(view?.s.cash ?? 0);
  if (!view) return null;
  const { s } = view;
  const closed = isClosedForRemont(s);
  const xpFrac = Math.min(1, s.xp / xpToNext(s.level));
  return (
    <header class="tt-hud2">
      <div class="tt-hud-row">
        <button type="button" class="tt-level" style={{ '--xp': `${Math.round(xpFrac * 360)}deg` }}
          title={`${rankText(s.level)} · ${int(s.xp)} / ${int(xpToNext(s.level))} XP`} aria-label={t`Poziom ${s.level}`}
          onClick={() => { tab.value = 'cele'; }}>
          <span>{s.level}</span>
        </button>
        <span data-tut="cash" class={`tt-cash${s.cash < 0 ? ' neg' : ''}${s.cash < DEBT_WARN ? ' debt' : ''}${rising ? ' up' : ''}`}
          title={s.cash < DEBT_WARN ? tr(debtWarningText(s.cash)) : t`Gotówka`}>{zl(cash)}</span>
        <span class="tt-stat" title={t`Reputacja sklepu (0–100): ściąga klientów`}>⭐ {int(s.reputation)}</span>
        <span class="tt-stat" title={t`Ogonki: nagrody za cele, wydajesz w Ulepszeniach`}>🦎 {int(s.ogonki)}</span>
        <TrustChip value={s.tycoon.trust.value} />
        <span class="tt-hud-tools">
          {ranking && <RankingButton />}
          <button type="button" class="tt-iconbtn tt-help" data-tut="help" aria-label={t`Jak grać`} onClick={() => openHowTo()}>?</button>
          <button type="button" class="tt-iconbtn tt-gear" aria-label={t`Ustawienia`} onClick={() => { showSettings.value = true; }}>⚙</button>
        </span>
      </div>
      <div class="tt-hud-row tt-hud-due" data-tut="due">
        <ForecastChip f={forecastMonth(s, view.info)} cash={s.cash} />
      </div>
      <div class="tt-hud-row">
        <span class="tt-clock">
          {dateText(dayOf(s.minute))} · <b>{formatClock(s.minute)}</b>{closed ? t` · remont` : ''}
        </span>
        <ClaimChip count={s.milestonesReady.length} />
        <div class="tt-seg" data-tut="speed" role="group" aria-label={t`Prędkość czasu`}>
          {SPEEDS.map((o) => (
            <button key={o.value} type="button" class={`tt-btn${o.value === speed.value ? ' on' : ''}`} aria-pressed={o.value === speed.value}
              title={tr(o.title)} onClick={() => controls.setSpeed(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>
    </header>
  );
}
