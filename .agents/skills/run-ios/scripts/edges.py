"""Prints where the colour changes along one row or column of a simulator screenshot, in points.

Usage: python3 -I edges.py <shot.png> row|col <points> [scale]
`scale` is pixels per point: 3 on an iPhone 16e (the default).
"""

import os
import struct
import subprocess
import sys
import tempfile

shot, axis, at = sys.argv[1], sys.argv[2], float(sys.argv[3])
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0

# No PIL here, so sips converts to an uncompressed BMP that a few lines can read.
with tempfile.TemporaryDirectory() as tmp:
    bmp = os.path.join(tmp, "shot.bmp")
    subprocess.run(["sips", "-s", "format", "bmp", shot, "--out", bmp], check=True, capture_output=True)
    data = open(bmp, "rb").read()

(offset,) = struct.unpack_from("<I", data, 10)
width, height = struct.unpack_from("<ii", data, 18)
(bits,) = struct.unpack_from("<H", data, 28)
step = bits // 8
stride = (width * step + 3) & ~3
rows = abs(height)


def pixel(x, y):
    # A positive height means the rows are stored bottom-up.
    i = offset + (rows - 1 - y if height > 0 else y) * stride + x * step
    return data[i + 2], data[i + 1], data[i]


line = int(at * scale)
span = width if axis == "row" else rows
previous = None
for i in range(span):
    rgb = pixel(i, line) if axis == "row" else pixel(line, i)
    # Bucket the channels so anti-aliasing and gradients don't print every pixel.
    bucket = tuple(c // 24 for c in rgb)
    if bucket != previous:
        print(f"{i / scale:.1f}pt rgb{rgb}")
        previous = bucket
