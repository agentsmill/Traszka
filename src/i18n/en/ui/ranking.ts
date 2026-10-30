import type { Dict, Plurals } from '../ui';

/*
 * Ranking (`ui/ranking/*`): panel rankingu, kod odzyskiwania i zapis, okno końca sezonu, komunikaty modeli (`finishModel.ts`,
 * `recoveryModel.ts`, `rankingModel.ts`, `client.ts`, `saveTransfer.ts`). Modele trzymają polski tekst, a okna tłumaczą go przez `tr`;
 * komunikaty serwera (po kodzie błędu) są w `en/api.ts`.
 */

export const RANKING_UI: Dict = {
  // RankingPanel.tsx
  'Globalny': 'Global',
  'Ten seed': 'This seed',
  'Centrala liczy słupki…': 'Head Office is crunching the numbers…',
  'Nikt jeszcze nie oddał raportu. Pierwsze miejsce czeka, razem z dyplomem z drukarki Centrali.':
    'Nobody has handed in a report yet. First place is waiting, along with a certificate fresh from Head Office’s printer.',
  'Wyniki trafiają tu z trybu rankingowego: trzy miesiące na jednym seedzie, bez premii z sieci sklepów.':
    'Scores come from ranked mode: three months on a single seed, no shop-network bonuses.',
  'Wszystkie seedy. Wynik to suma trzech raportów miesięcznych, wrzesień–listopad.': 'All seeds. The score is the sum of three monthly reports, September to November.',
  'ostatnie godziny': 'final hours',
  'Seed sklepu: {0}': 'Shop seed: {0}',
  'Seed tygodnia: {0} · {1}': 'Seed of the week: {0} · {1}',
  'Masz niewysłany bieg (wynik {0}).': 'You have an unsent run (score {0}).',
  'Wyślij': 'Send',
  'Rodzaj rankingu': 'Leaderboard type',
  'Spróbuj jeszcze raz': 'Try again',
  '(Ty)': '(you)',
  'seed nieznany': 'unknown seed',
  'Twoje miejsce: {0}. ({1})': 'Your position: #{0} ({1})',
  // rankingModel.ts, client.ts
  'Najpierw otwórz sklep: ranking „Ten seed” pokazuje wyniki z seeda Twojego sklepu.': 'Open a shop first: the “This seed” leaderboard shows scores from your shop’s seed.',
  'Brak połączenia z Centralą. Sprawdź internet i spróbuj jeszcze raz.': 'No connection to Head Office. Check your internet and try again.',
  'Ranking jest teraz nieczynny. Centrala robi inwentaryzację, zajrzyj później.': 'The leaderboard is closed right now. Head Office is doing a stocktake; check back later.',
  // RecoveryPanel.tsx, recoveryModel.ts, saveTransfer.ts
  'To Twój klucz do rankingu. Wpisany na innym urządzeniu przenosi nick i zapis gry. Zapisz go i nikomu nie pokazuj: kto ma kod, ten ma Twój nick.':
    'This is your leaderboard key. Entered on another device, it carries over your name and saved game. Write it down and don’t show it to anyone: whoever has the code has your name.',
  'Zastąp klucz': 'Replace key',
  'Zastąp zapis': 'Replace save',
  'Zastąp': 'Replace',
  'Na serwerze leży kopia z {0}, której to urządzenie jeszcze nie widziało. Zastąpić ją tym zapisem?':
    'There’s a copy on the server from {0} that this device hasn’t seen yet. Replace it with this save?',
  'Pobrać zapis wysłany {0}? Zastąpi na tym urządzeniu ten sklep, sieć sklepów, Punkty Partnera i kasjera. Inne sklepy zostaną.':
    'Download the save sent on {0}? On this device it will replace this shop, your shop network, Partner Points and cashier. Other shops will stay.',
  'Ten kod zastąpi klucz tego urządzenia. Obecny kod ({0}) przestanie tu działać, więc zapisz go, jeśli ma do czegoś wrócić.':
    'This code will replace this device’s key. The current code ({0}) will stop working here, so write it down if you might want it back.',
  'Ten kod stanie się kluczem tego urządzenia.': 'This code will become this device’s key.',
  'Kod odzyskiwania': 'Recovery code',
  'Ukryj kod': 'Hide code',
  'Pokaż kod': 'Show code',
  'Kopiuj': 'Copy',
  'Kod z innego urządzenia': 'Code from another device',
  'Użyj kodu': 'Use code',
  'Ten kod nie ma jeszcze nicka w rankingu.': 'This code doesn’t have a name on the leaderboard yet.',
  'Graj jako {0}': 'Play as {0}',
  'Zapis gry': 'Saved game',
  'Jedna kopia na kod, do 64 KB. Nowe wysłanie zastępuje poprzednie.': 'One copy per code, up to 64 KB. Sending again replaces the previous one.',
  'Wyślij zapis': 'Upload save',
  'Pobierz zapis': 'Download save',
  'Potwierdzenie': 'Confirmation',
  'Kod pojawi się, gdy otworzysz pierwszy sklep.': 'The code appears once you open your first shop.',
  'To już jest kod tego urządzenia. Centrala docenia zaangażowanie.': 'That’s already this device’s code. Head Office appreciates your commitment.',
  'Nie ma jeszcze czego wysłać: otwórz sklep i zagraj choć chwilę.': 'Nothing to send yet: open a shop and play for a bit.',
  'Kod skopiowany. Schowaj go lepiej niż klucz do zaplecza.': 'Code copied. Hide it better than the stockroom key.',
  'Nie udało się skopiować. Przepisz kod ręcznie, Centrala też tak robi.': 'Couldn’t copy it. Copy the code out by hand; that’s how Head Office does it too.',
  'Kod przyjęty: to urządzenie gra teraz Twoim kluczem.': 'Code accepted: this device now plays with your key.',
  'Zapis czeka na wczytanie. Przeładowujemy…': 'The save is waiting to be loaded. Reloading…',
  'To nie jest zapis Traszki. Centrala nie przyjmuje cudzych segregatorów.': 'This isn’t a Traszka save. Head Office doesn’t accept other people’s binders.',
  'Przeglądarka nie ma miejsca na zapis. Zwolnij trochę pamięci i spróbuj jeszcze raz.': 'Your browser has no room for the save. Free up some space and try again.',
  // FinishWindow.tsx, finishModel.ts
  'Koniec sezonu': 'End of season',
  'Odrzucić ten bieg? Wyniku z tego sezonu nie da się potem odzyskać.': 'Discard this run? You won’t be able to get this season’s score back afterwards.',
  'Odrzucenie biegu': 'Discarding the run',
  'Tak, odrzuć': 'Yes, discard',
  'Wynik sezonu:': 'Season score:',
  'Seed sezonu: {0}': 'Season seed: {0}',
  'Miejsce w rankingu globalnym: {0}': 'Global leaderboard position: {0}',
  'Miejsce na seedzie „{0}”: {1}': 'Position on seed “{0}”: {1}',
  'Miejsce w rankingu tygodnia: {0}': 'Weekly leaderboard position: {0}',
  'Tym razem poza listami rankingu.': 'Off the leaderboards this time.',
  'Nowy rekord życiowy': 'New personal best',
  'Twój najlepszy wynik: {0}': 'Your best score: {0}',
  'Nick w rankingu': 'Leaderboard name',
  'Wyślij do rankingu': 'Send to the leaderboard',
  'Odrzuć bieg': 'Discard run',
  'Sezon zamknięty. Centrala przeliczy Twój raport i wpisze go do rankingu.': 'Season closed. Head Office will recalculate your report and put it on the leaderboard.',
  'Wysyłamy raport do Centrali…': 'Sending your report to Head Office…',
  'Raport przyjęty.': 'Report accepted.',
  'Ten nick jest zajęty. Wybierz inny — bieg zostaje u Ciebie.': 'That name is taken. Pick another — the run stays with you.',
  'Ta wersja gry jest nieaktualna. Odśwież stronę. Bieg zostaje w przeglądarce jako niewysłany.':
    'This version of the game is out of date. Refresh the page. The run stays in your browser as unsent.',
  'Spróbuj później. Bieg zostaje w przeglądarce, a wysłać go możesz z panelu rankingu i z ustawień.':
    'Try again later. The run stays in your browser, and you can send it from the leaderboard panel or from Settings.',
  'Centrala odrzuciła ten bieg. Możesz go odrzucić albo spróbować jeszcze raz.': 'Head Office rejected this run. You can discard it or try again.',
  'Brak klucza gracza. Odśwież stronę i spróbuj jeszcze raz.': 'No player key. Refresh the page and try again.',
  'Nie ma biegu do wysłania.': 'There’s no run to send.',
};

export const RANKING_PLURALS: Plurals = {};
