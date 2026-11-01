import { afterEach, describe, expect, it } from 'vitest';
import { lang } from '@/i18n';
import { EN_CARDS } from '@/i18n/en/cards';
import { PL_CHARS } from '../../../tests/i18nScan';
import { openSecond, partnerSession } from '../../../tests/firmKit';
import { firmOf } from '@/game/session';
import { lotById } from '@/sim/city/generateCity';
import { DEBT_LIMIT } from '@/sim/economy/catalog';
import { CARDS } from '@/sim/economy/tycoon/cards';
import { DECK, DWORZEC_CARD_IDS } from '@/sim/economy/tycoon/deck';
import type { FirmEvent, FirmRefusal, FirmState } from '@/sim/firm/types';
import { addressText, firmEventText, lotAddress, refusalText, storeName } from './firmText';

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
    expect(refusalText('limit')).toBe('Trzy placówki to na tym etapie partnerstwa wszystko, na co Centrala jest gotowa się zgodzić.');
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
