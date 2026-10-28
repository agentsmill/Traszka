import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAP_MAX_MS, TAP_SLOP, isTapRelease, keyAction } from './controls';

/** Atrapy elementów DOM: testy idą w node, a `isTyping` sprawdza `instanceof HTMLElement` i jego podklas. */
class FakeElement { isContentEditable = false; }
class FakeInput extends FakeElement {}
class FakeTextArea extends FakeElement {}
class FakeSelect extends FakeElement {}

beforeEach(() => {
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('HTMLInputElement', FakeInput);
  vi.stubGlobal('HTMLTextAreaElement', FakeTextArea);
  vi.stubGlobal('HTMLSelectElement', FakeSelect);
});
afterEach(() => { vi.unstubAllGlobals(); });

type KeyEvent = Parameters<typeof keyAction>[1];
/** Zwykłe naciśnięcie klawisza (bez modyfikatorów, poza polem tekstowym); `over` nadpisuje wybrane pola. */
const press = (key: string, over: Partial<KeyEvent> = {}): KeyEvent => ({
  key, ctrlKey: false, metaKey: false, altKey: false, target: null, ...over,
});

describe('keyAction', () => {
  it('zwraca akcję przypisaną do klawisza, a dla nieznanego klawisza nic', () => {
    const q = (): void => {};
    const keys = { q };
    expect(keyAction(keys, press('q'))).toBe(q);
    expect(keyAction(keys, press('z'))).toBeUndefined();
  });

  it('klawisze specjalne i znaki działają po dokładnej nazwie', () => {
    const left = (): void => {}, plus = (): void => {}, space = (): void => {};
    const keys = { ArrowLeft: left, '+': plus, ' ': space };
    expect(keyAction(keys, press('ArrowLeft'))).toBe(left);
    expect(keyAction(keys, press('+'))).toBe(plus);
    expect(keyAction(keys, press(' '))).toBe(space);
  });

  it('wielka litera (Shift, CapsLock) trafia w akcję małej litery', () => {
    const q = (): void => {};
    expect(keyAction({ q }, press('Q'))).toBe(q);
  });

  it('dokładna nazwa ma pierwszeństwo przed małą literą', () => {
    const upper = (): void => {}, lower = (): void => {};
    expect(keyAction({ X: upper, x: lower }, press('X'))).toBe(upper);
    expect(keyAction({ X: upper, x: lower }, press('x'))).toBe(lower);
  });

  it('Ctrl, Cmd i Alt wyłączają klawisze (Cmd+R to przeładowanie strony, nie nowy seed)', () => {
    const r = (): void => {};
    expect(keyAction({ r }, press('r', { ctrlKey: true }))).toBeUndefined();
    expect(keyAction({ r }, press('r', { metaKey: true }))).toBeUndefined();
    expect(keyAction({ r }, press('r', { altKey: true }))).toBeUndefined();
    expect(keyAction({ r }, press('r'))).toBe(r);
  });

  it('w polu tekstowym (input, textarea, select, contenteditable) litery są tekstem, a nie poleceniem', () => {
    const q = (): void => {};
    const editable = new FakeElement();
    editable.isContentEditable = true;
    for (const target of [new FakeInput(), new FakeTextArea(), new FakeSelect(), editable]) {
      expect(keyAction({ q }, press('q', { target: target as unknown as EventTarget }))).toBeUndefined();
    }
  });

  it('na elemencie, w którym się nie pisze (przycisk, brak celu), klawisze działają', () => {
    const q = (): void => {};
    expect(keyAction({ q }, press('q', { target: new FakeElement() as unknown as EventTarget }))).toBe(q);
    expect(keyAction({ q }, press('q', { target: null }))).toBe(q);
  });

  it('`blocked` zwracające true wyłącza klawisze, false ich nie rusza, a bez `blocked` działają', () => {
    const q = (): void => {};
    expect(keyAction({ q }, press('q'), () => true)).toBeUndefined();
    expect(keyAction({ q }, press('q'), () => false)).toBe(q);
    expect(keyAction({ q }, press('q'), undefined)).toBe(q);
  });
});

describe('isTapRelease', () => {
  const tap = { id: 7, x: 100, y: 200, t: 1000 };

  it('puszczenie tym samym palcem w tym samym miejscu zaraz po dotknięciu to stuknięcie', () => {
    expect(isTapRelease(tap, 7, 100, 200, 1050)).toBe(true);
  });

  it('bez dotknięcia (null) stuknięcia nie ma', () => {
    expect(isTapRelease(null, 7, 100, 200, 1050)).toBe(false);
  });

  it('inny palec niż ten, który dotknął, nie kończy stuknięcia', () => {
    expect(isTapRelease(tap, 8, 100, 200, 1050)).toBe(false);
  });

  it('ruch poniżej progu to jeszcze stuknięcie, od progu w górę przeciąganie', () => {
    expect(isTapRelease(tap, 7, 100 + TAP_SLOP - 1, 200, 1050)).toBe(true);
    expect(isTapRelease(tap, 7, 100, 200 - (TAP_SLOP - 1), 1050)).toBe(true);
    expect(isTapRelease(tap, 7, 100 + TAP_SLOP, 200, 1050)).toBe(false);
    expect(isTapRelease(tap, 7, 100, 200 + TAP_SLOP, 1050)).toBe(false);
  });

  it('próg ruchu liczy odległość, nie osie osobno (6 px w poziomie i w pionie to około 8,5 px)', () => {
    expect(isTapRelease(tap, 7, 106, 206, 1050)).toBe(false);
    expect(isTapRelease(tap, 7, 105, 205, 1050)).toBe(true);
  });

  it('dłuższe przytrzymanie niż limit czasu to nie stuknięcie', () => {
    expect(isTapRelease(tap, 7, 100, 200, tap.t + TAP_MAX_MS - 1)).toBe(true);
    expect(isTapRelease(tap, 7, 100, 200, tap.t + TAP_MAX_MS)).toBe(false);
    expect(isTapRelease(tap, 7, 100, 200, tap.t + 5000)).toBe(false);
  });

  it('limit czasu to 600 ms, a próg ruchu 8 px (wartości z dawnego main.ts)', () => {
    expect(TAP_MAX_MS).toBe(600);
    expect(TAP_SLOP).toBe(8);
  });
});
