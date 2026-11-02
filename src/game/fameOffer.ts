import type { FirmEvent } from '@/sim/firm/types';
import { fameOffer } from '@/ui/state';
import type { Sfx } from '@/ui/sfx';
import type { Meta } from './meta';
import type { GameSession } from './session';

/**
 * Zdarzenie firmy `million` (4b §5.7): gracz pierwszy raz ma milion w portfelu w zwykłej grze. Zamiast zwykłego okna „OK” otwiera się
 * okno gratulacji z wpisem do Galerii sław (`ui.fameOffer`, `FameWindow`), z konfetti i dźwiękiem monet.
 *
 * Zdarzenie przychodzi też w pierwszej minucie po wczytaniu zapisu, w którym portfel już przekracza milion (pole `fame` firmy jest wtedy
 * puste), i wtedy gratulacje są na miejscu. Nie pokazują się drugi raz dla seeda, którego wpis serwer już przyjął (`meta.fameSent`):
 * karta ze starszej wersji gry mogła zgubić `fame` w zapisie, a milion jest ten sam. Bieg rankingowy nie dostaje nic (firma w nim `million`
 * w ogóle nie wysyła; tu drugi bezpiecznik).
 *
 * Zwraca, czy zdarzenie obsłużono (każde `million` jest obsłużone, także to, które nic nie otwiera): wtedy `handleFirmEvents` nie
 * pokazuje go jako zwykłego wpisu „OK”.
 */
export function offerFame(
  e: FirmEvent, session: GameSession, meta: Pick<Meta, 'fameSent'>, fx: { play(sfx: Sfx): void; confetti(): void },
): boolean {
  if (e.kind !== 'million') return false;
  if (session.mode !== 'casual' || meta.fameSent?.includes(session.seed)) return true;
  const day = e.params?.day;
  const cash = e.params?.cash;
  if (typeof day !== 'number' || typeof cash !== 'number') return true;
  fameOffer.value = { seed: session.seed, day, cash };
  fx.play('coins');
  fx.confetti();
  return true;
}
