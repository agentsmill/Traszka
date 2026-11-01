import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lang } from '@/i18n';
import { EN_REMONTS } from '@/i18n/en/content';
import { PL_CHARS } from '../../../tests/i18nScan';
import { partnerSession } from '../../../tests/firmKit';
import { createSession, firmOf } from '@/game/session';
import { RIVAL_RADIUS_M } from '@/sim/city/traffic';
import { lotById } from '@/sim/city/generateCity';
import { planFor } from '@/sim/economy/franchisee';
import { applyFirmCommand, partnerProgress } from '@/sim/firm/commands';
import { emptyStepOut } from '@/sim/firm/firm';
import type { FirmCommand, FirmCommandResult } from '@/sim/firm/commands';
import { MAX_STORES, type FirmRefusal, type FirmState } from '@/sim/firm/types';
import { cityLayer, firm, lotPay, selectedLot, tab, toasts, type GameActions } from '../state';
import { zl } from '../game/format';
import { buttonAria, buttonLabelled, buttonsOf, click, labels, textOf, walk, type Vnode } from '../game/vnodeTree';
import { CityBar, CityPanel, LotList } from './CityPanel';
import { LotCard } from './LotCard';
import { SWIPE_MIN_PX, freeLotRows, lotCardModel } from './cityModel';
import { brandName, districtName, levelText, lotKindName, lotStateName, progressText, refusalText, sourceText } from './cityText';
import { addressText } from './firmText';

/*
 * Ekran Miasta (spec §9): pasek statusu, lista wolnych lokali i karta lokalu. Komponenty nie mają haków, więc wołamy je jak funkcje
 * i oglądamy drzewo vnode; panel składa je z `firm` i sygnałów ekranu (`cityLayer`, `selectedLot`, `lotPay`).
 */

const SEED = 'kiełbasa-42';

function fakeGame(result: FirmCommandResult = { ok: true }): GameActions & { firm: ReturnType<typeof vi.fn<(cmd: FirmCommand) => FirmCommandResult>> } {
  return {
    dispatch: vi.fn(() => ({ ok: true })),
    claimWelcome: vi.fn(), openNextStore: vi.fn(), setSound: vi.fn(), setVibration: vi.fn(), restart: vi.fn(), newStore: vi.fn(),
    startRanked: vi.fn(() => false), resumeRanked: vi.fn(() => false), leaveRanked: vi.fn(), abandonRanked: vi.fn(),
    openFinish: vi.fn(), rememberNick: vi.fn(),
    firm: vi.fn<(cmd: FirmCommand) => FirmCommandResult>(() => result),
  } as GameActions & { firm: ReturnType<typeof vi.fn<(cmd: FirmCommand) => FirmCommandResult>> };
}

const partnerFirm = (seed = SEED, wallet = 200_000): FirmState => firmOf(partnerSession(seed, wallet));
const plainFirm = (seed = SEED): FirmState => firmOf(createSession(seed, true));
const rowsOf = (f: FirmState) => freeLotRows(f.seed, f);
const bar = (f: FirmState): Vnode => CityBar({ f, v: 1 }) as Vnode;
const list = (f: FirmState): Vnode => LotList({ f, v: 1 }) as Vnode;
const card = (f: FirmState, lotId: number, game: GameActions = fakeGame()): Vnode => LotCard({ f, lotId, game, v: 1 }) as Vnode;
const byTut = (tree: Vnode, tut: string): Vnode => {
  const found = walk(tree).filter((v) => v.props['data-tut'] === tut);
  if (found.length !== 1) throw new Error(`Elementów data-tut="${tut}": ${found.length}, oczekiwano jednego.`);
  return found[0]!;
};
const rowFor = (f: FirmState, district: string) => rowsOf(f).find((r) => r.district === district)!;

function resetSignals(): void {
  cityLayer.value = 'ruch';
  selectedLot.value = null;
  lotPay.value = 'gotowka';
  firm.value = null;
  tab.value = null;
  toasts.value = [];
}
beforeEach(resetSignals);
afterEach(() => { resetSignals(); lang.value = 'pl'; vi.useRealTimers(); });

describe('pasek miasta (data-tut="city-status")', () => {
  it('bez statusu mówi, czego brakuje: miesiące z zyskiem i zaufanie', () => {
    const f = plainFirm();
    const s = f.stores[0]!.econ;
    s.history.push({ label: 'wrzesień', profit: 4_000, revenue: 90_000, transfer: 20_000 } as never);
    s.tycoon.trust.value = 68;
    const tree = bar(f);
    const status = byTut(tree, 'city-status');
    expect(textOf(status)).toContain('jeszcze 1 miesiąc z zyskiem · zaufanie 68/75');
    expect(textOf(status)).toContain('Partner Strategiczny');
    expect(progressText(partnerProgress(f))).toBe('jeszcze 1 miesiąc z zyskiem · zaufanie 68/75');
  });

  it('brak historii to dwa miesiące, a gdy zysk już jest, zostaje samo zaufanie', () => {
    const f = plainFirm();
    expect(progressText(partnerProgress(f))).toMatch(/^jeszcze 2 miesiące z zyskiem · zaufanie \d+\/75$/);
    f.stores[0]!.econ.history.push({ label: 'a', profit: 1, revenue: 0, transfer: 0 } as never, { label: 'b', profit: 1, revenue: 0, transfer: 0 } as never);
    f.stores[0]!.econ.tycoon.trust.value = 60;
    expect(progressText(partnerProgress(f))).toBe('zaufanie 60/75');
  });

  it('ze statusem mówi, że status jest, i ile placówek już stoi z limitu', () => {
    const f = partnerFirm();
    const text = textOf(byTut(bar(f), 'city-status'));
    expect(text).toContain('Partner Strategiczny');
    expect(text).toContain(progressText({ kind: 'granted' }));
    expect(textOf(bar(f))).toContain(`placówki 1/${MAX_STORES}`);
  });

  it('w rankingu pasek mówi tekst rankingowy Centrali, a nie „Partner Strategiczny”', () => {
    const f = plainFirm();
    f.ranked = true;   // w rankingu status nie przychodzi nigdy
    const text = textOf(byTut(bar(f), 'city-status'));
    expect(text).toContain('W sezonie rankingowym Centrala ocenia jedną placówkę. Prosimy wrócić po sezonie.');
    expect(text).not.toContain('Partner Strategiczny');
  });

  it('pokazuje nazwę miasta, a przełącznik „Ruch / Dzielnice” zmienia warstwę', () => {
    const f = partnerFirm();
    const tree = bar(f);
    expect(textOf(tree)).toContain(f.city.name);
    expect(labels(tree)).toEqual(expect.arrayContaining(['Ruch', 'Dzielnice']));
    expect(buttonLabelled(tree, 'Ruch').props['aria-pressed']).toBe(true);
    click(buttonLabelled(tree, 'Dzielnice'));
    expect(cityLayer.value).toBe('dzielnice');
    expect(buttonLabelled(bar(f), 'Dzielnice').props['aria-pressed']).toBe(true);
    click(buttonLabelled(bar(f), 'Ruch'));
    expect(cityLayer.value).toBe('ruch');
  });

  it('legenda zależy od warstwy: ruch ma skalę od cichego do tłocznego, dzielnice cztery nazwy', () => {
    const f = partnerFirm();
    const traffic = textOf(bar(f));
    expect(traffic).toContain('mały ruch');
    expect(traffic).toContain('duży ruch');
    cityLayer.value = 'dzielnice';
    const districts = textOf(bar(f));
    for (const d of ['osiedle', 'srodmiescie', 'dworzec', 'biurowce', 'park'] as const) expect(districts).toContain(districtName(d));
  });
});

describe('lista wolnych lokali', () => {
  it('ma wiersz dla każdego wolnego lokalu: numer, adres, dzielnica, format, metraż, widełki i pakiet', () => {
    const f = partnerFirm();
    const rows = rowsOf(f);
    const tree = list(f);
    expect(textOf(tree)).toContain(`Wolne lokale (${rows.length})`);
    const buttons = buttonsOf(tree);
    expect(buttons).toHaveLength(rows.length);
    rows.forEach((r, i) => {
      const text = textOf(buttons[i]!);
      expect(text, `lokal ${r.no}`).toContain(String(r.no));
      expect(text).toContain(addressText(r.street, r.number));
      expect(text).toContain(districtName(r.district));
      expect(text).toContain(lotKindName(r.kind, r.corner, r.district));
      expect(text).toContain(`${r.area} m²`);
      expect(text).toContain(`${r.lo}–${r.hi}`);
      expect(text).toContain(zl(r.price));
    });
  });

  it('nie pokazuje lokali zajętych, konkurencji, własnych ani lokalu obok', () => {
    const f = partnerFirm();
    const shown = buttonsOf(list(f)).map((b) => b.props['data-lot']);
    expect(shown).toEqual(rowsOf(f).map((r) => r.lotId));
    for (const l of f.city.lots.filter((x) => x.state !== 'wolny')) expect(shown).not.toContain(l.id);
  });

  it('stuknięcie w wiersz wybiera lokal i zaznacza wiersz', () => {
    const f = partnerFirm();
    const rows = rowsOf(f);
    click(buttonsOf(list(f))[2]!);
    expect(selectedLot.value).toBe(rows[2]!.lotId);
    expect(buttonsOf(list(f))[2]!.props['aria-pressed']).toBe(true);
    expect(buttonsOf(list(f))[1]!.props['aria-pressed']).toBe(false);
  });

  it('bez wolnych lokali mówi to wprost', () => {
    const f = partnerFirm();
    for (const l of f.city.lots) if (l.state === 'wolny') l.state = 'zajety';
    expect(textOf(list(f))).toContain('Brak wolnych lokali');
  });
});

describe('karta lokalu', () => {
  it('pokazuje adres, dzielnicę, widełki klientów, kto przychodzi, poziomy słowami i czas budowy', () => {
    const f = partnerFirm();
    const row = rowFor(f, 'srodmiescie');
    const model = lotCardModel(SEED, f, row.lotId, 'gotowka');
    const text = textOf(card(f, row.lotId));
    expect(text).toContain(addressText(row.street, row.number));
    expect(text).toContain(districtName('srodmiescie'));
    expect(text).toContain(`${row.lo}–${row.hi}`);
    expect(text).toContain(model.who.map(sourceText).join(', '));
    expect(text).toContain(`Koszyk${levelText(model.basket, true)}`);
    expect(text).toContain(`Oczekiwania${levelText(model.expectations)}`);
    expect(text).toContain(`Kradzieże${levelText(model.theft)}`);
    expect(text).toContain(`${model.buildDays} dni`);
  });

  it('pakiet otwarcia (data-tut="lot-price"): „za gotówkę X zł” i „na raty Y zł × 12 z przelewów tego sklepu”', () => {
    const f = partnerFirm();
    const row = rowsOf(f)[0]!;
    const plan = planFor(lotById(f.city, row.lotId).package);
    const price = byTut(card(f, row.lotId), 'lot-price');
    expect(textOf(price)).toContain(`za gotówkę ${zl(row.price)}`);
    expect(textOf(price)).toContain(`na raty ${zl(plan.monthly)} × 12 z przelewów tego sklepu`);
    expect(textOf(price)).toContain(zl(plan.total));   // razem z opłatą
  });

  it('wybór sposobu zapłaty: dwa przyciski ustawiają lotPay i przechodzą do polecenia', () => {
    const f = partnerFirm();
    const row = rowsOf(f)[0]!;
    const price = byTut(card(f, row.lotId), 'lot-price');
    const [cash, instalments] = buttonsOf(price);
    expect(cash!.props['aria-pressed']).toBe(true);
    click(instalments!);
    expect(lotPay.value).toBe('raty');
    expect(buttonsOf(byTut(card(f, row.lotId), 'lot-price'))[1]!.props['aria-pressed']).toBe(true);
    const game = fakeGame();
    click(buttonLabelled(card(f, row.lotId, game), 'Biorę lokal'));
    expect(game.firm).toHaveBeenCalledWith({ type: 'rentLot', lotId: row.lotId, pay: 'raty' });
  });

  it('Dworzec ostrzega: „kradzieże: wysokie, zobaczysz je przy remanencie”; inne dzielnice nie', () => {
    const f = partnerFirm();
    expect(textOf(card(f, rowFor(f, 'dworzec').lotId))).toContain('kradzieże: wysokie, zobaczysz je przy remanencie');
    expect(textOf(card(f, rowFor(f, 'osiedle').lotId))).not.toContain('zobaczysz je przy remanencie');
    expect(textOf(card(f, rowFor(f, 'srodmiescie').lotId))).not.toContain('zobaczysz je przy remanencie');
  });

  it('konkurencja obok to marka i odległość w metrach, a brak konkurencji mówi o promieniu', () => {
    const f = partnerFirm();
    const rows = rowsOf(f);
    const withRivals = rows.find((r) => lotCardModel(SEED, f, r.lotId, 'raty').rivals.length > 0)!;
    const model = lotCardModel(SEED, f, withRivals.lotId, 'raty');
    const text = textOf(card(f, withRivals.lotId));
    for (const r of model.rivals) expect(text).toContain(`${brandName(r.brand)}, ${r.meters} m`);
    const lonely = rows.find((r) => lotCardModel(SEED, f, r.lotId, 'raty').rivals.length === 0)!;
    expect(textOf(card(f, lonely.lotId))).toContain(`brak w promieniu ${RIVAL_RADIUS_M} m`);
  });

  describe('przycisk „Biorę lokal”', () => {
    const lockText = (tree: Vnode): string => textOf(walk(tree).find((v) => String(v.props.class ?? '').includes('tt-lockmsg'))!);

    it('z gotówką i statusem działa: kliknięcie wysyła rentLot z lokalem i sposobem zapłaty, a po sukcesie karta się zamyka', () => {
      const f = partnerFirm();
      const row = rowsOf(f)[0]!;
      selectedLot.value = row.lotId;
      const game = fakeGame();
      const button = buttonLabelled(card(f, row.lotId, game), 'Biorę lokal');
      expect(button.props.disabled).toBe(false);
      click(button);
      expect(game.firm).toHaveBeenCalledTimes(1);
      expect(game.firm).toHaveBeenCalledWith({ type: 'rentLot', lotId: row.lotId, pay: 'gotowka' });
      expect(selectedLot.value).toBeNull();
    });

    it('odmowa Centrali po kliknięciu zostawia kartę otwartą i mówi powód tekstem Centrali (toast błędu)', () => {
      vi.useFakeTimers();
      const f = partnerFirm();
      const row = rowsOf(f)[0]!;
      selectedLot.value = row.lotId;
      click(buttonLabelled(card(f, row.lotId, fakeGame({ ok: false, reason: 'limit' })), 'Biorę lokal'));
      expect(selectedLot.value).toBe(row.lotId);
      expect(toasts.value).toEqual([expect.objectContaining({ text: refusalText('limit'), kind: 'error' })]);
      // ten sam tekst od powłoki gry (dispatchFirm) nie robi drugiego toastu
      click(buttonLabelled(card(f, row.lotId, fakeGame({ ok: false, reason: 'limit' })), 'Biorę lokal'));
      expect(toasts.value).toHaveLength(1);
    });

    it('udany wynajem nie dokłada toastu błędu', () => {
      const f = partnerFirm();
      const row = rowsOf(f)[0]!;
      click(buttonLabelled(card(f, row.lotId, fakeGame()), 'Biorę lokal'));
      expect(toasts.value).toEqual([]);
    });

    it.each<[FirmRefusal, string, () => FirmState, 'gotowka' | 'raty']>([
      ['status', 'Centrala rozważy kolejną placówkę, gdy nada Panu/Pani status Partnera Strategicznego.', () => plainFirm(), 'raty'],
      ['ranked', 'W sezonie rankingowym Centrala ocenia jedną placówkę. Prosimy wrócić po sezonie.', () => Object.assign(plainFirm(), { ranked: true }), 'raty'],
      ['gotowka', 'Po zapłaceniu pakietu gotówka musi zostać nie mniejsza od zera: Centrala nie finansuje budów na debecie.', () => partnerFirm(SEED, 500), 'gotowka'],
    ])('zablokowany tekstem Centrali: %s', (reason, text, make, pay) => {
      const f = make();
      const row = rowsOf(f)[0]!;
      lotPay.value = pay;
      const tree = card(f, row.lotId);
      expect(buttonLabelled(tree, 'Biorę lokal').props.disabled).toBe(true);   // zablokowany przycisk nie wysyła polecenia
      expect(lockText(tree)).toBe(text);
      expect(lockText(tree)).toBe(refusalText(reason));
    });

    it('limit: dwa sklepy wliczając budowę dają zdanie o dwóch placówkach', () => {
      const f = partnerFirm();
      const [first, second] = rowsOf(f);
      expect(applyFirmCommand(f, { type: 'rentLot', lotId: first!.lotId, pay: 'raty' }, emptyStepOut())).toEqual({ ok: true });
      expect(f.builds).toHaveLength(1);
      lotPay.value = 'raty';
      const tree = card(f, second!.lotId);
      expect(buttonLabelled(tree, 'Biorę lokal').props.disabled).toBe(true);
      expect(lockText(tree)).toBe('Dwie placówki to na tym etapie partnerstwa wszystko, na co Centrala jest gotowa się zgodzić.');
    });

    it('raty ponad limit nowego sklepu: zdanie o limicie rat', () => {
      const f = partnerFirm();
      const row = rowsOf(f)[0]!;
      lotById(f.city, row.lotId).package = 150_000;
      lotPay.value = 'raty';
      const tree = card(f, row.lotId);
      expect(buttonLabelled(tree, 'Biorę lokal').props.disabled).toBe(true);
      expect(lockText(tree)).toBe(refusalText('raty'));
    });
  });

  describe('nawigacja', () => {
    it('‹ › idą po wolnych lokalach w kółko i pokazują miejsce na liście', () => {
      const f = partnerFirm();
      const rows = rowsOf(f);
      selectedLot.value = rows[0]!.lotId;
      expect(textOf(card(f, rows[0]!.lotId))).toContain(`lokal 1 z ${rows.length}`);
      click(buttonAria(card(f, rows[0]!.lotId), 'Następny lokal'));
      expect(selectedLot.value).toBe(rows[1]!.lotId);
      click(buttonAria(card(f, rows[1]!.lotId), 'Poprzedni lokal'));
      click(buttonAria(card(f, rows[0]!.lotId), 'Poprzedni lokal'));
      expect(selectedLot.value).toBe(rows[rows.length - 1]!.lotId);
      click(buttonAria(card(f, rows[rows.length - 1]!.lotId), 'Następny lokal'));
      expect(selectedLot.value).toBe(rows[0]!.lotId);
    });

    it('przesunięcie palcem w lewo to następny lokal, w prawo poprzedni, a krótki ruch nic nie robi', () => {
      const f = partnerFirm();
      const rows = rowsOf(f);
      selectedLot.value = rows[1]!.lotId;
      const root = (): Vnode => walk(card(f, rows[1]!.lotId)).find((v) => String(v.props.class ?? '').includes('tt-lotcard'))!;
      const swipe = (from: number, to: number, dy = 0): void => {
        (root().props.onPointerDown as (e: unknown) => void)({ pointerId: 1, clientX: from, clientY: 300 });
        (root().props.onPointerUp as (e: unknown) => void)({ pointerId: 1, clientX: to, clientY: 300 + dy });
      };
      swipe(300, 300 - SWIPE_MIN_PX + 10);
      expect(selectedLot.value).toBe(rows[1]!.lotId);
      swipe(300, 300 - SWIPE_MIN_PX - 20);
      expect(selectedLot.value).toBe(rows[2]!.lotId);
      selectedLot.value = rows[1]!.lotId;
      swipe(100, 100 + SWIPE_MIN_PX + 20);
      expect(selectedLot.value).toBe(rows[0]!.lotId);
    });

    it('✕ zamyka kartę', () => {
      const f = partnerFirm();
      const row = rowsOf(f)[0]!;
      selectedLot.value = row.lotId;
      click(buttonAria(card(f, row.lotId), 'Zamknij'));
      expect(selectedLot.value).toBeNull();
    });
  });

  describe('lokal obok i inne stany', () => {
    /** Firma, której lokal startowy ma sąsiada po stronie remontu (róg rzędu go nie ma). */
    function withNeighbour(): FirmState {
      for (const seed of [SEED, 'a', 'b', 'c', 'd', 'e']) {
        const f = partnerFirm(seed);
        if (f.city.neighbourLotId !== null) return f;
      }
      throw new Error('żaden z seedów testu nie ma lokalu obok');
    }

    it('lokal obok: „Ten lokal zajmiesz remontem „Dokupienie lokalu obok”” i przycisk do Ulepszeń, bez „Biorę lokal”', () => {
      const f = withNeighbour();
      const id = f.city.neighbourLotId!;
      const tree = card(f, id);
      expect(textOf(tree)).toContain('Ten lokal zajmiesz remontem „Dokupienie lokalu obok”');
      expect(labels(tree)).not.toContain('Biorę lokal');
      click(buttonLabelled(tree, 'Do Ulepszeń'));
      expect(tab.value).toBe('ulepszenia');
    });

    it('konkurencja: karta tylko informuje (marka, stan), bez zakupu', () => {
      const f = partnerFirm();
      const rival = f.city.lots.find((l) => l.state === 'konkurencja')!;
      const tree = card(f, rival.id);
      const text = textOf(tree);
      expect(text).toContain(brandName(rival.brand!));
      expect(text).toContain(lotStateName('konkurencja'));
      expect(text).toContain(addressText(rival.street, rival.number));
      expect(labels(tree)).not.toContain('Biorę lokal');
      expect(walk(tree).some((v) => v.props['data-tut'] === 'lot-price')).toBe(false);
    });
  });
});

describe('panel miasta', () => {
  it('bez firmy nie ma nic do pokazania', () => {
    expect(CityPanel({ game: fakeGame() })).toBeNull();
  });

  it('składa pasek i listę, a kartę dopiero po wyborze lokalu', () => {
    const f = partnerFirm();
    firm.value = { f, v: 1 };
    const without = walk(CityPanel({ game: fakeGame() }));
    expect(without.some((v) => v.type === CityBar)).toBe(true);
    expect(without.some((v) => v.type === LotList)).toBe(true);
    expect(without.some((v) => v.type === LotCard)).toBe(false);
    const lotId = rowsOf(f)[3]!.lotId;
    selectedLot.value = lotId;
    const withCard = walk(CityPanel({ game: fakeGame() }));
    expect(withCard.find((v) => v.type === LotCard)!.props.lotId).toBe(lotId);
  });

  it('wybór spoza miasta (id z poprzedniej gry) nie otwiera karty: bez karty i bez has-card, lista zostaje, a nic nie jest zaznaczone', () => {
    const f = partnerFirm();
    firm.value = { f, v: 1 };
    selectedLot.value = f.city.lots.length + 40;
    const tree = CityPanel({ game: fakeGame() }) as Vnode;
    expect(String(tree.props.class)).not.toContain('has-card');
    expect(walk(tree).some((v) => v.type === LotCard)).toBe(false);
    expect(buttonsOf(list(f)).some((b) => b.props['aria-pressed'] === true)).toBe(false);
    expect(LotCard({ f, lotId: selectedLot.value, game: fakeGame(), v: 1 })).toBeNull();
    // ten sam panel z prawidłowym lokalem ma kartę i has-card
    selectedLot.value = rowsOf(f)[0]!.lotId;
    const ok = CityPanel({ game: fakeGame() }) as Vnode;
    expect(String(ok.props.class)).toContain('has-card');
    expect(walk(ok).some((v) => v.type === LotCard)).toBe(true);
  });

  it('w rankingu mapę widać, pasek mówi tekst rankingowy, a wynajem jest odrzucony', () => {
    const f = plainFirm();
    f.ranked = true;
    firm.value = { f, v: 1 };
    const row = rowsOf(f)[0]!;
    selectedLot.value = row.lotId;
    const tree = CityPanel({ game: fakeGame() }) as Vnode;
    expect(walk(tree).some((v) => v.type === LotList)).toBe(true);
    const bartree = bar(f);
    expect(textOf(byTut(bartree, 'city-status'))).toContain(refusalText('ranked'));
    const c = card(f, row.lotId);
    expect(buttonLabelled(c, 'Biorę lokal').props.disabled).toBe(true);
    expect(textOf(c)).toContain(refusalText('ranked'));
  });
});

describe('angielski', () => {
  it('adres: numer przed ulicą i „St.”, ulica zostaje po polsku', () => {
    lang.value = 'en';
    expect(addressText('Ogrodowa', 12)).toBe('12 Ogrodowa St.');
  });

  it('nazwy dzielnic, formatów, stanów, poziomów i źródeł ruchu nie mają polskich liter', () => {
    lang.value = 'en';
    const texts: string[] = [];
    for (const d of ['osiedle', 'srodmiescie', 'dworzec', 'biurowce', 'park'] as const) texts.push(districtName(d));
    for (const kind of ['blok', 'kamienica', 'pawilon'] as const) for (const corner of [false, true]) for (const d of ['osiedle', 'biurowce'] as const) texts.push(lotKindName(kind, corner, d));
    for (const s of ['zajety', 'wolny', 'konkurencja', 'twoj', 'obok', 'budowa', 'po-traszce'] as const) texts.push(lotStateName(s));
    for (const l of ['niskie', 'srednie', 'wysokie'] as const) texts.push(levelText(l), levelText(l, true));
    for (const k of ['przystanek', 'szkola', 'uczelnia', 'biurowiec', 'dworzec', 'osiedle'] as const) texts.push(sourceText(k));
    texts.push(progressText({ kind: 'granted' }), progressText({ kind: 'ranked' }), progressText({ kind: 'missing', profitMonthsNeeded: 2, trust: 65, trustNeeded: 75 }));
    expect(texts.every((x) => x.length > 0)).toBe(true);
    expect(texts.filter((x) => PL_CHARS.test(x))).toEqual([]);
    expect(districtName('osiedle')).toBe('Estate');
    expect(progressText({ kind: 'missing', profitMonthsNeeded: 1, trust: 68, trustNeeded: 75 })).toBe('1 more month in profit · trust 68/75');
  });

  it('lokal obok nazywa remont tak jak zakładka Ulepszenia: „Refit: take over the unit next door”', () => {
    lang.value = 'en';
    for (const seed of [SEED, 'a', 'b', 'c', 'd', 'e']) {
      const f = partnerFirm(seed);
      if (f.city.neighbourLotId === null) continue;
      const text = textOf(card(f, f.city.neighbourLotId));
      expect(text).toContain(`“${EN_REMONTS[1]}”`);
      expect(text).not.toContain('„');
      return;
    }
    throw new Error('żaden z seedów testu nie ma lokalu obok');
  });

  it('karta po angielsku nie ma polskich liter poza nazwami własnymi (ulica) i „zł”', () => {
    lang.value = 'en';
    const f = partnerFirm();
    const row = rowFor(f, 'dworzec');
    const text = textOf(card(f, row.lotId)).replace(row.street, '').replace(/zł/g, '');
    expect(text.match(PL_CHARS)).toBeNull();
    expect(text).toContain('theft: high, you will see it at the stocktake');
  });
});
