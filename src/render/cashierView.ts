import type { Object3D } from 'three';
import { cashierSpot, isSpecialOutfit, type CashierLook, type CashierSpot } from '@/game/cashier';
import type { Agent } from '@/sim/crowd/crowd';
import type { StoreLayout } from '@/sim/store/types';
import { characterBlobRadii, setCharacterShadowCasting, type BlobShadows, type BlobSlot } from './characters/blobShadows';
import type { CharacterFactory, CharacterInstance, OutfitOverrides } from './characters/characterFactory';
import type { OutfitFile } from './characters/modularPack';
import { cellToWorld } from './coords';
import { headingToYaw, turnTowards } from './crowdView';
import { PALETTE } from './style';

/** Czas gestu przy sprzedaży (s animacji): krótki, żeby nie zasłaniał następnego klienta. */
export const GESTURE_S = 0.35;
/** Szczyt podskoku (m): przy domyślnym zoomie widać go jako kilka pikseli. */
export const GESTURE_HOP_M = 0.12;
/** Szczyt ukłonu: przechył do przodu (rad). */
export const GESTURE_BOW_RAD = 0.2;
/** Mundur personelu: góra w zieleni marki (ruling R43). */
const UNIFORM: OutfitOverrides = Object.freeze({ top: PALETTE.brand.green });

/**
 * Rysuje kasjera gracza: jedna postać (`CharacterFactory.createWithOutfit`) na kratce pasa personelu za kasą (`cashierSpot`), z
 * własną plamą cienia (miejsce zarezerwowane w `BlobShadows`). Nie trzyma stanu gry, tylko to, co widać; klatkę po klatce dostaje
 * od gry obsługiwanego klienta i sygnał sprzedaży (`cashierCues` w game/cashier.ts).
 *
 * Postać gra `Idle`. Gdy ktoś płaci przy kasie, kasjer obraca się do niego tak jak postacie tłumu (TURN_RATE_MAX i to samo
 * wygładzanie), a bez klienta wraca do spojrzenia na kasę. Przy sprzedaży robi krótki gest proceduralny (podskok z ukłonem),
 * bez nowych klipów. Strój zwykły nosi w zieleni marki (mundur personelu, `OutfitOverrides.top`), specjalny zostaje sobą.
 *
 * Strój specjalny dochodzi na żądanie (`ensureOutfit`, ruling R40): do tego czasu miejsce za ladą jest puste (albo stoi poprzedni
 * kasjer, gdy to zmiana wyglądu). Stroje zwykłe i specjalne, które fabryka już ma (`hasOutfit`), powstają od razu, więc remont w
 * środku klatki nie zostawia klatki bez kasjera. Układ bez kasy nie ma kasjera; widok jest wtedy bezczynny.
 */
export class CashierView {
  private readonly spot: CashierSpot | null;
  private current: CharacterInstance | null = null;
  private look: CashierLook | null = null;
  private slot: BlobSlot | null = null;
  private yaw: number;
  /** Czas gestu w s animacji albo null, gdy nie trwa. */
  private gestureT: number | null = null;
  /** Numer ostatniego żądania wyglądu: spóźnione wczytanie stroju nie nadpisuje nowszego. */
  private request = 0;
  private castShadows = true;
  private disposed = false;

  /** `blobs`: wspólne plamy cienia (kasjer rezerwuje jedno miejsce); bez nich kasjer jest bez plamy. */
  constructor(
    private readonly factory: CharacterFactory,
    private readonly layout: StoreLayout,
    private readonly parent: Object3D,
    private readonly blobs: BlobShadows | null,
    look: CashierLook,
  ) {
    this.spot = cashierSpot(layout);
    this.yaw = headingToYaw(this.spot?.heading ?? 0);
    this.setLook(look);
  }

  /** Postać kasjera, gdy już stoi (do diagnostyki i testów; strój specjalny dochodzi chwilę po konstruktorze). */
  get character(): CharacterInstance | null { return this.current; }

  /**
   * Zmienia wygląd. Strój, który fabryka ma już w pamięci (zwykły, albo specjalny po wcześniejszym `ensureOutfit`), podmienia postać
   * od razu; specjalny jeszcze niewczytany po wczytaniu pliku (do tego czasu zostaje poprzednia postać). Ten sam wygląd co obecny
   * nic nie robi, a późniejsze wywołanie unieważnia wczytywanie wcześniejszego.
   */
  setLook(look: CashierLook): void {
    if (this.disposed || !this.spot) return;
    if (this.look && this.look.outfit === look.outfit && this.look.appearanceSeed === look.appearanceSeed) return;
    const wanted: CashierLook = { outfit: look.outfit, appearanceSeed: look.appearanceSeed };   // kopia: wołający może zmieniać swój obiekt
    this.look = wanted;
    const request = ++this.request;
    if (this.canBuildNow(wanted.outfit)) {
      this.build(wanted);
      return;
    }
    const ready = (): void => {
      if (request !== this.request || this.disposed) return;
      try {
        this.build(wanted);
      } catch (error) {
        console.error('Nie udało się zbudować kasjera.', error);   // nikt nie złapie wyjątku z obietnicy
      }
    };
    this.factory.ensureOutfit(wanted.outfit).then(ready, ready);   // błąd wczytania: fabryka da strój zwykły tej samej płci
  }

  /**
   * Czy kasjer rzuca cień z mapy cieni (polityka cieni z presetu jakości, `QualitySettings.characterShadows`: +1 draw call tylko
   * na `wysoka`). Dotyczy obecnej i następnej postaci. Wołane co klatkę: bez zmiany nic nie robi.
   */
  setCharacterShadows(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    if (this.current) setCharacterShadowCasting(this.current.object, on);
  }

  /**
   * Jedna klatka. `dt` to czas ramki w sekundach symulacji (rzeczywisty dt × prędkość gry; 0 przy pauzie): napędza obrót.
   * `animDt` to czas ramki dla animacji (np. przycięty do `ANIM_SPEED_CAP` × dt, jak w tłumie): napędza `Idle` i gest.
   * `serving` to klient płacący przy kasie (kasjer patrzy na niego) albo null, `sale` to sprzedaż w tej klatce (zaczyna gest).
   */
  update(dt: number, serving: Agent | null, sale: boolean, animDt: number = dt): void {
    const character = this.current;
    if (this.disposed || !this.spot || !character) return;
    if (sale) this.gestureT = 0;
    this.yaw = turnTowards(this.yaw, headingToYaw(this.headingTo(serving)), dt);
    character.update(animDt);

    let bow = 0;
    if (this.gestureT !== null) {
      this.gestureT += animDt;
      if (this.gestureT >= GESTURE_S) this.gestureT = null;
      else bow = Math.sin(Math.PI * (this.gestureT / GESTURE_S));
    }
    const o = character.object;
    o.position.y = GESTURE_HOP_M * bow;
    o.rotation.x = GESTURE_BOW_RAD * bow;
    o.rotation.y = this.yaw;
  }

  /** Zwalnia postać i miejsce w plamach cienia. Po `dispose` kolejne wywołania nic nie robią. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.request++;   // wczytywanie w toku nic już nie postawi
    if (this.current) this.release(this.current);
    this.current = null;
    this.slot?.release();
    this.slot = null;
  }

  /** Kierunek patrzenia (rad, 0 = +x siatki): na klienta, a bez niego albo w tej samej kratce na kasę. */
  private headingTo(serving: Agent | null): number {
    const { cell, heading } = this.spot!;
    if (!serving) return heading;
    const dx = serving.x - (cell.x + 0.5), dy = serving.y - (cell.y + 0.5);
    return Math.hypot(dx, dy) < 1e-6 ? heading : Math.atan2(dy, dx);
  }

  /** Czy strój da się zbudować w tej samej chwili: zwykły zawsze, specjalny tylko, gdy fabryka już go ma. */
  private canBuildNow(outfit: OutfitFile): boolean {
    return !isSpecialOutfit(outfit) || this.factory.hasOutfit?.(outfit) === true;
  }

  /**
   * Tworzy postać. O mundurze decyduje strój, który faktycznie powstał, nie poproszony: strój specjalny zostaje sobą, a każdy inny
   * (zwykły podstawiony przez fabrykę, gdy plik stroju specjalnego się nie wczytał, albo postać zastępcza) to personel w brand.green.
   */
  private create(look: CashierLook): CharacterInstance {
    const special = isSpecialOutfit(look.outfit);
    const character = this.factory.createWithOutfit(look.appearanceSeed, look.outfit, special ? undefined : UNIFORM);
    if (!special || (character.outfit !== null && isSpecialOutfit(character.outfit))) return character;
    this.release(character);   // poproszono o strój specjalny, a powstał zwykły: ta sama postać, tylko w mundurze
    return this.factory.createWithOutfit(look.appearanceSeed, look.outfit, UNIFORM);
  }

  /** Stawia kasjera w danym wyglądzie na jego kratce; poprzednia postać (zmiana wyglądu) jest zwalniana po utworzeniu nowej. */
  private build(look: CashierLook): void {
    const spot = this.spot!;
    const character = this.create(look);
    const previous = this.current;
    this.current = character;
    if (previous) this.release(previous);

    const o = character.object;
    o.rotation.order = 'YXZ';   // obrót wokół osi y postaci, a dopiero potem pochylenie (ukłon) wokół jej własnej osi x
    const at = cellToWorld(this.layout, spot.cell.x, spot.cell.y);
    o.position.set(at.x, 0, at.z);
    o.rotation.y = this.yaw;
    if (!this.castShadows) setCharacterShadowCasting(o, false);
    this.parent.add(o);
    this.gestureT = null;

    this.slot ??= this.blobs?.reserve() ?? null;
    const [rx, rz] = characterBlobRadii(o);
    this.slot?.set(at.x, at.z, rx, rz);
  }

  private release(character: CharacterInstance): void {
    character.dispose();
    character.object.removeFromParent();
  }
}
