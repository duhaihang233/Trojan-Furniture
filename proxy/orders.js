// Orders, reviews and notifications for the TroShare server. worker.js routes requests here.
//
// An order is one student renting or buying another student's listing:
//
//   requested ──accept──▶ accepted ──handoff──▶ active ──return──▶ return_requested ──returned──▶ completed
//       │                    │          (buying: handoff ──▶ completed)        ▲
//       ├─decline─▶ declined ├─decline─▶ declined         active ──returned──┘ (seller can confirm directly)
//       └─cancel──▶ canceled └─cancel──▶ canceled
//
// The renter places, cancels, confirms the handoff and says they returned it; the seller accepts,
// declines and confirms it's back. A renter can ask a roommate to split the price; the roommate
// accepts or declines. When an order is completed, renter and seller can rate each other.
// Every step posts a line in the pair's chat and a notification (with a push to their phone).

import { HttpError, readJson, ensureUser, sellerName } from './worker.js';
import { sendPush } from './push.js';

const OPEN = ['requested', 'accepted', 'active', 'return_requested'];
const OPEN_SQL = OPEN.map((s) => `'${s}'`).join(', ');
const MAX_OPEN_ORDERS = 20;
const PLAN_LABEL = { sem: 'Semester', yr: 'Full year' };
const HANDOFF_LABEL = { drop: 'Delivery to their hall lobby', pick: 'Pickup' };
const newId = (prefix) => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const nameOf = (u) => sellerName(u || {});
const firstOf = (u) => nameOf(u).split(' ')[0];

/**
 * When a rental is due back, as YYYY-MM-DD. Approximate USC move-out dates: the fall semester ends
 * Dec 18 and spring May 15 (check USC Housing's calendar each year). A full year is two semesters.
 */
export function returnBy(plan, now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1, d = now.getUTCDate();
  let term, ty;
  if (m < 5 || (m === 5 && d <= 15)) { term = 'spring'; ty = y; }
  else if (m < 12 || d <= 18) { term = 'fall'; ty = y; }
  else { term = 'spring'; ty = y + 1; }
  if (term === 'spring') return plan === 'yr' ? `${ty}-12-18` : `${ty}-05-15`;
  return plan === 'yr' ? `${ty + 1}-05-15` : `${ty}-12-18`;
}
const prettyDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
// Days until a YYYY-MM-DD date, counted in Los Angeles (UTC-8 is close enough for reminders).
const daysUntil = (iso, now = Date.now()) => Math.round((Date.parse(iso + 'T00:00:00Z') - Math.floor((now - 8 * 3600_000) / 86400_000) * 86400_000) / 86400_000);

/* ---------------- notifications ---------------- */

/** Saves a notification for `user` (unless store is false) and pushes it to their phones. */
export async function notify(env, ctx, user, kind, text, link, { store = true } = {}) {
  if (store) {
    await env.DB.prepare('INSERT INTO notifications (user, kind, text, link, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user, kind, text, link || '', Date.now()).run();
  }
  const job = pushToUser(env, user, { title: 'TroShare', body: text, url: link || '' });
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
}

async function pushToUser(env, user, payload) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) return;
  const { results } = await env.DB.prepare('SELECT * FROM push_subs WHERE user = ?').bind(user).all();
  await Promise.all(results.map(async (s) => {
    try {
      const status = await sendPush(env, s, payload);
      // 404/410: the browser dropped this subscription.
      if (status === 404 || status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(s.endpoint).run();
    } catch { /* one phone failing shouldn't stop the others */ }
  }));
}

export async function listNotifications(env, ctx, session) {
  await remindReturns(env, ctx, session.sub);
  const { results } = await env.DB.prepare('SELECT * FROM notifications WHERE user = ? ORDER BY id DESC LIMIT 50').bind(session.sub).all();
  return {
    notifications: results.map((n) => ({ id: n.id, kind: n.kind, text: n.text, link: n.link, at: n.created_at, read: !!n.read })),
    unread: results.filter((n) => !n.read).length,
  };
}

export async function markNotificationsRead(env, session) {
  await env.DB.prepare('UPDATE notifications SET read = 1 WHERE user = ? AND read = 0').bind(session.sub).run();
}

export async function savePushSubscription(request, env, session) {
  const input = await readJson(request, 5_000);
  const endpoint = String(input.endpoint || '');
  const keys = input.keys || {};
  const b64u = /^[A-Za-z0-9_-]+={0,2}$/;
  if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint) || !b64u.test(keys.p256dh || '') || !b64u.test(keys.auth || '')) {
    throw new HttpError(400, "That browser didn't give a usable notification address.");
  }
  await env.DB.prepare(`INSERT INTO push_subs (endpoint, user, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user = excluded.user, p256dh = excluded.p256dh, auth = excluded.auth`)
    .bind(endpoint, session.sub, keys.p256dh, keys.auth, Date.now()).run();
  // Keep the 10 newest devices per student.
  await env.DB.prepare(`DELETE FROM push_subs WHERE user = ?1 AND endpoint NOT IN
    (SELECT endpoint FROM push_subs WHERE user = ?1 ORDER BY created_at DESC LIMIT 10)`).bind(session.sub).run();
}

export async function deletePushSubscription(request, env, session) {
  const input = await readJson(request, 5_000);
  await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ? AND user = ?').bind(String(input.endpoint || ''), session.sub).run();
}

export async function testPush(env, session) {
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE user = ?').bind(session.sub).first();
  if (!n) throw new HttpError(400, 'Turn on notifications on this device first.');
  await pushToUser(env, session.sub, { title: 'TroShare', body: 'Notifications are on. You’ll hear about requests, messages and return dates here.', url: '#/inbox' });
}

/**
 * Return reminders: 7 days before a rental is due, and on the due date (or after). Runs every day from
 * the Worker's cron trigger, and for one student whenever they load their notifications.
 */
export async function remindReturns(env, ctx, onlyUser) {
  const where = onlyUser ? 'AND (o.renter = ?1 OR o.seller = ?1)' : '';
  const stmt = env.DB.prepare(`SELECT o.*, s.given AS s_given, s.family AS s_family, s.name AS s_name,
      r.given AS r_given, r.family AS r_family, r.name AS r_name
    FROM orders o JOIN users s ON s.sub = o.seller JOIN users r ON r.sub = o.renter
    WHERE o.kind = 'rent' AND o.status IN ('active', 'return_requested') AND o.reminded < 2 ${where}`);
  const { results } = await (onlyUser ? stmt.bind(onlyUser) : stmt).all();
  for (const o of results) {
    const days = daysUntil(o.return_by);
    const stage = days <= 0 ? 2 : (days <= 7 ? 1 : 0);
    if (stage <= o.reminded) continue;
    // Claim the reminder first so two runs can't both send it.
    const { meta } = await env.DB.prepare('UPDATE orders SET reminded = ? WHERE id = ? AND reminded < ?').bind(stage, o.id, stage).run();
    if (!meta.changes) continue;
    const seller = { given: o.s_given, family: o.s_family, name: o.s_name };
    const renter = { given: o.r_given, family: o.r_family, name: o.r_name };
    const link = '#/order/' + o.id;
    if (stage === 1) {
      await notify(env, ctx, o.renter, 'return', `Return “${o.listing_title}” to ${firstOf(seller)} by ${prettyDate(o.return_by)} (in ${days} day${days === 1 ? '' : 's'}). Pick a time in chat.`, link);
    } else {
      await notify(env, ctx, o.renter, 'return', `“${o.listing_title}” is due back to ${firstOf(seller)} ${days === 0 ? 'today' : 'since ' + prettyDate(o.return_by)}. Tap “I returned it” once you hand it back.`, link);
      await notify(env, ctx, o.seller, 'return', `${firstOf(renter)} should return your “${o.listing_title}” ${days === 0 ? 'today' : 'by now'}. Tap “Got it back” when you have it.`, link);
    }
  }
}

/* ---------------- orders ---------------- */

const ORDER_SELECT = `SELECT o.*, r.given AS r_given, r.family AS r_family, r.name AS r_name,
    s.given AS s_given, s.family AS s_family, s.name AS s_name, s.hall AS s_hall,
    m.given AS m_given, m.family AS m_family, m.name AS m_name,
    mv.stars AS my_stars, mv.text AS my_text, tv.stars AS their_stars, tv.text AS their_text
  FROM orders o JOIN users r ON r.sub = o.renter JOIN users s ON s.sub = o.seller LEFT JOIN users m ON m.sub = o.split_with
  LEFT JOIN reviews mv ON mv.order_id = o.id AND mv.author = ?1
  LEFT JOIN reviews tv ON tv.order_id = o.id AND tv.subject = ?1 AND tv.author != ?1`;

function orderOut(o, me, photoBase) {
  const role = o.renter === me ? 'renter' : (o.seller === me ? 'seller' : 'roommate');
  return {
    id: o.id, listingId: o.listing_id, kind: o.kind, plan: o.plan, handoff: o.handoff, price: o.price,
    title: o.listing_title, type: o.listing_type, photo: o.listing_photo ? photoBase + o.listing_photo : null,
    status: o.status, role,
    renter: { name: nameOf({ given: o.r_given, family: o.r_family, name: o.r_name }) },
    seller: { name: nameOf({ given: o.s_given, family: o.s_family, name: o.s_name }), hall: o.s_hall || '' },
    split: o.split_with ? { name: nameOf({ given: o.m_given, family: o.m_family, name: o.m_name }), status: o.split_status, you: o.split_with === me } : null,
    convId: role === 'roommate' ? null : o.conv_id,
    returnBy: o.return_by || null, createdAt: o.created_at, updatedAt: o.updated_at,
    myReview: o.my_stars ? { stars: o.my_stars, text: o.my_text } : null,
    theirReview: o.their_stars ? { stars: o.their_stars, text: o.their_text } : null,
  };
}

async function getOrder(env, me, id, photoBase) {
  const row = await env.DB.prepare(`${ORDER_SELECT} WHERE o.id = ?2`).bind(me, id).first();
  return row && orderOut(row, me, photoBase);
}

export async function listOrders(env, session, photoBase) {
  const { results } = await env.DB.prepare(`${ORDER_SELECT} WHERE o.renter = ?1 OR o.seller = ?1 OR o.split_with = ?1
    ORDER BY o.updated_at DESC LIMIT 200`).bind(session.sub).all();
  return results.map((o) => orderOut(o, session.sub, photoBase));
}

// The chat between a renter and a listing's owner (the same one "Message" opens).
async function ensureConversation(env, renter, l) {
  const now = Date.now();
  await env.DB.prepare(`INSERT OR IGNORE INTO conversations (id, listing_id, buyer, seller, listing_title, listing_type, listing_photo, listing_sem, created_at, last_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId('c'), l.id, renter, l.owner, l.title, l.type, JSON.parse(l.photos || '[]')[0] || '', l.sem, now, now).run();
  return (await env.DB.prepare('SELECT id FROM conversations WHERE listing_id = ? AND buyer = ?').bind(l.id, renter).first()).id;
}

/** Adds lines to a chat as `sender` (their own lines count as read for them). */
async function postToChat(env, convId, sender, lines) {
  const conv = await env.DB.prepare('SELECT buyer FROM conversations WHERE id = ?').bind(convId).first();
  if (!conv) return;
  const now = Date.now();
  let last = 0;
  for (const [kind, text] of lines) {
    const r = await env.DB.prepare('INSERT INTO messages (conv_id, sender, kind, text, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(convId, sender, kind, text, now).first();
    last = r.id;
  }
  await env.DB.prepare(`UPDATE conversations SET last_at = ?, ${conv.buyer === sender ? 'buyer_read' : 'seller_read'} = ? WHERE id = ?`)
    .bind(now, last, convId).run();
}

export async function createOrder(request, env, ctx, session, photoBase) {
  const input = await readJson(request, 5_000);
  const me = await ensureUser(env, session);
  const l = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(String(input.listingId || '')).first();
  if (!l) throw new HttpError(404, 'That listing no longer exists.');
  if (l.owner === session.sub) throw new HttpError(400, "That's your own listing.");
  if (l.status !== 'available') throw new HttpError(400, "This item isn't available right now.");
  const kind = input.kind === 'buy' ? 'buy' : 'rent';
  if (input.kind !== undefined && !['rent', 'buy'].includes(input.kind)) throw new HttpError(400, 'Choose rent or buy.');
  if (kind === 'buy' && !(l.open_to_sell && l.buy_price)) throw new HttpError(400, "This item isn't for sale.");
  const plan = kind === 'rent' ? input.plan : null;
  if (kind === 'rent' && !PLAN_LABEL[plan]) throw new HttpError(400, 'Choose a rental length.');
  if (!HANDOFF_LABEL[input.handoff]) throw new HttpError(400, 'Choose delivery or pickup.');
  if (input.handoff === 'drop' && l.handoff === 'pickup') throw new HttpError(400, 'This seller only offers pickup.');
  if (input.handoff === 'pick' && l.handoff === 'drop') throw new HttpError(400, 'This seller only offers delivery.');
  const dup = await env.DB.prepare(`SELECT id FROM orders WHERE listing_id = ? AND renter = ? AND status IN (${OPEN_SQL})`).bind(l.id, session.sub).first();
  if (dup) throw new HttpError(400, 'You already have an order for this item. Find it under My Account → Orders.');
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE renter = ? AND status IN (${OPEN_SQL})`).bind(session.sub).first();
  if (n >= MAX_OPEN_ORDERS) throw new HttpError(400, `You can have up to ${MAX_OPEN_ORDERS} open orders at a time.`);
  let splitWith = null, roommate = null;
  if (input.splitWith) {
    // splitWith is the id of one of your accepted roommates (from GET /roommates).
    roommate = await env.DB.prepare(`SELECT u.* FROM roommates r JOIN users u ON u.sub = CASE WHEN r.inviter = ?1 THEN r.invitee ELSE r.inviter END
      WHERE r.id = ?2 AND r.status = 'accepted' AND (r.inviter = ?1 OR r.invitee = ?1)`).bind(session.sub, String(input.splitWith)).first();
    if (!roommate) throw new HttpError(400, 'Choose one of your roommates to split with. Add them under My Account → Roommates.');
    if (roommate.sub === l.owner) throw new HttpError(400, "You can't split with the seller.");
    splitWith = roommate.sub;
  }
  const note = input.note === undefined ? '' : String(input.note).trim().slice(0, 500);
  const price = kind === 'buy' ? l.buy_price : (plan === 'sem' ? l.sem : l.year1);
  const convId = await ensureConversation(env, session.sub, l);
  const id = newId('o');
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO orders (id, listing_id, renter, seller, kind, plan, handoff, price, listing_title, listing_type, listing_photo,
      status, split_with, split_status, conv_id, return_by, reminded, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, 0, ?, ?)`)
    .bind(id, l.id, session.sub, l.owner, kind, plan, input.handoff, price, l.title, l.type, JSON.parse(l.photos || '[]')[0] || '',
      splitWith, splitWith ? 'pending' : null, convId, kind === 'rent' ? returnBy(plan) : null, now, now).run();
  const what = kind === 'buy' ? `Purchase request · $${price}` : `Rental request · ${PLAN_LABEL[plan]} · $${price}`;
  await postToChat(env, convId, session.sub, [['sys', `${what} · ${HANDOFF_LABEL[input.handoff]}${splitWith ? ' · split with ' + firstOf(roommate) : ''}`], ...(note ? [['text', note]] : [])]);
  const link = '#/order/' + id;
  await notify(env, ctx, l.owner, 'order', `${nameOf(me)} wants to ${kind === 'buy' ? 'buy' : 'rent'} your “${l.title}”${plan ? ' for ' + (plan === 'sem' ? 'the semester' : 'the full year') : ''} ($${price}). Accept or decline.`, link);
  if (splitWith) await notify(env, ctx, splitWith, 'split', `${nameOf(me)} asked you to split “${l.title}” with them. Your half is $${Math.round(price / 2 * 100) / 100}.`, link);
  return getOrder(env, session.sub, id, photoBase);
}

// Who may do what, from which status, and what it becomes.
const ACTIONS = {
  accept: { who: 'seller', from: ['requested'], to: () => 'accepted' },
  decline: { who: 'seller', from: ['requested', 'accepted'], to: () => 'declined' },
  cancel: { who: 'renter', from: ['requested', 'accepted'], to: () => 'canceled' },
  handoff: { who: 'renter', from: ['accepted'], to: (o) => (o.kind === 'buy' ? 'completed' : 'active') },
  return: { who: 'renter', from: ['active'], to: () => 'return_requested' },
  returned: { who: 'seller', from: ['active', 'return_requested'], to: () => 'completed' },
};

export async function orderAction(env, ctx, session, id, action, photoBase) {
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  const role = o && (o.renter === session.sub ? 'renter' : (o.seller === session.sub ? 'seller' : (o.split_with === session.sub ? 'roommate' : null)));
  if (!role) throw new HttpError(404, 'That order is gone.');
  const users = await env.DB.prepare('SELECT * FROM users WHERE sub IN (?, ?, ?)').bind(o.renter, o.seller, o.split_with || '').all();
  const u = (sub) => users.results.find((x) => x.sub === sub) || {};
  const renter = u(o.renter), seller = u(o.seller);
  const link = '#/order/' + id;
  const now = Date.now();

  if (action === 'split-accept' || action === 'split-decline') {
    if (role !== 'roommate') throw new HttpError(403, 'Only the roommate who was asked can answer.');
    if (o.split_status !== 'pending' || !OPEN.includes(o.status)) throw new HttpError(400, 'This split request is no longer open.');
    const ok = action === 'split-accept';
    await env.DB.prepare('UPDATE orders SET split_status = ?, updated_at = ? WHERE id = ?').bind(ok ? 'accepted' : 'declined', now, id).run();
    await postToChat(env, o.conv_id, session.sub, [['sys', ok ? `${firstOf(u(o.split_with))} is splitting the cost` : `${firstOf(u(o.split_with))} isn't splitting the cost`]]);
    await notify(env, ctx, o.renter, 'split', ok
      ? `${nameOf(u(o.split_with))} will split “${o.listing_title}” with you: you each pay $${Math.round(o.price / 2 * 100) / 100}.`
      : `${nameOf(u(o.split_with))} can't split “${o.listing_title}”. You'll pay the full $${o.price}, or cancel the order.`, link);
    return getOrder(env, session.sub, id, photoBase);
  }

  const rule = ACTIONS[action];
  if (!rule) throw new HttpError(404, 'Not found.');
  if (rule.who !== role) throw new HttpError(403, rule.who === 'seller' ? 'Only the seller can do that.' : 'Only the renter can do that.');
  if (!rule.from.includes(o.status)) throw new HttpError(400, 'This order has moved on. Reload to see where it is.');
  const to = rule.to(o);
  const listing = await env.DB.prepare('SELECT status FROM listings WHERE id = ?').bind(o.listing_id).first();

  if (action === 'accept' && (!listing || listing.status !== 'available')) {
    throw new HttpError(400, 'This item is no longer available. Decline the request, or show the listing again first.');
  }
  // Move the order only if nobody else moved it first.
  const { meta } = await env.DB.prepare(`UPDATE orders SET status = ?, updated_at = ?${to === 'completed' ? ', completed_at = ?' : ''} WHERE id = ? AND status = ?`)
    .bind(...[to, now, ...(to === 'completed' ? [now] : []), id, o.status]).run();
  if (!meta.changes) throw new HttpError(409, 'This order just changed. Reload to see where it is.');

  // The listing: off the market while it's promised or out, back on when it's returned or the deal falls through.
  const setListing = (status) => listing && env.DB.prepare('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, o.listing_id).run();
  if (action === 'accept') await setListing('rented');
  if ((action === 'decline' || action === 'cancel') && o.status === 'accepted' && listing && listing.status === 'rented') await setListing('available');
  if (action === 'handoff' && o.kind === 'buy') await setListing('sold');
  if (action === 'returned') await setListing('available');

  const item = `“${o.listing_title}”`;
  const lines = {
    accept: [`${firstOf(seller)} accepted the request`, o.renter, `${nameOf(seller)} accepted your request for ${item}. Pick a time to meet in chat.`],
    decline: [`${firstOf(seller)} declined the request`, o.renter, `${nameOf(seller)} declined your request for ${item}.`],
    cancel: [`${firstOf(renter)} canceled the request`, o.seller, `${nameOf(renter)} canceled their request for ${item}.`],
    handoff: [o.kind === 'buy' ? `Handoff confirmed by ${firstOf(renter)} · sold` : `Handoff confirmed by ${firstOf(renter)} · due back ${prettyDate(o.return_by)}`, o.seller,
      o.kind === 'buy' ? `${nameOf(renter)} got ${item}. It's sold!` : `${nameOf(renter)} got ${item}. It's due back ${prettyDate(o.return_by)}.`],
    return: [`${firstOf(renter)} says they returned it`, o.seller, `${nameOf(renter)} says they returned ${item}. Tap “Got it back” once you have it.`],
    returned: [`${firstOf(seller)} confirmed it's back`, o.renter, `${nameOf(seller)} confirmed ${item} is back. Thanks for returning it!`],
  }[action];
  await postToChat(env, o.conv_id, session.sub, [['sys', lines[0]]]);
  await notify(env, ctx, lines[1], 'order', lines[2], link);
  if (o.split_with && o.split_status === 'accepted' && ['accept', 'decline', 'cancel'].includes(action)) {
    await notify(env, ctx, o.split_with, 'order', `Your split of ${item}: ${action === 'accept' ? 'the seller accepted' : (action === 'decline' ? 'the seller declined' : `${firstOf(renter)} canceled`)}.`, link);
  }
  if (to === 'completed') {
    await notify(env, ctx, o.renter, 'review', `How was ${o.kind === 'buy' ? 'buying' : 'renting'} ${item} from ${firstOf(seller)}? Leave a rating.`, link, { store: true });
    await notify(env, ctx, o.seller, 'review', `How was ${firstOf(renter)} as a ${o.kind === 'buy' ? 'buyer' : 'renter'}? Leave a rating.`, link, { store: true });
  }
  // Accepting one request turns the others for the same item down.
  if (action === 'accept') {
    const { results: others } = await env.DB.prepare("SELECT * FROM orders WHERE listing_id = ? AND id != ? AND status = 'requested'").bind(o.listing_id, id).all();
    for (const x of others) {
      await env.DB.prepare("UPDATE orders SET status = 'declined', updated_at = ? WHERE id = ? AND status = 'requested'").bind(now, x.id).run();
      await postToChat(env, x.conv_id, o.seller, [['sys', 'Someone else is getting this item, so this request was declined']]);
      await notify(env, ctx, x.renter, 'order', `${item} went to another student, so your request was declined.`, '#/order/' + x.id);
    }
  }
  return getOrder(env, session.sub, id, photoBase);
}

/* ---------------- reviews ---------------- */

export async function reviewOrder(request, env, ctx, session, id, photoBase) {
  const input = await readJson(request, 5_000);
  const o = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o || (o.renter !== session.sub && o.seller !== session.sub)) throw new HttpError(404, 'That order is gone.');
  if (o.status !== 'completed') throw new HttpError(400, 'You can rate once the order is finished.');
  const stars = input.stars;
  if (!(Number.isInteger(stars) && stars >= 1 && stars <= 5)) throw new HttpError(400, 'Choose 1 to 5 stars.');
  const text = input.text === undefined ? '' : String(input.text).trim().slice(0, 300);
  const subject = o.renter === session.sub ? o.seller : o.renter;
  const { meta } = await env.DB.prepare('INSERT OR IGNORE INTO reviews (order_id, author, subject, stars, text, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, session.sub, subject, stars, text, Date.now()).run();
  if (!meta.changes) throw new HttpError(400, "You've already rated this order.");
  const me = await ensureUser(env, session);
  await notify(env, ctx, subject, 'review', `${nameOf(me)} rated you ${'★'.repeat(stars)}${text ? `: “${text}”` : ''}`, '#/account');
  return getOrder(env, session.sub, id, photoBase);
}

/** Average rating, count, and the latest reviews about a student. */
export async function ratingOf(env, sub) {
  const sum = await env.DB.prepare('SELECT ROUND(AVG(stars), 1) AS avg, COUNT(*) AS n FROM reviews WHERE subject = ?').bind(sub).first();
  const { results } = await env.DB.prepare(`SELECT r.stars, r.text, r.created_at, u.given, u.family, u.name FROM reviews r JOIN users u ON u.sub = r.author
    WHERE r.subject = ? ORDER BY r.created_at DESC LIMIT 5`).bind(sub).all();
  return { avg: sum.avg, count: sum.n, recent: results.map((r) => ({ stars: r.stars, text: r.text, from: nameOf(r), at: r.created_at })) };
}

/** True while a listing has an order that isn't finished (it can't be deleted then). */
export async function hasOpenOrder(env, listingId) {
  return !!(await env.DB.prepare(`SELECT 1 FROM orders WHERE listing_id = ? AND status IN (${OPEN_SQL}) LIMIT 1`).bind(listingId).first());
}
