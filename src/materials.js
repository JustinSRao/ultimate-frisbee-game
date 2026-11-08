// ============================================================================
// TOON MATERIALS — banded cel shading shared by athletes, stands and crowd
// ============================================================================
import * as THREE from 'three';

let ramp = null;
export function toonRamp() {
  if (ramp) return ramp;
  // 4 light bands: core shadow, shadow, lit, highlight
  const d = new Uint8Array([88, 150, 215, 255]);
  ramp = new THREE.DataTexture(d, 4, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.generateMipmaps = false; ramp.needsUpdate = true;
  return ramp;
}
export function toon(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...opts });
}
