// Snapshots the official MIHAS exhibitor list (public page) into tools/data/exhibitors.json: { "<booth>": { name, sector } }.
// Run it again whenever the organiser updates the list:   node tools/fetch-exhibitors.mjs
// Pass a saved HTML file to work offline:                  node tools/fetch-exhibitors.mjs page.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_LIST = 'https://www.mihas.com.my/exhibitor/exhibitors-list';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'data/exhibitors.json');

const html = process.argv[2]
  ? readFileSync(process.argv[2], 'utf8')
  : await fetch(URL_LIST, { headers: { 'user-agent': 'Mozilla/5.0 (mission-x floor data build)' } }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<!--.*?-->/g, '').trim();
const KEEP_UPPER = new Set(['SDN', 'BHD', 'PLT', 'USA', 'UAE', 'FGV', 'FFM', 'BSN', 'UOB', 'CIMB', 'AIA', 'JETRO', 'KOTRA', 'USDA', 'SME', 'MARA', 'PUNB', 'UDA', 'HDC', 'JAKIM', 'SIRIM', 'QL', 'CYL', 'TSL', 'MBG', 'PKNS', 'DTI', 'F&N', 'IT', 'AI', 'II', 'III', 'M&S', 'NZ', 'UK', 'PT', 'CV', 'LLC', 'LTD', 'CO', 'INC']);
const SMALL = new Set(['of', 'and', 'the', 'for', 'de', 'di', 'in', 'at', 'by']);
const title = (s) => s.split(/\s+/).map((w, i) => {
  const bare = w.replace(/[^A-Za-z&]/g, '').toUpperCase();
  if (KEEP_UPPER.has(bare) || /\d/.test(w)) return w.toUpperCase() === w ? w : w;
  if (/^\(.\)$/.test(w)) return w.toUpperCase();                       // (M) as in "(M) Sdn Bhd"
  if (i && SMALL.has(w.toLowerCase())) return w.toLowerCase();
  return w.replace(/[A-Za-z]+/g, (p) => p[0].toUpperCase() + p.slice(1).toLowerCase());
}).join(' ').replace(/\bCo\.ltd\b/gi, 'Co. Ltd').replace(/\bSdn\.? Bhd\.?/gi, 'Sdn Bhd');

/** "8D06 – 8D09" → 8D06, 8D07, 8D08, 8D09.  "3F01-04" works too. */
function expand(token) {
  const r = /^((?:1[01]|[1-9])[A-J])(\d{2})\s*[–—-]\s*(?:(?:1[01]|[1-9])[A-J])?(\d{2})$/.exec(token);
  if (!r) return [token];
  const out = []; for (let n = +r[2]; n <= +r[3] && out.length < 40; n++) out.push(r[1] + String(n).padStart(2, '0'));
  return out;
}

const re = /<p class="font-body font-bold[^"]*">([\s\S]*?)<\/p>\s*<p class="font-body-sm[^"]*">([\s\S]*?)<\/p>[\s\S]*?Booth\s*(?:<!--\s*-->)?\s*([^<]*)<\/span>/g;
const booths = {}, skipped = [];
let m, companies = 0;
while ((m = re.exec(html))) {
  const name = title(decode(m[1])), sector = decode(m[2]);
  const ids = decode(m[3]).split(/[,;/&]/).map((s) => s.trim().toUpperCase()).filter(Boolean).flatMap(expand);
  companies++;
  for (const id of ids) {
    if (/^(1[01]|[1-9])[A-J]\d{2}[AB]?$/.test(id)) booths[id] ??= { name, sector }; // first listing wins on the rare shared booth
    else skipped.push(`${id} (${name})`);
  }
}
if (companies < 100) throw new Error(`only ${companies} exhibitors parsed — the page markup has probably changed`);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ source: URL_LIST, fetchedAt: new Date().toISOString().slice(0, 10), companies, booths }, null, 1));
const perLevel = [0, 0, 0];
for (const id of Object.keys(booths)) { const h = parseInt(id, 10); perLevel[h <= 4 ? 0 : h <= 8 ? 1 : 2]++; }
console.log(`exhibitors.json: ${companies} companies → ${Object.keys(booths).length} booths (Level 1: ${perLevel[0]}, Level 2: ${perLevel[1]}, Level 3: ${perLevel[2]}); skipped non-booth entries: ${skipped.length}`);
if (skipped.length) console.log('  e.g.', skipped.slice(0, 6).join(' | '));
