// TroShare room-analysis proxy (Cloudflare Worker).
//
// The web app sends room photos here instead of calling Anthropic directly, so visitors never need
// an API key and the key never reaches the browser. The Worker builds the whole Claude request itself
// (model, prompt, schema), so the key can only be used for this one feature.

const ALLOWED_ORIGINS = new Set([
  'https://duhaihang233.github.io',
  'http://127.0.0.1:8765', // local testing
  'http://localhost:8000',
]);

const ITEM_NAMES = {
  tv: '32″ HD TV', bean: 'Bean bag chair', lamp: 'LED desk lamp', floor: 'Floor lamp',
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
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.has(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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
    const path = new URL(request.url).pathname;
    let session;
    try {
      if (request.method === 'POST' && path === '/auth/google') return reply(200, await signIn(request, env));
      session = await readSession(request, env);
      if (!session) return fail(401, 'Please log in with your USC account.');
      if (request.method === 'GET' && path === '/me') return reply(200, { user: publicUser(session), profile: await loadProfile(env, session.sub) });
      if (request.method === 'PUT' && path === '/me/profile') return reply(200, { profile: await saveProfile(request, env, session) });
      if (request.method !== 'POST' || path !== '/analyze-room') return fail(404, 'Not found.');
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

async function loadProfile(env, sub) {
  const saved = env.PROFILES ? await env.PROFILES.get(`profile:${sub}`, 'json') : null;
  return { year: '', hall: '', since: null, ...(saved || {}) };
}

async function signIn(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) throw new HttpError(500, 'Accounts are not set up yet.');
  let input;
  try { input = await request.json(); } catch { throw new HttpError(400, 'The request was not valid JSON.'); }
  const user = await verifyGoogleCredential(input.credential, env.GOOGLE_CLIENT_ID);
  const profile = await loadProfile(env, user.sub);
  if (!profile.since && env.PROFILES) {
    profile.since = new Date().getFullYear();
    await env.PROFILES.put(`profile:${user.sub}`, JSON.stringify(profile));
  }
  const { token, exp } = await makeSessionToken(user, env.SESSION_SECRET);
  return { token, exp, user: publicUser(user), profile };
}

async function saveProfile(request, env, session) {
  let input;
  try { input = await request.json(); } catch { throw new HttpError(400, 'The request was not valid JSON.'); }
  if (!YEARS.includes(input.year)) throw new HttpError(400, 'Choose your class year.');
  if (!HALL_IDS.has(input.hall)) throw new HttpError(400, 'Choose your residence hall.');
  const profile = { ...(await loadProfile(env, session.sub)), year: input.year, hall: input.hall };
  if (!profile.since) profile.since = new Date().getFullYear();
  if (!env.PROFILES) throw new HttpError(500, 'Profiles are not set up yet.');
  await env.PROFILES.put(`profile:${session.sub}`, JSON.stringify(profile));
  return profile;
}
