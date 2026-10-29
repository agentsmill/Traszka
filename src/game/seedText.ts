// Który tekst jest seedem do pokazania w rankingu. Jedna definicja dla gry (czyszczenie: `canonicalSeedText`, z którego korzysta
// `normalizeSeed` w seeds.ts) i dla serwera (odrzucanie: `isShowableSeed` i `isCanonicalSeed` w src/server/runs.ts), żeby seed, który
// gra przyjmuje, serwer przyjmował też po trzech miesiącach gry, a seed w innej pisowni niż ta, którą zapisuje gra, odrzucał.
//
// PLIK NIE MA IMPORTÓW, i tak ma zostać: importuje go kod funkcji Vercela (api/**, src/server/**), który po kompilacji ładuje tylko
// względne pliki `.js`; alias `@/` i importy bez rozszerzenia przechodzą build, a funkcja pada przy pierwszym wywołaniu
// (pilnuje tego src/server/runtimeImports.test.ts). Stałe z innych plików (limit długości z config.ts) wchodzą jako argumenty.
//
// Reguła: seed pokazuje się, gdy czyszczenie niczego w nim nie zmienia (`stripHiddenSeedChars(seed) === seed`). Walidator jest więc
// zbudowany z czyszczenia, a nie obok niego; nie da się dopisać znaku do jednego i zapomnieć o drugim.
//
// Postać kanoniczna (`isCanonicalSeed`): to, co gra zapisuje po `normalizeSeed`, czyli punkt stały `canonicalSeedText` (NFC, bez znaków
// niewidocznych, odstępy zwinięte i przycięte, małe litery, najwyżej 40 znaków), z sufiksem sąsiedniego lokalu `·1` … `·5` (patrz niżej).
// Serwer wymaga tej postaci, więc jeden sklep ma w rankingu jedną pisownię (`Pierogi-731`, `pierogi  731` i NFD to nie seedy z gry).
//
// Co jest niedozwolone (seedy widzą wszyscy w rankingu, więc znak niewidoczny mógłby ukryć albo odwrócić napis):
//  - znaki sterujące (Cc), formatujące (Cf: spacje zerowej szerokości, miękki łącznik, kierunek tekstu, BOM, operatory niewidoczne…),
//    separatory wierszy i akapitów (Zl, Zp) oraz osamotnione surogaty (Cs; nie da się ich zapisać w adresie, `encodeURIComponent` rzuca),
//  - cały blok znaczników U+E0000–U+E007F i dalej do U+E0FFF (obejmuje ideograficzne selektory wariantów U+E0100–U+E01EF): każdy taki
//    znak jest niewidoczny, a ciąg takich znaków wpisuje w zwykły napis ukryty tekst albo dane,
//  - znaki, które nie są Cf ani Cc, a nic nie rysują albo są pustymi literami (lista `ALSO_HIDDEN` niżej, jawne zakresy),
// z dwoma wyjątkami:
//  - spójnik ZWJ (U+200D) między dwoma emoji: skleja rodzinę, zawód, pirata; luzem, między literami i na brzegach jest niedozwolony,
//  - flagi Anglii, Szkocji i Walii jako cała sekwencja. To jedyne flagi podziałów na liście RGI Unicode (emoji zalecane do
//    powszechnej wymiany), a zapisuje się je znacznikami: czarna flaga U+1F3F4, kod `gbeng` / `gbsct` / `gbwls` literami-znacznikami
//    (U+E0067 U+E0062 …) i znacznik końca U+E007F. Białą listę trzech sekwencji da się sprawdzić co do znaku, dowolnej sekwencji
//    znaczników nie (każda niewidoczna wiadomość też by przeszła), więc każdy inny znacznik znika: znaczniki po innym znaku niż
//    czarna flaga, obca albo urwana sekwencja (`gbxxx`, brak znacznika końca) zostawiają samą czarną flagę. Flagi dopasowują się
//    pierwsze, więc szeroki zakres znaczników ich nie psuje.
//
// Zakresy są jawne, a nie `Default_Ignorable_Code_Point`: przeglądarka gracza i Node na Vercelu mogą mieć różne wersje Unicode, a lista
// wypisana w kodzie daje wszędzie tę samą odpowiedź. (Klasy ogólne Cc, Cf, Cs, Zl, Zp zależą od wersji Unicode tylko dla znaków
// przydzielonych później; to ryzyko jest znane i małe.)
//
// Poza zakresem (nadal możliwe w seedzie):
//  - pusty znak Braille'a U+2800 (w wielu czcionkach jest widoczną kratką, więc nie ukrywa tekstu),
//  - znaki łączące (Mn) w dowolnej liczbie, np. „zalgo”: kanał ograniczony limitem długości seeda (40 znaków w grze, 48 na serwerze);
//    pełna obrona to biała lista znaków i osobna decyzja produktowa,
//  - w napisie z serwera spacje inne niż zwykła w środku (U+00A0, U+2003, U+3000…): `isShowableSeed` ich nie odrzuca (gra zwija każdy
//    ciąg odstępów do jednej zwykłej spacji), ale `isCanonicalSeed` tak, bo takiego seeda gra nie zapisuje.

/** Spójnik zerowej szerokości (ZWJ): skleja emoji w jedno (rodzina, zawód). */
const JOINER = '\u{200d}';

/** Litery ASCII zapisane znacznikami (U+E0020–U+E007E): „g” to U+E0067. */
const tags = (letters: string): string => Array.from(letters, (c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');

/** Jedyne dozwolone sekwencje znaczników: flagi Anglii, Szkocji i Walii (czarna flaga, kod, znacznik końca). */
const KEPT_FLAGS = ['gbeng', 'gbsct', 'gbwls'].map((code) => `\u{1f3f4}${tags(code)}\u{e007f}`);

/**
 * Znaki spoza Cc, Cf, Cs, Zl i Zp, które też nic nie rysują albo służą do ukrywania tekstu, i blok znaczników. Zakresy jawne (patrz
 * nagłówek pliku). U+FE0F (selektor wariantu emoji) zostaje, bo emoji go potrzebuje: zakaz obejmuje U+FE00–U+FE0E.
 */
const ALSO_HIDDEN: ReadonlyArray<readonly [from: number, to: number]> = [
  [0x034f, 0x034f],     // połączenie grafemów (CGJ)
  [0x115f, 0x1160],     // wypełniacze Hangul (puste litery)
  [0x17b4, 0x17b5],     // niewidoczne samogłoski khmerskie
  [0x180b, 0x180f],     // selektory wariantów mongolskie (U+180E to Cf, reszta Mn)
  [0x2065, 0x2065],     // nieprzydzielony, w środku zakresu operatorów niewidocznych U+2060–U+206F
  [0x3164, 0x3164],     // wypełniacz Hangul (pusta litera)
  [0xfe00, 0xfe0e],     // selektory wariantów 1–15 (bez U+FE0F)
  [0xffa0, 0xffa0],     // wypełniacz Hangul, połówkowa szerokość (pusta litera)
  [0xfff0, 0xfff8],     // nieprzydzielone, obok znaków adnotacji U+FFF9–U+FFFB
  [0xe0000, 0xe0fff],   // znaczniki (U+E0000–U+E007F) i selektory wariantów dodatkowe (U+E0100–U+E01EF), także nieprzydzielone między nimi
];
/** Znak w zapisie `\u{…}` do wnętrza klasy znaków wyrażenia z flagą `u`. */
const hexCp = (cp: number): string => `\\u{${cp.toString(16)}}`;
const ALSO_HIDDEN_CLASS = ALSO_HIDDEN.map(([from, to]) => (from === to ? hexCp(from) : hexCp(from) + '-' + hexCp(to))).join('');

/**
 * Jeden przebieg po tekście, trzy rodzaje trafień po kolei: (1) dozwolona flaga w całości (zostaje), (2) odstęp, którego nie wolno
 * pokazać (tabulator, nowy wiersz, pionowa tabulacja, wysuw strony, powrót karetki, U+2028, U+2029): staje się spacją, żeby słowa
 * po obu stronach się nie skleiły, (3) każdy inny niedozwolony znak (znika). U+FEFF to dla `\s` spacja, ale znika (jest formatujący,
 * nie jest odstępem z (2)). Znacznik trafiony poza (1) znika, więc w napisie nie zostaje żadna niepełna ani obca sekwencja.
 */
const HIDDEN = new RegExp(
  `(${KEPT_FLAGS.join('|')})|([\\t-\\r\\u{2028}\\u{2029}])|[\\p{Cc}\\p{Cf}\\p{Cs}\\p{Zl}\\p{Zp}${ALSO_HIDDEN_CLASS}]`,
  'gu',
);

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

// --- Postać kanoniczna seeda ---------------------------------------------------------------------------------------------

/** Najwięcej znaków (punktów kodowych, więc emoji liczy się za jeden, a flaga za siedem) seeda po czyszczeniu w grze. */
export const SEED_TEXT_MAX = 40;

/**
 * Ile sąsiednich lokali (`seed·1` … `seed·5`) próbuje gra, gdy generator nie składa sklepu z samego seeda (`resolveStore` w seeds.ts).
 * Sufiks nie wlicza się do `SEED_TEXT_MAX`: seed o pełnych 40 znakach z sufiksem ma ich 42 (serwer zostawia zapas do 48).
 */
export const SEED_NEIGHBOUR_MAX = 5;

/** Znak przed numerem sąsiedniego lokalu: kropka środkowa U+00B7. */
const NEIGHBOUR_SEPARATOR = '\u{b7}';

/**
 * Tekst seeda po czyszczeniu (pusty, gdy nic nie zostało): NFC (ten sam napis to ten sam seed), niedozwolone znaki znikają
 * (`stripHiddenSeedChars`: sterujące, formatujące, znaczniki i osamotnione surogaty; ZWJ zostaje tylko między emoji, flagi Anglii,
 * Szkocji i Walii w całości; tabulator i nowy wiersz to spacje; zerowej szerokości, kierunkowe i luźny ZWJ nie liczą się do limitu),
 * spacje zwinięte i przycięte, małe litery, najwyżej `maxChars` znaków (domyślnie `SEED_TEXT_MAX`). Tnie po punktach kodowych, więc
 * emoji nie rozpada się na pojedynczy surogat, którego nie da się zapisać w adresie ani w kluczu. Po obcięciu czyści jeszcze raz:
 * cięcie w środku sklejonego emoji nie zostawia na końcu spójnika, a cięcie w środku flagi zostawia samą czarną flagę zamiast urwanych
 * znaczników. Idempotentne (`canonicalSeedText(canonicalSeedText(x)) === canonicalSeedText(x)`), więc wynik jest punktem stałym.
 * To czyszczenie stosuje `normalizeSeed` w grze, a serwer sprawdza przez nie, czy seed ma postać, którą gra zapisuje (`isCanonicalSeed`).
 */
export function canonicalSeedText(raw: string, maxChars: number = SEED_TEXT_MAX): string {
  const text = stripHiddenSeedChars(raw.normalize('NFC'))
    .replace(/\s+/g, ' ').trim()
    .toLowerCase().normalize('NFC');
  return stripHiddenSeedChars(Array.from(text).slice(0, maxChars).join('')).trim();
}

/** Niepusty tekst, który czyszczenie zostawia bez zmian (z samej definicji ma najwyżej `SEED_TEXT_MAX` znaków). */
const isFixedPoint = (seed: string): boolean => seed !== '' && canonicalSeedText(seed) === seed;

/**
 * Czy seed ma postać, w której zapisuje go gra: punkt stały `canonicalSeedText` (nic w nim nie zmienia NFC, czyszczenie, zwijanie
 * odstępów, małe litery ani cięcie do `SEED_TEXT_MAX` znaków) albo `baza·N`, gdzie `baza` jest takim punktem stałym, a N to numer
 * sąsiedniego lokalu od 1 do `SEED_NEIGHBOUR_MAX` bez zer na początku. Drugi przypadek jest potrzebny dla baz o 39 i 40 znakach: gra dopisuje
 * sufiks po czyszczeniu i cięciu, więc cały seed bywa dłuższy niż 40 znaków (dla krótszych baz `baza·N` jest punktem stałym już sam z siebie).
 * Pusty seed nie jest kanoniczny. Seed z kropką środkową, który wpisał gracz (`pierogi·6`, `a·b`), jest zwykłym punktem stałym:
 * `normalizeSeed` zostawia go bez zmian, więc serwer nie może go odrzucić. Długości nie ogranicza ponad to, co wynika z definicji;
 * zbyt długi napis odrzuca wcześniej `isShowableSeed` z limitem serwera.
 */
export function isCanonicalSeed(seed: string): boolean {
  if (isFixedPoint(seed)) return true;
  const cut = seed.lastIndexOf(NEIGHBOUR_SEPARATOR);
  if (cut < 1) return false;
  const number = seed.slice(cut + NEIGHBOUR_SEPARATOR.length);
  return /^[1-9][0-9]*$/.test(number) && Number(number) <= SEED_NEIGHBOUR_MAX && isFixedPoint(seed.slice(0, cut));
}
