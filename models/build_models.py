#!/usr/bin/env python3
"""Build the seven TroShare category models as GLB (web) and USDZ (iOS AR).

Sizes are real-world meters, Y-up, sitting on the floor (y = 0). Each part
carries a tiled color texture. These are typical shapes for each listing
type, not scans of a seller's photo.
"""
import io
import json
import math
import struct
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent
USDZIP = 'usdzip'
TEX = {}


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
    def __init__(self, name, texture, metallic=0.0, roughness=0.55):
        self.name = name
        self.texture = texture
        self.metallic = metallic
        self.roughness = roughness
        self.points = []
        self.normals = []
        self.uvs = []

    def tri(self, a, b, c, uva, uvb, uvc):
        n = cross(sub(b, a), sub(c, a))
        if dot(n, n) < 1e-12:
            return
        n = norm(n)
        for p, uv in ((a, uva), (b, uvb), (c, uvc)):
            self.points.append(p)
            self.normals.append(n)
            self.uvs.append(uv)


def add_quad(part, pts, uvs, inside):
    n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))
    if dot(n, n) < 1e-12:
        return
    if dot(n, sub(pts[0], inside)) < 0:
        pts = [pts[0], pts[3], pts[2], pts[1]]
        uvs = [uvs[0], uvs[3], uvs[2], uvs[1]]
    part.tri(pts[0], pts[1], pts[2], uvs[0], uvs[1], uvs[2])
    part.tri(pts[0], pts[2], pts[3], uvs[0], uvs[2], uvs[3])


def _face_uvs(pts, tile):
    e1 = sub(pts[1], pts[0])
    e2 = sub(pts[3], pts[0])
    l1 = max(length(e1), 1e-8)
    l2 = max(length(e2), 1e-8)
    uvs = []
    for p in pts:
        d = sub(p, pts[0])
        uvs.append((dot(d, e1) / (l1 * l1) * (l1 / tile), dot(d, e2) / (l2 * l2) * (l2 / tile)))
    return uvs


def add_box(part, center, size, tile=0.12):
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    p = []
    for z in (-1, 1):
        for y in (-1, 1):
            for x in (-1, 1):
                p.append((cx + x * hx, cy + y * hy, cz + z * hz))
    quads = [
        (1, 5, 7, 3), (4, 0, 2, 6), (2, 3, 7, 6),
        (0, 4, 5, 1), (5, 4, 6, 7), (0, 1, 3, 2),
    ]
    for a, b, c, d in quads:
        pts = [p[a], p[b], p[c], p[d]]
        add_quad(part, pts, _face_uvs(pts, tile), center)


def _basis(axis):
    tmp = (0.0, 1.0, 0.0) if abs(axis[1]) < 0.9 else (1.0, 0.0, 0.0)
    u = norm(cross(axis, tmp))
    v = cross(axis, u)
    return u, v


def _cap(part, ring, center, outward):
    outside = add(center, outward)
    count = len(ring)
    cuv = []
    for i in range(count):
        ang = 2 * math.pi * i / count
        cuv.append((0.5 + 0.5 * math.cos(ang), 0.5 + 0.5 * math.sin(ang)))
    mid = (0.5, 0.5)
    for i in range(count):
        j = (i + 1) % count
        tri = [center, ring[i], ring[j]]
        tuv = [mid, cuv[i], cuv[j]]
        n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))
        if dot(n, sub(outside, center)) < 0:
            tri = [center, ring[j], ring[i]]
            tuv = [mid, cuv[j], cuv[i]]
        part.tri(tri[0], tri[1], tri[2], tuv[0], tuv[1], tuv[2])


def add_cylinder(part, a, b, radius, n=24, caps=True, tile=0.08, v0=0.0):
    axis = norm(sub(b, a))
    height = length(sub(b, a))
    if height < 1e-6:
        return v0
    u, v = _basis(axis)
    ring_a, ring_b = [], []
    for i in range(n):
        ang = 2 * math.pi * i / n
        off = add(mul(u, math.cos(ang) * radius), mul(v, math.sin(ang) * radius))
        ring_a.append(add(a, off))
        ring_b.append(add(b, off))
    span = (2 * math.pi * radius) / tile
    v1 = v0 + height / tile
    mid = mul(add(a, b), 0.5)
    for i in range(n):
        j = (i + 1) % n
        u0 = span * i / n
        u1 = span if j == 0 else span * j / n
        add_quad(part, [ring_a[i], ring_b[i], ring_b[j], ring_a[j]],
                 [(u0, v0), (u0, v1), (u1, v1), (u1, v0)], mid)
    if caps:
        _cap(part, ring_a, a, sub(a, b))
        _cap(part, ring_b, b, sub(b, a))
    return v1


def add_frustum(part, a, b, r0, r1, n=28, caps=True, tile=0.08):
    axis = norm(sub(b, a))
    height = length(sub(b, a))
    u, v = _basis(axis)
    ring_a, ring_b = [], []
    for i in range(n):
        ang = 2 * math.pi * i / n
        cu, su = math.cos(ang), math.sin(ang)
        ring_a.append(add(a, add(mul(u, cu * r0), mul(v, su * r0))))
        ring_b.append(add(b, add(mul(u, cu * r1), mul(v, su * r1))))
    span = (2 * math.pi * max(r0, r1)) / tile
    v1 = height / tile
    mid = mul(add(a, b), 0.5)
    for i in range(n):
        j = (i + 1) % n
        u0 = span * i / n
        u1 = span if j == 0 else span * j / n
        add_quad(part, [ring_a[i], ring_b[i], ring_b[j], ring_a[j]],
                 [(u0, 0), (u0, v1), (u1, v1), (u1, 0)], mid)
    if caps:
        _cap(part, ring_a, a, sub(a, b))
        _cap(part, ring_b, b, sub(b, a))


def curve(p0, p1, p2, steps):
    pts = []
    for i in range(steps + 1):
        t = i / float(steps)
        u = 1.0 - t
        pts.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            u * u * p0[2] + 2 * u * t * p1[2] + t * t * p2[2],
        ))
    return pts


def add_pipe(part, pts, radius, n=10, tile=0.04):
    v = 0.0
    for a, b in zip(pts, pts[1:]):
        if length(sub(b, a)) < 1e-5:
            continue
        v = add_cylinder(part, a, b, radius, n=n, caps=False, tile=tile, v0=v)


def add_torus(part, center, major, minor, n=36, m=12, tile=0.05):
    cx, cy, cz = center
    rings = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        row = []
        for j in range(m):
            b = 2 * math.pi * j / m
            cb, sb = math.cos(b), math.sin(b)
            row.append((cx + (major + minor * cb) * ca, cy + minor * sb, cz + (major + minor * cb) * sa))
        rings.append(row)
    u_span = (2 * math.pi * major) / tile
    v_span = (2 * math.pi * minor) / tile
    for i in range(n):
        i2 = (i + 1) % n
        a = 2 * math.pi * (i + 0.5) / n
        spine = (cx + major * math.cos(a), cy, cz + major * math.sin(a))
        u0 = u_span * i / n
        u1 = u_span if i2 == 0 else u_span * i2 / n
        for j in range(m):
            j2 = (j + 1) % m
            v0 = v_span * j / m
            v1 = v_span if j2 == 0 else v_span * j2 / m
            add_quad(part, [rings[i][j], rings[i2][j], rings[i2][j2], rings[i][j2]],
                     [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], spine)


def add_ellipsoid(part, center, radii, seg=32, rings=18, repeat=(2.0, 1.0)):
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
        v0 = repeat[1] * i / rings
        v1 = repeat[1] * (i + 1) / rings
        for j in range(seg):
            k = (j + 1) % seg
            u0 = repeat[0] * j / seg
            u1 = repeat[0] if k == 0 else repeat[0] * k / seg
            add_quad(part, [rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]],
                     [(u0, v0), (u1, v0), (u1, v1), (u0, v1)], center)


def add_plane(part, center, w, h, z=None):
    """A single quad facing +Z. UVs cover the texture once, image top at +Y."""
    x, y, zz = center
    if z is not None:
        zz = z
    hw, hh = w / 2, h / 2
    pts = [(x - hw, y - hh, zz), (x + hw, y - hh, zz), (x + hw, y + hh, zz), (x - hw, y + hh, zz)]
    # glTF treats (0, 0) as the top-left of the image, so v=0 is the top (+Y).
    uvs = [(0, 1), (1, 1), (1, 0), (0, 0)]
    inside = (x, y, zz - 1)
    add_quad(part, pts, uvs, inside)


def add_ellipse_pipe(part, center, rx, rz, y, radius, n=56, tube=8, tile=0.05):
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        pts.append((center[0] + rx * math.cos(a), y, center[2] + rz * math.sin(a)))
    add_pipe(part, pts, radius, n=tube, tile=tile)


def add_ribbon(part, path, half_width, half_thick, tile=0.16):
    """Thick cloth strip. `path` is a centerline. The width runs along world +X,
    so the path itself should stay in the YZ plane."""
    frames = []
    dist = 0.0
    prev = None
    for p in path:
        if prev is not None:
            step = length(sub(p, prev))
            if step < 1e-6:
                continue
            dist += step
            tangent = norm(sub(p, prev))
        else:
            tangent = norm(sub(path[1], path[0]))
        side = (1.0, 0.0, 0.0)
        normal = norm(cross(tangent, side))
        frames.append((p, normal, dist))
        prev = p
    if len(frames) < 2:
        return

    # ring(): 0 +n+x, 1 +n-x, 2 -n-x, 3 -n+x
    def ring(point, normal):
        return [
            add(point, add(mul(normal, half_thick), (half_width, 0, 0))),
            add(point, add(mul(normal, half_thick), (-half_width, 0, 0))),
            add(point, add(mul(normal, -half_thick), (-half_width, 0, 0))),
            add(point, add(mul(normal, -half_thick), (half_width, 0, 0))),
        ]

    rings = [ring(p, n) for p, n, _ in frames]
    u1 = (2 * half_width) / tile
    for i in range(len(frames) - 1):
        v0 = frames[i][2] / tile
        v1 = frames[i + 1][2] / tile
        a, b = rings[i], rings[i + 1]
        inside = mul(add(frames[i][0], frames[i + 1][0]), 0.5)
        faces = [
            ([a[0], b[0], b[1], a[1]], [(0, v0), (0, v1), (u1, v1), (u1, v0)]),
            ([a[3], a[2], b[2], b[3]], [(0, v0), (u1, v0), (u1, v1), (0, v1)]),
            ([a[0], a[3], b[3], b[0]], [(0, v0), (0.15, v0), (0.15, v1), (0, v1)]),
            ([a[1], b[1], b[2], a[2]], [(0, v0), (0, v1), (0.15, v1), (0.15, v0)]),
        ]
        for pts, uvs in faces:
            add_quad(part, pts, uvs, inside)
    add_quad(part, rings[0], [(0, 0), (1, 0), (1, 0.2), (0, 0.2)], frames[1][0])
    add_quad(part, list(reversed(rings[-1])), [(0, 0), (1, 0), (1, 0.2), (0, 0.2)], frames[-2][0])


def z_fold_path(length=0.56, gap=0.022, radius=0.011, y0=0.016, n_line=28, n_arc=16):
    """Accordion fold in the YZ plane: three panels joined by half-circle turns."""
    pts = []

    def push(p):
        if not pts or length_of(pts[-1], p) > 1e-5:
            pts.append(p)

    def length_of(a, b):
        return math.dist(a, b)

    def line(z0, z1, y):
        for i in range(n_line + 1):
            t = i / n_line
            push((0.0, y, z0 + (z1 - z0) * t))

    def arc(z, y_from, y_to, bulge):
        r = abs(y_to - y_from) / 2
        cy = (y_from + y_to) / 2
        for i in range(1, n_arc + 1):
            a = -math.pi / 2 + math.pi * i / n_arc
            push((0.0, cy + r * math.sin(a), z + bulge * r * math.cos(a)))

    y1 = y0 + gap
    y2 = y0 + 2 * gap
    line(0.0, length, y0)
    arc(length, y0, y1, +1)
    line(length, 0.0, y1)
    arc(0.0, y1, y2, -1)
    line(0.0, length, y2)
    # A soft settle on the top panel so the fold is not a perfect brick.
    bowed = []
    for p in pts:
        wave = 0.0
        if p[1] > y2 - 0.004 and 0.04 < p[2] < length - 0.04:
            wave = 0.006 * math.sin(p[2] / length * math.pi)
        bowed.append((p[0], p[1] + wave, p[2]))
    return bowed


def bounds(parts):
    pts = [p for part in parts for p in part.points]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi


def lift_to_floor(parts):
    lo, _ = bounds(parts)
    dy = -lo[1]
    if abs(dy) < 1e-6:
        return
    for part in parts:
        part.points = [(p[0], p[1] + dy, p[2]) for p in part.points]


def png_bytes(arr):
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def tile_noise(h, w, octaves=5, seed=1):
    rng = np.random.default_rng(seed)
    yy = np.linspace(0, 2 * np.pi, h, endpoint=False)
    xx = np.linspace(0, 2 * np.pi, w, endpoint=False)
    x, y = np.meshgrid(xx, yy)
    out = np.zeros((h, w), np.float32)
    for o in range(octaves):
        f = float(2 ** o)
        p1, p2, p3 = rng.random(3) * 8
        out += (np.sin(x * f + p1) * np.cos(y * f + p2) + np.sin((x + y) * f * 0.7 + p3)) * (0.55 ** o)
    out -= out.min()
    out /= out.max() + 1e-6
    return out


def tint(noise, rgb, amount=0.35):
    base = np.array(rgb, np.float32)
    shade = 1 - amount + amount * 2 * noise[..., None]
    return np.clip(base * shade, 0, 255)


def make_textures():
    n = tile_noise(512, 512, 5, seed=2)
    fine = tile_noise(512, 512, 6, seed=7)
    TEX['plastic'] = png_bytes(tint(fine, (28, 28, 30), 0.28))
    TEX['plastic_soft'] = png_bytes(tint(fine, (48, 48, 52), 0.22))
    TEX['shade'] = png_bytes(tint(n, (18, 18, 20), 0.18))
    warm = tint(n, (230, 224, 206), 0.12)
    TEX['inside'] = png_bytes(warm)
    brush = Image.fromarray((fine * 255).astype(np.uint8), 'L').resize((512, 6), Image.BILINEAR)
    brush = np.asarray(brush.resize((512, 512), Image.BILINEAR)).astype(np.float32) / 255
    brass = tint(brush * 0.65 + fine * 0.35, (214, 168, 72), 0.22)
    TEX['brass'] = png_bytes(brass)
    veins = np.sin(np.linspace(0, 40, 512)[None, :] + n * 7.5)
    vein = np.clip(1 - np.abs(veins) * 2.4, 0, 1)
    marble = tint(n, (236, 232, 224), 0.08)
    marble = marble * (1 - vein[..., None] * 0.45) + np.array([150, 158, 164]) * vein[..., None] * 0.45
    TEX['marble'] = png_bytes(marble)
    weave = 0.5 + 0.5 * np.sin(np.linspace(0, 90, 512))
    linen = tint(fine * 0.5 + (weave[None, :] * weave[:, None]) * 0.5, (236, 224, 196), 0.16)
    TEX['linen'] = png_bytes(linen)
    weave_x = 0.5 + 0.5 * np.sin(np.linspace(0, 28, 512))
    weave_y = 0.5 + 0.5 * np.sin(np.linspace(0, 28, 512))
    weave = weave_x[None, :] * 0.6 + weave_y[:, None] * 0.4
    TEX['fabric'] = png_bytes(tint(n * 0.5 + fine * 0.35 + weave * 0.15, (142, 136, 128), 0.34))
    TEX['fabric_dark'] = png_bytes(tint(n * 0.5 + fine * 0.35 + weave * 0.15, (84, 78, 72), 0.3))
    TEX['metal'] = png_bytes(tint(brush * 0.7 + fine * 0.3, (42, 42, 46), 0.4))
    TEX['rubber'] = png_bytes(tint(fine, (22, 22, 24), 0.15))

    cloth = tint(n * 0.55 + fine * 0.45, (226, 218, 204), 0.2)
    quilt = Image.fromarray(cloth.astype(np.uint8), 'RGB')
    draw = ImageDraw.Draw(quilt)
    step = 72
    thread = (168, 150, 132)
    for i in range(-8, 18):
        draw.line([(i * step, 0), (i * step + 512, 512)], fill=thread, width=2)
        draw.line([(i * step, 512), (i * step + 512, 0)], fill=thread, width=2)
    quilt = quilt.filter(ImageFilter.GaussianBlur(radius=0.7))
    TEX['quilt'] = png_bytes(np.asarray(quilt))

    screen = Image.new('RGB', (1024, 560), (6, 28, 40))
    d = ImageDraw.Draw(screen, 'RGBA')
    blobs = [
        ((80, 40, 420, 340), (30, 170, 186, 230)),
        ((380, 60, 900, 420), (36, 96, 190, 220)),
        ((700, 300, 1000, 540), (230, 110, 42, 230)),
        ((20, 280, 280, 540), (28, 120, 196, 210)),
        ((300, 250, 560, 480), (70, 200, 186, 180)),
        ((460, 20, 680, 180), (220, 236, 240, 160)),
    ]
    for box, col in blobs:
        d.ellipse(box, fill=col)
    TEX['screen'] = png_bytes(np.asarray(screen.convert('RGB')))


def f3(p):
    return '(%s, %s, %s)' % tuple(('%.5f' % v).rstrip('0').rstrip('.') or '0' for v in p)


def f2(p):
    return '(%s, %s)' % tuple(('%.4f' % v).rstrip('0').rstrip('.') or '0' for v in p)


def write_glb(path, parts):
    parts = [p for p in parts if p.points]
    blobs = []
    views = []
    accessors = []
    primitives = []
    materials = []
    images = []
    textures = []
    offset = 0
    tex_index = {}

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
        if part.texture not in tex_index:
            start, length = push(TEX[part.texture])
            views.append({'buffer': 0, 'byteOffset': start, 'byteLength': length})
            images.append({'bufferView': len(views) - 1, 'mimeType': 'image/png'})
            textures.append({'sampler': 0, 'source': len(images) - 1})
            tex_index[part.texture] = len(textures) - 1

    for part in parts:
        pos = b''.join(struct.pack('<3f', *p) for p in part.points)
        nrm = b''.join(struct.pack('<3f', *n) for n in part.normals)
        uv = b''.join(struct.pack('<2f', *t) for t in part.uvs)
        count = len(part.points)
        xs = [p[0] for p in part.points]
        ys = [p[1] for p in part.points]
        zs = [p[2] for p in part.points]
        specs = [
            ('POSITION', pos, 'VEC3', [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]),
            ('NORMAL', nrm, 'VEC3', None, None),
            ('TEXCOORD_0', uv, 'VEC2', None, None),
        ]
        attrs = {}
        for name, data, typ, amin, amax in specs:
            start, length = push(data)
            views.append({'buffer': 0, 'byteOffset': start, 'byteLength': length})
            acc = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': count, 'type': typ}
            if amin is not None:
                acc['min'] = amin
                acc['max'] = amax
            accessors.append(acc)
            attrs[name] = len(accessors) - 1
        materials.append({
            'name': part.name,
            'pbrMetallicRoughness': {
                'baseColorTexture': {'index': tex_index[part.texture]},
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
        'textures': textures,
        'images': images,
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
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


def write_usda(path, parts):
    parts = [p for p in parts if p.points]
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
        lines += [
            '        def Material "%s"' % part.name,
            '        {',
            '            token outputs:surface.connect = </Root/Materials/%s/Preview.outputs:surface>' % part.name,
            '            def Shader "Preview"',
            '            {',
            '                uniform token info:id = "UsdPreviewSurface"',
            '                color3f inputs:diffuseColor.connect = </Root/Materials/%s/Color.outputs:rgb>' % part.name,
            '                float inputs:metallic = %.3f' % part.metallic,
            '                float inputs:roughness = %.3f' % part.roughness,
            '                token outputs:surface',
            '            }',
            '            def Shader "Color"',
            '            {',
            '                uniform token info:id = "UsdUVTexture"',
            '                asset inputs:file = @%s.png@' % part.texture,
            '                float2 inputs:st.connect = </Root/Materials/%s/ST.outputs:result>' % part.name,
            '                token inputs:wrapS = "repeat"',
            '                token inputs:wrapT = "repeat"',
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
        ]
    lines.append('    }')
    for part in parts:
        pts = ', '.join(f3(p) for p in part.points)
        nrm = ', '.join(f3(n) for n in part.normals)
        # USD's st origin is the bottom of the image; glTF's is the top. Flip V.
        st = ', '.join(f2((u, 1.0 - v)) for u, v in part.uvs)
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
            '        texCoord2f[] primvars:st = [%s] (' % st,
            '            interpolation = "vertex"',
            '        )',
            '    }',
        ]
    lines.append('}')
    path.write_text('\n'.join(lines) + '\n')


def write_usdz(usda, usdz, parts):
    names = {p.texture for p in parts if p.points}
    for name in names:
        (usda.parent / (name + '.png')).write_bytes(TEX[name])
    subprocess.check_call([USDZIP, '--arkitAsset', str(usda), str(usdz)], stdout=subprocess.DEVNULL)
    for name in names:
        (usda.parent / (name + '.png')).unlink()


def lamp():
    """Matte black puck, curved neck, tilted cone, cord, and a small switch."""
    base = Part('Base', 'plastic', roughness=0.48)
    add_cylinder(base, (0, 0, 0), (0, 0.028, 0), 0.082, n=48, tile=0.06)
    lip = Part('Lip', 'plastic', roughness=0.45)
    add_frustum(lip, (0, 0.026, 0), (0, 0.044, 0), 0.082, 0.056, n=40, caps=False, tile=0.06)
    tray = Part('Tray', 'plastic_soft', roughness=0.6)
    add_cylinder(tray, (0, 0.028, 0), (0, 0.036, 0), 0.050, n=32, tile=0.05)
    neck = Part('Neck', 'plastic_soft', metallic=0.25, roughness=0.32)
    pts = curve((0, 0.040, 0), (0.0, 0.22, 0.02), (0.03, 0.36, 0.09), 14)
    add_pipe(neck, pts, 0.009, n=12, tile=0.04)
    switch = Part('Switch', 'plastic_soft', roughness=0.4)
    add_box(switch, (0.0, 0.16, 0.016), (0.018, 0.012, 0.016), tile=0.04)
    shade = Part('Shade', 'shade', roughness=0.4)
    top = (0.012, 0.42, 0.055)
    mouth = (0.058, 0.30, 0.155)
    axis = norm(sub(mouth, top))
    add_frustum(shade, top, mouth, 0.028, 0.078, n=48, caps=False, tile=0.06)
    cap_c = sub(top, mul(axis, 0.008))
    add_frustum(shade, cap_c, top, 0.010, 0.028, n=28, caps=True, tile=0.05)
    inside = Part('Inside', 'inside', roughness=0.3)
    inner_top = add(top, mul(axis, 0.016))
    inner_mouth = sub(mouth, mul(axis, 0.006))
    add_frustum(inside, inner_top, inner_mouth, 0.016, 0.062, n=40, caps=True, tile=0.06)
    cord = Part('Cord', 'rubber', roughness=0.7)
    add_pipe(cord, curve((0, 0.01, -0.07), (-0.02, 0.008, -0.16), (-0.08, 0.006, -0.22), 8), 0.004, n=8, tile=0.03)
    return [base, lip, tray, neck, switch, shade, inside, cord]


def floor_lamp():
    """Brass stem, veined marble disc, linen drum, pull, finial."""
    base = Part('Marble', 'marble', metallic=0.04, roughness=0.28)
    add_cylinder(base, (0, 0, 0), (0, 0.02, 0), 0.13, n=56, tile=0.2)
    edge = Part('MarbleEdge', 'marble', roughness=0.35)
    add_torus(edge, (0, 0.01, 0), 0.124, 0.008, n=48, m=10, tile=0.08)
    collar = Part('Collar', 'brass', metallic=0.9, roughness=0.24)
    add_cylinder(collar, (0, 0.02, 0), (0, 0.04, 0), 0.018, n=20, tile=0.04)
    pole = Part('Pole', 'brass', metallic=0.88, roughness=0.22)
    add_cylinder(pole, (0, 0.036, 0), (0, 1.28, 0), 0.008, n=16, tile=0.04)
    rings = Part('PoleRings', 'brass', metallic=0.9, roughness=0.2)
    for y in (0.42, 0.78, 1.12):
        add_torus(rings, (0, y, 0), 0.014, 0.004, n=20, m=8, tile=0.03)
    chain = Part('Chain', 'brass', metallic=0.8, roughness=0.3)
    add_pipe(chain, [(0.02, 1.22, 0.0), (0.03, 1.10, 0.01), (0.028, 1.00, 0.012)], 0.0025, n=6, tile=0.02)
    pull = Part('Pull', 'brass', metallic=0.85, roughness=0.25)
    add_ellipsoid(pull, (0.028, 0.985, 0.012), (0.008, 0.012, 0.008), seg=12, rings=8, repeat=(1, 1))
    shade = Part('Shade', 'linen', roughness=0.78)
    add_frustum(shade, (0, 1.52, 0), (0, 1.22, 0), 0.155, 0.17, n=56, caps=False, tile=0.08)
    liner = Part('Liner', 'inside', roughness=0.4)
    add_frustum(liner, (0, 1.50, 0), (0, 1.24, 0), 0.142, 0.156, n=48, caps=False, tile=0.08)
    trim = Part('Trim', 'brass', metallic=0.85, roughness=0.28)
    add_torus(trim, (0, 1.52, 0), 0.155, 0.006, n=48, m=8, tile=0.04)
    add_torus(trim, (0, 1.22, 0), 0.17, 0.006, n=48, m=8, tile=0.04)
    finial = Part('Finial', 'brass', metallic=0.92, roughness=0.2)
    add_cylinder(finial, (0, 1.52, 0), (0, 1.58, 0), 0.0045, n=10, tile=0.03)
    add_ellipsoid(finial, (0, 1.598, 0), (0.014, 0.016, 0.014), seg=16, rings=10, repeat=(1, 1))
    return [base, edge, collar, pole, rings, chain, pull, shade, liner, trim, finial]


def fan():
    """Black tower with a denser front grille, rear intake, and a top panel."""
    base = Part('Base', 'plastic', roughness=0.5)
    add_cylinder(base, (0, 0, 0), (0, 0.02, 0), 0.14, n=48, tile=0.08)
    add_frustum(base, (0, 0.02, 0), (0, 0.06, 0), 0.10, 0.072, n=36, caps=False, tile=0.08)
    body = Part('Tower', 'plastic', roughness=0.36)
    add_cylinder(body, (0, 0.055, 0), (0, 0.96, 0), 0.072, n=40, tile=0.06)
    vent = Part('Vent', 'shade', roughness=0.7)
    add_box(vent, (0, 0.52, 0.08), (0.122, 0.74, 0.016), tile=0.1)
    slats = Part('Slats', 'plastic_soft', roughness=0.32)
    for i in range(18):
        x = -0.058 + i * 0.0068
        z2 = 0.072 * 0.072 - x * x
        if z2 <= 0.0004:
            continue
        z = math.sqrt(z2) + 0.016
        add_box(slats, (x, 0.52, z), (0.0034, 0.72, 0.008), tile=0.08)
    intake = Part('Intake', 'plastic_soft', roughness=0.4)
    for i in range(14):
        x = -0.05 + i * 0.0076
        z2 = 0.072 * 0.072 - x * x
        if z2 <= 0.0004:
            continue
        add_box(intake, (x, 0.50, -math.sqrt(z2)), (0.003, 0.62, 0.01), tile=0.08)
    cap = Part('Cap', 'plastic', roughness=0.4)
    add_cylinder(cap, (0, 0.96, 0), (0, 1.02, 0), 0.062, n=32, tile=0.06)
    buttons = Part('Buttons', 'plastic_soft', roughness=0.35)
    for i, x in enumerate((-0.02, 0.0, 0.02)):
        add_cylinder(buttons, (x, 1.02, 0.02), (x, 1.032, 0.02), 0.007, n=10, tile=0.02)
    cord = Part('Cord', 'rubber', roughness=0.7)
    add_pipe(cord, [(0, 0.02, -0.12), (0, 0.008, -0.2), (0.06, 0.006, -0.26)], 0.004, n=8, tile=0.03)
    return [base, body, vent, slats, intake, cap, buttons, cord]


def bean():
    """Gray lounger with a piped seam, bolsters, and a tufted back."""
    bag = Part('Body', 'fabric', roughness=0.86)
    add_ellipsoid(bag, (0, 0.28, 0.02), (0.38, 0.28, 0.36), seg=48, rings=28, repeat=(1.6, 1.1))
    back = Part('Back', 'fabric', roughness=0.86)
    add_ellipsoid(back, (0, 0.46, -0.12), (0.30, 0.24, 0.22), seg=40, rings=22, repeat=(1.4, 1.0))
    bolsters = Part('Bolsters', 'fabric', roughness=0.88)
    add_ellipsoid(bolsters, (-0.24, 0.30, 0.08), (0.14, 0.16, 0.22), seg=28, rings=16, repeat=(2, 1))
    add_ellipsoid(bolsters, (0.24, 0.30, 0.08), (0.14, 0.16, 0.22), seg=28, rings=16, repeat=(2, 1))
    seat = Part('Seat', 'fabric_dark', roughness=0.9)
    add_ellipsoid(seat, (0, 0.36, 0.12), (0.18, 0.06, 0.16), seg=28, rings=14, repeat=(2, 1))
    seam = Part('Seam', 'fabric_dark', roughness=0.7)
    add_ellipse_pipe(seam, (0, 0, 0.02), 0.40, 0.38, 0.28, 0.015, n=72, tube=10, tile=0.05)
    button = Part('Button', 'fabric_dark', roughness=0.65)
    add_ellipsoid(button, (0, 0.58, -0.08), (0.03, 0.016, 0.02), seg=14, rings=8, repeat=(1, 1))
    return [bag, back, bolsters, seat, seam, button]


def tv():
    """Thin panel, neck, two feet, and a printed screen."""
    bezel = Part('Bezel', 'plastic', roughness=0.35)
    add_box(bezel, (0, 0.30, 0), (0.74, 0.42, 0.028), tile=0.08)
    lip = Part('Lip', 'plastic_soft', roughness=0.3)
    add_box(lip, (0, 0.30, 0.012), (0.70, 0.385, 0.008), tile=0.08)
    screen = Part('Screen', 'screen', metallic=0.12, roughness=0.16)
    add_plane(screen, (0, 0.30, 0.020), 0.68, 0.36)
    feet = Part('Feet', 'plastic', roughness=0.42)
    for x in (-0.20, 0.20):
        add_box(feet, (x, 0.05, 0.0), (0.032, 0.10, 0.028), tile=0.05)
        add_box(feet, (x, 0.008, 0.012), (0.15, 0.016, 0.09), tile=0.06)
    return [bezel, lip, screen, feet]


def topper():
    """XL twin pad folded in thirds. Each panel is thick enough that the
    rounded turns read as a fold instead of a flat slab."""
    cloth = Part('Fold', 'quilt', roughness=0.82)
    path = z_fold_path(length=0.52, gap=0.072, y0=0.038, n_line=28, n_arc=20)
    add_ribbon(cloth, path, half_width=0.44, half_thick=0.030, tile=0.18)
    return [cloth]


def cart():
    """Black wire rack: arched sides, four tighter baskets, hooks, casters."""
    frame = Part('Frame', 'metal', metallic=0.62, roughness=0.32)
    for x in (-0.20, 0.20):
        add_cylinder(frame, (x, 0.08, -0.16), (x, 0.78, -0.16), 0.008, n=10, tile=0.04)
        add_cylinder(frame, (x, 0.08, 0.16), (x, 0.78, 0.16), 0.008, n=10, tile=0.04)
        add_pipe(frame, curve((x, 0.78, -0.16), (x, 0.96, 0), (x, 0.78, 0.16), 8), 0.008, n=8, tile=0.04)
    grip = Part('Grip', 'rubber', roughness=0.65)
    for x in (-0.20, 0.20):
        add_pipe(grip, curve((x, 0.86, -0.08), (x, 0.95, 0), (x, 0.86, 0.08), 6), 0.012, n=8, tile=0.04)
    baskets = Part('Baskets', 'metal', metallic=0.4, roughness=0.4)
    x0, x1, z0, z1 = -0.18, 0.18, -0.15, 0.15
    for y in (0.20, 0.40, 0.58, 0.76):
        rim = [((x0, y, z0), (x1, y, z0)), ((x1, y, z0), (x1, y, z1)),
               ((x1, y, z1), (x0, y, z1)), ((x0, y, z1), (x0, y, z0))]
        for a, b in rim:
            add_cylinder(baskets, a, b, 0.0045, n=8, tile=0.03)
        yb = y - 0.055
        for i in range(6):
            z = z0 + (i + 0.5) * (z1 - z0) / 6
            add_cylinder(baskets, (x0, yb, z), (x1, yb, z), 0.0024, n=6, caps=False, tile=0.03)
        for i in range(5):
            x = x0 + (i + 0.5) * (x1 - x0) / 5
            add_cylinder(baskets, (x, yb, z0), (x, yb, z1), 0.0024, n=6, caps=False, tile=0.03)
        for x in (x0, x1):
            for z in (z0, (z0 + z1) / 2, z1):
                add_cylinder(baskets, (x, yb, z), (x, y, z), 0.0028, n=6, caps=False, tile=0.03)
    hooks = Part('Hooks', 'metal', metallic=0.55, roughness=0.32)
    for y in (0.66, 0.46):
        add_cylinder(hooks, (0.20, y, 0.05), (0.26, y, 0.05), 0.0035, n=8, tile=0.02)
        add_cylinder(hooks, (0.26, y, 0.05), (0.26, y - 0.04, 0.05), 0.0035, n=8, tile=0.02)
    wheels = Part('Wheels', 'rubber', roughness=0.6)
    hubs = Part('Hubs', 'metal', metallic=0.5, roughness=0.3)
    forks = Part('Forks', 'metal', metallic=0.45, roughness=0.35)
    for x in (-0.16, 0.16):
        for z in (-0.12, 0.12):
            add_cylinder(wheels, (x - 0.014, 0.028, z), (x + 0.014, 0.028, z), 0.028, n=16, tile=0.04)
            add_cylinder(hubs, (x - 0.016, 0.028, z), (x + 0.016, 0.028, z), 0.01, n=10, tile=0.02)
            add_cylinder(forks, (x, 0.028, z), (x, 0.10, z), 0.005, n=8, tile=0.03)
    return [wheels, hubs, forks, frame, grip, baskets, hooks]


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
    make_textures()
    tmp = OUT / '_src'
    tmp.mkdir(exist_ok=True)
    for name, build in MODELS.items():
        parts = build()
        lift_to_floor(parts)
        lo, hi = bounds(parts)
        tris = sum(len(p.points) // 3 for p in parts)
        print('%s  %.2f x %.2f x %.2f m   y %.3f-%.3f   %d tris' % (
            name, hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], lo[1], hi[1], tris))
        usda = tmp / (name + '.usda')
        write_usda(usda, parts)
        write_glb(OUT / (name + '.glb'), parts)
        write_usdz(usda, OUT / (name + '.usdz'), parts)
        usda.unlink()
    tmp.rmdir()


if __name__ == '__main__':
    main()
