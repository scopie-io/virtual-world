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
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Urbanist,system-ui,sans-serif;color:#1b2130;background:#f2f0eb;-webkit-font-smoothing:antialiased}
.card{width:min(380px,calc(100vw - 32px));border-radius:22px;padding:28px;background:#fff;box-shadow:0 1px 2px rgba(27,33,48,.06),0 10px 28px rgba(27,33,48,.1)}
.k{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8b91a0}.k b{color:#1b2130}
h1{margin:10px 0 2px;font-size:30px;line-height:1.08;font-weight:800;letter-spacing:-.01em}p{margin:0;color:#5a6172}
.row{display:grid;gap:10px;margin-top:22px}a.btn{display:block;text-align:center;text-decoration:none;font-weight:700;padding:14px;border-radius:14px;border:1px solid rgba(27,33,48,.2);color:#1b2130}
a.primary{background:#2457f5;color:#fff;border-color:#2457f5}.foot{margin-top:20px;font-size:12.5px;color:#8b91a0;text-align:center}.foot a{color:#2457f5}
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
