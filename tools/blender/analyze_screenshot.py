#!/usr/bin/env python3
"""Screenshot color-census QA: counts pixels in ownership/theme color classes.

Usage:
  blender --background --factory-startup --python tools/blender/analyze_screenshot.py -- <shot.png> [more.png ...]
"""

import json
import os
import sys


def classify_pixels(path):
    import bpy
    img = bpy.data.images.load(path)
    try:
        width, height = img.size
        pixels = img.pixels[:]
        total = width * height
        classes = {
            "blue_player": 0,
            "red_enemy": 0,
            "stone_gray": 0,
            "gold_accent": 0,
            "dark_field": 0,
            "other": 0,
        }
        for index in range(total):
            r = pixels[index * 4]
            g = pixels[index * 4 + 1]
            b = pixels[index * 4 + 2]
            if b > 0.45 and b > r + 0.12 and b > g + 0.08:
                classes["blue_player"] += 1
            elif r > 0.42 and r > g + 0.15 and r > b + 0.15:
                classes["red_enemy"] += 1
            elif r > 0.55 and g > 0.4 and b < 0.3:
                classes["gold_accent"] += 1
            elif 0.12 < r < 0.75 and abs(r - g) < 0.12 and abs(g - b) < 0.14 and r > 0.16:
                classes["stone_gray"] += 1
            elif r < 0.12 and g < 0.14 and b < 0.2:
                classes["dark_field"] += 1
            else:
                classes["other"] += 1
        return {
            "file": os.path.basename(path),
            "width": width,
            "height": height,
            "pct": {k: round(100.0 * v / total, 2) for k, v in classes.items()},
        }
    finally:
        bpy.data.images.remove(img)


def stitch_signature(path):
    """Detects duplicated/stitched captures: compares half-views.

    A single-viewport game render has visually distinct halves (the arena is
    asymmetric: player base at the bottom, enemy at the top, distinct lanes).
    A capture that repeats the same view side-by-side has near-identical left
    and right halves; a vertically stitched capture has near-identical top and
    bottom halves.
    """
    import bpy
    img = bpy.data.images.load(path)
    try:
        width, height = img.size
        pixels = img.pixels[:]
        stride = width * 4

        def sample(cx, cy):
            # Nearest-sample the pixel plane at (cx, cy) in physical pixels.
            offset = int(cy) * stride + int(cx) * 4
            return pixels[offset], pixels[offset + 1], pixels[offset + 2]

        def mean_half_diff(vertical_split):
            # Downsample to a coarse grid and average |a-b| over the two halves.
            step_x = max(1, width // 64)
            step_y = max(1, height // 64)
            total = 0.0
            count = 0
            ys = range(step_y, height, step_y)
            for y in ys:
                for x in range(step_x, width, step_x):
                    if vertical_split:
                        ax, bx = (x, width - 1 - x) if x < width // 2 else (width - 1 - x, x)
                        ar, ag, ab = sample(ax, y)
                        br, bg, bb = sample(bx, y)
                    else:
                        ay, by = (y, height - 1 - y) if y < height // 2 else (height - 1 - y, y)
                        ar, ag, ab = sample(x, ay)
                        br, bg, bb = sample(x, by)
                    total += (abs(ar - br) + abs(ag - bg) + abs(ab - bb)) / 3.0
                    count += 1
            return round(total / max(1, count), 4)

        return {
            "file": os.path.basename(path),
            "width": width,
            "height": height,
            "leftRightHalfDiff": mean_half_diff(vertical_split=True),
            "topBottomHalfDiff": mean_half_diff(vertical_split=False),
        }
    finally:
        bpy.data.images.remove(img)


def compare_downscaled(path_a, path_b):
    """Mean |a-b| after resizing b down to a's dimensions.

    Used to prove a DPR-2 capture is exactly a 2x raster of the same single
    viewport as the DPR-1 capture (a stitched/duplicated capture would disagree).
    """
    import bpy

    def load_rgb(path):
        img = bpy.data.images.load(path)
        try:
            width, height = img.size
            return width, height, img.pixels[:]
        finally:
            bpy.data.images.remove(img)

    width_a, height_a, px_a = load_rgb(path_a)
    width_b, height_b, px_b = load_rgb(path_b)
    scale_x = width_b / width_a
    scale_y = height_b / height_a
    total = 0.0
    count = 0
    for y in range(height_a):
        src_y = min(height_b - 1, int((y + 0.5) * scale_y))
        for x in range(width_a):
            src_x = min(width_b - 1, int((x + 0.5) * scale_x))
            offset_a = y * width_a * 4 + x * 4
            offset_b = src_y * width_b * 4 + src_x * 4
            total += (
                abs(px_a[offset_a] - px_b[offset_b])
                + abs(px_a[offset_a + 1] - px_b[offset_b + 1])
                + abs(px_a[offset_a + 2] - px_b[offset_b + 2])
            ) / 3.0
            count += 1
    return {
        "a": os.path.basename(path_a),
        "aSize": [width_a, height_a],
        "b": os.path.basename(path_b),
        "bSize": [width_b, height_b],
        "meanAbsDiff": round(total / max(1, count), 4),
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv and argv[0] == "--compare":
        print("CC_COMPARE_JSON_BEGIN")
        print(json.dumps(compare_downscaled(argv[1], argv[2]), indent=1))
        print("CC_COMPARE_JSON_END")
        return
    results = [classify_pixels(path) for path in argv]
    print("CC_SHOT_JSON_BEGIN")
    print(json.dumps(results, indent=1))
    print("CC_SHOT_JSON_END")

    print("CC_STITCH_JSON_BEGIN")
    print(json.dumps([stitch_signature(path) for path in argv], indent=1))
    print("CC_STITCH_JSON_END")


if __name__ == "__main__":
    main()
