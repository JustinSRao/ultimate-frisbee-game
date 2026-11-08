# WUL Ultimate Frisbee

A single-player 3D ultimate frisbee game in the browser (Three.js, pixel-art render pipeline): swipe throwing with real
disc aerodynamics, AI teammates and opponents, 16 teams, an automatic WFDF/USAU-style rules engine (stalls, caps,
universe point), weather, emotes and disc cam.

## Play

Open `dist/index.html` in a modern desktop browser. It's a self-contained single file.

## Build

```bash
npm ci
npm run build        # bundles src/ + template.html -> dist/index.html
npm run test:sim     # headless simulation checks (AI matches, mark blocks, over-the-shoulder catches)
```

Browser screenshot/input tests live in `tools/browser-tests/` (Playwright, run from the repo root).

## Code map

| File | What |
|---|---|
| `src/game.js` | simulation + rules engine (fixed 60 Hz, no rendering) |
| `src/ai.js` | offense/defense AI, throw decisions |
| `src/physics.js` | flying-disc aerodynamics + throw solver |
| `src/movement.js` | athlete acceleration model |
| `src/weather.js` | wind & rain |
| `src/config.js` | 16 teams, attributes, settings |
| `src/main.js` | renderer, camera, input, swipe throws, HUD, menus |
| `src/athleteView.js` | athlete models & procedural animation |
| `src/stadium.js`, `src/textures.js`, `src/post.js` | stadium, crowd, procedural textures, pixel post-processing |

## Next steps

`prompt_for_windows.md` is the Claude Code prompt for the next phase: online cross-play on Cloudflare (free plan),
Quick/Custom/Tournament modes, touch controls, and Tauri apps for Windows, macOS and iOS (TestFlight).
