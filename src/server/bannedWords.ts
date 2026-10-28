/**
 * Zakazane słowa w nickach i seedach (spec §14.7: nick przechodzi filtr zakazanych słów; seedy też widać w rankingu). To rdzenie
 * w postaci szkieletu (`moderation.ts`: małe litery, bez polskich znaków i separatorów), szukane jako fragment tekstu, więc „kurw”
 * łapie każdą odmianę. Lista robocza: do przejrzenia i uzupełnienia przez właściciela gry (raport etapu 2B, pytania otwarte).
 * Nazwy zarezerwowane co do joty („Centrala”, „Traszka”, „Admin”) są w `src/game/nick.ts`; tu to, co je zawiera albo udaje obsługę.
 */
export const BANNED_ROOTS: readonly string[] = [
  // wulgaryzmy (polskie i angielskie)
  'kurw', 'qrw', 'huj', 'pierdol', 'pierdal', 'jeb', 'pizd', 'cipa', 'cipk', 'kutas', 'dziwk', 'szmat', 'skurw', 'sukinsyn',
  'fuck', 'shit', 'cunt', 'bitch', 'whore',
  // obelgi i mowa nienawiści
  'cwel', 'ciota', 'pedal', 'nigga', 'nigger', 'retard', 'hitler', 'nazi', 'heil',
  // podszywanie się pod obsługę gry i pod Centralę
  'admin', 'moderator', 'centrala', 'oficjal', 'official',
];
