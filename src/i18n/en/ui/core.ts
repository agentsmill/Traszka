import type { Dict, Plurals } from '../ui';

/*
 * Teksty wspólne dla całej gry: komunikaty warstwy gry (`src/game`: toasty, okna „OK”, paski z komunikatem), komunikaty
 * renderera i stałe, które pokazuje kilka ekranów. Warstwa gry zostaje bez zmian, a jej stałe tłumaczy się przy wyświetlaniu.
 */

export const CORE_UI: Dict = {
  // src/game/actions.ts
  'Nie udało się przebudować sklepu po remoncie. Postęp jest zapisany — odśwież stronę.':
    'The shop couldn’t be rebuilt after the refit. Your progress is saved — refresh the page.',
  'Nie udało się przebudować sklepu po remoncie. Ten sklep jest tymczasowy — odśwież stronę, żeby wrócić do swojego.':
    'The shop couldn’t be rebuilt after the refit. This shop is temporary — refresh the page to get back to your own.',
  'Sezon dobiegł końca.': 'The season is over.',
  'Umowa wypowiedziana: bieg się zakończył.': 'Agreement terminated: the run is over.',
  'Dziennik biegu rankingowego jest pełny.': 'The ranked run’s command log is full.',
  'Dziennik biegu jest prawie pełny: ręczne stukanie się skończyło. Zakupy i decyzje działają dalej.':
    'The run’s command log is almost full: no more manual tapping. Purchases and decisions still work.',
  'Zaufanie Centrali': 'Head Office’s trust',
  'Remont zakończony': 'Refit finished',
  'Blisko granicy debetu': 'Close to the debt limit',
  'Ważne zdarzenie': 'Important event',
  'Zapis biegu rankingowego był uszkodzony. Kopia została w przeglądarce.': 'The ranked run’s save was damaged. A copy has been kept in the browser.',
  'Zapisany bieg rankingowy powstał w innej wersji gry i nie da się go wznowić. Możesz go porzucić w ustawieniach.':
    'The saved ranked run was made in a different version of the game and can’t be resumed. You can abandon it in Settings.',
  'Ten bieg powstał w starszej wersji gry i nie trafi do rankingu. Możesz go dograć dla zabawy albo zacząć nowy.':
    'This run was made in an older version of the game and won’t go on the leaderboard. You can finish it for fun or start a new one.',
  'Przeglądarka nie ma miejsca na zapis biegu rankingowego. Gra toczy się dalej, ale po zamknięciu karty bieg przepadnie.':
    'Your browser has no room to save the ranked run. The game carries on, but the run will be lost when you close the tab.',
  'Nie udało się wznowić biegu rankingowego. Zapis jest bezpieczny, spróbuj odświeżyć stronę.':
    'Couldn’t resume the ranked run. The save is safe; try refreshing the page.',
  'Ten bieg nie liczy się do rankingu.': 'This run doesn’t count for the leaderboard.',
  'Przeglądarka nie ma miejsca na zapis wyniku. Wyślij go teraz, zanim zamkniesz kartę.':
    'Your browser has no room to save the result. Send it now, before you close the tab.',
  'Nie udało się podliczyć wyniku biegu. Zapis biegu zostaje w przeglądarce, odśwież stronę.':
    'Couldn’t tally the run’s result. The run’s save stays in the browser; refresh the page.',
  'W biegu rankingowym nie ma sieci sklepów.': 'There’s no shop network in a ranked run.',
  'W biegu rankingowym nie zaczyna się od nowa. Porzuć bieg w ustawieniach.': 'You can’t start over in a ranked run. Abandon the run in Settings.',
  'Bieg przyjęty do rankingu.': 'Run accepted onto the leaderboard.',
  'Kolejną Traszkę otworzysz po odświeżeniu strony: ta karta nie może teraz zapisać sieci sklepów.':
    'You can open your next Traszka after refreshing the page: this tab can’t save the shop network right now.',
  'NOWA TRASZKA!': 'NEW TRASZKA!',
  // src/game/session.ts, boot.ts, seeds.ts, rankedRun.ts
  'Zapis sklepu był uszkodzony — zaczynamy od nowa. Kopia została w przeglądarce.': 'The shop’s save was damaged — starting over. A copy has been kept in the browser.',
  'Zapis sklepu był uszkodzony — zaczynamy od nowa.': 'The shop’s save was damaged — starting over.',
  'Zapis pochodzi z nowszej wersji gry — odśwież stronę': 'This save comes from a newer version of the game — refresh the page',
  'Nie udało się zbudować Twojego sklepu — zapis jest bezpieczny, spróbuj odświeżyć stronę':
    'Your shop couldn’t be built — the save is safe; try refreshing the page',
  'Zapis wczytany.': 'Save loaded.',
  'Ten lokal się nie zmieścił, otwieramy sąsiedni': 'That unit didn’t fit, so we’re opening the one next door',
  'Wczytujemy Twój sklep spod tego seeda': 'Loading your shop from this seed',
  'Ten bieg nie trafi do rankingu: Centrala wypowiedziała umowę przed ostatnim raportem sezonu.':
    'This run won’t go on the leaderboard: Head Office terminated your agreement before the season’s final report.',
  // src/render/renderer.ts
  'Twoja przeglądarka nie obsługuje pełnej grafiki. Włączyliśmy tryb oszczędny.': 'Your browser doesn’t support full graphics. We’ve switched to low-power mode.',
  'Twoja przeglądarka nie obsługuje WebGL 2, więc gra nie może się uruchomić. Spróbuj aktualnej wersji Chrome, Edge, Firefox lub Safari.':
    'Your browser doesn’t support WebGL 2, so the game can’t start. Try an up-to-date version of Chrome, Edge, Firefox or Safari.',
  // ui/Notice.tsx
  'Zamknij komunikat': 'Close message',
};

export const CORE_PLURALS: Plurals = {};
