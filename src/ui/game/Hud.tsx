import { useEffect, useRef, useState } from 'preact/hooks';
import type { Speed } from '@/game/loop';
import { dayOf, formatClock, formatDate } from '@/sim/economy/calendar';
import { DEBT_WARN, debtWarningText, isClosedForRemont } from '@/sim/economy/economy';
import { rankFor, xpToNext } from '@/sim/economy/progress';
import { trustTier } from '@/sim/economy/tycoon/trust';
import { econ, openHowTo, showSettings, speed, tab, type Controls } from '../state';
import { int, zl } from './format';

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
    <span class={`tt-stat tt-trust${value < TRUST_WARN_BELOW ? ' warn' : ''}`} role="img" aria-label={`Zaufanie ${shown}: ${tier.label}`}
      title={`Zaufanie Centrali ${shown} / 100: ${tier.label}. ${tier.flavor}`}>
      <span>🤝 {shown}</span>
      <span class="tt-trust-tier">{tier.label}</span>
    </span>
  );
}

/** Górny pasek: poziom z pierścieniem XP, gotówka, reputacja, Ogonki, zaufanie Centrali, data i godzina, prędkość czasu, ustawienia. */
export function Hud({ controls }: { controls: Controls }) {
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
          title={`${rankFor(s.level)} · ${int(s.xp)} / ${int(xpToNext(s.level))} XP`} aria-label={`Poziom ${s.level}`}
          onClick={() => { tab.value = 'cele'; }}>
          <span>{s.level}</span>
        </button>
        <span class={`tt-cash${s.cash < 0 ? ' neg' : ''}${s.cash < DEBT_WARN ? ' debt' : ''}${rising ? ' up' : ''}`}
          title={s.cash < DEBT_WARN ? debtWarningText(s.cash) : 'Gotówka'}>{zl(cash)}</span>
        <span class="tt-stat" title="Reputacja sklepu (0–100): ściąga klientów">⭐ {int(s.reputation)}</span>
        <span class="tt-stat" title="Ogonki: nagrody za cele, wydajesz w Ulepszeniach">🦎 {int(s.ogonki)}</span>
        <TrustChip value={s.tycoon.trust.value} />
        <button type="button" class="tt-iconbtn tt-help" aria-label="Jak grać" onClick={() => openHowTo()}>?</button>
        <button type="button" class="tt-iconbtn tt-gear" aria-label="Ustawienia" onClick={() => { showSettings.value = true; }}>⚙</button>
      </div>
      <div class="tt-hud-row">
        <span class="tt-clock">
          {formatDate(dayOf(s.minute))} · <b>{formatClock(s.minute)}</b>{closed ? ' · remont' : ''}
        </span>
        <div class="tt-seg" role="group" aria-label="Prędkość czasu">
          {SPEEDS.map((o) => (
            <button key={o.value} type="button" class={`tt-btn${o.value === speed.value ? ' on' : ''}`} aria-pressed={o.value === speed.value}
              title={o.title} onClick={() => controls.setSpeed(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>
    </header>
  );
}
