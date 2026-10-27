import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderContext, NOTICE_EVENT, NOTICE_NO_WEBGL2 } from './renderer';

/** Kanwa, z której nie da się dostać żadnego kontekstu (przeglądarka bez WebGL 2). */
function canvasWithoutWebGL2(): HTMLCanvasElement {
  return { getContext: () => null, addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLCanvasElement;
}

describe('createRenderContext bez WebGL 2', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget());
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rzuca wyjątek i wysyła traszka:notice z polskim komunikatem, który odbiera listener zarejestrowany wcześniej', async () => {
    const received: string[] = [];
    window.addEventListener(NOTICE_EVENT, (e) => received.push((e as CustomEvent<{ text: string }>).detail.text));

    expect(() => createRenderContext(canvasWithoutWebGL2(), 'srednia')).toThrow('WebGL 2');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toEqual([NOTICE_NO_WEBGL2]);
    expect(NOTICE_NO_WEBGL2).toBe(
      'Twoja przeglądarka nie obsługuje WebGL 2, więc gra nie może się uruchomić. Spróbuj aktualnej wersji Chrome, Edge, Firefox lub Safari.',
    );
  });
});
