/*
 * Karty decyzji i okólniki Centrali po angielsku, pod tymi samymi `id` co `DECK` i `CIRCULARS` w `src/sim/economy/tycoon/deck.ts`.
 * Odpowiedzi w tej samej kolejności; `risk` tylko tam, gdzie polska odpowiedź ma ryzyko. Parametry karty (`{n}`, `{v}`…) zostają
 * w tekście, a wypełnia je ten sam `fillText` co po polsku. Zgodność (każda karta, liczba odpowiedzi, ryzyka, parametry) sprawdza
 * `tests/i18n.test.ts`. To przekład żartu, nie słowo w słowo; zmienione żarty wylicza opis PR.
 */

export interface EnAnswer { label: string; result: string; risk?: string }
export interface EnCard { title: string; text: string; answers: EnAnswer[] }

export const EN_CARDS: Record<string, EnCard> = {
  fefo: {
    title: 'FEFO at 18:00',
    text: 'There are {n} sandwiches in the fridge that expire today ({v} zł in total). The FEFO system (first expired, first out) is flashing red, and the sandwiches are giving you a reproachful look.',
    answers: [
      { label: 'Mark them down 30% with a “WASTE NOT, WANT NOT” sticker', result: 'Stickers on. Half the sandwiches vanished within fifteen minutes; the other half are waiting for a miracle.' },
      { label: 'Surprise bags on the Traszkapp', result: 'The bags sold out within an hour. Someone on the Traszkapp left five stars and a photo of a sandwich with a little heart.' },
      {
        label: 'Leave them, someone might be tempted',
        result: 'A miracle! The last customer of the evening bought the lot. Said it was for a party, and nobody asked any further.',
        risk: 'Nobody was tempted. The sandwiches go in the bin, and their value goes into shrinkage.',
      },
    ],
  },
  glitch: {
    title: 'Till glitch',
    text: 'Since this morning the till system has been giving {p}% off everything. Customers have noticed: the queue reaches the bus stop, and someone is phoning their cousin with the van.',
    answers: [
      { label: 'Close the shop for an hour and call the engineer', result: 'The engineer came, turned it off and on again. It works. So does the invoice.' },
      { label: 'Keep selling; the discount comes out of your margin', result: 'The whole estate loves you. Your accountant, slightly less.' },
      { label: 'Ring the Head Office helpline', result: '“Your call is important to us.” After 45 minutes the system fixed itself, and the discount had a lovely time in the meantime.' },
    ],
  },
  chory: {
    title: 'A “sick” employee on delivery day',
    text: '5:58. Zbyszek rings to say he ate a hot dog from Head Office’s promotion yesterday and he’s “coming down with something”. Today of all days, the lorry is bringing pallets ({n} of them). Head Office doesn’t believe in coincidences, only in KPIs.',
    answers: [
      { label: 'I’ll cover for him myself', result: 'Franchisee on the till, franchisee on the pallets, franchisee in the mirror at 23:00. Same person, just older.' },
      { label: 'Cover from a temp agency', result: 'The agency sent Mrs Mariola. Mrs Mariola knows the till better than you do. You know the invoice pretty well, too.' },
      { label: 'We’ll muddle through one short', result: 'We muddled through. The pallets waited a bit; the queue sighed a bit.' },
    ],
  },
  audyt: {
    title: 'Audit announced',
    text: 'Head Office announces an audit for tomorrow. They’ll check the planogram, the cleanliness, and whether the cashier’s smile complies with procedure 4.2.1. Given the current state of the shop floor, the risk of getting caught out is {p}%.',
    answers: [
      {
        label: 'A deep clean after closing',
        result: 'The auditor ran a finger along a shelf and nodded. Either in approval or in disappointment at having nothing to write down.',
        risk: 'The auditor found one crumb. It was a strategic crumb.',
      },
      {
        label: 'Hire a cleaning company',
        result: 'The cleaners scrubbed even things that weren’t there. Audit passed.',
        risk: 'The auditor found it “suspiciously clean”. Points deducted for lack of authenticity.',
      },
      {
        label: 'Whatever will be, will be',
        result: 'It went fine. The auditor was worn out from the previous shop and mostly looked at their phone.',
        risk: 'The auditor found dust on the dust. The report runs to 14 pages, three of them about the mop, with a fine at the end.',
      },
    ],
  },
  promocja: {
    title: 'Mandatory Head Office promotion',
    text: 'Head Office announces the “Second Traszdog for 1 grosz” promotion. Participation is mandatory. On a voluntary basis.',
    answers: [
      { label: 'All in: posters, shelf wobblers, a smile', result: 'The promotion is flying. One-grosz coins pour into the till; hot dogs pour out of it.' },
      { label: 'I’m in, but the poster hangs behind the household aisle', result: 'The promotion is officially running. Only the till and one sharp-eyed pensioner know about it.' },
      { label: 'The email must have gone to spam', result: 'Head Office checked whether its emails go to spam. They don’t.' },
    ],
  },
  cenowki: {
    title: 'Price tag inspection',
    text: 'An inspector is checking that the price tags are legible. They have a magnifying glass, a ruler and plenty of time. You have {n} price tags showing prices from before the last promotion.',
    answers: [
      { label: 'Fix everything on the spot', result: 'Price tags fresh from the printers. The inspector wrote “no remarks” with a particularly sad pen.' },
      {
        label: 'A coffee for the inspector and a chat about the weather',
        result: 'The inspector drank the coffee, praised the weather and didn’t notice the price tags. Or did notice, but had already had the coffee.',
        risk: 'The inspector drank the coffee and wrote out a fine. The coffee went into the report too.',
      },
      {
        label: 'Let them check; our intentions are good',
        result: 'The inspector found nothing. Even they were surprised.',
        risk: 'A fine for the price tags. Good intentions don’t have a barcode.',
      },
    ],
  },
  memy: {
    title: 'Traszkashopposting',
    text: 'Krystian the cashier runs a meme account about the shop. It has more followers than Head Office’s profile and not a single meme about Head Office. Yet.',
    answers: [
      {
        label: 'I’m in! An hour a day for filming',
        result: 'The “pallet season” meme has 200,000 views. The whole estate comes in to see the pallets in person.',
        risk: 'Head Office watched the “pallet season” meme. It didn’t get it. Then it got it.',
      },
      { label: 'Report it to Head Office and let them handle it', result: 'Head Office hired an agency that does the same thing, only worse and more expensively. Krystian now makes memes about the agency.' },
      {
        label: 'Pretend I haven’t seen it',
        result: 'The account keeps growing, and you know nothing about it. Officially.',
        risk: 'Head Office found the account and wants to know why nobody reported it.',
      },
    ],
  },
  mecz: {
    title: 'National team match',
    text: 'The national team plays tonight. The estate is preparing as if lives depended on the result. At most, the beer and crisps supply does.',
    answers: [
      { label: 'An extra pallet of beer and crisps', result: 'The fans bought everything before kick-off. After the match they came back for the rest, but there was no rest left.' },
      { label: 'A poster: “Fans! Cold beer this way!”', result: 'The poster works. The beer was cold, the fans came, the goal didn’t.' },
      { label: 'It’s only football', result: 'The match happened. The result was the usual. The fans bought their beer at Szop 24h.' },
    ],
  },
  widmo: {
    title: 'Phantom stock',
    text: 'The driver slides the delivery note over for you to sign and glances at their watch. The paperwork lists {n} more multipacks than you can see on the pallet ({v} zł in total).',
    answers: [
      { label: 'Count everything in front of the driver', result: 'Counted. The driver sighed, crossed it out and signed. The phantom multipacks went back to the phantom warehouse.' },
      {
        label: 'Sign with a note and complain later',
        result: 'Complaint accepted. Head Office apologises and promises it will never happen again. Until tomorrow.',
        risk: 'Complaint rejected: “no proof that the multipacks weren’t there”.',
      },
      { label: 'Sign it; the driver is in a hurry', result: 'Signed. The phantom multipacks moved into shrinkage, where they’ll haunt you until the end of the month.' },
    ],
  },
  sasiad: {
    title: 'A neighbour complains',
    text: 'Mrs Halina from the second floor rings to complain that the pallets outside are blocking her view of life. And of the car park.',
    answers: [
      { label: 'An apology and a box of chocolates', result: 'Mrs Halina accepted the chocolates and said she’d ring again tomorrow. Just to keep in touch.' },
      { label: 'Move the pallets before the Wardens turn up', result: 'Pallets moved. Mrs Halina can now see the car park and is disappointed by the car park.' },
      {
        label: 'Don’t pick up',
        result: 'Mrs Halina is offended. Luckily, only with you.',
        risk: 'Mrs Halina rang someone else. The City Wardens arrived in 7 minutes, a district record.',
      },
    ],
  },
  lodowka: {
    title: 'Fridge breakdown',
    text: 'The dairy fridge is wailing like a siren and heating like a radiator. Inside, {n} yoghurts ({v} zł in total) look on anxiously.',
    answers: [
      { label: 'Express repair', result: 'The engineer kicked the compressor in exactly the right spot. The kick is itemised on the invoice.' },
      { label: 'Move the dairy to the other fridge', result: 'The other fridge is bursting at the seams, but the yoghurts survived. Most of them.' },
      { label: 'Maybe it’ll sort itself out', result: 'It didn’t. The yoghurts crossed over to the dark side of their use-by date.' },
    ],
  },
  influencer: {
    title: 'An influencer wants to film an unboxing',
    text: 'A local influencer ({n}k followers, reportedly including humans) wants to film a “Traszdog unboxing” in your shop.',
    answers: [
      {
        label: 'Go ahead; hot dogs for the crew on the house',
        result: 'The video has 40,000 views. The hot dog came across better than you did.',
        risk: 'The stockroom got into the background. The internet rated the stockroom 2/10.',
      },
      { label: 'Only with Head Office’s written consent', result: 'Head Office replied a week later, granting consent for filming last Thursday.' },
      { label: 'Politely decline', result: 'The influencer filmed the unboxing at Kawka Express. Your hot dog remains unboxed.' },
    ],
  },
  sejf: {
    title: 'Takings over the weekend',
    text: 'Saturday night. The safe holds the whole week’s takings, and the bank doesn’t open until Monday. The safe has a lock from 1998 and a great sense of humour.',
    answers: [
      { label: 'Take the takings to the deposit machine', result: 'The deposit machine took everything except one crumpled twenty. It came home with you as a souvenir.' },
      {
        label: 'Leave it in the safe',
        result: 'Monday: safe intact, takings intact, the neighbours’ cat suspiciously pleased with itself.',
        risk: 'Someone paid the safe a visit. The camera only caught the cat. The cat isn’t talking.',
      },
    ],
  },
  ulewa: {
    title: 'Mud after the downpour',
    text: 'It’s pouring outside, and customers are bringing half the estate in on their shoes. The floor by the entrance looks like a map of a river delta.',
    answers: [
      { label: 'An XXL doormat and a “Caution: wet floor” sign', result: 'The sign is up, the mat is soaking it up. Customers give the sign a wide berth, straight into the puddle.' },
      { label: 'Mop every hour', result: 'The floor sparkles every hour, for five minutes. The rest is contemporary art.' },
      {
        label: 'It’ll dry eventually',
        result: 'It dried. After three days, but it dried.',
        risk: 'A customer slipped by the fridge. They’re fine, but they have a cousin who’s a lawyer.',
      },
    ],
  },
  wiek: {
    title: 'A teenager wants an energy drink',
    text: 'A boy with a moustache drawn on in felt-tip wants to buy an energy drink. He claims he turned 18 yesterday and left his ID in his other trousers.',
    answers: [
      { label: 'Ask for ID', result: 'The boy took offence at the entire shop and posted a story about it. The story has 12 views, 11 of them his.' },
      {
        label: 'Sell it; the moustache looks convincing',
        result: 'Sale complete. The moustache smudged on the way out.',
        risk: 'Right behind the boy came an inspection. The inspectors’ moustaches were real.',
      },
      { label: 'Call the manager (that’s you)', result: 'The manager arrived, took a look and said no. The boy bought a bottle of water and left with his dignity intact.' },
    ],
  },
  ekspres: {
    title: 'The coffee machine rebels',
    text: 'The coffee machine shows error E-404: “coffee not found in coffee”. The queue for morning flat whites is starting to grumble.',
    answers: [
      { label: 'Call the engineer, and quick', result: 'The engineer pulled a teaspoon from 2019 out of the machine. The coffee is flowing; so is the invoice.' },
      {
        label: 'Descale it myself with an online tutorial',
        result: 'Machine descaled, and you’re proud of yourself. The coffee tastes better than before it broke.',
        risk: 'The tutorial was for a washing machine. The coffee machine now launders the coffee, and the engineer charges double.',
      },
      { label: 'A sign: “Coffee temporarily philosophical”', result: 'Customers appreciated the sign. They bought their coffee at Kawka Express across the road.' },
    ],
  },
  wiralowy: {
    title: 'Drop: BANDY XL ice creams',
    text: 'Head Office is allocating BANDY XL ice creams. At your trust level ({t}) you’ll get {s}% of your order. The kids already know; their parents don’t yet.',
    answers: [
      {
        label: 'Take the allocation and make room in the freezer',
        result: 'The ice creams were gone within an hour. The queue of kids reached the bus stop, and one child asked for a VAT invoice.',
        risk: 'Some of the ice cream melted during the reshuffle. Shrinkage loves ice cream.',
      },
      { label: 'Pass; I’ve got no room', result: 'Head Office noted a “lack of engagement with strategic drops”. The kids went to the Traszka down the road.' },
    ],
  },
  'okolnik-premia': {
    title: 'Circular: attendance bonus',
    text: 'Head Office awards a {b} zł attendance bonus. Condition: one week of displaying the drink “Kraftuś Zero Sense” at the till. The drink is “blue” flavoured.',
    answers: [
      { label: 'Take the bonus (and the Kraftuś)', result: 'Bonus in the account, Kraftuś by the till. Customers ask what “blue” tastes like. Nobody knows.' },
      { label: 'No, thank you', result: 'Head Office accepted your refusal with understanding and a note in your file. Just a note, for now.' },
    ],
  },
  'okolnik-usmiech': {
    title: 'Circular: smile KPI',
    text: 'From Monday, any cashier who greets a customer without a smile lowers the shop’s KPI. Head Office offers an online course, “Smiling in 4 Steps” (step 5 is paid).',
    answers: [
      { label: 'Sign up the whole team', result: 'The team smiles in line with procedure. Customers are slightly frightened.' },
      { label: 'Sign up just myself', result: 'Course completed. The certificate smiles on your behalf.' },
      { label: 'I’ll read it at the weekend', result: 'The weekend passed. So did the circular. Head Office didn’t.' },
    ],
  },
  'okolnik-witryna': {
    title: 'Circular: new shop-window sticker',
    text: 'Head Office will pay half of a new “Always Close at Hand” window sticker. The other half is {c} zł. The sticker is 3 cm too wide for your window.',
    answers: [
      { label: 'Order it and trim it', result: 'Sticker trimmed. The slogan “Always Close at Han” wins universal affection.' },
      { label: 'Keep the old one', result: 'The old sticker is holding on bravely. Mostly with sticky tape.' },
    ],
  },
  'okolnik-refundacja': {
    title: 'Circular: shrinkage refund scheme',
    text: 'Head Office will write off {r} zł of your shrinkage if you fill in form R-17 in triplicate. The third copy must be sent by fax.',
    answers: [
      { label: 'Fill it in (and find a fax)', result: 'Form accepted. Fax machine located in a technology museum. Write-off booked.' },
      { label: 'Not worth the time', result: 'Form R-17 lies in the stockroom. Watching.' },
    ],
  },
  'okolnik-paleta': {
    title: 'Circular: “Pallet of the Month” contest',
    text: 'Head Office announces a contest for the most beautifully stacked pallet. Prize: {o} Ogonki and a certificate. The photo must be taken on the pavement, in daylight.',
    answers: [
      {
        label: 'Enter a pallet',
        result: 'Your pallet came third. First place went to Head Office’s pallet.',
        risk: 'The photo came out beautifully. The City Wardens took one too.',
      },
      { label: 'My pallets are beautiful in private', result: 'The pallet stays anonymous. It’s safer that way.' },
    ],
  },
  'okolnik-ankieta': {
    title: 'Circular: satisfaction survey',
    text: 'Head Office asks how satisfied you are with the partnership (on a scale of 9 to 10). It will take 5 minutes to complete. According to Head Office.',
    answers: [
      { label: 'Answer honestly', result: 'Honesty appreciated. Head Office has scheduled a “development conversation” with you.' },
      { label: 'Give it a 10', result: 'Thank you! Your feedback will help us maintain our current standards.' },
      { label: 'Don’t fill it in', result: 'Survey closed. Network average: 9.8. Without you.' },
    ],
  },
};
