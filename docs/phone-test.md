# Step 8 — proof on real phones (15 minutes, no tools needed)

Everything up to here was checked on one desktop machine. This is the part only a real phone can answer.
Use the deployed link (Vercel), not localhost. Add `?perf` to the end of the address: a small dark box in the top-right
corner shows the numbers asked for below.

**Phones worth trying, in order of value:** a mid-range Android that is 2–3 years old (the typical visitor), any iPhone,
and the link opened from inside WhatsApp or Instagram (their built-in browsers behave differently from Chrome / Safari).

## What to do, and what to look at

| # | Do this | It passes if | If not, tell me |
| --- | --- | --- | --- |
| 1 | Open the link on mobile data, not Wi-Fi | The first screen is up in under ~5 s | how long it took |
| 2 | Look at the first line of the `?perf` box while walking | **fps 50–60** (or a steady 30 on battery saver); `dpr` stays at 2 or higher than 1.25 | the whole first line, e.g. `31 fps · 9.2 ms · 74 calls · 80k tris · dpr 1.5` |
| 3 | Drag the lower-left of the screen to walk; tap the floor; tap a booth | The joystick appears under the thumb; a tap walks there; a tapped booth gets a blue frame and the astronaut walks to it | what happened instead |
| 4 | Drag elsewhere to turn, pinch to zoom | Smooth, no page scrolling or zooming of the whole page | — |
| 5 | Press "Take me there", then do nothing | The astronaut arrives at the X without stopping on the way | **where it stopped** (screenshot) — this is the one open observation in the README |
| 6 | At the X, fill the card with test details | The preview fills in as you type; the keyboard does not cover the field being typed in | which field was covered |
| 7 | Stamp a booth | A chime, a short buzz (Android only), the gold roof drops in, the score rolls up | which of those was missing |
| 8 | Menu → Sound · off, stamp another booth | Silence, no buzz | — |
| 9 | Express → Photo | A portrait appears; Share or Save works | iPhone especially: a blank photo is a known risk |
| 10 | Take a lift to Level 1 or 3, walk around | The camera rises and comes down on the other level; booths and places are there | — |
| 11 | Press the phone's Back button / swipe back with a sheet open | The sheet closes; the game does not | — |
| 12 | Lock the phone for a minute, unlock | The game carries on; nobody kept walking | — |
| 13 | Share the link to yourself on WhatsApp | The preview shows the "Find the X." card | needs `SITE_URL` or the Vercel domain at build time |
| 14 | Add to Home Screen | The X icon on a dark tile, the name "Mission X" | — |

## Numbers that would worry me

- under 30 fps with `dpr 1.25` on a phone newer than 2021 → there is more to take out of the scene
- `ms` (our own code per frame) above 12 → a specific part is slow; the second line of the box says which
- `calls` above 150 → something is not being batched

## Not covered by a phone in the hand

The load of many players at once on Vercel (every position update is about five database round trips). That needs the
real backend connected and a scripted crowd; it is the first job of the backend phase, not of this sweep.
