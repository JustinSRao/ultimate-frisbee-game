// ============================================================================
// WEATHER — dynamic wind (8 directions, gusts, smooth shifts) and rain
// Wind "from" convention: N = from +z (blows toward -z). East = +x.
// ============================================================================
import { WIND_DIRS } from './config.js';

const DIR_ANG = { N: 0, NE: Math.PI / 4, E: Math.PI / 2, SE: 3 * Math.PI / 4, S: Math.PI, SW: -3 * Math.PI / 4, W: -Math.PI / 2, NW: -Math.PI / 4 };
export const MS_TO_MPH = 2.23694;

export class Weather {
  constructor(settings, rng) {
    this.rng = rng;
    let wind = settings.wind, rain = settings.rain;
    switch (settings.weatherPreset) {
      case 'sunny': wind = 'off'; rain = 'off'; break;
      case 'random': wind = 'random'; rain = 'random'; break;
      case 'windy': wind = 'on'; rain = 'off'; break;
      case 'rainy': rain = 'on'; if (wind === 'off') wind = 'random'; break;
      default: break; // custom
    }
    this.windMode = wind; this.rainMode = rain;
    this.t = 0;
    // wind state: angle = "from" direction angle, speed m/s
    if (wind === 'custom') { this.ang = DIR_ANG[settings.windDir] || 0; this.speed = settings.windSpeed / MS_TO_MPH; }
    else if (wind === 'on') { this.ang = this.pickDir(); this.speed = 3 + rng() * 4; }
    else if (wind === 'random') { this.ang = this.pickDir(); this.speed = rng() < 0.5 ? 0 : 1 + rng() * 3; }
    else { this.ang = 0; this.speed = 0; }
    this.tAng = this.ang; this.tSpeed = this.speed;
    this.nextShift = 25 + rng() * 25;
    this.rain = rain === 'on' ? 0.8 : 0; this.tRain = this.rain;
    this.nextRain = 40 + rng() * 60;
    this.gust = 0;
    this.wind = { x: 0, z: 0 };
    this.compute();
  }
  pickDir() { return DIR_ANG[WIND_DIRS[Math.floor(this.rng() * 8)]]; }
  dirLabel() {
    let a = this.ang; let best = 'N', bd = 9;
    for (const k of WIND_DIRS) { let d = Math.abs(Math.atan2(Math.sin(a - DIR_ANG[k]), Math.cos(a - DIR_ANG[k]))); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  compute() {
    const sp = this.speed * (1 + this.gust);
    // from-direction vector (sin a, cos a); flow is opposite
    this.wind.x = -Math.sin(this.ang) * sp; this.wind.z = -Math.cos(this.ang) * sp;
    this.current = sp;
  }
  update(dt) {
    const r = this.rng;
    this.t += dt;
    if (this.windMode === 'random' || this.windMode === 'on') {
      this.nextShift -= dt;
      if (this.nextShift <= 0) {
        this.nextShift = 25 + r() * 35;
        // shift by at most 45 degrees, change speed gradually
        this.tAng = this.tAng + (r() < 0.5 ? -1 : 1) * Math.PI / 4 * (r() < 0.6 ? 1 : 0);
        if (this.windMode === 'on') this.tSpeed = 3 + r() * 5;
        else this.tSpeed = r() < 0.3 ? 0 : Math.min(8, Math.max(0, this.tSpeed + (r() - 0.4) * 3.5));
      }
    }
    let da = Math.atan2(Math.sin(this.tAng - this.ang), Math.cos(this.tAng - this.ang));
    this.ang += da * Math.min(1, dt * 0.08);
    this.speed += (this.tSpeed - this.speed) * Math.min(1, dt * 0.06);
    // gusts: layered slow sines
    const t = this.t;
    this.gust = this.speed > 0.3 ? (Math.sin(t * 0.37) * 0.14 + Math.sin(t * 1.13 + 1.7) * 0.08 + Math.sin(t * 2.9) * 0.04) : 0;
    this.compute();
    // rain
    if (this.rainMode === 'random') {
      this.nextRain -= dt;
      if (this.nextRain <= 0) {
        this.nextRain = 45 + r() * 70;
        this.tRain = this.tRain > 0.1 ? (r() < 0.55 ? 0 : 0.3 + r() * 0.7) : (r() < 0.35 ? 0.3 + r() * 0.7 : 0);
      }
    } else if (this.rainMode === 'on') this.tRain = 0.8;
    else this.tRain = 0;
    this.rain += (this.tRain - this.rain) * Math.min(1, dt * 0.05);
    if (this.rain < 0.01 && this.tRain === 0) this.rain = 0;
  }
}
