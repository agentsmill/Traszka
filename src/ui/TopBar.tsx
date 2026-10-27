import { useEffect, useState } from 'preact/hooks';
import type { Speed } from '@/game/loop';
import type { QualityPresetId } from '@/render/quality';
import type { TimeOfDay } from '@/render/lighting';
import { preset, seed, speed, timeOfDay, type Controls } from './state';

interface Option<T> { value: T; label: string; title?: string; icon?: boolean }

const SPEEDS: Option<Speed>[] = [
  { value: 0, label: '❚❚', title: 'Pauza', icon: true },
  { value: 1, label: '×1', title: 'Czas płynie normalnie' },
  { value: 2, label: '×2', title: 'Czas przyspieszony ×2' },
  { value: 4, label: '×4', title: 'Czas przyspieszony ×4' },
  { value: 8, label: '×8', title: 'Czas przyspieszony ×8' },
];
const TIMES: Option<TimeOfDay>[] = [
  { value: 'day', label: 'Dzień', title: 'Dzień (klawisz N)' },
  { value: 'night', label: 'Noc', title: 'Noc (klawisz N)' },
];
const PRESETS: Option<QualityPresetId>[] = [
  { value: 'niska', label: 'Niska', title: 'Bez AO, cienie 1024 (klawisz 1)' },
  { value: 'srednia', label: 'Średnia', title: 'AO w pół rozdzielczości, cienie 2048 (klawisz 2)' },
  { value: 'wysoka', label: 'Wysoka', title: 'Pełne AO, cienie 4096 (klawisz 3)' },
];

/** Grupa przycisków, z których jeden jest wciśnięty (aria-pressed) i pomarańczowy. */
function Segmented<T extends string | number>({ label, options, value, onPick }: {
  label: string; options: Option<T>[]; value: T; onPick: (next: T) => void;
}) {
  return (
    <div class="tt-seg" role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={String(o.value)} type="button" class={`tt-btn${o.icon ? ' tt-icon' : ''}${active ? ' on' : ''}`}
            aria-pressed={active} title={o.title ?? o.label} onClick={() => onPick(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pasek sterowania nad sceną: znaczek, seed, prędkość, obrót, dzień/noc i jakość (układ ze szkicu `.tt-hud`). */
export function TopBar({ controls }: { controls: Controls }) {
  const [draft, setDraft] = useState(seed.value);
  // R albo „Losuj” zmieniają seed poza polem, więc pole go dogania.
  useEffect(() => { setDraft(seed.value); }, [seed.value]);

  return (
    <div class="tt-hud">
      <span class="tt-chip tt-brand">TRASZKA</span>
      <form class="tt-seed" onSubmit={(e) => { e.preventDefault(); controls.generate(draft); }}>
        <input class="tt-input" type="text" value={draft} placeholder="seed sklepu" aria-label="Seed sklepu"
          maxLength={64} spellcheck={false} autocomplete="off"
          onInput={(e) => setDraft(e.currentTarget.value)} />
        <button type="submit" class="tt-btn tt-primary" title="Odtwórz świat dla wpisanego seeda">Generuj</button>
        <button type="button" class="tt-btn" title="Losowy seed (klawisz R)" onClick={() => controls.randomize()}>Losuj</button>
      </form>
      <Segmented label="Prędkość czasu" options={SPEEDS} value={speed.value} onPick={controls.setSpeed} />
      <div class="tt-seg" role="group" aria-label="Obrót kamery">
        <button type="button" class="tt-btn tt-icon" title="Obróć w lewo (Q)" aria-label="Obróć w lewo" onClick={() => controls.rotate(-1)}>⟲</button>
        <button type="button" class="tt-btn tt-icon" title="Obróć w prawo (E)" aria-label="Obróć w prawo" onClick={() => controls.rotate(1)}>⟳</button>
      </div>
      <Segmented label="Pora dnia" options={TIMES} value={timeOfDay.value} onPick={controls.setTimeOfDay} />
      <Segmented label="Jakość grafiki" options={PRESETS} value={preset.value} onPick={controls.setPreset} />
    </div>
  );
}
