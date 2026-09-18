// Crew console for booth staff: scan Golden Tickets, see leads, print station beacons.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Camera } from './ui/common';
import { OpsTab, ReviewTab } from './crew-ops';
import qrcode from 'qrcode-generator';
import './styles.css';
import './m2.css';
import './crew.css';
import type { CrewStationRow, CrewTicketView } from '../shared/types';

type Res<T> = { ok: true; data: T } | { ok: false; error: string; code: string };
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json()) as Res<T>;
  if (!j.ok) throw Object.assign(new Error(j.error), { code: j.code });
  return j.data;
}

/** Accepts a raw token, a 6-character code, or the full URL inside the QR. */
function extractTicket(raw: string): string {
  const s = raw.trim();
  try { const t = new URL(s).searchParams.get('t'); if (t) return t; } catch { /* not a URL */ }
  return s;
}

function Crew() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<'scan' | 'leads' | 'stations' | 'review' | 'ops' | 'beacons'>('scan');
  useEffect(() => { call('GET', '/api/crew/check').then(() => setAuthed(true), () => setAuthed(false)); }, []);
  if (authed === null) return <main class="console"><p>Loading…</p></main>;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return (
    <main class="console">
      <header><div class="brand static"><span>lean<b>.x</b>digital</span><i /><span>Crew console</span></div>
        <nav>{(['scan', 'leads', 'stations', 'review', 'ops', 'beacons'] as const).map((t) => <button key={t} class={'chip' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>{t}</button>)}
          <button class="chip ghost" onClick={() => call('POST', '/api/crew/logout').finally(() => setAuthed(false))}>Sign out</button></nav></header>
      {tab === 'scan' && <Scan />}{tab === 'leads' && <Leads />}{tab === 'stations' && <StationsTab />}{tab === 'review' && <ReviewTab />}{tab === 'ops' && <OpsTab />}{tab === 'beacons' && <Beacons />}
    </main>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState(''), [err, setErr] = useState('');
  const go = async (e: Event) => { e.preventDefault(); try { await call('POST', '/api/crew/login', { pin }); onDone(); } catch (x) { setErr((x as Error).message); } };
  return (
    <main class="console center"><form class="sheet" onSubmit={go}>
      <div class="k">Mission X</div><h2>Crew sign-in</h2>
      <label>Crew PIN<input type="password" inputMode="numeric" autocomplete="off" value={pin} onInput={(e) => setPin((e.target as HTMLInputElement).value)} /></label>
      {err && <p class="err" role="alert">{err}</p>}
      <button class="btn primary big">Sign in</button>
    </form></main>
  );
}

function Scan() {
  const [ticket, setTicket] = useState<{ t: string; view: CrewTicketView } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [manual, setManual] = useState(''), [camOn, setCamOn] = useState(false);

  const lookup = async (raw: string) => {
    const t = extractTicket(raw); if (!t) return;
    setMsg(null);
    try { setTicket({ t, view: await call<CrewTicketView>('GET', `/api/crew/ticket?t=${encodeURIComponent(t)}`) }); setCamOn(false); }
    catch (x) { setTicket(null); setMsg({ tone: 'bad', text: (x as Error).message }); }
  };
  const dock = async () => {
    if (!ticket) return;
    try { const v = await call<CrewTicketView>('POST', '/api/crew/dock', { t: ticket.t }); setMsg({ tone: 'ok', text: `${v.name} docked · +500 XP sent` }); setTicket(null); setManual(''); }
    catch (x) { setMsg({ tone: 'bad', text: (x as Error).message }); }
  };
  // Scanned with the phone's own camera → lands here with ?t=
  useEffect(() => { const t = new URLSearchParams(location.search).get('t'); if (t) { history.replaceState(null, '', location.pathname); void lookup(t); } }, []);

  return (
    <section>
      {msg && <p class={'banner ' + msg.tone} role="status">{msg.text}</p>}
      {ticket ? (
        <div class="sheet wide">
          <div class="k gold">Golden Ticket</div><h2>{ticket.view.name}</h2>
          <p class="lead">{[ticket.view.role, ticket.view.company].filter(Boolean).join(' · ')}<br /><small>{ticket.view.callsign}</small></p>
          {ticket.view.alreadyDocked ? <p class="banner bad">Already docked — do not hand out a second reward.</p> : <button class="btn primary big" onClick={dock}>Confirm docking · +500 XP</button>}
          <button class="btn big" style={{ marginTop: '8px' }} onClick={() => setTicket(null)}>Back</button>
        </div>
      ) : (
        <div class="sheet wide">
          <h2>Scan a Golden Ticket</h2>
          {camOn ? <Camera onCode={lookup} onFail={(m) => { setCamOn(false); setMsg({ tone: 'bad', text: m }); }} /> : <button class="btn primary big" onClick={() => setCamOn(true)}>Open camera</button>}
          <form class="manual" onSubmit={(e) => { e.preventDefault(); void lookup(manual); }}>
            <label>…or type the 6-character code<input value={manual} maxLength={6} autocapitalize="characters" autocomplete="off" onInput={(e) => setManual((e.target as HTMLInputElement).value.toUpperCase())} /></label>
            <button class="btn">Look up</button>
          </form>
        </div>
      )}
    </section>
  );
}

type Lead = Record<string, string | number | null>;
function Leads() {
  const [rows, setRows] = useState<Lead[] | null>(null);
  useEffect(() => { call<Lead[]>('GET', '/api/crew/leads').then(setRows, () => setRows([])); }, []);
  return (
    <section class="sheet wide">
      <div class="row"><h2>Leads {rows ? `(${rows.length})` : ''}</h2><a class="btn" href="/api/crew/leads.csv">Export CSV</a></div>
      <p class="fine">Marketing = the person ticked the optional marketing box. Only contact those marked “yes” for promotion.</p>
      <div class="scroll"><table><thead><tr><th>Name</th><th>Company</th><th>Role</th><th>Phone</th><th>Email</th><th>Marketing</th><th>Class</th><th>XP</th><th>Links</th><th>Docked</th></tr></thead>
        <tbody>{(rows ?? []).map((r) => <tr key={String(r.callsign)}><td>{r.name}</td><td>{r.company}</td><td>{r.role}</td><td>{r.phone}</td><td>{r.email}</td><td>{r.consent_marketing ? 'yes' : 'no'}</td><td>{r.cls}</td><td>{r.xp}</td><td>{r.links}</td><td>{r.docked_at ? '✓' : ''}</td></tr>)}</tbody></table></div>
    </section>
  );
}

/** Exhibitor claims: anyone with a Passport can claim a booth, so the crew checks them. */
function StationsTab() {
  const [rows, setRows] = useState<CrewStationRow[] | null>(null), [err, setErr] = useState('');
  const load = () => call<CrewStationRow[]>('GET', '/api/crew/stations').then(setRows, () => setRows([]));
  useEffect(() => { void load(); }, []);
  const set = async (stationId: string, status: string) => { setErr(''); try { await call('POST', '/api/crew/stations/status', { stationId, status }); await load(); } catch (x) { setErr((x as Error).message); } };
  return (
    <section class="sheet wide">
      <div class="row"><h2>Station claims {rows ? `(${rows.length})` : ''}</h2><button class="btn" onClick={load}>Refresh</button></div>
      <p class="fine">Approve = verified-exhibitor badge. Revoke = the station goes dark and that person cannot re-claim it. Release = delete the claim so the real exhibitor can take the booth.</p>
      {err && <p class="banner bad">{err}</p>}
      <div class="scroll"><table><thead><tr><th>Booth</th><th>Station name</th><th>Claimed by</th><th>Their company</th><th>Status</th><th>Lvl</th><th></th></tr></thead>
        <tbody>{(rows ?? []).map((r) => (
          <tr key={r.id}><td>{r.id}</td><td>{r.company}</td><td>{r.ownerName} <small>{r.ownerCallsign}</small></td><td>{r.ownerCompany}</td><td>{r.status}{r.hosted ? ' · hosted' : ''}</td><td>{r.level}</td>
            <td class="acts">{r.status !== 'approved' && <button class="chip" onClick={() => set(r.id, 'approved')}>Approve</button>}{r.status !== 'revoked' && <button class="chip" onClick={() => set(r.id, 'revoked')}>Revoke</button>}<button class="chip" onClick={() => set(r.id, 'release')}>Release</button></td></tr>
        ))}</tbody></table></div>
    </section>
  );
}

interface Beacon { id: string; name: string; url: string }
function Beacons() {
  const [all, setAll] = useState<Beacon[]>([]), [q, setQ] = useState('');
  useEffect(() => { call<Beacon[]>('GET', '/api/crew/beacons').then(setAll, () => {}); }, []);
  const hit = q.trim().toUpperCase(), list = hit ? all.filter((b) => b.id.includes(hit) || b.name.toUpperCase().includes(hit)).slice(0, 24) : [];
  return (
    <section class="sheet wide">
      <div class="row"><h2>Station beacons</h2><button class="btn" onClick={() => print()}>Print</button></div>
      <p class="fine no-print">Search a booth number or exhibitor, print, and hand the card to that exhibitor for their counter. Each code is signed for its station.</p>
      <label class="no-print">Find station<input value={q} placeholder="e.g. 7C17 or Mamee" onInput={(e) => setQ((e.target as HTMLInputElement).value)} /></label>
      <div class="beacons">{list.map((b) => <BeaconCard key={b.id} b={b} />)}</div>
    </section>
  );
}
function BeaconCard({ b }: { b: Beacon }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = qrcode(0, 'M'); c.addData(b.url); c.make(); if (ref.current) ref.current.innerHTML = c.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }, [b.url]);
  return <div class="beacon"><div class="k">Mission X · Station beacon</div><h3>{b.name || 'Station'} <small>{b.id}</small></h3><div class="qr" ref={ref} /><p>Scan to stamp this station</p></div>;
}

render(<Crew />, document.getElementById('crew')!);
