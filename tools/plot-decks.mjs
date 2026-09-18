// Dev tool: draws level1/level3 JSON as one SVG so the data can be eyeballed against the plan images.
import { readFileSync, writeFileSync } from 'node:fs';
const S = 5; let y0 = 10, svg = '';
for (const lv of [3, 1]) {
  const d = JSON.parse(readFileSync(`public/data/level${lv}.json`, 'utf8')), h = d.hall, H = (h.y1 - h.y0) * S;
  const X = (x) => (x - h.x0) * S + 10, Y = (y) => y0 + H - (y - h.y0) * S;
  svg += `<rect x="10" y="${y0}" width="${(h.x1 - h.x0) * S}" height="${H}" fill="#0b3a57" stroke="#3fd8ff"/><text x="16" y="${y0 + 16}" fill="#6fe3ff" font-size="14" font-family="Arial">LEVEL ${lv} · ${d.booths.length} booths · ${d.booths.filter((b) => b.name).length} named</text>`;
  for (const a of d.areas) svg += `<rect x="${X(a.x0)}" y="${Y(a.y1)}" width="${(a.x1 - a.x0) * S}" height="${(a.y1 - a.y0) * S}" fill="${a.kind === 'zone' ? '#0f7a78' : '#39506b'}" stroke="#6fe3ff" opacity=".8"/><text x="${X((a.x0 + a.x1) / 2)}" y="${Y((a.y0 + a.y1) / 2)}" fill="#fff" font-size="10" text-anchor="middle" font-family="Arial">${a.name}</text>`;
  for (const b of d.booths) svg += `<rect x="${X(b.x) - 1.35 * S}" y="${Y(b.y) - 1.35 * S}" width="${2.7 * S}" height="${2.7 * S}" fill="${b.name ? '#ffc629' : ['#22b8d4', '#2f8fd6', '#5b7de0'][b.hall % 3]}"/>`;
  for (const c of d.connectors) if (c.x > h.x0 - 20 && c.x < h.x1 + 20) svg += `<circle cx="${X(c.x)}" cy="${Y(c.y)}" r="4" fill="${c.kind === 'escalator' ? '#ff5fd2' : '#3ddc84'}"/>`;
  for (const e of d.entrances) svg += `<path d="M${X(e.x) - 6} ${Y(e.y)}h12" stroke="#fff" stroke-width="3"/>`;
  y0 += H + 30;
}
writeFileSync('public/decks-check.html', `<!doctype html><body style="margin:0;background:#041a2c"><svg xmlns="http://www.w3.org/2000/svg" width="960" height="${y0}">${svg}</svg>`);
console.log('wrote public/decks-check.html', y0);
