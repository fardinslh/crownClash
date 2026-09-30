# Crown Cross approval study — pending visual approval

This branch (`art/crown-cross-review`) is an isolated composition study based on
restoration commit `99032b2`. Do not merge or deploy it as a finished asset pack.
The main worktree retains the restored pre-refresh art.

## What the sample proves

- A complete initial Crown Cross scene rendered by Phaser at real map coordinates.
- Slate stone, pitched blue-gray roofs, a crenellated central keep and four-turret
  citadels. Barracks have a shield and chimney; stables have open stalls and canopy.
- Quiet ground, restrained cobbled lanes, centered building counts and role marks.
- Four Blender troop studies at the existing marching scales. Animation scale
  overrides were inspected; changing initial setScale alone has no lasting effect.
- Downward Crown Cross marches place their count below the leader, leaving the
  followers visible. Other battlefield layouts retain their previous label placement.

## Reproduction

Run in this worktree:

```sh
blender --background --factory-startup --python-exit-code 1 --python art/prototypes/crown_cross_review.py
npm --workspace=apps/game run dev -- --port 3001
CC_QA_APP_URL='http://localhost:3001/?benchmark_mode=1' node scripts/capture-crown-review.mjs crown_cross qa-artifacts/art-crown-cross-study/after
```

The Blender script writes nine 512px transparent PNG studies under the ignored
`qa-artifacts/art-crown-cross-study/masters/` directory. Preview exports use cwebp
quality 86 at 160px for citadels / 128px for other buildings, and `sips -z 128 128`
for the four unit PNGs. Only the initial scene's five building variants are replaced.
All capture-owned source states are restored from the canonical map; the clock is
frozen at zero, and one 10-unit army per team is frozen at 45% of its first flank
route. The fixed scene is an art fixture, not a live combat or performance test.
The ordinary capture script also exercised moving troops before the fixed review.

Before images use the same capture script against port 3000 in the restored main
worktree. The standalone comparison is saved in that worktree at
`qa-artifacts/art-crown-cross-review/comparison.html`; it includes all three screen
sizes and clean/army states. PNG exports are alongside it. Raw logs are under
`/tmp/crownclash-visual-checks/`.

## Validation and boundary

- Full `npm test`, `npm run typecheck`, `npm run build`; pre-existing Phaser chunk
  warning remains. No game-core, server, canonical map, road or hit-area changes.
- Three capture viewports: 360×800, 390×844, 430×932, DPR 2; no missing textures or
  browser console errors. The actual images were inspected for composition.
- Negative controls: restoring the old boxed courts fails the updated terrain
  test; capturing an invalid map fails for incomplete/fallback art.
- Preview file sizes: Crown pack 31,540 → 33,310 bytes; shared troops 51,545 → 37,224 bytes.
- Runtime dimensions and texture count remain unchanged; texture memory capacity
  is unchanged. Draw calls, frame times and low-end mobile hardware performance
  have NOT been measured; do not infer them from successful screenshots.

Pending the user's approval: final render quality, all captured ownership variants,
outpost asset, canonical pipeline/Art Bible integration, post-capture transitions,
three-other-map troop review, mobile profiling and deployment. The canonical Art
Bible deliberately remains unchanged until this direction is approved.
