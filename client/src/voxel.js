// ============================================================================
// VOXEL ENGINE — build micro-voxel models from solid-shape functions,
// paint every voxel, then mesh only visible faces with baked ambient occlusion.
// ============================================================================
import * as THREE from 'three';

const toLin = (c) => Math.pow(c / 255, 2.2);

// Canvas sampler: (u, v) in [0,1] (v = 0 top) -> [r,g,b] 0..255
export function sampler(canvasOrTex) {
  const c = canvasOrTex.image || canvasOrTex;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
  return (u, v) => {
    u = u - Math.floor(u); v = Math.min(0.9999, Math.max(0, v));
    const x = Math.min(W - 1, Math.floor(u * W)), y = Math.floor(v * H), k = (y * W + x) * 4;
    return [d[k], d[k + 1], d[k + 2]];
  };
}
export const hex3 = (h) => { if (typeof h === 'string') h = parseInt(h.replace('#', ''), 16); return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; };
export const mul3 = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

// Face table: normal, 4 corners (unit cube 0..1)
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

// voxelize(bounds [x0,y0,z0,x1,y1,z1], size, fn(x,y,z) -> [r,g,b] | null, opts)
export function voxelize(b, s, fn, opts = {}) {
  const nx = Math.max(1, Math.ceil((b[3] - b[0]) / s)), ny = Math.max(1, Math.ceil((b[4] - b[1]) / s)), nz = Math.max(1, Math.ceil((b[5] - b[2]) / s));
  const ox = b[0], oy = b[1], oz = b[2];
  const N = nx * ny * nz;
  const solid = new Uint8Array(N), col = new Float32Array(N * 3);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  const noise = opts.noise ?? 0.06;
  let seed = opts.seed || 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = ox + (i + 0.5) * s, y = oy + (j + 0.5) * s, z = oz + (k + 0.5) * s;
    const c = fn(x, y, z);
    if (!c) continue;
    const id = idx(i, j, k); solid[id] = 1;
    const n = 1 + (rnd() - 0.5) * 2 * noise;
    col[id * 3] = toLin(Math.min(255, c[0] * n)); col[id * 3 + 1] = toLin(Math.min(255, c[1] * n)); col[id * 3 + 2] = toLin(Math.min(255, c[2] * n));
  }
  const filled = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && solid[idx(i, j, k)] === 1;
  const pos = [], nor = [], cols = [], ind = [];
  let vc = 0;
  const ao = opts.ao ?? 1;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = idx(i, j, k); if (!solid[id]) continue;
    const r = col[id * 3], g = col[id * 3 + 1], bb = col[id * 3 + 2];
    for (const f of FACES) {
      const [fx, fy, fz] = f.n;
      if (filled(i + fx, j + fy, k + fz)) continue;
      const aos = [];
      for (const cc of f.c) {
        // corner AO from the three neighbours on the outside of this face
        const dx = cc[0] * 2 - 1, dy = cc[1] * 2 - 1, dz = cc[2] * 2 - 1;
        const a1 = fx ? [fx, dy, 0] : fy ? [dx, fy, 0] : [dx, 0, fz];
        const a2 = fx ? [fx, 0, dz] : fy ? [0, fy, dz] : [0, dy, fz];
        const a3 = fx ? [fx, dy, dz] : fy ? [dx, fy, dz] : [dx, dy, fz];
        const s1 = filled(i + a1[0], j + a1[1], k + a1[2]) ? 1 : 0, s2 = filled(i + a2[0], j + a2[1], k + a2[2]) ? 1 : 0, s3 = filled(i + a3[0], j + a3[1], k + a3[2]) ? 1 : 0;
        const occ = s1 && s2 ? 3 : s1 + s2 + s3;
        aos.push(1 - occ * 0.13 * ao);
        pos.push(ox + (i + cc[0]) * s, oy + (j + cc[1]) * s, oz + (k + cc[2]) * s);
        nor.push(fx, fy, fz);
      }
      for (const a of aos) cols.push(r * a, g * a, bb * a);
      // flip quad diagonal for smoother AO
      if (aos[0] + aos[2] < aos[1] + aos[3]) ind.push(vc + 1, vc + 2, vc + 3, vc + 1, vc + 3, vc);
      else ind.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      vc += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(ind, 1) : new THREE.Uint16BufferAttribute(ind, 1));
  geo.computeBoundingSphere();
  return geo;
}

// ---- solid-shape helpers (signed tests) ----
export const ellipsoid = (x, y, z, cx, cy, cz, rx, ry, rz) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1;
export const sphere = (x, y, z, cx, cy, cz, r) => (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r * r;
// rounded box: half sizes hx,hy,hz with corner radius r
export function rbox(x, y, z, cx, cy, cz, hx, hy, hz, r) {
  const qx = Math.max(Math.abs(x - cx) - hx + r, 0), qy = Math.max(Math.abs(y - cy) - hy + r, 0), qz = Math.max(Math.abs(z - cz) - hz + r, 0);
  return qx * qx + qy * qy + qz * qz <= r * r && Math.abs(x - cx) <= hx && Math.abs(y - cy) <= hy && Math.abs(z - cz) <= hz;
}
// limb along -y from y0 (top) to y1 (bottom) with radius profile fn(t 0..1) and optional z squash
export function limbTest(x, y, z, y0, y1, prof, sz = 1) {
  if (y > y0 || y < y1) return false;
  const t = (y0 - y) / (y0 - y1);
  const r = prof(t);
  return x * x + (z / sz) * (z / sz) <= r * r;
}
export const lerpProf = (pts) => (t) => {
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; const k = (t - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * k; }
  return pts[pts.length - 1][1];
};
