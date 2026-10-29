import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '@/sim/economy/commands';
import { createEconomy, type CommandResult } from '@/sim/economy/economy';
import { computeStoreInfo } from '@/sim/economy/storeInfo';
import { PROFILE_LABEL, STAFF_PROFILES } from '@/sim/economy/tycoon/staff';
import { layoutFor } from '@/sim/store/layoutFor';
import { isModalOpen } from '@/game/frame';
import { GoalsPanel, PalletItem, PalletsPanel, PeoplePanel, TabBar } from '../game/panels';
import { App } from '../App';
import { Hud } from '../game/Hud';
import { HowToButton, Settings } from '../game/overlays';
import { buttonAria, buttonLabelled, click, labels, sectionTitled, textOf, walk } from '../game/vnodeTree';
import { econ, howTo, showSettings, type Controls, type GameActions } from '../state';
import { HowTo } from './HowTo';
import { howToDetails, howToPoints } from './howToText';

// Ustawienia i pasek (`Hud`) mają haki (`useState`, `useRef`, `useEffect`). Poza renderem Preacta ich nie ma jak wołać, więc atrapa
// daje stan początkowy i nic nie robi przy zmianie: wystarczy, żeby obejrzeć drzewo okna, które zwraca `Settings`, i paska gry.
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
  setSpeed: () => {}, rotate: () => {}, setTimeOfDay: () => {}, setPreset: () => {}, generate: () => {}, randomize: () => {},
};

beforeEach(() => { howTo.value = false; showSettings.value = false; });
afterEach(() => { howTo.value = false; showSettings.value = false; econ.value = null; });

describe('okno „Jak grać”', () => {
  it('domyślnie zamknięte: nic nie rysuje i nie zatrzymuje gry', () => {
    expect(howTo.value).toBe(false);
    expect(HowTo()).toBeNull();
    expect(isModalOpen()).toBe(false);
  });

  it('otwarte zatrzymuje grę i jest oknem dialogowym „Jak grać” na istniejących klasach okien', () => {
    howTo.value = true;
    expect(isModalOpen()).toBe(true);
    const tree = HowTo()!;
    const nodes = walk(tree);
    expect(nodes[0]!.props.class).toBe('tt-modal-wrap');
    const dialog = nodes.find((v) => v.props.role === 'dialog')!;
    expect(dialog.props['aria-label']).toBe('Jak grać');
    expect(dialog.props['aria-modal']).toBe('true');
    expect(String(dialog.props.class)).toContain('tt-modal');
  });

  it('pokazuje punkty „co robić” jako jedną listę, a szczegóły jako zwinięte <details> z tytułem w <summary>', () => {
    howTo.value = true;
    const tree = HowTo()!;
    const shown = textOf(tree);
    const points = howToPoints();
    const details = howToDetails();
    const lists = walk(tree).filter((v) => v.type === 'ul');
    expect(lists).toHaveLength(1);
    expect(walk(lists[0]!).filter((v) => v.type === 'li').map((v) => textOf(v))).toEqual(points);
    const blocks = walk(tree).filter((v) => v.type === 'details');
    expect(blocks).toHaveLength(details.length);
    blocks.forEach((block, i) => {
      expect(block.props.open, details[i]!.title).toBeUndefined();   // zwinięte: okno mieści się na ekranie bez przewijania
      expect(textOf(walk(block).find((v) => v.type === 'summary'))).toBe(details[i]!.title);
      expect(walk(block).filter((v) => v.type === 'p').map((v) => textOf(v))).toEqual(details[i]!.paragraphs);
    });
    for (const d of details) for (const p of d.paragraphs) expect(shown).toContain(p);
    expect(walk(tree).filter((v) => v.type === 'h2').map((v) => textOf(v))).toEqual(['Jak grać']);
    // punkty są nad szczegółami: lista stoi w drzewie przed pierwszym <details>
    const order = walk(tree).filter((v) => v.type === 'ul' || v.type === 'details');
    expect(order[0]!.type).toBe('ul');
  });

  it('jeden przycisk „Zaczynamy” (tt-btn tt-primary) zamyka okno, a gra rusza', () => {
    howTo.value = true;
    const tree = HowTo()!;
    expect(labels(tree)).toEqual(['Zaczynamy']);
    const button = buttonLabelled(tree, 'Zaczynamy');
    expect(String(button.props.class)).toContain('tt-btn');
    expect(String(button.props.class)).toContain('tt-primary');
    click(button);
    expect(howTo.value).toBe(false);
    expect(HowTo()).toBeNull();
    expect(isModalOpen()).toBe(false);
  });
});

describe('montaż w aplikacji', () => {
  it('<HowTo /> jest w drzewie App: bez niego otwarte okno zatrzymałoby grę bez żadnego widocznego przycisku', () => {
    expect(walk(App({ controls, game })).some((v) => v.type === HowTo)).toBe(true);
  });
});

describe('„?” w pasku gry (HUD)', () => {
  const hud = (): ReturnType<typeof Hud> => {
    const info = computeStoreInfo(layoutFor('instrukcja', 0));
    econ.value = { s: createEconomy('instrukcja', info), info, v: 1 };
    return Hud({ controls });
  };

  it('stały przycisk „?” z aria-label „Jak grać” na klasie tt-iconbtn, w tym samym wierszu co ⚙', () => {
    const tree = hud();
    const help = buttonAria(tree, 'Jak grać');
    expect(textOf(help)).toBe('?');
    expect(String(help.props.class).split(' ')).toContain('tt-iconbtn');
    const row = walk(tree).find((v) => v.props.class === 'tt-hud-row')!;
    expect(walk(row).includes(help)).toBe(true);
    expect(walk(row).includes(buttonAria(tree, 'Ustawienia'))).toBe(true);
  });

  it('otwiera okno „Jak grać”: gra staje, a w drzewie wstaje instrukcja', () => {
    expect(howTo.value).toBe(false);
    click(buttonAria(hud(), 'Jak grać'));
    expect(howTo.value).toBe(true);
    expect(isModalOpen()).toBe(true);
    expect(labels(HowTo())).toEqual(['Zaczynamy']);
  });

  it('nie rusza ustawień: ⚙ dalej otwiera tylko ustawienia', () => {
    click(buttonAria(hud(), 'Ustawienia'));
    expect(showSettings.value).toBe(true);
    expect(howTo.value).toBe(false);
  });
});

describe('⚙: przycisk „Jak grać”', () => {
  it('ustawia howTo na true i zamyka ustawienia', () => {
    showSettings.value = true;
    click(buttonLabelled(HowToButton(), 'Jak grać'));
    expect(howTo.value).toBe(true);
    expect(showSettings.value).toBe(false);
  });

  it('jest w oknie ustawień i działa stamtąd: ustawienia znikają, a w ich miejsce wstaje instrukcja', () => {
    showSettings.value = true;
    const tree = Settings({ controls, game })!;
    const inSettings = walk(tree).filter((v) => v.type === HowToButton);
    expect(inSettings).toHaveLength(1);
    click(buttonLabelled((inSettings[0]!.type as typeof HowToButton)(), 'Jak grać'));
    expect(howTo.value).toBe(true);
    expect(Settings({ controls, game })).toBeNull();
    expect(labels(HowTo())).toEqual(['Zaczynamy']);
  });
});

describe('nazwy z interfejsu w treści zgadzają się z interfejsem', () => {
  const all = (): string => [...howToPoints(), ...howToDetails().flatMap((s) => s.paragraphs)].join('\n');
  const info = computeStoreInfo(layoutFor('instrukcja', 0));
  const s = createEconomy('instrukcja', info);

  it('zakładki: każda „zakładka X” z treści to nazwa z paska zakładek', () => {
    const tabNames = walk(TabBar()).filter((v) => v.props.class === 'tt-tab-label').map((v) => textOf(v));
    expect(tabNames).toEqual(['Sklep', 'Palety', 'Ludzie', 'Ulepszenia', 'Cele']);
    const mentioned = [...all().matchAll(/zakład(?:k[aięą]|ce) ([A-ZŁŚŻŹĆ]\p{L}+)/gu)].map((m) => m[1]!);
    expect(new Set(mentioned)).toEqual(new Set(['Cele', 'Palety', 'Ludzie', 'Ulepszenia', 'Sklep']));   // wszystkie zakładki, o których mówi treść
    for (const name of mentioned) expect(tabNames, name).toContain(name);
  });

  it('sekcje paneli, o których mówi treść, istnieją', () => {
    const goals = GoalsPanel({ s, info, game, v: 1 });
    const people = PeoplePanel({ s, info, game, v: 1 });
    for (const title of [...all().matchAll(/sekcja „([^”]+)”/g)].map((m) => m[1]!)) expect(() => sectionTitled(goals, title), title).not.toThrow();
    expect(all()).toContain('„Kto co robi teraz”');
    expect(() => sectionTitled(people, 'Kto co robi teraz')).not.toThrow();
  });

  it('zamówienie: „Asystent Traszki” z treści to przycisk w sekcji „Zamówienie na jutro”, a dostawa przychodzi na następny dzień', () => {
    const order = sectionTitled(PalletsPanel({ s, info, game, v: 1 }), 'Zamówienie na jutro');
    expect(labels(order)).toContain('Asystent Traszki');
    expect(all()).toContain('Domyślnie zamawia Asystent Traszki');
    expect(s.order.auto).toBe(true);   // „domyślnie” zamawia asystent
  });

  it('przyciski przestawiania palet i profile pracy mają w treści te same napisy co w panelach', () => {
    const buttons = labels(PalletItem({ s, info, id: s.pallets[0]!.id, game }));
    expect(buttons).toContain('Na zaplecze');
    expect(buttons).toContain('Do sali');
    expect(all()).toContain('„Na zaplecze”');
    expect(all()).toContain('„Do sali”');
    const profileButtons = labels(sectionTitled(PeoplePanel({ s, info, game, v: 1 }), 'Profil pracy'));
    for (const p of STAFF_PROFILES) {
      expect(profileButtons).toContain(PROFILE_LABEL[p]);
      expect(all()).toContain(`„${PROFILE_LABEL[p]}”`);
    }
  });
});
