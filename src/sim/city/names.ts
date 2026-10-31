/**
 * Człony nazw miasta i ulic. To nazwy własne i zostają po polsku w obu językach (spec §18): `tests/i18n.test.ts` pomija je w
 * `SKIP` z powodem. Miasto to człon przedni plus tylny w jednym słowie („Białogród”), ulica to jeden przymiotnik w rodzaju
 * żeńskim, żeby UI mogło dopisać „ul.” („ul. Lipowa 3”, po angielsku „3 Lipowa St.”).
 */
export const CITY_HEADS: readonly string[] = ['Biało', 'Czarno', 'Zielono', 'Szaro', 'Nowo', 'Wielko', 'Sucho', 'Dębo'];
export const CITY_TAILS: readonly string[] = ['gród', 'wola', 'pole', 'góra', 'bród', 'dwór'];

/** 24 nazwy do wyboru; miasto ma 14 ulic (7 poziomych i 7 pionowych linii siatki), każda z innym przymiotnikiem. */
export const STREET_NAMES: readonly string[] = [
  'Lipowa', 'Ogrodowa', 'Polna', 'Szkolna', 'Dworcowa', 'Długa', 'Krótka', 'Słoneczna', 'Parkowa', 'Leśna', 'Kwiatowa', 'Wiosenna',
  'Szeroka', 'Cicha', 'Kolejowa', 'Rynkowa', 'Mostowa', 'Nadrzeczna', 'Browarna', 'Cegielniana', 'Piekarska', 'Rzemieślnicza',
  'Spokojna', 'Jasna',
];
