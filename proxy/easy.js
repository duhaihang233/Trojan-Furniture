// Easy list: Claude reads a seller's photos and fills in the listing (title, category, condition), so the
// seller only sets the price. The Worker builds the whole request (model, prompt, schema) so the API key
// can't be used for anything else, and the answer is checked before it reaches the app.

import { HttpError } from './worker.js';

export const EASY_MODEL = 'claude-opus-5-5';
const CATEGORIES = ['kitchen', 'light', 'cool', 'seat', 'sleep', 'tech', 'storage'];
const CONDITIONS = ['New', 'Like new', 'Good', 'Fair'];
const MAX_PHOTOS = 4;
const MAX_PHOTO_BASE64 = 1_400_000; // the app sends ~640px JPEGs of about 60 KB

export const EASY_SYSTEM_PROMPT = `You fill in listings for TroShare, an app where USC students rent dorm items to each other for a semester or a year. A student uploads photos of something they want to list, and you write the listing details so they only have to set a price. Other students will decide whether to rent the item from what you write, so it must describe what the photos actually show.

Write:
- title: what the item is, the way a student would name it in a listing, in at most 40 characters. Lead with the most useful detail a renter would look for: color, size or type, then the item (for example "Black LED desk lamp", "Gray bean bag chair", "32-inch flat-screen TV", "White 2-door mini fridge"). Include a brand or size only when you can read it in the photo or it is unmistakable; never guess one. Use sentence case and no ending punctuation.
- category, one of:
  kitchen (microwaves, mini fridges, kettles, coffee makers, toasters, rice cookers),
  light (desk lamps, floor lamps, string lights),
  cool (fans, air purifiers, space heaters, humidifiers),
  seat (chairs, desk chairs, bean bags, ottomans, stools),
  sleep (mattress toppers, pillows, bedding, bed risers),
  tech (TVs, monitors, speakers, printers, gaming consoles),
  storage (carts, drawers, shelves, bins, hampers, organizers).
  Pick the closest one; if nothing fits well, use storage.
- condition: judge only from what is visible, and lean toward the lower grade when unsure, because renters trust these labels.
  New: still sealed or in its original packaging.
  Like new: out of the box but no visible wear, marks or stains.
  Good: works and looks fine, with light signs of use.
  Fair: clear wear, scratches, stains, fading or a missing part.
- condition_note: one short sentence saying what you saw that led to the condition (for example "No scratches or marks visible; cord neatly coiled."). The seller sees this, so write it to them plainly.

Several photos are all the same item from different angles; use them together.

Set ok to false, give a one-sentence problem addressed to the seller, and leave the other fields as empty strings (category "storage", condition "Good") when:
- the photos show no single item to list (a screenshot, a document, a person, a whole room with nothing in focus), or
- the item is one students can't rent on TroShare: weapons, drugs or drug paraphernalia, alcohol, vapes, candles or incense, or anything hazardous.
Otherwise set ok to true and problem to an empty string.`;

export const EASY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'problem', 'title', 'category', 'condition', 'condition_note'],
  properties: {
    ok: { type: 'boolean' },
    problem: { type: 'string' },
    title: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES },
    condition: { type: 'string', enum: CONDITIONS },
    condition_note: { type: 'string' },
  },
};

/** Messages API request body for one set of photos (base64 JPEGs). */
export function easyRequest(photos) {
  const content = photos.flatMap((data, i) => [
    ...(photos.length > 1 ? [{ type: 'text', text: `Photo ${i + 1} of ${photos.length}:` }] : []),
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
  ]);
  content.push({ type: 'text', text: 'Fill in the listing for this item.' });
  return {
    model: EASY_MODEL,
    max_tokens: 2000,
    system: EASY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    // A short, well-defined task: low effort keeps it to a few seconds while the seller waits.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EASY_SCHEMA } },
    fallbacks: 'default',
  };
}

/** Checks Claude's answer and trims it to what the listing form accepts. */
export function cleanDraft(d) {
  if (!d || typeof d !== 'object') throw new Error('bad answer');
  const str = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  if (!d.ok) return { ok: false, problem: str(d.problem, 200) || "Claude couldn't find an item to list in these photos. Try a clear photo of just the item." };
  const title = str(d.title, 40).replace(/[.!]+$/, '');
  if (!title) throw new Error('no title');
  return {
    ok: true,
    title,
    category: CATEGORIES.includes(d.category) ? d.category : 'storage',
    condition: CONDITIONS.includes(d.condition) ? d.condition : 'Good',
    conditionNote: str(d.condition_note, 160),
  };
}

/** POST /listings/draft: photos in, suggested title / category / condition out. */
export async function draftListing(request, env, session) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(500, 'Easy list is not set up yet.');
  if (Number(request.headers.get('content-length') || 0) > MAX_PHOTOS * MAX_PHOTO_BASE64 + 10_000) throw new HttpError(413, 'Those photos are too large.');
  let input;
  try { input = await request.json(); } catch { throw new HttpError(400, 'The request was not valid JSON.'); }
  const photos = Array.isArray(input.photos) ? input.photos : [];
  if (!photos.length || photos.length > MAX_PHOTOS) throw new HttpError(400, `Send between 1 and ${MAX_PHOTOS} photos.`);
  if (!photos.every((p) => typeof p === 'string' && p.length <= MAX_PHOTO_BASE64 && /^[A-Za-z0-9+/]+={0,2}$/.test(p))) {
    throw new HttpError(400, 'Each photo must be a JPEG under 1 MB.');
  }
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: 'easy:' + session.sub });
    if (!success) throw new HttpError(429, "You've filled in a lot of listings in a row. Wait a minute and try again.");
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify(easyRequest(photos)),
  }).catch(() => null);
  const json = res && await res.json().catch(() => null);
  if (!res || !res.ok || !json) {
    // Don't pass Anthropic's account-level error details through to students.
    const busy = res && (res.status === 429 || res.status === 529);
    throw new HttpError(busy ? 503 : 502, busy ? 'Easy list is busy right now. Fill it in yourself, or try again in a minute.' : "Easy list couldn't read the photos. Fill it in yourself, or try again.");
  }
  if (json.stop_reason === 'refusal') return { ok: false, problem: "Claude couldn't describe these photos. Try a clear photo of just the item." };
  const block = (json.content || []).find((b) => b.type === 'text');
  try { return { ...cleanDraft(JSON.parse(block.text)), usage: json.usage ? { input: json.usage.input_tokens, output: json.usage.output_tokens } : null }; }
  catch { throw new HttpError(502, "Easy list couldn't read the photos. Fill it in yourself, or try again."); }
}
