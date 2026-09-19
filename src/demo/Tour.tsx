// Demo-only UI: a short guide, and the small helpers that stand in for what one tester cannot be — a second person, an
// exhibitor's counter, our booth crew. Every component here renders nothing unless demo mode is on.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import './demo.css';
import { api } from '../net/api';
import { handleScan } from '../scan';
import { Sheet, useCountdown, useDeadline } from '../ui/common';
import { guideOn, guideTarget, journey, level, me, modal, toast } from '../state';
import { demo, demoApi, demoState, type StationHint } from './client';

const warn = (e: unknown) => toast(e instanceof Error ? e.message : 'Demo helper failed', undefined, 'warn', 4500);
const DemoTag = () => <span class="demotag">Demo</span>;

/** HUD chip that opens the guide. */
export function DemoChip() {
  if (!demo.value) return null;
  return <button class="chip demochip" onClick={() => (modal.value = 'tour')}>Demo guide</button>;
}

/** Booth sheet: what is on the exhibitor's counter right now — their live QR (as digits to type) and the printed one. */
export function StationDemoHint({ stationId, onDigits }: { stationId: string; onDigits: (d: string) => void }) {
  const [h, setH] = useState<StationHint | null>(null), left = useCountdown(useDeadline(h?.expiresInMs, h));
  useEffect(() => { if (!demo.value) return; let stop = false; const pull = () => demoApi.hint(stationId).then((x) => !stop && setH(x), () => {}); void pull(); const id = setInterval(pull, 5000); return () => { stop = true; clearInterval(id); }; }, [stationId]);
  if (!demo.value || !h) return null;
  return (
    <div class="box demobox">
      <strong><DemoTag /> Pretend you are standing at the real booth</strong>
      {h.claimed
        ? <p class="fine">The exhibitor's screen shows <b class="mono">{h.digits?.replace(/(\d{3})/, '$1 ')}</b> right now (new code in {left}s).</p>
        : <p class="fine">Nobody has brought this booth online, so there is only the printed QR our crew hands out.</p>}
      <div class="stack">
        {h.claimed && h.digits && <button class="btn" onClick={() => onDigits(h.digits!)}>Type the code for me</button>}
        <button class="btn" onClick={() => void handleScan(`?b=${encodeURIComponent(h.beacon)}`)}>Scan the printed booth QR</button>
      </div>
      <p class="fine">In the demo this browser counts as being at MIHAS, so a scan scores in full.</p>
    </div>
  );
}

/** Swap cards: the other person. */
export function LinkDemoHint({ mode, onCode }: { mode: 'show' | 'scan'; onCode: (code: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!demo.value) return null;
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { warn(e); } setBusy(false); };
  return (
    <div class="box demobox left">
      <strong><DemoTag /> The person you just met</strong>
      {mode === 'show'
        ? <><p class="fine">Normally they point their camera at your code. Here a simulated visitor does it.</p>
          <button class="btn" disabled={busy} onClick={() => run(async () => { const r = await demoApi.partnerScan(); if (!r) toast('No code on screen yet', 'Wait a second and try again', 'warn'); else await api.me(); })}>Have a visitor scan my code</button></>
        : <><p class="fine">Normally you scan their screen. Here a simulated visitor shows you a fresh code.</p>
          <button class="btn" disabled={busy} onClick={() => run(async () => { const r = await demoApi.partnerCode(); if (r) { toast(`${r.callsign} shows you their code`, r.code.replace(/(.{4})/, '$1 ')); onCode(r.code); } else toast('You have swapped with everyone in the demo', undefined, 'info'); })}>Get a visitor's code</button></>}
    </div>
  );
}

/** My booth: footfall on demand. (Simulated visitors also walk over by themselves while the QR is open.) */
export function HostDemoHint({ onLead }: { onLead: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!demo.value) return null;
  return (
    <div class="box demobox left">
      <strong><DemoTag /> Visitors</strong>
      <p class="fine">While this screen is open, simulated visitors walk to your booth, scan the QR and may leave their card. Or skip the wait:</p>
      <button class="btn" disabled={busy} onClick={async () => { setBusy(true); try { const r = await demoApi.visitor(); if (r) { toast(`${r.name} scanned your QR`, 'Met in person · left their card', 'xp'); onLead(); } else toast('Everyone in the demo has already visited', undefined, 'info'); } catch (e) { warn(e); } setBusy(false); }}>Send a visitor now</button>
    </div>
  );
}

/** Prize code: our booth crew. */
export function TicketDemoHint() {
  const [busy, setBusy] = useState(false), pin = demoState.value?.crewPin ?? '';
  if (!demo.value) return null;
  return (
    <div class="box demobox left">
      <strong><DemoTag /> Our crew at 8H18B</strong>
      <p class="fine">Be the crew yourself: open the <a class="link" href="/crew.html" target="_blank" rel="noopener">crew console</a> in a new tab (PIN <b class="mono">{pin}</b>), type the 6 characters above and confirm. This screen notices within a few seconds.</p>
      <button class="btn" disabled={busy} onClick={async () => { setBusy(true); try { await demoApi.dock(); await api.me(); if (me.value?.docked) modal.value = 'claimed'; } catch (e) { warn(e); } setBusy(false); }}>…or simulate the crew's scan</button>
    </div>
  );
}

/* ------------------------------------------------------------------ the guide */

function Row({ done, title, children }: { done?: boolean; title: string; children: ComponentChildren }) {
  return <li class={done ? 'done' : ''}><span class="tick" aria-hidden="true">{done ? '✓' : ''}</span><div><strong>{title}</strong><div class="how">{children}</div></div></li>;
}

export function TourSheet() {
  const m = me.value, s = demoState.value, j = journey.value, [busy, setBusy] = useState(false);
  if (!demo.value || !m || !s || !j) return null;
  const go = (x: typeof modal.value) => () => (modal.value = x);
  const find = (id: string | null | undefined) => () => { const b = level.value?.booths.find((k) => k.id === id); if (b) { guideTarget.value = { x: b.x, y: b.y, label: b.name || `Booth ${b.id}` }; guideOn.value = true; modal.value = null; toast('Trail set', 'Tap “Take me there”'); } };
  const L = ({ to, children }: { to: () => void; children: ComponentChildren }) => <button class="link" onClick={to}>{children}</button>;
  const near = s.hostedNear[0], ch = (n: number) => j.kind === 'visitor' && !!j.steps[n - 1]?.done;

  return (
    <Sheet k="Demo · no backend connected" title="The whole game, in this browser" wide>
      <p class="lead">The real game server is running inside this browser, on a simulated show floor: {s.bots} exhibitors and visitors who keep walking and stamping. Nothing leaves this device. It survives reloads; reset it below.</p>

      <h3 class="tourh">As a visitor · one mission, five chapters</h3>
      <ol class="tour">
        <Row done={ch(1)} title="1 · Arrive">Walk with WASD / arrow keys, the joystick, or tap the floor. Drag to look around, scroll or pinch to zoom.</Row>
        <Row done={ch(2)} title="2 · Find the X">Follow the trail, or tap <b>Take me there</b>. At the X, create your card — this is the lead capture.</Row>
        <Row done={ch(3)} title="3 · Collect">Walk up to any five booths and stamp them. {near ? <><L to={find(near.id)}>Guide me to {near.name}</L>: its exhibitor is “at the counter”, so you can also try a real-booth scan there (+50){s.drop === near.id ? ' — and it is the booth of the day' : ''}.</> : null}</Row>
        <Row done={ch(4)} title="4 · Connect"><L to={go('swap')}>Swap cards</L> with a simulated visitor — try both directions — or leave your card at a booth that is online. Then look at <L to={go('contacts')}>My contacts</L>.</Row>
        <Row done={ch(5)} title="5 · Make it real">{m.passport && !m.docked ? <L to={go('prize')}>Open my prize code</L> : 'Your prize code comes with the card'}: claim it from the crew console, or simulate the scan. When all five are done you get the ending.</Row>
      </ol>

      <h3 class="tourh">As an exhibitor · three steps</h3>
      <ol class="tour">
        <Row done={m.hosting.length > 0} title="Light up · get scanned · lead">Menu → <b>I am exhibiting</b> (or choose it on the first screen). Find a booth number, bring it online, keep the QR open: simulated visitors arrive and your lead list fills, with CSV export.</Row>
      </ol>

      <h3 class="tourh">As our crew</h3>
      <ol class="tour">
        <Row title="Crew console"><a class="link" href="/crew.html" target="_blank" rel="noopener">/crew.html</a>, PIN <b class="mono">{s.crewPin}</b>: scan prize codes · all leads + CSV · booths online{s.pendingStation ? <> (booth {s.pendingStation} is waiting for approval)</> : null} · review (one player is flagged for impossible jumps) · live switches and the booth of the day · printed booth QRs.</Row>
        <Row title="Big screen"><a class="link" href="/screen.html" target="_blank" rel="noopener">/screen.html</a> — sign in on the crew console first. The live map for the booth TV.</Row>
      </ol>

      <div class="box demobox left">
        <strong><DemoTag /> Shortcuts</strong>
        <div class="pills">
          <button class="chip" onClick={find(level.value?.hero.id)}>Trail to the X</button>
          <button class="chip" onClick={go('rules')}>How to play</button>
          <button class="chip" disabled={busy} onClick={() => { if (confirm('Reset the demo? Your demo player, stamps and leads in this browser are erased and the floor is rebuilt.')) { setBusy(true); try { localStorage.removeItem('mx_complete'); } catch { /* ignore */ } void demoApi.reset().catch(warn); } }}>Reset the demo</button>
        </div>
        <p class="fine">A demo cannot show two real phones meeting, the camera scanner or GPS — those need the real backend and a real device. Add the database settings in Vercel and this demo switches itself off.</p>
      </div>
    </Sheet>
  );
}
