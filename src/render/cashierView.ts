import type { Object3D } from 'three';
import { cashierSpot, isSpecialOutfit, type CashierLook, type CashierSpot } from '@/game/cashier';
import type { Agent } from '@/sim/crowd/crowd';
import type { StoreLayout } from '@/sim/store/types';
import { characterBlobRadii, setCharacterShadowCasting, type BlobShadows, type BlobSlot } from './characters/blobShadows';
import type { CharacterFactory, CharacterInstance, OutfitOverrides } from './characters/characterFactory';
import { Gait } from './characters/gait';
import type { OutfitFile } from './characters/modularPack';
import { cellToWorld } from './coords';
import { headingToYaw, turnTowards } from './crowdView';
import { STAFF_WALK_SPEED } from './staff/walker';
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
 * Gdzie kasjer jest, gdy nie stoi za kasą, tylko chodzi po sklepie (zmiana kasjera, praca poza kasą): to, co liczy załoga
 * personelu na ekranie. `x`, `y` w kratkach jak `Agent.x/y` (środek kratki = indeks + 0.5), `heading` w rad (0 = +x siatki),
 * `moving` mówi, czy w tej klatce idzie (wybiera klip chodu).
 */
export interface CashierPose { x: number; y: number; heading: number; moving: boolean }

/** Zwalnia postać i zdejmuje ją ze sceny (jej własne `dispose` zwalnia materiał i szkielet, geometria jest wspólna w fabryce). */
export function releaseCharacter(character: CharacterInstance): void {
  character.dispose();
  character.object.removeFromParent();
}

/**
 * Czy `createWithOutfit` zbuduje ten strój od razu: zwykły zawsze, specjalny tylko, gdy fabryka już go ma (po `ensureOutfit`).
 * Wspólne dla kasjera w sklepie i podglądu na ekranie startowym: czekają na `ensureOutfit` tylko wtedy, gdy trzeba.
 */
export const isOutfitReady = (factory: CharacterFactory, outfit: OutfitFile): boolean => !isSpecialOutfit(outfit) || factory.hasOutfit(outfit);

/**
 * Postać kasjera w danym wyglądzie: jedna reguła dla sklepu (`CashierView`) i dla podglądu na ekranie startowym, więc gracz
 * widzi w podglądzie dokładnie tego kasjera, który stanie za ladą. O mundurze decyduje strój, który faktycznie powstał, nie
 * poproszony: strój specjalny zostaje sobą, a każdy inny (zwykły podstawiony przez fabrykę, gdy plik stroju specjalnego się nie
 * wczytał, albo postać zastępcza) to personel w brand.green, więc budowany jest jeszcze raz z mundurem, a próba bez munduru jest
 * zwalniana. Strój specjalny musi być już gotowy (`ensureOutfit`), inaczej fabryka podstawia strój zwykły tej samej płci.
 */
export function createCashierCharacter(factory: CharacterFactory, look: CashierLook): CharacterInstance {
  const special = isSpecialOutfit(look.outfit);
  const character = factory.createWithOutfit(look.appearanceSeed, look.outfit, special ? undefined : UNIFORM);
  if (!special || (character.outfit !== null && isSpecialOutfit(character.outfit))) return character;
  releaseCharacter(character);   // poproszono o strój specjalny, a powstał zwykły: ta sama postać, tylko w mundurze
  return factory.createWithOutfit(look.appearanceSeed, look.outfit, UNIFORM);
}

/**
 * Rysuje kasjera gracza: jedna postać (`CharacterFactory.createWithOutfit`) na kratce pasa personelu za kasą (`cashierSpot`), z
 * własną plamą cienia (miejsce zarezerwowane w `BlobShadows`). Nie trzyma stanu gry, tylko to, co widać; klatkę po klatce dostaje
 * od gry obsługiwanego klienta i sygnał sprzedaży (`cashierCues` w game/cashier.ts).
 *
 * Postać gra `Idle`. Gdy ktoś płaci przy kasie, kasjer obraca się do niego tak jak postacie tłumu (TURN_RATE_MAX i to samo
 * wygładzanie), a bez klienta wraca do spojrzenia na kasę. Przy sprzedaży robi krótki gest proceduralny (podskok z ukłonem),
 * bez nowych klipów. Strój zwykły nosi w zieleni marki (mundur personelu, `OutfitOverrides.top`), specjalny zostaje sobą.
 *
 * Od załogi personelu na ekranie dostaje dwie rzeczy z zewnątrz. `setPose` zdejmuje go zza lady: chodzi po sklepie jak
 * pracownik (pozycja, obrót i klip chodu z pozy, bez gestu), a `setPose(null)` odstawia go za kasę. `setVisible(false)` chowa
 * go, gdy jest poza zmianą: postać zostaje (kolejna zmiana, wygląd i strój specjalny się nie gubią), tylko nie jest rysowana ani
 * animowana. Klip `idle`/`walk` wybiera `Gait`, ten sam co u pracowników, więc kasjer chodzi dokładnie jak oni.
 *
 * Strój specjalny dochodzi na żądanie (`ensureOutfit`, ruling R40): do tego czasu miejsce za ladą jest puste (albo stoi poprzedni
 * kasjer, gdy to zmiana wyglądu). Stroje zwykłe i specjalne, które fabryka już ma (`hasOutfit`), powstają od razu, więc remont w
 * środku klatki nie zostawia klatki bez kasjera. Układ bez kasy nie ma kasjera; widok jest wtedy bezczynny.
 */
export class CashierView {
  private readonly spot: CashierSpot | null;
  /** Kratka za kasą we współrzędnych świata (`null` bez kasy). */
  private readonly home: { x: number; z: number } | null;
  private current: CharacterInstance | null = null;
  /** Wybór klipu `current`; nowy przy każdej budowie postaci (nowa postać zaczyna w `idle`). */
  private gait: Gait | null = null;
  private look: CashierLook | null = null;
  private slot: BlobSlot | null = null;
  private yaw: number;
  /** Czas gestu w s animacji albo null, gdy nie trwa. */
  private gestureT: number | null = null;
  /** Numer ostatniego żądania wyglądu: spóźnione wczytanie stroju nie nadpisuje nowszego. */
  private request = 0;
  private castShadows = true;
  private disposed = false;
  /** Poza z `setPose`, gdy `posed`; zapisywana w miejscu, bo `setPose` bywa wołane co klatkę (bez alokacji). */
  private readonly pose: CashierPose = { x: 0, y: 0, heading: 0, moving: false };
  private posed = false;
  /** Czy kasjer jest na zmianie (`setVisible`): pamiętane też przed zbudowaniem postaci, bo strój specjalny dochodzi później. */
  private visible = true;

  /** `blobs`: wspólne plamy cienia (kasjer rezerwuje jedno miejsce); bez nich kasjer jest bez plamy. */
  constructor(
    private readonly factory: CharacterFactory,
    private readonly layout: StoreLayout,
    private readonly parent: Object3D,
    private readonly blobs: BlobShadows | null,
    look: CashierLook,
  ) {
    this.spot = cashierSpot(layout);
    this.home = this.spot ? cellToWorld(layout, this.spot.cell.x, this.spot.cell.y) : null;
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
    if (isOutfitReady(this.factory, wanted.outfit)) {
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
   * Kasjer chodzi: pozycja, obrót i klip z `pose` zamiast stania za kasą (bez gestu i bez patrzenia na klienta). Wołane co klatkę
   * z aktualną pozą; `update` ją stosuje. `null` odstawia kasjera na kratkę za kasą (od następnej klatki znów patrzy na klienta i
   * robi gest, a klip wraca do `Idle`). Poza jest kopiowana. Nie rusza wczytywania wyglądu: strój specjalny, który dopiero dochodzi,
   * powstanie od razu na pozycji z pozy.
   */
  setPose(pose: CashierPose | null): void {
    if (this.disposed) return;
    if (pose) {
      this.pose.x = pose.x;
      this.pose.y = pose.y;
      this.pose.heading = pose.heading;
      this.pose.moving = pose.moving;
      this.posed = true;
      return;
    }
    if (!this.posed) return;
    this.posed = false;
    if (this.current) this.place(this.current.object);
  }

  /**
   * Kasjer na zmianie (`true`, domyślnie) albo poza nią: postać i plama niewidoczne (`object.visible = false`, plama o zerowym
   * promieniu, miejsce w plamach zostaje), bez zwalniania, więc powrót na zmianę nie buduje niczego od nowa. Ukryty kasjer nie
   * jest animowany, bo nikt go nie widzi (`update` nic nie robi). Działa też przed zbudowaniem postaci i przy zmianie wyglądu.
   */
  setVisible(visible: boolean): void {
    if (this.disposed || visible === this.visible) return;
    this.visible = visible;
    if (!this.current) return;
    this.current.object.visible = visible;
    this.placeBlob(this.current.object);
  }

  /**
   * Jedna klatka. `dt` to czas ramki w sekundach symulacji (rzeczywisty dt × prędkość gry; 0 przy pauzie): napędza obrót.
   * `animDt` to czas ramki dla animacji (np. przycięty do `ANIM_SPEED_CAP` × dt, jak w tłumie): napędza klip i gest.
   * `serving` to klient płacący przy kasie (kasjer patrzy na niego) albo null, `sale` to sprzedaż w tej klatce (zaczyna gest).
   * Z pozą (`setPose`) kasjer idzie według niej, a `serving` i `sale` go nie obchodzą.
   */
  update(dt: number, serving: Agent | null, sale: boolean, animDt: number = dt): void {
    const character = this.current;
    if (this.disposed || !this.spot || !character || !this.visible) return;
    const o = character.object;
    if (this.posed) {
      this.gestureT = null;
      this.yaw = turnTowards(this.yaw, headingToYaw(this.pose.heading), dt);
      this.gait!.update(this.pose.moving, dt, animDt);
      this.place(o);
      o.rotation.x = 0;
    } else {
      if (sale) this.gestureT = 0;
      this.yaw = turnTowards(this.yaw, headingToYaw(this.headingTo(serving)), dt);
      this.gait!.update(false, dt, animDt);

      let bow = 0;
      if (this.gestureT !== null) {
        this.gestureT += animDt;
        if (this.gestureT >= GESTURE_S) this.gestureT = null;
        else bow = Math.sin(Math.PI * (this.gestureT / GESTURE_S));
      }
      o.position.y = GESTURE_HOP_M * bow;
      o.rotation.x = GESTURE_BOW_RAD * bow;
    }
    o.rotation.y = this.yaw;
  }

  /** Zwalnia postać i miejsce w plamach cienia. Po `dispose` kolejne wywołania nic nie robią. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.request++;   // wczytywanie w toku nic już nie postawi
    if (this.current) releaseCharacter(this.current);
    this.current = null;
    this.gait = null;
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

  /**
   * Stawia kasjera w danym wyglądzie tam, gdzie powinien być teraz (na kratce za kasą albo na pozycji z pozy, jeśli akurat chodzi),
   * z zachowaniem ukrycia; poprzednia postać (zmiana wyglądu) jest zwalniana po utworzeniu nowej.
   */
  private build(look: CashierLook): void {
    const character = createCashierCharacter(this.factory, look);
    const previous = this.current;
    this.current = character;
    this.gait = new Gait(character, this.factory.walkSpeedMps, STAFF_WALK_SPEED);   // nowa postać zaczyna w `idle`
    if (previous) releaseCharacter(previous);

    const o = character.object;
    o.rotation.order = 'YXZ';   // obrót wokół osi y postaci, a dopiero potem pochylenie (ukłon) wokół jej własnej osi x
    o.rotation.y = this.yaw;
    o.visible = this.visible;
    if (!this.castShadows) setCharacterShadowCasting(o, false);
    this.parent.add(o);
    this.gestureT = null;

    this.slot ??= this.blobs?.reserve() ?? null;
    this.place(o);
  }

  /** Stawia postać na podłodze na pozycji z pozy albo, bez pozy, na kratce za kasą, i plamę pod nią. */
  private place(o: Object3D): void {
    const at = this.posed ? cellToWorld(this.layout, this.pose.x - 0.5, this.pose.y - 0.5) : this.home!;   // poza w kratkach: środek = indeks + 0.5
    o.position.set(at.x, 0, at.z);
    this.placeBlob(o);
  }

  /** Plama pod stopami postaci (elipsa wg tuszy); ukryty kasjer ma ją o zerowym promieniu, ale miejsce w plamach zostaje. */
  private placeBlob(o: Object3D): void {
    if (!this.slot) return;
    const [rx, rz] = this.visible ? characterBlobRadii(o) : [0, 0];
    this.slot.set(o.position.x, o.position.z, rx, rz);
  }
}
