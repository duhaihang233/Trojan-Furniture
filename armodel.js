/* Builds a textured GLB from an AI model description (see proxy/ar.js), in the same style as the
   built-in models: the shape and texture code below is a port of models/build_models.py.
   window.TS_AR.url(spec) resolves to a blob: URL for <model-viewer>; on iPhone, model-viewer turns it
   into USDZ for AR Quick Look. */
window.TS_AR = (() => {
  'use strict';

  /* ---------- vector math ---------- */
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => { const m = len(a); return m < 1e-10 ? [0, 1, 0] : mul(a, 1 / m); };

  class Part {
    constructor(finish, color) { this.finish = finish; this.color = color; this.p = []; this.n = []; this.uv = []; }
    tri(a, b, c, ua, ub, uc) {
      let n = cross(sub(b, a), sub(c, a));
      if (dot(n, n) < 1e-14) return;
      n = norm(n);
      this.p.push(a, b, c); this.n.push(n, n, n); this.uv.push(ua, ub, uc);
    }
  }

  function quad(part, pts, uvs, inside) {
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    if (dot(n, n) < 1e-14) return;
    if (dot(n, sub(pts[0], inside)) < 0) { pts = [pts[0], pts[3], pts[2], pts[1]]; uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]; }
    part.tri(pts[0], pts[1], pts[2], uvs[0], uvs[1], uvs[2]);
    part.tri(pts[0], pts[2], pts[3], uvs[0], uvs[2], uvs[3]);
  }

  function faceUvs(pts, tile) {
    const e1 = sub(pts[1], pts[0]), e2 = sub(pts[3], pts[0]);
    const l1 = Math.max(len(e1), 1e-8), l2 = Math.max(len(e2), 1e-8);
    return pts.map((p) => { const d = sub(p, pts[0]); return [dot(d, e1) / (l1 * l1) * (l1 / tile), dot(d, e2) / (l2 * l2) * (l2 / tile)]; });
  }

  // Rotation in degrees, applied X then Y then Z (as described to Claude).
  function rotator(deg) {
    const [ax, ay, az] = deg.map((d) => d * Math.PI / 180);
    if (!ax && !ay && !az) return (v) => v;
    const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
    return (v) => {
      let [x, y, z] = v;
      [y, z] = [y * cx - z * sx, y * sx + z * cx];
      [x, z] = [x * cy + z * sy, -x * sy + z * cy];
      [x, y] = [x * cz - y * sz, x * sz + y * cz];
      return [x, y, z];
    };
  }

  function box(part, center, size, rot, tile = 0.12) {
    const r = rotator(rot);
    const [hx, hy, hz] = size.map((s) => s / 2);
    const p = [];
    for (const z of [-1, 1]) for (const y of [-1, 1]) for (const x of [-1, 1]) p.push(add(center, r([x * hx, y * hy, z * hz])));
    for (const [a, b, c, d] of [[1, 5, 7, 3], [4, 0, 2, 6], [2, 3, 7, 6], [0, 4, 5, 1], [5, 4, 6, 7], [0, 1, 3, 2]]) {
      const pts = [p[a], p[b], p[c], p[d]];
      quad(part, pts, faceUvs(pts, tile), center);
    }
  }

  function basis(axis) {
    const tmp = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(axis, tmp));
    return [u, cross(axis, u)];
  }

  function cap(part, ring, center, outward) {
    const outside = add(center, outward), n = ring.length;
    const cuv = ring.map((_, i) => { const a = 2 * Math.PI * i / n; return [0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]; });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let t = [center, ring[i], ring[j]], tu = [[0.5, 0.5], cuv[i], cuv[j]];
      if (dot(cross(sub(t[1], t[0]), sub(t[2], t[0])), sub(outside, center)) < 0) { t = [center, ring[j], ring[i]]; tu = [[0.5, 0.5], cuv[j], cuv[i]]; }
      part.tri(t[0], t[1], t[2], tu[0], tu[1], tu[2]);
    }
  }

  // Cylinder or truncated cone from a to b. Returns the V coordinate at b (for continuous tubes).
  function cone(part, a, b, r0, r1, { n = 28, caps = true, tile = 0.08, v0 = 0 } = {}) {
    const h = len(sub(b, a));
    if (h < 1e-6) return v0;
    const axis = norm(sub(b, a));
    const [u, v] = basis(axis);
    const ra = [], rb = [];
    for (let i = 0; i < n; i++) {
      const ang = 2 * Math.PI * i / n, cu = Math.cos(ang), su = Math.sin(ang);
      ra.push(add(a, add(mul(u, cu * r0), mul(v, su * r0))));
      rb.push(add(b, add(mul(u, cu * r1), mul(v, su * r1))));
    }
    const span = (2 * Math.PI * Math.max(r0, r1, 1e-4)) / tile, v1 = v0 + h / tile, mid = mul(add(a, b), 0.5);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, u0 = span * i / n, u1 = j === 0 ? span : span * j / n;
      quad(part, [ra[i], rb[i], rb[j], ra[j]], [[u0, v0], [u0, v1], [u1, v1], [u1, v0]], mid);
    }
    if (caps) {
      if (r0 > 1e-5) cap(part, ra, a, sub(a, b));
      if (r1 > 1e-5) cap(part, rb, b, sub(b, a));
    }
    return v1;
  }

  // Smooth curve through the points (Catmull-Rom), drawn as a rod with rounded joints.
  function tube(part, pts, radius) {
    const path = [];
    const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let i = 0; i < pts.length - 1; i++) {
      const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      const steps = pts.length > 2 ? 6 : 1;
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        path.push([0, 1, 2].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    path.push(pts[pts.length - 1]);
    const n = radius > 0.02 ? 16 : 10;
    let v = 0;
    for (let i = 0; i < path.length - 1; i++) v = cone(part, path[i], path[i + 1], radius, radius, { n, caps: false, tile: 0.04, v0: v });
    ellipsoid(part, path[0], [radius, radius, radius], [0, 0, 0], 12, 8);
    ellipsoid(part, path[path.length - 1], [radius, radius, radius], [0, 0, 0], 12, 8);
  }

  function torus(part, c, major, minor, axis) {
    const n = 36, m = 12, tile = 0.05;
    // Built lying flat (hole facing +Y), then turned so the hole faces the requested axis.
    const turn = axis === 'x' ? ([x, y, z]) => [y, -x, z] : axis === 'z' ? ([x, y, z]) => [x, -z, y] : (q) => q;
    const P = (x, y, z) => add(c, turn([x, y, z]));
    const rings = [];
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n, row = [];
      for (let j = 0; j < m; j++) {
        const b = 2 * Math.PI * j / m;
        row.push(P((major + minor * Math.cos(b)) * Math.cos(a), minor * Math.sin(b), (major + minor * Math.cos(b)) * Math.sin(a)));
      }
      rings.push(row);
    }
    const us = 2 * Math.PI * major / tile, vs = 2 * Math.PI * minor / tile;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n, a = 2 * Math.PI * (i + 0.5) / n;
      const spine = P(major * Math.cos(a), 0, major * Math.sin(a));
      const u0 = us * i / n, u1 = i2 === 0 ? us : us * i2 / n;
      for (let j = 0; j < m; j++) {
        const j2 = (j + 1) % m, v0 = vs * j / m, v1 = j2 === 0 ? vs : vs * j2 / m;
        quad(part, [rings[i][j], rings[i2][j], rings[i2][j2], rings[i][j2]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], spine);
      }
    }
  }

  function ellipsoid(part, c, radii, rot, seg = 28, ringsN = 16) {
    const r = rotator(rot);
    const rep = [Math.max(1, Math.round(radii[0] * 6)), Math.max(1, Math.round(radii[1] * 4))];
    const rows = [];
    for (let i = 0; i <= ringsN; i++) {
      const v = Math.PI * i / ringsN, sv = Math.sin(v), cv = Math.cos(v), row = [];
      for (let j = 0; j < seg; j++) {
        const u = 2 * Math.PI * j / seg;
        row.push(add(c, r([radii[0] * sv * Math.cos(u), radii[1] * cv, radii[2] * sv * Math.sin(u)])));
      }
      rows.push(row);
    }
    for (let i = 0; i < ringsN; i++) {
      const v0 = rep[1] * i / ringsN, v1 = rep[1] * (i + 1) / ringsN;
      for (let j = 0; j < seg; j++) {
        const k = (j + 1) % seg, u0 = rep[0] * j / seg, u1 = k === 0 ? rep[0] : rep[0] * k / seg;
        quad(part, [rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], c);
      }
    }
  }

  function buildParts(spec) {
    const parts = spec.parts.map((p) => {
      const part = new Part(p.finish, p.color);
      for (const s of p.shapes) {
        if (s.type === 'box') box(part, s.center, s.size, s.rotation_deg);
        else if (s.type === 'cone') {
          const rmax = Math.max(s.radius_start, s.radius_end);
          cone(part, s.start, s.end, s.radius_start, s.radius_end, { n: rmax > 0.05 ? 40 : (rmax > 0.015 ? 24 : 12) });
        } else if (s.type === 'ellipsoid') {
          // Medium detail: big soft shapes get more segments, small knobs fewer.
          const rmax = Math.max(...s.radii);
          ellipsoid(part, s.center, s.radii, s.rotation_deg, rmax > 0.2 ? 44 : (rmax > 0.06 ? 30 : 16), rmax > 0.2 ? 24 : (rmax > 0.06 ? 16 : 10));
        }
        else if (s.type === 'torus') torus(part, s.center, s.major_radius, s.minor_radius, s.axis);
        else if (s.type === 'tube') tube(part, s.points, s.radius);
      }
      return part;
    }).filter((p) => p.p.length);
    // Stand it on the floor, centered (like lift_to_floor in build_models.py).
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    parts.forEach((p) => p.p.forEach((q) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); } }));
    const shift = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2];
    parts.forEach((p) => { p.p = p.p.map((q) => add(q, shift)); });
    return { parts, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }

  /* ---------- textures (port of make_textures in build_models.py) ---------- */
  const TEX_SIZE = 256;
  function noise(octaves, seed) {
    let s = seed;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const out = new Float32Array(TEX_SIZE * TEX_SIZE);
    const ph = [];
    for (let o = 0; o < octaves; o++) ph.push([rand() * 8, rand() * 8, rand() * 8]);
    let lo = Infinity, hi = -Infinity;
    for (let yi = 0; yi < TEX_SIZE; yi++) {
      const y = 2 * Math.PI * yi / TEX_SIZE;
      for (let xi = 0; xi < TEX_SIZE; xi++) {
        const x = 2 * Math.PI * xi / TEX_SIZE;
        let v = 0, amp = 1;
        for (let o = 0; o < octaves; o++) {
          const f = 2 ** o, [p1, p2, p3] = ph[o];
          v += (Math.sin(x * f + p1) * Math.cos(y * f + p2) + Math.sin((x + y) * f * 0.7 + p3)) * amp;
          amp *= 0.55;
        }
        out[yi * TEX_SIZE + xi] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo + 1e-6);
    return out;
  }
  const memo = {};
  const field = (name, make) => memo[name] || (memo[name] = make());
  const N = () => field('n', () => noise(5, 2));
  const FINE = () => field('fine', () => noise(6, 7));
  const pattern = (fn) => { const out = new Float32Array(TEX_SIZE * TEX_SIZE); for (let y = 0; y < TEX_SIZE; y++) for (let x = 0; x < TEX_SIZE; x++) out[y * TEX_SIZE + x] = fn(x, y, y * TEX_SIZE + x); return out; };
  const BRUSH = () => field('brush', () => { const f = FINE(); return pattern((x, y, i) => f[(y >> 6) * TEX_SIZE + x] * 0.7 + f[i] * 0.3); });
  const WEAVE = () => field('weave', () => { const n = N(), f = FINE(); return pattern((x, y, i) => n[i] * 0.5 + f[i] * 0.35 + (0.5 + 0.5 * Math.sin(x / TEX_SIZE * 28)) * 0.09 + (0.5 + 0.5 * Math.sin(y / TEX_SIZE * 28)) * 0.06); });
  const LINEN = () => field('linen', () => { const f = FINE(); return pattern((x, y, i) => f[i] * 0.5 + (0.5 + 0.5 * Math.sin(x / TEX_SIZE * 90)) * (0.5 + 0.5 * Math.sin(y / TEX_SIZE * 90)) * 0.5); });
  const KNIT = () => field('knit', () => { const f = FINE(); return pattern((x, y, i) => f[i] * 0.4 + (0.5 + 0.5 * Math.sin(x / TEX_SIZE * 120 + Math.sin(y / TEX_SIZE * 60) * 2)) * 0.6); });
  const GRAIN = () => field('grain', () => { const n = N(), f = FINE(); return pattern((x, y, i) => (0.5 + 0.5 * Math.sin(y / TEX_SIZE * 50 + n[i] * 9)) * 0.7 + f[i] * 0.3); });
  const QUILT = () => field('quilt', () => { const n = N(), f = FINE(); return pattern((x, y, i) => { const d1 = (x + y) % 36, d2 = (x - y + 1024) % 36; const line = d1 < 2 || d2 < 2 ? 0.45 : 1; return (n[i] * 0.55 + f[i] * 0.45) * 0.4 * line + 0.6 * line; }); });

  // finish -> [pattern, texture contrast, metallic, roughness]
  const FINISH = {
    plastic: [FINE, 0.28, 0, 0.5], glossy_plastic: [FINE, 0.18, 0, 0.26], metal: [BRUSH, 0.4, 0.85, 0.34],
    chrome: [FINE, 0.08, 1, 0.12], brass: [BRUSH, 0.22, 0.9, 0.24], wood: [GRAIN, 0.32, 0, 0.6],
    fabric: [WEAVE, 0.34, 0, 0.86], knit: [KNIT, 0.3, 0, 0.92], linen: [LINEN, 0.16, 0, 0.78],
    leather: [N, 0.2, 0, 0.45], quilted: [QUILT, 0.2, 0, 0.85], rubber: [FINE, 0.15, 0, 0.7],
    ceramic: [N, 0.08, 0, 0.22], glass: [FINE, 0.04, 0.1, 0.06], screen: [N, 0.1, 0.12, 0.16], light: [N, 0.12, 0, 0.35]
  };

  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  async function texturePng(finish, color) {
    const [make, amount] = FINISH[finish];
    const pat = make(), rgb = hexRgb(color);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TEX_SIZE;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
    for (let i = 0; i < pat.length; i++) {
      let shade = 1 - amount + amount * 2 * pat[i];
      if (finish === 'screen') shade *= 0.75 + 0.35 * (1 - (i % TEX_SIZE) / TEX_SIZE) * (1 - Math.floor(i / TEX_SIZE) / TEX_SIZE);
      for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.max(0, Math.min(255, rgb[k] * shade));
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  /* ---------- GLB writer (port of write_glb) ---------- */
  async function glb(parts) {
    const chunks = [];
    let offset = 0;
    const views = [], accessors = [], primitives = [], materials = [], images = [], textures = [], texIndex = {};
    const push = (bytes) => {
      chunks.push(bytes);
      const start = offset;
      offset += bytes.byteLength;
      const pad = (4 - (offset % 4)) % 4;
      if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
      return { start, length: bytes.byteLength };
    };
    for (const part of parts) {
      const key = part.finish + part.color;
      if (key in texIndex) continue;
      const { start, length } = push(await texturePng(part.finish, part.color));
      views.push({ buffer: 0, byteOffset: start, byteLength: length });
      images.push({ bufferView: views.length - 1, mimeType: 'image/png' });
      textures.push({ sampler: 0, source: images.length - 1 });
      texIndex[key] = textures.length - 1;
    }
    for (const part of parts) {
      const count = part.p.length;
      const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), uv = new Float32Array(count * 2);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      part.p.forEach((q, i) => { pos.set(q, i * 3); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); } });
      part.n.forEach((q, i) => nrm.set(q, i * 3));
      part.uv.forEach((q, i) => uv.set(q, i * 2));
      const attrs = {};
      for (const [name, data, type, mn, mx] of [['POSITION', pos, 'VEC3', lo, hi], ['NORMAL', nrm, 'VEC3'], ['TEXCOORD_0', uv, 'VEC2']]) {
        const { start, length } = push(new Uint8Array(data.buffer));
        views.push({ buffer: 0, byteOffset: start, byteLength: length });
        const acc = { bufferView: views.length - 1, componentType: 5126, count, type };
        if (mn) { acc.min = mn; acc.max = mx; }
        accessors.push(acc);
        attrs[name] = accessors.length - 1;
      }
      const [, , metallic, roughness] = FINISH[part.finish];
      const mat = { pbrMetallicRoughness: { baseColorTexture: { index: texIndex[part.finish + part.color] }, metallicFactor: metallic, roughnessFactor: roughness }, doubleSided: true };
      if (part.finish === 'light') mat.emissiveFactor = hexRgb(part.color).map((c) => Math.min(1, c / 255 * 0.8));
      materials.push(mat);
      primitives.push({ attributes: attrs, material: materials.length - 1, mode: 4 });
    }
    const gltf = {
      asset: { version: '2.0', generator: 'troshare-ai-model' }, scene: 0, scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'Item' }], meshes: [{ primitives }], materials, textures, images,
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
      accessors, bufferViews: views, buffers: [{ byteLength: offset }]
    };
    let json = new TextEncoder().encode(JSON.stringify(gltf));
    const jpad = (4 - (json.length % 4)) % 4;
    if (jpad) { const j = new Uint8Array(json.length + jpad).fill(0x20); j.set(json); json = j; }
    const total = 12 + 8 + json.length + 8 + offset;
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, json.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
    let p = 20 + json.length;
    dv.setUint32(p, offset, true); dv.setUint32(p + 4, 0x004e4942, true); p += 8;
    for (const c of chunks) { out.set(c, p); p += c.byteLength; }
    return out;
  }

  const cache = new Map(); // listing id -> Promise<{ url, size, tris }>
  return {
    /** Builds (once per listing) and returns { url, size: [w, h, d] meters, tris }. */
    model(id, spec) {
      if (!cache.has(id)) {
        cache.set(id, (async () => {
          const { parts, size } = buildParts(spec);
          const bytes = await glb(parts);
          return { url: URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })), size, tris: parts.reduce((n, p) => n + p.p.length / 3, 0) };
        })());
        cache.get(id).catch(() => cache.delete(id));
      }
      return cache.get(id);
    },
    /** "about 44 cm wide, 30 cm tall and 35 cm deep" */
    describe(size) {
      const f = (m) => (m >= 1 ? m.toFixed(2).replace(/0$/, '') + ' m' : Math.round(m * 100) + ' cm');
      return `about ${f(size[0])} wide, ${f(size[1])} tall and ${f(size[2])} deep`;
    }
  };
})();
