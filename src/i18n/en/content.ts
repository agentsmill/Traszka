import type { Cat } from '@/sim/economy/catalog';
import type { PalletLoc } from '@/sim/economy/storeInfo';
import type { CommentPool, HintId, ReportLineKey } from '@/sim/economy/tycoon/report';
import type { KpiKind } from '@/sim/economy/tycoon/kpi';
import type { StaffProfile, StaffTask } from '@/sim/economy/tycoon/staff';
import type { TrustReason, TrustTier } from '@/sim/economy/tycoon/trust';
import type { Weather } from '@/sim/economy/tycoon/cleanliness';
import type { WutReason } from '@/sim/economy/tycoon/wut';
import type { EquipmentId, UpgradeGroup, UpgradeId } from '@/sim/economy/upgrades';

/*
 * Angielska nakładka na dane gry z `src/sim/economy`, pod tymi samymi identyfikatorami co polskie dane (kategorie towaru,
 * ulepszenia, sprzęt, remonty, cele, progi zaufania, raport miesiąca, KPI, ludzie, pogoda, ubytki, rangi, kalendarz). Polskie dane
 * zostają tam, gdzie są; to tylko tekst do wyświetlenia. Kompletność (każdy identyfikator i każdy poziom ma tekst) sprawdza
 * `tests/i18n.test.ts`. Słownictwo: `docs/i18n/glossary-en.md`.
 */

export const EN_CATS: Record<Cat, string> = {
  napoje: 'Drinks',
  nabial: 'Dairy',
  slodycze: 'Sweets',
  przekaski: 'Snacks',
  pieczywo: 'Bread',
  chemia: 'Household',
  alkohol: 'Alcohol',
};

export const EN_GROUP_LABEL: Record<UpgradeGroup, string> = {
  kasa: 'Till',
  palety: 'Pallets and stockroom',
  klienci: 'Customers',
  warsztat: 'Handyman’s Workshop',
};

export interface EnUpgrade { names: string[]; effect: string; flavor: string }

export const EN_UPGRADES: Record<UpgradeId, EnUpgrade> = {
  szkolenie: {
    names: ['Training: “Smiling Is a Procedure”', 'Training: “Scan From the Hip”', 'Course: “Change in Two Seconds”', 'Traszka Till Championships', 'Ninja cashier'],
    effect: 'The till serves 15% faster',
    flavor: 'Certificate valid until the next change to the rulebook.',
  },
  drugaKasa: {
    names: ['Second till', 'Third till'],
    effect: '+1 till station (needs a cashier)',
    flavor: 'Head Office: “Two tills? And who’s paying for that? Oh, right. You.”',
  },
  scoSoft: {
    names: ['SCO 2.0: fewer “unexpected items”', 'SCO 3.0: the scales understand bananas', 'SCO 4.0: apologises in Polish'],
    effect: 'Self-checkouts: +15% speed and +8% more willing customers',
    flavor: 'Please place the item in the bagging area. Or don’t.',
  },
  klima: {
    names: ['Air conditioning', 'Radio Traszka FM'],
    effect: 'Customers queue for longer (+2 people)',
    flavor: 'Nobody walks out of the queue while “Always Close at Hand (Remix)” is playing.',
  },
  wozek: {
    names: ['Pallet truck', 'Electric pallet truck', 'Turbo pallet truck'],
    effect: 'Pallets unload 40% faster',
    flavor: 'The first pallet truck in the shop’s history with all of its wheels.',
  },
  regaly: {
    names: ['Storage racking', 'Stockroom mezzanine', 'Stockroom Tetris master'],
    effect: 'The stockroom holds 50% more stock and +1 pallet',
    flavor: 'You can finally see the floor. Almost.',
  },
  asystent: {
    names: ['Traszka Assistant: “sensible” mode', 'Traszka Assistant: “accountant” mode'],
    effect: 'The Assistant overorders less',
    flavor: '“40 hot dogs? Customers love it!” — not any more.',
  },
  nocne: {
    names: ['Night delivery slot'],
    effect: 'Delivery at 5:00 instead of 7:00, before the morning rush',
    flavor: 'The driver doesn’t sleep either. Nobody here sleeps.',
  },
  rampa: {
    names: ['Loading ramp and back door'],
    effect: 'Pallets go straight to the stockroom (when there’s room)',
    flavor: 'The pavement belongs to pedestrians again. The City Wardens are in mourning.',
  },
  dostawy2: {
    names: ['Second delivery (afternoon)'],
    effect: 'Orders arrive in two drops: in the morning and at 15:00',
    flavor: 'Twice as many signatures on the delivery note.',
  },
  ulotki: {
    names: ['Leaflets on the estate', 'Posters at the bus stop', 'Flyer through every letterbox', '“Always Close at Hand” billboard', 'Ad on the estate radio'],
    effect: 'Footfall +10%',
    flavor: '90% of leaflets go straight in the bin. The other 10% end up on the fridge as magnets.',
  },
  kawa: {
    names: ['Premium coffee machine', 'Robo-barista', 'Latte art shaped like a newt'],
    effect: 'More coffee and hot dogs sold (+30% hot food sales)',
    flavor: 'Flat whites for people who don’t know what a flat white is.',
  },
  traszkapka: {
    names: ['Traszkapp campaign', 'Coupons of the day', 'Double Ogonki Thursdays'],
    effect: 'Footfall +12% and more Ogonki',
    flavor: 'Push notification at 6:02. Everybody loves a 6:02 notification.',
  },
  kamery: {
    names: ['CCTV', 'AI CCTV (counts cats too)'],
    effect: 'Fewer “forgotten” scans at the self-checkouts and fewer fines',
    flavor: 'A cat was counted as three chocolate bars. Complaint under review.',
  },
  tasmociag: {
    names: ['Conveyor made from a treadmill', 'Conveyor with a washing-machine motor', 'Industrial conveyor “from my brother-in-law”'],
    effect: 'Unloads pallets by itself, at night too (+4 items/min)',
    flavor: 'Nobody had used the treadmill since January anyway.',
  },
  wykladacz: {
    names: ['3D-printed shelf stacker', 'Robot arm from a clearance sale', 'Stacker with an empty-shelf sensor'],
    effect: 'Moves stock from the stockroom to the shelves by itself, at night too (+12 items/min)',
    flavor: 'Printed in 37 hours. Works three times out of four.',
  },
  prasa: {
    names: ['Cardboard baler made from Grandad’s vice'],
    effect: 'Taking out a rubbish bag takes 2 person-minutes instead of 5',
    flavor: 'The vice finally came in handy. Grandad would be proud. Head Office, less so.',
  },
  humanoid: {
    names: ['eDward the humanoid'],
    effect: 'eDward does the work of three, 24 hours a day, no wages',
    flavor: 'Built from a hoover, windscreen wipers and an old laptop. Says “dzień dobry” (good morning) at every hour of the day and night.',
  },
};

export const EN_EQUIPMENT: Record<EquipmentId, { name: string; effect: string }> = {
  sco: { name: 'Self-checkout', effect: 'Serves customers without a cashier' },
  bankomat: { name: 'Cash machine', effect: 'Footfall +4% and 25 zł a day in rent' },
  paczkownik: { name: 'Parcel locker 24h', effect: 'Footfall +7%: picking up a parcel always means “just one more thing”' },
  piec: { name: 'Pizza oven', effect: 'Hot food sales +40%' },
};

/** Remonty po poziomie (`RemontDef.level`). */
export const EN_REMONTS: Record<number, string> = {
  1: 'Refit: take over the unit next door',
  2: 'Refit: Premium edition',
  3: 'Refit: Flagship',
};

export const EN_MILESTONES: Record<string, { label: string; hint: string }> = {
  pallet1: { label: 'First pallet unloaded', hint: 'Tap pallets or the “Unload” button' },
  upgrade1: { label: 'First upgrade', hint: 'Buy something in the Upgrades tab' },
  cust500: { label: '500 customers served', hint: 'Keep the queue short and the shelves full' },
  sco1: { label: 'First self-checkout', hint: 'Tap an orange slot in the shop' },
  staff3: { label: 'Dream team: 3 people on shift', hint: 'Hire in the Staff tab' },
  earned10k: { label: '10,000 zł in margin', hint: 'Sell more, lose less' },
  month1: { label: 'First month in the black', hint: 'Make it to a monthly report with a profit' },
  cust5k: { label: '5,000 customers served', hint: 'Leaflets and reputation bring people in' },
  sco4: { label: 'Self-checkout army: 4 self-checkouts', hint: 'A 2×2 slot fits two self-checkouts' },
  remont1: { label: 'First refit', hint: 'A refit makes the shop bigger and adds slots' },
  workshop: { label: 'Handyman: first automation', hint: 'The Workshop unlocks at level 10' },
  earned250k: { label: 'A quarter of a million in margin', hint: 'Scale up the shop and the automation' },
  sco8: { label: 'Eight self-checkouts', hint: 'A refit gives you more slots' },
  flagowiec: { label: 'Flagship', hint: 'The third refit' },
  edward: { label: 'eDward takes over the shift', hint: 'The humanoid from the Workshop' },
};

export const EN_TRUST_TIERS: Record<TrustTier['id'], { label: string; flavor: string }> = {
  ulubieniec: { label: 'Head Office’s Favourite', flavor: 'Your photo is in the newsletter. Page 14, but still.' },
  partner: { label: 'Trusted Partner', flavor: 'Viral ice creams reach you before the Traszka down the road.' },
  porzadek: { label: 'In Good Standing', flavor: 'You’re green on Head Office’s spreadsheet. Pale green.' },
  obserwacja: { label: 'Under Observation', flavor: 'Head Office knows you by name. Unfortunately.' },
  cenzura: { label: 'In the Bad Books', flavor: 'Every email you send goes to the “Clarifications” department.' },
  wylot: { label: 'On the Way Out', flavor: 'Head Office is asking who has the spare set of shop keys.' },
};

export const EN_TRUST_REASONS: Record<TrustReason, string> = {
  kpi: 'Weekly KPI',
  karty: 'Daily decisions',
  okolnik: 'Head Office circulars',
  audyt: 'Audits and mystery shoppers',
  mandaty: 'Fines',
  palety: 'Returned pallets',
  wynik: 'Month’s result',
  inne: 'Other',
};

export const EN_REPORT_LINES: Record<ReportLineKey, string> = {
  marza: 'Sales margin',
  premie: 'Head Office bonuses',
  gwarancja: 'Guaranteed income top-up',
  inne: 'Other income and costs',
  place: 'Wages',
  media: 'Utilities',
  zus: 'ZUS',
  vat: 'VAT',
  ksiegowa: 'Accountant',
  oplata: 'Franchise fee',
  mandaty: 'Fines and penalties',
  wut: 'Shrinkage over Head Office’s limit',
  logistyka: 'Pallets over the free allowance',
  remanent: 'Stocktake: shrinkage over the limit',
};

/** Komentarze Centrali do raportu: te same pule i kolejność co `COMMENTS` (id komentarza to `pula-numer`). */
export const EN_COMMENTS: Record<CommentPool, readonly string[]> = {
  strata: [
    'A month in the red. Head Office recommends the training course “How to Earn More by Spending Less” (paid).',
    'Head Office is watching your results with concern and reminds you that we believe in you. For now.',
    'A negative result is still a result. Head Office will feature it in the “Network Challenges” presentation, slide 47.',
  ],
  zero: [
    'You broke even. Head Office calls this “stability” and is raising next month’s KPIs.',
    'No profit, no loss. Head Office congratulates you on your yoga-like balance. Your accountant still wants paying.',
    'Almost in the black. Head Office suggests dropping the “almost”.',
  ],
  plus: [
    'You’re in the black! Head Office congratulates you and raises next month’s KPIs.',
    'A good month. Head Office is considering a mention of you in the newsletter (page 14).',
    'A positive result. Head Office credits its new strategy, but you know better.',
  ],
  rekord: [
    'Record month! Head Office credits the success to Head Office’s new strategy.',
    'Great result. Head Office asks whether you’d like to open a second Traszka across the road from the first.',
    'Impressive. Head Office is sending you a certificate in PDF and a 40-question satisfaction survey.',
  ],
};

/** Wskazówka raportu (`hintText`): `v` to liczba już sformatowana po angielsku. */
export const EN_HINTS: Record<HintId, (v: string) => string> = {
  mandaty: (v) => `Fines cost you ${v} zł. Switch to the “Delivery” work profile in the morning, so pallets don’t sit on the pavement past the grace period.`,
  wut: (v) => `Stocktake: shrinkage over Head Office’s limit, ${v} zł. Order what actually sells, and mark down the sandwiches at 18:00 (FEFO) before they end up in the bin.`,
  logistyka: (v) => `Pallets over the free allowance: ${v} zł deducted from the transfer. The Assistant overorders; try ordering by hand.`,
  kolejka: (v) => `The queue scared off ${v} customers. At peak times switch to the “Queue” profile or install a self-checkout.`,
  czystosc: (v) => `Average shop-floor cleanliness: ${v}%. Switch to the “Tidy” profile or pin someone to cleaning before an audit or a mystery shopper turns up.`,
  bezczynnosc: (v) => `Staff stood around with nothing to do for ${v} h. Maybe one person fewer on shift?`,
  braki: (v) => `Tasks waited for people for ${v} h. Hire someone or buy automation from the Workshop.`,
  zmeczenie: (v) => `Your hands gave out on ${v} days. A night’s rest only restores part of your energy: take a day off tapping at least once a week.`,
  zaufanie: (v) => `Head Office’s trust fell by ${v} pts. Weekly KPIs and answering circulars are the cheapest way to win it back.`,
  karty: (v) => `${v} times you confirmed the pre-selected answer. It’s rarely the best one: read the card before you click.`,
  kpi: (v) => `Weekly KPIs missed: ${v}. Check the goal on Monday, before the week runs away from you.`,
  brawo: () => 'All good. Head Office will raise the KPIs anyway, but that’s their problem now.',
};

/** Cel KPI tygodnia (`kpiTitle`): `x` to cel już sformatowany. */
export const EN_KPI_TITLE: Record<KpiKind, (x: string) => string> = {
  kawy: (x) => `Sell ${x} coffees and hot dogs by Sunday`,
  klienci: (x) => `Serve ${x} customers by Sunday`,
  kolejka: (x) => `By Sunday, no more than ${x} customers scared off by the queue`,
  czystosc: (x) => `Average shop-floor cleanliness of at least ${x}% by Sunday`,
  bezMandatu: () => 'A week without fines: no pallets sleeping on the pavement',
};

export const EN_KPI_FLAVOR: Record<KpiKind, string> = {
  kawy: 'Head Office: “Coffee is the new oil. Hot dogs are the new coffee.”',
  klienci: 'Head Office counts its customers. Customers count their change.',
  kolejka: 'A customer who walks out of the queue doesn’t come back. Unless it’s to Szop 24h.',
  czystosc: 'The auditor turns up wearing white gloves. Literally.',
  bezMandatu: 'The City Wardens have KPIs too. Don’t be their KPI.',
};

export const EN_TASK_LABEL: Record<StaffTask, string> = {
  kasa: 'Till',
  rozladunek: 'Unloading pallets',
  wykladanie: 'Stocking shelves',
  sprzatanie: 'Cleaning and rubbish',
};

export const EN_PROFILE_LABEL: Record<StaffProfile | 'wlasny', string> = {
  kolejka: 'Queue',
  dostawa: 'Delivery',
  porzadek: 'Tidy',
  wlasny: 'Custom order',
};

export const EN_PROFILE_HINT: Record<StaffProfile, string> = {
  kolejka: 'Till first, then shelves, pallets and the broom. The customer is king; the pallet can wait.',
  dostawa: 'Pallets first, then the till. Customers can wait; the City Wardens won’t.',
  porzadek: 'Cleaning and rubbish first. The auditor has white gloves and all the time in the world.',
};

export const EN_WEATHER: Record<Weather, string> = { sucho: 'Dry', upal: 'Heatwave', deszcz: 'Rain', snieg: 'Snow' };

export const EN_WUT_LABEL: Record<WutReason, string> = {
  termin: 'Out-of-date stock',
  kradziez: 'Theft and “forgotten” scans',
  pomylki: 'Mistakes and breakages',
  karty: 'Daily decisions',
};

export const EN_LOC_LABEL: Record<PalletLoc, string> = {
  sidewalk: 'On the pavement',
  backroom: 'In the stockroom',
  floor: 'On the shop floor',
  aisle: 'In the aisles',
};

/** Rangi po poziomie, od którego obowiązują (`rankFor` w progress.ts). Rangi to palety, więc bez rodzaju gramatycznego. */
export const EN_RANKS: Record<number, string> = {
  1: 'Wooden Pallet',
  5: 'EURO Pallet',
  10: 'Shrink-Wrapped Pallet',
  15: 'Silver Pallet',
  20: 'Golden Pallet',
  30: 'Platinum Pallet',
  40: 'Diamond Pallet',
  50: 'Legendary Pallet',
};

/** Kalendarz: dni tygodnia od niedzieli (jak `WEEKDAY_SHORT`) i miesiące od stycznia (jak `MONTH_NAME`). */
export const EN_WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const EN_MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November',
  'December'] as const;
