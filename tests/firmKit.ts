import { expect } from 'vitest';
import type { CommandEffects } from '@/game/actions';
import { createSession, firmOf, pointAtActive, type GameSession } from '@/game/session';
import { MINUTES_PER_DAY, OPEN_FROM, OPEN_TO } from '@/sim/economy/catalog';
import { awaitingDecision, type EconomyState } from '@/sim/economy/economy';
import { defaultAnswer } from '@/sim/economy/monthPreview';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { closeStore } from '@/sim/firm/closure';
import { applyFirmCommand, lotState, openDueBuilds, rentRefusal, switchStore } from '@/sim/firm/commands';
import { activeStore, applyStoreCommand, emptyStepOut, grantToFirm, stepFirmMinute, syncWallet } from '@/sim/firm/firm';
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

/**
 * Kolejny sklep (`count`-ty z kolei) w pierwszym lokalu, który wynajem przyjmuje: wynajem, budowa i otwarcie o 6:00 w dniu odbioru
 * (krok sklepów jeszcze nie poszedł). Lokal bierze `rentRefusal`, więc pakiet na raty nie przekracza limitu rat nowego sklepu.
 */
function openNext(s: GameSession, pay: 'gotowka' | 'raty', count: number): FirmStore {
  const f = firmOf(s);
  const free = f.city.lots.filter((l) => lotState(f, l.id) === 'wolny');
  const lotId = (free.find((l) => rentRefusal(f, l.id, pay) === null) ?? free[0]!).id;   // gdy żaden nie przechodzi, polecenie niżej pokaże powód
  expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay }, emptyStepOut())).toEqual({ ok: true });
  const ready = f.builds[f.builds.length - 1]!.readyDay * DAY + OPEN_FROM;
  playTo(s, ready);
  tick(s);   // w minucie odbioru firma otwiera budowę przed krokiem sklepów
  expect(f.stores).toHaveLength(count);
  return f.stores[count - 1]!;
}

/** Sklep #2 w pierwszym wolnym lokalu. */
export const openSecond = (s: GameSession, pay: 'gotowka' | 'raty' = 'raty'): FirmStore => openNext(s, pay, 2);

/** Sklep #3 (limit 4a.2) w pierwszym lokalu wolnym po otwarciu #2. */
export const openThird = (s: GameSession, pay: 'gotowka' | 'raty' = 'raty'): FirmStore => openNext(s, pay, 3);

/** Wyposażenie, które `fitStore` zostawia w sklepie (jeden remont): remont 1, dwie kasy samoobsługowe, ulepszenia na poziomach 3 + 1. */
export const FITTINGS_LEFT = { remontLevel: 1, equipment: 2, upgrades: 4 } as const;

/**
 * Wyposażenie sklepu `id` prawdziwymi poleceniami (sklep staje się aktywny): ulotki na 3. poziom, szkolenie, dwie kasy samoobsługowe i `remonts`
 * remontów (1–3), więc `layout` sklepu rośnie prawdziwą drogą `startRemont` (większa sala, więcej klientów). Między remontami ekipa „kończy”
 * pracę (`remontUntil = null`), bo kolejny remont rusza dopiero po poprzednim.
 */
export function fitStore(f: FirmState, id: number, remonts = 1): void {
  expect(switchStore(f, id)).toEqual({ ok: true });
  grantToFirm(f, (e) => { e.level = 20; e.cash += 600_000; });
  const buy = [
    ...[1, 2, 3].map(() => ({ type: 'buyUpgrade', id: 'ulotki' }) as const),
    { type: 'buyUpgrade', id: 'szkolenie' } as const,
    ...[1, 2].map(() => ({ type: 'buyEquipment', id: 'sco' }) as const),
  ];
  for (const cmd of buy) expect(applyStoreCommand(f, cmd).result.ok, JSON.stringify(cmd)).toBe(true);
  for (let i = 0; i < remonts; i++) {
    const outcome = applyStoreCommand(f, { type: 'startRemont' });
    expect(outcome.result.ok, `remont ${i + 1}`).toBe(true);
    expect(outcome.layoutChanged).toBe(true);
    activeStore(f).econ.remontUntil = null;
  }
}

/**
 * Sklep `id` wyposażony (`fitStore`) i zamknięty przez Centralę (zaufanie 0, prawdziwe `closeStore`) przy działającym innym sklepie: jego lokal
 * to „po Traszce” z układem po remoncie i wyposażeniem. Sesja musi mieć już drugi sklep (`openSecond`).
 */
export function closeStoreFitted(s: GameSession, id: number, remonts = 1): FirmState {
  const f = firmOf(s);
  fitStore(f, id, remonts);
  closeStore(f, id, 'trust', emptyStepOut());
  expect(f.stores.find((st) => st.id === id)!.closed).toBe(true);
  pointAtActive(s);
  return f;
}

/** Sklep #1 zamknięty przez Centralę przy działającym #2: lokal startowy to „po Traszce” (wyposażenie: `FITTINGS_LEFT`). */
export const closeFirstStore = (s: GameSession, remonts = 1): FirmState => closeStoreFitted(s, 1, remonts);

/** Firma po zamknięciu sklepu #1 przy działającym #2 (`partnerSession`, `openSecond`, `closeFirstStore`): lokal startowy jest „po Traszce”. */
export function reletFirm(seed = SEED, remonts = 1): FirmState {
  const s = partnerSession(seed);
  openSecond(s, 'raty');
  return closeFirstStore(s, remonts);
}

/**
 * Ponowny wynajem lokalu „po Traszce” za gotówkę: wynajem, gra do dnia odbioru i otwarcie budowy o 6:00. Zwraca sklep zaraz po otwarciu
 * (zdarzenie `opened` z `reopened`), jeszcze bez kroku sklepów, więc jego ekonomia jest taka, jaką dała `reopenStoreAt`.
 */
export function reopenLot(s: GameSession, lotId: number): FirmStore {
  const f = firmOf(s);
  expect(applyFirmCommand(f, { type: 'rentLot', lotId, pay: 'gotowka' }, emptyStepOut())).toEqual({ ok: true });
  playTo(s, f.builds[f.builds.length - 1]!.readyDay * DAY + OPEN_FROM);
  const out = emptyStepOut();
  openDueBuilds(f, out);
  expect(out.firm.some((e) => e.kind === 'opened' && e.params?.reopened === 1)).toBe(true);
  const st = f.stores.find((x) => x.lotId === lotId)!;
  expect(st.closed).toBe(false);
  pointAtActive(s);
  return st;
}

/** Sklep, któremu Centrala wypowie umowę przy najbliższym zamknięciu miesiąca: zaufanie przy zerze i strata miesiąca. */
export function loseTrust(e: EconomyState): void {
  e.tycoon.trust.value = 3;
  e.franchisee.month = { margin: 0, bonus: 0, pallets: 0, wages: 40_000, media: 0 };
}
