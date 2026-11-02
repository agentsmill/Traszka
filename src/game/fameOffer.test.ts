import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirmEvent } from '@/sim/firm/types';
import { fameOffer } from '@/ui/state';
import { offerFame } from './fameOffer';
import type { GameSession } from './session';

const MILLION: FirmEvent = { kind: 'million', params: { day: 134, cash: 1_012_345 } };
const session = (over: Partial<GameSession> = {}): GameSession => ({ seed: 'pierogi-731', mode: 'casual', ...over }) as GameSession;
const fx = () => ({ play: vi.fn(), confetti: vi.fn() });

beforeEach(() => { fameOffer.value = null; });
afterEach(() => { fameOffer.value = null; });

describe('offerFame: zdarzenie firmy `million`', () => {
  it('inne zdarzenia zostawia w spokoju: false, nic się nie otwiera', () => {
    const f = fx();
    for (const kind of ['goal', 'research', 'unlock', 'notice'] as const) expect(offerFame({ kind, params: { day: 134, cash: 1e6 } }, session(), {}, f)).toBe(false);
    expect(fameOffer.value).toBeNull();
    expect(f.play).not.toHaveBeenCalled();
  });

  it('zwykła gra: otwiera gratulacje z seedem sesji, dniem i gotówką z chwili progu, z dźwiękiem monet i konfetti; zdarzenie obsłużone', () => {
    const f = fx();
    expect(offerFame(MILLION, session(), {}, f)).toBe(true);
    expect(fameOffer.value).toEqual({ seed: 'pierogi-731', day: 134, cash: 1_012_345 });
    expect(f.play).toHaveBeenCalledWith('coins');
    expect(f.confetti).toHaveBeenCalledTimes(1);
  });

  it('bieg rankingowy nigdy nie otwiera gratulacji ani wpisu, ale zdarzenie jest obsłużone (nie ma z niego zwykłego okna „OK”)', () => {
    const f = fx();
    expect(offerFame(MILLION, session({ mode: 'ranked' }), {}, f)).toBe(true);
    expect(fameOffer.value).toBeNull();
    expect(f.play).not.toHaveBeenCalled();
    expect(f.confetti).not.toHaveBeenCalled();
  });

  it('seed, którego wpis serwer już przyjął (meta.fameSent), nie dostaje gratulacji drugi raz, choćby `fame` zgubiła stara karta; inny seed dostaje', () => {
    const f = fx();
    expect(offerFame(MILLION, session(), { fameSent: ['bigos-111', 'pierogi-731'] }, f)).toBe(true);
    expect(fameOffer.value).toBeNull();
    expect(f.confetti).not.toHaveBeenCalled();
    expect(offerFame(MILLION, session(), { fameSent: ['bigos-111'] }, f)).toBe(true);
    expect(fameOffer.value).toEqual({ seed: 'pierogi-731', day: 134, cash: 1_012_345 });
  });

  it('zdarzenie bez dnia albo gotówki (zepsute parametry) jest połknięte, nic się nie otwiera', () => {
    const f = fx();
    for (const params of [undefined, {}, { day: 134 }, { cash: 1e6 }, { day: '134', cash: 1e6 }]) {
      expect(offerFame({ kind: 'million', ...(params ? { params: params as Record<string, number> } : {}) }, session(), {}, f)).toBe(true);
    }
    expect(fameOffer.value).toBeNull();
  });
});
