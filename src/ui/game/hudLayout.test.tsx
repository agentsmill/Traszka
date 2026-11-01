import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '@/sim/economy/commands';
import { createEconomy, type CommandResult } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { econ, type Controls, type GameActions } from '../state';
import { Hud } from './Hud';
import { textOf, walk, type Vnode } from './vnodeTree';

/*
 * Pasek HUD nie ma testu układu w node (bez przeglądarki), więc to, co smoke na 390, 820, 1024 i 1280 px wyłapał (przelewanie się paska
 * przy siedmiocyfrowej gotówce i po angielsku), przypinamy dwoma rodzajami testów: strukturą drzewa, od której zależy CSS
 * (`--len` gotówki, osobne `tt-clock-date`/`tt-clock-time`/`tt-clock-remont`), i kilkoma regułami arkusza, które łatwo zepsuć.
 */

// `Hud` ma haki: poza renderem Preacta atrapa daje stan początkowy (jak w HowTo.test.tsx).
vi.mock('preact/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('preact/hooks')>()),
  useState: <T,>(initial: T) => [initial, () => {}],
  useRef: <T,>(initial: T) => ({ current: initial }),
  useEffect: () => {},
}));

const game: GameActions = {
  dispatch: (_cmd: Command): CommandResult => ({ ok: true }),
  claimWelcome: () => {}, setSound: () => {}, setVibration: () => {}, restart: () => {}, newStore: () => {},
  startRanked: () => false, resumeRanked: () => false, leaveRanked: () => {}, abandonRanked: () => {},
  openFinish: () => {}, rememberNick: () => {},
  firm: () => ({ ok: false, reason: 'store' }),
};
const controls: Controls = {
  setSpeed: () => {}, rotate: () => {}, setTimeOfDay: () => {}, setPreset: () => {}, generate: () => {}, randomize: () => {},
};

afterEach(() => { econ.value = null; });

function hud(patch: { cash?: number; remont?: boolean } = {}) {
  const info = computeStoreInfo(layoutFor('pasek', 0));
  const s = createEconomy('pasek', info);
  if (patch.cash !== undefined) s.cash = patch.cash;
  if (patch.remont) s.remontUntil = s.minute + 600;
  econ.value = { s, info, v: 1 };
  return Hud({ controls, game });
}

const byClass = (tree: ReturnType<typeof Hud>, cls: string): Vnode | undefined => walk(tree).find((v) => String(v.props.class ?? '').split(' ').includes(cls));

describe('Hud: gotówka dopasowuje się do miejsca', () => {
  it('podaje CSS długość zapisu kwoty (`--len`), z której na telefonie liczy się rozmiar czcionki', () => {
    for (const cash of [5000, 123_456, 1_234_567, 12_345_678]) {
      const span = walk(hud({ cash })).find((v) => v.props['data-tut'] === 'cash')!;
      const style = span.props.style as Record<string, number>;
      expect(style['--len']).toBe(textOf(span).length);
    }
  });

  it('siedmiocyfrowa kwota jest dłuższa niż sześciocyfrowa, więc dostaje mniejszą czcionkę (zapis „1 234 567 zł”)', () => {
    const len = (cash: number): number => (walk(hud({ cash })).find((v) => v.props['data-tut'] === 'cash')!.props.style as Record<string, number>)['--len']!;
    expect(len(1_234_567)).toBeGreaterThan(len(123_456));
    expect(len(12_345_678)).toBeGreaterThan(len(1_234_567));
  });
});

describe('Hud: zegar skraca datę, nie godzinę', () => {
  it('data, godzina i dopasowany „remont” są osobnymi elementami, a godzina ma pogrubienie', () => {
    const clock = byClass(hud(), 'tt-clock')!;
    const date = byClass(clock, 'tt-clock-date');
    const time = byClass(clock, 'tt-clock-time');
    expect(date).toBeDefined();
    expect(time).toBeDefined();
    expect(walk(time).some((v) => v.type === 'b')).toBe(true);
    expect(textOf(time)).toMatch(/\d{2}:\d{2}/);
    expect(byClass(clock, 'tt-clock-remont')).toBeUndefined();
  });

  it('przy remoncie dopisek „remont” jest osobnym, skracalnym elementem po godzinie', () => {
    const clock = byClass(hud({ remont: true }), 'tt-clock')!;
    const parts = walk(clock).map((v) => String(v.props.class ?? '')).filter((c) => c.startsWith('tt-clock-'));
    expect(parts).toEqual(['tt-clock-date', 'tt-clock-time', 'tt-clock-remont']);
    expect(textOf(byClass(clock, 'tt-clock-remont'))).toContain('remont');
  });
});

describe('ui.css: układ paska', () => {
  const css = readFileSync(new URL('../ui.css', import.meta.url), 'utf8');

  /** Treść bloku `@media (…)` o dokładnie takim warunku (do domykającego nawiasu na początku wiersza). */
  function media(condition: string): string {
    const at = css.indexOf(`@media (${condition}) {`);
    if (at < 0) throw new Error(`brak bloku @media (${condition})`);
    return css.slice(at, css.indexOf('\n}', at));
  }

  it('blok telefonu stoi za regułą bazową `.tt-hud-tools`: przy równej swoistości o wyniku decyduje kolejność (wcześniej gap 4 px nie działał)', () => {
    const base = css.indexOf('\n.tt-hud-tools {');
    const phone = css.indexOf('@media (max-width: 639px) {\n  .tt-hud-row { gap: 4px; }');
    expect(base).toBeGreaterThan(0);
    expect(phone).toBeGreaterThan(base);
    expect(media('max-width: 639px')).toMatch(/\.tt-hud-tools \{ gap: 4px; \}/);
  });

  it('rozmiar gotówki na telefonie wynika z `--len` (a nie ze stałych 17 px), z górną granicą 17 px do 440 px i 19 px wyżej', () => {
    expect(media('max-width: 639px')).toMatch(/font-size: clamp\([^;]*var\(--len[^;]*var\(--cash-max\)\)/);
    expect(media('max-width: 639px')).toMatch(/--cash-max: 19px/);
    expect(media('max-width: 440px')).toMatch(/--cash-max: 17px/);
    expect(media('max-width: 440px')).not.toMatch(/font-size/);
  });

  it('od 820 px pasek to dwie linie siatki bez jednej linii flex, a siatkę sieci (`tt-net`, city.css) zostawia w spokoju', () => {
    const wide = media('min-width: 820px');
    expect(wide).not.toMatch(/flex-direction:\s*row/);
    expect(wide).toMatch(/\.tt-ui:not\(\.tt-net\) \{ --hud-h: 82px; \}/);
    for (const line of wide.split('\n').filter((l) => l.includes('grid') || l.includes('hud-row') || l.includes('hud-due'))) {
      expect(line).toContain(':not(.tt-net)');
    }
  });

  it('od 820 do 999 px nazwa progu zaufania ustępuje, bo górna linia dzieli miejsce z zegarem i prędkością', () => {
    expect(media('min-width: 820px) and (max-width: 999px')).toMatch(/\.tt-trust-tier \{ display: none; \}/);
  });
});
