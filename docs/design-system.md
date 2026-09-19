# Mission X — how it looks, on one page

The world is a **daylight model of the expo**: warm paper, white shell-scheme booths (what real MIHAS booths are),
ink for type. It is meant to be recognised at a glance — "that is the floor plan, and I am in it" — and to stay sharp
on a phone. If a colour, an effect or an element is not on this page, it is not in the game.

## Colour means something — and nothing else is coloured

| Colour | Means | Where |
|---|---|---|
| **Blue** `#2457F5` | you, and what you can do | your ring on the floor, the trail, primary buttons, lifts, visitor jackets, progress |
| **Gold** `#F2B01E` | what you have earned | points, stamped booth roofs, the pad under the X |
| **Green** `#1E9E6A` | an exhibitor is there | booths online (soft green), the marker over a booth whose exhibitor is at the counter, exhibitor jackets |
| Ink `#1B2130` · greys | type and structure | text, gate frames, toasts |
| Paper `#F2F0EB` · floor · white | the place | sky, slab, carpet, booths, cards |
| Red `#D6453D` | something went wrong | errors only |

The only other colour in the world is **the X itself**, in the logo's own blue and yellow — so the brand is the one
saturated object on a quiet floor. One file holds the palette for the 3D world (`src/theme.ts`); the interface reads the
same values from `:root` in `src/ui.css`.

## The world: what is in it, and what was removed

In: three level slabs, hall carpets with their number painted on the floor, low walls, quiet blocks for lounges and
stages, slim entrance frames, blue lift discs, 1,599 white booths, the X with our booth and crew, people.

Removed: the space backdrop (stars, planet, glow), the glowing platform edge and hull, the grid texture, per-hall booth
colours and random heights, 1,599 roof-sign textures, nine exhibitor-chosen booth colours, light beams over booths and
the 120 m beam over the X, pulse rings, translucent "ghost" players, particle trails, the floating guide astronaut, and
every visual of the switched-off systems (storm floor, sector tint, Ground Control markers).

Booth names appear as **crisp labels for the few booths around you** instead of tiny roof textures nobody could read.

**Places** (cafés, lounges, stages, kitchens, press rooms, the photo booth) are furnished from four neutral tones —
white, warm grey, grey, ink — on a sage floor patch. All furniture in the building is two instanced meshes; the seated
crowd is three. The crowd is **grey**: blue and green are reserved for real people. The photo walls and the floor mark
in front of them follow the same rule: the wall is white with ink lettering, the mark is blue because you can use it.

## One scale

Booths, halls, aisles and places are true to the floor plan (a booth is 2.82 × 3.06 × 2.6 m). The astronaut is a
mascot, about 1.25× a person (2.3 m with the helmet) — so everything people *use* is 1.25× too (`K` in
`src/game/places.ts`): chairs, tables, counters, stools, and the gaps between them. A seated astronaut fits the chair
and sits level with the grey crowd, which is built to the same proportions. Nobody is taller than a booth.

Stands of several booths (116 exhibitors, up to 26 cells) close up into one block and carry the exhibitor's name on
the roof, once, along their longest run (`src/game/stands.ts`). When the exhibitor is online the whole stand turns
green. The rules still count every cell as its own booth.

## Why it is sharp on phones now

- Antialiasing is always on, and the canvas renders at the phone's real pixel density (up to 2×). Before, phones got
  no antialiasing and a 1.5× cap that fell further under load. It now only gives ground (to 1.25×) below 24 fps.
- Matte, unlit-looking materials (Lambert), one sun, no tone mapping: flat faces, clean edges, cheaper per pixel.
- A tight camera depth range (1–1,400 m, was 0.5–2,600) and floor decals drawn with polygon offset: no flickering
  surfaces.
- No additive glow, no transparency stacks, no `backdrop-filter` blur anywhere in the interface.
- Labels are HTML, snapped to whole pixels, and a label never sits on top of another.

## What a frame costs

Measured on the demo world with 20 other players in view, same scene before and after the performance pass (19 Sep):

| | before | after |
| --- | --- | --- |
| draw calls | 238 | 60 – 83 |
| triangles | 203,000 | 72,000 – 86,000 |
| our code per frame (desktop) | 1.7 ms | 1.1 – 1.5 ms |

How:

- **Everyone who is not you is drawn together** (`src/game/troupe.ts`). An astronaut is ~14 small meshes; 40 players was
  500+ draw calls. Rigs are posed as before but hidden, and each kind of part is copied into one instanced mesh per
  frame: about a dozen calls whether there are 4 players or 40. Players far outside the view are not posed at all.
- **Other players and the booth crew use a lighter build** of the same shapes (`detail: 'lo'`); the player keeps the
  full one — it is the one in the portrait photo.
- **The grey crowd was over half of all triangles** for background scenery. Same proportions, a quarter of the triangles.
- **Furniture and crowd are built per level**, each with its own bounds, so the two levels you are not on are skipped.
- **Labels are written only when they change**, and ones out of range are skipped before any maths.
- **Resolution steps down on evidence only**: measured from real frame times over 3 s, under 42 fps; a tab that was
  away, or a browser holding the page to 30 Hz, is not a slow phone.

`?perf` on the game URL shows frames per second, milliseconds of our code per frame (by part), draw calls, triangles and
the pixel ratio in the corner. It is the tool for the real-phone pass.

## Interface rules

- **One thing at a time.** Top-left: one card — chapter, title, progress, and the distance/"Take me there" row when a
  trail is showing. Tap it on a phone to read the full instruction. Points sit in its corner. Nothing else up there.
- **Thumb zone.** Bottom-centre: the one thing you can do right here (stamp, get card, lift). Bottom-right: the three
  things you can always do (map, express, menu). The lower-left is left free for the joystick.
- **Sheets** rise from the bottom on a phone and are centred dialogs on a desk. One primary (blue) button per sheet.
- **Feedback for every input:** tap the floor → a blue ring where you are going; stamp → the gold roof drops in with a
  small overshoot and a toast comes down from the top; buttons press in; starts and stops have a little weight.
- **The dock is three buttons**: map (with search and places), express (wave · cheer · dance · jump · photo), menu.
- Targets ≥ 44 px. Type: Urbanist, 800 for titles, 700 for controls, 500 for text; eyebrows 11 px caps in grey.
  Radii 10 / 14 / 22. One shadow. Motion 120–240 ms, off with "reduce motion".
- The brand wordmark appears on the first screen and the big screen — not over the game.

### With a mouse

The game is built for a thumb first. On a desk it must not feel like a phone page in a big window:

- **Things answer before they are pressed.** Every control has a hover state (a step darker, or blue for the round
  dock buttons). Hover rules live inside `@media (hover:hover) and (pointer:fine)` — on a phone a hover state sticks to
  the last thing tapped, so phones get none.
- **The cursor says what a press will do**: an open hand over the world (drag to look around), a closed hand while
  dragging, a pointing hand over a booth or the X.
- **Point at a booth**: a blue frame on its roof line, a light blue wash, and a dark tag with its number and exhibitor.
  **Press it**: the astronaut walks to its front, the frame stays until they arrive, and the Stamp button is for that
  booth — not whichever neighbour is a hand closer. Press the booth you are standing at: its sheet opens. Press the X:
  walk to its counter. The same press works with a finger. Picking is worked out from the floor plan
  (`src/game/pick.ts`), front-most booth first, so nothing is picked through the booth in front of it.
- **Keys are written on the buttons** (`<kbd>`, shown only with a mouse): E on the action button, 1 2 3 and Space in
  the express tray, M in the map tooltip. The round buttons have instant dark tooltips instead of the browser's.
- **One interface scale** (`--ui` in `ui.css`): 1 up to a laptop, 1.15 from 1700 × 880, 1.3 from 2300 × 1180. The whole
  interface and the labels in the world grow together; `--vw` / `--vh` are the screen in grown pixels, and everything
  sized from the screen uses them. The crew console and the big screen opt out.

### Sound and touch

Ten sounds, all made in the browser (`src/sfx.ts`) from sine and triangle waves on one five-note scale — no audio
files, nothing to license, everything in tune with everything else. A sound marks something that happened; there is no
music, no loop, no ambience.

| sound | when |
| --- | --- |
| tap | any button |
| go | the floor or a booth was pressed: "going there" |
| stamp (two rising notes) + a 14 ms buzz | points were earned |
| big (four-note rise) + a double buzz | your card, a swap, your booth online, the prize claimed |
| warn (two falling notes) | a red toast |
| jump, sit, shutter, lift up / lift down | what they say |

Silent until the player has touched the page. One switch in the menu ("Sound · on / off") covers sound and vibration
and is remembered. A phone on silent stays silent. Vibration exists on Android only; iPhones ignore it.

The crew console, the big screen and the public card page use the same tokens.
