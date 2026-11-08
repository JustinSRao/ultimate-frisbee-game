# Claude Code prompt: Mac run (macOS + iOS builds, TestFlight)

> Paste everything below the line into Claude Code on the Mac (Apple Silicon or Intel), started in an empty folder
> (it will clone the repo), or inside an existing clone of `https://github.com/JustinSRao/ultimate-frisbee-game`.

---

You are continuing work on my game **WUL Ultimate** (repo `JustinSRao/ultimate-frisbee-game`) on my dad's **Mac**.
The Windows run already finished. What exists now:

- **Monorepo:**
  - `client/`: the Three.js game. `npm run build` produces `client/dist/index.html` and a copy at `dist/index.html`.
  - `shared/`: the simulation, AI, physics, protocol and tournament code, with no DOM.
  - `server/`: Cloudflare Worker plus SQLite-backed Durable Object rooms.
  - `apps/tauri/`: Tauri v2 shell.
  - `tools/`: tests.
- **Online server:** a free Cloudflare Workers plan, at the URL in `client/src/serverConfig.js` (`PROD_SERVER`). The web
  version is on Cloudflare Pages, and the privacy policy is at `<pages-url>/privacy.html`. Both URLs are in `README.md`.
- **Tauri app:**
  - Identity: bundle ID `com.justinsrao.ultimatefrisbee`, app name **WUL Ultimate**, category `SportsGame`.
  - `macOSPrivateApi` is off.
  - The settings store uses `tauri-plugin-store`.
- **Apple config already written (it just needs a Mac):**
  - `apps/tauri/src-tauri/Info.plist`: macOS keys (export compliance `ITSAppUsesNonExemptEncryption=false`, Sports Games category).
  - `apps/tauri/src-tauri/Entitlements.appstore.plist`: App Sandbox plus `network.client` only. `TEAM_ID` is a placeholder.
  - `apps/tauri/src-tauri/tauri.appstore.conf.json`: Mac App Store overlay (entitlements plus `embedded.provisionprofile`).
  - `apps/tauri/ios/Info.ios.plist`: iOS keys to merge (landscape only on iPhone, full screen, export compliance).
- **Tauri commands** are run from the **repo root** (for example `npx tauri build ...`). Its `beforeBuildCommand` is
  `npm run build`.

## Ground rules (read first, follow throughout)

1. **Browser control.** You may operate my browser (Claude in Chrome / your browser tools) for App Store Connect,
   the Apple Developer site and similar. If you don't have browser tools, give me exact click-by-click steps and wait.
2. **Passwords, Apple ID, 2FA, payments: STOP.** Whenever a page or dialog needs a password, an **Apple ID sign-in**,
   a 2-factor code, an email or phone verification, a CAPTCHA, or any payment or billing detail, stop. Tell me exactly
   which page or dialog and which field it is, and wait until I type **continue**. That includes Xcode → Settings →
   Accounts and the macOS keychain prompts. Never guess, store or echo passwords.
3. **Never pay.** The Apple Developer Program costs **$99/year**. That decision belongs to me and my dad. Never click
   *Enroll*, *Purchase* or *Renew*, and never enter card details. If enrollment is needed, STOP and ask.
4. **Stay free** otherwise. Cloudflare stays on the Workers Free plan. Don't enable anything billable.
5. **Secrets stay out of git.** That means provisioning profiles (`*.provisionprofile`, `*.mobileprovision`), `.p8`
   API keys, `.p12`/`.pem` certificates, `.env`, `.dev.vars` and the filled-in team ID if you prefer. Most of these are
   in `.gitignore` already, so check with `git status` before every commit.
6. **Git.**
   - Every commit is authored by **JustinSRao <nitsuji777@gmail.com>** only. Set this repo's local
     `user.name`/`user.email` to that before committing.
   - **No** `Co-Authored-By` or other attribution trailers, and no "Generated with" lines in commits or PR text.
   - Work on a branch `feat/apple`, commit in small logical steps, push regularly, and open a PR to `main` at the end.
7. **Verify, don't assume.** Check the current docs (Tauri v2 macOS/iOS distribution, Xcode, App Store Connect,
   TestFlight, `xcrun altool`/`notarytool`/Transporter) instead of relying on memory for flags. Run the tests after
   each milestone.
8. **Checkpoints.** At each ✅ below, post a short summary: what's done, what you verified, and what you need from me.

## Step 1: Mac toolchain

Check for these and install what's missing. Ask before anything that needs an admin password or a reboot, because
macOS will prompt for the password, and that's a STOP.

- **Xcode** from the Mac App Store, plus the Command Line Tools (`xcode-select --install`). Open Xcode once to accept the license (`sudo xcodebuild -license` needs the admin password, so STOP).
- **Homebrew**, if needed for anything below.
- **Node.js LTS** and git.
- **Rust** via rustup, plus the targets:
  `rustup target add aarch64-apple-darwin x86_64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios`
- **CocoaPods**, only if the current Tauri iOS docs say it's needed. Check first.
- **iOS Simulator runtime** (Xcode → Settings → Components).

Then:
```
git clone https://github.com/JustinSRao/ultimate-frisbee-game.git && cd ultimate-frisbee-game
git checkout main && git pull && git switch -c feat/apple
git config user.name JustinSRao && git config user.email nitsuji777@gmail.com
npm ci && npx playwright install chromium
```
✅ Checkpoint 1.

## Step 2: Confirm everything still works

- `npm run test:sim`, `npm run build`, `npm run test:browser`.
- `npm run test:net` (starts `wrangler dev` locally, then runs 3 headless clients).
- `node tools/net/nettest.mjs <worker URL from README>` (the same test against the live server).
- `npx tauri dev` (or `npx tauri build --debug --bundles app`): launch the Mac app, host a room, and check that a
  browser tab on the Pages URL can join it.

✅ Checkpoint 2.

## Step 3: Apple Developer Program (STOP and ask)

- Find out whether the Apple ID we'll use is already in the Apple Developer Program: developer.apple.com → Account
  (sign-in is a STOP).
- If it isn't enrolled, **STOP**. Tell me what it costs ($99/year), what it unlocks (TestFlight, the App Store, signing),
  and that a free Apple ID can still run the app on the Simulator and on our own iPhone for 7 days via Xcode. Wait for
  our decision. Never enroll or pay yourself.
- If it is enrolled, write down the **Team ID** (Membership details). Put it in `Entitlements.appstore.plist`
  (replace `TEAM_ID`). Ask me whether the team ID should be committed. It isn't secret, but ask anyway.

✅ Checkpoint 3.

## Step 4: App Store Connect setup (needs the paid membership)

1. **Bundle ID.** On developer.apple.com → Certificates, IDs & Profiles → Identifiers, register the explicit App ID
   `com.justinsrao.ultimatefrisbee` (no special capabilities needed).
2. **App record.** In App Store Connect → Apps → **+ New App**, create **WUL Ultimate**:
   - platforms **iOS** and **macOS** on the same record, so it's one universal purchase if App Store Connect offers it
     for this bundle ID
   - bundle ID as above, SKU `wul-ultimate`, primary language English
   - category **Games**, subcategory **Sports**
   - price **Free**
3. **Signing.** Use Xcode automatic signing: Xcode → Settings → Accounts → add the Apple ID (STOP for the sign-in
   and 2FA). Let Xcode create the certificates (Apple Development, Apple Distribution, Mac Installer Distribution) and
   profiles. For the Mac App Store build, download the **Mac App Store Connect** provisioning profile for this bundle ID.
   Save it as `apps/tauri/src-tauri/profiles/WUL_Ultimate_Mac_App_Store.provisionprofile`; it is gitignored, so never
   commit it.
4. **App Privacy (nutrition label):**
   - Data collected: **Identifiers → User ID** (the random player ID) and **User Content → Other** (the display name),
     both used for **App Functionality** only, **not linked to the user's identity**, and **not used for tracking**.
     If App Store Connect allows "Data Not Collected" because nothing leaves the device except to run the online match,
     discuss that with me first and pick the honest answer.
   - No tracking. No third-party SDKs. No ads.
5. **Privacy policy URL:** `<pages-url>/privacy`. Support URL: the Pages URL (the repo is private). Support email: justinsheshagirirao@gmail.com.
6. **Age rating questionnaire**, answered honestly:
   - The game is cartoon sports.
   - The "moon" emote counts as **"Cartoon or Fantasy Violence: None"** and **"Mature/Suggestive Themes: None"**, but
     **"Crude Humor: Infrequent/Mild"**. It's mild cartoon crude humour, a brief comic gesture with no nudity shown.
   - No gambling, no contests, no user-generated content shared beyond display names, no unrestricted web access.
   - Online multiplayer: rooms are joined only by sharing a private code, with no chat. Answer the communication
     questions accordingly.
7. **Export compliance.** The app uses only standard HTTPS/WSS encryption provided by the OS, which is exempt.
   `ITSAppUsesNonExemptEncryption=false` is set in the plists.

✅ Checkpoint 4.

## Step 5: Builds

### macOS (Mac App Store)

```
npx tauri build --bundles app --target universal-apple-darwin --config apps/tauri/src-tauri/tauri.appstore.conf.json
```

- Check the current Tauri docs for how signing identities are passed. It may be `APPLE_SIGNING_IDENTITY` or
  `bundle.macOS.signingIdentity`. Use the **Apple Distribution** identity for the app.
- Build the signed `.pkg` with the **Mac Installer Distribution** identity:
  `xcrun productbuild --sign "<3rd Party Mac Developer Installer / Mac Installer Distribution: …>" --component "apps/tauri/src-tauri/target/universal-apple-darwin/release/bundle/macos/WUL Ultimate.app" /Applications "WUL Ultimate.pkg"`
- Check that the sandbox is on: `codesign -d --entitlements - "…/WUL Ultimate.app"`.
- Test the sandboxed app: it launches, settings persist (the Tauri store), and it can host and join an online room.
  The sandbox must allow outgoing network.

### iOS

- `npx tauri ios init`, from the repo root, so it finds `apps/tauri/src-tauri`.
- Merge the keys from `apps/tauri/ios/Info.ios.plist` into `apps/tauri/src-tauri/gen/apple/<app>_iOS/Info.plist`, or
  use whatever plist-merge mechanism the current Tauri docs describe:
  - landscape-only on iPhone
  - `UIRequiresFullScreen`
  - status bar hidden
  - `ITSAppUsesNonExemptEncryption=false`
- Decide which parts of `gen/apple` to commit, per the Tauri docs. It is normally committed, but without signing secrets.
- In Xcode (`npx tauri ios build --open`), set the team and keep automatic signing. Check that the orientation boxes
  are only Landscape Left and Right.
- Run on the **iPhone Simulator** with `npx tauri ios dev` or a Simulator build. Check:
  - the touch joystick, buttons and swipe throws
  - safe areas around the notch
  - Low graphics by default
  - hosting and joining an online room
- If a real iPhone is connected, run on it too.
- App Store build: `npx tauri ios build --export-method app-store-connect`. The IPA lands under
  `apps/tauri/src-tauri/gen/apple/build/arm64/`.

✅ Checkpoint 5: the macOS `.pkg` and iOS `.ipa` are built and tested locally.

## Step 6: TestFlight

- **Upload** both builds. Use Apple's **Transporter** app, or `xcrun altool --upload-app --type macos|ios --file …`
  with an App Store Connect API key. Check the current docs, because `altool` upload options have changed over time.
  The API key `.p8` stays out of git, in `~/.appstoreconnect/private_keys/`. Creating the key in App Store Connect →
  Users and Access → Integrations is a browser action; STOP if it asks for a password.
- **Internal testing:** create a TestFlight internal testing group and add **me and my dad** as internal testers. They
  need to be App Store Connect users on the team; inviting someone sends an email, so ask me for the addresses and
  confirm before sending. Internal testing needs **no beta review**.
- Wait for processing (often 10–30 minutes). Confirm the builds show as available in TestFlight for both iOS and macOS,
  and answer the export-compliance prompt if it appears (exempt, standard encryption only).

✅ Checkpoint 6.

## Step 7: Cross-play smoke test (on the Mac)

In one online room at the same time:

- the **TestFlight Mac build**
- the **iPhone Simulator** build
- a **browser tab** on the Pages URL

Check that:

- all three see the same score
- bots fill the empty slots
- emotes and disc cam work on each
- disconnecting the browser tab hands that athlete to a bot, and rejoining within 60 s gives it back

✅ Checkpoint 7.

## Step 8: Final handoff: write `PLAYTEST.md`

Write `PLAYTEST.md` in the repo root: a checklist for our final manual co-op test across **iPhone (TestFlight),
Mac (TestFlight) and Windows (installer)**. Include:

1. **Install steps per device:**
   - iPhone: the TestFlight app → accept the invite → install.
   - Mac: TestFlight for Mac → install.
   - Windows: download the installer from the GitHub Actions artifact or the release. It's unsigned, so explain
     SmartScreen: **More info → Run anyway**.
2. **Create or join a room:** Custom Match → Online → **Host** (shows a 5-letter code), or Join with the code. Pick
   team and slot in the lobby. The host can lock settings and start.
3. **Bots fill empty slots:** check the lobby shows BOT in every empty slot, and that bots play in them.
4. **Scenarios:**
   - all 3 humans on one team
   - humans split across teams
   - disconnect and reconnect: turn off Wi-Fi or close the app for less than 60 s, then rejoin with the same code
     (you get your athlete back), and once for more than 60 s (the bot keeps it)
   - a co-op tournament run: Tournament → Online co-op → host → the friends join the code → everyone is on the host's
     team → play a round → the bracket updates for everyone
   - emotes (1–5 keys, or the emote buttons on touch) and disc cam (C, or the DISC CAM button) on each device
5. **How to report bugs:** a screenshot or screen recording, the **room code**, the **time** (with time zone), the
   device and OS, and what you expected versus what happened. Email them to justinsheshagirirao@gmail.com.

Commit, push, open the PR from `feat/apple` to `main`, and summarise:

- what's on TestFlight
- what's left, if anything (App Store review submission is a separate decision for us)
- costs: Apple $99/yr if enrolled. Cloudflare is still free.
