import { useEffect, useState } from 'preact/hooks';
import { api, ApiError } from '../net/api';
import { Sheet } from './common';
import { CREW_INFO, TRUST_MIN } from '../../shared/rules';
import type { BoardKind, BoardRow, TeamView, TrustView } from '../../shared/types';
import { me, toast } from '../state';

const fail = (e: unknown, fallback: string) => toast(e instanceof ApiError ? e.message : fallback, undefined, 'warn', 4500);
const BOARDS: [BoardKind, string][] = [['today', 'Today'], ['xp', 'All time'], ['explorer', 'Explorers'], ['connector', 'Connectors'], ['stations', 'Stations'], ['companies', 'Companies']];
const TRUST_LABEL: Record<keyof TrustView['parts'], string> = { geofence: 'Checked in at MIHAS today', hostCode: "Scanned a host's live code today", plausible: 'No impossible jumps today', steps: 'Walking matches the map', human: 'Docked at the Launch Pad' };

export function BoardsSheet() {
  const [kind, setKind] = useState<BoardKind>('today'), [rows, setRows] = useState<BoardRow[] | null>(null), [trust, setTrust] = useState<TrustView | null>(null);
  useEffect(() => { setRows(null); api.board(kind).then(setRows, () => setRows([])); }, [kind]);
  useEffect(() => { api.trust().then(setTrust, () => {}); }, []);
  return (
    <Sheet k="Boards" title="Who is flying well?" wide>
      <div class="pills scrollx">{BOARDS.map(([k, label]) => <button key={k} class={'chip' + (k === kind ? ' on' : '')} onClick={() => setKind(k)}>{label}</button>)}</div>
      {!rows ? <p class="lead">Loading…</p> : rows.length === 0 ? <p class="lead">Nothing here yet — be first.</p> : (
        <ol class="board">{rows.map((r, i) => (
          <li key={r.title + i} class={r.you ? 'you' : ''}>
            <span class="n">{i + 1}</span>
            <span class="who"><strong>{r.title}{r.trusted && <em title={r.kind === 'team' ? 'Verified exhibitor' : 'Trusted: eligible for prizes'}> ✓</em>}</strong><small>{r.sub}{r.cls ? ` · ${CREW_INFO[r.cls].crew}` : ''}</small></span>
            <span class="xp">{r.value.toLocaleString()}<small> {r.unit}</small></span>
          </li>
        ))}</ol>
      )}
      {trust && kind !== 'stations' && kind !== 'companies' && (
        <div class="box">
          <div class="rowb"><strong>Your trust: {Math.round(trust.score * 100)}%</strong><span class={'pill ' + (trust.trusted ? 'live' : '')}>{trust.trusted ? '✓ prize-eligible' : `needs ${Math.round(TRUST_MIN * 100)}%`}</span></div>
          <p class="fine">Anything a prize hangs on only counts players marked ✓. It resets each day and is earned by really being here.</p>
          <ul class="trust">{(Object.keys(TRUST_LABEL) as (keyof TrustView['parts'])[]).map((k) => <li key={k} class={trust.parts[k] ? 'ok' : ''}>{trust.parts[k] ? '✓' : '○'} {TRUST_LABEL[k]}</li>)}</ul>
        </div>
      )}
    </Sheet>
  );
}

export function TeamSheet() {
  const [team, setTeam] = useState<TeamView | null | undefined>(undefined), [name, setName] = useState(me.value?.passport?.company ?? ''), [code, setCode] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api.team().then(setTeam, () => setTeam(null)); }, []);
  const run = async (f: () => Promise<TeamView | null>, msg: string) => { setBusy(true); try { setTeam(await f()); } catch (e) { fail(e, msg); } setBusy(false); };
  if (!me.value?.passport) return <Sheet k="Company team" title="You need a Passport first"><p class="lead">Teams are made of real people from a real company. Claim your Passport at the Launch Pad — Booth 8H18B — then come back.</p></Sheet>;
  return (
    <Sheet k="Company team" title={team ? team.name : 'Fly with your colleagues'}>
      {team === undefined ? <p class="lead">Loading…</p> : team ? (
        <>
          <p class="lead">Team score <b>{team.score.toLocaleString()} XP</b> — the sum of your five best flyers. It shows on the Companies board.</p>
          {team.code && <div class="box center"><strong>Invite code</strong><div class="code small">{team.code.replace(/(.{4})/, '$1 ')}</div><p class="fine">Colleagues open Menu → Team and type this in.</p></div>}
          <ol class="board">{team.members.map((m, i) => <li key={m.callsign} class={m.you ? 'you' : ''}><span class="n">{i + 1}</span><span class="who"><strong>{m.callsign}</strong><small>{i < 5 ? 'scoring' : 'reserve'}</small></span><span class="xp">{m.xp.toLocaleString()}</span></li>)}</ol>
          <button class="btn big" disabled={busy} onClick={() => run(async () => { await api.teamLeave(); return null; }, 'Could not leave')}>{team.owner ? 'Dissolve the team' : 'Leave the team'}</button>
        </>
      ) : (
        <>
          <p class="lead">Exhibitors and visiting companies share one board. Start a team for your company, or join a colleague's with their code.</p>
          <form onSubmit={(e) => { e.preventDefault(); void run(() => api.teamCreate(name), 'Could not create the team'); }}>
            <label>Team name<input maxLength={60} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
            <button class="btn primary big" disabled={busy}>Start a team</button>
          </form>
          <form class="inline" onSubmit={(e) => { e.preventDefault(); void run(() => api.teamJoin(code), 'That code did not work'); }}>
            <input maxLength={9} placeholder="Invite code" aria-label="Team invite code" autocapitalize="characters" autocomplete="off" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase().replace(/\s/g, ''))} />
            <button class="btn" disabled={busy || code.length !== 8}>Join</button>
          </form>
        </>
      )}
    </Sheet>
  );
}
