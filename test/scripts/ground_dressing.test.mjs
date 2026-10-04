// Exercise the production scatter algorithm without rendering. Only Blender's
// geometry emitters are replaced; RNG, terrain, roads, zones and placement run.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KIT_PATH = path.join(REPO_ROOT, 'art/blender/crown_cross_kit.py');
const ZONES_PATH = path.join(REPO_ROOT, 'art/arena-dressing-zones.json');

const OBSERVE_SCATTER = String.raw`
import importlib.util, json, math, sys, types
from pathlib import Path
sys.dont_write_bytecode = True
sys.modules['bpy'] = types.ModuleType('bpy')
spec = importlib.util.spec_from_file_location('dressing_kit', sys.argv[1])
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)
zones = json.loads(Path(sys.argv[2]).read_text())['battlefields']
spacing = json.loads((Path(sys.argv[2]).parent / 'arena-layout.json').read_text())['verticalSpacing']

def excluded(battlefield_id, x, y):
    lx, ly = x + 200, 398 - y / spacing
    for zone in zones[battlefield_id]:
        if zone['shape'] == 'rectangle':
            if zone['minX'] <= lx <= zone['maxX'] and zone['minY'] <= ly <= zone['maxY']:
                return True
        elif math.hypot(lx - zone['x'], ly - zone['y']) <= zone['radius']:
            return True
    return False

results = {}
for battlefield_id in ('crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'):
    battlefield = kit._battlefield_data(battlefield_id)
    terrain, roads = kit._make_terrain(battlefield, battlefield_id)
    emissions = []
    def record_ico(name, radius, location, material, **kwargs):
        emissions.append((name, location))
    def record_cylinder(name, radius, depth, location, material, *args, **kwargs):
        emissions.append((name, location))
    kit.ico = record_ico
    kit.cyl = record_cylinder
    materials = {name: name for name in ('leaf_tall', 'leaf', 'leaf_dark',
                 'flower_light', 'flower_dark', 'clover', 'stone')}
    kit._ground_scatter(battlefield_id, battlefield, materials, terrain, roads)
    first = list(emissions)
    emissions.clear()
    kit._ground_scatter(battlefield_id, battlefield, materials, terrain, roads)
    results[battlefield_id] = {
        'emitted': len(first),
        'kinds': sorted(set(name for name, location in first)),
        'repeatIdentical': first == emissions,
        'violations': [{'kind': name, 'x': location[0] + 200, 'y': 398 - location[1] / spacing}
                       for name, location in first
                       if excluded(battlefield_id, location[0], location[1])],
    }
print(json.dumps(results))
`;

test('deterministic baked ground scatter keeps every emitted anchor outside reserved art zones', () => {
  const evidence = JSON.parse(execFileSync('python3', ['-c', OBSERVE_SCATTER, KIT_PATH, ZONES_PATH], {
    encoding: 'utf8',
    timeout: 30_000,
  }));
  assert.deepEqual(Object.keys(evidence).sort(), [
    'crown_cross', 'quad_citadel', 'royal_ring', 'twin_passes',
  ]);
  for (const [battlefieldId, observed] of Object.entries(evidence)) {
    assert.ok(observed.emitted > 0, `${battlefieldId} emitted no environment geometry`);
    assert.ok(observed.kinds.includes('ground blade'), `${battlefieldId} did not exercise grass dressing`);
    assert.ok(observed.kinds.includes('roadside pebble'), `${battlefieldId} did not exercise roadside dressing`);
    assert.equal(observed.repeatIdentical, true, `${battlefieldId} scatter changed between identical runs`);
    assert.deepEqual(observed.violations, [], `${battlefieldId} emitted dressing inside a reserved ground feature`);
  }
});
