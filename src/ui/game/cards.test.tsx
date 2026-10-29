import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '@/sim/economy/commands';
import { applyCommand } from '@/sim/economy/commands';
import { awaitingDecision, createEconomy, stepMinute, type CommandResult, type EconEvent, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { cardDef, fillText, type AnswerInstance, type CardInstance } from '@/sim/economy/tycoon/cards';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { layoutFor } from '@/sim/store/layoutFor';
import { App } from '../App';
import { econ, pushStory, report, story, type Controls, type GameActions } from '../state';
import { CardDesk, picked, selectedAnswer } from './cards';
import { deltaLines } from './cardText';
import { int, people } from './format';
import { PrestigeModal, ReportModal, Settings, StoryModal, WelcomeModal } from './overlays';
import { Sheet, TabBar } from './panels';
import { buttonLabelled, buttonsOf, click, labels, textOf, walk, type Vnode } from './vnodeTree';

const nbsp = (n: number): string => n.toLocaleString('pl-PL');

/** Atrapa `GameActions`: okno karty tylko wysyła `answerCard`, więc liczy się wyłącznie `dispatch`. */
function fakeGame(result: CommandResult = { ok: true }): GameActions & { dispatch: ReturnType<typeof vi.fn<(cmd: Command) => CommandResult>> } {
  return {
    dispatch: vi.fn<(cmd: Command) => CommandResult>(() => result),
    claimWelcome: vi.fn(), openNextStore: vi.fn(), setSound: vi.fn(), setVibration: vi.fn(), restart: vi.fn(), newStore: vi.fn(),
    startRanked: vi.fn(() => false), resumeRanked: vi.fn(() => false), leaveRanked: vi.fn(), abandonRanked: vi.fn(),
    openFinish: vi.fn(), rememberNick: vi.fn(),
  };
}

const answer = (delta: AnswerInstance['delta'], extra: Partial<AnswerInstance> = {}): AnswerInstance => ({ delta, mods: [], risk: null, ...extra });

/** Karta z talii: trzy odpowiedzi „FEFO o 18:00” (n kanapek za v zł) z domyślną „zostaw”. */
function fefo(seq: number, showAt: number): CardInstance {
  return {
    seq, id: 'fefo', day: 0, showAt, params: { n: 12, v: 1080 }, defaultAnswer: 2,
    answers: [
      answer({ cash: -320, wut: 110, staffMinutes: 15 }),
      answer({ cash: -490, staffMinutes: 25, reputation: 0.5, ogonki: 2 }),
      answer({}, { risk: { chance: 0.75, delta: { wut: 1080 } } }),
    ],
  };
}

/** Okólnik Centrali z dwiema odpowiedziami, domyślna druga. */
function premia(seq: number, showAt: number): CardInstance {
  return {
    seq, id: 'okolnik-premia', day: 0, showAt, params: { b: 800 }, defaultAnswer: 1,
    answers: [answer({ bonus: 800, staffMinutes: 45, wut: 400 }), answer({})],
  };
}

function base(): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor('karty', 0));
  const s = createEconomy('karty', info);
  s.tycoon.cards.pending = [];   // karty z losowania dnia zerowego zastępują te napisane w teście
  return { s, info };
}

/** Wystawia grę z podanymi kartami (wszystkie widoczne od razu, chyba że `showAt` jest w przyszłości). */
function publish(...cards: CardInstance[]): EconomyState {
  const { s, info } = base();
  s.minute = 1000;
  s.tycoon.cards.pending = cards;
  econ.value = { s, info, v: 1 };
  return s;
}

/** Przyciski odpowiedzi (radio), w kolejności z karty. */
const answerButtons = (tree: Vnode): Vnode[] => buttonsOf(tree).filter((b) => b.props.role === 'radio');
const checked = (tree: Vnode): boolean[] => answerButtons(tree).map((b) => b.props['aria-checked'] === true);
const desk = (game: GameActions): Vnode => CardDesk({ game }) as Vnode;
/** Chipy skutków jednej odpowiedzi (bez „domyślnie”): klasa wskazuje ocenę, `key` jest numerem wiersza. */
const chipsOf = (button: Vnode): Vnode[] => walk(button).filter((v) => String(v.props?.class ?? '').split(' ').includes('tt-chip') && !String(v.props.class).includes('tag'));
const toneOfChip = (chip: Vnode): string => String(chip.props.class).split(' ').filter((c) => c !== 'tt-chip').join(' ');

beforeEach(() => { picked.value = null; });
afterEach(() => { econ.value = null; report.value = null; picked.value = null; story.value = []; });

describe('okno karty dnia: kiedy się pokazuje', () => {
  it('bez gry albo bez widocznej karty nic nie widać', () => {
    econ.value = null;
    expect(CardDesk({ game: fakeGame() })).toBeNull();
    publish();   // pusta talia na biurku
    expect(CardDesk({ game: fakeGame() })).toBeNull();
    publish(fefo(1, 1001));   // godzina karty jeszcze nie nadeszła (minuta gry 1000)
    expect(CardDesk({ game: fakeGame() })).toBeNull();
  });

  it('pokazuje się, gdy jest choć jedna widoczna karta; po odpowiedzi znika (stan bez karty)', () => {
    const s = publish(fefo(1, 1000));
    expect(CardDesk({ game: fakeGame() })).not.toBeNull();
    s.tycoon.cards.pending = [];
    expect(CardDesk({ game: fakeGame() })).toBeNull();
  });

  it('raport miesiąca ma pierwszeństwo: dopóki jest otwarty, karta czeka', () => {
    publish(fefo(1, 1000));
    report.value = { label: 'wrzesień' } as unknown as MonthReport;
    expect(CardDesk({ game: fakeGame() })).toBeNull();
    report.value = null;
    expect(CardDesk({ game: fakeGame() })).not.toBeNull();
  });

  it('ważne zdarzenie czekające na „OK” ma pierwszeństwo: karta czeka za nim, bo gra i tak stoi', () => {
    publish(fefo(1, 1000));
    pushStory('Remont zakończony', 'Sklep otwarty.');
    expect(CardDesk({ game: fakeGame() })).toBeNull();
    story.value = [];
    expect(CardDesk({ game: fakeGame() })).not.toBeNull();
  });

  it('po końcu gry karty nie pokazują się (zostaje okno końca współpracy)', () => {
    const s = publish(fefo(1, 1000));
    s.gameOver = true;
    expect(CardDesk({ game: fakeGame() })).toBeNull();
  });
});

describe('okno karty dnia: treść', () => {
  it('nagłówek „Karta 1 z N” (N to karty widoczne), tytuł i tekst z liczbami po polsku', () => {
    publish(fefo(1, 990), fefo(2, 995), premia(3, 2000));   // trzecia jeszcze nie widoczna
    const tree = desk(fakeGame());
    expect(textOf(tree)).toContain('Karta 1 z 2');
    const def = cardDef('fefo')!;
    expect(textOf(tree)).toContain(def.title);
    expect(textOf(tree)).toContain(fillText(def.text, { n: 12, v: 1080 }, int));
    expect(textOf(tree)).toContain(`${nbsp(1080)} zł`);   // {v} z odstępem tysięcy, nie „1080”
  });

  it('pokazuje najstarszą kartę, a po jej odpowiedzi następną (z własnym nagłówkiem)', () => {
    const s = publish(premia(5, 900), fefo(6, 950));
    expect(textOf(desk(fakeGame()))).toContain(cardDef('okolnik-premia')!.title);
    s.tycoon.cards.pending = s.tycoon.cards.pending.filter((c) => c.seq !== 5);
    const next = desk(fakeGame());
    expect(textOf(next)).toContain(cardDef('fefo')!.title);
    expect(textOf(next)).toContain('Karta 1 z 1');
  });

  it('okólnik dostaje plakietkę „Okólnik Centrali”, zwykła karta nie', () => {
    publish(premia(1, 900));
    expect(textOf(desk(fakeGame()))).toContain('Okólnik Centrali');
    publish(fefo(1, 900));
    expect(textOf(desk(fakeGame()))).not.toContain('Okólnik Centrali');
  });

  it('każda odpowiedź ma swój napis i skutki z deltaLines', () => {
    const card = fefo(1, 900);
    publish(card);
    const tree = desk(fakeGame());
    const def = cardDef('fefo')!;
    const buttons = answerButtons(tree);
    expect(buttons).toHaveLength(3);
    card.answers.forEach((a, i) => {
      expect(textOf(buttons[i])).toContain(def.answers[i]!.label);
      for (const line of deltaLines(a, people)) expect(textOf(buttons[i]), line.text).toContain(line.text);
    });
    expect(textOf(buttons[0])).toContain('−320 zł');
    expect(textOf(buttons[2])).toContain('ryzyko 75%');
  });

  it('odpowiedź bez skutków mówi, że nic się nie zmienia', () => {
    publish(premia(1, 900));
    expect(textOf(answerButtons(desk(fakeGame()))[1])).toContain('bez skutków');
  });

  it('nieznana karta z zapisu nie zawiesza gry: pokazuje się z numerami odpowiedzi', () => {
    publish({ ...fefo(1, 900), id: 'nie-ma-takiej' });
    const tree = desk(fakeGame());
    expect(answerButtons(tree).map((b) => textOf(b))).toEqual([
      expect.stringContaining('Odpowiedź 1'), expect.stringContaining('Odpowiedź 2'), expect.stringContaining('Odpowiedź 3'),
    ]);
  });
});

describe('okno karty dnia: wybór i zatwierdzenie', () => {
  it('odpowiedź domyślna jest zaznaczona z góry (i opisana jako domyślna)', () => {
    publish(fefo(1, 900));
    const tree = desk(fakeGame());
    expect(checked(tree)).toEqual([false, false, true]);
    expect(textOf(answerButtons(tree)[2])).toContain('domyślnie');
    expect(textOf(answerButtons(tree)[0])).not.toContain('domyślnie');
    publish(premia(1, 900));
    expect(checked(desk(fakeGame()))).toEqual([false, true]);
  });

  it('samo „Zatwierdź” wysyła answerCard z odpowiedzią domyślną', () => {
    publish(fefo(7, 900));
    const game = fakeGame();
    click(buttonLabelled(desk(game), 'Zatwierdź'));
    expect(game.dispatch).toHaveBeenCalledTimes(1);
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'answerCard', seq: 7, answer: 2 });
  });

  it('klik w inną odpowiedź przesuwa zaznaczenie, a „Zatwierdź” wysyła właśnie ją', () => {
    publish(fefo(7, 900));
    const game = fakeGame();
    click(answerButtons(desk(game))[0]!);
    expect(game.dispatch).not.toHaveBeenCalled();   // wybór nic jeszcze nie zatwierdza
    const after = desk(game);
    expect(checked(after)).toEqual([true, false, false]);
    click(buttonLabelled(after, 'Zatwierdź'));
    expect(game.dispatch).toHaveBeenCalledTimes(1);
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'answerCard', seq: 7, answer: 0 });
  });

  it('można zmienić zdanie: ostatni klik wygrywa', () => {
    publish(fefo(7, 900));
    const game = fakeGame();
    click(answerButtons(desk(game))[0]!);
    click(answerButtons(desk(game))[1]!);
    click(answerButtons(desk(game))[2]!);
    click(answerButtons(desk(game))[1]!);
    click(buttonLabelled(desk(game), 'Zatwierdź'));
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'answerCard', seq: 7, answer: 1 });
  });

  it('wybór dotyczy karty: następna karta zaczyna od własnej odpowiedzi domyślnej', () => {
    const s = publish(fefo(7, 900), premia(8, 950));
    const game = fakeGame();
    click(answerButtons(desk(game))[0]!);   // karta 7: odpowiedź 0
    expect(checked(desk(game))).toEqual([true, false, false]);
    s.tycoon.cards.pending = s.tycoon.cards.pending.filter((c) => c.seq !== 7);   // 7 odpowiedziana, na biurku zostaje 8
    expect(checked(desk(game))).toEqual([false, true]);   // domyślna okólnika, nie przeniesione „0”
    click(buttonLabelled(desk(game), 'Zatwierdź'));
    expect(game.dispatch).toHaveBeenLastCalledWith({ type: 'answerCard', seq: 8, answer: 1 });
  });

  it('wybór z karty o tym samym numerze nie wraca po odpowiedzi (stan czyści się po zatwierdzeniu)', () => {
    publish(fefo(7, 900));
    const game = fakeGame();
    click(answerButtons(desk(game))[0]!);
    click(buttonLabelled(desk(game), 'Zatwierdź'));
    expect(picked.value).toBeNull();
  });

  it('odmowa polecenia (np. karta zniknęła) nie zostawia okna w połowie: wybór zostaje, błąd pokaże toast powłoki', () => {
    publish(fefo(7, 900));
    const game = fakeGame({ ok: false, text: 'Tej karty już nie ma na biurku.' });
    click(answerButtons(desk(game))[1]!);
    click(buttonLabelled(desk(game), 'Zatwierdź'));
    expect(game.dispatch).toHaveBeenCalledTimes(1);
    expect(checked(desk(game))).toEqual([false, true, false]);
  });

  it('spóźnione drugie stuknięcie w „Zatwierdź” starej karty nic nie wysyła', () => {
    const s = publish(fefo(7, 900));
    const game = fakeGame();
    const stale = buttonLabelled(desk(game), 'Zatwierdź');
    click(stale);
    s.tycoon.cards.pending = [];   // powłoka zaksięgowała odpowiedź, okno jeszcze się nie odświeżyło
    click(stale);
    expect(game.dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('okno karty dnia: zaznaczona odpowiedź pod ochroną', () => {
  it('odpowiedź domyślna poza zakresem (zepsuty zapis) nie zostawia okna bez zaznaczenia: pierwsza odpowiedź', () => {
    for (const bad of [3, 9, -1, 1.5, Number.NaN]) {
      publish({ ...fefo(1, 900), defaultAnswer: bad });
      expect(checked(desk(fakeGame())), String(bad)).toEqual([true, false, false]);
    }
  });

  it('po „Zatwierdź” z takiej karty leci odpowiedź 0, nie liczba spoza zakresu', () => {
    publish({ ...fefo(7, 900), defaultAnswer: 9 });
    const game = fakeGame();
    click(buttonLabelled(desk(game), 'Zatwierdź'));
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'answerCard', seq: 7, answer: 0 });
  });

  it('wybór ze starej gry (ten sam numer karty, odpowiedź spoza zakresu) jest ignorowany: zaznaczona zostaje domyślna', () => {
    publish(premia(1, 900));   // karta o dwóch odpowiedziach, domyślna druga
    picked.value = { seq: 1, answer: 2 };   // w poprzedniej grze karta nr 1 miała trzy odpowiedzi
    const game = fakeGame();
    expect(checked(desk(game))).toEqual([false, true]);
    click(buttonLabelled(desk(game), 'Zatwierdź'));
    expect(game.dispatch).toHaveBeenCalledWith({ type: 'answerCard', seq: 1, answer: 1 });
  });

  it('wybór cudzej karty albo odpowiedzi ujemnej, ułamkowej lub NaN też jest ignorowany', () => {
    publish(fefo(4, 900));
    for (const stale of [{ seq: 3, answer: 0 }, { seq: 5, answer: 1 }, { seq: 4, answer: -1 }, { seq: 4, answer: 0.5 }, { seq: 4, answer: Number.NaN }]) {
      picked.value = stale;
      expect(checked(desk(fakeGame())), JSON.stringify(stale)).toEqual([false, false, true]);
    }
    picked.value = { seq: 4, answer: 1 };   // ważny wybór tej karty działa
    expect(checked(desk(fakeGame()))).toEqual([false, true, false]);
  });

  it('selectedAnswer: ważny wybór, domyślna, a gdy i ona jest poza zakresem, zero', () => {
    const card = { seq: 2, answers: [answer({}), answer({}), answer({})], defaultAnswer: 2 };
    expect(selectedAnswer(card, null)).toBe(2);
    expect(selectedAnswer(card, { seq: 2, answer: 0 })).toBe(0);
    expect(selectedAnswer(card, { seq: 1, answer: 0 })).toBe(2);
    expect(selectedAnswer(card, { seq: 2, answer: 3 })).toBe(2);
    expect(selectedAnswer({ ...card, defaultAnswer: 7 }, null)).toBe(0);
    expect(selectedAnswer({ ...card, defaultAnswer: 7 }, { seq: 2, answer: 9 })).toBe(0);
  });
});

describe('okno karty dnia: „Zatwierdź” zawsze działa', () => {
  // `click` z vnodeTree nie zna `disabled`, więc stan przycisku sprawdzamy wprost
  it('nigdy nie jest wyłączony: na starcie, po wyborze innej odpowiedzi i przy odpowiedzi domyślnej spoza zakresu', () => {
    publish(fefo(7, 900));
    const game = fakeGame();
    expect(buttonLabelled(desk(game), 'Zatwierdź').props.disabled).toBeFalsy();
    for (let i = 0; i < 3; i++) {
      click(answerButtons(desk(game))[i]!);
      expect(buttonLabelled(desk(game), 'Zatwierdź').props.disabled, `po wyborze ${i}`).toBeFalsy();
    }
    publish({ ...fefo(8, 900), defaultAnswer: 9 });
    expect(buttonLabelled(desk(game), 'Zatwierdź').props.disabled).toBeFalsy();
  });
});

describe('okno karty dnia: chipy skutków', () => {
  it('koszty są czerwone, zyski zielone (klasa oceny obok .tt-chip), także gdy stoją obok siebie', () => {
    publish(premia(1, 900), fefo(2, 950));
    const buttons = answerButtons(desk(fakeGame()));   // okólnik: premia +800, czas ludzi 45 min, ubytki +400
    const tones = Object.fromEntries(chipsOf(buttons[0]!).map((c) => [textOf(c), toneOfChip(c)]));
    expect(tones).toEqual({ [`+${nbsp(800)} zł`]: 'gain', 'czas ludzi 45 min': 'cost', [`ubytki +${nbsp(400)} zł`]: 'cost' });
    publish(fefo(2, 950));
    const fefoChips = chipsOf(answerButtons(desk(fakeGame()))[1]!);   // −490 zł, czas ludzi 25 min, reputacja +0,5, Ogonki +2
    expect(fefoChips.map((c) => [textOf(c), toneOfChip(c)])).toEqual([
      ['−490 zł', 'cost'], ['czas ludzi 25 min', 'cost'], ['reputacja +0,5', 'gain'], ['Ogonki +2', 'gain'],
    ]);
    expect(toneOfChip(chipsOf(answerButtons(desk(fakeGame()))[2]!)[0]!)).toBe('cost');   // ryzyko 75%: ubytki +1 080 zł
  });

  it('odpowiedź bez skutków pokazuje „bez skutków” bez oceny kolorem', () => {
    publish(premia(1, 900));
    const none = chipsOf(answerButtons(desk(fakeGame()))[1]!);
    expect(none.map((c) => [textOf(c), toneOfChip(c)])).toEqual([['bez skutków', 'none']]);
  });

  it('dwa wiersze o tym samym napisie dostają różne klucze (numer wiersza), więc oba się rysują', () => {
    publish({ ...fefo(1, 900), answers: [answer({ cash: -100, fine: -100 }), answer({}), answer({})], defaultAnswer: 1 });
    const chips = chipsOf(answerButtons(desk(fakeGame()))[0]!);
    expect(chips.map((c) => textOf(c))).toEqual(['−100 zł', '−100 zł']);
    expect(chips.map((c) => c.key)).toEqual([0, 1]);
  });
});

describe('okno karty dnia: bez wyjścia', () => {
  it('nie ma krzyżyka ani „Zamknij”; są tylko odpowiedzi i „Zatwierdź”', () => {
    publish(fefo(1, 900));
    const tree = desk(fakeGame());
    expect(buttonsOf(tree)).toHaveLength(4);   // 3 odpowiedzi + zatwierdzenie
    expect(buttonsOf(tree).filter((b) => b.props.role !== 'radio').map((b) => textOf(b))).toEqual(['Zatwierdź']);
    expect(labels(tree).join(' ')).not.toMatch(/✕|Zamknij/);
    expect(walk(tree).some((v) => typeof v.props?.['aria-label'] === 'string' && /zamknij/i.test(v.props['aria-label'] as string))).toBe(false);
  });

  it('to okno modalne: role dialog, aria-modal, tło nie zamyka się po kliknięciu', () => {
    publish(fefo(1, 900));
    const tree = desk(fakeGame());
    const dialog = walk(tree).find((v) => v.props?.role === 'dialog')!;
    expect(dialog.props['aria-modal']).toBe('true');
    expect(String(dialog.props['aria-label'])).toContain(cardDef('fefo')!.title);
    const wrap = walk(tree)[0]!;
    expect(wrap.props.onClick).toBeUndefined();
  });

  it('odpowiedzi tworzą grupę radio z podpisem', () => {
    publish(fefo(1, 900));
    const tree = desk(fakeGame());
    const group = walk(tree).find((v) => v.props?.role === 'radiogroup')!;
    expect(group).toBeDefined();
    expect(group.props['aria-label']).toBe('Odpowiedzi');
  });
});

describe('okno karty dnia: prawdziwe karty z talii', () => {
  it('każda karta, jaka wypadnie w półtora miesiąca gry, pokazuje pełny tekst, odpowiedzi i działające „Zatwierdź”', () => {
    const info = computeStoreInfo(layoutFor('karty-talia', 0));
    const s = createEconomy('karty-talia', info);
    econ.value = { s, info, v: 1 };
    const game: GameActions = {
      ...fakeGame(),
      dispatch: (cmd) => {
        const out = applyCommand(s, info, cmd);
        econ.value = { s, info, v: econ.value!.v + 1 };
        return out.result;
      },
    };
    const seen = new Set<string>();
    const events: EconEvent[] = [];
    for (let m = 0; m < 45 * 1440; m++) {
      if (awaitingDecision(s)) {
        const tree = CardDesk({ game }) as Vnode;
        expect(tree, `minuta ${s.minute}`).not.toBeNull();
        const first = s.tycoon.cards.pending.filter((c) => c.showAt <= s.minute).sort((a, b) => a.showAt - b.showAt || a.seq - b.seq)[0]!;
        seen.add(first.id);
        const text = textOf(tree);
        expect(text, first.id).not.toMatch(/\{|\}|NaN|undefined|Infinity/);
        const buttons = answerButtons(tree);
        expect(buttons.length, first.id).toBe(first.answers.length);
        expect(buttons.length, first.id).toBeGreaterThanOrEqual(2);
        for (const b of buttons) expect(textOf(b).trim().length, first.id).toBeGreaterThan(0);
        expect(checked(tree)[first.defaultAnswer], first.id).toBe(true);
        expect(checked(tree).filter(Boolean)).toHaveLength(1);
        click(buttonLabelled(tree, 'Zatwierdź'));   // gracz, który nie czyta: odpowiedź domyślna
        expect(s.tycoon.cards.pending.some((c) => c.seq === first.seq), first.id).toBe(false);
      } else {
        events.length = 0;
        stepMinute(s, info, events);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);   // talia ma kilkanaście kart dnia i okólniki: w półtora miesiąca widać wiele z nich
    expect([...seen].some((id) => cardDef(id)!.kind === 'okolnik')).toBe(true);
  });
});

describe('okno karty dnia w układzie nakładek', () => {
  it('leży nad panelami i zakładkami, a pod raportem miesiąca, powitaniem, prestiżem i ustawieniami (kolejność w DOM to warstwy)', () => {
    const order = walk(App({ controls: {} as Controls, game: fakeGame() })).map((v) => v.type);
    const at = (c: unknown): number => order.indexOf(c as never);
    for (const c of [CardDesk, StoryModal, Sheet, TabBar, ReportModal, WelcomeModal, PrestigeModal, Settings]) expect(at(c), String(c)).toBeGreaterThanOrEqual(0);
    expect(at(CardDesk)).toBeGreaterThan(at(Sheet));
    expect(at(CardDesk)).toBeGreaterThan(at(TabBar));
    expect(at(StoryModal)).toBeGreaterThan(at(CardDesk));   // raport > ważne zdarzenie > karta decyzji > reszta
    expect(at(StoryModal)).toBeLessThan(at(ReportModal));
    expect(at(CardDesk)).toBeLessThan(at(ReportModal));
    expect(at(CardDesk)).toBeLessThan(at(WelcomeModal));
    expect(at(CardDesk)).toBeLessThan(at(PrestigeModal));
    expect(at(CardDesk)).toBeLessThan(at(Settings));
  });
});
