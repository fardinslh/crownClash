#!/usr/bin/env bash
# Optimizes Blender PNG masters into the runtime textures GameScene loads,
# driven by the canonical manifest (art/asset-manifest.json).
#
# For every sprite of the requested pack this script:
#   1. reads the pack's `blenderRenderName` master PNG (512x512),
#   2. resizes it to the manifest's `targetSize` (alpha preserved),
#   3. writes it as the manifest's `runtimeFilename` in the pack's declared
#      format, at the exact `runtimePath` GameScene preloads.
#
# It NEVER copies 512x512 masters through unchanged, and it fails hard (with
# actionable installation instructions) when source files or conversion tools
# are missing. An empty source directory is an error, not a success.
#
# Usage:
#   tools/blender/optimize_outputs.sh <render-masters-dir> <pack-id> [runtime-root]
#
#   <masters-dir>   directory of Blender PNG masters (e.g. art/blender/renders/crown_cross)
#   <pack-id>       pack id in art/asset-manifest.json (e.g. crown_cross)
#   [runtime-root]  repo-root prefix for manifest runtimePath entries;
#                   defaults to the repository root (tests may override)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${CC_ASSET_MANIFEST:-${REPO_ROOT}/art/asset-manifest.json}"
SRC_DIR="${1:?usage: optimize_outputs.sh <render-masters-dir> <pack-id> [runtime-root]}"
PACK_ID="${2:?usage: optimize_outputs.sh <render-masters-dir> <pack-id> [runtime-root]}"
RUNTIME_ROOT="${3:-${REPO_ROOT}}"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "[optimize_outputs] ERROR: masters directory ${SRC_DIR} does not exist." >&2
  echo "[optimize_outputs] Render it first, e.g.: tools/blender/render_battlefield.sh ${PACK_ID}" >&2
  exit 2
fi

shopt -s nullglob
MASTERS=("${SRC_DIR}"/*.png)
shopt -u nullglob
if [[ ${#MASTERS[@]} -eq 0 ]]; then
  echo "[optimize_outputs] ERROR: ${SRC_DIR} contains no PNG masters; nothing to optimize." >&2
  echo "[optimize_outputs] Render the pack first: tools/blender/render_battlefield.sh ${PACK_ID}" >&2
  exit 2
fi

if [[ ! -f "${MANIFEST}" ]]; then
  echo "[optimize_outputs] ERROR: asset manifest not found at ${MANIFEST}" >&2
  exit 2
fi

# One line per unique runtime file: renderName|runtimeFilename|targetSize|runtimePath
# (manifest aliases share a runtimePath and are deduplicated here).
SPRITE_LINES="$(node -e '
  const fs = require("fs");
  const [manifestPath, packId] = process.argv.slice(1);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const pack = manifest.packs && manifest.packs[packId];
  if (!pack) {
    console.error(`[optimize_outputs] manifest ${manifestPath} declares no pack "${packId}"`);
    process.exit(2);
  }
  const format = pack.runtimeFormat;
  const seen = new Set();
  for (const [key, sprite] of Object.entries(pack.sprites || {})) {
    if (!sprite.blenderRenderName || !sprite.runtimeFilename || !sprite.targetSize || !sprite.runtimePath) {
      console.error(`[optimize_outputs] manifest pack "${packId}" sprite "${key}" is missing required fields`);
      process.exit(2);
    }
    if (!sprite.runtimeFilename.toLowerCase().endsWith("." + String(format).toLowerCase())) {
      console.error(`[optimize_outputs] manifest pack "${packId}" sprite "${key}": runtimeFilename ${sprite.runtimeFilename} does not match declared format ${format}`);
      process.exit(2);
    }
    if (seen.has(sprite.runtimePath)) continue;
    seen.add(sprite.runtimePath);
    console.log([sprite.blenderRenderName, sprite.runtimeFilename, sprite.targetSize, sprite.runtimePath].join("|"));
  }
' "${MANIFEST}" "${PACK_ID}")"

# Fail up-front if any required master is missing (never partially optimize).
MISSING=0
while IFS='|' read -r RENDER_NAME _FILENAME _SIZE _PATH; do
  if [[ ! -f "${SRC_DIR}/${RENDER_NAME}.png" ]]; then
    echo "[optimize_outputs] ERROR: missing master ${SRC_DIR}/${RENDER_NAME}.png (required by manifest pack ${PACK_ID})." >&2
    MISSING=1
  fi
done <<< "${SPRITE_LINES}"
if [[ "${MISSING}" -ne 0 ]]; then
  echo "[optimize_outputs] Render the missing masters with: tools/blender/render_battlefield.sh ${PACK_ID} --asset <name>" >&2
  exit 2
fi

FORMAT="$(node -e '
  const fs = require("fs");
  const pack = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).packs[process.argv[2]];
  console.log(pack.runtimeFormat);
' "${MANIFEST}" "${PACK_ID}")"

pick_png_resizer() {
  if command -v magick >/dev/null 2>&1; then
    echo "magick"
  elif command -v convert >/dev/null 2>&1; then
    echo "convert"
  elif command -v sips >/dev/null 2>&1; then
    echo "sips"
  else
    echo ""
  fi
}

resize_png() {
  local src="$1" out="$2" size="$3"
  local resizer
  resizer="$(pick_png_resizer)"
  case "${resizer}" in
    magick)  magick "${src}" -resize "${size}x${size}" "${out}" ;;
    convert) convert "${src}" -resize "${size}x${size}" "${out}" ;;
    sips)    sips -s format png -z "${size}" "${size}" "${src}" --out "${out}" >/dev/null ;;
    *)
      echo "[optimize_outputs] ERROR: no PNG resizer found. Install one of:" >&2
      echo "  macOS (built-in): sips is preinstalled; if missing, reinstall Xcode command line tools." >&2
      echo "  ImageMagick:      brew install imagemagick   /   apt-get install imagemagick" >&2
      exit 3
      ;;
  esac
}

resize_webp() {
  local src="$1" out="$2" size="$3"
  if ! command -v cwebp >/dev/null 2>&1; then
    echo "[optimize_outputs] ERROR: cwebp is required to produce WebP runtime assets." >&2
    echo "  macOS:    brew install webp" >&2
    echo "  Debian:   sudo apt-get install webp" >&2
    exit 3
  fi
  # -resize preserves the alpha channel; quality 90 per Art Bible section 14.
  cwebp -quiet -resize "${size}" "${size}" -alpha_filter best -q 90 "${src}" -o "${out}"
}

WRITTEN=0
while IFS='|' read -r RENDER_NAME RUNTIME_FILENAME TARGET_SIZE RUNTIME_PATH; do
  SRC_PNG="${SRC_DIR}/${RENDER_NAME}.png"
  OUT_FILE="${RUNTIME_ROOT}/${RUNTIME_PATH}"
  mkdir -p "$(dirname "${OUT_FILE}")"
  case "${FORMAT}" in
    png)  resize_png "${SRC_PNG}" "${OUT_FILE}" "${TARGET_SIZE}" ;;
    webp) resize_webp "${SRC_PNG}" "${OUT_FILE}" "${TARGET_SIZE}" ;;
    *)
      echo "[optimize_outputs] ERROR: manifest pack ${PACK_ID} declares unsupported runtimeFormat '${FORMAT}' (supported: png, webp)." >&2
      exit 2
      ;;
  esac
  if [[ ! -f "${OUT_FILE}" ]]; then
    echo "[optimize_outputs] ERROR: converter reported success but ${OUT_FILE} is missing." >&2
    exit 1
  fi
  echo "[optimize_outputs] ${RENDER_NAME}.png (512 master) -> ${RUNTIME_PATH} (${TARGET_SIZE}x${TARGET_SIZE} ${FORMAT})"
  WRITTEN=$((WRITTEN + 1))
done <<< "${SPRITE_LINES}"

echo "[optimize_outputs] done: ${WRITTEN} runtime asset(s) for pack ${PACK_ID} in ${RUNTIME_ROOT}"
