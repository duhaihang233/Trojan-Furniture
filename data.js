// TroShare seed data. Everything here is sample data for the demo.
window.TS_DATA = (() => {
  const halls = [
    { id: 'webb', name: 'Webb Tower', short: 'You · Webb', left: 29, top: 47, walk: 'Your hall', mins: 0, home: true },
    { id: 'village', name: 'USC Village', short: 'Village', left: 43, top: 31, walk: '~5 min walk', mins: 5 },
    { id: 'gateway', name: 'University Gateway', short: 'Gateway', left: 78, top: 38, walk: '~10 min walk', mins: 10 },
    { id: 'newnorth', name: 'New North', short: 'New North', left: 77, top: 53, walk: '~8 min walk', mins: 8 },
    { id: 'pardee', name: 'Pardee Tower', short: 'Pardee', left: 72, top: 66, walk: '~9 min walk', mins: 9 },
    { id: 'parkside', name: 'Parkside', short: 'Parkside', left: 36, top: 92, walk: '~12 min walk', mins: 12 }
  ];

  const types = {
    tv: { name: '32″ HD TV', cat: 'tech', img: 'images/tv.jpg', blurb: 'Streams the Housing cable app. Remote included.' },
    bean: { name: 'Bean bag chair', cat: 'seat', img: 'images/bean.jpg', blurb: 'Gray · Cover is washable' },
    lamp: { name: 'LED desk lamp', cat: 'light', img: 'images/lamp.jpg', blurb: 'Dimmable · Built-in tray for keys' },
    floor: { name: 'Floor lamp', cat: 'light', img: 'images/floor.jpg', blurb: 'Gold stand · Linen shade · Warm light' },
    fan: { name: 'Quiet tower fan', cat: 'cool', img: 'images/fan.jpg', blurb: '3 speeds · Quiet enough for your roommate' },
    topper: { name: 'XL twin topper', cat: 'sleep', img: 'images/topper.jpg', blurb: 'Fits USC XL twin beds (36″ × 80″)' },
    cart: { name: 'Storage cart', cat: 'storage', img: 'images/cart.jpg', blurb: '4 tiers · Rolls beside your desk' }
  };

  const categories = [
    { id: 'all', label: 'All' }, { id: 'light', label: 'Lighting' }, { id: 'cool', label: 'Cooling' },
    { id: 'seat', label: 'Seating' }, { id: 'sleep', label: 'Sleep' }, { id: 'tech', label: 'Tech' }, { id: 'storage', label: 'Storage' }
  ];

  // [hall, type, seller, class year, rating, rentals, condition, $/semester, handoff options]
  const rows = [
    ['webb', 'tv', 'Chris W.', 'Senior', 4.7, 15, 'Good', 39, 'both'], ['webb', 'bean', 'Ethan R.', 'Sophomore', 4.8, 6, 'Good', 25, 'both'],
    ['webb', 'lamp', 'Olivia P.', 'Junior', 4.9, 8, 'Like new', 12, 'pickup'], ['webb', 'floor', 'Liam K.', 'Senior', 4.8, 5, 'Good', 14, 'both'],
    ['webb', 'fan', 'Noah B.', 'Junior', 4.6, 4, 'Good', 15, 'drop'], ['webb', 'topper', 'Ava L.', 'Senior', 5.0, 9, 'Like new', 19, 'both'],
    ['webb', 'cart', 'Mia S.', 'Sophomore', 4.9, 3, 'Like new', 10, 'pickup'],
    ['village', 'bean', 'Maya K.', 'Junior', 4.9, 12, 'Like new', 27, 'both'], ['village', 'lamp', 'Alex T.', 'Junior', 5.0, 4, 'Good', 12, 'pickup'],
    ['village', 'floor', 'Dani R.', 'Junior', 5.0, 3, 'Good', 14, 'pickup'], ['village', 'fan', 'Kai N.', 'Senior', 4.7, 7, 'Like new', 16, 'both'],
    ['village', 'topper', 'Zoe H.', 'Junior', 4.8, 5, 'Good', 20, 'both'], ['village', 'tv', 'Ryan C.', 'Senior', 4.6, 10, 'Good', 38, 'drop'],
    ['village', 'cart', 'Lily M.', 'Sophomore', 4.9, 2, 'Like new', 11, 'both'],
    ['newnorth', 'topper', 'Sam P.', 'Senior', 4.9, 7, 'New, sealed', 19, 'pickup'], ['newnorth', 'bean', 'Chloe W.', 'Junior', 4.8, 6, 'Like new', 27, 'both'],
    ['newnorth', 'lamp', 'Aiden Z.', 'Sophomore', 4.7, 2, 'Good', 12, 'both'], ['newnorth', 'floor', 'Mason G.', 'Senior', 4.9, 8, 'Good', 15, 'drop'],
    ['newnorth', 'fan', 'Ella Q.', 'Junior', 4.8, 5, 'Good', 14, 'both'], ['newnorth', 'tv', 'Isla T.', 'Senior', 4.9, 11, 'Like new', 39, 'both'],
    ['newnorth', 'cart', 'Jack O.', 'Sophomore', 4.6, 1, 'Good', 9, 'pickup'],
    ['pardee', 'bean', 'Sofia B.', 'Junior', 4.8, 4, 'Good', 25, 'both'], ['pardee', 'lamp', 'Henry X.', 'Senior', 4.9, 6, 'Like new', 12, 'pickup'],
    ['pardee', 'floor', 'Ivy K.', 'Junior', 4.7, 3, 'Good', 14, 'both'], ['pardee', 'fan', 'Ruby N.', 'Sophomore', 5.0, 2, 'Like new', 15, 'both'],
    ['pardee', 'topper', 'Eli C.', 'Senior', 4.8, 6, 'Good', 18, 'drop'], ['pardee', 'tv', 'Max D.', 'Senior', 4.7, 9, 'Good', 36, 'both'],
    ['pardee', 'cart', 'Nora P.', 'Junior', 4.9, 4, 'Like new', 10, 'both'],
    ['gateway', 'fan', 'Jordan L.', 'Senior', 4.8, 9, 'Like new', 15, 'both'], ['gateway', 'bean', 'Emma D.', 'Junior', 4.9, 7, 'Like new', 26, 'both'],
    ['gateway', 'lamp', 'Owen F.', 'Senior', 4.6, 5, 'Good', 11, 'pickup'], ['gateway', 'floor', 'Grace Y.', 'Junior', 4.8, 4, 'Good', 13, 'both'],
    ['gateway', 'topper', 'Lucas V.', 'Senior', 4.7, 6, 'Good', 18, 'both'], ['gateway', 'tv', 'Nina J.', 'Senior', 4.9, 12, 'Good', 37, 'drop'],
    ['gateway', 'cart', 'Ben A.', 'Junior', 4.8, 3, 'Like new', 10, 'both'],
    ['parkside', 'cart', 'Priya S.', 'Sophomore', 4.9, 6, 'Like new', 10, 'both'], ['parkside', 'bean', 'Leah F.', 'Junior', 4.7, 3, 'Good', 26, 'both'],
    ['parkside', 'lamp', 'Theo G.', 'Sophomore', 4.8, 2, 'Like new', 13, 'pickup'], ['parkside', 'floor', 'Cole M.', 'Senior', 4.9, 5, 'Good', 14, 'both'],
    ['parkside', 'fan', 'Jade H.', 'Junior', 4.8, 4, 'Good', 15, 'both'], ['parkside', 'topper', 'Finn R.', 'Senior', 5.0, 8, 'New, sealed', 19, 'both'],
    ['parkside', 'tv', 'Aria S.', 'Senior', 4.6, 7, 'Good', 38, 'both']
  ];

  const pickupSpots = {
    webb: 'Webb Tower lobby', village: 'USC Village, Trader Joe’s entrance', gateway: 'University Gateway lobby',
    newnorth: 'New North front desk', pardee: 'Pardee Tower lobby', parkside: 'Parkside dining entrance'
  };

  const listings = rows.map(([hall, type, seller, year, rating, rentals, condition, sem, handoff], i) => ({
    id: 'l' + (i + 1), hall, type, seller, year, rating, rentals, condition, sem,
    year1: Math.round(sem * 1.8), handoff, owner: 'other'
  }));

  const findId = (seller, type) => listings.find((l) => l.seller === seller && l.type === type).id;

  const me = { name: 'Tommy T.', initial: 'T', year: 'Freshman', hall: 'webb', since: 2025, rating: 4.8, reviews: 18 };

  const seedState = () => ({
    version: 1,
    hall: null,
    cat: 'all',
    cart: [],
    favorites: [findId('Chris W.', 'tv'), findId('Ava L.', 'topper'), findId('Dani R.', 'floor')],
    myListings: [
      { id: 'm1', type: 'cart', condition: 'Like new', sem: 10, year1: 18, handoff: 'drop', status: 'Rented', renter: 'Leo M. · Sophomore', photo: null, title: 'Rolling storage cart' },
      { id: 'm2', type: 'floor', condition: 'Good', sem: 14, year1: 25, handoff: 'both', status: 'Available', renter: null, photo: null, title: 'Floor lamp' }
    ],
    rentals: [
      { id: 'r1', listingId: findId('Maya K.', 'bean'), plan: 'sem', price: 27, handoff: 'drop', split: false, status: 'Scheduled', when: 'Move-in day · 2 PM', where: 'Webb Tower lobby', thread: 't1' },
      { id: 'r2', listingId: findId('Alex T.', 'lamp'), plan: 'sem', price: 12, handoff: 'pick', split: false, status: 'Active', when: 'Aug 20 – Dec 15, 2026', where: 'USC Village, Trader Joe’s entrance', thread: 't2' },
      { id: 'r3', listingId: findId('Jordan L.', 'fan'), plan: 'sem', price: 15, handoff: 'drop', split: false, status: 'Returned', when: 'Jan 8 – May 10, 2026', where: 'Webb Tower lobby', thread: null }
    ],
    threads: [
      { id: 't1', with: 'Maya K.', year: 'Junior', rentalId: 'r1', role: 'renting', unread: 1, msgs: [
        { from: 'them', text: 'Hey Tommy, thanks for renting! I lived in Webb Tower last year, it fits great by the window.' },
        { from: 'me', text: 'Yay! My check-in is at 1, how do you want to do the handoff?' },
        { from: 'them', text: "I'll drop it off at your lobby at 2. I'll text here when I'm there. Fight On!" }
      ] },
      { id: 't2', with: 'Alex T.', year: 'Junior', rentalId: 'r2', role: 'renting', unread: 0, msgs: [
        { from: 'them', text: "Hi! I only do pickup, I'm at the Village." },
        { from: 'me', text: 'No problem, I can grab it Saturday afternoon.' },
        { from: 'them', text: 'Pickup at the Village works anytime that weekend.' }
      ] },
      { id: 't3', with: 'Leo M.', year: 'Sophomore', rentalId: null, myListingId: 'm1', role: 'selling', unread: 0, msgs: [
        { from: 'them', text: 'Hi Tommy, could you drop the cart at New North?' },
        { from: 'me', text: "Sure, I'll bring it by at 4." },
        { from: 'them', text: 'Got it, thank you! Cart fits perfectly.' }
      ] }
    ],
    viewed: [findId('Chris W.', 'tv'), findId('Liam K.', 'floor'), findId('Ava L.', 'topper'), findId('Mia S.', 'cart')]
  });

  return { halls, types, categories, listings, pickupSpots, me, seedState };
})();
