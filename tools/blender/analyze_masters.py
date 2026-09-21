#!/usr/bin/env python3
"""Objective pixel analysis for rendered master PNGs (no visual model needed).

Loads each PNG via Blender's image API and reports:
  - dimensions
  - opaque coverage (share of pixels with alpha > 0.05)
  - non-transparent bounding box (clipping check: must not touch frame edges)
  - mean RGB of opaque pixels (color character per owner/role)

Usage:
  blender --background --factory-startup --python tools/blender/analyze_masters.py -- <file.png> [more.png ...]
"""

import json
import os
import sys


def analyze(path):
    import bpy
    img = bpy.data.images.load(path)
    try:
        width, height = img.size
        pixels = img.pixels[:]  # RGBA, bottom-up
        total = width * height
        opaque = 0
        sum_r = sum_g = sum_b = 0.0
        min_x, min_y, max_x, max_y = width, height, -1, -1
        for y in range(height):
            row = y * width * 4
            for x in range(width):
                a = pixels[row + x * 4 + 3]
                if a > 0.05:
                    opaque += 1
                    sum_r += pixels[row + x * 4]
                    sum_g += pixels[row + x * 4 + 1]
                    sum_b += pixels[row + x * 4 + 2]
                    # Track bbox in top-down coordinates for readability.
                    ty = height - 1 - y
                    if x < min_x:
                        min_x = x
                    if x > max_x:
                        max_x = x
                    if ty < min_y:
                        min_y = ty
                    if ty > max_y:
                        max_y = ty
        if opaque == 0:
            return {"file": os.path.basename(path), "width": width, "height": height, "error": "fully transparent"}
        touches_edge = min_x == 0 or min_y == 0 or max_x == width - 1 or max_y == height - 1
        return {
            "file": os.path.basename(path),
            "width": width,
            "height": height,
            "opaquePct": round(100.0 * opaque / total, 1),
            "bbox": [min_x, min_y, max_x, max_y],
            "touchesEdge": touches_edge,
            "meanRGB": [round(sum_r / opaque, 3), round(sum_g / opaque, 3), round(sum_b / opaque, 3)],
        }
    finally:
        bpy.data.images.remove(img)


def pixel_grid(path):
    """Loads an image and returns (width, height, pixels)."""
    import bpy
    img = bpy.data.images.load(path)
    try:
        return img.size[0], img.size[1], img.pixels[:]
    finally:
        bpy.data.images.remove(img)


def diff_stats(path_a, path_b):
    """Shares of pixels whose color/alpha differ beyond a small tolerance."""
    width_a, height_a, px_a = pixel_grid(path_a)
    width_b, height_b, px_b = pixel_grid(path_b)
    if (width_a, height_a) != (width_b, height_b):
        return {"error": f"size mismatch {width_a}x{height_a} vs {width_b}x{height_b}"}
    total = width_a * height_a
    changed_color = 0
    changed_alpha = 0
    for index in range(total):
        offset = index * 4
        alpha_a = px_a[offset + 3]
        alpha_b = px_b[offset + 3]
        if abs(alpha_a - alpha_b) > 0.05:
            changed_alpha += 1
        elif alpha_a > 0.05:
            for channel in range(3):
                if abs(px_a[offset + channel] - px_b[offset + channel]) > 0.08:
                    changed_color += 1
                    break
    return {
        "a": os.path.basename(path_a),
        "b": os.path.basename(path_b),
        "changedColorPct": round(100.0 * changed_color / total, 2),
        "changedAlphaPct": round(100.0 * changed_alpha / total, 2),
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        print(json.dumps({"error": "no files given"}))
        raise SystemExit(2)
    if len(argv) == 2 and argv[0] != argv[1]:
        print("CC_ANALYSIS_JSON_BEGIN")
        print(json.dumps(diff_stats(argv[0], argv[1]), indent=1))
        print("CC_ANALYSIS_JSON_END")
        return
    results = [analyze(path) for path in argv]
    print("CC_ANALYSIS_JSON_BEGIN")
    print(json.dumps(results, indent=1))
    print("CC_ANALYSIS_JSON_END")


if __name__ == "__main__":
    main()
