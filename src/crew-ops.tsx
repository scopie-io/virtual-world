// Crew console, live-ops tabs: review the boards before any prize is announced; switches and the Daily Drop.
import { useEffect, useState } from 'preact/hooks';
import type { BoardKind, DailyDrop, FlagKey, ReviewRow } from '../shared/types';
import { FLAG_KEYS } from '../shared/rules';

type Res<T> = { ok: true; data: T } | { ok: false; error: string };
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json()) as Res<T>; if (!j.ok) throw new Error(j.error); return j.data;
}
interface LedgerRow { id: number; action: string; target: string | null; xp: number; detail: string | null; voided: number; created_at: number }
const PART: Record<string, string> = { geofence: 'venue', hostCode: 'host code', plausible: 'no jumps', steps: 'steps ok', human: 'docked' };

export function ReviewTab() {
  const [kind, setKind] = useState<BoardKind>('today'), [rows, setRows] = useState<ReviewRow[] | null>(null), [open, setOpen] = useState<string | null>(null), [ledger, setLedger] = useState<LedgerRow[]>([]), [err, setErr] = useState('');
  const load = () => call<ReviewRow[]>('GET', `/api/crew/review?board=${kind}`).then(setRows, (e) => { setRows([]); setErr(e.message); });
  useEffect(() => { setRows(null); void load(); }, [kind]);
  const drill = async (cs: string) => { setOpen(open === cs ? null : cs); if (open !== cs) setLedger(await call<LedgerRow[]>('GET', `/api/crew/ledger?callsign=${encodeURIComponent(cs)}`).catch(() => [])); };
  const act = async (f: () => Promise<unknown>) => { setErr(''); try { await f(); await load(); if (open) setLedger(await call<LedgerRow[]>('GET', `/api/crew/ledger?callsign=${encodeURIComponent(open)}`)); } catch (e) { setErr((e as Error).message); } };
  return (
    <section class="sheet wide">
      <div class="row"><h2>Review before you announce</h2><button class="btn" onClick={load}>Refresh</button></div>
      <p class="fine">Top 20 of the chosen board with each player's trust breakdown. Only ✓ trusted players should win anything. Open a row to see their ledger: void a bad entry (it can be restored), or put the account under review.</p>
      <nav>{(['today', 'xp', 'explorer', 'connector'] as BoardKind[]).map((k) => <button key={k} class={'chip' + (k === kind ? ' on' : '')} onClick={() => setKind(k)}>{k}</button>)}</nav>
      {err && <p class="banner bad">{err}</p>}
      <div class="scroll"><table><thead><tr><th>#</th><th>Player</th><th>Person</th><th>Board</th><th>XP</th><th>Trust</th><th>Flags</th><th>Where the XP came from</th><th></th></tr></thead>
        <tbody>{(rows ?? []).map((r, i) => [
          <tr key={r.callsign} class={r.banned ? 'dim' : ''}>
            <td>{i + 1}</td><td><button class="link" onClick={() => drill(r.callsign)}>{r.callsign}</button></td><td>{r.name || '—'} <small>{r.company}</small></td><td>{r.value} <small>{r.unit}</small></td><td>{r.xp}</td>
            <td><b class={r.trust.trusted ? 'good' : 'bad'}>{Math.round(r.trust.score * 100)}%</b> <small>{Object.entries(r.trust.parts).filter(([, ok]) => ok).map(([k]) => PART[k]).join(', ') || 'nothing yet'}</small></td>
            <td>{r.flags || ''}</td><td><small>{r.mix}</small></td>
            <td class="acts"><button class="chip" onClick={() => act(() => call('POST', '/api/crew/ban', { callsign: r.callsign, banned: !r.banned, reason: 'crew review' }))}>{r.banned ? 'Reinstate' : 'Under review'}</button></td>
          </tr>,
          open === r.callsign && <tr key={r.callsign + ':l'}><td colSpan={9}><div class="ledger">{ledger.map((l) => (
            <div key={l.id} class={'lrow' + (l.voided ? ' void' : '')}><span>{new Date(l.created_at).toLocaleTimeString()}</span><b>{l.action}</b><span>{l.target ?? ''}</span><span>{l.xp} XP</span><small>{l.detail ?? ''}</small>
              <button class="chip" onClick={() => act(() => call('POST', '/api/crew/void', { id: l.id, voided: !l.voided }))}>{l.voided ? 'Restore' : 'Void'}</button></div>
          ))}</div></td></tr>,
        ])}</tbody></table></div>
    </section>
  );
}

export function OpsTab() {
  const [flags, setFlags] = useState<Record<FlagKey, boolean> | null>(null), [drop, setDrop] = useState<DailyDrop | null>(null), [f, setF] = useState({ stationId: '', title: '', bonus: '100' }), [msg, setMsg] = useState('');
  useEffect(() => { call<Record<FlagKey, boolean>>('GET', '/api/crew/flags').then(setFlags, () => {}); call<DailyDrop | null>('GET', '/api/crew/drop').then(setDrop, () => {}); }, []);
  const LABEL: Record<FlagKey, string> = { registration: 'New Passports', claims: 'Station claims', links: 'Link-up', missions: 'Accepting missions', gc: 'Ground Control', holograms: 'Showing other players' };
  return (
    <section class="sheet wide">
      <h2>Switches</h2>
      <p class="fine">Turn a part of the game off without a deploy — if something misbehaves, or a feature is being abused. Players see “paused for a moment”. Takes effect within five seconds.</p>
      <div class="switches">{FLAG_KEYS.map((k) => <button key={k} class={'btn' + (flags?.[k] ? ' primary' : '')} disabled={!flags} onClick={async () => setFlags(await call('POST', '/api/crew/flags', { flag: k, on: !flags![k] }))}>{LABEL[k]}: {flags?.[k] ? 'ON' : 'OFF'}</button>)}</div>

      <h2 style={{ marginTop: '22px' }}>Daily Drop</h2>
      <p class="fine">One booth per day pays a bonus to players who are really there (venue check-in or host code). {drop ? <>Today: <b>{drop.title}</b> at {drop.label} ({drop.stationId}), +{drop.bonus} XP.</> : 'Nothing set for today.'}</p>
      <form class="dropform" onSubmit={async (e) => { e.preventDefault(); setMsg(''); try { setDrop(await call('POST', '/api/crew/drop', { ...f, bonus: Number(f.bonus) })); setMsg('Saved — live for the rest of today.'); } catch (x) { setMsg((x as Error).message); } }}>
        <label>Booth number<input required value={f.stationId} placeholder="e.g. 7C17" onInput={(e) => { const v = (e.target as HTMLInputElement).value.toUpperCase(); setF((p) => ({ ...p, stationId: v })); }} /></label>
        <label>Title<input value={f.title} placeholder="e.g. Kopi o'clock" maxLength={60} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setF((p) => ({ ...p, title: v })); }} /></label>
        <label>Bonus XP<input required inputMode="numeric" value={f.bonus} onInput={(e) => { const v = (e.target as HTMLInputElement).value.replace(/\D/g, ''); setF((p) => ({ ...p, bonus: v })); }} /></label>
        <button class="btn primary">Set today's drop</button>
      </form>
      {msg && <p class="fine">{msg}</p>}

      <h2 style={{ marginTop: '22px' }}>Mission Control screen</h2>
      <p class="fine">The live map for the booth TV: every player as a dot, today's board, sector control, a QR to join. Open it on the TV's browser after signing in here on the same device.</p>
      <a class="btn primary" href="/screen.html" target="_blank" rel="noopener">Open the big screen</a>
    </section>
  );
}
