#!/usr/bin/env python3
"""Machine proof of the Phase 6 `quad_citadel` specification and symmetry.

Reads the SHIPPED authoritative battlefield definition directly from
apps/server-nakama/battlefields.json (never copied constants — docs/
2v2-architecture.md §7.3: "the script proof passes against the shipped JSON,
not a copy") and fails closed unless every invariant holds:

  - exactly 13 territories and exactly 20 roads;
  - every territory matches the explicit immutable PHASE6_SPEC table below
    (exact approved x/y, radius, owner, units, maxUnits, productionRate,
    tier, and type) — this pins the approved geometry even against drifts
    that would remain rotationally symmetric;
  - the exact approved 20-edge road set (canonical fingerprint);
  - territory ids are unique and the deterministic ordering is the frozen
    Phase 6 order (complete and duplicate-free);
  - every territory has EXACTLY ONE rotational counterpart at (400-x, 720-y)
    with mirror-equal (radius, tier, type, units, maxUnits, productionRate)
    and mirrored ownership in BOTH directions (player<->enemy, neutral<->
    neutral); the mirror map is an involution;
  - exactly one territory (the center, `n_center`) maps to itself;
  - the four starting fortresses form two Team A / Team B spawn pairs that
    map correctly (a_base_w <-> b_base_e, a_base_e <-> b_base_w);
  - every road endpoint exists, no self-roads, no duplicate undirected roads,
    and the road set is closed under mirroring with no mirror-INVARIANT
    (self-mapping) undirected edges;
  - degree caps: n_center 4, every other territory 3;
  - connectivity: every territory is reachable from every starting base,
    n_center is exactly 2 hops from each base, and the farthest territory
    from any base is 4 hops (cross-team corner);
  - the documented minimum pairwise spacing of ~58.3 px holds (and sockets
    of radius 26 never overlap), with the limiting pair(s) identified.

Malformed road entries are reported cleanly and never crash later passes.

Exit code 0 prints a PROOF: PASS summary. Any violated invariant is reported
as an actionable failure line and the process exits 1 (fail closed).

Usage: python3 tools/verify_battlefield_symmetry.py [path-to-battlefields.json]
"""

from __future__ import annotations

import json
import math
import sys
from collections import deque
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BATTLEFIELDS_PATH = REPO_ROOT / "apps" / "server-nakama" / "battlefields.json"

QUAD_CITADEL_ID = "quad_citadel"
EXPECTED_TERRITORY_COUNT = 13
EXPECTED_ROAD_COUNT = 20
CANVAS_WIDTH = 400
CANVAS_HEIGHT = 720
CENTER_ID = "n_center"

# The explicit immutable Phase 6 specification (docs/2v2-architecture.md §7.3,
# approved 2026-09-22). The shipped JSON must match this table exactly.
PHASE6_SPEC: dict[str, dict[str, object]] = {
    "a_base_w":    {"x": 90,  "y": 590, "radius": 36, "owner": "player", "units": 20, "maxUnits": 65, "productionRate": 1.2,  "tier": 3, "type": "fortress"},
    "a_base_e":    {"x": 310, "y": 590, "radius": 36, "owner": "player", "units": 20, "maxUnits": 65, "productionRate": 1.2,  "tier": 3, "type": "fortress"},
    "b_base_w":    {"x": 90,  "y": 130, "radius": 36, "owner": "enemy",  "units": 20, "maxUnits": 65, "productionRate": 1.2,  "tier": 3, "type": "fortress"},
    "b_base_e":    {"x": 310, "y": 130, "radius": 36, "owner": "enemy",  "units": 20, "maxUnits": 65, "productionRate": 1.2,  "tier": 3, "type": "fortress"},
    "a_gate_w":    {"x": 115, "y": 470, "radius": 27, "owner": "neutral", "units": 8, "maxUnits": 40, "productionRate": 0.9, "tier": 1, "type": "barracks"},
    "a_gate_e":    {"x": 285, "y": 470, "radius": 27, "owner": "neutral", "units": 8, "maxUnits": 40, "productionRate": 0.9, "tier": 1, "type": "stable"},
    "b_gate_w":    {"x": 285, "y": 250, "radius": 27, "owner": "neutral", "units": 8, "maxUnits": 40, "productionRate": 0.9, "tier": 1, "type": "barracks"},
    "b_gate_e":    {"x": 115, "y": 250, "radius": 27, "owner": "neutral", "units": 8, "maxUnits": 40, "productionRate": 0.9, "tier": 1, "type": "stable"},
    "n_corner_sw": {"x": 60,  "y": 540, "radius": 26, "owner": "neutral", "units": 8, "maxUnits": 40, "productionRate": 0.9, "tier": 1, "type": "stable"},
    "n_corner_se": {"x": 340, "y": 540, "radius": 26, "owner": "neutral", "units": 8, "maxUnits": 40, "productionRate": 0.9, "tier": 1, "type": "barracks"},
    "n_corner_nw": {"x": 60,  "y": 180, "radius": 26, "owner": "neutral", "units": 8, "maxUnits": 40, "productionRate": 0.9, "tier": 1, "type": "barracks"},
    "n_corner_ne": {"x": 340, "y": 180, "radius": 26, "owner": "neutral", "units": 8, "maxUnits": 40, "productionRate": 0.9, "tier": 1, "type": "stable"},
    CENTER_ID:     {"x": 200, "y": 360, "radius": 34, "owner": "neutral", "units": 16, "maxUnits": 55, "productionRate": 1.15, "tier": 2, "type": "fortress"},
}

# The exact approved 20-edge road set (§7.3 "the shipped JSON must contain
# every edge"), pinned as a canonical fingerprint.
PHASE6_ROAD_PAIRS: tuple[tuple[str, str], ...] = (
    ("a_base_w", "a_base_e"),
    ("a_base_w", "a_gate_w"),
    ("a_base_e", "a_gate_e"),
    ("a_gate_w", CENTER_ID),
    ("a_gate_e", CENTER_ID),
    ("a_base_w", "n_corner_sw"),
    ("a_base_e", "n_corner_se"),
    ("n_corner_sw", "a_gate_w"),
    ("n_corner_se", "a_gate_e"),
    ("n_corner_sw", "n_corner_se"),
    ("b_base_w", "b_base_e"),
    ("b_base_e", "b_gate_w"),
    ("b_base_w", "b_gate_e"),
    ("b_gate_w", CENTER_ID),
    ("b_gate_e", CENTER_ID),
    ("b_base_e", "n_corner_ne"),
    ("b_base_w", "n_corner_nw"),
    ("n_corner_ne", "b_gate_w"),
    ("n_corner_nw", "b_gate_e"),
    ("n_corner_ne", "n_corner_nw"),
)

TEAM_A_SPAWN_IDS = ("a_base_w", "a_base_e")
TEAM_B_SPAWN_IDS = ("b_base_w", "b_base_e")
# §7.3 Mirror column: the rotational spawn pairs are west<->east across teams.
SPAWN_PAIRS = (("a_base_w", "b_base_e"), ("a_base_e", "b_base_w"))

EXPECTED_ORDER = list(PHASE6_SPEC.keys())

# Attributes that must be equal across every mirror pair (§7.3 attribute tuple).
MIRROR_ATTRIBUTES = ("radius", "tier", "type", "units", "maxUnits", "productionRate")

# Documented minimum pairwise spacing: sqrt(30^2 + 50^2) ≈ 58.31 px between
# each base and its adjacent corner spur (§7.3: "minimum pairwise territory
# spacing 58.3 px"). Tolerance covers the documented rounding to 58.3.
EXPECTED_MIN_SPACING = 58.3
MIN_SPACING_TOLERANCE = 0.05
# Two radius-26 corner sprites must never overlap their sockets.
MIN_NON_OVERLAP_SPACING = 52.0


def fail(errors: list[str], message: str) -> None:
    errors.append(f"FAIL: {message}")


def rotate(x: float, y: float) -> tuple[float, float]:
    """The 180-degree rotation through (200, 360): (400-x, 720-y)."""
    return CANVAS_WIDTH - x, CANVAS_HEIGHT - y


def road_key(id_a: str, id_b: str) -> str:
    """Canonical undirected road key."""
    return f"{id_a}<->{id_b}" if id_a < id_b else f"{id_b}<->{id_a}"


def verify(battlefields_path: Path) -> tuple[list[str], dict]:
    """Returns (invariant failures, proof summary facts)."""
    errors: list[str] = []
    summary: dict = {}

    # ── Load the shipped JSON directly ──────────────────────────────────────
    try:
        with battlefields_path.open("r", encoding="utf-8") as handle:
            battlefields = json.load(handle)
    except (OSError, json.JSONDecodeError) as error:
        return [f"FAIL: cannot read {battlefields_path}: {error}"], summary

    definitions = {entry.get("id"): entry for entry in battlefields}
    definition = definitions.get(QUAD_CITADEL_ID)
    if definition is None:
        return [f"FAIL: battlefield '{QUAD_CITADEL_ID}' is not present in {battlefields_path}"], summary

    if definition.get("mode") != "2v2":
        fail(errors, f"mode must be \"2v2\", got {definition.get('mode')!r}")

    territories = definition.get("territories", [])
    raw_roads = definition.get("roads", [])
    if len(territories) != EXPECTED_TERRITORY_COUNT:
        fail(errors, f"expected exactly {EXPECTED_TERRITORY_COUNT} territories, got {len(territories)}")
    if len(raw_roads) != EXPECTED_ROAD_COUNT:
        fail(errors, f"expected exactly {EXPECTED_ROAD_COUNT} roads, got {len(raw_roads)}")

    by_id: dict[str, dict] = {}
    for index, territory in enumerate(territories):
        territory_id = territory.get("id")
        if not territory_id:
            fail(errors, f"territory at index {index} has no id")
            continue
        if territory_id in by_id:
            fail(errors, f"duplicate territory id '{territory_id}'")
            continue
        by_id[territory_id] = territory

    # ── Deterministic ordering: frozen, complete, duplicate-free ────────────
    order = [territory.get("id") for territory in territories]
    if order != EXPECTED_ORDER:
        missing = [tid for tid in EXPECTED_ORDER if tid not in order]
        extra = [tid for tid in order if tid not in EXPECTED_ORDER]
        misplaced = [
            (index, tid)
            for index, tid in enumerate(order)
            if tid in EXPECTED_ORDER and EXPECTED_ORDER[index] != tid
        ]
        if missing:
            fail(errors, f"deterministic order is missing territories: {missing}")
        if extra:
            fail(errors, f"deterministic order has unexpected territories: {extra}")
        if misplaced:
            fail(errors, f"deterministic order deviates at (index, id): {misplaced}")

    if len(by_id) != EXPECTED_TERRITORY_COUNT:
        fail(errors, f"expected {EXPECTED_TERRITORY_COUNT} unique territory ids, got {len(by_id)}")

    # ── Exact approved Phase 6 specification pin ────────────────────────────
    # Catches any coordinate/attribute drift, including drifts that stay
    # rotationally symmetric (e.g. a_gate_w x 115->116 with b_gate_w 285->284).
    for territory_id, expected in PHASE6_SPEC.items():
        territory = by_id.get(territory_id)
        if territory is None:
            fail(errors, f"specification pin: territory '{territory_id}' is missing from the shipped JSON")
            continue
        for attribute, expected_value in expected.items():
            actual_value = territory.get(attribute)
            if actual_value != expected_value:
                fail(errors, (
                    f"specification pin: '{territory_id}.{attribute}' is {actual_value!r}, "
                    f"the approved Phase 6 spec requires {expected_value!r}"
                ))
    for territory_id in by_id:
        if territory_id not in PHASE6_SPEC:
            fail(errors, f"specification pin: unexpected territory '{territory_id}' (not in the approved Phase 6 spec)")

    # ── Exact approved road-set fingerprint ──────────────────────────────────
    expected_road_keys = {road_key(a, b) for a, b in PHASE6_ROAD_PAIRS}

    # ── Roads: pre-validate entries cleanly (never crash later passes) ──────
    valid_roads: list[tuple[str, str]] = []
    malformed_road = False
    for index, road in enumerate(raw_roads):
        if (
            not isinstance(road, (list, tuple))
            or len(road) != 2
            or not all(isinstance(endpoint, str) for endpoint in road)
        ):
            fail(errors, f"road at index {index} is malformed (expected a pair of string endpoint ids): {road!r}")
            malformed_road = True
            continue
        valid_roads.append((road[0], road[1]))
    if malformed_road:
        fail(errors, "malformed road entries above were excluded from all further checks")

    # ── Unique rotational counterpart per territory (exactly one) ────────────
    def counterparts(territory: dict) -> list[dict]:
        rot_x, rot_y = rotate(territory["x"], territory["y"])
        return [
            other
            for other in territories
            if abs(other["x"] - rot_x) < 1e-4 and abs(other["y"] - rot_y) < 1e-4
        ]

    mirror: dict[str, str] = {}
    self_mirrored: list[str] = []
    for territory in territories:
        territory_id = territory["id"]
        matches = counterparts(territory)
        if len(matches) == 0:
            rot_x, rot_y = rotate(territory["x"], territory["y"])
            fail(errors, f"territory '{territory_id}' has no rotational counterpart at ({rot_x}, {rot_y})")
            continue
        if len(matches) > 1:
            rot_x, rot_y = rotate(territory["x"], territory["y"])
            duplicates = sorted(match["id"] for match in matches)
            fail(errors, (
                f"territory '{territory_id}' has {len(matches)} territories at its counterpart "
                f"coordinate ({rot_x}, {rot_y}): {duplicates} — exactly one required"
            ))
            continue
        match = matches[0]
        mirror[territory_id] = match["id"]
        if match["id"] == territory_id:
            self_mirrored.append(territory_id)

    if self_mirrored != [CENTER_ID]:
        fail(errors, f"exactly one self-mirrored territory ('{CENTER_ID}') is required, got {self_mirrored}")

    # Involution: mirroring twice returns the original territory.
    for territory_id, mirrored_id in mirror.items():
        if mirror.get(mirrored_id) != territory_id:
            fail(errors, f"mirror map is not an involution: {territory_id} -> {mirrored_id} -> {mirror.get(mirrored_id)}")

    # ── Attribute mirroring (radius, tier, type, units, caps, rates) ─────────
    for territory in territories:
        territory_id = territory["id"]
        match = by_id.get(mirror.get(territory_id, ""))
        if match is None:
            continue  # already reported above
        for attribute in MIRROR_ATTRIBUTES:
            if territory.get(attribute) != match.get(attribute):
                fail(errors, (
                    f"attribute '{attribute}' is not mirror-equal: "
                    f"'{territory_id}' ({territory.get(attribute)}) vs '{match['id']}' ({match.get(attribute)})"
                ))
        owner = territory.get("owner")
        match_owner = match.get("owner")
        # Bidirectional ownership mirroring.
        if owner == "player" and match_owner != "enemy":
            fail(errors, f"Team A spawn '{territory_id}' mirrors non-Team-B territory '{match['id']}' ({match_owner})")
        if owner == "enemy" and match_owner != "player":
            fail(errors, f"Team B spawn '{territory_id}' mirrors non-Team-A territory '{match['id']}' ({match_owner})")
        if owner == "neutral" and match_owner != "neutral":
            fail(errors, f"neutral '{territory_id}' mirrors owned territory '{match['id']}' ({match_owner})")

    # ── Spawn pairs map correctly (Team A <-> Team B) ────────────────────────
    for a_spawn, b_spawn in SPAWN_PAIRS:
        a_territory = by_id.get(a_spawn)
        b_territory = by_id.get(b_spawn)
        if a_territory is None or b_territory is None:
            fail(errors, f"spawn pair broken: '{a_spawn}' or '{b_spawn}' missing")
            continue
        if mirror.get(a_spawn) != b_spawn or mirror.get(b_spawn) != a_spawn:
            fail(errors, f"spawn pair '{a_spawn}' does not map to '{b_spawn}' (mirror: {mirror.get(a_spawn)})")
        if a_territory.get("owner") != "player":
            fail(errors, f"Team A spawn '{a_spawn}' must be player-owned, got {a_territory.get('owner')!r}")
        if b_territory.get("owner") != "enemy":
            fail(errors, f"Team B spawn '{b_spawn}' must be enemy-owned, got {b_territory.get('owner')!r}")
        for spawn_id, spawn in ((a_spawn, a_territory), (b_spawn, b_territory)):
            if spawn.get("tier") != 3 or spawn.get("type") != "fortress":
                fail(errors, f"spawn '{spawn_id}' must be a tier-3 fortress, got tier {spawn.get('tier')} type {spawn.get('type')!r}")

    player_spawns = [tid for tid, t in by_id.items() if t.get("owner") == "player"]
    enemy_spawns = [tid for tid, t in by_id.items() if t.get("owner") == "enemy"]
    if sorted(player_spawns) != sorted(TEAM_A_SPAWN_IDS):
        fail(errors, f"expected exactly two Team A spawns {sorted(TEAM_A_SPAWN_IDS)}, got {sorted(player_spawns)}")
    if sorted(enemy_spawns) != sorted(TEAM_B_SPAWN_IDS):
        fail(errors, f"expected exactly two Team B spawns {sorted(TEAM_B_SPAWN_IDS)}, got {sorted(enemy_spawns)}")

    # ── Roads: endpoints exist, no self/duplicate roads, mirror-closed ───────
    road_keys: set[str] = set()
    for id_a, id_b in valid_roads:
        for endpoint in (id_a, id_b):
            if endpoint not in by_id:
                fail(errors, f"road ['{id_a}', '{id_b}'] endpoint '{endpoint}' does not exist")
        if id_a == id_b:
            fail(errors, f"self-road ['{id_a}', '{id_b}']")
            continue
        key = road_key(id_a, id_b)
        if key in road_keys:
            fail(errors, f"duplicate road ['{id_a}', '{id_b}']")
            continue
        road_keys.add(key)

    # Fingerprint comparison against the approved road set.
    for missing_key in sorted(expected_road_keys - road_keys):
        fail(errors, f"road fingerprint: approved road '{missing_key}' is missing from the shipped JSON")
    for extra_key in sorted(road_keys - expected_road_keys):
        fail(errors, f"road fingerprint: unexpected road '{extra_key}' (not in the approved Phase 6 spec)")

    for id_a, id_b in valid_roads:
        if id_a == id_b:
            continue
        mirror_a = mirror.get(id_a)
        mirror_b = mirror.get(id_b)
        if mirror_a is None or mirror_b is None:
            continue  # already reported as missing counterpart
        original_key = road_key(id_a, id_b)
        mirror_key = road_key(mirror_a, mirror_b)
        if mirror_key == original_key:
            # Mirror-invariant undirected edge (covers rotation swapping the
            # endpoints, e.g. a_base_w—b_base_e rotating onto itself).
            fail(errors, f"road ['{id_a}', '{id_b}'] maps to itself under mirroring (mirror-invariant undirected edge)")
        elif mirror_key not in road_keys:
            fail(errors, f"road ['{id_a}', '{id_b}'] is not mirror-closed: mirror edge '{mirror_key}' is absent")

    # ── Degrees ──────────────────────────────────────────────────────────────
    degree: dict[str, int] = {territory_id: 0 for territory_id in by_id}
    for id_a, id_b in valid_roads:
        if id_a != id_b and id_a in degree and id_b in degree:
            degree[id_a] += 1
            degree[id_b] += 1
    for territory_id, count in sorted(degree.items()):
        expected = 4 if territory_id == CENTER_ID else 3
        if count != expected:
            fail(errors, f"territory '{territory_id}' has degree {count}, expected {expected}")

    # ── Connectivity (BFS over the undirected road graph) ────────────────────
    adjacency: dict[str, list[str]] = {territory_id: [] for territory_id in by_id}
    for id_a, id_b in valid_roads:
        if id_a != id_b and id_a in adjacency and id_b in adjacency:
            adjacency[id_a].append(id_b)
            adjacency[id_b].append(id_a)

    def hops_from(start: str) -> dict[str, int]:
        distances = {start: 0}
        queue = deque([start])
        while queue:
            current = queue.popleft()
            for neighbor in adjacency[current]:
                if neighbor not in distances:
                    distances[neighbor] = distances[current] + 1
                    queue.append(neighbor)
        return distances

    spawn_ids = list(TEAM_A_SPAWN_IDS) + list(TEAM_B_SPAWN_IDS)
    for spawn_id in spawn_ids:
        if spawn_id not in by_id:
            continue
        distances = hops_from(spawn_id)
        unreachable = [tid for tid in by_id if tid not in distances]
        if unreachable:
            fail(errors, f"territories unreachable from spawn '{spawn_id}': {unreachable}")
            continue
        if distances.get(CENTER_ID) != 2:
            fail(errors, f"'{CENTER_ID}' must be exactly 2 hops from '{spawn_id}', got {distances.get(CENTER_ID)}")
        farthest = max(distances.values())
        if farthest != 4:
            fail(errors, f"max distance from spawn '{spawn_id}' must be 4 hops, got {farthest}")

    # ── Minimum pairwise spacing (documented ~58.3 px) ───────────────────────
    territory_list = list(territories)
    min_spacing = math.inf
    limiting_pairs: list[tuple[str, str, float]] = []
    for i in range(len(territory_list)):
        for j in range(i + 1, len(territory_list)):
            first, second = territory_list[i], territory_list[j]
            distance = math.hypot(second["x"] - first["x"], second["y"] - first["y"])
            if distance < min_spacing - MIN_SPACING_TOLERANCE:
                min_spacing = distance
                limiting_pairs = [(first["id"], second["id"], distance)]
            elif abs(distance - min_spacing) <= MIN_SPACING_TOLERANCE:
                limiting_pairs.append((first["id"], second["id"], distance))
                if distance < min_spacing:
                    min_spacing = distance
    summary["min_spacing"] = min_spacing
    summary["limiting_pairs"] = limiting_pairs
    if min_spacing < MIN_NON_OVERLAP_SPACING:
        fail(errors, (
            f"minimum pairwise spacing {min_spacing:.4f}px overlaps radius-26 sockets "
            f"(must be >= {MIN_NON_OVERLAP_SPACING}px)"
        ))
    if abs(min_spacing - EXPECTED_MIN_SPACING) > MIN_SPACING_TOLERANCE:
        fail(errors, (
            f"minimum pairwise spacing is {min_spacing:.4f}px, the approved Phase 6 spec documents "
            f"{EXPECTED_MIN_SPACING}px (tolerance {MIN_SPACING_TOLERANCE})"
        ))

    return errors, summary


def main() -> int:
    battlefields_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_BATTLEFIELDS_PATH
    errors, summary = verify(battlefields_path)

    print("=" * 68)
    print(f" Battlefield symmetry proof: {QUAD_CITADEL_ID} (shipped JSON)")
    print(f" source: {battlefields_path}")
    print("=" * 68)

    if errors:
        print(f"\nPROOF: FAIL ({len(errors)} invariant violation(s))\n")
        for error in errors:
            print(f"  {error}")
        print("\nEvery invariant must hold; fix apps/server-nakama/battlefields.json.")
        return 1

    limiting = ", ".join(f"{a}/{b} ({distance:.4f}px)" for a, b, distance in summary["limiting_pairs"])
    print()
    print("  territories:          13 (exact approved §7.3 spec pin, frozen order, duplicate-free)")
    print("  roads:                20 (exact approved edge fingerprint, unique, undirected, mirror-closed)")
    print("  mirror map:           involution over (400-x, 720-y), exactly one counterpart each")
    print("  self-mirrored:        n_center (the center maps to itself)")
    print("  spawn pairs:          a_base_w<->b_base_e, a_base_e<->b_base_w (bidirectional ownership)")
    print("  spawn attributes:     tier-3 fortresses, 20/65 @ 1.2, r=36")
    print("  neutral mirroring:    types, tiers, units, maxUnits, production, coordinates")
    print("  degrees:              n_center 4, all others 3")
    print("  connectivity:         all reachable; center 2 hops; max 4 hops")
    print(f"  min spacing:          {summary['min_spacing']:.4f}px (documented ~58.3px)")
    print(f"  limiting pair(s):     {limiting}")
    print()
    print("PROOF: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
