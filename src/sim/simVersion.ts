/**
 * Wersja wyniku symulacji dla rankingu. Serwer rankingu przyjmuje bieg tylko wtedy, gdy jego `simVersion` równa się `SIM_VERSION`
 * z bundla sędziego, bo wtedy `replayRun` dla (seed, dziennik poleceń) daje na serwerze ten sam stan co w grze. Wersja z commita
 * się tu nie nadaje: zmienia się przy każdym wdrożeniu, więc bieg zaczęty przed wdrożeniem nie mógłby już przejść.
 *
 * Podbij o 1 przy każdej zmianie, po której `replayRun` dla tego samego seeda i dziennika daje inny stan: ekonomia (stałe w
 * `catalog.ts`, ulepszenia, zlecenia, krok minuty), generator sklepu, polecenia (`commands.ts`), kolejność odtwarzania (`run.ts`).
 * NIE podbijaj przy zmianach interfejsu, renderu i dźwięków ani przy refaktorach, które nie zmieniają wyniku. Skrót w teście obejmuje
 * cały stan, więc zmiana kształtu stanu, także samych napisów w nim (`comment` Centrali, `label` raportu), też wymaga podbicia
 * (bezpieczniej o jedno podbicie za dużo niż odrzucić uczciwy bieg, który wynik policzyłby inaczej).
 *
 * Pilnuje tego `tests/simGolden.test.ts`: odtwarza stały bieg i porównuje skrót stanu z tabelą `GOLDEN`. Podbicie wymaga
 * dopisania do `GOLDEN` nowego wpisu (nowa wersja → nowy skrót; test przy zmianie wyniku sam drukuje gotowy wpis).
 *
 * Skutek podbicia: bieg zaczęty przed nim ma starą wersję i nie przejdzie już na serwerze; gra trzyma taki niewysłany bieg lokalnie.
 *
 * Plik nie ma importów, bo trafia do bundla sędziego na serwerze.
 */
export const SIM_VERSION = 5;
