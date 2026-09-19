# Mission X

The whole MIHAS 2026 expo — three levels, 1,599 booths — live in the browser. Visitors play one five-chapter mission:
arrive, find the X (Booth **8H18B**) for a free digital business card, stamp five booths, swap cards, and claim a gift at
the real booth. Exhibitors bring their booth online, show its QR at the counter and collect the cards visitors leave.

**How it looks, on one page: [`docs/design-system.md`](docs/design-system.md)** — one palette (`src/theme.ts` + `src/ui.css`), what is in the world and what was removed, why it is sharp on phones, and the interface rules.

**The game on one page: [`docs/game-rules.md`](docs/game-rules.md).** That page is the source of truth for rules and
wording; the numbers are in `shared/rules.ts`.

> **19 Sep 2026 — simplified.** The M1–M4 build had ~25 invented terms, 17 player screens, 15 ways to earn XP and a
> six-factor stamp formula. It is now two roles (visitor, exhibitor), one mission, fixed points, plain trade-show words.
> The larger systems are switched off behind `FEATURES` in `shared/rules.ts` — still compiled and still tested — and
> their screens are gone; git tag `m4-full` is the last commit that has them. The "What M1 … M4 adds" sections
> further down describe those engines and use the old vocabulary (station = booth, Passport = card, Golden Ticket =
> prize code, dock = claimed at the booth, XP = points, Link-up = swap cards).
> Older design docs, kept for reference: [`docs/game-bible.md`](docs/game-bible.md), [`docs/game-systems.md`](docs/game-systems.md), [`docs/research-and-plan.md`](docs/research-and-plan.md).

## Run it

```bash
npm install
npm run dev
```

- Game: http://localhost:5173 · Crew console: http://localhost:5173/crew.html (dev PIN `2026`) · Big screen: http://localhost:5173/screen.html (sign in on the crew console first)
- Floor data: `npm run data:all` re-fetches the official exhibitor list, re-reads Levels 1 and 3 from the PDF and rebuilds `public/data/floor.json`.
- To play from a phone on the same Wi-Fi use the "Network" URL Vite prints, and start with `PUBLIC_ORIGIN=http://<that-ip>:5173` so QR codes point at it.

```bash
npm test          # server journey tests + the demo world (node:test)
npm run typecheck
npm run build     # typechecks, bundles to dist/ (floor data is committed; rebuild it with npm run data / data:all)
```

## Demo mode — the whole game with no backend

Deploy this repository to Vercel **without any environment variables** (or host `dist/` anywhere static) and the site
runs as a self-contained demo of everything up to M4. Nothing to configure:

- The pages ask `/api/healthz` first. A configured backend answers `live`. Anything else → they start the **demo backend**:
  the *real* server (`server/app.ts` and every service, unchanged) running inside a service worker on SQLite compiled to
  WebAssembly (`src/demo/sw.ts`). The game, `/crew.html` and `/screen.html` in the same browser share that one world, and
  it is kept in IndexedDB, so reloads and new tabs carry on where you were.
- The world is populated (`src/demo/sim.ts`): ~39 simulated exhibitors and visitors with a few hours of history —
  booths online, stamps, cards left and swapped, a booth of the day, one player flagged for review — and they keep walking the decks and stamping while you play. All of it
  goes through the same services a real player uses, so XP, the ledger, boards and trust stay consistent.
- **Demo guide** (pink chip in the HUD) walks the visitor mission, the exhibitor steps and the crew tools, with ticks
  that fill in as you go. Pink "Demo" boxes inside the normal screens stand in for what one person at a desk cannot be:
  the code on an exhibitor's screen, a booth's printed QR, a person to swap cards with (both directions), visitors for
  the booth you bring online, our crew's scan of your prize code — and **Reset the demo**.
- Crew console PIN in the demo: `2026` (shown on its sign-in screen). Mission Control needs that sign-in first.
- When you later add the Turso variables (next section) and redeploy, `/api/healthz` answers `live`, the pages unregister
  the demo worker and the site is the real thing. Force either mode with `?demo=1` / `?demo=0` (remembered per browser)
  or build with `VITE_DEMO=1` / `0`.

Try exactly what Vercel will serve, locally: `npm run demo` → http://localhost:4173 (static files, no API).
In `npm run dev` the real local API is used; add `?demo=1` to switch that browser to the demo backend.

What a demo cannot show, by nature: each browser is its own world (two phones do not meet each other), QR codes opened on
another device land in *that* device's world, and the camera scanner, GPS gate and step tracking need a real phone and
the real backend. The demo world is test data in your browser — nothing is sent anywhere, no leads are collected.

## Deploy to Vercel

Vercel runs the API as serverless functions: **no disk and no shared memory.** So in production the database is
[Turso](https://turso.tech) (hosted SQLite — the same SQL the local build uses, no rewrite) and "who is where" lives in the
database too (`DbPresence`) instead of in memory. Local development is unchanged: a SQLite file and in-memory presence.

1. **Create the database.** Sign up at turso.tech → create a database in the **Singapore** region (closest to KL and to
   the function region set in `vercel.json`) → copy its URL (`libsql://…`) and create an auth token. The free tier is
   enough to test. You do not need to create tables: the app runs its idempotent schema script on first start.
2. **Import the repo in Vercel** (Add New → Project → this repository). The framework, build command, output directory,
   function, rewrites and region all come from `vercel.json` — leave the defaults.
3. **Add environment variables** (Project → Settings → Environment Variables; see `.env.example`):

   | Name | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | `libsql://<your-db>.turso.io` |
   | `TURSO_AUTH_TOKEN` | the token from step 1 |
   | `MX_SECRET` | 32+ random characters. Signs sessions, Golden Tickets, beacon QRs and host codes — changing it later logs everyone out and invalidates printed beacons |
   | `CREW_PIN` | what booth staff type into `/crew.html` — not `2026` |

   `PUBLIC_ORIGIN` is only needed with a custom domain; otherwise QR codes use Vercel's own URL (production domain in
   production, the deployment's URL in previews).
4. **Deploy.** While any of the four variables is missing the site runs in **demo mode** (above); `/api/healthz` lists
   which ones are missing. Add them and redeploy: the demo switches itself off.
5. **Smoke test:** open the site on a phone → Launch → "Take me there" → claim a Passport → open `/crew.html` on another
   device, sign in with the PIN, type the 6-character ticket code → the phone should flip to *Docked* within ~4 s.
   Then `/screen.html` on the crew device for Mission Control.

### How it is wired

- `api/index.ts` is the one Vercel Function. `vercel.json` rewrites `/api/*` and `/p/*` (public card pages) to it; it
  hands the request to the same Hono app the local server uses (`server/app.ts`), built by `server/vercel.ts`.
- Everything the function imports (`server/`, `shared/`, `api/`) uses explicit `.js` import specifiers — Vercel compiles
  TypeScript file by file for Node ESM, which does not resolve extensionless paths. Keep that convention in those folders.
- `public/data/floor.json` is shipped to the browser as a static file **and** bundled into the function (`includeFiles`).
- The test suite runs in the serverless configuration too:
  `MX_TEST_DB=libsql MX_TEST_PRESENCE=db npm test` (bash) — all 18 tests pass on node:sqlite, on libSQL, and on libSQL
  with database-backed presence.

### What changed to make it serverless-safe

In-memory state that would be wrong when requests land on different instances was moved or bounded: presence → database;
"first time in this hall / at this landmark today" → confirmed against the database before XP is paid; deck walking →
metres and XP reconciled in the database every 25 m; sector ticks → settled exactly once (a second instance's batch hits
the primary key and rolls back, so nobody is paid twice); bans, avatar looks, a player's active mission → short TTL
caches. Rate limits are still per instance — put Vercel Firewall / WAF rules in front for real traffic.

### Known limits of this deployment shape

- **Not verified on Vercel from here** — no Vercel or Turso account was available while building. Verified instead: the
  compiled function loads under plain Node ESM, its configuration errors are readable, and the whole game passes its
  tests through the libSQL adapter with database presence. Expect the first deploy to need a look at the function logs.
- Each presence ping is ~5 small database round trips (every 2 s per active player). Fine for testing and a modest crowd
  in the same region; for thousands of concurrent players move presence to Redis/Upstash or a Cloudflare Durable Object.
- Turso's free tier has monthly row-read/row-write quotas; watch them if you point ads at the test deployment.
- A single-server deployment (any VM, Fly, Render, Railway: `npm run build && npm start` with `DB_FILE` on a volume)
  remains supported and is cheaper per request; Vercel is the convenient way to get real phones on it today.

## Single-server production mode

Serves `dist/` and the API from one process:

```bash
NODE_ENV=production MX_SECRET=<long-random> CREW_PIN=<pin> PUBLIC_ORIGIN=https://<domain> PORT=8080 npm start
```

The server refuses to boot in production without `MX_SECRET` and `CREW_PIN`. It must sit behind HTTPS (cookies are `Secure`).

## What M1 contains

| Piece | Where |
|---|---|
| Floor data pipeline: raw plan extraction → `public/data/level2.json` (381 booths, 85 phantoms removed, landmarks, gates, walls) | `tools/build-floor.mjs` |
| Game rules — XP table, stamp formula, ranks and gates. **One file, shared by server and client** | `shared/rules.ts` |
| API (Hono): guest session, suit-up, presence, stamps, Passport, Golden Ticket, leaderboard, crew endpoints, public card page + vCard | `server/` |
| Append-only XP ledger, SQLite schema (same SQL runs on node:sqlite, Turso/libSQL and Cloudflare D1) | `server/db/schema.ts` |
| 3D world: instanced booths, one-draw-call roof signs, landmarks, the Launch Pad, space environment | `src/game/world.ts` |
| Movement, collision, A* pathfinding, guide trail, camera, holograms, adaptive resolution | `src/game/engine.ts`, `nav.ts`, `input.ts` |
| UI: suit-up, HUD, Passport form with PDPA consents, Golden Ticket QR, docked screen, leaderboard | `src/ui/App.tsx` |
| Crew console: PIN sign-in, ticket scan (camera or 6-char code), leads + CSV, printable station beacons | `src/crew.tsx` |

## What M2 adds

| Piece | Where |
|---|---|
| **Station Command** — an exhibitor with a Passport claims their booth ("bring it online"): company name on the roof sign, brand colour, light column, offer + link. Claims start `pending`; the crew console approves, revokes or releases them | `server/stations.ts`, `StationSheet` / `ClaimSheet` in `src/ui/sheets.tsx` |
| **Rotating host code** — QR + 6 digits, new every 30 s, stateless HMAC. A visitor who scans it gets an on-site stamp at full trust **and** a Verified Contact (+60). Keeping the host screen open is the "host is here" heartbeat | `Game.hostCode`, `Stations.hostCode`, `HostSheet` |
| **Passport sharing → lead list** — after stamping a claimed station the visitor picks exactly which fields to share; the host sees only those fields, flagged verified or not, with CSV export. Revocable. Every share is a row in `card_shares` (the consent record) | `Stations.share / leads`, `server/db/schema.sql` |
| **Link-up** — show a one-use 8-character code / QR, the other person scans or types it, sees your callsign and *which fields* you offer (no personal data yet), chooses their own fields, and both Passports land in each Contact Log. +50 XP each, 30 a day at full value | `server/social.ts`, `LinkSheet` |
| **Contact Log** — people and stations, WhatsApp / email / save-contact (vCard), private notes, take-back | `Social.contacts`, `ContactsSheet` |
| **Avatar creator** — 9 slots from a shared catalog; rank-locked and later-reward options shown locked with the reason; server validates every spec; other players see your look | `shared/avatar.ts`, `src/game/astronaut.ts`, `AvatarSheet` |
| **Crews + sector control** — class = crew. Influence from stamps, verified contacts, cross-crew Links; decayed (τ = 45 min), underdog-normalised by √active members; settled every 30 min, lazily and idempotently (no timer — ports to Workers). Holding crew's active members get +40 XP; the hall floor glows in their colour | `server/crews.ts`, `CrewsSheet`, `World.setSectors` |
| **Find** — search any booth number or exhibitor and the trail leads there | `FindSheet`, `guideTarget` in `src/state.ts` |
| One scan handler for every code the game prints (host, beacon, Link), from the in-game camera or from a URL opened by the phone camera app | `src/scan.ts` |

### M2 security and privacy notes

- A Link "peek" returns callsign, class, rank and the *names* of the fields on offer — never the values. Values move only after the scanner confirms.
- Hosts can read leads only for stations they own; visitors cannot read any lead list. Revoked shares disappear from the host list immediately (a CSV already exported is beyond reach — the UI says so).
- Station text is stripped of control characters and angle brackets; links must parse as http(s).
- Host codes accept the current window plus four older ones (2 min) so a code scanned with the phone camera survives the game booting.
- Until the venue geofence lands (M3), a host-code scan is trusted as on-site. A colluding exhibitor could read their code out to a remote player; the ledger records `geofence: "unchecked"` so those rows can be reviewed or voided.

## What M3 adds

| Piece | Where |
|---|---|
| **Venue gate** — one browser location fix → the server answers "at MITEC: yes/no" (3.17811 N, 101.66864 E, 400 m; override with `VENUE_LAT` / `VENUE_LON` / `VENUE_RADIUS_M`). Only the verdict, distance and accuracy are stored — never coordinates. Good for 30 min | `server/venue.ts`, `checkInAtVenue` in `src/ui/m3sheets.tsx` |
| **What a scan is worth now** — a printed beacon counts as on-site only with a good venue check (otherwise it pays the remote rate, with a hint). A host's live code is on-site by itself. Every on-site proof **anchors** the player at that station | `Game.stamp`, `Venue.anchor` |
| **On deck** — after an on-site scan the avatar stands where the person stands: joystick off, green banner, "Free roam" to leave. Others see real people solid (remote visitors stay holograms), snapped to a 1.5 m lattice. Goes stale after 10 min or ±12 m | `Engine.enterDeck / leaveDeck`, `PresenceStore` |
| **Step tracking (beta, behind a menu switch)** — accelerometer step detector + compass snapped to the four aisle directions, map-matched by the nav grid; step length self-calibrates between two scans; one-tap compass calibration at the Launch Pad. Server holds deck movement to 2.8 m/s and pays 1 XP per 10 m (cap 300/day) | `src/game/pdr.ts` (+ tests), `Engine.setStepTracking`, `Venue.walk` |
| **Invisible mode** — omitted from everyone's map, still earns XP | `Venue.setHidden` |
| **Mission Director** — three offers of different kinds, scored by proximity (60–250 m sweet spot), novelty, quiet zones, online/hosted partners, minus repeats. Survey Run, Supply Run, First Contact (on-site only), Cartographer's Request, Dark Sector (tells exhibitors someone came looking). One active at a time; walked remotely they pay 15 % | `server/director.ts`, `MissionsSheet` |
| **Signal Storms** — the quietest hall-half pays ×2 on stamps for 15 min, then a 10 min gap; lazy and deterministic; glows on the floor | `Director.storm`, `World.setStorm` |
| **Ground Control co-op** — role follows reality (on site = Astronaut, remote = Ground). Ground alone sees the target and drops floor markers (last 5 kept, no chat); only an on-site scan by the Astronaut completes it; both get the full 150 XP | `server/gc.ts`, `GcSheet`, `World.setGc` |
| **Official exhibitor names** — `tools/fetch-exhibitors.mjs` snapshots the organiser's public list (337 companies → 647 booths, with sector). Level 2 went from 41 to 128 named booths | `tools/data/exhibitors.json`, `tools/names.mjs` |
| **Level 1 and Level 3 datasets** — rebuilt from the PDF text layer with pdf.js: 702 booths (matches the plan's own 236/232/234 unit counts) and 516 booths, plus areas, lifts, escalators and entrances. Method cross-checked on Level 2: 0.20 m median, 0.35 m p95 | `tools/build-decks.mjs`, `public/data/level1.json`, `level3.json` |

### M3 status, plainly

- Levels 1 and 3 became playable in M4 (see below).
- **Step tracking has never touched a real phone.** The detector passes synthetic walks at 30/60/100 Hz; real hands, pockets, MITEC's steel and crowds are untested. The building-axis bearing defaults to 0 until calibrated on site.
- **Data caveat found while calibrating:** the Level 2 page is drawn ~9 % taller than wide (booth rows 3.27 m apart where Levels 1 and 3 give 3.00 m). North–south distances on Level 2 are therefore ~9 % long. Harmless for remote play; for step tracking the self-calibration absorbs most of it. Worth correcting when the decks are unified.
- GPS is a client-supplied claim and can be spoofed; by design it only gates printed beacons and deck mode, and is one quarter of the planned trust score. Host codes remain the strong proof.

## What M4 adds

| Piece | Where |
|---|---|
| **All three levels are playable** — 1,599 booths on three decks (Level 1: 702, Level 2: 381, Level 3: 516), 9 halls, 627 booths with official exhibitor names and sectors. One plan coordinate space: Levels 1 and 3 are shifted 45 m south / north of Level 2, so distance checks, presence, pathfinding, missions and storms needed no notion of "floor". In 3D they are three platforms of the station | `tools/build-floor.mjs` → `public/data/floor.json`, `World.platforms` |
| **Lifts as portals** — the two lifts that stand between the halls on every level (positions read from the plan's LIFT labels). Stepping on one offers the other decks; a lift ride is the only jump the server accepts besides a spawn. A goal on another deck routes the trail to the nearest lift first ("Take the west lift to Level 1") | `Engine.useLift / goal`, `Game.ping` |
| Halls, sectors, the Director and storms are data-driven from `floor.json` (`decks`, `halls`, `lifts`); offers stay on the deck you are on; storms skip zones with no booths | `server/director.ts`, `server/crews.ts` |
| **Trust score** (Systems §9) — venue check-in today 0.25 · host code today 0.30 · no impossible jumps 0.20 · steps match the map 0.15 · docked 0.10. ≥ 0.70 = prize-eligible. Remote-only play tops out at 0.45 by design. Rejected moves are logged as flags; deck pings carry step counts | `server/liveops.ts` |
| **Boards** — Today, All time, Explorers, Connectors, Stations (Station XP), Companies; ✓ marks trusted players / verified exhibitors; each player sees their own trust breakdown | `BoardsSheet` in `src/ui/m4sheets.tsx` |
| **Crew review tools** — top 20 of any board with trust parts, flag count and where the XP came from; drill into a ledger, **void / restore** single rows (the cached total follows), put an account **under review** (read-only for them, off every board) | Review tab, `src/crew-ops.tsx` |
| **Company teams** — any Passport holder starts a team (defaults to their company), colleagues join with an 8-character code, score = five best members; ✓ if the founder hosts an approved station | `TeamSheet`, `LiveOps.team*` |
| **Kill switches** — New Passports, Station claims, Link-up, Accepting missions, Ground Control, Showing other players; flipped from the crew console, live within 5 s, players see "paused for a moment" | Ops tab, `LiveOps.flags` |
| **Daily Drop** — crew picks a booth, title and bonus for today; pays once, and only for an on-site proof at that booth | Ops tab, Missions sheet |
| **Mission Control** (`/screen.html`) — the booth's big screen: slow fly-over cycling the decks, every player a dot in crew colour (green ring = really on the floor), today's board, sector control, totals, storm / drop ticker, QR to join. Crew sign-in required; the feed carries positions and totals, never names or callsigns | `src/screen.tsx`, `GET /api/crew/screen` |

### M4 status, plainly

- **Not built from the M4 list:** ad-hoc squads (2–5 players), squad Rendezvous missions and the Flare; Signal (⚡) still cannot be spent. Company teams cover the "play with colleagues" need; squads were cut for time.
- Levels 1 and 3 have **no wall or door geometry** — the walkable area is the hall rectangle plus a front concourse, entrances are markers. Level 1's lounges east of the halls and back-of-house areas on the PDF are left out. Lift positions are label positions, good to a metre or two.
- The decks are separate frames: Level 2's north–south stretch (~9 %) is still uncorrected, and decks are not aligned vertically with each other. Neither matters for play; both matter if the map is ever used for precise indoor positioning across floors.
- Team names are free text and unverified unless the founder's station is approved — the crew should glance at the Companies board before announcing anything.
- Mission Control was checked in a small browser pane, not on a TV: confirm legibility at booth distance on the real screen.

## Security model (M1)

- Player identity = HMAC-signed HttpOnly cookie; a tampered cookie yields a fresh guest, never another account.
- The server is authoritative: clients *request* stamps; the server checks distance against the position **it** last saw, rejects implausible speed, enforces cooldowns and duplicates, and computes XP.
- Golden Tickets are signed, single-use, and expire. Beacon codes are HMAC-signed per station.
- Crew routes need the PIN cookie; login is rate-limited. CSV export neutralises spreadsheet formulas.
- Personal data never reaches other players — they see callsign, class, rank, position only.

## Verified vs not yet verified

**Verified on this machine (the living world, 19 Sep):** 24 tests — new: a pose travels to nearby players and anything else is dropped, on both presence stores; every area of the floor plan becomes a place on all three levels with its furniture inside its footprint, a free seat or a standable photo mark; every open place is reachable from the entrance; the X, entrances and lifts stay clear; the facts are counted from the data. Browser run on the static build: furnished places with the seated crowd, arrival at the MIHAS Corner stage → "Sit and watch" → seated next to a cast member, facts rotating, stand up; expression tray at phone size; photo (after fixing a camera placed behind a stage wall) with caption band; map sheet with three levels, places list and tap-to-go; M shortcut. **Not verified:** the lift ride and Levels 1 and 3 on foot, the Photo Booth wall itself (the test browser throttled animation to under one frame a second, so long walks could not be completed), sharing via the phone's share sheet, and everything on a real phone.

**Verified on this machine (visual pass, 19 Sep):** 20 tests; browser run of the static build at phone size (375×812, 2× pixel density) and desktop: first screen with the X framed above the sheet, fly-in, objective card, thumb dock, bottom sheets, trail, tap ring, booth-name labels without overlaps, stamped roofs, online booths and counter markers, people in role jackets, zoomed-out view of Level 2, crew sign-in page in the new theme. No console errors. **Not verified:** a real phone's GPU (the sharpness changes are chosen for it — antialiasing on, real pixel density — but frame rate on low-end Android is unmeasured), the big screen page and lifts after the restyle.

**Verified on this machine (simplified game, 19 Sep):** 20 tests. Two new journey tests drive the whole visitor mission (names, fixed points, chapter order, the board line, switched-off systems answering "off") and the three exhibitor steps through the HTTP API; the M2–M4 engine tests run with their features switched on and the new numbers; the demo-world test runs the simplified cast. Browser run on the static no-backend build: two-door start → Chapter 2 HUD with five dots → autopilot → card (+200, name becomes "Demo T.") → prize code → stamps at +10 → real-booth scan at a simulated exhibitor (+50, "met in person", +150 booth of the day) → leave card (+10) → simulated crew scan → the ending → menu (5 items) → "I am exhibiting" → find booth → online → My booth with QR, visits and leads. Not re-verified in the browser after this change: the crew console and big screen pages (their API is covered by tests), and lifts.

**Verified on this machine (demo mode):** 19 tests — the new one seeds the demo world on the same WebAssembly SQLite and drives it through the real HTTP app (cookie seam, presence + holograms, docking, crew login / leads / stations / beacons / Mission Control feed, simulated venue check-in, host code → stamp + Verified Contact + Daily Drop, Link-up both ways, claim → visitor → lead, a full Ground Control run, XP cache == ledger). Browser run of the **production build served as static files with no API** (`npm run demo`): first visit installs the worker and builds the world (~1 s), suit up, autopilot, Passport, simulated crew scan → Docked, host code at a cast-hosted station (+40 / +60 / +150 Daily Drop), Link-up in both directions, Ground Control with a cast astronaut walking to the marker → "Target reached", public card page and vCard served by the worker, world and session intact after reload, worker upgrade with a world-version bump. **Not done in the browser:** signing in to the crew console / Mission Control (covered by the test above through the same API, not clicked through), and any deployment on Vercel itself.

**Verified on this machine (M4):** 18 tests (adds: lift rides vs refused jumps, Level 1 stamping with official names, nine-hall sector view, deck-local offers; trust arithmetic, flags, void/restore, review lockout; teams, kill switches, Daily Drop, big-screen feed carries no identities); browser run of Find → FGV Holdings on Level 1 → trail to the west lift → ride → Hall 4, the Boards sheet with the trust panel, team creation with invite code, the crew Review tab on live data, and the Mission Control screen.

**Verified on this machine (M3):** 15 tests (9 server journeys incl. venue gate, deck speed limit, walk XP, invisibility, Director offers/progress/storm, Ground Control; 6 step-tracking unit tests on synthetic sensor data); browser run of the Missions sheet with a live Signal Storm, accepting a mission, a host-code scan putting the avatar on deck with the green banner, and a full Ground Control run against a simulated remote partner (pairing, markers arriving, completion, +150 XP each). Levels 1 and 3 datasets plotted and compared with the plan images.

**Verified on this machine (M2):** 6 server tests (hosts + codes + leads + moderation, Link-up consent, avatar locks, sector ticks); browser run of avatar editor, Find + guide, claim → host screen with rotating code, a simulated visitor scanning the code → verified lead appears with only the consented fields, Link-up by typed code → Contact Log, Crews panel, online-station beam in the world. First load ≈ 180 KB gzipped.

**Verified on this machine (M1):** server journey tests; full browser run (spawn → autopilot → landmarks/hall XP → Passport with consent guard → Golden Ticket → crew lookup by code → docking → player screen flips to Docked → stamp → roof turns yellow → leaderboard); second player appearing as a hologram; production build (first load ≈ 170 KB gzipped) and production boot guard.

**Not verified — needs a real device:** touch joystick and pinch zoom; camera QR scanning (crew console, host codes, Link codes — typed codes are verified); behaviour inside Instagram / Facebook / TikTok in-app browsers; frame rate on a mid-range Android.

## Known gaps (by design, next milestones)

- **nexova card generation is a stand-in.** `/p/:slug` is served by this app. Swap `server/passport-page.ts` for the nexova API when it exists.
- Presence is in-memory on a single server and database-backed on Vercel (see *Deploy to Vercel*). `server/db/d1.ts` (Cloudflare) is written but **untested**.
- No 2D Lite fallback yet — a browser without WebGL gets a clear error screen.
- Game UI is English only; the privacy notice (`public/privacy.html`) is an **unreviewed draft** in EN + BM with bracketed placeholders.
- Analytics events are stored in the `events` table only; ad pixels / Conversions API not wired.
- Signal (⚡) accrues but cannot be spent yet (Ping / Boost arrive with the Mission Director). Squads, company board and constellations are M3–M4.
- The dev database may contain a test claim on booth 8H16 ("Demo Trading") — release it from the crew console → Stations.
- Astronauts are primitive shapes; rigged characters, sound, Levels 1 and 3 come later.
- Only 41 of 381 booths carry exhibitor names — the rest show booth numbers until the full official list is joined in.
