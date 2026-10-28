import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLauncher, nextPaint } from './launch';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Czy obietnica już się spełniła (bez czekania na nią). */
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => { done = true; });
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

describe('nextPaint: spełnia się dopiero po namalowaniu klatki', () => {
  it('nie wcześniej niż po klatce: rAF woła się przed malowaniem, więc dopiero zadanie zaplanowane z niego liczy się jako „po”', async () => {
    const frames: (() => void)[] = [];
    const promise = nextPaint(120, (callback) => frames.push(callback), (callback, ms) => setTimeout(callback, ms));
    expect(await settled(promise)).toBe(false);          // klatka jeszcze nie przyszła
    expect(frames).toHaveLength(1);
    frames[0]!();                                        // klatka: callback rAF, tuż przed malowaniem
    expect(await settled(promise)).toBe(false);          // jeszcze przed malowaniem: czeka na zadanie po nim
    await vi.advanceTimersByTimeAsync(0);                // zadanie po malowaniu
    expect(await settled(promise)).toBe(true);
  });

  it('karta w tle nie rysuje klatek (rAF stoi): spełnia się po limicie czasu, a nie wisi w nieskończoność', async () => {
    const promise = nextPaint(120, () => 0, (callback, ms) => setTimeout(callback, ms));
    await vi.advanceTimersByTimeAsync(119);
    expect(await settled(promise)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(promise)).toBe(true);
  });

  it('domyślnie używa requestAnimationFrame i setTimeout przeglądarki', async () => {
    const raf = vi.fn((callback: () => void) => { setTimeout(callback, 16); return 1; });
    vi.stubGlobal('requestAnimationFrame', raf);
    try {
      const promise = nextPaint();
      expect(raf).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(16);               // klatka (callback rAF)
      expect(await settled(promise)).toBe(false);
      await vi.advanceTimersByTimeAsync(1);                // zadanie po klatce
      expect(await settled(promise)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createLauncher: odpowiedź od razu, praca po namalowaniu, start tylko raz', () => {
  /** `wait` sterowane z testu: spełnia się na polecenie. */
  const gate = () => {
    let open!: () => void;
    const wait = vi.fn(() => new Promise<void>((resolve) => { open = resolve; }));
    return { wait, open: () => open() };
  };

  it('odpowiedź (feedback) idzie od razu, a praca dopiero po namalowaniu', async () => {
    const { wait, open } = gate();
    const order: string[] = [];
    const launcher = createLauncher(wait);
    expect(launcher.launch(() => order.push('odpowiedź'), () => order.push('praca'))).toBe(true);
    expect(order).toEqual(['odpowiedź']);                // praca nie ruszyła w tym samym zadaniu
    expect(wait).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(order).toEqual(['odpowiedź']);
    open();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['odpowiedź', 'praca']);
  });

  it('busy od pierwszego wywołania; drugie wywołanie w międzyczasie (podwójne kliknięcie, Enter w polu) nic nie robi', async () => {
    const { wait, open } = gate();
    const launcher = createLauncher(wait);
    expect(launcher.busy).toBe(false);
    const work = vi.fn();
    const feedback = vi.fn();
    expect(launcher.launch(feedback, work)).toBe(true);
    expect(launcher.busy).toBe(true);
    expect(launcher.launch(feedback, work)).toBe(false);
    expect(launcher.launch(feedback, work)).toBe(false);
    open();
    await Promise.resolve();
    await Promise.resolve();
    expect(feedback).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(launcher.launch(feedback, work)).toBe(false);   // po starcie też: ekran i tak się zamyka
  });

  it('z prawdziwym nextPaint: praca rusza dopiero po klatce, nie w zadaniu kliknięcia', async () => {
    const frames: (() => void)[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    try {
      const launcher = createLauncher();
      const work = vi.fn();
      launcher.launch(() => {}, work);
      await Promise.resolve();
      expect(work).not.toHaveBeenCalled();
      frames[0]!();
      await vi.advanceTimersByTimeAsync(0);
      expect(work).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
