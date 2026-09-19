import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { buildServices } from './wire.js';
import { testStores } from './test-db.js';
import type { GcView, Hologram, HostCode, LevelData, Me, MissionsView } from '../shared/types.js';
import { ALL_FEATURES, VENUE_DEFAULT } from '../shared/rules.js';

const root = resolve(import.meta.dirname, '..');
const level = JSON.parse(readFileSync(resolve(root, 'public/data/floor.json'), 'utf8')) as LevelData;
const booth = (id: string) => level.booths.find((b) => b.id === id)!;
const AT_MITEC = { lat: VENUE_DEFAULT.lat + 0.0005, lon: VENUE_DEFAULT.lon, acc: 25 }, AT_KLCC = { lat: 3.1579, lon: 101.7116, acc: 20 };

async function rig() {
  let now = Date.UTC(2026, 8, 23, 2, 5, 0);
  const clock = { advance: (ms: number) => { now += ms; }, get now() { return now; } };
  const services = buildServices({ ...(await testStores()), features: ALL_FEATURES, secret: 'test-secret', level, publicOrigin: 'http://x.test', now: () => now });
  const app = createApp({ ...services, crewPin: '4321', publicOrigin: 'http://x.test', secureCookies: false });
  const user = () => {
    const jar = new Map<string, string>();
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(path, { method, headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
      for (const sc of res.headers.getSetCookie()) { const kv = sc.split(';')[0]!, i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
    };
    const u = {
      get: (p: string) => call('GET', p),
      post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
      me: async () => (await call('GET', '/api/me')).json.me as Me,
      async join(cls: string, name?: string) {
        await call('POST', '/api/start', { role: cls });
        if (name) assert.equal((await call('POST', '/api/passport', { name, company: `${name} Co`, role: 'Owner', phone: '+60120000001', email: 'a@example.com', showContact: false, consentMarketing: false, consentNotice: true })).status, 200);
        return u;
      },
      /** Free-roam walk-up (remote presence). */
      async walkTo(id: string) { clock.advance(60_000); const b = booth(id); assert.equal((await call('POST', '/api/presence', { x: b.x - 2.5, y: b.y, h: 0 })).status, 200); },
    };
    return u;
  };
  const beacon = async (id: string) => {
    const crew = user(); await crew.post('/api/crew/login', { pin: '4321' });
    const all = (await crew.get('/api/crew/beacons')).json.data as { id: string; url: string }[];
    return new URL(all.find((b) => b.id === id)!.url).searchParams.get('b')!;
  };
  return { clock, user, beacon, services };
}

test('presence engine: the venue gate decides what a printed beacon is worth; scans anchor; deck walking; invisibility', async () => {
  const { clock, user, beacon, services } = await rig();
  const p = await user().join('visitor'), watcher = await user().join('exhibitor');

  // without a venue check a printed code is only worth a remote stamp — it may have been photographed
  let r = await p.post('/api/stamp', { stationId: '7C17', proof: 'beacon', beacon: await beacon('7C17') });
  assert.equal(r.json.events[0].xp, 10, 'a stamp, not a real-booth scan');
  assert.match(r.json.events[0].note, /location/i);
  assert.equal(r.json.me.onsite, false);
  assert.equal(r.json.me.anchor, null);

  // fixes that prove nothing
  assert.deepEqual((await p.post('/api/venue', AT_KLCC)).json.data.reason, 'outside');
  assert.deepEqual((await p.post('/api/venue', { ...AT_MITEC, acc: 900 })).json.data.reason, 'inaccurate');
  assert.equal((await p.post('/api/venue', { lat: 'x', lon: 1, acc: 1 })).json.code, 'bad_fix');
  assert.equal((await p.me()).onsite, false);

  // a good fix opens the gate: the same kind of scan is now an on-site stamp, and it anchors the player there
  r = await p.post('/api/venue', AT_MITEC);
  assert.equal(r.json.data.onsite, true);
  assert.ok(r.json.data.distanceM < 100);
  assert.equal(r.json.me.onsite, true);
  clock.advance(60_000);
  r = await p.post('/api/stamp', { stationId: '7C18', proof: 'beacon', beacon: await beacon('7C18') });
  assert.deepEqual([r.json.events[0].action, r.json.events[0].xp], ['scan', 50], 'known to be at MIHAS: a printed booth QR is a real-booth scan');
  assert.equal(r.json.me.anchor.stationId, '7C18');
  assert.deepEqual(Object.keys((await services.game.db.get<object>('SELECT * FROM venue_checks'))!).sort(), ['acc_m', 'checked_at', 'dist_m', 'ok', 'player_id'], 'no coordinates are stored');

  // other players see a real person: solid (deck), at the station, snapped to the 1.5 m lattice
  const b = booth('7C18');
  let seen = (await watcher.post('/api/presence', { x: b.x + 3, y: b.y, h: 0, spawn: false })).json.data.holograms as Hologram[];
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.deck, true);
  assert.ok(Math.abs(seen[0]!.x - b.x) <= 0.75 && seen[0]!.x % 1.5 === 0);

  // deck walking: real metres earn XP — at walking pace (4.5 m every 2 s) …
  const pid = (await services.game.db.get<{ id: string }>("SELECT id FROM players WHERE cls = 'visitor'"))!.id;
  let walked = 0;
  for (let i = 1; i <= 14; i++) {
    clock.advance(2000);
    r = await p.post('/api/presence', { x: b.x - 2.2, y: b.y - i * 4.5, h: 0, deck: true, sigma: 1 + i });
    assert.equal(r.json.data.deck, true);
    walked += (r.json.events ?? []).filter((e: { action: string }) => e.action === 'walk').reduce((n: number, e: { xp: number }) => n + e.xp, 0);
  }
  assert.equal(walked, 5, '63 m on deck → 6 XP earned, paid in batches of 5');
  // … and a 20 m dash in 2 s is refused: the server keeps the last believable position
  clock.advance(2000);
  await p.post('/api/presence', { x: b.x - 2.2, y: b.y - 83, h: 0, deck: true, sigma: 3 });
  assert.ok(Math.abs((await services.game.presence.position(pid, clock.now))!.y - (b.y - 63)) < 0.01, 'the sprint was refused');

  // a remote player asking for deck mode is quietly given free roam
  assert.equal((await watcher.post('/api/presence', { x: b.x + 3, y: b.y, h: 0, deck: true })).json.data.deck, false);

  // invisible means invisible
  assert.equal((await p.post('/api/hidden', { hidden: true })).json.me.hidden, true);
  seen = (await watcher.post('/api/presence', { x: b.x - 2, y: b.y - 80, h: 0 })).json.data.holograms;
  assert.equal(seen.length, 0);

  // the gate closes again after half an hour without a fresh check or scan
  clock.advance(31 * 60_000);
  assert.equal((await p.me()).onsite, false);
});

test('mission director: three different offers, one active at a time, progress from play, storms double a quiet zone', async () => {
  const { clock, user, services } = await rig();
  const p = await user().join('visitor');
  await p.post('/api/presence', { x: level.spawns.short.x, y: level.spawns.short.y, h: 0, spawn: true });

  let v = (await p.get('/api/missions')).json.data as MissionsView;
  assert.equal(v.active, null);
  assert.equal(v.offers.length, 3);
  assert.equal(new Set(v.offers.map((o) => o.template)).size, 3, 'three different errands, not three of the same');
  assert.ok(!v.offers.some((o) => o.template === 'first_contact'), 'host-code missions are not offered to someone who is not on site');
  assert.deepEqual(((await p.get('/api/missions')).json.data as MissionsView).offers.map((o) => o.id), v.offers.map((o) => o.id), 'offers are stable until they expire');

  assert.equal((await p.post('/api/missions/accept', { id: v.offers[0]!.id })).status, 200);
  assert.equal((await p.post('/api/missions/accept', { id: v.offers[1]!.id })).json.code, 'busy');
  v = (await p.post('/api/missions/abandon')).json.data;
  assert.equal(v.active, null);
  assert.equal(v.offers.length, 3);

  // deterministic progress checks: place missions directly, then play
  const pid = (await services.game.db.get<{ id: string }>("SELECT id FROM players WHERE cls = 'visitor'"))!.id;
  const place = async (template: string, params: object, progress: object, xp: number) => {
    await p.post('/api/missions/abandon');
    const id = crypto.randomUUID(), t = Date.UTC(2026, 8, 23, 2, 5, 0);
    await services.game.db.run("UPDATE missions SET state = 'expired' WHERE player_id = ?", [pid]);
    await services.game.db.run('INSERT INTO missions (id, player_id, template, params, progress, state, xp, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, pid, template, JSON.stringify(params), JSON.stringify(progress), 'offered', xp, t, t + 86_400_000]);
    assert.equal((await p.post('/api/missions/accept', { id })).status, 200);
  };

  await place('survey', { hall: 8 }, { n: 0, need: 3, onsite: true }, 120);
  let paid: { action: string; xp: number }[] = [];
  for (const id of ['8H19', '8H20', '8H15']) { await p.walkTo(id); const r = await p.post('/api/stamp', { stationId: id, proof: 'virtual' }); assert.equal(r.status, 200, JSON.stringify(r.json)); paid = r.json.events; }
  assert.deepEqual(paid.map((e) => e.action), ['stamp', 'mission']);
  assert.equal(paid[1]!.xp, 18, '120 x 0.15 — walked remotely');
  assert.equal(((await p.get('/api/missions')).json.data as MissionsView).active, null);

  await place('supply', { a: '8H17B', b: '7C17' }, { stage: 0, onsite: true }, 150);
  let r = await p.walkTo('7C17'); // wrong end first: nothing happens
  assert.equal(((await p.get('/api/missions')).json.data as MissionsView).active!.progress, 'Go to pickup');
  clock.advance(60_000);
  r = (await p.post('/api/presence', { x: booth('8H17B').x + 2.5, y: booth('8H17B').y, h: 0 })) as never;
  assert.equal((r as unknown as { json: { events: { action: string }[] } }).json.events.at(-1)!.action, 'mission_step');
  clock.advance(60_000);
  const done = await p.post('/api/presence', { x: booth('7C17').x - 2.5, y: booth('7C17').y, h: 0 });
  assert.deepEqual(done.json.events.at(-1), { action: 'mission', xp: 23, target: 'Supply Run', note: 'Walk it on site for the full reward' });

  await place('dark_sector', {}, { seen: [], need: 2, onsite: true }, 90);
  for (const id of ['6F26', '6F11']) { clock.advance(60_000); await p.post('/api/presence', { x: booth(id).x - 2.5, y: booth(id).y, h: 0 }); }
  assert.equal(((await p.get('/api/missions')).json.data as MissionsView).active, null);
  assert.equal((await services.game.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM dark_visits'))!.n, 2, 'exhibitors can be told someone came looking');

  // Signal Storm: exactly one quiet zone, and a stamp inside it pays double
  v = (await p.get('/api/missions')).json.data;
  assert.ok(v.storm && v.storm.mult === 2 && v.storm.endsInMs > 0);
  const s = v.storm!, inside = level.booths.find((b) => b.x >= s.x0 && b.x < s.x1 && b.y >= s.y0 && b.y < s.y1 && !['8H19', '8H20', '8H15', level.hero.id].includes(b.id))!;
  await p.walkTo(inside.id);
  const st = await p.post('/api/stamp', { stationId: inside.id, proof: 'virtual' });
  // the zone may have closed while we walked; if it is still open the stamp must be doubled
  const still = ((await p.get('/api/missions')).json.data as MissionsView).storm;
  if (still && still.zone === s.zone) { assert.match(st.json.events[0].note, /Storm/); assert.equal(st.json.events[0].xp, 10 * 2, 'the normal stamp value, doubled'); }
});

test('ground control: roles follow reality, only Ground sees the target, only the astronaut can finish it, both are paid in full', async () => {
  const { clock, user } = await rig();
  const host = await user().join('exhibitor', 'Hana Host'), ground = await user().join('visitor'), astro = await user().join('visitor');
  await host.post('/api/station/claim', { stationId: '7C17', company: 'Mamee', offer: '', link: '', color: 0 });
  clock.advance(6000);

  let g = (await ground.post('/api/gc/join')).json.data as GcView;
  assert.deepEqual([g.state, g.role], ['queued', 'ground']);
  assert.deepEqual([((await ground.post('/api/gc/join')).json.data as GcView).state], ['queued'], 'joining twice does not pair you with yourself');

  await astro.post('/api/venue', AT_MITEC);
  let a = (await astro.post('/api/gc/join')).json.data as GcView;
  assert.deepEqual([a.state, a.role, a.target], ['active', 'astro', null], 'the astronaut is not told where to go');
  g = (await ground.get('/api/gc')).json.data;
  assert.deepEqual([g.state, g.role, g.target?.stationId], ['active', 'ground', '7C17']);

  assert.equal((await astro.post('/api/gc/waypoint', { x: 100, y: 50 })).status, 403);
  assert.equal((await ground.post('/api/gc/waypoint', { x: 9999, y: 50 })).json.code, 'bad_pos');
  for (let i = 0; i < 7; i++) await ground.post('/api/gc/waypoint', { x: 90 + i, y: 50 });
  a = (await astro.get('/api/gc')).json.data;
  assert.equal(a.waypoints.length, 5, 'only the last few markers are kept');
  assert.equal(a.waypoints.at(-1)!.x, 96);

  // a free-roam walk-up to the target does not finish the run — the astronaut has to really be there
  clock.advance(60_000);
  await astro.post('/api/presence', { x: booth('7C17').x - 2.5, y: booth('7C17').y, h: 0 });
  assert.equal((await astro.post('/api/stamp', { stationId: '7C17', proof: 'virtual' })).status, 200);
  assert.equal(((await astro.get('/api/gc')).json.data as GcView).state, 'active');
  clock.advance(60_000);

  const groundBefore = (await ground.me()).xp;
  const code = (await host.get('/api/host/code?station=7C17')).json.data as HostCode;
  const r = await astro.post('/api/stamp', { stationId: '7C17', proof: 'host', code: code.digits });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.events.map((e: { action: string }) => e.action), ['verified_contact', 'ground_control']);
  assert.equal(r.json.events[1].xp, 150);
  assert.equal((await ground.me()).xp, groundBefore + 150, 'the remote partner earns the full reward');
  assert.equal(((await ground.get('/api/gc')).json.data as GcView).state, 'done');
});
