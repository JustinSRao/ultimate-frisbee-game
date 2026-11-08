// ============================================================================
// ATHLETE VIEW — articulated pixel-art athlete + procedural animation
// Facing +Z in local space. Right side = -X.
// ============================================================================
import * as THREE from 'three';
import { curlTexture, jerseyWrap, shortsWrap, faceTexture, skinSideTexture, sleeveTexture, shortsLegTexture, sockTexture, shoeTexture } from './textures.js';
import { toon } from './materials.js';
import { mulberry } from './config.js';

const G = {};
function geo(key, fn) { return G[key] || (G[key] = fn()); }
const box = (w, h, d, ty = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ty) g.translate(0, ty, 0); return g; };
const lam = (c, opts = {}) => toon(c, opts);
// tapered limb segment (pivot at top, extends downward)
const limb = (rTop, rBot, h, ty = 0, seg = 7) => { const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1); g.translate(0, -h / 2 + ty, 0); return g; };
// rounded box: subdivided box pulled toward an ellipsoid
// lathe limb from a radius profile [[r, y], ...] (y from 0 downward negative), pivot at top
function lathe(profile, seg = 10, sx = 1, sz = 1) {
  const pts = [new THREE.Vector2(0.0001, profile[0][1])].concat(profile.map(([r, y]) => new THREE.Vector2(r, y))).concat([new THREE.Vector2(0.0001, profile[profile.length - 1][1])]);
  const g = new THREE.LatheGeometry(pts, seg); g.scale(sx, 1, sz); g.computeVertexNormals(); return g;
}
function roundBox(w, h, d, k = 0.55, ty = 0) {
  const g = new THREE.BoxGeometry(w, h, d, 3, 3, 3), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i) / (w / 2), p.getY(i) / (h / 2), p.getZ(i) / (d / 2));
    const n = v.clone().normalize(), l = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    v.lerp(n.multiplyScalar(l), k);
    p.setXYZ(i, v.x * w / 2, v.y * h / 2 + ty, v.z * d / 2);
  }
  g.computeVertexNormals(); return g;
}

const POSE_KEYS = ['bodyY', 'pitch', 'roll', 'spX', 'spY', 'spZ', 'hdY', 'hdX', 'hLx', 'hLz', 'hRx', 'hRz', 'kL', 'kR',
  'sLx', 'sLy', 'sLz', 'sRx', 'sRy', 'sRz', 'eL', 'eR', 'fL', 'fR', 'wL', 'wR'];
const mix = (a, b, t) => a + (b - a) * t;
function blankPose() { const p = {}; for (const k of POSE_KEYS) p[k] = 0; return p; }

export class AthleteView {
  constructor(opts) {
    const { team, number, name, skin, hairColor, hairStyle, gender, hand, scale, seed } = opts;
    this.hand = hand;
    const rng = mulberry(seed || 1);
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    const fem = gender === 'female';
    this.root.scale.setScalar(scale * (fem ? 0.97 : 1));
    this.mats = []; this.geos = [];
    const M = (c, o) => { const m = lam(c, o); this.mats.push(m); return m; };
    const skinM = M(skin), skinD = M(new THREE.Color(skin).multiplyScalar(0.86)), hairM = M(hairColor);
    const panelM = M(team.panel), jerseyM = M(team.jersey);
    const wrap = M(0xffffff, { map: jerseyWrap(team, number, name) });
    const sleeveM = M(0xffffff, { map: sleeveTexture(team) });
    const shortsN = M(0xffffff, { map: shortsLegTexture(team, number, true) }), shorts0 = M(0xffffff, { map: shortsLegTexture(team, number, false) }), shortsPlain = M(team.shorts);
    const sockM = M(0xffffff, { map: sockTexture(team) });
    const shoeM = M(team.shoe === 0xb51f24 ? 0xc0262a : 0x1d2546), soleM = M(0xf2f2f2), laceM = M(0xe8e8ee), sleeveBlack = M(0x17181e);
    const faceM = M(0xffffff, { map: faceTexture(skin, hairColor, gender, rng) });
    const sideM = M(0xffffff, { map: skinSideTexture(skin, hairColor) });
    const cast = (m) => { m.castShadow = true; return m; };
    // stylised athletic proportions (as in the concept art): broad shoulders, big hands & feet, slightly large head
    const shoulderW = fem ? 0.46 : 0.54, hipW = fem ? 0.4 : 0.38, sw = shoulderW / 0.42;
    const mus = fem ? 1.0 : 1.15;

    // ---- hips / shorts waist ----
    this.body.position.y = 0.95;
    // cartoon backside revealed when the shorts drop during the "moon" emote (two rounded cheeks, no detail)
    this.moonSkin = new THREE.Group(); this.moonSkin.visible = false; this.body.add(this.moonSkin);
    const cheekG = geo('cheek3', () => roundBox(0.165, 0.19, 0.13, 0.85));
    for (const sx of [-1, 1]) { const c = new THREE.Mesh(cheekG, skinM); c.position.set(sx * 0.082, -0.02, -0.06); c.castShadow = true; this.moonSkin.add(c); }
    // waist / lower back that fills the gap between the jersey hem and the hips while the shorts are down
    const waist = new THREE.Mesh(geo('waist3' + hipW, () => { const g = new THREE.CylinderGeometry(hipW * 0.48, hipW * 0.52, 0.16, 12, 1); g.scale(1, 1, 0.56); g.translate(0, 0.11, 0); return g; }), skinM);
    waist.castShadow = true; this.moonSkin.add(waist);
    // rounded joint at the base of the spine so the bent torso stays attached
    this.waistJoint = new THREE.Mesh(geo('wjoint3' + hipW, () => { const g = new THREE.SphereGeometry(hipW * 0.5, 12, 8); g.scale(1, 0.7, 0.6); g.translate(0, 0.13, 0); return g; }), skinM);
    this.waistJoint.castShadow = true; this.moonSkin.add(this.waistJoint);
    this.shortLegs = [];
    this.shortsTop = cast(new THREE.Mesh(geo('pelvis3' + hipW, () => { const g = new THREE.CylinderGeometry(hipW * 0.54, hipW * 0.6, 0.26, 12, 1); g.scale(1, 1, 0.7); g.translate(0, 0.02, 0); return g; }), shortsPlain));
    this.body.add(this.shortsTop);
    // ---- torso: loose jersey, V-taper ----
    this.spine = new THREE.Group(); this.spine.position.y = 0.08; this.body.add(this.spine);
    const chestG = geo('chest3' + shoulderW, () => {
      const g = new THREE.CylinderGeometry(0.2, 0.19, 0.56, 14, 5, true);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) / 0.56 + 0.5;
        const prof = 0.9 + 0.16 * Math.sin(Math.min(1, t * 1.1) * Math.PI * 0.5) - (t > 0.9 ? (t - 0.9) * 1.4 : 0);
        p.setX(i, p.getX(i) * prof * sw); p.setZ(i, p.getZ(i) * prof * 0.72);
      }
      g.translate(0, 0.27, 0); g.computeVertexNormals(); return g;
    });
    this.spine.add(cast(new THREE.Mesh(chestG, wrap)));
    this.spine.add(cast(new THREE.Mesh(geo('yoke3' + shoulderW, () => { const g = new THREE.SphereGeometry(0.2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(sw * 1.03, 0.3, 0.66); g.translate(0, 0.54, 0); return g; }), jerseyM)));
    this.spine.add(new THREE.Mesh(geo('collar3', () => { const g = new THREE.TorusGeometry(0.075, 0.018, 4, 12); g.rotateX(Math.PI / 2); g.scale(1, 1, 0.85); g.translate(0, 0.585, 0.01); return g; }), panelM));
    if (fem) { const b = new THREE.Mesh(geo('bust3', () => roundBox(0.3, 0.1, 0.07, 0.7)), jerseyM); b.position.set(0, 0.36, 0.11); this.spine.add(b); }
    // ---- neck & head ----
    this.neck = new THREE.Group(); this.neck.position.y = 0.55; this.spine.add(this.neck);
    this.neck.add(new THREE.Mesh(geo('neck3', () => limb(0.068, 0.078, 0.13, 0.11, 8)), skinM));
    this.head = new THREE.Group(); this.head.position.y = 0.09; this.head.scale.setScalar(1.16); this.neck.add(this.head);
    const headG = geo('head3', () => {
      const g = roundBox(0.2, 0.25, 0.23, 0.55, 0.125); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0.07) { const k = 0.8 + Math.max(0, y) / 0.07 * 0.2; p.setX(i, p.getX(i) * k); } }
      g.computeVertexNormals(); return g;
    });
    this.head.add(cast(new THREE.Mesh(headG, [sideM, sideM, hairM, skinD, faceM, hairM])));
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(geo('ear3', () => roundBox(0.035, 0.065, 0.05, 0.6)), skinM); e.position.set(sx * 0.1, 0.125, -0.01); this.head.add(e); }
    const nose = new THREE.Mesh(geo('nose3', () => roundBox(0.036, 0.055, 0.045, 0.6)), skinM); nose.position.set(0, 0.105, 0.115); this.head.add(nose);
    this.addHair(hairStyle, hairM, fem, rng);

    // ---- arms ----
    const upperProf = [[0.088 * mus, 0], [0.09 * mus, -0.06], [0.094 * mus, -0.12], [0.074 * mus, -0.21], [0.062, -0.29]];
    const foreProf = [[0.064, 0], [0.072 * mus, -0.06], [0.06 * mus, -0.15], [0.046, -0.26]];
    const mkArm = (side) => {
      const sh = new THREE.Group(); sh.position.set(side * (shoulderW / 2 + 0.035), 0.465, 0); this.spine.add(sh);
      sh.add(cast(new THREE.Mesh(geo('delt3', () => roundBox(0.19, 0.18, 0.18, 0.75, -0.02)), sleeveM)));
      sh.add(cast(new THREE.Mesh(geo('sleeve3', () => limb(0.1, 0.094, 0.16, -0.02, 10)), sleeveM)));
      sh.add(cast(new THREE.Mesh(geo('uarm3' + fem, () => lathe(upperProf, 9)), skinM)));
      const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
      el.add(cast(new THREE.Mesh(geo('farm3' + fem, () => lathe(foreProf, 9)), skinM)));
      const hand = new THREE.Group(); hand.position.y = -0.27; el.add(hand);
      hand.add(cast(new THREE.Mesh(geo('hand3', () => roundBox(0.1, 0.14, 0.07, 0.55, -0.05)), skinM)));
      const thumb = new THREE.Mesh(geo('thumb3', () => roundBox(0.035, 0.065, 0.035, 0.6)), skinM); thumb.position.set(0, -0.035, 0.045); hand.add(thumb);
      return { sh, el, hand };
    };
    this.armL = mkArm(1); this.armR = mkArm(-1);

    // ---- legs ----
    const thighProf = [[0.098 * mus, 0], [0.096 * mus, -0.1], [0.082 * mus, -0.26], [0.068, -0.4], [0.064, -0.45]];
    const calfProf = [[0.062, 0], [0.074 * mus, -0.08], [0.07 * mus, -0.15], [0.052, -0.27], [0.045, -0.4]];
    const kneeSide = (seed % 3 === 0) ? 1 : (seed % 3 === 1 ? -1 : 0);
    const mkLeg = (side) => {
      const hp = new THREE.Group(); hp.position.set(side * (hipW / 2 - 0.065), -0.02, 0); this.body.add(hp);
      const sm = new THREE.Mesh(geo('short3' + fem, () => limb(0.124, 0.132, 0.34, 0.05, 12)), [side > 0 ? shortsN : shorts0, shortsPlain, shortsPlain]);
      sm.scale.x = side; sm.castShadow = true; hp.add(sm); this.shortLegs.push(sm);
      hp.add(cast(new THREE.Mesh(geo('thigh3' + fem, () => lathe(thighProf, 10)), skinM)));
      const kn = new THREE.Group(); kn.position.y = -0.44; hp.add(kn);
      if (side === kneeSide) kn.add(cast(new THREE.Mesh(geo('ksl3', () => limb(0.084, 0.076, 0.24, 0.11, 10)), sleeveBlack)));
      kn.add(cast(new THREE.Mesh(geo('knee3', () => roundBox(0.13, 0.11, 0.13, 0.7)), skinM)));
      kn.add(cast(new THREE.Mesh(geo('calf3' + fem, () => lathe(calfProf, 10)), skinM)));
      kn.add(cast(new THREE.Mesh(geo('sock3', () => limb(0.062, 0.058, 0.18, -0.25, 10)), sockM)));
      const ft = new THREE.Group(); ft.position.y = -0.44; kn.add(ft);
      ft.add(cast(new THREE.Mesh(geo('shoe3', () => { const g = roundBox(0.14, 0.1, 0.3, 0.45); g.translate(0, -0.025, 0.05); return g; }), shoeM)));
      ft.add(new THREE.Mesh(geo('lace3', () => { const g = roundBox(0.06, 0.03, 0.12, 0.5); g.translate(0, 0.022, 0.07); return g; }), laceM));
      ft.add(new THREE.Mesh(geo('sole3', () => { const g = roundBox(0.15, 0.04, 0.31, 0.4); g.translate(0, -0.078, 0.05); return g; }), soleM));
      return { hp, kn, ft };
    };
    this.legL = mkLeg(1); this.legR = mkLeg(-1);

    this.pose = blankPose(); this.target = blankPose();
    this.phase = rng() * 6; this.t = 0;
    this._v = new THREE.Vector3();
  }

  addHair(style, m, fem, rng) {
    const h = this.head;
    const mDark = new THREE.MeshToonMaterial({ color: new THREE.Color(m.color).multiplyScalar(0.75), gradientMap: m.gradientMap }); this.mats.push(mDark);
    const add = (g, x, y, z, mat = m) => { const mesh = new THREE.Mesh(g, mat); mesh.position.set(x, y, z); mesh.castShadow = true; h.add(mesh); return mesh; };
    if (style === 'buzz') { add(geo('hb3', () => roundBox(0.212, 0.09, 0.24, 0.6)), 0, 0.23, -0.005); return; }
    add(geo('hcap3', () => roundBox(0.218, 0.11, 0.24, 0.6)), 0, 0.225, -0.01);
    add(geo('hback3', () => roundBox(0.225, 0.18, 0.09, 0.6)), 0, 0.165, -0.095, mDark);
    if (style === 'curly') {
      // compact tight curls hugging the head, lighter tips on top (as in the concept art)
      const cg = geo('curl4', () => roundBox(0.07, 0.06, 0.07, 0.85));
      const ct = curlTexture('#' + m.color.getHexString());
      const mCurl = new THREE.MeshToonMaterial({ map: ct, gradientMap: m.gradientMap }); this.mats.push(mCurl);
      const mLight = new THREE.MeshToonMaterial({ map: ct, color: 0xc8c8c8, gradientMap: m.gradientMap }); this.mats.push(mLight);
      h.children.forEach(ch => { if (ch.material === m) ch.material = mCurl; });
      const r2 = mulberry(77);
      for (let i = 0; i < 64; i++) {
        const a = r2() * Math.PI * 2, el = r2() * 1.45;
        const x = Math.sin(a) * Math.sin(el) * 0.118, z = Math.cos(a) * Math.sin(el) * 0.125 - 0.02, y = 0.195 + Math.cos(el) * 0.085;
        if (z > 0.075 && y < 0.25) continue;
        const c = add(cg, x, y, z, y > 0.26 && r2() < 0.5 ? mCurl : y < 0.2 ? mLight : mCurl);
        c.rotation.set(r2() * 3, r2() * 3, r2() * 3); c.scale.setScalar(0.85 + r2() * 0.4);
      }
      for (let i = 0; i < 6; i++) { const c = add(cg, -0.075 + i * 0.03, 0.245, 0.095); c.scale.set(0.8, 0.7, 0.6); }
    } else if (style === 'mohawk') {
      add(geo('mh3', () => roundBox(0.06, 0.14, 0.24, 0.6)), 0, 0.31, 0);
    } else if (style === 'ponytail') {
      add(geo('fr3', () => roundBox(0.22, 0.05, 0.05, 0.7)), 0, 0.245, 0.105);
      add(geo('pt3', () => roundBox(0.09, 0.27, 0.09, 0.7, -0.12)), 0, 0.24, -0.15);
    } else if (style === 'bun') {
      add(geo('bun3', () => roundBox(0.13, 0.11, 0.11, 0.8)), 0, 0.29, -0.13);
    } else if (style === 'long') {
      add(geo('long3', () => roundBox(0.24, 0.32, 0.08, 0.6, -0.1)), 0, 0.22, -0.1, mDark);
      add(geo('sideL3', () => roundBox(0.04, 0.24, 0.16, 0.6, -0.08)), 0.115, 0.22, -0.02);
      add(geo('sideR3', () => roundBox(0.04, 0.24, 0.16, 0.6, -0.08)), -0.115, 0.22, -0.02);
    } else {
      add(geo('fr4', () => roundBox(0.23, 0.07, 0.07, 0.7)), 0, 0.25, 0.1);
    }
  }

  throwArm() { return this.hand === 'right' ? this.armR : this.armL; }
  handWorld(out) { return this.throwArm().hand.getWorldPosition(out); }
  headWorld(out) { return this.head.getWorldPosition(out); }

  // a = athlete sim object with animation-relevant state
  animate(a, dt) {
    this.t += dt;
    const P = this.target;
    const sp = a.speedH;
    const hs = this.hand === 'right' ? 1 : -1; // mirror for lefties
    // ---- locomotion ----
    const cad = 1.6 + sp * 0.2;
    this.phase += dt * cad * Math.PI * 2 * (sp > 0.2 ? 1 : 0);
    const A = Math.min(1, sp / 7.5) * 0.95 + (sp > 0.2 ? 0.12 : 0);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    for (const k of POSE_KEYS) P[k] = 0;
    P.hLx = -s * A; P.hRx = s * A;
    P.kL = Math.max(0, c) * A * 1.5 + 0.08; P.kR = Math.max(0, -c) * A * 1.5 + 0.08;
    P.fL = -0.1 * A; P.fR = -0.1 * A;
    P.sLx = s * A * 0.9; P.sRx = -s * A * 0.9;
    P.sLz = 0.12; P.sRz = -0.12;
    P.eL = -(0.35 + A * 1.0); P.eR = -(0.35 + A * 1.0);
    P.bodyY = Math.abs(s) * 0.05 * A - A * 0.03;
    P.spX = Math.min(0.32, sp * 0.035) + a.accelLean * 0.05;
    P.roll = -a.turnLean * 0.25;
    P.spY = -s * A * 0.12;
    if (sp < 0.2) { // idle athletic stance
      const br = Math.sin(this.t * 2.2) * 0.02;
      P.kL = P.kR = 0.25; P.hLx = P.hRx = -0.18; P.fL = P.fR = -0.07; P.spX = 0.12 + br; P.bodyY = -0.035;
      P.eL = P.eR = -0.5; P.sLx = P.sRx = -0.15;
    }
    // ---- defensive stance ----
    if (a.anim === 'mark' || a.anim === 'guard') {
      const wide = a.anim === 'mark' ? 0.95 : 0.6;
      P.sLz = wide; P.sRz = -wide; P.sLx = -0.55; P.sRx = -0.55; P.eL = P.eR = -0.7;
      if (sp < 1.5) { P.kL = P.kR = 0.75; P.hLx = P.hRx = -0.5; P.fL = P.fR = -0.25; P.spX = 0.35; P.bodyY = -0.13; P.hLz = 0.12; P.hRz = -0.12; }
    }
    // ---- holding disc (pivot) ----
    if (a.hasDisc && !a.throwAnim) {
      // athletic ready stance like the concept art: staggered wide base, torso turned, disc held out front-side
      const k = hs > 0 ? 'R' : 'L', o = hs > 0 ? 'L' : 'R';
      P.hLz = 0.3; P.hRz = -0.3; P['h' + o + 'x'] = -0.55; P['h' + k + 'x'] = 0.25;
      P['k' + o] = 0.75; P['k' + k] = 0.45; P.fL = P.fR = -0.15;
      P.bodyY = -0.12; P.spX = 0.28; P.spY = 0.35 * hs;
      P['s' + k + 'x'] = -1.15; P['s' + k + 'z'] = -0.55 * hs; P['e' + k] = -0.55;
      P['s' + o + 'x'] = -0.35; P['s' + o + 'z'] = 0.55 * hs; P['e' + o] = -1.3;
      if (a.pivotLunge > 0.05) { P.kL = P.kR = 0.7; P.bodyY = -0.13; P.spX = 0.38; }
    }
    // ---- throwing ----
    if (a.throwAnim) {
      const ta = a.throwAnim; // {kind:'bh'|'fh', stage:'wind'|'release', w:0..1, t}
      const R = hs > 0 ? 'R' : 'L', L = hs > 0 ? 'L' : 'R';
      const w = ta.stage === 'wind' ? ta.w : 1 - Math.min(1, ta.t / 0.18);
      const rel = ta.stage === 'release' ? Math.min(1, ta.t / 0.12) : 0;
      if (ta.kind === 'bh') {
        // wind: arm across body to off side, torso twisted away
        P.spY = (0.25 + 0.65 * w) * hs * (1 - rel) - 0.45 * hs * rel;
        P['s' + R + 'x'] = -1.3 * (1 - rel) - 1.5 * rel;
        P['s' + R + 'z'] = (0.75 * w) * hs * (1 - rel) - 1.05 * hs * rel;
        P['e' + R] = -0.9 * (1 - rel) - 0.1 * rel;
        P['s' + L + 'x'] = -0.2; P['s' + L + 'z'] = 0.3 * hs * -1;
      } else {
        // FOREHAND (flick): low, compact, side-arm. Step out to the throwing side, elbow tucked near the hip,
        // forearm out to the side with the wrist cocked back, disc flat at hip height; the elbow leads,
        // then the forearm and wrist snap through ("skip a stone") with a short follow-through at the target.
        const fol = ta.stage === 'release' ? Math.min(1, Math.max(0, (ta.t - 0.1) / 0.25)) : 0;
        const key = (wv, rv, fv) => (ta.stage === 'wind' ? wv * ta.w : rel < 1 ? mix(wv, rv, rel) : mix(rv, fv, fol));
        const wnd = ta.stage === 'wind' ? ta.w : 1;
        // throwing arm (values for a right-hander; mirrored by hs)
        P['s' + R + 'x'] = key(-0.1, -0.35, -0.65);         // upper arm hangs by the side, slightly forward
        P['s' + R + 'z'] = key(-0.25, -0.3, -0.2) * hs;     // elbow close to the body
        P['s' + R + 'y'] = key(-1.75, -0.6, 0.1) * hs;      // twist: forearm out & back -> whips forward
        P['e' + R] = key(-1.5, -1.15, -0.6);                 // forearm ~horizontal at hip height
        P['w' + R] = key(0.8, -0.3, -0.6);                   // wrist cocked back, then snaps
        // off arm out for balance
        P['s' + L + 'x'] = -0.35; P['s' + L + 'z'] = 0.75 * hs; P['e' + L] = -0.5;
        // torso: coil toward the throwing side, unwind through release
        P.spY = key(-0.45, 0.05, 0.2) * hs; P.spX = 0.3 + 0.1 * wnd; P.roll = key(-0.12, -0.05, 0) * hs;
        // legs: wide step out to the throwing side, low base, pivot foot stays planted
        P['h' + R + 'z'] = -0.5 * hs * Math.max(wnd, 1 - fol * 0.4); P['h' + R + 'x'] = -0.2; P['k' + R] = 0.85;
        P['h' + L + 'z'] = 0.12 * hs; P['h' + L + 'x'] = 0.15; P['k' + L] = 0.45;
        P.bodyY = -0.16 - 0.04 * wnd;
        P.fL = P.fR = -0.2;
      }
      if (ta.kind === 'fh') { /* legs & body handled above */ }
      else {
      P.kL = P.kR = 0.35 + w * 0.2; P.bodyY = -0.06 - w * 0.04; P.spX = 0.18 + rel * 0.15;
      // step out with the pivot lunge
      P.hLx = -0.25 * hs; P.hRx = 0.25 * hs;
      }
    }
    // ---- catching / reaching ----
    if (a.reach) {
      const d = a.reach; // local unit dir from shoulder height to disc
      const pitch = -Math.atan2(d.z, -d.y);
      const yaw = Math.asin(Math.max(-1, Math.min(1, d.x)));
      const two = a.reachTwo;
      P.sRx = pitch; P.sRz = Math.min(0.2, yaw) - 0.05; P.eR = -0.15;
      if (two) { P.sLx = pitch; P.sLz = Math.max(-0.2, yaw) + 0.05; P.eL = -0.15; }
    }
    // ---- airborne ----
    if (a.y > 0.05 && !a.dive) {
      P.kL = 0.9; P.kR = 0.5; P.hLx = -0.6; P.hRx = -0.2; P.fL = P.fR = 0.3;
      if (!a.reach && !a.hasDisc) { P.sLx = P.sRx = -2.6; P.sLz = 0.25; P.sRz = -0.25; P.eL = P.eR = -0.1; }
    }
    // ---- dive (layout) ----
    if (a.dive) {
      const d = a.dive;
      const k = d.t < 0.12 ? d.t / 0.12 : 1;
      P.pitch = 1.38 * k; P.bodyY = -0.62 * k;
      P.sLx = P.sRx = -2.9; P.sLz = 0.12; P.sRz = -0.12; P.eL = P.eR = -0.05;
      P.hLx = 0.25; P.hRx = 0.15; P.kL = 0.3; P.kR = 0.1; P.spX = -0.15; P.hdX = -0.5;
      if (d.ground) { P.sLx = P.sRx = -2.7; }
    }
    if (a.anim === 'recover') { P.kL = P.kR = 1.6; P.hLx = P.hRx = -1.4; P.bodyY = -0.42; P.spX = 0.6; P.sLx = P.sRx = -0.3; }
    if (a.anim === 'celebrate') {
      const j = Math.abs(Math.sin(this.t * 6));
      P.sLx = P.sRx = -2.8 - j * 0.2; P.sLz = 0.4; P.sRz = -0.4; P.eL = P.eR = -0.2; P.bodyY = j * 0.12; P.spX = -0.1;
    }
    if (a.anim === 'dejected') { P.spX = 0.35; P.hdX = 0.4; P.sLx = P.sRx = 0.05; P.eL = P.eR = -0.1; }
    if (a.lookYaw !== undefined) P.hdY = a.lookYaw;
    if (false && this.pony) this.pony.rotation.x = 0.3 + Math.min(0.9, sp * 0.12) + Math.sin(this.t * 10) * 0.08 * Math.min(1, sp);

    if (a.emote) this.emotePose(a.emote, P, hs);
    { // shorts dip for the moon emote
      const em = a.emote, k = em && em.kind === 'moon' ? Math.min(1, Math.max(0, (em.t - 0.55) / 0.2)) * (1 - Math.min(1, Math.max(0, (em.t - 2.35) / 0.25))) : 0;
      this.moonSkin.visible = k > 0.05;
      // shorts slide down the thighs, bunching up just above the knees
      this.shortsTop.position.y = -0.3 * k; this.shortsTop.scale.set(1 - 0.12 * k, 1 - 0.45 * k, 1 - 0.1 * k);
      for (const sm of this.shortLegs) { sm.position.y = -0.17 * k; sm.scale.y = 1 - 0.35 * k; }
    }
    // ---- blend ----
    const fast = a.throwAnim || a.dive || a.reach || a.emote ? 24 : 14;
    const k = Math.min(1, dt * fast);
    const p = this.pose;
    for (const key of POSE_KEYS) p[key] += (P[key] - p[key]) * k;
    this.apply();
  }

  // ---- goal emotes (1 spike, 2 drop kick, 3 "6-7", 4 bow & arrow) ----
  emotePose(em, P, hs) {
    const t = em.t, R = hs > 0 ? 'R' : 'L', L = hs > 0 ? 'L' : 'R';
    const ss = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    for (const k of POSE_KEYS) P[k] = 0;
    P.kL = P.kR = 0.1;
    if (em.kind === 'spike') {
      // rear back with the disc overhead, then slam it into the turf and flex
      const up = ss(0, 0.4, t), slam = ss(0.42, 0.56, t), flex = ss(0.95, 1.2, t);
      P['s' + R + 'x'] = mix(mix(0, -2.95, up), -0.25, slam); P['e' + R] = mix(-0.4 * up, -0.15, slam);
      P['s' + L + 'x'] = mix(-0.8 * up, 0.3, slam); P['s' + L + 'z'] = 0.4 * hs * up;
      P.spX = mix(-0.25 * up, 0.75, slam); P.bodyY = mix(0.03 * up, -0.22, slam);
      P.kL = P.kR = mix(0.1, 0.75, slam); P.hLx = P.hRx = mix(0, -0.55, slam);
      if (flex > 0) { // double-bicep flex
        P.spX = mix(P.spX, -0.05, flex); P.bodyY = mix(P.bodyY, -0.05, flex); P.kL = P.kR = mix(P.kL, 0.25, flex); P.hLx = P.hRx = mix(P.hLx, -0.1, flex);
        P.sLx = P.sRx = mix(P.sRx, -1.57, flex); P.sLz = mix(0, 1.4, flex); P.sRz = mix(0, -1.4, flex); P.eL = P.eR = mix(P.eR, -2.0, flex);
        P.hdX = -0.25 * flex;
      }
    } else if (em.kind === 'dropkick') {
      // hold it out, drop it, swing the kicking leg back and boot it, land with arms up
      const hold = ss(0, 0.25, t), back = ss(0.38, 0.55, t), kick = ss(0.58, 0.72, t), land = ss(1.2, 1.5, t);
      P.sLx = P.sRx = mix(-1.25 * hold, -0.2, back); P.eL = P.eR = -0.5 * hold;
      P.sLz = mix(0, 1.1, back); P.sRz = mix(0, -1.1, back);                 // arms out for balance
      P['h' + R + 'x'] = mix(mix(0, 0.75, back), -1.55, kick); P['k' + R] = mix(mix(0.1, 1.5, back), 0.05, kick);
      P['h' + L + 'x'] = mix(0, 0.15, kick); P['k' + L] = 0.35 * back;
      P.spX = mix(0.15 * hold, -0.35, kick); P.bodyY = mix(0, 0.06, kick);
      if (land > 0) { P['h' + R + 'x'] = mix(P['h' + R + 'x'], -0.1, land); P['k' + R] = mix(P['k' + R], 0.2, land); P.spX = mix(P.spX, 0, land);
        P.sLx = P.sRx = mix(-0.2, -2.9, land); P.sLz = mix(1.1, 0.35, land); P.sRz = mix(-1.1, -0.35, land); }
    } else if (em.kind === 'sixseven') {
      // palms up in front, hands alternately bobbing up and down
      const on = ss(0, 0.25, t), off = 1 - ss(2.3, 2.6, t), k = on * off;
      const b = Math.sin(t * 11) * k;
      P.sLx = P.sRx = -0.5 * k; P.sLz = 0.3 * k; P.sRz = -0.3 * k;
      P.eL = (-1.35 + 0.45 * b) * k; P.eR = (-1.35 - 0.45 * b) * k;
      P.sLx += -0.15 * b; P.sRx += 0.15 * b;
      P.wL = P.wR = 0.4 * k; P.spZ = 0.06 * b; P.hdY = 0.15 * b; P.hdX = 0.1 * k;
      P.bodyY = Math.abs(Math.sin(t * 5.5)) * 0.03 * k; P.kL = P.kR = 0.2;
    } else if (em.kind === 'moon') {
      // back to the opponents, bend over, thumbs in the waistband, wiggle, glance back over the shoulder
      const bend = ss(0.15, 0.55, t), out = 1 - ss(2.35, 2.75, t), k = bend * out;
      const wig = Math.sin(t * 13) * ss(0.6, 0.8, t) * out;
      P.spX = 1.0 * k; P.hdX = -0.85 * k; P.hdY = 0.7 * hs * k;
      P.hLx = P.hRx = -0.15 * k; P.kL = P.kR = 0.3 * k + 0.1; P.fL = P.fR = 0.1 * k;
      P.sLx = P.sRx = 0.75 * k; P.sLz = 0.25 * k; P.sRz = -0.25 * k; P.eL = P.eR = -1.2 * k;
      P.roll = 0.12 * wig; P.spZ = -0.1 * wig; P.bodyY = -0.04 * k + Math.abs(wig) * 0.02;
    } else if (em.kind === 'bow') {
      // turn side-on, front arm out, draw to the cheek, hold, loose, watch it fly
      const turn = ss(0, 0.3, t), draw = ss(0.25, 0.75, t), loose = ss(1.45, 1.55, t), end = ss(2.1, 2.4, t);
      const k = turn * (1 - end);
      P.spY = 1.05 * hs * k; P.hdY = -0.95 * hs * k; P.spX = -0.12 * k; P.hdX = -0.12 * k;
      P['s' + L + 'x'] = -1.6 * k; P['s' + L + 'z'] = 0.05 * hs * k; P['e' + L] = 0;                // bow arm, straight
      P['s' + R + 'x'] = mix(-0.6, -1.65, draw) * k; P['s' + R + 'z'] = mix(-0.2, -0.35, draw) * hs * k;
      P['e' + R] = mix(-0.8, -2.45, draw) * k * (1 - loose) + (-0.4) * loose * k;                   // draw hand at the cheek
      if (loose > 0) { P['s' + R + 'z'] = mix(P['s' + R + 'z'], -1.25 * hs * k, loose); P['s' + R + 'x'] = mix(P['s' + R + 'x'], -1.2 * k, loose); }
      P.hLx = -0.25 * k; P.hRx = 0.3 * k; P.kL = 0.25; P.kR = 0.15;
    }
  }

  apply() {
    const p = this.pose;
    this.body.position.y = 0.95 + p.bodyY;
    this.body.rotation.set(p.pitch, 0, p.roll);
    this.spine.rotation.set(p.spX, p.spY, p.spZ);
    this.head.rotation.set(p.hdX - p.spX * 0.6, p.hdY, 0);
    this.legL.hp.rotation.set(p.hLx, 0, p.hLz); this.legR.hp.rotation.set(p.hRx, 0, p.hRz);
    this.legL.kn.rotation.x = p.kL; this.legR.kn.rotation.x = p.kR;
    this.legL.ft.rotation.x = p.fL - p.kL * 0.3 - p.hLx * 0.4; this.legR.ft.rotation.x = p.fR - p.kR * 0.3 - p.hRx * 0.4;
    this.armL.sh.rotation.set(p.sLx, p.sLy, p.sLz); this.armR.sh.rotation.set(p.sRx, p.sRy, p.sRz);
    this.armL.el.rotation.x = p.eL; this.armR.el.rotation.x = p.eR;
    this.armL.hand.rotation.x = p.wL; this.armR.hand.rotation.x = p.wR;
  }

  dispose() { for (const m of this.mats) { if (m.map) m.map.dispose(); m.dispose(); } for (const g of this.geos || []) g.dispose(); }
}
