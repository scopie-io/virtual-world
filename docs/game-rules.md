# Mission X — the game, on one page

This page is the whole game. If something is not here, it is not in the game.
The numbers live in [`shared/rules.ts`](../shared/rules.ts); the words on screen live in `src/ui/`.

**In one sentence:** walk the MIHAS expo on your phone, stamp booths, swap cards — and find the X for your free
digital business card and a gift at the real Booth 8H18B.

## Two doors

The first screen has two buttons and nothing else to decide.

| | **I'm visiting** | **I'm exhibiting** |
|---|---|---|
| What it is | One mission, five chapters, about five minutes | Three steps on your own booth, about two minutes |
| Wears | the astronaut, cyan | the astronaut, yellow |
| Shown as | "Visitor 4821" until they have a card, then "Aisyah R." | the same |

Anyone can switch doors from the menu. Whoever brings a booth online becomes an exhibitor.

## The visitor's mission

One instruction on screen at a time, and five dots that fill in.

1. **Arrive** — land at the Hall 8 entrance and walk.
2. **Find the X** — follow the trail to Booth 8H18B. Reward: your free digital business card (its own link, QR and
   contact file). This is the only form in the game.
3. **Collect** — walk up to any five booths and stamp them.
4. **Connect** — swap cards with one person, or leave your card at one booth that is online.
5. **Make it real** — show your prize code at the real Booth 8H18B. Our crew scans it; you get your gift.

Chapters 3 and 4 can be done in either order, and someone standing at the booth can do 5 early.
Someone playing from home before the show finishes 1–4 and sees chapter 5 waiting: *that* is the invitation to MIHAS.
When the fifth closes, the ending says what they just did — a customer journey — and who builds those.

After the mission it is free play: the same actions keep scoring.

## Points — fixed, and shown in the game ("How to play")

| Do this | Points |
|---|---|
| Stamp a booth in the game | 10 |
| Leave your card at a booth | 10 |
| Scan a booth QR at the real booth | 50 |
| Swap cards with a person | 50 |
| Get your digital business card at the X | 200 |
| Show your prize code at the real Booth 8H18B | 500 |

Exhibitors also get 100 when their booth first comes online. The crew can name a **booth of the day**; scanning its
QR at the real booth that day pays a bonus they choose.

There is one board with two tabs: **players by points**, **booths by visits**.

## The world: places to go, things to do — none of it scores

The rules above are the whole game. Everything below is play: it costs nothing, earns nothing, and needs no explaining.

- **Places.** The 20 named areas of the real floor plan, on all three levels, are furnished places you can walk into:
  cafés, lounges, stages with rows of seats, kitchens with stools, the press rooms, the photo booth, the merchandise
  stand. Their layout is generated from the rectangles the organiser drew (`src/game/places.ts`).
- **One thing to do in each**, on the same big button as "Stamp": sit down · sit and watch · take a photo.
  While you sit, one true sentence about the show at a time (`src/game/facts.ts` — counted from the floor plan and the
  official exhibitor list, never written by hand).
- **Photo.** Your astronaut, waving, with the place behind them and a caption band. Made on the device; share or save.
- **Expression.** Wave, cheer, dance, jump. Other players see it (it travels with your position; nothing else does).
- **The map.** All three levels of MITEC: stamped booths in gold, online booths in green, lifts, the X, you. Tap
  anywhere to be guided there. Search and the list of places live in the same sheet.
- **Arriving.** Walking into a hall or a place for the first time says what it is: "Hall 3 · Level 1 — 232 booths ·
  mostly Food & Beverages". The map keeps count of what you have seen (on this device; it is a memory, not a score).
- **Lifts** are a ride: the camera rises, crosses to the other level and comes down.
- **A quiet crowd** sits in the places — grey, unnamed, never blue or green, which are real people.

Keyboard: WASD / arrows · space jump · E the big button · 1 2 3 wave, cheer, dance · M map.

## The exhibitor's three steps

1. **Light up** — find your booth number, add your name, one line and a colour. It glows for every player at once.
2. **Get scanned** — keep your booth QR open on a phone or tablet at the counter. A visitor who scans it scores 50
   and is marked "met in person" on your list.
3. **Lead** — visitors choose which fields of their card to leave with you. Your list grows; export it as CSV.

Our crew confirms each booth ("verified exhibitor") and removes one that is not yours.

## Words

| We say | We never say |
|---|---|
| booth | station |
| the X · Booth 8H18B | Launch Pad |
| my digital business card · my card | Passport |
| prize code | Golden Ticket |
| claimed at the booth | docked |
| points | XP |
| swap cards | Link-up |
| booth QR | host code, beacon |
| met in person | verified contact |
| level | deck |
| booth of the day | Daily Drop |

"Mission X", "Find the X" and the astronaut stay: they are the brand.

## What keeps it honest (players never need to read this)

- The server decides everything; the app only asks. Every point is a row in a history that the crew can void and restore.
- One stamp every five seconds at most; travel faster than a run is refused and remembered.
- A printed booth QR can be photographed, so it scores 50 only when the phone is at MIHAS (one location reading, asked
  in that moment, only the yes/no kept) and 10 anywhere else. An exhibitor's live QR changes every 30 seconds and needs no GPS.
- Before a prize is announced the crew reviews the top of the board: who was at MIHAS, who scanned a live QR, who came
  to our booth, who jumped impossibly. Nothing in the game is decided by chance.
- Cards are shared field by field, by choice, and can be taken back.

## Switched off

Built earlier, still in the code and still tested, not part of this game: avatar editor, the four classes and crews,
sector control, Mission Director, Signal Storms, Ground Control, company teams, points for halls, landmarks and
walking, "on deck" step tracking, invisible mode, ranks. They are behind `FEATURES` in `shared/rules.ts`; their
screens were removed (git tag `m4-full` has them). `docs/game-systems.md` and `docs/game-bible.md` describe that
larger design and are kept for reference only.
