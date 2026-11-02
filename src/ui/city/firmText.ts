import { dateText, t, tr } from '@/i18n';
import { lotById } from '@/sim/city/generateCity';
import { DEBT_LIMIT, GUARANTEE } from '@/sim/economy/catalog';
import { debtWarningText, type EconEvent } from '@/sim/economy/economy';
import type { StoreInfo } from '@/sim/economy/storeInfo';
import { cardDef } from '@/sim/economy/tycoon/cards';
import { TRUST } from '@/sim/economy/tycoon/trust';
import type { FirmCommand } from '@/sim/firm/commands';
import { FIRM_GOALS } from '@/sim/firm/goals';
import { RESEARCH, coordinationFee } from '@/sim/firm/research';
import { STORE_UNLOCK_TURNOVER, type FirmEvent, type FirmRefusal, type FirmState, type FirmStore } from '@/sim/firm/types';
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

/** Zdanie Centrali o limicie, który obowiązuje przy `limit` placówkach: próg obrotu sieci do kolejnej albo wyznanie, że to już koniec. */
function limitSentence(limit: number): string {
  const need = STORE_UNLOCK_TURNOVER[limit];
  return need === undefined
    ? t`Pięć placówek to wszystko, na co Centrala jest gotowa się zgodzić w tym mieście.`
    : t`Centrala zgodzi się na kolejną placówkę, gdy obrót sieci w miesiącu przekroczy ${zl(need)}.`;
}

/** Limit placówek firmy słowami (4b §5.4): ile obrotu sieci w miesiącu odblokuje kolejny sklep (3 → 1 mln zł, 4 → 1,6 mln zł) albo że pięć to sufit. */
export const limitText = (f: FirmState): string => limitSentence(f.storeLimit);

/**
 * Tytuł i tekst zdarzenia firmy. `partner`, `opened` (też ponowne otwarcie lokalu „po Traszce”, `reopened`), `notice`, `settlement`, `closed`,
 * `debt`, `gameover` i `unlock` (kolejna placówka z obrotu sieci) czekają na „OK” (ważne zdarzenia), `deputy`, `build`, `research` i `goal` to krótkie
 * toasty, a `network-report` nie ma własnego tekstu: jego okno składa się z liczb podsumowania.
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
      // ponowny wynajem lokalu „po Traszce” (`reopened`): ten sam sklep wraca z wyposażeniem, ale znajomość z Centralą zaczyna się od nowa
      if (num(e, 'reopened') > 0) {
        return {
          title: t`Traszka #${id} znów otwarta`,
          text: t`${name} znów przyjmuje klientów (${lotAddress(f, num(e, 'lotId'))}). Wyposażenie zostało, ale Centrala zaczyna znajomość od nowa: poziom 1, zaufanie ${TRUST.start}.`,
        };
      }
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
    // etap 4b: kolejna placówka z obrotu sieci, badanie Sieci i cel sieci (`million` składa Galeria sław)
    case 'unlock': {
      const limit = num(e, 'limit');
      const turnover = zl(num(e, 'turnover'));
      const lead = limit >= 5
        ? t`Centrala zgadza się na piątą placówkę. Obrót sieci ${turnover} przekonał Dział Ekspansji, który zaraz potem wyszedł na lunch.`
        : t`Centrala zgadza się na czwartą placówkę. Obrót sieci ${turnover} przekonał Dział Ekspansji, który zaraz potem wyszedł na lunch.`;
      return { title: t`Kolejna placówka`, text: `${lead}\n${limitSentence(limit)}` };
    }
    case 'research': {
      const def = RESEARCH.find((d) => d.id === str(e, 'id'));
      const price = num(e, 'price');
      return {
        title: t`Badania Sieci`,
        text: def
          ? t`${tr(def.name)}: poziom ${num(e, 'level')}. Centrala pobrała ${zl(price)}, w tym opłatę koordynacyjną ${zl(coordinationFee(price))}.`
          : t`Badanie Sieci na poziomie ${num(e, 'level')}. Centrala pobrała ${zl(price)}.`,
      };
    }
    case 'goal': {
      const goal = FIRM_GOALS.find((g) => g.id === str(e, 'id'));
      return {
        title: t`Cel sieci`,
        text: goal
          ? t`Cel sieci spełniony: ${tr(goal.label)}. Nagroda czeka na odbiór w Celach.`
          : t`Cel sieci spełniony. Nagroda czeka na odbiór w Celach.`,
      };
    }
    case 'million':
      return { title: t`Milion!`, text: t`Centrala jest w szoku, księgowa w euforii.` };
    default: {
      const unreachable: never = e.kind;
      void unreachable;
      return { title: t`Zdarzenie firmy`, text: '' };
    }
  }
}

/**
 * Toast o celach sieci spełnionych w jednej minucie: jeden cel mówi, który, kilka naraz (zapis z portfelem ponad milion spełnia ćwierć
 * bańki, pół i milion w pierwszej minucie) dostaje jedno zdanie z liczbą, żeby gracz nie dostał serii okien.
 */
export function goalsToastText(f: FirmState, goals: readonly FirmEvent[]): string {
  return goals.length === 1 ? firmEventText(f, goals[0]!).text : t`Cele sieci do odebrania: ${goals.length}. Nagrody czekają w Celach.`;
}

/** Brak gotówki na badanie Sieci: po zapłacie musi zostać co najmniej zero (odmowa `gotowka` przy poleceniu `research`; zdanie o pakiecie i budowie tu nie pasuje). */
export const researchCashText = (): string => t`Za mało gotówki na badanie: po zapłacie musi zostać co najmniej 0 zł.`;

/**
 * Dlaczego Centrala odmówiła polecenia firmy (`FirmRefusal`): ranking dosłownie z §10, reszta w tym samym tonie. Odmowa `limit` mówi o limicie
 * firmy `f` (próg obrotu sieci do kolejnej placówki, `limitText`); bez firmy mówi ogólnie. `command`: polecenie, które Centrala odrzuciła, gdy
 * to zmienia treść (brak gotówki na badanie, `researchCashText`, zamiast pakietu otwarcia).
 */
export function refusalText(reason: FirmRefusal, f?: FirmState, command?: FirmCommand['type']): string {
  switch (reason) {
    case 'ranked': return t`W sezonie rankingowym Centrala ocenia jedną placówkę. Prosimy wrócić po sezonie.`;
    case 'status': return t`Centrala rozważy kolejną placówkę, gdy nada Panu/Pani status Partnera Strategicznego.`;
    case 'limit': return f ? limitText(f) : t`Centrala nie zgadza się teraz na kolejną placówkę. Limit rośnie wraz z obrotem sieci.`;
    case 'lot': return t`Ten lokal nie jest do wzięcia.`;
    case 'gotowka': return command === 'research' ? researchCashText() : t`Po zapłaceniu pakietu gotówka musi zostać nie mniejsza od zera: Centrala nie finansuje budów na debecie.`;
    case 'raty': return t`Rata pakietu przekracza limit rat nowej placówki. Prosimy o gotówkę albo o tańszy lokal.`;
    case 'store': return t`Nie ma takiej placówki albo już nie działa.`;
    case 'single': return t`Centrala nie przyjmie wypowiedzenia, jeśli nie zostaje inna działająca placówka.`;
    case 'over': return t`Gra skończona: Centrala wypowiedziała umowę.`;
    case 'siec': return t`Badania Sieci działają od dwóch placówek. Jeden sklep to dla Centrali jeszcze nie sieć.`;
    case 'max': return t`To badanie jest już na najwyższym poziomie. Centrala nie ma czego więcej badać.`;
    case 'goal': return t`Tego celu nie da się teraz odebrać.`;
    default: {
      const unreachable: never = reason;
      void unreachable;
      return t`Centrala odmawia.`;
    }
  }
}
