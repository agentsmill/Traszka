import type { Speed } from '@/game/loop';
import { dayOf, formatClock, formatDate } from '@/sim/economy/calendar';
import { isClosedForRemont } from '@/sim/economy/economy';
import { econ, showSettings, speed, type Controls } from '../state';
import { int, zl } from './format';

const SPEEDS: { value: Speed; label: string; title: string }[] = [
  { value: 0, label: '❚❚', title: 'Pauza (spacja)' },
  { value: 1, label: '×1', title: 'Czas normalnie' },
  { value: 2, label: '×2', title: 'Czas ×2' },
  { value: 4, label: '×4', title: 'Czas ×4' },
  { value: 8, label: '×8', title: 'Czas ×8' },
];

/** Górny pasek: gotówka, reputacja, Ogonki, data i godzina, prędkość czasu, ustawienia. */
export function Hud({ controls }: { controls: Controls }) {
  const view = econ.value;
  if (!view) return null;
  const { s } = view;
  const closed = isClosedForRemont(s);
  return (
    <header class="tt-hud2">
      <div class="tt-hud-row">
        <span class="tt-brand2" aria-hidden="true">T</span>
        <span class={`tt-cash${s.cash < 0 ? ' neg' : ''}`} title="Gotówka">{zl(s.cash)}</span>
        <span class="tt-stat" title="Reputacja sklepu (0–100): ściąga klientów">⭐ {int(s.reputation)}</span>
        <span class="tt-stat" title="Ogonki: nagrody za cele, wydajesz w Ulepszeniach">🦎 {int(s.ogonki)}</span>
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
