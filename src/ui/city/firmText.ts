import { dateText, t, tr } from '@/i18n';
import { lotById } from '@/sim/city/generateCity';
import { DEBT_LIMIT, GUARANTEE } from '@/sim/economy/catalog';
import { debtWarningText, type EconEvent } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import { cardDef } from '@/sim/economy/tycoon/cards';
import type { FirmEvent, FirmRefusal, FirmState, FirmStore } from '@/sim/firm/types';
import { money, zl } from '../game/format';

/*
 * Teksty firmy (spec §10, §12, §13, §18). Symulacja nie ma ani jednego polskiego zdania o sklepach w mieście: zdarzenia i odmowy firmy
 * niosą identyfikator i parametry, a tekst składa tutaj interfejs, więc ma angielską wersję w `src/i18n/en/ui/firm.ts`. Adres lokalu
 * to „ul. Lipowa 3” po polsku i „3 Lipowa St.” po angielsku (ulica to nazwa własna i zostaje po polsku). Teksty Centrali z §10 bez
 * skracania: tonem to biurokratyczna niechęć, a nie przyjaźń.
 */

/** Adres lokalu: „ul. Lipowa 3” albo „3 Lipowa St.”. */
export const addressText = (street: string, n: number): string => t`ul. ${street} ${n}`;

/** Adres lokalu miasta o numerze `lotId`. */
export function lotAddress(f: FirmState, lotId: number): string {
  const lot = lotById(f.city, lotId);
  return addressText(lot.street, lot.number);
}

/** „Traszka #2, Lipowa”: numer sklepu w firmie i ulica jego lokalu (marka i ulica to nazwy własne). Nieznany numer to samo „Traszka #n”. */
export function storeName(f: FirmState, id: number): string {
  const st = f.stores.find((s) => s.id === id);
  return st ? `Traszka #${id}, ${lotById(f.city, st.lotId).street}` : `Traszka #${id}`;
}

/**
 * Toast o zdarzeniu sklepu w tle (§12): nazwa sklepu i zdanie symulacji w bieżącym języku (`tr`), a przy poziomie także lista odblokowań
 * (`🔓 nazwa`, jak w banerze aktywnego sklepu). Poziom niesie nagrodę, która wpada do wspólnej gotówki, więc gracz widzi, skąd ona jest.
 */
export function backgroundToastText(f: FirmState, storeId: number, e: EconEvent): string {
  const unlocks = e.kind === 'levelup' ? (e.unlocks ?? []).map((u) => tr(`🔓 ${u}`)) : [];
  return `${storeName(f, storeId)}: ${[tr(e.text), ...unlocks].join(' ')}`;
}

/** Stan sklepu słowami: aktywny, w tle, z wypowiedzeniem (do kiedy działa umowa) albo zamknięty. */
export function storeStateText(f: FirmState, st: FirmStore): string {
  if (st.closed) return t`zamknięta`;
  if (st.notice) return t`umowa wygasa ${dateText(st.notice.endDay)}`;
  return st.id === f.activeId ? t`aktywna` : t`w tle`;
}

/** Centrala o gwarancji dodatkowego sklepu (§11.2), dosłownie ze specu. */
export const noGuaranteeText = (): string => t`Gwarancja przysługuje nowym partnerom. Pan/Pani jest już strategiczny/a.`;

/**
 * Czy miesiąc nr `month` (1 = pierwszy miesiąc sklepu) dodatkowego sklepu (`site.extra`) wypada tam, gdzie sklep startowy dostaje gwarancję
 * (pierwsze `GUARANTEE.months` miesięcy). Gwarancja jest dla nowych franczyzobiorców (`guaranteeTopUp`), więc dodatkowy sklep nie ma wiersza
 * „Dopłata z gwarancji” i właśnie tam wyciąg oraz podgląd miesiąca mówią to słowami Centrali (`noGuaranteeText`). Raport za miesiąc, który
 * się zamknął, ma numer `history.length`, podgląd miesiąca, który się zamknie, `history.length + 1`.
 */
export const noGuarantee = (info: StoreInfo | undefined, month: number): boolean => !!info?.site?.extra && month <= GUARANTEE.months;

const num = (e: FirmEvent, key: string): number => {
  const v = e.params?.[key];
  return typeof v === 'number' ? v : 0;
};
const str = (e: FirmEvent, key: string): string => {
  const v = e.params?.[key];
  return typeof v === 'string' ? v : '';
};

/** Odpowiedź, którą zastępca wybrał na kartę: etykieta z talii (po angielsku z `EN_CARDS`), a gdy karty nie ma, numer odpowiedzi. */
function answerLabel(e: FirmEvent): string {
  const answer = num(e, 'answer');
  const label = cardDef(str(e, 'card'))?.answers[answer]?.label;
  return label ? tr(label) : t`odpowiedź ${answer + 1}`;
}

/** Rozliczenie końcowe: ubytki ponad limit, niespłacone raty, nadwyżka czekająca na przelew i suma, która zeszła z gotówki. */
function settlementText(e: FirmEvent): string {
  const lines = [t`Ubytki od ostatniego remanentu: ${zl(num(e, 'shrinkage'))}, limit Centrali ${zl(num(e, 'limit'))}, do zapłaty ${zl(num(e, 'remanent'))}.`];
  if (num(e, 'installments') > 0) lines.push(t`Niespłacone raty: ${zl(num(e, 'installments'))}.`);
  if (num(e, 'pending') > 0) lines.push(t`Nadwyżka czekająca na przelew: ${zl(num(e, 'pending'))}.`);
  lines.push(t`Z gotówki zeszło razem ${zl(num(e, 'total'))}.`);
  return lines.join('\n');
}

/**
 * Tytuł i tekst zdarzenia firmy. `partner`, `opened`, `notice`, `settlement`, `closed`, `debt` i `gameover` czekają na „OK” (ważne zdarzenia),
 * `deputy` i `build` to krótkie toasty, a `network-report` nie ma własnego tekstu: jego okno składa się z liczb podsumowania.
 */
export function firmEventText(f: FirmState, e: FirmEvent): { title: string; text: string } {
  const id = e.storeId ?? 0;
  const name = storeName(f, id);
  switch (e.kind) {
    case 'partner':
      return {
        title: t`Status Partnera Strategicznego`,
        text: [
          t`Po wnikliwej analizie i z pewnymi oporami nadajemy Panu/Pani status Partnera Strategicznego.`,
          t`Wolne lokale czekają w zakładce Miasto. Prosimy nie traktować tego jako zachęty.`,
        ].join('\n'),
      };
    case 'build': {
      const where = lotAddress(f, num(e, 'lotId'));
      const when = dateText(num(e, 'readyDay'));
      const price = zl(num(e, 'price'));
      return {
        title: t`Budowa lokalu`,
        text: str(e, 'pay') === 'gotowka'
          ? t`Pakiet otwarcia zapłacony z gotówki: ${price}. Lokal przy ${where} jest w budowie. Otwarcie: ${when}.`
          : t`Pakiet otwarcia na raty: ${price}. Lokal przy ${where} jest w budowie. Otwarcie: ${when}.`,
      };
    }
    case 'opened':
      return {
        title: t`Traszka #${id} otwarta`,
        text: t`${name} przyjmuje pierwszych klientów (${lotAddress(f, num(e, 'lotId'))}). Przełączysz się na nią w górnym pasku. Sklep w tle pracuje sam, a jego karty rozstrzyga zastępca.`,
      };
    case 'deputy':
      return { title: t`Zastępca`, text: t`${name}: zastępca wybrał: ${answerLabel(e)}` };
    case 'notice':
      return {
        title: t`Wypowiedzenie umowy`,
        text: t`Umowa ${name} wygasa ${dateText(num(e, 'endDay'))}. Do tego dnia sklep działa normalnie, ale Centrala nie finansuje w nim nowych rat. Potem następuje rozliczenie końcowe.`,
      };
    case 'settlement':
      return { title: t`Rozliczenie końcowe: ${name}`, text: settlementText(e) };
    case 'closed':
      return {
        title: t`Umowa zakończona: ${name}`,
        text: str(e, 'reason') === 'notice'
          ? t`Umowa ${name} wygasła. Lokal wraca na mapę jako „po Traszce”, z wyposażeniem. Pozostałe placówki działają dalej.`
          : t`Zaufanie Centrali do ${name} spadło do zera, więc Centrala wypowiedziała umowę. Lokal wraca na mapę jako „po Traszce”, z wyposażeniem. Pozostałe placówki działają dalej.`,
      };
    case 'debt':
      return { title: t`Blisko granicy debetu`, text: tr(debtWarningText(num(e, 'cash'))) };
    case 'gameover':
      return {
        title: t`Koniec współpracy`,
        text: str(e, 'reason') === 'notice'
          ? t`Umowa ostatniej placówki wygasła. Centrala dziękuje za współpracę.`
          : t`Gotówka ${money(num(e, 'cash'))}, poniżej granicy debetu ${money(DEBT_LIMIT)}: Centrala wypowiada umowy wszystkim placówkom. Dziękujemy za współpracę.`,
      };
    case 'network-report':
      return { title: t`Podsumowanie sieci`, text: '' };
    default: {
      const unreachable: never = e.kind;
      void unreachable;
      return { title: t`Zdarzenie firmy`, text: '' };
    }
  }
}

/** Dlaczego Centrala odmówiła polecenia firmy (`FirmRefusal`): ranking i limit dosłownie z §10, reszta w tym samym tonie. */
export function refusalText(reason: FirmRefusal): string {
  switch (reason) {
    case 'ranked': return t`W sezonie rankingowym Centrala ocenia jedną placówkę. Prosimy wrócić po sezonie.`;
    case 'status': return t`Centrala rozważy kolejną placówkę, gdy nada Panu/Pani status Partnera Strategicznego.`;
    case 'limit': return t`Dwie placówki to na tym etapie partnerstwa wszystko, na co Centrala jest gotowa się zgodzić.`;
    case 'lot': return t`Ten lokal nie jest do wzięcia.`;
    case 'gotowka': return t`Po zapłaceniu pakietu gotówka musi zostać nie mniejsza od zera: Centrala nie finansuje budów na debecie.`;
    case 'raty': return t`Rata pakietu przekracza limit rat nowej placówki. Prosimy o gotówkę albo o tańszy lokal.`;
    case 'store': return t`Nie ma takiej placówki albo już nie działa.`;
    case 'single': return t`Centrala nie przyjmie wypowiedzenia, jeśli nie zostaje inna działająca placówka.`;
    case 'over': return t`Gra skończona: Centrala wypowiedziała umowę.`;
    default: {
      const unreachable: never = reason;
      void unreachable;
      return t`Centrala odmawia.`;
    }
  }
}
