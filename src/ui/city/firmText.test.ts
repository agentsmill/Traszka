import { afterEach, describe, expect, it } from 'vitest';
import { lang } from '@/i18n';
import { EN_CARDS } from '@/i18n/en/cards';
import { PL_CHARS } from '../../../tests/i18nScan';
import { openSecond, partnerSession } from '../../../tests/firmKit';
import { firmOf } from '@/game/session';
import { lotById } from '@/sim/city/generateCity';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { CARDS } from '@/sim/economy/tycoon/cards';
import { TRUST } from '@/sim/economy/tycoon/trust';
import { DECK, DWORZEC_CARD_IDS } from '@/sim/economy/tycoon/deck';
import type { FirmEvent, FirmRefusal, FirmState } from '@/sim/firm/types';
import { zl } from '../game/format';
import { addressText, firmEventText, goalsToastText, limitText, lotAddress, refusalText, storeName } from './firmText';

/*
 * Teksty firmy składa UI z identyfikatorów i parametrów zdarzeń (spec §18): adres w obu językach, nazwa sklepu, zdarzenia Centrali
 * i odmowy. Symulacja nie zna żadnego z tych zdań.
 */

afterEach(() => { lang.value = 'pl'; });

function twoStoreFirm(): FirmState {
  const s = partnerSession();
  openSecond(s, 'raty');
  return firmOf(s);
}

/** Liczby w tekście bez spacji tysięcy (polski zapis nie grupuje czterocyfrowych, a spacja bywa twarda). */
const digits = (text: string): string => text.replace(/[\s\u00a0\u202f]/g, '');
const lotNo = (f: FirmState, storeId: number) => lotById(f.city, f.stores.find((s) => s.id === storeId)!.lotId);

describe('addressText i storeName', () => {
  it('adres po polsku „ul. Lipowa 3”, po angielsku numer przed ulicą i „St.”; ulica zostaje po polsku', () => {
    expect(addressText('Lipowa', 3)).toBe('ul. Lipowa 3');
    lang.value = 'en';
    expect(addressText('Lipowa', 3)).toBe('3 Lipowa St.');
    expect(addressText('Ogrodowa', 118)).toBe('118 Ogrodowa St.');
  });

  it('nazwa sklepu to „Traszka #n, ulica”; nieznany numer ma samo „Traszka #n”', () => {
    const f = twoStoreFirm();
    expect(storeName(f, 1)).toBe(`Traszka #1, ${lotNo(f, 1).street}`);
    expect(storeName(f, 2)).toBe(`Traszka #2, ${lotNo(f, 2).street}`);
    expect(storeName(f, 9)).toBe('Traszka #9');
    lang.value = 'en';
    expect(storeName(f, 2)).toBe(`Traszka #2, ${lotNo(f, 2).street}`);   // marka i ulica to nazwy własne
  });

  it('adres lokalu miasta: ulica i numer z lokalu', () => {
    const f = twoStoreFirm();
    const lot = lotNo(f, 2);
    expect(lotAddress(f, lot.id)).toBe(`ul. ${lot.street} ${lot.number}`);
    lang.value = 'en';
    expect(lotAddress(f, lot.id)).toBe(`${lot.number} ${lot.street} St.`);
  });
});

describe('firmEventText', () => {
  const f = twoStoreFirm();
  const name2 = storeName(f, 2);
  const address2 = lotAddress(f, f.stores[1]!.lotId);
  const events: FirmEvent[] = [
    { kind: 'partner' },
    { kind: 'build', params: { lotId: f.stores[1]!.lotId, readyDay: 40, price: 52_000, pay: 'raty' } },
    { kind: 'build', params: { lotId: f.stores[1]!.lotId, readyDay: 40, price: 52_000, pay: 'gotowka' } },
    { kind: 'opened', storeId: 2, params: { lotId: f.stores[1]!.lotId } },
    { kind: 'opened', storeId: 2, params: { lotId: f.stores[1]!.lotId, reopened: 1 } },
    { kind: 'deputy', storeId: 2, params: { card: DECK[0]!.id, answer: 1 } },
    { kind: 'notice', storeId: 2, params: { endDay: 70 } },
    { kind: 'settlement', storeId: 2, params: { installments: 3_000, pending: 250, shrinkage: 9_000, limit: 7_000, remanent: 2_000, total: 5_250 } },
    { kind: 'closed', storeId: 2, params: { reason: 'trust' } },
    { kind: 'closed', storeId: 2, params: { reason: 'notice' } },
    { kind: 'debt', params: { cash: -60_000 } },
    { kind: 'gameover', params: { reason: 'debt', cash: -120_000 } },
    { kind: 'gameover', params: { reason: 'notice' } },
    { kind: 'network-report' },
  ];

  it('nadanie statusu: zdanie Centrali bez skracania', () => {
    const { title, text } = firmEventText(f, { kind: 'partner' });
    expect(title).toBe('Status Partnera Strategicznego');
    expect(text).toContain('Po wnikliwej analizie i z pewnymi oporami nadajemy Panu/Pani status Partnera Strategicznego.');
    lang.value = 'en';
    const en = firmEventText(f, { kind: 'partner' });
    expect(en.title).toBe('Strategic Partner status');
    expect(en.text).toContain('After careful analysis, and with some reluctance, we hereby grant you Strategic Partner status.');
  });

  it('każdy rodzaj zdarzenia ma tytuł i tekst po polsku i po angielsku, a angielski nie ma polskich liter (poza nazwami własnymi)', () => {
    for (const e of events) {
      const pl = firmEventText(f, e);
      expect(pl.title.length, e.kind).toBeGreaterThan(0);
      if (e.kind !== 'network-report') expect(pl.text.length, e.kind).toBeGreaterThan(0);
    }
    lang.value = 'en';
    const own = new Set([name2, address2, lotAddress(f, f.stores[1]!.lotId), lotNo(f, 2).street]);
    for (const e of events) {
      const en = firmEventText(f, e);
      let text = `${en.title}\n${en.text}`;
      for (const n of own) text = text.split(n).join('');
      text = text.replace(/zł/g, '');
      expect(PL_CHARS.test(text), `${e.kind}: ${text}`).toBe(false);
    }
  });

  it('otwarcie, wypowiedzenie, rozliczenie i zamknięcie niosą nazwę sklepu, a rozliczenie kwoty', () => {
    const opened = firmEventText(f, { kind: 'opened', storeId: 2, params: { lotId: f.stores[1]!.lotId } });
    expect(opened.title).toBe('Traszka #2 otwarta');
    expect(opened.text).toContain(name2);
    expect(opened.text).toContain(address2);
    const notice = firmEventText(f, { kind: 'notice', storeId: 2, params: { endDay: 70 } });
    expect(notice.text).toContain(name2);
    const settlement = firmEventText(f, { kind: 'settlement', storeId: 2, params: { installments: 3_000, pending: 250, shrinkage: 9_000, limit: 7_000, remanent: 2_000, total: 5_250 } });
    expect(settlement.title).toContain(name2);
    for (const part of ['3000', '250', '9000', '7000', '2000', '5250']) expect(digits(settlement.text)).toContain(part);
    const trust = firmEventText(f, { kind: 'closed', storeId: 2, params: { reason: 'trust' } });
    const ended = firmEventText(f, { kind: 'closed', storeId: 2, params: { reason: 'notice' } });
    expect(trust.text).toContain(name2);
    expect(trust.text).not.toBe(ended.text);
  });

  it('ponowne otwarcie lokalu „po Traszce” (opened z reopened): „znów otwarta”, wyposażenie zostało, Centrala zaczyna od nowa: poziom 1 i zaufanie z TRUST.start', () => {
    const e: FirmEvent = { kind: 'opened', storeId: 2, params: { lotId: f.stores[1]!.lotId, reopened: 1 } };
    const pl = firmEventText(f, e);
    expect(pl.title).toBe('Traszka #2 znów otwarta');
    expect(pl.text).toBe(`${name2} znów przyjmuje klientów (${address2}). Wyposażenie zostało, ale Centrala zaczyna znajomość od nowa: poziom 1, zaufanie ${TRUST.start}.`);
    expect(TRUST.start).toBe(65);
    // zwykłe otwarcie (bez reopened) zostaje, jakie było
    const first = firmEventText(f, { kind: 'opened', storeId: 2, params: { lotId: f.stores[1]!.lotId } });
    expect(first.title).toBe('Traszka #2 otwarta');
    expect(first.text).toContain('przyjmuje pierwszych klientów');
    lang.value = 'en';
    const en = firmEventText(f, e);
    expect(en.title).toBe('Traszka #2 is open again');
    expect(en.text).toBe(`${name2} is serving customers again (${lotAddress(f, f.stores[1]!.lotId)}). The fittings stayed, but Head Office is starting the relationship afresh: level 1, trust ${TRUST.start}.`);
    expect(en.text).not.toBe(firmEventText(f, { kind: 'opened', storeId: 2, params: { lotId: f.stores[1]!.lotId } }).text);
  });

  it('zastępca: nazwa sklepu i polska etykieta odpowiedzi z karty, po angielsku angielska', () => {
    const card = DECK[0]!;
    const e: FirmEvent = { kind: 'deputy', storeId: 2, params: { card: card.id, answer: 1 } };
    const pl = firmEventText(f, e);
    expect(pl.text).toContain(name2);
    expect(pl.text).toContain('zastępca wybrał');
    expect(pl.text).toContain(card.answers[1]!.label);
    lang.value = 'en';
    const en = firmEventText(f, e);
    expect(en.text).toContain('deputy chose');
    expect(en.text).not.toContain(card.answers[1]!.label);
  });

  it('zastępca na karcie Dworca (4a.2): po polsku etykieta z talii, po angielsku etykieta z EN_CARDS', () => {
    for (const id of DWORZEC_CARD_IDS) {
      const def = DECK.find((d) => d.id === id)!;
      for (let answer = 0; answer < def.answers.length; answer++) {
        const e: FirmEvent = { kind: 'deputy', storeId: 2, params: { card: id, answer } };
        lang.value = 'pl';
        expect(firmEventText(f, e).text, `${id}#${answer}`).toContain(def.answers[answer]!.label);
        lang.value = 'en';
        const en = firmEventText(f, e).text;
        expect(en, `${id}#${answer}`).toContain(EN_CARDS[id]!.answers[answer]!.label);
        expect(en, `${id}#${answer}`).not.toContain(def.answers[answer]!.label);
      }
    }
  });

  it('zastępca z nieznaną kartą nie rzuca: numer odpowiedzi zamiast etykiety', () => {
    const e: FirmEvent = { kind: 'deputy', storeId: 2, params: { card: 'nie-ma-takiej', answer: 2 } };
    expect(firmEventText(f, e).text).toContain('3');
    expect(CARDS.maxPending).toBeGreaterThan(0);   // kontrola importu
  });

  it('debet: ostrzeżenie z kwotą gotówki, koniec gry z granicą debetu albo wypowiedzeniem ostatniej placówki', () => {
    const warn = firmEventText(f, { kind: 'debt', params: { cash: -60_000 } });
    expect(warn.title).toBe('Blisko granicy debetu');
    expect(digits(warn.text)).toContain('60000');
    const over = firmEventText(f, { kind: 'gameover', params: { reason: 'debt', cash: -120_000 } });
    expect(over.title).toBe('Koniec współpracy');
    expect(digits(over.text)).toContain(String(Math.abs(DEBT_LIMIT)));
    expect(firmEventText(f, { kind: 'gameover', params: { reason: 'notice' } }).text).not.toBe(over.text);
  });
});

describe('refusalText', () => {
  const reasons: FirmRefusal[] = ['ranked', 'status', 'limit', 'lot', 'gotowka', 'raty', 'store', 'single', 'over'];

  it('każda odmowa ma tekst, ranking i limit dosłownie z §10', () => {
    for (const r of reasons) expect(refusalText(r).length, r).toBeGreaterThan(0);
    expect(refusalText('ranked')).toBe('W sezonie rankingowym Centrala ocenia jedną placówkę. Prosimy wrócić po sezonie.');
    // odmowa limitu mówi o limicie firmy (próg obrotu sieci do kolejnej placówki), a bez firmy ogólnie
    expect(refusalText('limit', twoStoreFirm())).toBe(`Centrala zgodzi się na kolejną placówkę, gdy obrót sieci w miesiącu przekroczy ${zl(1_000_000)}.`);
    expect(refusalText('limit')).toBe('Centrala nie zgadza się teraz na kolejną placówkę. Limit rośnie wraz z obrotem sieci.');
  });

  it('po angielsku każda odmowa jest po angielsku', () => {
    lang.value = 'en';
    for (const r of reasons) {
      const text = refusalText(r);
      expect(PL_CHARS.test(text), r).toBe(false);
      expect(text, r).not.toBe('');
    }
    expect(refusalText('ranked')).toBe('During a ranked season Head Office reviews a single branch. Please come back after the season.');
  });
});

describe('limitText i odmowa limitu (4b §5.4)', () => {
  const withLimit = (limit: number): FirmState => Object.assign(twoStoreFirm(), { storeLimit: limit });

  it('limit 3 → próg 1 000 000 zł, limit 4 → 1 600 000 zł, limit 5 → tekst o pięciu placówkach', () => {
    expect(limitText(withLimit(3))).toBe(`Centrala zgodzi się na kolejną placówkę, gdy obrót sieci w miesiącu przekroczy ${zl(1_000_000)}.`);
    expect(limitText(withLimit(4))).toBe(`Centrala zgodzi się na kolejną placówkę, gdy obrót sieci w miesiącu przekroczy ${zl(1_600_000)}.`);
    expect(limitText(withLimit(5))).toBe('Pięć placówek to wszystko, na co Centrala jest gotowa się zgodzić w tym mieście.');
    expect(zl(1_000_000)).toMatch(/^1\s000\s000 zł$/);
  });

  it('odmowa limitu niesie ten sam tekst co limitText dla firmy, a po angielsku jest po angielsku', () => {
    for (const limit of [3, 4, 5]) expect(refusalText('limit', withLimit(limit))).toBe(limitText(withLimit(limit)));
    lang.value = 'en';
    expect(limitText(withLimit(3))).toBe('Head Office will agree to another branch once the network’s monthly turnover exceeds 1,000,000 zł.');
    expect(limitText(withLimit(4))).toContain('1,600,000 zł');
    expect(limitText(withLimit(5))).toBe('Five branches is all Head Office is prepared to agree to in this city.');
    expect(PL_CHARS.test(refusalText('limit').replace(/zł/g, ''))).toBe(false);
  });

  it('brak gotówki na badanie mówi o badaniu, a przy wynajmie dalej o pakiecie i budowie', () => {
    expect(refusalText('gotowka', undefined, 'research')).toBe('Za mało gotówki na badanie: po zapłacie musi zostać co najmniej 0 zł.');
    expect(refusalText('gotowka', undefined, 'rentLot')).toContain('pakietu');
    expect(refusalText('gotowka')).toContain('budów');
    expect(refusalText('limit', undefined, 'research')).toBe(refusalText('limit'));   // polecenie zmienia tylko tekst braku gotówki
    lang.value = 'en';
    expect(refusalText('gotowka', undefined, 'research')).toBe('Not enough cash for this research: at least 0 zł must be left after you pay.');
  });

  it('odmowy siec, max i goal mają tekst po polsku i po angielsku', () => {
    for (const r of ['siec', 'max', 'goal'] as const) {
      lang.value = 'pl';
      const pl = refusalText(r);
      expect(pl.length, r).toBeGreaterThan(0);
      lang.value = 'en';
      const en = refusalText(r);
      expect(en, r).not.toBe(pl);
      expect(PL_CHARS.test(en), r).toBe(false);
    }
  });
});

describe('firmEventText: etap 4b (unlock, research, goal, million)', () => {
  const f = twoStoreFirm();

  it('unlock {limit: 4, turnover: 1 012 345}: czwarta placówka, kwota obrotu i próg do piątej', () => {
    const e: FirmEvent = { kind: 'unlock', params: { limit: 4, turnover: 1_012_345 } };
    const pl = firmEventText(f, e);
    expect(pl.title).toBe('Kolejna placówka');
    expect(pl.text).toContain('czwartą placówkę');
    expect(digits(pl.text)).toContain('1012345');
    expect(pl.text).toContain(`przekroczy ${zl(1_600_000)}`);   // następny próg
    lang.value = 'en';
    const en = firmEventText(f, e);
    expect(en.title).toBe('Another branch');
    expect(en.text).toContain('fourth branch');
    expect(en.text).toContain('1,012,345 zł');
    expect(PL_CHARS.test(en.text.replace(/zł/g, ''))).toBe(false);
  });

  it('unlock {limit: 5}: piąta placówka i zdanie o sufitze, bez kolejnego progu', () => {
    const e: FirmEvent = { kind: 'unlock', params: { limit: 5, turnover: 1_650_000 } };
    const { text } = firmEventText(f, e);
    expect(text).toContain('piątą placówkę');
    expect(text).toContain('Pięć placówek to wszystko');
    expect(text).not.toContain('przekroczy');
  });

  it('research: nazwa badania, poziom, cena i opłata koordynacyjna (20% ceny), po angielsku nazwa z tabeli', () => {
    const e: FirmEvent = { kind: 'research', params: { id: 'obsada', level: 2, price: 120_000 } };
    const pl = firmEventText(f, e);
    expect(pl.title).toBe('Badania Sieci');
    expect(pl.text).toContain('Wspólna obsada (grafik sieci): poziom 2');
    expect(pl.text).toContain(`Centrala pobrała ${zl(120_000)}, w tym opłatę koordynacyjną ${zl(24_000)}`);
    lang.value = 'en';
    const en = firmEventText(f, e);
    expect(en.text).toBe(`Shared staffing (network rota): level 2. Head Office has taken ${zl(120_000)}, including a coordination fee of ${zl(24_000)}.`);
    expect(en.title).toBe('Network research');
  });

  it('research z nieznanym id nie rzuca: tekst bez nazwy', () => {
    const { text } = firmEventText(f, { kind: 'research', params: { id: 'nie-ma', level: 1, price: 1_000 } });
    expect(text).toContain('Badanie Sieci na poziomie 1');
  });

  it('goal: nazwa celu z tabeli; nieznany cel to ogólne zdanie', () => {
    const e: FirmEvent = { kind: 'goal', params: { id: 'stores4' } };
    const pl = firmEventText(f, e);
    expect(pl.title).toBe('Cel sieci');
    expect(pl.text).toBe('Cel sieci spełniony: Czwarta placówka. Nagroda czeka na odbiór w Celach.');
    expect(firmEventText(f, { kind: 'goal', params: { id: 'nie-ma' } }).text).toBe('Cel sieci spełniony. Nagroda czeka na odbiór w Celach.');
    lang.value = 'en';
    expect(firmEventText(f, e).text).toBe('Network goal reached: A fourth branch. The reward is waiting for you in Goals.');
  });

  it('million: „Milion!” (okno Galerii składa Zadanie 8, tekst zdarzenia zostaje)', () => {
    const { title, text } = firmEventText(f, { kind: 'million', params: { day: 400, cash: 1_000_000 } });
    expect(title).toContain('Milion');
    expect(text.length).toBeGreaterThan(0);
  });

  it('goalsToastText: jeden cel mówi, który, kilka naraz to jedno zdanie z liczbą', () => {
    const one: FirmEvent = { kind: 'goal', params: { id: 'cash250k' } };
    expect(goalsToastText(f, [one])).toBe(firmEventText(f, one).text);
    const three: FirmEvent[] = ['cash250k', 'cash500k', 'cash1m'].map((id) => ({ kind: 'goal', params: { id } }));
    expect(goalsToastText(f, three)).toBe('Cele sieci do odebrania: 3. Nagrody czekają w Celach.');
    lang.value = 'en';
    expect(goalsToastText(f, three)).toBe('Network goals ready to claim: 3. The rewards are waiting for you in Goals.');
  });
});
