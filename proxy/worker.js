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

Recommend 3 to 6 things that would make this room more comfortable or useful, most important first. Base each one on something you can actually see in the photos (for example, no desk lighting, a bare floor by the window, nowhere to store things), and don't suggest things the room already has. When a TroShare item fits, use its id in \`item\`; otherwise use "other". Write reasons in one or two short sentences addressed to the student. In \`placement\`, say where in the room it would go, referring to what's in the photos. Use "must_have" only for things the room clearly lacks.

Add up to 3 short tips that need no purchase (rearranging, using light from the window, and so on). If the photos don't show a room, say so in \`summary\` and return no recommendations.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One or two sentences on what the room has and lacks.' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', enum: [...Object.keys(ITEM_NAMES), 'other'] },
          name: { type: 'string' },
          reason: { type: 'string' },
          priority: { type: 'string', enum: ['must_have', 'nice_to_have'] },
          placement: { type: 'string' },
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
    const reply = (status, body) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
    const fail = (status, message) => reply(status, { error: { message } });

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (!allowed) return fail(403, 'This service only works from the TroShare website.');
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/analyze-room') return fail(404, 'Not found.');
    if (!env.ANTHROPIC_API_KEY) return fail(500, 'The room planner is not set up yet.');

    if (env.LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.LIMITER.limit({ key: ip });
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
