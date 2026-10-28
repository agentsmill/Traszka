import type { Object3D } from 'three';
import { cashierSpot } from '@/game/cashier';
import { createCashierCharacter, releaseCharacter, type CashierPose, type CashierView } from '@/render/cashierView';
import { characterBlobRadii, setCharacterShadowCasting, type BlobShadows, type BlobSlot } from '@/render/characters/blobShadows';
import type { CharacterFactory, CharacterInstance } from '@/render/characters/characterFactory';
import { Gait } from '@/render/characters/gait';
import { cellToWorld } from '@/render/coords';
import { headingToYaw, turnTowards } from '@/render/crowdView';
import type { Agent } from '@/sim/crowd/crowd';
import type { StoreLayout } from '@/sim/store/types';
import { StaffCrew, type CrewInput, type CrewMember } from './crew';
import { STAFF_WALK_SPEED, type StaffWalker } from './walker';

/** Jedno ciało pracownika wraz z tym, czego potrzeba do jego rysowania klatka po klatce. */
interface Body {
  readonly id: number;
  readonly character: CharacterInstance;
  readonly gait: Gait;
  /** Miejsce w plamach cienia; `null`, gdy cała pojemność jest już zarezerwowana (postać stoi wtedy bez plamy). */
  readonly slot: BlobSlot | null;
  /** Promienie plamy (m): postać ma stałą tuszę, więc liczymy je raz, a nie co klatkę. */
  readonly rx: number;
  readonly rz: number;
  /** Obrót wokół osi y (rad), wygładzany jak u tłumu i kasjera. */
  yaw: number;
  /** Gdzie ostatnio ustawiono plamę (świat): plama stojącego nie jest zapisywana od nowa. */
  blobX: number;
  blobZ: number;
  /** Numer klatki, w której osoba jeszcze była w załodze; ciała ze starszym numerem zwalniamy. */
  seen: number;
}

/**
 * Rysuje załogę sklepu: jedna postać na osobę z `StaffCrew` (kto jest w sklepie, dokąd idzie i co robi liczy załoga, tu widać
 * tylko jej stan). Nic z widoku nie wraca do symulacji.
 *
 * Koszt jest taki jak klienta: jedna postać z wspólnej `CharacterFactory` to jedna `SkinnedMesh` (1 draw call, +1 w przebiegu
 * cienia tylko na `wysoka`), a plama pod stopami to wyłącznie zarezerwowane miejsce w `BlobShadows`, zwalniane razem z postacią.
 * Nie ma dodatkowych materiałów, siatek ani tekstur. Żadna postać nie jest przeglądana co klatkę (`traverse` tylko wtedy, gdy
 * zmienia się polityka cieni); w załodze jest najwyżej `STAFF_VIEW_MAX` osób, więc tyle samo ciał.
 *
 * Ciało kasjera z ekranu startowego ma `CashierView`, więc osoba oznaczona `isCashier` nie dostaje drugiej postaci: widok tylko
 * prowadzi tamtą (`setPose`, `setVisible`). Gdy kasjer stoi na kratce za kasą, `CashierView` sam obsługuje klienta i robi gest
 * przy sprzedaży (`setPose(null)`); w marszu i w pracy poza kasą idzie po sklepie jak pracownik. Bez kasjera w załodze
 * (nikogo nie ma na zmianie) `CashierView` jest ukryty. `update` woła się przed `CashierView.update` w tej samej klatce, żeby
 * kasjer dostał pozę z bieżącej klatki. Bez `CashierView` (`null`, benchmark) osoba z ciałem kasjera po prostu nie jest rysowana.
 *
 * Załoga trzyma własną kopię układu, więc nowy układ (remont) to nowy `StaffView` (`loadStore` buduje go razem ze sklepem).
 */
export class StaffView {
  readonly crew: StaffCrew;
  private readonly bodies = new Map<number, Body>();
  /** Id osób, dla których fabryka rzuciła przy budowie: nie próbujemy ich co klatkę, błąd leci do konsoli raz na osobę. */
  private readonly failed = new Set<number>();
  /** Środek kratki za kasą w kratkach (`null` bez kasy): tam pracownik z zadaniem `kasa` stoi twarzą do klienta. */
  private readonly tillX: number | null;
  private readonly tillY: number | null;
  /** Kierunek patrzenia z kratki za kasą na klienta, gdy ten stoi dokładnie w niej (nie ma wtedy kierunku): kasa. */
  private readonly tillHeading: number;
  /** Poza przekazywana `CashierView`; `setPose` ją kopiuje, więc jeden obiekt na cały czas (bez alokacji co klatkę). */
  private readonly pose: CashierPose = { x: 0, y: 0, heading: 0, moving: false };
  private frameNo = 0;
  /** Czy ekonomia już coś podała (`sync`): wcześniej załoga jest pusta tylko dlatego, że nikt jej jeszcze nie opisał (benchmark bez sesji, pierwsze ~100 ms), więc kasjera nie ruszamy. */
  private synced = false;
  private castShadows = true;
  private disposed = false;

  /** `blobs`: wspólne plamy cienia (każdy pracownik rezerwuje jedno miejsce); `cashier`: widok kasjera, którego ten widok prowadzi. */
  constructor(
    private readonly factory: CharacterFactory,
    private readonly layout: StoreLayout,
    private readonly parent: Object3D,
    private readonly blobs: BlobShadows | null,
    private readonly cashier: CashierView | null,
  ) {
    this.crew = new StaffCrew(layout);
    const spot = cashierSpot(layout);
    this.tillX = spot ? spot.cell.x + 0.5 : null;
    this.tillY = spot ? spot.cell.y + 0.5 : null;
    this.tillHeading = spot?.heading ?? 0;
  }

  /** Liczba postaci pracowników w scenie, bez kasjera (diagnostyka i testy). */
  get size(): number { return this.bodies.size; }

  /** Wołane co ~100 ms z ekonomii; ciała powstają dopiero w `update`, więc to jest tanie. Po `dispose` nic nie robi. */
  sync(input: CrewInput): void {
    if (this.disposed) return;
    this.synced = true;
    this.crew.sync(input);
  }

  /**
   * Czy pracownicy rzucają cień z mapy cieni (polityka cieni z presetu jakości, `QualitySettings.characterShadows`: +1 draw call
   * na postać tylko na `wysoka`). Dotyczy obecnych i przyszłych ciał; kasjerem zajmuje się jego własny widok. Wołane co klatkę:
   * bez zmiany nic nie robi.
   */
  setCharacterShadows(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const body of this.bodies.values()) setCharacterShadowCasting(body.character.object, on);
  }

  /**
   * Jedna klatka. `dt` to czas ramki w sekundach gry (rzeczywisty dt × prędkość; 0 przy pauzie): posuwa załogę i napędza obrót.
   * `animDt` to czas ramki dla animacji (np. przycięty do `ANIM_SPEED_CAP` × dt). `serving` to klient płacący przy kasie, na
   * którego patrzy każdy stojący na kratce kasjera (kasjer z `CashierView` patrzy sam, gdy stoi za ladą).
   */
  update(dt: number, animDt: number, serving: Agent | null): void {
    if (this.disposed) return;
    this.crew.step(dt);

    const frame = ++this.frameNo;
    let cashierMember: CrewMember | null = null;
    for (const member of this.crew.members) {
      if (member.isCashier) {
        cashierMember = member;
        continue;
      }
      const body = this.bodies.get(member.id) ?? this.spawn(member);
      if (!body) continue;
      body.seen = frame;
      this.drive(body, member.walker, dt, animDt, serving);
    }
    this.releaseGone(frame);
    this.driveCashier(cashierMember);
  }

  /** Zwalnia wszystkie ciała i miejsca w plamach, a kasjera odstawia tam, gdzie stoi bez tego widoku. Kolejne wywołania nic nie robią. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const body of this.bodies.values()) this.release(body);
    this.bodies.clear();
    this.failed.clear();
    // Nikt już nie prowadzi kasjera: bez tego zostałby tam, gdzie go ostatnio postawiono, albo schowany. Zwolniony wcześniej
    // `CashierView` ignoruje oba wywołania, więc kolejność z jego `dispose` nie ma znaczenia.
    this.cashier?.setPose(null);
    this.cashier?.setVisible(true);
  }

  /** Czy osoba stoi na kratce kasjera na swoim celu (`atGoal`: stoi dokładnie na środku kratki celu, więc cel to ta kratka). */
  private atTill(walker: StaffWalker): boolean {
    return this.tillX !== null && walker.atGoal && walker.x === this.tillX && walker.y === this.tillY;
  }

  /** Dokąd patrzy pracownik: stojący na kasie na klienta (jak `CashierView`), w pozostałych przypadkach tak, jak idzie albo stoi. */
  private headingOf(walker: StaffWalker, serving: Agent | null): number {
    if (!serving || !this.atTill(walker)) return walker.heading;
    const dx = serving.x - this.tillX!, dy = serving.y - this.tillY!;
    return Math.hypot(dx, dy) < 1e-6 ? this.tillHeading : Math.atan2(dy, dx);
  }

  /** Stawia, obraca i animuje jedno ciało, i przesuwa jego plamę. */
  private drive(body: Body, walker: StaffWalker, dt: number, animDt: number, serving: Agent | null): void {
    const o = body.character.object;
    const at = cellToWorld(this.layout, walker.x - 0.5, walker.y - 0.5);   // walker w kratkach: środek kratki = indeks + 0.5
    o.position.set(at.x, 0, at.z);
    body.yaw = turnTowards(body.yaw, headingToYaw(this.headingOf(walker, serving)), dt);
    o.rotation.y = body.yaw;
    body.gait.update(walker.moving, dt, animDt);
    if (body.slot && (at.x !== body.blobX || at.z !== body.blobZ)) {
      body.slot.set(at.x, at.z, body.rx, body.rz);
      body.blobX = at.x;
      body.blobZ = at.z;
    }
  }

  /** Most do `CashierView`: poza z marszu albo `null` na kratce za kasą; bez kasjera w załodze widok jest ukryty. */
  private driveCashier(member: CrewMember | null): void {
    const view = this.cashier;
    if (!view || !this.synced) return;   // bez opisu zmiany kasjer stoi za ladą jak dawniej
    if (!member) {
      view.setVisible(false);
      view.setPose(null);
      return;
    }
    view.setVisible(true);
    const walker = member.walker;
    if (this.atTill(walker)) {
      view.setPose(null);
      return;
    }
    const pose = this.pose;
    pose.x = walker.x;
    pose.y = walker.y;
    pose.heading = walker.heading;
    pose.moving = walker.moving;
    view.setPose(pose);
  }

  /**
   * Nowe ciało dla osoby: ten sam mundur co u kasjera (`createCashierCharacter`), strój i wygląd z id, więc ta sama osoba wygląda
   * tak samo przy każdym wejściu. Gdy fabryka rzuci, osoby nie rysujemy (błąd raz do konsoli), a klatka toczy się dalej.
   */
  private spawn(member: CrewMember): Body | null {
    const { id, walker } = member;
    if (this.failed.has(id)) return null;
    let character: CharacterInstance | null = null;
    let slot: BlobSlot | null = null;
    try {
      character = createCashierCharacter(this.factory, { outfit: id % 2 === 0 ? 'men-worker' : 'women-worker', appearanceSeed: `pracownik-${id}` });
      const o = character.object;
      o.rotation.y = headingToYaw(walker.heading);
      if (!this.castShadows) setCharacterShadowCasting(o, false);
      slot = this.blobs?.reserve() ?? null;
      this.parent.add(o);
      const [rx, rz] = characterBlobRadii(o);
      const body: Body = {
        id, character, slot, rx, rz,
        gait: new Gait(character, this.factory.walkSpeedMps, STAFF_WALK_SPEED),   // nowa postać zaczyna w `idle`
        yaw: o.rotation.y, blobX: NaN, blobZ: NaN, seen: 0,
      };
      this.bodies.set(id, body);
      return body;
    } catch (error) {
      slot?.release();
      if (character) releaseCharacter(character);
      this.failed.add(id);
      console.error(`Nie udało się zbudować pracownika ${id}.`, error);
      return null;
    }
  }

  /** Zwalnia ciała osób, których nie ma już w załodze (wyszły albo zostały zwolnione), i zapomina o nieudanych budowach tych osób. */
  private releaseGone(frame: number): void {
    for (const body of this.bodies.values()) if (body.seen !== frame) this.drop(body.id);
    if (this.failed.size === 0) return;
    for (const id of this.failed) if (!this.crew.members.some((m) => m.id === id)) this.failed.delete(id);
  }

  private drop(id: number): void {
    const body = this.bodies.get(id);
    if (!body) return;
    this.bodies.delete(id);
    this.release(body);
  }

  private release(body: Body): void {
    releaseCharacter(body.character);
    body.slot?.release();
  }
}
