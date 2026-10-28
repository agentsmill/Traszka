import { describe, expect, it } from 'vitest';
import { NOTICE_MAX_READ_MS, NOTICE_MIN_READ_MS, noticeLevel, pausesGame, readMs } from './notices';

describe('komunikaty: co zatrzymuje grę, a co tylko informuje', () => {
  it('karta decyzji zatrzymuje grę do wyboru, ważne zdarzenia fabularne do „OK”, reszta to informacja', () => {
    expect(noticeLevel('card')).toBe('decision');
    for (const k of ['month', 'report', 'remont', 'gameover', 'trust-tier'] as const) expect(noticeLevel(k), k).toBe('story');
    for (const k of ['delivery', 'order', 'fine', 'day', 'card-result', 'kpi-week', 'golden', 'warning'] as const) {
      expect(noticeLevel(k), k).toBe('info');
    }
    expect(pausesGame('decision') && pausesGame('story')).toBe(true);
    expect(pausesGame('info')).toBe(false);
  });

  it('nowy poziom zatrzymuje grę tylko wtedy, gdy coś odblokowuje', () => {
    expect(noticeLevel('levelup')).toBe('info');
    expect(noticeLevel('levelup', { unlocks: 2 })).toBe('story');
  });

  it('informacja nie miga: zostaje co najmniej 4 s czasu rzeczywistego, dłuższy tekst dłużej, ale z górną granicą', () => {
    expect(readMs('Dostawa: 3 palety.')).toBe(NOTICE_MIN_READ_MS);
    expect(readMs('x'.repeat(120))).toBe(7200);
    expect(readMs('x'.repeat(5000))).toBe(NOTICE_MAX_READ_MS);
  });
});
