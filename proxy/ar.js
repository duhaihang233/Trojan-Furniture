// AI-generated AR models for listings.
//
// Claude looks at the seller's photos and describes the item as a few dozen primitive shapes at real
// size (the same kinds of shapes models/build_models.py uses for TroShare's built-in AR models). The
// browser (../armodel.js) turns that description into a textured GLB, so generated models match the
// built-in ones in style. This file holds the prompt, the output schema, and the server-side check
// of what comes back.

export const AR_MODEL = 'claude-opus-5-5';

export const AR_SYSTEM_PROMPT = `You build 3D models of dorm furniture and gadgets for TroShare, an app where USC students rent items to each other. A student uploads photos of the item they're listing, and you describe that item as simple 3D shapes. The app turns your description into a model that other students place in their room with augmented reality (AR), at real size, to see whether it fits.

Your model sits next to TroShare's built-in models, so match their style: a clean, tidy product model made of a few dozen simple shapes with subtle surface textures, like a well-made product mock-up. It is not a photo scan. A student should recognize the exact item from the listing at a glance: its overall shape, proportions, colors, and the few details that set it apart (handles, legs, buttons, a shade, seams, a screen).

Coordinates:
- Units are meters. +Y is up. The floor is y = 0.
- Center the item on x = 0 and z = 0. The item's front faces +Z, toward the viewer. Width runs along X, depth along Z.
- Model the item as it would stand in a room: upright, resting on its own base or feet, at its lowest point y = 0. If the photo shows it lying down, boxed, or held in someone's hand, model it standing normally.

How to work:
1. Identify the item and estimate its real dimensions. Real size matters most, because students use AR to check whether it fits. Combine what the photo shows (proportions, nearby objects for scale) with typical sizes for that kind of product. For example: a desk lamp is about 0.45 m tall, a mini fridge about 0.48 × 0.85 × 0.45 m, a tower fan about 1 m tall, a bean bag about 0.8 m across. Report the size in \`size_m\` as [width, height, depth].
2. Break the item into its main recognizable parts (body, legs, handles, shade, base, cushions, screen, door, cord, and so on). Use 6 to 30 parts and about 30 to 90 shapes in total. Aim for medium detail: get the silhouette and proportions right, round off hard edges where the real item is rounded (for example, ellipsoids or cylinders along soft edges, or a slightly smaller box inset on a larger one for a beveled look), and include details about 1 cm or larger that make the item recognizable (feet, handles, buttons, vents, seams, hinges, panel lines, piping). Leave out anything smaller, and don't model text or logos.
   Before you write the shapes, look at the photo carefully: note how the parts connect, their relative sizes, and where each one sits. Then check your coordinates add up: parts that rest on each other should touch, and the overall size should match \`size_m\`.
3. Build each part from shapes:
   - box: \`center\`, \`size\` [width, height, depth], and \`rotation_deg\` [x, y, z] (degrees, applied in X, then Y, then Z order; use [0, 0, 0] for an upright box).
   - cylinder: a straight rod or disc from \`start\` to \`end\` with \`radius\`. Any direction works.
   - cone: like a cylinder but with \`radius_start\` and \`radius_end\` (a truncated cone; either radius can be 0). Use it for lamp shades, tapered legs, and funnels.
   - ellipsoid: \`center\`, \`radii\` [x, y, z], and \`rotation_deg\`. Use it for cushions, soft or rounded bodies, knobs, and feet.
   - torus: a ring with \`center\`, \`major_radius\` (to the middle of the tube), \`minor_radius\` (tube thickness), and \`axis\`, the direction the hole faces ("y" for a ring lying flat).
   - tube: a bent rod through 2 to 8 \`points\` with \`radius\`. Use it for curved necks, handles, frames, and cords.
4. Make shapes that touch overlap slightly (a few millimeters), so there are no visible gaps. Every part connects to the rest; nothing floats.
5. Give each part a \`finish\` and a \`color\` (#rrggbb) taken from the photo. Use the item's real colors. Pick muted, realistic tones rather than pure saturated colors, and choose plausible colors for parts the photo doesn't show.

Finishes:
- plastic: matte plastic (most appliance bodies, bases, knobs)
- glossy_plastic: shiny plastic or painted metal
- metal: brushed metal (frames, legs, poles)
- chrome: polished metal (shiny trim, chrome legs)
- brass: gold-toned metal
- wood: wood with grain (furniture tops, legs)
- fabric: woven upholstery (sofas, bean bags, chairs)
- knit: soft knit or fleece (throws, plush)
- linen: light woven cloth (lamp shades, curtains)
- leather: leather or faux leather
- quilted: quilted bedding (toppers, comforters)
- rubber: rubber or cord material (feet, cables, tires)
- ceramic: smooth glazed ceramic or stone
- glass: glass (only for clear parts; it renders as a smooth tinted surface)
- screen: a powered-off display or monitor screen (flat panels facing +Z)
- light: the glowing inside of a lamp shade or a light bulb

Model the physical object the photos actually show, even if it doesn't match the listing's title or category; the student is renting what's in the photo. Only if the photos show no physical object at all (for example, a screenshot, a map, a document, or just a person or a room with nothing in focus), set \`ok\` to false, explain why in \`problem\` in one short sentence addressed to the seller (for example, "This photo shows a map, not an item; add a photo of the item itself."), and return an empty \`parts\` list.`;

const vec3 = { type: 'array', items: { type: 'number' }, description: '[x, y, z] in meters' };
const FINISHES = ['plastic', 'glossy_plastic', 'metal', 'chrome', 'brass', 'wood', 'fabric', 'knit', 'linen', 'leather', 'quilted', 'rubber', 'ceramic', 'glass', 'screen', 'light'];
const shape = (type, props) => ({
  type: 'object',
  properties: { type: { type: 'string', const: type }, ...props },
  required: ['type', ...Object.keys(props)],
  additionalProperties: false,
});

export const AR_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problem: { type: 'string', description: 'One short sentence on why the item could not be modeled; empty when ok is true.' },
    item: { type: 'string', description: 'What the item is, in a few words.' },
    size_m: { ...vec3, description: 'Overall [width, height, depth] in meters.' },
    parts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          finish: { type: 'string', enum: FINISHES },
          color: { type: 'string', description: '#rrggbb' },
          shapes: {
            type: 'array',
            items: {
              anyOf: [
                shape('box', { center: vec3, size: vec3, rotation_deg: vec3 }),
                shape('cylinder', { start: vec3, end: vec3, radius: { type: 'number' } }),
                shape('cone', { start: vec3, end: vec3, radius_start: { type: 'number' }, radius_end: { type: 'number' } }),
                shape('ellipsoid', { center: vec3, radii: vec3, rotation_deg: vec3 }),
                shape('torus', { center: vec3, major_radius: { type: 'number' }, minor_radius: { type: 'number' }, axis: { type: 'string', enum: ['x', 'y', 'z'] } }),
                shape('tube', { points: { type: 'array', items: vec3 }, radius: { type: 'number' } }),
              ],
            },
          },
        },
        required: ['name', 'finish', 'color', 'shapes'],
        additionalProperties: false,
      },
    },
  },
  required: ['ok', 'problem', 'item', 'size_m', 'parts'],
  additionalProperties: false,
};

/** Messages API request body for one listing. `photos` are base64 JPEGs. */
export function arRequest(photos, listing) {
  const content = photos.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }));
  content.push({
    type: 'text',
    text: `Build the 3D model for this TroShare listing.\nTitle: ${listing.title}\nCategory: ${listing.category}\nCondition: ${listing.condition}`,
  });
  return {
    model: AR_MODEL,
    max_tokens: 32000,
    system: AR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    // Thinking lets Claude plan proportions and check its coordinates before writing them; with
    // effort 'high' a model takes about 30-60 seconds.
    thinking: { type: 'adaptive' },
    output_config: { effort: AR_EFFORT, format: { type: 'json_schema', schema: AR_SCHEMA } },
    fallbacks: 'default',
  };
}
export const AR_EFFORT = 'high';

const MAX_PARTS = 32;
const MAX_SHAPES = 120;
const LIMIT = 3; // meters from the center; dorm items are smaller than this

// Keeps whole sentences, up to about 160 characters.
function shortReason(text) {
  const t = String(text || '').trim() || 'Claude could not model this item from the photos.';
  if (t.length <= 160) return t;
  const cut = t.slice(0, 160);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > 40 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
}

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const v3 = (v, lo, hi) => (Array.isArray(v) && v.length === 3 ? v.map((x) => num(x, lo, hi)) : null);
const ok3 = (v) => v && v.every((x) => x !== null);

/**
 * Checks Claude's description and keeps only well-formed shapes, so the browser can trust it.
 * Returns { spec } or { problem } when nothing usable is left.
 */
export function cleanArSpec(raw) {
  if (!raw || typeof raw !== 'object') return { problem: 'The model description was empty.' };
  if (raw.ok === false) return { problem: shortReason(raw.problem) };
  let shapes = 0;
  const parts = [];
  for (const p of Array.isArray(raw.parts) ? raw.parts.slice(0, MAX_PARTS) : []) {
    if (!p || !FINISHES.includes(p.finish)) continue;
    const color = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color.toLowerCase() : '#808080';
    const out = [];
    for (const s of Array.isArray(p.shapes) ? p.shapes : []) {
      if (shapes + out.length >= MAX_SHAPES || !s) break;
      let c = null;
      if (s.type === 'box') {
        c = { type: 'box', center: v3(s.center, -LIMIT, LIMIT), size: v3(s.size, 0.001, 2 * LIMIT), rotation_deg: v3(s.rotation_deg, -360, 360) || [0, 0, 0] };
        if (!ok3(c.center) || !ok3(c.size)) c = null;
      } else if (s.type === 'cylinder' || s.type === 'cone') {
        c = { type: 'cone', start: v3(s.start, -LIMIT, LIMIT), end: v3(s.end, -LIMIT, LIMIT),
          radius_start: num(s.type === 'cone' ? s.radius_start : s.radius, 0, LIMIT), radius_end: num(s.type === 'cone' ? s.radius_end : s.radius, 0, LIMIT) };
        if (!ok3(c.start) || !ok3(c.end) || c.radius_start === null || c.radius_end === null || c.radius_start + c.radius_end <= 0) c = null;
      } else if (s.type === 'ellipsoid') {
        c = { type: 'ellipsoid', center: v3(s.center, -LIMIT, LIMIT), radii: v3(s.radii, 0.001, LIMIT), rotation_deg: v3(s.rotation_deg, -360, 360) || [0, 0, 0] };
        if (!ok3(c.center) || !ok3(c.radii)) c = null;
      } else if (s.type === 'torus') {
        c = { type: 'torus', center: v3(s.center, -LIMIT, LIMIT), major_radius: num(s.major_radius, 0.001, LIMIT), minor_radius: num(s.minor_radius, 0.0005, LIMIT), axis: ['x', 'y', 'z'].includes(s.axis) ? s.axis : 'y' };
        if (!ok3(c.center) || c.major_radius === null || c.minor_radius === null) c = null;
      } else if (s.type === 'tube') {
        const pts = (Array.isArray(s.points) ? s.points.slice(0, 8) : []).map((q) => v3(q, -LIMIT, LIMIT)).filter(ok3);
        c = { type: 'tube', points: pts, radius: num(s.radius, 0.0005, LIMIT) };
        if (pts.length < 2 || c.radius === null) c = null;
      }
      if (c) out.push(c);
    }
    if (out.length) {
      shapes += out.length;
      parts.push({ name: String(p.name || 'Part').slice(0, 40), finish: p.finish, color, shapes: out });
    }
  }
  if (!parts.length) return { problem: 'Claude did not return any usable shapes.' };
  const size = v3(raw.size_m, 0.01, 2 * LIMIT);
  return { spec: { item: String(raw.item || '').slice(0, 80), size_m: ok3(size) ? size : null, parts } };
}
