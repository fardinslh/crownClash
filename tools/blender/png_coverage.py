#!/usr/bin/env python3
"""Tiny pure-stdlib PNG silhouette checker (dev-only, no deps).

Decodes 8-bit RGBA PNGs and reports opaque-pixel coverage and the silhouette
bounding box, so framing mistakes (clipped or tiny subjects) are caught
without opening an image editor. Usage: png_coverage.py FILE [FILE ...]
"""
import struct
import sys
import zlib


def decode_png(path):
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    pos = 8
    width = height = None
    bit_depth = color_type = None
    idat = b''
    while pos < len(data):
        length, ctype = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        if ctype == b'IHDR':
            width, height, bit_depth, color_type = struct.unpack('>IIBB', chunk[:10])
        elif ctype == b'IDAT':
            idat += chunk
        elif ctype == b'IEND':
            break
        pos += 12 + length
    if bit_depth != 8 or color_type != 6:
        raise ValueError('only 8-bit RGBA supported')
    raw = zlib.decompress(idat)
    stride = width * 4
    lines = []
    prev = bytearray(stride)
    offset = 0
    for _ in range(height):
        filter_byte = raw[offset]
        offset += 1
        line = bytearray(raw[offset:offset + stride])
        offset += stride
        if filter_byte == 1:
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif filter_byte == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filter_byte == 3:
            for i in range(stride):
                left = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filter_byte == 4:
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        lines.append(bytes(line))
        prev = line
    return width, height, lines


def stats(path):
    width, height, lines = decode_png(path)
    opaque = 0
    min_x, min_y, max_x, max_y = width, height, -1, -1
    red = green = blue = 0.0
    for y, line in enumerate(lines):
        for x in range(width):
            if line[x * 4 + 3] > 128:
                opaque += 1
                red += line[x * 4]
                green += line[x * 4 + 1]
                blue += line[x * 4 + 2]
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
    total = width * height
    coverage = 100.0 * opaque / total
    if max_x < 0:
        return coverage, None, None
    box = (min_x / width, min_y / height, (max_x + 1) / width, (max_y + 1) / height)
    mean_rgb = (red / opaque / 255.0, green / opaque / 255.0, blue / opaque / 255.0)
    return coverage, box, mean_rgb


for target in sys.argv[1:]:
    try:
        coverage, box, mean_rgb = stats(target)
        if box is None:
            print(f'{target}: EMPTY')
        else:
            color = f'rgb({mean_rgb[0]:.2f},{mean_rgb[1]:.2f},{mean_rgb[2]:.2f})'
            flag = ' DARK-SUSPECT' if max(mean_rgb) < 0.05 else ''
            print(f'{target.split("/")[-1]}: coverage {coverage:.1f}%, box x[{box[0]:.2f}-{box[2]:.2f}] y[{box[1]:.2f}-{box[3]:.2f}], {color}{flag}')
    except (ValueError, OSError) as error:
        print(f'{target}: ERROR {error}')
