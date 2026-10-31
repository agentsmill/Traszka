import type { Dict, Plurals } from '../ui';

/*
 * Samouczek (`ui/tutorial/*`): okno wyboru, kroki przelotu, dymki „pierwszy raz” i kroki o pieniądzach (`money.ts`), a także
 * „Samouczek” i podpowiedzi w ⚙ (`overlays.tsx`) i słowniczek w „Jak grać” (`HowTo.tsx`; treść słowniczka jest w `en/glossary.ts`).
 * Nazwy zakładek, przycisków i pasków jak w reszcie interfejsu: Pallets, Staff, Upgrades, Goals, Traszka Assistant, By hand, Claim, keep.
 */

export const TUTORIAL_UI: Dict = {
  // Tutorial.tsx: okno wyboru i dymek przelotu
  'Pierwszy dzień w Traszce': 'Your first day at Traszka',
  'Centrala przygotowała krótkie szkolenie: co jest na ekranie, palety, pieniądze, ludzie i rozwój. Czas w sklepie stoi, dopóki nie skończysz.':
    'Head Office has prepared a short training session: what’s on the screen, pallets, money, staff and growth. Time in the shop stands still until you finish.',
  'Samouczek (ok. 3 min)': 'Tutorial (about 3 min)',
  'Pomiń, znam grę': 'Skip, I know the game',
  'Samouczek i słowniczek znajdziesz też pod „?”.': 'You’ll also find the tutorial and the glossary under “?”.',
  'Samouczek, krok {0} z {1}': 'Tutorial, step {0} of {1}',
  '✓ Zrobione': '✓ Done',
  'Pomiń': 'Skip',
  'Zakończ': 'Finish',
  // tour.ts: komunikat w biegu rankingowym (toast, przez `tr`)
  'Samouczek działa w zwykłym sklepie.': 'The tutorial only runs in a regular shop.',
  // overlays.tsx (⚙) i HowTo.tsx
  'Samouczek': 'Tutorial',
  'Podpowiedzi przy pierwszych zdarzeniach': 'Tips the first time things happen',
  'Słowniczek': 'Glossary',

  // steps.ts: kroki przelotu
  'Witaj w Traszce': 'Welcome to Traszka',
  'Prowadzisz sklep Traszki na franczyzie. Cel: dojść do rangi „{0}” i nie stracić umowy z Centralą. Czas stoi, dopóki nie skończymy.':
    'You run a Traszka shop as a franchisee. Goal: reach the rank of “{0}” without losing your agreement with Head Office. Time stands still until we’re done.',
  'Czas': 'Time',
  '❚❚ zatrzymuje grę (także spacja), ×1–×8 przyspiesza. Doba przy ×1 trwa ok. {0}. Teraz czas stoi: samouczek trzyma pauzę.':
    '❚❚ pauses the game (so does Space), ×1–×8 speed it up. A day at ×1 lasts about {0}. Right now time is stopped: the tutorial is holding the pause.',
  'Tu jest zarządzanie: Sklep (kolejka, półki, remanent), Palety, Ludzie, Ulepszenia i Cele. Drugie stuknięcie zamyka zakładkę.':
    'This is where you run things: Shop (queue, shelves, stocktake), Pallets, Staff, Upgrades and Goals. Tap a tab again to close it.',
  'Otwórz Palety.': 'Open Pallets.',
  'Zamówienie': 'Ordering',
  'Zamawiasz ręcznie. Gdy zechcesz, Asystent Traszki policzy za Ciebie: przełącznik jest tutaj.':
    'You’re ordering by hand. Whenever you like, the Traszka Assistant will do the maths for you: the switch is here.',
  'Domyślnie zamawia Asystent Traszki. Zwykle trochę przesadza, bo „klienci to kochają”. Ręcznie sam ustawiasz liczbę palet na jutro.':
    'By default the Traszka Assistant does the ordering. It usually overdoes it a bit, because “customers love it”. By hand, you set tomorrow’s number of pallets yourself.',
  'Przełącz na „Ręcznie”.': 'Switch to “By hand”.',
  'Teraz liczbę palet ustawiasz przyciskami − i +. Na początek zostaw to Asystentowi: liczy za Ciebie.':
    'Now you set the number of pallets with the − and + buttons. For a start, leave it to the Assistant: it does the maths for you.',
  'Wróć do „Asystent Traszki”.': 'Go back to “Traszka Assistant”.',
  'Gdzie stoją palety': 'Where pallets go',
  'Pod sklepem grozi mandat Straży Miejskiej. Zaplecze jest bezpieczne, ale małe. W sali i w przejściach palety przeszkadzają klientom, a ⭐ reputacja spada. {0}':
    'On the pavement outside you risk a fine from the City Wardens. The stockroom is safe but small. On the shop floor and in the aisles, pallets get in customers’ way and your ⭐ reputation drops. {0}',
  '„+” zatrudnia, „−” zwalnia. {0} Niżej ustawiasz, czym ludzie zajmują się najpierw. Samouczek niczego tu nie kupi.':
    '“+” hires, “−” lets someone go. {0} Below, you set what your staff do first. The tutorial won’t buy anything here.',
  'Sprzęt do slotów, szkolenia i remont, który powiększa sklep. {0}': 'Equipment for your slots, training, and the refit that makes the shop bigger. {0}',
  'Cele i rozwój': 'Goals and growth',
  'Cel tygodnia od Centrali daje XP, {0}. Poziomy odblokowują sprzęt i remonty. Kamienie milowe dają Ogonki 🦎: „Odbierz”.':
    'The weekly goal from Head Office gives XP, {0}. Levels unlock equipment and refits. Milestones give Ogonki 🦎: tap “Claim”.',
  'Po {0}. remoncie albo na {1}. poziomie otworzysz kolejną Traszkę.': 'After refit no. {0} or at level {1} you can open another Traszka.',
  'Karty decyzji': 'Decision cards',
  'Codziennie może przyjść karta: sprawa od Centrali albo od życia. Gra czeka, aż wybierzesz. Koszty i zyski są na przyciskach, a domyślna odpowiedź jest zaznaczona.':
    'Any day a card may turn up: something from Head Office, or from life itself. The game waits until you choose. Costs and gains are on the buttons, and the default answer is already selected.',
  'Czas rusza': 'Time starts',
  'Twoje ręce: 📦 rozładowuje najpilniejszą paletę, 🧾 obsługuje klienta, gdy kasa się korkuje. Każde stuknięcie zjada siły z paska nad przyciskami.':
    'Your own two hands: 📦 unloads the most urgent pallet, 🧾 serves a customer when the till gets jammed. Every tap uses up energy from the bar above the buttons.',
  'Stuknij 📦.': 'Tap 📦.',
  'Więcej informacji': 'More information',
  'Pod „?” jest instrukcja, słowniczek (saldo, wyciąg, raty, remanent…) i ten samouczek. Przy pierwszych zdarzeniach podpowiemy jeszcze krótko.':
    'Under “?” you’ll find the instructions, a glossary (balance, statement, instalments, stocktake…) and this tutorial. The first time things happen, we’ll add a quick tip.',

  // money.ts: kroki i dymki o pieniądzach (SIM 6)
  'Twoje pieniądze na zakupy, rekrutację i mandaty. W trakcie miesiąca rusza się mało, bo marża tu nie wpada.':
    'Your money for purchases, recruitment and fines. It barely moves during the month, because your margin doesn’t land here.',
  'Od {0} Centrala ostrzega, a przy {1} kończy współpracę.': 'From {0} Head Office warns you, and at {1} it ends the partnership.',
  'Tu wpada marża ze sprzedaży i premie. Widać je, ale go nie wydasz: Centrala odda je przelewem przy zamknięciu miesiąca.':
    'Your sales margin and bonuses land here. You can see the balance, but you can’t spend it: Head Office pays it out by transfer when the month closes.',
  'Raty i „Zostanie”': 'Instalments and “keep”',
  'Przy zamknięciu Centrala potrąca z przelewu raty i palety, a Ty płacisz pensje, media, ZUS, VAT i księgową.':
    'At closing, Head Office deducts instalments and pallets from the transfer, and you pay wages, utilities, ZUS (Polish social security), VAT and your accountant.',
  'Reszta to „Zostaje Ci” i wpada do gotówki. Stuknięcie w ten pasek pokaże wyciąg.':
    'What’s left is “You keep”, and it goes into your cash. Tap this bar to see the statement.',
  'Od 0 do 100, na start {0}. Od niego zależą premia od obrotu i limit rat. Przy zerze na koniec miesiąca umowa się kończy.':
    'From 0 to 100, starting at {0}. It decides your turnover bonus and your instalment limit. At zero at the end of a month, the agreement ends.',
  'Nadmiar towaru się przeterminuje, a rachunek przyjdzie przy remanencie.': 'Surplus stock goes out of date, and the bill arrives at the stocktake.',
  'Rekrutacja to {0} z gotówki, a każda osoba na zmianie kosztuje {1} dziennie, płatne przy zamknięciu miesiąca.':
    'Recruiting costs {0} from your cash, and each person on shift costs {1} a day, paid when the month closes.',
  'Płacisz gotówką albo na raty: Centrala potrąci je z kolejnych przelewów. Za gotówkę zawsze taniej.':
    'You pay in cash or in instalments: Head Office deducts them from the following transfers. Cash is always cheaper.',
  'premię na saldo i zaufanie Centrali': 'a bonus to your balance and Head Office’s trust',
  'Wyciąg od Centrali. Przelew (marża, premie) minus potrącenia (raty, palety) minus Twoje koszty daje „Zostaje Ci”:':
    'The Head Office statement. The transfer (margin, bonuses) minus deductions (instalments, pallets) minus your costs gives “You keep”:',
  'tyle właśnie wpadło do gotówki. Słowniczek: „?”.': 'that’s exactly what just went into your cash. Glossary: “?”.',
  'Remanent. Co {0} {1} Centrala liczy ubytki:': 'Stocktake. Every {0} {1} Head Office counts the shrinkage:',
  'przeterminowany towar, kradzieże, pomyłki. Ponad limit płacisz Ty, z dzisiejszego przelewu.':
    'out-of-date stock, theft, mistakes. Anything over the limit you pay yourself, out of today’s transfer.',

  // tips.ts: dymki „pierwszy raz”
  'Tu „Odbierz”. Centrala lubi, jak się o coś prosi.': 'Tap “Claim” here. Head Office likes to be asked nicely.',
  'Cel spełniony. Nagroda nie przyjdzie sama: stuknij 🎁.': 'Goal reached. The reward won’t come to you: tap 🎁.',
  'Rozładuj ją albo przenieś na wolne miejsce. Na przyszłość: mniej palet w zamówieniu.':
    'Unload it or move it to a free spot. Next time: fewer pallets in the order.',
  'Zabrakło miejsc: palety stoją w przejściach, a klienci się o nie potykają. Zajrzyj do Palet.':
    'Out of space: pallets are standing in the aisles and customers are tripping over them. Have a look at Pallets.',
  'Karta decyzji. Gra czeka, aż wybierzesz. Koszty i zyski są na przyciskach, a domyślna odpowiedź jest już zaznaczona.':
    'A decision card. The game waits until you choose. Costs and gains are on the buttons, and the default answer is already selected.',
};

export const TUTORIAL_PLURALS: Plurals = {};
