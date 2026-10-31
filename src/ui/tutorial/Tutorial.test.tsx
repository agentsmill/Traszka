import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '@/sim/economy/commands';
import { createEconomy, type CommandResult } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { MemoryStorage } from '@/game/memoryStorage';
import { App } from '../App';
import { Settings, TipsToggle, TutorialButton } from '../game/overlays';
import { buttonLabelled, click, labels, textOf, walk } from '../game/vnodeTree';
import { HowTo } from '../howto/HowTo';
import { econ, howTo, isWindowOpen, ranked, showSettings, speed, toasts, tutorialOffer, type Controls, type GameActions } from '../state';
import { loadTutorial } from './memory';
import { Bubble, TipBubble, TutorialHost, TutorialOffer } from './Tutorial';
import { RANKED_TOUR_TEXT, skipTour, tour, tourActive } from './tour';

// Ustawienia mają haki (`useState`, `useEffect`); poza renderem Preacta atrapa daje stan początkowy, żeby obejrzeć drzewo okna.
vi.mock('preact/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('preact/hooks')>()),
  useState: <T,>(initial: T) => [initial, () => {}],
  useRef: <T,>(initial: T) => ({ current: initial }),
  useEffect: () => {},
}));

const game: GameActions = {
  dispatch: (_cmd: Command): CommandResult => ({ ok: true }),
  claimWelcome: () => {}, openNextStore: () => {}, setSound: () => {}, setVibration: () => {}, restart: () => {}, newStore: () => {},
  startRanked: () => false, resumeRanked: () => false, leaveRanked: () => {}, abandonRanked: () => {},
  openFinish: () => {}, rememberNick: () => {},
};
const controls: Controls = {
  setSpeed: (v) => { speed.value = v; }, rotate: () => {}, setTimeOfDay: () => {}, setPreset: () => {}, generate: () => {}, randomize: () => {},
};
const withGame = (): void => {
  const info = computeStoreInfo(layoutFor('widok-1', 0));
  econ.value = { s: createEconomy('widok-1', info), info, v: 1 };
};

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  tutorialOffer.value = false;
  howTo.value = false;
  showSettings.value = false;
  ranked.value = null;
  toasts.value = [];
  speed.value = 1;
});
afterEach(() => {
  skipTour();
  tour.value = null;
  econ.value = null;
  vi.unstubAllGlobals();
});

describe('okno wyboru „Pierwszy dzień w Traszce”', () => {
  it('zamknięte nic nie rysuje', () => {
    expect(TutorialOffer()).toBeNull();
  });

  it('otwarte: okno dialogowe z tekstem Centrali, dwoma przyciskami i odesłaniem do „?”', () => {
    tutorialOffer.value = true;
    const tree = TutorialOffer()!;
    const dialog = walk(tree).find((v) => v.props.role === 'dialog')!;
    expect(dialog.props['aria-label']).toBe('Pierwszy dzień w Traszce');
    expect(dialog.props['aria-modal']).toBe('true');
    expect(labels(tree)).toEqual(['Samouczek (ok. 3 min)', 'Pomiń, znam grę']);
    expect(textOf(tree)).toContain('Czas w sklepie stoi, dopóki nie skończysz.');
    expect(textOf(tree)).toContain('pod „?”');
    expect(isWindowOpen()).toBe(true);
  });

  it('„Samouczek (ok. 3 min)” uruchamia przelot i zapisuje odpowiedź', () => {
    withGame();
    tutorialOffer.value = true;
    click(buttonLabelled(TutorialOffer()!, 'Samouczek (ok. 3 min)'));
    expect(tutorialOffer.value).toBe(false);
    expect(tourActive()).toBe(true);
    expect(speed.value).toBe(0);
    expect(loadTutorial().tour).toBe('started');
  });

  it('„Pomiń, znam grę” zamyka okno bez przelotu', () => {
    withGame();
    tutorialOffer.value = true;
    click(buttonLabelled(TutorialOffer()!, 'Pomiń, znam grę'));
    expect(tutorialOffer.value).toBe(false);
    expect(tourActive()).toBe(false);
    expect(loadTutorial().tour).toBe('skipped');
    expect(speed.value).toBe(1);
  });
});

describe('dymek przelotu', () => {
  const props = { title: 'Gotówka', text: 'Twoje pieniądze.', n: 3, total: 16, place: null, onNext: vi.fn(), onSkip: vi.fn() };

  it('tytuł, licznik „3 / 16”, tekst, „Pomiń” i „Dalej”; etykieta z numerem kroku', () => {
    const tree = Bubble({ ...props, primary: 'Dalej', skip: true });
    expect(textOf(tree)).toContain('Gotówka');
    expect(textOf(tree)).toContain('3 / 16');
    expect(textOf(tree)).toContain('Twoje pieniądze.');
    expect(labels(tree)).toEqual(['Pomiń', 'Dalej']);
    const root = walk(tree)[0]!;
    expect(root.props.role).toBe('dialog');
    expect(root.props['aria-label']).toBe('Samouczek, krok 3 z 16');
  });

  it('zadanie: wiersz „👉 …” i bez „Dalej” (klika gracz); po zaliczeniu „✓ Zrobione”', () => {
    const waiting = Bubble({ ...props, primary: null, skip: true, hint: 'Otwórz Palety.' });
    expect(textOf(waiting)).toContain('👉 Otwórz Palety.');
    expect(labels(waiting)).toEqual(['Pomiń']);
    const done = Bubble({ ...props, primary: null, skip: true, hint: 'Otwórz Palety.', done: true });
    expect(textOf(done)).toContain('✓ Zrobione');
  });

  it('ostatni krok: sam „Zakończ”', () => {
    const tree = Bubble({ ...props, n: 16, primary: 'Zakończ', skip: false });
    expect(labels(tree)).toEqual(['Zakończ']);
    click(buttonLabelled(tree, 'Zakończ'));
    expect(props.onNext).toHaveBeenCalled();
  });

  it('strona dymka w klasie (strzałka), pozycja w stylu; przed pomiarem przezroczysty', () => {
    const placed = walk(Bubble({ ...props, primary: 'Dalej', skip: true, place: { x: 10, y: 20, side: 'below', arrow: 40, covers: false } }))[0]!;
    expect(String(placed.props.class)).toContain('side-below');
    expect(placed.props.style).toMatchObject({ left: '10px', top: '20px', '--arrow': '40px' });
    const hidden = walk(Bubble({ ...props, primary: 'Dalej', skip: true }))[0]!;
    expect(hidden.props.style).toMatchObject({ opacity: '0' });
  });
});

describe('dymek „pierwszy raz”', () => {
  it('tekst i „OK” w roli status (nie zatrzymuje gry)', () => {
    const onOk = vi.fn();
    const tree = TipBubble({ text: 'Cel spełniony.', place: null, onOk });
    expect(walk(tree)[0]!.props.role).toBe('status');
    expect(labels(tree)).toEqual(['OK']);
    click(buttonLabelled(tree, 'OK'));
    expect(onOk).toHaveBeenCalled();
  });
});

describe('ponowne uruchomienie', () => {
  it('„Jak grać” → „Samouczek”: okno się zamyka, przelot rusza', () => {
    withGame();
    howTo.value = true;
    click(buttonLabelled(HowTo()!, 'Samouczek'));
    expect(howTo.value).toBe(false);
    expect(tourActive()).toBe(true);
  });

  it('⚙ → „Samouczek”: ustawienia się zamykają, przelot rusza', () => {
    withGame();
    showSettings.value = true;
    click(buttonLabelled(TutorialButton(), 'Samouczek'));
    expect(showSettings.value).toBe(false);
    expect(tourActive()).toBe(true);
  });

  it('w biegu rankingowym: okno się zamyka, a zostaje tylko toast „Samouczek działa w zwykłym sklepie.”', () => {
    withGame();
    ranked.value = { seed: 'x', day: 2, days: 91, phase: 'playing' };
    howTo.value = true;
    click(buttonLabelled(HowTo()!, 'Samouczek'));
    expect(howTo.value).toBe(false);
    expect(tourActive()).toBe(false);
    expect(toasts.value.map((t) => t.text)).toEqual([RANKED_TOUR_TEXT]);
  });

  it('⚙ ma w sekcji Pomoc „Jak grać”, „Samouczek” i pole „Podpowiedzi przy pierwszych zdarzeniach”', () => {
    showSettings.value = true;
    const tree = Settings({ controls, game })!;
    const types = walk(tree).map((v) => v.type);
    expect(types).toContain(TutorialButton);
    expect(types).toContain(TipsToggle);
  });

  it('pole podpowiedzi czyta i zapisuje pamięć samouczka', () => {
    const box = walk(TipsToggle()).find((v) => v.type === 'input')!;
    expect(box.props.checked).toBe(true);
    (box.props.onChange as (e: unknown) => void)({ currentTarget: { checked: false } });
    expect(loadTutorial().tips).toBe(false);
    expect(walk(TipsToggle()).find((v) => v.type === 'input')!.props.checked).toBe(false);
    expect(textOf(TipsToggle())).toContain('Podpowiedzi przy pierwszych zdarzeniach');
  });
});

describe('montaż', () => {
  it('<TutorialHost /> jest w drzewie App, jako ostatnia warstwa gry', () => {
    const types: unknown[] = walk(App({ controls, game })).map((v) => v.type);
    expect(types).toContain(TutorialHost);
  });
});

describe('samouczek nie wysyła poleceń gry', () => {
  const dir = join(process.cwd(), 'src/ui/tutorial');
  const sources = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

  it('żaden plik samouczka nie zawiera `dispatch`', () => {
    expect(sources.length).toBeGreaterThanOrEqual(7);
    for (const f of sources) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/dispatch/);
  });

  it('DOM dotyka tylko widok (Tutorial.tsx); logika działa w node', () => {
    for (const f of sources.filter((x) => x !== 'Tutorial.tsx')) expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/\bdocument\.|\bwindow\./);
  });
});
