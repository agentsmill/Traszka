/**
 * Tylko do testów: paczka zapisu w kształcie z gry (`TransferBundle` z `src/ui/ranking/saveTransfer.ts`) jako tekst JSON. Wartości
 * wpisane literalnie, a nie z `config.ts`, żeby zła stała serwera nie przeszła w testach razem z paczką, którą sama ocenia.
 * `bytes` dopycha paczkę do dokładnie tylu bajtów UTF-8 (polem `save.pad`), a `filler` mówi, czym: domyślnie `a` (1 bajt),
 * `"` daje w tekście JSON `\"` (najgorszy przypadek dla podwójnego ucieczkowania), `ż` to dwa bajty.
 */
export function testBundle(opts: { bytes?: number; filler?: string; seed?: string } = {}): string {
  const make = (pad: string): string => JSON.stringify({
    format: 'traszka-przeniesienie', version: 1, seed: opts.seed ?? 'pierogi-731',
    meta: { version: 1, partnerPoints: 7 }, save: { schema: 2, pad },
  });
  if (opts.bytes === undefined) return make('');
  const size = (text: string): number => new TextEncoder().encode(text).length;
  const filler = opts.filler ?? 'a';
  const base = size(make(''));
  const unit = size(make(filler)) - base;
  let pad = filler.repeat(Math.max(0, Math.floor((opts.bytes - base) / unit)));
  pad += 'a'.repeat(Math.max(0, opts.bytes - size(make(pad))));
  return make(pad);
}
