/*
 * Atrapa kontekstu 2D dla testów rysowania na płótnie (`src/render/rentPoster.ts`, `canvasDraw.ts`): zapisuje wywołania razem ze
 * stanem w chwili rysowania (czcionka, kolor, przezroczystość). Napis mierzy po 0,5 piksela czcionki na znak, więc dopasowanie
 * szerokości zachowuje się jak na prawdziwym płótnie, tylko deterministycznie. Gra tego pliku nie importuje.
 */

export type Call = { op: string; args: unknown[]; font: string; fill: string; alpha: number };

export function fakeContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state = { font: '10px sans-serif', fillStyle: '#000000', globalAlpha: 1, textAlign: 'start', textBaseline: 'alphabetic' };
  const px = (): number => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10);
  const record = (op: string, args: unknown[]): void => { calls.push({ op, args, font: state.font, fill: String(state.fillStyle), alpha: state.globalAlpha }); };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key as keyof typeof target];
      if (key === 'measureText') return (text: string) => ({ width: text.length * px() * 0.5 });
      return (...args: unknown[]) => { record(key, args); };
    },
    set(target, key: string, value: unknown) {
      (target as Record<string, unknown>)[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

export const fontPx = (c: Call): number => Number(/(\d+(?:\.\d+)?)px/.exec(c.font)![1]);
