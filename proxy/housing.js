// USC Housing rules check for new listings. Claude looks at the photos (and title) and says which USC
// Housing rule, if any, the item may fall under; the decision itself is made here, from the rule list:
//
//   prohibited + clear   -> blocked: the listing can't be published
//   prohibited + unsure  -> the seller must confirm the specific thing Claude couldn't see (e.g. LED bulbs)
//   restricted           -> allowed, and the listing tells renters where USC Housing allows it
//
// Sources (USC Housing, 2026-27):
//   - 2026-2027 Housing & Hospitality Services Contract & Living Agreement, section O "Prohibited Possessions"
//     https://housing.usc.edu/index.php/publication/2026-2027-living-agreement/
//   - Fall 2026 Arriving Guide (undergraduate), "Please Don't Bring" and "Prohibited Possessions"
//     https://housing.usc.edu/wp-content/uploads/2026/08/Arriving-Guide-Fall-2026-UND_FNL-WebV2.pdf
// Update RULES when USC Housing publishes a new Living Agreement.

import { HttpError } from './worker.js';

export const HOUSING_SOURCE = 'https://housing.usc.edu/index.php/publication/2026-2027-living-agreement/';

/**
 * level: 'prohibited' (not allowed anywhere in USC Housing) or 'restricted' (allowed in some places).
 * what: what the rule covers, written for Claude and shown to students.
 * confirm: what the seller confirms when Claude can't tell from the photos (prohibited rules only).
 * note: what renters see on a restricted item.
 */
export const RULES = [
  { id: 'candles_incense', level: 'prohibited', label: 'Candles and incense',
    what: 'Candles (wax, scented, decorative) and incense of any kind, including candle warmers that hold an open flame.',
    confirm: 'This has no candle or incense in it.' },
  { id: 'open_flame', level: 'prohibited', label: 'Open flames, barbecues and hibachis',
    what: 'Anything that keeps an open flame: barbecues, hibachis, camping stoves, sterno, torches, lighters sold as decor.',
    confirm: "This doesn't use an open flame." },
  { id: 'heater_ac', level: 'prohibited', label: 'Space heaters and air conditioning units',
    what: 'Space heaters, heated fans and individual air conditioning units (window or portable AC). A plain electric fan is fine.',
    confirm: "It's a fan only: it doesn't heat or air-condition." },
  { id: 'non_led_lighting', level: 'prohibited', label: 'Non-LED lamps and lights',
    what: 'Halogen and incandescent halogen lamps, torchiere-style lamps that are not LED, non-LED decorative string lights, and strobe lights. LED lamps and LED string lights are allowed.',
    confirm: 'It uses LED bulbs (not halogen or incandescent) and has no strobe.' },
  { id: 'personal_bed', level: 'prohibited', label: 'Personal beds and waterbeds',
    what: 'Beds, bed frames, mattresses and waterbeds brought in by residents. Mattress toppers, pillows and bedding are fine.',
    confirm: "It's a topper or bedding, not a bed or mattress." },
  { id: 'dart_board', level: 'prohibited', label: 'Dart boards',
    what: 'Dart boards and darts.', confirm: "It isn't a dart board." },
  { id: 'smoking', level: 'prohibited', label: 'E-cigarettes, vapes, hookahs and tobacco',
    what: 'E-cigarettes, vapes, hookahs, tobacco, cloves, shisha and smoking accessories.',
    confirm: "It isn't for smoking or vaping." },
  { id: 'fireworks_hazmat', level: 'prohibited', label: 'Fireworks, explosives and hazardous materials',
    what: 'Fireworks, explosives, flammable liquids, gas canisters, propane and corrosive chemicals.',
    confirm: 'It holds no fuel, gas or hazardous chemicals.' },
  { id: 'laundry_dishwasher', level: 'prohibited', label: 'Washers, dryers and dishwashers',
    what: 'Personal washing machines, clothes dryers and dishwashers (countertop ones too).',
    confirm: "It isn't a washer, dryer or dishwasher." },
  { id: 'vehicles', level: 'prohibited', label: 'Scooters, e-bikes, hoverboards, bikes and skateboards',
    what: 'Electric scooters, e-bikes, hoverboards, motorcycles, bicycles and skateboards; none can be brought into or stored in USC Housing.',
    confirm: "It isn't a scooter, bike, hoverboard or skateboard." },
  { id: 'smoke_machine', level: 'prohibited', label: 'Smoke and fog machines',
    what: 'Smoke machines and fog machines.', confirm: "It isn't a smoke or fog machine." },
  { id: 'weapons', level: 'prohibited', label: 'Weapons and replicas',
    what: 'Firearms, ammunition, replicas, BB/air/paintball guns, any projectile device, knives with blades over 2.5 inches (kitchen knives are fine), retractable-blade knives, stun guns and tasers.',
    confirm: "It isn't a weapon or a replica of one." },
  { id: 'satellite_router', level: 'prohibited', label: 'Satellite dishes and personal WiFi routers',
    what: 'Satellite dishes or TV receivers and personal WiFi routers (USC buildings have USC Wireless).',
    confirm: "It isn't a satellite dish or a WiFi router." },
  { id: 'piano_shopping_cart', level: 'prohibited', label: 'Pianos and shopping carts',
    what: 'Personal pianos and store shopping carts. A small rolling storage cart or utility cart is not a shopping cart.',
    confirm: "It isn't a piano or a store shopping cart." },
  { id: 'pets', level: 'prohibited', label: 'Pets and animals',
    what: 'Live animals, and fish tanks over 10 gallons (one tank of 10 gallons or less is allowed).',
    confirm: 'It isn\'t an animal, and any fish tank is 10 gallons or less.' },
  { id: 'alcohol_drugs', level: 'prohibited', label: 'Alcohol and drugs',
    what: 'Alcohol, drugs, and drug paraphernalia.', confirm: "It isn't alcohol, drugs or paraphernalia." },
  { id: 'cooking_appliance', level: 'restricted', label: 'Cooking appliances',
    what: 'Microwave ovens, hot plates, toaster ovens, water heaters and electric kettles, coffee makers, rice cookers, air fryers and other cooking appliances.',
    note: 'USC Housing allows cooking appliances only in units with a kitchen, not in residence hall rooms.' },
  { id: 'mini_fridge', level: 'restricted', label: 'Mini fridges',
    what: 'Mini fridges and microfridges. USC Housing limits them to 4.5 cubic feet and to spaces it approves; residence hall rooms already have a microwave/fridge unit.',
    note: 'USC Housing allows mini fridges up to 4.5 cubic feet, only where Housing approves. Residence hall rooms already have one.' },
];
const RULE_IDS = RULES.map((r) => r.id);
const byId = Object.fromEntries(RULES.map((r) => [r.id, r]));

export const HOUSING_SYSTEM_PROMPT = `You check items that USC students want to list on TroShare, an app where students rent dorm items to each other, against USC Housing's rules on what residents may have in university housing. You look at the seller's photos and title and report which rules the item may fall under. You don't decide whether it's allowed; the app does that from your answer.

The rules (id: what it covers):
${RULES.map((r) => `- ${r.id}: ${r.what}`).join('\n')}

For each rule the item may fall under, add a finding with:
- rule: the rule id.
- certainty: "clear" when the photos or title plainly show the item is covered (for example a candle, a space heater, an e-scooter, a box marked halogen); "unsure" when it might be covered but you can't tell from what's visible (for example a floor lamp whose bulb type you can't see, a fan that might also heat, a box whose contents you can't see).
- reason: one short sentence, written to the seller, saying what you saw.

Be accurate and fair: most dorm items (fans, LED desk lamps, chairs, bean bags, TVs, storage carts, mattress toppers, rugs, mirrors) fall under no rule, and then findings is empty. Only add a rule the item could really fall under. Judge the item itself, not the background of the photo. If there are no photos, judge from the title.
item: name the item in a few words.`;

export const HOUSING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['item', 'findings'],
  properties: {
    item: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rule', 'certainty', 'reason'],
        properties: {
          rule: { type: 'string', enum: RULE_IDS },
          certainty: { type: 'string', enum: ['clear', 'unsure'] },
          reason: { type: 'string' },
        },
      },
    },
  },
};

export function housingRequest(photos, title) {
  const content = photos.flatMap((data, i) => [
    ...(photos.length > 1 ? [{ type: 'text', text: `Photo ${i + 1} of ${photos.length}:` }] : []),
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
  ]);
  content.push({ type: 'text', text: `Listing title: ${title || '(none)'}\nWhich USC Housing rules might this item fall under?` });
  return {
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    system: HOUSING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: HOUSING_SCHEMA } },
    fallbacks: 'default',
  };
}

/**
 * Turns Claude's findings into the decision. Returns { verdict, item, blocked[], confirm[], restricted[] }:
 * verdict is 'blocked', 'confirm', 'restricted' or 'ok'.
 */
export function decide(answer) {
  const str = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const out = { item: str(answer && answer.item, 60), blocked: [], confirm: [], restricted: [] };
  const seen = new Set();
  for (const f of (answer && Array.isArray(answer.findings) ? answer.findings : [])) {
    const r = byId[f && f.rule];
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    const base = { rule: r.id, label: r.label, reason: str(f.reason, 200) };
    if (r.level === 'restricted') out.restricted.push({ ...base, note: r.note });
    else if (f.certainty === 'clear') out.blocked.push(base);
    else out.confirm.push({ ...base, confirm: r.confirm });
  }
  out.verdict = out.blocked.length ? 'blocked' : (out.confirm.length ? 'confirm' : (out.restricted.length ? 'restricted' : 'ok'));
  return out;
}

/** Asks Claude about one item. Throws HttpError 503 when the check can't run (the listing then waits). */
export async function checkHousing(env, photos, title) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(503, "The USC Housing check isn't set up yet, so listings can't be published.");
  const res = await fetch((env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', { // base URL is only overridden in local tests
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify(housingRequest(photos, title)),
  }).catch(() => null);
  const json = res && await res.json().catch(() => null);
  const unavailable = () => new HttpError(503, "Couldn't check this against USC Housing rules right now. Try again in a minute.");
  if (!res || !res.ok || !json) throw unavailable();
  // A refusal here means Claude wouldn't describe the photos; treat it as something a person should look at.
  if (json.stop_reason === 'refusal') return { ...decide({ item: '', findings: [] }), verdict: 'blocked', blocked: [{ rule: 'review', label: 'Needs a closer look', reason: "These photos couldn't be checked. Try different photos of just the item." }] };
  const block = (json.content || []).find((b) => b.type === 'text');
  try { return decide(JSON.parse(block.text)); } catch { throw unavailable(); }
}

/* ---- Check tokens: a check the seller already ran, signed, so publishing doesn't pay for it twice ---- */

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)));

/** A fingerprint of exactly what was checked: the photos (as sent) and the title. */
export async function contentHash(photos, title) {
  const data = enc.encode(String(title || '').trim().toLowerCase() + '\n' + photos.join('\n'));
  return b64u(await crypto.subtle.digest('SHA-256', data));
}
async function sign(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode('housing-check:' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
export async function makeCheckToken(env, sub, hash, result) {
  const body = b64u(enc.encode(JSON.stringify({ sub, hash, result, exp: Date.now() + 30 * 60_000 })));
  return body + '.' + await sign(env.SESSION_SECRET, body);
}
/** The checked result if the token is genuine, unexpired, this student's, and for this exact content; else null. */
export async function readCheckToken(env, sub, hash, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || sig !== await sign(env.SESSION_SECRET, body)) return null;
  try {
    const t = JSON.parse(fromB64u(body));
    return t.sub === sub && t.hash === hash && t.exp > Date.now() ? t.result : null;
  } catch { return null; }
}

/** POST /listings/check: the seller's photos + title in; the decision and a token to publish with out. */
export async function checkListing(request, env, session) {
  let input;
  try { input = await request.json(); } catch { throw new HttpError(400, 'The request was not valid JSON.'); }
  const photos = Array.isArray(input.photos) ? input.photos : [];
  const title = String(input.title || '').trim().slice(0, 40);
  if (photos.length > 4 || !photos.every((p) => typeof p === 'string' && p.length <= 1_400_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(p))) {
    throw new HttpError(400, 'Send up to 4 JPEG photos under 1 MB.');
  }
  if (!photos.length && !title) throw new HttpError(400, 'Add a photo or a title first.');
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: 'housing:' + session.sub });
    if (!success) throw new HttpError(429, "You've run a lot of checks in a row. Wait a minute and try again.");
  }
  const result = await checkHousing(env, photos, title);
  const token = await makeCheckToken(env, session.sub, await contentHash(photos, title), result);
  return { ...result, token, source: HOUSING_SOURCE };
}

/**
 * Enforced when a listing is published or its photos/title change: uses the seller's token when it covers
 * exactly this content, otherwise runs the check. Throws 422 when USC Housing doesn't allow the item, or
 * when the seller hasn't confirmed what Claude couldn't see. Returns the restricted notes to store.
 */
export async function enforceHousing(env, session, photos, title, token, confirmed) {
  const hash = await contentHash(photos, title);
  const result = (token && await readCheckToken(env, session.sub, hash, token)) || await checkHousing(env, photos, title);
  if (result.verdict === 'blocked') {
    const e = new HttpError(422, `USC Housing doesn't allow this (${result.blocked.map((b) => b.label).join('; ')}). ${result.blocked[0].reason}`);
    e.details = { housing: result };
    throw e;
  }
  const missing = result.confirm.filter((c) => !(Array.isArray(confirmed) && confirmed.includes(c.rule)));
  if (missing.length) {
    const e = new HttpError(422, `Confirm before publishing: ${missing[0].confirm}`);
    e.details = { housing: result };
    throw e;
  }
  return result.restricted.map((r) => r.rule).join(',');
}

/** Renter-facing notes for the restricted rules stored on a listing. */
export function housingNotes(stored) {
  return String(stored || '').split(',').filter((id) => byId[id]).map((id) => ({ rule: id, label: byId[id].label, note: byId[id].note }));
}
