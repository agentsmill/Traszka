# Etap 2: podział na strumienie i wspólne kontrakty

Status: ustalenia kontrolera (2026-10-28), wiążą strumienie etapu 2 · Spec: `2026-10-27-traszka-tycoon-design.md` (§6.5, §7.5, §14.7) · Źródła: przegląd końcowy etapu 1 (I5, L1–L14, M1–M15) i spis poleceń gry z 2026-10-28.

Etap 2 dzieli się na trzy strumienie. Każdy pracuje na własnej gałęzi, sam pisze swój szczegółowy plan i nie pushuje na `main`. Gałęzie scala sesja koordynatora, a push na `main` wymaga zgody użytkownika.

## 1. Strumienie i właściciele plików

| Strumień | Cel | Pliki, które wolno mu zmieniać |
|---|---|---|
| **A. Fundament** | Polecenia gracza jako obiekty i jedno `applyCommand` w symulacji; dziennik poleceń i odtwarzanie biegu; rozbicie `main.ts`; mocniejszy test architektury; prawdziwa wersja gry w zapisie | `src/main.ts` i nowe `src/game/{controls,scene,actions,frame}.ts`, `src/sim/economy/commands.ts`, `src/sim/run.ts`, `layoutFor` przeniesione do `src/sim/store/`, `src/game/session.ts`, `src/sim/economy/*` (tylko pod polecenia i zakazy z §3), `src/ui/state.ts` (API akcji), `tests/architecture.test.ts`, `vite.config.ts` |
| **B. Ranking** | Funkcje serwerowe na Vercelu, Upstash, klucz gracza, rezerwacja nicka, kod odzyskiwania, przenoszenie zapisu, strona rankingu (§14.7) | `api/**`, `src/server/**`, `src/sim/ranked.ts`, `src/ui/ranking/**`, `src/game/playerKey.ts`, pole klucza w `src/game/meta.ts` |
| **C. Tycoon, część 1** | Czyste moduły §6.5 i §7.5: pula czasu ludzi, śmieci i czystość, pula sił, karty decyzji, raport miesięczny, boty do testu balansu | tylko nowe pliki w `src/sim/economy/tycoon/**` (z testami) |

Później, po scaleniu A: **C, część 2** wpina moduły w `economy.ts`, polecenia i interfejs; **B, część 2** podpina prawdziwe odtwarzanie i tryb rankingowy. Drobne poprawki z przeglądu etapu 1 (R22 „ściany w dół” dla mebli przyściennych, M13 dostępność, M14 klienci w palecie, M12 benchmark gry) mogą iść osobnym, małym strumieniem w dowolnym momencie.

## 2. Kontrakty (A dostarcza, B i C piszą pod te nazwy)

```ts
// src/sim/economy/commands.ts — jedyne miejsce, które zmienia EconomyState w odpowiedzi na gracza
export type Command =
  | { type: 'tapPallet'; palletId?: number }          // bez mnożnika combo: combo liczy symulacja (L1)
  | { type: 'tapTill' }
  | { type: 'claimQuest'; questId: number }
  | { type: 'claimGift' }                              // okno prezentu ustala symulacja (L3); C2 przemaluje na okólnik
  | { type: 'movePallet'; palletId: number; loc: PalletLoc }
  | { type: 'returnPallet'; palletId: number }
  | { type: 'setOrder'; auto: boolean; manual?: number }
  | { type: 'hire' } | { type: 'fire' }
  | { type: 'setPriority'; priority: Priority }        // C2 zastąpi priorytetami czterech zadań (§6.5)
  | { type: 'buyUpgrade'; id: UpgradeId }
  | { type: 'buyEquipment'; id: EquipmentId; slotId?: string }
  | { type: 'startRemont' } | { type: 'campaign' } | { type: 'rushRemont' };

export interface CommandOutcome { result: CommandResult; events: EconEvent[]; layoutChanged: boolean }
/** Waliduje, stosuje, uruchamia processLevels i (gdy zmienił się poziom remontu) relayout z layoutFor(state.seed, level). */
export function applyCommand(state: EconomyState, info: StoreInfo, cmd: Command): CommandOutcome;

// src/sim/run.ts — dziennik i odtwarzanie
export interface LogEntry { minute: number; seq: number; cmd: Command }   // minute = state.minute w chwili polecenia
export interface RunRecord {
  seed: string; gameVersion: string; generatorVersion: number;
  mode: 'casual' | 'ranked'; log: LogEntry[];
}
/** Świeży sklep z seeda (partner = 0 w trybie ranked), kroki stepMinute, polecenia w kolejności (minute, seq). Czyste. */
export function replayRun(run: RunRecord, untilMinute: number): EconomyState;
```

- Poza dziennikiem (tylko gra zwykła, w trybie rankingowym zabronione): nagroda za nieobecność i seria dni (`grantOffline`, `grantDaily`), prestiż i Punkty Partnera, `skip` z uchwytu debugowania.
- `src/sim/ranked.ts` (B): `RANKED_SEASON_END_MINUTE` (koniec listopada, trzy raporty miesięczne) i `seasonScore(state): number` = suma zysków trzech raportów z `history`.
- Moduły C to czyste funkcje na własnych, serializowalnych do JSON wycinkach stanu, z notatką „jak to wpiąć w `stepMinute`” dla C2. Nazwy i kształty wybiera C.

## 3. Zasady wspólne

- **Czysta symulacja.** `src/sim` bez `three`, `Math.random`, `Date`, `performance`, `localStorage`, `window`, importów z `render`/`ui`/`game`, bez `Math.hypot`, `Math.log*`, potęg o ułamkowym wykładniku i trygonometrii w ekonomii i generatorze (różne silniki JS mogą różnie zaokrąglać; L8). A dopisuje to do testu architektury; B i C przestrzegają od początku.
- **Losowość** tylko przez `rand01(seedHash, a, b)`. Kanały 100–199 są zarezerwowane dla modułów C, żeby nie kolidowały z istniejącymi (przyjścia, mandaty, prezenty, zadania).
- **Teksty** sformatowane `toLocaleString` nie trafiają do stanu (L9): stan trzyma liczby, interfejs formatuje.
- **Sekrety** nigdy w repozytorium (jest publiczne). Upstash przez zmienne środowiskowe `KV_REST_API_URL` i `KV_REST_API_TOKEN`; testy na atrapie.
- **Każda gałąź** ma zielone `npm test`, `npm run typecheck`, `npm run build`. Commity po polsku, ze stopką autorstwa.

## 4. Kolejność scalania

1. K3 z poprawkami i ten dokument → `main` (push za zgodą).
2. A, kamień 1: `commands.ts`, `applyCommand`, `run.ts` z `replayRun`, `layoutFor` w symulacji, test architektury → scalenie; B i C dociągają `main`.
3. C, część 1 (same nowe pliki) → scalenie.
4. A, kamień 2: rozbity `main.ts`, interfejs wysyła polecenia przez dziennik → scalenie.
5. C, część 2 (wpięcie tycoona w ekonomię i interfejs) → scalenie.
6. B, część 2 (tryb rankingowy z prawdziwym `replayRun`, ostateczne zasady ekonomii) → scalenie i wdrożenie za zgodą.
