import { describe, expect, it, vi } from 'vitest';
import type { OpenAtStart } from './actions';
import { openAtBoot, shouldResumeRanked } from './boot';
import type { StartChoice } from './start';

const request = (over: Partial<OpenAtStart> = {}): OpenAtStart => ({ seed: 'traszka-1', fresh: false, choice: null, ...over });
const CHOICE = { nick: 'Kasia', seed: 'traszka-3', look: { outfit: 'normal', appearanceSeed: 'abc' }, specialOutfits: true, notice: null, ranked: false } as unknown as StartChoice;

describe('shouldResumeRanked: czy rozruch ma próbować wznowić bieg rankingowy', () => {
  it('tryb ranked, adres bez ?seed=, bez `?new=1` i bez wyboru z ekranu startowego: tak', () => {
    expect(shouldResumeRanked('ranked', false, request())).toBe(true);
  });

  it('tryb casual: nie, niezależnie od reszty', () => {
    expect(shouldResumeRanked('casual', false, request())).toBe(false);
  });

  it('?seed= w adresie, `?new=1` albo wybór gracza z ekranu startowego: zwykły sklep, mimo trybu ranked', () => {
    expect(shouldResumeRanked('ranked', true, request())).toBe(false);
    expect(shouldResumeRanked('ranked', false, request({ fresh: true }))).toBe(false);
    expect(shouldResumeRanked('ranked', false, request({ choice: CHOICE }))).toBe(false);
  });
});

describe('openAtBoot: wznowienie biegu albo zwykły sklep, nigdy oba', () => {
  const shellOf = (resumed: boolean) => ({ open: vi.fn(() => true), resumeRanked: vi.fn(() => resumed) });

  it('wznowienie się udało: sklepu zwykłego nie otwiera (jedna budowa świata)', () => {
    const shell = shellOf(true);
    expect(openAtBoot(shell, request(), false, 'ranked')).toBe(true);
    expect(shell.resumeRanked).toHaveBeenCalledOnce();
    expect(shell.open).not.toHaveBeenCalled();
  });

  it('wznowienie się nie udało (zapis uszkodzony, z innej wersji, świat się nie zbudował): zwykły sklep z tą samą prośbą', () => {
    const shell = shellOf(false);
    const req = request({ seed: 'ostatni' });
    expect(openAtBoot(shell, req, false, 'ranked')).toBe(true);
    expect(shell.resumeRanked).toHaveBeenCalledOnce();
    expect(shell.open).toHaveBeenCalledExactlyOnceWith(req);
  });

  it('bez powodu do wznowienia nawet nie pyta o bieg; wynik to wynik otwarcia sklepu', () => {
    const shell = { open: vi.fn(() => false), resumeRanked: vi.fn(() => true) };
    expect(openAtBoot(shell, request(), true, 'ranked')).toBe(false);
    expect(openAtBoot(shell, request(), false, 'casual')).toBe(false);
    expect(shell.resumeRanked).not.toHaveBeenCalled();
    expect(shell.open).toHaveBeenCalledTimes(2);
  });
});
