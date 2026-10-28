import { describe, expect, it } from 'vitest';
import { listRuntimeSpritePaths, getArenaGroundSprite } from '../BattlefieldArt.js';
import { hasHdArt, hdArtSize, resolveArtPath } from '../hdArt.js';

describe('resolveArtPath', () => {
  it('returns the shipped path on the SD tier, even for files that have an HD twin', () => {
    expect(resolveArtPath('assets/units/unit_follower_player_front.png', 'sd')).toBe('assets/units/unit_follower_player_front.png');
  });

  it('mirrors an exported file under assets/hd on the HD tier', () => {
    expect(resolveArtPath('assets/units/unit_follower_player_front.png', 'hd')).toBe('assets/hd/units/unit_follower_player_front.png');
    expect(hdArtSize('assets/units/unit_follower_player_front.png')).toEqual({ width: 256, height: 256 });
  });

  it('falls back to the SD path when no HD file was exported (never a 404)', () => {
    expect(resolveArtPath('assets/territories/outpost_player.png', 'hd')).toBe('assets/territories/outpost_player.png');
    expect(hasHdArt('assets/does/not/exist.webp')).toBe(false);
  });

  it('has an HD twin for every dedicated-pack sprite, prop and ground plate the loader can request', () => {
    for (const battlefield of ['crown_cross', 'twin_passes', 'royal_ring', 'quad_citadel'] as const) {
      for (const path of Object.values(listRuntimeSpritePaths(battlefield))) {
        if (path.startsWith('assets/territories/') && /\/territories\/[a-z_]+\.png$/.test(path)) continue; // generic PNG fallback stays SD
        expect(hasHdArt(path), `${battlefield}: ${path}`).toBe(true);
      }
      const ground = getArenaGroundSprite(battlefield);
      expect(ground && hasHdArt(ground.path), `ground ${battlefield}`).toBe(true);
    }
  });

  it('keeps every HD file larger than its SD size, so the tier is a real upgrade', () => {
    for (const path of ['assets/territories/crown_cross/barracks_player.webp', 'assets/environment/tree_apple.webp', 'assets/grounds/ground_crown_cross.webp']) {
      const size = hdArtSize(path);
      expect(size, path).toBeDefined();
      expect(size!.width).toBeGreaterThan(path.includes('ground') ? 760 : 128);
    }
  });
});
