"""Generate the PWA icons and favicons in the brand palette.

The icons are committed binaries, but they used to have no source: changing the
colour system meant hand-editing PNGs. This script makes them reproducible.

    python3 scripts/make_icons.py

Mark: rounded maroon plate, off-white "A", soft-red tick. Sizes follow the
manifest plus the two extra PNG favicons referenced by the page. The maskable
variant bleeds to every edge because the platform applies its own mask.
"""
import math
import os
import struct
import zlib

# Brand palette
PLATE = (0x7C, 0x2A, 0x27)   # --color-2
GLYPH = (0xEC, 0xEB, 0xEB)   # --color-5
TICK = (0xE9, 0x73, 0x71)    # --color-8

TARGETS = [
    (192, "icon-192.png", False),
    (512, "icon-512.png", False),
    (512, "icon-maskable-512.png", True),
    (32, "favicon-32.png", False),
    (180, "apple-touch-icon.png", False),
]


def write_png(path, size, px):
    """Minimal RGBA PNG writer: no imaging library, so the repo stays dep-free."""
    raw = b"".join(b"\x00" + bytes(px[y * size * 4:(y + 1) * size * 4]) for y in range(size))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    denom = vx * vx + vy * vy or 1
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / denom))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def render(size, maskable):
    px = bytearray(size * size * 4)
    radius = size * 0.22
    pad = size * 0.14 if maskable else 0
    inner = size - 2 * pad
    rr = radius * (inner / size)

    w = size * (0.62 if maskable else 0.78)
    cx, cy = size / 2, size / 2
    stroke = size * 0.105

    apex = (cx, cy - w * 0.46)
    bottom_l = (cx - w * 0.40, cy + w * 0.44)
    bottom_r = (cx + w * 0.40, cy + w * 0.44)
    bar_l = (cx - w * 0.20, cy + w * 0.10)
    bar_r = (cx + w * 0.20, cy + w * 0.10)

    tick_a = (cx + w * 0.10, cy + w * 0.30)
    tick_b = (cx + w * 0.24, cy + w * 0.46)
    tick_c = (cx + w * 0.55, cy + w * 0.02)

    for y in range(size):
        for x in range(size):
            fx, fy = x + 0.5, y + 0.5

            if maskable:
                alpha = 1.0          # must bleed to the edges
            else:
                left, right = pad, size - pad
                if not (left <= fx <= right and pad <= fy <= size - pad):
                    continue
                qx = min(max(fx, left + rr), right - rr)
                qy = min(max(fy, pad + rr), size - pad - rr)
                d = math.hypot(fx - qx, fy - qy)
                alpha = 1.0 if d <= rr else max(0.0, min(1.0, rr + 0.5 - d))

            if alpha <= 0:
                continue

            colour = PLATE
            d_a = min(seg_dist(fx, fy, *apex, *bottom_l),
                      seg_dist(fx, fy, *apex, *bottom_r),
                      seg_dist(fx, fy, *bar_l, *bar_r))
            if d_a <= stroke / 2:
                colour = GLYPH
            d_t = min(seg_dist(fx, fy, *tick_a, *tick_b),
                      seg_dist(fx, fy, *tick_b, *tick_c))
            if d_t <= stroke / 2:
                colour = TICK

            i = (y * size + x) * 4
            px[i:i + 4] = bytes((*colour, int(255 * alpha)))

    return px


def main():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(here, "src", "pwa")
    for size, name, maskable in TARGETS:
        path = os.path.join(out, name)
        write_png(path, size, render(size, maskable))
        print(f"wrote src/pwa/{name} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    main()
