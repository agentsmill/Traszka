import type { Dict, Plurals } from '../ui';

/*
 * Ekran Miasta po angielsku (`ui/city/cityText.ts`, `cityModel.ts`, `CityPanel.tsx`, `LotCard.tsx`): dzielnice, formaty i stany lokali, kto
 * przychodzi, poziomy słowami, postęp do statusu Partnera, lista i karta lokalu (z profilem godzinowym `HourChart.tsx` i lokalem „po Traszce”).
 * Ulice, nazwa miasta i marki konkurencji (Szop 24h, Kawka Express) to nazwy własne i zostają po polsku; adres składa `addressText`
 * („3 Lipowa St.”). Odmowy Centrali są w `firm.ts`.
 * Ton jak w `docs/i18n/glossary-en.md`: *unit* i *premises* dla lokalu, *opening package*, *in instalments*, *Head Office*.
 */

export const CITY_UI: Dict = {
  // zakładka
  'Miasto': 'City',
  // dzielnice (spec §8)
  'Osiedle': 'Estate',
  'Śródmieście': 'Town centre',
  'Dworzec': 'Station',
  'Biurowce': 'Office blocks',
  'Park': 'Park',
  // format lokalu
  'parter bloku': 'ground floor of a flat block',
  'parter biurowca': 'ground floor of an office block',
  'parter kamienicy': 'townhouse ground floor',
  'narożnik kamienicy': 'corner townhouse',
  'pawilon': 'pavilion',
  // stan lokalu
  'zajęty': 'occupied',
  'wolny': 'to let',
  'konkurencja': 'competitor',
  'Twój sklep': 'your shop',
  'obok Twojego sklepu': 'next to your shop',
  'w budowie': 'under construction',
  'po Traszce': 'ex-Traszka',
  // kto przychodzi
  'pasażerowie z przystanku': 'bus-stop passengers',
  'uczniowie': 'pupils',
  'studenci': 'students',
  'pracownicy biur': 'office workers',
  'podróżni z dworca': 'rail travellers',
  'mieszkańcy osiedla': 'estate residents',
  // poziomy słowami: rodzaj męski (koszyk) i liczba mnoga (oczekiwania, kradzieże)
  'niski': 'low', 'średni': 'medium', 'wysoki': 'high',
  'niskie': 'low', 'średnie': 'medium', 'wysokie': 'high',
  // pasek miasta
  'Partner Strategiczny': 'Strategic Partner',
  'status nadany': 'status granted',
  'jeszcze {0} {1} z zyskiem': '{0} more {1} in profit',
  'zaufanie {0}/{1}': 'trust {0}/{1}',
  'placówki {0}/{1}': 'branches {0}/{1}',
  'Warstwa mapy': 'Map layer',
  'Ruch': 'Footfall',
  'Dzielnice': 'Districts',
  'mały ruch': 'quiet',
  'duży ruch': 'busy',
  // pinezki mapy (napis nad kartką, budowa z licznikiem dni)
  'lokal obok': 'next door',
  'za {0} {1}': 'in {0} {1}',
  'otwarcie dziś': 'opens today',
  // lista wolnych lokali
  'Wolne lokale': 'Units to let',
  'Wolne lokale ({0})': 'Units to let ({0})',
  'Brak wolnych lokali.': 'No units to let.',
  // karta lokalu
  'Poprzedni lokal': 'Previous unit',
  'Następny lokal': 'Next unit',
  'lokal {0} z {1}': 'unit {0} of {1}',
  'Klienci dziennie': 'Customers per day',
  '(szacunek)': '(estimate)',
  // profil godzinowy (4a.2): nagłówek, legenda i opis wykresu dla czytników ekranu
  'Ruch w ciągu dnia': 'Footfall through the day',
  'dzień roboczy': 'weekday',
  'weekend': 'weekend',
  'Szczyt około {0}:00': 'Peak around {0}:00',
  'Ruch równy przez cały dzień': 'Footfall is even all day',
  'Kto przychodzi': 'Who comes in',
  'Koszyk': 'Basket',
  'Oczekiwania': 'Expectations',
  'Kradzieże': 'Theft',
  'kradzieże: wysokie, zobaczysz je przy remanencie': 'theft: high, you will see it at the stocktake',
  'Konkurencja obok': 'Competition nearby',
  'brak w promieniu {0} m': 'none within {0} m',
  'Budowa': 'Build time',
  'Pakiet otwarcia': 'Opening package',
  // lokal „po Traszce” (4a.2): wyposażenie, które zostało, i zniżka pakietu
  'Wyposażenie zostało: remont {0}, sprzęt {1} szt., ulepszenia {2}': (refit, equipment, upgrades) =>
    `Fittings kept: refit ${refit}, equipment ${Number(String(equipment).replace(/,/g, '')) === 1 ? '1 item' : `${equipment} items`}, upgrades ${upgrades}`,
  'po Traszce: {0} ceny': 'ex-Traszka: {0} of the price',
  'Sposób zapłaty': 'How to pay',
  'za gotówkę {0}': '{0} in cash',
  'na raty {0} × {1} z przelewów tego sklepu': 'in instalments: {0} × {1} from this shop’s transfers',
  'Raty razem {0}, w tym opłata {1} ({2}). Za gotówkę po zapłacie musi zostać co najmniej 0 zł.':
    'Instalments come to {0} in total, including a {1} fee ({2}). If you pay in cash, at least 0 zł must be left afterwards.',
  'Biorę lokal': 'Take this unit',
  'Ten lokal zajmiesz remontem „Dokupienie lokalu obok”': 'You will take this unit over with the “Refit: take over the unit next door” upgrade',
  'Do Ulepszeń': 'To Upgrades',
  'Stan': 'Status',
  'Marka': 'Brand',
};

export const CITY_PLURALS: Plurals = {};
