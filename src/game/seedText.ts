// Który tekst jest seedem do pokazania w rankingu. Jedna definicja dla gry (czyszczenie: `normalizeSeed` w seeds.ts) i dla serwera
// (odrzucanie: `isShowableSeed` w src/server/runs.ts), żeby seed, który gra przyjmuje, serwer przyjmował też po trzech miesiącach gry.
//
// PLIK NIE MA IMPORTÓW, i tak ma zostać: importuje go kod funkcji Vercela (api/**, src/server/**), który po kompilacji ładuje tylko
// względne pliki `.js`; alias `@/` i importy bez rozszerzenia przechodzą build, a funkcja pada przy pierwszym wywołaniu
// (pilnuje tego src/server/runtimeImports.test.ts). Stałe z innych plików (limit długości z config.ts) wchodzą jako argumenty.
//
// Reguła: seed pokazuje się, gdy czyszczenie niczego w nim nie zmienia (`stripHiddenSeedChars(seed) === seed`). Walidator jest więc
// zbudowany z czyszczenia, a nie obok niego; nie da się dopisać znaku do jednego i zapomnieć o drugim.
//
// Co jest niedozwolone (seedy widzą wszyscy w rankingu, więc znak niewidoczny mógłby ukryć albo odwrócić napis):
//  - znaki sterujące (Cc), formatujące (Cf: spacje zerowej szerokości, miękki łącznik, kierunek tekstu, BOM, operatory niewidoczne…),
//    separatory wierszy i akapitów (Zl, Zp) oraz osamotnione surogaty (Cs; nie da się ich zapisać w adresie, `encodeURIComponent` rzuca),
//  - cały blok znaczników U+E0000–U+E007F: są niewidoczne i służą do wpisywania ukrytego tekstu w zwykłym napisie,
// z dwoma wyjątkami:
//  - spójnik ZWJ (U+200D) między dwoma emoji: skleja rodzinę, zawód, pirata; luzem, między literami i na brzegach jest niedozwolony,
//  - flagi Anglii, Szkocji i Walii jako cała sekwencja. To jedyne flagi podziałów na liście RGI Unicode (emoji zalecane do
//    powszechnej wymiany), a zapisuje się je znacznikami: czarna flaga U+1F3F4, kod `gbeng` / `gbsct` / `gbwls` literami-znacznikami
//    (U+E0067 U+E0062 …) i znacznik końca U+E007F. Białą listę trzech sekwencji da się sprawdzić co do znaku, dowolnej sekwencji
//    znaczników nie (każda niewidoczna wiadomość też by przeszła), więc każdy inny znacznik znika: znaczniki po innym znaku niż
//    czarna flaga, obca albo urwana sekwencja (`gbxxx`, brak znacznika końca) zostawiają samą czarną flagę.
//
// Poza zakresem (nadal niewidoczne, nie są Cf ani Cc): wypełniacze Hangul (U+115F, U+1160, U+3164, U+FFA0), pusty znak Braille'a
// (U+2800), połączenie grafemów (U+034F), niewidoczne samogłoski khmerskie (U+17B4, U+17B5), selektory wariantów mongolskie
// (U+180B–U+180D) i dodatkowe selektory wariantów (U+E0100–U+E01EF), a w napisie z serwera także spacje inne niż zwykła
// (U+00A0, U+2003, U+3000…) w środku. Gra zwija każdy ciąg odstępów do jednej zwykłej spacji, a pozostałych znaków z tej listy nie
// rusza; serwer żadnego z nich nie odrzuca.

/** Spójnik zerowej szerokości (ZWJ): skleja emoji w jedno (rodzina, zawód). */
const JOINER = '\u{200d}';

/** Litery ASCII zapisane znacznikami (U+E0020–U+E007E): „g” to U+E0067. */
const tags = (letters: string): string => Array.from(letters, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');

/** Jedyne dozwolone sekwencje znaczników: flagi Anglii, Szkocji i Walii (czarna flaga, kod, znacznik końca). */
const KEPT_FLAGS = ['gbeng', 'gbsct', 'gbwls'].map((code) => `\u{1f3f4}${tags(code)}\u{e007f}`);

/**
 * Jeden przebieg po tekście, trzy rodzaje trafień po kolei: (1) dozwolona flaga w całości (zostaje), (2) odstęp, którego nie wolno
 * pokazać (tabulator, nowy wiersz, pionowa tabulacja, wysuw strony, powrót karetki, U+2028, U+2029): staje się spacją, żeby słowa
 * po obu stronach się nie skleiły, (3) każdy inny niedozwolony znak (znika). U+FEFF to dla `\s` spacja, ale znika (jest formatujący,
 * nie jest odstępem z (2)). Znacznik trafiony poza (1) znika, więc w napisie nie zostaje żadna niepełna ani obca sekwencja.
 */
const HIDDEN = new RegExp(`(${KEPT_FLAGS.join('|')})|([\\t-\\r\\u2028\\u2029])|[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Zl}\\p{Zp}\\u{e0000}-\\u{e007f}]`, 'gu');

const PICTOGRAPH = /^\p{Extended_Pictographic}$/u;
/** Co może stać między emoji a spójnikiem: selektor wariantu (❤\u{fe0f}) i odcień skóry (👩🏽). */
const EMOJI_TAIL = /^[\u{fe0f}\p{Emoji_Modifier}]$/u;

/** Zostawia spójnik ZWJ tylko między dwoma emoji (przed nim emoji z ewentualnym selektorem wariantu albo odcieniem skóry, po nim emoji). */
function keepEmojiJoiners(text: string): string {
  if (!text.includes(JOINER)) return text;
  const chars = Array.from(text);
  let out = '';
  chars.forEach((c, i) => {
    if (c !== JOINER) {
      out += c;
      return;
    }
    let before = i - 1;
    while (before >= 0 && EMOJI_TAIL.test(chars[before]!)) before--;
    if (before >= 0 && PICTOGRAPH.test(chars[before]!) && i + 1 < chars.length && PICTOGRAPH.test(chars[i + 1]!)) out += c;
  });
  return out;
}

/**
 * Tekst bez niedozwolonych znaków (patrz nagłówek pliku): znaki sterujące, formatujące, osamotnione surogaty i znaczniki znikają
 * (odstępy sterujące stają się spacją), zostają ZWJ między emoji i trzy flagi z Unicode. Najpierw znika wszystko inne, dopiero
 * potem sprawdza się, czy ZWJ ma po obu stronach emoji, więc niewidoczny znak wstawiony między emoji a spójnik nie psuje sklejenia.
 * Idempotentne: wynik oczyszczony jeszcze raz nie zmienia się, co daje walidatorowi odpowiedź „tak” dla wszystkiego, co oddało czyszczenie.
 * Niczego poza tym nie robi: nie zwija spacji, nie zmienia wielkości liter, nie normalizuje i nie tnie (to robi `normalizeSeed`).
 */
export function stripHiddenSeedChars(text: string): string {
  return keepEmojiJoiners(text.replace(HIDDEN, (match: string, flag?: string, spacing?: string) => {
    if (flag !== undefined) return flag;
    if (spacing !== undefined) return ' ';
    return match === JOINER ? match : '';
  }));
}

/**
 * Czy seed da się pokazać w rankingu: niepusty, bez spacji na brzegach, bez niedozwolonych znaków (czyszczenie niczego w nim nie
 * zmienia) i najwyżej `maxChars` punktów kodowych (emoji to jeden znak, flaga to siedem). Bez `maxChars` długość nie jest sprawdzana:
 * limit to decyzja wywołującego (gra tnie do 40 znaków, serwer przyjmuje do 48 z zapasem na sąsiedni lokal `·n`), a własna stała tutaj
 * byłaby trzecią kopią tej liczby, którą ktoś zmieni w config.ts i zapomni o tym pliku. Serwer podaje limit jawnie.
 */
export function isShowableSeed(seed: string, maxChars = Infinity): boolean {
  let chars = 0;
  for (const _ of seed) {
    if (++chars > maxChars) return false;
  }
  return chars >= 1 && seed === seed.trim() && stripHiddenSeedChars(seed) === seed;
}
