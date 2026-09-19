import { useEffect, useState } from 'preact/hooks';
import type { Engine } from '../game/engine';
import { api, ApiError } from '../net/api';
import { MISSION_STAMPS, POINTS, ROLE_INFO, chapters, type Role } from '../../shared/rules';
import type { PassportInput } from '../../shared/types';
import { atLaunchPad, bootError, bootNote, distToGoal, goalVia, guideOn, guideTarget, journey, level, me, modal, nearLift, nearStation, panelStation, phase, stampedSet, stationMap, toast, toasts } from '../state';
import { DemoChip, TicketDemoHint, TourSheet } from '../demo/Tour';
import { Qr, Sheet, hex } from './common';
import { BoardSheet, BoothSheet, ClaimSheet, ContactsSheet, FindSheet, MenuSheet, MyBoothSheet, SwapSheet } from './sheets';

type Eng = { engine: () => Engine | null };

export function App({ engine }: Eng) {
  const m = modal.value;
  return (
    <>
      {phase.value === 'boot' && <Splash text={bootNote.value} />}
      {phase.value === 'error' && <Splash text={bootError.value} error />}
      {phase.value === 'start' && <Start engine={engine} />}
      {phase.value === 'play' && <Hud engine={engine} />}
      {m === 'card' && <CardForm />}
      {m === 'prize' && <PrizeCode />}
      {(m === 'claimed' || m === 'complete') && <Finish />}
      {m === 'rules' && <Rules />}
      {m === 'board' && <BoardSheet />}
      {m === 'booth' && <BoothSheet engine={engine} />}
      {m === 'claim' && <ClaimSheet />}
      {m === 'mybooth' && <MyBoothSheet />}
      {m === 'swap' && <SwapSheet />}
      {m === 'contacts' && <ContactsSheet />}
      {m === 'find' && <FindSheet />}
      {m === 'menu' && <MenuSheet />}
      {m === 'tour' && <TourSheet />}
      <Toasts />
    </>
  );
}

const Brand = ({ corner }: { corner?: boolean }) => (
  <div class={'brand' + (corner ? ' corner' : '')}><span>lean<b>.x</b>digital</span><i /><span>ne<b>x</b>ova</span></div>
);

const Splash = ({ text, error }: { text: string; error?: boolean }) => (
  <div class="splash"><div class={error ? 'xmark err' : 'xmark'} aria-hidden="true" /><p>{text}</p>{error && <button class="btn" onClick={() => location.reload()}>Try again</button>}</div>
);

/* ------------------------------------------------------------------ start: two doors */

function Start({ engine }: Eng) {
  const [busy, setBusy] = useState<Role | null>(null), was = me.value?.cls ?? null;
  const go = async (role: Role) => {
    setBusy(role);
    try {
      await api.start(role); engine()?.start('short'); phase.value = 'play'; api.track('start', { role });
      if (role === 'exhibitor') modal.value = me.value?.passport ? 'mybooth' : 'card';
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not start', undefined, 'warn'); setBusy(null); }
  };
  const door = (role: Role, title: string, sub: string) => (
    <button class={'door' + (was === role ? ' on' : '')} disabled={!!busy} onClick={() => go(role)}>
      <span class="dot" style={{ background: hex(ROLE_INFO[role].color) }} /><strong>{busy === role ? 'Landing…' : title}</strong><small>{sub}</small><span class="go" aria-hidden="true">›</span>
    </button>
  );
  return (
    <>
      <Brand corner />
      <div class="sheet start">
        <div class="k">Mission X · MIHAS 2026</div>
        <h1>Find the <b>X</b>.</h1>
        <p class="lead">The whole MIHAS expo, live on your phone. Walk it, stamp booths, meet people — and find the X for your free digital business card.</p>
        <div class="doors">
          {door('visitor', was === 'visitor' ? 'Continue visiting' : "I'm visiting", 'One mission, about five minutes. A free gift at the end.')}
          {door('exhibitor', was === 'exhibitor' ? 'Back to my booth' : "I'm exhibiting", 'Put your booth in the game. Collect visitor leads, free.')}
        </div>
        <p class="fine">An expo game by Lean X Digital. Unofficial — not affiliated with MATRADE or MIHAS.</p>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ in play: one instruction at a time */

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const ICONS = { find: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm5 12 4 4', swap: 'M7 7h11l-3-3M17 17H6l3 3', menu: 'M4 7h16M4 12h16M4 17h16' };

function Hud({ engine }: Eng) {
  const m = me.value!, j = journey.value!, st = nearStation.value, has = st && stampedSet.value.has(st.id), view = st ? stationMap.value.get(st.id) : undefined;
  const [stamping, setStamping] = useState(false), [open, setOpen] = useState(false);
  const goal = guideTarget.value, stName = st ? view?.company || st.name || 'Booth ' + st.id : '', total = (level.value?.booths.length ?? 1) - 1;
  const trail = guideOn.value && distToGoal.value != null && (goal || (!m.passport && j.kind === 'visitor'));
  const word = j.kind === 'visitor' ? 'Chapter' : 'Step';

  // the ending is shown once, the moment the fifth chapter closes and nothing else is on screen
  useEffect(() => {
    if (j.kind !== 'visitor' || j.now || modal.value) return;
    try { if (localStorage.getItem('mx_complete')) return; localStorage.setItem('mx_complete', '1'); } catch { /* private mode: show it */ }
    modal.value = 'complete'; api.track('mission_complete');
  }, [j.now, modal.value]);

  const doStamp = async () => { if (!st) return; setStamping(true); await engine()?.stamp(st); setStamping(false); };
  const toX = () => { const h = level.value!.hero; guideTarget.value = { x: h.dock.x, y: h.dock.y, label: 'The X · Booth 8H18B' }; guideOn.value = true; };

  return (
    <>
      {/* top-left: what to do now. One card, nothing else up here. */}
      <div class={'objective' + (open ? ' open' : '')} onClick={() => setOpen(!open)}>
        <div class="top">
          <span class="k">{goal ? 'Guiding you to' : j.now ? `${word} ${j.now.n} of ${j.steps.length}` : j.kind === 'visitor' ? 'Mission complete' : 'Your booth is working'}</span>
          <span class="score" title="Points">{m.xp.toLocaleString()}</span>
        </div>
        <h2>{goal ? goal.label : j.now ? j.now.title : 'Free play'}</h2>
        {!goal && <p>{j.now ? j.now.todo : `${m.stamps.length} of ${total.toLocaleString()} booths stamped. Keep going, meet more people, climb the board.`}</p>}
        {!goal && <div class="dots" role="img" aria-label={`${j.done} of ${j.steps.length} done`}>{j.steps.map((s) => <i key={s.n} class={s.done ? 'on' : s === j.now ? 'now' : ''} />)}</div>}
        {!goal && j.kind === 'visitor' && j.now?.n === 3 && <div class="via">{Math.min(m.stamps.length, MISSION_STAMPS)} of {MISSION_STAMPS} stamped</div>}
        {!goal && j.kind === 'visitor' && j.now?.n === 4 && <div class="go-row"><span>Met someone?</span><button class="btn primary" onClick={(e) => { e.stopPropagation(); modal.value = 'swap'; }}>Swap cards</button></div>}
        {!goal && j.kind === 'visitor' && j.now?.n === 5 && <div class="go-row"><button class="link" onClick={(e) => { e.stopPropagation(); toX(); }}>Guide me to the X</button><button class="btn primary" onClick={(e) => { e.stopPropagation(); modal.value = 'prize'; }}>My prize code</button></div>}
        {!goal && j.kind === 'exhibitor' && <div class="go-row"><span /><button class="btn primary" onClick={(e) => { e.stopPropagation(); modal.value = m.passport ? 'mybooth' : 'card'; }}>{m.hosting.length ? 'Open my booth' : 'Set up my booth'}</button></div>}
        {trail && goalVia.value && <div class="via">{goalVia.value}</div>}
        {trail && (
          <div class="go-row"><span>{distToGoal.value} m {goalVia.value ? 'to the lift' : ''}</span>
            <span>{goal && <button class="link" style={{ marginRight: '12px' }} onClick={(e) => { e.stopPropagation(); guideTarget.value = null; }}>Cancel</button>}<button class="btn primary" onClick={(e) => { e.stopPropagation(); engine()?.autopilot(); }}>Take me there</button></span></div>
        )}
      </div>

      {/* bottom-right, under the thumb: the three things you can always do */}
      <div class="dock">
        <DemoChip />
        <button aria-label="Find a booth" title="Find" onClick={() => (modal.value = 'find')}><Icon d={ICONS.find} /></button>
        <button aria-label="Swap cards" title="Swap cards" onClick={() => (modal.value = 'swap')}><Icon d={ICONS.swap} /></button>
        <button aria-label="Menu" title="Menu" onClick={() => (modal.value = 'menu')}><Icon d={ICONS.menu} /></button>
      </div>

      {/* bottom-centre: the one thing you can do right here */}
      <div class="action">
        {nearLift.value && <div class="liftrow">{nearLift.value.others.map((l) => <button key={l.deck} class="btn lift" onClick={() => engine()?.useLift(l)}>Level {l.deck}<small>{level.value?.decks.find((d) => d.level === l.deck)?.label.split(' · ')[1]}</small></button>)}</div>}
        {atLaunchPad.value && !m.passport && <button class="btn primary big" onClick={() => (modal.value = 'card')}>Get my free card</button>}
        {atLaunchPad.value && m.passport && !m.docked && <button class="btn primary big" onClick={() => (modal.value = 'prize')}>Show my prize code</button>}
        {!atLaunchPad.value && st && !has && <button class="btn primary big" disabled={stamping} onClick={doStamp}>{stamping ? 'Stamping…' : `Stamp · +${POINTS.stamp}`}</button>}
        {!atLaunchPad.value && st && (
          <button class={'chip' + (has ? ' on' : '')} onClick={() => { panelStation.value = st; modal.value = 'booth'; }}>{stName}{view ? (view.hosted ? ' · at the counter now' : ' · online') : ''} ›</button>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ the card, the prize code, the ending */

function CardForm() {
  const exhibitor = me.value?.cls === 'exhibitor';
  const [f, setF] = useState<PassportInput>({ name: '', company: '', role: '', phone: '', email: '', showContact: true, consentMarketing: false, consentNotice: false });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  // functional update: browser autofill fires several input events in one tick, and a stale closure would keep only the last
  const set = (k: keyof PassportInput) => (e: Event) => { const t = e.target as HTMLInputElement, v = t.type === 'checkbox' ? t.checked : t.value; setF((p) => ({ ...p, [k]: v })); };
  const submit = async (e: Event) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await api.card(f); api.track('card'); modal.value = exhibitor ? 'mybooth' : 'prize'; }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Something went wrong'); setBusy(false); }
  };
  return (
    <Sheet k={exhibitor ? 'First · who runs the booth' : 'You found the X'} title="Your free digital business card">
      <form onSubmit={submit}>
        <p class="lead">{exhibitor ? 'Your card tells visitors and our crew who is behind the booth. It takes a minute, and it is yours to keep.' : 'Built for you now, yours to keep: a card with its own link and QR. It is what you swap with people and leave at booths.'}</p>
        <label>Name<input required maxLength={80} autocomplete="name" value={f.name} onInput={set('name')} /></label>
        <label>Company<input required maxLength={100} autocomplete="organization" value={f.company} onInput={set('company')} /></label>
        <label>Role<input maxLength={80} autocomplete="organization-title" value={f.role} onInput={set('role')} /></label>
        <div class="two">
          <label>WhatsApp / phone<input required type="tel" inputMode="tel" autocomplete="tel" placeholder="+60…" value={f.phone} onInput={set('phone')} /></label>
          <label>Email<input required type="email" autocomplete="email" value={f.email} onInput={set('email')} /></label>
        </div>
        <label class="check"><input type="checkbox" checked={f.showContact} onChange={set('showContact')} /><span>Show my phone and email on my card page</span></label>
        <label class="check"><input type="checkbox" checked={f.consentNotice} onChange={set('consentNotice')} /><span>I have read the <a href="/privacy.html" target="_blank" rel="noopener">Privacy Notice</a> and agree to Lean X Digital processing my details to run Mission X. My first name and initial show in the game and on the leaderboard.</span></label>
        <label class="check"><input type="checkbox" checked={f.consentMarketing} onChange={set('consentMarketing')} /><span>Optional — Lean X Digital may contact me by WhatsApp or email about its services.</span></label>
        {err && <p class="err" role="alert">{err}</p>}
        <button class="btn primary big" disabled={busy}>{busy ? 'Building your card…' : `Create my card · +${POINTS.card}`}</button>
      </form>
    </Sheet>
  );
}

function PrizeCode() {
  const m = me.value!;
  useEffect(() => { // the crew's scan lands on the server; poll until it shows up here
    const id = setInterval(async () => { try { await api.me(); if (me.value?.docked) { modal.value = 'claimed'; api.track('claimed'); } } catch { /* keep trying */ } }, 4000);
    return () => clearInterval(id);
  }, []);
  if (!m.passport || !m.ticket) return null;
  const url = `${location.origin}/crew.html?t=${encodeURIComponent(m.ticket.token)}`;
  return (
    <div class="scrim"><div class="sheet ticket">
      <button class="close" aria-label="Close" onClick={() => (modal.value = null)}>×</button>
      <div class="k gold">Prize code</div><h2>{m.passport.name}</h2>
      <p class="lead">{[m.passport.role, m.passport.company].filter(Boolean).join(' · ')}</p>
      <Qr text={url} label="Prize code QR" />
      <div class="code">{m.ticket.code}</div>
      <p class="lead">Show this at the <b>real</b> Booth <b>8H18B</b>. Our crew scans it: <b>+{POINTS.booth} points</b> and your free gift.</p>
      <p class="fine">MIHAS 2026 · MITEC Kuala Lumpur · 23–26 September · Hall 8, Level 2 — enter Hall 8, left past MIHAS Merchandise, right at the end, second booth on the right. Your code waits for you until the show closes.</p>
      <a class="btn" href={m.passport.url} target="_blank" rel="noopener">Open my card</a>
      <TicketDemoHint />
    </div></div>
  );
}

/** Two moments, one screen: the crew's scan at the booth, and the fifth chapter closing. When both are true this is the ending. */
function Finish() {
  const j = journey.value, left = j?.kind === 'visitor' ? j.steps.filter((s) => !s.done) : [];
  const complete = j?.kind === 'visitor' && left.length === 0;
  const close = () => { try { if (complete) localStorage.setItem('mx_complete', '1'); } catch { /* ignore */ } modal.value = null; };
  return (
    <div class="scrim"><div class="sheet ticket">
      <div class="k gold">{complete ? 'Mission complete' : 'Claimed at Booth 8H18B'}</div>
      {complete ? (
        <>
          <h2>You found the X.</h2>
          <p class="lead">In a few minutes you found a brand, got something useful from it, looked around, made a contact, and showed up in person.</p>
          <p class="lead">That is a customer journey. Building them is what <b>Lean X Digital</b> does for businesses.</p>
          <a class="btn primary big" href="https://www.nexova.my" target="_blank" rel="noopener" onClick={() => api.track('cta_nexova')}>See what we could build for you</a>
          <button class="btn big" style={{ marginTop: '8px' }} onClick={close}>Keep playing</button>
        </>
      ) : (
        <>
          <h2>+{POINTS.booth} points. Enjoy your gift.</h2>
          <p class="lead">{left.length ? <>Still open: {left.map((s) => s.title).join(' · ')}. Finish them to complete the mission.</> : 'Thank you for coming by.'}</p>
          <button class="btn primary big" onClick={close}>Keep playing</button>
        </>
      )}
    </div></div>
  );
}

/* ------------------------------------------------------------------ the whole rulebook */

function Rules() {
  const rows: [string, number][] = [['Stamp a booth in the game', POINTS.stamp], ['Leave your card at a booth', POINTS.leaveCard], ['Scan a booth QR at the real booth', POINTS.scan], ['Swap cards with a person', POINTS.swap], ['Get your digital business card at the X', POINTS.card], ['Show your prize code at the real Booth 8H18B', POINTS.booth]];
  return (
    <Sheet k="How to play" title="One mission. Five chapters.">
      <ol class="rules">{chapters({ started: false, card: false, stamps: 0, swaps: 0, cardsLeft: 0, claimed: false }).map((c) => <li key={c.n}><strong>{c.title}</strong><span>{c.todo}</span></li>)}</ol>
      <p class="fine">After the mission it is free play: every action scores, and the board ranks everyone by points.</p>
      <table class="points"><tbody>{rows.map(([what, n]) => <tr key={what}><td>{what}</td><td>+{n}</td></tr>)}</tbody></table>
      <p class="fine">Exhibitors: bring your booth online, show its QR at your counter, and collect the cards visitors leave — free. The board ranks booths by visits.</p>
    </Sheet>
  );
}

const Toasts = () => (
  <div class="toasts" aria-live="polite">{toasts.value.map((t) => <div key={t.id} class={'toast ' + t.tone}><strong>{t.title}</strong>{t.sub && <span>{t.sub}</span>}</div>)}</div>
);
