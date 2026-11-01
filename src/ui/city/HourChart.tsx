import { t } from '@/i18n';
import type { HourBars } from './cityModel';

/*
 * Profil godzinowy na karcie lokalu (spec §8.1, 4a.2): 17 słupków (godziny 6–22) z kształtem dnia dzielnicy przy środku widełek klientów.
 * Dzień roboczy to pełne słupki, weekend (tylko tam, gdzie dzielnica ma osobny ruch weekendowy, czyli w Biurowcach) to obrys obok. Oś ma
 * podpisy 6, 12, 18 i 22 i żadnych liczb klientów, bo widełki stoją już w wierszu nad wykresem. Rysunek jest płynny: SVG z `viewBox` skaluje
 * się do szerokości karty (CSS `width: 100%`), więc na 390 px nie wylewa się poza kartę. Bez haków, jak reszta ekranu Miasta.
 */

/** Układ współrzędnych rysunku (skaluje się do karty): szerokość, wysokość pola słupków, położenie podpisów i wysokość całości. */
const W = 340;
const PLOT_H = 52;
const LABEL_Y = 66;
const H = 72;
const FIRST_HOUR = 6;
const TICKS = [6, 12, 18, 22] as const;

const round = (n: number): number => Math.round(n * 100) / 100;

export function HourChart({ hours }: { hours: HourBars }) {
  const { weekday, weekend } = hours;
  const slot = W / weekday.length;
  const highest = Math.max(...weekday);
  const top = Math.max(highest, ...(weekend ?? []));
  const barH = (v: number): number => (top > 0 ? round(Math.max(1, v / top * PLOT_H)) : 0);
  // z obrysem weekendu słupek dnia jest węższy i ma obok drugi; bez niego słupek jest szeroki i stoi pośrodku godziny
  const width = round(slot * (weekend ? 0.38 : 0.7));
  const dayX = (i: number): number => round(slot * i + slot * (weekend ? 0.1 : 0.15));
  const endX = (i: number): number => round(dayX(i) + width + slot * 0.04);
  const peak = FIRST_HOUR + weekday.indexOf(highest);
  const flat = highest - Math.min(...weekday) < 1e-9 * highest;   // płaski profil (Dworzec) nie ma szczytu, więc czytnik nie dostaje fałszywej godziny
  return (
    <div class="tt-hours">
      <div class="tt-hours-head">
        <b>{t`Ruch w ciągu dnia`}</b>
        <span class="tt-hours-legend">
          <span><i class="tt-hours-key day" role="presentation" />{t`dzień roboczy`}</span>
          {weekend && <span><i class="tt-hours-key end" role="presentation" />{t`weekend`}</span>}
        </span>
      </div>
      <svg class="tt-hours-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={flat ? t`Ruch równy przez cały dzień` : t`Szczyt około ${peak}:00`}>
        <line class="tt-hbase" x1="0" y1={PLOT_H} x2={W} y2={PLOT_H} />
        {weekday.map((v, i) => (
          <rect key={`d${i}`} class="tt-hbar day" x={dayX(i)} y={round(PLOT_H - barH(v))} width={width} height={barH(v)} rx="1.5" />
        ))}
        {weekend && weekend.map((v, i) => (
          <rect key={`e${i}`} class="tt-hbar end" x={endX(i)} y={round(PLOT_H - barH(v))} width={width} height={barH(v)} rx="1.5" />
        ))}
        {TICKS.map((h) => <text key={h} x={round(slot * (h - FIRST_HOUR) + slot / 2)} y={LABEL_Y}>{h}</text>)}
      </svg>
    </div>
  );
}
