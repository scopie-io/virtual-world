// Dev tool: what does pdf.js see on each page of the master floor plan? Prints scale calibration and label inventory.
//   node tools/pdf-probe.mjs "../MIHAS 2026 Floor Plan V226.pdf"
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, existsSync } from 'node:fs';

export const ID = /^(1[01]|[1-9])[A-J]\d{2}[AB]?$/;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export async function readPage(file, pageNo) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, verbosity: 0 }).promise;
  const page = await doc.getPage(pageNo), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
  // anchor each string at its centre, so rotated and wide labels land where the eye reads them
  const items = tc.items.filter((i) => i.str?.trim()).map((i) => {
    const [a, b, , , e, f] = i.transform, len = Math.hypot(a, b) || 1, ux = a / len, uy = b / len;
    return { s: i.str.trim(), x: e + (ux * i.width) / 2, y: f + (uy * i.width) / 2, rot: Math.round((Math.atan2(b, a) * 180) / Math.PI) };
  });
  const ids = items.filter((i) => ID.test(i.s));
  // Calibration: booths stand back-to-back in column pairs exactly one booth (3 m) apart.
  const dx = [];
  for (const p of ids) { let best = Infinity; for (const q of ids) { if (p !== q && Math.abs(p.y - q.y) < 1.2) { const d = Math.abs(p.x - q.x); if (d > 4 && d < best) best = d; } } if (best < 14) dx.push(best); }
  const ptPer3m = median(dx);
  return { size: [vp.width, vp.height], items, ids, ptPer3m, mPerPt: 3 / ptPer3m };
}

if (process.argv[1]?.endsWith('pdf-probe.mjs')) {
  const file = process.argv[2];
  for (const p of [1, 2, 3]) {
    const r = await readPage(file, p), k = r.mPerPt;
    const dy = []; for (const a of r.ids) { let best = Infinity; for (const b of r.ids) if (a !== b && Math.abs(a.x - b.x) < 1.2) { const d = Math.abs(a.y - b.y); if (d > 4 && d < best) best = d; } if (best < 14) dy.push(best); }
    const halls = {}; for (const i of r.ids) { const h = parseInt(i.s, 10); halls[h] = (halls[h] ?? 0) + 1; }
    console.log(`\n=== page ${p}: ${r.size.map((v) => v.toFixed(0)).join('×')} pt · ${r.ids.length} ids (${new Set(r.ids.map((i) => i.s)).size} unique) · 3 m = ${r.ptPer3m.toFixed(2)} pt → ${(k * r.size[0]).toFixed(0)}×${(k * r.size[1]).toFixed(0)} m · row pitch ${(median(dy) * k).toFixed(2)} m · halls ${JSON.stringify(halls)}`);
    const big = r.items.filter((i) => /\d+(\.\d+)?\s*m\s*[xX]\s*\d|CAFE|LOUNGE|STAGE|WELLNESS|CREW|ORGANI|FITTING|KITCHEN|CORNER|MEDIA|PHOTO|MOU|Merchandise|Speaker|Studio|LIVE|Sponsors|ENTRANCE|REGISTRATION|ESCALATOR|LIFT/i.test(i.s));
    console.log(big.map((i) => `${i.s} @${(i.x * k).toFixed(1)},${(i.y * k).toFixed(1)}${i.rot ? ' r' + i.rot : ''}`).join(' | ').slice(0, 2600));
  }
  // Cross-check against the hand-verified Level 2 file
  const ref = '../MIHAS_2026_Level2_AI_3D_Reference.json';
  if (existsSync(ref)) {
    const known = new Map(JSON.parse(readFileSync(ref, 'utf8')).booths.map((b) => [b.booth_id, b])), r = await readPage(file, 2), k = r.mPerPt;
    const pairs = r.ids.filter((i) => known.has(i.s)).map((i) => ({ dx: i.x * k - known.get(i.s).x_m, dy: i.y * k - known.get(i.s).y_m }));
    const mx = median(pairs.map((p) => p.dx)), my = median(pairs.map((p) => p.dy));
    const resid = pairs.map((p) => Math.hypot(p.dx - mx, p.dy - my)).sort((a, b) => a - b);
    console.log(`\nLevel 2 cross-check: ${pairs.length} shared ids · offset ${mx.toFixed(2)}, ${my.toFixed(2)} m · residual median ${resid[Math.floor(resid.length / 2)].toFixed(2)} m, p95 ${resid[Math.floor(resid.length * 0.95)].toFixed(2)} m`);
  }
}
