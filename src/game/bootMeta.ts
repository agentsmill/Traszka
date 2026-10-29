import type { Meta } from './meta';
import { ensurePlayerKey, keepPlayerKey } from './playerKey';
import { playerOf, type StartChoice } from './start';

/**
 * Meta po wyborze gracza: jedyne miejsce, w którym wybór z ekranu startowego staje się graczem w mecie (rozruch w main.ts i ekran
 * „Nowy sklep” w `openChosenStore`), żeby klucz do rankingu (`player.key`) nie ginął w żadnej z dwóch dróg.
 *
 * Z `entry` (wybór z ekranu startowego) gracz powstaje z wyboru (nick, wygląd kasjera, przełącznik strojów), ale z kluczem poprzedniego
 * gracza (`keepPlayerKey`): zmiana nicka albo kasjera nie może zgubić klucza, a z nim wszystkich nicków gracza w rankingu. Bez `entry`
 * (gracz jest już w mecie) meta zostaje taka, jaka była, tylko gracz sprzed rankingu, który nie ma jeszcze klucza, dostaje go teraz.
 * W obu drogach klucz dopisuje `ensurePlayerKey`: tylko graczowi, który go nie ma, i nigdy w mecie z nowszej wersji gry (ta i tak się
 * nie zapisze, więc klucz zginąłby po odświeżeniu). Gracz z wyboru jest w pamięci także wtedy, gdy meta jest tylko do odczytu („ta
 * karta ma gracza”).
 *
 * Czysta funkcja: zwraca nową metę albo tę samą, gdy nic się nie zmieniło (wołający porównuje referencje i zapisuje tylko zmienioną;
 * `saveMeta` pomija metę tylko do odczytu). Klucza nie wolno logować ani pokazywać w komunikatach.
 */
export function bootMeta(loaded: Meta, entry: StartChoice | null): Meta {
  const meta = entry ? { ...loaded, player: keepPlayerKey(loaded.player, playerOf(entry)) } : loaded;
  return ensurePlayerKey(meta);
}
