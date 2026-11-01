import { expect } from 'vitest';
import type { CommandEffects } from '@/game/actions';
import { createSession, firmOf, pointAtActive, type GameSession } from '@/game/session';
import { MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from '@/sim/economy/catalog';
import { awaitingDecision, type EconomyState } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { applyFirmCommand } from '@/sim/firm/commands';
import { activeStore, applyStoreCommand, emptyStepOut, stepFirmMinute, syncWallet } from '@/sim/firm/firm';
import type { FirmState, FirmStepOut, FirmStore } from '@/sim/firm/types';

/*
 * Wspólne klocki testów sesji z firmą (src/game, src/ui): sesja ze statusem Partnera, drugi sklep otwarty prawdziwymi poleceniami
 * i krok firmy z odpowiedziami na karty. Liczą przez sim (`stepFirmMinute`), a nie przez `advanceSession`, żeby testy pętli klatek
 * miały niezależne źródło stanu.
 */

export const SEED = 'kiełbasa-42';
export const DAY = MINUTES_PER_DAY;
/** Minuty zamknięcia września (dzień 29) i października (dzień 60): w tym kroku `closeDay` zamyka też miesiąc. */
export const SEPT_CLOSE = 29 * DAY + OPEN_TO;
export const OCT_CLOSE = 60 * DAY + OPEN_TO;

/** Efekty, które nic nie robią: polecenie przechodzi przez `dispatchCommand`/`dispatchFirm` bez śladów. */
export const NO_FX: CommandEffects = {
  play: () => {}, buzz: () => {}, toast: () => {}, confetti: () => {}, handleEvents: () => {}, persist: () => {}, clearSelection: () => {},
  rebuildScene: () => {}, notice: () => {}, refresh: () => {},
};

/** Sesja zwykłej gry (świeża, bez premii sieci) ze statusem Partnera i gotówką na pakiet. */
export function partnerSession(seed = SEED, wallet = 200_000): GameSession {
  const s = createSession(seed, true);
  const f = firmOf(s);
  f.person.partner = true;
  f.person.wallet = wallet;
  syncWallet(f);
  return s;
}

/** Gracz klika „OK” na kartach aktywnego sklepu (odpowiedź zaznaczona z góry). */
export function answerActive(f: FirmState): void {
  const st = activeStore(f);
  while (awaitingDecision(st.econ)) {
    const card = visibleCards(st.econ.tycoon.cards, st.econ.minute)[0]!;
    expect(applyStoreCommand(f, { type: 'answerCard', seq: card.seq, answer: defaultAnswer(card) }).result.ok).toBe(true);
  }
}

/** Jedna minuta firmy: odpowiedzi na karty aktywnego, krok, a sesja idzie za aktywnym sklepem. */
export function tick(s: GameSession, out: FirmStepOut = emptyStepOut()): FirmStepOut {
  const f = firmOf(s);
  answerActive(f);
  stepFirmMinute(f, out);
  pointAtActive(s);
  return out;
}

export function playTo(s: GameSession, minute: number, out: FirmStepOut = emptyStepOut()): FirmStepOut {
  const f = firmOf(s);
  while (activeStore(f).econ.minute < minute && f.over === null && !activeStore(f).econ.gameOver) tick(s, out);
  return out;
}

/** Sklep #2 w pierwszym wolnym lokalu: wynajem, budowa i otwarcie o 6:00 w dniu odbioru (krok sklepów jeszcze nie poszedł). */
export function openSecond(s: GameSession, pay: 'gotowka' | 'raty' = 'raty'): FirmStore {
  const f = firmOf(s);
  const lotId = f.city.lots.find((l) => l.state === 'wolny')!.id;
  expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay }, emptyStepOut())).toEqual({ ok: true });
  const ready = f.builds[f.builds.length - 1]!.readyDay * DAY + OPEN_FROM;
  playTo(s, ready);
  tick(s);   // w minucie odbioru firma otwiera budowę przed krokiem sklepów
  expect(f.stores).toHaveLength(2);
  return f.stores[1]!;
}

/** Sklep, któremu Centrala wypowie umowę przy najbliższym zamknięciu miesiąca: zaufanie przy zerze i strata miesiąca. */
export function loseTrust(e: EconomyState): void {
  e.tycoon.trust.value = 3;
  e.franchisee.month = { margin: 0, bonus: 0, pallets: 0, wages: 40_000, media: 0 };
}
