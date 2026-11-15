// TroShare server (Cloudflare Worker).
//
// - Accounts: Google sign-in limited to verified @usc.edu accounts, then a TroShare session token.
// - Data: student profiles, listings, favorites and chats in D1 (schema.sql); listing photos in KV.
// - AI room planner: the web app sends room photos here instead of calling Anthropic directly, so
//   visitors never need an API key and the key never reaches the browser. The Worker builds the whole
//   Claude request itself (model, prompt, schema), so the key can only be used for this one feature.
// - AI AR models: Claude describes a listing's item as simple 3D shapes from its photos (ar.js);
//   the browser builds the model from that description (../armodel.js).

import { DurableObject } from 'cloudflare:workers';
import { arRequest, cleanArSpec } from './ar.js';

const ALLOWED_ORIGINS = new Set([
  'https://duhaihang233.github.io',
  'http://127.0.0.1:8765', // local testing
  'http://localhost:8000',
]);

const ITEM_NAMES = {
  micro: 'Compact microwave', tv: '32″ HD TV', bean: 'Bean bag chair', lamp: 'LED desk lamp', floor: 'Floor lamp',
  fan: 'Quiet tower fan', topper: 'XL twin topper', cart: 'Storage cart',
};
// Every USC residence, by the id the app uses (same list as `halls` in data.js).
const HALL_NAMES = {
  annenberg: "Annenberg House",
  belair: "Bel-Air",
  birnkrant: "Birnkrant Residential College",
  bohnett: "Bohnett Residential College",
  caleirani: "Cale and Irani Residential College",
  cng: "Cardinal 'N Gold",
  cargardens: "Cardinal Gardens",
  centennial: "Centennial",
  century: "Century",
  cowlings: "Cowlings Residential College",
  currie: "Currie Hall",
  fairmont: "Fairmont",
  founders: "Founders",
  helena: "Helena",
  hillview: "Hillview",
  ilium: "Ilium Residential College",
  sorbonne: "La Sorbonne",
  manor: "Manor",
  marks: "Marks Tower",
  maxkade: "Max Kade House",
  mccarthy: "McCarthy Honors Residential College",
  mcclintock: "McClintock Apartments",
  mcmorrow: "McMorrow Residential College",
  nemirovsky: "Nemirovsky Residential College",
  newnorth: "New North Residential College",
  pacific: "Pacific",
  pardee: "Pardee Tower",
  parkside: "Parkside Apartments",
  parksidearts: "Parkside Arts & Humanities Residential College",
  parksideintl: "Parkside International Residential College",
  regaltrojan: "Regal Trojan",
  regent: "Regent",
  senator: "Senator",
  sevengables: "Seven Gables",
  severance: "Severance Street Apartments",
  sierra: "Sierra",
  stardust: "Stardust",
  sunset: "Sunset",
  terrace: "Terrace",
  troyeast: "Troy East",
  troyhall: "Troy Hall",
  troyland: "Troyland",
  twinpalms: "Twin Palms",
  uregent: "University Regent",
  veterans: "Veterans' Housing",
  vista: "Vista",
  webb: "Webb Tower",
  windsor: "Windsor",
};
const HALLS = new Set(Object.values(HALL_NAMES));
const MAX_PHOTOS = 5;
const MAX_PHOTO_BASE64 = 4_000_000; // ~3 MB per photo; the app sends ~1568px JPEGs well under this
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const SYSTEM_PROMPT = `You help USC students furnish their dorm rooms. You'll see one or more photos of a student's room and a list of items other students rent out on TroShare.

Write every word of summary, name, reason, placement, and tips in English, even if the room, notes, or student might use another language.

Recommend 3 to 6 things that would make this room more comfortable or useful, most important first. Base each one on something you can actually see in the photos (for example, no desk lighting, a bare floor by the window, nowhere to store things), and don't suggest things the room already has. When a TroShare item fits, use its id in \`item\`; otherwise use "other". Write reasons in one or two short sentences addressed to the student. In \`placement\`, say where in the room it would go, referring to what's in the photos. Use "must_have" only for things the room clearly lacks.

Add up to 3 short tips that need no purchase (rearranging, using light from the window, and so on). If the photos don't show a room, say so in \`summary\` and return no recommendations.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'English only. One or two sentences on what the room has and lacks.' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', enum: [...Object.keys(ITEM_NAMES), 'other'] },
          name: { type: 'string', description: 'English name of the suggestion.' },
          reason: { type: 'string', description: 'English, one or two sentences.' },
          priority: { type: 'string', enum: ['must_have', 'nice_to_have'] },
          placement: { type: 'string', description: 'English sentence saying where in the room it should go.' },
        },
        required: ['item', 'name', 'reason', 'priority', 'placement'],
        additionalProperties: false,
      },
    },
    tips: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'recommendations', 'tips'],
  additionalProperties: false,
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Listing photos are plain public images (<img> tags can't send a login token); their keys are random.
    if (request.method === 'GET' && url.pathname.startsWith('/photos/')) return servePhoto(env, url.pathname.slice(8));

    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.has(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, authorization',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
    const fail = (status, message) => reply(status, { error: { message } });

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (!allowed) return fail(403, 'This service only works from the TroShare website.');

    // Accounts: Google sign-in restricted to verified @usc.edu accounts, then a TroShare session token.
    const path = url.pathname;
    const method = request.method;
    let session;
    try {
      if (method === 'POST' && path === '/auth/google') return reply(200, await signIn(request, env));
      session = await readSession(request, env);
      if (!session) return fail(401, 'Please log in with your USC account.');
      if (!env.DB) throw new HttpError(500, 'The database is not set up yet.');
      const photoBase = `${url.origin}/photos/`;
      if (method === 'GET' && path === '/me') {
        const user = await ensureUser(env, session);
        return reply(200, { user: publicUser(session), profile: profileOf(user), favorites: await listFavorites(env, session.sub) });
      }
      if (method === 'PUT' && path === '/me/profile') return reply(200, { profile: await saveProfile(request, env, session) });
      if (method === 'GET' && path === '/listings') return reply(200, { listings: await listListings(env, session.sub, photoBase) });
      if (method === 'POST' && path === '/listings') return reply(201, { listing: await createListing(request, env, ctx, session, photoBase) });
      const am = path.match(/^\/listings\/([A-Za-z0-9_-]{1,40})\/ar-model$/);
      if (am && method === 'GET') return reply(200, await getArModel(env, am[1]));
      if (am && method === 'POST') return reply(200, { listing: await retryArModel(env, ctx, session, am[1], photoBase) });
      const lm = path.match(/^\/listings\/([A-Za-z0-9_-]{1,40})$/);
      if (lm && method === 'PATCH') return reply(200, { listing: await updateListing(request, env, ctx, session, lm[1], photoBase) });
      if (lm && method === 'DELETE') { await deleteListing(env, session, lm[1]); return reply(200, { ok: true }); }
      const fm = path.match(/^\/favorites\/([A-Za-z0-9_-]{1,40})$/);
      if (fm && (method === 'PUT' || method === 'DELETE')) return reply(200, { favorites: await setFavorite(env, session.sub, fm[1], method === 'PUT') });
      if (method === 'GET' && path === '/roommates') return reply(200, { roommates: await listRoommates(env, session) });
      if (method === 'POST' && path === '/roommates') { await inviteRoommate(request, env, session); return reply(201, { roommates: await listRoommates(env, session) }); }
      const rm = path.match(/^\/roommates\/(r[0-9a-f]{16})(\/accept)?$/);
      if (rm && method === 'POST' && rm[2]) { await acceptRoommate(env, session, rm[1]); return reply(200, { roommates: await listRoommates(env, session) }); }
      if (rm && method === 'DELETE' && !rm[2]) { await removeRoommate(env, session, rm[1]); return reply(200, { roommates: await listRoommates(env, session) }); }
      if (method === 'GET' && path === '/conversations') return reply(200, { conversations: await listConversations(env, session.sub, photoBase) });
      if (method === 'POST' && path === '/conversations') return reply(200, { conversation: await startConversation(request, env, session, photoBase) });
      const cm = path.match(/^\/conversations\/(c[0-9a-f]{16})\/messages$/);
      if (cm && method === 'GET') return reply(200, await readMessages(env, session, cm[1], Number(url.searchParams.get('after')) || 0, photoBase));
      if (cm && method === 'POST') return reply(201, { messages: await sendMessage(request, env, session, cm[1]) });
      if (method !== 'POST' || path !== '/analyze-room') return fail(404, 'Not found.');
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      throw err;
    }

    // Room analysis (logged-in students only).
    if (!env.ANTHROPIC_API_KEY) return fail(500, 'The room planner is not set up yet.');
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: session.sub });
      if (!success) return fail(429, "You've run a lot of analyses in a row. Wait a minute and try again.");
    }

    if (Number(request.headers.get('content-length') || 0) > MAX_PHOTOS * MAX_PHOTO_BASE64 + 50_000) {
      return fail(413, 'Those photos are too large. Try fewer photos.');
    }
    let input;
    try { input = await request.json(); } catch { return fail(400, 'The request was not valid JSON.'); }

    const photos = Array.isArray(input.photos) ? input.photos : [];
    if (!photos.length || photos.length > MAX_PHOTOS) return fail(400, `Send between 1 and ${MAX_PHOTOS} photos.`);
    if (!photos.every((p) => typeof p === 'string' && p.length <= MAX_PHOTO_BASE64 && BASE64.test(p))) {
      return fail(400, 'Each photo must be a base64 JPEG under 3 MB.');
    }
    const hall = HALLS.has(input.hall) ? input.hall : 'USC housing';
    // Only counts and prices come from the client; item names come from this file.
    const catalog = (Array.isArray(input.catalog) ? input.catalog : [])
      .filter((c) => c && ITEM_NAMES[c.id] && [c.count, c.min, c.max].every((n) => Number.isInteger(n) && n >= 0 && n < 10_000))
      .map((c) => `- ${c.id}: ${ITEM_NAMES[c.id]}, ${c.count} listed, $${c.min}–$${c.max} per semester`)
      .join('\n');

    const content = photos.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
    content.push({
      type: 'text',
      text: `These are photos of my dorm room in ${hall} at USC. What should I get for it?\n\nItems other students rent out on TroShare right now (use these ids):\n${catalog}`,
    });

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        fallbacks: 'default',
      }),
    });

    const json = await upstream.json().catch(() => null);
    if (!upstream.ok || !json) {
      // Don't pass Anthropic's account-level error details through to visitors.
      const status = upstream.status === 429 || upstream.status === 529 ? 503 : 502;
      return fail(status, status === 503 ? 'The room planner is busy right now. Try again in a minute.' : 'The room planner had a problem. Try again.');
    }
    if (json.stop_reason === 'refusal') return fail(422, "Claude couldn't analyze these photos. Try different photos of your room.");
    if (json.stop_reason === 'max_tokens') return fail(502, 'The answer was cut off. Try again with fewer photos.');
    const block = (json.content || []).find((b) => b.type === 'text');
    let analysis;
    try { analysis = JSON.parse(block.text); } catch { return fail(502, "Couldn't read Claude's answer. Try again."); }
    return reply(200, analysis);
  },
};

/* ---------------- Accounts ---------------- */

const USC_DOMAIN = 'usc.edu';
const SESSION_DAYS = 30;
const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate student'];
const HALL_IDS = new Set(Object.keys(HALL_NAMES));
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const enc = new TextEncoder();
const b64urlToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const bytesToB64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

let googleKeyCache = null;
async function googleKeys() {
  if (googleKeyCache && googleKeyCache.until > Date.now()) return googleKeyCache.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new HttpError(503, "Couldn't reach Google to check your sign-in. Try again.");
  const maxAge = Number(((res.headers.get('cache-control') || '').match(/max-age=(\d+)/) || [])[1] || 3600);
  googleKeyCache = { keys: (await res.json()).keys, until: Date.now() + maxAge * 1000 };
  return googleKeyCache.keys;
}

/**
 * Verifies a Google Sign-In ID token (signature, issuer, audience, expiry) and that it belongs to a
 * verified @usc.edu Google Workspace account. `keys` can be passed in for tests.
 */
export async function verifyGoogleCredential(credential, clientId, keys) {
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new HttpError(400, 'That sign-in response was not valid. Try again.');
  const [h, p, sig] = parts;
  let header, claims;
  try { header = b64urlJson(h); claims = b64urlJson(p); } catch { throw new HttpError(400, 'That sign-in response was not valid. Try again.'); }
  const jwk = (keys || await googleKeys()).find((k) => k.kid === header.kid);
  if (header.alg !== 'RS256' || !jwk) throw new HttpError(401, "Couldn't verify your Google sign-in. Try again.");
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), enc.encode(`${h}.${p}`));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || !GOOGLE_ISSUERS.has(claims.iss) || claims.aud !== clientId || !(claims.exp > now - 60)) {
    throw new HttpError(401, "Couldn't verify your Google sign-in. Try again.");
  }
  const email = String(claims.email || '').toLowerCase();
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!verified || claims.hd !== USC_DOMAIN || !email.endsWith('@' + USC_DOMAIN)) {
    throw new HttpError(403, `Only @usc.edu accounts can use TroShare. You signed in as ${email || 'a non-USC account'}. Choose your USC Google account instead.`);
  }
  return {
    sub: String(claims.sub),
    email,
    name: String(claims.name || email.split('@')[0]).slice(0, 80),
    given: String(claims.given_name || claims.name || email.split('@')[0]).slice(0, 40),
    family: String(claims.family_name || '').slice(0, 40),
    picture: /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//.test(claims.picture || '') ? claims.picture : '',
  };
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return { key, sig: new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))) };
}

export async function makeSessionToken(user, secret, days = SESSION_DAYS) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const body = bytesToB64url(enc.encode(JSON.stringify({ ...user, exp })));
  const { sig } = await hmac(secret, body);
  return { token: `${body}.${bytesToB64url(sig)}`, exp };
}

export async function readSessionToken(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const { key } = await hmac(secret, body);
  let ok = false;
  try { ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), enc.encode(body)); } catch { return null; }
  if (!ok) return null;
  const claims = b64urlJson(body);
  return claims.exp > Math.floor(Date.now() / 1000) ? claims : null;
}

async function readSession(request, env) {
  if (!env.SESSION_SECRET) throw new HttpError(500, 'Accounts are not set up yet.');
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? readSessionToken(auth.slice(7), env.SESSION_SECRET) : null;
}

const publicUser = (s) => ({ email: s.email, name: s.name, given: s.given, family: s.family, picture: s.picture });

const profileOf = (u) => ({ year: (u && u.year) || '', hall: (u && u.hall) || '', since: (u && u.since) || null });

/**
 * Returns the student's row, creating or refreshing it from their verified Google identity.
 * Profiles saved before the database existed (KV `profile:<sub>`) are copied over the first time.
 */
async function ensureUser(env, who) {
  const now = Date.now();
  const user = await env.DB.prepare('SELECT * FROM users WHERE sub = ?').bind(who.sub).first();
  if (!user) {
    const old = env.PROFILES ? await env.PROFILES.get(`profile:${who.sub}`, 'json') : null;
    const since = (old && old.since) || new Date().getFullYear();
    await env.DB.prepare(`INSERT OR IGNORE INTO users (sub, email, name, given, family, picture, year, hall, since, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(who.sub, who.email, who.name, who.given || '', who.family || '', who.picture || '',
        YEARS.includes(old && old.year) ? old.year : '', HALL_IDS.has(old && old.hall) ? old.hall : '', since, now, now).run();
  } else if (user.email !== who.email || user.name !== who.name || user.picture !== (who.picture || '') || now - user.last_seen > 3_600_000) {
    await env.DB.prepare('UPDATE users SET email = ?, name = ?, given = ?, family = ?, picture = ?, last_seen = ? WHERE sub = ?')
      .bind(who.email, who.name, who.given || '', who.family || '', who.picture || '', now, who.sub).run();
  } else return user;
  return env.DB.prepare('SELECT * FROM users WHERE sub = ?').bind(who.sub).first();
}

async function signIn(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) throw new HttpError(500, 'Accounts are not set up yet.');
  const input = await readJson(request, 20_000);
  const user = await verifyGoogleCredential(input.credential, env.GOOGLE_CLIENT_ID);
  if (!env.DB) throw new HttpError(500, 'The database is not set up yet.');
  const row = await ensureUser(env, user);
  const { token, exp } = await makeSessionToken(user, env.SESSION_SECRET);
  return { token, exp, user: publicUser(user), profile: profileOf(row), favorites: await listFavorites(env, user.sub) };
}

async function saveProfile(request, env, session) {
  const input = await readJson(request, 20_000);
  if (!YEARS.includes(input.year)) throw new HttpError(400, 'Choose your class year.');
  if (!HALL_IDS.has(input.hall)) throw new HttpError(400, 'Choose your residence hall.');
  await ensureUser(env, session);
  await env.DB.prepare('UPDATE users SET year = ?, hall = ? WHERE sub = ?').bind(input.year, input.hall, session.sub).run();
  return profileOf(await env.DB.prepare('SELECT * FROM users WHERE sub = ?').bind(session.sub).first());
}

/* ---------------- Roommates ---------------- */
// A student invites a roommate by their @usc.edu email. The invite is pending until the student with that
// email signs in and accepts it; then both see each other as roommates. Either one can remove it, and
// a pending invite can be canceled by the sender or declined by the person invited.
const MAX_ROOMMATES = 3; // a quad
const USC_EMAIL = /^[a-z0-9._%+-]+@usc\.edu$/;
const normEmail = (e) => String(e || '').trim().toLowerCase();

async function listRoommates(env, session) {
  const me = normEmail(session.email);
  const { results } = await env.DB.prepare(`SELECT r.*, a.name AS a_name, a.picture AS a_picture, a.email AS a_email,
      b.name AS b_name, b.picture AS b_picture
    FROM roommates r JOIN users a ON a.sub = r.inviter LEFT JOIN users b ON b.sub = r.invitee
    WHERE r.inviter = ?1 OR r.invitee = ?1 OR (r.status = 'pending' AND r.email = ?2)
    ORDER BY r.created_at`).bind(session.sub, me).all();
  return results.map((r) => {
    const sent = r.inviter === session.sub;
    return {
      id: r.id, status: r.status, direction: sent ? 'sent' : 'received',
      // The other student: for an invite you sent, their email (and name once they've accepted).
      name: sent ? (r.b_name || '') : r.a_name, email: sent ? r.email : r.a_email,
      picture: (sent ? r.b_picture : r.a_picture) || '', createdAt: r.created_at, acceptedAt: r.accepted_at,
    };
  });
}

async function inviteRoommate(request, env, session) {
  const input = await readJson(request, 2_000);
  const email = normEmail(input.email);
  if (!/^[^@\s]+@[^@\s]+\.edu$/.test(email)) throw new HttpError(400, "Enter your roommate's .edu email.");
  if (!USC_EMAIL.test(email)) throw new HttpError(400, 'TroShare is for USC students. Use their @usc.edu email.');
  if (email === normEmail(session.email)) throw new HttpError(400, "That's your own email.");
  await ensureUser(env, session);
  const mine = (await listRoommates(env, session)).filter((r) => r.direction === 'sent' || r.status === 'accepted');
  if (mine.some((r) => normEmail(r.email) === email)) throw new HttpError(400, "You've already invited them.");
  // They invited you first: accepting theirs is the same thing.
  const theirs = (await listRoommates(env, session)).find((r) => r.direction === 'received' && r.status === 'pending' && normEmail(r.email) === email);
  if (theirs) return acceptRoommate(env, session, theirs.id);
  if (mine.length >= MAX_ROOMMATES) throw new HttpError(400, `You can have up to ${MAX_ROOMMATES} roommates.`);
  const id = 'r' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await env.DB.prepare("INSERT INTO roommates (id, inviter, email, status, created_at) VALUES (?, ?, ?, 'pending', ?)")
    .bind(id, session.sub, email, Date.now()).run();
}

async function acceptRoommate(env, session, id) {
  const row = await env.DB.prepare('SELECT * FROM roommates WHERE id = ?').bind(id).first();
  if (!row || row.status !== 'pending' || row.email !== normEmail(session.email)) throw new HttpError(404, 'That invite is no longer open.');
  await ensureUser(env, session);
  await env.DB.prepare("UPDATE roommates SET status = 'accepted', invitee = ?, accepted_at = ? WHERE id = ?").bind(session.sub, Date.now(), id).run();
}

async function removeRoommate(env, session, id) {
  const row = await env.DB.prepare('SELECT * FROM roommates WHERE id = ?').bind(id).first();
  const mine = row && (row.inviter === session.sub || row.invitee === session.sub || (row.status === 'pending' && row.email === normEmail(session.email)));
  if (!mine) throw new HttpError(404, 'That roommate is already removed.');
  await env.DB.prepare('DELETE FROM roommates WHERE id = ?').bind(id).run();
}

async function readJson(request, maxBytes) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new HttpError(413, 'That upload is too large. Try smaller or fewer photos.');
  try { return await request.json(); } catch { throw new HttpError(400, 'The request was not valid JSON.'); }
}

/* ---------------- Listings, photos, favorites ---------------- */

const TYPE_IDS = new Set(Object.keys(ITEM_NAMES));
const CONDITIONS = ['New', 'New, sealed', 'Like new', 'Good', 'Fair'];
const HANDOFFS = ['both', 'drop', 'pickup'];
const MAX_LISTING_PHOTOS = 4;
const MAX_LISTING_PHOTO_BASE64 = 1_400_000; // ~1 MB; the app uploads ~640px JPEGs of about 60 KB
const MAX_LISTINGS_PER_STUDENT = 100;

const sellerName = (row) => (row.given || row.name || 'Trojan') + (row.family ? ' ' + row.family[0].toUpperCase() + '.' : '');

function listingOut(row, me, photoBase) {
  return {
    id: row.id, type: row.type, title: row.title, condition: row.condition, sem: row.sem, year1: row.year1,
    handoff: row.handoff, openToSell: !!row.open_to_sell, buyPrice: row.open_to_sell && row.buy_price ? row.buy_price : null,
    status: row.status, createdAt: row.created_at,
    photos: JSON.parse(row.photos || '[]').map((k) => photoBase + k),
    seller: { name: sellerName(row), year: row.u_year || '', hall: row.u_hall || 'webb', picture: row.u_picture || '' },
    mine: row.owner === me,
    ar: arOut(row),
  };
}
const LISTING_SELECT = `SELECT l.*, u.given, u.family, u.name, u.year AS u_year, u.hall AS u_hall, u.picture AS u_picture,
    a.status AS ar_status, a.error AS ar_error, a.started_at AS ar_started_at
  FROM listings l JOIN users u ON u.sub = l.owner LEFT JOIN ar_models a ON a.listing_id = l.id`;

async function listListings(env, me, photoBase) {
  // Everyone's available listings, plus all of your own (including paused ones).
  const { results } = await env.DB.prepare(`${LISTING_SELECT} WHERE l.status = 'available' OR l.owner = ? ORDER BY l.created_at DESC LIMIT 1000`)
    .bind(me).all();
  return results.map((r) => listingOut(r, me, photoBase));
}

async function getListing(env, me, id, photoBase) {
  const row = await env.DB.prepare(`${LISTING_SELECT} WHERE l.id = ?`).bind(id).first();
  return row && listingOut(row, me, photoBase);
}

/** Checks listing fields from the app. `partial` allows leaving fields out (for edits). */
function cleanListingFields(input, partial) {
  const out = {};
  const has = (k) => input[k] !== undefined;
  if (!partial || has('type')) {
    if (!TYPE_IDS.has(input.type)) throw new HttpError(400, 'Choose a category.');
    out.type = input.type;
  }
  if (!partial || has('title')) {
    const title = String(input.title || '').replace(/\s+/g, ' ').trim();
    if (!title || title.length > 40) throw new HttpError(400, 'Give it a title of up to 40 characters.');
    out.title = title;
  }
  if (!partial || has('condition')) {
    if (!CONDITIONS.includes(input.condition)) throw new HttpError(400, 'Choose the condition.');
    out.condition = input.condition;
  }
  if (!partial || has('sem')) {
    if (!(Number.isInteger(input.sem) && input.sem >= 1 && input.sem <= 1000)) throw new HttpError(400, 'Set a price per semester between $1 and $1,000.');
    out.sem = input.sem;
  }
  if (!partial || has('sem') || has('year1')) {
    const year1 = input.year1 == null || input.year1 === '' ? Math.round((out.sem || input.sem) * 1.8) : input.year1;
    if (!(Number.isInteger(year1) && year1 >= 1 && year1 <= 2000)) throw new HttpError(400, 'Set a full-year price between $1 and $2,000.');
    out.year1 = year1;
  }
  if (!partial || has('handoff')) {
    if (!HANDOFFS.includes(input.handoff)) throw new HttpError(400, 'Choose at least one handoff option.');
    out.handoff = input.handoff;
  }
  // A listing open to selling has a sale price ("Buy now"). Turning selling off clears it.
  if (!partial || has('openToSell')) {
    out.open_to_sell = input.openToSell ? 1 : 0;
    if (!input.openToSell) out.buy_price = null;
  }
  if (input.openToSell && (!partial || has('openToSell') || has('buyPrice'))) {
    if (!(Number.isInteger(input.buyPrice) && input.buyPrice >= 1 && input.buyPrice <= 5000)) throw new HttpError(400, 'Set a sale price between $1 and $5,000.');
    out.buy_price = input.buyPrice;
  } else if (partial && has('buyPrice') && !has('openToSell')) {
    throw new HttpError(400, 'Send openToSell with buyPrice.');
  }
  return out;
}

async function createListing(request, env, ctx, session, photoBase) {
  const input = await readJson(request, MAX_LISTING_PHOTOS * MAX_LISTING_PHOTO_BASE64 + 20_000);
  const user = await ensureUser(env, session);
  if (!user.hall || !user.year) throw new HttpError(400, 'Add your class year and hall in My Account first.');
  const fields = cleanListingFields(input, false);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM listings WHERE owner = ?').bind(session.sub).first();
  if (n >= MAX_LISTINGS_PER_STUDENT) throw new HttpError(400, `You can have up to ${MAX_LISTINGS_PER_STUDENT} listings. Remove one to add another.`);

  const photos = Array.isArray(input.photos) ? input.photos : [];
  if (photos.length > MAX_LISTING_PHOTOS) throw new HttpError(400, `Add up to ${MAX_LISTING_PHOTOS} photos.`);
  const bytes = photos.map(jpegBytes);
  // Counted only for valid listings, so fixing a form mistake never locks anyone out.
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: 'list:' + session.sub });
    if (!success) throw new HttpError(429, "You're publishing very quickly. Wait a minute and try again.");
  }
  if (bytes.length && !env.PHOTOS) throw new HttpError(500, 'Photo storage is not set up yet.');
  const keys = [];
  for (const b of bytes) keys.push(await storePhoto(env, session, b));

  const id = 'u' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO listings (id, owner, type, title, condition, sem, year1, handoff, open_to_sell, buy_price, photos, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)`)
    .bind(id, session.sub, fields.type, fields.title, fields.condition, fields.sem, fields.year1, fields.handoff, fields.open_to_sell, fields.buy_price ?? null,
      JSON.stringify(keys), now, now).run();
  // "AI Generate AR model" on the List form: the listing is published right away and the model
  // follows in the background. A failure to start doesn't undo the listing.
  if (input.generateAr && keys.length) {
    try { await startArModel(env, ctx, session, { id, photos: JSON.stringify(keys), title: fields.title, type: fields.type, condition: fields.condition }); } catch { /* retry from the listing page */ }
  }
  return getListing(env, session.sub, id, photoBase);
}

async function ownListing(env, session, id) {
  const row = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'That listing no longer exists.');
  if (row.owner !== session.sub) throw new HttpError(403, 'You can only change your own listings.');
  return row;
}

/** A base64 JPEG from the app, checked and decoded. */
function jpegBytes(p) {
  if (typeof p !== 'string' || p.length > MAX_LISTING_PHOTO_BASE64 || !BASE64.test(p)) throw new HttpError(400, 'Each photo must be a JPEG under 1 MB.');
  const b = Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
  if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) throw new HttpError(400, 'Each photo must be a JPEG under 1 MB.');
  return b;
}
async function storePhoto(env, session, bytes) {
  if (!env.PHOTOS) throw new HttpError(500, 'Photo storage is not set up yet.');
  const key = crypto.randomUUID() + '.jpg';
  await env.PHOTOS.put(key, bytes, { metadata: { type: 'image/jpeg', owner: session.sub } });
  return key;
}

/**
 * Edits your own listing: any of the listing fields, status 'available' / 'paused', and photos.
 * `photos` is the new photo list in order: { key } keeps one of the listing's current photos and
 * { data } (base64 JPEG) adds a new one; photos left out are deleted. If the photos change and the
 * listing has an AI AR model, the model is rebuilt from the new photos.
 */
async function updateListing(request, env, ctx, session, id, photoBase) {
  const input = await readJson(request, MAX_LISTING_PHOTOS * MAX_LISTING_PHOTO_BASE64 + 20_000);
  const row = await ownListing(env, session, id);
  const fields = cleanListingFields(input, true);
  if (input.status !== undefined) {
    if (!['available', 'paused'].includes(input.status)) throw new HttpError(400, 'Unknown listing status.');
    fields.status = input.status;
  }
  const current = JSON.parse(row.photos || '[]');
  let removed = [], photosChanged = false;
  if (input.photos !== undefined) {
    if (!Array.isArray(input.photos) || input.photos.length > MAX_LISTING_PHOTOS) throw new HttpError(400, `Add up to ${MAX_LISTING_PHOTOS} photos.`);
    // Check everything before storing anything.
    const plan = input.photos.map((p) => {
      if (p && typeof p.key === 'string') {
        if (!current.includes(p.key)) throw new HttpError(400, 'One of those photos is no longer on this listing. Reload and try again.');
        return { key: p.key };
      }
      if (p && p.data !== undefined) return { bytes: jpegBytes(p.data) };
      throw new HttpError(400, 'Each photo must be a JPEG under 1 MB.');
    });
    const keys = [];
    for (const p of plan) keys.push(p.key || await storePhoto(env, session, p.bytes));
    removed = current.filter((k) => !keys.includes(k));
    photosChanged = JSON.stringify(keys) !== JSON.stringify(current);
    if (photosChanged) fields.photos = JSON.stringify(keys);
  }
  const cols = Object.keys(fields);
  if (cols.length) {
    await env.DB.prepare(`UPDATE listings SET ${cols.map((c) => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...cols.map((c) => fields[c]), Date.now(), row.id).run();
  }
  if (removed.length && env.PHOTOS) await Promise.all(removed.map((k) => env.PHOTOS.delete(k)));
  if (photosChanged) {
    const ar = await env.DB.prepare('SELECT status FROM ar_models WHERE listing_id = ?').bind(id).first();
    if (ar) {
      const updated = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();
      if (JSON.parse(updated.photos).length) {
        try { await startArModel(env, ctx, session, updated); } catch { /* the owner can retry from the listing page */ }
      } else {
        await env.DB.prepare('DELETE FROM ar_models WHERE listing_id = ?').bind(id).run(); // no photos left to model
      }
    }
  }
  return getListing(env, session.sub, id, photoBase);
}

async function deleteListing(env, session, id) {
  const row = await ownListing(env, session, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM listings WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM favorites WHERE listing_id = ?').bind(id),
    env.DB.prepare('DELETE FROM ar_models WHERE listing_id = ?').bind(id),
  ]);
  if (env.PHOTOS) await Promise.all(JSON.parse(row.photos || '[]').map((k) => env.PHOTOS.delete(k)));
}

async function servePhoto(env, key) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
  if (!/^[0-9a-f-]{36}\.jpg$/.test(key) || !env.PHOTOS) return new Response('Not found', { status: 404, headers });
  const data = await env.PHOTOS.get(key, 'arrayBuffer');
  if (!data) return new Response('Not found', { status: 404, headers });
  return new Response(data, { headers: { ...headers, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
}

async function listFavorites(env, sub) {
  const { results } = await env.DB.prepare('SELECT listing_id FROM favorites WHERE sub = ? ORDER BY created_at DESC LIMIT 200').bind(sub).all();
  return results.map((r) => r.listing_id);
}

async function setFavorite(env, sub, listingId, on) {
  if (on) {
    await env.DB.prepare('INSERT OR IGNORE INTO favorites (sub, listing_id, created_at) VALUES (?, ?, ?)').bind(sub, listingId, Date.now()).run();
  } else {
    await env.DB.prepare('DELETE FROM favorites WHERE sub = ? AND listing_id = ?').bind(sub, listingId).run();
  }
  return listFavorites(env, sub);
}

/* ---------------- Chat ---------------- */

const MAX_MESSAGE = 1000;
const PLAN_LABEL = { sem: 'Semester', yr: 'Full year' };
const HANDOFF_LABEL = { drop: 'Delivery to their hall lobby', pick: 'Pickup' };

// One query for a student's conversations: the other student, the latest message, and how many are unread.
const CONV_SELECT = `SELECT c.*, o.given AS o_given, o.family AS o_family, o.name AS o_name, o.year AS o_year, o.hall AS o_hall,
    lm.text AS last_text, lm.sender AS last_sender, lm.kind AS last_kind,
    (SELECT COUNT(*) FROM messages m WHERE m.conv_id = c.id AND m.sender != ?1
       AND m.id > CASE WHEN c.buyer = ?1 THEN c.buyer_read ELSE c.seller_read END) AS unread
  FROM conversations c
  JOIN users o ON o.sub = CASE WHEN c.buyer = ?1 THEN c.seller ELSE c.buyer END
  LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE conv_id = c.id)`;

function convOut(row, me, photoBase) {
  return {
    id: row.id,
    role: row.buyer === me ? 'buying' : 'selling',
    listing: { id: row.listing_id, title: row.listing_title, type: row.listing_type, sem: row.listing_sem, photo: row.listing_photo ? photoBase + row.listing_photo : null },
    with: { name: sellerName({ given: row.o_given, family: row.o_family, name: row.o_name }), year: row.o_year || '', hall: row.o_hall || '' },
    last: row.last_text == null ? null : { text: row.last_text, mine: row.last_sender === me, kind: row.last_kind },
    lastAt: row.last_at,
    unread: row.unread || 0,
  };
}

async function listConversations(env, me, photoBase) {
  const { results } = await env.DB.prepare(`${CONV_SELECT} WHERE c.buyer = ?1 OR c.seller = ?1 ORDER BY c.last_at DESC LIMIT 100`).bind(me).all();
  return results.map((r) => convOut(r, me, photoBase));
}

async function myConversation(env, me, id) {
  const row = await env.DB.prepare(`${CONV_SELECT} WHERE c.id = ?2 AND (c.buyer = ?1 OR c.seller = ?1)`).bind(me, id).first();
  if (!row) throw new HttpError(404, 'That conversation was not found.');
  return row;
}

/** Opens (or reopens) the chat between you and the owner of a listing. */
async function startConversation(request, env, session, photoBase) {
  const input = await readJson(request, 5_000);
  const listing = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(String(input.listingId || '')).first();
  if (!listing) throw new HttpError(404, 'That listing no longer exists.');
  if (listing.owner === session.sub) throw new HttpError(400, "That's your own listing.");
  await ensureUser(env, session);
  const now = Date.now();
  await env.DB.prepare(`INSERT OR IGNORE INTO conversations (id, listing_id, buyer, seller, listing_title, listing_type, listing_photo, listing_sem, created_at, last_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('c' + crypto.randomUUID().replace(/-/g, '').slice(0, 16), listing.id, session.sub, listing.owner, listing.title, listing.type,
      JSON.parse(listing.photos || '[]')[0] || '', listing.sem, now, now).run();
  const { id } = await env.DB.prepare('SELECT id FROM conversations WHERE listing_id = ? AND buyer = ?').bind(listing.id, session.sub).first();
  return convOut(await myConversation(env, session.sub, id), session.sub, photoBase);
}

const messageOut = (m, me) => ({ id: m.id, mine: m.sender === me, kind: m.kind, text: m.text, at: m.created_at });

/** Messages after `after` (or the latest 200), and marks them read for you. */
async function readMessages(env, session, id, after, photoBase) {
  const row = await myConversation(env, session.sub, id);
  const { results } = after > 0
    ? await env.DB.prepare('SELECT * FROM messages WHERE conv_id = ? AND id > ? ORDER BY id LIMIT 200').bind(id, after).all()
    : await env.DB.prepare('SELECT * FROM (SELECT * FROM messages WHERE conv_id = ? ORDER BY id DESC LIMIT 200) ORDER BY id').bind(id).all();
  const newest = results.length ? results[results.length - 1].id : 0;
  const col = row.buyer === session.sub ? 'buyer_read' : 'seller_read';
  if (newest > row[col]) await env.DB.prepare(`UPDATE conversations SET ${col} = ? WHERE id = ?`).bind(newest, id).run();
  return { conversation: convOut({ ...row, unread: 0 }, session.sub, photoBase), messages: results.map((m) => messageOut(m, session.sub)) };
}

/**
 * Sends a message. Instead of (or with) text, the buyer can send an event the server words itself:
 * `rent` (with plan 'sem'|'yr' and handoff 'drop'|'pick'), `buy` (with handoff) or `confirm` (handoff done).
 */
async function sendMessage(request, env, session, id) {
  const input = await readJson(request, 10_000);
  const row = await myConversation(env, session.sub, id);
  const buyer = row.buyer === session.sub;
  const out = [];
  if (input.event !== undefined) {
    if (!buyer) throw new HttpError(400, 'Only the renter can do that.');
    if (input.event === 'rent') {
      if (!PLAN_LABEL[input.plan] || !HANDOFF_LABEL[input.handoff]) throw new HttpError(400, 'Choose a rental length and handoff.');
      out.push(['sys', `Rental request · ${PLAN_LABEL[input.plan]} · ${HANDOFF_LABEL[input.handoff]}`]);
    } else if (input.event === 'buy') {
      if (!HANDOFF_LABEL[input.handoff]) throw new HttpError(400, 'Choose a handoff.');
      const l = await env.DB.prepare('SELECT open_to_sell, buy_price FROM listings WHERE id = ?').bind(row.listing_id).first();
      if (!l || !l.open_to_sell || !l.buy_price) throw new HttpError(400, "This item isn't for sale.");
      out.push(['sys', `Purchase request · $${l.buy_price} · ${HANDOFF_LABEL[input.handoff]}`]);
    } else if (input.event === 'confirm') {
      out.push(['sys', 'Handoff confirmed by the renter']);
    } else throw new HttpError(400, 'Unknown event.');
  }
  if (input.text !== undefined) {
    const text = String(input.text).trim();
    if (!text) throw new HttpError(400, 'Type a message.');
    if (text.length > MAX_MESSAGE) throw new HttpError(400, `Keep messages under ${MAX_MESSAGE} characters.`);
    out.push(['text', text]);
  }
  if (!out.length) throw new HttpError(400, 'Type a message.');
  if (env.MSG_LIMITER) {
    const { success } = await env.MSG_LIMITER.limit({ key: session.sub });
    if (!success) throw new HttpError(429, "You're sending messages very quickly. Wait a moment and try again.");
  }
  const now = Date.now();
  const sent = [];
  for (const [kind, text] of out) {
    const r = await env.DB.prepare('INSERT INTO messages (conv_id, sender, kind, text, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
      .bind(id, session.sub, kind, text, now).first();
    sent.push(messageOut(r, session.sub));
  }
  // Your own messages count as read.
  await env.DB.prepare(`UPDATE conversations SET last_at = ?, ${buyer ? 'buyer_read' : 'seller_read'} = ? WHERE id = ?`)
    .bind(now, sent[sent.length - 1].id, id).run();
  return sent;
}

/* ---------------- AI-generated AR models (prompt and checks in ar.js) ---------------- */

// Generation takes about 30-60 seconds (effort 'high', see ar.js). It runs in the ArJobs Durable
// Object's alarm, which may run for minutes after the seller's request has returned. Anything still
// "in progress" after AR_STALE_MS has died and shows as failed, so the seller can retry.
const AR_TIMEOUT_MS = 150_000;
const AR_STALE_MS = 5 * 60_000;
const AR_CATEGORY = { micro: 'Kitchen', tv: 'Tech', bean: 'Seating', lamp: 'Lighting', floor: 'Lighting', fan: 'Cooling', topper: 'Sleep', cart: 'Storage' };

function arOut(row) {
  if (!row.ar_status) return null;
  if (row.ar_status === 'in_progress' && Date.now() - row.ar_started_at > AR_STALE_MS) {
    return { status: 'failed', error: 'Generation took too long. Try again.' };
  }
  return { status: row.ar_status, error: row.ar_status === 'failed' ? row.ar_error || 'Generation failed. Try again.' : '' };
}

/** Marks the listing's model as in progress and builds it in the background. */
async function startArModel(env, ctx, session, listing) {
  if (!JSON.parse(listing.photos || '[]').length) throw new HttpError(400, 'Add a photo first. The AR model is built from your photos.');
  if (!(env.ANTHROPIC_AR_KEY || env.ANTHROPIC_API_KEY)) throw new HttpError(500, 'AR model generation is not set up yet.');
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: 'ar:' + session.sub });
    if (!success) throw new HttpError(429, "You're generating AR models very quickly. Wait a minute and try again.");
  }
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO ar_models (listing_id, status, error, spec, started_at, finished_at) VALUES (?, 'in_progress', '', NULL, ?, NULL)
    ON CONFLICT(listing_id) DO UPDATE SET status = 'in_progress', error = '', spec = NULL, started_at = excluded.started_at, finished_at = NULL`)
    .bind(listing.id, now).run();
  const job = { listing: { id: listing.id, photos: listing.photos, title: listing.title, type: listing.type, condition: listing.condition }, startedAt: now };
  if (env.AR_JOBS) await env.AR_JOBS.get(env.AR_JOBS.idFromName(listing.id)).start(job);
  else ctx.waitUntil(buildArModel(env, job.listing, now)); // local fallback: limited to ~30 s
}

/**
 * One Durable Object per listing runs its AR generation from an alarm, which isn't tied to the
 * seller's request and can wait the minute or so Claude needs. Errors are recorded as "failed"
 * inside buildArModel, so the alarm never throws (a throw would make Cloudflare retry it).
 */
export class ArJobs extends DurableObject {
  async start(job) {
    await this.ctx.storage.put('job', job);
    await this.ctx.storage.setAlarm(Date.now());
  }
  async alarm() {
    const job = await this.ctx.storage.get('job');
    if (!job) return;
    await this.ctx.storage.delete('job');
    await buildArModel(this.env, job.listing, job.startedAt);
  }
}

async function buildArModel(env, listing, startedAt) {
  const finish = (status, error, spec) => env.DB.prepare(
    "UPDATE ar_models SET status = ?, error = ?, spec = ?, finished_at = ? WHERE listing_id = ? AND started_at = ?")
    .bind(status, error, spec ? JSON.stringify(spec) : null, Date.now(), listing.id, startedAt).run();
  try {
    const keys = JSON.parse(listing.photos || '[]').slice(0, 4); // every photo the seller added (at most 4)
    const photos = [];
    for (const k of keys) {
      const buf = await env.PHOTOS.get(k, 'arrayBuffer');
      if (buf) photos.push(bytesToB64(new Uint8Array(buf)));
    }
    if (!photos.length) return finish('failed', 'The listing photo could not be read.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(AR_TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_AR_KEY || env.ANTHROPIC_API_KEY,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify(arRequest(photos, { title: listing.title, category: AR_CATEGORY[listing.type] || listing.type, condition: listing.condition })),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return finish('failed', res.status === 429 || res.status === 529 ? 'The AI is busy right now. Try again in a minute.' : 'The AI had a problem. Try again.');
    if (json.stop_reason === 'refusal') return finish('failed', "Claude couldn't model this item from the photos.");
    if (json.stop_reason === 'max_tokens') return finish('failed', 'The model description was cut off. Try again.');
    const block = (json.content || []).find((b) => b.type === 'text');
    let raw;
    try { raw = JSON.parse(block.text); } catch { return finish('failed', "Couldn't read the AI's answer. Try again."); }
    const { spec, problem } = cleanArSpec(raw);
    return spec ? finish('success', '', spec) : finish('failed', problem);
  } catch (err) {
    return finish('failed', err && err.name === 'TimeoutError' ? 'Generation took too long. Try again.' : 'Generation failed. Try again.');
  }
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function retryArModel(env, ctx, session, id, photoBase) {
  const listing = await ownListing(env, session, id);
  await startArModel(env, ctx, session, listing);
  return getListing(env, session.sub, id, photoBase);
}

async function getArModel(env, id) {
  const row = await env.DB.prepare('SELECT a.*, l.id AS lid FROM ar_models a JOIN listings l ON l.id = a.listing_id WHERE a.listing_id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'This listing has no AR model.');
  const ar = arOut({ ar_status: row.status, ar_error: row.error, ar_started_at: row.started_at });
  return { ...ar, spec: ar.status === 'success' ? JSON.parse(row.spec) : null };
}
