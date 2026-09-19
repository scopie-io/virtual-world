import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Engine } from '../game/engine';
import { setSound, soundOn } from '../sfx';
import { api, ApiError } from '../net/api';
import { handleScan } from '../scan';
import { Camera, FieldPicker, Qr, Sheet, hex, useCountdown } from './common';
import { POINTS, ROLE_INFO, type ShareField } from '../../shared/rules';
import type { BoardRow, Booth, Contact, HostCode, HostLead, LinkCode, LinkPeek } from '../../shared/types';
import { HostDemoHint, LinkDemoHint, StationDemoHint } from '../demo/Tour';
import { drop, guideOn, guideTarget, journey, level, me, modal, myBooths, nearStation, online, panelStation, pendingLink, stampedSet, stationMap, stations, toast } from '../state';

type Eng = { engine: () => Engine | null };
const fail = (e: unknown, fallback: string) => toast(e instanceof ApiError ? e.message : fallback, undefined, 'warn', 4500);
const refreshStations = async () => { try { stations.value = await api.stations(); } catch { /* next poll */ } };
const refreshMyBooths = async () => { try { myBooths.value = await api.myBooths(); } catch { /* next poll */ } };
const guideTo = (b: Booth, label: string) => { guideTarget.value = { x: b.x, y: b.y, label }; guideOn.value = true; modal.value = null; };

/* ------------------------------------------------------------------ a booth */

export function BoothSheet({ engine }: Eng) {
  const b = panelStation.value, m = me.value!;
  const [fields, setFields] = useState<ShareField[]>(m.sharePrefs), [scan, setScan] = useState(false), [digits, setDigits] = useState(''), [busy, setBusy] = useState(false);
  if (!b) return null;
  const st = stationMap.value.get(b.id), mine = m.hosting.includes(b.id), stamped = stampedSet.value.has(b.id), left = m.shared.includes(b.id), met = m.verified.includes(b.id);
  const near = nearStation.value?.id === b.id, title = st?.company || b.name || `Booth ${b.id}`;
  const run = async (f: () => Promise<unknown>, msg: string) => { setBusy(true); try { await f(); } catch (e) { fail(e, msg); } setBusy(false); };

  return (
    <Sheet k={`Booth ${b.id} · Hall ${b.hall} · Level ${b.deck}${b.sector ? ` · ${b.sector}` : ''}`} title={title}>
      <div class="pills">
        {st && <span class={'pill ' + (st.hosted ? 'live' : 'on')}>{st.hosted ? 'At the counter now' : 'Online'}</span>}
        {st?.status === 'approved' && <span class="pill on">Verified exhibitor</span>}
        {stamped && <span class="pill gold">Stamped</span>}{met && <span class="pill gold">Met in person</span>}
      </div>
      {st?.offer && <p class="lead">{st.offer}</p>}
      {st?.link && <a class="btn" href={st.link} target="_blank" rel="noopener noreferrer nofollow">Visit their page</a>}

      {mine ? (
        <div class="stack"><button class="btn primary big" onClick={() => (modal.value = 'mybooth')}>Open my booth</button><button class="btn big" onClick={() => (modal.value = 'claim')}>Edit booth profile</button></div>
      ) : (
        <div class="stack">
          {!stamped && near && <button class="btn primary big" disabled={busy} onClick={() => run(() => engine()!.stamp(b), 'Could not stamp')}>Stamp this booth · +{POINTS.stamp}</button>}
          {!near && <button class="btn big" onClick={() => guideTo(b, title)}>Guide me here</button>}

          {!met && (
            <div class="box">
              <strong>At the real booth?</strong><p class="fine">Scan the Mission X QR on their counter: +{POINTS.scan} points{st ? ', and they know you really came' : ''}.</p>
              {scan ? <Camera onCode={(t) => { setScan(false); void handleScan(t); }} onFail={(msg) => { setScan(false); toast(msg, undefined, 'warn', 5000); }} /> : <button class="btn big" onClick={() => setScan(true)}>Scan booth QR</button>}
              {st && (
                <form class="inline" onSubmit={(e) => { e.preventDefault(); void run(() => api.stamp({ stationId: b.id, proof: 'host', code: digits }), 'That code did not work'); }}>
                  <input inputMode="numeric" maxLength={6} placeholder="or type the 6 digits" aria-label="6-digit booth code" value={digits} onInput={(e) => setDigits((e.target as HTMLInputElement).value.replace(/\D/g, ''))} />
                  <button class="btn" disabled={busy || digits.length !== 6}>Enter</button>
                </form>
              )}
            </div>
          )}

          {st && stamped && m.passport && (
            <div class="box">
              <strong>{left ? 'You left your card here' : `Leave your card with ${st.company}?`}</strong>
              <p class="fine">They receive only what you tick. You can take it back any time from My contacts.</p>
              <FieldPicker value={fields} onChange={setFields} />
              <div class="stack">
                <button class="btn primary big" disabled={busy} onClick={() => run(() => api.leaveCard(b.id, fields), 'Could not leave your card')}>{left ? 'Update what they see' : `Leave my card · +${POINTS.leaveCard}`}</button>
                {left && <button class="btn big" disabled={busy} onClick={() => run(() => api.takeBackCard(b.id), 'Could not undo')}>Take it back</button>}
              </div>
            </div>
          )}
          {st && stamped && !m.passport && <p class="fine">Get your free card at the X — Booth 8H18B — and you can leave it with exhibitors.</p>}
          <StationDemoHint stationId={b.id} onDigits={setDigits} />

          {!st && <button class="btn big" onClick={() => (modal.value = m.passport ? 'claim' : 'card')}>Exhibiting here? Bring this booth online</button>}
        </div>
      )}
    </Sheet>
  );
}

export function ClaimSheet() {
  const b = panelStation.value, m = me.value!, existing = b ? stationMap.value.get(b.id) : undefined;
  const [f, setF] = useState({ company: existing?.company ?? (b?.name || m.passport?.company) ?? '', offer: existing?.offer ?? '', link: existing?.link ?? '', color: existing?.color ?? 0x1e9e6a });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const put = (k: 'company' | 'offer' | 'link') => (e: Event) => { const v = (e.target as HTMLInputElement).value; setF((p) => ({ ...p, [k]: v })); };
  if (!b) return null;
  const submit = async (e: Event) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api.claim({ stationId: b.id, ...f }); await Promise.all([refreshStations(), refreshMyBooths()]); api.track('booth_online', { id: b.id }); modal.value = 'mybooth'; }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not save'); setBusy(false); }
  };
  return (
    <Sheet k={`Booth ${b.id} · Hall ${b.hall} · Level ${b.deck}`} title={existing ? 'Booth profile' : 'Light up your booth'} onClose={() => (modal.value = m.hosting.length ? 'mybooth' : null)}>
      <form onSubmit={submit}>
        {!existing && <p class="lead">Your booth glows for every player, becomes a stop on their mission, and the cards they leave come to you — free.</p>}
        <label>Company name on the booth<input required maxLength={80} value={f.company} onInput={put('company')} /></label>
        <label>One line for visitors<input maxLength={120} placeholder="e.g. Free samples at 3 pm" value={f.offer} onInput={put('offer')} /></label>
        <label>Website<input maxLength={200} inputMode="url" placeholder="yourcompany.com" value={f.link} onInput={put('link')} /></label>
        {err && <p class="err" role="alert">{err}</p>}
        <button class="btn primary big" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save' : 'Bring it online'}</button>
        {!existing && <p class="fine">Our crew checks every booth. One that is not yours is removed.</p>}
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ the exhibitor's side */

function BoothPicker() {
  const [q, setQ] = useState(''), lv = level.value, sm = stationMap.value;
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!lv || t.length < 2) return [] as Booth[];
    return lv.booths.filter((b) => b.id !== lv.hero.id && (b.id.toLowerCase().includes(t) || b.name.toLowerCase().includes(t))).slice(0, 20);
  }, [q, lv]);
  return (
    <>
      <label>Your booth number or company<input autofocus value={q} placeholder="e.g. 7C17" onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></label>
      <div class="results">
        {hits.map((b) => <button key={b.id} class="result" disabled={sm.has(b.id)} onClick={() => { panelStation.value = b; modal.value = 'claim'; }}><strong>{b.name || `Booth ${b.id}`}</strong><small>Booth {b.id} · Hall {b.hall} · Level {b.deck}{sm.has(b.id) ? ' · already online' : ''}</small></button>)}
        {q.trim().length >= 2 && hits.length === 0 && <p class="fine">No booth matches on any of the three levels. Check the number on your fascia board.</p>}
      </div>
    </>
  );
}

export function MyBoothSheet() {
  const m = me.value!, mine = myBooths.value, [loaded, setLoaded] = useState(false), [sel, setSel] = useState<string | null>(null), [adding, setAdding] = useState(false);
  const [code, setCode] = useState<{ c: HostCode; until: number } | null>(null), [leads, setLeads] = useState<HostLead[]>([]);
  const left = useCountdown(code?.until ?? 0), j = journey.value;

  useEffect(() => { void refreshMyBooths().then(() => setLoaded(true)); }, []);
  useEffect(() => { if (!sel && mine[0]) setSel(mine[0].id); }, [mine]);
  useEffect(() => { // asking for the QR doubles as "someone is at the counter"
    if (!sel) return; let stop = false;
    const pull = async () => { try { const c = await api.boothQr(sel); if (!stop) setCode({ c, until: Date.now() + c.expiresInMs }); } catch (e) { fail(e, 'Could not load your booth QR'); } };
    const pullLeads = () => api.leads(sel).then((l) => !stop && setLeads(l), () => {});
    void pull(); void pullLeads(); void refreshStations();
    const a = setInterval(pull, 10_000), b = setInterval(() => { void pullLeads(); void refreshMyBooths(); }, 15_000);
    return () => { stop = true; clearInterval(a); clearInterval(b); };
  }, [sel]);
  useEffect(() => { if (code && left === 0 && sel) api.boothQr(sel).then((c) => setCode({ c, until: Date.now() + c.expiresInMs }), () => {}); }, [left]);

  const s = mine.find((x) => x.id === sel);
  if (!m.passport) return <Sheet k="My booth" title="First, your card"><p class="lead">It tells visitors and our crew who is behind the booth. One minute.</p><button class="btn primary big" onClick={() => (modal.value = 'card')}>Create my card</button></Sheet>;
  return (
    <Sheet k="My booth" title={s && !adding ? s.company : 'Find your booth'} gold wide>
      {!loaded ? <p class="lead">Loading…</p> : !s || adding ? (
        <><p class="lead">Step 1 of 3 — light it up. Your booth starts glowing for every player the moment you bring it online.</p><BoothPicker />{adding && <button class="btn big" onClick={() => setAdding(false)}>Back</button>}</>
      ) : (
        <>
          {j?.kind === 'exhibitor' && <div class="dots wide" role="img" aria-label={`${j.done} of 3 steps done`}>{j.steps.map((x) => <i key={x.n} class={x.done ? 'on' : x === j.now ? 'now' : ''} />)}<span>{j.now ? `Step ${j.now.n} of 3 · ${j.now.todo}` : 'All three steps done. Keep the QR on your counter.'}</span></div>}
          {mine.length > 1 && <div class="pills">{mine.map((x) => <button key={x.id} class={'chip' + (x.id === sel ? ' on' : '')} onClick={() => setSel(x.id)}>{x.id}</button>)}</div>}
          <div class="hostgrid">
            <div class="center">
              {code && <Qr text={code.c.url} label="Booth QR" />}
              <div class="code">{code ? code.c.digits.replace(/(\d{3})/, '$1 ') : '··· ···'}</div>
              <p class="fine">Your booth QR. Keep this screen open on a phone or tablet at your counter. Visitors scan it for +{POINTS.scan}; you see who really came. It refreshes itself ({left}s).</p>
            </div>
            <div>
              <div class="stats three">
                <div><span>Visits</span><strong>{s.stamps}</strong></div><div><span>Met in person</span><strong>{s.verifiedContacts}</strong></div><div><span>Cards</span><strong>{s.shares}</strong></div>
              </div>
              {s.status === 'pending' && <p class="fine">Live now. Our crew will confirm it is your booth; then it shows “verified exhibitor”.</p>}
              <div class="rowb"><strong>Cards left with you ({leads.length})</strong><a class="link" href={`/api/host/leads.csv?station=${encodeURIComponent(s.id)}`}>Export CSV</a></div>
              <div class="leads">
                {leads.length === 0 ? <p class="fine">None yet. Visitors are offered to leave their card right after they stamp or scan your booth.</p> : leads.map((l) => (
                  <div key={l.callsign} class="leadrow"><strong>{l.name}{l.verified && <em> · met in person</em>}</strong><span>{[l.role, l.company].filter(Boolean).join(' · ')}</span><span>{[l.phone, l.email].filter(Boolean).join(' · ')}</span></div>
                ))}
              </div>
              <div class="stack">
                <button class="btn big" onClick={() => { panelStation.value = level.value?.booths.find((b) => b.id === s.id) ?? null; modal.value = 'claim'; }}>Edit booth profile</button>
                <button class="btn big" onClick={() => setAdding(true)}>Add another booth</button>
              </div>
              <HostDemoHint onLead={() => { api.leads(s.id).then(setLeads, () => {}); void refreshMyBooths(); }} />
            </div>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ swap cards */

export function SwapSheet() {
  const m = me.value!, [mode, setMode] = useState<'show' | 'scan'>(pendingLink.value ? 'scan' : 'show');
  const [code, setCode] = useState<{ c: LinkCode; until: number } | null>(null), [prefs, setPrefs] = useState<ShareField[]>(m.sharePrefs);
  const [cam, setCam] = useState(false), [typed, setTyped] = useState(''), [peek, setPeek] = useState<{ code: string; p: LinkPeek } | null>(null), [mine, setMine] = useState<ShareField[]>(m.sharePrefs), [busy, setBusy] = useState(false);
  const left = useCountdown(code?.until ?? 0), swapsAtOpen = useRef(m.links);

  const fresh = () => api.swapCode().then((c) => setCode({ c, until: Date.now() + c.expiresInMs }), (e) => fail(e, 'Could not create your code'));
  useEffect(() => { if (m.passport && mode === 'show') void fresh(); }, [mode]);
  useEffect(() => { if (code && left === 0 && mode === 'show') void fresh(); }, [left]);
  useEffect(() => { // someone scanned my code: the server swapped our cards — notice it here
    if (mode !== 'show') return; const id = setInterval(() => { void api.me().catch(() => {}); }, 4000); return () => clearInterval(id);
  }, [mode]);
  useEffect(() => { if (m.links > swapsAtOpen.current) { swapsAtOpen.current = m.links; toast('Cards swapped', 'Their card is in My contacts', 'xp'); void fresh(); } }, [m.links]);

  const look = async (raw: string) => {
    const c = (raw.match(/[?&]l=([A-Za-z0-9]{8})/)?.[1] ?? raw).trim().toUpperCase();
    try { setPeek({ code: c, p: await api.swapPeek(c) }); } catch (e) { fail(e, 'That code did not work'); }
  };
  useEffect(() => { const c = pendingLink.value; if (c && m.passport) { pendingLink.value = null; void look(c); } }, []);
  const doSwap = async () => { if (!peek) return; setBusy(true); try { await api.swap(peek.code, mine); api.track('swap'); setPeek(null); modal.value = 'contacts'; } catch (e) { fail(e, 'Could not swap cards'); } setBusy(false); };

  if (!m.passport) return <Sheet k="Swap cards" title="You need your card first"><p class="lead">Your digital business card is what you swap. It is free at the X — Booth 8H18B.</p><button class="btn primary big" onClick={() => { guideTarget.value = null; guideOn.value = true; modal.value = null; }}>Guide me to the X</button></Sheet>;

  if (peek) return (
    <Sheet k="Swap cards" title={`Swap with ${peek.p.callsign}?`} onClose={() => setPeek(null)}>
      <p class="lead">{peek.p.cls ? ROLE_INFO[peek.p.cls].label : 'Player'}. They are sharing: <b>{peek.p.shares.join(', ')}</b>.</p>
      {peek.p.alreadyLinked ? <p class="fine">You two have already swapped — find them in My contacts.</p> : (
        <><strong>What do you share with them?</strong><FieldPicker value={mine} onChange={setMine} /><button class="btn primary big" disabled={busy} onClick={doSwap}>{busy ? 'Swapping…' : `Swap cards · +${POINTS.swap} each`}</button></>
      )}
    </Sheet>
  );

  return (
    <Sheet k="Swap cards" title="Met someone?" gold>
      <div class="seg"><button class={mode === 'show' ? 'on' : ''} onClick={() => setMode('show')}><strong>Show my code</strong><small>They scan you</small></button><button class={mode === 'scan' ? 'on' : ''} onClick={() => setMode('scan')}><strong>Scan theirs</strong><small>You scan them</small></button></div>
      {mode === 'show' ? (
        <div class="center">
          {code && <Qr text={code.c.url} label="My card-swap code" />}
          <div class="code small">{code?.c.code.replace(/(.{4})/, '$1 ') ?? '···· ····'}</div>
          <p class="fine">Fresh code in {left}s · works once.</p>
          <div class="box left"><strong>Whoever scans you receives</strong><FieldPicker value={prefs} onChange={(f) => { setPrefs(f); void api.swapPrefs(f).catch((e) => fail(e, 'Could not save')); }} /></div>
          <LinkDemoHint mode="show" onCode={() => {}} />
        </div>
      ) : (
        <div>
          {cam ? <Camera onCode={(t) => { setCam(false); void look(t); }} onFail={(msg) => { setCam(false); toast(msg, undefined, 'warn', 5000); }} /> : <button class="btn primary big" onClick={() => setCam(true)}>Open camera</button>}
          <form class="inline" onSubmit={(e) => { e.preventDefault(); void look(typed); }}>
            <input maxLength={9} placeholder="or type their 8 characters" aria-label="8-character code" autocapitalize="characters" autocomplete="off" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value.toUpperCase().replace(/\s/g, ''))} />
            <button class="btn" disabled={typed.length !== 8}>Look up</button>
          </form>
          <LinkDemoHint mode="scan" onCode={(c) => { setTyped(c); void look(c); }} />
        </div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ my contacts */

function vcardHref(c: Contact): string {
  const v = (s: string) => s.replace(/([,;\\])/g, '\\$1'), k = c.card;
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${v(k.name ?? c.title)}`, k.company && `ORG:${v(k.company)}`, k.role && `TITLE:${v(k.role)}`, k.phone && `TEL;TYPE=CELL:${v(k.phone)}`, k.email && `EMAIL:${v(k.email)}`, c.note && `NOTE:${v(c.note)}`, 'END:VCARD'].filter(Boolean);
  return 'data:text/vcard;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
}

export function ContactsSheet() {
  const [list, setList] = useState<Contact[] | null>(null);
  const load = () => api.contacts().then(setList, () => setList([]));
  useEffect(() => { void load(); }, []);
  const revoke = async (c: Contact) => { try { await (c.kind === 'station' ? api.takeBackCard(c.key.slice(2)) : api.revokeContact(c.key)); toast('Card taken back'); void load(); } catch (e) { fail(e, 'Could not undo'); } };
  return (
    <Sheet k="My contacts" title={list ? `${list.length} contact${list.length === 1 ? '' : 's'}` : 'My contacts'} wide>
      {!list ? <p class="lead">Loading…</p> : list.length === 0 ? <p class="lead">Nobody yet. <b>Swap cards</b> with people you meet, or leave your card at a booth that is online.</p> : (
        <div class="contacts">{list.map((c) => (
          <div key={c.key} class="contact">
            <div class="rowb"><strong>{c.title}{c.verified && <em> · met in person</em>}</strong><span class="pill">{c.kind === 'person' ? 'Person' : 'Booth'}</span></div>
            <span class="sub">{c.sub}</span>
            <div class="pills">
              {c.card.phone && <a class="chip" href={`https://wa.me/${c.card.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
              {c.card.email && <a class="chip" href={`mailto:${c.card.email}`}>Email</a>}
              {c.link && <a class="chip" href={c.link} target="_blank" rel="noopener noreferrer nofollow">Their page</a>}
              {c.kind === 'person' && c.card.name && <a class="chip" href={vcardHref(c)} download={`${c.card.name}.vcf`}>Save to phone</a>}
              <button class="chip ghostbtn" onClick={() => revoke(c)}>Take back my card</button>
            </div>
            <textarea rows={2} maxLength={500} placeholder="Private note — follow up about…" aria-label={`Note about ${c.title}`} defaultValue={c.note} onBlur={(e) => { const t = (e.target as HTMLTextAreaElement).value; if (t !== c.note) { c.note = t; void api.note(c.key, t).catch((x) => fail(x, 'Note not saved')); } }} />
          </div>
        ))}</div>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ the board + menu */

export function BoardSheet() {
  const [tab, setTab] = useState<'xp' | 'stations'>(me.value?.cls === 'exhibitor' ? 'stations' : 'xp'), [rows, setRows] = useState<BoardRow[] | null>(null);
  useEffect(() => { setRows(null); api.board(tab).then(setRows, () => setRows([])); }, [tab]);
  return (
    <Sheet k="Leaderboard" title={tab === 'xp' ? 'Top players' : 'Most visited booths'} wide>
      <div class="seg"><button class={tab === 'xp' ? 'on' : ''} onClick={() => setTab('xp')}><strong>Players</strong><small>by points</small></button><button class={tab === 'stations' ? 'on' : ''} onClick={() => setTab('stations')}><strong>Booths</strong><small>by visits</small></button></div>
      {!rows ? <p class="lead">Loading…</p> : rows.length === 0 ? <p class="lead">{tab === 'xp' ? 'Nobody yet — be the first.' : 'No booth is online yet. Exhibiting? Bring yours online from the menu.'}</p> : (
        <ol class="board">{rows.map((r, i) => (
          <li key={r.title + i} class={r.you ? 'you' : ''}><span class="pos">{i + 1}</span><div><strong style={r.cls ? { color: hex(ROLE_INFO[r.cls].color) } : {}}>{r.title}{r.you ? ' · you' : ''}</strong><small>{r.sub}</small></div><em>{r.value.toLocaleString()} <small>{r.unit}</small></em></li>
        ))}</ol>
      )}
    </Sheet>
  );
}

export function MenuSheet() {
  const m = me.value!, go = (x: typeof modal.value) => () => (modal.value = x);
  const switchRole = async () => { const to = m.cls === 'exhibitor' ? 'visitor' : 'exhibitor'; try { await api.start(to); modal.value = to === 'exhibitor' ? (m.passport ? 'mybooth' : 'card') : null; } catch (e) { fail(e, 'Could not switch'); } };
  return (
    <Sheet k={`${m.callsign} · ${online.value} here now`} title="Menu">
      <div class="menu">
        {drop.value && !drop.value.done && <button class="wide" onClick={() => { const d = drop.value!; guideTarget.value = { x: d.x, y: d.y, label: d.label }; guideOn.value = true; modal.value = null; }}><strong>Booth of the day · +{drop.value.bonus}</strong><small>{drop.value.label} · scan its QR at the real booth today</small></button>}
        {m.passport && <a href={m.passport.url} target="_blank" rel="noopener"><strong>My card</strong><small>Your digital business card · link and QR</small></a>}
        {m.passport && !m.docked && <button onClick={go('prize')}><strong>My prize code</strong><small>Show it at the real Booth 8H18B</small></button>}
        {(m.cls === 'exhibitor' || m.hosting.length > 0) && <button onClick={go(m.passport ? 'mybooth' : 'card')}><strong>My booth</strong><small>{m.hosting.length ? m.hosting.join(', ') + ' · QR and leads' : 'Bring it online'}</small></button>}
        <button onClick={go('swap')}><strong>Swap cards</strong><small>Met someone? Exchange cards · +{POINTS.swap} each</small></button>
        <button onClick={go('contacts')}><strong>My contacts</strong><small>{m.links} people · {m.shared.length} booths</small></button>
        <button onClick={go('map')}><strong>Map</strong><small>All three levels · search · places to go</small></button>
        <button onClick={go('board')}><strong>Leaderboard</strong><small>Top players · most visited booths</small></button>
        <button onClick={go('rules')}><strong>How to play</strong><small>The mission and the points, on one page</small></button>
        <button aria-pressed={soundOn.value} onClick={() => setSound(!soundOn.value)}><strong>Sound · {soundOn.value ? 'on' : 'off'}</strong><small>{soundOn.value ? 'Quiet chimes, and a buzz on phones that can' : 'Silent, no vibration'}</small></button>
        <button onClick={switchRole}><strong>{m.cls === 'exhibitor' ? 'Play as a visitor' : 'I am exhibiting'}</strong><small>{m.cls === 'exhibitor' ? 'Do the five-chapter mission' : 'Put your booth in the game'}</small></button>
      </div>
    </Sheet>
  );
}
