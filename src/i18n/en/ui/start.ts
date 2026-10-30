import type { Dict, Plurals } from '../ui';

/* Ekran startowy „Twój kasjer” (`ui/start/StartScreen.tsx`, `rankedAsk.ts`, `weekSeed.ts`) i okno „Jak grać” (`ui/howto/HowTo.tsx`). */

export const START_UI: Dict = {
  // nazwy strojów (`OUTFIT_LABEL`, przez `tr`)
  'Bluza z kapturem': 'Hoodie',
  'Koszulka i dżinsy': 'T-shirt and jeans',
  'Garnitur': 'Suit',
  'Kamizelka robocza': 'Work waistcoat',
  'Ogrodniczki': 'Dungarees',
  'Strój plażowy': 'Beachwear',
  'Punk': 'Punk',
  'Codzienny strój': 'Everyday outfit',
  'Garsonka': 'Skirt suit',
  'Sukienka': 'Dress',
  'Strój roboczy': 'Workwear',
  'Punkówa': 'Punk rocker',
  'Kosmonauta': 'Astronaut',
  'Król': 'King',
  'Antyterrorysta': 'SWAT officer',
  'Poszukiwacz przygód': 'Adventurer',
  'Pilotka z przyszłości': 'Pilot from the future',
  'Poszukiwaczka przygód': 'Explorer',
  'Czarownica': 'Witch',
  'Strój średniowieczny': 'Medieval dress',
  'Żołnierka': 'Soldier',
  // StartScreen.tsx
  'Trzy miesiące na jednym seedzie, bez premii z sieci. Wynik wyślesz po sezonie; gdy ranking nie działa, bieg poczeka w przeglądarce. Bankructwo przed ostatnim raportem sezonu wyklucza bieg z rankingu.':
    'Three months on a single seed, no network bonuses. You send your score after the season; if the leaderboard is down, the run waits in your browser. Going bankrupt before the season’s final report disqualifies the run.',
  'Otwieramy…': 'Opening…',
  'Porzuć i zacznij': 'Abandon and start',
  'Wróć': 'Back',
  'Twój kasjer': 'Your cashier',
  'Wybierz, kto stanie za ladą, wpisz nazwę i seed sklepu, i otwieramy.': 'Choose who stands behind the counter, enter your name and a shop seed, and we’ll open up.',
  'Wygląd kasjera': 'Cashier’s look',
  'Podgląd kasjera: {0}': 'Cashier preview: {0}',
  'Podgląd 3D jest niedostępny na tym urządzeniu, kasjera zobaczysz w sklepie.': 'The 3D preview isn’t available on this device; you’ll see your cashier in the shop.',
  'Wczytuję kasjerów…': 'Loading cashiers…',
  'Wczytuję strój…': 'Loading outfit…',
  'Strój kasjera': 'Cashier’s outfit',
  'Poprzedni strój': 'Previous outfit',
  'Następny strój': 'Next outfit',
  '🎲 Losuj': '🎲 Random',
  'Stroje specjalne w losowaniu': 'Special outfits in the draw',
  'Nazwa gracza': 'Player name',
  'np. Mateusz': 'e.g. Mateusz',
  'Seed sklepu': 'Shop seed',
  'dowolny tekst': 'any text',
  'Wylosuj seed': 'Random seed',
  'Dowolny tekst. Ten sam seed to ten sam sklep, a każdy seed ma własny zapis gry.': 'Any text. The same seed gives the same shop, and each seed has its own saved game.',
  'Otwieramy sklep!': 'Open the shop!',
  'Start rankingowy': 'Ranked start',
  'Wróć do gry': 'Back to the game',
  // weekSeed.ts (przez `tr`)
  'Seed tygodnia': 'Seed of the week',
  'Pytamy Centralę…': 'Asking Head Office…',
  'Seed tygodnia jest teraz niedostępny': 'The seed of the week isn’t available right now',
  // rankedAsk.ts
  'Zacząć nowy i porzucić tamten?': 'Start a new one and abandon that one?',
  'Masz niewysłany bieg. {0}': 'You have an unsent run. {0}',
  'Masz niewysłany bieg (wynik {0}). {1}': 'You have an unsent run (score {0}). {1}',
  'Masz rozpoczęty bieg rankingowy. {0}': 'You have a ranked run in progress. {0}',
  'Masz rozpoczęty bieg rankingowy (dzień {0} z {1}). {2}': 'You have a ranked run in progress (day {0} of {1}). {2}',
  // HowTo.tsx
  'Jak grać': 'How to play',
  'Zaczynamy': 'Let’s go',
};

export const START_PLURALS: Plurals = {};
