import { t } from '@/i18n';
import type { DistrictId, LotState, RivalBrand, SourceKind, StoreDistrict } from '@/sim/city/types';
import type { PartnerProgress } from '@/sim/firm/commands';
import type { LotKind } from '@/sim/store/types';
import { plural } from '../game/format';
import type { Level } from './cityModel';
import { refusalText } from './firmText';

/*
 * Teksty ekranu Miasta (spec §9, §18): dzielnice, formaty i stany lokali, kto przychodzi, poziomy słowami i postęp do statusu Partnera.
 * Wszystko po identyfikatorach z miasta i firmy, bo symulacja nie ma polskich zdań o mieście; angielskie wersje w `i18n/en/ui/city.ts`.
 * Odmowy Centrali (`refusalText`) mieszkają w `firmText.ts` z resztą tekstów firmy: tu tylko jedno miejsce, bez drugiej kopii.
 */

export { refusalText };

export function districtName(d: DistrictId): string {
  switch (d) {
    case 'osiedle': return t`Osiedle`;
    case 'srodmiescie': return t`Śródmieście`;
    case 'dworzec': return t`Dworzec`;
    case 'biurowce': return t`Biurowce`;
    case 'park': return t`Park`;
  }
}

/** Format lokalu: w Biurowcach `blok` to parter biurowca, narożnik ma tylko kamienica. */
export function lotKindName(kind: LotKind, corner: boolean, district?: StoreDistrict): string {
  switch (kind) {
    case 'blok': return district === 'biurowce' ? t`parter biurowca` : t`parter bloku`;
    case 'kamienica': return corner ? t`narożnik kamienicy` : t`parter kamienicy`;
    case 'pawilon': return t`pawilon`;
  }
}

export function lotStateName(state: LotState): string {
  switch (state) {
    case 'zajety': return t`zajęty`;
    case 'wolny': return t`wolny`;
    case 'konkurencja': return t`konkurencja`;
    case 'twoj': return t`Twój sklep`;
    case 'obok': return t`obok Twojego sklepu`;
    case 'budowa': return t`w budowie`;
    case 'po-traszce': return t`po Traszce`;
  }
}

/** Marki konkurencji to nazwy własne i zostają takie same w obu językach. */
export function brandName(brand: RivalBrand): string {
  return brand === 'kawka' ? 'Kawka Express' : 'Szop 24h';
}

/** Kto przychodzi do lokalu: dwa najbliższe rodzaje punktów ruchu (`LotEstimate.who`). */
export function sourceText(kind: SourceKind): string {
  switch (kind) {
    case 'przystanek': return t`pasażerowie z przystanku`;
    case 'szkola': return t`uczniowie`;
    case 'uczelnia': return t`studenci`;
    case 'biurowiec': return t`pracownicy biur`;
    case 'dworzec': return t`podróżni z dworca`;
    case 'osiedle': return t`mieszkańcy osiedla`;
  }
}

/** Poziom słowami; `masculine` dla rzeczownika męskiego („koszyk: wysoki”), reszta (oczekiwania, kradzieże) w liczbie mnogiej. */
export function levelText(level: Level, masculine = false): string {
  switch (level) {
    case 'niskie': return masculine ? t`niski` : t`niskie`;
    case 'srednie': return masculine ? t`średni` : t`średnie`;
    case 'wysokie': return masculine ? t`wysoki` : t`wysokie`;
  }
}

/**
 * Postęp do statusu Partnera Strategicznego w pasku miasta: „jeszcze 1 miesiąc z zyskiem · zaufanie 68/75”. Gdy zysk już jest, zostaje samo
 * zaufanie; w rankingu tekst Centrali o jednej placówce.
 */
export function progressText(p: PartnerProgress): string {
  switch (p.kind) {
    case 'granted': return t`status nadany`;
    case 'ranked': return refusalText('ranked');
    case 'missing': {
      const parts: string[] = [];
      if (p.profitMonthsNeeded > 0) {
        parts.push(t`jeszcze ${p.profitMonthsNeeded} ${plural(p.profitMonthsNeeded, 'miesiąc', 'miesiące', 'miesięcy')} z zyskiem`);
      }
      parts.push(t`zaufanie ${Math.round(p.trust)}/${p.trustNeeded}`);
      return parts.join(' · ');
    }
  }
}
