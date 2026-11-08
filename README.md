# WUL Ultimate

A 3D ultimate frisbee game (Three.js, pixel-art render pipeline):

- swipe throwing with real disc aerodynamics
- AI teammates and opponents
- 16 teams
- an automatic WFDF/USAU-style rules engine (stalls, caps, universe point)
- weather, emotes and disc cam

It plays in any browser and as an app on Windows, macOS and iPhone, solo against bots or **online with friends**
(cross-play, server-authoritative).

| | |
|---|---|
| **Play in the browser** | https://wul-ultimate.pages.dev |
| **Online server** (Cloudflare Worker) | https://wul-ultimate.traveltoolkit-proxy.workers.dev (`/api/health`) |
| **Privacy policy** | https://wul-ultimate.pages.dev/privacy |
| **Windows installer** | GitHub Actions → *Windows installer* → artifact `wul-ultimate-windows`, or build it locally (below) |

## Modes

- **Quick Match:** one tap, against bots, with your last-used settings.
- **Custom Match:**
  - Settings: team size 2v2–7v7, duration, rules, difficulty, weather, pass assist, both teams.
  - **Offline:** pick any team and slot in the lobby.
  - **Online:** **Host** a room (you get a 5-letter code) or **Join** one.
  - Bots fill every empty slot. If a player drops, a bot takes over their athlete, and they get it back if they rejoin
    within 60 s.
- **Tournament:**
  - A 16-team single-elimination bracket (R16 → QF → SF → Final) with random seeding.
  - Matches without you are simulated with the real headless engine (or a rating model on slow devices).
  - Progress is saved, and there's a champion screen.
  - **Online co-op:** friends join your team, and the server keeps the bracket.
- **Practice**, **athlete customization**, **settings** and **controls**.

Controls: WASD, mouse, swipe-throw (left drag = backhand, right drag = forehand), double-tap W to sprint, Space to jump,
Shift to dive, Q to call, C for disc cam, 1–5 for emotes. On phones and tablets there's a virtual stick, buttons and
swipe throws.

## Run locally

```bash
npm ci
npm run build          # client/ + shared/ -> client/dist/index.html (+ copy at dist/index.html)
npm run dev:client     # rebuilds on change, serves http://localhost:5173 (talks to a local server)
npm run dev:server     # wrangler dev: the Worker + Durable Objects on http://127.0.0.1:8787
```

`dist/index.html` is a single self-contained file that you can open directly. To point a page at another server, add
`?server=<url>` to its address. The production server URL lives in `client/src/serverConfig.js`.

### Tests

```bash
npm run test:sim       # headless simulations (AI matches, mark blocks, over-the-shoulder catches)
npm run test:browser   # Playwright: menu, quick match, offline lobby, tournament -> champion, iPhone touch controls
npm run test:net       # starts wrangler dev, 3 browser clients in one room: sync, inputs, bots, disconnect/reconnect
node tools/net/nettest.mjs https://wul-ultimate.traveltoolkit-proxy.workers.dev   # same test against production
node tools/net/protocol.mjs <server>                                               # raw-WebSocket protocol test
node tools/sim/tourney.mjs                                                         # bracket logic
```

### Desktop app (Tauri v2)

```bash
npm run build:win      # Windows: NSIS .exe + .msi in apps/tauri/src-tauri/target/release/bundle/
npx tauri dev          # run the app against the current build
```

`build:win` runs inside the Visual Studio Build Tools environment (`tools/build-windows.cmd`). Requirements: Rust
(MSVC), VS Build Tools with "Desktop development with C++", and WebView2.

The installer is **unsigned**, so Windows SmartScreen shows "Windows protected your PC". Click **More info → Run
anyway**. macOS and iOS builds are done on a Mac: see `prompt_for_mac.md`.

## Deploy

```bash
npx wrangler login
npx wrangler deploy --config server/wrangler.toml                                        # online server
npm run build && npx wrangler pages deploy client/dist --project-name wul-ultimate --branch main   # web client
```

CI (`.github/workflows/web.yml`) does both on every push to `main` once the repository has the secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `.github/workflows/windows.yml` builds the Windows installer on
every push to `main`, and needs no secrets.

## Architecture

```
                      ┌────────────────────── shared/ (pure ES modules, no DOM) ─────────────────────┐
                      │ game.js (rules, 60 Hz step) · ai.js · physics.js · movement.js · weather.js   │
                      │ config.js (16 teams) · tournament.js (bracket) · protocol.js (wire format)    │
                      └──────────────┬───────────────────────────────────────────┬────────────────────┘
                                     │ imported by                               │ imported by
  ┌──────────────────────────────────▼──────────────┐       ┌────────────────────▼──────────────────────────┐
  │ client/ (Three.js)                              │       │ server/ (Cloudflare Worker, Free plan)        │
  │  main.js renderer · HUD · input · swipe throws  │       │  worker.js  POST /api/rooms                   │
  │  modes.js menus · lobby · tournament · bracket  │ HTTPS │             GET  /api/rooms/:code             │
  │  net.js  OnlineSession + RemoteGame             │◄─────►│             GET  /api/rooms/:code/ws ──┐      │
  │          (interpolate others 100 ms behind,     │  WSS  │  room.js  Durable Object per room      ▼      │
  │           predict + reconcile own athlete)      │       │   SQLite-backed, WebSocket Hibernation API    │
  │  touch.js  phones/tablets                       │       │   lobby: slots, host, lock (hibernates idle)  │
  │  storage.js localStorage | Tauri store          │       │   match: shared Game @60 Hz, snapshots @20 Hz │
  └──────┬───────────────────────────┬──────────────┘       │   bots fill slots / take over disconnects     │
         │ npm run build             │                      │   idle rooms closed after 5 min               │
         ▼                           ▼                      └───────────────────────────────────────────────┘
  client/dist/index.html ──► Cloudflare Pages (web)
  (single file)          ──► apps/tauri (Tauri v2): Windows .exe/.msi · macOS .app/.pkg · iOS .ipa
```

Protocol (JSON):

- **Client → server:** inputs `{t:'in', seq, mx, mz, sprint, jump, dive, call, aimYaw, faceYaw}` are sent when they
  change (≤30 Hz), with a 5 Hz heartbeat. Swipe throws and emotes are separate events.
- **Server → client:** 20 Hz snapshots with athlete state, disc, score, clock and events, plus `ack` per player for
  reconciliation.
- **Authority:** the disc and every rule decision come only from the server.
- **Identity:** a random player ID plus a display name, stored on the device. No accounts.

## Costs

- **Cloudflare: free now.**
  - The Workers Free plan covers 100k requests a day and 13,000 GB-s a day of Durable Object duration (about 29 hours
    of active rooms a day).
  - Incoming WebSocket messages count at 20:1, outgoing ones are free, and idle lobbies hibernate at no cost.
  - Roughly 10+ hours of 3-player online play fit in a day's free requests.
  - Pages hosting is free.
- **Workers Paid: $5/month**, only if traffic ever outgrows the free daily limits. When a free limit is hit, requests
  fail until 00:00 UTC, and the game shows "servers busy, try later".
- **Apple Developer Program: $99/year.** It's needed for TestFlight and the App Store (iPhone and the Mac App Store).
  It's not needed for the web or Windows versions.

## Code map

| Path | What |
|---|---|
| `shared/game.js` | simulation + rules engine (fixed 60 Hz, no rendering), multiple humans, bot takeover |
| `shared/ai.js`, `physics.js`, `movement.js`, `weather.js` | AI, disc flight + throw solver, athlete movement (also client prediction), wind & rain |
| `shared/config.js`, `tournament.js`, `protocol.js` | teams & settings, bracket logic, online wire format |
| `client/src/main.js` | renderer, camera, input, swipe throws, HUD, menus |
| `client/src/modes.js`, `net.js`, `touch.js`, `storage.js` | game modes & lobby, online client, touch controls, device storage |
| `client/src/athleteView.js`, `stadium.js`, `textures.js`, `post.js` | athlete models, stadium & crowd, procedural textures, pixel post-processing |
| `server/src/worker.js`, `room.js`, `server/wrangler.toml` | Worker API, room Durable Object, deploy config |
| `apps/tauri/` | Tauri v2 app (icons, store plugin, Apple entitlements/plists) |
| `tools/` | sims, Playwright tests, network tests, Windows build script |
