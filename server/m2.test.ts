import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { buildServices } from './wire.js';
import { testStores } from './test-db.js';
import type { Contact, HostCode, HostLead, LevelData, LinkCode, LinkPeek, Me, SectorsView, StationView } from '../shared/types.js';
import { ALL_FEATURES, HOST_WINDOW_MS, SECTOR_TICK_MS } from '../shared/rules.js';
import { defaultAvatar } from '../shared/avatar.js';

const root = resolve(import.meta.dirname, '..');
const level = JSON.parse(readFileSync(resolve(root, 'public/data/floor.json'), 'utf8')) as LevelData;

async function rig() {
  let now = Date.UTC(2026, 8, 23, 2, 5, 0); // 10:05 MYT, show day 1
  const clock = { advance: (ms: number) => { now += ms; }, get now() { return now; } };
  const services = buildServices({ ...(await testStores()), features: ALL_FEATURES, secret: 'test-secret', level, publicOrigin: 'http://x.test', now: () => now });
  const app = createApp({ ...services, crewPin: '4321', publicOrigin: 'http://x.test', secureCookies: false });

  const user = () => {
    const jar = new Map<string, string>();
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await app.request(path, { method, headers: { 'content-type': 'application/json', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body ? JSON.stringify(body) : undefined });
      for (const sc of res.headers.getSetCookie()) { const kv = sc.split(';')[0]!, i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
      const isJson = res.headers.get('content-type')?.includes('json');
      return { status: res.status, json: isJson ? await res.json() : null, raw: isJson ? '' : await res.text() };
    };
    return {
      call,
      get: (p: string) => call('GET', p),
      post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
      me: async () => (await call('GET', '/api/me')).json.me as Me,
      async join(cls: string, name: string, passport = true) {
        await call('POST', '/api/start', { role: cls });
        if (passport) {
          const r = await call('POST', '/api/passport', { name, company: `${name} Trading`, role: 'Owner', phone: '+60120000001', email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`, showContact: false, consentMarketing: false, consentNotice: true });
          assert.equal(r.status, 200, JSON.stringify(r.json));
        }
        return this;
      },
      async walkTo(stationId: string) {
        const b = level.booths.find((x) => x.id === stationId)!;
        clock.advance(60_000); // long enough that the jump is not a teleport and the stamp cooldown has passed
        const r = await call('POST', '/api/presence', { x: b.x - 2.5, y: b.y, h: 0 });
        assert.equal(r.status, 200);
      },
    };
  };
  const crew = async () => { const u = user(); assert.equal((await u.post('/api/crew/login', { pin: '4321' })).status, 200); return u; };
  return { clock, user, crew };
}

test('station: claim, rotating host code, verified contact, consented lead, revoke, moderation', async () => {
  const { clock, user, crew } = await rig();
  const host = await user().join('exhibitor', 'Hana Host'), visitor = await user().join('visitor', 'Vik Visitor'), guest = await user().join('visitor', 'No Passport', false);

  assert.equal((await guest.post('/api/station/claim', { stationId: '7C17', company: 'Squatters', offer: '', link: '', color: 0 })).json.code, 'need_passport');
  assert.equal((await host.post('/api/station/claim', { stationId: '8H18B', company: 'Cheeky', offer: '', link: '', color: 0 })).json.code, 'reserved');
  assert.equal((await host.post('/api/station/claim', { stationId: '7C17', company: 'Mamee', offer: 'x', link: 'javascript:alert(1)', color: 0 })).json.code, 'link');

  let r = await host.post('/api/station/claim', { stationId: '7C17', company: 'Mamee <b>Double</b> Decker', offer: 'Free samples at 3pm', link: 'mamee.com', color: 0xff6600 });
  assert.equal(r.status, 200);
  assert.equal(r.json.events[0].xp, 100);
  assert.deepEqual(r.json.me.hosting, ['7C17']);
  let list = (await visitor.get('/api/stations')).json.data as StationView[];
  assert.equal(list.length, 1);
  assert.equal(list[0]!.company, 'Mamee bDouble/b Decker', 'angle brackets stripped');
  assert.equal(list[0]!.link, 'https://mamee.com/');
  assert.equal(list[0]!.status, 'pending');
  assert.equal(list[0]!.hosted, false);
  assert.equal((await visitor.post('/api/station/claim', { stationId: '7C17', company: 'Imposter', offer: '', link: '', color: 0 })).status, 409);

  // only the owner gets the code; the code page marks the station hosted
  assert.equal((await visitor.get('/api/host/code?station=7C17')).status, 403);
  let code = (await host.get('/api/host/code?station=7C17')).json.data as HostCode;
  assert.match(code.digits, /^\d{6}$/);
  clock.advance(6000); // past the 5 s public list cache
  list = (await visitor.get('/api/stations')).json.data;
  assert.equal(list[0]!.hosted, true);

  // sharing needs a stamp first; wrong / own / expired codes are refused
  assert.equal((await visitor.post('/api/station/share', { stationId: '7C17', fields: ['name'] })).json.code, 'need_stamp');
  assert.equal((await visitor.post('/api/stamp', { stationId: '7C17', proof: 'host', code: '000000' === code.digits ? '111111' : '000000' })).json.code, 'bad_code');
  assert.equal((await host.post('/api/stamp', { stationId: '7C17', proof: 'host', code: code.digits })).json.code, 'own_station');
  assert.equal((await visitor.post('/api/stamp', { stationId: '7C18', proof: 'host', code: code.digits })).json.code, 'not_hosted');

  r = await visitor.post('/api/stamp', { stationId: '7C17', proof: 'host', code: code.digits });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.events.map((e: { action: string; xp: number }) => [e.action, e.xp]), [['scan', 50], ['verified_contact', 0]], 'a real-booth scan is +50; met-in-person is recorded, not paid twice');
  assert.deepEqual(r.json.me.verified, ['7C17']);
  assert.equal((await visitor.post('/api/stamp', { stationId: '7C17', proof: 'host', code: code.digits })).json.code, 'dup');

  // a virtual stamp first, then the host code later still earns the verified contact (once)
  const late = await user().join('visitor', 'Lara Late');
  await late.walkTo('7C17');
  assert.equal((await late.post('/api/stamp', { stationId: '7C17', proof: 'virtual' })).json.events[0].action, 'stamp');
  code = (await host.get('/api/host/code?station=7C17')).json.data;
  const url = new URL(code.url).searchParams.get('h')!;
  r = await late.post('/api/stamp', { stationId: '7C17', proof: 'host', code: url });
  assert.deepEqual(r.json.events.map((e: { action: string }) => e.action), ['verified_contact']);
  clock.advance(HOST_WINDOW_MS * 6);
  const stale = await user().join('visitor', 'Stu Stale');
  assert.equal((await stale.post('/api/stamp', { stationId: '7C17', proof: 'host', code: url })).json.code, 'bad_code', 'an old code stops working');

  // consented lead: the host sees exactly the chosen fields
  r = await visitor.post('/api/station/share', { stationId: '7C17', fields: ['email', 'bogus'] });
  assert.equal(r.json.events[0].xp, 10);
  assert.deepEqual(r.json.me.shared, ['7C17']);
  assert.equal((await visitor.post('/api/station/share', { stationId: '7C17', fields: ['name', 'phone'] })).json.events.length, 0, 'changing fields pays nothing extra');
  assert.equal((await visitor.get('/api/host/leads?station=7C17')).status, 403, 'a visitor cannot read the lead list');
  let leads = (await host.get('/api/host/leads?station=7C17')).json.data as HostLead[];
  assert.equal(leads.length, 1);
  assert.deepEqual({ ...leads[0], at: 0, callsign: '' }, { callsign: '', name: 'Vik Visitor', company: '', role: '', phone: '+60120000001', email: '', verified: true, at: 0 });
  assert.match((await host.get('/api/host/leads.csv?station=7C17')).raw, /"Vik Visitor"/);

  await visitor.post('/api/station/unshare', { stationId: '7C17' });
  leads = (await host.get('/api/host/leads?station=7C17')).json.data;
  assert.equal(leads.length, 0, 'a revoked share disappears from the host list');

  // the visitor's Contact Log holds the station while the share stands
  await visitor.post('/api/station/share', { stationId: '7C17', fields: ['name'] });
  const contacts = (await visitor.get('/api/contacts')).json.data as Contact[];
  assert.equal(contacts[0]!.kind, 'station');
  assert.equal(contacts[0]!.link, 'https://mamee.com/');
  assert.equal(contacts[0]!.verified, true);

  // crew moderation
  const staff = await crew();
  assert.equal((await visitor.get('/api/crew/stations')).status, 401);
  const rows = (await staff.get('/api/crew/stations')).json.data;
  assert.equal(rows[0].ownerName, 'Hana Host');
  await staff.post('/api/crew/stations/status', { stationId: '7C17', status: 'revoked' });
  assert.equal(((await visitor.get('/api/stations')).json.data as StationView[]).length, 0);
  assert.equal((await host.get('/api/host/code?station=7C17')).status, 403);
  assert.equal((await host.post('/api/station/claim', { stationId: '7C17', company: 'Mamee', offer: '', link: '', color: 0 })).json.code, 'revoked');
  await staff.post('/api/crew/stations/status', { stationId: '7C17', status: 'release' });
  assert.equal((await late.post('/api/station/claim', { stationId: '7C17', company: 'The real Mamee', offer: '', link: '', color: 0 })).status, 200);
});

test('link-up: peek shows no personal data, each side shares only what they chose, revocable', async () => {
  const { clock, user } = await rig();
  const a = await user().join('visitor', 'Aisyah Rahman'), b = await user().join('exhibitor', 'Ben Tan'), g = await user().join('visitor', 'Guest', false);

  assert.equal((await g.post('/api/link/code')).json.code, 'need_passport');
  const code = (await a.post('/api/link/code')).json.data as LinkCode;
  assert.match(code.code, /^[A-Z2-9]{8}$/);
  assert.equal((await a.post('/api/link', { code: code.code, fields: ['name'] })).json.code, 'self');

  const peek = (await b.post('/api/link/peek', { code: code.code })).json.data as LinkPeek;
  assert.deepEqual(Object.keys(peek).sort(), ['alreadyLinked', 'callsign', 'cls', 'shares']);
  assert.equal(peek.callsign, 'Aisyah R.', 'the game name they agreed to show: first name and initial');
  assert.ok(!['Rahman', 'Kedai', 'example.com', '+60'].some((x) => JSON.stringify(peek).includes(x)), 'no surname, company or contact details before consent');

  const r = await b.post('/api/link', { code: code.code, fields: ['name', 'phone'] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.events[0].xp, 50);
  assert.equal(r.json.me.links, 1);
  assert.equal((await a.me()).xp, 200 + 50, 'the person who showed the code is rewarded too');
  assert.equal((await b.post('/api/link', { code: code.code, fields: ['name'] })).json.code, 'bad_link', 'one code, one handshake');

  const mine = (await b.get('/api/contacts')).json.data as Contact[], theirs = (await a.get('/api/contacts')).json.data as Contact[];
  assert.deepEqual(mine[0]!.card, { name: 'Aisyah Rahman', company: 'Aisyah Rahman Trading', role: 'Owner' }, 'A shares the default fields — no phone, no email');
  assert.deepEqual(theirs[0]!.card, { name: 'Ben Tan', phone: '+60120000001' }, 'B chose name + phone only');

  // already linked → refused even with a fresh code; expired code → refused
  const again = (await a.post('/api/link/code')).json.data as LinkCode;
  assert.equal((await b.post('/api/link', { code: again.code, fields: ['name'] })).json.code, 'dup');
  const c = await user().join('visitor', 'Chen Li');
  const old = (await c.post('/api/link/code')).json.data as LinkCode;
  clock.advance(121_000);
  assert.equal((await b.post('/api/link', { code: old.code, fields: ['name'] })).json.code, 'bad_link');

  // notes are private to their author; revoking empties the card the other side sees
  await b.post('/api/contacts/note', { key: mine[0]!.key, note: 'Wants a Shopee → store demo' });
  assert.equal(((await b.get('/api/contacts')).json.data as Contact[])[0]!.note, 'Wants a Shopee → store demo');
  assert.equal(((await a.get('/api/contacts')).json.data as Contact[])[0]!.note, '');
  await b.post('/api/contacts/revoke', { key: mine[0]!.key });
  assert.deepEqual(((await a.get('/api/contacts')).json.data as Contact[])[0]!.card, {}, 'B took the card back');
});

test('avatar editor (switched off in the simple game): catalog-validated, reward items stay locked, carried on presence', async () => {
  const { user } = await rig();
  const a = await user().join('visitor', 'Ava', false), b = await user().join('visitor', 'Bo', false);
  assert.deepEqual((await a.me()).avatar, defaultAvatar('visitor'));

  const look = { ...defaultAvatar('visitor'), helmet: 3, top: 6, smile: 1 };
  assert.equal((await a.post('/api/avatar', { spec: { ...look, smile: 4 } })).json.code, 'bad_avatar', 'reward items stay locked');
  assert.equal((await a.post('/api/avatar', { spec: { ...look, top: 9 } })).json.code, 'bad_avatar', 'constellation rewards stay locked');
  assert.equal((await a.post('/api/avatar', { spec: { ...look, helmet: 99 } })).json.code, 'bad_avatar');
  assert.equal((await a.post('/api/avatar', { spec: look })).status, 200);
  assert.deepEqual((await a.me()).avatar, look);

  const s = level.spawns.short;
  await a.post('/api/presence', { x: s.x, y: s.y, h: 0, spawn: true });
  const seen = (await b.post('/api/presence', { x: s.x + 1, y: s.y, h: 0, spawn: true })).json.data.holograms;
  assert.equal(seen[0].av, '3.0.1.5.6.0.0.0.0');
});

test('crews: influence decides the sector at the tick; active members of the holder are paid', async () => {
  const { clock, user } = await rig();
  const builder = await user().join('visitor', 'B One', false), closer = await user().join('exhibitor', 'C One', false);
  await builder.post('/api/presence', { x: level.spawns.short.x, y: level.spawns.short.y, h: 0, spawn: true });
  await closer.post('/api/presence', { x: level.spawns.short.x, y: level.spawns.short.y, h: 0, spawn: true });

  for (const id of ['8H19', '8H20']) { await builder.walkTo(id); assert.equal((await builder.post('/api/stamp', { stationId: id, proof: 'virtual' })).status, 200); }
  await closer.walkTo('8H15');
  assert.equal((await closer.post('/api/stamp', { stationId: '8H15', proof: 'virtual' })).status, 200);

  let v = (await builder.get('/api/sectors')).json.data as SectorsView;
  const hall8 = () => v.sectors.find((s) => s.hall === 8)!;
  assert.equal(hall8().holder, null, 'nobody holds a sector before the first tick');
  assert.ok(hall8().scores.visitor > hall8().scores.exhibitor && hall8().scores.exhibitor > 0);
  assert.equal(v.crewSizes.visitor, 1);

  const before = (await builder.me()).xp;
  clock.advance(SECTOR_TICK_MS);
  v = (await closer.get('/api/sectors')).json.data;
  assert.equal(hall8().holder, 'visitor');
  assert.equal(v.sectors.find((s) => s.hall === 7)!.holder, null);
  assert.equal((await builder.me()).xp, before + 40, 'active member of the holding crew');
  const closerXp = (await closer.me()).xp;

  // settling is idempotent, and a sector with no fresh activity stays with its holder
  await builder.get('/api/sectors');
  assert.equal((await builder.me()).xp, before + 40);
  clock.advance(SECTOR_TICK_MS * 3);
  v = (await closer.get('/api/sectors')).json.data;
  assert.equal(hall8().holder, 'visitor', 'ties and silence leave the previous holder in place');
  assert.equal((await closer.me()).xp, closerXp);
});
