// ============================================================================
// AUDIO — procedural Web Audio synthesis (no external files)
// ============================================================================
export class Audio {
  constructor() { this.ctx = null; this.muted = false; this.vol = 0.7; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => { }); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.vol; this.master.connect(this.ctx.destination);
      // noise buffer
      const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // crowd ambience: looped filtered noise with slow swell
      this.crowd = this.loopNoise(500, 0.7, 0.05);
      this.crowdLfo = this.ctx.createOscillator(); this.crowdLfo.frequency.value = 0.13;
      const lg = this.ctx.createGain(); lg.gain.value = 0.015; this.crowdLfo.connect(lg); lg.connect(this.crowd.gain.gain); this.crowdLfo.start();
      this.windN = this.loopNoise(260, 0.6, 0);
      this.rainN = this.loopNoise(4200, 0.4, 0);
    } catch (e) { this.ctx = null; }
  }
  loopNoise(freq, q, gain) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return { src, f, gain: g };
  }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.vol; }
  setVolume(v) { this.vol = v; if (this.master && !this.muted) this.master.gain.value = v; }
  ambience(excite, wind, rain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowd.gain.gain.setTargetAtTime(0.05 + excite * 0.22, t, 0.4);
    this.crowd.f.frequency.setTargetAtTime(500 + excite * 500, t, 0.5);
    this.windN.gain.gain.setTargetAtTime(Math.min(0.12, wind * 0.014), t, 0.8);
    this.rainN.gain.gain.setTargetAtTime(rain * 0.12, t, 1.0);
  }
  burst({ dur = 0.2, freq = 1000, q = 1, gain = 0.3, type = 'bandpass', sweep = 0, attack = 0.005 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  tone({ freq = 440, dur = 0.15, gain = 0.2, type = 'sine', to = 0, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  play(name, opt = {}) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'release': this.burst({ dur: 0.22, freq: 2400, q: 2, gain: 0.25, sweep: 0.35 }); break;
      case 'flight': this.burst({ dur: 0.5, freq: 900, q: 3, gain: 0.05, sweep: 0.6 }); break;
      case 'catch': this.burst({ dur: 0.08, freq: 600, q: 1.5, gain: 0.5, type: 'lowpass' }); this.tone({ freq: 180, dur: 0.07, gain: 0.15, type: 'triangle' }); break;
      case 'drop': this.burst({ dur: 0.12, freq: 300, q: 1, gain: 0.35, type: 'lowpass' }); break;
      case 'block': this.burst({ dur: 0.1, freq: 900, q: 2, gain: 0.5 }); this.tone({ freq: 140, dur: 0.1, gain: 0.2, type: 'square' }); break;
      case 'ground': this.burst({ dur: 0.15, freq: 220, q: 1, gain: 0.3, type: 'lowpass' }); break;
      case 'step': this.burst({ dur: 0.05, freq: 180 + Math.random() * 60, q: 1, gain: 0.08 * (opt.v || 1), type: 'lowpass' }); break;
      case 'jump': this.burst({ dur: 0.12, freq: 260, q: 1, gain: 0.15, type: 'lowpass' }); break;
      case 'land': this.burst({ dur: 0.1, freq: 160, q: 1, gain: 0.2, type: 'lowpass' }); break;
      case 'dive': this.burst({ dur: 0.45, freq: 500, q: 0.7, gain: 0.3, sweep: 0.3 }); break;
      case 'whistle': this.tone({ freq: 2900, dur: 0.35, gain: 0.12, type: 'square' }); this.tone({ freq: 3050, dur: 0.35, gain: 0.06, type: 'sine' }); break;
      case 'cheer': this.burst({ dur: 2.8, freq: 900, q: 0.5, gain: 0.55 * (opt.v || 1), attack: 0.15 }); this.burst({ dur: 2.2, freq: 2200, q: 0.8, gain: 0.25 * (opt.v || 1), attack: 0.2 }); break;
      case 'ooh': this.burst({ dur: 1.0, freq: 420, q: 2, gain: 0.3, attack: 0.08, sweep: 0.7 }); break;
      case 'horn': this.tone({ freq: 196, dur: 1.2, gain: 0.15, type: 'sawtooth' }); this.tone({ freq: 247, dur: 1.2, gain: 0.1, type: 'sawtooth' }); break;
      case 'ui': this.tone({ freq: 880, dur: 0.06, gain: 0.08, type: 'square' }); break;
      case 'call': this.tone({ freq: 660, dur: 0.08, gain: 0.1, type: 'triangle' }); this.tone({ freq: 990, dur: 0.1, gain: 0.1, type: 'triangle', delay: 0.08 }); break;
      case 'stall': this.tone({ freq: 520 + (opt.n || 0) * 30, dur: 0.06, gain: 0.06, type: 'square' }); break;
      case 'universe': this.tone({ freq: 392, dur: 0.3, gain: 0.15, type: 'square' }); this.tone({ freq: 523, dur: 0.3, gain: 0.15, type: 'square', delay: 0.2 }); this.tone({ freq: 659, dur: 0.6, gain: 0.15, type: 'square', delay: 0.4 }); break;
    }
  }
}
