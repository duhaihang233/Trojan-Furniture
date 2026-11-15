/* TroShare — a peer-to-peer rental marketplace for USC students.
   Single-page app, no build step. Accounts, listings, favorites and chats with real students live on the
   TroShare server (proxy/worker.js). Rentals, the cart and the chats with sample sellers are simulated
   and stay in localStorage, along with per-device conveniences (map filter, recently viewed). */
(() => {
  'use strict';
  const D = window.TS_DATA;
  const AUTH = window.TS_AUTH;
  const app = document.getElementById('app');
  const tabbar = document.getElementById('tabbar');
  const toastEl = document.getElementById('toast');

  /* ---------- state ---------- */
  // Per-device state for each signed-in student: map filter, category, recently viewed, and the
  // simulated cart, rentals and sample-seller chats.
  const stateKey = () => 'troshare-state-v2:' + (D.me.email || 'signed-out');
  let S = null; // loaded at startup, after applyUser()
  function load() {
    try {
      const raw = localStorage.getItem(stateKey());
      // Filters are per-visit: every launch opens on all halls and All categories, so listings from
      // students in other buildings are never hidden behind the map filter.
      if (raw) { const s = JSON.parse(raw); if (s && s.version === 1) return { ...D.emptyState(), ...s, cat: 'all', hall: null }; }
    } catch (e) { /* storage unavailable: fall back to fresh state */ }
    return D.emptyState();
  }
  function save() {
    try { localStorage.setItem(stateKey(), JSON.stringify(S)); }
    catch (e) { toast('Storage is full — try a smaller photo'); }
  }

  // UI-only state (not persisted)
  const ui = { plan: 'sem', hand: null, split: false, itemId: null, photoIdx: 0, accTab: 'rent', roomTab: 'ar', arPick: null, mode: 'rent', now: null, q: '', sort: 'near', splitCart: false, draft: null };

  // Data on the TroShare server: every student's listings, your favorites, and your chats with other
  // students (msgs holds the loaded messages of each chat, by chat id).
  const server = { listings: [], favorites: [], convs: [], msgs: {}, roommates: [], orders: [], ordersLoaded: false, notes: [], unreadNotes: 0, rating: null, loaded: false, loading: false, error: null, at: 0 };
  const MAX_LISTING_PHOTOS = 4;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
  // Old sample listings use halls that aren't on the list any more; they show as "USC housing".
  const OTHER_HALL = { id: '', name: 'USC housing', code: '', short: 'USC', left: null, top: null, mins: 30, walk: 'Near campus', label: 'USC' };
  const hallById = (id) => D.halls.find((h) => h.id === id) || { ...OTHER_HALL, id };
  // An unknown type (e.g. data written outside the app) falls back to the storage cart, so screens still draw.
  const typeOf = (l) => D.types[l.type] || D.types.cart;
  const nameOf = (l) => l.title || typeOf(l).name;
  const imgOf = (l) => l.photo || typeOf(l).img;
  const catOf = (l) => typeOf(l).cat;
  const initial = (n) => (n || '?').trim()[0].toUpperCase();
  const avClass = (n) => ((n || '').charCodeAt(0) % 2 ? 'av alt' : 'av');

  const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate student'];

  // Copies the signed-in student's Google name/photo and saved profile into D.me, and measures
  // walking times on the map from their hall.
  function applyUser() {
    const u = AUTH.user || {}, p = AUTH.profile || {};
    const first = u.given || (u.name || '').split(' ')[0] || '';
    Object.assign(D.me, {
      email: u.email || '', picture: u.picture || '', first,
      name: first ? first + (u.family ? ' ' + u.family[0] + '.' : '') : '',
      initial: (first || u.email || '?')[0].toUpperCase(),
      year: p.year || '', hall: D.halls.some((h) => h.id === p.hall) ? p.hall : 'webb', since: p.since || null
    });
    const home = hallById(D.me.hall);
    D.halls.forEach((h) => {
      h.home = h.id === home.id;
      // ~0.24 minutes per map unit matches the walking times shown in the design. A hall that isn't on
      // the map (or a home that isn't) has no walking time; it sorts after the ones that do.
      const known = h.left != null && home.left != null;
      h.mins = h.home ? 0 : (known ? Math.max(2, Math.round(Math.hypot(h.left - home.left, h.top - home.top) * 0.24)) : 30);
      h.walk = h.home ? 'Your hall' : (known ? `~${h.mins} min walk` : 'Near campus');
      h.label = h.home ? 'You · ' + h.short : h.short;
    });
  }
  const myLobby = () => hallById(D.me.hall).name + ' lobby';

  const stars = (l) => (typeof l.rating === 'number' ? '★ ' + l.rating.toFixed(1) : 'New seller');

  // Server listing -> the shape the screens use (same fields as the built-in sample listings).
  function fromServer(x) {
    return {
      id: x.id, type: x.type, title: x.title, condition: x.condition, sem: x.sem, year1: x.year1, handoff: x.handoff,
      photo: x.photos[0] || null, photos: x.photos, hall: x.seller.hall, seller: x.seller.name, year: x.seller.year,
      rating: typeof x.seller.rating === 'number' ? x.seller.rating : null, reviews: x.seller.reviews || 0, rentals: 0, owner: x.mine ? 'me' : 'other', status: x.status, openToSell: x.openToSell, buyPrice: x.buyPrice || null, createdAt: x.createdAt,
      housing: x.housing || [], // USC Housing restrictions renters should know
      housingReview: x.housingReview || null, // owner only: the audit says it's not allowed, or needs a confirmation
      ar: x.ar // AI AR model: null, or { status: 'in_progress' | 'success' | 'failed', error }
    };
  }
  function putListing(x) {
    const l = fromServer(x);
    const i = server.listings.findIndex((y) => y.id === l.id);
    if (i >= 0) server.listings[i] = l; else server.listings.unshift(l);
    return l;
  }
  // Loads everyone's listings plus your profile and favorites. If it fails, it quietly tries again later.
  // Listings, profile/favorites and chats load independently, so a problem with one of them never
  // hides the others (before, one failed request meant no students' listings at all). Callers that
  // arrive while a load is running wait for that same load.
  let loadingServer = null;
  function loadServer() {
    if (!AUTH.signedIn()) return Promise.resolve();
    if (loadingServer) return loadingServer;
    server.loading = true; server.error = null;
    loadingServer = (async () => {
      const [l, me, c, rm, od, nt] = await Promise.allSettled([AUTH.call('/listings'), AUTH.refresh(), AUTH.call('/conversations'), AUTH.call('/roommates'), AUTH.call('/orders'), AUTH.call('/notifications')]);
      if (rm.status === 'fulfilled') server.roommates = rm.value.roommates;
      if (od.status === 'fulfilled') { server.orders = od.value.orders; server.ordersLoaded = true; }
      if (nt.status === 'fulfilled') setNotes(nt.value);
      if (me.status === 'fulfilled' && me.value) server.rating = me.value.rating || null;
      if (l.status === 'fulfilled') { server.listings = l.value.listings.map(fromServer); server.loaded = true; server.at = Date.now(); }
      if (me.status === 'fulfilled' && me.value) server.favorites = me.value.favorites || [];
      if (c.status === 'fulfilled') server.convs = c.value.conversations;
      const failed = [l, me, c].find((x) => x.status === 'rejected');
      if (failed) {
        server.error = failed.reason.message;
        clearTimeout(server.retry);
        server.retry = setTimeout(() => { if (server.error) loadServer().then(() => { if (server.loaded) rerender(); }); }, 20000);
      }
    })().finally(() => { server.loading = false; loadingServer = null; });
    return loadingServer;
  }
  // Back online, or back in the app after switching away: try again if the last load failed.
  const retryQuietly = () => { if (server.error && !server.loading) loadServer().then(() => { if (server.loaded) rerender(); }); };
  window.addEventListener('online', retryQuietly);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retryQuietly(); });
  // Everything students can rent: available listings on the server. (The built-in sample listings in
  // data.js are no longer shown; they now live on the server as Thomas Du's listings. They stay in
  // data.js only so old demo rentals, chats and favorites that point at them still open.)
  // Your own listings aren't in it: you see and manage those under My Account → My listings.
  function market() {
    return server.listings.filter((l) => l.status === 'available' && l.owner !== 'me');
  }
  function findListing(id) {
    return server.listings.find((x) => x.id === id) || D.listings.find((x) => x.id === id) || null;
  }
  const myListings = () => server.listings.filter((l) => l.owner === 'me');
  // Cart entries: { listingId, mode: 'rent' | 'buy', plan: 'sem' | 'yr', handoff: 'drop' | 'pick' }.
  // Older entries have no mode and are rentals. Kept on this device (S.cart).
  const forSale = (l) => !!(l && l.openToSell && l.buyPrice);
  const modeOf = (c) => (c.mode === 'buy' ? 'buy' : 'rent');
  const entryPrice = (c, l) => (modeOf(c) === 'buy' ? l.buyPrice : (c.plan === 'sem' ? l.sem : l.year1));
  // Cart rows whose listing is still up (and still for sale, for a purchase).
  const cartRows = (entries) => entries.map((c) => ({ c, l: findListing(c.listingId) }))
    .filter(({ c, l }) => l && l.owner !== 'me' && (modeOf(c) === 'rent' || forSale(l)));
  const inCart = (id) => S.cart.find((c) => c.listingId === id) || null;
  function activeRentalFor(listingId) {
    return S.rentals.find((r) => r.listingId === listingId && r.status !== 'Returned');
  }
  const unreadChats = () => S.threads.reduce((n, t) => n + (t.unread || 0), 0) + server.convs.reduce((n, c) => n + (c.unread || 0), 0);
  function unreadCount() {
    return unreadChats() + server.unreadNotes;
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  /* ---------- icons ---------- */
  const I = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2.5l2.2 11h10.6l2.2-8H6.6"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.6c2.6.2 4.4 2 5 5.4"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    heart: (on) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`,
    camera: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    viewfinder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="9" width="8" height="6" rx="1"/></svg>',
    verified: '<svg class="verified" role="img" aria-label="Verified USC student" viewBox="0 0 24 24" fill="#990000"><path d="M12 2l2.4 2.1 3.2-.3.9 3.1 2.8 1.6-1.1 3 1.1 3-2.8 1.6-.9 3.1-3.2-.3L12 22l-2.4-2.1-3.2.3-.9-3.1-2.8-1.6 1.1-3-1.1-3 2.8-1.6.9-3.1 3.2.3z"/><path d="M8.5 12.2l2.3 2.3 4.7-4.8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------- shared pieces ---------- */
  function topbar(title, backHref) {
    if (!title) {
      return `<header class="topbar"><span class="spacer44"></span><a class="wordmark" href="#/home">TROSHARE</a>${cartButton()}</header>`;
    }
    return `<header class="topbar">${backHref ? `<a class="icon-btn" href="${backHref}" data-action="back" aria-label="Back">${I.back}</a>` : '<span class="spacer44"></span>'}<h1>${esc(title)}</h1>${cartButton()}</header>`;
  }
  // Cart in the top right of every screen (not on the cart and checkout themselves).
  let lastCartCount = Infinity; // no bounce on the first draw
  function cartButton() {
    const r = parse().route;
    if (r === 'cart' || r === 'checkout' || AUTH.needsSetup()) return '<span class="spacer44"></span>';
    const n = cartRows(S.cart).length;
    const bump = n > lastCartCount; // just added something: the count bounces once
    lastCartCount = n;
    return `<a class="icon-btn cart-btn ${bump ? 'bump' : ''}" href="#/cart" aria-label="Cart${n ? ', ' + n + ' item' + (n > 1 ? 's' : '') : ''}">${I.cart}${n ? `<span class="cart-dot">${n}</span>` : ''}</a>`;
  }

  // AI AR model status shown on listing cards and the listing page.
  const AR_STATE = { in_progress: 'AR: In progress', success: 'AR: Success', failed: 'AR: Failed' };
  const hasGenAr = (l) => !!(l.ar && l.ar.status === 'success');
  function arChip(l) {
    if (!l.ar || !AR_STATE[l.ar.status]) return '';
    const st = l.ar.status;
    return `<span class="ar-chip ar-${st.replace('_', '-')}">${st === 'in_progress' ? '<span class="spinner" aria-hidden="true"></span>' : (st === 'success' ? I.viewfinder : '')}${AR_STATE[st]}</span>`;
  }

  function listingCard(l) {
    const h = hallById(l.hall);
    return `<a class="lcard" href="#/item/${l.id}">
      <div class="ph"><img src="${esc(imgOf(l))}" alt="${esc(nameOf(l))}" loading="lazy"><span class="badge">${esc(l.condition)}</span>${arChip(l)}</div>
      <div class="body">
        <span class="name">${esc(nameOf(l))}</span>
        <span class="price">${money(l.sem)}<small>/sem</small>${forSale(l) ? `<span class="buy-tag">Buy ${money(l.buyPrice)}</span>` : ''}</span>
        <span class="where">${I.pin}<span>${esc(h.name)} · ${esc(h.walk)}</span></span>
        <span class="meta">${esc(l.seller)} · ${esc(l.year)}${l.owner === 'me' ? ' (you)' : ''}${l.sample ? ' · Sample' : ''}</span>
      </div></a>`;
  }

  function renderTabbar(route) {
    const tabs = [
      ['home', '#/home', I.home, 'Home'], ['room', '#/room', I.sparkle, 'Room Preview'], ['sell', '#/sell', I.plus, 'List'],
      ['inbox', '#/inbox', I.chat, 'Inbox'], ['account', '#/account', I.user, 'Account']
    ];
    const active = { browse: 'home', search: 'home', item: 'home', cart: 'home', checkout: 'home', edit: 'account', profile: 'account', order: 'account', guide: 'account', chat: 'inbox', fit: 'room', ar: 'room' }[route] || route;
    const n = unreadCount();
    const todo = ordersTodo();
    const prev = tabbar.querySelector('a.on')?.getAttribute('href');
    tabbar.innerHTML = tabs.map(([id, href, icon, label]) =>
      `<a href="${href}" class="${active === id ? 'on' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon}${label}${id === 'inbox' && n ? `<span class="dot" aria-label="${n} unread">${n}</span>` : ''}${id === 'account' && todo ? `<span class="dot" aria-label="${todo} orders need you">${todo}</span>` : ''}</a>`
    ).join('');
    const now = tabbar.querySelector('a.on');
    if (now && now.getAttribute('href') !== prev) now.classList.add('pop');
  }

  // Map pins: halls with listings, your hall and the one you picked. Most important first (yours, the
  // picked one, then by number of listings); a pin that would cover one already placed shows only its count.
  function mapPins(count) {
    const halls = D.halls.filter((h) => h.left != null && (count(h.id) || h.home || S.hall === h.id));
    const rank = (h) => (h.home ? 1e6 : 0) + (S.hall === h.id ? 1e5 : 0) + count(h.id);
    halls.sort((a, b) => rank(b) - rank(a));
    // Rough pin boxes in map percent: ~7px per character plus count and padding, on a ~430px-wide map;
    // a pin is ~8% of the map's height, above its building (below it near the top edge).
    const box = (h, dot) => {
      const w = (dot ? 30 : 7 * h.label.length + (h.home ? 62 : 44)) / 4.3;
      const y0 = h.top < 9 ? h.top : h.top - 8;
      return { x0: h.left - w / 2, x1: h.left + w / 2, y0, y1: y0 + 8 };
    };
    const hit = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    const placed = [];
    return halls.map((h) => {
      const dot = placed.some((b) => hit(box(h, false), b));
      placed.push(box(h, dot));
      return { h, dot };
    });
  }

  /* ---------- screens ---------- */
  function homeScreen() {
    const all = market();
    const cur = S.hall ? D.halls.find((h) => h.id === S.hall) || null : null;
    const count = (id) => all.filter((l) => l.hall === id).length;
    // Browse lives on Home: the map's hall, the category chips and the search box all narrow one list.
    let items = all.filter((l) => (!cur || l.hall === cur.id) && (S.cat === 'all' || catOf(l) === S.cat));
    const firstType = (l) => (l.type === 'micro' ? 0 : 1); // microwaves lead the list
    const order = ui.sort === 'price' ? (a, b) => firstType(a) - firstType(b) || a.sem - b.sem : (a, b) => firstType(a) - firstType(b) || hallById(a.hall).mins - hallById(b.hall).mins || a.sem - b.sem;
    items = items.sort(order);
    const title = cur ? 'At ' + cur.name : 'Browse listings';
    const n = cur ? count(cur.id) : 0;
    const pill = cur ? (cur.home ? `${n} listings in your building` : `${n} listings at ${cur.name} · ${cur.walk}`) : 'Tap a hall to see what Trojans there are renting out';
    const next = S.rentals.find((r) => r.status === 'Scheduled');
    const nl = next && findListing(next.listingId);
    // No error banner: listings are retried quietly in the background. Until they arrive, say so.
    const status = server.loaded ? '' : '<span class="meta">Loading listings…</span>';

    return `${topbar()}
    <section class="hero">
      <p class="eyebrow">Student-to-student rentals</p>
      <h2 class="hero-title">TroShare</h2>
      <p class="hero-sub">Rent dorm essentials from Trojans near your hall, by the semester or the year.</p>
    </section>
    <div class="map">
      <img src="images/map.jpg" alt="Map of USC Housing buildings around the University Park campus">
      ${mapPins(count).map(({ h, dot }) => `<button type="button" class="pin ${h.home ? 'home' : ''} ${S.hall === h.id ? 'on' : ''} ${h.top < 9 ? 'below' : ''} ${dot ? 'dot' : ''}" style="left:${h.left}%;top:${h.top}%" data-action="hall" data-id="${h.id}" aria-pressed="${S.hall === h.id}" aria-label="${esc(h.name)}, ${count(h.id)} listings${h.home ? ', your hall' : ''}">${h.home ? I.home : ''}<span class="count">${count(h.id)}</span>${dot ? '' : esc(h.label)}</button>`).join('')}
    </div>
    <div class="map-pill"><span class="ico">${I.pin.replace('<svg', '<svg width="18" height="18"')}</span><span class="txt">${esc(pill)}</span>${cur ? '<button type="button" class="chip-btn" data-action="hall" data-id="">All halls</button>' : ''}</div>
    <section class="section" id="listings">
      <div class="section-head"><h2>${esc(title)}</h2><span class="sub">${items.length} item${items.length === 1 ? '' : 's'}</span></div>
      ${status}
      <a class="search" href="#/search" data-action="search" aria-label="Search listings">${I.search}<span class="search-ph">Lamps, fans, bean bags…</span></a>
      <div class="chips" role="group" aria-label="Category">${D.categories.map((c) => `<button type="button" class="chip ${S.cat === c.id ? 'on' : ''}" data-action="cat" data-id="${c.id}" aria-pressed="${S.cat === c.id}">${c.label}</button>`).join('')}</div>
      <div class="section-head"><span class="sub">${cur ? 'Only ' + esc(cur.name) + ' · tap “All halls” on the map above for everything' : 'From USC students across campus'}</span>
        <label class="sub">Sort <select data-input="sort" style="border:none;background:transparent;font-weight:700;color:var(--cardinal)"><option value="near" ${ui.sort === 'near' ? 'selected' : ''}>Closest</option><option value="price" ${ui.sort === 'price' ? 'selected' : ''}>Lowest price</option></select></label></div>
      ${items.length ? `<div class="grid">${items.map(listingCard).join('')}</div>` : '<p class="empty">Nothing here yet. Try another hall on the map.</p>'}
    </section>
    ${nl ? `<section class="section">
      <div class="section-head"><h2>Next handoff</h2><a class="link" href="#/chat/${next.thread}">Chat →</a></div>
      <a class="card pad row" href="#/chat/${next.thread}" style="text-decoration:none;color:inherit">
        <span class="thumb"><img src="${esc(imgOf(nl))}" alt=""></span>
        <span class="grow"><span class="t-serif">${esc(nameOf(nl))}</span><span class="meta">From ${esc(nl.seller)} · ${next.handoff === 'drop' ? 'Delivered' : 'Pickup'}</span><span class="meta">${esc(next.when)} · ${esc(next.where)}</span></span>
        <span class="badge">${esc(next.status)}</span>
      </a></section>` : ''}
    <p class="footer">A peer-to-peer marketplace for USC students.<br>Rent what you need, share what you don't — Trojan to Trojan.</p>`;
  }

  // Search gets its own page, laid out like a store app's search: field + Cancel, then recently viewed and recent searches.
  // Once you type, every matching listing across campus shows, closest first.
  const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>';
  const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  const XMARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function rememberSearch(term) {
    const t = String(term || '').trim();
    if (!t) return;
    S.recent = [t].concat((S.recent || []).filter((x) => x.toLowerCase() !== t.toLowerCase())).slice(0, 6);
    save();
  }
  function searchScreen() {
    const q = ui.q.trim().toLowerCase();
    const head = `<div class="s-page"><div class="s-head">
      <label class="s-field"><span class="sr-only">Search listings</span><input type="search" placeholder="What can we help you find?" value="${esc(ui.q)}" data-input="q" autocomplete="off" enterkeyhint="search">${I.search}</label>
      <button type="button" class="s-cancel" data-action="search-cancel">Cancel</button></div>`;
    if (q) {
      const items = market().filter((l) => (nameOf(l) + ' ' + typeOf(l).name + ' ' + D.categories.find((c) => c.id === catOf(l))?.label + ' ' + l.seller + ' ' + hallById(l.hall).name).toLowerCase().includes(q));
      items.sort(ui.sort === 'price' ? (a, b) => a.sem - b.sem : (a, b) => hallById(a.hall).mins - hallById(b.hall).mins || a.sem - b.sem);
      return head + `<section class="section" id="listings">
      <div class="section-head"><span class="sub">${items.length} listing${items.length === 1 ? '' : 's'} across campus</span>
        <label class="sub">Sort <select data-input="sort" style="border:none;background:transparent;font-weight:700;color:var(--cardinal)"><option value="near" ${ui.sort === 'near' ? 'selected' : ''}>Closest</option><option value="price" ${ui.sort === 'price' ? 'selected' : ''}>Lowest price</option></select></label></div>
      ${items.length ? `<div class="grid">${items.map(listingCard).join('')}</div>` : '<p class="empty">No listings match. Try another search.</p>'}
    </section></div>`;
    }
    const viewed = S.viewed.map(findListing).filter(Boolean);
    const recent = S.recent || [];
    const popular = Object.values(D.types).map((t) => t.name);
    return head + `
    <a class="s-ask" href="#/room"><span class="s-spark">${I.sparkle}</span><span class="grow">Ask TroShare<span class="meta">Snap your room and see what fits</span></span>${CHEV}</a>
    ${viewed.length ? `<section class="s-block"><div class="s-title"><h2>Recently viewed</h2><a class="link" href="#/account">See all</a></div>
      <div class="s-viewed">${viewed.map((l) => `<a href="#/item/${l.id}" aria-label="${esc(nameOf(l))}"><img src="${esc(imgOf(l))}" alt=""></a>`).join('')}</div></section>` : ''}
    <section class="s-block">${recent.length
      ? `<div class="s-title"><h2>Recently searched</h2><button type="button" class="link" data-action="search-clear">Clear</button></div>
        ${recent.map((t) => `<div class="s-row"><button type="button" class="s-term" data-action="search-term" data-id="${esc(t)}"><span class="s-ico">${CLOCK}</span>${esc(t)}</button><button type="button" class="s-x" data-action="search-forget" data-id="${esc(t)}" aria-label="Remove ${esc(t)}">${XMARK}</button></div>`).join('')}`
      : `<div class="s-title"><h2>Popular on TroShare</h2></div>
        ${popular.map((t) => `<div class="s-row"><button type="button" class="s-term" data-action="search-term" data-id="${esc(t)}"><span class="s-ico">${I.search}</span>${esc(t)}</button></div>`).join('')}`}
    </section></div>`;
  }

  // The AR button on a listing photo: the AI model when it's ready, its progress while it's being
  // built, or the typical model for the category.
  function arSlot(l, mine) {
    const st = l.ar && l.ar.status;
    if (st === 'success') return arButton(l, 'AR Preview', 'fit-btn');
    if (st === 'in_progress') return `<span class="fit-btn ar-busy"><span class="spinner" aria-hidden="true"></span>AR: In progress</span>`;
    if (st === 'failed' && mine) return `<button type="button" class="fit-btn" data-action="ar-start" data-id="${esc(l.id)}">AR: Failed · Retry</button>`;
    return AR_MODELS[l.type] ? arButton(l, 'AR Preview', 'fit-btn') : '';
  }
  function arOwnerPanel(l) {
    const st = l.ar && l.ar.status;
    const has = l.photos && l.photos.length;
    if (st === 'in_progress') return `<div class="callout">${I.sparkle}<span><b>AR: In progress.</b> Claude is building a 3D model from your photos. It usually takes about a minute; you can leave this page.</span></div>`;
    if (st === 'success') return `<div class="callout">${I.check}<span><b>AR: Success.</b> Students can place your item in their room with AR Preview.</span></div>`;
    if (st === 'failed') return `<div class="callout">${I.shield}<span><b>AR: Failed.</b> ${esc(l.ar.error)}</span></div><button type="button" class="btn btn-outline btn-small ar-gen" data-action="ar-start" data-id="${esc(l.id)}">${I.sparkle}Try AI Generate AR model again</button>`;
    return has ? `<button type="button" class="btn btn-outline btn-small ar-gen" data-action="ar-start" data-id="${esc(l.id)}">${I.sparkle}AI Generate AR model</button>` : '';
  }

  function itemScreen(id) {
    const l = findListing(id);
    if (!l) {
      // It may have been listed after this page loaded: check the server once before calling it gone.
      if (server.loaded && ui.lookedUp !== id) { ui.lookedUp = id; syncFromServer(); return `${topbar('Listing', '#/home')}<p class="empty">Loading…</p>`; }
      return `${topbar('Listing', '#/home')}<p class="empty">${server.loaded && !server.loading ? 'This listing is gone.' : 'Loading…'}</p>`;
    }
    if (ui.itemId !== id) {
      ui.itemId = id; ui.photoIdx = 0; ui.plan = 'sem'; ui.split = false; ui.mode = 'rent';
      ui.hand = l.handoff === 'pickup' ? 'pick' : 'drop';
      S.viewed = [id].concat(S.viewed.filter((v) => v !== id)).slice(0, 8); save();
    }
    const h = hallById(l.hall);
    const mine = l.owner === 'me';
    const myOrder = server.orders.find((o) => o.listingId === id && o.role === 'renter' && OPEN_ORDER.includes(o.status));
    const fav = server.favorites.includes(id);
    const canDrop = l.handoff !== 'pickup', canPick = l.handoff !== 'drop';
    const buying = forSale(l) && ui.mode === 'buy';
    const amt = buying ? l.buyPrice : (ui.plan === 'sem' ? l.sem : l.year1);
    const pay = ui.split && !buying ? amt / 2 : amt;
    const carted = inCart(id);
    const sameAsCart = carted && modeOf(carted) === (buying ? 'buy' : 'rent') && carted.handoff === ui.hand && (buying || carted.plan === ui.plan);
    const photos = l.photos && l.photos.length ? l.photos : [imgOf(l)];
    const shown = photos[Math.min(ui.photoIdx, photos.length - 1)];
    return `${topbar(nameOf(l), '#/home')}
    <div class="photo"><img src="${esc(shown)}" alt="${esc(nameOf(l))}, the seller's actual item"><span class="badge">${esc(l.condition)}</span>
      ${arSlot(l, mine)}
      ${mine ? '' : `<button type="button" class="icon-btn fav-btn ${ui.justFaved === id ? 'just-faved' : ''}" data-action="fav" data-id="${esc(id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from' : 'Add to'} favorites" style="position:absolute;top:8px;left:8px;color:var(--cardinal)">${I.heart(fav)}</button>`}</div>
    ${photos.length > 1 ? `<div class="hscroll" style="padding:10px 16px 0">${photos.map((src, i) => `<button type="button" class="thumb photo-pick ${src === shown ? 'on' : ''}" data-action="photo-idx" data-id="${i}" aria-label="Photo ${i + 1}" aria-pressed="${src === shown}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
    <section class="section">
      <div><h2 class="serif" style="margin:0;font-size:26px">${esc(nameOf(l))}</h2><p class="sub" style="margin:4px 0 0">${esc(l.sample ? typeOf(l).blurb : (D.categories.find((c) => c.id === catOf(l)) || {}).label || '')}</p></div>
      <div class="card pad row">
        <span class="${avClass(l.seller)}">${esc(initial(l.seller))}</span>
        <span class="grow"><span class="row" style="gap:6px;font-weight:700">${esc(l.seller)}${mine ? ' (you)' : ''} ${I.verified}</span>
          <span class="meta">${esc(l.year)} · Verified USC student · ${stars(l)}${l.reviews ? ' · ' + l.reviews + ' review' + (l.reviews > 1 ? 's' : '') : (l.rentals ? ' · ' + l.rentals + ' rentals' : '')}</span>
          <span class="where">${I.pin}${esc(h.name)} · ${esc(h.walk)}</span></span>
        ${mine ? '' : `<button type="button" class="btn btn-outline btn-small" data-action="message" data-id="${esc(id)}">Message</button>`}
      </div>
      ${(l.housing || []).map((h) => `<div class="callout housing-note">${I.shield}<span><b>${esc(h.label)}:</b> ${esc(h.note)}</span></div>`).join('')}
      ${mine ? housingReviewPanel(l) : ''}
      ${mine ? `<div class="callout">${I.shield}<span>${l.status === 'rented' ? '<b>Rented out.</b> It’s off the market until it comes back. Follow it under My Account → Orders.' : l.status === 'sold' ? '<b>Sold.</b> Other students can’t see it any more.' : l.status === 'paused' ? '<b>Hidden.</b> Other students can’t see this listing until you show it again.' : 'This is your listing. It\'s visible to verified USC students. Manage it from <a href="#/account">My Account</a>.'}</span></div>
      <button type="button" class="btn btn-cardinal btn-small" data-action="edit-listing" data-id="${esc(id)}">Edit listing</button>
      <div class="row" style="gap:8px">
        ${l.status === 'rented' || l.status === 'sold' || (l.housingReview && l.housingReview.status === 'blocked') ? '' : l.status === 'paused'
          ? `<button type="button" class="btn btn-cardinal btn-small" style="flex:1" data-action="resume" data-id="${esc(id)}">Show it again</button>`
          : `<button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="pause" data-id="${esc(id)}">Hide for now</button>`}
        <button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="delete-listing" data-id="${esc(id)}">Delete</button>
      </div>
      ${arOwnerPanel(l)}` : `${forSale(l) ? `      <span class="label">Rent or buy</span>
      <div class="opts" role="radiogroup" aria-label="Rent or buy">
        <button type="button" role="radio" class="opt ${buying ? '' : 'on'}" aria-checked="${!buying}" data-action="mode" data-id="rent"><span><span class="t">Rent · <span style="color:var(--cardinal)">from ${money(l.sem)}</span></span><span class="n">Give it back at move-out</span></span></button>
        <button type="button" role="radio" class="opt ${buying ? 'on' : ''}" aria-checked="${buying}" data-action="mode" data-id="buy"><span><span class="t">Buy · <span style="color:var(--cardinal)">${money(l.buyPrice)}</span></span><span class="n">It's yours to keep</span></span></button>
      </div>` : ''}
      ${buying ? '' : `<span class="label">Rental length</span>
      <div class="opts" role="radiogroup" aria-label="Rental length">
        <button type="button" role="radio" class="opt ${ui.plan === 'sem' ? 'on' : ''}" aria-checked="${ui.plan === 'sem'}" data-action="plan" data-id="sem"><span><span class="t">Semester · <span style="color:var(--cardinal)">${money(l.sem)}</span></span><span class="n">Move-in to move-out</span></span></button>
        <button type="button" role="radio" class="opt ${ui.plan === 'yr' ? 'on' : ''}" aria-checked="${ui.plan === 'yr'}" data-action="plan" data-id="yr"><span><span class="t">Full year · <span style="color:var(--cardinal)">${money(l.year1)}</span></span><span class="n">Fall + spring · save ${money(l.sem * 2 - l.year1)}</span></span></button>
      </div>`}
      <span class="label">Handoff</span>
      <div class="opts" role="radiogroup" aria-label="Handoff">
        <button type="button" role="radio" class="opt ${ui.hand === 'drop' ? 'on' : ''}" aria-checked="${ui.hand === 'drop'}" data-action="hand" data-id="drop" ${canDrop ? '' : 'disabled'}>${I.truck}<span><span class="t">Delivered</span><span class="n">${canDrop ? 'To your hall lobby' : 'Not offered'}</span></span></button>
        <button type="button" role="radio" class="opt ${ui.hand === 'pick' ? 'on' : ''}" aria-checked="${ui.hand === 'pick'}" data-action="hand" data-id="pick" ${canPick ? '' : 'disabled'}>${I.pin}<span><span class="t">Pickup</span><span class="n">${canPick ? esc(D.pickupSpots[l.hall]) : 'Not offered'}</span></span></button>
      </div>
      ${buying ? '' : splitToggle('split', ui.split)}`}
    </section>
    ${mine ? '' : `<div class="paybar">
      <div class="row"><div style="display:flex;flex-direction:column"><span class="big-price">${money(pay)}</span><span class="meta">${buying ? 'to buy' : (ui.split ? 'your half, ' : '') + (ui.plan === 'sem' ? 'per semester' : 'per year')}</span></div>
      ${myOrder ? `<a class="btn btn-outline" href="#/order/${esc(myOrder.id)}" style="flex:1">Your order · ${esc(orderStatus(myOrder)[0])}</a>`
        : `<div class="buy-btns">${sameAsCart ? `<a class="btn btn-outline" href="#/cart">${I.check}In cart</a>` : `<button type="button" class="btn btn-outline" data-action="add-cart" data-id="${esc(id)}">${carted ? 'Update cart' : 'Add to cart'}</button>`}<button type="button" class="btn btn-cardinal" data-action="buy-now" data-id="${esc(id)}">${buying ? 'Buy now' : 'Rent now'}</button></div>`}</div>
      <span class="note">${esc(l.seller.split(' ')[0])} accepts or declines, then you pick a time in chat. You pay at the handoff.</span>
    </div>`}`;
  }

  const entryLabel = (c) => (modeOf(c) === 'buy' ? 'Buy · yours to keep' : (c.plan === 'sem' ? 'Rent · 1 Semester' : 'Rent · Full year'));
  const handoffLabel = (c, l) => `<b>${c.handoff === 'drop' ? 'Delivered' : 'Pickup'}</b> · ${c.handoff === 'drop' ? esc(myLobby()) : esc(D.pickupSpots[l.hall])}`;

  function cartScreen() {
    const rows = cartRows(S.cart);
    if (!rows.length) {
      return `${topbar('Cart', '#/home')}<div class="empty cart-empty">${I.cart}<p><b>Your cart is empty.</b><br>Tap <b>Add to cart</b> on a listing to save it here. Items in your cart show up in AR Preview, so you can see them in your room before you check out.</p><a class="btn btn-cardinal" href="#/home" style="max-width:280px;margin:0 auto">Browse listings</a></div>`;
    }
    const total = rows.reduce((n, { c, l }) => n + entryPrice(c, l), 0);
    const withAr = rows.filter(({ l }) => AR_MODELS[l.type] || hasGenAr(l)).length;
    return `${topbar('Cart', '#/home')}
    <section class="section">
      <div class="section-head"><h2>${rows.length} item${rows.length > 1 ? 's' : ''}</h2>${withAr ? `<a class="sub" href="#/room" data-action="room-tab" data-id="ar" style="color:var(--cardinal);font-weight:700">See them in AR</a>` : ''}</div>
      ${rows.map(({ c, l }) => `<div class="card pad cart-row">
        <a class="row" href="#/item/${encodeURIComponent(l.id)}" style="text-decoration:none;color:inherit"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">From ${esc(l.seller)} · ${esc(hallById(l.hall).walk)}</span><span class="meta">${entryLabel(c)}</span></span><span style="font-weight:700">${money(entryPrice(c, l))}</span></a>
        <div class="row" style="justify-content:space-between"><span class="meta">${handoffLabel(c, l)}</span><button type="button" class="link" data-action="remove" data-id="${esc(l.id)}" style="font-size:13px">Remove</button></div>
      </div>`).join('')}
    </section>
    <div class="paybar">
      <div class="row" style="justify-content:space-between"><span style="font-weight:600">Total</span><span class="big-price">${money(total)}</span></div>
      <button type="button" class="btn btn-cardinal" data-action="checkout-cart">Check out</button>
    </div>`;
  }

  // What checkout is for: one item from "Rent now" / "Buy now" (ui.now), or everything in the cart.
  const checkoutRows = () => cartRows(ui.now ? [ui.now] : S.cart);

  function checkoutScreen() {
    const rows = checkoutRows();
    const back = ui.now ? '#/item/' + encodeURIComponent(ui.now.listingId) : '#/cart';
    if (!rows.length) {
      return `${topbar('Checkout', back)}<div class="empty"><p>Nothing to check out yet.</p><a class="btn btn-cardinal" href="#/home" style="max-width:280px;margin:0 auto">Browse listings</a></div>`;
    }
    const total = rows.reduce((n, { c, l }) => n + entryPrice(c, l), 0);
    const rents = rows.filter(({ c }) => modeOf(c) === 'rent');
    const splitting = ui.splitCart && rents.length && !!splitMate();
    // Splitting halves the rentals; anything you're buying is yours alone.
    const pay = splitting ? rows.reduce((n, { c, l }) => n + (modeOf(c) === 'rent' ? half(entryPrice(c, l)) : entryPrice(c, l)), 0) : total;
    const buys = rows.filter(({ c }) => modeOf(c) === 'buy').length;
    const verb = buys === rows.length ? 'Buy' : (buys ? 'Check out' : 'Rent');
    return `${topbar('Checkout', back)}
    <section class="section">
      ${rows.map(({ c, l }) => {
        const amt = entryPrice(c, l);
        return `<div class="card pad" style="display:flex;flex-direction:column;gap:12px">
          <div class="row"><span class="${avClass(l.seller)} sm" style="width:32px;height:32px">${esc(initial(l.seller))}</span><span class="grow"><span class="row" style="gap:6px;font-weight:700">From ${esc(l.seller)} · ${esc(l.year)} ${I.verified}</span></span><span class="meta">${stars(l)}</span></div>
          <div class="row"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">${entryLabel(c)}</span></span><span style="font-weight:700">${money(amt)}</span></div>
          <div class="row" style="justify-content:space-between"><span class="meta">${handoffLabel(c, l)}</span>${ui.now ? '' : `<button type="button" class="link" data-action="remove" data-id="${esc(l.id)}" style="font-size:13px">Remove</button>`}</div>
        </div>`;
      }).join('')}
      <div class="card pad" style="display:flex;flex-direction:column;gap:8px">
        ${rents.length ? splitToggle('split-cart', ui.splitCart) : ''}
        <div class="callout">${I.shield}<span>The seller accepts or declines first. You pay them at the handoff, after you've checked the item, and then tap <b>“Got it”</b> on your order.</span></div>
      </div>
    </section>
    <div class="paybar">
      <div class="row" style="justify-content:space-between"><span style="font-weight:600">${splitting ? 'You pay (your half)' : 'Total'}</span><span class="big-price">${money(pay)}</span></div>
      <button type="button" class="btn btn-cardinal" data-action="place">Request to ${verb.toLowerCase().replace('check out', 'order')} ${rows.length} item${rows.length > 1 ? 's' : ''}</button>
    </div>`;
  }

  function sellScreen() {
    const d = ui.draft || (ui.draft = { photos: [], cat: 'seat', title: '', condition: 'Like new', sem: '', year1: '', drop: true, pick: true, sell: false, buy: '', easy: true });
    return listingForm(d, null);
  }

  // Editing your own listing: the List form, filled in. ui.edit holds its draft (separate from a new
  // listing you may be writing). Photos are server URLs for kept photos and data: URLs for new ones.
  function editScreen(id) {
    const l = findListing(id);
    if (!l || l.owner !== 'me') return `${topbar('Edit listing', '#/account')}<p class="empty">${!l && !server.loaded ? 'Loading…' : 'You can only edit your own listings.'}</p>`;
    if (!ui.edit || ui.edit.id !== id) {
      ui.edit = {
        id, back: ui.editBack || '#/item/' + id, photos: (l.photos || []).slice(), cat: catOf(l), title: l.title || nameOf(l),
        condition: l.condition, sem: String(l.sem), year1: String(l.year1), drop: l.handoff !== 'pickup', pick: l.handoff !== 'drop', sell: !!l.openToSell, buy: l.buyPrice ? String(l.buyPrice) : ''
      };
    }
    return listingForm(ui.edit, l);
  }
  // The draft the List/Edit form controls change.
  const formDraft = () => (parse().route === 'edit' ? ui.edit : ui.draft);
  const photosChanged = (d, l) => JSON.stringify(d.photos) !== JSON.stringify(l.photos || []);

  function listingForm(d, editing) {
    const conds = ['New', 'Like new', 'Good'];
    if (!conds.includes(d.condition)) conds.unshift(d.condition); // e.g. "New, sealed" or "Fair"
    const easy = !editing && d.easy !== false;
    const ai = d.ai || {};
    // Easy list hides the details Claude fills in, until the seller asks to change them or Claude couldn't.
    const showDetails = !easy || d.easyEdit || ai.status === 'problem' || ai.status === 'error';
    const showPrice = !easy || d.photos.length > 0 || d.easyEdit;
    const modeTabs = editing ? '' : `<div class="tabs2" role="tablist" aria-label="How to list">
        <button type="button" role="tab" class="${easy ? 'on' : ''}" aria-selected="${easy}" data-action="easy-mode" data-id="easy">${I.sparkle.replace('<svg', '<svg width="15" height="15" style="vertical-align:-2px;margin-right:5px"')}Easy list</button>
        <button type="button" role="tab" class="${easy ? '' : 'on'}" aria-selected="${!easy}" data-action="easy-mode" data-id="manual">Fill in myself</button></div>`;
    const easyCard = !easy ? '' : (() => {
      if (!d.photos.length) return `<div class="easy-intro">${I.sparkle}<span><b>Add a photo and Claude fills in the rest.</b> It writes the title, picks the category and judges the condition from your photos. You just set the price.</span></div>`;
      if (ai.status === 'busy') return `<div class="easy-card busy" role="status"><span class="spinner" aria-hidden="true"></span><span><b>Claude is reading your photo${d.photos.length > 1 ? 's' : ''}…</b><span class="meta">Usually a few seconds. You can set the price meanwhile.</span></span></div>`;
      if (ai.status === 'problem' || ai.status === 'error') return `<div class="callout" role="alert">${I.shield}<span>${esc(ai.message)} Fill in the details below${ai.status === 'error' ? ', or <button type="button" class="link inline" data-action="easy-retry">try again</button>' : ''}.</span></div>`;
      if (ai.status === 'done' && !d.easyEdit) {
        const cat = (D.categories.find((c) => c.id === d.cat) || {}).label || '';
        return `<div class="easy-card done">
          <div class="easy-head">${I.sparkle}<b>Filled in by Claude</b><button type="button" class="link" data-action="easy-change">Change</button></div>
          <div class="easy-title">${esc(d.title)}</div>
          <div class="easy-tags"><span class="badge">${esc(cat)}</span><span class="badge">${esc(d.condition)}</span></div>
          ${ai.note ? `<span class="meta">${esc(ai.note)}</span>` : ''}
          ${ai.n < d.photos.length ? '<button type="button" class="btn btn-outline btn-small" data-action="easy-retry">Read all my photos again</button>' : ''}
        </div>`;
      }
      return '';
    })();
    const handoffAndMore = `<div class="field"><span class="label">How will you hand it off?</span>
        <label class="check"><input type="checkbox" data-input="drop" ${d.drop ? 'checked' : ''}>I'll drop it off at their hall</label>
        <label class="check"><input type="checkbox" data-input="pick" ${d.pick ? 'checked' : ''}>They pick up at my spot</label></div>
      <label class="switch-row"><span><span style="font-weight:600;display:block">Also open to selling</span><span class="meta">Students can buy it from you with Buy now</span></span><input type="checkbox" data-input="sell" ${d.sell ? 'checked' : ''}></label>
      ${d.sell ? `<div class="field"><label for="f-buy">Sale price ($)</label><input id="f-buy" class="input" type="number" inputmode="numeric" min="1" data-input="buy" value="${esc(d.buy || '')}" placeholder="${Math.max(1, Math.round((Number(d.year1) || Number(d.sem) * 1.8 || 40) * 1.5))}"><span class="meta">What a student pays to keep it.</span></div>` : ''}`;
    return `${topbar(editing ? 'Edit listing' : 'List an item', editing ? d.back : undefined)}
    <form class="section" data-form="${editing ? 'edit' : 'sell'}" novalidate>
      ${modeTabs}
      <div class="field"><span class="label">Photos</span>
        <div class="photos">
          ${d.photos.map((p, i) => `<div class="photo-slot"><img src="${p}" alt="Photo ${i + 1}"><button type="button" class="x" data-action="rm-photo" data-id="${i}" aria-label="Remove photo ${i + 1}">✕</button></div>`).join('')}
          ${d.photos.length < MAX_LISTING_PHOTOS ? `<label class="photo-slot add">${I.camera}Add photo<input type="file" accept="image/*" class="sr-only" data-input="photo"></label>` : ''}
        </div>
        <span class="meta">${easy ? `Up to ${MAX_LISTING_PHOTOS} photos of the actual item, from a few angles.` : `Up to ${MAX_LISTING_PHOTOS} photos of the actual item. No photo? We'll show a stock picture.`}</span>
      </div>
      ${easyCard}
      ${easy ? '' : arField(d, editing)}
      ${showDetails ? `<div class="field"><span class="label">Category</span>
        <div class="chips" role="radiogroup" aria-label="Category">${D.categories.filter((c) => c.id !== 'all').map((c) => `<button type="button" role="radio" class="chip ${d.cat === c.id ? 'on' : ''}" aria-checked="${d.cat === c.id}" data-action="sell-cat" data-id="${c.id}">${esc(c.label)}</button>`).join('')}</div></div>
      <div class="field"><label for="f-title">Title</label><input id="f-title" class="input" data-input="title" value="${esc(d.title)}" maxlength="40" placeholder="${esc(TITLE_EXAMPLES[d.cat] || 'What are you renting out?')}"></div>
      <div class="field"><span class="label">Condition</span>
        <div class="pills" role="radiogroup" aria-label="Condition">${conds.map((c) => `<button type="button" role="radio" class="pill ${d.condition === c ? 'on' : ''}" aria-checked="${d.condition === c}" data-action="cond" data-id="${c}">${c}</button>`).join('')}</div></div>` : ''}
      ${housingCard(d)}
      ${showPrice ? `<div class="row" style="gap:10px">
        <div class="field" style="flex:1"><label for="f-sem">Per semester ($)</label><input id="f-sem" class="input" type="number" inputmode="numeric" min="1" data-input="sem" value="${esc(d.sem)}" placeholder="27"></div>
        <div class="field" style="flex:1"><label for="f-yr">Full year ($)</label><input id="f-yr" class="input" type="number" inputmode="numeric" min="1" data-input="year1" value="${esc(d.year1)}" placeholder="${d.sem ? Math.round(Number(d.sem) * 1.8) || 49 : 49}"></div>
      </div>
      <span class="meta" id="hint">${esc(priceHint(d.cat))}${easy ? ' Leave the full year empty to use 1.8× the semester price.' : ''}</span>` : ''}
      ${easy ? (d.photos.length ? `<button type="button" class="more-toggle" data-action="more-toggle" aria-expanded="${!!d.moreOpen}">${d.moreOpen ? 'Fewer options' : 'More options'}<span class="meta">${d.moreOpen ? '' : (d.drop && d.pick ? 'Delivery or pickup' : (d.drop ? 'Delivery only' : 'Pickup only')) + (d.sell ? ' · for sale too' : '') + (d.ar ? ' · AR model' : '')}</span></button>
      ${d.moreOpen ? handoffAndMore + arField(d, editing) : ''}` : '') : handoffAndMore}
      ${easy && !d.photos.length ? '' : `<button type="submit" class="btn btn-cardinal" ${d.busy || ai.status === 'busy' ? 'disabled' : ''}>${editing ? (d.busy ? 'Saving…' : 'Save changes') : (d.busy ? 'Publishing…' : (ai.status === 'busy' ? 'Waiting for Claude…' : 'Publish listing'))}</button>`}
      ${editing ? `<a class="btn btn-outline" href="${esc(d.back)}">Cancel</a>
      <span class="note">Changes show to other students right away.</span>` : '<span class="note">Only signed-in USC students can see your listing. You can hide or delete it any time from My Account.</span>'}
    </form>`;
  }
  // "AI Generate AR model" switch on a new listing (and the rebuild note when editing photos).
  function arField(d, editing) {
    return editing ? (editing.ar && photosChanged(d, editing) ? `<div class="callout">${I.sparkle}<span>${d.photos.length ? 'Your AR model will be rebuilt from the new photos when you save.' : 'With no photos, the AR model will be removed when you save.'}</span></div>` : '') : `<div class="field">
        <button type="button" class="btn ${d.ar && d.photos.length ? 'btn-cardinal' : 'btn-outline'} ar-gen" data-action="ar-toggle" aria-pressed="${!!(d.ar && d.photos.length)}" ${d.photos.length ? '' : 'disabled'}>${I.sparkle}AI Generate AR model${d.ar && d.photos.length ? ' · On' : ''}</button>
        <span class="meta">${!d.photos.length ? 'Add a photo first. Claude builds the AR model from your photos.'
          : d.ar ? "After you publish, Claude builds a 3D model from your photos in the background, usually in about a minute. You don't have to wait: the listing goes live right away and shows the model's progress."
          : 'Let Claude turn your photos into a 3D model, so students can place your item in their room with AR.'}</span>
      </div>`;
  }
  function runDraft(d) {
    if (!d || !d.photos.length) return;
    const seq = d.aiSeq = (d.aiSeq || 0) + 1;
    d.ai = { status: 'busy' };
    rerenderKeepFocus();
    AUTH.call('/listings/draft', { method: 'POST', body: JSON.stringify({ photos: d.photos.slice(0, MAX_LISTING_PHOTOS).map((u) => u.split(',')[1]) }) })
      .then((r) => {
        if (seq !== d.aiSeq) return; // photos changed and a newer request is running
        const x = r.draft;
        if (!x.ok) d.ai = { status: 'problem', message: x.problem };
        else {
          Object.assign(d, { title: x.title, cat: x.category, condition: x.condition, easyEdit: false });
          d.ai = { status: 'done', note: x.conditionNote, n: d.photos.length };
          setTimeout(() => scheduleCheck(d, 0), 0);
        }
      })
      .catch((err) => { if (seq === d.aiSeq) d.ai = { status: 'error', message: err.message }; })
      .finally(() => { if (seq === d.aiSeq && parse().route === 'sell') rerenderKeepFocus(); });
  }
  // The owner's view of an audit result on an older listing.
  function housingReviewPanel(l) {
    const r = l.housingReview;
    if (!r) return '';
    const rules = '<a class="housing-src" href="https://housing.usc.edu/index.php/publication/2026-2027-living-agreement/" target="_blank" rel="noopener">USC Housing rules</a>';
    if (r.status === 'blocked') {
      return `<div class="housing-card bad" role="alert"><div class="housing-head">${I.shield}<b>Hidden: USC Housing doesn't allow this item</b></div>
        ${r.items.map((x) => `<div class="housing-rule"><b>${esc(x.label)}</b><span class="meta">${esc(x.reason)}</span></div>`).join('')}
        <span class="meta">We checked listings from before the USC Housing check. If this is a mistake, edit the photos or title and it's checked again; otherwise delete it. See the ${rules}.</span></div>`;
    }
    const picked = ui.reviewConfirm && ui.reviewConfirm.id === l.id ? ui.reviewConfirm.rules : [];
    return `<div class="housing-card warn"><div class="housing-head">${I.shield}<b>Confirm one thing for USC Housing</b></div>
      ${r.items.map((x) => `<div class="housing-rule"><b>${esc(x.label)}?</b><span class="meta">${esc(x.reason)}</span>
        <label class="check"><input type="checkbox" data-input="review-confirm" data-id="${esc(l.id)}" data-rule="${esc(x.rule)}" ${picked.includes(x.rule) ? 'checked' : ''}>${esc(x.confirm)}</label></div>`).join('')}
      <button type="button" class="btn btn-cardinal btn-small" data-action="review-confirm" data-id="${esc(l.id)}">Confirm</button>
      <span class="meta">Your listing stays up meanwhile. ${rules}.</span></div>`;
  }

  /* ---- USC Housing rules check (server: proxy/housing.js) ---- */
  // What was checked: the title and the photos. When either changes, the result no longer applies.
  const checkSig = (d) => String(d.title || '').trim().toLowerCase() + '|' + d.photos.map((p) => p.length + ':' + p.slice(-24)).join(',');
  const checkFresh = (d) => !!(d.check && d.check.sig === checkSig(d));
  let checkTimer = null;
  // Runs the check a moment after the item settles (a photo added, Claude done, the title typed).
  function scheduleCheck(d, ms) {
    clearTimeout(checkTimer);
    // New listings only: on Edit, kept photos are server links, and the server checks the change on save.
    if (!d || d !== ui.draft || (!d.photos.length && !String(d.title || '').trim())) return;
    if (d.ai && d.ai.status === 'busy') return; // Easy list runs it once Claude has filled in the title
    if (checkFresh(d) && d.check.status !== 'error') return;
    checkTimer = setTimeout(() => runCheck(d), ms === undefined ? 1200 : ms);
  }
  function runCheck(d) {
    const sig = checkSig(d);
    const seq = d.checkSeq = (d.checkSeq || 0) + 1;
    d.check = { status: 'busy', sig };
    if (formDraft() === d) rerenderKeepFocus();
    AUTH.call('/listings/check', { method: 'POST', body: JSON.stringify({ photos: d.photos.map((u) => u.split(',')[1]), title: String(d.title || '').trim() }) })
      .then((r) => { if (seq === d.checkSeq) d.check = { status: 'done', sig, ...r.check }; })
      .catch((err) => { if (seq === d.checkSeq) d.check = { status: 'error', sig, message: err.message }; })
      .finally(() => { if (seq === d.checkSeq && formDraft() === d) rerenderKeepFocus(); });
  }
  function housingCard(d) {
    const c = d.check;
    if (!c || (!d.photos.length && !String(d.title || '').trim())) return '';
    const head = (cls, icon, title) => `<div class="housing-card ${cls}" role="status"><div class="housing-head">${icon}<b>${title}</b></div>`;
    const rules = `<a class="housing-src" href="${esc(c.source || 'https://housing.usc.edu/index.php/publication/2026-2027-living-agreement/')}" target="_blank" rel="noopener">USC Housing rules</a>`;
    if (!checkFresh(d)) return `${head('busy', '<span class="spinner" aria-hidden="true"></span>', 'Checking USC Housing rules…')}</div>`;
    if (c.status === 'busy') return `${head('busy', '<span class="spinner" aria-hidden="true"></span>', 'Checking USC Housing rules…')}<span class="meta">Making sure USC Housing allows this item. A few seconds.</span></div>`;
    if (c.status === 'error') return `${head('warn', I.shield, "Couldn't check USC Housing rules")}<span class="meta">${esc(c.message)}</span><button type="button" class="btn btn-outline btn-small" data-action="housing-retry">Check again</button></div>`;
    if (c.verdict === 'blocked') {
      return `${head('bad', I.shield, "USC Housing doesn't allow this item")}
        ${c.blocked.map((b) => `<div class="housing-rule"><b>${esc(b.label)}</b><span class="meta">${esc(b.reason)}</span></div>`).join('')}
        <span class="meta">It can't be listed on TroShare, because students couldn't keep it in their room. See the ${rules}.</span></div>`;
    }
    const confirms = c.confirm.map((x) => `<div class="housing-rule"><b>${esc(x.label)}?</b><span class="meta">${esc(x.reason)}</span>
        <label class="check"><input type="checkbox" data-input="housing-confirm" data-rule="${esc(x.rule)}" ${(d.housingConfirmed || []).includes(x.rule) ? 'checked' : ''}>${esc(x.confirm)}</label></div>`).join('');
    const notes = c.restricted.map((x) => `<div class="housing-rule"><b>${esc(x.label)}</b><span class="meta">${esc(x.note)}</span></div>`).join('');
    if (c.verdict === 'confirm') return `${head('warn', I.shield, 'Confirm one thing for USC Housing')}${confirms}${notes}<span class="meta">USC Housing prohibits: ${esc(c.confirm.map((x) => x.label).join('; '))}. ${rules}.</span></div>`;
    if (c.verdict === 'restricted') return `${head('warn', I.check, 'Allowed, with a USC Housing limit')}${notes}<span class="meta">Your listing shows this to renters. ${rules}.</span></div>`;
    return `${head('ok', I.check, 'Allowed in USC Housing')}<span class="meta">Nothing in the ${rules} prohibits this item.</span></div>`;
  }
  // Can this be published? Returns a message when not, or null.
  function housingBlocker(d) {
    const c = d.check;
    if (!checkFresh(d) || !c || c.status !== 'done') return null; // the server checks it on publish
    if (c.verdict === 'blocked') return "USC Housing doesn't allow this item, so it can't be listed";
    const missing = c.confirm.filter((x) => !(d.housingConfirmed || []).includes(x.rule));
    if (missing.length) return 'Confirm: ' + missing[0].confirm;
    return null;
  }
  // What publish sends: the token from a check of exactly this content, and what the seller confirmed.
  const housingPayload = (d) => ({ checkToken: checkFresh(d) && d.check.status === 'done' ? d.check.token : undefined, housingConfirmed: d.housingConfirmed || [] });
  // A 422 from publish carries the server's own check: show it.
  function housingRejected(d, err) {
    if (err && err.details && err.details.housing) d.check = { status: 'done', sig: checkSig(d), ...err.details.housing, token: undefined };
  }

  // Redraw without kicking the seller out of the field they're typing in (e.g. the price).
  function rerenderKeepFocus() {
    const a = document.activeElement;
    const id = a && a.id, pos = a && typeof a.selectionStart === 'number' ? a.selectionStart : null;
    rerender();
    const n = id && document.getElementById(id);
    if (n) { n.focus({ preventScroll: true }); if (pos !== null) { try { n.setSelectionRange(pos, pos); } catch (e) { /* number inputs */ } } }
  }

  function priceHint(cat) {
    const ps = market().filter((l) => catOf(l) === cat).map((l) => l.sem);
    const label = (D.categories.find((c) => c.id === cat) || {}).label || 'Items';
    return ps.length ? `${label} items on TroShare rent for $${Math.min(...ps)}–$${Math.max(...ps)} a semester.` : '';
  }
  const TITLE_EXAMPLES = {
    kitchen: 'e.g. Black compact microwave', light: 'e.g. Gold floor lamp', cool: 'e.g. Quiet tower fan',
    seat: 'e.g. Gray bean bag chair', sleep: 'e.g. XL twin mattress topper', tech: 'e.g. 32-inch TV with remote',
    storage: 'e.g. 3-tier rolling cart'
  };
  // The server still files each listing under an item type (stock picture, category filter, typical
  // AR model). Sellers only pick a category and write a title, so the type comes from the title's
  // words, or the first kind in the category.
  const TYPE_WORDS = { micro: /micro ?wave/, floor: /floor|standing|arc lamp|torch/, lamp: /lamp|light/, tv: /\btv\b|television|monitor|screen|display/, bean: /bean ?bag|beanbag/, fan: /\bfan\b|cooler|air ?con/, topper: /topper|mattress|pad/, cart: /cart|shel|drawer|organi[sz]er|rack|bin/ };
  function typeFor(cat, title) {
    const t = String(title || '').toLowerCase();
    // TYPE_WORDS is in order of precedence ("floor lamp" before "lamp").
    const match = Object.keys(TYPE_WORDS).find((k) => D.types[k].cat === cat && TYPE_WORDS[k].test(t));
    return match || Object.keys(D.types).find((k) => D.types[k].cat === cat);
  }

  function inboxScreen() {
    const real = server.convs.map((c) => ({ id: c.id, with: c.with.name, unread: c.unread, role: c.role === 'selling' ? 'selling' : 'renting', last: c.last ? (c.last.mine && c.last.kind === 'text' ? 'You: ' : '') + c.last.text : 'No messages yet', at: c.lastAt }));
    const local = S.threads.map((t) => {
      const last = t.msgs[t.msgs.length - 1];
      return { id: t.id, with: t.with, unread: t.unread || 0, role: t.role, last: last ? (last.from === 'me' ? 'You: ' : '') + last.text : '', at: 0 };
    });
    const ts = real.concat(local).sort((a, b) => (b.unread > 0) - (a.unread > 0) || b.at - a.at);
    const tab = ui.inboxTab === 'activity' ? 'activity' : 'chats';
    const nc = unreadChats();
    const tabs = `<div class="tabs2" role="tablist" aria-label="Inbox">
        <button type="button" role="tab" class="${tab === 'chats' ? 'on' : ''}" aria-selected="${tab === 'chats'}" data-action="inbox-tab" data-id="chats">Chats${nc ? ` (${nc})` : ''}</button>
        <button type="button" role="tab" class="${tab === 'activity' ? 'on' : ''}" aria-selected="${tab === 'activity'}" data-action="inbox-tab" data-id="activity">Activity${server.unreadNotes ? ` (${server.unreadNotes})` : ''}</button></div>`;
    if (tab === 'activity') {
      return `${topbar('Inbox')}
    <section class="section">${tabs}
      ${ui.push === 'on' ? '' : pushCard(true)}
      ${activityList()}
    </section>`;
    }
    return `${topbar('Inbox')}
    <section class="section">${tabs}
      ${ts.length ? `<div class="card" style="padding:0 14px">${ts.map((t) => `<a class="list-row" href="#/chat/${t.id}">
          <span class="${avClass(t.with)}">${esc(initial(t.with))}</span>
          <span class="grow"><span style="font-weight:700">${esc(t.with)}</span><span class="meta" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.last)}</span></span>
          ${t.unread ? `<span class="dot">${t.unread}</span>` : `<span class="badge ${t.role === 'selling' ? 'red' : ''}">${t.role === 'selling' ? 'Your listing' : 'Renting'}</span>`}
        </a>`).join('')}</div>` : '<p class="empty">No messages yet. Message a seller from any listing and the chat shows up here.</p>'}
    </section>`;
  }

  function chatScreen(id) {
    if (/^c[0-9a-f]{16}$/.test(id || '')) return realChatScreen(id);
    const t = S.threads.find((x) => x.id === id);
    if (!t) return `${topbar('Chat', '#/inbox')}<p class="empty">Conversation not found.</p>`;
    if (t.unread) { t.unread = 0; save(); }
    const r = t.rentalId && S.rentals.find((x) => x.id === t.rentalId);
    const l = r ? findListing(r.listingId) : (t.listingId ? findListing(t.listingId) : null);
    const m = t.myListingId && S.myListings.find((x) => x.id === t.myListingId);
    let card = '';
    if (r && l) {
      card = `<div class="card pad" style="margin:12px 16px 0;display:flex;flex-direction:column;gap:10px">
        <div class="row"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))} · ${r.plan === 'sem' ? 'Semester' : 'Full year'}</span><span class="meta">${esc(r.when)} · ${esc(r.where)}</span></span><span class="badge ${r.status === 'Returned' ? 'gray' : ''}">${esc(r.status)}</span></div>
        ${r.status === 'Scheduled' ? `<button type="button" class="btn btn-cardinal" data-action="confirm" data-id="${r.id}">Got it — confirm handoff</button>` : ''}
        ${r.status === 'Active' ? `<div class="callout">${I.check}<span><b>Handoff confirmed.</b> ${esc(t.with.split(' ')[0])} has been paid. Return it by move-out in May.</span></div>` : ''}
      </div>`;
    } else if (l) {
      card = `<a class="card pad row" href="#/item/${l.id}" style="margin:12px 16px 0;text-decoration:none;color:inherit"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">${money(l.sem)} per semester · ask ${esc(t.with.split(' ')[0])} anything</span></span></a>`;
    } else if (m) {
      card = `<div class="card pad row" style="margin:12px 16px 0"><span class="thumb"><img src="${esc(imgOf(m))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(m))}</span><span class="meta">Your listing · ${money(m.sem)} · rented to ${esc(t.with)}</span></span><span class="badge red">${esc(m.status)}</span></div>`;
    }
    return `${topbar(t.with, '#/inbox')}
    <div class="row" style="padding:10px 16px 0;gap:8px"><span class="${avClass(t.with)} sm">${esc(initial(t.with))}</span><span class="meta">${esc(t.year)} · Verified USC student</span>${I.verified}</div>
    ${card}
    <div class="thread" id="thread">
      ${t.msgs.map((msg) => msg.from === 'sys' ? `<span class="sys">${esc(msg.text)}</span>` : `<div class="bubble ${msg.from === 'me' ? 'me' : ''}">${esc(msg.text)}</div>`).join('')}
    </div>
    <form class="composer" data-form="chat" data-id="${t.id}"><label class="sr-only" for="msg">Message ${esc(t.with)}</label><input id="msg" name="msg" placeholder="Message ${esc(t.with.split(' ')[0])}" autocomplete="off" enterkeyhint="send"><button class="send" type="submit" aria-label="Send">${I.send}</button></form>`;
  }

  // A chat with a real student. Messages come from the server and refresh every few seconds while it's open.
  function realChatScreen(id) {
    const c = server.convs.find((x) => x.id === id);
    const msgs = server.msgs[id];
    if (msgs === undefined) fetchMessages(id).then(() => { if (parse().id === id) refreshChat(true); });
    if (!c) return `${topbar('Chat', '#/inbox')}<p class="empty">${msgs === undefined ? 'Loading…' : 'Conversation not found.'}</p>`;
    const first = c.with.name.split(' ')[0];
    const o = server.orders.filter((x) => x.convId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const l = findListing(c.listing.id);
    const thumb = (l && imgOf(l)) || c.listing.photo || D.types[c.listing.type].img;
    let card;
    if (o) {
      const [label, cls] = orderStatus(o);
      const todo = orderTodo(o);
      card = `<a class="card pad row chat-order" href="#/order/${esc(o.id)}" style="margin:12px 16px 0;text-decoration:none;color:inherit"><span class="thumb"><img src="${esc(thumb)}" alt=""></span><span class="grow"><span class="t-serif">${esc(o.title)}</span><span class="meta">${esc(orderLine(o))}</span>${todo ? `<span class="todo">${esc(todo)} →</span>` : '<span class="meta">View order →</span>'}</span><span class="badge ${cls}">${esc(label)}</span></a>`;
    } else {
      card = `<${l ? `a href="#/item/${esc(l.id)}"` : 'div'} class="card pad row" style="margin:12px 16px 0;text-decoration:none;color:inherit"><span class="thumb"><img src="${esc(thumb)}" alt=""></span><span class="grow"><span class="t-serif">${esc(c.listing.title)}</span><span class="meta">${c.role === 'selling' ? 'Your listing · ' + money(c.listing.sem) + ' per semester' : money(c.listing.sem) + ' per semester · ask ' + esc(first) + ' anything'}</span></span>${c.role === 'selling' ? '<span class="badge red">Your listing</span>' : ''}</${l ? 'a' : 'div'}>`;
    }
    return `${topbar(c.with.name, '#/inbox')}
    <div class="row" style="padding:10px 16px 0;gap:8px"><span class="${avClass(c.with.name)} sm">${esc(initial(c.with.name))}</span><span class="meta">${esc(c.with.year)} · Verified USC student${c.with.hall ? ' · ' + esc(hallById(c.with.hall) ? hallById(c.with.hall).name : '') : ''}</span>${I.verified}</div>
    ${card}
    <div class="thread" id="thread">
      ${msgs === undefined ? '<span class="sys">Loading messages…</span>' : ''}
      ${msgs && !msgs.length ? `<span class="sys">Say hi to ${esc(first)}. They'll see your message in their Inbox.</span>` : ''}
      ${(msgs || []).map((m) => m.kind === 'sys' ? `<span class="sys">${esc(m.text)}</span>` : `<div class="bubble ${m.mine ? 'me' : ''}" ${m.pending ? 'style="opacity:.6"' : ''}>${esc(m.text)}</div>`).join('')}
    </div>
    <form class="composer" data-form="chat" data-id="${id}"><label class="sr-only" for="msg">Message ${esc(c.with.name)}</label><input id="msg" name="msg" placeholder="Message ${esc(first)}" autocomplete="off" enterkeyhint="send" maxlength="1000"><button class="send" type="submit" aria-label="Send">${I.send}</button></form>`;
  }

  /* ---------- real chats: loading, sending, refreshing ---------- */
  function putConv(c) {
    const i = server.convs.findIndex((x) => x.id === c.id);
    if (i >= 0) server.convs[i] = { ...server.convs[i], ...c }; else server.convs.unshift(c);
    return c;
  }
  // Adds messages to a chat that is already loaded (never creates a partial history), oldest first.
  function mergeMessages(id, list) {
    const cur = server.msgs[id];
    if (!cur) return;
    const byId = new Map(cur.map((m) => [m.id, m]));
    list.forEach((m) => byId.set(m.id, m));
    server.msgs[id] = [...byId.values()].sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || (a.pending ? 0 : a.id - b.id));
  }
  const loadingChat = {};
  // Gets the messages you haven't loaded yet (all of them the first time). Resolves to how many arrived.
  function fetchMessages(id) {
    if (loadingChat[id]) return loadingChat[id];
    const have = (server.msgs[id] || []).filter((m) => !m.pending);
    const after = have.length ? have[have.length - 1].id : 0;
    loadingChat[id] = AUTH.call(`/conversations/${id}/messages?after=${after}`)
      .then((r) => {
        putConv(r.conversation);
        if (!server.msgs[id]) server.msgs[id] = [];
        const before = server.msgs[id].length;
        mergeMessages(id, r.messages);
        return server.msgs[id].length - before;
      })
      .catch((err) => {
        if (!server.msgs[id]) server.msgs[id] = [];
        if (err.status !== 404) toast(err.message);
        return 0;
      })
      .finally(() => { delete loadingChat[id]; });
    return loadingChat[id];
  }
  function sendReal(id, body) {
    const temp = 'p' + Date.now();
    if (body.text && !body.event) mergeMessages(id, [{ id: temp, mine: true, kind: 'text', text: body.text, pending: true }]);
    const dropTemp = () => { if (server.msgs[id]) server.msgs[id] = server.msgs[id].filter((m) => m.id !== temp); };
    return AUTH.call(`/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify(body) })
      .then((r) => {
        dropTemp();
        mergeMessages(id, r.messages);
        const m = r.messages[r.messages.length - 1];
        const c = server.convs.find((x) => x.id === id);
        if (c) { c.last = { text: m.text, mine: true, kind: m.kind }; c.lastAt = m.at; }
        return r.messages;
      })
      .catch((err) => { dropTemp(); throw err; });
  }
  // Opens (or reopens) the chat with the owner of a real listing.
  function openRealChat(l) {
    return AUTH.call('/conversations', { method: 'POST', body: JSON.stringify({ listingId: l.id }) }).then((r) => putConv(r.conversation));
  }
  function scrollThreadEnd(smooth) {
    const th = document.getElementById('thread');
    if (th && th.lastElementChild) th.lastElementChild.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
  }
  // Redraws an open chat without losing what you're typing; follows new messages if you're at the bottom.
  function refreshChat(toEnd) {
    const input = app.querySelector('#msg');
    const draft = input ? input.value : '';
    const focused = input && document.activeElement === input;
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    rerender();
    const n = app.querySelector('#msg');
    if (n) { n.value = draft; if (focused) n.focus({ preventScroll: true }); }
    if (toEnd || atBottom) scrollThreadEnd(!toEnd);
  }
  // Inbox list and unread badge.
  function refreshConvs() {
    if (!AUTH.signedIn() || AUTH.needsSetup()) return Promise.resolve();
    return AUTH.call('/conversations').then((r) => {
      server.convs = r.conversations;
      const { route } = parse();
      if (route === 'inbox') rerender(); else renderTabbar(route);
    }).catch(() => { /* try again next time */ });
  }
  setInterval(() => {
    if (document.hidden || !AUTH.signedIn()) return;
    const { route, id } = parse();
    if (route === 'chat' && /^c[0-9a-f]{16}$/.test(id || '') && server.msgs[id]) fetchMessages(id).then((n) => { if (n && parse().id === id) refreshChat(false); });
  }, 4000);
  setInterval(() => { if (!document.hidden) { refreshConvs(); refreshOrders(); refreshNotes(); } }, 20000);
  // Keeps listings fresh while the app is open: new listings from other students show up within
  // ~20 s, and an AR model being built is checked every 5 s so its status updates on its own.
  const listingStates = () => server.listings.map((l) => [l.id, l.status, l.sem, l.title, l.ar ? l.ar.status : ''].join(':')).join(',');
  let lastListingPoll = 0;
  setInterval(() => {
    if (document.hidden || !AUTH.signedIn() || AUTH.needsSetup() || !server.loaded) return;
    const building = server.listings.some((l) => l.ar && l.ar.status === 'in_progress');
    if (Date.now() - lastListingPoll < (building ? 5000 : 20000)) return;
    lastListingPoll = Date.now();
    const before = listingStates();
    AUTH.call('/listings').then((r) => {
      server.listings = r.listings.map(fromServer);
      if (listingStates() === before) return;
      const { route } = parse();
      const typing = document.activeElement && document.activeElement.matches('input, textarea, select');
      if (['home', 'search', 'item', 'account', 'ar', 'room'].includes(route) && !typing) rerender();
    }).catch(() => { /* try again next time */ });
  }, 2500);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (Date.now() - server.at > 60000) syncFromServer(); else refreshConvs();
  });

  /* ---------- orders: rent or buy, accept/decline, handoff, return, ratings (server, orders.js) ---------- */
  const OPEN_ORDER = ['requested', 'accepted', 'active', 'return_requested'];
  const half = (n) => Math.round(n / 2 * 100) / 100;
  const fmtDate = (iso) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
  function daysLeft(iso) {
    const t = new Date();
    return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
  }
  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return m + ' min ago';
    if (m < 60 * 24) return Math.round(m / 60) + ' h ago';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const firstName = (n) => String(n || '').split(' ')[0];
  function orderStatus(o) {
    const seller = o.role === 'seller';
    return ({
      requested: seller ? ['New request', 'red'] : ['Requested', ''],
      accepted: ['Accepted', ''],
      declined: ['Declined', 'gray'],
      canceled: ['Canceled', 'gray'],
      active: [seller ? 'Rented out' : 'Renting', ''],
      return_requested: ['Return pending', 'red'],
      completed: [o.kind === 'buy' ? (seller ? 'Sold' : 'Bought') : 'Returned', 'gray']
    })[o.status] || [o.status, 'gray'];
  }
  // What this student should do next on an order ('' if nothing).
  function orderTodo(o) {
    if (o.role === 'roommate') return o.split && o.split.status === 'pending' && OPEN_ORDER.includes(o.status) ? 'Answer the split request' : '';
    if (o.role === 'seller' && o.status === 'requested') return 'Accept or decline';
    if (o.role === 'renter' && o.status === 'accepted') return 'Tap “Got it” when you get it';
    if (o.role === 'seller' && o.status === 'return_requested') return 'Confirm it’s back';
    if (o.role === 'renter' && o.status === 'active' && o.returnBy && daysLeft(o.returnBy) <= 7) return 'Return it by ' + fmtDate(o.returnBy);
    if (o.status === 'completed' && !o.myReview) return 'Rate ' + firstName(o.role === 'seller' ? o.renter.name : o.seller.name);
    return '';
  }
  function ordersTodo() { return server.orders.filter((o) => orderTodo(o)).length; }
  const orderPhoto = (o) => o.photo || (D.types[o.type] && D.types[o.type].img) || '';
  function orderLine(o) {
    const what = o.kind === 'buy' ? 'Buy' : (o.plan === 'sem' ? 'Semester' : 'Full year');
    if (o.role === 'seller') return `${o.renter.name} · ${what} · ${money(o.price)}`;
    if (o.role === 'roommate') return `Split with ${o.renter.name} · your half ${money(half(o.price))}`;
    return `From ${o.seller.name} · ${what} · ${money(o.price)}${o.split && o.split.status === 'accepted' ? ' (split)' : ''}`;
  }
  function ordersList() {
    const list = server.orders.slice().sort((a, b) => (orderTodo(b) ? 1 : 0) - (orderTodo(a) ? 1 : 0) || b.updatedAt - a.updatedAt);
    return list.map((o) => {
      const [label, cls] = orderStatus(o);
      const todo = orderTodo(o);
      const role = o.role === 'seller' ? (o.kind === 'buy' ? 'Selling' : 'Renting out') : (o.role === 'roommate' ? 'Roommate split' : (o.kind === 'buy' ? 'Buying' : 'Renting'));
      return `<a class="list-row order-row" href="#/order/${esc(o.id)}"><span class="thumb"><img src="${esc(orderPhoto(o))}" alt=""></span><span class="grow"><span class="t-serif">${esc(o.title)}</span><span class="meta"><b>${role}</b> · ${esc(orderLine(o))}</span>${todo ? `<span class="todo">${esc(todo)}</span>` : ''}</span><span class="badge ${cls}">${esc(label)}</span></a>`;
    }).join('');
  }
  function putOrder(o) {
    const i = server.orders.findIndex((x) => x.id === o.id);
    if (i >= 0) server.orders[i] = o; else server.orders.unshift(o);
    return o;
  }
  const stars5 = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

  function orderScreen(id) {
    const o = server.orders.find((x) => x.id === id);
    if (!o) {
      if (!server.ordersLoaded) refreshOrders().then(() => { if (parse().id === id) rerender(); });
      return `${topbar('Order', '#/account')}<p class="empty">${server.ordersLoaded ? 'This order isn’t on your account.' : 'Loading…'}</p>`;
    }
    const [label, cls] = orderStatus(o);
    const rent = o.kind === 'rent';
    const other = o.role === 'seller' ? o.renter : o.seller;
    const otherFirst = firstName(other.name);
    const flow = ['requested', 'accepted', 'active', 'return_requested', 'completed'];
    const at = flow.indexOf(o.status);
    const steps = rent ? [['requested', 'Requested'], ['accepted', 'Accepted'], ['active', 'Handed off'], ['completed', 'Returned']]
      : [['requested', 'Requested'], ['accepted', 'Accepted'], ['completed', 'Handed off']];
    const stepper = at < 0
      ? `<div class="callout">${I.shield}<span>${o.status === 'declined' ? (o.role === 'seller' ? 'You declined this request.' : `${esc(firstName(o.seller.name))} declined this request. Try another listing.`) : 'This request was canceled.'}</span></div>`
      : `<ol class="steps" aria-label="Order progress">${steps.map(([st, t]) => `<li class="${at >= flow.indexOf(st) ? 'done' : ''} ${o.status === st || (st === 'active' && o.status === 'return_requested') ? 'now' : ''}"><span class="dotc">${at >= flow.indexOf(st) ? I.check : ''}</span>${t}</li>`).join('')}</ol>`;
    const pickupSpot = D.pickupSpots[o.seller.hall] || (hallById(o.seller.hall).name + ' lobby');
    const where = o.handoff === 'drop' ? (o.role === 'seller' ? `Delivery to ${esc(firstName(o.renter.name))}'s hall lobby` : 'Delivered to ' + esc(myLobby())) : 'Pickup at ' + esc(pickupSpot);
    const dl = rent && o.returnBy ? daysLeft(o.returnBy) : null;
    const due = rent && o.returnBy ? `<span class="meta"><b>${o.status === 'completed' ? 'Was due' : 'Due back'} ${esc(fmtDate(o.returnBy))}</b>${['active', 'return_requested'].includes(o.status) ? ` · ${dl > 0 ? dl + ' day' + (dl === 1 ? '' : 's') + ' left' : (dl === 0 ? 'today' : 'overdue')}` : ''} · last day of finals</span>` : '';
    let split = '';
    if (o.split) {
      const st = { pending: 'waiting for an answer', accepted: 'agreed to pay half', declined: 'said no' }[o.split.status] || o.split.status;
      split = o.role === 'roommate'
        ? `<div class="callout">${I.people}<span><b>${esc(o.renter.name)}</b> asked you to split this. Your half is <b>${money(half(o.price))}</b>${o.split.status === 'pending' ? '.' : ' · you ' + (o.split.status === 'accepted' ? 'said yes.' : 'said no.')}</span></div>`
        : `<span class="meta">${I.people.replace('<svg', '<svg width="14" height="14"')} Split with ${esc(o.split.name)}: ${st}${o.split.status === 'accepted' ? ` · each pays ${money(half(o.price))}` : ''}</span>`;
    }
    const act = (a, text, style) => `<button type="button" class="btn ${style || 'btn-cardinal'}" data-action="order-act" data-act="${a}" data-id="${esc(o.id)}">${text}</button>`;
    const acts = [];
    if (o.role === 'roommate' && o.split && o.split.status === 'pending' && OPEN_ORDER.includes(o.status)) acts.push(act('split-accept', 'Split it with ' + esc(firstName(o.renter.name))), act('split-decline', 'No thanks', 'btn-outline'));
    if (o.role === 'seller' && o.status === 'requested') acts.push(act('accept', 'Accept'), act('decline', 'Decline', 'btn-outline'));
    if (o.role === 'renter' && o.status === 'accepted') acts.push(act('handoff', 'Got it — confirm handoff'));
    if (o.role === 'renter' && o.status === 'active') acts.push(act('return', 'I returned it', dl !== null && dl <= 7 ? 'btn-cardinal' : 'btn-outline'));
    if (o.role === 'seller' && ['active', 'return_requested'].includes(o.status)) acts.push(act('returned', 'Got it back', o.status === 'return_requested' ? 'btn-cardinal' : 'btn-outline'));
    if (o.role === 'renter' && ['requested', 'accepted'].includes(o.status)) acts.push(act('cancel', 'Cancel request', 'btn-outline'));
    if (o.role === 'seller' && o.status === 'accepted') acts.push(act('decline', "Can't do it after all", 'btn-outline'));
    const hint = {
      requested: o.role === 'seller' ? `Accept to promise it to ${esc(firstName(o.renter.name))}. Other requests for this item are declined automatically.` : `${esc(otherFirst)} will accept or decline. You'll get a notification.`,
      accepted: o.role === 'renter' ? `Pick a time with ${esc(otherFirst)} in chat. Pay at the handoff, after you've checked the item, then tap “Got it”.` : `Pick a time with ${esc(otherFirst)} in chat. They tap “Got it” at the handoff.`,
      active: o.role === 'renter' ? `It's yours until ${esc(fmtDate(o.returnBy))}. We'll remind you a week before.` : `${esc(otherFirst)} returns it by ${esc(fmtDate(o.returnBy))}. Tap “Got it back” when you have it.`,
      return_requested: o.role === 'renter' ? `Waiting for ${esc(otherFirst)} to confirm it's back.` : `${esc(otherFirst)} says they returned it. Confirm once you have it.`
    }[o.status];
    // Ratings, once it's done.
    let rating = '';
    if (o.status === 'completed' && o.role !== 'roommate') {
      const mine = o.myReview
        ? `<p class="meta" style="margin:0">You rated ${esc(otherFirst)} <span class="stars">${stars5(o.myReview.stars)}</span>${o.myReview.text ? ` · “${esc(o.myReview.text)}”` : ''}</p>`
        : (() => {
          const r = ui.rate && ui.rate.id === o.id ? ui.rate : { stars: 0, text: '' };
          return `<div class="rate-form"><span style="font-weight:700">How was ${o.role === 'seller' ? (rent ? 'renting to' : 'selling to') : (rent ? 'renting from' : 'buying from')} ${esc(otherFirst)}?</span>
            <div class="star-row" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${r.stars === n}" aria-label="${n} star${n > 1 ? 's' : ''}" class="star ${n <= r.stars ? 'on' : ''}" data-action="rate-star" data-order="${esc(o.id)}" data-id="${n}">★</button>`).join('')}</div>
            <textarea class="input" rows="2" maxlength="300" placeholder="Anything other students should know? (optional)" data-input="rate-text" data-order="${esc(o.id)}">${esc(r.text)}</textarea>
            <button type="button" class="btn btn-cardinal" data-action="rate-send" data-id="${esc(o.id)}" ${r.stars ? '' : 'disabled'}>Post rating</button></div>`;
        })();
      const theirs = o.theirReview ? `<p class="meta" style="margin:0">${esc(otherFirst)} rated you <span class="stars">${stars5(o.theirReview.stars)}</span>${o.theirReview.text ? ` · “${esc(o.theirReview.text)}”` : ''}</p>` : '';
      rating = `<div class="card pad stack"><h2 class="h2" style="font-size:20px">Ratings</h2>${mine}${theirs}</div>`;
    }
    return `${topbar('Order', '#/account')}
    <section class="section">
      <div class="card pad stack">
        <div class="row" style="gap:12px"><span class="thumb"><img src="${esc(orderPhoto(o))}" alt=""></span><span class="grow"><span class="t-serif" style="font-size:18px">${esc(o.title)}</span><span class="meta">${rent ? (o.plan === 'sem' ? 'Rent · Semester' : 'Rent · Full year') : 'Buy'} · <b>${money(o.price)}</b></span></span><span class="badge ${cls}">${esc(label)}</span></div>
        <span class="meta">${o.role === 'seller' ? `${rent ? 'Renter' : 'Buyer'}: <b>${esc(o.renter.name)}</b>` : `Seller: <b>${esc(o.seller.name)}</b>`}${o.role === 'roommate' ? ` · Requested by <b>${esc(o.renter.name)}</b>` : ''}</span>
        <span class="meta">${where}</span>
        ${due}
        ${split}
      </div>
      ${stepper}
      ${hint ? `<p class="sub" style="margin:0">${hint}</p>` : ''}
      ${acts.length ? `<div class="order-acts">${acts.join('')}</div>` : ''}
      ${o.convId ? `<a class="btn btn-outline" href="#/chat/${esc(o.convId)}">${I.chat.replace('<svg', '<svg width="18" height="18"')} Message ${esc(otherFirst)}</a>` : ''}
      ${rating}
      ${l0(o)}
    </section>`;
  }
  // Link back to the listing while it's still up.
  const l0 = (o) => (findListing(o.listingId) && o.role !== 'seller' ? `<a class="link" href="#/item/${esc(o.listingId)}" style="text-align:center">See the listing</a>` : '');

  const ORDER_TOAST = {
    accept: 'Accepted. Pick a time in chat', decline: 'Request declined', cancel: 'Request canceled', handoff: 'Handoff confirmed',
    return: 'Marked as returned. Waiting for the seller to confirm', returned: 'Return confirmed. Thanks!',
    'split-accept': "You're splitting it", 'split-decline': 'Split declined'
  };
  function refreshOrders() {
    if (!AUTH.signedIn() || AUTH.needsSetup()) return Promise.resolve();
    return AUTH.call('/orders').then((r) => {
      const changed = JSON.stringify(r.orders) !== JSON.stringify(server.orders);
      server.orders = r.orders; server.ordersLoaded = true;
      if (!changed) return;
      const { route } = parse();
      const typing = document.activeElement && document.activeElement.matches('input, textarea');
      if (route === 'chat') refreshChat(false);
      else if (['account', 'order', 'item'].includes(route) && !typing) rerender();
      else renderTabbar(route);
    }).catch(() => { /* try again next time */ });
  }

  function ratingCard() {
    const r = server.rating;
    if (!r || !r.count) {
      return `<div class="card pad stack"><div class="section-head"><h2 class="h2" style="font-size:20px">My rating</h2></div>
        <p class="meta" style="margin:0;font-size:13px">No ratings yet. When a rental or sale is finished, you and the other student rate each other, and your rating shows on your listings.</p></div>`;
    }
    return `<div class="card pad stack"><div class="section-head"><h2 class="h2" style="font-size:20px">My rating</h2><span class="rating-big">★ ${r.avg.toFixed(1)} <small>${r.count} rating${r.count > 1 ? 's' : ''}</small></span></div>
      ${r.recent.map((x) => `<div class="review"><span class="stars">${stars5(x.stars)}</span> <b>${esc(x.from)}</b>${x.text ? `<span class="meta">“${esc(x.text)}”</span>` : ''}</div>`).join('')}</div>`;
  }

  /* ---------- roommate split ---------- */
  const mates = () => server.roommates.filter((r) => r.status === 'accepted');
  function splitMate() {
    const ms = mates();
    return ms.find((r) => r.id === ui.splitWith) || ms[0] || null;
  }
  function splitToggle(action, on) {
    const ms = mates();
    if (!ms.length) {
      return `<a class="switch-row" href="#/account" data-action="go-roommates" style="text-decoration:none;color:inherit"><span><span style="font-weight:600;display:block">Split with a roommate</span><span class="meta">Add your roommate in My Account first</span></span><span class="chev">${I.chev}</span></a>`;
    }
    const m = splitMate();
    return `<label class="switch-row"><span><span style="font-weight:600;display:block">Split with ${esc(firstName(m.name))}</span><span class="meta">They get a request to pay half. If they say no, you pay the full price.</span></span><input type="checkbox" data-action="${action}" ${on ? 'checked' : ''}></label>
      ${on && ms.length > 1 ? `<div class="chips" role="radiogroup" aria-label="Split with">${ms.map((r) => `<button type="button" role="radio" class="chip ${r.id === m.id ? 'on' : ''}" aria-checked="${r.id === m.id}" data-action="split-pick" data-id="${esc(r.id)}">${esc(firstName(r.name))}</button>`).join('')}</div>` : ''}`;
  }

  /* ---------- notifications: Activity list + push to this device ---------- */
  function setNotes(r) {
    server.notes = r.notifications;
    server.unreadNotes = r.unread;
  }
  function refreshNotes() {
    if (!AUTH.signedIn() || AUTH.needsSetup()) return Promise.resolve();
    return AUTH.call('/notifications').then((r) => {
      const changed = JSON.stringify(r) !== JSON.stringify({ notifications: server.notes, unread: server.unreadNotes });
      setNotes(r);
      if (!changed) return;
      const { route } = parse();
      if (route === 'inbox') rerender(); else renderTabbar(route);
    }).catch(() => {});
  }
  let markingNotes = false;
  function markNotesRead() {
    if (markingNotes || !server.unreadNotes) return;
    markingNotes = true;
    server.unreadNotes = 0;
    renderTabbar(parse().route);
    AUTH.call('/notifications/read', { method: 'POST' }).catch(() => {}).finally(() => { markingNotes = false; });
  }
  const NOTE_ICON = { order: 'cart', split: 'people', roommate: 'people', return: 'home', review: 'star', message: 'chat' };
  function activityList() {
    if (!server.notes.length) return '<p class="empty">Requests, answers, roommate invites, return reminders and ratings show up here.</p>';
    return `<div class="card" style="padding:0 14px">${server.notes.map((n) => {
      const ic = NOTE_ICON[n.kind] === 'star' ? '<span aria-hidden="true">★</span>' : (I[NOTE_ICON[n.kind]] || I.chat);
      return `<a class="list-row note-row ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/inbox')}"><span class="note-ico">${ic}</span><span class="grow"><span class="note-text">${esc(n.text)}</span><span class="meta">${esc(ago(n.at))}</span></span></a>`;
    }).join('')}</div>`;
  }
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = () => !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
  async function checkPush() {
    if (!pushSupported()) { ui.push = onIPhone() && !standalone() ? 'ios-install' : 'unsupported'; return; }
    if (Notification.permission === 'denied') { ui.push = 'denied'; return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      ui.push = sub && Notification.permission === 'granted' ? 'on' : 'off';
    } catch (e) { ui.push = 'off'; }
  }
  function b64uBytes(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
  async function enablePush(btn) {
    if (btn) btn.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { ui.push = perm === 'denied' ? 'denied' : 'off'; rerender(); toast('Notifications are off'); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(window.TS_CONFIG.vapidPublicKey) });
      await AUTH.call('/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
      ui.push = 'on'; rerender(); toast('Notifications are on');
    } catch (err) {
      if (btn) btn.disabled = false;
      toast(err && err.message ? err.message : "Couldn't turn on notifications");
    }
  }
  async function disablePush(quiet) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        await AUTH.call('/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe();
      }
    } catch (e) { /* nothing to turn off */ }
    if (quiet) return;
    ui.push = 'off'; rerender(); toast('Notifications are off on this device');
  }
  function pushCard(compact) {
    const msg = {
      on: 'Notifications are on for this device.',
      off: 'Get a notification when someone requests your item, answers your request, messages you, or when a return is due.',
      denied: 'Notifications are blocked for TroShare. Allow them in your browser settings (on iPhone: Settings → Notifications → TroShare).',
      'ios-install': 'On iPhone, add TroShare to your Home Screen first: tap Share → Add to Home Screen, open TroShare from there, then turn on notifications.',
      unsupported: "This browser can't show notifications. You'll still see everything under Inbox → Activity."
    }[ui.push || 'off'] || '';
    if (!msg) return '';
    const btns = ui.push === 'on'
      ? '<div class="row" style="gap:8px"><button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="push-test">Send a test</button><button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="push-off">Turn off</button></div>'
      : (ui.push === 'off' ? '<button type="button" class="btn btn-cardinal btn-small" data-action="push-on">Turn on notifications</button>' : '');
    return `<div class="card pad stack push-card">${compact ? '' : '<h2 class="h2" style="font-size:20px">Notifications</h2>'}<span class="meta">${esc(msg)}</span>${btns}</div>`;
  }

  /* ---------- how TroShare works (shown once after sign-up, and from My Account) ---------- */
  const GUIDE = [
    { icon: 'pin', title: 'Find it near your hall', text: 'Browse what other Trojans are renting out. Tap a hall on the map or search for an item. Every seller is a verified USC student.' },
    { icon: 'viewfinder', title: 'See it in your room first', text: 'Add items to your cart, then open Room Preview → AR Preview to place them in your room at real size. Recommendations suggests what your room is missing.' },
    { icon: 'chat', title: 'Request it, then meet up', text: 'Tap Rent now (or Buy now). The seller accepts, you pick a time in chat, and you pay at the handoff and tap “Got it”. Add a roommate in My Account to split the cost.' },
    { icon: 'home', title: 'Give it back at move-out', text: 'Rentals are due on the last day of finals (Dec 16 for fall 2026, May 12 for spring 2027). We remind you a week before. Hand it back, the seller confirms, and you rate each other.' }
  ];
  function guideScreen() {
    const i = Math.max(0, Math.min(ui.guide || 0, GUIDE.length - 1));
    const g = GUIDE[i], last = i === GUIDE.length - 1;
    return `${topbar('How TroShare works')}
    <section class="section guide">
      <div class="guide-ico">${I[g.icon]}</div>
      <span class="guide-step">Step ${i + 1} of ${GUIDE.length}</span>
      <h2 class="serif">${esc(g.title)}</h2>
      <p class="sub">${esc(g.text)}</p>
      <div class="guide-dots" aria-hidden="true">${GUIDE.map((_, j) => `<span class="${j === i ? 'on' : ''}"></span>`).join('')}</div>
      <div class="row" style="gap:8px">${i ? '<button type="button" class="btn btn-outline" style="flex:1" data-action="guide-prev">Back</button>' : ''}<button type="button" class="btn btn-cardinal" style="flex:2" data-action="${last ? 'guide-done' : 'guide-next'}">${last ? 'Start browsing' : 'Next'}</button></div>
      ${last ? '' : '<button type="button" class="link" data-action="guide-done" style="align-self:center">Skip</button>'}
    </section>`;
  }

  function accountScreen() {
    const statusBadge = (s) => s === 'Returned' ? 'gray' : (s === 'Rented' ? 'red' : '');
    const renting = S.rentals.map((r) => {
      const l = findListing(r.listingId); if (!l) return '';
      return `<a class="list-row" href="${r.thread ? '#/chat/' + r.thread : '#/item/' + l.id}"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">From ${esc(l.seller)} · ${r.kind === 'buy' ? 'Bought' : (r.plan === 'sem' ? '1 Semester' : 'Full year')} · ${money(r.price)}${r.split ? ' (split)' : ''}</span><span class="meta">${esc(r.when)}</span></span><span class="badge ${statusBadge(r.status)}">${esc(r.status)}</span></a>`;
    }).join('');
    const mine = myListings();
    const mineRows = mine.map((m) => `<div class="list-row"><a class="row grow" href="#/item/${esc(m.id)}" style="flex-direction:row;align-items:center;text-decoration:none;color:inherit;gap:12px"><span class="thumb"><img src="${esc(imgOf(m))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(m))}</span><span class="meta">${money(m.sem)} per semester · <span class="badge ${m.status === 'available' ? '' : (m.status === 'rented' ? 'red' : 'gray')}" style="font-size:11px">${({ paused: 'Hidden', rented: 'Rented out', sold: 'Sold' })[m.status] || 'Available'}</span>${m.housingReview ? ` <span class="badge red" style="font-size:11px">${m.housingReview.status === 'blocked' ? 'Not allowed' : 'Confirm needed'}</span>` : ''}</span><span class="meta">${esc(m.condition)} · ${m.handoff === 'both' ? 'Delivery or pickup' : (m.handoff === 'drop' ? 'Delivery only' : 'Pickup only')}</span></span></a><button type="button" class="btn btn-outline btn-small" data-action="edit-listing" data-id="${esc(m.id)}" aria-label="Edit ${esc(nameOf(m))}">Edit</button></div>`).join('');
    const viewed = S.viewed.map(findListing).filter(Boolean);
    const favs = server.favorites.map(findListing).filter(Boolean);
    const avatar = D.me.picture
      ? `<img class="av lg av-photo" src="${esc(D.me.picture)}" alt="" referrerpolicy="no-referrer">`
      : `<span class="av alt lg">${esc(D.me.initial)}</span>`;
    return `${topbar('My Account')}
    <section class="profile" style="padding-top:20px">
      <div class="row">${avatar}<span class="grow"><span style="font-size:18px;font-weight:700">${esc(AUTH.user ? AUTH.user.name : '')}</span>
        <span class="vline">${I.shield}Verified USC student${D.me.since ? ' · Member since ' + D.me.since : ''}</span>
        <span class="vline" style="opacity:.85">${esc(D.me.email)}</span></span></div>
    </section>
    <div style="height:4px;background:var(--gold)"></div>
    <section class="section">
      <a class="card pad profile-link" href="#/profile">
        <span class="grow"><span class="h2" style="font-size:20px;display:block">Your profile</span>
          <span class="meta">${esc(D.me.year || 'Add your class year')} · ${esc(AUTH.profile && AUTH.profile.hall ? hallById(D.me.hall).name : 'Add where you live')}</span></span>
        <span class="chev">${I.chev}</span></a>
      ${roommatesCard()}
      ${ratingCard()}
      <div class="card pad" style="display:flex;flex-direction:column;gap:10px">
        <h2 class="h2" style="font-size:20px">My rentals</h2>
        <div class="tabs2" role="tablist"><button type="button" role="tab" class="${ui.accTab === 'rent' ? 'on' : ''}" aria-selected="${ui.accTab === 'rent'}" data-action="acc-tab" data-id="rent">Orders (${server.orders.length + S.rentals.length})</button><button type="button" role="tab" class="${ui.accTab === 'list' ? 'on' : ''}" aria-selected="${ui.accTab === 'list'}" data-action="acc-tab" data-id="list">My listings (${mine.length})</button></div>
        <div>${ui.accTab === 'rent' ? ((ordersList() + renting) || `<p class="empty">${server.ordersLoaded ? 'No orders yet. Rent or buy something, or wait for requests on your listings.' : 'Loading…'}</p>`) : (mineRows || `<p class="empty">${server.loaded ? 'You haven’t listed anything yet.' : 'Loading…'}</p>`)}</div>
        ${ui.accTab === 'list' ? '<a class="btn-dashed" href="#/sell">+ List an item</a>' : ''}
      </div>
      ${viewed.length ? `<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><h2 class="h2" style="font-size:20px">Recently viewed</h2><div class="hscroll">${viewed.map((l) => `<a class="mini" href="#/item/${l.id}"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span style="font-size:12px;font-weight:700">${esc(nameOf(l))}</span><span style="font-size:12px;font-weight:700;color:var(--cardinal)">${money(l.sem)}/sem</span></a>`).join('')}</div></div>` : ''}
      <div class="card pad" style="display:flex;flex-direction:column;gap:4px"><h2 class="h2" style="font-size:20px">Favorites</h2>
        ${favs.length ? favs.map((l) => `<div class="list-row"><a class="row grow" href="#/item/${l.id}" style="flex-direction:row;text-decoration:none;color:inherit;gap:12px"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta"><b style="color:var(--cardinal)">${money(l.sem)}/sem</b> · ${esc(l.seller)} · ${esc(hallById(l.hall).name)}</span></span></a><button type="button" class="icon-btn" style="color:var(--cardinal)" data-action="fav" data-id="${l.id}" aria-label="Remove ${esc(nameOf(l))} from favorites">${I.heart(true)}</button></div>`).join('') : '<p class="empty">Tap the heart on a listing to save it.</p>'}
      </div>
      ${pushCard(false)}
      <a class="card pad profile-link" href="#/guide" data-action="guide-open"><span class="grow"><span class="h2" style="font-size:20px;display:block">How TroShare works</span><span class="meta">Renting, handoff, returns and ratings in 4 steps</span></span><span class="chev">${I.chev}</span></a>
      <button type="button" class="btn btn-outline" data-action="logout">Log out</button>
      <div class="card pad stack">
        <span class="label">Demo tools</span>
        <span class="meta">Fill your account with sample rentals and chats with sample sellers, or clear what you've done on this device. Your listings, favorites and chats with real students aren't affected.</span>
        <div class="row" style="gap:8px"><button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="sample-data">Load sample activity</button><button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="reset">Clear my activity</button></div>
      </div>
    </section>
    <p class="footer">A peer-to-peer marketplace for USC students.<br>Rent what you need, share what you don't — Trojan to Trojan.</p>`;
  }

  // Class year and hall, chosen by tapping a tile on the page (radio buttons, not a dropdown menu).
  function profileForm(submitLabel) {
    const saved = (AUTH.profile && AUTH.profile.hall) || '';
    const year = (AUTH.profile && AUTH.profile.year) || '';
    const tile = (name, value, on, body, q) => `<label class="choice"${q ? ` data-q="${esc(q)}"` : ''}><input type="radio" class="sr-only" name="${name}" value="${esc(value)}" ${on ? 'checked' : ''}>${body}<span class="ck">${I.check}</span></label>`;
    return `<form class="card pad stack" data-form="profile">
      <fieldset class="pick"><legend class="label">Class year</legend>
        <div class="choice-grid">${YEARS.map((y) => tile('year', y, year === y, `<span class="t">${esc(y)}</span>`)).join('')}</div></fieldset>
      <fieldset class="pick"><legend class="label">Where you live</legend>
        <input class="input" type="search" placeholder="Search ${D.halls.length} residences, e.g. Webb or WTO" aria-label="Search residences" data-input="hall-q" autocomplete="off">
        <div class="choice-list">${D.halls.map((h) => tile('hall', h.id, saved === h.id, `<span class="grow"><span class="t">${esc(h.name)}</span>${h.code ? `<span class="n">${esc(h.code)}</span>` : ''}</span>`, (h.name + ' ' + h.code + ' ' + h.short).toLowerCase())).join('')}</div>
        <p class="meta" data-hall-none hidden>No residence matches that. Try part of the name or its code.</p></fieldset>
      <span class="meta">Sellers see your first name, last initial, class year and hall. Your email stays private.</span>
      <button type="submit" class="btn btn-cardinal">${esc(submitLabel)}</button>
    </form>`;
  }

  function profileScreen() {
    return `${topbar('Your profile', '#/account')}
    <section class="section">
      <div><h2 class="serif" style="margin:0;font-size:26px">Your profile</h2>
        <p class="sub" style="margin:6px 0 0">Tap your class year and the hall you live in, then save.</p></div>
      ${profileForm('Save changes')}
    </section>`;
  }

  /* ---------- roommates ---------- */
  const roommateFirst = () => { const r = server.roommates.find((x) => x.status === 'accepted' && x.name); return r ? r.name.split(' ')[0] : ''; };
  function roommatesCard() {
    const rs = server.roommates;
    const av = (r) => r.picture ? `<img class="av sm av-photo" src="${esc(r.picture)}" alt="" referrerpolicy="no-referrer">` : `<span class="${avClass(r.name || r.email)} sm">${esc(initial(r.name || r.email))}</span>`;
    const rows = rs.map((r) => {
      if (r.direction === 'received' && r.status === 'pending') {
        return `<div class="rm-row rm-invite">${av(r)}<span class="grow"><span class="rm-name"><b>${esc(r.name)}</b> invited you to be roommates</span><span class="meta">${esc(r.email)}</span></span>
          <span class="rm-btns"><button type="button" class="btn btn-cardinal btn-small" data-action="rm-accept" data-id="${esc(r.id)}">Accept</button><button type="button" class="btn btn-outline btn-small" data-action="rm-remove" data-id="${esc(r.id)}" data-kind="decline">Decline</button></span></div>`;
      }
      const pending = r.status === 'pending';
      return `<div class="rm-row">${av(r)}<span class="grow"><span class="rm-name">${esc(r.name || r.email)}</span>${r.name ? `<span class="meta">${esc(r.email)}</span>` : ''}</span>
        ${pending ? '<span class="badge gray">Pending</span>' : ''}
        <button type="button" class="link" style="font-size:13px" data-action="rm-remove" data-id="${esc(r.id)}" data-kind="${pending ? 'cancel' : 'remove'}">${pending ? 'Cancel' : 'Remove'}</button></div>`;
    }).join('');
    return `<div class="card pad stack" id="roommates">
      <div class="section-head"><h2 class="h2" style="font-size:20px">Roommates</h2></div>
      ${rows || '<p class="meta" style="margin:0">Add your roommate to split rentals with them.</p>'}
      <form class="rm-form" data-form="roommate" novalidate>
        <input class="input" type="email" name="email" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="roommate@usc.edu" aria-label="Roommate's .edu email" data-input="rm-email" value="${esc(ui.rmEmail || '')}">
        <button type="submit" class="btn btn-cardinal btn-small" ${ui.rmBusy ? 'disabled' : ''}>${I.people}Add roommate</button>
      </form>
      <span class="meta">They'll see your invite in My Account when they sign in to TroShare with that email. It shows as Pending until they accept.</span>
    </div>`;
  }
  const setRoommates = (list) => {
    const changed = JSON.stringify(list) !== JSON.stringify(server.roommates);
    server.roommates = list;
    return changed;
  };
  // While My Account is open, check for answers to invites (and new invites) every 10 seconds.
  function refreshRoommates() {
    if (!AUTH.signedIn()) return Promise.resolve();
    return AUTH.call('/roommates').then((r) => {
      const typing = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.input === 'rm-email';
      if (setRoommates(r.roommates) && parse().route === 'account' && !typing) rerender();
    }).catch(() => {});
  }
  setInterval(() => { if (!document.hidden && parse().route === 'account') refreshRoommates(); }, 10000);

  function welcomeScreen() {
    return `${topbar('Welcome')}
    <section class="section">
      <div><h2 class="serif" style="margin:0;font-size:28px">Welcome, ${esc(D.me.first || 'Trojan')}!</h2>
        <p class="sub" style="margin:6px 0 0">You're signed in as ${esc(D.me.email)}. Two quick details so we can show what's near you.</p></div>
      ${profileForm('Start using TroShare')}
    </section>`;
  }

  /* ---------- AI room planner + "see it in your room" ---------- */
  // Room analysis goes through TroShare's proxy (proxy/worker.js), which holds the Anthropic key.
  const ROOM_MAX = 5;
  const SAMPLE_ROOM = 'images/sample-room.jpg';
  // Starting placement per item type: [longest side as a fraction of the photo width, vertical center (fraction of height)].
  const ROOM_FIT = { tv: [0.3, 0.5], bean: [0.3, 0.75], lamp: [0.14, 0.5], floor: [0.36, 0.62], fan: [0.22, 0.62], topper: [0.45, 0.75], cart: [0.22, 0.62] };
  // Room photos are kept in memory only (they're too big for localStorage and private to this visit).
  const room = { photos: [], sample: null, analysis: null, busy: false, error: null };
  const fit = { id: null, idx: 0, x: 0.5, y: 0.65, size: 0.3, rot: 0, flip: false };
  const cutouts = {}; // product image src -> PNG data URL with the white studio backdrop removed ('' while pending or if it failed)

  // Nearest listing of a type (your hall first, then walking distance, then price).
  function bestListing(type) {
    return market().filter((l) => l.type === type && l.owner !== 'me')
      .sort((a, b) => hallById(a.hall).mins - hallById(b.hall).mins || a.sem - b.sem)[0] || null;
  }

  const sampleCredit = () => '<span class="credit">Sample room: “Endicott College Stoneridge Hall empty dorm room” by Sdkb, <a href="https://commons.wikimedia.org/wiki/File:Endicott_College_Stoneridge_Hall_empty_dorm_room.jpg" target="_blank" rel="noopener">Wikimedia Commons</a>, CC BY-SA 4.0.</span>';

  function roomPhotoStrip(selectable) {
    const slots = room.photos.map((p, i) => `<div class="photo-slot ${selectable && fit.idx === i ? 'sel' : ''}">
      ${selectable ? `<button type="button" class="slot-pick" data-action="fit-photo" data-id="${i}" aria-pressed="${fit.idx === i}" aria-label="Use room photo ${i + 1}"><img src="${p}" alt=""></button>` : `<img src="${p}" alt="Room photo ${i + 1}">`}
      <button type="button" class="x" data-action="rm-room" data-id="${i}" aria-label="Remove room photo ${i + 1}">✕</button></div>`).join('');
    const room_left = room.photos.length < ROOM_MAX;
    return `<div class="photos">${slots}
      ${room_left ? `<label class="photo-slot add">${I.camera}${room.photos.length ? 'Add more' : 'Add photos'}<input type="file" accept="image/*" multiple class="sr-only" data-input="room-photo"></label>` : ''}
      ${room_left && !room.sample ? `<button type="button" class="photo-slot add" data-action="sample-room">${I.home}Use a sample room</button>` : ''}
    </div>`;
  }

  function roomScreen() {
    const a = room.analysis;
    let action;
    if (room.busy) {
      action = `<div class="callout" role="status"><span class="spinner" aria-hidden="true"></span><span><b>Looking at your room…</b> This usually takes 15–40 seconds.</span></div>`;
    } else {
      action = `<button type="button" class="btn btn-cardinal" data-action="analyze" ${room.photos.length ? '' : 'disabled'}>${a ? 'Analyze again' : 'Get recommendations'}</button>
        ${room.photos.length ? '' : '<span class="note">Add at least one photo first.</span>'}`;
    }
    const tab = ui.roomTab === 'rec' ? 'rec' : 'ar';
    const tabs = `<div class="tabs2 room-tabs" role="tablist" aria-label="Room Preview">
        <button type="button" role="tab" id="room-tab-ar" aria-controls="room-panel" class="${tab === 'ar' ? 'on' : ''}" aria-selected="${tab === 'ar'}" data-action="room-tab" data-id="ar">AR Preview</button>
        <button type="button" role="tab" id="room-tab-rec" aria-controls="room-panel" class="${tab === 'rec' ? 'on' : ''}" aria-selected="${tab === 'rec'}" data-action="room-tab" data-id="rec">Recommendations</button>
      </div>`;
    if (tab === 'ar') {
      return `${topbar('Room Preview')}
    <section class="section">${tabs}</section>
    <div id="room-panel" role="tabpanel" aria-labelledby="room-tab-ar">${arPreviewPanel()}</div>`;
    }
    return `${topbar('Room Preview')}
    <section class="section">${tabs}</section>
    <div id="room-panel" role="tabpanel" aria-labelledby="room-tab-rec">
    <section class="section">
      <div><h2 class="serif" style="margin:0;font-size:26px">Plan your room</h2>
        <p class="sub" style="margin:6px 0 0">Add a few photos of your room from different corners. Claude looks at what's there and suggests what to rent from other Trojans, and you can preview each item in your photos.</p></div>
      ${roomPhotoStrip(false)}
      ${room.sample ? sampleCredit() : ''}
      ${action}
      ${room.error ? `<div class="callout" role="alert">${I.shield}<span>${esc(room.error)}</span></div>` : ''}
    </section>
    ${a ? roomResults(a) : ''}
    <p class="footer">Your photos are sent to Anthropic to be analyzed and aren't stored by TroShare.<br>AI suggestions can miss things, so check sizes before you rent.</p>
    </div>`;
  }

  // AR Preview tab: pick an item from the photo rail, spin the 3D model, then place it in your room at real size.
  function arPreviewPanel() {
    const rows = cartRows(S.cart);
    const has3d = ({ l }) => !!(AR_MODELS[l.type] || hasGenAr(l));
    const picks = rows.filter(has3d);
    if (!picks.length) {
      return `<section class="section ar-panel"><div class="ar-empty">${I.cart}
        <h2 class="serif">${rows.length ? 'No 3D models in your cart yet' : 'Your cart is empty'}</h2>
        <p class="sub">${rows.length
          ? 'The items in your cart don’t have a 3D model yet. Add an item that does, or open a listing and tap <b>AR Preview</b> on its photo.'
          : 'AR Preview shows the items in your cart. Tap <b>Add to cart</b> on a listing to see it here, or open any listing and tap <b>AR Preview</b> on its photo.'}</p>
        <a class="btn btn-cardinal" href="#/home">Browse listings</a>
        ${rows.length ? '<a class="btn btn-outline" href="#/cart">Go to cart</a>' : ''}</div></section>`;
    }
    const cur = picks.find((p) => p.l.id === ui.arPick) || picks[0];
    const { c, l } = cur;
    const gen = hasGenAr(l);
    const phone = onIPhone() || onAndroid();
    const place = placementFor(l.type);
    const src = 'models/' + l.type;
    const noModel = rows.filter((r) => !has3d(r));
    const priceOf = (x) => (modeOf(x.c) === 'buy' ? `${money(x.l.buyPrice)} to buy` : `${money(entryPrice(x.c, x.l))}/${x.c.plan === 'sem' ? 'sem' : 'yr'}`);
    return `<section class="section ar-panel">
      <div><h2 class="serif ar-h">Your cart in your room</h2>
        <p class="sub" style="margin:6px 0 0">Pick an item from your cart and drop a real-size 3D model into your room with your phone’s camera.</p></div>
      <div class="ar-rail" role="radiogroup" aria-label="Item to preview">${picks.map((p) => `<button type="button" role="radio" class="ar-tile ${p === cur ? 'on' : ''}" aria-checked="${p === cur}" data-action="ar-pick" data-id="${esc(p.l.id)}">
          <span class="ar-tile-ph"><img src="${esc(imgOf(p.l))}" alt=""></span>
          <span class="ar-tile-name">${esc(nameOf(p.l))}</span>
          <span class="ar-tile-price">${priceOf(p)}</span></button>`).join('')}</div>
      ${noModel.length ? `<span class="meta">No 3D model yet: ${noModel.map((r) => esc(nameOf(r.l))).join(', ')}</span>` : ''}
      <div class="ar-card">
        <div class="ar-stage-wrap">
          ${gen
            ? `<model-viewer class="ar-stage" id="ar-model" data-gen="${esc(l.id)}" poster="${esc(imgOf(l))}" alt="${esc(nameOf(l))} in 3D" camera-controls auto-rotate auto-rotate-delay="800" rotation-per-second="18deg" touch-action="pan-y" shadow-intensity="1" ar ar-modes="webxr quick-look" ar-scale="fixed" ar-placement="floor"></model-viewer>`
            : `<model-viewer class="ar-stage" id="ar-model" src="${src}.glb" ios-src="${src}.usdz" poster="${esc(imgOf(l))}" alt="${esc(nameOf(l))} in 3D, ${esc(AR_MODELS[l.type])}" camera-controls auto-rotate auto-rotate-delay="800" rotation-per-second="18deg" touch-action="pan-y" shadow-intensity="1" ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed" ar-placement="floor"></model-viewer>`}
        </div>
        <div class="ar-card-body">
          <div class="ar-title-row"><span class="grow"><span class="t-serif ar-name">${esc(nameOf(l))}</span><span class="meta">${esc(l.seller)} · ${esc(hallById(l.hall).walk)} · ${modeOf(c) === 'buy' ? 'Buying' : 'Renting'}</span></span><span class="ar-price">${money(entryPrice(c, l))}<small>${modeOf(c) === 'buy' ? '' : (c.plan === 'sem' ? '/sem' : '/yr')}</small></span></div>
          ${gen ? `<span class="ar-size" id="ar-size">${I.viewfinder}Building the 3D model…</span>` : `<span class="ar-size">${I.viewfinder}Real size · ${esc(AR_MODELS[l.type])}</span>`}
          ${place && !gen ? `<span class="where" style="align-items:flex-start">${I.pin}Suggested spot: ${esc(place.replace(/[. ]*$/, ''))}</span>` : ''}
          <div class="ar-actions">
            ${phone || gen ? arButton(l, 'AR Preview', 'btn btn-cardinal') : `<button type="button" class="btn btn-cardinal" data-action="ar-desk">${I.viewfinder}AR Preview</button>`}
            <a class="btn btn-outline" href="#/cart">Go to cart</a>
          </div>
          <p class="ar-hint">Point at the floor, tap the circle, then walk around it.</p>
        </div>
      </div>
    </section>`;
  }

  function roomResults(a) {
    return `<section class="section" id="room-results">
      <div class="card pad stack"><span class="eyebrow-red">${I.sparkle}What Claude sees</span><span style="font-size:15px;line-height:1.5">${esc(a.summary)}</span></div>
      ${a.recommendations.length ? `<div class="section-head"><h2>Get these</h2><span class="sub">${a.recommendations.length} ideas</span></div>${a.recommendations.map(recCard).join('')}` : ''}
      ${a.tips && a.tips.length ? `<div class="section-head"><h2>Free fixes</h2></div><div class="card pad stack">${a.tips.map((t) => `<div class="row" style="align-items:flex-start;gap:8px"><span class="tip-dot" aria-hidden="true"></span><span style="font-size:14px;line-height:1.45">${esc(t)}</span></div>`).join('')}</div>` : ''}
    </section>`;
  }

  function recCard(r) {
    const l = D.types[r.item] ? bestListing(r.item) : null;
    const must = r.priority === 'must_have';
    return `<div class="card pad rec">
      <div class="row" style="justify-content:space-between;align-items:baseline"><span class="t-serif" style="font-size:18px">${esc(r.name)}</span><span class="badge ${must ? 'must' : 'gray'}">${must ? 'Must-have' : 'Nice to have'}</span></div>
      <p style="margin:0;font-size:14px;line-height:1.45">${esc(r.reason)}</p>
      <span class="where" style="align-items:flex-start">${I.pin}${esc(r.placement)}</span>
      ${l ? `<div class="rec-listing">
          <div class="row"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><b>${money(l.sem)}/sem · ${esc(l.seller)}</b><span class="meta">${esc(hallById(l.hall).name)} · ${esc(hallById(l.hall).walk)}</span></span></div>
          <div class="row" style="gap:8px"><a class="btn btn-outline btn-small" style="flex:1" href="#/fit/${l.id}">See it in my room</a><a class="btn btn-cardinal btn-small" style="flex:1" href="#/item/${l.id}">View listing</a></div>
          ${arButton(l, 'Preview in AR')}
          <button type="button" class="link" data-action="browse-type" data-id="${esc(r.item)}" style="align-self:flex-start;padding:4px 0">Browse all ${esc(D.types[r.item].name.toLowerCase())}s →</button>
        </div>` : '<span class="meta">Nobody is renting this out on TroShare yet.</span>'}
    </div>`;
  }

  async function analyzeRoom() {
    if (!room.photos.length || room.busy) return;
    room.busy = true; room.error = null; rerender();
    const catalog = Object.keys(D.types).map((id) => {
      const ps = market().filter((l) => l.type === id && l.owner !== 'me').map((l) => l.sem);
      return { id, count: ps.length, min: Math.min(...ps), max: Math.max(...ps) };
    }).filter((c) => c.count);
    try {
      const json = await AUTH.call('/analyze-room', {
        method: 'POST',
        body: JSON.stringify({ photos: room.photos.map((url) => url.split(',')[1]), hall: hallById(D.me.hall).name, catalog })
      });
      if (!json || !Array.isArray(json.recommendations)) throw new SyntaxError('bad shape');
      room.analysis = json;
    } catch (err) {
      if (err instanceof SyntaxError) room.error = "Couldn't read Claude's answer. Try again.";
      else room.error = err.message;
    }
    room.busy = false;
    if (parse().route === 'room') {
      rerender();
      const r = document.getElementById('room-results');
      if (r && room.analysis) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function fitScreen(id) {
    const l = findListing(id);
    if (!l) return `${topbar('In your room', '#/home')}<p class="empty">This listing is gone.</p>`;
    if (fit.id !== id) resetFit(l, id);
    if (fit.idx >= room.photos.length) fit.idx = 0;
    const src = imgOf(l);
    if (!(src in cutouts)) makeCutout(src);
    const cut = cutouts[src];
    return `${topbar('In your room', '#/item/' + encodeURIComponent(id))}
    <section class="section">
      ${room.photos.length ? `
        <div class="fit-stage" id="fit-stage">
          <img class="fit-room" src="${room.photos[fit.idx]}" alt="Your room photo" draggable="false">
          <img class="fit-item ${cut ? '' : 'raw'}" id="fit-item" src="${esc(cut || src)}" alt="${esc(nameOf(l))} placed on your room photo" draggable="false">
          <span class="fit-tag">Approximate size</span>
        </div>
        <span class="meta">Drag to move. Pinch or use the slider to resize; twist with two fingers to rotate.</span>
        <label class="row" style="gap:10px"><span class="label" style="flex:none">Size</span><input type="range" min="4" max="90" value="${Math.round(fit.size * 100)}" data-input="fit-size" aria-label="Item size" style="flex:1;accent-color:var(--cardinal)"></label>
        <div class="row" style="gap:8px">
          <button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="fit-flip">Flip</button>
          <button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="fit-rotate">Rotate</button>
          <button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="fit-reset" data-id="${esc(id)}">Reset</button>
        </div>
        <span class="label">Your room photos</span>
        ${roomPhotoStrip(true)}
        ${room.sample ? sampleCredit() : ''}`
      : `<div class="stack"><h2 class="serif" style="margin:0;font-size:24px">See how the ${esc(nameOf(l).toLowerCase())} fits</h2>
          <p class="sub" style="margin:0">Add a photo of the spot where it would go, or try it in a sample dorm room. Then move and resize it on top.</p></div>
        ${roomPhotoStrip(false)}`}
      <div class="card pad row"><span class="thumb"><img src="${esc(src)}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">${money(l.sem)}/semester · ${esc(l.seller)}</span></span>
        ${l.owner === 'me' ? '' : `<button type="button" class="btn btn-cardinal btn-small" data-action="fit-rent" data-id="${esc(id)}">Rent</button>`}</div>
    </section>`;
  }

  // Category stand-ins at real-world size. The file name matches the item type.
  const AR_MODELS = {
    lamp: 'about 44 cm tall',
    floor: 'about 1.6 m tall',
    fan: 'about 1.03 m tall',
    bean: 'about 70 cm tall and 83 cm across',
    tv: 'about 74 cm wide and 51 cm tall',
    topper: 'a folded XL twin, about 88 cm wide, 65 cm long, and 21 cm tall',
    cart: 'about 92 cm tall'
  };

  function placementFor(type) {
    const recs = (room.analysis && room.analysis.recommendations) || [];
    const rec = recs.find((r) => r.item === type);
    // The camera instructions stay in English. Ignore a spot sentence written in another language.
    if (!rec || !rec.placement || /[\u3400-\u9fff]/.test(rec.placement)) return '';
    return rec.placement;
  }

  function onIPhone() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function onAndroid() {
    return /Android/i.test(navigator.userAgent);
  }

  // One tap opens the rear camera and puts the model on the floor.
  // iPhone uses AR Quick Look. Android uses Scene Viewer. A computer has no phone camera, so it shows the model instead.
  // cls replaces the default gold button look (the product photo uses its own pill).
  function arButton(l, label, cls) {
    const img = `<img src="${esc(imgOf(l))}" alt="">`;
    const look = cls || 'btn btn-gold';
    const icon = cls ? I.viewfinder : '';
    // AI-made models are built in the browser, so they always open on TroShare's AR screen.
    if (hasGenAr(l)) return `<a class="${look}" href="#/ar/${encodeURIComponent(l.id)}">${I.viewfinder}${esc(label)}</a>`;
    if (onIPhone()) {
      // AR Quick Look needs an <img> as the link's first child.
      return `<a class="${look} ar-launch" rel="ar" href="models/${l.type}.usdz#allowsContentScaling=0">${img}${esc(label)}</a>`;
    }
    if (onAndroid()) {
      const file = new URL('models/' + l.type + '.glb', location.href).href;
      const scene = 'https://arvr.google.com/scene-viewer/1.0?mode=ar_preferred&disableScaling=true&file=' + encodeURIComponent(file) + '&title=' + encodeURIComponent(nameOf(l));
      return `<a class="${look} ar-launch" href="${scene}">${cls ? icon : img}${esc(label)}</a>`;
    }
    return `<a class="${look}" href="#/ar/${l.id}">${icon}${esc(label)}</a>`;
  }

  function arScreen(id) {
    const l = findListing(id);
    if (!l) return `${topbar('Preview in AR', '#/room')}<p class="empty">This listing is gone.</p>`;
    const size = AR_MODELS[l.type];
    if (!size && !hasGenAr(l)) return `${topbar('Preview in AR', '#/item/' + encodeURIComponent(id))}<p class="empty">No 3D preview for this item yet.</p>`;
    const back = (room.analysis ? '#/room' : '#/item/' + encodeURIComponent(id));
    return `${topbar('Preview in AR', back)}
    <section class="section">
      <div><h2 class="serif" style="margin:0;font-size:26px">${esc(nameOf(l))}</h2></div>
      ${arBody(l)}
    </section>`;
  }

  function arBody(l) {
    if (hasGenAr(l)) return genArBody(l);
    const size = AR_MODELS[l.type];
    const id = l.id;
    const place = placementFor(l.type);
    const src = 'models/' + l.type;
    const spot = place
      ? 'Suggested spot: ' + place.replace(/[. ]*$/, '') + '. Aim the rear camera there. When a circle appears on the floor, tap it and the furniture sits down at real size.'
      : 'Aim the rear camera at the floor. When a circle appears, tap it and the furniture sits down at real size.';
    const phone = onIPhone() || onAndroid();
    return `<p class="sub" style="margin:0">${esc(spot)}</p>
      ${phone ? arButton(l, 'Open camera and place on the floor') : `<model-viewer class="ar-stage" id="ar-model" src="${src}.glb" ios-src="${src}.usdz" alt="${esc(nameOf(l))} in 3D, ${esc(size)}" camera-controls touch-action="pan-y" shadow-intensity="1" ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed" ar-placement="floor"></model-viewer>`}
      <p class="meta">This is a typical ${esc(typeOf(l).name)}, ${esc(size)}, not a scan of the seller's photo. ${phone ? 'The camera is your phone’s rear camera. Move slowly so it can find the floor.' : 'This computer cannot open your phone’s camera. Open the same page in Safari on your iPhone, then tap AR Preview.'}</p>
      <div class="card pad row"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">${money(l.sem)}/semester · ${esc(l.seller)}</span></span>
        ${l.owner === 'me' ? '' : `<a class="btn btn-outline btn-small" href="#/item/${encodeURIComponent(id)}">View</a><button type="button" class="btn btn-cardinal btn-small" data-action="fit-rent" data-id="${esc(id)}">Rent</button>`}</div>`;
  }

  // AR screen for a model Claude made from the seller's photos. setupGenAr() builds it after render.
  function genArBody(l) {
    const id = l.id;
    const phone = onIPhone() || onAndroid();
    return `<p class="sub" style="margin:0">Aim the rear camera at the floor. When a circle appears, tap it and the item sits down at real size.</p>
      <model-viewer class="ar-stage" id="ar-model" data-gen="${esc(id)}" alt="${esc(nameOf(l))} in 3D" camera-controls auto-rotate touch-action="pan-y" shadow-intensity="1" ar ar-modes="webxr quick-look" ar-scale="fixed" ar-placement="floor"></model-viewer>
      <span class="ar-size" id="ar-size">${I.viewfinder}Building the 3D model…</span>
      ${phone ? `<button type="button" class="btn btn-gold" data-action="ar-activate">${I.viewfinder}Open camera and place on the floor</button>` : ''}
      <p class="meta">Claude made this model from the seller's photos, so sizes and details are approximate. ${phone ? 'Move slowly so your phone can find the floor.' : 'This computer cannot open your phone’s camera. Open the same page on your phone, then tap AR Preview.'}</p>
      <div class="card pad row"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">${money(l.sem)}/semester · ${esc(l.seller)}</span></span>
        ${l.owner === 'me' ? '' : `<a class="btn btn-outline btn-small" href="#/item/${encodeURIComponent(id)}">View</a><button type="button" class="btn btn-cardinal btn-small" data-action="fit-rent" data-id="${esc(id)}">Rent</button>`}</div>`;
  }
  const arSpecs = {}; // listing id -> Promise of the model description
  function setupGenAr() {
    const mv = document.getElementById('ar-model');
    const id = mv && mv.dataset.gen;
    if (!id) return;
    if (!arSpecs[id]) {
      arSpecs[id] = AUTH.call('/listings/' + encodeURIComponent(id) + '/ar-model').then((r) => r.spec);
      arSpecs[id].catch(() => delete arSpecs[id]);
    }
    arSpecs[id].then((spec) => window.TS_AR.model(id, spec)).then((m) => {
      const el = document.getElementById('ar-model');
      if (!el || el.dataset.gen !== id) return;
      el.src = m.url;
      const label = document.getElementById('ar-size');
      if (label) label.innerHTML = `${I.viewfinder}Real size · ${esc(window.TS_AR.describe(m.size))}`;
    }).catch((err) => {
      const label = document.getElementById('ar-size');
      if (label) label.textContent = "Couldn't load the 3D model: " + err.message;
    });
  }

  function resetFit(l, id) {
    const [size, y] = ROOM_FIT[l.type] || [0.3, 0.65];
    Object.assign(fit, { id, x: 0.5, y, size, rot: 0, flip: false });
  }

  function applyFit() {
    const el = document.getElementById('fit-item');
    if (!el) return;
    el.style.left = (fit.x * 100) + '%';
    el.style.top = (fit.y * 100) + '%';
    el.style.width = (fit.size * 100) + '%';
    el.style.transform = `translate(-50%, -50%) rotate(${fit.rot}deg) scaleX(${fit.flip ? -1 : 1})`;
    const slider = app.querySelector('[data-input="fit-size"]');
    if (slider && document.activeElement !== slider) slider.value = Math.round(fit.size * 100);
  }

  // Drag with one finger or the mouse; pinch and twist with two fingers; ctrl+wheel / trackpad pinch on desktop.
  function setupFit() {
    const stage = document.getElementById('fit-stage');
    if (!stage) return;
    applyFit();
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const pts = new Map();
    let start = null;
    const snap = () => ({ x: fit.x, y: fit.y, size: fit.size, rot: fit.rot, p: [...pts.values()].map((q) => ({ ...q })) });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    const mid = (p) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = snap();
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = stage.getBoundingClientRect();
      const p = [...pts.values()];
      if (p.length === 1 && start.p.length === 1) {
        fit.x = clamp(start.x + (p[0].x - start.p[0].x) / r.width, 0, 1);
        fit.y = clamp(start.y + (p[0].y - start.p[0].y) / r.height, 0, 1);
      } else if (p.length >= 2 && start.p.length >= 2) {
        fit.size = clamp(start.size * dist(p[0], p[1]) / (dist(start.p[0], start.p[1]) || 1), 0.04, 0.9);
        fit.rot = start.rot + ang(p[0], p[1]) - ang(start.p[0], start.p[1]);
        const m0 = mid(start.p), m1 = mid(p);
        fit.x = clamp(start.x + (m1.x - m0.x) / r.width, 0, 1);
        fit.y = clamp(start.y + (m1.y - m0.y) / r.height, 0, 1);
      }
      applyFit();
    });
    const end = (e) => { pts.delete(e.pointerId); start = pts.size ? snap() : null; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      fit.size = clamp(fit.size * Math.exp(-e.deltaY / 200), 0.04, 0.9);
      applyFit();
    }, { passive: false });
  }

  function makeCutout(src) {
    cutouts[src] = '';
    loadImage(src)
      .then((img) => { cutouts[src] = removeBackdrop(img) || ''; })
      .catch(() => { /* keep the original photo */ })
      .then(() => { if (parse().route === 'fit' && cutouts[src]) { render(); } });
  }

  // Clears near-white pixels connected to the photo's edges (so white parts inside the product stay),
  // feathers the edge, and crops to what's left.
  function removeBackdrop(img) {
    const s = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const SOLID = 226, CLEAR = 246; // darkest channel: <= SOLID keeps, >= CLEAR removes, between feathers
    const light = (p) => Math.min(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]);
    const seen = new Uint8Array(w * h);
    const stack = [];
    const seed = (p) => { if (!seen[p] && light(p) > SOLID) { seen[p] = 1; stack.push(p); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      const l = light(p);
      px[p * 4 + 3] = l >= CLEAR ? 0 : Math.round(255 * (CLEAR - l) / (CLEAR - SOLID));
      const x = p % w;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (p >= w) seed(p - w);
      if (p < w * (h - 1)) seed(p + w);
    }
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4 + 3] > 24) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) return null;
    ctx.putImageData(data, 0, 0);
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  function addRoomFiles(files) {
    const list = Array.from(files || []).slice(0, ROOM_MAX - room.photos.length);
    if (!list.length) return;
    Promise.all(list.map((f) => compress(f, 1568, 0.82).catch(() => null))).then((urls) => {
      const ok = urls.filter(Boolean);
      room.photos.push(...ok);
      if (ok.length < list.length) toast("Couldn't read one of those photos");
      rerender();
    });
  }

  /* ---------- router ---------- */
  function parse() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
    return { route: parts[0] || 'home', id: parts[1] ? decodeURIComponent(parts[1]) : null };
  }
  let lastHash = null;
  function render() {
    const { route, id } = parse();
    let html;
    if (AUTH.needsSetup()) html = welcomeScreen();
    else switch (route) {
      // Browse now lives on Home; old #/browse links open Home at the list.
      case 'browse': ui.toList = true; html = homeScreen(); break;
      case 'search': html = searchScreen(); break;
      case 'item': html = itemScreen(id); break;
      case 'cart': html = cartScreen(); break;
      case 'checkout': html = checkoutScreen(); break;
      case 'sell': html = sellScreen(); break;
      case 'edit': html = editScreen(id); break;
      case 'inbox': html = inboxScreen(); break;
      case 'chat': html = chatScreen(id); break;
      case 'account': html = accountScreen(); break;
      case 'profile': html = profileScreen(); break;
      case 'order': html = orderScreen(id); break;
      case 'guide': html = guideScreen(); break;
      case 'room': html = roomScreen(); break;
      case 'fit': html = fitScreen(id); break;
      case 'ar': html = arScreen(id); break;
      default: html = homeScreen();
    }
    app.innerHTML = html;
    renderTabbar(route);
    if (route === 'fit') setupFit();
    if (route === 'ar' || route === 'room') setupGenAr();
    if (route === 'inbox' && ui.inboxTab === 'activity') markNotesRead();
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      if (route === 'chat') scrollThreadEnd();
      else window.scrollTo(0, 0);
    }
    if (ui.toList && (route === 'home' || route === 'browse')) {
      ui.toList = false;
      const list = document.getElementById('listings');
      if (list) list.scrollIntoView({ block: 'start' });
    }
    if (ui.focusQ && route === 'search') { ui.focusQ = false; const qi = app.querySelector('[data-input="q"]'); if (qi) qi.focus({ preventScroll: true }); }
  }
  function rerender() { const y = window.scrollY; render(); window.scrollTo(0, y); }

  /* ---------- actions ---------- */
  function ensureThread(name, year, extra) {
    let t = S.threads.find((x) => x.with === name && (!extra.rentalId || x.rentalId === extra.rentalId || !x.rentalId));
    if (!t) { t = { id: 't' + Date.now() + Math.floor(Math.random() * 1000), with: name, year, unread: 0, msgs: [], role: 'renting', ...extra }; S.threads.push(t); }
    else Object.assign(t, extra);
    return t;
  }
  const replies = ['Sounds good!', 'Perfect, see you then. Fight On!', "Got it. I'll message you when I'm close.", 'Works for me 👍', 'Thanks! Let me know if anything changes.'];
  function autoReply(tid) {
    setTimeout(() => {
      const t = S.threads.find((x) => x.id === tid); if (!t) return;
      t.msgs.push({ from: 'them', text: replies[Math.floor(Math.random() * replies.length)] });
      const { route, id } = parse();
      if (!(route === 'chat' && id === tid)) t.unread = (t.unread || 0) + 1;
      save();
      if (route === 'chat' && id === tid) { render(); const th = document.getElementById('thread'); th && th.lastElementChild && th.lastElementChild.scrollIntoView({ block: 'end', behavior: 'smooth' }); }
      else renderTabbar(route);
    }, 1400);
  }

  // Saves a change to one of your listings on the server, then shows it.
  // Checkout. Sample sellers answer automatically; a real seller gets the rental request in a real chat.
  async function placeOrder(btn) {
    btn.disabled = true;
    const made = [];
    try {
      const mate = ui.splitCart ? splitMate() : null;
      for (const { c, l } of checkoutRows()) {
        const buy = modeOf(c) === 'buy';
        const where = c.handoff === 'drop' ? myLobby() : D.pickupSpots[l.hall];
        const how = c.handoff === 'drop' ? 'Could you drop it off at ' + where + '?' : "I'll pick it up at " + where + '.';
        const note = `Hi ${l.seller.split(' ')[0]}! I'd like to ${buy ? 'buy' : 'rent'} your “${nameOf(l)}”${buy ? '' : ' for ' + (c.plan === 'sem' ? 'the semester' : 'the full year')}. ${how} What time works for you?`;
        const r = await AUTH.call('/orders', { method: 'POST', body: JSON.stringify({
          listingId: l.id, kind: buy ? 'buy' : 'rent', plan: buy ? undefined : c.plan, handoff: c.handoff, note,
          splitWith: mate && !buy ? mate.id : undefined
        }) });
        putOrder(r.order);
        S.cart = S.cart.filter((x) => x.listingId !== l.id);
        save();
        made.push(r.order);
      }
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
      if (!made.length) return;
    }
    ui.now = null; ui.splitCart = false; ui.accTab = 'rent';
    refreshConvs();
    toast(made.length > 1 ? `Sent ${made.length} requests. Sellers will accept or decline.` : `Request sent. ${made[0].seller.name.split(' ')[0]} will accept or decline.`);
    location.hash = made.length === 1 ? '#/order/' + made[0].id : '#/account';
  }

  function updateMine(id, patch, done) {
    AUTH.call('/listings/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) })
      .then((r) => { putListing(r.listing); rerender(); toast(done); })
      .catch((err) => toast(err.message));
  }

  // Press ripple: a soft circle grows from where you touched a button. It lives in its own clipped layer,
  // so badges on the button (like the cart count) are never cut off. Off with "reduce motion".
  const RIPPLE = '.btn, .btn-dashed, .chip, .chip-btn, .opt, .tabs2 button, .choice, .g-redirect, .star';
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  document.addEventListener('pointerdown', (e) => {
    if (reduceMotion.matches || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const b = e.target.closest(RIPPLE);
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const wrap = document.createElement('span');
    wrap.className = 'ripple-wrap';
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    wrap.appendChild(dot);
    b.appendChild(wrap);
    dot.addEventListener('animationend', () => wrap.remove(), { once: true });
  }, { passive: true });

  app.addEventListener('click', (e) => {
    // Opening a search result counts as a search worth remembering.
    if (e.target.closest('.s-page .lcard')) rememberSearch(ui.q);
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const a = el.dataset.action, id = el.dataset.id;
    switch (a) {
      case 'back':
        if (history.length > 1 && document.referrer !== undefined && lastHash !== null && sessionStorage.getItem('ts-nav')) { e.preventDefault(); history.back(); }
        break;
      case 'hall': S.hall = id ? (S.hall === id ? null : id) : null; save(); rerender(); break;
      case 'cat': S.cat = id; save(); rerender(); break;
      case 'scroll-list': document.getElementById('listings').scrollIntoView({ behavior: 'smooth' }); break;
      case 'fav': {
        const on = !server.favorites.includes(id);
        const before = server.favorites;
        ui.justFaved = on ? id : null;
        clearTimeout(ui.favTimer); ui.favTimer = setTimeout(() => { ui.justFaved = null; }, 700);
        server.favorites = on ? [id].concat(before) : before.filter((f) => f !== id);
        rerender(); toast(on ? 'Saved to favorites' : 'Removed from favorites');
        AUTH.call('/favorites/' + encodeURIComponent(id), { method: on ? 'PUT' : 'DELETE' })
          .then((r) => { server.favorites = r.favorites; })
          .catch((err) => { server.favorites = before; rerender(); toast(err.message); });
        break;
      }
      case 'photo-idx': ui.photoIdx = Number(id); rerender(); break;
      case 'search': e.preventDefault(); ui.focusQ = true; if (parse().route === 'search') render(); else { ui.searchFrom = location.hash || '#/home'; ui.q = ''; location.hash = '#/search'; } break;
      case 'search-cancel': ui.q = ''; location.hash = ui.searchFrom && ui.searchFrom !== '#/search' ? ui.searchFrom : '#/home'; break;
      case 'search-term': ui.q = id; rememberSearch(id); render(); break;
      case 'search-forget': S.recent = (S.recent || []).filter((t) => t !== id); save(); render(); break;
      case 'search-clear': S.recent = []; save(); render(); break;
      case 'plan': ui.plan = id; rerender(); break;
      case 'hand': ui.hand = id; rerender(); break;
      case 'message': {
        const l = findListing(id);
        if (!l) break;
        if (l.sample) {
          const t = ensureThread(l.seller, l.year, { listingId: id });
          if (!t.msgs.length) t.msgs.push({ from: 'sys', text: 'You asked about ' + nameOf(l) });
          save(); location.hash = '#/chat/' + t.id; break;
        }
        el.disabled = true;
        openRealChat(l).then((c) => { location.hash = '#/chat/' + c.id; }).catch((err) => { el.disabled = false; toast(err.message); });
        break;
      }
      case 'mode': ui.mode = id; rerender(); break;
      case 'add-cart': case 'buy-now': {
        const l = findListing(id);
        if (!l) break;
        const entry = { listingId: id, mode: forSale(l) && ui.mode === 'buy' ? 'buy' : 'rent', plan: ui.plan, handoff: ui.hand };
        if (a === 'buy-now') { ui.now = entry; ui.splitCart = entry.mode === 'rent' && ui.split; location.hash = '#/checkout'; break; }
        const had = inCart(id);
        S.cart = S.cart.filter((c) => c.listingId !== id).concat(entry);
        save(); rerender(); toast(had ? 'Cart updated' : 'Added to cart · preview it in AR from Room Preview'); break;
      }
      case 'checkout-cart': ui.now = null; ui.splitCart = false; location.hash = '#/checkout'; break;
      case 'remove': S.cart = S.cart.filter((c) => c.listingId !== id); save(); rerender(); break;
      case 'place': placeOrder(el); break;
      case 'confirm': {
        const r = S.rentals.find((x) => x.id === id);
        if (r) {
          r.status = 'Active';
          const t = S.threads.find((x) => x.id === r.thread);
          if (t) t.msgs.push({ from: 'sys', text: 'Handoff confirmed · seller paid' });
          else if (r.thread) sendReal(r.thread, { event: 'confirm' }).then(() => { if (parse().id === r.thread) refreshChat(true); }).catch((err) => toast(err.message));
          save(); toast('Handoff confirmed'); rerender();
        }
        break;
      }
      case 'acc-tab': ui.accTab = id; rerender(); break;
      case 'inbox-tab': ui.inboxTab = id; rerender(); break;
      case 'order-act': {
        const act = el.dataset.act;
        if (act === 'decline' && !window.confirm('Decline this request?')) break;
        if (act === 'cancel' && !window.confirm('Cancel this request?')) break;
        el.disabled = true;
        AUTH.call(`/orders/${encodeURIComponent(id)}/${act}`, { method: 'POST' })
          .then((r) => {
            putOrder(r.order); rerender(); toast(ORDER_TOAST[act] || 'Done');
            // The listing goes off or back on the market; your chat got a new line.
            AUTH.call('/listings').then((x) => { server.listings = x.listings.map(fromServer); }).catch(() => {});
            refreshConvs();
          })
          .catch((err) => { el.disabled = false; toast(err.message); refreshOrders().then(rerender); });
        break;
      }
      case 'rate-star': {
        const oid = el.dataset.order;
        ui.rate = { text: ui.rate && ui.rate.id === oid ? ui.rate.text : '', id: oid, stars: Number(id) };
        rerender(); break;
      }
      case 'rate-send': {
        const r = ui.rate;
        if (!r || r.id !== id || !r.stars) break;
        el.disabled = true;
        AUTH.call(`/orders/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ stars: r.stars, text: r.text || '' }) })
          .then((x) => {
            putOrder(x.order); ui.rate = null; rerender(); toast('Thanks for rating');
            // Ratings show on listings: pick up the new average.
            AUTH.call('/listings').then((y) => { server.listings = y.listings.map(fromServer); }).catch(() => {});
          })
          .catch((err) => { el.disabled = false; toast(err.message); });
        break;
      }
      case 'split-pick': ui.splitWith = id; rerender(); break;
      case 'go-roommates': e.preventDefault(); location.hash = '#/account'; setTimeout(() => { const c = document.getElementById('roommates'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }, 300); break;
      case 'push-on': enablePush(el); break;
      case 'push-off': disablePush(false); break;
      case 'push-test':
        el.disabled = true;
        AUTH.call('/push/test', { method: 'POST' }).then(() => toast('Sent. It should show up in a few seconds')).catch((err) => toast(err.message)).finally(() => { el.disabled = false; });
        break;
      case 'guide-open': ui.guide = 0; break;
      case 'guide-next': ui.guide = (ui.guide || 0) + 1; rerender(); break;
      case 'guide-prev': ui.guide = Math.max(0, (ui.guide || 0) - 1); rerender(); break;
      case 'guide-done':
        try { localStorage.setItem('ts-guide-seen', '1'); } catch (x) { /* private mode */ }
        ui.guide = 0; location.hash = '#/home'; break;
      case 'rm-accept':
        el.disabled = true;
        AUTH.call('/roommates/' + encodeURIComponent(id) + '/accept', { method: 'POST' })
          .then((r) => { setRoommates(r.roommates); rerender(); toast('You are roommates now'); })
          .catch((err) => { el.disabled = false; toast(err.message); refreshRoommates(); });
        break;
      case 'rm-remove': {
        const kind = el.dataset.kind;
        if (kind === 'remove' && !window.confirm('Remove this roommate?')) break;
        el.disabled = true;
        AUTH.call('/roommates/' + encodeURIComponent(id), { method: 'DELETE' })
          .then((r) => { setRoommates(r.roommates); rerender(); toast(kind === 'decline' ? 'Invite declined' : (kind === 'cancel' ? 'Invite canceled' : 'Roommate removed')); })
          .catch((err) => { el.disabled = false; toast(err.message); refreshRoommates(); });
        break;
      }
      case 'pause': updateMine(id, { status: 'paused' }, 'Hidden from other students'); break;
      case 'resume': updateMine(id, { status: 'available' }, 'Other students can see it again'); break;
      case 'delete-listing':
        if (window.confirm('Delete this listing and its photos? This can’t be undone.')) {
          el.disabled = true;
          AUTH.call('/listings/' + encodeURIComponent(id), { method: 'DELETE' })
            .then(() => {
              server.listings = server.listings.filter((l) => l.id !== id);
              server.favorites = server.favorites.filter((f) => f !== id);
              toast('Listing deleted');
              if (location.hash === '#/account') rerender(); else location.hash = '#/account';
            })
            .catch((err) => { el.disabled = false; toast(err.message); });
        }
        break;
      case 'retry-load': loadServer().then(rerender); rerender(); break;
      case 'room-tab': ui.roomTab = id; rerender(); break;
      case 'ar-pick': ui.arPick = id; rerender(); break;
      case 'sell-cat': formDraft().cat = id; rerender(); break; // same categories as the Home chips
      case 'ar-desk': toast('Open TroShare on your iPhone to use the camera'); break;
      case 'residence': location.hash = '#/profile'; break;
      case 'sample-data':
        if (window.confirm('Replace your rentals and sample-seller chats on this device with sample activity?')) {
          S = D.sampleState(D.me.first, hallById(D.me.hall).name); save(); location.hash = '#/home'; render(); toast('Sample activity loaded');
        }
        break;
      case 'reset':
        if (window.confirm('Clear your rentals, cart and sample-seller chats on this device?')) { S = D.emptyState(); save(); location.hash = '#/home'; render(); toast('Activity cleared'); }
        break;
      case 'logout':
        // This device stops getting the old account's notifications.
        disablePush(true).finally(() => { ui.push = null; if (window.TS_INTRO) window.TS_INTRO.logout(); });
        break;
      case 'analyze': analyzeRoom(); break;
      case 'rm-room': {
        const [gone] = room.photos.splice(Number(id), 1);
        if (gone === room.sample) room.sample = null;
        rerender(); break;
      }
      case 'sample-room':
        loadImage(SAMPLE_ROOM).then((img) => {
          const url = toJpeg(img, 1568, 0.82);
          room.photos.push(url); room.sample = url; fit.idx = room.photos.length - 1; rerender();
        }).catch(() => toast("Couldn't load the sample room"));
        break;
      case 'fit-photo': fit.idx = Number(id); rerender(); break;
      case 'fit-flip': fit.flip = !fit.flip; applyFit(); break;
      case 'fit-rotate': fit.rot += 15; applyFit(); break;
      case 'fit-reset': { const l = findListing(id); if (l) { resetFit(l, id); applyFit(); } break; }
      case 'fit-rent': { // "Rent" from an AR or room preview: straight to checkout for this one item
        const l = findListing(id);
        if (!l) break;
        ui.now = { listingId: id, mode: 'rent', plan: 'sem', handoff: l.handoff === 'pickup' ? 'pick' : 'drop' };
        ui.splitCart = false; location.hash = '#/checkout'; break;
      }
      case 'browse-type': ui.q = D.types[id].name; ui.searchFrom = location.hash; S.cat = 'all'; save(); location.hash = '#/search'; break;
      case 'cond': formDraft().condition = id; rerender(); break;
      case 'rm-photo': {
        const d = formDraft();
        d.photos.splice(Number(id), 1);
        if (d === ui.draft && !d.photos.length && d.ai) { d.ai = null; d.aiSeq = (d.aiSeq || 0) + 1; }
        rerender(); scheduleCheck(d); break;
      }
      case 'edit-listing': ui.edit = null; ui.editBack = location.hash || '#/account'; location.hash = '#/edit/' + encodeURIComponent(id); break;
      case 'ar-toggle': ui.draft.ar = !ui.draft.ar; rerender(); break;
      case 'easy-mode':
        ui.draft.easy = id === 'easy';
        if (ui.draft.easy && ui.draft.photos.length && !ui.draft.easyEdit && (!ui.draft.ai || !['done', 'busy'].includes(ui.draft.ai.status))) runDraft(ui.draft); else rerender();
        break;
      case 'easy-change': ui.draft.easyEdit = true; rerender(); { const t = document.getElementById('f-title'); if (t) t.focus(); } break;
      case 'easy-retry': ui.draft.easyEdit = false; runDraft(ui.draft); break;
      case 'more-toggle': ui.draft.moreOpen = !ui.draft.moreOpen; rerender(); break;
      case 'housing-retry': runCheck(formDraft()); break;
      case 'review-confirm': {
        const l = findListing(id);
        const picked = ui.reviewConfirm && ui.reviewConfirm.id === id ? ui.reviewConfirm.rules : [];
        if (!l || !l.housingReview) break;
        const missing = l.housingReview.items.filter((x) => !picked.includes(x.rule));
        if (missing.length) { toast('Tick the box first: ' + missing[0].confirm); break; }
        updateMine(id, { housingConfirmed: picked }, 'Thanks, confirmed');
        break;
      }
      case 'ar-start':
        el.disabled = true;
        AUTH.call('/listings/' + encodeURIComponent(id) + '/ar-model', { method: 'POST' })
          .then((r) => { putListing(r.listing); rerender(); toast('Building your AR model. You can keep browsing.'); })
          .catch((err) => { el.disabled = false; toast(err.message); });
        break;
      case 'ar-activate': {
        const mv = document.getElementById('ar-model');
        if (!mv || !mv.src) { toast('The 3D model is still loading'); break; }
        if (mv.canActivateAR) mv.activateAR(); else toast("This browser can't open AR. Try Safari on iPhone or Chrome on Android.");
        break;
      }
    }
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    const k = el.dataset.input;
    // The split switches have no data-input, so check them first.
    if (el.dataset.action === 'split') { ui.split = el.checked; rerender(); return; }
    if (el.dataset.action === 'split-cart') { ui.splitCart = el.checked; rerender(); return; }
    if (!k) return;
    if (k === 'sort') { ui.sort = el.value; rerender(); return; }
    if (k === 'room-photo') { addRoomFiles(el.files); return; }
    if (k === 'review-confirm') { // on a listing page, not the List form
      const lid = el.dataset.id, rule = el.dataset.rule;
      const cur = ui.reviewConfirm && ui.reviewConfirm.id === lid ? ui.reviewConfirm.rules : [];
      ui.reviewConfirm = { id: lid, rules: cur.filter((r) => r !== rule).concat(el.checked ? [rule] : []) };
      return;
    }
    const d = formDraft();
    if (!d) return;
    if (k === 'photo') {
      const f = el.files && el.files[0];
      if (f && d.photos.length < MAX_LISTING_PHOTOS) compress(f).then((url) => {
        d.photos.push(url);
        const easy = d === ui.draft && d.easy !== false;
        if (easy && !d.easyEdit && (!d.ai || d.ai.status !== 'done')) runDraft(d); else { rerender(); scheduleCheck(d); }
      }).catch(() => toast("Couldn't read that photo"));
      return;
    }
    if (k === 'drop' || k === 'pick') { d[k] = el.checked; return; }
    if (k === 'housing-confirm') {
      const rule = el.dataset.rule;
      d.housingConfirmed = (d.housingConfirmed || []).filter((r) => r !== rule).concat(el.checked ? [rule] : []);
      return;
    }
    if (k === 'sell') { d.sell = el.checked; rerender(); if (d.sell) { const b = document.getElementById('f-buy'); if (b && !b.value) b.focus(); } return; }
  });

  app.addEventListener('input', (e) => {
    const el = e.target, k = el.dataset.input;
    if (k === 'q') {
      ui.q = el.value;
      const pos = el.selectionStart;
      render();
      const n = app.querySelector('[data-input="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) { /* ignore */ } }
      return;
    }
    if (k === 'fit-size') { fit.size = Number(el.value) / 100; applyFit(); return; }
    const fd = formDraft();
    if (k === 'rm-email') { ui.rmEmail = el.value; return; }
    if (k === 'rate-text') { const oid = el.dataset.order; ui.rate = { stars: ui.rate && ui.rate.id === oid ? ui.rate.stars : 0, id: oid, text: el.value }; return; }
    if (k === 'hall-q') { // filters the hall list in place, without redrawing the form
      const q = el.value.trim().toLowerCase();
      let shown = 0;
      app.querySelectorAll('.choice[data-q]').forEach((c) => { c.hidden = !!q && !c.dataset.q.includes(q) && !c.querySelector('input').checked; if (!c.hidden) shown++; });
      const none = app.querySelector('[data-hall-none]'); if (none) none.hidden = shown > 0;
      return;
    }
    if (fd && (k === 'title' || k === 'sem' || k === 'year1' || k === 'buy')) fd[k] = el.value;
    if (fd && k === 'title') scheduleCheck(fd, 1500);
  });

  // Return / the blue Search key saves the search and closes the keyboard.
  app.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.input === 'q') { e.preventDefault(); rememberSearch(e.target.value); e.target.blur(); }
  });
  app.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === 'profile') {
      const year = f.elements.year.value, hall = f.elements.hall.value;
      if (!year || !hall) return toast('Choose your class year and hall');
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      const firstTime = AUTH.needsSetup();
      AUTH.saveProfile({ year, hall })
        .then(() => { applyUser(); if (firstTime) { ui.guide = 0; location.hash = '#/guide'; } else if (parse().route === 'profile') location.hash = '#/account'; render(); toast(firstTime ? 'You are all set' : 'Profile saved'); })
        .catch((err) => { btn.disabled = false; toast(err.message); });
      return;
    }
    if (f.dataset.form === 'roommate') {
      const email = (ui.rmEmail || f.elements.email.value || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.edu$/.test(email)) return toast("Enter your roommate's .edu email");
      if (ui.rmBusy) return;
      ui.rmBusy = true; rerender();
      AUTH.call('/roommates', { method: 'POST', body: JSON.stringify({ email }) })
        .then((r) => {
          const accepted = r.roommates.some((x) => x.email === email && x.status === 'accepted');
          setRoommates(r.roommates); ui.rmEmail = ''; ui.rmBusy = false; rerender();
          toast(accepted ? 'You are roommates now' : 'Invite sent');
        })
        .catch((err) => { ui.rmBusy = false; rerender(); toast(err.message); });
      return;
    }
    if (f.dataset.form === 'chat') {
      const input = f.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      const tid = f.dataset.id;
      if (/^c[0-9a-f]{16}$/.test(tid)) {
        input.value = '';
        sendReal(tid, { text })
          .then(() => { if (parse().id === tid) refreshChat(true); })
          .catch((err) => { toast(err.message); if (parse().id === tid) { refreshChat(true); const n = app.querySelector('#msg'); if (n && !n.value) n.value = text; } });
        refreshChat(true);
        return;
      }
      const t = S.threads.find((x) => x.id === tid);
      t.msgs.push({ from: 'me', text });
      save(); render();
      scrollThreadEnd();
      const n = app.querySelector('#msg'); n && n.focus();
      autoReply(t.id);
      return;
    }
    if (f.dataset.form === 'edit') {
      const d = ui.edit, l = findListing(d.id);
      if (!l) return toast('This listing is gone');
      const title = d.title.trim(), sem = Math.round(Number(d.sem)), yr = Math.round(Number(d.year1)) || Math.round(sem * 1.8);
      if (!title) return toast('Add a title');
      if (!(sem > 0)) return toast('Add a price per semester');
      if (!d.drop && !d.pick) return toast('Choose at least one handoff option');
      if (d.busy) return;
      // Only what changed, so untouched fields (like an older "New, sealed" condition) stay as they are.
      const patch = {};
      if (title !== l.title) patch.title = title;
      const type = d.cat !== catOf(l) || title !== l.title ? typeFor(d.cat, title) : l.type;
      if (type !== l.type) patch.type = type;
      if (d.condition !== l.condition) patch.condition = d.condition;
      if (sem !== l.sem) patch.sem = sem;
      if (yr !== l.year1) patch.year1 = yr;
      const handoff = d.drop && d.pick ? 'both' : (d.drop ? 'drop' : 'pickup');
      if (handoff !== l.handoff) patch.handoff = handoff;
      const buy = d.sell ? Math.round(Number(d.buy)) : null;
      if (d.sell && !(buy > 0)) return toast('Add a sale price');
      if (!!d.sell !== !!l.openToSell || (d.sell && buy !== l.buyPrice)) { patch.openToSell = !!d.sell; if (d.sell) patch.buyPrice = buy; }
      if (photosChanged(d, l)) patch.photos = d.photos.map((u) => (u.startsWith('data:') ? { data: u.split(',')[1] } : { key: u.split('/').pop() }));
      if (patch.photos || patch.title) patch.housingConfirmed = d.housingConfirmed || [];
      const back = d.back;
      if (!Object.keys(patch).length) { ui.edit = null; location.hash = back; return toast('No changes'); }
      d.busy = true; rerender();
      AUTH.call('/listings/' + encodeURIComponent(d.id), { method: 'PATCH', body: JSON.stringify(patch) })
        .then((r) => { putListing(r.listing); ui.edit = null; toast(patch.photos && r.listing.ar && r.listing.ar.status === 'in_progress' ? 'Saved. Rebuilding your AR model…' : 'Saved'); location.hash = back; })
        .catch((err) => { d.busy = false; housingRejected(d, err); rerender(); toast(err.message); });
      return;
    }
    if (f.dataset.form === 'sell') {
      const d = ui.draft;
      if (d.ai && d.ai.status === 'busy') return toast('Wait a moment: Claude is still filling it in');
      if (d.check && d.check.status === 'busy' && checkFresh(d)) return toast('Wait a moment: checking USC Housing rules');
      { const why = housingBlocker(d); if (why) return toast(why); }
      const sem = Math.round(Number(d.sem)), yr = Math.round(Number(d.year1)) || Math.round(sem * 1.8);
      if (!d.title.trim()) return toast('Add a title');
      if (!(sem > 0)) return toast('Add a price per semester');
      if (!d.drop && !d.pick) return toast('Choose at least one handoff option');
      const buy = d.sell ? Math.round(Number(d.buy)) : null;
      if (d.sell && !(buy > 0)) return toast('Add a sale price');
      if (d.busy) return;
      d.busy = true; rerender();
      AUTH.call('/listings', {
        method: 'POST',
        body: JSON.stringify({
          type: typeFor(d.cat, d.title), title: d.title.trim(), condition: d.condition, sem, year1: yr,
          ...housingPayload(d),
          handoff: d.drop && d.pick ? 'both' : (d.drop ? 'drop' : 'pickup'), openToSell: d.sell, buyPrice: buy, generateAr: !!(d.ar && d.photos.length),
          photos: d.photos.map((url) => url.split(',')[1])
        })
      }).then((r) => {
        const l = putListing(r.listing);
        ui.draft = null;
        toast('Published! Other USC students can see it now');
        location.hash = '#/item/' + l.id;
      }).catch((err) => { d.busy = false; housingRejected(d, err); rerender(); toast(err.message); });
    }
  });

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.crossOrigin = 'anonymous'; // listing photos come from the TroShare server; the cutout reads their pixels
      img.src = src;
    });
  }
  function toJpeg(img, max, quality) {
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  }
  function compress(file, max = 640, quality = 0.78) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = reject;
      r.onload = () => loadImage(r.result).then((img) => resolve(toJpeg(img, max, quality)), reject);
      r.readAsDataURL(file);
    });
  }

  // Fetches listings, favorites and the profile (which may have changed on another device), then redraws.
  function syncFromServer() {
    return loadServer().then(() => {
      if (!AUTH.signedIn()) return;
      applyUser();
      rerender();
    });
  }
  window.addEventListener('hashchange', () => {
    sessionStorage.setItem('ts-nav', '1');
    render();
    // Coming back to Home or My Account after a minute picks up new listings from other students.
    const r = parse().route;
    if ((r === 'home' || r === 'account') && Date.now() - server.at > 60000) syncFromServer();
    else if (r === 'account') refreshRoommates();
    if (r === 'inbox') { refreshConvs(); refreshNotes(); }
    if (r === 'order' || r === 'account') refreshOrders();
  });
  // Signing in or out switches whose data is shown.
  const switchUser = () => {
    Object.assign(server, { listings: [], favorites: [], convs: [], msgs: {}, roommates: [], orders: [], ordersLoaded: false, notes: [], unreadNotes: 0, rating: null, loaded: false, error: null, at: 0 });
    applyUser(); S = load(); ui.draft = null; room.analysis = null; render();
    if (AUTH.signedIn()) syncFromServer();
  };
  window.addEventListener('ts-signed-in', switchUser);
  window.addEventListener('ts-signed-out', switchUser);
  applyUser();
  S = load();
  render();
  // Also checks that the saved session is still valid (a 401 signs out via ts-signed-out).
  if (AUTH.signedIn()) syncFromServer();

  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    document.body.classList.add('native-app');
  }
  const deviceTime = document.getElementById('device-time');
  if (deviceTime) {
    const tick = () => {
      deviceTime.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };
    tick();
    setInterval(tick, 15000);
  }

  checkPush().then(() => { const r = parse().route; if (r === 'account' || r === 'inbox') rerender(); });
  // Tapping a notification while TroShare is open: the service worker asks us to go to its screen.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open' && typeof e.data.url === 'string' && e.data.url.startsWith('#/')) location.hash = e.data.url;
    });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // When a new version takes over an already-open page, reload once so it shows right away.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then((reg) => reg.update())
        .catch(() => {});
    });
  }
})();
