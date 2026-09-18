# MISSION X — Game Systems & Rules (v3)

The rulebook and algorithms. Builds on `MISSION_X_Game_Bible.md` (world, brand, characters) and `MIHAS_Game_Research_and_Plan.md` (stack, legal, sources).
**Rewards/gifts are KIV** — this document defines *reward hooks* (§12) so any gift can be plugged in later without changing the rules.

---

## 0. The design shift

| v2 | v3 |
|---|---|
| The digital card was the **finish line**. | The digital card is your **passport** — the thing you *play with*. Every handshake, every station visit, every lead is a card exchange. |
| You control an avatar in a model of the expo. | **You *are* in the expo.** If you are physically at MITEC, your astronaut stands where you stand. If you are not, you walk the same floor as a hologram. Both kinds of player share one live world. |
| One mission, a few side quests. | Four nested loops — minute, hour, day, season — driven by a **Mission Director** that reads the live floor and generates play. |

**One sentence:** *a live digital twin of MIHAS where real attendees and remote visitors coexist as astronauts, and everything you do in it is real networking.*

---

## 1. The four loops

| Loop | Length | What the player does | What keeps them in it |
|---|---|---|---|
| **Moment** | 30 s – 3 min | Scan a station, shake hands, answer a station mission | XP pop, stamp, new contact in the log |
| **Sortie** | 15 – 45 min | Complete a Director mission, join a Signal Storm, capture a sector with your crew | Mission rewards, sector lights change colour on the big map |
| **Day** | one show day | Daily streak, daily leaderboards, rank-up docking at the Launch Pad | Rank ceremony, daily reset at 17:00, tomorrow's teaser |
| **Season** | pre-event → event → 30 days after | Rank Cadet → Admiral, constellations, contact log, company standing | Wrapped, Hall of Fame, account carries to the next expo |

---

## 2. Identity

### 2.1 The avatar — "Suit up"
Every player is an astronaut in the brand signature: white helmet, black visor, LED smile. The helmet is a deliberate inclusivity choice — no face, skin, hair or gender to model, and nothing that conflicts with modest dress.

| Slot | Options | Unlock |
|---|---|---|
| Helmet shell | 6 colours | free |
| Visor tint | 5 | free |
| **LED smile** (the emote face) | smile, grin, wink, heart, zigzag, dots, **X**, star | 4 free, 4 by rank |
| Ear ring | 6 colours | free |
| Top | hoodie, denim jacket, tan jacket, black jacket, blazer, batik shirt, baju-Melayu-inspired top, kurung-inspired top, polo, lab coat, chef jacket, hi-vis vest | 8 free, 4 by constellation |
| Bottom | 6 | free |
| Shoes | 6 | free |
| Carry item | laptop, camera, coffee, tablet, sample box, briefcase, clipboard, shopping bag, mic, toolkit | 6 free, 4 by missions |
| Trail effect | none, spark, comet, X-dust | by rank |

6 × 5 × 8 × 6 × 12 × 6 × 6 × 10 ≈ **6.2 million combinations**. Unlocks are cosmetic only — they work whatever the gifts turn out to be.

**Tech:** modular glTF parts on one shared skeleton (~2.5 k triangles), colour by material parameters, crowd rendered with instancing, sprite impostors beyond 40 m, hard cap of 60 nearest full avatars + aggregated dots beyond.

### 2.2 Callsign, class, company
- **Callsign** — public name. Generated (`Swift-Comet-42`) or custom through a profanity/impersonation filter. **Real names are never shown publicly.**
- **Class** — Builder / Strategist / Closer / Creator (see Bible §4). Sets your crew (§8) and your starting perk. Changeable once.
- **Company tag** — shown only after verification (work-email link or Host confirmation at the company's station). Enables company leaderboard and exhibitor Host mode.
- **Passport** — the nexova digital card. Private until *you* choose to hand it to someone (§6).

### 2.3 Account
Guest play first. Identity is server-side (phone/email + HttpOnly cookie + resume link) because in-app browsers wipe local storage. One human = one account; the **Verified Human** badge (§9) is granted only by a staff scan at the Launch Pad.

---

## 3. Presence engine — "actually existing" in the expo

### 3.1 What is and is not possible (honest engineering)

| Technique | Reality at MITEC | Role in the game |
|---|---|---|
| Browser GPS / Geolocation | Indoors: 15–50 m error, **cannot tell Level 1 from 2 or 3**. Outdoors and at the doors: fine. | **Venue gate only** — "is this player at MITEC?" |
| **QR / NFC anchors** | Exact, works on every phone. NFC stickers open a URL natively on iPhone and Android. | **The backbone.** A scan places you at a known point on a known level. |
| **Step tracking (PDR)** — phone motion sensors + compass, snapped to the aisle graph | Feasible in a browser while the page is open. Drifts. MITEC's aisles are a clean orthogonal grid, which makes map-matching unusually reliable. | **The magic** — your astronaut walks when you walk, between anchors. |
| Bluetooth beacons / Wi-Fi RTT / UWB | Not available to web pages. | Season 2, via a native app wrapper. |
| Camera-based visual positioning | Needs a pre-scan of the venue and heavy WebAR; 8th Wall is gone. | Not now. |

Two hard limits to design around, not hide:
1. **A web page cannot track in the background.** When the phone locks, tracking stops. Presence therefore means *"players who have Mission X open"* plus *"where they last scanned"*. This is also the right privacy posture.
2. **Landmark anchors on common areas need organiser permission.** Without it, anchors live only at your booth and at consenting exhibitors' stations — which is the adoption loop anyway.

PDR accuracy inside MITEC cannot be known from a desk. It needs a half-day field test in the halls; §3.4 is designed so the game still works if PDR turns out poor (it degrades to anchor-to-anchor hops).

### 3.2 Presence states

```
REMOTE ──(geofence ok)──► VENUE ──(scan)──► ANCHORED ──(steps detected)──► TRACKING
   ▲                        │                   ▲                              │
   │                        │                   └────────(scan)────────────────┤
   └──(left geofence 10m)───┴──────────(no update 10 min)──► STALE ◄───────────┘
                                   any state ──(toggle)──► HIDDEN
```

| State | How others see you | XP multiplier |
|---|---|---|
| **REMOTE** | Translucent **hologram** astronaut, joystick-driven | × 0.15 |
| **VENUE** | Listed in "Arrivals", not placed on the floor | — |
| **ANCHORED** | Solid astronaut at the anchor, small ring | × 1.0 |
| **TRACKING** | Solid astronaut moving along aisles, soft halo = uncertainty | × 1.0 |
| **STALE** | Faded, shown at zone level ("somewhere in Hall 7") | — |
| **HIDDEN** | Not shown at all; still earns XP | × 1.0 |

**Privacy rules (non-negotiable):** location is opt-in with a plain-language prompt; others see you snapped to the nearest aisle node with a 5–10 s delay, never raw coordinates; HIDDEN is one tap; no movement trail is stored beyond the session — only anonymised heat aggregates; location features are 18+ (matters on the public Saturday).

### 3.3 The aisle graph
The world is reduced to a graph: **nodes** at aisle intersections and in front of each booth face; **edges** along aisles with length in metres; **level gates** at escalators/lifts. Built once from the floor data (the two routes in the pre-vis are paths on this graph). Everything positional — routing, PDR, plausibility checks, distance XP — runs on it.

### 3.4 Step tracking algorithm (PDR + map matching)

```
on anchor_scan(a):
    pos ← a.node ; level ← a.level ; sigma ← 1 m
    if prev_anchor and steps_since_prev > 20:
        step_len ← clamp(graph_dist(prev_anchor, a) / steps_since_prev, 0.45, 0.95)   # personal calibration
    prev_anchor ← a ; steps_since_prev ← 0

on motion_sample (60 Hz, page visible only):
    m ← lowpass(|accel| − g, 3 Hz)
    if peak(m) > adaptive_threshold and 0.3 s < dt_since_last_step < 1.2 s:
        step()

step():
    steps_since_prev += 1
    h ← compass_heading − HALL_AXIS_OFFSET            # one constant, measured on site
    dir ← quantise(h, {N, E, S, W})                   # aisles are orthogonal → kills magnetic noise
    if dir is a legal edge direction from current edge/node (±1 turn at nodes):
        advance(pos, dir, step_len)
    else:
        ignore_heading ; advance along current edge   # you cannot walk through a booth
    sigma += 0.08 × step_len
    if sigma > 12 m: state ← STALE                    # ask for a re-anchor
```

Publishing: client sends `{node_from, node_to, t, sigma}` at 1 Hz; server (one Durable Object per level-zone, 30 m interest cells) rebroadcasts deltas at 2 Hz to players whose view overlaps.

### 3.5 Anchors

| Anchor | Trust | Where |
|---|---|---|
| **Host code** — rotating QR (30 s HMAC) on an exhibitor's or crew's device | ★★★ | Any claimed station with a Host online; the Launch Pad |
| **Staff scan** — crew scans the *player's* Golden Ticket | ★★★ | Launch Pad only |
| **NFC beacon** sticker | ★★ | Claimed stations; landmarks if the organiser agrees |
| **Printed beacon** — static signed QR | ★ | Claimed stations |

Scanning in practice: in-page camera (BarcodeDetector → WASM fallback). In-app browsers sometimes block the camera — so every code is also a URL: scan with the phone's own camera, it opens a signed link, the server credits the account. **Must be tested inside Instagram, Facebook and TikTok browsers.**

---

## 4. The world state

### 4.1 Stations (booths)

| State | Meaning | Looks like |
|---|---|---|
| **Dark** | Unclaimed | Matte module, name only |
| **Online** | Claimed by the exhibitor | Lit, brand colour, offer line |
| **Hosted** | A Host is checked in right now | Host astronaut standing at the booth, pulse ring |
| **Hot** | Heat in the top 10 % of its level | Rising sparks |

**Heat** is an exponentially decayed visit count — the single number the Director reads:

```
H_s(t) = Σ_visits  w_trust · exp(−(t − t_i) / 20 min)
heat_pct_s = percentile of H_s among stations on the same level      # recomputed every 60 s
```

### 4.2 Sectors and levels
Hall = **sector** (Level 1: Halls 1–4 · Level 2: 5–8 · Level 3: 9–11). Sectors are the unit of crew control (§8). Levels are separate scenes joined by level gates.

### 4.3 Landmarks
Café & Visitor Lounge, Wellness Corner, MIHAS Corner stage, MIHAS Kitchen, Media Center, Photo Booth, Live Box, Main Stage, Modest Fashion Pavilion, registration. Check-in once per day each. Stage landmarks host **Session missions** tied to the official programme times.

### 4.4 The Launch Pad (8H18B) — the hub
Things that happen **only** here, physically or (for remote players) virtually:
- Passport issued (the digital card).
- **Rank-up docking** at Pilot and Commander (§5.2).
- **Verified Human** badge by staff scan.
- Crew day-end ceremony at 17:00; Mission Control big screen (live map, facing the Speaker Lounge and Bernama Studio).

This turns one booth visit into a designed **three or more**.

---

## 5. Progression

### 5.1 Four numbers, no more

| Number | Earned by | Used for | Rules |
|---|---|---|---|
| **XP** | Everything | Rank, leaderboards | Never spent, never lost |
| **Signal ⚡** | 1 per 10 XP | Utility: *Ping* (reveal nearest unvisited Online stations, 20⚡), *Boost* (add heat to a station you liked, 30⚡), *Flare* (call your squad to you, 15⚡), cosmetics | **Cannot be bought, traded, wagered or gifted** |
| **Stamps** | One per station | Constellations (§5.3) | Collection |
| **Links** | One per unique person | Contact log, Connector board | Real contacts |

### 5.2 Ranks

| Rank | XP | Gate (besides XP) |
|---|---|---|
| Cadet | 0 | — |
| Navigator | 500 | Passport issued |
| **Pilot** | 1,500 | **Dock at the Launch Pad** (physical scan; remote: virtual docking + 3 Links) |
| Captain | 3,500 | Visited all three levels + 1 constellation |
| **Commander** | 7,000 | **Dock again** + 25 Links + 3 constellations |
| Admiral | 12,000 | Every hall entered + 60 stamps + Verified Human |

Calibration: a fully engaged on-site day yields ≈ 3,000–3,500 XP (§7.3), so Commander is a committed two-day effort and Admiral takes the whole show. Remote-only players top out around Captain by design — *being there* has to matter.

### 5.3 Constellations (set collections)

| Constellation | Complete by stamping |
|---|---|
| **Atlas** | 8 country pavilions |
| **Harvest** | 12 Food & Beverage stations across ≥ 3 halls |
| **Apothecary** | 6 Pharma / Cosmetics stations |
| **Ledger** | 5 Islamic finance & fintech stations |
| **Forge** | 6 Food-tech & packaging stations |
| **Agencies** | 8 government / state pavilions (Level 3) |
| **Tri-Deck** | 5 stamps on each of the three levels |
| **Edge of the Map** | The four corner stations of Level 2 — ending at 8H18B |
| **First Light** | Be among the first 10 to stamp a station after it comes Online |
| **Cartographer** | Stamp ≥ 1 station in every hall |

300–1,000 XP each, plus a cosmetic.

---

## 6. The Passport economy — networking as the game

This is what makes it real, and what it is for.

### 6.1 Link-up (player ↔ player)
Two on-site players: one shows a Link code, the other scans (or NFC-bump). Each sees a consent sheet — **choose what to share**: name / company / role / WhatsApp / email / card page. Confirm → both Passports land in each other's **Contact Log**, +50 XP each.
- Same pair counts once. First 30 Links a day at full XP, then 10 XP (networking, not farming).
- Cross-crew Links give both crews influence (§8) — rivalry that rewards talking to the other side.
- Remote ↔ anyone: allowed, 15 XP, flagged "remote link".

### 6.2 Station exchange (visitor → exhibitor)
At a claimed station, after the stamp: *"Share your Passport with **F&N**?"* — explicit, per-station, revocable. Yes → the visitor gets +25 XP and the exhibitor's brochure link; the exhibitor gets a **consented lead** in their Host dashboard with time, source mission and the fields shared. CSV/vCard export.

**This quietly makes Mission X a free lead-retrieval tool** — a thing exhibitors normally rent. That is the reason 300+ exhibitors will claim stations, put your QR on their counter, and tell their visitors to play. It is also the cleanest nexova upsell: *"These are your 84 leads. Want a page and a follow-up funnel for them?"*

### 6.3 Verified Contact
If the Host confirms the conversation happened (taps the visitor in Host mode, or the visitor scanned the rotating Host code): +60 XP to the visitor, +15 Station XP, and the lead is marked **verified** — worth more to the exhibitor.

### 6.4 After the show
The Contact Log is the player's own CRM: notes, tags, "follow up" reminders, one-tap WhatsApp. Post-event missions (§11) reward actually following up.

---

## 7. XP rules

### 7.1 Action table

| Action | Base XP | Limits |
|---|---|---|
| Suit up (avatar + callsign) | 50 | once |
| Passport issued | 200 | once |
| Launch Pad docking (staff scan) | 500 | once; +150 at each rank docking |
| **Station stamp** | 40 | formula §7.2; 45 s minimum between stamps |
| Station mission (exhibitor's quiz / task) | 30 | once per station |
| Station exchange (share Passport) | 25 | once per station |
| Verified Contact | 60 | once per station |
| Link-up | 50 | §6.1 |
| Landmark check-in | 20 | once per landmark per day |
| Session attended (at a stage during a programme slot, ≥ 10 min) | 80 | per session |
| First entry to a hall / a level | 100 / 150 | once each |
| Distance walked | 1 per 10 m (graph distance) | 300 / day |
| Director mission | 60 – 250 | §10 |
| Constellation | 300 – 1,000 | once each |
| Crew sector held at tick (you were active in it) | 40 | per tick |

### 7.2 Station stamp formula

```
XP = 40 × presence × novelty × quiet × streak × trust

presence = 1.0 on-site (ANCHORED/TRACKING/HIDDEN)   | 0.15 remote
novelty  = max(0.4, 1 − 0.06 × k)        k = stamps you already hold in this station's sector (hall)
quiet    = 1 + 0.5 × (1 − heat_pct)      quiet stations pay up to ×1.5
streak   = 1.0 / 1.1 / 1.2 / 1.3         show day 1 / 2 / 3 / 4 attended consecutively
trust    = 1.0 Host code | 0.8 NFC | 0.6 printed beacon (needs geofence ok)

after 60 stamps in a day: × 0.25
```

Why each term exists: **novelty** pushes people across halls instead of sweeping one row; **quiet** is a load-balancer that sends traffic to dead corners (every organiser's and every corner-booth exhibitor's wish — including yours); **trust** makes the exhibitor-hosted scan the best scan, which pulls exhibitors into Host mode.

### 7.3 Sanity check — one fully engaged on-site day
40 stamps × ~35 = 1,400 · 20 Links = 1,000 · 10 station missions = 300 · 8 landmarks = 160 · 2 sessions = 160 · distance = 300 · 3 Director missions ≈ 400 → **≈ 3,700 before caps bite, ~3,200 typical.**

### 7.4 The ledger
Every award is an append-only row: `player, action, target, base, multipliers, trust, time, position_node`. Leaderboards are *views* over the ledger. A cheater is removed by voiding rows, not by editing a score.

---

## 8. Crews, squads, companies

### 8.1 Four crews
Your class is your crew: **Builders · Strategists · Closers · Creators.** Four colours on the map.

**Sector control** — every 30 minutes, per hall:

```
influence[c][hall] = Σ over crew-c events in hall:  w_e × exp(−(now − t_e) / 45 min)
        w_e = 1 stamp | 2 verified contact | 1 each for a cross-crew Link | 3 Director mission
score[c] = influence[c][hall] / sqrt(active_members[c])        # underdog normalisation
holder[hall] = argmax_c score[c]      (ties → previous holder keeps it)
```

The hall's lighting takes the holder's colour in the 3D world and on the Mission Control screen. Members active in a held hall at the tick get +40 XP. Day winner = most hall-ticks held, weighted by hall size. Deterministic, effort-based — no chance anywhere.

### 8.2 Squads (2–5 players)
Made for colleagues walking the show together. Squad missions (§10), shared Flare, squad streaks. Squad XP = sum of members' XP earned **while within one hall of each other**.

### 8.3 Company board
Verified company tag → **Top Company** = sum of its five best players. Exhibiting companies and visiting buyer companies on the same board. Bosses will push their teams onto it.

---

## 9. Trust and anti-cheat

```
trust_score ∈ [0,1] = 0.25·geofence_ok
                    + 0.30·host_code_scans_today ≥ 1
                    + 0.20·travel_plausible          # graph_dist / dt ≤ 2.5 m/s, level changes only via gates
                    + 0.15·steps_consistent          # sensor steps ≈ graph distance ± 40 %
                    + 0.10·verified_human
```

- Leaderboard eligibility: trust ≥ 0.7. Top 20 reviewed by a human before anything is announced.
- Rotating Host codes cannot be photographed and shared; printed beacons pay less and need the geofence.
- Rate limits per account / device / IP; Turnstile on signup; one account per verified phone.
- GPS spoofing alone gains almost nothing — it is 0.25 of trust and places you nowhere.
- Everything is server-authoritative; the client only *requests*.

---

## 10. The Mission Director

Inspired by the "AI director" pattern in games: a server process that watches the live floor and hands each player something worth doing *now*.

### 10.1 Three slots per player
**Story** (linear chain, the Brand → Market → Sell campaign) · **Dynamic** (generated) · **Social** (crew / squad / co-op).

### 10.2 Dynamic mission generation

```
every time a slot empties, for player p:
    candidates ← templates × feasible targets
    for each candidate m:
        score(m) =  0.30 × proximity_fit(p, m)        # 60–250 m of walking is the sweet spot; remote: any
                  + 0.25 × novelty(p, m)              # unvisited stations / halls / levels
                  + 0.20 × quiet(m)                   # 1 − heat_pct of the target zone
                  + 0.15 × interest(p, m)             # p's class + sectors p has dwelt in
                  + 0.10 × partner(m)                 # Hosted > Online > Dark
                  − 0.30 × recently_offered(p, m)
    offer the top 3; player picks one                  # choice, not chance
```

### 10.3 Templates

| Template | Rule | Why |
|---|---|---|
| **Survey Run** | Stamp 3 stations in a named sector within 20 min | Core exploration |
| **Supply Run** | Pick up a virtual crate at station A, deliver to station B (both Online, different halls) | Long walks past many booths; two exhibitors get a visit |
| **First Contact** | Get a Verified Contact at a station in a sector you've never visited | Real conversations |
| **Signal Storm** | Director picks a zone with heat_pct < 0.2 → all stamps there pay ×2 for 15 min, announced to everyone on the level | Flash-mob traffic to dead zones |
| **Stage Call** | Be at a stage landmark when a programme session starts | Ties the game to the official schedule |
| **Ground Control** *(co-op)* | A **remote** player sees a clue only visible from orbit; an **on-site** player must physically go and scan it. Paired live; emote-only comms | The signature mechanic: virtual and physical attendees need each other |
| **Rendezvous** | Squad members start in different halls and must Link at a named landmark | Squads |
| **Cartographer's Request** | Stamp the station furthest from your current position on this level | For the hardcore |
| **Dark Sector** | Visit 3 Dark stations and leave an invite — the exhibitor gets a "someone came looking for you" message | Converts unclaimed exhibitors |

### 10.4 Scheduled beats
10:00 doors + Daily Drop · on the hour: sector tick recap · programme-linked Stage Calls · 16:30 "Final Approach" (double crew influence) · **17:00 day-end ceremony at the Launch Pad** · 17:05 tomorrow's teaser.

---

## 11. Exhibitor game — "Station Command"

| Station XP source | SXP |
|---|---|
| Claim | 100 |
| Profile complete (logo, offer, link, sector tags) | 100 |
| Host online, per hour | 20 |
| Stamp received | 2 |
| Passport received | 10 |
| Verified Contact | 15 |
| Station mission completed by a visitor | 5 |

| Level | SXP | Unlocks |
|---|---|---|
| L1 | 100 | Lights on, name fascia |
| L2 | 300 | Brand colour, offer line, link |
| L3 | 800 | Author a **station mission** (3-question quiz or "ask us about ___") |
| L4 | 2,000 | Light beam; suggested by *Ask X* |
| L5 | 5,000 | **Flagship**: hologram on the Mission Control map, featured in the daily reel |

Boards: **Top Stations** per sector and overall. Hosts play as astronauts pinned to their station — visible to everyone, which is exactly what an exhibitor wants.

**Host dashboard:** live visitors nearby (count only), leads with consented fields, verified flag, notes, export, and the nexova "turn this into a follow-up page" button.

---

## 12. Reward hooks (gifts KIV)

The rules expose five slots. Anything can be attached later; nothing in the game depends on what.

| Hook | Trigger | Nature |
|---|---|---|
| `R1_PASSPORT` | Passport issued | Guaranteed |
| `R2_DOCK` | First Launch Pad docking | Guaranteed, limited stock per day |
| `R3_RANK[n]` | Reaching Pilot / Captain / Commander / Admiral | Guaranteed on achievement |
| `R4_BOARD[d]` | Daily boards: Explorer, Connector, Crew MVP, Top Station, Top Company | Skill / effort ranked, trust ≥ 0.7, human-reviewed |
| `R5_SEASON` | End of show | Hall of Fame |

Standing constraints whatever the gifts are: **no draws, no spins, no wagering of Signal, no paid entry** — guaranteed or merit-ranked only (Malaysian gaming law + a halal-show audience; see Plan §4.6).

---

## 13. The season

| Phase | Who can play | What exists | Cap |
|---|---|---|---|
| **Orbit** (pre-event) | Everyone, remote | Suit up, scout the floor, plan a flight path, exhibitors claim stations, crew recruitment, Ground Control training | Pre-event XP counts up to **Navigator** only — arrive with a rank, not a lead |
| **Boots on Deck** (23–26 Sep) | On-site + remote | Everything | — |
| **Debrief** (30 days) | Everyone | World stays open as a directory; **Wrapped**; Contact Log; follow-up missions (*message 3 contacts*, *publish your nexova page*, *book a strategy call*) | Follow-up XP feeds Hall of Fame |
| **Next expo** | — | Account, rank insignia, cosmetics and Contact Log carry over. Floor plan in → new season out. | — |

---

## 14. Data model (server)

`players` · `avatars` · `passports` · `sessions` · `presence` (ephemeral) · `graph_nodes` / `graph_edges` · `stations` · `station_hosts` · `anchors` · `scans` · `stamps` · `links` · **`card_shares`** (the consent record: who, to whom, which fields, when, revoked_at) · `missions` / `mission_instances` · `crews` · `squads` · `companies` · `influence_events` · `sector_ticks` · **`xp_ledger`** (append-only) · `reward_grants` · `audit_flags`.

Realtime: Durable Object per level-zone for presence; Postgres for truth; leaderboards as cached views refreshed every 5–10 s.

---

## 15. What must be proven before building it all

| Risk | Test | Fallback if it fails |
|---|---|---|
| Step tracking accuracy inside MITEC (steel, crowds, compass noise) | Half-day field test: 5 phones, 10 known routes, measure error at each anchor | Presence becomes anchor-to-anchor hops with animated walking between — still feels alive |
| Camera / motion-sensor permission inside Instagram / Facebook / TikTok browsers | Device matrix on real phones | URL-based scan via the native camera; "open in browser" prompt for tracking |
| Hall connectivity under load | Test on a busy day at MITEC, or throttle to 1 Mbps / 300 ms | Offline-tolerant scan queue; presence degrades first, scans never lost |
| Organiser acceptance of beacons and of a live-location game at their show | Show them the pre-vis; offer heat analytics and quiet-zone load balancing as *their* benefit | Anchors only at consenting stations + your booth |
| PDPA exposure of live location + contact exchange | Counsel review of consent flows; DPO appointed | Location off by default; zone-level only |
| Exhibitor adoption | Pilot with 10 friendly exhibitors before the show | Seed with your own clients and neighbours (UOB, Dr Parveen, JK Agri, Yapiem are metres away) |

---

## 16. Build order (slots into Bible §7.3 milestones)

1. **M1** — Passport, stamps, XP ledger, ranks, Launch Pad docking, printed beacons, remote holograms. *(A complete game without live location.)*
2. **M2** — Host mode + rotating codes, station exchange + Host dashboard, Link-up, Contact Log, avatar creator, crews + sector control.
3. **M3** — Presence engine: geofence, ANCHORED presence, then PDR TRACKING behind a flag; Mission Director; Ground Control co-op; Levels 1 and 3.
4. **M4** — Squads, company board, Signal Storms, Mission Control screen mode, trust scoring + review tools.
5. **M5** — Debrief phase, Wrapped, season carry-over.
