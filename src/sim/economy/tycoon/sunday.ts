import { isSunday } from './time';

/**
 * Niedziela (decyzja użytkownika z 28.10.2026). Niedziele są niehandlowe: duże sklepy i dyskonty stoją zamknięte,
 * a Traszka jest otwarta, bo prowadzi ją franczyzobiorca. Nie ma osobnego trybu ani innych zasad, przychodzi po prostu
 * więcej ludzi. Liczba to decyzja balansu [C]; integracja mnoży przez nią ruch klientów.
 */
export const SUNDAY_TRAFFIC = 1.35;

/** Mnożnik ruchu klientów w dniu `day` (niedziela: więcej, reszta tygodnia: bez zmian). */
export const dayTrafficMult = (day: number): number => (isSunday(day) ? SUNDAY_TRAFFIC : 1);
