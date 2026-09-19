// The one palette. The 3D world reads it from here; the interface reads the same values from :root in ui.css.
// If a colour is not in this file, it is not in the game.
//
// A daylight model of the expo: warm paper, white shell-scheme booths, ink for type — and three colours that each
// mean one thing. Blue is you and what you can do. Gold is what you have earned. Green is an exhibitor who is there.
// The only other colour in the world is the X itself, in its own blue and yellow.
export const THEME = {
  paper: 0xf2f0eb,      // sky, page background
  ground: 0xe9e6df,     // what the building stands on; fades into the sky
  floor: 0xd9d5cb,      // the slab each level stands on
  hall: 0xe6e3db,       // carpet inside a hall
  line: 0xc6c1b5,       // low walls
  booth: 0xffffff,      // shell-scheme white
  area: 0xd5dcd8,       // lounges, stages, kitchens
  ink: 0x1b2130,
  inkSoft: 0x8b91a0,
  blue: 0x2457f5,       // action · you · the trail · lifts
  gold: 0xf2b01e,       // reward · stamped
  green: 0x1e9e6a,      // exhibitor · booth online
  greenSoft: 0xcdeadb,
  xBlue: 0x3aa8ff,      // the X, as in the logo
  xYellow: 0xffc629,
} as const;

export const css = (n: number) => '#' + n.toString(16).padStart(6, '0');
