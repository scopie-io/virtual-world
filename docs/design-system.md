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

The crew console, the big screen and the public card page use the same tokens.
