# Claude Code prompt — Windows setup run

> Paste everything below the line into Claude Code on the Windows PC, started inside a fresh clone of
> `https://github.com/JustinSRao/ultimate-frisbee-game`.

---

You are setting up and extending my game **WUL Ultimate Frisbee** (this repo) on my **Windows** PC. The repo is a
working single-player 3D browser game (Three.js, bundled by `node build.mjs` into the single file
`dist/index.html`). Read the code before changing anything:

- `src/game.js`: the simulation and rules engine (fixed 60 Hz step; no rendering).
- `src/ai.js`, `src/physics.js`, `src/movement.js`, `src/weather.js`: AI, disc aerodynamics and the throw solver, athlete movement, wind and rain.
- `src/main.js`: renderer, camera, input and swipe throwing, HUD, menus. `src/athleteView.js`: athlete models and animation. `src/stadium.js`: stadium and crowd.
- `src/config.js`: 16 teams, attributes and settings.
- `tools/sim/*.mjs`: headless simulation tests. `tools/browser-tests/*.cjs`: Playwright screenshot and input tests.

The simulation is already separate from rendering. Keep it that way, because the online server will run the same
`Game.step()`.

## Ground rules (read first, follow throughout)

1. **Browser control.** You may operate my browser (Claude in Chrome / your browser tools) to create accounts, get API
   tokens, and click through dashboards. If you don't have browser tools, give me exact click-by-click steps instead
   and wait.
2. **Passwords, 2FA, payments: STOP.** Whenever a page needs a password, a 2-factor code, an email or phone
   verification, a CAPTCHA, or any payment or billing detail, stop. Tell me exactly which page and field it is, and wait
   until I type **continue**. Never guess, store, or echo passwords. Never put secrets in the repo: use
   `wrangler secret`, `.dev.vars` (gitignored) or environment variables.
3. **Stay free.** Use only free tiers. Cloudflare must stay on the **Workers Free plan**. Do not upgrade, add a card, or
   enable anything billable. If something truly can't be done for free, stop and ask me.
4. **Git.** Work on a branch (`feat/crossplay`). Commit in small logical steps with clear messages, push regularly, and
   open a PR to `main` at the end. Never commit `node_modules`, build outputs other than `dist/index.html`, signing
   keys, provisioning profiles, `.env` or `.dev.vars`.
5. **Verify, don't assume.** After each milestone, run the tests (headless sims, Playwright, two-client network test)
   and fix what fails before moving on. Check current docs for Tauri v2, Wrangler and Cloudflare Durable Objects. Don't
   rely on memory for CLI flags.
6. **Checkpoints.** At each ✅ checkpoint below, post a short summary of what's done, what you verified, and anything
   you need from me.

## Step 0 — Toolchain on Windows

Check for these and install anything missing, preferring `winget` (ask me before anything needs admin or a reboot):

- Git
- Node.js LTS
- Rust (via `rustup`, MSVC toolchain)
- Microsoft C++ Build Tools ("Desktop development with C++")
- WebView2 runtime (usually already present)
- Playwright plus its Chromium

Then run `npm ci`, `npm run build` and the existing sims to confirm the game builds and runs before you change
anything.
✅ Checkpoint 0.

## Step 1 — Restructure into a small monorepo (keep everything working)

```
/client        the game (current src/, template.html, build) — builds to client/dist/index.html
/shared        code used by BOTH client and server: game.js, ai.js, physics.js, movement.js, weather.js, config.js
/server        Cloudflare Worker + Durable Objects (online rooms)
/apps/tauri    Tauri v2 shell (Windows + macOS + iOS) that loads the client build
/tools         tests (sims, Playwright, network tests)
```

- Make `/shared` pure ES modules with **no DOM / Three.js imports** so it runs on Cloudflare Workers.
- Keep a root `npm run build` that builds the client, and still publish a single-file `dist/index.html` playable in
  any browser.
- Add npm scripts: `dev:client`, `dev:server` (`wrangler dev`), `test:sim`, `test:browser`, `test:net`.

✅ Checkpoint 1: the game plays exactly as before.

## Step 2 — Game modes and menus

Replace the main-menu modes with these **three** (Practice, Athlete customization, Settings and Controls stay as
secondary buttons).

1. **Quick Match.** Exactly as today: one tap, instant match vs bots with the last-used settings.
2. **Custom Match** (replaces "Match vs Bots"). All the existing setup options (team size 2v2–7v7, duration, rules,
   difficulty, weather, pass assist, your team and opponent from the 16 teams), plus a **Play: Offline / Online**
   choice.
   - Online lets you **Host** (creates a 5-character room code) or **Join** (enter a code).
   - The lobby shows both rosters as slots. Each human picks a team and slot. The host can lock settings and start.
   - **Every empty slot on either team auto-fills with a bot** (same AI as now). If a human disconnects mid-match, a bot
     takes over their athlete immediately. If they reconnect within 60 s with the same player ID, they get it back.
3. **Tournament.** A **16-team single-elimination bracket** using all 16 teams in `config.js`: Round of 16 →
   Quarterfinals → Semifinals → Final.
   - The player picks their team. The bracket is seeded randomly (show the seeding).
   - Matches without a human are **simulated** with the real headless `Game` at accelerated speed. Fall back to a
     simple rating-based score model if that's too slow on phones. Show their results on the bracket.
   - The player's own matches are played normally. Default tournament format is short: 70 min / game to 13. Allow
     changing it.
   - Bracket screen with logos, scores, "Next match", and a champion screen with a trophy moment.
   - Progress saves locally so the tournament can be resumed.
   - **Online co-op tournament:** the host can open the tournament to friends. Humans join the host's team, bots fill
     the rest, and the bracket is synced by the server.

Keep all existing features: emotes (1–5), disc cam (C), double-tap-W sprint, Shift dive, swipe throws, over-the-shoulder
catches, mark blocks, weather, caps, 16 teams with away kits.

✅ Checkpoint 2: Playwright screenshots of the new menu, Custom Match lobby (offline), bracket.

## Step 3 — Online cross-play backend (Cloudflare, free plan)

Design: **server-authoritative rooms**, one Durable Object per match room.

- **Worker routes:**
  - `POST /api/rooms` creates a room and returns its code.
  - `GET /api/rooms/:code` returns room info.
  - `GET /api/rooms/:code/ws` upgrades to a WebSocket into that room's Durable Object.
- **Durable Object:**
  - Use a **SQLite-backed Durable Object class** (in `wrangler.toml` migrations use `new_sqlite_classes`). Verify in the
    current docs that this is what the Free plan requires.
  - Use the WebSocket Hibernation API (`ctx.acceptWebSocket`) so empty lobbies cost nothing.
  - While a match runs, step the shared `Game` at 60 Hz internally using an alarm-driven or timer loop. Read the docs
    on what blocks hibernation; that's fine during a live match.
- **Protocol:** JSON first, compact later if needed.
  - Client → server: `{t:'in', seq, mx, mz, sprint, jump, dive, call, aimYaw, faceYaw}` at 30 Hz, plus discrete events
    (swipe throw params, emote).
  - Server → clients: snapshots at 20 Hz (athlete pos/vel/facing/anim/throwAnim/emote, disc state, score, clock, state),
    plus event messages (callouts, sounds).
- **Client:**
  - Render remote athletes by interpolating ~100 ms behind.
  - Predict your own athlete locally from your inputs, and reconcile against acknowledged `seq` from server snapshots.
  - The disc and every rule decision come only from the server.
- **Free-plan budget:** keep inside the free daily limits (around 100k requests a day and 13k GB-s a day; confirm the
  current numbers).
  - Incoming WebSocket messages are billed at a reduced ratio, but still cap the input rate.
  - Close idle rooms after 5 minutes. Cap a room at 14 humans.
  - Show a friendly "servers busy, try later" message if the Worker errors.
- **Identity:** no passwords. A random player ID plus a display name stored on the device. Room codes are the only
  "matchmaking" for now. Optional later: a public "Quick Online" queue.
- **Deploy:**
  1. Create my free Cloudflare account through the browser, stopping for password and email verification.
  2. Run `wrangler login`.
  3. Deploy the Worker to the free `*.workers.dev` subdomain.
  4. Deploy the web client to **Cloudflare Pages** (free), so the game is also playable in any browser at a public URL.

  Put the server URL in a client config, not hard-coded in many places.
- **Privacy policy page** on Pages (needed for the App Store): no ads, no tracking, stores only a display name and a
  random ID.

**Tests:**
- `test:net` starts `wrangler dev`, opens 3 headless Playwright clients, joins one room, plays 60 s with scripted inputs,
  and asserts:
  - all clients see the same score and state
  - inputs move the right athletes
  - bots fill empty slots
  - a disconnect is taken over by a bot and reconnect restores control
- Also test once against the deployed workers.dev URL.

✅ Checkpoint 3: post the public Pages URL and a room code so I can try it in two browser tabs.

## Step 4 — Touch controls (iPhone / iPad) and adaptive UI

The game must be fully playable on a phone:
- Left-thumb virtual joystick to run, with double-tap or push-to-edge to sprint.
- Buttons for **Jump**, **Dive**, **Call (Q)**, **Disc cam**, and emote buttons during celebrations.
- Right side: drag to look. While holding the disc, **swipe to throw**; the existing swipe system maps naturally to
  touch. Add a BH/FH toggle button, or two-finger swipe = forehand.
- Respect safe areas and notches. Allow landscape only on phones. Use a reduced HUD and larger tap targets.
- Default graphics to **Low** on phones (crowd density, render scale).
- Test with Playwright's iPhone viewport emulation plus touch events.

✅ Checkpoint 4.

## Step 5 — Native apps with Tauri v2 (Windows, macOS, iOS)

- Create the Tauri v2 app in `/apps/tauri`, loading the built client. Bundle the font locally instead of loading Google
  Fonts. Replace `localStorage` with Tauri's store plugin, keeping a fallback for the web.
- Don't enable `macOSPrivateApi`, so the app stays Mac App Store compatible.
- Bundle ID `com.justinsrao.ultimatefrisbee` (ask me if I want a different one). App name **WUL Ultimate**. Generate
  icons from a simple original logo (a disc plus the WUL wordmark).
- **Windows (do it now):**
  - Build the **NSIS installer** and the `.msi`. Test that it installs, launches, and joins an online room against the
    deployed server.
  - The installer will be unsigned, so explain the SmartScreen "More info → Run anyway" step to me.
  - Optional, ask me first: Microsoft Store packaging later.
- **macOS + iOS (prepare only, can't build on Windows):**
  - Run `tauri ios init` / write all the config that doesn't need a Mac:
    - `tauri.appstore.conf.json` with App Sandbox entitlements: network client yes, everything else minimal
    - Info.plist keys
    - landscape orientation for iPhone
    - App Store category Games / Sports
    - export compliance: uses only standard HTTPS/WSS encryption
  - Document exactly what the Mac run must do.
- Add a GitHub Actions workflow that builds the Windows installer on every push to `main`, no secrets needed. Also add
  one for the web build plus deploy that uses a Cloudflare API token stored as a GitHub secret. Stop and let me paste
  the token myself.

✅ Checkpoint 5: Windows installer built and tested online.

## Step 6 — Write `prompt_for_mac.md` (the next Claude Code run, on my dad's Mac)

Create `prompt_for_mac.md` in the repo root: a complete, self-contained prompt for Claude Code running on a Mac
(Apple Silicon or Intel). It must use the same ground rules (browser control, STOP for passwords / 2FA / Apple ID /
payments, free tiers only, git branch + PR). It must cover:

1. **Mac toolchain:** Xcode (App Store) plus Command Line Tools, Rust with the iOS and macOS targets, Node, CocoaPods
   if Tauri needs it, Playwright.
2. Clone the repo, `npm ci`, run every test, and confirm the online server still works.
3. **Apple Developer Program:** check whether the Apple ID is already enrolled. Enrollment costs **$99/year**, and the
   decision belongs to me and my dad, so STOP and ask; never pay automatically.
4. **App Store Connect setup:**
   - register the Bundle ID
   - create the app record for **iOS and macOS** (one universal purchase if possible)
   - certificates and provisioning profiles via Xcode automatic signing, stopping for Apple ID sign-in and 2FA
   - privacy "nutrition label": no data collected except a display name, not linked to identity, no tracking
   - privacy policy URL (the Pages page)
   - age rating questionnaire, answered honestly; the "moon" emote is mild cartoon crude humour
5. **Builds:**
   - `tauri build` for macOS: universal binary, App Sandbox, signed `.pkg` for the Mac App Store
   - `tauri ios build` for an iPhone `.ipa`
   - test both locally: Mac app plus iPhone simulator, and a real iPhone if connected
6. **TestFlight:** upload the macOS and iOS builds (Transporter or `xcrun altool` / `notarytool` as appropriate; check
   current docs). Set up **internal testing**, with me and my dad as internal testers, so no beta review is needed.
   Wait for processing and confirm the builds are available.
7. **Cross-play smoke test** on the Mac: TestFlight Mac build plus the iPhone simulator plus a browser tab, all in one
   online room.
8. **Final handoff:** write `PLAYTEST.md`, a checklist for my final manual co-op test across **iPhone (TestFlight),
   Mac (TestFlight) and Windows (installer)**:
   - install steps per device
   - create or join a room
   - bots filling empty slots
   - the scenarios to try:
     - all 3 humans on one team
     - humans split across teams
     - disconnect and reconnect
     - a tournament co-op run
     - emotes and disc cam on each device
   - how to report bugs (screenshots plus room code plus time)

## Step 7 — Wrap up (Windows run)

- Make sure all tests pass. Push the branch, open the PR, and summarise:
  - the live web URL
  - the Worker URL
  - where the Windows installer is
  - what's left for the Mac run
  - current free-tier usage, from the Cloudflare dashboard
- Update `README.md` with: how to run locally, how to deploy, the architecture diagram (text), and the cost notes
  (Cloudflare free now, $5/mo Workers Paid only when traffic needs it, Apple $99/yr).

Start with Step 0. Remember: STOP for any password, verification code, or payment, tell me exactly where, and wait for
"continue".
