// Builds a floor-standing preview from one listing photo.
// Units are meters. Y is up, the floor is y = 0, and the photo faces -Z (and +Z on the back).
// glTF UV (0, 0) is the top-left of the image. USD flips V.

const enc = new TextEncoder();

function clampM(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.4;
  return Math.min(2.5, Math.max(0.05, Math.round(x * 1000) / 1000));
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function padTo(bytes, mod, fill) {
  const n = (mod - (bytes.length % mod)) % mod;
  if (!n) return bytes;
  const out = new Uint8Array(bytes.length + n);
  out.set(bytes);
  if (fill) out.fill(fill, bytes.length);
  return out;
}

/** Six faces, photo on the front and back, cream sides. Vertices are CCW from the outside. */
function boxGeometry(w, h, d) {
  const x = w / 2, z = d / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const photo = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const blank = [[0, 0], [0, 0], [0, 0], [0, 0]];
  const add = (corners, normal, uv) => {
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      positions.push(corners[i][0], corners[i][1], corners[i][2]);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(uv[i][0], uv[i][1]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  // Front and back carry the photo. Order is bottom-left, bottom-right, top-right, top-left.
  add([[-x, 0, -z], [x, 0, -z], [x, h, -z], [-x, h, -z]], [0, 0, -1], photo);
  add([[x, 0, z], [-x, 0, z], [-x, h, z], [x, h, z]], [0, 0, 1], photo);
  const photoCount = indices.length;
  add([[-x, 0, z], [-x, 0, -z], [-x, h, -z], [-x, h, z]], [-1, 0, 0], blank);
  add([[x, 0, -z], [x, 0, z], [x, h, z], [x, h, -z]], [1, 0, 0], blank);
  add([[-x, h, -z], [x, h, -z], [x, h, z], [-x, h, z]], [0, 1, 0], blank);
  add([[x, 0, -z], [-x, 0, -z], [-x, 0, z], [x, 0, z]], [0, -1, 0], blank);
  return { positions, normals, uvs, indices, photoCount };
}

function f32(list) {
  return new Uint8Array(new Float32Array(list).buffer);
}
function u16(list) {
  return new Uint8Array(new Uint16Array(list).buffer);
}

function bounds(list) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < list.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = list[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function buildGlb(jpeg, geo) {
  const pos = f32(geo.positions);
  const nrm = f32(geo.normals);
  const uv = f32(geo.uvs);
  const idx = u16(geo.indices);
  const parts = [pos, nrm, uv, idx, jpeg];
  const views = [];
  let offset = 0;
  for (const part of parts) {
    views.push({ byteOffset: offset, byteLength: part.length });
    offset += part.length;
    const gap = (4 - (offset % 4)) % 4;
    offset += gap;
  }
  const bin = new Uint8Array(offset);
  offset = 0;
  for (const part of parts) {
    bin.set(part, offset);
    offset += part.length;
    offset += (4 - (offset % 4)) % 4;
  }
  const b = bounds(geo.positions);
  const count = geo.positions.length / 3;
  const json = {
    asset: { version: '2.0', generator: 'troshare-listing-model' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Item' }],
    meshes: [{
      primitives: [
        { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 },
        { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 4, material: 1, mode: 4 },
      ],
    }],
    materials: [
      { name: 'Photo', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 } },
      { name: 'Sides', pbrMetallicRoughness: { baseColorFactor: [1, 0.965, 0.851, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
    ],
    textures: [{ sampler: 0, source: 0 }],
    images: [{ bufferView: 4, mimeType: 'image/jpeg' }],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: b.min, max: b.max },
      { bufferView: 1, componentType: 5126, count, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: geo.photoCount, type: 'SCALAR' },
      { bufferView: 3, byteOffset: geo.photoCount * 2, componentType: 5123, count: geo.indices.length - geo.photoCount, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: views[0].byteOffset, byteLength: views[0].byteLength, target: 34962 },
      { buffer: 0, byteOffset: views[1].byteOffset, byteLength: views[1].byteLength, target: 34962 },
      { buffer: 0, byteOffset: views[2].byteOffset, byteLength: views[2].byteLength, target: 34962 },
      { buffer: 0, byteOffset: views[3].byteOffset, byteLength: views[3].byteLength, target: 34963 },
      { buffer: 0, byteOffset: views[4].byteOffset, byteLength: views[4].byteLength },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBytes = padTo(enc.encode(JSON.stringify(json)), 4, 0x20);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const at = 20 + jsonBytes.length;
  dv.setUint32(at, bin.length, true);
  dv.setUint32(at + 4, 0x004e4942, true);
  out.set(bin, at + 8);
  return out;
}

function num(n) {
  return (Math.round(n * 1e6) / 1e6).toString();
}
function f3(p) { return `(${num(p[0])}, ${num(p[1])}, ${num(p[2])})`; }
function f2(p) { return `(${num(p[0])}, ${num(p[1])})`; }

function meshUsda(name, material, geo, startVert, vertCount, indexStart, indexCount) {
  const pts = [];
  const nrm = [];
  const st = [];
  for (let i = 0; i < vertCount; i++) {
    const v = startVert + i;
    pts.push(f3([geo.positions[v * 3], geo.positions[v * 3 + 1], geo.positions[v * 3 + 2]]));
    nrm.push(f3([geo.normals[v * 3], geo.normals[v * 3 + 1], geo.normals[v * 3 + 2]]));
    // USD's st origin is the bottom of the image; glTF's is the top.
    st.push(f2([geo.uvs[v * 2], 1 - geo.uvs[v * 2 + 1]]));
  }
  const local = [];
  for (let i = 0; i < indexCount; i++) local.push(String(geo.indices[indexStart + i] - startVert));
  const counts = new Array(indexCount / 3).fill('3').join(', ');
  return [
    `    def Mesh "${name}" (`,
    '        prepend apiSchemas = ["MaterialBindingAPI"]',
    '    )',
    '    {',
    `        rel material:binding = </Root/Materials/${material}>`,
    '        uniform token subdivisionScheme = "none"',
    `        int[] faceVertexCounts = [${counts}]`,
    `        int[] faceVertexIndices = [${local.join(', ')}]`,
    `        point3f[] points = [${pts.join(', ')}]`,
    `        normal3f[] primvars:normals = [${nrm.join(', ')}] (`,
    '            interpolation = "vertex"',
    '        )',
    `        texCoord2f[] primvars:st = [${st.join(', ')}] (`,
    '            interpolation = "vertex"',
    '        )',
    '    }',
  ];
}

function buildUsda(geo) {
  const b = bounds(geo.positions);
  const photoVerts = 8; // two faces
  return [
    '#usda 1.0',
    '(',
    '    defaultPrim = "Root"',
    '    metersPerUnit = 1',
    '    upAxis = "Y"',
    ')',
    'def Xform "Root" (',
    '    kind = "component"',
    '    prepend apiSchemas = ["Preliminary_AnchoringAPI"]',
    ')',
    '{',
    '    token preliminary:anchoring:type = "plane"',
    '    token preliminary:planeAnchoring:alignment = "horizontal"',
    `    float3[] extent = [${f3(b.min)}, ${f3(b.max)}]`,
    '    def Scope "Materials"',
    '    {',
    '        def Material "Photo"',
    '        {',
    '            token outputs:surface.connect = </Root/Materials/Photo/Preview.outputs:surface>',
    '            def Shader "Preview"',
    '            {',
    '                uniform token info:id = "UsdPreviewSurface"',
    '                color3f inputs:diffuseColor.connect = </Root/Materials/Photo/Color.outputs:rgb>',
    '                float inputs:metallic = 0',
    '                float inputs:roughness = 0.85',
    '                token outputs:surface',
    '            }',
    '            def Shader "Color"',
    '            {',
    '                uniform token info:id = "UsdUVTexture"',
    '                asset inputs:file = @photo.jpg@',
    '                float2 inputs:st.connect = </Root/Materials/Photo/ST.outputs:result>',
    '                token inputs:wrapS = "clamp"',
    '                token inputs:wrapT = "clamp"',
    '                token inputs:sourceColorSpace = "sRGB"',
    '                float3 outputs:rgb',
    '            }',
    '            def Shader "ST"',
    '            {',
    '                uniform token info:id = "UsdPrimvarReader_float2"',
    '                string inputs:varname = "st"',
    '                float2 inputs:fallback = (0, 0)',
    '                float2 outputs:result',
    '            }',
    '        }',
    '        def Material "Sides"',
    '        {',
    '            token outputs:surface.connect = </Root/Materials/Sides/Preview.outputs:surface>',
    '            def Shader "Preview"',
    '            {',
    '                uniform token info:id = "UsdPreviewSurface"',
    '                color3f inputs:diffuseColor = (1, 0.965, 0.851)',
    '                float inputs:metallic = 0',
    '                float inputs:roughness = 0.9',
    '                token outputs:surface',
    '            }',
    '        }',
    '    }',
    ...meshUsda('Photo', 'Photo', geo, 0, photoVerts, 0, geo.photoCount),
    ...meshUsda('Sides', 'Sides', geo, photoVerts, 16, geo.photoCount, geo.indices.length - geo.photoCount),
    '}',
    '',
  ].join('\n');
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Apple's USDZ is an uncompressed zip whose file bytes start on a 64-byte boundary.
function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = enc.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const pad = (64 - ((offset + 30 + name.length) % 64)) % 64;
    const extra = new Uint8Array(pad);
    const local = new Uint8Array(30);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, extra.length, true);
    locals.push(local, name, extra, data);
    const central = new Uint8Array(46);
    const cd = new DataView(central.buffer);
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint16(30, extra.length, true);
    cd.setUint32(42, offset, true);
    centrals.push(central, name, extra);
    offset += local.length + name.length + extra.length + data.length;
  }
  const centralBlob = concat(centrals);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralBlob.length, true);
  ev.setUint32(16, offset, true);
  return concat([...locals, centralBlob, end]);
}

/** @param {Uint8Array} jpeg @returns {{ glb: Uint8Array, usdz: Uint8Array }} */
export function buildPhotoModel(jpeg, widthM, heightM, depthM) {
  const bytes = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
  const geo = boxGeometry(clampM(widthM), clampM(heightM), clampM(depthM));
  const usda = enc.encode(buildUsda(geo));
  return {
    glb: buildGlb(bytes, geo),
    usdz: zipStore([
      { name: 'Item.usda', data: usda },
      { name: 'photo.jpg', data: bytes },
    ]),
  };
}
