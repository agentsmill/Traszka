import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/game/memoryStorage';
import { createEconomy, stepMinute, type EconEvent, type EconomyState, type MonthReport } from '@/sim/economy/economy';
import { MILESTONES } from '@/sim/economy/milestones';
import { computeStoreInfo, type StoreInfo } from '@/sim/economy/storeInfo';
import { visibleCards } from '@/sim/economy/tycoon/cards';
import { layoutFor } from '@/sim/store/layoutFor';
import { loadTutorial, type TutorialMemory } from './memory';
import { dismissTip, settleTips, showTip, shownTip, tipsFor, type TipCtx } from './tips';

const SEED = 'dymki-1';
function game(seed = SEED): { s: EconomyState; info: StoreInfo } {
  const info = computeStoreInfo(layoutFor(seed, 0));
  return { s: createEconomy(seed, info), info };
}
const ctxOf = (s: EconomyState, over: Partial<TipCtx> = {}): TipCtx => ({
  s, tab: null, report: null, remanentOpen: false, storyOpen: false, windowOpen: false, offerOpen: false, tourVisible: false, ...over,
});
const MEM: TutorialMemory = { v: 1, tour: 'done', seen: [], tips: true };
const ids = (ctx: TipCtx, mem: TutorialMemory = MEM): string[] => tipsFor(ctx, mem).map((t) => t.id);
const withReport = { statement: {} } as unknown as MonthReport;

/** Gra przewinięta do pierwszej widocznej karty decyzji (stepMinute nie staje na kartach, więc liczymy sami). */
function untilCard(g: { s: EconomyState; info: StoreInfo }): void {
  const events: EconEvent[] = [];
  for (let i = 0; i < 3 * 1440 && visibleCards(g.s.tycoon.cards, g.s.minute).length === 0; i++) stepMinute(g.s, g.info, events);
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); shownTip.value = null; });
afterEach(() => { vi.unstubAllGlobals(); shownTip.value = null; });

describe('warunki dymków na prawdziwym stanie', () => {
  it('nowa gra o 6:00: żaden dymek', () => {
    expect(ids(ctxOf(game().s))).toEqual([]);
  });

  it('cel do odebrania: 🎁 w pasku, a przy otwartych Celach „Odbierz” (z zakładką jako zapasem)', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    const closed = tipsFor(ctxOf(s), MEM)[0]!;
    expect(closed).toMatchObject({ id: 'tip-cel', inWindow: false, targets: ['claim'] });
    expect(closed.text).toContain('🎁');
    const open = tipsFor(ctxOf(s, { tab: 'cele' }), MEM)[0]!;
    expect(open.targets).toEqual(['claim-btn', 'tab-cele']);
    expect(open.text).toContain('„Odbierz”');
  });

  it('paleta w przejściu: zakładka Palety, a przy otwartych Paletach sama paleta', () => {
    const { s } = game();
    s.pallets[0]!.loc = 'aisle';
    expect(tipsFor(ctxOf(s), MEM)[0]).toMatchObject({ id: 'tip-przejscia', targets: ['tab-palety'] });
    expect(tipsFor(ctxOf(s, { tab: 'palety' }), MEM)[0]!.targets).toEqual(['pallet-aisle', 'tab-palety']);
  });

  it('pierwsza karta w pierwszym miesiącu: dymek nad oknem karty', () => {
    const g = game();
    untilCard(g);
    expect(visibleCards(g.s.tycoon.cards, g.s.minute).length).toBeGreaterThan(0);
    expect(tipsFor(ctxOf(g.s), MEM)[0]).toMatchObject({ id: 'tip-karta', inWindow: true, targets: ['card'] });
  });

  it('karta po pierwszym miesiącu albo zasłonięta raportem, protokołem czy wpisem „OK”: bez dymka karty', () => {
    const g = game();
    untilCard(g);
    expect(ids(ctxOf(g.s, { storyOpen: true }))).not.toContain('tip-karta');
    expect(ids(ctxOf(g.s, { remanentOpen: true }))).not.toContain('tip-karta');
    expect(ids(ctxOf(g.s, { report: withReport }))).not.toContain('tip-karta');
    g.s.history.push({ label: 'wrzesień', profit: 0, revenue: 0 });
    expect(ids(ctxOf(g.s))).not.toContain('tip-karta');
  });

  it('wyciąg od Centrali: nad raportem z wyciągiem, wskazuje „Zostaje Ci”, a tytuł okna to zapas', () => {
    const { s } = game();
    expect(tipsFor(ctxOf(s, { report: withReport, windowOpen: true }), MEM)[0]).toMatchObject({ id: 'tip-wyciag', inWindow: true, targets: ['zostaje-ci', 'report'] });
    expect(ids(ctxOf(s, { report: { statement: null } as unknown as MonthReport, windowOpen: true }))).toEqual([]);   // stary raport bez wyciągu
    expect(ids(ctxOf(s, { report: withReport, remanentOpen: true, windowOpen: true }))).toEqual(['tip-remanent']);   // protokół leży nad raportem
  });

  it('remanent: nad protokołem, wskazuje zdanie o nadwyżce', () => {
    const { s } = game();
    expect(tipsFor(ctxOf(s, { remanentOpen: true, windowOpen: true }), MEM)[0]).toMatchObject({ id: 'tip-remanent', targets: ['remanent-verdict'] });
  });

  it('po końcu gry: żadnych dymków', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    s.gameOver = true;
    expect(ids(ctxOf(s, { report: withReport, remanentOpen: true }))).toEqual([]);
  });
});

describe('kolejność, pamięć i okna', () => {
  it('kilka naraz: w kolejności ze specu', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    s.pallets[0]!.loc = 'aisle';
    expect(ids(ctxOf(s))).toEqual(['tip-cel', 'tip-przejscia']);
  });

  it('dymek, który już był, nie wraca; wyłączone podpowiedzi to brak dymków', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    expect(ids(ctxOf(s), { ...MEM, seen: ['tip-cel'] })).toEqual([]);
    expect(ids(ctxOf(s), { ...MEM, tips: false })).toEqual([]);
  });

  it('pod oknem wyboru i przy widocznym przelocie: nic', () => {
    const { s } = game();
    s.milestonesReady.push(MILESTONES[0]!.id);
    expect(ids(ctxOf(s, { offerOpen: true }))).toEqual([]);
    expect(ids(ctxOf(s, { tourVisible: true }))).toEqual([]);
  });

  it('zwykły dymek czeka pod oknem gry i przy czekającej karcie, a dymek „w oknie” wtedy właśnie się pokazuje', () => {
    const g = game();
    g.s.milestonesReady.push(MILESTONES[0]!.id);
    expect(ids(ctxOf(g.s, { windowOpen: true }))).toEqual([]);
    untilCard(g);
    expect(ids(ctxOf(g.s))).toEqual(['tip-karta']);
  });
});

describe('dymek na ekranie', () => {
  it('„OK” zapisuje dymek jako widziany i go chowa', () => {
    showTip('tip-cel');
    dismissTip();
    expect(shownTip.value).toBeNull();
    expect(loadTutorial().seen).toEqual(['tip-cel']);
  });

  it('rozwiązane zdarzenie (dymek wypadł z kandydatów) też trafia do widzianych', () => {
    showTip('tip-przejscia');
    settleTips([{ id: 'tip-przejscia', inWindow: false, targets: [], text: '' }]);
    expect(shownTip.value).toBe('tip-przejscia');
    settleTips([]);
    expect(shownTip.value).toBeNull();
    expect(loadTutorial().seen).toEqual(['tip-przejscia']);
  });
});

describe('teksty dymków', () => {
  it('bez opłaty franczyzowej, „do oddania” i WUT', () => {
    const g = game();
    g.s.milestonesReady.push(MILESTONES[0]!.id);
    g.s.pallets[0]!.loc = 'aisle';
    const all = [
      ...tipsFor(ctxOf(g.s), MEM), ...tipsFor(ctxOf(g.s, { tab: 'cele' }), MEM), ...tipsFor(ctxOf(g.s, { tab: 'palety' }), MEM),
      ...tipsFor(ctxOf(g.s, { report: withReport, windowOpen: true }), MEM), ...tipsFor(ctxOf(g.s, { remanentOpen: true, windowOpen: true }), MEM),
    ].map((t) => t.text).join('\n').toLowerCase();
    expect(all).not.toContain('franczyzow');
    expect(all).not.toContain('do oddania');
    expect(all).not.toMatch(/\bwut\b/);
    expect(all).toContain('co 3 miesiące');
  });
});
