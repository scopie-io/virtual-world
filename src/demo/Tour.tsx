// Demo-only UI: the tour checklist and the small helpers that stand in for a second person, a booth crew, or being at
// MITEC. Every component here renders nothing unless demo mode is on, so the live game is untouched.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import './demo.css';
import { api } from '../net/api';
import { handleScan } from '../scan';
import { Sheet, useCountdown, useDeadline } from '../ui/common';
import { currentDeck, gcView, guideOn, guideTarget, level, me, missions, modal, online, toast } from '../state';
import { demo, demoApi, demoState, type StationHint } from './client';

const warn = (e: unknown) => toast(e instanceof Error ? e.message : 'Demo helper failed', undefined, 'warn', 4500);
const DemoTag = () => <span class="demotag">Demo</span>;

/** HUD chip that opens the tour. */
export function DemoChip() {
  if (!demo.value) return null;
  return <button class="chip demochip" onClick={() => (modal.value = 'tour')}>Demo tour</button>;
}

/** Station sheet: what the host's screen shows right now (type it in, as a visitor would), and the booth's printed beacon. */
export function StationDemoHint({ stationId, onDigits }: { stationId: string; onDigits: (d: string) => void }) {
  const [h, setH] = useState<StationHint | null>(null), left = useCountdown(useDeadline(h?.expiresInMs, h));
  useEffect(() => { if (!demo.value) return; let stop = false; const pull = () => demoApi.hint(stationId).then((x) => !stop && setH(x), () => {}); void pull(); const id = setInterval(pull, 5000); return () => { stop = true; clearInterval(id); }; }, [stationId]);
  if (!demo.value || !h) return null;
  return (
    <div class="box demobox">
      <strong><DemoTag /> Standing at the real booth</strong>
      {h.claimed
        ? <p class="fine">The host's screen shows <b class="mono">{h.digits?.replace(/(\d{3})/, '$1 ')}</b> right now (new code in {left}s). Visitors scan or type it.</p>
        : <p class="fine">Nobody hosts this booth, so there is no live code — only the printed beacon card on its counter.</p>}
      <div class="stack">
        {h.claimed && h.digits && <button class="btn" onClick={() => onDigits(h.digits!)}>Type the host code for me</button>}
        <button class="btn" onClick={() => void handleScan(`?b=${encodeURIComponent(h.beacon)}`)}>Scan this booth's printed beacon</button>
      </div>
      {!me.value?.onsite && <p class="fine">Beacons pay in full only after a venue check-in (Menu → Presence). Host codes always count as on site.</p>}
    </div>
  );
}

/** Link sheet: the other person. */
export function LinkDemoHint({ mode, onCode }: { mode: 'show' | 'scan'; onCode: (code: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!demo.value) return null;
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { warn(e); } setBusy(false); };
  return (
    <div class="box demobox left">
      <strong><DemoTag /> The person you just met</strong>
      {mode === 'show'
        ? <><p class="fine">Normally they point their camera at your code. Here a visitor from the demo cast does it.</p>
          <button class="btn" disabled={busy} onClick={() => run(async () => { const r = await demoApi.partnerScan(); if (!r) toast('No code on screen yet', 'Wait a second and try again', 'warn'); else await api.me(); })}>Have a visitor scan my code</button></>
        : <><p class="fine">Normally you scan their screen. Here a visitor shows you a fresh code.</p>
          <button class="btn" disabled={busy} onClick={() => run(async () => { const r = await demoApi.partnerCode(); if (r) { toast(`${r.callsign} shows you their code`, r.code.replace(/(.{4})/, '$1 ')); onCode(r.code); } else toast('You have linked with everyone in the cast', undefined, 'info'); })}>Get a visitor's code</button></>}
    </div>
  );
}

/** Host screen: footfall on demand. (The cast also walks over by itself while this screen is open.) */
export function HostDemoHint({ onLead }: { onLead: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!demo.value) return null;
  return (
    <div class="box demobox left">
      <strong><DemoTag /> Visitors</strong>
      <p class="fine">While this screen is open, visitors from the demo cast walk to your booth, scan the code and may share their card. Or skip the wait:</p>
      <button class="btn" disabled={busy} onClick={async () => { setBusy(true); try { const r = await demoApi.visitor(); if (r) { toast(`${r.name} scanned your code`, 'Verified contact · card shared', 'xp'); onLead(); } else toast('Everyone in the cast has already visited', undefined, 'info'); } catch (e) { warn(e); } setBusy(false); }}>Send a visitor now</button>
    </div>
  );
}

/** Golden Ticket: the booth crew. */
export function TicketDemoHint() {
  const [busy, setBusy] = useState(false), pin = demoState.value?.crewPin ?? '';
  if (!demo.value) return null;
  return (
    <div class="box demobox left">
      <strong><DemoTag /> The crew at 8H18B</strong>
      <p class="fine">Be the crew yourself: open the <a class="link" href="/crew.html" target="_blank" rel="noopener">crew console</a> in a new tab (PIN <b class="mono">{pin}</b>), type the 6-character code above and confirm — this screen flips to “Docked” within a few seconds.</p>
      <button class="btn" disabled={busy} onClick={async () => { setBusy(true); try { await demoApi.dock(); await api.me(); if (me.value?.docked) modal.value = 'docked'; } catch (e) { warn(e); } setBusy(false); }}>…or simulate the crew's scan</button>
    </div>
  );
}

export const GcDemoHint = () => (demo.value ? <p class="fine"><DemoTag /> A partner from the demo cast joins about five seconds after you start looking. As Ground Control, drop a marker next to the pink beam and watch your astronaut walk it. To fly as the Astronaut instead, check in at the venue first (Menu → Presence).</p> : null);
export const PresenceDemoHint = () => (demo.value ? <p class="fine"><DemoTag /> Your location is simulated here: “check me in” places this browser at MITEC without asking for GPS. Scanning a host code also puts you “on deck” — tap <b>Free roam</b> in the green bar to walk on with the keyboard.</p> : null);
export const TeamDemoHint = () => {
  const t = demoState.value?.teams ?? [];
  return demo.value && t.length ? <p class="fine"><DemoTag /> Teams already flying: {t.map((x, i) => <span key={x.code}>{i ? ' · ' : ''}{x.name} <b class="mono">{x.code}</b></span>)}. Join one with its code, or create your own.</p> : null;
};

/* ------------------------------------------------------------------ the tour */

function Step({ done, title, children }: { done?: boolean; title: string; children: ComponentChildren }) {
  return <li class={done ? 'done' : ''}><span class="tick" aria-hidden="true">{done ? '✓' : ''}</span><div><strong>{title}</strong><div class="how">{children}</div></div></li>;
}

export function TourSheet() {
  const m = me.value, s = demoState.value, [busy, setBusy] = useState(false);
  if (!demo.value || !m || !s) return null;
  const go = (x: typeof modal.value) => () => (modal.value = x);
  const find = (id: string | null | undefined, label?: string) => () => { const b = level.value?.booths.find((k) => k.id === id); if (b) { guideTarget.value = { x: b.x, y: b.y, label: label ?? (b.name || `Station ${b.id}`) }; guideOn.value = true; modal.value = null; toast('Trail set', 'Tap “Take me there” to autopilot'); } };
  const L = ({ to, children }: { to: () => void; children: ComponentChildren }) => <button class="link" onClick={to}>{children}</button>;
  const near = s.hostedNear[0], gc = gcView.value;

  return (
    <Sheet k="Demo mode · no backend configured" title="Everything up to M4, in this browser" wide>
      <p class="lead">The real game server is running inside this browser tab, with a simulated show floor: {s.bots} exhibitors and visitors, a few hours of history, live movement. Nothing is sent anywhere; the world lives in this browser and survives reloads. The ticks fill in as you go.</p>

      <h3 class="tourh">M1 · Find the X</h3>
      <ol class="tour">
        <Step done={!!m.cls} title="Suit up and walk">WASD / arrow keys, drag the joystick, or tap the floor. Drag to orbit, scroll or pinch to zoom. {online.value} astronauts are flying with you — translucent ones play from home, solid ones are “really” on the floor.</Step>
        <Step done={!!m.passport} title="Reach the Launch Pad, claim your Passport">Follow the trail or tap <b>Take me there</b>. At the golden beam, fill the Passport form — that is the lead capture. Your public card page opens from the ticket.</Step>
        <Step done={m.docked} title="Golden Ticket → crew docking">{m.passport && !m.docked ? <L to={go('ticket')}>Open my ticket</L> : 'Your ticket appears with the Passport'}, then dock it from the <a class="link" href="/crew.html" target="_blank" rel="noopener">crew console</a> (PIN <b class="mono">{s.crewPin}</b>) or use the simulate button on the ticket. +500 XP, rank gate opens.</Step>
        <Step done={m.stamps.length > 0} title="Stamp stations">Walk up to any booth → <b>Stamp</b>. Remote stamps pay 15 %; quiet corners and new halls pay more; 45 s scanner cooldown.</Step>
      </ol>

      <h3 class="tourh">M2 · Exhibitors and people</h3>
      <ol class="tour">
        <Step done={m.verified.length > 0} title="Host code → Verified Contact">{near ? <><L to={find(near.id)}>Guide me to {near.name}</L> (host is there now). </> : null}Open the station panel: the demo box shows the code on the host's screen. Enter it → on-site stamp + Verified Contact, and you are placed “on deck”.</Step>
        <Step done={m.shared.length > 0} title="Share your Passport with an exhibitor">After stamping an online station, choose the fields and share. It appears in <L to={go('contacts')}>Contacts</L>; you can take it back.</Step>
        <Step done={m.links > 0} title="Link-up with a person"><L to={go('link')}>Open Link</L> — try both directions with the demo visitor. Then add a private note in Contacts and save the vCard.</Step>
        <Step done={m.hosting.length > 0} title="Be an exhibitor: claim a booth and host it">Walk to any dark booth → <b>This is my booth</b>. The host screen shows your rotating code; demo visitors arrive and your lead list fills (CSV export). Approve your claim in the crew console → Stations{s.pendingStation ? <> (booth {s.pendingStation} is also waiting there)</> : null}.</Step>
        <Step title="Avatar, crews, find"><L to={go('suit')}>Suit up</L> (some items are rank-locked) · <L to={go('crews')}>Sector control</L> — crews take halls every 30 min · <L to={go('find')}>Find</L> any of 1,599 booths or 337 exhibitors.</Step>
      </ol>

      <h3 class="tourh">M3 · Presence, missions, co-op</h3>
      <ol class="tour">
        <Step done={m.onsite} title="Be “at MIHAS”"><L to={go('presence')}>Presence</L> → check in (simulated here). Beacons, walking and missions then pay in full. Invisible mode is there too.</Step>
        <Step done={!!missions.value?.active} title="Mission Director"><L to={go('missions')}>Missions</L>: three offers chosen from where you stand. The ⚡ Signal Storm (stamps ×2 in the quietest zone) and the ★ Daily Drop{s.drop ? <> at booth {s.drop}</> : null} are listed there as well.</Step>
        <Step done={gc?.state === 'done'} title="Ground Control — two players, one target"><L to={go('gc')}>Ground Control</L>: remote = you steer a cast astronaut with floor markers; checked in = a cast controller steers you. +150 XP each.</Step>
      </ol>

      <h3 class="tourh">M4 · All three levels, boards, live ops</h3>
      <ol class="tour">
        <Step done={currentDeck.value !== 2} title="Take a lift">Walk onto a lift pad (Find → or follow “⇅” on the trail) → Level 1 or Level 3. All 1,599 booths on three decks share one world.</Step>
        <Step title="Boards, trust, company teams"><L to={go('board')}>Boards</L>: today · all-time · explorers · connectors · stations · companies, with the ✓ trust mark. <L to={go('team')}>Company team</L>: create one or join a cast team.</Step>
        <Step title="Crew console"><a class="link" href="/crew.html" target="_blank" rel="noopener">/crew.html</a> (PIN <b class="mono">{s.crewPin}</b>): scan · leads + CSV · station claims · <b>review</b> (one account is flagged for impossible jumps — open its ledger, void rows, ban) · <b>ops</b> (kill switches, Daily Drop) · printable beacons.</Step>
        <Step title="Mission Control big screen"><a class="link" href="/screen.html" target="_blank" rel="noopener">/screen.html</a> — sign in on the crew console first. Live fly-over, today's board, sectors, storm and drop tickers.</Step>
      </ol>

      <div class="box demobox left">
        <strong><DemoTag /> Shortcuts</strong>
        <div class="pills">
          <button class="chip" disabled={busy} onClick={async () => { setBusy(true); try { await demoApi.boost(); await api.me(); toast('+1,500 XP', 'Demo boost — see rank-locked looks in Suit up', 'xp'); } catch (e) { warn(e); } setBusy(false); }}>+1,500 XP</button>
          <button class="chip" onClick={find(level.value?.hero.id, 'Launch Pad')}>Trail to the Launch Pad</button>
          <button class="chip" disabled={busy} onClick={() => { if (confirm('Reset the demo world? Your demo player, stamps and leads in this browser are erased and the world is rebuilt.')) { setBusy(true); void demoApi.reset().catch(warn); } }}>Reset the demo world</button>
        </div>
        <p class="fine">Not part of a demo: two real phones meeting, the camera scanner, GPS and step tracking — those need the real backend and a real device. Add the database settings in Vercel and this demo switches itself off.</p>
      </div>
    </Sheet>
  );
}
