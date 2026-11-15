/* TroShare — a peer-to-peer rental marketplace for USC students.
   Single-page app, no build step. Accounts, listings and favorites live on the TroShare server
   (proxy/worker.js); only per-device conveniences (map filter, recently viewed) stay in localStorage. */
(() => {
  'use strict';
  const D = window.TS_DATA;
  const AUTH = window.TS_AUTH;
  const app = document.getElementById('app');
  const tabbar = document.getElementById('tabbar');
  const toastEl = document.getElementById('toast');

  /* ---------- state ---------- */
  // Per-device conveniences for each signed-in student (map filter, category, recently viewed).
  const stateKey = () => 'troshare-state-v2:' + (D.me.email || 'signed-out');
  let S = null; // loaded at startup, after applyUser()
  function load() {
    try {
      const raw = localStorage.getItem(stateKey());
      // Filters are per-visit: every launch opens on your own hall with All categories.
      if (raw) { const s = JSON.parse(raw); if (s && s.version === 1) { s.cat = 'all'; s.hall = D.me.hall; return s; } }
    } catch (e) { /* storage unavailable: fall back to fresh state */ }
    return { ...D.emptyState(), hall: D.me.hall };
  }
  function save() {
    try { localStorage.setItem(stateKey(), JSON.stringify(S)); }
    catch (e) { toast('Storage is full — try a smaller photo'); }
  }

  // UI-only state (not persisted)
  const ui = { itemId: null, photoIdx: 0, roomTab: 'ar', arType: null, q: '', sort: 'near', draft: null, modelBusy: null };

  // Data on the TroShare server: every student's listings and your favorites.
  const server = { listings: [], favorites: [], loaded: false, loading: false, error: null, at: 0 };
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
      photo: x.photos[0] || null, photos: x.photos, model: x.model && x.model.glb ? x.model : null,
      hall: x.seller.hall, seller: x.seller.name, year: x.seller.year,
      rating: null, rentals: 0, owner: x.mine ? 'me' : 'other', status: x.status, openToSell: x.openToSell, createdAt: x.createdAt
    };
  }
  function putListing(x) {
    const l = fromServer(x);
    const i = server.listings.findIndex((y) => y.id === l.id);
    if (i >= 0) server.listings[i] = l; else server.listings.unshift(l);
    return l;
  }
  // Loads everyone's listings plus your profile and favorites. Errors show on Home with a retry button.
  async function loadServer() {
    if (!AUTH.signedIn() || server.loading) return;
    server.loading = true; server.error = null;
    try {
      const [l, me] = await Promise.all([AUTH.call('/listings'), AUTH.refresh()]);
      server.listings = l.listings.map(fromServer);
      server.favorites = (me && me.favorites) || [];
      server.loaded = true; server.at = Date.now();
    } catch (err) {
      server.error = err.message;
    } finally {
      server.loading = false;
    }
  }
  // Real listings first, then the built-in samples that show how TroShare works.
  function market() {
    return server.listings.filter((l) => l.status === 'available').concat(D.listings);
  }
  function findListing(id) {
    return server.listings.find((x) => x.id === id) || D.listings.find((x) => x.id === id) || null;
  }
  const myListings = () => server.listings.filter((l) => l.owner === 'me');

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
      return `<header class="topbar"><span class="spacer44"></span><a class="wordmark" href="#/home">TROSHARE</a><button type="button" class="icon-btn" data-action="search" aria-label="Search listings">${I.search}</button></header>`;
    }
    return `<header class="topbar">${backHref ? `<a class="icon-btn" href="${backHref}" data-action="back" aria-label="Back">${I.back}</a>` : '<span class="spacer44"></span>'}<h1>${esc(title)}</h1><span class="spacer44"></span></header>`;
  }

  function listingCard(l) {
    const h = hallById(l.hall);
    return `<a class="lcard" href="#/item/${l.id}">
      <div class="ph"><img src="${esc(imgOf(l))}" alt="${esc(nameOf(l))}" loading="lazy"><span class="badge">${esc(l.condition)}</span></div>
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
      ['account', '#/account', I.user, 'Account']
    ];
    const active = { browse: 'home', item: 'home', fit: 'room', ar: 'room' }[route] || route;
    const prev = tabbar.querySelector('a.on')?.getAttribute('href');
    tabbar.innerHTML = tabs.map(([id, href, icon, label]) =>
      `<a href="${href}" class="${active === id ? 'on' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon}${label}</a>`
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
    const q = ui.q.trim().toLowerCase();
    let items = all.filter((l) => (!cur || l.hall === cur.id) && (S.cat === 'all' || catOf(l) === S.cat));
    if (q) items = items.filter((l) => (nameOf(l) + ' ' + l.seller + ' ' + hallById(l.hall).name).toLowerCase().includes(q));
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
    const status = server.error
      ? `<div class="callout" role="alert">${I.shield}<span>Couldn't load students' listings: ${esc(server.error)} <button type="button" class="link" data-action="retry-load">Try again</button></span></div>`
      : (!server.loaded ? '<span class="meta">Loading listings from other students…</span>' : '');

    return `${topbar()}
    <section class="section" id="listings">
      <div class="section-head"><h2>${esc(title)}</h2><span class="sub">${items.length} item${items.length === 1 ? '' : 's'}</span></div>
      ${status}
      <label class="search"><span class="sr-only">Search listings</span>${I.search}<input type="search" placeholder="Lamps, fans, bean bags…" value="${esc(ui.q)}" data-input="q" autocomplete="off"></label>
      <div class="chips" role="group" aria-label="Category">${D.categories.map((c) => `<button type="button" class="chip ${S.cat === c.id ? 'on' : ''}" data-action="cat" data-id="${c.id}" aria-pressed="${S.cat === c.id}">${c.label}</button>`).join('')}</div>
      <div class="section-head"><span class="sub">${cur ? 'Only ' + esc(cur.name) + ' · tap “All halls” on the map below for everything' : 'From USC students across campus'}</span>
        <label class="sub">Sort <select data-input="sort" style="border:none;background:transparent;font-weight:700;color:var(--cardinal)"><option value="near" ${ui.sort === 'near' ? 'selected' : ''}>Closest</option><option value="price" ${ui.sort === 'price' ? 'selected' : ''}>Lowest price</option></select></label></div>
      ${items.length ? `<div class="grid">${items.map(listingCard).join('')}</div>` : `<p class="empty">${q ? 'No listings match. Try another search.' : 'Nothing here yet. Try another hall on the map.'}</p>`}
    </section>
    <div class="map">
      <img src="images/map.jpg" alt="Map of USC Housing buildings around the University Park campus">
      ${D.halls.map((h) => `<button type="button" class="pin ${h.home ? 'home' : ''} ${S.hall === h.id ? 'on' : ''}" style="left:${h.left}%;top:${h.top}%" data-action="hall" data-id="${h.id}" aria-pressed="${S.hall === h.id}" aria-label="${esc(h.name)}, ${count(h.id)} listings${h.home ? ', your hall' : ''}">${h.home ? I.home : ''}<span class="count">${count(h.id)}</span>${esc(h.label)}</button>`).join('')}
    </div>
    <div class="map-pill"><span class="ico">${I.pin.replace('<svg', '<svg width="18" height="18"')}</span><span class="txt">${esc(pill)}</span>${cur ? '<button type="button" class="chip-btn" data-action="hall" data-id="">All halls</button>' : ''}</div>
    <section class="hero">
      <p class="eyebrow">Student-to-student rentals</p>
      <h2 class="hero-title">TroShare</h2>
    </section>
    <p class="footer">A peer-to-peer marketplace for USC students.<br>Rent what you need, share what you don't — Trojan to Trojan.</p>`;
  }

  function itemScreen(id) {
    const l = findListing(id);
    if (!l) return `${topbar('Listing', '#/home')}<p class="empty">${server.loaded ? 'This listing is gone.' : 'Loading…'}</p>`;
    if (ui.itemId !== id) {
      ui.itemId = id; ui.photoIdx = 0;
      S.viewed = [id].concat(S.viewed.filter((v) => v !== id)).slice(0, 8); save();
    }
    const h = hallById(l.hall);
    const mine = l.owner === 'me';
    const fav = server.favorites.includes(id);
    const photos = l.photos && l.photos.length ? l.photos : [imgOf(l)];
    const shown = photos[Math.min(ui.photoIdx, photos.length - 1)];
    const handoffs = [
      l.handoff !== 'pickup' ? (mine ? 'You deliver to their hall lobby' : 'Delivered to your hall lobby') : '',
      l.handoff !== 'drop' ? (mine ? 'They pick up at ' : 'Pickup at ') + D.pickupSpots[l.hall] : ''
    ].filter(Boolean);
    let note;
    if (mine) {
      note = `<div class="callout">${I.shield}<span>${l.status === 'paused' ? '<b>Hidden.</b> Other students can’t see this listing until you show it again.' : 'This is your listing. Every signed-in USC student can see it.'}</span></div>
      <div class="row" style="gap:8px">
        ${l.status === 'paused'
          ? `<button type="button" class="btn btn-cardinal btn-small" style="flex:1" data-action="resume" data-id="${esc(id)}">Show it again</button>`
          : `<button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="pause" data-id="${esc(id)}">Hide for now</button>`}
        <button type="button" class="btn btn-outline btn-small" style="flex:1" data-action="delete-listing" data-id="${esc(id)}">Delete</button>
      </div>
      ${l.photo && !(l.model && l.model.fromPhoto) ? `<button type="button" class="btn btn-gold" data-action="build-model" data-id="${esc(id)}" ${ui.modelBusy === id ? 'disabled' : ''}>${ui.modelBusy === id ? 'Building a 3D model from your photo…' : 'Build AR model from this photo'}</button>` : ''}`;
    } else if (l.sample) {
      note = `<div class="callout">${I.shield}<span><b>Sample listing.</b> It shows how TroShare works; ${esc(l.seller)} isn't a real student. Real listings from USC students appear first on Home.</span></div>`;
    } else {
      note = `<div class="callout">${I.shield}<span>Renting through TroShare opens soon. Tap the heart to save it; you'll find it under Favorites in My Account.</span></div>`;
    }
    return `${topbar(nameOf(l), '#/home')}
    <div class="photo"><img src="${esc(shown)}" alt="${esc(nameOf(l))}${l.photo ? ", the seller's actual item" : ''}"><span class="badge">${esc(l.condition)}</span>
      ${modelFiles(l) ? arButton(l, 'AR Preview', 'fit-btn') : ''}
      ${mine ? '' : `<button type="button" class="icon-btn" data-action="fav" data-id="${esc(id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from' : 'Add to'} favorites" style="position:absolute;top:8px;left:8px;color:var(--cardinal)">${I.heart(fav)}</button>`}</div>
    ${photos.length > 1 ? `<div class="hscroll" style="padding:10px 16px 0">${photos.map((src, i) => `<button type="button" class="thumb photo-pick ${src === shown ? 'on' : ''}" data-action="photo-idx" data-id="${i}" aria-label="Photo ${i + 1}" aria-pressed="${src === shown}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
    <section class="section">
      <div><h2 class="serif" style="margin:0;font-size:26px">${esc(nameOf(l))}</h2><p class="sub" style="margin:4px 0 0">${esc(typeOf(l).blurb)}</p></div>
      <div class="card pad row">
        <span class="${avClass(l.seller)}">${esc(initial(l.seller))}</span>
        <span class="grow"><span class="row" style="gap:6px;font-weight:700">${esc(l.seller)}${mine ? ' (you)' : ''} ${l.sample ? '' : I.verified}</span>
          <span class="meta">${esc(l.year)}${l.sample ? '' : ' · Verified USC student'} · ${stars(l)}${l.rentals ? ' · ' + l.rentals + ' rentals' : ''}</span>
          <span class="where">${I.pin}${esc(h.name)} · ${esc(h.walk)}</span></span>
      </div>
      <div class="card pad stack">
        <div class="row" style="justify-content:space-between"><span class="label">Semester</span><b style="color:var(--cardinal)">${money(l.sem)}</b></div>
        <div class="row" style="justify-content:space-between"><span class="label">Full year</span><span><b style="color:var(--cardinal)">${money(l.year1)}</b>${l.sem * 2 > l.year1 ? ` <span class="meta">(save ${money(l.sem * 2 - l.year1)})</span>` : ''}</span></div>
        <div class="row" style="justify-content:space-between;align-items:flex-start"><span class="label">Handoff</span><span class="meta" style="text-align:right">${handoffs.map(esc).join('<br>')}</span></div>
        ${l.openToSell ? '<span class="meta">Also open to selling it.</span>' : ''}
      </div>
      ${note}
    </section>`;
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
        <span class="meta">Up to ${MAX_LISTING_PHOTOS} photos of the actual item. A photo becomes a real-size AR model, usually within a minute. No photo? We'll show a stock picture.</span>
      </div>
      <div class="field"><label for="f-type">Category</label>
        <select id="f-type" class="input" data-input="type">${Object.entries(D.types).map(([k, t]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
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
      <button type="submit" class="btn btn-cardinal" ${d.busy ? 'disabled' : ''}>${d.phase === 'model' ? 'Building a 3D model from your photo…' : (d.busy ? 'Publishing…' : 'Publish listing')}</button>
      <span class="note">Only signed-in USC students can see your listing. You can hide or delete it any time from My Account.</span>
    </form>`;
  }
  function priceHint(type) {
    const ps = D.listings.filter((l) => l.type === type).map((l) => l.sem);
    return `Similar ${D.types[type].name.toLowerCase()}s on TroShare rent for $${Math.min(...ps)}–$${Math.max(...ps)} a semester.`;
  }

  function accountScreen() {
    const mineRows = myListings().map((m) => `<a class="list-row" href="#/item/${esc(m.id)}" style="text-decoration:none;color:inherit"><span class="thumb"><img src="${esc(imgOf(m))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(m))}</span><span class="meta">${money(m.sem)} per semester · ${esc(m.condition)}</span><span class="meta">${m.handoff === 'both' ? 'Delivery or pickup' : (m.handoff === 'drop' ? 'Delivery only' : 'Pickup only')}</span></span><span class="badge ${m.status === 'paused' ? 'gray' : ''}">${m.status === 'paused' ? 'Hidden' : 'Listed'}</span></a>`).join('');
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
        <h2 class="h2" style="font-size:20px">My listings</h2>
        <div>${mineRows || `<p class="empty">${server.loaded ? 'You haven’t listed anything yet.' : 'Loading…'}</p>`}</div>
        <a class="btn-dashed" href="#/sell">+ List an item</a>
      </div>
      ${viewed.length ? `<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><h2 class="h2" style="font-size:20px">Recently viewed</h2><div class="hscroll">${viewed.map((l) => `<a class="mini" href="#/item/${l.id}"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span style="font-size:12px;font-weight:700">${esc(nameOf(l))}</span><span style="font-size:12px;font-weight:700;color:var(--cardinal)">${money(l.sem)}/sem</span></a>`).join('')}</div></div>` : ''}
      <div class="card pad" style="display:flex;flex-direction:column;gap:4px"><h2 class="h2" style="font-size:20px">Favorites</h2>
        ${favs.length ? favs.map((l) => `<div class="list-row"><a class="row grow" href="#/item/${l.id}" style="flex-direction:row;text-decoration:none;color:inherit;gap:12px"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta"><b style="color:var(--cardinal)">${money(l.sem)}/sem</b> · ${esc(l.seller)} · ${esc(hallById(l.hall).name)}</span></span></a><button type="button" class="icon-btn" style="color:var(--cardinal)" data-action="fav" data-id="${l.id}" aria-label="Remove ${esc(nameOf(l))} from favorites">${I.heart(true)}</button></div>`).join('') : '<p class="empty">Tap the heart on a listing to save it.</p>'}
      </div>
      <div class="card pad stack"><h2 class="h2" style="font-size:20px">Renting &amp; payments</h2>
        <p class="meta" style="margin:0;font-size:13px">Renting, messaging and payments through TroShare are coming soon. Your listings and favorites are saved to your account and show up on any device you log in from.</p>
      </div>
      <button type="button" class="btn btn-cardinal" data-action="logout">Log out</button>
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

  // AR Preview tab: pick a kind of furniture and preview it at real size with the existing AR viewer.
  function arPreviewPanel() {
    const picks = Object.keys(AR_MODELS).map((type) => ({ type, l: bestListing(type) })).filter((p) => p.l);
    if (!picks.length) return '<p class="empty">No 3D previews yet.</p>';
    const cur = picks.find((p) => p.type === ui.arType) || picks[0];
    return `<section class="section">
      <div><h2 class="serif" style="margin:0;font-size:26px">Preview furniture in AR</h2>
        <p class="sub" style="margin:6px 0 0">Choose an item and place it in your room at real size with your phone’s camera.</p></div>
      <div class="chips ar-picks" role="radiogroup" aria-label="Item to preview">${picks.map((p) =>
        `<button type="button" role="radio" class="chip ${p === cur ? 'on' : ''}" aria-checked="${p === cur}" data-action="ar-pick" data-id="${esc(p.type)}">${esc(typeOf(p.l).name)}</button>`).join('')}</div>
      ${arBody(cur.l)}
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
        ${l.owner === 'me' ? '' : `<a class="btn btn-cardinal btn-small" href="#/item/${encodeURIComponent(id)}">View</a>`}</div>
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
  // A listing photo produces its own model. Otherwise the category stand-in is used. Microwave has no stand-in.
  function modelFiles(l) {
    if (l.model && l.model.glb && l.model.usdz && l.model.size) {
      return { glb: l.model.glb, usdz: l.model.usdz, size: l.model.size, fromPhoto: true };
    }
    if (!AR_MODELS[l.type]) return null;
    return { glb: 'models/' + l.type + '.glb', usdz: 'models/' + l.type + '.usdz', size: AR_MODELS[l.type], fromPhoto: false };
  }

  function arButton(l, label, cls) {
    const files = modelFiles(l);
    if (!files) return '';
    const img = `<img src="${esc(imgOf(l))}" alt="">`;
    const look = cls || 'btn btn-gold';
    const icon = cls ? I.viewfinder : '';
    if (onIPhone()) {
      // AR Quick Look needs an <img> as the link's first child, and a real USDZ URL the system can download.
      return `<a class="${look} ar-launch" rel="ar" href="${esc(files.usdz)}#allowsContentScaling=0">${img}${esc(label)}</a>`;
    }
    if (onAndroid()) {
      const file = new URL(files.glb, location.href).href;
      const scene = 'https://arvr.google.com/scene-viewer/1.0?mode=ar_preferred&disableScaling=true&file=' + encodeURIComponent(file) + '&title=' + encodeURIComponent(nameOf(l));
      return `<a class="${look} ar-launch" href="${scene}">${cls ? icon : img}${esc(label)}</a>`;
    }
    return `<a class="${look}" href="#/ar/${l.id}">${icon}${esc(label)}</a>`;
  }

  function arScreen(id) {
    const l = findListing(id);
    if (!l) return `${topbar('Preview in AR', '#/room')}<p class="empty">This listing is gone.</p>`;
    if (!modelFiles(l)) return `${topbar('Preview in AR', '#/item/' + encodeURIComponent(id))}<p class="empty">No 3D preview for this item yet.</p>`;
    const back = (room.analysis ? '#/room' : '#/item/' + encodeURIComponent(id));
    return `${topbar('Preview in AR', back)}
    <section class="section">
      <div><h2 class="serif" style="margin:0;font-size:26px">${esc(nameOf(l))}</h2></div>
      ${arBody(l)}
    </section>`;
  }

  function arBody(l) {
    const files = modelFiles(l);
    if (!files) return '';
    const id = l.id;
    const place = placementFor(l.type);
    const spot = place
      ? 'Suggested spot: ' + place.replace(/[. ]*$/, '') + '. Aim the rear camera there. When a circle appears on the floor, tap it and the furniture sits down at real size.'
      : 'Aim the rear camera at the floor. When a circle appears, tap it and the furniture sits down at real size.';
    const phone = onIPhone() || onAndroid();
    const about = files.fromPhoto
      ? `Built from the seller's photo, ${files.size}. The photo is on the front and back, and it stands on the floor at that size.`
      : `This is a typical ${typeOf(l).name}, ${files.size}, not a scan of the seller's photo.`;
    return `<p class="sub" style="margin:0">${esc(spot)}</p>
      ${phone ? arButton(l, 'Open camera and place on the floor') : `<model-viewer class="ar-stage" id="ar-model" src="${esc(files.glb)}" ios-src="${esc(files.usdz)}" alt="${esc(nameOf(l))} in 3D, ${esc(files.size)}" camera-controls touch-action="pan-y" shadow-intensity="1" ar ar-modes="webxr scene-viewer quick-look" ar-scale="fixed" ar-placement="floor"></model-viewer>`}
      <p class="meta">${esc(about)} ${phone ? 'The camera is your phone’s rear camera. Move slowly so it can find the floor.' : 'This computer cannot open your phone’s camera. Open the same page in Safari on your iPhone, then tap AR Preview.'}</p>
      <div class="card pad row"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">${money(l.sem)}/semester · ${esc(l.seller)}</span></span>
        ${l.owner === 'me' ? '' : `<a class="btn btn-cardinal btn-small" href="#/item/${encodeURIComponent(id)}">View</a>`}</div>`;
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
      case 'item': html = itemScreen(id); break;
      case 'sell': html = sellScreen(); break;
      case 'account': html = accountScreen(); break;
      case 'room': html = roomScreen(); break;
      case 'fit': html = fitScreen(id); break;
      case 'ar': html = arScreen(id); break;
      default: html = homeScreen();
    }
    app.innerHTML = html;
    renderTabbar(route);
    if (route === 'fit') setupFit();
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      window.scrollTo(0, 0);
    }
    if (ui.toList && (route === 'home' || route === 'browse')) {
      ui.toList = false;
      const list = document.getElementById('listings');
      if (list) list.scrollIntoView({ block: 'start' });
      if (ui.focusQ) { ui.focusQ = false; const qi = app.querySelector('[data-input="q"]'); if (qi) qi.focus({ preventScroll: true }); }
    }
  }
  function rerender() { const y = window.scrollY; render(); window.scrollTo(0, y); }

  /* ---------- actions ---------- */
  // Saves a change to one of your listings on the server, then shows it.
  function updateMine(id, patch, done) {
    AUTH.call('/listings/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(patch) })
      .then((r) => { putListing(r.listing); rerender(); toast(done); })
      .catch((err) => toast(err.message));
  }

  app.addEventListener('click', (e) => {
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
      case 'search': {
        ui.toList = true; ui.focusQ = true;
        const r = parse().route;
        if (r === 'home' || r === 'browse') render(); else location.hash = '#/home';
        break;
      }
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
      case 'residence': { const f = app.querySelector('[data-form=profile]'); if (f) f.scrollIntoView({ behavior: 'smooth' }); break; }
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
      case 'browse-type': ui.q = D.types[id].name; S.cat = 'all'; S.hall = null; save(); ui.toList = true; location.hash = '#/home'; break;
      case 'cond': ui.draft.condition = id; rerender(); break;
      case 'rm-photo': ui.draft.photos.splice(Number(id), 1); rerender(); break;
      case 'build-model': buildModel(id); break;
    }
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    const k = el.dataset.input;
    if (!k) return;
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
        .then(() => { applyUser(); S.hall = D.me.hall; save(); if (firstTime) location.hash = '#/home'; render(); toast(firstTime ? 'You are all set' : 'Profile saved'); })
        .catch((err) => { btn.disabled = false; toast(err.message); });
      return;
    }
    if (f.dataset.form === 'sell') {
      const d = ui.draft;
      const sem = Math.round(Number(d.sem)), yr = Math.round(Number(d.year1)) || Math.round(sem * 1.8);
      if (!d.title.trim()) return toast('Add a title');
      if (!(sem > 0)) return toast('Add a price per semester');
      if (!d.drop && !d.pick) return toast('Choose at least one handoff option');
      if (d.busy) return;
      d.busy = true; d.phase = 'publish'; rerender();
      const hadPhoto = d.photos.length > 0;
      AUTH.call('/listings', {
        method: 'POST',
        body: JSON.stringify({
          type: d.type, title: d.title.trim(), condition: d.condition, sem, year1: yr,
          handoff: d.drop && d.pick ? 'both' : (d.drop ? 'drop' : 'pickup'), openToSell: d.sell,
          photos: d.photos.map((url) => url.split(',')[1])
        })
      }).then((r) => finishListing(r, hadPhoto)).catch((err) => { d.busy = false; d.phase = ''; rerender(); toast(err.message); });
    }
  });

  // The listing is already public. The model call is separate so a slow or failed model never blocks publishing.
  function finishListing(r, hadPhoto) {
    let l = putListing(r.listing);
    if (!hadPhoto) {
      ui.draft = null;
      toast('Published! Other USC students can see it now');
      location.hash = '#/item/' + l.id;
      return;
    }
    if (ui.draft) ui.draft.phase = 'model';
    rerender();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);
    AUTH.call('/listings/' + encodeURIComponent(l.id) + '/model', { method: 'POST', body: '{}', signal: ctrl.signal })
      .then((m) => { l = putListing(m.listing); toast('Published, with an AR model from your photo'); })
      .catch((err) => toast(modelFailText(err)))
      .finally(() => {
        clearTimeout(timer);
        ui.draft = null;
        location.hash = '#/item/' + l.id;
      });
  }

  function modelFailText(err) {
    if (err && err.name === 'AbortError') return 'Published. Building the model took too long, so AR uses the usual one for now.';
    if (err && err.status === 404) return 'Published. The model service is not live yet, so AR uses the usual model.';
    return 'Published. ' + ((err && err.message) || 'AR will use the usual model for this category.');
  }

  function buildModel(id) {
    if (ui.modelBusy) return;
    const l = findListing(id);
    if (!l || l.owner !== 'me') return;
    ui.modelBusy = id;
    rerender();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);
    AUTH.call('/listings/' + encodeURIComponent(id) + '/model', { method: 'POST', body: '{}', signal: ctrl.signal })
      .then((r) => { putListing(r.listing); toast('AR model ready'); })
      .catch((err) => toast(err && err.name === 'AbortError' ? 'That took too long. Try again.' : err.message))
      .finally(() => { clearTimeout(timer); ui.modelBusy = null; rerender(); });
  }

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
    const before = D.me.hall;
    return loadServer().then(() => {
      if (!AUTH.signedIn()) return;
      applyUser();
      if (S.hall === before) { S.hall = D.me.hall; save(); }
      rerender();
    });
  }
  window.addEventListener('hashchange', () => {
    sessionStorage.setItem('ts-nav', '1');
    render();
    // Coming back to Home or My Account after a minute picks up new listings from other students.
    const r = parse().route;
    if ((r === 'home' || r === 'account') && Date.now() - server.at > 60000) syncFromServer();
  });
  // Signing in or out switches whose data is shown.
  const switchUser = () => {
    Object.assign(server, { listings: [], favorites: [], loaded: false, error: null, at: 0 });
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
