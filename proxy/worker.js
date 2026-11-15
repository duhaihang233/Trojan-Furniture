// TroShare server (Cloudflare Worker).
//
// - Accounts: Google sign-in limited to verified @usc.edu accounts, then a TroShare session token.
// - Data: student profiles, listings and favorites in D1 (schema.sql); listing photos in KV.
// - AI room planner: the web app sends room photos here instead of calling Anthropic directly, so
//   visitors never need an API key and the key never reaches the browser. The Worker builds the whole
//   Claude request itself (model, prompt, schema), so the key can only be used for this one feature.

const ALLOWED_ORIGINS = new Set([
  'https://duhaihang233.github.io',
  'http://127.0.0.1:8765', // local testing
  'http://localhost:8000',
]);

const ITEM_NAMES = {
  micro: 'Compact microwave', tv: '32″ HD TV', bean: 'Bean bag chair', lamp: 'LED desk lamp', floor: 'Floor lamp',
  fan: 'Quiet tower fan', topper: 'XL twin topper', cart: 'Storage cart',
};
const HALLS = new Set(['Webb Tower', 'USC Village', 'University Gateway', 'New North', 'Pardee Tower', 'Parkside']);
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
  async fetch(request, env) {
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
      if (method === 'POST' && path === '/listings') return reply(201, { listing: await createListing(request, env, session, photoBase) });
      const lm = path.match(/^\/listings\/([A-Za-z0-9_-]{1,40})$/);
      if (lm && method === 'PATCH') return reply(200, { listing: await updateListing(request, env, session, lm[1], photoBase) });
      if (lm && method === 'DELETE') { await deleteListing(env, session, lm[1]); return reply(200, { ok: true }); }
      const fm = path.match(/^\/favorites\/([A-Za-z0-9_-]{1,40})$/);
      if (fm && (method === 'PUT' || method === 'DELETE')) return reply(200, { favorites: await setFavorite(env, session.sub, fm[1], method === 'PUT') });
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
const HALL_IDS = new Set(['webb', 'village', 'gateway', 'newnorth', 'pardee', 'parkside']);
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

async function readJson(request, maxBytes) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes) throw new HttpError(413, 'That upload is too large. Try smaller or fewer photos.');
  try { return await request.json(); } catch { throw new HttpError(400, 'The request was not valid JSON.'); }
}

/* ---------------- Listings, photos, favorites ---------------- */

const TYPE_IDS = new Set(Object.keys(ITEM_NAMES));
const CONDITIONS = ['New', 'Like new', 'Good', 'Fair'];
const HANDOFFS = ['both', 'drop', 'pickup'];
const MAX_LISTING_PHOTOS = 4;
const MAX_LISTING_PHOTO_BASE64 = 1_400_000; // ~1 MB; the app uploads ~640px JPEGs of about 60 KB
const MAX_LISTINGS_PER_STUDENT = 20;

const sellerName = (row) => (row.given || row.name || 'Trojan') + (row.family ? ' ' + row.family[0].toUpperCase() + '.' : '');

function listingOut(row, me, photoBase) {
  return {
    id: row.id, type: row.type, title: row.title, condition: row.condition, sem: row.sem, year1: row.year1,
    handoff: row.handoff, openToSell: !!row.open_to_sell, status: row.status, createdAt: row.created_at,
    photos: JSON.parse(row.photos || '[]').map((k) => photoBase + k),
    seller: { name: sellerName(row), year: row.u_year || '', hall: row.u_hall || 'webb', picture: row.u_picture || '' },
    mine: row.owner === me,
  };
}
const LISTING_SELECT = `SELECT l.*, u.given, u.family, u.name, u.year AS u_year, u.hall AS u_hall, u.picture AS u_picture
  FROM listings l JOIN users u ON u.sub = l.owner`;

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
  if (!partial || has('openToSell')) out.open_to_sell = input.openToSell ? 1 : 0;
  return out;
}

async function createListing(request, env, session, photoBase) {
  const input = await readJson(request, MAX_LISTING_PHOTOS * MAX_LISTING_PHOTO_BASE64 + 20_000);
  const user = await ensureUser(env, session);
  if (!user.hall || !user.year) throw new HttpError(400, 'Add your class year and hall in My Account first.');
  const fields = cleanListingFields(input, false);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM listings WHERE owner = ?').bind(session.sub).first();
  if (n >= MAX_LISTINGS_PER_STUDENT) throw new HttpError(400, `You can have up to ${MAX_LISTINGS_PER_STUDENT} listings. Remove one to add another.`);

  const photos = Array.isArray(input.photos) ? input.photos : [];
  if (photos.length > MAX_LISTING_PHOTOS) throw new HttpError(400, `Add up to ${MAX_LISTING_PHOTOS} photos.`);
  const bytes = photos.map((p) => {
    if (typeof p !== 'string' || p.length > MAX_LISTING_PHOTO_BASE64 || !BASE64.test(p)) throw new HttpError(400, 'Each photo must be a JPEG under 1 MB.');
    const b = Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
    if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) throw new HttpError(400, 'Each photo must be a JPEG under 1 MB.');
    return b;
  });
  // Counted only for valid listings, so fixing a form mistake never locks anyone out.
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: 'list:' + session.sub });
    if (!success) throw new HttpError(429, "You're publishing very quickly. Wait a minute and try again.");
  }
  if (bytes.length && !env.PHOTOS) throw new HttpError(500, 'Photo storage is not set up yet.');
  const keys = [];
  for (const b of bytes) {
    const key = crypto.randomUUID() + '.jpg';
    await env.PHOTOS.put(key, b, { metadata: { type: 'image/jpeg', owner: session.sub } });
    keys.push(key);
  }

  const id = 'u' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO listings (id, owner, type, title, condition, sem, year1, handoff, open_to_sell, photos, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)`)
    .bind(id, session.sub, fields.type, fields.title, fields.condition, fields.sem, fields.year1, fields.handoff, fields.open_to_sell,
      JSON.stringify(keys), now, now).run();
  return getListing(env, session.sub, id, photoBase);
}

async function ownListing(env, session, id) {
  const row = await env.DB.prepare('SELECT * FROM listings WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, 'That listing no longer exists.');
  if (row.owner !== session.sub) throw new HttpError(403, 'You can only change your own listings.');
  return row;
}

/** Edits your own listing: any of the listing fields, and status 'available' / 'paused'. Photos stay as they are. */
async function updateListing(request, env, session, id, photoBase) {
  const input = await readJson(request, 20_000);
  const row = await ownListing(env, session, id);
  const fields = cleanListingFields(input, true);
  if (input.status !== undefined) {
    if (!['available', 'paused'].includes(input.status)) throw new HttpError(400, 'Unknown listing status.');
    fields.status = input.status;
  }
  const cols = Object.keys(fields);
  if (cols.length) {
    await env.DB.prepare(`UPDATE listings SET ${cols.map((c) => c + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
      .bind(...cols.map((c) => fields[c]), Date.now(), row.id).run();
  }
  return getListing(env, session.sub, id, photoBase);
}

async function deleteListing(env, session, id) {
  const row = await ownListing(env, session, id);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM listings WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM favorites WHERE listing_id = ?').bind(id),
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
