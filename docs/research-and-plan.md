# MIHAS 2026 Expo Quest — Research, Game Proposal & Execution Plan

Prepared 18 Sep 2026 for Lean X Digital (representing Leanis, Level 2, MITEC).
Status: **plan only — nothing built.**

Legend: **[V]** verified on a primary/trade-press page · **[S]** search-snippet only, re-verify before quoting · **[E]** my estimate.

---

## 0. Read this first — four facts that shape everything

1. **MIHAS 2026 is 23–26 September 2026. Today is 18 September. You have 5 days.** [V — your own floor plan PDF and mihas.com.my/visitor/admission]. Trade days 23–25 Sep (10:00–18:00, business attire, no under-18s); public day Sat 26 Sep.
   A Coastal-World-class game took a specialist studio **6 months**. A "global production level" 3-floor digital twin with multiplayer is not achievable, tested and stable, by Wednesday. What **is** achievable is a tightly scoped, polished v1 — and the 5-day story becomes your pitch: *"an AI-native team built the expo as a game in 5 days."* The plan below is built on that.
2. **"Leanis" is not on the V226 floor plan** (checked the PDF text layer, all CSVs/JSONs, all 3 levels) **and not on the official exhibitor list** (337 of 337 entries parsed; also no "Lean X", "LeanX", "Nexova"). The official list is clearly incomplete (337 companies vs 1,700+ booths; pavilion sub-exhibitors hidden), so this is not alarming — but **I need your booth number** (e.g. `7C17`). Everything in the game points at it.
3. **No official MIHAS floor plan, native app, or game exists publicly.** The official site publishes no floor plan; the portals (register.mihas.com.my, exhibitor.mihas.com.my) are AI-matching web apps, not wayfinders. A searchable 3D floor map is therefore **real utility**, not just a game — that is the hook that makes exhibitors and visitors actually use it.
4. **No precedent found in Malaysia/SEA** for a gamified, accurate digital twin of a trade-show floor. MIHAS's own 2021 virtual edition was a conventional booth directory. This is open ground.

---

## 1. What I found in your files

| File set | Coverage | Quality |
|---|---|---|
| Level 2 (Halls 5–8) CSV/JSON | 466 booths, metres, vector-derived | **Good.** Name labels are noisy (rotated text reversed: `egarotS mooR` = "Storage Room"; letter-spaced fragments). |
| Level 1 CSV/JSON | 570 booth IDs, **Halls 2–4 only — Hall 1 missing** | Booth coords good; label CSV polluted by fire-safety symbols (`HR FR`, `FB FA`). |
| Level 3 (Halls 9–11) | **Only 56 of ~420 booths**, OCR-based, confidence 40–90% | **Not usable as-is.** |
| Master PDF `Floor Plan V226.pdf` | 3 pages, has a real text layer (`pdftotext` finds 438 / 324 / 423 unique booth IDs on pages 1/2/3) | **This is the source of truth.** Re-extract from it. |

**Action:** rebuild the dataset from the PDF text layer (`pdftotext -bbox` or pdf.js in Node — no Python on this machine), then join to the official exhibitor list by booth number to get clean names + sectors. Half a day of work.

Useful landmarks already in the Level 2 data for quest design: Hall 5 entrance/registration + INSP, Hall 6/7/8 entrances, MIHAS Café & Visitor Lounge (110 m × 11 m), Wellness Corner, MIHAS Kitchen, MIHAS Corner stage, Media Center, Photo Booth, Live Box, "Ask Me!" info points, SME Banks cluster, country pavilions (KOTRA, JETRO, Indonesia, Bangladesh, Pakistan, DTI Philippines).

---

## 2. MIHAS 2026 fact sheet

- 22nd edition · MITEC, Kuala Lumpur · hosted by MITI, organised by MATRADE, with HDC and JAKIM [V].
- **Event manager is now ES Exhibition Services Sdn Bhd** (enquiry@mihas.com.my, +603 5020 7455), not Qube [V for contact; 2026–2030 term is S].
- Theme: **"Shaping Trust, Driving Resilience"** — pillars include AI business matching [V]. Your "AI-native digital" positioning fits the official narrative.
- 2025 results: RM6.05b sales, 50,340 trade visitors, 107 countries, 2,400 booths [V/S]. 2026 official targets: 1,700+ booths, 40,000 trade visitors, RM4.3–4.5b [V].
- Official list: 337 exhibitors; fields = name, sector, booth no. only. Biggest sectors: F&B 138, Services & Enablers 80, Food Tech & Packaging 31, Halal Ingredients 23, Pharma 17, Cosmetics 13 [V].
- Hall character (my tally of the list): Hall 3 = Malaysian F&B core (123 listings); Hall 4 = F&B + services/tech; Hall 2 = packaging + China groups; Halls 6–7 = international + country pavilions + Islamic finance; Hall 8 = pharma; Level 3 = agencies, state pavilions, Saudi/Moscow, Modest Fashion, Main Stage.
- Public context on you: Leanis Solutions Sdn Bhd (fintech software house, 2009); Lean.x / leanx.io ("unified payment platform, product by Leanis"); nexova.my (paste a Shopee/TikTok Shop link → live store; landing-page builder, 70+ templates, Lean.x payments, managed ads/SEO; Free / RM79 / RM1,500 / RM3,000 tiers) [V].

**Brand/legal unknown:** no public rule on exhibitors using the MIHAS name/logo. The exhibitor manual (inside your exhibitor portal login) is where it will be. Check it today — also for any "no canvassing outside your own booth" clause, which affects the floor-team tactic in §7.

---

## 3. References (what to steal from whom)

### 3.1 The five that matter most

| # | Reference | Why it matters to you | Proof |
|---|---|---|---|
| 1 | **Coastal World** — Merci-Michel for Coastal Community Bank, 2022. coastalworld.merci-michel.com | The closest precedent: a **B2B fintech** brand built a browser 3D world with NPCs, quests, coins, avatars. **Portrait, one-thumb mobile play.** Three.js + Blender. FPS-driven quality tiers from "ultra" to "very-low". | 6–8 min average sessions; Awwwards Site of the Month, CSSDA Site of the Year [V]. Took 6 months. |
| 2 | **Google I/O Adventure** — 2021–22 | A **real venue (Shoreline) rebuilt as a game world** for a conference: avatars, product booths, 119 collectible swag items, profile badges, stayed open ~1 month after. Notably it was **2.5D (PixiJS), not 3D** — charm beat fidelity. | Architecture published by Google Cloud [V]. |
| 3 | **Tokyo Game Show VR 2021–23** — ambr × Dentsu | "The trade show becomes a game": quest system + **Stamp Rally Quest** across exhibitor booths. | ~210k → ~400k visitors; VR Marketing of the Year [S/V]. |
| 4 | **Goosechase × PwC Canada** and **Teradata "TAU Hunt"** (EXHIBITOR Magazine) | The most credible numbers for **physical** show gamification: exhibitor-gated codes, leaderboard in the foyer, prize for ≥50% completion. | ~90% of players visited booths [V]; 92% app usage, **1:1 meetings +450%** [V]. |
| 5 | **Bruno Simon — Folio 2025** github.com/brunosimon/folio-2025 | The benchmark for "wow" on the web — and it is **MIT open source including .blend files**: a free reference codebase for Three.js world structure, controls, achievements. | Awwwards SOTM Jan 2026 [S]. |

### 3.2 Supporting references

**High-production branded web games**
- **Messenger** (Abeto, 2025) — tiny-planet delivery game, ambient multiplayer; ~5.7 MB initial load [S]. Proof that wow ≠ heavy.
- **Burberry B Bounce / Ratberry / B Surf** — browser games with real prizes; 2M+ players across the first two [V].
- **Little Workshop** — Netlify "5 Million Devs" (gamified 3D → prize contest, mobile-optimised), **Infinitown** (low-poly city art direction) [V].
- **Active Theory — Secret Sky 2021** — browser 3D festival on mobile: 160k attendees, 8.5 min avg [V]. Techniques: culling + device-tier instance scaling.
- **Doodle Champion Island Games** (Google, 2021) — overworld + mini-games + team leaderboard: the structural model for "explore → quest → score".
- **KFC Japan "Shrimp Attack"** — 22% of players redeemed in store (vendor case study) [V]. Game → physical redemption works.
- **Summer Afternoon** (Vicente Lucendo), **Townscaper web**, **Crossy Road on Poki** (Three.js, mass mobile scale) — art-direction and performance references.

**Phygital / go-to-a-place mechanics**
- Pokémon GO × McDonald's Japan (3,000 sponsored stores); **Pokémon GO × Digi and Chatime in Malaysia (2022)** — local proof that "go to this location" works with Malaysians [S].
- Nike SNKRS Stash — location unlocks **were spoofed**. Lesson: the booth claim must be staff-scanned or rotating, never a static QR.
- Malaysian patterns that drive participation (Shopee Shake, Grab Challenges, TNG GOyang/Games Hub): **instant guaranteed reward, limited quantities, daily return loop, leaderboard for top prizes** [S].
- AWS re:Invent /dev/quest stamp card with tiered swag; Salesforce "Road to Dreamforce" — the **pre → on-site → post** quest arc [S].

**Cautionary tales**
- Pandemic virtual expos failed: 69% of exhibitors rated them fair/poor; "physical dollars for virtual dimes"; CES 2021 booths were logo directories with no serendipity [V]. **They replaced the show. You augment it and route people to a real booth — a different proposition.** Say this in your pitch.
- Platform graveyard: Mozilla Hubs (shut 2024), SK ifland (shut 2025), Gather events (deprioritised 2022), **8th Wall (access ended Feb 2026)**, **Ready Player Me (shut 31 Jan 2026)**. Build on open web standards you control.
- Balenciaga Afterworld (pixel-streamed Unreal) — beautiful, but cost scales per concurrent user. Wrong for ad traffic.
- Do **not** quote the viral "gamified booths get 40% more visitors / 2–3× leads" stats — no primary source exists.

---

## 4. The game proposal

### 4.1 Concept

> **A pocket-sized, living miniature of the MIHAS floor. Find any booth in seconds. Play the quest. Finish it in the real world at the Lean X Digital booth.**

Working titles (avoid putting "MIHAS" in the product name until you have written clearance):
1. **JEJAK — The Expo Quest** *(recommended; "jejak" = trail)*
2. **Booth Run KL**
3. **Expo Quest: Halal Showcase Edition**

Footer on every screen: *"Unofficial companion game by Lean X Digital. Not affiliated with MATRADE or MIHAS."* — until/unless the organiser blesses it.

**It is two things at once, deliberately:**
- **A utility** — "the 3D floor plan nobody gave you": type a company or booth number → camera flies there → a glowing trail guides you. This is why people open it on the show floor.
- **A game** — quests, stamps, leaderboard, a real-world finish line.

### 4.2 Art direction

Tilt-shift **miniature diorama**: low-poly, warm baked lighting, soft ambient occlusion, chunky readable booth signs, tiny animated visitors, gentle camera sway. Think Infinitown × Monument Valley × an architect's model. Reasons: it reads as premium, it is cheap to render on a RM800 Android, it hides the fact that 1,700 booths are coloured boxes, and it is fast to produce (CC0 kits: Kenney, KayKit, Quaternius + one Blender hall shell).

Booths coloured by sector (F&B, pharma, finance, country pavilions…). Your booth is the hero asset: fully modelled, animated beacon of light visible from anywhere on Level 2.

Avatars: 4–6 preset low-poly business characters (modest dress options included), colour tint, Mixamo walk/idle/wave. No avatar platform dependency.

### 4.3 Core loop (first 3 minutes)

1. **Tap the ad / scan the QR → world loads in < 5 s → you are already walking.** No registration wall. Guest play.
2. **Quest 1 — "The Golden Card":** a trail leads from the Hall 6 entrance to the Lean X Digital booth. An NPC greets you: *"Every business here needs a digital front door. Here is yours — free."*
3. **Claim → short form** (name, company, role, WhatsApp, email, consent checkboxes) → **your digital business card is generated live on nexova** (`yourname.nexova.my`) with a save-to-contacts vCard and QR. *The reward is the product demo.*
4. You receive a **Golden Ticket QR**. *"Bring this to the real booth [XXXX], Level 2, to unlock the physical reward and 500 bonus points."* Staff scan it with the admin PWA → quest completes on the player's phone in real time.
5. Side quests open. Leaderboard position shown. Share card generated.

### 4.4 Quest set (v1)

| Quest | Mechanic | Purpose |
|---|---|---|
| **The Golden Card** | Walk to your booth → register → real-world scan | Lead capture + booth traffic |
| **Pavilion Passport** | Visit 8 country pavilions (Korea, Japan, Indonesia, Bangladesh, Pakistan, Philippines, Saudi, China) → stamp each | Exploration; mirrors TGS stamp rally |
| **Sector Sprint** | Timed route: touch one booth in each of 5 sectors. Fastest times rank. | **Skill-based** leaderboard (legally safe) |
| **Hidden X** | 10 hidden "X" tokens around the hall (on top of the café, behind the media centre…) | Dwell time, replay |
| **Expo IQ** | 5 quick trivia questions from public exhibitor facts + digital-marketing tips | Positions you as the digital expert |
| **Daily Drop** (23–26 Sep) | One new quest per show day, leaderboard resets daily at 17:00 | Daily return loop |

### 4.5 The growth engine: "Claim Your Booth" (exhibitor mode)

This is the B2B lead machine and the viral loop — more important than the player quests.

- Any exhibitor finds **their own booth** in the miniature and taps **"This is my booth."**
- They register (company, name, role, WhatsApp, work email) → their booth **lights up**, gets their brand colour, a one-line offer, and a link.
- They instantly receive a **share card + short video**: *"Find us at 3F09 — we're a stop on the Expo Quest."* Made for WhatsApp Status, LinkedIn, IG Story. **337+ exhibitors promoting your game to their own buyers.**
- Claimed booths become **stamp stops** for players — so exhibitors get traffic, which is why they claim.
- Upsell path: claimed booth → free nexova landing page → RM79 plan → managed services (RM1,500/RM3,000).
- Verification: light (work-email domain or staff visit). Unverified claims show as "pending" and can be revoked from the admin panel.

**Every claimed booth is a qualified lead: a named decision-maker at a business that just demonstrated it wants digital visibility.**

### 4.6 Rewards — legal and Shariah-safe by design

- **Guaranteed for everyone who finishes Quest 1:** the digital business card. No chance involved.
- **Skill-ranked daily prizes** (fastest Sector Sprint / highest score): e.g. 3 months nexova Growth, a free landing-page build, a free Shopee→store conversion.
- **Limited-quantity physical reward at the booth** for the first N scans per day (e.g. NFC business card tap-tag) — scarcity without chance.
- **Avoid completely:** spin-the-wheel, lucky draws, loot boxes, wagering points, paid entry. Pure-chance draws sit under the Common Gaming Houses Act 1953 / Lotteries Act 1952 [V — Donovan & Ho, 2026], and gambling-like mechanics (maysir) are wrong for a halal-expo audience. *Not legal advice — have counsel glance at the T&Cs.*

### 4.7 On-site integration

- **Big screen at the booth:** the live miniature with player dots moving + live leaderboard. It is the booth's attract loop.
- QR standees (A3 + table tents): "Play the floor. Win the day."
- Staff admin PWA on 2 phones: scan Golden Tickets, see lead details, add a note ("wants website quote"), tag hot/warm.
- 17:00 daily winner moment at the booth — filmed for reels.

### 4.8 After the event

- World stays open **30 days** (as Google I/O Adventure did). Post-event mode: "Revisit MIHAS 2026" + exhibitor directory stays useful for follow-ups.
- **"Your MIHAS Wrapped"** — personalised recap card per player (booths visited, rank). Shareable.
- Exhibitors' claimed booths → offer to convert into a permanent nexova page.
- Lead nurture: WhatsApp/email sequence (only to those who ticked marketing consent).
- **Case-study film:** "We rebuilt MIHAS as a game in 5 days with AI" → pitch deck to **ES Exhibition Services / MATRADE for an official MIHAS 2027 edition**, and to other organisers (MATTA Fair, MIFB, Gitex Asia, KLIBF). **The engine — floor plan in, playable expo out — is a product in itself.**

---

## 5. Technology stack

### 5.1 "I want a real game stack" — the honest answer

The "real" game engines are the **wrong** tool for this job:

| Engine | Why not |
|---|---|
| **Unity 6 Web** | Empty build ≈ 7.7 MB compressed before any content; WASM heap hits the iOS webview memory ceiling (~300–500 MB) and the tab reloads; crashes are common inside Instagram/TikTok browsers. Your traffic arrives from ads **inside those browsers**. |
| **Godot 4 Web** | ~5 MB compressed runtime, 3D on mobile web still weak, frequent iOS bug reports. |
| **Unreal (pixel streaming)** | Cost scales per concurrent user; needs strong connection; expo-hall Wi-Fi/4G is congested. |

What the award-winning web games actually use — Coastal World, Bruno Simon, Messenger, Secret Sky, Crossy Road on Poki — is **Three.js**. The web's dedicated commercial game engine is **PlayCanvas** (Snap Games, King, Miniclip, Disney, BMW). Those are the real game stacks *for the browser*.

### 5.2 Recommended stack

| Layer | Choice | Notes |
|---|---|---|
| **Renderer** | **Three.js (r18x), WebGL2 baseline**, TypeScript, Vite | MIT, ~155 KB gz core, runs in every in-app webview, best AI-assisted-coding coverage. WebGPU is *not* safe yet in Meta/TikTok webviews — don't depend on it. |
| **UI overlay** | React DOM (forms, quest log, leaderboard) over the canvas | Keep per-frame logic out of React state. |
| **World** | **Generated at runtime from your booth JSON** — `InstancedMesh` per booth type, per-instance sector colour; only the current level rendered | No 1,700-booth model to download. |
| **Booth signs** | One instanced **MSDF glyph mesh** (single draw call) or names baked to KTX2 atlases; show within ~25–30 m | Do **not** create 1,700 troika `Text` objects — FPS collapses past ~500. |
| **Assets** | Blender → glTF → `gltf-transform` (Meshopt + KTX2/Basis) | Baked lighting/AO; no realtime shadows on low tier. |
| **Collision** | Grid/AABB (the world is boxes) | Skip Rapier's WASM download. |
| **Controls** | Portrait, one-thumb: tap-to-move + virtual joystick; WASD on desktop | Coastal World pattern. |
| **Quality tiers** | FPS-adaptive (ultra → very-low), DPR capped 1.5 (2 on iPhone) | |
| **Safety net** | **Auto "Lite Mode"**: 2D canvas floor map with the same quests, triggered on WebGL2 failure, context loss ×2, or < 20 fps | This is what makes it *stable* under ad traffic. |
| **Hosting/CDN** | Cloudflare Pages/Workers + R2 (KL and JB PoPs) | Turnstile (free) on registration; WAF rate limits. |
| **Data** | **Supabase Pro, Singapore** — Postgres, RLS, Edge Functions | All score/quest writes through server functions; leaderboard top-N cached 5–10 s at edge. |
| **Identity** | Guest → form → server-set HttpOnly cookie + "resume link" sent by WhatsApp/email | In-app browsers wipe localStorage and block Google OAuth. No social login. OTP only if/when prizes demand it (WhatsApp auth template ≈ RM0.06/msg [S]). |
| **Presence (multiplayer)** | **Season 2.** Cloudflare Durable Objects + PartyServer, sharded ≤50/room, behind a kill switch (~US$1/hr at 5k CCU [E]) | v1 fakes liveliness with ambient NPC crowd + "live player dots" on the booth screen from server data. |
| **Anti-cheat** | Server-validated quests (time/position plausibility); **HMAC-signed, single-use, short-lived Golden Ticket; staff scans the player** (never a static booth QR); one prize per verified phone; manual review of top 10 | Nike SNKRS lesson. |
| **Analytics/ads** | GA4 + Meta Pixel + TikTok Pixel **plus server-side Meta CAPI + TikTok Events API** with shared `event_id` | Browser pixels miss 30–50% of events in in-app browsers. Consent-gated. |
| **Admin** | React app on the same DB: leads table, booth claims moderation, leaderboard, CSV export, scanner PWA | |

**Fallback engine:** PlayCanvas (if you later hire a 3D artist who wants a visual editor; same backend). **Do not use:** Unity, Godot, Unreal, 8th Wall, any avatar SaaS.

### 5.3 Performance budgets (mid-range Android, inside Instagram's browser) [E]

First playable ≤ 3 MB and < 5 s on 4G · critical JS ≤ 500 KB gz · total per level ≤ 8–10 MB streamed · draw calls ≤ 100 · visible triangles ≤ 300k · GPU textures ≤ 150 MB · page memory < 350 MB · 30 fps floor.

### 5.4 Running cost for the campaign month [E]

Supabase Pro + compute bump ≈ US$50–110 · Cloudflare ≈ US$5–25 · domain ≈ RM50 · AI 3D generator (Meshy/Tripo Pro, commercial licence) ≈ US$20 · total **well under RM1,000**, excluding ad spend and physical rewards.

---

## 6. Compliance checklist (do before launch)

- [ ] **PDPA notice in BM + English**; separate **unticked** checkboxes: (a) marketing via WhatsApp/SMS/email, (b) displaying claimed-booth info publicly. Easy opt-out (s.43).
- [ ] Disclose hosting outside Malaysia (Singapore/US) and get consent — cross-border rule under the 2024 amendment.
- [ ] Breach plan: 72 h to Commissioner, 7 days to individuals. **DPO becomes mandatory above 20,000 data subjects** — a successful ad campaign can cross that. Appoint one on paper now.
- [ ] Contest T&Cs: skill-based + guaranteed rewards only; one prize per person; organiser's decision final; dates; eligibility.
- [ ] **MIHAS name/logo:** read your exhibitor manual; email enquiry@mihas.com.my for written OK. Until then: no MIHAS logo, no official orange, "unofficial" footer, product name without "MIHAS". Mentioning "at MIHAS 2026, Booth XXXX" descriptively in ads is ordinary exhibitor practice.
- [ ] **Exhibitor names:** plain-text names from the public list only. **No logos unless the exhibitor claims the booth and uploads their own.** One-tap "remove my company" link.
- [ ] Check manual for rules on roaming/canvassing outside your booth before deploying a floor team.

---

## 7. Execution plan

### 7.1 Scope lock for v1 (non-negotiable if you want stability by 23 Sep)

**IN:** Level 2 in full 3D (your floor; the data is good) · Levels 1 & 3 in Lite 2D map with search ("3D coming soon") · booth search + guide trail · Quest 1 + 3 side quests + Daily Drop · registration + nexova card · Golden Ticket + staff scanner · Claim Your Booth · skill leaderboard · Lite Mode · admin panel · analytics + CAPI · BM/EN.

**OUT (Season 2):** multiplayer avatars · Levels 1 & 3 in 3D · AI concierge NPC · avatar customisation beyond presets · WebAR · OTP.

**Stretch (only if Day 3 ends green):** AI Concierge — *"who sells halal gelatin?"* → Claude answers from the exhibitor list and walks you there. Very on-brand for an "AI-native" company; small to build; but it is a stretch, not a promise.

### 7.2 Day-by-day

| Day | Build | Marketing / ops |
|---|---|---|
| **Fri 18 (D-5) — today** | Confirm booth no., name, rewards. Re-extract floor data from PDF; join to exhibitor list. Repo, Cloudflare, Supabase, domain. Art-direction lock (one reference board). | **Teaser landing page live tonight — built on nexova** (dogfood) with waitlist + pixels, so ad accounts start learning. Read exhibitor manual. Email organiser. Order QR standees/print + physical rewards. |
| **Sat 19 (D-4)** | Level 2 world generation, instancing, signs, camera, one-thumb controls, quality tiers. DB schema + registration API. | Teaser video #1: 15-s fly-through of the miniature ("Recognise this place?"). Submit Meta/TikTok ads for approval (allow 24 h). |
| **Sun 20 (D-3)** | Quests, Golden Ticket, scanner PWA, Claim Your Booth, leaderboard, Lite Mode. **Real-device testing inside Instagram, Facebook, TikTok browsers (iPhone + 2 mid-range Androids).** | Build exhibitor outreach list from the 337 public entries (public business channels only). Draft share-card templates. |
| **Mon 21 (D-2)** | Hero booth model, sound, polish, BM/EN copy, analytics + CAPI, admin panel. **k6 load test** at 10× expected peak. Soft launch to 20 friendly testers. | **Ads live:** "Play the floor before you walk it." Exhibitor blast: "Your booth is already in the game — claim it." LinkedIn post from founders. |
| **Tue 22 (D-1)** | **Feature freeze 12:00.** Bug-fix only. Backups, kill switches, error monitoring (Sentry), on-call rota. | Booth setup: screen with live map, standees, scanner phones charged. Launch film (30–45 s). |
| **Wed 23 – Fri 25 (trade days)** | Hot-fixes only, deployed after 18:00. Daily Drop quest at 10:00. | **Geo-fenced ads: 1–2 km around MITEC.** Floor team helps exhibitors claim booths on a tablet (if manual allows). 17:00 winner moment → daily reel. |
| **Sat 26 (public day)** | Public-friendly Daily Drop. | Consumer-tone creative; family-friendly prizes. |
| **27 Sep – 26 Oct** | Wrapped cards; Season 2 backlog; case-study build. | Lead nurture; retargeting; case-study film; **pitch ES Exhibition Services / MATRADE for official MIHAS 2027**; pitch other organisers. |

### 7.3 Team (minimum)

1 tech lead (with Claude Code) · 1 front-end/3D · 1 backend/ops · 1 designer/3D artist (Blender) · 1 content/video · 1 ads/performance · 2 booth staff with scanners. People can double up, but QA on real devices needs a named owner.

### 7.4 Proposed targets (goals, not forecasts)

| Metric | Target | Benchmark |
|---|---|---|
| Unique players | 3,000 | — |
| Registrations (cards claimed) | 1,000 | — |
| **Exhibitor booths claimed** | **120** (≈ 1 in 3 listed exhibitors) | — |
| Physical Golden Ticket scans | 300 | KFC Japan: 22% redeemed in store |
| Avg session | ≥ 5 min | Coastal World 6–8 min; Secret Sky 8.5 min |
| Crash-free sessions | ≥ 98 % (incl. Lite Mode fallbacks) | — |

### 7.5 Top risks

| Risk | Mitigation |
|---|---|
| 5 days is very tight | Hard scope lock; feature freeze D-1 noon; Lite Mode guarantees *something* always works |
| Crashes inside in-app browsers | WebGL2 only, memory budget, real-device testing from Day 3, auto-fallback |
| Organiser objects to the concept | Neutral name + disclaimer now; ask permission in parallel; position as added value to their show |
| Exhibitor complains about being listed | Text-only public info; one-tap removal; logos only by opt-in |
| Hall connectivity is poor | ≤ 3 MB first load, aggressive caching, service-worker cache where available |
| Pre-promotion window is tiny | Shift weight to **on-event geo-fenced ads + exhibitor share loop + post-event 30 days**; treat 2026 as Season 1 and the case study as the real national-level asset |
| Leaderboard cheating | Server validation, staff-scan, manual top-10 review |

---

## 8. Decisions I need from you

1. **Your booth number** (and size — 9 sqm shell or larger?).
2. **Go / no-go on the 5-day v1 scope** in §7.1 — or target a later event with the full vision.
3. **Name:** JEJAK / Booth Run KL / other.
4. **Rewards:** what physical item at the booth, how many per day; what daily top prizes.
5. **Team:** who is actually available Sat–Tue.
6. Can nexova generate a digital business card page via API/automation today, or does that need building too?

---

## 9. Sources

**MIHAS / company**
- https://www.mihas.com.my/visitor/admission · https://www.mihas.com.my/about/overview · https://www.mihas.com.my/about/venue
- https://www.mihas.com.my/exhibitor/exhibitors-list · https://www.mihas.com.my/exhibitor/who-should-exhibit · https://www.mihas.com.my/insp
- https://www.mihas.com.my/documents/MIHAS-2026-Official-Programme-of-Events.pdf
- https://www.bernama.com/en/news.php?id=2344352 · https://www.bacalahmalaysia.my/mihas-2025-surpasses-target-drives-rm6-05-billion-in-trade/
- https://www.businesstoday.com.my/2026/03/17/matrade-appoints-es-exhibition-as-new-agency-for-mihas/
- https://www.thestar.com.my/business/business-news/2022/02/01/first-fully-virtual-mihas-generates-big-returns
- https://www.leanis.com.my/ · https://leanx.io/ · https://www.nexova.my · https://www.nexova.my/pricing

**Game references**
- https://coastalworld.merci-michel.com/ · https://www.awwwards.com/coastal-world-by-merci-michel-wins-site-of-the-month-august-2022.html · https://www.americanbanker.com/news/coastal-community-bank-launches-virtual-world
- https://bruno-simon.com/ · https://github.com/brunosimon/folio-2025
- https://cloud.google.com/blog/topics/developers-practitioners/io-adventure-google-cloud-architecture · https://9to5google.com/2021/05/21/google-i-o-adventure-2021/
- https://www.group.dentsu.com/en/news/release/000810.html · https://medium.com/@ambrinc/tgsvr2022-1f15df9cc175
- https://www.awwwards.com/sites/messenger · https://summer-afternoon.vlucendo.com/ · https://demos.littleworkshop.fr/infinitown · https://www.littleworkshop.fr/projects/5milliondevs/
- https://www.webbyawards.com/crafted-with-code/secret-sky-2021/
- https://www.marketingdive.com/news/burberry-releases-surfer-video-game-for-summer-fashions/580943/
- https://www.gamify.com/case-studies/KFC · https://poki.com/en/g/crossy-road
- https://www.exhibitoronline.com/topics/article.asp?ID=3124 · https://blog.goosechase.com/case-study-pwc-canada
- https://www.pcma.org/challenge-virtual-trade-shows-exhibit-halls/ · https://meetings.skift.com/2021/01/19/ces-2021-virtual-edition-heres-missed/
- https://pokemongohub.net/post/news/digi-announces-partnership-with-pokemon-go-in-malaysia/ · https://nianticlabs.com/news/chatime-partnership
- https://www.roadtovr.com/netflix-acquires-xr-avatar-startup-ready-player-me/ · https://info.nianticspatial.com/blog/next-chapter

**Tech / legal**
- https://github.com/mrdoob/three.js/releases · https://threejs.org/manual/en/webgpurenderer.html · https://playcanvas.com/industries/advertising
- https://docs.unity3d.com/6000.4/Documentation/Manual/webgl-browsercompatibility.html · https://gist.github.com/aras-p/740c2d4f9977ce92b7de72b1394dd365
- https://godotengine.org/article/progress-report-web-export-in-4-3/
- https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- https://plugwith.me/blog/what-escapes-instagram-in-app-browser-in-2026/ · https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- https://gltf-transform.dev/ · https://meshoptimizer.org/gltf/ · https://github.com/protectwise/troika/issues/117
- https://developers.cloudflare.com/durable-objects/platform/pricing/ · https://supabase.com/docs/guides/realtime/pricing · https://colyseus.io/pricing/
- https://www.digitalapplied.com/blog/meta-tiktok-conversions-api-capi-server-side-tracking-2026
- https://privacymatters.dlapiper.com/2025/03/malaysia-guidelines-issued-on-data-breach-notification-and-data-protection-officer-appointment/
- https://www.mayerbrown.com/en/insights/publications/2025/07/from-legislative-reform-to-practical-guidance-key-amendments-to-malaysias-pdpa-and-the-launch-of-cross-border-transfer-guidelines
- https://dnh.com.my/running-promotional-activities-contests-competitions-and-lucky-draws-in-malaysia-heres-what-you-need-to-know-about-licensing/
- https://dnh.com.my/direct-marketing-and-personal-data-protection-in-malaysia/
- https://kenney.nl/support · https://www.meshy.ai/pricing · https://www.tripo3d.ai/pricing
