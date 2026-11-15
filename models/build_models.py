#!/usr/bin/env python3
"""Build the seven TroShare category models as GLB (web) and USDZ (iOS AR).

Sizes are real-world meters, Y-up, sitting on the floor. These are typical
shapes for each listing type, not scans of a seller's photo.
"""
import json
import math
import struct
import subprocess
from pathlib import Path

OUT = Path(__file__).resolve().parent
USDZIP = 'usdzip'


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length(a):
    return math.sqrt(dot(a, a))


def norm(a):
    mag = length(a)
    return (0.0, 1.0, 0.0) if mag < 1e-10 else mul(a, 1.0 / mag)


class Part:
    def __init__(self, name, color, metallic=0.0, roughness=0.55):
        self.name = name
        self.color = color
        self.metallic = metallic
        self.roughness = roughness
        self.points = []
        self.normals = []

    def tri(self, a, b, c):
        n = cross(sub(b, a), sub(c, a))
        if dot(n, n) < 1e-12:
            return
        n = norm(n)
        for p in (a, b, c):
            self.points.append(p)
            self.normals.append(n)


def add_quad(part, pts, inside):
    n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))
    if dot(n, n) < 1e-12:
        return
    if dot(n, sub(pts[0], inside)) < 0:
        pts = [pts[0], pts[3], pts[2], pts[1]]
    part.tri(pts[0], pts[1], pts[2])
    part.tri(pts[0], pts[2], pts[3])


def add_box(part, center, size):
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    p = []
    for z in (-1, 1):
        for y in (-1, 1):
            for x in (-1, 1):
                p.append((cx + x * hx, cy + y * hy, cz + z * hz))
    # p: 0 -x-y-z, 1 +x-y-z, 2 -x+y-z, 3 +x+y-z, 4 -x-y+z, 5 +x-y+z, 6 -x+y+z, 7 +x+y+z
    quads = [
        (1, 5, 7, 3), (4, 0, 2, 6), (2, 3, 7, 6),
        (0, 4, 5, 1), (5, 4, 6, 7), (0, 1, 3, 2),
    ]
    inside = center
    for a, b, c, d in quads:
        add_quad(part, [p[a], p[b], p[c], p[d]], inside)


def _basis(axis):
    tmp = (0.0, 1.0, 0.0) if abs(axis[1]) < 0.9 else (1.0, 0.0, 0.0)
    u = norm(cross(axis, tmp))
    v = cross(axis, u)
    return u, v


def add_cylinder(part, a, b, radius, n=20):
    axis = norm(sub(b, a))
    u, v = _basis(axis)
    ring_a, ring_b = [], []
    for i in range(n):
        ang = 2 * math.pi * i / n
        off = add(mul(u, math.cos(ang) * radius), mul(v, math.sin(ang) * radius))
        ring_a.append(add(a, off))
        ring_b.append(add(b, off))
    mid = mul(add(a, b), 0.5)
    for i in range(n):
        j = (i + 1) % n
        add_quad(part, [ring_a[i], ring_b[i], ring_b[j], ring_a[j]], mid)
    _cap(part, ring_a, a, sub(a, b))
    _cap(part, ring_b, b, sub(b, a))


def add_frustum(part, a, b, r0, r1, n=24, caps=True):
    axis = norm(sub(b, a))
    u, v = _basis(axis)
    ring_a, ring_b = [], []
    for i in range(n):
        ang = 2 * math.pi * i / n
        cu, su = math.cos(ang), math.sin(ang)
        ring_a.append(add(a, add(mul(u, cu * r0), mul(v, su * r0))))
        ring_b.append(add(b, add(mul(u, cu * r1), mul(v, su * r1))))
    mid = mul(add(a, b), 0.5)
    for i in range(n):
        j = (i + 1) % n
        add_quad(part, [ring_a[i], ring_b[i], ring_b[j], ring_a[j]], mid)
    if caps:
        _cap(part, ring_a, a, sub(a, b))
        _cap(part, ring_b, b, sub(b, a))


def _cap(part, ring, center, outward):
    outside = add(center, outward)
    count = len(ring)
    for i in range(count):
        j = (i + 1) % count
        tri = [center, ring[i], ring[j]]
        n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
        if dot(n, sub(outside, center)) < 0:
            tri = [center, ring[j], ring[i]]
        part.tri(*tri)


def add_ellipsoid(part, center, radii, seg=20, rings=12):
    rx, ry, rz = radii
    rows = []
    for i in range(rings + 1):
        v = math.pi * i / rings
        row = []
        sv, cv = math.sin(v), math.cos(v)
        for j in range(seg):
            u = 2 * math.pi * j / seg
            row.append((
                center[0] + rx * sv * math.cos(u),
                center[1] + ry * cv,
                center[2] + rz * sv * math.sin(u),
            ))
        rows.append(row)
    for i in range(rings):
        for j in range(seg):
            k = (j + 1) % seg
            add_quad(part, [rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]], center)


def bounds(parts):
    pts = [p for part in parts for p in part.points]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi


def write_glb(path, parts):
    blobs = []
    views = []
    accessors = []
    primitives = []
    materials = []
    offset = 0

    def pad(n):
        return (4 - n % 4) % 4

    def push(data):
        nonlocal offset
        blobs.append(data)
        start = offset
        offset += len(data)
        gap = pad(offset)
        if gap:
            blobs.append(b'\x00' * gap)
            offset += gap
        return start, len(data)

    for part in parts:
        pos = b''.join(struct.pack('<3f', *p) for p in part.points)
        nrm = b''.join(struct.pack('<3f', *n) for n in part.normals)
        col = b''.join(struct.pack('<3f', *part.color) for _ in part.points)
        count = len(part.points)
        xs = [p[0] for p in part.points]
        ys = [p[1] for p in part.points]
        zs = [p[2] for p in part.points]
        specs = [
            (pos, 'VEC3', 5126, count, [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]),
            (nrm, 'VEC3', 5126, count, None, None),
            (col, 'VEC3', 5126, count, None, None),
        ]
        attrs = {}
        names = ('POSITION', 'NORMAL', 'COLOR_0')
        for name, (data, typ, comp, cnt, amin, amax) in zip(names, specs):
            start, length = push(data)
            views.append({'buffer': 0, 'byteOffset': start, 'byteLength': length})
            acc = {'bufferView': len(views) - 1, 'componentType': comp, 'count': cnt, 'type': typ}
            if amin is not None:
                acc['min'] = amin
                acc['max'] = amax
            accessors.append(acc)
            attrs[name] = len(accessors) - 1
        materials.append({
            'pbrMetallicRoughness': {
                'baseColorFactor': [1, 1, 1, 1],
                'metallicFactor': part.metallic,
                'roughnessFactor': part.roughness,
            },
            'doubleSided': True,
        })
        primitives.append({'attributes': attrs, 'material': len(materials) - 1, 'mode': 4})

    gltf = {
        'asset': {'version': '2.0', 'generator': 'troshare-build-models'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': path.stem}],
        'meshes': [{'primitives': primitives}],
        'materials': materials,
        'accessors': accessors,
        'bufferViews': views,
        'buffers': [{'byteLength': offset}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    blob = b''.join(blobs)
    total = 12 + 8 + len(js) + 8 + len(blob)
    out = bytearray()
    out += struct.pack('<4sII', b'glTF', 2, total)
    out += struct.pack('<I4s', len(js), b'JSON')
    out += js
    out += struct.pack('<I4s', len(blob), b'BIN\x00')
    out += blob
    path.write_bytes(out)


def f3(p):
    return '(%s, %s, %s)' % tuple(('%.5f' % v).rstrip('0').rstrip('.') or '0' for v in p)


def write_usda(path, parts):
    lo, hi = bounds(parts)
    lines = [
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
        '    float3[] extent = [%s, %s]' % (f3(lo), f3(hi)),
        '    def Scope "Materials"',
        '    {',
    ]
    for part in parts:
        r, g, b = part.color
        lines += [
            '        def Material "%s"' % part.name,
            '        {',
            '            token outputs:surface.connect = </Root/Materials/%s/Preview.outputs:surface>' % part.name,
            '            def Shader "Preview"',
            '            {',
            '                uniform token info:id = "UsdPreviewSurface"',
            '                color3f inputs:diffuseColor = %s' % f3((r, g, b)),
            '                float inputs:metallic = %.3f' % part.metallic,
            '                float inputs:roughness = %.3f' % part.roughness,
            '                token outputs:surface',
            '            }',
            '        }',
        ]
    lines.append('    }')
    for part in parts:
        pts = ', '.join(f3(p) for p in part.points)
        nrm = ', '.join(f3(n) for n in part.normals)
        counts = ', '.join(['3'] * (len(part.points) // 3))
        indices = ', '.join(str(i) for i in range(len(part.points)))
        plo = [min(p[i] for p in part.points) for i in range(3)]
        phi = [max(p[i] for p in part.points) for i in range(3)]
        lines += [
            '    def Mesh "%s" (' % part.name,
            '        prepend apiSchemas = ["MaterialBindingAPI"]',
            '    )',
            '    {',
            '        rel material:binding = </Root/Materials/%s>' % part.name,
            '        uniform token subdivisionScheme = "none"',
            '        float3[] extent = [%s, %s]' % (f3(plo), f3(phi)),
            '        int[] faceVertexCounts = [%s]' % counts,
            '        int[] faceVertexIndices = [%s]' % indices,
            '        point3f[] points = [%s]' % pts,
            '        normal3f[] primvars:normals = [%s] (' % nrm,
            '            interpolation = "vertex"',
            '        )',
            '        color3f[] primvars:displayColor = [%s] (' % f3(part.color),
            '            interpolation = "constant"',
            '        )',
            '    }',
        ]
    lines.append('}')
    path.write_text('\n'.join(lines) + '\n')


def write_usdz(usda, usdz):
    subprocess.check_call([USDZIP, '--arkitAsset', str(usda), str(usdz)], stdout=subprocess.DEVNULL)


# Colors are plain product colors, close to the listing photos.
INK = (0.12, 0.12, 0.13)
CHAR = (0.22, 0.22, 0.24)
GOLD = (0.78, 0.62, 0.28)
LINEN = (0.93, 0.86, 0.70)
WHITE = (0.95, 0.95, 0.96)
CREAM = (0.96, 0.93, 0.88)
GRAY = (0.56, 0.56, 0.58)
SCREEN = (0.08, 0.12, 0.18)
SILVER = (0.75, 0.75, 0.78)


def lamp():
    shade = Part('Shade', LINEN, roughness=0.7)
    add_frustum(shade, (0.0, 0.40, 0.10), (0.0, 0.28, 0.12), 0.045, 0.095, caps=True)
    arm = Part('Arm', INK, metallic=0.4, roughness=0.35)
    add_cylinder(arm, (0.0, 0.32, 0.0), (0.0, 0.40, 0.08), 0.008)
    stem = Part('Stem', INK, metallic=0.4, roughness=0.35)
    add_cylinder(stem, (0.0, 0.02, 0.0), (0.0, 0.33, 0.0), 0.01)
    joint = Part('Joint', CHAR, metallic=0.5, roughness=0.3)
    add_ellipsoid(joint, (0.0, 0.33, 0.0), (0.018, 0.018, 0.018), seg=12, rings=8)
    base = Part('Base', CHAR, metallic=0.3, roughness=0.4)
    add_cylinder(base, (0.0, 0.0, 0.0), (0.0, 0.018, 0.0), 0.09)
    return [base, stem, joint, arm, shade]


def floor_lamp():
    shade = Part('Shade', LINEN, roughness=0.72)
    add_frustum(shade, (0.0, 1.52, 0.0), (0.0, 1.28, 0.0), 0.05, 0.17)
    pole = Part('Pole', GOLD, metallic=0.85, roughness=0.28)
    add_cylinder(pole, (0.0, 0.02, 0.0), (0.0, 1.34, 0.0), 0.012, n=16)
    neck = Part('Neck', GOLD, metallic=0.85, roughness=0.28)
    add_cylinder(neck, (0.0, 1.30, 0.0), (0.0, 1.36, 0.0), 0.02, n=16)
    base = Part('Base', GOLD, metallic=0.8, roughness=0.3)
    add_cylinder(base, (0.0, 0.0, 0.0), (0.0, 0.018, 0.0), 0.16, n=24)
    return [base, pole, neck, shade]


def fan():
    body = Part('Body', WHITE, roughness=0.45)
    add_box(body, (0.0, 0.58, 0.0), (0.18, 0.78, 0.11))
    grille = Part('Grille', CHAR, roughness=0.4)
    add_box(grille, (0.0, 0.60, 0.055), (0.14, 0.62, 0.012))
    cap = Part('Cap', WHITE, roughness=0.45)
    add_ellipsoid(cap, (0.0, 0.98, 0.0), (0.07, 0.025, 0.05), seg=16, rings=8)
    neck = Part('Neck', CHAR, roughness=0.4)
    add_cylinder(neck, (0.0, 0.08, 0.0), (0.0, 0.20, 0.0), 0.028, n=14)
    base = Part('Base', INK, roughness=0.45)
    add_ellipsoid(base, (0.0, 0.035, 0.0), (0.15, 0.035, 0.13), seg=18, rings=8)
    return [base, neck, body, grille, cap]


def bean():
    bag = Part('Bag', GRAY, roughness=0.8)
    add_ellipsoid(bag, (0.0, 0.34, 0.0), (0.42, 0.34, 0.42), seg=24, rings=14)
    seat = Part('Seat', (0.40, 0.40, 0.42), roughness=0.85)
    add_ellipsoid(seat, (0.0, 0.60, 0.02), (0.20, 0.07, 0.18), seg=18, rings=10)
    return [bag, seat]


def tv():
    bezel = Part('Bezel', INK, roughness=0.35)
    add_box(bezel, (0.0, 0.40, 0.0), (0.80, 0.46, 0.035))
    screen = Part('Screen', SCREEN, metallic=0.15, roughness=0.15)
    add_box(screen, (0.0, 0.40, 0.016), (0.74, 0.40, 0.008))
    neck = Part('Neck', SILVER, metallic=0.7, roughness=0.3)
    add_box(neck, (0.0, 0.145, 0.0), (0.08, 0.07, 0.03))
    foot = Part('Foot', SILVER, metallic=0.7, roughness=0.3)
    add_box(foot, (0.0, 0.012, 0.0), (0.36, 0.018, 0.16))
    return [foot, neck, bezel, screen]


def topper():
    pad = Part('Pad', CREAM, roughness=0.75)
    add_box(pad, (0.0, 0.04, 0.0), (0.91, 0.07, 2.03))
    edge = Part('Edge', WHITE, roughness=0.6)
    add_box(edge, (0.0, 0.078, 0.0), (0.86, 0.012, 1.96))
    return [pad, edge]


def cart():
    parts = []
    shelf = Part('Shelves', WHITE, roughness=0.4)
    for y in (0.14, 0.36, 0.58, 0.80):
        add_box(shelf, (0.0, y, 0.0), (0.42, 0.012, 0.34))
    posts = Part('Posts', CHAR, metallic=0.35, roughness=0.35)
    for x in (-0.19, 0.19):
        for z in (-0.15, 0.15):
            add_cylinder(posts, (x, 0.05, z), (x, 0.82, z), 0.008, n=10)
    handle = Part('Handle', CHAR, metallic=0.35, roughness=0.35)
    add_cylinder(handle, (-0.16, 0.84, -0.15), (0.16, 0.84, -0.15), 0.008, n=10)
    wheels = Part('Wheels', INK, roughness=0.6)
    for x in (-0.16, 0.16):
        for z in (-0.13, 0.13):
            add_cylinder(wheels, (x - 0.015, 0.03, z), (x + 0.015, 0.03, z), 0.03, n=12)
    return [wheels, posts, shelf, handle]


MODELS = {
    'lamp': lamp,
    'floor': floor_lamp,
    'fan': fan,
    'bean': bean,
    'tv': tv,
    'topper': topper,
    'cart': cart,
}


def main():
    tmp = OUT / '_src'
    tmp.mkdir(exist_ok=True)
    for name, build in MODELS.items():
        parts = build()
        lo, hi = bounds(parts)
        print('%s  %.2f × %.2f × %.2f m   y %.3f–%.3f' % (
            name, hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], lo[1], hi[1]))
        usda = tmp / (name + '.usda')
        write_usda(usda, parts)
        write_glb(OUT / (name + '.glb'), parts)
        write_usdz(usda, OUT / (name + '.usdz'))
        usda.unlink()
    tmp.rmdir()


if __name__ == '__main__':
    main()
