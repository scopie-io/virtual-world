import { useEffect, useState } from 'preact/hooks';
import type { Engine } from '../game/engine';
import { api, ApiError } from '../net/api';
import { Sheet, useCountdown, useDeadline } from './common';
import type { MissionView } from '../../shared/types';
import { demo } from '../demo/client';
import { GcDemoHint, PresenceDemoHint } from '../demo/Tour';
import { VENUE_DEFAULT } from '../../shared/rules';
import { deck, gcMarkerMode, gcView, guideOn, guideTarget, me, missions, modal, toast } from '../state';

type Eng = { engine: () => Engine | null };
const fail = (e: unknown, fallback: string) => toast(e instanceof ApiError ? e.message : fallback, undefined, 'warn', 4500);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const guideTo = (t: MissionView['target']) => { if (t) { guideTarget.value = { x: t.x, y: t.y, label: t.label }; guideOn.value = true; } };

/** One browser location fix → a yes/no from the server. The coordinates are not stored. */
export async function checkInAtVenue(): Promise<boolean> {
  if (demo.value) { // no GPS in the demo: this browser is simply "at MITEC"
    const r = await api.venue({ lat: VENUE_DEFAULT.lat, lon: VENUE_DEFAULT.lon, acc: 12 });
    toast('Welcome to MIHAS', 'Demo: location simulated — you now count as on site for 30 minutes', 'xp', 5000);
    return r.onsite;
  }
  if (!('geolocation' in navigator)) { toast('This browser has no location service', 'Scan a host code at any booth instead', 'warn', 5000); return false; }
  toast('Checking you in…', 'Allow location when your phone asks');
  try {
    const pos = await new Promise<GeolocationPosition>((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }));
    const r = await api.venue({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy });
    if (r.onsite) toast('Welcome to MIHAS', 'You are on site: printed beacons and walking now pay in full', 'xp', 5000);
    else toast(r.reason === 'inaccurate' ? 'Location too fuzzy indoors' : `You seem to be ${(r.distanceM / 1000).toFixed(1)} km from MITEC`, r.reason === 'inaccurate' ? 'Try near an entrance — or scan a host code, which needs no GPS' : 'Remote play still works — and Ground Control needs you', 'info', 6000);
    return r.onsite;
  } catch { toast('Location was not shared', 'No problem — a host code scan proves you are here too', 'info', 5000); return false; }
}

/* ------------------------------------------------------------------ missions */

function MissionCard({ m, action }: { m: MissionView; action: preact.ComponentChildren }) {
  const left = useCountdown(useDeadline(m.expiresInMs, m));
  return (
    <div class="box mcard">
      <div class="rowb"><strong>{m.title}</strong><span class="pill gold">+{m.xp} XP</span></div>
      <p class="fine">{m.brief}</p>
      <div class="rowb"><span class="fine">{m.state === 'active' ? `${m.progress} · ${mmss(left)} left` : `Offer ends in ${mmss(left)}`}</span>{action}</div>
    </div>
  );
}

export function MissionsSheet() {
  const v = missions.value, [busy, setBusy] = useState(false), m = me.value!;
  const load = () => api.missions().then((x) => (missions.value = x), () => {});
  useEffect(() => { void load(); }, []);
  const stormLeft = useCountdown(useDeadline(v?.storm?.endsInMs, v?.storm));
  const accept = async (o: MissionView) => { setBusy(true); try { missions.value = await api.acceptMission(o.id); guideTo(missions.value.active?.target ?? null); api.track('mission_accept', { t: o.template }); modal.value = null; } catch (e) { fail(e, 'Could not accept'); void load(); } setBusy(false); };
  const abandon = async () => { setBusy(true); try { missions.value = await api.abandonMission(); guideTarget.value = null; } catch (e) { fail(e, 'Could not abandon'); } setBusy(false); };
  const visitors = Object.entries(v?.darkVisitors ?? {}).filter(([, n]) => n > 0);

  return (
    <Sheet k="Mission Director" title="What now?" wide>
      {!v ? <p class="lead">Reading the floor…</p> : (
        <>
          {v.storm && (
            <div class="box storm">
              <div class="rowb"><strong>⚡ Signal Storm · {v.storm.label}</strong><span class="pill gold">Stamps ×{v.storm.mult}</span></div>
              <p class="fine">The quietest corner of the floor pays double for the next {mmss(stormLeft)}. <button class="link" onClick={() => { const s = v.storm!; guideTarget.value = { x: (s.x0 + s.x1) / 2, y: (s.y0 + s.y1) / 2, label: `Signal Storm · ${s.label}` }; guideOn.value = true; modal.value = null; }}>Guide me there</button></p>
            </div>
          )}
          {v.drop && (
            <div class="box drop">
              <div class="rowb"><strong>★ {v.drop.title}</strong><span class="pill gold">{v.drop.done ? 'Collected' : `+${v.drop.bonus} XP`}</span></div>
              <p class="fine">Today only: be at <b>{v.drop.label}</b> (booth {v.drop.stationId}) for real and scan their code. {!v.drop.done && <button class="link" onClick={() => { const d = v.drop!; guideTarget.value = { x: d.x, y: d.y, label: d.label }; guideOn.value = true; modal.value = null; }}>Guide me there</button>}</p>
            </div>
          )}
          {visitors.map(([id, n]) => <p key={id} class="fine">📡 {n} explorer{n === 1 ? '' : 's'} came looking for booth {id} before it was online.</p>)}
          {v.active ? (
            <>
              <MissionCard m={v.active} action={<span><button class="link" disabled={busy} onClick={abandon}>Abandon</button>{v.active.target && <> · <button class="link" onClick={() => { guideTo(v.active!.target); modal.value = null; }}>Guide me</button></>}</span>} />
              <p class="fine">{m.onsite ? 'You are on site — missions pay in full.' : 'Walked remotely, missions pay 15 %. On site (venue check-in or a host-code scan) they pay in full.'}</p>
            </>
          ) : (
            <>
              <p class="lead">Pick one. The Director chose these from where you are, what you have not seen, and where the floor is quiet.</p>
              <div class="mgrid">{v.offers.map((o) => <MissionCard key={o.id} m={o} action={<button class="btn primary" disabled={busy} onClick={() => accept(o)}>Accept</button>} />)}</div>
            </>
          )}
          <div class="box gcbox">
            <div class="rowb"><strong>Ground Control · co-op</strong><span class="pill gold">+150 XP each</span></div>
            <p class="fine">One player at home sees a target from orbit. One player at MIHAS has to be talked in with floor markers — no chat. The only mission that pays remote players in full.</p>
            <button class="btn big" onClick={() => (modal.value = 'gc')}>{m.onsite ? 'Fly as the Astronaut' : 'Sit at Ground Control'}</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ ground control */

export function GcSheet() {
  const v = gcView.value, left = useCountdown(useDeadline(v?.expiresInMs, v)), [busy, setBusy] = useState(false);
  useEffect(() => { api.gc().then((x) => (gcView.value = x), () => {}); }, []);
  const join = async () => { setBusy(true); try { gcView.value = await api.gcJoin(); api.track('gc_join'); } catch (e) { fail(e, 'Could not join'); } setBusy(false); };
  const leave = async () => { try { gcView.value = await api.gcLeave(); } catch { /* ignore */ } gcMarkerMode.value = false; };
  const lastMarker = v?.waypoints.at(-1);

  return (
    <Sheet k="Ground Control" title={!v || v.state === 'idle' ? 'Two players, one target' : v.state === 'queued' ? 'Looking for a partner…' : v.state === 'done' ? 'Target reached!' : v.state === 'expired' ? 'Run over' : v.role === 'ground' ? `Guide ${v.partner} in` : `${v.partner} is your eyes`} gold>
      {!v || v.state === 'idle' || v.state === 'expired' || v.state === 'done' ? (
        <>
          {v?.state === 'done' && <p class="lead">+150 XP each. {v.target ? `The target was ${v.target.label}.` : ''} Go again?</p>}
          {v?.state === 'expired' && <p class="lead">Time ran out on that run. Try again with a fresh partner.</p>}
          <p class="lead">{me.value?.onsite ? 'You are at MIHAS, so you fly as the Astronaut: a remote player will drop markers on your map. Reach the station they are steering you to and scan its code.' : 'You are remote, so you sit at Ground Control: you will see a target nobody on the floor can see. Tap the floor to drop markers and steer your astronaut to it.'}</p>
          <button class="btn primary big" disabled={busy} onClick={join}>{busy ? 'Joining…' : 'Find a partner'}</button>
          <GcDemoHint />
        </>
      ) : v.state === 'queued' ? (
        <>
          <p class="lead">Waiting for {v.role === 'ground' ? 'an astronaut on the MIHAS floor' : 'a remote controller'}. You can close this and keep playing — we will pair you when someone turns up ({mmss(left)}).</p>
          <button class="btn big" onClick={leave}>Stop waiting</button>
        </>
      ) : (
        <>
          <p class="lead">{v.role === 'ground'
            ? <>Target: <b>{v.target?.label}</b> (booth {v.target?.stationId}) — the pink beam. {v.partnerPos ? 'The green ring is your astronaut.' : 'Your astronaut has not shown up on the map yet.'} Turn on marker mode and tap the floor to lead them.</>
            : <>Follow the pink markers. When you reach the station they point at, scan its host code or beacon. {v.waypoints.length === 0 && 'No markers yet — give them a moment.'}</>}</p>
          <p class="fine">{mmss(left)} left · {v.waypoints.length} marker{v.waypoints.length === 1 ? '' : 's'} on the floor</p>
          <div class="stack">
            {v.role === 'ground' && <button class={'btn big' + (gcMarkerMode.value ? ' primary' : '')} onClick={() => { gcMarkerMode.value = !gcMarkerMode.value; if (gcMarkerMode.value) { guideTo(v.target); modal.value = null; toast('Marker mode on', 'Tap the floor to drop a marker'); } }}>{gcMarkerMode.value ? 'Marker mode is ON' : 'Turn on marker mode'}</button>}
            {v.role === 'astro' && lastMarker && <button class="btn primary big" onClick={() => { guideTarget.value = { x: lastMarker.x, y: lastMarker.y, label: 'Latest marker' }; guideOn.value = true; modal.value = null; }}>Trail to the latest marker</button>}
            <button class="btn big" onClick={leave}>Leave this run</button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ deck banner + presence settings */

export function DeckBanner({ engine }: Eng) {
  const d = deck.value; if (!d.on) return null;
  return (
    <div class="deckbar" role="status">
      <span class="live-dot" /><span><b>On deck</b> · {d.label} · ±{Math.round(d.sigma)} m{d.tracking ? ' · following your steps' : ''}</span>
      <button class="link" onClick={() => engine()?.leaveDeck()}>Free roam</button>
    </div>
  );
}

export function PresenceSheet({ engine }: Eng) {
  const m = me.value!, d = deck.value, [busy, setBusy] = useState(false);
  const hide = async () => { setBusy(true); try { await api.hidden(!m.hidden); } catch (e) { fail(e, 'Could not change'); } setBusy(false); };
  return (
    <Sheet k="Presence" title={m.onsite ? 'You are on site' : 'Where are you playing from?'}>
      <p class="lead">At MIHAS your astronaut can stand where you really stand. A scan places you; your steps can move you. Everyone else sees you snapped to the aisle, never your exact spot.</p>
      <div class="stack">
        <button class="btn big" onClick={() => void checkInAtVenue()}>{m.onsite ? 'Refresh my venue check-in' : 'I am at MIHAS — check me in'}</button>
        <button class={'btn big' + (d.tracking ? ' primary' : '')} onClick={() => void engine()?.setStepTracking(!d.tracking)}>{d.tracking ? 'Step tracking is ON (beta)' : 'Follow my steps (beta)'}</button>
        {d.tracking && <button class="btn big" onClick={() => toast(engine()?.calibrateAxis() ? 'Compass aligned to the hall' : 'No compass reading yet — move the phone in a figure 8', undefined, 'info', 4000)}>Calibrate: I am facing INTO the Lean X booth</button>}
        <button class={'btn big' + (m.hidden ? ' primary' : '')} disabled={busy} onClick={hide}>{m.hidden ? 'Invisible: nobody can see you' : 'Go invisible'}</button>
      </div>
      <PresenceDemoHint />
      <p class="fine">We use one location fix to answer “is this phone at MITEC?” and keep only the yes/no. Step tracking runs on your phone, only while this page is open. Invisible players still earn XP.</p>
    </Sheet>
  );
}
