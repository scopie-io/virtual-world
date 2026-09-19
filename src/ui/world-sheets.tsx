// The map of MITEC (with search and the list of places folded into it) and the photo you just took.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Engine } from '../game/engine';
import type { Booth } from '../../shared/types';
import { buildPlaces } from '../game/places';
import { hallCards, hallLine } from '../game/facts';
import { Sheet } from './common';
import { currentDeck, guideOn, guideTarget, level, modal, photoShot, seen, stampedSet, stationMap, toast } from '../state';

type Eng = { engine: () => Engine | null };
const COLORS = { floor: '#d9d5cb', hall: '#e6e3db', area: '#d5dcd8', booth: '#ffffff', edge: '#c6c1b5', ink: '#1b2130', soft: '#8b91a0', blue: '#2457f5', gold: '#f2b01e', green: '#cdeadb', greenInk: '#1e9e6a' };

export function MapSheet({ engine }: Eng) {
  const lv = level.value!, [deck, setDeck] = useState(currentDeck.value), [q, setQ] = useState(''), canvas = useRef<HTMLCanvasElement>(null), wrap = useRef<HTMLDivElement>(null);
  const places = useMemo(() => buildPlaces(lv).filter((p) => p.open), [lv]), halls = useMemo(() => hallCards(lv), [lv]);
  const d = lv.decks.find((k) => k.level === deck)!, sm = stationMap.value, stamped = stampedSet.value, been = seen.value;
  const total = places.length + halls.length, count = [...been].filter((k) => k.startsWith('place:') || k.startsWith('hall:')).length;
  const go = (x: number, y: number, label: string) => { guideTarget.value = { x, y, label }; guideOn.value = true; modal.value = null; toast('Trail set', label); };
  const name = (b: Booth) => sm.get(b.id)?.company || b.name || `Booth ${b.id}`;

  // plan metres → canvas pixels, north up
  const view = () => { const w = wrap.current?.clientWidth ?? 320, pad = 6, s = (w - pad * 2) / (d.x1 - d.x0 + 8); return { w, h: Math.round((d.y1 - d.y0 + 8) * s + pad * 2), s, px: (x: number) => pad + (x - d.x0 + 4) * s, py: (y: number) => pad + (d.y1 + 4 - y) * s }; };

  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const v = view(), dpr = Math.min(devicePixelRatio || 1, 2), g = c.getContext('2d')!; c.width = v.w * dpr; c.height = v.h * dpr; c.style.height = v.h + 'px'; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rect = (x0: number, y0: number, x1: number, y1: number) => g.fillRect(v.px(x0), v.py(y1), (x1 - x0) * v.s, (y1 - y0) * v.s);
    g.fillStyle = COLORS.floor; g.fillRect(0, 0, v.w, v.h);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const h of lv.halls.filter((k) => k.deck === deck)) { g.fillStyle = COLORS.hall; rect(h.x0, h.y0, h.x1, h.y1); }
    for (const p of buildPlaces(lv).filter((k) => k.deck === deck)) { g.fillStyle = COLORS.area; rect(p.rect.x0, p.rect.y0, p.rect.x1, p.rect.y1); }
    const bw = lv.booth.w / 2 - 0.12, bd = d.boothD / 2 - 0.12;
    for (const b of lv.booths) { if (b.deck !== deck || b.id === lv.hero.id) continue; g.fillStyle = stamped.has(b.id) ? COLORS.gold : sm.has(b.id) ? COLORS.green : COLORS.booth; rect(b.x - bw, b.y - bd, b.x + bw, b.y + bd); }
    g.fillStyle = COLORS.soft; g.font = '800 11px Urbanist, Arial'; // hall numbers sit in the entrance aisle, below the booths, where there is room
    for (const h of lv.halls.filter((k) => k.deck === deck)) g.fillText(`HALL ${h.id}`, v.px((h.x0 + h.x1) / 2), v.py(h.y0 - 2.6));
    g.fillStyle = COLORS.blue; for (const l of lv.lifts) if (l.deck === deck) { g.beginPath(); g.arc(v.px(l.x), v.py(l.y), Math.max(3, 2.2 * v.s), 0, 7); g.fill(); }
    if (deck === 2) { // the X, in its own colours
      const x = v.px(lv.hero.x), y = v.py(lv.hero.y), r = Math.max(6, 3.2 * v.s); g.lineWidth = Math.max(2.5, 1.1 * v.s); g.lineCap = 'round';
      g.strokeStyle = '#3aa8ff'; g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.stroke(); g.strokeStyle = '#ffc629'; g.beginPath(); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
    }
    const t = guideTarget.value; if (t && t.y >= d.y0 - 15 && t.y <= d.y1 + 15) { g.strokeStyle = COLORS.blue; g.lineWidth = 2; g.beginPath(); g.arc(v.px(t.x), v.py(t.y), 7, 0, 7); g.stroke(); }
    const me = engine()?.position; if (me && engine()!.levelOf(me) === deck) { g.fillStyle = '#fff'; g.beginPath(); g.arc(v.px(me.x), v.py(me.y), 7, 0, 7); g.fill(); g.fillStyle = COLORS.blue; g.beginPath(); g.arc(v.px(me.x), v.py(me.y), 4.5, 0, 7); g.fill(); }
    g.fillStyle = COLORS.ink; g.font = '700 10px Urbanist, Arial';
    for (const p of places.filter((k) => k.deck === deck && (k.rect.x1 - k.rect.x0) * v.s > 56)) g.fillText(p.name.split(' · ')[0]!.slice(0, 22), v.px((p.rect.x0 + p.rect.x1) / 2), v.py((p.rect.y0 + p.rect.y1) / 2));
  }, [deck, stamped, sm, lv]);

  const tap = (e: MouseEvent) => {
    const v = view(), r = canvas.current!.getBoundingClientRect(), x = d.x0 - 4 + (e.clientX - r.left - 6) / v.s, y = d.y1 + 4 - (e.clientY - r.top - 6) / v.s;
    const booth = lv.booths.filter((b) => b.deck === deck).map((b) => ({ b, k: Math.hypot(b.x - x, b.y - y) })).sort((a, b) => a.k - b.k)[0];
    const place = places.find((p) => p.deck === deck && x >= p.rect.x0 && x <= p.rect.x1 && y >= p.rect.y0 && y <= p.rect.y1);
    if (place) return go((place.rect.x0 + place.rect.x1) / 2, (place.rect.y0 + place.rect.y1) / 2, place.name);
    if (booth && booth.k < 3.5) return booth.b.id === lv.hero.id ? go(lv.hero.dock.x, lv.hero.dock.y, 'The X · Booth 8H18B') : go(booth.b.x, booth.b.y, name(booth.b));
    if (x >= d.x0 && x <= d.x1 && y >= d.y0 && y <= d.y1) go(x, y, 'A spot on the map');
  };

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return null;
    return lv.booths.filter((b) => b.id.toLowerCase().includes(t) || b.name.toLowerCase().includes(t) || (sm.get(b.id)?.company.toLowerCase().includes(t) ?? false)).slice(0, 30);
  }, [q, lv, sm]);

  return (
    <Sheet k={`MITEC · ${count} of ${total} places seen`} title="Where to?" wide>
      <label>Booth number or exhibitor<input value={q} placeholder="e.g. 7C17, Mamee, UOB" onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></label>
      {hits ? (
        <div class="results">
          {hits.map((b) => <button key={b.id} class="result" onClick={() => go(b.x, b.y, name(b))}><strong>{name(b)}</strong><small>Booth {b.id} · Hall {b.hall} · Level {b.deck}{b.sector ? ` · ${b.sector}` : ''}{sm.has(b.id) ? ' · online' : ''}{stamped.has(b.id) ? ' · stamped' : ''}</small></button>)}
          {hits.length === 0 && <p class="fine">No booth or exhibitor matches on any of the three levels.</p>}
        </div>
      ) : (
        <>
          <div class="seg three">{[...lv.decks].sort((a, b) => a.level - b.level).map((k) => <button key={k.level} class={k.level === deck ? 'on' : ''} onClick={() => setDeck(k.level)}><strong>Level {k.level}</strong><small>{k.label.split(' · ')[1]}</small></button>)}</div>
          <div ref={wrap} class="mapwrap"><canvas ref={canvas} class="map" onClick={tap} role="img" aria-label={`Map of level ${deck}. Tap to set a trail.`} /></div>
          <p class="fine">Tap anywhere to be guided there. White booths, <b class="gold-t">gold</b> once you have stamped them, <b class="green-t">green</b> when the exhibitor is online. Blue dots are lifts.</p>
          <div class="results flow" style={{ marginTop: '12px' }}>
            {deck === 2 && <button class="result hero" onClick={() => go(lv.hero.dock.x, lv.hero.dock.y, 'The X · Booth 8H18B')}><strong>The X — Lean X Digital · nexova</strong><small>Booth 8H18B · Hall 8 · your free digital business card</small></button>}
            {places.filter((p) => p.deck === deck).map((p) => <button key={p.id} class={'result' + (been.has(`place:${p.id}`) ? ' seen' : '')} onClick={() => go((p.rect.x0 + p.rect.x1) / 2, (p.rect.y0 + p.rect.y1) / 2, p.name)}><strong>{p.name}</strong><small>{p.blurb}</small></button>)}
            {halls.filter((h) => h.level === deck).map((h) => { const r = lv.halls.find((k) => k.id === h.hall)!; return <button key={h.hall} class={'result' + (been.has(`hall:${h.hall}`) ? ' seen' : '')} onClick={() => go((r.x0 + r.x1) / 2, r.y0 + (r.y1 - r.y0) * 0.28, `Hall ${h.hall}`)}><strong>Hall {h.hall}</strong><small>{hallLine(h)}</small></button>; })}
          </div>
        </>
      )}
    </Sheet>
  );
}

export function PhotoSheet() {
  const url = photoShot.value, [canShare, setCanShare] = useState(false);
  const file = async () => new File([await (await fetch(url!)).blob()], 'mission-x-mihas-2026.jpg', { type: 'image/jpeg' });
  useEffect(() => { void (async () => { try { setCanShare(!!url && !!navigator.canShare?.({ files: [await file()] })); } catch { setCanShare(false); } })(); }, [url]);
  if (!url) return null;
  return (
    <Sheet k="Photo" title="You, at MIHAS 2026">
      <img class="shot" src={url} alt="Your astronaut waving at MIHAS 2026" />
      <div class="stack">
        {canShare && <button class="btn primary big" onClick={async () => { try { await navigator.share({ files: [await file()], title: 'Mission X at MIHAS 2026', text: 'Find the X — Booth 8H18B, MIHAS 2026.' }); } catch { /* closed the share sheet */ } }}>Share</button>}
        <a class={'btn big' + (canShare ? '' : ' primary')} href={url} download="mission-x-mihas-2026.jpg">Save to this device</a>
      </div>
      <p class="fine">Nothing is uploaded: the picture is made on your device and stays there unless you share it.</p>
    </Sheet>
  );
}
