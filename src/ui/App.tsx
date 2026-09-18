import { useEffect, useState } from 'preact/hooks';
import type { Engine } from '../game/engine';
import { api, ApiError } from '../net/api';
import { CLASSES, CLASS_INFO, CREW_INFO, RANKS, type PlayerClass } from '../../shared/rules';
import type { PassportInput } from '../../shared/types';
import { atLaunchPad, bootError, currentDeck, distToGoal, goalVia, guideOn, guideTarget, level, me, mission, missions, modal, nearLift, nearStation, online, panelStation, phase, sectors, stampedSet, stationMap, toast, toasts } from '../state';
import { DeckBanner, GcSheet, MissionsSheet, PresenceSheet } from './m3sheets';
import { BoardsSheet, TeamSheet } from './m4sheets';
import { Qr, Sheet, hex } from './common';
import { AvatarSheet, ClaimSheet, ContactsSheet, CrewsSheet, FindSheet, HostSheet, LinkSheet, MenuSheet, StationSheet } from './sheets';

type Eng = { engine: () => Engine | null };

export function App({ engine }: Eng) {
  const m = modal.value;
  return (
    <>
      <Brand />
      {phase.value === 'boot' && <Splash text="Docking with the station…" />}
      {phase.value === 'error' && <Splash text={bootError.value} error />}
      {phase.value === 'suitup' && <SuitUp engine={engine} />}
      {phase.value === 'play' && m !== 'suit' && <Hud engine={engine} />}
      {m === 'passport' && <PassportForm />}
      {m === 'ticket' && <Ticket />}
      {m === 'docked' && <Docked />}
      {m === 'board' && <BoardsSheet />}
      {m === 'team' && <TeamSheet />}
      {m === 'station' && <StationSheet engine={engine} />}
      {m === 'claim' && <ClaimSheet />}
      {m === 'host' && <HostSheet />}
      {m === 'link' && <LinkSheet />}
      {m === 'contacts' && <ContactsSheet />}
      {m === 'suit' && <AvatarSheet engine={engine} />}
      {m === 'find' && <FindSheet />}
      {m === 'crews' && <CrewsSheet />}
      {m === 'menu' && <MenuSheet />}
      {m === 'missions' && <MissionsSheet />}
      {m === 'gc' && <GcSheet />}
      {m === 'presence' && <PresenceSheet engine={engine} />}
      {phase.value === 'play' && <DeckBanner engine={engine} />}
      <Toasts />
    </>
  );
}

const Brand = () => (
  <div class="brand"><span>lean<b>.x</b>digital</span><i /><span>ne<b>x</b>ova</span></div>
);

const Splash = ({ text, error }: { text: string; error?: boolean }) => (
  <div class="splash"><div class={error ? 'x err' : 'x'}>✕</div><p>{text}</p>{error && <button class="btn" onClick={() => location.reload()}>Try again</button>}</div>
);

/* ------------------------------------------------------------------ suit up */

function SuitUp({ engine }: Eng) {
  const [cls, setCls] = useState<PlayerClass>(me.value?.cls ?? 'builder');
  const [spawn, setSpawn] = useState<'short' | 'epic'>('short');
  const [busy, setBusy] = useState(false);
  const returning = !!me.value?.cls;
  const go = async () => {
    setBusy(true);
    try { await api.suitUp(cls); engine()?.start(spawn); phase.value = 'play'; api.track('start', { cls, spawn }); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not start', undefined, 'warn'); setBusy(false); }
  };
  return (
    <div class="sheet suit">
      <div class="k">Mission X · MIHAS 2026 · Level 2</div>
      <h1>Find the <b>X</b>.</h1>
      <p class="lead">The whole expo is the map. The X is real — Booth 8H18B. Pick your crew and walk.</p>
      <div class="classes">
        {CLASSES.map((c) => (
          <button key={c} class={'cls' + (c === cls ? ' on' : '')} onClick={() => setCls(c)} aria-pressed={c === cls}>
            <span class="dot" style={{ background: hex(CREW_INFO[c].color) }} />
            <strong>{CLASS_INFO[c].label}</strong><small>{CLASS_INFO[c].line} · {CREW_INFO[c].crew}</small>
          </button>
        ))}
      </div>
      <div class="seg" role="group" aria-label="Route">
        <button class={spawn === 'short' ? 'on' : ''} onClick={() => setSpawn('short')}><strong>Short</strong><small>Hall 8 entrance · 37 m</small></button>
        <button class={spawn === 'epic' ? 'on' : ''} onClick={() => setSpawn('epic')}><strong>Epic</strong><small>Main entrance · 228 m</small></button>
      </div>
      <button class="btn primary big" disabled={busy} onClick={go}>{busy ? 'Suiting up…' : `${returning ? 'Continue' : 'Launch'} as ${me.value?.callsign ?? '…'}`}</button>
      <p class="fine">An expo quest by Lean X Digital. Unofficial — not affiliated with MATRADE or MIHAS.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ HUD */

function Hud({ engine }: Eng) {
  const m = me.value!, mi = mission.value, st = nearStation.value, has = st && stampedSet.value.has(st.id), view = st ? stationMap.value.get(st.id) : undefined;
  const [stamping, setStamping] = useState(false);
  const floor = RANKS.find((r) => r.id === m.rank.id)?.xp ?? 0, span = m.nextRank ? m.nextRank.xp - floor : 1, into = m.nextRank ? m.xp - floor : 1;
  const gate = m.blockedBy === 'docked' ? 'Dock at the Launch Pad to rank up' : m.blockedBy === 'passport' ? 'Claim your Passport to rank up' : null;
  const goal = guideTarget.value, stName = st ? view?.company || st.name || 'Station ' + st.id : '';
  const job = missions.value?.active ?? null, storm = missions.value?.storm ?? null, offers = missions.value?.offers.length ?? 0;

  const doStamp = async () => { if (!st) return; setStamping(true); await engine()?.stamp(st); setStamping(false); };
  const openStation = () => { panelStation.value = st; modal.value = 'station'; };

  return (
    <>
      <div class="rank">
        <div class="rank-top"><strong>{m.rank.label}</strong><span>{m.callsign}</span></div>
        <div class="bar"><i style={{ width: `${Math.min(100, (into / span) * 100)}%` }} /></div>
        <div class="rank-bot"><span>{m.xp.toLocaleString()} XP{m.nextRank ? ` / ${m.nextRank.xp.toLocaleString()}` : ''}</span><span title="Signal">⚡ {m.signal}</span><span title="Stamps">◆ {m.stamps.length}</span><span title="Links">⇄ {m.links}</span></div>
        {gate && <div class="gate">{gate}</div>}
        <button class="sectorstrip" onClick={() => (modal.value = 'crews')} aria-label="Sector control">
          {(level.value?.decks ?? []).slice().sort((a, b) => a.level - b.level).map((d) => (
            <span key={d.level} class={'deckgroup' + (d.level === currentDeck.value ? ' here' : '')}>
              {(sectors.value?.sectors ?? []).filter((s) => level.value!.halls.find((h) => h.id === s.hall)?.deck === d.level).sort((a, b) => a.hall - b.hall).map((s) => <i key={s.hall} style={s.holder ? { background: hex(CREW_INFO[s.holder].color), color: '#06202f' } : {}}>{s.hall}</i>)}
            </span>
          ))}
          {m.cls && <em style={{ color: hex(CREW_INFO[m.cls].color) }}>{CREW_INFO[m.cls].crew}</em>}
        </button>
      </div>

      <div class="tools">
        <button class={'chip' + (!job && offers ? ' pulse' : '')} onClick={() => (modal.value = 'missions')}>Missions{storm ? ' ⚡' : ''}</button>
        <button class="chip" onClick={() => (modal.value = 'find')}>Find</button>
        <button class="chip" onClick={() => (modal.value = 'link')}>Link</button>
        <button class="chip" onClick={() => (modal.value = 'menu')} aria-label="Menu">☰</button>
        <span class="chip ghost">{online.value} online</span>
      </div>

      {mi && (
        <div class="mission">
          <div class="k">{goal ? 'Guiding you to' : job ? `Director · ${job.progress}` : mi.k}</div><h2>{goal ? goal.label : job ? job.title : mi.title}</h2>{!goal && <p>{job ? job.brief : mi.body}</p>}
          {guideOn.value && goalVia.value && <div class="via">⇅ {goalVia.value}</div>}
          {guideOn.value && distToGoal.value != null && (
            <div class="dist"><span>{distToGoal.value} m {goalVia.value ? 'to the lift' : goal ? 'to go' : 'to the X'}</span>
              <span>{goal && <button class="link" onClick={() => (guideTarget.value = null)}>Cancel</button>} <button class="link" onClick={() => engine()?.autopilot()}>Take me there</button></span></div>
          )}
        </div>
      )}

      <div class="action">
        {nearLift.value && <div class="liftrow">{nearLift.value.others.map((l) => <button key={l.deck} class="btn lift" onClick={() => engine()?.useLift(l)}>⇅ Level {l.deck}<small>{level.value?.decks.find((d) => d.level === l.deck)?.label.split(' · ')[1]}</small></button>)}</div>}
        {atLaunchPad.value && !m.passport && <button class="btn primary big" onClick={() => (modal.value = 'passport')}>Claim your Passport</button>}
        {atLaunchPad.value && m.passport && !m.docked && <button class="btn primary big" onClick={() => (modal.value = 'ticket')}>Show Golden Ticket</button>}
        {!atLaunchPad.value && st && !has && <button class="btn primary big" disabled={stamping} onClick={doStamp}>{stamping ? 'Stamping…' : `Stamp ${stName}`}</button>}
        {!atLaunchPad.value && st && (
          <button class={'chip' + (has ? ' on' : '')} onClick={openStation}>{has ? '◆ ' : ''}{stName} · {view ? (view.hosted ? 'host here now' : 'online') : 'station'} ›</button>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ passport */

function PassportForm() {
  const [f, setF] = useState<PassportInput>({ name: '', company: '', role: '', phone: '', email: '', showContact: true, consentMarketing: false, consentNotice: false });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  // functional update: browser autofill fires several input events in one tick, and a stale closure would keep only the last
  const set = (k: keyof PassportInput) => (e: Event) => { const t = e.target as HTMLInputElement, v = t.type === 'checkbox' ? t.checked : t.value; setF((p) => ({ ...p, [k]: v })); };
  const submit = async (e: Event) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api.passport(f); api.track('passport'); modal.value = 'ticket'; }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Something went wrong'); setBusy(false); }
  };
  return (
    <Sheet k="You found the X" title="Your Passport">
      <form onSubmit={submit}>
        <p class="lead">Your digital business card — built live. It is what you exchange with people and exhibitors for the rest of the mission.</p>
        <label>Name<input required maxLength={80} autocomplete="name" value={f.name} onInput={set('name')} /></label>
        <label>Company<input required maxLength={100} autocomplete="organization" value={f.company} onInput={set('company')} /></label>
        <label>Role<input maxLength={80} autocomplete="organization-title" value={f.role} onInput={set('role')} /></label>
        <div class="two">
          <label>WhatsApp / phone<input required type="tel" inputMode="tel" autocomplete="tel" placeholder="+60…" value={f.phone} onInput={set('phone')} /></label>
          <label>Email<input required type="email" autocomplete="email" value={f.email} onInput={set('email')} /></label>
        </div>
        <label class="check"><input type="checkbox" checked={f.showContact} onChange={set('showContact')} /><span>Show my phone and email on my public card page</span></label>
        <label class="check"><input type="checkbox" checked={f.consentNotice} onChange={set('consentNotice')} /><span>I have read the <a href="/privacy.html" target="_blank" rel="noopener">Privacy Notice</a> and agree to Lean X Digital processing my details to run Mission X.</span></label>
        <label class="check"><input type="checkbox" checked={f.consentMarketing} onChange={set('consentMarketing')} /><span>Optional — Lean X Digital may contact me by WhatsApp or email about its services.</span></label>
        {err && <p class="err" role="alert">{err}</p>}
        <button class="btn primary big" disabled={busy}>{busy ? 'Building your card…' : 'Issue my Passport · +200 XP'}</button>
      </form>
    </Sheet>
  );
}

function Ticket() {
  const m = me.value!;
  useEffect(() => { // the crew's scan lands on the server; poll until it shows up here
    const id = setInterval(async () => { try { await api.me(); if (me.value?.docked) { modal.value = 'docked'; api.track('docked'); } } catch { /* keep trying */ } }, 4000);
    return () => clearInterval(id);
  }, []);
  if (!m.passport || !m.ticket) return null;
  const url = `${location.origin}/crew.html?t=${encodeURIComponent(m.ticket.token)}`;
  return (
    <div class="scrim"><div class="sheet ticket">
      <button class="close" aria-label="Close" onClick={() => (modal.value = null)}>×</button>
      <div class="k gold">Golden Ticket</div><h2>{m.passport.name}</h2>
      <p class="lead">{[m.passport.role, m.passport.company].filter(Boolean).join(' · ')}</p>
      <Qr text={url} label="Golden Ticket QR code" />
      <div class="code">{m.ticket.code}</div>
      <p class="lead">Show this at the <b>real</b> Booth <b>8H18B</b>. Crew scans it — <b>+500 XP</b> and your rank unlocks.</p>
      <p class="fine">Enter Hall 8 · turn left past MIHAS Merchandise · turn right at the end · second booth on the right, opposite Bernama Studio.</p>
      <a class="btn" href={m.passport.url} target="_blank" rel="noopener">Open my card page</a>
    </div></div>
  );
}

function Docked() {
  const m = me.value!;
  return (
    <div class="scrim"><div class="sheet ticket">
      <div class="k gold">Mission complete</div><h2>Docked. Welcome aboard, {m.rank.label}.</h2>
      <p class="lead">You made it real. +500 XP — your rank is unlocked and the rest of the station is yours to chart.</p>
      <button class="btn primary big" onClick={() => (modal.value = null)}>Keep exploring</button>
    </div></div>
  );
}

const Toasts = () => (
  <div class="toasts" aria-live="polite">{toasts.value.map((t) => <div key={t.id} class={'toast ' + t.tone}><strong>{t.title}</strong>{t.sub && <span>{t.sub}</span>}</div>)}</div>
);
