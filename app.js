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
  const ui = { plan: 'sem', hand: null, split: false, itemId: null, photoIdx: 0, accTab: 'rent', roomTab: 'ar', arType: null, q: '', sort: 'near', splitCart: false, draft: null };

  // Data on the TroShare server: every student's listings, your favorites, and your chats with other
  // students (msgs holds the loaded messages of each chat, by chat id).
  const server = { listings: [], favorites: [], convs: [], msgs: {}, loaded: false, loading: false, error: null, at: 0 };
  const MAX_LISTING_PHOTOS = 4;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
  const hallById = (id) => D.halls.find((h) => h.id === id);
  const typeOf = (l) => D.types[l.type];
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
      // ~0.24 minutes per map unit matches the walking times shown in the design.
      h.mins = h.home ? 0 : Math.max(2, Math.round(Math.hypot(h.left - home.left, h.top - home.top) * 0.24));
      h.walk = h.home ? 'Your hall' : `~${h.mins} min walk`;
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
      rating: null, rentals: 0, owner: x.mine ? 'me' : 'other', status: x.status, openToSell: x.openToSell, createdAt: x.createdAt,
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
  async function loadServer() {
    if (!AUTH.signedIn() || server.loading) return;
    server.loading = true; server.error = null;
    try {
      const [l, me, c] = await Promise.all([AUTH.call('/listings'), AUTH.refresh(), AUTH.call('/conversations')]);
      server.listings = l.listings.map(fromServer);
      server.favorites = (me && me.favorites) || [];
      server.convs = c.conversations;
      server.loaded = true; server.at = Date.now();
    } catch (err) {
      server.error = err.message;
      clearTimeout(server.retry);
      server.retry = setTimeout(() => { if (server.error) loadServer().then(() => { if (server.loaded) rerender(); }); }, 20000);
    } finally {
      server.loading = false;
    }
  }
  // Back online, or back in the app after switching away: try again if the last load failed.
  const retryQuietly = () => { if (server.error && !server.loading) loadServer().then(() => { if (server.loaded) rerender(); }); };
  window.addEventListener('online', retryQuietly);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retryQuietly(); });
  // Real listings first, then the built-in samples that show how TroShare works.
  function market() {
    return server.listings.filter((l) => l.status === 'available').concat(D.listings);
  }
  function findListing(id) {
    return server.listings.find((x) => x.id === id) || D.listings.find((x) => x.id === id) || null;
  }
  const myListings = () => server.listings.filter((l) => l.owner === 'me');
  function activeRentalFor(listingId) {
    return S.rentals.find((r) => r.listingId === listingId && r.status !== 'Returned');
  }
  function unreadCount() {
    return S.threads.reduce((n, t) => n + (t.unread || 0), 0) + server.convs.reduce((n, c) => n + (c.unread || 0), 0);
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
      return `<header class="topbar"><span class="spacer44"></span><a class="wordmark" href="#/home">TROSHARE</a><span class="spacer44"></span></header>`;
    }
    return `<header class="topbar">${backHref ? `<a class="icon-btn" href="${backHref}" data-action="back" aria-label="Back">${I.back}</a>` : '<span class="spacer44"></span>'}<h1>${esc(title)}</h1><span class="spacer44"></span></header>`;
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
      <div class="gold"></div>
      <div class="body">
        <span class="name">${esc(nameOf(l))}</span>
        <span class="price">${money(l.sem)}<small> /semester</small></span>
        <span class="meta">${esc(l.seller)} · ${esc(l.year)}${l.owner === 'me' ? ' (you)' : ''}${l.sample ? ' · Sample' : ''}</span>
        <span class="where">${I.pin}${esc(h.name)} · ${esc(h.walk)}</span>
        <span class="cta">${l.owner === 'me' ? 'Your listing' : 'See details'}</span>
      </div></a>`;
  }

  function renderTabbar(route) {
    const tabs = [
      ['home', '#/home', I.home, 'Home'], ['room', '#/room', I.sparkle, 'Room Preview'], ['sell', '#/sell', I.plus, 'List'],
      ['inbox', '#/inbox', I.chat, 'Inbox'], ['account', '#/account', I.user, 'Account']
    ];
    const active = { browse: 'home', search: 'home', item: 'home', checkout: 'home', chat: 'inbox', fit: 'room', ar: 'room' }[route] || route;
    const n = unreadCount();
    const prev = tabbar.querySelector('a.on')?.getAttribute('href');
    tabbar.innerHTML = tabs.map(([id, href, icon, label]) =>
      `<a href="${href}" class="${active === id ? 'on' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon}${label}${id === 'inbox' && n ? `<span class="dot" aria-label="${n} unread">${n}</span>` : ''}</a>`
    ).join('');
    const now = tabbar.querySelector('a.on');
    if (now && now.getAttribute('href') !== prev) now.classList.add('pop');
  }

  /* ---------- screens ---------- */
  function homeScreen() {
    const all = market();
    const cur = S.hall ? hallById(S.hall) : null;
    const count = (id) => all.filter((l) => l.hall === id).length;
    // Browse lives on Home: the map's hall, the category chips and the search box all narrow one list.
    let items = all.filter((l) => (!cur || l.hall === cur.id) && (S.cat === 'all' || catOf(l) === S.cat));
    const firstType = (l) => (l.type === 'micro' ? 0 : 1); // the microwave leads the samples
    const order = ui.sort === 'price' ? (a, b) => firstType(a) - firstType(b) || a.sem - b.sem : (a, b) => firstType(a) - firstType(b) || hallById(a.hall).mins - hallById(b.hall).mins || a.sem - b.sem;
    // Every real listing from other students comes first (your own are in My Account). Samples fill in
    // one card per kind of item, only for kinds nobody has listed yet.
    const real = items.filter((l) => !l.sample && l.owner !== 'me').sort(order);
    const seenTypes = new Set(real.map((l) => l.type));
    items = real.concat(items.filter((l) => l.sample).sort(order).filter((l) => !seenTypes.has(l.type) && seenTypes.add(l.type)));
    const title = cur ? 'At ' + cur.name : 'Browse listings';
    const n = cur ? count(cur.id) : 0;
    const pill = cur ? (cur.home ? `${n} listings in your building` : `${n} listings at ${cur.name} · ${cur.walk}`) : 'Tap a hall to see what Trojans there are renting out';
    const next = S.rentals.find((r) => r.status === 'Scheduled');
    const nl = next && findListing(next.listingId);
    // No error banner: the sample listings always show, and students' listings are retried quietly in the background.
    const status = '';

    return `${topbar()}
    <section class="hero">
      <p class="eyebrow">Student-to-student rentals</p>
      <h2 class="hero-title">TroShare</h2>
    </section>
    <div class="map">
      <img src="images/map.jpg" alt="Map of USC Housing buildings around the University Park campus">
      ${D.halls.map((h) => `<button type="button" class="pin ${h.home ? 'home' : ''} ${S.hall === h.id ? 'on' : ''}" style="left:${h.left}%;top:${h.top}%" data-action="hall" data-id="${h.id}" aria-pressed="${S.hall === h.id}" aria-label="${esc(h.name)}, ${count(h.id)} listings${h.home ? ', your hall' : ''}">${h.home ? I.home : ''}<span class="count">${count(h.id)}</span>${esc(h.label)}</button>`).join('')}
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
      const items = market().filter((l) => l.owner !== 'me' && (nameOf(l) + ' ' + typeOf(l).name + ' ' + D.categories.find((c) => c.id === catOf(l))?.label + ' ' + l.seller + ' ' + hallById(l.hall).name).toLowerCase().includes(q));
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
    if (st === 'in_progress') return `<div class="callout">${I.sparkle}<span><b>AR: In progress.</b> Claude is building a 3D model from your photos. It usually takes under a minute; you can leave this page.</span></div>`;
    if (st === 'success') return `<div class="callout">${I.check}<span><b>AR: Success.</b> Students can place your item in their room with AR Preview.</span></div>`;
    if (st === 'failed') return `<div class="callout">${I.shield}<span><b>AR: Failed.</b> ${esc(l.ar.error)}</span></div><button type="button" class="btn btn-outline btn-small ar-gen" data-action="ar-start" data-id="${esc(l.id)}">${I.sparkle}Try AI Generate AR model again</button>`;
    return has ? `<button type="button" class="btn btn-outline btn-small ar-gen" data-action="ar-start" data-id="${esc(l.id)}">${I.sparkle}AI Generate AR model</button>` : '';
  }

  function itemScreen(id) {
    const l = findListing(id);
    if (!l) return `${topbar('Listing', '#/home')}<p class="empty">${server.loaded ? 'This listing is gone.' : 'Loading…'}</p>`;
    if (ui.itemId !== id) {
      ui.itemId = id; ui.photoIdx = 0; ui.plan = 'sem'; ui.split = false;
      ui.hand = l.handoff === 'pickup' ? 'pick' : 'drop';
      S.viewed = [id].concat(S.viewed.filter((v) => v !== id)).slice(0, 8); save();
    }
    const h = hallById(l.hall);
    const mine = l.owner === 'me';
    const renting = activeRentalFor(id);
    const fav = server.favorites.includes(id);
    const canDrop = l.handoff !== 'pickup', canPick = l.handoff !== 'drop';
    const amt = ui.plan === 'sem' ? l.sem : l.year1;
    const pay = ui.split ? amt / 2 : amt;
    const photos = l.photos && l.photos.length ? l.photos : [imgOf(l)];
    const shown = photos[Math.min(ui.photoIdx, photos.length - 1)];
    return `${topbar(nameOf(l), '#/home')}
    <div class="photo"><img src="${esc(shown)}" alt="${esc(nameOf(l))}, the seller's actual item"><span class="badge">${esc(l.condition)}</span>
      ${arSlot(l, mine)}
      ${mine ? '' : `<button type="button" class="icon-btn" data-action="fav" data-id="${esc(id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from' : 'Add to'} favorites" style="position:absolute;top:8px;left:8px;color:var(--cardinal)">${I.heart(fav)}</button>`}</div>
    ${photos.length > 1 ? `<div class="hscroll" style="padding:10px 16px 0">${photos.map((src, i) => `<button type="button" class="thumb photo-pick ${src === shown ? 'on' : ''}" data-action="photo-idx" data-id="${i}" aria-label="Photo ${i + 1}" aria-pressed="${src === shown}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
    <section class="section">
      <div><h2 class="serif" style="margin:0;font-size:26px">${esc(nameOf(l))}</h2><p class="sub" style="margin:4px 0 0">${esc(typeOf(l).blurb)}</p></div>
      <div class="card pad row">
        <span class="${avClass(l.seller)}">${esc(initial(l.seller))}</span>
        <span class="grow"><span class="row" style="gap:6px;font-weight:700">${esc(l.seller)}${mine ? ' (you)' : ''} ${I.verified}</span>
          <span class="meta">${esc(l.year)} · Verified USC student · ${stars(l)}${l.rentals ? ' · ' + l.rentals + ' rentals' : ''}</span>
          <span class="where">${I.pin}${esc(h.name)} · ${esc(h.walk)}</span></span>
        ${mine ? '' : `<button type="button" class="btn btn-outline btn-small" data-action="message" data-id="${esc(id)}">Message</button>`}
      </div>
      ${mine ? `<div class="callout">${I.shield}<span>${l.status === 'paused' ? '<b>Hidden.</b> Other students can’t see this listing until you show it again.' : 'This is your listing. It\'s visible to verified USC students. Manage it from <a href="#/account">My Account</a>.'}</span></div>
      <div class="row" style="gap:8px">
        ${l.status === 'paused'
          ? `<button type="button" class="btn btn-cardinal btn-small" style="flex:1" data-action="resume" data-id="${esc(id)}">Show it again</button>`
          : `<button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="pause" data-id="${esc(id)}">Hide for now</button>`}
        <button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="delete-listing" data-id="${esc(id)}">Delete</button>
      </div>
      ${arOwnerPanel(l)}` : `      <span class="label">Rental length</span>
      <div class="opts" role="radiogroup" aria-label="Rental length">
        <button type="button" role="radio" class="opt ${ui.plan === 'sem' ? 'on' : ''}" aria-checked="${ui.plan === 'sem'}" data-action="plan" data-id="sem"><span><span class="t">Semester · <span style="color:var(--cardinal)">${money(l.sem)}</span></span><span class="n">Move-in to move-out</span></span></button>
        <button type="button" role="radio" class="opt ${ui.plan === 'yr' ? 'on' : ''}" aria-checked="${ui.plan === 'yr'}" data-action="plan" data-id="yr"><span><span class="t">Full year · <span style="color:var(--cardinal)">${money(l.year1)}</span></span><span class="n">Fall + spring · save ${money(l.sem * 2 - l.year1)}</span></span></button>
      </div>
      <span class="label">Handoff</span>
      <div class="opts" role="radiogroup" aria-label="Handoff">
        <button type="button" role="radio" class="opt ${ui.hand === 'drop' ? 'on' : ''}" aria-checked="${ui.hand === 'drop'}" data-action="hand" data-id="drop" ${canDrop ? '' : 'disabled'}>${I.truck}<span><span class="t">Delivered</span><span class="n">${canDrop ? 'To your hall lobby' : 'Not offered'}</span></span></button>
        <button type="button" role="radio" class="opt ${ui.hand === 'pick' ? 'on' : ''}" aria-checked="${ui.hand === 'pick'}" data-action="hand" data-id="pick" ${canPick ? '' : 'disabled'}>${I.pin}<span><span class="t">Pickup</span><span class="n">${canPick ? esc(D.pickupSpots[l.hall]) : 'Not offered'}</span></span></button>
      </div>
      <label class="switch-row"><span><span style="font-weight:600;display:block">Split with my roommate</span><span class="meta">They get an invite to pay half</span></span><input type="checkbox" data-action="split" ${ui.split ? 'checked' : ''}></label>`}
    </section>
    ${mine ? '' : `<div class="paybar">
      <div class="row"><div style="display:flex;flex-direction:column"><span class="big-price">${money(pay)}</span><span class="meta">${ui.split ? 'your half, ' : ''}${ui.plan === 'sem' ? 'per semester' : 'per year'}</span></div>
      ${renting ? `<a class="btn btn-outline" href="#/chat/${renting.thread}" style="flex:1">You're renting this</a>` : `<button type="button" class="btn btn-cardinal" style="flex:1" data-action="rent" data-id="${esc(id)}">Rent</button>`}</div>
      <span class="note">Pick a time with ${esc(l.seller.split(' ')[0])} in chat. Payment is held until you get it.</span>
    </div>`}`;
  }

  function checkoutScreen() {
    const rows = S.cart.map((c) => ({ c, l: findListing(c.listingId) })).filter((x) => x.l);
    if (!rows.length) {
      return `${topbar('Checkout', '#/home')}<div class="empty"><p>Nothing to check out yet.</p><a class="btn btn-cardinal" href="#/browse" style="max-width:280px;margin:0 auto">Browse listings</a></div>`;
    }
    const total = rows.reduce((n, { c, l }) => n + (c.plan === 'sem' ? l.sem : l.year1), 0);
    const pay = ui.splitCart ? total / 2 : total;
    return `${topbar('Checkout', '#/home')}
    <section class="section">
      ${rows.map(({ c, l }) => {
        const amt = c.plan === 'sem' ? l.sem : l.year1;
        return `<div class="card pad" style="display:flex;flex-direction:column;gap:12px">
          <div class="row"><span class="${avClass(l.seller)} sm" style="width:32px;height:32px">${esc(initial(l.seller))}</span><span class="grow"><span class="row" style="gap:6px;font-weight:700">From ${esc(l.seller)} · ${esc(l.year)} ${I.verified}</span></span><span class="meta">${stars(l)}</span></div>
          <div class="row"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">${c.plan === 'sem' ? '1 Semester' : 'Full year'}</span></span><span style="font-weight:700">${money(amt)}</span></div>
          <div class="row" style="justify-content:space-between"><span class="meta"><b>${c.handoff === 'drop' ? 'Delivered' : 'Pickup'}</b> · ${c.handoff === 'drop' ? esc(myLobby()) : esc(D.pickupSpots[l.hall])}</span><button type="button" class="link" data-action="remove" data-id="${l.id}" style="font-size:13px">Remove</button></div>
        </div>`;
      }).join('')}
      <div class="card pad" style="display:flex;flex-direction:column;gap:8px">
        <label class="switch-row"><span><span style="font-weight:600;display:block">Split with my roommate</span><span class="meta">Invite sent to their USC email</span></span><input type="checkbox" data-action="split-cart" ${ui.splitCart ? 'checked' : ''}></label>
        <div class="callout">${I.shield}<span>Sellers are paid only after you tap <b>“Got it”</b> at handoff. Snap a condition photo then, and again when you return it.</span></div>
      </div>
    </section>
    <div class="paybar">
      <div class="row" style="justify-content:space-between"><span style="font-weight:600">${ui.splitCart ? 'You pay (half)' : 'Total'}</span><span class="big-price">${money(pay)}</span></div>
      <button type="button" class="btn btn-cardinal" data-action="place">Rent ${rows.length} item${rows.length > 1 ? 's' : ''}</button>
    </div>`;
  }

  function sellScreen() {
    const d = ui.draft || (ui.draft = { photos: [], type: 'bean', title: D.types.bean.name, condition: 'Like new', sem: '', year1: '', drop: true, pick: true, sell: false });
    const conds = ['New', 'Like new', 'Good'];
    return `${topbar('List an item')}
    <form class="section" data-form="sell" novalidate>
      <div class="field"><span class="label">Photos</span>
        <div class="photos">
          ${d.photos.map((p, i) => `<div class="photo-slot"><img src="${p}" alt="Photo ${i + 1}"><button type="button" class="x" data-action="rm-photo" data-id="${i}" aria-label="Remove photo ${i + 1}">✕</button></div>`).join('')}
          ${d.photos.length < MAX_LISTING_PHOTOS ? `<label class="photo-slot add">${I.camera}Add photo<input type="file" accept="image/*" class="sr-only" data-input="photo"></label>` : ''}
        </div>
        <span class="meta">Up to ${MAX_LISTING_PHOTOS} photos of the actual item. No photo? We'll show a stock picture.</span>
      </div>
      <div class="field">
        <button type="button" class="btn ${d.ar && d.photos.length ? 'btn-cardinal' : 'btn-outline'} ar-gen" data-action="ar-toggle" aria-pressed="${!!(d.ar && d.photos.length)}" ${d.photos.length ? '' : 'disabled'}>${I.sparkle}AI Generate AR model${d.ar && d.photos.length ? ' · On' : ''}</button>
        <span class="meta">${!d.photos.length ? 'Add a photo first. Claude builds the AR model from your photos.'
          : d.ar ? "After you publish, Claude builds a 3D model from your photos in the background, usually in under a minute. You don't have to wait: the listing goes live right away and shows the model's progress."
          : 'Let Claude turn your photos into a 3D model, so students can place your item in their room with AR.'}</span>
      </div>
      <div class="field"><span class="label">Category</span>
        <div class="chips" role="radiogroup" aria-label="Category">${D.categories.filter((c) => c.id !== 'all').map((c) => `<button type="button" role="radio" class="chip ${D.types[d.type].cat === c.id ? 'on' : ''}" aria-checked="${D.types[d.type].cat === c.id}" data-action="sell-cat" data-id="${c.id}">${esc(c.label)}</button>`).join('')}</div></div>
      <div class="field"><label for="f-type">Item</label>
        <select id="f-type" class="input" data-input="type">${Object.entries(D.types).filter(([, t]) => t.cat === D.types[d.type].cat).map(([k, t]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="f-title">Title</label><input id="f-title" class="input" data-input="title" value="${esc(d.title)}" maxlength="40"></div>
      <div class="field"><span class="label">Condition</span>
        <div class="pills" role="radiogroup" aria-label="Condition">${conds.map((c) => `<button type="button" role="radio" class="pill ${d.condition === c ? 'on' : ''}" aria-checked="${d.condition === c}" data-action="cond" data-id="${c}">${c}</button>`).join('')}</div></div>
      <div class="row" style="gap:10px">
        <div class="field" style="flex:1"><label for="f-sem">Per semester ($)</label><input id="f-sem" class="input" type="number" inputmode="numeric" min="1" data-input="sem" value="${esc(d.sem)}" placeholder="27"></div>
        <div class="field" style="flex:1"><label for="f-yr">Full year ($)</label><input id="f-yr" class="input" type="number" inputmode="numeric" min="1" data-input="year1" value="${esc(d.year1)}" placeholder="49"></div>
      </div>
      <span class="meta" id="hint">${esc(priceHint(d.type))}</span>
      <div class="field"><span class="label">How will you hand it off?</span>
        <label class="check"><input type="checkbox" data-input="drop" ${d.drop ? 'checked' : ''}>I'll drop it off at their hall</label>
        <label class="check"><input type="checkbox" data-input="pick" ${d.pick ? 'checked' : ''}>They pick up at my spot</label></div>
      <label class="switch-row"><span><span style="font-weight:600;display:block">Also open to selling</span><span class="meta">Renters can make an offer to keep it</span></span><input type="checkbox" data-input="sell" ${d.sell ? 'checked' : ''}></label>
      <button type="submit" class="btn btn-cardinal" ${d.busy ? 'disabled' : ''}>${d.busy ? 'Publishing…' : 'Publish listing'}</button>
      <span class="note">Only signed-in USC students can see your listing. You can hide or delete it any time from My Account.</span>
    </form>`;
  }
  function priceHint(type) {
    const ps = D.listings.filter((l) => l.type === type).map((l) => l.sem);
    return `Similar ${D.types[type].name.toLowerCase()}s on TroShare rent for $${Math.min(...ps)}–$${Math.max(...ps)} a semester.`;
  }

  function inboxScreen() {
    const real = server.convs.map((c) => ({ id: c.id, with: c.with.name, unread: c.unread, role: c.role === 'selling' ? 'selling' : 'renting', last: c.last ? (c.last.mine && c.last.kind === 'text' ? 'You: ' : '') + c.last.text : 'No messages yet', at: c.lastAt }));
    const local = S.threads.map((t) => {
      const last = t.msgs[t.msgs.length - 1];
      return { id: t.id, with: t.with, unread: t.unread || 0, role: t.role, last: last ? (last.from === 'me' ? 'You: ' : '') + last.text : '', at: 0 };
    });
    const ts = real.concat(local).sort((a, b) => (b.unread > 0) - (a.unread > 0) || b.at - a.at);
    return `${topbar('Inbox')}
    <section class="section">
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
    const r = S.rentals.find((x) => x.thread === id);
    const l = findListing(c.listing.id);
    const thumb = (l && imgOf(l)) || c.listing.photo || D.types[c.listing.type].img;
    let card;
    if (r) {
      card = `<div class="card pad" style="margin:12px 16px 0;display:flex;flex-direction:column;gap:10px">
        <div class="row"><span class="thumb"><img src="${esc(thumb)}" alt=""></span><span class="grow"><span class="t-serif">${esc(c.listing.title)} · ${r.plan === 'sem' ? 'Semester' : 'Full year'}</span><span class="meta">${esc(r.when)} · ${esc(r.where)}</span></span><span class="badge ${r.status === 'Returned' ? 'gray' : ''}">${esc(r.status)}</span></div>
        ${r.status === 'Scheduled' ? `<button type="button" class="btn btn-cardinal" data-action="confirm" data-id="${r.id}">Got it — confirm handoff</button>` : ''}
        ${r.status === 'Active' ? `<div class="callout">${I.check}<span><b>Handoff confirmed.</b> ${esc(first)} has been paid. Return it by move-out in May.</span></div>` : ''}
      </div>`;
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
  setInterval(() => { if (!document.hidden) refreshConvs(); }, 20000);
  const arStates = () => server.listings.map((l) => l.id + ':' + (l.ar ? l.ar.status : '')).join(',');
  setInterval(() => {
    if (document.hidden || !AUTH.signedIn() || !server.listings.some((l) => l.ar && l.ar.status === 'in_progress')) return;
    const before = arStates();
    AUTH.call('/listings').then((r) => {
      server.listings = r.listings.map(fromServer);
      if (arStates() === before) return;
      const { route } = parse();
      const typing = document.activeElement && document.activeElement.matches('input, textarea, select');
      if (['home', 'item', 'account', 'ar'].includes(route) && !typing) rerender();
    }).catch(() => { /* try again next time */ });
  }, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (Date.now() - server.at > 60000) syncFromServer(); else refreshConvs();
  });

  function accountScreen() {
    const statusBadge = (s) => s === 'Returned' ? 'gray' : (s === 'Rented' ? 'red' : '');
    const renting = S.rentals.map((r) => {
      const l = findListing(r.listingId); if (!l) return '';
      return `<a class="list-row" href="${r.thread ? '#/chat/' + r.thread : '#/item/' + l.id}"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">From ${esc(l.seller)} · ${r.plan === 'sem' ? '1 Semester' : 'Full year'} · ${money(r.price)}${r.split ? ' (split)' : ''}</span><span class="meta">${esc(r.when)}</span></span><span class="badge ${statusBadge(r.status)}">${esc(r.status)}</span></a>`;
    }).join('');
    const mine = myListings();
    const mineRows = mine.map((m) => `<a class="list-row" href="#/item/${esc(m.id)}" style="text-decoration:none;color:inherit"><span class="thumb"><img src="${esc(imgOf(m))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(m))}</span><span class="meta">Listed · ${money(m.sem)} per semester</span><span class="meta">${esc(m.condition)} · ${m.handoff === 'both' ? 'Delivery or pickup' : (m.handoff === 'drop' ? 'Delivery only' : 'Pickup only')}</span></span><span class="badge ${m.status === 'paused' ? 'gray' : ''}">${m.status === 'paused' ? 'Hidden' : 'Available'}</span></a>`).join('');
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
      ${profileForm('Save changes')}
      <div class="card pad stack">
        <div class="section-head"><h2 class="h2" style="font-size:20px">My rating</h2></div>
        <p class="meta" style="margin:0;font-size:13px">No reviews yet. After each rental, the other student rates how it went, and your rating shows up here for sellers to see.</p>
      </div>
      <div class="card pad" style="display:flex;flex-direction:column;gap:10px">
        <h2 class="h2" style="font-size:20px">My rentals</h2>
        <div class="tabs2" role="tablist"><button type="button" role="tab" class="${ui.accTab === 'rent' ? 'on' : ''}" aria-selected="${ui.accTab === 'rent'}" data-action="acc-tab" data-id="rent">Renting (${S.rentals.length})</button><button type="button" role="tab" class="${ui.accTab === 'list' ? 'on' : ''}" aria-selected="${ui.accTab === 'list'}" data-action="acc-tab" data-id="list">My listings (${mine.length})</button></div>
        <div>${ui.accTab === 'rent' ? (renting || '<p class="empty">No rentals yet.</p>') : (mineRows || `<p class="empty">${server.loaded ? 'You haven’t listed anything yet.' : 'Loading…'}</p>`)}</div>
        ${ui.accTab === 'list' ? '<a class="btn-dashed" href="#/sell">+ List an item</a>' : ''}
      </div>
      ${viewed.length ? `<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><h2 class="h2" style="font-size:20px">Recently viewed</h2><div class="hscroll">${viewed.map((l) => `<a class="mini" href="#/item/${l.id}"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span style="font-size:12px;font-weight:700">${esc(nameOf(l))}</span><span style="font-size:12px;font-weight:700;color:var(--cardinal)">${money(l.sem)}/sem</span></a>`).join('')}</div></div>` : ''}
      <div class="card pad" style="display:flex;flex-direction:column;gap:4px"><h2 class="h2" style="font-size:20px">Favorites</h2>
        ${favs.length ? favs.map((l) => `<div class="list-row"><a class="row grow" href="#/item/${l.id}" style="flex-direction:row;text-decoration:none;color:inherit;gap:12px"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta"><b style="color:var(--cardinal)">${money(l.sem)}/sem</b> · ${esc(l.seller)} · ${esc(hallById(l.hall).name)}</span></span></a><button type="button" class="icon-btn" style="color:var(--cardinal)" data-action="fav" data-id="${l.id}" aria-label="Remove ${esc(nameOf(l))} from favorites">${I.heart(true)}</button></div>`).join('') : '<p class="empty">Tap the heart on a listing to save it.</p>'}
      </div>
      <button type="button" class="btn btn-cardinal" data-action="logout">Log out</button>
      <div class="card pad stack">
        <span class="label">Demo tools</span>
        <span class="meta">Fill your account with sample rentals and chats with sample sellers, or clear what you've done on this device. Your listings, favorites and chats with real students aren't affected.</span>
        <div class="row" style="gap:8px"><button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="sample-data">Load sample activity</button><button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="reset">Clear my activity</button></div>
      </div>
    </section>
    <p class="footer">A peer-to-peer marketplace for USC students.<br>Rent what you need, share what you don't — Trojan to Trojan.</p>`;
  }

  function profileForm(submitLabel) {
    const saved = (AUTH.profile && AUTH.profile.hall) || '';
    return `<form class="card pad stack" data-form="profile">
      <h2 class="h2" style="font-size:20px">Your profile</h2>
      <label class="label" for="f-year">Class year</label>
      <select id="f-year" name="year" class="input" required>
        <option value="" ${D.me.year ? '' : 'selected'} disabled>Choose…</option>
        ${YEARS.map((y) => `<option ${D.me.year === y ? 'selected' : ''}>${y}</option>`).join('')}
      </select>
      <label class="label" for="f-hall">Where you live</label>
      <select id="f-hall" name="hall" class="input" required>
        <option value="" ${saved ? '' : 'selected'} disabled>Choose your residence hall…</option>
        ${D.halls.map((h) => `<option value="${h.id}" ${saved === h.id ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}
      </select>
      <span class="meta">Sellers see your first name, last initial, class year and hall. Your email stays private.</span>
      <button type="submit" class="btn btn-cardinal">${esc(submitLabel)}</button>
    </form>`;
  }

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
    const picks = Object.keys(AR_MODELS).map((type) => ({ type, l: bestListing(type) })).filter((p) => p.l);
    if (!picks.length) return '<p class="empty">No 3D previews yet.</p>';
    const cur = picks.find((p) => p.type === ui.arType) || picks[0];
    const l = cur.l;
    const from = (type) => Math.min(...market().filter((x) => x.type === type && x.owner !== 'me').map((x) => x.sem));
    const phone = onIPhone() || onAndroid();
    const place = placementFor(l.type);
    const src = 'models/' + l.type;
    return `<section class="section ar-panel">
      <div><h2 class="serif ar-h">Try it before you rent</h2>
        <p class="sub" style="margin:6px 0 0">Pick an item and drop a real-size 3D model into your room with your phone’s camera.</p></div>
      <div class="ar-rail" role="radiogroup" aria-label="Item to preview">${picks.map((p) => `<button type="button" role="radio" class="ar-tile ${p === cur ? 'on' : ''}" aria-checked="${p === cur}" data-action="ar-pick" data-id="${esc(p.type)}">
          <span class="ar-tile-ph"><img src="${esc(imgOf(p.l))}" alt=""></span>
          <span class="ar-tile-name">${esc(typeOf(p.l).name)}</span>
          <span class="ar-tile-price">from ${money(from(p.type))}/sem</span></button>`).join('')}</div>
      <div class="ar-card">
        <div class="ar-stage-wrap">
          <model-viewer class="ar-stage" id="ar-model" src="${src}.glb" ios-src="${src}.usdz" poster="${esc(imgOf(l))}" alt="${esc(nameOf(l))} in 3D, ${esc(AR_MODELS[l.type])}" camera-controls auto-rotate auto-rotate-delay="800" rotation-per-second="18deg" touch-action="pan-y" shadow-intensity="1" ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed" ar-placement="floor"></model-viewer>
        </div>
        <div class="ar-card-body">
          <div class="ar-title-row"><span class="grow"><span class="t-serif ar-name">${esc(typeOf(l).name)}</span><span class="meta">${esc(l.seller)} · ${esc(hallById(l.hall).walk)}</span></span><span class="ar-price">${money(l.sem)}<small>/sem</small></span></div>
          <span class="ar-size">${I.viewfinder}Real size · ${esc(AR_MODELS[l.type])}</span>
          ${place ? `<span class="where" style="align-items:flex-start">${I.pin}Suggested spot: ${esc(place.replace(/[. ]*$/, ''))}</span>` : ''}
          <div class="ar-actions">
            ${phone ? arButton(l, 'AR Preview', 'btn btn-cardinal') : `<button type="button" class="btn btn-cardinal" data-action="ar-desk">${I.viewfinder}AR Preview</button>`}
            <a class="btn btn-outline" href="#/item/${encodeURIComponent(l.id)}">Rent</a>
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
      case 'checkout': html = checkoutScreen(); break;
      case 'sell': html = sellScreen(); break;
      case 'inbox': html = inboxScreen(); break;
      case 'chat': html = chatScreen(id); break;
      case 'account': html = accountScreen(); break;
      case 'room': html = roomScreen(); break;
      case 'fit': html = fitScreen(id); break;
      case 'ar': html = arScreen(id); break;
      default: html = homeScreen();
    }
    app.innerHTML = html;
    renderTabbar(route);
    if (route === 'fit') setupFit();
    if (route === 'ar') setupGenAr();
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
      for (const c of S.cart.slice()) {
        const l = findListing(c.listingId);
        if (!l) continue;
        const rid = 'r' + Date.now() + made.length;
        const price = c.plan === 'sem' ? l.sem : l.year1;
        const where = c.handoff === 'drop' ? myLobby() : D.pickupSpots[l.hall];
        let thread;
        if (l.sample) {
          const t = ensureThread(l.seller, l.year, { rentalId: rid, role: 'renting', listingId: c.listingId });
          t.msgs.push({ from: 'sys', text: 'You rented this · ' + (ui.splitCart ? 'split with roommate' : 'paid in full') });
          t.msgs.push({ from: 'them', text: `Hi ${D.me.first || 'there'}, thanks for renting my ${nameOf(l).toLowerCase()}! ${c.handoff === 'drop' ? 'I can drop it off at your lobby — what time works?' : 'You can pick it up at ' + where + '. When works for you?'}` });
          t.unread = (t.unread || 0) + 1;
          thread = t.id;
        } else {
          const conv = await openRealChat(l);
          const sellerFirst = l.seller.split(' ')[0];
          await sendReal(conv.id, {
            event: 'rent', plan: c.plan, handoff: c.handoff,
            text: `Hi ${sellerFirst}! I'd like to rent your “${nameOf(l)}” for ${c.plan === 'sem' ? 'the semester' : 'the full year'}. ${c.handoff === 'drop' ? 'Could you drop it off at ' + where + '?' : "I'll pick it up at " + where + '.'} What time works for you?`
          });
          thread = conv.id;
        }
        S.rentals.unshift({ id: rid, listingId: l.id, plan: c.plan, price, handoff: c.handoff, split: ui.splitCart, status: 'Scheduled', when: 'Move-in day · time TBD', where, thread });
        S.cart = S.cart.filter((x) => x !== c);
        made.push(thread);
        save();
      }
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
      if (!made.length) return;
    }
    toast(made.length > 1 ? `Rented ${made.length} items — sellers notified` : 'Rented! The seller has been notified');
    location.hash = made.length === 1 ? '#/chat/' + made[0] : '#/inbox';
  }

  function updateMine(id, patch, done) {
    AUTH.call('/listings/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) })
      .then((r) => { putListing(r.listing); rerender(); toast(done); })
      .catch((err) => toast(err.message));
  }

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
      case 'rent': {
        const l = findListing(id);
        S.cart = S.cart.filter((c) => c.listingId !== id);
        S.cart.push({ listingId: id, plan: ui.plan, handoff: ui.hand });
        ui.splitCart = ui.split;
        save(); location.hash = '#/checkout'; toast(nameOf(l) + ' added'); break;
      }
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
      case 'ar-pick': ui.arType = id; rerender(); break;
      case 'sell-cat': {
        // Same categories as the Home chips; picking one switches the item to the first kind in it.
        const d = ui.draft, old = D.types[d.type].name;
        if (D.types[d.type].cat !== id) {
          d.type = Object.keys(D.types).find((k) => D.types[k].cat === id);
          if (!d.title || d.title === old) d.title = D.types[d.type].name;
        }
        rerender(); break;
      }
      case 'ar-desk': toast('Open TroShare on your iPhone to use the camera'); break;
      case 'residence': { const f = app.querySelector('[data-form=profile]'); if (f) f.scrollIntoView({ behavior: 'smooth' }); break; }
      case 'sample-data':
        if (window.confirm('Replace your rentals and sample-seller chats on this device with sample activity?')) {
          S = D.sampleState(D.me.first, hallById(D.me.hall).name); save(); location.hash = '#/home'; render(); toast('Sample activity loaded');
        }
        break;
      case 'reset':
        if (window.confirm('Clear your rentals, cart and sample-seller chats on this device?')) { S = D.emptyState(); save(); location.hash = '#/home'; render(); toast('Activity cleared'); }
        break;
      case 'logout':
        if (window.TS_INTRO) window.TS_INTRO.logout();
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
      case 'fit-rent': {
        const l = findListing(id);
        S.cart = S.cart.filter((c) => c.listingId !== id);
        S.cart.push({ listingId: id, plan: 'sem', handoff: l.handoff === 'pickup' ? 'pick' : 'drop' });
        save(); location.hash = '#/checkout'; toast(nameOf(l) + ' added'); break;
      }
      case 'browse-type': ui.q = D.types[id].name; ui.searchFrom = location.hash; S.cat = 'all'; save(); location.hash = '#/search'; break;
      case 'cond': ui.draft.condition = id; rerender(); break;
      case 'rm-photo': ui.draft.photos.splice(Number(id), 1); rerender(); break;
      case 'ar-toggle': ui.draft.ar = !ui.draft.ar; rerender(); break;
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
    if (!k) return;
    if (el.dataset.action === 'split') { ui.split = el.checked; rerender(); return; }
    if (el.dataset.action === 'split-cart') { ui.splitCart = el.checked; rerender(); return; }
    if (k === 'sort') { ui.sort = el.value; rerender(); return; }
    if (k === 'room-photo') { addRoomFiles(el.files); return; }
    const d = ui.draft;
    if (!d) return;
    if (k === 'photo') {
      const f = el.files && el.files[0];
      if (f && d.photos.length < MAX_LISTING_PHOTOS) compress(f).then((url) => { d.photos.push(url); rerender(); }).catch(() => toast("Couldn't read that photo"));
      return;
    }
    if (k === 'type') { const old = D.types[d.type].name; d.type = el.value; if (!d.title || d.title === old) d.title = D.types[d.type].name; rerender(); return; }
    if (k === 'drop' || k === 'pick' || k === 'sell') { d[k] = el.checked; return; }
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
    if (ui.draft && (k === 'title' || k === 'sem' || k === 'year1')) ui.draft[k] = el.value;
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
        .then(() => { applyUser(); if (firstTime) location.hash = '#/home'; render(); toast(firstTime ? 'You are all set' : 'Profile saved'); })
        .catch((err) => { btn.disabled = false; toast(err.message); });
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
    if (f.dataset.form === 'sell') {
      const d = ui.draft;
      const sem = Math.round(Number(d.sem)), yr = Math.round(Number(d.year1)) || Math.round(sem * 1.8);
      if (!d.title.trim()) return toast('Add a title');
      if (!(sem > 0)) return toast('Add a price per semester');
      if (!d.drop && !d.pick) return toast('Choose at least one handoff option');
      if (d.busy) return;
      d.busy = true; rerender();
      AUTH.call('/listings', {
        method: 'POST',
        body: JSON.stringify({
          type: d.type, title: d.title.trim(), condition: d.condition, sem, year1: yr,
          handoff: d.drop && d.pick ? 'both' : (d.drop ? 'drop' : 'pickup'), openToSell: d.sell, generateAr: !!(d.ar && d.photos.length),
          photos: d.photos.map((url) => url.split(',')[1])
        })
      }).then((r) => {
        const l = putListing(r.listing);
        ui.draft = null;
        toast('Published! Other USC students can see it now');
        location.hash = '#/item/' + l.id;
      }).catch((err) => { d.busy = false; rerender(); toast(err.message); });
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
    if (r === 'inbox') refreshConvs();
  });
  // Signing in or out switches whose data is shown.
  const switchUser = () => {
    Object.assign(server, { listings: [], favorites: [], convs: [], msgs: {}, loaded: false, error: null, at: 0 });
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
