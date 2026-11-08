// ============================================================================
// STADIUM — bowl stands, instanced crowd, boards, banners, lights, skyline, sky
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as T from './textures.js';
import { mulberry } from '../../shared/config.js';
import { toon } from './materials.js';
import { voxelize } from './voxel.js';

// stands are lower behind the end zones (horseshoe-like) so the skyline shows over the ends
export function standScale(p) { const e = Math.max(0, Math.min(1, (Math.abs(p.nz) - 0.55) / 0.4)); return 1 - 0.6 * e * e * (3 - 2 * e); }

const BOWL = { hx: 44, hz: 70, R: 18 };

// Evenly spaced samples along a rounded rectangle; returns {x,z,nx,nz,s}
function roundedRect(hx, hz, R, step) {
  const sx = hx - R, sz = hz - R;
  const segs = [];
  // order: +x side (z from -sz to sz), corner (+x,+z), +z side (x sz..-sx), corner (-x,+z), -x side, corner(-x,-z), -z side, corner(+x,-z)
  const L1 = 2 * sz, L2 = 2 * sx, A = Math.PI / 2 * R;
  const total = 2 * L1 + 2 * L2 + 4 * A;
  const n = Math.round(total / step);
  const pts = [];
  for (let i = 0; i < n; i++) {
    let d = i / n * total;
    let x, z, nx, nz;
    const corner = (cx, cz, a0, t) => { const a = a0 + t / R; nx = Math.cos(a); nz = Math.sin(a); x = cx + nx * R; z = cz + nz * R; };
    if (d < L1) { x = hx; z = -sz + d; nx = 1; nz = 0; }
    else if ((d -= L1) < A) corner(sx, sz, 0, d);
    else if ((d -= A) < L2) { z = hz; x = sx - d; nx = 0; nz = 1; }
    else if ((d -= L2) < A) corner(-sx, sz, Math.PI / 2, d);
    else if ((d -= A) < L1) { x = -hx; z = sz - d; nx = -1; nz = 0; }
    else if ((d -= L1) < A) corner(-sx, -sz, Math.PI, d);
    else if ((d -= A) < L2) { z = -hz; x = -sx + d; nx = 0; nz = -1; }
    else { d -= L2; corner(sx, -sz, Math.PI * 1.5, d); }
    pts.push({ x, z, nx, nz, s: i / n * total });
  }
  pts.total = total;
  return pts;
}

class StripBuilder {
  constructor() { this.pos = []; this.col = []; this.uv = []; this.idx = []; }
  // quad strip around loop between (o1,h1) and (o2,h2); color fn(i)->[r,g,b]
  ring(path, o1, h1, o2, h2, colorFn, uvScale = 0, v0 = 0, v1 = 1) {
    const n = path.length;
    const base = this.pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const p = path[i % n];
      const c = colorFn(i % n, p);
      const m = this.scaled ? standScale(p) : 1;
      this.pos.push(p.x + p.nx * o1, h1 * m, p.z + p.nz * o1, p.x + p.nx * o2, h2 * m, p.z + p.nz * o2);
      this.col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      const s = (i === n ? path.total : p.s) * uvScale;
      this.uv.push(s, v0, s, v1);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      this.idx.push(a, c, b, b, c, d);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// Spectator geometry with per-vertex part attributes (aPart: 1 = skin, aArm: 1 = arm)
function spectatorGeom(detailed) {
  const parts = [];
  const add = (w, h, d, x, y, z, part, arm) => {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
    g.setAttribute('aArm', new THREE.Float32BufferAttribute(new Float32Array(n).fill(arm), 1));
    parts.push(g);
  };
  add(0.44, 0.5, 0.3, 0, 0.55, 0, 0, 0);        // torso
  add(0.26, 0.26, 0.26, 0, 0.97, 0, 1, 0);      // head
  add(0.28, 0.09, 0.28, 0, 1.12, -0.01, 2, 0);  // hair
  if (detailed) {
    add(0.12, 0.42, 0.14, -0.29, 0.62, 0.02, 0, 1); // arms
    add(0.12, 0.42, 0.14, 0.29, 0.62, 0.02, 0, 1);
    add(0.38, 0.14, 0.42, 0, 0.28, 0.14, 0, 0);   // lap
  }
  const g = mergeGeometries(parts);
  g.deleteAttribute('uv');
  return g;
}

function crowdMaterial(uniforms) {
  const m = toon(0xffffff);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uExcite = uniforms.uExcite; sh.uniforms.uWave = uniforms.uWave;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPart; attribute float aArm; uniform float uTime; uniform float uExcite; uniform float uWave;
        float crowdPh(){ vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]); return fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = crowdPh();
        float bob = sin(uTime * (3.0 + ph * 3.0) + ph * 6.283) * 0.5 + 0.5;
        float ang = atan(ip.x, ip.z);
        float wave = smoothstep(0.75, 1.0, sin(ang * 1.0 - uTime * 1.6) ) * uWave;
        float actv = step(ph, 0.12 + uExcite * 0.85);
        float stand = max(wave, actv * uExcite);
        transformed.y += stand * 0.25 + bob * (0.02 + actv * uExcite * 0.16);
        float armUp = aArm * clamp(stand * 1.4 + step(0.97, ph) * 0.8, 0.0, 1.0);
        transformed.y += armUp * (0.42 + bob * 0.12);
      `)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vec3 skinA = vec3(0.93, 0.74, 0.58); vec3 skinB = vec3(0.36, 0.22, 0.13);
        float cph = crowdPh();
        vec3 skin = mix(skinA, skinB, fract(cph * 17.3));
        vec3 hairC = mix(vec3(0.08, 0.05, 0.03), vec3(0.55, 0.35, 0.15), step(0.75, fract(cph * 5.1)));
        vColor = mix(vColor, skin, step(0.5, aPart) * step(aPart, 1.5));
        vColor = mix(vColor, hairC, step(1.5, aPart));`);
  };
  return m;
}

export class Stadium {
  constructor(scene, quality) {
    this.scene = scene; this.quality = quality;
    this.group = new THREE.Group(); scene.add(this.group);
    this.uniforms = { uTime: { value: 0 }, uExcite: { value: 0.1 }, uWave: { value: 0 } };
    this.excite = 0.1; this.exciteTarget = 0.1; this.waveT = 0;
    this.buildSky();
    this.buildFloor();
    this.buildGrass();
    this.buildBowl();
    this.buildBoards();
    this.buildLights();
    this.buildSkyline();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1800, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x2b74e8) }, hor: { value: new THREE.Color(0x9fd2ff) }, dark: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform float dark; varying vec3 vP;
        void main(){ float h = clamp(vP.y*1.6, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.7));
        c = mix(c, vec3(0.42,0.47,0.55)*mix(1.0,0.75,h), dark); gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(geo, this.skyMat); sky.renderOrder = -10; sky.frustumCulled = false;
    this.group.add(sky); this.sky = sky;
    // pixel clouds
    this.clouds = new THREE.Group();
    const rng = mulberry(77);
    const ctex = [T.cloudTexture(1), T.cloudTexture(2), T.cloudTexture(3)];
    for (let i = 0; i < 44; i++) {
      const m = new THREE.MeshBasicMaterial({ map: ctex[i % 3], transparent: true, alphaTest: 0.5, fog: false, depthWrite: false });
      const s = 260 + rng() * 320;
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(s, s / 2), m);
      const a = rng() * Math.PI * 2, r = 1100 + rng() * 300;
      pl.position.set(Math.sin(a) * r, 60 + rng() * (i < 30 ? 160 : 420), Math.cos(a) * r);
      pl.lookAt(0, pl.position.y * 0.6, 0);
      this.clouds.add(pl);
    }
    this.cloudMats = this.clouds.children.map(c => c.material);
    this.group.add(this.clouds);
  }

  buildFloor() {
    this.floorMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(T.FLOOR.FX * 2, T.FLOOR.FZ * 2), this.floorMat);
    f.rotation.x = -Math.PI / 2; f.receiveShadow = true;
    this.group.add(f); this.floor = f;
    // outer ground (beyond bowl)
    const og = new THREE.Mesh(new THREE.CircleGeometry(1500, 24), new THREE.MeshLambertMaterial({ color: 0x6f8a63 }));
    og.rotation.x = -Math.PI / 2; og.position.y = -0.05; this.group.add(og);
    // end-zone cones
    this.cones = new THREE.Group(); this.group.add(this.cones);
  }

  // micro-voxel grass tufts that wrap around the camera and take their colour from the turf (lines included)
  buildGrass() {
    const count = 0; // voxel grass retired: the coarse pixel pass gives the turf its texture
    if (!count) return;
    const V = 0.026;
    const tuft = voxelize([-0.04, 0, -0.04, 0.04, 0.12, 0.04], V, (x, y, z) => {
      const cx = Math.round(x / V), cz = Math.round(z / V);
      const hgt = { '0,0': 4, '1,0': 2, '-1,0': 3, '0,1': 2, '0,-1': 3, '1,1': 1, '-1,-1': 2 }[cx + ',' + cz] || 0;
      const lvl = Math.floor(y / V);
      if (lvl >= hgt) return null;
      const k = 120 + lvl * 38; return [k, k, k];
    }, { noise: 0.08, ao: 0.45 });
    const A = 36;
    const im = new THREE.InstancedMesh(tuft, new THREE.MeshLambertMaterial({ vertexColors: true }), count);
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    let seed = 99; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < count; i++) {
      e.set(0, Math.floor(r() * 4) * Math.PI / 2, 0); qt.setFromEuler(e);
      const k = 0.7 + r() * 0.7; sc.set(1, k, 1); ps.set((r() - 0.5) * A, 0, (r() - 0.5) * A);
      m4.compose(ps, qt, sc); im.setMatrixAt(i, m4);
    }
    const u = this.grassU = { uCam: { value: new THREE.Vector3() }, uTurf: { value: null }, uFloor: { value: new THREE.Vector2(T.FLOOR.FX, T.FLOOR.FZ) } };
    im.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uCam; uniform sampler2D uTurf; uniform vec2 uFloor;
          vec2 grassWP(){ vec2 p = vec2(instanceMatrix[3][0], instanceMatrix[3][2]); return mod(p - uCam.xz + ${A / 2}.0, ${A}.0) - ${A / 2}.0 + uCam.xz; }`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          vec2 wp = grassWP();
          float fade = 1.0 - smoothstep(10.0, 17.0, length(wp - uCam.xz));
          transformed *= vec3(1.0, fade, 1.0);
          transformed.xz += wp - ip.xz;`)
        .replace('#include <color_vertex>', `#include <color_vertex>
          vec2 gw = grassWP();
          vec2 tuv = vec2((gw.x + uFloor.x) / (2.0 * uFloor.x), 1.0 - (gw.y + uFloor.y) / (2.0 * uFloor.y));
          vColor.rgb *= texture2D(uTurf, tuv).rgb * 1.75;`);
    };
    im.frustumCulled = false; im.receiveShadow = true;
    this.group.add(im); this.grass = im;
  }

  setField(field, rain) {
    if (this.floorMat.map) this.floorMat.map.dispose();
    this.floorMat.map = T.turfTexture(field, rain); this.floorMat.needsUpdate = true;
    if (this.grassU) this.grassU.uTurf.value = this.floorMat.map;
    this.field = field; this.rainTurf = rain;
    this.cones.clear();
    const coneG = new THREE.ConeGeometry(0.18, 0.45, 6); coneG.translate(0, 0.22, 0);
    const coneM = new THREE.MeshLambertMaterial({ color: 0xff7a1a, flatShading: true });
    const hl = field.L / 2, gl = hl - field.E, hw = field.W / 2;
    for (const z of [-hl, -gl, gl, hl]) for (const x of [-hw, hw]) {
      const c = new THREE.Mesh(coneG, coneM); c.position.set(x, 0, z); c.castShadow = true; this.cones.add(c);
    }
  }

  buildBowl() {
    const q = this.quality;
    const path = roundedRect(BOWL.hx, BOWL.hz, BOWL.R, 1.25);
    this.path = path;
    const sb = new StripBuilder(); sb.scaled = true;
    const total = path.total;
    const seatCol = (tier) => (i, p) => {
      const sec = Math.floor(p.s / 14) % 6;
      const pal = tier === 1 ? [[0.07, 0.1, 0.26], [0.06, 0.09, 0.22], [0.3, 0.07, 0.08], [0.07, 0.1, 0.26], [0.06, 0.09, 0.22], [0.09, 0.12, 0.3]]
        : [[0.06, 0.09, 0.22], [0.28, 0.06, 0.07], [0.06, 0.09, 0.22], [0.08, 0.11, 0.28], [0.26, 0.06, 0.07], [0.06, 0.09, 0.22]];
      return pal[sec];
    };
    const concrete = () => [0.55, 0.57, 0.62];
    const dark = () => [0.12, 0.14, 0.2];
    this.tiers = [
      { o0: 2.0, h0: 1.6, rows: 16, depth: 0.85, rise: 0.36, tier: 1 },
      { o0: 17.2, h0: 9.6, rows: 18, depth: 0.85, rise: 0.42, tier: 2 },
      { o0: 34.0, h0: 19.8, rows: 13, depth: 0.95, rise: 0.5, tier: 3 },
    ];
    // base wall behind the sideline boards
    sb.ring(path, 0.6, 0, 0.6, 1.6, dark);
    sb.ring(path, 0.6, 1.6, 2.0, 1.6, concrete);
    for (const t of this.tiers) {
      for (let r = 0; r < t.rows; r++) {
        const o = t.o0 + r * t.depth, h = t.h0 + r * t.rise;
        sb.ring(path, o, h, o + t.depth, h, seatCol(t.tier));
        sb.ring(path, o + t.depth, h, o + t.depth, h + t.rise, (i, p) => seatCol(t.tier)(i, p).map(v => v * 0.6));
      }
      // white front railing of each tier
      sb.ring(path, t.o0 - 0.08, t.h0 + 0.05, t.o0 - 0.08, t.h0 + 0.32, () => [0.92, 0.94, 0.98]);
      t.oEnd = t.o0 + t.rows * t.depth; t.hEnd = t.h0 + t.rows * t.rise;
    }
    // fascias between tiers
    const t1 = this.tiers[0], t2 = this.tiers[1], t3 = this.tiers[2];
    sb.ring(path, t1.oEnd, t1.hEnd, t2.o0 - 0.4, t1.hEnd, concrete);
    sb.ring(path, t2.o0 - 0.4, t1.hEnd, t2.o0 - 0.4, t2.h0, dark); // ribbon goes here
    sb.ring(path, t2.o0 - 0.4, t2.h0, t2.o0, t2.h0, concrete);
    sb.ring(path, t2.oEnd, t2.hEnd, t3.o0 - 0.4, t2.hEnd, concrete);
    sb.ring(path, t3.o0 - 0.4, t2.hEnd, t3.o0 - 0.4, t3.h0, dark);
    sb.ring(path, t3.o0 - 0.4, t3.h0, t3.o0, t3.h0, concrete);
    // rim + back wall
    sb.ring(path, t3.oEnd, t3.hEnd, t3.oEnd, t3.hEnd + 3.2, () => [0.16, 0.2, 0.32]);
    sb.ring(path, t3.oEnd, t3.hEnd + 3.2, t3.oEnd + 1.5, t3.hEnd + 3.2, () => [0.75, 0.78, 0.84]);
    sb.ring(path, t3.oEnd + 1.5, t3.hEnd + 3.2, t3.oEnd + 1.5, 0, () => [0.42, 0.46, 0.55]);
    const geo = sb.build();
    const mat = toon(0xffffff, { vertexColors: true });
    const stands = new THREE.Mesh(geo, mat); stands.matrixAutoUpdate = false;
    this.group.add(stands);

    // LED ribbons on fascias (textured strips)
    const ribbonTex1 = T.ledRibbon(['WUL', 'UNITY', '*', 'RESPECT', '*', 'FLOW', '*', 'A BRIGHTER PLANET', '*', 'SPIRIT', '*']);
    const ribbonTex2 = T.ledRibbon(['WORLD ULTIMATE LEAGUE', '*', 'CHAMPIONSHIP', '*', 'RIVERTON', '*', 'SPIRIT OF THE GAME', '*'], '#7a0f14', '#ffe9e0', '#ffd34d');
    const mkRibbon = (o, h0, h1, tx, rep) => {
      const b = new StripBuilder(); b.scaled = true; b.ring(path, o - 0.02, h0, o - 0.02, h1, () => [1, 1, 1], 1 / rep, 0, 1);
      const m = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ map: tx, vertexColors: false }));
      tx.wrapS = THREE.RepeatWrapping; this.group.add(m); return m;
    };
    this.boards = mkRibbon(0.6, 0.1, 1.5, ribbonTex1, 36);
    this.ribbon2 = mkRibbon(t2.o0 - 0.4, t1.hEnd + 0.3, t2.h0 - 0.2, ribbonTex2.clone(), 46);
    this.ribbon2.material.map.needsUpdate = true;
    const suite = T.suiteTexture(); suite.wrapS = THREE.RepeatWrapping;
    this.suites = mkRibbon(t3.o0 - 0.4, t2.hEnd + 0.2, t3.h0 - 0.2, suite, 18);
    this.ribbonTexs = [ribbonTex1, this.ribbon2.material.map];

    // ---------------- crowd ----------------
    const spacing = q === 'high' ? 0.54 : q === 'medium' ? 0.58 : 0.7;
    const rowStep = 1;
    // sprite crowd: one instanced quad per spectator, pixel-art atlas
    const rng = mulberry(4242);
    const list = [];
    for (const t of this.tiers) {
      for (let r = 0; r < t.rows; r += rowStep) {
        const o = t.o0 + r * t.depth + t.depth * 0.45, h0r = t.h0 + r * t.rise;
        const ringPath = roundedRect(BOWL.hx + o, BOWL.hz + o, BOWL.R + o, spacing);
        for (const p of ringPath) {
          if ((p.s % 16) < 1.0) continue;      // aisles
          if (rng() < 0.012) continue;          // the odd empty seat
          list.push([p.x, h0r * standScale(p), p.z, Math.atan2(-p.nx, -p.nz)]);
        }
      }
    }
    const atlas = T.crowdAtlas();
    const qg = new THREE.PlaneGeometry(0.62, 0.93); qg.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(qg, new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas }, uTime: this.uniforms.uTime, uExcite: this.uniforms.uExcite, uWave: this.uniforms.uWave,
        fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, uLight: { value: 1 } },
      fog: true, transparent: false, side: THREE.DoubleSide,
      vertexShader: `
        attribute vec2 aSpr; varying vec2 vUv; varying float vShade;
        uniform float uTime; uniform float uExcite; uniform float uWave;
        #include <fog_pars_vertex>
        void main(){
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = aSpr.y;
          float bob = sin(uTime * (3.0 + ph * 3.0) + ph * 6.283) * 0.5 + 0.5;
          float ang = atan(ip.x, ip.z);
          float wave = smoothstep(0.8, 1.0, sin(ang - uTime * 1.6)) * uWave;
          float actv = step(ph, 0.1 + uExcite * 0.85);
          float up = max(wave, actv * uExcite);
          up = max(up, step(0.985, fract(ph * 7.0 + floor(uTime * 0.25))));
          float frame = step(0.5, up);
          vec3 p = position; p.y += up * 0.12 + bob * (0.015 + actv * uExcite * 0.12);
          float idx = aSpr.x;
          float col = mod(idx, 16.0), row = floor(idx / 16.0) + frame * 8.0;
          vUv = vec2((col + uv.x) / 16.0, 1.0 - (row + 1.0 - uv.y) / 16.0);
          vShade = 0.82 + 0.18 * fract(ph * 13.1);
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform float uLight; varying vec2 vUv; varying float vShade;
        #include <fog_pars_fragment>
        void main(){
          vec4 c = texture2D(map, vUv);
          if (c.a < 0.5) discard;
          gl_FragColor = vec4(c.rgb * vShade * uLight, 1.0);
          #include <fog_fragment>
        }`,
    }), list.length);
    const spr = new Float32Array(list.length * 2);
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    list.forEach((l, i) => {
      e.set(-0.12, l[3], 0); qt.setFromEuler(e);
      const k = 0.94 + rng() * 0.12; sc.set(k, k, k); ps.set(l[0], l[1], l[2]);
      m4.compose(ps, qt, sc); im.setMatrixAt(i, m4);
      // home-side bias: Skyline blues on one side, Blaze reds on the other
      let v = Math.floor(rng() * 128);
      spr[i * 2] = v; spr[i * 2 + 1] = rng();
    });
    qg.setAttribute('aSpr', new THREE.InstancedBufferAttribute(spr, 2));
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false;
    this.group.add(im); this.crowd = im; this.crowdMat = im.material;
    this.crowdCount = list.length;

    // ---------------- banners on upper fascia ----------------
    const banners = [
      T.bannerTexture(['GOOD', 'PLAYERS', 'BETTER', 'PEOPLE'], { w: 128, h: 200, figure: true }),
      T.bannerTexture([''], { w: 96, h: 160, logo: true, bg: '#0f2668', edge: '#e8eeff' }),
      T.bannerTexture(['MORE', 'THAN', 'A GAME'], { w: 96, h: 170, bg: '#132a6e', edge: '#d3262c' }),
      T.bannerTexture(['PLAY', 'PEOPLE', 'A BRIGHTER', 'PLANET'], { w: 128, h: 200, bg: '#16328a', edge: '#ffd34d' }),
      T.bannerTexture(['SPIRIT', 'OF THE', 'GAME'], { w: 96, h: 170, bg: '#7a0f14', edge: '#ffffff' }),
    ];
    const bAt = (side, z, ti, w, h) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: banners[ti], side: THREE.DoubleSide }));
      const x = side * (BOWL.hx + t3.o0 - 0.8);
      m.position.set(x, t3.h0 - h / 2 + 3.5, z);
      m.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.group.add(m);
    };
    bAt(-1, 30, 0, 14, 22); bAt(-1, 8, 1, 9, 15); bAt(-1, -10, 2, 9, 16); bAt(-1, -32, 4, 9, 16);
    bAt(1, -30, 0, 14, 22); bAt(1, -8, 3, 13, 20); bAt(1, 14, 1, 9, 15); bAt(1, 34, 2, 9, 16);

    // flags along the rim
    const flagCols = [['#d3262c', '#ffd34d'], ['#1f56d6', '#fff'], ['#0f0f12', '#d3262c'], ['#3fa34d', '#fff'], ['#ff7a1a', '#1f56d6'], ['#fff', '#d3262c']];
    const ft = flagCols.map(c => T.flagTexture(c));
    this.flags = [];
    const rimPath = roundedRect(BOWL.hx + t3.oEnd + 0.7, BOWL.hz + t3.oEnd + 0.7, BOWL.R + t3.oEnd + 0.7, 9);
    const poleG = new THREE.CylinderGeometry(0.08, 0.08, 6, 4); poleG.translate(0, 3, 0);
    const poleM = new THREE.MeshLambertMaterial({ color: 0xcfd6e0 });
    rimPath.forEach((p, i) => {
      const base = (t3.hEnd + 3.2) * standScale(p);
      const pole = new THREE.Mesh(poleG, poleM); pole.position.set(p.x, base, p.z); this.group.add(pole);
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.9, 4, 1), new THREE.MeshLambertMaterial({ map: ft[i % ft.length], side: THREE.DoubleSide }));
      fl.geometry.translate(1.5, 0, 0);
      fl.position.set(p.x, base + 5, p.z); fl.rotation.y = rng() * Math.PI * 2;
      this.group.add(fl); this.flags.push(fl);
    });
  }

  buildBoards() {
    // Giant video boards at both ends
    const t3 = this.tiers[2];
    this.vbCanvas = T.videoBoardCanvas();
    T.drawVideoBoard(this.vbCanvas, { mode: 'logo' });
    this.vbTex = T.tex(this.vbCanvas);
    this.vbCanvas2 = T.videoBoardCanvas();
    T.drawVideoBoard(this.vbCanvas2, { mode: 'score', left: 'SKYLINE', right: 'BLAZE', a: 0, b: 0 });
    this.vbTex2 = T.tex(this.vbCanvas2);
    const frameM = toon(0x1b2233), towerM = toon(0x3a465e);
    const winTex = T.windowsTexture(17, '#2a3550'); winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping; winTex.repeat.set(4, 4);
    const towerSide = toon(0xffffff, { map: winTex });
    // Corner towers carrying giant video boards (one behind each end, on opposite corners)
    const mk = (sx, sz, texx) => {
      const g = new THREE.Group();
      const W = 46, H = 21;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(W + 6, 30, 16), [towerSide, towerSide, towerM, towerM, towerSide, towerSide]);
      tower.position.set(0, -2, -9); g.add(tower);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(W + 8, 1.6, 18), toon(0xc9d2e0)); cap.position.set(0, 13.5 + H / 2 + 2.5, -8); g.add(cap);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(W + 3, H + 3, 1.5), frameM); frame.position.y = 13.5; g.add(frame);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(W + 2.4, H + 2.4), new THREE.MeshBasicMaterial({ color: 0xff3b30, fog: false }));
      glow.position.set(0, 13.5, 0.78); g.add(glow);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: texx, fog: false }));
      scr.position.set(0, 13.5, 0.85); g.add(scr);
      // corner LED dots
      for (const cx of [-1, 1]) for (const cy of [-1, 1]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ color: 0xffd0c8, fog: false })); d.position.set(cx * (W / 2 + 0.6), 13.5 + cy * (H / 2 + 0.6), 0.9); g.add(d); }
      const x = sx * (BOWL.hx + 22), z = sz * (BOWL.hz + 36);
      g.position.set(x, 13, z);
      g.lookAt(0, 13, 0);
      this.group.add(g);
    };
    mk(-1, 1, this.vbTex);
    mk(1, -1, this.vbTex2);
  }

  setScoreboard(left, right, a, b, banner) {
    T.drawVideoBoard(this.vbCanvas2, { mode: 'score', left, right, a, b, banner });
    this.vbTex2.needsUpdate = true;
  }

  buildLights() {
    // floodlight towers at four corners + light banks along rim
    const t3 = this.tiers[2];
    const lampC = T.canvas(32, 16), g = lampC.getContext('2d');
    g.fillStyle = '#2a3140'; g.fillRect(0, 0, 32, 16);
    for (let y = 1; y < 16; y += 5) for (let x = 1; x < 32; x += 5) { g.fillStyle = '#fffbe8'; g.fillRect(x, y, 4, 4); }
    const lampTex = T.tex(lampC, { mip: false });
    const headM = new THREE.MeshBasicMaterial({ map: lampTex, fog: false });
    const gc = T.canvas(64, 64), gg = gc.getContext('2d'); const rg = gg.createRadialGradient(32, 32, 2, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,250,230,1)'); rg.addColorStop(0.25, 'rgba(255,240,200,0.55)'); rg.addColorStop(1, 'rgba(255,230,180,0)');
    gg.fillStyle = rg; gg.fillRect(0, 0, 64, 64);
    const glowMat = new THREE.SpriteMaterial({ map: T.tex(gc, { linear: true }), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true });
    const glow = (pos, s) => { const sp = new THREE.Sprite(glowMat); sp.position.copy(pos); sp.scale.set(s, s, 1); this.group.add(sp); };
    const steel = new THREE.MeshLambertMaterial({ color: 0x8e98a8 });
    const o = t3.oEnd + 4;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * (BOWL.hx - BOWL.R + (BOWL.R + o) * 0.7071), z = sz * (BOWL.hz - BOWL.R + (BOWL.R + o) * 0.7071);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(1.6, 70, 1.6), steel); pole.position.set(x, 35, z); this.group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 1), [steel, steel, steel, steel, headM, steel]);
      head.position.set(x, 72, z); head.lookAt(0, 0, 0); this.group.add(head);
      glow(head.position.clone().multiplyScalar(0.985), 26);
    }
    // rim light banks along the long sides
    for (const sx of [-1, 1]) for (let z = -45; z <= 45; z += 22.5) {
      const x = sx * (BOWL.hx + t3.oEnd + 0.8);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 14, 0.6), steel); post.position.set(x, t3.hEnd + 7, z); this.group.add(post);
      const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3.2, 0.6), [steel, steel, steel, steel, headM, steel]);
      head.position.set(x - sx * 0.5, t3.hEnd + 14, z); head.lookAt(0, 0, z); this.group.add(head);
      glow(head.position.clone().add(new THREE.Vector3(-sx * 0.6, 0, 0)), 11);
    }
  }

  buildSkyline() {
    const rng = mulberry(909);
    const geos = [];
    const wt = T.windowsTexture(5, '#b4cbea');
    wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
    const cols = [[0.7, 0.8, 0.95], [0.6, 0.72, 0.9], [0.8, 0.86, 0.96], [0.56, 0.66, 0.86], [0.86, 0.84, 0.82]];
    for (let i = 0; i < 120; i++) {
      // concentrate skyline behind the north end (as in the reference) but ring the whole stadium
      const north = i < 70;
      const a = north ? (rng() - 0.5) * 1.3 + (i % 2 ? Math.PI : 0) : rng() * Math.PI * 2;
      const r = (north ? 420 : 480) + rng() * 300;
      const w = 10 + rng() * 16, d = 10 + rng() * 16;
      let h = 40 + Math.pow(rng(), 1.6) * (north ? 150 : 70);
      const g = new THREE.BoxGeometry(w, h, d);
      // scale uv for window tiling
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 16, uv.getY(k) * h / 32);
      g.translate(Math.sin(a) * r, h / 2, Math.cos(a) * r);
      const c = cols[Math.floor(rng() * cols.length)];
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => c), 3));
      geos.push(g);
      if (rng() < 0.35 && north) { // spire / setback
        const s = new THREE.BoxGeometry(w * 0.5, h * 0.25, d * 0.5);
        const su = s.attributes.uv; for (let k = 0; k < su.count; k++) su.setXY(k, su.getX(k) * w / 32, su.getY(k) * h / 128);
        s.translate(Math.sin(a) * r, h + h * 0.125, Math.cos(a) * r);
        s.setAttribute('color', new THREE.Float32BufferAttribute(new Array(s.attributes.position.count).fill(0).flatMap(() => c), 3));
        geos.push(s);
      }
    }
    const merged = mergeGeometries(geos);
    this.skyline = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ map: wt, vertexColors: true }));
    this.group.add(this.skyline);
    // distant hills
    const hills = new THREE.Mesh(new THREE.CylinderGeometry(1200, 1200, 60, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0x8fb0cf, side: THREE.BackSide }));
    hills.position.y = 20; this.group.add(hills);
  }

  cheer(amount, duration = 3) { this.exciteTarget = Math.max(this.exciteTarget, amount); this.cheerT = duration; }
  wave(on) { this.waveOn = on; }

  update(dt, t, wind, rain, cam) {
    if (this.grassU && cam) this.grassU.uCam.value.copy(cam);
    this.uniforms.uTime.value = t;
    if (this.cheerT > 0) { this.cheerT -= dt; if (this.cheerT <= 0) this.exciteTarget = 0.1; }
    this.excite += (this.exciteTarget - this.excite) * Math.min(1, dt * 3);
    this.uniforms.uExcite.value = this.excite;
    this.uniforms.uWave.value += ((this.waveOn ? 1 : 0) - this.uniforms.uWave.value) * Math.min(1, dt);
    // scrolling ribbons
    for (const tx of this.ribbonTexs) tx.offset.x = (tx.offset.x + dt * 0.02) % 1;
    // flags wave with wind
    const wa = Math.atan2(wind.x, wind.z) - Math.PI / 2;
    const ws = Math.hypot(wind.x, wind.z);
    this.flags.forEach((f, i) => {
      const tgt = ws > 0.3 ? -wa : Math.sin(t * 0.3 + i) * 0.6 + i;
      f.rotation.y += (tgt + Math.sin(t * (2 + ws * 0.4) + i) * (0.12 + ws * 0.02) - f.rotation.y) * Math.min(1, dt * 2);
    });
    // clouds drift
    this.clouds.rotation.y += dt * 0.002 * (1 + ws * 0.3);
    const dk = rain;
    this.skyMat.uniforms.dark.value = dk;
    for (const m of this.cloudMats) m.color.setScalar(1 - dk * 0.4);
  }
}
