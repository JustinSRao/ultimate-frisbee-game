// ============================================================================
// PIXEL-ART POST PASS — distance-based pixel LOD
// Scene renders to a low-res target with depth. The composite shader picks a
// pixel-block size (1, 2 or 4 target texels) from scene depth, so nearby
// objects keep fine pixels while distant objects become chunkier. Blocks are
// power-of-two aligned so LOD levels nest cleanly. Adds posterised colour,
// ordered dithering and depth-edge outlines for a crisp pixel-art finish.
// ============================================================================
import * as THREE from 'three';

export class PixelPipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = null;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, res: { value: new THREE.Vector2(1, 1) },
        near: { value: 0.1 }, far: { value: 3000 }, lod1: { value: 9999 }, lod2: { value: 9999 },
        levels: { value: 34 }, outline: { value: 0.75 }, sat: { value: 1.12 }, dofStart: { value: 60 }, dofAmt: { value: 0.0 }, uTime: { value: 0 }, dither: { value: 1 }, rain: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 res; uniform float near; uniform float far;
        uniform float lod1; uniform float lod2; uniform float dofStart; uniform float dofAmt; uniform float uTime; uniform float levels; uniform float outline; uniform float sat; uniform float dither; uniform float rain;
        varying vec2 vUv;
        float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        float depthAt(vec2 px){ return lin(texture2D(tDepth, (px + 0.5) / res).r); }
        float bayer4(vec2 p){
          vec2 q = mod(p, 4.0);
          int i = int(q.x) + int(q.y) * 4;
          float m[16];
          m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
          m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
          for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.5;
          return 0.0;
        }
        void main(){
          vec2 px = floor(vUv * res);
          // choose block size from depth: test the coarse block first so blocks nest
          float bs = 1.0;
          vec2 c4 = floor(px / 4.0) * 4.0 + 1.5;
          if (depthAt(c4) > lod2) bs = 4.0;
          else {
            vec2 c2 = floor(px / 2.0) * 2.0 + 0.5;
            if (depthAt(c2) > lod1) bs = 2.0;
          }
          vec2 cell = floor(px / bs) * bs;
          vec2 sp = cell + (bs - 1.0) * 0.5;
          vec3 col = texture2D(tColor, (sp + 0.5) / res).rgb;
          float d = depthAt(sp);
          // depth of field: soften the distant stands & skyline like the reference
          float br = clamp((d - dofStart) / 140.0, 0.0, 1.0) * dofAmt;
          if (br > 0.2) {
            vec3 acc = col; float wsum = 1.0;
            for (int i = 0; i < 8; i++) {
              float a = float(i) * 0.7854;
              vec2 o = vec2(cos(a), sin(a)) * br;
              vec2 q = sp + o;
              if (depthAt(q) > dofStart) { acc += texture2D(tColor, (q + 0.5) / res).rgb; wsum += 1.0; }
            }
            col = acc / wsum;
          }
          // depth-edge outline: 1 art-pixel dark navy line on the near side of silhouettes
          if (outline > 0.0 && d < 45.0) {
            float dl = depthAt(sp + vec2(-bs, 0.0)), dr = depthAt(sp + vec2(bs, 0.0));
            float du = depthAt(sp + vec2(0.0, bs)), dd = depthAt(sp + vec2(0.0, -bs));
            float mx = max(max(dl, dr), max(du, dd));
            float edge = step(0.45 + d * 0.08, mx - d);
            float k = edge * outline * (1.0 - smoothstep(25.0, 45.0, d));
            col = mix(col, col * vec3(0.10, 0.12, 0.22), k);
          }
          // linear -> sRGB
          col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, sat - rain * 0.25);
          col = mix(col, col * vec3(0.86, 0.9, 1.0), rain * 0.5);
          // warm afternoon grade, soft highlight glow, gentle contrast
          col = col * vec3(1.05, 1.0, 0.94);
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col += max(lum - 0.78, 0.0) * vec3(0.35, 0.3, 0.2);
          col = (col - 0.5) * 1.07 + 0.52;
          vec2 vc = vUv - 0.5; col *= 1.0 - dot(vc, vc) * 0.45;
          col += (fract(sin(dot(cell + floor(uTime * 12.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.018;
          // posterise with ordered dither on the block grid
          float dth = dither * bayer4(cell / bs);
          col = floor(col * levels + 0.5 + dth * 0.55) / levels;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.qScene = new THREE.Scene(); this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize(w, h, pixelSize) {
    const rw = Math.max(64, Math.floor(w / pixelSize)), rh = Math.max(64, Math.floor(h / pixelSize));
    if (this.rt && this.rt.width === rw && this.rt.height === rh) return;
    if (this.rt) { this.rt.dispose(); this.rt.depthTexture.dispose(); }
    const dt = new THREE.DepthTexture(rw, rh); dt.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(rw, rh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: dt, samples: 0 });
    this.mat.uniforms.tColor.value = this.rt.texture; this.mat.uniforms.tDepth.value = dt;
    this.mat.uniforms.res.value.set(rw, rh);
  }
  render(scene, camera) {
    const r = this.renderer;
    this.mat.uniforms.near.value = camera.near; this.mat.uniforms.far.value = camera.far;
    r.setRenderTarget(this.rt); r.render(scene, camera);
    r.setRenderTarget(null); r.render(this.qScene, this.qCam);
  }
}
