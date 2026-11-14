/* TroShare — a peer-to-peer rental marketplace for USC students.
   Single-page app, no build step. State lives in localStorage. */
(() => {
  'use strict';
  const D = window.TS_DATA;
  const KEY = 'troshare-state-v1';
  const app = document.getElementById('app');
  const tabbar = document.getElementById('tabbar');
  const toastEl = document.getElementById('toast');

  /* ---------- state ---------- */
  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.version === 1) return s; }
    } catch (e) { /* storage unavailable: fall back to fresh state */ }
    return D.seedState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('Storage is full — try a smaller photo'); }
  }

  // UI-only state (not persisted)
  const ui = { plan: 'sem', hand: null, split: false, itemId: null, accTab: 'rent', q: '', sort: 'near', splitCart: false, draft: null };

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

  function myAsListing(m) {
    return { ...m, hall: D.me.hall, seller: D.me.name, year: D.me.year, rating: D.me.rating, rentals: 0, owner: 'me' };
  }
  function market() {
    return D.listings.concat(S.myListings.filter((m) => m.status === 'Available').map(myAsListing));
  }
  function findListing(id) {
    const l = D.listings.find((x) => x.id === id);
    if (l) return l;
    const m = S.myListings.find((x) => x.id === id);
    return m ? myAsListing(m) : null;
  }
  function activeRentalFor(listingId) {
    return S.rentals.find((r) => r.listingId === listingId && r.status !== 'Returned');
  }
  function unreadCount() { return S.threads.reduce((n, t) => n + (t.unread || 0), 0); }

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
    verified: '<svg class="verified" role="img" aria-label="Verified USC student" viewBox="0 0 24 24" fill="#990000"><path d="M12 2l2.4 2.1 3.2-.3.9 3.1 2.8 1.6-1.1 3 1.1 3-2.8 1.6-.9 3.1-3.2-.3L12 22l-2.4-2.1-3.2.3-.9-3.1-2.8-1.6 1.1-3-1.1-3 2.8-1.6.9-3.1 3.2.3z"/><path d="M8.5 12.2l2.3 2.3 4.7-4.8" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------- shared pieces ---------- */
  function topbar(title, backHref) {
    if (!title) {
      return `<header class="topbar"><span class="spacer44"></span><a class="wordmark" href="#/home">TROSHARE</a><a class="icon-btn" href="#/browse" aria-label="Search listings">${I.search}</a></header>`;
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
        <span class="meta">${esc(l.seller)} · ${esc(l.year)}${l.owner === 'me' ? ' (you)' : ''}</span>
        <span class="where">${I.pin}${esc(h.name)} · ${esc(h.walk)}</span>
        <span class="cta">${l.owner === 'me' ? 'Your listing' : 'Rent now'}</span>
      </div></a>`;
  }

  function renderTabbar(route) {
    const tabs = [
      ['home', '#/home', I.home, 'Home'], ['browse', '#/browse', I.search, 'Browse'], ['sell', '#/sell', I.plus, 'List'],
      ['inbox', '#/inbox', I.chat, 'Inbox'], ['account', '#/account', I.user, 'Account']
    ];
    const active = { item: 'browse', checkout: 'browse', chat: 'inbox' }[route] || route;
    const n = unreadCount();
    tabbar.innerHTML = tabs.map(([id, href, icon, label]) =>
      `<a href="${href}" class="${active === id ? 'on' : ''}" ${active === id ? 'aria-current="page"' : ''}>${icon}${label}${id === 'inbox' && n ? `<span class="dot" aria-label="${n} unread">${n}</span>` : ''}</a>`
    ).join('');
  }

  /* ---------- screens ---------- */
  function homeScreen() {
    const all = market();
    const cur = S.hall ? hallById(S.hall) : null;
    const count = (id) => all.filter((l) => l.hall === id).length;
    let items;
    if (cur) items = all.filter((l) => l.hall === cur.id);
    else if (S.cat === 'all') items = all.filter((l) => l.hall === D.me.hall);
    else items = all.slice().sort((a, b) => hallById(a.hall).mins - hallById(b.hall).mins);
    if (S.cat !== 'all') items = items.filter((l) => catOf(l) === S.cat);
    const catLabel = D.categories.find((c) => c.id === S.cat).label;
    const title = cur ? 'At ' + cur.name : (S.cat === 'all' ? 'Closest to Webb Tower' : catLabel + ' across campus');
    const n = cur ? count(cur.id) : 0;
    const pill = cur ? (cur.home ? `${n} listings in your building` : `${n} listings at ${cur.name} · ${cur.walk}`) : 'Tap a hall to see what Trojans there are renting out';
    const next = S.rentals.find((r) => r.status === 'Scheduled');
    const nl = next && findListing(next.listingId);

    return `${topbar()}
    <div class="map">
      <img src="images/map.jpg" alt="Map of USC Housing buildings around the University Park campus">
      ${D.halls.map((h) => `<button type="button" class="pin ${h.home ? 'home' : ''} ${S.hall === h.id ? 'on' : ''}" style="left:${h.left}%;top:${h.top}%" data-action="hall" data-id="${h.id}" aria-pressed="${S.hall === h.id}" aria-label="${esc(h.name)}, ${count(h.id)} listings${h.home ? ', your hall' : ''}">${h.home ? I.home : ''}<span class="count">${count(h.id)}</span>${esc(h.short)}</button>`).join('')}
    </div>
    <div class="map-pill"><span class="ico">${I.pin.replace('<svg', '<svg width="18" height="18"')}</span><span class="txt">${esc(pill)}</span>${cur ? '<button type="button" class="chip-btn" data-action="hall" data-id="">All halls</button>' : ''}</div>
    <section class="hero">
      <p class="eyebrow">Student-to-student rentals</p>
      <h2>TroShare</h2>
      <div class="rule"></div>
      <p>Rent dorm essentials from other USC students by the semester. No company in the middle — just Trojans.</p>
      <button type="button" class="btn btn-gold" data-action="scroll-list">Browse listings</button>
      <a class="btn btn-outline-white" href="#/sell">List your stuff</a>
    </section>
    ${nl ? `<section class="section">
      <div class="section-head"><h2>Next handoff</h2><a class="link" href="#/chat/${next.thread}">Chat →</a></div>
      <a class="card pad row" href="#/chat/${next.thread}" style="text-decoration:none;color:inherit">
        <span class="thumb"><img src="${esc(imgOf(nl))}" alt=""></span>
        <span class="grow"><span class="t-serif">${esc(nameOf(nl))}</span><span class="meta">From ${esc(nl.seller)} · ${next.handoff === 'drop' ? 'Delivered' : 'Pickup'}</span><span class="meta">${esc(next.when)} · ${esc(next.where)}</span></span>
        <span class="badge">${esc(next.status)}</span>
      </a></section>` : ''}
    <section class="section" id="listings">
      <div class="section-head"><h2>${esc(title)}</h2><span class="sub">${items.length} items</span></div>
      <div class="chips" role="group" aria-label="Category">${D.categories.map((c) => `<button type="button" class="chip ${S.cat === c.id ? 'on' : ''}" data-action="cat" data-id="${c.id}" aria-pressed="${S.cat === c.id}">${c.label}</button>`).join('')}</div>
      ${items.length ? `<div class="grid">${items.map(listingCard).join('')}</div>` : '<p class="empty">Nothing here yet. Try another hall on the map.</p>'}
    </section>
    <p class="footer">A peer-to-peer marketplace for USC students.<br>Rent what you need, share what you don't — Trojan to Trojan.</p>`;
  }

  function browseScreen() {
    const q = ui.q.trim().toLowerCase();
    let items = market().filter((l) => S.cat === 'all' || catOf(l) === S.cat);
    if (q) items = items.filter((l) => (nameOf(l) + ' ' + l.seller + ' ' + hallById(l.hall).name).toLowerCase().includes(q));
    items.sort(ui.sort === 'price' ? (a, b) => a.sem - b.sem : (a, b) => hallById(a.hall).mins - hallById(b.hall).mins || a.sem - b.sem);
    return `${topbar('Browse')}
    <section class="section">
      <label class="search"><span class="sr-only">Search</span>${I.search}<input type="search" placeholder="Lamps, fans, bean bags…" value="${esc(ui.q)}" data-input="q" autocomplete="off"></label>
      <div class="chips" role="group" aria-label="Category">${D.categories.map((c) => `<button type="button" class="chip ${S.cat === c.id ? 'on' : ''}" data-action="cat" data-id="${c.id}" aria-pressed="${S.cat === c.id}">${c.label}</button>`).join('')}</div>
      <div class="section-head"><span class="sub">${items.length} listings from USC students</span>
        <label class="sub">Sort <select data-input="sort" style="border:none;background:transparent;font-weight:700;color:var(--cardinal)"><option value="near" ${ui.sort === 'near' ? 'selected' : ''}>Closest</option><option value="price" ${ui.sort === 'price' ? 'selected' : ''}>Lowest price</option></select></label></div>
      ${items.length ? `<div class="grid" id="browse-grid">${items.map(listingCard).join('')}</div>` : '<p class="empty">No listings match. Try another search.</p>'}
    </section>`;
  }

  function itemScreen(id) {
    const l = findListing(id);
    if (!l) return `${topbar('Listing', '#/home')}<p class="empty">This listing is gone.</p>`;
    if (ui.itemId !== id) {
      ui.itemId = id; ui.plan = 'sem'; ui.split = false;
      ui.hand = l.handoff === 'pickup' ? 'pick' : 'drop';
      S.viewed = [id].concat(S.viewed.filter((v) => v !== id)).slice(0, 8); save();
    }
    const h = hallById(l.hall);
    const mine = l.owner === 'me';
    const renting = activeRentalFor(id);
    const fav = S.favorites.includes(id);
    const canDrop = l.handoff !== 'pickup', canPick = l.handoff !== 'drop';
    const amt = ui.plan === 'sem' ? l.sem : l.year1;
    const pay = ui.split ? amt / 2 : amt;
    return `${topbar(nameOf(l), '#/home')}
    <div class="photo"><img src="${esc(imgOf(l))}" alt="${esc(nameOf(l))}, the seller's actual item"><span class="badge">${esc(l.condition)}</span>
      ${mine ? '' : `<button type="button" class="icon-btn" data-action="fav" data-id="${id}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from' : 'Add to'} favorites" style="position:absolute;top:8px;left:8px;color:var(--cardinal)">${I.heart(fav)}</button>`}</div>
    <section class="section">
      <div><h2 class="serif" style="margin:0;font-size:26px">${esc(nameOf(l))}</h2><p class="sub" style="margin:4px 0 0">${esc(typeOf(l).blurb)}</p></div>
      <div class="card pad row">
        <span class="${avClass(l.seller)}">${esc(initial(l.seller))}</span>
        <span class="grow"><span class="row" style="gap:6px;font-weight:700">${esc(l.seller)} ${I.verified}</span>
          <span class="meta">${esc(l.year)} · Verified USC student · ★ ${l.rating.toFixed(1)}${l.rentals ? ' · ' + l.rentals + ' rentals' : ''}</span>
          <span class="where">${I.pin}${esc(h.name)} · ${esc(h.walk)}</span></span>
        ${mine ? '' : `<button type="button" class="btn btn-outline btn-small" data-action="message" data-id="${id}">Message</button>`}
      </div>
      ${mine ? `<div class="callout">${I.shield}<span>This is your listing. It's visible to verified USC students. Manage it from <a href="#/account">My Account</a>.</span></div>` : `
      <span class="label">Rental length</span>
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
      ${renting ? `<a class="btn btn-outline" href="#/chat/${renting.thread}" style="flex:1">You're renting this</a>` : `<button type="button" class="btn btn-cardinal" style="flex:1" data-action="rent" data-id="${id}">Rent</button>`}</div>
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
          <div class="row"><span class="${avClass(l.seller)} sm" style="width:32px;height:32px">${esc(initial(l.seller))}</span><span class="grow"><span class="row" style="gap:6px;font-weight:700">From ${esc(l.seller)} · ${esc(l.year)} ${I.verified}</span></span><span class="meta">★ ${l.rating.toFixed(1)}</span></div>
          <div class="row"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">${c.plan === 'sem' ? '1 Semester' : 'Full year'}</span></span><span style="font-weight:700">${money(amt)}</span></div>
          <div class="row" style="justify-content:space-between"><span class="meta"><b>${c.handoff === 'drop' ? 'Delivered' : 'Pickup'}</b> · ${c.handoff === 'drop' ? 'Webb Tower lobby' : esc(D.pickupSpots[l.hall])}</span><button type="button" class="link" data-action="remove" data-id="${l.id}" style="font-size:13px">Remove</button></div>
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
          <label class="photo-slot add">${I.camera}Add photo<input type="file" accept="image/*" class="sr-only" data-input="photo"></label>
        </div>
        <span class="meta">Use your own photos of the actual item. No photo? We'll show a sample.</span>
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
      <button type="submit" class="btn btn-cardinal">Publish listing</button>
      <span class="note">Only verified USC students can see and rent your listing.</span>
    </form>`;
  }
  function priceHint(type) {
    const ps = D.listings.filter((l) => l.type === type).map((l) => l.sem);
    return `Similar ${D.types[type].name.toLowerCase()}s on TroShare rent for $${Math.min(...ps)}–$${Math.max(...ps)} a semester.`;
  }

  function inboxScreen() {
    const ts = S.threads.slice().sort((a, b) => (b.unread || 0) - (a.unread || 0));
    return `${topbar('Inbox')}
    <section class="section">
      ${ts.length ? `<div class="card" style="padding:0 14px">${ts.map((t) => {
        const last = t.msgs[t.msgs.length - 1];
        return `<a class="list-row" href="#/chat/${t.id}">
          <span class="${avClass(t.with)}">${esc(initial(t.with))}</span>
          <span class="grow"><span style="font-weight:700">${esc(t.with)}</span><span class="meta" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${last ? (last.from === 'me' ? 'You: ' : '') + esc(last.text) : ''}</span></span>
          ${t.unread ? `<span class="dot">${t.unread}</span>` : `<span class="badge ${t.role === 'selling' ? 'red' : ''}">${t.role === 'selling' ? 'Your listing' : 'Renting'}</span>`}
        </a>`;
      }).join('')}</div>` : '<p class="empty">No messages yet. Rent something and the seller will show up here.</p>'}
    </section>`;
  }

  function chatScreen(id) {
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

  function accountScreen() {
    const statusBadge = (s) => s === 'Returned' ? 'gray' : (s === 'Rented' ? 'red' : '');
    const renting = S.rentals.map((r) => {
      const l = findListing(r.listingId); if (!l) return '';
      return `<a class="list-row" href="${r.thread ? '#/chat/' + r.thread : '#/item/' + l.id}"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta">From ${esc(l.seller)} · ${r.plan === 'sem' ? '1 Semester' : 'Full year'} · ${money(r.price)}${r.split ? ' (split)' : ''}</span><span class="meta">${esc(r.when)}</span></span><span class="badge ${statusBadge(r.status)}">${esc(r.status)}</span></a>`;
    }).join('');
    const listings = S.myListings.map((m) => `<div class="list-row"><span class="thumb"><img src="${esc(imgOf(m))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(m))}</span><span class="meta">${m.renter ? 'Rented to ' + esc(m.renter) + ' · ' + money(m.sem) : 'Listed · ' + money(m.sem) + ' per semester'}</span><span class="meta">${esc(m.condition)} · ${m.handoff === 'both' ? 'Delivery or pickup' : (m.handoff === 'drop' ? 'Delivery only' : 'Pickup only')}</span></span><span class="badge ${statusBadge(m.status)}">${esc(m.status)}</span></div>`).join('');
    const viewed = S.viewed.map(findListing).filter(Boolean);
    const favs = S.favorites.map(findListing).filter(Boolean);
    const bars = [['On-time payment', 4.9], ['Item care', 4.7], ['Communication', 4.8], ['Return on time', 4.8]];
    return `${topbar('My Account')}
    <section class="profile" style="padding-top:20px">
      <div class="row"><span class="av alt lg">${D.me.initial}</span><span class="grow"><span style="font-size:18px;font-weight:700">${esc(D.me.name)}</span><span class="vline">${I.shield}${D.me.year} · Verified USC student · Member since ${D.me.since}</span></span></div>
      <button type="button" class="res" data-action="residence" style="border:none;text-align:left"><span style="color:var(--cardinal);display:flex">${I.pin.replace('<svg', '<svg width="20" height="20"')}</span><span class="grow"><span style="font-size:10px;font-weight:700;letter-spacing:1px;color:var(--gray)">MY RESIDENCE</span><span style="font-size:15px;font-weight:600">${esc(hallById(D.me.hall).name)}</span></span><span style="font-size:13px;font-weight:700;color:var(--cardinal)">Change ›</span></button>
    </section>
    <div style="height:4px;background:var(--gold)"></div>
    <section class="section">
      <div class="card pad" style="display:flex;flex-direction:column;gap:12px">
        <div class="section-head"><h2 class="h2" style="font-size:20px">My rating</h2><span class="sub">${D.me.reviews} reviews</span></div>
        <div class="row" style="gap:16px;align-items:center">
          <div style="width:100px;display:flex;flex-direction:column;align-items:center;gap:4px"><span class="serif" style="font-size:42px;font-weight:700;color:var(--cardinal);line-height:1">${D.me.rating}</span><span style="color:#E0A800" aria-label="4.8 out of 5 stars">★★★★★</span><span class="meta" style="text-align:center">Rated by other Trojans</span></div>
          <div class="grow" style="gap:8px">${bars.map(([k, v]) => `<div style="display:flex;flex-direction:column;gap:3px;font-size:12px"><div class="row" style="justify-content:space-between"><span>${k}</span><b style="color:var(--cardinal)">${v}</b></div><div class="bar"><div style="width:${v * 20}%"></div></div></div>`).join('')}</div>
        </div>
        <div style="background:var(--tile);border-radius:6px;padding:10px 12px;font-size:13px">“Returned my bean bag clean and on time. Great renter!” <span class="meta">— Maya K., Junior</span></div>
      </div>
      <div class="card pad" style="display:flex;flex-direction:column;gap:10px">
        <h2 class="h2" style="font-size:20px">My rentals</h2>
        <div class="tabs2" role="tablist"><button type="button" role="tab" class="${ui.accTab === 'rent' ? 'on' : ''}" aria-selected="${ui.accTab === 'rent'}" data-action="acc-tab" data-id="rent">Renting (${S.rentals.length})</button><button type="button" role="tab" class="${ui.accTab === 'list' ? 'on' : ''}" aria-selected="${ui.accTab === 'list'}" data-action="acc-tab" data-id="list">My listings (${S.myListings.length})</button></div>
        <div>${ui.accTab === 'rent' ? (renting || '<p class="empty">No rentals yet.</p>') : (listings || '<p class="empty">You haven’t listed anything yet.</p>')}</div>
        ${ui.accTab === 'list' ? '<a class="btn-dashed" href="#/sell">+ List an item</a>' : ''}
      </div>
      ${viewed.length ? `<div class="card pad" style="display:flex;flex-direction:column;gap:10px"><h2 class="h2" style="font-size:20px">Recently viewed</h2><div class="hscroll">${viewed.map((l) => `<a class="mini" href="#/item/${l.id}"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span style="font-size:12px;font-weight:700">${esc(nameOf(l))}</span><span style="font-size:12px;font-weight:700;color:var(--cardinal)">${money(l.sem)}/sem</span></a>`).join('')}</div></div>` : ''}
      <div class="card pad" style="display:flex;flex-direction:column;gap:4px"><h2 class="h2" style="font-size:20px">Favorites</h2>
        ${favs.length ? favs.map((l) => `<div class="list-row"><a class="row grow" href="#/item/${l.id}" style="flex-direction:row;text-decoration:none;color:inherit;gap:12px"><span class="thumb"><img src="${esc(imgOf(l))}" alt=""></span><span class="grow"><span class="t-serif">${esc(nameOf(l))}</span><span class="meta"><b style="color:var(--cardinal)">${money(l.sem)}/sem</b> · ${esc(l.seller)} · ${esc(hallById(l.hall).name)}</span></span></a><button type="button" class="icon-btn" style="color:var(--cardinal)" data-action="fav" data-id="${l.id}" aria-label="Remove ${esc(nameOf(l))} from favorites">${I.heart(true)}</button></div>`).join('') : '<p class="empty">Tap the heart on a listing to save it.</p>'}
      </div>
      <div class="card pad" style="display:flex;flex-direction:column;gap:2px"><h2 class="h2" style="font-size:20px;margin-bottom:6px">Payments &amp; payouts</h2>
        <div class="list-row"><span class="paytag" style="background:#1A1F71">VISA</span><span class="grow"><b>Visa •••• 4242</b><span class="meta">Pays for rentals</span></span><span class="badge" style="background:var(--gold);color:var(--ink)">Default</span></div>
        <div class="list-row"><span class="paytag" style="background:#000">PAY</span><span class="grow"><b>Apple Pay</b><span class="meta">Linked to iPhone</span></span></div>
        <div class="list-row"><span class="paytag" style="background:var(--cardinal);color:var(--gold)">$</span><span class="grow"><b>Payout account</b><span class="meta">Where your listing earnings go</span></span></div>
      </div>
      <button type="button" class="btn btn-cardinal" data-action="logout">Log out</button>
      <button type="button" class="btn btn-outline" data-action="reset">Reset demo data</button>
    </section>
    <p class="footer">A peer-to-peer marketplace for USC students.<br>Rent what you need, share what you don't — Trojan to Trojan.</p>`;
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
    switch (route) {
      case 'browse': html = browseScreen(); break;
      case 'item': html = itemScreen(id); break;
      case 'checkout': html = checkoutScreen(); break;
      case 'sell': html = sellScreen(); break;
      case 'inbox': html = inboxScreen(); break;
      case 'chat': html = chatScreen(id); break;
      case 'account': html = accountScreen(); break;
      default: html = homeScreen();
    }
    app.innerHTML = html;
    renderTabbar(route);
    if (location.hash !== lastHash) {
      lastHash = location.hash;
      if (route === 'chat') { const th = document.getElementById('thread'); if (th) th.lastElementChild && th.lastElementChild.scrollIntoView({ block: 'end' }); }
      else window.scrollTo(0, 0);
    }
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
      case 'plan': ui.plan = id; rerender(); break;
      case 'hand': ui.hand = id; rerender(); break;
      case 'fav': {
        const i = S.favorites.indexOf(id);
        if (i >= 0) { S.favorites.splice(i, 1); toast('Removed from favorites'); } else { S.favorites.unshift(id); toast('Saved to favorites'); }
        save(); rerender(); break;
      }
      case 'message': {
        const l = findListing(id);
        const t = ensureThread(l.seller, l.year, { listingId: id });
        if (!t.msgs.length) t.msgs.push({ from: 'sys', text: 'You asked about ' + nameOf(l) });
        save(); location.hash = '#/chat/' + t.id; break;
      }
      case 'rent': {
        const l = findListing(id);
        S.cart = S.cart.filter((c) => c.listingId !== id);
        S.cart.push({ listingId: id, plan: ui.plan, handoff: ui.hand });
        ui.splitCart = ui.split;
        save(); location.hash = '#/checkout'; toast(nameOf(l) + ' added'); break;
      }
      case 'remove': S.cart = S.cart.filter((c) => c.listingId !== id); save(); rerender(); break;
      case 'place': {
        const made = [];
        S.cart.forEach((c) => {
          const l = findListing(c.listingId); if (!l) return;
          const rid = 'r' + Date.now() + made.length;
          const price = c.plan === 'sem' ? l.sem : l.year1;
          const where = c.handoff === 'drop' ? 'Webb Tower lobby' : D.pickupSpots[l.hall];
          const t = ensureThread(l.seller, l.year, { rentalId: rid, role: 'renting', listingId: c.listingId });
          t.msgs.push({ from: 'sys', text: 'You rented this · ' + (ui.splitCart ? 'split with roommate' : 'paid in full') });
          t.msgs.push({ from: 'them', text: `Hi Tommy, thanks for renting my ${nameOf(l).toLowerCase()}! ${c.handoff === 'drop' ? 'I can drop it off at your lobby — what time works?' : 'You can pick it up at ' + where + '. When works for you?'}` });
          t.unread = (t.unread || 0) + 1;
          S.rentals.unshift({ id: rid, listingId: l.id, plan: c.plan, price, handoff: c.handoff, split: ui.splitCart, status: 'Scheduled', when: 'Move-in day · time TBD', where, thread: t.id });
          made.push(t.id);
        });
        S.cart = [];
        save();
        toast(made.length > 1 ? `Rented ${made.length} items — sellers notified` : 'Rented! The seller has been notified');
        location.hash = made.length === 1 ? '#/chat/' + made[0] : '#/inbox';
        break;
      }
      case 'confirm': {
        const r = S.rentals.find((x) => x.id === id);
        if (r) {
          r.status = 'Active';
          const t = S.threads.find((x) => x.id === r.thread);
          if (t) t.msgs.push({ from: 'sys', text: 'Handoff confirmed · seller paid' });
          save(); toast('Handoff confirmed'); rerender();
        }
        break;
      }
      case 'acc-tab': ui.accTab = id; rerender(); break;
      case 'residence': toast('Your hall comes from your USC Housing assignment'); break;
      case 'reset':
        if (window.confirm('Reset TroShare to the original demo data?')) { S = D.seedState(); ui.draft = null; save(); location.hash = '#/home'; render(); toast('Demo data reset'); }
        break;
      case 'logout':
        if (window.TS_INTRO) window.TS_INTRO.logout();
        break;
      case 'cond': ui.draft.condition = id; rerender(); break;
      case 'rm-photo': ui.draft.photos.splice(Number(id), 1); rerender(); break;
    }
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.action === 'split') { ui.split = el.checked; rerender(); return; }
    if (el.dataset.action === 'split-cart') { ui.splitCart = el.checked; rerender(); return; }
    const k = el.dataset.input;
    if (!k) return;
    if (k === 'sort') { ui.sort = el.value; rerender(); return; }
    const d = ui.draft;
    if (!d) return;
    if (k === 'photo') {
      const f = el.files && el.files[0];
      if (f) compress(f).then((url) => { d.photos.push(url); rerender(); }).catch(() => toast("Couldn't read that photo"));
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
    if (ui.draft && (k === 'title' || k === 'sem' || k === 'year1')) ui.draft[k] = el.value;
  });

  app.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === 'chat') {
      const input = f.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      const t = S.threads.find((x) => x.id === f.dataset.id);
      t.msgs.push({ from: 'me', text });
      save(); render();
      const th = document.getElementById('thread'); th && th.lastElementChild && th.lastElementChild.scrollIntoView({ block: 'end' });
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
      const m = { id: 'm' + Date.now(), type: d.type, title: d.title.trim(), condition: d.condition, sem, year1: yr, handoff: d.drop && d.pick ? 'both' : (d.drop ? 'drop' : 'pickup'), status: 'Available', renter: null, photo: d.photos[0] || null, openToSell: d.sell };
      S.myListings.unshift(m);
      ui.draft = null; ui.accTab = 'list';
      save();
      toast('Published! Trojans can rent it now');
      location.hash = '#/item/' + m.id;
    }
  });

  function compress(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = reject;
      r.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const max = 640, s = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.78));
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  window.addEventListener('hashchange', () => { sessionStorage.setItem('ts-nav', '1'); render(); });
  render();

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
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
