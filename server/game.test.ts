import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { buildServices } from './wire.js';
import { testStores } from './test-db.js';
import type { LevelData, Me } from '../shared/types.js';
import { MISSION_STAMPS, POINTS, VENUE_DEFAULT, boothSteps, chapters } from '../shared/rules.js';

const root = resolve(import.meta.dirname, '..');
const level = JSON.parse(readFileSync(resolve(root, 'public/data/floor.json'), 'utf8')) as LevelData;

async function rig() {
  let now = Date.UTC(2026, 8, 23, 2, 0, 0); // 10:00 MYT, show day 1
  const clock = { advance: (ms: number) => { now += ms; } };
  const services = buildServices({ ...(await testStores()), secret: 'test-secret', level, publicOrigin: 'http://x.test', now: () => now });
  const app = createApp({ ...services, crewPin: '4321', publicOrigin: 'http://x.test', secureCookies: false });
  const jar = new Map<string, string>();
  const call = async (method: string, path: string, body?: unknown, cookies = jar) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const sc of res.headers.getSetCookie()) {
      const kv = sc.split(';')[0]!;
      const i = kv.indexOf('=');
      cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const isJson = res.headers.get('content-type')?.includes('json');
    return { status: res.status, json: isJson ? await res.json() : null, raw: isJson ? '' : await res.text() };
  };
  return { call, clock, jar };
}

const passportInput = {
  name: 'Aisyah Rahman', company: 'Kedai Kopi Sdn Bhd', role: 'Founder', phone: '+60123456789', email: 'aisyah@example.com',
  showContact: true, consentMarketing: false, consentNotice: true,
};

test('the visitor mission: arrive, find the X, collect, connect, make it real — with fixed points', async () => {
  const { call, clock } = await rig();
  const facts = (m: Me) => ({ started: !!m.cls, card: !!m.passport, stamps: m.stamps.length, swaps: m.links, cardsLeft: m.shared.length, claimed: m.docked });
  const open = (m: Me) => chapters(facts(m)).filter((c) => !c.done).map((c) => c.n);

  let r = await call('GET', '/api/me');
  let me = r.json.me as Me;
  assert.match(me.callsign, /^Guest \d{7}$/);
  assert.deepEqual(open(me), [1, 2, 3, 4, 5]);

  // chapter 1 — arrive: choosing a door costs nothing, pays nothing, and gives a plain name
  assert.equal((await call('POST', '/api/start', { role: 'astronaut' })).json.code, 'bad_role');
  me = (await call('POST', '/api/start', { role: 'visitor' })).json.me as Me;
  assert.equal(me.xp, 0); assert.match(me.callsign, /^Visitor \d{4}$/); assert.deepEqual(open(me), [2, 3, 4, 5]);

  // walking: too far to stamp; a teleport is refused; hall and landmark points are switched off
  const hero = level.hero, target = level.booths.find((b) => b.id === '8H19')!;
  await call('POST', '/api/presence', { x: level.spawns.short.x, y: level.spawns.short.y, h: 0, spawn: true });
  assert.equal((await call('POST', '/api/stamp', { stationId: target.id, proof: 'virtual' })).json.code, 'too_far');
  clock.advance(1000);
  await call('POST', '/api/presence', { x: hero.dock.x, y: hero.dock.y, h: 0 });
  assert.equal((await call('POST', '/api/stamp', { stationId: target.id, proof: 'virtual' })).json.code, 'too_far', 'a 30 m jump in 1 s must not move the server-side position');
  clock.advance(40_000);
  r = await call('POST', '/api/presence', { x: hero.dock.x, y: target.y, h: 0 });
  assert.deepEqual(r.json.events, [], 'no points for entering halls or passing landmarks in the simple game');

  // chapter 2 — find the X: the card. Validation, then +200 and a real name in the game
  assert.equal((await call('POST', '/api/passport', { ...passportInput, consentNotice: false })).json.code, 'consent');
  assert.equal((await call('POST', '/api/passport', { ...passportInput, email: 'nope' })).json.code, 'email');
  r = await call('POST', '/api/passport', passportInput);
  me = r.json.me as Me;
  assert.deepEqual(r.json.events, [{ action: 'passport', xp: POINTS.card }]);
  assert.ok(me.passport && me.ticket, 'card and prize code issued');
  assert.equal(me.callsign, 'Aisyah R.'); assert.deepEqual(open(me), [3, 4, 5]);
  assert.equal((await call('POST', '/api/passport', passportInput)).json.code, 'dup');
  assert.equal((await call('GET', `/p/${me.passport!.slug}`)).status, 200);
  assert.match((await call('GET', `/p/${me.passport!.slug}/vcard`)).raw, /FN:Aisyah Rahman/);

  // chapter 3 — collect: five stamps at +10 each, a few seconds apart
  r = await call('POST', '/api/stamp', { stationId: target.id, proof: 'virtual' });
  assert.deepEqual([r.json.events[0].action, r.json.events[0].xp], ['stamp', POINTS.stamp]);
  assert.equal((await call('POST', '/api/stamp', { stationId: target.id, proof: 'virtual' })).json.code, 'dup');
  const more = level.booths.filter((b) => b.deck === 2 && b.hall === 8 && b.id !== target.id && b.id !== hero.id).slice(0, 4);
  assert.equal((await call('POST', '/api/stamp', { stationId: '8H20', proof: 'virtual' })).json.code, 'cooldown', 'not faster than one every five seconds');
  for (const b of more) {
    clock.advance(60_000);
    await call('POST', '/api/presence', { x: b.x, y: b.y, h: 0 });
    assert.equal((await call('POST', '/api/stamp', { stationId: b.id, proof: 'virtual' })).json.events[0].xp, POINTS.stamp);
  }
  me = (await call('GET', '/api/me')).json.me as Me;
  assert.equal(me.xp, POINTS.card + MISSION_STAMPS * POINTS.stamp); assert.deepEqual(open(me), [4, 5]);

  // a forged booth QR is refused
  clock.advance(60_000);
  assert.equal((await call('POST', '/api/stamp', { stationId: '7C17', proof: 'beacon', beacon: '7C17.forged' })).json.code, 'bad_beacon');

  // chapter 5 can come before chapter 4: the crew scans the prize code at the real booth
  const crewJar = new Map<string, string>();
  assert.equal((await call('GET', `/api/crew/ticket?t=${me.ticket!.code}`, undefined, crewJar)).status, 401);
  assert.equal((await call('POST', '/api/crew/login', { pin: '0000' }, crewJar)).status, 401);
  assert.equal((await call('POST', '/api/crew/login', { pin: '4321' }, crewJar)).status, 200);
  assert.equal((await call('GET', `/api/crew/ticket?t=${me.ticket!.code}`, undefined, crewJar)).json.data.name, 'Aisyah Rahman');
  assert.equal((await call('POST', '/api/crew/dock', { t: me.ticket!.token }, crewJar)).status, 200);
  assert.equal((await call('POST', '/api/crew/dock', { t: me.ticket!.code }, crewJar)).status, 409);
  me = (await call('GET', '/api/me')).json.me as Me;
  assert.equal(me.docked, true); assert.equal(me.ticket, null);
  assert.equal(me.xp, POINTS.card + MISSION_STAMPS * POINTS.stamp + POINTS.booth); assert.deepEqual(open(me), [4]);

  // a printed booth QR scores 10 from anywhere, and 50 once the phone is known to be at MIHAS
  const beacons = (await call('GET', '/api/crew/beacons', undefined, crewJar)).json.data as { id: string; url: string }[];
  const qr = (id: string) => new URL(beacons.find((b) => b.id === id)!.url).searchParams.get('b')!;
  r = await call('POST', '/api/stamp', { stationId: '7C17', proof: 'beacon', beacon: qr('7C17') });
  assert.deepEqual([r.json.events[0].action, r.json.events[0].xp], ['stamp', POINTS.stamp], 'not known to be at MIHAS: it counts as a stamp');
  assert.equal((await call('POST', '/api/venue', { lat: VENUE_DEFAULT.lat, lon: VENUE_DEFAULT.lon, acc: 30 })).json.data.onsite, true);
  clock.advance(10_000);
  r = await call('POST', '/api/stamp', { stationId: '7C19', proof: 'beacon', beacon: qr('7C19') });
  assert.deepEqual([r.json.events[0].action, r.json.events[0].xp], ['scan', POINTS.scan]);

  // chapter 4 — connect: someone scans our code. Both get +50, and the mission is complete
  const otherJar = new Map<string, string>();
  await call('POST', '/api/start', { role: 'visitor' }, otherJar);
  await call('POST', '/api/passport', { ...passportInput, name: 'Ben Tan', email: 'ben@example.com' }, otherJar);
  const code = (await call('POST', '/api/link/code', {})).json.data.code;
  r = await call('POST', '/api/link', { code, fields: ['name', 'company'] }, otherJar);
  assert.deepEqual(r.json.events, [{ action: 'link', xp: POINTS.swap, target: 'Aisyah R.' }]);
  me = (await call('GET', '/api/me')).json.me as Me;
  assert.deepEqual(open(me), [], 'mission complete');
  assert.equal(me.xp, POINTS.card + (MISSION_STAMPS + 1) * POINTS.stamp + POINTS.booth + POINTS.scan + POINTS.swap);

  // the board: one number, and a sub-line anyone can read
  const board = (await call('GET', '/api/boards?board=xp')).json.data as { title: string; sub: string; value: number; you?: boolean }[];
  assert.deepEqual([board[0]!.title, board[0]!.value, board[0]!.you], ['Aisyah R.', me.xp, true]);
  assert.equal(board[0]!.sub, '7 booths · mission complete at 8H18B');
  assert.match((await call('GET', '/api/crew/leads.csv', undefined, crewJar)).raw, /Aisyah Rahman/);

  // the switched-off systems stay off from the outside too
  for (const [m, p, body] of [['POST', '/api/avatar', { spec: {} }], ['POST', '/api/gc/join', {}], ['POST', '/api/team/create', { name: 'x' }], ['POST', '/api/missions/accept', { id: 'x' }]] as const) assert.equal((await call(m, p, body)).json.code, 'off', p);
  const dir = (await call('GET', '/api/missions')).json.data;
  assert.deepEqual([dir.offers, dir.storm, dir.active], [[], null, null]);
});

test('the exhibitor journey: light up, get scanned, lead', async () => {
  const { call, clock } = await rig();
  const ex = new Map<string, string>(), vis = new Map<string, string>();
  const me = (await call('POST', '/api/start', { role: 'exhibitor' }, ex)).json.me as Me;
  assert.match(me.callsign, /^Exhibitor \d{4}$/);
  assert.equal((await call('POST', '/api/station/claim', { stationId: '7C17', company: 'Kedai Kopi', offer: '', link: '', color: 0x17b6d6 }, ex)).json.code, 'need_passport', 'a booth needs a person behind it');
  await call('POST', '/api/passport', { ...passportInput, name: 'Hana Host', email: 'hana@example.com' }, ex);
  const booth = () => call('GET', '/api/host/stations', undefined, ex).then((x) => x.json.data[0] as { stamps: number; shares: number } | undefined);
  const steps = async () => { const b = await booth(); return boothSteps({ online: !!b, visits: b?.stamps ?? 0, leads: b?.shares ?? 0 }).filter((s) => s.done).length; };
  assert.equal(await steps(), 0);

  // 1 — light up
  let r = await call('POST', '/api/station/claim', { stationId: '7C17', company: 'Kedai Kopi', offer: 'Free kopi at 3 pm', link: 'kedaikopi.example', color: 0x17b6d6 }, ex);
  assert.deepEqual(r.json.events, [{ action: 'station_claim', xp: POINTS.boothOnline, target: 'Kedai Kopi' }]);
  assert.equal(await steps(), 1);

  // 2 — get scanned: a visitor types the live code from the exhibitor's screen
  await call('POST', '/api/start', { role: 'visitor' }, vis);
  await call('POST', '/api/passport', passportInput, vis);
  const qr = (await call('GET', '/api/host/code?station=7C17', undefined, ex)).json.data as { digits: string };
  clock.advance(1000);
  r = await call('POST', '/api/stamp', { stationId: '7C17', proof: 'host', code: qr.digits }, vis);
  assert.deepEqual(r.json.events.map((e: { action: string; xp: number }) => [e.action, e.xp]), [['scan', POINTS.scan], ['verified_contact', 0]], 'the points are in the scan; "met in person" is a fact, not a second reward');
  assert.equal(await steps(), 2);

  // 3 — lead: the visitor leaves their card, choosing the fields
  r = await call('POST', '/api/station/share', { stationId: '7C17', fields: ['name', 'company', 'email'] }, vis);
  assert.deepEqual(r.json.events, [{ action: 'share_station', xp: POINTS.leaveCard, target: 'Kedai Kopi' }]);
  assert.equal(await steps(), 3);
  const leads = (await call('GET', '/api/host/leads?station=7C17', undefined, ex)).json.data as { name: string; email: string; phone: string; verified: boolean }[];
  assert.deepEqual(leads.map((l) => [l.name, l.email, l.phone, l.verified]), [['Aisyah Rahman', 'aisyah@example.com', '', true]]);

  // a visitor who brings a booth online becomes an exhibitor, whichever door they came in by
  clock.advance(60_000);
  await call('POST', '/api/station/claim', { stationId: '7C19', company: 'Second Stand', offer: '', link: '', color: 0x17b6d6 }, vis);
  assert.equal(((await call('GET', '/api/me', undefined, vis)).json.me as Me).cls, 'exhibitor');

  // the booths board ranks by visits
  const booths = (await call('GET', '/api/boards?board=stations', undefined, vis)).json.data as { title: string; value: number; unit: string }[];
  assert.deepEqual([booths[0]!.title, booths[0]!.value, booths[0]!.unit], ['Kedai Kopi', 1, 'visits']);
});

test('a tampered session cookie gets a fresh guest, never another account', async () => {
  const { call, jar } = await rig();
  const a = (await call('GET', '/api/me')).json.me as Me;
  jar.set('mx_s', jar.get('mx_s')!.slice(0, -1) + (jar.get('mx_s')!.endsWith('x') ? 'y' : 'x'));
  const b = (await call('GET', '/api/me')).json.me as Me;
  assert.notEqual(a.id, b.id);
});
