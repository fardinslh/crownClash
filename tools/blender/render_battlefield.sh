#!/usr/bin/env bash
# Headless Crown Clash battlefield rendering (Art Bible sections 8/14).
#
# Locates a Blender binary (verified with Blender 5.2.2 LTS) and renders the
# modular asset kit for a
# battlefield deterministically (fixed camera rig, fixed seed, transparent
# 512x512 PNG masters under art/blender/renders/<battlefield>/).
#
# Usage:
#   tools/blender/render_battlefield.sh crown_cross [extra args passed to the script]
#
# Environment:
#   BLENDER_BIN  explicit Blender binary path (optional)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BATTLEFIELD="${1:?usage: render_battlefield.sh <crown_cross|...> [extra args]}"
shift || true

find_blender() {
  if [[ -n "${BLENDER_BIN:-}" ]]; then
    echo "${BLENDER_BIN}"
    return 0
  fi
  if command -v blender >/dev/null 2>&1; then
    command -v blender
    return 0
  fi
  for app in /Applications/Blender.app/Contents/MacOS/Blender; do
    if [[ -x "$app" ]]; then
      echo "$app"
      return 0
    fi
  done
  echo "" >/dev/null
  return 1
}

if ! BLENDER="$(find_blender)"; then
  echo "Blender not found. Install a recent Blender (verified with 5.2.2 LTS) or set BLENDER_BIN=/path/to/blender." >&2
  echo "The pack contents come from the canonical manifest (no Blender needed to inspect it):" >&2
  echo "  node -e 'console.log(Object.keys(require(\"./art/asset-manifest.json\").packs.crown_cross.sprites))'" >&2
  exit 3
fi

OUT_DIR="${REPO_ROOT}/art/blender/renders/${BATTLEFIELD}"
mkdir -p "${OUT_DIR}"

echo "[render_battlefield] using Blender: ${BLENDER}"
echo "[render_battlefield] pack=${BATTLEFIELD} output=${OUT_DIR}"

exec "${BLENDER}" --background --factory-startup \
  --python "${REPO_ROOT}/art/blender/build_battlefield_scene.py" -- \
  --pack "${BATTLEFIELD}" --output "${OUT_DIR}" "$@"
