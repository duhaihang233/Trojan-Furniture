// TroShare built-in data: halls, item types, and sample listings that show how the marketplace works.
// Real listings come from the TroShare server (see app.js loadServer).
window.TS_DATA = (() => {
  // Every USC residence (USC Housing's list). left/top: where its building is on images/map.jpg, in percent;
  // null for the few that aren't on that map (no pin, and walking times to them aren't shown).
  const halls = [
    { id: 'annenberg', name: 'Annenberg House', code: 'ANH', short: 'Annenberg', left: null, top: null },
    { id: 'belair', name: 'Bel-Air', code: 'BAA', short: 'Bel-Air', left: 32.1, top: 20.4 },
    { id: 'birnkrant', name: 'Birnkrant Residential College', code: 'BSR', short: 'Birnkrant', left: 72.3, top: 57.3 },
    { id: 'bohnett', name: 'Bohnett Residential College', code: 'UVE-NBC', short: 'Bohnett', left: 47.5, top: 39.3 },
    { id: 'caleirani', name: 'Cale and Irani Residential College', code: 'UVS-CIC', short: 'Cale & Irani', left: 40.5, top: 42.7 },
    { id: 'cng', name: "Cardinal 'N Gold", code: 'CNG', short: "Cardinal 'N Gold", left: 67.9, top: 17.1 },
    { id: 'cargardens', name: 'Cardinal Gardens', code: 'CAR', short: 'Cardinal Gardens', left: 27.7, top: 40.9 },
    { id: 'centennial', name: 'Centennial', code: 'CEN', short: 'Centennial', left: null, top: null },
    { id: 'century', name: 'Century', code: 'CAP', short: 'Century', left: 9.6, top: 51.4 },
    { id: 'cowlings', name: 'Cowlings Residential College', code: 'UVN-CRC', short: 'Cowlings', left: 41.5, top: 32.9 },
    { id: 'currie', name: 'Currie Hall', code: '', short: 'Currie', left: null, top: null },
    { id: 'fairmont', name: 'Fairmont', code: 'FMT', short: 'Fairmont', left: 35.6, top: 3.8 },
    { id: 'founders', name: 'Founders', code: 'FSA', short: 'Founders', left: null, top: null },
    { id: 'helena', name: 'Helena', code: 'HAP', short: 'Helena', left: 17.6, top: 20.5 },
    { id: 'hillview', name: 'Hillview', code: 'HIL', short: 'Hillview', left: null, top: null },
    { id: 'ilium', name: 'Ilium Residential College', code: 'UVN-CRC', short: 'Ilium', left: 43.2, top: 33.8 },
    { id: 'sorbonne', name: 'La Sorbonne', code: 'LAB', short: 'La Sorbonne', left: 18.5, top: 45.5 },
    { id: 'manor', name: 'Manor', code: 'MAB', short: 'Manor', left: 40.9, top: 4.2 },
    { id: 'marks', name: 'Marks Tower', code: 'DMT', short: 'Marks', left: 79.0, top: 66.5 },
    { id: 'maxkade', name: 'Max Kade House', code: 'GEX', short: 'Max Kade', left: 35.9, top: 8.1 },
    { id: 'mccarthy', name: 'McCarthy Honors Residential College', code: 'UVF-MHC', short: 'McCarthy', left: 36.7, top: 37.7 },
    { id: 'mcclintock', name: 'McClintock Apartments', code: 'MCO / MCK', short: 'McClintock', left: 29.8, top: 30.1 },
    { id: 'mcmorrow', name: 'McMorrow Residential College', code: 'UVV-MRC', short: 'McMorrow', left: 47.8, top: 43.4 },
    { id: 'nemirovsky', name: 'Nemirovsky Residential College', code: 'UVE-NBC', short: 'Nemirovsky', left: 49.0, top: 40.0 },
    { id: 'newnorth', name: 'New North Residential College', code: 'COL-NEW / EVK-NEW / UNI-NRC / HRH-NRC', short: 'New North', left: 76.7, top: 54.5 },
    { id: 'pacific', name: 'Pacific', code: 'PCA', short: 'Pacific', left: 45.1, top: 4.2 },
    { id: 'pardee', name: 'Pardee Tower', code: 'PTD', short: 'Pardee', left: 75.4, top: 66.5 },
    { id: 'parkside', name: 'Parkside Apartments', code: 'PKS', short: 'Parkside Apts', left: 36.3, top: 92.5 },
    { id: 'parksidearts', name: 'Parkside Arts & Humanities Residential College', code: 'PRB', short: 'Parkside A&H', left: 38.8, top: 96.1 },
    { id: 'parksideintl', name: 'Parkside International Residential College', code: 'IRC', short: 'Parkside Intl', left: 31.8, top: 97.0 },
    { id: 'regaltrojan', name: 'Regal Trojan', code: 'RTA', short: 'Regal Trojan', left: null, top: null },
    { id: 'regent', name: 'Regent', code: 'RGA', short: 'Regent', left: 29.3, top: 21.3 },
    { id: 'senator', name: 'Senator', code: 'SNA', short: 'Senator', left: 29.5, top: 8.7 },
    { id: 'sevengables', name: 'Seven Gables', code: 'SGA', short: 'Seven Gables', left: 78.7, top: 22.5 },
    { id: 'severance', name: 'Severance Street Apartments', code: 'SSA', short: 'Severance', left: 49.2, top: 5.3 },
    { id: 'sierra', name: 'Sierra', code: 'SIE', short: 'Sierra', left: 40.8, top: 6.0 },
    { id: 'stardust', name: 'Stardust', code: 'SAI', short: 'Stardust', left: 74.8, top: 4.8 },
    { id: 'sunset', name: 'Sunset', code: 'SUN', short: 'Sunset', left: 26.6, top: 23.3 },
    { id: 'terrace', name: 'Terrace', code: 'TSA', short: 'Terrace', left: 11.8, top: 26.4 },
    { id: 'troyeast', name: 'Troy East', code: 'TRE', short: 'Troy East', left: 60.8, top: 29.1 },
    { id: 'troyhall', name: 'Troy Hall', code: 'TRH', short: 'Troy Hall', left: 56.8, top: 29.1 },
    { id: 'troyland', name: 'Troyland', code: 'TAP', short: 'Troyland', left: null, top: null },
    { id: 'twinpalms', name: 'Twin Palms', code: 'TPA', short: 'Twin Palms', left: 35.6, top: 5.7 },
    { id: 'uregent', name: 'University Regent', code: 'URA', short: 'Univ. Regent', left: 11.5, top: 10.3 },
    { id: 'veterans', name: "Veterans' Housing", code: 'ADX', short: "Veterans'", left: null, top: null },
    { id: 'vista', name: 'Vista', code: 'VIS', short: 'Vista', left: 44.9, top: 6.3 },
    { id: 'webb', name: 'Webb Tower', code: 'WTO', short: 'Webb', left: 29.0, top: 47.0 },
    { id: 'windsor', name: 'Windsor', code: 'WIN', short: 'Windsor', left: 26.2, top: 9.4 }
  ];

  const types = {
    micro: { name: 'Compact microwave', cat: 'kitchen', img: 'images/micro.jpg', blurb: '0.7 cu ft · Black · Easy-clean interior' },
    tv: { name: '32″ HD TV', cat: 'tech', img: 'images/tv.jpg', blurb: 'Streams the Housing cable app. Remote included.' },
    bean: { name: 'Bean bag chair', cat: 'seat', img: 'images/bean.jpg', blurb: 'Gray · Cover is washable' },
    lamp: { name: 'LED desk lamp', cat: 'light', img: 'images/lamp.jpg', blurb: 'Dimmable · Built-in tray for keys' },
    floor: { name: 'Floor lamp', cat: 'light', img: 'images/floor.jpg', blurb: 'Gold stand · Linen shade · Warm light' },
    fan: { name: 'Quiet tower fan', cat: 'cool', img: 'images/fan.jpg', blurb: '3 speeds · Quiet enough for your roommate' },
    topper: { name: 'XL twin topper', cat: 'sleep', img: 'images/topper.jpg', blurb: 'Fits USC XL twin beds (36″ × 80″)' },
    cart: { name: 'Storage cart', cat: 'storage', img: 'images/cart.jpg', blurb: '4 tiers · Rolls beside your desk' },
    mirror: { name: 'Full-length mirror', cat: 'decor', img: 'images/mirror.jpg', blurb: 'About 14″ × 50″ · Black frame · Hangs over the door or leans on a wall' }
  };

  const categories = [
    { id: 'all', label: 'All' }, { id: 'kitchen', label: 'Kitchen' }, { id: 'light', label: 'Lighting' }, { id: 'cool', label: 'Cooling' },
    { id: 'seat', label: 'Seating' }, { id: 'sleep', label: 'Sleep' }, { id: 'tech', label: 'Tech' }, { id: 'storage', label: 'Storage' }, { id: 'decor', label: 'Decor' }
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
    ['parkside', 'tv', 'Aria S.', 'Senior', 4.6, 7, 'Good', 38, 'both'],
    // Microwaves are added last so existing listing ids (l1–l42) stay the same.
    ['webb', 'micro', 'Sara J.', 'Junior', 4.8, 6, 'Like new', 18, 'both'], ['village', 'micro', 'Omar B.', 'Senior', 4.9, 9, 'Good', 17, 'both'],
    ['newnorth', 'micro', 'Tina R.', 'Junior', 4.7, 4, 'Good', 18, 'drop'], ['pardee', 'micro', 'Kevin L.', 'Senior', 4.8, 5, 'Like new', 16, 'both'],
    ['gateway', 'micro', 'Hana S.', 'Sophomore', 4.9, 3, 'Like new', 18, 'pickup'], ['parkside', 'micro', 'Diego M.', 'Senior', 4.6, 7, 'Good', 17, 'both'],
    // Full-length mirrors: about $20–30 new, so $6–8 a semester.
    ['webb', 'mirror', 'Grace H.', 'Junior', 4.9, 5, 'Like new', 7, 'both'], ['village', 'mirror', 'Daniel K.', 'Senior', 4.8, 7, 'Good', 6, 'both'],
    ['newnorth', 'mirror', 'Chloe T.', 'Sophomore', 4.7, 2, 'Like new', 7, 'drop'], ['pardee', 'mirror', 'Ryan P.', 'Junior', 4.8, 4, 'Good', 6, 'pickup'],
    ['gateway', 'mirror', 'Nina V.', 'Senior', 4.9, 8, 'Like new', 8, 'both'], ['parkside', 'mirror', 'Leo M.', 'Sophomore', 4.6, 3, 'Good', 6, 'both']
  ];

  // Where a seller meets you for pickup: the hall's lobby unless it has a better-known spot.
  const pickupSpots = Object.fromEntries(halls.map((h) => [h.id, h.name + ' lobby']));
  Object.assign(pickupSpots, {
    newnorth: 'New North front desk', parkside: 'Parkside dining entrance',
    // Older sample listings were at these two places.
    village: 'USC Village, Trader Joe’s entrance', gateway: 'University Gateway lobby'
  });

  const listings = rows.map(([hall, type, seller, year, rating, rentals, condition, sem, handoff], i) => ({
    id: 'l' + (i + 1), hall, type, seller, year, rating, rentals, condition, sem,
    year1: Math.round(sem * 1.8), handoff, owner: 'other', sample: true
  }));

  // The signed-in student. Filled in from their USC Google account and profile (see app.js applyUser).
  const me = { name: '', first: '', initial: '', email: '', picture: '', year: '', hall: 'webb', since: null };

  const findId = (seller, type) => listings.find((l) => l.seller === seller && l.type === type).id;

  // Per-device state for a signed-in student: view settings, and the simulated cart, rentals and
  // chats with sample sellers. (Listings, favorites and chats with real students are on the server.)
  const emptyState = () => ({ version: 1, hall: null, cat: 'all', cart: [], rentals: [], threads: [], viewed: [] });

  // Optional sample activity for demos (Account → Load sample activity), addressed to the signed-in student.
  const sampleState = (first, hallName) => JSON.parse(JSON.stringify(sampleTemplate())
    .replace(/Tommy/g, first || 'there').replace(/Webb Tower lobby/g, (hallName || 'Webb Tower') + ' lobby'));
  const sampleTemplate = () => ({
    version: 1,
    hall: null,
    cat: 'all',
    cart: [],
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
      ] }
    ],
    viewed: [findId('Chris W.', 'tv'), findId('Liam K.', 'floor'), findId('Ava L.', 'topper'), findId('Mia S.', 'cart')]
  });

  return { halls, types, categories, listings, pickupSpots, me, emptyState, sampleState };
})();
