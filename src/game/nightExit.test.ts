import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffCrew } from '@/render/staff/crew';
import { MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from '@/sim/economy/catalog';
import { staffOnShift } from '@/sim/economy/tycoon/shift';
import { advanceSession } from './frame';
import { MemoryStorage } from './memoryStorage';
import { palletRefsOf } from './palletRefs';
import { createSession } from './session';

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); });
afterEach(() => { vi.unstubAllGlobals(); });

/**
 * Noc tak jak w grze: klatki 60 Hz, ekonomia przez `advanceSession`, załoga dostaje `staffOnShift` co ~100 ms i czas
 * widoku razy prędkość (jak w `scene.ts`). Karty z drogi zdejmujemy, bo tu liczy się sam zegar. Zwraca, po ilu sekundach
 * realnych od zamknięcia sklep był pusty, i ile trwała noc.
 */
function night(speed: number): { emptyAfter: number | null; night: number; atClose: number } {
  const session = createSession('traszka-noc', true);
  const s = session.econ;
  s.staff = 3;
  s.minute = OPEN_TO - 30;
  s.tycoon.cards.pending = [];
  const crew = new StaffCrew(session.layout);
  const sync = (): void => crew.sync({ people: staffOnShift(s), minute: s.minute, pallets: palletRefsOf(s, session.info) });
  sync();
  const reopen = (Math.floor(s.minute / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY + OPEN_FROM;
  const dt = 1 / 60;
  let real = 0, sinceSync = 0, closedAt: number | null = null, emptyAt: number | null = null, atClose = 0;
  while (s.minute < reopen && real < 600) {
    advanceSession(session, dt, speed, false, []);
    s.tycoon.cards.pending = s.tycoon.cards.pending.filter((c) => c.showAt > s.minute);
    real += dt;
    sinceSync += dt;
    if (sinceSync >= 0.1) { sync(); sinceSync = 0; }
    crew.step(dt * speed);
    if (closedAt === null && s.minute % MINUTES_PER_DAY >= OPEN_TO) { closedAt = real; atClose = crew.members.length; }
    if (closedAt !== null && emptyAt === null && crew.members.length === 0) emptyAt = real;
  }
  return { emptyAfter: emptyAt === null || closedAt === null ? null : emptyAt - closedAt, night: closedAt === null ? 0 : real - closedAt, atClose };
}

describe('noc: zmiana wychodzi ze sklepu, zanim znów się otworzy (decyzja właściciela z 29.10.2026)', () => {
  it.each([1, 8])('przy ×%i sklep pustoszeje w pierwszej połowie nocy', (speed) => {
    const r = night(speed);
    expect(r.atClose).toBe(3);
    expect(r.emptyAfter).not.toBeNull();
    expect(r.emptyAfter!).toBeLessThan(r.night / 2);
    expect(r.night * speed).toBeCloseTo(30, 0);   // noc trwa 30 s czasu widoku przy każdej prędkości
  });
});
