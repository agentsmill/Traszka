import type { Dict, Plurals } from '../ui';

/*
 * Okno rozliczenia miesiąca: wyciąg od Centrali (`ui/game/statement.tsx`), raport miesiąca, koniec współpracy i protokół remanentu
 * (`ReportBody`, `ReportModal`, `RemanentModal` w `ui/game/overlays.tsx`) oraz podgląd końca miesiąca (`ui/game/monthPreview.tsx`).
 */

export const MONTH_UI: Dict = {
  // statement.tsx
  'Wyciąg od Centrali': 'Head Office statement',
  'Przelew od Centrali': 'Transfer from Head Office',
  'Marża': 'Margin',
  'Premie': 'Bonuses',
  'Dopłata z gwarancji': 'Guarantee top-up',
  'Razem': 'Total',
  'Potrącenia': 'Deductions',
  'Raty': 'Instalments',
  'Palety ponad darmowe': 'Pallets over the free allowance',
  'Remanent': 'Stocktake',
  'Twoje koszty': 'Your costs',
  'Pensje': 'Wages',
  'Księgowa': 'Accountant',
  'Media': 'Utilities',
  'Zostaje Ci': 'You keep',
  'Gotówka po zamknięciu': 'Cash after closing',
  'Wynik miesiąca bez rat (do rankingu)': 'Month’s result excluding instalments (for the leaderboard)',
  'Gotówka w miesiącu': 'Cash this month',
  'Zakupy za gotówkę': 'Cash purchases',
  'Mandaty': 'Fines',
  'Inne przychody i koszty': 'Other income and costs',
  'Te pozycje ruszają gotówką od razu, poza wyciągiem.': 'These items move your cash straight away, outside the statement.',
  'Rozliczenie od wejścia nowych zasad: przelew i koszty liczone od chwili aktualizacji gry.':
    'Settled from when the new rules came in: the transfer and costs are counted from the moment the game was updated.',
  // overlays.tsx: raport miesiąca i koniec współpracy
  '„{0}”': '“{0}”',
  '— Centrala': '— Head Office',
  'Obrót {0} · klienci {1} (utraceni: {2})': 'Turnover {0} · customers {1} (lost: {2})',
  'Klienci': 'Customers',
  '{0} (utraceni: {1})': '{0} (lost: {1})',
  'Obrót': 'Turnover',
  'Marża i inne przychody': 'Margin and other income',
  'Premie Centrali': 'Head Office bonuses',
  'Płace': 'Wages',
  'Opłata franczyzowa': 'Franchise fee',
  'Ubytki ponad limit Centrali': 'Shrinkage over Head Office’s limit',
  'Logistyka': 'Logistics',
  'Wynik miesiąca': 'Month’s result',
  'Inwestycje': 'Investments',
  'Gotówka na koniec': 'Cash at the end',
  'Gotówka na koniec: {0} · inwestycje: {1}': 'Cash at the end: {0} · investments: {1}',
  'Zaufanie Centrali: {0} → {1}': 'Head Office’s trust: {0} → {1}',
  '{0} pkt': '{0} pts',
  'Bez zmian w tym miesiącu.': 'No change this month.',
  'Wskazówka': 'Tip',
  'KPI tygodnia w miesiącu: {0} trafione, {1} nietrafione': 'Weekly KPIs this month: {0} hit, {1} missed',
  'KPI tygodnia w miesiącu: żaden tydzień nie został jeszcze rozliczony': 'Weekly KPIs this month: no week has been settled yet',
  'Centrala dziękuje za współpracę. Rozliczenie końcowe: inwentaryzacja jutro o 6:00.':
    'Head Office thanks you for your cooperation. Final settlement: stocktake tomorrow at 6:00.',
  'Powód: zaufanie Centrali spadło do zera, a gotówka spadła poniżej granicy debetu {0}.':
    'Reason: Head Office’s trust fell to zero, and your cash fell below the debt limit of {0}.',
  'Powód: za duży debet. Gotówka spadła do {0}, poniżej granicy {1}, a wtedy Centrala od razu kończy współpracę.':
    'Reason: too much debt. Your cash fell to {0}, below the limit of {1}, and at that point Head Office ends the partnership on the spot.',
  'Powód: zaufanie Centrali spadło do zera.': 'Reason: Head Office’s trust fell to zero.',
  'Koniec współpracy': 'End of the partnership',
  'Wyciąg od Centrali: {0}': 'Head Office statement: {0}',
  'Raport: {0}': 'Report: {0}',
  'Dalej: wynik sezonu': 'Next: season result',
  'Wróć do zwykłej gry': 'Back to the regular game',
  'Zacznij od nowa': 'Start over',
  'Dalej': 'Next',
  // overlays.tsx: protokół remanentu
  'Protokół remanentu': 'Stocktake report',
  'Okres: {0} – {1}': 'Period: {0} – {1}',
  'Obrót w okresie': 'Turnover in the period',
  'Ubytki': 'Shrinkage',
  'Ubytki razem': 'Total shrinkage',
  'Limit Centrali': 'Head Office’s limit',
  'Limit poznajesz dopiero teraz: {0} obrotu.': 'You only find out the limit now: {0} of turnover.',
  'Nadwyżka {0} zejdzie z dzisiejszego przelewu.': 'The excess of {0} comes off today’s transfer.',
  'Ubytki mieszczą się w limicie.': 'Shrinkage is within the limit.',
  // monthPreview.tsx
  'Podgląd liczy kopia sklepu, prawdziwa gra się nie zmienia. Zakładam, że do końca miesiąca nic nie robisz: nie stukasz, nie kupujesz, a karty decyzji dostają odpowiedź domyślną.':
    'The preview runs on a copy of your shop; the real game doesn’t change. It assumes you do nothing until the end of the month: no tapping, no buying, and decision cards get the default answer.',
  'Gra skończyłaby się przed zamknięciem miesiąca: gotówka spadłaby poniżej granicy debetu ({0}).':
    'The game would end before the month closes: your cash would fall below the debt limit ({0}).',
  'Centrala wypowie umowę: po zamknięciu miesiąca gotówka wyniesie {0}, poniżej granicy debetu ({1}).':
    'Head Office will terminate your agreement: after the month closes your cash will be {0}, below the debt limit ({1}).',
  'Centrala wypowie umowę: zaufanie spadnie do zera.': 'Head Office will terminate your agreement: trust will fall to zero.',
  'W trakcie miesiąca gotówka spadnie do {0}, poniżej progu ostrzeżenia ({1}).': 'During the month your cash will drop to {0}, below the warning threshold ({1}).',
  'Wynik podglądu': 'Preview result',
  'Jeśli nic nie zrobisz': 'If you do nothing',
  'Centrala dopłaca do {0} przychodu w pierwszych {1} miesiącach, o ile nie będzie mandatu i zaufanie nie spadnie poniżej {2}. „Wierzymy w Ciebie. Do odwołania.”':
    'Head Office tops up your income to {0} in your first {1} months, as long as you get no fines and trust doesn’t drop below {2}. “We believe in you. Until further notice.”',
  'To naliczenia do chwili końca gry: bez rat, dopłaty z gwarancji i premii od obrotu.':
    'These are the amounts up to the moment the game ended: no instalments, guarantee top-up or turnover bonus.',
  'Gotówka teraz': 'Cash now',
  'Wyciąg na koniec miesiąca': 'End-of-month statement',
  'Prognoza na dziś': 'Forecast as of today',
  'Na dziś': 'As of today',
  'Saldo u Centrali': 'Head Office balance',
  'Raty w tym przelewie': 'Instalments in this transfer',
  'Zostaje Ci po zamknięciu (prognoza)': 'You keep after closing (forecast)',
  'Saldo to marża i premie z tego miesiąca. Centrala przeleje je przy zamknięciu, potrąci raty i palety, a Ty zapłacisz pensje, media, ZUS, VAT i księgową. Prognoza liczy resztę miesiąca z dotychczasowego obrotu.':
    'The balance is this month’s margin and bonuses. Head Office transfers it when the month closes and deducts instalments and pallets, and you pay wages, utilities, ZUS (social security), VAT and your accountant. The forecast projects the rest of the month from turnover so far.',
  'Koniec miesiąca: policz podgląd': 'End of month: run the preview',
  'Liczę: dzień {0} z {1}…': 'Calculating: day {0} of {1}…',
  'Nie ma czego liczyć: gra już się skończyła.': 'Nothing to calculate: the game is already over.',
  'Zamknij': 'Close',
};

export const MONTH_PLURALS: Plurals = {};
