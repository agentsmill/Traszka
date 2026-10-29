import { describe, expect, it } from 'vitest';
import { STAFF_MAX } from '@/sim/economy/catalog';
import type { ShiftTask } from '@/sim/economy/tycoon/shift';
import type { StaffTask } from '@/sim/economy/tycoon/staff';
import { STAFF_VIEW_MAX, type StaffAssignment, type StaffDuty } from './types';

describe('typy wspólne warstwy ludzi', () => {
  it('STAFF_VIEW_MAX to STAFF_MAX: widok pomieści tylu ludzi, ilu ekonomia dopuszcza', () => {
    expect(STAFF_VIEW_MAX).toBe(STAFF_MAX);
  });

  it('zadanie z widoku to zadanie z puli ludzi i „wolny”, więc wynik staffOnShift wchodzi do widoku bez konwersji', () => {
    const duty: StaffDuty = 'wolny' satisfies ShiftTask;
    const task: StaffTask = 'kasa';
    const asDuty: StaffDuty = task;
    const person: StaffAssignment = { id: 0, task: 'sprzatanie' satisfies ShiftTask };
    const back: ShiftTask = person.task;
    expect([duty, asDuty, back]).toEqual(['wolny', 'kasa', 'sprzatanie']);
  });
});
