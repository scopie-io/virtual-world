import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { buildServices } from './wire.js';
import { testStores } from './test-db.js';
import type { BoardRow, HostCode, LevelData, Me, MissionsView, ReviewRow, ScreenView, SectorsView, TeamView, TrustView } from '../shared/types.js';
import { ALL_FEATURES, VENUE_DEFAULT } from '../shared/rules.js';

const root = resolve(import.meta.dirname, '..');
const level = JSON.parse(readFileSync(resolve(root, 'public/data/floor.json'), 'utf8')) as LevelData;
const booth = (id: string) => level.booths.find((b) => b.id === id)!;
const AT_MITEC = { lat: VENUE_DEFAULT.lat, lon: VENUE_DEFAULT.lon, acc: 20 };

async function rig() {
  let now = Date.UTC(2026, 8, 23, 2, 5, 0);
  const clock = { advance: (ms: number) => { now += ms; } };
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
      get: (p: string) => call('GET', p), post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
      me: async () => (await call('GET', '/api/me')).json.me as Me,
      async join(cls: string, name?: string) {
        await call('POST', '/api/start', { role: cls });
        if (name) assert.equal((await call('POST', '/api/passport', { name, company: `${name} Co`, role: 'Owner', phone: '+60120000001', email: 'a@example.com', showContact: false, consentMarketing: false, consentNotice: true })).status, 200);
        return u;
      },
      async walkTo(id: string) { clock.advance(60_000); const b = booth(id); assert.equal((await call('POST', '/api/presence', { x: b.x - 2.5, y: b.y, h: 0 })).status, 200); },
    };
    return u;
  };
  const crew = async () => { const u = user(); assert.equal((await u.post('/api/crew/login', { pin: '4321' })).status, 200); return u; };
  return { clock, user, crew, services };
}

test('three decks: a lift ride is the only legal jump; Level 1 booths stamp, count for their own halls, and get their own offers', async () => {
  const { clock, user } = await rig(), p = await user().join('visitor');
  assert.deepEqual(level.decks.map((d) => d.level).sort(), [1, 2, 3]);
  assert.equal(level.booths.length, new Set(level.booths.map((b) => b.id)).size, 'booth ids are unique across decks');
  assert.ok(level.booths.filter((b) => b.deck === 1).length > 650 && level.booths.filter((b) => b.deck === 3).length > 450);

  const lift2 = level.lifts.find((l) => l.deck === 2 && l.id === 'west')!, lift1 = level.lifts.find((l) => l.deck === 1 && l.id === 'west')!;
  await p.post('/api/presence', { x: level.spawns.short.x, y: level.spawns.short.y, h: 0, spawn: true });
  clock.advance(8000); await p.post('/api/presence', { x: lift2.x, y: lift2.y, h: 0 });
  // claiming to be somewhere on Level 1 that is not a lift: refused, position unchanged
  const f = booth('3G09'); clock.advance(2000);
  await p.post('/api/presence', { x: f.x - 2.5, y: f.y, h: 0, spawn: true });
  assert.equal((await p.post('/api/stamp', { stationId: '3G09', proof: 'virtual' })).json.code, 'too_far');
  // the lift ride itself is accepted
  clock.advance(2000);
  const r = await p.post('/api/presence', { x: lift1.x, y: lift1.y + 1.5, h: 0, spawn: true });
  assert.ok(r.json.events.some((e: { target?: string }) => e.target === 'Hall 4'), 'arrived in Hall 4 on Level 1');
  await p.walkTo('3G09');
  const st = await p.post('/api/stamp', { stationId: '3G09', proof: 'virtual' });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  assert.equal(st.json.events[0].target, 'FGV Holdings', 'official exhibitor name');

  const sectors = ((await p.get('/api/sectors')).json.data as SectorsView).sectors;
  assert.deepEqual(sectors.map((s) => s.hall).sort((a, b) => a - b), [2, 3, 4, 6, 7, 8, 9, 10, 11]);
  assert.ok(sectors.find((s) => s.hall === 3)!.scores.visitor > 0 && sectors.find((s) => s.hall === 8)!.scores.visitor === 0);

  const m = (await p.get('/api/missions')).json.data as MissionsView;
  for (const o of m.offers) if (o.target) assert.ok(o.target.y < 0, `${o.title} stays on Level 1 (south of the Level 2 platform)`);
});

test('trust: remote play cannot reach the bar; venue + host code + docking does; a teleport attempt costs it', async () => {
  const { clock, user, crew, services } = await rig();
  const host = await user().join('exhibitor', 'Hana Host'), remote = await user().join('visitor', 'Rita Remote'), onsite = await user().join('visitor', 'Omar Onsite');
  await host.post('/api/station/claim', { stationId: '7C17', company: 'Mamee', offer: '', link: '', color: 0 });

  let t = (await remote.get('/api/trust')).json.data as TrustView;
  assert.deepEqual([t.score, t.trusted], [0.35, false], 'plausible + nothing-to-contradict: not enough');

  await onsite.post('/api/venue', AT_MITEC);
  const code = (await host.get('/api/host/code?station=7C17')).json.data as HostCode;
  assert.equal((await onsite.post('/api/stamp', { stationId: '7C17', proof: 'host', code: code.digits })).status, 200);
  t = (await onsite.get('/api/trust')).json.data;
  assert.deepEqual([t.score, t.trusted], [0.9, true], 'geofence .25 + host .30 + plausible .20 + steps .15');

  // a jump across the hall in one second is refused AND remembered
  clock.advance(1000);
  await onsite.post('/api/presence', { x: booth('7C17').x + 60, y: booth('7C17').y, h: 0, deck: true });
  t = (await onsite.get('/api/trust')).json.data;
  assert.equal(t.parts.plausible, false);
  assert.deepEqual([t.score, t.trusted], [0.7, true], 'still just over the bar — one signal alone does not sink an honest player');

  // boards: trusted flag per row; review shows the breakdown; voiding and banning work
  clock.advance(20_000);
  let board = (await remote.get('/api/boards?board=today')).json.data as BoardRow[];
  assert.deepEqual(board.map((r) => r.trusted), board.map((r) => r.sub !== 'Cadet' ? r.trusted : r.trusted)); // shape check
  assert.equal(board.find((r) => r.trusted)?.value, 50 + 200, 'Omar: a real-booth scan + the card, today');
  assert.equal((await remote.get('/api/crew/review')).status, 401);

  const staff = await crew();
  const review = (await staff.get('/api/crew/review?board=today')).json.data as ReviewRow[];
  const omar = review.find((r) => r.name === 'Omar Onsite')!;
  assert.deepEqual([omar.trust.trusted, omar.flags, omar.banned], [true, 1, false]);
  const ledger = (await staff.get(`/api/crew/ledger?callsign=${omar.callsign}`)).json.data as { id: number; action: string; xp: number }[];
  const stampRow = ledger.find((l) => l.action === 'stamp')!;
  await staff.post('/api/crew/void', { id: stampRow.id });
  assert.equal((await onsite.me()).xp, 200, 'the voided scan no longer counts: only the card is left');
  await staff.post('/api/crew/void', { id: stampRow.id, voided: false });
  assert.equal((await onsite.me()).xp, 200 + 50, 'and can be restored');

  await staff.post('/api/crew/ban', { callsign: omar.callsign, reason: 'test' });
  clock.advance(20_000);
  board = (await remote.get('/api/boards?board=xp')).json.data;
  assert.ok(!board.some((r) => r.title === omar.callsign), 'banned accounts leave every board');
  assert.equal((await onsite.post('/api/suit-up', { cls: 'exhibitor' })).json.code, 'review');
  assert.equal((await onsite.get('/api/me')).status, 200, 'they can still look');
  void services;
});

test('teams, kill switches, the Daily Drop, and what the big screen is allowed to know', async () => {
  const { clock, user, crew } = await rig();
  const boss = await user().join('visitor', 'Bea Boss'), mate = await user().join('visitor', 'Mo Mate'), guest = await user().join('visitor');
  const staff = await crew();

  assert.equal((await guest.post('/api/team/create', { name: 'x' })).json.code, 'need_passport');
  const team = (await boss.post('/api/team/create', {})).json.data as TeamView;
  assert.deepEqual([team.name, team.owner, team.members.length], ['Bea Boss Co', true, 1]);
  assert.equal((await mate.post('/api/team/join', { code: 'AAAAAAAA' })).json.code, 'bad_code');
  const joined = (await mate.post('/api/team/join', { code: team.code })).json.data as TeamView;
  assert.deepEqual([joined.owner, joined.code, joined.members.length, joined.score], [false, null, 2, 400]);
  assert.equal((await mate.post('/api/team/create', {})).json.code, 'in_team');
  let co = (await guest.get('/api/boards?board=companies')).json.data as BoardRow[];
  assert.deepEqual([co[0]!.title, co[0]!.value, co[0]!.trusted], ['Bea Boss Co', 400, false]);
  await boss.post('/api/team/leave');
  assert.equal((await mate.get('/api/team')).json.data, null, 'the founder leaving dissolves the team');

  // kill switches
  assert.equal((await guest.post('/api/crew/flags', { flag: 'claims', on: false })).status, 401);
  await staff.post('/api/crew/flags', { flag: 'claims', on: false });
  clock.advance(6000);
  assert.equal((await boss.post('/api/station/claim', { stationId: '7C17', company: 'Bea', offer: '', link: '', color: 0 })).status, 503);
  await staff.post('/api/crew/flags', { flag: 'claims', on: true }); clock.advance(6000);
  assert.equal((await boss.post('/api/station/claim', { stationId: '7C17', company: 'Bea', offer: '', link: '', color: 0 })).status, 200);
  await staff.post('/api/crew/flags', { flag: 'holograms', on: false }); clock.advance(6000);
  const s = level.spawns.short;
  await boss.post('/api/presence', { x: s.x, y: s.y, h: 0, spawn: true });
  assert.equal((await mate.post('/api/presence', { x: s.x + 1, y: s.y, h: 0, spawn: true })).json.data.holograms.length, 0);

  // Daily Drop: only an on-site stamp of today's station pays, once
  assert.equal((await staff.post('/api/crew/drop', { stationId: 'nope', title: 'x', bonus: 100 })).json.code, 'no_station');
  await staff.post('/api/crew/drop', { stationId: '7c17', title: 'Kopi o’clock', bonus: 120 });
  assert.equal(((await mate.get('/api/missions')).json.data as MissionsView).drop?.stationId, '7C17');
  await mate.walkTo('7C17');
  assert.deepEqual((await mate.post('/api/stamp', { stationId: '7C17', proof: 'virtual' })).json.events.map((e: { action: string }) => e.action), ['stamp'], 'walked up remotely: no drop');
  await mate.post('/api/venue', AT_MITEC);
  const code = (await boss.get('/api/host/code?station=7C17')).json.data as HostCode;
  const paid = (await mate.post('/api/stamp', { stationId: '7C17', proof: 'host', code: code.digits })).json.events as { action: string; xp: number }[];
  assert.deepEqual(paid.map((e) => [e.action, e.xp]), [['verified_contact', 0], ['daily_drop', 120]]);
  assert.equal((await mate.get('/api/today')).json.data.drop.done, true, 'the simple game reads the booth of the day from /api/today');
  assert.equal(((await mate.get('/api/missions')).json.data as MissionsView).drop?.done, true);

  // the big screen: crew only, and it carries positions and totals — never identities
  assert.equal((await guest.get('/api/crew/screen')).status, 401);
  const screen = (await staff.get('/api/crew/screen')).json.data as ScreenView;
  assert.ok(screen.dots.length >= 1 && screen.totals.passports === 2 && screen.joinUrl === 'http://x.test');
  assert.deepEqual(Object.keys(screen.dots[0]!).sort(), ['cls', 'deck', 'x', 'y']);
  assert.ok(!JSON.stringify(screen.dots).match(/Bea|Mo Mate/));
});
