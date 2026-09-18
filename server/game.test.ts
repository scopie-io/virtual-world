import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { buildServices } from './wire.js';
import { testStores } from './test-db.js';
import type { LevelData, Me } from '../shared/types.js';
import { VENUE_DEFAULT } from '../shared/rules.js';

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

test('full M1 journey: guest, suit up, stamp, passport, dock, rank', async () => {
  const { call, clock } = await rig();

  let r = await call('GET', '/api/me');
  assert.equal(r.status, 200);
  let me = r.json.me as Me;
  assert.match(me.callsign, /^\w+-\w+-\d+$/);
  assert.equal(me.rank.id, 'cadet');

  r = await call('POST', '/api/suit-up', { cls: 'builder' });
  assert.equal(r.json.me.xp, 50);
  r = await call('POST', '/api/suit-up', { cls: 'closer' });
  assert.equal(r.json.me.xp, 50, 'suit-up XP is granted once');

  // too far to stamp
  const hero = level.hero;
  const target = level.booths.find((b) => b.id === '8H19')!;
  r = await call('POST', '/api/presence', { x: level.spawns.short.x, y: level.spawns.short.y, h: 0, spawn: true });
  assert.equal(r.status, 200);
  r = await call('POST', '/api/stamp', { stationId: target.id, proof: 'virtual' });
  assert.equal(r.json.code, 'too_far');

  // teleporting is rejected; walking is accepted
  clock.advance(1000);
  await call('POST', '/api/presence', { x: hero.dock.x, y: hero.dock.y, h: 0 });
  r = await call('POST', '/api/stamp', { stationId: target.id, proof: 'virtual' });
  assert.equal(r.json.code, 'too_far', 'a 30 m jump in 1 s must not move the server-side position');
  clock.advance(40_000);
  r = await call('POST', '/api/presence', { x: hero.dock.x, y: target.y, h: 0 });
  assert.ok(r.json.events.some((e: { action: string }) => e.action === 'hall_first'), 'entering Hall 8 is discovered');

  r = await call('POST', '/api/stamp', { stationId: target.id, proof: 'virtual' });
  assert.equal(r.status, 200);
  assert.equal(r.json.events[0].xp, 9, '40 x 0.15 remote x 1.5 quiet = 9');
  r = await call('POST', '/api/stamp', { stationId: target.id, proof: 'virtual' });
  assert.equal(r.json.code, 'dup');
  r = await call('POST', '/api/stamp', { stationId: '8H20', proof: 'virtual' });
  assert.equal(r.json.code, 'cooldown');

  // printed beacon: a forged code is refused
  clock.advance(60_000);
  r = await call('POST', '/api/stamp', { stationId: '7C17', proof: 'beacon', beacon: '7C17.forged' });
  assert.equal(r.json.code, 'bad_beacon');

  // passport validation + issue
  r = await call('POST', '/api/passport', { ...passportInput, consentNotice: false });
  assert.equal(r.json.code, 'consent');
  r = await call('POST', '/api/passport', { ...passportInput, email: 'nope' });
  assert.equal(r.json.code, 'email');
  r = await call('POST', '/api/passport', passportInput);
  assert.equal(r.status, 200);
  me = r.json.me as Me;
  assert.ok(me.passport && me.ticket, 'passport and golden ticket issued');
  assert.equal((await call('POST', '/api/passport', passportInput)).json.code, 'dup');

  // public page + vCard
  assert.equal((await call('GET', `/p/${me.passport!.slug}`)).status, 200);
  assert.match((await call('GET', `/p/${me.passport!.slug}/vcard`)).raw, /FN:Aisyah Rahman/);

  // crew: auth required, wrong pin, then dock by token; a second scan is refused
  const crewJar = new Map<string, string>();
  assert.equal((await call('GET', `/api/crew/ticket?t=${me.ticket!.code}`, undefined, crewJar)).status, 401);
  assert.equal((await call('POST', '/api/crew/login', { pin: '0000' }, crewJar)).status, 401);
  assert.equal((await call('POST', '/api/crew/login', { pin: '4321' }, crewJar)).status, 200);
  r = await call('GET', `/api/crew/ticket?t=${me.ticket!.code}`, undefined, crewJar);
  assert.equal(r.json.data.name, 'Aisyah Rahman');
  r = await call('POST', '/api/crew/dock', { t: me.ticket!.token }, crewJar);
  assert.equal(r.status, 200);
  assert.equal((await call('POST', '/api/crew/dock', { t: me.ticket!.code }, crewJar)).status, 409);

  me = (await call('GET', '/api/me')).json.me as Me;
  assert.equal(me.docked, true);
  assert.equal(me.ticket, null);
  assert.equal(me.xp, 50 + 15 + 3 + 3 + 9 + 200 + 500, 'suit-up + Hall 8 + Speaker Lounge + Bernama Studio landmarks + stamp + passport + dock');
  assert.equal(me.rank.id, 'navigator');

  // genuine beacon gives an on-site stamp at beacon trust — once the venue gate is open (M3)
  assert.equal((await call('POST', '/api/venue', { lat: VENUE_DEFAULT.lat, lon: VENUE_DEFAULT.lon, acc: 30 })).json.data.onsite, true);
  const beacons = (await call('GET', '/api/crew/beacons', undefined, crewJar)).json.data as { id: string; url: string }[];
  const token = new URL(beacons.find((b) => b.id === '7C17')!.url).searchParams.get('b')!;
  r = await call('POST', '/api/stamp', { stationId: '7C17', proof: 'beacon', beacon: token });
  assert.equal(r.json.events[0].xp, 36, '40 x 1.0 on-site x 0.6 beacon x 1.5 quiet = 36');

  const board = (await call('GET', '/api/leaderboard')).json.data;
  assert.equal(board[0].you, true);
  assert.match((await call('GET', '/api/crew/leads.csv', undefined, crewJar)).raw, /Aisyah Rahman/);
});

test('a tampered session cookie gets a fresh guest, never another account', async () => {
  const { call, jar } = await rig();
  const a = (await call('GET', '/api/me')).json.me as Me;
  jar.set('mx_s', jar.get('mx_s')!.slice(0, -1) + (jar.get('mx_s')!.endsWith('x') ? 'y' : 'x'));
  const b = (await call('GET', '/api/me')).json.me as Me;
  assert.notEqual(a.id, b.id);
});
