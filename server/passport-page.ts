// Public card page + vCard. This is the local stand-in for a nexova-hosted card page:
// swap `renderPassport` for a redirect to the nexova URL once that API exists.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface PassportPageData { slug: string; name: string; company: string; role: string; phone: string; email: string; callsign: string }

export function renderPassport(p: PassportPageData, origin: string): string {
  const wa = p.phone ? `https://wa.me/${p.phone.replace(/\D/g, '')}` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.name)} — digital business card</title><meta name="robots" content="noindex">
<link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;600;800&display=swap" rel="stylesheet">
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Urbanist,system-ui,sans-serif;color:#f4fbff;background:radial-gradient(120% 90% at 50% 110%,#1aa9c9 0,#0b5f86 38%,#041a2c 78%)}
.card{width:min(380px,calc(100vw - 32px));border-radius:24px;padding:26px;background:rgba(4,26,44,.72);border:1px solid rgba(111,227,255,.3);backdrop-filter:blur(12px);box-shadow:0 30px 80px rgba(0,0,0,.45)}
.k{font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#6fe3ff}.k b{color:#ffc629}
h1{margin:10px 0 2px;font-size:30px;line-height:1.05;font-weight:800}p{margin:0;opacity:.85}
.row{display:grid;gap:10px;margin-top:20px}a.btn{display:block;text-align:center;text-decoration:none;font-weight:800;padding:13px;border-radius:999px;border:1px solid rgba(111,227,255,.4);color:#f4fbff}
a.primary{background:#ffc629;color:#1b1400;border-color:#ffc629}.foot{margin-top:18px;font-size:12px;opacity:.6;text-align:center}.foot a{color:#6fe3ff}
</style></head><body><main class="card">
<div class="k">Digital business card · <b>Mission X</b> · MIHAS 2026</div>
<h1>${esc(p.name)}</h1><p>${esc(p.role)}${p.role && p.company ? ' · ' : ''}${esc(p.company)}</p>
<div class="row">
<a class="btn primary" href="${origin}/p/${esc(p.slug)}/vcard">Save contact</a>
${wa ? `<a class="btn" href="${esc(wa)}">WhatsApp</a>` : ''}${p.email ? `<a class="btn" href="mailto:${esc(p.email)}">Email</a>` : ''}
</div>
<div class="foot">Built live at MIHAS 2026 by <a href="https://www.nexova.my">nexova</a> · Lean X Digital, Booth 8H18B</div>
</main></body></html>`;
}

export function renderVcard(p: PassportPageData, origin: string): string {
  const v = (s: string) => s.replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, ' ');
  return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${v(p.name)}`, `N:${v(p.name)};;;;`, p.company && `ORG:${v(p.company)}`, p.role && `TITLE:${v(p.role)}`,
    p.phone && `TEL;TYPE=CELL:${v(p.phone)}`, p.email && `EMAIL:${v(p.email)}`, `URL:${origin}/p/${p.slug}`, 'NOTE:Met via Mission X at MIHAS 2026', 'END:VCARD'].filter(Boolean).join('\r\n');
}
