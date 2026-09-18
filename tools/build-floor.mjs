// Builds public/data/floor.json: all three exhibition levels in ONE plan coordinate space.
// Level 2 keeps its own frame (dy = 0). Levels 1 and 3 (tools/data/level{1,3}.json, from build-decks.mjs) are shifted
// south / north of it, so distances, presence, pathfinding and missions need no notion of "floor" — decks are simply
// far apart, and lifts are portals between them. In the 3D world they read as three platforms of the station.
// Level 2 source: tools/data/level2-source.json (vector-derived from Floor Plan V226, page 2).
// Units: metres, origin = source PDF lower-left, +y = north.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { shortName } from './names.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, 'data/level2-source.json'); // vector extraction of Floor Plan V226 page 2, kept with the tools so the build is reproducible
const OUT = resolve(here, '../public/data/floor.json');

const HERO_ID = '8H18B';

// Special areas measured off the cleaned plan (22.2 px/m). kind: pad = walk-around block, zone = open floor you can enter.
const areas = [
  { id: 'cafe', name: 'Café & Visitor Lounge', x0: 74.3, y0: 95.9, x1: 183.7, y1: 107.9, h: 0.4, kind: 'zone' },
  { id: 'wellness', name: 'Wellness Corner', x0: 6.8, y0: 78.8, x1: 69.8, y1: 91.5, h: 0.4, kind: 'zone' },
  { id: 'corner', name: 'MIHAS Corner · Stage', x0: 6.8, y0: 57.3, x1: 18.3, y1: 73.5, h: 0.9, kind: 'pad' },
  { id: 'kitchen', name: 'MIHAS Kitchen', x0: 75.7, y0: 78.8, x1: 91.2, y1: 92.7, h: 1.2, kind: 'pad' },
  { id: 'media', name: 'Media Center', x0: 166.2, y0: 41.9, x1: 176.1, y1: 73.7, h: 2.2, kind: 'pad' },
  { id: 'm2027', name: 'MIHAS 2027', x0: 88.9, y0: 57.8, x1: 95.0, y1: 73.7, h: 2.2, kind: 'pad' },
  { id: 'photo', name: 'Photo Booth', x0: 140.4, y0: 41.9, x1: 146.6, y1: 54.6, h: 2.0, kind: 'pad' },
  { id: 'livebox', name: 'Live Box', x0: 123.2, y0: 82.7, x1: 127.3, y1: 89.4, h: 2.0, kind: 'pad' },
  { id: 'speaker', name: 'Speaker Lounge', x0: 6.3, y0: 48.2, x1: 9.9, y1: 54.6, h: 1.6, kind: 'pad' },
  { id: 'bernama', name: 'Bernama Studio', x0: 6.5, y0: 43.9, x1: 10.0, y1: 48.2, h: 1.6, kind: 'pad' },
  { id: 'merch', name: 'MIHAS Merchandise', x0: 8.8, y0: 35.7, x1: 20.7, y1: 38.8, h: 1.4, kind: 'pad' },
];

// Exhibitor names we can stand behind: floor plan V226 labels + official exhibitor list (mihas.com.my), matched by booth number.
const names = {
  '8H19': 'Dr Parveen', '8H15': 'JK Agri', '8H17B': 'UOB', '8E14': 'Bioalpha', '8C14': 'Biotropics',
  '7C17': 'Mamee Double Decker', '7C18': 'Mamee Double Decker', '7B14': 'F&N', '7B15': 'F&N', '6H14': 'F&N', '6H15': 'F&N',
  '7B12': 'JETRO', '6H12': 'JETRO', '7B13': 'Afyaa', '6H13': 'Afyaa', '6G29': 'USDA', '6G30': 'USDA',
  '6A17': 'Bank Simpanan Nasional', '6A18': 'Bank Simpanan Nasional', '7E23': 'Nexus Coffee', '7G18': 'Infopages',
  '7J09': 'BIG Caring Group', '7J10': 'BIG Caring Group', '8B09': 'BIG Caring Group', '8B10': 'BIG Caring Group',
  '6B14': 'Public Mutual', '6B10': 'ShokranPay', '7J14': 'Indonesia Eximbank', '6G09': 'California Milk',
  '8D26': 'T360', '8D11': 'GHB', '8D25': 'MRCA', '8D12': 'Sure Expo', '8C13': 'BBC',
};
for (const id of ['8G15', '8G16', '8G17A', '8G17B', '8G18A', '8G18B', '8G19', '8G20']) names[id] = 'Yapiem';
names[HERO_ID] = 'Lean X Digital · nexova';

// The organiser's public exhibitor list (tools/fetch-exhibitors.mjs) beats labels read off the drawing.
const officialFile = resolve(here, 'data/exhibitors.json');
const official = existsSync(officialFile) ? JSON.parse(readFileSync(officialFile, 'utf8')).booths : {};
const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const inside = (o, a) => o.x_m > a.x0 && o.x_m < a.x1 && o.y_m > a.y0 && o.y_m < a.y1;

// Phantoms: the PDF carries a hidden older layer. Everything north of y=75 west of x=95 sits under the Wellness Corner /
// Kitchen; entries inside pads are under those pads; 8J29/8J30 are the Bernama Studio, not booths.
const booths = raw.booths
  .filter((o) => !(o.y_m > 75 && o.x_m < 95))
  .filter((o) => !/^8J(29|30)$/.test(o.booth_id))
  .filter((o) => !areas.some((a) => inside(o, a)))
  .map((o) => ({
    id: o.booth_id,
    hall: Number(/^(\d{1,2})/.exec(o.booth_id)?.[1] ?? 0),
    x: +o.x_m.toFixed(2),
    y: +o.y_m.toFixed(2),
    name: o.booth_id === HERO_ID ? names[HERO_ID] : official[o.booth_id] ? shortName(official[o.booth_id].name) : names[o.booth_id] ?? '',
    sector: official[o.booth_id]?.sector ?? '',
    deck: 2,
  }))
  .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

const hero = booths.find((b) => b.id === HERO_ID);
if (!hero) throw new Error(`hero booth ${HERO_ID} missing from source data`);

const out = {
  level: 2,
  source: 'MIHAS 2026 Floor Plan V226, page 2',
  booth: { w: 2.82, d: 3.06, h: 2.6 },
  // Exhibition hall interior + the two public approaches players spawn in.
  hall: { x0: 3.4, y0: 35.0, x1: 184.0, y1: 110.0 },
  walkable: [
    { x0: 3.4, y0: 35.0, x1: 184.0, y1: 110.0 },   // hall
    { x0: 3.4, y0: 27.0, x1: 184.0, y1: 35.0 },    // south concourse (Hall 6/7/8 doors)
    { x0: 184.0, y0: 50.0, x1: 205.0, y1: 80.0 },  // east concourse (Hall 5 registration)
  ],
  walls: [
    { x0: 3.4, y0: 34.6, x1: 27.0, y1: 35.0 }, { x0: 43.0, y0: 34.6, x1: 89.0, y1: 35.0 },
    { x0: 103.0, y0: 34.6, x1: 150.0, y1: 35.0 }, { x0: 165.0, y0: 34.6, x1: 184.0, y1: 35.0 },
    { x0: 184.0, y0: 35.0, x1: 184.4, y1: 58.0 }, { x0: 184.0, y0: 70.0, x1: 184.4, y1: 110.0 },
  ],
  gates: [
    { id: 'hall8', name: 'Hall 8 entrance', x: 35.1, y: 34.8, axis: 'x' },
    { id: 'hall7', name: 'Hall 7 entrance', x: 96.0, y: 34.8, axis: 'x' },
    { id: 'hall6', name: 'Hall 6 entrance', x: 157.4, y: 34.8, axis: 'x' },
    { id: 'main', name: 'Main entrance · Hall 5', x: 184.2, y: 64.0, axis: 'y' },
  ],
  spawns: {
    short: { x: 35.1, y: 30.0, label: 'Hall 8 entrance', gate: 'hall8' },
    epic: { x: 198.0, y: 64.0, label: 'Main entrance', gate: 'main' },
  },
  hero: { id: HERO_ID, x: hero.x, y: hero.y, open: 'W', dock: { x: +(hero.x - 2.7).toFixed(2), y: hero.y } },
  areas: areas.map((a) => ({ ...a, deck: 2 })),
  booths,
  decks: [{ level: 2, x0: 2, y0: 26, x1: 206, y1: 111, boothD: 3.06, label: 'Deck 2 · Halls 6–8' }],
  halls: [{ id: 8, deck: 2, x0: 3.4, x1: 66.5, y0: 35, y1: 110 }, { id: 7, deck: 2, x0: 66.5, x1: 127, y0: 35, y1: 110 }, { id: 6, deck: 2, x0: 127, x1: 184, y0: 35, y1: 110 }],
  // The two lifts that stand between the halls on every level (positions read off the plan's LIFT labels).
  lifts: [{ id: 'west', deck: 2, x: 63.5, y: 31.5, label: 'West lift' }, { id: 'east', deck: 2, x: 124.5, y: 31.5, label: 'East lift' }],
};

const level2Count = booths.length;

/* ---------------- Levels 1 and 3 ---------------- */
const r1 = (n) => +n.toFixed(2);
const FRONT_LIFTS = { 1: [[66.5, 43.25], [126.38, 43.25]], 3: [[79.48, 31.61], [140.7, 31.61]] };
const GAP = 45; // metres of "space" between platforms
for (const lv of [1, 3]) {
  const file = resolve(here, `data/level${lv}.json`);
  if (!existsSync(file)) { console.warn(`  level ${lv}: tools/data/level${lv}.json missing — run node tools/build-decks.mjs`); continue; }
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const bx = d.booths.map((b) => b.x), by = d.booths.map((b) => b.y);
  // keep only areas that belong to the exhibition floor (the PDF also labels lobbies and back-of-house)
  const floorAreas = d.areas.filter((a) => (a.x0 + a.x1) / 2 > Math.min(...bx) - 14 && (a.x0 + a.x1) / 2 < Math.max(...bx) + 8 && (a.y0 + a.y1) / 2 < Math.max(...by) + 24);
  const hall = { x0: Math.min(...bx, ...floorAreas.map((a) => a.x0)) - 5, x1: Math.max(...bx, ...floorAreas.map((a) => a.x1)) + 5, y0: Math.min(...by) - 6, y1: Math.max(...by, ...floorAreas.map((a) => a.y1)) + 4 };
  const lifts = FRONT_LIFTS[lv], frontY = Math.min(hall.y0, ...lifts.map((l) => l[1] - 4)) - 6;
  const dy = lv === 1 ? out.decks[0].y0 - GAP - hall.y1 : out.decks[0].y1 + GAP - frontY;
  const Y = (y) => r1(y + dy);

  out.decks.push({ level: lv, x0: r1(hall.x0 - 3), y0: Y(frontY - 1), x1: r1(hall.x1 + 3), y1: Y(hall.y1 + 1), boothD: 2.82, label: `Deck ${lv} · Halls ${d.halls.map((h) => h.id).sort((a, b) => a - b).join(', ').replace(/, (\d+)$/, '–$1').replace(/^(\d+), .*–/, '$1–')}` });
  out.walkable.push({ x0: r1(hall.x0), y0: Y(hall.y0), x1: r1(hall.x1), y1: Y(hall.y1) }, { x0: r1(hall.x0), y0: Y(frontY), x1: r1(hall.x1), y1: Y(hall.y0) });
  const hs = [...d.halls].sort((a, b) => a.x0 - b.x0);
  hs.forEach((h, i) => out.halls.push({ id: h.id, deck: lv, x0: r1(i ? (hs[i - 1].x1 + h.x0) / 2 : hall.x0), x1: r1(i < hs.length - 1 ? (h.x1 + hs[i + 1].x0) / 2 : hall.x1), y0: Y(hall.y0), y1: Y(hall.y1) }));
  lifts.forEach(([x, y], i) => out.lifts.push({ id: i ? 'east' : 'west', deck: lv, x: r1(x), y: Y(y), label: i ? 'East lift' : 'West lift' }));
  d.entrances.filter((e) => e.y < hall.y0 + 3 && e.y > frontY - 6 && e.x > hall.x0 && e.x < hall.x1).forEach((e, i) => out.gates.push({ id: `l${lv}-e${i}`, name: `Hall ${hs.find((h) => e.x <= h.x1 + 3)?.id ?? ''} entrance`.replace('  ', ' '), x: r1(e.x), y: Y(hall.y0 - 0.2), axis: 'x' }));
  for (const a of floorAreas) out.areas.push({ ...a, id: `l${lv}-${a.id}`, y0: Y(a.y0), y1: Y(a.y1), deck: lv });
  for (const b of d.booths) out.booths.push({ ...b, y: Y(b.y), deck: lv });
  console.log(`  level ${lv}: ${d.booths.length} booths, ${floorAreas.length} areas, shifted ${dy > 0 ? '+' : ''}${dy.toFixed(1)} m → y ${Y(frontY)}…${Y(hall.y1)}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`  ${booths.filter((b) => official[b.id]).length} names from the official list, ${booths.filter((b) => b.name && !official[b.id]).length} from plan labels`);
console.log(`floor.json: ${out.booths.length} booths on ${out.decks.length} decks, ${out.halls.length} halls, ${out.booths.filter((b) => b.name).length} named · Level 2: ${level2Count} booths (${raw.booths.length - level2Count} phantoms removed), ${booths.filter((b) => b.name).length} named, hero ${HERO_ID} @ ${hero.x},${hero.y}`);
