// Builds public/data/level1.json and level3.json straight from the master floor plan PDF with pdf.js.
// Method validated on Level 2, where it lands within 0.20 m (median) / 0.35 m (p95) of the hand-verified file.
// Each level is in its own page frame (metres, origin lower-left, +y north). Aligning the decks to each other is a
// runtime concern — the plan pages are drawn at different scales and crops.
//   node tools/build-decks.mjs ["path/to/MIHAS 2026 Floor Plan V226.pdf"]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPage } from './pdf-probe.mjs';
import { shortName } from './names.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PDF = process.argv[2] ?? resolve(here, '../../MIHAS 2026 Floor Plan V226.pdf');
const official = existsSync(resolve(here, 'data/exhibitors.json')) ? JSON.parse(readFileSync(resolve(here, 'data/exhibitors.json'), 'utf8')).booths : {};

// Special areas are labelled on the plan as a name with a size line underneath ("54.5m X 26.5m"): centre + size = rectangle.
// walk: can you stand in it? (lounges yes; stages, kitchens, offices no)
const AREAS = {
  1: [
    { id: 'kitchen', name: 'MIHAS Kitchen', near: /^MIHAS KITCHEN$/i, w: 15, d: 12, walk: false },
    { id: 'kitchen-area', name: 'Kitchen Area', near: /^KITCHEN AREA$/i, walk: false },
    { id: 'vip', name: 'VIP Lounge', near: /^VIP LOUNGE$/i, walk: true },
    { id: 'premium-vip', name: 'Premium VIP Lounge', near: /^PREMIUM VIP LOUNGE$/i, walk: true },
    { id: 'buyer', name: 'Buyer Lounge', near: /^BUYER LOUNGE$/i, walk: true },
  ],
  3: [
    { id: 'cafe', name: 'Café & Visitor Lounge', near: /^VISITOR LOUNGE$/i, walk: true },
    { id: 'wellness', name: 'Wellness Corner', near: /^WELLNESS$/i, walk: true },
    { id: 'stage', name: 'Main Stage', near: /^Stage$/, walk: false },
    { id: 'fitting', name: 'Fitting Room', near: /^FITTING ROOM$/i, walk: false },
    { id: 'crew', name: 'Crew Area', near: /^CREW AREA$/i, walk: false },
    { id: 'organiser', name: 'Organiser Area', near: /^ORGANISER$/i, walk: false },
    { id: 'vip', name: 'VIP Lounge', near: /^LOUNGE$/, walk: true },
  ],
};
const SIZE = /^(\d+(?:\.\d+)?)\s*m\s*[xX]\s*(\d+(?:\.\d+)?)\s*m$/i;

for (const [level, page] of [[1, 1], [3, 3]]) {
  const r = await readPage(PDF, page), k = r.mPerPt, M = (i) => ({ ...i, x: +(i.x * k).toFixed(2), y: +(i.y * k).toFixed(2) });
  const items = r.items.map(M);

  const areas = [];
  for (const a of AREAS[level]) {
    const label = items.find((i) => a.near.test(i.s)); if (!label) { console.warn(`  level ${level}: area label not found: ${a.name}`); continue; }
    // the size line sits within a few metres below (or beside) its label
    const size = items.filter((i) => SIZE.test(i.s)).map((i) => ({ i, d: Math.hypot(i.x - label.x, i.y - label.y) })).filter((c) => c.d < 9).sort((p, q) => p.d - q.d)[0];
    const m = size ? SIZE.exec(size.i.s) : null, w = a.w ?? (m ? +m[1] : null), d = a.d ?? (m ? +m[2] : null);
    if (!w || !d) { console.warn(`  level ${level}: no size for ${a.name}`); continue; }
    const cx = size ? (label.x + size.i.x) / 2 : label.x, cy = size ? (label.y + size.i.y) / 2 : label.y;
    // plan sizes are width × depth as drawn; on these pages the long side runs east–west except where the label says otherwise
    const [ww, dd] = level === 3 && (a.id === 'wellness' || a.id === 'organiser' || a.id === 'vip') ? [Math.min(w, d), Math.max(w, d)] : [Math.max(w, d), Math.min(w, d)];
    areas.push({ id: a.id, name: a.name, x0: +(cx - ww / 2).toFixed(1), y0: +(cy - dd / 2).toFixed(1), x1: +(cx + ww / 2).toFixed(1), y1: +(cy + dd / 2).toFixed(1), h: a.walk ? 0.4 : 1.6, kind: a.walk ? 'zone' : 'pad' });
  }

  const inside = (b, a) => b.x > a.x0 && b.x < a.x1 && b.y > a.y0 && b.y < a.y1;
  const all = r.ids.map(M), phantoms = all.filter((b) => areas.some((a) => inside(b, a)));
  const booths = all.filter((b) => !phantoms.includes(b)).map((b) => {
    const o = official[b.s];
    return { id: b.s, hall: parseInt(b.s, 10), x: b.x, y: b.y, name: o ? shortName(o.name) : '', sector: o?.sector ?? '' };
  }).sort((p, q) => p.id.localeCompare(q.id, 'en', { numeric: true }));

  const xs = booths.map((b) => b.x), ys = booths.map((b) => b.y);
  const hall = { x0: +(Math.min(...xs) - 6).toFixed(1), y0: +(Math.min(...ys) - 6).toFixed(1), x1: +(Math.max(...xs) + 6).toFixed(1), y1: +(Math.max(...ys, ...areas.map((a) => a.y1)) + 3).toFixed(1) };
  const halls = [...new Set(booths.map((b) => b.hall))].sort((p, q) => p - q).map((h) => { const hx = booths.filter((b) => b.hall === h).map((b) => b.x); return { id: h, x0: +(Math.min(...hx) - 3).toFixed(1), x1: +(Math.max(...hx) + 3).toFixed(1) }; });
  const pick = (re, kind) => items.filter((i) => re.test(i.s)).map((i) => ({ kind, x: i.x, y: i.y }));
  const connectors = [...pick(/^ESCALATOR$/i, 'escalator'), ...pick(/^(CARGO |SERVICE )?LIFT( LIFT)?$/i, 'lift')];
  const entrances = pick(/^ENTRANCE( \/ EXIT| ONLY)?$/i, 'entrance');

  const out = { level, source: `MIHAS 2026 Floor Plan V226, page ${page} (pdf.js text layer, ${r.ptPer3m.toFixed(2)} pt = 3 m)`, booth: { w: 2.82, d: 2.82, h: 2.6 }, hall, halls, areas, connectors, entrances, booths };
  writeFileSync(resolve(here, `data/level${level}.json`), JSON.stringify(out));
  const named = booths.filter((b) => b.name).length, perHall = halls.map((h) => `H${h.id}: ${booths.filter((b) => b.hall === h.id).length}`).join(', ');
  console.log(`level${level}.json: ${booths.length} booths (${perHall}) · ${phantoms.length} phantoms under ${[...new Set(phantoms.map((p) => areas.find((a) => inside(p, a)).name))].join(', ') || '—'} · ${named} named from the official list · ${areas.length} areas · ${connectors.length} lifts/escalators · ${entrances.length} entrances · hall ${hall.x1 - hall.x0 | 0}×${hall.y1 - hall.y0 | 0} m`);
}
