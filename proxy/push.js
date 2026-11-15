// Web Push for TroShare: sends a notification to a student's phone or browser, even when TroShare is closed.
// Standards: Web Push (RFC 8030), VAPID sender identification (RFC 8292), and payload encryption
// with aes128gcm (RFC 8291 / RFC 8188). Everything uses WebCrypto, so there are no dependencies.
//
// Setup: VAPID_PUBLIC_KEY (a [vars] entry in wrangler.toml, also vapidPublicKey in ../config.js) and
// VAPID_PRIVATE_JWK (a Worker secret: the private key as a JWK). VAPID_SUBJECT says who runs the sender.

const enc = new TextEncoder();

export const b64u = {
  encode(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = atob(String(str).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(str).length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/**
 * Encrypts a push message for one subscription (RFC 8291). `p256dh` and `auth` come from the browser's
 * subscription. `asKeys` and `salt` are only passed by tests; normally both are new for every message.
 */
export async function encryptPayload(plaintext, p256dh, auth, { asKeys, salt } = {}) {
  const uaPublic = b64u.decode(p256dh);
  const authSecret = b64u.decode(auth);
  const as = asKeys || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  // HKDF with SHA-256; each expand needs only one block, so it's a single HMAC with a trailing 0x01.
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, Uint8Array.of(1)));
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(s, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), Uint8Array.of(1)))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the message, then the 0x02 "last record" delimiter.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, Uint8Array.of(2))));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(s, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** The VAPID Authorization header for a push service (a signed ES256 JWT, valid for 12 hours). */
export async function vapidAuthorization(endpoint, env, now = Date.now()) {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (obj) => b64u.encode(enc.encode(JSON.stringify(obj)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'https://duhaihang233.github.io/Trojan-Furniture/',
  });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u.encode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** Sends `payload` (an object, sent as JSON) to one subscription. Returns the push service's status code. */
export async function sendPush(env, sub, payload) {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(4 * 24 * 3600),
      Urgency: 'normal',
      Authorization: await vapidAuthorization(sub.endpoint, env),
    },
    body,
  });
  return res.status;
}
